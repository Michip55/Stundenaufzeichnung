'use strict';
/** Ausgangsrechnungen, Zahlungen, Offene Posten (API.md 12.17) – feste Uhr 12.11.2026 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS, euroFelder } = require('./hilfe');

test('Ausgangsrechnungen', async (t) => {
  const s = await starte({ sitzung: { feldMin: 60 * 24 * 90, bueroMin: 60 * 24 * 90, maxH: 24 * 120 } });
  t.after(() => s.stop());
  const c = {};
  for (const r of ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf']) c[r] = await s.login(U[r]);
  let r1, r2;

  await t.test('Rechte: Polier/Mitarbeiter 403, Bauleiter wie Büro (13.11.2026)', async () => {
    for (const r of ['mitarbeiter', 'polier']) {
      assert.equal((await c[r].get('/rechnungen')).status, 403);
      assert.equal((await c[r].get('/offene-posten')).status, 403);
      assert.equal((await c[r].post(`/baustellen/${BS.pitten}/rechnungen`, { nr: 'X', typ: 'teil', datum: '2026-11-01', netto: 1 })).status, 403);
    }
    assert.equal((await c.bauleiter.post(`/baustellen/${BS.pitten}/rechnungen`, { nr: 'X', typ: 'quatsch', datum: '2026-11-01', netto: 1 })).status, 400); // darf schreiben, nur ungültig
  });

  await t.test('Berechnung: USt, Haftrücklass, Fälligkeit, Skontofrist (Rundung je Schritt)', async () => {
    let r = await c.buero.post(`/baustellen/${BS.pitten}/rechnungen`, { nr: 'AR 2026/101', typ: 'abschlag', datum: '2026-10-01', leistungVon: '2026-09-01', leistungBis: '2026-09-30', netto: 10000.005, zahlungszielTage: 30, skontoProzent: 2, skontoTage: 14, ruecklassArt: 'deckung', ruecklassProzent: 5 });
    assert.equal(r.status, 201);
    r1 = r.daten;
    assert.deepEqual([r1.netto, r1.ust, r1.brutto, r1.ruecklass, r1.zahlbetrag, r1.faellig, r1.skontoBis], [10000.01, 2000, 12000.01, 600, 11400.01, '2026-10-31', '2026-10-15']);
    assert.equal(r1.status, 'ueberfaellig');
    assert.equal(r1.ueberfaelligTage, 12);
    assert.equal((await c.buero.post(`/baustellen/${BS.pitten}/rechnungen`, { nr: 'ar-2026-101', typ: 'teil', datum: '2026-10-01', netto: 5 })).status, 409); // gleiche Nr. (normalisiert)
    r = await c.buero.post(`/baustellen/${BS.kogler}/rechnungen`, { nr: 'AR 2026/102', typ: 'schluss', datum: '2026-11-05', netto: 50000, ustModus: 'reverse_charge', zahlungszielTage: 30, ruecklassArt: 'haft', ruecklassBetrag: 1500 });
    r2 = r.daten;
    assert.deepEqual([r2.ust, r2.brutto, r2.ruecklass, r2.zahlbetrag, r2.status], [0, 50000, 1500, 48500, 'offen']);
  });

  await t.test('Zahlungen: Teilzahlung, Skonto nur in Frist, Überzahlung, Rücklass separat', async () => {
    let r = await c.buero.post(`/rechnungen/${r1.id}/zahlungen`, { datum: '2026-10-20', betrag: 5000, skonto: 100 });
    assert.equal(r.status, 400); // Skontofrist vorbei
    r = await c.buero.post(`/rechnungen/${r1.id}/zahlungen`, { datum: '2026-10-14', betrag: 11172.01, skonto: 228 });
    assert.equal(r.status, 201);
    assert.deepEqual([r.daten.bezahlt, r.daten.skontoGenommen, r.daten.offen, r.daten.status], [11172.01, 228, 0, 'bezahlt']);
    assert.equal((await c.buero.post(`/rechnungen/${r1.id}/zahlungen`, { datum: '2026-11-01', betrag: 1 })).status, 400);
    r = await c.buero.post(`/rechnungen/${r2.id}/zahlungen`, { datum: '2026-11-10', betrag: 20000.004 });
    assert.deepEqual([r.daten.bezahlt, r.daten.offen, r.daten.status], [20000, 28500, 'teilbezahlt']);
    assert.equal((await c.buero.post(`/rechnungen/${r2.id}/zahlungen`, { datum: '2026-11-10', betrag: 2000, ruecklass: true })).status, 400); // mehr als Rücklass
    // nach Zahlungen: Betrag gesperrt
    assert.equal((await c.buero.put(`/rechnungen/${r2.id}`, { version: r2.version, netto: 1 })).status, 409);
  });

  await t.test('Bauleiter liest alle (wie Büro); €-Schutz', async () => {
    const l = (await c.bauleiter.get('/rechnungen')).daten;
    assert.ok(l.some((x) => x.id === r1.id) && l.some((x) => x.id === r2.id));
    assert.equal((await c.bauleiter.put(`/rechnungen/${r2.id}`, { version: 9999, notiz: 'x' })).status, 409); // darf schreiben (veraltete Version)
    s.db.lauf("UPDATE rolle_recht SET wert = 0 WHERE rolle = 'bauleiter' AND recht = 'preise_sehen'");
    try {
      assert.equal((await c.bauleiter.get(`/rechnungen/${r1.id}`)).status, 403);
      const k = (await c.bauleiter.get(`/baustellen/${BS.pitten}`)).daten;
      assert.ok(!('auftragssumme' in k) && !('schlussrechnung' in k));
      assert.ok(!('rechnungen' in (await c.bauleiter.get(`/kalkulation/${BS.pitten}`)).daten));
    } finally { s.db.lauf("UPDATE rolle_recht SET wert = 1 WHERE rolle = 'bauleiter' AND recht = 'preise_sehen'"); }
    for (const r of ['polier', 'mitarbeiter']) assert.deepEqual(euroFelder((await c[r].get(`/baustellen/${BS.kogler}`)).daten), [], r);
  });

  await t.test('Offene Posten, CSV, Nachkalkulation verrechnet/bezahlt, Vorschlag Phase', async () => {
    const op = (await c.buero.get('/offene-posten')).daten;
    assert.equal(op.summeOffen, 28500);
    assert.equal(op.anzahlOffen, 1);
    assert.equal(op.ruecklaesseOffen, 600 + 1500);
    assert.equal(op.zahlungsdauerTage, 13);
    assert.ok(op.jeAuftraggeber.length >= 1);
    const csv = await c.buero.get('/offene-posten.csv');
    const text = csv.daten.toString('utf8');
    assert.match(text, /^﻿Rechnungs-Nr\.;Art;KST/);
    assert.match(text, /AR 2026\/102;Schlussrechnung;26-038;.*;28500;/);
    const zcsv = (await c.buero.get('/zahlungseingaenge.csv?von=2026-10-01&bis=2026-11-12')).daten.toString('utf8');
    assert.match(zcsv, /14\.10\.2026;AR 2026\/101;26-041;.*;11172,01;228;nein;manuell/);
    const k = (await c.buero.get(`/kalkulation/${BS.kogler}`)).daten;
    assert.deepEqual(k.rechnungen, { verrechnetNetto: 50000, bezahlt: 20000, skontoGenommen: 0, offen: 28500, ruecklassOffen: 1500, ruecklassBezahlt: 0 });
    // Phase-Vorschlag: Schlussrechnung erfasst → Kogler ab „abgenommen“
    const bs = () => s.db.eins('SELECT version FROM baustelle WHERE id = ?', BS.kogler).version;
    await c.buero.post(`/baustellen/${BS.kogler}/phase`, { version: bs(), phase: 'fertiggestellt' });
    await c.buero.post(`/baustellen/${BS.kogler}/phase`, { version: bs(), phase: 'abgenommen', abnahmeDatum: '2026-11-04' });
    assert.deepEqual((await c.buero.get(`/baustellen/${BS.kogler}`)).daten.phaseVorschlag.phase, 'schlussrechnung');
    await c.buero.post(`/baustellen/${BS.kogler}/phase`, { version: bs(), phase: 'schlussrechnung' });
    await c.buero.post(`/rechnungen/${r2.id}/zahlungen`, { datum: '2026-11-12', betrag: 28500 });
    assert.equal((await c.buero.get(`/baustellen/${BS.kogler}`)).daten.phaseVorschlag.phase, 'bezahlt');
  });

  await t.test('Fällig/Mahnstufen: Erinnerungen je Stufe einmal (feste Uhr)', async () => {
    const r = await c.buero.post(`/baustellen/${BS.pitten}/rechnungen`, { nr: 'AR 2026/150', typ: 'teil', datum: '2026-11-01', netto: 1000, zahlungszielTage: 14 });
    const id = r.daten.id;
    const meld = (re) => s.db.alle("SELECT * FROM benachrichtigung WHERE typ = 'rechnung' AND benutzer_id = ? ORDER BY id", U.buero).filter((m) => re.test(m.titel));
    s.app.bt.stuendlich();
    assert.equal(meld(/AR 2026\/150 fällig/).length, 0); // fällig am 15.11.
    s.uhr.setze('2026-11-16T08:00:00Z');
    s.app.bt.stuendlich(); s.app.bt.stuendlich();
    assert.equal(meld(/AR 2026\/150 fällig/).length, 1);
    assert.ok(!/€/.test(meld(/AR 2026\/150 fällig/)[0].text));
    s.uhr.setze('2026-11-30T08:00:00Z');
    s.app.bt.stuendlich(); s.app.bt.stuendlich();
    assert.equal(meld(/Zahlungserinnerung vorschlagen: Rechnung AR 2026\/150/).length, 1);
    assert.equal((await c.buero.post(`/rechnungen/${id}/mahnungen`, { stufe: 1, datum: '2026-11-30' })).status, 201);
    assert.equal((await c.buero.post(`/rechnungen/${id}/mahnungen`, { stufe: 1 })).status, 409);
    s.uhr.setze('2026-12-14T08:00:00Z');
    s.app.bt.stuendlich();
    assert.equal(meld(/1\. Mahnung vorschlagen/).length, 1);
    assert.equal(meld(/2\. Mahnung vorschlagen/).length, 0);
    const j = (await c.buero.get(`/rechnungen/${id}`)).daten;
    assert.deepEqual([j.mahnstufe, j.status, j.ueberfaelligTage], [1, 'ueberfaellig', 29]);
    assert.equal(meld(/Gutschrift/).length, 0);
    // Storno
    assert.equal((await c.buero.post(`/rechnungen/${id}/storno`, { grund: 'falsch' })).daten.status, 'storniert');
    s.uhr.setze('2026-11-12T09:24:00Z');
  });
});
