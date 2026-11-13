'use strict';
/** Regressionstests zu PRUEFBERICHT_5_SERVICEBUCH.md (F-01 … F-15, Backend-Anteile) */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { starte, U, BS, START } = require('./hilfe');
const { testJpeg, testPng, testWebp, chunk } = require('./fuhrpark-bilder');
const { pngGrau } = require('../../server/png');
const { createApp } = require('../../server/index');
const { oeffneDatenbank } = require('../../server/db');

const H = '2026-11-12';
const b64 = (b) => b.toString('base64');
function pdfText(buf) {
  const s = buf.toString('latin1');
  const out = [];
  for (const m of s.matchAll(/\[([^\]]*)\]\s*TJ/g)) out.push([...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join(''));
  return out.join('\n');
}

test('Prüfbericht 5 – Schäden (F-01, F-05, F-07, F-12, F-13, F-14)', async (t) => {
  const s = await starte({ pdfUnkomprimiert: true });
  t.after(() => s.stop());
  const ma = await s.login(U.mitarbeiter);
  const buero = await s.login(U.buero);
  const bl = await s.login(U.bauleiter);
  const pol8 = await s.login(U.polier2);

  await t.test('F-01: fremdes Gerät × einsatzfähig ja/eingeschränkt/nein → 201, Meldung, keine Sperre', async () => {
    const gesperrtVorher = s.db.alle('SELECT id FROM anlage').length;
    for (const einsatzfaehig of ['ja', 'eingeschraenkt', 'nein']) {
      const r = await ma.post('/fuhrpark/schaeden', { fremdGeraet: `Mietbagger Fa. Huber ${einsatzfaehig}`, art: 'unfall', ursache: 'Ausleger gegen Brücke gestoßen', einsatzfaehig, fotos: [{ bildBase64: b64(testPng()) }] });
      assert.equal(r.status, 201, `${einsatzfaehig}: ${JSON.stringify(r.daten)}`);
      assert.equal(r.daten.anlageId, null);
      const n = s.db.alle("SELECT * FROM benachrichtigung WHERE benutzer_id = ? AND schluessel = ?", U.buero, `fp:mangel:${r.daten.id}`);
      assert.equal(n.length, 1);
      assert.equal(n[0].titel, `Schaden gemeldet: Mietbagger Fa. Huber ${einsatzfaehig}`);
    }
    assert.equal(s.db.alle('SELECT id FROM anlage').length, gesperrtVorher);
    assert.ok(!(await ma.get('/fuhrpark/anlagen')).daten.some((a) => a.sperrGruende.some((g) => g.typ === 'schaden')));
  });

  await t.test('F-14: scheitert die Transaktion nach dem Schreiben, bleibt keine Fotodatei liegen', async () => {
    const vorher = fs.existsSync(s.app.bt.uploads) ? fs.readdirSync(s.app.bt.uploads).length : 0;
    const orig = s.db.protokolliere.bind(s.db);
    s.db.protokolliere = (e) => { if (e.art === 'fuhrpark_schaden') throw new Error('Testfehler'); return orig(e); };
    const err = console.error; console.error = () => {};
    try {
      const r = await ma.post('/fuhrpark/schaeden', { anlageId: 29, art: 'defekt', ursache: 'Motor startet nicht mehr', einsatzfaehig: 'nein', fotos: [{ bildBase64: b64(testJpeg()) }] });
      assert.equal(r.status, 500);
    } finally { s.db.protokolliere = orig; console.error = err; }
    assert.equal(fs.readdirSync(s.app.bt.uploads).length, vorher);
    assert.equal((await ma.get('/fuhrpark/anlagen/29')).daten.status === 'gesperrt', false);
  });

  await t.test('F-05: Zeitpunkt aus vorgehender Geräteuhr wird auf „jetzt“ gekappt', async () => {
    const r = await ma.post('/fuhrpark/schaeden', { anlageId: 29, art: 'defekt', ursache: 'Riemen quietscht beim Anlaufen', einsatzfaehig: 'ja', zeitpunkt: new Date(s.uhr().getTime() + 10 * 60000).toISOString() });
    assert.equal(r.status, 201);
    assert.equal(r.daten.zeitpunkt, s.uhr().toISOString());
    assert.equal((await ma.post('/fuhrpark/schaeden', { anlageId: 29, art: 'defekt', ursache: 'Riemen quietscht beim Anlaufen', einsatzfaehig: 'ja', zeitpunkt: '2025-01-01T08:00:00Z' })).status, 400);
  });

  await t.test('F-07: über die API – leeres JPEG, Riesen-PNG, animiertes WebP abgelehnt; Steuerzeichen im Dateinamen entfernt', async () => {
    const sch = (await ma.post('/fuhrpark/schaeden', { anlageId: 29, art: 'defekt', ursache: 'Ölwanne undicht, tropft', einsatzfaehig: 'ja' })).daten;
    const pfad = `/fuhrpark/schaeden/${sch.id}/fotos`;
    const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
    const seg = (m, d) => Buffer.concat([Buffer.from([0xff, m]), u16(d.length + 2), d]);
    const leer = Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xc0, Buffer.concat([Buffer.from([8]), u16(1), u16(1), Buffer.from([1, 1, 0x11, 0])])), seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])), Buffer.from([0xff, 0xd9])]);
    assert.equal(leer.length, 27);
    assert.equal((await ma.post(pfad, { bildBase64: b64(leer) })).status, 400);
    const p = pngGrau(2, 2, [1, 2, 3, 4]);
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(100000, 0); ihdr.writeUInt32BE(100000, 4); ihdr[8] = 8;
    assert.equal((await ma.post(pfad, { bildBase64: b64(Buffer.concat([p.subarray(0, 8), chunk('IHDR', ihdr), p.subarray(33)])) })).status, 400);
    const anim = testWebp({ anhang: false }); anim[anim.indexOf(Buffer.from('VP8X')) + 8] |= 0x02;
    assert.equal((await ma.post(pfad, { bildBase64: b64(anim) })).status, 400);
    const ok = await ma.post(pfad, { bildBase64: b64(p), dateiname: 'a‮gpj.exe' });
    assert.equal(ok.status, 201);
    assert.equal(ok.daten.dateiname, 'agpj.exe');
  });

  await t.test('F-12: Bauleiter sieht Schäden seiner Leute ohne Baustellenangabe', async () => {
    const r = await ma.post('/fuhrpark/schaeden', { anlageId: 26, art: 'verschleiss', ursache: 'Bodenplatte stark abgenutzt', einsatzfaehig: 'ja' });
    assert.equal(r.daten.baustelleId, null);
    assert.equal((await bl.get(`/fuhrpark/schaeden/${r.daten.id}`)).status, 200);
    assert.ok((await bl.get('/fuhrpark/schaeden')).daten.some((x) => x.id === r.daten.id));
    assert.equal((await pol8.get(`/fuhrpark/schaeden/${r.daten.id}`)).status, 403);
  });

  await t.test('F-13: Ursache fremder Schäden weder im PDF noch im Sperrgrund', async () => {
    const r = await ma.post('/fuhrpark/schaeden', { anlageId: 31, baustelleId: BS.pitten, art: 'defekt', ursache: 'GEHEIM-Ursache-XYZ Hydraulik', einsatzfaehig: 'nein' });
    assert.equal(r.status, 201);
    const fremd = pdfText((await pol8.get('/fuhrpark/anlagen/31/servicebuch.pdf')).daten);
    assert.ok(!/GEHEIM-Ursache/.test(fremd));
    assert.match(pdfText((await buero.get('/fuhrpark/anlagen/31/servicebuch.pdf')).daten), /GEHEIM-Ursache/);
    for (const c of [pol8, ma, buero]) {
      const a = (await c.get('/fuhrpark/anlagen/31')).daten;
      assert.equal(a.status, 'gesperrt');
      assert.ok(!JSON.stringify(a.sperrGruende).includes('GEHEIM'));
    }
  });

  await t.test('F-14: höchstens 30 Schadensmeldungen je Melder in 24 Stunden (Büro ausgenommen)', async () => {
    const c = await s.login(9);
    let letzte;
    for (let i = 0; i < 31; i++) letzte = await c.post('/fuhrpark/schaeden', { fremdGeraet: 'Leihgerät Muster', art: 'sonstiges', ursache: `Testmeldung Nummer ${i + 1} zur Grenze`, einsatzfaehig: 'ja' });
    assert.equal(letzte.status, 429);
    assert.equal(letzte.daten.code, 'ZU_VIELE_VERSUCHE');
    assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM mangel WHERE gemeldet_von = 9 AND typ = 'schaden'").n, 30);
    assert.equal((await buero.post('/fuhrpark/schaeden', { fremdGeraet: 'Leihgerät Muster', art: 'sonstiges', ursache: 'Büro meldet trotzdem', einsatzfaehig: 'ja' })).status, 201);
  });
});

