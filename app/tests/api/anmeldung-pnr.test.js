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
  // Nachprüfung 15.33 (Befund 2): im Docker-Betrieb zählt eine 1 aus der alten Vorlage erst nach der Prüfung der .env
  const gemerkt = { NUR: process.env.BAUTAG_LOGIN_LISTE_NUR_GEPRUEFT, G: process.env.BAUTAG_LOGIN_LISTE_GEPRUEFT };
  process.env.BAUTAG_LOGIN_LISTE_NUR_GEPRUEFT = '1';
  try {
    delete process.env.BAUTAG_LOGIN_LISTE_GEPRUEFT;
    await mitEnv('1', async (basis, app) => {
      assert.deepEqual((await holen(basis, '/auth/anmeldung')).daten, { namensliste: false }, 'alte 1 schaltet die Liste ein');
      assert.equal((await holen(basis, '/auth/benutzerliste')).status, 404);
      assert.ok(app.bt.warnungen.some((w) => /BAUTAG_LOGIN_LISTE=1 .*nicht beachtet/.test(w)), 'Warnung im Protokoll fehlt');
    });
    process.env.BAUTAG_LOGIN_LISTE_GEPRUEFT = '15.33';
    await mitEnv('1', async (basis, app) => {
      assert.deepEqual((await holen(basis, '/auth/anmeldung')).daten, { namensliste: true }, 'bewusste 1 nach der Prüfung');
      assert.ok(!app.bt.warnungen.some((w) => /BAUTAG_LOGIN_LISTE/.test(w)));
    });
  } finally {
    for (const [k, v] of [['BAUTAG_LOGIN_LISTE_NUR_GEPRUEFT', gemerkt.NUR], ['BAUTAG_LOGIN_LISTE_GEPRUEFT', gemerkt.G]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
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

/**
 * Prüfung 20.11.2026: Nach dem Update auf 15.33 (Namensliste aus) können sich aktive Konten ohne Personalnummer nicht anmelden.
 * Der Server meldet sie schon beim Start (bt.warnungen → Protokoll), hervorgehoben, wenn kein Konto mit Recht „benutzer“ eine
 * Nummer hat; mit eingeschalteter Namensliste keine Warnung (dort ist die Nummer freiwillig).
 */
test('Prüfung 20.11.2026: Startwarnung zu aktiven Konten ohne Personalnummer', async () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const { ohnePersonalnummerWarnungen } = require('../../server/index');
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'bautag-pnr-'));
  const dbPath = path.join(ordner, 'bautag.db');
  let erst = true;
  const start = (opt) => { const a = createApp({ dbPath, uhr: () => new Date(START), seed: erst, demo: true, test: true, ...opt }); erst = false; return a; };
  const pnrWarn = (app) => app.bt.warnungen.filter((w) => /ohne Personalnummer|KEIN aktives Konto/.test(w));
  try {
    let app = start({ loginListe: false });
    assert.deepEqual(pnrWarn(app), [], 'Beispieldaten: alle haben eine Nummer');
    // Büro und Bauleiter ohne Nummer: eine Warnung mit Namen; die GF (Recht „benutzer“) hat noch eine
    app.bt.db.lauf('UPDATE benutzer SET pnr = NULL WHERE id IN (?, ?)', U.buero, U.bauleiter);
    app.schliessen();
    app = start({ loginListe: false });
    let w = pnrWarn(app);
    assert.equal(w.length, 1, JSON.stringify(w));
    assert.match(w[0], /^2 aktive Konten ohne Personalnummer – können sich ohne Namensliste nicht anmelden: Martina Koller \(buero\), Stefan Aigner \(bauleiter\)\./);
    app.schliessen();
    // auch die GF ohne Nummer: niemand mit Benutzerrecht kommt hinein → zweite, hervorgehobene Warnung mit dem Notweg
    app = start({ loginListe: false });
    app.bt.db.lauf('UPDATE benutzer SET pnr = NULL WHERE id = ?', U.gf);
    w = ohnePersonalnummerWarnungen(app.bt.db);
    assert.equal(w.length, 2);
    assert.match(w[0], /^3 aktive Konten ohne Personalnummer/);
    assert.match(w[1], /^ACHTUNG: KEIN aktives Konto mit dem Recht „Benutzer und Rechte verwalten“ hat eine Personalnummer/);
    assert.match(w[1], /BAUTAG_LOGIN_LISTE=1 und BAUTAG_LOGIN_LISTE_GEPRUEFT=15\.33/);
    app.schliessen();
    // mit Namensliste: keine Warnung (Nummer freiwillig); inaktive Konten zählen nie
    app = start({ loginListe: true });
    assert.deepEqual(pnrWarn(app), []);
    app.bt.db.lauf('UPDATE benutzer SET aktiv = 0 WHERE pnr IS NULL AND id <> ?', U.gf);
    w = ohnePersonalnummerWarnungen(app.bt.db);
    assert.equal(w.length, 2); assert.match(w[0], /^1 aktives Konto ohne Personalnummer – kann sich/);
    app.schliessen();
  } finally { fs.rmSync(ordner, { recursive: true, force: true }); }
});
