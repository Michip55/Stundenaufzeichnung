'use strict';
/** Urlaubsübersicht und Urlaubskonto (API.md 12.19) */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');

test('Urlaub', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const c = {};
  for (const r of ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf']) c[r] = await s.login(U[r]);
  const abw = (id, datum, code, status = 'genehmigt', erfasst = '2026-11-01T08:00:00Z') => s.db.lauf('INSERT INTO abwesenheit (benutzer_id, datum, code, status, erfasst_von, erfasst) VALUES (?, ?, ?, ?, 101, ?) ON CONFLICT(benutzer_id, datum) DO UPDATE SET code = excluded.code, status = excluded.status, erfasst = excluded.erfasst', id, datum, code, status, erfasst);

  await t.test('Feiertage (inkl. Ostern-abhängig)', async () => {
    const f = (await c.mitarbeiter.get('/urlaub/feiertage?jahr=2027')).daten;
    const m = Object.fromEntries(f.map((x) => [x.datum, x.name]));
    assert.equal(m['2027-03-29'], 'Ostermontag');
    assert.equal(m['2027-05-06'], 'Christi Himmelfahrt');
    assert.equal(m['2027-12-08'], 'Mariä Empfängnis');
  });

  await t.test('Kalender: Sichtbereich und Datenschutz (Krank)', async () => {
    abw(3, '2026-11-17', 'K');
    abw(U.mitarbeiter, '2026-11-18', 'U', 'beantragt');
    const buero = (await c.buero.get('/urlaub/kalender?von=2026-11-16&bis=2026-11-20')).daten;
    assert.equal(buero.tage.length, 5);
    assert.equal(buero.personen.find((p) => p.benutzerId === 3).tage['2026-11-17'].code, 'K');
    const pol = (await c.polier.get('/urlaub/kalender?von=2026-11-16&bis=2026-11-20')).daten;
    const p3 = pol.personen.find((p) => p.benutzerId === 3);
    if (p3) assert.equal(p3.tage['2026-11-17'].code, 'abwesend');
    assert.ok(pol.personen.every((p) => s.db.eins('SELECT baustelle_id FROM benutzer WHERE id = ?', p.benutzerId).baustelle_id === 1 || p.benutzerId === U.polier));
    const ma = (await c.mitarbeiter.get('/urlaub/kalender?von=2026-11-16&bis=2026-11-20')).daten;
    assert.deepEqual(ma.personen.map((p) => p.benutzerId), [U.mitarbeiter]);
    assert.deepEqual(ma.personen[0].tage['2026-11-18'], { code: 'U', status: 'beantragt', id: ma.personen[0].tage['2026-11-18'].id });
  });

  await t.test('Urlaubskonto: BUAK-Stand, genommen/geplant/beantragt, Rest; Rechte', async () => {
    abw(U.mitarbeiter, '2026-11-03', 'U');
    abw(U.mitarbeiter, '2026-11-04', 'U');
    abw(U.mitarbeiter, '2026-11-24', 'U');
    abw(U.mitarbeiter, '2026-11-01', 'U'); // Sonntag zählt nicht
    assert.equal((await c.polier.put(`/urlaub/konto/${U.mitarbeiter}/2026`, { buakStand: 20 })).status, 403);
    let r = await c.buero.put(`/urlaub/konto/${U.mitarbeiter}/2026`, { art: 'buak', buakStand: 20, buakDatum: '2026-11-01' });
    assert.equal(r.status, 200);
    const beantragt = s.db.alle("SELECT datum FROM abwesenheit WHERE benutzer_id = ? AND code = 'U' AND status = 'beantragt' AND datum >= '2026-11-01' AND datum <= '2026-12-31'", U.mitarbeiter).filter((x) => ![0, 6].includes(new Date(x.datum + 'T12:00:00Z').getUTCDay())).length;
    assert.deepEqual([r.daten.anspruch, r.daten.genommen, r.daten.geplant, r.daten.beantragt, r.daten.rest], [20, 2, 1, beantragt, 17]);
    assert.match(r.daten.hinweis, /BUAK/);
    r = await c.buero.put(`/urlaub/konto/${U.buero}/2026`, { art: 'urlg', anspruch: 25, uebertrag: 3 });
    assert.deepEqual([r.daten.art, r.daten.rest], ['urlg', 28]);
    const own = (await c.mitarbeiter.get('/urlaub/konto?jahr=2026')).daten;
    assert.deepEqual(own.map((k) => k.benutzerId), [U.mitarbeiter]);
    const csv = (await c.buero.get('/urlaub/export.csv?jahr=2026')).daten.toString('utf8');
    assert.match(csv, /^﻿Personalnummer;Name;Art;Anspruch/);
    assert.equal((await c.polier.get('/urlaub/export.csv')).status, 403);
  });

  await t.test('Betriebsurlaub: Vorschau mit Konflikten, dann anlegen (Feiertage/Wochenende übersprungen)', async () => {
    assert.equal((await c.bauleiter.post('/urlaub/betriebsurlaub', { von: '2026-12-21', bis: '2027-01-08', alle: true })).status, 403);
    abw(U.mitarbeiter, '2026-12-23', 'K');
    let r = await c.buero.post('/urlaub/betriebsurlaub', { von: '2026-12-21', bis: '2027-01-08', baustelleIds: [BS.pitten], vorschau: true });
    assert.equal(r.status, 200);
    assert.ok(!r.daten.tage.includes('2026-12-25') && !r.daten.tage.includes('2027-01-06') && !r.daten.tage.includes('2026-12-26'));
    assert.equal(r.daten.tage.length, 12);
    const ma = r.daten.personen.find((p) => p.benutzerId === U.mitarbeiter);
    assert.ok(ma.konflikte.some((k) => k.datum === '2026-12-23'));
    assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM abwesenheit WHERE datum = '2026-12-22'").n, 0);
    r = await c.buero.post('/urlaub/betriebsurlaub', { von: '2026-12-21', bis: '2027-01-08', baustelleIds: [BS.pitten], vorschau: false, notiz: 'Weihnachtsferien' });
    assert.ok(r.daten.angelegt > 50);
    assert.equal(s.db.eins("SELECT code FROM abwesenheit WHERE benutzer_id = ? AND datum = '2026-12-23'", U.mitarbeiter).code, 'K'); // bleibt
    const k = (await c.buero.get('/urlaub/kalender?von=2026-12-21&bis=2026-12-31')).daten;
    assert.equal(k.personen.find((p) => p.benutzerId === U.mitarbeiter).tage['2026-12-22'].code, 'BU');
    assert.equal(k.personen.find((p) => p.benutzerId === U.mitarbeiter).tage['2026-12-22'].art, 'betriebsurlaub');
  });

  await t.test('Regression: Betriebsurlaub bleibt U (Konto/Monat/Lohn), ist aber als art:"betriebsurlaub" erkennbar', async () => {
    const liste = (await c.buero.get(`/abwesenheiten?benutzerId=${U.mitarbeiter}&von=2026-12-21&bis=2026-12-31`)).daten;
    const bu = liste.find((a) => a.datum === '2026-12-22');
    assert.equal(bu.code, 'U');
    assert.equal(bu.art, 'betriebsurlaub');
    assert.ok(!('art' in liste.find((a) => a.datum === '2026-12-23'))); // K bleibt ohne Kennzeichen
    const eigen = (await c.mitarbeiter.get('/abwesenheiten?von=2026-12-21&bis=2026-12-31')).daten;
    assert.equal(eigen.find((a) => a.datum === '2026-12-22').art, 'betriebsurlaub');
    // Monat/Lohn unverändert: zählt als U
    const m = (await c.buero.get('/monat?monat=2026-12')).daten.mitarbeiter.find((x) => x.id === U.mitarbeiter);
    assert.equal(m.tage['2026-12-22'].code, 'U');
    assert.ok(m.u >= 6);
    const csv = await c.buero.get('/monat/export.csv?monat=2026-12');
    assert.equal(csv.status, 200);
    assert.ok(!String(csv.daten).includes('BU'));
    // Urlaubskonto zieht die Tage ab
    const konto = (await c.buero.get(`/urlaub/konto?jahr=2026&benutzerId=${U.mitarbeiter}`)).daten[0];
    assert.ok(konto.geplant + konto.genommen >= 6);
    // Büro überschreibt einen Betriebsurlaubstag mit K → Kennzeichen weg
    assert.equal((await c.buero.post('/abwesenheiten', { benutzerId: U.mitarbeiter, datum: '2026-12-29', code: 'K' })).status, 200);
    const neu = (await c.buero.get(`/abwesenheiten?benutzerId=${U.mitarbeiter}&von=2026-12-29&bis=2026-12-29`)).daten[0];
    assert.equal(neu.code, 'K');
    assert.ok(!('art' in neu));
    const k = (await c.buero.get('/urlaub/kalender?von=2026-12-29&bis=2026-12-29')).daten;
    assert.equal(k.personen.find((p) => p.benutzerId === U.mitarbeiter).tage['2026-12-29'].code, 'K');
  });

  await t.test('Warnungen: Partie, Plan-Konflikt, Antrag offen > 3 Tage', async () => {
    for (const id of s.db.alle("SELECT id FROM benutzer WHERE baustelle_id = 1 AND rolle IN ('mitarbeiter','polier') LIMIT 4").map((x) => x.id)) abw(id, '2026-11-26', 'U');
    const w = (await c.buero.get('/urlaub/warnungen?von=2026-11-16&bis=2026-11-30')).daten;
    assert.ok(w.some((x) => x.typ === 'partie_viele' && x.datum === '2026-11-26'));
    assert.ok(w.some((x) => x.typ === 'antrag_offen' && x.benutzerId === U.mitarbeiter));
    assert.equal((await c.polier.get('/urlaub/warnungen')).status, 403);
    s.app.bt.stuendlich(); s.app.bt.stuendlich();
    assert.equal(s.db.alle("SELECT * FROM benachrichtigung WHERE typ = 'urlaub' AND benutzer_id = ? AND titel LIKE 'Antrag offen%'", U.buero).length, 1);
    assert.equal((await c.buero.put('/einstellungen/urlaub', { partieGrenze: 10, partieGrenzeProzent: 90 })).daten.partieGrenze, 10);
  });
});
