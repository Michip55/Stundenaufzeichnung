'use strict';
/**
 * Nachkontrolle Sitzung/Gerät (API.md 15.16, Befunde H-S1, H-S2), je Bildschirmgröße:
 *   node tests/e2e/sitzung-n2.js      (im Ordner app; E2E_NUR=handy|tablet|pc; Exit-Code 1 bei Befunden)
 * Wird auch von run.js aufgerufen (abschaltbar mit E2E_OHNE_SITZUNG_N2=1).
 *
 *  1. H-S1: Abmelden bei langsamem Netz (POST /auth/logout 6 s unterwegs) – sofort ist nichts der Person mehr zu sehen oder zu
 *     bedienen (kein Rahmen, keine Beträge, keine Rechnungsnummer), das Bindungs-Cookie ist weg, und keine weitere Anfrage geht
 *     hinaus, bevor das Abmelden am Server angekommen ist (auch kein Klick auf einen Menüpunkt).
 *  2. H-S1: dasselbe bei der Sperre nach Untätigkeit (die nächste Person tippt auf den Bildschirm und dann ins Menü).
 *  3. H-S2: zweiter Tab am geteilten PC – Abmelden in Tab 1 sperrt Tab 2 binnen 1 s; meldet sich danach eine andere Person in
 *     Tab 1 an, zeigt Tab 2 nichts der vorigen Person. Auch ohne BroadcastChannel (nur storage-Ereignis) und bei derselben Person.
 *  4. H-S2: Anmeldung einer anderen Person ohne jedes Ereignis (Cookie ersetzt): die nächste Anfrage des alten Rahmens wird vom
 *     Server abgewiesen (409 ANMELDUNG_ANDERS), der Tab sperrt sich, keine Daten der neuen Person im alten Rahmen.
 */
const { chromium } = require('playwright');
const { starte, U, BS, START } = require('../api/hilfe');
const { GROESSEN } = require('./geraet');

