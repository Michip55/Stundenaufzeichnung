'use strict';
// BauTag – End-to-End-Tests der Oberfläche gegen das echte Backend.
// Start: `npm run test:e2e` (im Ordner app). Je Bildschirmgröße wird eine frische, neu befüllte
// Datenbank in einem Temp-Ordner verwendet und ein eigener Server auf einem freien Port gestartet.
// Optional: BAUTAG_SHOTS=/pfad → Screenshots aller Ansichten dort ablegen. E2E_NUR=handy|tablet|pc.
const { chromium } = require('playwright');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const APP = path.resolve(__dirname, '..', '..');
const SHOTS = process.env.BAUTAG_SHOTS || '';
const PIN = '1234';
const NAME = { gf: 'Michael Pichler', buero: 'Martina Koller', bauleiter: 'Stefan Aigner', polier: 'Josef Haidbauer', mitarbeiter: 'Lukas Brandstätter' };
const GROESSEN = [
  { name: 'handy', width: 390, height: 844, mobil: true },
  { name: 'tablet', width: 1180, height: 820, mobil: false },
  { name: 'pc', width: 1440, height: 900, mobil: false },
].filter((g) => !process.env.E2E_NUR || process.env.E2E_NUR.split(',').includes(g.name));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freierPort = () => new Promise((ok, nok) => { const s = net.createServer(); s.unref(); s.on('error', nok); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });

async function starteServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bautag-e2e-'));
  const env = { ...process.env, BAUTAG_DB: path.join(dir, 'bautag.db'), NODE_ENV: 'test' };
  delete env.BAUTAG_UHR;
  const seed = spawnSync(process.execPath, ['server/seed.js'], { cwd: APP, env, encoding: 'utf8' });
  if (seed.status !== 0) throw new Error('Seed fehlgeschlagen:\n' + seed.stdout + seed.stderr);
  const port = await freierPort();
  const proc = spawn(process.execPath, ['server/index.js'], { cwd: APP, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode != null) throw new Error('Server beendet:\n' + log);
    try { const r = await fetch(url + '/api/gesundheit'); if (r.ok) return { url, stop: () => { proc.kill(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* egal */ } }, log: () => log }; } catch (e) { /* noch nicht bereit */ }
    await sleep(100);
  }
  proc.kill();
  throw new Error('Server nicht erreichbar:\n' + log);
}

