'use strict';
/**
 * API.md 15.28 – PIN nur einmal pro Woche auf dem eigenen Gerät (Inhaber 19.11.2026).
 * Anmeldung der App (`bindung: true`) mit der Gerätewahl `geraet: "eigen"` → Sitzung bis Montag 00:00 Wiener Zeit, ohne
 * Untätigkeitsgrenze, für jede Rolle. „Geteiltes Gerät“ und alles andere bleibt bei den bisherigen Regeln (Feld 12 h, Büro 60 min
 * Untätigkeit, höchstens 24 h). Die Wahl bestimmt nur die Lebensdauer – nie Rolle, Rechte, Sperrzeit am Gerät oder Bindung.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U } = require('./hilfe');
const auth = require('../../server/auth');
const T = require('../../server/totp');

const ROLLEN = { mitarbeiter: U.mitarbeiter, polier: U.polier, bauleiter: U.bauleiter, buero: U.buero, gf: U.gf };
const MI = '2026-11-18T09:00:00.000Z';            // Mittwoch 18.11.2026, 10:00 Wiener Zeit
const WOCHENENDE = '2026-11-22T23:00:00.000Z';    // Montag 23.11.2026, 00:00 Wiener Zeit (Winterzeit, UTC+1)
const ECHT = {};                                  // echte Standardgrenzen: Feld 720 min, Büro 60 min, höchstens 24 h, Sperre Feld 30 min

/** Anmeldung wie die App: mit Bindung und Gerätewahl → {c, setCookie, session, bindung} (Client mit beiden Cookies) */
async function appLogin(s, benutzerId, opt = {}) {
  const { bindung = true, pin = '1234', geraet: _g, ...extra } = opt; // eslint-disable-line no-unused-vars
  const geraet = 'geraet' in opt ? opt.geraet : 'eigen'; // ausdrücklich undefined = ohne Angabe (ältere App-Stände)
  const r = await fetch(`${s.basis}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ benutzerId, pin, bindung, geraet, ...extra }) });
  assert.equal(r.status, 200, `Anmeldung ${benutzerId}`);
  return ausAntwort(s, r);
}
function ausAntwort(s, r) {
  const sc = r.headers.getSetCookie();
  const wert = (n) => { const z = sc.find((x) => x.startsWith(`${n}=`)); return z ? z.split(';')[0].slice(n.length + 1) : ''; };
  const session = wert('bt_session'), bindung = wert('bt_bindung');
  return { c: s.client(`bt_session=${session}${bindung ? `; bt_bindung=${bindung}` : ''}`), setCookie: sc, session, bindung };
}
const sitzungen = (s, id) => s.db.eins('SELECT COUNT(*) AS n FROM sitzung WHERE benutzer_id = ?', id).n;

test('15.28: Wochenende = Montag 00:00 Wiener Zeit – auch über Sommer-/Winterzeit', () => {
  const fall = [
    ['2026-11-18T09:00:00.000Z', WOCHENENDE, 'Mittwoch'],
    ['2026-11-22T22:30:00.000Z', WOCHENENDE, 'Sonntag 23:30'],
    ['2026-11-22T22:59:59.999Z', WOCHENENDE, 'Sonntag 23:59:59'],
    ['2026-11-22T23:00:00.000Z', '2026-11-29T23:00:00.000Z', 'Montag 00:00 → nächste Woche'],
    ['2026-11-16T00:30:00.000Z', WOCHENENDE, 'Montag 01:30'],
    // letzter Sonntag im März 2027 (28.03.): 02:00 → 03:00, das Wochenende liegt danach in der Sommerzeit (UTC+2)
    ['2027-03-24T09:00:00.000Z', '2027-03-28T22:00:00.000Z', 'Woche der Umstellung auf Sommerzeit'],
    ['2027-03-28T00:30:00.000Z', '2027-03-28T22:00:00.000Z', 'Sonntag 01:30 vor der Umstellung'],
    ['2027-03-28T21:30:00.000Z', '2027-03-28T22:00:00.000Z', 'Sonntag 23:30 nach der Umstellung'],
    ['2027-03-28T22:00:00.000Z', '2027-04-04T22:00:00.000Z', 'Montag 00:00 nach der Umstellung'],
    ['2027-03-21T22:30:00.000Z', '2027-03-21T23:00:00.000Z', 'Sonntag 23:30 vor der Umstellungswoche (noch Winterzeit)'],
    // letzter Sonntag im Oktober 2026 (25.10.): 03:00 → 02:00, das Wochenende liegt danach in der Winterzeit (UTC+1)
    ['2026-10-21T08:00:00.000Z', '2026-10-25T23:00:00.000Z', 'Woche der Umstellung auf Winterzeit'],
    ['2026-10-25T00:30:00.000Z', '2026-10-25T23:00:00.000Z', 'Sonntag 02:30 (erstes Mal)'],
    ['2026-10-25T01:30:00.000Z', '2026-10-25T23:00:00.000Z', 'Sonntag 02:30 (zweites Mal)'],
    ['2026-10-25T22:30:00.000Z', '2026-10-25T23:00:00.000Z', 'Sonntag 23:30 nach der Umstellung'],
    ['2026-10-18T21:30:00.000Z', '2026-10-18T22:00:00.000Z', 'Sonntag 23:30 vor der Umstellungswoche (noch Sommerzeit)'],
    ['2026-12-31T23:30:00.000Z', '2027-01-03T23:00:00.000Z', 'Jahreswechsel (Fr 01.01.2027 00:30)']
  ];
  for (const [jetzt, soll, was] of fall) assert.equal(auth.wochenEnde(new Date(jetzt)).toISOString(), soll, was);
});

test('15.28: „Eigenes Handy“ – jede Rolle bleibt bis Sonntag 24:00 angemeldet, unabhängig von Untätigkeit; Montag 00:00 endet die Sitzung', async () => {
  const s = await starte({ sitzung: ECHT, start: MI });
  try {
    for (const [rolle, id] of Object.entries(ROLLEN)) {
      s.uhr.setze(MI);
      const geteilt = await appLogin(s, id, { geraet: 'geteilt' });
      const g = (await geteilt.c.get('/auth/ich')).daten;
      const e = await appLogin(s, id);
      const ich = (await e.c.get('/auth/ich')).daten;
      assert.equal(ich.sitzungArt, 'woche', rolle);
      assert.equal(ich.sitzungBis, WOCHENENDE, rolle);
      assert.equal(g.sitzungArt, 'normal', rolle);
      assert.equal(g.sitzungBis, null, rolle);
      // nur die Lebensdauer: Rolle, Rechte, Sperrzeit und Sitzungsdauer wie bei der Anmeldung als geteiltes Gerät
      assert.equal(ich.benutzer.rolle, g.benutzer.rolle);
      assert.deepEqual([...ich.rechte].sort(), [...g.rechte].sort(), `${rolle}: Rechte`);
      assert.equal(ich.sperreMinuten, g.sperreMinuten, `${rolle}: sperreMinuten`);
      assert.equal(ich.sitzungMinuten, g.sitzungMinuten, `${rolle}: sitzungMinuten`);
      const z = s.db.eins('SELECT art, bis, bindung_hash FROM sitzung WHERE token_hash = ?', auth.sha256(e.session));
      assert.equal(z.art, 'woche'); assert.equal(z.bis, WOCHENENDE); assert.ok(z.bindung_hash, 'Wochen-Sitzung ist gebunden');
      // Mittwoch 10:00 → Donnerstag 06:00 (20 h ohne Anfrage): weiter angemeldet (Büro sonst 60 min, Feld 12 h)
      s.uhr.plus(20 * 60);
      assert.equal((await e.c.get('/auth/ich')).status, 200, `${rolle}: nach 20 h ohne Anfrage abgemeldet`);
      assert.equal((await geteilt.c.get('/auth/ich')).status, 401, `${rolle}: geteiltes Gerät nach 20 h ohne Anfrage noch angemeldet`);
      // über die Höchstdauer von 24 h hinaus und 3 Tage ohne Anfrage: Sonntag 23:59 noch angemeldet
      s.uhr.setze('2026-11-22T22:59:00.000Z');
      assert.equal((await e.c.get('/auth/ich')).status, 200, `${rolle}: Sonntag 23:59 abgemeldet`);
      s.uhr.setze(WOCHENENDE);
      assert.equal((await e.c.get('/auth/ich')).status, 401, `${rolle}: Montag 00:00 noch angemeldet`);
      assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM sitzung WHERE token_hash = ?', auth.sha256(e.session)).n, 0, `${rolle}: abgelaufene Sitzung nicht gelöscht`);
      // Montag früh: einmal die PIN, dann wieder die ganze Woche
      const neu = await appLogin(s, id);
      assert.equal((await neu.c.get('/auth/ich')).daten.sitzungBis, '2026-11-29T23:00:00.000Z', `${rolle}: neue Woche`);
    }
  } finally { await s.stop(); }
});

test('15.28: „Geteiltes Gerät“ und alles außer genau „eigen“ mit Bindung bleibt wie bisher', async () => {
  const s = await starte({ sitzung: ECHT, start: MI });
  try {
    // Büro geteilt: 60 min Untätigkeit
    const b = await appLogin(s, U.buero, { geraet: 'geteilt' });
    s.uhr.plus(59);
    assert.equal((await b.c.get('/auth/ich')).status, 200);
    s.uhr.plus(61);
    assert.equal((await b.c.get('/auth/ich')).status, 401, 'Büro am geteilten Gerät nach 61 min ohne Anfrage angemeldet');
    // Mitarbeiter geteilt: 12 h Untätigkeit, 24 h Höchstdauer, Sperre am Gerät 30 min
    s.uhr.setze(MI);
    const m = await appLogin(s, U.mitarbeiter, { geraet: 'geteilt' });
    const ich = (await m.c.get('/auth/ich')).daten;
    assert.deepEqual([ich.sperreMinuten, ich.sitzungMinuten, ich.sitzungArt, ich.sitzungBis], [30, 720, 'normal', null]);
    s.uhr.plus(10 * 60);
    assert.equal((await m.c.get('/auth/ich')).status, 200, 'Mitarbeiter nach 10 h abgemeldet');
    s.uhr.plus(12 * 60 + 1);
    assert.equal((await m.c.get('/auth/ich')).status, 401, 'Mitarbeiter am geteilten Gerät nach 12 h ohne Anfrage angemeldet');
    s.uhr.setze(MI);
    const m2 = await appLogin(s, U.mitarbeiter, { geraet: 'geteilt' });
    for (let h = 0; h < 23; h += 2) { s.uhr.plus(120); assert.equal((await m2.c.get('/auth/ich')).status, 200, `nach ${h + 2} h`); }
    s.uhr.plus(61);
    assert.equal((await m2.c.get('/auth/ich')).status, 401, 'geteiltes Gerät über die Höchstdauer angemeldet');
    // andere Werte → normal (auch ohne Angabe, wie ältere App-Stände)
    s.uhr.setze(MI);
    for (const geraet of [undefined, 'EIGEN', 'eigen ', 'Eigen', true, 1, ['eigen'], { art: 'eigen' }, 'woche']) {
      const x = await appLogin(s, U.buero, { geraet });
      assert.equal((await x.c.get('/auth/ich')).daten.sitzungArt, 'normal', `geraet ${JSON.stringify(geraet)}`);
      assert.ok(!x.setCookie.some((c) => /Max-Age=[1-9]/.test(c)), `geraet ${JSON.stringify(geraet)}: Cookie mit Ablaufzeit`);
    }
    // „eigen“ ohne Bindung (API-Client, kein App-Gerät) → normal
    const roh = await fetch(`${s.basis}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ benutzerId: U.buero, pin: '1234', geraet: 'eigen' }) });
    const ohne = ausAntwort(s, roh);
    assert.equal(ohne.bindung, '');
    assert.equal((await ohne.c.get('/auth/ich')).daten.sitzungArt, 'normal', '„eigen“ ohne Bindung ergibt eine Wochen-Sitzung');
    s.uhr.plus(61);
    assert.equal((await ohne.c.get('/auth/ich')).status, 401);
  } finally { await s.stop(); }
});

