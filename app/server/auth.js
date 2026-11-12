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
const MAX_FEHLVERSUCHE = 5;
/** steigende Sperrdauer je (Benutzer, IP): 5 min, 15 min, danach 60 min */
const SPERRSTUFEN_MS = [5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000];
const SPERRE_MS = SPERRSTUFEN_MS[0];
const IP_FENSTER_MS = 5 * 60 * 1000;
const IP_MAX_FEHLVERSUCHE = 30;
const FELD_ROLLEN = ['mitarbeiter', 'polier'];

function zahlEnv(name, standard) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : standard;
}
/** Sitzungsdauer (Inaktivität) je Rolle in Minuten – per Umgebung einstellbar */
function sitzungsKonfig(opt = {}) {
  return {
    feldMin: opt.feldMin || zahlEnv('BAUTAG_SITZUNG_FELD_MIN', 720),
    bueroMin: opt.bueroMin || zahlEnv('BAUTAG_SITZUNG_BUERO_MIN', 60),
    maxH: opt.maxH || zahlEnv('BAUTAG_SITZUNG_MAX_H', 24)
  };
}
function inaktivMinuten(rolle, k) {
  return FELD_ROLLEN.includes(rolle) ? k.feldMin : k.bueroMin;
}
const INAKTIV_MS = 12 * 60 * 60 * 1000; // Standard Mitarbeiter/Polier (Kompatibilität)

/** PIN-Regeln: Mitarbeiter/Polier mind. 4, Bauleiter/Büro/GF mind. 6 Ziffern; keine trivialen Folgen */
function pinFehler(pin, rolle) {
  const min = FELD_ROLLEN.includes(rolle) ? 4 : 6;
  if (typeof pin !== 'string' || !/^\d+$/.test(pin)) return 'Die PIN darf nur aus Ziffern bestehen.';
  if (pin.length < min || pin.length > 12) return `Die PIN muss ${min} bis 12 Ziffern haben.`;
  if (/^(\d)\1+$/.test(pin)) return 'Die PIN darf nicht aus lauter gleichen Ziffern bestehen.';
  const d = [...pin].map(Number);
  const auf = d.every((x, i) => i === 0 || x === (d[i - 1] + 1) % 10);
  const ab = d.every((x, i) => i === 0 || x === (d[i - 1] + 9) % 10);
  if (auf || ab) return 'Die PIN darf keine einfache Zahlenfolge sein (z. B. 1234).';
  return null;
}

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

