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
const OHNE_ICH = ['/auth/login', '/auth/login/2fa', '/auth/logout', '/auth/benutzerliste', '/auth/anmeldung'];
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
/**
 * Prüfbefund n8-g (15.30): Während das Abmelden auf einen Standort-Nachtrag wartet (app.js standortAbwarten), geht keine andere
 * Anfrage der Person hinaus – sonst holte sie das vorgemerkte Abmelden VOR dem Nachtrag nach (Fokus, Glocke …) und der
 * Standort ginge verloren. Solche Anfragen enden als VeraltetFehler (die Ansicht der Person ist ohnehin schon geschlossen).
 */
let abmeldenWartet = false;
export function abmeldenWarten(an) { abmeldenWartet = !!an; }
/**
 * Prüfbefund n8-g: die Seite wird geschlossen bzw. verborgen, während das Abmelden wartet – das Abmelden am Server sofort
 * absetzen (keepalive: überlebt das Schließen), mit dem Sitzungs-Cookie, das noch gilt. Danach löscht app.js das Bindungs-Cookie.
 */
export function abmeldenBeimSchliessen() {
  const m = merker();
  try {
    fetch('/api/auth/logout', { method: 'POST', keepalive: true, credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(m && m.endpoint ? { endpoint: m.endpoint } : {}) }).catch(() => {});
  } catch (e) { /* ohne Netz: das Abmelden bleibt vorgemerkt und wird beim nächsten Öffnen nachgeholt */ }
}
/** Bindungs-Cookie der Sitzung löschen (geht ohne Netz) – danach gilt das HttpOnly-Sitzungs-Cookie am Server nicht mehr */
export function bindungLoeschen() {
  try { document.cookie = `bt_bindung=; Path=/; Max-Age=0; SameSite=Strict${location.protocol === 'https:' ? '; Secure' : ''}`; } catch (e) { /* egal */ }
}

// 15.8: Gerätewahl „Eigenes Handy“ / „Geteiltes Gerät“ – je Gerät, bleibt beim Abmelden erhalten. Die Wahl ändert nur die
// Sperre nach Untätigkeit AM GERÄT (und das stille Wiedereinschalten von Push); ~~der Server erfährt sie nicht und vertraut ihr
// nicht – seine Sitzungsgrenzen (Untätigkeit je Rolle, Höchstdauer, Bindung) gelten unverändert.~~
// Ersetzt durch 15.28 (Inhaber 19.11.2026): die Anmeldung sendet die Wahl (`geraet`); mit „eigen“ gilt die Sitzung am Server bis
// Sonntag 24:00 (Montag 00:00 Wiener Zeit) ohne Untätigkeitsgrenze – für jede Rolle. Rechte hängen nie davon ab; ein Wechsel auf
// „geteilt“ in „Mehr“ kürzt die Sitzung sofort (POST /auth/geraet), „eigen“ gilt erst ab der nächsten Anmeldung mit PIN.
// 15.21 (Inhaber 17.11.2026): Standard auf der Anmeldeseite ist „Eigenes Handy“; „Geteiltes Gerät“ wird für das Gerät gemerkt.
export const GERAET_ART = 'bt_geraet_art';
// 15.12 (G2-021): für wen „Eigenes Handy“ gilt (Benutzer-ID der Person, die sich damit angemeldet bzw. es gewählt hat)
export const GERAET_ART_BENUTZER = 'bt_geraet_art_benutzer';
const gespeicherteArt = () => { try { return localStorage.getItem(GERAET_ART); } catch (e) { return null; } };
/**
 * 15.21: Gerätewahl des Geräts – das zeigt die Anmeldeseite, und das gilt für die nächste Anmeldung. „geteilt“ nur, wenn jemand
 * „Geteiltes Gerät“ gewählt hat (gespeichert ohne Person); sonst „eigen“ – auch ohne Wahl, bei unbekanntem Wert und bei
 * „geteilt“ MIT Person (Altbestand vor 15.21: so setzte die App es nach einem Benutzerwechsel bzw. einer unbestätigten Vormerkung
 * selbst). Speicher gesperrt: „geteilt“ (ohne Speicher kann „Eigenes Handy“ ohnehin nicht gelten, siehe geraetArtFuer).
 */
export function geraetArt() {
  try { return localStorage.getItem(GERAET_ART) === 'geteilt' && localStorage.getItem(GERAET_ART_BENUTZER) == null ? 'geteilt' : 'eigen'; } catch (e) { return 'geteilt'; }
}
/**
 * @param {number|null} benutzerId  Person, für die „Eigenes Handy“ gilt (null = Anmeldeseite, noch niemand angemeldet).
 * „Geteiltes Gerät“ gilt für das Gerät und wird immer ohne Person gespeichert (15.21).
 */
