'use strict';
/**
 * API.md 15.12 – Korrekturen G2: Sitzung und Push (Befunde G2-019, G2-032, G2-020).
 *  - G2-019/G2-032: Ein Push-Abo gehört zur Sitzung, die es angelegt hat. Endet sie – gleich wie (Abmelden, Ablauf durch
 *    Untätigkeit oder Höchstdauer, Rotation, Bindungsfehler, Deaktivierung, PIN-Wechsel, Sperre …) –, endet das Abo. Vor jedem
 *    Versand wird geprüft, dass eine lebende Sitzung der Person das Abo trägt; sonst werden Abo und Meldung verworfen.
 *  - G2-020: Eine erfolgreiche Anmeldung setzt das kontoweite 24-h-Fenster (20 Fehlversuche) nicht zurück; es gleitet.
 * Jeder Test schlägt ohne die Korrektur fehl.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U } = require('./hilfe');
const { benachrichtige } = require('../../server/benachrichtigung');

const KEYS = { p256dh: 'BPx', auth: 'aa' };
/** Sitzungsgrenzen wie im Betrieb (Feld 12 h, Büro/Bauleiter 60 min, höchstens 24 h) */
const BETRIEB = { feldMin: 720, bueroMin: 60, maxH: 24 };

/** Anmeldung wie die App: mit Bindung (zwei Cookies). → {c, session, bindung} */
async function appLogin(s, benutzerId, extra = {}, cookie = null) {
  const h = { 'content-type': 'application/json' };
  if (cookie) h.cookie = cookie;
  const r = await fetch(`${s.basis}/api/auth/login`, { method: 'POST', headers: h, body: JSON.stringify({ benutzerId, pin: '1234', bindung: true, ...extra }) });
  assert.equal(r.status, 200, `Login ${benutzerId}`);
  const sc = r.headers.getSetCookie();
  const wert = (n) => { const z = sc.find((x) => x.startsWith(`${n}=`)); return z ? z.split(';')[0].slice(n.length + 1) : ''; };
  const session = wert('bt_session'), bindung = wert('bt_bindung');
  return { c: s.client(`bt_session=${session}; bt_bindung=${bindung}`), session, bindung, cookie: `bt_session=${session}; bt_bindung=${bindung}` };
}

let nr = 0;
/** Neue Meldung nur für `benutzerId` (Typ sicherheit, ohne zusätzliche Rechte) → ihr Push-Tag */
function meldung(s, benutzerId, titel) {
  const schluessel = `g2-test:${benutzerId}:${++nr}`;
  benachrichtige(s.db, { benutzerId, typ: 'sicherheit', titel, text: `${titel} – Text`, zeit: s.uhr().toISOString(), schluessel });
  return `bt-${s.db.eins('SELECT id FROM benachrichtigung WHERE benutzer_id = ? AND schluessel = ?', benutzerId, schluessel).id}`;
}
/** Hintergrund-Versand anstoßen; → Pushes an `endpoint` seit dem letzten Aufruf */
async function versand(s, endpoint) {
  s.app.bt.testAusgang.push = [];
  assert.equal((await s.client().post('/test/stuendlich')).status, 200);
  return s.app.bt.testAusgang.push.filter((p) => p.endpoint === endpoint);
}
const abo = (s, endpoint) => s.db.eins('SELECT * FROM push_abo WHERE endpoint = ?', endpoint);

