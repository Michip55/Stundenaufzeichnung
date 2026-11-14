'use strict';
/** 14.6 Korrekturen Nachprüfung – Stammdaten (N-009, N-013, N-037) */
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { starte, U, BS } = require('./hilfe');
const { wienDatum, plusTage } = require('../../server/datum');

/** Text aus einem unkomprimierten pdfkit-PDF (TJ-Operatoren mit Hex-Strings) */
function pdfText(buf) {
  const out = [];
  for (const m of buf.toString('latin1').matchAll(/\[([^\]]*)\]\s*TJ/g)) out.push([...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join(''));
  return out.join('\n');
}
const ver = (s, tab, id) => s.db.eins(`SELECT version FROM ${tab} WHERE id = ?`, id).version;

test('N-009: Name/Einheit bleiben in Berichten, Fern-Links und PDF beim Stand der Erfassung', async (t) => {
  const s = await starte({ pdfUnkomprimiert: true, test: true, url: 'https://bautag.example.at' });
  t.after(() => s.stop());
  const buero = await s.login(U.buero);
  // freigegebener Bericht mit Material
  const z = s.db.eins("SELECT bm.bericht_id, bm.material_id, bm.menge FROM bericht_material bm JOIN bericht b ON b.id = bm.bericht_id WHERE b.status = 'freigegeben' ORDER BY b.id LIMIT 1");
  assert.ok(z, 'Testdaten: freigegebener Bericht mit Material');
  const m = s.db.eins('SELECT * FROM material WHERE id = ?', z.material_id);
  const bVorher = (await buero.get(`/berichte/${z.bericht_id}`)).daten;
  const zeileVorher = bVorher.material.find((x) => x.materialId === m.id);
  assert.equal(zeileVorher.name, m.name);

  await t.test('Einheit eines verwendeten Materials ist fest (409), unverändert mitgeschickt geht', async () => {
    const r = await buero.put(`/stammdaten/materialien/${m.id}`, { version: ver(s, 'material', m.id), einheit: m.einheit === 'm³' ? 'to' : 'm³' });
    assert.equal(r.status, 409, JSON.stringify(r.daten));
    assert.match(r.daten.fehler, /Einheit .* kann nicht geändert werden/);
    assert.ok(r.daten.verwendet.berichte > 0);
    assert.equal(s.db.eins('SELECT einheit FROM material WHERE id = ?', m.id).einheit, m.einheit);
    const ok = await buero.put(`/stammdaten/materialien/${m.id}`, { version: ver(s, 'material', m.id), einheit: m.einheit, code: m.code, name: m.name });
    assert.equal(ok.status, 200, JSON.stringify(ok.daten));
  });

  await t.test('Einheit eines verwendeten Geräts ist fest (409)', async () => {
    const g = s.db.eins('SELECT g.* FROM geraet g WHERE EXISTS (SELECT 1 FROM bericht_geraet bg WHERE bg.geraet_id = g.id) LIMIT 1');
    const r = await buero.put(`/stammdaten/geraete/${g.id}`, { version: ver(s, 'geraet', g.id), einheit: 'Tag' });
    assert.equal(r.status, 409);
  });

  await t.test('Einheit eines unbenutzten Materials bleibt änderbar', async () => {
    const neu = (await buero.post('/stammdaten/materialien', { code: 'unbenutzt9', name: 'Unbenutzt', einheit: 'to' })).daten;
    const r = await buero.put(`/stammdaten/materialien/${neu.id}`, { version: neu.version, einheit: 'm³' });
    assert.equal(r.status, 200);
    assert.equal(r.daten.einheit, 'm³');
  });

  await t.test('Excel-Import: Einheit eines verwendeten Materials ändern → Fehlerzeile', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Material');
    ws.addRow(['code', 'name', 'einheit']);
    ws.addRow([m.code, m.name, m.einheit === 'm³' ? 'to' : 'm³']);
    const dateiBase64 = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    const r = await buero.post('/stammdaten/materialien/import', { dateiBase64, vorschau: true });
    assert.equal(r.status, 200);
    assert.equal(r.daten.fehler.length, 1, JSON.stringify(r.daten));
    assert.match(r.daten.fehler[0].text, /Einheit/);
  });

  await t.test('Namensänderung ändert freigegebene Berichte, AG-PDF und Fern-Links nicht', async () => {
    // offener Bericht (Entwurf) mit demselben Material und Fern-Link
    const polier = await s.login(U.polier);
    const datum = plusTage(wienDatum(s.uhr()), -6);
    s.db.lauf('DELETE FROM bericht WHERE baustelle_id = ? AND datum = ?', BS.pitten, datum);
    const offen = (await polier.post('/berichte', { baustelleId: BS.pitten, datum })).daten;
    assert.ok(offen && offen.id, 'Testdaten: offener Bericht Pitten');
    const roh = (await polier.get(`/berichte/${offen.id}`)).daten;
    const material = [...roh.material.filter((x) => x.materialId !== m.id).map((x) => ({ materialId: x.materialId, menge: x.menge })), { materialId: m.id, menge: 12 }];
    const p = await polier.put(`/berichte/${offen.id}`, { version: roh.version, material });
    assert.equal(p.status, 200, JSON.stringify(p.daten));
    const link = await buero.post(`/berichte/${offen.id}/unterschrift-link`, { rolle: 'bh' });
    assert.equal(link.status, 201, JSON.stringify(link.daten));
    const token = link.daten.url.split('/').pop();
    const fernVorher = (await s.client().get(`/fern/${token}`)).daten.bericht;
    const offenVersion = s.db.eins('SELECT version FROM bericht WHERE id = ?', offen.id).version;

    const r = await buero.put(`/stammdaten/materialien/${m.id}`, { version: ver(s, 'material', m.id), name: `${m.name} GEAENDERT9` });
    assert.equal(r.status, 200);
    assert.equal(r.daten.name, `${m.name} GEAENDERT9`);

    const bNachher = (await buero.get(`/berichte/${z.bericht_id}`)).daten;
    assert.equal(bNachher.version, bVorher.version);
    assert.deepEqual(bNachher.material, bVorher.material, 'freigegebener Bericht unverändert');
    const pdf = pdfText((await buero.get(`/berichte/${z.bericht_id}/pdf?fassung=ag`)).daten);
    assert.ok(pdf.includes(m.name.slice(0, 12)), 'AG-PDF enthält das Material');
    assert.ok(!pdf.includes('GEAENDERT9'), 'AG-PDF mit dem Namen beim Erfassen');

    const fern = await s.client().get(`/fern/${token}`);
    assert.equal(fern.status, 200);
    assert.deepEqual(fern.daten.bericht.material, fernVorher.material, 'Fern-Link zeigt den unterschriebenen Stand');
    assert.ok(fern.daten.bericht.material.some((x) => x.name === m.name && x.einheit === m.einheit));
    assert.equal(s.db.eins('SELECT version FROM bericht WHERE id = ?', offen.id).version, offenVersion);

    // neu erfasste Zeilen bekommen den neuen Namen
    const neuRoh = (await polier.get(`/berichte/${offen.id}`)).daten;
    await polier.put(`/berichte/${offen.id}`, { version: neuRoh.version, material: neuRoh.material.map((x) => ({ materialId: x.materialId, menge: x.menge })) });
    const neu = (await polier.get(`/berichte/${offen.id}`)).daten;
    assert.equal(neu.material.find((x) => x.materialId === m.id).name, `${m.name} GEAENDERT9`);
  });

  await t.test('Gerätename im freigegebenen Bericht bleibt', async () => {
    const zg = s.db.eins("SELECT bg.bericht_id, bg.geraet_id FROM bericht_geraet bg JOIN bericht b ON b.id = bg.bericht_id WHERE b.status = 'freigegeben' LIMIT 1");
    const g = s.db.eins('SELECT * FROM geraet WHERE id = ?', zg.geraet_id);
    const vorher = (await buero.get(`/berichte/${zg.bericht_id}`)).daten.geraete;
    assert.equal((await buero.put(`/stammdaten/geraete/${g.id}`, { version: ver(s, 'geraet', g.id), name: 'Umbenannt XY' })).status, 200);
    assert.deepEqual((await buero.get(`/berichte/${zg.bericht_id}`)).daten.geraete, vorher);
  });
});

