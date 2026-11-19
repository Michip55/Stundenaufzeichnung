'use strict';
/**
 * Oberfläche zu API.md 15.34 (Bautagesbericht löschen mit Papierkorb, Inhaber 19.11.2026), je Bildschirmgröße:
 *   node tests/e2e/papierkorb.js      (im Ordner app; E2E_NUR=handy|tablet|pc; Exit-Code 1 bei Befunden)
 * Eigener Server mit eigener Datenbank im Speicher und freiem Port (tests/api/hilfe.js). Wird auch von run.js aufgerufen
 * (abschaltbar mit E2E_OHNE_PAPIERKORB=1).
 *
 *  1. Polier und Mitarbeiter (ohne Recht bericht_loeschen): kein „Bericht löschen“, kein „Papierkorb“, die Adresse
 *     #/berichte/papierkorb zeigt „Seite nicht verfügbar“ – beim Mitarbeiter auch mit bericht_loeschen in der Matrix.
 *  2. Büro: unterschriebener Bericht → „Bericht löschen“ → Dialog mit Baustelle, Datum, Status und Warnung „bereits
 *     unterschrieben“; „Bericht löschen“ erst ab 5 Zeichen Begründung; danach Liste ohne den Bericht, Hinweis mit Frist.
 *  3. Papierkorb (aus der Liste erreichbar): Eintrag mit Grund, „gelöscht von“, „Endgültig weg am …“; Wiederherstellen →
 *     Bericht wieder in der Liste. Gibt es inzwischen einen neuen Bericht für den Tag: Knopf gesperrt, Hinweis mit Verweis.
 *     Steht eine Person inzwischen zur selben Zeit in einem anderen Bericht (Prüfung 19.11.2026): ebenso gesperrt, Hinweis
 *     mit Name, Tag und Kostenstelle.
 *  4. Bauleiter (= Büro) sieht dieselben Knöpfe; Freigegebener Bericht: Warnung „freigegeben“ im Dialog.
 * Ohne horizontalen Überlauf (Seite und Dialog), ohne Konsolenfehler.
 */
const { chromium } = require('playwright');
const { starte, U, START } = require('../api/hilfe');

const GROESSEN = [
  { name: 'handy', width: 390, height: 844, mobil: true },
  { name: 'tablet', width: 1180, height: 820, mobil: true },
  { name: 'pc', width: 1440, height: 900, mobil: false }
];
const GRUND = 'Doppelt angelegt – richtiger Bericht ist der von Josef';

