'use strict';
/**
 * API.md 15.7 Restkorrekturen – je Test der Befund (F-…, N-…), den er absichert. Feste Uhr: Do 12.11.2026 10:24.
 * Die Rechte-Matrix (rechte-matrix.test.js) prüft zusätzlich mechanisch: Rechte vor Body/Existenz (F-036) und die
 * Lieferschein-Kanarie (N-112) in allen Antworten, PDFs, Benachrichtigungen und Push-Texten.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');
const { testJpeg, testPng, testWebp } = require('./fuhrpark-bilder');

const HEUTE = '2026-11-12', FR = '2026-11-13', MO = '2026-11-16';
const LANG = { feldMin: 60 * 24 * 60, bueroMin: 60 * 24 * 60, maxH: 24 * 60 };
const b64 = (buf) => buf.toString('base64');
/** Text eines unkomprimierten pdfkit-PDFs (wie planer-nachpruefung.test.js) */
const pdfText = (buf) => [...buf.toString('latin1').matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((m) => [...m[1].matchAll(/\[([^\]]*)\]\s*TJ/g)]
  .map((t) => [...t[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join('')).join(' ')).join(' ');
const abwesend = (s, id, datum, code = 'K') => s.db.lauf("INSERT INTO abwesenheit (benutzer_id, datum, code, status, erfasst_von, erfasst) VALUES (?, ?, ?, 'genehmigt', 101, '2026-11-01T08:00:00Z')", id, datum, code);
const letzteId = (s) => s.db.eins('SELECT COALESCE(MAX(id), 0) AS m FROM benachrichtigung').m;

test('F-036: Rechteprüfung vor Validierung und Existenz (leerer Body, unbekannte IDs)', async (t) => {
  const s = await starte({ test: true });
  t.after(() => s.stop());
  const ma = await s.login(U.mitarbeiter), pol = await s.login(U.polier), gf = await s.login(U.gf);
  const antrag = (await ma.post('/abwesenheiten/zeitraum', { benutzerId: U.mitarbeiter, von: '2026-12-01', bis: '2026-12-02', code: 'U' })).daten.antragId;
  const fuhre = (await gf.post('/plan/fuhren', { datum: FR, anlageId: 4, materialId: 4, menge: 5, einheit: 't', nach: { art: 'baustelle', baustelleId: BS.pitten } })).daten.id;
  const faelle = [
    ['PUT', `/abwesenheiten/antraege/${antrag}`, {}], ['POST', '/plan/einsaetze', {}], ['POST', '/plan/fuhren', {}],
    ['POST', '/plan/fuhren/kopieren', {}], ['POST', '/plan/fuhren/kopieren', { id: 999999, tage: [MO] }], ['POST', '/plan/fuhren/kopieren', { id: fuhre, tage: [MO] }],
    ['POST', `/baustellen/${BS.pitten}/dokumente`, { kategorie: 'gibtsnicht' }], ['POST', '/bericht-assistent/text', {}],
    ['POST', '/berichte/999999/freigeben', {}], ['PUT', '/plan/einsaetze/999999', { version: 1 }], ['PUT', '/rechnungen/999999', { version: 1 }],
    ['POST', '/baustellen/999999/positionen', {}], ['PUT', '/baustellen/999999/abschluss', { version: 1 }], ['POST', '/baustellen/999999/leistungen', {}],
    ['DELETE', '/plan/fuhren/999999', undefined], ['PUT', '/fuhrpark/schaeden/999999', { version: 1 }], ['POST', '/berichte/999999/wetter', {}]
  ];
  for (const [rolle, c] of [['mitarbeiter', ma], ['polier', pol]]) {
    for (const [m, p, body] of faelle) {
      // Polier hat bericht_erstellen (E): Ziel aus Body/Pfad im eigenen Bereich → dort sind 400/404 nach der Rechteprüfung richtig
      if (rolle === 'polier' && ['/bericht-assistent/text', '/berichte/999999/wetter'].includes(p)) continue;
      const r = await c.anfrage(m, p, body);
      assert.equal(r.status, 403, `${rolle} ${m} ${p} ${JSON.stringify(body)} → ${r.status} ${JSON.stringify(r.daten)}`);
    }
  }
});

test('F-049: Bericht-JSON meldet die Vier-Augen-Sperre (freigabeVierAugen) – Freigeben-Knopf nur, wenn zulässig', async (t) => {
  const s = await starte({ test: true });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  assert.equal((await gf.put('/rechte/ausnahme', { benutzerId: 22, recht: 'bericht_freigeben', wert: true })).status, 200);
  const bid = 82; // Gloggnitz, unterschrieben; AN-Unterschrift erfasst Polier 22 (Seed)
  s.db.lauf("UPDATE unterschrift SET erfasst_von = 22 WHERE bericht_id = ? AND rolle = 'an'", bid);
  const p22 = await s.login(22);
  const j = (await p22.get(`/berichte/${bid}`)).daten;
  assert.equal(j.status, 'unterschrieben');
  assert.equal(j.freigabeVierAugen, true, 'eigene AN-Unterschrift → Sperre gemeldet');
  assert.equal((await p22.post(`/berichte/${bid}/freigeben`, {})).status, 403, 'Server bleibt dicht');
  const buero = await s.login(U.buero);
  assert.equal((await buero.get(`/berichte/${bid}`)).daten.freigabeVierAugen, false, 'zweite Person darf freigeben');
  assert.equal((await gf.get(`/berichte/${bid}`)).daten.freigabeVierAugen, false, 'GF: Selbstfreigabe erlaubt (markiert)');
  const pol1 = await s.login(U.polier);
  assert.ok(!('freigabeVierAugen' in (await pol1.get('/berichte/14')).daten), 'ohne Recht bericht_freigeben kein Feld');
});

test('F-059: Polier und Mitarbeiter erhalten keine Lohngruppe – auch die eigene nicht (Regel 2)', async (t) => {
  const s = await starte({ test: true });
  t.after(() => s.stop());
  for (const id of [U.mitarbeiter, U.polier, 22]) {
    const c = s.client();
    const l = await c.post('/auth/login', { benutzerId: id, pin: '1234' });
    assert.equal(l.status, 200);
    assert.ok(!('lohngruppe' in l.daten.benutzer), `login ${id}: ${JSON.stringify(l.daten.benutzer)}`);
    const ich = (await c.get('/auth/ich')).daten;
    assert.ok(!('lohngruppe' in ich.benutzer), `/auth/ich ${id}: ${JSON.stringify(ich.benutzer)}`);
    assert.ok(!JSON.stringify(ich).includes('"lohngruppe"'));
  }
  // mit Recht stammdaten/lohn/benutzer weiter vorhanden (Büro hat eine Lohngruppe gesetzt)
  s.db.lauf("UPDATE benutzer SET lohngruppe_id = 'pol' WHERE id = ?", U.buero);
  const b = await s.login(U.buero);
  assert.equal((await b.get('/auth/ich')).daten.benutzer.lohngruppe, 'pol');
});

test('F-055/F-057: Polier-Sicht der Partie ohne Rückschluss auf Abwesenheit und mit derselben Notizregel wie das PDF', async (t) => {
  const s = await starte({ test: true, sitzung: LANG, pdfUnkomprimiert: true });
  t.after(() => s.stop());
  const buero = await s.login(U.buero);
  const pol = await s.login(U.polier);
  for (const id of [2, 3, 4]) s.db.lauf('DELETE FROM abwesenheit WHERE benutzer_id = ? AND datum >= ?', id, FR);
  assert.equal((await buero.post('/plan/einsaetze', { datum: FR, baustelleId: BS.pitten, beginn: '06:30', benutzerIds: [2, 3, 4], anlageIds: [4], fahrer: { 4: 3 } })).status, 201);
  assert.equal((await buero.post('/plan/veroeffentlichen', { von: FR })).status, 200);
  abwesend(s, 3, MO); // Daniel Schwarz krank am Mo – der Mo wird aus der Vorschau fortgeschrieben
  const vor = letzteId(s);
  assert.equal((await buero.post('/plan/veroeffentlichen', { von: MO })).status, 200);
  const partieMeldung = s.db.alle("SELECT * FROM benachrichtigung WHERE id > ? AND benutzer_id = ? AND titel LIKE 'Ihre Partie%'", vor, U.polier);
  assert.equal(partieMeldung.length, 1);
  assert.doesNotMatch(partieMeldung[0].text, /Person|Gerät|\d+ Pers/, `Partie-Meldung ohne Zählung: ${partieMeldung[0].text}`);
  // Planer (stammdaten): echter Stand ohne Daniel
  const echt = (await buero.get(`/plan/partie?datum=${MO}`)).daten.einsaetze.find((e) => e.baustelleId === BS.pitten);
  assert.deepEqual(echt.personen.map((p) => p.benutzerId).sort(), [2, 4]);
  // Polier: Liste und Anzahl wie am Quelltag – unabhängig von der fremden Abwesenheit
  const fr = (await pol.get(`/plan/partie?datum=${FR}`)).daten.einsaetze.find((e) => e.baustelleId === BS.pitten);
  const mo = (await pol.get(`/plan/partie?datum=${MO}`)).daten.einsaetze.find((e) => e.baustelleId === BS.pitten);
  assert.deepEqual(mo.personen.map((p) => p.benutzerId).sort(), fr.personen.map((p) => p.benutzerId).sort());
  assert.equal(mo.anlagen.find((a) => a.anlageId === 4).fahrer.benutzerId, 3, 'Fahrer des Geräts wie am Quelltag');
  assert.ok(!JSON.stringify(mo).match(/Krank|abwesend|uebersprungen/i));
  // Polier-PDF: dieselbe Liste
  const pdf = pdfText((await pol.get(`/plan/tag.pdf?datum=${MO}`)).daten);
  for (const n of ['Lukas Brandstätter', 'Daniel Schwarz', 'Roland Kerschbaumer']) assert.ok(pdf.includes(n), `PDF ohne ${n}`);

  // F-057: Polier 8 (Partie Kogler) als Gast in Pitten am Fr – Notizen fremder Baustelle/Partie weder im JSON noch im PDF
  const e = (await buero.get(`/plan/woche?von=${FR}`)).daten.einsaetze.find((x) => x.datum === FR && x.baustelleId === BS.pitten);
  assert.equal((await buero.put(`/plan/einsaetze/${e.id}`, { version: e.version, notiz: 'BS-NOTIZ-PITTEN' })).status, 200);
  assert.equal((await buero.post(`/plan/einsaetze/${e.id}/personen`, { benutzerIds: [8, 7], notizen: { 7: 'PN-KARL-NOTIZ' } })).status, 200);
  s.db.lauf("UPDATE plan_anlage SET notiz = 'A-NOTIZ-LKW' WHERE einsatz_id = ? AND anlage_id = 4", e.id);
  assert.equal((await buero.post('/plan/veroeffentlichen', { von: FR })).status, 200);
  const p8 = await s.login(8);
  const j8 = JSON.stringify((await p8.get(`/plan/partie?datum=${FR}`)).daten);
  const t8 = pdfText((await p8.get(`/plan/tag.pdf?datum=${FR}`)).daten);
  for (const k of ['BS-NOTIZ-PITTEN', 'PN-KARL-NOTIZ', 'A-NOTIZ-LKW']) {
    assert.ok(!j8.includes(k), `JSON des Gast-Poliers enthält ${k}`);
    assert.ok(!t8.includes(k), `PDF des Gast-Poliers enthält ${k}`);
  }
  // Polier der Baustelle sieht sie (JSON = PDF)
  const j1 = JSON.stringify((await pol.get(`/plan/partie?datum=${FR}`)).daten);
  const t1 = pdfText((await pol.get(`/plan/tag.pdf?datum=${FR}`)).daten);
  for (const k of ['BS-NOTIZ-PITTEN', 'PN-KARL-NOTIZ', 'A-NOTIZ-LKW']) { assert.ok(j1.includes(k), `JSON Polier 1 ohne ${k}`); assert.ok(t1.includes(k), `PDF Polier 1 ohne ${k}`); }
});

test('N-084: geleerte Zelle – ein selbst eingeteilter Polier bekommt nur seine eigene Meldung (wie bei der gelöschten Zelle)', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  const e = (await gf.post('/plan/einsaetze', { datum: FR, baustelleId: BS.pitten, beginn: '06:30', benutzerIds: [U.polier, 2] })).daten;
  await gf.post('/plan/veroeffentlichen', { von: FR });
  await gf.del(`/plan/einsaetze/${e.id}/personen/${U.polier}`);
  await gf.del(`/plan/einsaetze/${e.id}/personen/2`);
  const dry = (await gf.post('/plan/veroeffentlichen', { von: FR, vorschau: true })).daten;
  const an1 = dry.empfaenger.filter((x) => x.benutzerId === U.polier);
  assert.equal(an1.length, 1, JSON.stringify(an1));
  assert.match(an1[0].titel, /Einsatz entfällt/);
});

test('F-058: Fahrer handeln nur auf dem veröffentlichten Stand und sehen keine Entwurfsdaten', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  const buero = await s.login(U.buero);
  const f = (await buero.post('/plan/fuhren', { datum: HEUTE, anlageId: 4, fahrerId: 7, materialId: 4, menge: 10, einheit: 't', notiz: 'VEROEFF-NOTIZ', nach: { art: 'baustelle', baustelleId: BS.pitten } })).daten;
  await buero.post('/plan/veroeffentlichen', { von: HEUTE });
  const v = (await buero.get(`/plan/fuhren?von=${HEUTE}`)).daten.find((x) => x.id === f.id).version;
  assert.equal((await buero.put(`/plan/fuhren/${f.id}`, { version: v, notiz: 'UNVEROEFF-NOTIZ', fahrerId: 3 })).status, 200);
  const ma3 = await s.login(3), ma7 = await s.login(7);
  const r3 = await ma3.post(`/plan/fuhren/${f.id}/status`, { status: 'erledigt', menge: 9, einheit: 't' });
  assert.equal(r3.status, 403, 'neu (unveröffentlicht) eingeteilter Fahrer meldet nicht');
  assert.equal(r3.daten.code, 'KEIN_ZUGRIFF');
  assert.equal((await ma3.post(`/plan/fuhren/${f.id}/foto`, { bildBase64: b64(testJpeg()), dateiname: 'w.jpg' })).status, 403);
  const r7 = await ma7.post(`/plan/fuhren/${f.id}/status`, { status: 'unterwegs' });
  assert.equal(r7.status, 200);
  assert.equal(r7.daten.notiz, 'VEROEFF-NOTIZ', 'veröffentlichter Stand');
  assert.ok(!JSON.stringify(r7.daten).includes('UNVEROEFF'), JSON.stringify(r7.daten));
  assert.ok(!('geaendertNachVeroeffentlichung' in r7.daten) && !('konflikte' in r7.daten) && !('fahrer' in r7.daten), 'Fahrer-Sicht ohne Planer-Felder');
  assert.equal(r7.daten.status, 'unterwegs');
  // unbekannte Fuhre: dieselbe 403 wie fremde (keine Existenzauskunft)
  assert.equal((await ma3.post('/plan/fuhren/999999/status', { status: 'unterwegs' })).status, 403);
});

