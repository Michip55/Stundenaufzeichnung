'use strict';
/**
 * API.md 15.2 – Kolonne verrät keine Abwesenheiten (Inhaberregel 3: „Die Poliere, Mitarbeiter untereinander sollen gar nicht
 * Abwesenheiten sehen.“). Befunde F-013, F-018, F-032, F-034, F-045 (Abwesenheits-Orakel) und F-033 (Baustellenauswahl).
 *
 * Dauerhafter Orakel-Test: Für Polier und Mitarbeiter mit Ausnahme „kolonne“ sind Antworten für abwesende (K, U, BU, ZA)
 * und anwesende Personen gleich – Vorschau (auch plan=1), Stempeln in der eigenen Partie, als Gast (gast:true), Folgebuchungen.
 * Das Büro (Büro/GF/alle mit stammdaten oder lohn) erhält „Stempelung trotz eingetragener Abwesenheit … – bitte klären“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');

const TAG = '2026-11-12'; // Testdaten-Tag (Do), START 10:24 Wiener Zeit
const ALT_TEXT = /kann heute nicht über die Kolonne gestempelt werden/;
const HINWEIS = 'Stempelung trotz eingetragener Abwesenheit';
const NAME = { 1: 'Josef Haidbauer', 2: 'Lukas Brandstätter', 3: 'Daniel Schwarz', 4: 'Roland Kerschbaumer', 5: 'Mehmet Yıldız', 6: 'Fabian Stickler', 7: 'Karl Ungersböck', 16: 'Patrick Hofer', 24: 'Elias Woltron', 28: 'Erwin Pürrer', 29: 'Johann Tisch' };

/** Abwesenheiten für TAG: 3 U (Testdaten), 4 K, 6 ZA, 7 Betriebsurlaub; fremde Partien: 24 K, 28 U (Testdaten) */
async function abwesenheitenAnlegen(s, buero) {
  for (const [id, code] of [[4, 'K'], [6, 'ZA']]) {
    const r = await buero.post('/abwesenheiten', { benutzerId: id, datum: TAG, code });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
  }
  s.db.lauf("INSERT INTO abwesenheit (benutzer_id, datum, code, status, erfasst_von, erfasst, betriebsurlaub) VALUES (7, ?, 'U', 'genehmigt', ?, ?, 1)", TAG, U.buero, s.uhr().toISOString());
  const n = s.db.eins("SELECT COUNT(*) AS n FROM abwesenheit WHERE datum = ? AND status = 'genehmigt' AND benutzer_id IN (3,4,6,7,24,28)", TAG).n;
  assert.equal(n, 6, 'Testdaten: sechs Abwesende');
}

/** Felder einer Vorschau-Zeile ohne Identität der Person */
const ohneIdentitaet = (x) => { const { benutzerId, name, rolle, ...rest } = x; return rest; }; // eslint-disable-line no-unused-vars
const ergebnisOhneId = (x) => { const { benutzerId, ...rest } = x; return rest; }; // eslint-disable-line no-unused-vars

/** Alle Ergebnisse untereinander gleich (bis auf benutzerId) */
function alleGleich(ergebnisse, was) {
  assert.ok(ergebnisse.length >= 2, `${was}: zu wenige Ergebnisse`);
  const erstes = JSON.stringify(ergebnisOhneId(ergebnisse[0]));
  for (const e of ergebnisse) assert.equal(JSON.stringify(ergebnisOhneId(e)), erstes, `${was}: Antwort für ${e.benutzerId} weicht ab`);
}

async function warteAuf(fn, ms = 2000) {
  const ende = Date.now() + ms;
  for (;;) {
    const x = fn();
    if (x) return x;
    if (Date.now() > ende) return x;
    await new Promise((r) => setTimeout(r, 10));
  }
}

/**
 * Orakel-Szenario für einen Aufrufer. Partie Pitten (BS 1): abwesend 3, 4, 6, 7 – anwesend `anwesend`.
 * Gäste aus fremden Partien: abwesend 24 (K, BS 6), 28 (U, BS 7) – anwesend 16 (BS 4), 29 (BS 7).
 */
