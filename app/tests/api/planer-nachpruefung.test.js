'use strict';
/**
 * Korrekturen Nachprüfung – Bereich Planer (API.md 14.1). Feste Uhr: Do 12.11.2026 10:24.
 * Jeder Test benennt den Befund (N-…), den er absichert.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');
const P = require('../../server/planer');

const HEUTE = '2026-11-12', FR = '2026-11-13', SA = '2026-11-14', MO = '2026-11-16', DI = '2026-11-17';
const LANG = { feldMin: 60 * 24 * 60, bueroMin: 60 * 24 * 60, maxH: 24 * 60 };
const LKW = 4; // A04, einsatzbereit
const letzteId = (s) => s.db.eins('SELECT COALESCE(MAX(id), 0) AS m FROM benachrichtigung').m;
const planMeldungen = (s, seit) => s.db.alle("SELECT * FROM benachrichtigung WHERE typ = 'plan' AND id > ? ORDER BY id", seit);
const sortiere = (l) => l.map((x) => x.join('|')).sort();
const art = (m) => (/^Ihre Partie/.test(m.titel) ? 'partie' : /entfällt/.test(m.titel) ? 'entfaellt' : /^Geändert/.test(m.titel) ? 'geaendert' : 'neu');
/** Text eines unkomprimierten pdfkit-PDFs (wie planer-druck.test.js) */
const pdfText = (buf) => [...buf.toString('latin1').matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((m) => [...m[1].matchAll(/\[([^\]]*)\]\s*TJ/g)]
  .map((t) => [...t[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join('')).join(' ')).join(' ');
const abwesend = (s, id, datum) => s.db.lauf("INSERT INTO abwesenheit (benutzer_id, datum, code, status, erfasst_von, erfasst) VALUES (?, ?, 'U', 'genehmigt', 101, '2026-11-01T08:00:00Z')", id, datum);

/** Probelauf, echtes Veröffentlichen und tatsächlich Gesendetes vergleichen (Vorschau = Versand) */
async function vergleiche(s, c, von, bis = von) {
  const dry = (await c.post('/plan/veroeffentlichen', { von, bis, vorschau: true })).daten;
  const vor = letzteId(s);
  const r = (await c.post('/plan/veroeffentlichen', { von, bis })).daten;
  const gesendet = planMeldungen(s, vor);
  assert.deepEqual(sortiere(dry.empfaenger.map((x) => [x.benutzerId, x.titel, x.text])), sortiere(gesendet.map((m) => [m.benutzer_id, m.titel, m.text])), 'Vorschau = Versand (Titel/Text)');
  assert.equal(r.benachrichtigt, gesendet.length, 'benachrichtigt = tatsächlich eingefügte Meldungen');
  assert.equal(dry.anzahl, gesendet.length);
  assert.equal(r.personen, new Set(gesendet.map((m) => m.benutzer_id)).size, 'personen = verschiedene Empfänger (N-094)');
  return { dry, r, gesendet: gesendet.map((m) => [m.benutzer_id, art(m)]) };
}

test('N-005/N-014: A→B→A und entfernt → wieder eingeteilt werden gemeldet (Schlüssel je Veröffentlichung)', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  const e = (await gf.post('/plan/einsaetze', { datum: FR, baustelleId: BS.pitten, beginn: '07:00', benutzerIds: [U.mitarbeiter] })).daten;
  await vergleiche(s, gf, FR);
  const ver = async () => (await gf.get(`/plan/woche?von=${FR}`)).daten.einsaetze.find((x) => x.id === e.id).version;
  await gf.put(`/plan/einsaetze/${e.id}`, { version: await ver(), beginn: '06:30' });
  let v = await vergleiche(s, gf, FR);
  assert.deepEqual(sortiere(v.gesendet), sortiere([[U.mitarbeiter, 'geaendert'], [U.polier, 'partie']]));
  // zurück auf 07:00 (früher schon gemeldeter Stand) – die Uhr steht still, trotzdem eigene Meldung
  await gf.put(`/plan/einsaetze/${e.id}`, { version: await ver(), beginn: '07:00' });
  v = await vergleiche(s, gf, FR);
  assert.deepEqual(sortiere(v.gesendet), sortiere([[U.mitarbeiter, 'geaendert'], [U.polier, 'partie']]), 'A→B→A wird gemeldet');
  assert.match(planMeldungen(s, 0).filter((m) => m.benutzer_id === U.mitarbeiter).pop().text, /07:00/);
  // entfernt → „entfällt“, wieder eingeteilt (gleicher Inhalt wie früher) → „neu“
  await gf.del(`/plan/einsaetze/${e.id}/personen/${U.mitarbeiter}`);
  v = await vergleiche(s, gf, FR);
  assert.ok(v.gesendet.some(([id, a]) => id === U.mitarbeiter && a === 'entfaellt'));
  await gf.post(`/plan/einsaetze/${e.id}/personen`, { benutzerIds: [U.mitarbeiter] });
  v = await vergleiche(s, gf, FR);
  assert.ok(v.gesendet.some(([id, a]) => id === U.mitarbeiter && a === 'neu'), JSON.stringify(v.gesendet));
  // unverändert erneut veröffentlichen → nichts
  assert.equal((await gf.post('/plan/veroeffentlichen', { von: FR })).daten.benachrichtigt, 0);
});

test('N-006: Probelauf über mehrere Tage = echter Lauf; nur am Zwischentag Abwesende bleiben am Folgetag eingeteilt', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  assert.equal((await gf.post('/plan/einsaetze', { datum: HEUTE, baustelleId: BS.pitten, beginn: '07:00', benutzerIds: [U.mitarbeiter, U.polier, 3], anlageIds: [LKW], fahrer: { [LKW]: 3 } })).status, 201);
  abwesend(s, 3, FR); // nur am Freitag
  const mo0 = (await gf.get(`/plan/woche?von=${MO}`)).daten.einsaetze.find((x) => x.datum === MO);
  assert.deepEqual(mo0.personen.map((p) => p.benutzerId).sort(), [1, 2, 3]);
  // nur den Freitag veröffentlichen → die Mo-Vorschau behält Person 3 (samt Fahrer-Zuteilung)
  await vergleiche(s, gf, FR);
  const fr = (await gf.get(`/plan/woche?von=${FR}`)).daten.einsaetze.find((x) => x.datum === FR);
  assert.deepEqual(fr.personen.map((p) => p.benutzerId).sort(), [1, 2]);
  const mo = (await gf.get(`/plan/woche?von=${MO}`)).daten.einsaetze.find((x) => x.datum === MO);
  assert.equal(mo.vorschau, true);
  assert.deepEqual(mo.personen.map((p) => p.benutzerId).sort(), [1, 2, 3], 'Person 3 fehlt nur am Freitag');
  assert.equal(mo.anlagen[0].fahrer && mo.anlagen[0].fahrer.benutzerId, 3);
  // Mo–Di in einem Lauf: Vorschau = Versand, Person 3 bekommt ihre Meldung für Montag und ist eingeteilt
  const v = await vergleiche(s, gf, MO, DI);
  assert.ok(v.dry.empfaenger.some((x) => x.benutzerId === 3 && x.datum === MO && x.art === 'neu'));
  assert.ok(s.db.eins('SELECT inhalt FROM plan_mitteilung WHERE benutzer_id = 3 AND datum = ?', MO).inhalt);
  const moGespeichert = P.ladeEinsaetze(s.db, MO, MO)[0];
  assert.deepEqual(moGespeichert.personen.map((p) => p.benutzer_id).sort(), [1, 2, 3]);
});

