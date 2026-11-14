'use strict';
/**
 * Benachrichtigungen – EINE Stelle für Erstellen, Empfänger und Sichtbarkeit (API.md 15.3).
 *
 * - Jede Benachrichtigung speichert die Rechte, die zum Sehen nötig sind (`erfordert`, JSON-Liste).
 *   Ein Eintrag ist ein Recht (`"preise_sehen"`) oder eine Auswahl (`"lohn|stammdaten"` = eines genügt);
 *   alle Einträge müssen erfüllt sein. `[]` = nur für den Empfänger selbst bestimmt (z. B. „Ihr Antrag …“).
 * - Beim Erstellen wird `erfordert` aus Typ und Schlüssel abgeleitet (`erfordertFuer`); Aufrufer können
 *   zusätzliche Rechte angeben (Vereinigung, nie weniger).
 * - Bei JEDEM Lesen (Liste, Gelesen-Markieren, Push-Versand) zählen die AKTUELLEN Rechte des Empfängers.
 *   Nicht erfüllte Einträge werden ausgeblendet, nicht gelöscht – kommt das Recht zurück, sind sie wieder da.
 * - Empfänger werden über Rechte bestimmt, nie über Rollennamen (`empfaengerMitRecht`). Bauleiter = Büro.
 */
const R = require('./rechte');

/** Prüft einen Eintrag (`recht` oder `recht1|recht2`) – unbekannte Rechte sind nie erfüllt */
function eintragGueltig(e) {
  return typeof e === 'string' && e.length > 0 && e.split('|').every((r) => R.RECHT_SCHLUESSEL.includes(r));
}

/** Normalisiert eine erfordert-Liste (eindeutig, sortiert); wirft bei unbekannten Rechten */
function normiere(liste) {
  const out = new Set();
  for (const e of liste || []) {
    if (!eintragGueltig(e)) throw new Error(`Benachrichtigung: unbekanntes Recht in erfordert: ${JSON.stringify(e)}`);
    out.add(e.split('|').sort().join('|'));
  }
  return [...out].sort();
}

/* ---------- Ableitung aus Typ und Schlüssel ---------- */

const KALK = ['kalk_sehen'];
const PREISE = ['preise_sehen'];
const STAMM = ['stammdaten'];
const ABW_FREMD = ['lohn|stammdaten']; // fremde Abwesenheiten/Anträge: wer entscheidet (13.2)
const LOHN = ['lohn']; // AZG-Daten anderer Personen (Lohnverrechnung)
const GF = ['benutzer']; // nur Geschäftsführung (Recht „Benutzer und Rechte verwalten“)
const KEINE = [];

/** Benachrichtigungen an die betroffene Person selbst (Abwesenheiten) */
const ABW_EIGEN = [/^abw:.*:(genehmigt|abgelehnt):/, /^abw:.*:weg(:|$)/, /^sw:[^:]+:(bestaetigt|person)$/];

/**
 * Rechte, die zum Sehen einer Benachrichtigung nötig sind – aus Typ und Schlüssel.
 * Muss mit der Rückfüllung in Migration 39 (server/schema.js) übereinstimmen (Test tests/api/benachrichtigung-rechte.test.js).
 * Unbekanntes wird streng behandelt (lieber ausgeblendet als offengelegt).
 * @param {{typ:string, schluessel?:string|null, benutzerId?:number}} n
 * @returns {string[]}
 */
function erfordertFuer({ typ, schluessel, benutzerId }) {
  const s = String(schluessel || '');
  switch (typ) {
    case 'budget': return KALK;
    case 'rechnung': return PREISE; // Rechnungsnummern, Mahnstufen
    case 'email': return STAMM; // Versandfehler (Adresse des Auftraggebers)
    case 'urlaub': return ABW_FREMD; // „Antrag offen: <Person>“
    case 'azg': return benutzerId != null && s.startsWith(`azg:${benutzerId}:`) ? KEINE : LOHN;
    case 'abwesenheit': return ABW_EIGEN.some((re) => re.test(s)) ? KEINE : ABW_FREMD;
    case 'baustelle':
      if (/^bv:(sr|bg|hr):/.test(s)) return PREISE; // Schlussrechnung, Bankgarantie, Haftrücklass
      return STAMM; // Gewährleistung, Fertigmeldung
    case 'bericht': return ['bericht_freigeben']; // „Bericht zur Freigabe“
    case 'plan':
      if (/^(plan:erinnerung|plan:anfrage|fuhre:pruefen):/.test(s)) return STAMM; // an die Planer
      return KEINE; // eigene Einsätze, Partie-Meldung, eigene Anfrage erledigt
    case 'sicherheit':
      if (s.startsWith('konto:')) return ['benutzer|stammdaten']; // entsperren
      if (s.startsWith('rolle:') || s.startsWith('sicherung:')) return GF;
      return KEINE; // eigene 2FA-Meldungen
    case 'fuhrpark':
      if (/^fp:(woche|unplausibel|gesperrt-genutzt):/.test(s)) return ['fuhrpark'];
      return KEINE; // gemischte Empfänger: Aufrufer geben erfordert je Empfänger an
    default: return STAMM;
  }
}

