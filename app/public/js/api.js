// BauTag – Zugriff auf die Server-Schnittstelle (/api). Keine Daten werden hier zwischengespeichert.
export class ApiFehler extends Error {
  constructor(status, daten) {
    super((daten && daten.fehler) || `Fehler ${status}`);
    this.status = status;
    this.code = (daten && daten.code) || '';
    this.daten = daten || {};
  }
}
export class NetzFehler extends Error {
  constructor() { super('Keine Verbindung zum Server.'); this.netz = true; }
}
/** 15.12 (G2-018): Antwort einer Anfrage, die unter einer inzwischen beendeten Anmeldung gestartet wurde – wird verworfen */
export class VeraltetFehler extends Error {
  constructor() { super('Die Anmeldung hat gewechselt – die Antwort wurde verworfen.'); this.veraltet = true; }
}

// 15.12 (G2-018): Jede Anfrage trägt die Generation der Anmeldung, unter der sie startet. Abmelden, Ablauf und jede neue
// Anmeldung (sitzungWechsel) zählen die Generation hoch und brechen alle laufenden Anfragen ab (AbortController). Kommt eine
// Antwort trotzdem an (z. B. weil der Abbruch zu spät kam), passt ihre Generation nicht mehr: sie wird verworfen (VeraltetFehler)
// und landet nie im Zustand der nächsten Person (Glocke, Zwischenspeicher, Ansicht).
// Ausnahme: nachgesendete Einträge (`ersteller`, 15.5 F-030) – der Server nimmt sie nur unter der Sitzung ihres Erstellers an,
// das Abmelden wartet ausdrücklich auf sie, und ihre Antwort ändert nur die Warteschlange dieser Person (nie die Anzeige einer anderen).
let generation = 0;
let abbruch = typeof AbortController === 'function' ? new AbortController() : null;
// 15.16 (H-S2): Person, deren Rahmen diese Seite gerade zeigt. Jede an die Generation gebundene Anfrage nennt sie im Kopf
// X-BauTag-Ich; hat sich im selben Browser (anderer Tab) inzwischen jemand anderer angemeldet, antwortet der Server 409
// ANMELDUNG_ANDERS – die Antwort wird verworfen und die Seite sperrt sich (Ereignis bt:fremd).
let angemeldet = null;
export function setzAngemeldet(benutzerId) { angemeldet = benutzerId != null && Number.isInteger(Number(benutzerId)) ? Number(benutzerId) : null; }
const OHNE_ICH = ['/auth/login', '/auth/login/2fa', '/auth/logout', '/auth/benutzerliste'];
export const sitzungGeneration = () => generation;
export function sitzungWechsel() {
  generation++;
  angemeldet = null; // erst GET /auth/ich der neuen Anmeldung nennt die Person wieder
  const alt = abbruch;
  abbruch = typeof AbortController === 'function' ? new AbortController() : null;
  if (alt) { try { alt.abort(); } catch (e) { /* egal */ } }
  return generation;
}

// 15.5 (F-029): Abmelden ohne Netz. Die App merkt sich das ausstehende Abmelden am Gerät (nicht personenbezogen, nur ggf. die
// Push-Adresse dieses Geräts) und holt es vor JEDER anderen Anfrage nach. Bis das gelungen ist, geht keine Anfrage hinaus –
// so wird die alte Sitzung nie weiterverwendet. Zusätzlich ist das Bindungs-Cookie gelöscht: das alte Cookie allein gilt nicht mehr.
const ABMELDEN_OFFEN = 'bt_abmelden_offen';
const merker = () => { try { return JSON.parse(localStorage.getItem(ABMELDEN_OFFEN) || 'null'); } catch (e) { return null; } };
export function abmeldenVormerken(endpoint) {
  try { localStorage.setItem(ABMELDEN_OFFEN, JSON.stringify({ seit: new Date().toISOString(), ...(endpoint ? { endpoint } : {}) })); } catch (e) { /* gesperrt */ }
}
export const abmeldenOffen = () => !!merker();
/** Bindungs-Cookie der Sitzung löschen (geht ohne Netz) – danach gilt das HttpOnly-Sitzungs-Cookie am Server nicht mehr */
export function bindungLoeschen() {
  try { document.cookie = `bt_bindung=; Path=/; Max-Age=0; SameSite=Strict${location.protocol === 'https:' ? '; Secure' : ''}`; } catch (e) { /* egal */ }
}

