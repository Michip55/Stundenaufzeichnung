// Ausgangsrechnungen, Zahlungen und Offene Posten (API.md 12.17) sowie der BMD-Import (12.20).
// Rechnungen werden in Auer geschrieben – BauTag erfasst sie nur (PDF + Kopfdaten wie auf dem Papier, 15.24) und hält den Zahlungsstand.
// Alle Beträge kommen vom Server; ohne Preis-Recht gibt es diese Ansichten nicht.
import { get, post, put, del } from '../api.js';
import { ic, esc, fmt, geldFelder, geldWert, leer, banner, dialog, bestaetigen, toast, $, $$ } from '../ui.js';
import { wienHeute, parseZahl } from '../zahl.js';
import { dateiBase64 } from './dokumente.js';
import { importAssistent } from './import.js';

export const R_TYP = { abschlag: 'Abschlagsrechnung', teil: 'Teilrechnung', schluss: 'Schlussrechnung', regie: 'Regierechnung', gutschrift: 'Gutschrift' };
const R_STATUS = { offen: ['offen', 'st-blue'], teilbezahlt: ['teilbezahlt', 'st-amber'], bezahlt: ['bezahlt', 'st-green'], differenz: ['bezahlt · Differenz strittig', 'st-amber'], ueberfaellig: ['überfällig', 'st-red'], storniert: ['storniert', 'st-grey'] };
const MAHN = { 1: 'Zahlungserinnerung', 2: '1. Mahnung', 3: '2. Mahnung' };
export const rStatus = (r) => { const [t, c] = R_STATUS[r.status] || [r.status, 'st-grey']; return `<span class="chip ${c}" data-r-status="${esc(r.status)}">${esc(t)}${r.status === 'ueberfaellig' && r.ueberfaelligTage ? ` ${r.ueberfaelligTage} Tage` : ''}</span>${r.mahnstufe ? `<span class="chip xs st-orange" data-mahnstufe="${r.mahnstufe}">${esc(MAHN[r.mahnstufe] || 'Mahnstufe ' + r.mahnstufe)}</span>` : ''}`; };
const vz = (r) => (r.typ === 'gutschrift' ? -1 : 1);
const rund = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const prozent = (s) => { const t = String(s || '').trim().replace(',', '.'); return t === '' ? null : Number(t); };

/* ---------- Rechnung erfassen / bearbeiten (15.24: wie auf dem Papier, in sechs Abschnitten) ---------- */
// Jede Rechnung hat ihre eigenen Werte (Inhaber 17.11.2026): Nr., Zahlungsziel, Skonto, USt-Art werden je Rechnung eingetragen –
// keine versteckten Vorgaben. Angeboten wird höchstens sichtbar „Werte der letzten Rechnung an diesen Auftraggeber übernehmen“.
const RLA = { deckung: 'Deckungsrücklass', haft: 'Haftrücklass' };
const pv = (betrag, p) => (betrag && p ? Math.sign(betrag) * Math.round(Math.abs(betrag) * p + 1e-7) / 100 : 0); // Prozent auf Cent (kaufmännisch)
const zt = (n) => (n == null ? '' : String(n).replace('.', ','));
const artVon = (x) => (!x ? '' : x.eingabe);
const wertVon = (x) => (!x ? '' : x.eingabe === 'betrag' ? fmt.betrag(x.betrag) : zt(x.prozent));
const auswahlArt = (name, wert, keinText, dis, mitZahlbetrag = false) => `<select class="input lg" name="${name}" ${dis}><option value="">${keinText}</option><option value="prozent" ${wert === 'prozent' ? 'selected' : ''}>in %</option><option value="betrag" ${wert === 'betrag' ? 'selected' : ''}>in €</option>${mitZahlbetrag ? `<option value="zahlbetrag" ${wert === 'zahlbetrag' ? 'selected' : ''}>Zahlbetrag mit Skonto</option>` : ''}</select>`;
// 15.26: Beschriftung des Skonto-Werts je Eingabe-Art (in % · in € · Betrag laut Rechnung nach Skonto)
const SK_LABEL = { prozent: 'Skonto in %', betrag: 'Skonto in €', zahlbetrag: 'Zahlbetrag mit Skonto in €' };
const SK_PLATZ = { prozent: 'z. B. 3', betrag: 'z. B. 53,27', zahlbetrag: 'z. B. 45.163,20' };
const SK_EINGABE = { prozent: 'in %', betrag: 'als Betrag', zahlbetrag: 'als Zahlbetrag mit Skonto' };
/** Skonto-Zeilen unter dem Zahlbetrag (15.26): „Skonto 3 % bis 02.12. − € …“ und „Zahlbetrag mit Skonto € …“ */
const skontoZeilen = (zeile, prozentWert, skonto, mitSkonto, bis) => `<div data-skonto-wert><dt>Skonto ${esc(fmt.zahl(prozentWert))} %${bis ? ` bis ${esc(fmt.datum(bis).slice(0, 6))}` : ''}</dt><dd>− ${fmt.eur(skonto)}</dd></div>${zeile(mitSkonto)}`;
const abschnitt = (nr, titel, inhalt, extra = '') => `<section class="re-teil full" data-teil="${nr}"><h4 class="re-h"><span>${nr}</span>${titel}</h4><div class="re-felder">${inhalt}</div>${extra}</section>`;

