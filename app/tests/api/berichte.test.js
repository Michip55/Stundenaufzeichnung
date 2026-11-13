'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS, euroFelder } = require('./hilfe');
const { demoUnterschrift } = require('../../server/png');

/** Text aus einem unkomprimierten pdfkit-PDF (TJ-Operatoren mit Hex-Strings) */
function pdfText(buf) {
  const s = buf.toString('latin1');
  const out = [];
  for (const m of s.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    out.push([...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join(''));
  }
  return out.join('\n');
}

test('Bautagesbericht: Erstellen aus Stempelungen, Bearbeiten, Unterschrift, Freigabe, PDF', async (t) => {
  const s = await starte({ pdfUnkomprimiert: true });
  t.after(() => s.stop());
  const pol = await s.login(U.polier);
  const bl = await s.login(U.bauleiter);
  const buero = await s.login(U.buero);
  const ma = await s.login(U.mitarbeiter);
  let id;

  await t.test('Stempelungen der Partie (07:00–12:00, 12:30–16:00)', async () => {
    let r = await pol.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: [1, 2, 4, 5], typ: 'kommen', zeit: '2026-11-12T06:00:00.000Z' });
    assert.ok(r.daten.ergebnisse.every((x) => x.ok), JSON.stringify(r.daten));
    s.uhr.setze('2026-11-12T11:00:00.000Z');
    r = await pol.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: [1, 2, 4, 5], typ: 'pause_start' });
    s.uhr.setze('2026-11-12T11:30:00.000Z');
    r = await pol.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: [1, 2, 4, 5], typ: 'pause_ende' });
    s.uhr.setze('2026-11-12T15:00:00.000Z');
    r = await pol.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: [1, 2, 4, 5], typ: 'gehen' });
    assert.ok(r.daten.ergebnisse.every((x) => x.ok));
  });

  await t.test('POST /berichte füllt Personal automatisch (zwei Blöcke, Pause, Stunden, Abwesenheit)', async () => {
    assert.equal((await ma.post('/berichte', { baustelleId: BS.pitten, datum: '2026-11-12' })).status, 403);
    const r = await pol.post('/berichte', { baustelleId: BS.pitten, datum: '2026-11-12' });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    id = r.daten.id;
    assert.equal(r.daten.status, 'entwurf');
    assert.equal(r.daten.baustelle.kst, '26-041');
    const p = Object.fromEntries(r.daten.personal.map((x) => [x.benutzerId, x]));
    assert.equal(r.daten.personal[0].benutzerId, U.polier); // Polier zuerst
    for (const uid of [1, 2, 4, 5]) {
      assert.deepEqual([p[uid].von1, p[uid].bis1, p[uid].von2, p[uid].bis2, p[uid].pauseMin, p[uid].stunden], ['07:00', '12:00', '12:30', '16:00', 30, 8.5], `Person ${uid}`);
    }
    assert.equal(p[3].code, 'U'); // Urlaub laut Abwesenheit
    assert.equal(p[3].stunden, 0);
    assert.equal(r.daten.gesamtstunden, 34);
    assert.deepEqual(euroFelder(r.daten), []); // Polier: keine Kosten
  });

  await t.test('Doppelt anlegen → 409 mit id; Eingabefehler → 400', async () => {
    const r = await pol.post('/berichte', { baustelleId: BS.pitten, datum: '2026-11-12' });
    assert.equal(r.status, 409);
    assert.equal(r.daten.id, id);
    assert.equal((await pol.post('/berichte', { baustelleId: BS.pitten, datum: '2026-11-20' })).status, 400);
    assert.equal((await pol.post('/berichte', { baustelleId: BS.pitten, datum: '12.11.2026' })).status, 400);
    assert.equal((await pol.post('/berichte', { baustelleId: 999, datum: '2026-11-12' })).status, 400);
    assert.equal((await pol.post('/berichte', { datum: '2026-11-12' })).status, 400);
  });

  await t.test('Büro/Bauleiter sehen kostenTag, Polier nicht', async () => {
    const b = (await buero.get(`/berichte/${id}`)).daten;
    assert.equal(b.kostenTag.lohn, Math.round((8.5 * 58 + 8.5 * 46 + 8.5 * 47 + 8.5 * 39.5) * 100) / 100);
    assert.equal(typeof (await bl.get(`/berichte/${id}`)).daten.kostenTag.gesamt, 'number');
    assert.ok(!('kostenTag' in (await pol.get(`/berichte/${id}`)).daten));
  });

  await t.test('PUT: Teil-Update aller Abschnitte', async () => {
    const r = await pol.putV(`/berichte/${id}`, {
      geraete: [{ geraetId: 15, stunden: 8 }, { geraetId: 22, stunden: 6 }, { geraetId: 1, stunden: 0 }],
      material: [{ materialId: 4, menge: 42 }, { materialId: 7, menge: 38 }],
      arbeitsleistung: 'Frostschutz 0/63 eingebracht und verdichtet.\nRandleisten versetzt.',
      materialbeistellung: { eigen: 'Frostschutz Kieswerk', fremd: ['Schachtabdeckung Kl. D 400', 'beigestellt vom AG'] },
      paletten: { euro: 4, weissenboeck: 6 },
      regie: [{ text: 'Zufahrt Müllplatz provisorisch geschottert', stunden: 2 }],
      vorkommnisse: 'Anweisung AG: Zufahrt Stiege 1 befahrbar halten.',
      seg: { taetigkeit: 'Staubzulage (Schneidarbeiten)', stunden: 3 },
      wetter: { text: 'bewölkt', temperatur: 7 },
      id: 12345, status: 'freigegeben' // schreibgeschützte Felder werden ignoriert
    });
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    assert.equal(r.daten.status, 'entwurf');
    assert.equal(r.daten.id, id);
    assert.deepEqual(r.daten.geraete.map((g) => [g.code, g.stunden]), [['b9', 8], ['ruettel', 6]]);
    assert.deepEqual(r.daten.material.map((m) => [m.code, m.menge, m.einheit]), [['frostschutz', 42, 'to'], ['pflaster8', 38, 'm²']]);
    assert.equal(r.daten.materialbeistellung.fremd, 'Schachtabdeckung Kl. D 400\nbeigestellt vom AG');
    assert.deepEqual(r.daten.paletten, { euro: 4, weissenboeck: 6 });
    assert.deepEqual(r.daten.regie, [{ text: 'Zufahrt Müllplatz provisorisch geschottert', stunden: 2 }]);
    assert.deepEqual(r.daten.seg, { taetigkeit: 'Staubzulage (Schneidarbeiten)', stunden: 3 });
    assert.deepEqual(r.daten.wetter, { text: 'bewölkt', temperatur: 7 });
    // Personal händisch: Stunden werden aus den Blöcken gerechnet
    const pers = r.daten.personal.map((p) => ({ ...p }));
    const i2 = pers.findIndex((p) => p.benutzerId === 2);
    pers[i2] = { ...pers[i2], von1: '07:00', bis1: '16:00', von2: null, bis2: null, pauseMin: 30, stunden: undefined, segStunden: 3 };
    const r2 = await pol.putV(`/berichte/${id}`, { personal: pers });
    assert.equal(r2.status, 200, JSON.stringify(r2.daten));
    const p2 = r2.daten.personal.find((p) => p.benutzerId === 2);
    assert.deepEqual([p2.von1, p2.bis1, p2.von2, p2.stunden, p2.segStunden], ['07:00', '16:00', null, 8.5, 3]);
  });

  await t.test('PUT: Eingabeprüfung', async () => {
    const bad = [
      { geraete: [{ geraetId: 9999, stunden: 2 }] },
      { geraete: [{ geraetId: 15, stunden: 25 }] },
      { geraete: [{ geraetId: 15, stunden: 2 }, { geraetId: 15, stunden: 3 }] },
      { geraete: 'Bagger' },
      { material: [{ materialId: 4, menge: -1 }] },
      { material: [{ materialId: 4, menge: '42' }] },
      { personal: [{ benutzerId: 2, von1: '12:00', bis1: '12:00' }] },
      { personal: [{ benutzerId: 2, von1: '07:00', bis1: '23:00', von2: '06:00', bis2: '10:00' }] }, // > 24 Std.
      { personal: [{ benutzerId: 2, von1: '07:00', bis1: '12:00', stunden: 5, segStunden: 6 }] }, // SEG > Stunden
      { personal: [{ benutzerId: 2, von1: '7 Uhr', bis1: '12:00' }] },
      { personal: [{ benutzerId: 2, von1: '07:00' }] },
      { personal: [{ benutzerId: 2, code: 'X' }] },
      { personal: [{ benutzerId: 2 }, { benutzerId: 2 }] },
      { personal: [{ benutzerId: 99999 }] },
      { personal: [{ benutzerId: 2, stunden: 30 }] },
      { paletten: { euro: -1 } },
      { paletten: { euro: 1.5 } },
      { regie: [{ text: '', stunden: 1 }] },
      { arbeitsleistung: 42 },
      { arbeitsleistung: 'x'.repeat(10001) },
      { wetter: { a: { b: 1 } } },
      {}
    ];
    for (const b of bad) {
      const r = await pol.putV(`/berichte/${id}`, b);
      assert.equal(r.status, 400, JSON.stringify(b).slice(0, 80));
      assert.equal(r.daten.code, 'UNGUELTIG');
      assert.ok(r.daten.fehler.length > 3);
    }
  });

  await t.test('Personal neu aus Stempelungen übernehmen (nur Entwurf)', async () => {
    const r = await pol.post(`/berichte/${id}/personal-aktualisieren`);
    assert.equal(r.status, 200);
    assert.equal(r.daten.personal.find((p) => p.benutzerId === 2).stunden, 8.5);
    assert.equal(r.daten.personal.find((p) => p.benutzerId === 2).segStunden, 3);
  });

  await t.test('Unterschriften: Prüfung, erst beide → unterschrieben, danach nicht mehr bearbeitbar', async () => {
    assert.equal((await pol.post(`/berichte/${id}/unterschrift`, { rolle: 'an', name: 'Josef Haidbauer', bildPng: 'data:image/jpeg;base64,AAAA' })).status, 400);
    assert.equal((await pol.post(`/berichte/${id}/unterschrift`, { rolle: 'an', name: 'Josef Haidbauer', bildPng: 'data:image/png;base64,AAAAAAAAAAAA' })).status, 400);
    assert.equal((await pol.post(`/berichte/${id}/unterschrift`, { rolle: 'xx', name: 'J', bildPng: demoUnterschrift('a') })).status, 400);
    assert.equal((await pol.post(`/berichte/${id}/unterschrift`, { rolle: 'an', name: '', bildPng: demoUnterschrift('a') })).status, 400);
    assert.equal((await ma.post(`/berichte/${id}/unterschrift`, { rolle: 'an', name: 'X', bildPng: demoUnterschrift('a') })).status, 403);
    assert.equal((await pol.post(`/berichte/${id}/freigeben`)).status, 403);
    assert.equal((await buero.post(`/berichte/${id}/freigeben`)).status, 409); // erst nach Unterschriften
    let r = await pol.post(`/berichte/${id}/unterschrift`, { rolle: 'an', name: 'Josef Haidbauer', bildPng: demoUnterschrift('an') });
    assert.equal(r.status, 200);
    assert.equal(r.daten.status, 'entwurf');
    assert.equal(r.daten.unterschriften.an.name, 'Josef Haidbauer');
    r = await pol.post(`/berichte/${id}/unterschrift`, { rolle: 'bh', name: 'Ing. Helga Auer', bildPng: demoUnterschrift('bh') });
    assert.equal(r.daten.status, 'unterschrieben');
    assert.equal(r.daten.bearbeitbar, false);
    assert.match(r.daten.unterschriften.bh.bildPng, /^data:image\/png;base64,/);
    assert.equal((await pol.putV(`/berichte/${id}`, { vorkommnisse: 'nachträglich' })).status, 409);
    assert.equal((await pol.post(`/berichte/${id}/unterschrift`, { rolle: 'bh', name: 'X', bildPng: demoUnterschrift('x') })).status, 409);
    assert.equal((await pol.post(`/berichte/${id}/personal-aktualisieren`)).status, 409);
    // Hinweis „wartet auf Freigabe“ an Bauleiter, Büro, GF – nicht an Polier
    assert.ok((await bl.get('/benachrichtigungen')).daten.some((n) => n.typ === 'bericht' && /WHA Pitten/.test(n.titel)));
    assert.ok(!(await pol.get('/benachrichtigungen')).daten.some((n) => n.typ === 'bericht'));
  });

  await t.test('Freigabe: Bauleiter nur eigene Baustellen, einmalig, Protokoll', async () => {
    const fremd = s.db.eins("SELECT id FROM bericht WHERE baustelle_id = ? AND status = 'unterschrieben' LIMIT 1", BS.reisinger).id;
    assert.equal((await bl.post(`/berichte/${fremd}/freigeben`)).status, 403);
    const r = await bl.post(`/berichte/${id}/freigeben`);
    assert.equal(r.status, 200);
    assert.equal(r.daten.status, 'freigegeben');
    assert.equal(r.daten.freigabe.benutzerId, U.bauleiter);
    assert.equal((await bl.post(`/berichte/${id}/freigeben`)).status, 409);
    assert.equal((await buero.post(`/berichte/${fremd}/freigeben`)).status, 200);
    const entwurf = s.db.eins("SELECT id FROM bericht WHERE status = 'entwurf' AND baustelle_id = ?", BS.ternitz).id;
    assert.equal((await buero.post(`/berichte/${entwurf}/freigeben`)).status, 409);
    assert.ok(s.db.eins("SELECT COUNT(*) AS n FROM protokoll WHERE art = 'freigabe'").n >= 2);
    assert.equal((await buero.post('/berichte/999999/freigeben')).status, 404);
    assert.equal((await buero.get('/berichte/abc')).status, 400);
  });

  await t.test('Liste mit Filtern', async () => {
    const r = await buero.get(`/berichte?baustelleId=${BS.pitten}&status=freigegeben&von=2026-11-01&bis=2026-11-12`);
    assert.equal(r.status, 200);
    assert.ok(r.daten.length > 3);
    assert.ok(r.daten.every((b) => b.baustelleId === BS.pitten && b.status === 'freigegeben' && b.datum >= '2026-11-01'));
    assert.equal(r.daten[0].datum, '2026-11-12');
    assert.deepEqual(r.daten[0].unterschriften, { an: true, bh: true });
    assert.equal((await buero.get('/berichte?status=fertig')).status, 400);
    assert.equal((await buero.get('/berichte?von=gestern')).status, 400);
  });

  await t.test('PDF: gültig, Aufbau der Vorlage, nie €-Werte, K/U nur in interner Fassung', async () => {
    const r = await pol.get(`/berichte/${id}/pdf`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    assert.match(r.headers.get('content-disposition'), /Bautagesbericht_26-041_2026-11-12\.pdf/);
    assert.equal(r.daten.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.ok(!r.daten.includes(Buffer.from('€', 'utf8')));
    const text = pdfText(r.daten);
    for (const muss of ['BAUTAGESBERICHT', 'Michael Pichler Ges.m.b.H.', '2624 Breitenau', 'KST.: 26-041', 'Datum: 12.11.2026', 'AUFTRAGGEBER:', 'BAUVORHABEN:', 'PERSONAL:', 'Arbeitszeit', 'Gesamtstunden:',
      'SEG-Zulagen:', 'GERÄTE:', 'MATERIAL:', 'ARBEITSLEISTUNG:', 'MATERIALBEISTELLUNG:', 'PALETTEN RETOUR:', 'REGIELEISTUNGEN:', 'BESONDERE VORKOMMNISSE:',
      'AUFTRAGNEHMER oder dessen Beauftragter', 'BAUHERR oder dessen bevollmächtigter Vertreter', 'Josef Haidbauer', 'Wohnbau Schwarzatal', 'Bagger 9 to.', 'Grabenwalze', 'Frostschutz', 'Ing. Helga Auer']) {
      assert.ok(text.includes(muss), `PDF enthält „${muss}“ nicht`);
    }
    assert.ok(!text.includes('€'), 'PDF enthält €');
    assert.ok(!/\bEUR\b/.test(text));
    assert.ok(!text.includes('Daniel Schwarz'), 'Urlaub (U) darf im PDF für den Auftraggeber nicht erscheinen');
    // interne Fassung: nur Bauleitung/Büro, mit Kürzeln
    assert.equal((await pol.get(`/berichte/${id}/pdf?fassung=intern`)).status, 403);
    assert.equal((await ma.get(`/berichte/${id}/pdf`)).status, 403);
    const intern = await buero.get(`/berichte/${id}/pdf?fassung=intern`);
    assert.equal(intern.status, 200);
    const it = pdfText(intern.daten);
    assert.ok(it.includes('Daniel Schwarz'));
    assert.ok(!it.includes('€'));
    assert.equal((await buero.get(`/berichte/${id}/pdf?fassung=geheim`)).status, 400);
  });

  await t.test('PDF eines Testdaten-Berichts mit vielen Positionen', async () => {
    const ids = s.db.alle("SELECT id FROM bericht WHERE status = 'freigegeben' ORDER BY id LIMIT 5").map((x) => x.id);
    for (const bid of ids) {
      const r = await buero.get(`/berichte/${bid}/pdf`);
      assert.equal(r.status, 200);
      assert.equal(r.daten.subarray(0, 4).toString(), '%PDF');
      assert.ok(!pdfText(r.daten).includes('€'));
    }
  });
});
