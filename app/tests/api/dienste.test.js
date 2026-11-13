'use strict';
/** Push, Wetter, E-Mail (API.md 12.3–12.5) – ohne Live-Aufrufe (Attrappen, eigener SMTP-Server) */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { starte, U, BS } = require('./hilfe');
const { demoUnterschrift } = require('../../server/png');
const { wienDatum, plusTage } = require('../../server/datum');
const { benachrichtige } = require('../../server/budget');
const P = require('../../server/push');

/** Minimaler SMTP-Server (ohne TLS/Auth) – sammelt Nachrichten */
function smtpServer() {
  const post = [];
  const server = net.createServer((sock) => {
    let daten = false, puffer = '', aktuell = null;
    sock.write('220 test ESMTP\r\n');
    sock.on('data', (chunk) => {
      puffer += chunk.toString('latin1');
      let i;
      while ((i = daten ? puffer.indexOf('\r\n.\r\n') : puffer.indexOf('\r\n')) >= 0) {
        if (daten) {
          aktuell.daten = puffer.slice(0, i);
          puffer = puffer.slice(i + 5);
          daten = false;
          post.push(aktuell);
          sock.write('250 OK gespeichert\r\n');
          continue;
        }
        const zeile = puffer.slice(0, i);
        puffer = puffer.slice(i + 2);
        const cmd = zeile.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') sock.write('250-test\r\n250 8BITMIME\r\n');
        else if (cmd === 'MAIL') { aktuell = { von: zeile, an: [] }; sock.write('250 OK\r\n'); } else if (cmd === 'RCPT') { aktuell.an.push(zeile); sock.write('250 OK\r\n'); } else if (cmd === 'DATA') { daten = true; sock.write('354 weiter\r\n'); } else if (cmd === 'QUIT') { sock.write('221 tschüss\r\n'); sock.end(); } else sock.write('250 OK\r\n');
      }
    });
    sock.on('error', () => {});
  });
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res({ server, post, port: server.address().port })));
}

const warte = async (bed, ms = 5000) => {
  const ende = Date.now() + ms;
  while (Date.now() < ende) { if (await bed()) return true; await new Promise((r) => setTimeout(r, 25)); }
  return false;
};

