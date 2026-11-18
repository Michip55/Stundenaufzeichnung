'use strict';
/**
 * API.md 15.4 – Rechte statt Rollenname: Regressionstests je Befund (F-008, F-012, F-016, F-017, F-019, F-020, F-021, F-035).
 *
 * Muster jedes Tests: Die GF entzieht über die offizielle API (PUT /rechte/matrix) ein Recht für Büro UND Bauleiter.
 * Danach müssen Büro 101 und Bauleiter 103 – auch auf Baustellen, deren `bauleiterId` 103 ist (BS 1, 2, 5, 7) –
 * identische Antworten erhalten, und die Datenbank bleibt bei Ablehnung unverändert. Nach dem Wiedererteilen wirkt
 * das Recht sofort wieder, für beide gleich.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');

const DIAGNOSE = 'DIAGNOSE-KANARIE-15-4';

async function aufbau(t) {
  const s = await starte();
  t.after(() => s.stop());
  const c = {};
  for (const r of ['gf', 'buero', 'bauleiter', 'polier', 'mitarbeiter']) c[r] = await s.login(U[r]);
  const matrix = async (rechte, wert) => {
    for (const rolle of ['buero', 'bauleiter']) for (const recht of rechte) {
      const r = await c.gf.put('/rechte/matrix', { rolle, recht, wert });
      assert.equal(r.status, 200, `Matrix ${rolle}.${recht}=${wert}: ${r.status} ${JSON.stringify(r.daten)}`);
    }
    const ich = { buero: (await c.buero.get('/auth/ich')).daten.rechte.slice().sort(), bauleiter: (await c.bauleiter.get('/auth/ich')).daten.rechte.slice().sort() };
    assert.deepEqual(ich.bauleiter, ich.buero, 'Matrixzeilen Büro und Bauleiter sind nicht gleich – Testvoraussetzung');
    for (const recht of rechte) assert.equal(ich.bauleiter.includes(recht), wert, `${recht} wirkt nicht sofort`);
  };
  /** Gleiche Anfrage als Büro und als Bauleiter → beide Antworten (Status, Daten) */
  const beide = async (methode, pfad, body) => {
    const b = await c.buero.anfrage(methode, pfad, body);
    const bl = await c.bauleiter.anfrage(methode, pfad, body);
    return { b, bl };
  };
  const gleich = async (methode, pfad, body, status) => {
    const { b, bl } = await beide(methode, pfad, body);
    assert.equal(bl.status, b.status, `${methode} ${pfad}: Bauleiter ${bl.status} ${JSON.stringify(bl.daten).slice(0, 200)} ≠ Büro ${b.status} ${JSON.stringify(b.daten).slice(0, 200)}`);
    if (status !== undefined) assert.equal(b.status, status, `${methode} ${pfad}: ${b.status} statt ${status} ${JSON.stringify(b.daten).slice(0, 200)}`);
    return { b, bl };
  };
  return { s, c, matrix, beide, gleich };
}

