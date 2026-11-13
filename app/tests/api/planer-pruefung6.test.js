'use strict';
/** Prüfbericht 6 – Planer: G-01 (gelöschter Tag bleibt gespeichert), G-05 (Freitag/Feiertag), G-12 (Polier-Meldungen = Vorschau), G-14 (Löschen = unveröffentlichte Änderung) */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');

const DO = '2026-11-12', FR = '2026-11-13', MO = '2026-11-16';
const LANG = { feldMin: 60 * 24 * 60, bueroMin: 60 * 24 * 60, maxH: 24 * 60 };
const planMeldungen = (s, seit) => s.db.alle("SELECT * FROM benachrichtigung WHERE typ = 'plan' AND id > ? ORDER BY id", seit);
const letzteId = (s) => s.db.eins('SELECT COALESCE(MAX(id), 0) AS m FROM benachrichtigung').m;
const tagVon = (w, d) => w.tage.find((t) => t.datum === d);

test('G-01: letzten veröffentlichten Einsatz löschen → Tag bleibt gespeichert, Veröffentlichen meldet „entfällt“', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  assert.equal((await gf.post('/plan/einsaetze', { datum: DO, baustelleId: BS.pitten, beginn: '07:00', benutzerIds: [U.mitarbeiter, U.polier] })).status, 201);
  assert.equal((await gf.post('/plan/tag/uebernehmen', { datum: FR })).daten.angelegt, 1);
  assert.equal((await gf.post('/plan/veroeffentlichen', { von: FR })).status, 200);
  const fr = (await gf.get(`/plan/woche?von=${FR}`)).daten.einsaetze.filter((e) => e.datum === FR);
  assert.equal(fr.length, 1);
  const u0 = (await gf.get(`/plan/woche?von=${FR}`)).daten.unveroeffentlicht; // Do ist noch unveröffentlicht
  assert.equal((await gf.del(`/plan/einsaetze/${fr[0].id}`)).status, 200);
  let w = (await gf.get(`/plan/woche?von=${FR}`)).daten;
  assert.equal(tagVon(w, FR).vorschau, false, 'Tag wird nicht wieder Vorschau');
  assert.equal(w.einsaetze.filter((e) => e.datum === FR).length, 0);
  assert.equal(w.unveroeffentlicht, u0 + 1, 'G-14: Löschen zählt als unveröffentlichte Änderung');
  const vor = letzteId(s);
  const dry = (await gf.post('/plan/veroeffentlichen', { von: FR, vorschau: true })).daten;
  assert.deepEqual(dry.empfaenger.map((e) => [e.benutzerId, e.art]).sort(), [[U.polier, 'entfaellt'], [U.mitarbeiter, 'entfaellt']].sort());
  assert.equal(letzteId(s), vor, 'Löschen und Vorschau senden nichts');
  const r = await gf.post('/plan/veroeffentlichen', { von: FR });
  assert.equal(r.daten.einsaetze, 0);
  const m = planMeldungen(s, vor);
  assert.deepEqual(m.map((x) => [x.benutzer_id, x.titel]).sort(), [[U.polier, 'Einsatz entfällt am Fr 13.11.'], [U.mitarbeiter, 'Einsatz entfällt am Fr 13.11.']].sort());
  assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM plan_einsatz WHERE datum = ?', FR).n, 0, 'nichts wieder angelegt');
  w = (await gf.get(`/plan/woche?von=${FR}`)).daten;
  assert.equal(tagVon(w, FR).vorschau, false);
  assert.equal(w.unveroeffentlicht, u0);
  // erneut veröffentlichen: niemand mehr
  assert.equal((await gf.post('/plan/veroeffentlichen', { von: FR })).daten.benachrichtigt, 0);
});

