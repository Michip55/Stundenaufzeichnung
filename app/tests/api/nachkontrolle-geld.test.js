'use strict';
/**
 * API.md 15.15 – Nachkontrolle Geld/Texte (H-G1…H-G6). Je Befund ein Dauertest, der ohne die Korrektur fehlschlägt:
 * H-G1 (wiederverwendete rowid → Kennung verrät fremde Abwesenheiten), H-G2 (neuer Bericht als Orakel für „archiviert“),
 * H-G3 (Baustellen-Version verrät Geldschritte), H-G4 (Berichtsversion verrät verborgene Inhalte), H-G5 (Hinweis auf
 * Bankgarantie/Haftrücklass in der Oberfläche), H-G6 (Lohn-/Kalkulationsbegriffe in Fehlertexten).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { starte, U, BS } = require('./hilfe');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { chunk } = require('./fuhrpark-bilder');
const { wienDatum, plusTage } = require('../../server/datum');

const LANG = { feldMin: 60 * 24 * 60, bueroMin: 60 * 24 * 60, maxH: 24 * 60 };
const ALLE_AUSNAHMEN = ['kolonne', 'bericht_erstellen', 'bericht_freigeben', 'bericht_loeschen', 'fuhrpark']; // 15.34: auch bericht_loeschen
const b64 = (buf) => buf.toString('base64');
/** PNG (Graustufen) mit eindeutigem Pixelmuster je Startwert – verschiedene Belege, keine Zusammenführung */
function bild(start, kante = 40) {
  let x = crypto.createHash('sha256').update(`HG4-${start}`).digest();
  const roh = Buffer.alloc(kante * (kante + 1));
  for (let y = 0; y < kante; y++) {
    for (let i = 0; i < kante; i++) { if ((y * kante + i) % 32 === 0) x = crypto.createHash('sha256').update(x).digest(); roh[y * (kante + 1) + 1 + i] = x[(y * kante + i) % 32]; }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(kante, 0); ihdr.writeUInt32BE(kante, 4); ihdr[8] = 8;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(roh)), chunk('IEND', Buffer.alloc(0))]);
}

/** Polier und Mitarbeiter bekommen alle vergebbaren Ausnahmen (über die offizielle API) */
async function alleAusnahmen(gf) {
  for (const id of [U.polier, U.mitarbeiter]) {
    for (const recht of ALLE_AUSNAHMEN) {
      const r = await gf.put('/rechte/ausnahme', { benutzerId: id, recht, wert: true });
      assert.equal(r.status, 200, `${id}/${recht}: ${JSON.stringify(r.daten)}`);
    }
  }
}
/** Phasenwechsel durch die GF (mit aktueller Version) */
async function phase(s, gf, body) {
  const version = s.db.eins('SELECT version FROM baustelle WHERE id = ?', BS.pitten).version;
  const r = await gf.post(`/baustellen/${BS.pitten}/phase`, { version, ...body });
  assert.equal(r.status, 200, JSON.stringify(r.daten));
}
/** Arbeitstage ab `von` (Mo–Fr) */
function arbeitstage(von, n) {
  const l = [];
  for (let d = new Date(`${von}T12:00:00Z`); l.length < n; d = new Date(d.getTime() + 86400000)) if (![0, 6].includes(d.getUTCDay())) l.push(d.toISOString().slice(0, 10));
  return l;
}

/* ---------------------------------------------------------------- H-G1 ---------------------------------------------------------------- */

