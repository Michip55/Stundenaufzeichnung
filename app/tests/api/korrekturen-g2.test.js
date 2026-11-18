'use strict';
/**
 * API.md 15.11 – Korrekturen G2 (Zahlungsstand und Texte). Je Befund ein Regressionstest, der ohne die Korrektur fehlschlägt:
 * G2-001/G2-023 (Zahlungsstand), G2-016 (Überschneidungs-Orakel), G2-015 (Geldwörter in Fehlertexten), G2-017 (fortlaufende
 * IDs), G2-030 (fremde Belege über Fotolimit/Hash), G2-033 (Push „Schäden“), G2-022 (Sperr-Meldung und 423-Text).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { starte, U, BS } = require('./hilfe');
const { testJpeg, testPng, testWebp } = require('./fuhrpark-bilder');
const { wienDatum, plusTage } = require('../../server/datum');

const LANG = { feldMin: 60 * 24 * 60, bueroMin: 60 * 24 * 60, maxH: 24 * 60 };
const b64 = (buf) => buf.toString('base64');
// Geldphasen als Wert (der Schlüssel „archiviert“ = bool bleibt erlaubt)
const GELD_PHASE = /[Ss]chlussrechnung|[Bb]ezahlt|Archiviert|"archiviert"[,}\]]/;
const warte = () => new Promise((r) => setImmediate(() => setTimeout(r, 20)));

/** GF setzt BS Pitten über fertiggestellt → abgenommen → Schlussrechnung → Bezahlt (Daten in der Vergangenheit) */
async function bisBezahlt(s, gf, { umweg = false } = {}) {
  const heute = wienDatum(s.uhr());
  const bs = () => s.db.eins('SELECT version FROM baustelle WHERE id = ?', BS.pitten).version;
  const phase = async (body) => { const r = await gf.post(`/baustellen/${BS.pitten}/phase`, { version: bs(), ...body }); assert.equal(r.status, 200, JSON.stringify(r.daten)); };
  await phase({ phase: 'fertiggestellt', datum: plusTage(heute, -10) });
  await phase({ phase: 'abgenommen', datum: plusTage(heute, -8), abnahmeDatum: plusTage(heute, -8) });
  await phase({ phase: 'schlussrechnung', datum: plusTage(heute, -6), schlussrechnung: { nr: 'SR-G2-4711', betrag: 12345.67 } });
  if (umweg) { // Rechnung zurückgenommen und neu gelegt: der Verlauf darf auch diesen Zwischenschritt nicht verraten
    await phase({ phase: 'abgenommen', datum: plusTage(heute, -5), abnahmeDatum: plusTage(heute, -8) });
    await phase({ phase: 'schlussrechnung', datum: plusTage(heute, -4) });
  }
  await phase({ phase: 'bezahlt', datum: plusTage(heute, -2) });
  return heute;
}

