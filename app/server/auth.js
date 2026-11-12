'use strict';
/**
 * Anmeldung: PIN-Hash (scrypt + Salt, timingSafeEqual), Sitzungen in der Tabelle `sitzung`
 * (nur SHA-256 des Tokens gespeichert), Cookie bt_session (HttpOnly, SameSite=Strict, Secure bei HTTPS),
 * Ablauf nach 12 h Inaktivität, Sperre nach 5 Fehlversuchen für 5 Minuten.
 */
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { ApiFehler, nichtAngemeldet } = require('./fehler');
const { kontext } = require('./rechte');

const scryptAsync = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
const COOKIE = 'bt_session';
const INAKTIV_MS = 12 * 60 * 60 * 1000;
const MAX_FEHLVERSUCHE = 5;
const SPERRE_MS = 5 * 60 * 1000;
const IP_MAX_FEHLVERSUCHE = 30;

function hashPinSync(pin) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pin), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${h.toString('base64')}`;
}

async function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const h = await scryptAsync(String(pin), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${h.toString('base64')}`;
}

const DUMMY_HASH = hashPinSync('dummy-pin-zum-zeitausgleich');

async function pruefePin(pin, gespeichert) {
  const teile = String(gespeichert || '').split('$');
  if (teile.length !== 6 || teile[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = teile;
  const soll = Buffer.from(hashB64, 'base64');
  const ist = await scryptAsync(String(pin), Buffer.from(saltB64, 'base64'), soll.length, { N: +N, r: +r, p: +p });
  return ist.length === soll.length && crypto.timingSafeEqual(ist, soll);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function neueSitzung(db, benutzerId, jetzt) {
  const token = crypto.randomBytes(32).toString('hex');
  const t = jetzt.toISOString();
  db.lauf('INSERT INTO sitzung (token_hash, benutzer_id, erstellt, letzte_aktivitaet) VALUES (?, ?, ?, ?)', sha256(token), benutzerId, t, t);
  return token;
}

function beendeSitzung(db, token) {
  if (token) db.lauf('DELETE FROM sitzung WHERE token_hash = ?', sha256(token));
}

function beendeAlleSitzungen(db, benutzerId) {
  db.lauf('DELETE FROM sitzung WHERE benutzer_id = ?', benutzerId);
}

function leseCookies(header) {
  const o = {};
  if (!header) return o;
  for (const teil of header.split(';')) {
    const i = teil.indexOf('=');
    if (i < 0) continue;
    const k = teil.slice(0, i).trim();
    const v = teil.slice(i + 1).trim();
    if (k && !(k in o)) {
      try { o[k] = decodeURIComponent(v); } catch (_) { o[k] = v; }
    }
  }
  return o;
}

function istHttps(req) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

function setzeCookie(req, res, token) {
  const teile = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (istHttps(req)) teile.push('Secure');
  res.setHeader('Set-Cookie', teile.join('; '));
}

function loescheCookie(req, res) {
  const teile = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (istHttps(req)) teile.push('Secure');
  res.setHeader('Set-Cookie', teile.join('; '));
}

/**
 * Lädt Benutzer zur Sitzung (oder null). Aktualisiert die letzte Aktivität.
 */
function ladeSitzung(db, token, jetzt) {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const h = sha256(token);
  const s = db.eins('SELECT s.token_hash, s.letzte_aktivitaet, b.* FROM sitzung s JOIN benutzer b ON b.id = s.benutzer_id WHERE s.token_hash = ?', h);
  if (!s) return null;
  if (!s.aktiv || jetzt.getTime() - new Date(s.letzte_aktivitaet).getTime() > INAKTIV_MS) {
    db.lauf('DELETE FROM sitzung WHERE token_hash = ?', h);
    return null;
  }
  if (jetzt.getTime() - new Date(s.letzte_aktivitaet).getTime() > 60 * 1000) {
    db.lauf('UPDATE sitzung SET letzte_aktivitaet = ? WHERE token_hash = ?', jetzt.toISOString(), h);
  }
  const { token_hash, letzte_aktivitaet, pin_hash, ...benutzer } = s; // eslint-disable-line no-unused-vars
  return benutzer;
}

/** Middleware: setzt req.ctx (Benutzer + Rechte) falls angemeldet */
function sitzungMiddleware(bt) {
  return (req, res, next) => {
    const token = leseCookies(req.headers.cookie)[COOKIE];
    const benutzer = ladeSitzung(bt.db, token, bt.uhr());
    req.token = token;
    req.ctx = benutzer ? kontext(bt.db, benutzer) : null;
    next();
  };
}

function angemeldet(req, res, next) {
  if (!req.ctx) return next(nichtAngemeldet());
  next();
}

/** Login-Sperre (je Benutzer in der DB, je IP im Speicher) */
class LoginBremse {
  constructor(db, uhr) {
    this.db = db;
    this.uhr = uhr;
    this.ip = new Map();
  }

  pruefe(benutzerId, ip) {
    const jetzt = this.uhr().getTime();
    const z = benutzerId ? this.db.eins('SELECT gesperrt_bis FROM login_versuch WHERE benutzer_id = ?', benutzerId) : null;
    if (z && z.gesperrt_bis && new Date(z.gesperrt_bis).getTime() > jetzt) {
      throw this.fehler(new Date(z.gesperrt_bis).getTime() - jetzt);
    }
    const e = this.ip.get(ip);
    if (e && jetzt - e.start < SPERRE_MS && e.anzahl >= IP_MAX_FEHLVERSUCHE) throw this.fehler(SPERRE_MS - (jetzt - e.start));
  }

  fehler(restMs) {
    const f = new ApiFehler(429, 'ZU_VIELE_VERSUCHE', 'Zu viele Fehlversuche. Die Anmeldung ist für 5 Minuten gesperrt.');
    f.retryAfter = Math.max(1, Math.ceil(restMs / 1000));
    return f;
  }

  /** @returns {boolean} true, wenn jetzt gesperrt wurde */
  fehlversuch(benutzerId, ip) {
    const jetzt = this.uhr().getTime();
    const e = this.ip.get(ip);
    if (!e || jetzt - e.start >= SPERRE_MS) this.ip.set(ip, { start: jetzt, anzahl: 1 });
    else e.anzahl++;
    if (this.ip.size > 10000) this.ip.clear();
    if (!benutzerId) return false;
    const z = this.db.eins('SELECT fehlversuche FROM login_versuch WHERE benutzer_id = ?', benutzerId);
    const n = (z ? z.fehlversuche : 0) + 1;
    if (n >= MAX_FEHLVERSUCHE) {
      this.db.lauf('INSERT INTO login_versuch (benutzer_id, fehlversuche, gesperrt_bis) VALUES (?, 0, ?) ON CONFLICT(benutzer_id) DO UPDATE SET fehlversuche = 0, gesperrt_bis = excluded.gesperrt_bis',
        benutzerId, new Date(jetzt + SPERRE_MS).toISOString());
      return true;
    }
    this.db.lauf('INSERT INTO login_versuch (benutzer_id, fehlversuche, gesperrt_bis) VALUES (?, ?, NULL) ON CONFLICT(benutzer_id) DO UPDATE SET fehlversuche = excluded.fehlversuche',
      benutzerId, n);
    return false;
  }

  erfolg(benutzerId) {
    this.db.lauf('DELETE FROM login_versuch WHERE benutzer_id = ?', benutzerId);
  }

  entsperre(benutzerId) {
    this.erfolg(benutzerId);
  }
}

module.exports = {
  COOKIE, INAKTIV_MS, MAX_FEHLVERSUCHE, SPERRE_MS, DUMMY_HASH,
  hashPin, hashPinSync, pruefePin, neueSitzung, beendeSitzung, beendeAlleSitzungen, leseCookies,
  setzeCookie, loescheCookie, ladeSitzung, sitzungMiddleware, angemeldet, LoginBremse
};
