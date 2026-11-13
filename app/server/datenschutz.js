'use strict';
/**
 * Datenschutz bei Abwesenheiten (Prüfbericht 7, R-01…R-03; API.md 7, 12.19/12.24) – EINE Stelle für alle Pfade.
 *
 * Neue Routen, die Abwesenheiten ausgeben, müssen diese Funktionen verwenden.
 */
/*
 * EINE Rollenregel (Entscheidungen des Inhabers 13.11.2026):
 *   „sieht Abwesenheiten anderer“ = Recht stammdaten ODER Recht lohn ODER Rolle bauleiter
 *  - 'voll'     Büro/Lohn/GF (stammdaten|lohn) und Bauleiter (alle Personen, echte Codes K/U/ZA/SW/BU, Notiz, Antwort) –
 *               nur LESEN; Entscheidungsrechte bleiben getrennt (darfEntscheiden: stammdaten|lohn; Bauleiter nur SW)
 *  - 'maskiert' Verwaltungsrollen ohne stammdaten/lohn (Sonderfall): sichtbar, K → „abwesend“, ohne Notiz
 *  - 'keine'    Polier und Mitarbeiter: Abwesenheiten ANDERER gar nicht (nicht einmal „abwesend“)
 * Die eigenen Abwesenheiten sieht jede Person immer vollständig.
 */
function stufe(ctx) {
  if (!ctx || !ctx.benutzer) return 'keine';
  if ((typeof ctx.hat === 'function' && (ctx.hat('stammdaten') || ctx.hat('lohn'))) || ctx.benutzer.rolle === 'bauleiter') return 'voll';
  return ['buero', 'gf'].includes(ctx.benutzer.rolle) ? 'maskiert' : 'keine'; // Verwaltungsrolle ohne stammdaten/lohn (per Matrix entzogen)
}
/** Sieht ctx überhaupt Abwesenheiten der Person? (eigene immer) */
function siehtAbwesenheit(ctx, benutzerId) {
  if (ctx && ctx.benutzer && benutzerId != null && Number(benutzerId) === ctx.benutzer.id) return true;
  return stufe(ctx) !== 'keine';
}
/** Kolonne/Stempeluhr: neutraler Text ohne Grund (Polier) */
const KOLONNE_NEUTRAL = 'Diese Person kann heute nicht über die Kolonne gestempelt werden – bitte Büro kontaktieren.';
/** Schlechtwetter-Meldung des Poliers für seine Partie */
const SW_GEMELDET = 'Schlechtwetter gemeldet – das Büro bestätigt.';
/** Codes, die eine persönliche Abwesenheit bedeuten (SW = Wetter, keine persönliche Abwesenheit) */
const ABWESENHEIT_CODES = ['K', 'U', 'ZA', 'abwesend'];

const NEUTRAL = 'abwesend';
const NEUTRAL_PDF = 'abw.';
const CODE_TEXT = { K: 'Krankenstand', U: 'Urlaub', SW: 'Schlechtwetter', ZA: 'Zeitausgleich' };

/** Darf `ctx` Gesundheits-/Abwesenheitsdetails der Person `benutzerId` sehen? */
function darfDetails(ctx, benutzerId) {
  if (!ctx || !ctx.benutzer) return false;
  if (benutzerId != null && Number(benutzerId) === ctx.benutzer.id) return true;
  return stufe(ctx) === 'voll';
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

/**
 * Bericht-Personal für den Aufrufer (API-Form personal[]): ohne Sicht auf fremde Abwesenheiten (Polier/Mitarbeiter)
 * fallen Abwesende ohne Stunden ganz weg; bei Zeilen mit Stunden entfällt der Abwesenheits-Code (SW bleibt – Wetter).
 */
function berichtPersonal(ctx, personal) {
  return personal.flatMap((p) => {
    if (siehtAbwesenheit(ctx, p.benutzerId)) return [{ ...p, code: code(ctx, p.benutzerId, p.code) }];
    if (!ABWESENHEIT_CODES.includes(p.code)) return [p];
    if (!p.stunden && !p.von1) return [];
    return [{ ...p, code: null }];
  });
}

/**
 * Aggregate über Abwesenheiten (Inhaber 13.11.2026): Polier/Mitarbeiter erhalten keine Zählungen, Warnungen oder
 * Konflikte, aus denen fremde Abwesenheiten folgen („6 von 7 Personen abwesend“, partie_viele, plan_konflikt …).
 * `aggregateErlaubt` ist die Regel für Routen; `ohneFremdeAggregate` ist das Sicherheitsnetz auf jeder JSON-Antwort.
 */
const AGGREGAT_TYPEN = new Set(['partie_viele', 'plan_konflikt']);
const ZAEHL_TEXT = /\b\d+\s+von\s+\d+\s+(?:Personen\s+)?(?:abwesend|im Urlaub|krank|im Krankenstand)/i;
const aggregateErlaubt = (ctx) => stufe(ctx) !== 'keine';
function fremdesAggregat(ctx, o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  if (AGGREGAT_TYPEN.has(o.typ)) return true;
  if (o.typ === 'abwesenheit' && Array.isArray(o.einsatzIds) && o.benutzerId != null && Number(o.benutzerId) !== ctx.benutzer.id) return true;
  return typeof o.text === 'string' && ZAEHL_TEXT.test(o.text);
}
function ohneFremdeAggregate(ctx, wert, tiefe = 0) {
  if (aggregateErlaubt(ctx) || tiefe > 12 || wert === null || typeof wert !== 'object') return wert;
  if (Buffer.isBuffer(wert)) return wert;
  if (Array.isArray(wert)) return wert.filter((x) => !fremdesAggregat(ctx, x)).map((x) => ohneFremdeAggregate(ctx, x, tiefe + 1));
  const out = {};
  for (const [k, x] of Object.entries(wert)) out[k] = ohneFremdeAggregate(ctx, x, tiefe + 1);
  return out;
}

module.exports = { aggregateErlaubt, ohneFremdeAggregate, fremdesAggregat, berichtPersonal, stufe, siehtAbwesenheit, KOLONNE_NEUTRAL, SW_GEMELDET, ABWESENHEIT_CODES, NEUTRAL, NEUTRAL_PDF, CODE_TEXT, darfDetails, code, notiz, text, bereits, abwesenheitFuer };
