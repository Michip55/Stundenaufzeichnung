'use strict';
/**
 * Prüfbericht 7, R-01…R-03 (KRITISCH): Krankenstand (Code K) und Abwesenheits-Notizen ANDERER Personen sehen nur
 * Rollen mit stammdaten/lohn und die Person selbst – in jedem Pfad (zentral: server/datenschutz.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');

const TAG = '2026-11-13'; // Freitag
const DANIEL = 3; // Partie Pitten (Polier 1, Bauleiter 103)
const DIAGNOSE = 'DIAGNOSE-GEHEIM-4711';

function pdfText(buf) {
  const s = buf.toString('latin1');
  return [...s.matchAll(/\[([^\]]*)\]\s*TJ/g)].map((m) => [...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join('')).join('\n');
}
const ohneK = (o, was) => {
  const j = JSON.stringify(o);
  assert.ok(!j.includes(DIAGNOSE), `${was}: Notiz sichtbar`);
  assert.ok(!/"code":"K"/.test(j), `${was}: Code K sichtbar`);
  assert.ok(!/Krank/i.test(j), `${was}: „Krank…“ im Text`);
};

test('Krankenstand anderer Personen nie bei Polier/Bauleiter/Mitarbeiter', async (t) => {
  const s = await starte({ pdfUnkomprimiert: true, sitzung: { feldMin: 60 * 24 * 30, bueroMin: 60 * 24 * 30, maxH: 24 * 60 } });
  t.after(() => s.stop());
  const c = {};
  for (const r of ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf']) c[r] = await s.login(U[r]);
  c.daniel = await s.login(DANIEL);
  const k = await c.buero.post('/abwesenheiten/zeitraum', { benutzerId: DANIEL, von: TAG, bis: TAG, code: 'K', notiz: DIAGNOSE });
  assert.equal(k.status, 201, JSON.stringify(k.daten));

  await t.test('R-01/R-02: GET /abwesenheiten und /abwesenheiten/antraege', async () => {
    for (const r of ['polier', 'bauleiter']) {
      const l = (await c[r].get(`/abwesenheiten?benutzerId=${DANIEL}&von=${TAG}&bis=${TAG}`)).daten;
      assert.equal(l.length, 1, r);
      assert.equal(l[0].code, 'abwesend', r);
      assert.ok(!('notiz' in l[0]), r);
      ohneK(l, r);
      const a = (await c[r].get('/abwesenheiten/antraege')).daten.filter((x) => x.benutzerId === DANIEL);
      assert.ok(a.length > 0);
      ohneK(a, `${r} antraege`);
      assert.equal(a.find((x) => x.antragId === k.daten.antragId).code, 'abwesend');
    }
    const eigen = (await c.mitarbeiter.get('/abwesenheiten')).daten;
    assert.ok(eigen.every((x) => x.benutzerId === U.mitarbeiter), 'Mitarbeiter sieht nur sich');
    assert.ok(eigen.some((x) => x.code === 'K'), 'eigener Krankenstand bleibt sichtbar');
    // Büro und die Person selbst: unverändert
    for (const r of ['buero', 'daniel']) {
      const l = (await c[r].get(`/abwesenheiten?benutzerId=${DANIEL}&von=${TAG}&bis=${TAG}`)).daten;
      assert.deepEqual([l[0].code, l[0].notiz], ['K', DIAGNOSE], r);
      const a = (await c[r].get('/abwesenheiten/antraege')).daten.find((x) => x.antragId === k.daten.antragId);
      assert.deepEqual([a.code, a.notiz], ['K', DIAGNOSE], r);
    }
  });

  await t.test('R-03: 409-Text und Vorschau verraten den Code nicht', async () => {
    const r = await c.polier.post('/abwesenheiten', { benutzerId: DANIEL, datum: TAG, code: 'SW' });
    assert.equal(r.status, 409);
    assert.match(r.daten.fehler, /bereits abwesend/);
    ohneK(r.daten, '409');
    const v = await c.polier.post('/abwesenheiten/zeitraum', { benutzerId: DANIEL, von: TAG, bis: TAG, code: 'SW', vorschau: true });
    assert.equal(v.status, 200);
    assert.deepEqual(v.daten.uebersprungen, [{ datum: TAG, grund: 'bereits abwesend' }]);
    // Büro sieht den Code weiterhin
    const b = await c.buero.post('/abwesenheiten/zeitraum', { benutzerId: DANIEL, von: TAG, bis: TAG, code: 'SW', vorschau: true });
    assert.deepEqual(b.daten.uebersprungen, [{ datum: TAG, grund: 'schon K genehmigt' }]);
  });

  await t.test('Urlaubskalender und Warnungen', async () => {
    const kal = (await c.bauleiter.get(`/urlaub/kalender?von=${TAG}&bis=${TAG}`)).daten;
    ohneK(kal, 'kalender');
    assert.equal(kal.personen.find((p) => p.benutzerId === DANIEL).tage[TAG].code, 'abwesend');
    ohneK((await c.bauleiter.get(`/urlaub/warnungen?von=${TAG}&bis=${TAG}`)).daten, 'warnungen');
  });

  await t.test('Kolonne/Stempeluhr: Liste und Fehlertext ohne Grund', async () => {
    s.uhr.setze(`${TAG}T06:00:00.000Z`);
    const l = (await c.polier.get(`/zeit/kolonne?baustelleId=${BS.pitten}`)).daten;
    assert.equal(l.find((x) => x.benutzerId === DANIEL).code, 'abwesend');
    ohneK(l, 'kolonne');
    const r = await c.polier.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: [DANIEL], typ: 'kommen' });
    const e = r.daten.ergebnisse.find((x) => x.benutzerId === DANIEL);
    assert.equal(e.ok, false);
    ohneK(r.daten, 'kolonne stempeln');
    assert.match(e.fehler, /Abwesenheit/);
    // die Person selbst erfährt den Grund
    const selbst = await c.daniel.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
    assert.equal(selbst.status, 409);
    assert.match(selbst.daten.fehler, /Krankenstand/);
  });

  await t.test('Bautagesbericht: Code maskiert, Speichern behält K, PDFs (intern/AG) nie K', async () => {
    s.db.lauf('DELETE FROM bericht WHERE baustelle_id = ? AND datum = ?', BS.pitten, TAG);
    const b = (await c.polier.post('/berichte', { baustelleId: BS.pitten, datum: TAG })).daten;
    const p = b.personal.find((x) => x.benutzerId === DANIEL);
    assert.ok(p, 'Person mit Abwesenheit im Bericht');
    assert.equal(p.code, 'abwesend');
    ohneK(b, 'bericht polier');
    ohneK((await c.bauleiter.get(`/berichte/${b.id}`)).daten, 'bericht bauleiter');
    assert.equal((await c.buero.get(`/berichte/${b.id}`)).daten.personal.find((x) => x.benutzerId === DANIEL).code, 'K');
    // Polier speichert unverändert zurück → K bleibt gespeichert
    const r = await c.polier.put(`/berichte/${b.id}`, { version: b.version, personal: b.personal.map((x) => ({ benutzerId: x.benutzerId, von1: x.von1, bis1: x.bis1, von2: x.von2, bis2: x.bis2, pauseMin: x.pauseMin, code: x.code, segStunden: x.segStunden })) });
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    assert.equal(s.db.eins('SELECT code FROM bericht_personal WHERE bericht_id = ? AND benutzer_id = ?', b.id, DANIEL).code, 'K');
    // „abwesend“ ohne eingetragene Abwesenheit → 400
    const ohne = r.daten.personal.find((x) => x.benutzerId !== DANIEL && !x.code);
    if (ohne) {
      const x = await c.polier.put(`/berichte/${b.id}`, { version: r.daten.version, personal: r.daten.personal.map((y) => ({ benutzerId: y.benutzerId, von1: y.von1, bis1: y.bis1, von2: y.von2, bis2: y.bis2, pauseMin: y.pauseMin, code: y.benutzerId === ohne.benutzerId ? 'abwesend' : y.code, segStunden: y.segStunden })) });
      assert.equal(x.status, 400);
    }
    for (const [rolle, fassung] of [['bauleiter', 'intern'], ['buero', 'intern'], ['polier', 'ag'], ['buero', 'ag']]) {
      const pdf = await c[rolle].get(`/berichte/${b.id}/pdf?fassung=${fassung}`);
      assert.equal(pdf.status, 200, `${rolle} ${fassung}`);
      const tx = pdfText(pdf.daten);
      assert.ok(!/K = Krank|Krank/.test(tx), `${rolle} ${fassung}: „Krank“ im PDF`);
      const zeile = tx.split('\n');
      assert.ok(!zeile.includes('K'), `${rolle} ${fassung}: Kürzel K im PDF`);
      if (fassung === 'intern') assert.ok(zeile.includes('abw.') && /abw\. = abwesend/.test(tx), `${rolle} intern: „abw.“`);
    }
  });
});
