'use strict';
/**
 * Rollen, Rechte-Matrix, gesperrte Rechte, Ausnahmen, Bereichs-Prüfung (eigene Baustellen)
 * und Entfernen von €-Feldern. Rechte werden ausschließlich am Server durchgesetzt.
 */

const ROLLEN = ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf'];
/** Rollen mit Büro-Umfang (alle Baustellen); Bauleiter seit 13.11.2026 „in allem wie Büro“ */
const BUERO_ROLLEN = ['buero', 'bauleiter', 'gf'];
const ROLLEN_NAMEN = {
  mitarbeiter: 'Mitarbeiter', polier: 'Polier / Vorarbeiter', bauleiter: 'Bauleiter',
  buero: 'Büro / Lohnverrechnung', gf: 'Geschäftsführung'
};

const RECHTE = [
  { schluessel: 'zeit_eigen', text: 'Eigene Zeiten stempeln und sehen' },
  { schluessel: 'kolonne', text: 'Kolonne (Partie) stempeln' },
  { schluessel: 'bericht_erstellen', text: 'Bautagesbericht erstellen' },
  { schluessel: 'bericht_freigeben', text: 'Bautagesbericht freigeben' },
  { schluessel: 'preise_sehen', text: 'Preise und €-Werte sehen' },
  { schluessel: 'preise_bearbeiten', text: 'Preise, Auftragssumme und Nachträge bearbeiten' },
  { schluessel: 'kalk_sehen', text: 'Nachkalkulation und Budget sehen' },
  { schluessel: 'lohn', text: 'Monatsauswertung und Lohn-/BUAK-Export' },
  { schluessel: 'stammdaten', text: 'Stammdaten pflegen (Baustellen, Mitarbeiter, Abwesenheiten)' },
  { schluessel: 'benutzer', text: 'Benutzer und Rechte verwalten' },
  { schluessel: 'fuhrpark', text: 'Fuhrpark und Servicebuch pflegen' }
];
const RECHT_SCHLUESSEL = RECHTE.map((r) => r.schluessel);

const STANDARD_MATRIX = {
  mitarbeiter: { zeit_eigen: true },
  polier: { zeit_eigen: true, kolonne: true, bericht_erstellen: true },
  // Inhaber 13.11.2026: „Bauleiter ist eigentlich Büro … in allem wie Büro“ → gleiche Standardrechte wie Büro
  bauleiter: { zeit_eigen: true, bericht_erstellen: true, bericht_freigeben: true, preise_sehen: true, preise_bearbeiten: true, kalk_sehen: true, lohn: true, stammdaten: true, fuhrpark: true },
  buero: { zeit_eigen: true, bericht_erstellen: true, bericht_freigeben: true, preise_sehen: true, preise_bearbeiten: true, kalk_sehen: true, lohn: true, stammdaten: true, fuhrpark: true },
  gf: { zeit_eigen: true, kolonne: true, bericht_erstellen: true, bericht_freigeben: true, preise_sehen: true, preise_bearbeiten: true, kalk_sehen: true, lohn: true, stammdaten: true, benutzer: true, fuhrpark: true }
};

/** Für diese Rollen technisch gesperrt – weder per Matrix noch per Ausnahme vergebbar. */
const PREIS_LOHN_RECHTE = ['preise_sehen', 'preise_bearbeiten', 'kalk_sehen', 'lohn'];
const GESPERRT = {
  // Polier/Mitarbeiter: nie Preise/Kalkulation/Lohn, keine Stammdaten, keine Benutzerverwaltung
  mitarbeiter: [...PREIS_LOHN_RECHTE, 'stammdaten', 'benutzer'],
  polier: [...PREIS_LOHN_RECHTE, 'stammdaten', 'benutzer'],
  // Bauleiter wie Büro (13.11.2026): nur „Rollen und Ausnahmen vergeben“ bleibt der Geschäftsführung
  bauleiter: ['benutzer'],
  // „Rollen und Ausnahmen vergeben“ nur Geschäftsführung
  buero: ['benutzer'],
  gf: []
};
/** Rechte, die einer Rolle nie entzogen werden können */
const IMMER = { gf: ['benutzer'] };

const istGesperrt = (rolle, recht) => (GESPERRT[rolle] || []).includes(recht);
const istImmer = (rolle, recht) => (IMMER[rolle] || []).includes(recht);

/**
 * Effektive Rechte = Matrix der Rolle ∪ Ausnahmen, ohne gesperrte, plus feste Rechte.
 * @param {string} rolle
 * @param {Object<string,boolean>} matrixRolle
 * @param {string[]} ausnahmen
 * @returns {Set<string>}
 */
