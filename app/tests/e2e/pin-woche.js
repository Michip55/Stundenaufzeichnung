'use strict';
/**
 * PIN nur einmal pro Woche auf dem eigenen Gerät (API.md 15.28, Inhaber 19.11.2026):
 *   node tests/e2e/pin-woche.js     (im Ordner app; E2E_NUR=handy|tablet|pc; Exit-Code 1 bei Befunden)
 * Wird auch von run.js je Bildschirmgröße aufgerufen (abschaltbar mit E2E_OHNE_PIN_WOCHE=1).
 *
 *  1. Texte: Anmeldeseite und „Mehr“ sagen bei „Eigenes Handy“ „Du bleibst bis Sonntag angemeldet. Am Montag fragt die App
 *     einmal nach der PIN.“; „Geteiltes Gerät“ behält seinen Text; die Namen der Optionen bleiben.
 *  2. Büro am eigenen Handy (Mittwoch): Uhr springt 20 h weiter (Server und Browser, ohne Bedienung) → weiter angemeldet, auch
 *     nach einem Neustart der App; Sonntag 23:59 weiter angemeldet; Montag 00:00 → Anmeldeseite, Sitzung am Server weg; die
 *     Anmeldung am Montag gilt wieder bis zum nächsten Sonntag.
 *  3. Polier am eigenen Handy: 13 h ohne Bedienung (über der Feld-Grenze von 12 h) → weiter angemeldet.
 *  4. Wechsel in „Mehr“ auf „Geteiltes Gerät“: Sitzung am Server sofort normal, Hinweis „Gilt ab deiner nächsten Anmeldung mit
 *     PIN“ beim Zurückwechseln; danach meldet die App nach 61 min ohne Bedienung ab (Büro wie bisher).
 *  5. Geteiltes Gerät: Mitarbeiter nach 31 min ohne Bedienung abgemeldet (unverändert), Sitzung am Server normal.
 * Browser- und Server-Uhr laufen gemeinsam und springen gemeinsam (ctx.clock.setSystemTime, starte().uhr).
 */
const { chromium } = require('playwright');
const { starte, U } = require('../api/hilfe');
const { GROESSEN } = require('./geraet');