test('Push (Testbetrieb, Attrappe)', async (t) => {
  const s = await starte({ test: true });
  t.after(() => s.stop());
  const c = {};
  for (const r of ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf']) c[r] = await s.login(U[r]);
  const bt = s.app.bt;

  await t.test('Schlüssel, Abo anlegen/übernehmen/löschen, Grenzen', async () => {
    const k = await c.mitarbeiter.get('/push/schluessel');
    assert.equal(k.status, 200);
    assert.match(k.daten.publicKey, /^[A-Za-z0-9_-]{80,}$/);
    const abo = { endpoint: 'https://push.example.invalid/abo/1', keys: { p256dh: 'BPx1-abc_DEF', auth: 'aBc-12_x' }, geraet: 'Handy Lukas' };
    assert.equal((await c.mitarbeiter.post('/push/abo', { ...abo, endpoint: 'http://unsicher.example/1' })).status, 400);
    assert.equal((await c.mitarbeiter.post('/push/abo', { ...abo, keys: { p256dh: 'ä', auth: 'x' } })).status, 400);
    let r = await c.mitarbeiter.post('/push/abo', abo);
    assert.equal(r.status, 201);
    assert.equal(r.daten.geraet, 'Handy Lukas');
    r = await c.mitarbeiter.post('/push/abo', abo);
    assert.equal(r.status, 200);
    const liste = (await c.mitarbeiter.get('/push/abos')).daten;
    assert.equal(liste.length, 1);
    assert.equal(liste[0].endpoint, undefined); // ohne Schlüssel/Adresse
    assert.equal((await c.polier.get('/push/abos')).daten.length, 0);
    assert.equal((await c.polier.del(`/push/abos/${liste[0].id}`)).status, 404); // fremdes Abo
    for (let i = 0; i < 12; i++) await c.buero.post('/push/abo', { endpoint: `https://push.example.invalid/b/${i}`, keys: { p256dh: 'BPx', auth: 'aa' } });
    assert.equal((await c.buero.get('/push/abos')).daten.length, 10);
  });

  await t.test('Einstellungen je Rolle: Mitarbeiter ohne budget/rechnung', async () => {
    const m = (await c.mitarbeiter.get('/push/einstellungen')).daten.typen;
    assert.equal(m.budget, undefined);
    assert.equal(m.plan, true);
    assert.equal((await c.mitarbeiter.put('/push/einstellungen', { typen: { budget: true } })).status, 400);
    const g = (await c.gf.get('/push/einstellungen')).daten.typen;
    assert.equal(g.budget, true);
    const r = await c.mitarbeiter.put('/push/einstellungen', { typen: { azg: false } });
    assert.equal(r.daten.typen.azg, false);
  });

  await t.test('Versand: neue Benachrichtigung → Push ohne Beträge; Budget neutral; abgeschaltet; 410 löscht Abo', async () => {
    await c.gf.post('/push/abo', { endpoint: 'https://push.example.invalid/gf', keys: { p256dh: 'BPx', auth: 'aa' } });
    await c.gf.post('/push/abo', { endpoint: 'https://push.example.invalid/gone/gf', keys: { p256dh: 'BPx', auth: 'aa' } });
    bt.testAusgang.push = [];
    const zeit = s.uhr().toISOString();
    benachrichtige(s.db, { benutzerId: U.gf, typ: 'fuhrpark', titel: 'Rechnung 1.234,50 € gebucht', text: 'Reparatur für € 1.234,50 und 99 EUR erfasst – Anlage A12.', zeit, schluessel: 't1' });
    benachrichtige(s.db, { benutzerId: U.gf, typ: 'budget', titel: 'Budget-Alarm 90 %: WHA Pitten', text: 'Kosten 123.456,00 € von 150.000 €', zeit, schluessel: 't2' });
    benachrichtige(s.db, { benutzerId: U.mitarbeiter, typ: 'azg', titel: 'AZG', text: 'Pause fehlt', zeit, schluessel: 't3' });
    await P.verteilen(bt);
    const gf = bt.testAusgang.push.filter((p) => p.endpoint === 'https://push.example.invalid/gf');
    assert.equal(gf.length, 2);
    const fp = gf.find((p) => /Anlage A12/.test(p.body));
    assert.ok(!/€|EUR|1\.234|99/.test(fp.body + fp.title), JSON.stringify(fp));
    assert.equal(gf.find((p) => /Budget/.test(p.title)).body, 'Budget-Schwelle erreicht – Details in BauTag');
    assert.ok(!gf.some((p) => /123\.456/.test(p.body)));
    // azg für den Mitarbeiter abgeschaltet → nicht gesendet
    assert.ok(!bt.testAusgang.push.some((p) => p.benutzerId === U.mitarbeiter));
    assert.equal(s.db.eins("SELECT push FROM benachrichtigung WHERE schluessel = 't3'").push, 'aus');
    // „gone“-Abo gelöscht
    assert.ok(!s.db.eins("SELECT 1 AS x FROM push_abo WHERE endpoint LIKE '%gone%'"));
    // nicht doppelt
    const n = bt.testAusgang.push.length;
    await P.verteilen(bt);
    assert.equal(bt.testAusgang.push.length, n);
    // Test-Push
    const r = await c.gf.post('/push/test', {});
    assert.deepEqual(r.daten, { gesendet: 1, fehler: 0 });
  });

  await t.test('Test-Schnittstellen nur im Testbetrieb', async () => {
    const a = await c.mitarbeiter.get('/test/ausgang');
    assert.equal(a.status, 200);
    assert.ok(Array.isArray(a.daten.push));
    assert.equal((await c.mitarbeiter.post('/test/zuruecksetzen', {})).status, 200);
    assert.equal(bt.testAusgang.push.length, 0);
  });

  await t.test('ohne Push-Text-Beträge: Hilfsfunktion', () => {
    assert.equal(P.ohneBetraege('Kosten 1.234,50 € (Stand)'), 'Kosten (Stand)');
    assert.equal(P.ohneBetraege('EUR 99,00 offen'), 'offen');
    assert.equal(P.ohneBetraege('Service 500 Std. bei 4.500 Std.'), 'Service 500 Std. bei 4.500 Std.');
  });
});

test('Test-Schnittstellen fehlen ohne BAUTAG_TEST', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const c = await s.login(U.gf);
  assert.equal((await c.get('/test/ausgang')).status, 404);
  assert.equal((await s.client().get('/test/ausgang')).status, 401);
});

