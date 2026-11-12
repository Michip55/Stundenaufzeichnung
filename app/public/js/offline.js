// BauTag – Offline-Warteschlange fürs Stempeln.
// Schlägt POST /api/zeit/stempeln mangels Netz fehl, wird die Buchung mit Zeitstempel lokal gemerkt
// und später mit `zeit` + `quelle: "offline"` nachgesendet. Es werden keine Preis-/Lohndaten gespeichert.
import { post } from './api.js';
import { speicher, toast, fmt } from './ui.js';

const KEY = 'bt_stempel_queue';
let online = navigator.onLine !== false;
let laeuft = false;
let benutzerId = null;

const alle = () => speicher.lies(KEY, []);
const eigene = () => alle().filter((e) => e.benutzerId === benutzerId);
const melden = () => window.dispatchEvent(new CustomEvent('bt:sync', { detail: syncStatus() }));

export function syncStatus() { return { online, ausstehend: benutzerId == null ? 0 : eigene().length, laeuft }; }
export function setzBenutzer(id) { benutzerId = id; melden(); }
export function setzOnline(wert) { if (online !== wert) { online = wert; melden(); } }
export function warteschlange() { return eigene(); }

export function einreihen(buchung) {
  const liste = alle();
  liste.push({ ...buchung, benutzerId, zeit: buchung.zeit || new Date().toISOString(), nr: Date.now() + '-' + Math.random().toString(36).slice(2, 7) });
  speicher.setz(KEY, liste);
  online = false;
  melden();
}

export async function nachsenden() {
  if (laeuft || benutzerId == null) return;
  const offen = eigene();
  if (!offen.length) return;
  laeuft = true; melden();
  let gesendet = 0;
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
        if (err.status === 401) break; // erst nach neuer Anmeldung
        online = true;
        toast(`Offline-Buchung von ${fmt.uhr(e.zeit)} Uhr wurde nicht übernommen: ${err.message}`, 'warn');
      }
      speicher.setz(KEY, alle().filter((x) => x.nr !== e.nr));
    }
  } finally {
    laeuft = false; melden();
    if (gesendet) {
      toast(gesendet === 1 ? 'Offline-Buchung nachgesendet.' : `${gesendet} Offline-Buchungen nachgesendet.`);
      window.dispatchEvent(new CustomEvent('bt:nachgesendet'));
    }
  }
}

window.addEventListener('online', () => { online = true; melden(); nachsenden(); });
window.addEventListener('offline', () => { online = false; melden(); });
setInterval(() => { if (benutzerId != null && eigene().length && navigator.onLine !== false) nachsenden(); }, 15000);
