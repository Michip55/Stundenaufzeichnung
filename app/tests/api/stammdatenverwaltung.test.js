'use strict';
/** Stammdaten verwalten (API.md 12.21) */
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { starte, U, BS, euroFelder } = require('./hilfe');
const { wienDatum, plusTage } = require('../../server/datum');

test('Stammdaten verwalten', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const c = {};
  for (const r of ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf']) c[r] = await s.login(U[r]);
  const heute = wienDatum(s.uhr());
  const ver = (tab, id) => s.db.eins(`SELECT version FROM ${tab} WHERE id = ?`, id).version;

  await t.test('Rechte je Rolle', async () => {
    for (const art of ['geraete', 'materialien', 'leistungen', 'lohngruppen']) {
      for (const r of ['mitarbeiter', 'polier']) {
        assert.equal((await c[r].get(`/stammdaten/${art}`)).status, 403, `${r} ${art}`);
        assert.equal((await c[r].post(`/stammdaten/${art}`, { code: 'x1', name: 'X' })).status, 403);
      }
      assert.equal((await c.bauleiter.get(`/stammdaten/${art}`)).status, 200, art);
      assert.equal((await c.bauleiter.post(`/stammdaten/${art}`, {})).status, 400, art); // Bauleiter wie Büro: darf, nur ungültig
    }
    assert.equal((await c.buero.get('/stammdaten/lohngruppen')).status, 200);
  });

  let gid;
  await t.test('Anlegen, Prüfung, Code eindeutig, Preis über gültig-ab', async () => {
    let r = await c.buero.post('/stammdaten/geraete', { code: 'Rüttel!', name: 'X' });
    assert.equal(r.status, 400);
    r = await c.buero.post('/stammdaten/geraete', { code: 'ruettel2', name: 'Rüttelplatte 2', gruppe: 'Verdichtung', kostensatz: 12.345 });
    assert.equal(r.status, 201);
    gid = r.daten.id;
    assert.deepEqual([r.daten.einheit, r.daten.aktiv, r.daten.kostensatz], ['Std.', true, 12.35]);
    assert.equal((await c.buero.post('/stammdaten/geraete', { code: 'ruettel2', name: 'Doppelt' })).status, 409);
    assert.equal((await c.buero.post('/stammdaten/materialien', { code: 'sand9', name: 'Sand', einheit: '' })).status, 400);
    assert.equal((await c.buero.post('/stammdaten/materialien', { code: 'sand9', name: 'x'.repeat(121), einheit: 't' })).status, 400);
    r = await c.buero.post('/stammdaten/materialien', { code: 'sand9', name: 'Sand 0/9', einheit: 't', dichte: 1.6, naturmaterial: true, ek: 9.5 });
    assert.equal(r.status, 201);
    assert.deepEqual([r.daten.dichte, r.daten.naturmaterial], [1.6, true]);
    // Preisänderung → Stand mit gueltigAb
    r = await c.buero.put(`/stammdaten/geraete/${gid}`, { version: ver('geraet', gid), kostensatz: 15, gueltigAb: plusTage(heute, 3) });
    assert.equal(r.status, 200);
    assert.equal(r.daten.kostensatz, 12.35);
    const vl = (await c.buero.get(`/preise/geraete/${gid}/verlauf`)).daten.filter((x) => x.feld === 'kostensatz');
    assert.deepEqual(vl.map((x) => [x.gueltigAb, x.wert]), [['2000-01-01', 12.35], [plusTage(heute, 3), 15]]);
    assert.equal((await c.buero.put(`/stammdaten/geraete/${gid}`, { version: 1, name: 'alt' })).status, 409);
    // Lohngruppe: ID aus dem Namen
    r = await c.buero.post('/stammdaten/lohngruppen', { name: 'Kraftfahrer', kv: 'KV Bau', kostensatz: 44 });
    assert.equal(r.status, 201);
    assert.equal(r.daten.id, 'kraftfahrer');
    assert.ok(s.db.eins("SELECT 1 AS x FROM protokoll WHERE objekt = 'lohngruppen:kraftfahrer'"));
  });

  await t.test('Löschen: unbenutzt ok; benutzt → 409 mit verwendet, deaktivieren; verwendeter Code umbenennbar', async () => {
    const tmp = (await c.buero.post('/stammdaten/leistungen', { code: 'tmp1', text: 'Test', einheit: 'm²' })).daten;
    assert.equal((await c.buero.del(`/stammdaten/leistungen/${tmp.id}`)).status, 200);
    const g = s.db.eins('SELECT g.* FROM geraet g WHERE EXISTS (SELECT 1 FROM bericht_geraet bg WHERE bg.geraet_id = g.id) LIMIT 1');
    let r = await c.buero.del(`/stammdaten/geraete/${g.id}`);
    assert.equal(r.status, 409);
    assert.ok(r.daten.verwendet.berichte > 0);
    // seit 13.11.2026: verwendeter Code ist änderbar (Verweise per Code werden mitgezogen, 12.21)
    r = await c.buero.put(`/stammdaten/geraete/${g.id}`, { version: ver('geraet', g.id), code: `${g.code}x` });
    assert.equal(r.status, 200);
    assert.deepEqual([r.daten.code, r.daten.umbenannt.alt, r.daten.umbenannt.neu], [`${g.code}x`, g.code, `${g.code}x`]);
    r = await c.buero.put(`/stammdaten/geraete/${g.id}`, { version: ver('geraet', g.id), aktiv: false });
    assert.equal(r.status, 200);
    // nicht mehr in der Auswahl, aber in alten Berichten
    assert.ok(!(await c.polier.get('/geraete')).daten.some((x) => x.id === g.id));
    assert.ok((await c.buero.get('/geraete?inaktiv=1')).daten.some((x) => x.id === g.id && x.aktiv === false));
    const bid = s.db.eins('SELECT bericht_id FROM bericht_geraet WHERE geraet_id = ? LIMIT 1', g.id).bericht_id;
    assert.ok((await c.buero.get(`/berichte/${bid}`)).daten.geraete.some((x) => x.geraetId === g.id));
    const lg = s.db.eins('SELECT lohngruppe_id FROM benutzer WHERE lohngruppe_id IS NOT NULL LIMIT 1').lohngruppe_id;
    r = await c.buero.del(`/stammdaten/lohngruppen/${lg}`);
    assert.equal(r.status, 409);
    assert.ok(r.daten.verwendet.personen > 0);
  });

  await t.test('€-Schutz: Bauleiter ohne preise_sehen und Felder ohne preise_bearbeiten', async () => {
    s.db.lauf("UPDATE rolle_recht SET wert = 1 WHERE rolle = 'bauleiter' AND recht = 'stammdaten'");
    // stammdaten ist für Bauleiter gesperrt → Matrix-Trick nur im Test: Rechte werden je Anfrage geladen
    const r = await c.buero.put(`/stammdaten/geraete/${gid}`, { version: ver('geraet', gid), name: 'Rüttelplatte 2 neu' });
    assert.equal(r.status, 200);
    s.db.lauf("UPDATE rolle_recht SET wert = 0 WHERE rolle = 'bauleiter' AND recht = 'stammdaten'");
    for (const r2 of ['mitarbeiter', 'polier']) {
      for (const p of ['/geraete', '/materialien', '/leistungen']) assert.deepEqual(euroFelder((await c[r2].get(p)).daten), [], `${r2} ${p}`);
    }
  });

  await t.test('Excel: Export, Import-Vorschau mit Fehlern übernimmt nichts, sonst neu/geändert, nie löschen', async () => {
    const x = await c.buero.get('/stammdaten/materialien/export.xlsx');
    assert.equal(x.status, 200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.daten);
    const ws = wb.worksheets[0];
    const kopf = ws.getRow(1).values.slice(1);
    assert.deepEqual(kopf.slice(0, 3), ['code', 'name', 'einheit']);
    assert.ok(kopf.includes('ek'));
    // Polier: kein Export
    assert.equal((await c.polier.get('/stammdaten/materialien/export.xlsx')).status, 403);
    const ixEk = kopf.indexOf('ek') + 1;
    const ixName = kopf.indexOf('name') + 1;
    // Zeile ändern, neue Zeile, fehlerhafte Zeile
    ws.getRow(2).getCell(ixName).value = 'Umbenannt';
    const n = ws.rowCount;
    const neu = ws.getRow(n + 1); neu.getCell(1).value = 'neu1'; neu.getCell(ixName).value = 'Neues Material'; neu.getCell(3).value = 'm³'; neu.getCell(ixEk).value = 5;
    const kaputt = ws.getRow(n + 2); kaputt.getCell(1).value = 'kaputt1'; kaputt.getCell(ixName).value = 'X'; kaputt.getCell(3).value = 't'; kaputt.getCell(ixEk).value = -4;
    const b64 = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    let r = await c.buero.post('/stammdaten/materialien/import', { dateiBase64: b64, vorschau: false });
    assert.equal(r.status, 200);
    assert.equal(r.daten.uebernommen, false);
    assert.equal(r.daten.fehler.length, 1);
    assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM material WHERE code = 'neu1'").n, 0);
    ws.spliceRows(n + 2, 1);
    ws.spliceRows(3, 1); // eine Zeile fehlt → nur gemeldet
    const b64b = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    r = await c.buero.post('/stammdaten/materialien/import', { dateiBase64: b64b, vorschau: false });
    assert.equal(r.daten.uebernommen, true, JSON.stringify(r.daten.fehler));
    assert.deepEqual(r.daten.neu.map((x) => x.code), ['neu1']);
    assert.equal(r.daten.geaendert.length, 1);
    assert.equal(r.daten.fehlend.length, 1);
    assert.ok(s.db.eins('SELECT 1 AS x FROM material WHERE code = ?', r.daten.fehlend[0])); // nicht gelöscht
    assert.equal(s.db.eins("SELECT ek FROM material WHERE code = 'neu1'").ek, 5);
  });
});
