'use strict';
const v = require('../validierung');
const { nichtAngemeldet, ungueltig, nichtGefunden } = require('../fehler');
const auth = require('../auth');
const { eigeneBaustellenIds } = require('../rechte');

function benutzerJson(b, mitLohngruppe) {
  const o = { id: b.id, name: b.name, rolle: b.rolle };
  if (mitLohngruppe && b.lohngruppe_id) o.lohngruppe = b.lohngruppe_id;
  return o;
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
    const ok = await auth.pruefePin(body.pin, b ? b.pin_hash : auth.DUMMY_HASH);
    if (!b || !ok) {
      const gesperrt = bt.bremse.fehlversuch(b ? b.id : null, ip);
      if (gesperrt) throw bt.bremse.fehler(gesperrt);
      throw nichtAngemeldet('Benutzer oder PIN falsch.');
    }
    bt.bremse.erfolg(b.id, ip);
    if (req.token) auth.beendeSitzung(db, req.token);
    const token = auth.neueSitzung(db, b.id, bt.uhr());
    auth.setzeCookie(req, res, token);
    res.json({ benutzer: benutzerJson(b, true), mussPinAendern: b.muss_pin_aendern === 1 });
  });

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
      sitzungMinuten: auth.inaktivMinuten(b.rolle, bt.sitzung)
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
      const gesperrt = bt.bremse.fehlversuch(ich.id, ip);
      if (gesperrt) throw bt.bremse.fehler(gesperrt);
      throw nichtAngemeldet('Die bisherige PIN ist falsch.');
    }
    const hash = await auth.hashPin(body.neu);
    const zeit = bt.uhr().toISOString();
    db.transaktion(() => {
      db.lauf('UPDATE benutzer SET pin_hash = ?, muss_pin_aendern = 0 WHERE id = ?', hash, ich.id);
      db.lauf('DELETE FROM sitzung WHERE benutzer_id = ? AND token_hash <> ?', ich.id, require('node:crypto').createHash('sha256').update(req.token).digest('hex'));
      db.protokolliere({ zeit, benutzerId: ich.id, art: 'benutzer', objekt: `benutzer:${ich.id}`, neu: { pin: 'selbst geändert' }, text: `${ich.name} hat die eigene PIN geändert` });
    });
    bt.bremse.erfolg(ich.id, ip);
    res.json({ ok: true });
  });
};

module.exports.benutzerJson = benutzerJson;
