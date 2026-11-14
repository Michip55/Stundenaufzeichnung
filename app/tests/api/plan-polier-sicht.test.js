'use strict';
/**
 * API.md 15.10 – Plan-Sicht des Poliers (G2-002, G2-026, G2-027, G2-028, G2-029, G2-031).
 *
 * Orakel: Für Polier und Mitarbeiter ist ein fortgeschriebener bzw. übernommener Tag, an dem Partie-Mitglieder wegen einer
 * Abwesenheit ausgelassen wurden, NICHT unterscheidbar von demselben Tag, an dem das Büro diese Personen von Hand entfernt hat.
 * Verglichen werden je Übernahme-Weg (Fortschreiben beim Veröffentlichen, „Tag übernehmen“, „Vorwoche übernehmen“) zwei frische
 * Server mit denselben Abwesenheiten: JSON von /plan/partie, Tages- und Wochenplan-PDF (Text und Bytes), alle Benachrichtigungen an
 * Poliere und Mitarbeiter, „Mein Einsatz“, Kolonne `plan=1` (Polier und Mitarbeiter mit Ausnahme `kolonne`) und Kolonne-POST.
 * Der Planer (stammdaten) sieht dagegen die Ausgelassenen samt Grund und „Gerät ohne Fahrer“ als Warnung.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');

const LO = '2026-11-09', FR = '2026-11-13', MO = '2026-11-16', DI = '2026-11-17';
const LANG = { feldMin: 60 * 24 * 60, bueroMin: 60 * 24 * 60, maxH: 24 * 60 };
/** Text eines unkomprimierten pdfkit-PDFs (wie restkorrekturen.test.js) */
const pdfText = (buf) => [...buf.toString('latin1').matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((m) => [...m[1].matchAll(/\[([^\]]*)\]\s*TJ/g)]
  .map((t) => [...t[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join('')).join(' ')).join(' ');
/** PDF-Bytes ohne die von der echten Uhr abhängigen Metadaten */
const pdfRoh = (buf) => buf.toString('latin1').replace(/\(D:\d{14}Z\)/g, '').replace(/\/ID \[[^\]]*\]/g, '');

// Abwesend am Mo: X = 3 (Partie Pitten, Fahrer LKW 4), Y = 10 (Kolonne Leitgeb, Fahrer LKW 9), G = 16 (Gast aus Breitenau)
const WEG = [3, 10, 16];
const PIT = [U.polier, 2, 3, 4, 5, 6];

/**
 * Baut den Mo 16.11. auf einem frischen Server.
 * @param {'fortschreiben'|'tag'|'vorwoche'} weg  wie der Tag entsteht
 * @param {'abwesend'|'entfernt'} art  abwesend: Abwesenheit VOR dem Übernehmen (System lässt aus);
 *   entfernt: Übernehmen ohne Abwesenheit, Büro entfernt die Personen von Hand, Abwesenheit danach (gleiche Daten)
 */
async function szenario(t, weg, art) {
  const s = await starte({ test: true, sitzung: LANG, pdfUnkomprimiert: true });
  t.after(() => s.stop());
  const buero = await s.login(U.buero), gf = await s.login(U.gf);
  assert.equal((await gf.put('/rechte/ausnahme', { benutzerId: U.mitarbeiter, recht: 'kolonne', wert: true })).status, 200);
  if (weg === 'vorwoche') assert.equal((await buero.put('/einstellungen/plan', { planFortschreiben: false })).status, 200);
  const quelle = weg === 'vorwoche' ? LO : FR;
  const e = await buero.post('/plan/einsaetze', {
    datum: quelle, baustelleId: BS.pitten, beginn: '06:30', treffpunkt: 'Bauhof', arbeit: 'Pflaster', benutzerIds: [...PIT, 16], kolonnePolierIds: [U.polier2],
    anlageIds: [4, 9], fahrer: { 4: 3, 9: 10 }, notizen: { 2: 'PN-ZWEI' }
  });
  assert.equal(e.status, 201, JSON.stringify(e.daten));
  if (weg !== 'vorwoche') assert.equal((await buero.post('/plan/veroeffentlichen', { von: FR })).status, 200);
  const abwesend = async () => { for (const id of WEG) { const r = await buero.post('/abwesenheiten', { benutzerId: id, datum: MO, code: 'K' }); assert.ok([200, 201].includes(r.status), JSON.stringify(r.daten)); } };
  if (art === 'abwesend') await abwesend();
  if (weg === 'tag' || (weg === 'fortschreiben' && art === 'entfernt')) assert.equal((await buero.post('/plan/tag/uebernehmen', { datum: MO })).status, 200);
  let vw = null;
  if (weg === 'vorwoche') { vw = await buero.post('/plan/vorwoche-uebernehmen', { von: MO }); assert.equal(vw.status, 200, JSON.stringify(vw.daten)); }
  if (art === 'entfernt') {
    const mo = s.db.eins('SELECT id FROM plan_einsatz WHERE datum = ? AND baustelle_id = ? AND geloescht = 0', MO, BS.pitten);
    assert.ok(mo, 'Einsatz Mo übernommen');
    for (const id of WEG) assert.equal((await buero.del(`/plan/einsaetze/${mo.id}/personen/${id}`)).status, 200);
    await abwesend();
  }
  assert.equal((await buero.post('/plan/veroeffentlichen', { von: MO })).status, 200);
  return { s, buero, vw };
}

/** Alles, was Poliere und Mitarbeiter vom Mo sehen */
async function sicht(s) {
  s.uhr.setze('2026-11-16T05:10:00.000Z'); // Mo 06:10 Wien
  const p1 = await s.login(U.polier), p8 = await s.login(U.polier2), ma = await s.login(U.mitarbeiter);
  const o = {};
  for (const [n, c] of [['p1', p1], ['p8', p8]]) {
    const j = await c.get(`/plan/partie?datum=${MO}`);
    assert.equal(j.status, 200);
    o[`${n} partie`] = j.daten;
    const tag = await c.get(`/plan/tag.pdf?datum=${MO}`), woche = await c.get(`/plan/woche.pdf?von=${MO}`);
    assert.equal(tag.status, 200); assert.equal(woche.status, 200);
    o[`${n} tag.pdf text`] = pdfText(tag.daten); o[`${n} tag.pdf roh`] = pdfRoh(tag.daten);
    o[`${n} woche.pdf text`] = pdfText(woche.daten); o[`${n} woche.pdf roh`] = pdfRoh(woche.daten);
  }
  for (const id of [2, 3, 9, 10, 16]) o[`ich ${id}`] = (await (await s.login(id)).get(`/plan/ich?von=${FR}&bis=${MO}`)).daten;
  // erst nach dem Lesen (gelesen gesetzt): Lesestand in „Meine Partie“
  o['p1 partie nach Lesen'] = (await p1.get(`/plan/partie?datum=${MO}`)).daten;
  o['p1 kolonne'] = (await p1.get(`/zeit/kolonne?baustelleId=${BS.pitten}&plan=1`)).daten;
  o['ma kolonne'] = (await ma.get(`/zeit/kolonne?baustelleId=${BS.pitten}&plan=1`)).daten;
  s.uhr.setze('2026-11-16T05:30:00.000Z');
  o['p1 kolonne POST'] = (await p1.post('/zeit/kolonne', { baustelleId: BS.pitten, typ: 'kommen', benutzerIds: [3, 16, 9, 10] })).daten;
  await new Promise((r) => setTimeout(r, 50)); // Büro-Hinweis wird nach der Antwort geschrieben
  o['p1 kolonne danach'] = (await p1.get(`/zeit/kolonne?baustelleId=${BS.pitten}&plan=1`)).daten;
  // alle Benachrichtigungen an Poliere und Mitarbeiter (ohne die zufälligen Schlüssel)
  o.meldungen = s.db.alle("SELECT n.benutzer_id, n.typ, n.titel, n.text, n.zeit, n.baustelle_id FROM benachrichtigung n JOIN benutzer b ON b.id = n.benutzer_id WHERE b.rolle IN ('polier','mitarbeiter') ORDER BY n.benutzer_id, n.id");
  for (const [n, c] of [['p1', p1], ['p8', p8], ['ma', ma]]) o[`${n} /benachrichtigungen`] = (await c.get('/benachrichtigungen')).daten.map(({ id, ...x }) => x);
  return o;
}

for (const weg of ['fortschreiben', 'tag', 'vorwoche']) {
  test(`15.10 Orakel (${weg}): wegen Abwesenheit ausgelassen = vom Büro entfernt – für Polier und Mitarbeiter identisch`, async (t) => {
    const A = await szenario(t, weg, 'abwesend');
    const B = await szenario(t, weg, 'entfernt');
    const a = await sicht(A.s), b = await sicht(B.s);
    for (const k of Object.keys(a)) assert.deepEqual(a[k], b[k], `${weg}: ${k} unterscheidet sich`);
    assert.deepEqual(Object.keys(a), Object.keys(b));

    // Nicht leer geprüft: der Polier sieht genau den Plan – ohne die Abwesenden, nach Name sortiert, ohne Zählung/Version
    const pit = a['p1 partie'].einsaetze.find((x) => x.baustelleId === BS.pitten);
    const ids = pit.personen.map((p) => p.benutzerId);
    assert.deepEqual([...ids].sort((x, y) => x - y), [1, 2, 4, 5, 6, 8, 9, 11, 12]);
    const namen = pit.personen.map((p) => p.name);
    assert.deepEqual(namen, [...namen].sort((x, y) => x.localeCompare(y, 'de')), 'Reihenfolge nach Name');
    assert.equal(pit.anlagen.find((x) => x.anlageId === 4).fahrer, null, 'Fahrer X fehlt wie beim Entfernen');
    assert.equal(pit.anlagen.find((x) => x.anlageId === 9).fahrer, null);
    assert.ok(!('version' in pit), 'kein Bearbeitungszähler');
    assert.ok(pit.kolonnen.every((k) => !('anzahl' in k)), 'Kolonnen ohne Zählung');
    const roh = JSON.stringify(a['p1 partie']) + JSON.stringify(a['p8 partie']);
    for (const n of ['Daniel Schwarz', 'Günter Scherz', 'Patrick Hofer', 'Krank', 'abwesend', 'uebersprungen', 'ausgelassen']) assert.ok(!roh.includes(n), `Polier-JSON enthält ${n}`);
    for (const n of ['Daniel Schwarz', 'Günter Scherz', 'Patrick Hofer']) assert.ok(!a['p1 tag.pdf text'].includes(n) && !a['p1 woche.pdf text'].includes(n), `Polier-PDF enthält ${n}`);
    assert.ok(a['p1 tag.pdf text'].includes('Lukas Brandstätter'));
    // Lesestand nur für Eingeteilte (alle haben eine Mitteilung): 2 und 9 haben gelesen
    const nach = a['p1 partie nach Lesen'].einsaetze.find((x) => x.baustelleId === BS.pitten).personen;
    assert.deepEqual(nach.filter((p) => p.gelesen).map((p) => p.benutzerId).sort((x, y) => x - y), [2, 9]);
    // Kolonne plan=1 markiert genau die Eingeteilten der Partie-Sicht – unabhängig von Abwesenheiten
    const geplant = a['p1 kolonne'].filter((p) => p.geplant).map((p) => p.benutzerId).sort((x, y) => x - y);
    assert.deepEqual(geplant, [...ids].sort((x, y) => x - y));
    assert.deepEqual(a['ma kolonne'].filter((p) => p.geplant).map((p) => p.benutzerId).sort((x, y) => x - y), geplant);
    assert.ok(a['p1 kolonne'].every((p) => p.code === null));
    // POST: X (Partie) wird gebucht; eingeplanter Gast 9 besteht die Partie-Prüfung (Seed: schon eingestempelt); 16 und 10 sind
    // nicht eingeteilt – derselbe Text wie für jeden anderen nicht eingeteilten Gast
    const post = Object.fromEntries(a['p1 kolonne POST'].ergebnisse.map((r) => [r.benutzerId, r]));
    assert.equal(post[3].ok, true, JSON.stringify(post));
    assert.match(post[9].fehler || '', /^Bereits eingestempelt/);
    for (const id of [10, 16]) assert.match(post[id].fehler, /gehört nicht zu Ihrer Partie \(als Gast stempeln: gast:true\)\.$/);
    assert.equal(a['ich 3'].tage.find((x) => x.datum === MO).einsatz, null);

    // Planer: Ausgelassene mit Grund und „Gerät ohne Fahrer“ als Warnung (nur auf dem System-Weg A)
    const wA = (await A.buero.get(`/plan/woche?von=${MO}`)).daten.konflikte.filter((k) => k.datum === MO);
    const aus = wA.filter((k) => k.typ === 'ausgelassen');
    for (const n of ['Daniel Schwarz', 'Günter Scherz', 'Patrick Hofer']) assert.ok(aus.some((k) => k.text.includes(n) && /Krank/.test(k.text)), `Büro-Warnung für ${n}: ${JSON.stringify(wA)}`);
    assert.deepEqual(wA.filter((k) => k.typ === 'fahrer_fehlt').map((k) => k.anlageId).sort(), [4, 9]);
    const eA = (await A.buero.get(`/plan/woche?von=${MO}`)).daten.einsaetze.find((x) => x.datum === MO && x.baustelleId === BS.pitten);
    assert.ok(eA.konflikte.some((k) => k.typ === 'fahrer_fehlt'), 'Warnung an der Zelle');
    if (weg === 'vorwoche') {
      const typen = A.vw.daten.uebersprungen.map((u) => `${u.typ}:${u.benutzerId || u.anlageId}`).sort();
      assert.deepEqual(typen, ['abwesenheit:10', 'abwesenheit:16', 'abwesenheit:3', 'fahrer_fehlt:10', 'fahrer_fehlt:3'], JSON.stringify(A.vw.daten));
      assert.deepEqual(A.s.db.eins('SELECT uebersprungen FROM plan_tag WHERE datum = ?', MO) && JSON.parse(A.s.db.eins('SELECT uebersprungen FROM plan_tag WHERE datum = ?', MO).uebersprungen).map((g) => g.benutzerId).sort((x, y) => x - y), WEG, 'G2-029: gemerkt wie beim Fortschreiben');
    }
    // Weg B (von Hand entfernt) kennt keine solche Warnung
    const wB = (await B.buero.get(`/plan/woche?von=${MO}`)).daten.konflikte.filter((k) => k.datum === MO);
    assert.ok(!wB.some((k) => ['ausgelassen', 'fahrer_fehlt'].includes(k.typ)), JSON.stringify(wB));
  });
}

test('15.10 (G2-002/G2-028): Folgetag mit wieder vorgeschlagener Person – Polier-Liste nach Name, nicht in Einfüge-Reihenfolge', async (t) => {
  const s = await starte({ test: true, sitzung: LANG, pdfUnkomprimiert: true });
  t.after(() => s.stop());
  const buero = await s.login(U.buero), pol = await s.login(U.polier);
  assert.equal((await buero.post('/plan/einsaetze', { datum: FR, baustelleId: BS.pitten, beginn: '06:30', benutzerIds: PIT })).status, 201);
  assert.equal((await buero.post('/plan/veroeffentlichen', { von: FR })).status, 200);
  assert.equal((await buero.post('/abwesenheiten', { benutzerId: 3, datum: MO, code: 'K' })).status, 201);
  assert.equal((await buero.post('/plan/veroeffentlichen', { von: MO, bis: DI })).status, 200);
  // Di: 3 kommt über plan_tag.uebersprungen (N-006) zurück und steht in plan_person am Ende
  const diId = s.db.eins('SELECT id FROM plan_einsatz WHERE datum = ? AND baustelle_id = ?', DI, BS.pitten).id;
  const reihe = s.db.alle('SELECT benutzer_id FROM plan_person WHERE einsatz_id = ? ORDER BY rowid', diId).map((x) => x.benutzer_id);
  assert.equal(reihe[reihe.length - 1], 3, `Vorbedingung: Einfüge-Reihenfolge ${reihe}`);
  const nachName = (l) => [...l].sort((a, b) => a.name.localeCompare(b.name, 'de') || a.benutzerId - b.benutzerId);
  for (const d of [FR, MO, DI]) {
    const p = (await pol.get(`/plan/partie?datum=${d}`)).daten.einsaetze.find((e) => e.baustelleId === BS.pitten).personen;
    assert.deepEqual(p.map((x) => x.benutzerId), nachName(p).map((x) => x.benutzerId), `${d}: Reihenfolge nach Name`);
    const txt = pdfText((await pol.get(`/plan/tag.pdf?datum=${d}`)).daten);
    // ohne den Polier (steht auch im Kopf des Blocks) und ohne Namen außerhalb von Latin-1 (Textauszug)
    const pos = nachName(p).filter((x) => x.benutzerId !== U.polier && /^[\x20-\xff]+$/.test(x.name)).map((x) => txt.indexOf(x.name));
    assert.ok(pos.every((x, i) => x >= 0 && (i === 0 || x > pos[i - 1])), `${d}: Tagesplan-PDF nach Name (${pos})`);
  }
  const mo = (await pol.get(`/plan/partie?datum=${MO}`)).daten.einsaetze.find((e) => e.baustelleId === BS.pitten);
  assert.ok(!mo.personen.some((p) => p.benutzerId === 3), 'Mo: nur tatsächlich Eingeteilte');
  const di = (await pol.get(`/plan/partie?datum=${DI}`)).daten.einsaetze.find((e) => e.baustelleId === BS.pitten);
  assert.ok(di.personen.some((p) => p.benutzerId === 3));
  // Wochenplan-PDF: Spalten nach Name (Mo ohne, Di mit Daniel Schwarz)
  const w = pdfText((await pol.get(`/plan/woche.pdf?von=${MO}`)).daten);
  assert.ok(w.includes('Daniel Schwarz'));
});
