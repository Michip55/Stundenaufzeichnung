'use strict';
/**
 * Neue Übersicht (API.md 15.20, Inhaber 17.11.2026):
 *   node tests/e2e/uebersicht.js        (im Ordner app; E2E_NUR=handy|tablet|pc; Exit-Code 1 bei Befunden)
 * Wird auch von run.js je Bildschirmgröße aufgerufen (abschaltbar mit E2E_OHNE_UEBERSICHT=1).
 *
 *  1. Ruhig: keine unterstrichenen oder blauen Links, keine alten Kacheln; ab 720 px zwei Spalten (höchstens ~1100 px).
 *  2. „Einteilung für morgen“: bei unveröffentlichten Änderungen oben und gelb umrandet; „Veröffentlichen“ öffnet die
 *     Bestätigung des Planers (Empfängerliste) und veröffentlicht NICHT von selbst; Abbrechen lässt alles unveröffentlicht.
 *  3. „Zur Freigabe“: „Freigeben“ direkt in der Zeile (Rückfrage, Toast, Bericht freigegeben); bei einem Konflikt (inzwischen
 *     freigegeben) öffnet sich der Bericht; Tippen auf den Text öffnet den Bericht.
 *  4. „Eingestempelt“ klappt die Liste der Eingestempelten auf.
 *  5. „Klassische Übersicht verwenden“ unter „Mehr“ stellt die alte Ansicht wieder her – und zurück.
 *  6. Polier mit Ausnahme „Berichte freigeben“ sieht die Übersicht ohne Geld und ohne Planer (auch nicht im Netz);
 *     Polier und Mitarbeiter ohne Ausnahme sehen sie gar nicht.
 *  7. Prüfbefunde n8-s: klassische Übersicht – zweite Kachelreihe direkt unter der ersten; Büro ohne Berichtsrechte und ohne
 *     Stammdaten (Rechte-Matrix) – „Heute“ und „Rechnungen“ ab 720 px nebeneinander, keine leere rechte Hälfte.
 */
const { chromium } = require('playwright');
const { starte, U, BS, START } = require('../api/hilfe');

const MORGEN = '2026-11-13'; // START ist Do 12.11.2026 → nächster Arbeitstag Fr 13.11.
const GELD_PFADE = /^\/api\/(offene-posten|kalkulation|baustellen-kennzahlen|monat|plan\/|zeit\/heute-eingeteilt|preise)/;