test('N-102: Fuhren nur mit Anlagen der Klasse LKW – PKW, Bus, Anhänger und Baumaschine mit Kennzeichen → 400', async (t) => {
  const s = await starte({ test: true });
  t.after(() => s.stop());
  const buero = await s.login(U.buero);
  const anl = s.db.alle("SELECT id, klasse FROM anlage WHERE kennzeichen IS NOT NULL AND ausgeschieden IS NOT 1 AND klasse IN ('pkw','bus','anhaenger','baumaschine')");
  assert.ok(['pkw', 'bus', 'anhaenger', 'baumaschine'].every((k) => anl.some((a) => a.klasse === k)), JSON.stringify(anl));
  for (const a of anl) {
    const r = await buero.post('/plan/fuhren', { datum: FR, anlageId: a.id, materialId: 4, menge: 5, einheit: 't', nach: { art: 'baustelle', baustelleId: BS.pitten } });
    assert.equal(r.status, 400, `${a.klasse} ${a.id} → ${r.status}`);
    assert.equal(r.daten.fehler, 'Fuhren nur mit Fahrzeugen (LKW).');
  }
  assert.equal((await buero.post('/plan/fuhren', { datum: FR, anlageId: 4, materialId: 4, menge: 5, einheit: 't', nach: { art: 'baustelle', baustelleId: BS.pitten } })).status, 201);
});

