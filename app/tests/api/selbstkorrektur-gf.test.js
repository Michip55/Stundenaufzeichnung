'use strict';
/**
 * API.md 15.29 – Selbstkorrektur durch die GF (Inhaber 19.11.2026).
 *
 * Die Geschäftsführung darf ihre eigenen Stempelzeiten über alle Korrektur-Aktionen selbst korrigieren
 * (Buchung nachtragen, ändern, löschen; Schicht nachtragen, löschen). Jede solche Korrektur wird im Protokoll mit dem
 * Zusatz „(Selbstkorrektur durch GF – Vier-Augen-Prinzip nicht eingehalten)“ und dem Kennzeichen `selbstkorrektur`
 * vermerkt; ein Grund bleibt Pflicht. Alle anderen (Büro, Bauleiter, Polier, Mitarbeiter) bleiben für die eigenen Zeiten
 * gesperrt (403, Datenbank unverändert). Korrekturen der GF an fremden Zeiten bleiben unverändert (kein Zusatz).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');

const ZUSATZ = ' (Selbstkorrektur durch GF – Vier-Augen-Prinzip nicht eingehalten)';

async function aufbau(t) {
  const s = await starte();
  t.after(() => s.stop());
  const c = {};
  for (const r of ['gf', 'buero', 'bauleiter', 'polier', 'mitarbeiter']) c[r] = await s.login(U[r]);
  const letztesProtokoll = () => s.db.eins("SELECT * FROM protokoll WHERE art = 'zeitkorrektur' ORDER BY id DESC LIMIT 1");
  const anzahl = () => ({
    buchung: s.db.eins('SELECT COUNT(*) AS n FROM buchung').n,
    protokoll: s.db.eins("SELECT COUNT(*) AS n FROM protokoll WHERE art = 'zeitkorrektur'").n,
    stand: JSON.stringify(s.db.alle('SELECT id, zeit, baustelle_id, quelle, erfasst_von FROM buchung ORDER BY id'))
  });
  /** Protokolleintrag der letzten Korrektur: Text mit/ohne Zusatz, Kennzeichen im „neu“ */
  const pruefeProtokoll = (beginn, selbst, wer = U.gf) => {
    const p = letztesProtokoll();
    assert.ok(p, 'kein Protokolleintrag');
    assert.equal(p.benutzer_id, wer);
    assert.ok(p.text.startsWith(beginn), `Protokolltext „${p.text}“ beginnt nicht mit „${beginn}“`);
    assert.equal(p.text.endsWith(ZUSATZ), selbst, `Protokolltext „${p.text}“: Zusatz ${selbst ? 'fehlt' : 'unerwartet'}`);
    const neu = p.neu ? JSON.parse(p.neu) : {};
    assert.equal(neu.selbstkorrektur === true, selbst, `Kennzeichen selbstkorrektur im Protokoll-„neu“: ${p.neu}`);
    return p;
  };
  return { s, c, letztesProtokoll, anzahl, pruefeProtokoll };
}