test('15.28: Cookies der Wochen-Sitzung halten bis zum Wochenende; Bindung, Abmelden und Rotation bleiben', async () => {
  const s = await starte({ sitzung: ECHT, start: MI });
  try {
    const e = await appLogin(s, U.polier);
    const rest = Math.floor((new Date(WOCHENENDE).getTime() - new Date(MI).getTime()) / 1000);
    const sess = e.setCookie.find((c) => c.startsWith('bt_session='));
    const bind = e.setCookie.find((c) => c.startsWith('bt_bindung='));
    assert.match(sess, new RegExp(`Max-Age=${rest}(;|$)`), sess);
    assert.match(sess, /HttpOnly/);
    assert.match(sess, /SameSite=Strict/);
    assert.match(bind, new RegExp(`Max-Age=${rest}(;|$)`), bind);
    assert.doesNotMatch(bind, /HttpOnly/);
    // geteilt: Sitzungs-Cookies ohne Ablaufzeit wie bisher
    const g = await appLogin(s, U.mitarbeiter, { geraet: 'geteilt' });
    assert.ok(g.setCookie.every((c) => !/Max-Age/.test(c)), g.setCookie.join(' | '));
    // ohne Bindungs-Cookie gilt die Wochen-Sitzung nicht (und wird gelöscht)
    const nurToken = s.client(`bt_session=${e.session}`);
    assert.equal((await nurToken.get('/auth/ich')).status, 401, 'Wochen-Sitzung ohne Bindungs-Cookie gültig');
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM sitzung WHERE token_hash = ?', auth.sha256(e.session)).n, 0);
    assert.equal((await e.c.get('/auth/ich')).status, 401);
    // falsches Bindungs-Cookie
    const e2 = await appLogin(s, U.polier);
    assert.equal((await s.client(`bt_session=${e2.session}; bt_bindung=${'a'.repeat(64)}`).get('/auth/ich')).status, 401);
    // Abmelden beendet die Wochen-Sitzung sofort
    const e3 = await appLogin(s, U.polier);
    assert.equal((await e3.c.post('/auth/logout', {})).status, 200);
    assert.equal((await s.client(`bt_session=${e3.session}; bt_bindung=${e3.bindung}`).get('/auth/ich')).status, 401, 'nach dem Abmelden noch angemeldet');
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM sitzung WHERE token_hash = ?', auth.sha256(e3.session)).n, 0);
    // Rotation: eine neue Anmeldung mit dem alten Cookie beendet die alte Wochen-Sitzung
    const e4 = await appLogin(s, U.polier);
    const r = await fetch(`${s.basis}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `bt_session=${e4.session}; bt_bindung=${e4.bindung}` }, body: JSON.stringify({ benutzerId: U.polier, pin: '1234', bindung: true, geraet: 'eigen' }) });
    assert.equal(r.status, 200);
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM sitzung WHERE token_hash = ?', auth.sha256(e4.session)).n, 0, 'alte Wochen-Sitzung bleibt nach neuer Anmeldung');
  } finally { await s.stop(); }
});

test('15.28: Sonntag 23:30 angemeldet → um Mitternacht vorbei; Montag 00:00 angemeldet → die ganze Woche', async () => {
  const s = await starte({ sitzung: ECHT, start: '2026-11-22T22:30:00.000Z' });
  try {
    const e = await appLogin(s, U.buero);
    assert.equal((await e.c.get('/auth/ich')).daten.sitzungBis, WOCHENENDE);
    assert.match(e.setCookie.find((c) => c.startsWith('bt_session=')), /Max-Age=1800(;|$)/);
    s.uhr.plus(29);
    assert.equal((await e.c.get('/auth/ich')).status, 200);
    s.uhr.setze(WOCHENENDE);
    assert.equal((await e.c.get('/auth/ich')).status, 401, 'Sonntag 23:30 angemeldet, Montag 00:00 noch gültig');
    const m = await appLogin(s, U.buero);
    assert.equal((await m.c.get('/auth/ich')).daten.sitzungBis, '2026-11-29T23:00:00.000Z');
    s.uhr.setze('2026-11-29T22:59:59.000Z'); // Sonntag 23:59:59 – 7 Tage ohne Anfrage
    assert.equal((await m.c.get('/auth/ich')).status, 200);
    s.uhr.setze('2026-11-29T23:00:00.000Z');
    assert.equal((await m.c.get('/auth/ich')).status, 401);
  } finally { await s.stop(); }
});

test('15.28: Sommer-/Winterzeit – die Sitzung endet am Montag 00:00 Wiener Zeit', async () => {
  for (const [start, letzteMinute, ende] of [
    ['2027-03-24T09:00:00.000Z', '2027-03-28T21:59:00.000Z', '2027-03-28T22:00:00.000Z'], // März: Ende in der Sommerzeit
    ['2026-10-21T08:00:00.000Z', '2026-10-25T22:59:00.000Z', '2026-10-25T23:00:00.000Z'], // Oktober: Ende in der Winterzeit
    ['2027-03-28T00:30:00.000Z', '2027-03-28T21:59:00.000Z', '2027-03-28T22:00:00.000Z'], // Sonntag vor der Umstellung angemeldet
    ['2026-10-25T01:30:00.000Z', '2026-10-25T22:59:00.000Z', '2026-10-25T23:00:00.000Z'] // Sonntag 02:30 (zweites Mal)
  ]) {
    const s = await starte({ sitzung: ECHT, start });
    try {
      const e = await appLogin(s, U.mitarbeiter);
      assert.equal((await e.c.get('/auth/ich')).daten.sitzungBis, ende, start);
      s.uhr.setze(letzteMinute);
      assert.equal((await e.c.get('/auth/ich')).status, 200, `${start}: Sonntag 23:59 abgemeldet`);
      s.uhr.setze(ende);
      assert.equal((await e.c.get('/auth/ich')).status, 401, `${start}: Montag 00:00 angemeldet`);
    } finally { await s.stop(); }
  }
});

test('15.28: Wechsel in „Mehr“ – eigen → geteilt kürzt sofort, geteilt → eigen erst ab der nächsten Anmeldung', async () => {
  const s = await starte({ sitzung: ECHT, start: MI });
  try {
    assert.equal((await s.client().post('/auth/geraet', { art: 'geteilt' })).status, 401);
    const e = await appLogin(s, U.buero);
    for (const art of [undefined, '', 'EIGEN', 'woche', 1, null]) assert.equal((await e.c.post('/auth/geraet', art === undefined ? {} : { art })).status, 400, `art ${JSON.stringify(art)}`);
    // „eigen“ an einer Wochen-Sitzung ändert nichts
    assert.deepEqual((await e.c.post('/auth/geraet', { art: 'eigen' })).daten, { sitzungArt: 'woche', sitzungBis: WOCHENENDE });
    s.uhr.plus(5 * 60); // 5 h ohne Anfrage – Wochen-Sitzung
    const w = await e.c.post('/auth/geraet', { art: 'geteilt' });
    assert.equal(w.status, 200);
    assert.deepEqual(w.daten, { sitzungArt: 'normal', sitzungBis: null });
    assert.equal((await e.c.get('/auth/ich')).daten.sitzungArt, 'normal');
    assert.equal(s.db.eins('SELECT art FROM sitzung WHERE token_hash = ?', auth.sha256(e.session)).art, 'normal');
    assert.ok(s.db.eins("SELECT 1 AS x FROM protokoll WHERE text LIKE '%Geteiltes Gerät%' AND objekt = ?", `benutzer:${U.buero}`), 'Wechsel nicht protokolliert');
    // ab jetzt normale Regeln: Büro 60 min Untätigkeit
    s.uhr.plus(59);
    assert.equal((await e.c.get('/auth/ich')).status, 200);
    s.uhr.plus(61);
    assert.equal((await e.c.get('/auth/ich')).status, 401, 'nach dem Wechsel auf „geteilt“ gilt die Woche weiter');
    // zurück auf „eigen“ verlängert eine normale Sitzung nie (sonst ginge das an einem geteilten Gerät ohne PIN)
    s.uhr.setze(MI);
    const g = await appLogin(s, U.buero, { geraet: 'geteilt' });
    assert.deepEqual((await g.c.post('/auth/geraet', { art: 'eigen' })).daten, { sitzungArt: 'normal', sitzungBis: null });
    s.uhr.plus(61);
    assert.equal((await g.c.get('/auth/ich')).status, 401, '„eigen“ in „Mehr“ verlängert die laufende Sitzung');
    // Feldrolle wechselt Sonntag 23:30 auf „geteilt“: normale Regeln, aber nie über das Wochenende hinaus
    s.uhr.setze(MI);
    const p = await appLogin(s, U.polier);
    s.uhr.setze('2026-11-22T22:30:00.000Z');
    assert.equal((await p.c.post('/auth/geraet', { art: 'geteilt' })).daten.sitzungArt, 'normal');
    s.uhr.plus(29);
    assert.equal((await p.c.get('/auth/ich')).status, 200);
    s.uhr.setze(WOCHENENDE);
    assert.equal((await p.c.get('/auth/ich')).status, 401, 'Wechsel auf „geteilt“ verlängert über das Wochenende hinaus');
    // Mitarbeiter: nach dem Wechsel gilt die Höchstdauer ab dem Wechsel (24 h), nicht ab der Anmeldung am Montag
    s.uhr.setze('2026-11-16T06:00:00.000Z'); // Montag 07:00
    const m = await appLogin(s, U.mitarbeiter);
    s.uhr.setze('2026-11-18T06:00:00.000Z'); // Mittwoch 07:00
    assert.equal((await m.c.post('/auth/geraet', { art: 'geteilt' })).status, 200);
    for (let h = 0; h < 22; h += 2) { s.uhr.plus(120); assert.equal((await m.c.get('/auth/ich')).status, 200, `nach dem Wechsel ${h + 2} h`); }
    s.uhr.plus(3 * 60);
    assert.equal((await m.c.get('/auth/ich')).status, 401, 'Höchstdauer nach dem Wechsel nicht wirksam');
  } finally { await s.stop(); }
});

test('15.28: PIN-Reset, Deaktivierung und Rollenwechsel durch das Büro beenden auch Wochen-Sitzungen; eigener PIN-Wechsel behält die eigene', async () => {
  const s = await starte({ sitzung: ECHT, start: MI });
  try {
    const gf = await appLogin(s, U.gf);
    const ma = await appLogin(s, U.mitarbeiter);
    assert.equal((await gf.c.put(`/benutzer/${U.mitarbeiter}`, { pin: '864213' })).status, 200);
    assert.equal((await ma.c.get('/auth/ich')).status, 401, 'PIN-Reset beendet die Wochen-Sitzung nicht');
    assert.equal(sitzungen(s, U.mitarbeiter), 0);
    const p5 = await appLogin(s, 5);
    assert.equal((await gf.c.put('/benutzer/5', { aktiv: false })).status, 200);
    assert.equal((await p5.c.get('/auth/ich')).status, 401, 'Deaktivierung beendet die Wochen-Sitzung nicht');
    const p6 = await appLogin(s, 6);
    assert.equal((await gf.c.put('/benutzer/6', { rolle: 'polier' })).status, 200);
    assert.equal((await p6.c.get('/auth/ich')).status, 401, 'Rollenwechsel beendet die Wochen-Sitzung nicht');
    // eigene PIN ändern: die eigene Wochen-Sitzung bleibt, andere enden
    const a = await appLogin(s, U.polier), b = await appLogin(s, U.polier);
    assert.equal((await a.c.post('/auth/pin', { alt: '1234', neu: '583920' })).status, 200);
    assert.equal((await a.c.get('/auth/ich')).daten.sitzungArt, 'woche');
    assert.equal((await b.c.get('/auth/ich')).status, 401);
    // stündliches Aufräumen löscht Wochen-Sitzungen erst nach dem Wochenende
    s.uhr.setze('2026-11-21T09:00:00.000Z');
    auth.abgelaufeneSitzungenLoeschen(s.db, s.uhr(), s.app.bt.sitzung);
    assert.equal(sitzungen(s, U.polier), 1, 'Aufräumen löscht die Wochen-Sitzung vor dem Wochenende');
    s.uhr.setze(WOCHENENDE);
    auth.abgelaufeneSitzungenLoeschen(s.db, s.uhr(), s.app.bt.sitzung);
    assert.equal(sitzungen(s, U.polier), 0, 'Aufräumen lässt die abgelaufene Wochen-Sitzung stehen');
  } finally { await s.stop(); }
});

test('15.28: Anmeldesperren unverändert; mit Zwei-Faktor-Anmeldung kommt die Woche erst nach dem Code', async () => {
  const s = await starte({ sitzung: ECHT, start: MI });
  try {
    // 5 falsche PINs (auch mit „eigen“) → 429, richtige PIN dann ebenfalls gesperrt
    let st;
    for (let i = 0; i < 5; i++) st = (await fetch(`${s.basis}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ benutzerId: 5, pin: String(480000 + i), bindung: true, geraet: 'eigen' }) })).status;
    assert.equal(st, 429);
    assert.equal((await fetch(`${s.basis}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ benutzerId: 5, pin: '1234', bindung: true, geraet: 'eigen' }) })).status, 429);
    assert.equal(sitzungen(s, 5), 0);
    // Zwei-Faktor für das Büro einrichten
    const b0 = await s.login(U.buero);
    const r = await b0.post('/auth/2fa/einrichten', { pin: '1234' });
    assert.equal(r.status, 200);
    const code = () => T.totp(T.base32Dekodieren(r.daten.geheimnis), s.uhr().getTime());
    assert.equal((await b0.post('/auth/2fa/bestaetigen', { code: code() })).status, 200);
    s.uhr.plus(1);
    const l = await fetch(`${s.basis}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ benutzerId: U.buero, pin: '1234', bindung: true, geraet: 'eigen' }) });
    const lj = await l.json();
    assert.equal(lj.zweiterFaktor, true, 'PIN allein meldet trotz „eigen“ an');
    assert.ok(!l.headers.getSetCookie().some((c) => /^bt_session=[0-9a-f]{64}/.test(c)), 'Sitzung vor dem zweiten Faktor');
    const z = await fetch(`${s.basis}/api/auth/login/2fa`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vorgang: lj.vorgang, code: code(), bindung: true, geraet: 'eigen' }) });
    assert.equal(z.status, 200);
    const e = ausAntwort(s, z);
    assert.deepEqual([(await e.c.get('/auth/ich')).daten.sitzungArt, (await e.c.get('/auth/ich')).daten.sitzungBis], ['woche', WOCHENENDE]);
    s.uhr.plus(20 * 60);
    assert.equal((await e.c.get('/auth/ich')).status, 200, 'Büro mit 2FA am eigenen Handy nach 20 h abgemeldet');
  } finally { await s.stop(); }
});

