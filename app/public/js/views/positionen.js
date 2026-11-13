// Nachkalkulation nach Positionen (API.md Abschnitt 10/10a) – im Aufbau der Excel-Vorlage des Betriebs:
// Gruppen Arbeit / Transport / Geräte / Eigenmaterial / Fremdmaterial / Abgaben, Spalten Bezeichnung, EH, Menge, EP, Summe,
// Gruppensummen, Zusammenstellung mit %-Anteil, Ergebnis gegen die Auftragssumme.
// Positionen und Preise gelten je Bauvorhaben und sind dort einzeln anpassbar.
import { get, post, put, del } from '../api.js';
import { ic, esc, fmt, parseZahl, starkOk, leer, banner, dialog, bestaetigen, toast, speicher, $, $$ } from '../ui.js';
import { budgetBalken } from './kalkulation.js';
import { wienHeute } from '../zahl.js';

export const GRUPPEN = { arbeit: 'Arbeit', transport: 'Transport', geraete: 'Geräte', eigenmaterial: 'Eigenmaterial', fremdmaterial: 'Fremdmaterial', abgaben: 'Abgaben' };
// PA/VE: Menge = Rechnungsbetrag netto in €, EP = Aufschlagsfaktor (1,15 → +15 %)
// Landschaftsabgabe: Menge = Tonnen Naturmaterial (automatisch), EP = 0,25 € je t – keine Rechnungsbetrags-Position, auch wenn die Vorlage „PA“ nennt
export const istLandschaft = (p) => !!((p.quelle && p.quelle.art === 'naturmaterial') || /landschaftsabgabe/i.test(p.bezeichnung || ''));
export const istBetrag = (p) => /^(PA|VE)$/i.test(String(p.einheit || '').trim()) && !istLandschaft(p);
export const aufschlag = (ep) => (typeof ep === 'number' ? `${ep >= 1 ? '+' : '−'}${fmt.zahl(Math.abs(Math.round((ep - 1) * 1000) / 10), 1)} %` : '');
export const epText = (p) => (istBetrag(p) ? `× ${fmt.zahl(p.ep)} <small class="auf">(${aufschlag(p.ep)})</small>` : fmt.eur(p.ep));
export const mengeText = (p, m) => (m == null ? '' : istBetrag(p) ? fmt.eur(m) : `${fmt.zahl(m)}`);
// 10d: Positionen, die nicht aus der Excel-Vorlage stammen, sondern aus den Preislisten 2026 ergänzt wurden
export const herkunftChip = (p) => (p.herkunft === 'preisliste_2026' ? '<span class="chip xs st-green" data-herkunft="preisliste_2026" title="Nicht in der Excel-Vorlage – aus den Preislisten 2026 ergänzt">neu aus Preisliste 2026</span>' : '');
// E-08: ohne Preisrecht liefert der Server bei PA/VE keine Beträge – dann „–“ statt 0
export const mengeAnz = (p) => (p.menge == null ? '–' : mengeText(p, p.menge) || '0');
export const zuPruefen = (p) => !!(p.zuordnungPruefen || p.quellePruefen || (p.quelle && (p.quelle.pruefen || p.quelle.geprueft === false)));
export const naturPruefen = (p) => !!(p.naturmaterialPruefen || p.naturmaterialGeprueft === false);
const QUELLE_ART = { personal: 'Personalstunden', geraet: 'Gerätestunden', material: 'Materialmengen' };

export const kalkTabs = (id, aktiv) => `<div class="tabs" role="tablist" aria-label="Ansichten der Nachkalkulation">
  <a role="tab" aria-selected="${aktiv === 'positionen'}" class="${aktiv === 'positionen' ? 'on' : ''}" href="#/kalkulation/${id}/positionen" data-kalk-tab="positionen">Positionen</a>
  <a role="tab" aria-selected="${aktiv === 'intern'}" class="${aktiv === 'intern' ? 'on' : ''}" href="#/kalkulation/${id}" data-kalk-tab="intern">Übersicht &amp; interne Kosten</a></div>`;

