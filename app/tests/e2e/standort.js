'use strict';
/**
 * Standort beim Stempeln (API.md 15.30, Inhaber 19.11.2026) in der Oberfläche.
 *   node tests/e2e/standort.js   (im Ordner app; E2E_NUR=handy|tablet|pc; Exit-Code 1 bei Befunden)
 * Wird auch von run.js je Bildschirmgröße aufgerufen (abschaltbar mit E2E_OHNE_STANDORT=1).
 * Ortung über Playwright (geolocation + permissions); Baustelle Pitten erhält Koordinaten, Kogler bleibt ohne.
 *  1. Geteiltes Gerät, Lukas: Hinweis „Standort wird nicht erfasst“; in „Mehr“ einschalten (Erlaubnis-Frage im Klick) →
 *     am Server je Person gespeichert; bleibt nach Abmelden/Anmelden an, kein bt_standort am Gerät.
 *  2. Kommen: sofort gebucht (Stempel-Anfrage ohne Standort, nicht verzögert), danach „Standort erfasst (±25 m)“, Standort
 *     an genau dieser Buchung. Ohne Netz: Pause → „… wird mit der Buchung gesendet“, nach dem Wiederverbinden mit Standort.
 *  3. Am selben Gerät Roland: Schalter aus (erbt nichts), Kommen ohne Standort, keine Ortung, keine Anzeige.
 *  4. Büro, Korrektur Lukas: „bei der Baustelle“, „3,2 km von der Baustelle“, „Standort“ (Baustelle ohne Koordinaten), Link
 *     „Karte“ (OpenStreetMap, neues Fenster); Buchungen ohne Standort ohne Hinweis. Kein Überlauf.
 *  5. Lukas schaltet aus → „Pause beenden“ sendet nichts, keine Anzeige.
 *  6. Gerät ohne Erlaubnis (Fabian): Einschalten → Hinweis mit dem Weg in den Einstellungen, Schalter bleibt an; Kommen →
 *     „Standort nicht verfügbar“, kein Standort gespeichert.
 */
const { chromium } = require('playwright');
const { starte, U, BS } = require('../api/hilfe');

const GROESSEN = [
  { name: 'handy', width: 390, height: 844, mobil: true },
  { name: 'tablet', width: 1180, height: 820, mobil: true },
  { name: 'pc', width: 1440, height: 900, mobil: false }
];
const NAME = { 2: 'Lukas Brandstätter', 4: 'Roland Kerschbaumer', 6: 'Fabian Stickler', 101: 'Martina Koller' };
const PITTEN = { lat: 47.7333, lng: 16.1833 };
const NAHE = { latitude: PITTEN.lat + 120 / 111195, longitude: PITTEN.lng, accuracy: 25 }; // 120 m nördlich, ±25 m

// Optional: BAUTAG_SHOTS=/pfad → Bildschirmfotos der Schritte dort ablegen
const foto = async (page, name, g) => { if (process.env.BAUTAG_SHOTS) await page.screenshot({ path: require('node:path').join(process.env.BAUTAG_SHOTS, `standort-${g.name}-${name}.png`), fullPage: false }); };

