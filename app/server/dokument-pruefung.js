'use strict';
/**
 * Prüfung hochgeladener Projektdokumente (API.md 12.16): Erkennung an Magic Bytes, PDF ohne Verschlüsselung/
 * aktive Inhalte (auch in Flate-komprimierten Streams), Bilder wie 11.9, DOCX/XLSX ohne Makros. Höchstens 25 MB.
 */
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const Bild = require('./fuhrpark-bild');
const { pruefeZip } = require('./katalog-excel');

const MAX_BYTES = 25 * 1024 * 1024;
const ZIP_GRENZEN = { dateiBytes: MAX_BYTES, eintraege: 3000, eintragBytes: 100 * 1024 * 1024, gesamtBytes: 250 * 1024 * 1024, zeilen: 0 };
const ENDUNG = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx' };

class DokumentFehler extends Error {}

/** Namen im ZIP-Zentralverzeichnis */
function zipNamen(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return [];
  const anzahl = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const namen = [];
  for (let n = 0; n < anzahl && pos + 46 <= buf.length; n++) {
    const nl = buf.readUInt16LE(pos + 28), el = buf.readUInt16LE(pos + 30), kl = buf.readUInt16LE(pos + 32);
    namen.push(buf.subarray(pos + 46, pos + 46 + nl).toString('utf8'));
    pos += 46 + nl + el + kl;
  }
  return namen;
}

const NICHT_PRUEFBAR = 'PDF enthält nicht prüfbare Inhalte – bitte als PDF/A oder neu drucken.';
const BILD_FILTER = new Set(['DCTDecode', 'DCT', 'JPXDecode', 'CCITTFaxDecode', 'CCF', 'JBIG2Decode']);
const KURZ = { AHx: 'ASCIIHexDecode', A85: 'ASCII85Decode', Fl: 'FlateDecode', LZW: 'LZWDecode', RL: 'RunLengthDecode' };
const MAX_STREAM = 20 * 1024 * 1024;
/** N-025/N-010: Grenzen der PDF-Prüfung – wird eine erreicht, ist das PDF „nicht prüfbar“ (nie annehmen) */
const MAX_GESAMT = 100 * 1024 * 1024; // Summe aller dekodierten Daten
const MAX_STREAMS = 50000; // Stream-Objekte (auch leere)
const MAX_TIEFE = 64; // Verschachtelung von Dictionaries/Arrays
const MAX_OBJEKTE = 500000; // Objektköpfe „N G obj“ (auch ohne Stream)
const MAX_LAENGEN = 4; // verschiedene Werte einer indirekten /Length (je Wert eine Lesart)
/**
 * Gesamtes Byte-Budget der Prüfung (Rest N-010): Eingang jedes Dekoders, jede dekodierte Stufe, jeder durchsuchte und jeder
 * normalisierte Text zählen. Höchstens 400 MB, bei kleinen Dateien 32 MB + 32 × Dateigröße – ein kleines PDF kann so
 * keine Hunderte MB Prüfarbeit erzeugen.
 */
const MAX_PRUEFBYTES = 4 * MAX_GESAMT;
const pruefBytesGrenze = (laenge) => Math.min(MAX_PRUEFBYTES, 32 * 1024 * 1024 + 32 * laenge);

/**
 * Verbotene Namen (API.md 12.16, 14.4): verschlüsselt, Skripte, Start externer Programme, eingebettete Dateien
 * (auch /EmbeddedFiles, /EF, Anhang-Anmerkungen), RichMedia, XFA-Formulare, Formular senden/importieren,
 * Sprünge in fremde Dateien (/GoToR, /GoToE), Skripte in 3D-Inhalten.
 */
const PDF_VERBOTEN = /\/(Encrypt\b|JavaScript\b|JS\b|Launch\b|EmbeddedFile|EF\b|FileAttachment\b|RichMedia|XFA\b|SubmitForm\b|ImportData\b|GoToR\b|GoToE\b|OnInstantiate\b)/;
/** Link-Ziele (/URI): nur http(s), mailto, tel oder ohne Schema; nie javascript:, file:, UNC-Pfade … */
const URI_SCHEMATA = new Set(['http', 'https', 'mailto', 'tel']);

const hexWert = (c) => (c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1);
/**
 * PDF-Namen normalisieren: Kommentare → Leerzeichen, dann #xx-Escapes, Leerraum zusammengefasst (G-08). Ein Durchlauf
 * über die Bytes (gleiches Ergebnis wie die früheren drei regulären Ausdrücke, aber linear und ohne Zwischen-Strings).
 */
function normalisieren(t) {
  const b = Buffer.from(t, 'latin1');
  const out = Buffer.allocUnsafe(b.length);
  let o = 0, leer = false;
  for (let i = 0; i < b.length; i++) {
    let c = b[i];
    if (c === 37) { while (i + 1 < b.length && b[i + 1] !== 10 && b[i + 1] !== 13) i++; c = 32; } // Kommentar bis zum Zeilenende
    else if (c === 35 && i + 2 < b.length) { const h = hexWert(b[i + 1]), l = hexWert(b[i + 2]); if (h >= 0 && l >= 0) { c = h * 16 + l; i += 2; } }
    if (c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32) { if (!leer) { out[o++] = 32; leer = true; } continue; }
    leer = false;
    out[o++] = c;
  }
  return out.toString('latin1', 0, o);
}

