'use strict';
/**
 * Korrekturen Nachprüfung – Bereich „geld“ (API.md 14.2): Ausgangsrechnungen, Zahlungen, Skonto, Rücklass,
 * Gutschriften, Offene Posten, CSV-Exporte, BMD-OP-/Zahlungsimport, Kennzahlen. Feste Uhr 12.11.2026.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const OP_KOPF = 'Belegnr;Belegdatum;Kontobezeichnung;Betrag;Offen;Fällig;Zahlungsdatum\r\n';
const ZA_KOPF = 'Belegnr;Zahlungsdatum;Betrag\r\n';
/** CSV-Text → Zeilen (Semikolon, ohne Anführungszeichen in den Testdaten) */
const csvZeilen = (buf) => buf.toString('utf8').replace(/^﻿/, '').trim().split('\r\n').map((z) => z.split(';'));
const zahl = (s) => Number(String(s).replace(',', '.'));

test('Korrekturen Nachprüfung – geld', async (t) => {
  const s = await starte({ sitzung: { feldMin: 60 * 24 * 90, bueroMin: 60 * 24 * 90, maxH: 24 * 120 } });
  t.after(() => s.stop());
  const c = {};
  for (const r of ['mitarbeiter', 'polier', 'buero', 'gf']) c[r] = await s.login(U[r]);
  const neu = async (bs, body) => {
    const r = await c.buero.post(`/baustellen/${bs}/rechnungen`, { typ: 'teil', datum: '2026-11-01', zahlungszielTage: 30, ...body });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    return r.daten;
  };
  const zahle = (id, body) => c.buero.post(`/rechnungen/${id}/zahlungen`, { datum: '2026-11-10', ...body });
  const imp = (datei, extra = {}) => c.buero.post('/import/bmd-op', { dateiBase64: b64(datei), dateiname: 'test.csv', ...extra });
  const zahlungen = (id) => s.db.alle('SELECT datum, betrag FROM rechnung_zahlung WHERE rechnung_id = ? ORDER BY id', id).map((z) => [z.datum, z.betrag]);
  const anzahlZahlungen = () => s.db.eins('SELECT COUNT(*) AS n FROM rechnung_zahlung').n;

  await t.test('N-018: Halbcent wird kaufmännisch aufgerundet (Rücklass in %, USt 10/13 %); richtige Zahlung schließt die Rechnung', async () => {
    const a = await neu(BS.reisinger, { nr: 'G18-1', typ: 'abschlag', netto: 40000.92, ruecklassArt: 'deckung', ruecklassProzent: 5 });
    assert.deepEqual([a.brutto, a.ruecklass, a.zahlbetrag], [48001.1, 2400.06, 45601.04]);
    const b = await neu(BS.reisinger, { nr: 'G18-2', netto: 83.58, ruecklassArt: 'deckung', ruecklassProzent: 5 });
    assert.deepEqual([b.brutto, b.ruecklass], [100.3, 5.02]);
    assert.equal((await neu(BS.reisinger, { nr: 'G18-3', typ: 'regie', netto: 10242.15, ustSatz: 10 })).ust, 1024.22);
    assert.equal((await neu(BS.reisinger, { nr: 'G18-4', typ: 'regie', netto: 10005.5, ustSatz: 13 })).ust, 1300.72);
    let r = await zahle(a.id, { betrag: 45601.04 });
    assert.equal(r.status, 201);
    assert.deepEqual([r.daten.offen, r.daten.status], [0, 'bezahlt']);
    r = await zahle(a.id, { betrag: 2400.06, ruecklass: true });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    assert.equal(r.daten.ruecklassOffen, 0);
  });

  await t.test('N-107: Rücklass größer als brutto → 400 (POST und PUT)', async () => {
    let r = await c.buero.post(`/baustellen/${BS.pitten}/rechnungen`, { nr: 'G107-1', typ: 'abschlag', datum: '2026-11-01', netto: 2500, ruecklassArt: 'deckung', ruecklassBetrag: 4000 });
    assert.equal(r.status, 400);
    assert.match(r.daten.fehler, /Rücklass.*höher als der Bruttobetrag/);
    assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM rechnung WHERE nr = 'G107-1'").n, 0);
    const x = await neu(BS.pitten, { nr: 'G107-2', typ: 'abschlag', netto: 2500, ruecklassArt: 'deckung', ruecklassBetrag: 300 });
    r = await c.buero.put(`/rechnungen/${x.id}`, { version: x.version, ruecklassBetrag: 3000.01 });
    assert.equal(r.status, 400);
    r = await c.buero.put(`/rechnungen/${x.id}`, { version: x.version, ruecklassBetrag: 3000 });
    assert.equal(r.status, 200);
    assert.deepEqual([r.daten.zahlbetrag, r.daten.status], [0, 'bezahlt']); // genau brutto bleibt erlaubt
  });

  await t.test('N-055: Skonto höchstens Skontosatz × Zahlbetrag, ohne Skontosatz gar nicht', async () => {
    const x = await neu(BS.pitten, { nr: 'G55-1', netto: 10000, skontoProzent: 2, skontoTage: 14 });
    assert.equal(x.zahlbetrag, 12000);
    let r = await zahle(x.id, { betrag: 7000, skonto: 5000 });
    assert.equal(r.status, 400);
    assert.match(r.daten.fehler, /Skonto ist zu hoch – höchstens 240,00/);
    r = await zahle(x.id, { betrag: 5880, skonto: 120 });
    assert.equal(r.status, 201);
    assert.equal((await zahle(x.id, { betrag: 5000, skonto: 120.01 })).status, 400); // zusammen über 240
    r = await zahle(x.id, { betrag: 5880, skonto: 120 });
    assert.deepEqual([r.status, r.daten.offen, r.daten.skontoGenommen], [201, 0, 240]);
    const y = await neu(BS.pitten, { nr: 'G55-2', netto: 1000, skontoProzent: 3, skontoTage: 14 });
    r = await c.buero.put(`/rechnungen/${y.id}`, { version: y.version, skontoProzent: null });
    assert.equal(r.status, 200);
    assert.equal(r.daten.skontoBis, '2026-11-15'); // Frist allein gesetzt
    r = await zahle(y.id, { betrag: 1100, skonto: 100 });
    assert.equal(r.status, 400);
    assert.match(r.daten.fehler, /kein Skonto/);
  });

  await t.test('N-108: nach Zahlungen sind Rechnungsdatum, Skonto und der Wechsel zu/von Gutschrift gesperrt (409)', async () => {
    const x = await neu(BS.pitten, { nr: 'G108-1', netto: 1000, skontoProzent: 2, skontoTage: 14 });
    assert.equal((await zahle(x.id, { betrag: 100 })).status, 201);
    for (const body of [{ typ: 'gutschrift' }, { datum: '2026-09-01' }, { skontoProzent: null, skontoTage: null }, { skontoTage: 20 }]) {
      const r = await c.buero.put(`/rechnungen/${x.id}`, { version: x.version, ...body });
      assert.equal(r.status, 409, JSON.stringify(body));
      assert.match(r.daten.fehler, /gesperrt/);
    }
    // unveränderte Werte und harmlose Felder bleiben änderbar
    let r = await c.buero.put(`/rechnungen/${x.id}`, { version: x.version, datum: x.datum, skontoProzent: 2, skontoTage: 14, typ: 'abschlag', notiz: 'ok' });
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    const g = await neu(BS.pitten, { nr: 'G108-2', typ: 'gutschrift', netto: 100 });
    assert.equal((await zahle(g.id, { betrag: 10 })).status, 201);
    r = await c.buero.put(`/rechnungen/${g.id}`, { version: g.version, typ: 'teil' });
    assert.equal(r.status, 409);
  });

  await t.test('N-019: Gutschrift ohne Rücklass (400); Alt-Gutschrift mit Rücklass zählt in Summen negativ', async () => {
    let r = await c.buero.post(`/baustellen/${BS.kogler}/rechnungen`, { nr: 'G19-1', typ: 'gutschrift', datum: '2026-11-01', netto: 1000, ruecklassArt: 'deckung', ruecklassProzent: 5 });
    assert.equal(r.status, 400);
    assert.match(r.daten.fehler, /Gutschrift hat keinen Rücklass/);
    const x = await neu(BS.kogler, { nr: 'G19-2', netto: 1000, ruecklassArt: 'deckung', ruecklassProzent: 5 });
    assert.equal((await c.buero.put(`/rechnungen/${x.id}`, { version: x.version, typ: 'gutschrift' })).status, 400);
    const vorOp = (await c.buero.get('/offene-posten')).daten.ruecklaesseOffen;
    const vorK = (await c.buero.get(`/kalkulation/${BS.kogler}`)).daten.rechnungen.ruecklassOffen;
    // Altbestand (vor der Prüfung angelegt): Gutschrift mit 5 % Rücklass = 60
    s.db.lauf("INSERT INTO rechnung (baustelle_id, nr, nr_norm, typ, datum, netto, ruecklass_art, ruecklass_prozent, erstellt) VALUES (?, 'G19-ALT', 'g19alt', 'gutschrift', '2026-11-01', 1000, 'deckung', 5, '2026-11-01T08:00:00Z')", BS.kogler);
    assert.equal((await c.buero.get('/offene-posten')).daten.ruecklaesseOffen, Math.round((vorOp - 60) * 100) / 100);
    assert.equal((await c.buero.get(`/kalkulation/${BS.kogler}`)).daten.rechnungen.ruecklassOffen, Math.round((vorK - 60) * 100) / 100);
    assert.equal((await c.buero.get(`/baustellen/${BS.kogler}/positionen`)).daten.rechnungen.ruecklassOffen, Math.round((vorK - 60) * 100) / 100);
    const zeile = csvZeilen((await c.buero.get('/offene-posten.csv')).daten).find((z) => z[0] === 'G19-ALT' && z[1] === 'Rücklass');
    assert.equal(zeile[10], '-60');
    s.db.lauf("DELETE FROM rechnung WHERE nr = 'G19-ALT'");
  });

  await t.test('N-054: Nachkalkulation „bezahlt“ = Σ Zahlungen ohne Skonto; Skonto und Rücklass-Zahlungen getrennt', async () => {
    const x = await neu(BS.breitenau, { nr: 'G54-1', netto: 1000, skontoProzent: 2, skontoTage: 14, ruecklassArt: 'haft', ruecklassBetrag: 200 });
    assert.equal((await zahle(x.id, { betrag: 900, skonto: 10 })).status, 201);
    assert.equal((await zahle(x.id, { betrag: 150, ruecklass: true })).status, 201);
    const g = await neu(BS.breitenau, { nr: 'G54-G', typ: 'gutschrift', netto: 100 });
    assert.equal((await zahle(g.id, { betrag: 50 })).status, 201);
    const k = (await c.buero.get(`/kalkulation/${BS.breitenau}`)).daten.rechnungen;
    assert.deepEqual(k, { verrechnetNetto: 900, bezahlt: 850, skontoGenommen: 10, offen: 20, ruecklassOffen: 50, ruecklassBezahlt: 150 });
    assert.deepEqual((await c.buero.get(`/baustellen/${BS.breitenau}/positionen`)).daten.rechnungen, k);
  });

  await t.test('N-053: Storno nur ohne Zahlungen; Zahlung einer stornierten Rechnung nicht löschbar; Zahlungs-CSV ohne Storno', async () => {
    const x = await neu(BS.ternitz, { nr: 'G53-1', typ: 'regie', netto: 100 });
    const z = (await zahle(x.id, { betrag: 120 })).daten.zahlungId;
    let r = await c.buero.post(`/rechnungen/${x.id}/storno`, { grund: 'Fehler' });
    assert.equal(r.status, 409);
    assert.match(r.daten.fehler, /zuerst die Zahlungen löschen/);
    assert.equal((await c.buero.get(`/kalkulation/${BS.ternitz}`)).daten.rechnungen.bezahlt, 120);
    assert.equal((await c.buero.del(`/rechnungen/${x.id}/zahlungen/${z}`)).status, 200);
    assert.equal((await c.buero.post(`/rechnungen/${x.id}/storno`, { grund: 'Fehler' })).status, 200);
    // Altbestand: Zahlung auf einer schon stornierten Rechnung
    const alt = await neu(BS.ternitz, { nr: 'G53-ALT', typ: 'regie', netto: 100 });
    const za = (await zahle(alt.id, { betrag: 33.33 })).daten.zahlungId;
    s.db.lauf("UPDATE rechnung SET storniert = '2026-11-11T08:00:00Z', storniert_grund = 'alt' WHERE id = ?", alt.id);
    assert.equal((await c.buero.del(`/rechnungen/${alt.id}/zahlungen/${za}`)).status, 409);
    const csv = (await c.buero.get('/zahlungseingaenge.csv?von=2026-11-01&bis=2026-11-12')).daten.toString('utf8');
    assert.ok(!csv.includes('G53-ALT'), csv);
  });

  await t.test('N-052: CSV-Exporte – Gutschriften negativ, Summenzeilen gleich den Summen im JSON', async () => {
    const g = await neu(BS.gloggnitz, { nr: 'G52-G', typ: 'gutschrift', netto: 950 });
    assert.equal((await zahle(g.id, { betrag: 500, notiz: 'Auszahlung' })).status, 201);
    const op = (await c.buero.get('/offene-posten')).daten;
    const z = csvZeilen((await c.buero.get('/offene-posten.csv')).daten);
    const gz = z.find((x) => x[0] === 'G52-G');
    assert.deepEqual([gz[1], gz[7], gz[8], gz[9], gz[10]], ['Gutschrift', '-1140', '-1140', '-500', '-640']);
    const posten = z.slice(1).filter((x) => op.posten.some((p) => p.nr === x[0]) && x[1] !== 'Rücklass');
    const spalte = Math.round(posten.reduce((a, x) => a + zahl(x[10]), 0) * 100) / 100;
    assert.equal(spalte, op.summeOffen);
    const summe = z.find((x) => x[0] === 'Summe offene Rechnungen');
    assert.equal(zahl(summe[10]), op.summeOffen);
    assert.equal(zahl(z.find((x) => x[0] === 'Summe offene Rücklässe')[10]), op.ruecklaesseOffen);
    const zz = csvZeilen((await c.buero.get('/zahlungseingaenge.csv?von=2026-11-01&bis=2026-11-12')).daten);
    const gzahl = zz.find((x) => x[1] === 'G52-G');
    assert.deepEqual([gzahl[5], gzahl[10]], ['-500', 'Gutschrift']);
    const zs = zz.find((x) => x[0] === 'Summe');
    const erwartet = Math.round(zz.slice(1, -1).reduce((a, x) => a + zahl(x[5]), 0) * 100) / 100;
    assert.equal(zahl(zs[5]), erwartet);
  });

  await t.test('N-106: Gutschrift wird nie überfällig und nicht gemahnt; zählt nicht für „alles bezahlt“', async () => {
    const g = await neu(BS.neustadt, { nr: 'G106-G', typ: 'gutschrift', datum: '2026-10-20', netto: 950, zahlungszielTage: 14 });
    assert.deepEqual([g.status, g.ueberfaelligTage], ['offen', 0]);
    const r = await c.buero.post(`/rechnungen/${g.id}/mahnungen`, { stufe: 1 });
    assert.equal(r.status, 409);
    assert.match(r.daten.fehler, /Gutschriften werden nicht gemahnt/);
    const op = (await c.buero.get('/offene-posten')).daten;
    assert.ok(!op.posten.find((p) => p.nr === 'G106-G' && p.status === 'ueberfaellig'));
    assert.ok(op.summeUeberfaellig >= 0, `summeUeberfaellig ${op.summeUeberfaellig}`);
    // Schlussrechnung bezahlt, Gutschrift offen → Vorschlag „bezahlt“
    const sr = await neu(BS.neustadt, { nr: 'G106-S', typ: 'schluss', netto: 1000 });
    const v = () => s.db.eins('SELECT version FROM baustelle WHERE id = ?', BS.neustadt).version;
    for (const body of [{ phase: 'fertiggestellt' }, { phase: 'abgenommen', abnahmeDatum: '2026-11-05' }, { phase: 'schlussrechnung' }]) assert.equal((await c.buero.post(`/baustellen/${BS.neustadt}/phase`, { version: v(), ...body })).status, 200);
    assert.equal((await zahle(sr.id, { betrag: 1200 })).status, 201);
    assert.equal(((await c.buero.get(`/baustellen/${BS.neustadt}`)).daten.phaseVorschlag || {}).phase, 'bezahlt');
  });

  await t.test('N-057: offeneSchlussrechnungen.summe aus den erfassten Schlussrechnungen (offen), Phasen-Betrag nur als Ersatz', async () => {
    const v = () => s.db.eins('SELECT version FROM baustelle WHERE id = ?', BS.pitten).version;
    const sr = await neu(BS.pitten, { nr: 'G57-S', typ: 'schluss', netto: 1000 });
    for (const body of [{ phase: 'fertiggestellt' }, { phase: 'abgenommen', abnahmeDatum: '2026-11-05' }, { phase: 'schlussrechnung', schlussrechnung: { nr: 'G57-S' } }]) assert.equal((await c.buero.post(`/baustellen/${BS.pitten}/phase`, { version: v(), ...body })).status, 200);
    // Neustadt: Schlussrechnung erfasst und bezahlt (0 offen) → trägt 0 bei
    let k = (await c.buero.get('/baustellen-kennzahlen')).daten.offeneSchlussrechnungen;
    assert.deepEqual(k, { anzahl: 2, summe: 1200 });
    assert.equal((await zahle(sr.id, { betrag: 200 })).status, 201);
    k = (await c.buero.get('/baustellen-kennzahlen')).daten.offeneSchlussrechnungen;
    assert.equal(k.summe, 1000);
    // ohne erfasste Schlussrechnung: Phasen-Betrag
    s.db.lauf("UPDATE baustelle SET schlussrechnung = '{\"nr\":\"X\",\"betrag\":120}' WHERE id = ?", BS.neustadt);
    s.db.lauf("UPDATE rechnung SET typ = 'teil' WHERE nr = 'G106-S'");
    assert.equal((await c.buero.get('/baustellen-kennzahlen')).daten.offeneSchlussrechnungen.summe, 1120);
  });

  await t.test('N-111: Phasen-Notiz nur mit Preisrecht für die Baustelle', async () => {
    const v = () => s.db.eins('SELECT version FROM baustelle WHERE id = ?', BS.kogler).version;
    assert.equal((await c.buero.post(`/baustellen/${BS.kogler}/phase`, { version: v(), phase: 'pausiert', notiz: 'FREITEXT 48.500,00 €' })).status, 200);
    const b = (await c.buero.get(`/baustellen/${BS.kogler}/phasen`)).daten;
    assert.ok(b.some((p) => p.notiz === 'FREITEXT 48.500,00 €'));
    s.db.lauf('UPDATE baustelle SET polier_id = ? WHERE id = ?', U.polier, BS.kogler);
    const p = await c.polier.get(`/baustellen/${BS.kogler}/phasen`);
    assert.equal(p.status, 200);
    assert.ok(p.daten.length >= 1);
    assert.ok(!JSON.stringify(p.daten).includes('FREITEXT') && p.daten.every((x) => !('notiz' in x)), JSON.stringify(p.daten));
    s.db.lauf('UPDATE baustelle SET polier_id = 8 WHERE id = ?', BS.kogler);
  });

  await t.test('N-001/N-003: Belegnummer mehrfach in der OP-Datei → Fehlerzeile, nichts gebucht, erneuter Import idempotent', async () => {
    const a = await neu(BS.reisinger, { nr: 'AR-2026-301', netto: 1000 });
    const b = await neu(BS.reisinger, { nr: 'AR-2026-302', netto: 1000 });
    const datei = OP_KOPF + 'AR-2026-301;01.11.2026;Kunde;1.200,00;600,00;01.12.2026;\r\nAR-2026-301;01.11.2026;Kunde;1.200,00;400,00;01.12.2026;\r\n'
      + 'AR-2026-302;01.11.2026;Kunde;1.200,00;200,00;01.12.2026;\r\nAR 2026 302;01.11.2026;Kunde;1.200,00;200,00;01.12.2026;\r\n';
    const vor = anzahlZahlungen();
    let r = await imp(datei, { vorschau: true });
    assert.equal(r.status, 200);
    assert.deepEqual(r.daten.fehler.map((f) => f.zeile), [3, 5]);
    assert.match(r.daten.fehler[0].text, /mehrfach in der Datei \(zuerst in Zeile 2\)/);
    r = await imp(datei, { vorschau: false });
    assert.equal(r.status, 400);
    assert.equal(anzahlZahlungen(), vor);
    // bereinigte Datei: genau die Differenz, ein zweiter Import ändert nichts
    const gut = OP_KOPF + 'AR-2026-301;01.11.2026;Kunde;1.200,00;400,00;01.12.2026;\r\nAR-2026-302;01.11.2026;Kunde;1.200,00;200,00;01.12.2026;\r\n';
    r = await imp(gut, { vorschau: false });
    assert.deepEqual([r.status, r.daten.anzahlBuchungen, r.daten.rechnungenGeaendert], [200, 2, 2]);
    assert.deepEqual([zahlungen(a.id).map((x) => x[1]), zahlungen(b.id).map((x) => x[1])], [[800], [1000]]);
    r = await imp(gut, { vorschau: false });
    assert.deepEqual([r.status, r.daten.fehler.length, r.daten.anzahlBuchungen], [200, 0, 0]);
    assert.equal(anzahlZahlungen(), vor + 2);
  });

  await t.test('N-008: Gutschrift steht in der OP-Liste negativ – voll offen bleibt offen, Teilbetrag wird gebucht, positiv ist ein Fehler', async () => {
    const g = await neu(BS.reisinger, { nr: 'GS-2026-01', typ: 'gutschrift', netto: 500 });
    let r = await imp(OP_KOPF + 'GS-2026-01;01.11.2026;Kunde;-600,00;-600,00;01.12.2026;\r\n', { vorschau: false });
    assert.equal(r.status, 200);
    assert.deepEqual([r.daten.zugeordnet[0].aenderung, r.daten.anzahlBuchungen], [false, 0]);
    assert.deepEqual(zahlungen(g.id), []);
    r = await imp(OP_KOPF + 'GS-2026-01;01.11.2026;Kunde;-600,00;-200,00;01.12.2026;\r\n', { vorschau: false });
    assert.equal(r.status, 200);
    assert.deepEqual(zahlungen(g.id).map((x) => x[1]), [400]);
    assert.equal((await c.buero.get(`/rechnungen/${g.id}`)).daten.offen, 200);
    r = await imp(OP_KOPF + 'GS-2026-01;01.11.2026;Kunde;600,00;200,00;01.12.2026;\r\n', { vorschau: true });
    assert.match(r.daten.fehler[0].text, /Gutschrift mit positivem offenem Betrag/);
    // negativer offener Betrag bei einer Rechnung = Überzahlung → Fehler statt still „bezahlt“
    const x = await neu(BS.reisinger, { nr: 'AR-2026-305', netto: 100 });
    r = await imp(OP_KOPF + 'AR-2026-305;01.11.2026;Kunde;120,00;-30,00;01.12.2026;\r\n', { vorschau: true });
    assert.match(r.daten.fehler[0].text, /negativer offener Betrag/);
    assert.deepEqual(zahlungen(x.id), []);
  });

  await t.test('N-007/N-056/N-024/N-095: Zahlungsimport – keine Überzahlung, Duplikate in der Datei, Vorschau mit alt/neu, Zeilen ohne Belegnr.', async () => {
    const x = await neu(BS.reisinger, { nr: 'AR-2026-303', netto: 1000 });
    let r = await imp(ZA_KOPF + 'AR-2026-303;10.11.2026;5.000,00\r\nAR-2026-303;11.11.2026;100,00\r\nAR-2026-303;11.11.2026;100,00\r\n', { art: 'zahlungen', vorschau: true });
    assert.equal(r.status, 200);
    assert.deepEqual(r.daten.fehler.map((f) => f.zeile), [2, 4]);
    assert.match(r.daten.fehler[0].text, /übersteigt den offenen Betrag \(1\.200,00\)/);
    assert.match(r.daten.fehler[1].text, /mehrfach in der Datei \(zuerst in Zeile 3\)/);
    assert.equal((await imp(ZA_KOPF + 'AR-2026-303;10.11.2026;5.000,00\r\n', { art: 'zahlungen', vorschau: false })).status, 400);
    assert.deepEqual(zahlungen(x.id), []);
    // mehrere Zahlungen in einer Datei rechnen fortlaufend; die letzte überzieht
    r = await imp(ZA_KOPF + 'AR-2026-303;10.11.2026;700,00\r\nAR-2026-303;11.11.2026;500,00\r\nAR-2026-303;12.11.2026;0,01\r\n', { art: 'zahlungen', vorschau: true });
    assert.deepEqual(r.daten.fehler.map((f) => f.zeile), [4]);
    const datei = ZA_KOPF + 'AR-2026-303;10.11.2026;700,00\r\n;;1.200,00\r\nAR-2026-303;11.11.2026;500,00\r\nUNBEKANNT-1;11.11.2026;99,00\r\n';
    r = await imp(datei, { art: 'zahlungen', vorschau: true });
    assert.equal(r.daten.art, 'zahlungen');
    assert.deepEqual(r.daten.zugeordnet.map((z) => [z.zeile, z.betrag, z.datum, z.alt.offen, z.neu.offen, z.neu.status, z.aenderung]),
      [[2, 700, '2026-11-10', 1200, 500, 'teilbezahlt', true], [4, 500, '2026-11-11', 500, 0, 'bezahlt', true]]);
    assert.deepEqual(r.daten.uebersprungen.map((u) => u.zeile), [3]);
    assert.deepEqual(r.daten.unbekannt.map((u) => [u.belegnr, u.betrag]), [['UNBEKANNT-1', 99]]);
    assert.equal(r.daten.zugeordnet.length + r.daten.unbekannt.length + r.daten.fehler.length + r.daten.uebersprungen.length, r.daten.zeilen); // „n Zeilen gelesen“ geht auf
    r = await imp(datei, { art: 'zahlungen', vorschau: false });
    assert.deepEqual([r.status, r.daten.anzahlBuchungen, r.daten.rechnungenGeaendert], [200, 2, 1]);
    assert.deepEqual(zahlungen(x.id), [['2026-11-10', 700], ['2026-11-11', 500]]);
    r = await imp(datei, { art: 'zahlungen', vorschau: false }); // erneut: Duplikate aus der Datenbank, nichts neu
    assert.deepEqual([r.status, r.daten.anzahlBuchungen, r.daten.zugeordnet.map((z) => z.bereitsGebucht)], [200, 0, [true, true]]);
    assert.equal(zahlungen(x.id).length, 2);
  });

  await t.test('Rechte unverändert: Polier/Mitarbeiter kommen an keinen der Wege', async () => {
    for (const r of ['polier', 'mitarbeiter']) {
      assert.equal((await c[r].get('/offene-posten.csv')).status, 403);
      assert.equal((await c[r].get('/zahlungseingaenge.csv')).status, 403);
      assert.equal((await c[r].post('/import/bmd-op', { dateiBase64: b64(OP_KOPF), vorschau: true })).status, 403);
      assert.equal((await c[r].get('/baustellen-kennzahlen')).status, 403);
    }
  });
});