test('15.29: die GF korrigiert die eigenen Zeiten mit jeder Aktion – 200/201, Protokoll mit Zusatz und Kennzeichen', async (t) => {
  const { s, c, pruefeProtokoll } = await aufbau(t);

  // Schicht nachtragen (POST /zeit/schichten)
  const sch = await c.gf.post('/zeit/schichten', { benutzerId: U.gf, baustelleId: BS.pitten, datum: '2026-11-09', von: '07:00', bis: '15:00', pauseMin: 30, grund: 'Stempeln vergessen' });
  assert.equal(sch.status, 201, JSON.stringify(sch.daten));
  assert.equal(sch.daten.benutzerId, U.gf);
  assert.equal(sch.daten.selbstkorrektur, true, 'Schicht ohne Kennzeichen selbstkorrektur');
  const pSch = pruefeProtokoll('Schicht nachgetragen: Stempeln vergessen', true);
  assert.equal(pSch.text, `Schicht nachgetragen: Stempeln vergessen${ZUSATZ}`);
  assert.equal(JSON.parse(pSch.neu).benutzerId, U.gf);

  // Buchungen nachtragen (POST /zeit/buchungen): kommen, wechsel, gehen am 10.11.
  const neu = async (typ, zeit, baustelleId) => {
    const r = await c.gf.post('/zeit/buchungen', { benutzerId: U.gf, typ, zeit, ...(baustelleId ? { baustelleId } : {}), grund: `${typ} nachgetragen` });
    assert.equal(r.status, 201, `${typ}: ${r.status} ${JSON.stringify(r.daten)}`);
    assert.equal(r.daten.selbstkorrektur, true, `${typ}: Antwort ohne Kennzeichen selbstkorrektur`);
    assert.equal(r.daten.quelle, 'buero');
    assert.equal(r.daten.erfasstVon, U.gf);
    pruefeProtokoll(`Buchung nachgetragen: ${typ} nachgetragen`, true);
    return r.daten;
  };
  const kommen = await neu('kommen', '2026-11-10T07:00:00+01:00', BS.pitten);
  const wechsel = await neu('wechsel', '2026-11-10T11:00:00+01:00', BS.kogler);
  const gehen = await neu('gehen', '2026-11-10T15:00:00+01:00');

  // Buchung ändern (PUT /zeit/buchungen/:id)
  const ae = await c.gf.put(`/zeit/buchungen/${gehen.id}`, { zeit: '2026-11-10T15:30:00+01:00', grund: 'länger gearbeitet' });
  assert.equal(ae.status, 200, JSON.stringify(ae.daten));
  assert.equal(ae.daten.zeit, '2026-11-10T14:30:00.000Z');
  assert.equal(ae.daten.selbstkorrektur, true);
  pruefeProtokoll('Buchung korrigiert: länger gearbeitet', true);

  // Buchung löschen (DELETE /zeit/buchungen/:id)
  const lo = await c.gf.anfrage('DELETE', `/zeit/buchungen/${wechsel.id}`, { grund: 'kein Wechsel' });
  assert.equal(lo.status, 200, JSON.stringify(lo.daten));
  assert.ok(!s.db.eins('SELECT id FROM buchung WHERE id = ?', wechsel.id), 'gelöschte Buchung noch da');
  pruefeProtokoll('Buchung gelöscht: kein Wechsel', true);

  // eigene Liste: Buchungen und Schichten tragen das Kennzeichen
  const liste = (await c.gf.get(`/zeit/buchungen?benutzerId=${U.gf}&von=2026-11-09&bis=2026-11-10`)).daten;
  assert.ok(liste.length >= 6 && liste.every((b) => b.selbstkorrektur === true), JSON.stringify(liste));
  const schichten = (await c.gf.get(`/zeit/schichten?benutzerId=${U.gf}&von=2026-11-09&bis=2026-11-10`)).daten;
  assert.equal(schichten.length, 2);
  assert.ok(schichten.every((x) => x.selbstkorrektur === true));
  // das Büro sieht die Markierung an den Zeiten der GF ebenso
  const bListe = (await c.buero.get(`/zeit/buchungen?benutzerId=${U.gf}&von=2026-11-09&bis=2026-11-10`)).daten;
  assert.ok(bListe.every((b) => b.selbstkorrektur === true));

  // Schicht löschen (DELETE /zeit/schichten/:id)
  const sl = await c.gf.anfrage('DELETE', `/zeit/schichten/${kommen.id}`, { grund: 'doppelt erfasst' });
  assert.equal(sl.status, 200, JSON.stringify(sl.daten));
  assert.equal(sl.daten.geloescht, 2);
  pruefeProtokoll('Schicht gelöscht: doppelt erfasst', true);

  // Protokoll-Liste (Benutzer → Protokoll): jede Selbstkorrektur erkennbar
  const prot = (await c.gf.get('/rechte')).daten.protokoll.filter((p) => p.art === 'zeitkorrektur');
  assert.equal(prot.length, 7);
  assert.ok(prot.every((p) => p.selbstkorrektur === true && p.text.endsWith(ZUSATZ)), JSON.stringify(prot.map((p) => p.text)));
});