async function laufe(browser, g) {
  const fehler = [];
  let schritte = 0;
  const pruef = (ok, text) => { schritte++; if (!ok) { fehler.push(text); console.log('    ✗ ' + text); } };
  const s = await starte({ test: true, sitzung: { feldMin: 60 * 24 * 60, bueroMin: 60 * 24 * 60, maxH: 24 * 60 } });
  const gf = s.client();
  await gf.post('/auth/login', { benutzerId: U.gf, pin: '1234' });
  for (const recht of ['bericht_freigeben']) { const r = await gf.put('/rechte/ausnahme', { benutzerId: U.polier2, recht, wert: true }); if (r.status >= 300) throw new Error(`Ausnahme ${recht}: ${r.status}`); }

  async function sitzung(bid, fn) {
    const ctx = await browser.newContext({ viewport: { width: g.width, height: g.height }, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: g.mobil, serviceWorkers: 'block' });
    await ctx.clock.install({ time: new Date(START) });
    const page = await ctx.newPage();
    const konsole = [], antworten = [];
    page.on('console', (m) => { if (m.type() === 'error') konsole.push(m.text().slice(0, 160)); });
    page.on('pageerror', (e) => konsole.push('pageerror: ' + String(e.message).slice(0, 160)));
    page.on('response', (r) => { const u = r.url(); if (u.startsWith(s.basis + '/api/')) antworten.push({ pfad: u.slice(s.basis.length), status: r.status() }); });
    try {
      await page.goto(s.basis + '/#/login', { waitUntil: 'domcontentloaded' });
      const st = await page.evaluate(async (id) => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ benutzerId: id, pin: '1234' }) })).status, bid);
      if (st !== 200) throw new Error(`Anmeldung ${bid}: ${st}`);
      await page.evaluate(() => localStorage.setItem('bt_ich', '{}'));
      await page.goto(`${s.basis}/?start=${bid}#/`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#view', { state: 'attached' });
      const geh = async (r) => {
        await page.evaluate((x) => { location.hash = x; }, '#' + r);
        await page.waitForFunction((x) => location.hash === '#' + x, r);
        await page.waitForFunction(() => !document.querySelector('#view .view-box > .state .spinner'), null, { timeout: 15000 });
        await page.waitForTimeout(150);
      };
      const api = (m, p, b) => page.evaluate(async ([m2, p2, b2]) => { const r = await fetch('/api' + p2, { method: m2, headers: { 'Content-Type': 'application/json' }, body: m2 === 'GET' ? undefined : JSON.stringify(b2 || {}) }); let j = null; try { j = await r.json(); } catch (e) { /* kein JSON */ } return { status: r.status, json: j }; }, [m, p, b]);
      await fn({ page, geh, api, antworten });
    } catch (e) {
      pruef(false, `[Übersicht ${bid}/${g.name}] Abbruch: ${String(e.message).slice(0, 200)}`);
    } finally {
      pruef(konsole.filter((t) => !/409|403|Conflict|Forbidden/.test(t)).length === 0, `[Übersicht ${bid}/${g.name}] Konsolenfehler: ${konsole.slice(0, 3).join(' | ')}`);
      await ctx.close();
    }
  }

  // Keine unterstrichenen/blauen Links in der Übersicht (Inhaber: „alles blau unterstrichen“)
  const ruhig = (page) => page.evaluate(() => {
    const out = [];
    for (const a of document.querySelectorAll('#view a')) {
      const r = a.getBoundingClientRect(); if (!r.width || !r.height) continue;
      const cs = getComputedStyle(a);
      if (/underline/.test(cs.textDecorationLine)) out.push(`unterstrichen: ${a.textContent.trim().slice(0, 40)}`);
      if (cs.color === 'rgb(31, 85, 196)') out.push(`blau: ${a.textContent.trim().slice(0, 40)}`);
    }
    return out;
  });

  try {
    /* ---------------- Büro ---------------- */
    await sitzung(U.buero, async ({ page, geh, api }) => {
      const wo = `Übersicht Büro/${g.name}`;
      await geh('/dashboard');
      pruef(await page.locator('#ue').count() === 1, `${wo}: neue Übersicht fehlt (Standard muss die neue Ansicht sein)`);
      pruef(await page.locator('#view .kpi, #view .kpi-row').count() === 0, `${wo}: alte Kacheln in der neuen Übersicht`);
      const r1 = await ruhig(page);
      pruef(r1.length === 0, `${wo}: ${r1.slice(0, 3).join(' | ')}`);
      const lay = await page.evaluate(() => { const p = document.querySelector('#ue'); const cs = getComputedStyle(p); return { disp: cs.display, spalten: cs.gridTemplateColumns.split(' ').filter(Boolean).length, breite: p.getBoundingClientRect().width }; });
      if (g.width >= 720) pruef(lay.disp === 'grid' && lay.spalten === 2 && lay.breite <= 1100, `${wo}: PC/Tablet nicht zweispaltig bzw. zu breit (${JSON.stringify(lay)})`);
      else pruef(lay.disp !== 'grid' || lay.spalten === 1, `${wo}: Handy mehrspaltig (${JSON.stringify(lay)})`);
      pruef(await page.locator('#bv-kacheln').count() === 1, `${wo}: Abschnitt „Rechnungen“ fehlt fürs Büro`);
      // Prüfbefund n8-g (Bild 12): „Rechnungen“ schließt direkt an „Heute“ an (keine Lücke bis zum Ende von „Zur Freigabe“);
      // am Handy bleibt die Reihenfolge Heute – Zur Freigabe – Rechnungen
      const lage = await page.evaluate(() => { const r = (id) => { const e = document.getElementById(id); if (!e) return null; const b = e.getBoundingClientRect(); return { oben: b.top, unten: b.bottom, links: b.left }; }; return { heute: r('ue-heute'), frei: r('ue-freigabe'), geld: r('bv-kacheln') }; });
      if (lage.heute && lage.geld && lage.frei) {
        if (g.width >= 720) pruef(lage.geld.oben - lage.heute.unten <= 32 && Math.abs(lage.geld.links - lage.heute.links) < 2 && lage.frei.links > lage.heute.links, `${wo}: Lücke zwischen „Heute“ und „Rechnungen“ bzw. Spalten falsch (${JSON.stringify(lage)})`);
        else pruef(lage.heute.oben < lage.frei.oben && lage.frei.oben < lage.geld.oben, `${wo}: Reihenfolge am Handy nicht Heute – Zur Freigabe – Rechnungen (${JSON.stringify(lage)})`);
      } else pruef(false, `${wo}: Abschnitte für die Lageprüfung fehlen (${JSON.stringify(lage)})`);
      const kopf = await page.locator('#ue-kopf').innerText();
      pruef(/\d{1,2}:\d{2}/.test(kopf) && (/Punkte? brauch/.test(kopf) || await page.locator('#ue-erledigt').count() === 1), `${wo}: Kopfzeile ohne Uhrzeit/Punkte („${kopf}“)`);

      // „Eingestempelt“ klappt die Liste auf
      pruef(!(await page.locator('#anwesend-karte').isVisible()), `${wo}: Liste der Eingestempelten schon offen`);
      await page.click('[data-kpi="anwesend"]');
      pruef(await page.locator('#anwesend-karte').isVisible() && await page.locator('#anwesend-karte li').count() >= 1, `${wo}: „Eingestempelt“ zeigt keine Liste`);

      // Einteilung für morgen: noch leer → kompakt unten; mit unveröffentlichtem Einsatz → oben, gelb, „Veröffentlichen“
      pruef(await page.locator('#ue-plan[data-oben="0"]').count() === 1, `${wo}: Einteilung ohne offene Änderungen nicht kompakt`);
      const e = await api('POST', '/plan/einsaetze', { datum: MORGEN, baustelleId: BS.pitten, beginn: '07:00', benutzerIds: [U.mitarbeiter] });
      pruef(e.status === 201, `${wo}: Einsatz für morgen nicht angelegt (${e.status})`);
      await geh('/stempeln'); await geh('/dashboard');
      pruef(await page.locator('#ue-plan[data-oben="1"].amber').count() === 1, `${wo}: unveröffentlichte Einteilung nicht oben/gelb`);
      const reihenfolge = await page.evaluate(() => { const p = document.querySelector('#ue-plan'), h = document.querySelector('#ue-heute'); return !!(p && h && (p.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING)); });
      pruef(reihenfolge, `${wo}: Einteilung steht nicht vor „Heute“`);
      pruef(/nicht veröffentlicht/.test(await page.locator('#ue-plan').innerText()), `${wo}: Status „nicht veröffentlicht“ fehlt`);
      pruef(Number(await page.locator('#ue-kopf').getAttribute('data-punkte')) >= 1, `${wo}: Einteilung zählt nicht als Punkt`);
      const r2 = await ruhig(page);
      pruef(r2.length === 0, `${wo} (mit Einteilung): ${r2.slice(0, 3).join(' | ')}`);
      await page.click('#ue-pub');
      await page.waitForSelector('dialog[open] #pub-vorschau', { timeout: 15000 }).catch(() => {});
      pruef(await page.locator('dialog[open] #pub-vorschau').count() === 1 && await page.locator('dialog[open] #pub-ok').count() === 1, `${wo}: „Veröffentlichen“ öffnet nicht die Bestätigung des Planers`);
      pruef(!(await page.evaluate(() => location.hash)).includes('veroeffentlichen'), `${wo}: Parameter „veroeffentlichen“ bleibt in der Adresse`);
      let w = await api('GET', `/plan/woche?von=${MORGEN}`);
      pruef(w.json.einsaetze.filter((x) => x.datum === MORGEN).every((x) => !x.veroeffentlicht), `${wo}: schon vor der Bestätigung veröffentlicht`);
      await page.click('dialog[open] #pub-abbrechen');
      await page.waitForTimeout(300);
      w = await api('GET', `/plan/woche?von=${MORGEN}`);
      pruef(w.json.einsaetze.filter((x) => x.datum === MORGEN).every((x) => !x.veroeffentlicht), `${wo}: nach „Abbrechen“ veröffentlicht`);
      // jetzt wirklich veröffentlichen (über die Bestätigung) → Übersicht: veröffentlicht, kompakt unten
      await geh('/dashboard');
      await page.click('#ue-pub');
      await page.waitForSelector('dialog[open] #pub-ok', { timeout: 15000 });
      await page.click('dialog[open] #pub-ok');
      await page.waitForFunction(() => !document.querySelector('dialog[open]'), null, { timeout: 15000 });
      w = await api('GET', `/plan/woche?von=${MORGEN}`);
      pruef(w.json.einsaetze.filter((x) => x.datum === MORGEN).every((x) => x.veroeffentlicht), `${wo}: „Jetzt veröffentlichen“ hat nicht veröffentlicht`);
      await geh('/dashboard');
      pruef(await page.locator('#ue-plan[data-zustand="veroeffentlicht"][data-oben="0"]').count() === 1, `${wo}: veröffentlichte Einteilung nicht kompakt/grün`);

      // Zur Freigabe: direkt freigeben
      const h2 = page.locator('#ue-freigabe-h');
      const vorher = Number(await h2.getAttribute('data-wert'));
      pruef(vorher >= 2 && await page.locator('[data-bericht-zeile] [data-freigeben]').count() >= 2, `${wo}: zu wenige Berichte zur Freigabe (${vorher})`);
      const id1 = Number(await page.locator('[data-freigeben]').first().getAttribute('data-freigeben'));
      await page.locator('[data-freigeben]').first().click();
      await page.waitForSelector('dialog[open] [data-ok]');
      await page.click('dialog[open] [data-ok]');
      await page.waitForSelector('.toast:has-text("Bericht freigegeben")', { timeout: 15000 }).catch(() => {});
      pruef(await page.locator('.toast:has-text("Bericht freigegeben")').count() >= 1, `${wo}: kein Toast nach „Freigeben“`);
      await page.waitForFunction((id) => document.querySelector('#ue') && !document.querySelector(`[data-bericht-zeile="${id}"]`), id1, { timeout: 15000 }).catch(() => {});
      pruef((await api('GET', `/berichte/${id1}`)).json.status === 'freigegeben', `${wo}: Bericht ${id1} nicht freigegeben`);
      pruef(await page.locator(`[data-bericht-zeile="${id1}"]`).count() === 0 && Number(await h2.getAttribute('data-wert')) === vorher - 1, `${wo}: freigegebener Bericht steht noch in der Liste`);
      // Konflikt: inzwischen (anderswo) freigegeben → Hinweis und der Bericht öffnet sich
      const id2 = Number(await page.locator('[data-freigeben]').first().getAttribute('data-freigeben'));
      const zweit = s.client(); await zweit.post('/auth/login', { benutzerId: U.bauleiter, pin: '1234' });
      pruef((await zweit.post(`/berichte/${id2}/freigeben`)).status === 200, `${wo}: Bauleiter konnte ${id2} nicht freigeben`);
      await page.locator(`[data-freigeben="${id2}"]`).click();
      await page.waitForSelector('dialog[open] [data-ok]');
      await page.click('dialog[open] [data-ok]');
      await page.waitForFunction((id) => location.hash === `#/bericht/${id}`, id2, { timeout: 15000 }).catch(() => {});
      pruef(await page.evaluate(() => location.hash) === `#/bericht/${id2}`, `${wo}: Konflikt öffnet nicht den Bericht (${await page.evaluate(() => location.hash)})`);
      // Tippen auf den Text öffnet den Bericht
      await geh('/dashboard');
      const z = page.locator('[data-bericht-zeile] a.ue-txt').first();
      const zid = await z.evaluate((a) => a.closest('[data-bericht-zeile]').dataset.berichtZeile);
      await z.click();
      await page.waitForFunction((id) => location.hash === `#/bericht/${id}`, zid, { timeout: 10000 }).catch(() => {});
      pruef(await page.evaluate(() => location.hash) === `#/bericht/${zid}`, `${wo}: Tippen auf den Bericht öffnet ihn nicht`);

      // Klassische Übersicht umschalten (je Gerät, unter „Mehr“) und zurück
      await geh('/mehr');
      pruef(await page.locator('#klassisch-zeile').count() === 1, `${wo}: Schalter „Klassische Übersicht verwenden“ fehlt unter „Mehr“`);
      await page.click('#klassisch-zeile');
      pruef(await page.locator('#opt-klassisch').isChecked(), `${wo}: Schalter lässt sich nicht einschalten`);
      await geh('/dashboard');
      pruef(await page.locator('#ue').count() === 0 && await page.locator('.kpi-row [data-kpi="freigabe"] b').count() === 1 && await page.locator('#anwesend-karte li').count() >= 1 && await page.locator('#bv-kacheln.kpi-row').count() === 1, `${wo}: klassische Übersicht wird nicht wiederhergestellt`);
      // Prüfbefund n8-s: die zweite Kachelreihe (#bv-kacheln) steht direkt unter der ersten, nicht am Seitenende
      const klass = await page.evaluate(() => { const b = document.getElementById('bv-kacheln'); if (!b || !b.parentElement) return null; return [...b.parentElement.children].filter((e) => e.getBoundingClientRect().height > 0).sort((x, y) => x.getBoundingClientRect().top - y.getBoundingClientRect().top).map((e) => e.id || e.className); });
      pruef(!!klass && klass[1] === 'bv-kacheln' && /kpi-row/.test(klass[0]), `${wo}: klassische Übersicht – Kachelreihe „Bauvorhaben“ nicht direkt unter der ersten Kachelreihe (${JSON.stringify(klass)})`);
      await geh('/mehr');
      pruef(await page.locator('#opt-klassisch').isChecked(), `${wo}: Schalter merkt sich die Wahl nicht`);
      await page.click('#klassisch-zeile');
      await geh('/dashboard');
      pruef(await page.locator('#ue').count() === 1 && await page.locator('#view .kpi-row').count() === 0, `${wo}: zurück zur neuen Übersicht klappt nicht`);
    });

    /* ---------------- Polier mit Ausnahme „Berichte freigeben“: Übersicht ohne Geld, ohne Planer ---------------- */
    await sitzung(U.polier2, async ({ page, geh, antworten }) => {
      const wo = `Übersicht Polier+Freigabe/${g.name}`;
      await geh('/dashboard');
      pruef(await page.locator('#ue').count() === 1, `${wo}: Übersicht fehlt`);
      const t = await page.evaluate(() => document.body.innerText);
      pruef(!/€|\bEUR\b|Budget|Rechnung|Offene Posten|Kalkulation/.test(t), `${wo}: Geld sichtbar`);
      pruef(await page.locator('#bv-kacheln, #ue-plan, [data-kpi="ueberfaellig"], [data-kpi="budget"]').count() === 0, `${wo}: Geld-/Planer-Abschnitt sichtbar`);
      pruef(await page.locator('#ue-freigabe').count() === 1, `${wo}: „Zur Freigabe“ fehlt`);
      const geld = antworten.filter((a) => GELD_PFADE.test(a.pfad));
      pruef(geld.length === 0, `${wo}: Anfragen an Geld-/Planer-Daten: ${geld.map((a) => a.pfad).slice(0, 4).join(', ')}`);
      pruef(antworten.every((a) => a.status !== 403), `${wo}: gesperrte Anfrage (403): ${antworten.filter((a) => a.status === 403).map((a) => a.pfad).join(', ')}`);
      const r = await ruhig(page);
      pruef(r.length === 0, `${wo}: ${r.slice(0, 3).join(' | ')}`);
    });

    /* ---------------- Polier und Mitarbeiter ohne Ausnahme: keine Übersicht, kein € ---------------- */
    for (const bid of [U.polier, U.mitarbeiter]) {
      await sitzung(bid, async ({ page, geh, antworten }) => {
        const wo = `Übersicht ${bid === U.polier ? 'Polier' : 'Mitarbeiter'}/${g.name}`;
        await geh('/dashboard');
        pruef(await page.locator('[data-zustand="kein-zugriff"]').count() === 1 && await page.locator('#ue').count() === 0, `${wo}: Übersicht erreichbar`);
        pruef(!/€|\bEUR\b/.test(await page.evaluate(() => document.body.innerText)), `${wo}: € sichtbar`);
        pruef(!antworten.some((a) => GELD_PFADE.test(a.pfad) || /^\/api\/(zeit\/anwesend|berichte\?status)/.test(a.pfad)), `${wo}: Übersicht fragt trotzdem Daten an`);
      });
    }

    /* ---------------- Prüfbefund n8-s: Rechte-Matrix geändert – Büro ohne Berichtsrechte und ohne Stammdaten ---------------- */
    // Die rechte Spalte (Zur Freigabe + Einteilung) bleibt leer: „Heute“ und „Rechnungen“ stehen ab 720 px nebeneinander im
    // Raster (keine leere rechte Hälfte), am Handy untereinander in dieser Reihenfolge
    for (const recht of ['bericht_erstellen', 'bericht_freigeben', 'stammdaten']) { const r = await gf.put('/rechte/matrix', { rolle: 'buero', recht, wert: false }); if (r.status >= 300) throw new Error(`Matrix ${recht}: ${r.status}`); }
    await sitzung(U.buero, async ({ page, geh }) => {
      const wo = `Übersicht Büro ohne Berichte/Stammdaten/${g.name}`;
      await geh('/dashboard');
      pruef(await page.locator('#ue').count() === 1 && await page.locator('#ue-freigabe, #ue-plan').count() === 0 && await page.locator('#ue-heute').count() === 1 && await page.locator('#bv-kacheln').count() === 1, `${wo}: Vorbedingung – Abschnitte ${JSON.stringify(await page.locator('#ue section, #ue [id]').evaluateAll((l) => l.map((e) => e.id)))}`);
      const lage = await page.evaluate(() => { const r = (id) => { const e = document.getElementById(id); if (!e) return null; const b = e.getBoundingClientRect(); return { oben: Math.round(b.top), unten: Math.round(b.bottom), links: Math.round(b.left), rechts: Math.round(b.right) }; }; const p = document.getElementById('ue').getBoundingClientRect(); return { heute: r('ue-heute'), geld: r('bv-kacheln'), seite: { links: Math.round(p.left), rechts: Math.round(p.right) } }; });
      if (lage.heute && lage.geld) {
        if (g.width >= 720) pruef(Math.abs(lage.geld.oben - lage.heute.oben) < 2 && lage.geld.links > lage.heute.rechts, `${wo}: rechte Hälfte leer bzw. nicht nebeneinander (${JSON.stringify(lage)})`);
        else pruef(lage.heute.unten <= lage.geld.oben && Math.abs(lage.geld.links - lage.heute.links) < 2, `${wo}: am Handy nicht Heute – Rechnungen untereinander (${JSON.stringify(lage)})`);
      } else pruef(false, `${wo}: Abschnitte für die Lageprüfung fehlen (${JSON.stringify(lage)})`);
      pruef(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1, `${wo}: horizontaler Überlauf`);
    });
  } finally { await s.stop(); }
  return { fehler, schritte };
}

module.exports = { laufe };

if (require.main === module) {
  const GROESSEN = [{ name: 'handy', width: 390, height: 844, mobil: true }, { name: 'tablet', width: 1180, height: 820, mobil: true }, { name: 'pc', width: 1440, height: 900, mobil: false }]
    .filter((g) => !process.env.E2E_NUR || process.env.E2E_NUR.split(',').includes(g.name));
  (async () => {
    const browser = await chromium.launch();
    let n = 0;
    for (const g of GROESSEN) { const r = await laufe(browser, g); n += r.fehler.length; console.log(`  ${g.name}: ${r.schritte - r.fehler.length}/${r.schritte} Prüfungen bestanden`); }
    await browser.close();
    process.exit(n ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
