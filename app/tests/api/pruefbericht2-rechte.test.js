'use strict';
/** Regressionstests PRUEFBERICHT_2: C-05, C-07, C-08 (Baustelle), C-09, C-12, C-13, C-14 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');

test('C-05 (Owner-Entscheidung 13.11.2026: Bauleiter = Büro): Stammdaten und Zuordnung wie Büro', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  const bl = await s.login(U.bauleiter);

  await t.test('C-05: Bauleiter hat stammdaten und sieht alle Baustellen wie das Büro', async () => {
    assert.ok((await bl.get('/auth/ich')).daten.rechte.includes('stammdaten'));
    assert.equal((await bl.get(`/kalkulation/${BS.reisinger}`)).status, 200);
    assert.equal((await bl.putV(`/baustellen/${BS.reisinger}`, { bauleiterId: U.bauleiter })).status, 200);
    assert.equal(s.db.eins('SELECT bauleiter_id FROM baustelle WHERE id = ?', BS.reisinger).bauleiter_id, U.bauleiter);
    assert.equal((await bl.putV(`/baustellen/${BS.reisinger}`, { bauleiterId: U.gf })).status, 200);
    // Zuordnung ändert die Sicht nicht mehr (kein Baustellen-Scoping)
    assert.equal((await bl.get(`/kalkulation/${BS.reisinger}`)).status, 200);
    // benutzer bleibt für den Bauleiter wie für das Büro gesperrt
    assert.equal((await gf.put('/rechte/ausnahme', { benutzerId: U.bauleiter, recht: 'benutzer', wert: true })).status, 400);
  });

  await t.test('C-05: Polier kann sich nicht zum Bauleiter machen; Entzug beim Büro wirkt sofort', async () => {
    const pol = await s.login(U.polier);
    assert.equal((await pol.putV(`/baustellen/${BS.reisinger}`, { bauleiterId: U.polier })).status, 403);
    assert.equal((await pol.post('/zeit/buchungen', { benutzerId: 2, typ: 'gehen', zeit: '2026-11-12T09:00:00Z', grund: 'test' })).status, 403);
    const buero = await s.login(U.buero);
    await gf.put('/rechte/matrix', { rolle: 'buero', recht: 'stammdaten', wert: false });
    assert.equal((await buero.putV(`/baustellen/${BS.reisinger}`, { name: 'x' })).status, 403);
    await gf.put('/rechte/matrix', { rolle: 'buero', recht: 'stammdaten', wert: true });
  });

  await t.test('C-08: Baustelle/Auftrag – version Pflicht, veraltet → 409', async () => {
    const b = (await gf.get(`/baustellen/${BS.pitten}`)).daten;
    assert.equal(typeof b.version, 'number');
    assert.equal((await gf.put(`/baustellen/${BS.pitten}`, { adresse: 'X' })).status, 400);
    assert.equal((await gf.put(`/baustellen/${BS.pitten}`, { adresse: 'Feldgasse 7', version: b.version })).status, 200);
    const alt = await gf.put(`/baustellen/${BS.pitten}`, { adresse: 'Feldgasse 9', version: b.version });
    assert.equal(alt.status, 409);
    assert.equal(alt.daten.code, 'KONFLIKT');
    assert.equal(alt.daten.version, b.version + 1);
    assert.equal((await gf.put(`/baustellen/${BS.pitten}/auftrag`, { auftragssumme: 1, version: b.version })).status, 409);
    assert.equal((await gf.put(`/baustellen/${BS.pitten}/auftrag`, { auftragssumme: 100000, version: b.version + 1 })).status, 200);
  });
});

test('C-07, C-09, C-12, C-13, C-14: Konto-Sperre, Vier-Augen-Prinzip, Personalnummer, Büro-Benutzerverwaltung', async (t) => {
  const s = await starte({ trustProxy: true });
  t.after(() => s.stop());
  const gf = await s.login(U.gf, '1234', '10.1.0.1');
  const buero = await s.login(U.buero, '1234', '10.1.0.2');

  await t.test('C-07: 20 Fehlversuche über viele IPs sperren das Konto (423), Büro wird benachrichtigt, Büro entsperrt', async () => {
    const st = [];
    for (let i = 0; i < 20; i++) st.push((await s.client(null, `10.9.${i}.1`).post('/auth/login', { benutzerId: 2, pin: '9999' })).status);
    assert.deepEqual(st.slice(0, 19), Array(19).fill(401));
    assert.equal(st[19], 423);
    const r = await s.client(null, '10.9.99.1').post('/auth/login', { benutzerId: 2, pin: '1234' });
    assert.equal(r.status, 423);
    assert.equal(r.daten.code, 'KONTO_GESPERRT');
    assert.ok((await buero.get('/benachrichtigungen')).daten.some((n) => n.typ === 'sicherheit' && /Lukas Brandstätter/.test(n.titel)));
    const liste = (await buero.get('/benutzer')).daten;
    const lukas = liste.find((b) => b.id === 2);
    assert.equal(lukas.gesperrt, true);
    assert.match(lukas.gesperrtSeit, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(liste.filter((b) => b.id !== 2).every((b) => b.gesperrt === false && !('gesperrtSeit' in b)));
    assert.equal((await (await s.login(U.polier, '1234', '10.1.0.3')).post('/benutzer/2/entsperren')).status, 403);
    assert.equal((await buero.post('/benutzer/2/entsperren')).status, 200);
    assert.equal((await buero.get('/benutzer')).daten.find((b) => b.id === 2).gesperrt, false);
    assert.equal((await s.client(null, '10.9.99.2').post('/auth/login', { benutzerId: 2, pin: '1234' })).status, 200);
    assert.ok(s.db.eins("SELECT COUNT(*) AS n FROM protokoll WHERE text LIKE '%entsperrt%'").n === 1);
    // Fehlversuche vor mehr als 24 h zählen nicht
    for (let i = 0; i < 15; i++) await s.client(null, `10.8.${i}.1`).post('/auth/login', { benutzerId: 4, pin: '9999' });
    s.uhr.plus(25 * 60);
    for (let i = 0; i < 15; i++) await s.client(null, `10.7.${i}.1`).post('/auth/login', { benutzerId: 4, pin: '9999' });
    assert.equal((await s.client(null, '10.6.0.1').post('/auth/login', { benutzerId: 4, pin: '1234' })).status, 200);
  });

  const gf2 = await s.login(U.gf, '1234', '10.1.0.4');
  const buero2 = await s.login(U.buero, '1234', '10.1.0.5');

  await t.test('C-09: eigene Anträge und Zeitkorrekturen nie selbst entscheiden', async () => {
    const r = await buero2.post('/abwesenheiten', { benutzerId: U.buero, datum: '2026-12-03', code: 'U' });
    assert.equal(r.status, 201);
    assert.equal(r.daten.status, 'beantragt');
    assert.equal((await buero2.put(`/abwesenheiten/${r.daten.id}`, { status: 'genehmigt' })).status, 403);
    assert.equal((await buero2.post('/abwesenheiten', { benutzerId: U.buero, datum: '2026-12-04', code: 'K' })).status, 403);
    assert.equal((await gf2.put(`/abwesenheiten/${r.daten.id}`, { status: 'genehmigt' })).status, 200);
    const g = await gf2.post('/abwesenheiten', { benutzerId: U.gf, datum: '2026-12-07', code: 'U' });
    assert.equal(g.daten.status, 'beantragt');
    assert.equal((await gf2.put(`/abwesenheiten/${g.daten.id}`, { status: 'genehmigt' })).status, 403);
    assert.equal((await buero2.put(`/abwesenheiten/${g.daten.id}`, { status: 'genehmigt' })).status, 200);
    assert.equal((await buero2.post('/zeit/buchungen', { benutzerId: U.buero, typ: 'kommen', baustelleId: 1, zeit: '2026-11-12T06:00:00Z', grund: 'eigene' })).status, 403);
    assert.equal((await buero2.post('/zeit/schichten', { benutzerId: U.buero, baustelleId: 1, datum: '2026-11-10', von: '07:00', bis: '15:00', pauseMin: 30, grund: 'eigene' })).status, 403);
  });

  await t.test('C-13: Schlechtwetter vom Polier ist gemeldet (beantragt), Büro bestätigt', async () => {
    const pol = await s.login(U.polier, '1234', '10.1.0.6');
    const r = await pol.post('/abwesenheiten', { benutzerId: 4, datum: '2026-11-12', code: 'SW' });
    assert.equal(r.status, 201);
    assert.equal(r.daten.status, 'gemeldet'); // Owner-Regel: keine Auskunft über fremde Abwesenheiten
    assert.equal(s.db.eins("SELECT status FROM abwesenheit WHERE benutzer_id = 4 AND datum = '2026-11-12'").status, 'beantragt');
    const vorher = (await buero2.get('/monat?monat=2026-11')).daten.mitarbeiter.find((m) => m.id === 4).sw;
    assert.equal((await buero2.post(`/abwesenheiten/sw-meldungen/${r.daten.meldungId}/bestaetigen`, {})).status, 200);
    assert.equal((await buero2.get('/monat?monat=2026-11')).daten.mitarbeiter.find((m) => m.id === 4).sw, vorher + 1);
  });

  await t.test('C-12: __id im Body wirkungslos (409 statt 500), Personalnummer wird vergeben', async () => {
    const r = await gf2.post('/benutzer', { name: 'Dup', rolle: 'mitarbeiter', pin: '4829', pnr: 1002, __id: 2 });
    assert.equal(r.status, 409);
    const n = await gf2.post('/benutzer', { name: 'Ohne Nummer', rolle: 'mitarbeiter', pin: '4829' });
    assert.equal(n.status, 201);
    assert.equal(n.daten.pnr, 1104); // höchste bisher 1103
    assert.equal((await gf2.put('/benutzer/3', { pnr: 1002, __id: 2 })).status, 409);
  });

  await t.test('C-14: Büro legt Mitarbeiter/Polier/Bauleiter an, setzt PINs zurück – nicht Büro/GF', async () => {
    const m = await buero2.post('/benutzer', { name: 'Büro Neu MA', rolle: 'mitarbeiter', pin: '4829', baustelleId: BS.kogler });
    assert.equal(m.status, 201);
    assert.equal((await buero2.post('/benutzer', { name: 'X', rolle: 'bauleiter', pin: '482915' })).status, 403); // D-02: Bauleiter nur GF
    assert.equal((await buero2.post('/benutzer', { name: 'X', rolle: 'buero', pin: '482915' })).status, 403);
    assert.equal((await buero2.post('/benutzer', { name: 'X', rolle: 'gf', pin: '482915' })).status, 403);
    assert.equal((await buero2.put(`/benutzer/${m.daten.id}`, { pin: '5829' })).status, 200);
    assert.equal((await buero2.put(`/benutzer/${m.daten.id}`, { rolle: 'polier' })).status, 200);
    assert.equal((await buero2.put(`/benutzer/${m.daten.id}`, { rolle: 'buero' })).status, 403);
    assert.equal((await buero2.put(`/benutzer/${U.gf}`, { pin: '582915' })).status, 403);
    assert.equal((await buero2.put('/benutzer/103', { name: 'Stefan Aigner' })).status, 200);
    assert.equal((await buero2.get('/benutzer')).status, 200);
    assert.equal((await buero2.get('/rechte')).status, 403);
    assert.equal((await buero2.post(`/benutzer/${U.gf}/entsperren`)).status, 403); // 15.5 (F-051): GF-Konten nur über entsperren.js
    assert.ok(s.db.eins("SELECT COUNT(*) AS n FROM protokoll WHERE art IN ('benutzer','rolle') AND benutzer_id = ?", U.buero).n >= 4);
  });
});