test('N-013: reservierter Code „alle“ ist weder anlegbar noch als Umbenennung erlaubt', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  const g = s.db.eins("SELECT * FROM geraet WHERE code = 'dumper'") || s.db.eins('SELECT * FROM geraet LIMIT 1');
  const quellenVorher = s.db.alle('SELECT id, quelle FROM projektposition ORDER BY id');
  for (const art of ['materialien', 'geraete']) {
    const r = await gf.post(`/stammdaten/${art}`, { code: 'alle', name: 'Alle', einheit: 'to' });
    assert.equal(r.status, 422, `${art}: ${JSON.stringify(r.daten)}`);
    assert.match(r.daten.fehler, /reserviert/);
    assert.equal((await gf.post(`/stammdaten/${art}`, { code: 'ALLE', name: 'Alle', einheit: 'to' })).status, 422);
  }
  assert.equal((await gf.post('/stammdaten/lohngruppen', { name: 'Alle' })).status, 422, 'Lohngruppen-ID aus dem Namen');
  assert.equal((await gf.post('/stammdaten/lohngruppen', { id: 'alle', name: 'X' })).status, 422);
  const r = await gf.put(`/stammdaten/geraete/${g.id}`, { version: g.version, code: 'alle' });
  assert.equal(r.status, 422);
  assert.equal((await gf.put(`/stammdaten/geraete/${g.id}`, { version: g.version, code: 'alle', vorschau: true })).status, 422);
  assert.equal(s.db.eins('SELECT code FROM geraet WHERE id = ?', g.id).code, g.code);
  assert.deepEqual(s.db.alle('SELECT id, quelle FROM projektposition ORDER BY id'), quellenVorher, 'Positions-Quellen unverändert');
  // Excel-Import
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Gerät');
  ws.addRow(['code', 'name', 'einheit']);
  ws.addRow(['alle', 'Alle', 'Std.']);
  const imp = await gf.post('/stammdaten/geraete/import', { dateiBase64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'), vorschau: false });
  assert.equal(imp.status, 200);
  assert.equal(imp.daten.uebernommen, false);
  assert.match(imp.daten.fehler[0].text, /reserviert/);
  assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM geraet WHERE code = 'alle'").n, 0);
});

test('N-037: Leistungen mit LV-Positionsnummer (01.01) speichern, anlegen und per Excel rundlaufen', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const buero = await s.login(U.buero);
  const l = s.db.eins("SELECT * FROM leistung WHERE code LIKE '%.%' LIMIT 1");
  assert.ok(l, 'Demo-Leistung im LV-Format');
  // so sendet die Oberfläche: Code unverändert mit
  const r = await buero.put(`/stammdaten/leistungen/${l.id}`, { version: l.version, code: l.code, text: `${l.text} (neu)`, einheit: l.einheit, aktiv: true });
  assert.equal(r.status, 200, JSON.stringify(r.daten));
  const neu = await buero.post('/stammdaten/leistungen', { code: '04.05', text: 'Neue LV-Position', einheit: 'm²' });
  assert.equal(neu.status, 201, JSON.stringify(neu.daten));
  assert.equal(neu.daten.code, '04.05');
  // Punkt bleibt bei Geräten/Materialien unzulässig (Positions-Quellen)
  assert.equal((await buero.post('/stammdaten/materialien', { code: 'a.b', name: 'x', einheit: 'to' })).status, 400);
  const x = await buero.get('/stammdaten/leistungen/export.xlsx');
  assert.equal(x.status, 200);
  const imp = await buero.post('/stammdaten/leistungen/import', { dateiBase64: x.daten.toString('base64'), vorschau: true });
  assert.equal(imp.status, 200);
  assert.deepEqual(imp.daten.fehler, []);
  assert.ok(imp.daten.unveraendert >= 10, JSON.stringify(imp.daten));
});