test('G2-001/G2-023: Polier und Mitarbeiter sehen nie den Rechnungs-/Zahlungsstand (JSON, Verlauf, Zeitplan, Archiv, Filter, Fehlertext)', async (t) => {
  const s = await starte({ sitzung: LANG });
  t.after(() => s.stop());
  const gf = await s.login(U.gf), buero = await s.login(U.buero), pol = await s.login(U.polier), ma = await s.login(U.mitarbeiter);
  const heute = await bisBezahlt(s, gf, { umweg: true });

  for (const [wer, c] of [['Polier', pol], ['Mitarbeiter', ma]]) {
    const d = await c.get(`/baustellen/${BS.pitten}`);
    assert.equal(d.status, 200, wer);
    assert.equal(d.daten.phase, 'abgeschlossen', wer);
    assert.equal(d.daten.phaseName, 'Abgeschlossen', wer);
    assert.equal(d.daten.phaseSeit, null, `${wer}: kein Datum der Geldphase`);
    assert.equal(d.daten.archiviert, true, `${wer}: „abgeschlossen“ steht im Archiv`);
    assert.equal(d.daten.abnahmeDatum, plusTage(heute, -8), `${wer}: Abnahme bleibt sichtbar`);
    assert.ok(!GELD_PHASE.test(JSON.stringify(d.daten)), `${wer}: ${JSON.stringify(d.daten)}`);
    assert.ok(!('phaseVorschlag' in d.daten) && !('schlussrechnung' in d.daten), wer);
    // Phasenverlauf: keine Geldphasen, kein erkennbarer Zwischenschritt (abgenommen → [SR] → abgenommen zusammengefasst)
    const v = await c.get(`/baustellen/${BS.pitten}/phasen`);
    assert.equal(v.status, 200, wer);
    assert.deepEqual(v.daten.map((x) => x.phase), ['fertiggestellt', 'abgenommen'], `${wer}: ${JSON.stringify(v.daten)}`);
    assert.deepEqual(v.daten.map((x) => x.datum), [plusTage(heute, -10), plusTage(heute, -8)], wer);
    // Listen: alle, laufend, Archiv – nie eine Geldphase; der Wechsel ins Archiv verrät nicht „bezahlt“ statt „Schlussrechnung“
    for (const q of ['', '?alle=1', '?archiv=1', `?archiv=1&jahr=${heute.slice(0, 4)}`]) {
      const l = await c.get(`/baustellen${q}`);
      assert.equal(l.status, 200);
      assert.ok(!GELD_PHASE.test(JSON.stringify(l.daten)), `${wer} /baustellen${q}`);
    }
    assert.ok(!(await c.get('/baustellen')).daten.some((b) => b.id === BS.pitten), `${wer}: nicht mehr unter „laufend“`);
    assert.ok((await c.get('/baustellen?archiv=1')).daten.some((b) => b.id === BS.pitten && b.phase === 'abgeschlossen'), `${wer}: unter „Abgeschlossene Bauvorhaben“`);
  }
  // Zeitplan (nur Polier): keine Meilensteine Schlussrechnung/Bezahlt, keine Zähler/Filter nach Geldphase
  for (const q of ['', '?archiv=1', '?phase=bezahlt', '?phase=schlussrechnung', '?archiv=1&phase=bezahlt']) {
    const z = await pol.get(`/plan/zeitplan${q}`);
    assert.equal(z.status, 200);
    assert.ok(!GELD_PHASE.test(JSON.stringify(z.daten)), `Polier /plan/zeitplan${q}: ${JSON.stringify(z.daten).slice(0, 400)}`);
    if (/phase=/.test(q)) assert.equal(z.daten.bauvorhaben.length, 0, `Filter ${q} trifft nichts`);
  }
  const za = (await pol.get('/plan/zeitplan?archiv=1')).daten.bauvorhaben.find((b) => b.baustelle.id === BS.pitten);
  assert.equal(za.baustelle.phase, 'abgeschlossen');
  assert.deepEqual(za.meilensteine.map((m) => m.art).sort(), ['abgenommen', 'fertiggestellt', 'gewaehrleistung']);
  // Neuer Bericht: weder der Name der Geldphase im Text noch ihr Datum als Grenze (sonst Datum der Zahlung erfragbar)
  for (const tag of [plusTage(heute, -3), plusTage(heute, -1)]) {
    const r = await pol.post('/berichte', { baustelleId: BS.pitten, datum: tag });
    assert.equal(r.status, 400, `${tag}: ${JSON.stringify(r.daten)}`);
    assert.match(r.daten.fehler, /abgeschlossen \(Abgeschlossen\)/);
    assert.ok(!GELD_PHASE.test(r.daten.fehler), r.daten.fehler);
  }
  // Gegenprobe: Büro und GF sehen den echten Stand
  const bd = (await buero.get(`/baustellen/${BS.pitten}`)).daten;
  assert.deepEqual([bd.phase, bd.phaseSeit, bd.archiviert], ['bezahlt', plusTage(heute, -2), false]);
  assert.ok((await buero.get(`/baustellen/${BS.pitten}/phasen`)).daten.some((x) => x.phase === 'bezahlt'));
  assert.ok((await buero.get('/baustellen')).daten.some((b) => b.id === BS.pitten));
  const bz = (await buero.get('/plan/zeitplan')).daten.bauvorhaben.find((b) => b.baustelle.id === BS.pitten);
  assert.ok(bz.meilensteine.some((m) => m.art === 'bezahlt'));
  // Archiviert (nach der Zahlung): für Polier weiterhin „abgeschlossen“, ohne Archivdatum
  assert.equal((await gf.post(`/baustellen/${BS.pitten}/phase`, { version: s.db.eins('SELECT version FROM baustelle WHERE id = ?', BS.pitten).version, phase: 'archiviert' })).status, 200);
  const pa = (await pol.get(`/baustellen/${BS.pitten}`)).daten;
  assert.deepEqual([pa.phase, pa.phaseSeit, pa.archiviert], ['abgeschlossen', null, true]);
  assert.ok(!GELD_PHASE.test(JSON.stringify((await pol.get(`/baustellen/${BS.pitten}/phasen`)).daten)));
  assert.equal((await pol.get('/plan/zeitplan?archiv=1')).daten.archivAnzahl, (await pol.get('/plan/zeitplan')).daten.archivAnzahl);
});