/** ASCIIHex wie pdf.js: alles außer Hex-Ziffern wird übersprungen, „>“ beendet */
function asciiHex(b) {
  const t = b.toString('latin1');
  const e = t.indexOf('>');
  let h = (e >= 0 ? t.slice(0, e) : t).replace(/[^0-9a-fA-F]+/g, '');
  if (h.length % 2) h += '0';
  return Buffer.from(h, 'hex');
}

/**
 * ASCII85 wie pdf.js (Leerraum überspringen, „~“ beendet, „z“ = 4 Nullbytes, andere Zeichen zählen als Ziffer).
 * N-026: Ausgabe in einen begrenzten Buffer, auch „z“ prüft die Grenze MAX_STREAM.
 */
function ascii85(b) {
  let i = 0;
  if (b[0] === 0x3c && b[1] === 0x7e) i = 2; // „<~“
  const out = Buffer.allocUnsafe(Math.min(MAX_STREAM + 4, b.length * 4 + 4));
  let n = 0;
  const gruppe = [];
  const schreibe = (v, anzahl) => {
    if (n + anzahl > MAX_STREAM) throw new Error('zu groß');
    for (let k = 0; k < anzahl; k++) out[n++] = (v >>> (24 - 8 * k)) & 255;
  };
  const block = (g, anzahl) => {
    let v = 0;
    for (const c of g) v = v * 85 + (c - 33);
    schreibe(v % 4294967296, anzahl);
  };
  for (; i < b.length; i++) {
    const c = b[i];
    if (c === 0x7e) break; // „~>“
    if (c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32) continue;
    if (c === 0x7a && !gruppe.length) { schreibe(0, 4); continue; } // „z“
    gruppe.push(c);
    if (gruppe.length === 5) { block(gruppe, 4); gruppe.length = 0; }
  }
  if (gruppe.length > 1) { const k = gruppe.length - 1; while (gruppe.length < 5) gruppe.push(117); block(gruppe, k); }
  return Buffer.from(out.subarray(0, n));
}

/** Flate: zlib, ohne Prüfsumme (manche Leser ignorieren sie) bzw. ohne zlib-Kopf */
function inflate(d) {
  const o = { maxOutputLength: MAX_STREAM, finishFlush: zlib.constants.Z_SYNC_FLUSH };
  try { return zlib.inflateSync(d, o); } catch (e) { if (e && e.code === 'ERR_BUFFER_TOO_LARGE') throw e; }
  if (d.length > 2 && (d[0] & 0x0f) === 8) { try { return zlib.inflateRawSync(d.subarray(2), o); } catch (e) { if (e && e.code === 'ERR_BUFFER_TOO_LARGE') throw e; } }
  return zlib.inflateRawSync(d, o);
}
/** Flate für Neben-Lesarten: bei kaputten Daten das längste lesbare Anfangsstück (wie Leser, die bis zum Fehler anzeigen) */
function inflateTeilweise(d, budget) {
  try { return inflate(d); } catch (e) { if (e && e.code === 'ERR_BUFFER_TOO_LARGE') throw e; }
  let best = Buffer.alloc(0);
  for (const roh of (d.length > 2 && (d[0] & 0x0f) === 8 ? [d.subarray(2), d] : [d])) {
    let lo = 0, hi = roh.length;
    while (lo < hi) {
      const mitte = Math.ceil((lo + hi) / 2);
      let x = null;
      try { x = zlib.inflateRawSync(roh.subarray(0, mitte), { maxOutputLength: MAX_STREAM, finishFlush: zlib.constants.Z_SYNC_FLUSH }); } catch (e) { if (e && e.code === 'ERR_BUFFER_TOO_LARGE') throw e; }
      // Rest N-010: gelesene Eingabe zählt mit (gelungen: alles; misslungen: mindestens das schon lesbare Stück lo)
      budget.bytes(x ? mitte : lo);
      budget.verbrauche(x ? x.length : 0);
      if (x) { lo = mitte; if (x.length > best.length) best = x; } else hi = mitte - 1;
    }
  }
  return best;
}

