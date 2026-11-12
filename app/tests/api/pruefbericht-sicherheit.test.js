'use strict';
/** Regressionstests zu PRUEFBERICHT_1: B-01, B-03, M-05, M-06, N-03, N-08 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS, euroFelder } = require('./hilfe');
const R = require('../../server/rechte');

const NICHT_GF = [['mitarbeiter', U.mitarbeiter], ['polier', U.polier], ['bauleiter', U.bauleiter], ['buero', U.buero]];

test('B-01: jede Rolle × jedes vergebbare Recht × jede Route – keine €-Lecks, keine Rechteausweitung', async (t) => {
  const s = await starte({ euroSicherheitsnetz: false });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  const berichtPitten = s.db.eins('SELECT id FROM bericht WHERE baustelle_id = ? ORDER BY datum DESC', BS.pitten).id;
  const GETS = ['/auth/ich', '/baustellen', `/baustellen/${BS.pitten}`, `/baustellen/${BS.reisinger}`, '/mitarbeiter', '/geraete', '/materialien', '/leistungen',
    '/zeit/status', '/zeit/woche', '/zeit/anwesend', `/zeit/kolonne?baustelleId=${BS.pitten}`, '/benachrichtigungen', '/berichte', `/berichte/${berichtPitten}`,
    '/abwesenheiten', '/zeit/buchungen', `/baustellen/${BS.pitten}/leistungen`, `/baustellen/${BS.pitten}/fremdleistungen`,
    '/kalkulation', `/kalkulation/${BS.pitten}`, '/preise', '/monat?monat=2026-11', '/rechte', '/benutzer', '/integrationen'];
  const matrixVorher = R.ladeMatrix(s.db);

  for (const [rolle, uid] of NICHT_GF) {
    for (const recht of R.RECHT_SCHLUESSEL) {
      await t.test(`${rolle} + ${recht}`, async () => {
        const gesperrt = R.istGesperrt(rolle, recht);
        // per Matrix
        const m = await gf.put('/rechte/matrix', { rolle, recht, wert: true });
        assert.equal(m.status, gesperrt ? 400 : 200, `Matrix ${rolle}/${recht}`);
        if (!gesperrt) await gf.put('/rechte/matrix', { rolle, recht, wert: matrixVorher[rolle][recht] });
        // per Ausnahme
        const a = await gf.put('/rechte/ausnahme', { benutzerId: uid, recht, wert: true });
        assert.equal(a.status, gesperrt ? 400 : 200, `Ausnahme ${rolle}/${recht}`);
        try {
          const c = await s.login(uid);
          const ich = (await c.get('/auth/ich')).daten;
          assert.ok(!ich.rechte.includes('benutzer'), 'benutzer ist nur GF');
          if (['mitarbeiter', 'polier'].includes(rolle)) {
            for (const r of ['preise_sehen', 'preise_bearbeiten', 'kalk_sehen', 'lohn', 'stammdaten']) assert.ok(!ich.rechte.includes(r), r);
          }
          for (const p of GETS) {
            const r = await c.get(p);
            assert.ok(r.status < 500, `${p} → ${r.status}`);
            if (['mitarbeiter', 'polier'].includes(rolle)) {
              if (['/preise', '/kalkulation', `/kalkulation/${BS.pitten}`, '/monat?monat=2026-11', `/baustellen/${BS.pitten}/fremdleistungen`].includes(p)) assert.equal(r.status, 403, p);
              if (r.status === 200) assert.deepEqual(euroFelder(r.daten), [], `${rolle}+${recht} ${p}`);
            }
            if (['/rechte', '/benutzer'].includes(p)) assert.equal(r.status, 403, `${rolle}+${recht} ${p}`);
          }
          // keine Selbstbeförderung, keine Rechtevergabe
          assert.equal((await c.put(`/benutzer/${uid}`, { rolle: 'gf' })).status, 403);
          assert.equal((await c.put('/rechte/ausnahme', { benutzerId: uid, recht: 'preise_sehen', wert: true })).status, 403);
          assert.equal((await c.put('/rechte/matrix', { rolle, recht: 'lohn', wert: true })).status, 403);
          assert.equal((await c.post('/benutzer', { name: 'X', rolle: 'gf', pin: '582915' })).status, 403);
        } finally {
          await gf.put('/rechte/ausnahme', { benutzerId: uid, recht, wert: false });
        }
      });
    }
  }

  await t.test('B-01: benutzer ist für alle außer GF gesperrt', () => {
    for (const rolle of ['mitarbeiter', 'polier', 'bauleiter', 'buero']) assert.ok(R.istGesperrt(rolle, 'benutzer'), rolle);
    assert.ok(R.istGesperrt('polier', 'stammdaten') && R.istGesperrt('mitarbeiter', 'stammdaten'));
  });

  await t.test('B-01: Protokoll mit €-Bezug nur mit preise_sehen', async () => {
    await gf.put('/preise/lohngruppen/fa', { feld: 'kostensatz', wert: 44.44 });
    await gf.put(`/baustellen/${BS.pitten}/auftrag`, { auftragssumme: 123456.78 });
    await gf.post(`/baustellen/${BS.pitten}/nachtraege`, { text: 'NT', betrag: 9999.99 });
    let p = (await gf.get('/rechte')).daten.protokoll;
    assert.ok(p.some((x) => x.art === 'preis' && x.neu.includes('44.44')));
    // GF ohne preise_sehen (per Matrix entzogen) sieht keine €-Einträge mehr
    assert.equal((await gf.put('/rechte/matrix', { rolle: 'gf', recht: 'preise_sehen', wert: false })).status, 200);
    const gf2 = await s.login(U.gf);
    p = (await gf2.get('/rechte')).daten.protokoll;
    assert.ok(!p.some((x) => ['preis', 'auftrag', 'nachtrag', 'fremdleistung', 'leistung', 'budget_alarm'].includes(x.art)));
    const text = JSON.stringify(p);
    for (const geheim of ['44.44', '123456.78', '9999.99']) assert.ok(!text.includes(geheim), geheim);
    await gf2.put('/rechte/matrix', { rolle: 'gf', recht: 'preise_sehen', wert: true });
  });
});

test('B-03: Anmeldung – Sperre je (Benutzer, IP) mit steigender Dauer, IP-Grenze, PIN-Regeln, PIN-Änderung', async (t) => {
  const s = await starte({ trustProxy: true });
  t.after(() => s.stop());
  const gf = await s.login(U.gf, '1234', '10.0.0.2');
  const versuch = (benutzerId, pin, ip) => s.client(null, ip).post('/auth/login', { benutzerId, pin });

  await t.test('B-03: Fremder sperrt nur sich selbst aus', async () => {
    const st = [];
    for (let i = 0; i < 5; i++) st.push((await versuch(5, '9999', '10.6.6.6')).status);
    assert.deepEqual(st, [401, 401, 401, 401, 429]);
    assert.equal((await versuch(5, '1234', '10.6.6.6')).status, 429);
    assert.equal((await versuch(5, '1234', '10.0.0.5')).status, 200); // echter Benutzer von seinem Gerät
  });

  await t.test('B-03: steigende Sperrdauer 5 → 15 → 60 min', async () => {
    const r1 = await versuch(5, '1234', '10.6.6.6');
    assert.ok(Number(r1.headers.get('retry-after')) <= 300);
    s.uhr.plus(6);
    for (let i = 0; i < 4; i++) await versuch(5, '9999', '10.6.6.6');
    const r2 = await versuch(5, '9999', '10.6.6.6');
    assert.equal(r2.status, 429);
    assert.ok(Number(r2.headers.get('retry-after')) > 300 && Number(r2.headers.get('retry-after')) <= 900, r2.headers.get('retry-after'));
    s.uhr.plus(16);
    for (let i = 0; i < 4; i++) await versuch(5, '9999', '10.6.6.6');
    const r3 = await versuch(5, '9999', '10.6.6.6');
    assert.ok(Number(r3.headers.get('retry-after')) > 900 && Number(r3.headers.get('retry-after')) <= 3600, r3.headers.get('retry-after'));
    s.uhr.plus(61);
    assert.equal((await versuch(5, '1234', '10.6.6.6')).status, 200);
  });

  await t.test('B-03: IP-Grenze trifft nur diese Client-IP', async () => {
    let letzte;
    for (let i = 0; i < 31; i++) letzte = await versuch(10 + (i % 15), '9999', '10.7.7.7');
    assert.equal(letzte.status, 429);
    assert.equal((await versuch(U.buero, '1234', '10.7.7.7')).status, 429);
    assert.equal((await versuch(U.buero, '1234', '10.0.0.3')).status, 200);
  });

  await t.test('B-03: PIN-Mindestlänge je Rolle und keine trivialen Folgen', async () => {
    assert.equal((await gf.post('/benutzer', { name: 'BL Neu', rolle: 'bauleiter', pin: '4826' })).status, 400);
    assert.equal((await gf.post('/benutzer', { name: 'BL Neu', rolle: 'bauleiter', pin: '123456' })).status, 400);
    assert.equal((await gf.post('/benutzer', { name: 'BL Neu', rolle: 'bauleiter', pin: '777777' })).status, 400);
    const bl = await gf.post('/benutzer', { name: 'BL Neu', rolle: 'bauleiter', pin: '482619', pnr: 2001 });
    assert.equal(bl.status, 201);
    assert.equal((await gf.post('/benutzer', { name: 'MA Neu', rolle: 'mitarbeiter', pin: '4826' })).status, 201);
    // Rollenwechsel auf Büro mit zu kurzer PIN
    assert.equal((await gf.put(`/benutzer/${bl.daten.id}`, { rolle: 'mitarbeiter', pin: '4826' })).status, 200);
  });

  await t.test('B-03: neue Benutzer und PIN-Reset → PIN-Änderung erzwungen (403 PIN_AENDERN)', async () => {
    const n = await gf.post('/benutzer', { name: 'Neu Pflicht', rolle: 'mitarbeiter', pin: '5917', pnr: 2002 });
    const c = s.client(null, '10.0.1.1');
    const l = await c.post('/auth/login', { pnr: 2002, pin: '5917' });
    assert.equal(l.status, 200);
    assert.equal(l.daten.mussPinAendern, true);
    const ich = await c.get('/auth/ich');
    assert.equal(ich.status, 200);
    assert.equal(ich.daten.mussPinAendern, true);
    const b = await c.get('/baustellen');
    assert.equal(b.status, 403);
    assert.equal(b.daten.code, 'PIN_AENDERN');
    assert.equal((await c.post('/zeit/stempeln', { typ: 'kommen', baustelleId: 1 })).status, 403);
    // falsche alte PIN, schwache neue PIN
    assert.equal((await c.post('/auth/pin', { alt: '0000', neu: '8264' })).status, 401);
    assert.equal((await c.post('/auth/pin', { alt: '5917', neu: '1234' })).status, 400);
    assert.equal((await c.post('/auth/pin', { alt: '5917', neu: '5917' })).status, 400);
    assert.equal((await c.post('/auth/pin', { alt: '5917', neu: '12' })).status, 400);
    const zweite = s.client(null, '10.0.1.2');
    await zweite.post('/auth/login', { pnr: 2002, pin: '5917' });
    const ok = await c.post('/auth/pin', { alt: '5917', neu: '8264' });
    assert.equal(ok.status, 200);
    assert.equal((await c.get('/baustellen')).status, 200);
    assert.equal((await c.get('/auth/ich')).daten.mussPinAendern, false);
    assert.equal((await zweite.get('/auth/ich')).status, 401); // andere Sitzungen beendet
    assert.equal((await s.client(null, '10.0.1.3').post('/auth/login', { benutzerId: n.daten.id, pin: '8264' })).status, 200);
    // Reset durch GF → wieder Pflicht
    await gf.put(`/benutzer/${n.daten.id}`, { pin: '3917' });
    const c2 = s.client(null, '10.0.1.4');
    assert.equal((await c2.post('/auth/login', { benutzerId: n.daten.id, pin: '3917' })).daten.mussPinAendern, true);
    assert.ok(s.db.eins("SELECT COUNT(*) AS n FROM protokoll WHERE text LIKE '%eigene PIN geändert%'").n >= 1);
  });

  await t.test('B-03: Testdaten ohne Demo-Modus erzwingen die PIN-Änderung', async () => {
    const s2 = await starte({ demo: false });
    try {
      const c = s2.client();
      const l = await c.post('/auth/login', { benutzerId: U.gf, pin: '1234' });
      assert.equal(l.daten.mussPinAendern, true);
      assert.equal((await c.get('/kalkulation')).daten.code, 'PIN_AENDERN');
    } finally { await s2.stop(); }
  });

  await t.test('B-03: Namensliste ohne Rollen, abschaltbar; Anmeldung mit Personalnummer', async () => {
    const l = await s.client().get('/auth/benutzerliste');
    assert.ok(l.daten.every((b) => Object.keys(b).sort().join() === 'id,name'));
    const s2 = await starte({ loginListe: false });
    try {
      assert.equal((await s2.client().get('/auth/benutzerliste')).status, 404);
      const c = s2.client();
      const r = await c.post('/auth/login', { pnr: 1102, pin: '1234' });
      assert.equal(r.status, 200);
      assert.equal(r.daten.benutzer.name, 'Michael Pichler');
      assert.equal((await s2.client().post('/auth/login', { pnr: 1102, pin: '9999' })).status, 401);
      assert.equal((await s2.client().post('/auth/login', { pnr: 'x', pin: '1234' })).status, 400);
      assert.equal((await s2.client().post('/auth/login', { pin: '1234' })).status, 400);
    } finally { await s2.stop(); }
  });

  await t.test('N-05: Personalnummer eindeutig', async () => {
    assert.equal((await gf.put('/benutzer/3', { pnr: 1002 })).status, 409);
    assert.equal((await gf.post('/benutzer', { name: 'Doppelt', rolle: 'mitarbeiter', pin: '5917', pnr: 1002 })).status, 409);
    assert.equal((await gf.put('/benutzer/3', { pnr: 1003 })).status, 200); // eigene Nummer bleibt erlaubt
  });
});

test('M-05: Sitzungsablauf je Rolle (Standard: Feld 12 h, Büro/GF/Bauleiter 60 min, max. 24 h)', async (t) => {
  const s = await starte({ sitzung: {} });
  t.after(() => s.stop());
  const buero = await s.login(U.buero);
  const ma = await s.login(U.mitarbeiter);
  assert.equal((await buero.get('/auth/ich')).daten.sitzungMinuten, 60);
  assert.equal((await ma.get('/auth/ich')).daten.sitzungMinuten, 720);
  s.uhr.plus(59);
  assert.equal((await buero.get('/auth/ich')).status, 200);
  s.uhr.plus(61);
  assert.equal((await buero.get('/auth/ich')).status, 401);
  assert.equal((await ma.get('/auth/ich')).status, 200);
  for (let i = 0; i < 25; i++) { s.uhr.plus(60); await ma.get('/auth/ich'); }
  assert.equal((await ma.get('/auth/ich')).status, 401); // absolute Obergrenze 24 h
});

test('M-06, N-03, N-08: Header, Gesundheit, statische 404', async (t) => {
  const s = await starte();
  t.after(() => s.stop());

  await t.test('M-06: CSP, nosniff, Referrer, frame-ancestors; HSTS nur bei HTTPS', async () => {
    const r = await fetch(s.basis + '/');
    const csp = r.headers.get('content-security-policy');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(r.headers.get('strict-transport-security'), null);
    // ohne TRUST_PROXY wird X-Forwarded-Proto ignoriert
    const l = await fetch(s.basis + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' }, body: JSON.stringify({ benutzerId: U.gf, pin: '1234' }) });
    assert.ok(!/Secure/.test(l.headers.get('set-cookie')));
    assert.equal(l.headers.get('strict-transport-security'), null);
  });

  await t.test('M-06: mit TRUST_PROXY: HSTS und Secure-Cookie hinter HTTPS-Proxy', async () => {
    const s2 = await starte({ trustProxy: true });
    try {
      const l = await fetch(s2.basis + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' }, body: JSON.stringify({ benutzerId: U.gf, pin: '1234' }) });
      assert.match(l.headers.get('set-cookie'), /Secure/);
      assert.match(l.headers.get('strict-transport-security'), /max-age=\d+/);
    } finally { await s2.stop(); }
  });

  await t.test('N-03: /gesundheit liefert db auch für Polier', async () => {
    const pol = await s.login(U.polier);
    assert.deepEqual((await pol.get('/gesundheit')).daten, { ok: true, version: require('../../package.json').version, db: 'ok' });
  });

  await t.test('N-08: fehlende Dateien → 404 statt index.html', async () => {
    for (const p of ['/js/nichtda.js', '/.git/config', '/css/x.css', '/bild.png']) {
      const r = await fetch(s.basis + p);
      assert.equal(r.status, 404, p);
    }
    const spa = await fetch(s.basis + '/baustelle/2');
    assert.ok([200, 404].includes(spa.status));
    if (spa.status === 200) assert.match(spa.headers.get('content-type'), /text\/html/);
  });
});
