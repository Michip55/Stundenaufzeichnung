'use strict';
/**
 * 15.33 (Inhaber 19.11.2026): Anmeldung „eigener Name am eigenen Handy“ – am Server:
 *  1. Öffentliche Namensliste standardmäßig AUS; nur BAUTAG_LOGIN_LISTE=1 schaltet sie ein. GET /auth/anmeldung sagt nur, ob.
 *  2. Ohne Namensliste braucht jedes aktive Konto eine Personalnummer (Bearbeiten, Reaktivieren, Nummer entfernen → 400).
 *  3. GET /auth/ich nennt die EIGENE Personalnummer – nie die einer anderen Person.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../../server/index');
const { starte, U, START } = require('./hilfe');

async function mitEnv(wert, fn) {
  const vorher = process.env.BAUTAG_LOGIN_LISTE;
  if (wert === undefined) delete process.env.BAUTAG_LOGIN_LISTE; else process.env.BAUTAG_LOGIN_LISTE = wert;
  try {
    const app = createApp({ dbPath: ':memory:', uhr: () => new Date(START), seed: true, demo: true });
    const server = await new Promise((r) => { const x = app.listen(0, '127.0.0.1', () => r(x)); });
    const basis = `http://127.0.0.1:${server.address().port}/api`;
    try { await fn(basis, app); } finally { await new Promise((r) => server.close(r)); app.schliessen(); }
  } finally { if (vorher === undefined) delete process.env.BAUTAG_LOGIN_LISTE; else process.env.BAUTAG_LOGIN_LISTE = vorher; }
}
const holen = async (basis, pfad, body) => {
  const r = await fetch(basis + pfad, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, daten: await r.json().catch(() => null) };
};

test('15.33: Namensliste standardmäßig aus – nur BAUTAG_LOGIN_LISTE=1 schaltet sie ein', async () => {
  for (const wert of [undefined, '', '0', 'ja', 'true']) {
    await mitEnv(wert, async (basis) => {
      const a = await holen(basis, '/auth/anmeldung');
      assert.equal(a.status, 200, `${wert}`);
      assert.deepEqual(a.daten, { namensliste: false }, `BAUTAG_LOGIN_LISTE=${wert}`);
      const l = await holen(basis, '/auth/benutzerliste');
      assert.equal(l.status, 404, `BAUTAG_LOGIN_LISTE=${wert}: Namensliste sichtbar`);
      assert.ok(!JSON.stringify(l.daten).includes('Brandstätter'), 'Namen in der Fehlerantwort');
      assert.equal((await holen(basis, '/auth/login', { benutzerId: U.mitarbeiter, pin: '1234' })).status, 400, 'Anmeldung mit benutzerId ohne Liste');
      const p = await holen(basis, '/auth/login', { pnr: 1002, pin: '1234' });
      assert.equal(p.status, 200, `Anmeldung mit Personalnummer: ${JSON.stringify(p.daten)}`);
    });
  }
  await mitEnv('1', async (basis) => {
    assert.deepEqual((await holen(basis, '/auth/anmeldung')).daten, { namensliste: true });
    const l = await holen(basis, '/auth/benutzerliste');
    assert.equal(l.status, 200);
    assert.ok(l.daten.length >= 5 && l.daten.every((b) => Object.keys(b).sort().join() === 'id,name'));
    assert.equal((await holen(basis, '/auth/login', { benutzerId: U.mitarbeiter, pin: '1234' })).status, 200);
  });
  // die Option von createApp (Tests) geht der Umgebung vor
  const vorher = process.env.BAUTAG_LOGIN_LISTE;
  process.env.BAUTAG_LOGIN_LISTE = '1';
  try {
    const app = createApp({ dbPath: ':memory:', uhr: () => new Date(START), seed: false, demo: true, loginListe: false });
    assert.equal(app.bt.loginListe, false);
    app.schliessen();
  } finally { if (vorher === undefined) delete process.env.BAUTAG_LOGIN_LISTE; else process.env.BAUTAG_LOGIN_LISTE = vorher; }
});

test('15.33: GET /auth/anmeldung ist öffentlich und liefert nur {namensliste}', async () => {
  for (const loginListe of [false, true]) {
    const s = await starte({ loginListe });
    try {
      const r = await s.client().get('/auth/anmeldung');
      assert.equal(r.status, 200);
      assert.deepEqual(r.daten, { namensliste: loginListe });
      assert.match(r.headers.get('cache-control') || '', /no-store/);
      const c = await s.login(U.mitarbeiter);
      assert.deepEqual((await c.get('/auth/anmeldung')).daten, { namensliste: loginListe });
    } finally { await s.stop(); }
  }
});

test('15.33: ohne Namensliste braucht jedes aktive Konto eine Personalnummer', async () => {
  const s = await starte({ loginListe: false });
  try {
    const gf = await s.login(U.gf);
    const buero = await s.login(U.buero);
    const db = s.db;
    // Anlegen ohne Angabe: es wird immer eine Nummer vergeben (C-12)
    const neu = await gf.post('/benutzer', { name: 'Anna Neuhold', rolle: 'mitarbeiter', pin: '582913' });
    assert.equal(neu.status, 201, JSON.stringify(neu.daten));
    assert.ok(Number.isInteger(neu.daten.pnr) && neu.daten.pnr > 0);
    // Nummer entfernen bei einem aktiven Konto → 400 mit klarer Meldung
    const weg = await gf.put(`/benutzer/${neu.daten.id}`, { pnr: null });
    assert.equal(weg.status, 400);
    assert.match(weg.daten.fehler, /Personalnummer/);
    assert.match(weg.daten.fehler, /Anna Neuhold/);
    assert.equal(db.eins('SELECT pnr FROM benutzer WHERE id = ?', neu.daten.id).pnr, neu.daten.pnr, 'Nummer trotz 400 entfernt');
    // auch das Büro (Mitarbeiter verwalten) bekommt dieselbe Prüfung
    assert.equal((await buero.put(`/benutzer/${neu.daten.id}`, { pnr: null })).status, 400);
    // deaktivieren und dabei die Nummer entfernen: erlaubt (inaktive Konten melden sich nie an)
    const aus = await gf.put(`/benutzer/${neu.daten.id}`, { aktiv: false, pnr: null });
    assert.equal(aus.status, 200, JSON.stringify(aus.daten));
    // reaktivieren ohne Nummer → 400; mit Nummer → 200
    const re = await gf.put(`/benutzer/${neu.daten.id}`, { aktiv: true });
    assert.equal(re.status, 400);
    assert.match(re.daten.fehler, /Personalnummer/);
    assert.equal(db.eins('SELECT aktiv FROM benutzer WHERE id = ?', neu.daten.id).aktiv, 0);
    const re2 = await gf.put(`/benutzer/${neu.daten.id}`, { aktiv: true, pnr: 4711 });
    assert.equal(re2.status, 200, JSON.stringify(re2.daten));
    assert.equal(re2.daten.pnr, 4711);
    // Altbestand: aktives Konto ohne Nummer – jede Änderung verlangt zuerst die Nummer
    db.lauf('UPDATE benutzer SET pnr = NULL WHERE id = ?', 7);
    const name = await gf.put('/benutzer/7', { telefon: '+43 660 1111111' });
    assert.equal(name.status, 400);
    assert.match(name.daten.fehler, /Personalnummer/);
    assert.equal((await gf.put('/benutzer/7', { telefon: '+43 660 1111111', pnr: 1007 })).status, 200);
    // GET /benutzer nennt pnr null für die Warnung der Oberfläche
    db.lauf('UPDATE benutzer SET pnr = NULL WHERE id = ?', 7);
    const liste = (await gf.get('/benutzer')).daten;
    assert.equal(liste.find((b) => b.id === 7).pnr, null);
  } finally { await s.stop(); }
});

test('15.33: mit eingeschalteter Namensliste bleibt die Personalnummer freiwillig', async () => {
  const s = await starte({ loginListe: true });
  try {
    const gf = await s.login(U.gf);
    const r = await gf.put('/benutzer/7', { pnr: null });
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    assert.equal(r.daten.pnr, null);
  } finally { await s.stop(); }
});

test('15.33: /auth/ich nennt die eigene Personalnummer – nie die einer anderen Person', async () => {
  const s = await starte({ loginListe: false });
  try {
    const alle = s.db.alle('SELECT id, pnr FROM benutzer WHERE pnr IS NOT NULL');
    for (const id of Object.values(U)) {
      const c = await s.login(id);
      const ich = (await c.get('/auth/ich')).daten;
      const eigene = s.db.eins('SELECT pnr FROM benutzer WHERE id = ?', id).pnr;
      assert.equal(ich.benutzer.id, id);
      assert.equal(ich.benutzer.pnr, eigene, `Benutzer ${id}`);
      // keine andere Personalnummer irgendwo in der Antwort (als Wert eines Feldes „pnr“)
      const fremde = [];
      JSON.stringify(ich, (k, v) => { if (k === 'pnr' && v !== eigene) fremde.push(v); return v; });
      assert.deepEqual(fremde, [], `Benutzer ${id}: fremde Personalnummern ${fremde}`);
      assert.ok(alle.length > 5);
    }
  } finally { await s.stop(); }
});