/** PNG- (10–15) bzw. TIFF-Prädiktor (2, nur 8 Bit) rückgängig machen – sonst wären Namen in den Daten zerstückelt */
function praediktor(d, p) {
  const pred = p.Predictor || 1;
  if (pred === 1) return d;
  const farben = p.Colors || 1, bpc = p.BitsPerComponent || 8, spalten = p.Columns || 1;
  if (![1, 2, 4, 8, 16].includes(bpc) || farben < 1 || farben > 64 || spalten < 1 || spalten > 1 << 24) throw new DokumentFehler(NICHT_PRUEFBAR);
  const bpp = Math.max(1, Math.ceil((farben * bpc) / 8));
  const zeile = Math.ceil((farben * bpc * spalten) / 8);
  if (pred === 2) {
    if (bpc !== 8) throw new DokumentFehler(NICHT_PRUEFBAR);
    const o = Buffer.from(d);
    for (let z = 0; z < o.length; z += zeile) for (let i = z + bpp; i < Math.min(z + zeile, o.length); i++) o[i] = (o[i] + o[i - bpp]) & 255;
    return o;
  }
  if (pred < 10 || pred > 15) throw new DokumentFehler(NICHT_PRUEFBAR);
  const out = Buffer.alloc(Math.floor(d.length / (zeile + 1)) * zeile + Math.max(0, (d.length % (zeile + 1)) - 1));
  let vorher = Buffer.alloc(zeile);
  let o = 0;
  for (let i = 0; i < d.length; i += zeile + 1) {
    const typ = d[i];
    const roh = d.subarray(i + 1, i + 1 + zeile);
    const z = Buffer.alloc(roh.length);
    for (let k = 0; k < roh.length; k++) {
      const a = k >= bpp ? z[k - bpp] : 0, b = vorher[k], c = k >= bpp ? vorher[k - bpp] : 0;
      let x = roh[k];
      if (typ === 1) x += a;
      else if (typ === 2) x += b;
      else if (typ === 3) x += (a + b) >> 1;
      else if (typ === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); x += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      z[k] = x & 255;
    }
    z.copy(out, o); o += z.length;
    vorher = z.length === zeile ? z : Buffer.concat([z, Buffer.alloc(zeile - z.length)]);
  }
  return out.subarray(0, o);
}

/* ---------- kleiner PDF-Leser (Objekte, Dictionaries, Streams) ---------- */
const istLeer = (c) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const istTrenner = (c) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
const istNormal = (c) => !Number.isNaN(c) && !istLeer(c) && !istTrenner(c);
const nameDekodieren = (n) => n.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

class Leser {
  constructor(text, budget) { this.t = text; this.budget = budget; }
  leer(p) {
    const t = this.t;
    const start = p;
    for (;;) {
      const c = t.charCodeAt(p);
      if (istLeer(c)) p++;
      else if (c === 37) { while (p < t.length && t.charCodeAt(p) !== 10 && t.charCodeAt(p) !== 13) p++; }
      else { this.budget.arbeit(p - start); return p; }
    }
  }
  /** → {typ, wert, start, ende} oder null (kein lesbares Objekt) */
  objekt(p, tiefe = 0) {
    if (tiefe > MAX_TIEFE) return null;
    const t = this.t;
    p = this.leer(p);
    const start = p;
    const c = t.charCodeAt(p);
    if (c === 60 && t.charCodeAt(p + 1) === 60) { // << … >>
      p += 2;
      const eintraege = [];
      for (;;) {
        p = this.leer(p);
        if (p >= t.length) return null;
        if (t.charCodeAt(p) === 62 && t.charCodeAt(p + 1) === 62) { p += 2; break; }
        if (t.charCodeAt(p) !== 47) return null;
        const k = this.objekt(p, tiefe + 1);
        if (!k) return null;
        const v = this.objekt(k.ende, tiefe + 1);
        if (!v) return null;
        eintraege.push([k.wert, v]);
        p = v.ende;
      }
      this.budget.arbeit(p - start);
      return { typ: 'dict', wert: eintraege, start, ende: p };
    }
    if (c === 60) { // <hex>
      const e = t.indexOf('>', p);
      this.budget.arbeit((e < 0 ? t.length : e) - p);
      if (e < 0) return null;
      return { typ: 'hex', wert: t.slice(p + 1, e), start, ende: e + 1 };
    }
    if (c === 40) { // (literal)
      let tiefeS = 0, i = p;
      for (; i < t.length; i++) {
        const x = t.charCodeAt(i);
        if (x === 92) { i++; continue; }
        if (x === 40) tiefeS++;
        else if (x === 41 && --tiefeS === 0) break;
      }
      this.budget.arbeit(i - p);
      if (i >= t.length) return null;
      return { typ: 'text', wert: t.slice(p + 1, i), start, ende: i + 1 };
    }
    if (c === 91) { // [ … ]
      p++;
      const liste = [];
      for (;;) {
        p = this.leer(p);
        if (p >= t.length) return null;
        if (t.charCodeAt(p) === 93) { p++; break; }
        const v = this.objekt(p, tiefe + 1);
        if (!v) return null;
        liste.push(v);
        p = v.ende;
      }
      this.budget.arbeit(p - start);
      return { typ: 'array', wert: liste, start, ende: p };
    }
    if (c === 47) { // /Name
      let i = p + 1;
      while (istNormal(t.charCodeAt(i))) i++;
      this.budget.arbeit(i - p);
      return { typ: 'name', wert: nameDekodieren(t.slice(p + 1, i)), start, ende: i };
    }
    let i = p;
    while (istNormal(t.charCodeAt(i))) i++;
    this.budget.arbeit(i - p);
    if (i === p) return null;
    const wort = t.slice(p, i);
    if (/^\d+$/.test(wort)) { // Verweis „N G R“?
      const q = this.leer(i);
      let j = q;
      while (j - q < 6 && t.charCodeAt(j) >= 48 && t.charCodeAt(j) <= 57) j++;
      if (j > q && !istNormal(t.charCodeAt(j))) {
        const r = this.leer(j);
        if (t.charCodeAt(r) === 82 && !istNormal(t.charCodeAt(r + 1))) return { typ: 'ref', wert: `${Number(wort)} ${Number(t.slice(q, j))}`, start, ende: r + 1 };
      }
      return { typ: 'int', wert: Number(wort), start, ende: i };
    }
    return { typ: 'wort', wert: wort, start, ende: i };
  }
}

