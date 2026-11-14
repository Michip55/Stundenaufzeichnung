'use strict';
/** Korrekturen Nachprüfung – Bereich sicherheit (API.md 14.4): Anmeldung, 2FA, Sitzungen, Sperren */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U } = require('./hilfe');
const T = require('../../server/totp');
const auth = require('../../server/auth');
const { zweiFaktorZuruecksetzen } = require('../../server/entsperren');

const SCHLUESSEL = 'test-schluessel-0123456789abcdef-0123456789';

/** 2FA für eine Person einrichten → Funktion, die den aktuellen Code liefert */
async function zweiFaktorEinrichten(s, c) {
  const g = (await c.post('/auth/2fa/einrichten', { pin: '1234' })).daten.geheimnis;
  const code = (versatz = 0) => T.totp(T.base32Dekodieren(g), s.uhr().getTime() + versatz);
  const r = await c.post('/auth/2fa/bestaetigen', { code: code() });
  assert.equal(r.status, 200, JSON.stringify(r.daten));
  return code;
}
/** sicher falscher Code (keiner der Zeitschritte −1…+1) */
function falscherCode(code) {
  const echt = new Set([code(-30000), code(), code(30000)]);
  for (let i = 0; ; i++) { const c = String(100000 + i * 7919).slice(-6); if (!echt.has(c)) return c; }
}

test('N-004/N-027: richtige PIN setzt den Zähler falscher 2FA-Codes nicht zurück – nach 10 falschen Codes 423 über alle IPs', async (t) => {
  const s = await starte({ schluessel: SCHLUESSEL, trustProxy: true });
  t.after(() => s.stop());
  const buero = await s.login(U.buero, '1234', '10.9.0.1');
  const code = await zweiFaktorEinrichten(s, buero);
  s.uhr.plus(1);
  const falsch = falscherCode(code);
  const statusse = [];
  let ipNr = 1;
  // Angreifer kennt die PIN: je Vorgang „PIN richtig + 4 falsche Codes“, jedes Mal aus einer neuen IP
  for (let runde = 0; runde < 4 && !statusse.includes(423); runde++) {
    const c = s.client(null, `203.0.113.${ipNr++}`);
    const r = await c.post('/auth/login', { benutzerId: U.buero, pin: '1234' });
    if (r.status !== 200) { statusse.push(r.status); break; }
    assert.equal(r.daten.zweiterFaktor, true);
    for (let i = 0; i < 4; i++) {
      const x = await c.post('/auth/login/2fa', { vorgang: r.daten.vorgang, code: falsch });
      statusse.push(x.status);
      if (x.status === 423) { assert.equal(x.daten.code, 'KONTO_GESPERRT'); break; }
    }
    if (runde === 1) {
      // N-027: auch die kontoweite 20er-Grenze und die Sperre je (Benutzer, IP) werden durch die richtige PIN nicht geleert
      assert.equal(s.db.eins('SELECT fehlversuche FROM login_konto WHERE benutzer_id = ?', U.buero).fehlversuche, 8);
      assert.equal(s.db.eins('SELECT fehlversuche FROM login_2fa_fehler WHERE benutzer_id = ?', U.buero).fehlversuche, 8);
    }
  }
  assert.deepEqual(statusse, [401, 401, 401, 401, 401, 401, 401, 401, 401, 423], JSON.stringify(statusse));
  // gesperrt – auch mit richtiger PIN aus einer weiteren IP
  const neu = await s.client(null, '198.51.100.7').post('/auth/login', { benutzerId: U.buero, pin: '1234' });
  assert.equal(neu.status, 423);
  // gemeldet und protokolliert: Person je Anmeldevorgang, Büro/GF bei der Sperre
  const meldungen = s.db.alle("SELECT titel FROM benachrichtigung WHERE benutzer_id = ? AND typ = 'sicherheit'", U.buero);
  assert.equal(meldungen.filter((m) => m.titel === 'Falscher Zwei-Faktor-Code').length, 3);
  assert.ok(s.db.eins("SELECT 1 AS x FROM benachrichtigung WHERE benutzer_id = ? AND titel LIKE 'Konto gesperrt:%'", U.gf));
  assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM protokoll WHERE art = 'sicherheit' AND objekt = ? AND text LIKE '%falscher Zwei-Faktor-Code bei der Anmeldung nach richtiger PIN%'", `benutzer:${U.buero}`).n, 10);
  assert.ok(s.db.eins("SELECT 1 AS x FROM protokoll WHERE text LIKE '%nach 10 falschen Zwei-Faktor-Codes in 24 Std. gesperrt%'"));
  // GF entsperrt → Zähler weg, Anmeldung mit PIN + Code wieder möglich
  const gf = await s.login(U.gf, '1234', '10.9.0.2');
  assert.equal((await gf.post(`/benutzer/${U.buero}/entsperren`)).status, 200);
  assert.ok(!s.db.eins('SELECT 1 AS x FROM login_2fa_fehler WHERE benutzer_id = ?', U.buero));
  s.uhr.plus(1);
  const c = s.client(null, '10.9.0.3');
  const r = await c.post('/auth/login', { benutzerId: U.buero, pin: '1234' });
  assert.equal((await c.post('/auth/login/2fa', { vorgang: r.daten.vorgang, code: code() })).status, 200);
});

