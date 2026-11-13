'use strict';
/**
 * Fotos zu Schadensmeldungen (API.md 11.9): Erkennung an den Magic Bytes, strukturelle Prüfung,
 * Entfernen aller Metadaten (EXIF/GPS/XMP/Kommentare/Textchunks) und Abschneiden angehängter Daten (Polyglot).
 * Speicherung mit Zufallsnamen in einem nicht öffentlichen Ordner.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FOTOS = 5;
const ENDUNG = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

class BildFehler extends Error {}
const fehler = (t) => new BildFehler(t);

function erkenne(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/* ---------- JPEG ---------- */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpegBereinigen(buf) {
  const out = [Buffer.from([0xff, 0xd8])];
  let i = 2, sof = false, sos = false, ende = false;
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw fehler('JPEG-Datei ist beschädigt (Segment erwartet).');
    while (i + 1 < buf.length && buf[i + 1] === 0xff) i++; // Füllbytes
    if (i + 1 >= buf.length) break;
    const m = buf[i + 1];
    i += 2;
    if (m === 0xd9) { out.push(Buffer.from([0xff, 0xd9])); ende = true; break; }
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) { out.push(Buffer.from([0xff, m])); continue; }
    if (m === 0x00 || m === 0xd8) throw fehler('JPEG-Datei ist beschädigt (ungültiger Marker).');
    if (i + 2 > buf.length) throw fehler('JPEG-Datei ist unvollständig.');
    const len = buf.readUInt16BE(i);
    if (len < 2 || i + len > buf.length) throw fehler('JPEG-Datei ist beschädigt (Segmentlänge).');
    const seg = buf.subarray(i - 2, i + len);
    if (m === 0xe0) {
      // nur JFIF behalten, ohne Vorschaubild
      if (len >= 16 && buf.toString('latin1', i + 2, i + 7) === 'JFIF\0') {
        const j = Buffer.alloc(18);
        j[0] = 0xff; j[1] = 0xe0; j.writeUInt16BE(16, 2);
        buf.copy(j, 4, i + 2, i + 14); // 'JFIF\0' + Version + Einheit + Dichte
        j[16] = 0; j[17] = 0;
        out.push(j);
      }
    } else if ((m >= 0xe1 && m <= 0xef) || m === 0xfe) {
      // APP1–APP15 (EXIF, XMP, GPS, ICC, Hersteller) und Kommentare verwerfen
    } else {
      if (SOF.has(m)) {
        if (len < 8) throw fehler('JPEG-Datei ist beschädigt (Bildkopf).');
        const h = buf.readUInt16BE(i + 3), w = buf.readUInt16BE(i + 5);
        if (!h || !w) throw fehler('JPEG-Datei hat keine gültige Bildgröße.');
        sof = true;
      }
      out.push(seg);
    }
    i += len;
    if (m === 0xda) {
      sos = true;
      const start = i;
      while (i < buf.length) {
        if (buf[i] === 0xff && i + 1 < buf.length) {
          const n = buf[i + 1];
          if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) { i += 2; continue; }
          if (n === 0xff) { i += 1; continue; }
          break;
        }
        i++;
      }
      out.push(buf.subarray(start, i));
    }
  }
  if (!ende || !sof || !sos) throw fehler('JPEG-Datei ist unvollständig oder kein Bild.');
  return Buffer.concat(out); // Daten nach dem Bildende (EOI) entfallen
}

/* ---------- PNG ---------- */
const PNG_BEHALTEN = new Set(['IHDR', 'PLTE', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'pHYs', 'IDAT', 'IEND']);

function pngBereinigen(buf) {
  const out = [buf.subarray(0, 8)];
  let i = 8, erster = true, ende = false, idat = false;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const typ = buf.toString('latin1', i + 4, i + 8);
    if (!/^[A-Za-z]{4}$/.test(typ) || len > buf.length || i + 12 + len > buf.length) throw fehler('PNG-Datei ist beschädigt (Chunk).');
    const daten = buf.subarray(i + 4, i + 8 + len);
    if (zlib.crc32(daten) !== buf.readUInt32BE(i + 8 + len)) throw fehler('PNG-Datei ist beschädigt (Prüfsumme).');
    if (erster) {
      if (typ !== 'IHDR' || len !== 13) throw fehler('PNG-Datei ist beschädigt (IHDR fehlt).');
      if (!buf.readUInt32BE(i + 8) || !buf.readUInt32BE(i + 12)) throw fehler('PNG-Datei hat keine gültige Bildgröße.');
      erster = false;
    }
    if (PNG_BEHALTEN.has(typ)) out.push(buf.subarray(i, i + 12 + len));
    else if (typ[0] === typ[0].toUpperCase()) throw fehler(`PNG-Datei enthält einen unbekannten kritischen Abschnitt (${typ}).`);
    if (typ === 'IDAT') idat = true;
    i += 12 + len;
    if (typ === 'IEND') { ende = true; break; }
  }
  if (!ende || !idat) throw fehler('PNG-Datei ist unvollständig.');
  return Buffer.concat(out); // Daten nach IEND entfallen
}

