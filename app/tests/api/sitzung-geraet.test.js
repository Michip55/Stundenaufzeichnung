'use strict';
/**
 * API.md 15.5 – Korrekturen Rechte-Kontrolle: Sitzung und geteiltes Gerät
 * Befunde F-014 (Push-Abos), F-029 (Abmelden ohne Netz, Sitzungsbindung), F-030 (Ersteller nachgesendeter Einträge),
 * F-031 (Kontosperre auf allen PIN-Wegen), F-047 (Fernunterschrift-Link des Erstellers), F-050/F-051 (Zurücksetzen nur von unten).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');
const { entsperren, pinZuruecksetzen } = require('../../server/entsperren');
const { wienDatum, plusTage } = require('../../server/datum');

const KEYS = { p256dh: 'BPx', auth: 'aa' };
const abos = (s, id) => s.db.eins('SELECT COUNT(*) AS n FROM push_abo WHERE benutzer_id = ?', id).n;
const sitzungen = (s, id) => s.db.eins('SELECT COUNT(*) AS n FROM sitzung WHERE benutzer_id = ?', id).n;

/** Anmeldung wie die App: mit Bindung (zwei Cookies). → {c, session, bindung} */
async function appLogin(s, benutzerId, pin = '1234', extra = {}) {
  const r = await fetch(`${s.basis}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ benutzerId, pin, bindung: true, ...extra }) });
  assert.equal(r.status, 200, `Login ${benutzerId}`);
  const sc = r.headers.getSetCookie();
  const wert = (n) => { const z = sc.find((x) => x.startsWith(`${n}=`)); return z ? z.split(';')[0].slice(n.length + 1) : ''; };
  const session = wert('bt_session'), bindung = wert('bt_bindung');
  const c = s.client(`bt_session=${session}; bt_bindung=${bindung}`);
  return { c, session, bindung, setCookie: sc };
}

test('15.5 F-014: Push-Abos enden mit Abmelden, PIN-/2FA-Reset, Deaktivierung, Rollen- und Rechtewechsel', async (t) => {
  const s = await starte({ test: true });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);

  await t.test('Abmelden mit endpoint löscht das Abo DIESES Geräts (andere Geräte bleiben)', async () => {
    const buero = await s.login(U.buero);
    assert.equal((await buero.post('/push/abo', { endpoint: 'https://tablet1.example.test/push/a', keys: KEYS })).status, 201);
    assert.equal((await buero.post('/push/abo', { endpoint: 'https://handy.example.test/push/b', keys: KEYS })).status, 201);
    assert.equal((await buero.post('/auth/logout', { endpoint: 'https://tablet1.example.test/push/a' })).status, 200);
    assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM push_abo WHERE endpoint = 'https://tablet1.example.test/push/a'").n, 0);
    assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM push_abo WHERE endpoint = 'https://handy.example.test/push/b'").n, 1);
    assert.equal((await buero.get('/auth/ich')).status, 401);
  });

  await t.test('nachgeholtes Abmelden (Sitzung ohne Bindung nach Abmelden offline) löscht Abo und Sitzung', async () => {
    const { c, session } = await appLogin(s, U.polier);
    assert.equal((await c.post('/push/abo', { endpoint: 'https://tablet2.example.test/push/p', keys: KEYS })).status, 201);
    // Die App hat offline abgemeldet: bt_bindung ist gelöscht, nur das HttpOnly-Cookie ist noch da
    const nurSession = s.client(`bt_session=${session}`);
    assert.equal((await nurSession.post('/auth/logout', { endpoint: 'https://tablet2.example.test/push/p' })).status, 200);
    assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM push_abo WHERE endpoint = 'https://tablet2.example.test/push/p'").n, 0);
    assert.equal(sitzungen(s, U.polier), 0);
  });

  await t.test('Anmeldung einer anderen Person mit dem Endpoint des Geräts löscht das fremde Abo', async () => {
    const buero = await s.login(U.buero);
    assert.equal((await buero.post('/push/abo', { endpoint: 'https://tablet3.example.test/push/x', keys: KEYS })).status, 201);
    const ma = await s.login(U.mitarbeiter);
    assert.equal((await ma.post('/push/abo', { endpoint: 'https://ma-handy.example.test/push/m', keys: KEYS })).status, 201);
    await appLogin(s, U.mitarbeiter, '1234', { pushEndpoint: 'https://tablet3.example.test/push/x' });
    assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM push_abo WHERE endpoint = 'https://tablet3.example.test/push/x'").n, 0);
    assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM push_abo WHERE endpoint = 'https://ma-handy.example.test/push/m'").n, 1, 'eigenes Abo bleibt');
    // die Meldungen des Büros kommen dort nicht mehr an
    s.app.bt.testAusgang.push = [];
    await s.client().post('/test/stuendlich');
    assert.ok(!s.app.bt.testAusgang.push.some((p) => p.endpoint.includes('tablet3')));
  });

  const neuesAbo = async (id, nr) => {
    const c = id === U.gf ? gf : await s.login(id);
    assert.equal((await c.post('/push/abo', { endpoint: `https://geraet${nr}.example.test/push/${id}`, keys: KEYS })).status, 201);
    assert.ok(abos(s, id) >= 1);
  };

  await t.test('PIN-Reset löscht alle Abos der Person', async () => {
    await neuesAbo(4, 10); await neuesAbo(4, 11);
    assert.equal((await gf.put('/benutzer/4', { pin: '4826' })).status, 200);
    assert.equal(abos(s, 4), 0);
  });
  await t.test('2FA-Reset löscht alle Abos der Person', async () => {
    await neuesAbo(U.buero, 12);
    assert.equal((await gf.del(`/benutzer/${U.buero}/2fa`)).status, 200);
    assert.equal(abos(s, U.buero), 0);
  });
  await t.test('Deaktivierung löscht alle Abos der Person', async () => {
    await neuesAbo(5, 13);
    assert.equal((await gf.put('/benutzer/5', { aktiv: false })).status, 200);
    assert.equal(abos(s, 5), 0);
  });
  await t.test('Rollenwechsel löscht alle Abos der Person', async () => {
    await neuesAbo(6, 14);
    assert.equal((await gf.put('/benutzer/6', { rolle: 'polier' })).status, 200);
    assert.equal(abos(s, 6), 0);
  });
  await t.test('Rechte-Ausnahme geändert → Abos der Person gelöscht', async () => {
    await neuesAbo(7, 15);
    assert.equal((await gf.put('/rechte/ausnahme', { benutzerId: 7, recht: 'kolonne', wert: true })).status, 200);
    assert.equal(abos(s, 7), 0);
  });
  await t.test('Rechte-Matrix der Rolle geändert → Abos der Konten dieser Rolle gelöscht, andere bleiben', async () => {
    await neuesAbo(U.polier2, 16); await neuesAbo(U.mitarbeiter, 17);
    const vorherMa = abos(s, U.mitarbeiter);
    assert.equal((await gf.put('/rechte/matrix', { rolle: 'polier', recht: 'fuhrpark', wert: true })).status, 200);
    assert.equal(abos(s, U.polier2), 0);
    assert.equal(abos(s, U.mitarbeiter), vorherMa);
  });
  await t.test('entsperren.js --2fa / --pin löschen die Abos', async () => {
    await neuesAbo(U.bauleiter, 18);
    pinZuruecksetzen(s.db, s.db.eins('SELECT pnr FROM benutzer WHERE id = ?', U.bauleiter).pnr, s.uhr());
    assert.equal(abos(s, U.bauleiter), 0);
  });
});

