'use strict';
/**
 * Interne Kostenstellen (API.md 12.25): „Büro“ (KST 90-000), „Werkstatt/Bauhof“ (90-100), „Kieswerk/Grube“ (90-001) – Format NN-NNN wie jede KST.
 * Kennzeichen baustelle.intern = 1. Stempeln erlaubt (zählt in Monat/Lohn/BUAK/AZG), ausgeschlossen von Nachkalkulation,
 * Positionen, Budget, Auftragssumme, Rechnungen, Phasen/Archiv, Zeitplan, Planer, Fuhren-Zielen, Wetter, Bericht, Dokumenten.
 */
const { ApiFehler } = require('./fehler');

const BUERO_KST = '90-000';
/** Frühere Codes der Demo-Datenbanken (vor Migration 29) */
const ALT_KST = { '9000': '90-000', '9100': '90-100' };
const STANDARD_INTERN = [
  { kst: '90-000', name: 'Büro', kurz: 'Büro' },
  { kst: '90-100', name: 'Werkstatt/Bauhof', kurz: 'Werkstatt' },
  { kst: '90-001', name: 'Kieswerk/Grube', kurz: 'Grube' }
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

/** „Büro“-Kostenstelle (KST 90-000) sicherstellen → id (eine nicht umbenannte alte „9000“ gilt weiter als Büro) */
function bueroSicherstellen(db, zeit = new Date().toISOString()) {
  const vorhanden = db.eins("SELECT id FROM baustelle WHERE intern = 1 AND kst IN (?, '9000') ORDER BY kst = ? DESC", BUERO_KST, BUERO_KST);
  if (vorhanden) return vorhanden.id;
  anlegen(db, [STANDARD_INTERN[0]], zeit); // legt nichts an, wenn 90-000 schon (als echte Baustelle) vergeben ist
  const b = db.eins('SELECT id FROM baustelle WHERE kst = ? AND intern = 1', BUERO_KST) || db.eins("SELECT id FROM baustelle WHERE intern = 1 AND name = 'Büro'");
  return b ? b.id : null;
}

/** Standard-Kostenstelle einer Person: eigene Einstellung; Büro/Bauleiter/GF → „Büro“; sonst Stamm-Baustelle */
function standardFuer(db, benutzer) {
  const b = db.eins('SELECT id, rolle, baustelle_id, standard_kostenstelle_id FROM benutzer WHERE id = ?', benutzer.id || benutzer);
  if (!b) return null;
  if (b.standard_kostenstelle_id) return b.standard_kostenstelle_id;
  if (['buero', 'bauleiter', 'gf'].includes(b.rolle)) {
    const bu = db.eins("SELECT id FROM baustelle WHERE intern = 1 AND kst = ?", BUERO_KST) || db.eins("SELECT id FROM baustelle WHERE intern = 1 AND kst = '9000'");
    if (bu) return bu.id;
  }
  return b.baustelle_id || null;
}

const istIntern = (bs) => Boolean(bs && bs.intern);
/** Nicht umbenannte alte Codes (Migration 29 hat sie wegen belegter Ziel-KST stehen gelassen) → Warntexte */
function altCodesOffen(db) {
  return Object.entries(ALT_KST).filter(([alt]) => db.eins('SELECT 1 AS x FROM baustelle WHERE kst = ? AND intern = 1', alt))
    .map(([alt, neu]) => `Interne Kostenstelle „${alt}“ wurde nicht auf „${neu}“ umbenannt, weil „${neu}“ schon vergeben ist – bitte im Büro prüfen (Stammdaten → Baustellen).`);
}

/** Fachfunktion nur für echte Baustellen → 422 bei interner Kostenstelle */
function nurBaustelle(bs, was) {
  if (istIntern(bs)) throw new ApiFehler(422, 'UNGUELTIG', `${bs.kst} ${bs.name} ist eine interne Kostenstelle – ${was} gibt es nur für Baustellen.`);
}

module.exports = { BUERO_KST, ALT_KST, STANDARD_INTERN, altCodesOffen, anlegen, bueroSicherstellen, standardFuer, istIntern, nurBaustelle };
