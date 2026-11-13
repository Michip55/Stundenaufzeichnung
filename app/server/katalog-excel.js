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

/**
 * Liest eine Datei im Aufbau der Vorlage.
 * @param {Buffer} buffer
 * @returns {Promise<{positionen:Array<{gruppe,bezeichnung,einheit,ep,zeile}>, offen:Array}>}
 */
async function leseVorlage(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets.find((w) => w.rowCount > 0);
  if (!ws) throw new Error('Die Datei enthält kein befülltes Tabellenblatt.');
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
    offen.push({ bezeichnung: a, einheit, ep, zeile: nr });
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
      const werte = [p.mengeAuto || 0, ...(p.eintraege || []).map((e) => e.menge)];
      // C = Berichte, D–L = Einträge (mehr als 9 Einträge werden in L zusammengefasst)
      const spalten = [werte[0], ...werte.slice(1, 9), werte.slice(9).reduce((a, x) => a + x, 0)];
      spalten.forEach((w, i) => { if (w) row.getCell(3 + i).value = w; });
      const menge = werte.reduce((a, x) => a + x, 0);
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
  for (const g of GRUPPEN) {
    const anteil = gesamt ? Math.round((gruppenwerte[g.schluessel] / gesamt) * 1000) / 10 : 0;
    ws.getCell(`J${z}`).value = g.summenzeile;
    ws.getCell(`M${z}`).value = { formula: `IF(O$${gesamtZeile}=0,0,ROUND(O${z}/O$${gesamtZeile}*100,1))`, result: anteil };
    ws.getCell(`N${z}`).value = '%';
    ws.getCell(`O${z}`).value = { formula: summenZellen[g.schluessel], result: gruppenwerte[g.schluessel] };
    z += 2;
  }
  ws.getCell(`M${z - 1}`).value = ' ----------';
  ws.getCell(`O${z - 1}`).value = ' --------------';
  ws.getCell(`J${gesamtZeile}`).value = 'Gesamtsumme';
  ws.getCell(`M${gesamtZeile}`).value = { formula: `SUM(M${ersteZeile}:M${gesamtZeile - 2})`, result: gesamt ? 100 : 0 };
  ws.getCell(`N${gesamtZeile}`).value = '%';
  ws.getCell(`O${gesamtZeile}`).value = { formula: `SUM(O${ersteZeile}:O${gesamtZeile - 2})`, result: gesamt };
  ws.getRow(gesamtZeile).font = { bold: true };
  for (let r = 2; r <= gesamtZeile; r++) {
    for (const c of [13, 14, 15]) ws.getRow(r).getCell(c).numFmt = '#,##0.00';
  }
  wb.calcProperties = { fullCalcOnLoad: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function ladeKatalogVorlage() {
  return JSON.parse(fs.readFileSync(KATALOG_JSON, 'utf8'));
}

if (require.main === module) {
  (async () => {
    const r = await leseVorlage(fs.readFileSync(VORLAGE));
    if (r.offen.length) throw new Error(`Positionen ohne Summenzeile: ${r.offen.map((p) => p.bezeichnung).join(', ')}`);
    fs.mkdirSync(path.dirname(KATALOG_JSON), { recursive: true });
    const daten = { stand: '2026-04-01', quelle: path.basename(VORLAGE), positionen: r.positionen.map(({ zeile, ...p }) => ({ ...p, zeile })) };
    fs.writeFileSync(KATALOG_JSON, JSON.stringify(daten, null, 1) + '\n');
    console.log(`${daten.positionen.length} Positionen nach ${KATALOG_JSON} geschrieben.`);
  })().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { GRUPPEN, GRUPPEN_SCHLUESSEL, VORLAGE, KATALOG_JSON, leseVorlage, schreibeExport, ladeKatalogVorlage, zahlAusZelle };
