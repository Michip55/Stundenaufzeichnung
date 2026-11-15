'use strict';
/**
 * Lohngruppe stichtaggenau (API.md 12.22): Verlauf je Person in `benutzer_lohngruppe`.
 * Gültig an Tag D ist der Eintrag mit dem größten gueltig_ab ≤ D (bei gleichem Datum der jüngste).
 * Ohne Verlaufszeilen gilt `benutzer.lohngruppe_id` seit BASIS. `benutzer.lohngruppe_id` zeigt immer den
 * heute gültigen Stand (abgleichen).
 */
const { wienDatum, plusTage } = require('./datum');
const { ungueltig, ApiFehler } = require('./fehler');

const BASIS = '2000-01-01';

/** SQL-Ausdruck: Lohngruppe der Person (Tabellen-Alias `b`) am Datum (SQL-Ausdruck `d`) */
function lgAm(b, d) {
  return `(CASE WHEN EXISTS (SELECT 1 FROM benutzer_lohngruppe lv0 WHERE lv0.benutzer_id = ${b}.id)
    THEN (SELECT lv.lohngruppe_id FROM benutzer_lohngruppe lv WHERE lv.benutzer_id = ${b}.id AND lv.gueltig_ab <= ${d} ORDER BY lv.gueltig_ab DESC, lv.id DESC LIMIT 1)
    ELSE ${b}.lohngruppe_id END)`;
}

/** Verlauf roh (aufsteigend); ohne Zeilen ein Basisstand aus benutzer.lohngruppe_id (id null) */
function verlaufRoh(db, benutzerId) {
  const z = db.alle('SELECT * FROM benutzer_lohngruppe WHERE benutzer_id = ? ORDER BY gueltig_ab, id', benutzerId);
  if (z.length) return z;
  const b = db.eins('SELECT lohngruppe_id FROM benutzer WHERE id = ?', benutzerId);
  return b && b.lohngruppe_id ? [{ id: null, benutzer_id: benutzerId, lohngruppe_id: b.lohngruppe_id, gueltig_ab: BASIS, erstellt: null, erstellt_von: null }] : [];
}

/** Funktion datum → lohngruppeId|null für eine Person (für Schleifen über Tage) */
function zeitachse(db, benutzerId) {
  const z = verlaufRoh(db, benutzerId);
  return (d) => {
    let lg = null;
    for (const x of z) { if (x.gueltig_ab <= d) lg = x.lohngruppe_id; else break; }
    return lg;
  };
}

const lohngruppeAm = (db, benutzerId, d) => zeitachse(db, benutzerId)(d);

/** Verlauf als JSON (12.22) */
function verlaufJson(db, benutzerId, heute) {
  const z = verlaufRoh(db, benutzerId);
  const namen = new Map(db.alle('SELECT id, name FROM lohngruppe').map((x) => [x.id, x.name]));
  const pers = new Map(db.alle('SELECT id, name FROM benutzer').map((x) => [x.id, x.name]));
  let aktuellIdx = -1;
  z.forEach((x, i) => { if (x.gueltig_ab <= heute) aktuellIdx = i; });
  return z.map((x, i) => ({
    id: x.id, lohngruppeId: x.lohngruppe_id, name: x.lohngruppe_id ? namen.get(x.lohngruppe_id) || x.lohngruppe_id : null,
    gueltigAb: x.gueltig_ab, erstellt: x.erstellt, erstelltVon: x.erstellt_von ? { id: x.erstellt_von, name: pers.get(x.erstellt_von) || '?' } : null,
    aktuell: i === aktuellIdx, kuenftig: x.gueltig_ab > heute
  }));
}

/** N-081: strenge Prüfung (Rückwandlung) – Date.parse nimmt auch 2026-11-31 oder 2026-02-30 an */
function kalenderDatum(d) {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const [y, m, t] = d.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, t));
  return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === t;
}

/** gueltigAb prüfen (Standard heute; rückwirkend nur mit Bestätigung) */
function pruefeGueltigAb(gueltigAb, rueckwirkend, heute) {
  const d = gueltigAb === undefined || gueltigAb === null || gueltigAb === '' ? heute : gueltigAb;
  if (!kalenderDatum(d)) throw ungueltig('lohngruppeGueltigAb muss ein gültiges Datum JJJJ-MM-TT sein.');
  if (d < BASIS) throw ungueltig('lohngruppeGueltigAb darf nicht vor dem 01.01.2000 liegen.');
  if (d > plusTage(heute, 731)) throw ungueltig('lohngruppeGueltigAb darf höchstens 2 Jahre in der Zukunft liegen.');
  if (d < heute && rueckwirkend !== true) {
    throw new ApiFehler(422, 'UNGUELTIG', `Die Lohngruppe soll rückwirkend ab ${d.split('-').reverse().join('.')} gelten – das ändert bereits gerechnete Tage (Kosten, Nachkalkulation, Lohn-Export). Bitte bestätigen (lohngruppeRueckwirkend:true).`);
  }
  return d;
}