/* ---------- WebP ---------- */
const WEBP_BEHALTEN = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);

function webpBereinigen(buf) {
  const riff = buf.readUInt32LE(4);
  const ende = 8 + riff;
  if (riff < 4 || ende > buf.length) throw fehler('WebP-Datei ist beschädigt (Länge).');
  const teile = [];
  let i = 12, bild = false;
  while (i + 8 <= ende) {
    const typ = buf.toString('latin1', i, i + 4);
    const len = buf.readUInt32LE(i + 4);
    const voll = 8 + len + (len % 2);
    if (i + 8 + len > ende) throw fehler('WebP-Datei ist beschädigt (Chunk).');
    if (WEBP_BEHALTEN.has(typ)) {
      let c = Buffer.from(buf.subarray(i, Math.min(i + voll, ende)));
      if (c.length < voll) c = Buffer.concat([c, Buffer.alloc(voll - c.length)]);
      if (typ === 'VP8X') { if (len < 10) throw fehler('WebP-Datei ist beschädigt (VP8X).'); c[8] &= ~0x0c; } // EXIF-/XMP-Kennzeichen löschen
      if (typ === 'VP8 ' || typ === 'VP8L' || typ === 'ANMF') bild = true;
      teile.push(c);
    }
    i += voll;
  }
  if (!bild) throw fehler('WebP-Datei enthält kein Bild.');
  const inhalt = Buffer.concat(teile);
  const kopf = Buffer.alloc(12);
  kopf.write('RIFF', 0, 'latin1'); kopf.writeUInt32LE(inhalt.length + 4, 4); kopf.write('WEBP', 8, 'latin1');
  return Buffer.concat([kopf, inhalt]);
}

/**
 * Prüft und bereinigt ein Bild.
 * @param {string} base64  Base64 oder data-URL
 * @returns {{mime, daten: Buffer, sha256}}
 */
function bildPruefen(base64) {
  if (typeof base64 !== 'string' || !base64.length) throw fehler('bildBase64 fehlt.');
  let b = base64;
  const m = /^data:[a-z0-9.+/-]{1,60};base64,/i.exec(b);
  if (m) b = b.slice(m[0].length);
  b = b.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b)) throw fehler('bildBase64: ungültige Base64-Daten.');
  if (Math.floor((b.length * 3) / 4) - (b.endsWith('==') ? 2 : b.endsWith('=') ? 1 : 0) > MAX_BYTES) throw fehler('Foto ist zu groß (max. 8 MB).');
  const buf = Buffer.from(b, 'base64');
  if (buf.length > MAX_BYTES) throw fehler('Foto ist zu groß (max. 8 MB).');
  const mime = erkenne(buf);
  if (!mime) throw fehler('Nur Fotos im Format JPEG, PNG oder WebP sind erlaubt.');
  const daten = mime === 'image/jpeg' ? jpegBereinigen(buf) : mime === 'image/png' ? pngBereinigen(buf) : webpBereinigen(buf);
  return { mime, daten, sha256: crypto.createHash('sha256').update(daten).digest('hex') };
}

/** Dateiname für die Anzeige (ohne Pfadbestandteile/Steuerzeichen) */
function sichererName(name, mime) {
  let n = typeof name === 'string' ? name : '';
  n = n.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').replace(/^\.+/, '').trim().slice(0, 120);
  if (!n) n = `foto.${ENDUNG[mime]}`;
  return n;
}

function uploadOrdner(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Speichert die bereinigten Daten unter einem Zufallsnamen → Dateiname (ohne Pfad) */
function speichere(dir, mime, daten) {
  uploadOrdner(dir);
  const datei = `${crypto.randomBytes(16).toString('hex')}.${ENDUNG[mime]}`;
  fs.writeFileSync(path.join(dir, datei), daten, { flag: 'wx', mode: 0o600 });
  return datei;
}

/** Pfad einer gespeicherten Datei – nur Zufallsnamen aus der Datenbank, nie Pfadangaben */
function dateiPfad(dir, datei) {
  if (!/^[0-9a-f]{32}\.(jpg|png|webp)$/.test(datei)) throw fehler('Ungültiger Dateiname.');
  const p = path.resolve(dir, datei);
  if (path.dirname(p) !== path.resolve(dir)) throw fehler('Ungültiger Dateiname.');
  return p;
}

module.exports = { MAX_BYTES, MAX_FOTOS, ENDUNG, BildFehler, erkenne, bildPruefen, jpegBereinigen, pngBereinigen, webpBereinigen, sichererName, speichere, dateiPfad, uploadOrdner };
