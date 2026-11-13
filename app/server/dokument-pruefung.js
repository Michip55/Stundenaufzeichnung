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
const PDF_VERBOTEN = [/\/Encrypt\b/, /\/JavaScript\b/, /\/JS\b/, /\/Launch\b/, /\/EmbeddedFile\b/, /\/RichMedia\b/];
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

/** PDF-Namen normalisieren: #xx-Escapes, Kommentare, Leerraum (G-08) */
function normalisieren(t) {
  return t.replace(/%[^\r\n]*/g, ' ').replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/[\0\t\f\r\n ]+/g, ' ');
}

function asciiHex(b) {
  const t = b.toString('latin1');
  const e = t.indexOf('>');
  let h = (e >= 0 ? t.slice(0, e) : t).replace(/\s+/g, '');
  if (!/^[0-9a-fA-F]*$/.test(h)) throw new Error('ASCIIHex ungültig');
  if (h.length % 2) h += '0';
  return Buffer.from(h, 'hex');
}

function ascii85(b) {
  let t = b.toString('latin1').replace(/\s+/g, '');
  if (t.startsWith('<~')) t = t.slice(2);
  const e = t.indexOf('~>');
  if (e >= 0) t = t.slice(0, e);
  const out = [];
  let gruppe = [];
  const block = (g, n) => {
    let v = 0;
    for (const c of g) v = v * 85 + (c - 33);
    const by = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    out.push(...by.slice(0, n));
  };
  for (const ch of t) {
    if (ch === 'z' && !gruppe.length) { out.push(0, 0, 0, 0); continue; }
    const c = ch.charCodeAt(0);
    if (c < 33 || c > 117) throw new Error('ASCII85 ungültig');
    gruppe.push(c);
    if (gruppe.length === 5) { block(gruppe, 4); gruppe = []; }
    if (out.length > MAX_STREAM) throw new Error('zu groß');
  }
  if (gruppe.length === 1) throw new Error('ASCII85 ungültig');
  if (gruppe.length) { const n = gruppe.length - 1; while (gruppe.length < 5) gruppe.push(117); block(gruppe, n); }
  return Buffer.from(out);
}

/**
 * Stream gemäß /Filter dekodieren → Buffer zum Prüfen, oder null (Bilddaten, nicht zu prüfen).
 * Nicht prüfbare Filter (LZW, RunLength, Crypt, unbekannt) außerhalb von Bildern → DokumentFehler.
 */
function streamDekodieren(roh, dict) {
  const istBild = /\/Subtype ?\/Image\b/.test(dict);
  let filter = [];
  const fm = /\/Filter ?(\[([^\]]*)\]|\/([A-Za-z0-9]+)|[^/\[]\S*)/.exec(dict);
  if (fm) {
    if (fm[3]) filter = [fm[3]];
    else if (fm[2] !== undefined) filter = [...fm[2].matchAll(/\/([A-Za-z0-9]+)/g)].map((x) => x[1]);
    else if (!istBild) throw new DokumentFehler(NICHT_PRUEFBAR); // z. B. /Filter 5 0 R
    else return null;
  }
  let d = roh;
  for (const f0 of filter) {
    const f = KURZ[f0] || f0;
    if (BILD_FILTER.has(f)) return null; // Bilddaten
    try {
      if (f === 'FlateDecode') {
        const o = { maxOutputLength: MAX_STREAM, finishFlush: zlib.constants.Z_SYNC_FLUSH };
        try { d = zlib.inflateSync(d, o); } catch (e) { if (e && e.code === 'ERR_BUFFER_TOO_LARGE') throw e; d = zlib.inflateRawSync(d, o); } // manche Erzeuger ohne zlib-Kopf
      }
      else if (f === 'ASCIIHexDecode') d = asciiHex(d);
      else if (f === 'ASCII85Decode') d = ascii85(d);
      else if (istBild) return null; // LZW/RunLength bei Bildern: Pixeldaten, keine aktiven Inhalte
      else throw new DokumentFehler(NICHT_PRUEFBAR);
    } catch (e) {
      if (e instanceof DokumentFehler) throw e;
      if (istBild) return null;
      throw new DokumentFehler(NICHT_PRUEFBAR);
    }
  }
  return d;
}

function pdfPruefen(buf) {
  if (!buf.subarray(0, 1024).toString('latin1').includes('%PDF-')) throw new DokumentFehler('Keine PDF-Datei.');
  const text = buf.toString('latin1');
  const pruefe = (t) => {
    // G-08: Namen normalisieren (#xx-Escapes wie /J#61vaScript, Kommentare und Leerraum als Trenner) – roh UND normalisiert prüfen
    const n = normalisieren(t);
    for (const x of [t, n]) for (const re of PDF_VERBOTEN) if (re.test(x)) throw new DokumentFehler(`PDF abgelehnt: ${re.source.replace(/\\\//g, '/').replace('\\b', '')} (verschlüsselt oder aktive Inhalte).`);
  };
  pruefe(text);
  // G-08: alle Streams nach ihren Filtern dekodieren und prüfen (auch Ketten wie [/ASCII85Decode /FlateDecode])
  let gesamt = 0;
  const re = /(?<!end)stream\r?\n/g;
  let m;
  while ((m = re.exec(text)) && gesamt < 100 * 1024 * 1024) {
    const start = m.index + m[0].length;
    const ende = text.indexOf('endstream', start);
    if (ende < 0) break;
    const objStart = Math.max(text.lastIndexOf(' obj', m.index), text.lastIndexOf('\nobj', m.index), text.lastIndexOf('obj<<', m.index));
    const dict = normalisieren(text.slice(objStart >= 0 ? objStart : Math.max(0, m.index - 4096), m.index));
    const x = streamDekodieren(buf.subarray(start, ende), dict);
    if (x) { gesamt += x.length; pruefe(x.toString('latin1')); }
    re.lastIndex = ende;
  }
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

module.exports = { pdfPruefen, streamDekodieren, ascii85, asciiHex, NICHT_PRUEFBAR, dokumentPruefen, DokumentFehler, ENDUNG, MAX_BYTES, zipNamen };
