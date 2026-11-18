'use strict';
/** G-07: Push-Abos nur für bekannte Push-Dienste, keine rohen Netzwerkfehler */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U } = require('./hilfe');
const { endpointErlaubt } = require('../../server/push');

test('G-07: Erlaubnisliste der Push-Dienste', () => {
  for (const ok of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://push.services.mozilla.com/x',
    'https://web.push.apple.com/QG', 'https://api.push.apple.com/x', 'https://wns2-db5p.notify.windows.com/w/?token=x', 'https://db5.notify.windows.com/x', 'https://fcm.googleapis.com:443/x']) assert.ok(endpointErlaubt(ok), ok);
  for (const nein of ['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://127.0.0.1/x', 'https://127.0.0.1:4798/x', 'https://169.254.169.254/latest', 'https://[::1]/x',
    'https://10.0.0.5/x', 'https://2130706433/x', 'https://fcm.googleapis.com.evil.at/x', 'https://evilfcm.googleapis.com.at/x', 'https://notify.windows.com.evil/x', 'https://push.apple.com/x',
    'https://user:pw@fcm.googleapis.com/x', 'https://app:3000/x', 'https://localhost/x', 'https://push.example.test/x', 'kein-url', 'https://fcm.googleapis.com./x']) assert.ok(!endpointErlaubt(nein), nein);
  assert.ok(endpointErlaubt('https://push.example.test/x', { test: true })); // nur Testbetrieb
});

test('G-07: Abo mit interner Adresse abgelehnt (auch für Mitarbeiter), Fehlertexte ohne Netzwerkdetails', async (t) => {
  const s = await starte(); // ohne Testbetrieb: echte Regeln
  t.after(() => s.stop());
  const ma = await s.login(U.mitarbeiter);
  const keys = { p256dh: 'BPx1-abc_DEF', auth: 'aBc-12_x' };
  for (const endpoint of ['https://127.0.0.1:4798/x', 'https://169.254.169.254/latest/meta-data', 'https://app:3000/api', 'https://intern.firma.local/x']) {
    const r = await ma.post('/push/abo', { endpoint, keys });
    assert.equal(r.status, 400, endpoint);
    assert.match(r.daten.fehler, /bekannter Push-Dienste/);
  }
  assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM push_abo').n, 0);
  assert.equal((await ma.post('/push/abo', { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys })).status, 201);
  // Altbestand mit rohem Fehlertext → nur generisch
  s.db.lauf("UPDATE push_abo SET fehler = 'connect ECONNREFUSED 127.0.0.1:1' WHERE benutzer_id = ?", U.mitarbeiter);
  const l = (await ma.get('/push/abos')).daten;
  assert.equal(l[0].fehler, 'Zustellung fehlgeschlagen');
  // unzulässiger Altbestand wird beim Versand entfernt statt angefragt (kein echter Versand im Test)
  s.db.lauf('DELETE FROM push_abo');
  s.db.lauf("INSERT INTO push_abo (benutzer_id, endpoint, p256dh, auth, erstellt) VALUES (?, 'https://127.0.0.1:1/x', 'a', 'b', '2026-11-01T00:00:00Z')", U.mitarbeiter);
  await require('../../server/push').anBenutzer(s.app.bt, U.mitarbeiter, { title: 't', body: 'b' }).catch(() => {});
  assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM push_abo WHERE endpoint LIKE 'https://127.0.0.1%'").n, 0);
});

test('G-07: Testbetrieb meldet Fehler nur mit HTTP-Status', async (t) => {
  const s = await starte({ test: true });
  t.after(() => s.stop());
  const ma = await s.login(U.mitarbeiter);
  assert.equal((await ma.post('/push/abo', { endpoint: 'https://push.example.test/fehler500', keys: { p256dh: 'BPx', auth: 'aa' } })).status, 201);
  await require('../../server/push').anBenutzer(s.app.bt, U.mitarbeiter, { title: 't', body: 'b' });
  assert.equal((await ma.get('/push/abos')).daten[0].fehler, 'Zustellung fehlgeschlagen (HTTP 500)');
});