// 15.8: Gerätewahl „Eigenes Handy“ / „Geteiltes Gerät“ – je Gerät (nicht je Person), bleibt beim Abmelden erhalten.
// Ohne Wahl gilt „geteilt“ (sicherer Standard). Die Wahl ändert nur die Sperre nach Untätigkeit AM GERÄT; der Server erfährt
// sie nicht und vertraut ihr nicht – seine Sitzungsgrenzen (Untätigkeit je Rolle, Höchstdauer, Bindung) gelten unverändert.
export const GERAET_ART = 'bt_geraet_art';
// 15.12 (G2-021): wer die Wahl getroffen hat (Benutzer-ID; fehlt, wenn auf der Anmeldeseite vor der Anmeldung gewählt)
export const GERAET_ART_BENUTZER = 'bt_geraet_art_benutzer';
export function geraetArt() {
  try { return localStorage.getItem(GERAET_ART) === 'eigen' ? 'eigen' : 'geteilt'; } catch (e) { return 'geteilt'; }
}
/** @param {number|null} benutzerId  angemeldete Person, die wählt (null = Anmeldeseite, noch niemand angemeldet) */
export function setzGeraetArt(art, benutzerId = null) {
  const neu = art === 'eigen' ? 'eigen' : 'geteilt';
  try {
    localStorage.setItem(GERAET_ART, neu);
    if (benutzerId != null && Number.isInteger(Number(benutzerId))) localStorage.setItem(GERAET_ART_BENUTZER, String(Number(benutzerId)));
    else localStorage.removeItem(GERAET_ART_BENUTZER);
  } catch (e) { /* gesperrt: es bleibt beim sicheren Standard */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('bt:geraet-art', { detail: neu }));
  return neu;
}
export function geraetArtInhaber() {
  try { const v = localStorage.getItem(GERAET_ART_BENUTZER); return v != null && /^\d+$/.test(v) ? Number(v) : null; } catch (e) { return null; }
}
/**
 * 15.16 (H-S4): wirksame Gerätewahl für die angemeldete Person `benutzerId` – „eigen“ nur, wenn genau diese Person es nach ihrer
 * Anmeldung gewählt bzw. bestätigt hat (Inhaber = ID). Eine Wahl ohne Inhaber (Anmeldeseite) oder einer anderen Person gilt als „geteilt“.
 */
export function geraetArtFuer(benutzerId) {
  return benutzerId != null && geraetArt() === 'eigen' && geraetArtInhaber() === Number(benutzerId) ? 'eigen' : 'geteilt';
}
/**
 * 15.16 (H-S4): Wahl auf der Anmeldeseite (vor der Anmeldung). „Geteiltes Gerät“ gilt sofort (sicherer). „Eigenes Handy“ wird nur
 * vorgemerkt (ohne Inhaber) und gilt erst, wenn die Person es nach ihrer Anmeldung bestätigt. Ist das Gerät schon „eigen“
 * (Wahl einer Person nach ihrer Anmeldung), ändert ein erneuter Klick nichts – er nimmt den Inhaber nie weg.
 */
export function geraetVorwahl(art) {
  if (art === 'eigen') return geraetArt() === 'eigen' ? 'eigen' : setzGeraetArt('eigen', null);
  return setzGeraetArt('geteilt', null);
}
/**
 * 15.12 (G2-021) / 15.16 (H-S4): Gerätewahl bei der Anmeldung von `benutzerId`. „Eigenes Handy“ gilt nur, wenn genau diese Person es
 * nach einer Anmeldung gewählt hat (Inhaber = ID). Sonst gilt „geteilt“ (und wird mit dieser Person gespeichert):
 *  - Wahl einer ANDEREN Person → zurueckgesetzt (Hinweis: „war von einer anderen Person eingestellt“);
 *  - Wahl ohne Inhaber (auf der Anmeldeseite vor der Anmeldung, auch Altbestand) → bestaetigen (Hinweis: erst nach Bestätigung).
 * Niemand kann „Eigenes Handy“ für eine Person vor ihrer Anmeldung einstellen – auch nicht für die zuletzt angemeldete.
 * Der zweite Parameter (zuletzt angemeldete Person) wird seit 15.16 nicht mehr verwendet.
 * → {art, zurueckgesetzt, bestaetigen}
 */