export async function rechnungDialog(ctx, b, r, fertig) {
  const heute = wienHeute();
  const gesperrt = r && (r.zahlungen || []).length > 0;
  const dis = gesperrt ? 'disabled' : '';
  // Baustellen zur Auswahl (Rechnungen-Seite); im Reiter einer Baustelle steht sie fest
  let baustellen = b && b.id ? [b] : [];
  if (!r && (!b || !b.id)) { try { baustellen = (await get('/baustellen?alle=1')).filter((x) => !x.intern); } catch (x) { toast(x.message, 'warn'); return; } }
  const bsWahl = b && b.id ? b.id : '';
  const empfVon = (x) => (x ? [x.auftraggeber, x.agAdresse].filter(Boolean).join(', ') : '');
  const skArt = r ? r.skontoEingabe || '' : '';
  const dlg = dialog({ titel: r ? `Rechnung ${r.nr} bearbeiten` : 'Rechnung erfassen', breit: true, inhalt: `<form id="ref" class="form-grid re-form" novalidate>
    ${r ? '' : `<p class="muted sm full">Die Rechnung wird in Auer geschrieben. Hier werden ihre Kopfdaten wie auf dem Papier und das PDF erfasst, damit Zahlungsstand, Fälligkeiten und offene Posten stimmen.</p>`}
    ${gesperrt ? `<div class="full">${banner('info', 'Es gibt bereits Zahlungen – Beträge, Umsatzsteuer, Rücklässe, Rechnungsdatum und Skonto sind gesperrt; eine Rechnung wird nicht mehr zur Gutschrift (und umgekehrt).')}</div>` : ''}
    ${abschnitt(1, 'Rechnung', `
      <label class="field"><span class="field-label">Rechnungs-Nr. (wie in Auer)</span><input class="input lg" name="nr" required maxlength="40" autocomplete="off" placeholder="z. B. 000/W26" value="${esc((r && r.nr) || '')}"></label>
      <label class="field"><span class="field-label">Art</span><select class="input lg" name="typ">${Object.entries(R_TYP).map(([k, t]) => `<option value="${k}" ${(r ? r.typ : 'abschlag') === k ? 'selected' : ''} ${gesperrt && (k === 'gutschrift') !== (r.typ === 'gutschrift') ? 'disabled' : ''}>${t}</option>`).join('')}</select></label>
      <label class="field"><span class="field-label">Rechnungsdatum</span><input class="input lg" type="date" name="datum" required value="${esc((r && r.datum) || heute)}" ${dis}></label>
      <div class="field"><span class="field-label">Leistungszeitraum</span><span class="re-zeitraum"><input class="input lg" type="date" name="leistungVon" aria-label="Leistungszeitraum von" value="${esc((r && r.leistungVon) || '')}"><span class="muted">bis</span><input class="input lg" type="date" name="leistungBis" aria-label="Leistungszeitraum bis" value="${esc((r && r.leistungBis) || '')}"></span></div>`)}
    ${abschnitt(2, 'Auftraggeber &amp; Baustelle', `
      <label class="field full"><span class="field-label">Baustelle</span><select class="input lg" name="baustelle" required ${r || (b && b.id) ? 'disabled' : ''}>${r ? `<option>${esc(`${(r.baustelle && r.baustelle.kst) || ''} ${(r.baustelle && r.baustelle.name) || ''}`)}</option>` : `${bsWahl ? '' : '<option value="">– Baustelle wählen –</option>'}${baustellen.map((x) => `<option value="${x.id}" ${x.id === bsWahl ? 'selected' : ''}>${esc(`${x.kst || ''} ${x.name || ''}${x.auftraggeber ? ' · ' + x.auftraggeber : ''}`)}</option>`).join('')}`}</select></label>
      <label class="field full"><span class="field-label">Rechnungsempfänger</span><input class="input lg" name="empfaenger" maxlength="300" autocomplete="off" placeholder="Auftraggeber, Adresse" value="${esc(r ? r.empfaenger : empfVon(b && b.id ? b : null))}"></label>
      <label class="field full"><span class="field-label">KSt. / Zeichen des Auftraggebers <small class="muted">(optional)</small></span><input class="input lg" name="agZeichen" maxlength="100" autocomplete="off" placeholder="z. B. KSt.: 030/1643.00" value="${esc((r && r.agZeichen) || '')}"></label>`,
      r ? '' : '<div class="re-vorschlag" id="re-vorschlag" hidden></div>')}
    ${abschnitt(3, 'Beträge', `
      <fieldset class="field full"><legend class="field-label">Umsatzsteuer</legend><div class="chk-row"><label class="check-inline"><input type="radio" name="ustModus" value="normal" ${r && r.ustModus !== 'reverse_charge' ? 'checked' : ''} ${dis}> 20 % USt</label><label class="check-inline"><input type="radio" name="ustModus" value="reverse_charge" ${r && r.ustModus === 'reverse_charge' ? 'checked' : ''} ${dis}> Reverse Charge (netto, 0 %)</label></div>
        <small class="muted" id="rc-hinweis" hidden>Übergang der Steuerschuld bei Bauleistungen (§ 19 Abs. 1a UStG): Die Rechnung weist keine USt aus.</small></fieldset>
      <div class="re-drei full">
      <label class="field"><span class="field-label">Netto in Euro</span><input class="input lg num" name="netto" data-geld inputmode="decimal" autocomplete="off" required value="${r ? fmt.betrag(r.netto) : ''}" placeholder="0,00" ${dis}></label>
      <label class="field"><span class="field-label">USt-Betrag in Euro</span><input class="input lg num" name="ustBetrag" data-geld="leer" inputmode="decimal" autocomplete="off" value="${r ? fmt.betrag(r.ust) : ''}" placeholder="0,00" ${dis}></label>
      <label class="field"><span class="field-label">Brutto in Euro</span><input class="input lg num" name="brutto" data-geld="leer" inputmode="decimal" autocomplete="off" value="${r ? fmt.betrag(r.brutto) : ''}" placeholder="0,00" ${dis}></label>
      </div>
      <div class="full re-papier" id="re-papier" aria-live="polite"></div>`)}
    ${abschnitt(4, 'Zahlungsbedingungen', `
      <label class="field"><span class="field-label">Skonto</span>${auswahlArt('skontoArt', skArt, 'kein Skonto', dis, true)}</label>
      <label class="field" data-skonto><span class="field-label" id="sk-einheit">${SK_LABEL[skArt] || SK_LABEL.prozent}</span><input class="input lg num" name="skontoWert" inputmode="decimal" autocomplete="off" value="${r && skArt === 'betrag' ? fmt.betrag(r.skontoBetrag) : r && skArt === 'zahlbetrag' ? fmt.betrag(r.zahlbetragMitSkonto) : r && skArt === 'prozent' ? zt(r.skontoProzent) : ''}" placeholder="${SK_PLATZ[skArt] || SK_PLATZ.prozent}" ${dis}></label>
      <div class="full re-sk-kontrolle" id="re-sk-kontrolle" ${skArt === 'zahlbetrag' ? '' : 'hidden'}>
        <label class="field"><span class="field-label">Skonto % laut Rechnung <small class="muted">(zur Kontrolle, freiwillig)</small></span><input class="input lg num" name="skontoKontrolle" inputmode="decimal" autocomplete="off" placeholder="z. B. 3" ${dis}></label>
        <div class="re-papier" id="re-skonto" aria-live="polite"></div></div>
      <label class="field" data-skonto><span class="field-label">Skonto bis (Tage)</span><input class="input lg num" name="skontoTage" inputmode="numeric" autocomplete="off" value="${r && r.skontoTage != null ? r.skontoTage : ''}" placeholder="z. B. 21" ${dis}></label>
      <label class="field"><span class="field-label">Zahlungsziel (Tage)</span><input class="input lg num" name="zahlungszielTage" inputmode="numeric" autocomplete="off" required value="${r ? r.zahlungszielTage ?? '' : ''}" placeholder="z. B. 30"></label>
      <div class="full re-bedingungen" id="re-bedingungen" aria-live="polite"></div>`)}
    ${abschnitt(5, 'Rücklässe', ['deckung', 'haft'].map((a) => `
      <div class="re-rl full" data-rl="${a}"><span class="re-rl-t">${RLA[a]}</span>
        ${auswahlArt(`${a}Art`, artVon(r && (a === 'haft' ? r.haftruecklass : r.deckungsruecklass)), `kein ${RLA[a]}`, dis).replace('class="input lg"', `class="input lg" aria-label="${RLA[a]}"`)}
        <input class="input lg num" name="${a}Wert" inputmode="decimal" autocomplete="off" aria-label="${RLA[a]} Wert" value="${esc(wertVon(r && (a === 'haft' ? r.haftruecklass : r.deckungsruecklass)))}" placeholder="z. B. 5" ${dis}>
        ${a === 'haft' ? `<label class="re-frei"><span class="muted sm">frei ab</span><input class="input lg" type="date" name="haftFreiAb" aria-label="Haftrücklass frei ab" value="${esc((r && r.haftruecklass && r.haftruecklass.freiAbLautRechnung) || '')}"></label>` : ''}</div>`).join('') + '<small class="muted full">Prozent vom Brutto. Haftrücklass ohne Datum: frei laut Bauvorhaben (Freigabe bzw. Ende der Gewährleistung); Deckungsrücklass wird mit der Schlussrechnung frei.</small>')}
    <div class="full re-vorschau" id="re-vorschau" aria-live="polite"></div>
    ${abschnitt(6, 'Anhang &amp; Notiz', `
      <label class="field full"><span class="field-label">Rechnungs-PDF ${r && r.dokumentId ? '(ersetzen)' : '(aus Auer)'}</span><input class="input lg" type="file" name="pdf" accept="application/pdf,.pdf"><small class="muted">Wird unter „Dokumente → Ausgangsrechnungen“ der Baustelle abgelegt.</small></label>
      <label class="field full"><span class="field-label">Notiz</span><input class="input lg" name="notiz" maxlength="500" value="${esc((r && r.notiz) || '')}"></label>`)}
    <p class="form-err full" role="alert" hidden></p></form>`,
    fuss: `<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="ref" id="re-ok">${r ? 'Speichern' : 'Rechnung erfassen'}</button>` });
  dlg.el.classList.add('re-dlg');
  geldFelder(dlg.el);
  const form = $('#ref', dlg.el);
  const E = form.elements;
  // USt und Brutto werden aus Netto vorbelegt, bis man sie selbst ändert (Werte von der Rechnung abschreiben)
  const hand = { ustBetrag: !!(r && r.ustLautRechnung), brutto: !!(r && r.ustLautRechnung), empfaenger: !!r };
  for (const k of Object.keys(hand)) E[k].addEventListener('input', () => { hand[k] = E[k].value.trim() !== ''; });
  const bsAktuell = () => (r ? null : baustellen.find((x) => String(x.id) === String(E.baustelle.value)) || null);
  const zahl = (s) => { const t = String(s || '').trim(); if (!t) return null; const n = parseZahl(t); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN; };
  const prozentZahl = (s) => { const t = String(s || '').trim().replace(',', '.'); return t === '' ? null : Number(t); };
  const wert = (art, roh) => (art === 'betrag' || art === 'zahlbetrag' ? zahl(roh) : prozentZahl(roh));
  let stand = {};
  function rechne() {
    const rcEl = form.querySelector('[name="ustModus"]:checked');
    const modus = rcEl ? rcEl.value : null, rc = modus === 'reverse_charge';
    $('#rc-hinweis', dlg.el).hidden = !rc;
    const gs = E.typ.value === 'gutschrift';
    for (const a of ['deckung', 'haft']) { if (gs && E[`${a}Art`].value) E[`${a}Art`].value = ''; E[`${a}Art`].disabled = gesperrt || gs; }
    for (const a of ['deckung', 'haft', 'skonto']) { const aus = !E[`${a}Art`].value; E[`${a}Wert`].disabled = gesperrt || aus; if (aus) E[`${a}Wert`].value = ''; }
    E.skontoTage.disabled = gesperrt || !E.skontoArt.value; if (!E.skontoArt.value) E.skontoTage.value = '';
    E.haftFreiAb.disabled = !E.haftArt.value;
    $('#sk-einheit', dlg.el).textContent = SK_LABEL[E.skontoArt.value] || SK_LABEL.prozent;
    E.skontoWert.placeholder = SK_PLATZ[E.skontoArt.value] || SK_PLATZ.prozent;
    const mitZb = E.skontoArt.value === 'zahlbetrag';
    $('#re-sk-kontrolle', dlg.el).hidden = !mitZb;
    if (!mitZb) E.skontoKontrolle.value = '';
    E.ustBetrag.readOnly = rc;
    const netto = geldWert(E.netto);
    const ok = Number.isFinite(netto) && netto != null;
    if (!gesperrt && ok && modus) {
      const ustG = rc ? 0 : pv(netto, 20);
      if (rc || !hand.ustBetrag) E.ustBetrag.value = fmt.betrag(ustG);
      const ust = geldWert(E.ustBetrag);
      if (!hand.brutto && Number.isFinite(ust) && ust != null) E.brutto.value = fmt.betrag(rund(netto + ust));
      E.ustBetrag.dispatchEvent(new Event('echo')); E.brutto.dispatchEvent(new Event('echo'));
    }
    const ust = geldWert(E.ustBetrag), brutto = geldWert(E.brutto);
    // Prüfung wie am Server: ±0,02 €; Reverse Charge → USt 0
    let papier = '', fehlerPapier = '';
    if (ok && modus && Number.isFinite(ust) && ust != null && Number.isFinite(brutto) && brutto != null) {
      const ustG = rc ? 0 : pv(netto, 20);
      if (rc && Math.abs(ust) > 0.004) fehlerPapier = `Reverse Charge: USt muss 0,00 sein.`;
      else if (Math.abs(ust - ustG) > 0.0201) fehlerPapier = `USt passt nicht zum Netto: ${fmt.eur(netto)} × 20 % = ${fmt.eur(ustG)}, eingetragen ${fmt.eur(ust)}.`;
      else if (Math.abs(brutto - (netto + ust)) > 0.0201) fehlerPapier = `Brutto passt nicht: ${fmt.eur(netto)} + ${fmt.eur(ust)} = ${fmt.eur(rund(netto + ust))}, eingetragen ${fmt.eur(brutto)}.`;
      papier = fehlerPapier ? `<span class="re-hinweis warn" data-papier="abweichung">${ic('alert')}<span>${esc(fehlerPapier)} Bitte mit der Rechnung vergleichen.</span></span>` : `<span class="re-hinweis ok" data-papier="ok">${ic('check')}<span>Netto + USt = Brutto – passt zur Rechnung.</span></span>`;
    } else if (!modus) papier = '<span class="re-hinweis" data-papier="offen"><span class="muted">Bitte die Umsatzsteuer wählen: 20 % oder Reverse Charge.</span></span>';
    $('#re-papier', dlg.el).innerHTML = papier;
    // Rücklässe und Zahlbetrag
    const br = Number.isFinite(brutto) && brutto != null ? brutto : null;
    const rl = {};
    for (const a of ['deckung', 'haft']) { const art = E[`${a}Art`].value, w = wert(art, E[`${a}Wert`].value); rl[a] = !art || w == null || !Number.isFinite(w) || br == null ? 0 : art === 'betrag' ? w : pv(br, w); }
    const zahlbetrag = br == null ? null : rund(br - rl.deckung - rl.haft);
    // Zahlungsbedingungen wie in Auer: „21 Tage (bis 27.05.2026) · 3 % Skonto · € 1.722,48“
    const rd = E.datum.value || (r && r.datum);
    const ziel = E.zahlungszielTage.value.trim() === '' ? null : Number(E.zahlungszielTage.value);
    const skArtW = E.skontoArt.value, skW = wert(skArtW, E.skontoWert.value), skT = E.skontoTage.value.trim() === '' ? null : Number(E.skontoTage.value);
    // 15.26 „Zahlbetrag mit Skonto“: eingetragen ist der Betrag nach Skonto → Skonto € = Zahlbetrag − Betrag (nur wenn kleiner als der Zahlbetrag)
    const skGueltig = skArtW && Number.isFinite(skW) && skW != null && zahlbetrag != null && (skArtW !== 'zahlbetrag' || (skW > 0 && skW < zahlbetrag - 0.004));
    const skonto = skGueltig ? (skArtW === 'betrag' ? skW : skArtW === 'zahlbetrag' ? rund(zahlbetrag - skW) : pv(zahlbetrag, skW)) : null;
    const skP = skonto != null && skArtW !== 'prozent' && zahlbetrag ? Math.round((skonto / zahlbetrag) * 100000) / 1000 : skW;
    const skBis = Number.isInteger(skT) && skT >= 0 && rd ? fmt.addTage(rd, skT) : null;
    const zeilen = [];
    if (skArtW && skonto != null && skBis) zeilen.push(`<li data-bedingung="skonto"><b>${skT} Tage</b> (bis ${esc(fmt.datum(skBis))}) · ${esc(fmt.zahl(skP))} % Skonto · <b class="num">${fmt.eur(rund(zahlbetrag - skonto))}</b></li>`);
    if (Number.isInteger(ziel) && ziel >= 0 && rd && zahlbetrag != null) zeilen.push(`<li data-bedingung="ziel"><b>${ziel} Tage</b> (bis ${esc(fmt.datum(fmt.addTage(rd, ziel)))}) · ohne Abzug · <b class="num">${fmt.eur(zahlbetrag)}</b></li>`);
    $('#re-bedingungen', dlg.el).innerHTML = zeilen.length ? `<span class="field-label">Zahlungsvereinbarungen</span><ul class="plain re-bed">${zeilen.join('')}</ul>` : '';
    // 15.26: Kontrolle „Zahlbetrag mit Skonto“ – Hinweis wie bei Netto/USt/Brutto; Skonto % laut Rechnung (freiwillig) wird nachgerechnet
    let skHinweis = '';
    if (mitZb && zahlbetrag != null && E.skontoWert.value.trim()) {
      const hinweis = (art, text, icon) => `<span class="re-hinweis${art === 'info' ? '' : art === 'ok' ? ' ok' : ' warn'}" data-skonto="${art}">${icon ? ic(icon) : ''}<span${art === 'info' ? ' class="muted"' : ''}>${text}</span></span>`;
      const kRoh = E.skontoKontrolle.value.trim(), kP = prozentZahl(kRoh);
      if (!Number.isFinite(skW) || skW == null || !(skW > 0)) skHinweis = hinweis('unklar', 'Betrag unklar – bitte so schreiben wie auf der Rechnung, z. B. 45.163,20.', 'alert');
      else if (!(skW < zahlbetrag - 0.004)) skHinweis = hinweis('zu-hoch', `Der Zahlbetrag mit Skonto muss kleiner sein als der Zahlbetrag (${esc(fmt.eur(zahlbetrag))}).`, 'alert');
      else if (skonto > zahlbetrag * 0.1 + 0.005) skHinweis = hinweis('zu-viel', `Ergibt ${esc(fmt.zahl(skP))} % Skonto (${esc(fmt.eur(skonto))}) – höchstens 10 % sind möglich. Bitte mit der Rechnung vergleichen.`, 'alert');
      else if (kRoh && !(Number.isFinite(kP) && kP > 0 && kP <= 10)) skHinweis = hinweis('kontrolle-unklar', 'Skonto % zur Kontrolle unklar – bitte so schreiben: 3 oder 2,5.', 'alert');
      else if (kRoh) {
        const gerechnet = rund(zahlbetrag - pv(zahlbetrag, kP));
        skHinweis = Math.abs(gerechnet - skW) > 0.0101
          ? hinweis('abweichung', `Skonto ${esc(fmt.zahl(kP))} %: Papier ${esc(fmt.betrag(skW))} – gerechnet ${esc(fmt.betrag(gerechnet))}, bitte prüfen.`, 'alert')
          : hinweis('ok', `Zahlbetrag − ${esc(fmt.zahl(kP))} % Skonto = ${esc(fmt.betrag(gerechnet))} – passt zur Rechnung.`, 'check');
      } else skHinweis = hinweis('info', `Ergibt Skonto ${esc(fmt.eur(skonto))} (${esc(fmt.zahl(skP))} %).`);
    }
    $('#re-skonto', dlg.el).innerHTML = skHinweis;
    const box = $('#re-vorschau', dlg.el);
    // Gutschrift: kein Abzug von Skonto (wie Fälligkeiten und „Als bezahlt markieren“) – daher keine „mit Skonto“-Zeilen
    box.innerHTML = br == null ? '' : `<dl class="re-summe"><div><dt>Netto</dt><dd>${fmt.eur(ok ? netto : null)}</dd></div><div><dt>USt ${rc ? '(Reverse Charge)' : '20 %'}</dt><dd>${fmt.eur(ust)}</dd></div><div><dt>Brutto</dt><dd>${fmt.eur(br)}</dd></div>${rl.deckung ? `<div data-rl-wert="deckung"><dt>Deckungsrücklass</dt><dd>− ${fmt.eur(rl.deckung)}</dd></div>` : ''}${rl.haft ? `<div data-rl-wert="haft"><dt>Haftrücklass</dt><dd>− ${fmt.eur(rl.haft)}</dd></div>` : ''}<div class="sum"><dt>Zahlbetrag</dt><dd id="re-zahlbetrag">${fmt.eur(zahlbetrag)}</dd></div>${!gs && skonto > 0 ? skontoZeilen((w) => `<div class="sum" data-zahlbetrag-skonto><dt>Zahlbetrag mit Skonto</dt><dd id="re-zahlbetrag-skonto">${fmt.eur(w)}</dd></div>`, skP, skonto, rund(zahlbetrag - skonto), skBis) : ''}</dl>`;
    stand = { modus, netto, ust, brutto, fehlerPapier, rl, zahlbetrag, skArtW, skW, skT, skonto, skP, ziel };
  }
  // sichtbarer Vorschlag: Werte der letzten Rechnung an denselben Auftraggeber (nur auf Knopfdruck übernommen)
  async function vorschlag() {
    const box = $('#re-vorschlag', dlg.el); if (!box) return;
    const bs = bsAktuell();
    if (!hand.empfaenger) E.empfaenger.value = empfVon(bs);
    box.hidden = true;
    if (!bs || !bs.auftraggeber) return;
    let l = [];
    try { l = (await get(`/rechnungen?auftraggeber=${encodeURIComponent(bs.auftraggeber)}`)).filter((x) => x.baustelle && x.baustelle.auftraggeber === bs.auftraggeber && x.status !== 'storniert'); } catch (_) { return; }
    const v = l[0]; if (!v || bsAktuell() !== bs) return;
    // „Zahlbetrag mit Skonto“ gilt nur für die eine Rechnung – übernommen wird der Prozentsatz
    const skE = v.skontoEingabe === 'zahlbetrag' ? 'prozent' : v.skontoEingabe;
    const sk = skE ? `${skE === 'betrag' ? fmt.eur(v.skontoBetrag) : fmt.zahl(v.skontoProzent) + ' %'} Skonto ${v.skontoTage} Tage` : 'kein Skonto';
    box.innerHTML = `<span class="grow"><b>Letzte Rechnung an ${esc(bs.auftraggeber)}:</b> ${esc(v.nr)} vom ${esc(fmt.datum(v.datum))} – ${v.ustModus === 'reverse_charge' ? 'Reverse Charge' : '20 % USt'}, Ziel ${v.zahlungszielTage} Tage, ${esc(sk)}</span><button type="button" class="btn ghost sm" id="re-vorschlag-ok">Diese Werte übernehmen</button>`;
    box.hidden = false;
    $('#re-vorschlag-ok', box).onclick = () => {
      form.querySelector(`[name="ustModus"][value="${v.ustModus}"]`).checked = true;
      E.zahlungszielTage.value = v.zahlungszielTage ?? '';
      E.skontoArt.value = skE || '';
      E.skontoWert.value = skE === 'betrag' ? fmt.betrag(v.skontoBetrag) : skE ? zt(v.skontoProzent) : '';
      E.skontoTage.value = skE ? v.skontoTage ?? '' : '';
      skWertArt = skE || '';
      hand.ustBetrag = false; hand.brutto = false;
      rechne(); box.hidden = true; toast('Werte übernommen – bitte mit der Rechnung vergleichen.');
    };
  }
  // 15.26: Wechsel der Skonto-Art rechnet den eingetragenen Wert um (3 % ↔ € 1.396,80 ↔ Zahlbetrag mit Skonto € 45.163,20)
  let skWertArt = skArt;
  function skontoUmrechnen() {
    const alt = skWertArt, neu = E.skontoArt.value;
    skWertArt = neu;
    if (!alt || !neu || alt === neu) return;
    const zb = stand.zahlbetrag, w = wert(alt, E.skontoWert.value);
    const sk = !(zb > 0) || !Number.isFinite(w) || w == null || !(w > 0) ? null : alt === 'prozent' ? pv(zb, w) : alt === 'betrag' ? w : w < zb ? rund(zb - w) : null;
    if (alt === 'prozent' && neu === 'zahlbetrag' && Number.isFinite(w) && w > 0) E.skontoKontrolle.value = zt(w); // Prozent laut Rechnung bleibt zur Kontrolle stehen
    E.skontoWert.value = sk == null || !(sk > 0) ? '' : neu === 'prozent' ? zt(Math.round((sk / zb) * 100000) / 1000) : neu === 'betrag' ? fmt.betrag(sk) : fmt.betrag(rund(zb - sk));
  }
  form.addEventListener('input', rechne); form.addEventListener('change', (e) => { if (e.target.name === 'ustModus' || e.target.name === 'netto') { hand.ustBetrag = hand.ustBetrag && e.target.name !== 'ustModus'; } if (e.target.name === 'baustelle') vorschlag(); if (e.target.name === 'skontoArt') skontoUmrechnen(); rechne(); });
  rechne(); if (!r) vorschlag();
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); rechne(); const f = new FormData(form); const err = $('.form-err', dlg.el);
    const zeig = (t) => { err.hidden = false; err.textContent = t; };
    const bs = r ? b : bsAktuell();
    if (!bs || !bs.id) return zeig('Bitte die Baustelle wählen.');
    const body = { typ: f.get('typ'), nr: String(f.get('nr') || '').trim(), datum: gesperrt ? r.datum : f.get('datum'), leistungVon: f.get('leistungVon') || null, leistungBis: f.get('leistungBis') || null, notiz: String(f.get('notiz') || '').trim(), empfaenger: String(f.get('empfaenger') || '').trim() || null, agZeichen: String(f.get('agZeichen') || '').trim() || null };
    if (!body.nr || !body.datum) return zeig('Bitte Rechnungs-Nr. und Rechnungsdatum eintragen.');
    if (stand.ziel == null || !Number.isInteger(stand.ziel) || stand.ziel < 0) return zeig('Bitte das Zahlungsziel in ganzen Tagen eintragen (0 = sofort fällig).');
    body.zahlungszielTage = stand.ziel;
    if (!gesperrt) {
      if (!stand.modus) return zeig('Bitte die Umsatzsteuer wählen: 20 % oder Reverse Charge.');
      if (!Number.isFinite(stand.netto) || stand.netto == null || stand.netto <= 0) return zeig('Netto-Betrag unklar – bitte so schreiben: 12.500,00 (bei Gutschriften ebenfalls positiv).');
      if (!Number.isFinite(stand.ust) || stand.ust == null || !Number.isFinite(stand.brutto) || stand.brutto == null) return zeig('Bitte USt-Betrag und Brutto wie auf der Rechnung eintragen.');
      if (stand.fehlerPapier) return zeig(`${stand.fehlerPapier} Bitte mit der Rechnung vergleichen.`);
      if (stand.skArtW) {
        if (stand.skArtW === 'zahlbetrag') {
          // 15.26: Betrag laut Rechnung nach Skonto – größer als 0, kleiner als der Zahlbetrag, höchstens 10 % Skonto
          if (!(stand.skW > 0)) return zeig('Zahlbetrag mit Skonto unklar – bitte so schreiben wie auf der Rechnung, z. B. 45.163,20');
          if (!(stand.skW < stand.zahlbetrag - 0.004)) return zeig(`Der Zahlbetrag mit Skonto (${fmt.eur(stand.skW)}) muss kleiner sein als der Zahlbetrag (${fmt.eur(stand.zahlbetrag)}).`);
          if (stand.skonto > stand.zahlbetrag * 0.1 + 0.005) return zeig(`Der Zahlbetrag mit Skonto ergibt ${fmt.zahl(stand.skP)} % Skonto – höchstens 10 % sind möglich. Bitte mit der Rechnung vergleichen.`);
        } else if (!(stand.skW > 0) || (stand.skArtW === 'prozent' && stand.skW > 10)) return zeig(stand.skArtW === 'prozent' ? 'Skonto in Prozent eintragen (0–10).' : 'Skonto-Betrag unklar – bitte so schreiben: 53,27');
        if (!Number.isInteger(stand.skT) || stand.skT < 0) return zeig('Bitte die Skontofrist in Tagen eintragen.');
      }
      Object.assign(body, { netto: stand.netto, ustModus: stand.modus, ustBetrag: stand.ust, brutto: stand.brutto, skontoProzent: stand.skArtW === 'prozent' ? stand.skW : null, skontoBetrag: stand.skArtW === 'betrag' ? stand.skW : null, skontoZahlbetrag: stand.skArtW === 'zahlbetrag' ? stand.skW : null, skontoTage: stand.skArtW ? stand.skT : null });
      for (const a of ['deckung', 'haft']) {
        const art = f.get(`${a}Art`) || '', w = wert(art, f.get(`${a}Wert`));
        if (art && !(w > 0 && (art === 'betrag' || w <= 20))) return zeig(`Bitte den ${RLA[a]} ${art === 'betrag' ? 'in Euro' : 'in Prozent (z. B. 5)'} eintragen – oder „kein ${RLA[a]}“ wählen.`);
        body[`${a}Prozent`] = art === 'prozent' ? w : null; body[`${a}Betrag`] = art === 'betrag' ? w : null;
      }
    }
    body.haftFreiAb = f.get('haftArt') || (gesperrt && r.haftruecklass) ? f.get('haftFreiAb') || null : null;
    $('#re-ok', dlg.el).disabled = true;
    try {
      const pdf = E.pdf.files[0];
      if (pdf) { const dok = await post(`/baustellen/${bs.id}/dokumente`, { kategorie: 'ausgangsrechnungen', titel: `Rechnung ${body.nr}`, datum: body.datum, dateiBase64: await dateiBase64(pdf), dateiname: pdf.name }); body.dokumentId = dok.id; }
      if (r) await put(`/rechnungen/${r.id}`, { ...body, version: r.version }); else await post(`/baustellen/${bs.id}/rechnungen`, body);
      dlg.zu(); toast(r ? 'Rechnung gespeichert.' : `Rechnung ${body.nr} erfasst.`); fertig();
    } catch (x) { $('#re-ok', dlg.el).disabled = false; zeig(x.status === 409 && !(x.daten && x.daten.version != null) ? (x.message || 'Diese Rechnungs-Nr. gibt es schon.') : x.status === 409 ? 'Inzwischen von jemand anderem geändert – bitte schließen und neu laden.' : x.message); }
  });
}

