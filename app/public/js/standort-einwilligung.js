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
