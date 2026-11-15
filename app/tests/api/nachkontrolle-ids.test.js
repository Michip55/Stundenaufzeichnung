'use strict';
/**
 * API.md 15.15 (ID-Nachtrag, Inhaberregel 3): Tabellen-IDs, die Polier/Mitarbeiter sehen, verraten nicht, wie viele Einträge
 * andere Personen dazwischen angelegt haben. Neue Zeilen tragen eine Zeit-ID (server/db.js): sie hängt nur vom Zeitpunkt ab.
 * Lücken-/Wörterbuch-Angriff: zwei eigene Einträge mit k fremden Einträgen dazwischen → dieselbe Lücke für k = 0 und k = 5.
 * Die Test-Uhr steht (hilfe.starte); jeder Schritt läuft wie im Betrieb zu einem eigenen Zeitpunkt (uhr.plus).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { starte, U, BS } = require('./hilfe');
const { chunk } = require('./fuhrpark-bilder');

const LANG = { feldMin: 60 * 24 * 60, bueroMin: 60 * 24 * 60, maxH: 24 * 60 };
const EPOCHE_US = Date.UTC(2020, 0, 1) * 1000;
/** erwartete Zeit-ID zum aktuellen Stand der Test-Uhr (ms × 1000 seit 2020) */
const zeitId = (s) => s.uhr().getTime() * 1000 - EPOCHE_US;
function bild(start, kante = 24) {
  let x = crypto.createHash('sha256').update(`ID-${start}`).digest();
  const roh = Buffer.alloc(kante * (kante + 1));
  for (let y = 0; y < kante; y++) for (let i = 0; i < kante; i++) { if ((y * kante + i) % 32 === 0) x = crypto.createHash('sha256').update(x).digest(); roh[y * (kante + 1) + 1 + i] = x[(y * kante + i) % 32]; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(kante, 0); ihdr.writeUInt32BE(kante, 4); ihdr[8] = 8;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(roh)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

/**
 * Ein Durchlauf mit k fremden Vorgängen zwischen zwei eigenen. Liefert die IDs, die Polier/Mitarbeiter selbst sehen:
 * eigene Benachrichtigungen (Antrag entschieden), eigene Berichte, eigene Berichtsfotos, eigene Stempelungen.
 */
async function durchlauf(k) {
  const s = await starte({ test: true, sitzung: LANG });
  try {
    const ma = await s.login(U.mitarbeiter), pol = await s.login(U.polier), pol2 = await s.login(U.polier2), buero = await s.login(U.buero);
    const schritt = () => s.uhr.plus(1);
    const eigeneMeldung = async (datum) => {
      schritt();
      const a = await ma.post('/abwesenheiten', { benutzerId: U.mitarbeiter, datum, code: 'ZA' });
      assert.equal(a.status, 201, JSON.stringify(a.daten));
      const tab = s.db.eins('SELECT id FROM abwesenheit WHERE benutzer_id = ? AND datum = ?', U.mitarbeiter, datum).id;
      schritt();
      assert.equal((await buero.put(`/abwesenheiten/${tab}`, { status: 'genehmigt' })).status, 200);
      const l = (await ma.get('/benachrichtigungen')).daten;
      return l.find((n) => n.typ === 'abwesenheit' && /genehmigt/.test(n.titel) && n.text.includes(datum.split('-').reverse().join('.'))).id;
    };
    const eigenerBericht = async (datum) => { schritt(); const r = await pol.post('/berichte', { baustelleId: BS.pitten, datum }); assert.equal(r.status, 201, JSON.stringify(r.daten)); return r.daten.id; };
    const eigenesFoto = async (bid, n) => { schritt(); const r = await pol.post(`/berichte/${bid}/fotos`, { bildBase64: bild(`p${n}`), dateiname: 'f.png' }); assert.equal(r.status, 201, JSON.stringify(r.daten)); return r.daten.id; };
    const stempel = async (typ) => { schritt(); assert.equal((await ma.post('/zeit/stempeln', { typ, baustelleId: BS.pitten })).status, 200); return (await ma.get('/zeit/buchungen')).daten.map((b) => b.id).sort((x, y) => y - x)[0]; };

    const vorher = { meldung: await eigeneMeldung('2027-01-11'), bericht: await eigenerBericht('2026-11-07'), stempel: await stempel('kommen') };
    vorher.foto = await eigenesFoto(vorher.bericht, 1);
    vorher.zeit = zeitId(s);
    // k fremde Vorgänge (Anträge anderer → Benachrichtigungen an Büro/GF, fremde Berichte und Fotos, fremde Stempelungen)
    for (let i = 0; i < k; i++) {
      schritt();
      assert.equal((await pol2.post('/abwesenheiten', { benutzerId: U.polier2, datum: `2027-02-0${i + 1}`, code: 'U' })).status, 201);
      schritt();
      const fb = await buero.post('/berichte', { baustelleId: BS.reisinger, datum: `2026-06-0${i + 1}` });
      assert.equal(fb.status, 201, JSON.stringify(fb.daten));
      assert.equal((await buero.post(`/berichte/${fb.daten.id}/fotos`, { bildBase64: bild(`b${i}`), dateiname: 'f.png' })).status, 201);
      schritt();
      let st = await pol2.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.reisinger });
      if (st.status === 409) st = await pol2.post('/zeit/stempeln', { typ: 'gehen', baustelleId: BS.reisinger });
      assert.equal(st.status, 200, JSON.stringify(st.daten));
    }
    // gleicher zeitlicher Abstand wie mit k = 5 (3 Schritte je Vorgang)
    s.uhr.plus(3 * (5 - k));
    const nachher = { meldung: await eigeneMeldung('2027-03-08'), bericht: await eigenerBericht('2026-11-08'), stempel: await stempel('gehen') };
    nachher.foto = await eigenesFoto(nachher.bericht, 2);
    return { vorher, nachher, fremd: s.db.eins("SELECT COUNT(*) AS n FROM benachrichtigung WHERE benutzer_id <> ?", U.mitarbeiter).n };
  } finally { await s.stop(); }
}