async function orakel(t, { aufrufer, ausnahme, anwesend }) {
  const s = await starte();
  t.after(() => s.stop());
  const buero = await s.login(U.buero);
  const gf = await s.login(U.gf);
  if (ausnahme) assert.equal((await gf.put('/rechte/ausnahme', { benutzerId: aufrufer, recht: 'kolonne', wert: true })).status, 200);
  await abwesenheitenAnlegen(s, buero);
  // F-034: fremde Abwesende und Anwesende sind heute in Pitten eingeplant (veröffentlicht) → plan=1 zeigt sie
  const ep = await buero.post('/plan/einsaetze', { datum: TAG, baustelleId: BS.pitten, benutzerIds: [24, 16], beginn: '07:00' });
  assert.equal(ep.status, 201, JSON.stringify(ep.daten));
  assert.equal((await buero.post('/plan/veroeffentlichen', { von: TAG })).status, 200);
  const c = await s.login(aufrufer);
  const abwesend = [3, 4, 6, 7];
  const gaesteAbw = [28], gaesteAnw = [29]; // 27 hat seit gestern eine offene Schicht
  const texte = [];

  await t.test('Vorschau GET /zeit/kolonne: kein kolonneMoeglich, abwesend = anwesend (F-032, F-045; plan=1: F-034)', async () => {
    for (const q of ['', '&plan=1']) {
      const r = await c.get(`/zeit/kolonne?baustelleId=${BS.pitten}${q}`);
      assert.equal(r.status, 200);
      texte.push(JSON.stringify(r.daten));
      assert.ok(r.daten.every((x) => !('kolonneMoeglich' in x)), 'kolonneMoeglich wird ausgeliefert');
      const zeile = (id) => r.daten.find((x) => x.benutzerId === id);
      for (const id of [...abwesend, ...anwesend]) assert.ok(zeile(id), `Person ${id} fehlt in der Vorschau`);
      const muster = JSON.stringify(ohneIdentitaet(zeile(anwesend[0])));
      for (const id of [...abwesend, ...anwesend]) assert.equal(JSON.stringify(ohneIdentitaet(zeile(id))), muster, `Vorschau ${id}${q}`);
      assert.ok(r.daten.filter((x) => x.benutzerId !== aufrufer).every((x) => x.code === null), 'Code einer anderen Person');
      if (q) {
        // eingeplante Gäste: abwesend (24) und anwesend (16) gleich
        assert.ok(zeile(24) && zeile(16), 'eingeplante Gäste fehlen');
        assert.equal(JSON.stringify(ohneIdentitaet(zeile(24))), JSON.stringify(ohneIdentitaet(zeile(16))), 'eingeplanter Gast abwesend ≠ anwesend');
        assert.equal(zeile(24).geplant, true);
      }
      // Reihenfolge nur nach Name
      const namen = r.daten.map((x) => x.name);
      assert.deepEqual(namen, [...namen].sort((a, b) => a.localeCompare(b, 'de')));
    }
  });

  await t.test('Stempeln in der Partie: alle angenommen, gleiche Antwort (F-032, F-045)', async () => {
    const ids = [anwesend[0], ...abwesend, ...anwesend.slice(1)];
    const r = await c.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: ids, typ: 'kommen' });
    assert.equal(r.status, 200);
    texte.push(JSON.stringify(r.daten));
    assert.deepEqual(r.daten.ergebnisse.map((x) => x.benutzerId), ids);
    assert.ok(r.daten.ergebnisse.every((x) => x.ok === true && x.status === 'arbeit'), JSON.stringify(r.daten));
    alleGleich(r.daten.ergebnisse, 'kommen Partie');
    for (const id of ids) assert.equal(s.db.eins("SELECT quelle FROM buchung WHERE benutzer_id = ? ORDER BY id DESC", id).quelle, 'kolonne');
  });

  await t.test('Als Gast (gast:true, fremde Partien): kein firmenweites Orakel (F-013, F-018)', async () => {
    const ids = [...gaesteAnw, ...gaesteAbw];
    const r = await c.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: ids, typ: 'kommen', gast: true });
    assert.equal(r.status, 200);
    texte.push(JSON.stringify(r.daten));
    assert.ok(r.daten.ergebnisse.every((x) => x.ok === true), JSON.stringify(r.daten));
    alleGleich(r.daten.ergebnisse, 'kommen Gast');
    // eingeplant (ohne gast:true): abwesend 24 = anwesend 16
    const e = await c.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: [16, 24], typ: 'kommen' });
    texte.push(JSON.stringify(e.daten));
    alleGleich(e.daten.ergebnisse, 'kommen eingeplant');
    assert.ok(e.daten.ergebnisse.every((x) => x.ok === true), JSON.stringify(e.daten));
  });

  await t.test('Folgebuchungen und Fehlerfälle: gleich für Abwesende und Anwesende', async () => {
    const alle = [...abwesend, ...anwesend, ...gaesteAbw, ...gaesteAnw, 16, 24];
    // zweimal kommen → derselbe 409-Text (gleiche Uhrzeit)
    const nochmal = await c.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: [...abwesend, ...anwesend], typ: 'kommen', gast: true });
    texte.push(JSON.stringify(nochmal.daten));
    assert.ok(nochmal.daten.ergebnisse.every((x) => x.ok === false && /^Bereits eingestempelt/.test(x.fehler)));
    alleGleich(nochmal.daten.ergebnisse, 'zweites kommen');
    s.uhr.plus(60);
    for (const typ of ['pause_start', 'pause_ende', 'gehen']) {
      const r = await c.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: alle, typ });
      texte.push(JSON.stringify(r.daten));
      assert.ok(r.daten.ergebnisse.every((x) => x.ok === true), `${typ}: ${JSON.stringify(r.daten)}`);
      alleGleich(r.daten.ergebnisse, typ);
      s.uhr.plus(15);
    }
    const v = await c.get(`/zeit/kolonne?baustelleId=${BS.pitten}&plan=1`);
    texte.push(JSON.stringify(v.daten));
    const muster = JSON.stringify(ohneIdentitaet(v.daten.find((x) => x.benutzerId === anwesend[0])));
    for (const id of [...abwesend, ...anwesend]) assert.equal(JSON.stringify(ohneIdentitaet(v.daten.find((x) => x.benutzerId === id))), muster, `Vorschau danach ${id}`);
  });

  await t.test('Nirgends der alte Sperrtext, kein Code, kein Abwesenheitswort', async () => {
    for (const x of texte) {
      assert.doesNotMatch(x, ALT_TEXT);
      assert.doesNotMatch(x, /kolonneMoeglich|Krankenstand|Urlaub|Zeitausgleich|abwesend|Abwesenheit/i);
    }
  });

  await t.test('Büro/GF/Bauleiter erhalten „Stempelung trotz eingetragener Abwesenheit“, Polier/Mitarbeiter nie', async () => {
    const betroffen = [...abwesend, ...gaesteAbw, 24];
    const empfaenger = [U.buero, U.gf, U.bauleiter];
    const zeilen = await warteAuf(() => { const z = s.db.alle("SELECT * FROM benachrichtigung WHERE schluessel LIKE 'abw-stempel:%'"); return z.length >= betroffen.length * empfaenger.length ? z : null; });
    assert.ok(zeilen, 'keine bzw. zu wenige Hinweise an das Büro');
    assert.equal(zeilen.length, betroffen.length * empfaenger.length, 'genau ein Hinweis je Person, Tag und Empfänger (auch nach Folgebuchungen)');
    for (const e of empfaenger) {
      const eigene = zeilen.filter((z) => z.benutzer_id === e);
      assert.deepEqual(eigene.map((z) => z.text).sort(), betroffen.map((id) => `${HINWEIS}: ${NAME[id]}, 12.11.2026 – bitte klären`).sort(), `Empfänger ${e}`);
      assert.ok(eigene.every((z) => z.titel === HINWEIS && z.typ === 'abwesenheit'));
    }
    const feld = s.db.alle("SELECT b.rolle FROM benachrichtigung n JOIN benutzer b ON b.id = n.benutzer_id WHERE n.schluessel LIKE 'abw-stempel:%' AND b.rolle IN ('polier','mitarbeiter')");
    assert.deepEqual(feld, [], 'Hinweis an Polier/Mitarbeiter');
    const meine = (await c.get('/benachrichtigungen')).daten;
    assert.doesNotMatch(JSON.stringify(meine), /trotz eingetragener Abwesenheit/);
    // Büro sieht den Hinweis in seiner Liste
    assert.match(JSON.stringify((await buero.get('/benachrichtigungen')).daten), /Stempelung trotz eingetragener Abwesenheit: Roland Kerschbaumer, 12\.11\.2026 – bitte klären/);
  });

  await t.test('Monatsauswertung: Warnung abwesenheit_mit_stunden für jede Stempelung trotz Abwesenheit', async () => {
    const m = (await buero.get('/monat?monat=2026-11')).daten;
    for (const id of [...abwesend, ...gaesteAbw, 24]) {
      const w = m.warnungen.find((x) => x.benutzerId === id && x.datum === TAG && x.typ === 'abwesenheit_mit_stunden');
      assert.ok(w, `Warnung für ${id} fehlt`);
      assert.equal(w.gestempelt, true);
      assert.match(w.text, /Stempelung trotz eingetragener Abwesenheit – bitte klären\.$/);
    }
    for (const id of anwesend) assert.ok(!m.warnungen.some((x) => x.benutzerId === id && x.datum === TAG && x.typ === 'abwesenheit_mit_stunden'));
  });
  return s;
}

