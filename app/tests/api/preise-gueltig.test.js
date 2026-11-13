'use strict';
/** Preise mit „gültig ab“ (API.md 12.2, löst M-08) */
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { starte, U, BS } = require('./hilfe');
const { wienDatum, plusTage } = require('../../server/datum');

const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const alle = (d) => d.gruppen.flatMap((g) => g.positionen);

test('Preise mit „gültig ab“', async (t) => {
  const s = await starte({ euroSicherheitsnetz: true, sitzung: { feldMin: 60 * 24 * 40, bueroMin: 60 * 24 * 40, maxH: 24 * 60 } });
  t.after(() => s.stop());
  const c = {};
  for (const r of ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf']) c[r] = await s.login(U[r]);
  const heute = wienDatum(s.uhr());

  await t.test('Rechte: Verlauf nur mit preise_sehen, Änderung nur mit preise_bearbeiten', async () => {
    for (const r of ['mitarbeiter', 'polier']) {
      assert.equal((await c[r].get('/preise/lohngruppen/fa/verlauf')).status, 403);
      assert.equal((await c[r].get('/positionen/katalog/1/verlauf')).status, 403);
    }
    assert.equal((await c.bauleiter.get('/preise/lohngruppen/fa/verlauf')).status, 200);
    assert.equal((await c.bauleiter.put('/preise/lohngruppen/fa', { feld: 'kostensatz', wert: 1 })).status, 403);
    assert.equal((await c.bauleiter.del('/preise/lohngruppen/fa/verlauf/1')).status, 403);
    const v = (await c.buero.get('/preise/lohngruppen/fa/verlauf')).daten;
    assert.deepEqual(v.map((x) => [x.feld, x.gueltigAb]), [['kostensatz', '2000-01-01'], ['regiesatz', '2000-01-01']]);
  });

  await t.test('Rückwirkend nur mit Bestätigung; Grenzen', async () => {
    const gestern = plusTage(heute, -1);
    let r = await c.buero.put('/preise/geraete/1', { feld: 'kostensatz', wert: 99, gueltigAb: gestern });
    assert.equal(r.status, 400);
    assert.match(r.daten.fehler, /rückwirkend/);
    assert.equal((await c.buero.put('/preise/geraete/1', { feld: 'kostensatz', wert: 99, gueltigAb: '1999-12-31', rueckwirkend: true })).status, 400);
    assert.equal((await c.buero.put('/preise/geraete/1', { feld: 'kostensatz', wert: 99, gueltigAb: plusTage(heute, 800) })).status, 400);
    assert.equal((await c.buero.put('/preise/geraete/1', { feld: 'kostensatz', wert: 99, gueltigAb: '2026-13-01' })).status, 400);
  });

  await t.test('Preisänderung ab heute verändert vergangene Tage nicht (kostenTag, interne Kosten)', async () => {
    const alt = s.db.eins("SELECT id, datum FROM bericht WHERE baustelle_id = ? AND status <> 'entwurf' AND datum < ? ORDER BY datum DESC LIMIT 1", BS.pitten, heute);
    const vorherTag = (await c.buero.get(`/berichte/${alt.id}`)).daten.kostenTag;
    const vorher = (await c.buero.get(`/kalkulation/${BS.pitten}`)).daten;
    const satz = s.db.eins("SELECT kostensatz FROM lohngruppe WHERE id = 'fa'").kostensatz;
    const r = await c.buero.put('/preise/lohngruppen/fa', { feld: 'kostensatz', wert: satz + 10 });
    assert.equal(r.status, 200);
    assert.equal(r.daten.kostensatz, satz + 10);
    assert.equal(r.daten.gueltigAb.kostensatz, heute);
    assert.deepEqual((await c.buero.get(`/berichte/${alt.id}`)).daten.kostenTag, vorherTag);
    const nachher = (await c.buero.get(`/kalkulation/${BS.pitten}`)).daten;
    // nur Stunden ab heute mit dem neuen Satz
    const stundenAbHeute = s.db.eins(`SELECT COALESCE(SUM(bp.stunden), 0) AS h FROM bericht_personal bp JOIN bericht r ON r.id = bp.bericht_id JOIN benutzer b ON b.id = bp.benutzer_id
      WHERE r.baustelle_id = ? AND r.status <> 'entwurf' AND r.datum >= ? AND b.lohngruppe_id = 'fa'`, BS.pitten, heute).h;
    assert.equal(r2(nachher.kosten.lohn - vorher.kosten.lohn), r2(stundenAbHeute * 10));
    const p = (await c.gf.get('/rechte')).daten.protokoll.find((x) => x.art === 'preis' && /fa:|lohngruppen:fa/.test(x.objekt || ''));
    assert.ok(p, 'Protokoll');
    // rückwirkend bestätigt → vergangener Bericht mit neuem Satz
    const r3 = await c.buero.put('/preise/lohngruppen/fa', { feld: 'kostensatz', wert: satz + 20, gueltigAb: alt.datum, rueckwirkend: true });
    assert.equal(r3.status, 200);
    const tag3 = (await c.buero.get(`/berichte/${alt.id}`)).daten.kostenTag;
    const faStd = s.db.eins("SELECT COALESCE(SUM(bp.stunden),0) AS h FROM bericht_personal bp JOIN benutzer b ON b.id = bp.benutzer_id WHERE bp.bericht_id = ? AND b.lohngruppe_id = 'fa'", alt.id).h;
    assert.equal(r2(tag3.lohn - vorherTag.lohn), r2(faStd * 20));
    const v = (await c.buero.get('/preise/lohngruppen/fa/verlauf')).daten.filter((x) => x.feld === 'kostensatz');
    assert.deepEqual(v.map((x) => [x.gueltigAb, x.wert]), [['2000-01-01', satz], [alt.datum, satz + 20], [heute, satz + 10]]);
    assert.equal(v[2].erstelltVon.id, U.buero);
  });

  await t.test('Preis in der Zukunft: geplant, gilt ab dem Datum; nur künftige Stände löschbar', async () => {
    const ab = plusTage(heute, 5);
    const satz = s.db.eins('SELECT kostensatz FROM geraet WHERE id = 2').kostensatz;
    let r = await c.buero.put('/preise/geraete/2', { feld: 'kostensatz', wert: satz + 7, gueltigAb: ab });
    assert.equal(r.daten.kostensatz, satz); // heute unverändert
    assert.deepEqual(r.daten.geplant.map((x) => [x.feld, x.wert, x.gueltigAb]), [['kostensatz', satz + 7, ab]]);
    const p = (await c.buero.get('/preise')).daten.geraete.find((g) => g.id === 2);
    assert.equal(p.geplant.length, 1);
    // ein zweiter künftiger Stand → löschbar; vergangener → 409
    r = await c.buero.put('/preise/geraete/2', { feld: 'kostensatz', wert: satz + 9, gueltigAb: plusTage(heute, 30) });
    const loesch = r.daten.geplant.find((x) => x.wert === satz + 9);
    assert.equal((await c.buero.del(`/preise/geraete/2/verlauf/${loesch.id}`)).status, 200);
    const basis = (await c.buero.get('/preise/geraete/2/verlauf')).daten.find((x) => x.feld === 'kostensatz' && x.gueltigAb === '2000-01-01');
    assert.equal((await c.buero.del(`/preise/geraete/2/verlauf/${basis.id}`)).status, 409);
    // Zeit vergeht: ab dem Datum gilt der neue Satz
    s.uhr.setze(new Date(Date.parse(`${ab}T08:00:00Z`)).toISOString());
    s.app.bt.stuendlich();
    const g2 = (await c.buero.get('/preise')).daten.geraete.find((g) => g.id === 2);
    assert.equal(g2.kostensatz, satz + 7);
    assert.equal(g2.gueltigAb.kostensatz, ab);
    assert.deepEqual(g2.geplant, []);
    assert.equal(s.db.eins('SELECT kostensatz FROM geraet WHERE id = 2').kostensatz, satz + 7);
    s.uhr.setze(new Date(Date.parse(`${heute}T09:24:00Z`)).toISOString());
    s.app.bt.stuendlich();
    assert.equal(s.db.eins('SELECT kostensatz FROM geraet WHERE id = 2').kostensatz, satz);
  });

  await t.test('Projektposition: EP-Änderung teilt in Perioden; App = Excel (je Periode eine Zeile)', async () => {
    let r = await c.buero.post(`/baustellen/${BS.kogler}/positionen`, { gruppe: 'fremdmaterial', bezeichnung: 'Periodentest', einheit: 't', ep: 10 });
    const pid = r.daten.id;
    const gestern = plusTage(heute, -1), vorgestern = plusTage(heute, -2);
    await c.buero.post(`/baustellen/${BS.kogler}/positionen/${pid}/mengen`, { datum: vorgestern, menge: 3.333 });
    await c.buero.post(`/baustellen/${BS.kogler}/positionen/${pid}/mengen`, { datum: heute, menge: 2.5 });
    const ver = () => s.db.eins('SELECT version FROM projektposition WHERE id = ?', pid).version;
    r = await c.buero.put(`/baustellen/${BS.kogler}/positionen/${pid}`, { version: ver(), ep: 12.345, gueltigAb: gestern });
    assert.equal(r.status, 400); // rückwirkend ohne Bestätigung
    r = await c.buero.put(`/baustellen/${BS.kogler}/positionen/${pid}`, { version: ver(), ep: 12.35, gueltigAb: gestern, rueckwirkend: true });
    assert.equal(r.status, 200);
    let d = (await c.buero.get(`/baustellen/${BS.kogler}/positionen`)).daten;
    const p = alle(d).find((x) => x.id === pid);
    assert.equal(p.ep, 12.35);
    assert.equal(p.epAb, gestern);
    assert.deepEqual(p.perioden, [
      { gueltigAb: '2000-01-01', bis: plusTage(gestern, -1), ep: 10, menge: 3.333, summe: 33.33 },
      { gueltigAb: gestern, bis: null, ep: 12.35, menge: 2.5, summe: 30.88 }
    ]);
    assert.equal(p.summe, r2(33.33 + 30.88));
    assert.equal(p.menge, 5.833);
    // Excel: zwei Zeilen, Gesamtsumme wie in der App
    const x = await c.buero.get(`/baustellen/${BS.kogler}/positionen/export.xlsx`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.daten);
    const zeilen = [];
    let gesamt;
    wb.worksheets[0].eachRow((row) => {
      const a = row.getCell(1).value;
      if (typeof a === 'string' && a.startsWith('Periodentest')) zeilen.push([a, row.getCell(13).value.result, row.getCell(14).value, row.getCell(15).value.result, row.getCell(15).value.formula]);
      if (row.getCell(10).value === 'Gesamtsumme') gesamt = row.getCell(15).value.result;
    });
    const de = (t2) => t2.split('-').reverse().join('.');
    assert.deepEqual(zeilen.map((z) => z.slice(0, 4)), [[`Periodentest (bis ${de(plusTage(gestern, -1))})`, 3.333, 10, 33.33], [`Periodentest (ab ${de(gestern)})`, 2.5, 12.35, 30.88]]);
    assert.ok(zeilen.every((z) => /^ROUND\(M\d+\*N\d+,2\)$/.test(z[4])));
    assert.equal(gesamt, d.gesamtsumme);
    // Polier/Mitarbeiter: keine Nachkalkulation; Bauleiter (eigene Baustelle) sieht Perioden
    assert.equal((await c.polier.get(`/baustellen/${BS.kogler}/positionen`)).status, 403);
    assert.equal((await c.buero.get(`/baustellen/${BS.kogler}/positionen/${pid}/verlauf`)).daten.length, 2);
    // Ohne preise_sehen: keine Perioden/EP
    s.db.lauf("UPDATE rolle_recht SET wert = 0 WHERE rolle = 'bauleiter' AND recht = 'preise_sehen'");
    try {
      const bsBl = s.db.eins('SELECT id FROM baustelle WHERE bauleiter_id = ? LIMIT 1', U.bauleiter).id;
      const b = (await c.bauleiter.get(`/baustellen/${bsBl}/positionen`)).daten;
      const txt = JSON.stringify(b);
      for (const f of ['"perioden"', '"epGeplant"', '"ep"', '"summe"']) assert.ok(!txt.includes(f), f);
    } finally {
      s.db.lauf("UPDATE rolle_recht SET wert = 1 WHERE rolle = 'bauleiter' AND recht = 'preise_sehen'");
    }
  });

  await t.test('Katalog: künftiger EP geht in neue Baustellen mit; aus-vorlage mit gueltigAb', async () => {
    const kat = (await c.buero.get('/positionen/katalog')).daten.gruppen.flatMap((g) => g.positionen).find((p) => p.bezeichnung === 'Dumper');
    const ab = plusTage(heute, 10);
    let r = await c.buero.put(`/positionen/katalog/${kat.id}`, { version: kat.version, ep: kat.ep + 5, gueltigAb: ab });
    assert.equal(r.status, 200);
    assert.equal(r.daten.ep, kat.ep);
    assert.deepEqual(r.daten.epGeplant.map((x) => [x.ep, x.gueltigAb]), [[kat.ep + 5, ab]]);
    r = await c.gf.post('/baustellen', { kst: '26-099', name: 'Preis-Test', auftraggeber: 'AG', adresse: 'Ort', status: 'aktiv' });
    assert.equal(r.status, 201);
    const d = (await c.buero.get(`/baustellen/${r.daten.id}/positionen`)).daten;
    const p = alle(d).find((x) => x.bezeichnung === 'Dumper');
    assert.equal(p.ep, kat.ep);
    assert.deepEqual(p.epGeplant.map((x) => [x.ep, x.gueltigAb]), [[kat.ep + 5, ab]]);
    // aus-vorlage „preise“ mit künftigem Datum
    const vor = await c.buero.put(`/positionen/katalog/${kat.id}`, { version: kat.version + 1, ep: kat.ep + 1 });
    assert.equal(vor.status, 200);
    r = await c.buero.post(`/baustellen/${BS.kogler}/positionen/aus-vorlage`, { modus: 'preise', gueltigAb: plusTage(heute, 3) });
    assert.equal(r.status, 200);
    const pk = alle((await c.buero.get(`/baustellen/${BS.kogler}/positionen`)).daten).find((x) => x.bezeichnung === 'Dumper');
    assert.deepEqual(pk.epGeplant.map((x) => [x.ep, x.gueltigAb]), [[kat.ep + 1, plusTage(heute, 3)]]);
    assert.equal((await c.buero.post(`/baustellen/${BS.kogler}/positionen/aus-vorlage`, { modus: 'preise', gueltigAb: plusTage(heute, -3) })).status, 400);
  });
});