test('N-063 Rest: ohne BAUTAG_SCHLUESSEL lässt sich die 2FA-Pflicht nicht einschalten (sonst Selbstaussperrung)', async (t) => {
  const alt = process.env.BAUTAG_SCHLUESSEL;
  delete process.env.BAUTAG_SCHLUESSEL;
  t.after(() => { if (alt !== undefined) process.env.BAUTAG_SCHLUESSEL = alt; });
  const s = await starte({ demo: false });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  if ((await gf.get('/einstellungen/sicherheit')).status === 403) assert.equal((await gf.post('/auth/pin', { alt: '1234', neu: '583920' })).status, 200);
  const vorher = (await gf.get('/einstellungen/sicherheit')).daten.zweiFaktorPflicht;
  const r = await gf.put('/einstellungen/sicherheit', { zweiFaktorPflicht: { buero: true } });
  assert.equal(r.status, 400);
  assert.match(r.daten.fehler, /BAUTAG_SCHLUESSEL/);
  assert.deepEqual((await gf.get('/einstellungen/sicherheit')).daten.zweiFaktorPflicht, vorher, 'nichts gespeichert');
  // Abschalten bleibt möglich; mit Schlüssel (bzw. Demo/Test) geht Einschalten wie bisher
  assert.equal((await gf.put('/einstellungen/sicherheit', { zweiFaktorPflicht: { buero: false } })).status, 200);
  const d = await starte({ test: true });
  t.after(() => d.stop());
  assert.equal((await (await d.login(U.gf)).put('/einstellungen/sicherheit', { zweiFaktorPflicht: { buero: true } })).status, 200);
});

