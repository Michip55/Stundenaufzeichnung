'use strict';
/**
 * Geteiltes Tablet (API.md 15.5; Befunde F-014, F-029, F-030, F-046):
 *   node tests/e2e/geraet.js        (im Ordner app; E2E_NUR=handy|tablet|pc; Exit-Code 1 bei Befunden)
 * Wird auch von run.js je Bildschirmgröße aufgerufen (abschaltbar mit E2E_OHNE_GERAET=1).
 *
 *  1. Polier arbeitet ohne Netz (Stempelung, Schadensmeldung mit Foto, abgelehnte Stempelung), meldet sich ohne Netz ab:
 *     nichts davon ist am Gerät lesbar (versiegelt), Bindungs-Cookie weg, Push-Abo im Browser beendet, Abmelden vorgemerkt.
 *  2. Wieder online: das Abmelden wird vor allem anderen nachgeholt – Sitzung und Push-Abo des Poliers am Server gelöscht.
 *  3. Mitarbeiter meldet sich an: sieht nichts vom Polier, nichts davon wird mit seiner Sitzung gesendet.
 *  4. Polier meldet sich wieder an: alles wird entsiegelt und unter SEINER Sitzung gesendet.
 *  5. Benutzerwechsel mitten im Nachsenden (langsames Netz): nur die schon laufende Buchung geht (mit der Sitzung des Poliers),
 *     der Rest bleibt versiegelt und geht erst nach seiner nächsten Anmeldung.
 *  6. Sitzung abgelaufen, anderer Benutzer meldet sich an: Push-Abo des Vorbenutzers am Server gelöscht, im Browser beendet.
 *  7. Nach dem Abmelden ohne Netz öffnet das alte Sitzungs-Cookie nichts mehr (auch nicht mit gefälschtem bt_ich).
 *  8. Sperre nach Untätigkeit (Feldrolle 30 min) – auch beim Neustart der App.
 */
const { chromium } = require('playwright');
const { starte, U, BS, START } = require('../api/hilfe');
const { pngGrau } = require('../../server/png');

const GROESSEN = [
  { name: 'handy', width: 390, height: 844, mobil: true },
  { name: 'tablet', width: 1180, height: 820, mobil: true },
  { name: 'pc', width: 1440, height: 900, mobil: false }
];
const NAME = { [U.polier]: 'Josef Haidbauer', [U.mitarbeiter]: 'Lukas Brandstätter' };
const EP1 = 'https://tablet.example.test/push/geraet-1';
const EP2 = 'https://tablet.example.test/push/geraet-2';
const EP_MA = 'https://ma-handy.example.test/push/m';
const KEYS = { p256dh: 'BPx', auth: 'aa' };
const FOTO = 'data:image/png;base64,' + pngGrau(8, 8, 128).toString('base64');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Push im Browser als Attrappe: Abo des Geräts (bleibt über Neuladen erhalten), unsubscribe() wird gezählt
function pushAttrappe(ep) {
  const lies = () => { try { return JSON.parse(localStorage.getItem('e2e_abo') || 'null'); } catch (e) { return null; } };
  const setz = (v) => localStorage.setItem('e2e_abo', JSON.stringify(v));
  if (!lies()) setz({ endpoint: ep, aktiv: true, abgemeldet: 0 });
  const sub = { get endpoint() { return lies().endpoint; }, async unsubscribe() { const a = lies(); a.aktiv = false; a.abgemeldet += 1; setz(a); return true; }, toJSON() { return { endpoint: lies().endpoint, keys: { p256dh: 'BPx', auth: 'aa' } }; } };
  const reg = { pushManager: { getSubscription: async () => (lies() && lies().aktiv ? sub : null), subscribe: async () => sub } };
  const fake = { getRegistration: async () => reg, register: async () => reg, ready: Promise.resolve(reg), addEventListener() {}, controller: null };
  Object.defineProperty(Navigator.prototype, 'serviceWorker', { configurable: true, get: () => fake });
}

