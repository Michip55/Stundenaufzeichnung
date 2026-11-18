'use strict';
/**
 * Datenschutz bei Abwesenheiten (Prüfbericht 7 R-01…R-03, verschärft durch den Inhaber am 13.11.2026):
 *  - Polier und Mitarbeiter sehen Abwesenheiten ANDERER gar nicht (nicht einmal „abwesend“) – in keinem Pfad, auch nicht in PDFs.
 *  - Bauleiter wie Büro: alles (echte Codes, Notizen).
 *  - Krankenstand nie in einem Bericht-PDF (intern „abw.“, AG ohne).
 *  - Schlechtwetter meldet der Polier weiter – ohne Auskunft über bestehende Abwesenheiten.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');

const TAG = '2026-11-13'; // Freitag
const DANIEL = 3; // Partie Pitten (Polier 1)
const DIAGNOSE = 'DIAGNOSE-GEHEIM-4711';

function pdfText(buf) {
  const s = buf.toString('latin1');
  return [...s.matchAll(/\[([^\]]*)\]\s*TJ/g)].map((m) => [...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join('')).join('\n');
}
/** keine Abwesenheits-Information über Personen außer `ich` */
function nichtsUeberAndere(o, ich, was) {
  const j = Buffer.isBuffer(o) ? pdfText(o) : JSON.stringify(o);
  assert.ok(!j.includes(DIAGNOSE), `${was}: Notiz sichtbar`);
  assert.ok(!/Krank/i.test(j), `${was}: „Krank…“`);
  const lauf = (x) => {
    if (Array.isArray(x)) return x.forEach(lauf);
    if (x && typeof x === 'object') {
      if (x.benutzerId !== undefined && x.benutzerId !== ich) assert.ok(!['K', 'U', 'ZA', 'abwesend', 'BU'].includes(x.code), `${was}: Code ${x.code} von ${x.benutzerId}`);
      Object.values(x).forEach(lauf);
    }
  };
  if (!Buffer.isBuffer(o)) lauf(o);
}