test('F-008/F-016/F-020: ohne stammdaten/lohn sieht der Bauleiter Abwesenheiten wie das Büro – keine Gründe, keine Diagnose, keine Aggregate', async (t) => {
  const { s, c, matrix, gleich } = await aufbau(t);
  const k = await c.gf.post('/abwesenheiten/zeitraum', { benutzerId: 3, von: '2026-11-16', bis: '2026-11-17', code: 'K', notiz: DIAGNOSE });
  assert.equal(k.status, 201, JSON.stringify(k.daten));
  await matrix(['stammdaten', 'lohn'], false);

  for (const p of ['/abwesenheiten?benutzerId=3', '/abwesenheiten?von=2026-11-10&bis=2026-11-20', '/abwesenheiten/antraege?benutzerId=3']) {
    const { b, bl } = await gleich('GET', p, undefined, 200);
    assert.ok(!JSON.stringify(bl.daten).includes(DIAGNOSE), `${p}: Bauleiter sieht die Diagnose`);
    assert.ok(!bl.daten.some((a) => a.benutzerId === 3), `${p}: Bauleiter sieht Abwesenheiten anderer`);
    assert.deepEqual(bl.daten.map((a) => a.benutzerId === U.bauleiter), b.daten.map((a) => a.benutzerId === U.buero), `${p}: unterschiedlicher Umfang`);
  }
  await gleich('GET', '/urlaub/warnungen', undefined, 403);
  const kal = await gleich('GET', '/urlaub/kalender?von=2026-11-16&bis=2026-11-20', undefined, 200);
  assert.equal(kal.bl.daten.personen.length, kal.b.daten.personen.length, 'Urlaubskalender: Bauleiter sieht mehr Personen als das Büro');
  assert.ok(!JSON.stringify(kal.bl.daten).includes('"K"'), 'Urlaubskalender: Bauleiter sieht Krankenstand');
  // Planer ohne stammdaten: für beide gesperrt (vorher Bauleiter mit Gründen „Krank“, Büro „abwesend“)
  await gleich('GET', '/plan/woche?von=2026-11-16', undefined, 403);
  await gleich('GET', '/plan/tag.pdf?datum=2026-11-17', undefined, 403);

  // Wiedererteilen wirkt sofort und gleich: beide sehen K mit Notiz
  await matrix(['stammdaten', 'lohn'], true);
  const { b, bl } = await gleich('GET', '/abwesenheiten?benutzerId=3', undefined, 200);
  assert.ok(JSON.stringify(b.daten).includes(DIAGNOSE) && JSON.stringify(bl.daten).includes(DIAGNOSE), 'mit stammdaten/lohn sehen Büro und Bauleiter die Notiz');
  assert.deepEqual(bl.daten, b.daten);
  const w = await gleich('GET', '/plan/woche?von=2026-11-16', undefined, 200);
  assert.deepEqual(w.bl.daten.konflikte, w.b.daten.konflikte, 'Wochenplan-Konflikte unterschiedlich');
  assert.deepEqual(w.bl.daten.frei, w.b.daten.frei, 'Wochenplan „frei“ unterschiedlich');
  assert.ok(s.db.eins("SELECT 1 AS x FROM abwesenheit WHERE benutzer_id = 3 AND code = 'K'"));
});

test('F-012 (A)/F-016/F-019: Leistungsmeldung und Mengen allein mit preise_bearbeiten – auch nicht als Bauleiter der Baustelle', async (t) => {
  const { s, c, matrix, gleich } = await aufbau(t);
  assert.equal(s.db.eins('SELECT bauleiter_id FROM baustelle WHERE id = ?', BS.pitten).bauleiter_id, U.bauleiter);
  const lm = await c.gf.post(`/baustellen/${BS.pitten}/leistungen`, { leistungId: 1, menge: 2, datum: '2026-11-11' });
  assert.equal(lm.status, 201);
  const pos = (await c.gf.get(`/baustellen/${BS.pitten}/positionen`)).daten.gruppen.flatMap((g) => g.positionen)[0];
  await matrix(['preise_bearbeiten'], false);
  const zahl = () => [s.db.eins('SELECT COUNT(*) AS n FROM leistungsmeldung').n, s.db.eins('SELECT COUNT(*) AS n FROM projektposition_menge').n];
  const vorher = zahl();
  await gleich('POST', `/baustellen/${BS.pitten}/leistungen`, { leistungId: 1, menge: 5, datum: '2026-11-11' }, 403);
  await gleich('POST', `/baustellen/${BS.pitten}/positionen/${pos.id}/mengen`, { datum: '2026-11-11', menge: 3, notiz: 'BL' }, 403);
  await gleich('DELETE', `/baustellen/${BS.pitten}/leistungen/${lm.daten.id}`, undefined, 403);
  await gleich('PUT', `/baustellen/${BS.pitten}/auftrag`, { auftragssumme: 1 }, 403);
  assert.deepEqual(zahl(), vorher, 'Datenbank trotz Ablehnung geändert');

  await matrix(['preise_bearbeiten'], true);
  await gleich('POST', `/baustellen/${BS.pitten}/leistungen`, { leistungId: 1, menge: 5, datum: '2026-11-11' }, 201);
  await gleich('POST', `/baustellen/${BS.pitten}/positionen/${pos.id}/mengen`, { datum: '2026-11-11', menge: 3, notiz: 'x' }, 201);
});