/* ---------- Zahlung erfassen ---------- */
function zahlungDialog(r, fertig) {
  const heute = wienHeute();
  const skontoMoegl = r.skontoBetrag > 0 && r.skontoBis && heute <= r.skontoBis;
  const rlOffen = ['deckung', 'haft'].filter((a) => { const x = a === 'haft' ? r.haftruecklass : r.deckungsruecklass; return x && x.offen > 0; });
  const rlWert = (a) => (a === 'haft' ? r.haftruecklass : r.deckungsruecklass).offen;
  const dlg = dialog({ titel: `Zahlung erfassen · ${r.nr}`, inhalt: `<form id="zaf" class="form-grid" novalidate>
    <p class="muted sm full">Offen: <b>${fmt.eur(r.offen)}</b>${rlOffen.map((a) => ` · ${RLA[a]} offen: <b>${fmt.eur(rlWert(a))}</b>`).join('')}. Teilzahlungen sind möglich. Üblicherweise kommt der Zahlungsstand über den BMD-Import.</p>
    <label class="field"><span class="field-label">Zahlungsdatum</span><input class="input lg" type="date" name="datum" required value="${heute}" max="${heute}"></label>
    <label class="field"><span class="field-label">Betrag in Euro</span><input class="input lg num" name="betrag" data-geld inputmode="decimal" autocomplete="off" required value="${fmt.betrag(r.offen)}"></label>
    <label class="field full"><span class="field-label">Skonto in Euro${r.skontoBetrag ? ` (${fmt.zahl(r.skontoProzent)} % = ${fmt.eur(r.skontoBetrag)} bis ${r.skontoBis ? fmt.datum(r.skontoBis) : '–'})` : ''}</span><input class="input lg num" name="skonto" data-geld="leer" inputmode="decimal" autocomplete="off" placeholder="0,00"><small class="muted">${skontoMoegl ? `Skonto ist noch möglich: höchstens ${fmt.eur(rund(r.skontoBetrag - (r.skontoGenommen || 0)))}.` : 'Skonto nur bei Zahlung innerhalb der Skontofrist.'}</small></label>
    ${rlOffen.length ? `<fieldset class="field full"><legend class="field-label">Wofür ist die Zahlung?</legend><div class="chk-row"><label class="check-inline"><input type="radio" name="wofuer" value="" checked> Rechnung</label>${rlOffen.map((a) => `<label class="check-inline"><input type="radio" name="wofuer" value="${a}"> Auszahlung ${RLA[a]}</label>`).join('')}</div></fieldset>` : ''}
    <label class="field full"><span class="field-label">Notiz</span><input class="input lg" name="notiz" maxlength="300"></label>
    <p class="form-err full" role="alert" hidden></p></form>`, fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="zaf" id="za-ok">Zahlung speichern</button>' });
  geldFelder(dlg.el);
  const form = $('#zaf', dlg.el);
  form.addEventListener('change', (e) => { if (e.target.name === 'wofuer') { form.elements.betrag.value = fmt.betrag(e.target.value ? rlWert(e.target.value) : r.offen); form.elements.betrag.dispatchEvent(new Event('echo')); } });
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(form); const err = $('.form-err', dlg.el);
    const betrag = geldWert(form.elements.betrag), skonto = geldWert(form.elements.skonto);
    if (!Number.isFinite(betrag) || betrag == null || betrag <= 0 || Number.isNaN(skonto)) { err.hidden = false; err.textContent = 'Betrag unklar – bitte so schreiben: 4.800,00'; return; }
    const wofuer = f.get('wofuer') || '';
    try { await post(`/rechnungen/${r.id}/zahlungen`, { datum: f.get('datum'), betrag, ...(skonto ? { skonto } : {}), ...(wofuer ? { ruecklass: true, ruecklassArt: wofuer } : {}), notiz: String(f.get('notiz') || '').trim() }); dlg.zu(); toast('Zahlung gespeichert.'); fertig(); }
    catch (x) { err.hidden = false; err.textContent = x.message; }
  });
}

