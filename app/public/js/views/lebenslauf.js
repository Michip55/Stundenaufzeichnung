// Bauvorhaben: Lebenslauf (Phasen), Tafel, Archiv, Gewährleistung & Haftrücklass (API.md 12.15).
// € erscheinen nur, wenn der Server sie mitschickt (schlussrechnung/haftruecklass nur mit preise_sehen).
import { get, post, put } from '../api.js';
import { ic, esc, fmt, geldFelder, geldWert, leer, banner, dialog, toast, entprellt, $ } from '../ui.js';
import { wienHeute } from '../zahl.js';
import { ziehbar } from '../ziehen.js';

export const PHASEN = {
  angebot: ['Angebot', 'st-outline'], geplant: ['Geplant', 'st-blue'], in_arbeit: ['In Arbeit', 'st-green'], pausiert: ['Pausiert', 'st-amber'],
  fertiggestellt: ['Fertiggestellt', 'st-dark'], abgenommen: ['Abgenommen', 'st-dark'], schlussrechnung: ['Schlussrechnung', 'st-orange'],
  bezahlt: ['Bezahlt', 'st-green'], archiviert: ['Archiviert', 'st-grey'], storniert: ['Storniert', 'st-red'],
};
const REIHE = ['geplant', 'in_arbeit', 'fertiggestellt', 'abgenommen', 'schlussrechnung', 'bezahlt', 'archiviert'];
const UEBERGANG = {
  angebot: ['geplant', 'storniert'], geplant: ['in_arbeit', 'pausiert', 'storniert', 'angebot'], in_arbeit: ['fertiggestellt', 'pausiert', 'storniert'], pausiert: ['in_arbeit', 'storniert'],
  fertiggestellt: ['abgenommen', 'in_arbeit'], abgenommen: ['schlussrechnung', 'fertiggestellt'], schlussrechnung: ['bezahlt', 'abgenommen'], bezahlt: ['archiviert', 'schlussrechnung'], storniert: ['archiviert', 'geplant'], archiviert: [],
};
const AUS_STATUS = { geplant: 'geplant', aktiv: 'in_arbeit', abgeschlossen: 'fertiggestellt' };
export const phaseVon = (b) => b.phase || AUS_STATUS[b.status] || 'in_arbeit';
export const phaseText = (p) => (PHASEN[p] || [p || '–'])[0];
export const phaseChip = (p) => `<span class="chip ${(PHASEN[p] || [0, 'st-grey'])[1]}" data-phase="${esc(p)}">${esc(phaseText(p))}</span>`;
const planer = (ctx) => ctx.kann('stammdaten'); // 15.4: wie der Server allein nach dem Recht (Bauleiter = Büro)
const eigen = (ctx, b) => (ctx.ich.baustellenIds || []).map(Number).includes(Number(b.id));
export function ziele(ctx, b) {
  const alle = UEBERGANG[phaseVon(b)] || [];
  if (planer(ctx)) return alle;
  return [];
}
// „Nächster Schritt“ ist nur ein Schritt nach vorne; zurück geht es über „Anderer Status …“
const VOR = { angebot: 'geplant', geplant: 'in_arbeit', in_arbeit: 'fertiggestellt', pausiert: 'in_arbeit', fertiggestellt: 'abgenommen', abgenommen: 'schlussrechnung', schlussrechnung: 'bezahlt', bezahlt: 'archiviert', storniert: 'archiviert' };
export const naechster = (ctx, b) => { const v = VOR[phaseVon(b)]; return ziele(ctx, b).includes(v) ? v : null; };
const plusJahre = (iso, n) => { const d = fmt.dt(iso); d.setFullYear(d.getFullYear() + n); return fmt.iso(d); };
const tageBis = (iso, heute) => Math.round((fmt.dt(iso) - fmt.dt(heute)) / 86400000);
const dateiBase64 = (datei) => new Promise((ok, nein) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => nein(new Error('Datei konnte nicht gelesen werden.')); r.readAsDataURL(datei); });