test('N-004: erst die vollständige Anmeldung (PIN + Code) setzt die PIN-Zähler zurück', async (t) => {
  const s = await starte({ schluessel: SCHLUESSEL });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  const code = await zweiFaktorEinrichten(s, gf);
  s.uhr.plus(1);
  // 3 falsche PINs, dann richtige PIN: Zähler bleiben bis zum zweiten Faktor
  for (let i = 0; i < 3; i++) assert.equal((await s.client().post('/auth/login', { benutzerId: U.gf, pin: '9999' })).status, 401);
  const c = s.client();
  const r = await c.post('/auth/login', { benutzerId: U.gf, pin: '1234' });
  assert.equal(r.daten.zweiterFaktor, true);
  assert.equal(s.db.eins('SELECT fehlversuche FROM login_versuch WHERE benutzer_id = ?', U.gf).fehlversuche, 3);
  assert.equal(s.db.eins('SELECT fehlversuche FROM login_konto WHERE benutzer_id = ?', U.gf).fehlversuche, 3);
  assert.equal((await c.post('/auth/login/2fa', { vorgang: r.daten.vorgang, code: code() })).status, 200);
  assert.ok(!s.db.eins('SELECT 1 AS x FROM login_versuch WHERE benutzer_id = ?', U.gf));
  assert.ok(!s.db.eins('SELECT 1 AS x FROM login_konto WHERE benutzer_id = ?', U.gf));
});

test('N-004: falsche Codes in den 2FA-Einstellungen zählen ebenfalls kontoweit und werden gemeldet', async (t) => {
  const s = await starte({ schluessel: SCHLUESSEL });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  const code = await zweiFaktorEinrichten(s, gf);
  const falsch = falscherCode(code);
  assert.equal((await gf.post('/auth/2fa/codes', { code: falsch })).status, 400);
  assert.equal((await gf.post('/auth/2fa/aus', { pin: '1234', code: falsch })).status, 400);
  assert.equal(s.db.eins('SELECT fehlversuche FROM login_2fa_fehler WHERE benutzer_id = ?', U.gf).fehlversuche, 2);
  assert.ok(s.db.eins("SELECT 1 AS x FROM benachrichtigung WHERE benutzer_id = ? AND titel = 'Falscher Zwei-Faktor-Code'", U.gf));
});