test('N-058/N-060: Bauleiter erhält dieselbe Erinnerung wie das Büro (gleicher Tag, auch nur offene Fuhren)', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  const buero = await s.login(U.buero);
  // nur eine offene (unveröffentlichte) Fuhre für morgen, keine Einsätze offen
  await buero.post('/plan/fuhren', { datum: FR, anlageId: 4, fahrerId: 9, materialId: 4, menge: 10, einheit: 't', nach: { art: 'baustelle', baustelleId: BS.kogler } });
  s.db.lauf("UPDATE plan_einsatz SET veroeffentlicht_zeit = '2026-11-12T08:00:00Z' WHERE datum = ?", FR);
  s.uhr.setze('2026-11-12T16:05:00Z');
  await buero.post('/test/stuendlich', {});
  const er = s.db.alle("SELECT benutzer_id, titel, text FROM benachrichtigung WHERE schluessel = 'plan:erinnerung:2026-11-12'");
  const bl = er.find((x) => x.benutzer_id === U.bauleiter), bu = er.find((x) => x.benutzer_id === U.buero);
  assert.ok(bl && bu, JSON.stringify(er));
  assert.deepEqual([bl.titel, bl.text], [bu.titel, bu.text]);
  assert.match(bl.text, /Fuhre/);
});

