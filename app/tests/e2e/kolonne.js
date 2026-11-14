'use strict';
/**
 * Kolonne und Stempeluhr ohne Abwesenheits-Rückschluss (API.md 15.2; Befunde F-013, F-018, F-032, F-033, F-034, F-045).
 *   node tests/e2e/kolonne.js        (im Ordner app; E2E_NUR=handy|tablet|pc; Exit-Code 1 bei Befunden)
 * Wird auch von run.js je Bildschirmgröße aufgerufen (abschaltbar mit E2E_OHNE_KOLONNE=1).
 *
 *  1. Polier: Abwesende (U, K) und Anwesende sehen in der Liste gleich aus, werden gleich gebucht; kein „kolonneMoeglich“,
 *     kein Sperrtext im Netz; aus „Meine Partie“ (plan=1) sind eingeplante Abwesende wie Anwesende vorausgewählt.
 *  2. Mitarbeiter mit Ausnahme „kolonne“: die Baustellenauswahl zeigt genau die Baustellen, die der Server erlaubt
 *     (keine fremden, keine 403), Buchung Abwesender/Anwesender gleich.
 *  3. Eigene Stempelung bei eigenem Urlaub: Meldung nennt nur die eigene Abwesenheit.
 *  4. Büro: Benachrichtigung „Stempelung trotz eingetragener Abwesenheit: …“ und Monatswarnung.
 */
const { chromium } = require('playwright');
const { starte, U, BS, START } = require('../api/hilfe');

const GROESSEN = [
  { name: 'handy', width: 390, height: 844, mobil: true },
  { name: 'tablet', width: 1180, height: 820, mobil: true },
  { name: 'pc', width: 1440, height: 900, mobil: false }
];
const TAG = '2026-11-12';
const NAME = { 2: 'Lukas Brandstätter', 3: 'Daniel Schwarz', 4: 'Roland Kerschbaumer', 6: 'Fabian Stickler', 7: 'Karl Ungersböck', 16: 'Patrick Hofer', 24: 'Elias Woltron' };

