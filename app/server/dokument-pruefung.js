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

/**
 * Verbotene Namen (API.md 12.16, 14.4): verschlüsselt, Skripte, Start externer Programme, eingebettete Dateien
 * (auch /EmbeddedFiles, /EF, Anhang-Anmerkungen), RichMedia, XFA-Formulare, Formular senden/importieren,
 * Sprünge in fremde Dateien (/GoToR, /GoToE), Skripte in 3D-Inhalten.
 */
const PDF_VERBOTEN = /\/(Encrypt\b|JavaScript\b|JS\b|Launch\b|EmbeddedFile|EF\b|FileAttachment\b|RichMedia|XFA\b|SubmitForm\b|ImportData\b|GoToR\b|GoToE\b|OnInstantiate\b)/;
/** Link-Ziele (/URI): nur http(s), mailto, tel oder ohne Schema; nie javascript:, file:, UNC-Pfade … */
const URI_SCHEMATA = new Set(['http', 'https', 'mailto', 'tel']);

/** PDF-Namen normalisieren: #xx-Escapes, Kommentare, Leerraum (G-08) */
function normalisieren(t) {
  return t.replace(/%[^\r\n]*/g, ' ').replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/[\0\t\f\r\n ]+/g, ' ');
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

/** Budget gegen Rechenzeit- und Speicher-Angriffe (N-010, N-025, N-026) */
function neuesBudget(laenge) {
  let arbeit = 0, gesamt = 0;
  const grenzeArbeit = 4 * laenge + 1024 * 1024;
  return {
    arbeit(n) { arbeit += n; if (arbeit > grenzeArbeit) throw new DokumentFehler(NICHT_PRUEFBAR); },
    verbrauche(n) { gesamt += n; if (gesamt > MAX_GESAMT) throw new DokumentFehler(NICHT_PRUEFBAR); }
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

/** Literal- bzw. Hex-String eines PDF dekodieren (für /URI) */
function textDekodieren(v) {
  if (v.typ === 'hex') return Buffer.from(v.wert.replace(/[^0-9a-fA-F]/g, '').replace(/^((?:..)*).$/, '$10'), 'hex').toString('latin1');
  return v.wert.replace(/\\(?:([0-7]{1,3})|(\r\n|\r|\n)|(.))/gs, (_, okt, zeile, z) => {
    if (okt) return String.fromCharCode(parseInt(okt, 8) & 255);
    if (zeile) return '';
    return { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[z] ?? z;
  });
}

function uriPruefen(t, budget) {
  const re = /\/URI(?![^\0\t\n\f\r ()<>[\]{}/%])/g;
  const l = new Leser(t, budget);
  let m;
  while ((m = re.exec(t))) {
    const v = l.objekt(m.index + m[0].length);
    // Wert eines Schlüssels /URI: Text prüfen; Verweis nicht prüfbar → ablehnen. /URI als Wert (/S /URI), als Dict
    // (/URI << /Base … >> im Katalog) oder ohne lesbaren Wert ist kein Link-Ziel.
    if (v && v.typ === 'ref') throw new DokumentFehler('PDF abgelehnt: /URI (Link-Ziel nicht prüfbar; aktive Inhalte).');
    if (!v || (v.typ !== 'text' && v.typ !== 'hex')) continue;
    const ziel = textDekodieren(v).replace(/[\0-\x20\x7f]+/g, '');
    const schema = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(ziel);
    if (/^[\\/]{2}/.test(ziel) && !/^\/\/[^\\/]/.test(ziel) || ziel.startsWith('\\') || (schema && !URI_SCHEMATA.has(schema[1].toLowerCase()))) {
      throw new DokumentFehler(`PDF abgelehnt: /URI ${schema ? `${schema[1].toLowerCase()}:` : 'mit Dateipfad'} (aktive Inhalte).`);
    }
  }
}

/** Text auf verbotene Namen prüfen – roh und normalisiert (G-08: #xx-Escapes, Kommentare, Leerraum) */
function inhaltPruefen(t, budget) {
  for (const x of [t, normalisieren(t)]) {
    const m = PDF_VERBOTEN.exec(x);
    if (m) throw new DokumentFehler(`PDF abgelehnt: /${m[1].replace('\\b', '')} (verschlüsselt oder aktive Inhalte).`);
    uriPruefen(x, budget);
  }
}

const EOL = (t, p) => (t.charCodeAt(p) === 13 ? (t.charCodeAt(p + 1) === 10 ? 2 : 1) : t.charCodeAt(p) === 10 ? 1 : 0);

/**
 * PDF prüfen (API.md 12.16, 14.4). Alle Objektköpfe „N G obj“ werden gefunden (auch mit CR, Kommentaren, ohne
 * Leerzeichen vor „obj“), Stream-Dictionaries mit einem kleinen Leser ausgewertet (nur die oberste Ebene),
 * Stream-Grenzen über /Length und – falls Leser anders lesen – zusätzlich bis zum ersten „endstream“ bestimmt; jede
 * dieser Lesarten wird dekodiert und geprüft. Jedes Schlüsselwort „stream“ muss zu einem gelesenen Stream gehören.
 * Grenzen (Rechenaufwand, 100 MB dekodiert, 50 000 Streams) führen zu „nicht prüfbar“, nie zur Annahme.
 */
function pdfPruefen(buf) {
  if (!buf.subarray(0, 1024).toString('latin1').includes('%PDF-')) throw new DokumentFehler('Keine PDF-Datei.');
  const text = buf.toString('latin1');
  const budget = neuesBudget(text.length);
  const leser = new Leser(text, budget);
  // 1. alle Objektköpfe (Ziffern, Leerraum, „obj“ – auch mit CR oder ohne Leerzeichen vor „obj“)
  const kopfRe = /(?<![0-9])(\d{1,10})[\0\t\n\f\r ]+(\d{1,5})[\0\t\n\f\r ]*obj(?![A-Za-z0-9])/g;
  const ganzzahlen = new Map(); // „N G“ → [Werte] für indirekte /Length
  const streams = [];
  let m;
  while ((m = kopfRe.exec(text))) {
    const v = leser.objekt(m.index + m[0].length);
    if (!v) continue;
    if (v.typ === 'int') { const s = `${Number(m[1])} ${Number(m[2])}`; ganzzahlen.set(s, [...(ganzzahlen.get(s) || []), v.wert]); continue; }
    if (v.typ !== 'dict') continue;
    const q = leser.leer(v.ende);
    if (text.startsWith('stream', q) && !istNormal(text.charCodeAt(q + 6))) {
      if (streams.length >= MAX_STREAMS) throw new DokumentFehler(NICHT_PRUEFBAR);
      streams.push({ dict: v, wort: q });
    }
  }
  // Positionen aller „endstream“ (für die erste-endstream-Lesart, ohne quadratische Suche)
  const enden = [];
  for (let i = text.indexOf('endstream'); i >= 0; i = text.indexOf('endstream', i + 9)) enden.push(i);
  const naechstesEnde = (p) => { let lo = 0, hi = enden.length; while (lo < hi) { const mi = (lo + hi) >> 1; if (enden[mi] < p) lo = mi + 1; else hi = mi; } return lo < enden.length ? enden[lo] : -1; };
  const endstreamFolgt = (p) => { let i = p; while (i - p < 256 && istLeer(text.charCodeAt(i))) i++; return text.startsWith('endstream', i); };

  // 2. jeden Stream in allen Lesarten dekodieren und prüfen
  const datenBereiche = [];
  const woerter = new Set();
  for (const st of streams) {
    woerter.add(st.wort);
    const info = streamInfo(st.dict);
    const lv = info.k.get('Length');
    const laengen = lv && lv.typ === 'int' ? [lv.wert] : lv && lv.typ === 'ref' ? (ganzzahlen.get(lv.wert) || []) : [];
    const k = st.wort + 6;
    let j = k; while (j - k < 256 && (text.charCodeAt(j) === 32 || text.charCodeAt(j) === 9 || text.charCodeAt(j) === 0 || text.charCodeAt(j) === 12)) j++;
    // Hauptlesart: „stream“ + CRLF/LF/CR (Poppler); mit Leerzeichen vor dem Zeilenende wie pypdf
    const sA = EOL(text, k) ? k + EOL(text, k) : j + EOL(text, j);
    const starts = new Set([sA, k + EOL(text, k), j + EOL(text, j)]);
    if (EOL(text, k) === 2) starts.add(k + 1); // CR allein als Zeilenende
    for (let i = k; i < Math.min(text.length, k + 1024); i++) { const e = EOL(text, i); if (e) { starts.add(i + e); break; } } // pdf.js: bis zur nächsten Zeile
    const endeVon = (s) => {
      const e = naechstesEnde(s);
      if (e < 0) return -1;
      let x = e;
      if (text.charCodeAt(x - 1) === 10) { x--; if (text.charCodeAt(x - 1) === 13) x--; } else if (text.charCodeAt(x - 1) === 13) x--;
      return Math.max(s, x);
    };
    // Hauptlesart: /Length, wenn danach „endstream“ folgt, sonst bis zum ersten „endstream“
    const nGut = laengen.find((n) => sA + n <= text.length && endstreamFolgt(sA + n));
    const hauptEnde = nGut !== undefined ? sA + nGut : endeVon(sA);
    if (hauptEnde < 0) throw new DokumentFehler(NICHT_PRUEFBAR);
    const lesarten = new Map([[`${sA}-${hauptEnde}`, [sA, hauptEnde, false]]]);
    for (const s of starts) {
      for (const n of laengen) if (s + n <= text.length) lesarten.set(`${s}-${s + n}`, lesarten.get(`${s}-${s + n}`) || [s, s + n, true]);
      const e = endeVon(s);
      if (e >= 0) lesarten.set(`${s}-${e}`, lesarten.get(`${s}-${e}`) || [s, e, true]);
    }
    let lo = 0, hi = Infinity;
    for (const [s, e, neben] of lesarten.values()) {
      lo = Math.max(lo, s); hi = Math.min(hi, e);
      const x = streamDekodieren(buf.subarray(s, e), info, budget, neben);
      if (x) inhaltPruefen(x.toString('latin1'), budget);
    }
    if (hi > lo) datenBereiche.push([lo, hi]);
  }
  // 3. jedes Schlüsselwort „stream“ gehört zu einem gelesenen Stream – sonst gibt es Daten, die ein Leser anders sieht
  const wortRe = /(?<![A-Za-z0-9])stream(?![A-Za-z0-9])/g;
  while ((m = wortRe.exec(text))) if (!woerter.has(m.index)) throw new DokumentFehler(NICHT_PRUEFBAR);
  // 4. übriger Text roh prüfen – ohne die Stream-Daten (Binärdaten, oben dekodiert geprüft); Objektköpfe mitten in
  //    Stream-Daten (per xref erreichbar) werden ab dem ersten solchen Kopf bis zum Ende der Daten mitgeprüft
  datenBereiche.sort((a, b) => a[0] - b[0]);
  const teile = [];
  let pos = 0, ki = 0;
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

module.exports = { pdfPruefen, streamDekodieren, streamInfo, ascii85, asciiHex, praediktor, NICHT_PRUEFBAR, MAX_STREAMS, MAX_GESAMT, dokumentPruefen, DokumentFehler, ENDUNG, MAX_BYTES, zipNamen };