test('N-120: IP-Schlüssel – IPv6 je /64, IPv4-mapped als IPv4, Unlesbares gemeinsam', () => {
  const k = auth.ipSchluessel;
  assert.equal(k('203.0.113.9'), '203.0.113.9');
  assert.equal(k('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(k('2001:db8:1:2::27'), '2001:db8:1:2::/64');
  assert.equal(k('2001:0db8:0001:0002:ffff:1:2:3'), '2001:db8:1:2::/64');
  assert.equal(k('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(k('fe80::1%eth0'), 'fe80:0:0:0::/64');
  assert.equal(k('::1'), '0:0:0:0::/64');
  assert.equal(k('irgendwas-kein-ip'), 'ungueltig');
  assert.equal(k(''), 'ungueltig');
});

test('N-120: Fehlversuche aus demselben IPv6-/64 zählen gemeinsam (IP-Grenze 30/5 min)', async (t) => {
  const s = await starte({ trustProxy: true });
  t.after(() => s.stop());
  const st = [];
  for (let i = 0; i < 40; i++) {
    // jede Anfrage aus einer anderen Adresse desselben /64, gegen wechselnde Konten (keine Sperre je Benutzer)
    const r = await s.client(null, `2001:db8:1:2::${i.toString(16)}`).post('/auth/login', { pnr: 900000 + i, pin: '9999' });
    st.push(r.status);
  }
  assert.ok(st.slice(0, 30).every((x) => x === 401), JSON.stringify(st));
  assert.ok(st.slice(30).every((x) => x === 429), JSON.stringify(st));
  // ein anderes /64 ist nicht betroffen
  assert.equal((await s.client(null, '2001:db8:1:3::1').post('/auth/login', { pnr: 999999, pin: '9999' })).status, 401);
});

test('N-120: volle IP-Tabelle wird nicht komplett geleert – gesperrte Adressen bleiben gesperrt', () => {
  let jetzt = Date.UTC(2026, 10, 14, 8, 0, 0);
  const b = new auth.LoginBremse(null, () => new Date(jetzt));
  for (let i = 0; i < 30; i++) b.fehlversuch(null, '198.51.100.66');
  assert.throws(() => b.pruefe(null, '198.51.100.66'), (e) => e.status === 429);
  for (let i = 0; i <= auth.IP_TABELLE_MAX + 10; i++) b.fehlversuch(null, `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`);
  assert.ok(b.ip.size <= auth.IP_TABELLE_MAX);
  assert.throws(() => b.pruefe(null, '198.51.100.66'), (e) => e.status === 429);
  // abgelaufene Fenster werden gezielt entfernt
  jetzt += 6 * 60000;
  b.fehlversuch(null, '10.255.255.255');
  for (let i = 0; i <= auth.IP_TABELLE_MAX; i++) b.fehlversuch(null, `11.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`);
  assert.ok(b.ip.size <= auth.IP_TABELLE_MAX);
});

test('N-118: entsperren.js --2fa / --2fa-alle beendet alle Sitzungen der Person', async (t) => {
  const s = await starte({ schluessel: SCHLUESSEL });
  t.after(() => s.stop());
  const buero = await s.login(U.buero);
  await zweiFaktorEinrichten(s, buero);
  const gf = await s.login(U.gf);
  await zweiFaktorEinrichten(s, gf);
  assert.equal((await buero.get('/auth/ich')).status, 200);
  const pnr = s.db.eins('SELECT pnr FROM benutzer WHERE id = ?', U.buero).pnr;
  assert.equal(zweiFaktorZuruecksetzen(s.db, pnr), 1);
  assert.equal((await buero.get('/auth/ich')).status, 401);
  assert.equal((await gf.get('/auth/ich')).status, 200); // andere Personen unberührt
  assert.equal(zweiFaktorZuruecksetzen(s.db, null), 1); // --2fa-alle
  assert.equal((await gf.get('/auth/ich')).status, 401);
  const p = s.db.eins("SELECT neu FROM protokoll WHERE text LIKE 'Zwei-Faktor-Anmeldung von % per Kommandozeile zurückgesetzt' ORDER BY id DESC LIMIT 1");
  assert.deepEqual(JSON.parse(p.neu), { sitzungenBeendet: 1 });
});

test('N-119: Einrichten der 2FA beendet andere, nur mit PIN eröffnete Sitzungen', async (t) => {
  const s = await starte({ schluessel: SCHLUESSEL });
  t.after(() => s.stop());
  const b1 = await s.login(U.buero);
  const b2 = await s.login(U.buero);
  const gf = await s.login(U.gf);
  await zweiFaktorEinrichten(s, b2);
  assert.equal((await b1.get('/auth/ich')).status, 401);
  assert.equal((await b2.get('/auth/ich')).status, 200); // die einrichtende Sitzung bleibt
  assert.equal((await gf.get('/auth/ich')).status, 200);
  assert.ok(s.db.eins("SELECT 1 AS x FROM protokoll WHERE text LIKE '%hat die Zwei-Faktor-Anmeldung eingerichtet (1 andere Sitzung(en) beendet)%'"));
});

test('N-028: Push-Adressen, die WHATWG-URL und url.parse verschieden lesen, werden abgelehnt', async (t) => {
  const { endpointErlaubt } = require('../../server/push');
  const url = require('node:url');
  const umgehungen = ['https://127.0.0.1;.push.apple.com/x', 'https://169.254.169.254;.notify.windows.com/latest/meta-data',
    'https://127.0.0.1".push.apple.com/x', 'https://127.0.0.1`.push.apple.com/x', 'https://127.0.0.1{.push.apple.com/x', 'https://127.0.0.1}.push.apple.com/x',
    'https://127.0.0.1%3B.push.apple.com/x', "https://127.0.0.1'.push.apple.com/x", 'https://127.0.0.1 .push.apple.com/x', 'https://a\\b.push.apple.com/x',
    'https://x.push.apple.com\\@127.0.0.1/x', 'https://x.push.apple.com#@127.0.0.1/', 'https://x.push.apple.com:443:1/x', 'https://x.push.apple.com\t/x'];
  for (const e of umgehungen) {
    assert.ok(!endpointErlaubt(e), e);
    assert.ok(!endpointErlaubt(e, { test: true }), e);
  }
  // Gegenprobe: erlaubte Adressen lesen beide Parser gleich
  for (const e of ['https://fcm.googleapis.com/fcm/send/abc:APA91b-x_y', 'https://web.push.apple.com/QGx', 'https://wns2-db5p.notify.windows.com/w/?token=BQY%2bAA', 'https://fcm.googleapis.com:443/x']) {
    assert.ok(endpointErlaubt(e), e);
    assert.equal(url.parse(e).hostname, new URL(e).hostname, e);
  }
  const s = await starte(); // ohne Testbetrieb: echte Regeln
  t.after(() => s.stop());
  const ma = await s.login(U.mitarbeiter);
  for (const endpoint of umgehungen.slice(0, 2)) assert.equal((await ma.post('/push/abo', { endpoint, keys: { p256dh: 'BPx1-abc_DEF', auth: 'aBc-12_x' } })).status, 400, endpoint);
  assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM push_abo').n, 0);
});

test('N-032: große Body-Grenzen nur mit Sitzung und nur für echte Upload-Routen', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const gross = JSON.stringify({ dateiBase64: 'A'.repeat(3 * 1024 * 1024) }); // 3 MB > 2 MB Standard
  const anon = s.client();
  const JSONKOPF = { 'content-type': 'application/json' };
  // ohne Sitzung: 413 schon beim Lesen (vorher 35 MB geparst, dann 401)
  for (const p of ['/import/egal', '/import/bmd-op', '/baustellen/1/dokumente', '/stammdaten/geraete/import', '/positionen/katalog/import', '/fuhrpark/schaeden', '/berichte/1/fotos']) {
    assert.equal((await anon.post(p, gross, JSONKOPF)).status, 413, p);
  }
  const gf = await s.login(U.gf);
  // angemeldet, aber keine Upload-Route bzw. falsche Methode → 413
  for (const [m, p] of [['POST', '/import/egal'], ['POST', '/import/bmd-op/zuordnung'], ['PUT', '/baustellen/1/dokumente/1'], ['POST', '/baustellen/1/dokumente/1/wiederherstellen']]) {
    assert.equal((await gf.anfrage(m, p, gross, { 'content-type': 'application/json' })).status, 413, `${m} ${p}`);
  }
  // echte Upload-Routen mit Sitzung: Body wird gelesen (Prüfung der Datei danach → 400, nicht 413)
  for (const p of ['/baustellen/1/dokumente', '/import/bmd-op', '/Baustellen/1/Dokumente']) {
    const r = await gf.post(p, gross, JSONKOPF);
    assert.notEqual(r.status, 413, p);
  }
  // öffentliche Fernunterschrift bleibt bei 12 MB (ohne Anmeldung)
  assert.notEqual((await anon.post('/fern/ungueltig', gross, JSONKOPF)).status, 413);
});

test('N-063: ohne BAUTAG_SCHLUESSEL keine Klartext-Geheimnisse außerhalb von Vorführung/Test; NODE_ENV in jeder Schreibweise', async (t) => {
  const { createApp, StartFehler } = require('../../server/index');
  const G = require('../../server/geheim');
  const alt = process.env.BAUTAG_SCHLUESSEL;
  delete process.env.BAUTAG_SCHLUESSEL;
  t.after(() => { if (alt !== undefined) process.env.BAUTAG_SCHLUESSEL = alt; });
  for (const nodeEnv of ['Production', ' production ', 'PRODUCTION']) {
    assert.throws(() => createApp({ dbPath: ':memory:', nodeEnv, demo: false }), (e) => e instanceof StartFehler && /BAUTAG_SCHLUESSEL fehlt/.test(e.message), nodeEnv);
  }
  assert.throws(() => G.verschluesseln({ demo: false, test: false }, 'geheim'), (e) => e.code === 'KEIN_SCHLUESSEL');
  assert.equal(G.verschluesseln({ demo: true }, 'geheim'), 'klar:geheim'); // Vorführung bleibt möglich
  // Betrieb ohne NODE_ENV und ohne Schlüssel (wie früher laut README): Warnung, 2FA abgelehnt, VAPID nicht gespeichert
  const s = await starte({ demo: false });
  t.after(() => s.stop());
  assert.match(s.app.bt.schluesselWarnung, /BAUTAG_SCHLUESSEL fehlt.*Zwei-Faktor-Anmeldung.*NODE_ENV=production/);
  // Startausgabe des Servers enthält die Warnung
  const { spawnSync } = require('node:child_process');
  const lauf = spawnSync(process.execPath, [require('node:path').join(__dirname, '..', '..', 'server', 'index.js')],
    { env: { ...process.env, PORT: '0', BAUTAG_DB: ':memory:', BAUTAG_SCHLUESSEL: '', NODE_ENV: '', BAUTAG_DEMO: '', BAUTAG_TEST: '' }, encoding: 'utf8', timeout: 4000 });
  assert.match(lauf.stderr, /WARNUNG: BAUTAG_SCHLUESSEL fehlt/);
  assert.equal(s.db.einstellung('vapid', null), null);
  const gf = await s.login(U.gf);
  assert.ok(require('../../server/push').vapid(s.app.bt).publicKey); // Push geht, Schlüssel nur im Speicher
  assert.equal(s.db.einstellung('vapid', null), null);
  const r = await gf.post('/auth/2fa/einrichten', { pin: '1234' });
  assert.equal(r.status, 400);
  assert.match(r.daten.fehler, /BAUTAG_SCHLUESSEL/);
  assert.ok(!s.db.eins('SELECT 1 AS x FROM benutzer_2fa'));
  assert.ok(!s.db.alle('SELECT geheimnis FROM benutzer_2fa').some((z) => /^klar:/.test(z.geheimnis)));
});