test('G-01/G-14: einen von mehreren Einsätzen bzw. eine Fuhre löschen → nur Betroffene, erst beim Veröffentlichen', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  assert.equal((await gf.post('/plan/einsaetze', { datum: FR, baustelleId: BS.pitten, beginn: '07:00', benutzerIds: [U.mitarbeiter, U.polier] })).status, 201);
  const k = await gf.post('/plan/einsaetze', { datum: FR, baustelleId: BS.kogler, beginn: '07:00', benutzerIds: [9], anlageIds: [4], fahrer: { 4: 9 } });
  assert.equal(k.status, 201);
  const f = await gf.post('/plan/fuhren', { datum: FR, anlageId: 4, fahrerId: 9, materialId: 4, menge: 10, einheit: 't', nach: { art: 'baustelle', baustelleId: BS.kogler } });
  assert.equal(f.status, 201, JSON.stringify(f.daten));
  await gf.post('/plan/veroeffentlichen', { von: FR });
  // Fuhre löschen: keine sofortige Meldung, aber unveröffentlichte Änderung
  let vor = letzteId(s);
  assert.equal((await gf.del(`/plan/fuhren/${f.daten.id}`)).status, 200);
  assert.equal(letzteId(s), vor, 'Fuhre löschen sendet nichts sofort');
  assert.equal((await gf.get(`/plan/woche?von=${FR}`)).daten.unveroeffentlicht, 1);
  let dry = (await gf.post('/plan/veroeffentlichen', { von: FR, vorschau: true })).daten;
  assert.deepEqual(dry.empfaenger.map((e) => [e.benutzerId, e.art]), [[9, 'geaendert']]); // Fahrer: Fuhre weg, Einsatz bleibt
  assert.match(dry.empfaenger[0].text, /^Fuhre .+, Grube Breitenau → .*Kogler.* entfällt · /, dry.empfaenger[0].text);
  {
    // Vorschau = Versand (Titel und Text), danach wieder veröffentlicht
    const v0 = letzteId(s);
    await gf.post('/plan/veroeffentlichen', { von: FR });
    const m = planMeldungen(s, v0);
    assert.deepEqual(m.map((x) => [x.benutzer_id, x.titel, x.text]), dry.empfaenger.map((e) => [e.benutzerId, e.titel, e.text]));
  }
  // Einsatz Kogler löschen → Person 9 entfällt; Pitten-Personen bleiben unberührt
  assert.equal((await gf.del(`/plan/einsaetze/${k.daten.id}`)).status, 200);
  const w = (await gf.get(`/plan/woche?von=${FR}`)).daten;
  assert.equal(tagVon(w, FR).vorschau, false);
  assert.equal(w.unveroeffentlicht, 1);
  dry = (await gf.post('/plan/veroeffentlichen', { von: FR, vorschau: true })).daten;
  assert.deepEqual(dry.empfaenger.map((e) => [e.benutzerId, e.art]), [[9, 'entfaellt']]);
  vor = letzteId(s);
  await gf.post('/plan/veroeffentlichen', { von: FR });
  assert.deepEqual(planMeldungen(s, vor).map((x) => [x.benutzer_id, x.titel]), [[9, 'Einsatz entfällt am Fr 13.11.']]);
  assert.equal((await gf.get(`/plan/woche?von=${FR}`)).daten.unveroeffentlicht, 0);
});

test('G-12: Vorschau-Empfänger = tatsächlich Gesendetes; Personen-Notiz nur an die Person', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  const e = (await gf.post('/plan/einsaetze', { datum: FR, baustelleId: BS.pitten, beginn: '07:00', kolonnePolierIds: [U.polier] })).daten;
  const vergleiche = async (erwartet) => {
    const dry = (await gf.post('/plan/veroeffentlichen', { von: FR, vorschau: true })).daten;
    const vor = letzteId(s);
    const r = (await gf.post('/plan/veroeffentlichen', { von: FR })).daten;
    const gesendet = planMeldungen(s, vor).map((m) => [m.benutzer_id, /^Ihre Partie/.test(m.titel) ? 'partie' : /entfällt/.test(m.titel) ? 'entfaellt' : /^Geändert/.test(m.titel) ? 'geaendert' : 'neu']);
    const sortiere = (l) => l.map((x) => x.join(':')).sort();
    assert.deepEqual(sortiere(dry.empfaenger.map((x) => [x.benutzerId, x.art])), sortiere(gesendet), 'Vorschau = Versand');
    assert.equal(r.benachrichtigt, gesendet.length);
    assert.equal(dry.anzahl, gesendet.length);
    if (erwartet) assert.deepEqual(sortiere(gesendet), sortiere(erwartet));
    return gesendet;
  };
  const erst = await vergleiche();
  assert.ok(erst.some(([id, art]) => id === U.polier && art === 'partie'));
  // reine Personen-Notiz eines anderen → nur diese Person, nicht der Polier
  await gf.put(`/plan/einsaetze/${e.id}/personen/${U.mitarbeiter}`, { notiz: 'Schlüssel holen' });
  await vergleiche([[U.mitarbeiter, 'geaendert']]);
  // eigene Notiz des Poliers → er bekommt seine persönliche Meldung (keine zusätzliche Partie-Meldung)
  await gf.put(`/plan/einsaetze/${e.id}/personen/${U.polier}`, { notiz: 'Bauherr um 9 Uhr' });
  await vergleiche([[U.polier, 'geaendert']]);
  // Beginn geändert → alle Personen und der Polier (Partie)
  const akt = (await gf.get(`/plan/woche?von=${FR}`)).daten.einsaetze.find((x) => x.id === e.id);
  await gf.put(`/plan/einsaetze/${e.id}`, { version: akt.version, beginn: '06:00' });
  const g = await vergleiche();
  assert.ok(g.some(([id, art]) => id === U.polier && art === 'partie'));
  assert.equal(g.filter(([, art]) => art === 'geaendert').length, e.personen.length);
});

