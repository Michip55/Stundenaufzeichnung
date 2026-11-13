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

/** Produktion (G-11): Schlüssel mindestens 32 Zeichen */
const MIN_PRODUKTION = 32;
const schluesselGueltig = (roh) => typeof roh === 'string' && roh.length >= MIN_PRODUKTION;

/** Lesbarkeit eines gespeicherten Werts: 'klar' | 'ok' | 'unlesbar' | 'leer' */
function zustand(bt, wert) {
  if (wert == null || wert === '') return 'leer';
  if (wert.startsWith('klar:')) return 'klar';
  return entschluesseln(bt, wert) == null ? 'unlesbar' : 'ok';
}

/**
 * Beim Start (G-11): „klar:“-Geheimnisse (TOTP, VAPID, SMTP, KI) mit dem Schlüssel nachverschlüsseln und
 * unlesbare (falscher/neuer Schlüssel) melden. → {nachverschluesselt, unlesbar:{zweiFaktor, vapid, smtp, ki}}
 */
function geheimnisseAbgleichen(bt) {
  const { db } = bt;
  const out = { nachverschluesselt: 0, unlesbar: { zweiFaktor: 0, vapid: false, smtp: false, ki: false } };
  const mitSchluessel = Boolean(schluessel(bt));
  const neu = (w) => verschluesseln(bt, w.slice(5));
  db.transaktion(() => {
    for (const z of db.alle('SELECT benutzer_id, geheimnis FROM benutzer_2fa')) {
      const st = zustand(bt, z.geheimnis);
      if (st === 'klar' && mitSchluessel) { db.lauf('UPDATE benutzer_2fa SET geheimnis = ? WHERE benutzer_id = ?', neu(z.geheimnis), z.benutzer_id); out.nachverschluesselt++; }
      if (st === 'unlesbar') out.unlesbar.zweiFaktor++;
    }
    for (const [name, feld, merker] of [['vapid', 'privateKey', 'vapid'], ['email', 'passwort', 'smtp'], ['ki', 'apiKey', 'ki']]) {
      const e = db.einstellung(name, null);
      if (!e || !e[feld]) continue;
      const st = zustand(bt, e[feld]);
      if (st === 'klar' && mitSchluessel) { db.setzeEinstellung(name, { ...e, [feld]: neu(e[feld]) }); out.nachverschluesselt++; }
      if (st === 'unlesbar') out.unlesbar[merker] = true;
    }
  });
  return out;
}

module.exports = { verschluesseln, entschluesseln, zustand, geheimnisseAbgleichen, schluesselGueltig, MIN_PRODUKTION, schluesselVorhanden: (bt) => Boolean(schluessel(bt)) };