test('Wetter (GeoSphere-Adapter mit Attrappe)', async (t) => {
  const aufrufe = [];
  let fehler = false;
  /** GeoJSON wie der Data Hub: Stunden 0–23 Wiener Zeit (UTC−1) */
  const abruf = async (url) => {
    aufrufe.push(url);
    if (fehler) throw new Error('Zeitüberschreitung');
    const m = /start=(\d{4}-\d{2}-\d{2})T22:00&end=(\d{4}-\d{2}-\d{2})/.exec(url);
    const tag = m ? m[2] : wienDatum(s.uhr());
    const ts = [], t2m = [], rr = [], u = [], v2 = [];
    let acc = 0;
    for (let h = -2; h < 26; h++) {
      const d = new Date(Date.parse(`${tag}T00:00:00Z`) + (h - 1) * 3600e3); // Wien = UTC+1 im November
      ts.push(d.toISOString().replace('.000Z', '+00:00'));
      const wienH = h;
      t2m.push(5 + wienH / 2);
      const regen = wienH === 14 ? 1.6 : wienH === 15 ? 0.4 : 0;
      acc += regen;
      rr.push(url.includes('inca') ? regen : null);
      u.push(wienH === 10 ? 12 : 3); v2.push(wienH === 10 ? 12 : 4);
    }
    const p = url.includes('inca')
      ? { T2M: { data: t2m }, RR: { data: rr }, UU: { data: u }, VV: { data: v2 } }
      : { t2m: { data: t2m }, rr_acc: { data: (() => { let a = 0; return t2m.map((_, i) => { const h = i - 2; a += h === 14 ? 1.6 : h === 15 ? 0.4 : 0; return a; }); })() }, u10m: { data: u }, v10m: { data: v2 } };
    return { type: 'FeatureCollection', timestamps: ts, features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [16, 47.6] }, properties: { parameters: p } }] };
  };
  const s = await starte({ wetterAbruf: abruf });
  t.after(() => s.stop());
  const buero = await s.login(U.buero);
  const pol = await s.login(U.polier);
  const heute = wienDatum(s.uhr());
  const v = () => s.db.eins('SELECT version FROM baustelle WHERE id = ?', BS.pitten).version;

  await t.test('ohne Koordinaten → nicht verfügbar', async () => {
    const r = await buero.get(`/baustellen/${BS.pitten}/wetter`);
    assert.equal(r.status, 200);
    assert.deepEqual([r.daten.verfuegbar, r.daten.hinweis], [false, 'Wetter nicht verfügbar']);
  });

  await t.test('Vorhersage heute: Stunden, Zusammenfassung, Schlechtwetter ab 14:00, Zwischenspeicher', async () => {
    assert.equal((await buero.put(`/baustellen/${BS.pitten}`, { version: v(), lat: 47.72, lng: 16.06 })).status, 200);
    const r = await pol.get(`/baustellen/${BS.pitten}/wetter`);
    assert.equal(r.status, 200);
    const w = r.daten;
    assert.equal(w.verfuegbar, true);
    assert.equal(w.datensatz, 'nwp-v1-1h-2500m');
    assert.match(aufrufe[0], /forecast\/nwp-v1-1h-2500m\?lat_lon=47\.7200,16\.0600&parameters=t2m/);
    assert.equal(w.stunden.length, 24);
    assert.deepEqual([w.stunden[14].zeit, w.stunden[14].temperatur], ['14:00', 12]);
    assert.equal(w.stunden[14].niederschlag, 1.6);
    assert.equal(w.stunden[15].niederschlag, 0.4);
    assert.equal(w.stunden[10].wind, 61.1); // √(12²+12²) m/s × 3,6
    assert.equal(w.zusammenfassung.niederschlag, 2);
    assert.equal(w.zusammenfassung.temperaturMin, 8);
    assert.equal(w.zusammenfassung.temperaturMax, 14);
    assert.equal(w.schlechtwetter.vorschlag, true);
    assert.equal(w.schlechtwetter.ab, '10:00'); // Sturm 61 km/h um 10:00
    assert.ok(w.schlechtwetter.gruende.some((g) => /14:00: Niederschlag 1,6 mm/.test(g)));
    assert.equal(w.schlechtwetter.pruefen, true);
    assert.match(w.quelle, /GeoSphere/);
    const n = aufrufe.length;
    await pol.get(`/baustellen/${BS.pitten}/wetter`);
    assert.equal(aufrufe.length, n); // Zwischenspeicher
  });

  await t.test('vergangener Tag → INCA-Analyse; Ausfall → nicht verfügbar (10 min gemerkt)', async () => {
    const gestern = plusTage(heute, -1);
    const r = await buero.get(`/baustellen/${BS.pitten}/wetter?datum=${gestern}`);
    assert.equal(r.daten.datensatz, 'inca-v1-1h-1km');
    assert.match(aufrufe[aufrufe.length - 1], /historical\/inca-v1-1h-1km\?.*parameters=T2M.*&start=/);
    fehler = true;
    const f = await buero.get(`/baustellen/${BS.pitten}/wetter?datum=${plusTage(heute, -2)}`);
    assert.equal(f.daten.verfuegbar, false);
    assert.match(f.daten.grund, /Zeitüberschreitung/);
    const n = aufrufe.length;
    await buero.get(`/baustellen/${BS.pitten}/wetter?datum=${plusTage(heute, -2)}`);
    assert.equal(aufrufe.length, n);
    fehler = false;
    assert.equal((await buero.get(`/baustellen/${BS.pitten}/wetter?datum=${plusTage(heute, 20)}`)).daten.verfuegbar, false);
  });

  await t.test('Bericht: Wetter automatisch beim Anlegen, erneut übernehmen, Vorschlag im Bericht', async () => {
    const datum = plusTage(heute, -3);
    s.db.lauf('DELETE FROM bericht WHERE baustelle_id = ? AND datum = ?', BS.pitten, datum);
    const r = await pol.post('/berichte', { baustelleId: BS.pitten, datum });
    assert.equal(r.status, 201);
    assert.deepEqual(Object.keys(r.daten.wetter).sort(), ['niederschlag', 'quelle', 'temperatur', 'text', 'wind']);
    assert.match(r.daten.wetter.text, /°C/);
    assert.equal(r.daten.wetterVorschlag.vorschlag, true);
    s.db.lauf('UPDATE bericht SET wetter = NULL WHERE id = ?', r.daten.id);
    const w = await pol.post(`/berichte/${r.daten.id}/wetter`, {});
    assert.equal(w.status, 200);
    assert.equal(w.daten.wetter.quelle, 'GeoSphere Austria');
    assert.equal(w.daten.wetterVorschlag.ab, '10:00');
    const ma = await s.login(U.mitarbeiter);
    assert.equal((await ma.post(`/berichte/${r.daten.id}/wetter`, {})).status, 403);
  });
});