export default async function positionen(el, ctx) {
  const id = ctx.params[0];
  const darf = ctx.kann('preise_bearbeiten');
  const darfMengen = darf || (ctx.kann('kalk_sehen') && (ctx.ich.baustellenIds || []).map(String).includes(String(id)));
  let d, bs = {};
  let nurMitMenge = speicher.lies('bt_pos_nurmenge', false);
  let mitAusgeblendeten = false;
  const zu = new Set(speicher.lies('bt_pos_zu', []));
  let stamm = null; // Lohngruppen, Geräte, Material für den Zuordnungs-Editor (erst bei Bedarf geladen)

  async function lade() {
    [d, bs] = await Promise.all([get(`/baustellen/${id}/positionen`), get(`/baustellen/${id}`).catch(() => ({}))]);
    d.gruppen = d.gruppen || [];
  }
  await lade();
  ctx.titel('Nachkalkulation', `${bs.kst ? bs.kst + ' · ' : ''}${bs.name || ''}`);
  const alle = () => d.gruppen.flatMap((g) => (g.positionen || []).map((p) => ({ ...p, gruppe: g.schluessel })));
  const finde = (pid) => alle().find((p) => String(p.id) === String(pid));
  const mitPreis = () => d.gesamtsumme != null; // ohne preise_sehen liefert der Server keine €-Werte
  const sichtbar = (p) => (mitAusgeblendeten || p.aktiv !== false) && (!nurMitMenge || (p.menge || 0) !== 0 || p.neu);

  function zeile(p, i, liste) {
    const aus = p.aktiv === false;
    const manuell = p.mengeManuell || 0, auto = p.mengeAuto || 0;
    return `<div class="pt-row${aus ? ' aus' : ''}${(p.menge || 0) !== 0 ? ' hat' : ''}" role="row" data-pos="${p.id}">
      <span class="pt-bez" role="cell">${darf ? `<input class="pt-in" data-feld="bezeichnung" value="${esc(p.bezeichnung)}" aria-label="Bezeichnung">` : `<b>${esc(p.bezeichnung)}</b>`}
        <span class="pt-marken">${herkunftChip(p)}${zuPruefen(p) ? `<button type="button" class="chip xs st-amber" data-akt="mengen" title="Die automatische Zuordnung zu den Bautagesberichten wurde nach bestem Wissen gesetzt">${ic('alert')}Zuordnung prüfen</button>` : ''}${p.naturmaterial ? `<span class="chip xs st-blue" title="Zählt für die Landschaftsabgabe (0,25 € je t Naturmaterial)">Naturmaterial${naturPruefen(p) ? ' · bitte prüfen' : ''}</span>` : naturPruefen(p) ? '<span class="chip xs st-amber">Naturmaterial? bitte prüfen</span>' : ''}${aus ? '<span class="chip xs st-grey">ausgeblendet</span>' : ''}${p.eigene || p.katalogId === null ? '<span class="chip xs st-outline">eigene Position</span>' : ''}</span></span>
      <span class="pt-eh" role="cell">${darf ? `<input class="pt-in c" data-feld="einheit" value="${esc(p.einheit || '')}" aria-label="Einheit von ${esc(p.bezeichnung)}">` : esc(p.einheit || '')}</span>
      <span class="pt-menge num" role="cell"><button type="button" class="pt-mbtn" data-akt="mengen" aria-label="Mengen von ${esc(p.bezeichnung)}: ${mengeAnz(p)} ${esc(p.einheit || '')} – anzeigen und erfassen"><b>${mengeAnz(p)}${istBetrag(p) ? '' : istLandschaft(p) ? ' t' : ` <i class="eh-m">${esc(p.einheit || '')}</i>`}</b><small>${istLandschaft(p) ? 'auto: je t Naturmaterial' : auto && manuell ? `${mengeText(p, auto)} auto + ${mengeText(p, manuell)}` : auto ? 'aus Berichten' : manuell || p.eintraegeAnzahl ? `${(p.eintraege || []).length || p.eintraegeAnzahl || ''} Eintr.`.trim() : istBetrag(p) ? 'Rechnungsbetrag' : 'erfassen'}</small></button></span>
      <span class="pt-ep num" role="cell">${istLandschaft(p) && !darf ? `${fmt.eur(p.ep)} <small class="auf">je t</small>` : darf ? `<label class="price-in sm"><span class="vh">${istBetrag(p) ? 'Faktor' : 'Einheitspreis'} ${esc(p.bezeichnung)}</span><span aria-hidden="true">${istBetrag(p) ? '×' : '€'}</span><input type="text" inputmode="decimal" class="num" data-feld="ep" value="${fmt.betrag(p.ep)}" autocomplete="off"></label>${istBetrag(p) ? `<small class="auf">${aufschlag(p.ep)}</small>` : istLandschaft(p) ? '<small class="auf">je t Naturmaterial</small>' : ''}` : p.ep == null ? '' : epText(p)}</span>
      <span class="pt-sum num" role="cell"><b>${p.summe == null && !mitPreis() ? '' : fmt.eur(p.summe || 0)}</b></span>
      <span class="pt-akt" role="cell">${darf ? `<button type="button" class="icon-btn sm" data-akt="hoch" aria-label="${esc(p.bezeichnung)} nach oben" ${i === 0 ? 'disabled' : ''}>${ic('down', 'up')}</button><button type="button" class="icon-btn sm" data-akt="runter" aria-label="${esc(p.bezeichnung)} nach unten" ${i === liste.length - 1 ? 'disabled' : ''}>${ic('down')}</button><button type="button" class="icon-btn sm" data-akt="mehr" aria-label="Weitere Aktionen für ${esc(p.bezeichnung)}">${ic('more')}</button>` : ''}</span>
    </div>`;
  }
  function zeichne() {
    const hatAuftrag = d.auftragGesamt != null && d.auftragGesamt > 0;
    const leerBs = !!d.positionenFehlen || alle().length === 0; // E-03: Baustelle ohne Positionen (z. B. Datenbank aus älterer Version) – kein „0 %“ vortäuschen
    const k = { budgetVerbrauchProzent: d.budgetVerbrauchProzent, leistungsstandProzent: null, status: d.status || (d.budgetVerbrauchProzent >= 100 ? 'kritisch' : d.budgetVerbrauchProzent >= ((d.schwellen || [80])[0]) ? 'warnung' : 'ok'), schwellen: d.schwellen || bs.schwellen || [80, 90, 100] };
    el.innerHTML = `
    <div class="page pos-page">
      <div class="form-top"><a class="link-back" href="#/kalkulation">${ic('left')}Alle Baustellen</a><span class="grow"></span>
        <a class="btn ghost sm" id="pos-export" href="/api/baustellen/${id}/positionen/export.xlsx" download="Nachkalkulation_${esc(bs.kst || id)}.xlsx">${ic('download')}Excel</a>
        ${darf ? `<button type="button" class="btn ghost sm" data-akt="vorlage">${ic('sync')}Aus Vorlage übernehmen</button>` : ''}</div>
      ${kalkTabs(id, 'positionen')}
      ${leerBs ? `<section class="card state big" id="pos-leer" data-zustand="keine-positionen">${ic('table')}<h2>Noch keine Positionen</h2><p>${esc(((d.hinweise || []).find((h) => /vorlage|position/i.test(h.text || h)) || {}).text || 'Für diese Baustelle wurden noch keine Positionen angelegt. Budget-Verbrauch und Nachkalkulationssumme gibt es erst, wenn die Positionen aus der Vorlage übernommen sind.')}</p>${darf ? `<button type="button" class="btn primary" data-akt="vorlage">${ic('sync')}Positionen aus Vorlage übernehmen</button>` : '<p class="muted sm">Das Büro kann die Positionen aus der Vorlage übernehmen.</p>'}</section>` : !mitPreis() ? banner('info', 'Preise und Summen sind für Ihre Rolle nicht freigegeben – angezeigt werden nur Bezeichnungen und Mengen.', 'lock') : `
      <div class="kpi-row three">
        <div class="kpi sm" data-kpi="nk"><small>Nachkalkulationssumme</small><b id="pos-gesamt">${fmt.eur(d.gesamtsumme || 0)}</b><em>Wert der Baustelle zu Firmensätzen</em></div>
        <div class="kpi sm"><small>Auftragssumme gesamt</small><b>${hatAuftrag ? fmt.eur(d.auftragGesamt) : '–'}</b><em>${hatAuftrag ? 'inkl. Nachträge' : 'nicht erfasst'}</em></div>
        <div class="kpi sm" data-kpi="ergebnis"><small>Ergebnis</small><b class="${d.ergebnis < 0 ? 'neg' : ''}">${d.ergebnis != null ? fmt.eur(d.ergebnis) : '–'}</b><em>${d.ergebnisProzent != null ? fmt.pct(d.ergebnisProzent) + ' der Auftragssumme' : 'Auftragssumme − Nachkalkulation'}</em></div>
      </div>
      <section class="card pad" aria-labelledby="h-pbud"><div class="card-h"><h3 id="h-pbud">Budget</h3><span class="muted sm">Nachkalkulationssumme ÷ Auftragssumme · <b data-wert="pos-verbrauch">${fmt.pct(d.budgetVerbrauchProzent)}</b></span></div>${budgetBalken(k)}</section>
      `}
      ${(d.hinweise || []).length ? `<div class="stack-s" id="pos-hinweise">${d.hinweise.map((h) => banner(h.typ === 'warnung' ? 'warn' : 'info', esc(h.text || h))).join('')}</div>` : ''}
      ${leerBs ? '' : `<div class="toolbar pos-filter">
        <label class="check-inline"><input type="checkbox" id="f-menge" ${nurMitMenge ? 'checked' : ''}> Nur Positionen mit Menge</label>
        ${darf ? `<label class="check-inline"><input type="checkbox" id="f-aus" ${mitAusgeblendeten ? 'checked' : ''}> Ausgeblendete zeigen</label>` : ''}
      </div>
      <div class="pos-tab" role="table" aria-label="Nachkalkulation nach Positionen">
        <div class="pt-head" role="row"><span role="columnheader">Bezeichnung</span><span role="columnheader">EH</span><span role="columnheader">Menge</span><span role="columnheader">EP</span><span role="columnheader">Summe</span><span></span></div>
        ${d.gruppen.map((g) => {
          const liste = (g.positionen || []).filter(sichtbar);
          const anz = (g.positionen || []).filter((p) => p.aktiv !== false).length;
          return `<details class="pg" data-gruppe="${esc(g.schluessel)}" ${zu.has(g.schluessel) ? '' : 'open'}>
            <summary><span class="pg-name">${esc(g.name || GRUPPEN[g.schluessel] || g.schluessel)}</span><span class="count">${anz}</span><span class="grow"></span><span class="pg-pct">${g.anteilProzent != null ? fmt.pct(g.anteilProzent) : ''}</span>${mitPreis() ? `<b class="num" data-gsum="${esc(g.schluessel)}">${fmt.eur(g.summe || 0)}</b>` : ''}${ic('down')}</summary>
            <div role="rowgroup">${liste.length ? liste.map(zeile).join('') : `<p class="muted sm pad-s">${nurMitMenge ? 'Keine Position mit Menge.' : 'Keine Positionen.'}</p>`}</div>
            <div class="pg-foot">${darf ? `<button type="button" class="btn ghost sm" data-neu="${esc(g.schluessel)}">${ic('plus')}Eigene Position</button>` : '<span></span>'}${mitPreis() ? `<span>Summe ${esc(g.name || GRUPPEN[g.schluessel] || '')} <b class="num">${fmt.eur(g.summe || 0)}</b></span>` : '<span></span>'}</div>
          </details>`;
        }).join('')}
      </div>
      ${!mitPreis() ? '' : `<section class="card" aria-labelledby="h-zus"><div class="card-h pad-h"><h3 id="h-zus">Zusammenstellung</h3></div>
        <div class="tbl-wrap"><table class="tbl" id="zusammenstellung"><thead><tr><th>Gruppe</th><th class="r">Summe</th><th class="r">Anteil</th></tr></thead>
          <tbody>${d.gruppen.map((g) => `<tr><td>${esc(g.name || GRUPPEN[g.schluessel] || g.schluessel)}</td><td class="r num">${fmt.eur(g.summe || 0)}</td><td class="r num">${g.anteilProzent != null ? fmt.pct(g.anteilProzent) : '–'}</td></tr>`).join('')}</tbody>
          <tfoot><tr class="sum"><th scope="row">Gesamtsumme (Nachkalkulation)</th><td class="r num"><b>${fmt.eur(d.gesamtsumme || 0)}</b></td><td class="r num" data-anteil-summe>${d.anteilSummeProzent != null ? fmt.pct(d.anteilSummeProzent) : d.gesamtsumme > 0 ? fmt.pct(Math.round(d.gruppen.reduce((a, g) => a + (g.summe || 0), 0) / d.gesamtsumme * 1000) / 10) : '–'}</td></tr>
            <tr><th scope="row">Auftragssumme gesamt</th><td class="r num">${hatAuftrag ? fmt.eur(d.auftragGesamt) : '–'}</td><td></td></tr>
            <tr class="sum"><th scope="row">Ergebnis</th><td class="r num"><b class="${d.ergebnis < 0 ? 'neg' : ''}">${d.ergebnis != null ? fmt.eur(d.ergebnis) : '–'}</b></td><td class="r num">${d.ergebnisProzent != null ? fmt.pct(d.ergebnisProzent) : ''}</td></tr></tfoot></table></div>
      </section>`}
      `}
      <p class="fineprint" ${mitPreis() ? '' : 'hidden'}>Einheitspreise sind Verrechnungspreise des Betriebs und gelten nur für dieses Bauvorhaben. Änderungen wirken nicht auf andere Baustellen und nicht auf die Firmenvorlage.</p>
    </div>`;
  }
  const neu = async () => { await lade(); if (ctx.aktuell()) { const v = document.getElementById('view'); const st = v ? v.scrollTop : 0; zeichne(); if (v) v.scrollTop = st; } ctx.meldungenNeu(); };

  async function aendere(p, body, okText) {
    try { await put(`/baustellen/${id}/positionen/${p.id}`, { version: p.version, ...body }); if (okText) toast(okText); await neu(); return true; }
    catch (e) {
      if (e.status === 409 && e.daten && e.daten.version != null) { toast('Inzwischen von jemand anderem geändert – die Ansicht wird neu geladen, bitte die Änderung noch einmal eintragen.', 'warn'); await neu(); }
      else toast(e.message, 'warn');
      return false;
    }
  }

  /* ---- Mengen-Dialog: automatische Menge, manuelle Einträge, Zuordnung (Quelle), Naturmaterial ---- */
  async function mengenDialog(pid) {
    let p = finde(pid); if (!p) return;
    if (darf && !stamm) {
      const [pr, ge, ma] = await Promise.all([get('/preise').catch(() => ({})), get('/geraete').catch(() => []), get('/materialien').catch(() => [])]);
      stamm = { personal: [{ ref: 'alle', name: 'Alle Lohngruppen' }, ...((pr.lohngruppen || []).map((l) => ({ ref: l.id, name: l.name })))], geraet: ge.map((g) => ({ ref: g.code, name: g.name })), material: ma.map((m) => ({ ref: m.code, name: `${m.name} (${m.einheit})` })) };
    }
    const betrag = istBetrag(p), land = istLandschaft(p);
    const natMoeglich = p.naturmaterialMoeglich ?? String(p.einheit || '').trim().toLowerCase() === 't'; // E-01: Kennzeichen nur bei Tonnen-Positionen
    // E-07: Büro/GF stornieren alles, der Bauleiter nur eigene Einträge (der Server kann es je Eintrag mit `stornierbar` vorgeben)
    const darfStorno = (e) => (e.stornierbar != null ? !!e.stornierbar : darf || (darfMengen && e.erstelltVon === ctx.ich.benutzer.id));
    const q = p.quelle || {};
    const qRefs = [].concat(q.ref == null ? [] : q.ref).map(String); // der Server liefert eine Liste
    const refs = (art) => (stamm && stamm[art] ? stamm[art].map((r) => `<option value="${esc(r.ref)}" ${qRefs.includes(String(r.ref)) && q.art === art ? 'selected' : ''}>${esc(r.name)}</option>`).join('') : '');
    const d2 = dialog({
      titel: p.bezeichnung, breit: true,
      inhalt: `<div class="stack-s" id="mengen" data-pos="${p.id}">
        <dl class="def-list tight"><div><dt>${betrag ? 'Rechnungsbeträge gesamt' : 'Menge gesamt'}</dt><dd class="num">${mengeAnz(p)} ${betrag ? '' : land ? 't' : esc(p.einheit || '')}</dd></div>
          <div><dt>${betrag ? `Aufschlagsfaktor` : 'Einheitspreis'}</dt><dd class="num">${betrag ? `× ${fmt.zahl(p.ep)} (${aufschlag(p.ep)})` : fmt.eur(p.ep)}</dd></div>
          <div><dt>Summe</dt><dd class="num"><b>${fmt.eur(p.summe || 0)}</b></dd></div></dl>
        ${land ? banner('info', `<b>Automatisch:</b> ${fmt.zahl(p.mengeAuto || 0)} t Naturmaterial × ${fmt.eur(p.ep)} – 0,25 € je t Naturmaterial. Gezählt werden alle Positionen mit dem Kennzeichen „Naturmaterial“ (Einheit t). Zusätzliche Mengen können unten händisch erfasst werden.`)
          : p.mengeAuto ? banner('info', `<b>${mengeText(p, p.mengeAuto)} ${esc(p.einheit || '')}</b> kommen automatisch aus den Bautagesberichten (${esc(QUELLE_ART[q.art] || 'Zuordnung')}).`) : ''}
        ${betrag ? banner('info', `<b>Rechnungsbetrag eingeben:</b> Bei dieser Position ist die Menge der Netto-Rechnungsbetrag in Euro. Er wird mit dem Faktor ${fmt.zahl(p.ep)} (${aufschlag(p.ep)}) verrechnet.`) : ''}
        <h4 class="sub-h">${betrag ? 'Erfasste Rechnungsbeträge' : 'Händisch erfasste Mengen'}</h4>
        ${(p.eintraege || []).length ? `<ul class="plain rows" id="eintraege">${p.eintraege.map((e) => `<li data-eintrag="${e.id}"><span class="grow"><b>${e.menge == null ? 'Betrag nicht sichtbar' : betrag ? fmt.eur(e.menge) : fmt.zahl(e.menge) + ' ' + esc(land ? 't' : p.einheit || '')}</b><small>${esc(fmt.datum(e.datum))}${e.erstelltVonName ? ' · ' + esc(e.erstelltVonName) : ''}${e.notiz ? ' · ' + esc(e.notiz) : ''}</small></span>${darfStorno(e) ? `<button type="button" class="btn ghost sm" data-storno="${e.id}">Stornieren</button>` : darfMengen ? '<span class="muted sm nw" data-kein-storno>Storno nur durch das Büro</span>' : ''}</li>`).join('')}</ul>` : p.eintraegeAnzahl ? `<p class="muted sm" data-eintraege-verborgen>${p.eintraegeAnzahl} ${p.eintraegeAnzahl === 1 ? 'Eintrag' : 'Einträge'} – Beträge und Notizen sind für Ihre Rolle nicht sichtbar.</p>` : '<p class="muted sm">Noch keine Einträge.</p>'}
        ${darfMengen ? `<form id="mf" class="form-grid mf" novalidate>
          <label class="field"><span class="field-label">${betrag ? 'Rechnungsbetrag (€)' : `Menge (${land ? 't' : esc(p.einheit || '')})`}</span><input class="input lg num" name="menge" inputmode="decimal" autocomplete="off" required placeholder="${betrag ? '0,00' : '0'}"><small class="geld-echo" id="mf-echo" aria-live="polite"></small></label>
          <label class="field"><span class="field-label">Datum</span><input class="input lg" type="date" name="datum" required value="${wienHeute()}" max="${wienHeute()}"></label>
          <label class="field full"><span class="field-label">Notiz (z. B. Lieferant, Rechnungsnummer)</span><input class="input lg" name="notiz" maxlength="200"></label>
          <p class="form-err full" role="alert" hidden></p>
          <button type="submit" class="btn primary full">${ic('plus')}${betrag ? 'Rechnungsbetrag erfassen' : 'Menge erfassen'}</button></form>` : ''}
        ${darf ? `<details class="einzeln" id="quelle-box" ${zuPruefen(p) || naturPruefen(p) ? 'open' : ''}><summary>Zuordnung zum Bautagesbericht${zuPruefen(p) ? ' – bitte prüfen' : ''}</summary>
          ${zuPruefen(p) ? `<div class="bestaetigen-zeile"><span>Die Zuordnung wurde nach bestem Wissen vorbelegt. Stimmt sie, einfach bestätigen – die automatische Menge bleibt dabei erhalten.</span><button type="button" class="btn primary sm" id="q-ok">${ic('check')}Zuordnung bestätigen</button></div>` : ''}
          <form id="qf" class="form-grid">
            ${q.art === 'naturmaterial' ? `<div class="field full" id="q-fix"><span class="field-label">Menge kommt aus</span><p class="fix-quelle">${ic('lock')}<b>Tonnen Naturmaterial (automatisch)</b> – Summe aller Positionen mit dem Kennzeichen „Naturmaterial“. Diese Zuordnung ist fest (Landschaftsabgabe).</p></div>` : `
            <label class="field"><span class="field-label">Menge kommt aus</span><select class="input lg" name="art"><option value="">– keine automatische Menge –</option>${Object.entries(QUELLE_ART).map(([k2, t]) => `<option value="${k2}" ${q.art === k2 ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
            <label class="field"><span class="field-label">Welche?</span><select class="input" name="ref" id="qf-ref" multiple size="5" aria-describedby="qf-hinweis">${q.art ? refs(q.art) : ''}</select><small class="muted" id="qf-hinweis">Mehrere möglich (Strg bzw. lange tippen).</small></label>
            <label class="field"><span class="field-label">Umrechnungsfaktor (nur bei anderer Einheit)</span><input class="input lg num" name="faktor" inputmode="decimal" value="${q.faktor != null ? fmt.zahl(q.faktor) : ''}" placeholder="1"></label>`}
            ${natMoeglich ? `<label class="switch-row flat full"><span><b>Naturmaterial</b><small>Zählt für die Landschaftsabgabe (0,25 € je t).${naturPruefen(p) ? ' Startwert nach bestem Wissen – bitte prüfen.' : ''}</small></span><input type="checkbox" class="vh" name="naturmaterial" ${p.naturmaterial ? 'checked' : ''}><span class="switch" aria-hidden="true"></span></label>` : ''}
            ${q.art === 'naturmaterial' && !natMoeglich ? '' : `<button type="submit" class="btn ghost full">${ic('check')}Änderung speichern</button>`}</form></details>` : ''}
      </div>`,
      fuss: '<button class="btn ghost" type="button" data-zu>Schließen</button>',
    });
    const mf = $('#mf', d2.el);
    if (mf) {
      const echo = $('#mf-echo', d2.el);
      mf.elements.menge.addEventListener('input', () => { const roh = mf.elements.menge.value.trim(); const n = parseZahl(roh); const f = roh && !Number.isFinite(n); echo.classList.toggle('err', !!f); echo.textContent = f ? 'Eingabe unklar – bitte so schreiben: 1.250,00' : !roh ? '' : betrag ? `ergibt ${fmt.eur(Math.round(n * p.ep * 100) / 100)} (${fmt.eur(n)} ${aufschlag(p.ep)})` : `ergibt ${fmt.eur(Math.round(n * p.ep * 100) / 100)}`; });
      mf.addEventListener('submit', async (e) => {
        e.preventDefault(); const f = new FormData(mf); const err = $('.form-err', mf); const n = parseZahl(f.get('menge'));
        if (!Number.isFinite(n) || n === 0) { err.hidden = false; err.textContent = betrag ? 'Betrag unklar – bitte so schreiben: 1.250,00' : 'Menge unklar – bitte so schreiben: 12,5'; mf.elements.menge.focus(); return; }
        try { await post(`/baustellen/${id}/positionen/${p.id}/mengen`, { datum: f.get('datum'), menge: n, notiz: String(f.get('notiz') || '').trim() || undefined }); d2.zu(); toast(betrag ? 'Rechnungsbetrag erfasst.' : 'Menge erfasst.'); await neu(); mengenDialog(p.id); }
        catch (x) { err.hidden = false; err.textContent = x.message; }
      });
    }
    // E-01: Bestätigen ändert nur das Prüf-Kennzeichen – die Zuordnung (quelle) bleibt unangetastet
    const qOk = $('#q-ok', d2.el);
    if (qOk) qOk.addEventListener('click', async () => { qOk.disabled = true; if (await aendere(finde(p.id) || p, { zuordnungPruefen: false }, 'Zuordnung bestätigt.')) d2.zu(); else qOk.disabled = false; });
    const qf = $('#qf', d2.el);
    if (qf) {
      if (qf.elements.art) qf.elements.art.addEventListener('change', () => { $('#qf-ref', d2.el).innerHTML = qf.elements.art.value ? refs(qf.elements.art.value) : ''; });
      qf.addEventListener('submit', async (e) => {
        e.preventDefault(); const f = new FormData(qf);
        const body = {};
        if (qf.elements.art) {
          const gewaehlt = f.getAll('ref').map(String);
          if (f.get('art') && !gewaehlt.length) { toast('Bitte auswählen, woher die Menge kommt.', 'warn'); return; }
          const faktor = String(f.get('faktor') || '').trim() ? parseZahl(f.get('faktor')) : null;
          if (faktor !== null && !(faktor > 0)) { toast('Umrechnungsfaktor unklar – bitte z. B. 1,8 schreiben.', 'warn'); return; }
          const neuQ = f.get('art') ? { art: f.get('art'), ref: gewaehlt, ...(faktor ? { faktor } : {}) } : null;
          const gleich = (!neuQ && !q.art) || (neuQ && q.art === neuQ.art && [...qRefs].sort().join('|') === [...gewaehlt].sort().join('|') && (q.faktor ?? null) === (neuQ.faktor ?? null));
          if (!gleich) {
            // Eine bestehende Zuordnung wird nie stillschweigend entfernt
            if (!neuQ && !(await bestaetigen('Automatische Menge entfernen?', `„${p.bezeichnung}“ bekommt dann keine Mengen mehr aus den Bautagesberichten. Händische Einträge bleiben.`, 'Zuordnung entfernen', 'danger'))) return;
            body.quelle = neuQ;
          }
        }
        if (qf.elements.naturmaterial && qf.elements.naturmaterial.checked !== !!p.naturmaterial) body.naturmaterial = qf.elements.naturmaterial.checked;
        if (!Object.keys(body).length) { toast('Keine Änderung – zum Bestätigen bitte „Zuordnung bestätigen“ verwenden.', 'warn'); return; }
        if (await aendere(finde(p.id) || p, body, 'Änderung gespeichert.')) d2.zu();
      });
    }
    d2.el.addEventListener('click', async (e) => {
      const s = e.target.closest('[data-storno]'); if (!s) return;
      if (!(await bestaetigen('Eintrag stornieren?', 'Der Eintrag wird herausgerechnet; der Vorgang wird protokolliert.', 'Stornieren', 'danger'))) return;
      try { await del(`/baustellen/${id}/positionen/${p.id}/mengen/${s.dataset.storno}`); d2.zu(); toast('Eintrag storniert.'); await neu(); mengenDialog(p.id); } catch (x) { toast(x.message, 'warn'); }
    });
  }

  function mehrDialog(pid) {
    const p = finde(pid); if (!p) return;
    const d2 = dialog({ titel: p.bezeichnung, inhalt: `<div class="menu-list flach">
      <button type="button" data-m="mengen">${ic('table')}<span>Mengen und Zuordnung</span>${ic('right')}</button>
      <button type="button" data-m="aktiv">${ic(p.aktiv === false ? 'check' : 'minus')}<span>${p.aktiv === false ? 'Wieder einblenden' : 'Ausblenden (bleibt erhalten)'}</span>${ic('right')}</button>
      <button type="button" data-m="loeschen">${ic('trash')}<span>Löschen (nur ohne Mengen)</span>${ic('right')}</button></div>` });
    d2.el.addEventListener('click', async (e) => {
      const m = e.target.closest('[data-m]'); if (!m) return;
      d2.zu();
      if (m.dataset.m === 'mengen') return mengenDialog(p.id);
      if (m.dataset.m === 'aktiv') return aendere(p, { aktiv: p.aktiv === false }, p.aktiv === false ? 'Position eingeblendet.' : 'Position ausgeblendet.');
      if (!(await bestaetigen('Position löschen?', `„${p.bezeichnung}“ wird aus diesem Bauvorhaben entfernt. Die Firmenvorlage bleibt unverändert.`, 'Löschen', 'danger'))) return;
      try { await del(`/baustellen/${id}/positionen/${p.id}`); toast('Position gelöscht.'); neu(); }
      catch (x) { toast(x.status === 409 ? `${x.message} Die Position kann stattdessen ausgeblendet werden.` : x.message, 'warn'); }
    });
  }
  function neuDialog(gruppe) {
    const d2 = dialog({ titel: `Eigene Position – ${GRUPPEN[gruppe] || gruppe}`, inhalt: `<form id="pf" class="form-grid" novalidate>
      <label class="field full"><span class="field-label">Bezeichnung</span><input class="input lg" name="bezeichnung" required maxlength="200"></label>
      <label class="field"><span class="field-label">Einheit</span><input class="input lg" name="einheit" required maxlength="12" placeholder="z. B. Std., t, m², Stk, PA" list="eh-liste"><datalist id="eh-liste">${['Std.', 't', 'm³', 'm2', 'Stk', 'lfm', 'PA', 'VE'].map((x) => `<option value="${x}">`).join('')}</datalist></label>
      <label class="field"><span class="field-label">Einheitspreis (€) bzw. Faktor</span><input class="input lg num" name="ep" inputmode="decimal" required placeholder="0,00"></label>
      <p class="muted sm full">Die Position gilt nur für dieses Bauvorhaben. Bei Einheit PA oder VE ist der Preis ein Aufschlagsfaktor (z. B. 1,15).</p>
      <p class="form-err full" role="alert" hidden></p></form>`, fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="pf">Position anlegen</button>' });
    $('#pf', d2.el).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target); const err = $('.form-err', d2.el); const ep = parseZahl(f.get('ep'));
      if (!String(f.get('bezeichnung')).trim() || !String(f.get('einheit')).trim()) { err.hidden = false; err.textContent = 'Bitte Bezeichnung und Einheit eintragen.'; return; }
      if (!Number.isFinite(ep) || ep < 0) { err.hidden = false; err.textContent = 'Preis unklar – bitte so schreiben: 1.250,00'; return; }
      try { await post(`/baustellen/${id}/positionen`, { gruppe, bezeichnung: String(f.get('bezeichnung')).trim(), einheit: String(f.get('einheit')).trim(), ep }); d2.zu(); toast('Position angelegt.'); nurMitMenge = false; neu(); }
      catch (x) { err.hidden = false; err.textContent = x.message; }
    });
  }
  /* ---- Aus Vorlage übernehmen (mit Vorschau) ---- */
  function vorlageDialog() {
    const d2 = dialog({ titel: 'Aus Vorlage übernehmen', breit: true, inhalt: `<div class="stack-s" id="vorlage">
      <fieldset class="field"><legend class="field-label">Was soll übernommen werden?</legend>
        <label class="check-inline"><input type="radio" name="modus" value="fehlende" checked> Fehlende Positionen ergänzen (bestehende bleiben unverändert)</label>
        <label class="check-inline"><input type="radio" name="modus" value="preise"> Preise aus der Vorlage übernehmen (überschreibt die EP dieses Bauvorhabens)</label></fieldset>
      <button type="button" class="btn ghost" id="vl-vorschau">${ic('table')}Vorschau anzeigen</button>
      <div id="vl-ergebnis" aria-live="polite"></div></div>`,
      fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="button" id="vl-ok" disabled>Übernehmen</button>' });
    const modus = () => $('input[name="modus"]:checked', d2.el).value;
    let gezeigt = '';
    const liste = (r) => {
      const z = r.positionen || r.aenderungen || r.neu || r.geaendert || [];
      const n = typeof r.anzahl === 'number' ? r.anzahl : Array.isArray(z) ? z.length : 0;
      return { n, html: Array.isArray(z) && z.length ? `<div class="tbl-wrap vl-liste"><table class="tbl"><thead><tr><th>Position</th><th class="r">bisher</th><th class="r">Vorlage</th></tr></thead><tbody>${z.slice(0, 200).map((x) => `<tr><td>${esc(x.bezeichnung || '')} <small class="muted">${esc(x.einheit || '')}</small></td><td class="r num">${x.epAlt != null ? fmt.eur(x.epAlt) : x.alt != null ? fmt.eur(x.alt) : '–'}</td><td class="r num">${fmt.eur(x.epNeu ?? x.neu ?? x.ep)}</td></tr>`).join('')}</tbody></table></div>` : '' };
    };
    $('#vl-vorschau', d2.el).addEventListener('click', async () => {
      const box = $('#vl-ergebnis', d2.el);
      try {
        const r = await post(`/baustellen/${id}/positionen/aus-vorlage`, { modus: modus(), vorschau: true });
        const l = liste(r); gezeigt = modus();
        box.innerHTML = `<p data-vorschau="${l.n}"><b>${l.n}</b> ${modus() === 'fehlende' ? (l.n === 1 ? 'Position würde ergänzt.' : 'Positionen würden ergänzt.') : (l.n === 1 ? 'Preis würde geändert.' : 'Preise würden geändert.')}</p>${l.html}`;
        $('#vl-ok', d2.el).disabled = l.n === 0;
      } catch (x) { box.innerHTML = `<p class="form-err">${esc(x.message)}</p>`; }
    });
    d2.el.addEventListener('change', (e) => { if (e.target.name === 'modus') { $('#vl-ok', d2.el).disabled = true; $('#vl-ergebnis', d2.el).innerHTML = ''; } });
    $('#vl-ok', d2.el).addEventListener('click', async () => {
      if (gezeigt !== modus()) return;
      try { await post(`/baustellen/${id}/positionen/aus-vorlage`, { modus: modus() }); d2.zu(); toast(modus() === 'fehlende' ? 'Fehlende Positionen ergänzt.' : 'Preise aus der Vorlage übernommen.'); neu(); }
      catch (x) { toast(x.message, 'warn'); }
    });
  }

  el.addEventListener('toggle', (e) => {
    const g = e.target.closest && e.target.closest('details.pg'); if (!g) return;
    if (g.open) zu.delete(g.dataset.gruppe); else zu.add(g.dataset.gruppe);
    speicher.setz('bt_pos_zu', [...zu]);
  }, true);
  el.addEventListener('click', async (e) => {
    const n = e.target.closest('[data-neu]'); if (n) return neuDialog(n.dataset.neu);
    const a = e.target.closest('[data-akt]'); if (!a) return;
    if (a.dataset.akt === 'vorlage') return vorlageDialog();
    const row = a.closest('[data-pos]'); if (!row) return;
    const pid = row.dataset.pos;
    if (a.dataset.akt === 'mengen') return mengenDialog(pid);
    if (a.dataset.akt === 'mehr') return mehrDialog(pid);
    if (a.dataset.akt === 'hoch' || a.dataset.akt === 'runter') {
      // Reihenfolge innerhalb der Gruppe tauschen
      const p = finde(pid); const g = d.gruppen.find((x) => x.schluessel === p.gruppe);
      const liste = (g.positionen || []).filter(sichtbar); const i = liste.findIndex((x) => String(x.id) === String(pid));
      const nachbar = liste[i + (a.dataset.akt === 'hoch' ? -1 : 1)]; if (!nachbar) return;
      const sA = p.sortierung ?? i * 10, sB = nachbar.sortierung ?? (i + (a.dataset.akt === 'hoch' ? -1 : 1)) * 10;
      try {
        await put(`/baustellen/${id}/positionen/${p.id}`, { version: p.version, sortierung: sB === sA ? sB + (a.dataset.akt === 'hoch' ? -1 : 1) : sB });
        await put(`/baustellen/${id}/positionen/${nachbar.id}`, { version: nachbar.version, sortierung: sA });
      } catch (x) { toast(x.message, 'warn'); }
      neu();
    }
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('.pt-in, .price-in input')) e.target.blur(); });
  el.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'f-menge') { nurMitMenge = t.checked; speicher.setz('bt_pos_nurmenge', nurMitMenge); zeichne(); return; }
    if (t.id === 'f-aus') { mitAusgeblendeten = t.checked; zeichne(); return; }
    const row = t.closest('[data-pos]'); if (!row || !t.dataset.feld) return;
    const p = finde(row.dataset.pos); const feld = t.dataset.feld;
    if (feld === 'ep') {
      const wert = parseZahl(t.value);
      const box = t.closest('.price-in');
      if (!Number.isFinite(wert) || wert < 0) { box.classList.add('invalid'); t.setAttribute('aria-invalid', 'true'); toast(`„${t.value}“ ist als Preis unklar – bitte so schreiben: 1.250,00`, 'warn'); return; }
      box.classList.remove('invalid'); t.removeAttribute('aria-invalid');
      if (wert === p.ep) { t.value = fmt.betrag(p.ep); return; }
      if (!(await starkOk(p.ep, wert, `Der Preis „${p.bezeichnung}“`))) { t.value = fmt.betrag(p.ep); return; }
      await aendere(p, { ep: wert }, 'Preis für dieses Bauvorhaben gespeichert.');
    } else {
      const wert = t.value.trim();
      if (!wert) { t.value = p[feld] || ''; toast('Das Feld darf nicht leer sein.', 'warn'); return; }
      if (wert === (p[feld] || '')) return;
      await aendere(p, { [feld]: wert }, feld === 'bezeichnung' ? 'Bezeichnung gespeichert.' : 'Einheit gespeichert.');
    }
  });
  zeichne();
}