test('15.12 G2-019/G2-032: Push nur, solange die Sitzung lebt, die das Abo angelegt hat', async (t) => {
  const s = await starte({ test: true, sitzung: BETRIEB });
  t.after(() => s.stop());

  await t.test('Gegenprobe: lebende Sitzung → Push wird zugestellt; das Abo trägt die Sitzung', async () => {
    const ep = 'https://tablet-g2.example.test/push/gegenprobe';
    const { c, session } = await appLogin(s, U.polier);
    assert.equal((await c.post('/push/abo', { endpoint: ep, keys: KEYS })).status, 201);
    assert.equal(abo(s, ep).sitzung_hash, require('node:crypto').createHash('sha256').update(session).digest('hex'));
    const tag = meldung(s, U.polier, 'Gegenprobe');
    assert.ok((await versand(s, ep)).some((p) => p.tag === tag), 'Push an das Gerät der angemeldeten Person');
    await c.post('/auth/logout', { endpoint: ep });
  });

  await t.test('G2-019: Sitzung durch Untätigkeit abgelaufen (keine Anfrage, kein Abmelden) → kein Push, Abo weg', async () => {
    const epBl = 'https://bauhof-tablet.example.test/push/geteilt1';
    const epPol = 'https://bauhof-tablet2.example.test/push/geteilt2';
    const bl = await appLogin(s, U.bauleiter);
    const pol = await appLogin(s, U.polier);
    assert.equal((await bl.c.post('/push/abo', { endpoint: epBl, keys: KEYS })).status, 201);
    assert.equal((await pol.c.post('/push/abo', { endpoint: epPol, keys: KEYS })).status, 201);
    s.uhr.plus(13 * 60); // Bauleiter 60 min, Polier 12 h Untätigkeit – niemand fragt den Server
    const tagBl = meldung(s, U.bauleiter, 'Rechnung AR-2026-4711 fällig');
    const tagPol = meldung(s, U.polier, 'Antrag: Urlaub – Daniel Schwarz');
    assert.deepEqual(await versand(s, epBl), [], 'kein Push an das Tablet des Bauleiters');
    assert.deepEqual(await versand(s, epPol), [], 'kein Push an das Tablet des Poliers');
    assert.ok(!abo(s, epBl) && !abo(s, epPol), 'Abos der abgelaufenen Sitzungen gelöscht');
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM sitzung WHERE token_hash IN (?, ?)', ...[bl.session, pol.session].map((x) => require('node:crypto').createHash('sha256').update(x).digest('hex'))).n, 0, 'abgelaufene Sitzungen aufgeräumt');
    for (const tag of [tagBl, tagPol]) {
      const id = Number(tag.slice(3));
      assert.notEqual(s.db.eins('SELECT push FROM benachrichtigung WHERE id = ?', id).push, 'gesendet', 'Meldung verworfen, nicht gesendet');
    }
    // auch später nicht nachgeholt
    assert.equal((await versand(s, epBl)).length + (await versand(s, epPol)).length, 0);
  });

  await t.test('G2-019: Höchstdauer (24 h) trotz laufender Anfragen → kein Push mehr', async () => {
    const ep = 'https://tablet-g2.example.test/push/hoechstdauer';
    const { c } = await appLogin(s, U.polier);
    assert.equal((await c.post('/push/abo', { endpoint: ep, keys: KEYS })).status, 201);
    for (let h = 0; h < 23; h++) { s.uhr.plus(60); assert.equal((await c.get('/auth/ich')).status, 200); }
    const tag = meldung(s, U.polier, 'vor der Höchstdauer');
    assert.ok((await versand(s, ep)).some((p) => p.tag === tag), 'Gegenprobe nach 23 h');
    s.uhr.plus(61); // > 24 h seit der Anmeldung, letzte Anfrage vor 61 min (Feld: noch nicht untätig)
    meldung(s, U.polier, 'nach der Höchstdauer');
    assert.deepEqual(await versand(s, ep), []);
    assert.ok(!abo(s, ep));
  });

  await t.test('G2-032: abgelaufene Sitzung, 401 bei der nächsten Anfrage, Abmelden mit endpoint → Abo trotzdem weg', async () => {
    const ep = 'https://push.example.test/geteiltes-tablet-1';
    const { c } = await appLogin(s, U.polier2);
    assert.equal((await c.post('/push/abo', { endpoint: ep, keys: KEYS, geraet: 'Tablet Bauhof' })).status, 201);
    s.uhr.plus(13 * 60);
    assert.equal((await c.get('/auth/ich')).status, 401); // Server löscht die Sitzung
    assert.equal((await c.post('/auth/logout', { endpoint: ep })).status, 200);
    assert.ok(!abo(s, ep), 'Abo der Sitzung gelöscht');
    meldung(s, U.polier2, 'Bericht zur Freigabe: Zufahrt Kogler');
    assert.deepEqual(await versand(s, ep), []);
  });

  await t.test('Rotation: neue Anmeldung mit dem alten Cookie beendet die alte Sitzung samt Abo', async () => {
    const ep = 'https://tablet-g2.example.test/push/rotation';
    const alt = await appLogin(s, U.buero);
    assert.equal((await alt.c.post('/push/abo', { endpoint: ep, keys: KEYS })).status, 201);
    await appLogin(s, U.buero, {}, alt.cookie); // dieselbe Person, ohne pushEndpoint
    assert.ok(!abo(s, ep), 'Abo der rotierten Sitzung gelöscht');
  });

  await t.test('Bindungsfehler (Abmelden ohne Netz, Cookie ohne bt_bindung) beendet Sitzung und Abo sofort', async () => {
    const ep = 'https://tablet-g2.example.test/push/bindung';
    const { c, session } = await appLogin(s, U.mitarbeiter);
    assert.equal((await c.post('/push/abo', { endpoint: ep, keys: KEYS })).status, 201);
    assert.equal((await s.client(`bt_session=${session}`).get('/auth/ich')).status, 401);
    assert.ok(!abo(s, ep));
  });

  await t.test('Deaktivierung, eigener PIN-Wechsel (andere Sitzungen) und jede andere Löschung der Sitzung enden das Abo', async () => {
    const gf = await s.login(U.gf);
    // eigener PIN-Wechsel: die anderen Sitzungen der Person enden – mit ihren Abos; das Abo der wechselnden Sitzung bleibt
    const tablet = await appLogin(s, U.mitarbeiter);
    const handy = await appLogin(s, U.mitarbeiter);
    assert.equal((await tablet.c.post('/push/abo', { endpoint: 'https://tablet-g2.example.test/push/pin-a', keys: KEYS })).status, 201);
    assert.equal((await handy.c.post('/push/abo', { endpoint: 'https://tablet-g2.example.test/push/pin-b', keys: KEYS })).status, 201);
    assert.equal((await handy.c.post('/auth/pin', { alt: '1234', neu: '4826' })).status, 200);
    assert.ok(!abo(s, 'https://tablet-g2.example.test/push/pin-a'), 'Abo der beendeten Sitzung');
    assert.ok(abo(s, 'https://tablet-g2.example.test/push/pin-b'), 'Abo der eigenen Sitzung bleibt');
    // Löschen der Sitzung auf beliebigem Weg (hier direkt, wie entsperren.js oder 2FA) → Trigger löscht das Abo
    s.db.lauf('DELETE FROM sitzung WHERE benutzer_id = ?', U.mitarbeiter);
    assert.ok(!abo(s, 'https://tablet-g2.example.test/push/pin-b'));
    // Deaktivierung
    const ep = 'https://tablet-g2.example.test/push/deaktiviert';
    const { c } = await appLogin(s, U.polier2);
    assert.equal((await c.post('/push/abo', { endpoint: ep, keys: KEYS })).status, 201);
    assert.equal((await gf.put(`/benutzer/${U.polier2}`, { aktiv: false })).status, 200);
    assert.ok(!abo(s, ep));
  });

  await t.test('Abo ohne lebende Sitzung der Person (Altbestand, fremde Sitzung) → verworfen, kein Push', async () => {
    const pol = await appLogin(s, U.polier); // die Person hat eine lebende Sitzung – aber keine, die diese Abos trägt
    const ep1 = 'https://tablet-g2.example.test/push/altbestand';
    const ep2 = 'https://tablet-g2.example.test/push/fremd';
    s.db.lauf("INSERT INTO push_abo (benutzer_id, endpoint, p256dh, auth, erstellt) VALUES (?, ?, 'BPx', 'aa', '2026-11-01T00:00:00Z')", U.polier, ep1);
    const fremd = s.db.eins('SELECT token_hash FROM sitzung WHERE benutzer_id = ?', U.gf); // lebende Sitzung einer anderen Person
    s.db.lauf("INSERT INTO push_abo (benutzer_id, endpoint, p256dh, auth, erstellt, sitzung_hash) VALUES (?, ?, 'BPx', 'aa', '2026-11-01T00:00:00Z', ?)", U.polier, ep2, fremd.token_hash);
    meldung(s, U.polier, 'Altbestand');
    assert.deepEqual(await versand(s, ep1), []);
    assert.deepEqual(await versand(s, ep2), []);
    assert.ok(!abo(s, ep1) && !abo(s, ep2));
    await pol.c.post('/auth/logout');
  });

  await t.test('Stündlicher Lauf räumt abgelaufene Sitzungen samt Abos auf', async () => {
    const ep = 'https://tablet-g2.example.test/push/stuendlich';
    const { c } = await appLogin(s, U.buero);
    assert.equal((await c.post('/push/abo', { endpoint: ep, keys: KEYS })).status, 201);
    s.uhr.plus(61); // Büro: 60 min
    s.app.bt.stuendlich();
    assert.ok(!abo(s, ep));
  });
});