/* ---------- Dialog „Nächster Schritt“ ---------- */
export function phaseDialog(ctx, b, zielVorwahl, fertig) {
  const moegl = ziele(ctx, b); if (!moegl.length) return;
  const heute = wienHeute();
  const darfBetrag = ctx.kann('preise_bearbeiten');
  const dlg = dialog({ titel: `Status ändern · ${b.kurz || b.name}`, breit: true, inhalt: `<form id="phf" class="form-grid" novalidate>
    <label class="field full"><span class="field-label">Neuer Status</span><select class="input lg" name="phase" id="ph-ziel">${moegl.map((z) => `<option value="${z}" ${z === zielVorwahl ? 'selected' : ''}>${esc(phaseText(phaseVon(b)))} → ${esc(phaseText(z))}</option>`).join('')}</select></label>
    <label class="field"><span class="field-label">Datum</span><input class="input lg" type="date" name="datum" value="${heute}" max="${fmt.addTage(heute, 366)}" required></label>
    <div class="field" data-nur="abgenommen"><label><span class="field-label">Abnahme (Übernahme durch den Auftraggeber) am</span><input class="input lg" type="date" name="abnahmeDatum" value="${heute}"></label></div>
    <div class="field full" data-nur="abgenommen"><label><span class="field-label">Gewährleistung bis</span><input class="input lg" type="date" name="gewaehrleistungBis" value="${plusJahre(heute, 3)}"></label><small class="muted">Vorschlag: Abnahme + 3 Jahre – bitte mit Vertrag / ÖNORM B 2110 prüfen.</small></div>
    <div class="field" data-nur="schlussrechnung"><label><span class="field-label">Schlussrechnung Nr.</span><input class="input lg" name="srNr" maxlength="40"></label></div>
    <div class="field" data-nur="schlussrechnung"><label><span class="field-label">Rechnungsdatum</span><input class="input lg" type="date" name="srDatum" value="${heute}"></label></div>
    ${darfBetrag ? `<div class="field full" data-nur="schlussrechnung"><label><span class="field-label">Rechnungsbetrag in Euro (netto, optional)</span><input class="input lg num" name="srBetrag" data-geld="leer" inputmode="decimal" autocomplete="off" placeholder="0,00"></label></div>` : ''}
    <label class="field full"><span class="field-label">Notiz (optional)</span><textarea class="input lg" name="notiz" rows="2" maxlength="500" aria-describedby="ph-notiz-hinweis"></textarea><small class="muted" id="ph-notiz-hinweis">Die Notiz sehen nur Büro, Bauleiter und Geschäftsführung (mit Preisrecht) – Polier und Mitarbeiter nicht.</small></label>
    <label class="field full"><span class="field-label">Anhänge (optional, z. B. Abnahmeprotokoll)</span><input class="input lg" type="file" name="anhang" multiple accept="application/pdf,image/jpeg,image/png,image/webp"><small class="muted">Werden unter „Dokumente“ dieser Baustelle abgelegt.</small></label>
    <p class="muted sm full" data-nur="archiviert">Archivierte Bauvorhaben bleiben vollständig lesbar, erscheinen aber nicht mehr in der Stempeluhr und bei neuen Berichten.</p>
    <p class="muted sm full" data-nur="storniert">Stornierte Bauvorhaben können nicht mehr bestempelt werden.</p>
    <p class="form-err full" role="alert" hidden></p></form>`,
    fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="phf" id="ph-ok">Status ändern</button>' });
  geldFelder(dlg.el);
  const form = $('#phf', dlg.el);
  const zeig = () => { const z = form.elements.phase.value; dlg.el.querySelectorAll('[data-nur]').forEach((x) => { x.hidden = x.dataset.nur !== z; }); };
  form.elements.phase.addEventListener('change', zeig); zeig();
  form.elements.abnahmeDatum.addEventListener('change', (e) => { if (e.target.value) form.elements.gewaehrleistungBis.value = plusJahre(e.target.value, 3); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(form); const err = $('.form-err', dlg.el); const ziel = f.get('phase');
    const body = { phase: ziel, version: b.version, datum: f.get('datum') || heute };
    const notiz = String(f.get('notiz') || '').trim(); if (notiz) body.notiz = notiz;
    const zeigFehler = (t) => { err.hidden = false; err.textContent = t; };
    if (ziel === 'abgenommen') { if (!f.get('abnahmeDatum')) return zeigFehler('Bitte das Datum der Abnahme eintragen.'); body.abnahmeDatum = f.get('abnahmeDatum'); if (f.get('gewaehrleistungBis')) body.gewaehrleistungBis = f.get('gewaehrleistungBis'); }
    if (ziel === 'schlussrechnung') {
      const nr = String(f.get('srNr') || '').trim();
      if (nr) { body.schlussrechnung = { nr, datum: f.get('srDatum') || heute }; if (darfBetrag) { const bt = geldWert(form.elements.srBetrag); if (Number.isNaN(bt)) return zeigFehler('Betrag unklar – bitte so schreiben: 12.500,00'); if (bt != null) body.schlussrechnung.betrag = bt; } }
    }
    $('#ph-ok', dlg.el).disabled = true;
    try {
      await post(`/baustellen/${b.id}/phase`, body);
      const dateien = [...(form.elements.anhang.files || [])]; let fehlAnh = 0;
      const kat = ziel === 'abgenommen' ? 'abnahmeprotokoll' : ziel === 'schlussrechnung' && darfBetrag ? 'ausgangsrechnungen' : 'schriftverkehr';
      for (const datei of dateien) { try { await post(`/baustellen/${b.id}/dokumente`, { kategorie: kat, titel: datei.name.replace(/\.[^.]+$/, '').slice(0, 200) || 'Anhang', datum: body.datum, dateiBase64: await dateiBase64(datei), dateiname: datei.name }); } catch (x) { fehlAnh += 1; } }
      dlg.zu(); toast(`Status: ${phaseText(ziel)}.${fehlAnh ? ` ${fehlAnh} Anhang${fehlAnh > 1 ? 'e' : ''} konnte${fehlAnh > 1 ? 'n' : ''} nicht abgelegt werden.` : ''}`, fehlAnh ? 'warn' : undefined);
      ctx.meldungenNeu(); if (fertig) fertig(); else ctx.neuLaden();
    } catch (x) { $('#ph-ok', dlg.el).disabled = false; zeigFehler(x.status === 409 && x.daten && x.daten.version != null ? 'Inzwischen von jemand anderem geändert – bitte schließen und neu laden.' : x.message); }
  });
}

/* ---------- Karte im Baustellen-Detail ---------- */
export function lebenslaufHtml(b, ctx, verlauf) {
  const p = phaseVon(b), moegl = ziele(ctx, b), vor = naechster(ctx, b);
  const reihe = p === 'angebot' ? ['angebot', ...REIHE] : REIHE;
  const pos = reihe.indexOf(['pausiert'].includes(p) ? 'in_arbeit' : p);
  const rolle = ctx.ich.benutzer.rolle;
  const darfMelden = rolle === 'polier' && eigen(ctx, b) && p === 'in_arbeit' && !b.fertigmeldung;
  return `<section class="card" id="lebenslauf" aria-labelledby="h-ll" data-phase="${esc(p)}">
    <div class="card-h pad-h"><h3 id="h-ll">Status des Bauvorhabens</h3>${phaseChip(p)}</div>
    <ol class="ll-schritte" aria-label="Lebenslauf">${reihe.map((s, i) => `<li class="${p === 'storniert' ? '' : i < pos ? 'fertig' : i === pos ? 'jetzt' : ''}" ${i === pos && p !== 'storniert' ? 'aria-current="step"' : ''} data-schritt="${s}"><i>${p !== 'storniert' && i < pos ? ic('check', 'xs') : i + 1}</i><span>${esc(phaseText(s))}</span></li>`).join('')}</ol>
    <div class="pad stack-s">
      ${b.phaseSeit ? `<p class="muted sm">${esc(phaseText(p))} seit ${esc(fmt.datum(b.phaseSeit))}${p === 'pausiert' ? ' – Arbeiten ruhen' : ''}</p>` : ''}
      ${b.fertigmeldung ? `<div id="fertigmeldung">${banner('info', `<b>Fertigstellung gemeldet</b> von ${esc((b.fertigmeldung.von && b.fertigmeldung.von.name) || '')} am ${esc(fmt.zeitpunkt(b.fertigmeldung.zeit))}${b.fertigmeldung.notiz ? ' – ' + esc(b.fertigmeldung.notiz) : ''}${moegl.includes('fertiggestellt') ? ' <button type="button" class="btn ghost sm" data-phase-ziel="fertiggestellt">Bestätigen</button>' : ''}`)}</div>` : ''}
      ${b.phaseVorschlag && moegl.includes(b.phaseVorschlag.phase) ? `<div id="phase-vorschlag">${banner('info', `Vorschlag: <b>${esc(phaseText(b.phaseVorschlag.phase))}</b>${b.phaseVorschlag.grund ? ' – ' + esc(b.phaseVorschlag.grund) : ''} <button type="button" class="btn ghost sm" data-phase-ziel="${esc(b.phaseVorschlag.phase)}">Übernehmen</button>`)}</div>` : ''}
      <div class="btn-row">${vor ? `<button type="button" class="btn primary" id="phase-weiter" data-phase-ziel="${vor}">${ic('right')}Nächster Schritt: ${esc(phaseText(vor))}</button>` : ''}${moegl.length > (vor ? 1 : 0) ? `<button type="button" class="btn ghost" id="phase-andere" data-phase-ziel="">Anderer Status …</button>` : ''}
        ${darfMelden ? `<button type="button" class="btn primary" id="fertig-melden">${ic('check')}Fertigstellung melden</button>` : ''}
        ${p === 'archiviert' && rolle === 'gf' ? '<button type="button" class="btn ghost" id="archiv-auf">Archiv aufheben</button>' : ''}</div>
      ${verlauf && verlauf.length ? `<details class="ll-verlauf"><summary>Verlauf (${verlauf.length})</summary><ul class="plain rows" id="phasen-verlauf">${verlauf.map((v) => `<li><span class="grow"><b>${esc(phaseText(v.phase))}</b><small>${esc(fmt.datum(v.datum || v.zeit))} · ${esc((v.von && v.von.name) || '')}${v.notiz ? ' · ' + esc(v.notiz) : ''}</small></span></li>`).join('')}</ul></details>` : ''}
    </div></section>`;
}
export function abschlussHtml(b, ctx) {
  const p = phaseVon(b), heute = wienHeute();
  if (!b.abnahmeDatum && !b.gewaehrleistungBis && !b.haftruecklass && !['abgenommen', 'schlussrechnung', 'bezahlt', 'archiviert'].includes(p)) return '';
  const darf = planer(ctx), h = b.haftruecklass, hinweise = [];
  if (b.gewaehrleistungBis) { const t = tageBis(b.gewaehrleistungBis, heute); if (t < 0) hinweise.push(['info', 'Gewährleistung abgelaufen.']); else if (t <= 92) hinweise.push(['warn', `Gewährleistung endet in ${t} Tagen – Schlussbegehung einplanen.`]); }
  if (h && h.bankgarantieBis && !h.freigegeben) { const t = tageBis(h.bankgarantieBis, heute); if (t >= 0 && t <= 30) hinweise.push(['warn', `Bankgarantie läuft in ${t} Tagen ab.`]); }
  if (h && h.freigabeAm && !h.freigegeben && h.freigabeAm <= heute) hinweise.push(['warn', 'Haftrücklass kann freigegeben bzw. eingefordert werden.']);
  return `<section class="card" id="abschluss" aria-labelledby="h-ab">
    <div class="card-h pad-h"><h3 id="h-ab">Gewährleistung${h ? ' &amp; Haftrücklass' : ''}</h3>${darf ? `<button type="button" class="btn ghost sm" id="abschluss-edit">${ic('edit')}Bearbeiten</button>` : ''}</div>
    <div class="pad-s" id="abschluss-hinweise">${hinweise.map(([a, t]) => banner(a, esc(t))).join('')}</div>
    <dl class="def-list"><div><dt>Abnahme am</dt><dd>${esc(b.abnahmeDatum ? fmt.datum(b.abnahmeDatum) : '–')}</dd></div><div><dt>Gewährleistung bis</dt><dd data-wert="gewaehrleistung">${esc(b.gewaehrleistungBis ? fmt.datum(b.gewaehrleistungBis) : '–')}</dd></div>
      ${b.schlussrechnung ? `<div><dt>Schlussrechnung</dt><dd>${esc(b.schlussrechnung.nr || '–')}${b.schlussrechnung.datum ? ' vom ' + esc(fmt.datum(b.schlussrechnung.datum)) : ''}${b.schlussrechnung.betrag != null ? ' · ' + fmt.eur(b.schlussrechnung.betrag) : ''}</dd></div>` : ''}
      ${h ? `<div><dt>Haftrücklass</dt><dd class="num" data-wert="haftruecklass">${h.betrag != null ? fmt.eur(h.betrag) : '–'}${h.prozent != null ? ` (${fmt.zahl(h.prozent)} %)` : ''}${h.freigegeben ? ' <span class="chip xs st-green">freigegeben</span>' : ''}</dd></div><div><dt>Bankgarantie bis</dt><dd>${esc(h.bankgarantieBis ? fmt.datum(h.bankgarantieBis) : '–')}</dd></div><div><dt>Freigabe am</dt><dd>${esc(h.freigabeAm ? fmt.datum(h.freigabeAm) : '–')}</dd></div>` : ''}</dl>
    <p class="muted sm pad-s">Erinnerungen kommen automatisch in der App: 3 Monate vor Ende der Gewährleistung, 30 Tage vor Ablauf der Bankgarantie, bei möglicher Freigabe des Haftrücklasses.</p>
  </section>`;
}
function abschlussDialog(ctx, b) {
  const h = b.haftruecklass, darfGeld = ctx.kann('preise_bearbeiten') && 'haftruecklass' in b;
  const dlg = dialog({ titel: 'Gewährleistung & Haftrücklass', breit: true, inhalt: `<form id="abf" class="form-grid" novalidate>
    <label class="field full"><span class="field-label">Gewährleistung bis</span><input class="input lg" type="date" name="gewaehrleistungBis" value="${esc(b.gewaehrleistungBis || '')}"><small class="muted">Standard: Abnahme + 3 Jahre – bitte mit Vertrag / ÖNORM B 2110 prüfen.</small></label>
    ${darfGeld ? `<label class="field"><span class="field-label">Haftrücklass in Euro</span><input class="input lg num" name="betrag" data-geld="leer" inputmode="decimal" autocomplete="off" value="${h && h.betrag != null ? fmt.betrag(h.betrag) : ''}"></label>
    <label class="field"><span class="field-label">in % der Schlussrechnung</span><input class="input lg num" name="prozent" inputmode="decimal" value="${h && h.prozent != null ? String(h.prozent).replace('.', ',') : ''}"></label>
    <label class="field"><span class="field-label">Bankgarantie gültig bis</span><input class="input lg" type="date" name="bankgarantieBis" value="${esc((h && h.bankgarantieBis) || '')}"></label>
    <label class="field"><span class="field-label">Freigabe möglich am</span><input class="input lg" type="date" name="freigabeAm" value="${esc((h && h.freigabeAm) || '')}"></label>
    <label class="check-inline full"><input type="checkbox" name="freigegeben" ${h && h.freigegeben ? 'checked' : ''}> Haftrücklass ist freigegeben / ausbezahlt</label>` : ''}
    <p class="form-err full" role="alert" hidden></p></form>`, fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="abf">Speichern</button>' });
  geldFelder(dlg.el);
  $('#abf', dlg.el).addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const err = $('.form-err', dlg.el);
    const body = { version: b.version, gewaehrleistungBis: f.get('gewaehrleistungBis') || null };
    if (darfGeld) {
      const betrag = geldWert(e.target.elements.betrag); const pz = String(f.get('prozent') || '').trim().replace(',', '.');
      if (Number.isNaN(betrag) || (pz !== '' && !(Number(pz) >= 0 && Number(pz) <= 100))) { err.hidden = false; err.textContent = 'Betrag oder Prozentsatz unklar – bitte so schreiben: 4.500,00 bzw. 5'; return; }
      body.haftruecklass = { betrag, prozent: pz === '' ? null : Number(pz), bankgarantieBis: f.get('bankgarantieBis') || null, freigabeAm: f.get('freigabeAm') || null, freigegeben: f.get('freigegeben') === 'on' };
    }
    try { await put(`/baustellen/${b.id}/abschluss`, body); dlg.zu(); toast('Gespeichert.'); ctx.neuLaden(); } catch (x) { err.hidden = false; err.textContent = x.status === 409 ? 'Inzwischen geändert – bitte schließen und neu laden.' : x.message; }
  });
}
export function lebenslaufBinden(el, b, ctx) {
  el.addEventListener('click', (e) => {
    const z = e.target.closest('[data-phase-ziel]');
    if (z) return phaseDialog(ctx, b, z.dataset.phaseZiel || undefined);
    if (e.target.closest('#abschluss-edit')) return abschlussDialog(ctx, b);
    if (e.target.closest('#fertig-melden')) {
      const dlg = dialog({ titel: 'Fertigstellung melden', inhalt: '<form id="fmf" class="stack-s"><p class="muted sm">Büro und Bauleiter werden benachrichtigt und bestätigen die Fertigstellung.</p><label class="field"><span class="field-label">Notiz (optional)</span><textarea class="input lg" name="notiz" rows="3" maxlength="500" placeholder="z. B. Restarbeiten: Bankett angleichen"></textarea></label><p class="form-err" role="alert" hidden></p></form>', fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="fmf">Melden</button>' });
      $('#fmf', dlg.el).addEventListener('submit', async (ev) => { ev.preventDefault(); try { await post(`/baustellen/${b.id}/fertigmeldung`, { notiz: String(new FormData(ev.target).get('notiz') || '').trim() }); dlg.zu(); toast('Fertigstellung gemeldet.'); ctx.neuLaden(); } catch (x) { const err = $('.form-err', dlg.el); err.hidden = false; err.textContent = x.message; } });
      return;
    }
    if (e.target.closest('#archiv-auf')) {
      const dlg = dialog({ titel: 'Archiv aufheben', inhalt: '<form id="aaf" class="stack-s"><label class="field"><span class="field-label">Grund</span><input class="input lg" name="grund" required maxlength="300"></label><p class="form-err" role="alert" hidden></p></form>', fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="aaf">Archiv aufheben</button>' });
      $('#aaf', dlg.el).addEventListener('submit', async (ev) => { ev.preventDefault(); const grund = String(new FormData(ev.target).get('grund') || '').trim(); const err = $('.form-err', dlg.el); if (!grund) { err.hidden = false; err.textContent = 'Bitte einen Grund angeben.'; return; } try { await post(`/baustellen/${b.id}/archiv-aufheben`, { grund }); dlg.zu(); toast('Archiv aufgehoben.'); ctx.neuLaden(); } catch (x) { err.hidden = false; err.textContent = x.message; } });
    }
  });
}

/* ---------- Tafel (Spalten je Status) ---------- */
const TAFEL = ['geplant', 'in_arbeit', 'pausiert', 'fertiggestellt', 'abgenommen', 'schlussrechnung', 'bezahlt'];
export function tafelHtml(liste, ctx) {
  return `<div class="ll-tafel-scroll" data-zieh-scroll><div class="ll-tafel" id="bv-tafel">${TAFEL.map((s) => { const l = liste.filter((b) => phaseVon(b) === s); return `<section class="ll-spalte" data-spalte="${s}" aria-label="${esc(phaseText(s))}"><h3>${esc(phaseText(s))} <span class="count">${l.length}</span></h3>
    <div class="ll-karten">${l.map((b) => { const z = ziele(ctx, b); return `<article class="ll-karte" ${z.length ? 'data-zieh' : ''} data-bv="${b.id}"><a href="#/baustelle/${b.id}"><small>${esc(b.kst || '')}</small><b>${esc(b.kurz || b.name)}</b></a><span class="muted sm">${esc(b.auftraggeber || '')}</span>${b.fertigmeldung ? '<span class="chip xs st-blue">Fertigstellung gemeldet</span>' : ''}${z.length ? `<button type="button" class="btn ghost sm" data-bv-weiter="${b.id}" data-ziel="${naechster(ctx, b) || ''}">${ic('right', 'xs')}${esc(naechster(ctx, b) ? phaseText(naechster(ctx, b)) : 'Status ändern')}</button>` : ''}</article>`; }).join('') || '<p class="muted sm ll-leer">–</p>'}</div></section>`; }).join('')}</div></div>
    <p class="muted sm">Karte in die nächste Spalte ziehen – oder den Knopf auf der Karte verwenden.</p>`;
}
export function tafelBinden(el, ctx, holListe, fertig) {
  const finde = (id) => holListe().find((b) => Number(b.id) === Number(id));
  el.addEventListener('click', (e) => { const w = e.target.closest('[data-bv-weiter]'); if (w) { const b = finde(w.dataset.bvWeiter); if (b) phaseDialog(ctx, b, w.dataset.ziel || undefined, fertig); } });
  return ziehbar(el, {
    quelle: '.ll-karte[data-zieh]', ziel: '.ll-spalte',
    darf: (q, z) => { const b = finde(q.dataset.bv); return !!b && ziele(ctx, b).includes(z.dataset.spalte); },
    ablegen: (q, z) => { const b = finde(q.dataset.bv); if (b) phaseDialog(ctx, b, z.dataset.spalte, fertig); },
  });
}

/* ---------- Archiv: abgeschlossene Bauvorhaben ---------- */
export async function archiv(el, ctx) {
  let suche = ctx.query.get('suche') || '', jahr = ctx.query.get('jahr') || '', ag = '';
  let liste = [], fehler = '';
  const jetzt = Number(wienHeute().slice(0, 4));
  async function lade() {
    fehler = '';
    const q = new URLSearchParams({ archiv: '1' }); if (suche.trim()) q.set('suche', suche.trim()); if (jahr) q.set('jahr', jahr); if (ag.trim()) q.set('auftraggeber', ag.trim());
    try { liste = await get(`/baustellen?${q}`); } catch (e) { if (e.status === 401 || e.netz) throw e; fehler = e.message; liste = []; }
    liste = liste.filter((b) => b.archiviert || ['archiviert'].includes(b.phase)); // falls der Server den Filter (noch) nicht kennt
  }
  await lade();
  const zeilen = () => (fehler ? banner('err', esc(fehler)) : liste.length ? `<div class="tbl-wrap"><table class="tbl" id="archiv-tabelle"><thead><tr><th>KST</th><th>Bauvorhaben</th><th>Auftraggeber</th><th>Abnahme</th><th>Gewährleistung bis</th><th>Status</th></tr></thead><tbody>${liste.map((b) => `<tr data-bv="${b.id}"><td>${esc(b.kst || '')}</td><td><a href="#/baustelle/${b.id}"><b>${esc(b.name)}</b></a></td><td>${esc(b.auftraggeber || '–')}</td><td>${esc(b.abnahmeDatum ? fmt.datum(b.abnahmeDatum) : '–')}</td><td>${esc(b.gewaehrleistungBis ? fmt.datum(b.gewaehrleistungBis) : '–')}</td><td>${phaseChip(phaseVon(b))}</td></tr>`).join('')}</tbody></table></div>` : leer('Kein abgeschlossenes Bauvorhaben gefunden.', 'pin'));
  el.innerHTML = `<div class="page">
    <div class="form-top"><a class="link-back" href="#/baustellen">${ic('left')}Laufende Baustellen</a></div>
    <div class="toolbar wrap"><label class="field weit"><span class="field-label">Suche (KST, Name, Auftraggeber)</span><input class="input" type="search" id="ar-suche" value="${esc(suche)}"></label>
      <label class="field"><span class="field-label">Jahr</span><select class="input" id="ar-jahr"><option value="">alle</option>${Array.from({ length: 8 }, (_, i) => jetzt - i).map((j) => `<option ${String(j) === jahr ? 'selected' : ''}>${j}</option>`).join('')}</select></label>
      <label class="field"><span class="field-label">Auftraggeber</span><input class="input" type="search" id="ar-ag" value=""></label></div>
    <section class="card" id="archiv-liste" aria-live="polite">${zeilen()}</section></div>`;
  const neu = entprellt(async () => { await lade(); if (ctx.aktuell()) $('#archiv-liste', el).innerHTML = zeilen(); }, 250);
  el.addEventListener('input', (e) => { if (e.target.id === 'ar-suche') { suche = e.target.value; neu(); } if (e.target.id === 'ar-ag') { ag = e.target.value; neu(); } });
  el.addEventListener('change', (e) => { if (e.target.id === 'ar-jahr') { jahr = e.target.value; neu(); } });
}
