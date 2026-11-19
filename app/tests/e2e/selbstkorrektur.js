'use strict';
/**
 * Oberfläche zu API.md 15.29 (Selbstkorrektur durch die GF, Inhaber 19.11.2026), je Bildschirmgröße:
 *   node tests/e2e/selbstkorrektur.js      (im Ordner app; E2E_NUR=handy|tablet|pc; Exit-Code 1 bei Befunden)
 * Eigener Server mit eigener Datenbank im Speicher und freiem Port (tests/api/hilfe.js). Wird auch von run.js aufgerufen
 * (abschaltbar mit E2E_OHNE_SELBSTKORREKTUR=1).
 *
 *  1. GF: „Zeiten korrigieren“ bietet den eigenen Namen „(eigene Zeiten)“ an (nicht vorgewählt); für die eigenen Zeiten zeigen
 *     alle Dialoge (Schicht nachtragen, Buchung nachtragen/ändern/löschen, Schicht löschen) den Hinweis
 *     „Eigene Zeiten – wird im Protokoll als Selbstkorrektur vermerkt.“; Grund bleibt Pflicht.
 *  2. Nach dem Speichern tragen Schicht und Buchungen das Kennzeichen „Selbstkorrektur GF“, ebenso Benutzer → Protokoll.
 *  3. GF für eine andere Person: kein Hinweis, kein Kennzeichen.
 *     Ist die GF die einzige wählbare Person (ohne gemerkte Wahl), sind ihre eigenen Zeiten gewählt und geladen.
 *  4. Büro: der eigene Name steht nicht zur Wahl, die Adresse mit der eigenen ID zeigt eine andere Person, der Server lehnt ab (403).
 *     Das Büro sieht an den Zeiten der GF das Kennzeichen.
 */
const { chromium } = require('playwright');
const { starte, U, START } = require('../api/hilfe');

const GROESSEN = [
  { name: 'handy', width: 390, height: 844, mobil: true },
  { name: 'tablet', width: 1180, height: 820, mobil: true },
  { name: 'pc', width: 1440, height: 900, mobil: false }
];
const HINWEIS = 'Eigene Zeiten – wird im Protokoll als Selbstkorrektur vermerkt.';
const ZUSATZ = '(Selbstkorrektur durch GF – Vier-Augen-Prinzip nicht eingehalten)';

