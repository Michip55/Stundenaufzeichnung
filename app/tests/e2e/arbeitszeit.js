'use strict';
/**
 * Arbeitszeitmodelle und BUAK-Pflicht je Person (API.md 15.23, Inhaber 17.11.2026) in der Oberfläche.
 *   node tests/e2e/arbeitszeit.js   (im Ordner app; E2E_NUR=handy|tablet|pc; Exit-Code 1 bei Befunden)
 * Wird auch von run.js je Bildschirmgröße aufgerufen (abschaltbar mit E2E_OHNE_ARBEITSZEIT=1).
 *  1. Büro: Stammdaten & Preise → „Arbeitszeitmodelle“ – Prüfung (Summe der Tage ≠ Wochenstunden), neues Modell
 *     „Teilzeit 20 Std.“ (Mo–Do 5, nur Woche, Vollzeit 39) anlegen, steht in der Tabelle.
 *  2. Büro: Benutzer & Rechte → Lukas bearbeiten → Arbeitszeitmodell „Teilzeit 20 Std.“ ab 02.11.2026 (rückwirkend,
 *     bestätigt), BUAK-pflichtig aus → Verlauf am Server.
 *  3. Büro: Monatsauswertung November – Lukas zeigt das Modell und Mehrstunden (gleich der API); Hinweis nennt die Modelle;
 *     BUAK-Grundlage ohne Lukas.
 *  4. Mitarbeiter: „Meine Woche“ zeigt das eigene Soll (20 Std.), keinen Modellnamen; Stammdaten/Benutzer gesperrt.
 */
const { chromium } = require('playwright');
const { starte, U } = require('../api/hilfe');

const GROESSEN = [
  { name: 'handy', width: 390, height: 844, mobil: true },
  { name: 'tablet', width: 1180, height: 820, mobil: true },
  { name: 'pc', width: 1440, height: 900, mobil: false }
];
const NAME = { 2: 'Lukas Brandstätter', 101: 'Martina Koller' };
const MODELL = 'Teilzeit 20 Std.';