test('E-Mail (eigener SMTP-Server)', async (t) => {
  const smtp = await smtpServer();
  t.after(() => smtp.server.close());
  const s = await starte({ schluessel: 'test-schluessel-0123456789abcdef' });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  const buero = await s.login(U.buero);
  const pol = await s.login(U.polier);
  const heute = wienDatum(s.uhr());

  await t.test('Rechte und Einstellungen; Passwort verschlüsselt, nie ausgegeben', async () => {
    assert.equal((await buero.get('/einstellungen/email')).status, 403);
    assert.equal((await pol.put('/einstellungen/email', { host: 'x' })).status, 403);
    let r = await gf.get('/einstellungen/email');
    assert.deepEqual([r.daten.quelle, r.daten.aktiv, r.daten.schluesselVorhanden], [null, false, true]);
    r = await gf.put('/einstellungen/email', { host: '127.0.0.1', port: smtp.port, sicher: false, benutzer: '', passwort: 'geheim123', absender: 'bautag@firma.example', alarmAn: 'chef@firma.example', aktiv: true });
    assert.equal(r.status, 200);
    assert.deepEqual([r.daten.quelle, r.daten.passwortGesetzt, r.daten.passwort], ['einstellung', true, undefined]);
    const roh = s.db.einstellung('email', null);
    assert.match(roh.passwort, /^v1:/);
    assert.ok(!JSON.stringify(roh).includes('geheim123'));
    assert.ok(!JSON.stringify((await gf.get('/rechte')).daten.protokoll).includes('geheim123'));
    assert.equal((await gf.put('/einstellungen/email', { absender: 'kein-mail' })).status, 400);
    assert.equal((await gf.get('/integrationen')).daten.find((i) => i.schluessel === 'email').zustand, 'aktiv');
  });

  await t.test('Test-Mail', async () => {
    const r = await gf.post('/einstellungen/email/test', { an: 'test@firma.example' });
    assert.equal(r.status, 200);
    assert.equal(smtp.post.length, 1);
    assert.match(smtp.post[0].an[0], /test@firma\.example/);
    assert.match(smtp.post[0].daten, /Subject: BauTag: Test-E-Mail/);
  });

  await t.test('Bericht unterschrieben → AG-PDF an den Auftraggeber (ohne €); Versandstand im Bericht', async () => {
    const v = s.db.eins('SELECT version FROM baustelle WHERE id = ?', BS.kogler).version;
    assert.equal((await buero.put(`/baustellen/${BS.kogler}`, { version: v, agEmail: 'bauherr@ag.example' })).status, 200);
    const datum = plusTage(heute, -4);
    s.db.lauf('DELETE FROM bericht WHERE baustelle_id = ? AND datum = ?', BS.kogler, datum);
    const bl = await s.login(U.bauleiter);
    const ersteller = s.db.eins('SELECT polier_id FROM baustelle WHERE id = ?', BS.kogler).polier_id ? buero : bl;
    const b = (await ersteller.post('/berichte', { baustelleId: BS.kogler, datum })).daten;
    const vor = smtp.post.length;
    assert.equal((await ersteller.postV(`/berichte/${b.id}/unterschrift`, { rolle: 'an', name: 'Polier Test', bildPng: demoUnterschrift('a') })).status, 200);
    assert.equal(smtp.post.length, vor);
    assert.equal((await ersteller.postV(`/berichte/${b.id}/unterschrift`, { rolle: 'bh', name: 'Bauherr Test', bildPng: demoUnterschrift('b') })).status, 200);
    assert.ok(await warte(() => smtp.post.length > vor), 'Mail kam nicht an');
    const m = smtp.post[smtp.post.length - 1];
    assert.match(m.an[0], /bauherr@ag\.example/);
    assert.match(m.daten, /Content-Type: application\/pdf/);
    assert.match(m.daten, /JVBERi0/); // %PDF in Base64
    assert.ok(await warte(async () => ((await buero.get(`/berichte/${b.id}`)).daten.emailVersand || [])[0]?.status === 'gesendet'));
    const d = (await buero.get(`/berichte/${b.id}`)).daten;
    assert.equal(d.emailVersand[0].an, 'bauherr@ag.example');
    assert.equal((await pol.get(`/berichte/${b.id}`)).daten.emailVersand, undefined);
    // manuell erneut, Fehlerfall: SMTP weg → Status fehler + Benachrichtigung an Büro/GF
    assert.equal((await pol.post(`/berichte/${b.id}/email`, {})).status, 403);
    await gf.put('/einstellungen/email', { port: 1 });
    const r = await buero.post(`/berichte/${b.id}/email`, { an: 'zweiter@ag.example' });
    assert.equal(r.status, 202);
    assert.ok(await warte(async () => (await buero.get(`/berichte/${b.id}`)).daten.emailVersand.some((x) => x.status === 'fehler'), 20000));
    assert.ok((await gf.get('/benachrichtigungen')).daten.some((x) => x.typ === 'email' && /nicht zugestellt/.test(x.titel)));
    assert.equal((await buero.post(`/berichte/${b.id}/email`, { an: 'kaputt' })).status, 400);
  });

  await t.test('Passwort ohne BAUTAG_SCHLUESSEL → 400', async () => {
    const s2 = await starte();
    t.after(() => s2.stop());
    const g2 = await s2.login(U.gf);
    const old = process.env.BAUTAG_SCHLUESSEL;
    delete process.env.BAUTAG_SCHLUESSEL;
    try {
      assert.equal((await g2.put('/einstellungen/email', { host: 'mail.example', passwort: 'x' })).status, 400);
    } finally { if (old !== undefined) process.env.BAUTAG_SCHLUESSEL = old; }
  });
});