function effektiveRechte(rolle, matrixRolle, ausnahmen = []) {
  const s = new Set();
  for (const r of RECHT_SCHLUESSEL) {
    let v = Boolean(matrixRolle && matrixRolle[r]) || ausnahmen.includes(r);
    if (istGesperrt(rolle, r)) v = false;
    if (istImmer(rolle, r)) v = true;
    if (v) s.add(r);
  }
  return s;
}

/**
 * Bereich: alle Baustellen | eigene Partie. Büro, Bauleiter und GF gleich (13.1); `bauleiter_id` begrenzt nichts mehr
 * (15.4 – es bestimmt nur Empfänger von Benachrichtigungen). Was jemand im Bereich darf, entscheiden allein die Rechte.
 * Unbekannte Rollen (z. B. interne Kontexte) bleiben streng auf „partie“.
 */
function bereich(benutzer) {
  return BUERO_ROLLEN.includes(benutzer.rolle) ? 'alle' : 'partie'; // rolle-ok: Umfang (Büro = Bauleiter = GF), keine Rechtevergabe
}

/** Liegt die Baustelle im Bereich des Benutzers (eigene Baustellen)? */
function baustelleImBereich(benutzer, bs) {
  if (!bs) return false;
  switch (bereich(benutzer)) {
    case 'alle': return true;
    default: return bs.polier_id === benutzer.id || (benutzer.baustelle_id != null && benutzer.baustelle_id === bs.id);
  }
}

/** Preise/€ für diese Baustelle sichtbar? (Recht preise_sehen; keine Baustellen-Einschränkung mehr – Bauleiter wie Büro) */
function darfPreise(ctx, bs) { // eslint-disable-line no-unused-vars
  return ctx.rechte.has('preise_sehen');
}

/** Nachkalkulation/Budget für diese Baustelle sichtbar? */
function darfKalk(ctx, bs) { // eslint-disable-line no-unused-vars
  return ctx.rechte.has('kalk_sehen');
}

/** Feldnamen, die €-Werte (oder daraus abgeleitete Budget-Kennzahlen) tragen. */
const EURO_FELDER = new Set([
  'kostensatz', 'verrechnungssatz', 'regiesatz', 'ek', 'vk', 'ep', 'preis', 'satz', 'betrag',
  'auftragssumme', 'auftragGesamt', 'nachtraege', 'kostenTag', 'kosten', 'erloes', 'db', 'dbProzent',
  'lohnkosten', 'geraetekosten', 'materialkosten',
  // Servicebuch (API.md 11)
  'kostenJahr', 'kostenGesamt', 'kostenJeStunde',
  // Preise mit „gültig ab“ (API.md 12.2)
  'epGeplant', 'epVerlauf', 'perioden',
  // Ausgangsrechnungen (API.md 12.17)
  'netto', 'brutto', 'ust', 'zahlbetrag', 'skontoGenommen', 'ruecklassOffen', 'ruecklassBetrag', 'summeOffen', 'summeUeberfaellig', 'ruecklaesseOffen', 'verrechnetNetto', 'rechnungen', 'haftruecklass', 'schlussrechnung', 'soll', 'gp'
]);
// Hinweis: 'fremd' ist bewusst NICHT enthalten (materialbeistellung.fremd ist ein Text ohne €);
// kosten.fremd verschwindet mit dem ganzen Objekt 'kosten'.
const KALK_FELDER = new Set(['budgetVerbrauchProzent', 'leistungsstandProzent', 'budgetStatus', 'schwellen', 'empfaenger']);

/**
 * Entfernt rekursiv alle €-Felder (und ohne kalk auch Budget-Kennzahlen).
 * Sicherheitsnetz zusätzlich zum gezielten Aufbau der Antworten.
 */
function entferneEuroFelder(wert, { kalk = false } = {}) {
  if (Array.isArray(wert)) return wert.map((v) => entferneEuroFelder(v, { kalk }));
  if (wert && typeof wert === 'object' && !(wert instanceof Date) && !Buffer.isBuffer(wert)) {
    const o = {};
    for (const [k, v] of Object.entries(wert)) {
      if (EURO_FELDER.has(k)) continue;
      if (!kalk && KALK_FELDER.has(k)) continue;
      o[k] = entferneEuroFelder(v, { kalk });
    }
    return o;
  }
  return wert;
}