test('F-14: Upload-Ordner liegt standardmäßig neben der Datenbank', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bautag-f14-'));
  const alt = process.env.BAUTAG_UPLOADS; delete process.env.BAUTAG_UPLOADS;
  try {
    const app = createApp({ dbPath: path.join(dir, 'x.db'), uhr: () => new Date(START), seed: false, demo: false });
    assert.equal(app.bt.uploads, path.join(dir, 'uploads'));
    app.schliessen();
  } finally {
    if (alt !== undefined) process.env.BAUTAG_UPLOADS = alt;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Prüfbericht 5 – Fälligkeit und Einträge (F-02, F-03, F-04, F-08, F-09, F-10)', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  let buero = await s.login(U.buero);
  let ma = await s.login(U.mitarbeiter);
  let pkw, lkw;
  /** Uhr stellen und neu anmelden (Sitzungen laufen bei Uhrsprüngen ab) */
  const uhr = async (iso) => { s.uhr.setze(iso); buero = await s.login(U.buero); ma = await s.login(U.mitarbeiter); };

  await t.test('F-02: neu angelegt ohne letzte Durchführung – Bezugspunkt fest, überfällig sperrt', async () => {
    pkw = (await buero.post('/fuhrpark/anlagen', { bezeichnung: 'PKW Test M1', klasse: 'pkw', fahrzeugklasse: 'M1', erstzulassung: '2023-12-05', vorlagen: ['57a_m1'] })).daten;
    assert.equal(pkw.status, 'bald');
    lkw = (await buero.post('/fuhrpark/anlagen', { bezeichnung: 'LKW Test N3', klasse: 'lkw', fahrzeugklasse: 'N3', erstzulassung: '2021-10-01', vorlagen: ['57a_jaehrlich', 'winter_lkw'] })).daten;
    assert.equal(lkw.status, 'gesperrt'); // Begutachtung 10/2026 nicht erfasst
    const p57 = lkw.plan.find((p) => p.vorlage.schluessel === '57a_jaehrlich');
    assert.equal(p57.status, 'ueberfaellig');
    assert.equal(p57.faelligAm, '2026-10-01');
    assert.equal(lkw.plan.find((p) => p.vorlage.schluessel === 'winter_lkw').status, 'faellig');
    await uhr('2026-11-15T23:30:00.000Z'); // 16.11. Wien
    assert.equal((await buero.get(`/fuhrpark/anlagen/${lkw.id}/plan`)).daten.find((p) => p.vorlage.schluessel === 'winter_lkw').status, 'ueberfaellig');
    await uhr('2027-04-30T10:00:00.000Z');
    assert.equal((await buero.get(`/fuhrpark/anlagen/${pkw.id}`)).daten.status, 'faellig');
    await uhr('2027-05-01T10:00:00.000Z');
    const spaeter = (await buero.get(`/fuhrpark/anlagen/${pkw.id}`)).daten;
    assert.equal(spaeter.status, 'gesperrt');
    assert.equal(spaeter.plan[0].status, 'ueberfaellig');
    assert.equal(spaeter.plan[0].faelligAm, '2026-12-01');
    // Eintrag erledigt die Begutachtung → nächster Termin, frei
    const e = await buero.post('/fuhrpark/eintraege', { anlageId: pkw.id, art: 'pruefung', datum: '2027-05-01', werkstatt: 'Prüfstelle', titel: '§57a', pruefErgebnis: 'ohne_maengel', planpositionIds: [spaeter.plan[0].id] });
    assert.equal(e.status, 201, JSON.stringify(e.daten));
    const frei = (await buero.get(`/fuhrpark/anlagen/${pkw.id}`)).daten;
    assert.equal(frei.status, 'einsatzbereit');
    assert.equal(frei.plan[0].faelligAm, '2028-12-01');
    await uhr(START);
  });

  await t.test('F-03: rückdatierter Eintrag setzt die jüngere Durchführung nicht zurück', async () => {
    const plan = (await buero.get('/fuhrpark/anlagen/1/plan')).daten;
    const ms = plan.find((p) => p.vorlage.schluessel === 'tacho_massenspeicher');
    assert.equal(ms.status, 'bald');
    const start = s.db.eins("SELECT s.* FROM zaehlerstand s JOIN zaehler z ON z.id = s.zaehler_id WHERE z.anlage_id = 1 AND z.art = 'km' AND s.quelle = 'start'");
    const r = await buero.post('/fuhrpark/eintraege', { anlageId: 1, art: 'sonstiges', datum: start.datum, werkstatt: 'intern', titel: 'Massenspeicher (nachgetragen)', zaehler: [{ art: 'km', anzeige: start.anzeige }], planpositionIds: [ms.id] });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    const nach = (await buero.get('/fuhrpark/anlagen/1/plan')).daten.find((p) => p.id === ms.id);
    assert.equal(nach.letzteDatum, ms.letzteDatum);
    assert.equal(nach.status, 'bald');
    // F-04: Storno entwertet den übernommenen Startstand nicht
    assert.equal(s.db.eins('SELECT eintrag_id FROM zaehlerstand WHERE id = ?', start.id).eintrag_id, r.daten.id);
    assert.equal((await buero.post(`/fuhrpark/eintraege/${r.daten.id}/storno`, { grund: 'Doppelt erfasst' })).status, 200);
    const st = s.db.eins('SELECT * FROM zaehlerstand WHERE id = ?', start.id);
    assert.equal(st.status, 'gueltig');
    assert.equal(st.eintrag_id, null);
  });

  await t.test('F-04: Storno lässt den Stand eines Mitarbeiters gültig', async () => {
    const a = (await ma.get('/fuhrpark/anlagen/5')).daten;
    const km = Math.ceil(a.zaehler[0].aktuell) + 100;
    const m = await ma.post('/fuhrpark/zaehlerstaende', { anlageId: 5, art: 'km', anzeige: km, datum: H });
    assert.equal(m.status, 201);
    const e = await buero.post('/fuhrpark/eintraege', { anlageId: 5, art: 'reifen', datum: H, werkstatt: 'Reifen Muster', titel: 'Reifen geprüft', zaehler: [{ art: 'km', anzeige: km }] });
    assert.equal(e.status, 201);
    await buero.post(`/fuhrpark/eintraege/${e.daten.id}/storno`, { grund: 'falsch' });
    assert.equal(s.db.eins('SELECT status FROM zaehlerstand WHERE id = ?', m.daten.stand.id).status, 'gueltig');
    assert.equal((await ma.get('/fuhrpark/anlagen/5')).daten.zaehler[0].letzterStand.anzeige, km);
  });

  await t.test('F-08: verworfene Mängel lassen sich nicht über einen Eintrag „beheben“', async () => {
    const m = (await ma.post('/fuhrpark/maengel', { anlageId: 19, text: 'Fehlalarm Warnleuchte', dringlichkeit: 'sofort' })).daten;
    assert.equal((await buero.put(`/fuhrpark/maengel/${m.id}`, { status: 'verworfen', notiz: 'Sensor ok' })).status, 200);
    const a = (await buero.get('/fuhrpark/anlagen/19')).daten;
    const r = await buero.post('/fuhrpark/eintraege', { anlageId: 19, art: 'reparatur', datum: H, werkstatt: 'intern', titel: 'x', zaehler: [{ art: 'bh', anzeige: Math.ceil(a.zaehler[0].aktuell) }], maengelIds: [m.id] });
    assert.equal(r.status, 400);
    assert.match(r.daten.fehler, /nicht offen/);
  });

  await t.test('F-09: Prüfung mit schweren Mängeln erledigt die Frist nicht', async () => {
    const a = (await buero.get('/fuhrpark/anlagen/12')).daten;
    const p57 = a.plan.find((p) => p.vorlage.schluessel === '57a_m1');
    const r = await buero.post('/fuhrpark/eintraege', { anlageId: 12, art: 'pruefung', datum: H, werkstatt: 'Prüfstelle', titel: '§57a', pruefErgebnis: 'schwere_maengel', zaehler: [{ art: 'km', anzeige: Math.ceil(a.zaehler[0].aktuell) }], planpositionIds: [p57.id] });
    assert.equal(r.status, 201);
    assert.deepEqual(r.daten.erledigt, []);
    assert.ok(r.daten.warnungen.some((w) => /schweren Mängeln/.test(w)));
    const n = (await buero.get('/fuhrpark/anlagen/12')).daten;
    assert.equal(n.status, 'gesperrt');
    assert.equal(n.plan.find((p) => p.id === p57.id).letzteDatum, p57.letzteDatum);
  });

  await t.test('F-10: Mangel um 00:01 Wiener Zeit → „seit“ ist der Wiener Tag', async () => {
    await uhr('2026-11-12T23:01:00.000Z'); // 13.11. 00:01 Wien
    assert.equal((await ma.post('/fuhrpark/maengel', { anlageId: 22, text: 'Lenkung schwergängig', dringlichkeit: 'sofort' })).status, 201);
    const a = (await ma.get('/fuhrpark/anlagen/22')).daten;
    assert.equal(a.sperrGruende.find((g) => g.typ === 'mangel').seit, '2026-11-13');
    await uhr(START);
  });
});

