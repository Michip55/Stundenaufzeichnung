'use strict';
/** Minimaler PNG-Encoder (Graustufen) – erzeugt Demo-Unterschriften für Testdaten und Tests. */
const zlib = require('node:zlib');

let TABELLE = null;
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  if (!TABELLE) {
    TABELLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABELLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = TABELLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(typ, daten) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(daten.length);
  const td = Buffer.concat([Buffer.from(typ, 'ascii'), daten]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** @param {number} w @param {number} h @param {Uint8Array} grau  w*h Werte 0..255 */
function pngGrau(w, h, grau) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const roh = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    roh[y * (w + 1)] = 0;
    for (let x = 0; x < w; x++) roh[y * (w + 1) + 1 + x] = grau[y * w + x];
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(roh)), chunk('IEND', Buffer.alloc(0))
  ]);
}

function zufall(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/** Demo-Unterschrift (Schnörkel) als data-URL */
function demoUnterschrift(text, w = 240, h = 80) {
  const r = zufall(hash(String(text)));
  const px = new Uint8Array(w * h).fill(255);
  const a = 6 + r() * 5, b = 9 + r() * 6, ph = r() * 6;
  let vorher = null;
  const punkt = (x, y) => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const xx = Math.round(x + dx), yy = Math.round(y + dy);
      if (xx >= 0 && xx < w && yy >= 0 && yy < h) px[yy * w + xx] = 20;
    }
  };
  for (let i = 0; i <= 300; i++) {
    const t = i / 300;
    const x = (0.08 + t * 0.84 + 0.04 * Math.sin(a * 2.3 * t + ph)) * w;
    const y = (0.5 + (0.3 - 0.16 * t) * Math.sin(b * t + ph) * Math.cos(a * 0.6 * t)) * h;
    if (vorher) {
      const n = Math.ceil(Math.hypot(x - vorher[0], y - vorher[1]));
      for (let k = 0; k <= n; k++) punkt(vorher[0] + ((x - vorher[0]) * k) / Math.max(1, n), vorher[1] + ((y - vorher[1]) * k) / Math.max(1, n));
    }
    vorher = [x, y];
  }
  return 'data:image/png;base64,' + pngGrau(w, h, px).toString('base64');
}

module.exports = { pngGrau, demoUnterschrift, crc32, zufall, hash };
