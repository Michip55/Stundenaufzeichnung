// Übersicht (API.md 15.20, Inhaber 17.11.2026): ruhig, oben nur, was jetzt jemanden braucht.
// Reihenfolge: Datum · „N Punkte brauchen Sie“ – Einteilung für morgen (nur Planer) – Heute – Zur Freigabe – Rechnungen.
// Ab 720 px zwei Spalten, die unabhängig voneinander wachsen (links Heute + Rechnungen, rechts Zur Freigabe + Einteilung) – keine
// Lücke unter „Heute“, wenn „Zur Freigabe“ länger ist (Prüfbefund n8-g). Am Handy eine Spalte in der obigen Reihenfolge (CSS order).
// Farbe nur für Handlungsbedarf (rot: Freigaben, Überfälliges; gelb: Warnungen). Zeilen sind ganze, tippbare Flächen.
// Die bisherige Übersicht liegt unverändert in dashboard-klassisch.js – umschaltbar unter „Mehr“ (je Gerät, bis zum Abmelden).
import { get, post } from '../api.js';
import { ic, esc, fmt, avatar, speicher, toast, bestaetigen, dialog, $, $$ } from '../ui.js';
import { wienHeute, wienLokal } from '../zahl.js';
import { feiertage, naechsterArbeitstag, tagName } from '../arbeitstag.js';
import { warnText } from './stempeln.js';
import klassisch from './dashboard-klassisch.js';

export const KLASSISCH = 'bt_uebersicht_klassisch';
export const klassischAn = () => speicher.lies(KLASSISCH, false) === true;

// Jede Anfrage für sich: fehlt ein Recht oder die Verbindung, fehlt nur dieser Teil
async function teil(fn) { try { return { ok: true, daten: await fn() }; } catch (e) { return { ok: false, fehler: e }; } }
const p2 = (n) => String(n).padStart(2, '0');
const tagKurz = (iso) => { const d = fmt.dt(iso); return `${fmt.WTK[d.getDay()]} ${p2(d.getDate())}.${p2(d.getMonth() + 1)}.`; };
const mz = (n, eins, mehr) => (n === 1 ? eins : mehr);

/* ---------- Bausteine ---------- */
const chevron = () => ic('right', 'ue-chev');
// Ganze Zeile als Link: Text links (Titel, Untertitel), Wert rechts, Pfeil
function zeile({ href, titel, sub = '', wert = '', art = '', kpi = '', zahl = null, subArt = '', fett = false }) {
  return `<a class="ue-row${fett ? ' fett' : ''}" href="${href}"${kpi ? ` data-kpi="${kpi}"` : ''}${zahl != null ? ` data-wert="${zahl}"` : ''}>
    <span class="ue-txt"><span class="ue-t">${titel}</span>${sub ? `<span class="ue-sub${subArt ? ' ' + subArt : ''}">${sub}</span>` : ''}</span>
    ${wert !== '' ? `<b class="ue-wert${art ? ' ' + art : ''}">${wert}</b>` : ''}${chevron()}</a>`;
}
const badge = (n, art) => `<span class="ue-badge ${art}">${n}</span>`;
const abschnitt = (id, titel, inhalt, { zahl = null, rot = false, kpi = '', extra = '' } = {}) => `
  <section class="ue-abschnitt" id="${id}" aria-labelledby="${id}-h">
    <h2 class="ue-h" id="${id}-h"${kpi ? ` data-kpi="${kpi}" data-wert="${zahl ?? 0}"` : ''}>${titel}${zahl != null && zahl > 0 ? ` <span class="${rot ? 'rot' : ''}">· ${zahl}</span>` : ''}</h2>
    <div class="ue-karte">${inhalt}</div>${extra}
  </section>`;
const nichtAbrufbar = (was, t) => `<div class="ue-row still" data-fehlt="${esc(was)}"><span class="ue-txt"><span class="ue-t">${esc(was)}</span><span class="ue-sub">${t && t.fehler && t.fehler.status === 403 ? 'Kein Zugriff' : t && t.fehler && t.fehler.netz ? 'Keine Verbindung' : 'derzeit nicht abrufbar'}</span></span></div>`;

