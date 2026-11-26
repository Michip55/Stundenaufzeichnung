'use strict';
/**
 * 15.38 (Inhaber 25.11.2026): „Kannst du die Hinweise bzw. Warnungen zum Arbeitszeitgesetz bitte herausnehmen, die stören“.
 * Kein Hinweis mehr zu > 10 bzw. > 12 Std. am Tag, > 6 Std. ohne 30 Min. Pause und < 11 Std. Ruhezeit – weder in der
 * Stempeluhr (Status, Antwort auf „Gehen“) noch in der Glocke (Person und Lohnverrechnung), in der Monatsauswertung
 * (damit auch Übersicht und klassische Übersicht) oder in der Lohn-CSV. „Ausstempeln vergessen?“ (offen > 12 Std.) und
 * unplausible Schichten (> 16 Std., zählen mit 0 Std.) bleiben. Migration 58 löscht gespeicherte AZG-Benachrichtigungen.
 * Feste Uhr wie tests/api/hilfe.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { starte, U, BS } = require('./hilfe');
const { oeffneDatenbank } = require('../../server/db');
const { createApp } = require('../../server/index');

const AZG_TYPEN = ['tag_10h', 'tag_12h', 'pause', 'ruhezeit'];
const AZG_TEXT = /AZG|Arbeitszeitgesetz|Höchstarbeitszeit|Ruhezeit|mehr als 10 Std\.|ohne 30 Min\. Pause/;
const DANIEL = 3;
const TAG1 = '2026-11-18', TAG2 = '2026-11-19'; // Mi/Do – nach den Testdaten; Wiener Zeit = UTC + 1
const um = (tag, hm) => `${tag}T${hm}:00.000+01:00`;

test('15.38: langer Tag ohne Pause, danach kurze Ruhezeit – nirgends ein AZG-Hinweis', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  s.db.lauf("DELETE FROM buchung WHERE benutzer_id = ? AND zeit >= '2026-11-10'", DANIEL);
  s.db.lauf('DELETE FROM abwesenheit WHERE benutzer_id = ? AND datum IN (?, ?)', DANIEL, TAG1, TAG2);
  // Feld-Sitzungen enden nach 12 Std. ohne Anfrage (tests/api/hilfe.js) – nach jedem Uhrsprung neu anmelden
  const als = (id) => s.login(id);

  // Tag 1: 05:00–19:00 ohne Pause (14 Std. – früher „Höchstarbeitszeit“ und „ohne 30 Min. Pause“)
  s.uhr.setze(um(TAG1, '05:00'));
  assert.equal((await (await als(DANIEL)).post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten })).status, 200);
  s.uhr.setze(um(TAG1, '16:30')); // 11,5 Std. ohne Pause (über 12 Std. eingestempelt hieße „Ausstempeln vergessen?“)
  const ma = await als(DANIEL);
  let st = (await ma.get('/zeit/status')).daten;
  assert.equal(st.status, 'arbeit');
  assert.deepEqual(st.warnungen, [], 'Stempeluhr während des langen Tages');
  s.uhr.setze(um(TAG1, '19:00'));
  let r = await ma.post('/zeit/stempeln', { typ: 'gehen' });
  assert.equal(r.status, 200, JSON.stringify(r.daten));
  assert.equal(r.daten.heute.stunden, 14);
  assert.deepEqual(r.daten.warnungen, [], 'Antwort auf „Gehen“');

  // Tag 2: 04:00–12:00 (nur 9 Std. Ruhezeit – früher „§ 12 AZG“)
  s.uhr.setze(um(TAG2, '04:00'));
  assert.equal((await (await als(DANIEL)).post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten })).status, 200);
  s.uhr.setze(um(TAG2, '08:00'));
  st = (await (await als(DANIEL)).get('/zeit/status')).daten;
  assert.deepEqual(st.warnungen, [], 'Stempeluhr am Folgetag (gestern lang, kurze Ruhezeit)');
  s.uhr.setze(um(TAG2, '12:00'));
  r = await (await als(DANIEL)).post('/zeit/stempeln', { typ: 'gehen' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.daten.warnungen, []);
  const buero = await als(U.buero);

  // Glocke: weder die Person noch die Lohnverrechnung (Büro, GF, Bauleiter = Büro) erhalten etwas
  assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM benachrichtigung WHERE typ = 'azg'").n, 0);
  for (const id of [DANIEL, U.buero, U.gf, U.bauleiter]) {
    const l = (await (await als(id)).get('/benachrichtigungen')).daten;
    assert.ok(!l.some((n) => n.typ === 'azg' || AZG_TEXT.test(`${n.titel} ${n.text}`)), `${id}: ${JSON.stringify(l.slice(0, 3))}`);
  }

  // Monatsauswertung (auch Quelle der Übersichten): Stunden zählen wie bisher, keine AZG-Warnung
  const m = (await buero.get('/monat?monat=2026-11')).daten;
  const d = m.mitarbeiter.find((x) => x.id === DANIEL);
  assert.equal(d.tage[TAG1].stunden, 14);
  assert.equal(d.tage[TAG2].stunden, 8);
  assert.deepEqual(m.warnungen.filter((w) => AZG_TYPEN.includes(w.typ) || AZG_TEXT.test(w.text)), []);
  assert.ok(m.warnungen.some((w) => w.typ === 'offen'), 'Ausstempeln vergessen bleibt (Testdaten)');

  // Lohn-CSV: keine Hinweiszeile „AZG: …“
  const csv = (await buero.get('/monat/export.csv?monat=2026-11')).daten.toString('utf8');
  assert.ok(!AZG_TEXT.test(csv), csv.split(/\r?\n/).filter((z) => AZG_TEXT.test(z)).join('\n'));
  assert.match(csv, /18\.11\.2026;Mi;05:00;19:00;0;14;/);
});

test('15.38: offen > 12 Std. und unplausible Schicht melden sich weiter', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  s.db.lauf("DELETE FROM buchung WHERE benutzer_id = ? AND zeit >= '2026-11-10'", DANIEL);
  s.uhr.setze(um(TAG1, '05:00'));
  assert.equal((await (await s.login(DANIEL)).post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten })).status, 200);
  s.uhr.setze(um(TAG1, '17:30'));
  const ma = await s.login(DANIEL);
  const st = (await ma.get('/zeit/status')).daten;
  assert.deepEqual(st.warnungen.map((w) => w.typ), ['offen']);
  assert.equal(st.warnungen[0].text, 'Ausstempeln vergessen? Eingestempelt seit 18.11.2026 05:00 (über 12 Std.).');
  s.uhr.setze(um(TAG1, '21:30')); // 16,5 Std. → unplausibel, zählt mit 0 Std.
  const r = await (await s.login(DANIEL)).post('/zeit/stempeln', { typ: 'gehen' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.daten.warnungen.map((w) => w.typ), ['unplausibel']);
  const n = s.db.alle("SELECT benutzer_id, titel, text, schluessel FROM benachrichtigung WHERE typ = 'azg' ORDER BY benutzer_id");
  assert.ok(n.length >= 2 && n.some((x) => x.benutzer_id === DANIEL) && n.some((x) => x.benutzer_id === U.buero), JSON.stringify(n));
  const name = s.db.eins('SELECT name FROM benutzer WHERE id = ?', DANIEL).name;
  for (const x of n) {
    assert.equal(x.titel, `Arbeitszeit-Hinweis: ${name}`);
    assert.equal(x.schluessel, `azg:${DANIEL}:${TAG1}:unplausibel`);
    assert.match(x.text, /^18\.11\.2026: Schicht über 16,5 Std\. – vermutlich Ausstempeln vergessen/);
  }
  // nur wer das Recht lohn hat (und die Person selbst)
  assert.ok(!n.some((x) => [U.polier, U.mitarbeiter].includes(x.benutzer_id)));
});

test('15.38: Migration 58 auf Bestand – gespeicherte AZG-Hinweise werden gelöscht, alles andere bleibt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bautag-mig58-'));
  const datei = path.join(dir, 'alt.db');
  try {
    const alt = oeffneDatenbank(datei, { bisVersion: 57 });
    assert.equal(alt.eins('SELECT MAX(version) AS v FROM schema_version').v, 57);
    alt.lauf("INSERT INTO benutzer (id, name, rolle, pin_hash, aktiv, erstellt) VALUES (70, 'Bestand Arbeiter', 'mitarbeiter', 'x', 1, '2024-01-01T00:00:00.000Z')");
    alt.lauf("INSERT INTO benutzer (id, name, rolle, pin_hash, aktiv, erstellt) VALUES (71, 'Bestand Büro', 'buero', 'x', 1, '2024-01-01T00:00:00.000Z')");
    const n = (uid, typ, schluessel, gelesen, push) => alt.lauf('INSERT INTO benachrichtigung (benutzer_id, typ, titel, text, zeit, gelesen, schluessel, push, erfordert) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      uid, typ, typ === 'azg' ? 'AZG-Hinweis: Bestand Arbeiter' : 'Andere Meldung', `Text ${schluessel}`, '2026-11-20T18:00:00.000Z', gelesen, schluessel, push, uid === 70 ? '[]' : '["lohn"]');
    // weg: alle vier AZG-Typen, gelesen und ungelesen, gesendet und noch wartend (push IS NULL)
    n(70, 'azg', 'azg:70:2026-11-20:tag_10h', 0, null);
    n(71, 'azg', 'azg:70:2026-11-20:tag_10h', 0, 'gesendet');
    n(70, 'azg', 'azg:70:2026-11-19:tag_12h', 1, 'gesendet');
    n(71, 'azg', 'azg:70:2026-11-19:tag_12h', 0, null);
    n(70, 'azg', 'azg:70:2026-11-19:pause', 0, 'kein_abo');
    n(71, 'azg', 'azg:70:2026-11-19:pause', 1, 'aus');
    n(70, 'azg', 'azg:70:2026-11-18:ruhezeit', 0, null);
    n(71, 'azg', 'azg:70:2026-11-18:ruhezeit', 0, 'fehler');
    // bleibt: unplausible Schicht, andere Typen und Schlüssel, die nur ähnlich aussehen
    n(70, 'azg', 'azg:70:2026-11-17:unplausibel', 0, null);
    n(71, 'azg', 'azg:70:2026-11-17:unplausibel', 1, 'gesendet');
    n(71, 'plan', 'plan:2026-11-19:pause', 0, null);
    n(71, 'abwesenheit', 'abw:70:pause', 0, 'gesendet');
    n(71, 'azg', 'azg:70:pause-x', 0, 'alt');
    n(71, 'azg', null, 0, 'alt');
    // schon mit neuem Titel gespeichert (darf nicht doppelt umbenannt werden)
    alt.lauf("UPDATE benachrichtigung SET titel = 'Arbeitszeit-Hinweis: Bestand Arbeiter' WHERE id = (SELECT id FROM benachrichtigung WHERE schluessel = 'azg:70:2026-11-17:unplausibel' AND benutzer_id = 71)");
    alt.schliessen();

    const app = createApp({ dbPath: datei, uhr: () => new Date('2026-11-25T09:00:00Z'), seed: false, demo: false, loginListe: false });
    const { db } = app.locals.bt;
    try {
      assert.ok(db.eins('SELECT 1 AS x FROM schema_version WHERE version = 58'));
      const rest = db.alle('SELECT benutzer_id, typ, titel, text, schluessel, gelesen, push FROM benachrichtigung ORDER BY id');
      assert.deepEqual(rest.map((z) => `${z.benutzer_id}|${z.typ}|${z.schluessel}`), [
        '70|azg|azg:70:2026-11-17:unplausibel', '71|azg|azg:70:2026-11-17:unplausibel', '71|plan|plan:2026-11-19:pause',
        '71|abwesenheit|abw:70:pause', '71|azg|azg:70:pause-x', '71|azg|null'
      ]);
      // unplausible Schicht heißt jetzt „Arbeitszeit-Hinweis“; Text und andere Zeilen (auch azg ohne passenden Schlüssel) bleiben
      assert.deepEqual(rest.map((z) => z.titel), ['Arbeitszeit-Hinweis: Bestand Arbeiter', 'Arbeitszeit-Hinweis: Bestand Arbeiter',
        'Andere Meldung', 'Andere Meldung', 'AZG-Hinweis: Bestand Arbeiter', 'AZG-Hinweis: Bestand Arbeiter']);
      assert.deepEqual(rest.slice(0, 2).map((z) => z.text), ['Text azg:70:2026-11-17:unplausibel', 'Text azg:70:2026-11-17:unplausibel']);
      // was bleibt, bleibt unverändert (gelesen/ungelesen, Versandstand)
      assert.deepEqual(rest.map((z) => [z.gelesen, z.push]), [[0, null], [1, 'gesendet'], [0, null], [0, 'gesendet'], [0, 'alt'], [0, 'alt']]);
      // keine wartende Push-Meldung zu einem entfernten Typ
      assert.equal(db.eins("SELECT COUNT(*) AS n FROM benachrichtigung WHERE push IS NULL AND schluessel GLOB 'azg:*:*:*' AND schluessel NOT GLOB '*:unplausibel'").n, 0);
      assert.equal(db.eins('PRAGMA integrity_check').integrity_check, 'ok');
    } finally { db.schliessen(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