test('G-05: Freitag und vor Feiertagen ist „morgen“ der nächste Arbeitstag', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  s.uhr.setze('2026-11-13T15:30:00.000Z'); // Fr 13.11.2026, 16:30
  const gf = await s.login(U.gf);
  const pol = await s.login(U.polier);
  const ma = await s.login(U.mitarbeiter);
  const e = (await gf.post('/plan/einsaetze', { datum: MO, baustelleId: BS.pitten, beginn: '06:30', benutzerIds: [U.mitarbeiter, U.polier] })).daten;
  const vor = letzteId(s);
  await gf.post('/plan/veroeffentlichen', { von: MO });
  const m = planMeldungen(s, vor);
  assert.ok(m.some((x) => x.benutzer_id === U.mitarbeiter && x.titel === 'Einsatz am Mo 16.11.: WHA Pitten'), JSON.stringify(m.map((x) => x.titel)));
  assert.ok(m.some((x) => x.benutzer_id === U.mitarbeiter && /^Am Mo 16\.11\. 06:30/.test(x.text)));
  assert.ok(m.some((x) => x.benutzer_id === U.polier && x.titel.startsWith('Ihre Partie am Mo 16.11.')));
  assert.ok(!m.some((x) => /morgen/i.test(x.titel)));
  // Meine Partie ohne Datum: Montag; Mein Einsatz: morgen = Montag
  const p = (await pol.get('/plan/partie')).daten;
  assert.equal(p.datum, MO);
  assert.equal(p.einsaetze.length, 1);
  const ich = (await ma.get('/plan/ich')).daten;
  assert.equal(ich.morgen.datum, MO);
  // Erinnerung 17:00 am Freitag nennt den Montag
  const akt = (await gf.get(`/plan/woche?von=${MO}`)).daten.einsaetze.find((x) => x.id === e.id);
  await gf.put(`/plan/einsaetze/${e.id}`, { version: akt.version, beginn: '07:00' });
  s.uhr.setze('2026-11-13T16:05:00.000Z');
  s.app.bt.stuendlich();
  const er = s.db.alle("SELECT * FROM benachrichtigung WHERE schluessel = 'plan:erinnerung:2026-11-13'");
  assert.ok(er.length > 0);
  assert.ok(er.every((x) => x.titel === 'Einteilung für Montag 16.11. noch nicht veröffentlicht'), er[0] && er[0].titel);
  // vor einem Feiertag (Mo 07.12. → Mi 09.12.)
  s.uhr.setze('2026-12-07T15:30:00.000Z');
  await gf.post('/plan/einsaetze', { datum: '2026-12-09', baustelleId: BS.pitten, beginn: '06:30', benutzerIds: [U.mitarbeiter, U.polier] });
  const v2 = letzteId(s);
  await gf.post('/plan/veroeffentlichen', { von: '2026-12-09' });
  assert.ok(planMeldungen(s, v2).some((x) => x.benutzer_id === U.mitarbeiter && x.titel === 'Einsatz am Mi 09.12.: WHA Pitten'));
  assert.equal((await pol.get('/plan/partie')).daten.datum, '2026-12-09');
  assert.equal((await ma.get('/plan/ich')).daten.morgen.datum, '2026-12-09');
  // normaler Werktag: „morgen“
  s.uhr.setze('2026-12-09T15:30:00.000Z');
  await gf.post('/plan/einsaetze', { datum: '2026-12-10', baustelleId: BS.kogler, beginn: '06:30', benutzerIds: [9] });
  const v3 = letzteId(s);
  await gf.post('/plan/veroeffentlichen', { von: '2026-12-10' });
  assert.ok(planMeldungen(s, v3).some((x) => x.benutzer_id === 9 && /^Einsatz morgen: /.test(x.titel)), JSON.stringify(planMeldungen(s, v3).map((x) => x.titel)));
});

test('G-14: einzige Fuhre eines Fahrers gelöscht → „Fuhre entfällt am …“ (Vorschau = Versand)', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  const f = await gf.post('/plan/fuhren', { datum: FR, anlageId: 4, fahrerId: 9, materialId: 4, menge: 10, einheit: 't', nach: { art: 'baustelle', baustelleId: BS.kogler } });
  assert.equal(f.status, 201);
  await gf.post('/plan/veroeffentlichen', { von: FR });
  assert.equal((await gf.del(`/plan/fuhren/${f.daten.id}`)).status, 200);
  const dry = (await gf.post('/plan/veroeffentlichen', { von: FR, vorschau: true })).daten;
  assert.deepEqual(dry.empfaenger.map((e) => [e.benutzerId, e.art, e.titel]), [[9, 'entfaellt', 'Fuhre entfällt am Fr 13.11.']]);
  assert.match(dry.empfaenger[0].text, /^Fuhre entfällt am Fr 13\.11\. \(.+, Grube Breitenau → .+\)$/);
  const vor = letzteId(s);
  await gf.post('/plan/veroeffentlichen', { von: FR });
  assert.deepEqual(planMeldungen(s, vor).map((x) => [x.benutzer_id, x.titel, x.text]), dry.empfaenger.map((e) => [e.benutzerId, e.titel, e.text]));
});
