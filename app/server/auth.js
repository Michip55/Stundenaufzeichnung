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
/** 15.5 (F-029): Bindungs-Cookie einer App-Sitzung – von der App lesbar und löschbar, damit das Abmelden auch ohne Netz wirkt */
const BINDUNG = 'bt_bindung';
/** 15.5 (F-030): Kopf, mit dem die App bei nachgesendeten Einträgen den Ersteller angibt */
const ERSTELLER_KOPF = 'x-bautag-ersteller';
const MAX_FEHLVERSUCHE = 5;
/** steigende Sperrdauer je (Benutzer, IP): 5 min, 15 min, danach 60 min */
const SPERRSTUFEN_MS = [5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000];
const SPERRE_MS = SPERRSTUFEN_MS[0];
const IP_FENSTER_MS = 5 * 60 * 1000;
const IP_MAX_FEHLVERSUCHE = 30;
/** Kontoweite Grenze über alle IPs (C-07): 20 Fehlversuche in 24 h → Konto gesperrt bis zur Entsperrung */
const KONTO_MAX_FEHLVERSUCHE = 20;
const KONTO_FENSTER_MS = 24 * 3600 * 1000;
/** Dauer der Kontosperre (D-01): 24 h, 48 h, danach 7 Tage */
const KONTO_SPERRSTUFEN_MS = [24 * 3600 * 1000, 48 * 3600 * 1000, 7 * 24 * 3600 * 1000];
/** N-004/N-027: falsche Zwei-Faktor-Codes je Konto (alle IPs) – 10 in 24 h → Kontosperre wie D-01; eine richtige PIN setzt nichts zurück */
const ZF_MAX_FEHLVERSUCHE = 10;
const ZF_FENSTER_MS = 24 * 3600 * 1000;
/** N-120: In-Memory-Tabelle der IP-Grenze – Obergrenze; abgelaufene Einträge werden gezielt entfernt statt alles zu leeren */
const IP_TABELLE_MAX = 50000;
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
    maxH: opt.maxH || zahlEnv('BAUTAG_SITZUNG_MAX_H', 24),
    // 15.5 (F-029): Sperre der App nach Untätigkeit am Gerät (Feldrollen arbeiten an geteilten Tablets)
    sperreFeldMin: opt.sperreFeldMin || zahlEnv('BAUTAG_SPERRE_FELD_MIN', 30)
  };
}
function inaktivMinuten(rolle, k) {
  return FELD_ROLLEN.includes(rolle) ? k.feldMin : k.bueroMin;
}
/** 15.5: nach so vielen Minuten ohne Bedienung meldet die App am Gerät ab (Feldrollen 30, sonst wie die Sitzung) */
function sperreMinuten(rolle, k) {
  return FELD_ROLLEN.includes(rolle) ? Math.min(k.sperreFeldMin || 30, k.feldMin) : k.bueroMin;
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

/**
 * Neue Sitzung. Mit `bindung` (App am Gerät, 15.5) gilt sie nur zusammen mit dem Bindungs-Cookie, das die App beim
 * Abmelden selbst löscht – auch ohne Netz. → Token (bzw. {token, bindung} mit bindung = true)
 */
function neueSitzung(db, benutzerId, jetzt, { bindung = false } = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const b = bindung ? crypto.randomBytes(32).toString('hex') : null;
  const t = jetzt.toISOString();
  db.lauf('INSERT INTO sitzung (token_hash, benutzer_id, erstellt, letzte_aktivitaet, bindung_hash) VALUES (?, ?, ?, ?, ?)', sha256(token), benutzerId, t, t, b ? sha256(b) : null);
  return bindung ? { token, bindung: b } : token;
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

function setzeCookie(req, res, token, bindung = null) {
  const teile = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (istHttps(req)) teile.push('Secure');
  const liste = [teile.join('; ')];
  // 15.5: Bindungs-Cookie ohne HttpOnly – die App löscht es beim Abmelden selbst (auch offline)
  const zweit = [`${BINDUNG}=${bindung || ''}`, 'Path=/', 'SameSite=Strict', ...(bindung ? [] : ['Max-Age=0'])];
  if (istHttps(req)) zweit.push('Secure');
  liste.push(zweit.join('; '));
  res.setHeader('Set-Cookie', liste);
}

function loescheCookie(req, res) {
  const teile = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  const zweit = [`${BINDUNG}=`, 'Path=/', 'SameSite=Strict', 'Max-Age=0'];
  if (istHttps(req)) { teile.push('Secure'); zweit.push('Secure'); }
  res.setHeader('Set-Cookie', [teile.join('; '), zweit.join('; ')]);
}

/** Gleich lange Hex-Hashes zeitkonstant vergleichen */
function hashGleich(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

/**
 * Lädt Benutzer zur Sitzung (oder null). Aktualisiert die letzte Aktivität.
 */
function ladeSitzung(db, token, jetzt, konfig = sitzungsKonfig(), bindung = undefined) {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const h = sha256(token);
  const s = db.eins('SELECT s.token_hash, s.letzte_aktivitaet, s.erstellt AS sitzung_erstellt, s.bindung_hash, b.* FROM sitzung s JOIN benutzer b ON b.id = s.benutzer_id WHERE s.token_hash = ?', h);
  if (!s) return null;
  // 15.5 (F-029): gebundene App-Sitzung ohne passendes Bindungs-Cookie (z. B. nach dem Abmelden ohne Netz) → Sitzung endet
  if (s.bindung_hash && !(typeof bindung === 'string' && /^[0-9a-f]{64}$/.test(bindung) && hashGleich(sha256(bindung), s.bindung_hash))) {
    db.lauf('DELETE FROM sitzung WHERE token_hash = ?', h);
    return null;
  }
  const t = jetzt.getTime();
  const inaktivMs = inaktivMinuten(s.rolle, konfig) * 60000;
  if (!s.aktiv || t - new Date(s.letzte_aktivitaet).getTime() > inaktivMs || t - new Date(s.sitzung_erstellt).getTime() > konfig.maxH * 3600000) {
    db.lauf('DELETE FROM sitzung WHERE token_hash = ?', h);
    return null;
  }
  if (t - new Date(s.letzte_aktivitaet).getTime() > 30 * 1000) {
    db.lauf('UPDATE sitzung SET letzte_aktivitaet = ? WHERE token_hash = ?', jetzt.toISOString(), h);
  }
  const { token_hash, letzte_aktivitaet, sitzung_erstellt, bindung_hash, pin_hash, ...benutzer } = s; // eslint-disable-line no-unused-vars
  return benutzer;
}

/** Middleware: setzt req.ctx (Benutzer + Rechte) falls angemeldet */
function sitzungMiddleware(bt) {
  return (req, res, next) => {
    const cookies = leseCookies(req.headers.cookie);
    const token = cookies[COOKIE];
    // 15.5: Inhaber des Tokens (auch einer abgelaufenen/ungebundenen Sitzung) – nur für das Abmelden (Push-Abo des Geräts)
    req.tokenBenutzerId = req.path.toLowerCase() === '/auth/logout' && token && /^[0-9a-f]{64}$/.test(token) ? (bt.db.eins('SELECT benutzer_id FROM sitzung WHERE token_hash = ?', sha256(token)) || {}).benutzer_id ?? null : null;
    const benutzer = ladeSitzung(bt.db, token, bt.uhr(), bt.sitzung, cookies[BINDUNG]);
    req.token = token;
    req.ctx = benutzer ? kontext(bt.db, benutzer) : null;
    // 15.5 (F-030): nachgesendete Einträge nennen ihren Ersteller – nie unter der Sitzung einer anderen Person annehmen
    const ersteller = req.headers[ERSTELLER_KOPF];
    if (ersteller !== undefined && req.ctx && String(ersteller).trim() !== String(req.ctx.benutzer.id)) {
      return next(new ApiFehler(409, 'ERSTELLER_ANDERS', 'Dieser Eintrag wurde von einer anderen Person an diesem Gerät erfasst. Er wird nur gesendet, wenn diese Person angemeldet ist.'));
    }
    next();
  };
}

function angemeldet(req, res, next) {
  if (!req.ctx) return next(nichtAngemeldet());
  next();
}

/**
 * N-120: Client-Adresse für Login-Sperren vereinheitlichen. IPv4 (auch „::ffff:1.2.3.4“) bleibt die volle Adresse,
 * IPv6 wird auf das /64-Netz gekürzt (ein Anschluss hat meist ein ganzes /64), alles andere zählt gemeinsam als „ungueltig“.
 */
function ipSchluessel(roh) {
  const net = require('node:net');
  let a = String(roh || '').trim();
  const zone = a.indexOf('%');
  if (zone >= 0) a = a.slice(0, zone);
  const v4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(a);
  if (v4) a = v4[1];
  const art = net.isIP(a);
  if (art === 4) return a;
  if (art !== 6) return 'ungueltig';
  // auf 8 Gruppen erweitern (eingebettetes IPv4 am Ende zu zwei Gruppen)
  let t = a.toLowerCase();
  const ein4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(t);
  if (ein4) {
    const o = ein4[1].split('.').map(Number);
    t = t.slice(0, -ein4[1].length) + `${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const [links, rechts] = t.includes('::') ? t.split('::') : [t, null];
  const l = links ? links.split(':') : [];
  const r = rechts ? rechts.split(':') : [];
  const gruppen = rechts === null ? l : [...l, ...Array(8 - l.length - r.length).fill('0'), ...r];
  return `${gruppen.slice(0, 4).map((g) => parseInt(g || '0', 16).toString(16)).join(':')}::/64`;
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
    if (this.ip.size > IP_TABELLE_MAX) this.ipAufraeumen(jetzt);
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

  /**
   * N-120: abgelaufene Einträge entfernen; reicht das nicht, die ältesten Fenster – nie die ganze Tabelle,
   * damit niemand mit vielen Adressen die Zähler aller anderen auf einmal löschen kann.
   */
  ipAufraeumen(jetzt) {
    for (const [k, e] of this.ip) if (jetzt - e.start >= IP_FENSTER_MS) this.ip.delete(k);
    if (this.ip.size <= IP_TABELLE_MAX) return;
    const ziel = Math.floor(IP_TABELLE_MAX * 0.9);
    const nachAlter = [...this.ip.entries()].filter(([, e]) => e.anzahl < IP_MAX_FEHLVERSUCHE).sort((a, b) => a[1].start - b[1].start);
    for (const [k] of nachAlter) { if (this.ip.size <= ziel) break; this.ip.delete(k); }
  }

  /** Nur nach vollständiger Anmeldung (PIN bzw. PIN + zweiter Faktor) aufrufen – N-004 */
  erfolg(benutzerId, ip) {
    this.db.lauf('DELETE FROM login_versuch WHERE benutzer_id = ? AND ip = ?', benutzerId, ip);
    this.db.lauf('DELETE FROM login_konto WHERE benutzer_id = ? AND gesperrt = 0', benutzerId); // auch Eskalationsstufe zurück
  }

  /** Konto gesperrt? → 423 (befristet, D-01) */
  pruefeKonto(benutzerId) {
    if (!benutzerId) return;
    const k = this.db.eins('SELECT gesperrt, gesperrt_bis FROM login_konto WHERE benutzer_id = ?', benutzerId);
    if (!k || !k.gesperrt) return;
    const rest = new Date(k.gesperrt_bis || 0).getTime() - this.uhr().getTime();
    if (rest <= 0) {
      // Sperre abgelaufen: Zähler neu, Eskalationsstufe bleibt bis zur nächsten erfolgreichen Anmeldung
      this.db.lauf('UPDATE login_konto SET gesperrt = 0, fehlversuche = 0, erster = NULL WHERE benutzer_id = ?', benutzerId);
      return;
    }
    const f = new ApiFehler(423, 'KONTO_GESPERRT', `Das Konto ist nach zu vielen Fehlversuchen gesperrt (bis ${new Date(k.gesperrt_bis).toISOString()}). Büro oder Geschäftsführung können es vorher entsperren.`);
    f.retryAfter = Math.ceil(rest / 1000);
    throw f;
  }

  /** Fehlversuch kontoweit zählen; @returns {boolean} true, wenn das Konto jetzt gesperrt wurde */
  kontoFehlversuch(benutzerId) {
    if (!benutzerId) return false;
    const jetzt = this.uhr().getTime();
    const k = this.db.eins('SELECT * FROM login_konto WHERE benutzer_id = ?', benutzerId);
    if (k && k.gesperrt && new Date(k.gesperrt_bis || 0).getTime() > jetzt) return false; // schon gesperrt – ein weiterer Fehlversuch hebt die Sperre nie auf
    const neuesFenster = !k || !k.erster || jetzt - new Date(k.erster).getTime() > KONTO_FENSTER_MS;
    const n = neuesFenster ? 1 : k.fehlversuche + 1;
    const erster = neuesFenster ? new Date(jetzt).toISOString() : k.erster;
    const stufe = k ? k.sperren : 0;
    const sperren = n >= KONTO_MAX_FEHLVERSUCHE;
    if (sperren) { this.kontoSperren(benutzerId); return true; }
    this.db.lauf(`INSERT INTO login_konto (benutzer_id, fehlversuche, erster, gesperrt, gesperrt_seit, sperren, gesperrt_bis) VALUES (?, ?, ?, 0, NULL, ?, ?)
      ON CONFLICT(benutzer_id) DO UPDATE SET fehlversuche = excluded.fehlversuche, erster = excluded.erster, gesperrt = 0,
        gesperrt_seit = NULL, sperren = excluded.sperren, gesperrt_bis = excluded.gesperrt_bis`,
    benutzerId, n, erster, stufe, k ? k.gesperrt_bis : null);
    return false;
  }

  /** Konto befristet sperren (D-01: 24 h, 48 h, danach 7 Tage) */
  kontoSperren(benutzerId) {
    const jetzt = this.uhr().getTime();
    const k = this.db.eins('SELECT sperren FROM login_konto WHERE benutzer_id = ?', benutzerId);
    const stufe = k ? k.sperren : 0;
    const bis = new Date(jetzt + KONTO_SPERRSTUFEN_MS[Math.min(stufe, KONTO_SPERRSTUFEN_MS.length - 1)]).toISOString();
    this.db.lauf(`INSERT INTO login_konto (benutzer_id, fehlversuche, erster, gesperrt, gesperrt_seit, sperren, gesperrt_bis) VALUES (?, 0, NULL, 1, ?, ?, ?)
      ON CONFLICT(benutzer_id) DO UPDATE SET fehlversuche = 0, erster = NULL, gesperrt = 1, gesperrt_seit = excluded.gesperrt_seit, sperren = excluded.sperren, gesperrt_bis = excluded.gesperrt_bis`,
    benutzerId, new Date(jetzt).toISOString(), stufe + 1, bis);
  }

  /**
   * N-004/N-027: falscher Zwei-Faktor-Code – eigener kontoweiter Zähler (alle IPs), den keine PIN-Anmeldung zurücksetzt.
   * @returns {{anzahl:number, gesperrt:boolean}} gesperrt = Konto wurde jetzt gesperrt
   */
  zweiFaktorFehlversuch(benutzerId) {
    const jetzt = this.uhr().getTime();
    const t = new Date(jetzt).toISOString();
    const z = this.db.eins('SELECT fehlversuche, erster FROM login_2fa_fehler WHERE benutzer_id = ?', benutzerId);
    const neuesFenster = !z || !z.erster || jetzt - new Date(z.erster).getTime() > ZF_FENSTER_MS;
    const n = neuesFenster ? 1 : z.fehlversuche + 1;
    if (n >= ZF_MAX_FEHLVERSUCHE) {
      this.db.lauf('DELETE FROM login_2fa_fehler WHERE benutzer_id = ?', benutzerId);
      this.kontoSperren(benutzerId);
      return { anzahl: n, gesperrt: true };
    }
    this.db.lauf(`INSERT INTO login_2fa_fehler (benutzer_id, fehlversuche, erster, letzter) VALUES (?, ?, ?, ?)
      ON CONFLICT(benutzer_id) DO UPDATE SET fehlversuche = excluded.fehlversuche, erster = excluded.erster, letzter = excluded.letzter`,
    benutzerId, n, neuesFenster ? t : z.erster, t);
    return { anzahl: n, gesperrt: false };
  }

  /** Büro/GF bzw. entsperren.js: Kontosperre und alle kontoweiten Zähler aufheben */
  kontoEntsperren(benutzerId) {
    this.db.lauf('DELETE FROM login_konto WHERE benutzer_id = ?', benutzerId);
    this.db.lauf('DELETE FROM login_2fa_fehler WHERE benutzer_id = ?', benutzerId);
  }

  /** Büro/GF entsperrt (PIN-Reset): alle Sperren des Benutzers aufheben */
  entsperre(benutzerId) {
    this.db.lauf('DELETE FROM login_versuch WHERE benutzer_id = ?', benutzerId);
  }
}

module.exports = {
  COOKIE, BINDUNG, ERSTELLER_KOPF, INAKTIV_MS, MAX_FEHLVERSUCHE, KONTO_MAX_FEHLVERSUCHE, ZF_MAX_FEHLVERSUCHE, IP_TABELLE_MAX, ipSchluessel, KONTO_SPERRSTUFEN_MS, SPERRE_MS, SPERRSTUFEN_MS, DUMMY_HASH, FELD_ROLLEN,
  sitzungsKonfig, inaktivMinuten, sperreMinuten, pinFehler,
  hashPin, hashPinSync, pruefePin, neueSitzung, beendeSitzung, beendeAlleSitzungen, leseCookies,
  setzeCookie, loescheCookie, ladeSitzung, sitzungMiddleware, angemeldet, LoginBremse
};
