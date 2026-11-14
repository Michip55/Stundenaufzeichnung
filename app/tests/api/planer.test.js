'use strict';
/** Baustellenplaner (API.md 12.8–12.8c) und Fuhraufträge (12.8b) – feste Uhr: Do 12.11.2026 10:24 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS, euroFelder } = require('./hilfe');
const P = require('../../server/planer');
const F = require('../../server/fuhren');
const { demoUnterschrift } = require('../../server/png');

const FR = '2026-11-13', MO = '2026-11-16', DI = '2026-11-17', HEUTE = '2026-11-12';
const LKW = 4; // A04, einsatzbereit
const GESPERRT = 3; // A03 gesperrt (Demo)

test('Hilfsfunktionen: Arbeitstage, Maps-Links', () => {
  assert.equal(P.naechsterArbeitstag('2026-11-13'), '2026-11-16'); // Wochenende
  assert.equal(P.naechsterArbeitstag('2026-12-07'), '2026-12-09'); // 8.12. Feiertag
  assert.equal(P.vorigerArbeitstag('2026-11-16'), '2026-11-13');
  assert.deepEqual(F.koordinatenAus('https://www.google.com/maps/@47.6123,16.0456,15z'), { lat: 47.6123, lon: 16.0456 });
  assert.deepEqual(F.koordinatenAus('https://maps.google.com/?q=47.5,16.1'), { lat: 47.5, lon: 16.1 });
  assert.deepEqual(F.koordinatenAus('https://www.google.com/maps/place/X/data=!3d47.7!4d16.2'), { lat: 47.7, lon: 16.2 });
  assert.deepEqual(F.koordinatenAus('47.62, 16.05'), { lat: 47.62, lon: 16.05 });
  assert.deepEqual(F.koordinatenAus('@95.0,16.0'), { ungueltig: true });
  assert.equal(F.koordinatenAus('Feldgasse 7, Pitten'), null);
  assert.equal(F.mapsLink({ text: 'Feldgasse 7, Pitten' }), 'https://www.google.com/maps/dir/?api=1&destination=Feldgasse%207%2C%20Pitten');
  assert.equal(F.mapsLink({ lat: 47.6, lon: 16.1 }, { text: 'Grube' }), 'https://www.google.com/maps/dir/?api=1&origin=Grube&destination=47.6,16.1');
});

test('Baustellenplaner', async (t) => {
  const s = await starte({ test: true, sitzung: { feldMin: 60 * 24 * 30, bueroMin: 60 * 24 * 30, maxH: 24 * 60 } });
  t.after(() => s.stop());
  const c = {};
  for (const r of ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf']) c[r] = await s.login(U[r]);
  const planMeldungen = (id) => s.db.alle("SELECT * FROM benachrichtigung WHERE benutzer_id = ? AND typ = 'plan' ORDER BY id", id);
  const alleMeldungen = () => s.db.eins("SELECT COUNT(*) AS n FROM benachrichtigung WHERE typ = 'plan'").n;
  let e1;

  await t.test('Rechte', async () => {
    for (const r of ['mitarbeiter', 'polier']) {
      assert.equal((await c[r].get(`/plan/woche?von=${MO}`)).status, 403, r);
      assert.equal((await c[r].post('/plan/einsaetze', { datum: FR, baustelleId: BS.pitten })).status, 403, r);
      assert.equal((await c[r].post('/plan/veroeffentlichen', { von: FR })).status, 403, r);
      assert.equal((await c[r].get('/plan/fuhren')).status, 403, r);
    }
    // Bauleiter wie Büro (13.11.2026): auch fremde Baustellen planbar
    const fremd = await c.bauleiter.post('/plan/einsaetze', { datum: FR, baustelleId: BS.reisinger });
    assert.equal(fremd.status, 201);
    s.db.lauf('DELETE FROM plan_einsatz WHERE id = ?', fremd.daten.id);
  });

  await t.test('Einsatz anlegen: Kolonne, Gerät, Notizen, Fahrer (422 wenn nicht eingeteilt)', async () => {
    let r = await c.bauleiter.post('/plan/einsaetze', { datum: FR, baustelleId: BS.pitten, beginn: '06:30', treffpunkt: 'Bauhof', arbeit: 'Walzen, Pflaster', benoetigt: 'Rüttelplatte, 20 t Schotter', notiz: 'Zufahrt hinten',
      kolonnePolierIds: [U.polier], anlageIds: [LKW], notizen: { [U.mitarbeiter]: 'Schlüssel Container mitnehmen' }, fahrer: { [LKW]: U.mitarbeiter } });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    e1 = r.daten;
    assert.equal(e1.personen.length, 7); // Polier + Partie
    assert.deepEqual(e1.kolonnen, [{ polierId: U.polier, name: 'Josef Haidbauer', anzahl: 7 }]);
    assert.equal(e1.anlagen[0].fahrer.benutzerId, U.mitarbeiter);
    assert.equal(e1.personen.find((p) => p.benutzerId === U.mitarbeiter).notiz, 'Schlüssel Container mitnehmen');
    assert.equal(e1.veroeffentlicht, false);
    assert.deepEqual(euroFelder(e1), []);
    r = await c.buero.put(`/plan/einsaetze/${e1.id}/anlagen/${LKW}`, { fahrerId: U.gf });
    assert.equal(r.status, 422);
    assert.equal((await c.buero.post('/plan/einsaetze', { datum: FR, baustelleId: BS.pitten })).status, 409);
    assert.equal((await c.buero.post('/plan/einsaetze', { datum: '2027-12-31', baustelleId: BS.pitten })).status, 400);
  });

  await t.test('Konflikte: doppelt, Abwesenheit (Datenschutz), gesperrtes Gerät', async () => {
    s.db.lauf("INSERT INTO abwesenheit (benutzer_id, datum, code, status, erfasst_von, erfasst) VALUES (?, ?, 'K', 'genehmigt', 101, ?) ON CONFLICT DO NOTHING", 3, FR, HEUTE);
    const r = await c.buero.post('/plan/einsaetze', { datum: FR, baustelleId: BS.kogler, benutzerIds: [U.mitarbeiter], anlageIds: [LKW, GESPERRT] });
    assert.equal(r.status, 201);
    const typen = r.daten.konflikteTag.map((k) => k.typ).sort();
    for (const tp of ['person_doppelt', 'anlage_doppelt', 'anlage_gesperrt']) assert.ok(typen.includes(tp), tp);
    const abw = r.daten.konflikteTag.find((k) => k.typ === 'abwesenheit');
    if (s.db.eins('SELECT 1 AS x FROM plan_person WHERE benutzer_id = 3')) assert.match(abw.text, /Krank/);
    // Bauleiter wie Büro (13.11.2026): sieht den Grund und alle Zeilen
    const w = (await c.bauleiter.get(`/plan/woche?von=${FR}`)).daten;
    const k = w.konflikte.find((x) => x.typ === 'abwesenheit');
    if (k) assert.match(k.text, /Krank/);
    assert.ok(w.einsaetze.some((e) => e.baustelleId === BS.kogler));
    // Polier/Mitarbeiter: Planer-Woche gesperrt (keine fremden Abwesenheiten)
    for (const rr of ['polier', 'mitarbeiter']) assert.equal((await c[rr].get(`/plan/woche?von=${FR}`)).status, 403);
    // aufräumen
    await c.buero.del(`/plan/einsaetze/${r.daten.id}`);
  });

  await t.test('Vorschau: Folgetag aus dem letzten Tag, Urlauber übersprungen, Notizen nicht übernommen, Wochenende frei', async () => {
    s.db.lauf("INSERT INTO abwesenheit (benutzer_id, datum, code, status, erfasst_von, erfasst) VALUES (?, ?, 'U', 'beantragt', ?, ?)", U.mitarbeiter, MO, U.mitarbeiter, HEUTE);
    const w = (await c.buero.get(`/plan/woche?von=${FR}&tage=7`)).daten;
    assert.equal(w.von, '2026-11-09');
    const tag = (d) => w.tage.find((x) => x.datum === d);
    assert.equal(tag(FR).vorschau, false);
    assert.equal(tag('2026-11-14').vorschau, false);
    const w2 = (await c.buero.get(`/plan/woche?von=${MO}`)).daten;
    const mo = w2.tage.find((x) => x.datum === MO);
    assert.equal(mo.vorschau, true);
    assert.equal(mo.quelleDatum, FR);
    const pv = w2.einsaetze.find((e) => e.datum === MO && e.baustelleId === BS.pitten);
    assert.equal(pv.id, null);
    assert.equal(pv.vorschau, true);
    assert.equal(pv.beginn, '06:30');
    assert.ok(!pv.personen.some((p) => p.benutzerId === U.mitarbeiter)); // Urlaub (beantragt)
    assert.ok(pv.uebersprungen.some((u) => u.typ === 'abwesenheit' && u.benutzerId === U.mitarbeiter && /Urlaub/.test(u.text)));
    assert.equal(pv.anlagen[0].fahrer, null); // Fahrer übersprungen
    assert.equal(pv.notiz, '');
    assert.equal(pv.benoetigt, '');
    assert.equal(pv.vortagNotizen.benoetigt, 'Rüttelplatte, 20 t Schotter');
    assert.equal(pv.vortagNotizen.personen[U.mitarbeiter], 'Schlüssel Container mitnehmen');
    assert.ok(w2.serien.personen[U.polier][MO].tage >= 2);
    // Vorschau bleibt für Mitarbeiter/Polier unsichtbar
    s.db.lauf('DELETE FROM abwesenheit WHERE benutzer_id = ? AND datum = ?', U.mitarbeiter, MO);
  });

  await t.test('Schreiben übernimmt den Tag genau einmal; Folgetag folgt der Änderung', async () => {
    let r = await c.buero.post('/plan/einsaetze', { datum: MO, baustelleId: BS.kogler, benutzerIds: [8] });
    assert.equal(r.status, 201);
    const mo = s.db.alle('SELECT * FROM plan_einsatz WHERE datum = ? AND geloescht = 0', MO);
    assert.equal(mo.length, 2);
    assert.equal(mo.find((e) => e.baustelle_id === BS.pitten).uebernommen, 1);
    r = await c.buero.post('/plan/tag/uebernehmen', { datum: MO });
    assert.equal(r.daten.angelegt, 0);
    const pm = mo.find((e) => e.baustelle_id === BS.pitten);
    assert.equal((await c.buero.put(`/plan/einsaetze/${pm.id}`, { version: pm.version, beginn: '07:00' })).status, 200);
    const w = (await c.buero.get(`/plan/woche?von=${MO}`)).daten;
    const di = w.einsaetze.find((e) => e.datum === DI && e.baustelleId === BS.pitten);
    assert.equal(di.vorschau, true);
    assert.equal(di.quelleDatum, MO);
    assert.equal(di.beginn, '07:00');
  });

  await t.test('Veröffentlichen: Vorschau ohne Versand; erste Veröffentlichung an alle; erneut nur Betroffene; entfällt', async () => {
    const vorher = alleMeldungen();
    const v1 = await c.buero.post('/plan/veroeffentlichen', { von: FR, vorschau: true });
    assert.equal(v1.status, 200);
    assert.equal(v1.daten.anzahl, 8); // 7 Personen + Partie-Meldung an den Polier (G-12: Vorschau = Versand)
    assert.ok(v1.daten.empfaenger.every((e) => e.art === 'neu' || (e.art === 'partie' && e.benutzerId === U.polier)));
    assert.equal(v1.daten.empfaenger.filter((e) => e.art === 'partie').length, 1);
    assert.equal(alleMeldungen(), vorher);
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM plan_mitteilung').n, 0);
    const r = await c.buero.post('/plan/veroeffentlichen', { von: FR });
    assert.equal(r.daten.benachrichtigt, 8);
    const m = planMeldungen(U.mitarbeiter).pop();
    assert.equal(m.titel, 'Einsatz morgen: WHA Pitten');
    assert.equal(m.text, 'Morgen 06:30 WHA Pitten, Treffpunkt Bauhof · Fahrzeug: LKW 4-Achser Mulde und Kran Volvo FMX 460 · Hinweis vorhanden');
    assert.ok(planMeldungen(U.polier).some((x) => /^Ihre Partie morgen/.test(x.titel)));
    // erneut ohne Änderung → nichts
    const n = alleMeldungen();
    assert.equal((await c.buero.post('/plan/veroeffentlichen', { von: FR })).daten.benachrichtigt, 0);
    assert.equal(alleMeldungen(), n);
    // Notiz einer Person → nur diese
    await c.buero.put(`/plan/einsaetze/${e1.id}/personen/${U.polier}`, { notiz: 'Schlüssel holen' });
    const v2 = (await c.buero.post('/plan/veroeffentlichen', { von: FR, vorschau: true })).daten;
    assert.deepEqual(v2.empfaenger.map((e) => [e.benutzerId, e.art]), [[U.polier, 'geaendert']]);
    await c.buero.post('/plan/veroeffentlichen', { von: FR });
    assert.match(planMeldungen(U.polier).pop().titel, /^(Geändert: Einsatz|Ihre Partie)/);
    // Person entfernt → entfällt
    const raus = s.db.eins('SELECT benutzer_id FROM plan_person WHERE einsatz_id = ? AND benutzer_id NOT IN (?, ?) LIMIT 1', e1.id, U.polier, U.mitarbeiter).benutzer_id;
    await c.buero.del(`/plan/einsaetze/${e1.id}/personen/${raus}`);
    const v3 = (await c.buero.post('/plan/veroeffentlichen', { von: FR, vorschau: true })).daten;
    assert.ok(v3.empfaenger.some((e) => e.benutzerId === raus && e.art === 'entfaellt'));
    await c.buero.post('/plan/veroeffentlichen', { von: FR });
    assert.match(planMeldungen(raus).pop().titel, /^Einsatz entfällt/);
    // erste Veröffentlichung des Montags (gleich wie Freitag) → trotzdem alle benachrichtigt
    const mo = await c.buero.post('/plan/veroeffentlichen', { von: MO, vorschau: true });
    assert.ok(mo.daten.empfaenger.some((e) => e.benutzerId === U.polier && e.art === 'neu'));
    assert.ok(mo.daten.anzahl >= 6);
  });

  await t.test('Mein Einsatz / Meine Partie: nur Veröffentlichtes, eigene Notiz, gelesen', async () => {
    const r = (await c.mitarbeiter.get(`/plan/ich?von=${HEUTE}&bis=${DI}`)).daten;
    const fr = r.tage.find((x) => x.datum === FR);
    assert.equal(fr.einsatz.baustelle.id, BS.pitten);
    assert.equal(fr.einsatz.meineNotiz, 'Schlüssel Container mitnehmen');
    assert.equal(fr.einsatz.benoetigt, 'Rüttelplatte, 20 t Schotter');
    assert.equal(fr.einsatz.meinFahrzeug.bezeichnung, 'LKW 4-Achser Mulde und Kran Volvo FMX 460');
    assert.ok(!JSON.stringify(r).includes('Schlüssel holen')); // Notiz des Poliers
    assert.equal(r.tage.find((x) => x.datum === MO).einsatz, null); // nicht veröffentlicht
    assert.equal(r.tage.find((x) => x.datum === DI).einsatz, null); // Vorschau
    assert.equal(r.morgen.datum, FR);
    assert.deepEqual(euroFelder(r), []);
    assert.equal((await c.mitarbeiter.post('/plan/ich/bestaetigen', { datum: FR })).status, 200);
    const p = (await c.polier.get(`/plan/partie?datum=${FR}`)).daten;
    const pe = p.einsaetze[0];
    assert.equal(pe.personen.find((x) => x.benutzerId === U.mitarbeiter).bestaetigt, true);
    assert.ok(pe.personen.some((x) => x.notiz === 'Schlüssel holen'));
    assert.deepEqual((await c.polier.get(`/plan/partie?datum=${DI}`)).daten.einsaetze, []); // Vorschau unsichtbar
    assert.equal((await c.mitarbeiter.get('/plan/partie')).status, 403);
  });

  await t.test('Stempeluhr: nur veröffentlichter Einsatz von heute', async () => {
    assert.equal((await c.mitarbeiter.get('/zeit/status')).daten.geplant, null);
    const r = await c.buero.post('/plan/einsaetze', { datum: HEUTE, baustelleId: BS.kogler, benutzerIds: [U.mitarbeiter], beginn: '07:00' });
    assert.equal(r.status, 201);
    assert.equal((await c.mitarbeiter.get('/zeit/status')).daten.geplant, null);
    await c.buero.post('/plan/veroeffentlichen', { von: HEUTE });
    assert.deepEqual((await c.mitarbeiter.get('/zeit/status')).daten.geplant, { baustelleId: BS.kogler, kst: '26-038', name: 'Zufahrt Kogler', beginn: '07:00', treffpunkt: '' });
    // Fremde Baustelle: der Polier aus Pitten sieht die Kolonne von Kogler nicht
    assert.equal((await c.polier.get(`/zeit/kolonne?baustelleId=${BS.kogler}&plan=1`)).status, 403);
  });

  await t.test('Kolonne (12.8): eingeplante Person aus anderer Partie – geplant:true, Stempeln ohne gast', async () => {
    // U.mitarbeiter gehört zur Partie Pitten und ist heute (veröffentlicht) auf Kogler eingeplant; Polier von Kogler ist U.polier2.
    const p2 = await s.login(U.polier2);
    const k = await p2.get(`/zeit/kolonne?baustelleId=${BS.kogler}&plan=1`);
    assert.equal(k.status, 200);
    const ma = k.daten.find((x) => x.benutzerId === U.mitarbeiter);
    assert.ok(ma, 'eingeplante Person aus anderer Partie fehlt in der Kolonne');
    assert.equal(ma.geplant, true);
    assert.equal(ma.partie, false);
    assert.ok(k.daten.filter((x) => x.partie).every((x) => x.geplant === false), 'eigene, nicht eingeplante Partie ist nicht geplant');
    // ohne plan=1: keine eingeplante Fremdperson und kein Feld geplant
    const ohne = await p2.get(`/zeit/kolonne?baustelleId=${BS.kogler}`);
    assert.equal(ohne.status, 200);
    assert.ok(!ohne.daten.some((x) => x.benutzerId === U.mitarbeiter));
    assert.ok(ohne.daten.every((x) => !('geplant' in x)));
    // nicht eingeplante fremde Person (Partie Pitten) ohne gast → Fehler, ohne Buchung
    const n3 = s.db.eins('SELECT COUNT(*) AS n FROM buchung WHERE benutzer_id = 3').n;
    const f = await p2.post('/zeit/kolonne', { typ: 'kommen', baustelleId: BS.kogler, benutzerIds: [3] });
    assert.equal(f.status, 200);
    assert.equal(f.daten.ergebnisse[0].ok, false);
    assert.match(f.daten.ergebnisse[0].fehler, /gehört nicht zu Ihrer Partie/);
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM buchung WHERE benutzer_id = 3').n, n3);
    // eingeplante Person ohne gast → ok:true, Buchung auf Kogler
    const vorher = s.db.eins('SELECT MAX(id) AS m FROM buchung').m || 0;
    const r = await p2.post('/zeit/kolonne', { typ: 'kommen', baustelleId: BS.kogler, benutzerIds: [U.mitarbeiter] });
    assert.equal(r.status, 200);
    assert.equal(r.daten.ergebnisse.length, 1);
    assert.equal(r.daten.ergebnisse[0].ok, true, JSON.stringify(r.daten));
    const b = s.db.alle('SELECT benutzer_id, baustelle_id, typ FROM buchung WHERE id > ?', vorher);
    assert.deepEqual(b.map((x) => [x.benutzer_id, x.baustelle_id, x.typ]), [[U.mitarbeiter, BS.kogler, 'kommen']]);
    // Ausgangsstand für die folgenden Tests wiederherstellen
    s.db.lauf('DELETE FROM buchung WHERE id > ?', vorher);
  });

  await t.test('Nie automatisch veröffentlichen – auch nicht über Mitternacht; Erinnerung 17:00 einmal je Tag', async () => {
    // unveröffentlichte Änderung am nächsten Arbeitstag (Fr)
    const e = s.db.eins('SELECT id, version FROM plan_einsatz WHERE id = ?', e1.id);
    assert.equal((await c.buero.put(`/plan/einsaetze/${e.id}`, { version: e.version, arbeit: 'Pflaster fertig verlegen' })).status, 200);
    const vorher = s.db.eins('SELECT COUNT(*) AS n FROM plan_mitteilung').n;
    const veroeff = s.db.eins('SELECT COUNT(*) AS n FROM plan_einsatz WHERE veroeffentlicht_zeit IS NOT NULL').n;
    for (const zeit of ['2026-11-12T15:59:00Z', '2026-11-12T16:30:00Z', '2026-11-12T22:59:00Z', '2026-11-12T23:30:00Z', '2026-11-13T05:00:00Z', '2026-11-13T16:05:00Z']) {
      s.uhr.setze(zeit);
      s.app.bt.stuendlich();
      await c.buero.post('/test/stuendlich', {});
    }
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM plan_mitteilung').n, vorher);
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM plan_einsatz WHERE veroeffentlicht_zeit IS NOT NULL').n, veroeff);
    const er = s.db.alle("SELECT * FROM benachrichtigung WHERE titel = 'Einteilung für morgen noch nicht veröffentlicht'");
    assert.ok(er.length >= 1);
    assert.equal(er.filter((x) => x.benutzer_id === U.buero && x.schluessel === 'plan:erinnerung:2026-11-12').length, 1);
    assert.ok(er.every((x) => [U.buero, U.gf, U.bauleiter, 102, 101, 103].includes(x.benutzer_id) || s.db.eins('SELECT rolle FROM benutzer WHERE id = ?', x.benutzer_id).rolle !== 'mitarbeiter'));
    s.uhr.setze('2026-11-12T09:24:00.000Z');
  });

  await t.test('Fuhren: Rechte, Links, kein Doppelt-Konflikt, Veröffentlichen, Bericht-Zeile genau einmal, Landschaftsabgabe', async () => {
    assert.equal((await c.polier.post('/plan/fuhren', { datum: HEUTE, anlageId: LKW, materialId: 4, menge: 10, einheit: 't', nach: { art: 'baustelle', baustelleId: BS.reisinger } })).status, 403); // Bauleiter wie Büro (13.11.2026)
    assert.equal((await c.buero.post('/plan/fuhren', { datum: HEUTE, anlageId: 27, materialId: 4, menge: 10, einheit: 't', nach: { art: 'baustelle', baustelleId: BS.pitten } })).status, 400); // Walze ist kein Fahrzeug
    assert.equal((await c.buero.post('/plan/fuhren', { datum: HEUTE, anlageId: LKW, materialId: 4, menge: 10, einheit: 't', nach: { art: 'adresse', text: 'X', link: 'https://maps.google.com/@95.1,16' } })).status, 400);
    // Bericht (Entwurf) für heute auf Pitten
    s.db.lauf('DELETE FROM bericht WHERE baustelle_id = ? AND datum = ?', BS.pitten, HEUTE);
    const b = (await c.polier.post('/berichte', { baustelleId: BS.pitten, datum: HEUTE })).daten;
    let r = await c.bauleiter.post('/plan/fuhren', { datum: HEUTE, anlageId: LKW, fahrerId: U.mitarbeiter, beginn: '06:30', materialId: 4, menge: 12.5, einheit: 't', anzahlFuhren: 1,
      nach: { art: 'baustelle', baustelleId: BS.pitten, abladestelle: 'Zufahrt hinten, neben Container', link: 'https://www.google.com/maps/@47.6123,16.0456,15z' } });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    const f1 = r.daten;
    assert.equal(f1.von.art, 'grube');
    assert.equal(f1.von.text, 'Grube Breitenau');
    assert.equal(f1.nach.lat, 47.6123);
    assert.equal(f1.mapsLink, 'https://www.google.com/maps/dir/?api=1&origin=Grube%20Breitenau&destination=47.6123,16.0456');
    assert.ok(!f1.konflikte.some((k) => /doppelt/.test(k.typ)));
    r = await c.buero.post('/plan/fuhren', { datum: HEUTE, anlageId: LKW, fahrerId: U.mitarbeiter, beginn: '09:00', materialText: 'Humus', menge: 2, einheit: 'fuhren', nach: { art: 'adresse', text: '47.62, 16.05' } });
    assert.equal(r.status, 201);
    const f2 = r.daten;
    // LKW auch im Einsatz am selben Tag → kein anlage_doppelt
    const w = (await c.buero.get(`/plan/woche?von=${HEUTE}`)).daten;
    assert.ok(!w.konflikte.some((k) => k.typ === 'anlage_doppelt' && k.anlageId === LKW && k.datum === HEUTE));
    // Mitarbeiter sieht vor Veröffentlichung nichts
    assert.deepEqual((await c.mitarbeiter.get(`/plan/ich?von=${HEUTE}&bis=${HEUTE}`)).daten.tage[0].fuhren, []);
    assert.equal((await c.mitarbeiter.post(`/plan/fuhren/${f1.id}/status`, { status: 'unterwegs' })).status, 403);
    await c.buero.post('/plan/veroeffentlichen', { von: HEUTE });
    const m = planMeldungen(U.mitarbeiter).pop();
    assert.match(m.text, /2 Fuhren · erste 06:30 Grube Breitenau → WHA Pitten/);
    const ich = (await c.mitarbeiter.get(`/plan/ich?von=${HEUTE}&bis=${HEUTE}`)).daten.tage[0];
    assert.equal(ich.fuhren.length, 2);
    assert.equal(ich.fuhren[0].nach.abladestelle, 'Zufahrt hinten, neben Container');
    assert.deepEqual(euroFelder(ich), []);
    // anderer Mitarbeiter sieht fremde Fuhren nicht
    const ma2 = await s.login(3);
    assert.deepEqual((await ma2.get(`/plan/ich?von=${HEUTE}&bis=${HEUTE}`)).daten.tage[0].fuhren, []);
    // erledigt → Bericht-Zeile genau einmal
    const vorher = s.db.eins('SELECT menge FROM bericht_material WHERE bericht_id = ? AND material_id = 4', b.id);
    r = await c.mitarbeiter.post(`/plan/fuhren/${f1.id}/status`, { status: 'erledigt', menge: 13 });
    assert.equal(r.status, 200);
    assert.equal(r.daten.berichtZeile.status, 'uebernommen');
    await c.mitarbeiter.post(`/plan/fuhren/${f1.id}/status`, { status: 'erledigt', menge: 13 });
    const nachher = s.db.eins('SELECT menge FROM bericht_material WHERE bericht_id = ? AND material_id = 4', b.id).menge;
    assert.equal(nachher, (vorher ? vorher.menge : 0) + 13);
    // 12.8d: Anteil aus Fuhren in der Berichtszeile
    const zeile = (await c.polier.get(`/berichte/${b.id}`)).daten.material.find((x) => x.materialId === 4);
    assert.deepEqual([zeile.ausFuhren, zeile.quelle], [13, vorher ? 'gemischt' : 'fuhre']);
    // Status-Wechsel ist keine Plan-Änderung (keine neue Meldung)
    assert.equal((await c.buero.post('/plan/veroeffentlichen', { von: HEUTE, vorschau: true })).daten.anzahl, 0);
    // „fuhren“ ohne Katalog → prüfen + Büro informiert
    r = await c.mitarbeiter.post(`/plan/fuhren/${f2.id}/status`, { status: 'erledigt' });
    assert.equal(r.daten.berichtZeile, null); // nach Adresse → keine Berichtszeile
    // Landschaftsabgabe: Bericht unterschreiben → Tonnen zählen
    const la0 = (await c.buero.get(`/baustellen/${BS.pitten}/positionen`)).daten.gruppen.flatMap((g) => g.positionen).find((p) => p.bezeichnung === 'Landschaftsabgabe').mengeAuto;
    await c.polier.postV(`/berichte/${b.id}/unterschrift`, { rolle: 'an', name: 'Josef Haidbauer', bildPng: demoUnterschrift('a') });
    await c.polier.postV(`/berichte/${b.id}/unterschrift`, { rolle: 'bh', name: 'Bauherr', bildPng: demoUnterschrift('b') });
    const la1 = (await c.buero.get(`/baustellen/${BS.pitten}/positionen`)).daten.gruppen.flatMap((g) => g.positionen).find((p) => p.bezeichnung === 'Landschaftsabgabe').mengeAuto;
    assert.ok(la1 >= la0 + 13 - 0.001, `${la0} → ${la1}`);
  });

  await t.test('Fuhre ohne offenen Bericht → Vorschlag; m³ ohne Dichte → prüfen', async () => {
    s.db.lauf('DELETE FROM bericht WHERE baustelle_id = ? AND datum = ?', BS.kogler, HEUTE);
    let r = await c.buero.post('/plan/fuhren', { datum: HEUTE, anlageId: LKW, fahrerId: U.mitarbeiter, materialId: 6, menge: 8, einheit: 't', nach: { art: 'baustelle', baustelleId: BS.kogler } });
    await c.buero.post(`/plan/fuhren/${r.daten.id}/status`, { status: 'erledigt' });
    assert.equal(s.db.eins('SELECT bericht_status FROM plan_fuhre WHERE id = ?', r.daten.id).bericht_status, 'vorschlag');
    const b = (await c.buero.post('/berichte', { baustelleId: BS.kogler, datum: HEUTE })).daten;
    assert.deepEqual(b.fuhrenVorschlag.map((x) => [x.fuhreId, x.menge]), [[r.daten.id, 8]]);
    const u = await c.buero.post(`/berichte/${b.id}/fuhren-uebernehmen`, { fuhreIds: [r.daten.id] });
    assert.equal(u.daten.uebernommen, 1);
    assert.equal((await c.buero.post(`/berichte/${b.id}/fuhren-uebernehmen`, { fuhreIds: [r.daten.id] })).daten.uebernommen, 0);
    assert.ok(u.daten.bericht.material.some((m) => m.materialId === 6 && m.menge === 8));
    r = await c.buero.post('/plan/fuhren', { datum: HEUTE, anlageId: LKW, materialId: 6, menge: 5, einheit: 'm3', nach: { art: 'baustelle', baustelleId: BS.kogler } });
    const st = await c.buero.post(`/plan/fuhren/${r.daten.id}/status`, { status: 'erledigt' });
    assert.equal(st.daten.berichtZeile.status, 'pruefen');
    assert.ok(planMeldungen(U.buero).some((x) => /Fuhre prüfen/.test(x.titel)));
    // mit Dichte → umgerechnet
    assert.equal((await c.buero.put('/materialien/6', { dichte: 1.6 })).status, 200);
    r = await c.buero.post('/plan/fuhren', { datum: HEUTE, anlageId: LKW, materialId: 6, menge: 5, einheit: 'm3', nach: { art: 'baustelle', baustelleId: BS.kogler } });
    const st2 = await c.buero.post(`/plan/fuhren/${r.daten.id}/status`, { status: 'erledigt' });
    assert.equal(st2.daten.berichtZeile.status, 'uebernommen');
    assert.equal(s.db.eins('SELECT menge FROM bericht_material WHERE bericht_id = ? AND material_id = 6', b.id).menge, 16);
  });

  await t.test('12.8d: veroeffentlichtUm, Telefon, deaktivierte Einträge im Bericht', async () => {
    const w = (await c.buero.get(`/plan/woche?von=${FR}`)).daten;
    const fr = w.tage.find((x) => x.datum === FR);
    assert.match(fr.veroeffentlichtUm, /^2026-11-1\dT/);
    assert.ok(w.einsaetze.find((e) => e.id === e1.id).veroeffentlichtUm);
    assert.equal((await c.buero.get(`/plan/woche?von=${MO}`)).daten.tage.find((x) => x.datum === DI).veroeffentlichtUm, null);
    // Telefon: selbst und durch die Verwaltung
    assert.equal((await c.polier.put('/auth/telefon', { telefon: 'abc' })).status, 400);
    assert.equal((await c.polier.put('/auth/telefon', { telefon: '+43 664 1234567' })).status, 200);
    const ich = (await c.mitarbeiter.get(`/plan/ich?von=${FR}&bis=${FR}`)).daten.tage[0];
    assert.equal(ich.einsatz.polier.telefon, '+43 664 1234567');
    assert.ok(!JSON.stringify((await c.mitarbeiter.get('/mitarbeiter')).daten).includes('664'));
    const p = (await c.polier.get(`/plan/partie?datum=${FR}`)).daten;
    assert.equal(p.einsaetze[0].personen.find((x) => x.benutzerId === U.polier).telefon, '+43 664 1234567');
    assert.equal((await c.gf.get('/benutzer')).daten.find((x) => x.id === U.polier).telefon, '+43 664 1234567');
    // deaktiviertes Material: alter Entwurf speichert unverändert, neu hinzufügen → 422
    s.db.lauf('DELETE FROM bericht WHERE baustelle_id = ? AND datum = ?', BS.reisinger, HEUTE);
    const b = (await c.buero.post('/berichte', { baustelleId: BS.reisinger, datum: HEUTE })).daten;
    let r = await c.buero.putV(`/berichte/${b.id}`, { material: [{ materialId: 1, menge: 5 }] });
    assert.equal(r.status, 200);
    s.db.lauf('UPDATE material SET aktiv = 0 WHERE id IN (1, 2)');
    try {
      r = await c.buero.putV(`/berichte/${b.id}`, { material: [{ materialId: 1, menge: 5 }] });
      assert.equal(r.status, 200);
      r = await c.buero.putV(`/berichte/${b.id}`, { material: [{ materialId: 1, menge: 5 }, { materialId: 2, menge: 1 }] });
      assert.equal(r.status, 422);
      assert.match(r.daten.fehler, /deaktiviert/);
    } finally { s.db.lauf('UPDATE material SET aktiv = 1 WHERE id IN (1, 2)'); }
  });
});

test('Regression: POST /plan/einsaetze auf eine vorhandene Vorschau-Zelle → 409 mit nutzbarer id', async (t) => {
  const s = await starte({ test: true });
  t.after(() => s.stop());
  const buero = await s.login(U.buero);
  assert.equal((await buero.post('/plan/einsaetze', { datum: FR, baustelleId: BS.pitten, beginn: '06:30', benutzerIds: [U.polier] })).status, 201);
  const w0 = (await buero.get(`/plan/woche?von=${MO}`)).daten;
  assert.equal(w0.tage.find((x) => x.datum === MO).vorschau, true);
  assert.ok(w0.einsaetze.some((e) => e.datum === MO && e.baustelleId === BS.pitten && e.vorschau));
  const r = await buero.post('/plan/einsaetze', { datum: MO, baustelleId: BS.pitten, benutzerIds: [8] });
  assert.equal(r.status, 409);
  assert.ok(Number.isInteger(r.daten.id));
  // der Einsatz der id existiert wirklich, der Tag ist gespeichert (keine Vorschau mehr)
  const e = s.db.eins('SELECT * FROM plan_einsatz WHERE id = ? AND geloescht = 0', r.daten.id);
  assert.ok(e);
  assert.equal(e.datum, MO);
  assert.equal(e.baustelle_id, BS.pitten);
  assert.equal(e.uebernommen, 1);
  const w1 = (await buero.get(`/plan/woche?von=${MO}`)).daten;
  assert.equal(w1.tage.find((x) => x.datum === MO).vorschau, false);
  // mit der id weiterarbeiten
  const p = await buero.post(`/plan/einsaetze/${r.daten.id}/personen`, { benutzerIds: [8] });
  assert.ok([200, 201].includes(p.status), `Status ${p.status}`);
  assert.ok(s.db.eins('SELECT 1 AS x FROM plan_person WHERE einsatz_id = ? AND benutzer_id = 8', r.daten.id));
  // erneuter POST: gleicher Einsatz, Tag nur einmal übernommen
  const r2 = await buero.post('/plan/einsaetze', { datum: MO, baustelleId: BS.pitten });
  assert.equal(r2.status, 409);
  assert.equal(r2.daten.id, r.daten.id);
  assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM plan_einsatz WHERE datum = ? AND baustelle_id = ? AND geloescht = 0', MO, BS.pitten).n, 1);
});