test('N-006: Fr–Mo in einem Lauf (Abwesenheit am ersten Tag) – Vorschau = Versand', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  await gf.post('/plan/einsaetze', { datum: HEUTE, baustelleId: BS.pitten, beginn: '07:00', benutzerIds: [U.mitarbeiter, U.polier, 3] });
  abwesend(s, 3, FR);
  const v = await vergleiche(s, gf, FR, MO);
  assert.ok(v.dry.empfaenger.some((x) => x.benutzerId === 3 && x.datum === MO));
  assert.ok(s.db.eins('SELECT inhalt FROM plan_mitteilung WHERE benutzer_id = 3 AND datum = ?', MO).inhalt, 'Person 3 hat ihre Montags-Meldung');
});

test('N-015/N-020: Vorschau leitet nie aus Samstag/Sonntag/Feiertag ab', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  await gf.post('/plan/einsaetze', { datum: FR, baustelleId: BS.pitten, beginn: '07:00', benutzerIds: [U.mitarbeiter] });
  await gf.post('/plan/einsaetze', { datum: FR, baustelleId: BS.kogler, beginn: '07:00', benutzerIds: [9, 10] });
  assert.equal((await gf.post('/plan/einsaetze', { datum: SA, baustelleId: BS.pitten, beginn: '06:00', benutzerIds: [3] })).status, 201); // Samstagsschicht
  assert.equal(P.quelleTag(s.db, MO), FR);
  const w = (await gf.get(`/plan/woche?von=${MO}`)).daten;
  assert.equal(w.tage.find((x) => x.datum === MO).quelleDatum, FR);
  assert.deepEqual(w.einsaetze.filter((x) => x.datum === MO).map((x) => x.baustelleId).sort(), [BS.pitten, BS.kogler]);
  // Mo-Einsatz anlegen materialisiert den Freitag, nicht den Samstag (keine doppelte Einteilung)
  assert.equal((await gf.post('/plan/einsaetze', { datum: MO, baustelleId: BS.reisinger, benutzerIds: [14] })).status, 201);
  const mo = P.ladeEinsaetze(s.db, MO, MO);
  assert.deepEqual(mo.map((e) => [e.baustelle_id, e.personen.map((p) => p.benutzer_id).sort((a, b) => a - b).join(',')]).sort(), [[BS.pitten, '2'], [BS.kogler, '9,10'], [BS.reisinger, '14']].sort());
  // Feiertag: Di 08.12.2026 (Mariä Empfängnis) ist nie Quelle
  s.uhr.setze('2026-12-04T08:00:00.000Z');
  await gf.post('/plan/einsaetze', { datum: '2026-12-07', baustelleId: BS.pitten, benutzerIds: [U.mitarbeiter] });
  await gf.post('/plan/einsaetze', { datum: '2026-12-08', baustelleId: BS.kogler, benutzerIds: [9] });
  assert.equal(P.quelleTag(s.db, '2026-12-09'), '2026-12-07');
});

