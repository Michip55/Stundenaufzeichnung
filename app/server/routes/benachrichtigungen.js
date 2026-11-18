'use strict';
const v = require('../validierung');
const { nichtGefunden } = require('../fehler');
const { darfSehen } = require('../benachrichtigung');

module.exports = function benachrichtigungsRouten(api, bt) {
  const { db } = bt;

  /**
   * Nur eigene, und nur solange die AKTUELLEN Rechte reichen (API.md 15.3): jede Zeile trägt `erfordert`.
   * Nicht mehr sichtbare Zeilen bleiben gespeichert und erscheinen wieder, wenn das Recht zurückkommt.
   * Jede Route über Benachrichtigungen (Liste, Anzahl, einzelne, gelesen) MUSS über diese Funktion gehen.
   */
  function sichtbare(ctx, { nurUngelesen = false } = {}) {
    // Gefiltert wird VOR der Begrenzung, damit ausgeblendete Zeilen keine sichtbaren verdrängen
    const sql = `SELECT * FROM benachrichtigung WHERE benutzer_id = ?${nurUngelesen ? ' AND gelesen = 0' : ''} ORDER BY zeit DESC, id DESC`;
    return db.alle(sql, ctx.benutzer.id).filter((n) => darfSehen(ctx, n));
  }

  api.get('/benachrichtigungen', (req, res) => {
    res.json(sichtbare(req.ctx).slice(0, 200).map((n) => ({
      id: n.id, typ: n.typ, titel: n.titel, text: n.text, zeit: n.zeit, gelesen: n.gelesen === 1,
      ...(n.baustelle_id ? { baustelleId: n.baustelle_id } : {}),
      ...(n.anlage_id ? { anlageId: n.anlage_id } : {})
    })));
  });

  api.post('/benachrichtigungen/alle-gelesen', (req, res) => {
    // Nur sichtbare markieren – ausgeblendete bleiben unverändert (auch ihre Anzahl verrät nichts)
    const ids = sichtbare(req.ctx, { nurUngelesen: true }).map((n) => n.id);
    db.transaktion(() => { for (const id of ids) db.lauf('UPDATE benachrichtigung SET gelesen = 1 WHERE id = ? AND benutzer_id = ?', id, req.ctx.benutzer.id); });
    res.json({ ok: true, anzahl: ids.length });
  });

  api.post('/benachrichtigungen/:id/gelesen', (req, res) => {
    const id = v.pfadId(req.params.id, 'ID');
    const n = db.eins('SELECT * FROM benachrichtigung WHERE id = ? AND benutzer_id = ?', id, req.ctx.benutzer.id);
    // Ausgeblendete verhalten sich wie nicht vorhandene (404, gleiche Meldung)
    if (!n || !darfSehen(req.ctx, n)) throw nichtGefunden('Benachrichtigung nicht gefunden.');
    db.lauf('UPDATE benachrichtigung SET gelesen = 1 WHERE id = ?', n.id);
    res.json({ ok: true });
  });
};