test('Prüfbericht 5 – Bericht und Zurechnung (F-11)', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const buero = await s.login(U.buero);
  const pol = await s.login(U.polier);
  const geraet = (code) => s.db.eins('SELECT id FROM geraet WHERE code = ?', code).id;

  await t.test('F-11: zweite Anlage zum Gerät ändert die Schätzung der ersten nicht rückwirkend', async () => {
    const vorher = (await buero.get('/fuhrpark/anlagen/17')).daten.zaehler[0];
    assert.equal(vorher.geschaetzt, true);
    const r = await buero.post('/fuhrpark/anlagen', { bezeichnung: 'Mobilbagger 2', klasse: 'baumaschine', geraetId: geraet('b9'), zaehler: [{ art: 'bh', startstand: 100, startdatum: H, ausBericht: true }] });
    assert.equal(r.status, 201);
    const nach = (await buero.get('/fuhrpark/anlagen/17')).daten.zaehler[0];
    assert.equal(nach.aktuell, vorher.aktuell);
    assert.equal(nach.geschaetzt, true);
    assert.ok(!(await buero.get('/fuhrpark/uebersicht')).daten.nichtZugeordnet.some((x) => x.code === 'b9'));
  });

  await t.test('F-11: zwei Zeilen desselben Geräts mit verschiedenen Anlagen im Bericht', async () => {
    const b = (await pol.post('/berichte', { baustelleId: BS.pitten, datum: H })).daten;
    const rl = geraet('radlader');
    const doppelt = await pol.put(`/berichte/${b.id}`, { version: b.version, geraete: [{ geraetId: rl, stunden: 4, anlageId: 20 }, { geraetId: rl, stunden: 3, anlageId: 20 }] });
    assert.equal(doppelt.status, 400);
    assert.equal((await pol.put(`/berichte/${b.id}`, { version: b.version, geraete: [{ geraetId: rl, stunden: 4 }, { geraetId: rl, stunden: 3, anlageId: 21 }] })).status, 400);
    const ok = await pol.put(`/berichte/${b.id}`, { version: b.version, geraete: [{ geraetId: rl, stunden: 4, anlageId: 20 }, { geraetId: rl, stunden: 3, anlageId: 21 }] });
    assert.equal(ok.status, 200, JSON.stringify(ok.daten));
    assert.deepEqual(ok.daten.geraete.filter((g) => g.geraetId === rl).map((g) => [g.anlageId, g.stunden]).sort(), [[20, 4], [21, 3]]);
    const pdf = await pol.get(`/berichte/${b.id}/pdf`);
    assert.equal(pdf.status, 200);
    const k = (await (await s.login(U.bauleiter)).get(`/kalkulation/${BS.pitten}`));
    assert.equal(k.status, 200);
  });
});

