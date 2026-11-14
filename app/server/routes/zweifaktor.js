'use strict';
/** Zwei-Faktor-Anmeldung (TOTP, RFC 6238) für Bauleiter, Büro, GF – API.md 12.7 */
const crypto = require('node:crypto');
const v = require('../validierung');
const { ungueltig, nichtAngemeldet, keinZugriff, konflikt, nichtGefunden } = require('../fehler');
const auth = require('../auth');
const T = require('../totp');
const G = require('../geheim');
const { benachrichtige } = require('../benachrichtigung'); // 15.3: eine Stelle

const ROLLEN = ['bauleiter', 'buero', 'gf'];
const VORGANG_MIN = 5;
const VORGANG_VERSUCHE = 5;
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');
const UNLESBAR_TEXT = '2FA-Schlüssel nicht lesbar – Wiederherstellungscode verwenden oder Zurücksetzen durch GF/entsperren.js.';

function pflichtRollen(db) {
  return { bauleiter: false, buero: false, gf: false, ...(db.einstellung('zwei_faktor_pflicht', {}) || {}) };
}
function aktiv(db, benutzerId) {
  return Boolean(db.eins('SELECT 1 AS x FROM benutzer_2fa WHERE benutzer_id = ? AND aktiv = 1', benutzerId));
}
function stand(db, b) {
  const z = db.eins('SELECT aktiv FROM benutzer_2fa WHERE benutzer_id = ?', b.id);
  return { aktiv: Boolean(z && z.aktiv), pflicht: ROLLEN.includes(b.rolle) && Boolean(pflichtRollen(db)[b.rolle]) };
}
function neuerVorgang(bt, benutzerId, ip) {
  const token = crypto.randomBytes(32).toString('base64url');
  bt.db.lauf('DELETE FROM login_2fa WHERE erstellt < ?', new Date(bt.uhr().getTime() - VORGANG_MIN * 60000).toISOString());
  bt.db.lauf('INSERT INTO login_2fa (token_hash, benutzer_id, erstellt, ip) VALUES (?, ?, ?, ?)', hash(token), benutzerId, bt.uhr().toISOString(), ip);
  return token;
}

/**
 * Code prüfen (TOTP oder Wiederherstellungscode) → 'totp' | 'code' | null; markiert verbrauchte Codes.
 */
function pruefeCode(bt, z, code) {
  const { db } = bt;
  const c = String(code || '').trim().replace(/\s/g, '');
  if (/^\d{6}$/.test(c)) {
    // G-03: Ist das Geheimnis nicht lesbar (BAUTAG_SCHLUESSEL geändert/verloren), klar melden – Wiederherstellungscodes gehen trotzdem
    const geheimnis = G.entschluesseln(bt, z.geheimnis);
    if (!geheimnis) return 'unlesbar';
    const s = T.pruefe(T.base32Dekodieren(geheimnis), c, bt.uhr().getTime(), z.letzter_schritt);
    if (s == null) return null;
    db.lauf('UPDATE benutzer_2fa SET letzter_schritt = ? WHERE benutzer_id = ?', s, z.benutzer_id);
    return 'totp';
  }
  if (/^[a-z2-7]{4}-?[a-z2-7]{4}$/i.test(c)) {
    // nur gesalzene SHA-256-Hashes – unabhängig von BAUTAG_SCHLUESSEL (G-03)
    const codes = JSON.parse(z.codes || '[]');
    const h = T.codeHash(c, z.salz);
    const i = codes.findIndex((x) => x.h === h && !x.verbraucht);
    if (i < 0) return null;
    codes[i].verbraucht = bt.uhr().toISOString();
    db.lauf('UPDATE benutzer_2fa SET codes = ? WHERE benutzer_id = ?', JSON.stringify(codes), z.benutzer_id);
    return 'code';
  }
  return null;
}

function neueCodes(z) {
  const klar = T.wiederherstellungscodes(10);
  return { klar, gespeichert: JSON.stringify(klar.map((c) => ({ h: T.codeHash(c, z.salz) }))) };
}

