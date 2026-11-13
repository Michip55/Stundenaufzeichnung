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

function pdfPruefen(buf) {
  if (!buf.subarray(0, 1024).toString('latin1').includes('%PDF-')) throw new DokumentFehler('Keine PDF-Datei.');
  const text = buf.toString('latin1');
  const pruefe = (t) => { for (const re of PDF_VERBOTEN) if (re.test(t)) throw new DokumentFehler(`PDF abgelehnt: ${re.source.replace(/\\\//g, '/').replace('\\b', '')} (verschlüsselt oder aktive Inhalte).`); };
  pruefe(text);
  // komprimierte Objekt-Streams durchsuchen (begrenzt)
  let gesamt = 0;
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(text)) && gesamt < 100 * 1024 * 1024) {
    const start = m.index + m[0].length;
    const ende = text.indexOf('endstream', start);
    if (ende < 0) break;
    const roh = buf.subarray(start, ende);
    try {
      const x = zlib.inflateSync(roh, { maxOutputLength: 20 * 1024 * 1024 });
      gesamt += x.length;
      pruefe(x.toString('latin1'));
    } catch (e) {
      if (e instanceof DokumentFehler) throw e;
      /* nicht Flate oder abgeschnitten: übergehen */
    }
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

module.exports = { dokumentPruefen, DokumentFehler, ENDUNG, MAX_BYTES, zipNamen };
