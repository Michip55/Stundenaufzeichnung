'use strict';
/**
 * Vordefinierte Pausen (API.md 15.22, Inhaber 17.11.2026) in der Oberfläche.
 *   node tests/e2e/pausen.js        (im Ordner app; E2E_NUR=handy|tablet|pc; Exit-Code 1 bei Befunden)
 * Wird auch von run.js je Bildschirmgröße aufgerufen (abschaltbar mit E2E_OHNE_PAUSEN=1).
 *
 * Server mit gesteuerter Uhr (tests/api/hilfe.js), Browser mit Playwright-Uhr; „Zeit vergeht“ = Server-Uhr vorstellen,
 * dann die Browser-Uhr mit fastForward nachziehen (Zeitgeber der Seite laufen dabei ab).
 *  1. Mitarbeiter, Stempeluhr: „Pause“ bietet 30 Min · 45 Min · 60 Min · offen; mit 30 Min zeigt die Uhr „Pause bis …“ und
 *     schaltet nach Ablauf ohne Tippen auf „Arbeitszeit läuft“ (Zeitleiste „Pause beendet – automatisch“, Server: Buchung
 *     genau zum geplanten Ende); 45 Min früher beenden; „offen“ läuft weiter; ohne Netz: Pause mit 30 Min, Ende ohne Netz
 *     angezeigt, nach dem Nachsenden am Server mit den richtigen Zeiten.
 *  2. Büro: Stammdaten → „Vordefinierte Pausen“ ändert die Auswahl, die Stempeluhr bietet sie an.
 *  3. Polier, Kolonne: „Alle in Pause“ mit derselben Auswahl – je Person „Pause bis …“, nach Ablauf wieder eingestempelt.
 */
const { chromium } = require('playwright');
const { starte, U, BS } = require('../api/hilfe');

const GROESSEN = [
  { name: 'handy', width: 390, height: 844, mobil: true },
  { name: 'tablet', width: 1180, height: 820, mobil: true },
  { name: 'pc', width: 1440, height: 900, mobil: false }
];
const TAG = '2026-11-18'; // Mi – nach den Testdaten
const um = (hm) => new Date(`${TAG}T${hm}:00+01:00`);
const hm = (iso) => new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
const NAME = { 1: 'Josef Haidbauer', 2: 'Lukas Brandstätter', 3: 'Daniel Schwarz', 4: 'Roland Kerschbaumer', 101: 'Martina Koller' };