test('15.29: Grund bleibt Pflicht, Zeitgrenzen und Stempelfolge gelten auch für die Selbstkorrektur der GF', async (t) => {
  const { c, anzahl } = await aufbau(t);
  const vorher = anzahl();
  assert.equal((await c.gf.post('/zeit/schichten', { benutzerId: U.gf, baustelleId: BS.pitten, datum: '2026-11-09', von: '07:00', bis: '15:00', pauseMin: 30 })).status, 400);
  assert.equal((await c.gf.post('/zeit/buchungen', { benutzerId: U.gf, typ: 'kommen', baustelleId: BS.pitten, zeit: '2026-11-10T07:00:00+01:00', grund: 'x' })).status, 400); // Grund zu kurz
  assert.equal((await c.gf.post('/zeit/buchungen', { benutzerId: U.gf, typ: 'gehen', zeit: '2026-11-10T07:00:00+01:00', grund: 'ohne kommen' })).status, 409); // Stempelfolge
  assert.equal((await c.gf.post('/zeit/schichten', { benutzerId: U.gf, baustelleId: BS.pitten, datum: '2026-11-30', von: '07:00', bis: '15:00', pauseMin: 0, grund: 'Zukunft' })).status, 400);
  assert.deepEqual(anzahl(), vorher);
  const sch = (await c.gf.post('/zeit/schichten', { benutzerId: U.gf, baustelleId: BS.pitten, datum: '2026-11-09', von: '07:00', bis: '15:00', pauseMin: 0, grund: 'nachgetragen' })).daten;
  const zwischen = anzahl();
  assert.equal((await c.gf.put(`/zeit/buchungen/${sch.buchungIds[1]}`, { zeit: '2026-11-09T16:00:00+01:00' })).status, 400);
  assert.equal((await c.gf.anfrage('DELETE', `/zeit/buchungen/${sch.buchungIds[0]}`, {})).status, 400);
  assert.equal((await c.gf.anfrage('DELETE', `/zeit/schichten/${sch.id}`, {})).status, 400);
  assert.deepEqual(anzahl(), zwischen);
});

test('15.29: Büro, Bauleiter, Polier und Mitarbeiter korrigieren die eigenen Zeiten weiterhin nicht (403, nichts geändert)', async (t) => {
  const { s, c, anzahl } = await aufbau(t);
  // eigene Buchungen über die Stempeluhr (kommen 06:00 Wiener Zeit-Nähe → jetzt), dann gehen
  const eigene = {};
  for (const r of ['buero', 'bauleiter', 'polier', 'mitarbeiter']) {
    if (r === 'polier' || r === 'mitarbeiter') { // haben schon Seed-Buchungen (11.11.)
      eigene[r] = s.db.eins("SELECT id FROM buchung WHERE benutzer_id = ? AND typ = 'kommen' ORDER BY zeit DESC LIMIT 1", U[r]).id;
      continue;
    }
    const k = await c[r].post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
    assert.equal(k.status, 200, `${r} kommen: ${JSON.stringify(k.daten)}`);
    s.uhr.plus(30);
    assert.equal((await c[r].post('/zeit/stempeln', { typ: 'gehen' })).status, 200);
    eigene[r] = s.db.eins("SELECT id FROM buchung WHERE benutzer_id = ? AND typ = 'kommen' ORDER BY zeit DESC LIMIT 1", U[r]).id;
  }
  const vorher = anzahl();
  for (const r of ['buero', 'bauleiter', 'polier', 'mitarbeiter']) {
    const id = U[r];
    const kommenId = eigene[r];
    const gehenId = s.db.eins("SELECT id FROM buchung WHERE benutzer_id = ? AND typ = 'gehen' ORDER BY zeit DESC LIMIT 1", id).id;
    const proben = [
      ['POST', '/zeit/buchungen', { benutzerId: id, typ: 'kommen', baustelleId: BS.pitten, zeit: '2026-11-09T07:00:00+01:00', grund: 'eigene Zeit' }],
      ['PUT', `/zeit/buchungen/${gehenId}`, { zeit: '2026-11-12T10:20:00+01:00', grund: 'eigene Zeit' }],
      ['DELETE', `/zeit/buchungen/${gehenId}`, { grund: 'eigene Zeit' }],
      ['POST', '/zeit/schichten', { benutzerId: id, baustelleId: BS.pitten, datum: '2026-11-09', von: '07:00', bis: '15:00', pauseMin: 30, grund: 'eigene Zeit' }],
      ['DELETE', `/zeit/schichten/${kommenId}`, { grund: 'eigene Zeit' }]
    ];
    for (const [m, p, body] of proben) {
      const a = await c[r].anfrage(m, p, body);
      assert.equal(a.status, 403, `${r} ${m} ${p}: ${a.status} ${JSON.stringify(a.daten)}`);
      if (r === 'buero' || r === 'bauleiter') assert.match(a.daten.fehler, /Vier-Augen-Prinzip/, `${r} ${m} ${p}: ${a.daten.fehler}`);
    }
  }
  assert.deepEqual(anzahl(), vorher, 'Ablehnung hat Buchungen oder Protokoll verändert');
  // auch mit allen vergebbaren Ausnahmen bleibt das Büro gesperrt (die Ausnahme hängt an keinem Recht)
  for (const recht of ['kolonne']) assert.equal((await c.gf.put('/rechte/ausnahme', { benutzerId: U.buero, recht, wert: true })).status, 200);
  assert.equal((await c.buero.post('/zeit/schichten', { benutzerId: U.buero, baustelleId: BS.pitten, datum: '2026-11-09', von: '07:00', bis: '15:00', pauseMin: 30, grund: 'eigene Zeit' })).status, 403);
  assert.equal((await c.gf.put('/rechte/ausnahme', { benutzerId: U.buero, recht: 'benutzer', wert: true })).status, 400); // GF-Recht ist für das Büro gesperrt
});