test('G2-001: Angebot erscheint ohne Preisrecht als „Geplant“', async (t) => {
  const s = await starte({ sitzung: LANG });
  t.after(() => s.stop());
  const gf = await s.login(U.gf), pol = await s.login(U.polier);
  s.db.lauf("UPDATE baustelle SET phase = 'angebot', status = 'geplant' WHERE id = ?", BS.pitten);
  const d = (await pol.get(`/baustellen/${BS.pitten}`)).daten;
  assert.deepEqual([d.phase, d.phaseName], ['geplant', 'Geplant']);
  assert.equal((await gf.get(`/baustellen/${BS.pitten}`)).daten.phase, 'angebot');
});

test('G2-016: Überschneidung fremder Personen – gespeichert, keine Zeiten/Baustelle im Text, gleiche Antwort für anwesend und abwesend, Büro klärt', async (t) => {
  const s = await starte({ sitzung: LANG });
  t.after(() => s.stop());
  const pol = await s.login(U.polier), buero = await s.login(U.buero);
  const TAG = '2026-11-08'; // Sonntag: keine Testdaten
  const fremde = s.db.alle("SELECT id, name FROM benutzer WHERE aktiv = 1 AND rolle = 'mitarbeiter' AND id <> ? AND (baustelle_id IS NULL OR baustelle_id <> ?) ORDER BY id", U.mitarbeiter, BS.pitten);
  const [A, B] = fremde;
  assert.ok(A && B);
  s.db.lauf('DELETE FROM buchung WHERE benutzer_id IN (?, ?) AND zeit >= ? AND zeit < ?', A.id, B.id, '2026-11-06T00:00:00Z', '2026-11-11T00:00:00Z');
  s.db.lauf('DELETE FROM abwesenheit WHERE benutzer_id IN (?, ?) AND datum BETWEEN ? AND ?', A.id, B.id, '2026-11-07', '2026-11-10');
  s.db.lauf("DELETE FROM bericht_personal WHERE benutzer_id IN (?, ?) AND bericht_id IN (SELECT id FROM bericht WHERE datum BETWEEN '2026-11-07' AND '2026-11-10')", A.id, B.id);
  // A: Mo 09.11. 07:00–12:00 auf Reisinger gestempelt; B: am 09.11. Urlaub (genehmigt), nicht gestempelt
  const kst = s.db.eins('SELECT kst FROM baustelle WHERE id = ?', BS.reisinger).kst;
  s.db.lauf("INSERT INTO buchung (benutzer_id, typ, zeit, baustelle_id, quelle, erfasst) VALUES (?, 'kommen', '2026-11-09T06:00:00.000Z', ?, 'seed', '2026-11-09T06:00:00.000Z'), (?, 'gehen', '2026-11-09T11:00:00.000Z', ?, 'seed', '2026-11-09T11:00:00.000Z')", A.id, BS.reisinger, A.id, BS.reisinger);
  s.db.lauf("INSERT INTO abwesenheit (benutzer_id, datum, code, status, erfasst_von, erfasst) VALUES (?, '2026-11-09', 'U', 'genehmigt', 101, '2026-11-01T08:00:00Z')", B.id);
  const neu = await pol.post('/berichte', { baustelleId: BS.pitten, datum: TAG });
  assert.equal(neu.status, 201, JSON.stringify(neu.daten));
  const id = neu.daten.id;
  const version = () => s.db.eins('SELECT version FROM bericht WHERE id = ?', id).version;
  // Block über Mitternacht bis Mo 09.11. 07:59
  const zeile = (p) => ({ benutzerId: p.id, gast: true, von1: '08:00', bis1: '07:59' });
  const antworten = [];
  for (const p of [A, B]) {
    const r = await pol.put(`/berichte/${id}`, { version: version(), personal: [zeile(p)] });
    antworten.push(r);
    assert.equal(r.status, 200, `${p.name}: ${JSON.stringify(r.daten)}`);
    const txt = JSON.stringify(r.daten);
    assert.ok(!txt.includes(kst) && !/07:00|12:00|gestempelt|überschneiden|Urlaub/.test(txt), txt.slice(0, 400));
  }
  // gleiche Form der Antwort (bis auf Name/ID/Version)
  const form = (r) => JSON.stringify(r.daten.personal.map((p) => ({ ...p, benutzerId: 0, name: '' })));
  assert.equal(form(antworten[0]), form(antworten[1]));
  assert.deepEqual(Object.keys(antworten[0].daten).sort(), Object.keys(antworten[1].daten).sort());
  await warte();
  const meld = (bid) => s.db.alle("SELECT * FROM benachrichtigung WHERE benutzer_id = ? AND schluessel LIKE 'bericht-ueberschneidung:%'", bid);
  assert.equal(meld(U.buero).length, 1, `Büro: genau ein Hinweis (für A): ${JSON.stringify(meld(U.buero).map((m) => m.text))}`);
  assert.match(meld(U.buero)[0].text, new RegExp(A.name));
  assert.ok(!meld(U.buero).some((m) => m.text.includes(B.name)), 'B (abwesend) ohne Überschneidung → kein Hinweis');
  for (const p of [U.polier, U.mitarbeiter, A.id, B.id]) assert.equal(meld(p).length, 0, `kein Hinweis an ${p}`);
  assert.ok((await buero.get('/benachrichtigungen')).daten.some((m) => m.titel === 'Zeiten überschneiden sich'));
  // Gegenprobe: das Büro (stammdaten/lohn) bekommt die genaue Ablehnung wie bisher
  const rb = await buero.put(`/berichte/${id}`, { version: version(), personal: [zeile(A)] });
  assert.equal(rb.status, 400);
  assert.match(rb.daten.fehler, new RegExp(`Baustelle ${kst} gestempelt`));
  // eigene Zeile des Poliers: eigene Zeiten dürfen genannt werden (eigene Daten) – unverändert abgelehnt
  s.db.lauf("INSERT INTO buchung (benutzer_id, typ, zeit, baustelle_id, quelle, erfasst) VALUES (?, 'kommen', '2026-11-09T06:00:00.000Z', ?, 'seed', '2026-11-09T06:00:00.000Z'), (?, 'gehen', '2026-11-09T11:00:00.000Z', ?, 'seed', '2026-11-09T11:00:00.000Z')", U.polier, BS.reisinger, U.polier, BS.reisinger);
  assert.equal((await pol.put(`/berichte/${id}`, { version: version(), personal: [zeile({ id: U.polier })] })).status, 400);
});