const NAME = { [U.polier]: 'Josef Haidbauer', [U.buero]: 'Martina Koller' };
const AR = 'AR-2026-4711';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function laufe(browser, g) {
  const fehler = [];
  let schritte = 0;
  const pruef = (ok, text) => { schritte++; if (!ok) { fehler.push(`Sitzung-N2/${g.name}: ${text}`); console.log(`    ✗ Sitzung-N2/${g.name}: ${text}`); } };
  // Sitzungsgrenzen wie im Betrieb (Büro 60 min = Sperre am Gerät; der Test springt nie mit der Uhr)
  const s = await starte({ test: true, sitzung: { feldMin: 720, bueroMin: 60, maxH: 24 } });
  let takt = null;
  const kontexte = [];
  try {
    const db = s.db;
    const gebunden = (id) => db.eins('SELECT COUNT(*) AS n FROM sitzung WHERE benutzer_id = ? AND bindung_hash IS NOT NULL', id).n;
    const gf = await s.login(U.gf);
    const rn = await gf.post(`/baustellen/${BS.pitten}/rechnungen`, { nr: AR, typ: 'teil', datum: '2026-09-01', netto: 12345.67, zahlungszielTage: 30 });
    if (![200, 201].includes(rn.status)) throw new Error(`Rechnung anlegen: ${rn.status} ${JSON.stringify(rn.daten)}`);
    NAME[U.buero] = db.eins('SELECT name FROM benutzer WHERE id = ?', U.buero).name;
    const basis = new Date(START).getTime() + 10 * 60000, t0 = Date.now();
    const jetzt = () => basis + (Date.now() - t0);
    s.uhr.setze(new Date(jetzt()).toISOString());
    takt = setInterval(() => s.uhr.setze(new Date(jetzt()).toISOString()), 200);

    async function kontext({ ohneKanal = false } = {}) {
      const ctx = await browser.newContext({ viewport: { width: g.width, height: g.height }, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: g.mobil, serviceWorkers: 'block' });
      kontexte.push(ctx);
      await ctx.clock.install({ time: new Date(jetzt()) });
      if (ohneKanal) await ctx.addInitScript(() => { delete window.BroadcastChannel; });
      return ctx;
    }
    async function seite(ctx, wo) {
      const page = await ctx.newPage();
      page.setDefaultTimeout(15000);
      const f = [];
      page.on('pageerror', (e) => f.push(String(e.message).slice(0, 160)));
      if (process.env.N2_LOG) page.on('console', (m) => console.log(`      [${wo}]`, m.type(), m.text().slice(0, 200)));
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) f.push(m.text().slice(0, 160)); });
      const o = {
        page, fehler: f, wo,
        bereit: async () => { await page.waitForFunction(() => !document.querySelector('#view .view-box > .state .spinner, #root > .state .spinner'), null, { timeout: 15000 }).catch(() => {}); await sleep(80); },
        geh: async (h) => { await page.evaluate((x) => { location.hash = x; }, '#' + h); await o.bereit(); },
        // Text außerhalb der Anmeldeseite (deren Namensliste nennt alle Personen)
        text: () => page.evaluate(() => { const b = document.body.cloneNode(true); b.querySelectorAll('#login-card').forEach((x) => x.remove()); return b.innerText || b.textContent || ''; }),
        async anmelden(id, { laden = true } = {}) {
          if (laden) await page.goto(`${s.basis}/?laden=${Date.now()}#/login`);
          await page.waitForSelector('#login-card .login-user');
          await page.fill('#login-suche', NAME[id].split(' ')[1]);
          await page.click(`.login-user:has-text("${NAME[id]}")`);
          await page.waitForSelector('.pin-pad');
          for (const z of '1234') await page.click(`.pin-pad [data-z="${z}"]`);
          await page.click('.pin-pad [data-ok]');
          await page.waitForSelector('#view');
          await o.bereit();
        },
        /** sichtbare Spuren der Person: Rahmen, Name, Beträge, Rechnungsnummer */
        async spuren(id) {
          const t = await o.text();
          return { view: await page.locator('#view').count(), nav: await page.locator('.nav-item').count(), name: t.includes(NAME[id]), euro: /€/.test(t), ar: t.includes(AR) };
        },
      };
      return o;
    }
    const leer = (x) => !!x && x.view === 0 && x.nav === 0 && !x.name && !x.euro && !x.ar;
    /** bis zu `ms` warten, bis von Person `id` nichts mehr zu sehen ist (der Tab lädt dabei ggf. neu) → letzter Stand */
    async function warteLeer(t, id, ms) {
      const bis = Date.now() + ms;
      let x = null;
      do { x = await t.spuren(id).catch(() => null); if (leer(x)) return x; await sleep(50); } while (Date.now() < bis);
      return x;
    }

    /* ---- 1) H-S1: Abmelden bei langsamem Netz ---- */
    {
      const ctx = await kontext();
      const t = await seite(ctx, 'H-S1');
      const { page } = t;
      await t.anmelden(U.buero);
      await t.geh('/offene-posten');
      await page.waitForSelector(`#view :text("${AR}")`).catch(() => {});
      const vor = await t.spuren(U.buero);
      pruef(vor.euro && vor.ar && vor.name, `Vorbedingung: Büro sieht Offene Posten mit ${AR} (${JSON.stringify(vor)})`);
      // ab jetzt: langsames Netz für das Abmelden, alle Anfragen mitschreiben
      let logoutFertig = 0;
      const anfragen = [];
      await page.route('**/api/auth/logout', async (r) => { await sleep(6000); await r.continue().catch(() => {}); logoutFertig = Date.now(); });
      page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) anfragen.push({ p: `${r.method()} ${u.pathname}`, t: Date.now() }); });
      const navBox = await page.locator('.nav-item[data-nav="offeneposten"]').first().boundingBox().catch(() => null);
      await t.geh('/mehr');
      await page.click('#abmelden');
      const ok = page.locator('dialog[open] [data-ok]');
      await sleep(100);
      if (await ok.count()) await ok.click();
      const tAb = Date.now();
      await sleep(250);
      const sofort = await t.spuren(U.buero);
      pruef(leer(sofort), `H-S1: 250 ms nach „Abmelden“ ist die App der Person noch sichtbar (${JSON.stringify(sofort)})`);
      pruef(!/bt_bindung=/.test(await page.evaluate(() => document.cookie)), 'H-S1: Bindungs-Cookie bleibt, solange das Abmelden unterwegs ist');
      pruef(!(await page.evaluate(() => localStorage.getItem('bt_ich'))) && !!(await page.evaluate(() => localStorage.getItem('bt_abmelden_offen'))), 'H-S1: bt_ich nicht sofort gelöscht bzw. Abmelden nicht vorgemerkt');
      // die nächste Person tippt dort, wo eben „Offene Posten“ war, und versucht die Adresse direkt
      if (navBox) await page.mouse.click(navBox.x + navBox.width / 2, navBox.y + navBox.height / 2);
      await page.evaluate(() => { location.hash = '#/offene-posten'; });
      await sleep(1500);
      const danach = await t.spuren(U.buero);
      pruef(leer(danach), `H-S1: während des Abmeldens wieder Daten der Person sichtbar (${JSON.stringify(danach)})`);
      for (let i = 0; i < 80 && !logoutFertig; i++) await sleep(100);
      pruef(logoutFertig > 0, 'Vorbedingung: Abmelden kam am Server an');
      await sleep(800);
      const vorzeitig = anfragen.filter((a) => a.t >= tAb && a.t < logoutFertig && !/\/api\/auth\/logout$/.test(a.p));
      pruef(vorzeitig.length === 0, `H-S1: Anfragen, während das Abmelden unterwegs war: ${vorzeitig.map((a) => a.p).join(', ')}`);
      pruef(!anfragen.some((a) => a.t >= tAb && /offene-posten|rechnungen/.test(a.p)), 'H-S1: Offene Posten nach dem Abmelden noch abgerufen');
      pruef(gebunden(U.buero) === 0, 'H-S1: App-Sitzung des Büros am Server nicht beendet');
      await page.waitForSelector('#login-card .login-user', { timeout: 15000 }).catch(() => {});
      pruef(await page.locator('#login-card .login-user').count() > 0, 'H-S1: Anmeldeseite erscheint nach dem Abmelden nicht');
      await page.unroute('**/api/auth/logout');

      /* ---- 2) H-S1: Sperre nach Untätigkeit bei langsamem Netz ---- */
      await t.anmelden(U.buero, { laden: false });
      await t.geh('/offene-posten');
      await page.waitForSelector(`#view :text("${AR}")`).catch(() => {});
      logoutFertig = 0; anfragen.length = 0;
      await page.route('**/api/auth/logout', async (r) => { await sleep(6000); await r.continue().catch(() => {}); logoutFertig = Date.now(); });
      await page.evaluate(() => localStorage.setItem('bt_aktiv', String(Date.now() - 61 * 60000)));
      if (process.env.N2_LOG) await page.evaluate(() => { window.addEventListener('pointerdown', (e) => console.log('bubble defPrev', e.defaultPrevented, e.target && e.target.tagName)); });
      if (process.env.N2_LOG) console.log('DBG', await page.evaluate(() => [localStorage.getItem('bt_aktiv'), Date.now(), (localStorage.getItem('bt_ich') || '').slice(0, 60), location.hash]));
      const tSp = Date.now();
      await page.mouse.click(Math.round(g.width / 2), Math.round(g.height / 2)); // erste Berührung der nächsten Person
      await sleep(250);
      const gesperrt = await t.spuren(U.buero);
      pruef(leer(gesperrt), `H-S1 (Sperre): 250 ms nach der ersten Berührung ist die App der Person noch sichtbar (${JSON.stringify(gesperrt)})`);
      if (navBox) await page.mouse.click(navBox.x + navBox.width / 2, navBox.y + navBox.height / 2);
      await page.evaluate(() => { location.hash = '#/offene-posten'; });
      await sleep(1500);
      pruef(leer(await t.spuren(U.buero)), 'H-S1 (Sperre): Menüpunkt nach der Sperre öffnet wieder Daten der Person');
      for (let i = 0; i < 80 && !logoutFertig; i++) await sleep(100);
      await sleep(800);
      const vorzeitig2 = anfragen.filter((a) => a.t >= tSp && a.t < logoutFertig && !/\/api\/auth\/logout$/.test(a.p));
      pruef(logoutFertig > 0 && vorzeitig2.length === 0, `H-S1 (Sperre): Anfragen, während das Abmelden unterwegs war: ${vorzeitig2.map((a) => a.p).join(', ')}`);
      pruef(gebunden(U.buero) === 0, 'H-S1 (Sperre): Sitzung am Server nicht beendet');
      await page.unroute('**/api/auth/logout');
      pruef(t.fehler.length === 0, `H-S1: Konsolen-/Seitenfehler: ${t.fehler.slice(0, 3).join(' | ')}`);
      await ctx.close();
    }

    /* ---- 3) H-S2: zweiter Tab am geteilten PC ---- */
    for (const ohneKanal of [false, true]) {
      const wie = ohneKanal ? ' (ohne BroadcastChannel)' : '';
      const ctx = await kontext({ ohneKanal });
      const t1 = await seite(ctx, 'Tab 1'), t2 = await seite(ctx, 'Tab 2');
      await t1.anmelden(U.buero);
      await t2.page.goto(`${s.basis}/#/offene-posten`);
      await t2.page.waitForSelector(`#view :text("${AR}")`).catch(() => {});
      const vor = await t2.spuren(U.buero);
      pruef(vor.euro && vor.ar && vor.name, `Vorbedingung${wie}: Tab 2 zeigt Offene Posten des Büros (${JSON.stringify(vor)})`);
      await t1.page.bringToFront();
      await t1.geh('/mehr');
      await t1.page.click('#abmelden');
      await sleep(100);
      const ok = t1.page.locator('dialog[open] [data-ok]'); if (await ok.count()) await ok.click();
      const x = await warteLeer(t2, U.buero, 1000);
      pruef(leer(x), `H-S2${wie}: Tab 2 zeigt 1 s nach dem Abmelden in Tab 1 noch die vorige Person (${JSON.stringify(x)})`);
      await t2.page.waitForSelector('#login-card', { timeout: 10000 }).catch(() => {});
      pruef(await t2.page.locator('#login-card').count() === 1, `H-S2${wie}: Tab 2 zeigt nach dem Abmelden in Tab 1 nicht die Anmeldung`);
      // die nächste Person (Polier) meldet sich in Tab 1 an und wechselt zu Tab 2
      await t1.page.waitForSelector('#login-card .login-user', { timeout: 15000 });
      await t1.anmelden(U.polier, { laden: false });
      await t2.page.bringToFront();
      await t2.page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
      await t2.page.mouse.click(Math.round(g.width / 2), Math.round(g.height / 2));
      await sleep(1200);
      const nach = await t2.spuren(U.buero);
      pruef(!nach.name && !nach.euro && !nach.ar && await t2.page.locator('.nav-item[data-nav="offeneposten"]').count() === 0, `H-S2${wie}: Tab 2 zeigt nach der Anmeldung des Poliers Daten/Menü des Büros (${JSON.stringify(nach)})`);
      // dieselbe Person in beiden Tabs: Abmelden in einem Tab beendet auch den anderen
      await t2.page.goto(`${s.basis}/?neu=1#/stempeln`); // neues Dokument (nicht nur Adresszusatz)
      await t2.page.waitForSelector('#view');
      pruef((await t2.spuren(U.polier)).name, `Vorbedingung${wie}: Tab 2 zeigt nach Neuladen den Polier`);
      await t1.page.bringToFront();
      await t1.geh('/mehr');
      await t1.page.click('#abmelden');
      await sleep(100);
      const ok2 = t1.page.locator('dialog[open] [data-ok]'); if (await ok2.count()) await ok2.click();
      const y = await warteLeer(t2, U.polier, 1000);
      pruef(leer(y), `H-S2${wie}: Abmelden des Poliers in Tab 1 lässt Tab 2 angemeldet (${JSON.stringify(y)})`);
      pruef(t1.fehler.length === 0 && t2.fehler.length === 0, `H-S2${wie}: Konsolen-/Seitenfehler: ${[...t1.fehler, ...t2.fehler].slice(0, 3).join(' | ')}`);
      await ctx.close();
    }

    /* ---- 4) H-S2: Anmeldung einer anderen Person ohne jedes Ereignis → der Server weist den alten Rahmen ab ---- */
    {
      const ctx = await kontext();
      const t = await seite(ctx, 'H-S2/409');
      const { page } = t;
      await t.anmelden(U.polier);
      await t.geh('/stempeln');
      const antworten = [];
      page.on('response', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) antworten.push(`${r.request().method()} ${u.pathname} ${r.status()}`); });
      // z. B. ein anderes Fenster, dessen Ereignisse diesen Tab nicht erreicht haben: das Cookie gehört jetzt dem Büro
      const abHier = antworten.length;
      const st = await page.evaluate(async (bid) => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ benutzerId: bid, pin: '1234', bindung: true }) })).status, U.buero);
      pruef(st === 200, `Vorbedingung: Anmeldung des Büros im Hintergrund (${st})`);
      await t.geh('/woche'); // der Polier tippt im alten Rahmen auf „Meine Woche“
      await page.waitForSelector('#fremd-angemeldet', { timeout: 5000 }).catch(() => {});
      const z = await t.spuren(U.buero);
      pruef(await page.locator('#fremd-angemeldet').count() === 1 && await page.locator('#view').count() === 0, `H-S2: alter Rahmen nach der Anmeldung einer anderen Person nicht gesperrt (${antworten.slice(-4).join(' | ')})`);
      pruef(!z.name && !z.euro && !(await t.text()).includes(NAME[U.polier]), 'H-S2: nach der Sperre noch Namen im Bild');
      const spaeter = antworten.slice(abHier).filter((a) => !/^POST \/api\/auth\/login /.test(a));
      pruef(spaeter.some((a) => / 409$/.test(a)) && !spaeter.some((a) => / 2\d\d$/.test(a)), `H-S2: Antwort unter der Anmeldung der anderen Person im alten Rahmen (${spaeter.join(' | ')})`);
      pruef(t.fehler.length === 0, `H-S2/409: Konsolen-/Seitenfehler: ${t.fehler.slice(0, 3).join(' | ')}`);
      await ctx.close();
    }
  } finally {
    clearInterval(takt);
    for (const c of kontexte) await c.close().catch(() => {});
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
      console.log(`\n▶ Sitzung/Gerät N2 ${g.name} (${g.width}×${g.height})`);
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
