'use strict';
/**
 * Arbeitszeitmodelle (API.md 15.23): Stammdaten der Firma. Lesen mit stammdaten, lohn oder benutzer (Zuordnung im
 * Benutzer-Dialog, Monatsauswertung), anlegen/ändern/deaktivieren/löschen nur mit dem Recht stammdaten – nie nach Rollenname.
 * Ein verwendetes Modell (je einer Person zugeordnet, auch über die Vorgabe nach der Rolle) wird nicht gelöscht, nur
 * deaktiviert; die beiden Vorgabe-Modelle bleiben immer aktiv. Ändert eine Bearbeitung die Rechenwerte eines verwendeten
 * Modells, gilt das auch für bereits gerechnete Tage – das muss ausdrücklich bestätigt werden (rueckwirkend:true).
 */
const v = require('../validierung');
const { nichtGefunden, konflikt, ApiFehler } = require('../fehler');
const { brauche } = require('./hilfe');
const AZ = require('../arbeitszeit');

module.exports = function arbeitszeitRouten(api, bt) {
  const { db } = bt;
  const jetzt = () => bt.uhr().toISOString();
  const zeile = (id) => {
    const z = db.eins('SELECT * FROM arbeitszeitmodell WHERE id = ?', id);
    if (!z) throw nichtGefunden('Arbeitszeitmodell nicht gefunden.');
    return z;
  };
  const namePruefen = (name, eigeneId = null) => {
    const x = db.eins('SELECT id FROM arbeitszeitmodell WHERE name = ? COLLATE NOCASE', name);
    if (x && x.id !== eigeneId) throw konflikt(`Ein Arbeitszeitmodell „${name}“ gibt es schon.`);
  };
  const prot = (req, objekt, text, alt, neu) => db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'arbeitszeitmodell', objekt, alt: alt ?? null, neu: neu ?? null, text });

  api.get('/arbeitszeitmodelle', brauche('stammdaten', 'lohn', 'benutzer'), (req, res) => {
    const mitInaktiven = req.query.inaktiv === '1';
    res.json(db.alle('SELECT * FROM arbeitszeitmodell ORDER BY sortierung, name').filter((z) => mitInaktiven || z.aktiv === 1).map((z) => AZ.json(db, z)));
  });

  api.post('/arbeitszeitmodelle', brauche('stammdaten'), (req, res) => {
    const f = AZ.pruefe(v.objekt(req.body));
    namePruefen(f.name);
    const max = db.eins('SELECT MAX(sortierung) AS m FROM arbeitszeitmodell').m || 0;
    const r = db.lauf('INSERT INTO arbeitszeitmodell (name, wochenstunden, tag_normal, regel, vollzeit, aktiv, sortierung, erstellt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      f.name, f.wochenstunden, f.tag_normal, f.regel, f.vollzeit, f.aktiv === 0 ? 0 : 1, max + 1, jetzt());
    const neu = zeile(r.id);
    prot(req, `arbeitszeitmodell:${r.id}`, `Arbeitszeitmodell „${f.name}“ angelegt`, null, AZ.json(db, neu, { mitVerwendung: false }));
    res.status(201).json(AZ.json(db, neu));
  });

  api.put('/arbeitszeitmodelle/:id', brauche('stammdaten'), (req, res) => {
    const alt = zeile(v.pfadId(req.params.id, 'Modell-ID'));
    const body = v.objekt(req.body);
    const version = v.zahl(body.version, 'version', { min: 1, ganz: true });
    if (version !== alt.version) throw konflikt('Das Arbeitszeitmodell wurde inzwischen geändert – bitte neu laden.', { version: alt.version });
    const f = AZ.pruefe(body, alt);
    if (!Object.keys(f).length) throw new ApiFehler(400, 'UNGUELTIG', 'Keine Änderungen angegeben.');
    if (f.name !== undefined) namePruefen(f.name, alt.id);
    if (f.aktiv === 0 && AZ.istVorgabe(alt.id)) throw konflikt(`„${alt.name}“ ist die Vorgabe für ${alt.id === AZ.VORGABE.feld ? 'Mitarbeiter und Poliere' : 'alle anderen Rollen'} und bleibt aktiv.`);
    const rechen = AZ.RECHENFELDER.filter((k) => f[k] !== undefined && f[k] !== alt[k]);
    const personen = AZ.verwendung(db, alt.id);
    if (rechen.length && personen > 0 && body.rueckwirkend !== true) {
      throw new ApiFehler(422, 'UNGUELTIG', `„${alt.name}“ gilt für ${personen} Person${personen === 1 ? '' : 'en'} – die Änderung wirkt auch auf bereits gerechnete Tage (Über- und Mehrstunden, Monatsauswertung, Export für die Lohnverrechnung). Bitte bestätigen (rueckwirkend:true) – oder ein neues Modell anlegen und den Personen mit Stichtag zuordnen.`, { personen });
    }
    const k = Object.keys(f);
    db.transaktion(() => {
      db.lauf(`UPDATE arbeitszeitmodell SET ${k.map((x) => `${x} = ?`).join(', ')}, version = version + 1, geaendert = ? WHERE id = ?`, ...k.map((x) => f[x]), jetzt(), alt.id);
      const neu = zeile(alt.id);
      const text = f.aktiv !== undefined && f.aktiv !== alt.aktiv && k.length === 1
        ? `Arbeitszeitmodell „${alt.name}“ ${f.aktiv ? 'wieder aktiviert' : 'deaktiviert'}`
        : `Arbeitszeitmodell „${alt.name}“ geändert${rechen.length && personen ? ` (rückwirkend für ${personen} Person${personen === 1 ? '' : 'en'})` : ''}`;
      prot(req, `arbeitszeitmodell:${alt.id}`, text, AZ.json(db, alt, { mitVerwendung: false }), AZ.json(db, neu, { mitVerwendung: false }));
    });
    res.json(AZ.json(db, zeile(alt.id)));
  });

  api.delete('/arbeitszeitmodelle/:id', brauche('stammdaten'), (req, res) => {
    const z = zeile(v.pfadId(req.params.id, 'Modell-ID'));
    AZ.pruefeLoeschen(db, z);
    db.transaktion(() => {
      db.lauf('DELETE FROM arbeitszeitmodell WHERE id = ?', z.id);
      prot(req, `arbeitszeitmodell:${z.id}`, `Arbeitszeitmodell „${z.name}“ gelöscht`, AZ.json(db, z, { mitVerwendung: false }), null);
    });
    res.json({ ok: true });
  });
};