test('G2-015: Fehlertexte an Polier/Mitarbeiter ohne €-Zeichen und Geldwörter', async (t) => {
  const s = await starte({ sitzung: LANG });
  t.after(() => s.stop());
  const pol = await s.login(U.polier), ma = await s.login(U.mitarbeiter), buero = await s.login(U.buero);
  const GELD = /€|Euro|Preis|preise_|Rechnung|Zahlung|Kosten\b|Betrag/i;
  const proben = [
    ['GET', `/baustellen/${BS.kogler}/fremdleistungen`], ['GET', `/baustellen/${BS.pitten}/fremdleistungen`], ['GET', '/rechnungen'],
    ['GET', `/baustellen/${BS.pitten}/lv`], ['GET', '/preise'], ['POST', `/baustellen/${BS.pitten}/nachtraege`, { text: 'x', betrag: 1 }],
    ['GET', `/kalkulation/${BS.pitten}`], ['PUT', `/baustellen/${BS.pitten}/auftrag`, { version: 1, auftragssumme: 1 }]
  ];
  for (const [wer, c] of [['Polier', pol], ['Mitarbeiter', ma]]) {
    for (const [m, p, body] of proben) {
      const r = await c.anfrage(m, p, body);
      assert.ok(r.status >= 400, `${wer} ${m} ${p}: ${r.status}`);
      assert.ok(!GELD.test(JSON.stringify(r.daten)), `${wer} ${m} ${p}: ${JSON.stringify(r.daten)}`);
    }
  }
  // Fremdleistungen: Text an der Quelle ohne € – auch Büro-Konten ohne Preisrecht bekommen kein €-Zeichen
  const f = await pol.get(`/baustellen/${BS.pitten}/fremdleistungen`);
  assert.equal(f.status, 403);
  assert.equal(f.daten.code, 'KEIN_ZUGRIFF');
  // Gegenprobe: mit Preisrecht bleiben fachliche Texte unverändert
  const r = await buero.get('/rechnungen/999999');
  assert.ok(r.status === 404 && /Rechnung/.test(r.daten.fehler), JSON.stringify(r.daten));
});