test('H-G1: öffentliche Kennung einer Abwesenheit hängt nicht an der (wiederverwendeten) Tabellen-ID – kein Wörterbuch-Rückschluss auf fremde Einträge', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  const ma = await s.login(U.mitarbeiter), buero = await s.login(U.buero), pol = await s.login(U.polier);
  // Probe ohne Zwischenereignis: anlegen, zurückziehen, neu anlegen → dieselbe rowid, aber eine neue Kennung
  const a1 = await ma.post('/abwesenheiten', { benutzerId: U.mitarbeiter, datum: '2027-01-04', code: 'ZA' });
  assert.equal(a1.status, 201, JSON.stringify(a1.daten));
  const rowid1 = s.db.eins("SELECT id FROM abwesenheit WHERE benutzer_id = ? AND datum = '2027-01-04'", U.mitarbeiter).id;
  assert.equal((await ma.del(`/abwesenheiten/${a1.daten.id}`)).status, 200);
  const a2 = await ma.post('/abwesenheiten', { benutzerId: U.mitarbeiter, datum: '2027-01-04', code: 'ZA' });
  assert.equal(a2.status, 201);
  const rowid2 = s.db.eins("SELECT id FROM abwesenheit WHERE benutzer_id = ? AND datum = '2027-01-04'", U.mitarbeiter).id;
  assert.equal(rowid2, rowid1, 'Vorbedingung: SQLite vergibt die gelöschte rowid neu');
  assert.match(a2.daten.id, /^p[0-9a-f]{20}$/);
  assert.notEqual(a2.daten.id, a1.daten.id, 'gleiche Kennung = „nichts dazwischen“ (Orakel)');
  assert.equal((await ma.del(`/abwesenheiten/${a2.daten.id}`)).status, 200);

  // Wörterbuch-Angriff: 12 eigene Tage anlegen, Kennungen merken, alle zurückziehen; Büro trägt 5 fremde Tage ein; neuer Tag
  for (const [c, uid] of [[ma, U.mitarbeiter], [pol, U.polier]]) {
    const tage = arbeitstage('2027-02-01', 12);
    const buch = [];
    for (const d of tage) {
      const r = await c.post('/abwesenheiten', { benutzerId: uid, datum: d, code: 'ZA' });
      assert.equal(r.status, 201, JSON.stringify(r.daten));
      buch.push(r.daten.id);
    }
    assert.equal(new Set(buch).size, buch.length);
    for (const k of [...buch].reverse()) assert.equal((await c.del(`/abwesenheiten/${k}`)).status, 200);
    const rowids = [];
    for (let i = 0; i < 5; i++) {
      const r = await buero.post('/abwesenheiten', { benutzerId: 9, datum: arbeitstage(uid === U.polier ? '2027-04-01' : '2027-03-01', 5)[i], code: 'K' });
      assert.equal(r.status, 201, JSON.stringify(r.daten));
      rowids.push(r.daten.id);
    }
    const neu = await c.post('/abwesenheiten', { benutzerId: uid, datum: '2027-05-03', code: 'ZA' });
    assert.equal(neu.status, 201);
    assert.ok(!buch.includes(neu.daten.id), `${uid}: neue Kennung steht im Wörterbuch (Index ${buch.indexOf(neu.daten.id)})`);
    // Kennungen der Liste/Anträge/Kalender: keine aus dem Wörterbuch, alle einheitlich und auflösbar
    const sicht = JSON.stringify([(await c.get('/abwesenheiten')).daten, (await c.get('/abwesenheiten/antraege')).daten, (await c.get('/urlaub/kalender?von=2027-05-03&bis=2027-05-03')).daten]);
    for (const k of buch) assert.ok(!sicht.includes(k), `${uid}: alte Kennung ${k} taucht wieder auf`);
    assert.equal((await c.get('/abwesenheiten')).daten.find((a) => a.datum === '2027-05-03').id, neu.daten.id, 'stabil je Eintrag');
    assert.equal((await c.del(`/abwesenheiten/${neu.daten.id}`)).status, 200, 'auflösbar (eigener Eintrag)');
  }

  // Bestandsantrag ohne antrag_id („x…“): gleiche rowid nach Löschen → neue Antrags-Kennung
  const ein = () => s.db.lauf("INSERT INTO abwesenheit (benutzer_id, datum, code, status, erfasst_von, erfasst) VALUES (?, '2027-06-07', 'U', 'beantragt', ?, '2026-11-01T08:00:00Z')", U.mitarbeiter, U.mitarbeiter).id;
  const id1 = ein();
  const x1 = (await ma.get('/abwesenheiten/antraege')).daten.find((a) => a.von === '2027-06-07').antragId;
  assert.match(x1, /^x[0-9a-f]{20}$/);
  assert.equal((await ma.del(`/abwesenheiten/antraege/${x1}`)).status, 200);
  const id2 = ein();
  assert.equal(id2, id1, 'Vorbedingung: rowid wiederverwendet');
  const x2 = (await ma.get('/abwesenheiten/antraege')).daten.find((a) => a.von === '2027-06-07').antragId;
  assert.notEqual(x2, x1);
  // jede Zeile hat ihren Zufallswert (Trigger – gleich, welcher Code einfügt)
  assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM abwesenheit WHERE oeffentlich IS NULL').n, 0);
  assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM (SELECT oeffentlich FROM abwesenheit GROUP BY oeffentlich HAVING COUNT(*) > 1)').n, 0);
  // Büro behält die Tabellen-IDs
  assert.equal(typeof (await buero.get(`/abwesenheiten?benutzerId=${U.mitarbeiter}`)).daten[0].id, 'number');
});

