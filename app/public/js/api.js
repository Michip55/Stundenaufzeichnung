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

export async function api(methode, pfad, body) {
  const opt = { method: methode, credentials: 'same-origin', headers: { Accept: 'application/json' } };
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
    const fehler = new ApiFehler(antwort.status, daten);
    if (antwort.status === 401 && !pfad.startsWith('/auth/')) {
      window.dispatchEvent(new CustomEvent('bt:abgemeldet'));
    }
    throw fehler;
  }
  return daten;
}
export const get = (p) => api('GET', p);
export const post = (p, b) => api('POST', p, b);
export const put = (p, b) => api('PUT', p, b);
export const del = (p) => api('DELETE', p);
