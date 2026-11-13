'use strict';
/**
 * Datenschutz bei Abwesenheiten (Prüfbericht 7, R-01…R-03; API.md 12.19/12.24) – EINE Stelle für alle Pfade:
 * Den Krankenstand (Code K) sowie Notiz/Antwort zu Abwesenheiten ANDERER Personen sehen nur Rollen mit
 * `stammdaten` oder `lohn`. Alle anderen (Polier, Bauleiter, andere Mitarbeiter) erhalten den neutralen Code
 * „abwesend“ und keine Notiz. Die Person selbst sieht immer alles über sich.
 *
 * Neue Routen, die Abwesenheiten ausgeben, müssen diese Funktionen verwenden.
 */
const NEUTRAL = 'abwesend';
const NEUTRAL_PDF = 'abw.';
const CODE_TEXT = { K: 'Krankenstand', U: 'Urlaub', SW: 'Schlechtwetter', ZA: 'Zeitausgleich' };

/** Darf `ctx` Gesundheits-/Abwesenheitsdetails der Person `benutzerId` sehen? */
function darfDetails(ctx, benutzerId) {
  if (!ctx || !ctx.benutzer) return false;
  if (benutzerId != null && Number(benutzerId) === ctx.benutzer.id) return true;
  return typeof ctx.hat === 'function' && (ctx.hat('stammdaten') || ctx.hat('lohn'));
}

/** Code für die Ausgabe: K → „abwesend“ ohne Berechtigung; andere Codes bleiben */
function code(ctx, benutzerId, c) {
  if (c === 'K' && !darfDetails(ctx, benutzerId)) return NEUTRAL;
  return c;
}

/** Notiz/Antwort zu einer Abwesenheit: nur mit Berechtigung bzw. für die Person selbst, sonst null */
function notiz(ctx, benutzerId, text) {
  return darfDetails(ctx, benutzerId) ? text : null;
}

/** Text für Meldungen/Fehler: „Krankenstand“ usw. nur mit Berechtigung, sonst „Abwesenheit“ */
function text(ctx, benutzerId, c) {
  return darfDetails(ctx, benutzerId) ? CODE_TEXT[c] || c : 'Abwesenheit';
}

/** „bereits <Code>“ für 409-/Vorschau-Texte: ohne Berechtigung nie ein Code (R-03) */
function bereits(ctx, benutzerId, c) {
  return darfDetails(ctx, benutzerId) ? `bereits „${c}“ eingetragen` : 'bereits abwesend';
}

/** Ein Abwesenheits-Objekt (API-Form mit code/notiz/antwort) für den Aufrufer bereinigen */
function abwesenheitFuer(ctx, a) {
  const o = { ...a, code: code(ctx, a.benutzerId, a.code) };
  if (!darfDetails(ctx, a.benutzerId)) { delete o.notiz; delete o.antwort; }
  return o;
}

module.exports = { NEUTRAL, NEUTRAL_PDF, CODE_TEXT, darfDetails, code, notiz, text, bereits, abwesenheitFuer };
