'use strict';
/** Regressionstests PRUEFBERICHT_3: D-01, D-02, D-11, D-12 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { starte, U, BS } = require('./hilfe');
const R = require('../../server/rechte');
const { entsperren } = require('../../server/entsperren');

const SERVER = path.join(__dirname, '..', '..', 'server');

test('D-01: befristete Kontosperre, Büro entsperrt GF, Notfall-Befehl, Warnung', async (t) => {
  const s = await starte({ trustProxy: true });
  t.after(() => s.stop());
  let n = 0;
  const sperre = async (id) => {
    let r;
    for (let i = 0; i < 20; i++) r = await s.client(null, `66.6.${n}.${i}`).post('/auth/login', { benutzerId: id, pin: '999999' });
    n++;
    return r;
  };
  const login = (id, pin = '1234') => s.client(null, `10.2.${n++}.1`).post('/auth/login', { benutzerId: id, pin });

  await t.test('D-01: GF gesperrt (423, Retry-After 24 h) – Büro entsperrt (nur entsperren)', async () => {
    const r = await sperre(U.gf);
    assert.equal(r.status, 423);
    assert.ok(Math.abs(Number(r.headers.get('retry-after')) - 86400) < 5);
    assert.equal((await login(U.gf)).status, 423);
    const buero = await s.login(U.buero, '1234', '10.3.0.1');
    const liste = (await buero.get('/benutzer')).daten.find((b) => b.id === U.gf);
    assert.equal(liste.gesperrt, true);
    assert.ok(liste.gesperrtBis > liste.gesperrtSeit);
    assert.equal((await buero.put(`/benutzer/${U.gf}`, { pin: '582915' })).status, 403); // kein PIN-Reset
    assert.equal((await buero.post(`/benutzer/${U.gf}/entsperren`)).status, 200);
    assert.equal((await login(U.gf)).status, 200);
    // GF entsperrt Büro; niemand sich selbst
    await sperre(U.buero);
    const gf = await s.login(U.gf, '1234', '10.3.0.2');
    assert.equal((await gf.post(`/benutzer/${U.gf}/entsperren`)).status, 403);
    assert.equal((await gf.post(`/benutzer/${U.buero}/entsperren`)).status, 200);
    assert.equal((await login(U.buero)).status, 200);
  });

  await t.test('D-01: Sperre läuft ab – steigend 24 h, 48 h, 7 Tage', async () => {
    let r = await sperre(4);
    assert.equal(r.status, 423);
    s.uhr.plus(24 * 60 + 1);
    r = await sperre(4); // abgelaufen → neue Fehlversuche → 2. Sperre
    assert.equal(r.status, 423);
    assert.ok(Math.abs(Number(r.headers.get('retry-after')) - 2 * 86400) < 5, r.headers.get('retry-after'));
    s.uhr.plus(48 * 60 + 1);
    r = await sperre(4);
    assert.ok(Math.abs(Number(r.headers.get('retry-after')) - 7 * 86400) < 5, r.headers.get('retry-after'));
    s.uhr.plus(7 * 24 * 60 + 1);
    assert.equal((await login(4)).status, 200); // ohne Eingriff wieder möglich
    // nach erfolgreicher Anmeldung beginnt die Eskalation neu
    r = await sperre(4);
    assert.ok(Math.abs(Number(r.headers.get('retry-after')) - 86400) < 5);
  });

  await t.test('D-01: Notfall-Befehl entsperren.js (protokolliert)', async () => {
    await sperre(U.gf);
    assert.equal((await login(U.gf)).status, 423);
    const b = entsperren(s.db, 1102, s.uhr());
    assert.equal(b.name, 'Michael Pichler');
    assert.equal((await login(U.gf)).status, 200);
    assert.ok(s.db.eins("SELECT COUNT(*) AS n FROM protokoll WHERE art = 'sicherheit' AND text LIKE 'Notfall-Entsperrung%'").n === 1);
    assert.throws(() => entsperren(s.db, 999999), /Keine Person/);
    const cli = spawnSync(process.execPath, [path.join(SERVER, 'entsperren.js')], { encoding: 'utf8' });
    assert.equal(cli.status, 2);
    assert.match(cli.stderr, /Aufruf: node server\/entsperren\.js <Personalnummer>/);
  });

  await t.test('D-01: Warnung bei weniger als zwei Verwaltungs-Konten', () => {
    assert.equal(R.entsperrKonten(s.db).length, 3); // Büro, Bauleiter (wie Büro, 13.11.2026), GF
    assert.deepEqual(s.app.bt.warnungen, []);
    s.db.lauf('UPDATE benutzer SET aktiv = 0 WHERE id IN (?, ?)', U.buero, U.bauleiter);
    const app2 = require('../../server/index').createApp({ db: s.db, uhr: s.uhr });
    assert.equal(app2.bt.warnungen.length, 1);
    assert.match(app2.bt.warnungen[0], /mindestens zwei/);
    s.db.lauf('UPDATE benutzer SET aktiv = 1 WHERE id IN (?, ?)', U.buero, U.bauleiter);
  });
});

test('D-02, D-11, D-12: Rollenwechsel nur durch GF, PIN-Pflicht, Zuordnungen räumen, Anmeldung nur mit Pnr', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  const buero = await s.login(U.buero);

  await t.test('D-02: Büro macht niemanden zum Bauleiter (Original-Reproduktion)', async () => {
    assert.equal((await buero.put('/benutzer/13', { rolle: 'bauleiter' })).status, 403);
    assert.equal((await buero.post('/benutzer', { name: 'BL', rolle: 'bauleiter', pin: '582915' })).status, 403);
    assert.equal((await buero.put('/benutzer/103', { rolle: 'polier' })).status, 403);
    assert.equal((await (await s.login(13)).get(`/kalkulation/${BS.reisinger}`)).status, 403);
  });

  await t.test('D-02: Büro Mitarbeiter ↔ Polier erlaubt, GF wird benachrichtigt', async () => {
    const r = await buero.put('/benutzer/2', { rolle: 'polier' });
    assert.equal(r.status, 200);
    assert.ok((await gf.get('/benachrichtigungen')).daten.some((x) => x.typ === 'sicherheit' && /Lukas Brandstätter/.test(x.titel)));
    assert.equal((await buero.put('/benutzer/2', { rolle: 'mitarbeiter' })).status, 200);
  });

  await t.test('D-02: GF macht Polier zum Bauleiter → 4-stellige PIN muss geändert werden', async () => {
    assert.equal((await gf.put('/benutzer/13', { rolle: 'bauleiter' })).status, 200);
    const c = s.client();
    const l = await c.post('/auth/login', { benutzerId: 13, pin: '1234' });
    assert.equal(l.daten.mussPinAendern, true);
    assert.equal((await c.get('/kalkulation')).daten.code, 'PIN_AENDERN');
    assert.equal((await c.post('/auth/pin', { alt: '1234', neu: '5829' })).status, 400); // zu kurz für Bauleiter
    assert.equal((await c.post('/auth/pin', { alt: '1234', neu: '582916' })).status, 200);
    assert.equal((await c.get('/kalkulation')).status, 200);
  });

  await t.test('D-02: ohne Demo-Modus erzwingt auch die Anmeldung mit zu kurzer PIN den Wechsel', async () => {
    const s2 = await starte({ demo: false });
    try {
      s2.db.lauf('UPDATE benutzer SET muss_pin_aendern = 0 WHERE id = ?', U.bauleiter);
      const l = await s2.client().post('/auth/login', { benutzerId: U.bauleiter, pin: '1234' });
      assert.equal(l.daten.mussPinAendern, true);
      s2.db.lauf('UPDATE benutzer SET muss_pin_aendern = 0 WHERE id = ?', U.mitarbeiter);
      assert.equal((await s2.client().post('/auth/login', { benutzerId: U.mitarbeiter, pin: '1234' })).daten.mussPinAendern, false);
    } finally { await s2.stop(); }
  });

  await t.test('D-11: Rollenwechsel räumt Bauleiter-/Polier-Zuordnungen', async () => {
    const r = await gf.put('/benutzer/103', { rolle: 'polier' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.daten.zuordnungenEntfernt.map((z) => z.kst).sort(), ['26-038', '26-041', '26-047', '26-050']);
    assert.ok(r.daten.zuordnungenEntfernt.every((z) => z.feld === 'bauleiterId'));
    assert.equal((await gf.get(`/baustellen/${BS.pitten}`)).daten.bauleiterId, null);
    const p = await buero.put('/benutzer/1', { rolle: 'mitarbeiter' });
    assert.deepEqual(p.daten.zuordnungenEntfernt, [{ baustelleId: BS.pitten, kst: '26-041', feld: 'polierId' }]);
    assert.equal((await gf.get(`/baustellen/${BS.pitten}`)).daten.polierId, null);
    const ohne = await gf.put('/benutzer/2', { name: 'Lukas Brandstätter' });
    assert.ok(!('zuordnungenEntfernt' in ohne.daten));
  });

  await t.test('D-12: ohne Namensliste nur Anmeldung mit Personalnummer', async () => {
    const s2 = await starte({ loginListe: false });
    try {
      const r = await s2.client().post('/auth/login', { benutzerId: U.buero, pin: '1234' });
      assert.equal(r.status, 400);
      assert.match(r.daten.fehler, /Personalnummer/);
      assert.equal((await s2.client().post('/auth/login', { pnr: 1101, pin: '1234' })).status, 200);
    } finally { await s2.stop(); }
  });
});