test('15.12 G2-019: „Eigenes Handy“ – Abo lebt so lange wie die Sitzung (höchstens 24 h), nach neuer Anmeldung neu anlegbar', async (t) => {
  const s = await starte({ test: true, sitzung: BETRIEB });
  t.after(() => s.stop());
  const ep = 'https://handy.example.test/push/eigen-g2';
  const a = await appLogin(s, U.polier, { geraet: 'eigen' });
  assert.equal((await a.c.post('/push/abo', { endpoint: ep, keys: KEYS })).status, 201);
  s.uhr.plus(10 * 60);
  const tag = meldung(s, U.polier, 'nach 10 h');
  assert.ok((await versand(s, ep)).some((p) => p.tag === tag), 'innerhalb der Sitzung zugestellt');
  s.uhr.plus(12 * 60 + 1);
  meldung(s, U.polier, 'nach Ablauf');
  assert.deepEqual(await versand(s, ep), []);
  const b = await appLogin(s, U.polier, { pushEndpoint: ep });
  assert.equal((await b.c.post('/push/abo', { endpoint: ep, keys: KEYS })).status, 201, 'nach der nächsten Anmeldung neu einschalten');
  const tag2 = meldung(s, U.polier, 'neue Sitzung');
  assert.ok((await versand(s, ep)).some((p) => p.tag === tag2));
});

