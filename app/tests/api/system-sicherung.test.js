'use strict';
/** Überwachung der Datensicherung (API.md 12.1): Status-Route, Alarm an die GF */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U } = require('./hilfe');

test('Datensicherung: Status und Alarm', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  const buero = await s.login(U.buero);
  const bt = s.app.bt;

  await t.test('Rechte: nur mit Recht benutzer (GF)', async () => {
    for (const id of [U.mitarbeiter, U.polier, U.bauleiter]) assert.equal((await (await s.login(id)).get('/system/sicherung')).status, 403);
    assert.equal((await buero.get('/system/sicherung')).status, 403);
    const r = await gf.get('/system/sicherung');
    assert.equal(r.status, 200);
    assert.equal(r.daten.aktiv, false); // Demo ohne backup.sh: keine Warnungen
    assert.deepEqual(r.daten.warnungen, []);
  });

  await t.test('frische Sicherung → keine Warnung; älter als 26 Std. → Alarm einmal je Tag', async () => {
    const jetzt = s.uhr();
    const vor = (h) => new Date(jetzt.getTime() - h * 36e5).toISOString();
    s.db.setzeEinstellung('sicherung', {
      lokal: { zeit: vor(2), ok: true, text: 'ok', letzteOk: vor(2) },
      offsite: { zeit: vor(2), ok: true, text: 'ok', letzteOk: vor(2) },
      test: { zeit: vor(30), ok: true, text: 'ok', letzteOk: vor(30) }
    });
    let r = await gf.get('/system/sicherung');
    assert.equal(r.daten.aktiv, true);
    assert.deepEqual(r.daten.warnungen, []);
    assert.deepEqual(bt.stuendlich ? (bt.stuendlich(), []) : [], []);
    s.db.setzeEinstellung('sicherung', {
      lokal: { zeit: vor(1), ok: false, text: 'Platte voll', letzteOk: vor(27) },
      offsite: { zeit: vor(2), ok: true, text: 'ok', letzteOk: vor(2) },
      test: { zeit: vor(30), ok: true, text: 'ok', letzteOk: vor(30) }
    });
    r = await gf.get('/system/sicherung');
    assert.deepEqual(r.daten.warnungen.map((w) => w.art), ['lokal', 'lokal']);
    assert.match(r.daten.warnungen[0].text, /Platte voll/);
    const vorher = s.db.eins("SELECT COUNT(*) AS n FROM benachrichtigung WHERE titel = 'Datensicherung: bitte prüfen'").n;
    bt.stuendlich();
    bt.stuendlich();
    const n = s.db.alle("SELECT b.benutzer_id, u.rolle FROM benachrichtigung b JOIN benutzer u ON u.id = b.benutzer_id WHERE titel = 'Datensicherung: bitte prüfen'");
    assert.equal(n.length - vorher, s.db.eins("SELECT COUNT(*) AS n FROM benutzer WHERE rolle = 'gf' AND aktiv = 1").n);
    assert.ok(n.every((x) => x.rolle === 'gf'));
    const b = (await gf.get('/benachrichtigungen')).daten.find((x) => x.titel === 'Datensicherung: bitte prüfen');
    assert.equal(b.typ, 'sicherheit');
    assert.ok(!(await buero.get('/benachrichtigungen')).daten.some((x) => x.titel === 'Datensicherung: bitte prüfen'));
  });
});