/* ---------------------------------------------------------------- H-G2 ---------------------------------------------------------------- */

test('H-G2: neuer Bericht vor der Abnahme – gleiche Antwort für Schlussrechnung, Bezahlt und Archiviert (kein Orakel für „archiviert“)', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  const gf = await s.login(U.gf), buero = await s.login(U.buero);
  await alleAusnahmen(gf);
  const pol = await s.login(U.polier), ma = await s.login(U.mitarbeiter);
  const heute = wienDatum(s.uhr());
  await phase(s, gf, { phase: 'fertiggestellt', datum: plusTage(heute, -20) });
  await phase(s, gf, { phase: 'abgenommen', datum: plusTage(heute, -18), abnahmeDatum: plusTage(heute, -18) });
  const PROBE = plusTage(heute, -25); // vor der Fertigstellung
  const probe = async (c) => {
    s.db.lauf('DELETE FROM bericht WHERE baustelle_id = ? AND datum = ?', BS.pitten, PROBE);
    const r = await c.post('/berichte', { baustelleId: BS.pitten, datum: PROBE });
    const sicht = (await c.get(`/baustellen/${BS.pitten}`)).daten;
    return { status: r.status, fehler: r.daten.fehler || null, sicht: JSON.stringify(sicht) };
  };
  const ergebnis = {};
  for (const [ziel, body] of [['schlussrechnung', { datum: plusTage(heute, -10) }], ['bezahlt', { datum: plusTage(heute, -5) }], ['archiviert', {}]]) {
    await phase(s, gf, { phase: ziel, ...body });
    ergebnis[ziel] = { polier: await probe(pol), mitarbeiter: await probe(ma) };
  }
  for (const wer of ['polier', 'mitarbeiter']) {
    assert.equal(ergebnis.schlussrechnung[wer].status, 201, `${wer}: ${JSON.stringify(ergebnis.schlussrechnung[wer])}`);
    assert.deepEqual(ergebnis.bezahlt[wer], ergebnis.schlussrechnung[wer], `${wer}: Bezahlt ≠ Schlussrechnung`);
    assert.deepEqual(ergebnis.archiviert[wer], ergebnis.schlussrechnung[wer], `${wer}: Archiviert ≠ Schlussrechnung`);
  }
  // Tage nach der letzten Bauphase bleiben für alle drei Phasen gleich gesperrt (neutraler Text)
  const spaet = await pol.post('/berichte', { baustelleId: BS.pitten, datum: plusTage(heute, -1) });
  assert.equal(spaet.status, 400);
  assert.match(spaet.daten.fehler, /abgeschlossen \(Abgeschlossen\)/);
  // Mit Zahlungsstand unverändert: im Archiv kein neuer Bericht
  s.db.lauf('DELETE FROM bericht WHERE baustelle_id = ? AND datum = ?', BS.pitten, PROBE);
  const b = await buero.post('/berichte', { baustelleId: BS.pitten, datum: PROBE });
  assert.equal(b.status, 400);
  assert.match(b.daten.fehler, /Archiviert/);
  // Storniert (auch archiviert storniert) bleibt für alle gesperrt
  s.db.lauf("UPDATE baustelle SET phase = 'storniert', status = 'abgeschlossen' WHERE id = ?", BS.reisinger);
  s.db.lauf('UPDATE benutzer SET baustelle_id = ? WHERE id = ?', BS.reisinger, U.mitarbeiter);
  s.db.lauf('UPDATE baustelle SET polier_id = ? WHERE id = ?', U.polier, BS.reisinger);
  assert.equal((await pol.post('/berichte', { baustelleId: BS.reisinger, datum: PROBE })).status, 400);
});