/* ---------- G2-020: kontoweiter Zähler ---------- */

test('15.12 G2-020: erfolgreiche Anmeldung setzt das kontoweite 24-h-Fenster nicht zurück', async (t) => {
  const s = await starte({ test: true, trustProxy: true });
  t.after(() => s.stop());
  let ip = 0;
  const neueIp = () => `198.51.${100 + Math.floor(ip / 250)}.${(ip++ % 250) + 1}`; // jede Anfrage aus einer anderen Adresse
  const falsch = async () => (await s.client(null, neueIp()).post('/auth/login', { benutzerId: 4, pin: '9999' })).status;
  const richtig = async () => (await s.client(null, neueIp()).post('/auth/login', { benutzerId: 4, pin: '1234' })).status;
  const statusse = {};
  outer: for (let runde = 0; runde < 3; runde++) {
    for (let i = 0; i < 19; i++) {
      const st = await falsch();
      statusse[st] = (statusse[st] || 0) + 1;
      if (st === 423) break outer;
      s.uhr.plus(1);
    }
    const ok = await richtig(); // die echte Person meldet sich zwischendurch an
    statusse[`ok:${ok}`] = (statusse[`ok:${ok}`] || 0) + 1;
    if (ok === 423) break;
  }
  assert.equal(statusse[401], 19, JSON.stringify(statusse));
  assert.equal(statusse[423], 1, `der 20. Fehlversuch in 24 h sperrt trotz Zwischenanmeldung: ${JSON.stringify(statusse)}`);
  assert.equal(statusse['ok:200'], 1);
  assert.equal(s.db.eins('SELECT gesperrt FROM login_konto WHERE benutzer_id = 4').gesperrt, 1);
  assert.equal(await richtig(), 423, 'gesperrt – auch mit richtiger PIN');
  assert.ok(s.db.eins("SELECT 1 AS x FROM benachrichtigung WHERE titel LIKE 'Konto gesperrt:%' AND benutzer_id = ?", U.gf), 'Büro/GF benachrichtigt');
});

