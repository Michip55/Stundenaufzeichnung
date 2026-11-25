'use strict';
/**
 * 15.22 Vordefinierte Pausen (Inhaber 17.11.2026): Pause mit fester Dauer endet am Server von selbst – als echte
 * „pause_ende“-Buchung genau zu Beginn + Dauer; „Pause beenden“ früher ersetzt das geplante Ende; „offen“ wie bisher.
 * Alle Auswertungen (Status, Tagessummen, Kolonne, Anwesend, Monat, Lohn-CSV, Hinweise, Bautagesbericht, Korrekturen,
 * Offline-Nachbuchung) lesen dieselben Buchungen. Einstellung der angebotenen Dauern: allein Recht stammdaten.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');
const PA = require('../../server/pausen');

// Mi 18.11.2026 – nach den Testdaten (die enden am 12.11.); Wiener Zeit = UTC + 1
const TAG = '2026-11-18';
const um = (hm) => `${TAG}T${hm}:00.000+01:00`;
const iso = (hm) => new Date(um(hm)).toISOString();
const MA = U.mitarbeiter, DANIEL = 3, ROLAND = 4, FABIAN = 6;

async function umgebung(t) {
  const s = await starte();
  t.after(() => s.stop());
  // Personen dieses Tests ohne alte (offene) Schichten aus den Testdaten
  s.db.lauf(`DELETE FROM buchung WHERE benutzer_id IN (${[U.polier, MA, DANIEL, ROLAND, FABIAN, 14, 16].join(',')}) AND zeit >= '2026-11-10'`);
  s.db.lauf(`DELETE FROM abwesenheit WHERE datum = ?`, TAG);
  s.uhr.setze(um('07:00'));
  return s;
}
const buchungen = (s, id) => s.db.alle('SELECT typ, zeit, quelle, automatisch, pause_plan_min, pause_auto_bis FROM buchung WHERE benutzer_id = ? AND zeit >= ? ORDER BY zeit, id', id, iso('00:00'));

test('15.22 Stempeluhr: feste Dauer endet genau zu Beginn + Dauer, früheres Ende, offen unverändert', async (t) => {
  const s = await umgebung(t);
  const ma = await s.login(MA);

  await t.test('automatisches Ende genau nach 30 Min – ohne weiteres Zutun, auch ohne Anfrage der Person', async () => {
    assert.equal((await ma.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten })).status, 200);
    s.uhr.setze(um('12:00'));
    let r = await ma.post('/zeit/stempeln', { typ: 'pause_start', dauerMin: 30 });
    assert.equal(r.status, 200);
    assert.equal(r.daten.status, 'pause');
    assert.equal(r.daten.pauseBis, iso('12:30'));
    assert.equal(r.daten.pauseDauerMin, 30);
    assert.deepEqual(r.daten.pausenAuswahl, [30, 45, 60]);
    assert.equal(r.daten.heute.buchungen.at(-1).dauerMin, 30);
    s.uhr.setze('2026-11-18T11:29:59.999Z'); // 12:29:59,999
    r = await ma.get('/zeit/status');
    assert.equal(r.daten.status, 'pause');
    assert.equal(buchungen(s, MA).length, 2);
    // genau zum geplanten Ende: irgendeine Anfrage (hier ohne Anmeldung) trägt das Ende ein – das Handy der Person ist „aus“
    s.uhr.setze(um('12:30'));
    assert.equal((await s.client().get('/gesundheit')).status, 200);
    const b = buchungen(s, MA);
    assert.deepEqual(b.map((x) => x.typ), ['kommen', 'pause_start', 'pause_ende']);
    assert.equal(b[2].zeit, iso('12:30'));
    assert.equal(b[2].automatisch, 1);
    assert.equal(b[2].quelle, 'app');
    assert.equal(b[1].pause_auto_bis, null, 'Merker gelöscht');
    assert.equal(b[1].pause_plan_min, 30);
    s.uhr.setze(um('13:30'));
    r = await ma.get('/zeit/status');
    assert.equal(r.daten.status, 'arbeit');
    assert.equal(r.daten.seit, iso('12:30'));
    assert.equal(r.daten.pauseBis, null);
    assert.equal(r.daten.heute.pauseMin, 30);
    assert.equal(r.daten.heute.stunden, 6); // 07:00–13:30 minus 30 Min
    const ende = r.daten.heute.buchungen.find((x) => x.typ === 'pause_ende');
    assert.equal(ende.automatisch, true);
    assert.equal(ende.uhrzeit, '12:30');
  });

  await t.test('Hintergrundlauf (ohne jede Anfrage) trägt das Ende ebenfalls genau zum geplanten Zeitpunkt ein', async () => {
    s.uhr.setze(um('14:00'));
    assert.equal((await ma.post('/zeit/stempeln', { typ: 'pause_start', dauerMin: 45 })).status, 200);
    s.uhr.setze(um('16:00'));
    assert.equal(PA.pausenAbschliessen(s.db, s.uhr()), 1);
    assert.equal(PA.pausenAbschliessen(s.db, s.uhr()), 0, 'kein zweites Ende');
    const b = buchungen(s, MA).slice(-1)[0];
    assert.equal(b.typ, 'pause_ende');
    assert.equal(b.zeit, iso('14:45'));
  });

  await t.test('„Pause beenden“ nach dem automatischen Ende (veralteter Bildschirm) bucht nichts', async () => {
    const vorher = buchungen(s, MA).length;
    const r = await ma.post('/zeit/stempeln', { typ: 'pause_ende' });
    assert.equal(r.status, 200);
    assert.equal(r.daten.status, 'arbeit');
    assert.equal(buchungen(s, MA).length, vorher);
    assert.equal((await ma.post('/zeit/stempeln', { typ: 'gehen' })).status, 200);
  });

  await t.test('früheres „Pause beenden“ ersetzt das geplante Ende', async () => {
    const c = await s.login(DANIEL);
    s.uhr.setze(um('07:00'));
    // (Uhr zurück: neue Person, eigener Tag)
    assert.equal((await c.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten })).status, 200);
    s.uhr.setze(um('12:00'));
    assert.equal((await c.post('/zeit/stempeln', { typ: 'pause_start', dauerMin: 45 })).daten.pauseBis, iso('12:45'));
    s.uhr.setze(um('12:20'));
    let r = await c.post('/zeit/stempeln', { typ: 'pause_ende' });
    assert.equal(r.daten.status, 'arbeit');
    s.uhr.setze(um('15:00'));
    r = await c.get('/zeit/status');
    assert.equal(r.daten.heute.pauseMin, 20);
    const b = buchungen(s, DANIEL);
    assert.deepEqual(b.map((x) => [x.typ, x.zeit, x.automatisch]), [['kommen', iso('07:00'), 0], ['pause_start', iso('12:00'), 0], ['pause_ende', iso('12:20'), 0]]);
    assert.equal(b[1].pause_auto_bis, null);
    // „Gehen“ während einer geplanten Pause beendet sie ebenfalls (kein späteres automatisches Ende)
    assert.equal((await c.post('/zeit/stempeln', { typ: 'pause_start', dauerMin: 60 })).status, 200);
    s.uhr.setze(um('15:10'));
    assert.equal((await c.post('/zeit/stempeln', { typ: 'gehen' })).daten.status, 'aus');
    s.uhr.setze(um('17:00'));
    assert.equal((await c.get('/zeit/status')).daten.status, 'aus');
    assert.deepEqual(buchungen(s, DANIEL).slice(-2).map((x) => x.typ), ['pause_start', 'gehen']);
  });

  await t.test('„offen“ (ohne dauerMin) läuft wie bisher, bis sie beendet wird', async () => {
    const c = await s.login(ROLAND);
    s.uhr.setze(um('07:00'));
    await c.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
    s.uhr.setze(um('12:00'));
    let r = await c.post('/zeit/stempeln', { typ: 'pause_start' });
    assert.equal(r.daten.status, 'pause');
    assert.equal(r.daten.pauseBis, null);
    s.uhr.setze(um('15:00'));
    assert.equal(PA.pausenAbschliessen(s.db, s.uhr()), 0);
    r = await c.get('/zeit/status');
    assert.equal(r.daten.status, 'pause');
    assert.equal(r.daten.heute.pauseMin, 180);
    assert.equal((await c.post('/zeit/stempeln', { typ: 'pause_ende' })).daten.status, 'arbeit');
  });

  await t.test('Eingaben: 5–240 ganze Minuten, nur bei pause_start', async () => {
    const c = await s.login(FABIAN);
    await c.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
    for (const d of [4, 241, 30.5, '30', -5]) assert.equal((await c.post('/zeit/stempeln', { typ: 'pause_start', dauerMin: d })).status, 400, String(d));
    assert.equal((await c.post('/zeit/stempeln', { typ: 'gehen', dauerMin: 30 })).status, 400);
    assert.equal((await c.get('/zeit/status')).daten.status, 'arbeit');
    for (const d of [5, 240]) {
      assert.equal((await c.post('/zeit/stempeln', { typ: 'pause_start', dauerMin: d })).status, 200, String(d));
      assert.equal((await c.post('/zeit/stempeln', { typ: 'pause_ende' })).status, 200);
    }
  });
});

test('15.22 Offline: Pause mit Dauer nachgesendet – richtige Zeiten, früheres Offline-Ende ersetzt das automatische', async (t) => {
  const s = await umgebung(t);
  s.uhr.setze(um('18:00'));
  const ma = await s.login(MA);
  const off = (typ, hm, extra = {}) => ma.post('/zeit/stempeln', { typ, zeit: um(hm), ...extra });

  // Handy war den ganzen Tag ohne Netz: kommen 07:00, Pause 12:00 (30 Min, endet von selbst), gehen 16:00 – erst jetzt gesendet
  assert.equal((await off('kommen', '07:00', { baustelleId: BS.pitten })).status, 200);
  let r = await off('pause_start', '12:00', { dauerMin: 30 });
  assert.equal(r.status, 200);
  assert.equal(r.daten.status, 'arbeit', 'geplantes Ende liegt schon zurück');
  r = await off('gehen', '16:00');
  assert.equal(r.status, 200);
  assert.equal(r.daten.heute.pauseMin, 30);
  assert.equal(r.daten.heute.stunden, 8.5);
  let b = buchungen(s, MA);
  assert.deepEqual(b.map((x) => [x.typ, x.zeit, x.quelle, x.automatisch]), [
    ['kommen', iso('07:00'), 'offline', 0], ['pause_start', iso('12:00'), 'offline', 0], ['pause_ende', iso('12:30'), 'offline', 1], ['gehen', iso('16:00'), 'offline', 0]]);

  // zweite Person: Pause 45 Min offline begonnen, offline nach 10 Min beendet – das inzwischen eingetragene automatische
  // Ende (12:45) wird durch das frühere (12:10) ersetzt
  const c = await s.login(DANIEL);
  const off2 = (typ, hm, extra = {}) => c.post('/zeit/stempeln', { typ, zeit: um(hm), ...extra });
  await off2('kommen', '07:00', { baustelleId: BS.pitten });
  await off2('pause_start', '12:00', { dauerMin: 45 });
  assert.equal(buchungen(s, DANIEL).at(-1).zeit, iso('12:45'));
  r = await off2('pause_ende', '12:10');
  assert.equal(r.status, 200);
  b = buchungen(s, DANIEL);
  assert.deepEqual(b.map((x) => [x.typ, x.zeit, x.automatisch]), [['kommen', iso('07:00'), 0], ['pause_start', iso('12:00'), 0], ['pause_ende', iso('12:10'), 0]]);
  assert.ok(s.db.eins("SELECT 1 AS x FROM protokoll WHERE text LIKE 'Automatisches Pausenende 12:45 durch früheres „Pause beenden“ 12:10 ersetzt%'"));
  // Offline „Gehen“ mitten in einer geplanten Pause ersetzt das automatische Ende ebenso
  await off2('pause_start', '14:00', { dauerMin: 60 });
  r = await off2('gehen', '14:20');
  assert.equal(r.daten.status, 'aus');
  assert.deepEqual(buchungen(s, DANIEL).slice(-2).map((x) => [x.typ, x.zeit]), [['pause_start', iso('14:00')], ['gehen', iso('14:20')]]);
  assert.equal(r.daten.heute.pauseMin, 30); // 10 + 20
  // vor dem Beginn der Pause bleibt die Reihenfolge-Regel (409)
  await off2('kommen', '15:00', { baustelleId: BS.pitten });
  await off2('pause_start', '15:30', { dauerMin: 30 });
  assert.equal((await off2('pause_ende', '15:20')).status, 409);
});

test('15.22 Kolonne: „Alle in Pause“ mit Dauer – je Person automatisches Ende', async (t) => {
  const s = await umgebung(t);
  const pol = await s.login(U.polier);
  const crew = [U.polier, MA, DANIEL];
  let r = await pol.post('/zeit/kolonne', { typ: 'kommen', baustelleId: BS.pitten, benutzerIds: crew });
  assert.ok(r.daten.ergebnisse.every((x) => x.ok), JSON.stringify(r.daten));
  s.uhr.setze(um('12:00'));
  // Eingabefehler gelten für alle – nichts gebucht
  assert.equal((await pol.post('/zeit/kolonne', { typ: 'pause_start', baustelleId: BS.pitten, benutzerIds: crew, dauerMin: 300 })).status, 400);
  assert.equal((await pol.post('/zeit/kolonne', { typ: 'kommen', baustelleId: BS.pitten, benutzerIds: crew, dauerMin: 30 })).status, 400);
  r = await pol.post('/zeit/kolonne', { typ: 'pause_start', baustelleId: BS.pitten, benutzerIds: crew, dauerMin: 30 });
  assert.ok(r.daten.ergebnisse.every((x) => x.ok && x.status === 'pause'), JSON.stringify(r.daten));
  const liste = (await pol.get(`/zeit/kolonne?baustelleId=${BS.pitten}`)).daten;
  for (const id of crew) {
    const z = liste.find((x) => x.benutzerId === id);
    assert.equal(z.status, 'pause');
    assert.equal(z.pauseBis, iso('12:30'));
  }
  // Mitarbeiter beendet seine Pause früher selbst – nur für ihn
  s.uhr.setze(um('12:15'));
  const ma = await s.login(MA);
  assert.equal((await ma.post('/zeit/stempeln', { typ: 'pause_ende' })).daten.status, 'arbeit');
  s.uhr.setze(um('12:30'));
  const buero = await s.login(U.buero);
  const anw = (await buero.get('/zeit/anwesend')).daten;
  for (const id of crew) assert.equal(anw.find((x) => x.benutzerId === id).status, 'arbeit', `${id} nach 12:30 nicht mehr in Pause`);
  for (const id of [U.polier, DANIEL]) {
    const e = buchungen(s, id).at(-1);
    assert.deepEqual([e.typ, e.zeit, e.quelle, e.automatisch], ['pause_ende', iso('12:30'), 'kolonne', 1]);
  }
  assert.deepEqual(buchungen(s, MA).at(-1).zeit, iso('12:15'));
  assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM buchung WHERE typ = 'pause_ende' AND benutzer_id = ? AND zeit >= ?", MA, iso('00:00')).n, 1);
  // Status der Kolonne nach dem Ende
  const nach = (await pol.get(`/zeit/kolonne?baustelleId=${BS.pitten}`)).daten;
  for (const id of crew) assert.equal(nach.find((x) => x.benutzerId === id).pauseBis, null);
  // offen über die Kolonne: wie bisher
  r = await pol.post('/zeit/kolonne', { typ: 'pause_start', baustelleId: BS.pitten, benutzerIds: [DANIEL] });
  assert.ok(r.daten.ergebnisse[0].ok);
  s.uhr.setze(um('15:00'));
  assert.equal((await pol.get(`/zeit/kolonne?baustelleId=${BS.pitten}`)).daten.find((x) => x.benutzerId === DANIEL).status, 'pause');
});

test('15.22 Auswertungen: Monat, Lohn-CSV, Hinweise, Bautagesbericht und Korrekturen sehen dasselbe automatische Ende', async (t) => {
  const s = await umgebung(t);
  const ma = await s.login(MA);
  const buero = await s.login(U.buero);
  await ma.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
  s.uhr.setze(um('12:00'));
  await ma.post('/zeit/stempeln', { typ: 'pause_start', dauerMin: 30 });
  s.uhr.setze(um('16:00'));
  await ma.post('/zeit/stempeln', { typ: 'gehen' });
  // zweite Person: offene Pause, nach 15 Min beendet, 8,75 Std. → seit 15.38 keine AZG-Warnung „Pause“ mehr
  const c = await s.login(DANIEL);
  s.uhr.setze(um('07:00'));
  await c.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
  s.uhr.setze(um('12:00'));
  await c.post('/zeit/stempeln', { typ: 'pause_start' });
  s.uhr.setze(um('12:15'));
  await c.post('/zeit/stempeln', { typ: 'pause_ende' });
  s.uhr.setze(um('16:00'));
  await c.post('/zeit/stempeln', { typ: 'gehen' });
  s.uhr.setze(um('18:00'));

  await t.test('Monatsauswertung und Lohn-CSV', async () => {
    const m = (await buero.get('/monat?monat=2026-11')).daten;
    const z = m.mitarbeiter.find((x) => x.benutzerId === MA || x.id === MA).tage[TAG];
    assert.equal(z.stunden, 8.5);
    assert.equal(z.pauseMin, 30);
    assert.equal(z.von, '07:00');
    assert.equal(z.bis, '16:00');
    assert.ok(!m.warnungen.some((w) => (w.benutzerId === MA) && w.datum === TAG && w.typ === 'pause'), 'keine Pausenwarnung bei 30 Min automatisch');
    assert.ok(!m.warnungen.some((w) => w.benutzerId === DANIEL && w.datum === TAG && w.typ === 'pause'), 'Gegenprobe: 15 Min offen → seit 15.38 keine Warnung');
    assert.equal(m.mitarbeiter.find((x) => x.id === DANIEL).tage[TAG].pauseMin, 15, 'Gegenprobe: 15 Min Pause gezählt');
    const csv = (await buero.get('/monat/export.csv?monat=2026-11')).daten.toString('utf8');
    const zeile = csv.split(/\r?\n/).find((l) => l.includes('Lukas Brandstätter') && l.includes('18.11.2026'));
    assert.ok(zeile, csv.slice(0, 400));
    assert.match(zeile, /;07:00;16:00;30;8,5;/);
  });

  await t.test('Woche und Hinweise der Person (15.38: keine AZG-Warnung)', async () => {
    const w = (await ma.get(`/zeit/woche?datum=${TAG}`)).daten;
    const tag = (w.tage || []).find((x) => x.datum === TAG);
    assert.ok(tag, JSON.stringify(w).slice(0, 300));
    assert.equal(tag.stunden, 8.5);
    const st = (await c.get('/zeit/status')).daten;
    assert.ok(!st.warnungen.some((x) => x.typ === 'pause' || /AZG/.test(x.text)), JSON.stringify(st.warnungen));
    assert.ok(!(await ma.get('/zeit/status')).daten.warnungen.some((x) => x.typ === 'pause'));
  });

  await t.test('Bautagesbericht übernimmt die Stempelzeiten mit Pause', async () => {
    const r = await buero.post('/berichte', { baustelleId: BS.pitten, datum: TAG });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    const p = r.daten.personal.find((x) => x.benutzerId === MA);
    assert.deepEqual([p.von1, p.bis1, p.von2, p.bis2, p.pauseMin, p.stunden], ['07:00', '12:00', '12:30', '16:00', 30, 8.5]);
  });

  await t.test('Korrektur: automatisches Ende sichtbar und wie jede Buchung änderbar', async () => {
    const l = (await buero.get(`/zeit/buchungen?benutzerId=${MA}&von=${TAG}&bis=${TAG}`)).daten;
    const start = l.find((x) => x.typ === 'pause_start');
    const ende = l.find((x) => x.typ === 'pause_ende');
    assert.equal(start.dauerMin, 30);
    assert.equal(ende.automatisch, true);
    assert.equal(ende.uhrzeit, '12:30');
    const r = await buero.put(`/zeit/buchungen/${ende.id}`, { zeit: um('12:40'), grund: 'Pause länger gemacht' });
    assert.equal(r.status, 200);
    assert.equal(r.daten.automatisch, false);
    assert.equal(r.daten.quelle, 'buero');
    const m = (await buero.get('/monat?monat=2026-11')).daten;
    assert.equal(m.mitarbeiter.find((x) => x.benutzerId === MA || x.id === MA).tage[TAG].pauseMin, 40);
  });

  await t.test('Korrektur des Pausenbeginns verschiebt ein noch ausstehendes geplantes Ende mit', async () => {
    const f = await s.login(FABIAN);
    s.uhr.setze(um('18:00'));
    await f.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
    s.uhr.setze(um('19:00'));
    await f.post('/zeit/stempeln', { typ: 'pause_start', dauerMin: 60 });
    const id = s.db.eins("SELECT id FROM buchung WHERE benutzer_id = ? AND typ = 'pause_start' ORDER BY zeit DESC", FABIAN).id;
    s.uhr.setze(um('19:10'));
    assert.equal((await buero.put(`/zeit/buchungen/${id}`, { zeit: um('18:50'), grund: 'Pause früher begonnen' })).status, 200);
    assert.equal((await f.get('/zeit/status')).daten.pauseBis, iso('19:50'));
    s.uhr.setze(um('20:00'));
    assert.equal((await f.get('/zeit/status')).daten.seit, iso('19:50'));
  });
});

test('15.22 Einstellung „Vordefinierte Pausen“: allein Recht stammdaten (Bauleiter = Büro = GF), Prüfung der Werte', async (t) => {
  const s = await umgebung(t);
  const c = {};
  for (const [r, id] of Object.entries({ mitarbeiter: MA, polier: U.polier, bauleiter: U.bauleiter, buero: U.buero, gf: U.gf })) c[r] = await s.login(id);

  await t.test('Lesen und Ändern je Rolle', async () => {
    for (const r of ['mitarbeiter', 'polier']) {
      assert.equal((await c[r].get('/einstellungen/pausen')).status, 403, r);
      assert.equal((await c[r].put('/einstellungen/pausen', { auswahl: [15] })).status, 403, r);
    }
    const g = {};
    for (const r of ['bauleiter', 'buero', 'gf']) {
      const x = await c[r].get('/einstellungen/pausen');
      assert.equal(x.status, 200, r);
      g[r] = x.daten;
    }
    assert.deepEqual(g.bauleiter, g.buero, 'Bauleiter sieht dasselbe wie das Büro');
    assert.deepEqual(g.buero.auswahl, [30, 45, 60]);
    assert.equal(g.buero.offen, true);
    assert.deepEqual(PA.auswahl(s.db), [30, 45, 60]);
    // Bauleiter ändert wie das Büro
    let r = await c.bauleiter.put('/einstellungen/pausen', { auswahl: [60, 15, 30] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.daten.auswahl, [15, 30, 60]);
    r = await c.buero.put('/einstellungen/pausen', { auswahl: [20, 40] });
    assert.deepEqual(r.daten.auswahl, [20, 40]);
    assert.deepEqual((await c.gf.get('/einstellungen/pausen')).daten.auswahl, [20, 40]);
    // Stempeluhr (auch Polier/Mitarbeiter) bekommt die Auswahl über /zeit/status
    assert.deepEqual((await c.mitarbeiter.get('/zeit/status')).daten.pausenAuswahl, [20, 40]);
    assert.deepEqual((await c.polier.get('/zeit/status')).daten.pausenAuswahl, [20, 40]);
    assert.ok(s.db.eins("SELECT 1 AS x FROM protokoll WHERE art = 'einstellung' AND objekt = 'pausen' AND benutzer_id = ?", U.bauleiter));
  });

  await t.test('Werte: 5–240 ganze Minuten, höchstens 6, keine doppelten; leer = nur offen', async () => {
    for (const a of [[4], [241], [30, 30], [1, 2, 3, 4, 5, 6, 7].map((x) => x * 10), [30.5], ['30'], 'x', null]) {
      assert.equal((await c.buero.put('/einstellungen/pausen', { auswahl: a })).status, 400, JSON.stringify(a));
    }
    assert.equal((await c.buero.put('/einstellungen/pausen', {})).status, 400);
    assert.deepEqual((await c.buero.put('/einstellungen/pausen', { auswahl: [5, 10, 15, 20, 30, 240] })).daten.auswahl, [5, 10, 15, 20, 30, 240]);
    assert.deepEqual((await c.buero.put('/einstellungen/pausen', { auswahl: [] })).daten.auswahl, []);
    assert.deepEqual((await c.mitarbeiter.get('/zeit/status')).daten.pausenAuswahl, []);
    // die Einstellung bestimmt nur das Angebot – am Server gilt der Rahmen 5–240 (Offline-Nachbuchungen nach einer Änderung)
    await c.mitarbeiter.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
    assert.equal((await c.mitarbeiter.post('/zeit/stempeln', { typ: 'pause_start', dauerMin: 45 })).status, 200);
    await c.buero.put('/einstellungen/pausen', { auswahl: [30, 45, 60] });
  });
});