/* ---------------------------------------------------------------- H-G3 ---------------------------------------------------------------- */

test('H-G3: Baustellen-JSON für Polier/Mitarbeiter bleibt über verborgene Geldschritte Byte für Byte gleich (kein Bearbeitungszähler); Büro behält die Sperre', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  const gf = await s.login(U.gf), buero = await s.login(U.buero);
  await alleAusnahmen(gf);
  const pol = await s.login(U.polier), ma = await s.login(U.mitarbeiter);
  const heute = wienDatum(s.uhr());
  await phase(s, gf, { phase: 'fertiggestellt', datum: plusTage(heute, -20) });
  await phase(s, gf, { phase: 'abgenommen', datum: plusTage(heute, -18), abnahmeDatum: plusTage(heute, -18) });
  const sicht = async () => {
    const o = {};
    for (const [wer, c] of [['polier', pol], ['mitarbeiter', ma]]) {
      const d = await c.get(`/baustellen/${BS.pitten}`);
      assert.equal(d.status, 200, wer);
      assert.ok(!('version' in d.daten), `${wer}: version in ${JSON.stringify(d.daten)}`);
      const l = (await c.get('/baustellen?archiv=1')).daten.find((b) => b.id === BS.pitten) || null;
      if (l) assert.ok(!('version' in l), `${wer}: version in der Archivliste`);
      o[wer] = JSON.stringify([d.daten, l, (await c.get('/baustellen?alle=1')).daten.find((b) => b.id === BS.pitten) || null]);
    }
    return o;
  };
  await phase(s, gf, { phase: 'schlussrechnung', datum: plusTage(heute, -10), schlussrechnung: { nr: 'SR-HG3', betrag: 4711.11 } });
  const s0 = await sicht();
  await phase(s, gf, { phase: 'bezahlt', datum: plusTage(heute, -5) });
  assert.deepEqual(await sicht(), s0, 'nach „Bezahlt“');
  const bv = (await gf.get(`/baustellen/${BS.pitten}`)).daten.version;
  const hr = await gf.put(`/baustellen/${BS.pitten}/abschluss`, { version: bv, haftruecklass: { betrag: 1234.5, prozent: 3 } });
  assert.equal(hr.status, 200, JSON.stringify(hr.daten));
  assert.deepEqual(await sicht(), s0, 'nach Haftrücklass');
  const au = await gf.put(`/baustellen/${BS.pitten}/auftrag`, { version: (await gf.get(`/baustellen/${BS.pitten}`)).daten.version, auftragssumme: 99999 });
  assert.equal(au.status, 200, JSON.stringify(au.daten));
  assert.deepEqual(await sicht(), s0, 'nach Auftragssumme');
  await phase(s, gf, { phase: 'archiviert' });
  assert.deepEqual(await sicht(), s0, 'nach „Archiviert“');
  // Büro/Bauleiter (stammdaten): Version vorhanden, veraltete Version → 409
  const bb = await s.login(U.bauleiter);
  for (const c of [buero, bb]) {
    const d = (await c.get(`/baustellen/${BS.reisinger}`)).daten;
    assert.equal(typeof d.version, 'number');
    assert.equal((await c.put(`/baustellen/${BS.reisinger}`, { version: d.version, kurz: `Reisinger ${d.version}` })).status, 200);
    const alt = await c.put(`/baustellen/${BS.reisinger}`, { version: d.version, kurz: 'veraltet' });
    assert.equal(alt.status, 409, JSON.stringify(alt.daten));
    assert.equal(alt.daten.version, d.version + 1);
  }
});