test('15.28: Push – Abo am eigenen Handy lebt bis zum Wochenende; die Haltedauer endet spätestens dort; geteilt unverändert', async () => {
  const s = await starte({ sitzung: ECHT, start: MI, test: true });
  try {
    const push = require('../../server/push');
    const e = await appLogin(s, U.polier);
    assert.equal((await e.c.post('/push/abo', { endpoint: 'https://handy.example.test/push/w1', keys: { p256dh: 'BPx', auth: 'aa' }, geteilt: false })).status, 201);
    const abo = () => s.db.eins("SELECT * FROM push_abo WHERE endpoint = 'https://handy.example.test/push/w1'");
    s.uhr.setze('2026-11-22T20:00:00.000Z'); // Sonntag 21:00, 4 Tage ohne Anfrage
    const z = push.aboZustellbar(s.app.bt, abo());
    assert.ok(z, 'Abo am eigenen Handy vor dem Wochenende nicht zustellbar');
    assert.equal(z.ttl, 3 * 3600, 'Haltedauer reicht über das Wochenende hinaus');
    s.uhr.setze(WOCHENENDE);
    assert.equal(push.aboZustellbar(s.app.bt, abo()), null, 'Abo nach dem Wochenende zustellbar');
    assert.ok(!abo(), 'Abo nach dem Ende der Wochen-Sitzung nicht gelöscht');
    // geteiltes Abo an einer Wochen-Sitzung: weiter nur innerhalb der Sperre nach Untätigkeit (H-S3)
    s.uhr.setze(MI);
    const e2 = await appLogin(s, U.polier);
    assert.equal((await e2.c.post('/push/abo', { endpoint: 'https://handy.example.test/push/w2', keys: { p256dh: 'BPx', auth: 'aa' }, geteilt: true })).status, 201);
    const abo2 = () => s.db.eins("SELECT * FROM push_abo WHERE endpoint = 'https://handy.example.test/push/w2'");
    s.uhr.plus(31);
    assert.equal(push.aboZustellbar(s.app.bt, abo2()), null, 'geteiltes Abo nach 31 min zustellbar');
  } finally { await s.stop(); }
});