export function geraetArtBeiAnmeldung(benutzerId) {
  const id = Number(benutzerId);
  const art = geraetArt();
  const inhaber = geraetArtInhaber();
  if (art === 'eigen' && inhaber === id) return { art: 'eigen', zurueckgesetzt: false, bestaetigen: false };
  if (art === 'eigen') {
    setzGeraetArt('geteilt', id);
    return { art: 'geteilt', zurueckgesetzt: inhaber != null, bestaetigen: inhaber == null };
  }
  let gespeichert = false;
  try { gespeichert = localStorage.getItem(GERAET_ART) != null || inhaber != null; } catch (e) { gespeichert = false; }
  if (gespeichert && inhaber !== id) setzGeraetArt('geteilt', id); // nie gewählt: nichts speichern, es gilt ohnehin „geteilt“
  return { art: 'geteilt', zurueckgesetzt: false, bestaetigen: false };
}
// 15.12: „Push auf diesem Gerät gewünscht“ – je Person, nur am Gerät (Liste von Benutzer-IDs), bleibt beim Abmelden erhalten.
// Mit der Sitzung endet das Abo (G2-019); nach der nächsten Anmeldung DERSELBEN Person auf ihrem eigenen Handy schaltet die App
// Push still wieder ein – nie für eine andere Person, nie ohne Erlaubnis des Browsers, nie auf einem geteilten Gerät.
export const PUSH_WUNSCH = 'bt_push_wunsch';
function pushWunschListe() {
  try { const v = JSON.parse(localStorage.getItem(PUSH_WUNSCH) || '[]'); return Array.isArray(v) ? v.filter((x) => Number.isInteger(x)) : []; } catch (e) { return []; }
}
export const pushGewuenscht = (benutzerId) => benutzerId != null && pushWunschListe().includes(Number(benutzerId));
/** Push auf diesem Gerät für `benutzerId` gewünscht (eingeschaltet) bzw. nicht mehr (ausgeschaltet) */
export function setzPushWunsch(benutzerId, an) {
  const id = Number(benutzerId);
  if (!Number.isInteger(id)) return;
  const liste = pushWunschListe().filter((x) => x !== id);
  if (an) liste.push(id);
  try { if (liste.length) localStorage.setItem(PUSH_WUNSCH, JSON.stringify(liste.slice(-20))); else localStorage.removeItem(PUSH_WUNSCH); } catch (e) { /* gesperrt */ }
}
/**
 * Nach der Anmeldung von `benutzerId` Push still wieder einschalten? Nur wenn (1) der Browser es schon erlaubt hat
 * (`erlaubnis === 'granted'`), (2) genau diese Person Push an diesem Gerät eingeschaltet hatte und (3) das Gerät für diese
 * Person ein „Eigenes Handy“ ist (nach geraetArtBeiAnmeldung: Wahl dieser Person). Sonst nichts – die Person entscheidet selbst.
 */
export function pushNachAnmeldung(benutzerId, erlaubnis, art = geraetArtFuer(benutzerId)) {
  return erlaubnis === 'granted' && art === 'eigen' && geraetArtFuer(benutzerId) === 'eigen' && pushGewuenscht(benutzerId);
}

/**
 * Minuten ohne Bedienung, nach denen die App am Gerät abmeldet (15.5/15.8). „geteilt“: `sperreMinuten` des Servers
 * (Mitarbeiter/Polier 30, Büro/Bauleiter/GF wie die Sitzung). „eigen“: die Sitzungsdauer des Servers (`sitzungMinuten`) –
 * keine zusätzliche Sperre am Gerät, aber nie länger, als der Server die Sitzung ohnehin hält. Fehlt sie (alter Stand), bleibt die Sperre.
 */
export function sperreMinutenFuer(ich, art) {
  if (!ich) return 0;
  const geteilt = Number(ich.sperreMinuten) > 0 ? Number(ich.sperreMinuten) : 0;
  if (art !== 'eigen' || !geteilt) return geteilt;
  const sitzung = Number(ich.sitzungMinuten) > 0 ? Number(ich.sitzungMinuten) : 0;
  return Math.max(geteilt, sitzung);
}

