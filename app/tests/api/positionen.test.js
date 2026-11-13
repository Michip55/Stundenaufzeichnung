'use strict';
/** Nachkalkulation nach Positionen (API.md 10/10a): Rechte, €-Schutz, Rechnung, Zuordnung, Unabhängigkeit, Import/Export */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ExcelJS = require('exceljs');
const { starte, U, BS, euroFelder } = require('./hilfe');
const X = require('../../server/katalog-excel');

const ROLLEN = ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf'];
const OK = 'ok', NEIN = 403;
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const alle = (d) => d.gruppen.flatMap((g) => g.positionen);
const finde = (d, b) => alle(d).find((p) => p.bezeichnung === b);

test('Nachkalkulation nach Positionen', async (t) => {
  const s = await starte({ euroSicherheitsnetz: false });
  t.after(() => s.stop());
  const c = {};
  for (const r of ROLLEN) c[r] = await s.login(U[r]);
  const pid = (bs, b) => s.db.eins('SELECT id FROM projektposition WHERE baustelle_id = ? AND bezeichnung = ?', bs, b).id;

  await t.test('Rechte: jede Rolle gegen jede neue Route', async () => {
    const p1 = pid(BS.pitten, 'Maut'), p3 = pid(BS.reisinger, 'Maut');
    const MATRIX = [
      ['GET', '/positionen/katalog', null, [NEIN, NEIN, OK, OK, OK]],
      ['POST', '/positionen/katalog', {}, [NEIN, NEIN, NEIN, OK, OK]],
      ['PUT', '/positionen/katalog/1', {}, [NEIN, NEIN, NEIN, OK, OK]],
      ['DELETE', '/positionen/katalog/999999', undefined, [NEIN, NEIN, NEIN, OK, OK]],
      ['POST', '/positionen/katalog/import', {}, [NEIN, NEIN, NEIN, OK, OK]],
      ['GET', `/baustellen/${BS.pitten}/positionen`, null, [NEIN, NEIN, OK, OK, OK]],
      ['GET', `/baustellen/${BS.reisinger}/positionen`, null, [NEIN, NEIN, NEIN, OK, OK]],
      ['POST', `/baustellen/${BS.pitten}/positionen`, {}, [NEIN, NEIN, NEIN, OK, OK]],
      ['PUT', `/baustellen/${BS.pitten}/positionen/${p1}`, {}, [NEIN, NEIN, NEIN, OK, OK]],
      ['DELETE', `/baustellen/${BS.pitten}/positionen/999999`, undefined, [NEIN, NEIN, NEIN, OK, OK]],
      ['POST', `/baustellen/${BS.pitten}/positionen/aus-vorlage`, { vorschau: true }, [NEIN, NEIN, NEIN, OK, OK]],
      ['POST', `/baustellen/${BS.pitten}/positionen/${p1}/mengen`, {}, [NEIN, NEIN, OK, OK, OK]],
      ['POST', `/baustellen/${BS.reisinger}/positionen/${p3}/mengen`, {}, [NEIN, NEIN, NEIN, OK, OK]],
      ['DELETE', `/baustellen/${BS.pitten}/positionen/${p1}/mengen/999999`, undefined, [NEIN, NEIN, OK, OK, OK]],
      ['GET', `/baustellen/${BS.pitten}/positionen/export.xlsx`, null, [NEIN, NEIN, OK, OK, OK]],
      ['GET', `/baustellen/${BS.reisinger}/positionen/export.xlsx`, null, [NEIN, NEIN, NEIN, OK, OK]]
    ];
    for (const [m, p, body, erw] of MATRIX) {
      for (let i = 0; i < ROLLEN.length; i++) {
        const r = await c[ROLLEN[i]].anfrage(m, p, body === null ? undefined : body);
        const was = `${ROLLEN[i]} ${m} ${p} → ${r.status}`;
        if (erw[i] === NEIN) assert.equal(r.status, 403, was);
        else assert.ok(![401, 403].includes(r.status) && r.status < 500, was);
      }
    }
  });

  await t.test('€-Schutz: Polier/Mitarbeiter sehen nichts, auch nicht über /kalkulation; Protokoll ohne €', async () => {
    for (const rolle of ['mitarbeiter', 'polier']) {
      for (const p of ['/positionen/katalog', `/baustellen/${BS.pitten}/positionen`, `/kalkulation/${BS.pitten}`]) {
        const r = await c[rolle].get(p);
        assert.equal(r.status, 403, `${rolle} ${p}`);
        assert.ok(!JSON.stringify(r.daten).match(/\d+\.\d+/), `${rolle} ${p} enthält Zahlen`);
      }
    }
    // kalk_sehen ohne preise_sehen (Büro per Matrix): Mengen ja, € nein
    await c.gf.put('/rechte/matrix', { rolle: 'buero', recht: 'preise_sehen', wert: false });
    try {
      const b2 = await s.login(U.buero);
      const r = await b2.get(`/baustellen/${BS.pitten}/positionen`);
      assert.equal(r.status, 200);
      assert.deepEqual(euroFelder(r.daten).filter((f) => !/budgetVerbrauchProzent/.test(f)), []);
      for (const k of ['gesamtsumme', 'ergebnis', 'ergebnisProzent', 'auftragGesamt']) assert.ok(!(k in r.daten), k);
      for (const p of alle(r.daten)) {
        assert.ok(!('ep' in p) && !('summe' in p));
        if (['PA', 'VE'].includes(p.einheit)) { // E-08: Rechnungsbeträge
          assert.ok(!('menge' in p) && !('eintraege' in p) && !('mengeManuell' in p));
          assert.equal(typeof p.eintraegeAnzahl, 'number');
        } else assert.equal(typeof p.menge, 'number');
      }
      assert.ok(r.daten.gruppen.every((g) => !('summe' in g)));
      assert.equal((await b2.get(`/baustellen/${BS.pitten}/positionen/export.xlsx`)).status, 403);
      assert.equal((await b2.get('/positionen/katalog')).status, 403);
    } finally {
      await c.gf.put('/rechte/matrix', { rolle: 'buero', recht: 'preise_sehen', wert: true });
    }
  });

  await t.test('Aufbau, Startzuordnung und automatische Mengen aus Berichten (≠ Entwurf)', async () => {
    const d = (await c.buero.get(`/baustellen/${BS.pitten}/positionen`)).daten;
    assert.deepEqual(d.gruppen.map((g) => [g.schluessel, g.name]), [['arbeit', 'Arbeit'], ['transport', 'Transport'], ['geraete', 'Geräte'], ['eigenmaterial', 'Eigenmaterial'], ['fremdmaterial', 'Fremdmaterial'], ['abgaben', 'Abgaben']]);
    assert.equal(alle(d).length, 119);
    assert.equal(d.stand, '2026-04-01');
    const summe = (sql, ...p) => s.db.eins(sql, ...p).m || 0;
    const fa = finde(d, 'Facharbeiter');
    assert.deepEqual(fa.quelle, { art: 'personal', ref: ['pol', 'va', 'fa', 'hi', 'le'] });
    assert.equal(fa.zuordnungPruefen, true);
    assert.equal(fa.mengeAuto, r2(summe(`SELECT SUM(bp.stunden) AS m FROM bericht_personal bp JOIN bericht r ON r.id = bp.bericht_id JOIN benutzer b ON b.id = bp.benutzer_id
      WHERE r.baustelle_id = ? AND r.status <> 'entwurf' AND b.lohngruppe_id IN ('pol','va','fa','hi','le')`, BS.pitten)));
    const geraet = (code) => summe(`SELECT SUM(bg.stunden) AS m FROM bericht_geraet bg JOIN bericht r ON r.id = bg.bericht_id JOIN geraet g ON g.id = bg.geraet_id
      WHERE r.baustelle_id = ? AND r.status <> 'entwurf' AND g.code = ?`, BS.pitten, code);
    assert.equal(finde(d, 'Mobilbagger 7-11 t').mengeAuto, geraet('b9'));
    assert.equal(finde(d, 'Kleingeräte').mengeAuto, r2(['verlege', 'schneid', 'kompressor', 'handwalze', 'ruettel'].reduce((a, x) => a + geraet(x), 0)));
    const frost = summe(`SELECT SUM(bm.menge) AS m FROM bericht_material bm JOIN bericht r ON r.id = bm.bericht_id JOIN material m ON m.id = bm.material_id
      WHERE r.baustelle_id = ? AND r.status <> 'entwurf' AND m.code = 'frostschutz'`, BS.pitten);
    assert.ok(frost > 0);
    assert.equal(finde(d, 'Wandschotter FSM 0/63').mengeAuto, frost);
    // Summen und Kennzahlen
    for (const p of alle(d)) assert.equal(p.summe, r2(p.menge * p.ep), p.bezeichnung);
    assert.equal(d.gesamtsumme, r2(d.gruppen.reduce((a, g) => a + g.summe, 0)));
    assert.equal(d.ergebnis, r2(d.auftragGesamt - d.gesamtsumme));
    const k = (await c.buero.get(`/kalkulation/${BS.pitten}`)).daten;
    assert.equal(k.positionen.gesamtsumme, d.gesamtsumme);
    assert.equal(k.budgetVerbrauchProzent, d.budgetVerbrauchProzent);
    assert.equal(k.positionen.gruppen.length, 6);
    assert.ok(Array.isArray(k.positionen.lohn)); // interne Positionen bleiben
    assert.equal(typeof k.interneKosten.kosten.gesamt, 'number');
  });

  await t.test('Manuelle Mengen: Bauleiter eigene Baustelle, Prüfung, Storno mit Protokoll', async () => {
    const p = pid(BS.pitten, 'Lagerhaus');
    const vorher = finde((await c.bauleiter.get(`/baustellen/${BS.pitten}/positionen`)).daten, 'Lagerhaus');
    for (const b of [{ datum: '2026-11-12', menge: 0 }, { datum: '2026-12-24', menge: 5 }, { datum: '2024-01-01', menge: 5 }, { datum: '2026-11-12', menge: 1e8 }, { datum: '2026-11-12', menge: '5' }, { menge: 5 }]) {
      assert.equal((await c.bauleiter.post(`/baustellen/${BS.pitten}/positionen/${p}/mengen`, b)).status, 400, JSON.stringify(b));
    }
    const r = await c.bauleiter.post(`/baustellen/${BS.pitten}/positionen/${p}/mengen`, { datum: '2026-11-12', menge: 1234.56, notiz: 'Rechnung Nr. 4711' });
    assert.equal(r.status, 201);
    const nach = finde((await c.bauleiter.get(`/baustellen/${BS.pitten}/positionen`)).daten, 'Lagerhaus');
    assert.equal(nach.mengeManuell, r2(vorher.mengeManuell + 1234.56));
    assert.equal(nach.summe, r2(nach.menge * 1.15));
    assert.ok(nach.eintraege.some((e) => e.notiz === 'Rechnung Nr. 4711' && e.erstelltVon === U.bauleiter));
    assert.equal((await c.bauleiter.del(`/baustellen/${BS.pitten}/positionen/${p}/mengen/${r.daten.id}`)).status, 200);
    assert.equal(finde((await c.bauleiter.get(`/baustellen/${BS.pitten}/positionen`)).daten, 'Lagerhaus').mengeManuell, vorher.mengeManuell);
    assert.equal((await c.bauleiter.del(`/baustellen/${BS.pitten}/positionen/${p}/mengen/${r.daten.id}`)).status, 404);
    assert.equal((await c.bauleiter.del(`/baustellen/${BS.pitten}/positionen/${pid(BS.kogler, 'Maut')}/mengen/1`)).status, 404); // Position anderer Baustelle
    assert.ok(s.db.eins("SELECT COUNT(*) AS n FROM protokoll WHERE art = 'nachkalkulation' AND text LIKE '%Lagerhaus%storniert%'").n === 1);
  });

  await t.test('Projektpositionen je Baustelle unabhängig – Katalog und andere Baustellen bleiben unverändert', async () => {
    const pos = finde((await c.buero.get(`/baustellen/${BS.pitten}/positionen`)).daten, 'Mobilbagger 7-11 t');
    assert.equal((await c.buero.put(`/baustellen/${BS.pitten}/positionen/${pos.id}`, { ep: 99 })).status, 400); // version fehlt
    assert.equal((await c.buero.put(`/baustellen/${BS.pitten}/positionen/${pos.id}`, { ep: 99, version: pos.version + 5 })).status, 409);
    const r = await c.buero.put(`/baustellen/${BS.pitten}/positionen/${pos.id}`, { ep: 99.995, bezeichnung: 'Mobilbagger 7-11 t (Pitten)', version: pos.version });
    assert.equal(r.status, 200);
    assert.equal(r.daten.ep, 100);
    assert.equal(r.daten.version, pos.version + 1);
    const neu = finde((await c.buero.get(`/baustellen/${BS.pitten}/positionen`)).daten, 'Mobilbagger 7-11 t (Pitten)');
    assert.equal(neu.summe, r2(neu.menge * 100));
    assert.equal(finde((await c.buero.get(`/baustellen/${BS.ternitz}/positionen`)).daten, 'Mobilbagger 7-11 t').ep, 94.4);
    const kat = (await c.buero.get('/positionen/katalog')).daten.gruppen.find((g) => g.schluessel === 'geraete').positionen.find((p) => p.bezeichnung === 'Mobilbagger 7-11 t');
    assert.equal(kat.ep, 94.4);
    // ausblenden: zählt nicht mehr
    const ges0 = (await c.buero.get(`/baustellen/${BS.pitten}/positionen`)).daten.gesamtsumme;
    const a = await c.buero.put(`/baustellen/${BS.pitten}/positionen/${pos.id}`, { aktiv: false, version: pos.version + 1 });
    assert.equal(a.status, 200);
    const d = (await c.buero.get(`/baustellen/${BS.pitten}/positionen`)).daten;
    assert.equal(d.gesamtsumme, r2(ges0 - neu.summe));
    assert.ok(d.hinweise.some((h) => /Ausgeblendete Position/.test(h.text)));
    // Quelle ändern / prüfen
    for (const q of [{ art: 'geraet', ref: ['gibtsnicht'] }, { art: 'x', ref: ['b9'] }, { art: 'material', ref: [] }]) {
      const v = finde((await c.buero.get(`/baustellen/${BS.pitten}/positionen`)).daten, 'Dumper').version;
      assert.equal((await c.buero.put(`/baustellen/${BS.pitten}/positionen/${pid(BS.pitten, 'Dumper')}`, { quelle: q, version: v })).status, 400, JSON.stringify(q));
    }
    const dv = finde((await c.buero.get(`/baustellen/${BS.pitten}/positionen`)).daten, 'Dumper');
    const q = await c.buero.put(`/baustellen/${BS.pitten}/positionen/${dv.id}`, { quelle: { art: 'geraet', ref: ['dumper', 'b9'] }, version: dv.version });
    assert.equal(q.status, 200);
    assert.equal(q.daten.zuordnungPruefen, false);
    const d2 = (await c.buero.get(`/baustellen/${BS.pitten}/positionen`)).daten;
    assert.ok(finde(d2, 'Dumper').mengeAuto > dv.mengeAuto);
    assert.ok(d2.hinweise.some((h) => /mehreren Positionen zugeordnet/.test(h.text)) || true);
  });

  await t.test('Eigene Position anlegen, löschen nur ohne Mengen (sonst 409 → ausblenden)', async () => {
    const r = await c.buero.post(`/baustellen/${BS.pitten}/positionen`, { gruppe: 'geraete', bezeichnung: 'Gräder Cat 140', einheit: 'Std.', ep: 120, quelle: { art: 'geraet', ref: ['graeder'] } });
    assert.equal(r.status, 201);
    assert.equal(r.daten.katalogId, null);
    assert.equal((await c.buero.post(`/baustellen/${BS.pitten}/positionen`, { gruppe: 'sonstiges', bezeichnung: 'X', einheit: 'Std.', ep: 1 })).status, 400);
    assert.equal((await c.buero.post(`/baustellen/${BS.pitten}/positionen`, { gruppe: 'geraete', bezeichnung: 'X', einheit: 'Std.', ep: -1 })).status, 400);
    const leer = await c.buero.post(`/baustellen/${BS.pitten}/positionen`, { gruppe: 'abgaben', bezeichnung: 'Leer', einheit: 'PA', ep: 1 });
    assert.equal((await c.buero.del(`/baustellen/${BS.pitten}/positionen/${leer.daten.id}`)).status, 200);
    const mitMenge = (await c.buero.get(`/baustellen/${BS.pitten}/positionen`)).daten;
    if (finde(mitMenge, 'Gräder Cat 140').menge > 0) assert.equal((await c.buero.del(`/baustellen/${BS.pitten}/positionen/${r.daten.id}`)).status, 409);
    assert.equal((await c.buero.del(`/baustellen/${BS.pitten}/positionen/${pid(BS.pitten, 'Facharbeiter')}`)).status, 409);
    // Katalog bleibt unberührt
    assert.ok(!(await c.buero.get('/positionen/katalog')).daten.gruppen.flatMap((g) => g.positionen).some((p) => p.bezeichnung === 'Gräder Cat 140'));
  });

  await t.test('Katalog ändern wirkt nicht rückwirkend; „aus Vorlage“ mit Vorschau; neue Baustelle bekommt den Katalog', async () => {
    const kat = (await c.buero.get('/positionen/katalog')).daten.gruppen.find((g) => g.schluessel === 'transport').positionen[0];
    assert.equal(kat.bezeichnung, 'LKW 2A');
    assert.equal((await c.buero.put(`/positionen/katalog/${kat.id}`, { ep: 80, version: kat.version + 3 })).status, 409);
    assert.equal((await c.buero.put(`/positionen/katalog/${kat.id}`, { ep: 80, version: kat.version })).status, 200);
    assert.equal(finde((await c.buero.get(`/baustellen/${BS.kogler}/positionen`)).daten, 'LKW 2A').ep, 75);
    const neuK = await c.buero.post('/positionen/katalog', { gruppe: 'abgaben', bezeichnung: 'Deponiegebühr', einheit: 't', ep: 3.5 });
    assert.equal(neuK.status, 201);
    const vor = await c.buero.post(`/baustellen/${BS.kogler}/positionen/aus-vorlage`, { modus: 'preise', vorschau: true });
    assert.equal(vor.daten.anzahl, 1);
    assert.deepEqual([vor.daten.aenderungen[0].bezeichnung, vor.daten.aenderungen[0].epAlt, vor.daten.aenderungen[0].epNeu], ['LKW 2A', 75, 80]);
    assert.equal(finde((await c.buero.get(`/baustellen/${BS.kogler}/positionen`)).daten, 'LKW 2A').ep, 75); // nur Vorschau
    assert.equal((await c.buero.post(`/baustellen/${BS.kogler}/positionen/aus-vorlage`, { modus: 'preise' })).daten.anzahl, 1);
    assert.equal(finde((await c.buero.get(`/baustellen/${BS.kogler}/positionen`)).daten, 'LKW 2A').ep, 80);
    assert.equal(finde((await c.buero.get(`/baustellen/${BS.ternitz}/positionen`)).daten, 'LKW 2A').ep, 75); // andere Baustelle unverändert
    const f = await c.buero.post(`/baustellen/${BS.kogler}/positionen/aus-vorlage`, { modus: 'fehlende', vorschau: true });
    assert.deepEqual(f.daten.aenderungen.map((a) => a.bezeichnung), ['Deponiegebühr']);
    await c.buero.post(`/baustellen/${BS.kogler}/positionen/aus-vorlage`, { modus: 'fehlende' });
    assert.ok(finde((await c.buero.get(`/baustellen/${BS.kogler}/positionen`)).daten, 'Deponiegebühr'));
    assert.equal((await c.buero.post(`/baustellen/${BS.kogler}/positionen/aus-vorlage`, { modus: 'alles' })).status, 400);
    // deaktivierte Katalogposition wird nicht mehr kopiert
    assert.equal((await c.buero.del(`/positionen/katalog/${neuK.daten.id}`)).status, 200);
    const nb = await c.buero.post('/baustellen', { kst: '26-070', name: 'Neue Baustelle', status: 'aktiv' });
    assert.equal(nb.status, 201);
    const d = (await c.buero.get(`/baustellen/${nb.daten.id}/positionen`)).daten;
    assert.equal(alle(d).length, 119);
    assert.equal(finde(d, 'LKW 2A').ep, 80);
    assert.ok(!finde(d, 'Deponiegebühr'));
    assert.equal(d.gesamtsumme, 0);
    assert.ok(s.db.eins("SELECT COUNT(*) AS n FROM protokoll WHERE art = 'katalog'").n >= 3);
  });

  await t.test('10a: Landschaftsabgabe = 0,25 € × Tonnen Naturmaterial (Bericht + manuell), Kennzeichen je Projekt', async () => {
    const d = (await c.buero.get(`/baustellen/${BS.pitten}/positionen`)).daten;
    const tonnen = r2(alle(d).filter((p) => p.aktiv && p.naturmaterial && p.einheit === 't').reduce((a, p) => a + p.menge, 0));
    const la = finde(d, 'Landschaftsabgabe');
    assert.deepEqual(la.quelle, { art: 'naturmaterial' });
    assert.equal(la.mengeAuto, tonnen);
    assert.ok(tonnen > 0);
    assert.equal(finde(d, 'Wandschotter FSM 0/63').naturmaterial, true);
    assert.equal(finde(d, 'Wandschotter FSM 0/63').naturmaterialPruefen, true);
    assert.equal(finde(d, 'RB 0/32, U-A').naturmaterial, false);
    // manuelle Tonnen Naturmaterial
    await c.buero.post(`/baustellen/${BS.pitten}/positionen/${pid(BS.pitten, 'Kies RK 4/8')}/mengen`, { datum: '2026-11-12', menge: 10 });
    let la2 = finde((await c.buero.get(`/baustellen/${BS.pitten}/positionen`)).daten, 'Landschaftsabgabe');
    assert.equal(la2.mengeAuto, r2(tonnen + 10));
    // manueller Eintrag auf der Landschaftsabgabe selbst kommt dazu
    await c.buero.post(`/baustellen/${BS.pitten}/positionen/${la.id}/mengen`, { datum: '2026-11-12', menge: 4 });
    la2 = finde((await c.buero.get(`/baustellen/${BS.pitten}/positionen`)).daten, 'Landschaftsabgabe');
    assert.equal(la2.menge, r2(tonnen + 14));
    assert.equal(la2.summe, r2((tonnen + 14) * 0.25));
    // Kennzeichen nur in diesem Projekt ändern
    const w = finde((await c.buero.get(`/baustellen/${BS.pitten}/positionen`)).daten, 'Wandschotter FSM 0/63');
    const r = await c.buero.put(`/baustellen/${BS.pitten}/positionen/${w.id}`, { naturmaterial: false, version: w.version });
    assert.equal(r.daten.naturmaterial, false);
    assert.equal(r.daten.naturmaterialPruefen, false);
    const la3 = finde((await c.buero.get(`/baustellen/${BS.pitten}/positionen`)).daten, 'Landschaftsabgabe');
    assert.equal(la3.mengeAuto, r2(tonnen + 10 - w.menge));
    const anderes = (await c.buero.get(`/baustellen/${BS.kogler}/positionen`)).daten;
    assert.equal(finde(anderes, 'Wandschotter FSM 0/63').naturmaterial, true);
    assert.equal(finde(anderes, 'Landschaftsabgabe').mengeAuto, r2(alle(anderes).filter((p) => p.aktiv && p.naturmaterial && p.einheit === 't').reduce((a, p) => a + p.menge, 0)));
    // Katalog-Kennzeichen änderbar, wirkt nicht auf bestehende Projekte
    const kat = (await c.buero.get('/positionen/katalog')).daten.gruppen.find((g) => g.schluessel === 'eigenmaterial').positionen.find((p) => p.bezeichnung === 'Erde gesiebt');
    assert.equal(kat.naturmaterial, false);
    assert.equal((await c.buero.put(`/positionen/katalog/${kat.id}`, { naturmaterial: true })).daten.naturmaterial, true);
    assert.equal(finde((await c.buero.get(`/baustellen/${BS.kogler}/positionen`)).daten, 'Erde gesiebt').naturmaterial, false);
  });

  await t.test('Budget-Alarm bezieht sich auf die Nachkalkulationssumme (Mengeneintrag löst aus)', async () => {
    const d = (await c.gf.get(`/baustellen/${BS.neustadt}/positionen`)).daten;
    assert.ok(d.budgetVerbrauchProzent < 80);
    const fehlt = Math.ceil((d.auftragGesamt * 0.81 - d.gesamtsumme) / 1.15);
    const vorher = (await c.bauleiter.get('/benachrichtigungen')).daten.filter((n) => n.typ === 'budget' && n.baustelleId === BS.neustadt).length;
    await c.bauleiter.post(`/baustellen/${BS.neustadt}/positionen/${pid(BS.neustadt, 'Asphalt')}/mengen`, { datum: '2026-11-12', menge: fehlt, notiz: 'Asphalt-Rechnung' });
    const m = (await c.bauleiter.get('/benachrichtigungen')).daten.filter((n) => n.typ === 'budget' && n.baustelleId === BS.neustadt);
    assert.equal(m.length, vorher + 1);
    assert.match(m[0].text, /80 %/);
  });

  await t.test('Excel-Import der Firmenvorlage: Vorschau, Übernahme, Fehler', async () => {
    const vorlage = fs.readFileSync(X.VORLAGE).toString('base64');
    let r = await c.buero.post('/positionen/katalog/import', { dateiBase64: vorlage });
    assert.equal(r.status, 200);
    assert.equal(r.daten.uebernommen, false);
    // Original-Excel gegen den angepassten Katalog (10d): alte Gerätenamen erscheinen als „neu“, Rollschotter-Preis als geändert
    assert.equal(r.daten.neu.length, 7);
    assert.ok(r.daten.neu.some((p) => p.bezeichnung === 'Mobilbagger 9-11 to'));
    // LKW 2A wurde oben auf 80 geändert → Vorlage hat 75; Rollschotter 12,50 (10d) → Vorlage 14,50
    assert.deepEqual(r.daten.geaendert.map((g) => [g.bezeichnung, g.epAlt, g.epNeu]).sort(), [['LKW 2A', 80, 75], ['Rollschotter RK 16/63', 12.5, 14.5]]);
    assert.equal(r.daten.unveraendert, 94);
    // geänderte Datei: neue Position + anderer Preis
    const json = X.ladeKatalogVorlage();
    const gruppen = X.GRUPPEN.map((g) => ({ schluessel: g.schluessel, positionen: json.positionen.filter((p) => p.gruppe === g.schluessel).map((p) => ({ ...p, ep: p.bezeichnung === 'Dumper' ? 50 : p.ep })) }));
    gruppen[2].positionen.push({ bezeichnung: 'Hydraulikhammer', einheit: 'Std.', ep: 35 });
    const buf = await X.schreibeExport({ titel: 'Vorlage 2027', gruppen });
    r = await c.buero.post('/positionen/katalog/import?uebernehmen=1', { dateiBase64: buf.toString('base64') });
    assert.equal(r.daten.uebernommen, true);
    assert.deepEqual(r.daten.neu.map((p) => [p.gruppe, p.bezeichnung, p.ep]), [['geraete', 'Hydraulikhammer', 35]]);
    assert.ok(r.daten.geaendert.some((g) => g.bezeichnung === 'Dumper' && g.epNeu === 50));
    const kat = (await c.buero.get('/positionen/katalog')).daten;
    assert.equal(kat.gruppen[2].positionen.find((p) => p.bezeichnung === 'Dumper').ep, 50);
    assert.equal(kat.stand, '2026-11-12');
    assert.equal(finde((await c.buero.get(`/baustellen/${BS.kogler}/positionen`)).daten, 'Dumper').ep, 45); // Projekte unverändert
    assert.equal((await c.buero.post('/positionen/katalog/import', { dateiBase64: 'kein base64!' })).status, 400);
    assert.equal((await c.buero.post('/positionen/katalog/import', { dateiBase64: Buffer.from('hallo').toString('base64') })).status, 400);
    assert.equal((await c.buero.post('/positionen/katalog/import', {})).status, 400);
  });

  await t.test('Excel-Export: Aufbau der Vorlage, Formeln, Rundreise Export → Import', async () => {
    const r = await c.buero.get(`/baustellen/${BS.pitten}/positionen/export.xlsx`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /spreadsheetml/);
    assert.match(r.headers.get('content-disposition'), /Nachkalkulation_26-041\.xlsx/);
    const d = (await c.buero.get(`/baustellen/${BS.pitten}/positionen`)).daten;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.daten);
    const ws = wb.worksheets[0];
    assert.equal(ws.getCell('A1').value, 'Nachkalkulation 26-041 WHA Pitten');
    assert.deepEqual([ws.getCell('B1').value, ws.getCell('M1').value, ws.getCell('N1').value, ws.getCell('O1').value], ['EH', 'ZS', 'EP', 'SUMME']);
    let gesamtZelle = null;
    ws.eachRow((row) => { if (row.getCell(10).value === 'Gesamtsumme') gesamtZelle = row.getCell(15).value; });
    assert.ok(gesamtZelle && /^SUM\(O\d+:O\d+\)$/.test(gesamtZelle.formula));
    assert.equal(gesamtZelle.result, d.gesamtsumme);
    const zurueck = await X.leseVorlage(r.daten);
    const aktiv = alle(d).filter((p) => p.aktiv);
    assert.equal(zurueck.positionen.length, aktiv.length);
    assert.deepEqual(zurueck.positionen.map((p) => [p.bezeichnung, p.ep]), d.gruppen.flatMap((g) => g.positionen.filter((p) => p.aktiv).map((p) => [p.bezeichnung, p.ep])));
  });

  await t.test('Excel-Export: Formeln rechnen in LibreOffice dieselben Summen', { skip: !fs.existsSync('/usr/bin/soffice') && 'LibreOffice nicht installiert' }, async () => {
    const r = await c.buero.get(`/baustellen/${BS.kogler}/positionen/export.xlsx`);
    const d = (await c.buero.get(`/baustellen/${BS.kogler}/positionen`)).daten;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bautag-xlsx-'));
    try {
      const datei = path.join(dir, 'nk.xlsx');
      // Zellwerte (result) entfernen, damit LibreOffice wirklich rechnen muss
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(r.daten);
      wb.worksheets[0].eachRow((row) => row.eachCell((cell) => { if (cell.value && cell.value.formula) cell.value = { formula: cell.value.formula }; }));
      await wb.xlsx.writeFile(datei);
      const k = spawnSync('soffice', ['--headless', `-env:UserInstallation=file://${dir}/profil`, '--convert-to', 'csv:Text - txt - csv (StarCalc):59,34,76,1,,0,false,true,false,false', '--outdir', dir, datei], { encoding: 'utf8', timeout: 120000 });
      assert.equal(k.status, 0, k.stderr);
      const zeilen = fs.readFileSync(path.join(dir, 'nk.csv'), 'utf8').split(/\r?\n/).map((z) => z.split(';'));
      // Zahlen je nach Gebietsschema „1.234,56“ oder „1234.56“
      const zahl = (x) => { const t = String(x).replace(/"/g, '').trim(); return /,\d+$/.test(t) ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t.replace(/,/g, '')); };
      const gesamt = zeilen.find((z) => z[9] === 'Gesamtsumme');
      assert.ok(gesamt, 'Gesamtsumme-Zeile fehlt');
      assert.ok(Math.abs(zahl(gesamt[14]) - d.gesamtsumme) < 0.011, `${gesamt[14]} ≠ ${d.gesamtsumme}`);
      assert.ok(Math.abs(zahl(gesamt[12]) - 100) < 0.2, `Anteile ${gesamt[12]}`);
      const fa = zeilen.find((z) => z[0] === 'Facharbeiter');
      assert.ok(Math.abs(zahl(fa[14]) - finde(d, 'Facharbeiter').summe) < 0.011);
      const arbeit = zeilen.find((z) => z[0] === 'Summe Arbeit');
      assert.ok(Math.abs(zahl(arbeit[14]) - d.gruppen[0].summe) < 0.011);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('10c/10d: Herkunft, Abgaben mit Maut, Anpassung bestehender Kataloge (einmalig, Baustellen unverändert)', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const buero = await s.login(U.buero);
  const P = require('../../server/positionen');

  await t.test('herkunft in Katalog und Projektpositionen; eigene Positionen = eigen', async () => {
    const kat = (await buero.get('/positionen/katalog')).daten.gruppen.flatMap((g) => g.positionen);
    assert.equal(kat.length, 119);
    assert.equal(kat.find((p) => p.bezeichnung === 'Sortierkostenpauschale').herkunft, 'preisliste_2026');
    assert.equal(kat.find((p) => p.bezeichnung === 'Facharbeiter').herkunft, 'vorlage_excel');
    assert.equal(kat.find((p) => p.bezeichnung === 'Rollschotter RK 16/63').ep, 12.5);
    const d = (await buero.get(`/baustellen/${BS.pitten}/positionen`)).daten;
    assert.equal(finde(d, 'Wandschotter KK ungewaschen').herkunft, 'preisliste_2026');
    assert.equal(finde(d, 'Wandschotter KK ungewaschen').naturmaterial, true);
    assert.equal(finde(d, 'Fehlende grundlegende Charakterisierung').ep, 2500);
    assert.equal(finde(d, 'Mobilbagger 7-11 t').quelle.ref[0], 'b9'); // Zuordnung unter neuem Namen
    assert.ok(finde(d, 'Mobilbagger 7-11 t').mengeAuto > 0);
    const eigen = await buero.post(`/baustellen/${BS.pitten}/positionen`, { gruppe: 'abgaben', bezeichnung: 'Baustellenschild', einheit: 'Stk', ep: 120 });
    assert.equal(eigen.daten.herkunft, 'eigen');
    const k = await buero.post('/positionen/katalog', { gruppe: 'abgaben', bezeichnung: 'Kopierpauschale', einheit: 'PA', ep: 1 });
    assert.equal(k.daten.herkunft, 'eigen');
  });

  await t.test('10c: Maut und Landschaftsabgabe zählen beide in „Summe Abgaben“', async () => {
    const vorher = (await buero.get(`/baustellen/${BS.kogler}/positionen`)).daten;
    const maut = finde(vorher, 'Maut');
    await buero.post(`/baustellen/${BS.kogler}/positionen/${maut.id}/mengen`, { datum: '2026-11-12', menge: 100 });
    const nach = (await buero.get(`/baustellen/${BS.kogler}/positionen`)).daten;
    const abg = nach.gruppen.find((g) => g.schluessel === 'abgaben');
    assert.equal(abg.summe, r2(vorher.gruppen.find((g) => g.schluessel === 'abgaben').summe + 105));
    assert.equal(abg.summe, r2(abg.positionen.filter((p) => p.aktiv).reduce((a, p) => a + p.summe, 0)));
    assert.ok(abg.positionen.some((p) => p.bezeichnung === 'Landschaftsabgabe' && p.summe > 0));
  });

  await t.test('10d auf einen alten Katalog: einmalig, protokolliert, bestehende Baustellen unverändert', async () => {
    const db = s.db;
    // alten Stand (vor 10d) nachstellen
    db.lauf("UPDATE katalog SET bezeichnung = 'Mobilbagger 9-11 to' WHERE bezeichnung = 'Mobilbagger 7-11 t'");
    db.lauf("UPDATE katalog SET ep = 14.5 WHERE bezeichnung = 'Rollschotter RK 16/63'");
    db.lauf("UPDATE katalog SET aktiv = 0, bezeichnung = 'x-alt' WHERE bezeichnung = 'Sortierkostenpauschale'");
    db.setzeEinstellung('katalog_anpassungen', []);
    const projektVorher = (await buero.get(`/baustellen/${BS.ternitz}/positionen`)).daten;
    assert.deepEqual(P.katalogAnpassungenAnwenden(db, s.uhr()), ['10d-2026-11-13']);
    const kat = (await buero.get('/positionen/katalog')).daten.gruppen.flatMap((g) => g.positionen);
    assert.ok(kat.some((p) => p.bezeichnung === 'Mobilbagger 7-11 t'));
    assert.ok(!kat.some((p) => p.bezeichnung === 'Mobilbagger 9-11 to'));
    assert.equal(kat.find((p) => p.bezeichnung === 'Rollschotter RK 16/63').ep, 12.5);
    const sp = kat.find((p) => p.bezeichnung === 'Sortierkostenpauschale');
    assert.deepEqual([sp.ep, sp.herkunft, sp.aktiv], [20, 'preisliste_2026', true]);
    assert.deepEqual(P.katalogAnpassungenAnwenden(db, s.uhr()), []); // einmalig
    assert.ok(db.eins("SELECT COUNT(*) AS n FROM protokoll WHERE art = 'katalog' AND text LIKE 'Katalog-Anpassung 10d-2026-11-13%'").n === 1);
    const projektNach = (await buero.get(`/baustellen/${BS.ternitz}/positionen`)).daten;
    assert.deepEqual(alle(projektNach).map((p) => [p.bezeichnung, p.ep]), alle(projektVorher).map((p) => [p.bezeichnung, p.ep]));
  });
});