/* ---------------------------------------------------------------- H-G4 ---------------------------------------------------------------- */

test('H-G4: Berichtsversion und Änderungszeit für Polier/Mitarbeiter nur aus sichtbaren Inhalten; Büro erkennt weiter jede Änderung', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  const gf = await s.login(U.gf), buero = await s.login(U.buero);
  await alleAusnahmen(gf);
  const pol = await s.login(U.polier), ma = await s.login(U.mitarbeiter);
  const TAG = '2026-11-08';
  const neu = await pol.post('/berichte', { baustelleId: BS.pitten, datum: TAG });
  assert.equal(neu.status, 201, JSON.stringify(neu.daten));
  const id = neu.daten.id;
  const lese = async (c) => {
    const d = (await c.get(`/berichte/${id}`)).daten;
    const l = (await c.get(`/berichte?baustelleId=${BS.pitten}`)).daten.find((x) => x.id === id);
    return { d, l, text: JSON.stringify([d, l]) };
  };
  const p0 = await lese(pol), m0 = await lese(ma);
  const bueroVersion = async () => (await buero.get(`/berichte/${id}`)).daten.version;
  // (a) Büro trägt für Person 4 nur U ein (für Polier/Mitarbeiter verborgene Zeile)
  const bd = (await buero.get(`/berichte/${id}`)).daten;
  const personal = bd.personal.filter((p) => p.benutzerId !== 4).map((p) => ({ benutzerId: p.benutzerId, von1: p.von1, bis1: p.bis1, von2: p.von2, bis2: p.bis2, pauseMin: p.pauseMin, code: p.code, gast: p.gast }));
  const rb = await buero.put(`/berichte/${id}`, { version: bd.version, personal: [...personal, { benutzerId: 4, code: 'U' }] });
  assert.equal(rb.status, 200, JSON.stringify(rb.daten));
  assert.equal(rb.daten.version, bd.version + 1, 'Büro: Tabellenversion steigt');
  // (b) GF lädt einen Lieferschein hoch, ändert seine Beschreibung und löscht ihn wieder (fremder Beleg)
  const ls = await gf.post(`/berichte/${id}/lieferschein`, { bildBase64: b64(bild(1)), dateiname: 'ls.png', beschreibung: 'Kies' });
  assert.equal(ls.status, 201, JSON.stringify(ls.daten));
  const lsId = ls.daten.foto ? ls.daten.foto.id : ls.daten.id;
  assert.equal((await gf.put(`/berichte/${id}/fotos/${lsId}`, { beschreibung: 'Kies 16/32' })).status, 200);
  const ls2 = await gf.post(`/berichte/${id}/lieferschein`, { bildBase64: b64(bild(5)), dateiname: 'ls2.png' });
  assert.equal(ls2.status, 201, JSON.stringify(ls2.daten));
  const p1 = await lese(pol), m1 = await lese(ma);
  assert.equal(p1.text, p0.text, 'Polier: Antwort unverändert (auch version/geaendert)');
  assert.equal(m1.text, m0.text, 'Mitarbeiter: Antwort unverändert');
  const bv = await bueroVersion();
  assert.ok(bv >= bd.version + 4, `Büro sieht jede Änderung (${bv})`);
  // Speichern mit der gesehenen Version klappt – kein 409 ohne sichtbare Änderung
  const ps = await pol.put(`/berichte/${id}`, { version: p1.d.version, arbeitsleistung: 'Planum hergestellt' });
  assert.equal(ps.status, 200, JSON.stringify(ps.daten));
  assert.equal(ps.daten.version, p1.d.version + 1, 'sichtbare Änderung: genau +1');
  assert.equal(s.db.eins('SELECT code FROM bericht_personal WHERE bericht_id = ? AND benutzer_id = 4', id).code, 'U', 'verborgene Zeile bleibt');
  // (c) Konflikterkennung bleibt: Büro ändert sichtbar → veralteter Stand des Poliers → 409 mit seiner Sichtversion
  const bd2 = (await buero.get(`/berichte/${id}`)).daten;
  assert.equal(bd2.version, bv + 1);
  assert.equal((await buero.put(`/berichte/${id}`, { version: bd2.version, vorkommnisse: 'Leitung gefunden' })).status, 200);
  const k = await pol.put(`/berichte/${id}`, { version: ps.daten.version, arbeitsleistung: 'veraltet' });
  assert.equal(k.status, 409, JSON.stringify(k.daten));
  assert.equal(k.daten.version, ps.daten.version + 1, 'Sichtversion in der 409');
  assert.equal((await pol.get(`/berichte/${id}`)).daten.version, ps.daten.version + 1);
  // Büro: veraltete Tabellenversion → 409 (auch bei einer für Polier verborgenen Änderung)
  const vorB = (await buero.get(`/berichte/${id}`)).daten.version;
  const ls3 = await gf.post(`/berichte/${id}/lieferschein`, { bildBase64: b64(bild(9)), dateiname: 'ls3.png' });
  assert.equal(ls3.status, 201);
  const kb = await buero.put(`/berichte/${id}`, { version: vorB, vorkommnisse: 'x' });
  assert.equal(kb.status, 409, 'Büro: verborgene Änderung wird als Konflikt erkannt');
  assert.equal(kb.daten.version, vorB + 1);
  // (d) mehrere verborgene Änderungen zwischen zwei sichtbaren: Sprung immer genau 1
  const vP = (await pol.get(`/berichte/${id}`)).daten.version;
  for (let i = 0; i < 3; i++) {
    const b = (await buero.get(`/berichte/${id}`)).daten;
    const z = b.personal.filter((p) => p.benutzerId !== 4).map((p) => ({ benutzerId: p.benutzerId, von1: p.von1, bis1: p.bis1, von2: p.von2, bis2: p.bis2, pauseMin: p.pauseMin, code: p.code, gast: p.gast }));
    assert.equal((await buero.put(`/berichte/${id}`, { version: b.version, personal: [...z, { benutzerId: 4, code: ['K', 'ZA', 'U'][i] }] })).status, 200);
  }
  assert.equal((await pol.get(`/berichte/${id}`)).daten.version, vP, 'drei verborgene Code-Änderungen: kein Sprung');
  const b5 = (await buero.get(`/berichte/${id}`)).daten;
  assert.equal((await buero.put(`/berichte/${id}`, { version: b5.version, vorkommnisse: 'sichtbar' })).status, 200);
  assert.equal((await pol.get(`/berichte/${id}`)).daten.version, vP + 1);
  // (e) eigener Lieferschein (N-112): der Polier sieht ihn – seine Version steigt; der Mitarbeiter sieht ihn nicht – seine nicht
  const vorP = await lese(pol), vorM = await lese(ma);
  const eigen = await pol.post(`/berichte/${id}/lieferschein`, { bildBase64: b64(bild(13)), dateiname: 'eigen.png' });
  assert.equal(eigen.status, 201, JSON.stringify(eigen.daten));
  const nachP = await lese(pol);
  assert.equal(nachP.d.version, vorP.d.version + 1, 'Polier: eigener Beleg sichtbar → +1');
  assert.equal(eigen.daten.berichtVersion, nachP.d.version, 'berichtVersion der Anhang-Antwort = Sichtversion');
  assert.equal((await lese(ma)).text, vorM.text, 'Mitarbeiter: fremder Beleg verborgen → unverändert');
  // Mitarbeiter speichert mit seiner Version ohne Konflikt
  assert.equal((await ma.put(`/berichte/${id}`, { version: vorM.d.version, regie: [{ text: 'Regie', stunden: 1 }] })).status, 200);
});

