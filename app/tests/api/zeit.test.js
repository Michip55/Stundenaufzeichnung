'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS, euroFelder } = require('./hilfe');
const { schichten } = require('../../server/stempel');
const { buchungenSeit } = require('../../server/daten');

test('Zeiterfassung', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const ma = await s.login(U.mitarbeiter);
  const pol = await s.login(U.polier);
  const buero = await s.login(U.buero);

  await t.test('Ausgangsstatus', async () => {
    const r = await ma.get('/zeit/status');
    assert.equal(r.status, 200);
    assert.equal(r.daten.status, 'aus');
    assert.equal(r.daten.heute.datum, '2026-11-12');
    assert.equal(r.daten.heute.stunden, 0);
    assert.deepEqual(r.daten.heute.buchungen, []);
    assert.ok(Array.isArray(r.daten.warnungen));
  });

  await t.test('Zustandsautomat über die API inkl. 409 bei ungültiger Folge', async () => {
    assert.equal((await ma.post('/zeit/stempeln', { typ: 'kommen' })).status, 400);
    assert.equal((await ma.post('/zeit/stempeln', { typ: 'kommen', baustelleId: 999 })).status, 400);
    assert.equal((await ma.post('/zeit/stempeln', { typ: 'tanzen', baustelleId: 1 })).status, 400);
    assert.equal((await ma.post('/zeit/stempeln', { typ: 'gehen' })).status, 409);
    assert.equal((await ma.put('/auth/standort', { an: true })).status, 200); // 15.30: nur mit eigener Einwilligung
    let r = await ma.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten, standort: { lat: 47.72, lng: 16.18, genauigkeit: 12 } });
    assert.equal(r.status, 200);
    assert.equal(r.daten.status, 'arbeit');
    assert.equal(r.daten.baustelleId, BS.pitten);
    r = await ma.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
    assert.equal(r.status, 409);
    assert.equal(r.daten.code, 'KONFLIKT');
    assert.match(r.daten.fehler, /Bereits eingestempelt \(seit 12\.11\.2026 10:24\)/);
    assert.equal((await ma.post('/zeit/stempeln', { typ: 'pause_ende' })).status, 409);
    s.uhr.plus(90);
    assert.equal((await ma.post('/zeit/stempeln', { typ: 'pause_start' })).daten.status, 'pause');
    assert.equal((await ma.post('/zeit/stempeln', { typ: 'pause_start' })).status, 409);
    assert.equal((await ma.post('/zeit/stempeln', { typ: 'wechsel', baustelleId: BS.kogler })).status, 409);
    s.uhr.plus(30);
    assert.equal((await ma.post('/zeit/stempeln', { typ: 'pause_ende' })).daten.status, 'arbeit');
    assert.equal((await ma.post('/zeit/stempeln', { typ: 'wechsel', baustelleId: BS.pitten })).status, 409);
    s.uhr.plus(60);
    r = await ma.post('/zeit/stempeln', { typ: 'wechsel', baustelleId: BS.kogler });
    assert.equal(r.daten.baustelleId, BS.kogler);
    s.uhr.plus(60);
    r = await ma.post('/zeit/stempeln', { typ: 'gehen' });
    assert.equal(r.daten.status, 'aus');
    assert.equal(r.daten.heute.stunden, 3.5);
    assert.equal(r.daten.heute.pauseMin, 30);
    assert.deepEqual(r.daten.heute.buchungen.map((b) => b.typ), ['kommen', 'pause_start', 'pause_ende', 'wechsel', 'gehen']);
    assert.ok(r.daten.heute.buchungen.every((b) => b.quelle === 'app'));
    assert.equal(r.daten.heute.buchungen[0].uhrzeit, '10:24');
    const geo = s.db.eins("SELECT lat, lng FROM buchung WHERE benutzer_id = ? AND typ = 'kommen' ORDER BY id DESC", U.mitarbeiter);
    assert.equal(geo.lat, 47.72);
  });

  await t.test('Standort und abgeschlossene Baustelle werden geprüft', async () => {
    const c = await s.login(14);
    assert.equal((await c.post('/zeit/stempeln', { typ: 'kommen', baustelleId: 1, standort: { lat: 100, lng: 0 } })).status, 400);
    assert.equal((await c.post('/zeit/stempeln', { typ: 'kommen', baustelleId: 1, standort: 'hier' })).status, 400);
    s.db.lauf("UPDATE baustelle SET status = 'abgeschlossen' WHERE id = ?", BS.gloggnitz);
    const r = await c.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.gloggnitz });
    assert.equal(r.status, 400);
    assert.match(r.daten.fehler, /abgeschlossen/);
    s.db.lauf("UPDATE baustelle SET status = 'aktiv' WHERE id = ?", BS.gloggnitz);
  });

  await t.test('Offline-Nachbuchung: max. 24 Std. zurück, Quelle offline', async () => {
    const c = await s.login(6);
    const jetzt = s.uhr().getTime();
    const vor = (min) => new Date(jetzt - min * 60000).toISOString();
    assert.equal((await c.post('/zeit/stempeln', { typ: 'kommen', baustelleId: 1, zeit: vor(25 * 60) })).status, 400);
    assert.equal((await c.post('/zeit/stempeln', { typ: 'kommen', baustelleId: 1, zeit: new Date(jetzt + 3600000).toISOString() })).status, 400);
    assert.equal((await c.post('/zeit/stempeln', { typ: 'kommen', baustelleId: 1, zeit: 'gestern' })).status, 400);
    let r = await c.post('/zeit/stempeln', { typ: 'kommen', baustelleId: 1, zeit: vor(180) });
    assert.equal(r.status, 200);
    assert.equal(r.daten.heute.buchungen[0].quelle, 'offline');
    r = await c.post('/zeit/stempeln', { typ: 'pause_start', zeit: vor(200) });
    assert.equal(r.status, 409); // vor der letzten Buchung
    r = await c.post('/zeit/stempeln', { typ: 'gehen', zeit: vor(60) });
    assert.equal(r.status, 200);
    assert.equal(r.daten.heute.stunden, 2);
  });

  await t.test('Kolonne stempeln (Polier), bereits Gestempelte werden gemeldet', async () => {
    await (await s.login(5)).post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
    const r = await pol.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: [1, 4, 5, 7], typ: 'kommen' });
    assert.equal(r.status, 200);
    const e = Object.fromEntries(r.daten.ergebnisse.map((x) => [x.benutzerId, x]));
    assert.equal(e[1].ok, true);
    assert.equal(e[4].ok, true);
    assert.equal(e[5].ok, false);
    assert.match(e[5].fehler, /Bereits eingestempelt \(seit 12\.11\.2026/);
    assert.equal(s.db.eins("SELECT quelle, erfasst_von FROM buchung WHERE benutzer_id = 4 ORDER BY id DESC").quelle, 'kolonne');
    const k = await pol.get(`/zeit/kolonne?baustelleId=${BS.pitten}`);
    assert.equal(k.status, 200);
    const st = Object.fromEntries(k.daten.map((x) => [x.benutzerId, x.status]));
    assert.equal(st[4], 'arbeit');
    assert.equal(st[2], 'aus');
    assert.deepEqual(euroFelder(k.daten), []);
    // heute Urlaub – Inhaberregel 3 (API.md 15.2): der Polier erfährt nichts, auch kein „nicht über die Kolonne“
    const urlauber = k.daten.find((x) => x.benutzerId === 3);
    assert.equal(urlauber.code, null);
    assert.ok(!('kolonneMoeglich' in urlauber));
    assert.deepEqual(Object.keys(urlauber), Object.keys(k.daten.find((x) => x.benutzerId === 2)));
    assert.equal((await buero.get(`/abwesenheiten?benutzerId=3&von=2026-11-12&bis=2026-11-12`)).daten[0].code, 'U');
    // Eingabefehler
    assert.equal((await pol.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: [], typ: 'kommen' })).status, 400);
    assert.equal((await pol.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: [4, 4], typ: 'gehen' })).status, 400);
    assert.equal((await pol.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: 'alle', typ: 'gehen' })).status, 400);
    assert.equal((await pol.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: [4], typ: 'x' })).status, 400);
    // fremde Baustelle
    assert.equal((await pol.post('/zeit/kolonne', { baustelleId: BS.kogler, benutzerIds: [4], typ: 'gehen' })).status, 403);
    // unbekannte Person
    const u = await pol.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: [9999], typ: 'kommen' });
    assert.equal(u.daten.ergebnisse[0].ok, false);
    // Pause für die Kolonne
    s.uhr.plus(5);
    const p = await pol.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: [1, 4], typ: 'pause_start' });
    assert.ok(p.daten.ergebnisse.every((x) => x.ok));
  });

  await t.test('Meine Woche', async () => {
    const r = await ma.get('/zeit/woche?datum=2026-11-05');
    assert.equal(r.status, 200);
    assert.equal(r.daten.tage.length, 7);
    assert.equal(r.daten.von, '2026-11-02');
    assert.equal(r.daten.tage[0].wochentag, 'Mo');
    const summe = Math.round(r.daten.tage.reduce((a, x) => a + x.stunden, 0) * 100) / 100;
    assert.equal(r.daten.summe, summe);
    assert.ok(r.daten.summe > 20);
    assert.ok(r.daten.tage.find((x) => x.datum === '2026-11-03').code === 'SW');
    assert.ok(r.daten.tage[0].baustellen[0].kst === '26-041');
    assert.equal(typeof r.daten.ueberstunden, 'number');
    assert.equal((await ma.get('/zeit/woche?datum=2026-13-01')).status, 400);
    assert.equal((await ma.get('/zeit/woche')).daten.von, '2026-11-09');
  });

  await t.test('Hinweise im Status: offen > 12 Std. bleibt, > 10 Std. am Vortag kein Hinweis mehr (15.38)', async () => {
    const offen = await (await s.login(27)).get('/zeit/status');
    assert.equal(offen.daten.status, 'arbeit');
    assert.ok(offen.daten.warnungen.some((w) => w.typ === 'offen'), JSON.stringify(offen.daten.warnungen));
    // Vorbedingung: 12 hat am Vortag (11.11.) im Fenster des Status über 10 Std. gearbeitet (bis 15.37: „mehr als 10 Std.“)
    const fenster = schichten(buchungenSeit(s.db, 12, '2026-11-08T23:00:00.000Z'), s.uhr()).filter((x) => x.datum === '2026-11-11');
    assert.ok(fenster.reduce((a, x) => a + x.arbeitMin, 0) > 600, JSON.stringify(fenster.map((x) => x.arbeitMin)));
    const lang = await (await s.login(12)).get('/zeit/status');
    assert.equal(lang.status, 200);
    assert.deepEqual(lang.daten.warnungen.filter((w) => ['tag_10h', 'tag_12h', 'pause', 'ruhezeit'].includes(w.typ) || /AZG|mehr als 10 Std/.test(w.text)), [], JSON.stringify(lang.daten.warnungen));
  });

  await t.test('Ausstempeln nach langem Tag ohne Pause → kein AZG-Hinweis, keine Benachrichtigung (15.38)', async () => {
    const c = await s.login(26);
    assert.equal((await c.get('/zeit/status')).daten.status, 'arbeit');
    s.uhr.setze('2026-11-12T18:30:00.000Z'); // 19:30 Wien – 12,75 Std. ohne Pause
    const r = await c.post('/zeit/stempeln', { typ: 'gehen' });
    assert.equal(r.status, 200);
    assert.equal(r.daten.heute.stunden, 12.75);
    assert.deepEqual(r.daten.warnungen, []);
    const eigene = (await c.get('/benachrichtigungen')).daten;
    assert.ok(!eigene.some((n) => n.typ === 'azg' || /Werner Posch|AZG/.test(n.titel)), JSON.stringify(eigene));
    const b = (await buero.get('/benachrichtigungen')).daten;
    assert.ok(!b.some((n) => n.typ === 'azg' || /Werner Posch|AZG/.test(n.titel)), JSON.stringify(b.map((n) => n.titel)));
    assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM benachrichtigung WHERE typ = 'azg'").n, 0);
    // Mitarbeiter sieht keine fremden Hinweise
    assert.ok(!(await ma.get('/benachrichtigungen')).daten.some((n) => /Werner Posch/.test(n.titel)));
  });

  await t.test('Ausstempeln nach unplausibler Schicht (> 16 Std.) → Arbeitszeit-Hinweis an Person und Büro, nicht an andere', async () => {
    const c = await s.login(27); // seit 11.11. 07:00 eingestempelt
    s.uhr.setze('2026-11-12T18:40:00.000Z');
    const r = await c.post('/zeit/stempeln', { typ: 'gehen' });
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    const eigene = (await c.get('/benachrichtigungen')).daten.filter((n) => n.typ === 'azg');
    assert.equal(eigene.length, 1, JSON.stringify(eigene));
    assert.equal(eigene[0].titel, 'Arbeitszeit-Hinweis: Ivan Horvat');
    assert.match(eigene[0].text, /Schicht über .* Std\. – vermutlich Ausstempeln vergessen/);
    assert.doesNotMatch(eigene[0].text, /AZG/);
    const b = (await buero.get('/benachrichtigungen')).daten;
    assert.ok(b.some((n) => n.typ === 'azg' && n.titel === 'Arbeitszeit-Hinweis: Ivan Horvat'));
    assert.ok(!(await ma.get('/benachrichtigungen')).daten.some((n) => /Ivan Horvat/.test(n.titel)));
    assert.equal(s.db.eins("SELECT schluessel FROM benachrichtigung WHERE benutzer_id = 27 AND typ = 'azg'").schluessel, 'azg:27:2026-11-11:unplausibel');
  });

  await t.test('Abwesenheiten: Antrag, Polier SW für Partie, Büro alles', async () => {
    let r = await ma.post('/abwesenheiten', { benutzerId: U.mitarbeiter, datum: '2026-11-30', code: 'U' });
    assert.equal(r.status, 201);
    assert.equal(r.daten.status, 'beantragt');
    assert.equal((await ma.post('/abwesenheiten', { benutzerId: U.mitarbeiter, datum: '2026-11-30', code: 'ZA' })).status, 409);
    assert.equal((await ma.post('/abwesenheiten', { benutzerId: U.mitarbeiter, datum: '2026-12-01', code: 'K' })).status, 403);
    assert.equal((await ma.post('/abwesenheiten', { benutzerId: 3, datum: '2026-12-01', code: 'U' })).status, 403);
    r = await pol.post('/abwesenheiten', { benutzerId: 5, datum: '2026-11-13', code: 'SW' });
    assert.equal(r.status, 201);
    assert.equal(r.daten.status, 'gemeldet'); // C-13: Büro bestätigt; Owner-Regel: keine Auskunft über andere
    assert.equal(r.daten.text, 'Schlechtwetter gemeldet – das Büro bestätigt.');
    assert.equal(s.db.eins("SELECT status FROM abwesenheit WHERE benutzer_id = 5 AND datum = '2026-11-13'").status, 'beantragt');
    assert.equal((await pol.post('/abwesenheiten', { benutzerId: 9, datum: '2026-11-13', code: 'SW' })).status, 403);
    assert.equal((await pol.post('/abwesenheiten', { benutzerId: 5, datum: '2026-11-16', code: 'K' })).status, 403);
    r = await buero.post('/abwesenheiten', { benutzerId: U.mitarbeiter, datum: '2026-11-30', code: 'U' });
    assert.equal(r.status, 200);
    assert.equal(r.daten.status, 'genehmigt');
    assert.equal((await buero.post('/abwesenheiten', { benutzerId: 2, datum: '2026-11-31', code: 'U' })).status, 400);
    assert.equal((await buero.post('/abwesenheiten', { benutzerId: 2, datum: '2026-12-02', code: 'X' })).status, 400);
    assert.equal((await buero.post('/abwesenheiten', { benutzerId: 9999, datum: '2026-12-02', code: 'K' })).status, 400);
    assert.equal((await buero.post('/abwesenheiten', { benutzerId: 2, datum: '2030-12-02', code: 'U' })).status, 400);
    assert.ok(s.db.eins("SELECT COUNT(*) AS n FROM protokoll WHERE art = 'abwesenheit'").n >= 3);
  });
});
