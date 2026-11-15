'use strict';
const v = require('../validierung');
const { ungueltig, nichtGefunden } = require('../fehler');
const PV = require('../preise-verlauf');
const { pruefeAlleBudgets } = require('../budget');
const { brauche } = require('./hilfe');

/** Erlaubte Arten und Felder für Preisänderungen */
const ARTEN = {
  lohngruppen: { tabelle: 'lohngruppe', felder: ['kostensatz', 'regiesatz'], idText: true },
  geraete: { tabelle: 'geraet', felder: ['kostensatz', 'verrechnungssatz'] },
  materialien: { tabelle: 'material', felder: ['ek', 'vk'] },
  leistungen: { tabelle: 'leistung', felder: ['ep'] }
};

function eintragJson(art, z) {
  switch (art) {
    case 'lohngruppen': return { id: z.id, name: z.name, kv: z.kv, kostensatz: z.kostensatz, regiesatz: z.regiesatz };
    case 'geraete': return { id: z.id, code: z.code, name: z.name, gruppe: z.gruppe, kostensatz: z.kostensatz, verrechnungssatz: z.verrechnungssatz };
    case 'materialien': return { id: z.id, code: z.code, name: z.name, einheit: z.einheit, ek: z.ek, vk: z.vk };
    default: return { id: z.id, code: z.code, text: z.text, einheit: z.einheit, ep: z.ep };
  }
}

module.exports = function preisRouten(api, bt) {
  const { db } = bt;

  /** Eintrag + gueltigAb (Stand des heutigen Werts) + geplante Stände (API.md 12.2) */
  function mitStand(art, z, seit, plan) {
    const o = eintragJson(art, z);
    const ab = {};
    for (const f of ARTEN[art].felder) ab[f] = (seit.get(String(z.id)) || {})[f] || PV.BASIS_DATUM;
    o.gueltigAb = ab;
    o.geplant = plan.get(String(z.id)) || [];
    return o;
  }
  const liste = (art, sql) => {
    const seit = PV.gueltigSeit(db, art), plan = PV.geplant(db, art);
    return db.alle(sql).map((z) => mitStand(art, z, seit, plan));
  };

  api.get('/preise', brauche('preise_sehen'), (req, res) => {
    PV.abgleichen(db); // heute gültige Werte (falls seit dem letzten Lauf ein Stand in Kraft trat)
    res.json({
      lohngruppen: liste('lohngruppen', 'SELECT * FROM lohngruppe ORDER BY sortierung'),
      geraete: liste('geraete', 'SELECT * FROM geraet ORDER BY sortierung, id'),
      materialien: liste('materialien', 'SELECT * FROM material ORDER BY sortierung, id'),
      leistungen: liste('leistungen', 'SELECT * FROM leistung ORDER BY code')
    });
  });

  function ziel(req) {
    const art = req.params.art;
    const def = ARTEN[art];
    if (!def) throw ungueltig(`Unbekannte Preisart (erlaubt: ${Object.keys(ARTEN).join(', ')}).`);
    const id = def.idText
      ? (/^[a-z0-9_-]{1,20}$/i.test(req.params.id) ? req.params.id : (() => { throw ungueltig('ID ist ungültig.'); })())
      : v.pfadId(req.params.id);
    const alt = db.eins(`SELECT * FROM ${def.tabelle} WHERE id = ?`, id);
    if (!alt) throw nichtGefunden('Eintrag nicht gefunden.');
    return { art, def, id, alt };
  }

  api.put('/preise/:art/:id', brauche('preise_bearbeiten'), (req, res) => {
    const { art, def, id, alt } = ziel(req);
    const body = v.objekt(req.body);
    const feld = v.auswahl(body.feld, 'feld', def.felder);
    const wert = v.betrag(body.wert, 'wert', { min: 0, max: 1e6 });
    const g = PV.pruefeGueltigAb(db, body.gueltigAb, body.rueckwirkend);
    db.transaktion(() => {
      const r = PV.setzePreis(db, { art, ref: id, feld, wert, gueltigAb: g.gueltigAb, benutzerId: req.ctx.benutzer.id, jetzt: bt.uhr() });
      db.protokolliere({
        zeit: bt.uhr().toISOString(), benutzerId: req.ctx.benutzer.id, art: 'preis', objekt: `${art}:${id}`,
        alt: { [feld]: r.alt }, neu: { [feld]: wert, gueltigAb: g.gueltigAb, ...(g.rueckwirkend ? { rueckwirkend: true } : {}) },
        text: `Preis geändert: ${alt.name || alt.text} – ${feld} ab ${g.gueltigAb.split('-').reverse().join('.')}${g.rueckwirkend ? ' (rückwirkend)' : ''}`
      });
    });
    pruefeAlleBudgets(bt, { anlass: 'Preisänderung', benutzerId: req.ctx.benutzer.id });
    const seit = PV.gueltigSeit(db, art), plan = PV.geplant(db, art);
    res.json(mitStand(art, db.eins(`SELECT * FROM ${def.tabelle} WHERE id = ?`, id), seit, plan));
  });

  api.get('/preise/:art/:id/verlauf', brauche('preise_sehen'), (req, res) => {
    const { art, id } = ziel(req);
    res.json(PV.verlaufJson(db, art, id));
  });

  api.delete('/preise/:art/:id/verlauf/:vid', brauche('preise_bearbeiten'), (req, res) => {
    const { art, id, alt } = ziel(req);
    const s = PV.loescheStand(db, { art, ref: id, id: v.pfadId(req.params.vid, 'Stand-ID') });
    db.protokolliere({ zeit: bt.uhr().toISOString(), benutzerId: req.ctx.benutzer.id, art: 'preis', objekt: `${art}:${id}`, alt: { [s.feld]: s.wert, gueltigAb: s.gueltig_ab }, text: `Geplanten Preis gelöscht: ${alt.name || alt.text} – ${s.feld} ab ${s.gueltig_ab.split('-').reverse().join('.')}` });
    res.json({ ok: true });
  });
};
