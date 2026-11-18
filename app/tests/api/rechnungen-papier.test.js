'use strict';
/**
 * Rechnungen erfassen „wie auf dem Papier“ und Fälligkeiten (API.md 15.24, Inhaber 17.11.2026).
 * - Migration 49: Übernahme ruecklass_art/_prozent/_betrag → Deckungs-/Haftrücklass, Art der Rücklass-Zahlungen
 * - Netto/USt/Brutto laut Rechnung (±0,02 €, Reverse Charge → USt 0), Skonto in % ODER €, beide Rücklässe
 * - echte Auer-Rechnung (Regieaufstellung 000/W26) als Beispiel, Fälligkeiten (Gruppen, Beträge, Randfälle), Rechte
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Datenbank } = require('../../server/db');
const { starte, U, BS } = require('./hilfe');

test('Migration 49: Rücklass-Art/-Prozent/-Betrag → Deckungs- bzw. Haftrücklass, Rücklass-Zahlungen mit Art', () => {
  const db = new Datenbank(':memory:', { bisVersion: 48 });
  const bs = db.lauf("INSERT INTO baustelle (kst, name, erstellt) VALUES ('M-1', 'Migration', '2026-01-01T00:00:00Z')").id;
  const neu = (nr, art, p, b) => db.lauf('INSERT INTO rechnung (baustelle_id, nr, nr_norm, typ, datum, netto, ruecklass_art, ruecklass_prozent, ruecklass_betrag, erstellt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', bs, nr, nr.toLowerCase(), 'abschlag', '2026-10-01', 10000, art, p, b, '2026-10-01T08:00:00Z').id;
  const d = neu('M1', 'deckung', 5, null), h = neu('M2', 'haft', null, 700), o = neu('M3', null, null, null), hb = neu('M4', 'haft', 3, 450);
  db.lauf("INSERT INTO rechnung_zahlung (rechnung_id, datum, betrag, skonto, ruecklass, erfasst) VALUES (?, '2026-10-20', 100, 0, 1, 'x'), (?, '2026-10-20', 200, 0, 1, 'x'), (?, '2026-10-20', 5000, 0, 0, 'x')", d, h, h);
  db.migrieren();
  const z = (id) => db.eins('SELECT deckung_prozent, deckung_betrag, haft_prozent, haft_betrag, ust_betrag, brutto, skonto_betrag FROM rechnung WHERE id = ?', id);
  assert.deepEqual({ ...z(d) }, { deckung_prozent: 5, deckung_betrag: null, haft_prozent: null, haft_betrag: null, ust_betrag: null, brutto: null, skonto_betrag: null });
  assert.deepEqual({ ...z(h) }, { deckung_prozent: null, deckung_betrag: null, haft_prozent: null, haft_betrag: 700, ust_betrag: null, brutto: null, skonto_betrag: null });
  assert.deepEqual({ ...z(o) }, { deckung_prozent: null, deckung_betrag: null, haft_prozent: null, haft_betrag: null, ust_betrag: null, brutto: null, skonto_betrag: null });
  assert.deepEqual([z(hb).haft_prozent, z(hb).haft_betrag], [3, 450]); // beide übernommen, Betrag geht vor (wie bisher)
  // alte Spalten sind weg (eine Quelle)
  assert.ok(!db.alle('PRAGMA table_info(rechnung)').some((c) => /^ruecklass/.test(c.name)));
  assert.deepEqual(db.alle('SELECT rechnung_id AS r, ruecklass_art AS a FROM rechnung_zahlung ORDER BY id').map((x) => [x.r, x.a]), [[d, 'deckung'], [h, 'haft'], [h, null]]);
  // Beträge wie vorher: 5 % von 12.000 = 600 Deckungsrücklass, 700 Haftrücklass (Betrag vor Prozent)
  const R = require('../../server/rechnungen');
  const sd = R.rechnungStand(db, db.eins('SELECT * FROM rechnung WHERE id = ?', d), '2026-11-12');
  assert.deepEqual([sd.deckung, sd.haft, sd.ruecklass, sd.zahlbetrag, sd.deckungOffen, sd.ruecklassBezahlt], [600, 0, 600, 11400, 500, 100]);
  const sh = R.rechnungStand(db, db.eins('SELECT * FROM rechnung WHERE id = ?', h), '2026-11-12');
  assert.deepEqual([sh.haft, sh.zahlbetrag, sh.offen, sh.haftOffen], [700, 11300, 6300, 500]);
  assert.equal(R.rechnungStand(db, db.eins('SELECT * FROM rechnung WHERE id = ?', hb), '2026-11-12').haft, 450);
});

test('Rechnungen wie auf dem Papier, Fälligkeiten (15.24)', async (t) => {
  const s = await starte({ sitzung: { feldMin: 60 * 24 * 400, bueroMin: 60 * 24 * 400, maxH: 24 * 400 } });
  t.after(() => s.stop());
  const c = {};
  for (const r of ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf']) c[r] = await s.login(U[r]);
  const neu = async (bs, body, status = 201) => {
    const r = await c.buero.post(`/baustellen/${bs}/rechnungen`, { typ: 'abschlag', datum: '2026-11-01', ...body });
    assert.equal(r.status, status, JSON.stringify(r.daten));
    return r.daten;
  };
  const zahle = (id, body) => c.buero.post(`/rechnungen/${id}/zahlungen`, { datum: '2026-11-10', ...body });

  await t.test('Auer-Rechnung „Regieaufstellung 000/W26“: Reverse Charge, 3 % Skonto 21 Tage, Ziel 30 Tage – Fälligkeiten zeigen genau diese zwei Zeilen', async () => {
    s.uhr.setze('2026-05-08T08:00:00Z');
    try {
      const r = await neu(BS.breitenau, { nr: '000/W26', typ: 'regie', datum: '2026-05-06', leistungVon: '2026-04-30', leistungBis: '2026-05-04', netto: 1775.75, ustModus: 'reverse_charge', ustBetrag: 0, brutto: 1775.75, skontoProzent: 3, skontoTage: 21, zahlungszielTage: 30, empfaenger: 'Handler Bau GmbH, Walter Handler Straße 1, 2853 Bad Schönau', agZeichen: 'KSt.: 030/1643.00' });
      assert.deepEqual([r.netto, r.ust, r.brutto, r.ruecklass, r.zahlbetrag], [1775.75, 0, 1775.75, 0, 1775.75]);
      assert.deepEqual([r.skontoEingabe, r.skontoProzent, r.skontoBetrag, r.skontoBis, r.faellig], ['prozent', 3, 53.27, '2026-05-27', '2026-06-05']);
      assert.deepEqual([r.empfaenger, r.agZeichen, r.typName, r.ustLautRechnung], ['Handler Bau GmbH, Walter Handler Straße 1, 2853 Bad Schönau', 'KSt.: 030/1643.00', 'Regierechnung', true]);
      const f = (await c.buero.get('/faelligkeiten')).daten;
      const e = f.gruppen.flatMap((g) => g.eintraege).filter((x) => x.nr === '000/W26');
      assert.equal(e.length, 1);
      assert.deepEqual(e[0].mitSkonto, { betrag: 1722.48, skonto: 53.27, bis: '2026-05-27', prozent: 3, tage: 21 });
      assert.deepEqual(e[0].ohneSkonto, { betrag: 1775.75, bis: '2026-06-05', tage: 30 });
      // 08.05.2026 (Freitag): Diese Woche bis 10.05., nächste Woche bis 17.05. – Skontofrist 27.05. → „Später“
      assert.deepEqual([f.heute, f.wocheBis, f.naechsteWocheBis], ['2026-05-08', '2026-05-10', '2026-05-17']);
      assert.equal(f.gruppen.find((g) => g.eintraege.includes(e[0]) || g.eintraege.some((x) => x.nr === '000/W26')).schluessel, 'spaeter');
      // am 28.05. ist die Skontofrist vorbei: nur noch „ohne Skonto“, Gruppe nach dem Zahlungsziel (05.06. = nächste Woche)
      s.uhr.setze('2026-05-28T08:00:00Z');
      const f2 = (await c.buero.get('/faelligkeiten')).daten;
      const g2 = f2.gruppen.find((g) => g.eintraege.some((x) => x.nr === '000/W26'));
      const e2 = g2.eintraege.find((x) => x.nr === '000/W26');
      assert.deepEqual([g2.schluessel, e2.mitSkonto, e2.ohneSkonto.betrag, g2.summeOhneSkonto, g2.summeMitSkonto], ['naechste_woche', null, 1775.75, 1775.75, 1775.75]);
      // Skonto am 27.05. (letzter Tag) noch erlaubt, am 28.05. nicht mehr
      assert.equal((await zahle(r.id, { datum: '2026-05-28', betrag: 1722.48, skonto: 53.27 })).status, 400);
      const z = await zahle(r.id, { datum: '2026-05-27', betrag: 1722.48, skonto: 53.27 });
      assert.deepEqual([z.status, z.daten.offen, z.daten.status], [201, 0, 'bezahlt']);
      assert.ok(!(await c.buero.get('/faelligkeiten')).daten.gruppen.some((g) => g.eintraege.some((x) => x.nr === '000/W26')));
      // Rechnungen von früher stören die folgenden Fälle nicht
      s.db.lauf('DELETE FROM rechnung_zahlung WHERE rechnung_id = ?', r.id); s.db.lauf('DELETE FROM rechnung WHERE id = ?', r.id);
    } finally { s.uhr.setze('2026-11-12T09:24:00.000Z'); }
  });

  await t.test('Netto, USt und Brutto laut Rechnung: ±0,02 € Toleranz, Reverse Charge → USt 0, Hinweis mit den erwarteten Werten', async () => {
    let r = await neu(BS.pitten, { nr: 'P-1', netto: 1000, ustBetrag: 200.02, brutto: 1200.02 });
    assert.deepEqual([r.ust, r.brutto, r.zahlbetrag], [200.02, 1200.02, 1200.02]); // Papierwerte gelten
    r = await neu(BS.pitten, { nr: 'P-2', netto: 1000, ustBetrag: 200.03, brutto: 1200.03 }, 400);
    assert.match(r.fehler, /USt passt nicht zum Netto: 1\.000,00 × 20 % = 200,00, eingetragen 200,03/);
    assert.deepEqual(r.erwartet, { ust: 200, brutto: 1200.03 });
    r = await neu(BS.pitten, { nr: 'P-3', netto: 1000, ustBetrag: 200, brutto: 1200.03 }, 400);
    assert.match(r.fehler, /Brutto passt nicht: Netto 1\.000,00 \+ USt 200,00 = 1\.200,00, eingetragen 1\.200,03/);
    assert.equal((await neu(BS.pitten, { nr: 'P-4', netto: 1000, ustBetrag: 199.98, brutto: 1199.98 })).brutto, 1199.98); // −0,02 noch in der Toleranz
    r = await neu(BS.pitten, { nr: 'P-5', netto: 1000, ustModus: 'reverse_charge', ustBetrag: 0.01 }, 400);
    assert.match(r.fehler, /Reverse Charge.*USt muss 0,00 sein/);
    assert.deepEqual(r.erwartet, { ust: 0, brutto: 1000 });
    r = await neu(BS.pitten, { nr: 'P-6', netto: 1000, ustModus: 'reverse_charge', ustBetrag: 0, brutto: 1200 }, 400);
    assert.match(r.fehler, /Brutto passt nicht/);
    r = await neu(BS.pitten, { nr: 'P-7', netto: 1000, ustSatz: 10, ustBetrag: 100, brutto: 1100 });
    assert.deepEqual([r.ust, r.brutto], [100, 1100]);
    // ohne Papierwerte: wie bisher gerechnet
    r = await neu(BS.pitten, { nr: 'P-8', netto: 1000 });
    assert.deepEqual([r.ust, r.brutto, r.ustLautRechnung], [200, 1200, false]);
    assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM rechnung WHERE nr IN ('P-2','P-3','P-5','P-6')").n, 0);
    // PUT: neues Netto ohne neue Papierwerte → USt/Brutto wieder gerechnet; widersprüchliche Papierwerte → 400
    const x = (await c.buero.get('/rechnungen')).daten.find((y) => y.nr === 'P-1');
    let u = await c.buero.put(`/rechnungen/${x.id}`, { version: x.version, netto: 2000 });
    assert.deepEqual([u.status, u.daten.ust, u.daten.brutto, u.daten.ustLautRechnung], [200, 400, 2400, false]);
    u = await c.buero.put(`/rechnungen/${x.id}`, { version: u.daten.version, brutto: 2500 });
    assert.equal(u.status, 400);
  });

  let beide;
  await t.test('Deckungs- und Haftrücklass auf derselben Rechnung (je % oder Betrag), Zahlungen je Art, Offene Posten, CSV', async () => {
    beide = await neu(BS.kogler, { nr: 'DH-1', netto: 10000, deckungProzent: 5, haftBetrag: 300, haftFreiAb: '2027-11-30', zahlungszielTage: 30 });
    assert.deepEqual([beide.brutto, beide.deckungsruecklass.betrag, beide.haftruecklass.betrag, beide.ruecklass, beide.zahlbetrag, beide.ruecklassArt], [12000, 600, 300, 900, 11100, 'beide']);
    assert.deepEqual(beide.deckungsruecklass, { eingabe: 'prozent', prozent: 5, betrag: 600, bezahlt: 0, offen: 600, freiAb: null });
    assert.deepEqual(beide.haftruecklass, { eingabe: 'betrag', prozent: null, betrag: 300, bezahlt: 0, offen: 300, freiAb: '2027-11-30', freiAbLautRechnung: '2027-11-30' });
    assert.equal((await neu(BS.kogler, { nr: 'DH-X', netto: 100, deckungProzent: 5, deckungBetrag: 6 }, 400)).fehler, 'Deckungsrücklass: entweder Prozent oder Betrag angeben, nicht beides.');
    assert.match((await neu(BS.kogler, { nr: 'DH-Y', netto: 1000, deckungProzent: 20, haftBetrag: 1000 }, 400)).fehler, /höher als der Bruttobetrag/);
    assert.match((await neu(BS.kogler, { nr: 'DH-G', typ: 'gutschrift', netto: 100, haftProzent: 2 }, 400)).fehler, /Gutschrift hat keinen Rücklass/);
    // Schlussrechnung derselben Baustelle → Deckungsrücklass frei mit deren Fälligkeit
    const sr = await neu(BS.kogler, { nr: 'DH-S', typ: 'schluss', datum: '2026-11-05', netto: 20000, haftProzent: 3, zahlungszielTage: 45 });
    assert.equal(sr.haftruecklass.freiAb, null); // weder Freigabe noch Gewährleistung am Bauvorhaben
    let r = (await c.buero.get(`/rechnungen/${beide.id}`)).daten;
    assert.equal(r.deckungsruecklass.freiAb, '2026-12-20');
    // Gewährleistung am Bauvorhaben → Haftrücklass der Schlussrechnung frei ab Gewährleistungsende
    s.db.lauf("UPDATE baustelle SET gewaehrleistung_bis = '2029-11-05' WHERE id = ?", BS.kogler);
    assert.equal((await c.buero.get(`/rechnungen/${sr.id}`)).daten.haftruecklass.freiAb, '2029-11-05');
    // Zahlungen: Rechnung, dann Rücklässe getrennt
    assert.equal((await zahle(beide.id, { betrag: 11100 })).status, 201);
    let z = await zahle(beide.id, { betrag: 100, ruecklass: true });
    assert.equal(z.status, 400);
    assert.match(z.daten.fehler, /Welcher Rücklass/);
    assert.match((await zahle(beide.id, { betrag: 301, ruecklass: true, ruecklassArt: 'haft' })).daten.fehler, /übersteigt den offenen Haftrücklass/);
    assert.equal((await zahle(beide.id, { betrag: 100, ruecklassArt: 'haft' })).status, 400); // Art nur mit ruecklass:true
    z = await zahle(beide.id, { betrag: 600, ruecklass: true, ruecklassArt: 'deckung' });
    assert.equal(z.status, 201);
    assert.deepEqual([z.daten.deckungsruecklass.offen, z.daten.haftruecklass.offen, z.daten.ruecklassOffen, z.daten.zahlungen.at(-1).ruecklassArt], [0, 300, 300, 'deckung']);
    z = await zahle(beide.id, { betrag: 100, ruecklass: true }); // nur noch der Haftrücklass offen → ohne Angabe
    assert.deepEqual([z.status, z.daten.haftruecklass.offen, z.daten.zahlungen.at(-1).ruecklassArt], [201, 200, 'haft']);
    const op = (await c.buero.get('/offene-posten')).daten;
    const rl = op.ruecklaesse.filter((x) => x.nr === 'DH-1' || x.nr === 'DH-S');
    assert.deepEqual(rl.map((x) => [x.nr, x.art, x.ruecklassOffen, x.ruecklassFaellig]).sort(), [['DH-1', 'haft', 200, '2027-11-30'], ['DH-S', 'haft', 720, '2029-11-05']]);
    const csv = (await c.buero.get('/offene-posten.csv')).daten.toString('utf8');
    assert.match(csv, /DH-1;Haftrücklass;26-038;.*;200;ruecklass/);
    const zcsv = (await c.buero.get('/zahlungseingaenge.csv?von=2026-11-01&bis=2026-11-12')).daten.toString('utf8');
    assert.match(zcsv, /DH-1;.*;600;0;Deckungsrücklass;manuell/);
    assert.match(zcsv, /DH-1;.*;100;0;Haftrücklass;manuell/);
    // Nachkalkulation: Rücklass offen = Summe beider Arten
    const k = (await c.buero.get(`/kalkulation/${BS.kogler}`)).daten.rechnungen;
    assert.equal(k.ruecklassOffen, 200 + 720);
    // nach Zahlungen gesperrt
    assert.equal((await c.buero.put(`/rechnungen/${beide.id}`, { version: z.daten.version, haftBetrag: 10 })).status, 409);
    s.db.lauf('UPDATE baustelle SET gewaehrleistung_bis = NULL WHERE id = ?', BS.kogler);
  });

  await t.test('Bisherige Schnittstelle ruecklassArt/-Prozent/-Betrag bleibt nutzbar', async () => {
    let r = await neu(BS.reisinger, { nr: 'ALT-1', netto: 1000, ruecklassArt: 'haft', ruecklassProzent: 5 });
    assert.deepEqual([r.ruecklassArt, r.ruecklassProzent, r.haftruecklass.betrag, r.deckungsruecklass], ['haft', 5, 60, null]);
    let u = await c.buero.put(`/rechnungen/${r.id}`, { version: r.version, ruecklassBetrag: 70 });
    assert.deepEqual([u.status, u.daten.haftruecklass.betrag, u.daten.haftruecklass.eingabe], [200, 70, 'betrag']);
    u = await c.buero.put(`/rechnungen/${r.id}`, { version: u.daten.version, ruecklassArt: 'deckung' });
    assert.deepEqual([u.daten.ruecklassArt, u.daten.deckungsruecklass.betrag, u.daten.haftruecklass], ['deckung', 70, null]);
    u = await c.buero.put(`/rechnungen/${r.id}`, { version: u.daten.version, ruecklassArt: null });
    assert.deepEqual([u.daten.ruecklassArt, u.daten.ruecklass], [null, 0]);
    assert.equal((await c.buero.post(`/baustellen/${BS.reisinger}/rechnungen`, { nr: 'ALT-2', typ: 'teil', datum: '2026-11-01', netto: 1, ruecklassArt: 'haft', haftProzent: 2 })).status, 400);
  });

  await t.test('Skonto in Prozent ODER als Betrag: gespeichert, was eingegeben wurde; das andere gerechnet', async () => {
    let r = await neu(BS.reisinger, { nr: 'SK-1', netto: 2000, skontoBetrag: 48, skontoTage: 14 }); // 48 von 2.400 = 2 %
    assert.deepEqual([r.skontoEingabe, r.skontoBetrag, r.skontoProzent, r.skontoBis], ['betrag', 48, 2, '2026-11-15']);
    assert.deepEqual([s.db.eins('SELECT skonto_prozent AS p, skonto_betrag AS b FROM rechnung WHERE id = ?', r.id).p, s.db.eins('SELECT skonto_betrag AS b FROM rechnung WHERE id = ?', r.id).b], [null, 48]);
    r = await neu(BS.reisinger, { nr: 'SK-2', netto: 1000, skontoBetrag: 25, skontoTage: 10 });
    assert.equal(r.skontoProzent, 2.083); // 25 / 1.200
    r = await neu(BS.reisinger, { nr: 'SK-3', netto: 1000, skontoProzent: 3, skontoTage: 21 });
    assert.deepEqual([r.skontoEingabe, r.skontoBetrag, r.skontoProzent], ['prozent', 36, 3]);
    assert.match((await neu(BS.reisinger, { nr: 'SK-4', netto: 1000, skontoProzent: 2, skontoBetrag: 24, skontoTage: 14 }, 400)).fehler, /entweder in Prozent oder als Betrag/);
    assert.match((await neu(BS.reisinger, { nr: 'SK-5', netto: 1000, skontoBetrag: 121, skontoTage: 14 }, 400)).fehler, /höher als 10 %/);
    assert.match((await neu(BS.reisinger, { nr: 'SK-6', netto: 1000, skontoBetrag: 20 }, 400)).fehler, /Frist gemeinsam/);
    // kein Skonto: weder Prozent noch Betrag noch Frist
    r = await neu(BS.reisinger, { nr: 'SK-7', netto: 1000, skontoProzent: null, skontoBetrag: null, skontoTage: null });
    assert.deepEqual([r.skontoEingabe, r.skontoBetrag, r.skontoBis], [null, 0, null]);
    // Wechsel per PUT: Prozent ersetzt den Betrag
    const sk1 = (await c.buero.get('/rechnungen?typ=abschlag')).daten.find((x) => x.nr === 'SK-1');
    const u = await c.buero.put(`/rechnungen/${sk1.id}`, { version: sk1.version, skontoProzent: 3 });
    assert.deepEqual([u.daten.skontoEingabe, u.daten.skontoBetrag, u.daten.skontoProzent], ['prozent', 72, 3]);
    // Skonto-Betrag begrenzt die Zahlung
    const sk2 = (await c.buero.get('/rechnungen')).daten.find((x) => x.nr === 'SK-2');
    let z = await zahle(sk2.id, { betrag: 1174.99, skonto: 25.01 });
    assert.equal(z.status, 400);
    assert.match(z.daten.fehler, /höchstens 25,00 \(laut Rechnung\)/);
    z = await zahle(sk2.id, { betrag: 1175, skonto: 25 });
    assert.deepEqual([z.status, z.daten.status], [201, 'bezahlt']);
  });

  await t.test('Liste: Filter Art und mehrere Status', async () => {
    const regie = (await c.buero.get('/rechnungen?typ=schluss')).daten;
    assert.ok(regie.length >= 1 && regie.every((x) => x.typ === 'schluss'));
    const offen = (await c.buero.get('/rechnungen?status=offen,teilbezahlt,ueberfaellig')).daten;
    assert.ok(offen.length > 0 && offen.every((x) => ['offen', 'teilbezahlt', 'ueberfaellig'].includes(x.status)));
    assert.ok((await c.buero.get('/rechnungen?status=bezahlt')).daten.every((x) => x.status === 'bezahlt'));
  });

  await t.test('Fälligkeiten: Gruppen und Beträge – verschiedene Ziele, Skonti, USt-Arten; Skontofrist vorbei, Teilzahlung, Gutschrift, storniert, bezahlt mit Rücklass', async () => {
    // eigene Baustelle ohne andere Rechnungen; heute = Do 12.11.2026 → diese Woche bis So 15.11., nächste bis So 22.11.
    const B = BS.ternitz;
    const A = await neu(B, { nr: 'F-A', datum: '2026-11-02', netto: 1000, zahlungszielTage: 14, skontoProzent: 3, skontoTage: 7 }); // Skonto bis 09.11. vorbei, fällig 16.11.
    const Bq = await neu(B, { nr: 'F-B', typ: 'regie', datum: '2026-11-10', netto: 5000, ustModus: 'reverse_charge', zahlungszielTage: 30, skontoProzent: 2, skontoTage: 4 }); // Skonto bis 14.11.
    const C = await neu(B, { nr: 'F-C', datum: '2026-10-01', netto: 2000, zahlungszielTage: 30 }); // fällig 31.10. → überfällig
    const D = await neu(B, { nr: 'F-D', typ: 'gutschrift', datum: '2026-11-05', netto: 100, zahlungszielTage: 14 }); // 19.11., negativ
    const E = await neu(B, { nr: 'F-E', datum: '2026-11-11', netto: 777, zahlungszielTage: 7 });
    assert.equal((await c.buero.post(`/rechnungen/${E.id}/storno`, { grund: 'falsch erfasst' })).status, 200);
    const Fr = await neu(B, { nr: 'F-F', typ: 'schluss', datum: '2026-10-20', netto: 10000, zahlungszielTage: 14, haftProzent: 5, haftFreiAb: '2029-10-20' });
    assert.equal((await zahle(Fr.id, { betrag: 11400 })).status, 201); // bezahlt – nur der Haftrücklass bleibt
    const G = await neu(B, { nr: 'F-G', datum: '2026-11-09', netto: 10000, zahlungszielTage: 21, skontoProzent: 2, skontoTage: 14, deckungProzent: 5 }); // Skonto bis 23.11.
    assert.equal((await zahle(G.id, { betrag: 5700 })).status, 201); // Teilzahlung ohne Skonto (Hälfte von 11.400)
    const f = (await c.buero.get('/faelligkeiten')).daten;
    const alle = f.gruppen.flatMap((g) => g.eintraege.filter((e) => e.baustelle.id === B).map((e) => ({ g: g.schluessel, ...e })));
    const zu = (nr, art = null) => alle.find((e) => e.nr === nr && (art ? e.art === art : !!e.ohneSkonto));
    assert.deepEqual(f.gruppen.map((g) => g.titel), ['Überfällig', 'Diese Woche', 'Nächste Woche', 'Später', 'Offene Differenzen']);
    // A: Skontofrist vorbei → nur ohne Skonto, Gruppe nach Zahlungsziel
    assert.deepEqual([zu('F-A').g, zu('F-A').mitSkonto, zu('F-A').ohneSkonto], ['naechste_woche', null, { betrag: 1200, bis: '2026-11-16', tage: 14 }]);
    // B: Reverse Charge, Skonto bis Samstag → diese Woche; 2 % von 5.000
    assert.deepEqual([zu('F-B').g, zu('F-B').mitSkonto.betrag, zu('F-B').mitSkonto.bis, zu('F-B').ohneSkonto.betrag, zu('F-B').ohneSkonto.bis], ['diese_woche', 4900, '2026-11-14', 5000, '2026-12-10']);
    // C: überfällig
    assert.deepEqual([zu('F-C').g, zu('F-C').ohneSkonto.betrag, zu('F-C').ueberfaelligTage], ['ueberfaellig', 2400, 12]);
    // D: Gutschrift negativ, ohne Skonto-Zeile
    assert.deepEqual([zu('F-D').g, zu('F-D').art, zu('F-D').ohneSkonto.betrag, zu('F-D').mitSkonto], ['naechste_woche', 'gutschrift', -120, null]);
    // E: storniert → fehlt
    assert.equal(zu('F-E'), undefined);
    // F: bezahlt → keine Rechnungszeile, nur Haftrücklass 570 frei ab 20.10.2029 (später)
    assert.equal(zu('F-F', 'rechnung'), undefined);
    assert.deepEqual([zu('F-F', 'haftruecklass').g, zu('F-F', 'haftruecklass').betrag, zu('F-F', 'haftruecklass').freiAb], ['spaeter', 600, '2029-10-20']);
    // G: Teilzahlung – offen 5.700, Skonto anteilig (228 × 5.700 / 11.400 = 114) → mit Skonto 5.586 bis 23.11.; Deckungsrücklass mit der Schlussrechnung F-F (fällig 03.11. → überfällig)
    assert.deepEqual([zu('F-G').g, zu('F-G').ohneSkonto.betrag, zu('F-G').mitSkonto.betrag, zu('F-G').mitSkonto.skonto, zu('F-G').teilbezahlt], ['spaeter', 5700, 5586, 114, true]);
    assert.deepEqual([zu('F-G', 'deckungruecklass').g, zu('F-G', 'deckungruecklass').betrag, zu('F-G', 'deckungruecklass').freiAb], ['ueberfaellig', 600, '2026-11-03']);
    // Summen je Gruppe (nur diese Baustelle hat Rechnungen in „Nächste Woche“ – andere Tests liegen in anderen Gruppen)
    const nw = f.gruppen.find((g) => g.schluessel === 'naechste_woche');
    const nwB = nw.eintraege.filter((e) => e.baustelle.id === B);
    assert.deepEqual(nwB.map((e) => e.nr), ['F-A', 'F-D']); // nach Datum sortiert
    const summe = (g, fn) => Math.round(g.eintraege.filter((e) => e.ohneSkonto).reduce((a, e) => a + fn(e), 0) * 100) / 100;
    for (const g of f.gruppen) {
      assert.equal(g.summeOhneSkonto, summe(g, (e) => e.ohneSkonto.betrag), g.schluessel);
      assert.equal(g.summeMitSkonto, summe(g, (e) => (e.mitSkonto || e.ohneSkonto).betrag), g.schluessel);
      assert.equal(g.summeRuecklass, Math.round(g.eintraege.filter((e) => /ruecklass$/.test(e.art)).reduce((a, e) => a + e.betrag, 0) * 100) / 100, g.schluessel);
      assert.equal(g.anzahl, g.eintraege.length);
    }
    const dw = f.gruppen.find((g) => g.schluessel === 'diese_woche');
    assert.ok(dw.summeMitSkonto < dw.summeOhneSkonto);
    // „Offen gesamt“ = offene Zahlbeträge (Gutschriften negativ) + einbehaltene Rücklässe; davon überfällig / in 7 Tagen fällig
    const og = f.offenGesamt;
    const re = f.gruppen.flatMap((g) => g.eintraege).filter((e) => e.ohneSkonto);
    const r2 = (x) => Math.round(x * 100) / 100;
    assert.equal(og.rechnungen, r2(f.gruppen.reduce((a, g) => a + g.summeOhneSkonto, 0)));
    assert.equal(og.ruecklaesse, r2(f.gruppen.reduce((a, g) => a + g.summeRuecklass, 0)));
    assert.equal(og.betrag, r2(og.rechnungen + og.ruecklaesse));
    assert.equal(og.anzahl, re.length);
    assert.equal(og.ueberfaellig, r2(re.filter((e) => e.art !== 'gutschrift' && e.ohneSkonto.bis < '2026-11-12').reduce((a, e) => a + e.ohneSkonto.betrag, 0)));
    assert.equal(og.naechste7Tage, r2(re.filter((e) => e.ohneSkonto.bis >= '2026-11-12' && e.ohneSkonto.bis <= '2026-11-19').reduce((a, e) => a + e.ohneSkonto.betrag, 0)));
    assert.ok(og.ueberfaellig >= 2400 && og.naechste7Tage >= 1200 - 120); // F-C überfällig; F-A (16.11.) und Gutschrift F-D (19.11., −120) in 7 Tagen
    // Offene Posten (nur Rechnungen) = Offen gesamt ohne Rücklässe
    assert.equal((await c.buero.get('/offene-posten')).daten.summeOffen, og.rechnungen);
  });

  await t.test('„Als bezahlt markieren“: in der Skontofrist mit Skonto, danach voll; Rücklass bleibt offen (außer inkl.); Rückgängig; Summen; Rechte', async () => {
    const B = BS.gloggnitz;
    const x = await neu(B, { nr: 'BZ-1', datum: '2026-11-07', netto: 1000, zahlungszielTage: 30, skontoProzent: 3, skontoTage: 14, haftProzent: 5 }); // Skonto bis 21.11.
    assert.deepEqual([x.zahlbetrag, x.skontoBetrag, x.haftruecklass.betrag], [1140, 34.2, 60]);
    const og0 = (await c.buero.get('/faelligkeiten')).daten.offenGesamt;
    // Rechte: Polier/Mitarbeiter 403, nichts gebucht
    for (const r of ['polier', 'mitarbeiter']) {
      const a = await c[r].post(`/rechnungen/${x.id}/bezahlt`, {});
      assert.equal(a.status, 403);
      assert.ok(!/1\.?105|34[.,]2|BZ-1/.test(JSON.stringify(a.daten)));
      assert.equal((await c[r].post(`/rechnungen/${x.id}/bezahlt/rueckgaengig`, { zahlungIds: [1] })).status, 403);
    }
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM rechnung_zahlung WHERE rechnung_id = ?', x.id).n, 0);
    // in der Skontofrist: offen − Skonto, Skonto genommen; Haftrücklass bleibt offen
    let r = await c.buero.post(`/rechnungen/${x.id}/bezahlt`, {});
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    assert.deepEqual([r.daten.status, r.daten.bezahlt, r.daten.skontoGenommen, r.daten.offen, r.daten.haftruecklass.offen, r.daten.zahlungIds.length], ['bezahlt', 1105.8, 34.2, 0, 60, 1]);
    assert.deepEqual({ ...s.db.eins('SELECT datum, betrag, skonto, ruecklass, quelle FROM rechnung_zahlung WHERE id = ?', r.daten.zahlungIds[0]) }, { datum: '2026-11-12', betrag: 1105.8, skonto: 34.2, ruecklass: 0, quelle: 'markiert' });
    let f = (await c.buero.get('/faelligkeiten')).daten;
    assert.equal(f.offenGesamt.betrag, Math.round((og0.betrag - 1140) * 100) / 100); // Rechnung weg, Rücklass bleibt
    assert.ok(f.gruppen.some((g) => g.eintraege.some((e) => e.nr === 'BZ-1' && e.art === 'haftruecklass' && e.betrag === 60)));
    assert.ok(!f.gruppen.some((g) => g.eintraege.some((e) => e.nr === 'BZ-1' && e.ohneSkonto)));
    assert.equal((await c.buero.post(`/rechnungen/${x.id}/bezahlt`, {})).status, 409); // bereits bezahlt
    // Rückgängig: nur Markierungen dieser Rechnung; protokolliert
    assert.equal((await c.buero.post(`/rechnungen/${x.id}/bezahlt/rueckgaengig`, { zahlungIds: [r.daten.zahlungIds[0] + 99999] })).status, 409);
    r = await c.bauleiter.post(`/rechnungen/${x.id}/bezahlt/rueckgaengig`, { zahlungIds: r.daten.zahlungIds }); // Bauleiter = Büro
    assert.deepEqual([r.status, r.daten.status, r.daten.offen, r.daten.skontoGenommen], [200, 'offen', 1140, 0]);
    assert.ok(s.db.eins("SELECT COUNT(*) AS n FROM protokoll WHERE objekt = ? AND text LIKE '%rückgängig%'", `rechnung:${x.id}`).n === 1);
    assert.equal((await c.buero.get('/faelligkeiten')).daten.offenGesamt.betrag, og0.betrag);
    // inkl. Rücklass: zwei Buchungen, alles bezahlt; Rückgängig nimmt beide zurück
    r = await c.gf.post(`/rechnungen/${x.id}/bezahlt`, { inklRuecklass: true, notiz: 'Kontoauszug 17.11.' });
    assert.deepEqual([r.status, r.daten.offen, r.daten.ruecklassOffen, r.daten.zahlungIds.length, r.daten.zahlungen.find((z) => z.ruecklass).ruecklassArt], [201, 0, 0, 2, 'haft']);
    r = await c.buero.post(`/rechnungen/${x.id}/bezahlt/rueckgaengig`, { zahlungIds: r.daten.zahlungIds });
    assert.deepEqual([r.daten.offen, r.daten.ruecklassOffen, r.daten.zahlungen.length], [1140, 60, 0]);
    // eine manuell erfasste Zahlung lässt sich hier nicht zurücknehmen
    const man = await zahle(x.id, { datum: '2026-11-11', betrag: 100 });
    assert.equal((await c.buero.post(`/rechnungen/${x.id}/bezahlt/rueckgaengig`, { zahlungIds: [man.daten.zahlungId] })).status, 409);
    // Teilbetrag: eigener Betrag ohne Skonto-Angabe → kein Skonto, teilbezahlt
    r = await c.buero.post(`/rechnungen/${x.id}/bezahlt`, { betrag: 500 });
    assert.deepEqual([r.daten.status, r.daten.offen, r.daten.skontoGenommen], ['teilbezahlt', 540, 0]);
    await c.buero.post(`/rechnungen/${x.id}/bezahlt/rueckgaengig`, { zahlungIds: r.daten.zahlungIds });
    await c.buero.del(`/rechnungen/${x.id}/zahlungen/${man.daten.zahlungId}`);
    assert.match((await c.buero.post(`/rechnungen/${x.id}/bezahlt`, { betrag: 2000 })).daten.fehler, /übersteigt den offenen Betrag/);
    // nach der Skontofrist (heute 25.11.): voller Betrag ohne Skonto; Zahlungsdatum in der Frist (20.11.) → mit Skonto
    s.uhr.setze('2026-11-25T09:00:00Z');
    try {
      r = await c.buero.post(`/rechnungen/${x.id}/bezahlt`, {});
      assert.deepEqual([r.status, r.daten.bezahlt, r.daten.skontoGenommen, r.daten.status], [201, 1140, 0, 'bezahlt']);
      await c.buero.post(`/rechnungen/${x.id}/bezahlt/rueckgaengig`, { zahlungIds: r.daten.zahlungIds });
      r = await c.buero.post(`/rechnungen/${x.id}/bezahlt`, { datum: '2026-11-20' });
      assert.deepEqual([r.status, r.daten.bezahlt, r.daten.skontoGenommen], [201, 1105.8, 34.2]);
      await c.buero.post(`/rechnungen/${x.id}/bezahlt/rueckgaengig`, { zahlungIds: r.daten.zahlungIds });
      assert.match((await c.buero.post(`/rechnungen/${x.id}/bezahlt`, { datum: '2026-11-24', skonto: 34.2, betrag: 1105.8 })).daten.fehler, /Skontofrist/);
      assert.equal((await c.buero.post(`/rechnungen/${x.id}/bezahlt`, { datum: '2026-11-26' })).status, 400); // Zukunft
    } finally { s.uhr.setze('2026-11-12T09:24:00.000Z'); }
    // storniert → 409
    const y = await neu(B, { nr: 'BZ-2', netto: 100 });
    await c.buero.post(`/rechnungen/${y.id}/storno`, { grund: 'Probe' });
    assert.equal((await c.buero.post(`/rechnungen/${y.id}/bezahlt`, {})).status, 409);
  });

  await t.test('Zahlungsabgleich: tatsächlich bezahlt, Differenz in Gründe aufgeteilt (akzeptiert/strittig), verspätetes Skonto, Rücklass einbehalten, Überzahlung, Summen, Rückgängig, Rechte', async () => {
    const B = BS.neustadt;
    const differenzen = () => s.db.eins('SELECT COUNT(*) AS n FROM rechnung_differenz').n;
    s.uhr.setze('2026-05-20T08:00:00Z');
    try {
      const auer = { typ: 'regie', datum: '2026-05-06', netto: 1775.75, ustModus: 'reverse_charge', skontoProzent: 3, skontoTage: 21, zahlungszielTage: 30 };
      const a = await neu(B, { nr: 'AB-1', ...auer });
      // Rechte: Polier/Mitarbeiter 403, keine Buchung, keine Differenz
      for (const r of ['polier', 'mitarbeiter']) {
        const x = await c[r].post(`/rechnungen/${a.id}/bezahlt`, { betrag: 1700, differenzen: [{ grund: 'spesen', betrag: 22.48, status: 'akzeptiert' }] });
        assert.equal(x.status, 403);
        assert.ok(!/1\.?7[02]|22[.,]48|AB-1/.test(JSON.stringify(x.daten)));
      }
      assert.equal(differenzen(), 0);
      // nicht vollständig aufgeteilt → 400 mit erwartet/Differenz
      let r = await c.buero.post(`/rechnungen/${a.id}/bezahlt`, { datum: '2026-05-20', betrag: 1700, differenzen: [{ grund: 'spesen', betrag: 2.48, status: 'akzeptiert' }, { grund: 'umlage', text: 'Bauwesenversicherung', betrag: 19.99, status: 'strittig' }] });
      assert.equal(r.status, 400);
      assert.match(r.daten.fehler, /nicht vollständig aufgeteilt: erwartet 1722,48, bezahlt 1700,00, Differenz 22,48, aufgeteilt 22,47/);
      assert.deepEqual([r.daten.erwartet, r.daten.differenz], [1722.48, 22.48]);
      assert.equal((await c.buero.post(`/rechnungen/${a.id}/bezahlt`, { betrag: 1700, differenzen: [{ grund: 'sonstiges', betrag: 22.48, status: 'strittig' }] })).status, 400); // „Sonstiges“ ohne Text
      // genau das Beispiel: erwartet 1.722,48 (mit Skonto), bezahlt 1.700,00 → 22,48 = Bankspesen 2,48 akzeptiert + Bauwesenversicherung 20,00 strittig
      r = await c.buero.post(`/rechnungen/${a.id}/bezahlt`, { datum: '2026-05-20', betrag: 1700, differenzen: [{ grund: 'spesen', betrag: 2.48, status: 'akzeptiert' }, { grund: 'umlage', text: 'Bauwesenversicherung', betrag: 20, status: 'strittig' }] });
      assert.equal(r.status, 201, JSON.stringify(r.daten));
      const ab = r.daten;
      assert.deepEqual([ab.bezahlt, ab.skontoGenommen, ab.abzuegeAkzeptiert, ab.strittig, ab.offen, ab.status], [1700, 53.27, 2.48, 20, 20, 'differenz']);
      assert.deepEqual(ab.differenzen.map((d) => [d.grund, d.text, d.betrag, d.status, d.zahlungId === ab.zahlungIds[0]]), [['spesen', '', 2.48, 'akzeptiert', true], ['umlage', 'Bauwesenversicherung', 20, 'strittig', true]]);
      // Fälligkeiten: eigene Gruppe „Offene Differenzen“, keine normale Zeile mehr; Offen gesamt mit strittigen Differenzen
      let f = (await c.buero.get('/faelligkeiten')).daten;
      const dg = f.gruppen.find((g) => g.schluessel === 'differenzen');
      const de = dg.eintraege.filter((e) => e.nr === 'AB-1');
      assert.deepEqual(de.map((e) => [e.art, e.grundName, e.text, e.betrag]), [['differenz', 'Umlage/Abzug des Auftraggebers', 'Bauwesenversicherung', 20]]);
      assert.ok(!f.gruppen.some((g) => g.eintraege.some((e) => e.nr === 'AB-1' && e.ohneSkonto)));
      assert.equal(f.offenGesamt.strittig, 20);
      assert.equal(dg.summeDifferenz, 20);
      // Offene Posten: Rechnung mit strittigem Rest, nicht überfällig; Summe strittig
      let op = (await c.buero.get('/offene-posten')).daten;
      const pz = op.posten.find((x) => x.nr === 'AB-1');
      assert.deepEqual([pz.status, pz.offen, pz.strittig], ['differenz', 20, 20]);
      assert.equal(op.summeStrittig, 20);
      assert.equal(op.summeOffen, f.offenGesamt.rechnungen);
      // strittig → später akzeptiert → bezahlt; wieder strittig; Polier 403
      const did = ab.differenzen[1].id;
      assert.equal((await c.polier.put(`/rechnungen/${a.id}/differenzen/${did}`, { status: 'akzeptiert' })).status, 403);
      r = await c.bauleiter.put(`/rechnungen/${a.id}/differenzen/${did}`, { status: 'akzeptiert' });
      assert.deepEqual([r.status, r.daten.status, r.daten.offen, r.daten.abzuegeAkzeptiert], [200, 'bezahlt', 0, 22.48]);
      r = await c.buero.put(`/rechnungen/${a.id}/differenzen/${did}`, { status: 'strittig' });
      assert.deepEqual([r.daten.status, r.daten.strittig], ['differenz', 20]);
      assert.equal((await c.buero.put(`/rechnungen/${a.id}/differenzen/${did}`, { status: 'erledigt' })).status, 400);
      // Rückgängig nimmt Zahlung und Differenzen zurück (protokolliert)
      r = await c.buero.post(`/rechnungen/${a.id}/bezahlt/rueckgaengig`, { zahlungIds: ab.zahlungIds });
      assert.deepEqual([r.daten.status, r.daten.offen, r.daten.differenzen.length], ['offen', 1775.75, 0]);
      assert.equal(differenzen(), 0);
      assert.match(s.db.eins("SELECT alt FROM protokoll WHERE objekt = ? AND text LIKE '%rückgängig%' ORDER BY id DESC", `rechnung:${a.id}`).alt, /Bauwesenversicherung/);
      // nochmals buchen; die strittigen 20,00 kommen später doch → normale Zahlung schließt die Differenz
      r = await c.buero.post(`/rechnungen/${a.id}/bezahlt`, { datum: '2026-05-20', betrag: 1700, differenzen: [{ grund: 'spesen', betrag: 2.48, status: 'akzeptiert' }, { grund: 'umlage', text: 'Bauwesenversicherung', betrag: 20, status: 'strittig' }] });
      r = await zahle(a.id, { datum: '2026-05-20', betrag: 20 });
      assert.deepEqual([r.status, r.daten.status, r.daten.offen, r.daten.strittig], [201, 'bezahlt', 0, 0]);

      // verspätetes Skonto: Eingang 29.05. (Frist bis 27.05.) mit 3 % abgezogen → Differenz „Skonto“ automatisch verspätet und strittig
      const b = await neu(B, { nr: 'AB-2', ...auer });
      s.uhr.setze('2026-05-30T08:00:00Z');
      r = await c.buero.post(`/rechnungen/${b.id}/bezahlt`, { datum: '2026-05-29', betrag: 1722.48, differenzen: [{ grund: 'skonto', betrag: 53.27 }] });
      assert.equal(r.status, 201, JSON.stringify(r.daten));
      assert.deepEqual([r.daten.skontoGenommen, r.daten.status, r.daten.strittig, r.daten.differenzen[0].skontoVerspaetet, r.daten.differenzen[0].status], [0, 'differenz', 53.27, true, 'strittig']);
      // Skonto im Feld „skonto“ nach der Frist bleibt verboten
      const b2 = await neu(B, { nr: 'AB-2b', ...auer });
      assert.match((await c.buero.post(`/rechnungen/${b2.id}/bezahlt`, { datum: '2026-05-29', betrag: 1722.48, skonto: 53.27, differenzen: [] })).daten.fehler, /Skontofrist/);
      // dasselbe, bewusst akzeptiert
      r = await c.buero.post(`/rechnungen/${b2.id}/bezahlt`, { datum: '2026-05-29', betrag: 1722.48, differenzen: [{ grund: 'skonto', betrag: 53.27, status: 'akzeptiert' }] });
      assert.deepEqual([r.daten.status, r.daten.differenzen[0].skontoVerspaetet, r.daten.abzuegeAkzeptiert], ['bezahlt', true, 53.27]);

      // Rücklass einbehalten (nicht auf der Rechnung): 5 % Deckungsrücklass vom Brutto 12.000 → bezahlt 11.400
      const c3 = await neu(B, { nr: 'AB-3', typ: 'abschlag', datum: '2026-05-25', netto: 10000, zahlungszielTage: 30 });
      r = await c.buero.post(`/rechnungen/${c3.id}/bezahlt`, { betrag: 11400, differenzen: [{ grund: 'deckung', betrag: 600, status: 'akzeptiert' }] });
      assert.equal(r.status, 201, JSON.stringify(r.daten));
      assert.deepEqual([r.daten.status, r.daten.offen, r.daten.deckungsruecklass.eingabe, r.daten.deckungsruecklass.betrag, r.daten.deckungsruecklass.offen, r.daten.differenzen[0].status], ['bezahlt', 0, 'einbehalten', 600, 600, 'einbehalten']);
      f = (await c.buero.get('/faelligkeiten')).daten;
      assert.ok(f.gruppen.some((g) => g.eintraege.some((e) => e.nr === 'AB-3' && e.art === 'deckungruecklass' && e.betrag === 600)));
      assert.equal((await c.buero.put(`/rechnungen/${c3.id}/differenzen/${r.daten.differenzen[0].id}`, { status: 'akzeptiert' })).status, 409);
      r = await zahle(c3.id, { datum: '2026-05-30', betrag: 600, ruecklass: true });
      assert.deepEqual([r.status, r.daten.ruecklassOffen], [201, 0]);

      // Überzahlung: erwartet 1.200,00, bezahlt 1.250,00 → „Überzahlung € 50,00“ mit Notiz; ohne Zeile 400; nicht gemischt
      const d4 = await neu(B, { nr: 'AB-4', typ: 'teil', datum: '2026-05-25', netto: 1000, zahlungszielTage: 14 });
      assert.match((await c.buero.post(`/rechnungen/${d4.id}/bezahlt`, { betrag: 1250 })).daten.fehler, /übersteigt/);
      assert.equal((await c.buero.post(`/rechnungen/${d4.id}/bezahlt`, { betrag: 1250, differenzen: [{ grund: 'ueberzahlung', betrag: 52.48 }, { grund: 'spesen', betrag: 2.48, status: 'akzeptiert' }] })).status, 400);
      const ogVor = (await c.buero.get('/faelligkeiten')).daten.offenGesamt;
      r = await c.buero.post(`/rechnungen/${d4.id}/bezahlt`, { betrag: 1250, differenzen: [{ grund: 'ueberzahlung', betrag: 50, text: 'doppelt überwiesen? – rückzahlen' }] });
      assert.equal(r.status, 201, JSON.stringify(r.daten));
      assert.deepEqual([r.daten.status, r.daten.offen, r.daten.ueberzahlung, r.daten.bezahlt], ['bezahlt', 0, 50, 1250]);
      f = (await c.buero.get('/faelligkeiten')).daten;
      const ue = f.gruppen.find((g) => g.schluessel === 'differenzen').eintraege.find((e) => e.nr === 'AB-4');
      assert.deepEqual([ue.art, ue.betrag, ue.text], ['ueberzahlung', -50, 'doppelt überwiesen? – rückzahlen']);
      assert.equal(f.offenGesamt.ueberzahlung, 50);
      assert.equal(f.offenGesamt.betrag, Math.round((ogVor.betrag - 1200 - 50) * 100) / 100);
      // Summen: Offen gesamt = Rechnungen (inkl. strittig) + Rücklässe − Überzahlungen
      const og = f.offenGesamt;
      assert.equal(og.betrag, Math.round((og.rechnungen + og.ruecklaesse - og.ueberzahlung) * 100) / 100);
      assert.equal(og.strittig, Math.round(f.gruppen.find((g) => g.schluessel === 'differenzen').eintraege.filter((e) => e.art === 'differenz').reduce((x, e) => x + e.betrag, 0) * 100) / 100);
      assert.equal((await c.buero.get('/offene-posten')).daten.summeOffen, og.rechnungen);
      // Überzahlung erledigt (zurückgezahlt)
      r = await c.buero.put(`/rechnungen/${d4.id}/differenzen/${r.daten.differenzen[0].id}`, { status: 'erledigt' });
      assert.deepEqual([r.status, r.daten.ueberzahlung], [200, 0]);
      assert.equal((await c.buero.get('/faelligkeiten')).daten.offenGesamt.ueberzahlung, 0);
      // Gutschrift: kein Abgleich mit Differenzen
      const g5 = await neu(B, { nr: 'AB-5', typ: 'gutschrift', datum: '2026-05-25', netto: 100 });
      assert.equal((await c.buero.post(`/rechnungen/${g5.id}/bezahlt`, { betrag: 100, differenzen: [{ grund: 'spesen', betrag: 20, status: 'akzeptiert' }] })).status, 400);
      // Polier/Mitarbeiter: Fälligkeiten und Offene Posten weiter 403
      for (const x of ['polier', 'mitarbeiter']) for (const pfad of ['/faelligkeiten', '/offene-posten']) assert.equal((await c[x].get(pfad)).status, 403);
    } finally { s.uhr.setze('2026-11-12T09:24:00.000Z'); }
  });

  await t.test('Rechte: Fälligkeiten nur mit preise_sehen – Polier/Mitarbeiter 403 ohne Werte, Bauleiter = Büro', async () => {
    for (const r of ['mitarbeiter', 'polier']) {
      const x = await c[r].get('/faelligkeiten');
      assert.equal(x.status, 403);
      assert.ok(!/\d+[.,]\d\d|F-[A-G]|000\/W26/.test(JSON.stringify(x.daten)), JSON.stringify(x.daten));
      assert.equal((await c[r].get('/rechnungen?typ=regie')).status, 403);
    }
    const bl = (await c.bauleiter.get('/faelligkeiten')).daten, bu = (await c.buero.get('/faelligkeiten')).daten, gf = (await c.gf.get('/faelligkeiten')).daten;
    assert.deepEqual(bl, bu);
    assert.deepEqual(gf, bu);
    // ohne preise_sehen auch der Bauleiter nicht (Recht, nicht Rollenname)
    s.db.lauf("UPDATE rolle_recht SET wert = 0 WHERE rolle = 'bauleiter' AND recht = 'preise_sehen'");
    try { assert.equal((await c.bauleiter.get('/faelligkeiten')).status, 403); } finally { s.db.lauf("UPDATE rolle_recht SET wert = 1 WHERE rolle = 'bauleiter' AND recht = 'preise_sehen'"); }
  });
});
