'use strict';
/**
 * Nachprüfung Bereich „urlaub“ (API.md 14.3) – feste Uhr Do 12.11.2026.
 * Jeder Test gehört zu einem Befund (N-…) und scheitert ohne die Korrektur.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U } = require('./hilfe');

const ANDERER = 3; // Mitarbeiter der Partie Pitten (Testdaten)

async function umgebung(t) {
  const s = await starte();
  t.after(() => s.stop());
  const c = {};
  for (const r of ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf']) c[r] = await s.login(U[r]);
  c.anderer = await s.login(ANDERER);
  const zeilen = (id, von, bis) => s.db.alle('SELECT * FROM abwesenheit WHERE benutzer_id = ? AND datum >= ? AND datum <= ? ORDER BY datum', id, von, bis);
  const meldungen = (id) => s.db.alle("SELECT * FROM benachrichtigung WHERE benutzer_id = ? AND typ = 'abwesenheit' ORDER BY id", id);
  const abw = (id, datum, code, status = 'genehmigt') => s.db.lauf("INSERT INTO abwesenheit (benutzer_id, datum, code, status, erfasst_von, erfasst) VALUES (?, ?, ?, ?, 101, '2026-11-01T08:00:00Z') ON CONFLICT(benutzer_id, datum) DO UPDATE SET code = excluded.code, status = excluded.status", id, datum, code, status);
  return { s, c, zeilen, meldungen, abw };
}

test('N-012: Betriebsurlaub – der eigene Eintrag ist nur beantragt (Vier-Augen-Prinzip), auch für Bauleiter', async (t) => {
  const { c, zeilen } = await umgebung(t);
  // Büro trägt sich selbst Urlaub über den Betriebsurlaub ein
  const v = await c.buero.post('/urlaub/betriebsurlaub', { von: '2027-01-11', bis: '2027-01-22', benutzerIds: [U.buero], code: 'U', vorschau: true });
  assert.equal(v.status, 200);
  const ich = v.daten.personen.find((p) => p.benutzerId === U.buero);
  assert.equal(ich.status, 'beantragt');
  assert.match(ich.hinweis, /Vier-Augen-Prinzip/);
  const r = await c.buero.post('/urlaub/betriebsurlaub', { von: '2027-01-11', bis: '2027-01-22', benutzerIds: [U.buero], code: 'U', vorschau: false });
  assert.equal(r.status, 200);
  const z = zeilen(U.buero, '2027-01-11', '2027-01-22');
  assert.equal(z.length, 10);
  assert.ok(z.every((a) => a.status === 'beantragt' && a.entschieden_von == null), JSON.stringify(z[0]));
  const k = (await c.buero.get(`/urlaub/konto?jahr=2027&benutzerId=${U.buero}`)).daten[0];
  assert.deepEqual([k.geplant, k.beantragt], [0, 10]);
  // nur eine andere Person entscheidet – als Ganzes
  assert.equal((await c.buero.put(`/abwesenheiten/antraege/${z[0].antrag_id}`, { status: 'genehmigt' })).status, 403);
  assert.equal((await c.gf.put(`/abwesenheiten/antraege/${z[0].antrag_id}`, { status: 'genehmigt' })).status, 200);
  // alle:true mit Betriebsurlaub: der Bauleiter (= Büro) bekommt seinen eigenen Tag nur beantragt, alle anderen genehmigt
  const b = await c.bauleiter.post('/urlaub/betriebsurlaub', { von: '2027-02-01', bis: '2027-02-02', alle: true, code: 'BU', vorschau: false });
  assert.equal(b.status, 200);
  assert.ok(zeilen(U.bauleiter, '2027-02-01', '2027-02-02').every((a) => a.status === 'beantragt' && a.betriebsurlaub === 1));
  assert.equal(zeilen(U.bauleiter, '2027-02-01', '2027-02-02').length, 2);
  assert.ok(zeilen(U.mitarbeiter, '2027-02-01', '2027-02-02').every((a) => a.status === 'genehmigt' && a.entschieden_von === U.bauleiter));
});

test('N-034: ohne jahr gilt das laufende Urlaubsjahr (Beginn ≠ 01-01), auch für Warnung und Export', async (t) => {
  const { s, c, abw } = await umgebung(t);
  assert.equal((await c.buero.put('/einstellungen/urlaub', { urlaubsjahrBeginn: '04-01' })).status, 200);
  assert.equal((await c.buero.put(`/urlaub/konto/${U.mitarbeiter}/2026`, { art: 'urlg', anspruch: 1 })).status, 200);
  abw(U.mitarbeiter, '2026-12-14', 'U');
  abw(U.mitarbeiter, '2026-12-15', 'U');
  s.uhr.setze('2027-02-15T09:00:00.000Z');
  c.mitarbeiter = await s.login(U.mitarbeiter); c.buero = await s.login(U.buero); // Sitzungen nach dem Uhrsprung neu
  const ohne = (await c.mitarbeiter.get('/urlaub/konto')).daten[0];
  const mit = (await c.mitarbeiter.get('/urlaub/konto?jahr=2026')).daten[0];
  assert.equal(ohne.jahr, 2026);
  assert.deepEqual([ohne.genommen, ohne.rest], [mit.genommen, mit.rest]);
  assert.ok(ohne.genommen >= 2 && ohne.von <= '2027-02-15' && ohne.bis >= '2027-02-15', JSON.stringify(ohne));
  const w = (await c.buero.get('/urlaub/warnungen?von=2027-02-15&bis=2027-02-20')).daten;
  assert.ok(w.some((x) => x.typ === 'rest_negativ' && x.benutzerId === U.mitarbeiter), JSON.stringify(w.filter((x) => x.typ === 'rest_negativ')));
  const csv = await c.buero.get('/urlaub/export.csv');
  assert.match(csv.headers.get('content-disposition'), /Urlaub_2026\.csv/);
});

test('N-035: Beginn je Konto; eine geänderte Vorgabe verschiebt bestehende Jahre nicht rückwirkend', async (t) => {
  const { c, abw } = await umgebung(t);
  for (const d of ['2026-02-02', '2026-02-03', '2026-02-04', '2026-02-05', '2026-02-06']) abw(ANDERER, d, 'U');
  const vor = (await c.buero.get(`/urlaub/konto?jahr=2026&benutzerId=${ANDERER}`)).daten[0];
  assert.equal(vor.von, '2026-01-01');
  assert.equal((await c.buero.put(`/urlaub/konto/${U.mitarbeiter}/2027`, { art: 'urlg', anspruch: 25 })).status, 200); // bestehendes Konto 2027
  const e = await c.buero.put('/einstellungen/urlaub', { urlaubsjahrBeginn: '04-01' });
  assert.equal(e.status, 200);
  assert.equal(e.daten.urlaubsjahrBeginnAb, 2027);
  const nach = (await c.buero.get(`/urlaub/konto?jahr=2026&benutzerId=${ANDERER}`)).daten[0];
  assert.deepEqual([nach.genommen, nach.rest, nach.von], [vor.genommen, vor.rest, '2026-01-01']);
  assert.equal(nach.bis, '2027-03-31'); // Übergang: das neue Urlaubsjahr beginnt am 01.04.2027
  assert.equal((await c.buero.get(`/urlaub/konto?jahr=2027&benutzerId=${ANDERER}`)).daten[0].von, '2027-04-01'); // neues Konto: Vorgabe
  assert.equal((await c.buero.get(`/urlaub/konto?jahr=2027&benutzerId=${U.mitarbeiter}`)).daten[0].von, '2027-01-01'); // bestehendes Konto bleibt
  // je Person: eigener Beginn im Konto
  const p = await c.buero.put(`/urlaub/konto/${ANDERER}/2027`, { urlaubsjahrBeginn: '07-01' });
  assert.equal(p.status, 200);
  assert.deepEqual([p.daten.urlaubsjahrBeginn, p.daten.von], ['07-01', '2027-07-01']);
  assert.equal((await c.buero.get(`/urlaub/konto?jahr=2026&benutzerId=${ANDERER}`)).daten[0].bis, '2027-06-30');
  assert.equal((await c.buero.put(`/urlaub/konto/${ANDERER}/2027`, { urlaubsjahrBeginn: '02-29' })).status, 400);
});

test('N-075: urlaubsjahrBeginn nur als gültiger Tag', async (t) => {
  const { c } = await umgebung(t);
  for (const x of ['02-30', '02-29', '04-31', '13-01', '1-1']) assert.equal((await c.buero.put('/einstellungen/urlaub', { urlaubsjahrBeginn: x })).status, 400, x);
  assert.equal((await c.buero.get('/einstellungen/urlaub')).daten.urlaubsjahrBeginn, '01-01');
});

test('N-074: höchstens 62 Kalendertage auch bei Betriebsurlaub und Urlaubskalender', async (t) => {
  const { c } = await umgebung(t);
  assert.equal((await c.buero.post('/urlaub/betriebsurlaub', { von: '2027-01-04', bis: '2027-03-07', alle: true, vorschau: true })).status, 400); // 63 Tage
  assert.equal((await c.buero.post('/urlaub/betriebsurlaub', { von: '2027-01-04', bis: '2027-03-06', alle: true, vorschau: true })).status, 200); // 62 Tage
  assert.equal((await c.buero.get('/urlaub/kalender?von=2027-01-04&bis=2027-03-07')).status, 400);
  assert.equal((await c.buero.get('/urlaub/kalender?von=2027-01-04&bis=2027-03-06')).status, 200);
  assert.equal((await c.buero.post('/abwesenheiten/zeitraum', { benutzerId: ANDERER, von: '2027-01-04', bis: '2027-03-07', code: 'U', vorschau: true })).status, 400);
});

test('N-072: BUAK – restNachAntrag zählt erst ab dem Stichtag des Kontoauszugs', async (t) => {
  const { c } = await umgebung(t);
  assert.equal((await c.buero.put(`/urlaub/konto/${ANDERER}/2026`, { art: 'buak', buakStand: 20, buakDatum: '2026-11-10' })).status, 200);
  const r = await c.buero.post('/abwesenheiten/zeitraum', { benutzerId: ANDERER, von: '2026-11-02', bis: '2026-11-13', code: 'U', vorschau: true });
  assert.equal(r.status, 200);
  const abStichtag = r.daten.tage.filter((d) => d >= '2026-11-10').length;
  assert.ok(abStichtag < r.daten.tage.length);
  assert.equal(r.daten.konto.restNachAntrag, r.daten.konto.rest - abStichtag);
  // nach dem Anlegen stimmt die Vorschau mit dem Konto überein
  assert.equal((await c.buero.post('/abwesenheiten/zeitraum', { benutzerId: ANDERER, von: '2026-11-02', bis: '2026-11-13', code: 'U' })).status, 201);
  assert.equal((await c.buero.get(`/urlaub/konto?jahr=2026&benutzerId=${ANDERER}`)).daten[0].rest, r.daten.konto.restNachAntrag);
});

test('N-047, N-071(3), N-087: Tage eines offenen mehrtägigen Antrags nicht einzeln löschen oder überschreiben', async (t) => {
  const { c, zeilen, meldungen } = await umgebung(t);
  const a = await c.mitarbeiter.post('/abwesenheiten/zeitraum', { benutzerId: U.mitarbeiter, von: '2026-12-01', bis: '2026-12-03', code: 'U' });
  assert.equal(a.status, 201);
  const [t1, t2] = zeilen(U.mitarbeiter, '2026-12-01', '2026-12-03');
  const z1 = await c.mitarbeiter.del(`/abwesenheiten/${t1.id}`);
  assert.equal(z1.status, 409);
  assert.match(z1.daten.fehler, /ganzen Antrag zurückziehen/);
  const z2 = await c.buero.del(`/abwesenheiten/${t2.id}`);
  assert.equal(z2.status, 409);
  assert.match(z2.daten.fehler, /ganzen Antrag entscheiden/);
  const p = await c.buero.post('/abwesenheiten', { benutzerId: U.mitarbeiter, datum: '2026-12-02', code: 'U' });
  assert.equal(p.status, 409);
  assert.match(p.daten.fehler, /ganzen Antrag/);
  const z = zeilen(U.mitarbeiter, '2026-12-01', '2026-12-03');
  assert.ok(z.length === 3 && z.every((x) => x.status === 'beantragt' && x.antrag_id === a.daten.antragId));
  // der ganze Antrag lässt sich weiter zurückziehen
  assert.deepEqual((await c.mitarbeiter.del(`/abwesenheiten/antraege/${a.daten.antragId}`)).daten, { ok: true, geloescht: 3 });
  // eintägiger offener Antrag: einzeln zurückziehen bzw. durch das Büro als Ganzes ersetzen (die Person erfährt es)
  const e = await c.mitarbeiter.post('/abwesenheiten', { benutzerId: U.mitarbeiter, datum: '2026-12-09', code: 'U' });
  assert.equal(e.status, 201);
  const vorher = meldungen(U.mitarbeiter).length;
  const k = await c.buero.post('/abwesenheiten', { benutzerId: U.mitarbeiter, datum: '2026-12-09', code: 'K' });
  assert.equal(k.status, 200);
  const neu = meldungen(U.mitarbeiter).slice(vorher);
  assert.equal(neu.length, 1);
  assert.match(neu[0].text, /ersetzt/);
});

test('N-071(1): Zeitraum des Büros ersetzt offene Anträge nur als Ganzes, meldet es in der Vorschau und der Person', async (t) => {
  const { c, zeilen, meldungen } = await umgebung(t);
  const a = await c.mitarbeiter.post('/abwesenheiten/zeitraum', { benutzerId: U.mitarbeiter, von: '2027-02-01', bis: '2027-02-05', code: 'U' });
  assert.equal(a.status, 201);
  const teil = await c.buero.post('/abwesenheiten/zeitraum', { benutzerId: U.mitarbeiter, von: '2027-02-01', bis: '2027-02-03', code: 'U', vorschau: true });
  assert.equal(teil.status, 409);
  assert.match(teil.daten.fehler, /ganzen Antrag entscheiden/);
  assert.equal((await c.buero.post('/abwesenheiten/zeitraum', { benutzerId: U.mitarbeiter, von: '2027-02-01', bis: '2027-02-03', code: 'U' })).status, 409);
  assert.ok(zeilen(U.mitarbeiter, '2027-02-01', '2027-02-05').every((x) => x.status === 'beantragt' && x.antrag_id === a.daten.antragId));
  const v = await c.buero.post('/abwesenheiten/zeitraum', { benutzerId: U.mitarbeiter, von: '2027-02-01', bis: '2027-02-05', code: 'U', vorschau: true });
  assert.equal(v.status, 200);
  assert.deepEqual(v.daten.ersetzt.map((x) => x.antragId), Array(5).fill(a.daten.antragId));
  const vorher = meldungen(U.mitarbeiter).length;
  const g = await c.buero.post('/abwesenheiten/zeitraum', { benutzerId: U.mitarbeiter, von: '2027-02-01', bis: '2027-02-05', code: 'U' });
  assert.equal(g.status, 201);
  assert.ok(zeilen(U.mitarbeiter, '2027-02-01', '2027-02-05').every((x) => x.status === 'genehmigt' && x.antrag_id === g.daten.antragId));
  const neu = meldungen(U.mitarbeiter).slice(vorher);
  assert.equal(neu.length, 1);
  assert.match(neu[0].text, /Ihr Antrag \(Urlaub Mo 01\.02\.–Fr 05\.02\.\) wurde vom Büro durch einen neuen Eintrag ersetzt/);
});

test('N-071(2): Betriebsurlaub ersetzt offene Anträge nur als Ganzes und meldet es', async (t) => {
  const { c, zeilen, meldungen } = await umgebung(t);
  const lang = await c.mitarbeiter.post('/abwesenheiten/zeitraum', { benutzerId: U.mitarbeiter, von: '2027-02-15', bis: '2027-02-26', code: 'U' });
  const kurz = await c.mitarbeiter.post('/abwesenheiten/zeitraum', { benutzerId: U.mitarbeiter, von: '2027-03-01', bis: '2027-03-02', code: 'U' });
  assert.equal(lang.status, 201); assert.equal(kurz.status, 201);
  const v = await c.buero.post('/urlaub/betriebsurlaub', { von: '2027-02-22', bis: '2027-03-05', benutzerIds: [U.mitarbeiter], vorschau: true });
  const p = v.daten.personen[0];
  assert.ok(p.konflikte.some((k) => k.datum === '2027-02-22' && /bleibt/.test(k.text)), JSON.stringify(p.konflikte));
  assert.equal(p.neu, 5); // 01.–05.03.
  const vorher = meldungen(U.mitarbeiter).length;
  assert.equal((await c.buero.post('/urlaub/betriebsurlaub', { von: '2027-02-22', bis: '2027-03-05', benutzerIds: [U.mitarbeiter], vorschau: false })).status, 200);
  const l = zeilen(U.mitarbeiter, '2027-02-15', '2027-02-26');
  assert.ok(l.length === 10 && l.every((x) => x.status === 'beantragt' && x.antrag_id === lang.daten.antragId && !x.betriebsurlaub)); // bleibt ganz
  const bu = zeilen(U.mitarbeiter, '2027-03-01', '2027-03-05');
  assert.ok(bu.length === 5 && bu.every((x) => x.status === 'genehmigt' && x.betriebsurlaub === 1));
  const neu = meldungen(U.mitarbeiter).slice(vorher);
  assert.equal(neu.length, 1);
  assert.match(neu[0].text, /Ihr Antrag \(Urlaub Mo 01\.03\.–Di 02\.03\.\) wurde vom Büro durch einen neuen Eintrag ersetzt \(Betriebsurlaub/);
});

test('N-073, N-091: Tages-PUT entscheidet einen schon entschiedenen Antrag nicht erneut', async (t) => {
  const { s, c, meldungen } = await umgebung(t);
  const e = await c.mitarbeiter.post('/abwesenheiten', { benutzerId: U.mitarbeiter, datum: '2027-04-26', code: 'U' });
  assert.equal(e.status, 201);
  assert.equal((await c.buero.put(`/abwesenheiten/${e.daten.id}`, { status: 'genehmigt' })).status, 200);
  const vorher = meldungen(U.mitarbeiter).length;
  const r = await c.buero.put(`/abwesenheiten/${e.daten.id}`, { status: 'abgelehnt' });
  assert.equal(r.status, 409);
  assert.match(r.daten.fehler, /schon entschieden/);
  assert.equal(s.db.eins('SELECT status FROM abwesenheit WHERE id = ?', e.daten.id).status, 'genehmigt');
  assert.equal(meldungen(U.mitarbeiter).length, vorher);
  // Bestand ohne Antrags-ID (e<id>)
  const alt = s.db.lauf("INSERT INTO abwesenheit (benutzer_id, datum, code, status, erfasst_von, erfasst, entschieden_von, entschieden) VALUES (?, '2027-04-27', 'U', 'genehmigt', ?, '2026-11-01T08:00:00Z', 101, '2026-11-02T08:00:00Z')", U.mitarbeiter, U.mitarbeiter).id;
  assert.equal((await c.gf.put(`/abwesenheiten/${alt}`, { status: 'abgelehnt' })).status, 409);
});

test('N-069: eigene entschiedene Abwesenheiten löscht nur eine andere Person', async (t) => {
  const { c, zeilen, meldungen } = await umgebung(t);
  const a = await c.buero.post('/abwesenheiten/zeitraum', { benutzerId: U.buero, von: '2026-11-16', bis: '2026-11-20', code: 'U' });
  assert.equal(a.status, 201);
  assert.equal((await c.gf.put(`/abwesenheiten/antraege/${a.daten.antragId}`, { status: 'genehmigt' })).status, 200);
  const r = await c.buero.del(`/abwesenheiten/antraege/${a.daten.antragId}`);
  assert.equal(r.status, 403);
  assert.match(r.daten.fehler, /Vier-Augen-Prinzip/);
  const tag = zeilen(U.buero, '2026-11-16', '2026-11-16')[0];
  assert.equal((await c.buero.del(`/abwesenheiten/${tag.id}`)).status, 403);
  assert.equal((await c.buero.post(`/abwesenheiten/antraege/${a.daten.antragId}/korrektur`, { tage: [tag.id] })).status, 403);
  assert.equal(zeilen(U.buero, '2026-11-16', '2026-11-20').length, 5);
  // eine andere Person mit stammdaten/lohn darf es, und die Person erfährt es
  const vorher = meldungen(U.buero).length;
  assert.deepEqual((await c.gf.del(`/abwesenheiten/antraege/${a.daten.antragId}`)).daten, { ok: true, geloescht: 5 });
  assert.equal(meldungen(U.buero).length, vorher + 1);
});

test('N-070, N-093: Korrektur mehrerer Tage in einer Transaktion mit genau einer Benachrichtigung', async (t) => {
  const { c, zeilen, meldungen } = await umgebung(t);
  const a = await c.buero.post('/abwesenheiten/zeitraum', { benutzerId: U.mitarbeiter, von: '2026-11-23', bis: '2026-11-27', code: 'U' });
  assert.equal(a.status, 201);
  assert.equal(a.daten.status, 'genehmigt');
  const z = zeilen(U.mitarbeiter, '2026-11-23', '2026-11-27');
  const pfad = `/abwesenheiten/antraege/${a.daten.antragId}/korrektur`;
  assert.equal((await c.mitarbeiter.post(pfad, { tage: [z[4].id] })).status, 403);
  assert.equal((await c.polier.post(pfad, { tage: [z[4].id] })).status, 403);
  // ein fremder Tag in der Liste → nichts wird gelöscht
  const fremd = await c.buero.post('/abwesenheiten/zeitraum', { benutzerId: ANDERER, von: '2026-11-23', bis: '2026-11-23', code: 'U' });
  const fremdId = zeilen(ANDERER, '2026-11-23', '2026-11-23')[0].id;
  assert.equal(fremd.status, 201);
  assert.equal((await c.buero.post(pfad, { tage: [z[3].id, fremdId] })).status, 400);
  assert.equal((await c.buero.post(pfad, { tage: [] })).status, 400);
  assert.equal(zeilen(U.mitarbeiter, '2026-11-23', '2026-11-27').length, 5);
  const vorher = meldungen(U.mitarbeiter).length;
  const r = await c.buero.post(pfad, { tage: [z[3].id, z[4].id] });
  assert.equal(r.status, 200, JSON.stringify(r.daten));
  assert.equal(r.daten.geloescht, 2);
  assert.deepEqual([r.daten.antrag.arbeitstage, r.daten.antrag.status], [3, 'genehmigt']);
  assert.equal(zeilen(U.mitarbeiter, '2026-11-23', '2026-11-27').length, 3);
  const neu = meldungen(U.mitarbeiter).slice(vorher);
  assert.equal(neu.length, 1);
  assert.match(neu[0].text, /Do 26\.11\., Fr 27\.11\. wurde gelöscht \(Korrektur durch das Büro, 2 Arbeitstage\)/);
  // offener Antrag: keine Tages-Korrektur (nur als Ganzes entscheiden)
  const offen = await c.mitarbeiter.post('/abwesenheiten/zeitraum', { benutzerId: U.mitarbeiter, von: '2026-12-01', bis: '2026-12-02', code: 'U' });
  const o = zeilen(U.mitarbeiter, '2026-12-01', '2026-12-01')[0];
  assert.equal((await c.buero.post(`/abwesenheiten/antraege/${offen.daten.antragId}/korrektur`, { tage: [o.id] })).status, 409);
});

test('N-076: Zeitraum-Transaktion überschreibt keinen inzwischen genehmigten Tag', async (t) => {
  const { s, c, zeilen } = await umgebung(t);
  const za = await c.mitarbeiter.post('/abwesenheiten/zeitraum', { benutzerId: U.mitarbeiter, von: '2026-12-21', bis: '2026-12-21', code: 'ZA' });
  assert.equal((await c.buero.put(`/abwesenheiten/antraege/${za.daten.antragId}`, { status: 'abgelehnt' })).status, 200);
  // zweiter Prozess: zwischen Vorprüfung und Speichern wird der abgelehnte Tag genehmigt (nachgestellt mit einem Trigger)
  s.db.db.exec(`CREATE TEMP TRIGGER wettlauf BEFORE INSERT ON abwesenheit WHEN NEW.datum = '2026-12-21' AND NEW.benutzer_id = ${U.mitarbeiter}
    BEGIN UPDATE abwesenheit SET status = 'genehmigt', code = 'K', antrag_id = 'afremd' WHERE benutzer_id = NEW.benutzer_id AND datum = NEW.datum; END`);
  t.after(() => { try { s.db.db.exec('DROP TRIGGER IF EXISTS wettlauf'); } catch (_) { /* Server schon beendet */ } });
  const r = await c.mitarbeiter.post('/abwesenheiten/zeitraum', { benutzerId: U.mitarbeiter, von: '2026-12-21', bis: '2026-12-22', code: 'U' });
  assert.equal(r.status, 409, JSON.stringify(r.daten));
  s.db.db.exec('DROP TRIGGER wettlauf');
  const z = zeilen(U.mitarbeiter, '2026-12-21', '2026-12-22');
  assert.equal(z.length, 1); // nichts gespeichert (atomar)
  assert.deepEqual([z[0].status, z[0].antrag_id], ['abgelehnt', za.daten.antragId]);
});