test('15.12 G2-020: gleitendes Fenster – es zählen die Fehlversuche der letzten 24 h, nicht ein festes Fenster ab dem ersten', async (t) => {
  const s = await starte({ test: true, trustProxy: true });
  t.after(() => s.stop());
  let ip = 0;
  const falsch = async () => (await s.client(null, `203.0.113.${++ip}`).post('/auth/login', { benutzerId: 4, pin: '9999' })).status;
  for (let i = 0; i < 10; i++) assert.equal(await falsch(), 401);
  s.uhr.plus(20 * 60);
  for (let i = 0; i < 9; i++) assert.equal(await falsch(), 401);
  s.uhr.plus(5 * 60); // 25 h nach den ersten 10 – diese zählen nicht mehr, die 9 von vor 5 h schon
  for (let i = 0; i < 10; i++) assert.equal(await falsch(), 401, `Versuch ${i + 1} (Fenster ${9 + i + 1})`);
  assert.equal(await falsch(), 423, '20 Fehlversuche innerhalb von 24 h → gesperrt (ein festes Fenster ab dem ersten Fehlversuch hätte neu begonnen)');
});

test('15.12 G2-020: eigene Tippfehler sperren nicht aus; der kurze Zähler je Gerät/IP wird durch die Anmeldung zurückgesetzt', async (t) => {
  const s = await starte({ test: true, trustProxy: true });
  t.after(() => s.stop());
  const tablet = '10.20.30.40';
  const versuch = async (pin) => (await s.client(null, tablet).post('/auth/login', { benutzerId: 4, pin })).status;
  // 30 Arbeitstage: morgens zwei Tippfehler, dann richtig; nachmittags ein Tippfehler, dann richtig
  for (let tag = 0; tag < 30; tag++) {
    assert.equal(await versuch('9999'), 401); assert.equal(await versuch('9998'), 401);
    assert.equal(await versuch('1234'), 200, `Tag ${tag + 1} morgens`);
    s.uhr.plus(9 * 60);
    assert.equal(await versuch('9997'), 401);
    assert.equal(await versuch('1234'), 200, `Tag ${tag + 1} nachmittags`);
    s.uhr.plus(15 * 60);
  }
  // Kurzer Zähler je (Person, IP): 4 Fehler, Anmeldung, wieder 4 Fehler → keine 5-min-Sperre (die Anmeldung setzt ihn zurück)
  for (let i = 0; i < 4; i++) assert.equal(await versuch('9999'), 401);
  assert.equal(await versuch('1234'), 200);
  for (let i = 0; i < 4; i++) assert.equal(await versuch('9999'), 401);
  assert.equal(await versuch('1234'), 200, 'kurzer Zähler nach der Anmeldung zurückgesetzt');
  // kontoweit zählen nur die Fehlversuche der letzten 24 h: der von heute Nachmittag (vor 15 h) und die 8 eben
  assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM login_konto_fehler WHERE benutzer_id = 4').n, 9);
  assert.equal(s.db.eins('SELECT gesperrt FROM login_konto WHERE benutzer_id = 4').gesperrt, 0);
  // Gegenprobe: das Fenster gilt trotz der Anmeldungen – 11 weitere Fehlversuche (= 20 in 24 h) sperren. Entsperren leert es.
  const gf = await s.login(U.gf, '1234', '10.9.9.9');
  for (let i = 0; i < 10; i++) assert.equal((await s.client(null, `192.0.2.${i + 1}`).post('/auth/login', { benutzerId: 4, pin: '9999' })).status, 401);
  assert.equal((await s.client(null, '192.0.2.50').post('/auth/login', { benutzerId: 4, pin: '9999' })).status, 423);
  assert.equal((await gf.post('/benutzer/4/entsperren')).status, 200);
  assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM login_konto_fehler WHERE benutzer_id = 4').n, 0);
  assert.equal((await s.client(null, '192.0.2.60').post('/auth/login', { benutzerId: 4, pin: '9999' })).status, 401, 'nach dem Entsperren beginnt das Fenster neu');
});
