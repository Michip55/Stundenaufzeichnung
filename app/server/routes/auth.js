'use strict';
const v = require('../validierung');
const { nichtAngemeldet, ungueltig } = require('../fehler');
const auth = require('../auth');
const { eigeneBaustellenIds } = require('../rechte');

function benutzerJson(b, mitLohngruppe) {
  const o = { id: b.id, name: b.name, rolle: b.rolle };
  if (mitLohngruppe && b.lohngruppe_id) o.lohngruppe = b.lohngruppe_id;
  return o;
}

module.exports = function authRouten(api, bt) {
  const { db } = bt;

  api.get('/auth/benutzerliste', (req, res) => {
    res.json(db.alle('SELECT id, name, rolle FROM benutzer WHERE aktiv = 1 ORDER BY name').map((b) => ({ id: b.id, name: b.name, rolle: b.rolle })));
  });

  api.post('/auth/login', async (req, res) => {
    const body = v.objekt(req.body);
    const benutzerId = v.id(body.benutzerId, 'benutzerId');
    if (typeof body.pin !== 'string' || !/^\d{4,8}$/.test(body.pin)) throw ungueltig('PIN muss aus 4 bis 8 Ziffern bestehen.');
    const ip = req.ip || req.socket.remoteAddress || '?';
    bt.bremse.pruefe(benutzerId, ip);
    const b = db.eins('SELECT * FROM benutzer WHERE id = ? AND aktiv = 1', benutzerId);
    const ok = await auth.pruefePin(body.pin, b ? b.pin_hash : auth.DUMMY_HASH);
    if (!b || !ok) {
      const gesperrt = bt.bremse.fehlversuch(b ? b.id : null, ip);
      if (gesperrt) throw bt.bremse.fehler(auth.SPERRE_MS);
      throw nichtAngemeldet('Benutzer oder PIN falsch.');
    }
    bt.bremse.erfolg(b.id);
    if (req.token) auth.beendeSitzung(db, req.token);
    const token = auth.neueSitzung(db, b.id, bt.uhr());
    auth.setzeCookie(req, res, token);
    res.json({ benutzer: benutzerJson(b, true) });
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
      baustellenIds: eigeneBaustellenIds(db, b)
    });
  });
};

module.exports.benutzerJson = benutzerJson;
