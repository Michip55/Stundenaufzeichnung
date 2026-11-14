// BauTag – Offline-Warteschlange fürs Stempeln.
// Schlägt POST /api/zeit/stempeln mangels Netz fehl, wird die Buchung mit Zeitstempel lokal gemerkt
// und später mit `zeit` + `quelle: "offline"` nachgesendet. Es werden keine Preis-/Lohndaten gespeichert.
//
// Grundsatz (Prüfbericht M-04): Eine Buchung geht nie stillschweigend verloren.
//  · Netzfehler, 5xx, 429  → bleibt in der Warteschlange, wird später erneut gesendet
//  · 400/409 (abgelehnt)   → wandert in die sichtbare Liste „Nicht übernommene Buchungen“ (mit Grund),
//                             bis der Benutzer sie ausdrücklich als erledigt bestätigt
import { post } from './api.js';
import { speicher, toast, fmt } from './ui.js';

const KEY = 'bt_stempel_queue';
const KEY_ABGELEHNT = 'bt_stempel_abgelehnt';
let online = navigator.onLine !== false;
let laeuft = false;
let benutzerId = null;

const alle = () => speicher.lies(KEY, []);
// 15.5 (F-030/F-046): jeder Eintrag trägt die Person, die ihn erfasst hat; versiegelte Einträge (nach dem Abmelden) zählen nie mit
const eigene = () => alle().filter((e) => !e.versiegelt && e.benutzerId === benutzerId);
const alleAbgelehnt = () => speicher.lies(KEY_ABGELEHNT, []);
const melden = () => window.dispatchEvent(new CustomEvent('bt:sync', { detail: syncStatus() }));

export function syncStatus() {
  return { online, ausstehend: benutzerId == null ? 0 : eigene().length, abgelehnt: benutzerId == null ? 0 : abgelehnte().length, laeuft };
}
export function setzBenutzer(id) { benutzerId = id; melden(); }
/** angemeldete Person am Gerät (null = niemand) – 15.5: vor jedem Nachsenden geprüft */
export const angemeldeterBenutzer = () => benutzerId;
export function setzOnline(wert) { if (online !== wert) { online = wert; melden(); } }
export function warteschlange() { return eigene(); }
export function abgelehnte() { return alleAbgelehnt().filter((e) => !e.versiegelt && e.benutzerId === benutzerId); }
export function abgelehntErledigt(nr) { speicher.setz(KEY_ABGELEHNT, alleAbgelehnt().filter((e) => e.nr !== nr)); melden(); }
// true = später erneut versuchen (nichts verwerfen)
export const vorlaeufig = (err) => !!err && (err.netz || err.status >= 500 || err.status === 429 || err.status === 408);

export function einreihen(buchung) {
  if (benutzerId == null) return;
  const liste = alle();
  liste.push({ ...buchung, benutzerId, zeit: buchung.zeit || new Date().toISOString(), nr: Date.now() + '-' + Math.random().toString(36).slice(2, 7) });
  speicher.setz(KEY, liste);
  melden();
}
function ablehnen(e, err) {
  const liste = alleAbgelehnt();
  liste.push({ ...e, grund: err.message || `Fehler ${err.status}`, code: err.status, abgelehntUm: new Date().toISOString() });
  speicher.setz(KEY_ABGELEHNT, liste);
}

let lauf = Promise.resolve();
/** 15.5: wartet, bis ein laufendes Nachsenden fertig ist (vor dem Versiegeln beim Abmelden) */
export const nachsendenFertig = () => lauf;
export function nachsenden() {
  if (laeuft || benutzerId == null) return lauf;
  const p = nachsendenLauf();
  lauf = p.catch(() => {});
  return p;
}
async function nachsendenLauf() {
  const offen = eigene();
  if (!offen.length) return;
  const fuer = benutzerId;
  laeuft = true; melden();
  let gesendet = 0, neuAbgelehnt = 0;
  try {
    for (const e of offen) {
      // 15.5 (F-030): vor JEDEM Senden – ist noch die Person angemeldet, die die Buchung erfasst hat?
      if (benutzerId !== fuer || e.benutzerId !== benutzerId) break;
      try {
        const body = { typ: e.typ, zeit: e.zeit, quelle: 'offline' };
        if (e.baustelleId != null) body.baustelleId = e.baustelleId;
        if (e.standort) body.standort = e.standort;
        await post('/zeit/stempeln', body, { ersteller: e.benutzerId });
        gesendet++;
        online = true;
      } catch (err) {
        if (err.netz) { online = false; break; }
        online = true;
        if (err.status === 401 || err.status === 403 || err.code === 'ERSTELLER_ANDERS' || vorlaeufig(err)) break; // behalten, später erneut
        ablehnen(e, err); // erst sichern …
        neuAbgelehnt++;
      }
      speicher.setz(KEY, alle().filter((x) => x.nr !== e.nr)); // … dann aus der Warteschlange nehmen
    }
  } finally {
    laeuft = false; melden();
    // nach einem Benutzerwechsel nichts über die Buchungen der vorigen Person anzeigen
    const sichtbar = benutzerId === fuer;
    if (sichtbar && neuAbgelehnt) toast(neuAbgelehnt === 1 ? 'Eine Offline-Buchung wurde nicht übernommen – siehe Stempeluhr.' : `${neuAbgelehnt} Offline-Buchungen wurden nicht übernommen – siehe Stempeluhr.`, 'warn');
    if (sichtbar && gesendet) toast(gesendet === 1 ? 'Offline-Buchung nachgesendet.' : `${gesendet} Offline-Buchungen nachgesendet.`);
    if (sichtbar && (gesendet || neuAbgelehnt)) window.dispatchEvent(new CustomEvent('bt:nachgesendet'));
  }
}
export const buchungText = (e) => `${fmt.datum(fmt.iso(new Date(e.zeit)))} ${fmt.uhr(e.zeit)} Uhr`;

window.addEventListener('online', () => { online = true; melden(); nachsenden(); });
window.addEventListener('offline', () => { online = false; melden(); });
setInterval(() => { if (benutzerId != null && eigene().length && navigator.onLine !== false) nachsenden(); }, 15000);
