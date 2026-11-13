'use strict';
/** BMD-OP-Import, LV-Import (ÖNORM A 2063 / Excel), Lohn-Vorlagen (API.md 12.20) – synthetische Dateien */
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { starte, U, BS } = require('./hilfe');

const b64 = (s, enc = 'utf8') => Buffer.from(s, enc).toString('base64');

test('Importe und Exporte BMD/Auer', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const c = {};
  for (const r of ['polier', 'bauleiter', 'buero', 'gf']) c[r] = await s.login(U[r]);
  let rid;

  await t.test('BMD-OP: Vorschau, Zuordnung über Rechnungs-Nr., unbekannte Zeilen, idempotent', async () => {
    rid = (await c.buero.post(`/baustellen/${BS.pitten}/rechnungen`, { nr: 'AR-2026-201', typ: 'teil', datum: '2026-10-01', netto: 1000, zahlungszielTage: 30 })).daten.id;
    await c.buero.post(`/baustellen/${BS.pitten}/rechnungen`, { nr: 'AR-2026-202', typ: 'teil', datum: '2026-10-05', netto: 500 });
    const z = (await c.buero.get('/import/bmd-op/zuordnung')).daten;
    assert.match(z.name, /BMD NTCS/);
    assert.equal(z.kodierung, 'windows-1252');
    const datei = 'Belegnr;Belegdatum;Kontobezeichnung;Betrag;Offen;Fällig;Zahlungsdatum\r\n'
      + 'AR 2026 201;01.10.2026;Gemeinde Pitten;1.200,00;400,00;31.10.2026;05.11.2026\r\n'
      + 'AR-2026-202;05.10.2026;Gemeinde Pitten;600,00;600,00;04.11.2026;\r\n'
      + 'AR-1999-999;01.01.2026;Müller Bau GmbH;100,00;100,00;31.01.2026;\r\n';
    let r = await c.buero.post('/import/bmd-op', { dateiBase64: b64(datei, 'latin1'), dateiname: 'op.csv', vorschau: true });
    assert.equal(r.status, 200);
    assert.equal(r.daten.uebernommen, false);
    assert.deepEqual(r.daten.zugeordnet.map((x) => [x.nr, x.alt.offen, x.neu.offen, x.aenderung]), [['AR-2026-201', 1200, 400, true], ['AR-2026-202', 600, 600, false]]);
    assert.deepEqual(r.daten.unbekannt.map((x) => [x.belegnr, x.kunde]), [['AR-1999-999', 'Müller Bau GmbH']]); // windows-1252
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM rechnung_zahlung').n, 0);
    r = await c.buero.post('/import/bmd-op', { dateiBase64: b64(datei, 'latin1'), dateiname: 'op.csv', vorschau: false });
    assert.equal(r.daten.uebernommen, true);
    const re = (await c.buero.get(`/rechnungen/${rid}`)).daten;
    assert.deepEqual([re.offen, re.zahlungen[0].quelle, re.zahlungen[0].datum, re.zahlungen[0].betrag], [400, 'bmd', '2026-11-05', 800]);
    r = await c.buero.post('/import/bmd-op', { dateiBase64: b64(datei, 'latin1'), vorschau: false });
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM rechnung_zahlung').n, 1); // idempotent
    // höherer offener Betrag → Fehler, nichts übernommen
    const vor = s.db.eins('SELECT COUNT(*) AS n FROM rechnung_zahlung').n;
    r = await c.buero.post('/import/bmd-op', { dateiBase64: b64(datei.replace('400,00', '900,00'), 'latin1'), vorschau: true });
    assert.match(r.daten.fehler[0].text, /höher/);
    // G-04: Übernahme mit Fehlerzeilen → 400 im Standardformat mit zeilenFehler, nichts gebucht (auch nicht die gültigen Zeilen)
    r = await c.buero.post('/import/bmd-op', { dateiBase64: b64(datei.replace('400,00', '900,00').replace('600,00;04.11', '100,00;04.11'), 'latin1'), vorschau: false });
    assert.equal(r.status, 400);
    assert.equal(r.daten.code, 'UNGUELTIG');
    assert.match(r.daten.fehler, /fehlerhafte Zeile\(n\) – nichts übernommen/);
    assert.equal(r.daten.zeilenFehler.length, 1);
    assert.match(r.daten.zeilenFehler[0].text, /höher/);
    assert.equal(r.daten.zeilenFehler[0].zeile, 2);
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM rechnung_zahlung').n, vor);
    assert.equal((await c.bauleiter.post('/import/bmd-op', { dateiBase64: b64(datei) })).status, 403);
    // Zuordnung ändern (Spaltennummern)
    const z2 = await c.buero.put('/import/bmd-op/zuordnung', { spalten: { belegnr: 1, offen: 5 }, kodierung: 'utf-8' });
    assert.equal(z2.daten.spalten.belegnr, 1);
    assert.equal((await c.buero.put('/import/bmd-op/zuordnung', { spalten: { quatsch: 1 } })).status, 400);
  });

  await t.test('BMD-Zahlungseingänge: Duplikate erkannt', async () => {
    await c.buero.put('/import/bmd-op/zuordnung', { spalten: { belegnr: 'Belegnr', bezahlt: 'Zahlung', zahlungsdatum: 'Datum' } });
    const d = 'Belegnr;Datum;Zahlung\r\nAR-2026-202;10.11.2026;300,00\r\n';
    let r = await c.buero.post('/import/bmd-op', { dateiBase64: b64(d), art: 'zahlungen', vorschau: false });
    assert.equal(r.daten.uebernommen, true);
    r = await c.buero.post('/import/bmd-op', { dateiBase64: b64(d), art: 'zahlungen', vorschau: false });
    assert.equal(r.daten.zugeordnet[0].aenderung, false);
    assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM rechnung_zahlung WHERE quelle = 'bmd'").n, 2);
  });

  await t.test('LV: ÖNORM A 2063 (XML, Namensräume, Attribute/Elemente), Soll in der Nachkalkulation', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<onlv:onlv xmlns:onlv="http://www.oenorm.at/schema/A2063/2015"><onlv:lv><onlv:gliederung>
  <onlv:position oz="01.01.01A"><onlv:kurztext>Baustelle einrichten</onlv:kurztext><onlv:einheit>PA</onlv:einheit><onlv:menge>1</onlv:menge><onlv:ep>2500.00</onlv:ep></onlv:position>
  <onlv:Position><onlv:PosNr>01.02.01</onlv:PosNr><onlv:Stichwort><![CDATA[Humus abtragen & lagern]]></onlv:Stichwort><onlv:ME>m3</onlv:ME><onlv:Menge>120.5</onlv:Menge><onlv:EP>8.40</onlv:EP><onlv:GP>1012.20</onlv:GP></onlv:Position>
  <onlv:position oz="01.03.01"><onlv:kurztext>Frostschutz liefern</onlv:kurztext><onlv:einheit>t</onlv:einheit><onlv:menge>300</onlv:menge><onlv:ep>14.50</onlv:ep><onlv:gp>4400</onlv:gp></onlv:position>
</onlv:gliederung></onlv:lv></onlv:onlv>`;
    assert.equal((await c.bauleiter.post(`/baustellen/${BS.pitten}/lv-import`, { dateiBase64: b64(xml), dateiname: 'lv.onlv' })).status, 403);
    let r = await c.buero.post(`/baustellen/${BS.pitten}/lv-import`, { dateiBase64: b64(xml), dateiname: 'lv.onlv', vorschau: true });
    assert.equal(r.status, 200);
    assert.equal(r.daten.format, 'oenorm_a2063');
    assert.deepEqual(r.daten.positionen.map((p) => [p.oz, p.kurztext, p.einheit, p.menge, p.ep, p.gp]), [
      ['01.01.01A', 'Baustelle einrichten', 'PA', 1, 2500, 2500], ['01.02.01', 'Humus abtragen & lagern', 'm3', 120.5, 8.4, 1012.2], ['01.03.01', 'Frostschutz liefern', 't', 300, 14.5, 4400]]);
    assert.equal(r.daten.summe, 7912.2);
    assert.ok(r.daten.warnungen.some((w) => /mit echter Exportdatei/.test(w)));
    assert.ok(r.daten.warnungen.some((w) => /01\.03\.01: GP 4400/.test(w)));
    r = await c.buero.post(`/baustellen/${BS.pitten}/lv-import`, { dateiBase64: b64(xml), dateiname: 'lv.onlv', vorschau: false, auftragssummeUebernehmen: true });
    assert.equal(r.daten.uebernommen, true);
    assert.equal(s.db.eins('SELECT auftragssumme FROM baustelle WHERE id = ?', BS.pitten).auftragssumme, 7912.2);
    const lv = (await c.bauleiter.get(`/baustellen/${BS.pitten}/lv`)).daten;
    assert.equal(lv.positionen.length, 3);
    assert.equal((await c.polier.get(`/baustellen/${BS.pitten}/lv`)).status, 403);
    const pp = s.db.eins("SELECT id FROM projektposition WHERE baustelle_id = ? AND bezeichnung LIKE 'Wandschotter FSM%'", BS.pitten).id;
    r = await c.buero.put(`/baustellen/${BS.pitten}/lv/${lv.positionen[2].id}`, { projektpositionId: pp });
    assert.equal(r.daten.projektpositionId, pp);
    const pos = (await c.buero.get(`/baustellen/${BS.pitten}/positionen`)).daten.gruppen.flatMap((g) => g.positionen).find((p) => p.id === pp);
    assert.deepEqual(pos.soll, { menge: 300, gp: 4400, ep: 14.67 });
  });

  await t.test('LV aus Excel mit Spaltenzuordnung', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('LV');
    ws.addRow(['OZ', 'Kurztext', 'Einheit', 'Menge', 'EP', 'GP']);
    ws.addRow(['02.01', 'Pflaster verlegen', 'm²', 450, 32.5, 14625]);
    ws.addRow(['02.02', 'Randleisten setzen', 'lfm', 120, 18, null]);
    const r = await c.buero.post(`/baustellen/${BS.kogler}/lv-import`, { dateiBase64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'), dateiname: 'lv.xlsx', vorschau: true });
    assert.equal(r.daten.format, 'tabelle');
    assert.deepEqual(r.daten.positionen.map((p) => p.gp), [14625, 2160]);
  });

  await t.test('Lohn-Vorlage BMD NTCS: vorinstalliert, änderbar, Export', async () => {
    assert.equal((await c.bauleiter.get('/lohn-vorlagen')).status, 403);
    const l = (await c.buero.get('/lohn-vorlagen')).daten;
    const bmd = l.find((x) => x.id === 'bmd-ntcs');
    assert.match(bmd.name, /mit Lohnverrechnung abstimmen/);
    const r = await c.buero.put('/lohn-vorlagen/bmd-ntcs', { ...bmd, lohnarten: { ...bmd.lohnarten, normal: '1001' }, trennzeichen: ';', kodierung: 'utf-8' });
    assert.equal(r.status, 200);
    const x = await c.buero.get('/monat/export.csv?monat=2026-11&vorlage=bmd-ntcs');
    assert.equal(x.status, 200);
    const text = x.daten.toString('utf8');
    assert.match(text, /^﻿pnr;monat;lohnart;stunden;tage;kst\r\n/);
    assert.match(text, /\r\n1\d{3};2026-11;1001;\d+(,\d+)?;;/);
    assert.equal((await c.buero.get('/monat/export.csv?monat=2026-11&vorlage=gibtsnicht')).status, 404);
    assert.equal((await c.buero.del('/lohn-vorlagen/bmd-ntcs')).status, 409);
    const neu = await c.buero.post('/lohn-vorlagen', { name: 'Je Tag', zeileJe: 'person_tag_lohnart', spalten: [{ feld: 'pnr' }, { feld: 'datum' }, { feld: 'lohnart' }, { feld: 'stunden' }], lohnarten: { normal: 'N', u: 'URL' } });
    assert.equal(neu.status, 201);
    const t2 = (await c.buero.get(`/monat/export.csv?monat=2026-11&vorlage=${neu.daten.id}`)).daten.toString('latin1');
    assert.match(t2, /\r\n1\d{3};\d{2}\.11\.2026;N;\d/);
  });

  await t.test('G-13: Formel-Schutz in jedem Export, auch mit Komma/Tab als Trennzeichen', async () => {
    s.db.lauf("UPDATE benutzer SET name = '=HYPERLINK(\"http://x\")' WHERE id = ?", U.mitarbeiter);
    for (const trenn of [',', '\\t', ';']) {
      const v = await c.buero.post('/lohn-vorlagen', { name: `Formel ${trenn}`, trennzeichen: trenn, kodierung: 'utf-8', spalten: [{ feld: 'pnr' }, { feld: 'name' }, { feld: 'fest', wert: '+SUMME(A1)' }, { feld: 'fest', wert: '@x' }, { feld: 'stunden' }], lohnarten: { normal: '-1' } });
      assert.equal(v.status, 201, JSON.stringify(v.daten));
      const text = (await c.buero.get(`/monat/export.csv?monat=2026-11&vorlage=${v.daten.id}`)).daten.toString('utf8');
      const t = trenn === '\\t' ? '\t' : trenn;
      const zeilen = text.replace(/^\uFEFF/, '').trim().split('\r\n').map((z) => z.split(t));
      const felder = zeilen.flat();
      assert.ok(!felder.some((f) => /^"?[=+@]/.test(f) || /^"?-1$/.test(f)), `${trenn}: ${text.slice(0, 300)}`);
      assert.ok(felder.some((f) => f.includes("'=HYPERLINK")), `${trenn}: Name entschärft`);
      assert.ok(felder.includes("'+SUMME(A1)") && felder.includes("'@x"));
    }
    // Standard-Lohn-CSV und Offene Posten ebenfalls
    const lohn = (await c.buero.get('/monat/export.csv?monat=2026-11')).daten.toString('utf8');
    assert.ok(lohn.includes("'=HYPERLINK") && !/;=HYPERLINK/.test(lohn));
    const { feld, csvText } = require('../../server/export');
    for (const x of ['=1+1', '+1', '-1', '@a', '\t=1', '\r=1', "'=1"]) assert.ok(feld(x, ',').replace(/^"/, '').startsWith("'"), JSON.stringify(x));
    assert.equal(csvText([['a,b', 'c']], ','), '"a,b",c\r\n');
    assert.equal(csvText([['a\tb', 'c']], '\t'), '"a\tb"\tc\r\n');
  });
});
