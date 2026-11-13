// BauTag – Schadensmeldungen ohne Netz: Meldung samt Fotos bleibt in IndexedDB am Gerät, bis der Server sie bestätigt hat.
// Jede Meldung trägt eine clientId – der Server erkennt Wiederholungen daran (keine Duplikate, auch nicht bei Fotos).
import { post } from './api.js';

const DB = 'bautag-schaden', STORE = 'meldungen';
let dbP = null;
function db() {
  if (dbP) return dbP;
  dbP = new Promise((ok, nok) => {
    if (!('indexedDB' in window)) { nok(new Error('Kein Gerätespeicher verfügbar.')); return; }
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'clientId' }); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => nok(r.error || new Error('Gerätespeicher nicht verfügbar.'));
  });
  dbP.catch(() => { dbP = null; });
  return dbP;
}
const tx = async (modus, fn) => { const d = await db(); return new Promise((ok, nok) => { const t = d.transaction(STORE, modus); const r = fn(t.objectStore(STORE)); t.oncomplete = () => ok(r && r.result); t.onerror = t.onabort = () => nok(t.error || new Error('Gerätespeicher: Schreiben fehlgeschlagen.')); }); };
const melde = () => window.dispatchEvent(new CustomEvent('bt:schaden'));

export const neueClientId = () => (crypto.randomUUID ? crypto.randomUUID() : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
export async function schadenMerken(e) { await tx('readwrite', (s) => s.put(e)); melde(); }
export async function schadenEntfernen(clientId) { await tx('readwrite', (s) => s.delete(clientId)); melde(); }
export async function schadenWarteschlange(benutzerId) {
  try { const alle = (await tx('readonly', (s) => s.getAll())) || []; return alle.filter((e) => benutzerId == null || e.benutzerId === benutzerId).sort((a, b) => String(a.erstellt).localeCompare(String(b.erstellt))); }
  catch (x) { return []; }
}
// Vorläufig = später noch einmal versuchen (kein Netz, Server nicht bereit, Sitzung abgelaufen)
export const schadenVorlaeufig = (x) => !!(x && (x.netz || !x.status || x.status >= 500 || x.status === 429 || x.status === 401 || x.status === 408));

// Sendet eine Meldung: zuerst die Meldung (idempotent über clientId), dann Foto für Foto. Der Stand wird nach jedem Schritt gemerkt.
const inArbeit = new Set();
export async function schadenSenden(e, fortschritt = () => {}, merken = true) {
  if (inArbeit.has(e.clientId)) throw Object.assign(new Error('Wird bereits gesendet.'), { status: 0 });
  inArbeit.add(e.clientId);
  try { return await sende(e, fortschritt, merken); } finally { inArbeit.delete(e.clientId); }
}
async function sende(e, fortschritt, merken) {
  const gesamt = 1 + e.fotos.length;
  const stand = () => fortschritt((e.serverId ? 1 : 0) + e.fotos.filter((f) => f.gesendet).length, gesamt);
  const sichern = async () => { if (merken) { try { await tx('readwrite', (s) => s.put(e)); } catch (x) { /* Senden geht auch ohne Gerätespeicher weiter */ } } };
  stand();
  let schaden = null;
  if (!e.serverId) {
    schaden = await post('/fuhrpark/schaeden', { ...e.body, clientId: e.clientId });
    e.serverId = schaden.id; await sichern(); stand();
  }
  for (const f of e.fotos) {
    if (f.gesendet) continue;
    try { await post(`/fuhrpark/schaeden/${e.serverId}/fotos`, { bildBase64: f.daten, dateiname: f.dateiname }); }
    catch (x) { if (schadenVorlaeufig(x)) throw x; f.fehler = x.message; } // ein vom Server abgelehntes Foto hält die Meldung nicht auf
    f.gesendet = true; await sichern(); stand();
  }
  if (merken) { try { await tx('readwrite', (s) => s.delete(e.clientId)); } catch (x) { /* egal */ } melde(); }
  return { id: e.serverId, schaden, fotoFehler: e.fotos.filter((f) => f.fehler).map((f) => f.fehler) };
}

let laeuft = false;
// Alle wartenden Meldungen dieses Benutzers nachsenden. Rückgabe: Anzahl gesendeter Meldungen.
export async function schadenNachsenden(benutzerId) {
  if (laeuft || benutzerId == null) return 0;
  laeuft = true;
  let gesendet = 0;
  try {
    for (const e of await schadenWarteschlange(benutzerId)) {
      if (e.zustand === 'fehler' || inArbeit.has(e.clientId)) continue;
      try { await schadenSenden(e); gesendet++; }
      catch (x) {
        if (schadenVorlaeufig(x)) break; // Reihenfolge wahren, später weiter
        e.zustand = 'fehler'; e.grund = x.message; await schadenMerken(e);
      }
    }
  } finally { laeuft = false; }
  if (gesendet) window.dispatchEvent(new CustomEvent('bt:schaden-gesendet', { detail: gesendet }));
  return gesendet;
}

// Foto am Gerät verkleinern und neu als JPEG schreiben (lange Kante max. 1600 px, Qualität 0,82).
// Dabei gehen EXIF-Daten samt GPS-Position verloren – es wird nur das Bild selbst hochgeladen.
export async function bildVerkleinern(datei, max = 1600, qualitaet = 0.82) {
  let quelle, b, h, frei = () => {};
  try { quelle = await createImageBitmap(datei, { imageOrientation: 'from-image' }); b = quelle.width; h = quelle.height; frei = () => quelle.close && quelle.close(); }
  catch (x) {
    const url = URL.createObjectURL(datei);
    quelle = await new Promise((ok, nok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => nok(new Error('Bild kann nicht gelesen werden.')); i.src = url; });
    b = quelle.naturalWidth; h = quelle.naturalHeight; frei = () => URL.revokeObjectURL(url);
  }
  if (!b || !h) { frei(); throw new Error('Bild kann nicht gelesen werden.'); }
  const f = Math.min(1, max / Math.max(b, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(b * f)); c.height = Math.max(1, Math.round(h * f));
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); // Transparenz (PNG) wird weiß
  g.drawImage(quelle, 0, 0, c.width, c.height);
  frei();
  const daten = c.toDataURL('image/jpeg', qualitaet);
  const name = String(datei.name || 'foto').replace(/\.[a-z0-9]+$/i, '').replace(/[^\w\-äöüÄÖÜß ]+/g, '_').slice(0, 60) || 'foto';
  return { daten, dateiname: `${name}.jpg`, breite: c.width, hoehe: c.height, groesse: Math.round((daten.length - 23) * 0.75) };
}
