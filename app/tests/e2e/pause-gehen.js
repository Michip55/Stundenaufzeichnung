'use strict';
/**
 * Begrüßung und Pause beim Gehen (API.md 15.27, Inhaber 19.11.2026) in der Oberfläche.
 *   node tests/e2e/pause-gehen.js   (im Ordner app; E2E_NUR=handy|tablet|pc; Exit-Code 1 bei Befunden)
 * Wird auch von run.js je Bildschirmgröße aufgerufen (abschaltbar mit E2E_OHNE_PAUSE_GEHEN=1).
 *
 * Server mit gesteuerter Uhr (tests/api/hilfe.js), Browser mit Playwright-Uhr (wie tests/e2e/pausen.js).
 *  1. „Pilz Thomas“ (angelegt als Nachname Vorname): Begrüßung „Guten Morgen, Thomas“. Kommen 07:00, um 16:00 AZG-Hinweis
 *     „ohne 30 Min. Pause“; „Gehen“ → Dialog „Heute keine Pause gestempelt“ (30/45/60 Min, „Keine Pause“, Beginn ca. 12:00,
 *     Fokus auf „30 Min“, kein Überlauf); Abbrechen und X buchen nichts; „30 Min“ bucht Pause 12:00–12:30 und Gehen:
 *     Heute „Pause 30 min“, Arbeitszeit 8 Std. 30 Min., Zeitleiste „beim Gehen nachgetragen“, AZG-Hinweis weg, Meine Woche
 *     8 Std. 30 Min., Korrekturen (Büro) mit Hinweis „beim Gehen nachgetragen“.
 *  2. Name mit einem Wort („Schwarz“): Begrüßung „Schwarz“; „Keine Pause“ bucht nur Gehen (Handy: bei 320 px).
 *  2a. Schicht 07:00–10:00: ein Vorschlag für alle Dauern (08:00), die Spannen unter den Knöpfen beginnen alle dort.
 *  3. Schicht 13:00–18:00: Beginn ca. 15:00 statt 12:00; Beginn 17:45 → Meldung, nichts gebucht; 15:00 → gebucht.
 *  4. Live gestempelte Pause → „Gehen“ ohne Dialog.
 *  5. Ohne Netz: „Gehen“ mit 45 Min → eine Buchung in der Warteschlange, Zeitleiste zeigt die Pause; nach dem Nachsenden
 *     am Server Pause 12:00–12:45 und Gehen in dieser Reihenfolge.
 *  6. Baustellenwechsel um 12:10 (vom Polier, die Stempeluhr zeigt noch den alten Stand): „Gehen“ holt den Stand neu,
 *     Beginn ca. 12:15 (nicht 12:00), alle Spannen ab 12:15; „60 Min“ bucht 12:15–13:15.
 *  7. Ohne Netz, der Polier bucht inzwischen die Pause über die Kolonne: Dialog erscheint (alter Stand), „30 Min“ →
 *     nach dem Nachsenden ist das Gehen gebucht (nicht „nicht übernommen“), nur die Kolonnen-Pause zählt, Hinweis + Protokoll.
 *  8. Mit Netz, Pause inzwischen über die Kolonne gebucht: „Gehen“ holt den Stand neu und fragt nicht.
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
const hmVon = (iso) => new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
const MA = U.mitarbeiter, DANIEL = 3, ROLAND = 4, FABIAN = 6, KARL = 7, CHRISTIAN = 9, GUENTER = 10;
const NAME = { [MA]: 'Pilz Thomas', [DANIEL]: 'Schwarz', [ROLAND]: 'Roland Kerschbaumer', [FABIAN]: 'Fabian Stickler', [KARL]: 'Karl Ungersböck', [CHRISTIAN]: 'Christian Trimmel', [GUENTER]: 'Günter Scherz', [U.buero]: 'Martina Koller' };
const ws = (t) => String(t || '').replace(/\s+/g, ' ').trim();

async function laufe(browser, g) {
  const fehler = [];
  let schritte = 0;
  const pruef = (ok, text) => { schritte++; if (!ok) { fehler.push(`Pause beim Gehen/${g.name}: ${text}`); console.log(`    ✗ Pause beim Gehen/${g.name}: ${text}`); } };
  const s = await starte({ test: true });
  try {
    s.db.lauf(`DELETE FROM buchung WHERE benutzer_id IN (${[MA, DANIEL, ROLAND, FABIAN, KARL, CHRISTIAN, GUENTER].join(',')}) AND zeit >= '2026-11-10'`);
    s.db.lauf('DELETE FROM abwesenheit WHERE datum = ?', TAG);
    // „Nachname Vorname“ wie in der Firma angelegt; eine Person mit nur einem Wort
    s.db.lauf('UPDATE benutzer SET name = ? WHERE id = ?', NAME[MA], MA);
    s.db.lauf('UPDATE benutzer SET name = ? WHERE id = ?', NAME[DANIEL], DANIEL);
    s.uhr.setze(um('07:00').toISOString());
    const buchungen = (id) => s.db.alle('SELECT typ, zeit, quelle, automatisch, nachgetragen, baustelle_id FROM buchung WHERE benutzer_id = ? AND zeit >= ? ORDER BY zeit, id', id, um('00:00').toISOString());

    async function sitzung(benutzerId, wo, f, breite) {
      const ctx = await browser.newContext({ viewport: { width: breite || g.width, height: g.height }, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: g.mobil, serviceWorkers: 'block' });
      await ctx.clock.install({ time: s.uhr() });
      const page = await ctx.newPage();
      page.setDefaultTimeout(10000);
      const konsole = [];
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) konsole.push(m.text().slice(0, 160)); });
      page.on('pageerror', (e) => konsole.push(String(e.message).slice(0, 160)));
      const name = NAME[benutzerId];
      await page.goto(s.basis + '/#/login');
      await page.waitForSelector('.login-user');
      await page.fill('#login-suche', name.split(' ').pop());
      await page.click(`.login-user:has-text("${name}")`);
      await page.waitForSelector('.pin-pad');
      for (const z of '1234') await page.click(`.pin-pad [data-z="${z}"]`);
      await page.click('.pin-pad [data-ok]');
      await page.waitForSelector('#view');
      await page.waitForFunction(() => !document.querySelector('#view .view-box > .state .spinner, #root > .state .spinner'), null, { timeout: 10000 });
      const geh = async (h) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForFunction((x) => location.hash === x, h); await page.waitForFunction(() => !document.querySelector('#view .view-box > .state .spinner'), null, { timeout: 10000 }); await page.waitForTimeout(150); };
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
    const kommen = async (page, gleich) => {
      await page.waitForSelector('.clock-card[data-status="aus"] [data-stempel="kommen"]');
      await gleich();
      await page.click('[data-stempel="kommen"]');
      await page.waitForSelector('.clock-card[data-status="arbeit"]');
    };
    const offen = (page) => page.waitForSelector('dialog[open] #pause-gehen');
    const dialogZu = (page) => page.waitForFunction(() => !document.querySelector('dialog[open]'));
    const ueberlauf = async (page, was) => {
      const r = await page.evaluate(() => {
        const d = document.querySelector('dialog[open]');
        const zuSchmal = d ? [...d.querySelectorAll('button, input')].filter((e) => e.offsetParent !== null && e.getBoundingClientRect().height < 44).map((e) => (e.textContent || e.id || e.className).trim().slice(0, 20)) : [];
        return { doc: document.documentElement.scrollWidth - window.innerWidth, dlg: d ? d.scrollWidth - d.clientWidth : 0, rechts: d ? Math.round(d.getBoundingClientRect().right - window.innerWidth) : 0, zuSchmal };
      });
      pruef(r.doc <= 1 && r.dlg <= 1 && r.rechts <= 0, `${was}: Überlauf (Seite ${r.doc}, Dialog ${r.dlg}, rechts ${r.rechts})`);
      // Handschuhe am Handy: jede Schaltfläche und das Zeitfeld mindestens 44 px hoch (am PC gilt die übliche Größe)
      if (g.width <= 719) pruef(r.zuSchmal.length === 0, `${was}: Knöpfe/Felder niedriger als 44 px: ${r.zuSchmal.join(' | ')}`);
    };

    /* ---- 1) „Pilz Thomas“: Begrüßung, Dialog, Abbrechen/X, 30 Min ab 12:00 ---- */
    await sitzung(MA, 'Pilz Thomas', async ({ page, geh, vergeht, gleich }) => {
      await geh('#/stempeln');
      pruef(ws(await page.locator('.cc-greet').innerText()) === 'Guten Morgen, Thomas', `Begrüßung „${ws(await page.locator('.cc-greet').innerText())}“ statt „Guten Morgen, Thomas“`);
      await kommen(page, gleich);
      await vergeht(9 * 60); // 16:00
      await page.reload(); await page.waitForSelector('.clock-card[data-status="arbeit"]');
      pruef(/ohne 30 Min\. Pause \(§ 11 AZG\)/.test(await page.locator('#view').innerText()), 'Vorbedingung: AZG-Hinweis „ohne 30 Min. Pause“ fehlt nach 9 Std. ohne Pause');
      // Dialog
      await page.click('[data-stempel="gehen"]');
      await offen(page);
      const titel = ws(await page.locator('dialog[open] h2').innerText());
      pruef(titel === 'Heute keine Pause gestempelt', `Dialogtitel „${titel}“`);
      pruef(/Wie lange war deine Pause\?/.test(await page.locator('dialog[open]').innerText()), 'Frage „Wie lange war deine Pause?“ fehlt');
      const opt = (await page.locator('dialog[open] [data-pg-min] b').allInnerTexts()).map(ws);
      pruef(JSON.stringify(opt) === JSON.stringify(['30 Min', '45 Min', '60 Min']), `Dauern „${opt.join(' · ')}“ statt „30 Min · 45 Min · 60 Min“ (ohne „offen“)`);
      pruef(await page.locator('dialog[open] [data-pg-keine]').innerText().then(ws) === 'Keine Pause', '„Keine Pause“ fehlt');
      pruef(await page.inputValue('dialog[open] #pg-beginn') === '12:00' && await page.getAttribute('dialog[open] #pg-beginn', 'type') === 'time', `Beginn ca. „${await page.inputValue('dialog[open] #pg-beginn')}“ statt 12:00 (type=time)`);
      pruef(/Beginn ca\./.test(await page.locator('dialog[open] .pg-beginn').textContent()), 'Beschriftung „Beginn ca.“ fehlt');
      pruef(await page.evaluate(() => document.activeElement && document.activeElement.matches('dialog[open] [data-pg-min="30"]')), 'Fokus steht nicht auf „30 Min“');
      pruef(ws(await page.locator('dialog[open] [data-pg-min="30"] small').innerText()) === '12:00 – 12:30', `Spanne bei 30 Min „${ws(await page.locator('dialog[open] [data-pg-min="30"] small').innerText())}“`);
      await ueberlauf(page, 'Dialog Pause beim Gehen');
      // Abbrechen bucht nichts
      await page.click('dialog[open] .dlg-foot [data-zu]');
      await dialogZu(page);
      pruef(buchungen(MA).length === 1 && (await page.locator('.clock-card').getAttribute('data-status')) === 'arbeit', `Abbrechen hat gebucht: ${JSON.stringify(buchungen(MA).map((x) => x.typ))}`);
      // X bucht nichts; Tastatur: Escape ebenso
      await page.click('[data-stempel="gehen"]'); await offen(page);
      await page.click('dialog[open] .dlg-head [data-zu]'); await dialogZu(page);
      await page.click('[data-stempel="gehen"]'); await offen(page);
      await page.keyboard.press('Escape'); await dialogZu(page);
      pruef(buchungen(MA).length === 1, 'X oder Escape hat gebucht');
      // 30 Min ab 12:00
      await page.click('[data-stempel="gehen"]'); await offen(page);
      await gleich();
      await page.click('dialog[open] [data-pg-min="30"]');
      await page.waitForSelector('.clock-card[data-status="aus"]');
      const b = buchungen(MA);
      pruef(JSON.stringify(b.map((x) => [x.typ, hmVon(x.zeit), x.nachgetragen])) === JSON.stringify([['kommen', '07:00', 0], ['pause_start', '12:00', 1], ['pause_ende', '12:30', 1], ['gehen', '16:00', 0]]), `Server-Buchungen: ${JSON.stringify(b.map((x) => [x.typ, hmVon(x.zeit), x.nachgetragen]))}`);
      const toast = ws(await page.locator('.toast').first().innerText().catch(() => ''));
      pruef(/Pause 30 Min ab 12:00 Uhr nachgetragen/.test(toast), `Rückmeldung „${toast}“`);
      const summe = ws(await page.locator('.sum-grid').innerText());
      pruef(/Pause 30 min/.test(summe) && /Arbeitszeit 8 Std\. 30 Min\./.test(summe), `Heute: „${summe}“ statt Arbeitszeit 8 Std. 30 Min. / Pause 30 min`);
      const nt = (await page.locator('.timeline li[data-nachgetragen]').allInnerTexts()).map(ws);
      pruef(nt.length === 2 && nt[0].includes('12:00') && nt[0].includes('Pause begonnen (30 Min)') && nt[1].includes('12:30') && nt.every((x) => x.includes('beim Gehen nachgetragen')), `Zeitleiste: ${JSON.stringify(nt)}`);
      pruef(!/§ 11 AZG/.test(await page.locator('#view').innerText()), 'AZG-Hinweis „ohne Pause“ nach dem Nachtragen noch sichtbar');
      const st = await page.evaluate(async () => (await fetch('/api/zeit/status')).json());
      pruef(st.heute.pauseMin === 30 && st.heute.stunden === 8.5 && !st.warnungen.some((w) => w.typ === 'pause'), `Status: Pause ${st.heute.pauseMin}, Stunden ${st.heute.stunden}, Warnungen ${JSON.stringify(st.warnungen)}`);
      await geh('#/woche');
      const tag = ws(await page.locator(`[data-tag-std="${TAG}"]`).innerText().catch(() => ''));
      pruef(tag === '8 Std. 30 Min.', `Meine Woche: Tag „${tag}“ statt „8 Std. 30 Min.“`);
    });
    await sitzung(U.buero, 'Korrekturen (Büro)', async ({ page, geh }) => {
      await geh(`#/korrektur?benutzerId=${MA}&von=${TAG}&bis=${TAG}`);
      await page.waitForSelector('[data-buchung]', { timeout: 8000 }).catch(() => {});
      let n = await page.locator('[data-buchung] [data-nachgetragen]').count();
      if (!n) {
        // Ansicht ohne Adressparameter: Person in der Auswahl wählen
        const sel = page.locator('#view select').first();
        if (await sel.count()) { await sel.selectOption(String(MA)).catch(() => {}); await page.waitForTimeout(600); }
        n = await page.locator('[data-buchung] [data-nachgetragen]').count();
      }
      pruef(n === 2, `Korrekturen: ${n} statt 2 Buchungen mit Hinweis „beim Gehen nachgetragen“`);
      const api = await page.evaluate(async (q) => (await fetch('/api/zeit/buchungen?' + q)).json(), `benutzerId=${MA}&von=${TAG}&bis=${TAG}`);
      pruef(api.filter((x) => x.nachgetragen).length === 2, `Korrekturen (API): ${JSON.stringify(api.map((x) => [x.typ, x.nachgetragen]))}`);
      const prot = s.db.eins("SELECT text FROM protokoll WHERE text LIKE 'Pause beim Gehen nachgetragen%' ORDER BY id DESC");
      pruef(prot && prot.text === 'Pause beim Gehen nachgetragen (30 Min ab 12:00)', `Protokoll: ${prot && prot.text}`);
    });

    /* ---- 2) Ein Wort im Namen; „Keine Pause“ (Handy: 320 px) ---- */
    s.uhr.setze(um('07:00').toISOString());
    await sitzung(DANIEL, 'Keine Pause', async ({ page, geh, vergeht, gleich }) => {
      await geh('#/stempeln');
      pruef(ws(await page.locator('.cc-greet').innerText()) === 'Guten Morgen, Schwarz', `Begrüßung „${ws(await page.locator('.cc-greet').innerText())}“ statt „Guten Morgen, Schwarz“`);
      await kommen(page, gleich);
      await vergeht(3 * 60); // 10:00 – 12:00 liegt noch nicht in der Schicht
      await page.click('[data-stempel="gehen"]'); await offen(page);
      // ein Vorschlag für alle Dauern: Mitte der Schicht für 60 Min (08:00) – gilt auch für 30 und 45 (Review N8)
      pruef(await page.inputValue('dialog[open] #pg-beginn') === '08:00', `Beginn ca. bei 07:00–10:00: „${await page.inputValue('dialog[open] #pg-beginn')}“ statt 08:00 (Mitte der Schicht)`);
      const sp2 = (await page.locator('dialog[open] [data-pg-min] small').allInnerTexts()).map(ws);
      pruef(JSON.stringify(sp2) === JSON.stringify(['08:00 – 08:30', '08:00 – 08:45', '08:00 – 09:00']), `Spannen widersprechen dem Feld: ${JSON.stringify(sp2)}`);
      await ueberlauf(page, `Dialog bei ${g.name === 'handy' ? 320 : g.width} px`);
      await gleich();
      await page.click('dialog[open] [data-pg-keine]');
      await page.waitForSelector('.clock-card[data-status="aus"]');
      pruef(JSON.stringify(buchungen(DANIEL).map((x) => x.typ)) === '["kommen","gehen"]', `„Keine Pause“: ${JSON.stringify(buchungen(DANIEL).map((x) => x.typ))}`);
    }, g.name === 'handy' ? 320 : undefined);

    /* ---- 3) Schicht 13:00–18:00: Vorschlag, Meldung, Buchung ---- */
    s.uhr.setze(um('13:00').toISOString());
    await sitzung(DANIEL, 'Schicht am Nachmittag', async ({ page, geh, vergeht, gleich }) => {
      await geh('#/stempeln');
      pruef(ws(await page.locator('.cc-greet').innerText()) === 'Servus, Schwarz', `Begrüßung am Nachmittag „${ws(await page.locator('.cc-greet').innerText())}“`);
      await kommen(page, gleich);
      await vergeht(5 * 60); // 18:00
      await page.click('[data-stempel="gehen"]'); await offen(page);
      pruef(await page.inputValue('dialog[open] #pg-beginn') === '15:00', `Beginn ca. bei 13:00–18:00: „${await page.inputValue('dialog[open] #pg-beginn')}“ statt 15:00`);
      await page.fill('dialog[open] #pg-beginn', '17:45');
      await page.click('dialog[open] [data-pg-min="30"]');
      await page.waitForSelector('dialog[open] #pg-fehler:not([hidden])');
      const meldung = ws(await page.locator('dialog[open] #pg-fehler').innerText());
      pruef(/bis jetzt \(18:00 Uhr\) vorbei/.test(meldung) && (await page.getAttribute('dialog[open] #pg-fehler', 'role')) === 'alert', `Meldung „${meldung}“`);
      pruef(buchungen(DANIEL).length === 3, 'falscher Beginn: trotzdem gebucht');
      await page.fill('dialog[open] #pg-beginn', '15:00');
      pruef(await page.locator('dialog[open] #pg-fehler').isHidden(), 'Meldung bleibt nach dem Ändern stehen');
      await gleich();
      await page.click('dialog[open] [data-pg-min="30"]');
      await page.waitForSelector('.clock-card[data-status="aus"]');
      const b = buchungen(DANIEL).slice(-4);
      pruef(JSON.stringify(b.map((x) => [x.typ, hmVon(x.zeit)])) === JSON.stringify([['kommen', '13:00'], ['pause_start', '15:00'], ['pause_ende', '15:30'], ['gehen', '18:00']]), `Nachmittag: ${JSON.stringify(b.map((x) => [x.typ, hmVon(x.zeit)]))}`);
    });

    /* ---- 4) Live gestempelte Pause → kein Dialog ---- */
    s.uhr.setze(um('07:00').toISOString());
    await sitzung(ROLAND, 'Pause gestempelt', async ({ page, geh, vergeht, gleich }) => {
      await geh('#/stempeln');
      await kommen(page, gleich);
      await vergeht(5 * 60);
      await page.click('[data-stempel="pause_start"]');
      await page.waitForSelector('dialog[open] #pause-wahl');
      await gleich();
      await page.click('dialog[open] [data-pause-min="30"]');
      await page.waitForSelector('.clock-card[data-status="pause"]');
      await vergeht(31);
      await page.waitForSelector('.clock-card[data-status="arbeit"]', { timeout: 8000 });
      await vergeht(60);
      await gleich();
      await page.click('[data-stempel="gehen"]');
      await page.waitForSelector('.clock-card[data-status="aus"]');
      pruef(await page.locator('#pause-gehen').count() === 0, 'Dialog erscheint trotz gestempelter Pause');
      pruef(JSON.stringify(buchungen(ROLAND).map((x) => x.typ)) === '["kommen","pause_start","pause_ende","gehen"]', `mit Pause: ${JSON.stringify(buchungen(ROLAND).map((x) => x.typ))}`);
    });

    /* ---- 5) Ohne Netz ---- */
    s.uhr.setze(um('07:00').toISOString());
    await sitzung(FABIAN, 'Ohne Netz', async ({ page, ctx, geh, vergeht, gleich }) => {
      await geh('#/stempeln');
      await kommen(page, gleich);
      await vergeht(6 * 60); // 13:00
      await ctx.setOffline(true);
      await page.click('[data-stempel="gehen"]'); await offen(page);
      pruef(await page.inputValue('dialog[open] #pg-beginn') === '12:00', `ohne Netz: Beginn ca. „${await page.inputValue('dialog[open] #pg-beginn')}“`);
      const gehenUm = await page.evaluate(() => Date.now());
      await page.click('dialog[open] [data-pg-min="45"]');
      await page.waitForSelector('#sync[data-ausstehend="1"]');
      await page.waitForSelector('.clock-card[data-status="aus"]');
      const q = await page.evaluate(() => JSON.parse(localStorage.getItem('bt_stempel_queue') || '[]'));
      pruef(q.length === 1 && q[0].typ === 'gehen' && q[0].pauseBeimGehen && q[0].pauseBeimGehen.dauerMin === 45 && hmVon(q[0].pauseBeimGehen.beginn) === '12:00', `ohne Netz: Warteschlange ${JSON.stringify(q)}`);
      const nt = (await page.locator('.timeline li[data-nachgetragen]').allInnerTexts()).map(ws);
      pruef(nt.length === 2 && nt[0].includes('12:00') && nt[1].includes('12:45') && nt.every((x) => /noch nicht gesendet/.test(x)), `ohne Netz: Zeitleiste ${JSON.stringify(nt)}`);
      const reihe = (await page.locator('.timeline li time').allInnerTexts()).map(ws);
      pruef(JSON.stringify(reihe) === JSON.stringify([...reihe].sort()), `ohne Netz: Zeitleiste nicht nach Uhrzeit: ${reihe.join(', ')}`);
      pruef(/Pause 45 min/.test(ws(await page.locator('.sum-grid').innerText())), `ohne Netz: Heute „${ws(await page.locator('.sum-grid').innerText())}“`);
      await vergeht(10);
      await ctx.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('bt_stempel_queue') || '[]').length === 0, null, { timeout: 30000, polling: 200 });
      const b = buchungen(FABIAN);
      pruef(JSON.stringify(b.map((x) => [x.typ, x.typ === 'gehen' ? '' : hmVon(x.zeit), x.quelle, x.nachgetragen])) === JSON.stringify([['kommen', '07:00', 'app', 0], ['pause_start', '12:00', 'offline', 1], ['pause_ende', '12:45', 'offline', 1], ['gehen', '', 'offline', 0]]), `ohne Netz, am Server: ${JSON.stringify(b)}`);
      const g4 = b.find((x) => x.typ === 'gehen');
      pruef(g4 && Math.abs(new Date(g4.zeit).getTime() - gehenUm) < 5000, `ohne Netz: Gehen am Server ${g4 && g4.zeit} statt der Zeit des Tippens`);
      await page.waitForSelector('#sync[data-abgelehnt="0"]');
      const st = await page.evaluate(async () => (await fetch('/api/zeit/status')).json());
      pruef(st.status === 'aus' && st.heute.pauseMin === 45, `ohne Netz, nach dem Nachsenden: ${st.status}, Pause ${st.heute.pauseMin}`);
    });

    // Buchung „vom Polier über die Kolonne“ direkt am Server (das Gerät der Person erfährt davon nichts)
    const kolonne = (id, typ, hm, extra = {}) => {
      const k = buchungen(id).find((x) => x.typ === 'kommen');
      s.db.lauf(`INSERT INTO buchung (benutzer_id, typ, zeit, baustelle_id, quelle, erfasst_von, erfasst, pause_plan_min) VALUES (?, ?, ?, ?, 'kolonne', ?, ?, ?)`,
        id, typ, um(hm).toISOString(), extra.baustelleId ?? (k && k.baustelle_id), U.polier, new Date(s.uhr()).toISOString(), extra.dauerMin ?? null);
    };

    /* ---- 6) Baustellenwechsel um 12:10: Vorschlag weicht aus, ein Beginn für alle Dauern (Review N8) ---- */
    s.uhr.setze(um('07:00').toISOString());
    await sitzung(KARL, 'Wechsel zu Mittag', async ({ page, geh, vergeht, gleich }) => {
      await geh('#/stempeln');
      await kommen(page, gleich);
      await vergeht(9 * 60); // 16:00
      kolonne(KARL, 'wechsel', '12:10', { baustelleId: BS.kogler });
      await gleich();
      await page.click('[data-stempel="gehen"]'); await offen(page);
      pruef(await page.inputValue('dialog[open] #pg-beginn') === '12:15', `Wechsel 12:10: Beginn ca. „${await page.inputValue('dialog[open] #pg-beginn')}“ statt 12:15`);
      const sp = (await page.locator('dialog[open] [data-pg-min] small').allInnerTexts()).map(ws);
      pruef(JSON.stringify(sp) === JSON.stringify(['12:15 – 12:45', '12:15 – 13:00', '12:15 – 13:15']), `Wechsel 12:10: Spannen ${JSON.stringify(sp)}`);
      await gleich();
      await page.click('dialog[open] [data-pg-min="60"]');
      await page.waitForSelector('.clock-card[data-status="aus"]');
      const b = buchungen(KARL);
      pruef(JSON.stringify(b.map((x) => [x.typ, hmVon(x.zeit)])) === JSON.stringify([['kommen', '07:00'], ['wechsel', '12:10'], ['pause_start', '12:15'], ['pause_ende', '13:15'], ['gehen', '16:00']]), `Wechsel 12:10, 60 Min: ${JSON.stringify(b.map((x) => [x.typ, hmVon(x.zeit)]))}`);
    });

    /* ---- 7) Ohne Netz + Kolonnen-Pause: das Gehen geht nicht verloren (Review N8) ---- */
    s.uhr.setze(um('07:00').toISOString());
    await sitzung(CHRISTIAN, 'Ohne Netz, Kolonnen-Pause', async ({ page, ctx, geh, vergeht, gleich }) => {
      await geh('#/stempeln');
      await kommen(page, gleich);
      await vergeht(5 * 60); // 12:00
      await ctx.setOffline(true);
      kolonne(CHRISTIAN, 'pause_start', '12:00', { dauerMin: 30 });
      kolonne(CHRISTIAN, 'pause_ende', '12:30');
      await vergeht(4 * 60); // 16:00
      await page.click('[data-stempel="gehen"]'); await offen(page);
      await page.click('dialog[open] [data-pg-min="30"]');
      await page.waitForSelector('#sync[data-ausstehend="1"]');
      await page.waitForSelector('.clock-card[data-status="aus"]');
      await vergeht(5);
      await ctx.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('bt_stempel_queue') || '[]').length === 0, null, { timeout: 30000, polling: 200 });
      const b = buchungen(CHRISTIAN);
      pruef(JSON.stringify(b.map((x) => [x.typ, hmVon(x.zeit), x.quelle, x.nachgetragen])) === JSON.stringify([['kommen', '07:00', 'app', 0], ['pause_start', '12:00', 'kolonne', 0], ['pause_ende', '12:30', 'kolonne', 0], ['gehen', '16:00', 'offline', 0]]), `Kolonnen-Pause offline, am Server: ${JSON.stringify(b.map((x) => [x.typ, hmVon(x.zeit), x.quelle, x.nachgetragen]))}`);
      await page.waitForSelector('#sync[data-abgelehnt="0"]').catch(() => {});
      pruef(await page.getAttribute('#sync', 'data-abgelehnt') === '0', `Kolonnen-Pause offline: abgelehnt ${await page.getAttribute('#sync', 'data-abgelehnt')}`);
      const toasts = ws((await page.locator('.toast').allInnerTexts()).join(' | '));
      pruef(/Die Pausenangabe dazu nicht/.test(toasts), `Kolonnen-Pause offline: Hinweis fehlt („${toasts}“)`);
      const st = await page.evaluate(async () => (await fetch('/api/zeit/status')).json());
      pruef(st.status === 'aus' && st.heute.pauseMin === 30, `Kolonnen-Pause offline, Status: ${st.status}, Pause ${st.heute.pauseMin}`);
      const prot = s.db.eins("SELECT text FROM protokoll WHERE text LIKE 'Pausenangabe beim Gehen verworfen%' ORDER BY id DESC");
      pruef(prot && prot.text === 'Pausenangabe beim Gehen verworfen (30 Min ab 12:00) – in der Schicht ist schon eine Pause gebucht', `Protokoll: ${prot && prot.text}`);
    });

    /* ---- 8) Mit Netz, Pause inzwischen über die Kolonne gebucht → keine Frage (Review N8) ---- */
    s.uhr.setze(um('07:00').toISOString());
    await sitzung(GUENTER, 'Kolonnen-Pause, alter Stand', async ({ page, geh, vergeht, gleich }) => {
      await geh('#/stempeln');
      await kommen(page, gleich);
      await vergeht(9 * 60); // 16:00
      kolonne(GUENTER, 'pause_start', '12:00', { dauerMin: 30 });
      kolonne(GUENTER, 'pause_ende', '12:30');
      await gleich();
      let dialogGesehen = false;
      await page.evaluate(() => { window.__pgGesehen = false; new MutationObserver(() => { if (document.querySelector('#pause-gehen')) window.__pgGesehen = true; }).observe(document.body, { childList: true, subtree: true }); });
      await page.click('[data-stempel="gehen"]');
      await page.waitForSelector('.clock-card[data-status="aus"]').catch(() => {});
      dialogGesehen = await page.evaluate(() => window.__pgGesehen);
      pruef(!dialogGesehen, 'Kolonnen-Pause (alter Stand): Dialog erscheint trotzdem');
      const b = buchungen(GUENTER);
      pruef(JSON.stringify(b.map((x) => [x.typ, hmVon(x.zeit)])) === JSON.stringify([['kommen', '07:00'], ['pause_start', '12:00'], ['pause_ende', '12:30'], ['gehen', '16:00']]), `Kolonnen-Pause (alter Stand): ${JSON.stringify(b.map((x) => [x.typ, hmVon(x.zeit)]))}`);
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
      console.log(`\n▶ Pause beim Gehen ${g.name} (${g.width}×${g.height})`);
      const t = Date.now();
      const r = await laufe(browser, g);
      gesamt += r.fehler.length;
      console.log(`${r.fehler.length ? '✗' : '✓'} ${g.name}: ${r.schritte - r.fehler.length}/${r.schritte} Prüfungen bestanden (${((Date.now() - t) / 1000).toFixed(1)} s)`);
    }
    await browser.close();
    process.exit(gesamt ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(2); });
}
