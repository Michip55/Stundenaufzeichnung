'use strict';
/**
 * Excel-Vorlage „Nachkalkulation nach Positionen“ lesen und im selben Aufbau schreiben (exceljs).
 * Aufbau (Tabelle1): A Bezeichnung, B EH, C–L Mengen-Einträge, M ZS (=SUMME C:L), N EP, O SUMME (=M*N);
 * Gruppen enden mit Summenzeilen „Summe Arbeit“, „Summe Transport“, „Summe Geräte“, „Eigenmaterial“,
 * „Fremdmaterial“, „Summe Abgaben“; danach Block „Zusammenstellung“ mit Anteilen in %.
 *
 *   node server/katalog-excel.js            → erzeugt server/daten/katalog_vorlage.json aus docs/vorlage/…xlsx
 */
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');

const GRUPPEN = [
  { schluessel: 'arbeit', name: 'Arbeit', summenzeile: 'Summe Arbeit' },
  { schluessel: 'transport', name: 'Transport', summenzeile: 'Summe Transport' },
  { schluessel: 'geraete', name: 'Geräte', summenzeile: 'Summe Geräte' },
  { schluessel: 'eigenmaterial', name: 'Eigenmaterial', summenzeile: 'Eigenmaterial' },
  { schluessel: 'fremdmaterial', name: 'Fremdmaterial', summenzeile: 'Fremdmaterial' },
  { schluessel: 'abgaben', name: 'Abgaben', summenzeile: 'Summe Abgaben' }
];
const GRUPPEN_SCHLUESSEL = GRUPPEN.map((g) => g.schluessel);
const VORLAGE = path.join(__dirname, '..', '..', 'docs', 'vorlage', 'Nachkalkulation_Positionen_Vorlage_2026-04-01.xlsx');
const KATALOG_JSON = path.join(__dirname, 'daten', 'katalog_vorlage.json');

/** Zellwert als Zahl (Zahl, Formel mit Ergebnis oder einfache Formel wie „=14.5“) */
function zahlAusZelle(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v === 'object') {
    if (typeof v.result === 'number') return v.result;
    if (typeof v.formula === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v.formula)) return Number(v.formula);
  }
  if (typeof v === 'string' && /^\s*-?\d+([.,]\d+)?\s*$/.test(v)) return Number(v.replace(',', '.'));
  return null;
}
function textAusZelle(v) {
  if (v == null) return '';
  if (typeof v === 'object' && v.richText) return v.richText.map((r) => r.text).join('');
  if (typeof v === 'object' && v.result != null) return String(v.result);
  return typeof v === 'object' ? '' : String(v);
}

/** Grenzen für hochgeladene Excel-Dateien (E-02) */
const IMPORT_GRENZEN = { dateiBytes: 5 * 1024 * 1024, eintraege: 300, eintragBytes: 10 * 1024 * 1024, gesamtBytes: 25 * 1024 * 1024, zeilen: 5000 };

/**
 * Prüft eine xlsx-Datei (ZIP) VOR dem Lesen gegen ZIP-Bomben: Anzahl Einträge, keine ZIP64/Verschlüsselung,
 * tatsächlich entpackte Größe je Eintrag und gesamt (mit begrenztem Entpacken gemessen).
 * @throws {Error} mit deutschem Text
 */