test('N-050 Rest: am PDF einer stornierten Rechnung lässt sich die Verknüpfung lösen – sonst bleibt alles gesperrt', async (t) => {
  const s = await starte({ test: true });
  t.after(() => s.stop());
  const buero = await s.login(U.buero);
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  const dok = (await buero.post(`/baustellen/${BS.pitten}/dokumente`, { kategorie: 'ausgangsrechnungen', titel: 'AR storno', dateiBase64: b64(pdf), dateiname: 'ar.pdf' })).daten;
  const r = (await buero.post(`/baustellen/${BS.pitten}/rechnungen`, { nr: 'AR-ST-1', typ: 'abschlag', datum: '2026-11-01', netto: 1000, dokumentId: dok.id })).daten;
  assert.equal((await buero.post(`/rechnungen/${r.id}/storno`, { grund: 'Fehler im Betrag' })).status, 200);
  const st = (await buero.get(`/rechnungen/${r.id}`)).daten;
  assert.equal((await buero.put(`/baustellen/${BS.pitten}/dokumente/${dok.id}`, { kategorie: 'sonstiges', bestaetigtPreisfrei: true })).status, 409, 'verknüpft → gesperrt');
  assert.equal((await buero.put(`/rechnungen/${r.id}`, { version: st.version, netto: 5 })).status, 409, 'storniert: Beträge gesperrt');
  const l = await buero.put(`/rechnungen/${r.id}`, { version: st.version, dokumentId: null });
  assert.equal(l.status, 200, JSON.stringify(l.daten));
  assert.equal(l.daten.dokumentId ?? null, null);
  assert.equal((await buero.del(`/baustellen/${BS.pitten}/dokumente/${dok.id}`)).status, 200, 'nach dem Lösen löschbar');
});