/* ---------- „Als bezahlt markieren“ (15.24): ein Tipp, kleine Bestätigung, Buchung über rechnung_zahlung, „Rückgängig“ ---------- */
// Vorschlag: heute; in der Skontofrist offen − noch mögliches Skonto, sonst der volle offene Betrag. Rücklässe bleiben offen,
// außer „inkl. Rücklass“. Betrag, Skonto, Datum, Notiz änderbar; Teilzahlungen weiter über „Zahlung buchen“.
const regulaerOffen = (r) => rund((r.offen || 0) - (r.strittig || 0));
const skontoAm = (r, d) => {
  const o = regulaerOffen(r);
  return r.typ !== 'gutschrift' && r.skontoBetrag > 0 && r.skontoBis && d <= r.skontoBis && o > 0 && r.zahlbetrag > 0
    ? Math.max(0, Math.min(rund(r.skontoBetrag - (r.skontoGenommen || 0)), rund((r.skontoBetrag * o) / r.zahlbetrag))) : 0;
};
export async function rueckgaengig(r, ids, fertig) {
  try { await post(`/rechnungen/${r.id}/bezahlt/rueckgaengig`, { zahlungIds: ids }); toast(`Rechnung ${r.nr}: Markierung „bezahlt“ zurückgenommen.`); fertig(); } catch (x) { toast(x.message, 'warn'); }
}
// Gründe einer Differenz (15.24 Zahlungsabgleich) – Reihenfolge wie im Alltag; Überzahlung kommt allein
const GRUENDE = [['skonto', 'Skonto'], ['umlage', 'Umlage/Abzug des Auftraggebers'], ['deckung', 'Deckungsrücklass einbehalten'], ['haft', 'Haftrücklass einbehalten'], ['maengel', 'Mängel/Gegenforderung'], ['spesen', 'Bankspesen/Rundung'], ['sonstiges', 'Sonstiges']];
const UMLAGEN = ['Bauwesenversicherung', 'Baustrom/Wasser', 'Bauschadensumlage', 'Reinigung'];