let nachholen = null;
/** 15.16 (H-S1): vorgemerktes Abmelden jetzt senden (wirft NetzFehler ohne Verbindung – der Merker bleibt dann) */
export const abmeldenSenden = () => abmeldenNachholen();
async function abmeldenNachholen() {
  const m = merker();
  if (!m) return;
  if (!nachholen) {
    nachholen = (async () => {
      let r;
      try {
        r = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(m.endpoint ? { endpoint: m.endpoint } : {}) });
      } catch (e) { throw new NetzFehler(); }
      if (r.status === 503 || r.status >= 500) throw new NetzFehler(); // Server/Service Worker noch nicht bereit – später erneut
      try { localStorage.removeItem(ABMELDEN_OFFEN); } catch (e) { /* egal */ }
    })().finally(() => { nachholen = null; });
  }
  return nachholen;
}

/**
 * @param {{ersteller?: number}} opt  ersteller: nachgesendeter Eintrag dieser Person (15.5, F-030) – der Server nimmt ihn nur
 *   unter ihrer Sitzung an (sonst 409 ERSTELLER_ANDERS, der Eintrag bleibt dann am Gerät).
 */
export async function api(methode, pfad, body, opt0 = {}) {
  const gebunden = opt0.ersteller == null; // 15.12 (G2-018): an die Generation gebunden (alles außer nachgesendeten Einträgen)
  const gen = generation;
  const signal = gebunden && abbruch ? abbruch.signal : undefined;
  const veraltet = () => gebunden && gen !== generation;
  if (pfad !== '/auth/logout') await abmeldenNachholen();
  if (veraltet()) throw new VeraltetFehler();
  const opt = { method: methode, credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (signal) opt.signal = signal;
  if (opt0.ersteller != null) opt.headers['X-BauTag-Ersteller'] = String(opt0.ersteller);
  const ich = gebunden ? angemeldet : null;
  if (ich != null && !OHNE_ICH.includes(pfad)) opt.headers['X-BauTag-Ich'] = String(ich);
  if (methode !== 'GET') {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body === undefined ? {} : body);
  }
  let antwort;
  try {
    antwort = await fetch('/api' + pfad, opt);
  } catch (e) {
    if (veraltet() || (e && e.name === 'AbortError')) throw new VeraltetFehler();
    throw new NetzFehler();
  }
  let daten = null;
  const typ = antwort.headers.get('content-type') || '';
  if (antwort.status !== 204 && typ.includes('json')) {
    try { daten = await antwort.json(); } catch (e) { daten = null; }
  }
  if (veraltet()) throw new VeraltetFehler(); // weder Daten noch Abmelde-/PIN-Ereignisse einer beendeten Anmeldung
  if (!antwort.ok) {
    // 503 vom Service Worker = offline
    if (antwort.status === 503 && daten && daten.code === 'OFFLINE') throw new NetzFehler();
    const warten = Number(antwort.headers.get('retry-after'));
    if (warten > 0) daten = { ...(daten || {}), retryAfter: warten }; // Sperrdauer (429/423) für die Anzeige „läuft ab um …“
    const fehler = new ApiFehler(antwort.status, daten);
    // 15.16 (H-S2): unter dem Cookie einer anderen Person – nichts übernehmen, die Seite sperrt sich
    if (antwort.status === 409 && fehler.code === 'ANMELDUNG_ANDERS' && opt.headers['X-BauTag-Ich']) {
      window.dispatchEvent(new CustomEvent('bt:fremd', { detail: { benutzerId: null, anders: true } }));
      throw new VeraltetFehler();
    }
    if (antwort.status === 403 && fehler.code === 'PIN_AENDERN') window.dispatchEvent(new CustomEvent('bt:pin'));
    if (antwort.status === 403 && fehler.code === '2FA_EINRICHTEN') window.dispatchEvent(new CustomEvent('bt:2fa'));
    if (antwort.status === 401 && !pfad.startsWith('/auth/')) {
      window.dispatchEvent(new CustomEvent('bt:abgemeldet'));
    }
    throw fehler;
  }
  return daten;
}
export const get = (p) => api('GET', p);
export const post = (p, b, o) => api('POST', p, b, o);
export const put = (p, b) => api('PUT', p, b);
export const del = (p) => api('DELETE', p);
