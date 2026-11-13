'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U } = require('./hilfe');

test('Anmeldung, Sitzung, Abmeldung, Sperre', async (t) => {
  const s = await starte();
  t.after(() => s.stop());

  await t.test('Gesundheit ohne Anmeldung', async () => {
    const r = await s.client().get('/gesundheit');
    assert.equal(r.status, 200);
    assert.deepEqual(r.daten, { ok: true, version: r.daten.version, db: 'ok' });
  });

  await t.test('Benutzerliste ohne sensible Daten', async () => {
    const r = await s.client().get('/auth/benutzerliste');
    assert.equal(r.status, 200);
    assert.equal(r.daten.length, 33);
    for (const b of r.daten) assert.deepEqual(Object.keys(b).sort(), ['id', 'name']); // B-03: keine Rollen
  });

  await t.test('geschützte Routen ohne Anmeldung → 401', async () => {
    for (const p of ['/auth/ich', '/baustellen', '/zeit/status', '/berichte', '/kalkulation', '/preise', '/monat', '/rechte', '/integrationen', '/benachrichtigungen']) {
      const r = await s.client().get(p);
      assert.equal(r.status, 401, p);
      assert.equal(r.daten.code, 'NICHT_ANGEMELDET');
    }
    assert.equal((await s.client().post('/zeit/stempeln', { typ: 'kommen', baustelleId: 1 })).status, 401);
  });

  await t.test('Login: Cookie HttpOnly + SameSite=Strict, /auth/ich', async () => {
    const c = s.client();
    const r = await c.post('/auth/login', { benutzerId: U.buero, pin: '1234' });
    assert.equal(r.status, 200);
    assert.equal(r.daten.benutzer.name, 'Martina Koller');
    const sc = r.headers.get('set-cookie');
    assert.match(sc, /^bt_session=[0-9a-f]{64};/);
    assert.match(sc, /HttpOnly/);
    assert.match(sc, /SameSite=Strict/);
    assert.match(sc, /Path=\//);
    const ich = await c.get('/auth/ich');
    assert.equal(ich.status, 200);
    assert.equal(ich.daten.benutzer.rolle, 'buero');
    assert.ok(ich.daten.rechte.includes('lohn'));
    assert.equal(ich.daten.baustellenIds.length, 10); // 8 + interne Kostenstellen Büro (9000), Werkstatt (9100) – 12.25
    // Session-Token wird nur gehasht gespeichert
    const tok = c.cookie.split('=')[1];
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM sitzung WHERE token_hash = ?', tok).n, 0);
  });

  await t.test('baustellenIds je Rolle', async () => {
    // Bauleiter wie Büro (13.11.2026): alle Baustellen und Kostenstellen
    assert.equal((await (await s.login(U.bauleiter)).get('/auth/ich')).daten.baustellenIds.length, 10);
    assert.deepEqual((await (await s.login(U.polier)).get('/auth/ich')).daten.baustellenIds, [1]);
    assert.deepEqual((await (await s.login(U.mitarbeiter)).get('/auth/ich')).daten.baustellenIds, [1]);
  });

  await t.test('falsche PIN → 401, ungültiges Format → 400, unbekannter Benutzer → 401', async () => {
    assert.equal((await s.client().post('/auth/login', { benutzerId: U.gf, pin: '9999' })).status, 401);
    assert.equal((await s.client().post('/auth/login', { benutzerId: U.gf, pin: '12' })).status, 400);
    assert.equal((await s.client().post('/auth/login', { benutzerId: U.gf, pin: 1234 })).status, 400);
    assert.equal((await s.client().post('/auth/login', { benutzerId: 'x', pin: '1234' })).status, 400);
    assert.equal((await s.client().post('/auth/login', { benutzerId: 9999, pin: '1234' })).status, 401);
    // erfolgreiche Anmeldung setzt Zähler zurück
    await s.login(U.gf);
  });

  await t.test('Sperre nach 5 Fehlversuchen für 5 Minuten (429), danach wieder möglich', async () => {
    const st = [];
    for (let i = 0; i < 5; i++) st.push((await s.client().post('/auth/login', { benutzerId: U.polier2, pin: '0000' })).status);
    assert.deepEqual(st, [401, 401, 401, 401, 429]);
    const r = await s.client().post('/auth/login', { benutzerId: U.polier2, pin: '1234' });
    assert.equal(r.status, 429);
    assert.equal(r.daten.code, 'ZU_VIELE_VERSUCHE');
    assert.ok(Number(r.headers.get('retry-after')) > 0);
    // andere Benutzer sind nicht betroffen
    await s.login(U.polier);
    s.uhr.plus(4);
    assert.equal((await s.client().post('/auth/login', { benutzerId: U.polier2, pin: '1234' })).status, 429);
    s.uhr.plus(2);
    assert.equal((await s.client().post('/auth/login', { benutzerId: U.polier2, pin: '1234' })).status, 200);
  });

  await t.test('Abmelden beendet die Sitzung', async () => {
    const c = await s.login(U.mitarbeiter);
    const alt = c.cookie;
    const r = await c.post('/auth/logout');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
    c.cookie = alt;
    assert.equal((await c.get('/auth/ich')).status, 401);
  });

  await t.test('Sitzung läuft nach 12 Std. Inaktivität ab', async () => {
    const c = await s.login(U.mitarbeiter);
    s.uhr.plus(11 * 60);
    assert.equal((await c.get('/auth/ich')).status, 200);
    s.uhr.plus(11 * 60); // Aktivität vor 11 Std. → noch gültig
    assert.equal((await c.get('/auth/ich')).status, 200);
    s.uhr.plus(12 * 60 + 1);
    assert.equal((await c.get('/auth/ich')).status, 401);
  });

  await t.test('gefälschtes Cookie → 401', async () => {
    const c = s.client('bt_session=' + 'a'.repeat(64));
    assert.equal((await c.get('/auth/ich')).status, 401);
    c.cookie = 'bt_session=<script>';
    assert.equal((await c.get('/auth/ich')).status, 401);
  });

  await t.test('schreibende Anfragen nur als JSON (CSRF-Schutz) → 415; kaputtes JSON → 400', async () => {
    const c = await s.login(U.gf);
    const form = await c.anfrage('POST', '/zeit/stempeln', 'typ=kommen&baustelleId=1', { 'content-type': 'application/x-www-form-urlencoded' });
    assert.equal(form.status, 415);
    assert.equal(form.daten.code, 'UNGUELTIG');
    const text = await c.anfrage('POST', '/zeit/stempeln', '{"typ":"kommen"}', { 'content-type': 'text/plain' });
    assert.equal(text.status, 415);
    const multipart = await c.anfrage('PUT', '/rechte/matrix', 'x', { 'content-type': 'multipart/form-data; boundary=x' });
    assert.equal(multipart.status, 415);
    const kaputt = await c.anfrage('POST', '/zeit/stempeln', '{typ:', { 'content-type': 'application/json' });
    assert.equal(kaputt.status, 400);
    const liste = await c.anfrage('POST', '/zeit/stempeln', '[1,2]', { 'content-type': 'application/json' });
    assert.equal(liste.status, 400);
    // Login-Formular von fremder Seite ebenfalls abgelehnt
    assert.equal((await s.client().anfrage('POST', '/auth/login', 'benutzerId=102&pin=1234', { 'content-type': 'application/x-www-form-urlencoded' })).status, 415);
  });

  await t.test('inaktive Benutzer können sich nicht anmelden; PIN-Reset beendet Sitzungen', async () => {
    const gf = await s.login(U.gf);
    const ma = await s.login(15);
    assert.equal((await gf.put('/benutzer/15', { pin: '4826' })).status, 200);
    assert.equal((await ma.get('/auth/ich')).status, 401);
    assert.equal((await s.client().post('/auth/login', { benutzerId: 15, pin: '1234' })).status, 401);
    await s.login(15, '4826');
    assert.equal((await gf.put('/benutzer/15', { aktiv: false })).status, 200);
    assert.equal((await s.client().post('/auth/login', { benutzerId: 15, pin: '4826' })).status, 401);
    assert.ok(!(await s.client().get('/auth/benutzerliste')).daten.some((b) => b.id === 15));
  });

  await t.test('Sicherheits-Header und unbekannte API-Adresse', async () => {
    assert.equal((await s.client().get('/gibtsnicht')).status, 401); // ohne Anmeldung nichts verraten
    const r = await (await s.login(U.gf)).get('/gibtsnicht');
    assert.equal(r.status, 404);
    assert.equal(r.daten.code, 'NICHT_GEFUNDEN');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-powered-by'), null);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });
});