test('G2-017: eigene Abwesenheiten/Anträge ohne fortlaufende IDs – Zählen fremder Einträge unmöglich', async (t) => {
  const s = await starte({ sitzung: LANG });
  t.after(() => s.stop());
  const ma = await s.login(U.mitarbeiter), buero = await s.login(U.buero), pol = await s.login(U.polier);
  const probe = async (datum) => {
    const r = await ma.post('/abwesenheiten', { benutzerId: U.mitarbeiter, datum, code: 'ZA' });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    return r.daten;
  };
  const a1 = await probe('2026-12-15');
  assert.match(String(a1.id), /^p[0-9a-f]{20}$/);
  assert.doesNotMatch(String(a1.antragId), /^e\d+$/);
  const tab1 = s.db.eins("SELECT id FROM abwesenheit WHERE benutzer_id = ? AND datum = '2026-12-15'", U.mitarbeiter).id;
  assert.equal((await ma.del(`/abwesenheiten/${a1.id}`)).status, 200, 'Zurückziehen mit der Kennung');
  assert.ok(!s.db.eins('SELECT 1 AS x FROM abwesenheit WHERE id = ?', tab1));
  // dazwischen: Büro trägt zwei fremde Tage ein (Büro bekommt Tabellen-IDs)
  for (const d of ['2026-12-16', '2026-12-17']) {
    const r = await buero.post('/abwesenheiten', { benutzerId: 9, datum: d, code: 'K' });
    assert.equal(r.status, 201);
    assert.equal(typeof r.daten.id, 'number');
  }
  const a2 = await probe('2026-12-18');
  const tab2 = s.db.eins("SELECT id FROM abwesenheit WHERE benutzer_id = ? AND datum = '2026-12-18'", U.mitarbeiter).id;
  assert.equal(tab2 - tab1, 2, 'Vorbedingung: Tabelle zählt fortlaufend (zwei fremde Einträge dazwischen)');
  // nichts in den Antworten an den Mitarbeiter verrät die Tabellen-IDs
  const sicht = JSON.stringify([a2, (await ma.get('/abwesenheiten')).daten, (await ma.get('/abwesenheiten/antraege')).daten, (await ma.get('/urlaub/kalender?von=2026-12-14&bis=2026-12-20')).daten]);
  for (const n of [tab1, tab2]) assert.ok(!new RegExp(`"(id|antragId)":"?e?${n}"?[,}]`).test(sicht), sicht.slice(0, 600));
  const ids = [...sicht.matchAll(/"id":("?[^",}]+"?)/g)].map((m) => m[1]);
  assert.ok(ids.length && ids.every((x) => /^"p[0-9a-f]{20}"$/.test(x)), ids.join(','));
  // stabil und auflösbar: gleiche Kennung in Liste, Antrag und Kalender; Zurückziehen über den Antrag
  const liste = (await ma.get('/abwesenheiten')).daten.find((a) => a.datum === '2026-12-18');
  assert.equal(liste.id, a2.id);
  assert.equal((await ma.get('/abwesenheiten/antraege')).daten.find((a) => a.von === '2026-12-18').tage[0].id, a2.id);
  // fremde/geratene Kennungen: wie nicht vorhanden; Kennungen anderer Personen lösen sich nicht auf
  assert.equal((await ma.del(`/abwesenheiten/p${'0'.repeat(20)}`)).status, 404);
  const fremdeKennung = require('../../server/oeffentlich').kennung(s.db, 'abwesenheit', s.db.eins("SELECT id FROM abwesenheit WHERE benutzer_id = 9 AND datum = '2026-12-16'").id);
  assert.equal((await ma.del(`/abwesenheiten/${fremdeKennung}`)).status, 404);
  assert.ok(s.db.eins("SELECT 1 AS x FROM abwesenheit WHERE benutzer_id = 9 AND datum = '2026-12-16'"));
  // Bestandsantrag ohne antrag_id: keine „e<id>“ an den Mitarbeiter; Zurückziehen über die Kennung
  const alt = s.db.lauf("INSERT INTO abwesenheit (benutzer_id, datum, code, status, erfasst_von, erfasst) VALUES (?, '2026-12-21', 'U', 'beantragt', ?, '2026-11-01T08:00:00Z')", U.mitarbeiter, U.mitarbeiter).id;
  const ant = (await ma.get('/abwesenheiten/antraege')).daten.find((a) => a.von === '2026-12-21');
  assert.match(ant.antragId, /^x[0-9a-f]{20}$/);
  assert.ok(!JSON.stringify((await ma.get('/abwesenheiten/antraege')).daten).includes(`"e${alt}"`));
  assert.equal((await buero.get('/abwesenheiten/antraege')).daten.find((a) => a.von === '2026-12-21').antragId, `e${alt}`, 'Büro: Bestands-ID unverändert');
  assert.equal((await ma.del(`/abwesenheiten/antraege/${ant.antragId}`)).status, 200);
  assert.ok(!s.db.eins('SELECT 1 AS x FROM abwesenheit WHERE id = ?', alt));
  // Polier: eigener Antrag ebenso
  const pz = await pol.post('/abwesenheiten/zeitraum', { benutzerId: U.polier, von: '2026-12-22', bis: '2026-12-23', code: 'U' });
  assert.equal(pz.status, 201);
  const pt = (await pol.get('/abwesenheiten/antraege')).daten.find((a) => a.antragId === pz.daten.antragId);
  assert.ok(pt.tage.every((x) => /^p[0-9a-f]{20}$/.test(x.id)), JSON.stringify(pt.tage));
});

test('G2-030: fremde Liefer-/Wiegescheine zählen nicht und werden nie zusammengeführt (Bericht und Fuhre)', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  const gf = await s.login(U.gf), buero = await s.login(U.buero), pol = await s.login(U.polier), ma = await s.login(U.mitarbeiter);
  const HEUTE = wienDatum(s.uhr());
  // Bericht BS 1: die GF legt einen Lieferschein ab (für den Polier unsichtbar, N-112)
  const ber = await pol.post('/berichte', { baustelleId: BS.pitten, datum: '2026-11-08' });
  const bid = ber.daten.id;
  assert.ok(bid, JSON.stringify(ber.daten));
  const g = await gf.post(`/berichte/${bid}/fotos`, { bildBase64: b64(testPng()), dateiname: 'ls.png' });
  assert.equal(g.status, 201, JSON.stringify(g.daten));
  s.db.lauf("UPDATE bericht_foto SET art = 'lieferschein' WHERE id = ?", g.daten.id);
  // gleiches Bild durch den Polier: wie ein neues Bild (201, eigene Kopie) – kein 409, nicht die fremde ID
  const p = await pol.post(`/berichte/${bid}/fotos`, { bildBase64: b64(testPng()), dateiname: 'mein.png' });
  assert.equal(p.status, 201, JSON.stringify(p.daten));
  assert.notEqual(p.daten.id, g.daten.id);
  assert.equal(s.db.eins('SELECT erstellt_von FROM bericht_foto WHERE id = ?', p.daten.id).erstellt_von, U.polier);
  assert.ok(!JSON.stringify((await pol.get(`/berichte/${bid}`)).daten).includes(`/fotos/${g.daten.id}"`));
  // Höchstzahl: zehn fremde (verborgene) Lieferscheine zählen für den Polier nicht
  const roh = s.db.eins('SELECT * FROM bericht_foto WHERE id = ?', g.daten.id);
  for (let i = 0; i < 10; i++) s.db.lauf("INSERT INTO bericht_foto (bericht_id, art, datei, mime, groesse, sha256, erstellt, erstellt_von) VALUES (?, 'lieferschein', ?, ?, ?, ?, ?, ?)", bid, roh.datei, roh.mime, roh.groesse, crypto.randomBytes(32).toString('hex'), roh.erstellt, U.gf);
  const p2 = await pol.post(`/berichte/${bid}/fotos`, { bildBase64: b64(testJpeg()), dateiname: 'zwei.jpg' });
  assert.equal(p2.status, 201, JSON.stringify(p2.daten));
  // Gegenprobe: für die GF (sieht alle) gilt die Höchstzahl über alle
  const g2 = await gf.post(`/berichte/${bid}/fotos`, { bildBase64: b64(testWebp()), dateiname: 'x.webp' });
  assert.equal(g2.status, 400, JSON.stringify(g2.daten));
  assert.match(g2.daten.fehler, /Höchstens 10 Fotos/);

  // Fuhre: Fahrer = Mitarbeiter 2; Büro lädt einen Wiegeschein hoch
  const f = (await buero.post('/plan/fuhren', { datum: HEUTE, anlageId: 4, fahrerId: U.mitarbeiter, materialId: 4, menge: 10, einheit: 't', nach: { art: 'baustelle', baustelleId: BS.pitten } })).daten;
  assert.ok(f && f.id, JSON.stringify(f));
  assert.equal((await buero.post('/plan/veroeffentlichen', { von: HEUTE })).status, 200);
  const fremd = await buero.post(`/plan/fuhren/${f.id}/foto`, { bildBase64: b64(testPng()), dateiname: 'ws.png' });
  assert.equal(fremd.status, 201);
  const gleich = await ma.post(`/plan/fuhren/${f.id}/foto`, { bildBase64: b64(testPng()), dateiname: 'ws.png' });
  assert.equal(gleich.status, 201, `kein Zusammenführen mit dem fremden Foto: ${JSON.stringify(gleich.daten)}`);
  assert.notEqual(gleich.daten.id, fremd.daten.id);
  assert.equal((await ma.get(`/plan/fuhren/${f.id}/foto/${gleich.daten.id}`)).status, 200);
  // nochmal dasselbe Bild: jetzt das EIGENE Foto (sichtbar) – zusammengeführt
  const nochmal = await ma.post(`/plan/fuhren/${f.id}/foto`, { bildBase64: b64(testPng()), dateiname: 'ws.png' });
  assert.equal(nochmal.daten.id, gleich.daten.id);
  // Höchstzahl 5: fremde zählen nicht
  const fr = s.db.eins('SELECT * FROM plan_fuhre_foto WHERE id = ?', fremd.daten.id);
  for (let i = 0; i < 5; i++) s.db.lauf('INSERT INTO plan_fuhre_foto (fuhre_id, datei, mime, groesse, sha256, erstellt, erstellt_von) VALUES (?, ?, ?, ?, ?, ?, ?)', f.id, fr.datei, fr.mime, fr.groesse, crypto.randomBytes(32).toString('hex'), fr.erstellt, U.buero);
  const zwei = await ma.post(`/plan/fuhren/${f.id}/foto`, { bildBase64: b64(testJpeg()), dateiname: 'ls2.jpg' });
  assert.equal(zwei.status, 201, JSON.stringify(zwei.daten));
  // Gegenprobe Büro (sieht alle): Höchstzahl über alle Belege
  const b2 = await buero.post(`/plan/fuhren/${f.id}/foto`, { bildBase64: b64(testWebp()), dateiname: 'b.webp' });
  assert.equal(b2.status, 400, JSON.stringify(b2.daten));
  assert.match(b2.daten.fehler, /Höchstens 5 Fotos/);
});

