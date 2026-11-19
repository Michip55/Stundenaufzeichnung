'use strict';
/**
 * 15.27 Pause beim Gehen (Inhaber 19.11.2026): „Gehen“ mit nachgetragener Pause `pauseBeimGehen: {beginn, dauerMin}` –
 * nur eigene laufende Schicht, nur ohne Pause in dieser Schicht, Pause ganz zwischen Kommen und Gehen, keine andere Buchung
 * darin, Dauer aus der Auswahl (offline nachgesendet: Rahmen 5–240). Eingetragen als gewöhnliche Pausenbuchungen
 * (`nachgetragen = 1`) – Status, Tagessummen, Woche, Monat, Lohn-CSV, AZG, Bautagesbericht und Korrekturen rechnen wie bei
 * einer gestempelten Pause. Protokoll „Pause beim Gehen nachgetragen (30 Min ab 12:00)“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');

const TAG = '2026-11-18'; // Mi – nach den Testdaten; Wiener Zeit = UTC + 1
const um = (hm) => `${TAG}T${hm}:00.000+01:00`;
const iso = (hm) => new Date(um(hm)).toISOString();
const MA = U.mitarbeiter, DANIEL = 3, ROLAND = 4, FABIAN = 6;

async function umgebung(t) {
  const s = await starte();
  t.after(() => s.stop());
  s.db.lauf(`DELETE FROM buchung WHERE benutzer_id IN (${[U.polier, MA, DANIEL, ROLAND, FABIAN].join(',')}) AND zeit >= '2026-11-10'`);
  s.db.lauf('DELETE FROM abwesenheit WHERE datum = ?', TAG);
  s.uhr.setze(um('07:00'));
  return s;
}
const buchungen = (s, id) => s.db.alle('SELECT id, typ, zeit, quelle, baustelle_id, automatisch, nachgetragen, pause_plan_min, pause_auto_bis FROM buchung WHERE benutzer_id = ? AND zeit >= ? ORDER BY zeit, id', id, iso('00:00'));

test('15.27 Migration 53: Kennzeichen „nachgetragen“ an jeder Buchung, Bestand 0', async (t) => {
  const s = await umgebung(t);
  assert.ok(s.db.eins('SELECT 1 AS x FROM schema_version WHERE version = 53'));
  assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM buchung WHERE nachgetragen <> 0').n, 0);
});

test('15.27 Gehen mit nachgetragener Pause: Buchungen, Status, Protokoll, alle Auswertungen wie eine gestempelte Pause', async (t) => {
  const s = await umgebung(t);
  const ma = await s.login(MA);
  const buero = await s.login(U.buero);
  let r = await ma.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
  assert.equal(r.status, 200);
  assert.equal(r.daten.pauseInSchicht, false);
  s.uhr.setze(um('16:00'));
  r = await ma.get('/zeit/status');
  assert.equal(r.daten.pauseInSchicht, false);
  assert.ok(r.daten.warnungen.some((w) => w.typ === 'pause'), 'vorher: 9 Std. ohne Pause → AZG-Hinweis');

  r = await ma.post('/zeit/stempeln', { typ: 'gehen', pauseBeimGehen: { beginn: um('12:00'), dauerMin: 30 } });
  assert.equal(r.status, 200, JSON.stringify(r.daten));
  assert.equal(r.daten.status, 'aus');
  assert.equal(r.daten.heute.pauseMin, 30);
  assert.equal(r.daten.heute.stunden, 8.5);
  assert.ok(!r.daten.warnungen.some((w) => w.typ === 'pause'), 'keine AZG-Pausenwarnung bei 30 Min');
  const hb = r.daten.heute.buchungen;
  assert.deepEqual(hb.map((x) => [x.typ, x.uhrzeit, !!x.nachgetragen]), [['kommen', '07:00', false], ['pause_start', '12:00', true], ['pause_ende', '12:30', true], ['gehen', '16:00', false]]);
  assert.equal(hb[1].dauerMin, 30);

  const b = buchungen(s, MA);
  assert.deepEqual(b.map((x) => x.typ), ['kommen', 'pause_start', 'pause_ende', 'gehen']);
  assert.equal(b[1].zeit, iso('12:00'));
  assert.equal(b[2].zeit, iso('12:30'));
  assert.deepEqual([b[1].nachgetragen, b[2].nachgetragen, b[0].nachgetragen, b[3].nachgetragen], [1, 1, 0, 0]);
  assert.deepEqual([b[1].quelle, b[2].quelle], ['app', 'app']);
  assert.deepEqual([b[1].baustelle_id, b[2].baustelle_id], [BS.pitten, BS.pitten]);
  assert.equal(b[1].pause_plan_min, 30);
  assert.equal(b[1].pause_auto_bis, null, 'kein automatisches Ende – das Ende ist schon eingetragen');
  assert.equal(b[2].automatisch, 0);
  const p = s.db.eins("SELECT * FROM protokoll WHERE art = 'zeit' AND objekt = ?", `buchung:${b[1].id}`);
  assert.ok(p, 'Protokoll fehlt');
  assert.equal(p.text, 'Pause beim Gehen nachgetragen (30 Min ab 12:00)');
  assert.equal(p.benutzer_id, MA);
  assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM benachrichtigung WHERE benutzer_id = ? AND typ = 'azg'", MA).n, 0, 'keine AZG-Benachrichtigung nach dem Gehen');

  // Gegenprobe: gleiche Schicht ohne Pause → AZG-Hinweis und Benachrichtigung
  const c = await s.login(DANIEL);
  s.uhr.setze(um('07:00'));
  await c.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
  s.uhr.setze(um('16:00'));
  r = await c.post('/zeit/stempeln', { typ: 'gehen' });
  assert.equal(r.status, 200);
  assert.ok(r.daten.warnungen.some((w) => w.typ === 'pause'));
  assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM benachrichtigung WHERE benutzer_id = ? AND typ = 'azg'", DANIEL).n >= 1, true);
  s.uhr.setze(um('18:00'));

  await t.test('Monatsauswertung und Lohn-CSV', async () => {
    const m = (await buero.get('/monat?monat=2026-11')).daten;
    const z = m.mitarbeiter.find((x) => x.benutzerId === MA || x.id === MA).tage[TAG];
    assert.equal(z.stunden, 8.5);
    assert.equal(z.pauseMin, 30);
    assert.ok(!m.warnungen.some((w) => w.benutzerId === MA && w.datum === TAG && w.typ === 'pause'));
    assert.ok(m.warnungen.some((w) => w.benutzerId === DANIEL && w.datum === TAG && w.typ === 'pause'));
    const csv = (await buero.get('/monat/export.csv?monat=2026-11')).daten.toString('utf8');
    const zeile = csv.split(/\r?\n/).find((l) => l.includes('Lukas Brandstätter') && l.includes('18.11.2026'));
    assert.match(zeile, /;07:00;16:00;30;8,5;/);
  });
  await t.test('Meine Woche', async () => {
    const tag = (await ma.get(`/zeit/woche?datum=${TAG}`)).daten.tage.find((x) => x.datum === TAG);
    assert.equal(tag.stunden, 8.5);
  });
  await t.test('Bautagesbericht übernimmt die Pause', async () => {
    const rb = await buero.post('/berichte', { baustelleId: BS.pitten, datum: TAG });
    assert.equal(rb.status, 201, JSON.stringify(rb.daten));
    const z = rb.daten.personal.find((x) => x.benutzerId === MA);
    assert.deepEqual([z.von1, z.bis1, z.von2, z.bis2, z.pauseMin, z.stunden], ['07:00', '12:00', '12:30', '16:00', 30, 8.5]);
  });
  await t.test('Korrekturen: erkennbar nachgetragen; eine Büro-Korrektur macht daraus eine Büro-Buchung', async () => {
    const l = (await buero.get(`/zeit/buchungen?benutzerId=${MA}&von=${TAG}&bis=${TAG}`)).daten;
    assert.deepEqual(l.map((x) => x.nachgetragen), [false, true, true, false]);
    assert.equal(l[1].dauerMin, 30);
    const k = await buero.put(`/zeit/buchungen/${l[2].id}`, { zeit: um('12:45'), grund: 'Pause länger gemacht' });
    assert.equal(k.status, 200);
    assert.equal(k.daten.nachgetragen, false);
    assert.equal(k.daten.quelle, 'buero');
    const m = (await buero.get('/monat?monat=2026-11')).daten;
    assert.equal(m.mitarbeiter.find((x) => x.benutzerId === MA || x.id === MA).tage[TAG].pauseMin, 45);
  });
});

test('15.27 pauseInSchicht im Status: nach einer gestempelten Pause true, nach dem Gehen wieder false', async (t) => {
  const s = await umgebung(t);
  const ma = await s.login(MA);
  await ma.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
  s.uhr.setze(um('12:00'));
  await ma.post('/zeit/stempeln', { typ: 'pause_start', dauerMin: 30 });
  s.uhr.setze(um('13:00'));
  let r = await ma.get('/zeit/status');
  assert.equal(r.daten.status, 'arbeit');
  assert.equal(r.daten.pauseInSchicht, true);
  s.uhr.setze(um('15:00'));
  r = await ma.post('/zeit/stempeln', { typ: 'gehen', pauseBeimGehen: { beginn: um('13:30'), dauerMin: 30 } });
  assert.equal(r.status, 409, 'zweite Pause in derselben Schicht nicht nachtragen');
  assert.match(r.daten.fehler, /schon eine Pause gebucht/);
  assert.equal(buchungen(s, MA).length, 3, 'nichts gebucht');
  r = await ma.post('/zeit/stempeln', { typ: 'gehen' });
  assert.equal(r.status, 200);
  assert.equal(r.daten.pauseInSchicht, false);
  // neue Schicht am selben Tag: wieder ohne Pause
  s.uhr.setze(um('17:00'));
  r = await ma.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
  assert.equal(r.daten.pauseInSchicht, false);
});

test('15.27 Ablehnungen: klare Meldung, nichts gebucht (weder Pause noch Gehen)', async (t) => {
  const s = await umgebung(t);
  const ma = await s.login(MA);
  await ma.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
  s.uhr.setze(um('15:00'));
  const vorher = buchungen(s, MA).length;
  const fall = async (body, status, muster) => {
    const r = await ma.post('/zeit/stempeln', body);
    assert.equal(r.status, status, `${JSON.stringify(body)} → ${r.status} ${JSON.stringify(r.daten)}`);
    if (muster) assert.match(r.daten.fehler, muster);
    assert.equal(buchungen(s, MA).length, vorher, `${JSON.stringify(body)}: etwas gebucht`);
    assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM protokoll WHERE text LIKE 'Pause beim Gehen%'").n, 0);
  };
  await fall({ typ: 'pause_start', pauseBeimGehen: { beginn: um('12:00'), dauerMin: 30 } }, 400, /nur bei „gehen“/);
  await fall({ typ: 'gehen', pauseBeimGehen: 'mittag' }, 400);
  await fall({ typ: 'gehen', pauseBeimGehen: { beginn: '2026-11-18T12:00', dauerMin: 30 } }, 400, /Zeitzone/);
  await fall({ typ: 'gehen', pauseBeimGehen: { beginn: um('12:00') } }, 400, /dauerMin/);
  await fall({ typ: 'gehen', pauseBeimGehen: { beginn: um('12:00'), dauerMin: 30.5 } }, 400);
  await fall({ typ: 'gehen', pauseBeimGehen: { beginn: um('12:00'), dauerMin: 25 } }, 400, /nicht zur Auswahl \(30 Min, 45 Min, 60 Min\)/);
  await fall({ typ: 'gehen', pauseBeimGehen: { beginn: um('12:00'), dauerMin: 500 } }, 400);
  await fall({ typ: 'gehen', pauseBeimGehen: { beginn: um('06:45'), dauerMin: 30 } }, 400, /frühestens um 07:00 Uhr/);
  await fall({ typ: 'gehen', pauseBeimGehen: { beginn: um('14:45'), dauerMin: 30 } }, 400, /bis 15:00 Uhr zu Ende/);
  await fall({ typ: 'gehen', pauseBeimGehen: { beginn: um('15:30'), dauerMin: 30 } }, 400, /bis 15:00 Uhr zu Ende/);
  // Baustellenwechsel um 10:00: die Pause darf ihn nicht einschließen (auch nicht genau am Ende)
  s.uhr.setze(um('10:00'));
  await ma.post('/zeit/stempeln', { typ: 'wechsel', baustelleId: BS.kogler });
  s.uhr.setze(um('15:00'));
  const mitWechsel = buchungen(s, MA).length;
  for (const beginn of ['09:45', '09:30']) {
    const r = await ma.post('/zeit/stempeln', { typ: 'gehen', pauseBeimGehen: { beginn: um(beginn), dauerMin: 30 } });
    assert.equal(r.status, 400, beginn);
    assert.match(r.daten.fehler, /Um 10:00 Uhr ist eine andere Buchung \(Baustelle gewechselt\)/);
    assert.equal(buchungen(s, MA).length, mitWechsel);
  }
  // in der Pause: Gehen beendet sie ohne Nachtrag
  await ma.post('/zeit/stempeln', { typ: 'pause_start' });
  let r = await ma.post('/zeit/stempeln', { typ: 'gehen', pauseBeimGehen: { beginn: um('12:00'), dauerMin: 30 } });
  assert.equal(r.status, 409);
  assert.match(r.daten.fehler, /Gerade läuft eine Pause/);
  r = await ma.post('/zeit/stempeln', { typ: 'gehen' });
  assert.equal(r.status, 200);
  // nicht eingestempelt
  r = await ma.post('/zeit/stempeln', { typ: 'gehen', pauseBeimGehen: { beginn: um('12:00'), dauerMin: 30 } });
  assert.equal(r.status, 409);
  assert.match(r.daten.fehler, /Nicht eingestempelt/);
});

test('15.27 Schicht kürzer als die Pause; Pause genau ab Kommen bzw. ab dem Wechsel; Baustelle der Pause', async (t) => {
  const s = await umgebung(t);
  const ma = await s.login(MA);
  s.uhr.setze(um('13:00'));
  await ma.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
  s.uhr.setze(um('13:20'));
  let r = await ma.post('/zeit/stempeln', { typ: 'gehen', pauseBeimGehen: { beginn: um('13:00'), dauerMin: 30 } });
  assert.equal(r.status, 400);
  assert.match(r.daten.fehler, /Seit dem Kommen um 13:00 Uhr sind keine 30 Min vergangen/);
  s.uhr.setze(um('14:00'));
  await ma.post('/zeit/stempeln', { typ: 'wechsel', baustelleId: BS.kogler });
  s.uhr.setze(um('18:00'));
  r = await ma.post('/zeit/stempeln', { typ: 'gehen', pauseBeimGehen: { beginn: um('14:00'), dauerMin: 45 } });
  assert.equal(r.status, 200, JSON.stringify(r.daten));
  const b = buchungen(s, MA);
  assert.deepEqual(b.map((x) => [x.typ, x.baustelle_id]), [['kommen', BS.pitten], ['wechsel', BS.kogler], ['pause_start', BS.kogler], ['pause_ende', BS.kogler], ['gehen', BS.kogler]]);
  assert.equal(r.daten.heute.pauseMin, 45);
  assert.equal(r.daten.heute.stunden, 4.25);
  assert.ok(s.db.eins("SELECT 1 AS x FROM protokoll WHERE text = 'Pause beim Gehen nachgetragen (45 Min ab 14:00)'"));
  // Pause genau ab dem Kommen
  const d = await s.login(DANIEL);
  s.uhr.setze(um('06:00'));
  await d.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
  s.uhr.setze(um('09:00'));
  r = await d.post('/zeit/stempeln', { typ: 'gehen', pauseBeimGehen: { beginn: um('06:00'), dauerMin: 60 } });
  assert.equal(r.status, 200, JSON.stringify(r.daten));
  assert.equal(r.daten.heute.stunden, 2);
});

test('15.27 ohne Netz: Kommen und „Gehen mit Pause“ aus der Warteschlange in der richtigen Reihenfolge, Rahmen statt Auswahl', async (t) => {
  const s = await umgebung(t);
  const ma = await s.login(MA);
  const kopf = { 'x-bautag-ersteller': String(MA) };
  s.uhr.setze(um('15:30')); // Netz wieder da – beide Buchungen kommen jetzt mit ihren ursprünglichen Zeiten an
  let r = await ma.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten, zeit: um('07:00'), quelle: 'offline' }, kopf);
  assert.equal(r.status, 200, JSON.stringify(r.daten));
  r = await ma.post('/zeit/stempeln', { typ: 'gehen', zeit: um('15:00'), quelle: 'offline', pauseBeimGehen: { beginn: um('12:00'), dauerMin: 45 } }, kopf);
  assert.equal(r.status, 200, JSON.stringify(r.daten));
  let b = buchungen(s, MA);
  assert.deepEqual(b.map((x) => [x.typ, x.zeit, x.quelle, x.nachgetragen]), [
    ['kommen', iso('07:00'), 'offline', 0], ['pause_start', iso('12:00'), 'offline', 1], ['pause_ende', iso('12:45'), 'offline', 1], ['gehen', iso('15:00'), 'offline', 0]]);
  assert.equal(r.daten.heute.stunden, 7.25);
  // nach dem Gehen eine neue Schicht – die nächste Offline-Buchung reiht sich dahinter ein
  r = await ma.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten, zeit: um('15:20'), quelle: 'offline' }, kopf);
  assert.equal(r.status, 200);
  // Eine Dauer, die nicht (mehr) angeboten wird, geht beim Nachsenden durch (Einstellung inzwischen geändert – wie 15.22)
  s.uhr.setze(um('21:00'));
  r = await ma.post('/zeit/stempeln', { typ: 'gehen', zeit: um('20:30'), pauseBeimGehen: { beginn: um('17:00'), dauerMin: 20 } }, kopf);
  assert.equal(r.status, 200, JSON.stringify(r.daten));
  b = buchungen(s, MA);
  assert.deepEqual(b.slice(-4).map((x) => [x.typ, x.zeit]), [['kommen', iso('15:20')], ['pause_start', iso('17:00')], ['pause_ende', iso('17:20')], ['gehen', iso('20:30')]]);
  // abgelehnt beim Nachsenden (Pause nach dem Gehen) → 400, die Warteschlange zeigt die Buchung als „nicht übernommen“
  await ma.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
  s.uhr.setze(um('23:00'));
  r = await ma.post('/zeit/stempeln', { typ: 'gehen', zeit: um('22:00'), pauseBeimGehen: { beginn: um('21:45'), dauerMin: 30 } }, kopf);
  assert.equal(r.status, 400);
  assert.equal((await ma.get('/zeit/status')).daten.status, 'arbeit');
});

test('15.27 Kolonne bleibt unverändert: kein Nachtrag über die Kolonne', async (t) => {
  const s = await umgebung(t);
  const pol = await s.login(U.polier);
  let r = await pol.post('/zeit/kolonne', { typ: 'kommen', baustelleId: BS.pitten, benutzerIds: [DANIEL] });
  assert.ok(r.daten.ergebnisse.every((x) => x.ok), JSON.stringify(r.daten));
  s.uhr.setze(um('16:00'));
  r = await pol.post('/zeit/kolonne', { typ: 'gehen', baustelleId: BS.pitten, benutzerIds: [DANIEL], pauseBeimGehen: { beginn: um('12:00'), dauerMin: 30 } });
  assert.ok(r.daten.ergebnisse.every((x) => x.ok), JSON.stringify(r.daten));
  assert.deepEqual(buchungen(s, DANIEL).map((x) => x.typ), ['kommen', 'gehen']);
});
