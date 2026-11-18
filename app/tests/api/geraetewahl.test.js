'use strict';
/**
 * API.md 15.8 – Gerätewahl „Eigenes Handy“ / „Geteiltes Gerät“: der Server vertraut der Wahl nicht.
 * Die Wahl wirkt nur am Gerät (Sperre nach Untätigkeit). Am Server bleibt jede Sitzung gleich lang – wer bei der Anmeldung
 * „eigen“ (oder sonst etwas) mitschickt, bekommt keine längere Sitzung, keine andere Sperrzeit und keine ungebundene Sitzung.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U } = require('./hilfe');

/** Anmeldung wie die App (mit Bindung) plus beliebige Zusatzfelder → Client mit beiden Cookies */
async function appLogin(s, benutzerId, extra = {}) {
  const r = await fetch(`${s.basis}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ benutzerId, pin: '1234', bindung: true, ...extra }) });
  assert.equal(r.status, 200);
  const sc = r.headers.getSetCookie();
  const wert = (n) => { const z = sc.find((x) => x.startsWith(`${n}=`)); return z ? z.split(';')[0].slice(n.length + 1) : ''; };
  assert.match(wert('bt_bindung'), /^[0-9a-f]{64}$/, 'auch mit „eigen“ ist die Sitzung gebunden');
  return { c: s.client(`bt_session=${wert('bt_session')}; bt_bindung=${wert('bt_bindung')}`), session: wert('bt_session') };
}

test('15.8: /auth/ich liefert beide Grenzen – Sperre (geteilt) und Sitzungsdauer (eigenes Handy), nie über der Höchstdauer', async () => {
  const s = await starte({ sitzung: {} }); // Standard: Feld 720 min, Büro 60 min, höchstens 24 h, Sperre Feld 30 min
  try {
    for (const [id, sperre, sitzung] of [[U.polier, 30, 720], [U.mitarbeiter, 30, 720], [U.bauleiter, 60, 60], [U.buero, 60, 60], [U.gf, 60, 60]]) {
      const ich = (await (await s.login(id)).get('/auth/ich')).daten;
      assert.equal(ich.sperreMinuten, sperre, `sperreMinuten ${id}`);
      assert.equal(ich.sitzungMinuten, sitzung, `sitzungMinuten ${id}`);
      assert.ok(ich.sitzungMinuten <= 24 * 60, 'Sitzungsdauer über der Höchstdauer');
      assert.ok(ich.sperreMinuten <= ich.sitzungMinuten);
    }
  } finally { await s.stop(); }
});

test('15.8: „eigen“ bei der Anmeldung ändert am Server nichts – gleiche Sperrzeit, gleiche Untätigkeits- und Höchstdauer', async () => {
  const s = await starte({ sitzung: {} });
  try {
    const eigen = await appLogin(s, U.polier, { geraet: 'eigen', geraetArt: 'eigen', sperreMinuten: 0, sitzungMinuten: 99999 });
    const geteilt = await appLogin(s, U.mitarbeiter);
    const a = (await eigen.c.get('/auth/ich')).daten, b = (await geteilt.c.get('/auth/ich')).daten;
    assert.equal(a.sperreMinuten, b.sperreMinuten);
    assert.equal(a.sitzungMinuten, b.sitzungMinuten);
    assert.equal(a.sperreMinuten, 30);
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM sitzung WHERE benutzer_id = ? AND bindung_hash IS NOT NULL', U.polier).n, 1);
    // 12 h ohne Anfrage → die Sitzung endet am Server wie jede Feld-Sitzung (06:30 einstempeln, 16:30 ausstempeln geht: 10 h)
    s.uhr.plus(10 * 60);
    assert.equal((await eigen.c.get('/auth/ich')).status, 200, 'nach 10 h ohne Anfrage noch angemeldet (Feld 12 h)');
    s.uhr.plus(12 * 60 + 1);
    assert.equal((await eigen.c.get('/auth/ich')).status, 401, 'Sitzung „eigen“ länger als 12 h ohne Anfrage gültig');
    // Höchstdauer 24 h gilt auch mit regelmäßigen Anfragen
    const e2 = await appLogin(s, U.polier, { geraet: 'eigen' });
    for (let h = 0; h < 23; h += 2) { s.uhr.plus(120); assert.equal((await e2.c.get('/auth/ich')).status, 200, `nach ${h + 2} h`); }
    s.uhr.plus(61);
    assert.equal((await e2.c.get('/auth/ich')).status, 401, 'Sitzung „eigen“ länger als die Höchstdauer gültig');
  } finally { await s.stop(); }
});
