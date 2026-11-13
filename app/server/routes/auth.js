'use strict';
const v = require('../validierung');
const { nichtAngemeldet, ungueltig, nichtGefunden } = require('../fehler');
const { benachrichtige } = require('../budget');
const auth = require('../auth');
const { eigeneBaustellenIds } = require('../rechte');

function benutzerJson(b, mitLohngruppe) {
  const o = { id: b.id, name: b.name, rolle: b.rolle };
  if (mitLohngruppe && b.lohngruppe_id) o.lohngruppe = b.lohngruppe_id;
  return o;
}

/** Fehlversuch zählen (IP und Konto); bei Kontosperre Büro/GF benachrichtigen */
function fehlversuch(bt, b, ip) {
  const gesperrt = bt.bremse.fehlversuch(b ? b.id : null, ip);
  if (b && bt.bremse.kontoFehlversuch(b.id)) {
    const zeit = bt.uhr().toISOString();
    bt.db.protokolliere({ zeit, benutzerId: null, art: 'sicherheit', objekt: `benutzer:${b.id}`, text: `Konto ${b.name} nach ${auth.KONTO_MAX_FEHLVERSUCHE} Fehlversuchen in 24 Std. gesperrt (letzte IP ${ip})` });
    for (const e of bt.db.alle("SELECT id FROM benutzer WHERE aktiv = 1 AND rolle IN ('buero','gf') AND id <> ?", b.id)) {
      benachrichtige(bt.db, { benutzerId: e.id, typ: 'sicherheit', titel: `Konto gesperrt: ${b.name}`, text: `Nach ${auth.KONTO_MAX_FEHLVERSUCHE} falschen PIN-Eingaben in 24 Std. ist die Anmeldung von ${b.name} befristet gesperrt. Bitte prüfen und ggf. entsperren.`, zeit, schluessel: `konto:${b.id}:${zeit}` });
    }
    bt.bremse.pruefeKonto(b.id); // wirft 423 mit Sperrdauer
  }
  if (gesperrt) throw bt.bremse.fehler(gesperrt);
}

const clientIp = (req) => req.ip || (req.socket && req.socket.remoteAddress) || '?';

