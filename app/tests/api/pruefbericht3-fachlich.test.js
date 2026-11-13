'use strict';
/** Regressionstests PRUEFBERICHT_3: D-03, D-04, D-05, D-06, D-07, D-08, D-09, D-10 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const { starte, U, BS } = require('./hilfe');
const { demoUnterschrift, pngBildpunkte, crc32 } = require('../../server/png');
const { oeffneDatenbank } = require('../../server/db');
const { einrichten } = require('../../server/einrichten');

const APP = path.join(__dirname, '..', '..');

/** Gleiches Bild, anders kodiert: andere Kompression + Zusatz-Chunk */
function umkodiert(dataUrl) {
  const p = pngBildpunkte(Buffer.from(dataUrl.split(',')[1], 'base64'));
  const chunk = (typ, d) => {
    const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(typ), d]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
    return Buffer.concat([l, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(p.w, 0); ihdr.writeUInt32BE(p.h, 4); ihdr[8] = p.bittiefe; ihdr[9] = p.farbtyp;
  const zeile = p.daten.length / p.h;
  const roh = Buffer.alloc((zeile + 1) * p.h);
  for (let y = 0; y < p.h; y++) p.daten.copy(roh, y * (zeile + 1) + 1, y * zeile, (y + 1) * zeile);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    chunk('tEXt', Buffer.from('Comment\0anders')), chunk('IDAT', zlib.deflateSync(roh, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
  return 'data:image/png;base64,' + png.toString('base64');
}

test('D-04, D-05, D-07, D-08, D-09, D-10', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const pol = await s.login(U.polier);
  const bl = await s.login(U.bauleiter);
  const buero = await s.login(U.buero);
  const gf = await s.login(U.gf);
  let bid;

  await t.test('D-04: Bauleiter/GF nie im Vorschlag, Vorschlag speicherbar, ihre Stempelstunden zählen', async () => {
    await bl.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
    await gf.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
    await (await s.login(4)).post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
    s.uhr.plus(120);
    for (const c of [bl, gf, await s.login(4)]) await c.post('/zeit/stempeln', { typ: 'gehen' });
    const b = await pol.post('/berichte', { baustelleId: BS.pitten, datum: '2026-11-12' });
    bid = b.daten.id;
    const ids = b.daten.personal.map((p) => p.benutzerId);
    assert.ok(ids.includes(4));
    assert.ok(!ids.includes(U.bauleiter) && !ids.includes(U.gf));
    assert.equal((await pol.putV(`/berichte/${bid}`, { personal: b.daten.personal })).status, 200);
    assert.ok(!(await pol.postV(`/berichte/${bid}/personal-aktualisieren`)).daten.personal.some((p) => p.benutzerId === U.gf));
  });

  await t.test('D-07: Unterschrift und Personal-Übernahme verlangen die aktuelle Version', async () => {
    const v = (await pol.get(`/berichte/${bid}`)).daten.version;
    assert.equal((await pol.post(`/berichte/${bid}/unterschrift`, { rolle: 'an', name: 'Josef Haidbauer', bildPng: demoUnterschrift('d07') })).status, 400);
    assert.equal((await pol.post(`/berichte/${bid}/personal-aktualisieren`, {})).status, 400);
    assert.equal((await buero.putV(`/berichte/${bid}`, { vorkommnisse: 'Büro hat geändert' })).status, 200);
    const alt = await pol.post(`/berichte/${bid}/unterschrift`, { rolle: 'an', name: 'Josef Haidbauer', bildPng: demoUnterschrift('d07'), version: v });
    assert.equal(alt.status, 409);
    assert.equal(alt.daten.version, v + 1);
  });

  await t.test('D-05: vorhandene Unterschrift nicht überschreibbar; Bild-Abgleich über Bildpunkte', async () => {
    const A = demoUnterschrift('d05-bauherr');
    assert.equal((await pol.postV(`/berichte/${bid}/unterschrift`, { rolle: 'bh', name: 'DI Echt', bildPng: A })).status, 200);
    const zweit = await pol.postV(`/berichte/${bid}/unterschrift`, { rolle: 'bh', name: 'Jemand anders', bildPng: demoUnterschrift('d05-b') });
    assert.equal(zweit.status, 409);
    assert.match(zweit.daten.fehler, /zurückziehen/);
    assert.equal((await pol.get(`/berichte/${bid}`)).daten.unterschriften.bh.name, 'DI Echt');
    assert.equal((await buero.del(`/berichte/${bid}/unterschrift/bh`)).status, 200);
    const plusNull = 'data:image/png;base64,' + Buffer.concat([Buffer.from(A.split(',')[1], 'base64'), Buffer.from([0])]).toString('base64');
    assert.equal((await pol.postV(`/berichte/${bid}/unterschrift`, { rolle: 'bh', name: 'DI Echt', bildPng: plusNull })).status, 400);
    assert.equal((await pol.postV(`/berichte/${bid}/unterschrift`, { rolle: 'bh', name: 'DI Echt', bildPng: umkodiert(A) })).status, 400);
    assert.equal((await pol.postV(`/berichte/${bid}/unterschrift`, { rolle: 'bh', name: 'DI Echt', bildPng: demoUnterschrift('d05-neu') })).status, 200);
  });

  await t.test('D-10: wer die AN-Unterschrift erfasst hat, gibt nicht selbst frei (GF: markiert)', async () => {
    // Bauleiter erfasst AN selbst → darf nicht freigeben
    assert.equal((await bl.postV(`/berichte/${bid}/unterschrift`, { rolle: 'an', name: 'Stefan Aigner', bildPng: demoUnterschrift('d10-an') })).status, 200);
    const r = await bl.post(`/berichte/${bid}/freigeben`);
    assert.equal(r.status, 403);
    assert.match(r.daten.fehler, /Vier-Augen-Prinzip/);
    assert.equal((await buero.post(`/berichte/${bid}/freigeben`)).status, 200);
    // GF-Selbstfreigabe wird markiert
    const b2 = await gf.post('/berichte', { baustelleId: BS.reisinger, datum: '2026-11-12' });
    await gf.postV(`/berichte/${b2.daten.id}/unterschrift`, { rolle: 'an', name: 'Michael Pichler', bildPng: demoUnterschrift('d10-gf-an') });
    await gf.postV(`/berichte/${b2.daten.id}/unterschrift`, { rolle: 'bh', name: 'Claudia Reisinger', bildPng: demoUnterschrift('d10-gf-bh') });
    const f = await gf.post(`/berichte/${b2.daten.id}/freigeben`);
    assert.equal(f.status, 200);
    assert.equal(f.daten.selbstfreigabe, true);
    assert.ok(s.db.eins("SELECT COUNT(*) AS n FROM protokoll WHERE text LIKE '%Selbstfreigabe durch GF%'").n === 1);
    assert.ok((await buero.get('/monat?monat=2026-11')).daten.warnungen.some((w) => w.typ === 'selbstfreigabe' && w.berichtId === b2.daten.id));
  });

  await t.test('D-04: Stempelstunden von Bauleiter/GF zählen trotz freigegebenem Bericht', async () => {
    const m = (await buero.get('/monat?monat=2026-11')).daten;
    for (const id of [U.bauleiter, U.gf]) {
      const tag = m.mitarbeiter.find((x) => x.id === id).tage['2026-11-12'];
      assert.equal(tag.stunden, 2, `Benutzer ${id}`);
      assert.equal(tag.quelle, 'stempel');
    }
    assert.ok(!m.warnungen.some((w) => [U.bauleiter, U.gf].includes(w.benutzerId) && w.typ === 'nicht_im_bericht'));
  });

  await t.test('D-08: genehmigte Abwesenheit mit Arbeitsstunden → Warnung und CSV-Hinweis', async () => {
    assert.equal((await buero.post('/abwesenheiten', { benutzerId: 2, datum: '2026-11-10', code: 'K' })).status, 201);
    const m = (await buero.get('/monat?monat=2026-11')).daten;
    assert.ok(m.warnungen.some((w) => w.benutzerId === 2 && w.datum === '2026-11-10' && w.typ === 'abwesenheit_mit_stunden'));
    const csv = (await buero.get('/monat/export.csv?monat=2026-11')).daten.toString('utf8');
    assert.match(csv, /Hinweis;Prüfen: Lukas Brandstätter 10\.11\.2026 – Genehmigte Abwesenheit „K“ und 8 Arbeitsstunden/);
  });

  await t.test('D-09: Polier meldet SW für sich; Bauleiter (wie Büro) bestätigt SW und Urlaub', async () => {
    const r = await pol.post('/abwesenheiten', { benutzerId: U.polier, datum: '2026-11-12', code: 'SW' });
    assert.equal(r.status, 201);
    assert.equal(r.daten.status, 'beantragt');
    assert.equal((await pol.post('/abwesenheiten', { benutzerId: U.polier, datum: '2026-11-13', code: 'K' })).status, 403);
    assert.equal((await bl.put(`/abwesenheiten/${r.daten.id}`, { status: 'genehmigt' })).status, 200);
    const fremd = await (await s.login(13)).post('/abwesenheiten', { benutzerId: 14, datum: '2026-11-12', code: 'SW' });
    assert.equal(fremd.status, 201);
    assert.equal(fremd.daten.status, 'gemeldet');
    // Bauleiter wie Büro (13.11.2026): auch auf 26-044 (gehört der GF) und Urlaub
    assert.equal((await bl.post(`/abwesenheiten/sw-meldungen/${fremd.daten.meldungId}/bestaetigen`, {})).status, 200);
    const u = await (await s.login(2)).post('/abwesenheiten', { benutzerId: 2, datum: '2026-11-20', code: 'U' });
    assert.equal((await bl.put(`/abwesenheiten/${u.daten.id}`, { status: 'genehmigt' })).status, 200);
  });
});

test('D-03: Überschneidung über die Tagesgrenze (Nachtschicht)', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  s.uhr.setze('2027-11-10T09:00:00.000Z');
  const buero = await s.login(U.buero);
  const pol = await s.login(U.polier);
  const pol8 = await s.login(U.polier2);

  await t.test('D-03: Original-Reproduktion – Bericht des Folgetags gegen Nachtschicht', async () => {
    assert.equal((await buero.post('/zeit/schichten', { benutzerId: 3, baustelleId: BS.pitten, datum: '2027-11-08', von: '22:00', bis: '06:00', pauseMin: 0, grund: 'Nachtschicht' })).status, 201);
    const b = await pol.post('/berichte', { baustelleId: BS.pitten, datum: '2027-11-09' });
    assert.ok(!b.daten.personal.some((p) => p.benutzerId === 3));
    const r = await pol.putV(`/berichte/${b.daten.id}`, { personal: [{ benutzerId: 3, von1: '00:00', bis1: '06:00', pauseMin: 0 }] });
    assert.equal(r.status, 400);
    assert.match(r.daten.fehler, /Schicht vom 08\.11\.2027/);
  });

  await t.test('D-03: Berichtszeilen von Vortag und Folgetag', async () => {
    const b9 = await pol8.post('/berichte', { baustelleId: BS.kogler, datum: '2027-11-09' });
    assert.equal((await pol8.putV(`/berichte/${b9.daten.id}`, { personal: [{ benutzerId: 9, von1: '04:00', bis1: '12:00', pauseMin: 0 }] })).status, 200);
    const b8 = await pol.post('/berichte', { baustelleId: BS.pitten, datum: '2027-11-08' });
    const r = await pol.putV(`/berichte/${b8.daten.id}`, { personal: [...b8.daten.personal, { benutzerId: 9, von1: '22:00', bis1: '06:00', pauseMin: 0, gast: true }] });
    assert.equal(r.status, 400);
    assert.match(r.daten.fehler, /Bericht von Baustelle 26-038 vom 09\.11\.2027/);
    assert.equal((await pol.putV(`/berichte/${b8.daten.id}`, { personal: [...b8.daten.personal, { benutzerId: 9, von1: '18:00', bis1: '22:00', pauseMin: 0, gast: true }] })).status, 200);
  });

  await t.test('D-03: Sicherheitsnetz im Monat über die Tagesgrenze (8 statt 14 Std.)', async () => {
    const b = s.db.eins('SELECT id FROM bericht WHERE baustelle_id = ? AND datum = ?', BS.pitten, '2027-11-09').id;
    s.db.lauf("INSERT INTO bericht_personal (bericht_id, benutzer_id, von1, bis1, pause_min, stunden, pos) VALUES (?, 3, '00:00', '06:00', 0, 6, 9)", b);
    s.db.lauf("UPDATE bericht SET status = 'freigegeben' WHERE id = ?", b);
    const m = (await buero.get('/monat?monat=2027-11')).daten;
    const ma3 = m.mitarbeiter.find((x) => x.id === 3);
    assert.equal(ma3.tage['2027-11-08'].stunden, 8);
    assert.equal(ma3.tage['2027-11-09'].stunden, 0);
    assert.equal(ma3.tage['2027-11-09'].ueberschneidung, true);
    assert.equal(ma3.summe, 8);
    assert.ok(m.warnungen.some((w) => w.benutzerId === 3 && w.typ === 'ueberschneidung' && /Tagesgrenze/.test(w.text)));
  });
});

test('D-06: Testdaten nur im Demo-Modus, Einrichtung einer leeren Echt-Datenbank', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bautag-einrichten-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  await t.test('D-06: npm run seed ohne BAUTAG_DEMO=1 bricht ab', () => {
    const env = { ...process.env, BAUTAG_DB: path.join(dir, 'seed.db') };
    delete env.BAUTAG_DEMO;
    const r = spawnSync(process.execPath, ['server/seed.js'], { cwd: APP, env, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /nur im Demo-Modus/);
    assert.ok(!fs.existsSync(path.join(dir, 'seed.db')));
  });

  await t.test('D-06: einrichten() – erste GF, Stammlisten ohne Preise, Regeln', () => {
    const db = oeffneDatenbank(':memory:');
    assert.throws(() => einrichten(db, { name: 'Michael Pichler', pnr: 1, pin: '1234' }), /6 bis 12/);
    assert.throws(() => einrichten(db, { name: 'Michael Pichler', pnr: 1, pin: '123456' }), /Zahlenfolge/);
    assert.throws(() => einrichten(db, { name: 'MP', pnr: 1, pin: '582916' }), /Name/);
    const gf = einrichten(db, { name: 'Michael Pichler', pnr: 1, pin: '582916' });
    assert.equal(gf.pnr, 1);
    assert.equal(db.eins('SELECT COUNT(*) AS n FROM geraet').n, 23);
    assert.equal(db.eins('SELECT SUM(kostensatz) AS s FROM geraet').s, 0);
    assert.equal(db.eins('SELECT COUNT(*) AS n FROM baustelle WHERE intern = 0').n, 0);
    assert.deepEqual(db.alle('SELECT kst, name FROM baustelle WHERE intern = 1').map((b) => [b.kst, b.name]), [['9000', 'Büro']]); // 12.25
    assert.equal(db.eins('SELECT muss_pin_aendern FROM benutzer').muss_pin_aendern, 0);
    assert.throws(() => einrichten(db, { name: 'Zweite GF', pnr: 2, pin: '582917' }), /bereits Benutzer/);
    db.schliessen();
  });

  await t.test('D-06: Befehl node server/einrichten.js mit Argumenten; Anmeldung danach', async () => {
    const dbPfad = path.join(dir, 'echt.db');
    const r = spawnSync(process.execPath, ['server/einrichten.js', '--name', 'Michael Pichler', '--pnr', '1', '--pin', '582916'], { cwd: APP, env: { ...process.env, BAUTAG_DB: dbPfad }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Geschäftsführung: Michael Pichler \(Personalnummer 1\)/);
    const app = require('../../server/index').createApp({ dbPath: dbPfad });
    assert.equal(app.bt.warnungen.length, 1); // nur ein Verwaltungs-Konto
    const server = await new Promise((res) => { const x = app.listen(0, '127.0.0.1', () => res(x)); });
    try {
      const basis = `http://127.0.0.1:${server.address().port}/api`;
      const l = await fetch(basis + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pnr: 1, pin: '582916' }) });
      assert.equal(l.status, 200);
      assert.equal((await l.json()).mussPinAendern, false);
    } finally {
      await new Promise((res) => server.close(res));
      app.schliessen();
    }
    const nochmal = spawnSync(process.execPath, ['server/einrichten.js', '--name', 'X Y Z', '--pnr', '2', '--pin', '582917'], { cwd: APP, env: { ...process.env, BAUTAG_DB: dbPfad }, encoding: 'utf8' });
    assert.equal(nochmal.status, 1);
    assert.match(nochmal.stderr, /bereits Benutzer/);
  });
});
