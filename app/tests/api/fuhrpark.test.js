'use strict';
/**
 * Servicebuch – fachliche API-Tests: Plausibilität, Korrektur, Zählertausch, Fälligkeit/Erledigen/Storno,
 * Sperren (Mangel sofort, schwere Mängel, manuell), Erinnerungen genau einmal je Stufe, Zurechnung der
 * Gerätestunden aus dem Bautagesbericht, gesperrte Anlage im Bericht, Zählerabfrage beim Ausstempeln.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');
const { demoUnterschrift } = require('../../server/png');
const { pruefeFuhrpark } = require('../../server/fuhrpark-erinnerung');

const H = '2026-11-12';
const fpMeldungen = (db, uid, muster = 'fp:%') => db.alle('SELECT * FROM benachrichtigung WHERE benutzer_id = ? AND schluessel LIKE ? ORDER BY id', uid, muster);

test('Servicebuch: Zähler, Plausibilität, Korrektur, Zählertausch', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const buero = await s.login(U.buero);
  const ma = await s.login(U.mitarbeiter);
  let anlage;

  await t.test('Anlage anlegen: Vorschlag passender Vorlagen, Startstand als Zählerstand', async () => {
    const r = await buero.post('/fuhrpark/anlagen', { bezeichnung: 'Testbagger Volvo EC 18', klasse: 'baumaschine', nummer: 'T01', zaehler: [{ art: 'bh', startstand: 1000, startdatum: '2026-10-01' }] });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    anlage = r.daten;
    assert.equal(anlage.status, 'einsatzbereit');
    assert.ok(anlage.vorlagenVorschlag.some((v) => v.schluessel === 'cat_500' && v.empfohlen));
    assert.ok(anlage.vorlagenVorschlag.some((v) => v.schluessel === 'hebezeug_amvo' && !v.empfohlen));
    assert.ok(!anlage.vorlagenVorschlag.some((v) => v.schluessel.startsWith('57a')));
    assert.equal(anlage.zaehler[0].letzterStand.quelle, 'start');
    assert.equal((await buero.post('/fuhrpark/anlagen', { bezeichnung: 'Doppelt', klasse: 'baumaschine', nummer: 'T01' })).status, 409);
    assert.equal((await buero.post('/fuhrpark/anlagen', { bezeichnung: 'LKW', klasse: 'lkw', kennzeichen: 'nk-301 bp' })).status, 409); // Kennzeichen von A01
    assert.equal((await buero.post('/fuhrpark/anlagen', { bezeichnung: 'X', klasse: 'raumschiff' })).status, 400);
  });

  await t.test('Zählerstand: Plausibilität (Rechenbeispiele 10 und 11), idempotent, Grenzen', async () => {
    const r1 = await ma.post('/fuhrpark/zaehlerstaende', { anlageId: anlage.id, art: 'bh', anzeige: 1150, datum: '2026-11-03' });
    assert.equal(r1.status, 201, JSON.stringify(r1.daten));
    assert.equal(r1.daten.stand.status, 'gueltig');
    const klein = await ma.post('/fuhrpark/zaehlerstaende', { anlageId: anlage.id, art: 'bh', anzeige: 1100, datum: '2026-11-10' });
    assert.equal(klein.status, 400);
    assert.equal(klein.daten.fehler, 'Zählerstand kleiner als am 03.11.2026 (1.150 Std.) – bei Zählertausch bitte das Büro verständigen.');
    const unpl = await ma.post('/fuhrpark/zaehlerstaende', { anlageId: anlage.id, art: 'bh', anzeige: 1210, datum: '2026-11-05' });
    assert.equal(unpl.status, 201);
    assert.equal(unpl.daten.stand.status, 'unplausibel');
    assert.ok(unpl.daten.warnung);
    // zählt nicht für den aktuellen Stand
    assert.equal((await buero.get(`/fuhrpark/anlagen/${anlage.id}`)).daten.zaehler[0].aktuell, 1150);
    assert.ok((await buero.get('/fuhrpark/uebersicht')).daten.unplausibleStaende.some((x) => x.id === unpl.daten.stand.id));
    assert.ok(fpMeldungen(s.db, U.buero, `fp:unplausibel:${unpl.daten.stand.id}`).length === 1);
    // idempotent
    const nochmal = await ma.post('/fuhrpark/zaehlerstaende', { anlageId: anlage.id, art: 'bh', anzeige: 1150, datum: '2026-11-03' });
    assert.equal(nochmal.status, 200);
    assert.equal(nochmal.daten.stand.id, r1.daten.stand.id);
    // Zukunft, zu alt (ohne fuhrpark), unbekannte Zählerart
    assert.equal((await ma.post('/fuhrpark/zaehlerstaende', { anlageId: anlage.id, art: 'bh', anzeige: 1160, datum: '2026-11-13' })).status, 400);
    assert.equal((await ma.post('/fuhrpark/zaehlerstaende', { anlageId: anlage.id, art: 'km', anzeige: 1160 })).status, 400);
    const alt = await buero.post('/fuhrpark/zaehlerstaende', { anlageId: anlage.id, art: 'bh', anzeige: 1001, datum: '2026-10-02' });
    assert.equal(alt.status, 201); // Büro (fuhrpark) beliebig zurück
    // Nachfolger-Regel: zwischen zwei Ständen größer als der spätere → 400
    assert.equal((await buero.post('/fuhrpark/zaehlerstaende', { anlageId: anlage.id, art: 'bh', anzeige: 1200, datum: '2026-10-20' })).status, 400);
    // Korrektur: unplausiblen Stand bestätigen geht nicht ohne Grund, mit Grund ja
    assert.equal((await buero.put(`/fuhrpark/zaehlerstaende/${unpl.daten.stand.id}`, { status: 'gueltig' })).status, 400);
    assert.equal((await ma.put(`/fuhrpark/zaehlerstaende/${unpl.daten.stand.id}`, { status: 'gueltig', grund: 'passt' })).status, 403);
    const ok = await buero.put(`/fuhrpark/zaehlerstaende/${unpl.daten.stand.id}`, { status: 'ungueltig', grund: 'Tippfehler, richtig 1.160' });
    assert.equal(ok.status, 200);
    assert.equal(ok.daten.stand.status, 'ungueltig');
  });

  await t.test('Bericht-Abgleich: Hinweis, wenn Ablesung und Bautagesberichte stark abweichen', async () => {
    const z = s.db.eins("SELECT z.id FROM zaehler z WHERE anlage_id = 18 AND art = 'bh'").id; // CAT 320, Stunden aus Berichten
    const letzte = s.db.eins("SELECT * FROM zaehlerstand WHERE zaehler_id = ? AND status = 'gueltig' ORDER BY datum DESC, id DESC LIMIT 1", z);
    const stunden = s.db.eins(`SELECT COALESCE(SUM(bg.stunden),0) AS s FROM bericht_geraet bg JOIN bericht b ON b.id = bg.bericht_id
      WHERE bg.geraet_id = (SELECT id FROM geraet WHERE code = 'b23') AND b.status IN ('unterschrieben','freigegeben') AND b.datum > ? AND b.datum <= ?`, letzte.datum, H).s;
    assert.ok(stunden >= 30, `Demo-Daten: ${stunden} Berichtsstunden seit ${letzte.datum}`);
    {
      const r = await ma.post('/fuhrpark/zaehlerstaende', { anlageId: 18, art: 'bh', anzeige: letzte.anzeige + 2, datum: H });
      assert.equal(r.status, 201);
      assert.match(r.daten.hinweis, /laut Bautagesberichten/);
      assert.equal(r.daten.stand.status, 'gueltig');
    }
  });

  await t.test('Zählertausch: Gesamtstand läuft stetig weiter', async () => {
    const zid = anlage.zaehler[0].id;
    const r = await buero.post(`/fuhrpark/zaehler/${zid}/tausch`, { datum: H, endstandAlt: 1180, startstandNeu: 0, grund: 'Stundenzähler defekt, getauscht' });
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    assert.equal(r.daten.zaehler.versatz, 1180);
    assert.equal(r.daten.zaehler.aktuell, 1180);
    assert.equal(r.daten.zaehler.letzterStand.anzeige, 0);
    // neuer Zähler zeigt 2 → Gesamtstand 1.182 (kein „kleiner als“)
    const n = await ma.post('/fuhrpark/zaehlerstaende', { anlageId: anlage.id, art: 'bh', anzeige: 2, datum: H });
    assert.equal(n.status, 201, JSON.stringify(n.daten));
    assert.equal(n.daten.stand.wert, 1182);
    const v = (await buero.get(`/fuhrpark/zaehler/${zid}/verlauf`)).daten;
    assert.ok(v.punkte.some((p) => p.quelle === 'tausch_alt') && v.punkte.some((p) => p.quelle === 'tausch_neu'));
    assert.equal((await buero.put(`/fuhrpark/zaehlerstaende/${v.punkte.find((p) => p.quelle === 'tausch_neu').id}`, { anzeige: 5, grund: 'xyz' })).status, 400);
  });
});

test('Servicebuch: Fälligkeit, Erledigen mit schliesstEin, Storno, Sperren', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const buero = await s.login(U.buero);
  const ma = await s.login(U.mitarbeiter);

  await t.test('Demo-Zustände: gesperrt (§57a überfällig, Mangel sofort), fällig, bald, ok', async () => {
    const liste = (await ma.get('/fuhrpark/anlagen')).daten;
    const nach = Object.fromEntries(liste.map((a) => [a.nummer, a]));
    assert.equal(nach.A03.status, 'gesperrt');
    assert.equal(nach.A03.sperrGruende[0].typ, 'frist');
    assert.equal(nach.A27.status, 'gesperrt');
    assert.equal(nach.A27.sperrGruende[0].typ, 'mangel');
    assert.equal(nach.A20.status, 'faellig');
    assert.equal(nach.A16.status, 'bald');
    assert.equal(nach.A18.status, 'einsatzbereit');
    assert.equal(nach.A18.ampel, 'gruen');
    assert.equal(liste[0].status, 'gesperrt'); // Sortierung: gesperrt, fällig, bald, …
    const plan = (await buero.get('/fuhrpark/anlagen/18/plan')).daten;
    const cat500 = plan.find((p) => p.vorlage && p.vorlage.schluessel === 'cat_500');
    assert.deepEqual(cat500.faelligBei, { art: 'bh', wert: 4500 });
    assert.equal(cat500.status, 'ok');
    const fr = (await buero.get('/fuhrpark/fristen')).daten;
    assert.equal(fr[0].status, 'ueberfaellig');
    assert.ok(fr.every((f) => f.pruefen === true));
  });

  await t.test('Eintrag erledigt Planposition (+ schliesstEin) → grün; Storno stellt Fälligkeit wieder her', async () => {
    const vorher = (await buero.get('/fuhrpark/anlagen/20')).daten; // Radlader CASE, cat_1000 fällig
    const p1000 = vorher.plan.find((p) => p.vorlage.schluessel === 'cat_1000');
    const p500 = vorher.plan.find((p) => p.vorlage.schluessel === 'cat_500');
    assert.equal(p1000.status, 'faellig');
    const stand = Math.ceil(vorher.zaehler[0].aktuell);
    // Zählerstand fehlt → 400
    const ohne = await buero.post('/fuhrpark/eintraege', { anlageId: 20, art: 'service', datum: H, werkstatt: 'Fachwerkstatt', titel: '1.000-Std.-Service', planpositionIds: [p1000.id] });
    assert.equal(ohne.status, 400);
    assert.equal(ohne.daten.fehler, 'Betriebsstundenstand fehlt.');
    assert.equal((await buero.post('/fuhrpark/eintraege', { anlageId: 20, art: 'service', datum: '2026-11-20', werkstatt: 'W', titel: 'x', zaehler: [{ art: 'bh', anzeige: stand }] })).status, 400);
    assert.equal((await buero.post('/fuhrpark/eintraege', { anlageId: 20, art: 'service', datum: H, werkstatt: 'W', titel: 'x', pruefErgebnis: 'ohne_maengel', zaehler: [{ art: 'bh', anzeige: stand }] })).status, 400);
    const r = await buero.post('/fuhrpark/eintraege', { anlageId: 20, art: 'service', datum: H, werkstatt: 'Fachwerkstatt Muster', titel: '1.000-Std.-Service', kosten: 2450.5, rechnungNr: 'RE-26-0999', zaehler: [{ art: 'bh', anzeige: stand }], planpositionIds: [p1000.id] });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    assert.deepEqual(r.daten.erledigt.map((x) => x.planpositionId).sort(), [p1000.id, p500.id].sort()); // cat_500 per schliesstEin
    assert.equal(r.daten.kosten, 2450.5);
    const nachher = (await buero.get('/fuhrpark/anlagen/20')).daten;
    assert.equal(nachher.status, 'einsatzbereit');
    assert.equal(nachher.ampel, 'gruen');
    const n1000 = nachher.plan.find((p) => p.id === p1000.id);
    assert.equal(n1000.letzteDatum, H);
    assert.equal(n1000.faelligBei.wert, stand + 1000);
    // Storno
    assert.equal((await buero.post(`/fuhrpark/eintraege/${r.daten.id}/storno`, {})).status, 400);
    const st = await buero.post(`/fuhrpark/eintraege/${r.daten.id}/storno`, { grund: 'Falsche Anlage erfasst' });
    assert.equal(st.status, 200);
    assert.ok(st.daten.storniert);
    assert.equal(st.daten.zaehler[0].status, 'ungueltig');
    const wieder = (await buero.get('/fuhrpark/anlagen/20')).daten;
    assert.equal(wieder.plan.find((p) => p.id === p1000.id).status, 'faellig');
    assert.equal(wieder.plan.find((p) => p.id === p1000.id).letzteDatum, p1000.letzteDatum);
    assert.equal(wieder.status, 'faellig');
    assert.equal((await buero.post(`/fuhrpark/eintraege/${r.daten.id}/storno`, { grund: 'nochmal' })).status, 409);
    assert.equal((await buero.put(`/fuhrpark/eintraege/${r.daten.id}`, { version: st.daten.version, titel: 'neu' })).status, 409);
  });

  await t.test('Mangel „sofort“ sperrt sofort, Benachrichtigung; behoben → frei', async () => {
    const r = await ma.post('/fuhrpark/maengel', { anlageId: 19, text: 'Ölverlust an der Hydraulikpumpe', dringlichkeit: 'sofort', baustelleId: BS.pitten });
    assert.equal(r.status, 201);
    const a = (await ma.get('/fuhrpark/anlagen/19')).daten;
    assert.equal(a.status, 'gesperrt');
    assert.ok(a.sperrGruende.some((g) => g.typ === 'mangel' && /Ölverlust/.test(g.text)));
    assert.ok((await buero.get('/benachrichtigungen')).daten.some((n) => n.typ === 'fuhrpark' && n.titel === 'Gerät stillgelegt: Minilader CASE SR160 (3,5 t)' && n.anlageId === 19));
    assert.equal((await ma.get('/fuhrpark/maengel')).daten.length, 1); // nur eigene
    assert.ok((await buero.get('/fuhrpark/maengel')).daten.length >= 3);
    assert.equal((await ma.post('/fuhrpark/maengel', { anlageId: 19, text: 'xy', dringlichkeit: 'bald' })).status, 400);
    assert.equal((await buero.put(`/fuhrpark/maengel/${r.daten.id}`, { status: 'verworfen' })).status, 400);
    assert.equal((await buero.put(`/fuhrpark/maengel/${r.daten.id}`, { status: 'behoben', notiz: 'Dichtung getauscht' })).status, 200);
    assert.equal((await ma.get('/fuhrpark/anlagen/19')).daten.status, 'einsatzbereit');
  });

  await t.test('Prüfung mit schweren Mängeln sperrt; manuelle Sperre/Entsperren', async () => {
    const d = (await buero.get('/fuhrpark/anlagen/9')).daten; // LKW 2-Achser
    const km = Math.ceil(d.zaehler[0].aktuell);
    const r = await buero.post('/fuhrpark/eintraege', { anlageId: 9, art: 'pruefung', datum: H, werkstatt: 'Prüfstelle', titel: '§57a', pruefErgebnis: 'schwere_maengel', zaehler: [{ art: 'km', anzeige: km }] });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    const g = (await buero.get('/fuhrpark/anlagen/9')).daten;
    assert.equal(g.status, 'gesperrt');
    assert.equal(g.sperrGruende[0].text, 'Prüfung mit schweren Mängeln');
    assert.equal((await buero.post('/fuhrpark/anlagen/9/sperre', { gesperrt: false })).status, 400); // Grund Pflicht
    const e = await buero.post('/fuhrpark/anlagen/9/sperre', { gesperrt: false, grund: 'Mängel behoben, Nachprüfung ok' });
    assert.equal(e.status, 200);
    assert.notEqual(e.daten.status, 'gesperrt');
    const sp = await buero.post('/fuhrpark/anlagen/9/sperre', { gesperrt: true, grund: 'Bremse quietscht' });
    assert.equal(sp.daten.status, 'gesperrt');
    assert.equal(sp.daten.sperre.grund, 'Bremse quietscht');
    const prot = s.db.alle("SELECT * FROM protokoll WHERE art = 'fuhrpark_sperre' AND objekt = 'anlage:9'");
    assert.ok(prot.length >= 3);
    // Optimistische Sperre
    assert.equal((await buero.put('/fuhrpark/anlagen/9', { version: 1, notiz: 'x' })).status, 409);
    assert.equal((await buero.put('/fuhrpark/anlagen/9', { version: sp.daten.version, notiz: 'Werkstatttermin vereinbart' })).status, 200);
  });

  await t.test('Ausscheiden: inaktiv, Servicebuch bleibt lesbar, kein Zählerstand mehr', async () => {
    const r = await buero.post('/fuhrpark/anlagen/32/ausscheiden', { datum: H, grund: 'Verschrottet' });
    assert.equal(r.status, 200);
    assert.equal(r.daten.status, 'ausgeschieden');
    assert.ok(!(await ma.get('/fuhrpark/anlagen')).daten.some((a) => a.id === 32));
    assert.ok((await ma.get('/fuhrpark/anlagen?inaktiv=1')).daten.some((a) => a.id === 32));
    assert.equal((await buero.get('/fuhrpark/eintraege?anlageId=32')).status, 200);
    assert.equal((await ma.post('/fuhrpark/maengel', { anlageId: 32, text: 'kaputt', dringlichkeit: 'bald' })).status, 400);
  });

  await t.test('Planposition: frei anlegen, Regelprüfung, letzteDatum nur mit Grund, deaktivieren', async () => {
    assert.equal((await buero.post('/fuhrpark/anlagen/18/plan', { titel: 'Kontrolle', art: 'intern', regel: {} })).status, 400);
    assert.equal((await buero.post('/fuhrpark/anlagen/18/plan', { vorlageSchluessel: 'cat_500' })).status, 409);
    const r = await buero.post('/fuhrpark/anlagen/18/plan', { titel: 'Schmierung Drehkranz', art: 'intern', regel: { intervallTage: 30 }, letzteDatum: '2026-10-20' });
    assert.equal(r.status, 201);
    assert.equal(r.daten.faelligAm, '2026-11-19');
    assert.equal(r.daten.status, 'bald');
    assert.equal((await buero.put(`/fuhrpark/anlagen/18/plan/${r.daten.id}`, { version: r.daten.version, letzteDatum: H })).status, 400);
    const u = await buero.put(`/fuhrpark/anlagen/18/plan/${r.daten.id}`, { version: r.daten.version, letzteDatum: H, grund: 'Laut Papier-Servicebuch' });
    assert.equal(u.status, 200);
    assert.equal(u.daten.status, 'ok');
    const d = await buero.del(`/fuhrpark/anlagen/18/plan/${r.daten.id}`);
    assert.equal(d.daten.aktiv, false);
    // Versicherung braucht Stichtag, Leasing braucht Vertragsende
    assert.equal((await buero.post('/fuhrpark/anlagen/13/plan', { vorlageSchluessel: 'vertrag_versicherung' })).status, 400);
    assert.equal((await buero.post('/fuhrpark/anlagen/13/plan', { vorlageSchluessel: 'vertrag_versicherung', regel: { jaehrlichAm: '03-01' } })).status, 201);
    assert.equal((await buero.post('/fuhrpark/anlagen/13/plan', { vorlageSchluessel: 'vertrag_leasing' })).status, 400);
  });

  await t.test('Vorlage anwenden (Vorschau, dann übernehmen), Umstieg 57a_m1 → 57a_m1_2027', async () => {
    const v = (await buero.get('/fuhrpark/vorlagen')).daten;
    const neu = v.find((x) => x.schluessel === '57a_m1_2027');
    assert.equal(neu.aktiv, false);
    assert.equal(neu.gueltigAb, '2027-05-19');
    const vs = await buero.post(`/fuhrpark/vorlagen/${neu.id}/anwenden`, { vorschau: true, ersetztVorlage: '57a_m1' });
    assert.equal(vs.status, 200);
    assert.ok(vs.daten.geaendert.length >= 3);
    assert.equal(vs.daten.angewendet, false);
    const ok = await buero.post(`/fuhrpark/vorlagen/${neu.id}/anwenden`, { anlageIds: [12], ersetztVorlage: '57a_m1' });
    assert.equal(ok.daten.angewendet, true);
    const plan = (await buero.get('/fuhrpark/anlagen/12/plan')).daten;
    assert.ok(plan.some((p) => p.vorlage.schluessel === '57a_m1_2027' && p.regel.folgeMonate[0] === 48));
    // Vorlagen-Änderung wirkt nicht rückwirkend
    const c500 = v.find((x) => x.schluessel === 'cat_500');
    assert.equal((await buero.put(`/fuhrpark/vorlagen/${c500.id}`, { version: c500.version, regel: { intervallStunden: 400 } })).status, 200);
    assert.equal((await buero.get('/fuhrpark/anlagen/18/plan')).daten.find((p) => p.vorlage && p.vorlage.schluessel === 'cat_500').regel.intervallStunden, 500);
    assert.equal((await buero.post('/fuhrpark/vorlagen', { schluessel: 'Ungültig!', titel: 'x', art: 'intern', klassen: ['lkw'], regel: { intervallMonate: 6 } })).status, 400);
    assert.equal((await buero.post('/fuhrpark/vorlagen', { schluessel: 'reifen_check', titel: 'Reifendruck', art: 'intern', klassen: ['lkw', 'pkw'], regel: { intervallTage: 30 } })).status, 201);
  });
});

test('Servicebuch: Erinnerungen genau einmal je Stufe und Zyklus, Wochen-Zusammenfassung', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const buero = await s.login(U.buero);

  await t.test('Prüflauf beim Start; wiederholter Lauf erzeugt keine Doppelten', async () => {
    const vorher = fpMeldungen(s.db, U.buero).length;
    assert.ok(vorher >= 10);
    pruefeFuhrpark(s.db, s.uhr());
    pruefeFuhrpark(s.db, s.uhr());
    assert.equal(fpMeldungen(s.db, U.buero).length, vorher);
    // §57a A03 überfällig → Pickerl-Text, Polier/Bauleiter des Standorts zusätzlich
    const p57 = s.db.eins("SELECT p.id FROM planposition p JOIN plan_vorlage v ON v.id = p.vorlage_id WHERE p.anlage_id = 3 AND v.schluessel = '57a_jaehrlich'").id;
    const m = fpMeldungen(s.db, U.buero, `fp:${p57}:%`);
    assert.equal(m.length, 1);
    assert.match(m[0].schluessel, /:ueberfaellig$/);
    assert.match(m[0].text, /^§57a-Begutachtung jährlich LKW 4-Achser Scania R 450 Kipper NK-303 BP: Begutachtungsmonat Oktober 2026 – überfällig seit 01\.11\.2026, Fahrzeug gesperrt$/);
    assert.ok(!/€/.test(m[0].text));
    const bs = s.db.eins("SELECT b.* FROM bericht_geraet bg JOIN bericht r ON r.id = bg.bericht_id JOIN baustelle b ON b.id = r.baustelle_id WHERE bg.geraet_id = (SELECT id FROM geraet WHERE code = 'lkw4') AND r.status <> 'entwurf' ORDER BY r.datum DESC, r.id DESC LIMIT 1");
    if (bs && bs.bauleiter_id) assert.equal(fpMeldungen(s.db, bs.bauleiter_id, `fp:${p57}:%`).length, 1);
    // Mitarbeiter ohne Bezug erhalten nichts
    assert.equal(fpMeldungen(s.db, U.mitarbeiter, 'fp:%').length, 0);
  });

  await t.test('Stufen: bald → fällig je einmal; Sprung direkt auf überfällig meldet nur die höchste', async () => {
    const pid = s.db.eins("SELECT p.id FROM planposition p JOIN plan_vorlage v ON v.id = p.vorlage_id WHERE p.anlage_id = 16 AND v.schluessel = 'cat_250'").id;
    assert.equal(fpMeldungen(s.db, U.buero, `fp:${pid}:%:bald`).length, 1);
    const a = (await buero.get('/fuhrpark/anlagen/16')).daten;
    const pos = a.plan.find((p) => p.id === pid);
    const r = await buero.post('/fuhrpark/zaehlerstaende', { anlageId: 16, art: 'bh', anzeige: Math.ceil(pos.faelligBei.wert), datum: H });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    assert.equal(fpMeldungen(s.db, U.buero, `fp:${pid}:%:faellig`).length, 1);
    await buero.post('/fuhrpark/zaehlerstaende', { anlageId: 16, art: 'bh', anzeige: Math.ceil(pos.faelligBei.wert) + 1, datum: H });
    pruefeFuhrpark(s.db, s.uhr());
    assert.equal(fpMeldungen(s.db, U.buero, `fp:${pid}:%`).length, 2); // bald + fällig, keine Doppelten
    const verantw = s.db.eins('SELECT verantwortlich_id FROM anlage WHERE id = 16').verantwortlich_id;
    assert.equal(fpMeldungen(s.db, verantw, `fp:${pid}:%:faellig`).length, 1);
    // neue Anlage, Position sofort weit überfällig
    const n = await buero.post('/fuhrpark/anlagen', { bezeichnung: 'Rüttelstampfer Test', klasse: 'kleingeraet', zaehler: [{ art: 'bh', startstand: 100, startdatum: '2026-09-01' }] });
    await buero.post('/fuhrpark/zaehlerstaende', { anlageId: n.daten.id, art: 'bh', anzeige: 400, datum: H });
    const p = await buero.post(`/fuhrpark/anlagen/${n.daten.id}/plan`, { titel: 'Service 100 Std.', art: 'hersteller', regel: { intervallStunden: 100 }, letzteZaehler: { bh: 100 } });
    assert.equal(p.daten.status, 'ueberfaellig');
    const ms = fpMeldungen(s.db, U.buero, `fp:${p.daten.id}:%`);
    assert.equal(ms.length, 1);
    assert.match(ms[0].schluessel, /:bh200:ueberfaellig$/);
    assert.match(ms[0].titel, /^Service überfällig: Rüttelstampfer Test$/);
    assert.match(ms[0].text, /bei 200 Std\. – Stand ≈ 400/);
  });

  await t.test('Montag ab 06:00: Wochen-Zusammenfassung und Zählerabfrage je einmal', async () => {
    s.uhr.setze('2026-11-16T04:30:00.000Z'); // Mo 05:30 Wien → noch nicht
    pruefeFuhrpark(s.db, s.uhr());
    assert.equal(fpMeldungen(s.db, U.buero, 'fp:woche:%').length, 0);
    s.uhr.setze('2026-11-16T05:10:00.000Z'); // Mo 06:10 Wien
    pruefeFuhrpark(s.db, s.uhr());
    pruefeFuhrpark(s.db, s.uhr());
    const w = fpMeldungen(s.db, U.buero, 'fp:woche:%');
    assert.equal(w.length, 1);
    assert.equal(w[0].schluessel, 'fp:woche:2026-47');
    assert.match(w[0].text, /^Fuhrpark KW 47: \d+ überfällig, (\d+ fällig, )?\d+ gesperrt, \d+ in den nächsten 3 Monaten$/);
    assert.equal(fpMeldungen(s.db, U.mitarbeiter, 'fp:woche:%').length, 0);
    const zm = s.db.alle("SELECT * FROM benachrichtigung WHERE schluessel LIKE 'fp:zaehler:%:2026-47'");
    assert.ok(zm.length >= 1);
    assert.match(zm[0].titel, /^Bitte (Kilometer|Betriebsstunden)/);
  });
});

test('Servicebuch: Bautagesbericht – Zurechnung der Gerätestunden, gesperrte Anlage, Zählerabfrage', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const buero = await s.login(U.buero);
  const pol = await s.login(U.polier);
  const geraet = (code) => s.db.eins('SELECT id FROM geraet WHERE code = ?', code).id;
  let g1, g2;

  await t.test('Gräder: ohne Anlage „nicht zugeordnet“, mit genau einer Anlage automatisch, mit zweien wieder nicht', async () => {
    const u0 = (await buero.get('/fuhrpark/uebersicht')).daten;
    const nz = u0.nichtZugeordnet.find((x) => x.code === 'graeder');
    assert.ok(nz && nz.stunden > 0 && nz.berichte > 0);
    const r = await buero.post('/fuhrpark/anlagen', { bezeichnung: 'Gräder CAT 140', klasse: 'baumaschine', geraetId: geraet('graeder'), zaehler: [{ art: 'bh', startstand: 5000, startdatum: '2026-08-01', ausBericht: true }] });
    g1 = r.daten;
    const summe = s.db.eins(`SELECT SUM(bg.stunden) AS s FROM bericht_geraet bg JOIN bericht b ON b.id = bg.bericht_id
      WHERE bg.geraet_id = ? AND b.status IN ('unterschrieben','freigegeben') AND b.datum > '2026-08-01'`, geraet('graeder')).s;
    assert.equal(g1.zaehler[0].aktuell, Math.round((5000 + summe) * 100) / 100);
    assert.equal(g1.zaehler[0].geschaetzt, true);
    assert.equal(g1.zaehler[0].schnittQuelle, 'bericht');
    assert.ok(g1.standort.baustelleId); // Standort aus dem jüngsten Bericht
    assert.equal(g1.standort.quelle, 'bericht');
    assert.ok(!(await buero.get('/fuhrpark/uebersicht')).daten.nichtZugeordnet.some((x) => x.code === 'graeder'));
    const verlauf = (await buero.get(`/fuhrpark/zaehler/${g1.zaehler[0].id}/verlauf`)).daten;
    assert.ok(verlauf.schaetzung.length >= 2);
    // F-11: zweite Anlage zum selben Gerät – bisherige Zeilen bleiben fest bei der ersten, Schätzung unverändert
    const vorher = (await buero.get(`/fuhrpark/anlagen/${g1.id}`)).daten.zaehler[0].aktuell;
    g2 = (await buero.post('/fuhrpark/anlagen', { bezeichnung: 'Gräder Komatsu GD 555', klasse: 'baumaschine', geraetId: geraet('graeder'), zaehler: [{ art: 'bh', startstand: 3000, startdatum: '2026-08-01', ausBericht: true }] })).daten;
    assert.equal((await buero.get(`/fuhrpark/anlagen/${g1.id}`)).daten.zaehler[0].aktuell, vorher);
    assert.equal(g2.zaehler[0].aktuell, 3000);
    assert.ok(!(await buero.get('/fuhrpark/uebersicht')).daten.nichtZugeordnet.some((x) => x.code === 'graeder'));
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM bericht_geraet WHERE geraet_id = ? AND anlage_id IS NULL', geraet('graeder')).n, 0);
    const ger = (await pol.get('/geraete')).daten.find((x) => x.code === 'graeder');
    assert.deepEqual(ger.anlagen.map((a) => a.id).sort(), [g1.id, g2.id].sort());
  });

  await t.test('Bericht: Anlage wählen (muss zum Gerät passen), Stunden zählen ab Unterschrift', async () => {
    const b = (await pol.post('/berichte', { baustelleId: BS.pitten, datum: H })).daten;
    const falsch = await pol.put(`/berichte/${b.id}`, { version: b.version, geraete: [{ geraetId: geraet('graeder'), stunden: 6, anlageId: 18 }] });
    assert.equal(falsch.status, 400);
    const ok = await pol.put(`/berichte/${b.id}`, { version: b.version, geraete: [{ geraetId: geraet('graeder'), stunden: 6, anlageId: g2.id }, { geraetId: geraet('grabenwalze'), stunden: 2 }] });
    assert.equal(ok.status, 200, JSON.stringify(ok.daten));
    const gr = ok.daten.geraete.find((g) => g.geraetId === geraet('graeder'));
    assert.equal(gr.anlageId, g2.id);
    assert.equal(gr.anlage.zuordnung, 'manuell');
    // Grabenwalze A27 ist wegen Mangel „sofort“ gesperrt → Hinweis, Speichern trotzdem
    const gw = ok.daten.geraete.find((g) => g.geraetId === geraet('grabenwalze'));
    assert.equal(gw.anlage.zuordnung, 'auto');
    assert.equal(gw.anlage.gesperrt, true);
    const h = ok.daten.hinweise.find((x) => x.typ === 'anlage_gesperrt');
    assert.equal(h.anlageId, 27);
    assert.match(h.text, /^Grabenwalze Bomag BMP 8500 ist gesperrt seit \d{2}\.\d{2}\.2026: Lenkung blockiert/);
    assert.equal(fpMeldungen(s.db, U.buero, `fp:gesperrt-genutzt:27:${b.id}`).length, 1);
    const ok2 = await pol.put(`/berichte/${b.id}`, { version: ok.daten.version, arbeitsleistung: 'Planum hergestellt' });
    assert.equal(fpMeldungen(s.db, U.buero, `fp:gesperrt-genutzt:27:${b.id}`).length, 1); // einmalig
    assert.equal((await pol.get(`/berichte/${b.id}`)).daten.anlagenVorschlag[geraet('graeder')], g2.id);
    // Entwurf zählt nicht
    assert.equal((await buero.get(`/fuhrpark/anlagen/${g2.id}`)).daten.zaehler[0].aktuell, 3000);
    let v = ok2.daten.version;
    for (const rolle of ['an', 'bh']) {
      const r = await pol.post(`/berichte/${b.id}/unterschrift`, { version: v, rolle, name: rolle === 'an' ? 'Josef Haidbauer' : 'Bauherr Test', bildPng: demoUnterschrift(`fp-${rolle}-test`) });
      assert.equal(r.status, 200, JSON.stringify(r.daten));
      v = r.daten.version;
    }
    const nach = (await buero.get(`/fuhrpark/anlagen/${g2.id}`)).daten;
    assert.equal(nach.zaehler[0].aktuell, 3006);
    assert.equal(nach.standort.baustelleId, BS.pitten);
    // Standort händisch setzen (jünger als der Bericht? gleicher Tag → Bericht bleibt maßgeblich bis zum nächsten Tag)
    const put = await buero.put(`/fuhrpark/anlagen/${g2.id}`, { version: nach.version, standortText: 'Bauhof Breitenau', standortBaustelleId: null });
    assert.equal(put.status, 200);
  });

  await t.test('Ausstempeln: Zählerabfrage für eigene Fahrzeuge mit altem Stand', async () => {
    const r = await buero.post('/fuhrpark/anlagen', { bezeichnung: 'Pritsche Test', klasse: 'lkw', fahrzeugklasse: 'N1', kennzeichen: 'NK-999 BP', verantwortlichId: 26, zaehler: [{ art: 'km', startstand: 15000, startdatum: '2026-10-01' }] });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    const c = await s.login(26);
    const abfrage = (await c.get('/fuhrpark/zaehlerabfrage')).daten;
    const e = abfrage.find((x) => x.anlageId === r.daten.id);
    assert.deepEqual(e.zaehler.map((z) => [z.art, z.einheit, z.letzterStand, z.letzterDatum]), [['km', 'km', 15000, '2026-10-01']]);
    s.uhr.setze('2026-11-12T15:00:00.000Z');
    const g = await c.post('/zeit/stempeln', { typ: 'gehen' });
    assert.equal(g.status, 200, JSON.stringify(g.daten));
    assert.ok(g.daten.zaehlerAbfrage.some((x) => x.anlageId === r.daten.id && x.kennzeichen === 'NK-999 BP'));
    const k = await c.post('/zeit/stempeln', { typ: 'kommen', baustelleId: s.db.eins('SELECT baustelle_id FROM benutzer WHERE id = 26').baustelle_id });
    assert.equal(k.status, 200);
    assert.ok(!('zaehlerAbfrage' in k.daten));
    // nach Eintragen ist die Abfrage leer
    await c.post('/fuhrpark/zaehlerstaende', { anlageId: r.daten.id, art: 'km', anzeige: 16200 });
    assert.ok(!(await c.get('/fuhrpark/zaehlerabfrage')).daten.some((x) => x.anlageId === r.daten.id));
  });
});