async function laufe(browser, g) {
  const fehler = [];
  let schritte = 0;
  const pruef = (ok, text) => { schritte++; if (!ok) { fehler.push(`Pausen/${g.name}: ${text}`); console.log(`    ✗ Pausen/${g.name}: ${text}`); } };
  const s = await starte({ test: true });
  try {
    s.db.lauf(`DELETE FROM buchung WHERE benutzer_id IN (1, 2, 3, 4) AND zeit >= '2026-11-10'`);
    s.db.lauf('DELETE FROM abwesenheit WHERE datum = ?', TAG);
    s.uhr.setze(um('07:00').toISOString());
    const buchungen = (id) => s.db.alle('SELECT typ, zeit, quelle, automatisch FROM buchung WHERE benutzer_id = ? AND zeit >= ? ORDER BY zeit, id', id, um('00:00').toISOString());

    async function sitzung(benutzerId, wo, f) {
      const ctx = await browser.newContext({ viewport: { width: g.width, height: g.height }, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: g.mobil, serviceWorkers: 'block' });
      await ctx.clock.install({ time: s.uhr() });
      const page = await ctx.newPage();
      page.setDefaultTimeout(10000);
      const konsole = [];
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) konsole.push(m.text().slice(0, 160)); });
      page.on('pageerror', (e) => konsole.push(String(e.message).slice(0, 160)));
      // über die Anmeldeseite (Standard „Eigenes Handy“, 15.21) – sonst sperrt die App nach 30 Min ohne Bedienung (geteiltes Gerät)
      const name = NAME[benutzerId];
      await page.goto(s.basis + '/#/login');
      await page.waitForSelector('.login-user');
      await page.fill('#login-suche', name.split(' ')[1]);
      await page.click(`.login-user:has-text("${name}")`);
      await page.waitForSelector('.pin-pad');
      for (const z of '1234') await page.click(`.pin-pad [data-z="${z}"]`);
      await page.click('.pin-pad [data-ok]');
      await page.waitForSelector('#view');
      await page.waitForFunction(() => !document.querySelector('#view .view-box > .state .spinner, #root > .state .spinner'), null, { timeout: 10000 });
      const geh = async (h) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForFunction((x) => location.hash === x, h); await page.waitForFunction(() => !document.querySelector('#view .view-box > .state .spinner'), null, { timeout: 10000 }); await page.waitForTimeout(150); };
      // „Zeit vergeht“: Server-Uhr = Browser-Uhr + min, dann die Browser-Uhr nachziehen (Zeitgeber laufen ab)
      const vergeht = async (min) => {
        const jetzt = await page.evaluate(() => Date.now());
        s.uhr.setze(new Date(jetzt + min * 60000).toISOString());
        await page.clock.fastForward(min * 60000);
      };
      const gleich = async () => s.uhr.setze(new Date(await page.evaluate(() => Date.now())).toISOString());
      try { await f({ page, ctx, geh, vergeht, gleich }); } finally {
        pruef(konsole.length === 0, `${wo}: Konsolenfehler: ${konsole.slice(0, 3).join(' | ')}`);
        await ctx.close();
      }
    }
    const pauseDialog = async (page) => {
      await page.waitForSelector('dialog[open] #pause-wahl');
      return (await page.locator('dialog[open] #pause-wahl [data-pause-min] b').allInnerTexts()).map((x) => x.trim());
    };

    /* ---- 1) Mitarbeiter: Stempeluhr ---- */
    await sitzung(U.mitarbeiter, 'Stempeluhr', async ({ page, ctx, geh, vergeht, gleich }) => {
      await geh('#/stempeln');
      await page.waitForSelector('.clock-card[data-status="aus"] [data-stempel="kommen"]');
      await gleich();
      await page.click('[data-stempel="kommen"]');
      await page.waitForSelector('.clock-card[data-status="arbeit"]');
      await vergeht(5 * 60); // 12:00
      // a) Auswahl und automatisches Ende
      await page.click('[data-stempel="pause_start"]');
      const opt = await pauseDialog(page);
      pruef(JSON.stringify(opt) === JSON.stringify(['30 Min', '45 Min', '60 Min', 'offen']), `Auswahl „${opt.join(' · ')}“ statt „30 Min · 45 Min · 60 Min · offen“`);
      await gleich();
      await page.click('dialog[open] [data-pause-min="30"]');
      await page.waitForSelector('.clock-card[data-status="pause"] #pause-bis');
      let st = await page.evaluate(async () => (await fetch('/api/zeit/status')).json());
      pruef(st.status === 'pause' && st.pauseDauerMin === 30 && st.pauseBis, `Server nach „30 Min“: ${st.status} ${st.pauseBis}`);
      const bisText = (await page.locator('#pause-bis').innerText()).replace(/\s+/g, ' ');
      pruef(bisText.includes(`Pause bis ${hm(st.pauseBis)}`), `Anzeige „${bisText}“ statt „Pause bis ${hm(st.pauseBis)}“`);
      const geplant = st.pauseBis;
      await vergeht(31); // niemand tippt etwas
      await page.waitForSelector('.clock-card[data-status="arbeit"]', { timeout: 8000 });
      await page.waitForSelector('.timeline li[data-automatisch]', { timeout: 8000 });
      const zeile = (await page.locator('.timeline li[data-automatisch]').first().innerText()).replace(/\s+/g, ' ');
      pruef(zeile.includes(hm(geplant)) && /Pause beendet – automatisch/.test(zeile), `Zeitleiste „${zeile}“ (erwartet „${hm(geplant)} Pause beendet – automatisch“)`);
      let b = buchungen(U.mitarbeiter);
      const ende = b.find((x) => x.typ === 'pause_ende');
      pruef(ende && ende.zeit === geplant && ende.automatisch === 1, `Server: automatisches Ende ${ende && ende.zeit} statt ${geplant}`);
      const runState = (await page.locator('.clock-card .run-state').innerText()).replace(/\s+/g, ' ');
      pruef(runState.includes(`seit ${hm(geplant)}`), `Uhr zeigt „${runState}“ statt „Arbeitszeit läuft seit ${hm(geplant)}“`);
      // b) 45 Min, nach 10 Min „Pause beenden“
      await vergeht(30);
      await page.click('[data-stempel="pause_start"]');
      await pauseDialog(page);
      await gleich();
      await page.click('dialog[open] [data-pause-min="45"]');
      await page.waitForSelector('.clock-card[data-status="pause"] #pause-bis');
      await vergeht(10);
      await page.waitForTimeout(300);
      await gleich();
      await page.click('[data-stempel="pause_ende"]');
      await page.waitForSelector('.clock-card[data-status="arbeit"]');
      await vergeht(60);
      b = buchungen(U.mitarbeiter);
      const p2 = b.filter((x) => x.typ === 'pause_ende');
      pruef(p2.length === 2 && p2[1].automatisch === 0, `früheres Ende: ${JSON.stringify(p2)}`);
      st = await page.evaluate(async () => (await fetch('/api/zeit/status')).json());
      pruef(st.status === 'arbeit' && Math.abs(st.heute.pauseMin - 40) <= 1, `Tagessumme Pause ${st.heute.pauseMin} statt 40 min`);
      const summe = (await page.locator('.sum-grid').innerText()).replace(/\s+/g, ' ');
      await page.reload(); await page.waitForSelector('.clock-card[data-status="arbeit"]');
      const summe2 = (await page.locator('.sum-grid').innerText()).replace(/\s+/g, ' ');
      pruef(/Pause (39|40|41) min/.test(summe2), `Stempeluhr „Heute“: „${summe2}“ (vorher „${summe}“)`);
      // c) offen: läuft weiter
      await page.click('[data-stempel="pause_start"]');
      await pauseDialog(page);
      await gleich();
      await page.click('dialog[open] [data-pause-min="offen"]');
      await page.waitForSelector('.clock-card[data-status="pause"] #pause-bis');
      pruef(/Pause offen/.test(await page.locator('#pause-bis').innerText()), 'offen: Anzeige „Pause offen“ fehlt');
      await vergeht(90);
      await page.waitForTimeout(1500);
      pruef((await page.locator('.clock-card').getAttribute('data-status')) === 'pause', 'offen: Pause nach 90 Min von selbst beendet');
      await gleich();
      await page.click('[data-stempel="pause_ende"]');
      await page.waitForSelector('.clock-card[data-status="arbeit"]');
      // d) ohne Netz: Pause 30 Min, Ende ohne Netz angezeigt, nach dem Nachsenden richtig am Server
      await vergeht(20);
      await ctx.setOffline(true);
      await page.click('[data-stempel="pause_start"]');
      await pauseDialog(page);
      const beginnOffline = await page.evaluate(() => Date.now());
      await page.click('dialog[open] [data-pause-min="30"]');
      await page.waitForSelector('#sync[data-ausstehend="1"]');
      await page.waitForSelector('.clock-card[data-status="pause"] #pause-bis');
      const q = await page.evaluate(() => JSON.parse(localStorage.getItem('bt_stempel_queue') || '[]'));
      pruef(q.length === 1 && q[0].typ === 'pause_start' && q[0].dauerMin === 30, `Offline: Warteschlange ${JSON.stringify(q)}`);
      await vergeht(35);
      await page.waitForSelector('.clock-card[data-status="arbeit"]', { timeout: 8000 });
      pruef(await page.locator('.timeline li[data-automatisch]').count() >= 1, 'Offline: automatisches Ende nicht in der Zeitleiste');
      await ctx.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('bt_stempel_queue') || '[]').length === 0, null, { timeout: 30000, polling: 200 });
      b = buchungen(U.mitarbeiter);
      const ps = b.filter((x) => x.typ === 'pause_start').at(-1), pe = b.filter((x) => x.typ === 'pause_ende').at(-1);
      pruef(ps && ps.quelle === 'offline' && Math.abs(new Date(ps.zeit).getTime() - beginnOffline) < 5000, `Offline: Pausenbeginn am Server ${ps && ps.zeit} (${ps && ps.quelle})`);
      pruef(pe && pe.automatisch === 1 && new Date(pe.zeit).getTime() - new Date(ps.zeit).getTime() === 30 * 60000, `Offline: Pausenende am Server ${pe && pe.zeit} (erwartet Beginn + 30 Min)`);
      st = await page.evaluate(async () => (await fetch('/api/zeit/status')).json());
      pruef(st.status === 'arbeit', `Offline: Serverstatus nach dem Nachsenden ${st.status}`);
    });

    /* ---- 2) Büro: Einstellung „Vordefinierte Pausen“ ---- */
    await sitzung(U.buero, 'Einstellung', async ({ page, geh }) => {
      await geh('#/preise');
      await page.click('#stamm-pausen');
      await page.waitForSelector('dialog[open] #pausen-auswahl');
      pruef((await page.inputValue('dialog[open] #pausen-auswahl')).replace(/\s/g, '') === '30,45,60', 'Einstellung: Standard 30, 45, 60 nicht vorbelegt');
      await page.fill('dialog[open] #pausen-auswahl', '15, 300');
      await page.click('dialog[open] #pausen-ok');
      await page.waitForSelector('dialog[open] #pausen-err:not([hidden])');
      await page.fill('dialog[open] #pausen-auswahl', '20, 40');
      await page.click('dialog[open] #pausen-ok');
      await page.waitForSelector('dialog[open] #pausen-auswahl', { state: 'detached' });
      const e = await page.evaluate(async () => (await fetch('/api/einstellungen/pausen')).json());
      pruef(JSON.stringify(e.auswahl) === '[20,40]', `Einstellung gespeichert: ${JSON.stringify(e.auswahl)}`);
    });
    await sitzung(3, 'Stempeluhr mit geänderter Auswahl', async ({ page, geh, gleich }) => {
      await geh('#/stempeln');
      await gleich();
      await page.click('[data-stempel="kommen"]');
      await page.waitForSelector('.clock-card[data-status="arbeit"]');
      await page.click('[data-stempel="pause_start"]');
      const opt = await pauseDialog(page);
      pruef(JSON.stringify(opt) === JSON.stringify(['20 Min', '40 Min', 'offen']), `geänderte Auswahl „${opt.join(' · ')}“`);
      await page.click('dialog[open] [data-zu]');
      await gleich();
      await page.click('[data-stempel="gehen"]');
      await page.waitForSelector('.clock-card[data-status="aus"]');
    });
    s.db.setzeEinstellung('pausen', { auswahl: [30, 45, 60] });

    /* ---- 3) Polier: Kolonne „Alle in Pause“ ---- */
    const crew = [1, 3, 4];
    await sitzung(U.polier, 'Kolonne', async ({ page, geh, vergeht, gleich }) => {
      await gleich();
      const r = await page.evaluate(async (ids) => (await fetch('/api/zeit/kolonne', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ typ: 'kommen', baustelleId: 1, benutzerIds: ids }) })).json(), crew);
      if (!r.ergebnisse || !r.ergebnisse.every((x) => x.ok)) throw new Error('Kolonne kommen: ' + JSON.stringify(r));
      await geh(`#/kolonne?baustelleId=${BS.pitten}`);
      await page.waitForSelector('#kol-liste .crew-row');
      if (Number(await page.inputValue('#kol-bs')) !== BS.pitten) { await page.selectOption('#kol-bs', String(BS.pitten)); await page.waitForTimeout(400); }
      await page.click('#kol-alle-pause');
      const opt = await pauseDialog(page);
      pruef(JSON.stringify(opt) === JSON.stringify(['30 Min', '45 Min', '60 Min', 'offen']), `Kolonne: Auswahl „${opt.join(' · ')}“`);
      const titel = await page.locator('dialog[open] h2').innerText();
      pruef(/Pause für [1-9]\d* Personen/.test(titel), `Kolonne: Dialogtitel „${titel}“`);
      await gleich();
      await page.click('dialog[open] [data-pause-min="45"]');
      await page.waitForSelector('.toast');
      const t = (await page.locator('.toast').first().innerText()).trim();
      pruef(/gebucht \(Pause 45 Min\)\.$/.test(t), `Kolonne: Rückmeldung „${t}“`);
      for (const id of crew) {
        await page.waitForSelector(`.crew-row:has-text("${NAME[id]}") [data-pause-bis]`);
        const chip = await page.locator(`.crew-row:has-text("${NAME[id]}") [data-pause-bis]`).innerText();
        const bis = await page.locator(`.crew-row:has-text("${NAME[id]}") [data-pause-bis]`).getAttribute('data-pause-bis');
        pruef(chip.trim() === `gebucht · Pause bis ${hm(bis)}`, `Kolonne: ${NAME[id]} zeigt „${chip}“`);
        const b = buchungen(id).at(-1);
        pruef(b.typ === 'pause_start' && b.quelle === 'kolonne', `Kolonne: ${NAME[id]} letzte Buchung ${b.typ}/${b.quelle}`);
      }
      const bis = await page.locator(`.crew-row:has-text("${NAME[1]}") [data-pause-bis]`).getAttribute('data-pause-bis');
      await vergeht(46);
      await page.waitForFunction(() => !document.querySelector('.crew-row [data-pause-bis]'), null, { timeout: 8000 }).catch(() => {});
      pruef(await page.locator('.crew-row [data-pause-bis]').count() === 0, 'Kolonne: nach Ablauf noch „Pause bis …“ in der Liste');
      for (const id of crew) {
        const e = buchungen(id).at(-1);
        pruef(e.typ === 'pause_ende' && e.automatisch === 1 && e.zeit === bis && e.quelle === 'kolonne', `Kolonne: ${NAME[id]} Ende ${e.typ} ${e.zeit} (erwartet ${bis}, automatisch)`);
        const c = (await page.locator(`.crew-row:has-text("${NAME[id]}") .chip`).allInnerTexts()).join(' ');
        pruef(c.startsWith('eingestempelt seit ' + hm(bis)), `Kolonne: ${NAME[id]} nach Ablauf „${c}“ statt „eingestempelt seit ${hm(bis)}“`);
      }
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
      console.log(`\n▶ Pausen ${g.name} (${g.width}×${g.height})`);
      const t = Date.now();
      const r = await laufe(browser, g);
      gesamt += r.fehler.length;
      console.log(`${r.fehler.length ? '✗' : '✓'} ${g.name}: ${r.schritte - r.fehler.length}/${r.schritte} Prüfungen bestanden (${((Date.now() - t) / 1000).toFixed(1)} s)`);
    }
    await browser.close();
    process.exit(gesamt ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(2); });
}
