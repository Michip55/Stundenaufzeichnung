// BauTag – „Standort beim Stempeln mitsenden“ (API.md 15.30): die Wahl gilt je PERSON am Server (benutzer.standort_einwilligung),
// nicht je Gerät – auf einem geteilten Tablet erbt niemand die Einstellung einer anderen Person. Der Schalter ist die
// Einwilligung der Person selbst (freiwillig, Standard aus).
import { put } from './api.js';
import { speicher } from './ui.js';

/** Hat die angemeldete Person den Standort beim Stempeln selbst eingeschaltet? */
export const standortEingeschaltet = (ctx) => !!(ctx && ctx.ich && ctx.ich.benutzer && ctx.ich.benutzer.standortEinwilligung);

/** Eigene Wahl am Server speichern und im angemeldeten Zustand (auch für den Offline-Start) merken */
export async function standortSetzen(ctx, an) {
  const r = await put('/auth/standort', { an: !!an });
  ctx.ich.benutzer.standortEinwilligung = (r && r.standortEinwilligung) || null;
  const g = speicher.lies('bt_ich');
  if (g && g.benutzer && g.benutzer.id === ctx.ich.benutzer.id) speicher.setz('bt_ich', ctx.ich);
  return ctx.ich.benutzer.standortEinwilligung;
}

/**
 * Bis 15.29 stand die Wahl nur am Gerät (bt_standort) und ging bei jedem Abmelden verloren. Steht sie noch auf „an“, gehört
 * sie der angemeldeten Person (beim Abmelden und beim Benutzerwechsel wird sie gelöscht): einmal an den Server übernehmen,
 * danach den alten Schlüssel entfernen. Ohne Netz bleibt er bis zum nächsten Versuch.
 */
export async function standortAltUebernehmen(ctx) {
  const alt = speicher.lies('bt_standort', null);
  if (alt === null || !ctx || !ctx.ich || !ctx.ich.benutzer) return;
  if (alt === true && !standortEingeschaltet(ctx)) {
    try { await standortSetzen(ctx, true); } catch (e) { if (e && (e.netz || e.status >= 500)) return; }
  }
  speicher.weg('bt_standort');
}

/*
 * 15.30: Offene Standort-Nachträge. Online wird die Stempelung sofort gebucht und der Standort nach der Ortung über
 * POST /zeit/stempeln/:id/standort angehängt. Damit er nicht verloren geht, wenn die Person sich gleich abmeldet oder die App
 * schließt bzw. neu lädt:
 *  - im Speicher der Seite: das Abmelden wartet kurz auf laufende Nachträge (app.js, höchstens STANDORT_ABMELDEN_MS);
 *  - am Gerät (bt_standort_nachtrag, Buchung + ggf. schon ermittelter Standort): nach einem Neuladen holt die Stempeluhr
 *    den Nachtrag derselben Person nach, solange der Server ihn annimmt (10 Minuten). Beim Abmelden wird der Schlüssel wie
 *    alle Daten der Person gelöscht (ui.js raeumeBenutzer).
 */
export const STANDORT_ABMELDEN_MS = 20000;
const NACHTRAG = 'bt_standort_nachtrag';
const NACHTRAG_MS = 10 * 60 * 1000; // wie der Server (zeit.js STANDORT_NACH_MS)
const laufend = new Map(); // Schlüssel (Buchung bzw. Warteschlangen-Nr.) → Promise des Nachtrags

/** Nachtrag `p` (Promise, das nie abgelehnt wird) unter `schluessel` als laufend führen */
export function nachtragLaeuft(schluessel, p) {
  laufend.set(schluessel, p);
  p.then(() => { if (laufend.get(schluessel) === p) laufend.delete(schluessel); }, () => { if (laufend.get(schluessel) === p) laufend.delete(schluessel); });
  return p;
}
export const nachtragLaeuftSchon = (schluessel) => laufend.has(schluessel);
export const standortNachtragOffen = () => laufend.size > 0;
/** wartet, bis alle laufenden Nachträge fertig sind – höchstens `maxMs` */
export function standortNachtraegeFertig(maxMs = STANDORT_ABMELDEN_MS) {
  if (!laufend.size) return Promise.resolve();
  return Promise.race([Promise.allSettled([...laufend.values()]), new Promise((r) => setTimeout(r, maxMs))]).then(() => {});
}

const gemerkt = () => { const l = speicher.lies(NACHTRAG, []); return Array.isArray(l) ? l : []; };
/** Nachtrag am Gerät merken (bleibt ein schon gemerkter, gilt weiter dessen Zeitpunkt) */
export function nachtragMerken(benutzerId, buchungId) {
  if (gemerkt().some((x) => x && x.buchungId === buchungId)) return;
  speicher.setz(NACHTRAG, [...gemerkt(), { buchungId, benutzerId, seit: Date.now() }].slice(-10));
}
/** inzwischen ermittelten Standort zum gemerkten Nachtrag legen (nur wenn er noch gemerkt ist – nicht nach dem Abmelden) */
export function nachtragStandort(buchungId, standort) {
  const l = gemerkt();
  if (!l.some((x) => x && x.buchungId === buchungId)) return;
  speicher.setz(NACHTRAG, l.map((x) => (x && x.buchungId === buchungId ? { ...x, standort } : x)));
}
export function nachtragErledigt(buchungId) {
  const alle = gemerkt();
  const l = alle.filter((x) => x && x.buchungId !== buchungId);
  if (l.length === alle.length) return; // nicht (mehr) gemerkt – z. B. nach dem Abmelden schon gelöscht
  if (l.length) speicher.setz(NACHTRAG, l); else speicher.weg(NACHTRAG);
}
/** gemerkte Nachträge der Person `benutzerId`, die der Server noch annimmt (ältere werden entfernt) */
export function nachtraegeGemerkt(benutzerId) {
  const jetzt = Date.now();
  const alle = gemerkt();
  const gueltig = alle.filter((x) => x && Number.isInteger(x.buchungId) && typeof x.seit === 'number' && jetzt - x.seit < NACHTRAG_MS && jetzt >= x.seit - 60000);
  if (gueltig.length !== alle.length) { if (gueltig.length) speicher.setz(NACHTRAG, gueltig); else speicher.weg(NACHTRAG); }
  return gueltig.filter((x) => x.benutzerId === benutzerId);
}