test('N-034 Rest: /urlaub/konto nennt das laufende Urlaubsjahr nach der Vorgabe (vorgabeJahr), unabhängig vom Beginn einzelner Personen', async (t) => {
  const s = await starte({ test: true });
  t.after(() => s.stop());
  const buero = await s.login(U.buero);
  // die alphabetisch erste Person hat einen eigenen Beginn 12-01 → am 12.11.2026 läuft für sie noch das Urlaubsjahr 2025
  const erste = s.db.eins('SELECT id FROM benutzer WHERE aktiv = 1 ORDER BY name').id;
  s.db.lauf("INSERT INTO urlaub_konto (benutzer_id, jahr, art, einheit, uebertrag, beginn) VALUES (?, 2026, 'urlg', 'Arbeitstage', 0, '12-01') ON CONFLICT(benutzer_id, jahr) DO UPDATE SET beginn = '12-01'", erste);
  const k = (await buero.get('/urlaub/konto')).daten;
  assert.equal(k[0].benutzerId, erste);
  assert.equal(k[0].jahr, 2025, 'Vorbedingung: erste Zeile in einem anderen Urlaubsjahr');
  assert.ok(k.every((x) => x.vorgabeJahr === 2026), JSON.stringify(k.map((x) => x.vorgabeJahr)));
  const csv = await buero.get('/urlaub/export.csv');
  assert.match(csv.headers.get('content-disposition'), /Urlaub_2026\.csv/);
});

/* ---------------- N-112: Liefer- und Wiegescheine nur für Hochladende bzw. preise_sehen/stammdaten ---------------- */

test('N-112: Lieferschein im Bericht – JSON, Bilddatei, internes und AG-PDF, Fernansicht, E-Mail', async (t) => {
  const s = await starte({ test: true, sitzung: LANG, pdfUnkomprimiert: true });
  t.after(() => s.stop());
  const buero = await s.login(U.buero), pol = await s.login(U.polier), bl = await s.login(U.bauleiter);
  const bid = (await pol.post('/berichte', { baustelleId: BS.pitten, datum: HEUTE })).daten.id || s.db.eins('SELECT id FROM bericht WHERE baustelle_id = ? AND datum = ?', BS.pitten, HEUTE).id;
  await buero.post('/test/ocr', { text: 'Kieswerk GmbH\nLieferschein LS-4711\nKies 16/32 12,5 t\nPreis 12,50 EUR/t\nSumme EUR 156,25' });
  const fremd = await buero.post(`/berichte/${bid}/lieferschein`, { bildBase64: b64(testPng()), dateiname: 'ls.png', beschreibung: 'LS-FREMD-BUERO' });
  assert.equal(fremd.status, 201);
  assert.match(fremd.daten.text, /12,50/, 'der Hochladende sieht den erkannten Text');
  const eigen = await pol.post(`/berichte/${bid}/lieferschein`, { bildBase64: b64(testWebp()), dateiname: 'ls2.webp', beschreibung: 'LS-EIGEN-POLIER' });
  assert.equal(eigen.status, 201);
  const foto = await pol.post(`/berichte/${bid}/fotos`, { bildBase64: b64(testJpeg()), dateiname: 'f.jpg', beschreibung: 'BAUSTELLENFOTO' });
  assert.equal(foto.status, 201);
  // JSON
  const jp = (await pol.get(`/berichte/${bid}`)).daten;
  assert.deepEqual(jp.fotos.map((f) => f.beschreibung).sort(), ['BAUSTELLENFOTO', 'LS-EIGEN-POLIER']);
  for (const c of [buero, bl]) assert.equal((await c.get(`/berichte/${bid}`)).daten.fotos.length, 3, 'Büro/Bauleiter sehen alle');
  // Bilddatei: fremd wie nicht vorhanden, eigene und andere Fotoarten wie bisher
  assert.equal((await pol.get(`/berichte/${bid}/fotos/${fremd.daten.foto.id}`)).status, 404);
  assert.equal((await pol.get(`/berichte/${bid}/fotos/${eigen.daten.foto.id}`)).status, 200);
  assert.equal((await pol.get(`/berichte/${bid}/fotos/${foto.daten.id}`)).status, 200);
  assert.equal((await buero.get(`/berichte/${bid}/fotos/${fremd.daten.foto.id}`)).status, 200);
  // fremden Lieferschein weder ändern noch löschen noch per gleichem Bild „zurückbekommen“
  assert.equal((await pol.put(`/berichte/${bid}/fotos/${fremd.daten.foto.id}`, { beschreibung: 'x' })).status, 404);
  assert.equal((await pol.del(`/berichte/${bid}/fotos/${fremd.daten.foto.id}`)).status, 404);
  const gleich = await pol.post(`/berichte/${bid}/lieferschein`, { bildBase64: b64(testPng()), dateiname: 'ls.png' });
  assert.equal(gleich.status, 409);
  assert.ok(!JSON.stringify(gleich.daten).includes('LS-FREMD'));
  // PDFs (intern und AG, mit Fotos) – die interne Fassung braucht bericht_freigeben (Ausnahme für den Polier)
  assert.equal((await (await s.login(U.gf)).put('/rechte/ausnahme', { benutzerId: U.polier, recht: 'bericht_freigeben', wert: true })).status, 200);
  for (const fassung of ['intern', 'ag']) {
    const rp = await pol.get(`/berichte/${bid}/pdf?fassung=${fassung}&fotos=1`);
    assert.equal(rp.status, 200, `${fassung}: ${rp.status}`);
    const tp = pdfText(rp.daten);
    assert.ok(tp.includes('LS-EIGEN-POLIER') && tp.includes('BAUSTELLENFOTO'), `${fassung}: eigene Fotos fehlen`);
    assert.ok(!tp.includes('LS-FREMD-BUERO'), `${fassung}: fremder Lieferschein im PDF des Poliers`);
    const tb = pdfText((await buero.get(`/berichte/${bid}/pdf?fassung=${fassung}&fotos=1`)).daten);
    assert.ok(tb.includes('LS-FREMD-BUERO') && tb.includes('LS-EIGEN-POLIER'), `${fassung}: Büro sieht alle`);
  }
  // Fernansicht und E-Mail an den Auftraggeber: kein angemeldeter Empfänger → nie Lieferscheine
  const link = (await pol.post(`/berichte/${bid}/unterschrift-link`, { rolle: 'bh', name: 'Bauherr' })).daten;
  const token = link.url.split('/').pop();
  const anonym = s.client();
  const fj = JSON.stringify((await anonym.get(`/fern/${token}`)).daten);
  assert.ok(!/LS-|12,50|Lieferschein/.test(fj), fj.slice(0, 300));
  const fp = pdfText((await anonym.get(`/fern/${token}/pdf`)).daten);
  assert.ok(!/LS-FREMD|LS-EIGEN/.test(fp));
  const ag = pdfText(await require('../../server/routes/berichte').agPdf(s.app.bt, bid));
  assert.ok(!/LS-FREMD|LS-EIGEN/.test(ag), 'AG-PDF der E-Mail');
  // Benachrichtigungen an Polier/Mitarbeiter ohne Lieferschein-Inhalt
  for (const n of s.db.alle("SELECT n.* FROM benachrichtigung n JOIN benutzer b ON b.id = n.benutzer_id WHERE b.rolle IN ('polier','mitarbeiter')")) assert.ok(!/LS-FREMD|12,50|Kieswerk GmbH/.test(`${n.titel} ${n.text}`), n.text);
});