test('N-016: „Vorwoche übernehmen“ mit baustelleIds speichert zuerst den ganzen Vorschau-Tag', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  const bl = await s.login(U.bauleiter);
  for (const [bs, p] of [[BS.pitten, 2], [BS.kogler, 9], [BS.reisinger, 14]]) assert.equal((await bl.post('/plan/einsaetze', { datum: MO, baustelleId: bs, benutzerIds: [p] })).status, 201);
  const zm = '2026-11-23', zd = '2026-11-24';
  let w = (await bl.get(`/plan/woche?von=${zm}`)).daten;
  assert.equal(w.tage.find((x) => x.datum === zm).vorschau, true);
  const r = await bl.post('/plan/vorwoche-uebernehmen', { von: zm, baustelleIds: [BS.pitten] });
  assert.equal(r.status, 200);
  assert.ok(r.daten.uebersprungen.some((u) => u.typ === 'vorhanden'), 'die Pitten-Zelle stand schon in der Vorschau');
  w = (await bl.get(`/plan/woche?von=${zm}`)).daten;
  assert.equal(w.tage.find((x) => x.datum === zm).vorschau, false);
  assert.deepEqual(w.einsaetze.filter((x) => x.datum === zm).map((x) => x.baustelleId).sort(), [BS.pitten, BS.kogler, BS.reisinger], 'keine Vorschau-Zelle verschwindet');
  assert.deepEqual(w.einsaetze.filter((x) => x.datum === zd).map((x) => x.baustelleId).sort(), [BS.pitten, BS.kogler, BS.reisinger]);
});

