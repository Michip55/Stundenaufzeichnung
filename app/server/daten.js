'use strict';
/** Gemeinsame Lade-Funktionen (Datenbank → Objekte für Logik und Antworten). */
const { schichten, personalAusSchichten } = require('./stempel');
const { berechneKalkulation, kostenBericht } = require('./kalkulation');
const { wienZuDate, plusTage } = require('./datum');

function ladeBaustelle(db, id) {
  return db.eins('SELECT * FROM baustelle WHERE id = ?', id);
}

function ladeBenutzer(db, id) {
  return db.eins('SELECT id, name, rolle, lohngruppe_id, baustelle_id, pnr, aktiv FROM benutzer WHERE id = ?', id);
}

function parseJson(s, standard) {
  try { return s == null ? standard : JSON.parse(s); } catch (_) { return standard; }
}

function ladePreise(db) {
  const m = (rows) => new Map(rows.map((r) => [r.id, r]));
  return {
    lohngruppen: m(db.alle('SELECT id, name, kostensatz, regiesatz FROM lohngruppe')),
    geraete: m(db.alle('SELECT id, code, name, kostensatz, verrechnungssatz FROM geraet')),
    materialien: m(db.alle('SELECT id, code, name, einheit, ek, vk FROM material')),
    leistungen: m(db.alle('SELECT id, code, text, einheit, ep FROM leistung'))
  };
}

/** Kostenrelevante Berichtsdaten (alle Status) einer Baustelle */
function ladeBerichteFuerKalk(db, baustelleId) {
  const berichte = db.alle('SELECT id, datum, status FROM bericht WHERE baustelle_id = ? ORDER BY datum', baustelleId);
  if (!berichte.length) return [];
  const nachId = new Map(berichte.map((b) => [b.id, { ...b, personal: [], geraete: [], material: [], regie: [] }]));
  for (const p of db.alle(`SELECT bp.bericht_id, bp.stunden, bp.benutzer_id, b.lohngruppe_id FROM bericht_personal bp
      JOIN benutzer b ON b.id = bp.benutzer_id JOIN bericht r ON r.id = bp.bericht_id WHERE r.baustelle_id = ?`, baustelleId)) {
    nachId.get(p.bericht_id).personal.push({ benutzerId: p.benutzer_id, lohngruppeId: p.lohngruppe_id, stunden: p.stunden });
  }
  for (const g of db.alle('SELECT bg.* FROM bericht_geraet bg JOIN bericht r ON r.id = bg.bericht_id WHERE r.baustelle_id = ?', baustelleId)) {
    nachId.get(g.bericht_id).geraete.push({ geraetId: g.geraet_id, stunden: g.stunden });
  }
  for (const m of db.alle('SELECT bm.* FROM bericht_material bm JOIN bericht r ON r.id = bm.bericht_id WHERE r.baustelle_id = ?', baustelleId)) {
    nachId.get(m.bericht_id).material.push({ materialId: m.material_id, menge: m.menge });
  }
  for (const r of db.alle('SELECT rg.* FROM bericht_regie rg JOIN bericht r ON r.id = rg.bericht_id WHERE r.baustelle_id = ?', baustelleId)) {
    nachId.get(r.bericht_id).regie.push({ text: r.text, stunden: r.stunden });
  }
  return [...nachId.values()];
}

/** Nachkalkulation einer Baustelle (Rohdaten mit €-Werten – nur nach Rechteprüfung ausliefern!) */
function kalkulationFuer(db, bs, preise) {
  return berechneKalkulation({
    auftragssumme: bs.auftragssumme,
    nachtraege: db.alle('SELECT id, text, betrag FROM nachtrag WHERE baustelle_id = ? ORDER BY id', bs.id),
    schwellen: parseJson(bs.schwellen, [80, 90, 100]),
    preise: preise || ladePreise(db),
    berichte: ladeBerichteFuerKalk(db, bs.id),
    fremdleistungen: db.alle('SELECT id, text, betrag, datum FROM fremdleistung WHERE baustelle_id = ? ORDER BY datum, id', bs.id),
    leistungsmeldungen: db.alle('SELECT leistung_id AS leistungId, menge, datum FROM leistungsmeldung WHERE baustelle_id = ? ORDER BY datum, id', bs.id),
    regieLohngruppe: 'fa'
  });
}

/** Kosten eines Berichts (kostenTag) */
function kostenTagFuer(db, berichtId) {
  const personal = db.alle('SELECT bp.stunden, b.lohngruppe_id AS lohngruppeId FROM bericht_personal bp JOIN benutzer b ON b.id = bp.benutzer_id WHERE bp.bericht_id = ?', berichtId);
  const geraete = db.alle('SELECT geraet_id AS geraetId, stunden FROM bericht_geraet WHERE bericht_id = ?', berichtId);
  const material = db.alle('SELECT material_id AS materialId, menge FROM bericht_material WHERE bericht_id = ?', berichtId);
  return kostenBericht({ personal, geraete, material }, ladePreise(db));
}