/*
 * „Als bezahlt markieren“ mit Zahlungsabgleich (15.24): Eingang am, tatsächlich bezahlt; daneben erwartet (mit Skonto, solange
 * der Eingang in der Skontofrist liegt, sonst ohne; Rücklässe getrennt) und die Differenz. Eine Differenz wird in Gründe
 * aufgeteilt (Summe muss stimmen), je Grund „akzeptiert“ (Abzug gilt) oder „strittig“ (bleibt offen); mehr bezahlt → Überzahlung.
 */
export async function bezahltDialog(ctx, rId, fertig) {
  let r;
  try { r = await get(`/rechnungen/${rId}`); } catch (x) { toast(x.message, 'warn'); return; }
  const heute = wienHeute();
  const rl = ['deckung', 'haft'].filter((a) => { const x = a === 'haft' ? r.haftruecklass : r.deckungsruecklass; return x && x.offen > 0; });
  const rlText = rl.map((a) => `${RLA[a]} ${fmt.eur((a === 'haft' ? r.haftruecklass : r.deckungsruecklass).offen)}`).join(' + ');
  const nurRl = !(regulaerOffen(r) > 0);
  const gs = r.typ === 'gutschrift';
  const dlg = dialog({ titel: `Als bezahlt markieren · ${r.nr}`, breit: true, inhalt: `<form id="bzf" class="form-grid" novalidate data-rechnung="${r.id}">
    <p class="full bz-kopf"><b>${esc((r.baustelle && r.baustelle.auftraggeber) || '')}</b> · ${esc(R_TYP[r.typ] || '')} ${esc(r.nr)}<br><span class="muted sm">Offen ${fmt.eur(regulaerOffen(r))}${r.strittig ? ` (dazu strittig ${fmt.eur(r.strittig)})` : ''}${r.skontoBetrag ? ` · Skonto ${esc(fmt.zahl(r.skontoProzent))} % bis ${esc(fmt.datum(r.skontoBis))}` : ' · kein Skonto'}</span></p>
    <label class="field"><span class="field-label">Eingang am</span><input class="input lg" type="date" name="datum" required value="${heute}" max="${heute}"></label>
    ${nurRl ? '' : `<label class="field"><span class="field-label">Tatsächlich bezahlt in Euro</span><input class="input lg num" name="betrag" data-geld inputmode="decimal" autocomplete="off"></label>`}
    ${nurRl ? '<p class="full bz-info">Die Rechnung ist bezahlt – gebucht wird die Auszahlung des Rücklasses.</p>' : `<div class="full bz-abgleich" id="bz-abgleich" aria-live="polite"></div>
    <section class="full bz-gruende" id="bz-gruende" hidden><div class="bz-g-kopf"><b>Differenz aufteilen</b><span id="bz-rest" class="muted sm"></span></div>
      <div id="bz-zeilen" class="bz-zeilen"></div>
      <button type="button" class="btn ghost sm" id="bz-plus">${ic('plus')}Weiterer Grund</button>
      <datalist id="bz-umlagen">${UMLAGEN.map((u) => `<option value="${u}">`).join('')}</datalist></section>`}
    ${rl.length ? `<label class="check-inline full"><input type="checkbox" name="inkl" ${nurRl ? 'checked disabled' : ''}> inkl. Rücklass ausbezahlt (${esc(rlText)})${nurRl ? '' : ' – sonst bleibt er offen'}</label>` : ''}
    <label class="field full"><span class="field-label">Notiz <small class="muted">(optional)</small></span><input class="input lg" name="notiz" maxlength="300" placeholder="z. B. Kontoauszug"></label>
    <p class="form-err full" role="alert" hidden></p></form>`,
    fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="bzf" id="bz-ok">Als bezahlt buchen</button>' });
  dlg.el.classList.add('bz-dlg');
  const form = $('#bzf', dlg.el), E = form.elements;
  geldFelder(dlg.el);
  form.addEventListener('input', () => { $('.form-err', dlg.el).hidden = true; }); form.addEventListener('change', () => { $('.form-err', dlg.el).hidden = true; });
  let stand = { erwartet: 0, skonto: 0, differenz: 0 };
  let zeilen = []; // {grund, text, betrag, status, auto}
  const datum = () => E.datum.value || heute;
  const erwartung = () => { const sk = skontoAm(r, datum()); return { skonto: sk, erwartet: rund(regulaerOffen(r) - sk), spaet: !!(r.skontoBis && datum() > r.skontoBis) }; };
  const zeileHtml = (z, i) => {
    if (z.grund === 'ueberzahlung') return `<div class="bz-zeile ueber" data-zeile="${i}"><span class="bz-ue">${ic('info')}Überzahlung</span><input class="input" data-f="text" aria-label="Notiz zur Überzahlung" placeholder="z. B. rückzahlen / mit nächster Rechnung verrechnen" value="${esc(z.text || '')}" maxlength="200"><b class="num">${fmt.eur(z.betrag)}</b></div>`;
    const rlG = z.grund === 'deckung' || z.grund === 'haft';
    const verspaetet = z.grund === 'skonto' && (erwartung().spaet || !r.skontoBetrag);
    return `<div class="bz-zeile" data-zeile="${i}">
      <select class="input" data-f="grund" aria-label="Grund"><option value="">– Grund –</option>${GRUENDE.map(([k, t]) => `<option value="${k}" ${z.grund === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <input class="input" data-f="text" aria-label="Beschreibung" ${z.grund === 'umlage' ? 'list="bz-umlagen"' : ''} placeholder="${z.grund === 'umlage' ? 'z. B. Bauwesenversicherung' : z.grund === 'sonstiges' ? 'Grund (Pflicht)' : 'Beschreibung (optional)'}" value="${esc(z.text || '')}" maxlength="200">
      <input class="input num" data-f="betrag" inputmode="decimal" aria-label="Betrag" value="${z.betrag ? fmt.betrag(z.betrag) : ''}" placeholder="0,00">
      ${rlG ? '<span class="bz-st einbehalten">einbehalten</span>' : `<select class="input" data-f="status" aria-label="akzeptiert oder strittig"><option value="akzeptiert" ${z.status === 'akzeptiert' ? 'selected' : ''}>akzeptiert</option><option value="strittig" ${z.status === 'strittig' ? 'selected' : ''}>strittig</option></select>`}
      <button type="button" class="icon-btn sm" data-weg="${i}" aria-label="Grund entfernen">${ic('x')}</button>
      ${verspaetet ? `<small class="bz-flag full">${ic('alert')}Skonto verspätet abgezogen (Frist bis ${esc(fmt.datum(r.skontoBis))}) – unberechtigt</small>` : ''}</div>`;
  };
  function zeichne() {
    if (nurRl) return;
    const e = erwartung();
    const bezahlt = geldWert(E.betrag);
    const ok = Number.isFinite(bezahlt) && bezahlt != null;
    const differenz = ok ? rund(e.erwartet - bezahlt) : 0;
    stand = { ...e, bezahlt, differenz };
    // automatische Zeile folgt der Differenz, bis man sie selbst ändert
    const autoZ = zeilen.find((z) => z.auto);
    if (Math.abs(differenz) < 0.005) zeilen = zeilen.filter((z) => !z.auto);
    else if (differenz < 0) zeilen = [{ grund: 'ueberzahlung', text: (zeilen[0] && zeilen[0].grund === 'ueberzahlung' && zeilen[0].text) || '', betrag: -differenz, auto: true }];
    else if (!zeilen.length || (autoZ && zeilen.length === 1) || zeilen[0].grund === 'ueberzahlung') {
      const skontoDiff = e.spaet && r.skontoBetrag && Math.abs(differenz - rund(r.skontoBetrag - (r.skontoGenommen || 0))) <= 0.02;
      zeilen = [{ grund: skontoDiff ? 'skonto' : (autoZ && autoZ.grund !== 'ueberzahlung' ? autoZ.grund : ''), text: autoZ && autoZ.grund !== 'ueberzahlung' ? autoZ.text : '', betrag: differenz, status: skontoDiff ? 'strittig' : (autoZ && autoZ.status) || 'akzeptiert', auto: true }];
    }
    const zugeordnet = rund(zeilen.reduce((a, z) => a + (z.grund === 'ueberzahlung' ? -(z.betrag || 0) : z.betrag || 0), 0));
    const rest = rund(differenz - zugeordnet);
    stand.rest = rest;
    $('#bz-abgleich', dlg.el).innerHTML = `<dl class="bz-dl">
      <div data-bz="erwartet"><dt>Erwartet</dt><dd>${fmt.eur(e.erwartet)}</dd><small>${gs ? 'Gutschrift' : e.skonto ? `mit ${esc(fmt.zahl(r.skontoProzent))} % Skonto (${fmt.eur(e.skonto)}) – Eingang bis ${esc(fmt.datum(r.skontoBis))}` : e.spaet ? `ohne Skonto – Skontofrist vorbei (${esc(fmt.datum(r.skontoBis))})` : 'ohne Skonto'}${rl.length ? ` · Rücklässe getrennt: ${esc(rlText)}` : ''}</small></div>
      <div data-bz="bezahlt"><dt>Tatsächlich bezahlt</dt><dd>${ok ? fmt.eur(bezahlt) : '–'}</dd></div>
      <div data-bz="differenz" class="${Math.abs(differenz) < 0.005 ? 'ok' : 'diff'}"><dt>Differenz</dt><dd id="bz-differenz" data-wert="${differenz}">${Math.abs(differenz) < 0.005 ? `${ic('check')}passt genau` : differenz < 0 ? `Überzahlung ${fmt.eur(-differenz)}` : fmt.eur(differenz)}</dd></div></dl>`;
    const sek = $('#bz-gruende', dlg.el);
    sek.hidden = Math.abs(differenz) < 0.005;
    if (!sek.hidden) {
      const fokus = document.activeElement && document.activeElement.closest('[data-zeile]') ? [document.activeElement.closest('[data-zeile]').dataset.zeile, document.activeElement.dataset.f, document.activeElement.selectionStart] : null;
      $('#bz-zeilen', dlg.el).innerHTML = zeilen.map(zeileHtml).join('');
      if (fokus) { const el = $(`[data-zeile="${fokus[0]}"] [data-f="${fokus[1]}"]`, dlg.el); if (el) { el.focus(); if (fokus[2] != null && el.setSelectionRange) try { el.setSelectionRange(fokus[2], fokus[2]); } catch (_) { /* select */ } } }
      $('#bz-plus', dlg.el).hidden = differenz < 0;
      $('#bz-rest', dlg.el).innerHTML = Math.abs(rest) < 0.005 ? `<span class="ok-t">${ic('check')}vollständig aufgeteilt</span>` : `noch zuzuordnen <b data-rest="${rest}">${fmt.eur(rest)}</b>`;
    }
  }
  if (!nurRl) {
    E.betrag.value = fmt.betrag(erwartung().erwartet); E.betrag.dispatchEvent(new Event('echo'));
    E.betrag.addEventListener('input', zeichne);
    E.datum.addEventListener('change', () => { zeilen = zeilen.filter((z) => !z.auto); zeichne(); });
    const zeilenBox = $('#bz-zeilen', dlg.el);
    const liesZeile = (t) => { const i = Number(t.closest('[data-zeile]').dataset.zeile); const z = zeilen[i]; const f = t.dataset.f; if (!z || !f) return null; z.auto = false; if (f === 'betrag') { const n = parseZahl(t.value); z.betrag = Number.isFinite(n) ? rund(n) : 0; } else z[f] = t.value; return { z, f }; };
    zeilenBox.addEventListener('input', (e) => { if (e.target.dataset.f === 'betrag' || e.target.dataset.f === 'text') { liesZeile(e.target); const zug = rund(zeilen.reduce((a, z) => a + (z.grund === 'ueberzahlung' ? -(z.betrag || 0) : z.betrag || 0), 0)); const rest = rund(stand.differenz - zug); stand.rest = rest; $('#bz-rest', dlg.el).innerHTML = Math.abs(rest) < 0.005 ? `<span class="ok-t">${ic('check')}vollständig aufgeteilt</span>` : `noch zuzuordnen <b data-rest="${rest}">${fmt.eur(rest)}</b>`; } });
    zeilenBox.addEventListener('change', (e) => { const x = liesZeile(e.target); if (x && x.f === 'grund') { if (x.z.grund === 'skonto' && (erwartung().spaet || !r.skontoBetrag)) x.z.status = 'strittig'; zeichne(); } });
    zeilenBox.addEventListener('click', (e) => { const w = e.target.closest('[data-weg]'); if (w) { zeilen.splice(Number(w.dataset.weg), 1); if (!zeilen.length) zeilen = []; zeichne(); } });
    $('#bz-plus', dlg.el).addEventListener('click', () => { zeilen.forEach((z) => { z.auto = false; }); zeilen.push({ grund: '', text: '', betrag: Math.max(0, stand.rest || 0), status: 'akzeptiert' }); zeichne(); const l = $$('[data-zeile]', dlg.el).pop(); if (l) $('[data-f="grund"]', l).focus(); });
    zeichne();
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); const err = $('.form-err', dlg.el);
    const zeig = (t) => { err.hidden = false; err.textContent = t; };
    const body = { datum: datum(), notiz: String(E.notiz.value || '').trim(), inklRuecklass: !!(E.inkl && E.inkl.checked) };
    if (!nurRl) {
      zeichne();
      if (!Number.isFinite(stand.bezahlt) || stand.bezahlt == null || stand.bezahlt <= 0) return zeig('Betrag unklar – bitte so schreiben: 1.700,00');
      Object.assign(body, { betrag: stand.bezahlt, skonto: stand.skonto });
      if (Math.abs(stand.differenz) >= 0.005) {
        if (gs) return zeig('Bei einer Gutschrift bitte den genauen Betrag buchen (Teilzahlung über „Zahlung buchen“).');
        if (zeilen.some((z) => !z.grund)) return zeig('Bitte für jede Zeile einen Grund wählen.');
        if (zeilen.some((z) => !(z.betrag > 0))) return zeig('Bitte für jeden Grund einen Betrag eintragen.');
        if (zeilen.some((z) => z.grund === 'sonstiges' && !String(z.text || '').trim())) return zeig('Bei „Sonstiges“ bitte den Grund beschreiben.');
        if (Math.abs(stand.rest) >= 0.005) return zeig(`Die Differenz ist noch nicht vollständig aufgeteilt – es fehlen ${fmt.eur(stand.rest)}.`);
        body.differenzen = zeilen.map((z) => ({ grund: z.grund, betrag: z.betrag, text: String(z.text || '').trim() || null, ...(z.grund === 'ueberzahlung' || z.grund === 'deckung' || z.grund === 'haft' ? {} : { status: z.status || 'akzeptiert' }) }));
      }
    }
    $('#bz-ok', dlg.el).disabled = true;
    try {
      const n = await post(`/rechnungen/${r.id}/bezahlt`, body);
      dlg.zu(); fertig();
      const strittig = (n.strittig || 0) > 0 ? ` – strittig bleibt ${fmt.eur(n.strittig)} offen` : '';
      toast(`Rechnung ${r.nr} als bezahlt markiert${strittig}.`, 'ok', { text: 'Rückgängig', fn: () => rueckgaengig(r, n.zahlungIds, fertig) });
    } catch (x) { $('#bz-ok', dlg.el).disabled = false; zeig(x.message); }
  });
}

/** „Offen gesamt“ (15.24) – oben auf „Rechnungen“ und „Fälligkeiten“: offene Zahlbeträge + einbehaltene Rücklässe */
export const offenGesamtHtml = (og) => (!og ? '' : `<div class="ue-karte fae-gesamt" id="offen-gesamt" data-wert="${og.betrag}">
  <span class="fae-g-t">Offen gesamt</span><b class="fae-g-b">${og.betrag < 0 ? '− ' + fmt.eur(-og.betrag) : fmt.eur(og.betrag)}</b>
  <span class="fae-g-sub"><span data-og="ueberfaellig" class="${og.ueberfaellig > 0 ? 'rot' : ''}">davon überfällig <b>${fmt.eur(og.ueberfaellig)}</b></span><span data-og="naechste7Tage">in den nächsten 7 Tagen fällig <b>${fmt.eur(og.naechste7Tage)}</b></span><span data-og="ruecklaesse">Rücklässe einbehalten <b>${fmt.eur(og.ruecklaesse)}</b></span>${og.strittig ? `<span data-og="strittig" class="amber">strittige Differenzen <b>${fmt.eur(og.strittig)}</b></span>` : ''}${og.ueberzahlung ? `<span data-og="ueberzahlung">abzüglich Überzahlungen <b>${fmt.eur(og.ueberzahlung)}</b></span>` : ''}</span></div>`);

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
      ${r.empfaenger ? zeile('Rechnungsempfänger', esc(r.empfaenger)) : ''}${r.agZeichen ? zeile('Zeichen des Auftraggebers', esc(r.agZeichen)) : ''}${r.leistungVon || r.leistungBis ? zeile('Leistungszeitraum', esc(`${fmt.datum(r.leistungVon)} bis ${fmt.datum(r.leistungBis)}`)) : ''}
      ${zeile('Netto', fmt.eur(r.netto))}${zeile(r.ustModus === 'reverse_charge' ? 'USt (Reverse Charge)' : `USt ${fmt.zahl(r.ustSatz)} %`, fmt.eur(r.ust))}${zeile('Brutto', fmt.eur(r.brutto))}${['deckung', 'haft'].map((a) => { const x = a === 'haft' ? r.haftruecklass : r.deckungsruecklass; return x ? `<div data-rl="${a}"><dt>${RLA[a]}${x.eingabe === 'prozent' ? ` ${esc(fmt.zahl(x.prozent))} %` : ''}</dt><dd>− ${fmt.eur(x.betrag)}</dd></div>` : ''; }).join('')}${zeile('Zahlbetrag', `<b>${fmt.eur(r.zahlbetrag)}</b>`)}
      ${r.skontoBetrag > 0 && r.typ !== 'gutschrift' ? skontoZeilen((w) => `<div data-zahlbetrag-skonto><dt>Zahlbetrag mit Skonto</dt><dd><b data-wert="zahlbetragMitSkonto">${fmt.eur(w)}</b></dd></div>`, r.skontoProzent, r.skontoBetrag, r.zahlbetragMitSkonto ?? rund(r.zahlbetrag - r.skontoBetrag), r.skontoBis) : ''}
      ${r.skontoBetrag ? zeile('Skonto', `${esc(fmt.zahl(r.skontoProzent))} % = ${fmt.eur(r.skontoBetrag)} bis ${esc(r.skontoBis ? fmt.datum(r.skontoBis) : '–')} <small class="muted" data-skonto-eingabe="${esc(r.skontoEingabe || '')}">(eingetragen ${SK_EINGABE[r.skontoEingabe] || 'in %'})</small>`) : zeile('Skonto', 'kein Skonto')}
      ${zeile('Bezahlt', fmt.eur(r.bezahlt))}${r.skontoGenommen ? zeile('Skonto genommen', fmt.eur(r.skontoGenommen)) : ''}${r.abzuegeAkzeptiert ? zeile('Abzüge akzeptiert', fmt.eur(r.abzuegeAkzeptiert)) : ''}${zeile('Offen', `<b data-wert="offen">${fmt.eur(r.offen)}</b>${r.strittig ? ` <small class="muted">davon strittig ${fmt.eur(r.strittig)}</small>` : ''}`)}${r.ueberzahlung ? zeile('Überzahlung', fmt.eur(r.ueberzahlung)) : ''}${['deckung', 'haft'].map((a) => { const x = a === 'haft' ? r.haftruecklass : r.deckungsruecklass; return x ? zeile(`${RLA[a]} offen`, `${fmt.eur(x.offen)}${x.freiAb ? ' · frei ab ' + esc(fmt.datum(x.freiAb)) : a === 'deckung' ? ' · frei mit der Schlussrechnung' : ''}`) : ''; }).join('')}
      ${r.notiz ? zeile('Notiz', esc(r.notiz)) : ''}</dl>
    <h4 class="sub-h">Zahlungen <span class="count">${(r.zahlungen || []).length}</span></h4>
    ${(r.zahlungen || []).length ? `<ul class="plain rows" id="re-zahlungen">${r.zahlungen.map((z) => `<li data-zahlung="${z.id}"><span class="grow"><b>${fmt.eur(z.betrag)}${z.skonto ? ` + ${fmt.eur(z.skonto)} Skonto` : ''}</b><small>${esc(fmt.datum(z.datum))}${z.ruecklass ? ` · ${z.ruecklassArt ? RLA[z.ruecklassArt] : 'Rücklass'}` : ''}${z.quelle === 'bmd' ? ' · aus BMD' : z.quelle === 'markiert' ? ' · als bezahlt markiert' : ''}${z.notiz ? ' · ' + esc(z.notiz) : ''}</small></span>${darf && z.quelle === 'markiert' ? `<button type="button" class="btn ghost sm" data-markiert-weg="${esc(r.zahlungen.filter((y) => y.quelle === 'markiert' && y.erfasst === z.erfasst).map((y) => y.id).join(','))}">Rückgängig</button>` : ''}${darf ? `<button type="button" class="icon-btn sm" data-zahlung-weg="${z.id}" aria-label="Zahlung vom ${esc(fmt.datum(z.datum))} löschen">${ic('trash')}</button>` : ''}</li>`).join('')}</ul>` : '<p class="muted sm">Noch keine Zahlung.</p>'}
    ${(r.differenzen || []).length ? `<h4 class="sub-h">Differenzen beim Zahlungseingang</h4><ul class="plain rows" id="re-differenzen">${r.differenzen.map((d) => `<li data-differenz="${d.id}" data-status="${esc(d.status)}"><span class="grow"><b>${esc(d.grundName)}${d.text ? ' · ' + esc(d.text) : ''}</b><small>${esc({ akzeptiert: 'akzeptiert (Abzug gilt)', strittig: 'strittig – bleibt offen', einbehalten: 'als Rücklass einbehalten', offen: 'offen – zurückzahlen oder verrechnen', erledigt: 'erledigt' }[d.status] || d.status)}${d.skontoVerspaetet ? ' · Skonto verspätet abgezogen' : ''}</small></span><b class="num">${d.grund === 'ueberzahlung' ? '+ ' : '− '}${fmt.eur(d.betrag)}</b>${darf && d.status === 'strittig' ? `<button type="button" class="btn ghost sm" data-diff-status="akzeptiert" data-diff="${d.id}">Akzeptieren</button>` : ''}${darf && d.status === 'akzeptiert' && d.grund !== 'deckung' && d.grund !== 'haft' ? `<button type="button" class="btn ghost sm" data-diff-status="strittig" data-diff="${d.id}">Strittig</button>` : ''}${darf && d.grund === 'ueberzahlung' && d.status === 'offen' ? `<button type="button" class="btn ghost sm" data-diff-status="erledigt" data-diff="${d.id}">Erledigt</button>` : ''}</li>`).join('')}</ul>` : ''}
    <h4 class="sub-h">Mahnwesen</h4>
    ${(r.mahnungen || []).length ? `<ul class="plain rows" id="re-mahnungen">${r.mahnungen.map((m) => `<li><span class="grow"><b>${esc(m.name || MAHN[m.stufe] || 'Stufe ' + m.stufe)}</b><small>${esc(fmt.datum(m.datum))}${m.erfasstVon ? ' · ' + esc(m.erfasstVon.name || m.erfasstVon) : ''}</small></span></li>`).join('')}</ul>` : '<p class="muted sm">Keine Mahnstufe vermerkt.</p>'}
    <p class="muted sm">Mahnungen werden in BMD geschrieben – hier wird nur vermerkt, welche Stufe wann gesetzt wurde.</p></div>`,
    fuss: darf ? `<button class="btn danger" type="button" id="re-storno">Stornieren</button><span class="grow"></span>${r.offen > 0 && naechste <= 3 && r.typ !== 'gutschrift' ? `<button class="btn ghost" type="button" id="re-mahnung" data-stufe="${naechste}">${esc(MAHN[naechste])} vermerken</button>` : ''}<button class="btn ghost" type="button" id="re-edit">${ic('edit')}Bearbeiten</button>${r.offen > 0 || r.ruecklassOffen > 0 ? `<button class="btn ghost" type="button" id="re-zahlung">${ic('plus')}Zahlung buchen</button>${r.status !== 'differenz' || r.ruecklassOffen > 0 ? `<button class="btn primary" type="button" id="re-bezahlt">${ic('check')}Als bezahlt markieren</button>` : ''}` : ''}` : '<button class="btn ghost" type="button" data-zu>Schließen</button>' });
  if (!darf) return;
  const wieder = () => { dlg.zu(); fertig(); rechnungOeffnen(ctx, id, fertig); };
  dlg.el.addEventListener('click', async (e) => {
    if (e.target.closest('#re-zahlung')) return zahlungDialog(r, wieder);
    if (e.target.closest('#re-bezahlt')) return bezahltDialog(ctx, r.id, wieder);
    const ds = e.target.closest('[data-diff-status]');
    if (ds) { try { await put(`/rechnungen/${r.id}/differenzen/${ds.dataset.diff}`, { status: ds.dataset.diffStatus }); toast('Differenz geändert.'); wieder(); } catch (x) { toast(x.message, 'warn'); } return; }
    const mw = e.target.closest('[data-markiert-weg]');
    if (mw) return rueckgaengig(r, mw.dataset.markiertWeg.split(',').map(Number), wieder);
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
const offenR = (r) => !['bezahlt', 'storniert', 'differenz'].includes(r.status); // strittiger Rest: im Detail akzeptieren bzw. „Zahlung buchen“
const tabelle = (liste, mitBs, mitArt = false, bezahltKnopf = false) => `<div class="tbl-wrap"><table class="tbl re-tbl" id="re-tabelle"><thead><tr><th>Nr.</th>${mitBs ? '<th>Bauvorhaben</th><th>Auftraggeber</th>' : ''}${!mitBs || mitArt ? '<th>Art</th>' : ''}<th>Datum</th><th>Fällig</th><th class="num">Brutto</th><th class="num">Offen</th><th>Status</th>${bezahltKnopf ? '<th aria-label="Als bezahlt markieren"></th>' : ''}</tr></thead><tbody>${liste.map((r) => `<tr data-rechnung="${r.id}" data-typ="${esc(r.typ)}" tabindex="0" role="button" aria-label="Rechnung ${esc(r.nr)} öffnen"><td><b>${esc(r.nr)}</b></td>${mitBs ? `<td>${esc((r.baustelle && (r.baustelle.kst ? r.baustelle.kst + ' ' : '') + (r.baustelle.name || '')) || '')}</td><td>${esc((r.baustelle && r.baustelle.auftraggeber) || '–')}</td>` : ''}${!mitBs || mitArt ? `<td>${esc(R_TYP[r.typ] || r.typ)}</td>` : ''}<td>${esc(fmt.datum(r.datum))}</td><td>${esc(r.faellig ? fmt.datum(r.faellig) : '–')}</td><td class="num">${r.typ === 'gutschrift' ? '− ' : ''}${fmt.eur(r.brutto)}</td><td class="num">${fmt.eur(r.offen)}</td><td>${rStatus(r)}</td>${bezahltKnopf ? `<td class="re-bz">${offenR(r) ? `<button type="button" class="btn ghost sm" data-bezahlt="${r.id}" aria-label="Rechnung ${esc(r.nr)} als bezahlt markieren">${ic('check')}Bezahlt</button>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
function zeilenKlick(el, ctx, neu) {
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-bezahlt]'); if (b) { e.stopPropagation(); bezahltDialog(ctx, b.dataset.bezahlt, neu); } }, true);
  const auf = (e) => { if (e.target.closest('[data-bezahlt]')) return; const z = e.target.closest('[data-rechnung]'); if (z && z.matches('tr')) rechnungOeffnen(ctx, z.dataset.rechnung, neu); };
  el.addEventListener('click', auf);
  el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('button')) { const z = e.target.closest('tr[data-rechnung]'); if (z) { e.preventDefault(); auf(e); } } });
}

/* ---------- Reiter „Rechnungen“ einer Baustelle ---------- */
export async function rechnungenTab(box, b, ctx) {
  const darf = ctx.kann('preise_bearbeiten');
  let liste = [], fehler = '';
  async function lade() { fehler = ''; try { liste = await get(`/rechnungen?baustelleId=${b.id}`); } catch (e) { if (e.status === 401 || e.netz) throw e; fehler = e.status === 403 ? 'Kein Zugriff auf die Rechnungen dieser Baustelle.' : e.message; liste = []; } }
  function zeichne() {
    const s = summen(liste);
    box.innerHTML = fehler ? banner('err', esc(fehler)) : `<div class="stack" id="rechnungen">
      <div class="toolbar wrap"><p class="muted sm weit">Rechnungen werden in Auer geschrieben und hier mit Kopfdaten und PDF erfasst.</p><a class="btn ghost" id="re-zu-faellig" href="#/faelligkeiten">${ic('calendar')}Fälligkeiten</a>${darf ? `<button type="button" class="btn ghost" id="re-bmd">${ic('download')}Offene Posten aus BMD importieren</button><button type="button" class="btn primary" id="re-neu">${ic('plus')}Rechnung erfassen</button>` : ''}</div>
      <div class="kpi-row four" id="re-summen"><div class="kpi sm"><small>Verrechnet (netto)</small><b data-summe="netto">${fmt.eur(s.netto)}</b></div><div class="kpi sm"><small>Bezahlt</small><b data-summe="bezahlt">${fmt.eur(s.bezahlt)}</b></div><div class="kpi sm"><small>Offen</small><b data-summe="offen" class="${s.offen > 0 ? 'neg' : ''}">${fmt.eur(s.offen)}</b></div><div class="kpi sm"><small>Rücklass offen</small><b data-summe="ruecklass">${fmt.eur(s.ruecklass)}</b></div></div>
      <section class="card">${liste.length ? tabelle(liste, false, false, darf) : leer('Noch keine Rechnung erfasst.', 'euro')}</section></div>`;
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
      <div class="toolbar wrap"><div class="chip-row" role="group" aria-label="Status">${[['', 'Alle', (d.posten || []).length], ['ueberfaellig', 'Überfällig', anz('ueberfaellig')], ['offen', 'Offen', anz('offen')], ['teilbezahlt', 'Teilbezahlt', anz('teilbezahlt')], ['differenz', 'Differenz strittig', anz('differenz')]].map(([k, t, n]) => `<button type="button" class="chip-btn${filter === k ? ' on' : ''}" data-op-filter="${k}" aria-pressed="${filter === k}">${t} <span>${n}</span></button>`).join('')}</div><label class="search weit"><span>${ic('user')}</span><input type="search" id="op-suche" placeholder="Auftraggeber, Bauvorhaben oder Rechnungs-Nr." aria-label="Offene Posten durchsuchen" value="${esc(ag)}"></label></div>
      <section class="card" id="op-liste">${l.length ? tabelle(l, true) : leer((d.posten || []).length ? 'Kein Posten für diesen Filter.' : 'Keine offenen Posten.', 'check')}</section>
      <div class="two-col">
        <section class="card" aria-labelledby="h-opag"><div class="card-h pad-h"><h3 id="h-opag">Je Auftraggeber</h3></div>${(d.jeAuftraggeber || []).length ? `<ul class="plain rows" id="op-auftraggeber">${d.jeAuftraggeber.map((a) => `<li><span class="grow"><b>${esc(a.auftraggeber || '–')}</b><small>${a.anzahl} Rechnung${a.anzahl === 1 ? '' : 'en'}${a.ueberfaellig > 0 ? ` · überfällig ${fmt.eur(a.ueberfaellig)}` : ''}</small></span><b class="num">${fmt.eur(a.offen)}</b></li>`).join('')}</ul>` : '<p class="muted sm pad-s">–</p>'}</section>
        <section class="card" aria-labelledby="h-oprl"><div class="card-h pad-h"><h3 id="h-oprl">Rücklässe</h3></div>${(d.ruecklaesse || []).length ? `<ul class="plain rows" id="op-ruecklaesse">${d.ruecklaesse.map((x) => `<li><span class="grow"><b>${esc((x.baustelle && (x.baustelle.name || x.baustelle)) || '')}</b><small>${esc(x.artName || 'Rücklass')} · Rechnung ${esc(x.nr)}${x.ruecklassFaellig ? ' · frei ab ' + esc(fmt.datum(x.ruecklassFaellig)) : ''}</small></span><b class="num">${fmt.eur(x.ruecklassOffen)}</b></li>`).join('')}</ul>` : '<p class="muted sm pad-s">Keine offenen Rücklässe.</p>'}</section>
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

/* ---------- Seite „Rechnungen“ (15.24): alle Rechnungen über alle Baustellen, Filter, „Neue Rechnung“ ---------- */
const STATUS_FILTER = [['', 'Alle'], ['offen,teilbezahlt,ueberfaellig,differenz', 'Offen'], ['ueberfaellig', 'Überfällig'], ['differenz', 'Differenz strittig'], ['bezahlt', 'Bezahlt']];
export async function rechnungenSeite(el, ctx) {
  const darf = ctx.kann('preise_bearbeiten');
  const q = ctx.query;
  const f = { baustelleId: q.get('baustelleId') || '', status: q.get('status') || '', typ: q.get('typ') || '', von: q.get('von') || '', bis: q.get('bis') || '' };
  let baustellen = [], liste = [], og = null;
  try { baustellen = (await get('/baustellen?alle=1')).filter((b) => !b.intern); } catch (e) { if (e.status === 401 || e.netz) throw e; }
  async function lade() {
    const p = new URLSearchParams(Object.entries(f).filter(([, w]) => w));
    const [l, fae] = await Promise.all([get(`/rechnungen${p.toString() ? '?' + p : ''}`), get('/faelligkeiten').catch(() => null)]);
    liste = l; og = fae && fae.offenGesamt;
  }
  await lade();
  const bsOpt = () => `<option value="">Alle Baustellen</option>${baustellen.map((b) => `<option value="${b.id}" ${String(b.id) === f.baustelleId ? 'selected' : ''}>${esc(`${b.kst || ''} ${b.name || ''}`)}</option>`).join('')}`;
  el.innerHTML = `<div class="page" id="rechnungen-seite">
    <div class="toolbar wrap"><p class="muted sm weit">Rechnungen werden in Auer geschrieben und hier mit Kopfdaten und PDF erfasst.</p><a class="btn ghost" id="re-zu-faellig" href="#/faelligkeiten">${ic('calendar')}Fälligkeiten</a>${darf ? `<button type="button" class="btn primary" id="re-neu-alle">${ic('plus')}Neue Rechnung</button>` : ''}</div>
    <a class="re-og" href="#/faelligkeiten" id="re-og" aria-label="Fälligkeiten ansehen"></a>
    <div class="re-filter card" id="re-filter" role="search" aria-label="Rechnungen filtern">
      <label class="field"><span class="field-label">Baustelle</span><select class="input" id="ref-bs">${bsOpt()}</select></label>
      <label class="field"><span class="field-label">Art</span><select class="input" id="ref-typ"><option value="">Alle Arten</option>${Object.entries(R_TYP).map(([k, t]) => `<option value="${k}" ${f.typ === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="field"><span class="field-label">Rechnungsdatum von</span><input class="input" type="date" id="ref-von" value="${esc(f.von)}"></label>
      <label class="field"><span class="field-label">bis</span><input class="input" type="date" id="ref-bis" value="${esc(f.bis)}"></label>
      <div class="chip-row re-filter-status" role="group" aria-label="Status">${STATUS_FILTER.map(([k, t]) => `<button type="button" class="chip-btn${f.status === k ? ' on' : ''}" data-re-status="${k}" aria-pressed="${f.status === k}">${t}</button>`).join('')}</div>
    </div>
    <div id="re-ergebnis"></div></div>`;
  function zeichne() {
    const s = summen(liste);
    $('#re-og', el).innerHTML = offenGesamtHtml(og);
    $('#re-ergebnis', el).innerHTML = `<div class="kpi-row four" id="re-summen"><div class="kpi sm"><small>Rechnungen</small><b data-summe="anzahl">${liste.length}</b></div><div class="kpi sm"><small>Verrechnet (netto)</small><b data-summe="netto">${fmt.eur(s.netto)}</b></div><div class="kpi sm"><small>Offen</small><b data-summe="offen" class="${s.offen > 0 ? 'neg' : ''}">${fmt.eur(s.offen)}</b></div><div class="kpi sm"><small>Rücklässe offen</small><b data-summe="ruecklass">${fmt.eur(s.ruecklass)}</b></div></div>
      <section class="card">${liste.length ? tabelle(liste, true, true, darf) : leer('Keine Rechnung für diese Auswahl.', 'euro')}</section>`;
    for (const b of $$('[data-re-status]', el)) { const an = b.dataset.reStatus === f.status; b.classList.toggle('on', an); b.setAttribute('aria-pressed', String(an)); }
  }
  const neu = async () => { try { await lade(); } catch (x) { toast(x.message, 'warn'); } if (ctx.aktuell()) zeichne(); };
  const setz = (k, w) => { f[k] = w; neu(); };
  el.addEventListener('change', (e) => {
    const m = { 'ref-bs': 'baustelleId', 'ref-typ': 'typ', 'ref-von': 'von', 'ref-bis': 'bis' }[e.target.id];
    if (m) setz(m, e.target.value);
  });
  el.addEventListener('click', (e) => {
    const st = e.target.closest('[data-re-status]'); if (st) return setz('status', st.dataset.reStatus);
    if (e.target.closest('#re-neu-alle')) return rechnungDialog(ctx, baustellen.find((b) => String(b.id) === f.baustelleId) || null, null, neu);
  });
  zeilenKlick(el, ctx, neu);
  zeichne();
}
