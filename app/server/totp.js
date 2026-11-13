'use strict';
/** TOTP nach RFC 6238 (SHA-1, 6 Ziffern, 30 s) und Base32 (RFC 4648) – API.md 12.7 */
const crypto = require('node:crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32(buf) {
  let bits = 0, wert = 0, out = '';
  for (const b of buf) {
    wert = (wert << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHABET[(wert >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(wert << (5 - bits)) & 31];
  return out;
}

function base32Dekodieren(s) {
  const t = String(s).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, wert = 0;
  const out = [];
  for (const ch of t) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Ungültiges Base32');
    wert = (wert << 5) | i; bits += 5;
    if (bits >= 8) { out.push((wert >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** HOTP (RFC 4226) */
function hotp(geheimnis, zaehler, stellen = 6) {
  const z = Buffer.alloc(8);
  z.writeBigUInt64BE(BigInt(zaehler));
  const h = crypto.createHmac('sha1', geheimnis).update(z).digest();
  const o = h[h.length - 1] & 0x0f;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** stellen).padStart(stellen, '0');
}

const schritt = (zeit = Date.now()) => Math.floor(zeit / 1000 / 30);

function totp(geheimnis, zeit = Date.now()) { return hotp(geheimnis, schritt(zeit)); }

/**
 * Prüft einen Code mit Toleranz ±1 Schritt; liefert den verwendeten Schritt oder null.
 * `letzter` = zuletzt verwendeter Schritt (ein Code gilt nur einmal).
 */
function pruefe(geheimnis, code, zeit = Date.now(), letzter = null) {
  if (!/^\d{6}$/.test(String(code))) return null;
  const s = schritt(zeit);
  for (const d of [0, -1, 1]) {
    const x = s + d;
    if (letzter != null && x <= letzter) continue;
    const erwartet = hotp(geheimnis, x);
    if (crypto.timingSafeEqual(Buffer.from(erwartet), Buffer.from(String(code)))) return x;
  }
  return null;
}

function neuesGeheimnis() { return base32(crypto.randomBytes(20)); }

function otpauthUri({ geheimnis, konto, aussteller = 'BauTag' }) {
  const label = encodeURIComponent(`${aussteller}:${konto}`);
  return `otpauth://totp/${label}?secret=${geheimnis}&issuer=${encodeURIComponent(aussteller)}&algorithm=SHA1&digits=6&period=30`;
}

/** 10 Wiederherstellungscodes „xxxx-xxxx“ (Base32, ~40 Bit) */
function wiederherstellungscodes(n = 10) {
  return Array.from({ length: n }, () => {
    const s = base32(crypto.randomBytes(5)).toLowerCase();
    return `${s.slice(0, 4)}-${s.slice(4, 8)}`;
  });
}

function codeHash(code, salz) {
  return crypto.createHash('sha256').update(`${salz}:${String(code).toLowerCase().replace(/[^a-z2-7]/g, '')}`).digest('hex');
}

module.exports = { base32, base32Dekodieren, hotp, totp, pruefe, schritt, neuesGeheimnis, otpauthUri, wiederherstellungscodes, codeHash };