test('N-112: Projektdokumente „Lieferscheine“ – Liste, Suche, Einzelabruf, Datei, Versionen', async (t) => {
  const s = await starte({ test: true });
  t.after(() => s.stop());
  const buero = await s.login(U.buero), pol = await s.login(U.polier), gf = await s.login(U.gf);
  const pdf = (x) => b64(Buffer.from(`%PDF-1.4\n% ${x}\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`));
  const ls = (await buero.post(`/baustellen/${BS.pitten}/dokumente`, { kategorie: 'lieferscheine', titel: 'LS-DOK-FREMD Kieswerk 12,50 €/t', notiz: 'Summe EUR 1.234,00', dateiBase64: pdf('a'), dateiname: 'ls.pdf' })).daten;
  const plan = (await buero.post(`/baustellen/${BS.pitten}/dokumente`, { kategorie: 'plaene', titel: 'PLAN-OK', dateiBase64: pdf('b'), dateiname: 'p.pdf' })).daten;
  const liste = JSON.stringify((await pol.get(`/baustellen/${BS.pitten}/dokumente`)).daten);
  assert.ok(liste.includes('PLAN-OK'), 'andere Polier-Kategorien unverändert');
  assert.ok(!liste.includes('LS-DOK-FREMD') && !liste.includes('12,50'), liste.slice(0, 300));
  const such = JSON.stringify((await pol.get('/dokumente/suche?q=LS-DOK')).daten);
  assert.ok(!such.includes('LS-DOK-FREMD'), such);
  assert.equal((await pol.get(`/baustellen/${BS.pitten}/dokumente/${ls.id}`)).status, 403);
  assert.equal((await pol.get(`/baustellen/${BS.pitten}/dokumente/${ls.id}/datei?version=1`)).status, 403);
  assert.equal((await pol.get(`/baustellen/${BS.pitten}/dokumente?kategorie=lieferscheine`)).daten.length, 0);
  assert.equal((await pol.get(`/baustellen/${BS.pitten}/dokumente/${plan.id}`)).status, 200);
  for (const c of [buero, gf]) {
    assert.ok(JSON.stringify((await c.get('/dokumente/suche?q=LS-DOK')).daten).includes('LS-DOK-FREMD'));
    assert.equal((await c.get(`/baustellen/${BS.pitten}/dokumente/${ls.id}/datei?version=1`)).status, 200);
  }
  // selbst hochgeladene Version sieht die Person; fremde Versionen desselben Dokuments nicht (Polier mit erstelltem Dokument)
  s.db.lauf('UPDATE dokument SET erstellt_von = ? WHERE id = ?', U.polier, ls.id);
  s.db.lauf('UPDATE dokument_datei SET erstellt_von = ? WHERE dokument_id = ? AND nr = 1', U.polier, ls.id);
  assert.equal((await gf.post(`/baustellen/${BS.pitten}/dokumente/${ls.id}/versionen`, { dateiBase64: pdf('c'), dateiname: 'ls2.pdf' })).status, 201);
  const d = (await pol.get(`/baustellen/${BS.pitten}/dokumente/${ls.id}`)).daten;
  assert.deepEqual(d.versionen.map((x) => x.nr), [1], JSON.stringify(d.versionen));
  assert.equal((await pol.get(`/baustellen/${BS.pitten}/dokumente/${ls.id}/datei?version=1`)).status, 200);
  assert.equal((await pol.get(`/baustellen/${BS.pitten}/dokumente/${ls.id}/datei?version=2`)).status, 404);
  assert.equal((await pol.get(`/baustellen/${BS.pitten}/dokumente/${ls.id}/datei`)).status, 404, 'aktuelle (fremde) Version');
  assert.equal((await buero.get(`/baustellen/${BS.pitten}/dokumente/${ls.id}`)).daten.versionen.length, 2);
});

