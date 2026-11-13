'use strict';
/**
 * 12.25 Interne Kostenstellen (Büro 9000, Werkstatt/Bauhof 9100, Kieswerk/Grube) – feste Uhr: Do 12.11.2026 10:24 Wien.
 * Stempeln erlaubt und zählt in Monat/Lohn; ausgeschlossen von Kalk/Budget/Positionen/Rechnungen/Phasen/Planer/Fuhren/Wetter/Bericht/Dokumenten.
 * Büro/Bauleiter/GF stempeln standardmäßig im Büro ein; Bauleiter werden nicht eingeplant.
 * Außerdem: Migrationen 27/28 auf einer bestehenden Datenbank.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { starte, U, BS, START } = require('./hilfe');
const { oeffneDatenbank } = require('../../server/db');
const { createApp } = require('../../server/index');

const FR = '2026-11-13';

test('12.25 Interne Kostenstellen', async (t) => {
  const s = await starte({ test: true });
  t.after(() => s.stop());
  const c = {};
  for (const r of ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf']) c[r] = await s.login(U[r]);
  const id = (kst) => s.db.eins('SELECT id FROM baustelle WHERE kst = ?', kst).id;
  const BUERO = id('9000'), WERKSTATT = id('9100');

  await t.test('Demo-Daten: Büro 9000 und Werkstatt/Bauhof 9100 (Kieswerk 90-001) als interne Kostenstellen', async () => {
    const l = (await c.buero.get('/baustellen')).daten;
    const b = l.find((x) => x.id === BUERO);
    assert.equal(b.kst, '9000');
    assert.equal(b.name, 'Büro');
    assert.equal(b.intern, true);
    assert.equal(b.kostenstelle, 'intern');
    assert.equal(l.find((x) => x.id === WERKSTATT).kostenstelle, 'intern');
    assert.equal(l.find((x) => x.id === BS.kieswerk).kostenstelle, 'intern');
    assert.equal(l.find((x) => x.id === BS.pitten).kostenstelle, 'baustelle');
    // keine Auftragssumme/Budget an internen Kostenstellen
    for (const k of [BUERO, WERKSTATT]) {
      const x = l.find((y) => y.id === k);
      assert.ok(x.auftragssumme == null && x.budgetVerbrauchProzent == null, `KST ${x.kst}`);
    }
  });

  await t.test('Standard-Kostenstelle: Büro, Bauleiter, GF → Büro; Mitarbeiter → Stamm-Baustelle; Einstellung je Person', async () => {
    for (const r of ['buero', 'bauleiter', 'gf']) assert.equal((await c[r].get('/zeit/status')).daten.standardKostenstelleId, BUERO, r);
    const stamm = s.db.eins('SELECT baustelle_id FROM benutzer WHERE id = ?', U.mitarbeiter).baustelle_id;
    assert.equal((await c.mitarbeiter.get('/zeit/status')).daten.standardKostenstelleId, stamm);
    // Einstellung je Person (Büro verwaltet)
    let r = await c.buero.put(`/benutzer/${U.mitarbeiter}`, { standardKostenstelleId: WERKSTATT });
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    assert.equal(r.daten.standardKostenstelleId, WERKSTATT);
    assert.equal((await c.mitarbeiter.get('/zeit/status')).daten.standardKostenstelleId, WERKSTATT);
    assert.equal((await c.buero.put(`/benutzer/${U.mitarbeiter}`, { standardKostenstelleId: 99999 })).status, 400);
    r = await c.buero.put(`/benutzer/${U.mitarbeiter}`, { standardKostenstelleId: null });
    assert.equal(r.status, 200);
    assert.equal((await c.mitarbeiter.get('/zeit/status')).daten.standardKostenstelleId, stamm);
    // der Mitarbeiter selbst kann es nicht setzen
    assert.equal((await c.mitarbeiter.put(`/benutzer/${U.mitarbeiter}`, { standardKostenstelleId: BUERO })).status, 403);
  });

  await t.test('Büro und Bauleiter stempeln im Büro ein; zählt in Monat und Lohn-Export', async () => {
    for (const r of ['buero', 'bauleiter']) {
      const st = (await c[r].get('/zeit/status')).daten;
      const k = await c[r].post('/zeit/stempeln', { typ: 'kommen', baustelleId: st.standardKostenstelleId });
      assert.equal(k.status, 200, `${r} ${JSON.stringify(k.daten)}`);
      assert.equal(k.daten.baustelleId, BUERO);
    }
    s.uhr.plus(240);
    for (const r of ['buero', 'bauleiter']) assert.equal((await c[r].post('/zeit/stempeln', { typ: 'gehen' })).status, 200);
    const m = (await c.gf.get('/monat?monat=2026-11')).daten;
    for (const uid of [U.buero, U.bauleiter]) {
      const p = m.mitarbeiter.find((x) => x.id === uid);
      assert.ok(p, `Monat enthält ${uid}`);
      assert.equal(p.tage['2026-11-12'].stunden, 4);
      assert.deepEqual(p.tage['2026-11-12'].baustellen, ['9000']);
    }
    const csv = (await c.gf.get('/monat/export.csv?monat=2026-11')).daten.toString('utf8');
    assert.ok(csv.includes('Stefan Aigner') && csv.includes('9000'), 'Lohn-Export enthält die Büro-Stunden');
    // Anwesenheit zeigt die interne Kostenstelle
    assert.ok(Array.isArray((await c.buero.get('/zeit/anwesend')).daten));
  });

  await t.test('Keine Nachkalkulation, Positionen, Budget, Auftrag, Rechnungen, Phasen, Dokumente, Leistungen (422)', async () => {
    const PFADE = [
      ['GET', `/kalkulation/${BUERO}`], ['GET', `/baustellen/${BUERO}/positionen`], ['POST', `/baustellen/${BUERO}/positionen`, { bezeichnung: 'X' }],
      ['GET', `/baustellen/${BUERO}/positionen/export.xlsx`], ['PUT', `/baustellen/${BUERO}/auftrag`, { auftragssumme: 1000 }],
      ['GET', `/baustellen/${BUERO}/rechnungen`], ['POST', `/baustellen/${BUERO}/rechnungen`, { nr: 'X', typ: 'teil', datum: '2026-11-01', netto: 1 }],
      ['PUT', `/baustellen/${BUERO}/phase`, { phase: 'fertig' }], ['GET', `/baustellen/${BUERO}/dokumente`],
      ['POST', `/baustellen/${BUERO}/nachtraege`, { text: 'X', betrag: 1 }], ['POST', `/baustellen/${BUERO}/fremdleistungen`, { text: 'X', betrag: 1, datum: '2026-11-12' }],
      ['POST', `/baustellen/${BUERO}/leistungen`, { leistungId: 4, menge: 1, datum: '2026-11-12' }], ['POST', `/baustellen/${WERKSTATT}/lv-import`, { dateiBase64: 'eA==' }]
    ];
    for (const rolle of ['buero', 'bauleiter', 'gf']) {
      for (const [m, p, body] of PFADE) {
        const r = await c[rolle].anfrage(m, p, body);
        assert.equal(r.status, 422, `${rolle} ${m} ${p} → ${r.status}`);
        assert.match(r.daten.fehler, /interne Kostenstelle/);
      }
    }
    // Übersichten ohne interne Kostenstellen
    const kalk = (await c.buero.get('/kalkulation')).daten.map((x) => x.baustelleId);
    for (const k of [BUERO, WERKSTATT, BS.kieswerk]) assert.ok(!kalk.includes(k));
    const op = await c.buero.get('/offene-posten');
    assert.ok(!JSON.stringify(op.daten).includes('"9000"'));
    const zp = (await c.buero.get('/plan/zeitplan')).daten;
    assert.ok(!JSON.stringify(zp).includes('"kst":"9000"'));
  });

  await t.test('Kein Bericht, kein Wetter, keine Planer-Zeile, kein Fuhren-Ziel', async () => {
    const b = await c.buero.post('/berichte', { baustelleId: BUERO, datum: '2026-11-12' });
    assert.equal(b.status, 422);
    assert.match(b.daten.fehler, /interne Kostenstelle/);
    const w = (await c.buero.get(`/baustellen/${BUERO}/wetter?datum=2026-11-12`)).daten;
    assert.equal(w.verfuegbar, false);
    assert.match(w.grund, /Interne Kostenstelle/);
    assert.equal((await c.buero.post('/plan/einsaetze', { datum: FR, baustelleId: BUERO })).status, 422);
    const woche = (await c.buero.get(`/plan/woche?von=${FR}`)).daten;
    assert.ok(!JSON.stringify(woche.baustellen || []).includes('"9000"'));
    assert.ok(!(woche.einsaetze || []).some((e) => [BUERO, WERKSTATT, BS.kieswerk].includes(e.baustelleId)));
    const f = await c.buero.post('/plan/fuhren', { datum: '2026-11-12', anlageId: 4, materialId: 4, menge: 10, einheit: 't', nach: { art: 'baustelle', baustelleId: BUERO } });
    assert.equal(f.status, 422);
  });

  await t.test('Bauleiter wird nicht eingeplant (422), Mein Einsatz leer; bestehende Einsätze bleiben lesbar', async () => {
    const r = await c.buero.post('/plan/einsaetze', { datum: FR, baustelleId: BS.pitten, benutzerIds: [U.bauleiter] });
    assert.equal(r.status, 422, JSON.stringify(r.daten));
    assert.match(r.daten.fehler, /Bauleiter/);
    const e = await c.buero.post('/plan/einsaetze', { datum: FR, baustelleId: BS.pitten, benutzerIds: [U.mitarbeiter] });
    assert.equal(e.status, 201);
    assert.equal((await c.buero.post(`/plan/einsaetze/${e.daten.id}/personen`, { benutzerIds: [U.bauleiter] })).status, 422);
    // Altbestand: direkt eingetragener Bauleiter bleibt lesbar
    s.db.lauf('INSERT INTO plan_person (einsatz_id, benutzer_id) VALUES (?, ?)', e.daten.id, U.bauleiter);
    const w = await c.buero.get(`/plan/woche?von=${FR}`);
    assert.equal(w.status, 200);
    assert.ok(w.daten.einsaetze.find((x) => x.id === e.daten.id).personen.some((p) => p.benutzerId === U.bauleiter));
    await c.buero.post('/plan/veroeffentlichen', { von: FR });
    const ich = (await c.bauleiter.get(`/plan/ich?von=2026-11-12&bis=${FR}`)).daten;
    assert.deepEqual(ich, { morgen: null, tage: [] });
  });
});

test('12.25 / Owner-Entscheidung: Migrationen 27 und 28 auf einer bestehenden Datenbank', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bautag-1225-'));
  const datei = path.join(dir, 'alt.db');
  try {
    const alt = oeffneDatenbank(datei, { bisVersion: 26 });
    assert.equal(alt.eins('SELECT MAX(version) AS v FROM schema_version').v, 26);
    assert.ok(!alt.alle('PRAGMA table_info(benutzer)').some((x) => x.name === 'standard_kostenstelle_id'));
    const t0 = '2026-06-01T08:00:00.000Z';
    // alte Matrix: Bauleiter eingeschränkt
    alt.lauf("DELETE FROM rolle_recht WHERE rolle IN ('buero', 'bauleiter')");
    for (const [recht, b, bl] of [['preise_sehen', 1, 1], ['preise_bearbeiten', 1, 0], ['stammdaten', 1, 0], ['lohn', 1, 0], ['kolonne', 0, 1]]) {
      alt.lauf('INSERT INTO rolle_recht (rolle, recht, wert) VALUES (?, ?, ?)', 'buero', recht, b);
      alt.lauf('INSERT INTO rolle_recht (rolle, recht, wert) VALUES (?, ?, ?)', 'bauleiter', recht, bl);
    }
    alt.lauf("INSERT INTO baustelle (id, kst, name, erstellt) VALUES (1, '25-100', 'Altbau', ?)", t0);
    alt.schliessen();

    const app = createApp({ dbPath: datei, uhr: () => new Date(START), seed: false, demo: false, loginListe: false });
    const { db } = app.locals.bt;
    assert.equal(db.eins('SELECT MAX(version) AS v FROM schema_version').v, Math.max(...require('../../server/schema').MIGRATIONEN.map((m) => m.version)));
    const matrix = (rolle) => db.alle('SELECT recht, wert FROM rolle_recht WHERE rolle = ? ORDER BY recht', rolle).map((x) => [x.recht, x.wert]);
    assert.deepEqual(matrix('bauleiter'), matrix('buero'));
    assert.ok(db.eins("SELECT 1 AS x FROM protokoll WHERE art = 'recht' AND objekt = 'rolle:bauleiter' AND text LIKE 'Rechte-Matrix: Rolle Bauleiter erhält die Rechte der Rolle Büro%'"));
    assert.ok(db.alle('PRAGMA table_info(benutzer)').some((x) => x.name === 'standard_kostenstelle_id'));
    // Büro-Kostenstelle beim Start angelegt, bestehende Baustelle unverändert
    const bu = db.alle('SELECT kst, name, intern FROM baustelle ORDER BY kst');
    assert.deepEqual(bu.map((b) => [b.kst, b.name, b.intern]), [['25-100', 'Altbau', 0], ['9000', 'Büro', 1]]);
    db.schliessen();
    // zweiter Start: nichts doppelt
    const app2 = createApp({ dbPath: datei, uhr: () => new Date(START), seed: false, demo: false, loginListe: false });
    const db2 = app2.locals.bt.db;
    assert.equal(db2.eins("SELECT COUNT(*) AS n FROM baustelle WHERE kst = '9000'").n, 1);
    assert.equal(db2.eins("SELECT COUNT(*) AS n FROM protokoll WHERE objekt = 'rolle:bauleiter' AND art = 'recht'").n, 1);
    db2.schliessen();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