const NAME = { [U.polier]: 'Josef Haidbauer', [U.mitarbeiter]: 'Lukas Brandstätter', [U.buero]: 'Martina Koller' };
const MI = '2026-11-18T07:00:00.000Z';           // Mittwoch 18.11.2026, 08:00 Wiener Zeit
const WOCHENENDE = '2026-11-22T23:00:00.000Z';   // Montag 23.11.2026, 00:00 Wiener Zeit
const NAECHSTE = '2026-11-29T23:00:00.000Z';
const EIGEN_TEXT = 'Du bleibst bis Sonntag angemeldet. Am Montag fragt die App einmal nach der PIN.';
const GETEILT_TEXT = 'Mitarbeiter und Polier werden nach 30 Minuten ohne Bedienung automatisch abgemeldet, damit niemand unter fremdem Namen weiterarbeitet.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function laufe(browser, g) {
  const fehler = [];
  let schritte = 0;
  const pruef = (ok, text) => { schritte++; if (!ok) { fehler.push(`PIN-Woche/${g.name}: ${text}`); console.log(`    ✗ PIN-Woche/${g.name}: ${text}`); } };
  // Sitzungsgrenzen wie im Betrieb: Feld 12 h, Büro 60 min Untätigkeit, höchstens 24 h, Sperre Feld 30 min
  const s = await starte({ test: true, sitzung: { feldMin: 720, bueroMin: 60, maxH: 24 }, start: MI });
  let takt = null, ctx = null;
  try {
    const db = s.db;
    for (const id of Object.keys(NAME)) NAME[id] = db.eins('SELECT name FROM benutzer WHERE id = ?', Number(id)).name;
    const sitzung = (id) => db.eins('SELECT art, bis FROM sitzung WHERE benutzer_id = ? AND bindung_hash IS NOT NULL ORDER BY erstellt DESC', id) || null;
    let versatz = 0;
    const basis = new Date(MI).getTime(), t0 = Date.now();
    const jetzt = () => basis + versatz + (Date.now() - t0);
    s.uhr.setze(new Date(jetzt()).toISOString());
    takt = setInterval(() => s.uhr.setze(new Date(jetzt()).toISOString()), 200);

    ctx = await browser.newContext({ viewport: { width: g.width, height: g.height }, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: g.mobil, serviceWorkers: 'block' });
    await ctx.clock.install({ time: new Date(jetzt()) });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    const seitenfehler = [];
    page.on('pageerror', (e) => seitenfehler.push(String(e.message).slice(0, 160)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) seitenfehler.push(m.text().slice(0, 160)); });

    /** Server- und Browser-Uhr gemeinsam auf `iso` bzw. um `min` Minuten vorstellen – ohne Bedienung dazwischen */
    async function springeAuf(iso) {
      versatz += new Date(iso).getTime() - jetzt();
      s.uhr.setze(new Date(jetzt()).toISOString());
      await page.clock.setSystemTime(new Date(jetzt()));
    }
    const springe = (min) => springeAuf(new Date(jetzt() + min * 60000).toISOString());

    const bereit = async () => { await page.waitForFunction(() => !document.querySelector('#view .view-box > .state .spinner, #root > .state .spinner'), null, { timeout: 15000 }); await sleep(80); };
    const geh = async (h) => { await page.evaluate((x) => { location.hash = x; }, '#' + h); await page.waitForFunction((x) => location.hash === '#' + x, h); await bereit(); };
    const angemeldet = async () => await page.locator('#view').count() === 1 && await page.locator('#login-card').count() === 0;
    const abgemeldet = async () => await page.locator('#view').count() === 0 && await page.locator('#login-card').count() === 1;
    const gewaehlt = () => page.evaluate(() => { const r = document.querySelector('#geraet-wahl input[name="geraet-art"]:checked'); return r ? r.value : null; });
    const waehle = async (art) => { await page.click(`#geraet-wahl label:has(input[value="${art}"])`); await sleep(150); };
    const info = () => page.locator('#geraet-info').innerText().catch(() => '');
    const ich = () => page.evaluate(async () => { const r = await fetch('/api/auth/ich'); return r.ok ? r.json() : { status: r.status }; });
    let ladeNr = 0;
    const zurAnmeldung = async () => { await page.goto(`${s.basis}/?woche=${++ladeNr}#/login`); await page.waitForSelector('#login-card .login-user'); };
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
      await sleep(200);
      const ok = page.locator('dialog[open] [data-ok]');
      if (await ok.count()) await ok.click();
      await page.waitForSelector('#login-card .login-user', { timeout: 20000 });
    }
    /** nach einem Uhrsprung: tippen (wie die Person, die das Handy wieder nimmt) bzw. die App neu starten */
    async function weiter({ neustart = false } = {}) {
      if (neustart) { await page.goto(`${s.basis}/?woche=${++ladeNr}#/stempeln`); await page.waitForSelector('#view, #login-card'); await bereit(); }
      else { await page.mouse.click(5, 5); await page.evaluate(() => { location.hash = '#/stempeln'; }); }
      await sleep(1200);
      await page.waitForSelector('#view, #login-card');
    }

    /* ---- 1) Texte auf der Anmeldeseite ---- */
    await zurAnmeldung();
    pruef(await gewaehlt() === 'eigen', `Vorbedingung: Standard „Eigenes Handy“ (${await gewaehlt()})`);
    const opt = await page.locator('#geraet-wahl').innerText().catch(() => '');
    pruef(/Eigenes Handy/.test(opt) && /Geteiltes Gerät/.test(opt), `Namen der Optionen geändert: „${opt.slice(0, 120)}“`);
    let t = await info();
    pruef(t.includes(EIGEN_TEXT), `Anmeldeseite: Erklärung zu „Eigenes Handy“ fehlt („${t.slice(0, 200)}“)`);
    pruef(t.includes('Gilt ab der Anmeldung für die Person, die sich jetzt anmeldet.'), `Anmeldeseite: „gilt ab der Anmeldung“ fehlt („${t.slice(0, 200)}“)`);
    await waehle('geteilt');
    t = await info();
    pruef(t.includes(GETEILT_TEXT) && !/Sonntag/.test(t), `Anmeldeseite: Text zu „Geteiltes Gerät“ geändert („${t.slice(0, 200)}“)`);
    await waehle('eigen');
    pruef((await info()).includes(EIGEN_TEXT), 'Anmeldeseite: Text nach dem Zurückwechseln auf „Eigenes Handy“ falsch');

    /* ---- 2) Büro am eigenen Handy: angemeldet bis Sonntag 24:00, Montag einmal die PIN ---- */
    await anmelden(U.buero, { laden: false });
    let z = sitzung(U.buero);
    pruef(z && z.art === 'woche' && z.bis === WOCHENENDE, `Büro am eigenen Handy: keine Wochen-Sitzung am Server (${JSON.stringify(z)})`);
    const i1 = await ich();
    pruef(i1.sitzungArt === 'woche' && i1.sitzungBis === WOCHENENDE && i1.sperreMinuten === 60, `/auth/ich: ${JSON.stringify({ a: i1.sitzungArt, b: i1.sitzungBis, s: i1.sperreMinuten })}`);
    const keks = await ctx.cookies();
    const ks = keks.find((c) => c.name === 'bt_session'), kb = keks.find((c) => c.name === 'bt_bindung');
    pruef(ks && kb && ks.expires > 0 && kb.expires > 0 && Math.abs(ks.expires * 1000 - new Date(WOCHENENDE).getTime()) < 5 * 60000 + Math.abs(Date.now() - jetzt()), `Cookies halten nicht bis zum Wochenende (${ks && ks.expires}/${kb && kb.expires})`);
    await geh('/mehr');
    pruef(await gewaehlt() === 'eigen', '„Mehr“ zeigt nicht „Eigenes Handy“');
    t = await info();
    pruef(t.includes(EIGEN_TEXT) && t.includes('Gilt für dich an diesem Gerät.'), `„Mehr“: Erklärung zu „Eigenes Handy“ falsch („${t.slice(0, 200)}“)`);
    await geh('/stempeln');
    await springe(20 * 60); // Donnerstag 04:00 – 20 h ohne Bedienung und ohne Anfrage
    await weiter();
    pruef(await angemeldet(), 'Büro am eigenen Handy nach 20 h ohne Bedienung abgemeldet');
    await springe(9 * 60);
    await weiter({ neustart: true });
    pruef(await angemeldet(), 'Büro am eigenen Handy: Neustart der App nach 9 h ohne Bedienung meldet ab');
    await springeAuf('2026-11-22T22:58:00.000Z'); // Sonntag 23:58 – drei Tage ohne Bedienung
    await weiter({ neustart: true });
    pruef(await angemeldet(), 'Büro am eigenen Handy am Sonntag 23:58 abgemeldet');
    pruef((sitzung(U.buero) || {}).art === 'woche', 'Wochen-Sitzung vor dem Wochenende am Server beendet');
    await springeAuf('2026-11-22T23:00:30.000Z'); // Montag 00:00:30
    await weiter({ neustart: true });
    pruef(await abgemeldet(), 'Büro am Montag 00:00 noch angemeldet – die Woche endet nicht');
    pruef(sitzung(U.buero) === null, 'Wochen-Sitzung am Montag am Server nicht beendet');
    pruef(await page.locator('#login-card .login-user').count() > 0, 'Montag: Anmeldeseite mit Namensliste fehlt');
    // Montag früh: einmal die PIN – dann wieder bis Sonntag
    await springeAuf('2026-11-23T05:30:00.000Z');
    await anmelden(U.buero);
    z = sitzung(U.buero);
    pruef(z && z.art === 'woche' && z.bis === NAECHSTE, `Montag: neue Anmeldung gilt nicht bis zum nächsten Sonntag (${JSON.stringify(z)})`);

    /* ---- 4) Wechsel in „Mehr“ auf „Geteiltes Gerät“: Sitzung sofort normal ---- */
    await geh('/mehr');
    await waehle('geteilt');
    for (let i = 0; i < 50 && (sitzung(U.buero) || {}).art !== 'normal'; i++) await sleep(100);
    pruef((sitzung(U.buero) || {}).art === 'normal', `„Geteiltes Gerät“ in „Mehr“ kürzt die Sitzung am Server nicht (${JSON.stringify(sitzung(U.buero))})`);
    t = await info();
    pruef(t.includes(GETEILT_TEXT), `„Mehr“: Text zu „Geteiltes Gerät“ falsch („${t.slice(0, 200)}“)`);
    await waehle('eigen');
    t = await info();
    pruef(t.includes(EIGEN_TEXT) && t.includes('Gilt ab deiner nächsten Anmeldung mit PIN.'), `„Mehr“: nach dem Wechsel fehlt „Gilt ab deiner nächsten Anmeldung mit PIN“ („${t.slice(0, 200)}“)`);
    const toast = await page.locator('#toast-root').innerText().catch(() => '');
    pruef(/nächsten Anmeldung mit PIN/.test(toast), `„Mehr“: Hinweis beim Wechsel auf „Eigenes Handy“ fehlt („${toast.slice(0, 200)}“)`);
    pruef((sitzung(U.buero) || {}).art === 'normal', '„Eigenes Handy“ in „Mehr“ verlängert die laufende Sitzung ohne PIN');
    await waehle('geteilt');
    await geh('/stempeln');
    await page.evaluate(() => localStorage.setItem('bt_aktiv', String(Date.now() - 61 * 60000)));
    await weiter();
    pruef(await abgemeldet(), 'nach dem Wechsel auf „Geteiltes Gerät“: Büro nach 61 min ohne Bedienung weiter angemeldet');

    /* ---- 5) Geteiltes Gerät: unverändert ---- */
    await zurAnmeldung();
    pruef(await gewaehlt() === 'geteilt', 'Vorbedingung: Anmeldeseite zeigt „Geteiltes Gerät“');
    await anmelden(U.mitarbeiter, { laden: false });
    z = sitzung(U.mitarbeiter);
    pruef(z && z.art === 'normal' && z.bis === null, `geteiltes Gerät: Sitzung am Server nicht normal (${JSON.stringify(z)})`);
    pruef((await ich()).sitzungArt === 'normal', 'geteiltes Gerät: /auth/ich meldet eine Wochen-Sitzung');
    await springe(31);
    await weiter();
    pruef(await abgemeldet(), 'geteiltes Gerät: Mitarbeiter nach 31 min ohne Bedienung weiter angemeldet');
    pruef(sitzung(U.mitarbeiter) === null, 'geteiltes Gerät: Sperre beendet die Sitzung am Server nicht');

    /* ---- 3) Polier am eigenen Handy: länger als die Feld-Grenze von 12 h ohne Bedienung ---- */
    await zurAnmeldung();
    await waehle('eigen');
    await anmelden(U.polier, { laden: false });
    pruef((sitzung(U.polier) || {}).art === 'woche', 'Polier am eigenen Handy: keine Wochen-Sitzung');
    await springe(13 * 60);
    await weiter();
    pruef(await angemeldet(), 'Polier am eigenen Handy nach 13 h ohne Bedienung abgemeldet');
    await weiter({ neustart: true });
    pruef(await angemeldet(), 'Polier am eigenen Handy: Neustart nach 13 h meldet ab');
    // Abmelden beendet die Wochen-Sitzung sofort
    await abmelden();
    pruef(sitzung(U.polier) === null, 'Abmelden beendet die Wochen-Sitzung am Server nicht');
    pruef(!/bt_bindung/.test(await page.evaluate(() => document.cookie)), 'Bindungs-Cookie nach dem Abmelden noch da');

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
      console.log(`\n▶ PIN-Woche ${g.name} (${g.width}×${g.height})`);
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
