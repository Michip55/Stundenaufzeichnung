'use strict';
/**
 * Rechnungen erfassen „wie auf dem Papier“, Seite „Rechnungen“, Fälligkeiten (API.md 15.24, Inhaber 17.11.2026) in der Oberfläche.
 *   node tests/e2e/rechnungen.js            (im Ordner app; E2E_NUR=handy|tablet|pc; Exit-Code 1 bei Befunden)
 *   node tests/e2e/rechnungen.js --bilder <Ordner>   Bilder für den Inhaber (Handy 390, PC 1440, doppelte Auflösung)
 * Wird auch von run.js je Bildschirmgröße aufgerufen (abschaltbar mit E2E_OHNE_RECHNUNGEN=1).
 *  1. Büro: Rechnungen → „Neue Rechnung“ – sechs Abschnitte, Baustelle wählen (Empfänger wird vorbelegt), die Auer-Rechnung
 *     „Regieaufstellung 000/W26“ abschreiben (Reverse Charge, 3 % Skonto 21 Tage, Ziel 30 Tage): Vorschau der
 *     Zahlungsvereinbarungen wie in Auer; Abweichung Netto/USt/Brutto zeigt einen Hinweis und speichert nicht.
 *  2. Büro: Teilrechnung mit Deckungs- (5 %) UND Haftrücklass (€ 300, frei ab) – Vorschau und Server gleich.
 *     2b. „Zahlbetrag mit Skonto“ (15.26): Betrag nach Skonto laut Papier, Summenzeilen, Kontrolle Skonto %, Umrechnen beim
 *     Wechsel der Art, zu hoch → kein Speichern, Abweichung → Hinweis, Bearbeiten hin und zurück, Detail; 320 px ohne Überlauf.
 *  3. Büro: Seite „Rechnungen“ – Filter Baustelle, Status, Art, Zeitraum (gleich der Schnittstelle).
 *  4. Büro: Fälligkeiten (über die Übersicht „Rechnungen“) – Gruppen, „mit Skonto … bis“ / „ohne Skonto … bis“, Rücklass-Zeilen,
 *     Summen gleich GET /faelligkeiten; ruhig (keine Unterstreichung, kein Blau), kein seitlicher Überlauf.
 *  5. Polier und Mitarbeiter: Rechnungen/Fälligkeiten/Offene Posten gesperrt, keine Reiter, nichts davon in „Mehr“, kein €,
 *     Schnittstellen 403.
 *  6. 15.37: „Offene Posten“ und „Fälligkeiten“ sind Reiter von „Rechnungen“ – Menü (Seitenleiste, untere Leiste, „Mehr“) nur
 *     „Rechnungen“; Reiter wechseln, Leiste springt nicht, Zurück-Taste, alte Adressen #/offene-posten und #/faelligkeiten (neu
 *     geladen, auch mit ?status=), „Offen gesamt“ und Übersicht „Überfällig“ öffnen den passenden Reiter; Handy 390/360 px:
 *     Reiter in einer Zeile, mindestens 44 px hoch, kein Überlauf. Prüfbefunde: die Leiste steht schon während des Ladens
 *     (langsames Netz) und bei Serverfehler/„Keine Verbindung“ – dann mit „Erneut versuchen“ darunter, die anderen Reiter gehen.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { starte, U, BS } = require('../api/hilfe');

const GROESSEN = [
  { name: 'handy', width: 390, height: 844, mobil: true },
  { name: 'tablet', width: 1180, height: 820, mobil: true },
  { name: 'pc', width: 1440, height: 900, mobil: false }
];
const NAME = { [U.buero]: 'Martina Koller', [U.polier]: 'Josef Haidbauer', [U.mitarbeiter]: 'Lukas Brandstätter' };
const AUER = { nr: '000/W26', empfaenger: 'Handler Bau GmbH, Walter Handler Straße 1, 2853 Bad Schönau', zeichen: 'KSt.: 030/1643.00' };
const de = (iso) => iso.split('-').reverse().join('.');

async function laufe(browser, g, opt = {}) {
  const fehler = [];
  let schritte = 0;
  const pruef = (ok, text) => { schritte++; if (!ok) { fehler.push(`Rechnungen/${g.name}: ${text}`); console.log(`    ✗ Rechnungen/${g.name}: ${text}`); } };
  // Bilder: Uhr 20.05.2026 (Mittwoch) – die Auer-Rechnung vom 06.05. steht mit Skonto bis 27.05. in „Nächste Woche“
  const s = await starte({ test: true, ...(opt.bilder ? { start: '2026-05-20T07:30:00.000Z' } : {}) });
  const heute = opt.bilder ? '2026-05-20' : '2026-11-12';
  const reDatum = opt.bilder ? '2026-05-06' : '2026-11-06';
  const plus = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const shot = async (page, name) => { if (opt.bilder) { await page.waitForTimeout(250); await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove())); await page.screenshot({ path: path.join(opt.bilder, `${name}-${g.name}.png`), fullPage: /faelligkeiten/.test(name) }); } };
  try {
    async function sitzung(benutzerId, wo, f) {
      const ctx = await browser.newContext({ viewport: { width: g.width, height: g.height }, deviceScaleFactor: opt.bilder ? 2 : 1, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: g.mobil, serviceWorkers: 'block' });
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
      const api = (pfad, methode = 'GET', body) => page.evaluate(async ([p, m, b]) => { const r = await fetch('/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch (e) { /* kein JSON */ } return { status: r.status, json: j }; }, [pfad, methode, body]);
      const ueberlauf = async (wo2) => { const x = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth })); pruef(x.s <= x.c + 1, `${wo2}: seitlicher Überlauf (${x.s} > ${x.c})`); };
      try { await f({ page, ctx, geh, api, ueberlauf }); } finally {
        pruef(konsole.length === 0, `${wo}: Konsolenfehler: ${konsole.slice(0, 3).join(' | ')}`);
        await ctx.close();
      }
    }

    /* ---- 1–4) Büro ---- */
    await sitzung(U.buero, 'Büro', async ({ page, geh, api, ueberlauf }) => {
      const ternitz = (await api(`/baustellen/${BS.ternitz}`)).json;
      await geh('#/rechnungen');
      await page.waitForSelector('#rechnungen-seite');
      pruef(await page.locator('[data-nav="rechnungen"]').count() >= 1, 'Menüpunkt „Rechnungen“ fehlt');
      await page.click('#re-neu-alle');
      await page.waitForSelector('dialog[open] #ref');
      const titel = await page.locator('dialog[open] .re-h').allInnerTexts();
      pruef(titel.length === 6 && /Rechnung/.test(titel[0]) && /Auftraggeber/.test(titel[1]) && /Beträge/.test(titel[2]) && /Zahlungsbedingungen/.test(titel[3]) && /Rücklässe/.test(titel[4]) && /Anhang/.test(titel[5]), `Abschnitte: ${titel.join(' | ')}`);
      { const t = await page.locator('dialog[open] #ref').textContent(); pruef(/Rechnungs-Nr\. \(wie in Auer\)/.test(t) && !/wie in BMD/.test(t), 'Beschriftung „Rechnungs-Nr. (wie in Auer)“ fehlt'); }
      // keine versteckten Vorgaben: USt-Art, Zahlungsziel und Skonto leer, bis man sie einträgt
      pruef(await page.locator('#ref [name="ustModus"]:checked').count() === 0 && await page.inputValue('#ref [name="zahlungszielTage"]') === '' && await page.inputValue('#ref [name="skontoArt"]') === '', 'Neue Rechnung mit vorbelegter USt-Art/Zahlungsziel/Skonto');
      // zwei Spalten am PC, eine am Handy
      const spalten = await page.evaluate(() => getComputedStyle(document.querySelector('#ref .re-teil[data-teil="1"] .re-felder')).gridTemplateColumns.split(' ').length);
      pruef(g.width <= 719 ? spalten === 1 : spalten === 2, `Spalten im Abschnitt Rechnung: ${spalten}`);
      await page.selectOption('#ref [name="baustelle"]', String(BS.ternitz));
      await page.waitForTimeout(300);
      pruef(await page.inputValue('#ref [name="empfaenger"]') === `${ternitz.auftraggeber}, ${ternitz.agAdresse}`, `Empfänger nicht aus dem Auftraggeber vorbelegt („${await page.inputValue('#ref [name="empfaenger"]')}“)`);
      // (a) Abweichung: 20 %, Netto 1.000 → USt/Brutto vorbelegt; Brutto falsch abgeschrieben → Hinweis, nicht gespeichert
      await page.fill('#ref [name="nr"]', 'PROBE-ABW');
      await page.check('#ref [name="ustModus"][value="normal"]');
      await page.fill('#ref [name="netto"]', '1.000,00');
      pruef(await page.inputValue('#ref [name="ustBetrag"]') === '200,00' && await page.inputValue('#ref [name="brutto"]') === '1.200,00', `USt/Brutto nicht aus Netto vorbelegt (${await page.inputValue('#ref [name="ustBetrag"]')} / ${await page.inputValue('#ref [name="brutto"]')})`);
      pruef(await page.locator('#re-papier [data-papier="ok"]').count() === 1, 'kein „passt“-Hinweis bei stimmigen Beträgen');
      await page.fill('#ref [name="brutto"]', '1.250,00');
      await page.waitForSelector('#re-papier [data-papier="abweichung"]');
      pruef(/Brutto passt nicht/.test(await page.locator('#re-papier').innerText()), `Abweichungs-Hinweis: ${await page.locator('#re-papier').innerText()}`);
      await page.fill('#ref [name="zahlungszielTage"]', '30');
      let posts = 0;
      const zaehle = (r) => { if (r.method() === 'POST' && /\/rechnungen$/.test(r.url())) posts++; };
      page.on('request', zaehle);
      await page.click('#re-ok');
      await page.waitForSelector('#ref .form-err:not([hidden])');
      pruef(posts === 0 && /Brutto passt nicht/.test(await page.locator('#ref .form-err').innerText()), `bei Abweichung gespeichert oder ohne klaren Hinweis (${posts} Anfragen)`);
      page.off('request', zaehle);
      // (b) die Auer-Rechnung abschreiben
      await page.fill('#ref [name="nr"]', AUER.nr);
      await page.selectOption('#ref [name="typ"]', 'regie');
      await page.fill('#ref [name="datum"]', reDatum);
      await page.fill('#ref [name="leistungVon"]', plus(reDatum, -6)); await page.fill('#ref [name="leistungBis"]', plus(reDatum, -2));
      await page.fill('#ref [name="empfaenger"]', AUER.empfaenger);
      await page.fill('#ref [name="agZeichen"]', AUER.zeichen);
      await page.check('#ref [name="ustModus"][value="reverse_charge"]');
      await page.fill('#ref [name="netto"]', '1.775,75');
      await page.fill('#ref [name="brutto"]', '1.775,75');
      pruef(await page.inputValue('#ref [name="ustBetrag"]') === '0,00' && await page.locator('#rc-hinweis').isVisible() && await page.locator('#re-papier [data-papier="ok"]').count() === 1, 'Reverse Charge: USt nicht 0,00 oder Hinweis fehlt');
      await page.selectOption('#ref [name="skontoArt"]', 'prozent');
      await page.fill('#ref [name="skontoWert"]', '3'); await page.fill('#ref [name="skontoTage"]', '21');
      await page.fill('#ref [name="zahlungszielTage"]', '30');
      const bed = (await page.locator('#re-bedingungen li').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim());
      pruef(bed.length === 2 && bed[0] === `21 Tage (bis ${de(plus(reDatum, 21))}) · 3 % Skonto · € 1.722,48` && bed[1] === `30 Tage (bis ${de(plus(reDatum, 30))}) · ohne Abzug · € 1.775,75`, `Zahlungsvereinbarungen nicht wie in Auer: ${JSON.stringify(bed)}`);
      if (opt.bilder) {
        for (const [teil, name] of [[1, '1-erfassen-a-rechnung'], [3, '1-erfassen-b-betraege'], [4, '1-erfassen-c-zahlungsbedingungen']]) {
          await page.evaluate((t) => { const el = document.querySelector(`#ref .re-teil[data-teil="${t}"]`); el.scrollIntoView({ block: 'start' }); el.closest('.dlg-body').scrollTop -= 14; }, teil);
          await shot(page, name);
        }
      }
      await page.click('#re-ok');
      await page.waitForSelector('dialog[open] #ref', { state: 'detached' });
      await page.waitForSelector(`#re-tabelle tr:has-text("${AUER.nr}")`);
      const auer = (await api('/rechnungen?typ=regie')).json.find((x) => x.nr === AUER.nr);
      pruef(auer && auer.ustModus === 'reverse_charge' && auer.ust === 0 && auer.brutto === 1775.75 && auer.skontoBetrag === 53.27 && auer.skontoBis === plus(reDatum, 21) && auer.faellig === plus(reDatum, 30) && auer.empfaenger === AUER.empfaenger && auer.agZeichen === AUER.zeichen && auer.baustelleId === BS.ternitz, `Server speichert anders: ${JSON.stringify(auer && { u: auer.ust, b: auer.brutto, s: auer.skontoBetrag, sb: auer.skontoBis, f: auer.faellig, e: auer.empfaenger })}`);

      // 2) Teilrechnung mit beiden Rücklässen (im Reiter der Baustelle) – Vorschlag der letzten Rechnung an diesen Auftraggeber sichtbar
      await geh(`#/baustelle/${BS.ternitz}?reiter=rechnungen`);
      await page.waitForSelector('#rechnungen #re-neu');
      await page.click('#re-neu');
      await page.waitForSelector('dialog[open] #ref');
      await page.waitForSelector('#re-vorschlag:not([hidden])');
      pruef(/Letzte Rechnung an .*000\/W26.*Reverse Charge.*Ziel 30 Tage/.test(await page.locator('#re-vorschlag').innerText()) && await page.locator('#ref [name="ustModus"]:checked').count() === 0, `Vorschlag der letzten Rechnung fehlt oder wurde ungefragt übernommen („${await page.locator('#re-vorschlag').innerText()}“)`);
      await page.fill('#ref [name="nr"]', 'TR-2026-07');
      await page.selectOption('#ref [name="typ"]', 'teil');
      await page.check('#ref [name="ustModus"][value="normal"]');
      await page.fill('#ref [name="netto"]', '10.000,00');
      await page.fill('#ref [name="zahlungszielTage"]', '14');
      await page.selectOption('#ref [name="deckungArt"]', 'prozent'); await page.fill('#ref [name="deckungWert"]', '5');
      await page.selectOption('#ref [name="haftArt"]', 'betrag'); await page.fill('#ref [name="haftWert"]', '300,00'); await page.fill('#ref [name="haftFreiAb"]', plus(heute, 400));
      const vs = await page.locator('#re-vorschau [data-rl-wert="deckung"]').textContent() + ' | ' + await page.locator('#re-vorschau [data-rl-wert="haft"]').textContent();
      pruef(/Deckungsrücklass\s*−\s*€\s*600,00/.test(vs) && /Haftrücklass\s*−\s*€\s*300,00/.test(vs) && (await page.locator('#re-zahlbetrag').innerText()).includes('11.100,00'), `Vorschau beider Rücklässe falsch: ${vs.replace(/\s+/g, ' ')}`);
      await shot(page, '1-erfassen-d-ruecklaesse');
      await page.click('#re-ok');
      await page.waitForSelector(`#re-tabelle tr:has-text("TR-2026-07")`);
      const tr = (await api(`/rechnungen?baustelleId=${BS.ternitz}`)).json.find((x) => x.nr === 'TR-2026-07');
      pruef(tr && tr.deckungsruecklass && tr.deckungsruecklass.betrag === 600 && tr.haftruecklass && tr.haftruecklass.betrag === 300 && tr.haftruecklass.freiAb === plus(heute, 400) && tr.zahlbetrag === 11100 && tr.ust === 2000 && tr.brutto === 12000, `beide Rücklässe am Server falsch: ${JSON.stringify(tr && { d: tr.deckungsruecklass, h: tr.haftruecklass, z: tr.zahlbetrag })}`);
      // Detail zeigt beide Rücklässe
      await page.locator('#re-tabelle tr:has-text("TR-2026-07")').click();
      await page.waitForSelector('dialog[open] #re-detail');
      pruef(await page.locator('#re-detail [data-rl="deckung"]').count() === 1 && await page.locator('#re-detail [data-rl="haft"]').count() === 1, 'Detail ohne beide Rücklässe');
      await page.keyboard.press('Escape');

      // 2b) Zahlbetrag mit Skonto (15.26): Betrag nach Skonto wie auf dem Papier – Brutto 48.000,00, Deckungsrücklass 3 % = 1.440,00,
      // Zahlbetrag 46.560,00, „zahlbar bis … abzgl. 3 % Skonto € 45.163,20“
      const skD = plus(heute, 6), skBis = plus(skD, 14);
      await geh('#/rechnungen');
      await page.waitForSelector('#rechnungen-seite');
      await page.click('#re-neu-alle');
      await page.waitForSelector('dialog[open] #ref');
      await page.selectOption('#ref [name="baustelle"]', String(BS.neustadt));
      await page.fill('#ref [name="nr"]', 'TR-SK-ZB');
      await page.selectOption('#ref [name="typ"]', 'teil');
      await page.fill('#ref [name="datum"]', skD);
      await page.check('#ref [name="ustModus"][value="normal"]');
      await page.fill('#ref [name="netto"]', '40.000,00');
      await page.fill('#ref [name="zahlungszielTage"]', '30');
      await page.selectOption('#ref [name="deckungArt"]', 'prozent'); await page.fill('#ref [name="deckungWert"]', '3');
      pruef((await page.locator('#ref [name="skontoArt"] option').allTextContents()).join('|') === 'kein Skonto|in %|in €|Zahlbetrag mit Skonto', `Skonto-Auswahl: ${(await page.locator('#ref [name="skontoArt"] option').allTextContents()).join('|')}`);
      pruef(await page.locator('#re-sk-kontrolle').isHidden(), 'Kontrollfeld „Skonto % laut Rechnung“ ohne Zahlbetrag mit Skonto sichtbar');
      await page.selectOption('#ref [name="skontoArt"]', 'zahlbetrag');
      pruef(await page.locator('#sk-einheit').textContent() === 'Zahlbetrag mit Skonto in €' && await page.locator('#re-sk-kontrolle').isVisible() && /Skonto % laut Rechnung/.test(await page.locator('#re-sk-kontrolle').textContent()), `Zahlbetrag mit Skonto: Beschriftung „${await page.locator('#sk-einheit').textContent()}“ / Kontrollfeld fehlt`);
      await page.fill('#ref [name="skontoWert"]', '45.163,20'); await page.fill('#ref [name="skontoTage"]', '14');
      const skZeile = async () => (await page.locator('#re-vorschau [data-skonto-wert]').innerText()).replace(/\s+/g, ' ').trim();
      pruef((await page.locator('#re-zahlbetrag').innerText()).includes('46.560,00') && /^Skonto 3 % bis \d\d\.\d\d\. − € 1\.396,80$/.test(await skZeile()) && (await skZeile()).includes(`bis ${de(skBis).slice(0, 6)}`), `Summe: Skonto-Zeile „${await skZeile()}“`);
      pruef((await page.locator('#re-zahlbetrag-skonto').innerText()).includes('45.163,20') && await page.locator('#re-vorschau [data-zahlbetrag-skonto].sum').count() === 1 && /Zahlbetrag mit Skonto/.test(await page.locator('#re-vorschau [data-zahlbetrag-skonto]').innerText()), `Summe: „Zahlbetrag mit Skonto“ fehlt (${await page.locator('#re-vorschau').innerText()})`);
      pruef((await page.locator('#re-bedingungen li[data-bedingung="skonto"]').innerText()).replace(/\s+/g, ' ').trim() === `14 Tage (bis ${de(skBis)}) · 3 % Skonto · € 45.163,20`, `Zahlungsvereinbarung mit Skonto: ${await page.locator('#re-bedingungen li[data-bedingung="skonto"]').innerText()}`);
      pruef(/Ergibt Skonto €\s1\.396,80 \(3 %\)/.test(await page.locator('#re-skonto [data-skonto="info"]').innerText()), `Hinweis gerechnetes Skonto: ${await page.locator('#re-skonto').innerText()}`);
      // Kontrolle mit Skonto % laut Rechnung: passt / weicht ab (Hinweis, kein Sperren)
      await page.fill('#ref [name="skontoKontrolle"]', '3');
      pruef(await page.locator('#re-skonto [data-skonto="ok"]').count() === 1 && /passt zur Rechnung/.test(await page.locator('#re-skonto').innerText()), `Kontrolle 3 %: ${await page.locator('#re-skonto').innerText()}`);
      // Wechsel der Art rechnet um: Zahlbetrag mit Skonto → % → € → zurück
      await page.selectOption('#ref [name="skontoArt"]', 'prozent');
      pruef(await page.inputValue('#ref [name="skontoWert"]') === '3' && await page.locator('#re-sk-kontrolle').isHidden() && await page.inputValue('#ref [name="skontoTage"]') === '14', `Wechsel zu %: ${await page.inputValue('#ref [name="skontoWert"]')}`);
      await page.selectOption('#ref [name="skontoArt"]', 'betrag');
      pruef(await page.inputValue('#ref [name="skontoWert"]') === '1.396,80' && await page.locator('#sk-einheit').textContent() === 'Skonto in €', `Wechsel zu €: ${await page.inputValue('#ref [name="skontoWert"]')}`);
      await page.selectOption('#ref [name="skontoArt"]', 'prozent');
      await page.selectOption('#ref [name="skontoArt"]', 'zahlbetrag');
      pruef(await page.inputValue('#ref [name="skontoWert"]') === '45.163,20' && await page.inputValue('#ref [name="skontoKontrolle"]') === '3', `Wechsel zurück: ${await page.inputValue('#ref [name="skontoWert"]')} / Kontrolle ${await page.inputValue('#ref [name="skontoKontrolle"]')}`);
      // zu hoch: Hinweis und kein Speichern
      await page.fill('#ref [name="skontoWert"]', '46.560,00');
      pruef(await page.locator('#re-skonto [data-skonto="zu-hoch"]').count() === 1 && await page.locator('#re-vorschau [data-skonto-wert]').count() === 0, 'Zahlbetrag mit Skonto = Zahlbetrag: kein Hinweis oder trotzdem Skonto-Zeile');
      let postsSk = 0;
      const zaehleSk = (q) => { if (q.method() === 'POST' && /\/rechnungen$/.test(q.url())) postsSk++; };
      page.on('request', zaehleSk);
      await page.click('#re-ok');
      await page.waitForSelector('#ref .form-err:not([hidden])');
      pruef(postsSk === 0 && /muss kleiner sein als der Zahlbetrag \(€\s46\.560,00\)/.test(await page.locator('#ref .form-err').innerText()), `zu hoch gespeichert oder ohne klare Meldung: ${await page.locator('#ref .form-err').innerText()}`);
      page.off('request', zaehleSk);
      // vom Papier vertippt (45.163,25 statt 45.163,20): Hinweis „Papier … – gerechnet …“, Speichern bleibt möglich
      await page.fill('#ref [name="skontoWert"]', '45.163,25');
      pruef(/Skonto 3 %: Papier 45\.163,25 – gerechnet 45\.163,20, bitte prüfen\./.test(await page.locator('#re-skonto [data-skonto="abweichung"]').innerText()), `Abweichungs-Hinweis Skonto: ${await page.locator('#re-skonto').innerText()}`);
      // Layout: kein seitlicher Überlauf im Dialog (auch bei 320 px am Handy)
      const dlgUeber = async (wo2) => { const x = await page.evaluate(() => { const b = document.querySelector('dialog[open] .dlg-body'); return { s: b.scrollWidth, c: b.clientWidth, k: [...document.querySelectorAll('#re-sk-kontrolle, #re-vorschau .re-summe, #re-skonto .re-hinweis')].some((e) => e.scrollWidth > e.clientWidth + 1) }; }); pruef(x.s <= x.c + 1 && !x.k, `${wo2}: seitlicher Überlauf im Dialog (${x.s} > ${x.c}${x.k ? ', Skonto-Bereich' : ''})`); };
      await dlgUeber(`Zahlbetrag mit Skonto ${g.width} px`);
      if (g.width <= 390) { await page.setViewportSize({ width: 320, height: g.height }); await page.waitForTimeout(150); await dlgUeber('Zahlbetrag mit Skonto 320 px'); await ueberlauf('Rechnung erfassen 320 px'); await page.setViewportSize({ width: g.width, height: g.height }); }
      if (opt.bilder) { await page.evaluate(() => { const el = document.querySelector('#ref .re-teil[data-teil="4"]'); el.scrollIntoView({ block: 'start' }); el.closest('.dlg-body').scrollTop -= 14; }); await shot(page, '1-erfassen-e-zahlbetrag-mit-skonto'); await page.evaluate(() => document.querySelector('#re-vorschau').scrollIntoView({ block: 'center' })); await shot(page, '1-erfassen-e-zahlbetrag-mit-skonto-summe'); }
      await page.click('#re-ok');
      await page.waitForSelector('dialog[open] #ref', { state: 'detached' });
      await page.waitForSelector('#re-tabelle tr:has-text("TR-SK-ZB")');
      let zb = (await api(`/rechnungen?baustelleId=${BS.neustadt}`)).json.find((x) => x.nr === 'TR-SK-ZB');
      pruef(zb && zb.skontoEingabe === 'zahlbetrag' && zb.zahlbetrag === 46560 && zb.zahlbetragMitSkonto === 45163.25 && zb.skontoBetrag === 1396.75 && zb.skontoBis === skBis, `Zahlbetrag mit Skonto am Server: ${JSON.stringify(zb && { e: zb.skontoEingabe, z: zb.zahlbetrag, m: zb.zahlbetragMitSkonto, s: zb.skontoBetrag, b: zb.skontoBis })}`);
      // Bearbeiten: öffnet wieder als „Zahlbetrag mit Skonto“ mit dem eingetragenen Betrag – korrigieren
      await page.locator('#re-tabelle tr:has-text("TR-SK-ZB") td:first-child').click();
      await page.waitForSelector('dialog[open] #re-detail');
      await page.click('#re-edit');
      await page.waitForSelector('dialog[open] #ref');
      pruef(await page.inputValue('#ref [name="skontoArt"]') === 'zahlbetrag' && await page.inputValue('#ref [name="skontoWert"]') === '45.163,25' && await page.locator('#sk-einheit').textContent() === 'Zahlbetrag mit Skonto in €' && await page.locator('#re-sk-kontrolle').isVisible(), `Bearbeiten öffnet nicht als Zahlbetrag mit Skonto (${await page.inputValue('#ref [name="skontoArt"]')} / ${await page.inputValue('#ref [name="skontoWert"]')})`);
      await page.fill('#ref [name="skontoWert"]', '45.163,20');
      await page.click('#re-ok');
      await page.waitForSelector('dialog[open] #ref', { state: 'detached' });
      zb = (await api(`/rechnungen/${zb.id}`)).json;
      pruef(zb.skontoEingabe === 'zahlbetrag' && zb.skontoBetrag === 1396.8 && zb.skontoProzent === 3 && zb.zahlbetragMitSkonto === 45163.2, `nach dem Bearbeiten: ${JSON.stringify({ e: zb.skontoEingabe, s: zb.skontoBetrag, p: zb.skontoProzent, m: zb.zahlbetragMitSkonto })}`);
      // Detail: „Skonto 3 % bis …  − € 1.396,80“, „Zahlbetrag mit Skonto € 45.163,20“, „(eingetragen als Zahlbetrag mit Skonto)“
      await geh('#/rechnungen');
      await page.waitForSelector('#re-tabelle tr:has-text("TR-SK-ZB")');
      await page.locator('#re-tabelle tr:has-text("TR-SK-ZB") td:first-child').click();
      await page.waitForSelector('dialog[open] #re-detail');
      const dSk = (await page.locator('#re-detail [data-skonto-wert]').innerText()).replace(/\s+/g, ' ').trim();
      pruef(dSk === `Skonto 3 % bis ${de(skBis).slice(0, 6)} − € 1.396,80` && (await page.locator('#re-detail [data-wert="zahlbetragMitSkonto"]').innerText()).includes('45.163,20') && /\(eingetragen als Zahlbetrag mit Skonto\)/.test(await page.locator('#re-detail [data-skonto-eingabe="zahlbetrag"]').innerText()), `Detail Zahlbetrag mit Skonto: „${dSk}“ / ${await page.locator('#re-detail').innerText()}`);
      if (opt.bilder) await page.evaluate(() => document.querySelector('#re-detail [data-skonto-wert]').scrollIntoView({ block: 'center' }));
      await shot(page, '1-erfassen-f-detail-zahlbetrag-mit-skonto');
      await page.keyboard.press('Escape');
      await geh('#/dashboard'); // die nächsten Rechnungen kommen über die Schnittstelle – „Rechnungen“ danach neu laden

      // weitere Rechnungen über die Schnittstelle (verschiedene Ziele, Skonti, USt-Arten)
      const neu = async (bs, b) => { const r = await api(`/baustellen/${bs}/rechnungen`, 'POST', { typ: 'abschlag', ...b }); pruef(r.status === 201, `Testrechnung ${b.nr}: ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`); return r.json; };
      await neu(BS.pitten, { nr: 'AR-ALT-1', datum: plus(heute, -45), netto: 8000, ustModus: 'normal', zahlungszielTage: 30 }); // überfällig
      await neu(BS.kogler, { nr: 'AR-WOCHE-1', datum: plus(heute, -10), netto: 4200, ustModus: 'normal', zahlungszielTage: 14, skontoBetrag: 100, skontoTage: 12 });
      await neu(BS.reisinger, { nr: 'GS-1', typ: 'gutschrift', datum: plus(heute, -2), netto: 350, ustModus: 'normal', zahlungszielTage: 14 });
      const sr = await neu(BS.gloggnitz, { nr: 'SR-1', typ: 'schluss', datum: plus(heute, -40), netto: 20000, ustModus: 'normal', zahlungszielTage: 30, haftProzent: 3, haftFreiAb: plus(heute, 900) });
      await api(`/rechnungen/${sr.id}/zahlungen`, 'POST', { datum: plus(heute, -3), betrag: 23280 });

      // 3) Seite „Rechnungen“: Filter
      await geh('#/rechnungen');
      await page.waitForSelector('#rechnungen-seite #re-tabelle');
      const zeilen = async () => (await page.locator('#re-tabelle tbody tr').evaluateAll((l) => l.map((x) => x.querySelector('td b').textContent))).sort();
      const nrs = async (q) => (await api(`/rechnungen${q}`)).json.map((x) => x.nr).sort();
      const warte = async () => { await page.waitForTimeout(400); };
      pruef(JSON.stringify(await zeilen()) === JSON.stringify(await nrs('')), 'Liste ohne Filter weicht von der Schnittstelle ab');
      await page.selectOption('#ref-typ', 'regie'); await warte();
      pruef(JSON.stringify(await zeilen()) === JSON.stringify([AUER.nr]), `Filter Art: ${await zeilen()}`);
      await page.selectOption('#ref-typ', ''); await page.selectOption('#ref-bs', String(BS.ternitz)); await warte();
      pruef(JSON.stringify(await zeilen()) === JSON.stringify([AUER.nr, 'TR-2026-07'].sort()), `Filter Baustelle: ${await zeilen()}`);
      await page.selectOption('#ref-bs', ''); await page.click('[data-re-status="bezahlt"]'); await warte();
      pruef(JSON.stringify(await zeilen()) === JSON.stringify(['SR-1']), `Filter Bezahlt: ${await zeilen()}`);
      await page.click('[data-re-status="ueberfaellig"]'); await warte();
      pruef(JSON.stringify(await zeilen()) === JSON.stringify(await nrs('?status=ueberfaellig')) && (await zeilen()).includes('AR-ALT-1'), `Filter Überfällig: ${await zeilen()}`);
      await page.click('[data-re-status="offen,teilbezahlt,ueberfaellig,differenz"]'); await warte();
      pruef(!(await zeilen()).includes('SR-1') && (await zeilen()).includes(AUER.nr), `Filter Offen: ${await zeilen()}`);
      await page.click('[data-re-status=""]');
      await page.fill('#ref-von', plus(heute, -3)); await page.dispatchEvent('#ref-von', 'change'); await warte();
      pruef(JSON.stringify(await zeilen()) === JSON.stringify(await nrs(`?von=${plus(heute, -3)}`)) && !(await zeilen()).includes('AR-ALT-1'), `Filter Zeitraum: ${await zeilen()}`);
      await page.fill('#ref-von', ''); await page.dispatchEvent('#ref-von', 'change'); await warte();
      await ueberlauf('Rechnungen');
      await shot(page, '5-rechnungen-seite');

      // 4) Fälligkeiten über die Übersicht „Rechnungen“
      await geh('#/dashboard');
      await page.waitForSelector('#bv-kacheln a[data-kpi="faelligkeiten"]');
      await page.click('#bv-kacheln a[data-kpi="faelligkeiten"]');
      await page.waitForSelector('#faelligkeiten .fae-gruppe');
      const f = (await api('/faelligkeiten')).json;
      for (const gr of f.gruppen) {
        const sek = page.locator(`#faelligkeiten [data-gruppe="${gr.schluessel}"]`);
        if (!gr.eintraege.length) { pruef(await sek.count() === 0, `${gr.titel}: leere Gruppe angezeigt`); continue; }
        pruef(await sek.locator('.fae-row').count() === gr.eintraege.length, `${gr.titel}: ${await sek.locator('.fae-row').count()} Zeilen statt ${gr.eintraege.length}`);
        const summe = (await sek.locator('[data-summe="ohne"]').innerText()).replace(/\s+/g, ' ');
        pruef(summe.includes(Math.abs(gr.summeOhneSkonto).toLocaleString('de-DE', { minimumFractionDigits: 2 })), `${gr.titel}: Summe ${summe} ≠ ${gr.summeOhneSkonto}`);
      }
      pruef(JSON.stringify(await page.locator('#faelligkeiten .fae-gruppe .ue-h > span:first-child').allTextContents().then((l) => l.map((x) => x.replace(/\s*·.*/, '').trim()))) === JSON.stringify(f.gruppen.filter((x) => x.eintraege.length).map((x) => x.titel)), `Reihenfolge der Gruppen: ${await page.locator('#faelligkeiten .fae-gruppe .ue-h > span:first-child').allTextContents()}`);
      const auerZ = page.locator(`#faelligkeiten .fae-row[data-fae="rechnung"]:has-text("${AUER.nr}")`);
      const az = (await auerZ.innerText()).replace(/\s+/g, ' ');
      const kurz = (iso) => de(iso).slice(0, 6);
      pruef(az.includes(`mit Skonto € 1.722,48 bis ${kurz(plus(reDatum, 21))}`) && az.includes(`ohne Skonto € 1.775,75 bis ${kurz(plus(reDatum, 30))}`) && /Handler|Stahlservice/.test(az), `Zeile der Auer-Rechnung: „${az}“`);
      const alt = (await page.locator('#faelligkeiten [data-gruppe="ueberfaellig"] .fae-row:has-text("AR-ALT-1")').innerText()).replace(/\s+/g, ' ');
      pruef(!/mit Skonto/.test(alt) && /€ 9\.600,00/.test(alt), `überfällige Rechnung: „${alt}“`);
      { const t = (await page.locator('#faelligkeiten .fae-row[data-fae="gutschrift"]').textContent()).replace(/\s+/g, ' '); pruef(/−\s*€\s*420,00/.test(t), `Gutschrift nicht negativ: ${t}`); }
      const rl = await page.locator('#faelligkeiten .fae-rl').allInnerTexts();
      pruef(rl.some((x) => /Haftrücklass\s*€\s*720,00\s*frei ab/.test(x)) && rl.some((x) => /Haftrücklass\s*€\s*300,00/.test(x)) && rl.some((x) => /Deckungsrücklass\s*€\s*600,00/.test(x)), `Rücklass-Zeilen: ${rl.map((x) => x.replace(/\s+/g, ' ')).join(' | ')}`);
      // ruhig: nichts unterstrichen, nichts blau
      const stil = await page.evaluate(() => [...document.querySelectorAll('#faelligkeiten a, #faelligkeiten button, #faelligkeiten b, #faelligkeiten span')].map((e) => { const c = getComputedStyle(e); return { u: c.textDecorationLine, f: c.color }; }));
      pruef(stil.every((x) => !/underline/.test(x.u)) && !stil.some((x) => /rgb\(0, 0, 238\)|rgb\(37, 99, 235\)|rgb\(26, 115, 232\)/.test(x.f)), 'Fälligkeiten mit Unterstreichung oder blauen Links');
      await ueberlauf('Fälligkeiten');
      await shot(page, '2-faelligkeiten');
      if (opt.bilder) { await page.evaluate(() => { const v = document.querySelector('#faelligkeiten .fae-hinweis'); v.scrollIntoView({ block: 'end' }); }); await page.waitForTimeout(200); await page.screenshot({ path: path.join(opt.bilder, `2-faelligkeiten-unten-${g.name}.png`) }); }
      // „Offen gesamt“ oben (offene Zahlbeträge + einbehaltene Rücklässe) – gleich der Schnittstelle, auch in der Übersicht
      const ogWert = async () => Number(await page.locator('#offen-gesamt').getAttribute('data-wert'));
      pruef(await ogWert() === f.offenGesamt.betrag && (await page.locator('#offen-gesamt').textContent()).replace(/\s+/g, ' ').includes('davon überfällig'), `Offen gesamt: ${await ogWert()} ≠ ${f.offenGesamt.betrag}`);
      // „Als bezahlt markieren“ in der Skontofrist (✓ in der Zeile): Vorschlag mit Skonto, Buchung, „Rückgängig“ im Toast
      const og0 = f.offenGesamt.betrag;
      await page.click(`#faelligkeiten .fae-row[data-nr="${AUER.nr}"] [data-bezahlt]`);
      await page.waitForSelector('dialog[open] #bzf');
      pruef(await page.inputValue('#bzf [name="betrag"]') === '1.722,48' && await page.inputValue('#bzf [name="datum"]') === heute && /mit 3 % Skonto \(€\s*53,27\)/.test(await page.locator('#bz-abgleich [data-bz="erwartet"]').textContent()) && /passt genau/.test(await page.locator('#bz-differenz').textContent()), `Vorschlag „bezahlt“ in der Skontofrist: ${await page.inputValue('#bzf [name="betrag"]')} / ${await page.locator('#bz-abgleich').textContent()}`);
      await shot(page, '3-als-bezahlt-markieren');
      await page.click('#bz-ok');
      await page.waitForSelector('.toast .toast-aktion');
      await page.waitForFunction((nr) => !document.querySelector(`#faelligkeiten .fae-row[data-nr="${nr}"][data-fae="rechnung"]`), AUER.nr);
      let a = (await api(`/rechnungen/${auer.id}`)).json;
      pruef(a.status === 'bezahlt' && a.skontoGenommen === 53.27 && a.bezahlt === 1722.48 && a.zahlungen.length === 1 && a.zahlungen[0].quelle === 'markiert', `als bezahlt markiert: ${JSON.stringify({ s: a.status, sk: a.skontoGenommen, b: a.bezahlt })}`);
      pruef(Math.abs(await ogWert() - (og0 - 1775.75)) < 0.005, `Offen gesamt nach „bezahlt“: ${await ogWert()} statt ${og0 - 1775.75}`);
      await page.click('.toast .toast-aktion');
      await page.waitForSelector(`#faelligkeiten .fae-row[data-nr="${AUER.nr}"][data-fae="rechnung"]`);
      a = (await api(`/rechnungen/${auer.id}`)).json;
      pruef(a.status !== 'bezahlt' && a.zahlungen.length === 0 && await ogWert() === og0, `Rückgängig im Toast: ${a.status}, ${a.zahlungen.length} Zahlungen, Offen gesamt ${await ogWert()}`);
      // nach der Skontofrist (Rechnungsdetail): voller Betrag, kein Skonto; „Rückgängig“ im Detail
      const vorbei = await neu(BS.kogler, { nr: 'AR-SK-VORBEI', datum: plus(heute, -20), netto: 1000, ustModus: 'normal', zahlungszielTage: 30, skontoProzent: 2, skontoTage: 10 });
      await geh('#/rechnungen');
      await page.waitForSelector('#rechnungen-seite #re-tabelle');
      pruef(Number(await page.locator('#rechnungen-seite #offen-gesamt').getAttribute('data-wert')) === (await api('/faelligkeiten')).json.offenGesamt.betrag, 'Offen gesamt auf der Seite „Rechnungen“ fehlt oder weicht ab');
      await page.locator('#re-tabelle tr:has-text("AR-SK-VORBEI") td:first-child').click();
      await page.waitForSelector('dialog[open] #re-detail');
      await page.click('#re-bezahlt');
      await page.waitForSelector('dialog[open] #bzf');
      pruef(await page.inputValue('#bzf [name="betrag"]') === '1.200,00' && /Skontofrist vorbei/.test(await page.locator('#bz-abgleich [data-bz="erwartet"]').textContent()), `Vorschlag nach der Skontofrist: ${await page.inputValue('#bzf [name="betrag"]')} / „${await page.locator('#bz-abgleich').textContent()}“`);
      await page.fill('#bzf [name="notiz"]', 'Kontoauszug');
      await page.click('#bz-ok');
      await page.waitForFunction(() => /Rückgängig/.test((document.querySelector('dialog[open] #re-detail') || {}).textContent || ''));
      let v = (await api(`/rechnungen/${vorbei.id}`)).json;
      pruef(v.status === 'bezahlt' && v.bezahlt === 1200 && v.skontoGenommen === 0, `nach der Skontofrist: ${JSON.stringify({ s: v.status, b: v.bezahlt, sk: v.skontoGenommen })}`);
      await page.locator('dialog[open] [data-markiert-weg]').last().click();
      await page.waitForFunction(() => !document.querySelector('dialog[open] [data-markiert-weg]') && !!document.querySelector('dialog[open] #re-bezahlt'));
      v = (await api(`/rechnungen/${vorbei.id}`)).json;
      pruef(v.status !== 'bezahlt' && v.zahlungen.length === 0, 'Rückgängig im Detail wirkt nicht');
      await page.keyboard.press('Escape');
      // Knopf „Bezahlt“ in der Liste öffnet die Bestätigung (nicht das Detail)
      await page.click('#re-tabelle tr:has-text("AR-ALT-1") [data-bezahlt]');
      await page.waitForSelector('dialog[open] #bzf');
      pruef(await page.locator('dialog[open] #re-detail').count() === 0 && await page.inputValue('#bzf [name="betrag"]') === '9.600,00', 'Knopf „Bezahlt“ in der Liste');
      await page.keyboard.press('Escape');
      await geh('#/dashboard');
      const ogZ = page.locator('#bv-kacheln a[data-kpi="faelligkeiten"]');
      pruef(Number(await ogZ.getAttribute('data-offen-gesamt')) === (await api('/faelligkeiten')).json.offenGesamt.betrag && /Offen gesamt/.test(await ogZ.textContent()), 'Übersicht: „Offen gesamt“ fehlt oder weicht ab');
      if (opt.bilder) await shot(page, '6-uebersicht-geld');
      await geh('#/faelligkeiten');
      await page.waitForSelector('#faelligkeiten .fae-gruppe');
      // Zeile öffnet die Rechnung
      await auerZ.click();
      await page.waitForSelector('dialog[open] #re-detail');
      pruef((await page.locator('#re-detail').innerText()).includes(AUER.empfaenger), 'Detail ohne Rechnungsempfänger');
      await page.keyboard.press('Escape');
      pruef(await page.locator('#fae-zu-rechnungen').count() === 0, '15.37: Link „Alle Rechnungen“ unter den Fälligkeiten doppelt zum Reiter');
      await page.click('#re-reiter [data-re-reiter="rechnungen"]');
      await page.waitForSelector('#rechnungen-seite');

      // 6) 15.37: „Offene Posten“ und „Fälligkeiten“ sind Reiter von „Rechnungen“ – Menü, Reiter, alte Adressen, Handy
      {
        const reiter = async () => page.evaluate(() => {
          const l = document.querySelector('#re-reiter');
          if (!l) return null;
          const a = [...l.querySelectorAll('a[role="tab"]')];
          const r = l.getBoundingClientRect();
          return {
            ids: a.map((x) => x.dataset.reReiter), texte: a.map((x) => x.innerText.trim()), hrefs: a.map((x) => x.getAttribute('href')),
            an: a.filter((x) => x.getAttribute('aria-selected') === 'true').map((x) => x.dataset.reReiter), on: a.filter((x) => x.classList.contains('on')).map((x) => x.dataset.reReiter),
            box: { x: Math.round(r.x), y: Math.round(r.y), b: Math.round(r.right) }, zeilen: new Set(a.map((x) => Math.round(x.getBoundingClientRect().top))).size,
            hoehe: Math.min(...a.map((x) => x.getBoundingClientRect().height)), rechts: Math.max(...a.map((x) => x.getBoundingClientRect().right)), breit: document.documentElement.clientWidth,
            scroll: l.scrollWidth - l.clientWidth,
            nav: [...document.querySelectorAll('#nav-seite .nav-item.active')].map((x) => x.dataset.nav), titel: document.querySelector('#titel').textContent
          };
        });
        const handy = g.width <= 719;
        const istAuf = async (id, sel, wo) => {
          const r = await reiter();
          pruef(!!r && JSON.stringify(r.ids) === JSON.stringify(['rechnungen', 'offene-posten', 'faelligkeiten']) && JSON.stringify(r.hrefs) === JSON.stringify(['#/rechnungen', '#/offene-posten', '#/faelligkeiten']), `15.37 ${wo}: Reiterleiste fehlt oder falsch (${JSON.stringify(r && r.ids)})`);
          if (!r) return null;
          pruef(JSON.stringify(r.texte) === JSON.stringify([handy ? 'Alle' : 'Alle Rechnungen', 'Offene Posten', 'Fälligkeiten']), `15.37 ${wo}: Beschriftung der Reiter ${JSON.stringify(r.texte)}`);
          pruef(JSON.stringify(r.an) === JSON.stringify([id]) && JSON.stringify(r.on) === JSON.stringify([id]), `15.37 ${wo}: aktiver Reiter ${r.an} statt ${id}`);
          pruef(JSON.stringify(r.nav) === JSON.stringify(['rechnungen']) && r.titel === 'Rechnungen', `15.37 ${wo}: Menüpunkt „Rechnungen“ nicht markiert bzw. Titel „${r.titel}“ (${r.nav})`);
          pruef(await page.locator(sel).count() >= 1, `15.37 ${wo}: Inhalt ${sel} fehlt`);
          pruef(r.zeilen === 1 && r.scroll <= 1 && r.rechts <= r.breit, `15.37 ${wo}: Reiter nicht in einer Zeile oder abgeschnitten (${JSON.stringify({ z: r.zeilen, s: r.scroll, r: r.rechts, b: r.breit })})`);
          if (handy) pruef(r.hoehe >= 44, `15.37 ${wo}: Reiter am Handy zu niedrig (${r.hoehe} px)`);
          await ueberlauf(`15.37 ${wo}`);
          return r;
        };
        // Menü: nur „Rechnungen“ – Seitenleiste, untere Leiste, „Mehr“
        const navAlle = await page.evaluate(() => [...document.querySelectorAll('[data-nav]')].map((a) => a.dataset.nav));
        pruef(navAlle.includes('rechnungen') && !navAlle.includes('offeneposten') && !navAlle.includes('faelligkeiten'), `15.37: Menü noch mit „Offene Posten“/„Fälligkeiten“ (${[...new Set(navAlle)]})`);
        pruef(!/Offene Posten|Fälligkeiten/.test(await page.locator('#nav-seite').textContent()) && !/Offene Posten|Posten|Fälligkeiten/.test(await page.locator('#nav-tab').textContent()), '15.37: Seitenleiste oder untere Leiste nennt „Offene Posten“/„Fälligkeiten“');
        // Reiter wechseln (Klick), Leiste bleibt an derselben Stelle, Zurück-Taste
        const r1 = await istAuf('rechnungen', '#rechnungen-seite', 'Alle Rechnungen');
        pruef(await page.locator('#rechnungen-seite #re-zu-faellig').count() === 0, '15.37: Knopf „Fälligkeiten“ in der Werkzeugleiste doppelt zum Reiter');
        await page.click('#re-reiter [data-re-reiter="offene-posten"]');
        await page.waitForFunction(() => location.hash === '#/offene-posten'); await page.waitForSelector('#offene-posten #op-liste');
        const r2 = await istAuf('offene-posten', '#offene-posten', 'Reiter Offene Posten');
        await shot(page, '7-reiter-offene-posten');
        await page.click('#re-reiter [data-re-reiter="faelligkeiten"]');
        await page.waitForFunction(() => location.hash === '#/faelligkeiten'); await page.waitForSelector('#faelligkeiten .fae-gruppe');
        const r3 = await istAuf('faelligkeiten', '#faelligkeiten', 'Reiter Fälligkeiten');
        await shot(page, '7-reiter-faelligkeiten');
        pruef(!!(r1 && r2 && r3) && [r2, r3].every((r) => r.box.x === r1.box.x && r.box.y === r1.box.y), `15.37: Reiterleiste springt beim Wechsel (${JSON.stringify([r1, r2, r3].map((r) => r && r.box))})`);
        await page.goBack();
        await page.waitForFunction(() => location.hash === '#/offene-posten'); await page.waitForSelector('#offene-posten #op-liste');
        await istAuf('offene-posten', '#offene-posten', 'Zurück-Taste');
        // alte Adressen direkt (neu geladen) öffnen den passenden Reiter
        for (const [h, id, sel] of [['#/offene-posten', 'offene-posten', '#offene-posten #op-liste'], ['#/faelligkeiten', 'faelligkeiten', '#faelligkeiten .fae-gruppe'], ['#/offene-posten?status=ueberfaellig', 'offene-posten', '#offene-posten [data-op-filter="ueberfaellig"].on']]) {
          await page.goto(`${s.basis}/?neu=${id}${h}`); await page.waitForSelector(sel);
          await istAuf(id, sel, `Adresse ${h}`);
        }
        // „Offen gesamt“ auf „Alle Rechnungen“ führt zum Reiter Fälligkeiten; die Übersicht „Überfällig“ zum Reiter Offene Posten
        await geh('#/rechnungen'); await page.waitForSelector('#rechnungen-seite #re-og #offen-gesamt');
        await page.click('#re-og');
        await page.waitForFunction(() => location.hash === '#/faelligkeiten'); await page.waitForSelector('#faelligkeiten .fae-gruppe');
        await istAuf('faelligkeiten', '#faelligkeiten', '„Offen gesamt“');
        await geh('#/dashboard'); await page.waitForSelector('#bv-kacheln a[data-kpi="ueberfaellig"]');
        await page.click('#bv-kacheln a[data-kpi="ueberfaellig"]');
        await page.waitForFunction(() => location.hash === '#/offene-posten'); await page.waitForSelector('#offene-posten #op-liste');
        await istAuf('offene-posten', '#offene-posten', 'Übersicht „Überfällig“');
        // Prüfbefunde 15.37: Die Leiste steht sofort – beim Wechsel während des Ladens (langsames Netz) und bei einem Ladefehler,
        // damit die anderen Reiter erreichbar bleiben (am Handy gibt es dafür sonst keinen Menüpunkt mehr)
        {
          const pfadIst = (...p) => (u) => p.includes(new URL(u).pathname);
          await geh('#/rechnungen'); await page.waitForSelector('#rechnungen-seite');
          const r0 = await reiter();
          const langsam = pfadIst('/api/offene-posten');
          await page.route(langsam, async (route) => { await new Promise((ok) => setTimeout(ok, 1500)); await route.continue().catch(() => {}); });
          await page.click('#re-reiter [data-re-reiter="offene-posten"]');
          await page.waitForFunction(() => location.hash === '#/offene-posten');
          await page.waitForTimeout(400);
          const rl = await reiter();
          const lz = await page.evaluate(() => { window.__reLeiste = document.querySelector('#re-reiter'); return { spinner: !!document.querySelector('#view .view-box > .state .spinner'), inhalt: !!document.querySelector('#offene-posten') }; });
          pruef(!!rl && JSON.stringify(rl.an) === '["offene-posten"]' && !!r0 && rl.box.x === r0.box.x && rl.box.y === r0.box.y && lz.spinner && !lz.inhalt, `15.37 Prüfbefund: Reiterleiste fehlt oder springt während des Ladens (${JSON.stringify({ r: rl && rl.an, box: rl && rl.box, r0: r0 && r0.box, ...lz })})`);
          await page.waitForSelector('#offene-posten #op-liste');
          pruef(await page.evaluate(() => document.querySelector('#re-reiter') === window.__reLeiste && !document.querySelector('#view .spinner')), '15.37 Prüfbefund: Reiterleiste nach dem Laden neu gezeichnet bzw. Platzhalter „Wird geladen“ bleibt stehen');
          await istAuf('offene-posten', '#offene-posten', 'nach langsamem Laden');
          await page.unroute(langsam);
          // Serverfehler im Reiter „Offene Posten“: Fehlerbox unter der Leiste, Reiter bedienbar, „Erneut versuchen“ lädt den Reiter
          await geh('#/rechnungen'); await page.waitForSelector('#rechnungen-seite');
          await page.route(langsam, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ fehler: 'kaputt' }) }));
          await page.click('#re-reiter [data-re-reiter="offene-posten"]');
          await page.waitForFunction(() => location.hash === '#/offene-posten'); await page.waitForSelector('#view [data-zustand="fehler"]');
          const rf = await reiter();
          pruef(!!rf && JSON.stringify(rf.an) === '["offene-posten"]' && rf.box.x === r0.box.x && rf.box.y === r0.box.y && await page.locator('#view #re-reiter ~ [data-zustand="fehler"], #view .re-kopf ~ .page [data-zustand="fehler"]').count() === 1 && await page.locator('#view [data-neu-laden]').count() === 1, `15.37 Prüfbefund: Serverfehler ohne Reiterleiste bzw. ohne „Erneut versuchen“ (${JSON.stringify(rf && rf.an)})`);
          await ueberlauf('15.37 Prüfbefund Serverfehler');
          await page.click('#re-reiter [data-re-reiter="rechnungen"]');
          await page.waitForFunction(() => location.hash === '#/rechnungen'); await page.waitForSelector('#rechnungen-seite #re-ergebnis section');
          await istAuf('rechnungen', '#rechnungen-seite', 'vom fehlgeschlagenen Reiter zurück');
          await geh('#/offene-posten'); await page.waitForSelector('#view [data-zustand="fehler"]');
          await page.unroute(langsam);
          await page.click('#view [data-neu-laden]'); await page.waitForSelector('#offene-posten #op-liste');
          await istAuf('offene-posten', '#offene-posten', '„Erneut versuchen“ nach Serverfehler');
          // keine Verbindung beim Reiter „Alle Rechnungen“ (einziger Menüpunkt): „Keine Verbindung“ unter der Leiste, die anderen Reiter gehen
          const ohneNetz = pfadIst('/api/rechnungen');
          await page.route(ohneNetz, (route) => route.abort('internetdisconnected'));
          await geh('#/rechnungen'); await page.waitForSelector('#view [data-zustand="fehler"]');
          const rn = await reiter();
          pruef(!!rn && JSON.stringify(rn.an) === '["rechnungen"]' && rn.box.x === r0.box.x && rn.box.y === r0.box.y && /Keine Verbindung/.test(await page.locator('#view [data-zustand="fehler"]').innerText()) && await page.locator('#view [data-neu-laden]').count() === 1, `15.37 Prüfbefund: „Keine Verbindung“ ohne Reiterleiste (${JSON.stringify(rn && rn.an)})`);
          await ueberlauf('15.37 Prüfbefund keine Verbindung');
          for (const [id, sel] of [['offene-posten', '#offene-posten #op-liste'], ['faelligkeiten', '#faelligkeiten .fae-gruppe']]) {
            await page.click(`#re-reiter [data-re-reiter="${id}"]`);
            await page.waitForFunction((x) => location.hash === '#/' + x, id); await page.waitForSelector(sel);
            await istAuf(id, sel.split(' ')[0], `Reiter ${id} ohne Verbindung zu den Rechnungen`);
            await page.goBack(); await page.waitForFunction(() => location.hash === '#/rechnungen'); await page.waitForSelector('#view [data-zustand="fehler"]');
          }
          await page.unroute(ohneNetz);
          await page.click('#view [data-neu-laden]'); await page.waitForSelector('#rechnungen-seite #re-ergebnis section');
          await istAuf('rechnungen', '#rechnungen-seite', '„Erneut versuchen“ nach „Keine Verbindung“');
        }
        // „Mehr“ (am Handy die Liste aller Bereiche): nur „Rechnungen“
        await geh('#/mehr');
        const mehr = await page.locator('nav[aria-label="Alle Bereiche"] a').evaluateAll((l) => l.map((a) => a.getAttribute('href')));
        pruef(mehr.includes('#/rechnungen') && !mehr.includes('#/offene-posten') && !mehr.includes('#/faelligkeiten'), `15.37: „Mehr“ nennt ${mehr.filter((x) => /rechnung|posten|faellig/.test(x))}`);
        // Handy 360 px: alle drei Reiter in einer Zeile, kein seitlicher Überlauf
        if (handy) {
          await page.setViewportSize({ width: 360, height: g.height });
          for (const [h, id, sel] of [['#/rechnungen', 'rechnungen', '#rechnungen-seite #re-tabelle'], ['#/offene-posten', 'offene-posten', '#offene-posten #op-liste'], ['#/faelligkeiten', 'faelligkeiten', '#faelligkeiten .fae-gruppe']]) {
            await geh(h); await page.waitForSelector(sel);
            await istAuf(id, sel, `360 px ${h}`);
          }
          await shot(page, '7-reiter-360');
          await page.setViewportSize({ width: g.width, height: g.height });
        }
        await geh('#/rechnungen'); await page.waitForSelector('#rechnungen-seite');
      }

      // Zahlungsabgleich (Inhaber 17.11.2026): erwartet 1.722,48 (in der Skontofrist), tatsächlich bezahlt 1.700,00 →
      // Differenz 22,48 = Bankspesen 2,48 akzeptiert + Abzug Bauwesenversicherung 20,00 strittig
      await geh('#/faelligkeiten');
      await page.waitForSelector(`#faelligkeiten .fae-row[data-nr="${AUER.nr}"] [data-bezahlt]`);
      const ogVor = (await api('/faelligkeiten')).json.offenGesamt;
      await page.click(`#faelligkeiten .fae-row[data-nr="${AUER.nr}"] [data-bezahlt]`);
      await page.waitForSelector('dialog[open] #bzf');
      pruef(/1\.722,48/.test(await page.locator('#bz-abgleich [data-bz="erwartet"]').textContent()) && /passt genau/.test(await page.locator('#bz-differenz').textContent()) && await page.locator('#bz-gruende').isHidden(), 'Abgleich: erwartet 1.722,48 / „passt genau“ fehlt');
      await page.fill('#bzf [name="betrag"]', '1.700,00');
      await page.waitForSelector('#bz-gruende:not([hidden])');
      pruef(Number(await page.locator('#bz-differenz').getAttribute('data-wert')) === 22.48 && await page.locator('#bz-zeilen [data-zeile]').count() === 1 && await page.inputValue('#bz-zeilen [data-zeile="0"] [data-f="betrag"]') === '22,48', `Differenz live: ${await page.locator('#bz-differenz').textContent()}`);
      await page.selectOption('#bz-zeilen [data-zeile="0"] [data-f="grund"]', 'spesen');
      await page.fill('#bz-zeilen [data-zeile="0"] [data-f="betrag"]', '2,48');
      await page.selectOption('#bz-zeilen [data-zeile="0"] [data-f="status"]', 'akzeptiert');
      pruef(/noch zuzuordnen\s*€\s*20,00/.test(await page.locator('#bz-rest').textContent()), `Rest: ${await page.locator('#bz-rest').textContent()}`);
      // nicht vollständig aufgeteilt → Hinweis, keine Buchung
      let postsB = 0;
      const zB = (q) => { if (q.method() === 'POST' && /\/bezahlt$/.test(q.url())) postsB++; };
      page.on('request', zB);
      await page.click('#bz-ok');
      await page.waitForSelector('#bzf .form-err:not([hidden])');
      pruef(postsB === 0 && /nicht vollständig aufgeteilt/.test(await page.locator('#bzf .form-err').textContent()), 'Abgleich: unvollständige Aufteilung gebucht');
      page.off('request', zB);
      await page.click('#bz-plus');
      await page.selectOption('#bz-zeilen [data-zeile="1"] [data-f="grund"]', 'umlage');
      pruef(await page.inputValue('#bz-zeilen [data-zeile="1"] [data-f="betrag"]') === '20,00', 'zweiter Grund nicht mit dem Rest vorbelegt');
      await page.fill('#bz-zeilen [data-zeile="1"] [data-f="text"]', 'Bauwesenversicherung');
      await page.selectOption('#bz-zeilen [data-zeile="1"] [data-f="status"]', 'strittig');
      pruef(/vollständig aufgeteilt/.test(await page.locator('#bz-rest').textContent()), 'nicht „vollständig aufgeteilt“');
      if (opt.bilder) { await page.evaluate(() => { document.activeElement.blur(); document.querySelectorAll('.toast').forEach((t) => t.remove()); }); await page.locator('#bz-gruende').scrollIntoViewIfNeeded(); }
      await shot(page, '4-zahlungsabgleich');
      await page.click('#bz-ok');
      await page.waitForSelector('dialog[open] #bzf', { state: 'detached' });
      await page.waitForSelector(`#faelligkeiten [data-gruppe="differenzen"] .fae-row[data-nr="${AUER.nr}"]`);
      const ab = (await api(`/rechnungen/${auer.id}`)).json;
      pruef(ab.status === 'differenz' && ab.bezahlt === 1700 && ab.skontoGenommen === 53.27 && ab.abzuegeAkzeptiert === 2.48 && ab.strittig === 20 && ab.differenzen.length === 2, `Abgleich am Server: ${JSON.stringify({ s: ab.status, b: ab.bezahlt, sk: ab.skontoGenommen, a: ab.abzuegeAkzeptiert, st: ab.strittig })}`);
      const dz = (await page.locator(`#faelligkeiten [data-gruppe="differenzen"] .fae-row[data-nr="${AUER.nr}"]`).textContent()).replace(/\s+/g, ' ');
      pruef(/Differenz strittig/.test(dz) && /20,00/.test(dz) && /Bauwesenversicherung/.test(dz), `Zeile „Offene Differenzen“: ${dz}`);
      const ogNach = (await api('/faelligkeiten')).json.offenGesamt;
      pruef(Number(await page.locator('#offen-gesamt').getAttribute('data-wert')) === ogNach.betrag && Math.abs(ogNach.betrag - (ogVor.betrag - 1775.75 + 20)) < 0.005 && /strittige Differenzen\s*€\s*20,00/.test(await page.locator('#offen-gesamt').textContent()), `Offen gesamt nach Abgleich: ${ogNach.betrag} (vorher ${ogVor.betrag})`);
      await shot(page, '4-zahlungsabgleich-faelligkeiten');
      if (opt.bilder) { await page.evaluate(() => document.querySelector('#fae-differenzen').scrollIntoView({ block: 'center' })); await page.waitForTimeout(200); await page.screenshot({ path: path.join(opt.bilder, `4-zahlungsabgleich-offene-differenzen-${g.name}.png`) }); }
      // Liste zeigt „bezahlt · Differenz strittig“; im Detail akzeptieren → bezahlt
      await geh('#/rechnungen');
      await page.waitForSelector('#re-tabelle');
      pruef(await page.locator(`#re-tabelle tr:has-text("${AUER.nr}") [data-r-status="differenz"]`).count() === 1, 'Liste ohne Status „Differenz strittig“');
      await page.click('[data-re-status="differenz"]'); await page.waitForTimeout(400);
      pruef(await page.locator('#re-tabelle tbody tr').count() === 1, 'Filter „Differenz strittig“');
      await page.locator(`#re-tabelle tr:has-text("${AUER.nr}") td:first-child`).click();
      await page.waitForSelector('dialog[open] #re-differenzen');
      await page.click('#re-differenzen [data-diff-status="akzeptiert"]');
      await page.waitForFunction(() => !!document.querySelector('dialog[open] #re-detail [data-r-status="bezahlt"]'));
      pruef((await api(`/rechnungen/${auer.id}`)).json.status === 'bezahlt', 'Differenz akzeptieren im Detail wirkt nicht');
      await page.keyboard.press('Escape');
    });

    if (opt.bilder) return { fehler, schritte };
    /* ---- 5) Polier und Mitarbeiter: kein Geld ---- */
    for (const id of [U.polier, U.mitarbeiter]) {
      await sitzung(id, NAME[id], async ({ page, geh, api }) => {
        for (const h of ['#/rechnungen', '#/faelligkeiten', '#/offene-posten']) {
          await geh(h);
          const t = await page.locator('#view').innerText();
          pruef(await page.locator('[data-zustand="kein-zugriff"]').count() === 1 && !/€|Skonto|Rücklass|000\/W26|1\.775/.test(t), `${NAME[id]} ${h}: nicht gesperrt oder Geld sichtbar`);
          pruef(await page.locator('#re-reiter, [data-re-reiter]').count() === 0 && !/Offene Posten|Fälligkeiten|Alle Rechnungen/.test(t), `${NAME[id]} ${h}: Reiter der Rechnungen sichtbar (15.37)`);
        }
        pruef(await page.locator('[data-nav="rechnungen"], [data-nav="offeneposten"]').count() === 0, `${NAME[id]}: Menüpunkt „Rechnungen“ bzw. „Offene Posten“ sichtbar`);
        await geh('#/mehr');
        pruef(!/Rechnung|Offene Posten|Fälligkeit/.test(await page.locator('#view').innerText()) && await page.locator('#view a[href="#/rechnungen"], #view a[href="#/offene-posten"], #view a[href="#/faelligkeiten"]').count() === 0, `${NAME[id]}: „Mehr“ nennt Rechnungen/Offene Posten/Fälligkeiten (15.37)`);
        for (const p of ['/faelligkeiten', '/rechnungen', '/rechnungen?typ=regie', '/offene-posten']) {
          const r = await api(p);
          pruef(r.status === 403 && !/\d+[.,]\d\d|000\/W26/.test(JSON.stringify(r.json)), `${NAME[id]} ${p}: ${r.status}`);
        }
      });
    }
  } finally { await s.stop(); }
  return { fehler, schritte };
}

module.exports = { laufe, GROESSEN };

if (require.main === module) {
  (async () => {
    const i = process.argv.indexOf('--bilder');
    const bilder = i > 0 ? path.resolve(process.argv[i + 1]) : null;
    if (bilder) fs.mkdirSync(bilder, { recursive: true });
    const browser = await chromium.launch();
    let gesamt = 0;
    const liste = bilder ? GROESSEN.filter((x) => x.name !== 'tablet') : GROESSEN.filter((x) => !process.env.E2E_NUR || process.env.E2E_NUR.split(',').includes(x.name));
    for (const g of liste) {
      console.log(`\n▶ Rechnungen ${g.name} (${g.width}×${g.height})${bilder ? ' – Bilder' : ''}`);
      const t = Date.now();
      const r = await laufe(browser, g, { bilder });
      gesamt += r.fehler.length;
      console.log(`${r.fehler.length ? '✗' : '✓'} ${g.name}: ${r.schritte - r.fehler.length}/${r.schritte} Prüfungen bestanden (${((Date.now() - t) / 1000).toFixed(1)} s)`);
    }
    await browser.close();
    process.exit(gesamt ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(2); });
}