/** HTTPS? X-Forwarded-Proto wird nur mit TRUST_PROXY=1 beachtet (Express setzt dann req.secure). */
function istHttps(req) {
  return Boolean(req.secure);
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
function ladeSitzung(db, token, jetzt, konfig = sitzungsKonfig()) {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const h = sha256(token);
  const s = db.eins('SELECT s.token_hash, s.letzte_aktivitaet, s.erstellt AS sitzung_erstellt, b.* FROM sitzung s JOIN benutzer b ON b.id = s.benutzer_id WHERE s.token_hash = ?', h);
  if (!s) return null;
  const t = jetzt.getTime();
  const inaktivMs = inaktivMinuten(s.rolle, konfig) * 60000;
  if (!s.aktiv || t - new Date(s.letzte_aktivitaet).getTime() > inaktivMs || t - new Date(s.sitzung_erstellt).getTime() > konfig.maxH * 3600000) {
    db.lauf('DELETE FROM sitzung WHERE token_hash = ?', h);
    return null;
  }
  if (t - new Date(s.letzte_aktivitaet).getTime() > 30 * 1000) {
    db.lauf('UPDATE sitzung SET letzte_aktivitaet = ? WHERE token_hash = ?', jetzt.toISOString(), h);
  }
  const { token_hash, letzte_aktivitaet, sitzung_erstellt, pin_hash, ...benutzer } = s; // eslint-disable-line no-unused-vars
  return benutzer;
}

/** Middleware: setzt req.ctx (Benutzer + Rechte) falls angemeldet */
function sitzungMiddleware(bt) {
  return (req, res, next) => {
    const token = leseCookies(req.headers.cookie)[COOKIE];
    const benutzer = ladeSitzung(bt.db, token, bt.uhr(), bt.sitzung);
    req.token = token;
    req.ctx = benutzer ? kontext(bt.db, benutzer) : null;
    next();
  };
}

function angemeldet(req, res, next) {
  if (!req.ctx) return next(nichtAngemeldet());
  next();
}

/**
 * Login-Sperre je (Benutzer, Client-IP) mit steigender Dauer, plus Grenze je Client-IP.
 * Ein Fremder kann so nur sich selbst aussperren, nicht die echten Benutzer.
 */
class LoginBremse {
  constructor(db, uhr) {
    this.db = db;
    this.uhr = uhr;
    this.ip = new Map();
  }

  pruefe(benutzerId, ip) {
    const jetzt = this.uhr().getTime();
    const e = this.ip.get(ip);
    if (e && jetzt - e.start < IP_FENSTER_MS && e.anzahl >= IP_MAX_FEHLVERSUCHE) throw this.fehler(IP_FENSTER_MS - (jetzt - e.start));
    if (!benutzerId) return;
    const z = this.db.eins('SELECT gesperrt_bis FROM login_versuch WHERE benutzer_id = ? AND ip = ?', benutzerId, ip);
    if (z && z.gesperrt_bis && new Date(z.gesperrt_bis).getTime() > jetzt) {
      throw this.fehler(new Date(z.gesperrt_bis).getTime() - jetzt);
    }
  }

  fehler(restMs) {
    const min = Math.max(1, Math.ceil(restMs / 60000));
    const f = new ApiFehler(429, 'ZU_VIELE_VERSUCHE', `Zu viele Fehlversuche. Die Anmeldung ist für ${min} Minute${min === 1 ? '' : 'n'} gesperrt.`);
    f.retryAfter = Math.max(1, Math.ceil(restMs / 1000));
    return f;
  }

  /** @returns {number} Sperrdauer in ms, wenn jetzt gesperrt wurde, sonst 0 */
  fehlversuch(benutzerId, ip) {
    const jetzt = this.uhr().getTime();
    const e = this.ip.get(ip);
    if (!e || jetzt - e.start >= IP_FENSTER_MS) this.ip.set(ip, { start: jetzt, anzahl: 1 });
    else e.anzahl++;
    if (this.ip.size > 10000) this.ip.clear();
    if (!benutzerId) return 0;
    const z = this.db.eins('SELECT fehlversuche, sperren, letzter FROM login_versuch WHERE benutzer_id = ? AND ip = ?', benutzerId, ip);
    // Eskalation verfällt nach 24 h ohne Fehlversuch
    const sperrenAlt = z && z.letzter && jetzt - new Date(z.letzter).getTime() < 24 * 3600000 ? z.sperren : 0;
    const n = (z ? z.fehlversuche : 0) + 1;
    const t = new Date(jetzt).toISOString();
    if (n >= MAX_FEHLVERSUCHE) {
      const dauer = SPERRSTUFEN_MS[Math.min(sperrenAlt, SPERRSTUFEN_MS.length - 1)];
      this.db.lauf(`INSERT INTO login_versuch (benutzer_id, ip, fehlversuche, sperren, gesperrt_bis, letzter) VALUES (?, ?, 0, ?, ?, ?)
        ON CONFLICT(benutzer_id, ip) DO UPDATE SET fehlversuche = 0, sperren = excluded.sperren, gesperrt_bis = excluded.gesperrt_bis, letzter = excluded.letzter`,
      benutzerId, ip, sperrenAlt + 1, new Date(jetzt + dauer).toISOString(), t);
      return dauer;
    }
    this.db.lauf(`INSERT INTO login_versuch (benutzer_id, ip, fehlversuche, sperren, gesperrt_bis, letzter) VALUES (?, ?, ?, ?, NULL, ?)
      ON CONFLICT(benutzer_id, ip) DO UPDATE SET fehlversuche = excluded.fehlversuche, sperren = excluded.sperren, letzter = excluded.letzter`,
    benutzerId, ip, n, sperrenAlt, t);
    return 0;
  }

  erfolg(benutzerId, ip) {
    this.db.lauf('DELETE FROM login_versuch WHERE benutzer_id = ? AND ip = ?', benutzerId, ip);
  }

  /** Büro/GF entsperrt (PIN-Reset): alle Sperren des Benutzers aufheben */
  entsperre(benutzerId) {
    this.db.lauf('DELETE FROM login_versuch WHERE benutzer_id = ?', benutzerId);
  }
}

module.exports = {
  COOKIE, INAKTIV_MS, MAX_FEHLVERSUCHE, SPERRE_MS, SPERRSTUFEN_MS, DUMMY_HASH, FELD_ROLLEN,
  sitzungsKonfig, inaktivMinuten, pinFehler,
  hashPin, hashPinSync, pruefePin, neueSitzung, beendeSitzung, beendeAlleSitzungen, leseCookies,
  setzeCookie, loescheCookie, ladeSitzung, sitzungMiddleware, angemeldet, LoginBremse
};