async function laufe(browser, g) {
  const fehler = [];
  let schritte = 0;
  const pruef = (ok, text) => { schritte++; if (!ok) { fehler.push(`Arbeitszeit/${g.name}: ${text}`); console.log(`    ✗ Arbeitszeit/${g.name}: ${text}`); } };
  const s = await starte({ test: true });
  try {
    async function sitzung(benutzerId, wo, f) {
      const ctx = await browser.newContext({ viewport: { width: g.width, height: g.height }, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: g.mobil, serviceWorkers: 'block', acceptDownloads: true });
      await ctx.clock.install({ time: s.uhr() });
      const page = await ctx.newPage();
      page.setDefaultTimeout(10000);
      const konsole = [];
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) konsole.push(m.text().slice(0, 160)); });
      page.on('pageerror', (e) => konsole.push(String(e.message).slice(0, 160)));
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
      const geh = async (h) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForFunction((x) => location.hash === x, h); await page.waitForFunction(() => !document.querySelector('#view .view-box > .state .spinner'), null, { timeout: 10000 }); await page.waitForTimeout(200); };
      const api = (pfad) => page.evaluate(async (p) => { const r = await fetch('/api' + p); let j = null; try { j = await r.json(); } catch (e) { /* kein JSON */ } return { status: r.status, json: j }; }, pfad);
      try { await f({ page, ctx, geh, api }); } finally {
        pruef(konsole.length === 0, `${wo}: Konsolenfehler: ${konsole.slice(0, 3).join(' | ')}`);
        await ctx.close();
      }
    }

    /* ---- 1) Büro: Modell anlegen ---- */
    await sitzung(U.buero, 'Modell anlegen', async ({ page, geh }) => {
      await geh('#/preise');
      await page.click('#tab-arbeitszeit');
      await page.waitForSelector('#az-tabelle');
      const zeilen = await page.locator('#az-tabelle tbody tr').count();
      pruef(zeilen === 3, `Grundausstattung: ${zeilen} Modelle statt 3`);
      pruef(await page.locator('#az-tabelle tr:has-text("Bau-Arbeiter (KV Bau)") [data-az-woche]').innerText() === '39', 'KV Bau: 39 Std./Woche');
      await page.click('#az-neu');
      await page.waitForSelector('dialog[open] #azf');
      await page.fill('dialog[open] [name="name"]', MODELL);
      await page.fill('dialog[open] [name="wochenstunden"]', '20');
      for (const k of ['mo', 'di', 'mi', 'do']) await page.fill(`dialog[open] [name="t_${k}"]`, '5');
      await page.fill('dialog[open] [name="t_fr"]', '1');
      await page.selectOption('dialog[open] [name="regel"]', 'woche');
      await page.fill('dialog[open] [name="vollzeit"]', '39');
      const summe = await page.locator('dialog[open] #az-summe').innerText();
      pruef(/21/.test(summe) && /muss 20/.test(summe), `Summe live: „${summe}“`);
      await page.click('dialog[open] #az-ok');
      await page.waitForSelector('dialog[open] [data-az-fehler="stunden"]:not([hidden])');
      pruef(/21/.test(await page.locator('dialog[open] [data-az-fehler="stunden"]').innerText()), 'Fehler „Summe der Tage“ nicht angezeigt');
      await page.fill('dialog[open] [name="t_fr"]', '');
      await page.click('dialog[open] #az-ok');
      await page.waitForSelector('dialog[open] #azf', { state: 'detached' });
      await page.waitForSelector(`#az-tabelle tr:has-text("${MODELL}")`);
      const vz = await page.locator(`#az-tabelle tr:has-text("${MODELL}") td[data-th="Vollzeit"]`).innerText();
      pruef(/39/.test(vz) && /Mehrstunden/.test(vz), `Vollzeit-Spalte „${vz}“`);
      const m = s.db.eins('SELECT * FROM arbeitszeitmodell WHERE name = ?', MODELL);
      pruef(m && m.wochenstunden === 20 && m.tag_normal === '[0,5,5,5,5,0,0]' && m.regel === 'woche' && m.vollzeit === 39, `Modell am Server ${JSON.stringify(m)}`);
    });
    const modellId = (s.db.eins('SELECT id FROM arbeitszeitmodell WHERE name = ?', MODELL) || {}).id;

    /* ---- 2) Büro: Lukas zuordnen (Stichtag, rückwirkend bestätigt), BUAK aus ---- */
    await sitzung(U.buero, 'Zuordnung', async ({ page, geh }) => {
      await geh('#/benutzer');
      await page.click(`[data-bearb="${U.mitarbeiter}"]`);
      await page.waitForSelector('dialog[open] #az-wahl');
      pruef(await page.locator('dialog[open] #az-wahl option:checked').innerText() === 'Bau-Arbeiter (KV Bau)', 'Vorgabe Mitarbeiter: KV Bau nicht gewählt');
      pruef(await page.locator('dialog[open] #buak-pflichtig').isChecked(), 'Vorgabe Mitarbeiter: BUAK-pflichtig nicht gesetzt');
      pruef(await page.locator('dialog[open] #az-ab-box').isHidden(), '„gültig ab“ vor der Auswahl sichtbar');
      await page.selectOption('dialog[open] #az-wahl', String(modellId));
      await page.waitForSelector('dialog[open] #az-ab-box:not([hidden])');
      pruef(/20 Std\.\/Woche/.test(await page.locator('dialog[open] #az-kurz').innerText()), 'Kurzbeschreibung des Modells fehlt');
      await page.fill('dialog[open] #az-ab', '2026-11-02');
      await page.waitForSelector('dialog[open] #az-rueck:not([hidden])');
      // Schalter „BUAK-pflichtig“ (verstecktes Kontrollkästchen in der Schalterzeile)
      await page.click('dialog[open] #buak-zeile');
      pruef(!(await page.locator('dialog[open] #buak-pflichtig').isChecked()), 'BUAK-Schalter lässt sich nicht ausschalten');
      await page.click('dialog[open] button[type="submit"][form="bf"]');
      await page.waitForSelector('dialog[open] [data-ok]');
      pruef(/rückwirkend/.test(await page.locator('dialog[open] h2').last().innerText()), 'keine Rückfrage „rückwirkend“');
      await page.click('dialog[open] [data-ok]');
      await page.waitForSelector('dialog[open] #bf', { state: 'detached' });
      const v = s.db.alle('SELECT modell_id, gueltig_ab FROM benutzer_arbeitszeitmodell WHERE benutzer_id = ? ORDER BY gueltig_ab', U.mitarbeiter);
      pruef(JSON.stringify(v) === JSON.stringify([{ modell_id: 1, gueltig_ab: '2000-01-01' }, { modell_id: modellId, gueltig_ab: '2026-11-02' }]), `Verlauf am Server ${JSON.stringify(v)}`);
      pruef(s.db.eins('SELECT buak_pflichtig FROM benutzer WHERE id = ?', U.mitarbeiter).buak_pflichtig === 0, 'BUAK-Kennzeichen nicht gespeichert');
      await page.waitForSelector(`[data-benutzer="${U.mitarbeiter}"]:has-text("${MODELL}")`);
      // Verlauf im Dialog
      await page.click(`[data-bearb="${U.mitarbeiter}"]`);
      await page.waitForSelector('dialog[open] #az-verlauf li');
      const vt = await page.locator('dialog[open] #az-verlauf').innerText();
      pruef(vt.includes(MODELL) && vt.includes('02.11.2026') && vt.includes('von Anfang an'), `Verlauf im Dialog „${vt.replace(/\s+/g, ' ')}“`);
      await page.click('dialog[open] [data-zu]');
    });

    /* ---- 3) Büro: Monatsauswertung zeigt Mehrstunden ---- */
    await sitzung(U.buero, 'Monatsauswertung', async ({ page, geh, api }) => {
      await geh('#/monat?monat=2026-11');
      await page.waitForSelector(`tr[data-ma="${U.mitarbeiter}"]`);
      const d = (await api('/monat?monat=2026-11')).json;
      const lukas = d.mitarbeiter.find((x) => x.id === U.mitarbeiter);
      pruef(lukas && lukas.mehrstunden > 0, `API: Lukas ohne Mehrstunden ${JSON.stringify(lukas && [lukas.summe, lukas.ueberstunden, lukas.mehrstunden])}`);
      const zelle = (await page.locator(`tr[data-ma="${U.mitarbeiter}"] [data-mehr]`).innerText()).trim();
      const erwartet = lukas.mehrstunden.toLocaleString('de-AT', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
      pruef(zelle === erwartet, `Spalte „Mehr“: „${zelle}“ statt „${erwartet}“`);
      const name = await page.locator(`tr[data-ma="${U.mitarbeiter}"] [data-az-name]`).innerText();
      pruef(name.trim() === MODELL, `Modell unter dem Namen: „${name}“`);
      pruef(await page.locator(`tr[data-ma="${U.mitarbeiter}"] [data-az-name]`).isVisible(), 'Modellname nicht sichtbar');
      pruef(await page.locator('#az-wechsel').count() === 1 && /Bau-Arbeiter \(KV Bau\).*Teilzeit 20 Std\./s.test(await page.locator('#az-wechsel').innerText()), 'Abschnitt „Wechsel des Arbeitszeitmodells“ fehlt');
      pruef(/Mehrstunden/.test(await page.locator('#kpi-ue').locator('xpath=..').innerText()), 'Kennzahl Mehrstunden fehlt');
      pruef(/Arbeitszeitmodell/.test(await page.locator('#view').innerText()), 'Hinweis nennt die Arbeitszeitmodelle nicht');
      const th = await page.locator('table.matrix thead th[title="Mehrstunden (Teilzeit)"]').count();
      pruef(th === 1, 'Spaltenkopf „Mehr“ fehlt');
      const buak = await page.evaluate(async () => (await fetch('/api/monat/buak.csv?monat=2026-11')).text());
      pruef(!buak.split('\r\n').some((z) => z.startsWith('1002;')) && buak.includes('Enthält nur BUAK-pflichtige'), 'BUAK-Grundlage enthält Lukas trotz „nicht BUAK-pflichtig“');
    });

    /* ---- 4) Mitarbeiter: eigenes Soll in „Meine Woche“, keine Modelle anderer ---- */
    await sitzung(U.mitarbeiter, 'Meine Woche', async ({ page, geh, api }) => {
      await geh('#/woche?datum=2026-11-09');
      await page.waitForSelector('#woche-soll');
      const t = await page.locator('#woche-soll').innerText();
      pruef(/Soll laut Arbeitszeitmodell: 20 Std\./.test(t), `Soll „${t}“`);
      pruef(!(await page.locator('#view').innerText()).includes(MODELL), 'Modellname in „Meine Woche“');
      for (const p of ['/arbeitszeitmodelle', '/benutzer', `/benutzer/${U.mitarbeiter}/arbeitszeit-verlauf`]) {
        const r = await api(p);
        pruef(r.status === 403 && !JSON.stringify(r.json).includes('Teilzeit'), `${p}: ${r.status}`);
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
      console.log(`\n▶ Arbeitszeit ${g.name} (${g.width}×${g.height})`);
      const t = Date.now();
      const r = await laufe(browser, g);
      gesamt += r.fehler.length;
      console.log(`${r.fehler.length ? '✗' : '✓'} ${g.name}: ${r.schritte - r.fehler.length}/${r.schritte} Prüfungen bestanden (${((Date.now() - t) / 1000).toFixed(1)} s)`);
    }
    await browser.close();
    process.exit(gesamt ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(2); });
}
