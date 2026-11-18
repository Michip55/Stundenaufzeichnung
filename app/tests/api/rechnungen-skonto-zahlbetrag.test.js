'use strict';
/**
 * Zahlbetrag mit Skonto (API.md 15.26, Inhaber 18.11.2026): Skonto als „zahlbar bis … abzgl. Skonto € …“ eintragen.
 * Beispiel wie auf einer Auer-Rechnung: Brutto 48.000,00, Deckungsrücklass 3 % = 1.440,00, Zahlbetrag 46.560,00,
 * 3 % Skonto = 1.396,80 → Zahlbetrag mit Skonto 45.163,20.
 * - Migration 51: bestehende Rechnungen unverändert
 * - gespeichert: der eingetragene Betrag (skonto_zahlbetrag) und das gerechnete Skonto in € (skonto_betrag); Prozent gerechnet
 * - Prüfungen (> 0, < Zahlbetrag, höchstens 10 %, nur eine Skonto-Angabe, Frist), Bearbeiten hin und zurück, Rundung
 * - Zahlung/Fälligkeiten rechnen mit dem Skonto, nach Zahlungen gesperrt; Polier/Mitarbeiter sehen nichts davon
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Datenbank } = require('../../server/db');
const R = require('../../server/rechnungen');
const { entferneEuroFelder, findeEuroFelder } = require('../../server/rechte');
const { starte, U, BS } = require('./hilfe');

test('Migration 51: bestehende Rechnungen bleiben unverändert (kein „Zahlbetrag mit Skonto“)', () => {
  const db = new Datenbank(':memory:', { bisVersion: 50 });
  const bs = db.lauf("INSERT INTO baustelle (kst, name, erstellt) VALUES ('M-51', 'Migration', '2026-01-01T00:00:00Z')").id;
  const neu = (nr, p, b) => db.lauf("INSERT INTO rechnung (baustelle_id, nr, nr_norm, typ, datum, netto, skonto_prozent, skonto_betrag, skonto_tage, erstellt) VALUES (?, ?, ?, 'abschlag', '2026-11-01', 1000, ?, ?, 14, '2026-11-01T08:00:00Z')", bs, nr, nr.toLowerCase(), p, b).id;
  const p = neu('M51P', 3, null), b = neu('M51B', null, 25), o = neu('M51O', null, null);
  db.migrieren();
  assert.ok(db.alle('PRAGMA table_info(rechnung)').some((c) => c.name === 'skonto_zahlbetrag'));
  const j = (id) => R.rechnungJson(db, db.eins('SELECT * FROM rechnung WHERE id = ?', id), new Map());
  assert.deepEqual([j(p).skontoEingabe, j(p).skontoBetrag, j(p).skontoProzent, j(p).zahlbetragMitSkonto], ['prozent', 36, 3, 1164]);
  assert.deepEqual([j(b).skontoEingabe, j(b).skontoBetrag, j(b).skontoProzent, j(b).zahlbetragMitSkonto], ['betrag', 25, 2.083, 1175]);
  assert.deepEqual([j(o).skontoEingabe, j(o).skontoBetrag, j(o).zahlbetragMitSkonto], [null, 0, null]);
  assert.equal(db.eins('SELECT COUNT(*) AS n FROM rechnung WHERE skonto_zahlbetrag IS NOT NULL').n, 0);
});

test('Zahlbetrag mit Skonto (15.26)', async (t) => {
  const s = await starte({ sitzung: { feldMin: 60 * 24 * 400, bueroMin: 60 * 24 * 400, maxH: 24 * 400 } });
  t.after(() => s.stop());
  const c = {};
  for (const r of ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf']) c[r] = await s.login(U[r]);
  const AUER = { typ: 'teil', datum: '2026-11-18', netto: 40000, ustModus: 'normal', ustBetrag: 8000, brutto: 48000, deckungProzent: 3, zahlungszielTage: 30, skontoTage: 14 };
  const neu = async (body, status = 201) => {
    const r = await c.buero.post(`/baustellen/${BS.reisinger}/rechnungen`, { ...AUER, ...body });
    assert.equal(r.status, status, JSON.stringify(r.daten));
    return r.daten;
  };
  const zeile = (id) => ({ ...s.db.eins('SELECT skonto_prozent AS p, skonto_betrag AS b, skonto_zahlbetrag AS z FROM rechnung WHERE id = ?', id) });

  await t.test('Auer-Beispiel: 46.560,00 Zahlbetrag, Papier 45.163,20 → Skonto 1.396,80 = 3 %', async () => {
    const r = await neu({ nr: 'ZS-1', skontoZahlbetrag: 45163.2 });
    assert.deepEqual([r.brutto, r.deckungsruecklass.betrag, r.zahlbetrag], [48000, 1440, 46560]);
    assert.deepEqual([r.skontoEingabe, r.skontoBetrag, r.skontoProzent, r.zahlbetragMitSkonto, r.skontoBis, r.faellig], ['zahlbetrag', 1396.8, 3, 45163.2, '2026-12-02', '2026-12-18']);
    assert.deepEqual(zeile(r.id), { p: null, b: 1396.8, z: 45163.2 });
    // Fälligkeiten: „mit Skonto € 45.163,20 bis 02.12.“
    s.uhr.setze('2026-11-20T08:00:00Z');
    try {
      const e = (await c.buero.get('/faelligkeiten')).daten.gruppen.flatMap((g) => g.eintraege).find((x) => x.nr === 'ZS-1');
      assert.deepEqual(e.mitSkonto, { betrag: 45163.2, skonto: 1396.8, bis: '2026-12-02', prozent: 3, tage: 14 });
      assert.deepEqual(e.ohneSkonto, { betrag: 46560, bis: '2026-12-18', tage: 30 });
    } finally { s.uhr.setze('2026-11-12T09:24:00.000Z'); }
  });

  await t.test('Rundung: Skonto auf Cent, Prozent mit drei Nachkommastellen', async () => {
    let r = await neu({ nr: 'ZS-R1', skontoZahlbetrag: 45163.25 }); // 1.396,75 / 46.560 = 2,99989 %
    assert.deepEqual([r.skontoBetrag, r.skontoProzent, r.zahlbetragMitSkonto], [1396.75, 3, 45163.25]);
    r = await neu({ nr: 'ZS-R2', skontoZahlbetrag: 45200 }); // 1.360,00 / 46.560 = 2,92096 %
    assert.deepEqual([r.skontoBetrag, r.skontoProzent, r.zahlbetragMitSkonto], [1360, 2.921, 45200]);
    r = await neu({ nr: 'ZS-R3', skontoZahlbetrag: 45630.77 });
    assert.deepEqual([r.skontoBetrag, r.skontoProzent, r.zahlbetragMitSkonto], [929.23, 1.996, 45630.77]);
    r = await neu({ nr: 'ZS-R4', skontoZahlbetrag: 46559.99 }); // 1 Cent Skonto
    assert.deepEqual([r.skontoBetrag, r.zahlbetragMitSkonto], [0.01, 46559.99]);
  });

  await t.test('Prüfungen mit klaren Meldungen', async () => {
    assert.match((await neu({ nr: 'ZS-F1', skontoZahlbetrag: 0 }, 400)).fehler, /größer als 0/);
    assert.match((await neu({ nr: 'ZS-F2', skontoZahlbetrag: 46560 }, 400)).fehler, /muss kleiner sein als der Zahlbetrag \(46\.560,00\)/);
    assert.match((await neu({ nr: 'ZS-F3', skontoZahlbetrag: 48000 }, 400)).fehler, /muss kleiner sein als der Zahlbetrag/); // Brutto statt Zahlbetrag abgeschrieben
    assert.match((await neu({ nr: 'ZS-F4', skontoZahlbetrag: 41000 }, 400)).fehler, /ergibt ein Skonto von 5\.560,00 \(11,942 %\) – mehr als 10 %/);
    assert.match((await neu({ nr: 'ZS-F5', skontoZahlbetrag: 45163.2, skontoProzent: 3 }, 400)).fehler, /nur eines davon/);
    assert.match((await neu({ nr: 'ZS-F6', skontoZahlbetrag: 45163.2, skontoBetrag: 1396.8 }, 400)).fehler, /nur eines davon/);
    assert.match((await neu({ nr: 'ZS-F7', skontoZahlbetrag: 45163.2, skontoTage: null }, 400)).fehler, /Frist gemeinsam/);
    assert.equal((await neu({ nr: 'ZS-F8', skontoZahlbetrag: -1 }, 400)).fehler.length > 0, true);
    assert.equal((await neu({ nr: 'ZS-F9', skontoZahlbetrag: 'viel' }, 400)).fehler.length > 0, true);
    // Papier-Prüfung Netto/USt/Brutto kommt zuerst
    assert.match((await neu({ nr: 'ZS-F10', brutto: 48100, skontoZahlbetrag: 45163.2 }, 400)).fehler, /Brutto passt nicht/);
    assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM rechnung WHERE nr LIKE 'ZS-F%'").n, 0);
  });

  await t.test('Bearbeiten: öffnet wieder als „Zahlbetrag mit Skonto“; Wechsel zu % und zurück; Brutto ändern rechnet das Skonto neu', async () => {
    let r = await neu({ nr: 'ZS-E1', skontoZahlbetrag: 45163.2 });
    const put = async (body, status = 200) => { const u = await c.buero.put(`/rechnungen/${r.id}`, { version: r.version, ...body }); assert.equal(u.status, status, JSON.stringify(u.daten)); if (status === 200) r = u.daten; return u.daten; };
    await put({ notiz: 'nur eine Notiz' });
    assert.deepEqual([r.skontoEingabe, r.zahlbetragMitSkonto, r.skontoBetrag], ['zahlbetrag', 45163.2, 1396.8]);
    // derselbe Dialog speichert wieder alles (Prozent und Betrag leer, Zahlbetrag mit Skonto gesetzt) – unverändert
    await put({ skontoProzent: null, skontoBetrag: null, skontoZahlbetrag: 45163.2, skontoTage: 14 });
    assert.deepEqual([r.skontoEingabe, r.zahlbetragMitSkonto, r.skontoBetrag, r.skontoProzent], ['zahlbetrag', 45163.2, 1396.8, 3]);
    // Deckungsrücklass 5 % statt 3 %: Zahlbetrag 45.600,00, eingetragener Betrag bleibt → Skonto 436,80
    await put({ deckungProzent: 5 });
    assert.deepEqual([r.zahlbetrag, r.skontoEingabe, r.zahlbetragMitSkonto, r.skontoBetrag, r.skontoProzent], [45600, 'zahlbetrag', 45163.2, 436.8, 0.958]);
    assert.deepEqual(zeile(r.id), { p: null, b: 436.8, z: 45163.2 });
    // Rücklass so hoch, dass der Betrag nicht mehr kleiner ist → abgelehnt, nichts geändert
    assert.match((await put({ deckungProzent: 6 }, 400)).fehler, /muss kleiner sein als der Zahlbetrag \(45\.120,00\)/);
    await put({ deckungProzent: 3 });
    assert.deepEqual([r.zahlbetrag, r.skontoBetrag], [46560, 1396.8]);
    // Wechsel zu Prozent: Zahlbetrag mit Skonto weg
    await put({ skontoProzent: 2 });
    assert.deepEqual([r.skontoEingabe, r.skontoBetrag, r.zahlbetragMitSkonto], ['prozent', 931.2, 45628.8]);
    assert.deepEqual(zeile(r.id), { p: 2, b: null, z: null });
    // Wechsel zu Betrag
    await put({ skontoBetrag: 500 });
    assert.deepEqual([r.skontoEingabe, r.skontoBetrag, r.zahlbetragMitSkonto], ['betrag', 500, 46060]);
    assert.deepEqual(zeile(r.id), { p: null, b: 500, z: null });
    // zurück zu Zahlbetrag mit Skonto
    await put({ skontoZahlbetrag: 45163.2 });
    assert.deepEqual([r.skontoEingabe, r.skontoBetrag, r.skontoProzent], ['zahlbetrag', 1396.8, 3]);
    assert.deepEqual(zeile(r.id), { p: null, b: 1396.8, z: 45163.2 });
    // skontoZahlbetrag:null allein → kein Skonto (nicht still zu „Betrag“)
    await put({ skontoZahlbetrag: null });
    assert.deepEqual([r.skontoEingabe, r.skontoBetrag, r.zahlbetragMitSkonto], [null, 0, null]);
    assert.deepEqual(zeile(r.id), { p: null, b: null, z: null });
  });

  await t.test('Zahlung mit Skonto: höchstens das gerechnete Skonto; danach gesperrt', async () => {
    const r = await neu({ nr: 'ZS-Z1', skontoZahlbetrag: 45163.2 });
    s.uhr.setze('2026-11-25T08:00:00Z'); // in der Skontofrist (bis 02.12.)
    let z = await c.buero.post(`/rechnungen/${r.id}/zahlungen`, { datum: '2026-11-25', betrag: 45163.19, skonto: 1396.81 });
    assert.equal(z.status, 400);
    assert.match(z.daten.fehler, /höchstens 1\.?396,80 \(laut Rechnung\)/);
    // „Als bezahlt markieren“ in der Skontofrist schlägt genau den Papierbetrag vor
    z = await c.buero.post(`/rechnungen/${r.id}/bezahlt`, {});
    assert.equal(z.status, 201, JSON.stringify(z.daten));
    assert.deepEqual([z.daten.zahlungen[0].datum, z.daten.zahlungen[0].betrag, z.daten.zahlungen[0].skonto], ['2026-11-25', 45163.2, 1396.8]);
    const g = (await c.buero.get(`/rechnungen/${r.id}`)).daten;
    assert.deepEqual([g.status, g.bezahlt, g.skontoGenommen], ['bezahlt', 45163.2, 1396.8]);
    const u = await c.buero.put(`/rechnungen/${r.id}`, { version: g.version, skontoZahlbetrag: 45000 });
    assert.equal(u.status, 409);
    assert.equal(zeile(r.id).z, 45163.2);
    s.uhr.setze('2026-11-12T09:24:00.000Z');
  });

  await t.test('Gutschrift: Eingabe möglich, aber kein Skonto-Vorschlag beim Bezahlen (wie bisher)', async () => {
    const r = await neu({ nr: 'ZS-G1', typ: 'gutschrift', deckungProzent: null, skontoZahlbetrag: 47040 }); // 48.000 − 2 %
    assert.deepEqual([r.skontoEingabe, r.skontoBetrag, r.skontoProzent, r.zahlbetragMitSkonto], ['zahlbetrag', 960, 2, 47040]);
    const e = (await c.buero.get('/faelligkeiten')).daten.gruppen.flatMap((g) => g.eintraege).find((x) => x.nr === 'ZS-G1');
    assert.equal(e.mitSkonto, null);
  });

  await t.test('Geld nur für Büro/GF: Polier und Mitarbeiter 403 ohne Werte, €-Sicherheitsnetz kennt die neuen Felder', async () => {
    const r = (await c.buero.get('/rechnungen')).daten.find((x) => x.nr === 'ZS-1');
    assert.equal((await c.bauleiter.get(`/rechnungen/${r.id}`)).daten.zahlbetragMitSkonto, 45163.2); // Bauleiter = Büro
    for (const rolle of ['polier', 'mitarbeiter']) {
      for (const p of [`/rechnungen/${r.id}`, '/rechnungen', '/faelligkeiten']) {
        const a = await c[rolle].get(p);
        assert.equal(a.status, 403, `${rolle} ${p}`);
        assert.doesNotMatch(JSON.stringify(a.daten), /45\.?163|1\.?396|zahlbetragMitSkonto/);
      }
      const w = await c[rolle].post(`/baustellen/${BS.reisinger}/rechnungen`, { ...AUER, nr: `ZS-${rolle}`, skontoZahlbetrag: 45163.2 });
      assert.equal(w.status, 403);
    }
    assert.deepEqual(findeEuroFelder(entferneEuroFelder({ zahlbetragMitSkonto: 1, skontoZahlbetrag: 2, skontoEingabe: 'zahlbetrag' })), []);
    assert.deepEqual(entferneEuroFelder({ zahlbetragMitSkonto: 1, skontoZahlbetrag: 2, skontoEingabe: 'zahlbetrag' }), { skontoEingabe: 'zahlbetrag' });
  });
});