export function setzGeraetArt(art, benutzerId = null) {
  const neu = art === 'eigen' ? 'eigen' : 'geteilt';
  try {
    localStorage.setItem(GERAET_ART, neu);
    if (neu === 'eigen' && benutzerId != null && Number.isInteger(Number(benutzerId))) localStorage.setItem(GERAET_ART_BENUTZER, String(Number(benutzerId)));
    else localStorage.removeItem(GERAET_ART_BENUTZER);
    if (neu === 'geteilt') localStorage.removeItem(HANDY_PERSON); // 15.33: am geteilten Gerät nie einen Namen gemerkt lassen
  } catch (e) { /* gesperrt: es bleibt beim sicheren „geteilt“ (geraetArtFuer) */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('bt:geraet-art', { detail: neu }));
  return neu;
}
export function geraetArtInhaber() {
  try { const v = localStorage.getItem(GERAET_ART_BENUTZER); return v != null && /^\d+$/.test(v) ? Number(v) : null; } catch (e) { return null; }
}
/**
 * Wirksame Gerätewahl für die angemeldete Person `benutzerId` – „eigen“ nur, wenn es für genau diese Person gespeichert ist
 * (bei ihrer Anmeldung über die Anmeldeseite oder in „Mehr“, 15.21). Ohne Person, für eine andere Person oder ohne lesbaren
 * Speicher: „geteilt“.
 */
export function geraetArtFuer(benutzerId) {
  return benutzerId != null && gespeicherteArt() === 'eigen' && geraetArtInhaber() === Number(benutzerId) ? 'eigen' : 'geteilt';
}
/**
 * Wahl auf der Anmeldeseite (vor der Anmeldung) – gilt für das Gerät und damit für die nächste Anmeldung (15.21).
 * „Eigenes Handy“ bei schon gespeichertem „eigen“ ändert nichts (es wird bei der Anmeldung der Person zugeordnet).
 */
export function geraetVorwahl(art) {
  if (art === 'eigen') return gespeicherteArt() === 'eigen' ? 'eigen' : setzGeraetArt('eigen', null);
  return setzGeraetArt('geteilt', null);
}
/**
 * 15.21: Gerätewahl bei der Anmeldung von `benutzerId` über die Anmeldeseite (nur bei einer frischen Anmeldung, nicht beim
 * Neustart der App mit bestehender Sitzung). Es gilt sofort, was die Anmeldeseite gezeigt hat (geraetArt, Standard „eigen“):
 *  - „eigen“ → gilt ab jetzt für DIESE Person (gespeichert mit ihrer ID), ohne Bestätigung. Galt es vorher für eine andere
 *    Person (`vorher` = deren ID), gilt es für diese nicht mehr; ihre Daten, ihr Push-Abo und ihre Sitzung räumt der
 *    Benutzerwechsel wie bisher ab (15.5/15.12/15.16), ihr Push-Wunsch geht nie auf die neue Person über.
 *  - „geteilt“ → bleibt für das Gerät (ohne Person), es wird nichts gespeichert.
 * → {art, vorher}
 */
export function geraetArtBeiAnmeldung(benutzerId) {
  const id = Number(benutzerId);
  if (!Number.isInteger(id) || geraetArt() !== 'eigen') return { art: 'geteilt', vorher: null };
  const inhaber = geraetArtInhaber();
  setzGeraetArt('eigen', id);
  return { art: geraetArtFuer(id), vorher: inhaber != null && inhaber !== id ? inhaber : null };
}
/*
 * 15.33 (Inhaber 19.11.2026): „Eigener Name am eigenen Handy“ – am eigenen Handy merkt sich die App die Person, die sich zuletzt
 * angemeldet hat ({id, pnr, name}); die Anmeldeseite zeigt dann nur ihren Namen und die PIN-Eingabe (Anmeldung mit {pnr, pin}).
 * Gemerkt wird nur, wenn das Gerät für genau diese Person „Eigenes Handy“ ist (geraetArtFuer) – nach jeder Anmeldung und beim
 * Start mit laufender Wochen-Sitzung (app.js ladeIch). Bleibt beim Abmelden (ui.js GERAET); „Geteiltes Gerät“ löscht es sofort
 * (setzGeraetArt); meldet sich eine andere Person am eigenen Handy an, ersetzt sie die gemerkte. Am geteilten Gerät nie.
 */
