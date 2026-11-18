'use strict';
/** Druckbarer Tages- und Wochenplan (API.md 12.23) – feste Uhr Do 12.11.2026 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');
const { tagesplanPdf } = require('../../server/planer-pdf');

const FR = '2026-11-13', LANG = '2026-11-11';
const LKW = 4;

/** Text eines (unkomprimierten) pdfkit-PDFs je Seite */
function seitenTexte(buf) {
  const s = buf.toString('latin1');
  return [...s.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((m) => [...m[1].matchAll(/\[([^\]]*)\]\s*TJ/g)]
    .map((t) => [...t[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join('')).join('\n'));
}
const text = (buf) => seitenTexte(buf).join('\n').replace(/\s*\n\s*/g, ' '); // umbrochene Zeilen zusammenführen
const seiten = (buf) => (buf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
const keinEuro = (buf) => { const t = text(buf); assert.ok(!/€|\x80|EUR|Kostensatz|Regiesatz/i.test(t), 'kein €'); assert.ok(!buf.toString('latin1').includes('\x80')); };

test('Druckbarer Tagesplan', async (t) => {
  const s = await starte({ test: true, pdfUnkomprimiert: true, sitzung: { feldMin: 60 * 24 * 30, bueroMin: 60 * 24 * 30, maxH: 24 * 60 } });
  t.after(() => s.stop());
  const c = {};
  for (const r of ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf']) c[r] = await s.login(U[r]);
  const pdf = async (rolle, pfad) => { const r = await c[rolle].get(pfad); return r; };
  let e1;

  await t.test('Vorbereitung: drei Baustellen, Fuhre, Telefon, Abwesenheit', async () => {
    let r = await c.buero.post('/plan/einsaetze', { datum: FR, baustelleId: BS.pitten, beginn: '06:30', treffpunkt: 'Bauhof Breitenau', arbeit: 'Pflaster verlegen', benoetigt: 'Rüttelplatte', notiz: 'NOTIZ-BAUSTELLE-PITTEN',
      kolonnePolierIds: [U.polier], anlageIds: [LKW], notizen: { [U.mitarbeiter]: 'NOTIZ-PARTIE-LUKAS' }, fahrer: { [LKW]: U.mitarbeiter } });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    e1 = r.daten;
    assert.equal((await c.buero.put(`/plan/einsaetze/${e1.id}/anlagen/${LKW}`, { notiz: 'NOTIZ-LKW' })).status, 200);
    e1 = (await c.buero.get(`/plan/woche?von=${FR}`)).daten.einsaetze.find((e) => e.id === e1.id);
    r = await c.buero.post('/plan/einsaetze', { datum: FR, baustelleId: BS.kogler, beginn: '07:00', benutzerIds: [8, 9], notizen: { 9: 'NOTIZ-FREMD-TRIMMEL' }, notiz: 'NOTIZ-BAUSTELLE-KOGLER' });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    r = await c.buero.post('/plan/einsaetze', { datum: FR, baustelleId: BS.reisinger, beginn: '07:00', benutzerIds: [13, 14], notiz: 'NOTIZ-REISINGER' });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    r = await c.buero.post('/plan/fuhren', { datum: FR, anlageId: LKW, materialId: 4, menge: 10, einheit: 't', beginn: '07:15', nach: { art: 'baustelle', baustelleId: BS.pitten, abladestelle: 'Hof hinten' } });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    assert.equal((await c.polier.put('/auth/telefon', { telefon: '+43 664 1112223' })).status, 200);
    s.db.lauf("INSERT INTO abwesenheit (benutzer_id, datum, code, status, erfasst_von, erfasst) VALUES (30, ?, 'U', 'genehmigt', 101, '2026-11-01T08:00:00Z')", FR);
  });

  await t.test('Rechte: Mitarbeiter 403, Polier vor Veröffentlichung 404, Eingabeprüfung', async () => {
    assert.equal((await pdf('mitarbeiter', `/plan/tag.pdf?datum=${FR}`)).status, 403);
    assert.equal((await pdf('mitarbeiter', `/plan/woche.pdf?von=${FR}`)).status, 403);
    assert.equal((await pdf('polier', `/plan/tag.pdf?datum=${FR}`)).status, 404);
    assert.equal((await pdf('polier', `/plan/woche.pdf?von=${FR}`)).status, 404);
    assert.equal((await pdf('buero', '/plan/tag.pdf?datum=13.11.2026')).status, 400);
    assert.equal((await pdf('buero', `/plan/tag.pdf?datum=${FR}&baustelleIds=1,x`)).status, 400);
    for (const r of ['bauleiter', 'buero', 'gf']) {
      const x = await pdf(r, `/plan/tag.pdf?datum=${FR}`);
      assert.equal(x.status, 200, r);
      assert.match(x.headers.get('content-type'), /application\/pdf/);
      assert.equal(x.headers.get('cache-control'), 'no-store');
      assert.match(x.headers.get('content-disposition'), /Einteilung_2026-11-13\.pdf/);
    }
  });

  await t.test('Unveröffentlicht: Wasserzeichen; Planer und Bauleiter (wie Büro) sehen alles', async () => {
    const b = (await pdf('buero', `/plan/tag.pdf?datum=${FR}`)).daten;
    const tx = text(b);
    assert.match(tx, /ENTWURF . nicht ver.ffentlicht/);
    assert.match(tx, /Einteilung Freitag 13\.11\.2026/);
    for (const x of ['26-041', '26-038', '26-044', 'NOTIZ-PARTIE-LUKAS', 'NOTIZ-FREMD-TRIMMEL', 'NOTIZ-BAUSTELLE-PITTEN', 'Rüttelplatte', 'Bauhof Breitenau', 'Pflaster verlegen', 'Hof hinten', '+43 664 1112223', 'Polier: Josef Haidbauer', 'NOTIZ-LKW', 'Fahrer: Lukas Brandstätter', 'Fuhren', 'Nicht eingeteilt']) assert.ok(tx.includes(x), x);
    assert.match(tx, /Alois Dorfmeister: Urlaub/); // Büro mit stammdaten: Grund sichtbar
    assert.match(tx, /Seite 1 von \d/);
    keinEuro(b);
    const bl = text((await pdf('bauleiter', `/plan/tag.pdf?datum=${FR}`)).daten);
    assert.ok(bl.includes('26-041') && bl.includes('26-038') && bl.includes('26-044')); // Bauleiter wie Büro (13.11.2026)
    // Filter grenzt nur ein
    const f = text((await pdf('buero', `/plan/tag.pdf?datum=${FR}&baustelleIds=${BS.kogler}`)).daten);
    assert.ok(f.includes('26-038') && !f.includes('26-041') && !f.includes('Hof hinten'));
    const w = await pdf('buero', `/plan/woche.pdf?von=${FR}`);
    assert.equal(w.status, 200);
    const wt = text(w.daten);
    assert.match(wt, /Wochenplan 09\.11\.2026 . 13\.11\.2026/);
    assert.ok(wt.includes('ENTWURF') && wt.includes('Lukas Brandstätter') && wt.includes('26-044'));
    keinEuro(w.daten);
  });

  await t.test('Veröffentlicht: ohne Wasserzeichen mit Uhrzeit; Polier nur Veröffentlichtes, eigene Baustellen, Notizen der Partie', async () => {
    assert.equal((await c.buero.post('/plan/veroeffentlichen', { von: FR })).status, 200);
    const tx = text((await pdf('buero', `/plan/tag.pdf?datum=${FR}`)).daten);
    assert.ok(!tx.includes('ENTWURF'));
    assert.match(tx, /veröffentlicht \d\d:\d\d/);
    const p = await pdf('polier', `/plan/tag.pdf?datum=${FR}`);
    assert.equal(p.status, 200);
    const pt = text(p.daten);
    assert.ok(!pt.includes('ENTWURF'));
    for (const x of ['26-041', 'NOTIZ-PARTIE-LUKAS', 'NOTIZ-BAUSTELLE-PITTEN', 'NOTIZ-LKW', 'Hof hinten', '+43 664 1112223']) assert.ok(pt.includes(x), x);
    for (const x of ['26-038', '26-044', 'NOTIZ-FREMD-TRIMMEL', 'NOTIZ-REISINGER', 'NOTIZ-BAUSTELLE-KOGLER', 'Alois', 'Urlaub']) assert.ok(!pt.includes(x), x);
    keinEuro(p.daten);
    // Änderung nach Veröffentlichung: Planer wieder Entwurf, Polier sieht weiter den veröffentlichten Stand
    assert.equal((await c.buero.put(`/plan/einsaetze/${e1.id}`, { version: e1.version, beginn: '05:45' })).status, 200);
    const t2 = text((await pdf('buero', `/plan/tag.pdf?datum=${FR}`)).daten);
    assert.ok(t2.includes('ENTWURF') && t2.includes('Beginn 05:45'));
    const p2 = text((await pdf('polier', `/plan/tag.pdf?datum=${FR}`)).daten);
    assert.ok(!p2.includes('ENTWURF') && p2.includes('Beginn 06:30') && !p2.includes('05:45'));
    const pw = await pdf('polier', `/plan/woche.pdf?von=${FR}`);
    assert.equal(pw.status, 200);
    const pwt = text(pw.daten);
    assert.ok(pwt.includes('26-041') && !pwt.includes('26-038') && !pwt.includes('ENTWURF'));
    // Bauleiter-Fremdbaustelle (Reisinger) bleibt ausgeblendet; Mitarbeiter weiter 403
    assert.equal((await pdf('mitarbeiter', `/plan/tag.pdf?datum=${FR}`)).status, 403);
  });

  await t.test('Langer Tag: mehrere Seiten, Seitenzahl stimmt, kein Baustellen-Block geteilt', async () => {
    const personen = s.db.alle("SELECT id FROM benutzer WHERE aktiv = 1 AND rolle IN ('mitarbeiter','polier') ORDER BY id").map((x) => x.id);
    const bs = s.db.alle("SELECT id FROM baustelle WHERE intern = 0 AND phase IN ('geplant','in_arbeit') ORDER BY id").map((x) => x.id);
    let i = 0;
    for (const b of bs) {
      const ids = personen.slice(i, i + 4); i += 4;
      const notizen = Object.fromEntries(ids.map((id) => [id, `Bitte Werkzeug für Abschnitt ${b} mitnehmen und Schlüssel beim Polier abholen`]));
      const r = await c.buero.post('/plan/einsaetze', { datum: LANG, baustelleId: b, beginn: '06:30', treffpunkt: 'Bauhof', arbeit: 'Aushub, Unterbau verdichten, Randsteine setzen, Pflaster verlegen und verfugen', benoetigt: 'Rüttelplatte, Schneidgerät, 2 Paletten Randsteine', notiz: `Zufahrt über die Nebenstraße, Anrainer informieren (Block ${b})`, benutzerIds: ids, notizen });
      assert.equal(r.status, 201, JSON.stringify(r.daten));
    }
    const r = await pdf('buero', `/plan/tag.pdf?datum=${LANG}`);
    assert.equal(r.status, 200);
    const n = seiten(r.daten);
    const st = seitenTexte(r.daten);
    assert.ok(n >= 2, `Seiten ${n}`);
    assert.equal(st.length, n);
    st.forEach((x, k) => assert.ok(x.includes(`Seite ${k + 1} von ${n}`), `Fußzeile Seite ${k + 1}`));
    for (const b of bs) {
      const kst = s.db.eins('SELECT kst FROM baustelle WHERE id = ?', b).kst;
      const kopf = st.findIndex((x) => x.includes(`${kst}  `));
      const ende = st.findIndex((x) => x.includes(`(Block ${b})`));
      assert.ok(kopf >= 0 && kopf === ende, `Block ${kst} auf einer Seite (${kopf}/${ende})`);
    }
    keinEuro(r.daten);
  });
});

test('Tagesplan-PDF: Blöcke werden nicht geteilt (Modell)', async () => {
  const bloecke = Array.from({ length: 9 }, (_, k) => ({
    kst: `T-${k}`, name: `Baustelle ${k}`, adresse: 'Ort', polier: { name: 'P', telefon: null }, beginn: '07:00', treffpunkt: '', arbeit: 'x', fahrzeug: '',
    personen: Array.from({ length: 5 + k }, (_, j) => ({ name: `Person ${k}-${j}`, rolle: 'Mitarbeiter', notiz: '' })), anlagen: [], benoetigt: '', notiz: `ENDE-${k}`
  }));
  const buf = await tagesplanPdf({ titel: 'Einteilung Test', gedruckt: 'jetzt', veroeffentlichtUm: null, entwurf: true, bloecke, fuhren: [], nichtEingeteilt: [] }, { unkomprimiert: true });
  const st = seitenTexte(buf);
  assert.ok(st.length >= 3);
  for (let k = 0; k < 9; k++) {
    const a = st.findIndex((x) => x.includes(`T-${k}  `)), e = st.findIndex((x) => x.includes(`ENDE-${k}`));
    assert.ok(a >= 0 && a === e, `T-${k}`);
  }
  assert.ok(st.every((x) => x.includes('ENTWURF')));
});
