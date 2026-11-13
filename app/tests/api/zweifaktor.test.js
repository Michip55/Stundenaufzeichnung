'use strict';
/** Zwei-Faktor-Anmeldung (TOTP, RFC 6238) – API.md 12.7 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U } = require('./hilfe');
const T = require('../../server/totp');

test('TOTP: RFC-6238-Testvektoren (SHA-1) und Base32', () => {
  const k = Buffer.from('12345678901234567890');
  for (const [zeit, code] of [[59, '94287082'], [1111111109, '07081804'], [1234567890, '89005924'], [2000000000, '69279037']]) {
    assert.equal(T.hotp(k, Math.floor(zeit / 30), 8), code);
  }
  assert.equal(T.base32(Buffer.from('foobar')), 'MZXW6YTBOI');
  assert.deepEqual(T.base32Dekodieren('MZXW6YTBOI').toString(), 'foobar');
  const g = T.base32Dekodieren(T.neuesGeheimnis());
  const jetzt = Date.UTC(2026, 10, 13, 10, 0, 0);
  const c = T.totp(g, jetzt);
  assert.ok(T.pruefe(g, c, jetzt + 29000) !== null); // gleicher/nächster Schritt
  assert.ok(T.pruefe(g, c, jetzt + 31000) !== null); // ±1
  assert.equal(T.pruefe(g, c, jetzt + 95000), null);
  const s = T.pruefe(g, c, jetzt);
  assert.equal(T.pruefe(g, c, jetzt, s), null); // nur einmal
});

test('Zwei-Faktor-Anmeldung', async (t) => {
  const s = await starte({ schluessel: 'test-schluessel-0123456789abcdef' });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  const buero = await s.login(U.buero);
  const ma = await s.login(U.mitarbeiter);
  let geheimnis, codes;
  const code = (versatz = 0) => T.totp(T.base32Dekodieren(geheimnis), s.uhr().getTime() + versatz);

  await t.test('Rollen: Mitarbeiter nicht möglich', async () => {
    assert.equal((await ma.get('/auth/2fa')).daten.moeglich, false);
    assert.equal((await ma.post('/auth/2fa/einrichten', { pin: '1234' })).status, 400);
    assert.equal((await s.client().get('/auth/2fa')).status, 401);
  });

  await t.test('Einrichten (PIN), QR, bestätigen → 10 Codes (nur Hash gespeichert)', async () => {
    assert.equal((await buero.post('/auth/2fa/einrichten', { pin: '9999' })).status, 401);
    const r = await buero.post('/auth/2fa/einrichten', { pin: '1234' });
    assert.equal(r.status, 200);
    geheimnis = r.daten.geheimnis;
    assert.match(geheimnis, /^[A-Z2-7]{32}$/);
    assert.match(r.daten.otpauthUri, /^otpauth:\/\/totp\/BauTag%3A.+\?secret=[A-Z2-7]{32}&issuer=BauTag&algorithm=SHA1&digits=6&period=30$/);
    assert.match(r.daten.qrSvg, /^data:image\/svg\+xml;base64,/);
    assert.match(Buffer.from(r.daten.qrSvg.split(',')[1], 'base64').toString(), /<svg/);
    assert.ok(!s.db.eins('SELECT geheimnis FROM benutzer_2fa WHERE benutzer_id = ?', U.buero).geheimnis.includes(geheimnis));
    assert.equal((await buero.post('/auth/2fa/bestaetigen', { code: '000000' })).status, 400);
    const b = await buero.post('/auth/2fa/bestaetigen', { code: code() });
    assert.equal(b.status, 200);
    codes = b.daten.wiederherstellungscodes;
    assert.equal(codes.length, 10);
    assert.ok(codes.every((c) => /^[a-z2-7]{4}-[a-z2-7]{4}$/.test(c)));
    assert.ok(!s.db.eins('SELECT codes FROM benutzer_2fa WHERE benutzer_id = ?', U.buero).codes.includes(codes[0]));
    assert.deepEqual((await buero.get('/auth/2fa')).daten, { aktiv: true, pflicht: false, moeglich: true, restcodes: 10 });
  });

  await t.test('Anmeldung: PIN → Vorgang → Code; falscher Code; Vorgang max. 5 Versuche/5 min', async () => {
    const c = s.client();
    const r = await c.post('/auth/login', { benutzerId: U.buero, pin: '1234' });
    assert.deepEqual(Object.keys(r.daten).sort(), ['vorgang', 'zweiterFaktor']);
    assert.equal(c.cookie, null);
    assert.equal((await c.get('/auth/ich')).status, 401);
    assert.equal((await c.post('/auth/login/2fa', { vorgang: r.daten.vorgang, code: '123456' })).status, 401);
    s.uhr.plus(1); // neuer Zeitschritt (Code nur einmal gültig)
    const ok = await c.post('/auth/login/2fa', { vorgang: r.daten.vorgang, code: code() });
    assert.equal(ok.status, 200);
    assert.equal(ok.daten.benutzer.id, U.buero);
    assert.equal((await c.get('/auth/ich')).daten.zweiFaktor.aktiv, true);
    assert.equal((await c.post('/auth/login/2fa', { vorgang: r.daten.vorgang, code: code() })).status, 401); // verbraucht
    // abgelaufen
    const r2 = await s.client().post('/auth/login', { benutzerId: U.buero, pin: '1234' });
    s.uhr.plus(6);
    assert.equal((await s.client().post('/auth/login/2fa', { vorgang: r2.daten.vorgang, code: code() })).status, 401);
    // 5 Versuche
    const c3 = s.client();
    const r3 = await c3.post('/auth/login', { benutzerId: U.buero, pin: '1234' });
    for (let i = 0; i < 5; i++) await c3.post('/auth/login/2fa', { vorgang: r3.daten.vorgang, code: '000000' });
    const sperre = await c3.post('/auth/login/2fa', { vorgang: r3.daten.vorgang, code: code() });
    assert.ok([401, 429].includes(sperre.status), String(sperre.status));
    s.app.bt.bremse.erfolg(U.buero, '127.0.0.1'); s.db.lauf('DELETE FROM login_versuch');
  });

  await t.test('Wiederherstellungscode: einmalig, Benachrichtigung', async () => {
    s.uhr.plus(10);
    const c = s.client();
    const r = await c.post('/auth/login', { benutzerId: U.buero, pin: '1234' });
    const ok = await c.post('/auth/login/2fa', { vorgang: r.daten.vorgang, code: codes[0].toUpperCase() });
    assert.equal(ok.status, 200, JSON.stringify(ok.daten));
    assert.ok((await c.get('/benachrichtigungen')).daten.some((b) => b.titel === 'Wiederherstellungscode verwendet'));
    const r2 = await s.client().post('/auth/login', { benutzerId: U.buero, pin: '1234' });
    assert.equal((await s.client().post('/auth/login/2fa', { vorgang: r2.daten.vorgang, code: codes[0] })).status, 401);
    assert.equal((await c.get('/auth/2fa')).daten.restcodes, 9);
  });

  await t.test('Pflicht je Rolle: GF setzt; ohne Einrichtung 403 2FA_EINRICHTEN; ausschalten bei Pflicht 409', async () => {
    assert.equal((await buero.put('/einstellungen/sicherheit', { zweiFaktorPflicht: { gf: true } })).status, 403);
    assert.equal((await gf.put('/einstellungen/sicherheit', { zweiFaktorPflicht: { mitarbeiter: true } })).status, 400);
    const r = await gf.put('/einstellungen/sicherheit', { zweiFaktorPflicht: { bauleiter: true, buero: true } });
    assert.deepEqual(r.daten.zweiFaktorPflicht, { bauleiter: true, buero: true, gf: false });
    const bl = await s.login(U.bauleiter);
    const x = await bl.get('/baustellen');
    assert.equal(x.status, 403);
    assert.equal(x.daten.code, '2FA_EINRICHTEN');
    assert.equal((await bl.get('/auth/ich')).daten.zweiFaktor.pflicht, true);
    assert.equal((await bl.get('/auth/2fa')).status, 200); // /auth/* frei
    s.uhr.plus(1);
    const c = s.client();
    const v = await c.post('/auth/login', { benutzerId: U.buero, pin: '1234' });
    await c.post('/auth/login/2fa', { vorgang: v.daten.vorgang, code: code() });
    assert.equal((await c.post('/auth/2fa/aus', { pin: '1234', code: code(30000) })).status, 409);
    assert.equal((await ma.get('/zeit/status')).status, 200); // Mitarbeiter nicht betroffen
  });

  await t.test('GF setzt zurück (nicht sich selbst), Sitzungen beendet', async () => {
    assert.equal((await gf.del(`/benutzer/${U.gf}/2fa`)).status, 403);
    assert.equal((await buero.del(`/benutzer/${U.buero}/2fa`)).status, 403);
    const r = await gf.del(`/benutzer/${U.buero}/2fa`);
    assert.equal(r.status, 200);
    assert.equal((await buero.get('/auth/ich')).status, 401);
    assert.ok(!s.db.eins('SELECT 1 AS x FROM benutzer_2fa WHERE benutzer_id = ?', U.buero));
    await gf.put('/einstellungen/sicherheit', { zweiFaktorPflicht: { bauleiter: false, buero: false } });
    const neu = await s.client().post('/auth/login', { benutzerId: U.buero, pin: '1234' });
    assert.equal(neu.daten.benutzer.id, U.buero);
  });
});
