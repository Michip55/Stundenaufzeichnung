'use strict';
/** Projektdokumente (API.md 12.16) */
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const ExcelJS = require('exceljs');
const { starte, U, BS } = require('./hilfe');
const { testJpeg } = require('./fuhrpark-bilder');
const { pngGrau } = require('../../server/png');

/** kleines gültiges PDF (optional mit verbotenem Inhalt, optional komprimiert) */
function pdf({ zusatz = '', komprimiert = '' } = {}) {
  const teile = ['%PDF-1.4\n', '1 0 obj << /Type /Catalog /Pages 2 0 R ' + zusatz + '>> endobj\n', '2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\n'];
  if (komprimiert) {
    const daten = zlib.deflateSync(Buffer.from(komprimiert));
    return Buffer.concat([Buffer.from(teile.join('') + `3 0 obj << /Length ${daten.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), daten, Buffer.from('\nendstream\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1')]);
  }
  return Buffer.from(teile.join('') + 'trailer << /Root 1 0 R >>\n%%EOF\n', 'latin1');
}

test('Projektdokumente', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const c = {};
  for (const r of ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf']) c[r] = await s.login(U[r]);
  const url = `/baustellen/${BS.pitten}/dokumente`;
  const b64 = (b) => b.toString('base64');
  let plan, angebot;

  await t.test('Kategorien; GF kann eigene anlegen', async () => {
    const k = (await c.polier.get('/dokument-kategorien')).daten;
    assert.equal(k.length, 14);
    assert.deepEqual(k.find((x) => x.schluessel === 'angebot'), { schluessel: 'angebot', name: 'Angebot', finanziell: true, polier: false, eigen: false });
    assert.equal((await c.buero.post('/dokument-kategorien', { name: 'Statik' })).status, 403);
    const r = await c.gf.post('/dokument-kategorien', { name: 'Statik', polier: true });
    assert.equal(r.status, 201);
    assert.equal(r.daten.schluessel, 'statik');
  });

  await t.test('Hochladen: Prüfung der Datei', async () => {
    assert.equal((await c.buero.post(url, { kategorie: 'plaene', titel: 'X', dateiBase64: b64(Buffer.from('<html><script>')), dateiname: 'x.pdf' })).status, 400);
    assert.equal((await c.buero.post(url, { kategorie: 'plaene', titel: 'X', dateiBase64: b64(pdf({ zusatz: '/OpenAction << /S /JavaScript /JS (app.alert(1)) >> ' })), dateiname: 'x.pdf' })).status, 400);
    assert.equal((await c.buero.post(url, { kategorie: 'plaene', titel: 'X', dateiBase64: b64(pdf({ komprimiert: '<< /S /Launch /F (cmd.exe) >>' })), dateiname: 'x.pdf' })).status, 400);
    assert.equal((await c.buero.post(url, { kategorie: 'plaene', titel: 'X', dateiBase64: b64(pdf({ zusatz: '/Encrypt 9 0 R ' })), dateiname: 'x.pdf' })).status, 400);
    assert.equal((await c.buero.post(url, { kategorie: 'gibtsnicht', titel: 'X', dateiBase64: b64(pdf()) })).status, 400);
    let r = await c.buero.post(url, { kategorie: 'plaene', titel: 'Lageplan', datum: '2026-10-01', tags: ['Kanal', 'Kanal', 'Lage'], dateiBase64: b64(pdf()), dateiname: 'Lageplan.pdf' });
    assert.equal(r.status, 201);
    plan = r.daten;
    assert.deepEqual([plan.mime, plan.version, plan.tags, plan.dateiname], ['application/pdf', 1, ['Kanal', 'Lage'], 'Lageplan.pdf']);
    // XLSX ok, Makro nein
    const wb = new ExcelJS.Workbook(); wb.addWorksheet('LV').addRow(['OZ', 'Text']);
    r = await c.buero.post(url, { kategorie: 'lv', titel: 'LV Außenanlagen', dateiBase64: b64(Buffer.from(await wb.xlsx.writeBuffer())), dateiname: 'lv.xlsx' });
    assert.equal(r.status, 201);
    assert.equal(r.daten.mime, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    // Bild (Metadaten werden entfernt)
    r = await c.buero.post(url, { kategorie: 'fotos', titel: 'Bestand', dateiBase64: b64(testJpeg()), dateiname: 'f.jpg' });
    assert.equal(r.status, 201);
    r = await c.buero.post(url, { kategorie: 'angebot', titel: 'Angebot 2026-117', dateiBase64: b64(pdf()), dateiname: 'angebot.pdf' });
    angebot = r.daten;
  });

  await t.test('Sichtbarkeit je Rolle und Kategorie', async () => {
    assert.equal((await c.mitarbeiter.get(url)).status, 403);
    const pol = (await c.polier.get(url)).daten;
    assert.ok(pol.some((d) => d.id === plan.id));
    assert.ok(!pol.some((d) => ['angebot', 'lv'].includes(d.kategorie)));
    assert.equal((await c.polier.get(`${url}/${angebot.id}`)).status, 403);
    assert.equal((await c.polier.anfrage('GET', `${url}/${angebot.id}/datei`)).status, 403);
    assert.equal((await c.polier.post(url, { kategorie: 'plaene', titel: 'X', dateiBase64: b64(pdf()) })).status, 403);
    // Polier fremder Baustelle
    assert.equal((await c.polier.get(`/baustellen/${BS.reisinger}/dokumente`)).status, 403);
    // Bauleiter eigene Baustelle: alles sichtbar (preise_sehen), Angebot nur lesen
    const bl = (await c.bauleiter.get(url)).daten;
    assert.ok(bl.some((d) => d.kategorie === 'angebot'));
    assert.equal((await c.bauleiter.post(url, { kategorie: 'angebot', titel: 'X', dateiBase64: b64(pdf()) })).status, 403);
    assert.equal((await c.bauleiter.post(url, { kategorie: 'schriftverkehr', titel: 'Brief', dateiBase64: b64(pdf()) })).status, 201);
    assert.equal((await c.bauleiter.get(`/baustellen/${BS.reisinger}/dokumente`)).status, 403);
    // ohne preise_sehen keine finanziellen Kategorien
    s.db.lauf("UPDATE rolle_recht SET wert = 0 WHERE rolle = 'bauleiter' AND recht = 'preise_sehen'");
    try { assert.ok(!(await c.bauleiter.get(url)).daten.some((d) => d.kategorie === 'angebot')); } finally { s.db.lauf("UPDATE rolle_recht SET wert = 1 WHERE rolle = 'bauleiter' AND recht = 'preise_sehen'"); }
  });

  await t.test('Datei abrufen: Header', async () => {
    const r = await c.polier.anfrage('GET', `${url}/${plan.id}/datei`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.match(r.headers.get('content-disposition'), /^inline; filename="Lageplan\.pdf"/);
    assert.match(r.headers.get('content-security-policy'), /sandbox/);
  });

  await t.test('Versionen, Suche, Ändern, weich löschen/wiederherstellen', async () => {
    let r = await c.buero.post(`${url}/${plan.id}/versionen`, { dateiBase64: b64(pdf({ zusatz: '/Lang (de) ' })), dateiname: 'Lageplan_v2.pdf', notiz: 'Index B' });
    assert.equal(r.status, 201);
    assert.equal(r.daten.version, 2);
    assert.deepEqual(r.daten.versionen.map((x) => [x.nr, x.dateiname]), [[1, 'Lageplan.pdf'], [2, 'Lageplan_v2.pdf']]);
    assert.equal((await c.polier.anfrage('GET', `${url}/${plan.id}/datei?version=1`)).status, 200);
    assert.equal((await c.buero.get(`/dokumente/suche?q=lageplan`)).daten.length, 1);
    assert.equal((await c.buero.get(`${url}?tag=kanal`)).daten.length, 1);
    r = await c.buero.put(`${url}/${plan.id}`, { titel: 'Lageplan Kanal', tags: ['Kanal'] });
    assert.equal(r.daten.titel, 'Lageplan Kanal');
    assert.equal((await c.polier.del(`${url}/${plan.id}`)).status, 403);
    assert.equal((await c.buero.del(`${url}/${plan.id}`, { grund: 'falscher Plan' })).status, 200);
    assert.ok(!(await c.polier.get(url)).daten.some((d) => d.id === plan.id));
    assert.ok((await c.buero.get(`${url}?geloescht=1`)).daten.some((d) => d.id === plan.id && d.geloescht));
    assert.equal((await c.bauleiter.post(`${url}/${plan.id}/wiederherstellen`, {})).status, 403);
    assert.equal((await c.buero.post(`${url}/${plan.id}/wiederherstellen`, {})).status, 200);
    assert.ok(s.db.eins("SELECT COUNT(*) AS n FROM protokoll WHERE art = 'dokument'").n >= 5);
  });
});
