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
const eigene = () => alle().filter((e) => e.benutzerId === benutzerId);
const alleAbgelehnt = () => speicher.lies(KEY_ABGELEHNT, []);
const melden = () => window.dispatchEvent(new CustomEvent('bt:sync', { detail: syncStatus() }));

export function syncStatus() {
  return { online, ausstehend: benutzerId == null ? 0 : eigene().length, abgelehnt: benutzerId == null ? 0 : abgelehnte().length, laeuft };
}
export function setzBenutzer(id) { benutzerId = id; melden(); }
export function setzOnline(wert) { if (online !== wert) { online = wert; melden(); } }
export function warteschlange() { return eigene(); }
export function abgelehnte() { return alleAbgelehnt().filter((e) => e.benutzerId === benutzerId); }
export function abgelehntErledigt(nr) { speicher.setz(KEY_ABGELEHNT, alleAbgelehnt().filter((e) => e.nr !== nr)); melden(); }
// true = später erneut versuchen (nichts verwerfen)
export const vorlaeufig = (err) => !!err && (err.netz || err.status >= 500 || err.status === 429 || err.status === 408);

export function einreihen(buchung) {
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

export async function nachsenden() {
  if (laeuft || benutzerId == null) return;
  const offen = eigene();
  if (!offen.length) return;
  laeuft = true; melden();
  let gesendet = 0, neuAbgelehnt = 0;
  try {
    for (const e of offen) {
      try {
        const body = { typ: e.typ, zeit: e.zeit, quelle: 'offline' };
        if (e.baustelleId != null) body.baustelleId = e.baustelleId;
        if (e.standort) body.standort = e.standort;
        await post('/zeit/stempeln', body);
        gesendet++;
        online = true;
      } catch (err) {
        if (err.netz) { online = false; break; }
        online = true;
        if (err.status === 401 || err.status === 403 || vorlaeufig(err)) break; // behalten, später erneut
        ablehnen(e, err); // erst sichern …
        neuAbgelehnt++;
      }
      speicher.setz(KEY, alle().filter((x) => x.nr !== e.nr)); // … dann aus der Warteschlange nehmen
    }
  } finally {
    laeuft = false; melden();
    if (neuAbgelehnt) toast(neuAbgelehnt === 1 ? 'Eine Offline-Buchung wurde nicht übernommen – siehe Stempeluhr.' : `${neuAbgelehnt} Offline-Buchungen wurden nicht übernommen – siehe Stempeluhr.`, 'warn');
    if (gesendet) toast(gesendet === 1 ? 'Offline-Buchung nachgesendet.' : `${gesendet} Offline-Buchungen nachgesendet.`);
    if (gesendet || neuAbgelehnt) window.dispatchEvent(new CustomEvent('bt:nachgesendet'));
  }
}
export const buchungText = (e) => `${fmt.datum(fmt.iso(new Date(e.zeit)))} ${fmt.uhr(e.zeit)} Uhr`;

window.addEventListener('online', () => { online = true; melden(); nachsenden(); });
window.addEventListener('offline', () => { online = false; melden(); });
setInterval(() => { if (benutzerId != null && eigene().length && navigator.onLine !== false) nachsenden(); }, 15000);