/** Buchungen eines Benutzers im Zeitraum [von, bis) als Objekte für die Logik */
function ladeBuchungen(db, benutzerId, vonIso, bisIso) {
  return db.alle(`SELECT id, typ, zeit, baustelle_id AS baustelleId, quelle FROM buchung
    WHERE benutzer_id = ? AND zeit >= ? AND zeit < ? ORDER BY zeit, id`, benutzerId, vonIso, bisIso);
}

function letzteBuchungen(db, benutzerId, anzahl = 200) {
  return db.alle(`SELECT id, typ, zeit, baustelle_id AS baustelleId, quelle FROM buchung
    WHERE benutzer_id = ? ORDER BY zeit DESC, id DESC LIMIT ?`, benutzerId, anzahl).reverse();
}

/** Zeitfenster rund um einen Tag (Vortag 00:00 bis übermorgen 00:00 Wiener Zeit) */
function fensterUmTag(datum) {
  return { von: wienZuDate(plusTage(datum, -1)).toISOString(), bis: wienZuDate(plusTage(datum, 2)).toISOString() };
}

/** Schichten aller Benutzer, die an einem Tag begonnen haben → Map benutzerId → [Schicht] */
function schichtenAmTag(db, datum, jetzt, nurBenutzer) {
  const f = fensterUmTag(datum);
  const zeilen = db.alle(`SELECT benutzer_id, typ, zeit, baustelle_id AS baustelleId FROM buchung
    WHERE zeit >= ? AND zeit < ? ORDER BY benutzer_id, zeit, id`, f.von, f.bis);
  const proBenutzer = new Map();
  for (const z of zeilen) {
    if (nurBenutzer && !nurBenutzer.has(z.benutzer_id)) continue;
    if (!proBenutzer.has(z.benutzer_id)) proBenutzer.set(z.benutzer_id, []);
    proBenutzer.get(z.benutzer_id).push(z);
  }
  const out = new Map();
  for (const [id, b] of proBenutzer) {
    const s = schichten(b, jetzt).filter((x) => x.datum === datum);
    if (s.length) out.set(id, s);
  }
  return out;
}

/**
 * Personal-Vorschlag für einen Bericht: aus den Stempelungen des Tages auf dieser Baustelle
 * plus Abwesenheiten (Code) der dort eingeteilten Mitarbeiter.
 */
function personalVorschlag(db, baustelleId, datum, jetzt) {
  const bs = ladeBaustelle(db, baustelleId);
  const proBenutzer = schichtenAmTag(db, datum, jetzt);
  const zeilen = new Map();
  for (const [benutzerId, s] of proBenutzer) {
    const p = personalAusSchichten(s, baustelleId);
    if (p) zeilen.set(benutzerId, { benutzerId, ...p, code: null, segStunden: 0 });
  }
  const abw = db.alle(`SELECT a.benutzer_id, a.code FROM abwesenheit a JOIN benutzer b ON b.id = a.benutzer_id
    WHERE a.datum = ? AND (b.baustelle_id = ? OR b.id = ?)`, datum, baustelleId, bs ? bs.polier_id || -1 : -1);
  for (const a of abw) {
    if (zeilen.has(a.benutzer_id)) zeilen.get(a.benutzer_id).code = a.code;
    else zeilen.set(a.benutzer_id, { benutzerId: a.benutzer_id, von1: null, bis1: null, von2: null, bis2: null, pauseMin: 0, stunden: 0, code: a.code, segStunden: 0 });
  }
  const namen = new Map(db.alle('SELECT id, name, rolle FROM benutzer').map((b) => [b.id, b]));
  const rang = (id) => (bs && id === bs.polier_id ? 0 : namen.get(id) && namen.get(id).rolle === 'polier' ? 1 : 2);
  return [...zeilen.values()]
    .map((z) => ({ ...z, name: (namen.get(z.benutzerId) || {}).name || '?' }))
    .sort((a, b) => rang(a.benutzerId) - rang(b.benutzerId) || a.name.localeCompare(b.name, 'de'));
}

module.exports = {
  ladeBaustelle, ladeBenutzer, parseJson, ladePreise, ladeBerichteFuerKalk, kalkulationFuer, kostenTagFuer,
  ladeBuchungen, letzteBuchungen, fensterUmTag, schichtenAmTag, personalVorschlag
};
