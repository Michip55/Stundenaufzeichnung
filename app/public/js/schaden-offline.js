// BauTag – Schadensmeldungen ohne Netz: Meldung samt Fotos bleibt in IndexedDB am Gerät, bis der Server sie bestätigt hat.
// Jede Meldung trägt eine clientId – der Server erkennt Wiederholungen daran (keine Duplikate, auch nicht bei Fotos).
import { post } from './api.js';
import { angemeldeterBenutzer } from './offline.js';

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
// 15.5 (F-046): versiegelte Einträge (anderer Personen bzw. nach dem Abmelden) sind nie Teil einer Warteschlange
export async function schadenWarteschlange(benutzerId) {
  try { const alle = (await tx('readonly', (s) => s.getAll())) || []; return alle.filter((e) => !e.versiegelt && (benutzerId == null || e.benutzerId === benutzerId)).sort((a, b) => String(a.erstellt).localeCompare(String(b.erstellt))); }
  catch (x) { return []; }
}
// Rohzugriff für das Versiegeln (tresor.js)
export const schadenRohAlle = async () => { try { return (await tx('readonly', (s) => s.getAll())) || []; } catch (x) { return []; } };
export const schadenRohSetzen = (e) => tx('readwrite', (s) => s.put(e));
export const schadenRohWeg = (clientId) => tx('readwrite', (s) => s.delete(clientId));
// Prüfbericht 5, F-06: drei Fehlerarten auseinanderhalten.
//   netz      = keine Verbindung / Sitzung abgelaufen → weiter warten (ohne Zählung)
//   server    = Antwort 5xx → höchstens MAX_VERSUCHE Versuche, dann Zustand „Fehler“ (der Eintrag blockiert die übrigen nie)
//   abgelehnt = Antwort 4xx → sofort Zustand „Fehler“ mit dem Grund des Servers
export const MAX_VERSUCHE = 3;
export const SERVER_FEHLER = 'Server meldet einen Fehler, bitte Büro verständigen.';
// 15.5 (F-030): 409 ERSTELLER_ANDERS = am Gerät ist inzwischen eine andere Person angemeldet → weiter warten, nie verwerfen
export const schadenFehlerArt = (x) => (!x || x.netz || !x.status || [401, 408, 429].includes(x.status) || x.code === 'ERSTELLER_ANDERS' ? 'netz' : x.status >= 500 ? 'server' : 'abgelehnt');
export const schadenVorlaeufig = (x) => schadenFehlerArt(x) !== 'abgelehnt';
// Fehlversuch am Eintrag festhalten. Rückgabe: Fehlerart.
export async function schadenFehler(e, x) {
  const art = schadenFehlerArt(x);
  if (art === 'server') {
    e.versuche = (e.versuche || 0) + 1;
    if (e.versuche >= MAX_VERSUCHE) { e.zustand = 'fehler'; e.fehlerArt = 'server'; e.grund = SERVER_FEHLER; } else e.zustand = 'wartet';
  } else if (art === 'abgelehnt') { e.zustand = 'fehler'; e.fehlerArt = 'abgelehnt'; e.grund = x.message || 'vom Server abgelehnt'; }
  else e.zustand = 'wartet';
  try { await schadenMerken(e); } catch (y) { /* ohne Gerätespeicher bleibt nur die Anzeige */ }
  return art;
}
// „Erneut senden“: Fehlerzustand zurücksetzen (die Versuche zählen neu)
export async function schadenErneut(clientId) {
  const e = (await schadenWarteschlange()).find((y) => y.clientId === clientId);
  if (!e) return;
  e.zustand = 'wartet'; e.versuche = 0; e.grund = null; e.fehlerArt = null;
  await schadenMerken(e);
}
// Meldungen, die noch nicht am Server sind (ohne bereits gesendete mit Foto-Hinweis)
export const schadenUngesendet = async (benutzerId) => (await schadenWarteschlange(benutzerId)).filter((e) => e.zustand !== 'foto');

