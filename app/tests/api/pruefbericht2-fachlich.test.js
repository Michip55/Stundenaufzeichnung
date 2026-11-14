'use strict';
/** Regressionstests PRUEFBERICHT_2: C-01, C-02, C-03, C-04, C-06, C-08 (Bericht), C-10, C-11 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');
const { demoUnterschrift } = require('../../server/png');

function pdfText(buf) {
  const s = buf.toString('latin1');
  const out = [];
  for (const m of s.matchAll(/\[([^\]]*)\]\s*TJ/g)) out.push([...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join(''));
  return out.join('\n');
}

test('C-04, C-02, C-06, C-08, C-11', async (t) => {
  const s = await starte({ pdfUnkomprimiert: true });
  t.after(() => s.stop());
  const buero = await s.login(U.buero);
  const pol = await s.login(U.polier);
  const ma = await s.login(U.mitarbeiter);
  const monatTag = async (id, datum) => (await buero.get(`/monat?monat=${datum.slice(0, 7)}`)).daten.mitarbeiter.find((m) => m.id === id).tage[datum];

  await t.test('C-04: ganze Schicht nachtragen und löschen (Original-Reproduktion)', async () => {
    const r = await buero.post('/zeit/schichten', { benutzerId: 3, baustelleId: BS.pitten, datum: '2026-11-07', von: '07:00', bis: '15:00', pauseMin: 30, grund: 'Kolonne vergessen' });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    assert.equal(r.daten.arbeitMin, 450);
    assert.equal(r.daten.pauseMin, 30);
    assert.equal(r.daten.buchungIds.length, 4);
    assert.equal((await monatTag(3, '2026-11-07')).stunden, 7.5);
    const liste = (await buero.get('/zeit/schichten?benutzerId=3&von=2026-11-06&bis=2026-11-09')).daten;
    assert.deepEqual(liste.map((x) => x.datum), ['2026-11-06', '2026-11-07', '2026-11-09']);
    assert.ok(s.db.alle('SELECT quelle FROM buchung WHERE id IN (' + r.daten.buchungIds.join(',') + ')').every((b) => b.quelle === 'buero'));
    // Überschneidung, Grenzen, Rechte
    assert.equal((await buero.post('/zeit/schichten', { benutzerId: 3, baustelleId: 1, datum: '2026-11-07', von: '14:00', bis: '18:00', pauseMin: 0, grund: 'doppelt' })).status, 409);
    assert.equal((await buero.post('/zeit/schichten', { benutzerId: 3, baustelleId: 1, datum: '2026-11-08', von: '05:00', bis: '22:00', pauseMin: 0, grund: 'zu lang' })).status, 400);
    assert.equal((await buero.post('/zeit/schichten', { benutzerId: 3, baustelleId: 1, datum: '2026-11-08', von: '07:00', bis: '08:00', pauseMin: 60, grund: 'Pause' })).status, 400);
    assert.equal((await buero.post('/zeit/schichten', { benutzerId: 3, baustelleId: 1, datum: '2026-11-08', von: '07:00', bis: '15:00', pauseMin: 30, pauseVon: '16:00', grund: 'Pause' })).status, 400);
    assert.equal((await buero.post('/zeit/schichten', { benutzerId: 3, baustelleId: 1, datum: '2026-11-20', von: '07:00', bis: '15:00', pauseMin: 30, grund: 'Zukunft' })).status, 400);
    assert.equal((await buero.post('/zeit/schichten', { benutzerId: 3, baustelleId: 1, datum: '2026-11-08', von: '07:00', bis: '15:00', pauseMin: 30 })).status, 400);
    assert.equal((await ma.post('/zeit/schichten', { benutzerId: 3, baustelleId: 1, datum: '2026-11-08', von: '07:00', bis: '15:00', pauseMin: 30, grund: 'x' })).status, 403);
    // Nachtschicht mit Pause zu einer festen Zeit
    const n = await buero.post('/zeit/schichten', { benutzerId: 3, baustelleId: 1, datum: '2026-11-08', von: '22:00', bis: '04:00', pauseMin: 30, pauseVon: '01:00', grund: 'Nachtarbeit nachgetragen' });
    assert.equal(n.status, 201);
    assert.equal(n.daten.arbeitMin, 330);
    // irrtümliche Schicht vom 06.11. löschen
    const falsch = liste[0];
    assert.equal((await buero.anfrage('DELETE', `/zeit/schichten/${falsch.id}`, {})).status, 400); // Grund fehlt
    assert.equal((await ma.anfrage('DELETE', `/zeit/schichten/${falsch.id}`, { grund: 'x' })).status, 403);
    const d = await buero.anfrage('DELETE', `/zeit/schichten/${falsch.id}`, { grund: 'irrtümlich doppelt' });
    assert.equal(d.status, 200);
    assert.equal(d.daten.geloescht, falsch.buchungIds.length);
    assert.ok(!(await buero.get('/zeit/schichten?benutzerId=3&von=2026-11-06&bis=2026-11-06')).daten.length);
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM buchung WHERE id IN (' + falsch.buchungIds.join(',') + ')').n, 0);
    assert.equal((await buero.anfrage('DELETE', `/zeit/schichten/${falsch.id}`, { grund: 'nochmal' })).status, 404);
    const p = s.db.alle("SELECT text, alt FROM protokoll WHERE art = 'zeitkorrektur' ORDER BY id");
    assert.ok(p.some((x) => /Schicht nachgetragen: Kolonne vergessen/.test(x.text)));
    assert.ok(p.some((x) => /Schicht gelöscht: irrtümlich doppelt/.test(x.text) && /kommen/.test(x.alt)));
  });

  let berichtId;
  await t.test('C-02: Stunden rechnet der Server – mitgesendete Stunden zählen nicht', async () => {
    berichtId = s.db.eins("SELECT id FROM bericht WHERE baustelle_id = ? AND status = 'entwurf' ORDER BY datum DESC", BS.ternitz)?.id;
    const b = await pol.post('/berichte', { baustelleId: BS.pitten, datum: '2026-11-12' });
    berichtId = b.daten.id;
    const r = await pol.putV(`/berichte/${berichtId}`, { personal: [{ benutzerId: 4, von1: '07:00', bis1: '15:00', pauseMin: 30, stunden: 23 }] });
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    assert.equal(r.daten.personal[0].stunden, 7.5);
    const r2 = await pol.putV(`/berichte/${berichtId}`, { personal: [{ benutzerId: 4, von1: '07:00', bis1: '08:00', stunden: 24 }] });
    assert.equal(r2.daten.personal[0].stunden, 1);
  });

  await t.test('C-08: Bericht – version Pflicht, veraltete Speicherung → 409 statt stillem Überschreiben', async () => {
    const v = (await pol.get(`/berichte/${berichtId}`)).daten.version;
    assert.equal((await buero.put(`/berichte/${berichtId}`, { vorkommnisse: 'Büro-Korrektur: Schaden an Gehsteig gemeldet', version: v })).status, 200);
    const alt = await pol.put(`/berichte/${berichtId}`, { vorkommnisse: 'Polier Version 1', version: v });
    assert.equal(alt.status, 409);
    assert.equal(alt.daten.code, 'KONFLIKT');
    assert.equal(alt.daten.version, v + 1);
    assert.equal((await pol.get(`/berichte/${berichtId}`)).daten.vorkommnisse, 'Büro-Korrektur: Schaden an Gehsteig gemeldet');
    assert.equal((await pol.put(`/berichte/${berichtId}`, { vorkommnisse: 'ohne Version' })).status, 400);
  });

  await t.test('C-06: Bauherr-Unterschrift zurückziehen nur Büro/GF, gleiches Bild abgelehnt, Vermerk sichtbar (auch PDF)', async () => {
    const bild = demoUnterschrift('echter-bauherr');
    assert.equal((await pol.postV(`/berichte/${berichtId}/unterschrift`, { rolle: 'bh', name: 'Ing. Helga Auer', bildPng: bild })).status, 200);
    const g = (await pol.get(`/berichte/${berichtId}`)).daten;
    assert.equal(g.unterschriften.bh.bildPng, bild);
    assert.equal((await pol.del(`/berichte/${berichtId}/unterschrift/bh`)).status, 403);
    const w = await buero.del(`/berichte/${berichtId}/unterschrift/bh`);
    assert.equal(w.status, 200);
    assert.equal(w.daten.geaendertNachUnterschrift.rolle, 'bh');
    assert.equal(w.daten.geaendertNachUnterschrift.von, 'Martina Koller');
    assert.equal((await pol.putV(`/berichte/${berichtId}`, { regie: [{ text: 'Regie 10 Std. angeordnet', stunden: 10 }] })).status, 200);
    const wieder = await pol.postV(`/berichte/${berichtId}/unterschrift`, { rolle: 'bh', name: 'DI Bauherr', bildPng: bild });
    assert.equal(wieder.status, 400);
    assert.match(wieder.daten.fehler, /neu unterschreiben/);
    // Bild aus einem anderen Bericht
    const fremdesBild = s.db.eins("SELECT bild_png FROM unterschrift WHERE bericht_id <> ? AND bild_png IS NOT NULL LIMIT 1", berichtId).bild_png;
    s.db.nachMigration(); // Hashes der Testdaten-Unterschriften
    assert.equal((await pol.postV(`/berichte/${berichtId}/unterschrift`, { rolle: 'bh', name: 'DI Bauherr', bildPng: fremdesBild })).status, 400);
    assert.equal((await pol.postV(`/berichte/${berichtId}/unterschrift`, { rolle: 'bh', name: 'Ing. Helga Auer', bildPng: demoUnterschrift('neu-bh') })).status, 200);
    assert.equal((await pol.postV(`/berichte/${berichtId}/unterschrift`, { rolle: 'an', name: 'Josef Haidbauer', bildPng: demoUnterschrift('neu-an') })).status, 200);
    const liste = (await buero.get(`/berichte?baustelleId=${BS.pitten}&von=2026-11-12`)).daten;
    assert.equal(liste.find((x) => x.id === berichtId).geaendertNachUnterschrift, true);
    for (const f of ['ag', 'intern']) {
      const pdf = await buero.get(`/berichte/${berichtId}/pdf?fassung=${f}`);
      assert.match(pdfText(pdf.daten), /Vermerk: Unterschrift Bauherr am 12\.11\.2026 .* zurückgezogen \(Martina Koller\)/);
    }
    assert.ok(s.db.eins("SELECT COUNT(*) AS n FROM unterschrift_widerruf WHERE bericht_id = ?", berichtId).n === 1);
  });

  await t.test('C-11: kein Einstempeln bei genehmigtem Krankenstand/Urlaub', async () => {
    assert.equal((await buero.post('/abwesenheiten', { benutzerId: 6, datum: '2026-11-12', code: 'K' })).status, 201);
    const r = await (await s.login(6)).post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
    assert.equal(r.status, 409);
    assert.match(r.daten.fehler, /Krankenstand/);
    // Inhaberregel 3 (API.md 15.2): über die Kolonne wird angenommen – kein Text, der nur bei Abwesenheit kommt;
    // das Büro erhält „Stempelung trotz eingetragener Abwesenheit … – bitte klären“
    const k = await pol.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: [6, 3], typ: 'kommen' });
    assert.deepEqual(k.daten.ergebnisse, [{ benutzerId: 6, ok: true, status: 'arbeit' }, { benutzerId: 3, ok: true, status: 'arbeit' }]);
    const g = await pol.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: [6], typ: 'kommen', gast: true });
    assert.equal(g.daten.ergebnisse[0].ok, false);
    assert.match(g.daten.ergebnisse[0].fehler, /^Bereits eingestempelt/);
    let n = 0;
    for (let i = 0; i < 200 && n < 2; i++) { n = s.db.eins("SELECT COUNT(*) AS n FROM benachrichtigung WHERE benutzer_id = ? AND schluessel IN ('abw-stempel:6:2026-11-12', 'abw-stempel:3:2026-11-12')", U.buero).n; if (n < 2) await new Promise((x) => setTimeout(x, 10)); }
    assert.equal(n, 2);
  });
});

test('C-01, C-03, C-10: Lohn ohne Doppelzählung, Bericht-Korrektur gilt, Zeitumstellung', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  let pol, pol8, buero, bl;
  const anmelden = async () => {
    pol = await s.login(U.polier); pol8 = await s.login(U.polier2); buero = await s.login(U.buero); bl = await s.login(U.bauleiter);
  };
  let bericht1;

  await t.test('C-01: nur Partie/Gestempelte/Gast, nie Büro/GF, keine Überschneidungen (Original-Reproduktion)', async () => {
    s.uhr.setze('2026-12-14T06:00:00.000Z'); // Mo 07:00
    await (await s.login(9)).post('/zeit/stempeln', { typ: 'gehen' }); // offene Schicht aus den Testdaten beenden
    for (const id of [9, 4, 5]) {
      const r = await (await s.login(id)).post('/zeit/stempeln', { typ: 'kommen', baustelleId: id === 9 ? BS.kogler : BS.pitten });
      assert.equal(r.status, 200, `kommen ${id}: ${JSON.stringify(r.daten)}`);
    }
    s.uhr.setze('2026-12-14T14:00:00.000Z'); // 15:00
    for (const id of [9, 4, 5]) await (await s.login(id)).post('/zeit/stempeln', { typ: 'gehen' });
    await anmelden();
    const b = await pol.post('/berichte', { baustelleId: BS.pitten, datum: '2026-12-14' });
    bericht1 = b.daten.id;
    assert.deepEqual(b.daten.personal.map((p) => p.benutzerId).sort(), [4, 5]);
    const basis = b.daten.personal;
    let r = await pol.putV(`/berichte/${bericht1}`, { personal: [...basis, { benutzerId: 9, von1: '07:00', bis1: '15:00' }] });
    assert.equal(r.status, 400);
    assert.match(r.daten.fehler, /gehört nicht zur Partie/);
    r = await pol.putV(`/berichte/${bericht1}`, { personal: [...basis, { benutzerId: 9, von1: '07:00', bis1: '15:00', gast: true }] });
    assert.equal(r.status, 400);
    assert.match(r.daten.fehler, /07:00 bis 15:00 auf Baustelle 26-038 gestempelt/);
    r = await pol.putV(`/berichte/${bericht1}`, { personal: [...basis, { benutzerId: U.gf, von1: '07:00', bis1: '12:00', gast: true }] });
    assert.equal(r.status, 400);
    assert.match(r.daten.fehler, /Bauleitung\/Büro\/Geschäftsführung/);
    r = await pol.putV(`/berichte/${bericht1}`, { personal: [...basis, { benutzerId: 9, von1: '16:00', bis1: '18:00', gast: true }] });
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    assert.equal(r.daten.personal.find((p) => p.benutzerId === 9).gast, true);
    assert.ok(s.db.eins("SELECT COUNT(*) AS n FROM protokoll WHERE text LIKE '%als Gast%Bericht%'").n === 1);
    // zweiter Bericht derselben Person zur selben Zeit
    const b2 = await pol8.post('/berichte', { baustelleId: BS.kogler, datum: '2026-12-14' });
    const p9 = b2.daten.personal.find((p) => p.benutzerId === 9);
    assert.deepEqual([p9.von1, p9.bis1, p9.stunden], ['07:00', '15:00', 8]);
    r = await pol8.putV(`/berichte/${b2.daten.id}`, { personal: b2.daten.personal.map((p) => (p.benutzerId === 9 ? { ...p, bis1: '17:00' } : p)) });
    assert.equal(r.status, 400);
    assert.match(r.daten.fehler, /bereits im Bericht von Baustelle 26-041/);
  });

  await t.test('C-03: Korrektur auf 0 Std. bzw. Person entfernt gilt im Lohn (mit Warnung)', async () => {
    const aktuell = (await pol.get(`/berichte/${bericht1}`)).daten.personal;
    const neu = aktuell.filter((p) => p.benutzerId !== 5).map((p) => (p.benutzerId === 4 ? { benutzerId: 4, von1: null, bis1: null, pauseMin: 0 } : p));
    assert.equal((await pol.putV(`/berichte/${bericht1}`, { personal: neu })).status, 200);
    await pol.postV(`/berichte/${bericht1}/unterschrift`, { rolle: 'an', name: 'Josef Haidbauer', bildPng: demoUnterschrift('c03-an') });
    await pol.postV(`/berichte/${bericht1}/unterschrift`, { rolle: 'bh', name: 'Ing. Helga Auer', bildPng: demoUnterschrift('c03-bh') });
    assert.equal((await bl.post(`/berichte/${bericht1}/freigeben`)).status, 200);
    const m = (await buero.get('/monat?monat=2026-12')).daten;
    const tag = (id) => m.mitarbeiter.find((x) => x.id === id).tage['2026-12-14'];
    assert.equal(tag(4).stunden, 0);
    assert.equal(tag(4).quelle, 'bericht');
    assert.equal(tag(5).stunden, 0);
    assert.ok(m.warnungen.some((w) => w.benutzerId === 5 && w.typ === 'nicht_im_bericht' && w.datum === '2026-12-14'));
    // Gast 9: 8 Std. gestempelt (26-038, kein freigegebener Bericht) + 2 Std. Gast-Zeile = 10
    assert.equal(tag(9).stunden, 10);
    assert.equal(tag(9).quelle, 'gemischt');
  });

  await t.test('C-01: Sicherheitsnetz im Monat – Überschneidung zählt nur einmal', async () => {
    // Altbestand/umgangene Prüfung simulieren: Gast-Zeile direkt auf 07:00–15:00 setzen
    s.db.lauf("UPDATE bericht_personal SET von1 = '07:00', bis1 = '15:00', stunden = 8 WHERE bericht_id = ? AND benutzer_id = 9", bericht1);
    const m = (await buero.get('/monat?monat=2026-12')).daten;
    const t9 = m.mitarbeiter.find((x) => x.id === 9).tage['2026-12-14'];
    assert.equal(t9.stunden, 8); // nicht 16
    assert.equal(t9.ueberschneidung, true);
    assert.ok(m.warnungen.some((w) => w.benutzerId === 9 && w.typ === 'ueberschneidung'));
    const csv = (await buero.get('/monat/export.csv?monat=2026-12')).daten.toString('utf8');
    assert.match(csv, /Hinweis;Prüfen: Christian Trimmel 14\.12\.2026 – Bericht- und Stempelzeiten überschneiden sich um 8 Std\./);
    assert.match(csv, /Hinweis;Prüfen: Mehmet Yildiz|Hinweis;Prüfen: Mehmet Yıldız/);
  });

  await t.test('C-10: Nachtschicht über die Zeitumstellung – echte Dauer (7 Std. im März)', async () => {
    s.uhr.setze('2027-03-29T08:00:00.000Z');
    await anmelden();
    const r = await buero.post('/zeit/schichten', { benutzerId: 7, baustelleId: BS.pitten, datum: '2027-03-27', von: '22:00', bis: '06:00', pauseMin: 0, grund: 'Nachtschicht Zeitumstellung' });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    assert.equal(r.daten.arbeitMin, 420);
    const b = await pol.post('/berichte', { baustelleId: BS.pitten, datum: '2027-03-27' });
    const z = b.daten.personal.find((p) => p.benutzerId === 7);
    assert.equal(z.stunden, 7);
    const u = await pol.putV(`/berichte/${b.data ? 0 : b.daten.id}`, { personal: [{ benutzerId: 7, von1: '22:00', bis1: '06:00', pauseMin: 0 }] });
    assert.equal(u.daten.personal[0].stunden, 7); // früher 8 (Wanduhr)
    assert.equal((await buero.get('/monat?monat=2027-03')).daten.mitarbeiter.find((m) => m.id === 7).tage['2027-03-27'].stunden, 7);
  });
});
