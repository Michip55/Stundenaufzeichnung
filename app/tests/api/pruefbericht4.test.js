'use strict';
/** Regressionstests Prüfbericht 4 (E-01 … E-09), API.md 10f */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const ExcelJS = require('exceljs');
const { starte, U, BS, START } = require('./hilfe');
const X = require('../../server/katalog-excel');
const { oeffneDatenbank } = require('../../server/db');
const { createApp } = require('../../server/index');
const { pruefeBudget } = require('../../server/budget');

const r1 = (x) => Math.round((x + Number.EPSILON) * 10) / 10;
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const alle = (d) => d.gruppen.flatMap((g) => g.positionen);
const finde = (d, b) => alle(d).find((p) => p.bezeichnung === b);

/** Minimales ZIP (lokale Köpfe + Verzeichnis), Größenangaben optional gelogen */
function zip(eintraege) {
  const lokal = [], zentral = [];
  let off = 0;
  for (const e of eintraege) {
    const name = Buffer.from(e.name);
    const roh = e.daten;
    const komp = e.methode === 0 ? roh : zlib.deflateRawSync(roh, { level: 9 });
    const groesse = e.angabe ?? roh.length;
    const crc = zlib.crc32(roh);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(e.flags || 0, 6); lh.writeUInt16LE(e.methode ?? 8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(komp.length, 18); lh.writeUInt32LE(groesse, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(e.flags || 0, 8); ch.writeUInt16LE(e.methode ?? 8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(komp.length, 20); ch.writeUInt32LE(groesse, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    lokal.push(lh, name, komp);
    zentral.push(ch, name);
    off += 30 + name.length + komp.length;
  }
  const cd = Buffer.concat(zentral);
  const ende = Buffer.alloc(22);
  ende.writeUInt32LE(0x06054b50, 0); ende.writeUInt16LE(eintraege.length, 8); ende.writeUInt16LE(eintraege.length, 10);
  ende.writeUInt32LE(cd.length, 12); ende.writeUInt32LE(off, 16);
  return Buffer.concat([...lokal, cd, ende]);
}

test('Prüfbericht 4', async (t) => {
  const s = await starte({ euroSicherheitsnetz: false });
  t.after(() => s.stop());
  const buero = await s.login(U.buero);
  const bl = await s.login(U.bauleiter);
  const pos = async (c, bs) => (await c.get(`/baustellen/${bs}/positionen`)).daten;
  const ver = (pid) => s.db.eins('SELECT version FROM projektposition WHERE id = ?', pid).version;
  const put = (bs, pid, body) => buero.put(`/baustellen/${bs}/positionen/${pid}`, { version: ver(pid), ...body });
  const imp = (buf, q = '') => buero.post(`/positionen/katalog/import${q}`, { dateiBase64: buf.toString('base64') });

  await t.test('E-01: Landschaftsabgabe-Quelle bleibt; Entfernen nur ausdrücklich; Naturmaterial nur bei t', async () => {
    const d = await pos(buero, BS.kogler);
    const la = finde(d, 'Landschaftsabgabe');
    assert.deepEqual(la.quelle, { art: 'naturmaterial' });
    // nur „Zuordnung prüfen“ ändern → Quelle bleibt
    let r = await put(BS.kogler, la.id, { zuordnungPruefen: true });
    assert.equal(r.status, 200);
    assert.deepEqual(r.daten.quelle, { art: 'naturmaterial' });
    assert.equal(r.daten.zuordnungPruefen, true);
    // quelle:null ohne Kennzeichen → 400, unverändert
    r = await put(BS.kogler, la.id, { quelle: null });
    assert.equal(r.status, 400);
    assert.match(r.daten.fehler, /naturmaterialQuelleEntfernen/);
    assert.deepEqual(finde(await pos(buero, BS.kogler), 'Landschaftsabgabe').quelle, { art: 'naturmaterial' });
    // auch im Firmenkatalog
    const kat = (await buero.get('/positionen/katalog')).daten;
    const kla = kat.gruppen.flatMap((g) => g.positionen).find((p) => p.bezeichnung === 'Landschaftsabgabe');
    r = await buero.put(`/positionen/katalog/${kla.id}`, { version: kla.version, quelle: null });
    assert.equal(r.status, 400);
    // naturmaterialMoeglich nur bei t
    assert.equal(kla.naturmaterialMoeglich, false);
    assert.equal(kat.gruppen.flatMap((g) => g.positionen).find((p) => p.bezeichnung === 'Sand RK 0/4 Estrichsand').naturmaterialMoeglich, true);
    // Naturmaterial bei Std. → 400
    const fa = finde(d, 'Facharbeiter');
    assert.equal(fa.naturmaterialMoeglich, false);
    r = await put(BS.kogler, fa.id, { naturmaterial: true });
    assert.equal(r.status, 400);
    assert.match(r.daten.fehler, /Einheit t/);
    // Einheit weg von t → Kennzeichen fällt weg
    const sand = finde(d, 'Sand RK 0/4 Estrichsand');
    assert.equal(sand.naturmaterial, true);
    r = await put(BS.kogler, sand.id, { einheit: 'm³' });
    assert.equal(r.status, 200);
    assert.equal(r.daten.naturmaterial, false);
    assert.equal(r.daten.naturmaterialMoeglich, false);
    // ausdrücklich entfernen → erlaubt
    r = await put(BS.kogler, la.id, { quelle: null, naturmaterialQuelleEntfernen: true });
    assert.equal(r.status, 200);
    assert.equal(r.daten.quelle, null);
    // wieder setzen geht
    r = await put(BS.kogler, la.id, { quelle: { art: 'naturmaterial' } });
    assert.deepEqual(r.daten.quelle, { art: 'naturmaterial' });
  });

  await t.test('E-02: ZIP-Bomben, Grenzen und gleichzeitige Importe – Server bleibt stabil', async () => {
    const null30 = Buffer.alloc(30 * 1024 * 1024);
    // ehrliche Größenangabe: 30 MB entpackt
    let r = await imp(zip([{ name: 'xl/worksheets/sheet1.xml', daten: null30 }]));
    assert.equal(r.status, 400);
    assert.match(r.daten.fehler, /entpackt zu groß/);
    // gelogene Größenangabe (1 KB): wird beim Messen erkannt
    r = await imp(zip([{ name: 'xl/worksheets/sheet1.xml', daten: null30, angabe: 1024 }]));
    assert.equal(r.status, 400);
    assert.match(r.daten.fehler, /entpackt zu groß/);
    // Summe über mehrere Einträge (je 9 MB, zusammen 27 MB)
    const neun = Buffer.alloc(9 * 1024 * 1024);
    r = await imp(zip([1, 2, 3].map((i) => ({ name: `xl/a${i}.xml`, daten: neun, angabe: 10 }))));
    assert.equal(r.status, 400);
    assert.match(r.daten.fehler, /entpackt größer als 25 MB/);
    // zu viele Einträge
    r = await imp(zip(Array.from({ length: 301 }, (_, i) => ({ name: `x${i}.xml`, daten: Buffer.from('a'), methode: 0 }))));
    assert.equal(r.status, 400);
    assert.match(r.daten.fehler, /zu viele Einträge/);
    // verschlüsselt
    r = await imp(zip([{ name: 'a.xml', daten: Buffer.from('abc'), flags: 1 }]));
    assert.equal(r.status, 400);
    assert.match(r.daten.fehler, /Verschlüsselt/);
    // gültiges ZIP, aber kein Excel / kaputtes XML → 400, kein 500
    r = await imp(zip([{ name: '[Content_Types].xml', daten: Buffer.from('<nicht xml') }]));
    assert.equal(r.status, 400);
    // Datei > 5 MB (passt noch in das JSON-Limit von 7 MB)
    const gross = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(5 * 1024 * 1024 + 10)]);
    r = await imp(gross);
    assert.equal(r.status, 400);
    assert.match(r.daten.fehler, /größer als 5 MB/);
    // Anfrage > 7 MB → 413
    r = await buero.post('/positionen/katalog/import', { dateiBase64: 'A'.repeat(7.5 * 1024 * 1024) });
    assert.equal(r.status, 413);
    // andere Routen: 2 MB
    r = await buero.post('/positionen/katalog', { bezeichnung: 'x'.repeat(2.5 * 1024 * 1024) });
    assert.equal(r.status, 413);
    // zu viele Zeilen (> 5000)
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('T');
    ws.getCell('A5001').value = 'x';
    ws.getCell('A5002').value = 'y';
    r = await imp(Buffer.from(await wb.xlsx.writeBuffer()));
    assert.equal(r.status, 400);
    assert.match(r.daten.fehler, /zu viele Zeilen/);
    // gleichzeitige Importe: höchstens einer läuft, die anderen 409
    const vorlage = fs.readFileSync(X.VORLAGE);
    const parallel = await Promise.all([1, 2, 3].map(() => imp(vorlage)));
    const st = parallel.map((x) => x.status).sort();
    assert.ok(st.includes(200), st.join());
    assert.ok(st.includes(409), st.join());
    assert.ok(st.every((x) => x === 200 || x === 409), st.join());
    // danach wieder frei, Server antwortet
    assert.equal((await imp(vorlage)).status, 200);
    assert.equal((await buero.get('/auth/ich')).status, 200);
  });

  await t.test('E-02: pruefeZip direkt (Einheit)', () => {
    assert.throws(() => X.pruefeZip(Buffer.from('PK')), /Keine Excel-Datei/);
    const ok = X.pruefeZip(fs.readFileSync(X.VORLAGE));
    assert.ok(ok.eintraege > 3 && ok.entpacktBytes > 0);
    const b = zip([{ name: 'a', daten: Buffer.from('abc') }]);
    b.writeUInt16LE(0xffff, b.length - 22 + 10); // ZIP64-Kennung
    assert.throws(() => X.pruefeZip(b), /ZIP64/);
    assert.throws(() => X.pruefeZip(zip([{ name: 'a', daten: Buffer.from('abc'), methode: 12 }])), /Unbekannte Kompression|beschädigt/);
  });

  await t.test('E-05: Zeilenprüfung beim Import', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Tabelle1');
    const zeilen = [
      ['Titel', 'EH', null],
      ['Negativ', 'Std.', -5],
      ['Riesig', 'Std.', 1e15],
      ['X'.repeat(5000), 'Std.', 10],
      ['Dup', 'Std.', 10],
      ['Dup', 'Std.', 11],
      ['Facharbeiter', 'Std.', 72.504],
      ['Cent', 'Std.', 1.005],
      ['Summe Arbeit', null, null],
      ['Nachzügler', 'Std.', 5]
    ];
    zeilen.forEach(([a, b, n], i) => { const row = ws.getRow(i + 1); row.getCell(1).value = a; if (b) row.getCell(2).value = b; if (n != null) row.getCell(14).value = n; });
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    let r = await imp(buf);
    assert.equal(r.status, 200);
    assert.deepEqual(r.daten.fehler.map((f) => f.zeile), [2, 3, 4]);
    assert.match(r.daten.fehler[0].text, /EP -5 liegt nicht zwischen 0 und 1\.000\.000/);
    assert.match(r.daten.fehler[2].text, /länger als 200 Zeichen/);
    assert.ok(r.daten.fehler[2].text.length < 300);
    assert.deepEqual(r.daten.doppelt, [{ zeile: 6, bezeichnung: 'Dup', einheit: 'Std.' }]);
    assert.deepEqual(r.daten.neu.map((p) => [p.bezeichnung, p.ep]), [['Dup', 10], ['Cent', 1.01]]);
    assert.ok(!r.daten.geaendert.some((g) => g.bezeichnung === 'Facharbeiter')); // 72,504 → 72,50 = unverändert
    assert.equal(r.daten.unveraendert, 1);
    assert.deepEqual(r.daten.ohneSummenzeile, [{ zeile: 10, bezeichnung: 'Nachzügler' }]);
    // Übernahme mit fehlerhaften Zeilen → 400, nichts übernommen
    const vorher = s.db.eins('SELECT COUNT(*) AS n FROM katalog').n;
    r = await imp(buf, '?uebernehmen=1');
    assert.equal(r.status, 400);
    // N-01 (Nachprüfung 4): Fehlertext bleibt Text, Zeilenliste unter eigenem Schlüssel
    assert.equal(typeof r.daten.fehler, 'string');
    assert.match(r.daten.fehler, /3 ungültige Zeile\(n\)/);
    assert.equal(r.daten.zeilenFehler.length, 3);
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM katalog').n, vorher);
    assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM katalog WHERE bezeichnung = 'Dup'").n, 0);
  });

  await t.test('E-04: Import kennt die 10d-Umbenennungen und geschützten Preise', async () => {
    const vorlage = fs.readFileSync(X.VORLAGE);
    const anzahl = s.db.eins('SELECT COUNT(*) AS n FROM katalog').n;
    let r = await imp(vorlage, '?uebernehmen=1');
    assert.equal(r.status, 200);
    assert.equal(r.daten.uebernommen, true);
    assert.equal(r.daten.neu.length, 0); // keine doppelten Geräte
    assert.equal(r.daten.umbenannt.length, 7);
    const roll = r.daten.geaendert.find((g) => g.bezeichnung === 'Rollschotter RK 16/63');
    assert.deepEqual([roll.geschuetzt, roll.hinweis, roll.epAlt, roll.epNeu], [true, 'weicht von Preisliste-2026-Anpassung ab', 12.5, 14.5]);
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM katalog').n, anzahl);
    assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM katalog WHERE bezeichnung = 'Mobilbagger 9-11 to'").n, 0);
    const ep = (b) => s.db.eins('SELECT ep FROM katalog WHERE bezeichnung = ?', b).ep;
    assert.equal(ep('Rollschotter RK 16/63'), 12.5); // nicht still zurückgesetzt
    assert.equal(ep('LKW 2A'), 75); // nicht geschützt → übernommen
    // ausdrücklich überschreiben
    r = await imp(vorlage, '?uebernehmen=1&anpassungenUeberschreiben=1');
    assert.equal(r.status, 200);
    assert.equal(ep('Rollschotter RK 16/63'), 14.5);
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM katalog').n, anzahl);
  });

  await t.test('E-06: Rundung wie Excel (ROUND je Zeile, Summen gerundeter Zeilen), Prozent konsistent', async () => {
    let r = await buero.post(`/baustellen/${BS.pitten}/positionen`, { gruppe: 'fremdmaterial', bezeichnung: 'Rundungstest', einheit: 'm', ep: 1.15 });
    assert.equal(r.status, 201);
    const pid = r.daten.id;
    r = await buero.post(`/baustellen/${BS.pitten}/positionen/${pid}/mengen`, { datum: '2026-11-10', menge: 2.0004 });
    assert.equal(r.status, 201);
    assert.equal(r.daten.menge, 2);
    for (let i = 0; i < 3; i++) await buero.post(`/baustellen/${BS.pitten}/positionen/${pid}/mengen`, { datum: '2026-11-10', menge: 1.005 });
    const d = await pos(buero, BS.pitten);
    const p = finde(d, 'Rundungstest');
    assert.equal(p.menge, 5.015);
    assert.equal(p.summe, r2(5.015 * 1.15)); // 5,76725 → 5,77
    for (const g of d.gruppen) assert.equal(g.summe, r2(g.positionen.filter((x) => x.aktiv).reduce((a, x) => a + x.summe, 0)), g.name);
    assert.equal(d.gesamtsumme, r2(d.gruppen.reduce((a, g) => a + g.summe, 0)));
    assert.equal(d.anteilSummeProzent, r1(d.gruppen.reduce((a, g) => a + (g.anteilProzent || 0), 0)));
    assert.ok(Math.abs(d.anteilSummeProzent - 100) <= 0.3);
    // Export: dieselben Werte als Formel-Ergebnis
    const x = await buero.get(`/baustellen/${BS.pitten}/positionen/export.xlsx`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.daten);
    const ws = wb.worksheets[0];
    let zeile, gesamt, prozent;
    ws.eachRow((row) => {
      const a = row.getCell(1).value;
      if (a === 'Rundungstest') zeile = row;
      if (row.getCell(10).value === 'Gesamtsumme') { gesamt = row.getCell(15).value; prozent = row.getCell(13).value; }
    });
    assert.match(zeile.getCell(15).value.formula, /^ROUND\(M\d+\*N\d+,2\)$/);
    assert.equal(zeile.getCell(15).value.result, p.summe);
    assert.equal(zeile.getCell(13).value.result, p.menge);
    assert.equal(gesamt.result, d.gesamtsumme);
    assert.equal(prozent.result, d.anteilSummeProzent);
  });

  await t.test('E-07: Bauleiter storniert nur eigene Mengeneinträge', async () => {
    assert.equal(s.db.eins('SELECT bauleiter_id FROM baustelle WHERE id = ?', BS.pitten).bauleiter_id, U.bauleiter);
    const d = await pos(buero, BS.pitten);
    const p = finde(d, 'Rundungstest');
    const fremd = p.eintraege[0];
    assert.equal(fremd.erstelltVon, U.buero);
    let r = await bl.del(`/baustellen/${BS.pitten}/positionen/${p.id}/mengen/${fremd.id}`);
    assert.equal(r.status, 403);
    assert.ok(s.db.eins('SELECT id FROM projektposition_menge WHERE id = ?', fremd.id));
    // eigener Eintrag
    r = await bl.post(`/baustellen/${BS.pitten}/positionen/${p.id}/mengen`, { datum: '2026-11-11', menge: 1, notiz: 'eigener' });
    assert.equal(r.status, 201);
    assert.equal((await bl.del(`/baustellen/${BS.pitten}/positionen/${p.id}/mengen/${r.daten.id}`)).status, 200);
    // Büro darf fremde stornieren
    assert.equal((await buero.del(`/baustellen/${BS.pitten}/positionen/${p.id}/mengen/${fremd.id}`)).status, 200);
  });

  await t.test('E-08: ohne preise_sehen keine PA/VE-Beträge und Notizen', async () => {
    const maut = finde(await pos(buero, BS.pitten), 'Maut');
    assert.ok(maut.eintraege.length > 0);
    const notizen = maut.eintraege.map((e) => e.notiz).filter(Boolean);
    s.db.lauf("UPDATE rolle_recht SET wert = 0 WHERE rolle = 'bauleiter' AND recht = 'preise_sehen'");
    try {
      const r = await bl.get(`/baustellen/${BS.pitten}/positionen`);
      assert.equal(r.status, 200);
      const m = finde(r.daten, 'Maut');
      assert.equal(m.eintraegeAnzahl, maut.eintraege.length);
      for (const k of ['menge', 'mengeAuto', 'mengeManuell', 'eintraege', 'ep', 'summe']) assert.equal(m[k], undefined, k);
      const text = JSON.stringify(r.daten);
      for (const n of notizen) assert.ok(!text.includes(n), n);
      for (const p of alle(r.daten).filter((x) => /^(pa|ve)$/i.test(x.einheit))) assert.equal(p.menge, undefined, p.bezeichnung);
      // Stunden-Positionen behalten ihre Menge
      assert.equal(typeof finde(r.daten, 'Facharbeiter').menge, 'number');
      assert.equal(r.daten.gesamtsumme, undefined);
    } finally {
      s.db.lauf("UPDATE rolle_recht SET wert = 1 WHERE rolle = 'bauleiter' AND recht = 'preise_sehen'");
    }
  });

  await t.test('E-09: doppelte Landschaftsabgabe gemeldet; ausgeblendete Positionen ohne Doppelzählungs-Warnung', async () => {
    const warn = (d, re) => d.hinweise.filter((h) => re.test(h.text));
    // zweite Landschaftsabgabe-Position
    let r = await buero.post(`/baustellen/${BS.pitten}/positionen`, { gruppe: 'abgaben', bezeichnung: 'Landschaftsabgabe 2', einheit: 'PA', ep: 0.1, quelle: { art: 'naturmaterial' } });
    assert.equal(r.status, 201);
    const la2 = r.daten.id;
    let d = await pos(buero, BS.pitten);
    assert.equal(warn(d, /Landschaftsabgabe.*mehrfach gezählt/).length, 1);
    await put(BS.pitten, la2, { aktiv: false });
    d = await pos(buero, BS.pitten);
    assert.equal(warn(d, /mehrfach gezählt/).length, 0);
    // Gerät, das auf Pitten gemeldet ist, einer zweiten Position zuordnen
    const code = s.db.eins(`SELECT g.code FROM bericht_geraet bg JOIN bericht r ON r.id = bg.bericht_id JOIN geraet g ON g.id = bg.geraet_id
      WHERE r.baustelle_id = ? AND r.status <> 'entwurf' LIMIT 1`, BS.pitten).code;
    const erste = alle(d).find((p) => p.aktiv && p.quelle && p.quelle.art === 'geraet' && p.quelle.ref.includes(code));
    assert.ok(erste, code);
    r = await buero.post(`/baustellen/${BS.pitten}/positionen`, { gruppe: 'geraete', bezeichnung: 'Doppelt', einheit: 'Std.', ep: 1, quelle: { art: 'geraet', ref: [code] } });
    assert.equal(r.status, 201);
    const re = new RegExp(`„${code}“ ist mehreren Positionen zugeordnet`);
    assert.equal(warn(await pos(buero, BS.pitten), re).length, 1);
    // ausgeblendet → keine Warnung (Hinweis „nicht in der Summe“ bleibt möglich)
    await put(BS.pitten, erste.id, { aktiv: false });
    assert.equal(warn(await pos(buero, BS.pitten), re).length, 0);
    await put(BS.pitten, erste.id, { aktiv: true });
    await put(BS.pitten, r.daten.id, { aktiv: false });
    assert.equal(warn(await pos(buero, BS.pitten), re).length, 0);
  });

  await t.test('E-03: Baustelle ohne Positionen → Hinweis statt 0 %', async () => {
    s.db.lauf('DELETE FROM projektposition WHERE baustelle_id = ?', BS.kieswerk);
    const d = await pos(buero, BS.kieswerk);
    assert.equal(d.positionenFehlen, true);
    assert.equal(d.budgetVerbrauchProzent, null);
    assert.match(d.hinweise[0].text, /noch keine Positionen/);
    const k = (await buero.get(`/kalkulation/${BS.kieswerk}`)).daten;
    assert.equal(k.positionenFehlen, true);
    assert.equal(k.budgetVerbrauchProzent, null);
  });
});

test('E-03: Bestands-Datenbank (Schema vor den Positionen) wird übernommen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bautag-e03-'));
  const datei = path.join(dir, 'alt.db');
  try {
    // 1. Datenbank im alten Stand (Migration 5, vor Nachkalkulation nach Positionen)
    const alt = oeffneDatenbank(datei, { bisVersion: 5 });
    assert.equal(alt.eins("SELECT MAX(version) AS v FROM schema_version").v, 5);
    assert.ok(!alt.eins("SELECT name FROM sqlite_master WHERE name = 'katalog'"));
    const t0 = '2026-06-01T08:00:00.000Z';
    alt.lauf("INSERT INTO baustelle (id, kst, name, auftragssumme, erstellt) VALUES (1, '25-100', 'Altbau', 100000, ?)", t0);
    alt.lauf("INSERT INTO baustelle (id, kst, name, auftragssumme, erstellt) VALUES (2, '25-101', 'Ohne Auftrag', NULL, ?)", t0);
    alt.lauf("INSERT INTO baustelle (id, kst, name, intern, erstellt) VALUES (3, 'LAGER', 'Lager', 1, ?)", t0);
    // alte Alarme (Basis interne Kosten)
    alt.lauf("INSERT INTO budget_alarm (baustelle_id, schwelle, ausgeloest, verbrauch, basis) VALUES (1, '80', ?, 85, 100000), (1, '90', ?, 92, 100000)", t0, t0);
    alt.schliessen();

    // 2. Upgrade: alle Migrationen + einmalige Übernahme beim Start
    let app = createApp({ dbPath: datei, uhr: () => new Date(START), seed: false, demo: false, loginListe: false });
    let { db, bestand } = app.locals.bt;
    assert.equal(db.eins('SELECT MAX(version) AS v FROM schema_version').v, 8);
    const katalog = db.eins('SELECT COUNT(*) AS n FROM katalog WHERE aktiv = 1').n;
    assert.equal(katalog, 119);
    assert.deepEqual(bestand.kopiert.sort(), ['25-100', '25-101', 'LAGER']);
    for (const id of [1, 2, 3]) assert.equal(db.eins('SELECT COUNT(*) AS n FROM projektposition WHERE baustelle_id = ?', id).n, katalog);
    // 10d-Stand (umbenannte Geräte, Preisliste 2026) auch in den Bestands-Baustellen
    assert.ok(db.eins("SELECT 1 AS x FROM projektposition WHERE baustelle_id = 1 AND bezeichnung = 'Mobilbagger 7-11 t'"));
    assert.equal(db.eins("SELECT ep FROM projektposition WHERE baustelle_id = 1 AND bezeichnung = 'Rollschotter RK 16/63'").ep, 12.5);
    assert.ok(db.eins("SELECT COUNT(*) AS n FROM projektposition WHERE baustelle_id = 1 AND zuordnung_pruefen = 1").n > 0);
    // alte Alarme gelöscht, Basis umgestellt, protokolliert
    assert.equal(bestand.alarmeGeloescht, 2);
    assert.equal(db.eins('SELECT COUNT(*) AS n FROM budget_alarm').n, 0); // 0 % auf neuer Basis
    assert.equal(db.einstellung('budget_basis', null), 'positionen');
    assert.equal(db.einstellung('positionen_bestand', false), true);
    assert.ok(db.eins("SELECT 1 AS x FROM protokoll WHERE text LIKE 'Positionskatalog in 3 bestehende%'"));
    assert.ok(db.eins("SELECT 1 AS x FROM protokoll WHERE text LIKE 'Budget-Basis auf Nachkalkulationssumme umgestellt: 2 alte%'"));
    // Alarme greifen auf der neuen Basis wieder (80 % war vorher schon „ausgelöst“)
    const p = db.eins("SELECT id, ep FROM projektposition WHERE baustelle_id = 1 AND bezeichnung = 'Facharbeiter'");
    db.lauf("INSERT INTO projektposition_menge (position_id, datum, menge, erstellt) VALUES (?, '2026-11-10', ?, ?)", p.id, Math.ceil(85000 / p.ep), START);
    pruefeBudget(app.locals.bt, 1, { anlass: 'Test' });
    assert.deepEqual(db.alle('SELECT schwelle FROM budget_alarm WHERE baustelle_id = 1 ORDER BY schwelle').map((a) => a.schwelle), ['80']);
    db.schliessen();

    // 3. zweiter Start: nichts mehr kopiert oder gelöscht
    app = createApp({ dbPath: datei, uhr: () => new Date(START), seed: false, demo: false, loginListe: false });
    ({ db, bestand } = app.locals.bt);
    assert.deepEqual(bestand, { kopiert: [], alarmeGeloescht: null });
    assert.equal(db.eins('SELECT COUNT(*) AS n FROM budget_alarm').n, 1);
    assert.equal(db.eins('SELECT COUNT(*) AS n FROM projektposition WHERE baustelle_id = 1').n, katalog);
    db.schliessen();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('E-03: frische Demo-Datenbank braucht keine Übernahme', async () => {
  const s = await starte();
  try {
    assert.deepEqual(s.app.bt.bestand.kopiert, []); // leere DB beim Start, Seed setzt die Kennzeichen
    assert.ok(!s.app.bt.bestand.alarmeGeloescht);
    assert.equal(s.db.einstellung('budget_basis', null), 'positionen');
    assert.ok(s.db.eins('SELECT COUNT(*) AS n FROM budget_alarm').n > 0); // Seed-Alarme bleiben
  } finally { s.stop(); }
});
