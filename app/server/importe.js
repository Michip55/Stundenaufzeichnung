'use strict';
/**
 * Import/Export für BMD und Auer Success (API.md 12.20): Tabellen (CSV/XLSX) mit einstellbarer Spaltenzuordnung,
 * toleranter ÖNORM-A-2063-Leser (Teilmenge – mit echter Exportdatei prüfen), Lohn-Export nach Vorlage.
 */
const ExcelJS = require('exceljs');

/** CSV-Zeilen (Anführungszeichen, eingebettete Trennzeichen/Zeilenumbrüche) */
function csvZeilen(text, trenn) {
  const zeilen = [];
  let z = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === trenn) { z.push(f); f = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      z.push(f); f = '';
      if (z.some((x) => x !== '')) zeilen.push(z);
      z = [];
    } else f += ch;
  }
  z.push(f);
  if (z.some((x) => x !== '')) zeilen.push(z);
  return zeilen;
}

/** Tabelle aus CSV oder XLSX → Zeilen (Arrays von Strings/Zahlen) */
async function tabelle(buf, { trennzeichen = ';', kodierung = 'utf-8' } = {}) {
  if (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50) {
    require('./katalog-excel').pruefeZip(buf);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets.find((w) => w.rowCount > 0);
    if (!ws) return [];
    if (ws.rowCount > 20000) throw new Error('Zu viele Zeilen (höchstens 20.000).');
    const out = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const w = [];
      for (let i = 1; i <= row.cellCount; i++) {
        let x = row.getCell(i).value;
        if (x && typeof x === 'object') x = 'result' in x ? x.result : x instanceof Date ? x.toISOString().slice(0, 10) : 'text' in x ? x.text : x.richText ? x.richText.map((r) => r.text).join('') : String(x);
        w.push(x == null ? '' : x);
      }
      out.push(w);
    });
    return out;
  }
  let text;
  try { text = new TextDecoder(kodierung === 'windows-1252' ? 'windows-1252' : 'utf-8').decode(buf); } catch (_) { text = buf.toString('utf8'); }
  text = text.replace(/^﻿/, '');
  const z = csvZeilen(text, trennzeichen === '\\t' ? '\t' : trennzeichen);
  if (z.length > 20000) throw new Error('Zu viele Zeilen (höchstens 20.000).');
  return z;
}

/** Spalten-Index aus Name (ohne Groß/Klein, Leer-/Sonderzeichen) oder Nummer (ab 1) */
function spaltenIndex(kopf, ref) {
  if (ref === undefined || ref === null || ref === '') return -1;
  if (typeof ref === 'number' || /^\d+$/.test(String(ref))) return Number(ref) - 1;
  const n = (x) => String(x).toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
  return kopf.findIndex((k) => n(k) === n(ref));
}

/** Zahl aus Text („1.234,50“, „-12,3“, „1,234.50“) */
function zahl(x, dezimal = ',') {
  if (typeof x === 'number') return x;
  let s = String(x == null ? '' : x).trim().replace(/[€\s]/g, '').replace(/^(.*)-$/, '-$1');
  if (!s) return null;
  if (dezimal === ',') s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
function datum(x, format = 'TT.MM.JJJJ') {
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  const s = String(x == null ? '' : x).trim();
  if (!s) return null;
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(s);
  if (m) { const j = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${j}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return format ? undefined : null;
}

/* ---------- ÖNORM A 2063 (tolerant) ---------- */
const RE = {
  position: /^(position|pos|lvposition|leistungsposition|lv-position|teilleistung)$/i,
  oz: /^(oz|ordnungszahl|posnr|pos-nr|positionsnummer|nummer|nr|lv-pos-nr|lvposnr)$/i,
  kurztext: /^(kurztext|stichwort|bezeichnung|positionsstichwort|kurz-text)$/i,
  einheit: /^(einheit|me|mengeneinheit|eh)$/i,
  menge: /^(menge|lv-menge|lvmenge|ausschreibungsmenge|vordersatz)$/i,
  ep: /^(ep|einheitspreis|preis|ep-betrag)$/i,
  gp: /^(gp|gesamtpreis|gesamtbetrag|pos-betrag|positionsbetrag)$/i
};
const lokal = (n) => String(n).split(':').pop();

/**
 * Liest Positionen aus ÖNORM-A-2063-XML (oder ähnlichen LV-Formaten): Elemente „position“ mit Kind-
 * elementen bzw. Attributen für OZ, Kurztext, Einheit, Menge, EP, GP. Unbekanntes wird übergangen.
 */
function onlvLesen(xml) {
  const { SaxesParser } = require('saxes');
  const p = new SaxesParser({ xmlns: false });
  const positionen = [];
  const warnungen = [];
  const stapel = [];
  let akt = null, feld = null, text = '';
  p.on('opentag', (t) => {
    const n = lokal(t.name);
    stapel.push(n);
    if (RE.position.test(n)) {
      akt = { tiefe: stapel.length, werte: {} };
      for (const [k, v] of Object.entries(t.attributes || {})) for (const [f, re] of Object.entries(RE)) if (f !== 'position' && re.test(lokal(k)) && akt.werte[f] == null) akt.werte[f] = String(v);
      return;
    }
    if (akt) { for (const [f, re] of Object.entries(RE)) if (f !== 'position' && re.test(n) && akt.werte[f] == null) { feld = f; text = ''; } }
  });
  p.on('text', (t) => { if (feld) text += t; });
  p.on('cdata', (t) => { if (feld) text += t; });
  p.on('closetag', (t) => {
    const n = lokal(t.name);
    if (akt && feld && RE[feld].test(n)) { akt.werte[feld] = text.trim().replace(/\s+/g, ' '); feld = null; }
    if (akt && stapel.length === akt.tiefe && RE.position.test(n)) { positionen.push(akt.werte); akt = null; }
    stapel.pop();
  });
  try { p.write(xml).close(); } catch (e) { throw new Error(`XML nicht lesbar: ${e.message}`); }
  return { positionen, warnungen };
}

module.exports = { csvZeilen, tabelle, spaltenIndex, zahl, datum, onlvLesen };