/**
 * Budget gegen Rechenzeit- und Speicher-Angriffe (N-010, N-025, N-026), gemeinsam für die ganze Datei:
 * arbeit – Schritte des kleinen Lesers; verbrauche – dekodierte Daten (höchstens MAX_GESAMT, zählen auch als bytes);
 * bytes – alle gelesenen, dekodierten und normalisierten Bytes (pruefBytesGrenze).
 */
function neuesBudget(laenge) {
  let arbeit = 0, gesamt = 0, bytes = 0;
  const grenzeArbeit = 4 * laenge + 1024 * 1024;
  const grenzeBytes = pruefBytesGrenze(laenge);
  return {
    arbeit(n) { arbeit += n; if (arbeit > grenzeArbeit) throw new DokumentFehler(NICHT_PRUEFBAR); },
    bytes(n) { bytes += n; if (bytes > grenzeBytes) throw new DokumentFehler(NICHT_PRUEFBAR); },
    verbrauche(n) { gesamt += n; if (gesamt > MAX_GESAMT) throw new DokumentFehler(NICHT_PRUEFBAR); this.bytes(n); }
  };
}

/** Stream-Dictionary auswerten (nur oberste Ebene – verschachtelte Dicts wie /DecodeParms zählen nicht) */
function streamInfo(dict) {
  const k = new Map();
  for (const [name, v] of dict.wert) {
    if (k.has(name)) throw new DokumentFehler(NICHT_PRUEFBAR); // doppelte Schlüssel lesen Leser verschieden
    k.set(name, v);
  }
  if (k.has('F') || k.has('FFilter')) throw new DokumentFehler(NICHT_PRUEFBAR); // Daten aus externer Datei
  const nameVon = (v) => (v && v.typ === 'name' ? v.wert : null);
  const typ = nameVon(k.get('Type'));
  const objStmArtig = k.has('N') || k.has('First') || typ === 'ObjStm' || typ === 'XRef';
  const sub = nameVon(k.get('Subtype'));
  const schrift = k.has('Length1') || k.has('Length2') || k.has('Length3') || ['Type1C', 'CIDFontType0C', 'OpenType'].includes(sub);
  const info = { k, objStmArtig, istBild: !objStmArtig && sub === 'Image', schrift: !objStmArtig && schrift, filter: [], parms: [], filterUnklar: false };
  const f = k.get('Filter');
  if (f && f.typ === 'name') info.filter = [f.wert];
  else if (f && f.typ === 'array' && f.wert.every((x) => x.typ === 'name')) info.filter = f.wert.map((x) => x.wert);
  else if (f && !(f.typ === 'wort' && f.wert === 'null')) info.filterUnklar = true; // z. B. /Filter 5 0 R
  const dp = k.get('DecodeParms') || k.get('DP');
  const parm = (v) => {
    if (!v || (v.typ === 'wort' && v.wert === 'null')) return {};
    if (v.typ !== 'dict') return null;
    const o = {};
    for (const [name, x] of v.wert) if (['Predictor', 'Colors', 'BitsPerComponent', 'Columns'].includes(name)) { if (x.typ !== 'int') return null; o[name] = x.wert; }
    return o;
  };
  info.parms = info.filter.map((_, i) => (dp && dp.typ === 'array' ? parm(dp.wert[i]) : parm(dp)));
  return info;
}

/**
 * Stream gemäß /Filter dekodieren → Buffer zum Prüfen, oder null (Bild-/Schriftdaten, nicht zu prüfen).
 * Nicht prüfbare Filter (LZW, RunLength, Crypt, unbekannt) außerhalb von Bildern → DokumentFehler.
 * @param {boolean} [neben]  Neben-Lesart (andere Stream-Grenzen): kaputte Flate-Daten bis zum Fehler lesen
 */
