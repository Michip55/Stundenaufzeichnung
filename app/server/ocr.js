'use strict';
/**
 * Texterkennung (API.md 12.11/12.12) mit tesseract.js, Deutsch, offline (Sprachdaten aus dem npm-Paket
 * @tesseract.js-data/deu bzw. BAUTAG_OCR_DATEN). BAUTAG_OCR=0 schaltet ab. Mit bt.test: Vorgabetext.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const BEISPIEL = 'Kieswerk Mustermann GmbH\nLieferschein Nr. 4711\nDatum: 12.11.2026\nBaustelle: 26-041 WHA Pitten\nFrostschutz 0/63 24,50 t\nSplitt 2/4 8,0 t\n';

function datenOrdner() {
  if (process.env.BAUTAG_OCR_DATEN) return process.env.BAUTAG_OCR_DATEN;
  try { return path.join(path.dirname(require.resolve('@tesseract.js-data/deu/package.json')), '4.0.0'); } catch (_) { return null; }
}

function verfuegbar(bt) {
  if (process.env.BAUTAG_OCR === '0') return false;
  if (bt && bt.test) return true;
  const d = datenOrdner();
  if (!d || !fs.existsSync(path.join(d, 'deu.traineddata.gz')) && !fs.existsSync(path.join(d, 'deu.traineddata'))) return false;
  try { require.resolve('tesseract.js'); return true; } catch (_) { return false; }
}

let worker = null;
let warteschlange = Promise.resolve();

async function arbeiter() {
  if (worker) return worker;
  const T = require('tesseract.js');
  const d = datenOrdner();
  const gz = fs.existsSync(path.join(d, 'deu.traineddata.gz'));
  const cache = path.join(os.tmpdir(), 'bautag-ocr-cache');
  fs.mkdirSync(cache, { recursive: true });
  worker = await T.createWorker('deu', 1, { langPath: d, cachePath: cache, gzip: gz, logger: () => {}, errorHandler: () => {} });
  return worker;
}

/** Text eines Bildes (JPEG/PNG/WebP) – nacheinander, ein Worker */
function erkennen(bt, buf) {
  if (bt.test) {
    const t = bt.testVorgaben.ocrText;
    return Promise.resolve(t == null ? BEISPIEL : t);
  }
  const lauf = warteschlange.then(async () => {
    const w = await arbeiter();
    const r = await Promise.race([w.recognize(buf), new Promise((_, nein) => setTimeout(() => nein(new Error('Texterkennung dauert zu lange')), 60000).unref())]);
    return nachbearbeiten(r.data.text || '');
  });
  warteschlange = lauf.catch(() => {});
  return lauf;
}

/** Typische OCR-Fehler: „t“ nach Zahl am Zeilenende als „£“/„€“ gelesen */
function nachbearbeiten(text) {
  return String(text).replace(/(\d)\s*[£€]\s*$/gm, '$1 t').replace(/[ \t]+/g, ' ');
}

async function beenden() {
  if (worker) { const w = worker; worker = null; try { await w.terminate(); } catch (_) { /* egal */ } }
}

module.exports = { verfuegbar, erkennen, nachbearbeiten, beenden, BEISPIEL };