test('F-012 (B): Schlechtwetter entscheidet allein, wer stammdaten/lohn hat – auch nicht der Bauleiter der Stamm-Baustelle', async (t) => {
  const { s, c, matrix, gleich } = await aufbau(t);
  const sw = await c.polier.post('/abwesenheiten', { benutzerId: 4, datum: '2026-11-12', code: 'SW' });
  assert.equal(sw.status, 201, JSON.stringify(sw.daten));
  const tag = s.db.eins("SELECT id, antrag_id FROM abwesenheit WHERE benutzer_id = 4 AND datum = '2026-11-12' AND code = 'SW'");
  assert.equal(s.db.eins('SELECT bauleiter_id FROM baustelle WHERE id = 1').bauleiter_id, U.bauleiter); // Stamm-Baustelle von MA 4
  await matrix(['stammdaten', 'lohn'], false);
  await gleich('PUT', `/abwesenheiten/antraege/${tag.antrag_id}`, { status: 'genehmigt' }, 403);
  await gleich('PUT', `/abwesenheiten/${tag.id}`, { status: 'genehmigt' }, 403);
  // vorher: Bauleiter 404 (Vorprüfung am Rollennamen), Büro 403
  await gleich('PUT', '/abwesenheiten/antraege/anichtvorhanden0', { status: 'genehmigt' }, 403);
  await gleich('PUT', '/abwesenheiten/999999', { status: 'genehmigt' }, 403);
  await gleich('POST', `/abwesenheiten/sw-meldungen/${sw.daten.meldungId}/bestaetigen`, {}, 403);
  const a = s.db.eins('SELECT status, entschieden_von FROM abwesenheit WHERE id = ?', tag.id);
  assert.equal(a.status, 'beantragt'); assert.equal(a.entschieden_von, null);

  await matrix(['stammdaten', 'lohn'], true);
  const r = await c.bauleiter.put(`/abwesenheiten/antraege/${tag.antrag_id}`, { status: 'genehmigt' });
  assert.equal(r.status, 200, JSON.stringify(r.daten));
});

test('F-035: GET /abwesenheiten/sw-meldungen ohne stammdaten/lohn → 403 für Büro und Bauleiter (kein 500)', async (t) => {
  const { c, matrix, gleich } = await aufbau(t);
  assert.equal((await c.polier.post('/abwesenheiten', { benutzerId: 4, datum: '2026-11-12', code: 'SW' })).status, 201);
  await matrix(['stammdaten', 'lohn'], false);
  await gleich('GET', '/abwesenheiten/sw-meldungen', undefined, 403);
  assert.equal((await c.polier.get('/abwesenheiten/sw-meldungen')).status, 200); // Polier: eigene Meldungen (unverändert)
  assert.equal((await c.mitarbeiter.get('/abwesenheiten/sw-meldungen')).status, 403);
  await matrix(['lohn'], true);
  const { b, bl } = await gleich('GET', '/abwesenheiten/sw-meldungen', undefined, 200);
  assert.deepEqual(bl.daten, b.daten);
});

test('F-017/F-019/F-021: ohne stammdaten planen weder Büro noch Bauleiter – keine Teilsicht „eigene Baustellen“ über bauleiterId', async (t) => {
  const { s, c, matrix, gleich } = await aufbau(t);
  await matrix(['stammdaten'], false);
  const zahl = () => s.db.eins('SELECT COUNT(*) AS n FROM plan_einsatz').n;
  const vorher = zahl();
  for (const bs of [BS.pitten, BS.gloggnitz]) await gleich('POST', '/plan/einsaetze', { datum: '2026-11-19', baustelleId: bs }, 403); // BS 1: bauleiterId 103
  assert.equal(zahl(), vorher);
  for (const p of ['/plan/woche?von=2026-11-16', '/plan/fuhren?von=2026-11-16', '/einstellungen/plan', '/plan/zeitplan', '/baustellen-kennzahlen', '/plan/partie', `/baustellen/${BS.pitten}/dokumente`, '/plan/anfragen']) {
    const { b, bl } = await gleich('GET', p);
    assert.deepEqual(bl.status === 200 ? bl.daten : null, b.status === 200 ? b.daten : null, `${p}: unterschiedliche Daten`);
    if (p !== '/plan/anfragen') assert.equal(b.status, 403, `${p}: ohne stammdaten erlaubt`);
  }
  await gleich('PUT', '/einstellungen/plan', { planFortschreiben: true }, 403);
  await gleich('POST', `/baustellen/${BS.pitten}/phase`, { phase: 'pausiert' }, 403);
  await gleich('POST', '/plan/veroeffentlichen', { von: '2026-11-13' }, 403);

  await matrix(['stammdaten'], true);
  for (const p of ['/plan/woche?von=2026-11-16', '/plan/fuhren?von=2026-11-16', '/plan/zeitplan', '/baustellen-kennzahlen']) {
    const { b, bl } = await gleich('GET', p, undefined, 200);
    assert.deepEqual(bl.daten, b.daten, `${p}: Bauleiter und Büro sehen verschiedenen Umfang`);
  }
  // schreiben: je eigener Tag (sonst 409 für den Zweiten)
  assert.equal((await c.buero.post('/plan/einsaetze', { datum: '2026-11-25', baustelleId: BS.gloggnitz })).status, 201);
  assert.equal((await c.bauleiter.post('/plan/einsaetze', { datum: '2026-11-25', baustelleId: BS.kogler })).status, 201);
});