test('N-021/N-041/N-060: verschobene veröffentlichte Fuhre, neue Fuhren zählen als unveröffentlicht', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  const fahrer = await s.login(9);
  const woche = async (d) => (await gf.get(`/plan/woche?von=${d}`)).daten.unveroeffentlicht;
  const u0 = await woche(FR);
  const f = (await gf.post('/plan/fuhren', { datum: FR, anlageId: LKW, fahrerId: 9, materialId: 4, menge: 10, einheit: 't', nach: { art: 'baustelle', baustelleId: BS.kogler } })).daten;
  assert.equal(await woche(FR), u0 + 1, 'neue, unveröffentlichte Fuhre zählt');
  await gf.post('/plan/veroeffentlichen', { von: FR });
  assert.equal(await woche(FR), u0);
  // geändert nach der Veröffentlichung zählt
  const g = (await gf.put(`/plan/fuhren/${f.id}`, { version: f.version, menge: 12 })).daten;
  assert.equal(await woche(FR), u0 + 1);
  await gf.post('/plan/veroeffentlichen', { von: FR });
  // auf Montag verschieben
  const r = await gf.put(`/plan/fuhren/${f.id}`, { version: g.version + 0, datum: MO });
  assert.equal(r.status, 200, JSON.stringify(r.daten));
  assert.notEqual(r.daten.id, f.id);
  assert.equal(r.daten.ersetzt, f.id);
  assert.equal(r.daten.datum, MO);
  assert.equal(r.daten.menge, 12);
  assert.equal(s.db.eins('SELECT status FROM plan_fuhre WHERE id = ?', f.id).status, 'storniert');
  assert.equal(await woche(FR), u0 + 1, 'der alte Tag hat eine offene Änderung');
  const dryFr = (await gf.post('/plan/veroeffentlichen', { von: FR, vorschau: true })).daten;
  assert.deepEqual(dryFr.empfaenger.map((x) => [x.benutzerId, x.art, x.titel]), [[9, 'entfaellt', 'Fuhre entfällt am Fr 13.11.']]);
  await gf.post('/plan/veroeffentlichen', { von: FR, bis: MO });
  const ich = (await fahrer.get(`/plan/ich?von=${FR}&bis=${MO}`)).daten.tage;
  assert.deepEqual(ich.filter((x) => x.fuhren.length).map((x) => [x.datum, x.fuhren.map((y) => y.id)]), [[MO, [r.daten.id]]], 'die Fuhre steht nur noch am Montag');
  // Erinnerung 17:00 nennt auch offene Fuhren (N-060)
  await gf.post('/plan/fuhren', { datum: MO, anlageId: LKW, fahrerId: 9, materialId: 4, menge: 5, einheit: 't', nach: { art: 'baustelle', baustelleId: BS.kogler } });
  s.uhr.setze('2026-11-13T16:05:00.000Z'); // Fr 17:05
  const vor = letzteId(s);
  P.pruefeErinnerung(s.app.bt);
  const er = planMeldungen(s, vor).filter((m) => m.benutzer_id === U.buero);
  assert.equal(er.length, 1);
  assert.match(er[0].text, /1 Fuhre für Mo 16\.11\. ist neu, geändert oder storniert/);
});

test('N-022/N-023/N-040: erledigte Fuhre nicht stornierbar, stornierte nie im Bericht', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  const f = (await gf.post('/plan/fuhren', { datum: HEUTE, anlageId: LKW, fahrerId: 9, materialId: 4, menge: 7, einheit: 't', nach: { art: 'baustelle', baustelleId: BS.kogler } })).daten;
  await gf.post('/plan/veroeffentlichen', { von: HEUTE });
  s.db.lauf('DELETE FROM bericht WHERE baustelle_id = ? AND datum = ?', BS.kogler, HEUTE);
  await gf.post(`/plan/fuhren/${f.id}/status`, { status: 'erledigt' });
  assert.equal(s.db.eins('SELECT bericht_status FROM plan_fuhre WHERE id = ?', f.id).bericht_status, 'vorschlag');
  const d = await gf.del(`/plan/fuhren/${f.id}`);
  assert.equal(d.status, 409);
  assert.equal(s.db.eins('SELECT status FROM plan_fuhre WHERE id = ?', f.id).status, 'erledigt');
  assert.equal((await gf.post('/plan/veroeffentlichen', { von: HEUTE, vorschau: true })).daten.anzahl, 0, 'kein „Fuhre entfällt“');
  // Altbestand: stornierte Fuhre mit Vorschlag → weder Vorschlag noch Übernahme
  s.db.lauf("UPDATE plan_fuhre SET status = 'storniert' WHERE id = ?", f.id);
  const b = (await gf.post('/berichte', { baustelleId: BS.kogler, datum: HEUTE })).daten;
  assert.deepEqual(b.fuhrenVorschlag, []);
  const u = await gf.post(`/berichte/${b.id}/fuhren-uebernehmen`, { fuhreIds: [f.id] });
  assert.equal(u.daten.uebernommen, 0);
  assert.ok(!u.daten.bericht.material.some((m) => m.materialId === 4));
  // unveröffentlichte, vom Büro erledigte Fuhre: auch nicht hart löschbar
  const f2 = (await gf.post('/plan/fuhren', { datum: HEUTE, anlageId: LKW, materialId: 4, menge: 3, einheit: 't', nach: { art: 'baustelle', baustelleId: BS.kogler } })).daten;
  await gf.post(`/plan/fuhren/${f2.id}/status`, { status: 'erledigt' });
  assert.equal((await gf.del(`/plan/fuhren/${f2.id}`)).status, 409);
  assert.ok(s.db.eins('SELECT id FROM plan_fuhre WHERE id = ?', f2.id));
});