/** Gespeicherte erfordert-Liste lesen; NULL (Altbestand ohne Rückfüllung) → ableiten; Unlesbares → nie sichtbar */
function erfordertVon(n) {
  if (n.erfordert == null) return erfordertFuer({ typ: n.typ, schluessel: n.schluessel, benutzerId: n.benutzer_id });
  try {
    const l = JSON.parse(n.erfordert);
    if (Array.isArray(l) && l.every(eintragGueltig)) return l;
  } catch (_) { /* unten */ }
  return null;
}

/** Erfüllt die Rechtemenge die Liste? */
function erfuellt(rechte, liste) {
  if (!Array.isArray(liste)) return false;
  return liste.every((e) => e.split('|').some((r) => rechte.has(r)));
}

/**
 * Darf ctx diese Benachrichtigung JETZT sehen? (eigene + aktuelle Rechte + aktives Konto)
 * @param {{benutzer:object, rechte:Set<string>}} ctx
 */
function darfSehen(ctx, n) {
  if (!ctx || !ctx.benutzer || !n || n.benutzer_id !== ctx.benutzer.id) return false;
  if (ctx.benutzer.aktiv === 0) return false;
  return erfuellt(ctx.rechte, erfordertVon(n));
}

/** Kontext mit den aktuellen Rechten eines Benutzers (frisch aus der Datenbank) */
function aktuellerKontext(db, benutzerId) {
  const b = db.eins('SELECT * FROM benutzer WHERE id = ?', benutzerId);
  return b ? R.kontext(db, b) : null;
}

/* ---------- Empfänger über Rechte ---------- */

/**
 * Aktive Benutzer, die das Recht haben (`"stammdaten"` oder Auswahl `"stammdaten|lohn"`, auch als Liste = alle nötig).
 * Bauleiter = Büro: entscheidend sind allein die effektiven Rechte (Matrix ∪ Ausnahmen − Sperren).
 * @param {object} db
 * @param {string|string[]} recht
 * @param {{baustelleId?:number, ohne?:number|number[]}} opt  baustelleId: nur Benutzer, deren Bereich die Baustelle umfasst
 * @returns {object[]} Benutzer-Zeilen (nach id)
 */
function empfaengerMitRecht(db, recht, { baustelleId = null, ohne = [] } = {}) {
  const liste = normiere(Array.isArray(recht) ? recht : [recht]);
  const aus = new Set((Array.isArray(ohne) ? ohne : [ohne]).filter((x) => x != null).map(Number));
  const bs = baustelleId != null ? db.eins('SELECT * FROM baustelle WHERE id = ?', baustelleId) : null;
  return db.alle('SELECT * FROM benutzer WHERE aktiv = 1 ORDER BY id').filter((b) => {
    if (aus.has(b.id)) return false;
    if (!erfuellt(R.ladeRechteFuer(db, b), liste)) return false;
    return baustelleId == null || R.baustelleImBereich(b, bs);
  });
}

/* ---------- Erstellen ---------- */

/**
 * Legt eine Benachrichtigung an (je Empfänger und Schlüssel einmal).
 * @param {object} db
 * @param {{benutzerId:number, typ:string, titel:string, text:string, zeit:string, baustelleId?:number|null,
 *   anlageId?:number|null, schluessel?:string|null, erfordert?:string[]}} n  erfordert: zusätzliche Rechte (zur Ableitung hinzu)
 * @returns {boolean} neu angelegt?
 */
function benachrichtige(db, { benutzerId, typ, titel, text, zeit, baustelleId = null, anlageId = null, schluessel = null, erfordert = [] }) {
  const liste = normiere([...erfordertFuer({ typ, schluessel, benutzerId }), ...erfordert]);
  return db.lauf(`INSERT INTO benachrichtigung (benutzer_id, typ, titel, text, zeit, gelesen, baustelle_id, schluessel, anlage_id, erfordert)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?) ON CONFLICT(benutzer_id, schluessel) DO NOTHING`,
  benutzerId, typ, titel, text, zeit, baustelleId, schluessel, anlageId, JSON.stringify(liste)).changes > 0;
}

module.exports = { erfordertFuer, erfordertVon, erfuellt, darfSehen, aktuellerKontext, empfaengerMitRecht, benachrichtige, normiere };
