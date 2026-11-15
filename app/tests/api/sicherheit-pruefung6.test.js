'use strict';
/** Prüfbericht 6 – Sicherheit: G-03 (2FA nach Schlüsselwechsel), G-06 (Test-Schnittstellen), G-11 (Schlüssel Pflicht, Nachverschlüsselung) */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { starte, U } = require('./hilfe');
const { createApp, StartFehler } = require('../../server/index');
const T = require('../../server/totp');
const { zweiFaktorZuruecksetzen } = require('../../server/entsperren');

const A = 'schluessel-A-0123456789abcdef0123456789abcdef';
const B = 'schluessel-B-0123456789abcdef0123456789abcdef';
const tmpDb = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bautag-p6-')); return { d, db: path.join(d, 'bautag.db') }; };

/** createApp mit sauberer Umgebung (Env-Variablen kurzzeitig gesetzt) */
function mitEnv(env, f) {
  const alt = {};
  for (const k of Object.keys(env)) { alt[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  try { return f(); } finally { for (const k of Object.keys(env)) { if (alt[k] === undefined) delete process.env[k]; else process.env[k] = alt[k]; } }
}

test('G-06: Test-Schnittstellen nie im Echtbetrieb, nur mit Token', async (t) => {
  assert.throws(() => createApp({ dbPath: ':memory:', nodeEnv: 'production', test: true, schluessel: A }), (e) => e instanceof StartFehler && /BAUTAG_TEST=1 ist im Echtbetrieb/.test(e.message));
  assert.throws(() => mitEnv({ NODE_ENV: 'production', BAUTAG_TEST: '1', BAUTAG_TEST_TOKEN: 'x'.repeat(32), BAUTAG_SCHLUESSEL: A }, () => createApp({ dbPath: ':memory:' })), StartFehler);
  // per Umgebung eingeschaltet: Token Pflicht
  assert.throws(() => mitEnv({ NODE_ENV: 'test', BAUTAG_TEST: '1', BAUTAG_TEST_TOKEN: undefined }, () => createApp({ dbPath: ':memory:' })), (e) => /BAUTAG_TEST_TOKEN/.test(e.message));
  const s = await starte({ test: true });
  t.after(() => s.stop());
  const roh = (pfad, h = {}) => fetch(`${s.basis}/api${pfad}`, { headers: h });
  assert.equal((await roh('/test/ausgang')).status, 403);
  assert.equal((await roh('/test/ausgang', { 'x-bautag-test-token': 'falsch' })).status, 403);
  assert.equal((await roh('/test/ausgang', { 'x-bautag-test-token': s.app.bt.testToken })).status, 200);
  const uhr = await fetch(`${s.basis}/api/test/uhr`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"iso":"2030-01-01T00:00:00Z"}' });
  assert.equal(uhr.status, 403);
  // ohne Testbetrieb gibt es die Routen gar nicht
  const n = await starte();
  t.after(() => n.stop());
  assert.ok([401, 404].includes((await fetch(`${n.basis}/api/test/ausgang`)).status));
});

test('G-11: Echtbetrieb ohne gültigen BAUTAG_SCHLUESSEL startet nicht', () => {
  for (const s of [undefined, '', 'zu-kurz-0123456789']) {
    assert.throws(() => mitEnv({ BAUTAG_SCHLUESSEL: undefined, BAUTAG_DEMO: undefined }, () => createApp({ dbPath: ':memory:', nodeEnv: 'production', schluessel: s })), (e) => e instanceof StartFehler && /BAUTAG_SCHLUESSEL fehlt oder ist zu kurz \(mindestens 32 Zeichen\)/.test(e.message), String(s));
  }
  const ok = mitEnv({ BAUTAG_SCHLUESSEL: undefined }, () => createApp({ dbPath: ':memory:', nodeEnv: 'production', schluessel: A }));
  ok.schliessen();
  const demo = mitEnv({ BAUTAG_SCHLUESSEL: undefined }, () => createApp({ dbPath: ':memory:', nodeEnv: 'production', demo: true }));
  demo.schliessen();
});

test('G-11: „klar:“-Geheimnisse werden beim Start mit Schlüssel nachverschlüsselt', async (t) => {
  const { d, db } = tmpDb();
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const s1 = await starte({ dbPath: db });
  const buero = await s1.login(U.buero);
  const g = (await buero.post('/auth/2fa/einrichten', { pin: '1234' })).daten.geheimnis;
  assert.equal((await buero.post('/auth/2fa/bestaetigen', { code: T.totp(T.base32Dekodieren(g), s1.uhr().getTime()) })).status, 200);
  assert.match(s1.db.eins('SELECT geheimnis FROM benutzer_2fa WHERE benutzer_id = ?', U.buero).geheimnis, /^klar:/);
  assert.match(s1.db.einstellung('vapid', {}).privateKey, /^klar:/);
  await s1.stop();
  const s2 = await starte({ dbPath: db, seed: false, schluessel: A });
  t.after(() => s2.stop());
  assert.match(s2.db.eins('SELECT geheimnis FROM benutzer_2fa WHERE benutzer_id = ?', U.buero).geheimnis, /^v1:/);
  assert.match(s2.db.einstellung('vapid', {}).privateKey, /^v1:/);
  assert.equal(s2.app.bt.geheimnisse.nachverschluesselt, 2);
  assert.ok(s2.db.eins("SELECT 1 AS x FROM protokoll WHERE art = 'sicherheit' AND text LIKE '%nachverschlüsselt%'"));
  // Anmeldung mit 2FA funktioniert weiter
  s2.uhr.plus(1);
  const c = s2.client();
  const r = await c.post('/auth/login', { benutzerId: U.buero, pin: '1234' });
  assert.equal((await c.post('/auth/login/2fa', { vorgang: r.daten.vorgang, code: T.totp(T.base32Dekodieren(g), s2.uhr().getTime()) })).status, 200);
});

test('G-03: neuer BAUTAG_SCHLUESSEL – Wiederherstellungscode funktioniert, TOTP meldet klar, Zurücksetzen per Kommandozeile', async (t) => {
  const { d, db } = tmpDb();
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const s1 = await starte({ dbPath: db, schluessel: A });
  const gf = await s1.login(U.gf);
  const g = (await gf.post('/auth/2fa/einrichten', { pin: '1234' })).daten.geheimnis;
  const codes = (await gf.post('/auth/2fa/bestaetigen', { code: T.totp(T.base32Dekodieren(g), s1.uhr().getTime()) })).daten.wiederherstellungscodes;
  await s1.stop();
  const s2 = await starte({ dbPath: db, seed: false, schluessel: B });
  t.after(() => s2.stop());
  assert.ok(s2.app.bt.warnungen.some((w) => /Zwei-Faktor-Geheimnis\(se\) mit dem aktuellen BAUTAG_SCHLUESSEL nicht lesbar/.test(w) && /--2fa/.test(w)));
  // TOTP: klare Meldung, kein Fehlversuch der Person
  const c = s2.client();
  let r = await c.post('/auth/login', { benutzerId: U.gf, pin: '1234' });
  const x = await c.post('/auth/login/2fa', { vorgang: r.daten.vorgang, code: T.totp(T.base32Dekodieren(g), s2.uhr().getTime()) });
  assert.equal(x.status, 401);
  assert.equal(x.daten.code, 'ZWEI_FAKTOR_UNLESBAR');
  assert.equal(x.daten.fehler, '2FA-Schlüssel nicht lesbar – Wiederherstellungscode verwenden oder Zurücksetzen durch GF/entsperren.js.');
  // Wiederherstellungscode (gesalzener Hash, schlüsselunabhängig) → angemeldet
  const ok = await c.post('/auth/login/2fa', { vorgang: r.daten.vorgang, code: codes[0] });
  assert.equal(ok.status, 200, JSON.stringify(ok.daten));
  // Kommandozeile: 2FA zurücksetzen → Anmeldung nur mit PIN
  assert.equal(zweiFaktorZuruecksetzen(s2.db, s2.db.eins('SELECT pnr FROM benutzer WHERE id = ?', U.gf).pnr), 1);
  r = await s2.client().post('/auth/login', { benutzerId: U.gf, pin: '1234' });
  assert.equal(r.status, 200);
  assert.ok(!r.daten.zweiterFaktor);
  assert.ok(s2.db.eins("SELECT 1 AS x FROM protokoll WHERE text LIKE 'Zwei-Faktor-Anmeldung von % per Kommandozeile zurückgesetzt'"));
  assert.equal(zweiFaktorZuruecksetzen(s2.db, null), 0); // --2fa-alle: niemand mehr
});

test('G-03: entsperren.js --2fa und --2fa-alle als Kommando', async (t) => {
  const { d, db } = tmpDb();
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const s1 = await starte({ dbPath: db, schluessel: A });
  const gf = await s1.login(U.gf);
  const g = (await gf.post('/auth/2fa/einrichten', { pin: '1234' })).daten.geheimnis;
  await gf.post('/auth/2fa/bestaetigen', { code: T.totp(T.base32Dekodieren(g), s1.uhr().getTime()) });
  const pnr = s1.db.eins('SELECT pnr FROM benutzer WHERE id = ?', U.gf).pnr;
  await s1.stop();
  const { spawnSync } = require('node:child_process');
  const lauf = (...a) => spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'server', 'entsperren.js'), ...a], { env: { ...process.env, BAUTAG_DB: db }, encoding: 'utf8' });
  let r = lauf(String(pnr), '--2fa');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Zwei-Faktor-Anmeldung von .* zurückgesetzt/);
  r = lauf('--2fa-alle');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /bei 0 Person\(en\) zurückgesetzt/);
});