/**
 * Verlaufseintrag setzen (gleiches Datum ersetzt). Legt beim ersten Eintrag den bisherigen Wert als
 * Basisstand an. Aufruf innerhalb einer Transaktion. → {alt, neu, gueltigAb, ersetzt}
 */
function setzen(db, { benutzerId, lohngruppeId, gueltigAb, von, zeit, explizit }) {
  const hat = db.eins('SELECT COUNT(*) AS n FROM benutzer_lohngruppe WHERE benutzer_id = ?', benutzerId).n;
  const b = db.eins('SELECT lohngruppe_id FROM benutzer WHERE id = ?', benutzerId);
  let d = gueltigAb;
  if (!hat) {
    if (b.lohngruppe_id) db.lauf('INSERT INTO benutzer_lohngruppe (benutzer_id, lohngruppe_id, gueltig_ab, erstellt, erstellt_von) VALUES (?, ?, ?, ?, NULL)', benutzerId, b.lohngruppe_id, BASIS, zeit);
    else if (!explizit) d = BASIS; // erste Zuordnung ohne Datum gilt von Anfang an
  }
  const alt = lohngruppeAm(db, benutzerId, d);
  const gleich = db.eins('SELECT * FROM benutzer_lohngruppe WHERE benutzer_id = ? AND gueltig_ab = ? ORDER BY id DESC LIMIT 1', benutzerId, d);
  if (gleich) db.lauf('UPDATE benutzer_lohngruppe SET lohngruppe_id = ?, erstellt = ?, erstellt_von = ? WHERE id = ?', lohngruppeId, zeit, von, gleich.id);
  else db.lauf('INSERT INTO benutzer_lohngruppe (benutzer_id, lohngruppe_id, gueltig_ab, erstellt, erstellt_von) VALUES (?, ?, ?, ?, ?)', benutzerId, lohngruppeId, d, zeit, von);
  return { alt, neu: lohngruppeId, gueltigAb: d, ersetzt: gleich ? gleich.lohngruppe_id : undefined };
}

/** benutzer.lohngruppe_id = heute gültige Lohngruppe → Liste geänderter Personen-IDs */
function abgleichen(db, heute, nurBenutzerId = null) {
  const geaendert = [];
  const ids = nurBenutzerId != null ? [nurBenutzerId] : db.alle('SELECT DISTINCT benutzer_id AS id FROM benutzer_lohngruppe').map((x) => x.id);
  for (const id of ids) {
    if (!db.eins('SELECT 1 AS x FROM benutzer_lohngruppe WHERE benutzer_id = ? LIMIT 1', id)) continue;
    const lg = lohngruppeAm(db, id, heute);
    const b = db.eins('SELECT lohngruppe_id FROM benutzer WHERE id = ?', id);
    if (b && (b.lohngruppe_id ?? null) !== (lg ?? null)) { db.lauf('UPDATE benutzer SET lohngruppe_id = ? WHERE id = ?', lg, id); geaendert.push(id); }
  }
  return geaendert;
}

/** Baustellen, auf denen die Person ab `ab` Berichtsstunden hat (für die Budget-Prüfung) */
function betroffeneBaustellen(db, benutzerId, ab) {
  return db.alle(`SELECT DISTINCT r.baustelle_id AS id FROM bericht_personal bp JOIN bericht r ON r.id = bp.bericht_id
    WHERE bp.benutzer_id = ? AND r.datum >= ?`, benutzerId, ab).map((x) => x.id);
}

/** Stündlicher Lauf: Abgleich; tritt ein Eintrag in Kraft → Budgets einmal am Tag prüfen */
function tagesLauf(bt) {
  const { db } = bt;
  const heute = wienDatum(bt.uhr());
  abgleichen(db, heute);
  const zuletzt = db.einstellung('lohngruppen_tag', null);
  if (zuletzt === heute) return;
  db.setzeEinstellung('lohngruppen_tag', heute);
  if (!zuletzt) return;
  const neu = db.alle('SELECT DISTINCT benutzer_id AS id, MIN(gueltig_ab) AS ab FROM benutzer_lohngruppe WHERE gueltig_ab > ? AND gueltig_ab <= ? GROUP BY benutzer_id', zuletzt, heute);
  const B = require('./budget');
  const bs = new Set(neu.flatMap((x) => betroffeneBaustellen(db, x.id, x.ab)));
  for (const id of bs) B.pruefeBudget(bt, id, { anlass: 'Lohngruppenwechsel tritt in Kraft' });
}

module.exports = { BASIS, lgAm, verlaufRoh, zeitachse, lohngruppeAm, verlaufJson, pruefeGueltigAb, setzen, abgleichen, betroffeneBaustellen, tagesLauf };