module.exports = function authRouten(api, bt) {
  const { db } = bt;

  /** Namensliste für die Anmeldung – ohne Rollen; per BAUTAG_LOGIN_LISTE=0 abschaltbar */
  api.get('/auth/benutzerliste', (req, res) => {
    if (!bt.loginListe) throw nichtGefunden('Die Namensliste ist abgeschaltet – Anmeldung mit Personalnummer und PIN.');
    res.json(db.alle('SELECT id, name FROM benutzer WHERE aktiv = 1 ORDER BY name').map((b) => ({ id: b.id, name: b.name })));
  });

  api.post('/auth/login', async (req, res) => {
    const body = v.objekt(req.body);
    if (typeof body.pin !== 'string' || !/^\d{4,12}$/.test(body.pin)) throw ungueltig('PIN muss aus 4 bis 12 Ziffern bestehen.');
    let b = null;
    let benutzerId = null;
    if (body.benutzerId !== undefined) {
      // D-12: ohne Namensliste nur Anmeldung mit Personalnummer
      if (!bt.loginListe) throw ungueltig('Anmeldung bitte mit Personalnummer (pnr) und PIN.');
      benutzerId = v.id(body.benutzerId, 'benutzerId');
      b = db.eins('SELECT * FROM benutzer WHERE id = ? AND aktiv = 1', benutzerId);
    } else if (body.pnr !== undefined) {
      const pnr = v.zahl(body.pnr, 'pnr', { min: 1, max: 999999, ganz: true });
      b = db.eins('SELECT * FROM benutzer WHERE pnr = ? AND aktiv = 1', pnr);
      benutzerId = b ? b.id : null;
    } else {
      throw ungueltig('benutzerId oder pnr fehlt.');
    }
    const ip = clientIp(req);
    bt.bremse.pruefe(benutzerId, ip);
    bt.bremse.pruefeKonto(b ? b.id : null);
    const ok = await auth.pruefePin(body.pin, b ? b.pin_hash : auth.DUMMY_HASH);
    if (!b || !ok) {
      fehlversuch(bt, b, ip);
      throw nichtAngemeldet('Benutzer oder PIN falsch.');
    }
    bt.bremse.erfolg(b.id, ip);
    // D-02: PIN kürzer als für die Rolle vorgeschrieben → Wechsel erzwingen
    const zuKurz = !bt.demo && !auth.FELD_ROLLEN.includes(b.rolle) && body.pin.length < 6; // Demo-Modus: 1234 bleibt
    db.lauf('UPDATE benutzer SET pin_laenge = ?, muss_pin_aendern = CASE WHEN ? THEN 1 ELSE muss_pin_aendern END WHERE id = ?', body.pin.length, zuKurz ? 1 : 0, b.id);
    if (zuKurz) b.muss_pin_aendern = 1;
    // API.md 12.7: mit aktiver Zwei-Faktor-Anmeldung erst nach dem Code anmelden
    const zf = require('./zweifaktor');
    if (zf.aktiv(db, b.id)) return res.json({ zweiterFaktor: true, vorgang: zf.neuerVorgang(bt, b.id, ip) });
    anmelden(req, res, b);
  });

  /** Sitzung anlegen (nach PIN bzw. PIN + zweitem Faktor) */
  function anmelden(req, res, b) {
    if (req.token) auth.beendeSitzung(db, req.token);
    const token = auth.neueSitzung(db, b.id, bt.uhr());
    auth.setzeCookie(req, res, token);
    res.json({ benutzer: benutzerJson(b, true), mussPinAendern: b.muss_pin_aendern === 1 });
  }

  require('./zweifaktor')(api, bt, { anmelden, fehlversuch: (b, ip) => fehlversuch(bt, b, ip), clientIp });

  api.post('/auth/logout', (req, res) => {
    auth.beendeSitzung(db, req.token);
    auth.loescheCookie(req, res);
    res.json({ ok: true });
  });

  api.get('/auth/ich', (req, res) => {
    if (!req.ctx) throw nichtAngemeldet();
    const b = req.ctx.benutzer;
    res.json({
      benutzer: { ...benutzerJson(b, true), baustelleId: b.baustelle_id ?? null },
      rechte: [...req.ctx.rechte],
      baustellenIds: eigeneBaustellenIds(db, b),
      mussPinAendern: b.muss_pin_aendern === 1,
      sitzungMinuten: auth.inaktivMinuten(b.rolle, bt.sitzung),
      zweiFaktor: require('./zweifaktor').stand(db, b)
    });
  });

  /** Eigene PIN ändern (auch bei erzwungener Änderung) */
  api.post('/auth/pin', async (req, res) => {
    if (!req.ctx) throw nichtAngemeldet();
    const body = v.objekt(req.body);
    const ich = db.eins('SELECT * FROM benutzer WHERE id = ?', req.ctx.benutzer.id);
    if (typeof body.alt !== 'string' || !/^\d{4,12}$/.test(body.alt)) throw ungueltig('Bisherige PIN fehlt.');
    const fehler = auth.pinFehler(body.neu, ich.rolle);
    if (fehler) throw ungueltig(fehler);
    if (body.neu === body.alt) throw ungueltig('Die neue PIN muss sich von der bisherigen unterscheiden.');
    const ip = clientIp(req);
    bt.bremse.pruefe(ich.id, ip);
    if (!(await auth.pruefePin(body.alt, ich.pin_hash))) {
      fehlversuch(bt, ich, ip);
      throw nichtAngemeldet('Die bisherige PIN ist falsch.');
    }
    const hash = await auth.hashPin(body.neu);
    const zeit = bt.uhr().toISOString();
    db.transaktion(() => {
      db.lauf('UPDATE benutzer SET pin_hash = ?, muss_pin_aendern = 0, pin_laenge = ? WHERE id = ?', hash, body.neu.length, ich.id);
      db.lauf('DELETE FROM sitzung WHERE benutzer_id = ? AND token_hash <> ?', ich.id, require('node:crypto').createHash('sha256').update(req.token).digest('hex'));
      db.protokolliere({ zeit, benutzerId: ich.id, art: 'benutzer', objekt: `benutzer:${ich.id}`, neu: { pin: 'selbst geändert' }, text: `${ich.name} hat die eigene PIN geändert` });
    });
    bt.bremse.erfolg(ich.id, ip);
    res.json({ ok: true });
  });
};

module.exports.benutzerJson = benutzerJson;
