'use strict';
/**
 * API.md 15.30 – Prüfbefunde n8-g (nach dem Zusammenführen 15.27–15.30):
 *  - Korrektur der Uhrzeit (Büro und Selbstkorrektur der GF, 15.29): der Standort der ursprünglichen Stempelung wird entfernt
 *    (er gehört zum Moment des Stempelns); eine Änderung nur der Baustelle oder dieselbe Zeit behält ihn. Protokoll mit Vermerk.
 *  - Migration 55: Standorte, die ohne Einwilligung gespeichert wurden (bis 15.30 mit dem alten Geräteschalter), werden gelöscht;
 *    Standorte nach der Einwilligung bleiben.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { starte, U, BS } = require('./hilfe');
const { oeffneDatenbank } = require('../../server/db');
const { createApp } = require('../../server/index');

const PUNKT = { lat: 47.7343, lng: 16.1833, genauigkeit: 25 };

test('15.30 Prüfbefund n8-g: Uhrzeit korrigiert → Standort der ursprünglichen Stempelung entfernt', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  const buero = await s.login(U.buero);
  const ma = await s.login(U.mitarbeiter);
  const geo = (id) => s.db.eins('SELECT lat, lng, genauigkeit FROM buchung WHERE id = ?', id);
  const json = async (c, benutzerId, id) => (await c.get(`/zeit/buchungen?benutzerId=${benutzerId}&von=2026-11-12&bis=2026-11-12`)).daten.find((b) => b.id === id);
  const letzterText = () => s.db.eins("SELECT text, alt, neu FROM protokoll WHERE art = 'zeitkorrektur' ORDER BY id DESC LIMIT 1");

  // GF stempelt selbst mit Standort (Kommen, später Gehen)
  for (const c of [gf, ma]) assert.equal((await c.put('/auth/standort', { an: true })).status, 200);
  s.db.lauf("DELETE FROM buchung WHERE benutzer_id IN (?, ?) AND zeit >= '2026-11-12'", U.gf, U.mitarbeiter);
  s.uhr.setze('2026-11-12T05:24:00.000+01:00');
  let r = await gf.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten, standort: PUNKT });
  assert.equal(r.daten.standortGespeichert, true);
  const kommen = r.daten.buchungId;
  r = await ma.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten, standort: PUNKT });
  const maKommen = r.daten.buchungId;
  s.uhr.setze('2026-11-12T10:24:00.000+01:00');
  r = await gf.post('/zeit/stempeln', { typ: 'gehen', standort: PUNKT });
  const gehen = r.daten.buchungId;
  assert.deepEqual(geo(gehen), PUNKT);

  await t.test('nur die Baustelle geändert bzw. dieselbe Zeit → Standort bleibt', async () => {
    let p = await gf.put(`/zeit/buchungen/${kommen}`, { baustelleId: BS.kogler, grund: 'falsche Baustelle' });
    assert.equal(p.status, 200, JSON.stringify(p.daten));
    assert.deepEqual(p.daten.standort, PUNKT);
    assert.deepEqual(geo(kommen), PUNKT);
    assert.doesNotMatch(letzterText().text, /Standort/);
    const z = s.db.eins('SELECT zeit FROM buchung WHERE id = ?', kommen).zeit;
    p = await gf.put(`/zeit/buchungen/${kommen}`, { zeit: z, baustelleId: BS.pitten, grund: 'zurück auf Pitten' });
    assert.equal(p.status, 200);
    assert.deepEqual(geo(kommen), PUNKT);
  });

  await t.test('Selbstkorrektur der GF: Kommen zwei Stunden früher → kein Standort mehr, Protokoll mit Vermerk', async () => {
    const p = await gf.put(`/zeit/buchungen/${kommen}`, { zeit: '2026-11-12T03:24:00.000+01:00', grund: 'früher begonnen' });
    assert.equal(p.status, 200, JSON.stringify(p.daten));
    assert.equal(p.daten.standort, null);
    assert.equal(p.daten.selbstkorrektur, true);
    assert.deepEqual(geo(kommen), { lat: null, lng: null, genauigkeit: null });
    assert.equal((await json(gf, U.gf, kommen)).standort, null);
    assert.equal((await json(buero, U.gf, kommen)).standort, null);
    const pr = letzterText();
    assert.equal(pr.text, 'Buchung korrigiert: früher begonnen (Standort der ursprünglichen Stempelung entfernt) (Selbstkorrektur durch GF – Vier-Augen-Prinzip nicht eingehalten)');
    assert.equal(JSON.parse(pr.alt).standort, true);
    assert.equal(JSON.parse(pr.neu).standort, null);
    assert.ok(!JSON.stringify(pr).includes(String(PUNKT.lat)), 'Koordinaten im Protokoll');
    // das Gehen ist unberührt
    assert.deepEqual(geo(gehen), PUNKT);
  });

  await t.test('Büro ändert die Zeit einer Gehen-Buchung (ohne baustelleId) → 200, Standort entfernt', async () => {
    const p = await buero.put(`/zeit/buchungen/${gehen}`, { zeit: '2026-11-12T10:00:00.000+01:00', grund: 'laut Polier' });
    assert.equal(p.status, 200, JSON.stringify(p.daten));
    assert.equal(p.daten.standort, null);
    assert.equal(geo(gehen).lat, null);
    assert.match(letzterText().text, /^Buchung korrigiert: laut Polier \(Standort der ursprünglichen Stempelung entfernt\)$/);
    // fremde Buchung (Mitarbeiter) ebenso; ohne Standort kein Vermerk
    const q = await buero.put(`/zeit/buchungen/${maKommen}`, { zeit: '2026-11-12T05:30:00.000+01:00', grund: 'Uhr falsch' });
    assert.equal(q.status, 200);
    assert.equal(geo(maKommen).lat, null);
    const q2 = await buero.put(`/zeit/buchungen/${maKommen}`, { zeit: '2026-11-12T05:35:00.000+01:00', grund: 'noch einmal' });
    assert.equal(q2.status, 200);
    assert.equal(letzterText().text, 'Buchung korrigiert: noch einmal');
  });
});

test('15.30 Prüfbefund n8-g: Migration 55 löscht Standorte ohne Einwilligung (Aufrüsten von Stand 54)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bautag-mig55-'));
  const datei = path.join(dir, 'alt.db');
  try {
    const alt = oeffneDatenbank(datei, { bisVersion: 54 });
    assert.equal(alt.eins('SELECT MAX(version) AS v FROM schema_version').v, 54);
    const t0 = '2026-01-01T00:00:00.000Z';
    alt.lauf("INSERT INTO benutzer (id, name, rolle, pin_hash, aktiv, erstellt, standort_einwilligung) VALUES (50, 'Ohne Einwilligung', 'mitarbeiter', 'x', 1, ?, NULL)", t0);
    alt.lauf("INSERT INTO benutzer (id, name, rolle, pin_hash, aktiv, erstellt, standort_einwilligung) VALUES (51, 'Mit Einwilligung', 'mitarbeiter', 'x', 1, ?, '2026-11-10T08:00:00.000Z')", t0);
    alt.lauf("INSERT INTO baustelle (id, kst, name, erstellt) VALUES (1, '26-001', 'Probe', ?)", t0);
    const buche = (id, benutzerId, zeit, lat) => alt.lauf("INSERT INTO buchung (id, benutzer_id, typ, zeit, baustelle_id, quelle, erfasst_von, erfasst, lat, lng, genauigkeit) VALUES (?, ?, 'kommen', ?, 1, 'app', ?, ?, ?, ?, ?)",
      id, benutzerId, zeit, benutzerId, zeit, lat, lat == null ? null : 16.2, lat == null ? null : 9);
    buche(1, 50, '2026-11-09T06:00:00.000Z', 47.5); // alter Geräteschalter, nie eingewilligt
    buche(2, 51, '2026-11-09T06:00:00.000Z', 47.6); // vor der Einwilligung
    buche(3, 51, '2026-11-11T06:00:00.000Z', 47.7); // nach der Einwilligung
    buche(4, 50, '2026-11-11T06:00:00.000Z', null);
    alt.schliessen();

    const app = createApp({ dbPath: datei, uhr: () => new Date('2026-11-19T10:00:00Z'), seed: false, demo: false, loginListe: false });
    const { db } = app.locals.bt;
    try {
      assert.ok(db.eins('SELECT 1 AS x FROM schema_version WHERE version = 55'));
      const g = (id) => db.eins('SELECT lat, lng, genauigkeit FROM buchung WHERE id = ?', id);
      assert.deepEqual(g(1), { lat: null, lng: null, genauigkeit: null });
      assert.deepEqual(g(2), { lat: null, lng: null, genauigkeit: null });
      assert.deepEqual(g(3), { lat: 47.7, lng: 16.2, genauigkeit: 9 });
      assert.equal(db.eins('SELECT COUNT(*) AS n FROM buchung').n, 4, 'Buchungen selbst bleiben');
      assert.equal(db.eins('PRAGMA integrity_check').integrity_check, 'ok');
    } finally { db.schliessen(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
