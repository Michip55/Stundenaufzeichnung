'use strict';
/** Abwesenheit als Zeitraum-Antrag (API.md 12.24) – feste Uhr Do 12.11.2026 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U } = require('./hilfe');

const VON = '2026-12-03', BIS = '2026-12-14'; // Do–Mo, Wochenenden und 8.12. (Feiertag) dazwischen
const ARBEITSTAGE = ['2026-12-03', '2026-12-04', '2026-12-07', '2026-12-09', '2026-12-10', '2026-12-11', '2026-12-14'];

test('Zeitraum-Anträge', async (t) => {
  const s = await starte({ sitzung: { feldMin: 60 * 24 * 30, bueroMin: 60 * 24 * 30, maxH: 24 * 60 } });
  t.after(() => s.stop());
  const c = {};
  for (const r of ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf']) c[r] = await s.login(U[r]);
  const zeilen = (id, von, bis) => s.db.alle('SELECT * FROM abwesenheit WHERE benutzer_id = ? AND datum >= ? AND datum <= ? ORDER BY datum', id, von, bis);
  const meldungen = (id) => s.db.alle("SELECT * FROM benachrichtigung WHERE benutzer_id = ? AND typ = 'abwesenheit' ORDER BY id", id);
  const kontoMa = async () => (await c.buero.get(`/urlaub/konto?jahr=2026&benutzerId=${U.mitarbeiter}`)).daten[0];
  const antrag = async (rolle, aid) => (await c[rolle].get('/abwesenheiten/antraege')).daten.find((a) => a.antragId === aid);
  let aid;

  await t.test('Rechte je Rolle und Grenzen', async () => {
    const r = (rolle, body) => c[rolle].post('/abwesenheiten/zeitraum', { vorschau: true, ...body });
    assert.equal((await r('mitarbeiter', { benutzerId: U.mitarbeiter, von: VON, bis: BIS, code: 'U' })).status, 200);
    assert.equal((await r('mitarbeiter', { benutzerId: U.mitarbeiter, von: VON, bis: BIS, code: 'K' })).status, 403);
    assert.equal((await r('mitarbeiter', { benutzerId: 3, von: VON, bis: BIS, code: 'U' })).status, 403);
    assert.equal((await r('polier', { benutzerId: 4, von: VON, bis: BIS, code: 'SW' })).status, 200); // Partie
    assert.equal((await r('polier', { benutzerId: 4, von: VON, bis: BIS, code: 'U' })).status, 403);
    assert.equal((await r('polier', { benutzerId: 9, von: VON, bis: BIS, code: 'SW' })).status, 403); // nicht seine Partie
    assert.equal((await r('bauleiter', { benutzerId: 4, von: VON, bis: BIS, code: 'U' })).status, 403);
    assert.equal((await r('buero', { benutzerId: 3, von: VON, bis: BIS, code: 'K' })).status, 200);
    assert.equal((await r('buero', { benutzerId: 3, von: VON, bis: '2027-02-03', code: 'U' })).status, 400); // > 62 Tage
    assert.equal((await r('buero', { benutzerId: 3, von: BIS, bis: VON, code: 'U' })).status, 400);
    assert.equal((await r('mitarbeiter', { benutzerId: U.mitarbeiter, von: '2026-11-04', bis: '2026-11-06', code: 'U' })).status, 400); // > 7 Tage zurück
    assert.equal((await c.mitarbeiter.post('/abwesenheiten/zeitraum', { benutzerId: U.mitarbeiter, von: '2026-12-05', bis: '2026-12-06', code: 'U' })).status, 400); // nur Wochenende
  });

  await t.test('Vorschau: nur Arbeitstage, Feiertag gemeldet, Konto restNachAntrag, nichts gespeichert', async () => {
    assert.equal((await c.buero.put(`/urlaub/konto/${U.mitarbeiter}/2026`, { art: 'urlg', anspruch: 25, uebertrag: 0 })).status, 200);
    const rest = (await kontoMa()).rest;
    const n0 = s.db.eins('SELECT COUNT(*) AS n FROM abwesenheit').n, m0 = s.db.eins('SELECT COUNT(*) AS n FROM benachrichtigung').n;
    const r = await c.mitarbeiter.post('/abwesenheiten/zeitraum', { benutzerId: U.mitarbeiter, von: VON, bis: BIS, code: 'U', vorschau: true });
    assert.equal(r.status, 200);
    assert.equal(r.daten.antragId, null);
    assert.deepEqual(r.daten.tage, ARBEITSTAGE);
    assert.equal(r.daten.arbeitstage, 7);
    assert.deepEqual(r.daten.uebersprungen, [{ datum: '2026-12-08', grund: 'Feiertag: Mariä Empfängnis' }]);
    assert.deepEqual(r.daten.konto, { rest, restNachAntrag: rest - 7 });
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM abwesenheit').n, n0);
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM benachrichtigung').n, m0);
    // Konto nur für U und nur mit Einsicht
    assert.equal((await c.polier.post('/abwesenheiten/zeitraum', { benutzerId: 4, von: VON, bis: BIS, code: 'SW', vorschau: true })).daten.konto, null);
  });

  await t.test('Anlegen: ein Antrag, genau eine Benachrichtigung je Büro/GF', async () => {
    const r = await c.mitarbeiter.post('/abwesenheiten/zeitraum', { benutzerId: U.mitarbeiter, von: VON, bis: BIS, code: 'U', notiz: 'Familienurlaub' });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    aid = r.daten.antragId;
    assert.match(aid, /^[a-z0-9]+$/);
    const z = zeilen(U.mitarbeiter, VON, BIS);
    assert.deepEqual(z.map((a) => a.datum), ARBEITSTAGE);
    assert.ok(z.every((a) => a.antrag_id === aid && a.status === 'beantragt' && a.code === 'U' && a.notiz === 'Familienurlaub'));
    const empf = s.db.alle("SELECT id FROM benutzer WHERE aktiv = 1 AND rolle IN ('buero','gf')").map((x) => x.id);
    for (const id of empf) {
      const m = s.db.alle('SELECT * FROM benachrichtigung WHERE benutzer_id = ? AND schluessel = ?', id, `abw:antrag:${aid}`);
      assert.equal(m.length, 1, `Empfänger ${id}`);
      assert.equal(m[0].titel, 'Urlaubsantrag: Lukas Brandstätter');
      assert.match(m[0].text, /^Urlaubsantrag Lukas Brandstätter: Do 03\.12\.–Mo 14\.12\. \(7 Arbeitstage\)/);
    }
    assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM benachrichtigung WHERE typ = 'abwesenheit' AND text LIKE '%Lukas Brandstätter%' AND benutzer_id = ?", U.buero).n, 1);
    // GET /abwesenheiten mit antragId; gruppiert in /antraege
    const l = (await c.mitarbeiter.get(`/abwesenheiten?benutzerId=${U.mitarbeiter}&von=${VON}&bis=${BIS}`)).daten;
    assert.ok(l.length === 7 && l.every((a) => a.antragId === aid));
    const g = await antrag('buero', aid);
    assert.deepEqual([g.von, g.bis, g.arbeitstage, g.status, g.code, g.notiz, g.name], [VON, BIS, 7, 'beantragt', 'U', 'Familienurlaub', 'Lukas Brandstätter']);
    assert.ok((await c.buero.get('/abwesenheiten/antraege?status=beantragt')).daten.some((a) => a.antragId === aid));
    assert.ok(!(await c.buero.get('/abwesenheiten/antraege?status=genehmigt')).daten.some((a) => a.antragId === aid));
    assert.equal((await c.buero.get('/abwesenheiten/antraege?status=teilweise')).status, 400);
  });

  await t.test('Atomar: ein ungültiger Tag → nichts gespeichert, keine Benachrichtigung', async () => {
    const n0 = s.db.eins('SELECT COUNT(*) AS n FROM abwesenheit').n, m0 = s.db.eins('SELECT COUNT(*) AS n FROM benachrichtigung').n;
    const r = await c.mitarbeiter.post('/abwesenheiten/zeitraum', { benutzerId: U.mitarbeiter, von: '2026-11-30', bis: '2026-12-04', code: 'ZA' });
    assert.equal(r.status, 409);
    assert.deepEqual(r.daten.tage, ['2026-12-03', '2026-12-04']);
    assert.equal(zeilen(U.mitarbeiter, '2026-11-30', '2026-12-02').length, 0);
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM abwesenheit').n, n0);
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM benachrichtigung').n, m0);
  });

  await t.test('Nur als Ganzes: Tages-PUT 409, Vier-Augen-Prinzip, Gruppen-Genehmigung mit einer Meldung', async () => {
    const tag = zeilen(U.mitarbeiter, VON, VON)[0];
    const r = await c.buero.put(`/abwesenheiten/${tag.id}`, { status: 'genehmigt' });
    assert.equal(r.status, 409);
    assert.match(r.daten.fehler, /ganzen Antrag/);
    assert.equal((await c.mitarbeiter.put(`/abwesenheiten/antraege/${aid}`, { status: 'genehmigt' })).status, 403);
    assert.equal((await c.polier.put(`/abwesenheiten/antraege/${aid}`, { status: 'genehmigt' })).status, 403);
    assert.equal((await c.bauleiter.put(`/abwesenheiten/antraege/${aid}`, { status: 'genehmigt' })).status, 403); // nur SW
    assert.equal((await c.buero.put('/abwesenheiten/antraege/xyz-!', { status: 'genehmigt' })).status, 400);
    assert.equal((await c.buero.put('/abwesenheiten/antraege/gibtsnicht', { status: 'genehmigt' })).status, 404);
    const vorher = meldungen(U.mitarbeiter).length;
    const kVor = await kontoMa();
    const g = await c.buero.put(`/abwesenheiten/antraege/${aid}`, { status: 'genehmigt', antwort: 'Schönen Urlaub' });
    assert.equal(g.status, 200, JSON.stringify(g.daten));
    assert.equal(g.daten.status, 'genehmigt');
    assert.ok(zeilen(U.mitarbeiter, VON, BIS).every((a) => a.status === 'genehmigt' && a.entschieden_von === U.buero && a.antwort === 'Schönen Urlaub'));
    const neu = meldungen(U.mitarbeiter).slice(vorher);
    assert.equal(neu.length, 1);
    assert.equal(neu[0].titel, 'Urlaub genehmigt');
    assert.match(neu[0].text, /Do 03\.12\.–Mo 14\.12\., 7 Arbeitstage\) wurde genehmigt\. Schönen Urlaub/);
    assert.equal((await c.buero.put(`/abwesenheiten/antraege/${aid}`, { status: 'abgelehnt' })).status, 409);
    const k = await kontoMa();
    assert.equal(k.beantragt, kVor.beantragt - 7);
    assert.equal(k.geplant, kVor.geplant + 7);
    // eigener Antrag des Büros: nur eine andere Person entscheidet
    const eigen = await c.buero.post('/abwesenheiten/zeitraum', { benutzerId: U.buero, von: '2026-12-21', bis: '2026-12-23', code: 'U' });
    assert.equal(eigen.status, 201);
    assert.equal(eigen.daten.status, 'beantragt');
    assert.equal((await c.buero.put(`/abwesenheiten/antraege/${eigen.daten.antragId}`, { status: 'genehmigt' })).status, 403);
    assert.equal((await c.gf.put(`/abwesenheiten/antraege/${eigen.daten.antragId}`, { status: 'genehmigt' })).status, 200);
  });

  await t.test('Ablehnen als Ganzes; abgelehnte Tage werden bei neuem Antrag ersetzt', async () => {
    const r = await c.mitarbeiter.post('/abwesenheiten/zeitraum', { benutzerId: U.mitarbeiter, von: '2026-11-24', bis: '2026-11-26', code: 'ZA' });
    assert.equal(r.status, 201);
    const x = await c.buero.put(`/abwesenheiten/antraege/${r.daten.antragId}`, { status: 'abgelehnt', antwort: 'Zu viele Leute weg' });
    assert.equal(x.daten.status, 'abgelehnt');
    assert.ok(zeilen(U.mitarbeiter, '2026-11-24', '2026-11-26').every((a) => a.status === 'abgelehnt'));
    const neu = await c.mitarbeiter.post('/abwesenheiten/zeitraum', { benutzerId: U.mitarbeiter, von: '2026-11-25', bis: '2026-11-26', code: 'U' });
    assert.equal(neu.status, 201);
    assert.deepEqual(neu.daten.tage, ['2026-11-25', '2026-11-26']);
    assert.ok(zeilen(U.mitarbeiter, '2026-11-25', '2026-11-26').every((a) => a.antrag_id === neu.daten.antragId && a.status === 'beantragt'));
    assert.equal((await antrag('buero', r.daten.antragId)).arbeitstage, 1); // 24.11. bleibt abgelehnt
    // Zurückziehen: eigen und offen ja, fremd nein, entschieden nein
    assert.equal((await c.polier.del(`/abwesenheiten/antraege/${neu.daten.antragId}`)).status, 403);
    const w = await c.mitarbeiter.del(`/abwesenheiten/antraege/${neu.daten.antragId}`);
    assert.deepEqual(w.daten, { ok: true, geloescht: 2 });
    assert.equal((await c.mitarbeiter.del(`/abwesenheiten/antraege/${aid}`)).status, 409);
    // es gibt nie „teilweise“
    const alle = (await c.buero.get('/abwesenheiten/antraege')).daten;
    assert.ok(alle.length > 0 && alle.every((a) => ['beantragt', 'genehmigt', 'abgelehnt'].includes(a.status)));
  });

  await t.test('Korrektur nach Genehmigung: Büro löscht einzelne Tage bzw. den Antrag, Konto zählt weniger, eine Meldung', async () => {
    const k0 = await kontoMa();
    const tag = zeilen(U.mitarbeiter, '2026-12-14', '2026-12-14')[0];
    assert.equal((await c.mitarbeiter.del(`/abwesenheiten/${tag.id}`)).status, 403); // genehmigt: nur Büro
    const vorher = meldungen(U.mitarbeiter).length;
    assert.equal((await c.buero.del(`/abwesenheiten/${tag.id}`)).status, 200);
    const k1 = await kontoMa();
    assert.equal(k1.geplant + k1.genommen, k0.geplant + k0.genommen - 1);
    assert.equal(k1.rest, k0.rest + 1);
    let neu = meldungen(U.mitarbeiter).slice(vorher);
    assert.equal(neu.length, 1);
    assert.match(neu[0].text, /Mo 14\.12\. wurde gelöscht \(Korrektur durch das Büro\)/);
    const g = await antrag('buero', aid);
    assert.deepEqual([g.status, g.arbeitstage, g.bis], ['genehmigt', 6, '2026-12-11']);
    // ganzer Antrag
    const v2 = meldungen(U.mitarbeiter).length;
    const d = await c.buero.del(`/abwesenheiten/antraege/${aid}`);
    assert.deepEqual(d.daten, { ok: true, geloescht: 6 });
    neu = meldungen(U.mitarbeiter).slice(v2);
    assert.equal(neu.length, 1);
    assert.match(neu[0].text, /Korrektur durch das Büro/);
    const k2 = await kontoMa();
    assert.equal(k2.geplant + k2.genommen, k0.geplant + k0.genommen - 7);
    assert.ok(s.db.alle("SELECT * FROM protokoll WHERE art = 'abwesenheit' AND text LIKE '%gelöscht (Korrektur)%'").length >= 1);
  });

  await t.test('Datenschutz Krank, Sichtbarkeit, Bauleiter entscheidet SW', async () => {
    const k = await c.buero.post('/abwesenheiten/zeitraum', { benutzerId: 3, von: '2026-11-16', bis: '2026-11-18', code: 'K' });
    assert.equal(k.status, 201);
    assert.equal(k.daten.status, 'genehmigt');
    assert.equal(k.daten.konto, null);
    assert.equal(s.db.alle('SELECT * FROM benachrichtigung WHERE schluessel = ?', `abw:antrag:${k.daten.antragId}`).length, 0); // genehmigt: keine Antragsmeldung
    assert.equal((await antrag('buero', k.daten.antragId)).code, 'K');
    const pol = await antrag('polier', k.daten.antragId);
    assert.equal(pol.code, 'abwesend');
    assert.equal(await antrag('mitarbeiter', k.daten.antragId), undefined);
    // SW durch den Polier für seine Partie → Bauleiter der Stamm-Baustelle entscheidet als Ganzes
    const sw = await c.polier.post('/abwesenheiten/zeitraum', { benutzerId: 4, von: '2026-11-12', bis: '2026-11-13', code: 'SW' });
    assert.equal(sw.status, 201, JSON.stringify(sw.daten));
    assert.equal(sw.daten.status, 'beantragt');
    const e = await c.bauleiter.put(`/abwesenheiten/antraege/${sw.daten.antragId}`, { status: 'genehmigt' });
    assert.equal(e.status, 200);
    assert.equal(e.daten.status, 'genehmigt');
  });

  await t.test('Einzel-POST bleibt; Warnungen je Antrag statt je Tag', async () => {
    const e = await c.mitarbeiter.post('/abwesenheiten', { benutzerId: U.mitarbeiter, datum: '2026-11-27', code: 'ZA' });
    assert.equal(e.status, 201);
    assert.match(e.daten.antragId, /^[a-z0-9]+$/);
    const lang = await c.mitarbeiter.post('/abwesenheiten/zeitraum', { benutzerId: U.mitarbeiter, von: '2026-12-15', bis: '2026-12-18', code: 'U' });
    assert.equal(lang.status, 201);
    // Einteilung im Planer an allen vier Tagen
    for (const d of ['2026-12-15', '2026-12-16', '2026-12-17', '2026-12-18']) {
      const x = s.db.lauf("INSERT INTO plan_einsatz (datum, baustelle_id, erstellt, erstellt_von, geaendert) VALUES (?, 1, '2026-11-12T08:00:00Z', 101, '2026-11-12T08:00:00Z')", d);
      s.db.lauf('INSERT INTO plan_person (einsatz_id, benutzer_id) VALUES (?, ?)', x.id, U.mitarbeiter);
    }
    s.uhr.setze('2026-11-17T08:00:00.000Z'); // Anträge > 3 Tage offen
    const w = (await c.buero.get('/urlaub/warnungen?von=2026-11-16&bis=2026-12-31')).daten;
    const offen = w.filter((x) => x.typ === 'antrag_offen' && x.antragId === lang.daten.antragId);
    assert.equal(offen.length, 1);
    assert.deepEqual([offen[0].datum, offen[0].bis], ['2026-12-15', '2026-12-18']);
    const plan = w.filter((x) => x.typ === 'plan_konflikt' && x.benutzerId === U.mitarbeiter && x.antragId === lang.daten.antragId);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].tage, 4);
    s.app.bt.stuendlich(); s.app.bt.stuendlich();
    assert.equal(s.db.alle("SELECT * FROM benachrichtigung WHERE benutzer_id = ? AND schluessel = ?", U.buero, `urlaub:antrag:${lang.daten.antragId}`).length, 1);
  });
});

test('Antrags-IDs: neue beginnen mit „a“; offene Anträge einmal je Antrag gemeldet, auch wenn die ID mit „e“ beginnt', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const ma = await s.login(U.mitarbeiter);
  const r = await ma.post('/abwesenheiten/zeitraum', { benutzerId: U.mitarbeiter, von: '2026-12-01', bis: '2026-12-02', code: 'U' });
  assert.match(r.daten.antragId, /^a[0-9a-f]{12}$/);
  // früher zufällige Hex-IDs konnten mit „e“ beginnen und wurden als Bestand „e<id>“ behandelt
  s.db.lauf("INSERT INTO abwesenheit (benutzer_id, datum, code, status, erfasst_von, erfasst, antrag_id) VALUES (3, '2026-12-03', 'U', 'beantragt', 3, '2026-11-01T08:00:00Z', 'e0f1a2b3c4d5'), (3, '2026-12-04', 'U', 'beantragt', 3, '2026-11-01T08:00:00Z', 'e0f1a2b3c4d5')");
  require('../../server/routes/urlaub').pruefeAntraege(s.app.bt);
  require('../../server/routes/urlaub').pruefeAntraege(s.app.bt);
  assert.equal(s.db.alle("SELECT * FROM benachrichtigung WHERE benutzer_id = ? AND schluessel = 'urlaub:antrag:e0f1a2b3c4d5'", U.buero).length, 1);
});
