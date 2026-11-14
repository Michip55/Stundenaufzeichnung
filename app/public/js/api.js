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
let nachholen = null;
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
  if (pfad !== '/auth/logout') await abmeldenNachholen();
  const opt = { method: methode, credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (opt0.ersteller != null) opt.headers['X-BauTag-Ersteller'] = String(opt0.ersteller);
  if (methode !== 'GET') {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body === undefined ? {} : body);
  }
  let antwort;
  try {
    antwort = await fetch('/api' + pfad, opt);
  } catch (e) {
    throw new NetzFehler();
  }
  let daten = null;
  const typ = antwort.headers.get('content-type') || '';
  if (antwort.status !== 204 && typ.includes('json')) {
    try { daten = await antwort.json(); } catch (e) { daten = null; }
  }
  if (!antwort.ok) {
    // 503 vom Service Worker = offline
    if (antwort.status === 503 && daten && daten.code === 'OFFLINE') throw new NetzFehler();
    const warten = Number(antwort.headers.get('retry-after'));
    if (warten > 0) daten = { ...(daten || {}), retryAfter: warten }; // Sperrdauer (429/423) für die Anzeige „läuft ab um …“
    const fehler = new ApiFehler(antwort.status, daten);
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
