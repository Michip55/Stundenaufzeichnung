'use strict';
const { keinZugriff } = require('../fehler');
const { darfKalk, darfPreise } = require('../rechte');
const { kalkulationFuer, ladePreise } = require('../daten');
const { brauche, baustelleAusPfad } = require('./hilfe');

function baustelleKurz(bs) {
  return { id: bs.id, kst: bs.kst, name: bs.name, kurz: bs.kurz, status: bs.status, bauleiterId: bs.bauleiter_id, polierId: bs.polier_id };
}

module.exports = function kalkRouten(api, bt) {
  const { db } = bt;

  api.get('/kalkulation', brauche('kalk_sehen'), (req, res) => {
    const preise = ladePreise(db);
    const liste = db.alle('SELECT * FROM baustelle WHERE intern = 0 ORDER BY kst')
      .filter((bs) => darfKalk(req.ctx, bs))
      .map((bs) => {
        const k = kalkulationFuer(db, bs, preise);
        const o = {
          baustelleId: bs.id, baustelle: baustelleKurz(bs),
          budgetVerbrauchProzent: k.budgetVerbrauchProzent, leistungsstandProzent: k.leistungsstandProzent,
          status: k.status, schwellen: k.schwellen, stunden: k.stunden.lohn
        };
        if (darfPreise(req.ctx, bs)) Object.assign(o, { auftragssumme: k.auftragssumme, auftragGesamt: k.auftragGesamt, erloes: k.erloes, kosten: k.kosten, db: k.db, dbProzent: k.dbProzent });
        return o;
      });
    res.json(liste);
  });

  api.get('/kalkulation/:baustelleId', brauche('kalk_sehen'), (req, res) => {
    const bs = baustelleAusPfad(db, req.params.baustelleId);
    if (!darfKalk(req.ctx, bs)) throw keinZugriff('Die Nachkalkulation sehen Bauleiter nur für ihre eigenen Baustellen.');
    const k = kalkulationFuer(db, bs);
    const alarme = db.alle('SELECT schwelle, ausgeloest, verbrauch, leistungsstand FROM budget_alarm WHERE baustelle_id = ? ORDER BY ausgeloest', bs.id);
    const o = { baustelle: baustelleKurz(bs), ...k, alarme };
    if (!darfPreise(req.ctx, bs)) {
      // kalk_sehen ohne preise_sehen (nur per Matrix möglich): Kennzahlen ohne €-Werte
      for (const f of ['auftragssumme', 'nachtraege', 'auftragGesamt', 'erloes', 'erloesLeistung', 'erloesRegie', 'kosten', 'db', 'dbProzent', 'positionen', 'verlauf', 'rechnungen', 'interneKosten']) delete o[f];
    }
    res.json(o);
  });
};