async function laufe(browser, g) {
  const fehler = [];
  let schritte = 0;
  const pruef = (ok, text) => { schritte++; if (!ok) { fehler.push(`Standort/${g.name}: ${text}`); console.log(`    ✗ Standort/${g.name}: ${text}`); } };
  const s = await starte({ test: true });
  try {
    s.db.lauf('UPDATE baustelle SET lat = ?, lng = ? WHERE id = ?', PITTEN.lat, PITTEN.lng, BS.pitten);
    s.db.lauf('UPDATE baustelle SET lat = NULL, lng = NULL WHERE id = ?', BS.kogler);
    const einw = (id) => s.db.eins('SELECT standort_einwilligung AS e FROM benutzer WHERE id = ?', id).e;
    const letzte = (id) => s.db.eins('SELECT id, typ, quelle, lat, lng, genauigkeit FROM buchung WHERE benutzer_id = ? ORDER BY id DESC LIMIT 1', id);

    async function kontext({ erlaubt = true } = {}) {
      const ctx = await browser.newContext({ viewport: { width: g.width, height: g.height }, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: g.mobil, serviceWorkers: 'block',
        ...(erlaubt ? { geolocation: NAHE, permissions: ['geolocation'] } : { permissions: [] }) });
      await ctx.clock.install({ time: s.uhr() });
      const page = await ctx.newPage();
      page.setDefaultTimeout(10000);
      const konsole = [];
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) konsole.push(m.text().slice(0, 160)); });
      page.on('pageerror', (e) => konsole.push(String(e.message).slice(0, 160)));
      const anfragen = [];
      page.on('request', (r) => { if (r.url().includes('/api/zeit/stempeln')) anfragen.push({ url: r.url().replace(/^.*\/api/, ''), methode: r.method(), body: r.postData() || '', zeit: Date.now() }); });
      const bereit = () => page.waitForFunction(() => !document.querySelector('#view .view-box > .state .spinner'), null, { timeout: 10000 });
      const geh = async (h) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForFunction((x) => location.hash === x, h); await bereit(); await page.waitForTimeout(250); };
      const api = (pfad) => page.evaluate(async (p) => { const r = await fetch('/api' + p); let j = null; try { j = await r.json(); } catch (e) { /* kein JSON */ } return { status: r.status, json: j }; }, pfad);
      const text = async (sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
      const anmelden = async (id) => {
        await page.goto(s.basis + '/#/login');
        await page.waitForSelector('.login-user');
        await page.fill('#login-suche', NAME[id].split(' ')[1]);
        await page.click(`.login-user:has-text("${NAME[id]}")`);
        await page.waitForSelector('.pin-pad');
        for (const z of '1234') await page.click(`.pin-pad [data-z="${z}"]`);
        await page.click('.pin-pad [data-ok]');
        await page.waitForSelector('#view');
        await page.waitForFunction(() => !document.querySelector('#view .view-box > .state .spinner, #root > .state .spinner'), null, { timeout: 10000 });
      };
      const abmelden = async () => {
        await geh('#/mehr');
        await page.click('#abmelden');
        const d = page.locator('dialog[open] .btn.primary, dialog[open] .btn.danger');
        if (await d.count()) await d.first().click();
        await page.waitForSelector('.login-user, #login-suche', { timeout: 10000 });
      };
      const layout = async (was) => {
        const r = await page.evaluate(() => { const d = document.documentElement, v = document.getElementById('view'); return { doc: d.scrollWidth - window.innerWidth, view: v ? v.scrollWidth - v.clientWidth : 0 }; });
        pruef(r.doc <= 1 && r.view <= 1, `${was}: horizontaler Überlauf (doc ${r.doc}, view ${r.view})`);
      };
      const zu = async (wo) => { pruef(konsole.length === 0, `${wo}: Konsolenfehler: ${konsole.slice(0, 3).join(' | ')}`); await ctx.close(); };
      return { ctx, page, geh, api, text, anmelden, abmelden, layout, anfragen, zu };
    }
    const schalter = (page) => page.locator('#opt-standort');
    const umlegen = async (page) => { await page.locator('#standort-zeile .switch').click(); await page.waitForFunction(() => !document.querySelector('#opt-standort').disabled); };
    const ortZeile = async (page, muster, was) => {
      try { await page.waitForFunction((m) => { const e = document.querySelector('#cc-standort'); return e && !e.hidden && new RegExp(m).test(e.textContent); }, muster.source, { timeout: 12000 }); pruef(true, was); }
      catch (e) { pruef(false, `${was}: Anzeige „${await page.locator('#cc-standort').textContent().catch(() => '–')}“ statt ${muster}`); }
    };

    /* ---- 1)–3) Geteiltes Gerät: Lukas schaltet ein, Roland erbt nichts ---- */
    const k = await kontext();
    const { page, geh, api, text } = k;
    await k.anmelden(U.mitarbeiter);
    await geh('#/stempeln');
    pruef((await text('#cc-standort-note')).includes('Standort wird nicht erfasst'), `Hinweis unter den Knöpfen vor dem Einschalten: „${await text('#cc-standort-note')}“`);
    pruef(await page.locator('#cc-standort').isHidden(), 'Standort-Anzeige vor dem ersten Stempeln sichtbar');
    await geh('#/mehr');
    pruef(!(await schalter(page).isChecked()), 'Mehr: Schalter steht anfangs auf an (Standard muss aus sein)');
    pruef((await text('#standort-zeile')).includes('Freiwillig'), 'Mehr: Text ohne „Freiwillig“');
    await umlegen(page);
    pruef(await schalter(page).isChecked(), 'Mehr: Schalter nach dem Einschalten nicht an');
    await page.waitForTimeout(400);
    pruef(!!einw(U.mitarbeiter), 'Server: Einwilligung nach dem Einschalten nicht gespeichert');
    pruef(await page.locator('#standort-hinweis').isHidden(), 'Mehr: Warnhinweis trotz erlaubter Ortung sichtbar');
    pruef((await api('/auth/ich')).json.benutzer.standortEinwilligung === einw(U.mitarbeiter), '/auth/ich liefert die Einwilligung nicht');
    pruef(await page.evaluate(() => localStorage.getItem('bt_standort')) === null, 'Gerät: bt_standort gespeichert (soll je Person am Server stehen)');
    await k.layout('Mehr mit Standort-Schalter');
    // Abmelden und wieder anmelden: bleibt an
    await k.abmelden();
    await k.anmelden(U.mitarbeiter);
    await geh('#/mehr');
    pruef(await schalter(page).isChecked(), 'Mehr: Schalter nach Abmelden/Anmelden wieder aus (wird nicht gespeichert)');
    // Kommen: sofort gebucht, Standort danach angehängt
    await geh('#/stempeln');
    pruef((await text('#cc-standort-note')).includes('nur im Moment des Stempelns'), `Hinweis nach dem Einschalten: „${await text('#cc-standort-note')}“`);
    await page.waitForSelector('.clock-card[data-status="aus"] [data-stempel="kommen"]');
    k.anfragen.length = 0;
    await page.click('[data-stempel="kommen"]');
    await page.waitForSelector('.clock-card[data-status="arbeit"]');
    await ortZeile(page, /^Standort erfasst \(±25 m\)$/, 'Kommen: „Standort erfasst (±25 m)“');
    const kommen = letzte(U.mitarbeiter);
    pruef(kommen.typ === 'kommen' && Math.abs(kommen.lat - NAHE.latitude) < 1e-6 && Math.abs(kommen.lng - NAHE.longitude) < 1e-6 && kommen.genauigkeit === 25, `Kommen: Standort nicht an der Buchung (${JSON.stringify(kommen)})`);
    const st = k.anfragen.filter((a) => a.methode === 'POST' && a.url === '/zeit/stempeln');
    pruef(st.length === 1 && !st[0].body.includes('standort') && !st[0].body.includes('"zeit"'), `Kommen: Stempel-Anfrage nicht sofort ohne Standort (${JSON.stringify(st.map((x) => x.body))})`);
    pruef(k.anfragen.some((a) => a.url === `/zeit/stempeln/${kommen.id}/standort`), 'Kommen: Standort nicht an die eigene Buchung nachgereicht');
    await k.layout('Stempeluhr mit Standort-Anzeige');
    await foto(page, 'stempeluhr-erfasst', g);
    // ohne Netz: Pause (offen) → Standort wird mit der Buchung gesendet
    await k.ctx.setOffline(true);
    await page.click('[data-stempel="pause_start"]');
    await page.waitForSelector('dialog[open] #pause-wahl');
    await page.click('dialog[open] [data-pause-min="offen"]');
    await ortZeile(page, /^Standort erfasst \(±25 m\) – wird mit der Buchung gesendet$/, 'offline: „… wird mit der Buchung gesendet“');
    const q = await page.evaluate(() => JSON.parse(localStorage.getItem('bt_stempel_queue') || '[]'));
    pruef(q.length === 1 && q[0].typ === 'pause_start' && q[0].standort && q[0].standort.genauigkeit === 25 && q[0].standortWartet === undefined, `offline: Warteschlange ohne Standort (${JSON.stringify(q)})`);
    await k.ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    try { await page.waitForFunction(() => JSON.parse(localStorage.getItem('bt_stempel_queue') || '[]').length === 0, null, { timeout: 20000 }); } catch (e) { /* unten geprüft */ }
    const pause = letzte(U.mitarbeiter);
    pruef(pause.typ === 'pause_start' && pause.quelle === 'offline' && Math.abs(pause.lat - NAHE.latitude) < 1e-6, `offline nachgesendet ohne Standort (${JSON.stringify(pause)})`);
    await k.abmelden();
    // Roland am selben Gerät: erbt nichts
    await k.anmelden(4);
    await geh('#/mehr');
    pruef(!(await schalter(page).isChecked()), 'Geteiltes Gerät: Roland erbt Lukas’ Einstellung');
    await geh('#/stempeln');
    pruef((await text('#cc-standort-note')).includes('Standort wird nicht erfasst'), 'Geteiltes Gerät: Roland sieht „Standort wird nur … erfasst“');
    await page.waitForSelector('.clock-card[data-status="aus"] [data-stempel="kommen"]');
    k.anfragen.length = 0;
    await page.click('[data-stempel="kommen"]');
    await page.waitForSelector('.clock-card[data-status="arbeit"]');
    await page.waitForTimeout(1500);
    const dan = letzte(4);
    pruef(dan.typ === 'kommen' && dan.lat === null, `Roland: Standort gespeichert (${JSON.stringify(dan)})`);
    pruef(!k.anfragen.some((a) => /\/standort$/.test(a.url) || a.body.includes('standort')), 'Roland: Standort gesendet');
    pruef(await page.locator('#cc-standort').isHidden(), 'Roland: Standort-Anzeige sichtbar');
    pruef(einw(4) === null, 'Roland: Einwilligung am Server gesetzt');
    await k.abmelden();
    await k.zu('Geteiltes Gerät');

    /* ---- 4) Büro: Korrektur zeigt die Lage zur Baustelle ---- */
    // eine ältere Buchung von Lukas 3,2 km entfernt, eine auf einer Baustelle ohne Koordinaten
    const alt = s.db.alle("SELECT id FROM buchung WHERE benutzer_id = ? AND zeit >= '2026-11-02' AND id NOT IN (?, ?) AND lat IS NULL ORDER BY zeit DESC LIMIT 2", U.mitarbeiter, kommen.id, pause.id);
    s.db.lauf('UPDATE buchung SET baustelle_id = ?, lat = ?, lng = ?, genauigkeit = 15 WHERE id = ?', BS.pitten, PITTEN.lat + 3200 / 111195, PITTEN.lng, alt[0].id);
    s.db.lauf('UPDATE buchung SET baustelle_id = ?, lat = ?, lng = ?, genauigkeit = 30 WHERE id = ?', BS.kogler, 47.70, 16.10, alt[1].id);
    const b = await kontext();
    await b.anmelden(101);
    await b.geh(`#/korrektur?benutzerId=${U.mitarbeiter}`);
    await b.page.waitForSelector('#k-liste [data-buchung]');
    const zeile = (id) => b.page.locator(`#k-liste [data-buchung="${id}"] .korr-ort`);
    pruef(await zeile(kommen.id).count() === 1 && (await zeile(kommen.id).innerText()).includes('bei der Baustelle') && await zeile(kommen.id).getAttribute('data-lage') === 'bei', `Korrektur: Kommen nicht „bei der Baustelle“ (${await zeile(kommen.id).innerText().catch(() => '–')})`);
    const karte = zeile(kommen.id).locator('a[data-karte]');
    const href = await karte.getAttribute('href');
    pruef((await karte.innerText()).trim() === 'Karte' && await karte.getAttribute('target') === '_blank' && /noopener/.test(await karte.getAttribute('rel')), 'Korrektur: Link „Karte“ fehlt oder öffnet nicht in neuem Fenster');
    pruef(href === `https://www.openstreetmap.org/?mlat=${Number(NAHE.latitude.toFixed(6))}&mlon=${NAHE.longitude}#map=17/${Number(NAHE.latitude.toFixed(6))}/${NAHE.longitude}`, `Korrektur: Karten-Link „${href}“`);
    pruef((await zeile(pause.id).innerText()).includes('bei der Baustelle'), 'Korrektur: offline nachgesendete Pause ohne Standort-Hinweis');
    pruef((await zeile(alt[0].id).innerText()).includes('3,2 km von der Baustelle') && await zeile(alt[0].id).getAttribute('data-lage') === 'weg', `Korrektur: „3,2 km von der Baustelle“ fehlt (${await zeile(alt[0].id).innerText().catch(() => '–')})`);
    const ohne = (await zeile(alt[1].id).innerText()).replace(/\s+/g, ' ').trim();
    pruef(/^Standort · Karte$/.test(ohne) && await zeile(alt[1].id).getAttribute('data-lage') === 'ohne', `Korrektur: Baustelle ohne Koordinaten zeigt „${ohne}“ statt „Standort · Karte“`);
    const ohneOrt = await b.page.locator('#k-liste [data-buchung]').evaluateAll((l) => l.filter((x) => !x.querySelector('.korr-ort')).length);
    pruef(ohneOrt > 0, 'Korrektur: jede Buchung mit Standort-Hinweis (Buchungen ohne Standort dürfen keinen haben)');
    await b.layout('Korrektur mit Standort');
    await zeile(alt[0].id).scrollIntoViewIfNeeded();
    await foto(b.page, 'korrektur', g);
    await b.abmelden();
    await b.zu('Büro Korrektur');

    /* ---- 5) Lukas schaltet aus → nichts mehr gesendet ---- */
    s.uhr.plus(5); // Server-Uhr steht; die offline erfasste Pause trägt die (weiterlaufende) Zeit des Geräts
    const l = await kontext();
    await l.anmelden(U.mitarbeiter);
    await l.geh('#/mehr');
    pruef(await schalter(l.page).isChecked(), 'Lukas (neues Gerät): Schalter nicht an – gilt je Person');
    await umlegen(l.page);
    await l.page.waitForTimeout(400);
    pruef(!(await schalter(l.page).isChecked()) && einw(U.mitarbeiter) === null, 'Ausschalten: am Server nicht aus');
    await l.geh('#/stempeln');
    pruef((await l.text('#cc-standort-note')).includes('Standort wird nicht erfasst'), 'Ausschalten: Hinweis unter den Knöpfen');
    await l.page.waitForSelector('[data-stempel="pause_ende"]');
    l.anfragen.length = 0;
    await l.page.click('[data-stempel="pause_ende"]');
    await l.page.waitForSelector('.clock-card[data-status="arbeit"]');
    await l.page.waitForTimeout(1500);
    const pe = letzte(U.mitarbeiter);
    pruef(pe.typ === 'pause_ende' && pe.lat === null, `Ausgeschaltet: Standort gespeichert (${JSON.stringify(pe)})`);
    pruef(!l.anfragen.some((a) => /\/standort$/.test(a.url) || a.body.includes('standort')), 'Ausgeschaltet: Standort gesendet');
    pruef(await l.page.locator('#cc-standort').isHidden(), 'Ausgeschaltet: Standort-Anzeige sichtbar');
    await l.abmelden();
    await l.zu('Lukas ausgeschaltet');

    /* ---- 6) Gerät ohne Erlaubnis ---- */
    const n = await kontext({ erlaubt: false });
    await n.anmelden(6);
    await n.geh('#/mehr');
    await umlegen(n.page);
    try { await n.page.waitForSelector('#standort-hinweis:not([hidden])', { timeout: 12000 }); } catch (e) { /* unten geprüft */ }
    const h = await n.page.locator('#standort-hinweis').innerText().catch(() => '');
    pruef(/Ortungsdienste/.test(h) && /Safari-Websites/.test(h) && /Android/.test(h), `Ohne Erlaubnis: Hinweis „${h.slice(0, 120)}“`);
    pruef(await schalter(n.page).isChecked() && !!einw(6), 'Ohne Erlaubnis: Schalter soll an bleiben (mit Hinweis)');
    await n.layout('Mehr mit Hinweis ohne Erlaubnis');
    await n.page.locator('#standort-zeile').scrollIntoViewIfNeeded();
    await foto(n.page, 'mehr-ohne-erlaubnis', g);
    await n.geh('#/stempeln');
    await n.page.waitForSelector('.clock-card[data-status="aus"] [data-stempel="kommen"]');
    await n.page.click('[data-stempel="kommen"]');
    await n.page.waitForSelector('.clock-card[data-status="arbeit"]');
    await ortZeile(n.page, /^Standort nicht verfügbar/, 'Ohne Erlaubnis: „Standort nicht verfügbar“');
    const ma14 = letzte(6);
    pruef(ma14.typ === 'kommen' && ma14.lat === null, `Ohne Erlaubnis: Buchung fehlt oder mit Standort (${JSON.stringify(ma14)})`);
    pruef(await n.page.locator('.modal, dialog[open]').count() === 0, 'Ohne Erlaubnis: Fehler-Dialog statt kleiner Anzeige');
    await n.layout('Stempeluhr ohne Erlaubnis');
    await foto(n.page, 'stempeluhr-nicht-verfuegbar', g);
    await n.zu('Ohne Erlaubnis');
  } finally { await s.stop(); }
  return { fehler, schritte };
}

module.exports = { laufe, GROESSEN };

if (require.main === module) {
  (async () => {
    const browser = await chromium.launch();
    let gesamt = 0;
    for (const g of GROESSEN.filter((x) => !process.env.E2E_NUR || process.env.E2E_NUR.split(',').includes(x.name))) {
      console.log(`\n▶ Standort ${g.name} (${g.width}×${g.height})`);
      const t = Date.now();
      const r = await laufe(browser, g);
      gesamt += r.fehler.length;
      console.log(`${r.fehler.length ? '✗' : '✓'} ${g.name}: ${r.schritte - r.fehler.length}/${r.schritte} Prüfungen bestanden (${((Date.now() - t) / 1000).toFixed(1)} s)`);
    }
    await browser.close();
    process.exit(gesamt ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(2); });
}
