'use strict';
/**
 * Verschlüsselung von Geheimnissen in der Datenbank (AES-256-GCM) mit dem Schlüssel aus BAUTAG_SCHLUESSEL
 * (API.md 12.1). Ohne Schlüssel: `verschluesseln(…, {pflicht:true})` wirft; sonst wird mit „klar:“ gespeichert.
 */
const crypto = require('node:crypto');

function schluessel(bt) {
  const roh = (bt && bt.schluessel) || process.env.BAUTAG_SCHLUESSEL || '';
  return roh && roh.length >= 16 ? crypto.createHash('sha256').update(`bautag:${roh}`).digest() : null;
}

function verschluesseln(bt, text, { pflicht = false } = {}) {
  const k = schluessel(bt);
  if (!k) {
    if (pflicht) { const e = new Error('BAUTAG_SCHLUESSEL fehlt'); e.code = 'KEIN_SCHLUESSEL'; throw e; }
    return `klar:${text}`;
  }
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const daten = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `v1:${Buffer.concat([iv, c.getAuthTag(), daten]).toString('base64')}`;
}

function entschluesseln(bt, wert) {
  if (wert == null) return null;
  if (wert.startsWith('klar:')) return wert.slice(5);
  if (!wert.startsWith('v1:')) return null;
  const k = schluessel(bt);
  if (!k) return null;
  try {
    const b = Buffer.from(wert.slice(3), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', k, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch (_) {
    return null; // falscher Schlüssel
  }
}

module.exports = { verschluesseln, entschluesseln, schluesselVorhanden: (bt) => Boolean(schluessel(bt)) };
