'use strict';
/**
 * Interne Kostenstellen (API.md 12.25): z. B. „Büro“ (KST 9000), „Werkstatt/Bauhof“ (9100), „Kieswerk/Grube“ (9200).
 * Kennzeichen baustelle.intern = 1. Stempeln erlaubt (zählt in Monat/Lohn/BUAK/AZG), ausgeschlossen von Nachkalkulation,
 * Positionen, Budget, Auftragssumme, Rechnungen, Phasen/Archiv, Zeitplan, Planer, Fuhren-Zielen, Wetter, Bericht, Dokumenten.
 */
const { ApiFehler } = require('./fehler');

const BUERO_KST = '9000';
const STANDARD_INTERN = [
  { kst: '9000', name: 'Büro', kurz: 'Büro' },
  { kst: '9100', name: 'Werkstatt/Bauhof', kurz: 'Werkstatt' },
  { kst: '9200', name: 'Kieswerk/Grube', kurz: 'Grube' }
];

/** Legt fehlende interne Kostenstellen an (nur gegebene KST); idempotent → angelegte IDs */
function anlegen(db, liste, zeit) {
  const neu = [];
  for (const k of liste) {
    if (db.eins('SELECT id FROM baustelle WHERE kst = ?', k.kst)) continue;
    const spalten = db.alle('PRAGMA table_info(baustelle)').map((x) => x.name);
    const f = { kst: k.kst, name: k.name, kurz: k.kurz, intern: 1, status: 'aktiv', auftraggeber: 'intern', adresse: '' };
    if (spalten.includes('phase')) f.phase = 'in_arbeit';
    if (spalten.includes('erstellt')) f.erstellt = zeit;
    const ks = Object.keys(f).filter((x) => spalten.includes(x));
    neu.push(db.lauf(`INSERT INTO baustelle (${ks.join(', ')}) VALUES (${ks.map(() => '?').join(', ')})`, ...ks.map((x) => f[x])).id);
  }
  return neu;
}

/** „Büro“-Kostenstelle (KST 9000) sicherstellen → id */
function bueroSicherstellen(db, zeit = new Date().toISOString()) {
  anlegen(db, [STANDARD_INTERN[0]], zeit);
  const b = db.eins("SELECT id FROM baustelle WHERE kst = ? AND intern = 1", BUERO_KST) || db.eins("SELECT id FROM baustelle WHERE intern = 1 AND name = 'Büro'");
  return b ? b.id : null;
}

/** Standard-Kostenstelle einer Person: eigene Einstellung; Büro/Bauleiter/GF → „Büro“; sonst Stamm-Baustelle */
function standardFuer(db, benutzer) {
  const b = db.eins('SELECT id, rolle, baustelle_id, standard_kostenstelle_id FROM benutzer WHERE id = ?', benutzer.id || benutzer);
  if (!b) return null;
  if (b.standard_kostenstelle_id) return b.standard_kostenstelle_id;
  if (['buero', 'bauleiter', 'gf'].includes(b.rolle)) {
    const bu = db.eins("SELECT id FROM baustelle WHERE intern = 1 AND kst = ?", BUERO_KST);
    if (bu) return bu.id;
  }
  return b.baustelle_id || null;
}

const istIntern = (bs) => Boolean(bs && bs.intern);
/** Fachfunktion nur für echte Baustellen → 422 bei interner Kostenstelle */
function nurBaustelle(bs, was) {
  if (istIntern(bs)) throw new ApiFehler(422, 'UNGUELTIG', `${bs.kst} ${bs.name} ist eine interne Kostenstelle – ${was} gibt es nur für Baustellen.`);
}

module.exports = { BUERO_KST, STANDARD_INTERN, anlegen, bueroSicherstellen, standardFuer, istIntern, nurBaustelle };
