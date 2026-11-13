'use strict';
const v = require('../validierung');
const { monat } = require('../auswertung');
const { lohnCsv, buakCsv } = require('../export');
const { wienDatum } = require('../datum');
const { brauche } = require('./hilfe');

module.exports = function monatRouten(api, bt) {
  const { db } = bt;
  const monatParam = (req) => (req.query.monat === undefined ? wienDatum(bt.uhr()).slice(0, 7) : v.monat(String(req.query.monat)));

  api.get('/monat', brauche('lohn'), (req, res) => {
    res.json(monat(db, monatParam(req), bt.uhr()));
  });

  api.get('/monat/export.csv', brauche('lohn'), (req, res) => {
    const m = monatParam(req);
    const daten = monat(db, m, bt.uhr());
    db.protokolliere({ zeit: bt.uhr().toISOString(), benutzerId: req.ctx.benutzer.id, art: 'export', objekt: `monat:${m}`, text: `Lohn-Export ${m} erstellt` });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="BauTag_Lohn_${m}.csv"`);
    res.send(lohnCsv(daten));
  });

  api.get('/monat/buak.csv', brauche('lohn'), (req, res) => {
    const m = monatParam(req);
    const daten = monat(db, m, bt.uhr());
    db.protokolliere({ zeit: bt.uhr().toISOString(), benutzerId: req.ctx.benutzer.id, art: 'export', objekt: `monat:${m}`, text: `BUAK-Grundlage ${m} erstellt` });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="BauTag_BUAK-Grundlage_${m}.csv"`);
    res.send(buakCsv(daten));
  });
};