function streamDekodieren(roh, info, budget = neuesBudget(roh.length), neben = false) {
  if ((info.istBild || info.schrift) && !info.objStmArtig) return null; // nur Pixel bzw. Schriftdaten – keine aktiven Inhalte
  if (info.filterUnklar) throw new DokumentFehler(NICHT_PRUEFBAR);
  let d = roh;
  for (let i = 0; i < info.filter.length; i++) {
    const f = KURZ[info.filter[i]] || info.filter[i];
    if (BILD_FILTER.has(f)) {
      if (info.objStmArtig) throw new DokumentFehler(NICHT_PRUEFBAR); // Objekt-Stream muss lesbar sein
      return null; // Bilddaten
    }
    budget.bytes(d.length); // Eingang der Stufe
    try {
      if (f === 'FlateDecode') {
        d = neben ? inflateTeilweise(d, budget) : inflate(d);
        if (!info.parms[i]) throw new DokumentFehler(NICHT_PRUEFBAR);
        d = praediktor(d, info.parms[i]);
      } else if (f === 'ASCIIHexDecode') d = asciiHex(d);
      else if (f === 'ASCII85Decode') d = ascii85(d);
      else throw new DokumentFehler(NICHT_PRUEFBAR);
    } catch (e) {
      if (e instanceof DokumentFehler) throw e;
      throw new DokumentFehler(NICHT_PRUEFBAR);
    }
    budget.verbrauche(d.length);
  }
  return d;
}

/**
 * Bytes eines Literal- bzw. Hex-Strings (PDF 7.3.4): Escapes \n \r \t \b \f \( \) \\, Oktal \ddd (1–3 Ziffern),
 * Zeilenfortsetzung; Hex mit übersprungenem Leerraum, ungerade Länge mit 0 ergänzt.
 */
function stringBytes(v) {
  if (v.typ === 'hex') { let h = v.wert.replace(/[^0-9a-fA-F]+/g, ''); if (h.length % 2) h += '0'; return Buffer.from(h, 'hex'); }
  const t = v.wert;
  const out = Buffer.allocUnsafe(t.length);
  let o = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c !== 92) { out[o++] = c & 255; continue; }
    const x = t.charCodeAt(++i);
    if (x >= 48 && x <= 55) { // Oktal
      let w = x - 48, k = 1;
      while (k < 3 && t.charCodeAt(i + 1) >= 48 && t.charCodeAt(i + 1) <= 55) { w = w * 8 + t.charCodeAt(++i) - 48; k++; }
      out[o++] = w & 255;
    } else if (x === 13) { if (t.charCodeAt(i + 1) === 10) i++; } // Zeilenfortsetzung
    else if (x === 10) { /* Zeilenfortsetzung */ }
    else if (i < t.length) out[o++] = ({ 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 })[x] ?? (x & 255);
  }
  return out.subarray(0, o);
}

/** Text eines PDF-Strings (PDF 7.9.2.2): UTF-16BE bzw. UTF-16LE mit BOM, UTF-8 mit BOM, sonst Byte für Byte */
function pdfText(b) {
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) { const x = Buffer.from(b.subarray(2, 2 + ((b.length - 2) & ~1))); return x.swap16().toString('utf16le'); }
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return b.subarray(2, 2 + ((b.length - 2) & ~1)).toString('utf16le');
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return b.subarray(3).toString('utf8');
  return b.toString('latin1');
}

/** Literal- bzw. Hex-String eines PDF dekodieren (für Link- und Aktionsziele) */
const textDekodieren = (v) => pdfText(stringBytes(v));

/** Steuerzeichen, Leerraum und unsichtbare Zeichen (Leser bzw. Browser überspringen sie in Zielen) */
const UNSICHTBAR = /[\0-\x20\x7f-\xa0\xad\u034f\u061c\u115f\u1160\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufffb]+/g;

/**
 * Ziel (dekodierter Text) prüfen → Grund der Ablehnung oder null. Ein „:“ vor dem ersten „/“, „?“, „#“ bzw. „\“ ist ein
 * Schema – nur http(s), mailto, tel; UNC-Pfade und „\…“ → abgelehnt.
 */