test('Orakel Kolonne: Polier (Standardrechte)', async (t) => {
  await orakel(t, { aufrufer: U.polier, anwesend: [2, 5] });
});

test('Orakel Kolonne: Mitarbeiter mit Ausnahme „kolonne“', async (t) => {
  await orakel(t, { aufrufer: U.mitarbeiter, ausnahme: true, anwesend: [5, U.polier] });
});

test('Kolonne: inaktive Personen, eigene Abwesenheit, Baustellenbereich (F-033)', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const buero = await s.login(U.buero);
  const gf = await s.login(U.gf);
  const pol = await s.login(U.polier);
  assert.equal((await gf.put('/rechte/ausnahme', { benutzerId: 5, recht: 'kolonne', wert: true })).status, 200);
  const ma = await s.login(5);

  await t.test('Inaktive: nie angeboten, Ablehnung wie bei unbekannter Person', async () => {
    s.db.lauf('UPDATE benutzer SET aktiv = 0 WHERE id IN (4, 24)');
    assert.equal((await buero.post('/abwesenheiten', { benutzerId: 6, datum: TAG, code: 'K' })).status, 201);
    for (const c of [pol, ma]) {
      const l = (await c.get(`/zeit/kolonne?baustelleId=${BS.pitten}&plan=1`)).daten;
      assert.ok(!l.some((x) => [4, 24].includes(x.benutzerId)), 'inaktive Person wird angeboten');
      const r = await c.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: [4, 9999, 24], typ: 'kommen', gast: true });
      assert.ok(r.daten.ergebnisse.every((x) => x.ok === false));
      alleGleich(r.daten.ergebnisse, 'inaktiv/unbekannt');
      assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM buchung WHERE benutzer_id IN (4, 24) AND zeit >= ?', `${TAG}T00:00:00Z`).n, 0);
    }
    s.db.lauf('UPDATE benutzer SET aktiv = 1 WHERE id IN (4, 24)');
  });

  await t.test('Eigene Stempelung bei eigener Abwesenheit: gesperrt, Grund nur über sich selbst', async () => {
    const daniel = await s.login(3); // U laut Testdaten
    const r = await daniel.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
    assert.equal(r.status, 409);
    assert.equal(r.daten.fehler, 'Für diesen Tag ist Urlaub eingetragen – Einstempeln nicht möglich. Bitte im Büro klären.');
    // Polier mit eigenem Krankenstand stempelt die Kolonne inkl. sich selbst: nur seine eigene Zeile nennt seinen Grund
    assert.equal((await buero.post('/abwesenheiten', { benutzerId: U.polier, datum: TAG, code: 'K' })).status, 201);
    const k = await pol.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: [U.polier, 2, 6], typ: 'kommen' });
    const e = Object.fromEntries(k.daten.ergebnisse.map((x) => [x.benutzerId, x]));
    assert.deepEqual([e[1].ok, e[1].fehler], [false, 'Für diesen Tag ist Krankenstand eingetragen – Einstempeln nicht möglich. Bitte im Büro klären.']);
    assert.deepEqual([e[2], e[6]].map(ergebnisOhneId), [{ ok: true, status: 'arbeit' }, { ok: true, status: 'arbeit' }]);
    // eigene Vorschau: eigener Code sichtbar, fremde nie
    const l = (await pol.get(`/zeit/kolonne?baustelleId=${BS.pitten}`)).daten;
    assert.equal(l.find((x) => x.benutzerId === U.polier).code, 'K');
    assert.ok(l.filter((x) => x.benutzerId !== U.polier).every((x) => x.code === null));
    // Büro/GF sehen in ihrer Vorschau die echten Codes weiterhin (stammdaten/lohn)
    const b = (await gf.get(`/zeit/kolonne?baustelleId=${BS.pitten}`)).daten;
    assert.equal(b.find((x) => x.benutzerId === 6).code, 'K');
    assert.ok(b.every((x) => !('kolonneMoeglich' in x)));
  });

  await t.test('F-033: Kolonne nur auf Baustellen aus /auth/ich baustellenIds (Serverregel = Auswahl der Oberfläche)', async () => {
    const alle = (await buero.get('/baustellen')).daten.map((b) => b.id);
    for (const [c, eigene] of [[ma, [BS.pitten]], [pol, [BS.pitten]], [await s.login(13), [BS.reisinger, BS.breitenau]], [gf, alle]]) {
      const ich = (await c.get('/auth/ich')).daten;
      assert.deepEqual([...ich.baustellenIds].sort((a, b) => a - b), [...eigene].sort((a, b) => a - b), `baustellenIds ${ich.benutzer.id}`);
      for (const id of alle) {
        const r = await c.get(`/zeit/kolonne?baustelleId=${id}&plan=1`);
        assert.equal(r.status, ich.baustellenIds.includes(id) ? 200 : 403, `Baustelle ${id} für ${ich.benutzer.id}`);
      }
    }
  });
});
