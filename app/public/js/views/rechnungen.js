// Ausgangsrechnungen, Zahlungen und Offene Posten (API.md 12.17) sowie der BMD-Import (12.20).
// Rechnungen werden in BMD bzw. Auer Success geschrieben – BauTag erfasst sie nur (PDF + Kopfdaten) und hält den Zahlungsstand.
// Alle Beträge kommen vom Server; ohne Preis-Recht gibt es diese Ansichten nicht.
import { get, post, put, del } from '../api.js';
import { ic, esc, fmt, geldFelder, geldWert, leer, banner, dialog, bestaetigen, toast, $ } from '../ui.js';
import { wienHeute } from '../zahl.js';
import { dateiBase64 } from './dokumente.js';
import { importAssistent } from './import.js';

export const R_TYP = { abschlag: 'Abschlagsrechnung', teil: 'Teilrechnung', schluss: 'Schlussrechnung', regie: 'Regierechnung', gutschrift: 'Gutschrift' };
const R_STATUS = { offen: ['offen', 'st-blue'], teilbezahlt: ['teilbezahlt', 'st-amber'], bezahlt: ['bezahlt', 'st-green'], ueberfaellig: ['überfällig', 'st-red'], storniert: ['storniert', 'st-grey'] };
const MAHN = { 1: 'Zahlungserinnerung', 2: '1. Mahnung', 3: '2. Mahnung' };
export const rStatus = (r) => { const [t, c] = R_STATUS[r.status] || [r.status, 'st-grey']; return `<span class="chip ${c}" data-r-status="${esc(r.status)}">${esc(t)}${r.status === 'ueberfaellig' && r.ueberfaelligTage ? ` ${r.ueberfaelligTage} Tage` : ''}</span>${r.mahnstufe ? `<span class="chip xs st-orange" data-mahnstufe="${r.mahnstufe}">${esc(MAHN[r.mahnstufe] || 'Mahnstufe ' + r.mahnstufe)}</span>` : ''}`; };
const vz = (r) => (r.typ === 'gutschrift' ? -1 : 1);
const rund = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const prozent = (s) => { const t = String(s || '').trim().replace(',', '.'); return t === '' ? null : Number(t); };