test('15.5 F-029: Sitzungsbindung, Rotation, Sperre nach Untätigkeit', async (t) => {
  const s = await starte({ test: true });
  t.after(() => s.stop());

  await t.test('App-Sitzung gilt nur mit dem Bindungs-Cookie; ohne Cookie endet sie sofort am Server', async () => {
    const { c, session, setCookie } = await appLogin(s, U.polier);
    assert.ok(setCookie.some((x) => /^bt_session=[0-9a-f]{64};.*HttpOnly/.test(x)));
    assert.ok(setCookie.some((x) => /^bt_bindung=[0-9a-f]{64};/.test(x) && !/HttpOnly/i.test(x)), 'Bindung muss für die App löschbar sein');
    assert.equal((await c.get('/auth/ich')).status, 200);
    // Nach dem Abmelden ohne Netz ist bt_bindung gelöscht: das alte HttpOnly-Cookie allein öffnet nichts mehr
    const alt = s.client(`bt_session=${session}`);
    assert.equal((await alt.get('/auth/ich')).status, 401);
    assert.equal((await alt.get('/zeit/status')).status, 401);
    assert.equal(sitzungen(s, U.polier), 0, 'Sitzung muss am Server gelöscht sein');
    assert.equal((await c.get('/auth/ich')).status, 401, 'auch mit Bindung danach nicht mehr gültig');
  });

  await t.test('falsche Bindung beendet die Sitzung', async () => {
    const { session } = await appLogin(s, U.mitarbeiter);
    assert.equal((await s.client(`bt_session=${session}; bt_bindung=${'0'.repeat(64)}`).get('/auth/ich')).status, 401);
    assert.equal(sitzungen(s, U.mitarbeiter), 0);
  });

  await t.test('Abmelden löscht beide Cookies', async () => {
    const { c } = await appLogin(s, U.polier);
    const r = await fetch(`${s.basis}/api/auth/logout`, { method: 'POST', headers: { cookie: c.cookie, 'content-type': 'application/json' }, body: '{}' });
    const sc = r.headers.getSetCookie();
    assert.ok(sc.some((x) => /^bt_session=;.*Max-Age=0/.test(x)) && sc.some((x) => /^bt_bindung=;.*Max-Age=0/.test(x)));
  });

  await t.test('Rotation: die nächste Anmeldung am Gerät beendet die alte Sitzung (auch ohne Abmelden)', async () => {
    const pol = await appLogin(s, U.polier);
    const r = await fetch(`${s.basis}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `bt_session=${pol.session}` }, body: JSON.stringify({ benutzerId: U.mitarbeiter, pin: '1234', bindung: true }) });
    assert.equal(r.status, 200);
    assert.equal(sitzungen(s, U.polier), 0);
    assert.equal((await pol.c.get('/auth/ich')).status, 401);
  });

  await t.test('Sperre am Gerät: Feldrollen 30 min, Büro wie die Sitzung (60 min)', async () => {
    const s2 = await starte({ sitzung: {} });
    try {
      assert.equal((await (await s2.login(U.polier)).get('/auth/ich')).daten.sperreMinuten, 30);
      assert.equal((await (await s2.login(U.mitarbeiter)).get('/auth/ich')).daten.sperreMinuten, 30);
      assert.equal((await (await s2.login(U.buero)).get('/auth/ich')).daten.sperreMinuten, 60);
    } finally { await s2.stop(); }
  });

  await t.test('Geräteschlüssel: nur angemeldet, je Person fest, für andere verschieden', async () => {
    assert.equal((await s.client().get(`/auth/geraet-schluessel?benutzerId=${U.polier}`)).status, 401);
    const a = (await (await s.login(U.polier)).get(`/auth/geraet-schluessel?benutzerId=${U.polier}`)).daten;
    const b = (await (await s.login(U.polier)).get(`/auth/geraet-schluessel?benutzerId=${U.polier}`)).daten;
    const m = (await (await s.login(U.mitarbeiter)).get(`/auth/geraet-schluessel?benutzerId=${U.mitarbeiter}`)).daten;
    // fremder Schlüssel nie – auch nicht für die GF
    assert.equal((await (await s.login(U.gf)).get(`/auth/geraet-schluessel?benutzerId=${U.polier}`)).status, 403);
    assert.equal((await (await s.login(U.mitarbeiter)).get(`/auth/geraet-schluessel?benutzerId=${U.polier}`)).status, 403);
    assert.equal(a.benutzerId, U.polier);
    assert.equal(Buffer.from(a.schluessel, 'base64').length, 32);
    assert.equal(a.schluessel, b.schluessel);
    assert.notEqual(a.schluessel, m.schluessel);
  });
});

test('15.5 F-030: nachgesendete Einträge nur unter der Sitzung ihres Erstellers', async (t) => {
  const s = await starte({ test: true });
  t.after(() => s.stop());
  const ma = await s.login(U.mitarbeiter);
  const buchungen = () => s.db.eins('SELECT COUNT(*) AS n FROM buchung WHERE benutzer_id = ?', U.mitarbeiter).n;
  const zeit = new Date(s.uhr().getTime() - 20 * 60000).toISOString();

  await t.test('Stempelung des Poliers (Ersteller 1) mit der Sitzung des Mitarbeiters → 409, nichts gebucht, kein fremder Zustand', async () => {
    const vorher = buchungen();
    const r = await ma.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten, zeit, quelle: 'offline' }, { 'x-bautag-ersteller': String(U.polier) });
    assert.equal(r.status, 409);
    assert.equal(r.daten.code, 'ERSTELLER_ANDERS');
    assert.ok(!('status' in r.daten) && !/eingestempelt|seit/i.test(r.daten.fehler));
    assert.equal(buchungen(), vorher);
  });
  await t.test('Schaden und Fuhren-Status mit fremdem Ersteller → 409', async () => {
    const n = s.db.eins("SELECT COUNT(*) AS n FROM mangel WHERE typ = 'schaden'").n;
    const r = await ma.post('/fuhrpark/schaeden', { art: 'schaden', ursache: 'Hydraulikschlauch geplatzt', einsatzfaehig: 'ja', fremdGeraet: 'Bagger X', clientId: 'abcd-1234' }, { 'x-bautag-ersteller': String(U.polier) });
    assert.equal(r.status, 409);
    assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM mangel WHERE typ = 'schaden'").n, n);
    assert.equal((await ma.post('/plan/fuhren/1/status', { status: 'unterwegs' }, { 'x-bautag-ersteller': String(U.polier) })).status, 409);
    assert.equal((await ma.post('/plan/fuhren/1/status', { status: 'unterwegs' }, { 'x-bautag-ersteller': 'abc' })).status, 409);
  });
  await t.test('eigener Ersteller → angenommen', async () => {
    const vorher = buchungen();
    const r = await ma.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten, zeit, quelle: 'offline' }, { 'x-bautag-ersteller': String(U.mitarbeiter) });
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    assert.equal(buchungen(), vorher + 1);
  });
  await t.test('ohne Anmeldung bleibt es 401 (nicht 409)', async () => {
    assert.equal((await s.client().post('/zeit/stempeln', { typ: 'gehen' }, { 'x-bautag-ersteller': '1' })).status, 401);
  });
});

test('15.5 F-031: Kontosperre gilt auf allen PIN-Wegen und wird nicht aufgehoben', async (t) => {
  const s = await starte({ test: true, trustProxy: true });
  t.after(() => s.stop());
  const bremse = s.app.bt.bremse;

  await t.test('gesperrt: /auth/pin mit richtiger alter PIN → 423, keine Änderung, Anmeldung bleibt 423', async () => {
    const ma = await s.login(6, '1234', '10.50.0.1');
    bremse.kontoSperren(6);
    const r = await ma.post('/auth/pin', { alt: '1234', neu: '5829' });
    assert.equal(r.status, 423);
    assert.equal((await ma.post('/auth/pin', { alt: '9999', neu: '5829' })).status, 423);
    assert.equal((await s.client(null, '10.50.0.2').post('/auth/login', { benutzerId: 6, pin: '1234' })).status, 423);
    assert.equal((await s.client(null, '10.50.0.3').post('/auth/login', { benutzerId: 6, pin: '5829' })).status, 423);
    assert.equal(s.db.eins('SELECT gesperrt FROM login_konto WHERE benutzer_id = 6').gesperrt, 1);
  });

  await t.test('Fehlversuche über /auth/pin zählen zur Kontosperre; danach enden alle Sitzungen', async () => {
    const ma = await s.login(7, '1234', '10.51.0.1');
    const st = [];
    for (let i = 0; i < 25; i++) { ma.ip = `10.52.${i}.1`; st.push((await ma.post('/auth/pin', { alt: '9999', neu: '5829' })).status); }
    assert.ok(st.slice(0, 19).every((x) => x === 401), st.join(','));
    assert.equal(st[19], 423, st.join(','));
    assert.ok(st.slice(20).every((x) => x === 401), `nach der Sperre ist die Sitzung beendet: ${st.join(',')}`);
    assert.equal(sitzungen(s, 7), 0);
    assert.equal((await s.client(null, '10.53.0.1').post('/auth/login', { benutzerId: 7, pin: '1234' })).status, 423);
  });

  await t.test('2FA-Einstellungen (PIN-Prüfung) respektieren die Kontosperre', async () => {
    const bl = await s.login(U.bauleiter, '1234', '10.54.0.1');
    bremse.kontoSperren(U.bauleiter);
    assert.equal((await bl.post('/auth/2fa/einrichten', { pin: '1234' })).status, 423);
    entsperren(s.db, s.db.eins('SELECT pnr FROM benutzer WHERE id = ?', U.bauleiter).pnr, s.uhr());
    assert.equal((await bl.post('/auth/2fa/einrichten', { pin: '1234' })).status, 200);
    bremse.kontoSperren(U.bauleiter);
    assert.equal((await bl.post('/auth/2fa/bestaetigen', { code: '123456' })).status, 423);
  });
});

test('15.5 F-047: Fernunterschrift-Link verlangt das aktuelle Recht des Erstellers', async (t) => {
  const s = await starte({ test: true, url: 'https://bautag.example.at' });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  const anon = s.client();
  async function neuerLink(polierId, tageZurueck) {
    const pol = await s.login(polierId);
    const datum = plusTage(wienDatum(s.uhr()), -tageZurueck);
    const bsId = s.db.eins('SELECT baustelle_id FROM benutzer WHERE id = ?', polierId).baustelle_id || BS.pitten;
    s.db.lauf('DELETE FROM bericht WHERE baustelle_id = ? AND datum = ?', bsId, datum);
    const b = (await pol.post('/berichte', { baustelleId: bsId, datum })).daten;
    const r = await pol.post(`/berichte/${b.id}/unterschrift-link`, { rolle: 'bh' });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    const token = r.daten.url.split('/').pop();
    assert.equal((await anon.get(`/fern/${token}`)).status, 200);
    return { token, id: r.daten.id };
  }

  await t.test('Ersteller deaktiviert → Link sofort widerrufen (410)', async () => {
    const { token, id } = await neuerLink(U.polier2, 6);
    assert.equal((await gf.put(`/benutzer/${U.polier2}`, { aktiv: false })).status, 200);
    const r = await anon.get(`/fern/${token}`);
    assert.equal(r.status, 410);
    assert.equal(r.daten.code, 'LINK_UNGUELTIG');
    assert.equal(s.db.eins('SELECT status FROM unterschrift_link WHERE id = ?', id).status, 'widerrufen');
    assert.equal((await anon.post(`/fern/${token}`, { name: 'DI Bauherr', bestaetigt: true, bildPng: 'x' })).status, 410);
  });

  await t.test('Ersteller herabgestuft (Rolle) → Link widerrufen', async () => {
    const { token } = await neuerLink(U.polier, 5);
    assert.equal((await gf.put(`/benutzer/${U.polier}`, { rolle: 'mitarbeiter' })).status, 200);
    assert.equal((await anon.get(`/fern/${token}`)).status, 410);
    assert.equal((await gf.put(`/benutzer/${U.polier}`, { rolle: 'polier' })).status, 200);
  });

  await t.test('Recht über die Matrix entzogen → Link widerrufen; auch ohne Widerruf prüft das Öffnen das aktuelle Recht', async () => {
    const a = await neuerLink(U.polier, 4);
    assert.equal((await gf.put('/rechte/matrix', { rolle: 'polier', recht: 'bericht_erstellen', wert: false })).status, 200);
    assert.equal((await anon.get(`/fern/${a.token}`)).status, 410);
    assert.equal((await gf.put('/rechte/matrix', { rolle: 'polier', recht: 'bericht_erstellen', wert: true })).status, 200);
    const b = await neuerLink(U.polier, 3);
    // Recht direkt in der Datenbank weg (ohne die Route, die widerruft) – das Öffnen prüft selbst
    s.db.lauf("UPDATE rolle_recht SET wert = 0 WHERE rolle = 'polier' AND recht = 'bericht_erstellen'");
    assert.equal((await anon.get(`/fern/${b.token}`)).status, 410);
    s.db.lauf("UPDATE rolle_recht SET wert = 1 WHERE rolle = 'polier' AND recht = 'bericht_erstellen'");
  });
});

test('15.5 F-050/F-051: PIN, 2FA und Sperren nur von höherer Verwaltungsstufe; GF nur über entsperren.js', async (t) => {
  const s = await starte({ test: true, trustProxy: true });
  t.after(() => s.stop());
  const gf = await s.login(U.gf, '1234', '10.60.0.1');
  const buero = await s.login(U.buero, '1234', '10.60.0.2');
  const bl = await s.login(U.bauleiter, '1234', '10.60.0.3');
  const bl2 = (await gf.post('/benutzer', { name: 'Zweiter Bauleiter', rolle: 'bauleiter', pin: '482619' })).daten;
  const gf2 = (await gf.post('/benutzer', { name: 'Zweite GF', rolle: 'gf', pin: '482619' })).daten;
  assert.ok(bl2.id && gf2.id);

  await t.test('F-050: Bauleiter/Büro setzen keine PIN eines Bauleiters/Büros zurück (Kontoübernahme)', async () => {
    assert.equal((await bl.put(`/benutzer/${bl2.id}`, { pin: '864213' })).status, 403);
    assert.equal((await buero.put(`/benutzer/${U.bauleiter}`, { pin: '864213' })).status, 403);
    assert.equal((await bl.put(`/benutzer/${U.buero}`, { pin: '864213' })).status, 403);
    assert.equal((await buero.put(`/benutzer/${U.gf}`, { pin: '864213' })).status, 403);
    assert.equal((await s.client(null, '10.61.0.1').post('/auth/login', { benutzerId: bl2.id, pin: '864213' })).status, 401);
  });
  await t.test('F-050: GF setzt keine PIN einer GF zurück (auch nicht die eigene, auch nicht beim Hochstufen)', async () => {
    assert.equal((await gf.put(`/benutzer/${gf2.id}`, { pin: '864213' })).status, 403);
    assert.equal((await gf.put(`/benutzer/${U.gf}`, { pin: '864213' })).status, 403);
    assert.equal((await gf.put(`/benutzer/${bl2.id}`, { rolle: 'gf', pin: '864213' })).status, 403);
  });
  await t.test('F-050: erlaubte Resets erzwingen die PIN-Änderung und benachrichtigen die Person', async () => {
    assert.equal((await gf.put(`/benutzer/${bl2.id}`, { pin: '864213' })).status, 200);
    const l = await s.client(null, '10.62.0.1').post('/auth/login', { benutzerId: bl2.id, pin: '864213' });
    assert.equal(l.status, 200);
    assert.equal(l.daten.mussPinAendern, true);
    assert.ok(s.db.eins("SELECT COUNT(*) AS n FROM benachrichtigung WHERE benutzer_id = ? AND typ = 'sicherheit' AND titel = 'PIN zurückgesetzt'", bl2.id).n === 1);
    assert.equal((await buero.put('/benutzer/4', { pin: '5829' })).status, 200);
    assert.equal((await bl.put('/benutzer/5', { pin: '5829' })).status, 200);
    assert.ok(s.db.eins("SELECT COUNT(*) AS n FROM benachrichtigung WHERE benutzer_id = 4 AND titel = 'PIN zurückgesetzt'").n === 1);
    const ma = await s.client(null, '10.62.0.2').post('/auth/login', { benutzerId: 4, pin: '5829' });
    assert.equal(ma.daten.mussPinAendern, true);
  });
  await t.test('F-050: 2FA-Reset nur von höherer Stufe; GF-Konten nie über die API', async () => {
    assert.equal((await gf.del(`/benutzer/${gf2.id}/2fa`)).status, 403);
    assert.equal((await gf.del(`/benutzer/${U.bauleiter}/2fa`)).status, 200);
  });
  await t.test('F-051: Büro/Bauleiter entsperren keine GF und keine gleichrangigen Konten – beliebig oft geht nicht', async () => {
    const bl = await s.login(U.bauleiter, '1234', '10.60.0.4'); // der 2FA-Reset oben hat seine Sitzungen beendet
    s.app.bt.bremse.kontoSperren(U.gf);
    assert.equal((await bl.post(`/benutzer/${U.gf}/entsperren`)).status, 403);
    assert.equal((await buero.post(`/benutzer/${U.gf}/entsperren`)).status, 403);
    assert.equal((await gf.post(`/benutzer/${U.gf}/entsperren`)).status, 403); // die eigene
    assert.equal(s.db.eins('SELECT gesperrt FROM login_konto WHERE benutzer_id = ?', U.gf).gesperrt, 1);
    // IP-/Benutzer-Sperre (login_versuch) der GF bleibt ebenso
    for (let i = 0; i < 5; i++) await s.client(null, '10.63.0.1').post('/auth/login', { benutzerId: gf2.id, pin: '999999' });
    assert.ok(s.db.eins('SELECT COUNT(*) AS n FROM login_versuch WHERE benutzer_id = ? AND gesperrt_bis IS NOT NULL', gf2.id).n === 1);
    assert.equal((await buero.post(`/benutzer/${gf2.id}/entsperren`)).status, 403);
    assert.equal((await gf.post(`/benutzer/${gf2.id}/entsperren`)).status, 403);
    assert.ok(s.db.eins('SELECT COUNT(*) AS n FROM login_versuch WHERE benutzer_id = ? AND gesperrt_bis IS NOT NULL', gf2.id).n === 1);
    s.app.bt.bremse.kontoSperren(bl2.id);
    assert.equal((await bl.post(`/benutzer/${bl2.id}/entsperren`)).status, 403);
    assert.equal((await buero.post(`/benutzer/${bl2.id}/entsperren`)).status, 403);
    assert.equal((await gf.post(`/benutzer/${bl2.id}/entsperren`)).status, 200);
    s.app.bt.bremse.kontoSperren(2);
    assert.equal((await bl.post('/benutzer/2/entsperren')).status, 200);
  });
  await t.test('GF-Konten: entsperren.js (Sperren) und --pin (neue Start-PIN mit Änderungspflicht, Benachrichtigung)', async () => {
    const pnr = s.db.eins('SELECT pnr FROM benutzer WHERE id = ?', U.gf).pnr;
    entsperren(s.db, pnr, s.uhr());
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM login_konto WHERE benutzer_id = ?', U.gf).n, 0);
    const { pin } = pinZuruecksetzen(s.db, pnr, s.uhr());
    assert.match(pin, /^\d{8}$/);
    assert.equal((await gf.get('/auth/ich')).status, 401, 'Sitzungen enden');
    const l = await s.client(null, '10.64.0.1').post('/auth/login', { benutzerId: U.gf, pin });
    assert.equal(l.status, 200);
    assert.equal(l.daten.mussPinAendern, true);
    assert.ok(s.db.eins("SELECT COUNT(*) AS n FROM benachrichtigung WHERE benutzer_id = ? AND titel = 'PIN zurückgesetzt'", U.gf).n === 1);
  });
});
