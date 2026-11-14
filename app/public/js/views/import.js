// Import-Assistent (API.md 12.20): Datei wählen → Spalten zuordnen (gespeicherte Zuordnung) → Vorschau → Übernehmen.
// „bmd-op“: Offene Posten / Zahlungseingänge aus BMD. „lv“: Leistungsverzeichnis aus Auer Success (ÖNORM A 2063 oder Excel).
import { get, post, put } from '../api.js';
import { ic, esc, fmt, banner, dialog, toast, $ } from '../ui.js';
import { dateiBase64 } from './dokumente.js';

const ARTEN = {
  'bmd-op': {
    titel: 'Offene Posten aus BMD importieren', zuordnung: '/import/bmd-op/zuordnung', ziel: () => '/import/bmd-op', endung: /\.(csv|txt|xlsx)$/i, accept: '.csv,.txt,.xlsx',
    hilfe: 'In BMD die OP-Liste (Debitoren) als CSV oder Excel exportieren. Zugeordnet wird über die Rechnungs-Nr. (= Belegnummer). Ein erneuter Import derselben Datei ändert nichts.',
    spalten: [['belegnr', 'Belegnummer (Rechnungs-Nr.)', true], ['datum', 'Belegdatum', true], ['offen', 'Offener Betrag', true], ['kunde', 'Kunde'], ['netto', 'Netto'], ['brutto', 'Brutto'], ['faellig', 'Fällig am'], ['bezahlt', 'Bezahlt'], ['zahlungsdatum', 'Zahlungsdatum']],
  },
  lv: {
    titel: 'Leistungsverzeichnis aus Auer Success importieren', zuordnung: '/import/lv/zuordnung', ziel: (o) => `/baustellen/${o.baustelle.id}/lv-import`, endung: /\.(onlv|xml|xlsx|csv)$/i, accept: '.onlv,.xml,.xlsx,.csv',
    hilfe: 'In Auer Success das Leistungsverzeichnis als ÖNORM-A-2063-Datei (.onlv / XML) oder als Excel exportieren. Die Positionen werden als Soll der Baustelle gespeichert.',
    spalten: [['oz', 'OZ / Positionsnummer', true], ['kurztext', 'Kurztext', true], ['einheit', 'Einheit'], ['menge', 'Menge', true], ['ep', 'Einheitspreis'], ['gp', 'Gesamtpreis']],
  },
};

// Antwort aus dem Modus „Zahlungseingänge“ (je Zeile eine Zahlung) – sonst OP-Liste
const zahlModus = (v) => v.art === 'zahlungen';
const STATUS = { offen: 'offen', teilbezahlt: 'teilbezahlt', bezahlt: 'bezahlt', ueberfaellig: 'überfällig', storniert: 'storniert' };
const st = (x) => esc(STATUS[x] || x || '');
/** Vorschau der zugeordneten Zeilen (N-024/N-095): je Modus eigene Spalten, Änderung als Text statt true/false */
function zugeordnetTabelle(v) {
  const zm = zahlModus(v);
  const aend = (z) => (z.aenderung === true ? (zm ? 'wird gebucht' : `Zahlung ${fmt.eur(z.betrag)} wird gebucht`) : zm && z.bereitsGebucht ? 'bereits gebucht' : 'keine');
  const kopf = zm ? '<th>Zeile</th><th>Rechnung</th><th>Zahlungsdatum</th><th class="num">Betrag</th><th class="num">Offen bisher</th><th class="num">Offen neu</th><th>Status</th><th>Änderung</th>'
    : '<th>Zeile</th><th>Rechnung</th><th class="num">Offen bisher</th><th class="num">Offen neu</th><th>Status</th><th>Änderung</th>';
  const zeile = (z) => `<tr data-imp-aenderung="${z.aenderung === true ? 'ja' : 'nein'}"><td>${esc(z.zeile ?? '')}</td><td><b>${esc(z.nr)}</b>${z.typ === 'gutschrift' ? ' <small class="muted">Gutschrift</small>' : ''}</td>${zm ? `<td>${esc(z.datum ? fmt.datum(z.datum) : '')}</td><td class="num">${fmt.eur(z.betrag)}</td>` : ''}<td class="num">${fmt.eur(z.alt && z.alt.offen)}</td><td class="num">${fmt.eur(z.neu && z.neu.offen)}</td><td>${st(z.alt && z.alt.status)}${z.aenderung === true ? ` → <b>${st(z.neu && z.neu.status)}</b>` : ''}</td><td>${esc(aend(z))}</td></tr>`;
  return `<div class="tbl-wrap"><table class="tbl" id="imp-zugeordnet"><thead><tr>${kopf}</tr></thead><tbody>${v.zugeordnet.map(zeile).join('')}</tbody></table></div>`;
}