/* ------------------------------------------------------------------ */
async function laufe(browser, g) {
  const srv = await starteServer();
  const fehler = [];
  let schritte = 0;
  const pruef = (ok, text) => { schritte++; if (!ok) { fehler.push(text); console.log(`    ✗ ${text}`); } };
  const context = await browser.newContext({ viewport: { width: g.width, height: g.height }, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: g.mobil, isMobile: false, acceptDownloads: true });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  // Konsolenfehler: alles zählt, außer Netz-Fehlermeldungen des Browsers in Schritten, die der Test absichtlich auslöst
  let erwartet = 0;
  const konsole = [];
  page.on('console', (m) => { if (m.type() !== 'error') return; const t = m.text(); if (erwartet > 0 && /Failed to load resource|net::ERR_/.test(t)) return; konsole.push(`${page.url().split('#')[1] || ''}: ${t}`); });
  page.on('pageerror', (e) => konsole.push('pageerror: ' + e.message));
  const absichtlich = async (fn) => { erwartet++; try { return await fn(); } finally { await sleep(150); erwartet--; } };

  const api = (methode, pfad, body) => page.evaluate(async ([m, p, b]) => {
    const r = await fetch('/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: m === 'GET' ? undefined : JSON.stringify(b || {}) });
    let j = null; try { j = await r.json(); } catch (e) { /* kein JSON */ }
    return { status: r.status, json: j };
  }, [methode, pfad, body]);

  let shotNr = 0;
  const shot = async (name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${g.name}-${String(++shotNr).padStart(2, '0')}-${name}.png`) }); };
  const bereit = async () => { await page.waitForFunction(() => !document.querySelector('#view .view-box > .state .spinner, #root > .state .spinner'), null, { timeout: 10000 }); await sleep(60); };
  const ueberlauf = async (wo) => {
    const r = await page.evaluate(() => { const v = document.getElementById('view'); const d = document.documentElement; return { doc: d.scrollWidth - window.innerWidth, view: v ? v.scrollWidth - v.clientWidth : 0, body: document.body.scrollWidth - window.innerWidth }; });
    pruef(r.doc <= 1 && r.view <= 1 && r.body <= 1, `[${wo}] horizontaler Überlauf (doc ${r.doc}, view ${r.view}, body ${r.body})`);
  };
  const geh = async (route, name) => { await page.evaluate((r) => { location.hash = r; }, '#' + route); await page.waitForFunction((r) => location.hash === '#' + r, route); await bereit(); await ueberlauf(route); await shot(name || route.replace(/[^a-z0-9]+/gi, '_')); };
  const text = () => page.evaluate(() => document.body.innerText);
  const keinEuro = async (wo) => { const t = await text(); pruef(!t.includes('€') && !/\bEUR\b/.test(t), `[${wo}] €-Zeichen sichtbar für eine Rolle ohne Preisrecht`); };
  const toastWeg = async () => { await page.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 8000 }).catch(() => {}); };

  async function anmelden(rolle) {
    await page.goto(srv.url + '/#/login');
    await page.waitForSelector('.login-user');
    await ueberlauf('login');
    await page.fill('#login-suche', NAME[rolle].split(' ')[1]);
    await page.click(`.login-user:has-text("${NAME[rolle]}")`);
    await page.waitForSelector('.pin-pad');
    await ueberlauf('login-pin');
    for (const z of PIN) await page.click(`.pin-pad [data-z="${z}"]`);
    await page.click('.pin-pad [data-ok]');
    await page.waitForSelector('#view');
    await bereit();
    const ich = (await api('GET', '/auth/ich')).json;
    pruef(ich && ich.benutzer && ich.benutzer.name === NAME[rolle] && ich.benutzer.rolle === rolle, `Anmeldung ${rolle}: /auth/ich liefert ${ich && ich.benutzer && ich.benutzer.name}`);
    return ich;
  }
  async function abmelden() {
    await geh('/mehr');
    await page.click('#abmelden');
    const dlg = page.locator('dialog[open] [data-ok]');
    if (await dlg.count()) await dlg.click();
    await page.waitForSelector('.login-user');
  }
  const navIds = () => page.evaluate(() => [...new Set([...document.querySelectorAll('#nav-seite .nav-item')].map((a) => a.dataset.nav))]);
  const keinZugriff = async (route) => { await geh(route, 'keinzugriff'); pruef(await page.locator('[data-zustand="kein-zugriff"]').count() === 1, `[${route}] zeigt nicht „Kein Zugriff“`); };

  try {
    /* ============ 0. Falsche PIN ============ */
    await page.goto(srv.url + '/');
    await page.waitForSelector('.login-user');
    pruef((await page.locator('.login-user').count()) >= 5, 'Login: Benutzerliste zu kurz');
    await shot('login');
    await page.click(`.login-user:has-text("${NAME.mitarbeiter}")`);
    for (const z of '9999') await page.click(`.pin-pad [data-z="${z}"]`);
    await absichtlich(async () => { await page.click('.pin-pad [data-ok]'); await page.waitForSelector('.pin-msg.err'); });
    pruef((await page.locator('.pin-msg.err').innerText()).length > 3, 'Login: keine Fehlermeldung bei falscher PIN');
    await shot('login-pin-falsch');

    /* ============ 1. Mitarbeiter: stempeln, offline, kein € ============ */
    let ich = await anmelden('mitarbeiter');
    let nav = await navIds();
    pruef(!nav.some((n) => ['preise', 'kalkulation', 'monat', 'benutzer', 'dashboard', 'berichte', 'kolonne'].includes(n)), `Mitarbeiter-Navigation enthält zu viel: ${nav}`);
    pruef(nav.includes('stempeln') && nav.includes('woche'), `Mitarbeiter-Navigation unvollständig: ${nav}`);
    await geh('/stempeln');
    const status = async () => (await api('GET', '/zeit/status')).json;
    let st = await status();
    if (st.status !== 'aus') { await api('POST', '/zeit/stempeln', { typ: st.status === 'pause' ? 'pause_ende' : 'gehen' }); if (st.status === 'pause') await api('POST', '/zeit/stempeln', { typ: 'gehen' }); await page.reload(); await bereit(); }
    await keinEuro('stempeln');
    // Offline: Kommen wird zwischengespeichert …
    await context.setOffline(true);
    await absichtlich(async () => {
      await page.click('[data-stempel="kommen"]');
      await page.waitForSelector('#sync[data-ausstehend="1"]');
    });
    pruef(await page.locator('.clock-card[data-status="arbeit"]').count() === 1, 'Offline: Stempeluhr zeigt nach Kommen nicht „Arbeit“');
    const q = await page.evaluate(() => JSON.parse(localStorage.getItem('bt_stempel_queue') || '[]'));
    pruef(q.length === 1 && q[0].typ === 'kommen' && !!q[0].zeit, 'Offline: Buchung liegt nicht mit Zeitstempel in der Warteschlange');
    await shot('stempeln-offline');
    // … und nach Rückkehr des Netzes nachgesendet
    await context.setOffline(false);
    await page.waitForSelector('#sync[data-ausstehend="0"]', { timeout: 20000 });
    st = await status();
    pruef(st.status === 'arbeit', `Offline-Nachsendung: Serverstatus ist ${st.status} statt arbeit`);
    pruef((st.heute.buchungen || []).some((b) => b.typ === 'kommen' && b.quelle === 'offline'), 'Offline-Nachsendung: Buchung nicht mit Quelle „offline“ am Server');
    await page.waitForSelector('.clock-card[data-status="arbeit"]');
    await toastWeg();
    await shot('stempeln-arbeit');
    // Pause → Pause Ende → Gehen
    await page.click('[data-stempel="pause_start"]');
    await page.waitForSelector('.clock-card[data-status="pause"]');
    pruef((await status()).status === 'pause', 'Pause: Serverstatus nicht „pause“');
    await shot('stempeln-pause');
    await page.click('[data-stempel="pause_ende"]');
    await page.waitForSelector('.clock-card[data-status="arbeit"]');
    await page.click('[data-stempel="gehen"]');
    await page.waitForSelector('.clock-card[data-status="aus"]');
    st = await status();
    pruef(st.status === 'aus', 'Gehen: Serverstatus nicht „aus“');
    pruef((st.heute.buchungen || []).length >= 4, 'Stempeln: weniger als 4 Buchungen heute');
    pruef(await page.locator('.timeline li').count() >= 4, 'Stempeln: Tagesverlauf zeigt die Buchungen nicht');
    await ueberlauf('/stempeln nach Buchungen');
    await keinEuro('stempeln');
    await geh('/woche'); await keinEuro('woche');
    pruef(await page.locator('.week-list .wd').count() === 7, 'Meine Woche zeigt nicht 7 Tage');
    await geh('/mehr'); await keinEuro('mehr');
    pruef(await page.locator('.integ-list li').count() >= 5, 'Mehr: Zusatzdienste fehlen');
    pruef((await text()).includes('Noch nicht angebunden'), 'Mehr: Hinweis „Noch nicht angebunden“ fehlt');
    for (const r of ['/preise', '/kalkulation', '/kalkulation/1', '/monat', '/benutzer', '/dashboard', '/berichte']) { await keinZugriff(r); await keinEuro(r); }
    // Server liefert dem Mitarbeiter keine €-Felder
    const mPreise = await absichtlich(() => api('GET', '/preise'));
    pruef(mPreise.status === 403, `Mitarbeiter: /api/preise liefert ${mPreise.status} statt 403`);
    await abmelden();

    /* ============ 2. Polier: Kolonne, Bericht, Unterschriften, kein € ============ */
    ich = await anmelden('polier');
    nav = await navIds();
    pruef(!nav.includes('preise') && !nav.includes('kalkulation') && !nav.includes('monat') && !nav.includes('benutzer'), `Polier-Navigation enthält Preise/Kalkulation: ${nav}`);
    pruef(nav.includes('kolonne') && nav.includes('berichte'), `Polier-Navigation unvollständig: ${nav}`);
    const eigeneBs = (await api('GET', '/baustellen')).json.filter((b) => (ich.baustellenIds || []).includes(b.id) && b.status === 'aktiv');
    pruef(eigeneBs.length > 0, 'Polier hat keine eigene aktive Baustelle (Testdaten)');
    const bsText = JSON.stringify((await api('GET', '/baustellen')).json) + JSON.stringify((await api('GET', '/geraete')).json) + JSON.stringify((await api('GET', '/materialien')).json);
    pruef(!/auftragssumme|kostensatz|verrechnungssatz|"ek"|"vk"|budgetVerbrauch/.test(bsText), 'Polier: Server liefert €-/Budget-Felder in Stammdaten');
    await geh('/stempeln'); await keinEuro('polier stempeln');
    // Kolonne
    await geh('/kolonne');
    await keinEuro('kolonne');
    const bsId = Number(await page.locator('#kol-bs').inputValue());
    if (await page.locator('.crew-row').count() < 2) await page.click('[data-mehr]');
    const reihen = page.locator('.crew-row:has(.st-grey), .crew-row:not(:has(.chip))');
    const nKol = Math.min(3, await reihen.count());
    pruef(nKol >= 1, 'Kolonne: niemand zum Buchen vorhanden');
    const namenKol = [];
    for (let i = 0; i < nKol; i++) namenKol.push(await page.locator('.crew-row:has(.st-grey) .crew-txt b, .crew-row:not(:has(.chip)) .crew-txt b').nth(i).innerText());
    for (const n of namenKol) await page.locator(`.crew-row:has-text("${n}") .check`).click();
    pruef(await page.locator('#kol-los').isEnabled(), 'Kolonne: Schaltfläche bleibt deaktiviert');
    await shot('kolonne-auswahl');
    await page.click('#kol-los');
    await page.waitForSelector('.crew-row .chip:has-text("gebucht"), .crew-err');
    const gebucht = await page.locator('.crew-row .chip:has-text("gebucht")').count();
    pruef(gebucht >= 1, 'Kolonne: keine Person wurde gebucht');
    await ueberlauf('/kolonne nach Buchung'); await shot('kolonne-gebucht');
    await toastWeg();
    // Bericht anlegen
    await geh('/berichte'); await keinEuro('berichte');
    pruef((await text()).includes('Noch nicht angebunden'), 'Berichte: Papier-Scan nicht als „Noch nicht angebunden“ gekennzeichnet');
    await page.click('#neu');
    await page.waitForSelector('dialog[open] #nb');
    await page.selectOption('dialog[open] select[name="baustelleId"]', String(bsId));
    await ueberlauf('dialog neuer bericht'); await shot('bericht-neu-dialog');
    await page.click('#nb-ok');
    await page.waitForFunction(() => /^#\/bericht\/\d+/.test(location.hash));
    await bereit();
    const berichtId = Number((await page.evaluate(() => location.hash)).match(/\d+/)[0]);
    let ber = (await api('GET', `/berichte/${berichtId}`)).json;
    pruef(ber.status === 'entwurf', `Neuer Bericht hat Status ${ber.status}`);
    pruef(ber.personal.length >= gebucht, `Bericht: Personal nicht automatisch übernommen (${ber.personal.length} statt mind. ${gebucht})`);
    pruef(!('kostenTag' in ber), 'Polier: Bericht enthält kostenTag');
    const schritt = async (n) => { if (g.mobil) { await page.click(`[data-schritt-nr="${n}"]`); await sleep(80); } };
    const gespeichert = async () => { await page.waitForSelector('#save-state.ok', { timeout: 8000 }); };
    pruef(await page.locator('.bp-row').count() === ber.personal.length, 'Bericht: Personalzeilen stimmen nicht mit dem Server überein');
    await ueberlauf('bericht schritt 1'); await shot('bericht-1-personal'); await keinEuro('bericht personal');
    // Geräte: erstes Gerät 2 × + (= 1 Std.), zweites 1 × +
    await schritt(2);
    const g1 = page.locator('.pf-g').nth(0), g2 = page.locator('.pf-g').nth(1);
    await g1.locator('[data-d="1"]').click(); await g1.locator('[data-d="1"]').click();
    await g2.locator('[data-d="1"]').click();
    await ueberlauf('bericht schritt 2'); await shot('bericht-2-geraete'); await keinEuro('bericht geräte');
    // Material: erste Position 12,5
    await schritt(3);
    await page.locator('.mat-row').nth(0).locator('input').fill('12,5');
    await page.locator('.mat-row').nth(0).locator('input').blur();
    await page.locator('.mat-row').nth(1).locator('[data-d="1"]').click();
    await ueberlauf('bericht schritt 3'); await shot('bericht-3-material');
    pruef(await page.locator('.a-mat [data-integ="scan_lieferschein"] button[disabled]').count() === 1, 'Bericht: Lieferschein-Scan ist nicht als deaktiviert gekennzeichnet');
    // Leistung, Beistellung, Paletten
    await schritt(4);
    await page.fill('[data-f="arbeitsleistung"]', 'Künette ausgehoben, Frostschutz eingebaut und verdichtet (E2E-Test).');
    await page.fill('[data-f="materialbeistellung.eigen"]', 'Frostschutz 0/63');
    await page.locator('[data-pal="euro"] [data-d="1"]').click();
    await page.locator('[data-pal="weissenboeck"] [data-d="1"]').click(); await page.locator('[data-pal="weissenboeck"] [data-d="1"]').click();
    await ueberlauf('bericht schritt 4'); await shot('bericht-4-leistung');
    pruef(await page.locator('[data-integ="diktat"] button[disabled]').count() === 1, 'Bericht: Diktat ist nicht als deaktiviert gekennzeichnet');
    // Regie, Vorkommnisse
    await schritt(5);
    await page.click('[data-r-neu]');
    await page.locator('.regie-row [data-r="text"]').last().fill('Zusätzlicher Aushub auf Anweisung AG');
    await page.locator('.regie-row [data-r="stunden"]').last().fill('2');
    await page.locator('.regie-row [data-r="stunden"]').last().blur();
    await page.fill('[data-f="vorkommnisse"]', 'Keine.');
    await ueberlauf('bericht schritt 5'); await shot('bericht-5-regie');
    await gespeichert();
    ber = (await api('GET', `/berichte/${berichtId}`)).json;
    pruef(ber.geraete.length === 2 && ber.geraete[0].stunden === 1 && ber.geraete[1].stunden === 0.5, `Bericht: Geräte nicht gespeichert (${JSON.stringify(ber.geraete.map((x) => x.stunden))})`);
    pruef(ber.material.length === 2 && ber.material[0].menge === 12.5 && ber.material[1].menge === 1, `Bericht: Material nicht gespeichert (${JSON.stringify(ber.material.map((x) => x.menge))})`);
    pruef(/E2E-Test/.test(ber.arbeitsleistung || ''), 'Bericht: Arbeitsleistung nicht gespeichert');
    pruef(ber.paletten.euro === 1 && ber.paletten.weissenboeck === 2, 'Bericht: Paletten nicht gespeichert');
    pruef(ber.regie.length === 1 && ber.regie[0].stunden === 2, 'Bericht: Regie nicht gespeichert');
    // Unterschriften
    await schritt(6);
    const unterschreibe = async (rolle, name) => {
      const box = page.locator(`.sig-box[data-sig="${rolle}"]`);
      const cv = box.locator('canvas');
      await cv.scrollIntoViewIfNeeded();
      const r = await cv.boundingBox();
      await page.mouse.move(r.x + 30, r.y + r.height * 0.6);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) await page.mouse.move(r.x + 30 + i * (r.width - 60) / 12, r.y + r.height * (0.6 + (i % 2 ? -0.25 : 0.2)), { steps: 2 });
      await page.mouse.up();
      if (name) await box.locator('[data-sig-name]').fill(name);
      await box.locator('[data-sig-save]').click();
      await page.waitForSelector(`.sig-box.signed[data-sig="${rolle}"]`);
    };
    pruef(await page.locator('[data-integ="sms"] button[disabled]').count() === 1, 'Bericht: SMS-Fernunterschrift ist nicht als deaktiviert gekennzeichnet');
    await ueberlauf('bericht schritt 6'); await shot('bericht-6-unterschrift-leer');
    await unterschreibe('an');
    await shot('bericht-6-unterschrift-an');
    await unterschreibe('bh', 'Ing. Maria Gruber');
    await bereit();
    ber = (await api('GET', `/berichte/${berichtId}`)).json;
    pruef(ber.status === 'unterschrieben', `Bericht nach zwei Unterschriften: Status ${ber.status}`);
    pruef(!!(ber.unterschriften.an && ber.unterschriften.bh && ber.unterschriften.bh.name === 'Ing. Maria Gruber'), 'Bericht: Unterschriften nicht am Server');
    pruef(await page.locator('#freigeben').count() === 0, 'Polier sieht die Schaltfläche „Freigeben“');
    pruef(await page.locator('.bform textarea:not([disabled])').count() === 0, 'Bericht ist nach den Unterschriften noch bearbeitbar');
    await ueberlauf('bericht unterschrieben'); await shot('bericht-unterschrieben'); await keinEuro('bericht unterschrieben');
    await toastWeg();
    for (const r of ['/preise', '/kalkulation', `/kalkulation/${bsId}`, '/monat', '/benutzer']) { await keinZugriff(r); await keinEuro(r); }
    await geh('/woche'); await keinEuro('polier woche');
    await geh('/mehr'); await keinEuro('polier mehr');
    const pKalk = await absichtlich(() => api('GET', `/kalkulation/${bsId}`));
    pruef(pKalk.status === 403, `Polier: /api/kalkulation liefert ${pKalk.status} statt 403`);
    const polierMeldungenVorher = (await api('GET', '/benachrichtigungen')).json.filter((m) => m.typ === 'budget').length;
    pruef(polierMeldungenVorher === 0, 'Polier hat Budget-Benachrichtigungen');
    await abmelden();

    /* ============ 3. Büro: freigeben, PDF, Preis, Nachkalkulation, Budget-Alarm, CSV ============ */
    ich = await anmelden('buero');
    nav = await navIds();
    pruef(['dashboard', 'berichte', 'baustellen', 'kalkulation', 'preise', 'monat'].every((n) => nav.includes(n)) && !nav.includes('benutzer'), `Büro-Navigation falsch: ${nav}`);
    await geh('/dashboard');
    pruef(await page.locator('[data-kpi="freigabe"] b').innerText() !== '0', 'Übersicht: kein Bericht zur Freigabe angezeigt');
    pruef(await page.locator('#anwesend-karte li').count() >= 1, 'Übersicht: Eingestempelte (Kolonne) werden nicht angezeigt');
    // Glocke: Bericht zur Freigabe
    await page.waitForSelector('#glocke.has');
    await page.click('#glocke');
    await page.waitForSelector('#notif-panel .notif');
    pruef(await page.locator('#notif-panel .notif.t-bericht').count() >= 1, 'Glocke: keine Meldung „Bericht zur Freigabe“ fürs Büro');
    await ueberlauf('benachrichtigungen'); await shot('benachrichtigungen');
    await page.click('#notif-panel [data-zu]');
    // Freigeben
    await geh(`/bericht/${berichtId}`);
    pruef(await page.locator('#kosten:not([hidden])').count() === 1, 'Büro sieht die Tageskosten im Bericht nicht');
    const kalkVor = (await api('GET', `/kalkulation/${bsId}`)).json;
    await page.click('#freigeben');
    await page.click('dialog[open] [data-ok]');
    await page.waitForSelector('.form-top .chip.st-green');
    ber = (await api('GET', `/berichte/${berichtId}`)).json;
    pruef(ber.status === 'freigegeben', `Freigabe: Status ${ber.status}`);
    await shot('bericht-freigegeben');
    await toastWeg();
    // PDF
    const pdfHref = await page.locator('#pdf').getAttribute('href');
    const pdf = await context.request.get(srv.url + pdfHref);
    const pdfBuf = await pdf.body();
    pruef(pdf.status() === 200 && /application\/pdf/.test(pdf.headers()['content-type'] || '') && pdfBuf.slice(0, 5).toString() === '%PDF-', `PDF: Status ${pdf.status()}, Typ ${pdf.headers()['content-type']}`);
    const [popup] = await Promise.all([context.waitForEvent('page'), page.click('#pdf')]);
    await popup.close();
    // Nachkalkulation vorher
    await geh(`/kalkulation/${bsId}`);
    const kostenText1 = await page.locator('[data-wert="kosten-gesamt"]').innerText();
    pruef(/€/.test(kostenText1), 'Nachkalkulation: Kosten ohne €-Betrag');
    pruef(await page.locator('[data-chart] svg').count() === 1, 'Nachkalkulation: Verlaufs-Diagramm fehlt');
    await page.locator('[data-chart] .hit').hover();
    pruef(await page.locator('.chart-tip:not([hidden])').count() === 1, 'Nachkalkulation: Diagramm-Tooltip fehlt');
    // Preis ändern: Kostensatz des ersten Geräts im Bericht +40
    const geraetId = ber.geraete[0].geraetId;
    await geh('/preise');
    await page.click('[data-tab="geraete"]');
    const feld = page.locator(`#tabpanel tr[data-id="${geraetId}"] input[data-feld="kostensatz"]`);
    await feld.scrollIntoViewIfNeeded();
    const altSatz = (await api('GET', '/preise')).json.geraete.find((x) => x.id === geraetId).kostensatz;
    await feld.fill(String(altSatz + 40).replace('.', ','));
    await feld.press('Enter');
    await page.waitForSelector('.price-in.saved');
    pruef((await api('GET', '/preise')).json.geraete.find((x) => x.id === geraetId).kostensatz === altSatz + 40, 'Preis wurde nicht gespeichert');
    await ueberlauf('/preise geräte'); await shot('preise-geraete');
    for (const t of ['materialien', 'leistungen', 'lohngruppen']) { await page.click(`[data-tab="${t}"]`); await ueberlauf('/preise ' + t); await shot('preise-' + t); }
    await toastWeg();
    await geh(`/kalkulation/${bsId}`, 'kalkulation-detail');
    const kostenText2 = await page.locator('[data-wert="kosten-gesamt"]').innerText();
    const kalkNach = (await api('GET', `/kalkulation/${bsId}`)).json;
    pruef(kostenText2 !== kostenText1, `Nachkalkulation ändert sich nach Preisänderung nicht (${kostenText1} → ${kostenText2})`);
    pruef(Math.abs(kalkNach.kosten.gesamt - kalkVor.kosten.gesamt) > 0.5 || kalkVor.kosten.gesamt === 0, 'Nachkalkulation (Server): Kosten unverändert');
    // Bauleiter der Baustelle sicherstellen (für den Empfänger-Test)
    const leute = (await api('GET', '/mitarbeiter')).json;
    const blId = leute.find((m) => m.name === NAME.bauleiter).id;
    await api('PUT', `/baustellen/${bsId}`, { bauleiterId: blId });
    // Auftragssumme so setzen, dass der Verbrauch über einer noch nicht gemeldeten Schwelle liegt
    const schonGemeldet = (kalkNach.alarme || []).map((a) => a.schwelle);
    const ziel = !schonGemeldet.includes(80) ? 85 : !schonGemeldet.includes(90) ? 95 : 104;
    const nt = (kalkNach.nachtraege || []).reduce((s, n) => s + n.betrag, 0);
    const summe = Math.max(1, Math.round((kalkNach.kosten.gesamt / (ziel / 100) - nt) * 100) / 100);
    const budgetVorher = (await api('GET', '/benachrichtigungen')).json.filter((m) => m.typ === 'budget' && m.baustelleId === bsId).length;
    await geh(`/baustelle/${bsId}`);
    await page.fill('#auftrag input[name="auftragssumme"]', String(summe).replace('.', ','));
    await shot('baustelle-auftrag');
    await page.click('#auftrag-ok');
    await page.waitForFunction((z) => { const e = document.querySelector('[data-wert="verbrauch"]'); return e && Math.abs(parseFloat(e.textContent.replace(',', '.')) - z) < 3; }, ziel);
    const kalkBudget = (await api('GET', `/kalkulation/${bsId}`)).json;
    pruef(kalkBudget.budgetVerbrauchProzent >= ziel - 2, `Budget-Verbrauch ${kalkBudget.budgetVerbrauchProzent} % statt ca. ${ziel} %`);
    const budgetNachher = (await api('GET', '/benachrichtigungen')).json.filter((m) => m.typ === 'budget' && m.baustelleId === bsId);
    pruef(budgetNachher.length > budgetVorher, 'Budget-Alarm: keine neue Benachrichtigung fürs Büro');
    await page.waitForSelector('#glocke.has');
    await page.click('#glocke');
    await page.waitForSelector('#notif-panel .notif.t-budget.neu');
    await shot('benachrichtigung-budget');
    await page.click('#notif-panel .notif.t-budget.neu .notif-btn');
    await page.waitForFunction((id) => location.hash === `#/kalkulation/${id}`, bsId);
    await bereit();
    pruef((await api('GET', '/benachrichtigungen')).json.filter((m) => m.typ === 'budget' && m.baustelleId === bsId && m.gelesen).length >= 1, 'Benachrichtigung wird beim Öffnen nicht als gelesen markiert');
    pruef(await page.locator('.bud:not(.none) .bud-fill').count() >= 1, 'Nachkalkulation: Budget-Balken fehlt');
    await ueberlauf('kalkulation mit budget'); await shot('kalkulation-budget');
    await geh('/kalkulation', 'kalkulation-uebersicht');
    pruef(await page.locator('.kalk-card').count() >= 1, 'Nachkalkulation-Übersicht leer');
    await geh('/baustellen');
    pruef(await page.locator('.site-card').count() >= 3, 'Baustellenliste zu kurz');
    await geh('/berichte');
    await geh('/dashboard', 'dashboard');
    // Monatsauswertung + CSV
    await geh('/monat');
    pruef(await page.locator('.matrix tbody tr').count() >= 5, 'Monatsauswertung: Matrix zu kurz');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#csv-lohn')]);
    const csvPfad = await dl.path();
    const csv = fs.readFileSync(csvPfad, 'utf8');
    pruef(/\.csv$/.test(dl.suggestedFilename()) && csv.includes(';') && csv.split('\n').length > 3, 'CSV-Download Lohnverrechnung leer oder falsch');
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#csv-buak')]);
    pruef(fs.readFileSync(await dl2.path(), 'utf8').includes(';'), 'CSV-Download BUAK leer');
    await keinZugriff('/benutzer');
    await geh('/stempeln'); await geh('/woche'); await geh('/mehr');
    await abmelden();

    /* ============ 4. Bauleiter: bekommt den Budget-Alarm ============ */
    ich = await anmelden('bauleiter');
    nav = await navIds();
    pruef(nav.includes('kalkulation') && nav.includes('preise') && !nav.includes('monat') && !nav.includes('benutzer'), `Bauleiter-Navigation falsch: ${nav}`);
    pruef((await api('GET', '/benachrichtigungen')).json.some((m) => m.typ === 'budget' && m.baustelleId === bsId), 'Budget-Alarm: Bauleiter hat keine Benachrichtigung');
    await page.waitForSelector('#glocke.has');
    await geh('/dashboard', 'bauleiter-dashboard');
    await geh('/preise');
    pruef(await page.locator('.price-in input').count() === 0, 'Bauleiter kann Preise bearbeiten');
    await geh(`/kalkulation/${bsId}`); await geh('/baustellen'); await geh(`/baustelle/${bsId}`); await geh('/berichte'); await geh('/kolonne'); await geh('/stempeln');
    await keinZugriff('/monat'); await keinZugriff('/benutzer');
    await abmelden();

    /* ============ 5. Polier: bekommt keinen Budget-Alarm ============ */
    await anmelden('polier');
    const pm = (await api('GET', '/benachrichtigungen')).json;
    pruef(!pm.some((m) => m.typ === 'budget'), 'Budget-Alarm: Polier hat eine Budget-Benachrichtigung erhalten');
    await page.click('#glocke'); await page.waitForSelector('#notif-panel #notif-inhalt :is(.notif, .state.empty)');
    await keinEuro('polier benachrichtigungen');
    await page.click('#notif-panel [data-zu]');
    await abmelden();

    /* ============ 6. Geschäftsführung: Rechte, Protokoll, gesperrte Zellen ============ */
    await anmelden('gf');
    nav = await navIds();
    pruef(nav.includes('benutzer'), 'GF-Navigation ohne Benutzer & Rechte');
    await geh('/benutzer');
    await page.click('[data-tab="matrix"]');
    await page.waitForSelector('#matrix');
    await ueberlauf('/benutzer matrix'); await shot('rechte-matrix');
    const gesperrt = page.locator('#matrix td[data-gesperrt]');
    pruef(await gesperrt.count() >= 8, 'Rechte-Matrix: zu wenige gesperrte Zellen');
    pruef(await page.locator('#matrix td[data-gesperrt] input').count() === 0, 'Rechte-Matrix: gesperrte Zelle enthält einen Schalter');
    pruef(await page.locator('#matrix td[data-rolle="polier"][data-recht="preise_sehen"][data-gesperrt]').count() === 1, 'Rechte-Matrix: Polier/Preise sehen ist nicht gesperrt');
    await gesperrt.first().click({ force: true });
    const gs = await absichtlich(() => api('PUT', '/rechte/matrix', { rolle: 'polier', recht: 'preise_sehen', wert: true }));
    pruef(gs.status === 400, `Server lässt gesperrtes Recht zu (Status ${gs.status})`);
    pruef(await page.locator('#matrix td[data-rolle="gf"][data-recht="benutzer"] input[disabled]').count() === 1, 'Rechte-Matrix: GF/Benutzer ist abschaltbar');
    const zelle = page.locator('#matrix td[data-rolle="polier"][data-recht="bericht_freigeben"]');
    const vorher = await zelle.locator('input').isChecked();
    await zelle.locator('.tgl').click();
    await page.waitForFunction((v) => { const i = document.querySelector('#matrix td[data-rolle="polier"][data-recht="bericht_freigeben"] input'); return i.checked === !v && !i.disabled; }, vorher);
    const matrix = (await api('GET', '/rechte')).json;
    pruef(matrix.matrix.polier.bericht_freigeben === !vorher, 'Rechte-Matrix: Änderung nicht am Server');
    await page.click('[data-tab="protokoll"]');
    await page.waitForSelector('#protokoll li');
    const erster = await page.locator('#protokoll li').first().innerText();
    pruef(/bericht_freigeben|freigeben/i.test(erster) && erster.includes(NAME.gf), `Protokoll: oberster Eintrag passt nicht („${erster.replace(/\n/g, ' ').slice(0, 120)}“)`);
    await ueberlauf('/benutzer protokoll'); await shot('rechte-protokoll');
    await page.click('[data-tab="benutzer"]');
    await page.waitForSelector('#benutzerliste li');
    await ueberlauf('/benutzer liste'); await shot('rechte-benutzer');
    // Benutzer anlegen
    await page.click('[data-akt="neu"]');
    await page.fill('dialog[open] input[name="name"]', 'Test Probe');
    await page.selectOption('dialog[open] select[name="rolle"]', 'mitarbeiter');
    await page.fill('dialog[open] input[name="pin"]', '4711');
    await ueberlauf('dialog benutzer'); await shot('benutzer-dialog');
    await page.click('dialog[open] button[type="submit"]');
    await page.waitForSelector('#benutzerliste li:has-text("Test Probe")');
    await page.click('[data-tab="matrix"]');
    await toastWeg();
    for (const r of ['/dashboard', '/berichte', '/baustellen', '/kalkulation', '/preise', '/monat', '/kolonne', '/stempeln', '/woche', '/mehr']) await geh(r, 'gf' + r.replace('/', '-'));
    await abmelden();

    /* ============ 7. PWA ============ */
    const man = await context.request.get(srv.url + '/manifest.webmanifest');
    const manJson = man.ok() ? await man.json() : {};
    pruef(man.ok() && manJson.icons && manJson.icons.length >= 2 && manJson.display === 'standalone', 'Manifest fehlt oder unvollständig');
    for (const i of manJson.icons || []) { const r = await context.request.get(srv.url + i.src); pruef(r.ok() && /image\/png/.test(r.headers()['content-type'] || ''), `Icon ${i.src} fehlt`); }
    const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!(r && (r.active || r.installing || r.waiting)); });
    pruef(sw, 'Service Worker ist nicht registriert');
    const apiImCache = await page.evaluate(async () => { for (const n of await caches.keys()) { const c = await caches.open(n); for (const k of await c.keys()) if (new URL(k.url).pathname.startsWith('/api/')) return k.url; } return ''; });
    pruef(!apiImCache, `Service Worker hat eine API-Antwort gespeichert: ${apiImCache}`);

    pruef(konsole.length === 0, `Konsolenfehler:\n      ${konsole.slice(0, 12).join('\n      ')}`);
  } catch (e) {
    fehler.push(`Abbruch: ${e.message.split('\n').slice(0, 6).join(' | ')} (bei ${page.url()})`);
    console.log(`    ✗ Abbruch: ${e.message.split('\n')[0]}`);
    if (konsole.length) console.log('      Konsole: ' + konsole.slice(0, 8).join(' || '));
    if (SHOTS) { try { await page.screenshot({ path: path.join(SHOTS, `${g.name}-ABBRUCH.png`) }); } catch (x) { /* egal */ } }
    if (process.env.E2E_SERVERLOG) console.log(srv.log().slice(-2000));
  } finally {
    await context.close();
    srv.stop();
  }
  return { fehler, schritte };
}

(async () => {
  const browser = await chromium.launch();
  let gesamt = 0;
  const bilanz = [];
  for (const g of GROESSEN) {
    console.log(`\n▶ ${g.name} (${g.width}×${g.height})`);
    const t = Date.now();
    let r;
    try { r = await laufe(browser, g); } catch (e) { r = { fehler: ['Start fehlgeschlagen: ' + e.message], schritte: 0 }; console.log('    ✗ ' + e.message); }
    gesamt += r.fehler.length;
    bilanz.push(`${r.fehler.length ? '✗' : '✓'} ${g.name} ${g.width}×${g.height}: ${r.schritte - r.fehler.filter((f) => !f.startsWith('Abbruch') && !f.startsWith('Start')).length}/${r.schritte} Prüfungen bestanden${r.fehler.length ? `, ${r.fehler.length} Fehler` : ''} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  }
  await browser.close();
  console.log('\n' + bilanz.join('\n'));
  console.log(gesamt ? `\nE2E: ${gesamt} Fehler` : '\nE2E: alle Prüfungen bestanden');
  process.exit(gesamt ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