export default async function dashboard(el, ctx) {
  if (klassischAn()) return klassisch(el, ctx);
  const heute = wienHeute();
  const jetzt = wienLokal(new Date().toISOString()); // YYYY-MM-DDTHH:MM (Wien)
  const uhrzeit = jetzt.slice(11, 16);
  // Rechte wie bisher (15.4: allein nach Rechten – Bauleiter = Büro); Geld nur mit genau den Rechten der alten Kacheln
  const planer = ctx.kann('stammdaten');
  const darfFrei = ctx.kann('bericht_freigeben');
  const siehtBerichte = darfFrei || ctx.kann('bericht_erstellen');
  const mitKalk = ctx.kann('kalk_sehen'), mitLohn = ctx.kann('lohn'), mitPosten = ctx.kann('preise_sehen');

  // Zieltag wie im Planer (G-05): nächster Arbeitstag – am Freitag der Montag, vor einem Feiertag der Tag danach
  const ziel = planer ? naechsterArbeitstag(heute, await feiertage(heute)) : null;
  const [bs, anw, offen, entw, kalk, mon, kz, op, alleBs, plan, probe, eing, fae] = await Promise.all([
    teil(() => get('/baustellen')),
    teil(() => get('/zeit/anwesend')),
    siehtBerichte ? teil(() => get('/berichte?status=unterschrieben')) : null,
    siehtBerichte ? teil(() => get('/berichte?status=entwurf')) : null,
    mitKalk ? teil(() => get('/kalkulation')) : null,
    mitLohn ? teil(() => get(`/monat?monat=${heute.slice(0, 7)}`)) : null,
    planer ? teil(() => get('/baustellen-kennzahlen')) : null,
    mitPosten ? teil(() => get('/offene-posten')) : null,
    planer ? teil(() => get('/baustellen?alle=1')) : null,
    planer ? teil(() => get(`/plan/woche?von=${ziel}&tage=5`)) : null,
    // Probelauf wie im Planer (ohne Versand): gibt es etwas zu veröffentlichen – auch Fuhren und „entfällt“?
    planer ? teil(() => post('/plan/veroeffentlichen', { von: ziel, bis: ziel, vorschau: true })) : null,
    planer ? teil(() => get('/zeit/heute-eingeteilt')) : null,
    mitPosten ? teil(() => get('/faelligkeiten')) : null, // 15.24
  ]);
  if (!bs.ok && (bs.fehler.netz || bs.fehler.status === 401)) throw bs.fehler;
  const baustellen = bs.ok ? bs.daten : [];
  const bsName = (id) => { const b = baustellen.find((x) => x.id === id); return b ? b.kurz || b.name : ''; };

  /* ---------- Einteilung für morgen ---------- */
  let planInfo = null;
  if (planer && plan.ok) {
    const d = plan.daten;
    const tagE = (d.einsaetze || []).filter((e) => e.datum === ziel);
    const t = (d.tage || []).find((x) => x.datum === ziel) || {};
    const pr = probe && probe.ok ? probe.daten : null;
    const empf = pr ? pr.empfaenger || [] : [];
    const entfaellt = empf.filter((x) => x.art === 'entfaellt').length;
    const offenE = tagE.filter((e) => e.vorschau || !e.veroeffentlicht || e.geaendertNachVeroeffentlichung);
    const etwas = offenE.length > 0 || (pr ? (pr.anzahl ?? empf.length) > 0 : false);
    const veroeff = tagE.some((e) => e.veroeffentlicht) || entfaellt > 0;
    const zustand = !tagE.length && !etwas ? 'leer' : etwas ? (veroeff ? 'geaendert' : 'offen') : 'veroeffentlicht';
    const kzTag = (d.kennzahlen || {})[ziel] || null;
    const aend = tagE.filter((e) => !e.vorschau && e.veroeffentlicht && e.geaendertNachVeroeffentlichung).length + tagE.filter((e) => !e.vorschau && !e.veroeffentlicht).length;
    const pubZeit = t.veroeffentlichtUm || tagE.map((e) => e.veroeffentlichtUm || '').filter(Boolean).sort().pop() || '';
    const seit = pubZeit ? (wienLokal(pubZeit).slice(0, 10) === heute ? `seit ${fmt.uhr(wienLokal(pubZeit).slice(11, 16))}` : `seit ${tagKurz(wienLokal(pubZeit).slice(0, 10))}`) : '';
    const fenster = uhrzeit >= '16:00' && uhrzeit < '17:30'; // Einteilen am Nachmittag für morgen
    const handeln = zustand === 'offen' || zustand === 'geaendert';
    planInfo = { zustand, etwas, kzTag, aend, seit, vorschau: !!t.vorschau, oben: handeln || fenster, amber: handeln || (fenster && zustand !== 'veroeffentlicht') };
  }
  const zielName = ziel ? tagName(ziel, heute) : '';
  const zielWort = zielName === 'morgen' ? 'morgen' : ziel ? fmt.WT[fmt.dt(ziel).getDay()] : '';
  function planKarte() {
    if (!planer) return '';
    const zum = `#/plan?ansicht=tag&datum=${ziel}`;
    if (!plan.ok) return `<section class="ue-plan kompakt" id="ue-plan" data-zustand="fehler"><div class="ue-karte">${nichtAbrufbar(`Einteilung für ${zielWort}`, plan)}</div></section>`;
    const p = planInfo;
    const STAND = { veroeffentlicht: ['veröffentlicht', 'gruen'], geaendert: ['Änderungen offen', 'amber'], offen: ['nicht veröffentlicht', 'amber'], leer: ['noch leer', 'grau'] };
    const [stText, stArt] = STAND[p.zustand];
    const teile = [tagKurz(ziel)];
    if (p.kzTag && p.kzTag.gesamt) teile.push(`${p.kzTag.eingeteilt} von ${p.kzTag.gesamt} eingeteilt`);
    if (p.zustand === 'geaendert') teile.push(`${p.aend ? `${p.aend} ${mz(p.aend, 'Änderung', 'Änderungen')}` : 'Änderungen'}${p.seit ? ' ' + p.seit : ''}`);
    else if (p.zustand === 'offen' && p.vorschau) teile.push('wie Vortag vorbereitet');
    else if (p.zustand === 'veroeffentlicht' && p.seit) teile.push(`veröffentlicht ${p.seit.replace(/^seit /, 'um ').replace(/^um ([A-Z])/, 'am $1')}`);
    const kopf = `<span class="ue-plan-kopf">${ic('board')}<b>Einteilung für ${esc(zielWort)}</b><span class="ue-stand ${stArt}" data-stand="${p.zustand}">${stText}</span></span>`;
    if (!p.oben) {
      return `<section class="ue-plan kompakt" id="ue-plan" data-zustand="${p.zustand}" data-oben="0" aria-label="Einteilung für ${esc(zielWort)}"><a class="ue-karte ue-plan-zeile" href="${zum}" id="ue-zum-planer">${kopf}<span class="ue-sub">${esc(teile.join(' · '))}</span>${chevron()}</a></section>`;
    }
    return `<section class="ue-plan${p.amber ? ' amber' : ''}" id="ue-plan" data-zustand="${p.zustand}" data-oben="1" aria-label="Einteilung für ${esc(zielWort)}"><div class="ue-karte">
      ${kopf}<span class="ue-sub">${esc(teile.join(' · '))}</span>
      <span class="ue-plan-knoepfe">${p.etwas ? `<a class="btn primary" id="ue-pub" href="${zum}&veroeffentlichen=1">Veröffentlichen</a>` : ''}<a class="btn ghost" id="ue-zum-planer" href="${zum}">Zum Planer</a></span>
    </div></section>`;
  }

  /* ---------- Heute ---------- */
  const anwesend = anw.ok ? (Array.isArray(anw.daten) ? anw.daten : anw.daten.anwesend || []) : [];
  const pause = anwesend.filter((a) => a.status === 'pause').length;
  const eingeteilt = eing && eing.ok ? eing.daten.eingeteilt || [] : null;
  const gestempelt = eing && eing.ok ? new Set([...(eing.daten.gestempelt || []), ...anwesend.map((a) => a.benutzerId)]) : null;
  // „fehlen noch“: laut veröffentlichtem Plan heute eingeteilt, Beginn erreicht (falls angegeben), heute noch nicht gestempelt
  const fehlen = eingeteilt && gestempelt ? eingeteilt.filter((p) => !gestempelt.has(p.benutzerId) && (!p.beginn || p.beginn <= uhrzeit)) : [];
  const warnungen = mon && mon.ok ? mon.daten.warnungen || [] : [];
  function heuteHtml() {
    const subs = [];
    if (anw.ok && pause) subs.push(`${pause} in Pause`);
    if (fehlen.length) subs.push(`<span class="amber-t">${fehlen.length} ${mz(fehlen.length, 'Eingeteilter fehlt', 'Eingeteilte fehlen')} noch</span>`);
    const wert = anw.ok ? `${anwesend.length}${eingeteilt && eingeteilt.length ? ` <small>/ ${eingeteilt.length}</small>` : ''}` : '–';
    const liste = `<div class="ue-liste" id="anwesend-karte" hidden>
      ${!anw.ok ? nichtAbrufbar('Eingestempelt', anw) : anwesend.length ? `<ul class="plain rows">${anwesend.map((a) => `<li>${avatar(a.name, 'sm ' + (a.status === 'pause' ? 'pause' : 'on'))}<span class="grow"><b>${esc(a.name)}</b><small>${esc(a.baustelleName || (a.baustelle && a.baustelle.name) || bsName(a.baustelleId))}</small></span><span class="chip xs ${a.status === 'pause' ? 'st-amber' : 'st-green'}">${a.status === 'pause' ? (a.pauseBis ? 'Pause bis ' + fmt.uhr(a.pauseBis) : 'Pause') : 'Arbeit'}</span><span class="muted sm nw">seit ${fmt.uhr(a.seit)}</span></li>`).join('')}</ul>` : '<p class="ue-leer">Derzeit ist niemand eingestempelt.</p>'}
      ${fehlen.length ? `<h3 class="ue-h3">Noch nicht gestempelt</h3><ul class="plain rows" id="ue-fehlen">${fehlen.map((p) => `<li data-fehlt-person="${p.benutzerId}">${avatar(p.name, 'sm off')}<span class="grow"><b>${esc(p.name)}</b><small>${esc(p.baustelle || bsName(p.baustelleId))}${p.beginn ? ` · Beginn ${esc(p.beginn)}` : ''}</small></span></li>`).join('')}</ul>` : ''}
    </div>`;
    const anwZeile = `<button type="button" class="ue-row" data-kpi="anwesend" data-wert="${anwesend.length}" aria-expanded="false" aria-controls="anwesend-karte">
      <span class="ue-txt"><span class="ue-t">Eingestempelt</span>${subs.length ? `<span class="ue-sub">${subs.join(' · ')}</span>` : ''}</span><b class="ue-wert">${wert}</b>${ic('down', 'ue-chev ue-auf')}</button>`;
    let warn = '';
    if (mon && !mon.ok) warn = nichtAbrufbar('Arbeitszeit-Warnungen', mon);
    else if (warnungen.length) {
      const w = warnungen[0];
      const wer = w && typeof w === 'object' && w.name ? `${w.name} · ` : '';
      warn = zeile({ href: '#/monat', titel: mz(warnungen.length, 'Arbeitszeit-Warnung', 'Arbeitszeit-Warnungen'), sub: esc(`${wer}${warnText(w)}${warnungen.length > 1 ? ` · und ${warnungen.length - 1} weitere` : ''}`), wert: badge(warnungen.length, 'amber'), kpi: 'warnungen', zahl: warnungen.length, fett: true });
    }
    return abschnitt('ue-heute', 'Heute', anwZeile + liste + warn);
  }

  /* ---------- Zur Freigabe ---------- */
  const warten = offen && offen.ok ? offen.daten : [];
  const freigebbar = darfFrei ? warten.filter((b) => !b.freigabeVierAugen) : [];
  function freigabeHtml() {
    if (!siehtBerichte) return '';
    const MAX = 6;
    const zeileB = (b) => {
      const sub = [fmt.datumKurz(b.datum).replace(',', ''), b.polierName, b.personalAnzahl != null ? `${b.personalAnzahl} Pers.` : ''].filter(Boolean).join(' · ');
      const hinweis = b.geaendertNachUnterschrift ? '<span class="ue-sub amber-t">nach Unterschrift geändert – bitte prüfen</span>' : darfFrei && b.freigabeVierAugen ? '<span class="ue-sub">gibt eine zweite Person frei (Vier-Augen-Prinzip)</span>' : '';
      const knopf = darfFrei && !b.freigabeVierAugen && !b.geaendertNachUnterschrift;
      return `<div class="ue-row ue-frei" data-bericht-zeile="${b.id}"><a class="ue-txt" href="#/bericht/${b.id}"><span class="ue-t">${esc(b.baustelle || 'Baustelle')}</span><span class="ue-sub">${esc(sub)}</span>${hinweis}</a>${knopf ? `<button type="button" class="ue-ok-btn" data-freigeben="${b.id}" aria-label="Bericht ${esc(b.baustelle || '')} vom ${esc(fmt.datum(b.datum))} freigeben">Freigeben</button>` : `<a class="ue-pfeil" href="#/bericht/${b.id}" aria-label="Bericht öffnen">${chevron()}</a>`}</div>`;
    };
    const nEntw = entw && entw.ok ? entw.daten.length : 0;
    const inhalt = !offen.ok ? nichtAbrufbar('Berichte zur Freigabe', offen)
      : `${warten.length ? warten.slice(0, MAX).map(zeileB).join('') : `<div class="ue-row still"><span class="ue-txt"><span class="ue-t muted">${darfFrei ? 'Keine Berichte warten auf Freigabe.' : 'Keine unterschriebenen Berichte.'}</span></span></div>`}
        ${warten.length > MAX ? zeile({ href: '#/berichte?status=unterschrieben', titel: `und ${warten.length - MAX} weitere` }) : ''}
        ${zeile({ href: '#/berichte', titel: '<span class="muted">Alle Berichte</span>', wert: nEntw ? `<small>${nEntw} im Entwurf</small>` : '', kpi: 'entwurf', zahl: nEntw })}`;
    return abschnitt('ue-freigabe', darfFrei ? 'Zur Freigabe' : 'Unterschriebene Berichte', inhalt, { zahl: offen.ok ? warten.length : 0, rot: darfFrei && freigebbar.length > 0, kpi: 'freigabe' });
  }

  /* ---------- Geld (nur mit den Rechten der bisherigen Geld-Kacheln: kalk_sehen, stammdaten, preise_sehen) ---------- */
  const kalkListe = kalk && kalk.ok ? (Array.isArray(kalk.daten) ? kalk.daten : kalk.daten.baustellen || []) : [];
  const auffaellig = kalkListe.filter((k) => k.status && k.status !== 'ok');
  const bald = fmt.addTage(heute, 92);
  const gewaehr = alleBs && alleBs.ok ? alleBs.daten.filter((b) => b.gewaehrleistungBis && b.gewaehrleistungBis >= heute && b.gewaehrleistungBis <= bald) : [];
  const ueberfaellig = op && op.ok ? op.daten.anzahlUeberfaellig || 0 : 0;
  function geldHtml() {
    if (!kalk && !kz && !op) return '';
    const zeilen = [], gut = [];
    let offenText = '';
    const gutSpan = (kpi, text) => `<span data-kpi="${kpi}" data-wert="0">${text}</span>`;
    if (op) {
      if (!op.ok) zeilen.push(nichtAbrufbar('Offene Posten', op));
      else {
        const o = op.daten;
        if (o.anzahlUeberfaellig) {
          const ue = (o.posten || []).filter((x) => x.status === 'ueberfaellig');
          const wer = (o.jeAuftraggeber || []).filter((a) => a.ueberfaellig > 0).map((a) => a.auftraggeber);
          const tage = ue.reduce((m, x) => Math.max(m, x.ueberfaelligTage || 0), 0);
          const sub = [`${o.anzahlUeberfaellig} ${mz(o.anzahlUeberfaellig, 'Rechnung', 'Rechnungen')}`, wer.length ? wer.slice(0, 2).join(', ') + (wer.length > 2 ? ` und ${wer.length - 2} weitere` : '') : '', tage ? `${ue.length > 1 ? 'bis ' : ''}${tage} ${mz(tage, 'Tag', 'Tage')}` : ''].filter(Boolean).join(' · ');
          zeilen.push(zeile({ href: '#/offene-posten', titel: 'Überfällig', sub: esc(sub), wert: esc(fmt.eur0(o.summeUeberfaellig)), art: 'rot', kpi: 'ueberfaellig', zahl: o.anzahlUeberfaellig, fett: true }));
        }
        const rest = Math.round(((o.summeOffen || 0) - (o.summeUeberfaellig || 0)) * 100) / 100;
        // 15.24: „Rechnungen“ statt „Offene Posten“/„Schlussrechnungen“, wo Rechnungen allgemein gemeint sind
        if (rest > 0) offenText = `<span data-kpi="offene-posten" data-wert="${o.anzahlOffen ?? 0}">${o.anzahlUeberfaellig ? 'Weitere offene Rechnungen' : 'Offene Rechnungen'} ${esc(fmt.eur0(rest))} im Rahmen</span>`;
        else if (!o.anzahlUeberfaellig) gut.push(gutSpan('offene-posten', 'Rechnungen'));
      }
      // 15.24: „Offen gesamt“ (offene Zahlbeträge + einbehaltene Rücklässe) mit Aufteilung – führt zu den Fälligkeiten
      // (mit Skonto und ohne); ersetzt dann die ruhige Zeile „Offene Rechnungen … im Rahmen“
      if (fae && fae.ok && fae.daten.offenGesamt) {
        const og = fae.daten.offenGesamt;
        const dw = (fae.daten.gruppen || []).find((x) => x.schluessel === 'diese_woche') || { anzahl: 0 };
        const sub = og.betrag ? [og.ueberfaellig ? `davon überfällig ${esc(fmt.eur0(og.ueberfaellig))}` : '', `in 7 Tagen fällig ${esc(fmt.eur0(og.naechste7Tage))}`, og.ruecklaesse ? `Rücklässe ${esc(fmt.eur0(og.ruecklaesse))}` : '', og.strittig ? `strittig ${esc(fmt.eur0(og.strittig))}` : ''].filter(Boolean).join(' · ') : 'nichts offen';
        offenText = '';
        zeilen.push(zeile({ href: '#/faelligkeiten', titel: 'Offen gesamt', sub, wert: esc(fmt.eur0(og.betrag)), kpi: 'faelligkeiten', zahl: dw.anzahl }).replace('<a class="ue-row"', `<a class="ue-row" data-offen-gesamt="${og.betrag}"`));
      } else if (fae) zeilen.push(nichtAbrufbar('Fälligkeiten', fae));
    }
    if (kalk) {
      if (!kalk.ok) zeilen.push(nichtAbrufbar('Budget', kalk));
      else if (auffaellig.length) {
        const krit = auffaellig.filter((k) => k.status === 'kritisch').length;
        const namen = auffaellig.slice(0, 2).map((k) => { const b = k.baustelle || k; return `${b.kurz || b.name || ''}${k.budgetVerbrauchProzent != null ? ` ${fmt.pct(k.budgetVerbrauchProzent)}` : ''}`; });
        zeilen.push(zeile({ href: '#/kalkulation', titel: mz(auffaellig.length, 'Budget-Warnung', 'Budget-Warnungen'), sub: esc(namen.join(', ') + (auffaellig.length > 2 ? ` und ${auffaellig.length - 2} weitere` : '') + (krit ? ` · ${krit} kritisch` : '')), wert: badge(auffaellig.length, 'amber'), kpi: 'budget', zahl: auffaellig.length }));
      } else gut.push(gutSpan('budget', 'Budget'));
    }
    if (planer) {
      if (alleBs && !alleBs.ok) zeilen.push(nichtAbrufbar('Gewährleistung', alleBs));
      else if (gewaehr.length) zeilen.push(zeile({ href: '#/baustellen/archiv', titel: 'Gewährleistung läuft ab', sub: esc(gewaehr.slice(0, 2).map((b) => `${b.kurz || b.name} (${fmt.datum(b.gewaehrleistungBis)})`).join(', ') + (gewaehr.length > 2 ? ` und ${gewaehr.length - 2} weitere` : '')), wert: String(gewaehr.length), kpi: 'gewaehrleistung', zahl: gewaehr.length }));
      else gut.push(gutSpan('gewaehrleistung', 'Gewährleistung'));
    }
    if (kz) {
      if (!kz.ok) zeilen.push(nichtAbrufbar('Kennzahlen der Bauvorhaben', kz));
      else {
        const k = kz.daten, sr = k.offeneSchlussrechnungen || { anzahl: 0 }, ohne = k.abnahmeOhneSchlussrechnung || 0;
        // 15.24: Mit Preisrecht stehen offene Rechnungen jeder Art oben (Überfällig, „Offene Rechnungen … im Rahmen“, Fälligkeiten) –
        // die Phase „Schlussrechnung“ zählt dann nur noch, wo eine Schlussrechnung gelegt, aber nicht erfasst ist.
        // Ohne Preisrecht (nur stammdaten) bleibt die Zahl der Bauvorhaben in der Phase „Schlussrechnung“.
        if (mitPosten && sr.summe != null) {
          const nE = sr.ohneRechnung ? sr.ohneRechnung.anzahl : 0;
          if (nE) zeilen.push(zeile({ href: '#/baustellen?phase=schlussrechnung', titel: 'Schlussrechnung nicht erfasst', sub: esc(`${nE} ${mz(nE, 'Bauvorhaben', 'Bauvorhaben')} in „Schlussrechnung“ ohne erfasste Rechnung`), wert: String(nE), kpi: 'schlussrechnung-nicht-erfasst', zahl: nE }));
        } else if (sr.anzahl) zeilen.push(zeile({ href: '#/baustellen?phase=schlussrechnung', titel: mz(sr.anzahl, 'Bauvorhaben in Schlussrechnung', 'Bauvorhaben in Schlussrechnung'), sub: 'gelegt, noch nicht bezahlt', wert: String(sr.anzahl), kpi: 'schlussrechnungen', zahl: sr.anzahl }));
        // „Abnahme ohne Schlussrechnung“ ist eine Regel genau zur Schlussrechnung (12.15) – Wortlaut bleibt
        if (ohne) zeilen.push(zeile({ href: '#/baustellen?phase=abgenommen', titel: 'Schlussrechnung fehlt', sub: 'abgenommen, noch keine Schlussrechnung', wert: String(ohne), kpi: 'abnahme-ohne-rechnung', zahl: ohne }));
        else zeilen.push('<span data-kpi="abnahme-ohne-rechnung" data-wert="0" hidden></span>');
        if (!(mitPosten && sr.summe != null) && !sr.anzahl) gut.push(gutSpan('schlussrechnungen', 'Schlussrechnungen'));
        if (k.fertigmeldungenOffen) zeilen.push(zeile({ href: '#/baustellen', titel: mz(k.fertigmeldungenOffen, 'Fertigmeldung offen', 'Fertigmeldungen offen'), sub: 'vom Polier gemeldet', wert: String(k.fertigmeldungenOffen), kpi: 'fertigmeldungen', zahl: k.fertigmeldungenOffen }));
      }
    }
    // Alles, was passt, in EINER ruhigen Zeile
    const gutText = gut.length ? gut.reduce((a, x, i) => a + (i === 0 ? '' : i === gut.length - 1 ? ' und ' : ', ') + x, '') : '';
    const okZeile = offenText || gutText ? `<div class="ue-ok-zeile" id="ue-geld-ok">${ic('check')}<span>${offenText}${offenText && gutText ? ' · ' : ''}${gutText} – <b>in Ordnung</b></span></div>` : '';
    return abschnitt('bv-kacheln', op || kalk ? 'Rechnungen' : 'Bauvorhaben', zeilen.join('') + okZeile);
  }

  /* ---------- Kopfzeile: Datum, Uhrzeit, wie viel wartet ---------- */
  const punkte = (planInfo && planInfo.amber ? 1 : 0) + freigebbar.length + warnungen.length + ueberfaellig;
  const dHeute = fmt.dt(heute);
  const datumText = `${fmt.WT[dHeute.getDay()]}, ${dHeute.getDate()}. ${fmt.MON[dHeute.getMonth()]}, ${uhrzeit}`;
  const kopf = punkte
    ? `<p class="ue-kopf" id="ue-kopf" data-punkte="${punkte}">${esc(datumText)} · <b>${punkte} ${mz(punkte, 'Punkt braucht Sie', 'Punkte brauchen Sie')}</b></p>`
    : `<p class="ue-kopf" id="ue-kopf" data-punkte="0">${esc(datumText)}</p><div class="ue-erledigt" id="ue-erledigt" role="status">${ic('check')}<span>Alles erledigt – nichts wartet auf Sie.</span></div>`;

  const oben = planInfo && planInfo.oben;
  const spalte = (html) => (html.trim() ? `<div class="ue-spalte">${html}</div>` : '');
  el.innerHTML = `
  <div class="page ue-page" id="ue">
    <div class="ue-voll">${kopf}</div>
    ${oben ? `<div class="ue-voll">${planKarte()}</div>` : ''}
    ${spalte(heuteHtml() + geldHtml())}
    ${spalte(freigabeHtml() + (planer && !oben ? planKarte() : ''))}
  </div>`;

  /* ---------- Bedienung ---------- */
  el.addEventListener('click', async (e) => {
    const auf = e.target.closest('[data-kpi="anwesend"]');
    if (auf) {
      const l = $('#anwesend-karte', el); const offenJetzt = l.hidden;
      l.hidden = !offenJetzt; auf.setAttribute('aria-expanded', String(offenJetzt));
      return;
    }
    const fb = e.target.closest('[data-freigeben]');
    if (fb) {
      const id = Number(fb.dataset.freigeben);
      const b = warten.find((x) => x.id === id) || {};
      // wie im Bericht: Rückfrage, dann POST /berichte/:id/freigeben; Konflikt (inzwischen geändert/freigegeben) → Bericht öffnen
      if (!(await bestaetigen('Bericht freigeben?', `${b.baustelle || 'Bericht'} vom ${fmt.datum(b.datum)}: Der Bericht fließt damit in Nachkalkulation und Monatsauswertung ein.`, 'Freigeben'))) return;
      $$('[data-freigeben]', el).forEach((x) => { x.disabled = true; });
      try {
        await post(`/berichte/${id}/freigeben`);
        toast('Bericht freigegeben.');
        ctx.meldungenNeu();
        if (ctx.aktuell()) ctx.neuLaden();
      } catch (x) {
        $$('[data-freigeben]', el).forEach((k) => { k.disabled = false; });
        if (x.status === 409) { toast(`${x.message} – der Bericht wird geöffnet.`, 'warn'); location.hash = `#/bericht/${id}`; }
        else if (x.status === 403) dialog({ titel: 'Freigabe nicht möglich', inhalt: `<p data-freigabe-abgelehnt>${esc(x.message)}</p><p class="muted sm">Vier-Augen-Prinzip: Wer die Unterschrift des Auftragnehmers erfasst hat, gibt den Bericht nicht selbst frei.</p>`, fuss: '<button class="btn primary" type="button" data-zu>Verstanden</button>' });
        else toast(x.netz ? 'Keine Verbindung zum Server.' : x.message, 'warn');
      }
    }
  });
}