test('G2-033: Push-Einstellung „Schäden“ wirkt für Schadensmeldungen (Schlüssel fp:mangel:<id>)', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  const { pushErlaubt, pushTyp } = require('../../server/push');
  const ma = await s.login(U.mitarbeiter), buero = await s.login(U.buero);
  const r = await ma.post('/fuhrpark/schaeden', { anlageId: 30, art: 'defekt', ursache: 'Hydraulikschlauch undicht', einsatzfaehig: 'eingeschraenkt' });
  assert.equal(r.status, 201, JSON.stringify(r.daten));
  const n = s.db.eins('SELECT * FROM benachrichtigung WHERE benutzer_id = ? AND schluessel = ?', U.buero, `fp:mangel:${r.daten.id}`);
  assert.ok(n, 'Büro bekommt die Schadensmeldung');
  assert.equal(pushTyp(n, s.db), 'schaden');
  assert.equal((await buero.put('/push/einstellungen', { typen: { schaden: false } })).status, 200);
  assert.equal(pushErlaubt(s.db, n.id), false, 'Schäden ausgeschaltet → kein Push');
  assert.equal((await buero.put('/push/einstellungen', { typen: { schaden: true, fuhrpark: false } })).status, 200);
  assert.equal(pushErlaubt(s.db, n.id), true, 'Schäden an, Fuhrpark aus → Push für den Schaden');
  // Stilllegen wegen Schaden („fp:mangel:<id>:nein“) ebenfalls Typ schaden; ein Mangel bleibt „fuhrpark“
  assert.equal(pushTyp({ typ: 'fuhrpark', schluessel: `fp:mangel:${r.daten.id}:nein` }, s.db), 'schaden');
  const mangel = s.db.eins("SELECT id FROM mangel WHERE typ = 'mangel' LIMIT 1");
  if (mangel) assert.equal(pushTyp({ typ: 'fuhrpark', schluessel: `fp:mangel:${mangel.id}` }, s.db), 'fuhrpark');
});