test('N-039/N-062: zweites „erledigt“ mit anderer Menge → 409, gleiche Meldung harmlos', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  const pol = await s.login(U.polier);
  const b = await pol.post('/berichte', { baustelleId: BS.pitten, datum: HEUTE });
  const bid = b.daten.id;
  const vorher = (s.db.eins('SELECT menge FROM bericht_material WHERE bericht_id = ? AND material_id = 4', bid) || { menge: 0 }).menge;
  const f = (await gf.post('/plan/fuhren', { datum: HEUTE, anlageId: LKW, fahrerId: U.mitarbeiter, materialId: 4, menge: 10, einheit: 't', nach: { art: 'baustelle', baustelleId: BS.pitten } })).daten;
  await gf.post('/plan/veroeffentlichen', { von: HEUTE });
  const ma = await s.login(U.mitarbeiter);
  assert.equal((await ma.post(`/plan/fuhren/${f.id}/status`, { status: 'erledigt', menge: 10 })).status, 200);
  assert.equal(s.db.eins('SELECT menge FROM bericht_material WHERE bericht_id = ? AND material_id = 4', bid).menge, vorher + 10);
  const r = await ma.post(`/plan/fuhren/${f.id}/status`, { status: 'erledigt', menge: 14 });
  assert.equal(r.status, 409);
  assert.equal(JSON.parse(s.db.eins('SELECT erledigt FROM plan_fuhre WHERE id = ?', f.id).erledigt).menge, 10);
  assert.equal((await ma.post(`/plan/fuhren/${f.id}/status`, { status: 'erledigt', menge: 10, einheit: 't' })).status, 200, 'Wiederholung aus der Warteschlange');
  assert.equal(s.db.eins('SELECT menge FROM bericht_material WHERE bericht_id = ? AND material_id = 4', bid).menge, vorher + 10);
});

test('N-043: Wetter-Konflikt auch an Vorschau-Zellen', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  s.db.lauf('UPDATE baustelle SET lat = 47.71, lng = 16.18 WHERE id = ?', BS.pitten);
  const regen = JSON.stringify({ stunden: [{ zeit: '08:00', temperatur: 6, niederschlag: 3, wind: 10 }] });
  for (const d of [FR, MO]) s.db.lauf('INSERT INTO wetter_cache (baustelle_id, datum, abgerufen, lat, lng, daten) VALUES (?, ?, ?, 47.71, 16.18, ?)', BS.pitten, d, '2026-11-12T09:00:00Z', regen);
  await gf.post('/plan/einsaetze', { datum: FR, baustelleId: BS.pitten, benutzerIds: [U.mitarbeiter] });
  const w = (await gf.get(`/plan/woche?von=${MO}`)).daten;
  const mo = w.einsaetze.find((x) => x.datum === MO && x.baustelleId === BS.pitten);
  assert.equal(mo.vorschau, true);
  assert.ok(mo.konflikte.some((k) => k.typ === 'wetter'), JSON.stringify(mo.konflikte));
  assert.ok(w.konflikte.some((k) => k.typ === 'wetter' && k.datum === MO && k.baustelleId === BS.pitten));
});