function pruefeZip(buf, g = IMPORT_GRENZEN) {
  const zlib = require('node:zlib');
  if (buf.length > g.dateiBytes) throw new Error(`Die Datei ist größer als ${g.dateiBytes / 1024 / 1024} MB.`);
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) throw new Error('Keine Excel-Datei (xlsx).');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Die Excel-Datei ist beschädigt (ZIP-Verzeichnis fehlt).');
  const anzahl = buf.readUInt16LE(eocd + 10);
  const cdGroesse = buf.readUInt32LE(eocd + 12);
  const cdStart = buf.readUInt32LE(eocd + 16);
  if (anzahl === 0xffff || cdStart === 0xffffffff || cdGroesse === 0xffffffff) throw new Error('ZIP64-Dateien werden nicht unterstützt.');
  if (anzahl > g.eintraege) throw new Error(`Die Datei enthält zu viele Einträge (${anzahl}, höchstens ${g.eintraege}).`);
  if (cdStart + cdGroesse > buf.length) throw new Error('Die Excel-Datei ist beschädigt (ZIP-Verzeichnis).');
  let pos = cdStart, gesamt = 0;
  for (let n = 0; n < anzahl; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('Die Excel-Datei ist beschädigt (ZIP-Eintrag).');
    const flags = buf.readUInt16LE(pos + 8);
    const methode = buf.readUInt16LE(pos + 10);
    const komprimiert = buf.readUInt32LE(pos + 20);
    const entpacktLaut = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28), extraLen = buf.readUInt16LE(pos + 30), kommentarLen = buf.readUInt16LE(pos + 32);
    const lokal = buf.readUInt32LE(pos + 42);
    if (flags & 1) throw new Error('Verschlüsselte Excel-Dateien werden nicht unterstützt.');
    if (komprimiert === 0xffffffff || entpacktLaut === 0xffffffff || lokal === 0xffffffff) throw new Error('ZIP64-Dateien werden nicht unterstützt.');
    if (entpacktLaut > g.eintragBytes) throw new Error('Ein Bestandteil der Datei ist entpackt zu groß.');
    if (lokal + 30 > buf.length || buf.readUInt32LE(lokal) !== 0x04034b50) throw new Error('Die Excel-Datei ist beschädigt (lokaler ZIP-Kopf).');
    const start = lokal + 30 + buf.readUInt16LE(lokal + 26) + buf.readUInt16LE(lokal + 28);
    if (start + komprimiert > buf.length) throw new Error('Die Excel-Datei ist beschädigt (Daten fehlen).');
    const daten = buf.subarray(start, start + komprimiert);
    let tatsaechlich;
    if (methode === 0) tatsaechlich = komprimiert;
    else if (methode === 8) {
      try {
        tatsaechlich = zlib.inflateRawSync(daten, { maxOutputLength: g.eintragBytes }).length;
      } catch (e) {
        throw new Error(e.code === 'ERR_BUFFER_TOO_LARGE' || e instanceof RangeError ? 'Ein Bestandteil der Datei ist entpackt zu groß.' : 'Die Excel-Datei ist beschädigt (Entpacken fehlgeschlagen).');
      }
    } else throw new Error('Unbekannte Kompression in der Excel-Datei.');
    gesamt += tatsaechlich;
    if (gesamt > g.gesamtBytes) throw new Error(`Die Datei ist entpackt größer als ${g.gesamtBytes / 1024 / 1024} MB.`);
    pos += 46 + nameLen + extraLen + kommentarLen;
  }
  return { eintraege: anzahl, entpacktBytes: gesamt };
}

/**
 * Liest eine Datei im Aufbau der Vorlage.
 * @param {Buffer} buffer
 * @returns {Promise<{positionen:Array<{gruppe,bezeichnung,einheit,ep,zeile}>, offen:Array}>}
 */
async function leseVorlage(buffer, { maxZeilen = IMPORT_GRENZEN.zeilen } = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets.find((w) => w.rowCount > 0);
  if (!ws) throw new Error('Die Datei enthält kein befülltes Tabellenblatt.');
  if (ws.rowCount > maxZeilen) throw new Error(`Die Tabelle hat zu viele Zeilen (${ws.rowCount}, höchstens ${maxZeilen}).`);
  const positionen = [];
  let offen = [];
  const summenzeilen = new Map(GRUPPEN.map((g) => [g.summenzeile.toLowerCase(), g.schluessel]));
  ws.eachRow({ includeEmpty: false }, (row, nr) => {
    const a = textAusZelle(row.getCell(1).value).trim();
    if (!a) return;
    const gruppe = summenzeilen.get(a.toLowerCase());
    if (gruppe) {
      for (const p of offen) positionen.push({ ...p, gruppe });
      offen = [];
      return;
    }
    const einheit = textAusZelle(row.getCell(2).value).trim();
    const ep = zahlAusZelle(row.getCell(14).value);
    if (!einheit || ep == null) return; // Titel-/Leerzeilen
    // Texte begrenzen (geprüft wird später je Zeile)
    offen.push({ bezeichnung: a.slice(0, 1000), einheit: einheit.slice(0, 100), ep, zeile: nr, laenge: { bezeichnung: a.length, einheit: einheit.length } });
  });
  return { positionen, offen };
}

/**
 * Schreibt eine Nachkalkulation im Aufbau der Vorlage mit Formeln.
 * @param {{titel:string, gruppen:Array<{schluessel,name,positionen:Array<{bezeichnung,einheit,ep,mengeAuto,eintraege:[{menge}]}>}>}} daten
 * @returns {Promise<Buffer>}
 */
