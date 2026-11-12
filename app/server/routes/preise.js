'use strict';
const v = require('../validierung');
const { ungueltig, nichtGefunden } = require('../fehler');
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

  api.get('/preise', brauche('preise_sehen'), (req, res) => {
    res.json({
      lohngruppen: db.alle('SELECT * FROM lohngruppe ORDER BY sortierung').map((z) => eintragJson('lohngruppen', z)),
      geraete: db.alle('SELECT * FROM geraet ORDER BY sortierung, id').map((z) => eintragJson('geraete', z)),
      materialien: db.alle('SELECT * FROM material ORDER BY sortierung, id').map((z) => eintragJson('materialien', z)),
      leistungen: db.alle('SELECT * FROM leistung ORDER BY code').map((z) => eintragJson('leistungen', z))
    });
  });

  api.put('/preise/:art/:id', brauche('preise_bearbeiten'), (req, res) => {
    const art = req.params.art;
    const def = ARTEN[art];
    if (!def) throw ungueltig(`Unbekannte Preisart (erlaubt: ${Object.keys(ARTEN).join(', ')}).`);
    const id = def.idText
      ? (/^[a-z0-9_-]{1,20}$/i.test(req.params.id) ? req.params.id : (() => { throw ungueltig('ID ist ungültig.'); })())
      : v.pfadId(req.params.id);
    const body = v.objekt(req.body);
    const feld = v.auswahl(body.feld, 'feld', def.felder);
    const wert = v.betrag(body.wert, 'wert', { min: 0, max: 1e6 });
    const alt = db.eins(`SELECT * FROM ${def.tabelle} WHERE id = ?`, id);
    if (!alt) throw nichtGefunden('Eintrag nicht gefunden.');
    db.transaktion(() => {
      db.lauf(`UPDATE ${def.tabelle} SET ${feld} = ? WHERE id = ?`, wert, id);
      db.protokolliere({
        zeit: bt.uhr().toISOString(), benutzerId: req.ctx.benutzer.id, art: 'preis', objekt: `${art}:${id}`,
        alt: { [feld]: alt[feld] }, neu: { [feld]: wert }, text: `Preis geändert: ${alt.name || alt.text} – ${feld}`
      });
    });
    pruefeAlleBudgets(bt, { anlass: 'Preisänderung', benutzerId: req.ctx.benutzer.id });
    res.json(eintragJson(art, db.eins(`SELECT * FROM ${def.tabelle} WHERE id = ?`, id)));
  });
};
