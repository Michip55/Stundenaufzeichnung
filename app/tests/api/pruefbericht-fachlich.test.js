'use strict';
/** Regressionstests zu PRUEFBERICHT_1: B-02, B-05, B-06, B-07, M-01, M-02, M-03, M-07, N-01, N-02, N-04, N-06 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');
const { demoUnterschrift } = require('../../server/png');

const sig = demoUnterschrift('t');

test('B-02, M-03, N-01, N-02, N-04, N-06', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const pol = await s.login(U.polier);
  const bl = await s.login(U.bauleiter);
  const buero = await s.login(U.buero);

  await t.test('B-02: Polier stempelt keine fremden Personen, keine Büro-/GF-Konten', async () => {
    let r = await pol.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: [27], typ: 'gehen' });
    assert.equal(r.status, 200);
    assert.equal(r.daten.ergebnisse[0].ok, false);
    assert.match(r.daten.ergebnisse[0].fehler, /nicht auf einer Ihrer Baustellen/);
    assert.equal((await (await s.login(27)).get('/zeit/status')).daten.status, 'arbeit'); // unverändert
    r = await pol.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: [U.gf, U.buero, U.bauleiter], typ: 'kommen' });
    assert.ok(r.daten.ergebnisse.every((x) => !x.ok && /nur Mitarbeiter und Poliere/.test(x.fehler)));
    r = await pol.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: [9], typ: 'kommen' });
    assert.equal(r.daten.ergebnisse[0].ok, false);
    assert.match(r.daten.ergebnisse[0].fehler, /gehört nicht zu Ihrer Partie/);
    r = await pol.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: [2, 4], typ: 'kommen' });
    assert.ok(r.daten.ergebnisse.every((x) => x.ok));
    r = await pol.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: [16], typ: 'kommen', gast: true }); // 16: heute noch nicht gestempelt
    assert.equal(r.daten.ergebnisse[0].ok, true);
    assert.ok(s.db.eins("SELECT COUNT(*) AS n FROM protokoll WHERE text LIKE '%als Gast%'").n === 1);
    // der Gast ist jetzt auf der eigenen Baustelle → darf ausgestempelt werden
    s.uhr.plus(5);
    r = await pol.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: [16, 2], typ: 'pause_start' });
    assert.ok(r.daten.ergebnisse.every((x) => x.ok), JSON.stringify(r.daten));
    // fremde Baustelle bleibt 403
    assert.equal((await pol.post('/zeit/kolonne', { baustelleId: BS.kogler, benutzerIds: [9], typ: 'gehen' })).status, 403);
    assert.equal((await pol.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: [2], typ: 'kommen', gast: 'ja' })).status, 400);
  });

  await t.test('N-06: Zeitstempel ohne Zeitzone → 400', async () => {
    const c = await s.login(6);
    const r = await c.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten, zeit: '2026-11-12T09:00' });
    assert.equal(r.status, 400);
    assert.match(r.daten.fehler, /Zeitzone/);
    assert.equal((await c.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten, zeit: '2026-11-12T09:00:00+01:00' })).status, 200);
  });

  await t.test('N-01: Status aus der ganzen laufenden Schicht (auch nach sehr vielen Buchungen)', async () => {
    const start = s.uhr().getTime() - 10 * 3600000;
    s.db.lauf("INSERT INTO buchung (benutzer_id, typ, zeit, baustelle_id, quelle, erfasst) VALUES (5, 'kommen', ?, 1, 'seed', ?)", new Date(start).toISOString(), new Date(start).toISOString());
    for (let i = 1; i <= 60; i++) {
      const z = new Date(start + i * 5 * 60000).toISOString();
      s.db.lauf("INSERT INTO buchung (benutzer_id, typ, zeit, baustelle_id, quelle, erfasst) VALUES (5, ?, ?, NULL, 'seed', ?)", i % 2 ? 'pause_start' : 'pause_ende', z, z);
    }
    assert.ok((await buero.get('/zeit/anwesend')).daten.some((a) => a.benutzerId === 5 && a.status === 'arbeit'));
    assert.ok((await pol.get(`/zeit/kolonne?baustelleId=${BS.pitten}`)).daten.some((a) => a.benutzerId === 5 && a.status === 'arbeit'));
    const c = await s.login(5);
    assert.equal((await c.get('/zeit/status')).daten.status, 'arbeit');
    assert.equal((await c.post('/zeit/stempeln', { typ: 'kommen', baustelleId: 1 })).status, 409);
    const g = await c.post('/zeit/stempeln', { typ: 'gehen' });
    assert.equal(g.status, 200);
    assert.equal(g.daten.status, 'aus');
  });

  await t.test('N-02: Jahr außerhalb 2000–2100 → 400 statt 500', async () => {
    assert.equal((await buero.get('/monat?monat=9999-12')).status, 400);
    assert.equal((await buero.get('/monat/export.csv?monat=1999-12')).status, 400);
    assert.equal((await pol.get('/zeit/woche?datum=9999-01-01')).status, 400);
  });

  await t.test('N-04: Geldbeträge kaufmännisch gerundet', async () => {
    const r = await buero.putV(`/baustellen/${BS.pitten}/auftrag`, { auftragssumme: 100000.005 });
    assert.equal(r.daten.auftragssumme, 100000.01);
    const n = await buero.post(`/baustellen/${BS.pitten}/nachtraege`, { text: 'Rundung', betrag: 1.005 });
    assert.equal(n.daten.betrag, 1.01);
  });

  await t.test('M-03: Leistungsmeldung – Grenzen, Liste, Storno mit Protokoll', async () => {
    const pfad = `/baustellen/${BS.kogler}/leistungen`;
    assert.equal((await bl.post(pfad, { leistungId: 7, menge: 10, datum: '2099-01-01' })).status, 400);
    assert.equal((await bl.post(pfad, { leistungId: 7, menge: 1e6, datum: '2026-11-12' })).status, 400);
    assert.equal((await bl.post(pfad, { leistungId: 7, menge: 10, datum: '2023-01-01' })).status, 400);
    const vorher = (await bl.get(`/kalkulation/${BS.kogler}`)).daten.leistungsstandProzent;
    const r = await bl.post(pfad, { leistungId: 7, menge: 500, datum: '2026-11-12' });
    assert.equal(r.status, 201);
    const liste = (await bl.get(pfad)).daten;
    const e = liste.find((x) => x.id === r.daten.id);
    assert.equal(e.menge, 500);
    assert.equal(e.betrag, 500 * 31.5);
    assert.equal((await pol.get(pfad)).status, 403);
    assert.equal((await bl.get(`/baustellen/${BS.reisinger}/leistungen`)).status, 403);
    assert.ok((await bl.get(`/kalkulation/${BS.kogler}`)).daten.leistungsstandProzent > vorher);
    assert.equal((await bl.del(`${pfad}/${r.daten.id}`)).status, 200);
    assert.equal((await bl.get(`/kalkulation/${BS.kogler}`)).daten.leistungsstandProzent, vorher);
    assert.equal((await bl.del(`${pfad}/${r.daten.id}`)).status, 404);
    assert.equal((await pol.del(`${pfad}/1`)).status, 403);
    const p = s.db.alle("SELECT text FROM protokoll WHERE art = 'leistung' ORDER BY id").map((x) => x.text);
    assert.ok(p.some((x) => /Leistungsmeldung 04\.01 zu 26-038/.test(x)) && p.some((x) => /storniert/.test(x)));
  });

  await t.test('M-03: Fremdleistung – Grenzen, Liste, Storno mit Budget-Prüfung', async () => {
    const pfad = `/baustellen/${BS.pitten}/fremdleistungen`;
    assert.equal((await buero.post(pfad, { text: 'Zu viel', betrag: 1e7, datum: '2026-11-12' })).status, 400);
    assert.equal((await buero.post(pfad, { text: 'Zukunft', betrag: 100, datum: '2026-12-24' })).status, 400);
    const vorher = (await buero.get(`/kalkulation/${BS.pitten}`)).daten.kosten.fremd;
    const r = await buero.post(pfad, { text: 'Tippfehler', betrag: 99999, datum: '2026-11-12' });
    assert.equal(r.status, 201);
    assert.ok((await buero.get(pfad)).daten.some((f) => f.id === r.daten.id && f.betrag === 99999));
    assert.equal((await bl.get(pfad)).status, 200); // Bauleiter eigene Baustelle: lesen
    assert.equal((await bl.del(`${pfad}/${r.daten.id}`)).status, 403); // aber nicht stornieren
    assert.equal((await bl.get(`/baustellen/${BS.reisinger}/fremdleistungen`)).status, 403);
    assert.equal((await pol.get(pfad)).status, 403);
    assert.equal((await buero.del(`${pfad}/${r.daten.id}`)).status, 200);
    assert.equal((await buero.get(`/kalkulation/${BS.pitten}`)).daten.kosten.fremd, vorher);
    assert.ok(s.db.eins("SELECT COUNT(*) AS n FROM protokoll WHERE art = 'fremdleistung' AND text LIKE '%storniert%'").n === 1);
  });
});

test('B-05, B-06, M-01, M-02, M-07: Nachtschicht, vergessenes Ausstempeln, Korrektur, Lohn aus Berichten', async (t) => {
  const s = await starte({ pdfUnkomprimiert: true });
  t.after(() => s.stop());
  let buero, pol;

  await t.test('B-05: vergessenes Ausstempeln zählt nicht 52 Std.', async () => {
    s.uhr.setze('2026-12-03T06:00:00.000Z'); // Do 07:00
    await (await s.login(6)).post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
    s.uhr.setze('2026-12-05T10:00:00.000Z'); // Sa 11:00
    assert.equal((await (await s.login(6)).post('/zeit/stempeln', { typ: 'gehen' })).status, 200);
    buero = await s.login(U.buero);
    pol = await s.login(U.polier);
    const m = (await buero.get('/monat?monat=2026-12')).daten;
    const fabian = m.mitarbeiter.find((x) => x.id === 6);
    assert.equal(fabian.tage['2026-12-03'].stunden, 0);
    assert.equal(fabian.tage['2026-12-03'].unplausibel, true);
    assert.equal(fabian.summe, 0);
    assert.ok(m.offeneSchichten.some((o) => o.benutzerId === 6 && o.datum === '2026-12-03'));
    assert.ok(m.warnungen.some((w) => w.benutzerId === 6 && w.typ === 'unplausibel'));
    const csv = (await buero.get('/monat/export.csv?monat=2026-12')).daten.toString('utf8');
    assert.match(csv, /Hinweis;Offene\/unplausible Schicht \(0 Std\. gezählt, bitte korrigieren\): Fabian Stickler 03\.12\.2026/);
    assert.ok(!/;52;/.test(csv));
    // Bericht: Person mit Hinweis, 0 Std., speicherbar
    const b = await pol.post('/berichte', { baustelleId: BS.pitten, datum: '2026-12-03' });
    assert.equal(b.status, 201);
    const zeile = b.daten.personal.find((p) => p.benutzerId === 6);
    assert.equal(zeile.stunden, 0);
    assert.match(zeile.hinweis, /Ausstempeln fehlt/);
    assert.equal((await pol.putV(`/berichte/${b.daten.id}`, { personal: b.daten.personal })).status, 200);
  });

  await t.test('B-05: Büro korrigiert Buchungen mit Grund (Protokoll), Folge wird geprüft', async () => {
    const l = await buero.get('/zeit/buchungen?benutzerId=6&von=2026-12-03&bis=2026-12-05');
    assert.equal(l.status, 200);
    assert.deepEqual(l.daten.map((x) => x.typ), ['kommen', 'gehen']);
    const gehen = l.daten[1];
    assert.equal((await pol.get('/zeit/buchungen?benutzerId=6')).status, 403);
    assert.equal((await (await s.login(6)).get('/zeit/buchungen')).status, 200); // eigene
    assert.equal((await buero.put(`/zeit/buchungen/${gehen.id}`, { zeit: '2026-12-03T15:00:00Z' })).status, 400); // Grund fehlt
    assert.equal((await buero.put(`/zeit/buchungen/${gehen.id}`, { zeit: '2026-12-03T15:00', grund: 'vergessen' })).status, 400); // ohne Zeitzone
    let r = await buero.put(`/zeit/buchungen/${gehen.id}`, { zeit: '2026-12-03T15:00:00Z', grund: 'Ausstempeln vergessen, laut Polier 16:00' });
    assert.equal(r.status, 200);
    assert.equal(r.daten.quelle, 'buero');
    r = await buero.post('/zeit/buchungen', { benutzerId: 6, typ: 'pause_start', zeit: '2026-12-03T11:00:00Z', grund: 'Mittagspause' });
    assert.equal(r.status, 201);
    assert.equal((await buero.post('/zeit/buchungen', { benutzerId: 6, typ: 'pause_ende', zeit: '2026-12-03T11:30:00Z', grund: 'Mittagspause' })).status, 201);
    assert.equal((await buero.post('/zeit/buchungen', { benutzerId: 6, typ: 'kommen', baustelleId: 1, zeit: '2026-12-03T12:00:00Z', grund: 'falsch' })).status, 409);
    assert.equal((await buero.post('/zeit/buchungen', { benutzerId: 6, typ: 'gehen', zeit: '2027-01-03T12:00:00Z', grund: 'Zukunft' })).status, 400);
    assert.equal((await buero.del(`/zeit/buchungen/${l.daten[0].id}`, undefined)).status, 400); // Grund fehlt
    assert.equal((await buero.anfrage('DELETE', `/zeit/buchungen/${l.daten[0].id}`, { grund: 'kommen löschen' })).status, 409); // ungültige Folge
    assert.equal((await pol.post('/zeit/buchungen', { benutzerId: 6, typ: 'gehen', zeit: '2026-12-03T15:00:00Z', grund: 'x' })).status, 403);
    const m = (await buero.get('/monat?monat=2026-12')).daten.mitarbeiter.find((x) => x.id === 6);
    assert.equal(m.tage['2026-12-03'].stunden, 8.5);
    assert.ok(!m.tage['2026-12-03'].unplausibel);
    assert.ok(s.db.eins("SELECT COUNT(*) AS n FROM protokoll WHERE art = 'zeitkorrektur'").n >= 3);
    const alt = s.db.eins("SELECT alt FROM protokoll WHERE art = 'zeitkorrektur' AND alt IS NOT NULL ORDER BY id LIMIT 1").alt;
    assert.match(alt, /2026-12-05T10:00:00/); // alter Wert bleibt nachvollziehbar
  });

  let nacht;
  await t.test('B-06: Schicht über Mitternacht – Auto-Befüllung, Speichern, Stunden, PDF, Monat', async () => {
    s.uhr.setze('2026-12-07T21:00:00.000Z'); // Mo 22:00
    const c = await s.login(7);
    await c.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
    s.uhr.setze('2026-12-08T01:00:00.000Z'); await c.post('/zeit/stempeln', { typ: 'pause_start' });
    s.uhr.setze('2026-12-08T01:30:00.000Z'); await c.post('/zeit/stempeln', { typ: 'pause_ende' });
    s.uhr.setze('2026-12-08T05:00:00.000Z'); await c.post('/zeit/stempeln', { typ: 'gehen' });
    pol = await s.login(U.polier);
    buero = await s.login(U.buero);
    const b = await pol.post('/berichte', { baustelleId: BS.pitten, datum: '2026-12-07' });
    assert.equal(b.status, 201);
    nacht = b.daten.id;
    const z = b.daten.personal.find((p) => p.benutzerId === 7);
    assert.deepEqual([z.von1, z.bis1, z.von2, z.bis2, z.pauseMin, z.stunden], ['22:00', '02:00', '02:30', '06:00', 30, 7.5]);
    // unverändert zurück → 200 (früher 400)
    let r = await pol.putV(`/berichte/${nacht}`, { personal: b.daten.personal });
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    // ohne Stunden → aus den Blöcken über Mitternacht gerechnet
    r = await pol.putV(`/berichte/${nacht}`, { personal: [{ benutzerId: 7, von1: '22:00', bis1: '02:00', von2: '02:30', bis2: '06:00', pauseMin: 30 }] });
    assert.equal(r.daten.personal[0].stunden, 7.5);
    r = await pol.putV(`/berichte/${nacht}`, { personal: [{ benutzerId: 7, von1: '22:00', bis1: '06:00', pauseMin: 30 }] });
    assert.equal(r.daten.personal[0].stunden, 7.5);
    const pdf = await pol.get(`/berichte/${nacht}/pdf`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.daten.subarray(0, 4).toString(), '%PDF');
    const m = (await buero.get('/monat?monat=2026-12')).daten.mitarbeiter.find((x) => x.id === 7);
    assert.equal(m.tage['2026-12-07'].stunden, 7.5);
    assert.equal(m.tage['2026-12-07'].von, '22:00');
    assert.equal(m.tage['2026-12-07'].bis, '06:00');
    assert.equal(m.tage['2026-12-08'], undefined);
  });

  await t.test('M-02: ab der ersten Unterschrift ist der Inhalt gesperrt; Unterschrift zurückziehen', async () => {
    await pol.putV(`/berichte/${nacht}`, { personal: [{ benutzerId: 7, von1: '22:00', bis1: '04:00', pauseMin: 0, segStunden: 2 }] });
    assert.equal((await pol.post(`/berichte/${nacht}/unterschrift`, { rolle: 'bh', name: 'Ing. Helga Auer', bildPng: sig })).status, 200);
    let r = await pol.putV(`/berichte/${nacht}`, { vorkommnisse: 'GEÄNDERT' });
    assert.equal(r.status, 409);
    assert.match(r.daten.fehler, /Inhalt gesperrt/);
    assert.equal((await pol.post(`/berichte/${nacht}/personal-aktualisieren`)).status, 409);
    assert.equal((await pol.del(`/berichte/${nacht}/unterschrift/an`)).status, 404);
    r = await pol.del(`/berichte/${nacht}/unterschrift/bh`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.daten.unterschriften, {});
    assert.equal((await pol.putV(`/berichte/${nacht}`, { vorkommnisse: 'Nachtbaustelle, Absicherung lt. Bescheid' })).status, 200);
    assert.equal((await pol.del(`/berichte/${nacht}/unterschrift/xx`)).status, 400);
    assert.ok(s.db.eins("SELECT COUNT(*) AS n FROM protokoll WHERE text LIKE '%zurückgezogen%'").n === 1);
  });

  await t.test('M-01 + M-07: SEG und Stunden aus freigegebenen Berichten haben Vorrang', async () => {
    const vorher = (await buero.get('/monat?monat=2026-12')).daten.mitarbeiter.find((x) => x.id === 7);
    assert.equal(vorher.seg, 0); // Entwurf zählt nicht
    assert.equal(vorher.tage['2026-12-07'].stunden, 7.5); // noch Stempelzeit
    assert.equal(vorher.tage['2026-12-07'].quelle, 'stempel');
    await pol.post(`/berichte/${nacht}/unterschrift`, { rolle: 'an', name: 'Josef Haidbauer', bildPng: sig });
    await pol.post(`/berichte/${nacht}/unterschrift`, { rolle: 'bh', name: 'Ing. Helga Auer', bildPng: sig });
    assert.equal((await pol.del(`/berichte/${nacht}/unterschrift/bh`)).status, 409); // vollständig unterschrieben
    const unterschrieben = (await buero.get('/monat?monat=2026-12')).daten.mitarbeiter.find((x) => x.id === 7);
    assert.equal(unterschrieben.seg, 0); // unterschrieben, aber noch nicht freigegeben
    assert.equal((await (await s.login(U.bauleiter)).post(`/berichte/${nacht}/freigeben`)).status, 200);
    const m = (await buero.get('/monat?monat=2026-12')).daten.mitarbeiter.find((x) => x.id === 7);
    assert.equal(m.seg, 2);
    assert.equal(m.tage['2026-12-07'].stunden, 6); // Korrektur des Poliers (22:00–04:00)
    assert.equal(m.tage['2026-12-07'].quelle, 'bericht');
    const woche = (await (await s.login(7)).get('/zeit/woche?datum=2026-12-07')).daten;
    assert.equal(woche.tage[0].stunden, 6);
    assert.equal(woche.tage[0].quelle, 'bericht');
  });
});

test('B-07: Abwesenheiten – nur genehmigte zählen; Genehmigen, Ablehnen, Löschen', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const ma = await s.login(U.mitarbeiter);
  const pol = await s.login(U.polier);
  const bl = await s.login(U.bauleiter);
  const buero = await s.login(U.buero);
  const ids = {};

  await t.test('B-07: beantragter Urlaub zählt nicht in Monat, Lohn- und BUAK-Export', async () => {
    const u0 = (await buero.get('/monat?monat=2026-11')).daten.mitarbeiter.find((x) => x.id === 2).u;
    for (const d of ['2026-11-16', '2026-11-17', '2026-11-18']) {
      const r = await ma.post('/abwesenheiten', { benutzerId: 2, datum: d, code: 'U' });
      assert.equal(r.status, 201);
      assert.equal(r.daten.status, 'beantragt');
      ids[d] = r.daten.id;
    }
    const m = (await buero.get('/monat?monat=2026-11')).daten;
    const lukas = m.mitarbeiter.find((x) => x.id === 2);
    assert.equal(lukas.u, u0);
    assert.equal(lukas.tage['2026-11-17'].codeStatus, 'beantragt');
    assert.equal(m.beantragt.filter((b) => b.benutzerId === 2 && ['2026-11-16', '2026-11-17', '2026-11-18'].includes(b.datum)).length, 3);
    const csv = (await buero.get('/monat/export.csv?monat=2026-11')).daten.toString('utf8');
    assert.ok(!/;17\.11\.2026;Di;;;;0;U;/.test(csv));
    assert.match(csv, /Hinweis;Beantragt, nicht genehmigt \(nicht gezählt\): Lukas Brandstätter 17\.11\.2026 U/);
    const buak = (await buero.get('/monat/buak.csv?monat=2026-11')).daten.toString('utf8');
    const zeile = buak.split('\r\n').find((z) => z.startsWith('1002;'));
    assert.equal(zeile.split(';')[5], String(u0)); // Urlaubstage
    // Büro bekommt eine Benachrichtigung
    assert.ok((await buero.get('/benachrichtigungen')).daten.some((n) => n.typ === 'abwesenheit' && /Lukas Brandstätter/.test(n.text)));
  });

  await t.test('B-07: GET /abwesenheiten mit Bereich', async () => {
    assert.ok((await ma.get('/abwesenheiten')).daten.every((a) => a.benutzerId === 2));
    const p = (await pol.get('/abwesenheiten')).daten;
    assert.ok(p.some((a) => a.benutzerId === 2));
    assert.ok(p.every((a) => [1, 2, 3, 4, 5, 6, 7].includes(a.benutzerId)));
    const b = (await bl.get('/abwesenheiten')).daten;
    assert.ok(b.some((a) => a.benutzerId === 2) && !b.some((a) => a.benutzerId === 24)); // 26-035 nicht seine Baustelle
    const alle = (await buero.get('/abwesenheiten?status=beantragt')).daten;
    assert.ok(alle.length >= 3 && alle.every((a) => a.status === 'beantragt'));
    assert.equal((await buero.get('/abwesenheiten?status=offen')).status, 400);
  });

  await t.test('B-07: Genehmigen/Ablehnen nur Büro/Lohn; zählt danach', async () => {
    assert.equal((await ma.put(`/abwesenheiten/${ids['2026-11-16']}`, { status: 'genehmigt' })).status, 403);
    assert.equal((await pol.put(`/abwesenheiten/${ids['2026-11-16']}`, { status: 'genehmigt' })).status, 403);
    assert.equal((await bl.put(`/abwesenheiten/${ids['2026-11-16']}`, { status: 'genehmigt' })).status, 403);
    assert.equal((await buero.put(`/abwesenheiten/${ids['2026-11-16']}`, { status: 'vielleicht' })).status, 400);
    const u0 = (await buero.get('/monat?monat=2026-11')).daten.mitarbeiter.find((x) => x.id === 2).u;
    const r = await buero.put(`/abwesenheiten/${ids['2026-11-16']}`, { status: 'genehmigt' });
    assert.equal(r.status, 200);
    assert.equal(r.daten.status, 'genehmigt');
    assert.equal(r.daten.entschiedenVon, U.buero);
    assert.equal((await buero.put(`/abwesenheiten/${ids['2026-11-17']}`, { status: 'abgelehnt' })).status, 200);
    const m = (await buero.get('/monat?monat=2026-11')).daten.mitarbeiter.find((x) => x.id === 2);
    assert.equal(m.u, u0 + 1);
    assert.equal(m.tage['2026-11-16'].code, 'U');
    assert.ok(!m.tage['2026-11-17'] || !m.tage['2026-11-17'].code);
    assert.ok((await ma.get('/benachrichtigungen')).daten.some((n) => n.typ === 'abwesenheit' && /genehmigt/.test(n.text)));
    // abgelehnter Tag darf neu beantragt werden
    const neu = await ma.post('/abwesenheiten', { benutzerId: 2, datum: '2026-11-17', code: 'ZA' });
    assert.equal(neu.status, 200);
    assert.equal(neu.daten.status, 'beantragt');
    assert.equal((await ma.post('/abwesenheiten', { benutzerId: 2, datum: '2026-11-16', code: 'ZA' })).status, 409);
  });

  await t.test('B-07: Löschen – eigener offener Antrag ja, genehmigter nur Büro', async () => {
    assert.equal((await ma.del(`/abwesenheiten/${ids['2026-11-18']}`)).status, 200);
    assert.equal((await ma.del(`/abwesenheiten/${ids['2026-11-16']}`)).status, 403);
    assert.equal((await pol.del(`/abwesenheiten/${ids['2026-11-17']}`)).status, 403);
    assert.equal((await buero.del(`/abwesenheiten/${ids['2026-11-16']}`)).status, 200);
    assert.equal((await buero.del(`/abwesenheiten/${ids['2026-11-16']}`)).status, 404);
    assert.ok(s.db.eins("SELECT COUNT(*) AS n FROM protokoll WHERE art = 'abwesenheit' AND text = 'Abwesenheit gelöscht'").n === 2);
  });

  await t.test('B-07: Rückdatierung begrenzt', async () => {
    assert.equal((await ma.post('/abwesenheiten', { benutzerId: 2, datum: '2026-11-04', code: 'U' })).status, 400); // 8 Tage
    assert.equal((await ma.post('/abwesenheiten', { benutzerId: 2, datum: '2026-11-06', code: 'ZA' })).status, 409); // schon K (genehmigt)
    assert.equal((await pol.post('/abwesenheiten', { benutzerId: 4, datum: '2026-11-06', code: 'SW' })).status, 400); // > 3 Tage
    assert.equal((await pol.post('/abwesenheiten', { benutzerId: 4, datum: '2026-11-10', code: 'SW' })).status, 201);
    assert.equal((await buero.post('/abwesenheiten', { benutzerId: 4, datum: '2026-09-01', code: 'K' })).status, 400); // > 62 Tage
  });

  await t.test('B-07: beantragte Abwesenheit erscheint nicht im Bericht', async () => {
    await ma.post('/abwesenheiten', { benutzerId: 2, datum: '2026-11-12', code: 'ZA' });
    const b = await pol.post('/berichte', { baustelleId: BS.pitten, datum: '2026-11-12' });
    assert.ok(!b.daten.personal.some((p) => p.benutzerId === 2 && p.code === 'ZA'));
    assert.ok(b.daten.personal.some((p) => p.benutzerId === 3 && p.code === 'U')); // genehmigter Urlaub aus den Testdaten
  });
});