/** Findet €-Schlüssel in einer Struktur (für Tests/Prüfungen). */
function findeEuroFelder(wert, pfad = '$', gefunden = []) {
  if (Array.isArray(wert)) wert.forEach((v, i) => findeEuroFelder(v, `${pfad}[${i}]`, gefunden));
  else if (wert && typeof wert === 'object') {
    for (const [k, v] of Object.entries(wert)) {
      if (EURO_FELDER.has(k) || KALK_FELDER.has(k)) gefunden.push(`${pfad}.${k}`);
      findeEuroFelder(v, `${pfad}.${k}`, gefunden);
    }
  }
  return gefunden;
}

/* ---------- Datenbank-gestützte Funktionen ---------- */

function ladeMatrix(db) {
  const m = {};
  for (const r of ROLLEN) m[r] = {};
  for (const z of db.alle('SELECT rolle, recht, wert FROM rolle_recht')) {
    if (m[z.rolle]) m[z.rolle][z.recht] = z.wert === 1;
  }
  for (const r of ROLLEN) {
    for (const k of RECHT_SCHLUESSEL) {
      if (m[r][k] === undefined) m[r][k] = false;
      if (istGesperrt(r, k)) m[r][k] = false;
      if (istImmer(r, k)) m[r][k] = true;
    }
  }
  return m;
}

function schreibeStandardMatrix(db) {
  for (const rolle of ROLLEN) {
    for (const recht of RECHT_SCHLUESSEL) {
      const wert = Boolean(STANDARD_MATRIX[rolle][recht]) && !istGesperrt(rolle, recht);
      db.lauf('INSERT INTO rolle_recht (rolle, recht, wert) VALUES (?, ?, ?) ON CONFLICT(rolle, recht) DO UPDATE SET wert = excluded.wert', rolle, recht, wert ? 1 : 0);
    }
  }
}

function ladeRechteFuer(db, benutzer) {
  const matrix = {};
  for (const z of db.alle('SELECT recht, wert FROM rolle_recht WHERE rolle = ?', benutzer.rolle)) matrix[z.recht] = z.wert === 1;
  const ausnahmen = db.alle('SELECT recht FROM benutzer_recht WHERE benutzer_id = ?', benutzer.id).map((z) => z.recht);
  return effektiveRechte(benutzer.rolle, matrix, ausnahmen);
}

/**
 * Mit stammdaten (Büro/Bauleiter laut Matrix) verwaltbar: Benutzer dieser Rollen; mit `benutzer` (GF) alle.
 * 15.9 (F-050): Bauleiter = Büro – Konten gleicher Stufe (Büro, Bauleiter) und der GF verwaltet nur die GF.
 * Zusätzlich prüft routes/benutzer.js `pruefeKontoVerwalten` die tatsächlichen Rechte des Ziels (Verwaltungsstufe).
 */
const BUERO_VERWALTBAR = ['mitarbeiter', 'polier'];
function darfBenutzerVerwalten(ctx, zielRolle) {
  if (ctx.hat('benutzer')) return true;
  // 15.4: allein das Recht stammdaten (für Polier/Mitarbeiter gesperrt) – nicht der Rollenname des Aufrufers
  return ctx.hat('stammdaten') && (zielRolle === undefined || BUERO_VERWALTBAR.includes(zielRolle));
}

/** Aktive Konten, die gesperrte GF-/Büro-Konten entsperren können (D-01): GF und Büro mit stammdaten */
function entsperrKonten(db) {
  return db.alle("SELECT * FROM benutzer WHERE aktiv = 1 AND rolle IN ('gf','buero','bauleiter')")
    .filter((b) => b.rolle === 'gf' || ladeRechteFuer(db, b).has('stammdaten'));
}

/** Kontext für eine Anfrage */
function kontext(db, benutzer) {
  const rechte = ladeRechteFuer(db, benutzer);
  return { benutzer, rechte, hat: (r) => rechte.has(r) };
}

/** IDs der „eigenen“ Baustellen (für /auth/ich) */
function eigeneBaustellenIds(db, benutzer) {
  const alle = db.alle('SELECT id, polier_id, bauleiter_id FROM baustelle ORDER BY kst');
  return alle.filter((b) => baustelleImBereich(benutzer, b)).map((b) => b.id);
}

module.exports = { BUERO_ROLLEN,
  ROLLEN, ROLLEN_NAMEN, RECHTE, RECHT_SCHLUESSEL, STANDARD_MATRIX, GESPERRT, IMMER, PREIS_LOHN_RECHTE,
  istGesperrt, istImmer, effektiveRechte, bereich, baustelleImBereich, darfPreise, darfKalk,
  EURO_FELDER, KALK_FELDER, entferneEuroFelder, findeEuroFelder,
  BUERO_VERWALTBAR, darfBenutzerVerwalten, entsperrKonten, ladeMatrix, schreibeStandardMatrix, ladeRechteFuer, kontext, eigeneBaustellenIds
};