test('N-058/N-083: Samstagseinsatz am Freitag als nächster Einsatztag; geaendert in „Mein Einsatz“; Erinnerung prüft den Samstag', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  s.uhr.setze('2026-11-13T09:00:00.000Z'); // Fr 10:00
  const gf = await s.login(U.gf);
  const pol = await s.login(U.polier);
  const ma = await s.login(U.mitarbeiter);
  const sa = (await gf.post('/plan/einsaetze', { datum: SA, baustelleId: BS.pitten, beginn: '06:00', benutzerIds: [U.mitarbeiter] })).daten;
  await gf.post('/plan/einsaetze', { datum: MO, baustelleId: BS.kogler, beginn: '07:00', benutzerIds: [U.mitarbeiter] });
  await gf.post('/plan/veroeffentlichen', { von: SA, bis: MO });
  let ich = (await ma.get('/plan/ich')).daten;
  assert.equal(ich.morgen && ich.morgen.datum, SA, 'Samstag vor Montag');
  assert.equal(ich.tage.find((x) => x.datum === SA).geaendert, false);
  assert.equal((await pol.get('/plan/partie')).daten.datum, SA);
  assert.equal((await pol.get(`/plan/partie?datum=${MO}`)).daten.datum, MO);
  // Samstag geändert und veröffentlicht → geaendert true
  await gf.put(`/plan/einsaetze/${sa.id}`, { version: P.ladeEinsatz(s.db, sa.id).version, beginn: '05:30' });
  // Erinnerung um 17:00 nennt den geänderten Samstag
  s.uhr.setze('2026-11-13T16:05:00.000Z');
  const vor = letzteId(s);
  P.pruefeErinnerung(s.app.bt);
  const er = planMeldungen(s, vor).filter((m) => m.benutzer_id === U.buero);
  assert.equal(er.length, 1);
  assert.equal(er[0].titel, 'Einteilung für morgen noch nicht veröffentlicht');
  assert.match(er[0].text, /Sa 14\.11\./);
  await gf.post('/plan/veroeffentlichen', { von: SA });
  ich = (await ma.get('/plan/ich')).daten;
  assert.equal(ich.tage.find((x) => x.datum === SA).geaendert, true);
  assert.equal(ich.tage.find((x) => x.datum === MO).geaendert, false);
});

test('N-059/N-084/N-082: Partie-Meldungen bei gelöschtem, geleertem und gleich neu angelegtem Einsatz', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  // Pitten: Polier 1 (nicht selbst eingeteilt), Personen 2 und 3
  let e = (await gf.post('/plan/einsaetze', { datum: FR, baustelleId: BS.pitten, beginn: '06:30', treffpunkt: 'Bauhof', benutzerIds: [2, 3] })).daten;
  let v = await vergleiche(s, gf, FR);
  assert.deepEqual(sortiere(v.gesendet), sortiere([[2, 'neu'], [3, 'neu'], [1, 'partie']]));
  // N-082: löschen und gleich identisch neu anlegen → niemand wird benachrichtigt
  await gf.del(`/plan/einsaetze/${e.id}`);
  e = (await gf.post('/plan/einsaetze', { datum: FR, baustelleId: BS.pitten, beginn: '06:30', treffpunkt: 'Bauhof', benutzerIds: [2, 3] })).daten;
  v = await vergleiche(s, gf, FR);
  assert.deepEqual(v.gesendet, [], 'gleicher Inhalt → keine Meldung');
  // N-084: Zelle leeren → Partie-Meldung „entfällt“ statt „0 Personen, 0 Geräte“
  await gf.del(`/plan/einsaetze/${e.id}/personen/2`);
  await gf.del(`/plan/einsaetze/${e.id}/personen/3`);
  let dry = (await gf.post('/plan/veroeffentlichen', { von: FR, vorschau: true })).daten;
  const p1 = dry.empfaenger.find((x) => x.art === 'partie');
  assert.equal(p1.titel, 'Ihre Partie morgen: WHA Pitten entfällt');
  assert.doesNotMatch(p1.text, /0 Personen/);
  // wieder einteilen, veröffentlichen, dann ganz löschen → N-059: Polier bekommt „entfällt“
  await gf.post(`/plan/einsaetze/${e.id}/personen`, { benutzerIds: [2, 3] });
  await vergleiche(s, gf, FR);
  await gf.del(`/plan/einsaetze/${e.id}`);
  v = await vergleiche(s, gf, FR);
  assert.deepEqual(sortiere(v.gesendet), sortiere([[2, 'entfaellt'], [3, 'entfaellt'], [1, 'partie']]));
  dry = planMeldungen(s, 0).filter((m) => m.benutzer_id === 1).pop();
  assert.equal(dry.titel, 'Ihre Partie morgen: WHA Pitten entfällt');
});