async function laufe(browser, g) {
  const fehler = [];
  let schritte = 0;
  const pruef = (ok, text) => { schritte++; if (!ok) { fehler.push(text); console.log('    ✗ ' + text); } };
  const s = await starte({ test: true });
  try {
    // Vorbereitung (API): Ausnahme kolonne für Mehmet (5), Abwesenheiten heute: 3 U (Testdaten), 4 K, 6 ZA, 24 K (Testdaten)
    const gf = s.client(); await gf.post('/auth/login', { benutzerId: U.gf, pin: '1234' });
    const buero = s.client(); await buero.post('/auth/login', { benutzerId: U.buero, pin: '1234' });
    if ((await gf.put('/rechte/ausnahme', { benutzerId: 5, recht: 'kolonne', wert: true })).status !== 200) throw new Error('Ausnahme kolonne');
    for (const [id, code] of [[4, 'K'], [6, 'ZA']]) if ((await buero.post('/abwesenheiten', { benutzerId: id, datum: TAG, code })).status !== 201) throw new Error(`Abwesenheit ${id}`);
    // heute in Pitten eingeplant und veröffentlicht: 24 (K, fremde Partie) und 16 (anwesend, fremde Partie)
    if ((await buero.post('/plan/einsaetze', { datum: TAG, baustelleId: BS.pitten, benutzerIds: [24, 16], beginn: '07:00' })).status !== 201) throw new Error('Einsatz');
    if ((await buero.post('/plan/veroeffentlichen', { von: TAG })).status !== 200) throw new Error('Veröffentlichen');

    async function sitzung(benutzerId, wo, f) {
      const ctx = await browser.newContext({ viewport: { width: g.width, height: g.height }, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: g.mobil, serviceWorkers: 'block' });
      await ctx.clock.install({ time: new Date(START) });
      const page = await ctx.newPage();
      const netz = [], gesperrt = [], konsole = [];
      page.on('response', async (r) => {
        const u = r.url(); if (!u.startsWith(s.basis + '/api/')) return;
        if ([401, 403].includes(r.status())) gesperrt.push(`${r.request().method()} ${u.slice(s.basis.length)} → ${r.status()}`);
        if (/\/api\/zeit\/kolonne/.test(u)) { try { netz.push(await r.text()); } catch (e) { /* Seite schon weiter */ } }
      });
      page.on('console', (m) => { if (m.type() === 'error' && !/status of 409/.test(m.text())) konsole.push(m.text().slice(0, 140)); }); // 409 = erwartete Ablehnung (eigene Stempelung)
      page.on('pageerror', (e) => konsole.push(String(e.message).slice(0, 140)));
      await page.goto(s.basis + '/#/login', { waitUntil: 'domcontentloaded' });
      const st = await page.evaluate(async (bid) => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ benutzerId: bid, pin: '1234' }) })).status, benutzerId);
      if (st !== 200) throw new Error(`Anmeldung ${benutzerId}: ${st}`);
      await page.evaluate(() => localStorage.setItem('bt_ich', '{}'));
      await page.goto(`${s.basis}/?start=${benutzerId}#/`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#nav-seite .nav-item, #view', { state: 'attached' });
      const geh = async (h) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {}); await page.waitForTimeout(150); };
      const ich = await page.evaluate(async () => (await fetch('/api/auth/ich')).json());
      try { await f({ page, geh, ich, netz }); } finally {
        pruef(gesperrt.length === 0, `${wo}/${g.name}: 401/403 in der Oberfläche: ${gesperrt.slice(0, 4).join(' | ')}`);
        pruef(konsole.length === 0, `${wo}/${g.name}: Konsolenfehler: ${konsole.slice(0, 3).join(' | ')}`);
        const alles = netz.join('\n');
        pruef(!/kolonneMoeglich/.test(alles), `${wo}/${g.name}: Kolonne liefert noch „kolonneMoeglich“ (F-032/F-034/F-045)`);
        pruef(!/kann heute nicht über die Kolonne/.test(alles), `${wo}/${g.name}: Kolonne liefert den Sperrtext, der nur bei Abwesenheit kommt (F-013/F-018/F-032)`);
        await ctx.close();
      }
    }
    const zeileHtml = (page, name) => page.locator(`.crew-row:has-text("${name}")`).evaluate((el) => {
      const c = el.cloneNode(true); c.querySelector('.crew-txt b').textContent = ''; c.querySelectorAll('.avatar, [class*="avatar"]').forEach((a) => a.remove());
      c.querySelectorAll('input').forEach((i) => i.removeAttribute('data-ma'));
      return c.innerHTML;
    });
    const optionen = (page) => page.locator('#kol-bs option').evaluateAll((l) => l.map((o) => Number(o.value)));

    /* ---- 1) Polier ---- */
    await sitzung(U.polier, 'Polier', async ({ page, geh, ich }) => {
      await geh('/kolonne');
      await page.waitForSelector('#kol-liste .crew-row');
      const erlaubt = (await (await page.evaluate(async () => (await fetch('/api/baustellen')).json()))).filter((b) => b.status === 'aktiv' && ich.baustellenIds.includes(b.id)).map((b) => b.id);
      pruef(JSON.stringify(await optionen(page)) === JSON.stringify(erlaubt), `Polier/${g.name}: Baustellenauswahl ${JSON.stringify(await optionen(page))} statt ${JSON.stringify(erlaubt)} (F-033)`);
      // Abwesende (3 U, 4 K) sehen aus wie Anwesende (2)
      const muster = await zeileHtml(page, NAME[2]);
      for (const id of [3, 4]) pruef(await zeileHtml(page, NAME[id]) === muster, `Polier/${g.name}: Zeile von ${NAME[id]} unterscheidet sich von einer anwesenden Person (F-032/F-045)`);
      for (const id of [3, 4, 2]) await page.locator(`.crew-row:has-text("${NAME[id]}") .check`).click();
      await page.click('[data-typ="kommen"]');
      await page.click('#kol-los');
      await page.waitForSelector('.toast');
      const toast = await page.locator('.toast').first().innerText();
      pruef(/^3 Personen gebucht\.$/.test(toast.trim()), `Polier/${g.name}: Rückmeldung „${toast}“ statt „3 Personen gebucht.“`);
      await page.waitForSelector(`.crew-row:has-text("${NAME[2]}") .chip:has-text("gebucht")`);
      for (const id of [3, 4, 2]) pruef(await page.locator(`.crew-row:has-text("${NAME[id]}") .chip:has-text("gebucht")`).count() === 1, `Polier/${g.name}: ${NAME[id]} nicht gebucht (F-032)`);
      pruef(await page.locator('.crew-err').count() === 0, `Polier/${g.name}: Fehlerzeile nach der Kolonnen-Buchung`);
      // aus „Meine Partie“: eingeplante Gäste – abwesend (24) und anwesend (16) – sind gleich vorausgewählt (F-034)
      await geh(`/kolonne?plan=1&baustelleId=${BS.pitten}`);
      await page.waitForSelector(`.crew-row:has-text("${NAME[16]}")`);
      const an = async (id) => page.locator(`.crew-row:has-text("${NAME[id]}") input[type="checkbox"]`).isChecked();
      pruef(await an(16) && await an(24), `Polier/${g.name}: Vorauswahl aus dem Plan hängt von Abwesenheit ab (16: ${await an(16)}, 24: ${await an(24)}) (F-034)`);
      pruef(await zeileHtml(page, NAME[24]) === await zeileHtml(page, NAME[16]), `Polier/${g.name}: eingeplante abwesende Person sieht anders aus als eine anwesende (F-034)`);
      if (!(await an(24))) await page.locator(`.crew-row:has-text("${NAME[24]}") .check`).click();
      if (!(await an(16))) await page.locator(`.crew-row:has-text("${NAME[16]}") .check`).click();
      await page.click('#kol-los');
      await page.waitForSelector(`.crew-row:has-text("${NAME[16]}") .chip:has-text("gebucht")`);
      pruef(await page.locator(`.crew-row:has-text("${NAME[24]}") .chip:has-text("gebucht")`).count() === 1, `Polier/${g.name}: eingeplante abwesende Person nicht gebucht (F-034)`);
    });

    /* ---- 2) Mitarbeiter mit Ausnahme „kolonne“ (F-033) ---- */
    await sitzung(5, 'Mitarbeiter+kolonne', async ({ page, geh, ich }) => {
      await geh('/kolonne');
      await page.waitForSelector('#kol-bs');
      const opts = await optionen(page);
      const erlaubt = (await page.evaluate(async () => (await fetch('/api/baustellen')).json())).filter((b) => b.status === 'aktiv' && ich.baustellenIds.includes(b.id)).map((b) => b.id);
      pruef(JSON.stringify(opts) === JSON.stringify(erlaubt) && JSON.stringify(opts) === JSON.stringify([BS.pitten]), `Mitarbeiter+kolonne/${g.name}: Baustellenauswahl ${JSON.stringify(opts)} statt ${JSON.stringify(erlaubt)} (F-033: fremde Baustellen)`);
      for (const id of opts) {
        await page.selectOption('#kol-bs', String(id));
        await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
        await page.waitForSelector('#kol-liste .crew-row, #kol-liste .state, .card .state', { timeout: 8000 }).catch(() => {});
        pruef(!(await page.locator('#view').innerText()).includes('gehört nicht zu Ihrer Partie'), `Mitarbeiter+kolonne/${g.name}: Baustelle ${id} → „gehört nicht zu Ihrer Partie“ (F-033)`);
      }
      // 6 (ZA) und 7 (anwesend) – gleiche Darstellung, beide gebucht
      pruef(await zeileHtml(page, NAME[6]) === await zeileHtml(page, NAME[7]), `Mitarbeiter+kolonne/${g.name}: Zeile mit ZA unterscheidet sich (F-013)`);
      for (const id of [6, 7]) await page.locator(`.crew-row:has-text("${NAME[id]}") .check`).click();
      await page.click('#kol-los');
      await page.waitForSelector(`.crew-row:has-text("${NAME[7]}") .chip:has-text("gebucht")`);
      pruef(await page.locator(`.crew-row:has-text("${NAME[6]}") .chip:has-text("gebucht")`).count() === 1 && await page.locator('.crew-err').count() === 0, `Mitarbeiter+kolonne/${g.name}: abwesende Person nicht wie anwesende gebucht (F-013)`);
    });

    /* ---- 3) Eigene Stempelung bei eigenem Urlaub (28, U laut Testdaten) ---- */
    await sitzung(28, 'Eigene Stempelung', async ({ page, geh }) => {
      await geh('/stempeln');
      await page.waitForSelector('[data-stempel="kommen"]');
      await page.click('[data-stempel="kommen"]');
      await page.waitForSelector('.toast');
      const t = (await page.locator('.toast').first().innerText()).trim();
      pruef(t === 'Für diesen Tag ist Urlaub eingetragen – Einstempeln nicht möglich. Bitte im Büro klären.', `Eigene Stempelung/${g.name}: Meldung „${t}“`);
      pruef((await page.locator('.clock-card').getAttribute('data-status')) === 'aus', `Eigene Stempelung/${g.name}: trotz Urlaub eingestempelt`);
    });

    /* ---- 4) Büro: Hinweis und Monatswarnung ---- */
    await sitzung(U.buero, 'Büro', async ({ page, geh }) => {
      await page.click('#glocke');
      await page.waitForSelector('#notif-panel #notif-inhalt :is(.notif, .state.empty)');
      const txt = await page.locator('#notif-panel').innerText();
      for (const id of [3, 4, 6, 24]) pruef(txt.includes(`Stempelung trotz eingetragener Abwesenheit: ${NAME[id]}, 12.11.2026 – bitte klären`), `Büro/${g.name}: Hinweis für ${NAME[id]} fehlt in den Benachrichtigungen`);
      pruef(!txt.includes(`Abwesenheit: ${NAME[2]},`) && !txt.includes(`Abwesenheit: ${NAME[16]},`), `Büro/${g.name}: Hinweis für eine anwesende Person`);
      await page.click('#notif-panel [data-zu]');
      await geh('/monat?monat=2026-11');
      await page.waitForSelector('li[data-warn-typ="abwesenheit_mit_stunden"]');
      for (const id of [3, 4, 6]) pruef(await page.locator(`li[data-warn-typ="abwesenheit_mit_stunden"]:has-text("${NAME[id]}"):has-text("Stempelung")`).count() >= 1, `Büro/${g.name}: Monatswarnung „abwesenheit_mit_stunden“ für ${NAME[id]} fehlt`);
    });
  } finally { await s.stop(); }
  return { fehler, schritte };
}

module.exports = { laufe, GROESSEN };

if (require.main === module) {
  (async () => {
    const browser = await chromium.launch();
    let gesamt = 0;
    for (const g of GROESSEN.filter((x) => !process.env.E2E_NUR || process.env.E2E_NUR.split(',').includes(x.name))) {
      console.log(`\n▶ Kolonne ${g.name} (${g.width}×${g.height})`);
      const t = Date.now();
      const r = await laufe(browser, g);
      gesamt += r.fehler.length;
      console.log(`${r.fehler.length ? '✗' : '✓'} ${g.name}: ${r.schritte - r.fehler.length}/${r.schritte} Prüfungen bestanden (${((Date.now() - t) / 1000).toFixed(1)} s)`);
    }
    await browser.close();
    process.exit(gesamt ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(2); });
}