async function schreibeExport(daten) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BauTag';
  const ws = wb.addWorksheet('Tabelle1');
  ws.columns = [{ width: 38 }, { width: 7 }, ...Array(10).fill({ width: 9 }), { width: 10 }, { width: 10 }, { width: 13 }];
  ws.getCell('A1').value = daten.titel || '';
  ws.getCell('B1').value = 'EH';
  ws.getCell('C1').value = 'Berichte';
  for (let i = 0; i < 9; i++) ws.getRow(1).getCell(4 + i).value = `Eintrag ${i + 1}`;
  ws.getCell('M1').value = 'ZS';
  ws.getCell('N1').value = 'EP';
  ws.getCell('O1').value = 'SUMME';
  ws.getRow(1).font = { bold: true };
  let z = 2;
  const summenZellen = {};
  const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
  const gruppenwerte = {};
  for (const g of GRUPPEN) {
    const gr = (daten.gruppen || []).find((x) => x.schluessel === g.schluessel) || { positionen: [] };
    const start = z;
    let gruppenSumme = 0;
    for (const p of gr.positionen) {
      const row = ws.getRow(z);
      row.getCell(1).value = p.bezeichnung;
      row.getCell(2).value = p.einheit;
      const r3 = (x) => Math.round((x + Number.EPSILON) * 1000) / 1000;
      const werte = [r3(p.mengeAuto || 0), ...(p.eintraege || []).map((e) => r3(e.menge))]; // E-06: wie die App
      // C = Berichte, D–L = Einträge (mehr als 9 Einträge werden in L zusammengefasst)
      const spalten = [werte[0], ...werte.slice(1, 9), werte.slice(9).reduce((a, x) => a + x, 0)];
      spalten.forEach((w, i) => { if (w) row.getCell(3 + i).value = w; });
      const menge = r3(werte.reduce((a, x) => a + x, 0));
      const summe = r2(menge * p.ep);
      gruppenSumme += summe;
      row.getCell(13).value = { formula: `SUM(C${z}:L${z})`, result: menge };
      row.getCell(14).value = p.ep;
      row.getCell(15).value = { formula: `ROUND(M${z}*N${z},2)`, result: summe };
      z++;
    }
    const row = ws.getRow(z);
    row.getCell(1).value = g.summenzeile;
    row.getCell(14).value = 'Summe';
    row.getCell(15).value = { formula: z > start ? `SUM(O${start}:O${z - 1})` : '0', result: r2(gruppenSumme) };
    row.font = { bold: true };
    summenZellen[g.schluessel] = `O${z}`;
    gruppenwerte[g.schluessel] = r2(gruppenSumme);
    z += 2;
  }
  // Zusammenstellung
  z++;
  ws.getCell(`H${z}`).value = 'Zusammenstellung';
  ws.getCell(`H${z}`).font = { bold: true };
  const gesamtZeile = z + GRUPPEN.length * 2 + 1;
  const gesamt = r2(Object.values(gruppenwerte).reduce((a, x) => a + x, 0));
  const ersteZeile = z;
  let anteilSumme = 0;
  for (const g of GRUPPEN) {
    const anteil = gesamt ? Math.round((gruppenwerte[g.schluessel] / gesamt) * 1000) / 10 : 0;
    anteilSumme += anteil;
    ws.getCell(`J${z}`).value = g.summenzeile;
    ws.getCell(`M${z}`).value = { formula: `IF(O$${gesamtZeile}=0,0,ROUND(O${z}/O$${gesamtZeile}*100,1))`, result: anteil };
    ws.getCell(`N${z}`).value = '%';
    ws.getCell(`O${z}`).value = { formula: summenZellen[g.schluessel], result: gruppenwerte[g.schluessel] };
    z += 2;
  }
  ws.getCell(`M${z - 1}`).value = ' ----------';
  ws.getCell(`O${z - 1}`).value = ' --------------';
  ws.getCell(`J${gesamtZeile}`).value = 'Gesamtsumme';
  ws.getCell(`M${gesamtZeile}`).value = { formula: `SUM(M${ersteZeile}:M${gesamtZeile - 2})`, result: Math.round(anteilSumme * 10) / 10 }; // E-06: Summe der gerundeten Anteile
  ws.getCell(`N${gesamtZeile}`).value = '%';
  ws.getCell(`O${gesamtZeile}`).value = { formula: `SUM(O${ersteZeile}:O${gesamtZeile - 2})`, result: gesamt };
  ws.getRow(gesamtZeile).font = { bold: true };
  for (let r = 2; r <= gesamtZeile; r++) {
    for (const c of [13, 14, 15]) ws.getRow(r).getCell(c).numFmt = '#,##0.00';
  }
  wb.calcProperties = { fullCalcOnLoad: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Wendet die versionierten Katalog-Anpassungen (daten/katalog_anpassungen.js, API.md 10d) auf die
 * aus der Excel-Vorlage gelesenen Positionen an. Ergebnis mit herkunft und naturmaterial je Position.
 */
function wendeAnpassungenAn(basis, anpassungen) {
  const { istNaturmaterial } = require('./positionen-zuordnung');
  let liste = basis.map((p) => ({
    gruppe: p.gruppe, bezeichnung: p.bezeichnung.trim(), einheit: p.einheit, ep: p.ep, herkunft: 'vorlage_excel',
    naturmaterial: istNaturmaterial(p.bezeichnung, p.einheit, p.gruppe), ...(p.zeile ? { zeile: p.zeile } : {})
  }));
  for (const a of anpassungen) {
    for (const u of a.umbenennungen || []) {
      const p = liste.find((x) => x.bezeichnung === u.alt.trim() && x.einheit === u.einheit);
      if (!p) throw new Error(`Anpassung ${a.version}: „${u.alt}“ nicht gefunden.`);
      p.bezeichnung = u.neu;
    }
    for (const pr of a.preise || []) {
      const p = liste.find((x) => x.bezeichnung === pr.bezeichnung && x.einheit === pr.einheit);
      if (!p) throw new Error(`Anpassung ${a.version}: Preis für „${pr.bezeichnung}“ – Position nicht gefunden.`);
      p.ep = pr.ep;
    }
    for (const n of a.neu || []) {
      const neu = { gruppe: n.gruppe, bezeichnung: n.bezeichnung, einheit: n.einheit, ep: n.ep, herkunft: 'preisliste_2026', naturmaterial: Boolean(n.naturmaterial) };
      let i = n.nach ? liste.findIndex((x) => x.bezeichnung === n.nach && x.gruppe === n.gruppe) : -1;
      if (n.nach && i < 0) throw new Error(`Anpassung ${a.version}: „${n.nach}“ (nach) nicht gefunden.`);
      if (i < 0) i = liste.map((x) => x.gruppe).lastIndexOf(n.gruppe);
      // hinter bereits eingefügte Positionen derselben Stelle
      while (i + 1 < liste.length && liste[i + 1].herkunft === 'preisliste_2026' && liste[i + 1].gruppe === n.gruppe && n.nach) i++;
      liste = [...liste.slice(0, i + 1), neu, ...liste.slice(i + 1)];
    }
  }
  return liste;
}

function ladeAnpassungen() {
  return require('./daten/katalog_anpassungen');
}

function ladeKatalogVorlage() {
  return JSON.parse(fs.readFileSync(KATALOG_JSON, 'utf8'));
}

if (require.main === module) {
  (async () => {
    const r = await leseVorlage(fs.readFileSync(VORLAGE));
    if (r.offen.length) throw new Error(`Positionen ohne Summenzeile: ${r.offen.map((p) => p.bezeichnung).join(', ')}`);
    fs.mkdirSync(path.dirname(KATALOG_JSON), { recursive: true });
    const anp = ladeAnpassungen();
    const daten = {
      stand: '2026-04-01', quelle: path.basename(VORLAGE),
      anpassungen: anp.map((a) => ({ version: a.version, beschreibung: a.beschreibung })),
      positionen: wendeAnpassungenAn(r.positionen, anp)
    };
    fs.writeFileSync(KATALOG_JSON, JSON.stringify(daten, null, 1) + '\n');
    console.log(`${daten.positionen.length} Positionen nach ${KATALOG_JSON} geschrieben.`);
  })().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { IMPORT_GRENZEN, pruefeZip, GRUPPEN, GRUPPEN_SCHLUESSEL, VORLAGE, KATALOG_JSON, leseVorlage, schreibeExport, ladeKatalogVorlage, ladeAnpassungen, wendeAnpassungenAn, zahlAusZelle };
