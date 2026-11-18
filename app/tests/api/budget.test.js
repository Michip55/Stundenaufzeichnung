'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS, euroFelder } = require('./hilfe');

test('Nachkalkulation und Budget-Alarm', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  const buero = await s.login(U.buero);
  const bl = await s.login(U.bauleiter);
  const pol = await s.login(U.polier);
  const ma = await s.login(U.mitarbeiter);

  const budgetMeldungen = async (c, bsId) => (await c.get('/benachrichtigungen')).daten.filter((n) => n.typ === 'budget' && (bsId === undefined || n.baustelleId === bsId));
  const kalk = async (bsId) => (await gf.get(`/kalkulation/${bsId}`)).daten;

  await t.test('Kalkulation: Aufbau laut API.md und Testdaten (WHA Pitten ≈ 60 %)', async () => {
    const k = await kalk(BS.pitten);
    for (const f of ['baustelle', 'auftragssumme', 'nachtraege', 'auftragGesamt', 'erloes', 'kosten', 'db', 'dbProzent', 'budgetVerbrauchProzent', 'leistungsstandProzent', 'status', 'schwellen', 'positionen', 'verlauf', 'hinweise']) {
      assert.ok(f in k, f);
    }
    for (const f of ['lohn', 'geraete', 'material', 'fremd', 'gesamt']) assert.equal(typeof k.kosten[f], 'number');
    assert.ok(k.budgetVerbrauchProzent >= 55 && k.budgetVerbrauchProzent <= 65, String(k.budgetVerbrauchProzent));
    assert.equal(k.status, 'ok');
    assert.ok(k.positionen.lohn.length >= 5);
    assert.ok(k.verlauf.length >= 10);
    assert.equal(Math.round((k.kosten.lohn + k.kosten.geraete + k.kosten.material + k.kosten.fremd) * 100) / 100, k.kosten.gesamt);
    // Übersicht
    const ue = (await buero.get('/kalkulation')).daten;
    const st = Object.fromEntries(ue.map((x) => [x.baustelle.kst, x.status]));
    assert.deepEqual(st, { '26-041': 'ok', '26-038': 'warnung', '26-044': 'warnung', '26-029': 'warnung', '26-047': 'kritisch', '26-035': 'kritisch', '26-050': 'ok' });
  });

  await t.test('Ausgangsstand: Alarme der Testdaten an Bauleiter/Büro/GF (15.3: Bauleiter = Büro, alle Baustellen)', async () => {
    assert.equal((await budgetMeldungen(pol)).length, 0);
    assert.equal((await budgetMeldungen(ma)).length, 0);
    const blm = await budgetMeldungen(bl);
    assert.ok(blm.length >= 2);
    // Bauleiter erhält über das Recht kalk_sehen dieselben Alarme wie das Büro (vorher nur eigene Baustellen)
    assert.deepEqual(blm.map((n) => n.titel).sort(), (await budgetMeldungen(buero)).map((n) => n.titel).sort());
    assert.ok(blm.some((n) => n.baustelleId === BS.ternitz && /kritisch/i.test(n.titel)));
    assert.ok((await budgetMeldungen(buero, BS.reisinger)).length === 1);
    assert.ok(!JSON.stringify(blm).includes('€'));
    assert.deepEqual((await budgetMeldungen(gf, BS.pitten)), []);
  });

  await t.test('Schwelle 80 % wird genau einmal gemeldet – an Bauleiter, Büro, GF', async () => {
    const k = await kalk(BS.pitten);
    // Budget-Basis seit API.md 10: Nachkalkulationssumme ÷ Auftragssumme gesamt
    const summe = Math.round((k.positionen.gesamtsumme / 0.85) * 100) / 100;
    let r = await buero.putV(`/baustellen/${BS.pitten}/auftrag`, { auftragssumme: summe });
    assert.equal(r.status, 200);
    assert.equal(r.daten.auftragssumme, summe);
    for (const c of [bl, buero, gf]) {
      const m = await budgetMeldungen(c, BS.pitten);
      assert.equal(m.length, 1);
      assert.match(m[0].text, /80 %/);
      assert.equal(m[0].gelesen, false);
    }
    assert.equal((await budgetMeldungen(pol)).length, 0);
    assert.equal((await budgetMeldungen(ma)).length, 0);
    // erneutes Speichern, Preisänderung ohne neue Schwelle: keine weitere Meldung
    r = await buero.putV(`/baustellen/${BS.pitten}/auftrag`, { auftragssumme: summe });
    assert.equal((await buero.put('/preise/geraete/1', { feld: 'kostensatz', wert: 52.5 })).status, 200);
    assert.equal((await budgetMeldungen(bl, BS.pitten)).length, 1);
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM budget_alarm WHERE baustelle_id = ?', BS.pitten).n, 1);
    const p = s.db.eins("SELECT text FROM protokoll WHERE art = 'budget_alarm' AND objekt = ? ORDER BY id DESC", `baustelle:${BS.pitten}`);
    assert.match(p.text, /Push\/E-Mail nicht gesendet – Integration nicht angebunden/);
    assert.ok(s.db.eins("SELECT COUNT(*) AS n FROM protokoll WHERE art = 'auftrag'").n >= 1);
  });

  await t.test('Fremdleistung zählt nur intern; Mengeneintrag der Nachkalkulation löst die nächste Schwelle (90 %) aus', async () => {
    let k = await kalk(BS.pitten);
    const f = await buero.post(`/baustellen/${BS.pitten}/fremdleistungen`, { text: 'Saugbagger', betrag: 5000, datum: '2026-11-12' });
    assert.equal(f.status, 201);
    const k1 = await kalk(BS.pitten);
    assert.equal(k1.budgetVerbrauchProzent, k.budgetVerbrauchProzent);
    assert.equal(k1.interneKosten.kosten.fremd, Math.round((k.interneKosten.kosten.fremd + 5000) * 100) / 100);
    k = k1;
    const fehlt = Math.ceil((k.auftragGesamt * 0.92 - k.positionen.gesamtsumme) / 1.15);
    const pos = (await buero.get(`/baustellen/${BS.pitten}/positionen`)).daten.gruppen.find((g) => g.schluessel === 'fremdmaterial').positionen.find((p) => p.bezeichnung === 'Maleiner');
    const r = await buero.post(`/baustellen/${BS.pitten}/positionen/${pos.id}/mengen`, { datum: '2026-11-12', menge: fehlt, notiz: 'Rechnung Maleiner' });
    assert.equal(r.status, 201);
    const m = await budgetMeldungen(bl, BS.pitten);
    assert.equal(m.length, 2);
    assert.match(m[0].text, /90 %/);
    assert.equal((await kalk(BS.pitten)).status, 'warnung');
  });

  await t.test('Nachtrag erhöht die Basis → Schwellen wieder scharf; Löschen → erneute Meldung', async () => {
    const k = await kalk(BS.pitten);
    const n = await buero.post(`/baustellen/${BS.pitten}/nachtraege`, { text: 'Nachtrag 01 – Zusatzparkplätze', betrag: Math.round(k.auftragGesamt) });
    assert.equal(n.status, 201);
    assert.equal(n.daten.text, 'Nachtrag 01 – Zusatzparkplätze');
    const k2 = await kalk(BS.pitten);
    assert.ok(k2.budgetVerbrauchProzent < 50);
    assert.equal(k2.nachtraege.length, 1);
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM budget_alarm WHERE baustelle_id = ?', BS.pitten).n, 0);
    const vorher = (await budgetMeldungen(gf, BS.pitten)).length;
    assert.equal((await buero.del(`/baustellen/${BS.pitten}/nachtraege/${n.daten.id}`)).status, 200);
    const m = await budgetMeldungen(gf, BS.pitten);
    assert.equal(m.length, vorher + 1);
    assert.match(m[0].text, /90 %/);
    assert.equal((await buero.del(`/baustellen/${BS.pitten}/nachtraege/${n.daten.id}`)).status, 404);
    assert.ok(s.db.eins("SELECT COUNT(*) AS n FROM protokoll WHERE art = 'nachtrag'").n >= 2);
  });

  await t.test('Empfänger-Einstellung (ohne GF) und Preisänderung → 100 %', async () => {
    assert.equal((await gf.putV(`/baustellen/${BS.pitten}/auftrag`, { empfaenger: { gf: false } })).status, 200);
    const gfVorher = (await budgetMeldungen(gf, BS.pitten)).length;
    const blVorher = (await budgetMeldungen(bl, BS.pitten)).length;
    const fa = (await buero.get(`/baustellen/${BS.pitten}/positionen`)).daten.gruppen[0].positionen[0];
    assert.equal(fa.bezeichnung, 'Facharbeiter');
    const r = await buero.put(`/baustellen/${BS.pitten}/positionen/${fa.id}`, { ep: 150, version: fa.version, gueltigAb: '2000-01-01', rueckwirkend: true }); // 12.2: ganze Laufzeit
    assert.equal(r.status, 200);
    assert.equal(r.daten.ep, 150);
    const k = await kalk(BS.pitten);
    assert.ok(k.budgetVerbrauchProzent >= 100, String(k.budgetVerbrauchProzent));
    assert.equal(k.status, 'kritisch');
    assert.equal((await budgetMeldungen(gf, BS.pitten)).length, gfVorher);
    const blm = await budgetMeldungen(bl, BS.pitten);
    assert.equal(blm.length, blVorher + 1);
    assert.match(blm[0].titel, /Budget-Alarm/);
    const pr = s.db.eins("SELECT alt, neu FROM protokoll WHERE art = 'nachkalkulation' AND objekt = ? ORDER BY id DESC", `position:${fa.id}`);
    assert.deepEqual([JSON.parse(pr.alt).ep, JSON.parse(pr.neu).ep], [72.5, 150]);
  });

  await t.test('nie an Polier/Mitarbeiter – auch wenn als Bauleiter eingetragen', async () => {
    s.db.lauf('UPDATE baustelle SET bauleiter_id = ? WHERE id = ?', U.polier, BS.neustadt);
    const k = await kalk(BS.neustadt);
    await gf.putV(`/baustellen/${BS.neustadt}/auftrag`, { auftragssumme: Math.round(k.positionen.gesamtsumme / 0.95) });
    assert.equal((await budgetMeldungen(pol)).length, 0);
    assert.ok((await budgetMeldungen(buero, BS.neustadt)).length >= 1);
    s.db.lauf('UPDATE baustelle SET bauleiter_id = ? WHERE id = ?', U.bauleiter, BS.neustadt);
  });

  await t.test('Unterschrift (Kosten zählen ab „unterschrieben“) und Freigabe lösen Prüfung aus', async () => {
    const entwurf = s.db.eins("SELECT id FROM bericht WHERE baustelle_id = ? AND status = 'entwurf'", BS.ternitz).id;
    // Wert des Berichts in der Nachkalkulation: kurz als unterschrieben werten und zurücksetzen
    const g0 = (await kalk(BS.ternitz)).positionen.gesamtsumme;
    s.db.lauf("UPDATE bericht SET status = 'unterschrieben' WHERE id = ?", entwurf);
    const g1 = (await kalk(BS.ternitz)).positionen.gesamtsumme;
    s.db.lauf("UPDATE bericht SET status = 'entwurf' WHERE id = ?", entwurf);
    const e = g1 - g0;
    assert.ok(e > 100);
    const summe = Math.round(((g0 + e / 2) / 0.9) * 100) / 100;
    await gf.putV(`/baustellen/${BS.ternitz}/auftrag`, { auftragssumme: summe });
    const vorher = (await budgetMeldungen(bl, BS.ternitz)).length;
    const sig = require('../../server/png').demoUnterschrift('x');
    await gf.postV(`/berichte/${entwurf}/unterschrift`, { rolle: 'an', name: 'Manfred Puchegger', bildPng: sig });
    assert.equal((await budgetMeldungen(bl, BS.ternitz)).length, vorher);
    await gf.postV(`/berichte/${entwurf}/unterschrift`, { rolle: 'bh', name: 'DI Martin Ebner', bildPng: sig });
    const m = await budgetMeldungen(bl, BS.ternitz);
    assert.equal(m.length, vorher + 1);
    assert.match(m[0].text, /90 %/);
    assert.equal((await bl.post(`/berichte/${entwurf}/freigeben`)).status, 200);
    assert.equal((await budgetMeldungen(bl, BS.ternitz)).length, vorher + 1); // einmalig
  });

  await t.test('Leistungsmeldung (Bauleiter eigene Baustelle) erhöht den Leistungsstand', async () => {
    const vorher = (await kalk(BS.kogler)).leistungsstandProzent;
    const r = await bl.post(`/baustellen/${BS.kogler}/leistungen`, { leistungId: 7, menge: 100, datum: '2026-11-12' });
    assert.equal(r.status, 201);
    assert.ok((await kalk(BS.kogler)).leistungsstandProzent > vorher);
    assert.equal((await bl.post(`/baustellen/${BS.reisinger}/leistungen`, { leistungId: 7, menge: 1, datum: '2026-11-12' })).status, 201); // Bauleiter wie Büro (13.11.2026)
  });

  await t.test('Benachrichtigungen: nur eigene, gelesen markieren', async () => {
    const liste = (await bl.get('/benachrichtigungen')).daten;
    assert.ok(liste.length > 0);
    for (const n of liste) assert.deepEqual(Object.keys(n).filter((k) => !['baustelleId', 'anlageId'].includes(k)).sort(), ['gelesen', 'id', 'text', 'titel', 'typ', 'zeit']);
    const fremde = (await buero.get('/benachrichtigungen')).daten.find((n) => !liste.some((x) => x.id === n.id));
    assert.equal((await bl.post(`/benachrichtigungen/${fremde.id}/gelesen`)).status, 404);
    assert.equal((await bl.post(`/benachrichtigungen/${liste[0].id}/gelesen`)).status, 200);
    assert.equal((await bl.get('/benachrichtigungen')).daten.find((n) => n.id === liste[0].id).gelesen, true);
    assert.equal((await buero.get('/benachrichtigungen')).daten.find((n) => n.id === fremde.id).gelesen, false);
    const r = await bl.post('/benachrichtigungen/alle-gelesen');
    assert.equal(r.status, 200);
    assert.ok((await bl.get('/benachrichtigungen')).daten.every((n) => n.gelesen));
    assert.equal((await bl.post('/benachrichtigungen/abc/gelesen')).status, 400);
  });

  await t.test('Bauleiter wie Büro (13.11.2026): Nachkalkulation und Budget-Meldungen unabhängig von der Zuordnung', async () => {
    s.db.lauf('UPDATE baustelle SET bauleiter_id = ? WHERE id = ?', U.gf, BS.ternitz);
    assert.equal((await bl.get(`/kalkulation/${BS.ternitz}`)).status, 200);
    s.db.lauf('UPDATE baustelle SET bauleiter_id = ? WHERE id = ?', U.bauleiter, BS.ternitz);
  });

  await t.test('kalk_sehen ohne preise_sehen liefert Kennzahlen ohne €', async () => {
    // Büro-Teilzeitkraft: Preise per Matrix entzogen, Nachkalkulation erlaubt
    await gf.put('/rechte/matrix', { rolle: 'buero', recht: 'preise_sehen', wert: false });
    const b2 = await s.login(U.buero);
    const r = await b2.get(`/kalkulation/${BS.pitten}`);
    assert.equal(r.status, 200);
    assert.equal(typeof r.daten.budgetVerbrauchProzent, 'number');
    assert.deepEqual(euroFelder(r.daten).filter((f) => !/budgetVerbrauchProzent|leistungsstandProzent|schwellen/.test(f)), []);
    await gf.put('/rechte/matrix', { rolle: 'buero', recht: 'preise_sehen', wert: true });
  });
});
