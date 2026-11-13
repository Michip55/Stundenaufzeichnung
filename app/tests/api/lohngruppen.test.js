'use strict';
/** Lohngruppe stichtaggenau (API.md 12.22) – feste Uhr Do 12.11.2026 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');
const B = require('../../server/budget');

const DANIEL = 3; // Facharbeiter auf WHA Pitten, Berichte 22.10.–11.11.2026
const WECHSEL = '2026-11-04';
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

test('Lohngruppe stichtaggenau', async (t) => {
  const s = await starte({ euroSicherheitsnetz: false, sitzung: { feldMin: 60 * 24 * 30, bueroMin: 60 * 24 * 30, maxH: 24 * 60 } });
  t.after(() => s.stop());
  const c = {};
  for (const r of ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf']) c[r] = await s.login(U[r]);
  const stunden = (bed, ...p) => r2(s.db.eins(`SELECT SUM(bp.stunden) AS m FROM bericht_personal bp JOIN bericht r ON r.id = bp.bericht_id
    WHERE r.baustelle_id = ? AND r.status <> 'entwurf' AND bp.benutzer_id = ? AND ${bed}`, BS.pitten, DANIEL, ...p).m || 0);
  const vorher = stunden('r.datum < ?', WECHSEL), nachher = stunden('r.datum >= ?', WECHSEL);
  const lohn = (k, lg) => k.positionen.lohn.filter((x) => x.lohngruppeId === lg).reduce((a, x) => a + x.stunden, 0);
  const pos = (d, b) => d.gruppen.flatMap((g) => g.positionen).find((p) => p.bezeichnung === b);
  let k0, p0, maPos;

  await t.test('Ausgangslage: Basisstand ab 2000-01-01, Verlauf vertraulich', async () => {
    assert.ok(vorher > 0 && nachher > 0);
    const v = await c.buero.get(`/benutzer/${DANIEL}/lohngruppen-verlauf`);
    assert.equal(v.status, 200);
    assert.deepEqual(v.daten.map((x) => [x.id, x.lohngruppeId, x.gueltigAb, x.aktuell, x.kuenftig]), [[null, 'fa', '2000-01-01', true, false]]);
    assert.equal(v.daten[0].name, 'Facharbeiter');
    for (const r of ['mitarbeiter', 'polier']) {
      const x = await c[r].get(`/benutzer/${DANIEL}/lohngruppen-verlauf`);
      assert.equal(x.status, 403, r);
      assert.ok(!JSON.stringify(x.daten).includes('Facharbeiter'));
    }
    assert.equal((await c.gf.get(`/benutzer/${DANIEL}/lohngruppen-verlauf`)).status, 200);
    k0 = (await c.buero.get(`/kalkulation/${BS.pitten}`)).daten;
    maPos = (await c.buero.post(`/baustellen/${BS.pitten}/positionen`, { gruppe: 'arbeit', bezeichnung: 'Maschinist (Test)', einheit: 'Std.', ep: 60, quelle: { art: 'personal', ref: ['ma'] } })).daten;
    p0 = (await c.buero.get(`/baustellen/${BS.pitten}/positionen`)).daten;
  });

  await t.test('Schreiben: Rechte, rückwirkend nur bestätigt (422), Eingabeprüfung', async () => {
    assert.equal((await c.polier.put(`/benutzer/${DANIEL}`, { lohngruppe: 'ma' })).status, 403);
    assert.equal((await c.mitarbeiter.put(`/benutzer/${DANIEL}`, { lohngruppe: 'ma' })).status, 403);
    let r = await c.buero.put(`/benutzer/${DANIEL}`, { lohngruppe: 'ma', lohngruppeGueltigAb: WECHSEL });
    assert.equal(r.status, 422);
    assert.match(r.daten.fehler, /rückwirkend/);
    assert.equal((await c.buero.put(`/benutzer/${DANIEL}`, { lohngruppeGueltigAb: WECHSEL })).status, 400);
    assert.equal((await c.buero.put(`/benutzer/${DANIEL}`, { lohngruppe: 'ma', lohngruppeGueltigAb: '1999-12-31', lohngruppeRueckwirkend: true })).status, 400);
    assert.equal((await c.buero.put(`/benutzer/${DANIEL}`, { lohngruppe: 'gibtsnicht', lohngruppeGueltigAb: WECHSEL, lohngruppeRueckwirkend: true })).status, 400);
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM benutzer_lohngruppe WHERE benutzer_id = ?', DANIEL).n, 0); // nichts geschrieben
    // gültig: rückwirkend mit Bestätigung → Budget-Prüfung der betroffenen Baustellen
    const geprueft = [];
    const orig = B.pruefeBudget;
    B.pruefeBudget = (bt, id, o) => { geprueft.push([id, o.anlass]); return orig(bt, id, o); };
    try {
      r = await c.buero.put(`/benutzer/${DANIEL}`, { lohngruppe: 'ma', lohngruppeGueltigAb: WECHSEL, lohngruppeRueckwirkend: true });
    } finally { B.pruefeBudget = orig; }
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    assert.equal(r.daten.lohngruppe, 'ma');
    assert.deepEqual(r.daten.lohngruppeVerlauf.map((x) => [x.lohngruppeId, x.gueltigAb, x.aktuell]), [['fa', '2000-01-01', false], ['ma', WECHSEL, true]]);
    assert.ok(r.daten.lohngruppeVerlauf.every((x) => Number.isInteger(x.id)));
    assert.ok(geprueft.some(([id, a]) => id === BS.pitten && a === 'Lohngruppe geändert'), JSON.stringify(geprueft));
    const p = s.db.alle("SELECT * FROM protokoll WHERE objekt = ? AND text LIKE 'Lohngruppe%'", `benutzer:${DANIEL}`);
    assert.equal(p.length, 1);
    assert.match(p[0].text, /fa → ma ab 04\.11\.2026 \(rückwirkend\)/);
  });

  await t.test('Interne Kosten: Wechsel im Monat teilt nach Tagen; frühere Tage unverändert', async () => {
    const k1 = (await c.buero.get(`/kalkulation/${BS.pitten}`)).daten;
    assert.equal(r2(lohn(k1, 'fa')), r2(lohn(k0, 'fa') - nachher)); // nur die Stunden ab dem Wechsel wandern
    assert.equal(r2(lohn(k1, 'ma')), r2(lohn(k0, 'ma') + nachher));
    const satz = (lg) => s.db.eins('SELECT kostensatz FROM lohngruppe WHERE id = ?', lg).kostensatz;
    assert.equal(r2(k1.interneKosten.kosten.lohn - k0.interneKosten.kosten.lohn), r2(nachher * (satz('ma') - satz('fa'))));
    // Kosten je Bericht: vor dem Wechsel fa, danach ma
    const vor = s.db.eins("SELECT r.id FROM bericht r JOIN bericht_personal bp ON bp.bericht_id = r.id WHERE r.baustelle_id = ? AND bp.benutzer_id = ? AND r.datum = '2026-11-03'", BS.pitten, DANIEL);
    const kt = require('../../server/daten').kostenTagFuer;
    const lgAm = (d) => require('../../server/lohngruppen').lohngruppeAm(s.db, DANIEL, d);
    assert.equal(lgAm('2026-11-03'), 'fa');
    assert.equal(lgAm(WECHSEL), 'ma');
    assert.equal(lgAm('2026-10-22'), 'fa');
    assert.ok(kt(s.db, vor.id).lohn > 0);
  });

  await t.test('Positions-Nachkalkulation: Stunden ab dem Wechseltag an die andere Position', async () => {
    const p1 = (await c.buero.get(`/baustellen/${BS.pitten}/positionen`)).daten;
    assert.equal(r2(pos(p1, 'Facharbeiter').mengeAuto), r2(pos(p0, 'Facharbeiter').mengeAuto - nachher));
    assert.equal(r2(pos(p1, 'Maschinist (Test)').mengeAuto), r2(pos(p0, 'Maschinist (Test)').mengeAuto + nachher));
    assert.ok(maPos.id);
  });

  await t.test('Monat und Lohn-CSV: Tageszeilen mit der Lohngruppe des Tages, Hinweis-Zeile', async () => {
    const m = (await c.buero.get('/monat?monat=2026-11')).daten.mitarbeiter.find((x) => x.id === DANIEL);
    assert.equal(m.lohngruppe, 'ma');
    assert.equal(m.lohngruppen.length, 2);
    assert.deepEqual(m.lohngruppen.map((a) => [a.lohngruppe, a.von, a.bis]), [['fa', '2026-11-01', '2026-11-03'], ['ma', WECHSEL, '2026-11-30']]);
    assert.equal(r2(m.lohngruppen[0].stunden + m.lohngruppen[1].stunden), m.summe);
    assert.equal(m.tage['2026-11-03'].lohngruppe, 'fa');
    assert.ok(!('lohngruppe' in m.tage['2026-11-05']));
    const okt = (await c.buero.get('/monat?monat=2026-10')).daten.mitarbeiter.find((x) => x.id === DANIEL);
    assert.equal(okt.lohngruppe, 'fa'); // Vergangenheit unverändert
    assert.ok(!('lohngruppen' in okt));
    const csv = String((await c.buero.get('/monat/export.csv?monat=2026-11')).daten);
    const zeilen = csv.split('\r\n').filter((z) => z.includes('Daniel Schwarz'));
    assert.ok(zeilen.some((z) => z.includes(';fa;03.11.2026;')), 'Tageszeile 03.11. mit fa');
    assert.ok(zeilen.some((z) => z.includes(';ma;05.11.2026;')), 'Tageszeile 05.11. mit ma');
    assert.ok(csv.includes('Hinweis;Lohngruppenwechsel: Daniel Schwarz ab 04.11.: fa → ma (Stunden fa: '));
    assert.equal((await c.polier.get('/monat?monat=2026-11')).status, 403);
  });

  await t.test('Gleiches Datum ersetzt (mit Protokoll), künftige Einträge löschbar, vergangene nicht', async () => {
    let r = await c.buero.put(`/benutzer/${DANIEL}`, { lohngruppe: 'va', lohngruppeGueltigAb: '2026-12-01' });
    assert.equal(r.status, 200);
    assert.equal(r.daten.lohngruppe, 'ma'); // heute weiter ma
    r = await c.buero.put(`/benutzer/${DANIEL}`, { lohngruppe: 'pol', lohngruppeGueltigAb: '2026-12-01' });
    const v = r.daten.lohngruppeVerlauf;
    assert.deepEqual(v.map((x) => [x.lohngruppeId, x.gueltigAb, x.kuenftig]), [['fa', '2000-01-01', false], ['ma', WECHSEL, false], ['pol', '2026-12-01', true]]);
    assert.ok(s.db.alle("SELECT * FROM protokoll WHERE objekt = ? AND text LIKE 'Lohngruppe%'", `benutzer:${DANIEL}`).some((p) => JSON.parse(p.neu).ersetzt === true));
    const kuenftig = v[2].id, vergangen = v[1].id;
    assert.equal((await c.mitarbeiter.del(`/benutzer/${DANIEL}/lohngruppen-verlauf/${kuenftig}`)).status, 403);
    assert.equal((await c.polier.del(`/benutzer/${DANIEL}/lohngruppen-verlauf/${kuenftig}`)).status, 403);
    assert.equal((await c.buero.del(`/benutzer/${DANIEL}/lohngruppen-verlauf/${vergangen}`)).status, 409);
    assert.equal((await c.buero.del(`/benutzer/${DANIEL}/lohngruppen-verlauf/${v[0].id}`)).status, 409);
    assert.equal((await c.buero.del(`/benutzer/${DANIEL}/lohngruppen-verlauf/999999`)).status, 404);
    r = await c.buero.del(`/benutzer/${DANIEL}/lohngruppen-verlauf/${kuenftig}`);
    assert.equal(r.status, 200);
    assert.equal(r.daten.lohngruppeVerlauf.length, 2);
  });

  await t.test('Künftiger Eintrag tritt im stündlichen Lauf in Kraft', async () => {
    await c.buero.put(`/benutzer/${DANIEL}`, { lohngruppe: 'va', lohngruppeGueltigAb: '2026-11-13' });
    assert.equal(s.db.eins('SELECT lohngruppe_id FROM benutzer WHERE id = ?', DANIEL).lohngruppe_id, 'ma');
    s.uhr.setze('2026-11-13T06:00:00.000Z');
    s.app.bt.stuendlich();
    assert.equal(s.db.eins('SELECT lohngruppe_id FROM benutzer WHERE id = ?', DANIEL).lohngruppe_id, 'va');
    assert.equal((await c.buero.get('/mitarbeiter')).daten.find((x) => x.id === DANIEL).lohngruppe, 'va');
  });

  await t.test('Kein Abfluss an Polier/Mitarbeiter', async () => {
    for (const r of ['mitarbeiter', 'polier']) {
      const m = (await c[r].get('/mitarbeiter')).daten;
      assert.ok(m.every((x) => !('lohngruppe' in x)), r);
      assert.equal((await c[r].get(`/benutzer/${DANIEL}/lohngruppen-verlauf`)).status, 403);
      assert.equal((await c[r].get('/benutzer')).status, 403);
    }
  });

  await t.test('Neue Person: erste Zuordnung gilt von Anfang an', async () => {
    const r = await c.buero.post('/benutzer', { name: 'Neu Test', rolle: 'mitarbeiter', pin: '1357', lohngruppe: 'hi' });
    assert.equal(r.status, 201);
    const v = (await c.buero.get(`/benutzer/${r.daten.id}/lohngruppen-verlauf`)).daten;
    assert.deepEqual(v.map((x) => [x.lohngruppeId, x.gueltigAb]), [['hi', '2000-01-01']]);
    const o = await c.buero.post('/benutzer', { name: 'Ohne LG', rolle: 'mitarbeiter', pin: '1357' });
    const x = await c.buero.put(`/benutzer/${o.daten.id}`, { lohngruppe: 'fa' });
    assert.deepEqual(x.daten.lohngruppeVerlauf.map((y) => [y.lohngruppeId, y.gueltigAb]), [['fa', '2000-01-01']]);
  });
});
