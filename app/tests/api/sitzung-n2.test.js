'use strict';
/**
 * API.md 15.16 – Nachkontrolle Sitzung/Gerät (Befunde H-S2, H-S3), Server-Seite:
 *  - H-S3: Push-Abo eines „Geteilten Geräts“ (push_abo.geteilt, Migration 44) wird nur zugestellt, solange die Sitzung des Abos
 *    innerhalb von sperreMinuten (Feld 30 min, Büro 60 min) zuletzt benutzt wurde; die Haltedauer beim Push-Dienst endet mit dieser
 *    Frist. Ohne Angabe gilt eine App-Sitzung (gebunden) als geteilt; „Eigenes Handy“ (geteilt:false) wie bisher bis zum Sitzungsende.
 *  - H-S2: Kopf X-BauTag-Ich – nennt die App eine andere Person als die des Cookies (anderer Tab hat umgemeldet), antwortet der
 *    Server 409 ANMELDUNG_ANDERS und tut nichts.
 * Jeder Teil schlägt ohne die Korrektur fehl.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');
const { benachrichtige } = require('../../server/benachrichtigung');
const P = require('../../server/push');

const KEYS = { p256dh: 'BPx', auth: 'aa' };
const BETRIEB = { feldMin: 720, bueroMin: 60, maxH: 24, sperreFeldMin: 30 };

/** Anmeldung wie die App: mit Bindung (zwei Cookies) */
async function appLogin(s, benutzerId) {
  const r = await fetch(`${s.basis}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ benutzerId, pin: '1234', bindung: true }) });
  assert.equal(r.status, 200, `Login ${benutzerId}`);
  const sc = r.headers.getSetCookie();
  const wert = (n) => { const z = sc.find((x) => x.startsWith(`${n}=`)); return z ? z.split(';')[0].slice(n.length + 1) : ''; };
  const cookie = `bt_session=${wert('bt_session')}; bt_bindung=${wert('bt_bindung')}`;
  return s.client(cookie);
}
let nr = 0;
function meldung(s, benutzerId, titel) {
  const schluessel = `n2-test:${benutzerId}:${++nr}`;
  benachrichtige(s.db, { benutzerId, typ: 'sicherheit', titel, text: `${titel} – Text`, zeit: s.uhr().toISOString(), schluessel });
  return `bt-${s.db.eins('SELECT id FROM benachrichtigung WHERE benutzer_id = ? AND schluessel = ?', benutzerId, schluessel).id}`;
}
async function versand(s, endpoint) {
  s.app.bt.testAusgang.push = [];
  assert.equal((await s.client().post('/test/stuendlich')).status, 200);
  return s.app.bt.testAusgang.push.filter((p) => p.endpoint === endpoint);
}
const abo = (s, endpoint) => s.db.eins('SELECT * FROM push_abo WHERE endpoint = ?', endpoint);

test('15.16 H-S3: Push eines geteilten Geräts endet mit der Sperre nach Untätigkeit', async (t) => {
  const s = await starte({ test: true, sitzung: BETRIEB });
  t.after(() => s.stop());

  await t.test('App-Sitzung ohne Angabe = geteilt: innerhalb von 30 min zugestellt (Haltedauer bis zur Sperre), danach kein Push, Abo weg', async () => {
    const ep = 'https://tablet-n2.example.test/push/standard';
    const c = await appLogin(s, U.polier);
    assert.equal((await c.post('/push/abo', { endpoint: ep, keys: KEYS })).status, 201);
    assert.equal(abo(s, ep).geteilt, 1, 'App-Sitzung ohne Angabe gilt als geteiltes Gerät');
    let z = P.aboZustellbar(s.app.bt, abo(s, ep));
    assert.ok(z && z.ttl <= 30 * 60 && z.ttl > 29 * 60, `Haltedauer beim Push-Dienst bis zur Sperre (${z && z.ttl})`);
    s.uhr.plus(29); // Tablet weggelegt, App geschlossen – keine Anfrage
    z = P.aboZustellbar(s.app.bt, abo(s, ep));
    assert.ok(z && z.ttl <= 60, `nach 29 min höchstens noch 60 s Haltedauer (${z && z.ttl})`);
    const tag = meldung(s, U.polier, 'nach 29 min');
    assert.ok((await versand(s, ep)).some((p) => p.tag === tag), 'innerhalb der Sperre zugestellt');
    s.uhr.plus(2); // 31 min ohne Anfrage: die App am Gerät hätte abgemeldet
    meldung(s, U.polier, 'Urlaub genehmigt – Do 26.11.');
    assert.deepEqual(await versand(s, ep), [], 'kein Push auf den Sperrbildschirm nach der Gerätesperre');
    assert.ok(!abo(s, ep), 'Abo verworfen');
    assert.equal((await c.get('/auth/ich')).status, 200, 'die Sitzung am Server bleibt (Feld 12 h) – nur der Push endet');
    await c.post('/auth/logout');
  });

  await t.test('Bedienung hält den Push offen: jede Anfrage der Sitzung verlängert die Frist', async () => {
    const ep = 'https://tablet-n2.example.test/push/bedient';
    const c = await appLogin(s, U.polier);
    assert.equal((await c.post('/push/abo', { endpoint: ep, keys: KEYS, geteilt: true })).status, 201);
    s.uhr.plus(20);
    assert.equal((await c.get('/benachrichtigungen')).status, 200);
    s.uhr.plus(20); // 40 min seit dem Anlegen, 20 min seit der letzten Anfrage
    const tag = meldung(s, U.polier, 'nach Bedienung');
    assert.ok((await versand(s, ep)).some((p) => p.tag === tag));
    s.uhr.plus(11);
    meldung(s, U.polier, 'zu spät');
    assert.deepEqual(await versand(s, ep), []);
    await c.post('/auth/logout');
  });

  await t.test('Eigenes Handy (geteilt:false): wie bisher bis zum Ende der Sitzung (Feld 12 h)', async () => {
    const ep = 'https://handy-n2.example.test/push/eigen';
    const c = await appLogin(s, U.polier);
    assert.equal((await c.post('/push/abo', { endpoint: ep, keys: KEYS, geteilt: false })).status, 201);
    assert.equal(abo(s, ep).geteilt, 0);
    assert.equal(P.aboZustellbar(s.app.bt, abo(s, ep)).ttl, 12 * 3600);
    s.uhr.plus(10 * 60);
    const tag = meldung(s, U.polier, 'nach 10 h');
    assert.ok((await versand(s, ep)).some((p) => p.tag === tag), 'eigenes Handy: nach 10 h zugestellt');
    // Wechsel auf „geteilt“ in „Mehr“: die App meldet das Abo neu – ab jetzt gilt die Sperre
    assert.equal((await c.post('/push/abo', { endpoint: ep, keys: KEYS, geteilt: true })).status, 200);
    assert.equal(abo(s, ep).geteilt, 1);
    s.uhr.plus(31);
    meldung(s, U.polier, 'nach dem Wechsel');
    assert.deepEqual(await versand(s, ep), [], 'nach dem Wechsel auf „geteilt“ gilt die Sperre nach Untätigkeit');
  });

  await t.test('API-Client ohne Bindung und ohne Angabe: unverändert (nicht geteilt)', async () => {
    const ep = 'https://api-n2.example.test/push/api';
    const c = await s.login(U.mitarbeiter);
    assert.equal((await c.post('/push/abo', { endpoint: ep, keys: KEYS })).status, 201);
    assert.equal(abo(s, ep).geteilt, 0);
    s.uhr.plus(2 * 60);
    const tag = meldung(s, U.mitarbeiter, 'nach 2 h');
    assert.ok((await versand(s, ep)).some((p) => p.tag === tag));
    assert.equal((await c.post('/push/abo', { endpoint: ep, keys: KEYS, geteilt: 'ja' })).status, 400, 'geteilt muss true/false sein');
    assert.equal((await c.post('/push/abo', { endpoint: ep, keys: KEYS, geteilt: null })).status, 200, 'null = keine Angabe');
  });

  await t.test('Büro am geteilten PC: Sperre = Sitzung (60 min)', async () => {
    const ep = 'https://pc-n2.example.test/push/buero';
    const c = await appLogin(s, U.buero);
    assert.equal((await c.post('/push/abo', { endpoint: ep, keys: KEYS })).status, 201);
    s.uhr.plus(59);
    const tag = meldung(s, U.buero, 'nach 59 min');
    assert.ok((await versand(s, ep)).some((p) => p.tag === tag));
    s.uhr.plus(2);
    meldung(s, U.buero, 'nach 61 min');
    assert.deepEqual(await versand(s, ep), []);
  });

  await t.test('Stündlicher Lauf räumt Abos geteilter Geräte nach der Sperre auf (die Sitzung bleibt)', async () => {
    const ep = 'https://tablet-n2.example.test/push/stuendlich';
    const epEigen = 'https://handy-n2.example.test/push/stuendlich';
    const c = await appLogin(s, U.polier);
    const h = await appLogin(s, U.polier2);
    assert.equal((await c.post('/push/abo', { endpoint: ep, keys: KEYS })).status, 201);
    assert.equal((await h.post('/push/abo', { endpoint: epEigen, keys: KEYS, geteilt: false })).status, 201);
    s.uhr.plus(31);
    s.app.bt.stuendlich();
    assert.ok(!abo(s, ep), 'geteiltes Abo nach 31 min ohne Anfrage gelöscht');
    assert.ok(abo(s, epEigen), 'Abo des eigenen Handys bleibt');
    assert.equal((await c.get('/auth/ich')).status, 200);
  });
});

test('15.16 H-S2: X-BauTag-Ich – Anfrage für eine andere Person als die des Cookies → 409, nichts geändert', async (t) => {
  const s = await starte({ test: true });
  t.after(() => s.stop());
  const buero = await appLogin(s, U.buero);
  meldung(s, U.buero, 'ungelesen');
  const ungelesen = () => s.db.eins('SELECT COUNT(*) AS n FROM benachrichtigung WHERE benutzer_id = ? AND gelesen = 0', U.buero).n;
  const vorher = ungelesen();
  assert.ok(vorher > 0);
  // Tab 2 zeigt noch den Rahmen des Poliers (1), das Cookie gehört inzwischen dem Büro
  let r = await buero.get('/offene-posten', { 'x-bautag-ich': String(U.polier) });
  assert.equal(r.status, 409);
  assert.equal(r.daten.code, 'ANMELDUNG_ANDERS');
  assert.doesNotMatch(JSON.stringify(r.daten), /€|\d+[.,]\d{2}/, 'keine Daten in der Ablehnung');
  r = await buero.post('/benachrichtigungen/alle-gelesen', {}, { 'x-bautag-ich': String(U.polier) });
  assert.equal(r.status, 409);
  assert.equal(ungelesen(), vorher, 'nichts verändert');
  assert.equal((await buero.get('/offene-posten', { 'x-bautag-ich': 'abc' })).status, 409);
  // passende Person bzw. ohne Kopf (API-Clients): wie bisher
  assert.equal((await buero.get('/offene-posten', { 'x-bautag-ich': String(U.buero) })).status, 200);
  assert.equal((await buero.get('/offene-posten')).status, 200);
  // ohne Anmeldung bleibt es 401; Abmelden geht immer
  assert.equal((await s.client().get('/offene-posten', { 'x-bautag-ich': String(U.buero) })).status, 401);
  assert.equal((await buero.post('/auth/logout', {}, { 'x-bautag-ich': String(U.polier) })).status, 200);
  assert.equal((await buero.get('/auth/ich')).status, 401);
  assert.ok(BS.pitten);
});