/* ---------- Rechnung erfassen / bearbeiten ---------- */
export function rechnungDialog(ctx, b, r, fertig) {
  const heute = wienHeute();
  const gesperrt = r && (r.zahlungen || []).length > 0;
  const dlg = dialog({ titel: r ? `Rechnung ${r.nr} bearbeiten` : 'Rechnung erfassen', breit: true, inhalt: `<form id="ref" class="form-grid" novalidate>
    ${r ? '' : `<p class="muted sm full">Die Rechnung selbst wird in BMD bzw. Auer Success geschrieben. Hier werden nur das PDF und die Kopfdaten erfasst, damit Zahlungsstand und offene Posten stimmen.</p>`}
    ${gesperrt ? `<div class="full">${banner('info', 'Es gibt bereits Zahlungen – Beträge, Umsatzsteuer und Rücklass sind gesperrt.')}</div>` : ''}
    <label class="field"><span class="field-label">Art</span><select class="input lg" name="typ">${Object.entries(R_TYP).map(([k, t]) => `<option value="${k}" ${(r ? r.typ : 'abschlag') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label class="field"><span class="field-label">Rechnungs-Nr. (wie in BMD)</span><input class="input lg" name="nr" required maxlength="40" value="${esc((r && r.nr) || '')}"></label>
    <label class="field"><span class="field-label">Rechnungsdatum</span><input class="input lg" type="date" name="datum" required value="${esc((r && r.datum) || heute)}"></label>
    <label class="field"><span class="field-label">Netto in Euro</span><input class="input lg num" name="netto" data-geld inputmode="decimal" autocomplete="off" required value="${r ? fmt.betrag(r.netto) : ''}" placeholder="0,00" ${gesperrt ? 'disabled' : ''}></label>
    <label class="field"><span class="field-label">Leistungszeitraum von</span><input class="input lg" type="date" name="leistungVon" value="${esc((r && r.leistungVon) || '')}"></label>
    <label class="field"><span class="field-label">bis</span><input class="input lg" type="date" name="leistungBis" value="${esc((r && r.leistungBis) || '')}"></label>
    <fieldset class="field full"><legend class="field-label">Umsatzsteuer</legend><div class="chk-row"><label class="check-inline"><input type="radio" name="ustModus" value="normal" ${!r || r.ustModus !== 'reverse_charge' ? 'checked' : ''} ${gesperrt ? 'disabled' : ''}> 20 % USt</label><label class="check-inline"><input type="radio" name="ustModus" value="reverse_charge" ${r && r.ustModus === 'reverse_charge' ? 'checked' : ''} ${gesperrt ? 'disabled' : ''}> Reverse Charge (0 %)</label></div>
      <small class="muted" id="rc-hinweis" hidden>Übergang der Steuerschuld bei Bauleistungen (§ 19 Abs. 1a UStG): Die Rechnung weist keine USt aus – bitte mit der Steuerberatung prüfen.</small></fieldset>
    <label class="field"><span class="field-label">Zahlungsziel (Tage)</span><input class="input lg num" name="zahlungszielTage" inputmode="numeric" value="${r ? r.zahlungszielTage ?? '' : 30}"></label>
    <div class="field"><span class="field-label">Fällig am</span><output class="input lg ro" id="re-faellig"></output></div>
    <label class="field"><span class="field-label">Skonto %</span><input class="input lg num" name="skontoProzent" inputmode="decimal" value="${r && r.skontoProzent != null ? String(r.skontoProzent).replace('.', ',') : ''}" placeholder="z. B. 3"></label>
    <label class="field"><span class="field-label">Skonto bis (Tage)</span><input class="input lg num" name="skontoTage" inputmode="numeric" value="${r && r.skontoTage != null ? r.skontoTage : ''}" placeholder="z. B. 14"></label>
    <label class="field"><span class="field-label">Rücklass</span><select class="input lg" name="ruecklassArt" ${gesperrt ? 'disabled' : ''}><option value="">kein Rücklass</option><option value="haft" ${r && r.ruecklassArt === 'haft' ? 'selected' : ''}>Haftrücklass</option><option value="deckung" ${r && r.ruecklassArt === 'deckung' ? 'selected' : ''}>Deckungsrücklass</option></select></label>
    <label class="field"><span class="field-label">Rücklass in % vom Brutto</span><input class="input lg num" name="ruecklassProzent" inputmode="decimal" value="${r && r.ruecklassProzent != null ? String(r.ruecklassProzent).replace('.', ',') : ''}" ${gesperrt ? 'disabled' : ''}></label>
    <div class="full re-vorschau" id="re-vorschau" aria-live="polite"></div>
    <label class="field full"><span class="field-label">Rechnungs-PDF ${r && r.dokumentId ? '(ersetzen)' : '(aus BMD / Auer Success)'}</span><input class="input lg" type="file" name="pdf" accept="application/pdf,.pdf"><small class="muted">Wird unter „Dokumente → Ausgangsrechnungen“ dieser Baustelle abgelegt.</small></label>
    <label class="field full"><span class="field-label">Notiz</span><input class="input lg" name="notiz" maxlength="500" value="${esc((r && r.notiz) || '')}"></label>
    <p class="form-err full" role="alert" hidden></p></form>`,
    fuss: `<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="ref" id="re-ok">${r ? 'Speichern' : 'Rechnung erfassen'}</button>` });
  geldFelder(dlg.el);
  const form = $('#ref', dlg.el);
  function vorschau() {
    const f = new FormData(form);
    const rc = (f.get('ustModus') || (r && r.ustModus)) === 'reverse_charge';
    $('#rc-hinweis', dlg.el).hidden = !rc;
    const ziel = Number(f.get('zahlungszielTage'));
    $('#re-faellig', dlg.el).textContent = f.get('datum') && Number.isFinite(ziel) && f.get('zahlungszielTage') !== '' ? fmt.datum(fmt.addTage(f.get('datum'), ziel)) : '–';
    const netto = gesperrt ? r.netto : geldWert(form.elements.netto);
    const box = $('#re-vorschau', dlg.el);
    if (!Number.isFinite(netto) || netto == null) { box.innerHTML = ''; return; }
    const ust = rund(netto * (rc ? 0 : 20) / 100), brutto = rund(netto + ust);
    const rp = gesperrt ? r.ruecklassProzent : prozent(f.get('ruecklassProzent'));
    const rl = (gesperrt ? r.ruecklassArt : f.get('ruecklassArt')) && Number.isFinite(rp) ? rund(brutto * rp / 100) : 0;
    box.innerHTML = `<dl class="re-summe"><div><dt>Netto</dt><dd>${fmt.eur(netto)}</dd></div><div><dt>USt ${rc ? '0 % (Reverse Charge)' : '20 %'}</dt><dd>${fmt.eur(ust)}</dd></div><div><dt>Brutto</dt><dd>${fmt.eur(brutto)}</dd></div>${rl ? `<div><dt>Rücklass</dt><dd>− ${fmt.eur(rl)}</dd></div>` : ''}<div class="sum"><dt>Zahlbetrag</dt><dd id="re-zahlbetrag">${fmt.eur(rund(brutto - rl))}</dd></div></dl>`;
  }
  form.addEventListener('input', vorschau); form.addEventListener('change', vorschau); vorschau();
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(form); const err = $('.form-err', dlg.el);
    const zeig = (t) => { err.hidden = false; err.textContent = t; };
    const body = { typ: f.get('typ'), nr: String(f.get('nr') || '').trim(), datum: f.get('datum'), leistungVon: f.get('leistungVon') || null, leistungBis: f.get('leistungBis') || null, notiz: String(f.get('notiz') || '').trim() };
    if (!body.nr || !body.datum) return zeig('Bitte Rechnungs-Nr. und Datum eintragen.');
    const zt = f.get('zahlungszielTage'); body.zahlungszielTage = zt === '' ? 0 : Number(zt);
    const sp = prozent(f.get('skontoProzent')), st = f.get('skontoTage');
    if (!Number.isInteger(body.zahlungszielTage) || body.zahlungszielTage < 0 || (sp != null && !(sp >= 0 && sp <= 20))) return zeig('Zahlungsziel in ganzen Tagen und Skonto in Prozent (0–20) eintragen.');
    body.skontoProzent = sp; body.skontoTage = st === '' ? null : Number(st);
    if (!gesperrt) {
      const netto = geldWert(form.elements.netto);
      if (!Number.isFinite(netto) || netto == null || netto <= 0) return zeig('Netto-Betrag unklar – bitte so schreiben: 12.500,00 (bei Gutschriften ebenfalls positiv).');
      const rp = prozent(f.get('ruecklassProzent'));
      if (f.get('ruecklassArt') && !(rp > 0 && rp <= 20)) return zeig('Bitte den Rücklass in Prozent eintragen (z. B. 5).');
      Object.assign(body, { netto, ustModus: f.get('ustModus'), ruecklassArt: f.get('ruecklassArt') || null, ruecklassProzent: f.get('ruecklassArt') ? rp : null });
    }
    $('#re-ok', dlg.el).disabled = true;
    try {
      const pdf = form.elements.pdf.files[0];
      if (pdf) { const dok = await post(`/baustellen/${b.id}/dokumente`, { kategorie: 'ausgangsrechnungen', titel: `Rechnung ${body.nr}`, datum: body.datum, dateiBase64: await dateiBase64(pdf), dateiname: pdf.name }); body.dokumentId = dok.id; }
      if (r) await put(`/rechnungen/${r.id}`, { ...body, version: r.version }); else await post(`/baustellen/${b.id}/rechnungen`, body);
      dlg.zu(); toast(r ? 'Rechnung gespeichert.' : `Rechnung ${body.nr} erfasst.`); fertig();
    } catch (x) { $('#re-ok', dlg.el).disabled = false; zeig(x.status === 409 && !(x.daten && x.daten.version != null) ? (x.message || 'Diese Rechnungs-Nr. gibt es schon.') : x.status === 409 ? 'Inzwischen von jemand anderem geändert – bitte schließen und neu laden.' : x.message); }
  });
}

/* ---------- Zahlung erfassen ---------- */
function zahlungDialog(r, fertig) {
  const heute = wienHeute();
  const skontoMoegl = r.skontoProzent && r.skontoBis && heute <= r.skontoBis;
  const dlg = dialog({ titel: `Zahlung erfassen · ${r.nr}`, inhalt: `<form id="zaf" class="form-grid" novalidate>
    <p class="muted sm full">Offen: <b>${fmt.eur(r.offen)}</b>${r.ruecklassOffen > 0 ? ` · Rücklass offen: <b>${fmt.eur(r.ruecklassOffen)}</b>` : ''}. Teilzahlungen sind möglich. Üblicherweise kommt der Zahlungsstand über den BMD-Import.</p>
    <label class="field"><span class="field-label">Zahlungsdatum</span><input class="input lg" type="date" name="datum" required value="${heute}" max="${heute}"></label>
    <label class="field"><span class="field-label">Betrag in Euro</span><input class="input lg num" name="betrag" data-geld inputmode="decimal" autocomplete="off" required value="${fmt.betrag(r.offen)}"></label>
    <label class="field full"><span class="field-label">Skonto in Euro${r.skontoProzent ? ` (${fmt.zahl(r.skontoProzent)} % bis ${r.skontoBis ? fmt.datum(r.skontoBis) : '–'})` : ''}</span><input class="input lg num" name="skonto" data-geld="leer" inputmode="decimal" autocomplete="off" placeholder="0,00"><small class="muted">${skontoMoegl ? `Skonto ist noch möglich: höchstens ${fmt.eur(rund(r.zahlbetrag * r.skontoProzent / 100))}.` : 'Skonto nur bei Zahlung innerhalb der Skontofrist.'}</small></label>
    ${r.ruecklassOffen > 0 ? '<label class="check-inline full"><input type="checkbox" name="ruecklass"> Das ist die Auszahlung des Rücklasses</label>' : ''}
    <label class="field full"><span class="field-label">Notiz</span><input class="input lg" name="notiz" maxlength="300"></label>
    <p class="form-err full" role="alert" hidden></p></form>`, fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="zaf" id="za-ok">Zahlung speichern</button>' });
  geldFelder(dlg.el);
  const form = $('#zaf', dlg.el);
  if (form.elements.ruecklass) form.elements.ruecklass.addEventListener('change', (e) => { form.elements.betrag.value = fmt.betrag(e.target.checked ? r.ruecklassOffen : r.offen); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(form); const err = $('.form-err', dlg.el);
    const betrag = geldWert(form.elements.betrag), skonto = geldWert(form.elements.skonto);
    if (!Number.isFinite(betrag) || betrag == null || betrag <= 0 || Number.isNaN(skonto)) { err.hidden = false; err.textContent = 'Betrag unklar – bitte so schreiben: 4.800,00'; return; }
    try { await post(`/rechnungen/${r.id}/zahlungen`, { datum: f.get('datum'), betrag, ...(skonto ? { skonto } : {}), ...(f.get('ruecklass') ? { ruecklass: true } : {}), notiz: String(f.get('notiz') || '').trim() }); dlg.zu(); toast('Zahlung gespeichert.'); fertig(); }
    catch (x) { err.hidden = false; err.textContent = x.message; }
  });
}

/* ---------- Rechnung ansehen: Zahlungen, Mahnstufe, Storno ---------- */
export async function rechnungOeffnen(ctx, id, fertig) {
  let r;
  try { r = await get(`/rechnungen/${id}`); } catch (x) { toast(x.message, 'warn'); return; }
  const darf = ctx.kann('preise_bearbeiten') && r.status !== 'storniert';
  const b = r.baustelle || { id: r.baustelleId };
  const naechste = (r.mahnstufe || 0) + 1;
  const zeile = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
  const dlg = dialog({ titel: `${R_TYP[r.typ] || 'Rechnung'} ${r.nr}`, breit: true, inhalt: `<div class="stack-s" id="re-detail" data-rechnung="${r.id}">
    <div class="btn-row">${rStatus(r)}<span class="grow"></span>${r.dokumentId ? `<a class="btn ghost sm" id="re-pdf" href="/api/baustellen/${b.id}/dokumente/${r.dokumentId}/datei" target="_blank" rel="noopener">${ic('file')}Rechnungs-PDF</a>` : '<span class="muted sm">kein PDF hinterlegt</span>'}</div>
    ${r.storniert ? banner('warn', `Storniert am ${esc(fmt.zeitpunkt(r.storniert.zeit))}${r.storniert.grund ? ' – ' + esc(r.storniert.grund) : ''}`) : ''}
    <dl class="def-list">${zeile('Bauvorhaben', `${esc(b.kst || '')} ${esc(b.name || '')}`)}${zeile('Auftraggeber', esc(b.auftraggeber || '–'))}${zeile('Rechnungsdatum', esc(fmt.datum(r.datum)))}${zeile('Fällig am', esc(r.faellig ? fmt.datum(r.faellig) : '–'))}
      ${zeile('Netto', fmt.eur(r.netto))}${zeile(r.ustModus === 'reverse_charge' ? 'USt (Reverse Charge)' : `USt ${fmt.zahl(r.ustSatz)} %`, fmt.eur(r.ust))}${zeile('Brutto', fmt.eur(r.brutto))}${r.ruecklass ? zeile(r.ruecklassArt === 'deckung' ? 'Deckungsrücklass' : 'Haftrücklass', `− ${fmt.eur(r.ruecklass)}`) : ''}${zeile('Zahlbetrag', `<b>${fmt.eur(r.zahlbetrag)}</b>`)}
      ${zeile('Bezahlt', fmt.eur(r.bezahlt))}${r.skontoGenommen ? zeile('Skonto genommen', fmt.eur(r.skontoGenommen)) : ''}${zeile('Offen', `<b data-wert="offen">${fmt.eur(r.offen)}</b>`)}${r.ruecklass ? zeile('Rücklass offen', `${fmt.eur(r.ruecklassOffen)}${r.ruecklassFaellig ? ' · frei ab ' + esc(fmt.datum(r.ruecklassFaellig)) : ''}`) : ''}
      ${r.skontoProzent ? zeile('Skonto', `${fmt.zahl(r.skontoProzent)} % bis ${esc(r.skontoBis ? fmt.datum(r.skontoBis) : '–')}`) : ''}${r.notiz ? zeile('Notiz', esc(r.notiz)) : ''}</dl>
    <h4 class="sub-h">Zahlungen <span class="count">${(r.zahlungen || []).length}</span></h4>
    ${(r.zahlungen || []).length ? `<ul class="plain rows" id="re-zahlungen">${r.zahlungen.map((z) => `<li data-zahlung="${z.id}"><span class="grow"><b>${fmt.eur(z.betrag)}${z.skonto ? ` + ${fmt.eur(z.skonto)} Skonto` : ''}</b><small>${esc(fmt.datum(z.datum))}${z.ruecklass ? ' · Rücklass' : ''}${z.quelle === 'bmd' ? ' · aus BMD' : ''}${z.notiz ? ' · ' + esc(z.notiz) : ''}</small></span>${darf ? `<button type="button" class="icon-btn sm" data-zahlung-weg="${z.id}" aria-label="Zahlung vom ${esc(fmt.datum(z.datum))} löschen">${ic('trash')}</button>` : ''}</li>`).join('')}</ul>` : '<p class="muted sm">Noch keine Zahlung.</p>'}
    <h4 class="sub-h">Mahnwesen</h4>
    ${(r.mahnungen || []).length ? `<ul class="plain rows" id="re-mahnungen">${r.mahnungen.map((m) => `<li><span class="grow"><b>${esc(m.name || MAHN[m.stufe] || 'Stufe ' + m.stufe)}</b><small>${esc(fmt.datum(m.datum))}${m.erfasstVon ? ' · ' + esc(m.erfasstVon.name || m.erfasstVon) : ''}</small></span></li>`).join('')}</ul>` : '<p class="muted sm">Keine Mahnstufe vermerkt.</p>'}
    <p class="muted sm">Mahnungen werden in BMD geschrieben – hier wird nur vermerkt, welche Stufe wann gesetzt wurde.</p></div>`,
    fuss: darf ? `<button class="btn danger" type="button" id="re-storno">Stornieren</button><span class="grow"></span>${r.offen > 0 && naechste <= 3 ? `<button class="btn ghost" type="button" id="re-mahnung" data-stufe="${naechste}">${esc(MAHN[naechste])} vermerken</button>` : ''}<button class="btn ghost" type="button" id="re-edit">${ic('edit')}Bearbeiten</button>${r.offen > 0 || r.ruecklassOffen > 0 ? `<button class="btn primary" type="button" id="re-zahlung">${ic('plus')}Zahlung</button>` : ''}` : '<button class="btn ghost" type="button" data-zu>Schließen</button>' });
  if (!darf) return;
  const wieder = () => { dlg.zu(); fertig(); rechnungOeffnen(ctx, id, fertig); };
  dlg.el.addEventListener('click', async (e) => {
    if (e.target.closest('#re-zahlung')) return zahlungDialog(r, wieder);
    if (e.target.closest('#re-edit')) { dlg.zu(); return rechnungDialog(ctx, b, r, fertig); }
    const m = e.target.closest('#re-mahnung');
    if (m) { if (!(await bestaetigen(`${MAHN[m.dataset.stufe]} vermerken?`, 'Das Schreiben selbst kommt aus BMD – hier wird nur die Stufe mit dem heutigen Datum festgehalten.', 'Vermerken'))) return; try { await post(`/rechnungen/${r.id}/mahnungen`, { stufe: Number(m.dataset.stufe) }); toast('Mahnstufe vermerkt.'); wieder(); } catch (x) { toast(x.message, 'warn'); } return; }
    const zw = e.target.closest('[data-zahlung-weg]');
    if (zw) { if (!(await bestaetigen('Zahlung löschen?', 'Der offene Betrag erhöht sich wieder.', 'Löschen', 'danger'))) return; try { await del(`/rechnungen/${r.id}/zahlungen/${zw.dataset.zahlungWeg}`); toast('Zahlung gelöscht.'); wieder(); } catch (x) { toast(x.message, 'warn'); } return; }
    if (e.target.closest('#re-storno')) {
      const q = dialog({ titel: `Rechnung ${r.nr} stornieren?`, inhalt: '<form id="stf" class="stack-s"><p>Die Rechnung zählt dann nicht mehr zu den offenen Posten. Das Storno in BMD bitte dort buchen.</p><label class="field"><span class="field-label">Grund</span><input class="input lg" name="grund" required maxlength="300"></label><p class="form-err" role="alert" hidden></p></form>', fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn danger" type="submit" form="stf">Stornieren</button>' });
      $('#stf', q.el).addEventListener('submit', async (ev) => { ev.preventDefault(); const grund = String(new FormData(ev.target).get('grund') || '').trim(); const err = $('.form-err', q.el); if (!grund) { err.hidden = false; err.textContent = 'Bitte einen Grund angeben.'; return; } try { await post(`/rechnungen/${r.id}/storno`, { grund }); q.zu(); toast('Rechnung storniert.'); wieder(); } catch (x) { err.hidden = false; err.textContent = x.message; } });
    }
  });
}

const summen = (liste) => { const l = liste.filter((r) => r.status !== 'storniert'); const s = (f) => rund(l.reduce((a, r) => a + vz(r) * (f(r) || 0), 0)); return { netto: s((r) => r.netto), brutto: s((r) => r.brutto), bezahlt: s((r) => r.bezahlt), offen: s((r) => r.offen), ruecklass: s((r) => r.ruecklassOffen) }; };
const tabelle = (liste, mitBs) => `<div class="tbl-wrap"><table class="tbl re-tbl" id="re-tabelle"><thead><tr><th>Nr.</th>${mitBs ? '<th>Bauvorhaben</th><th>Auftraggeber</th>' : '<th>Art</th>'}<th>Datum</th><th>Fällig</th><th class="num">Brutto</th><th class="num">Offen</th><th>Status</th></tr></thead><tbody>${liste.map((r) => `<tr data-rechnung="${r.id}" tabindex="0" role="button" aria-label="Rechnung ${esc(r.nr)} öffnen"><td><b>${esc(r.nr)}</b></td>${mitBs ? `<td>${esc((r.baustelle && (r.baustelle.kst ? r.baustelle.kst + ' ' : '') + (r.baustelle.name || '')) || '')}</td><td>${esc((r.baustelle && r.baustelle.auftraggeber) || '–')}</td>` : `<td>${esc(R_TYP[r.typ] || r.typ)}</td>`}<td>${esc(fmt.datum(r.datum))}</td><td>${esc(r.faellig ? fmt.datum(r.faellig) : '–')}</td><td class="num">${r.typ === 'gutschrift' ? '− ' : ''}${fmt.eur(r.brutto)}</td><td class="num">${fmt.eur(r.offen)}</td><td>${rStatus(r)}</td></tr>`).join('')}</tbody></table></div>`;
function zeilenKlick(el, ctx, neu) {
  const auf = (e) => { const z = e.target.closest('[data-rechnung]'); if (z && z.matches('tr')) rechnungOeffnen(ctx, z.dataset.rechnung, neu); };
  el.addEventListener('click', auf);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { const z = e.target.closest('tr[data-rechnung]'); if (z) { e.preventDefault(); auf(e); } } });
}

/* ---------- Reiter „Rechnungen“ einer Baustelle ---------- */
export async function rechnungenTab(box, b, ctx) {
  const darf = ctx.kann('preise_bearbeiten');
  let liste = [], fehler = '';
  async function lade() { fehler = ''; try { liste = await get(`/rechnungen?baustelleId=${b.id}`); } catch (e) { if (e.status === 401 || e.netz) throw e; fehler = e.status === 403 ? 'Kein Zugriff auf die Rechnungen dieser Baustelle.' : e.message; liste = []; } }
  function zeichne() {
    const s = summen(liste);
    box.innerHTML = fehler ? banner('err', esc(fehler)) : `<div class="stack" id="rechnungen">
      <div class="toolbar wrap"><p class="muted sm weit">Rechnungen werden in BMD bzw. Auer Success geschrieben und hier mit PDF und Kopfdaten erfasst.</p>${darf ? `<button type="button" class="btn ghost" id="re-bmd">${ic('download')}Offene Posten aus BMD importieren</button><button type="button" class="btn primary" id="re-neu">${ic('plus')}Rechnung erfassen</button>` : ''}</div>
      <div class="kpi-row four" id="re-summen"><div class="kpi sm"><small>Verrechnet (netto)</small><b data-summe="netto">${fmt.eur(s.netto)}</b></div><div class="kpi sm"><small>Bezahlt</small><b data-summe="bezahlt">${fmt.eur(s.bezahlt)}</b></div><div class="kpi sm"><small>Offen</small><b data-summe="offen" class="${s.offen > 0 ? 'neg' : ''}">${fmt.eur(s.offen)}</b></div><div class="kpi sm"><small>Rücklass offen</small><b data-summe="ruecklass">${fmt.eur(s.ruecklass)}</b></div></div>
      <section class="card">${liste.length ? tabelle(liste, false) : leer('Noch keine Rechnung erfasst.', 'euro')}</section></div>`;
  }
  const neu = async () => { await lade(); zeichne(); ctx.meldungenNeu(); };
  box.addEventListener('click', (e) => {
    if (e.target.closest('#re-neu')) return rechnungDialog(ctx, b, null, neu);
    if (e.target.closest('#re-bmd')) return importAssistent(ctx, 'bmd-op', { fertig: neu });
  });
  zeilenKlick(box, ctx, neu);
  await lade(); zeichne();
}

/* ---------- Offene Posten (Büro/GF; Bauleiter liest eigene Baustellen) ---------- */
export async function offenePosten(el, ctx) {
  const darf = ctx.kann('preise_bearbeiten');
  let d = null, filter = ctx.query.get('status') || '', ag = '';
  async function lade() { d = await get('/offene-posten'); }
  await lade();
  function zeichne() {
    const q = ag.trim().toLowerCase();
    const l = (d.posten || []).filter((r) => (!filter || r.status === filter) && (!q || `${(r.baustelle && r.baustelle.auftraggeber) || ''} ${(r.baustelle && r.baustelle.name) || ''} ${r.nr}`.toLowerCase().includes(q)));
    const anz = (s) => (d.posten || []).filter((r) => r.status === s).length;
    el.innerHTML = `<div class="page" id="offene-posten">
      <div class="toolbar wrap"><p class="muted sm weit">Zahlungsstand laut Erfassung und BMD-Import.</p>${darf ? `<button type="button" class="btn primary" id="op-bmd">${ic('download')}Offene Posten aus BMD importieren</button>` : ''}<a class="btn ghost" id="op-csv" href="/api/offene-posten.csv" download>${ic('download')}CSV</a><a class="btn ghost" id="op-zahlungen-csv" href="/api/zahlungseingaenge.csv" download>${ic('download')}Zahlungseingänge</a></div>
      <div class="kpi-row four"><div class="kpi" data-kpi="offen"><small>Offen</small><b>${fmt.eur(d.summeOffen)}</b><em>${d.anzahlOffen ?? 0} Rechnungen</em></div><div class="kpi" data-kpi="ueberfaellig"><small>Davon überfällig</small><b class="${d.summeUeberfaellig > 0 ? 'neg' : ''}">${fmt.eur(d.summeUeberfaellig)}</b><em>${d.anzahlUeberfaellig ?? 0} Rechnungen</em></div><div class="kpi" data-kpi="ruecklass"><small>Rücklässe offen</small><b>${fmt.eur(d.ruecklaesseOffen)}</b><em>${(d.ruecklaesse || []).length} Bauvorhaben</em></div><div class="kpi" data-kpi="dauer"><small>Ø Zahlungsdauer</small><b>${d.zahlungsdauerTage != null ? fmt.zahl(d.zahlungsdauerTage, 0) + ' <i>Tage</i>' : '–'}</b><em>letzte 12 Monate</em></div></div>
      <div class="toolbar wrap"><div class="chip-row" role="group" aria-label="Status">${[['', 'Alle', (d.posten || []).length], ['ueberfaellig', 'Überfällig', anz('ueberfaellig')], ['offen', 'Offen', anz('offen')], ['teilbezahlt', 'Teilbezahlt', anz('teilbezahlt')]].map(([k, t, n]) => `<button type="button" class="chip-btn${filter === k ? ' on' : ''}" data-op-filter="${k}" aria-pressed="${filter === k}">${t} <span>${n}</span></button>`).join('')}</div><label class="search weit"><span>${ic('user')}</span><input type="search" id="op-suche" placeholder="Auftraggeber, Bauvorhaben oder Rechnungs-Nr." aria-label="Offene Posten durchsuchen" value="${esc(ag)}"></label></div>
      <section class="card" id="op-liste">${l.length ? tabelle(l, true) : leer((d.posten || []).length ? 'Kein Posten für diesen Filter.' : 'Keine offenen Posten.', 'check')}</section>
      <div class="two-col">
        <section class="card" aria-labelledby="h-opag"><div class="card-h pad-h"><h3 id="h-opag">Je Auftraggeber</h3></div>${(d.jeAuftraggeber || []).length ? `<ul class="plain rows" id="op-auftraggeber">${d.jeAuftraggeber.map((a) => `<li><span class="grow"><b>${esc(a.auftraggeber || '–')}</b><small>${a.anzahl} Rechnung${a.anzahl === 1 ? '' : 'en'}${a.ueberfaellig > 0 ? ` · überfällig ${fmt.eur(a.ueberfaellig)}` : ''}</small></span><b class="num">${fmt.eur(a.offen)}</b></li>`).join('')}</ul>` : '<p class="muted sm pad-s">–</p>'}</section>
        <section class="card" aria-labelledby="h-oprl"><div class="card-h pad-h"><h3 id="h-oprl">Rücklässe</h3></div>${(d.ruecklaesse || []).length ? `<ul class="plain rows" id="op-ruecklaesse">${d.ruecklaesse.map((x) => `<li><span class="grow"><b>${esc((x.baustelle && (x.baustelle.name || x.baustelle)) || '')}</b><small>Rechnung ${esc(x.nr)}${x.ruecklassFaellig ? ' · frei ab ' + esc(fmt.datum(x.ruecklassFaellig)) : ''}</small></span><b class="num">${fmt.eur(x.ruecklassOffen)}</b></li>`).join('')}</ul>` : '<p class="muted sm pad-s">Keine offenen Rücklässe.</p>'}</section>
      </div></div>`;
  }
  const neu = async () => { try { await lade(); } catch (x) { toast(x.message, 'warn'); } if (ctx.aktuell()) zeichne(); };
  el.addEventListener('click', (e) => {
    const f = e.target.closest('[data-op-filter]'); if (f) { filter = f.dataset.opFilter; return zeichne(); }
    if (e.target.closest('#op-bmd')) return importAssistent(ctx, 'bmd-op', { fertig: neu });
  });
  el.addEventListener('input', (e) => { if (e.target.id === 'op-suche') { ag = e.target.value; const pos = e.target.selectionStart; zeichne(); const s = $('#op-suche', el); s.focus(); s.setSelectionRange(pos, pos); } });
  zeilenKlick(el, ctx, neu);
  zeichne();
}