test('Polier/Mitarbeiter: keine fremden Abwesenheiten; Bauleiter wie Büro; Krankenstand nie im Bericht-PDF', async (t) => {
  const s = await starte({ test: true, pdfUnkomprimiert: true, sitzung: { feldMin: 60 * 24 * 30, bueroMin: 60 * 24 * 30, maxH: 24 * 60 } });
  t.after(() => s.stop());
  const c = {};
  for (const r of ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf']) c[r] = await s.login(U[r]);
  c.daniel = await s.login(DANIEL);
  const k = await c.buero.post('/abwesenheiten/zeitraum', { benutzerId: DANIEL, von: TAG, bis: TAG, code: 'K', notiz: DIAGNOSE });
  assert.equal(k.status, 201, JSON.stringify(k.daten));

  await t.test('Abwesenheiten, Anträge, Kalender, Konto, Warnungen: Polier/Mitarbeiter nur sich selbst', async () => {
    for (const [r, ich] of [['polier', U.polier], ['mitarbeiter', U.mitarbeiter]]) {
      const l = (await c[r].get('/abwesenheiten')).daten;
      assert.ok(l.every((a) => a.benutzerId === ich), `${r}: nur eigene`);
      assert.equal((await c[r].get(`/abwesenheiten?benutzerId=${DANIEL}`)).daten.length, 0);
      const a = (await c[r].get('/abwesenheiten/antraege')).daten;
      assert.ok(a.every((x) => x.benutzerId === ich));
      const kal = (await c[r].get(`/urlaub/kalender?von=${TAG}&bis=${TAG}`)).daten;
      assert.deepEqual(kal.personen.map((p) => p.benutzerId), [ich], `${r}: Kalender nur eigene Zeile`);
      const konto = (await c[r].get('/urlaub/konto')).daten;
      assert.deepEqual(konto.map((x) => x.benutzerId), [ich]);
      assert.equal((await c[r].get(`/urlaub/warnungen?von=${TAG}&bis=${TAG}`)).status, 403);
      // keine Aggregate: Kalender-Warnungen leer (z. B. „WHA Pitten: 6 von 7 Personen abwesend“ am SW-Tag 03.11.)
      const kw = (await c[r].get('/urlaub/kalender?von=2026-11-02&bis=2026-11-20')).daten;
      assert.deepEqual(kw.warnungen, [], `${r}: Kalender-Warnungen`);
      assert.ok(!/\d+ von \d+ Personen abwesend|partie_viele|plan_konflikt/.test(JSON.stringify(kw)));
      for (const x of [l, a, kal, konto]) nichtsUeberAndere(x, ich, r);
      // fremde Einträge sind unsichtbar – auch beim Löschen
      assert.equal((await c[r].del(`/abwesenheiten/antraege/${k.daten.antragId}`)).status, 404);
    }
    // die Person selbst, Büro und Bauleiter (wie Büro): alles
    for (const r of ['daniel', 'buero', 'bauleiter']) {
      const l = (await c[r].get(`/abwesenheiten?benutzerId=${DANIEL}&von=${TAG}&bis=${TAG}`)).daten;
      assert.deepEqual([l[0].code, l[0].notiz], ['K', DIAGNOSE], r);
    }
    const kal = (await c.bauleiter.get(`/urlaub/kalender?von=${TAG}&bis=${TAG}`)).daten;
    assert.equal(kal.personen.find((p) => p.benutzerId === DANIEL).tage[TAG].code, 'K');
    // Büro/Bauleiter behalten die Warnungen (Gegenprobe zum Polier-Fall oben)
    for (const r of ['buero', 'bauleiter']) {
      const kw = (await c[r].get('/urlaub/kalender?von=2026-11-02&bis=2026-11-20')).daten;
      assert.ok(kw.warnungen.some((w) => w.typ === 'partie_viele' && / von \d+ Personen abwesend/.test(w.text)), `${r}: partie_viele`);
    }
  });

  await t.test('Schlechtwetter: Polier meldet, erfährt aber nichts über bestehende Abwesenheiten', async () => {
    const n0 = s.db.eins('SELECT COALESCE(MAX(id), 0) AS n FROM benachrichtigung').n;
    const v = await c.polier.post('/abwesenheiten/zeitraum', { benutzerId: DANIEL, von: TAG, bis: TAG, code: 'SW', vorschau: true });
    assert.equal(v.status, 200);
    assert.ok(!('uebersprungen' in v.daten) && !('tage' in v.daten));
    const r = await c.polier.post('/abwesenheiten', { benutzerId: DANIEL, datum: TAG, code: 'SW' });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    assert.equal(r.daten.text, 'Schlechtwetter gemeldet – das Büro bestätigt.');
    assert.equal(r.daten.status, 'gemeldet');
    assert.ok(!/bereits|abwesend|uebersprungen/.test(JSON.stringify(r.daten)));
    nichtsUeberAndere(r.daten, U.polier, 'SW-Meldung');
    // Krankenstand bleibt unverändert, Büro bekommt genau eine Meldung
    assert.equal(s.db.eins('SELECT code FROM abwesenheit WHERE benutzer_id = ? AND datum = ?', DANIEL, TAG).code, 'K');
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM benachrichtigung WHERE benutzer_id = ? AND schluessel = ?', U.buero, `sw:${r.daten.meldungId}`).n, 1);
    // für eine Person ohne Abwesenheit entsteht ein SW-Antrag; die Meldungsliste zeigt nur „gemeldet/bestätigt“
    const r2 = await c.polier.post('/abwesenheiten/zeitraum', { benutzerId: 4, von: TAG, bis: TAG, code: 'SW' });
    assert.equal(r2.status, 201);
    assert.equal(s.db.eins('SELECT status FROM abwesenheit WHERE benutzer_id = 4 AND datum = ?', TAG).status, 'beantragt');
    let liste = (await c.polier.get('/abwesenheiten/sw-meldungen')).daten;
    assert.deepEqual(liste.map((m) => [m.benutzerId, m.status]).sort(), [[4, 'gemeldet'], [DANIEL, 'gemeldet']].sort());
    assert.ok(liste.every((m) => Object.keys(m).every((x) => ['id', 'benutzerId', 'name', 'von', 'bis', 'status', 'erstellt', 'polier', 'bestaetigt'].includes(x))));
    assert.equal((await c.mitarbeiter.get('/abwesenheiten/sw-meldungen')).status, 403);
    assert.equal((await c.polier.post(`/abwesenheiten/sw-meldungen/${r.daten.meldungId}/bestaetigen`, {})).status, 403);
    // Büro bestätigt → beide „bestätigt“, Polier erhält je eine Meldung ohne Details
    for (const m of [r.daten.meldungId, r2.daten.meldungId]) assert.equal((await c.buero.post(`/abwesenheiten/sw-meldungen/${m}/bestaetigen`, {})).status, 200);
    liste = (await c.polier.get('/abwesenheiten/sw-meldungen')).daten;
    assert.ok(liste.every((m) => m.status === 'bestaetigt'));
    assert.equal(s.db.eins('SELECT code FROM abwesenheit WHERE benutzer_id = ? AND datum = ?', DANIEL, TAG).code, 'K');
    const pm = s.db.alle("SELECT * FROM benachrichtigung WHERE benutzer_id = ? AND id > ? AND titel = 'Schlechtwetter-Meldung bestätigt'", U.polier, n0);
    assert.equal(pm.length, 2);
    nichtsUeberAndere(pm, U.polier, 'Meldung an Polier');
    nichtsUeberAndere((await c.polier.get('/benachrichtigungen')).daten, U.polier, 'Benachrichtigungen Polier');
  });

  await t.test('Kolonne/Stempeluhr: nichts verrät den Krankenstand, das Büro klärt (API.md 15.2)', async () => {
    s.uhr.setze(`${TAG}T06:00:00.000Z`);
    // die Person selbst erfährt den Grund (eigene Stempelung bleibt gesperrt)
    const selbst = await c.daniel.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
    assert.equal(selbst.status, 409);
    assert.match(selbst.daten.fehler, /Krankenstand/);
    const l = (await c.polier.get(`/zeit/kolonne?baustelleId=${BS.pitten}`)).daten;
    const d = l.find((x) => x.benutzerId === DANIEL);
    assert.equal(d.code, null);
    assert.ok(l.every((x) => !('kolonneMoeglich' in x)));
    nichtsUeberAndere(l, U.polier, 'Kolonne');
    // Kolonne nimmt an – gleiche Antwort wie für jede anwesende Person
    const r = await c.polier.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: [DANIEL], typ: 'kommen' });
    assert.deepEqual(r.daten.ergebnisse, [{ benutzerId: DANIEL, ok: true, status: 'arbeit' }]);
    nichtsUeberAndere(r.daten, U.polier, 'Kolonne POST');
    assert.doesNotMatch(JSON.stringify(r.daten), /kann heute nicht|Abwesenheit|Krank/);
    // das Büro erhält den Klärungshinweis ohne Grund, der Polier nicht
    let hinweis = [];
    for (let i = 0; i < 200 && !hinweis.length; i++) { hinweis = s.db.alle("SELECT * FROM benachrichtigung WHERE benutzer_id = ? AND schluessel = ?", U.buero, `abw-stempel:${DANIEL}:${TAG}`); if (!hinweis.length) await new Promise((x) => setTimeout(x, 10)); }
    assert.equal(hinweis.length, 1);
    assert.equal(hinweis[0].text, `Stempelung trotz eingetragener Abwesenheit: ${s.db.eins('SELECT name FROM benutzer WHERE id = ?', DANIEL).name}, ${TAG.split('-').reverse().join('.')} – bitte klären`);
    nichtsUeberAndere((await c.polier.get('/benachrichtigungen')).daten, U.polier, 'Benachrichtigungen Polier nach Kolonne');
    assert.doesNotMatch(JSON.stringify((await c.polier.get('/benachrichtigungen')).daten), /trotz eingetragener Abwesenheit/);
    // Stempelung zurücknehmen (Büro-Korrektur), damit die folgenden Prüfungen vom unveränderten Tag ausgehen
    const b = s.db.eins("SELECT id FROM buchung WHERE benutzer_id = ? AND quelle = 'kolonne' ORDER BY id DESC", DANIEL);
    s.db.lauf('DELETE FROM buchung WHERE id = ?', b.id);
  });

  await t.test('Bericht: Polier sieht Abwesende nicht, Speichern behält den K-Eintrag des Büros; PDFs nie K', async () => {
    s.db.lauf('DELETE FROM bericht WHERE baustelle_id = ? AND datum = ?', BS.pitten, TAG);
    const b = (await c.polier.post('/berichte', { baustelleId: BS.pitten, datum: TAG })).daten;
    assert.ok(!b.personal.some((x) => x.benutzerId === DANIEL), 'Abwesender ohne Stunden fehlt für den Polier');
    nichtsUeberAndere(b, U.polier, 'Bericht Polier');
    assert.equal(s.db.eins('SELECT code FROM bericht_personal WHERE bericht_id = ? AND benutzer_id = ?', b.id, DANIEL).code, 'K');
    assert.equal((await c.bauleiter.get(`/berichte/${b.id}`)).daten.personal.find((x) => x.benutzerId === DANIEL).code, 'K');
    assert.equal((await c.buero.get(`/berichte/${b.id}`)).daten.personal.find((x) => x.benutzerId === DANIEL).code, 'K');
    // Polier speichert ohne die ausgeblendete Zeile → K bleibt gespeichert
    const r = await c.polier.put(`/berichte/${b.id}`, { version: b.version, personal: b.personal.map((x) => ({ benutzerId: x.benutzerId, von1: x.von1, bis1: x.bis1, von2: x.von2, bis2: x.bis2, pauseMin: x.pauseMin, code: x.code, segStunden: x.segStunden })) });
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    assert.equal(s.db.eins('SELECT code FROM bericht_personal WHERE bericht_id = ? AND benutzer_id = ?', b.id, DANIEL).code, 'K');
    nichtsUeberAndere(r.daten, U.polier, 'Bericht Polier nach PUT');
    for (const [rolle, fassung] of [['bauleiter', 'intern'], ['buero', 'intern'], ['polier', 'ag'], ['buero', 'ag']]) {
      const pdf = await c[rolle].get(`/berichte/${b.id}/pdf?fassung=${fassung}`);
      assert.equal(pdf.status, 200, `${rolle} ${fassung}`);
      const tx = pdfText(pdf.daten);
      assert.ok(!/Krank/.test(tx), `${rolle} ${fassung}: „Krank“ im PDF`);
      assert.ok(!tx.split('\n').includes('K'), `${rolle} ${fassung}: Kürzel K im PDF`);
      if (fassung === 'intern') assert.ok(tx.split('\n').includes('abw.') && /abw\. = abwesend/.test(tx));
      else assert.ok(!tx.split('\n').some((z) => ['abw.', 'U', 'ZA'].includes(z)), `${rolle} AG: keine Abwesenheits-Kürzel`);
    }
  });

  await t.test('Planer und Plan-PDFs: für den Polier keine Abwesenheiten anderer', async () => {
    s.uhr.setze('2026-11-12T09:00:00.000Z');
    await c.buero.post('/plan/einsaetze', { datum: TAG, baustelleId: BS.pitten, beginn: '07:00', benutzerIds: [U.polier, U.mitarbeiter] });
    await c.buero.post('/plan/veroeffentlichen', { von: TAG });
    const pdf = await c.polier.get(`/plan/tag.pdf?datum=${TAG}`);
    assert.equal(pdf.status, 200);
    const tx = pdfText(pdf.daten);
    assert.ok(!/Nicht eingeteilt|abwesend|Urlaub|Krank/.test(tx), 'Polier-PDF ohne Abwesenheiten');
    nichtsUeberAndere((await c.polier.get(`/plan/partie?datum=${TAG}`)).daten, U.polier, 'Meine Partie');
    nichtsUeberAndere((await c.mitarbeiter.get('/plan/ich')).daten, U.mitarbeiter, 'Mein Einsatz');
    // Büro/Bauleiter sehen im Plan-PDF den echten Grund
    const bt = pdfText((await c.bauleiter.get(`/plan/tag.pdf?datum=${TAG}`)).daten).replace(/\s*\n\s*/g, ' ');
    assert.match(bt, /Daniel Schwarz: Krank/);
  });
});

