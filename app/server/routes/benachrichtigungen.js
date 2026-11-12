'use strict';
const v = require('../validierung');
const { nichtGefunden } = require('../fehler');
const { darfKalk } = require('../rechte');

module.exports = function benachrichtigungsRouten(api, bt) {
  const { db } = bt;

  /** Nur eigene; Budget-Meldungen zusätzlich nur, solange das Recht für die Baustelle besteht */
  function eigene(ctx) {
    const bsMap = new Map(db.alle('SELECT id, bauleiter_id, polier_id FROM baustelle').map((b) => [b.id, b]));
    return db.alle('SELECT * FROM benachrichtigung WHERE benutzer_id = ? ORDER BY zeit DESC, id DESC LIMIT 200', ctx.benutzer.id)
      .filter((n) => n.typ !== 'budget' || darfKalk(ctx, bsMap.get(n.baustelle_id)));
  }

  api.get('/benachrichtigungen', (req, res) => {
    res.json(eigene(req.ctx).map((n) => ({
      id: n.id, typ: n.typ, titel: n.titel, text: n.text, zeit: n.zeit, gelesen: n.gelesen === 1,
      ...(n.baustelle_id ? { baustelleId: n.baustelle_id } : {})
    })));
  });

  api.post('/benachrichtigungen/alle-gelesen', (req, res) => {
    const r = db.lauf('UPDATE benachrichtigung SET gelesen = 1 WHERE benutzer_id = ? AND gelesen = 0', req.ctx.benutzer.id);
    res.json({ ok: true, anzahl: r.changes });
  });

  api.post('/benachrichtigungen/:id/gelesen', (req, res) => {
    const id = v.pfadId(req.params.id, 'ID');
    const r = db.lauf('UPDATE benachrichtigung SET gelesen = 1 WHERE id = ? AND benutzer_id = ?', id, req.ctx.benutzer.id);
    if (!r.changes) throw nichtGefunden('Benachrichtigung nicht gefunden.');
    res.json({ ok: true });
  });
};
