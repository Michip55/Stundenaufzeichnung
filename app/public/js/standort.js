// BauTag – Standort beim Stempeln (API.md 15.30): reine Rechenhilfen ohne Browser-Abhängigkeit (auch unter Node getestet).
// Die Ortung selbst (navigator.geolocation) steht in views/stempeln.js bzw. views/mehr.js.

/** Höchstens so weit (Meter) gilt eine Stempelung als „bei der Baustelle“ – mindestens 300 m, sonst die Genauigkeit */
export const NAHE_M = 300;

const gueltig = (lat, lng) => typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** Entfernung zweier Punkte in Metern (Haversine, Erdradius 6 371 km); null bei fehlenden/ungültigen Koordinaten */
export function entfernungM(a, b) {
  if (!a || !b || !gueltig(a.lat, a.lng) || !gueltig(b.lat, b.lng)) return null;
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** „850 m“, „3,2 km“, „12 km“ (österreichische Schreibweise) */
export function entfernungText(m) {
  if (typeof m !== 'number' || !Number.isFinite(m) || m < 0) return '';
  const r = Math.round(m / 10) * 10;
  if (r < 1000) return `${Math.max(10, r)} m`;
  const km = m / 1000;
  return km < 10 ? `${km.toFixed(1).replace('.', ',')} km` : `${Math.round(km)} km`;
}

/** Genauigkeit „±25 m“ (gerundet, ohne Angabe leer) */
export const genauText = (g) => (typeof g === 'number' && Number.isFinite(g) && g >= 0 ? `±${Math.round(g)} m` : '');

/**
 * Lage einer Stempelung zur Baustelle:
 *  - `bei`   – Baustelle hat Koordinaten und Entfernung ≤ max(300 m, Genauigkeit) → „bei der Baustelle“
 *  - `weg`   – sonst „3,2 km von der Baustelle“
 *  - `ohne`  – Baustelle ohne Koordinaten (oder unbekannt) → nur „Standort“
 * @returns {{art:'bei'|'weg'|'ohne', meter:number|null, text:string}|null} null = kein (gültiger) Standort
 */
export function standortLage(standort, baustelle) {
  if (!standort || !gueltig(standort.lat, standort.lng)) return null;
  const m = baustelle && baustelle.lat != null && baustelle.lng != null ? entfernungM(standort, { lat: Number(baustelle.lat), lng: Number(baustelle.lng) }) : null;
  if (m === null) return { art: 'ohne', meter: null, text: 'Standort' };
  const g = typeof standort.genauigkeit === 'number' && Number.isFinite(standort.genauigkeit) ? standort.genauigkeit : 0;
  if (m <= Math.max(NAHE_M, g)) return { art: 'bei', meter: Math.round(m), text: 'bei der Baustelle' };
  return { art: 'weg', meter: Math.round(m), text: `${entfernungText(m)} von der Baustelle` };
}

/** Link zur Karte (OpenStreetMap, Zoomstufe 17) – öffnet nur die Karte, sendet nichts an BauTag */
export function kartenLink(standort) {
  if (!standort || !gueltig(standort.lat, standort.lng)) return '';
  const la = Number(standort.lat.toFixed(6)), ln = Number(standort.lng.toFixed(6));
  return `https://www.openstreetmap.org/?mlat=${la}&mlon=${ln}#map=17/${la}/${ln}`;
}

/**
 * Einmalige Ortung (nur beim Aufruf – keine laufende Ortung). Ergebnis `{standort:{lat,lng,genauigkeit}}` oder
 * `{fehler:'verweigert'|'zeit'|'aus'|'fehlt'}` (verweigert = das Gerät erlaubt keinen Zugriff; fehlt = keine Ortung im Browser).
 * `reserveMs`: Sicherheitsnetz, falls der Browser nie antwortet (z. B. die Erlaubnis-Frage bleibt offen).
 */
export function ortHolen({ timeout = 15000, maximumAge = 60000, reserveMs = 20000 } = {}) {
  const g = typeof navigator !== 'undefined' && navigator.geolocation;
  if (!g) return Promise.resolve({ fehler: 'fehlt' });
  return new Promise((fertig) => {
    let erledigt = false;
    let t = null;
    const ende = (x) => { if (erledigt) return; erledigt = true; clearTimeout(t); fertig(x); };
    t = setTimeout(() => ende({ fehler: 'zeit' }), timeout + reserveMs);
    try {
      g.getCurrentPosition(
        (p) => ende({ standort: { lat: p.coords.latitude, lng: p.coords.longitude, genauigkeit: Math.min(100000, Math.max(0, Math.round(Number(p.coords.accuracy) || 0))) } }),
        (e) => ende({ fehler: e && e.code === 1 ? 'verweigert' : e && e.code === 3 ? 'zeit' : 'aus' }),
        { enableHighAccuracy: true, timeout, maximumAge },
      );
    } catch (e) { ende({ fehler: 'aus' }); }
  });
}

/** Stand der Erlaubnis im Gerät: 'granted' | 'denied' | 'prompt' | null (unbekannt) – fragt nichts ab */
export async function ortErlaubnis() {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions || !navigator.permissions.query) return null;
    return (await navigator.permissions.query({ name: 'geolocation' })).state || null;
  } catch (e) { return null; }
}