test('Sicherheitsnetz: ohneFremdeAggregate entfernt Abwesenheits-Aggregate nur für Polier/Mitarbeiter', () => {
  const DS = require('../../server/datenschutz');
  const ctx = (rolle, rechte = []) => ({ benutzer: { id: 1, rolle }, hat: (x) => rechte.includes(x) });
  const antwort = {
    warnungen: [
      { typ: 'partie_viele', text: 'WHA Pitten: 6 von 7 Personen abwesend am 03.11.2026.' },
      { typ: 'plan_konflikt', benutzerId: 3, text: 'X ist eingeteilt, aber abwesend.' },
      { typ: 'eigen', text: 'Ihr Antrag wurde genehmigt.' },
      { typ: 'neu', text: '3 von 5 Personen abwesend' }
    ],
    konflikte: [{ typ: 'abwesenheit', benutzerId: 3, einsatzIds: [1], text: 'abwesend' }, { typ: 'abwesenheit', benutzerId: 1, einsatzIds: [1], text: 'eigene' }],
    benachrichtigungen: [{ typ: 'abwesenheit', titel: 'Urlaub genehmigt', text: 'Ihr Antrag …' }]
  };
  for (const r of ['polier', 'mitarbeiter']) {
    const o = DS.ohneFremdeAggregate(ctx(r), antwort);
    assert.deepEqual(o.warnungen.map((w) => w.typ), ['eigen'], r);
    assert.deepEqual(o.konflikte.map((k) => k.benutzerId), [1], r);
    assert.equal(o.benachrichtigungen.length, 1, r);
  }
  for (const [r, rechte] of [['buero', ['stammdaten']], ['bauleiter', ['stammdaten']], ['gf', ['stammdaten', 'lohn']]]) assert.deepEqual(DS.ohneFremdeAggregate(ctx(r, rechte), antwort), antwort, r);
});
