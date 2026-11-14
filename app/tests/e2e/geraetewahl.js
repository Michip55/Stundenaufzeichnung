'use strict';
/**
 * Gerätewahl „Eigenes Handy“ / „Geteiltes Gerät“ (API.md 15.8):
 *   node tests/e2e/geraetewahl.js     (im Ordner app; E2E_NUR=handy|tablet|pc; Exit-Code 1 bei Befunden)
 * Wird auch von run.js je Bildschirmgröße aufgerufen (abschaltbar mit E2E_OHNE_GERAETEWAHL=1).
 *
 *  1. Neues Gerät: Auswahl auf der Anmeldeseite sichtbar, Standard „Geteiltes Gerät“.
 *  2. Geteiltes Gerät: nach 31 min ohne Bedienung abgemeldet (wie 15.5).
 *  3. Eigenes Handy (auf der Anmeldeseite gewählt): nach 31 min und nach 10 h ohne Bedienung weiter angemeldet, auch nach
 *     einem Neustart der App – nach mehr als der Sitzungsdauer des Servers (12 h) aber abgemeldet.
 *  4. Die Wahl übersteht das Abmelden und das Neuladen; in „Mehr“ änderbar (zurück auf „geteilt“ → Sperre gilt wieder).
 *  5. Eigenes Handy, Benutzerwechsel: gebundene Sitzung, Abmelden ohne Netz mit Nachholen, Versiegeln der Warteschlange,
 *     Push-Abo endet; der Mitarbeiter sieht und sendet nichts vom Polier; Benutzerwechsel nach Sitzungsablauf; der Polier sendet
 *     nach seiner Anmeldung alles. 15.12 (G2-021): der Benutzerwechsel setzt „Eigenes Handy“ auf „Geteiltes Gerät“ zurück.
 *  6. 15.12 (G2-021): „Eigenes Handy“ gilt nur für die Person, die es gewählt hat – in „Mehr“ gewählt oder vom Vorbenutzer auf
 *     der Anmeldeseite voreingestellt: die nächste andere Person ist auf „Geteiltes Gerät“ (deutlicher Hinweis, 30-min-Sperre);
 *     dieselbe Person behält ihre Wahl.
 *  7. 15.12: Eigenes Handy mit Push – die Sitzung läuft ab (Abo weg), dieselbe Person meldet sich an: Push ist ohne Klick wieder
 *     da (neues Abo an der neuen Sitzung). Eine andere Person am selben Gerät bekommt kein Abo, bis sie selbst einschaltet.
 * Die Untätigkeit wird wie in tests/e2e/geraet.js über die gemerkte letzte Bedienung (bt_aktiv) simuliert; Browser- und
 * Server-Uhr laufen gemeinsam (ctx.clock).
 */
const { chromium } = require('playwright');
const { starte, U, BS, START } = require('../api/hilfe');
const { GROESSEN } = require('./geraet');