test('N-112: Liefer-/Wiegeschein der Fuhre – nur Hochladende(r) bzw. preise_sehen/stammdaten', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  const buero = await s.login(U.buero), pol = await s.login(U.polier), ma = await s.login(U.mitarbeiter), bl = await s.login(U.bauleiter);
  const f = (await buero.post('/plan/fuhren', { datum: HEUTE, anlageId: 4, fahrerId: U.mitarbeiter, materialId: 4, menge: 10, einheit: 't', nach: { art: 'baustelle', baustelleId: BS.pitten } })).daten;
  await buero.post('/plan/veroeffentlichen', { von: HEUTE });
  const eigen = await ma.post(`/plan/fuhren/${f.id}/foto`, { bildBase64: b64(testJpeg()), dateiname: 'w.jpg' });
  assert.equal(eigen.status, 201);
  const fremd = await buero.post(`/plan/fuhren/${f.id}/foto`, { bildBase64: b64(testPng()), dateiname: 'ls.png' });
  assert.equal(fremd.status, 201);
  assert.equal((await ma.get(`/plan/fuhren/${f.id}/foto/${eigen.daten.id}`)).status, 200, 'Fahrer: eigenes Foto');
  assert.equal((await ma.get(`/plan/fuhren/${f.id}/foto/${fremd.daten.id}`)).status, 404, 'Fahrer: Foto des Büros nicht');
  for (const id of [eigen.daten.id, fremd.daten.id]) {
    assert.equal((await pol.get(`/plan/fuhren/${f.id}/foto/${id}`)).status, 403, 'Polier der Zielbaustelle: nie');
    for (const c of [buero, bl]) assert.equal((await c.get(`/plan/fuhren/${f.id}/foto/${id}`)).status, 200);
  }
  // Meine Partie / Mein Einsatz liefern keine Foto-Verweise
  assert.ok(!/lieferscheinFotoId|\/foto\//.test(JSON.stringify((await pol.get(`/plan/partie?datum=${HEUTE}`)).daten)));
  assert.ok(!/lieferscheinFotoId|\/foto\//.test(JSON.stringify((await ma.get(`/plan/ich?von=${HEUTE}&bis=${HEUTE}`)).daten)));
});
