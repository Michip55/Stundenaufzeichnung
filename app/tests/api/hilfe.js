'use strict';
/**
 * Test-Hilfen: startet den echten Server auf einem Zufallsport mit :memory:-DB und Testdaten.
 * Die Uhr ist steuerbar (uhr.setze / uhr.plus).
 */
const { createApp } = require('../../server/index');
const { findeEuroFelder } = require('../../server/rechte');

// IDs aus den Testdaten (seed.js)
const U = { mitarbeiter: 2, polier: 1, polier2: 8, bauleiter: 103, buero: 101, gf: 102 };
const BS = { pitten: 1, kogler: 2, reisinger: 3, breitenau: 4, ternitz: 5, gloggnitz: 6, neustadt: 7, kieswerk: 8 };
const START = '2026-11-12T09:24:00.000Z'; // Do 12.11.2026, 10:24 Wiener Zeit

async function starte(opt = {}) {
  let jetzt = new Date(opt.start || START);
  const uhr = () => new Date(jetzt.getTime());
  uhr.setze = (iso) => { jetzt = new Date(iso); };
  uhr.plus = (min) => { jetzt = new Date(jetzt.getTime() + min * 60000); };
  const app = createApp({
    dbPath: opt.dbPath || ':memory:', uhr, nodeEnv: opt.nodeEnv, testToken: opt.testToken, seed: opt.seed !== false, demo: opt.demo !== false, euroSicherheitsnetz: opt.euroSicherheitsnetz,
    pdfUnkomprimiert: opt.pdfUnkomprimiert, loginListe: opt.loginListe, trustProxy: opt.trustProxy,
    // Ausbaustufe 2: Attrappen für externe Dienste (API.md 12.18)
    test: opt.test, kiClient: opt.kiClient, wetterAbruf: opt.wetterAbruf, mailTransport: opt.mailTransport, schluessel: opt.schluessel, url: opt.url, wetter: opt.wetter,
    // Standard in Tests: lange Sitzungen, damit Uhrsprünge nicht abmelden (eigener Test für Ablaufzeiten)
    sitzung: opt.sitzung || { feldMin: 720, bueroMin: 24 * 60, maxH: 24 * 30 }
  });
  const server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  const basis = `http://127.0.0.1:${server.address().port}`;

  function client(cookie = null, ip = null) {
    const c = {
      cookie,
      ip,
      async anfrage(methode, pfad, body, header = {}) {
        const h = { ...header };
        if (c.cookie) h.cookie = c.cookie;
        if (app.bt.testToken && h['x-bautag-test-token'] === undefined) h['x-bautag-test-token'] = app.bt.testToken; // G-06
        if (c.ip) h['x-forwarded-for'] = c.ip; // wirkt nur mit trustProxy
        let b;
        if (body !== undefined) {
          if (typeof body === 'string') b = body;
          else { b = JSON.stringify(body); h['content-type'] = h['content-type'] || 'application/json'; }
        }
        const r = await fetch(basis + '/api' + pfad, { method: methode, headers: h, body: b });
        const sc = r.headers.get('set-cookie');
        if (sc) {
          const m = /bt_session=([^;]*)/.exec(sc);
          c.cookie = m && m[1] ? `bt_session=${m[1]}` : null;
        }
        const ct = r.headers.get('content-type') || '';
        let daten;
        if (ct.includes('application/json')) daten = await r.json();
        else if (ct.includes('pdf') || ct.includes('text/csv') || ct.includes('spreadsheetml')) daten = Buffer.from(await r.arrayBuffer());
        else daten = await r.text();
        return { status: r.status, daten, headers: r.headers };
      },
      get: (p, h) => c.anfrage('GET', p, undefined, h),
      post: (p, body = {}, h) => c.anfrage('POST', p, body, h),
      put: (p, body = {}, h) => c.anfrage('PUT', p, body, h),
      del: (p, h) => c.anfrage('DELETE', p, undefined, h),
      /** POST mit aktueller version (D-07), z. B. …/unterschrift, …/personal-aktualisieren */
      async postV(p, body = {}) {
        if (body.version === undefined) {
          const g = await c.get(p.replace(/\/[^/]+$/, ''));
          if (g.status === 200 && g.daten && g.daten.version !== undefined) body = { ...body, version: g.daten.version };
        }
        return c.anfrage('POST', p, body);
      },
      /** PUT mit aktueller version (C-08): lädt die Ressource vorher */
      async putV(p, body = {}) {
        if (body.version === undefined) {
          const quelle = p.replace(/\/auftrag$/, '');
          const g = await c.get(quelle);
          if (g.status === 200 && g.daten && g.daten.version !== undefined) body = { ...body, version: g.daten.version };
        }
        return c.anfrage('PUT', p, body);
      }
    };
    return c;
  }

  async function login(benutzerId, pin = '1234', ip) {
    const c = client(null, ip || null);
    const r = await c.post('/auth/login', { benutzerId, pin });
    if (r.status !== 200) throw new Error(`Login ${benutzerId} fehlgeschlagen: ${r.status} ${JSON.stringify(r.daten)}`);
    return c;
  }

  async function stop() {
    await Promise.allSettled(app.bt.laufend || []);
    await new Promise((res) => server.close(res));
    app.schliessen();
  }

  return { app, db: app.bt.db, uhr, basis, client, login, stop };
}

/** €-Felder in einer Antwort (leeres Array = sauber) */
function euroFelder(daten) {
  return findeEuroFelder(daten);
}

/**
 * N-090: Ist LibreOffice (soffice) installiert? Nur dann dürfen LibreOffice-abhängige Tests übersprungen werden –
 * eine fehlgeschlagene Konvertierung bei installiertem soffice ist ein Testfehler, kein Skip.
 */
function sofficeVorhanden() {
  const fs = require('node:fs');
  const path = require('node:path');
  return String(process.env.PATH || '').split(path.delimiter).filter(Boolean).some((d) => {
    try { fs.accessSync(path.join(d, 'soffice'), fs.constants.X_OK); return true; } catch { return false; }
  });
}

module.exports = { starte, U, BS, START, euroFelder, sofficeVorhanden };