const NAME = { [U.polier]: 'Josef Haidbauer', [U.mitarbeiter]: 'Lukas Brandstätter' };
const EP = 'https://handy.example.test/push/eigen-1';
const KEYS = { p256dh: 'BPx', auth: 'aa' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Push im Browser als Attrappe (wie geraet.js): Abo bleibt über Neuladen erhalten, unsubscribe() wird gezählt
function pushAttrappe(ep) {
  const lies = () => { try { return JSON.parse(localStorage.getItem('e2e_abo') || 'null'); } catch (e) { return null; } };
  const setz = (v) => localStorage.setItem('e2e_abo', JSON.stringify(v));
  if (!lies()) setz({ endpoint: ep, aktiv: true, abgemeldet: 0 });
  const sub = { get endpoint() { return lies().endpoint; }, async unsubscribe() { const a = lies(); a.aktiv = false; a.abgemeldet += 1; setz(a); return true; }, toJSON() { return { endpoint: lies().endpoint, keys: { p256dh: 'BPx', auth: 'aa' } }; } };
  const reg = { pushManager: { getSubscription: async () => (lies() && lies().aktiv ? sub : null), subscribe: async () => { const a = lies(); a.aktiv = true; a.angemeldet = (a.angemeldet || 0) + 1; setz(a); return sub; } } };
  const fake = { getRegistration: async () => reg, register: async () => reg, ready: Promise.resolve(reg), addEventListener() {}, controller: null };
  Object.defineProperty(Navigator.prototype, 'serviceWorker', { configurable: true, get: () => fake });
  // 15.12: Erlaubnis des Browsers als Attrappe (headless meldet immer „denied“) – e2e_erlaubnis, Standard „default“
  const erlaubnis = () => localStorage.getItem('e2e_erlaubnis') || 'default';
  Object.defineProperty(Notification, 'permission', { configurable: true, get: erlaubnis });
  Notification.requestPermission = async () => erlaubnis();
}

async function laufe(browser, g) {
  const fehler = [];
  let schritte = 0;
  const pruef = (ok, text) => { schritte++; if (!ok) { fehler.push(`Gerätewahl/${g.name}: ${text}`); console.log(`    ✗ Gerätewahl/${g.name}: ${text}`); } };
  const s = await starte({ test: true });
  let takt = null, ctx = null;
  try {
    const db = s.db;
    const anzahl = (sql, ...p) => db.eins(sql, ...p).n;
    const gebunden = (id) => anzahl('SELECT COUNT(*) AS n FROM sitzung WHERE benutzer_id = ? AND bindung_hash IS NOT NULL', id);
    const offlineBuchungen = (id) => anzahl("SELECT COUNT(*) AS n FROM buchung WHERE benutzer_id = ? AND quelle = 'offline'", id);
    const buchungen = (id) => anzahl('SELECT COUNT(*) AS n FROM buchung WHERE benutzer_id = ?', id);
    // Vorbereitung (API): Polier ausgestempelt, sein Push-Abo für dieses Handy
    const pol = await s.login(U.polier);
    const st = (await pol.get('/zeit/status')).daten.status;
    if (st === 'pause') await pol.post('/zeit/stempeln', { typ: 'pause_ende' });
    if (st !== 'aus') await pol.post('/zeit/stempeln', { typ: 'gehen' });
    if ((await pol.get('/zeit/status')).daten.status !== 'aus') throw new Error('Polier nicht ausgestempelt');
    if ((await pol.post('/push/abo', { endpoint: EP, keys: KEYS })).status !== 201) throw new Error('Push-Abo Polier');
    const bsPolier = db.eins('SELECT baustelle_id FROM benutzer WHERE id = ?', U.polier).baustelle_id || BS.pitten;
    const basis = new Date(START).getTime() + 10 * 60000, t0 = Date.now();
    const jetzt = () => basis + (Date.now() - t0);
    s.uhr.setze(new Date(jetzt()).toISOString());
    takt = setInterval(() => s.uhr.setze(new Date(jetzt()).toISOString()), 200);

    ctx = await browser.newContext({ viewport: { width: g.width, height: g.height }, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: g.mobil, serviceWorkers: 'block' });
    await ctx.clock.install({ time: new Date(jetzt()) });
    await ctx.addInitScript(pushAttrappe, EP);
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    const seitenfehler = [];
    page.on('pageerror', (e) => seitenfehler.push(String(e.message).slice(0, 160)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) seitenfehler.push(m.text().slice(0, 160)); });

    const bereit = async () => { await page.waitForFunction(() => !document.querySelector('#view .view-box > .state .spinner, #root > .state .spinner'), null, { timeout: 15000 }); await sleep(80); };
    const geh = async (h) => { await page.evaluate((x) => { location.hash = x; }, '#' + h); await page.waitForFunction((x) => location.hash === '#' + x, h); await bereit(); };
    const ls = (k) => page.evaluate((x) => localStorage.getItem(x), k);
    const angemeldet = async () => await page.locator('#view').count() === 1 && await page.locator('#login-card').count() === 0;
    const abgemeldet = async () => await page.locator('#view').count() === 0 && await page.locator('#login-card').count() === 1;
    const gewaehlt = () => page.evaluate(() => { const r = document.querySelector('#geraet-wahl input[name="geraet-art"]:checked'); return r ? r.value : null; });
    const waehle = async (art) => { await page.click(`#geraet-wahl label:has(input[value="${art}"])`); await sleep(100); };
    let ladeNr = 0;
    const zurAnmeldung = async () => { await page.goto(`${s.basis}/?wahl=${++ladeNr}#/login`); await page.waitForSelector('#login-card .login-user'); };
    async function anmelden(id, { laden = true } = {}) {
      if (laden) await zurAnmeldung();
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
    /** letzte Bedienung `min` Minuten zurückdatieren, dann tippen (wie geraet.js, Schritt 9) */
    async function untaetig(min, { neustart = false } = {}) {
      await page.evaluate((m) => localStorage.setItem('bt_aktiv', String(Date.now() - m * 60000)), min);
      if (neustart) { await page.goto(s.basis + '/#/stempeln'); await page.waitForSelector('#view, #login-card'); await bereit(); }
      else await page.mouse.click(5, 5);
      await sleep(1200);
      await page.waitForSelector('#view, #login-card');
    }

    /* ---- 1) neues Gerät: Standard „Geteiltes Gerät“ ---- */
    await zurAnmeldung();
    pruef(await page.locator('#geraet-wahl').isVisible(), 'Gerätewahl auf der Anmeldeseite nicht sichtbar');
    const txt = await page.locator('#geraet-wahl').innerText().catch(() => '');
    pruef(/Eigenes Handy/.test(txt) && /Geteiltes Gerät/.test(txt) && /Tablet im Bauhof/.test(txt), `Gerätewahl ohne beide Optionen/Erklärung: „${txt.slice(0, 160)}“`);
    pruef(await gewaehlt() === 'geteilt', `Standard ist nicht „Geteiltes Gerät“ (${await gewaehlt()})`);
    pruef(await ls('bt_geraet_art') === null, 'Gerätewahl ohne Zutun gespeichert');
    pruef(/30 Minuten/.test(await page.locator('#geraet-info').innerText().catch(() => '')), 'Erklärung zum geteilten Gerät fehlt');
    const breite = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    pruef(breite <= 0, `Anmeldeseite mit Gerätewahl scrollt waagrecht (${breite}px)`);

    /* ---- 2) geteiltes Gerät (Standard): Sperre nach 31 min ---- */
    await anmelden(U.polier, { laden: false });
    const ich = await page.evaluate(async () => (await fetch('/api/auth/ich')).json());
    pruef(ich.sperreMinuten === 30 && ich.sitzungMinuten === 720, `Vorbedingung: Sperre/Sitzung ${ich.sperreMinuten}/${ich.sitzungMinuten} statt 30/720`);
    await untaetig(31);
    pruef(await abgemeldet(), 'geteiltes Gerät: nach 31 min ohne Bedienung weiter angemeldet');
    pruef(gebunden(U.polier) === 0, 'geteiltes Gerät: Sperre beendet die Sitzung am Server nicht');

    /* ---- 3) eigenes Handy: keine 30-min-Sperre, aber nie länger als der Server ---- */
    await zurAnmeldung();
    await waehle('eigen');
    pruef(await ls('bt_geraet_art') === 'eigen', `Wahl „Eigenes Handy“ nicht gespeichert (${await ls('bt_geraet_art')})`);
    pruef(/Nur wählen, wenn sonst niemand/.test(await page.locator('#geraet-info').innerText()), 'Erklärung zum eigenen Handy fehlt');
    await anmelden(U.polier, { laden: false });
    pruef(gebunden(U.polier) === 1, 'eigenes Handy: Anmeldung ohne gebundene Sitzung');
    pruef(/bt_bindung=[0-9a-f]{64}/.test(await page.evaluate(() => document.cookie)), 'eigenes Handy: kein Bindungs-Cookie');
    await untaetig(31);
    pruef(await angemeldet(), 'eigenes Handy: nach 31 min ohne Bedienung abgemeldet');
    await untaetig(10 * 60); // 06:30 einstempeln … 16:30 ausstempeln
    pruef(await angemeldet(), 'eigenes Handy: nach 10 h ohne Bedienung abgemeldet');
    await untaetig(45, { neustart: true });
    pruef(await angemeldet(), 'eigenes Handy: Neustart der App nach 45 min ohne Bedienung meldet ab');
    pruef(gebunden(U.polier) === 1, 'eigenes Handy: Sitzung am Server während der Untätigkeit beendet');
    await untaetig(12 * 60 + 1); // länger als die Sitzung am Server (Feld 12 h)
    pruef(await abgemeldet(), 'eigenes Handy: nach mehr als der Sitzungsdauer des Servers weiter angemeldet');
    pruef(gebunden(U.polier) === 0, 'eigenes Handy: Abmelden nach Sitzungsdauer beendet die Sitzung am Server nicht');

    /* ---- 4) Wahl übersteht Abmelden und Neuladen; in „Mehr“ änderbar ---- */
    pruef(await ls('bt_geraet_art') === 'eigen', 'Gerätewahl nach dem Abmelden (Untätigkeit) verloren');
    await zurAnmeldung();
    pruef(await gewaehlt() === 'eigen', `Anmeldeseite zeigt nach dem Abmelden nicht „Eigenes Handy“ (${await gewaehlt()})`);
    await anmelden(U.polier, { laden: false });
    await abmelden();
    pruef(await ls('bt_geraet_art') === 'eigen' && await gewaehlt() === 'eigen', 'Gerätewahl übersteht das Abmelden in „Mehr“ nicht');
    await anmelden(U.polier);
    await geh('/mehr');
    pruef(await page.locator('#view #geraet-wahl').isVisible(), 'Gerätewahl in „Mehr“ fehlt');
    pruef(await gewaehlt() === 'eigen', `„Mehr“ zeigt nicht die Wahl des Geräts (${await gewaehlt()})`);
    await waehle('geteilt');
    pruef(await ls('bt_geraet_art') === 'geteilt', 'Wechsel auf „geteilt“ in „Mehr“ nicht gespeichert');
    pruef(await angemeldet(), 'Wechsel auf „geteilt“ meldet sofort ab');
    await untaetig(31);
    pruef(await abgemeldet(), 'nach Wechsel auf „geteilt“ in „Mehr“ gilt die 30-min-Sperre nicht');
    await zurAnmeldung();
    pruef(await gewaehlt() === 'geteilt', 'Anmeldeseite zeigt die in „Mehr“ geänderte Wahl nicht');
    await waehle('eigen');
    await anmelden(U.polier, { laden: false });
    await geh('/mehr');
    await waehle('eigen'); // schon gewählt – keine Änderung
    pruef(await ls('bt_geraet_art') === 'eigen', 'Vorbedingung: eigenes Handy');

    /* ---- 5) eigenes Handy: Benutzerwechsel – Abmelden ohne Netz, Versiegeln, Push, Nachholen ---- */
    // Push an diesem Handy (wieder) eingeschaltet – die Abmeldungen oben haben das Abo jeweils beendet (15.5, auch auf „eigen“)
    pruef(anzahl('SELECT COUNT(*) AS n FROM push_abo WHERE endpoint = ?', EP) === 0, 'eigenes Handy: Push-Abo nach den Abmeldungen oben am Server nicht gelöscht');
    await page.evaluate((ep) => localStorage.setItem('e2e_abo', JSON.stringify({ endpoint: ep, aktiv: true, abgemeldet: 0 })), EP);
    if ((await (await s.login(U.polier)).post('/push/abo', { endpoint: EP, keys: KEYS })).status !== 201) throw new Error('Push-Abo Polier (Schritt 5)');
    pruef(anzahl('SELECT COUNT(*) AS n FROM push_abo WHERE endpoint = ? AND benutzer_id = ?', EP, U.polier) === 1, 'Vorbedingung: Push-Abo des Poliers');
    const offVorher = offlineBuchungen(U.polier);
    await geh('/stempeln');
    await ctx.setOffline(true);
    await page.evaluate(async (bs) => { (await import('/js/offline.js')).einreihen({ typ: 'kommen', baustelleId: bs, zeit: new Date(Date.now() - 3 * 60000).toISOString() }); }, bsPolier);
    pruef(JSON.parse(await ls('bt_stempel_queue') || '[]').filter((e) => e.benutzerId === U.polier).length === 1, 'Vorbedingung: Offline-Stempelung des Poliers fehlt');
    await abmelden();
    let q = await ls('bt_stempel_queue') || '[]';
    pruef(JSON.parse(q).length === 1 && JSON.parse(q).every((e) => Object.keys(e).join() === 'versiegelt') && !/kommen|benutzerId/.test(q), `eigenes Handy: Warteschlange nach dem Abmelden nicht versiegelt: ${q.slice(0, 120)}`);
    pruef(!(await ls('bt_ich')) && !(await ls('bt_tresor')), 'eigenes Handy: Benutzerdaten/Schlüssel nach dem Abmelden am Gerät');
    pruef(!/bt_bindung/.test(await page.evaluate(() => document.cookie)), 'eigenes Handy: Bindungs-Cookie nach dem Abmelden noch da');
    pruef(!!(await ls('bt_abmelden_offen')), 'eigenes Handy: Abmelden ohne Netz nicht vorgemerkt');
    const a1 = JSON.parse(await ls('e2e_abo'));
    pruef(a1.abgemeldet === 1 && !a1.aktiv, 'eigenes Handy: Push-Abo im Browser beim Abmelden nicht beendet');
    pruef(await ls('bt_geraet_art') === 'eigen', 'eigenes Handy: Gerätewahl beim Abmelden ohne Netz verloren');
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => !localStorage.getItem('bt_abmelden_offen'), null, { timeout: 15000 }).catch(() => {});
    pruef(!(await ls('bt_abmelden_offen')), 'eigenes Handy: Abmelden nach Rückkehr des Netzes nicht nachgeholt');
    pruef(gebunden(U.polier) === 0, 'eigenes Handy: Sitzung des Poliers nach dem Nachholen nicht beendet');
    pruef(anzahl('SELECT COUNT(*) AS n FROM push_abo WHERE endpoint = ?', EP) === 0, 'eigenes Handy: Push-Abo des Poliers am Server nicht gelöscht');

    // Mitarbeiter am selben (als „eigen“ gewählten) Gerät: sieht und sendet nichts vom Polier
    const maVorher = buchungen(U.mitarbeiter), polVorher = buchungen(U.polier);
    await anmelden(U.mitarbeiter);
    await geh('/stempeln');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await sleep(1200);
    q = await ls('bt_stempel_queue') || '[]';
    pruef(JSON.parse(q).length === 1 && JSON.parse(q).every((e) => Object.keys(e).join() === 'versiegelt'), `eigenes Handy: Eintrag des Poliers beim Mitarbeiter nicht versiegelt: ${q.slice(0, 120)}`);
    pruef(buchungen(U.mitarbeiter) === maVorher && buchungen(U.polier) === polVorher, 'eigenes Handy: Offline-Buchung des Poliers nach dem Benutzerwechsel gesendet');
    pruef(!/Haidbauer/.test(await page.evaluate(() => document.body.innerText + JSON.stringify(localStorage))), 'eigenes Handy: Angaben des Poliers beim Mitarbeiter');
    pruef(await page.locator('#sync[data-ausstehend="0"][data-abgelehnt="0"]').count() === 1, 'eigenes Handy: Sync-Anzeige des Mitarbeiters zählt Einträge des Poliers');
    pruef(gebunden(U.mitarbeiter) === 1, 'eigenes Handy: Mitarbeiter ohne gebundene Sitzung');
    // 15.12 (G2-021): die Wahl „Eigenes Handy“ des Poliers gilt nicht für den Mitarbeiter
    pruef(await ls('bt_geraet_art') === 'geteilt' && await ls('bt_geraet_art_benutzer') === String(U.mitarbeiter), `Benutzerwechsel: „Eigenes Handy“ des Poliers gilt für den Mitarbeiter weiter (${await ls('bt_geraet_art')}/${await ls('bt_geraet_art_benutzer')})`);
    pruef(await page.locator('#geraet-hinweis:not([hidden])').isVisible() && /Geteiltes Gerät/.test(await page.locator('#geraet-hinweis').innerText()), 'Benutzerwechsel: kein deutlicher Hinweis auf „Geteiltes Gerät“');

    // Benutzerwechsel ohne Abmelden (Sitzung am Server abgelaufen) → Polier meldet sich an und sendet alles
    db.lauf('DELETE FROM sitzung WHERE benutzer_id = ?', U.mitarbeiter);
    await page.evaluate(() => { location.hash = '#/woche'; });
    await page.waitForSelector('#login-card', { timeout: 15000 });
    pruef(!(await ls('bt_ich')), 'eigenes Handy: nach Sitzungsablauf bleiben Benutzerdaten des Mitarbeiters');
    await anmelden(U.polier);
    pruef(gebunden(U.mitarbeiter) === 0 && gebunden(U.polier) === 1, 'eigenes Handy: Rotation/Bindung beim Benutzerwechsel falsch');
    await page.waitForFunction(() => !JSON.parse(localStorage.getItem('bt_stempel_queue') || '[]').length, null, { timeout: 20000 }).catch(() => {});
    pruef(offlineBuchungen(U.polier) === offVorher + 1, `eigenes Handy: Offline-Stempelung des Poliers nach seiner Anmeldung nicht gesendet (${offVorher}→${offlineBuchungen(U.polier)})`);
    // 15.12 (G2-021): auch der Wechsel Mitarbeiter → Polier ist ein Benutzerwechsel – „geteilt“ bleibt, bis der Polier selbst wählt
    pruef(await ls('bt_geraet_art') === 'geteilt', `Gerätewahl nach dem Benutzerwechsel nicht „geteilt“ (${await ls('bt_geraet_art')})`);

    /* ---- 6) 15.12 (G2-021): „Eigenes Handy“ gilt nur für die Person, die es gewählt hat ---- */
    await geh('/mehr');
    await waehle('eigen'); // der Polier wählt selbst in „Mehr“
    pruef(await ls('bt_geraet_art') === 'eigen' && await ls('bt_geraet_art_benutzer') === String(U.polier), 'Wahl in „Mehr“ nicht mit der Person gespeichert');
    pruef(await page.locator('#geraet-hinweis').isHidden(), 'Hinweis bleibt nach der eigenen Wahl stehen');
    await abmelden();
    pruef(await gewaehlt() === 'eigen', 'Anmeldeseite zeigt die Wahl des Vorbenutzers nicht an');
    pruef(/Gilt nur für die Person, die es gewählt hat/.test(await page.locator('#geraet-info').innerText()), 'Anmeldeseite warnt nicht, dass „Eigenes Handy“ nur für die wählende Person gilt');
    await anmelden(U.mitarbeiter, { laden: false }); // die nächste Person bemerkt die Voreinstellung nicht
    pruef(await ls('bt_geraet_art') === 'geteilt', 'G2-021: „Eigenes Handy“ des Poliers gilt für den nächsten Mitarbeiter');
    pruef(await page.locator('#geraet-hinweis').isVisible(), 'G2-021: kein Hinweis nach dem Zurücksetzen');
    await untaetig(31);
    pruef(await abgemeldet(), 'G2-021: Mitarbeiter am vom Polier voreingestellten Gerät nach 31 min ohne Bedienung weiter angemeldet');
    // Vorbenutzer (Mitarbeiter) stellt auf der Anmeldeseite still „Eigenes Handy“ ein → gilt nicht für den Polier
    await zurAnmeldung();
    await waehle('eigen');
    pruef(await ls('bt_geraet_art') === 'eigen' && await ls('bt_geraet_art_benutzer') === null, 'Wahl auf der Anmeldeseite (ohne Person) nicht gespeichert');
    await anmelden(U.polier, { laden: false });
    pruef(await ls('bt_geraet_art') === 'geteilt', 'G2-021: auf der Anmeldeseite voreingestelltes „Eigenes Handy“ gilt für die nächste Person');
    pruef(await page.locator('#geraet-hinweis').isVisible(), 'G2-021: kein Hinweis nach dem Zurücksetzen (Voreinstellung)');
    // der Polier entscheidet sich im Hinweis bewusst für „Eigenes Handy“ – und behält das bei der nächsten eigenen Anmeldung
    await page.click('#geraet-hinweis [data-geraet="eigen"]');
    await sleep(150);
    pruef(await ls('bt_geraet_art') === 'eigen' && await ls('bt_geraet_art_benutzer') === String(U.polier) && await page.locator('#geraet-hinweis').isHidden(), 'Wahl im Hinweis nicht übernommen');
    await abmelden();
    await anmelden(U.polier, { laden: false });
    pruef(await ls('bt_geraet_art') === 'eigen' && await page.locator('#geraet-hinweis').isHidden(), 'dieselbe Person verliert ihre Wahl „Eigenes Handy“');
    await untaetig(31);
    pruef(await angemeldet(), 'dieselbe Person: „Eigenes Handy“ meldet nach 31 min ab');

    /* ---- 7) 15.12: Push kommt auf dem eigenen Handy nach der Anmeldung derselben Person ohne Klick zurück ---- */
    const aboE = async () => JSON.parse(await ls('e2e_abo'));
    const aboAmServer = (id) => db.eins('SELECT * FROM push_abo WHERE endpoint = ? AND benutzer_id = ?', EP, id);
    const warteAuf = async (f) => { for (let i = 0; i < 60 && !f(); i++) await sleep(100); return f(); };
    // ohne Erlaubnis des Browsers geschieht nach der Anmeldung nichts (siehe unten: Mitarbeiter); jetzt erlaubt der Polier
    await page.evaluate(() => localStorage.setItem('e2e_erlaubnis', 'granted'));
    pruef(await page.evaluate(() => Notification.permission) === 'granted', 'Vorbedingung: Benachrichtigungen im Browser erlaubt');
    await page.evaluate((ep) => localStorage.setItem('e2e_abo', JSON.stringify({ endpoint: ep, aktiv: false, abgemeldet: 0, angemeldet: 0 })), EP);
    pruef(await ls('bt_geraet_art') === 'eigen' && await ls('bt_geraet_art_benutzer') === String(U.polier), 'Vorbedingung: eigenes Handy des Poliers');
    await geh('/push');
    await page.click('#push-an');
    pruef(await warteAuf(() => !!aboAmServer(U.polier)), 'Push einschalten: kein Abo am Server');
    pruef(JSON.parse(await ls('bt_push_wunsch') || '[]').includes(U.polier), 'Push-Wunsch des Poliers am Gerät nicht gemerkt');
    db.lauf('DELETE FROM sitzung WHERE benutzer_id = ?', U.polier); // Sitzung am Server abgelaufen
    pruef(!aboAmServer(U.polier), 'Abo überlebt das Ende der Sitzung');
    await page.evaluate(() => { location.hash = '#/woche'; });
    await page.waitForSelector('#login-card .login-user', { timeout: 15000 });
    for (let i = 0; i < 20 && (await aboE()).aktiv; i++) await sleep(100);
    pruef(!(await aboE()).aktiv, 'Abo im Browser nach dem Sitzungsablauf noch aktiv');
    const klicksVorher = (await aboE()).angemeldet;
    await anmelden(U.polier, { laden: false });
    pruef(await warteAuf(() => !!aboAmServer(U.polier)), 'eigenes Handy: Push kommt nach der Anmeldung derselben Person nicht von selbst zurück');
    const neueSitzung = db.eins('SELECT token_hash FROM sitzung WHERE benutzer_id = ? AND bindung_hash IS NOT NULL', U.polier);
    pruef(neueSitzung && (aboAmServer(U.polier) || {}).sitzung_hash === neueSitzung.token_hash, 'wiederhergestelltes Abo gehört nicht zur neuen Sitzung');
    pruef((await aboE()).aktiv && (await aboE()).angemeldet === klicksVorher + 1, 'Abo im Browser nicht (still) neu angelegt');
    pruef(await page.locator('dialog[open]').count() === 0, 'stilles Einschalten zeigt eine Rückfrage');
    // eine andere Person am selben Gerät: kein Abo, bis sie selbst einschaltet
    await abmelden();
    pruef(!db.eins('SELECT 1 AS x FROM push_abo WHERE endpoint = ?', EP), 'Abo nach dem Abmelden noch am Server');
    await anmelden(U.mitarbeiter, { laden: false });
    await sleep(1500);
    pruef(!db.eins('SELECT 1 AS x FROM push_abo WHERE endpoint = ?', EP) && !(await aboE()).aktiv, 'andere Person: Push-Wunsch des Poliers wurde für den Mitarbeiter eingeschaltet');
    pruef(!JSON.parse(await ls('bt_push_wunsch') || '[]').includes(U.mitarbeiter), 'Push-Wunsch dem Mitarbeiter zugeschrieben');
    await abmelden();

    pruef(seitenfehler.length === 0, `Konsolen-/Seitenfehler: ${seitenfehler.slice(0, 4).join(' | ')}`);
  } finally {
    clearInterval(takt);
    if (ctx) await ctx.close().catch(() => {});
    await s.stop();
  }
  return { fehler, schritte };
}

module.exports = { laufe };

if (require.main === module) {
  (async () => {
    const browser = await chromium.launch();
    let gesamt = 0;
    for (const g of GROESSEN.filter((x) => !process.env.E2E_NUR || process.env.E2E_NUR.split(',').includes(x.name))) {
      console.log(`\n▶ Gerätewahl ${g.name} (${g.width}×${g.height})`);
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