test('H-G4: jede Stelle, die bericht.version erhöht, führt den Sichtstand nach; die Prüfsumme deckt alle sichtbaren Felder von berichtJson', async (t) => {
  const SERVER = path.join(__dirname, '..', '..', 'server');
  const dateien = [];
  const sammle = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) sammle(p); else if (f.name.endsWith('.js')) dateien.push(p); } };
  sammle(SERVER);
  const ohne = [];
  for (const f of dateien) {
    if (/schema\.js$|seed\.js$/.test(f)) continue;
    const zeilen = fs.readFileSync(f, 'utf8').split('\n');
    zeilen.forEach((z, i) => {
      if (!/UPDATE bericht SET[^']*version = version \+ 1/.test(z)) return;
      const danach = zeilen.slice(i, i + 4).join('\n');
      if (!/nachfuehren\(/.test(danach)) ohne.push(`${path.relative(SERVER, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(ohne, [], 'Versionssprung ohne S.nachfuehren');
  // Drift-Schutz: jedes Feld der Polier-Antwort ist entweder in der Prüfsumme (server/berichtsicht.js) oder abgeleitet/flüchtig
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  const pol = await s.login(U.polier);
  const b = (await pol.post('/berichte', { baustelleId: BS.pitten, datum: '2026-11-08' })).daten;
  const IN_PRUEFSUMME = ['datum', 'baustelleId', 'status', 'personal', 'seg', 'geraete', 'material', 'arbeitsleistung', 'materialbeistellung', 'paletten', 'regie', 'vorkommnisse', 'wetter', 'unterschriften', 'freigabe', 'erstellt', 'geaendertNachUnterschrift', 'selbstfreigabe', 'fotos'];
  // abgeleitet aus den obigen bzw. nicht Inhalt des Berichts (Stand, Vorschläge, Stammdaten der Baustelle, Rechte des Aufrufers)
  const ABGELEITET = ['id', 'baustelle', 'gesamtstunden', 'version', 'geaendert', 'bearbeitbar', 'freigabeVierAugen', 'anlagenVorschlag', 'wetterVorschlag', 'emailVersand', 'fuhrenVorschlag'];
  const fremd = Object.keys(b).filter((k) => !IN_PRUEFSUMME.includes(k) && !ABGELEITET.includes(k));
  assert.deepEqual(fremd, [], 'neues Feld in berichtJson – in server/berichtsicht.js (pruefsumme) aufnehmen oder hier begründen');
});

/* ---------------------------------------------------------------- H-G5 ---------------------------------------------------------------- */

test('H-G5: Abschluss-Karte nennt Erinnerungen nur, die der Aufrufer bekommt – Polier/Mitarbeiter ohne Bankgarantie/Haftrücklass', async () => {
  const L = await import(pathToFileURL(path.join(__dirname, '..', '..', 'public', 'js', 'views', 'lebenslauf.js')).href);
  const ctx = (rechte) => ({ kann: (r) => rechte.includes(r), benutzer: { rolle: 'x' } });
  const b = { phase: 'abgeschlossen', abnahmeDatum: '2026-10-01', gewaehrleistungBis: '2029-10-01' };
  const sichtbar = (html) => html.replace(/<[^>]+>/g, ' ');
  for (const rechte of [[], ['kolonne', 'bericht_erstellen', 'bericht_freigeben', 'fuhrpark', 'zeit_eigen']]) {
    const t = sichtbar(L.abschlussHtml(b, ctx(rechte)));
    assert.ok(/Gewährleistung bis/.test(t), 'Karte wird gezeigt');
    assert.ok(!/Bankgarantie|Haftrücklass|Erinnerungen/.test(t), `ohne Rechte (${rechte}): ${t}`);
  }
  const st = sichtbar(L.abschlussHtml(b, ctx(['stammdaten'])));
  assert.ok(/Erinnerungen kommen automatisch in der App: 3 Monate vor Ende der Gewährleistung\./.test(st), st);
  assert.ok(!/Bankgarantie|Haftrücklass/.test(st));
  const voll = sichtbar(L.abschlussHtml({ ...b, phase: 'bezahlt' }, ctx(['stammdaten', 'preise_sehen'])));
  assert.ok(/Gewährleistung, 30 Tage vor Ablauf der Bankgarantie, bei möglicher Freigabe des Haftrücklasses\./.test(voll), voll);
});

/* ---------------------------------------------------------------- H-G6 ---------------------------------------------------------------- */

test('H-G6: Fehlertexte an Polier/Mitarbeiter ohne Lohn-/Kalkulationsbegriffe (auch mit allen Ausnahmen)', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  await alleAusnahmen(gf);
  const pol = await s.login(U.polier), ma = await s.login(U.mitarbeiter);
  const VERBOTEN = /Lohngruppe|Lohnsatz|Stundenlohn|Kalkulation|kalk_|Budget|[a-zäöüß]kosten\b|\bKosten\b|Bankgarantie|Rücklass|Preis|preise_|€|Rechnung|Angebot/i;
  const pfade = [
    ['GET', `/benutzer/${U.gf}/lohngruppen-verlauf`], ['GET', `/benutzer/${U.mitarbeiter}/lohngruppen-verlauf`], ['GET', '/benutzer/99999/lohngruppen-verlauf'],
    ['GET', `/baustellen/${BS.pitten}/positionen`], ['GET', `/kalkulation/${BS.pitten}`], ['GET', '/stammdaten/lohngruppen'], ['GET', '/stammdaten/unbekannt'],
    ['PUT', '/stammdaten/lohngruppen/1'], ['GET', `/baustellen/${BS.pitten}/rechnungen`]
  ];
  for (const [wer, c] of [['Polier', pol], ['Mitarbeiter', ma]]) {
    for (const [m, p] of pfade) {
      const r = await c.anfrage(m, p, m === 'GET' ? undefined : {});
      assert.ok(r.status >= 400, `${wer} ${m} ${p}: ${r.status}`);
      const txt = JSON.stringify(r.daten);
      assert.ok(!VERBOTEN.test(txt), `${wer} ${m} ${p}: ${txt}`);
    }
  }
  // gleiche Antwort für vorhandene und nicht vorhandene Person (kein Orakel)
  assert.deepEqual((await ma.get(`/benutzer/${U.gf}/lohngruppen-verlauf`)).daten, (await ma.get('/benutzer/99999/lohngruppen-verlauf')).daten);
  // Sicherheitsnetz kennt die neuen Wörter
  const { enthaeltGeld } = require('../../server/fehler');
  for (const w of ['Die Lohngruppe ist vertraulich.', 'Die Nachkalkulation sieht …', 'Budget-Alarme', 'Gerätekosten', 'Bankgarantie', 'Angebot']) assert.ok(enthaeltGeld(w), w);
  assert.ok(!enthaeltGeld('Kostenstelle 26-041'), 'Kostenstelle ist kein Geldwort');
});