// Sendet eine Meldung: zuerst die Meldung (idempotent über clientId), dann Foto für Foto. Der Stand wird nach jedem Schritt gemerkt.
const inArbeit = new Set();
export async function schadenSenden(e, fortschritt = () => {}, merken = true) {
  if (inArbeit.has(e.clientId)) throw Object.assign(new Error('Wird bereits gesendet.'), { status: 0 });
  inArbeit.add(e.clientId);
  try { return await sende(e, fortschritt, merken); } finally { inArbeit.delete(e.clientId); }
}
// 15.5 (F-030): vor JEDEM Schritt prüfen, dass noch die Person angemeldet ist, die die Meldung erfasst hat
const nochDerselbe = (e) => {
  if (angemeldeterBenutzer() !== e.benutzerId) throw Object.assign(new Error('Andere Person angemeldet – die Meldung bleibt am Gerät.'), { code: 'ERSTELLER_ANDERS', status: 409 });
};
async function sende(e, fortschritt, merken) {
  const gesamt = 1 + e.fotos.length;
  const als = { ersteller: e.benutzerId };
  const stand = () => fortschritt((e.serverId ? 1 : 0) + e.fotos.filter((f) => f.gesendet).length, gesamt);
  const sichern = async () => { if (merken) { try { await tx('readwrite', (s) => s.put(e)); } catch (x) { /* Senden geht auch ohne Gerätespeicher weiter */ } } };
  stand();
  let schaden = null;
  if (!e.serverId) {
    nochDerselbe(e);
    try { schaden = await post('/fuhrpark/schaeden', { ...e.body, clientId: e.clientId }, als); }
    catch (x) {
      // F-05: geht die Geräteuhr vor (oder stark nach), lehnt ein älterer Server den Zeitpunkt ab → ohne Zeitpunkt senden, der Server nimmt „jetzt“
      if (!(x.status === 400 && e.body.zeitpunkt && /zeitpunkt/i.test(x.message || ''))) throw x;
      delete e.body.zeitpunkt; e.ohneZeitpunkt = true; await sichern();
      nochDerselbe(e);
      schaden = await post('/fuhrpark/schaeden', { ...e.body, clientId: e.clientId }, als);
    }
    e.serverId = schaden.id; await sichern(); stand();
  }
  for (const f of e.fotos) {
    if (f.gesendet) continue;
    nochDerselbe(e);
    try { await post(`/fuhrpark/schaeden/${e.serverId}/fotos`, { bildBase64: f.daten, dateiname: f.dateiname }, als); }
    catch (x) { if (schadenVorlaeufig(x)) throw x; f.fehler = x.message || 'vom Server abgelehnt'; } // ein vom Server abgelehntes Foto hält die Meldung nicht auf
    f.gesendet = true; await sichern(); stand();
  }
  const fotoFehler = e.fotos.filter((f) => f.fehler);
  if (merken) {
    try {
      // F-16: abgelehnte Fotos nicht stillschweigend verlieren – die Meldung ist gesendet, die Fotos bleiben mit Grund sichtbar, bis der Benutzer sie bestätigt
      if (fotoFehler.length) { e.zustand = 'foto'; e.fotos = fotoFehler; e.grund = null; await tx('readwrite', (s) => s.put(e)); }
      else await tx('readwrite', (s) => s.delete(e.clientId));
    } catch (x) { /* egal */ }
    melde();
  }
  return { id: e.serverId, schaden, fotoFehler: fotoFehler.map((f) => f.fehler), ohneZeitpunkt: !!e.ohneZeitpunkt };
}

let laeuft = false;
let lauf = Promise.resolve();
/** 15.5: wartet, bis ein laufendes Nachsenden fertig ist (vor dem Versiegeln beim Abmelden) */
export const schadenNachsendenFertig = () => lauf;
// Alle wartenden Meldungen dieses Benutzers nachsenden. Rückgabe: Anzahl gesendeter Meldungen.
// Ein Eintrag, den der Server ablehnt oder der wiederholt einen Serverfehler auslöst, hält die übrigen nicht auf.
export function schadenNachsenden(benutzerId) {
  if (laeuft || benutzerId == null) return Promise.resolve(0);
  laeuft = true;
  const p = nachsendenLauf(benutzerId);
  lauf = p.catch(() => 0);
  return p;
}
async function nachsendenLauf(benutzerId) {
  let gesendet = 0;
  try {
    for (const e of await schadenWarteschlange(benutzerId)) {
      if (angemeldeterBenutzer() !== benutzerId) break; // 15.5 (F-030): Benutzerwechsel → sofort aufhören
      if (e.zustand === 'fehler' || e.zustand === 'foto' || inArbeit.has(e.clientId)) continue;
      try { await schadenSenden(e); gesendet++; }
      catch (x) { if ((await schadenFehler(e, x)) === 'netz') break; } // ohne Verbindung hat auch der nächste Versuch keinen Sinn
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