test('15.29: Korrekturen fremder Zeiten bleiben unverändert – kein Zusatz, kein Kennzeichen (GF und Büro)', async (t) => {
  const { s, c, pruefeProtokoll } = await aufbau(t);
  // GF korrigiert einen Mitarbeiter
  const sch = await c.gf.post('/zeit/schichten', { benutzerId: 3, baustelleId: BS.pitten, datum: '2026-11-07', von: '07:00', bis: '15:00', pauseMin: 30, grund: 'Kolonne vergessen' });
  assert.equal(sch.status, 201, JSON.stringify(sch.daten));
  assert.equal(sch.daten.selbstkorrektur, undefined);
  pruefeProtokoll('Schicht nachgetragen: Kolonne vergessen', false);
  const b = await c.gf.post('/zeit/buchungen', { benutzerId: 3, typ: 'wechsel', baustelleId: BS.kogler, zeit: '2026-11-07T09:00:00+01:00', grund: 'Wechsel vergessen' });
  assert.equal(b.status, 201);
  assert.equal(b.daten.selbstkorrektur, undefined);
  pruefeProtokoll('Buchung nachgetragen: Wechsel vergessen', false);
  assert.equal((await c.gf.put(`/zeit/buchungen/${b.daten.id}`, { zeit: '2026-11-07T09:30:00+01:00', grund: 'später gewechselt' })).status, 200);
  pruefeProtokoll('Buchung korrigiert: später gewechselt', false);
  assert.equal((await c.gf.anfrage('DELETE', `/zeit/buchungen/${b.daten.id}`, { grund: 'doch kein Wechsel' })).status, 200);
  pruefeProtokoll('Buchung gelöscht: doch kein Wechsel', false);
  assert.equal((await c.gf.anfrage('DELETE', `/zeit/schichten/${sch.daten.id}`, { grund: 'irrtümlich' })).status, 200);
  pruefeProtokoll('Schicht gelöscht: irrtümlich', false);

  // Büro korrigiert die (selbst korrigierte) Zeit der GF: ganz normal, ohne Zusatz – die Buchung ist danach keine Selbstkorrektur mehr
  const eigen = (await c.gf.post('/zeit/schichten', { benutzerId: U.gf, baustelleId: BS.pitten, datum: '2026-11-10', von: '07:00', bis: '15:00', pauseMin: 0, grund: 'Stempeln vergessen' })).daten;
  assert.equal(eigen.selbstkorrektur, true);
  const gehenId = eigen.buchungIds[eigen.buchungIds.length - 1];
  const r = await c.buero.put(`/zeit/buchungen/${gehenId}`, { zeit: '2026-11-10T14:00:00+01:00', grund: 'laut Bauleiter' });
  assert.equal(r.status, 200, JSON.stringify(r.daten));
  assert.equal(r.daten.selbstkorrektur, undefined);
  pruefeProtokoll('Buchung korrigiert: laut Bauleiter', false, U.buero);
  const k = s.db.eins('SELECT * FROM buchung WHERE id = ?', eigen.id);
  assert.equal(k.erfasst_von, U.gf, 'kommen bleibt Selbstkorrektur der GF');
  assert.equal((await c.buero.get(`/zeit/buchungen?benutzerId=${U.gf}&von=2026-11-10&bis=2026-11-10`)).daten.find((x) => x.id === eigen.id).selbstkorrektur, true);
  // gewöhnliche Stempelungen der GF (Quelle App) sind nie markiert
  const st = await c.gf.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
  assert.equal(st.status, 200, JSON.stringify(st.daten));
  const heute = (await c.gf.get(`/zeit/buchungen?benutzerId=${U.gf}&von=2026-11-12&bis=2026-11-12`)).daten;
  assert.ok(heute.length === 1 && heute[0].quelle === 'app' && heute[0].selbstkorrektur === undefined, JSON.stringify(heute));
});