async function laufe(browser, g) {
  const fehler = [];
  let schritte = 0;
  const pruef = (ok, text) => { schritte++; if (!ok) { fehler.push(text); console.log('    ✗ ' + text); } };
  const s = await starte({ test: true, sitzung: { feldMin: 60 * 24 * 60, bueroMin: 60 * 24 * 60, maxH: 24 * 60 } });
  try {
    async function sitzung(benutzerId, wo, f, erlaubt = /^$/) {
      const ctx = await browser.newContext({ viewport: { width: g.width, height: g.height }, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: g.mobil, serviceWorkers: 'block' });
      await ctx.clock.install({ time: new Date(START) });
      const page = await ctx.newPage();
      const konsole = [];
      page.on('console', (m) => { if (m.type() === 'error' && !erlaubt.test(m.text())) konsole.push(m.text().slice(0, 160)); });
      page.on('pageerror', (e) => konsole.push(String(e.message).slice(0, 160)));
      await page.goto(s.basis + '/#/login', { waitUntil: 'domcontentloaded' });
      const st = await page.evaluate(async (bid) => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ benutzerId: bid, pin: '1234' }) })).status, benutzerId);
      if (st !== 200) throw new Error(`Anmeldung ${benutzerId}: ${st}`);
      await page.evaluate(() => localStorage.setItem('bt_ich', '{}'));
      await page.goto(`${s.basis}/?start=${benutzerId}#/`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#nav-seite .nav-item, #view', { state: 'attached' });
      const geh = async (h) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {}); await page.waitForTimeout(250); };
      const listeGeladen = async () => { await page.waitForFunction(() => { const a = document.querySelector('#k-liste'), b = document.querySelector('#k-schichten'); return a && b && !a.querySelector('.spinner, [data-laden], .laden') && !b.querySelector('.spinner, [data-laden], .laden'); }, null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(250); };
      const api = (methode, pfad, body) => page.evaluate(async ([m, p, b]) => {
        const r = await fetch('/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: m === 'GET' ? undefined : JSON.stringify(b || {}) });
        let j = null; try { j = await r.json(); } catch (e) { /* kein JSON */ }
        return { status: r.status, json: j };
      }, [methode, pfad, body]);
      const ueberlauf = async (wo2) => { const d = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); pruef(d <= 1, `${wo2}/${g.name}: horizontaler Überlauf (${d} px)`); };
      try { await f({ page, geh, listeGeladen, api, ueberlauf }); } finally {
        pruef(konsole.length === 0, `${wo}/${g.name}: Konsolenfehler: ${konsole.slice(0, 3).join(' | ')}`);
        await ctx.close();
      }
    }
    const dlg = (page) => page.locator('dialog.dlg[open]').last();
    const hinweisIm = async (page) => (await dlg(page).locator('#k-selbst-hinweis').count()) === 1 && (await dlg(page).innerText()).includes(HINWEIS);

    // 1–3: Geschäftsführung
    await sitzung(U.gf, 'GF', async ({ page, geh, listeGeladen, api, ueberlauf }) => {
      await geh('/korrektur');
      await listeGeladen();
      const opt = page.locator(`#k-ma option[value="${U.gf}"]`);
      pruef(await opt.count() === 1, `GF/${g.name}: eigener Name fehlt in der Auswahl`);
      pruef(/\(eigene Zeiten\)/.test(await opt.innerText().catch(() => '')), `GF/${g.name}: eigener Name ohne „(eigene Zeiten)“`);
      pruef(Number(await page.locator('#k-ma').inputValue()) !== U.gf, `GF/${g.name}: eigene Zeiten sind vorgewählt (soll eine andere Person sein)`);
      pruef(/selbst korrigieren/.test(await page.locator('#view .banner').first().innerText()), `GF/${g.name}: Hinweis oben nennt die Selbstkorrektur nicht`);

      // 3) andere Person: kein Hinweis im Dialog
      await page.locator('#k-schicht').click();
      await page.waitForSelector('#sf', { timeout: 5000 });
      pruef(!(await hinweisIm(page)) && await dlg(page).locator('#k-selbst-hinweis').count() === 0, `GF/${g.name}: Hinweis „Eigene Zeiten“ bei einer anderen Person`);
      await dlg(page).locator('[data-zu]').first().click();
      await page.waitForTimeout(200);

      // 1) eigene Zeiten wählen
      await page.selectOption('#k-ma', String(U.gf));
      await listeGeladen();
      pruef(await page.locator('#k-schichtliste li').count() === 0, `GF/${g.name}: GF hat schon Schichten (Testvoraussetzung)`);
      // Schicht nachtragen: Hinweis, Grund Pflicht
      await page.locator('#k-schicht').click();
      await page.waitForSelector('#sf', { timeout: 5000 });
      pruef(await hinweisIm(page), `GF/${g.name}: Schicht nachtragen ohne Hinweis „${HINWEIS}“`);
      await ueberlauf('GF Schicht-Dialog');
      await page.locator('#sf [name="datum"]').fill('2026-11-10');
      await page.locator('#sf [name="von"]').fill('07:00');
      await page.locator('#sf [name="bis"]').fill('15:00');
      await page.locator('#sf [name="pauseMin"]').fill('30');
      await dlg(page).locator('button[type="submit"]').click();
      await page.waitForTimeout(300);
      pruef(/Grund/.test(await dlg(page).locator('.form-err').innerText().catch(() => '')), `GF/${g.name}: ohne Grund nicht abgelehnt`);
      await page.locator('#sf [name="grund"]').fill('Stempeln vergessen');
      await dlg(page).locator('button[type="submit"]').click();
      await page.waitForSelector('#sf', { state: 'detached', timeout: 6000 }).catch(() => {});
      await listeGeladen();
      // 2) Kennzeichen an Schicht und Buchungen
      pruef(await page.locator('#k-schichtliste li[data-schicht] [data-selbstkorrektur]').count() === 1, `GF/${g.name}: Schicht ohne Kennzeichen „Selbstkorrektur GF“`);
      pruef(await page.locator('#k-liste li[data-buchung] [data-selbstkorrektur]').count() === 4, `GF/${g.name}: nicht alle 4 Buchungen mit Kennzeichen (${await page.locator('#k-liste li[data-buchung] [data-selbstkorrektur]').count()})`);
      pruef(/Selbstkorrektur GF/.test(await page.locator('#k-schichtliste').innerText().catch(() => '')), `GF/${g.name}: Text „Selbstkorrektur GF“ fehlt`);
      await ueberlauf('GF Korrekturliste');

      // Buchung nachtragen (Wechsel) – Hinweis
      await page.locator('#k-neu').click();
      await page.waitForSelector('#kf', { timeout: 5000 });
      pruef(await hinweisIm(page), `GF/${g.name}: Buchung nachtragen ohne Hinweis`);
      await dlg(page).locator('[data-zu]').first().click();
      await page.waitForTimeout(200);
      // Buchung ändern (Gehen 15:00 → 15:30) – Hinweis, speichern
      const gehen = page.locator('#k-liste li[data-buchung]').filter({ hasText: 'Gehen' }).first();
      await gehen.locator('[data-aendern]').click();
      await page.waitForSelector('#kf', { timeout: 5000 });
      pruef(await hinweisIm(page), `GF/${g.name}: Buchung ändern ohne Hinweis`);
      await page.locator('#kf [name="zeit"]').fill('2026-11-10T15:30');
      await page.locator('#kf [name="grund"]').fill('länger gearbeitet');
      await dlg(page).locator('button[type="submit"]').click();
      await page.waitForSelector('#kf', { state: 'detached', timeout: 6000 }).catch(() => {});
      await listeGeladen();
      pruef(/15:30/.test(await page.locator('#k-schichtliste').innerText().catch(() => '')), `GF/${g.name}: geänderte Zeit 15:30 nicht in der Schicht`);
      // Buchung löschen – Hinweis (abbrechen, Löschen der Pause ergäbe eine ungültige Folge)
      await page.locator('#k-liste li[data-buchung] [data-loeschen]').first().click();
      await page.waitForSelector('#kf', { timeout: 5000 });
      pruef(await hinweisIm(page), `GF/${g.name}: Buchung löschen ohne Hinweis`);
      await dlg(page).locator('[data-zu]').first().click();
      await page.waitForTimeout(200);
      // Schicht löschen – Hinweis, löschen
      await page.locator('[data-schicht-weg]').first().click();
      await page.waitForSelector('#slf', { timeout: 5000 });
      pruef(await hinweisIm(page), `GF/${g.name}: Schicht löschen ohne Hinweis`);
      await page.locator('#slf [name="grund"]').fill('Probe wieder entfernt');
      await dlg(page).locator('button[type="submit"]').click();
      await page.waitForSelector('#slf', { state: 'detached', timeout: 6000 }).catch(() => {});
      await listeGeladen();
      pruef(await page.locator('#k-schichtliste li').count() === 0, `GF/${g.name}: Schicht nicht gelöscht`);

      // eine Schicht bleibt für die Gegenprobe des Büros stehen
      const bleibt = await api('POST', '/zeit/schichten', { benutzerId: U.gf, baustelleId: 1, datum: '2026-11-09', von: '07:00', bis: '12:00', pauseMin: 0, grund: 'bleibt für die Gegenprobe' });
      pruef(bleibt.status === 201 && bleibt.json.selbstkorrektur === true, `GF/${g.name}: Schicht über die API ${bleibt.status}`);

      // 2) Protokoll: Einträge mit Zusatz und Kennzeichen
      await geh('/benutzer');
      await page.locator('[data-tab="protokoll"]').click();
      await page.waitForSelector('#protokoll', { timeout: 6000 }).catch(() => {});
      const zeilen = page.locator('#protokoll li').filter({ hasText: ZUSATZ });
      pruef(await zeilen.count() === 4, `GF/${g.name}: Protokoll zeigt ${await zeilen.count()} statt 4 Selbstkorrekturen`);
      pruef(await page.locator('#protokoll li [data-selbstkorrektur]').count() === 4, `GF/${g.name}: Protokoll ohne Kennzeichen „Selbstkorrektur GF“`);
      await ueberlauf('GF Protokoll');

      // 1b) GF als einzige wählbare Person (frische Einrichtung, alle anderen inaktiv) und keine gemerkte Wahl:
      //     die eigenen Zeiten sind gewählt und geladen, die Dialoge zeigen Namen und Hinweis
      await page.evaluate(() => localStorage.removeItem('bt_korr_ma'));
      await page.route('**/api/mitarbeiter', async (route) => {
        const antwort = await route.fetch();
        const alle = await antwort.json();
        await route.fulfill({ response: antwort, json: alle.filter((m) => m.id === U.gf) });
      });
      await geh('/korrektur?von=2026-11-01&bis=2026-11-12');
      await listeGeladen();
      pruef(await page.locator('#k-ma option').count() === 1, `GF allein/${g.name}: Auswahl hat ${await page.locator('#k-ma option').count()} statt 1 Eintrag`);
      pruef(Number(await page.locator('#k-ma').inputValue()) === U.gf, `GF allein/${g.name}: eigene Zeiten nicht gewählt`);
      pruef(!/Keine Mitarbeiter vorhanden/.test(await page.locator('#view').innerText()), `GF allein/${g.name}: „Keine Mitarbeiter vorhanden.“ obwohl die GF gewählt ist`);
      pruef(await page.locator('#k-schichtliste li[data-schicht] [data-selbstkorrektur]').count() === 1, `GF allein/${g.name}: eigene Schicht nicht geladen`);
      await page.locator('#k-schicht').click();
      await page.waitForSelector('#sf', { timeout: 5000 });
      const kopf = await dlg(page).innerText();
      pruef(/Ganze Schicht nachtragen – \S/.test(kopf), `GF allein/${g.name}: Dialog ohne Namen`);
      pruef(await hinweisIm(page), `GF allein/${g.name}: Dialog ohne Hinweis „${HINWEIS}“`);
      await dlg(page).locator('[data-zu]').first().click();
      await page.waitForTimeout(200);
      await page.unroute('**/api/mitarbeiter');
    });

    // 3) GF korrigiert eine andere Person über die Oberfläche: kein Kennzeichen
    const fremd = await (await s.login(U.gf)).post('/zeit/schichten', { benutzerId: 3, baustelleId: 1, datum: '2026-11-07', von: '07:00', bis: '12:00', pauseMin: 0, grund: 'Kolonne vergessen' });
    pruef(fremd.status === 201 && fremd.daten.selbstkorrektur === undefined, `GF/${g.name}: fremde Schicht ${fremd.status} bzw. mit Kennzeichen`);
    const prot = s.db.eins("SELECT text FROM protokoll WHERE art = 'zeitkorrektur' ORDER BY id DESC LIMIT 1");
    pruef(prot && !prot.text.includes('Selbstkorrektur'), `GF/${g.name}: fremde Korrektur im Protokoll als Selbstkorrektur: ${prot && prot.text}`);

    // 4) Büro: eigene Zeiten bleiben gesperrt, Kennzeichen an den Zeiten der GF sichtbar
    await sitzung(U.buero, 'Büro', async ({ page, geh, listeGeladen, api }) => {
      await geh('/korrektur');
      await listeGeladen();
      pruef(await page.locator(`#k-ma option[value="${U.buero}"]`).count() === 0, `Büro/${g.name}: eigener Name steht zur Wahl`);
      pruef(/Die eigenen Zeiten korrigiert immer eine andere Person/.test(await page.locator('#view .banner').first().innerText()), `Büro/${g.name}: Hinweis „andere Person“ fehlt`);
      await geh(`/korrektur?benutzerId=${U.buero}&von=2026-11-01&bis=2026-11-12`);
      await listeGeladen();
      pruef(Number(await page.locator('#k-ma').inputValue()) !== U.buero, `Büro/${g.name}: Adresse mit eigener ID wählt die eigenen Zeiten`);
      const r = await api('POST', '/zeit/schichten', { benutzerId: U.buero, baustelleId: 1, datum: '2026-11-09', von: '07:00', bis: '15:00', pauseMin: 30, grund: 'eigene Zeit' });
      pruef(r.status === 403 && /Vier-Augen-Prinzip/.test((r.json && r.json.fehler) || ''), `Büro/${g.name}: eigene Schicht ${r.status} statt 403`);
      // Zeiten der GF: Kennzeichen sichtbar, im Dialog kein Hinweis (es sind nicht die eigenen)
      await geh(`/korrektur?benutzerId=${U.gf}&von=2026-11-01&bis=2026-11-12`);
      await listeGeladen();
      pruef(Number(await page.locator('#k-ma').inputValue()) === U.gf, `Büro/${g.name}: GF nicht gewählt`);
      pruef(await page.locator('#k-schichtliste li[data-schicht] [data-selbstkorrektur]').count() === 1, `Büro/${g.name}: Schicht der GF ohne Kennzeichen`);
      pruef(await page.locator('#k-liste li[data-buchung] [data-selbstkorrektur]').count() === 2, `Büro/${g.name}: Buchungen der GF ohne Kennzeichen`);
      await page.locator('#k-schicht').click();
      await page.waitForSelector('#sf', { timeout: 5000 });
      pruef(await dlg(page).locator('#k-selbst-hinweis').count() === 0, `Büro/${g.name}: Hinweis „Eigene Zeiten“ bei den Zeiten der GF`);
      await dlg(page).locator('[data-zu]').first().click();
    }, /status of 403/); // 403 = erwartete Ablehnung der eigenen Korrektur
  } finally {
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
      console.log(`▶ ${g.name}`);
      const r = await laufe(browser, g);
      gesamt += r.fehler.length;
      console.log(`  ${r.schritte - r.fehler.length}/${r.schritte} Prüfungen bestanden`);
    }
    await browser.close();
    process.exit(gesamt ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