function zielGrund(text) {
  const z = text.replace(UNSICHTBAR, '');
  const dp = z.indexOf(':');
  const trenner = z.search(/[/?#\\]/);
  if (dp >= 0 && (trenner < 0 || dp < trenner)) {
    const schema = z.slice(0, dp).toLowerCase();
    if (!URI_SCHEMATA.has(schema)) return /^[a-z][a-z0-9+.-]{0,30}$/.test(schema) ? `${schema}:` : 'mit unbekanntem Schema';
    return null;
  }
  if ((/^[\\/]{2}/.test(z) && !/^\/\/[^\\/]/.test(z)) || z.startsWith('\\')) return 'mit Dateipfad';
  return null;
}

/**
 * Ziele und Aktionsarten in Strings prüfen (N-064): Strings werden vorher dekodiert (Escapes, Oktal, Hex, UTF-16BE/LE
 * und UTF-8 mit BOM).
 *  - /URI: nur Text-Ziel, siehe zielGrund; Verweis nicht prüfbar → abgelehnt. /URI als Wert (/S /URI) oder als Dict
 *    (/URI << /Base … >> im Katalog) ist kein Link-Ziel.
 *  - /F, /UF, /DOS, /Mac, /Unix (Datei- bzw. Formularziele von /Launch, /SubmitForm, /GoToR …): Text wie zielGrund.
 *  - /S, /Type, /Subtype als String (manche Leser vergleichen Namen und Strings gleich): verbotene Namen → abgelehnt.
 */
const ZIEL_RE = /\/(URI|F|UF|DOS|Mac|Unix|S|Type|Subtype)(?![^\0\t\n\f\r ()<>[\]{}/%])/g;
function zielePruefen(t, budget) {
  const l = new Leser(t, budget);
  const re = new RegExp(ZIEL_RE.source, 'g');
  let m;
  while ((m = re.exec(t))) {
    const schluessel = m[1];
    const p = l.leer(m.index + m[0].length);
    const c = t.charCodeAt(p);
    const istText = c === 40 || (c === 60 && t.charCodeAt(p + 1) !== 60);
    if (!istText && !(schluessel === 'URI' && c >= 48 && c <= 57)) continue;
    const v = l.objekt(p);
    if (!v) continue;
    if (v.typ === 'ref') throw new DokumentFehler('PDF abgelehnt: /URI (Link-Ziel nicht prüfbar; aktive Inhalte).');
    if (v.typ !== 'text' && v.typ !== 'hex') continue;
    const text = textDekodieren(v);
    if (schluessel === 'S' || schluessel === 'Type' || schluessel === 'Subtype') {
      const n = `/${text.replace(UNSICHTBAR, '').replace(/^\//, '')}`;
      const x = PDF_VERBOTEN.exec(normalisieren(n));
      if (x && x.index === 0) throw new DokumentFehler(`PDF abgelehnt: /${x[1]} (verschlüsselt oder aktive Inhalte).`);
      continue;
    }
    const grund = zielGrund(text);
    if (grund) throw new DokumentFehler(`PDF abgelehnt: /${schluessel} ${grund} (aktive Inhalte).`);
  }
}

/** Text auf verbotene Namen prüfen – roh und normalisiert (G-08: #xx-Escapes, Kommentare, Leerraum); zählt gegen das Budget */
function inhaltPruefen(t, budget) {
  budget.bytes(t.length);
  const n = normalisieren(t);
  budget.bytes(n.length);
  for (const x of [t, n]) {
    const m = PDF_VERBOTEN.exec(x);
    if (m) throw new DokumentFehler(`PDF abgelehnt: /${m[1]} (verschlüsselt oder aktive Inhalte).`);
    zielePruefen(x, budget);
  }
}

const EOL = (t, p) => (t.charCodeAt(p) === 13 ? (t.charCodeAt(p + 1) === 10 ? 2 : 1) : t.charCodeAt(p) === 10 ? 1 : 0);
const nichtPruefbar = () => new DokumentFehler(NICHT_PRUEFBAR);

/**
 * PDF prüfen (API.md 12.16, 14.4, 14.8). Alle Objektköpfe „N G obj“ werden in einem Durchlauf gefunden (auch mit CR,
 * Kommentaren, ohne Leerzeichen vor „obj“), Stream-Dictionaries mit einem kleinen Leser ausgewertet (nur die oberste
 * Ebene), Stream-Grenzen über /Length und – falls Leser anders lesen – zusätzlich bis zum ersten „endstream“ bestimmt; jede
 * dieser Lesarten wird dekodiert und geprüft. Jedes Schlüsselwort „stream“ muss zu einem gelesenen Stream gehören.
 * Rest N-010/N-025: Streams, deren Lesarten sich mit einem anderen Stream-Objekt überschneiden (überlappend bzw.
 * verschachtelt), sind nicht prüfbar – so wird jedes Byte nur in einer festen Zahl von Lesarten dekodiert (linear).
 * Grenzen (Rechenaufwand, Byte-Budget, 100 MB dekodiert, 50 000 Streams, 500 000 Objekte, 4 Werte einer indirekten
 * /Length) führen zu „nicht prüfbar“, nie zur Annahme.
 */
function pdfPruefen(buf) {
  if (!buf.subarray(0, 1024).toString('latin1').includes('%PDF-')) throw new DokumentFehler('Keine PDF-Datei.');
  const text = buf.toString('latin1');
  const budget = neuesBudget(text.length);
  const leser = new Leser(text, budget);
  // 1. alle Objektköpfe in einem Durchlauf (Ziffern, Leerraum, „obj“ – auch mit CR oder ohne Leerzeichen vor „obj“)
  const kopfRe = /(?<![0-9])(\d{1,10})[\0\t\n\f\r ]+(\d{1,5})[\0\t\n\f\r ]*obj(?![A-Za-z0-9])/g;
  const ganzzahlen = new Map(); // „N G“ → Set der Werte (für indirekte /Length; höchstens MAX_LAENGEN + 1 gemerkt)
  const streams = [];
  let objekte = 0, m;
  while ((m = kopfRe.exec(text))) {
    if (++objekte > MAX_OBJEKTE) throw nichtPruefbar();
    const v = leser.objekt(m.index + m[0].length);
    if (!v) continue;
    if (v.typ === 'int') {
      const s = `${Number(m[1])} ${Number(m[2])}`;
      let w = ganzzahlen.get(s);
      if (!w) ganzzahlen.set(s, (w = new Set()));
      if (w.size <= MAX_LAENGEN) w.add(v.wert);
      continue;
    }
    if (v.typ !== 'dict') continue;
    const q = leser.leer(v.ende);
    if (text.startsWith('stream', q) && !istNormal(text.charCodeAt(q + 6))) {
      if (streams.length >= MAX_STREAMS) throw nichtPruefbar();
      streams.push({ kopf: m.index, dict: v, wort: q });
    }
  }
  // Positionen aller „endstream“ (für die erste-endstream-Lesart, ohne quadratische Suche)
  const enden = [];
  for (let i = text.indexOf('endstream'); i >= 0; i = text.indexOf('endstream', i + 9)) enden.push(i);
  const naechstesEnde = (p) => { let lo = 0, hi = enden.length; while (lo < hi) { const mi = (lo + hi) >> 1; if (enden[mi] < p) lo = mi + 1; else hi = mi; } return lo < enden.length ? enden[lo] : -1; };
  const endstreamFolgt = (p) => { let i = p; while (i - p < 256 && istLeer(text.charCodeAt(i))) i++; return text.startsWith('endstream', i); };
  const endeVon = (s) => {
    const e = naechstesEnde(s);
    if (e < 0) return -1;
    let x = e;
    if (text.charCodeAt(x - 1) === 10) { x--; if (text.charCodeAt(x - 1) === 13) x--; } else if (text.charCodeAt(x - 1) === 13) x--;
    return Math.max(s, x);
  };

  // 2. Lesarten aller Streams bestimmen – noch ohne zu dekodieren (Streams liegen nach Kopf-Position geordnet vor).
  //    Fehler werden am Stream vermerkt und erst beim Prüfen in Dateireihenfolge gemeldet (aktive Inhalte davor bleiben
  //    „abgelehnt: …“). Rest N-010/N-025: überlappende bzw. verschachtelte Streams – ein Kopf liegt im Bereich eines
  //    früheren Streams (vom Kopf bis zum Ende seiner weitesten Lesart) – sind nicht prüfbar; der früheste betroffene
  //    Stream wird markiert, die übrigen werden nicht mehr gelesen.
  let weitester = null;
  for (const st of streams) {
    try {
      st.info = streamInfo(st.dict);
      const lv = st.info.k.get('Length');
      const laengen = lv && lv.typ === 'int' ? [lv.wert] : lv && lv.typ === 'ref' ? [...(ganzzahlen.get(lv.wert) || [])] : [];
      if (laengen.length > MAX_LAENGEN) throw nichtPruefbar(); // Rest N-010: je Wert eine Lesart
      const k = st.wort + 6;
      let j = k; while (j - k < 256 && (text.charCodeAt(j) === 32 || text.charCodeAt(j) === 9 || text.charCodeAt(j) === 0 || text.charCodeAt(j) === 12)) j++;
      // Hauptlesart: „stream“ + CRLF/LF/CR (Poppler); mit Leerzeichen vor dem Zeilenende wie pypdf
      const sA = EOL(text, k) ? k + EOL(text, k) : j + EOL(text, j);
      const starts = new Set([sA, k + EOL(text, k), j + EOL(text, j)]);
      if (EOL(text, k) === 2) starts.add(k + 1); // CR allein als Zeilenende
      for (let i = k; i < Math.min(text.length, k + 1024); i++) { const e = EOL(text, i); if (e) { starts.add(i + e); break; } } // pdf.js: bis zur nächsten Zeile
      // Hauptlesart: /Length, wenn danach „endstream“ folgt, sonst bis zum ersten „endstream“
      const nGut = laengen.find((n) => sA + n <= text.length && endstreamFolgt(sA + n));
      const hauptEnde = nGut !== undefined ? sA + nGut : endeVon(sA);
      if (hauptEnde < 0) throw nichtPruefbar();
      const lesarten = new Map([[`${sA}-${hauptEnde}`, [sA, hauptEnde, false]]]);
      for (const s of starts) {
        for (const n of laengen) if (s + n <= text.length) lesarten.set(`${s}-${s + n}`, lesarten.get(`${s}-${s + n}`) || [s, s + n, true]);
        const e = endeVon(s);
        if (e >= 0) lesarten.set(`${s}-${e}`, lesarten.get(`${s}-${e}`) || [s, e, true]);
      }
      st.lesarten = [...lesarten.values()];
      st.ende = Math.max(k, ...st.lesarten.map((x) => x[1]));
    } catch (e) {
      if (!(e instanceof DokumentFehler)) throw e;
      st.fehler = e;
      st.ende = st.wort + 6;
    }
    if (weitester && st.kopf < weitester.ende) { weitester.ueberlappt = true; break; }
    if (!weitester || st.ende > weitester.ende) weitester = st;
  }

  // 3. jeden Stream in allen Lesarten dekodieren und prüfen (in Dateireihenfolge; bei einem vermerkten Fehler Abbruch)
  const datenBereiche = [];
  const woerter = new Set();
  for (const st of streams) {
    if (st.fehler) throw st.fehler;
    if (st.ueberlappt) throw nichtPruefbar();
    woerter.add(st.wort);
    let lo = 0, hi = Infinity;
    for (const [s, e, neben] of st.lesarten) {
      lo = Math.max(lo, s); hi = Math.min(hi, e);
      const x = streamDekodieren(buf.subarray(s, e), st.info, budget, neben);
      if (x) inhaltPruefen(x.toString('latin1'), budget);
    }
    if (hi > lo) datenBereiche.push([lo, hi]);
  }
  // 4. jedes Schlüsselwort „stream“ gehört zu einem gelesenen Stream – sonst gibt es Daten, die ein Leser anders sieht
  const wortRe = /(?<![A-Za-z0-9])stream(?![A-Za-z0-9])/g;
  while ((m = wortRe.exec(text))) if (!woerter.has(m.index)) throw nichtPruefbar();
  // 5. übriger Text roh prüfen – ohne die Stream-Daten (Binärdaten, oben dekodiert geprüft); Objektköpfe mitten in
  //    Stream-Daten (per xref erreichbar) werden ab dem ersten solchen Kopf bis zum Ende der Daten mitgeprüft
  datenBereiche.sort((a, b) => a[0] - b[0]);
  const teile = [];
  let pos = 0;
  for (const [s0, e0] of datenBereiche) {
    if (e0 <= pos) continue;
    const s = Math.max(s0, pos);
    teile.push(text.slice(pos, s));
    // Objekt mitten in den Daten? (auch mit Kommentar im Kopf) – ab kurz vor dem ersten „obj“ bis zum Ende prüfen
    const o = text.indexOf('obj', s);
    if (o >= 0 && o < e0) teile.push(text.slice(Math.max(s, o - 300), e0));
    pos = e0;
  }
  teile.push(text.slice(pos));
  inhaltPruefen(teile.join(' \n'), budget);
  if (!/%%EOF\s*$/.test(text.slice(-1024))) throw new DokumentFehler('PDF ist unvollständig (%%EOF fehlt).');
  return { mime: 'application/pdf', daten: buf };
}

function officePruefen(buf) {
  try { pruefeZip(buf, ZIP_GRENZEN); } catch (e) { throw new DokumentFehler(`Datei abgelehnt: ${e.message}`); }
  const namen = zipNamen(buf);
  if (!namen.includes('[Content_Types].xml')) throw new DokumentFehler('Unbekanntes ZIP-Format (nur DOCX/XLSX).');
  if (namen.some((n) => /vbaProject\.bin$/i.test(n) || /\.bin$/i.test(n) && /vba/i.test(n))) throw new DokumentFehler('Dokumente mit Makros werden nicht angenommen.');
  if (namen.some((n) => n.startsWith('word/'))) return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', daten: buf };
  if (namen.some((n) => n.startsWith('xl/'))) return { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', daten: buf };
  throw new DokumentFehler('Nur Word- (DOCX) oder Excel-Dateien (XLSX).');
}

/**
 * @param {string} base64  Base64 oder data-URL
 * @returns {{mime, daten:Buffer, sha256}}
 */
function dokumentPruefen(base64) {
  if (typeof base64 !== 'string' || !base64.length) throw new DokumentFehler('dateiBase64 fehlt.');
  let b = base64.replace(/^data:[a-z0-9.+/-]{1,100};base64,/i, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b)) throw new DokumentFehler('dateiBase64: ungültige Base64-Daten.');
  if (Math.floor((b.length * 3) / 4) > MAX_BYTES + 3) throw new DokumentFehler('Datei ist zu groß (max. 25 MB).');
  const buf = Buffer.from(b, 'base64');
  if (buf.length > MAX_BYTES) throw new DokumentFehler('Datei ist zu groß (max. 25 MB).');
  let r;
  if (buf.subarray(0, 1024).includes(Buffer.from('%PDF-'))) r = pdfPruefen(buf);
  else if (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50) r = officePruefen(buf);
  else if (Bild.erkenne(buf)) {
    try { const x = Bild.bildPruefen(b); r = { mime: x.mime, daten: x.daten }; } catch (e) { throw new DokumentFehler(e.message); }
  } else throw new DokumentFehler('Nur PDF, JPEG, PNG, WebP, DOCX oder XLSX.');
  return { ...r, sha256: crypto.createHash('sha256').update(r.daten).digest('hex') };
}

module.exports = { pdfPruefen, streamDekodieren, streamInfo, ascii85, asciiHex, praediktor, normalisieren, textDekodieren, NICHT_PRUEFBAR, MAX_STREAMS, MAX_GESAMT, MAX_OBJEKTE, MAX_LAENGEN, MAX_PRUEFBYTES, dokumentPruefen, DokumentFehler, ENDUNG, MAX_BYTES, zipNamen };