async function laufe(browser, g) {
  const fehler = [];
  let schritte = 0;
  const pruef = (ok, text) => { schritte++; if (!ok) { fehler.push(`Papierkorb/${g.name}: ${text}`); console.log(`    ✗ Papierkorb/${g.name}: ${text}`); } };
  const s = await starte({ test: true, sitzung: { feldMin: 60 * 24 * 60, bueroMin: 60 * 24 * 60, maxH: 24 * 60 } });
  try {
    const db = s.db;
    const unterschrieben = db.eins("SELECT id, datum, baustelle_id FROM bericht WHERE baustelle_id = 1 AND status = 'unterschrieben' ORDER BY datum DESC");
    const freigegeben = db.eins("SELECT id, datum FROM bericht WHERE baustelle_id = 1 AND status = 'freigegeben' ORDER BY datum DESC");
    const bsName = db.eins('SELECT name FROM baustelle WHERE id = 1').name;

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
      const geh = async (h) => {
        await page.evaluate((x) => { location.hash = x; }, h);
        await page.waitForFunction(() => !document.querySelector('#view .spinner'), null, { timeout: 8000 }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
        await page.waitForTimeout(250);
      };
      const api = (methode, pfad, body) => page.evaluate(async ([m, p, b]) => {
        const r = await fetch('/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: m === 'GET' ? undefined : JSON.stringify(b || {}) });
        let j = null; try { j = await r.json(); } catch (e) { /* kein JSON */ }
        return { status: r.status, json: j };
      }, [methode, pfad, body]);
      const ueberlauf = async (wo2) => {
        const d = await page.evaluate(() => {
          const v = document.getElementById('view');
          const dl = [...document.querySelectorAll('dialog[open]')].map((x) => Math.max(x.scrollWidth - x.clientWidth, x.getBoundingClientRect().right - window.innerWidth));
          return Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, v ? v.scrollWidth - v.clientWidth : 0, ...dl);
        });
        pruef(d <= 1, `${wo2}: horizontaler Überlauf (${d} px)`);
      };
      try { await f({ page, geh, api, ueberlauf }); } finally {
        pruef(konsole.length === 0, `${wo}: Konsolenfehler: ${konsole.slice(0, 3).join(' | ')}`);
        await ctx.close();
      }
    }
    const dlg = (page) => page.locator('dialog.dlg[open]').last();

    // 1) Polier und Mitarbeiter: nichts zu sehen, Papierkorb gesperrt – beim Mitarbeiter auch dann, wenn die Matrix ihm
    //    bericht_loeschen gibt (Prüfung 19.11.2026: wirkt nur mit erstellen oder freigeben)
    db.lauf("INSERT OR REPLACE INTO rolle_recht (rolle, recht, wert) VALUES ('mitarbeiter', 'bericht_loeschen', 1)");
    for (const [id, wer] of [[U.polier, 'Polier'], [U.mitarbeiter, 'Mitarbeiter']]) {
      await sitzung(id, wer, async ({ page, geh, api }) => {
        if (id === U.polier) {
          await geh('/berichte');
          pruef(await page.locator('#papierkorb').count() === 0, `${wer}: Knopf „Papierkorb“ in der Liste`);
          await geh(`/bericht/${unterschrieben.id}`);
          pruef(await page.locator('.bform').count() === 1, `${wer}: Bericht nicht geöffnet`);
          pruef(await page.locator('#bericht-loeschen').count() === 0, `${wer}: Knopf „Bericht löschen“ sichtbar`);
        }
        await geh('/berichte/papierkorb');
        pruef(await page.locator('[data-zustand="kein-zugriff"]').count() === 1, `${wer}: Papierkorb nicht gesperrt`);
        pruef((await api('GET', '/berichte/papierkorb')).status === 403, `${wer}: GET /berichte/papierkorb nicht 403`);
      }, /status of 403/);
    }
    db.lauf("DELETE FROM rolle_recht WHERE rolle = 'mitarbeiter' AND recht = 'bericht_loeschen'");

    // 2) + 3) Büro: löschen, Papierkorb, wiederherstellen, Konflikt mit neuem Bericht
    await sitzung(U.buero, 'Büro', async ({ page, geh, api, ueberlauf }) => {
      await geh(`/bericht/${unterschrieben.id}`);
      const knopf = page.locator('#bericht-loeschen');
      pruef(await knopf.count() === 1 && await knopf.isVisible(), 'Knopf „Bericht löschen“ fehlt');
      pruef((await knopf.innerText()).includes('Bericht löschen'), 'Knopftext nicht „Bericht löschen“');
      await ueberlauf('Bericht');
      await knopf.click();
      await page.waitForSelector('dialog[open] #bl', { timeout: 5000 });
      const d = dlg(page);
      const kopf = await d.locator('[data-loesch-kopf]').innerText();
      pruef(kopf.includes(bsName) && kopf.includes('26-041'), `Dialog ohne Baustelle/KST: ${kopf}`);
      const [jj, mm, tt] = unterschrieben.datum.split('-');
      pruef(kopf.includes(`${Number(tt)}.`) && kopf.includes(jj) && /Unterschrieben/.test(kopf), `Dialog ohne Datum/Status: ${kopf} (${tt}.${mm}.)`);
      pruef(/bereits unterschrieben/.test(await d.innerText()), 'Warnung „bereits unterschrieben“ fehlt');
      pruef(/30 Tage/.test(await d.innerText()), 'Hinweis auf 30 Tage Papierkorb fehlt');
      pruef(await d.locator('#bl-ok').isDisabled(), '„Bericht löschen“ ohne Begründung aktiv');
      await d.locator('textarea').fill('abc');
      pruef(await d.locator('#bl-ok').isDisabled(), '„Bericht löschen“ mit 3 Zeichen aktiv');
      await d.locator('textarea').fill(GRUND);
      pruef(!(await d.locator('#bl-ok').isDisabled()), '„Bericht löschen“ mit Begründung gesperrt');
      await ueberlauf('Dialog Bericht löschen');
      await d.locator('#bl-ok').click();
      await page.waitForFunction(() => location.hash === '#/berichte', null, { timeout: 5000 }).catch(() => {});
      await page.waitForFunction(() => !document.querySelector('#liste .spinner'), null, { timeout: 8000 }).catch(() => {});
      pruef(await page.evaluate(() => location.hash) === '#/berichte', 'nach dem Löschen nicht in der Liste');
      const toastText = await page.locator('.toast').first().innerText().catch(() => '');
      pruef(/Papierkorb bis \d{2}\.\d{2}\.\d{4}/.test(toastText), `Hinweis nach dem Löschen: „${toastText}“`);
      pruef(await page.locator(`a.rep-row[href="#/bericht/${unterschrieben.id}"]`).count() === 0, 'gelöschter Bericht noch in der Liste');
      pruef(Boolean(db.eins('SELECT geloescht_zeit FROM bericht WHERE id = ?', unterschrieben.id).geloescht_zeit), 'Server: nicht gelöscht');

      // Papierkorb aus der Liste
      await page.locator('#papierkorb').click();
      await page.waitForFunction(() => location.hash === '#/berichte/papierkorb');
      await page.waitForSelector(`[data-pk="${unterschrieben.id}"]`, { timeout: 8000 }).catch(() => {});
      await ueberlauf('Papierkorb');
      const zeile = page.locator(`[data-pk="${unterschrieben.id}"]`);
      const zt = await zeile.innerText().catch(() => '');
      pruef(zt.includes(GRUND), 'Papierkorb: Grund fehlt');
      pruef(/Gelöscht am .* von Martina Koller/s.test(zt), `Papierkorb: „gelöscht von“ fehlt (${zt.slice(0, 120)})`);
      pruef(/Endgültig weg am\s+\d{2}\.\d{2}\.\d{4}/.test(zt), 'Papierkorb: „Endgültig weg am …“ fehlt');
      await zeile.locator('[data-wieder]').click();
      await page.waitForFunction((id) => !document.querySelector(`[data-pk="${id}"]`), unterschrieben.id, { timeout: 8000 }).catch(() => {});
      pruef(await page.locator(`[data-pk="${unterschrieben.id}"]`).count() === 0, 'nach Wiederherstellen noch im Papierkorb');
      pruef(db.eins('SELECT geloescht_zeit FROM bericht WHERE id = ?', unterschrieben.id).geloescht_zeit === null, 'Server: nicht wiederhergestellt');
      pruef(await page.locator('[data-zustand], .state.empty').filter({ hasText: 'Der Papierkorb ist leer.' }).count() === 1, 'leerer Papierkorb ohne Hinweis');
      await geh('/berichte');
      pruef(await page.locator(`a.rep-row[href="#/bericht/${unterschrieben.id}"]`).count() === 1, 'wiederhergestellter Bericht nicht in der Liste');

      // Konflikt: löschen, neuer Bericht für denselben Tag → Wiederherstellen gesperrt mit Hinweis
      const v = (await api('GET', `/berichte/${unterschrieben.id}`)).json.version;
      pruef((await api('POST', `/berichte/${unterschrieben.id}/loeschen`, { grund: 'Falsche Baustelle gewählt', version: v })).status === 200, 'Löschen über die API');
      const neu = await api('POST', '/berichte', { baustelleId: 1, datum: unterschrieben.datum });
      pruef(neu.status === 201, `neuer Bericht für denselben Tag: ${neu.status}`);
      await geh('/berichte/papierkorb');
      const z2 = page.locator(`[data-pk="${unterschrieben.id}"]`);
      pruef(await z2.locator('[data-wieder]').isDisabled().catch(() => false), 'Wiederherstellen trotz neuem Bericht möglich');
      pruef(await z2.locator('[data-pk-konflikt]').count() === 1, 'Hinweis „neuer Bericht für diesen Tag“ fehlt');
      pruef(await z2.locator(`a[href="#/bericht/${neu.json && neu.json.id}"]`).count() === 1, 'Verweis auf den neuen Bericht fehlt');
      await ueberlauf('Papierkorb mit Konflikt');
      // aufräumen: neuen Bericht löschen, alten wiederherstellen
      const v2 = (await api('GET', `/berichte/${neu.json.id}`)).json.version;
      await api('POST', `/berichte/${neu.json.id}/loeschen`, { grund: 'Test aufräumen', version: v2 });
      pruef((await api('POST', `/berichte/${unterschrieben.id}/wiederherstellen`, {})).status === 200, 'Wiederherstellen nach Löschen des neuen Berichts');

      // Prüfung 19.11.2026: Person steht inzwischen zur selben Zeit in einem anderen Bericht → gesperrt mit Hinweis
      const tag = '2026-10-13';
      db.lauf('DELETE FROM bericht WHERE datum = ?', tag);
      const pers = [{ gast: true, benutzerId: 3, von1: '07:00', bis1: '12:00', von2: '12:30', bis2: '16:00' }];
      const a = (await api('POST', '/berichte', { baustelleId: 1, datum: tag })).json;
      pruef((await api('PUT', `/berichte/${a.id}`, { version: a.version, personal: pers })).status === 200, 'Bericht A mit Personal');
      pruef((await api('POST', `/berichte/${a.id}/loeschen`, { grund: 'Falscher Tag erwischt', version: a.version + 1 })).status === 200, 'Bericht A löschen');
      const b = (await api('POST', '/berichte', { baustelleId: 2, datum: tag })).json;
      pruef((await api('PUT', `/berichte/${b.id}`, { version: b.version, personal: pers })).status === 200, 'Bericht B mit derselben Person');
      await geh('/berichte'); // gleiche Adresse lädt nicht neu
      await geh('/berichte/papierkorb');
      await page.waitForSelector(`[data-pk="${a.id}"]`, { timeout: 8000 }).catch(() => {});
      const z3 = page.locator(`[data-pk="${a.id}"]`);
      pruef(await z3.locator('[data-wieder]').isDisabled().catch(() => false), 'Wiederherstellen trotz Überschneidung möglich');
      const h3 = await z3.locator('[data-pk-konflikt="ueberschneidung"]').innerText().catch(() => '');
      pruef(/Daniel Schwarz steht am 13\.10\.2026 inzwischen im Bericht von 26-038/.test(h3), `Hinweis „Zeiten überschneiden sich“ fehlt: „${h3}“`);
      await ueberlauf('Papierkorb mit Überschneidung');
      // aufräumen
      await api('PUT', `/berichte/${b.id}`, { version: b.version + 1, personal: [] });
      pruef((await api('POST', `/berichte/${a.id}/wiederherstellen`, {})).status === 200, 'Wiederherstellen nach Klärung');
    });

    // 4) Bauleiter = Büro: Knopf sichtbar, freigegebener Bericht mit Warnung „freigegeben“
    await sitzung(U.bauleiter, 'Bauleiter', async ({ page, geh, ueberlauf }) => {
      await geh('/berichte');
      pruef(await page.locator('#papierkorb').count() === 1, 'Bauleiter: Knopf „Papierkorb“ fehlt (Bauleiter = Büro)');
      await geh(`/bericht/${freigegeben.id}`);
      pruef(await page.locator('#bericht-loeschen').count() === 1, 'Bauleiter: Knopf „Bericht löschen“ fehlt');
      await page.locator('#bericht-loeschen').click();
      await page.waitForSelector('dialog[open] #bl', { timeout: 5000 });
      pruef(/freigegeben/i.test(await dlg(page).locator('.banner').first().innerText().catch(() => '')), 'Bauleiter: Warnung „freigegeben“ fehlt');
      await ueberlauf('Bauleiter Dialog');
      await dlg(page).locator('[data-zu]').first().click();
      pruef(db.eins('SELECT geloescht_zeit FROM bericht WHERE id = ?', freigegeben.id).geloescht_zeit === null, 'Abbrechen hat gelöscht');
    });
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
