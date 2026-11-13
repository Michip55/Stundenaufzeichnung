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

async function starteServer(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bautag-e2e-'));
  // BAUTAG_DEMO=1: Testdaten ohne Pflicht zur PIN-Änderung (die Pflicht wird mit einem neu angelegten Benutzer geprüft)
  const env = { ...process.env, BAUTAG_DB: path.join(dir, 'bautag.db'), NODE_ENV: 'test', BAUTAG_DEMO: '1', TRUST_PROXY: '1', ...extra };
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
    // M-04: Serverfehler (503) beim Stempeln → Buchung bleibt in der Warteschlange und wird später gesendet
    await page.route('**/api/zeit/stempeln', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ fehler: 'Wartung', code: 'SERVER' }) }));
    await absichtlich(async () => { await page.click('[data-stempel="pause_start"]'); await page.waitForSelector('#sync[data-ausstehend="1"]'); });
    pruef((await status()).status === 'arbeit', 'M-04: Test-Vorbedingung – Server sollte die Pause noch nicht haben');
    pruef((await page.evaluate(() => JSON.parse(localStorage.getItem('bt_stempel_queue') || '[]'))).length === 1, 'M-04: Buchung nach 503 nicht in der Warteschlange behalten');
    await absichtlich(async () => { await page.click('#sync'); await sleep(400); });
    pruef((await page.evaluate(() => JSON.parse(localStorage.getItem('bt_stempel_queue') || '[]'))).length === 1, 'M-04: Buchung nach wiederholtem 503 verworfen');
    await page.unroute('**/api/zeit/stempeln');
    await page.click('#sync');
    await page.waitForSelector('#sync[data-ausstehend="0"]', { timeout: 20000 });
    await page.waitForSelector('.clock-card[data-status="pause"]');
    pruef((await status()).status === 'pause', 'Pause: Serverstatus nicht „pause“');
    await toastWeg();
    // M-04: vom Server abgelehnte Offline-Buchung (älter als 24 h) bleibt sichtbar, bis sie bestätigt wird
    await page.evaluate((id) => { localStorage.setItem('bt_stempel_queue', JSON.stringify([{ typ: 'kommen', baustelleId: 1, benutzerId: id, zeit: new Date(Date.now() - 72 * 3600e3).toISOString(), nr: 'alt-1' }])); }, ich.benutzer.id);
    await absichtlich(async () => { await page.click('#sync'); await page.waitForSelector('#sync[data-abgelehnt="1"]', { timeout: 15000 }); });
    await page.waitForSelector('#abgelehnt li');
    pruef((await page.locator('#abgelehnt .abg-grund').innerText()).length > 10, 'M-04: abgelehnte Buchung ohne Grund angezeigt');
    pruef((await page.evaluate(() => JSON.parse(localStorage.getItem('bt_stempel_abgelehnt') || '[]'))).length === 1 && (await page.evaluate(() => JSON.parse(localStorage.getItem('bt_stempel_queue') || '[]'))).length === 0, 'M-04: abgelehnte Buchung nicht in der Liste „Nicht übernommen“');
    await ueberlauf('stempeln abgelehnt'); await shot('stempeln-abgelehnt'); await keinEuro('stempeln abgelehnt');
    await toastWeg();
    await page.reload(); await bereit();
    pruef(await page.locator('#abgelehnt li').count() === 1, 'M-04: abgelehnte Buchung nach Neuladen verschwunden');
    await page.click('[data-abg-weg]');
    await page.click('dialog[open] [data-ok]');
    await page.waitForSelector('#sync[data-abgelehnt="0"]');
    pruef(await page.locator('#abgelehnt').count() === 0, 'M-04: Liste nach „Erledigt“ noch sichtbar');
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
    // B-07: eigener Antrag mit Status, Zurückziehen
    await geh('/abwesenheiten'); await keinEuro('abwesenheiten');
    const stelleAntrag = async () => { await page.click('[data-akt="antrag"]'); await page.waitForSelector('dialog[open] #abw-f'); await page.click('dialog[open] button[type="submit"]'); await page.waitForFunction(() => !document.querySelector('dialog[open]')); await page.waitForSelector('#abw-eigene li[data-status="beantragt"]'); };
    await stelleAntrag();
    pruef(await page.locator('#abw-eigene li[data-status="beantragt"] [data-abw-status="beantragt"]').count() >= 1, 'B-07: eigener Antrag zeigt nicht den Status „beantragt“');
    await ueberlauf('abwesenheiten mitarbeiter'); await shot('abwesenheiten-mitarbeiter');
    const morgen = new Date(Date.now() + 86400e3).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
    const eigenerAntrag = async () => (await api('GET', '/abwesenheiten')).json.find((a) => a.benutzerId === ich.benutzer.id && a.datum === morgen);
    const ersterAntrag = await eigenerAntrag();
    pruef(ersterAntrag && ersterAntrag.status === 'beantragt', `B-07: Antrag am Server nicht „beantragt“ (${JSON.stringify(ersterAntrag)})`);
    await page.click(`#abw-eigene li[data-abw="${ersterAntrag.id}"] [data-zurueckziehen]`);
    await page.click('dialog[open] [data-ok]');
    await page.waitForFunction((id) => !document.querySelector(`#abw-eigene li[data-abw="${id}"]`), ersterAntrag.id);
    pruef(!(await eigenerAntrag()), 'B-07: zurückgezogener Antrag noch am Server');
    await toastWeg();
    await stelleAntrag();
    const antragId = (await eigenerAntrag()).id;
    pruef(await page.locator('#abw-offen, [data-entscheid]').count() === 0, 'B-07: Mitarbeiter sieht die Genehmigungsliste');
    await toastWeg();
    await geh('/pin'); await keinEuro('pin');
    await geh('/mehr'); await keinEuro('mehr');
    pruef(await page.locator('.integ-list li').count() >= 5, 'Mehr: Zusatzdienste fehlen');
    pruef((await text()).includes('Noch nicht angebunden'), 'Mehr: Hinweis „Noch nicht angebunden“ fehlt');
    for (const r of ['/preise', '/kalkulation', '/kalkulation/1', '/monat', '/benutzer', '/dashboard', '/berichte', '/kolonne', '/baustellen']) { await keinZugriff(r); await keinEuro(r); }
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
    const gespeichert = async () => { await page.waitForSelector('#save-state[data-zustand="ok"]', { timeout: 8000 }); };
    pruef(await page.locator('.bp-row').count() === ber.personal.length, 'Bericht: Personalzeilen stimmen nicht mit dem Server überein');
    pruef(ber.personal.length >= 1, 'Bericht: kein Personal für die B-06-Prüfung');
    const zeit = async (i, feld, wert) => { const f = page.locator('.bp-row').nth(i).locator(`[data-p="${feld}"]`); await f.fill(wert); await f.dispatchEvent('change'); };
    const zustand = () => page.locator('#save-state').getAttribute('data-zustand');
    // Alle Zeilen wie ein Polier ausfüllen (frisch Gestempelte haben noch kein Ende)
    for (let i = 0; i < ber.personal.length; i++) { await zeit(i, 'von2', ''); await zeit(i, 'bis2', ''); await zeit(i, 'von1', '07:00'); await zeit(i, 'bis1', '16:00'); await zeit(i, 'pauseMin', '30'); }
    await page.waitForSelector('#save-state[data-zustand="ok"]', { timeout: 8000 });
    // B-06: Schicht über Mitternacht ist erfassbar und wird gespeichert
    await zeit(0, 'von1', '22:00'); await zeit(0, 'bis1', '06:00');
    pruef(await page.locator('.bp-row').nth(0).locator('.bp-nacht:not([hidden])').count() === 1, 'B-06: Hinweis „+1 Tag“ fehlt bei Schicht über Mitternacht');
    pruef((await page.locator('.bp-row').nth(0).locator('[data-p-std]').innerText()) === '7,5', `B-06: Stunden über Mitternacht falsch (${await page.locator('.bp-row').nth(0).locator('[data-p-std]').innerText()})`);
    await page.waitForSelector('#save-state[data-zustand="ok"]', { timeout: 8000 }).catch(() => {});
    pruef(await zustand() === 'ok', `B-06: Nachtschicht wurde nicht gespeichert (Zustand ${await zustand()}: ${await page.locator('#unsaved').innerText().catch(() => '')})`);
    let p0 = (await api('GET', `/berichte/${berichtId}`)).json.personal[0];
    pruef(p0.von1 === '22:00' && p0.bis1 === '06:00' && p0.stunden === 7.5, `B-06: Server hat die Nachtschicht nicht (${JSON.stringify(p0)})`);
    await shot('bericht-nachtschicht');
    // B-06: ungültige Zeile → nie „Gespeichert“, Hinweis sichtbar, Unterschrift gesperrt
    await zeit(0, 'bis1', '');
    await sleep(900);
    pruef(await zustand() === 'invalid', `B-06: ungültige Zeile, aber Zustand „${await zustand()}“`);
    pruef(!(await page.locator('#save-state').innerText()).includes('Gespeichert') || (await page.locator('#save-state').innerText()).includes('Nicht'), 'B-06: zeigt „Gespeichert“ trotz ungültiger Zeile');
    pruef(await page.locator('#unsaved:not([hidden])').count() === 1 && await page.locator('.bp-row.invalid .bp-err:not([hidden])').count() === 1, 'B-06: kein sichtbarer Hinweis auf die ungültige Zeile');
    await schritt(2);
    await page.locator('.pf-g').nth(3).locator('[data-d="1"]').click(); // andere Felder werden trotzdem gespeichert …
    await sleep(900);
    pruef(await zustand() === 'invalid', 'B-06: Zustand wechselt trotz ungültigem Personal auf gespeichert');
    await page.locator('.pf-g').nth(3).locator('[data-d="-1"]').click();
    await schritt(6);
    await page.locator('.sig-box[data-sig="an"] canvas').evaluate((e) => e.scrollIntoView({ block: 'center' })); await sleep(80);
    { const r = await page.locator('.sig-box[data-sig="an"] canvas').boundingBox(); await page.mouse.move(r.x + 20, r.y + 40); await page.mouse.down(); await page.mouse.move(r.x + 120, r.y + 70, { steps: 4 }); await page.mouse.up(); }
    await page.locator('.sig-box[data-sig="an"] [data-sig-save]').click();
    await sleep(500);
    pruef(await page.locator('.sig-box.signed').count() === 0 && !(await api('GET', `/berichte/${berichtId}`)).json.unterschriften.an, 'B-06: Unterschrift trotz ungültigem Personal möglich');
    await ueberlauf('bericht ungültig'); await shot('bericht-ungueltig');
    await toastWeg();
    await schritt(1);
    await zeit(0, 'von1', '07:00'); await zeit(0, 'bis1', '16:00');
    await page.waitForSelector('#save-state[data-zustand="ok"]', { timeout: 8000 });
    p0 = (await api('GET', `/berichte/${berichtId}`)).json.personal[0];
    pruef(p0.von1 === '07:00' && p0.bis1 === '16:00' && p0.stunden === 8.5, `B-06: korrigierte Zeile nicht am Server (${JSON.stringify(p0)})`);
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
    // C-02: Arbeitsstunden sind nie frei eingebbar – weder in der Oberfläche noch über die Schnittstelle
    await page.waitForSelector('#save-state[data-zustand="ok"]', { timeout: 8000 });
    await schritt(1);
    pruef(await page.locator('.bp-row [data-p="stunden"], .bp-row input[aria-label*="Arbeitsstunden"]').count() === 0 && await page.locator('.bp-row output[data-p-std]').count() === ber.personal.length, 'C-02: Arbeitsstunden sind ein Eingabefeld');
    const verBer = async () => (await api('GET', `/berichte/${berichtId}`)).json;
    let akt = await verBer();
    const c02 = await api('PUT', `/berichte/${berichtId}`, { version: akt.version, personal: akt.personal.map((x, i) => ({ benutzerId: x.benutzerId, von1: x.von1, bis1: x.bis1, von2: x.von2, bis2: x.bis2, pauseMin: x.pauseMin, code: x.code, segStunden: x.segStunden, stunden: i === 0 ? 23 : x.stunden })) });
    pruef(c02.status === 200 && c02.json.personal[0].stunden === 8.5, `C-02: Server übernimmt frei gesetzte Stunden (${c02.status}, ${c02.json && c02.json.personal && c02.json.personal[0].stunden})`);
    await page.reload(); await bereit(); await schritt(1);
    // M-01: SEG-Stunden je Person, höchstens die Arbeitsstunden
    await zeit(0, 'segStunden', '20');
    await sleep(800);
    pruef(await zustand() === 'invalid' && await page.locator('.bp-row.invalid .bp-err:not([hidden])').count() === 1, 'M-01: SEG-Stunden über den Arbeitsstunden werden angenommen');
    await zeit(0, 'segStunden', '2');
    await page.waitForSelector('#save-state[data-zustand="ok"]', { timeout: 8000 });
    pruef((await verBer()).personal[0].segStunden === 2, 'M-01: SEG-Stunden je Person nicht am Server');
    // C-01: Personenauswahl – Partie zuerst, andere nur ausdrücklich als Gast, nie Bauleiter/Büro/GF
    const optionen = await page.locator('#p-neu option').allInnerTexts();
    pruef(optionen.length > 1 && ![NAME.gf, NAME.buero, NAME.bauleiter].some((n) => optionen.some((o) => o.includes(n))), `C-01: Auswahl bietet Büro/GF/Bauleiter an (${optionen.length} Einträge)`);
    const gastOpt = page.locator('#p-neu optgroup[label^="Gast"] option').first();
    pruef(await gastOpt.count() === 1 && (await gastOpt.innerText()).includes('(Gast)'), 'C-01: fremde Personen sind nicht als Gast gekennzeichnet');
    const gastId = await gastOpt.getAttribute('value');
    await page.selectOption('#p-neu', gastId);
    await page.waitForSelector('.bp-row [data-gast]');
    const gi = (await page.locator('.bp-row').count()) - 1;
    await zeit(gi, 'von1', '07:00'); await zeit(gi, 'bis1', '09:00');
    await page.waitForSelector('#save-state[data-zustand="ok"]', { timeout: 8000 }).catch(() => {});
    akt = await verBer();
    const gastZeile = akt.personal.find((x) => String(x.benutzerId) === gastId);
    pruef(await zustand() === 'ok' && gastZeile && gastZeile.gast === true, `C-01: Gast nicht als Gast gespeichert (Zustand ${await zustand()}: ${await page.locator('#unsaved').innerText().catch(() => '')})`);
    await toastWeg();
    const ohneGast = await absichtlich(() => api('PUT', `/berichte/${berichtId}`, { version: akt.version, personal: akt.personal.map((x) => ({ benutzerId: x.benutzerId, von1: x.von1, bis1: x.bis1, von2: x.von2, bis2: x.bis2, pauseMin: x.pauseMin, code: x.code })) }));
    pruef(ohneGast.status === 400, `C-01: Server nimmt fremde Person ohne Gast-Kennzeichen an (Status ${ohneGast.status})`);
    await ueberlauf('bericht gast'); await shot('bericht-gast');
    // C-01: Fehlermeldung des Servers (z. B. Überschneidung) erscheint an der betroffenen Zeile
    await page.route(`**/api/berichte/${berichtId}`, (r) => (r.request().method() === 'PUT' ? r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'UNGUELTIG', fehler: 'personal[0]: Überschneidung mit einer Stempelung auf Baustelle 26-038 (07:00–15:00).' }) }) : r.continue()));
    await absichtlich(async () => { await zeit(0, 'pauseMin', '45'); await page.waitForSelector('.bp-row[data-i="0"] .bp-srv'); });
    pruef((await page.locator('.bp-row[data-i="0"] .bp-srv').innerText()).includes('Überschneidung') && await zustand() === 'err' && await page.locator('#unsaved:not([hidden])').count() === 1, 'C-01: Überschneidungs-Fehler des Servers nicht an der Zeile sichtbar');
    await shot('bericht-ueberschneidung');
    await page.unroute(`**/api/berichte/${berichtId}`);
    await zeit(0, 'pauseMin', '30');
    await page.waitForSelector('#save-state[data-zustand="ok"]', { timeout: 8000 });
    pruef(await page.locator('.bp-srv').count() === 0, 'C-01: Zeilenfehler bleibt nach erfolgreichem Speichern stehen');
    // Gast wieder entfernen
    await page.locator('.bp-row').nth(gi).locator('[data-p-weg]').click();
    await page.click('dialog[open] [data-ok]');
    await page.waitForFunction((n) => document.querySelectorAll('.bp-row').length === n, gi);
    await page.waitForSelector('#save-state[data-zustand="ok"]', { timeout: 8000 });
    // C-08: gleichzeitige Bearbeitung – ein veralteter Stand überschreibt nichts
    akt = await verBer();
    const fremd = await api('PUT', `/berichte/${berichtId}`, { version: akt.version, arbeitsleistung: 'Vom Büro eingetragen (anderes Gerät).' });
    pruef(fremd.status === 200 && fremd.json.version !== akt.version, 'C-08: Version ändert sich beim Speichern nicht');
    await schritt(5);
    await absichtlich(async () => { await page.fill('[data-f="vorkommnisse"]', 'Alter Stand vom Tablet'); await page.waitForSelector('#unsaved[data-art="konflikt"]:not([hidden])'); });
    pruef((await page.locator('#unsaved').innerText()).includes('von jemand anderem geändert') && await zustand() !== 'ok', 'C-08: kein Hinweis auf die fremde Änderung');
    akt = await verBer();
    pruef(akt.arbeitsleistung === 'Vom Büro eingetragen (anderes Gerät).' && akt.vorkommnisse !== 'Alter Stand vom Tablet', 'C-08: veralteter Stand hat die fremde Änderung überschrieben');
    await ueberlauf('bericht konflikt'); await shot('bericht-konflikt');
    await page.click('[data-konflikt-laden]');
    await bereit(); await page.waitForSelector('.bform');
    pruef((await page.locator('[data-f="arbeitsleistung"]').inputValue()) === 'Vom Büro eingetragen (anderes Gerät).', 'C-08: nach „Neu laden“ fehlt die fremde Änderung');
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
    let sigNr = 0;
    const unterschreibe = async (rolle, name) => {
      const box = page.locator(`.sig-box[data-sig="${rolle}"]`);
      const cv = box.locator('canvas');
      await cv.evaluate((e) => e.scrollIntoView({ block: 'center' })); await sleep(80);
      const r = await cv.boundingBox();
      await page.mouse.move(r.x + 30, r.y + r.height * 0.6);
      await page.mouse.down();
      sigNr++; // jede Unterschrift sieht anders aus (ein schon verwendetes Bild lehnt der Server ab)
      for (let i = 1; i <= 12; i++) await page.mouse.move(r.x + 30 + i * (r.width - 60) / 12, r.y + r.height * (0.6 + (i % 2 ? -0.25 : 0.2) + ((i * sigNr) % 5) * 0.02), { steps: 2 });
      await page.mouse.up();
      if (name) await box.locator('[data-sig-name]').fill(name);
      await box.locator('[data-sig-save]').click();
      await page.waitForSelector(`.sig-box.signed[data-sig="${rolle}"]`);
    };
    pruef(await page.locator('[data-integ="sms"] button[disabled]').count() === 1, 'Bericht: SMS-Fernunterschrift ist nicht als deaktiviert gekennzeichnet');
    await ueberlauf('bericht schritt 6'); await shot('bericht-6-unterschrift-leer');
    await unterschreibe('an');
    await shot('bericht-6-unterschrift-an');
    // M-02: nach der ersten Unterschrift ist der Inhalt gesperrt – mit klarem Hinweis
    pruef(await page.locator('#gesperrt-hinweis').count() === 1, 'M-02: Hinweis „Inhalt gesperrt“ fehlt nach der ersten Unterschrift');
    pruef(await page.locator('.bform textarea:not([disabled]), .bform .stepper button:not([disabled]), .bform .bp-row input:not([disabled])').count() === 0, 'M-02: Bericht ist nach der ersten Unterschrift noch bearbeitbar');
    const m02 = await absichtlich(async () => api('PUT', `/berichte/${berichtId}`, { version: (await verBer()).version, vorkommnisse: 'nachträglich geändert' }));
    pruef(m02.status === 409, `M-02: Server nimmt Änderung nach Unterschrift an (Status ${m02.status})`);
    // Unterschrift zurückziehen → wieder bearbeitbar → neu unterschreiben
    await page.click('[data-sig-weg="an"]');
    await page.click('dialog[open] [data-ok]');
    await page.waitForSelector('.sig-box[data-sig="an"]:not(.signed) canvas');
    pruef(await page.locator('#gesperrt-hinweis').count() === 0 && await page.locator('[data-f="vorkommnisse"]:not([disabled])').count() === 1, 'M-02: nach dem Zurückziehen nicht wieder bearbeitbar');
    await toastWeg();
    // C-06: der Vermerk „Unterschrift zurückgezogen“ ist sichtbar; die Bauherr-Unterschrift zieht nur Büro/GF zurück
    pruef(await page.locator('#nach-unterschrift').count() === 1 && !!(await verBer()).geaendertNachUnterschrift, 'C-06: Vermerk nach zurückgezogener Unterschrift fehlt');
    await unterschreibe('bh', 'Ing. Maria Gruber');
    pruef(await page.locator('[data-sig-weg="bh"]').count() === 0 && await page.locator('[data-bh-fest]').count() === 1, 'C-06: Polier sieht „Unterschrift zurückziehen“ beim Bauherrn');
    const c06 = await absichtlich(() => api('DELETE', `/berichte/${berichtId}/unterschrift/bh`));
    pruef(c06.status === 403, `C-06: Polier kann die Bauherr-Unterschrift zurückziehen (Status ${c06.status})`);
    await ueberlauf('bericht bauherr unterschrieben'); await shot('bericht-bauherr-fest');
    await unterschreibe('an');
    await bereit();
    ber = (await api('GET', `/berichte/${berichtId}`)).json;
    pruef(ber.status === 'unterschrieben', `Bericht nach zwei Unterschriften: Status ${ber.status}`);
    pruef(!!(ber.unterschriften.an && ber.unterschriften.bh && ber.unterschriften.bh.name === 'Ing. Maria Gruber'), 'Bericht: Unterschriften nicht am Server');
    pruef(await page.locator('#freigeben').count() === 0, 'Polier sieht die Schaltfläche „Freigeben“');
    pruef(await page.locator('.bform textarea:not([disabled])').count() === 0, 'Bericht ist nach den Unterschriften noch bearbeitbar');
    await ueberlauf('bericht unterschrieben'); await shot('bericht-unterschrieben'); await keinEuro('bericht unterschrieben');
    await toastWeg();
    for (const r of ['/preise', '/kalkulation', `/kalkulation/${bsId}`, '/monat', '/benutzer']) { await keinZugriff(r); await keinEuro(r); }
    // B-07: Polier darf nur Schlechtwetter für seine Partie eintragen
    await geh('/abwesenheiten'); await keinEuro('polier abwesenheiten');
    pruef(await page.locator('[data-entscheid]').count() === 0, 'B-07: Polier sieht Genehmigen/Ablehnen');
    await page.click('[data-akt="eintragen"]');
    await page.waitForSelector('dialog[open] #abw-e');
    pruef((await page.locator('dialog[open] select[name="code"] option').allInnerTexts()).join('|').startsWith('SW') && await page.locator('dialog[open] select[name="code"] option').count() === 1, 'B-07: Polier kann andere Kürzel als SW wählen');
    pruef(await page.locator('dialog[open] input[name="wer"]').count() >= 1, 'B-07: Polier hat niemanden aus der Partie zur Auswahl');
    const heuteWien = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
    const belegt = (await api('GET', `/abwesenheiten?von=${heuteWien}&bis=${heuteWien}`)).json.map((a) => String(a.benutzerId));
    const freieIds = (await page.locator('dialog[open] input[name="wer"]').evaluateAll((l) => l.map((i) => i.value))).filter((v) => !belegt.includes(v));
    pruef(freieIds.length >= 1, 'B-07: in der Partie ist heute niemand ohne Abwesenheit (Testdaten)');
    await page.locator(`dialog[open] input[name="wer"][value="${freieIds[0]}"]`).check();
    await ueberlauf('dialog schlechtwetter'); await shot('abwesenheit-sw-dialog');
    await page.click('dialog[open] button[type="submit"]');
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    await page.waitForSelector('#abw-andere li');
    const swEintrag = (await api('GET', '/abwesenheiten')).json.find((a) => a.code === 'SW' && a.datum === heuteWien && String(a.benutzerId) === freieIds[0]);
    pruef(!!swEintrag, 'B-07: Schlechtwetter des Poliers nicht am Server');
    pruef(swEintrag && swEintrag.status === 'beantragt' && await page.locator(`#abw-andere li[data-abw="${swEintrag && swEintrag.id}"] [data-abw-status="beantragt"]`).count() === 1, `C-13: Schlechtwetter des Poliers ist nicht „beantragt“ (${swEintrag && swEintrag.status})`);
    await toastWeg();
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
    pruef(['dashboard', 'berichte', 'baustellen', 'kalkulation', 'preise', 'monat', 'benutzer'].every((n) => nav.includes(n)), `Büro-Navigation falsch: ${nav}`);
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
    pruef(await page.locator('#nach-unterschrift').count() === 1 && (await page.locator('#nach-unterschrift').innerText()).includes('zurückgezogen'), 'C-06: Vermerk „Unterschrift zurückgezogen“ fehlt in der Freigabe-Ansicht');
    await shot('bericht-freigabe-vermerk');
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
    // B-07: Büro genehmigt den Antrag des Mitarbeiters; erst dann zählt er im Monat
    const monatU = async () => { const m = (await api('GET', `/monat?monat=${String((await api('GET', '/abwesenheiten')).json.find((a) => a.id === antragId).datum).slice(0, 7)}`)).json; return (m.mitarbeiter.find((x) => x.name === NAME.mitarbeiter) || {}).u; };
    const uVor = await monatU();
    await geh('/abwesenheiten');
    pruef(await page.locator(`#abw-offen li[data-abw="${antragId}"]`).count() === 1, 'B-07: Antrag des Mitarbeiters fehlt in der Genehmigungsliste');
    await ueberlauf('abwesenheiten büro'); await shot('abwesenheiten-buero');
    await page.click(`#abw-offen li[data-abw="${antragId}"] [data-entscheid="genehmigt"]`);
    await page.waitForFunction((id) => !document.querySelector(`#abw-offen li[data-abw="${id}"]`), antragId);
    pruef((await api('GET', '/abwesenheiten')).json.find((a) => a.id === antragId).status === 'genehmigt', 'B-07: Genehmigung nicht am Server');
    const uNach = await monatU();
    pruef(uNach === uVor + 1, `B-07: Urlaubstag zählt nicht erst ab Genehmigung (vorher ${uVor}, nachher ${uNach})`);
    await toastWeg();
    await page.click('[data-akt="eintragen"]');
    await page.waitForSelector('dialog[open] #abw-e');
    pruef(await page.locator('dialog[open] select[name="code"] option').count() === 4, 'B-07: Büro kann nicht alle Kürzel eintragen');
    await page.selectOption('dialog[open] select[name="code"]', 'K');
    // C-11: eine Person der Partie, die heute nicht da ist, bekommt „K“ – der Polier kann sie danach nicht einstempeln
    const heuteW = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
    const daHeute = (await api('GET', '/zeit/anwesend')).json.map((x) => x.benutzerId);
    const abwHeute = (await api('GET', `/abwesenheiten?von=${heuteW}&bis=${heuteW}`)).json.map((x) => x.benutzerId);
    const kranker = (await api('GET', '/benutzer')).json.find((m) => m.rolle === 'mitarbeiter' && m.aktiv && m.baustelleId === bsId && !daHeute.includes(m.id) && !abwHeute.includes(m.id));
    pruef(!!kranker, 'C-11: keine freie Person der Partie für den Krankenstand (Testdaten)');
    await page.locator(`dialog[open] input[name="wer"][value="${kranker.id}"]`).check();
    await page.click('dialog[open] button[type="submit"]');
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    await page.waitForSelector(`#abw-andere li:has(.c-K):has-text("${kranker.name}")`);
    await toastWeg();
    // C-13: Schlechtwetter-Meldung des Poliers wartet auf Bestätigung
    pruef(await page.locator('#abw-offen li:has(.c-SW) [data-entscheid="genehmigt"]').count() >= 1, 'C-13: Schlechtwetter des Poliers steht nicht zur Bestätigung an');
    // C-09: eigener Antrag des Büros ist „beantragt“ und kann nicht selbst genehmigt werden
    await page.click('[data-akt="antrag"]'); await page.waitForSelector('dialog[open] #abw-f');
    await page.click('dialog[open] button[type="submit"]');
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    await page.waitForSelector('#abw-eigene li[data-status="beantragt"]');
    const eigenB = (await api('GET', '/abwesenheiten')).json.find((a) => a.benutzerId === ich.benutzer.id && a.status === 'beantragt');
    pruef(!!eigenB, 'C-09: eigener Antrag des Büros ist nicht „beantragt“');
    pruef(await page.locator(`#abw-offen li[data-abw="${eigenB && eigenB.id}"] [data-eigener]`).count() === 1 && await page.locator(`#abw-offen li[data-abw="${eigenB && eigenB.id}"] [data-entscheid]`).count() === 0, 'C-09: eigener Antrag kann selbst genehmigt werden');
    const c09 = await absichtlich(() => api('PUT', `/abwesenheiten/${eigenB.id}`, { status: 'genehmigt' }));
    pruef(c09.status === 403, `C-09: Server lässt Selbst-Genehmigung zu (Status ${c09.status})`);
    await ueberlauf('abwesenheiten eigener antrag'); await shot('abwesenheiten-eigener-antrag');
    await toastWeg();
    await page.click(`#abw-eigene li[data-abw="${eigenB.id}"] [data-zurueckziehen]`);
    await page.click('dialog[open] [data-ok]');
    await page.waitForFunction((id) => !document.querySelector(`li[data-abw="${id}"]`), eigenB.id);
    await toastWeg();
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
    const bsVer = (await api('GET', `/baustellen/${bsId}`)).json.version;
    const blSetzen = await api('PUT', `/baustellen/${bsId}`, { bauleiterId: blId, version: bsVer });
    pruef(blSetzen.status === 200, `Bauleiter-Zuordnung durch das Büro fehlgeschlagen (${blSetzen.status})`);
    // Auftragssumme so setzen, dass der Verbrauch über einer noch nicht gemeldeten Schwelle liegt
    const schonGemeldet = (kalkNach.alarme || []).map((a) => a.schwelle);
    const ziel = !schonGemeldet.includes(80) ? 85 : !schonGemeldet.includes(90) ? 95 : 104;
    const nt = (kalkNach.nachtraege || []).reduce((s, n) => s + n.betrag, 0);
    const summe = Math.max(1, Math.round((kalkNach.kosten.gesamt / (ziel / 100) - nt) * 100) / 100);
    const budgetVorher = (await api('GET', '/benachrichtigungen')).json.filter((m) => m.typ === 'budget' && m.baustelleId === bsId).length;
    await geh(`/baustelle/${bsId}`);
    // C-08: Baustelle wurde inzwischen von jemand anderem geändert → Hinweis statt Überschreiben
    const bsJetzt = (await api('GET', `/baustellen/${bsId}`)).json;
    await api('PUT', `/baustellen/${bsId}`, { version: bsJetzt.version, adresse: bsJetzt.adresse });
    await page.fill('#auftrag input[name="auftragssumme"]', '77.777');
    await absichtlich(async () => { await page.click('#auftrag-ok'); if (await page.locator('dialog[open] [data-ok]').count()) await page.click('dialog[open] [data-ok]'); await page.waitForSelector('#auftrag .form-err[data-konflikt]:not([hidden])'); });
    pruef((await api('GET', `/baustellen/${bsId}`)).json.auftragssumme === bsJetzt.auftragssumme, 'C-08: veralteter Stand der Baustelle wurde gespeichert');
    await shot('baustelle-konflikt');
    await page.click('#auftrag [data-konflikt-laden]');
    await bereit(); await page.waitForSelector('#auftrag');
    // B-04: „250.000“ sind zweihundertfünfzigtausend – und unklare Eingaben werden nicht gespeichert
    const feldSumme = page.locator('#auftrag input[name="auftragssumme"]');
    const summeServer = async () => (await api('GET', `/baustellen/${bsId}`)).json.auftragssumme;
    const summeAlt = await summeServer();
    await feldSumme.fill('1.2345');
    pruef(await page.locator('#auftrag .geld-echo.err').count() === 1, 'B-04: Auftragssumme „1.2345“ nicht als unklar markiert');
    await page.click('#auftrag-ok'); await sleep(300);
    pruef(await summeServer() === summeAlt && await page.locator('#auftrag .form-err:not([hidden])').count() === 1, 'B-04: unklare Auftragssumme wurde gespeichert');
    await feldSumme.fill('250.000');
    pruef((await page.locator('#auftrag .geld-echo').innerText()).includes('250.000,00'), 'B-04: Rückanzeige „250.000,00“ fehlt');
    await page.click('#auftrag-ok');
    if (summeAlt && (250000 / summeAlt > 10 || summeAlt / 250000 > 10)) await page.click('dialog[open] [data-ok]');
    await page.waitForFunction(() => document.querySelector('#auftrag input[name="auftragssumme"]') && document.querySelector('#auftrag input[name="auftragssumme"]').value === '250.000,00');
    pruef(await summeServer() === 250000, `B-04: „250.000“ als ${await summeServer()} gespeichert`);
    await toastWeg();
    // B-04: Änderung um mehr als Faktor 10 → Rückfrage; Abbrechen ändert nichts
    await page.fill('#auftrag input[name="auftragssumme"]', '250');
    await page.click('#auftrag-ok');
    await page.waitForSelector('dialog[open] [data-ok]');
    pruef((await page.locator('dialog[open]').innerText()).includes('250.000,00'), 'B-04: Rückfrage nennt den alten Betrag nicht');
    await shot('auftrag-rueckfrage');
    await page.click('dialog[open] .dlg-foot [data-zu]');
    await sleep(200);
    pruef(await summeServer() === 250000, 'B-04: Auftragssumme trotz abgebrochener Rückfrage geändert');
    await page.fill('#auftrag input[name="auftragssumme"]', String(summe).replace('.', ','));
    await shot('baustelle-auftrag');
    await page.click('#auftrag-ok');
    if (250000 / summe > 10) await page.click('dialog[open] [data-ok]');
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
    // M-03: Fremdleistung erfassen (B-04: „12.500“ = zwölftausendfünfhundert) und wieder stornieren
    const fremdVor = (await api('GET', `/baustellen/${bsId}/fremdleistungen`)).json.length;
    await page.click('[data-akt="fremd"]');
    await page.fill('dialog[open] input[name="text"]', 'E2E Subunternehmer');
    await page.fill('dialog[open] input[name="betrag"]', '1.2345');
    pruef(await page.locator('dialog[open] .geld-echo.err').count() === 1, 'B-04: unklare Eingabe „1.2345“ wird nicht als Fehler angezeigt');
    await page.click('dialog[open] button[type="submit"]');
    await sleep(300);
    pruef((await api('GET', `/baustellen/${bsId}/fremdleistungen`)).json.length === fremdVor && await page.locator('dialog[open] .form-err:not([hidden])').count() === 1, 'B-04: unklarer Betrag wurde trotzdem gesendet');
    await page.fill('dialog[open] input[name="betrag"]', '12.500');
    pruef((await page.locator('dialog[open] .geld-echo').innerText()).includes('12.500,00'), 'B-04: Rückanzeige für „12.500“ fehlt');
    await shot('fremdleistung-dialog');
    await page.click('dialog[open] button[type="submit"]');
    await page.waitForSelector('#fremd-einzeln');
    const fremdListe = (await api('GET', `/baustellen/${bsId}/fremdleistungen`)).json;
    const fremdNeu = fremdListe.find((f) => f.text === 'E2E Subunternehmer');
    pruef(fremdListe.length === fremdVor + 1 && fremdNeu && fremdNeu.betrag === 12500, `B-04: „12.500“ als ${fremdNeu && fremdNeu.betrag} gespeichert`);
    await toastWeg();
    await page.click('#fremd-einzeln summary');
    await page.click(`#fremd-einzeln [data-storno][data-id="${fremdNeu.id}"]`);
    await page.click('dialog[open] [data-ok]');
    await page.waitForFunction((id) => !document.querySelector(`#fremd-einzeln [data-id="${id}"]`), fremdNeu.id);
    pruef((await api('GET', `/baustellen/${bsId}/fremdleistungen`)).json.length === fremdVor, 'M-03: stornierte Fremdleistung noch am Server');
    await toastWeg();
    // M-03: Leistungsmeldung erfassen und stornieren
    const leistVor = (await api('GET', `/baustellen/${bsId}/leistungen`)).json.length;
    await page.click('[data-akt="leistung"]');
    await page.waitForSelector('dialog[open] #lf');
    await page.fill('dialog[open] input[name="menge"]', '2,5');
    await page.click('dialog[open] button[type="submit"]');
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    await bereit();
    const leistListe = (await api('GET', `/baustellen/${bsId}/leistungen`)).json;
    pruef(leistListe.length === leistVor + 1, 'M-03: Leistungsmeldung nicht gespeichert');
    const leistNeu = leistListe.reduce((a, x) => (x.id > a.id ? x : a), leistListe[0]);
    await toastWeg();
    await page.click('#leistung-einzeln summary');
    await page.click(`#leistung-einzeln [data-storno][data-id="${leistNeu.id}"]`);
    await page.click('dialog[open] [data-ok]');
    await page.waitForFunction((id) => !document.querySelector(`#leistung-einzeln [data-id="${id}"]`), leistNeu.id);
    pruef((await api('GET', `/baustellen/${bsId}/leistungen`)).json.length === leistVor, 'M-03: stornierte Leistungsmeldung noch am Server');
    await toastWeg();
    await geh('/kalkulation', 'kalkulation-uebersicht');
    pruef(await page.locator('.kalk-card').count() >= 1, 'Nachkalkulation-Übersicht leer');
    // N-09: Auftragssumme lässt sich löschen
    const andereBs = (await api('GET', '/baustellen')).json.find((x) => x.id !== bsId && x.auftragssumme != null);
    if (andereBs) {
      await geh(`/baustelle/${andereBs.id}`);
      await page.fill('#auftrag input[name="auftragssumme"]', '');
      await page.click('#auftrag-ok');
      await page.click('dialog[open] [data-ok]');
      await page.waitForFunction(() => document.querySelector('#auftrag input[name="auftragssumme"]') && document.querySelector('#auftrag input[name="auftragssumme"]').value === '' && !document.querySelector('dialog[open]'));
      await bereit();
      pruef((await api('GET', `/baustellen/${andereBs.id}`)).json.auftragssumme == null, 'N-09: Auftragssumme wurde nicht gelöscht');
      await toastWeg();
    } else pruef(false, 'N-09: keine zweite Baustelle mit Auftragssumme in den Testdaten');
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
    // B-05: Büro trägt das vergessene Ausstempeln nach (mit Grund), ändert und sieht die Korrektur
    const offenLang = (await api('GET', '/zeit/anwesend')).json.filter((x) => Date.now() - new Date(x.seit).getTime() > 12 * 3600e3).sort((x, y) => (x.seit < y.seit ? -1 : 1))[0];
    if (offenLang) {
      const lokalZeit = (ms) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'Europe/Vienna' }).slice(0, 16).replace(' ', 'T');
      const tag = lokalZeit(new Date(offenLang.seit).getTime()).slice(0, 10);
      await geh(`/korrektur?benutzerId=${offenLang.benutzerId}&von=${tag}&bis=${lokalZeit(Date.now()).slice(0, 10)}`, 'korrektur');
      await page.waitForSelector('#k-liste li[data-buchung]');
      const nVor = await page.locator('#k-liste li[data-buchung]').count();
      await page.click('#k-neu');
      await page.selectOption('dialog[open] select[name="typ"]', 'gehen');
      await page.fill('dialog[open] input[name="zeit"]', lokalZeit(new Date(offenLang.seit).getTime() + 9 * 3600e3));
      await page.click('dialog[open] button[type="submit"]');
      pruef(await page.locator('dialog[open] .form-err:not([hidden])').count() === 1 || await page.locator('dialog[open] input[name="grund"]:invalid').count() === 1, 'B-05: Korrektur ohne Grund möglich');
      await page.fill('dialog[open] input[name="grund"]', 'Ausstempeln vergessen (E2E)');
      await ueberlauf('dialog korrektur'); await shot('korrektur-dialog');
      await page.click('dialog[open] button[type="submit"]');
      await page.waitForFunction((n) => !document.querySelector('dialog[open]') && document.querySelectorAll('#k-liste li[data-buchung]').length === n + 1, nVor);
      pruef(!(await api('GET', '/zeit/anwesend')).json.some((x) => x.benutzerId === offenLang.benutzerId), 'B-05: Person nach nachgetragenem „Gehen“ noch eingestempelt');
      const buchungen = (await api('GET', `/zeit/buchungen?benutzerId=${offenLang.benutzerId}&von=${tag}&bis=${lokalZeit(Date.now()).slice(0, 10)}`)).json;
      const neuB = buchungen.find((x) => x.quelle === 'buero' && x.typ === 'gehen');
      pruef(!!neuB, 'B-05: nachgetragene Buchung nicht mit Quelle „buero“ am Server');
      await toastWeg();
      await page.click(`#k-liste [data-aendern="${neuB.id}"]`);
      await page.fill('dialog[open] input[name="zeit"]', lokalZeit(new Date(offenLang.seit).getTime() + 8.5 * 3600e3));
      await page.fill('dialog[open] input[name="grund"]', 'laut Polier 15:30 (E2E)');
      await page.click('dialog[open] button[type="submit"]');
      await page.waitForFunction(() => !document.querySelector('dialog[open]'));
      const geaendert = (await api('GET', `/zeit/buchungen?benutzerId=${offenLang.benutzerId}&von=${tag}&bis=${lokalZeit(Date.now()).slice(0, 10)}`)).json.find((x) => x.id === neuB.id);
      pruef(Math.abs(new Date(geaendert.zeit).getTime() - (new Date(offenLang.seit).getTime() + 8.5 * 3600e3)) < 61e3, 'B-05: geänderte Zeit nicht am Server');
      await ueberlauf('korrektur nach änderung'); await shot('korrektur-liste');
      await toastWeg();
    } else pruef(false, 'B-05: keine lange offene Schicht in den Testdaten');
    // C-14: Büro verwaltet Mitarbeiter, Poliere und Bauleiter – ohne Rechte-Matrix und Protokoll
    await geh('/benutzer', 'buero-benutzer');
    pruef(await page.locator('[data-tab="matrix"], [data-tab="protokoll"], #matrix').count() === 0, 'C-14: Büro sieht Rechte-Matrix oder Protokoll');
    pruef(await page.locator(`#benutzerliste li:has-text("${NAME.gf}") [data-bearb]`).count() === 0 && await page.locator(`#benutzerliste li:has-text("${NAME.mitarbeiter}") [data-bearb]`).count() === 1, 'C-14: Büro kann GF bearbeiten oder Mitarbeiter nicht');
    await page.click('[data-akt="neu"]');
    pruef((await page.locator('dialog[open] select[name="rolle"] option').evaluateAll((l) => l.map((o) => o.value))).join(',') === 'mitarbeiter,polier,bauleiter', 'C-14: Büro kann Rollen Büro/GF vergeben');
    await page.fill('dialog[open] input[name="name"]', 'Neu Vom Buero');
    await page.fill('dialog[open] input[name="pin"]', '5913');
    await ueberlauf('dialog benutzer büro'); await shot('buero-benutzer-dialog');
    await page.click('dialog[open] button[type="submit"]');
    await page.waitForSelector('#benutzerliste li:has-text("Neu Vom Buero")');
    const neuB = (await api('GET', '/benutzer')).json.find((m) => m.name === 'Neu Vom Buero');
    pruef(neuB && neuB.rolle === 'mitarbeiter' && !!neuB.pnr, `C-14: vom Büro angelegter Benutzer fehlt oder ohne Personalnummer (${JSON.stringify(neuB)})`);
    const c14 = await absichtlich(() => api('GET', '/rechte'));
    pruef(c14.status === 403, `C-14: Büro darf die Rechte-Matrix lesen (Status ${c14.status})`);
    await toastWeg();
    // C-07: Konto nach vielen Fehlversuchen (von verschiedenen Adressen) gesperrt → Büro entsperrt
    const opfer = (await api('GET', '/benutzer')).json.find((m) => m.rolle === 'mitarbeiter' && m.aktiv && m.id !== neuB.id && m.name !== NAME.mitarbeiter && !m.name.startsWith('Test'));
    const versuch = (pin, ip) => fetch(srv.url + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify({ benutzerId: opfer.id, pin }) }).then((r) => r.status);
    for (let i = 0; i < 24; i++) await versuch('9' + String(1000 + i).slice(1), `10.9.${Math.floor(i / 3)}.7`);
    const gesperrtStatus = await versuch(PIN, '10.77.0.1');
    pruef(gesperrtStatus === 423, `C-07: Konto nach 24 Fehlversuchen nicht gesperrt (Status ${gesperrtStatus} mit richtiger PIN)`);
    // Anmeldeseite (frisches Gerät): klare Meldung „bitte im Büro melden“
    const ctxNeu = await browser.newContext({ viewport: { width: g.width, height: g.height }, locale: 'de-AT', timezoneId: 'Europe/Vienna' });
    const seite2 = await ctxNeu.newPage();
    await seite2.goto(srv.url + '/#/login'); await seite2.waitForSelector('.login-user');
    await seite2.fill('#login-suche', opfer.name.split(' ')[1]);
    await seite2.click(`.login-user:has-text("${opfer.name}")`);
    for (const z of PIN) await seite2.click(`.pin-pad [data-z="${z}"]`);
    await seite2.click('.pin-pad [data-ok]');
    await seite2.waitForSelector('.pin-msg.err');
    const sperrText = await seite2.locator('.pin-msg.err').innerText();
    pruef(/Büro/.test(sperrText) && /gesperrt/i.test(sperrText), `C-07: Anmeldeseite zeigt keine klare Sperr-Meldung („${sperrText}“)`);
    if (SHOTS) await seite2.screenshot({ path: path.join(SHOTS, `${g.name}-login-gesperrt.png`) });
    await ctxNeu.close();
    await page.reload(); await bereit();
    await page.waitForSelector(`#gesperrte li[data-benutzer="${opfer.id}"] [data-entsperren]`);
    await ueberlauf('benutzer gesperrt'); await shot('benutzer-gesperrt');
    await page.click(`#gesperrte li[data-benutzer="${opfer.id}"] [data-entsperren]`);
    await page.waitForFunction((id) => !document.querySelector(`#gesperrte li[data-benutzer="${id}"]`), opfer.id);
    const nachEntsperren = await versuch(PIN, '10.78.0.1');
    pruef(nachEntsperren === 200, `C-07: Anmeldung nach „Entsperren“ nicht möglich (Status ${nachEntsperren})`);
    await toastWeg();
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
    await keinZugriff('/monat'); await keinZugriff('/benutzer'); await keinZugriff('/korrektur');
    // N-07: fremde Baustelle zeigt kein Auftragsformular
    const fremdeBs = (await api('GET', '/baustellen')).json.find((x) => x.bauleiterId !== ich.benutzer.id && !('auftragssumme' in x));
    if (fremdeBs) {
      await geh(`/baustelle/${fremdeBs.id}`, 'baustelle-fremd');
      pruef(await page.locator('#auftrag').count() === 0 && !(await text()).includes('Budget-Alarm'), 'N-07: Auftragsformular bei fremder Baustelle sichtbar');
    } else pruef(false, 'N-07: keine fremde Baustelle für den Bauleiter in den Testdaten');
    await geh('/abwesenheiten');
    await abmelden();

    /* ============ 5. Polier: bekommt keinen Budget-Alarm ============ */
    await anmelden('polier');
    const pm = (await api('GET', '/benachrichtigungen')).json;
    pruef(!pm.some((m) => m.typ === 'budget'), 'Budget-Alarm: Polier hat eine Budget-Benachrichtigung erhalten');
    await page.click('#glocke'); await page.waitForSelector('#notif-panel #notif-inhalt :is(.notif, .state.empty)');
    await keinEuro('polier benachrichtigungen');
    await page.click('#notif-panel [data-zu]');
    // C-11: Person mit genehmigtem Krankenstand lässt sich nicht einstempeln – Meldung des Servers steht in der Zeile
    await geh('/kolonne');
    await page.selectOption('#kol-bs', String(bsId)); await sleep(300); await bereit();
    await page.locator(`.crew-row:has-text("${kranker.name}") .check`).click();
    await page.click('[data-typ="kommen"]');
    await page.click('#kol-los');
    await page.waitForSelector(`.crew-row:has-text("${kranker.name}") .crew-err`);
    pruef((await page.locator(`.crew-row:has-text("${kranker.name}") .crew-err`).innerText()).length > 8, 'C-11: keine Begründung beim abgelehnten Einstempeln');
    await ueberlauf('kolonne krank'); await shot('kolonne-krank'); await keinEuro('kolonne krank');
    await toastWeg();
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
    NAME.neu = 'Test Probe';
    await ueberlauf('dialog benutzer'); await shot('benutzer-dialog');
    await page.click('dialog[open] button[type="submit"]');
    await page.waitForSelector('#benutzerliste li:has-text("Test Probe")');
    await page.click('[data-tab="matrix"]');
    await toastWeg();
    pruef(await page.locator('#matrix td[data-rolle="polier"][data-recht="benutzer"][data-gesperrt]').count() === 1 && await page.locator('#matrix td[data-rolle="buero"][data-recht="benutzer"][data-gesperrt]').count() === 1, 'B-01: Recht „benutzer“ ist in der Matrix nicht für alle außer GF gesperrt');
    for (const r of ['/dashboard', '/berichte', '/baustellen', '/kalkulation', '/preise', '/monat', '/abwesenheiten', '/kolonne', '/stempeln', '/woche', '/pin', '/mehr']) await geh(r, 'gf' + r.replace('/', '-'));
    await abmelden();

    /* ============ 6b. B-03: neuer Benutzer muss zuerst die PIN ändern ============ */
    await page.fill('#login-suche', 'Probe');
    await page.click('.login-user:has-text("Test Probe")');
    for (const z of '4711') await page.click(`.pin-pad [data-z="${z}"]`);
    await page.click('.pin-pad [data-ok]');
    await page.waitForSelector('[data-zustand="pin-aendern"]');
    pruef(await page.locator('#view, .sidenav, .tabbar').count() === 0, 'B-03: trotz PIN-Pflicht ist die App erreichbar');
    await ueberlauf('pin pflicht'); await shot('pin-pflicht');
    await page.evaluate(() => { location.hash = '#/stempeln'; }); await sleep(300);
    pruef(await page.locator('[data-zustand="pin-aendern"]').count() === 1, 'B-03: PIN-Pflicht lässt sich über die Adresse umgehen');
    const gesperrtApi = await absichtlich(() => api('GET', '/zeit/status'));
    pruef(gesperrtApi.status === 403 && gesperrtApi.json.code === 'PIN_AENDERN', `B-03: Server lässt vor der PIN-Änderung zu (Status ${gesperrtApi.status})`);
    await page.fill('#pinform input[name="alt"]', '4711');
    await page.fill('#pinform input[name="neu"]', '1234'); await page.fill('#pinform input[name="neu2"]', '1234');
    await page.click('#pin-ok');
    pruef(await page.locator('#pin-err:not([hidden])').count() === 1, 'B-03: einfache Folge „1234“ wird als neue PIN angenommen');
    await page.fill('#pinform input[name="neu"]', '80'); await page.fill('#pinform input[name="neu2"]', '80');
    await page.click('#pin-ok');
    pruef((await page.locator('#pin-err').innerText()).includes('mindestens'), 'B-03: zu kurze PIN wird nicht abgelehnt');
    await page.fill('#pinform input[name="neu"]', '8052'); await page.fill('#pinform input[name="neu2"]', '8052');
    await page.click('#pin-ok');
    await page.waitForSelector('#view');
    await bereit();
    pruef((await api('GET', '/auth/ich')).json.mussPinAendern === false, 'B-03: nach der Änderung besteht die PIN-Pflicht weiter');
    await keinEuro('neuer benutzer');
    await toastWeg();
    await abmelden();
    // alte PIN gilt nicht mehr, neue schon
    await page.fill('#login-suche', 'Probe');
    await page.click('.login-user:has-text("Test Probe")');
    for (const z of '4711') await page.click(`.pin-pad [data-z="${z}"]`);
    await absichtlich(async () => { await page.click('.pin-pad [data-ok]'); await page.waitForSelector('.pin-msg.err'); });
    for (const z of '8052') await page.click(`.pin-pad [data-z="${z}"]`);
    await page.click('.pin-pad [data-ok]');
    await page.waitForSelector('#view'); await bereit();
    await abmelden();
    pruef((await page.locator('.login-user small').allInnerTexts()).every((t) => !/Geschäftsführung|Büro|Bauleiter|Polier/.test(t)), 'B-03: Anmeldeliste zeigt Rollen');

    /* ============ 6c. M-06: Sicherheits-Header, kein Inline-Skript ============ */
    const start = await context.request.get(srv.url + '/');
    const csp = start.headers()['content-security-policy'] || '';
    pruef(/script-src 'self'/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp), `M-06: Content-Security-Policy fehlt oder erlaubt Inline-Skripte („${csp.slice(0, 80)}“)`);
    pruef(await page.evaluate(() => [...document.scripts].every((x) => x.src) && !document.querySelector('[onclick],[onload],[onerror],[onchange],[oninput],[onsubmit]')), 'M-06: Inline-Skript oder Inline-Ereignis im Dokument');
    pruef(!/ style=/.test(await (await context.request.get(srv.url + '/index.html')).text()), 'M-06: index.html enthält Inline-Styles');

    /* ============ 7. PWA ============ */
    const man = await context.request.get(srv.url + '/manifest.webmanifest');
    const manJson = man.ok() ? await man.json() : {};
    pruef(man.ok() && manJson.icons && manJson.icons.length >= 2 && manJson.display === 'standalone', 'Manifest fehlt oder unvollständig');
    for (const i of manJson.icons || []) { const r = await context.request.get(srv.url + i.src); pruef(r.ok() && /image\/png/.test(r.headers()['content-type'] || ''), `Icon ${i.src} fehlt`); }
    const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!(r && (r.active || r.installing || r.waiting)); });
    pruef(sw, 'Service Worker ist nicht registriert');
    const apiImCache = await page.evaluate(async () => { for (const n of await caches.keys()) { const c = await caches.open(n); for (const k of await c.keys()) if (new URL(k.url).pathname.startsWith('/api/')) return k.url; } return ''; });
    pruef(!apiImCache, `Service Worker hat eine API-Antwort gespeichert: ${apiImCache}`);

    /* ============ 7b. C-04 / C-15: ganze Schicht nachtragen und löschen – am Gerät mit Zeitzone New York ============ */
    {
      const ctxNy = await browser.newContext({ viewport: { width: g.width, height: g.height }, locale: 'de-AT', timezoneId: 'America/New_York' });
      const ny = await ctxNy.newPage();
      const nyFehler = [];
      ny.on('console', (m) => { if (m.type() === 'error') nyFehler.push(m.text()); });
      ny.on('pageerror', (e) => nyFehler.push('pageerror: ' + e.message));
      const nyApi = (pfad) => ny.evaluate(async (p) => (await fetch('/api' + p)).json(), pfad);
      await ny.goto(srv.url + '/#/login'); await ny.waitForSelector('.login-user');
      await ny.fill('#login-suche', NAME.buero.split(' ')[1]);
      await ny.click(`.login-user:has-text("${NAME.buero}")`);
      for (const z of PIN) await ny.click(`.pin-pad [data-z="${z}"]`);
      await ny.click('.pin-pad [data-ok]');
      await ny.waitForSelector('#view');
      const person = (await nyApi('/benutzer')).find((m) => m.name === 'Neu Vom Buero');
      // ein Sonntag vor drei bis vier Wochen (Wiener Datum), dort gibt es keine Schicht
      const basis = new Date(Date.now() - 21 * 86400e3);
      const tagWien = new Date(basis.getTime() - ((new Date(basis.toLocaleString('en-US', { timeZone: 'Europe/Vienna' })).getDay()) % 7) * 86400e3).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
      await ny.evaluate((h) => { location.hash = h; }, `#/korrektur?benutzerId=${person.id}&von=${tagWien}&bis=${tagWien}`);
      await ny.waitForSelector('#k-schichten .state, #k-schichtliste');
      pruef(await ny.locator('#k-schichtliste li').count() === 0, 'C-04: Testtag hat schon eine Schicht');
      // C-15: Vorbelegung des Einzelbuchungs-Dialogs ist Wiener Zeit, nicht New York
      await ny.click('#k-neu');
      const vorbelegt = await ny.locator('dialog[open] input[name="zeit"]').inputValue();
      const wienJetzt = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Vienna' }).slice(0, 16).replace(' ', 'T');
      pruef(Math.abs(new Date(vorbelegt + ':00Z').getTime() - new Date(wienJetzt + ':00Z').getTime()) < 3 * 60e3, `C-15: Dialog rechnet mit der Geräte-Zeitzone (vorbelegt ${vorbelegt}, Wien ${wienJetzt})`);
      await ny.click('dialog[open] .dlg-foot [data-zu]');
      // C-04: ganze Schicht 07:00–15:30, Pause 30
      await ny.click('#k-schicht');
      await ny.fill('dialog[open] input[name="datum"]', tagWien);
      await ny.selectOption('dialog[open] select[name="baustelleId"]', String(bsId));
      await ny.fill('dialog[open] input[name="von"]', '07:00'); await ny.fill('dialog[open] input[name="bis"]', '15:30');
      await ny.fill('dialog[open] input[name="pauseMin"]', '30');
      pruef((await ny.locator('#sf-std').innerText()).startsWith('8 Std'), `C-04: Vorschau der Schichtdauer falsch („${await ny.locator('#sf-std').innerText()}“)`);
      await ny.click('dialog[open] button[type="submit"]');
      pruef(await ny.locator('dialog[open] .form-err:not([hidden])').count() === 1, 'C-04: Schicht ohne Grund möglich');
      await ny.fill('dialog[open] input[name="grund"]', 'Stempeln vergessen (E2E)');
      if (SHOTS) await ny.screenshot({ path: path.join(SHOTS, `${g.name}-korrektur-schicht-dialog.png`) });
      await ny.click('dialog[open] button[type="submit"]');
      await ny.waitForSelector('#k-schichtliste li[data-schicht]');
      const sch = (await nyApi(`/zeit/schichten?benutzerId=${person.id}&von=${tagWien}&bis=${tagWien}`));
      const winter = new Date(tagWien + 'T12:00:00Z').toLocaleString('en-US', { timeZone: 'Europe/Vienna', timeZoneName: 'short' }).includes('GMT+1');
      const bu = (await nyApi(`/zeit/buchungen?benutzerId=${person.id}&von=${tagWien}&bis=${tagWien}`));
      const kommen = bu.find((x) => x.typ === 'kommen');
      pruef(sch.length === 1 && sch[0].arbeitMin === 480 && sch[0].pauseMin === 30, `C-04: Schicht nicht richtig am Server (${JSON.stringify(sch).slice(0, 200)})`);
      pruef(kommen && new Date(kommen.zeit).toISOString() === `${tagWien}T0${winter ? 6 : 5}:00:00.000Z`, `C-15: „07:00“ wurde nicht als Wiener Zeit gespeichert (${kommen && kommen.zeit})`);
      pruef((await ny.locator('#k-schichtliste li').first().innerText()).includes('07:00') && (await ny.locator('#k-liste li[data-buchung] time').allInnerTexts()).includes('07:00'), 'C-15: Liste zeigt nicht die Wiener Zeit');
      const d = await ny.evaluate(() => { const v = document.getElementById('view'); return v.scrollWidth - v.clientWidth; });
      pruef(d <= 1, `[korrektur schichten] horizontaler Überlauf (${d})`);
      if (SHOTS) await ny.screenshot({ path: path.join(SHOTS, `${g.name}-korrektur-schichten.png`) });
      // ganze Schicht löschen
      await ny.click('#k-schichtliste [data-schicht-weg]');
      await ny.fill('dialog[open] input[name="grund"]', 'irrtümlich nachgetragen (E2E)');
      await ny.click('dialog[open] button[type="submit"]');
      await ny.waitForFunction(() => !document.querySelector('dialog[open]') && !document.querySelector('#k-schichtliste li'));
      pruef((await nyApi(`/zeit/buchungen?benutzerId=${person.id}&von=${tagWien}&bis=${tagWien}`)).length === 0, 'C-04: nach „Ganze Schicht löschen“ sind noch Buchungen vorhanden');
      pruef(nyFehler.length === 0, `Konsolenfehler (New-York-Gerät): ${nyFehler.slice(0, 4).join(' || ')}`);
      await ctxNy.close();
    }

    /* ============ 8. B-03: Anmeldung mit Personalnummer, wenn die Namensliste abgeschaltet ist ============ */
    const srv2 = await starteServer({ BAUTAG_LOGIN_LISTE: '0' });
    try {
      await absichtlich(async () => { await page.goto(srv2.url + '/#/login'); await page.waitForSelector('#pnr'); });
      pruef(await page.locator('.login-user').count() === 0, 'B-03: Namensliste trotz Abschaltung sichtbar');
      await ueberlauf('login personalnummer'); await shot('login-personalnummer');
      await page.fill('#pnr', '1002');
      await page.click('#pnr-form button[type="submit"]');
      for (const z of PIN) await page.click(`.pin-pad [data-z="${z}"]`);
      await page.click('.pin-pad [data-ok]');
      await page.waitForSelector('#view'); await bereit();
      const ich2 = (await api('GET', '/auth/ich')).json;
      pruef(ich2 && ich2.benutzer && ich2.benutzer.name === NAME.mitarbeiter, `B-03: Anmeldung mit Personalnummer liefert ${ich2 && ich2.benutzer && ich2.benutzer.name}`);
    } finally { srv2.stop(); }

    pruef(konsole.length === 0, `Konsolenfehler:\n      ${konsole.slice(0, 12).join('\n      ')}`);
  } catch (e) {
    const zeile = (/run\.js:(\d+)/.exec(e.stack || '') || [])[1];
    fehler.push(`Abbruch in Zeile ${zeile}: ${e.message.split('\n').slice(0, 6).join(' | ')} (bei ${page.url()})`);
    console.log(`    ✗ Abbruch (run.js:${zeile}): ${e.message.split('\n').slice(0, 3).join(' | ')}`);
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
  // Unit-Test der Zahlen-/Zeitlogik (B-04, B-06)
  const unit = spawnSync(process.execPath, [path.join(__dirname, 'parse.test.js')], { encoding: 'utf8' });
  process.stdout.write(unit.stdout + unit.stderr);
  if (unit.status !== 0) { console.log('E2E: Unit-Test der Zahleneingabe fehlgeschlagen'); process.exit(1); }
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