module.exports = function zweiFaktorRouten(api, bt, { anmelden, fehlversuch, zweiFaktorFehlversuch, clientIp }) {
  const { db } = bt;
  const jetzt = () => bt.uhr().toISOString();
  const ich = (req) => { if (!req.ctx) throw nichtAngemeldet(); return req.ctx.benutzer; };
  const prot = (b, text, benutzerId = b.id) => db.protokolliere({ zeit: jetzt(), benutzerId, art: 'sicherheit', objekt: `benutzer:${b.id}`, text });
  async function pinPruefen(req, b, pin) {
    if (typeof pin !== 'string' || !/^\d{4,12}$/.test(pin)) throw ungueltig('PIN fehlt.');
    const ip = clientIp(req);
    bt.bremse.pruefe(b.id, ip);
    bt.bremse.pruefeKonto(b.id); // 15.5 (F-031): Kontosperre gilt auch innerhalb der Sitzung
    const voll = db.eins('SELECT pin_hash FROM benutzer WHERE id = ?', b.id);
    if (!(await auth.pruefePin(pin, voll.pin_hash))) { fehlversuch(b, ip, { inSitzung: true }); throw nichtAngemeldet('PIN falsch.'); }
  }

  api.get('/auth/2fa', (req, res) => {
    const b = ich(req);
    const z = db.eins('SELECT * FROM benutzer_2fa WHERE benutzer_id = ?', b.id);
    const codes = z ? JSON.parse(z.codes || '[]') : [];
    res.json({ ...stand(db, b), moeglich: ROLLEN.includes(b.rolle), restcodes: z && z.aktiv ? codes.filter((c) => !c.verbraucht).length : 0 });
  });

  api.post('/auth/2fa/einrichten', async (req, res) => {
    const b = ich(req);
    if (!ROLLEN.includes(b.rolle)) throw ungueltig('Zwei-Faktor-Anmeldung gibt es für Bauleiter, Büro und Geschäftsführung.');
    if (aktiv(db, b.id)) throw konflikt('Die Zwei-Faktor-Anmeldung ist bereits eingerichtet.');
    // N-063: das TOTP-Geheimnis wird nie im Klartext gespeichert (außer Vorführung/Test)
    if (!G.schluesselVorhanden(bt) && !G.klarErlaubt(bt)) throw ungueltig('Zum Einrichten der Zwei-Faktor-Anmeldung muss auf dem Server BAUTAG_SCHLUESSEL gesetzt sein (mindestens 32 Zeichen, siehe deploy/.env).');
    await pinPruefen(req, b, v.objekt(req.body).pin);
    const geheimnis = T.neuesGeheimnis();
    const salz = crypto.randomBytes(16).toString('hex');
    db.lauf(`INSERT INTO benutzer_2fa (benutzer_id, geheimnis, aktiv, salz, erstellt) VALUES (?, ?, 0, ?, ?)
      ON CONFLICT(benutzer_id) DO UPDATE SET geheimnis = excluded.geheimnis, aktiv = 0, salz = excluded.salz, codes = '[]', letzter_schritt = NULL, erstellt = excluded.erstellt`,
    b.id, G.verschluesseln(bt, geheimnis), salz, jetzt());
    const firma = (db.einstellung('firma', {}) || {}).name || 'BauTag';
    const uri = T.otpauthUri({ geheimnis, konto: `${b.name} (${firma})`.slice(0, 80) });
    const svg = await require('qrcode').toString(uri, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 });
    res.json({ geheimnis, otpauthUri: uri, qrSvg: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` });
  });

  api.post('/auth/2fa/bestaetigen', (req, res) => {
    const b = ich(req);
    const z = db.eins('SELECT * FROM benutzer_2fa WHERE benutzer_id = ? AND aktiv = 0', b.id);
    if (!z) throw konflikt('Bitte zuerst einrichten (QR-Code).');
    const ip = clientIp(req);
    bt.bremse.pruefe(b.id, ip);
    bt.bremse.pruefeKonto(b.id); // 15.5 (F-031)
    const body = v.objekt(req.body);
    if (!/^\d{6}$/.test(String(body.code || ''))) throw ungueltig('Bitte den 6-stelligen Code aus der App eingeben.');
    if (pruefeCode(bt, z, body.code) !== 'totp') { fehlversuch(b, ip, { inSitzung: true }); throw ungueltig('Der Code stimmt nicht. Uhrzeit am Handy prüfen und den aktuellen Code eingeben.'); }
    const c = neueCodes(z);
    db.transaktion(() => {
      db.lauf('UPDATE benutzer_2fa SET aktiv = 1, bestaetigt = ?, codes = ? WHERE benutzer_id = ?', jetzt(), c.gespeichert, b.id);
      // N-119: andere, nur mit PIN eröffnete Sitzungen beenden (wie beim PIN-Wechsel); die aktuelle bleibt
      const weg = db.lauf('DELETE FROM sitzung WHERE benutzer_id = ? AND token_hash <> ?', b.id, hash(req.token || '')).changes;
      prot(b, `${b.name} hat die Zwei-Faktor-Anmeldung eingerichtet${weg ? ` (${weg} andere Sitzung(en) beendet)` : ''}`);
    });
    res.json({ aktiv: true, wiederherstellungscodes: c.klar });
  });

  api.post('/auth/2fa/codes', (req, res) => {
    const b = ich(req);
    const z = db.eins('SELECT * FROM benutzer_2fa WHERE benutzer_id = ? AND aktiv = 1', b.id);
    if (!z) throw konflikt('Die Zwei-Faktor-Anmeldung ist nicht eingerichtet.');
    const ip = clientIp(req);
    bt.bremse.pruefe(b.id, ip);
    bt.bremse.pruefeKonto(b.id); // 15.5 (F-031)
    const art = pruefeCode(bt, z, v.objekt(req.body).code);
    if (art === 'unlesbar') throw ungueltig(UNLESBAR_TEXT);
    if (art !== 'totp') { zweiFaktorFehlversuch(b, ip, { anlass: 'einstellungen' }); throw ungueltig('Der Code stimmt nicht.'); }
    const c = neueCodes(z);
    db.transaktion(() => { db.lauf('UPDATE benutzer_2fa SET codes = ? WHERE benutzer_id = ?', c.gespeichert, b.id); prot(b, `${b.name} hat neue Wiederherstellungscodes erzeugt`); });
    res.json({ wiederherstellungscodes: c.klar });
  });

  api.post('/auth/2fa/aus', async (req, res) => {
    const b = ich(req);
    if (stand(db, b).pflicht) throw konflikt('Für Ihre Rolle ist die Zwei-Faktor-Anmeldung Pflicht.');
    const z = db.eins('SELECT * FROM benutzer_2fa WHERE benutzer_id = ? AND aktiv = 1', b.id);
    if (!z) throw konflikt('Die Zwei-Faktor-Anmeldung ist nicht eingerichtet.');
    const body = v.objekt(req.body);
    await pinPruefen(req, b, body.pin);
    const art = pruefeCode(bt, z, body.code);
    if (art === 'unlesbar') throw ungueltig(UNLESBAR_TEXT);
    if (!art) { zweiFaktorFehlversuch(b, clientIp(req), { anlass: 'einstellungen' }); throw ungueltig('Der Code stimmt nicht.'); }
    db.transaktion(() => { db.lauf('DELETE FROM benutzer_2fa WHERE benutzer_id = ?', b.id); prot(b, `${b.name} hat die Zwei-Faktor-Anmeldung ausgeschaltet`); });
    res.json({ aktiv: false });
  });

  api.post('/auth/login/2fa', (req, res) => {
    const body = v.objekt(req.body);
    const token = typeof body.vorgang === 'string' ? body.vorgang : '';
    const vg = token ? db.eins('SELECT * FROM login_2fa WHERE token_hash = ?', hash(token)) : null;
    const abgelaufen = !vg || new Date(vg.erstellt).getTime() < bt.uhr().getTime() - VORGANG_MIN * 60000 || vg.versuche >= VORGANG_VERSUCHE;
    if (abgelaufen) {
      if (vg) db.lauf('DELETE FROM login_2fa WHERE token_hash = ?', vg.token_hash);
      throw nichtAngemeldet('Die Anmeldung ist abgelaufen – bitte erneut mit PIN anmelden.');
    }
    const b = db.eins('SELECT * FROM benutzer WHERE id = ? AND aktiv = 1', vg.benutzer_id);
    if (!b) throw nichtAngemeldet();
    const ip = clientIp(req);
    bt.bremse.pruefe(b.id, ip);
    bt.bremse.pruefeKonto(b.id);
    const z = db.eins('SELECT * FROM benutzer_2fa WHERE benutzer_id = ? AND aktiv = 1', b.id);
    const art = z ? pruefeCode(bt, z, body.code) : null;
    if (art === 'unlesbar') {
      // kein Fehlversuch der Person (Server-Problem), aber Vorgang zählt
      db.lauf('UPDATE login_2fa SET versuche = versuche + 1 WHERE token_hash = ?', vg.token_hash);
      prot(b, `${b.name}: Anmeldung mit 2FA-Code nicht möglich – Geheimnis mit dem aktuellen BAUTAG_SCHLUESSEL nicht lesbar`);
      throw new (require('../fehler').ApiFehler)(401, 'ZWEI_FAKTOR_UNLESBAR', UNLESBAR_TEXT);
    }
    if (!art) {
      db.lauf('UPDATE login_2fa SET versuche = versuche + 1 WHERE token_hash = ?', vg.token_hash);
      // N-004: kontoweit zählen, protokollieren, Person benachrichtigen (eine Meldung je Anmeldevorgang)
      zweiFaktorFehlversuch(b, ip, { anlass: 'anmeldung', schluessel: `2fa-falsch:${b.id}:${vg.token_hash.slice(0, 16)}` });
      throw nichtAngemeldet('Der Code stimmt nicht.');
    }
    db.lauf('DELETE FROM login_2fa WHERE token_hash = ?', vg.token_hash);
    bt.bremse.erfolg(b.id, ip);
    if (art === 'code') {
      const rest = JSON.parse(db.eins('SELECT codes FROM benutzer_2fa WHERE benutzer_id = ?', b.id).codes).filter((c) => !c.verbraucht).length;
      benachrichtige(db, { benutzerId: b.id, typ: 'sicherheit', titel: 'Wiederherstellungscode verwendet', text: `Bei der Anmeldung wurde ein Wiederherstellungscode verwendet (noch ${rest} übrig). Waren Sie das nicht, sofort die GF informieren.`, zeit: jetzt(), schluessel: `2fa-code:${b.id}:${jetzt()}` });
      prot(b, `${b.name}: Anmeldung mit Wiederherstellungscode (noch ${rest})`);
    }
    anmelden(req, res, b);
  });

  api.get('/einstellungen/sicherheit', (req, res) => {
    if (!req.ctx) throw nichtAngemeldet();
    if (!req.ctx.hat('benutzer')) throw keinZugriff();
    res.json({ zweiFaktorPflicht: pflichtRollen(db) });
  });
  api.put('/einstellungen/sicherheit', (req, res) => {
    if (!req.ctx) throw nichtAngemeldet();
    if (!req.ctx.hat('benutzer')) throw keinZugriff();
    const body = v.objekt(req.body);
    const p = v.objekt(body.zweiFaktorPflicht, 'zweiFaktorPflicht');
    const neu = pflichtRollen(db);
    for (const [k, x] of Object.entries(p)) {
      if (!ROLLEN.includes(k)) throw ungueltig(`zweiFaktorPflicht.${k}: nur bauleiter, buero, gf.`);
      neu[k] = v.bool(x, `zweiFaktorPflicht.${k}`);
    }
    db.setzeEinstellung('zwei_faktor_pflicht', neu);
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'sicherheit', objekt: 'einstellung', neu, text: 'Zwei-Faktor-Pflicht je Rolle geändert' });
    res.json({ zweiFaktorPflicht: neu });
  });

  api.delete('/benutzer/:id/2fa', (req, res) => {
    if (!req.ctx) throw nichtAngemeldet();
    if (!req.ctx.hat('benutzer')) throw keinZugriff();
    const id = v.pfadId(req.params.id, 'Benutzer-ID');
    if (id === req.ctx.benutzer.id) throw keinZugriff('Die eigene Zwei-Faktor-Anmeldung setzt eine andere Person mit Benutzerrecht zurück.');
    const b = db.eins('SELECT * FROM benutzer WHERE id = ?', id);
    if (!b) throw nichtGefunden('Benutzer nicht gefunden.');
    require('./benutzer').pruefeKontoZuruecksetzen(db, req.ctx, b); // 15.5 (F-050/F-051): nur bei niedrigerer Verwaltungsstufe, GF nie über die API
    db.transaktion(() => {
      db.lauf('DELETE FROM benutzer_2fa WHERE benutzer_id = ?', id);
      db.lauf('DELETE FROM sitzung WHERE benutzer_id = ?', id);
      require('../push').abosLoeschen(db, id); // 15.5 (F-014)
      prot(b, `Zwei-Faktor-Anmeldung von ${b.name} zurückgesetzt durch ${req.ctx.benutzer.name}`, req.ctx.benutzer.id);
      benachrichtige(db, { benutzerId: id, typ: 'sicherheit', titel: 'Zwei-Faktor-Anmeldung zurückgesetzt', text: `${req.ctx.benutzer.name} hat Ihre Zwei-Faktor-Anmeldung zurückgesetzt. Bitte nach der Anmeldung neu einrichten.`, zeit: jetzt(), schluessel: `2fa-reset:${id}:${jetzt()}` });
    });
    res.json({ ok: true });
  });
};

module.exports.aktiv = aktiv;
module.exports.stand = stand;
module.exports.neuerVorgang = neuerVorgang;
module.exports.ROLLEN = ROLLEN;
module.exports.UNLESBAR_TEXT = UNLESBAR_TEXT;