test('Prüfbericht 5 – Migration 10: Bezugspunkt für bestehende Planpositionen (F-02)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bautag-p5-'));
  const datei = path.join(dir, 'alt.db');
  try {
    const alt = oeffneDatenbank(datei, { bisVersion: 9 });
    const t0 = '2026-03-02T08:00:00.000Z';
    alt.lauf("INSERT INTO anlage (id, bezeichnung, klasse, erstzulassung, erstellt) VALUES (1, 'PKW alt', 'pkw', '2019-04-10', ?)", t0);
    alt.lauf(`INSERT INTO planposition (id, anlage_id, titel, art, regel) VALUES (1, 1, '§57a', 'gesetzlich', '{"folgeMonate":[36,24,12],"monatsgenau":true}'),
      (2, 1, 'Service', 'hersteller', '{"intervallMonate":12}')`);
    alt.schliessen();
    const app = createApp({ dbPath: datei, uhr: () => new Date(START), seed: false, demo: false, uploads: path.join(dir, 'up') });
    const db = app.bt.db;
    assert.equal(db.eins('SELECT bezug_datum FROM planposition WHERE id = 1').bezug_datum, '2019-04-10');
    assert.equal(db.eins('SELECT bezug_datum FROM planposition WHERE id = 2').bezug_datum, '2026-03-02');
    // ohne erfasste Begutachtung seit EZ: erster Termin 04/2022 → überfällig
    const S = require('../../server/fuhrpark-daten').ladeStand(db, H);
    assert.equal(S.anlagen.get(1).positionen[0].calc.status, 'ueberfaellig');
    app.schliessen();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