test('G2-022: Sperr-Meldung und 423-Text nennen je Kontostufe, wer wirklich entsperren kann', async (t) => {
  const s = await starte({ trustProxy: true, sitzung: LANG });
  t.after(() => s.stop());
  const gf = await s.login(U.gf, '1234', '10.0.0.1');
  const gf2 = (await gf.post('/benutzer', { name: 'Zweite Geschäftsführerin', rolle: 'gf', pin: '739154' })).daten;
  assert.ok(gf2 && gf2.id);
  let ipNr = 1;
  const sperre = async (id) => {
    let letzte;
    for (let i = 0; i < 25; i++) {
      letzte = await s.client(null, `198.51.${100 + Math.floor(ipNr / 250)}.${(ipNr++ % 250) + 1}`).post('/auth/login', { benutzerId: id, pin: '999999' });
      if (letzte.status === 423) break;
    }
    assert.equal(letzte.status, 423, `Konto ${id} gesperrt`);
    return (await s.client(null, '203.0.113.200').post('/auth/login', { benutzerId: id, pin: '1234' })).daten.fehler;
  };
  const meldungen = (empf, ziel) => s.db.alle("SELECT text FROM benachrichtigung WHERE benutzer_id = ? AND typ = 'sicherheit' AND titel = ?", empf, `Konto gesperrt: ${ziel}`).map((m) => m.text);
  const name = (id) => s.db.eins('SELECT name FROM benutzer WHERE id = ?', id).name;
  // Mitarbeiter: Büro, Bauleiter und GF können entsperren
  const tMa = await sperre(U.mitarbeiter);
  assert.match(tMa, /Büro, Bauleiter oder Geschäftsführung können es vorher entsperren/);
  for (const e of [U.buero, U.bauleiter, U.gf]) assert.match(meldungen(e, name(U.mitarbeiter)).join('|'), /ggf\. entsperren/, `Empfänger ${e}`);
  // Bauleiter (Stufe 2): nur die GF – Büro bekommt keine Aufforderung, die es nicht erfüllen kann
  const tBl = await sperre(U.bauleiter);
  assert.match(tBl, /Die Geschäftsführung kann es vorher entsperren/);
  assert.doesNotMatch(tBl, /Büro/);
  assert.equal(meldungen(U.buero, name(U.bauleiter)).length, 0, 'Büro: keine Entsperr-Aufforderung für den Bauleiter');
  for (const e of [U.gf, gf2.id]) assert.equal(meldungen(e, name(U.bauleiter)).length, 1, `GF ${e}`);
  // GF (Stufe 3): nur der Notfall-Befehl am Server; Meldung an die andere GF mit dem Befehl, nie an Büro/Bauleiter
  const tGf = await sperre(U.gf);
  assert.match(tGf, /Notfall-Befehl am Server \(node server\/entsperren\.js\)/);
  assert.doesNotMatch(tGf, /Büro|Geschäftsführung können/);
  for (const e of [U.buero, U.bauleiter]) assert.equal(meldungen(e, name(U.gf)).length, 0, `kein Hinweis an ${e}`);
  const m = meldungen(gf2.id, name(U.gf));
  assert.equal(m.length, 1);
  const pnr = s.db.eins('SELECT pnr FROM benutzer WHERE id = ?', U.gf).pnr;
  assert.match(m[0], new RegExp(`node server/entsperren\\.js ${pnr}`));
  assert.doesNotMatch(m[0], /ggf\. entsperren/);
  // das Büro kann den Bauleiter tatsächlich nicht entsperren (Gegenprobe zur Meldung)
  const buero = await s.login(U.buero, '1234', '10.0.0.2');
  assert.equal((await buero.post(`/benutzer/${U.bauleiter}/entsperren`)).status, 403);
});