test('ID-Nachtrag: Lücke zwischen zwei eigenen IDs (Benachrichtigung, Bericht, Foto, Stempelung) unabhängig von der Zahl fremder Einträge', async () => {
  const ohne = await durchlauf(0), mit = await durchlauf(5);
  assert.ok(mit.fremd > ohne.fremd, 'Vorbedingung: fremde Benachrichtigungen dazwischen');
  for (const art of ['meldung', 'bericht', 'foto', 'stempel']) {
    const l0 = ohne.nachher[art] - ohne.vorher[art], l5 = mit.nachher[art] - mit.vorher[art];
    assert.equal(l5, l0, `${art}: Lücke ${l0} (k = 0) ≠ ${l5} (k = 5) – die ID verrät fremde Einträge`);
    assert.ok(Number.isSafeInteger(mit.nachher[art]) && mit.nachher[art] > 1e14, `${art}: Zeit-ID erwartet (${mit.nachher[art]})`);
  }
});

test('ID-Nachtrag: neue Zeilen tragen die Zeit-ID (alle Tabellen mit id außer abwesenheit); IDs bleiben monoton; Pfad-IDs mit 15 Stellen gehen', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  const db = s.db;
  const tabellen = db.alle("SELECT name FROM sqlite_master WHERE type = 'table'").map((x) => x.name).filter((n) => db.hatIdSpalte(n));
  assert.ok(tabellen.length > 30);
  for (const n of tabellen) {
    const u = db.mitZeitId(`INSERT INTO ${n} (x) VALUES (?)`);
    if (n === 'abwesenheit') assert.equal(u, null, 'abwesenheit: eigene zufällige Kennungen (H-G1)');
    else assert.ok(u && u.sql.startsWith(`INSERT INTO ${n} (id, x) VALUES (?, `), n);
  }
  assert.equal(db.mitZeitId('INSERT INTO buchung (id, benutzer_id) VALUES (?, ?)'), null, 'ausdrückliche id bleibt');
  // jede INSERT-Anweisung im Server-Code hat die einzeilige Form, die umgeschrieben wird
  const SERVER = path.join(__dirname, '..', '..', 'server');
  const nicht = [];
  for (const f of fs.readdirSync(SERVER, { recursive: true }).filter((x) => x.endsWith('.js') && !/schema\.js$/.test(x))) {
    const text = fs.readFileSync(path.join(SERVER, f), 'utf8');
    for (const m of text.matchAll(/(['`])(\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)[^'`]*)\1/g)) {
      if (m[2].includes('${') || !tabellen.includes(m[3]) || m[3] === 'abwesenheit' || /\(\s*id\s*,/.test(m[2])) continue;
      if (!db.mitZeitId(m[2])) nicht.push(`${f}: ${m[2].slice(0, 80)}`);
    }
  }
  assert.deepEqual(nicht, [], 'INSERT ohne Zeit-ID');
  // monoton und an die Uhr gebunden; ohne Uhrfortschritt größte ID + 1
  s.uhr.plus(1);
  const a = db.lauf("INSERT INTO protokoll (zeit, art, text) VALUES (?, 'x', 'a')", s.uhr().toISOString()).id;
  assert.equal(a, zeitId(s));
  const b = db.lauf("INSERT INTO protokoll (zeit, art, text) VALUES (?, 'x', 'b')", s.uhr().toISOString()).id;
  assert.equal(b, a + 1);
  s.uhr.plus(-60);
  assert.equal(db.lauf("INSERT INTO protokoll (zeit, art, text) VALUES (?, 'x', 'c')", s.uhr().toISOString()).id, b + 1, 'Uhr zurück: weiter aufsteigend');
  // Pfad mit Zeit-ID (15 Stellen) – Polier liest seinen neuen Bericht, Foto und Foto-Datei
  s.uhr.plus(120);
  const pol = await s.login(U.polier);
  const ber = await pol.post('/berichte', { baustelleId: BS.pitten, datum: '2026-11-01' });
  assert.equal(ber.status, 201);
  assert.ok(String(ber.daten.id).length >= 15, String(ber.daten.id));
  assert.equal((await pol.get(`/berichte/${ber.daten.id}`)).status, 200);
  const foto = await pol.post(`/berichte/${ber.daten.id}/fotos`, { bildBase64: bild('x'), dateiname: 'x.png' });
  assert.equal(foto.status, 201);
  assert.equal((await pol.get(foto.daten.url.replace(/^\/api/, ''))).status, 200);
  assert.equal((await pol.get('/berichte/99999999999999999')).status, 400, 'über der größten exakten Ganzzahl: ungültig');
});

test('ID-Nachtrag: Servicebuch-Eintrag – reine Kosten-/Rechnungsnummer-Änderung erhöht die Version für Polier/Mitarbeiter mit Ausnahme fuhrpark nicht; Büro behält die Sperre', async (t) => {
  const s = await starte({ test: true, sitzung: LANG });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  for (const id of [U.polier, U.mitarbeiter]) assert.equal((await gf.put('/rechte/ausnahme', { benutzerId: id, recht: 'fuhrpark', wert: true })).status, 200);
  const pol = await s.login(U.polier), ma = await s.login(U.mitarbeiter);
  const eid = s.db.eins('SELECT id FROM servicebuch_eintrag WHERE storniert IS NULL ORDER BY id LIMIT 1').id;
  const lies = async (c) => { const r = await c.get(`/fuhrpark/eintraege/${eid}`); assert.equal(r.status, 200, JSON.stringify(r.daten)); return r.daten; };
  const p0 = await lies(pol), m0 = await lies(ma);
  assert.ok(!('kosten' in p0) && !('rechnungNr' in p0));
  const g0 = await lies(gf);
  assert.equal((await gf.put(`/fuhrpark/eintraege/${eid}`, { version: g0.version, kosten: 4711.11 })).status, 200);
  const g1 = await lies(gf);
  assert.equal((await gf.put(`/fuhrpark/eintraege/${eid}`, { version: g1.version, rechnungNr: 'RE-ID-1' })).status, 200);
  assert.deepEqual(await lies(pol), p0, 'Polier: Antwort unverändert');
  assert.deepEqual(await lies(ma), m0, 'Mitarbeiter: Antwort unverändert');
  assert.equal((await lies(gf)).version, g0.version + 2, 'Büro/GF: Tabellenversion steigt');
  // Polier speichert mit seiner Version; danach sieht die GF die Änderung als neue Version
  const ps = await pol.put(`/fuhrpark/eintraege/${eid}`, { version: p0.version, titel: 'Ölwechsel (Polier)' });
  assert.equal(ps.status, 200, JSON.stringify(ps.daten));
  assert.equal(ps.daten.version, p0.version + 1);
  // veraltete Versionen: Mitarbeiter (sichtbare Änderung des Poliers) und GF → 409
  assert.equal((await ma.put(`/fuhrpark/eintraege/${eid}`, { version: m0.version, titel: 'veraltet' })).status, 409);
  assert.equal((await gf.put(`/fuhrpark/eintraege/${eid}`, { version: g0.version + 2, kosten: 1 })).status, 409);
});