test('N-077/N-079: Tagesplan-PDF – Entwurf nach geänderter Fuhre, Filter nur gezeigte Baustellen', async (t) => {
  const s = await starte({ test: true, sitzung: LANG, pdfUnkomprimiert: true });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  const entwurf = async (q) => { const r = await gf.get(`/plan/tag.pdf?datum=${FR}${q || ''}`); assert.equal(r.status, 200); return pdfText(r.daten).includes('ENTWURF'); };
  await gf.post('/plan/einsaetze', { datum: FR, baustelleId: BS.pitten, beginn: '07:00', benutzerIds: [2] });
  const k = (await gf.post('/plan/einsaetze', { datum: FR, baustelleId: BS.kogler, beginn: '07:00', benutzerIds: [9] })).daten;
  const f = (await gf.post('/plan/fuhren', { datum: FR, anlageId: LKW, fahrerId: 9, materialId: 4, menge: 10, einheit: 't', nach: { art: 'baustelle', baustelleId: BS.pitten } })).daten;
  await gf.post('/plan/veroeffentlichen', { von: FR });
  assert.equal(await entwurf(), false);
  // nur Kogler geändert → gefilterter Pitten-Ausdruck bleibt ohne Wasserzeichen
  await gf.put(`/plan/einsaetze/${k.id}`, { version: P.ladeEinsatz(s.db, k.id).version, beginn: '06:00' });
  assert.equal(await entwurf(`&baustelleIds=${BS.pitten}`), false, 'N-079');
  assert.equal(await entwurf(), true);
  await gf.post('/plan/veroeffentlichen', { von: FR });
  // Fuhre nach der Veröffentlichung geändert → Entwurf
  await gf.put(`/plan/fuhren/${f.id}`, { version: s.db.eins('SELECT version FROM plan_fuhre WHERE id = ?', f.id).version, menge: 25 });
  assert.equal(await entwurf(`&baustelleIds=${BS.pitten}`), true, 'N-077');
});

test('N-092: Fuhre kopieren überspringt Feiertage und Wochenenden', async (t) => {
  const s = await starte({ test: true, sitzung: LANG, start: '2026-12-07T15:30:00.000Z' });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  const f = (await gf.post('/plan/fuhren', { datum: '2026-12-07', anlageId: LKW, materialId: 4, menge: 10, einheit: 't', nach: { art: 'baustelle', baustelleId: BS.pitten } })).daten;
  const r = await gf.post('/plan/fuhren/kopieren', { id: f.id, tage: ['2026-12-08', '2026-12-09', '2026-12-12'] });
  assert.equal(r.status, 200);
  assert.equal(r.daten.angelegt.length, 1);
  assert.deepEqual(r.daten.uebersprungen.map((x) => x.datum), ['2026-12-08', '2026-12-12']);
  assert.match(r.daten.uebersprungen[0].text, /Feiertag/);
  assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM plan_fuhre WHERE datum = '2026-12-08'").n, 0);
});

test('N-114: Zeitplan-Phasenzähler auch für den Polier (ohne preise_sehen) vollständig', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  s.db.lauf("UPDATE baustelle SET phase = 'schlussrechnung' WHERE id = ?", BS.pitten);
  const pol = await s.login(U.polier);
  const z = (await pol.get('/plan/zeitplan')).daten;
  assert.ok(z.bauvorhaben.some((b) => b.baustelle.phase === 'schlussrechnung'));
  assert.ok(z.phasen.some((x) => x.phase === 'schlussrechnung' && x.anzahl === 1), JSON.stringify(z.phasen));
});
