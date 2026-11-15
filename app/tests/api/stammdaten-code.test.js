'use strict';
/** 12.21 (geändert 13.11.2026): Codes umbenennen, auch wenn sie verwendet werden */
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { starte, U, BS } = require('./hilfe');

test('Code eines verwendeten Materials/Geräts umbenennen', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const c = {};
  for (const r of ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf']) c[r] = await s.login(U[r]);
  const ver = (tab, id) => s.db.eins(`SELECT version FROM ${tab} WHERE id = ?`, id).version;
  const mengen = async (bs) => Object.fromEntries((await c.buero.get(`/baustellen/${bs}/positionen`)).daten.gruppen.flatMap((g) => g.positionen).map((p) => [p.id, [p.mengeAuto, p.menge]]));
  // ein in Berichten verwendetes Material mit Positions-Quelle
  const m = s.db.eins("SELECT m.* FROM material m WHERE EXISTS (SELECT 1 FROM bericht_material bm WHERE bm.material_id = m.id) AND EXISTS (SELECT 1 FROM projektposition p WHERE p.quelle LIKE '%\"art\":\"material\"%' AND p.quelle LIKE '%\"' || m.code || '\"%') LIMIT 1");
  assert.ok(m, 'Testdaten: verwendetes Material mit Quelle');
  const mitQuelle = () => s.db.alle("SELECT id, quelle FROM projektposition UNION ALL SELECT -id, quelle FROM katalog").filter((x) => { try { const q = JSON.parse(x.quelle); return q && q.art === 'material' && (Array.isArray(q.ref) ? q.ref : [q.ref]).includes(m.code); } catch (_) { return false; } });
  const anzahl = mitQuelle().length;
  assert.ok(anzahl > 0);
  const vorher = { pitten: await mengen(BS.pitten), reisinger: await mengen(BS.reisinger) };
  const neuCode = `${m.code}_neu`;

  await t.test('Rechte', async () => {
    for (const r of ['mitarbeiter', 'polier']) assert.equal((await c[r].put(`/stammdaten/materialien/${m.id}`, { version: ver('material', m.id), code: neuCode })).status, 403, r);
    // Bauleiter wie Büro (13.11.2026): darf (hier nur Vorschau, speichert nichts)
    assert.equal((await c.bauleiter.put(`/stammdaten/materialien/${m.id}`, { version: ver('material', m.id), code: neuCode, vorschau: true })).status, 200);
  });

  await t.test('Vorschau zählt nur, speichert nichts', async () => {
    const r = await c.buero.put(`/stammdaten/materialien/${m.id}`, { version: ver('material', m.id), code: neuCode, vorschau: true });
    assert.equal(r.status, 200);
    assert.deepEqual(r.daten.umbenannt, { alt: m.code, neu: neuCode, referenzen: anzahl });
    assert.equal(r.daten.vorschau, true);
    assert.ok(r.daten.verwendet.berichte > 0);
    assert.equal(s.db.eins('SELECT code FROM material WHERE id = ?', m.id).code, m.code);
    assert.equal(mitQuelle().length, anzahl);
  });

  await t.test('Doppelter Code → 409', async () => {
    const anderer = s.db.eins('SELECT code FROM material WHERE id <> ? LIMIT 1', m.id).code;
    assert.equal((await c.buero.put(`/stammdaten/materialien/${m.id}`, { version: ver('material', m.id), code: anderer })).status, 409);
    assert.equal((await c.buero.put(`/stammdaten/materialien/${m.id}`, { version: ver('material', m.id), code: anderer, vorschau: true })).status, 409);
  });

  await t.test('Umbenennen: Positions-Quellen ziehen mit, automatische Mengen unverändert, Protokoll', async () => {
    const r = await c.buero.put(`/stammdaten/materialien/${m.id}`, { version: ver('material', m.id), code: neuCode });
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    assert.equal(r.daten.code, neuCode);
    assert.deepEqual(r.daten.umbenannt, { alt: m.code, neu: neuCode, referenzen: anzahl });
    assert.equal(mitQuelle().length, 0, 'kein Verweis mehr auf den alten Code');
    const neu = s.db.alle('SELECT quelle FROM projektposition UNION ALL SELECT quelle FROM katalog').filter((x) => x.quelle && x.quelle.includes(`"${neuCode}"`));
    assert.equal(neu.length, anzahl);
    assert.deepEqual({ pitten: await mengen(BS.pitten), reisinger: await mengen(BS.reisinger) }, vorher, 'Mengen der Nachkalkulation gleich');
    const p = s.db.eins('SELECT * FROM protokoll WHERE objekt = ? ORDER BY id DESC LIMIT 1', `materialien:${m.id}`);
    assert.match(p.text, new RegExp(`Code ${m.code} → ${neuCode} \\(${anzahl} Verweise angepasst\\)`));
    assert.deepEqual(JSON.parse(p.neu).umbenannt, { alt: m.code, neu: neuCode, referenzen: anzahl });
  });

  await t.test('Listen-Refs (Kleingeräte) und Lohngruppen-ID bleibt fest', async () => {
    const g = s.db.eins("SELECT * FROM geraet WHERE code = 'ruettel'");
    if (g) {
      const r = await c.buero.put(`/stammdaten/geraete/${g.id}`, { version: ver('geraet', g.id), code: 'ruettelplatte' });
      assert.equal(r.status, 200);
      const kl = s.db.alle("SELECT quelle FROM projektposition WHERE bezeichnung = 'Kleingeräte'").map((x) => JSON.parse(x.quelle).ref);
      assert.ok(kl.length && kl.every((ref) => ref.includes('ruettelplatte') && !ref.includes('ruettel')));
    }
    const lg = s.db.eins("SELECT * FROM lohngruppe WHERE id = 'fa'");
    assert.equal((await c.gf.put('/stammdaten/lohngruppen/fa', { version: lg.version, id: 'fach' })).status, 422);
    const n = await c.gf.put('/stammdaten/lohngruppen/fa', { version: lg.version, name: 'Facharbeiter/in' });
    assert.equal(n.status, 200);
    assert.equal(n.daten.name, 'Facharbeiter/in');
  });

  await t.test('Excel-Import: Zuordnung über den Code – ein neuer Code benennt nicht um', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('m');
    ws.addRow(['code', 'name', 'einheit']);
    ws.addRow([`${neuCode}2`, s.db.eins('SELECT name FROM material WHERE id = ?', m.id).name, 't']);
    const b64 = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    const r = await c.buero.post('/stammdaten/materialien/import', { dateiBase64: b64, vorschau: true });
    assert.equal(r.status, 200);
    assert.deepEqual(r.daten.neu.map((x) => x.code), [`${neuCode}2`]); // wird neu angelegt
    assert.ok(r.daten.fehlend.includes(neuCode)); // der bisherige bleibt und wird als fehlend gemeldet
    assert.equal(s.db.eins('SELECT code FROM material WHERE id = ?', m.id).code, neuCode);
  });
});