test('F-016: Schäden bearbeiten allein mit fuhrpark, alle Schäden sehen mit fuhrpark|stammdaten – Büro und Bauleiter gleich', async (t) => {
  const { s, c, matrix, gleich } = await aufbau(t);
  const sch = await c.mitarbeiter.post('/fuhrpark/schaeden', { anlageId: 4, baustelleId: BS.pitten, art: 'defekt', ursache: 'Hydraulikschlauch geplatzt am Bagger', einsatzfaehig: 'ja' });
  assert.equal(sch.status, 201, JSON.stringify(sch.daten));
  await matrix(['fuhrpark', 'stammdaten'], false);
  const l = await gleich('GET', '/fuhrpark/schaeden', undefined, 200);
  assert.deepEqual(l.bl.daten, l.b.daten, 'Schadenliste ohne fuhrpark/stammdaten verschieden');
  assert.ok(!l.bl.daten.some((x) => x.id === sch.daten.id), 'ohne fuhrpark/stammdaten fremder Schaden sichtbar');
  await gleich('PUT', `/fuhrpark/schaeden/${sch.daten.id}`, { version: sch.daten.version, status: 'in_bearbeitung' }, 403);
  assert.equal(s.db.eins('SELECT status FROM mangel WHERE id = ?', sch.daten.id).status, 'offen');

  await matrix(['stammdaten'], true); // sehen ja, bearbeiten nein
  const l2 = await gleich('GET', '/fuhrpark/schaeden', undefined, 200);
  assert.ok(l2.bl.daten.some((x) => x.id === sch.daten.id) && l2.b.daten.some((x) => x.id === sch.daten.id));
  assert.deepEqual(l2.bl.daten, l2.b.daten);
  await gleich('PUT', `/fuhrpark/schaeden/${sch.daten.id}`, { version: sch.daten.version, status: 'in_bearbeitung' }, 403);
  await matrix(['fuhrpark'], true);
  const r = await c.bauleiter.put(`/fuhrpark/schaeden/${sch.daten.id}`, { version: sch.daten.version, status: 'in_bearbeitung' });
  assert.equal(r.status, 200, JSON.stringify(r.daten));
});

test('F-016/F-021: Projektdokumente und Zuordnung allein über stammdaten', async (t) => {
  const { c, matrix, gleich } = await aufbau(t);
  await matrix(['stammdaten'], false);
  await gleich('GET', `/baustellen/${BS.pitten}/dokumente`, undefined, 403);
  await gleich('GET', `/baustellen/${BS.reisinger}/dokumente`, undefined, 403);
  await gleich('PUT', `/baustellen/${BS.pitten}`, { bauleiterId: U.bauleiter }, 403);
  await matrix(['stammdaten'], true);
  const { b, bl } = await gleich('GET', `/baustellen/${BS.pitten}/dokumente`, undefined, 200);
  assert.deepEqual(bl.daten, b.daten);
  assert.equal((await c.polier.get(`/baustellen/${BS.pitten}/dokumente`)).status, 200); // Polier der Baustelle unverändert
});