export const HANDY_PERSON = 'bt_handy_person';
export function handyPerson() {
  try {
    if (geraetArt() !== 'eigen') return null;
    const p = JSON.parse(localStorage.getItem(HANDY_PERSON) || 'null');
    return p && Number.isInteger(p.pnr) && p.pnr > 0 && typeof p.name === 'string' && p.name ? { id: Number.isInteger(p.id) ? p.id : null, pnr: p.pnr, name: p.name } : null;
  } catch (e) { return null; }
}
/** nach der Anmeldung bzw. beim Start: `benutzer` ({id, name, pnr}) merken – nur am eigenen Handy dieser Person, sonst vergessen */
export function merkeHandyPerson(benutzer) {
  try {
    // geteiltes Gerät bzw. „eigen“ gilt nicht für diese Person: keinen Namen stehen lassen
    if (!benutzer || geraetArtFuer(benutzer.id) !== 'eigen') localStorage.removeItem(HANDY_PERSON);
    else if (benutzer.pnr === undefined) { // Stand ohne Personalnummer (z. B. gemerktes bt_ich von vor 15.33, ohne Netz): nur eine fremde Person vergessen
      const p = handyPerson(); if (p && p.id !== Number(benutzer.id)) localStorage.removeItem(HANDY_PERSON);
    } else if (Number.isInteger(benutzer.pnr) && benutzer.pnr > 0) localStorage.setItem(HANDY_PERSON, JSON.stringify({ id: benutzer.id, pnr: benutzer.pnr, name: String(benutzer.name || '') }));
    else localStorage.removeItem(HANDY_PERSON); // ohne Personalnummer lässt sich niemand mit dem gemerkten Namen anmelden
  } catch (e) { /* gesperrt: dann eben die Personalnummer eingeben */ }
}
export const vergissHandyPerson = () => { try { localStorage.removeItem(HANDY_PERSON); } catch (e) { /* egal */ } };

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
 * Person ein „Eigenes Handy“ ist (geraetArtFuer: nach ihrer Anmeldung mit „Eigenes Handy“ bzw. ihrer Wahl in „Mehr“). Sonst nichts – die Person entscheidet selbst.
 */
export function pushNachAnmeldung(benutzerId, erlaubnis, art = geraetArtFuer(benutzerId)) {
  return erlaubnis === 'granted' && art === 'eigen' && geraetArtFuer(benutzerId) === 'eigen' && pushGewuenscht(benutzerId);
}

/**
 * Minuten ohne Bedienung, nach denen die App am Gerät abmeldet (15.5/15.8). „geteilt“: `sperreMinuten` des Servers
 * (Mitarbeiter/Polier 30, Büro/Bauleiter/GF wie die Sitzung). „eigen“: die Sitzungsdauer des Servers (`sitzungMinuten`) –
 * keine zusätzliche Sperre am Gerät, aber nie länger, als der Server die Sitzung ohnehin hält. Fehlt sie (alter Stand), bleibt die Sperre.
 * 15.28: „eigen“ mit Wochen-Sitzung (`sitzungArt: "woche"`) → 0 = keine Abmeldung nach Untätigkeit am Gerät; die Sitzung endet
 * am Server am Montag 00:00 (dann 401 → Anmeldeseite).
 */
export function sperreMinutenFuer(ich, art) {
  if (!ich) return 0;
  const geteilt = Number(ich.sperreMinuten) > 0 ? Number(ich.sperreMinuten) : 0;
  if (art === 'eigen' && ich.sitzungArt === 'woche') return 0;
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
 * @param {{ersteller?: number, vorAbmelden?: boolean}} opt  ersteller: nachgesendeter Eintrag dieser Person (15.5, F-030) – der
 *   Server nimmt ihn nur unter ihrer Sitzung an (sonst 409 ERSTELLER_ANDERS, der Eintrag bleibt dann am Gerät).
 *   vorAbmelden (15.30): Standort-Nachtrag der eben gestempelten Buchung – geht noch vor einem vorgemerkten Abmelden hinaus,
 *   weil das Abmelden kurz auf ihn wartet (app.js). Bindung und Generation der Anmeldung gelten unverändert.
 */
export async function api(methode, pfad, body, opt0 = {}) {
  const gebunden = opt0.ersteller == null; // 15.12 (G2-018): an die Generation gebunden (alles außer nachgesendeten Einträgen)
  const gen = generation;
  const signal = gebunden && abbruch ? abbruch.signal : undefined;
  const veraltet = () => gebunden && gen !== generation;
  if (abmeldenWartet && gebunden && !opt0.vorAbmelden && pfad !== '/auth/logout') throw new VeraltetFehler();
  // Prüfbefund n8-s: nachgesendete Einträge der Person (ersteller, z. B. eine offline gestempelte Buchung, deren Ortung eben fertig
  // wurde) gehen während des Wartens ebenfalls noch unter ihrer Sitzung hinaus – sonst holte ihr Nachsenden das Abmelden VOR dem
  // Nachtrag nach. Der Server nimmt sie nur unter der Sitzung genau dieser Person an (X-BauTag-Ersteller); app.js wartet auf sie.
  if (pfad !== '/auth/logout' && !opt0.vorAbmelden && !(abmeldenWartet && !gebunden)) await abmeldenNachholen();
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