async function laufe(browser, g) {
  const fehler = [];
  let schritte = 0;
  const pruef = (ok, text) => { schritte++; if (!ok) { fehler.push(`Gerät/${g.name}: ${text}`); console.log(`    ✗ Gerät/${g.name}: ${text}`); } };
  const s = await starte({ test: true });
  let takt = null, ctx = null;
  try {
    const db = s.db;
    const anzahl = (sql, ...p) => db.eins(sql, ...p).n;
    const offlineBuchungen = (id) => anzahl("SELECT COUNT(*) AS n FROM buchung WHERE benutzer_id = ? AND quelle = 'offline'", id);
    const buchungen = (id) => anzahl('SELECT COUNT(*) AS n FROM buchung WHERE benutzer_id = ?', id);
    // Vorbereitung (API): Polier ausgestempelt, Push-Abos von Polier (dieses Tablet) und Mitarbeiter (eigenes Handy)
    const pol = await s.login(U.polier);
    const st = (await pol.get('/zeit/status')).daten.status;
    if (st === 'pause') await pol.post('/zeit/stempeln', { typ: 'pause_ende' });
    if (st !== 'aus') await pol.post('/zeit/stempeln', { typ: 'gehen' });
    if ((await pol.get('/zeit/status')).daten.status !== 'aus') throw new Error('Polier nicht ausgestempelt');
    if ((await pol.post('/push/abo', { endpoint: EP1, keys: KEYS })).status !== 201) throw new Error('Push-Abo Polier');
    if ((await (await s.login(U.mitarbeiter)).post('/push/abo', { endpoint: EP_MA, keys: KEYS })).status !== 201) throw new Error('Push-Abo Mitarbeiter');
    const bsPolier = db.eins('SELECT baustelle_id FROM benutzer WHERE id = ?', U.polier).baustelle_id || BS.pitten;
    // Server- und Browser-Uhr laufen ab START + 10 min in Echtzeit (Offline-Zeitpunkte liegen nach der letzten Buchung)
    const basis = new Date(START).getTime() + 10 * 60000, t0 = Date.now();
    const jetzt = () => basis + (Date.now() - t0);
    s.uhr.setze(new Date(jetzt()).toISOString());
    takt = setInterval(() => s.uhr.setze(new Date(jetzt()).toISOString()), 200);

    ctx = await browser.newContext({ viewport: { width: g.width, height: g.height }, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: g.mobil, serviceWorkers: 'block' });
    await ctx.clock.install({ time: new Date(jetzt()) });
    await ctx.addInitScript(pushAttrappe, EP1);
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    const seitenfehler = [];
    page.on('pageerror', (e) => seitenfehler.push(String(e.message).slice(0, 160)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) seitenfehler.push(m.text().slice(0, 160)); });
    if (process.env.GERAET_LOG) { page.on('requestfailed', (r) => console.log('      [failed]', r.method(), r.url(), r.failure() && r.failure().errorText)); page.on('response', (r) => { if (r.url().includes('/api/')) console.log('      [resp]', r.request().method(), r.url().replace(s.basis, ''), r.status()); }); }
    const stempelAnfragen = [];
    page.on('request', (r) => { if (r.url().endsWith('/api/zeit/stempeln')) stempelAnfragen.push({ ersteller: r.headers()['x-bautag-ersteller'] || null }); });

    const bereit = async () => { await page.waitForFunction(() => !document.querySelector('#view .view-box > .state .spinner, #root > .state .spinner'), null, { timeout: 15000 }); await sleep(80); };
    const geh = async (h) => { await page.evaluate((x) => { location.hash = x; }, '#' + h); await page.waitForFunction((x) => location.hash === '#' + x, h); await bereit(); };
    let ladeNr = 0;
    async function anmelden(id) {
      await page.goto(`${s.basis}/?anmelden=${++ladeNr}#/login`);
      try { await page.waitForSelector('.login-user'); } catch (e) { throw new Error(`Anmeldeseite ohne Namensliste: ${(await page.evaluate(() => document.body.innerText)).slice(-300)} | ${seitenfehler.join(' | ')}`); }
      await page.fill('#login-suche', NAME[id].split(' ')[1]);
      await page.click(`.login-user:has-text("${NAME[id]}")`);
      await page.waitForSelector('.pin-pad');
      for (const z of '1234') await page.click(`.pin-pad [data-z="${z}"]`);
      await page.click('.pin-pad [data-ok]');
      await page.waitForSelector('#view');
      await bereit();
    }
    async function abmelden() {
      await geh('/mehr');
      await page.click('#abmelden');
      const ok = page.locator('dialog[open] [data-ok]');
      await sleep(200);
      if (await ok.count()) await ok.click();
      await page.waitForSelector('#login-card .login-user, #login-card .state:not(:has(.spinner))', { timeout: 20000 });
    }
    const lager = () => page.evaluate(async () => {
      const ls = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = localStorage.getItem(k); }
      const idb = await new Promise((ok) => { const r = indexedDB.open('bautag-schaden', 1); r.onupgradeneeded = () => r.result.createObjectStore('meldungen', { keyPath: 'clientId' }); r.onsuccess = () => { const t = r.result.transaction('meldungen', 'readonly'); const q = t.objectStore('meldungen').getAll(); q.onsuccess = () => { ok(q.result); r.result.close(); }; }; r.onerror = () => ok(null); });
      return { ls, idb, cookie: document.cookie };
    });
    const versiegeltOk = (wo, l, angemeldet = null) => {
      for (const k of ['bt_stempel_queue', 'bt_stempel_abgelehnt']) {
        const roh = l.ls[k] || '[]';
        const liste = JSON.parse(roh);
        pruef(liste.length > 0 && liste.every((e) => Object.keys(e).join() === 'versiegelt'), `${wo}: ${k} nicht (nur) versiegelt: ${roh.slice(0, 160)}`);
        pruef(!/kommen|gehen|benutzerId|abg-1|Haidbauer/.test(roh), `${wo}: ${k} enthält Klartext des Poliers`);
      }
      const idb = JSON.stringify(l.idb || []);
      pruef((l.idb || []).length === 1 && l.idb.every((e) => Object.keys(e).sort().join() === 'clientId,versiegelt' && /^v-/.test(e.clientId)), `${wo}: Schadensmeldung in IndexedDB nicht versiegelt: ${idb.slice(0, 200)}`);
      pruef(!/Hydraulik|Bagger|data:image|benutzerId|e2e-schaden-1/.test(idb), `${wo}: Schadensmeldung/Foto des Poliers in IndexedDB lesbar`);
      const ichJ = JSON.parse(l.ls.bt_ich || 'null'), tresor = JSON.parse(l.ls.bt_tresor || 'null');
      pruef((angemeldet ? (!ichJ || ichJ.benutzer.id === angemeldet) && (!tresor || tresor.benutzerId === angemeldet) : !ichJ && !tresor) && !Object.values(l.ls).some((w) => /Haidbauer/.test(w)), `${wo}: Benutzerdaten oder Schlüssel des Poliers im Gerätespeicher (${Object.keys(l.ls).join(',')})`);
    };
    const abo = async () => JSON.parse(await page.evaluate(() => localStorage.getItem('e2e_abo')));

    /* ---- 1) Polier am Tablet, arbeitet ohne Netz ---- */
    await anmelden(U.polier);
    pruef(/bt_bindung=[0-9a-f]{64}/.test(await page.evaluate(() => document.cookie)), 'App-Sitzung ohne Bindungs-Cookie');
    pruef((await ctx.cookies()).some((c) => c.name === 'bt_session' && c.httpOnly), 'Sitzungs-Cookie nicht HttpOnly');
    pruef(anzahl('SELECT COUNT(*) AS n FROM push_abo WHERE endpoint = ? AND benutzer_id = ?', EP1, U.polier) === 1, 'eigenes Push-Abo des Poliers bei seiner Anmeldung gelöscht');
    pruef(anzahl('SELECT COUNT(*) AS n FROM sitzung WHERE benutzer_id = ? AND bindung_hash IS NOT NULL', U.polier) === 1, 'Anmeldung der App ohne gebundene Sitzung');
    await geh('/stempeln');
    const offVorher = offlineBuchungen(U.polier);
    await ctx.setOffline(true);
    await page.evaluate(async ([bs, foto]) => {
      const zeit = (min) => new Date(Date.now() - min * 60000).toISOString();
      (await import('/js/offline.js')).einreihen({ typ: 'kommen', baustelleId: bs, zeit: zeit(4) });
      await (await import('/js/schaden-offline.js')).schadenMerken({ clientId: 'e2e-schaden-1', benutzerId: 1, erstellt: zeit(3), geraet: 'Bagger X', body: { art: 'defekt', ursache: 'Hydraulikschlauch geplatzt', einsatzfaehig: 'eingeschraenkt', fremdGeraet: 'Bagger X', zeitpunkt: zeit(3) }, fotos: [{ daten: foto, dateiname: 'schlauch.png', gesendet: false }], zustand: 'wartet' });
      const ab = JSON.parse(localStorage.getItem('bt_stempel_abgelehnt') || '[]');
      ab.push({ benutzerId: 1, typ: 'gehen', zeit: zeit(30), nr: 'abg-1', grund: 'Nicht eingestempelt.', code: 409, abgelehntUm: zeit(2) });
      localStorage.setItem('bt_stempel_abgelehnt', JSON.stringify(ab));
    }, [bsPolier, FOTO]);
    pruef(JSON.parse((await lager()).ls.bt_stempel_queue || '[]').filter((e) => e.benutzerId === U.polier).length === 1, 'Vorbedingung: Offline-Stempelung des Poliers fehlt');

    /* ---- 2) Abmelden ohne Netz ---- */
    await abmelden();
    let l = await lager();
    versiegeltOk('nach Abmelden ohne Netz', l);
    pruef(!/bt_bindung/.test(l.cookie), `Bindungs-Cookie nach dem Abmelden noch da („${l.cookie}“)`);
    const merker = JSON.parse(l.ls.bt_abmelden_offen || 'null');
    pruef(merker && merker.endpoint === EP1 && Object.keys(merker).sort().join() === 'endpoint,seit', `Abmelden am Server nicht (richtig) vorgemerkt: ${l.ls.bt_abmelden_offen}`);
    pruef((await abo()).abgemeldet === 1 && !(await abo()).aktiv, 'Push-Abo im Browser beim Abmelden nicht beendet');
    pruef(await page.locator('#view').count() === 0, 'App zeigt nach dem Abmelden noch Ansichten');

    /* ---- 3) wieder online: Abmelden wird zuerst nachgeholt ---- */
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => !localStorage.getItem('bt_abmelden_offen'), null, { timeout: 15000 }).catch(() => {});
    pruef(!(await page.evaluate(() => localStorage.getItem('bt_abmelden_offen'))), 'vorgemerktes Abmelden nach Rückkehr des Netzes nicht nachgeholt');
    pruef(anzahl('SELECT COUNT(*) AS n FROM sitzung WHERE benutzer_id = ?', U.polier) === 1, 'Vorbedingung: API-Sitzung des Poliers (Testvorbereitung) weg'); // nur die der Vorbereitung (pol)
    pruef(anzahl('SELECT COUNT(*) AS n FROM sitzung WHERE benutzer_id = ? AND bindung_hash IS NOT NULL', U.polier) === 0, 'Tablet-Sitzung des Poliers nach dem Nachholen nicht beendet');
    pruef(anzahl('SELECT COUNT(*) AS n FROM push_abo WHERE endpoint = ?', EP1) === 0, 'Push-Abo des Poliers für dieses Tablet am Server nicht gelöscht');
    pruef(anzahl('SELECT COUNT(*) AS n FROM push_abo WHERE endpoint = ?', EP_MA) === 1, 'fremdes Push-Abo (Mitarbeiter-Handy) gelöscht');

    /* ---- 4) Mitarbeiter am selben Tablet ---- */
    const maVorher = buchungen(U.mitarbeiter);
    const polVorher = buchungen(U.polier);
    const schadenVorher = anzahl("SELECT COUNT(*) AS n FROM mangel WHERE text = 'Hydraulikschlauch geplatzt'");
    await anmelden(U.mitarbeiter);
    await geh('/stempeln');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await sleep(1200);
    l = await lager();
    versiegeltOk('beim Mitarbeiter', l, U.mitarbeiter);
    pruef(buchungen(U.mitarbeiter) === maVorher && buchungen(U.polier) === polVorher, `Offline-Buchung des Poliers wurde nach dem Benutzerwechsel gesendet (MA ${maVorher}→${buchungen(U.mitarbeiter)}, Polier ${polVorher}→${buchungen(U.polier)})`);
    pruef(anzahl("SELECT COUNT(*) AS n FROM mangel WHERE text = 'Hydraulikschlauch geplatzt'") === schadenVorher, 'Schadensmeldung des Poliers wurde mit der Sitzung des Mitarbeiters gesendet');
    const sichtbar = await page.evaluate(() => document.body.innerText);
    pruef(!/Haidbauer|Hydraulik|Bagger X/.test(sichtbar), 'Angaben des Poliers in der Oberfläche des Mitarbeiters');
    pruef(await page.locator('#sync[data-ausstehend="0"][data-abgelehnt="0"]').count() === 1, 'Sync-Anzeige des Mitarbeiters zählt Einträge des Poliers');
    await abmelden();

    /* ---- 5) Polier wieder angemeldet: alles wird unter seiner Sitzung gesendet ---- */
    await anmelden(U.polier);
    await page.waitForFunction(() => !JSON.parse(localStorage.getItem('bt_stempel_queue') || '[]').length, null, { timeout: 20000 }).catch(() => {});
    await geh('/fuhrpark');
    for (let i = 0; i < 40 && anzahl("SELECT COUNT(*) AS n FROM mangel WHERE text = 'Hydraulikschlauch geplatzt'") === schadenVorher; i++) await sleep(250);
    pruef(offlineBuchungen(U.polier) === offVorher + 1, `Offline-Stempelung des Poliers nach seiner Anmeldung nicht gesendet (${offVorher}→${offlineBuchungen(U.polier)})`);
    const sch = db.eins("SELECT * FROM mangel WHERE text = 'Hydraulikschlauch geplatzt' ORDER BY id DESC");
    pruef(sch && sch.gemeldet_von === U.polier && sch.client_id === 'e2e-schaden-1', `Schadensmeldung nicht (vom Polier) gesendet: ${JSON.stringify(sch && { von: sch.gemeldet_von, c: sch.client_id })}`);
    await geh('/stempeln');
    pruef(await page.locator('#abgelehnt li').count() === 1, 'abgelehnte Stempelung des Poliers nach seiner Anmeldung nicht wieder sichtbar');
    l = await lager();
    pruef(!Object.entries(l.ls).some(([, w]) => /"versiegelt"/.test(w)) && !(l.idb || []).some((e) => e.versiegelt), 'versiegelte Einträge bleiben nach der Anmeldung des Poliers liegen');
    if (await page.locator('[data-abg-weg]').count()) { await page.click('[data-abg-weg]'); await page.click('dialog[open] [data-ok]'); }

    /* ---- 6) Benutzerwechsel mitten im Nachsenden (F-030) ---- */
    const status = (await page.evaluate(async () => (await fetch('/api/zeit/status')).json())).status;
    const folge = status === 'aus' ? ['kommen', 'gehen', 'kommen'] : ['gehen', 'kommen', 'gehen'];
    let ersteAngehalten = false;
    // langsames Netz: der Server bucht sofort, die Antwort kommt erst nach 3 s
    await page.route('**/api/zeit/stempeln', async (r) => {
      if (ersteAngehalten) return r.continue().catch(() => {});
      ersteAngehalten = true;
      const antwort = await r.fetch();
      await sleep(3000);
      await r.fulfill({ response: antwort }).catch(() => {});
    });
    await ctx.setOffline(true);
    await page.evaluate(async ([f, bs]) => {
      const m = await import('/js/offline.js');
      f.forEach((typ, i) => m.einreihen({ typ, ...(typ === 'kommen' ? { baustelleId: bs } : {}), zeit: new Date(Date.now() - (90 - i * 30) * 1000).toISOString() }));
    }, [folge, bsPolier]);
    const polVor6 = buchungen(U.polier), maVor6 = buchungen(U.mitarbeiter);
    stempelAnfragen.length = 0;
    await ctx.setOffline(false);
    await page.evaluate(() => { import('/js/offline.js').then((m) => m.nachsenden()); });
    await sleep(400);
    await abmelden(); // Rückfrage bestätigt, während Buchung 1 noch unterwegs ist
    await anmelden(U.mitarbeiter);
    await geh('/stempeln');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await sleep(1500);
    await page.unroute('**/api/zeit/stempeln');
    pruef(stempelAnfragen.length === 1 && stempelAnfragen[0].ersteller === String(U.polier), `während des Benutzerwechsels gingen ${stempelAnfragen.length} Stempel-Anfragen hinaus (${JSON.stringify(stempelAnfragen)})`);
    pruef(buchungen(U.mitarbeiter) === maVor6, `Buchungen des Poliers landeten beim Mitarbeiter (${maVor6}→${buchungen(U.mitarbeiter)})`);
    pruef(buchungen(U.polier) === polVor6 + 1, `die schon laufende Buchung des Poliers fehlt oder es gingen mehr (${polVor6}→${buchungen(U.polier)})`);
    l = await lager();
    const q6 = JSON.parse(l.ls.bt_stempel_queue || '[]');
    pruef(q6.length === 2 && q6.every((e) => Object.keys(e).join() === 'versiegelt'), `restliche Buchungen des Poliers nicht versiegelt am Gerät: ${(l.ls.bt_stempel_queue || '').slice(0, 120)}`);
    await abmelden();
    await anmelden(U.polier);
    await page.waitForFunction(() => !JSON.parse(localStorage.getItem('bt_stempel_queue') || '[]').length, null, { timeout: 20000 }).catch(() => {});
    pruef(buchungen(U.polier) === polVor6 + 3, `restliche Buchungen nach der Anmeldung des Poliers nicht gesendet (${polVor6}→${buchungen(U.polier)})`);
    pruef(stempelAnfragen.every((a) => a.ersteller === String(U.polier)), 'Nachsenden ohne Angabe des Erstellers');

    /* ---- 7) Sitzung abgelaufen, Mitarbeiter meldet sich am Tablet an: Push des Poliers endet hier ---- */
    await page.evaluate((ep) => localStorage.setItem('e2e_abo', JSON.stringify({ endpoint: ep, aktiv: true, abgemeldet: 0 })), EP2);
    if ((await (await s.login(U.polier)).post('/push/abo', { endpoint: EP2, keys: KEYS })).status !== 201) throw new Error('Push-Abo EP2');
    db.lauf('DELETE FROM sitzung WHERE benutzer_id = ?', U.polier); // Ablauf am Server
    await page.evaluate(() => { location.hash = '#/woche'; });
    await page.waitForSelector('#login-card', { timeout: 15000 });
    await anmelden(U.mitarbeiter);
    await sleep(300);
    pruef(anzahl('SELECT COUNT(*) AS n FROM push_abo WHERE endpoint = ?', EP2) === 0, 'Push-Abo des Poliers bleibt nach Anmeldung des Mitarbeiters am selben Gerät');
    pruef((await abo()).abgemeldet === 1, 'Push-Abo des Vorbenutzers im Browser beim Benutzerwechsel nicht beendet');

    /* ---- 8) Abmelden ohne Netz: das alte Cookie öffnet nichts mehr ---- */
    await ctx.setOffline(true);
    await abmelden();
    const kekse = await ctx.cookies();
    const alt = (kekse.find((c) => c.name === 'bt_session') || {}).value;
    pruef(!kekse.some((c) => c.name === 'bt_bindung'), 'Bindungs-Cookie nach dem Abmelden ohne Netz noch im Browser');
    pruef(alt && anzahl('SELECT COUNT(*) AS n FROM sitzung WHERE benutzer_id = ?', U.mitarbeiter) >= 1, 'Vorbedingung: Sitzung am Server sollte ohne Netz noch bestehen');
    const probe = await fetch(s.basis + '/api/auth/ich', { headers: { cookie: `bt_session=${alt}` } });
    pruef(probe.status === 401, `altes Sitzungs-Cookie nach dem Abmelden ohne Netz noch gültig (${probe.status})`);
    pruef(anzahl('SELECT COUNT(*) AS n FROM sitzung WHERE benutzer_id = ? AND bindung_hash IS NOT NULL', U.mitarbeiter) === 0, 'Sitzung ohne Bindung am Server nicht beendet');
    await ctx.setOffline(false);
    // Angriff aus dem Befund: gefälschtes bt_ich und Neuladen → keine Ansicht als Vorbenutzer
    await page.evaluate(() => localStorage.setItem('bt_ich', JSON.stringify({ benutzer: { id: 2, name: 'Lukas Brandstätter', rolle: 'mitarbeiter' }, rechte: ['zeit_eigen'] })));
    await page.goto(s.basis + '/#/stempeln');
    await page.waitForSelector('#login-card .login-user', { timeout: 15000 });
    pruef(await page.locator('#view').count() === 0, 'mit gefälschtem bt_ich startet die App als Vorbenutzer');
    pruef(!(await page.evaluate(() => localStorage.getItem('bt_abmelden_offen'))), 'vorgemerktes Abmelden nach dem Neuladen nicht nachgeholt');

    /* ---- 9) Sperre nach Untätigkeit ---- */
    await anmelden(U.polier);
    const ich = await page.evaluate(async () => (await fetch('/api/auth/ich')).json());
    pruef(ich.sperreMinuten === 30, `Sperrzeit für den Polier ${ich.sperreMinuten} statt 30 min`);
    await page.evaluate(() => localStorage.setItem('bt_aktiv', String(Date.now() - 31 * 60000)));
    await page.mouse.click(5, 5);
    await page.waitForSelector('#login-card', { timeout: 15000 }).catch(() => {});
    pruef(await page.locator('#view').count() === 0 && await page.locator('#login-card').count() === 1, 'nach 31 min ohne Bedienung bleibt die App angemeldet');
    pruef(anzahl('SELECT COUNT(*) AS n FROM sitzung WHERE benutzer_id = ? AND bindung_hash IS NOT NULL', U.polier) === 0, 'Sperre nach Untätigkeit beendet die Sitzung am Server nicht');
    await anmelden(U.polier);
    await page.evaluate(() => localStorage.setItem('bt_aktiv', String(Date.now() - 31 * 60000)));
    await page.goto(s.basis + '/#/stempeln');
    await page.waitForSelector('#login-card', { timeout: 15000 }).catch(() => {});
    pruef(await page.locator('#view').count() === 0, 'Neustart der App nach 31 min ohne Bedienung bleibt angemeldet');

    pruef(seitenfehler.length === 0, `Konsolen-/Seitenfehler: ${seitenfehler.slice(0, 4).join(' | ')}`);
  } finally {
    clearInterval(takt);
    if (ctx) await ctx.close().catch(() => {});
    await s.stop();
  }
  return { fehler, schritte };
}

module.exports = { laufe, GROESSEN };

if (require.main === module) {
  (async () => {
    const browser = await chromium.launch();
    let gesamt = 0;
    for (const g of GROESSEN.filter((x) => !process.env.E2E_NUR || process.env.E2E_NUR.split(',').includes(x.name))) {
      console.log(`\n▶ Geteiltes Gerät ${g.name} (${g.width}×${g.height})`);
      const t = Date.now();
      let r;
      try { r = await laufe(browser, g); } catch (e) { r = { fehler: ['Abbruch: ' + e.message], schritte: 0 }; console.log('    ✗ ' + e.stack); }
      gesamt += r.fehler.length;
      console.log(`${r.fehler.length ? '✗' : '✓'} ${g.name}: ${r.schritte - r.fehler.length}/${r.schritte} Prüfungen bestanden (${((Date.now() - t) / 1000).toFixed(1)} s)`);
    }
    await browser.close();
    process.exit(gesamt ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(2); });
}