export function importAssistent(ctx, art, opt = {}) {
  const A = ARTEN[art];
  let datei = null, b64 = '', zu = null, kopf = [], vorschau = null, schritt = 1, modus = 'op';
  const dlg = dialog({ titel: A.titel, breit: true, inhalt: '<div id="imp-assistent"></div>', fuss: '<button class="btn ghost" type="button" data-zu>Schließen</button>' });
  const box = $('#imp-assistent', dlg.el);
  const braucht = () => datei && !/\.(onlv|xml)$/i.test(datei.name); // ÖNORM-Dateien brauchen keine Spalten-Zuordnung
  const schritte = () => `<ol class="imp-schritte" aria-label="Schritte">${['Datei', 'Spalten', 'Vorschau', 'Übernommen'].map((t, i) => `<li class="${schritt === i + 1 ? 'jetzt' : schritt > i + 1 ? 'fertig' : ''}" ${schritt === i + 1 ? 'aria-current="step"' : ''}><i>${i + 1}</i>${t}</li>`).join('')}</ol>`;
  const fehlerZeile = '<p class="form-err" role="alert" hidden></p>';
  const zeigFehler = (t) => { const e = $('.form-err', box); if (e) { e.hidden = false; e.textContent = t; } };

  function s1() {
    schritt = 1;
    box.innerHTML = `${schritte()}<form id="imp1" class="stack-s" novalidate><p class="muted sm">${esc(A.hilfe)}</p>
      ${art === 'bmd-op' ? `<fieldset class="field"><legend class="field-label">Was enthält die Datei?</legend><div class="chk-row"><label class="check-inline"><input type="radio" name="modus" value="op" ${modus === 'op' ? 'checked' : ''}> OP-Liste (offene Beträge)</label><label class="check-inline"><input type="radio" name="modus" value="zahlungen" ${modus === 'zahlungen' ? 'checked' : ''}> Zahlungseingänge (je Zeile eine Zahlung)</label></div></fieldset>` : ''}
      <label class="field"><span class="field-label">Datei (${esc(A.accept.replace(/,/g, ', '))}, höchstens 5 MB)</span><input class="input lg" type="file" id="imp-datei" accept="${A.accept}" required></label>${fehlerZeile}
      <div class="btn-row end"><button class="btn primary" type="submit" id="imp-weiter1">Weiter</button></div></form>`;
    $('#imp1', box).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = $('#imp-datei', box).files[0];
      if (art === 'bmd-op') modus = new FormData(e.target).get('modus') || 'op';
      if (!f) return zeigFehler('Bitte eine Datei wählen.');
      if (!A.endung.test(f.name)) return zeigFehler(`Dieser Dateityp passt nicht – erlaubt: ${A.accept.replace(/,/g, ', ')}.`);
      if (f.size > 5 * 1048576) return zeigFehler('Die Datei ist größer als 5 MB.');
      try { datei = f; b64 = await dateiBase64(f); if (braucht()) { zu = await get(A.zuordnung); await leseKopf(); s2(); } else s3(); } catch (x) { zeigFehler(x.message); }
    });
  }
  async function leseKopf() {
    kopf = [];
    if (!/\.(csv|txt)$/i.test(datei.name)) return;
    try { const puffer = await datei.slice(0, 8192).arrayBuffer(); const text = new TextDecoder(zu.kodierung === 'windows-1252' ? 'windows-1252' : 'utf-8').decode(puffer).replace(/^﻿/, ''); kopf = (text.split(/\r?\n/)[0] || '').split(zu.trennzeichen || ';').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean); } catch (e) { kopf = []; }
  }
  function s2() {
    schritt = 2; const sp = zu.spalten || {};
    box.innerHTML = `${schritte()}<form id="imp2" class="stack-s" novalidate>
      <p class="muted sm">${zu.name ? `Gespeicherte Zuordnung: <b>${esc(zu.name)}</b>. ` : ''}Spalte als Überschrift aus der Datei oder als Nummer (1 = erste Spalte). Die Zuordnung wird für das nächste Mal gespeichert.</p>
      <div class="form-grid">
        <label class="field"><span class="field-label">Trennzeichen</span><select class="input" name="trennzeichen">${[[';', 'Strichpunkt ;'], [',', 'Komma ,'], ['\t', 'Tabulator']].map(([w, t]) => `<option value="${w === '\t' ? 'TAB' : w}" ${zu.trennzeichen === w ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Zeichensatz</span><select class="input" name="kodierung"><option value="utf-8" ${zu.kodierung !== 'windows-1252' ? 'selected' : ''}>UTF-8</option><option value="windows-1252" ${zu.kodierung === 'windows-1252' ? 'selected' : ''}>Windows-1252 (ANSI)</option></select></label>
        <label class="field"><span class="field-label">Dezimalzeichen</span><select class="input" name="dezimal"><option value="," ${zu.dezimal !== '.' ? 'selected' : ''}>Komma 1.234,50</option><option value="." ${zu.dezimal === '.' ? 'selected' : ''}>Punkt 1234.50</option></select></label>
        <label class="field"><span class="field-label">Datum</span><select class="input" name="datumFormat"><option value="TT.MM.JJJJ" ${zu.datumFormat !== 'JJJJ-MM-TT' ? 'selected' : ''}>TT.MM.JJJJ</option><option value="JJJJ-MM-TT" ${zu.datumFormat === 'JJJJ-MM-TT' ? 'selected' : ''}>JJJJ-MM-TT</option></select></label>
        <label class="check-inline full"><input type="checkbox" name="kopfzeile" ${zu.kopfzeile !== false ? 'checked' : ''}> Erste Zeile enthält die Spaltenüberschriften</label>
      </div>
      <fieldset class="field"><legend class="field-label">Spalten</legend><div class="form-grid" id="imp-spalten">${A.spalten.map(([k, t, pflicht]) => `<label class="field"><span class="field-label">${esc(t)}${pflicht ? ' *' : ''}</span><input class="input" name="sp_${k}" list="imp-kopf" value="${esc(sp[k] ?? '')}" ${pflicht ? 'required' : ''} autocomplete="off"></label>`).join('')}</div><datalist id="imp-kopf">${kopf.map((k) => `<option value="${esc(k)}"></option>`).join('')}</datalist>
        ${kopf.length ? `<small class="muted">In der Datei gefunden: ${kopf.map(esc).join(' · ')}</small>` : ''}</fieldset>${fehlerZeile}
      <div class="btn-row end"><button class="btn ghost" type="button" id="imp-zurueck">Zurück</button><button class="btn primary" type="submit" id="imp-weiter2">Zuordnung speichern &amp; Vorschau</button></div></form>`;
    $('#imp-zurueck', box).addEventListener('click', s1);
    $('#imp2', box).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target);
      const spalten = {}; for (const [k, , pflicht] of A.spalten) { const v = String(f.get('sp_' + k) || '').trim(); if (v) spalten[k] = /^\d+$/.test(v) ? Number(v) : v; else if (pflicht) return zeigFehler('Bitte alle Pflichtspalten (*) zuordnen.'); }
      const neu = { trennzeichen: f.get('trennzeichen') === 'TAB' ? '\t' : f.get('trennzeichen'), kodierung: f.get('kodierung'), dezimal: f.get('dezimal'), datumFormat: f.get('datumFormat'), kopfzeile: f.get('kopfzeile') === 'on', spalten };
      try { zu = (await put(A.zuordnung, neu)) || neu; s3(); } catch (x) { zeigFehler(x.message); }
    });
  }
  const sende = (probe, extra = {}) => post(A.ziel(opt), { dateiBase64: b64, dateiname: datei.name, vorschau: probe, ...(art === 'bmd-op' && modus === 'zahlungen' ? { art: 'zahlungen' } : {}), ...extra });
  async function s3() {
    schritt = 3; box.innerHTML = `${schritte()}<div class="state">Datei wird gelesen …</div>`;
    try { vorschau = await sende(true); } catch (x) { box.innerHTML = `${schritte()}${banner('err', esc(x.message))}<div class="btn-row end"><button class="btn ghost" type="button" id="imp-zurueck">Zurück</button></div>`; $('#imp-zurueck', box).addEventListener('click', () => (braucht() && zu ? s2() : s1())); return; }
    const v = vorschau;
    const kern = art === 'bmd-op' ? `
      <div class="chip-row"><span class="chip st-green" data-imp-zugeordnet="${(v.zugeordnet || []).length}">${(v.zugeordnet || []).length} zugeordnet</span><span class="chip ${(v.unbekannt || []).length ? 'st-amber' : 'st-grey'}" data-imp-unbekannt="${(v.unbekannt || []).length}">${(v.unbekannt || []).length} nicht zugeordnet</span>${(v.fehler || []).length ? `<span class="chip st-red">${v.fehler.length} Fehler</span>` : ''}<span class="muted sm">${v.zeilen ?? 0} Zeilen gelesen</span></div>
      ${(v.zugeordnet || []).length ? zugeordnetTabelle(v) : ''}
      ${(v.unbekannt || []).length ? `<h4 class="sub-h">Nicht zugeordnet – Rechnung in BauTag nicht erfasst</h4><div class="tbl-wrap"><table class="tbl" id="imp-unbekannt"><thead><tr><th>Zeile</th><th>Belegnr.</th><th>Kunde</th><th class="num">${zahlModus(v) ? 'Betrag' : 'Offen'}</th></tr></thead><tbody>${v.unbekannt.map((u) => `<tr><td>${u.zeile}</td><td>${esc(u.belegnr || '')}</td><td>${esc(u.kunde || '')}</td><td class="num">${fmt.eur(zahlModus(v) ? u.betrag : u.offen)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${(v.uebersprungen || []).length ? `<details class="muted sm" id="imp-uebersprungen"><summary>${v.uebersprungen.length} Zeile${v.uebersprungen.length === 1 ? '' : 'n'} ohne Belegnummer nicht berücksichtigt</summary><ul class="plain">${v.uebersprungen.slice(0, 50).map((x) => `<li>Zeile ${esc(x.zeile)}: ${esc(x.text)}</li>`).join('')}</ul></details>` : ''}`
      : `<div class="chip-row"><span class="chip st-green" data-imp-positionen="${(v.positionen || []).length}">${(v.positionen || []).length} Positionen</span><span class="chip st-outline">LV-Summe ${fmt.eur(v.summe)}</span></div>
      ${(v.warnungen || []).length ? banner('warn', v.warnungen.map((w) => esc(w.text || w)).join('<br>')) : ''}
      ${(v.positionen || []).length ? `<div class="tbl-wrap imp-hoch"><table class="tbl" id="imp-positionen"><thead><tr><th>OZ</th><th>Kurztext</th><th>EH</th><th class="num">Menge</th><th class="num">EP</th><th class="num">GP</th></tr></thead><tbody>${v.positionen.map((p) => `<tr><td>${esc(p.oz || '')}</td><td>${esc(p.kurztext || '')}</td><td>${esc(p.einheit || '')}</td><td class="num">${fmt.zahl(p.menge, 3)}</td><td class="num">${p.ep != null ? fmt.eur(p.ep) : '–'}</td><td class="num">${p.gp != null ? fmt.eur(p.gp) : '–'}</td></tr>`).join('')}</tbody></table></div>
      <label class="check-inline"><input type="checkbox" id="imp-auftrag"> Auftragssumme der Baustelle auf die LV-Summe setzen (${fmt.eur(v.summe)})</label><p class="muted sm">Bitte mit einer echten Exportdatei prüfen – ein bestehendes Soll-LV dieser Baustelle wird ersetzt.</p>` : ''}`;
    // Mit Fehlerzeilen übernimmt der Server nichts – dann gibt es auch kein „Übernehmen“
    const etwas = !(v.fehler || []).length && (art === 'bmd-op' ? (v.zugeordnet || []).length > 0 : (v.positionen || []).length > 0);
    box.innerHTML = `${schritte()}<div class="stack-s" id="imp-vorschau">${kern}
      ${(v.fehler || []).length ? `${banner('err', `Die Datei enthält ${v.fehler.length} fehlerhafte Zeile${v.fehler.length === 1 ? '' : 'n'} – es wird nichts übernommen. Bitte in der Datei korrigieren und erneut hochladen.`)}<ul class="warn-list" id="imp-fehler">${v.fehler.map((x) => `<li>${ic('alert')}<span>Zeile ${x.zeile}: ${esc(x.text)}</span></li>`).join('')}</ul>` : ''}${fehlerZeile}
      <div class="btn-row end"><button class="btn ghost" type="button" id="imp-zurueck">Zurück</button><button class="btn primary" type="button" id="imp-ok" ${etwas ? '' : 'disabled'}>Übernehmen</button></div></div>`;
    $('#imp-zurueck', box).addEventListener('click', () => (braucht() && zu ? s2() : s1()));
    $('#imp-ok', box).addEventListener('click', async (e) => {
      e.target.disabled = true;
      try { const r = await sende(false, art === 'lv' && $('#imp-auftrag', box) && $('#imp-auftrag', box).checked ? { auftragssummeUebernehmen: true } : {}); if (r.uebernommen === false || r.uebernommen === 0) return nichtUebernommen(r.fehler || [], 'Der Server hat nichts übernommen.'); s4(r); } catch (x) { if (x.daten && Array.isArray(x.daten.zeilenFehler)) return nichtUebernommen(x.daten.zeilenFehler, x.message); e.target.disabled = false; zeigFehler(x.message); }
    });
  }
  // Nichts gebucht: klar sagen und die Fehlerzeilen zeigen – keine Erfolgsmeldung
  function nichtUebernommen(zeilen, text) {
    box.innerHTML = `${schritte()}<div id="imp-abgelehnt" data-uebernommen="0">${banner('err', `<b>Nichts übernommen.</b> ${esc(text || '')}`)}${zeilen.length ? `<ul class="warn-list" id="imp-fehler">${zeilen.slice(0, 50).map((x) => `<li>${ic('alert')}<span>Zeile ${esc(x.zeile ?? '?')}: ${esc(x.text || x.fehler || '')}</span></li>`).join('')}</ul>` : ''}<div class="btn-row end"><button class="btn ghost" type="button" id="imp-zurueck">Andere Datei wählen</button></div></div>`;
    $('#imp-zurueck', box).addEventListener('click', s1);
  }
  function s4(r) {
    schritt = 4;
    // N-024: gezählt wird, was wirklich gebucht wurde (nicht jede zugeordnete Zeile); Text je Modus
    const geaendert = (r.zugeordnet || []).filter((z) => z.aenderung === true);
    const n = art === 'bmd-op' ? (typeof r.rechnungenGeaendert === 'number' ? r.rechnungenGeaendert : new Set(geaendert.map((z) => z.rechnungId)).size) : typeof r.uebernommen === 'number' ? r.uebernommen : (r.positionen || []).length;
    const b = typeof r.anzahlBuchungen === 'number' ? r.anzahlBuchungen : geaendert.length;
    const rn = (x) => `${x} Rechnung${x === 1 ? '' : 'en'}`;
    const text = art !== 'bmd-op' ? `<b>${n} LV-Position${n === 1 ? '' : 'en'} als Soll gespeichert.</b>`
      : zahlModus(r) ? (b ? `<b>${b} Zahlung${b === 1 ? '' : 'en'} gebucht</b> (${rn(n)}).` : '<b>Keine neuen Zahlungen</b> – alle Zahlungen der Datei waren bereits gebucht.')
        : (n ? `<b>${rn(n)} aktualisiert.</b> Der Zahlungsstand entspricht jetzt der BMD-Liste.` : '<b>Keine Änderungen</b> – der Zahlungsstand entsprach bereits der BMD-Liste.');
    box.innerHTML = `${schritte()}<div id="imp-fertig" data-uebernommen="${art === 'bmd-op' ? b : n}">${banner('ok', text)}</div>`;
    toast('Import übernommen.'); if (opt.fertig) opt.fertig(r);
  }
  s1();
}
