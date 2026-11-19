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
 *  7. Langsame Ortung (5 s, kalter GPS-Start), Roland: Pause und sofort abmelden → „Standort wird noch gesendet …“, danach
 *     abgemeldet und der Standort an der Buchung; Pause beenden und die App sofort neu laden → die Stempeluhr holt den
 *     Nachtrag nach. Dazu in 4): Buchung auf einer archivierten Baustelle zeigt die Entfernung (nicht nur „Standort“).
 *     Prüfbefund n8-g: nach dem Neuladen wird nie neu geortet – ohne schon ermittelten Standort wird der Nachtrag verworfen,
 *     ein schon ermittelter (nur das Senden hing) wird gesendet. Ein alter Geräteschalter bt_standort gilt nicht als Einwilligung;
 *     Ausschalten löscht die gespeicherten Standorte.
 *  9. Prüfbefunde n8-g, wartendes Abmelden: die nächste Person am geteilten Gerät wartet nicht auf die Ortung der vorigen;
 *     ein Fenster-Fokus schickt das Abmelden nicht vor dem Standort hinaus; Seite beim Warten geschlossen → Sitzung (auch die
 *     Wochen-Sitzung) beendet, keine Daten der Person am Gerät, /api/auth/ich 401; App beim Warten abgestürzt → beim nächsten
 *     Öffnen fertig abgemeldet und aufgeräumt. Prüfbefund n8-s (9e): Buchung wartet in der Warteschlange (Server nicht erreichbar),
 *     sofort abgemeldet → nach der Ortung geht die Buchung samt Standort noch vor dem Abmelden hinaus. Prüfbefund n8-l (9f): zwei
 *     Buchungen in der Warteschlange, die erste wird beim Abmelden gerade langsam nachgesendet, die zweite wartet auf die Ortung →
 *     das Abmelden wartet auch auf den Folgelauf, beide kommen samt Standort vor dem Logout an.
 *  8. Zusammen mit „Pause beim Gehen“ (15.27), Fabian: Gehen → Dialog → 30 Min → eine Stempel-Anfrage mit pauseBeimGehen,
 *     danach der Standort an der Gehen-Buchung (nicht an den nachgetragenen Pausenbuchungen).
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
const TERNITZ = { lat: 47.7167, lng: 16.0333 }; // wird in 4) archiviert
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

    async function kontext({ erlaubt = true, langsamMs = 0 } = {}) {
      const ctx = await browser.newContext({ viewport: { width: g.width, height: g.height }, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: g.mobil, serviceWorkers: 'block',
        ...(erlaubt ? { geolocation: NAHE, permissions: ['geolocation'] } : { permissions: [] }) });
      await ctx.clock.install({ time: s.uhr() });
      // 7): Ortung antwortet erst nach `langsamMs` (wie ein kalter GPS-Start); zählt die Aufrufe
      if (langsamMs) await ctx.addInitScript(({ ms, o }) => {
        const geo = { getCurrentPosition(ok) { window.__ortRufe = (window.__ortRufe || 0) + 1; setTimeout(() => ok({ coords: { latitude: o.latitude, longitude: o.longitude, accuracy: o.accuracy } }), ms); } };
        Object.defineProperty(Navigator.prototype, 'geolocation', { configurable: true, get: () => geo });
      }, { ms: langsamMs, o: NAHE });
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
    // Roland am selben Gerät: erbt nichts. Prüfbefund n8-g: ein alter Geräteschalter (bt_standort = true, bis 15.29) ist keine
    // Einwilligung – er wird nur entfernt, nicht an den Server übernommen
    await k.anmelden(4);
    await page.evaluate(() => localStorage.setItem('bt_standort', 'true'));
    await geh('#/mehr');
    pruef(!(await schalter(page).isChecked()), 'Geteiltes Gerät: Roland erbt Lukas’ Einstellung bzw. der alte Geräteschalter gilt als Einwilligung');
    pruef(einw(4) === null && await page.evaluate(() => localStorage.getItem('bt_standort')) === null, `Alter Geräteschalter: Einwilligung ${einw(4)}, bt_standort ${await page.evaluate(() => localStorage.getItem('bt_standort'))}`);
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
    const alt = s.db.alle("SELECT id FROM buchung WHERE benutzer_id = ? AND zeit >= '2026-11-02' AND id NOT IN (?, ?) AND lat IS NULL ORDER BY zeit DESC LIMIT 3", U.mitarbeiter, kommen.id, pause.id);
    // eine auf einer inzwischen archivierten Baustelle mit Koordinaten (fehlt in GET /baustellen ohne ?alle=1)
    s.db.lauf("UPDATE baustelle SET phase = 'archiviert', status = 'abgeschlossen', lat = ?, lng = ? WHERE id = ?", TERNITZ.lat, TERNITZ.lng, BS.ternitz);
    s.db.lauf('UPDATE buchung SET baustelle_id = ?, lat = ?, lng = ?, genauigkeit = 20 WHERE id = ?', BS.ternitz, TERNITZ.lat + 850 / 111195, TERNITZ.lng, alt[2].id);
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
    pruef(!(await b.api('/baustellen')).json.some((x) => x.id === BS.ternitz), 'Vorbedingung: archivierte Baustelle steht in GET /baustellen');
    const arch = (await zeile(alt[2].id).innerText().catch(() => '–')).replace(/\s+/g, ' ').trim();
    pruef(arch.includes('850 m von der Baustelle') && await zeile(alt[2].id).getAttribute('data-lage') === 'weg', `Korrektur: archivierte Baustelle zeigt „${arch}“ statt „850 m von der Baustelle“`);
    pruef((await b.page.locator(`#k-liste [data-buchung="${alt[2].id}"]`).innerText()).includes('Ternitz'), 'Korrektur: Name der archivierten Baustelle fehlt');
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
    // Prüfbefund n8-g: der Widerruf löscht die gespeicherten Standorte (Text in „Mehr“ sagt es)
    pruef(s.db.eins('SELECT COUNT(*) AS n FROM buchung WHERE benutzer_id = ? AND lat IS NOT NULL', U.mitarbeiter).n === 0, 'Ausschalten: gespeicherte Standorte nicht gelöscht');
    pruef((await l.text('#standort-zeile')).includes('Ausschalten löscht deine gespeicherten Standorte'), 'Mehr: Hinweis „Ausschalten löscht …“ fehlt');
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

    /* ---- 7) Langsame Ortung: sofort abmelden bzw. App neu laden – der Standort geht nicht verloren ---- */
    s.db.lauf('UPDATE benutzer SET standort_einwilligung = ? WHERE id = ?', s.uhr().toISOString(), 4); // Roland schaltet ein
    const w = await kontext({ langsamMs: 5000 });
    const nahe = (x) => !!x && x.lat !== null && Math.abs(x.lat - NAHE.latitude) < 1e-6 && Math.abs(x.lng - NAHE.longitude) < 1e-6 && x.genauigkeit === 25;
    const gemerkt = () => w.page.evaluate(() => localStorage.getItem('bt_standort_nachtrag'));
    await w.anmelden(4);
    await w.geh('#/stempeln');
    await w.page.waitForSelector('.clock-card[data-status="arbeit"] [data-stempel="pause_start"]');
    await w.page.click('[data-stempel="pause_start"]');
    await w.page.waitForSelector('dialog[open] #pause-wahl');
    const t7 = Date.now();
    await w.page.click('dialog[open] [data-pause-min="offen"]');
    await w.page.waitForSelector('.clock-card[data-status="pause"]');
    const p7 = letzte(4);
    pruef(p7.typ === 'pause_start' && p7.lat === null && Date.now() - t7 < 4000, `Langsam: Pause nicht sofort gebucht (${JSON.stringify(p7)}, ${Date.now() - t7} ms)`);
    // 15.28: am „Eigenen Handy“ (Standard der Anmeldeseite) ist das eine Wochen-Sitzung – das wartende Abmelden beendet auch sie
    const woche = () => s.db.alle("SELECT art FROM sitzung WHERE benutzer_id = 4").map((x) => x.art);
    const wocheWeg = async () => { for (let i = 0; i < 30 && woche().length; i++) await w.page.waitForTimeout(100); return woche().length === 0; }; // Abmelden geht gerade hinaus
    pruef(woche().join() === 'woche', `Vorbedingung: Roland hat keine Wochen-Sitzung (${JSON.stringify(woche())})`);
    await w.geh('#/mehr');
    await w.page.click('#abmelden');
    let warte = '';
    try { await w.page.waitForSelector('#abmelden-standort', { timeout: 3000 }); warte = await w.text('#abmelden-standort'); } catch (e) { /* unten geprüft */ }
    pruef(warte.includes('Standort wird noch gesendet'), `Sofort abmelden: kein Hinweis „Standort wird noch gesendet …“ (${warte || 'nichts'})`);
    pruef(await w.page.locator('#view, .clock-card').count() === 0, 'Sofort abmelden: Ansicht der Person bleibt während des Wartens sichtbar');
    await w.page.waitForSelector('.login-user, #login-suche', { timeout: 20000 });
    const p7b = s.db.eins('SELECT id, typ, lat, lng, genauigkeit FROM buchung WHERE id = ?', p7.id);
    pruef(nahe(p7b), `Sofort abmelden: Standort ging verloren (${JSON.stringify(p7b)})`);
    pruef((await w.api('/auth/ich')).status === 401, 'Sofort abmelden: Sitzung danach noch gültig');
    pruef(await wocheWeg(), `Sofort abmelden: Wochen-Sitzung bleibt am Server bestehen (${JSON.stringify(woche())})`);
    pruef(await gemerkt() === null, 'Sofort abmelden: Nachtrag bleibt am Gerät gemerkt');
    // App gleich nach dem Stempeln neu laden – Prüfbefund n8-g: nach dem Neuladen wird NICHT neu geortet (ein späterer Ort gehört
    // nicht zur Stempelung); ohne schon ermittelten Standort wird der Nachtrag verworfen
    await w.anmelden(4);
    await w.geh('#/stempeln');
    await w.page.waitForSelector('[data-stempel="pause_ende"]');
    await w.page.click('[data-stempel="pause_ende"]');
    await w.page.waitForSelector('.clock-card[data-status="arbeit"]');
    const pe7 = letzte(4);
    const m7 = JSON.parse(await gemerkt() || '[]');
    pruef(pe7.typ === 'pause_ende' && pe7.lat === null && m7.length === 1 && m7[0].buchungId === pe7.id && m7[0].benutzerId === 4 && !m7[0].standort, `Neu laden: Nachtrag nicht am Gerät gemerkt (${JSON.stringify({ pe7, m7 })})`);
    await w.page.reload();
    await w.page.waitForSelector('#view');
    if (!/#\/stempeln/.test(w.page.url())) await w.geh('#/stempeln');
    await w.page.waitForTimeout(6500); // länger als die Ortung (5 s) – es darf keine starten
    const pe7b = s.db.eins('SELECT id, typ, lat, lng, genauigkeit FROM buchung WHERE id = ?', pe7.id);
    pruef(await w.page.evaluate(() => window.__ortRufe || 0) === 0, `Neu laden ohne ermittelten Standort: neue Ortung gestartet (${await w.page.evaluate(() => window.__ortRufe || 0)})`);
    pruef(pe7b.lat === null, `Neu laden ohne ermittelten Standort: späterer Ort an der Buchung (${JSON.stringify(pe7b)})`);
    pruef(await gemerkt() === null, 'Neu laden: verworfener Nachtrag noch gemerkt');
    pruef(await w.page.locator('#cc-standort').isHidden() || !/erfasst/.test(await w.text('#cc-standort')), 'Neu laden: Anzeige „Standort erfasst“ ohne Standort');
    // schon ermittelter Standort, nur das Senden hängt (z. B. Funkloch) → nach dem Neuladen wird genau dieser Standort gesendet
    let haengt = true; // die Anfrage der Seite vor dem Neuladen bleibt hängen (wird beim Neuladen abgebrochen, erreicht den Server nie)
    await w.page.route('**/api/zeit/stempeln/*/standort', (r) => { if (!haengt) r.continue(); });
    await w.page.click('[data-stempel="pause_start"]');
    await w.page.waitForSelector('dialog[open] #pause-wahl');
    await w.page.click('dialog[open] [data-pause-min="offen"]');
    await w.page.waitForSelector('.clock-card[data-status="pause"]');
    const p9 = letzte(4);
    try { await w.page.waitForFunction(() => { const l = JSON.parse(localStorage.getItem('bt_standort_nachtrag') || '[]'); return l.length === 1 && l[0].standort; }, null, { timeout: 12000 }); } catch (e) { /* unten geprüft */ }
    const m9 = JSON.parse(await gemerkt() || '[]');
    pruef(m9.length === 1 && m9[0].buchungId === p9.id && m9[0].standort && Math.abs(m9[0].standort.lat - NAHE.latitude) < 1e-6, `Neu laden: ermittelter Standort nicht gemerkt (${JSON.stringify(m9)})`);
    pruef(s.db.eins('SELECT lat FROM buchung WHERE id = ?', p9.id).lat === null, 'Vorbedingung: Standort vor dem Neuladen schon am Server');
    haengt = false;
    await w.page.reload();
    await w.page.waitForSelector('#view');
    if (!/#\/stempeln/.test(w.page.url())) await w.geh('#/stempeln');
    await ortZeile(w.page, /^Standort erfasst \(±25 m\)$/, 'Neu laden: Stempeluhr sendet den gemerkten Standort');
    await w.page.waitForTimeout(300);
    pruef(nahe(s.db.eins('SELECT id, typ, lat, lng, genauigkeit FROM buchung WHERE id = ?', p9.id)), `Neu laden: gemerkter Standort ging verloren (${JSON.stringify(s.db.eins('SELECT lat FROM buchung WHERE id = ?', p9.id))})`);
    pruef(await w.page.evaluate(() => window.__ortRufe || 0) === 0, 'Neu laden mit gemerktem Standort: trotzdem neu geortet');
    pruef(await gemerkt() === null, 'Neu laden: Nachtrag nach dem Senden noch gemerkt');
    await w.page.unroute('**/api/zeit/stempeln/*/standort');
    await w.page.click('[data-stempel="pause_ende"]');
    await w.page.waitForSelector('.clock-card[data-status="arbeit"]');
    await w.page.waitForTimeout(5500); // Ortung dieser Stempelung abwarten
    // „Nicht warten“: sofort abgemeldet, danach geht unter der beendeten Sitzung nichts mehr hinaus
    await w.geh('#/stempeln');
    await w.page.waitForSelector('.clock-card[data-status="arbeit"] [data-stempel="pause_start"]');
    await w.page.click('[data-stempel="pause_start"]');
    await w.page.waitForSelector('dialog[open] #pause-wahl');
    await w.page.click('dialog[open] [data-pause-min="offen"]');
    await w.page.waitForSelector('.clock-card[data-status="pause"]');
    const p8 = letzte(4);
    await w.geh('#/mehr');
    w.anfragen.length = 0;
    await w.page.click('#abmelden');
    await w.page.click('#abmelden-sofort', { timeout: 3000 }).catch(() => {});
    const t8 = Date.now();
    await w.page.waitForSelector('.login-user, #login-suche', { timeout: 10000 });
    pruef(Date.now() - t8 < 2500, `„Nicht warten“: Abmelden dauerte ${Date.now() - t8} ms`);
    await w.page.waitForTimeout(5500);
    pruef(await wocheWeg(), `„Nicht warten“: Wochen-Sitzung bleibt am Server bestehen (${JSON.stringify(woche())})`);
    const p8b = s.db.eins('SELECT id, typ, lat FROM buchung WHERE id = ?', p8.id);
    pruef(p8b.typ === 'pause_start' && p8b.lat === null && !w.anfragen.some((x) => /\/standort$/.test(x.url)), `„Nicht warten“: Standort trotzdem gesendet (${JSON.stringify({ p8b, a: w.anfragen.map((x) => x.url) })})`);
    pruef(await gemerkt() === null, '„Nicht warten“: Nachtrag bleibt am Gerät gemerkt');
    await w.zu('Langsame Ortung');

    /* ---- 9) Prüfbefunde n8-g: wartendes Abmelden (geteiltes Gerät, Fokus, Seite geschlossen bzw. abgestürzt) ---- */
    const BLEIBT = new Set(['bt_install_weg', 'bt_installiert', 'bt_letzter', 'bt_letzte_pnr', 'bt_geraet_benutzer', 'bt_abmelden_offen', 'bt_geraet_art', 'bt_geraet_art_benutzer', 'bt_push_wunsch', 'bt_uebersicht_klassisch', 'bt_stunden_format',
      'bt_stempel_queue', 'bt_stempel_abgelehnt', 'bt_fuhren_warten', 'bt_fuhren_abgelehnt']); // ui.js raeumeBenutzer: GERAET + WARTEND
    const sitzungen = () => s.db.alle('SELECT art FROM sitzung WHERE benutzer_id = 4').length;
    const warteBis = async (f, ms) => { for (let i = 0; i < ms / 100 && !f(); i++) await new Promise((r) => setTimeout(r, 100)); return f(); };
    // Roland stempelt (Pause bzw. Pause beenden – je nach Stand) und tippt in „Mehr“ auf Abmelden; die Ortung läuft noch
    const stempeltUndAbmelden = async (x) => {
      await x.geh('#/stempeln');
      await x.page.waitForSelector('.clock-card[data-status="arbeit"], .clock-card[data-status="pause"]');
      if (await x.page.locator('[data-stempel="pause_ende"]').count()) { await x.page.click('[data-stempel="pause_ende"]'); await x.page.waitForSelector('.clock-card[data-status="arbeit"]'); }
      else { await x.page.click('[data-stempel="pause_start"]'); await x.page.waitForSelector('dialog[open] #pause-wahl'); await x.page.click('dialog[open] [data-pause-min="offen"]'); await x.page.waitForSelector('.clock-card[data-status="pause"]'); }
      const b = letzte(4);
      await x.geh('#/mehr');
      await x.page.click('#abmelden');
      await x.page.waitForSelector('#abmelden-standort', { timeout: 3000 });
      return b;
    };
    const restSchluessel = (pg) => pg.evaluate((erlaubt) => Object.keys(localStorage).filter((k) => k.startsWith('bt_') && !erlaubt.includes(k)), [...BLEIBT]);

    // 9a) geteiltes Gerät: A meldet sich mit „Nicht warten“ ab – B wartet beim Abmelden nicht auf A's Ortung
    const a9 = await kontext({ langsamMs: 12000 });
    await a9.anmelden(4);
    await stempeltUndAbmelden(a9);
    await a9.page.click('#abmelden-sofort');
    await a9.page.waitForSelector('.login-user, #login-suche', { timeout: 5000 });
    await a9.anmelden(U.mitarbeiter); // Lukas, Standort aus
    await a9.geh('#/mehr');
    const t9 = Date.now();
    await a9.page.click('#abmelden');
    const d9 = a9.page.locator('dialog[open] .btn.primary, dialog[open] .btn.danger');
    if (await d9.count()) await d9.first().click();
    const warteB = await a9.page.locator('#abmelden-standort').count();
    await a9.page.waitForSelector('.login-user, #login-suche', { timeout: 15000 });
    pruef(warteB === 0 && Date.now() - t9 < 2500, `Geteiltes Gerät: die nächste Person wartet beim Abmelden auf den Standort der vorigen (${warteB ? 'Hinweis „Standort wird noch gesendet …“, ' : ''}${Date.now() - t9} ms)`);
    await a9.zu('Geteiltes Gerät, Nachtrag der vorigen Person');

    // 9b) Fenster-Fokus während des Wartens schickt das Abmelden nicht vor dem Standort hinaus
    const b9 = await kontext({ langsamMs: 5000 });
    await b9.anmelden(4);
    const reihe = [];
    b9.page.on('request', (r) => { const u = r.url(); if (u.includes('/api/')) reihe.push(`${r.method()} ${u.replace(/^.*\/api/, '').replace(/\?.*$/, '')}`); });
    const bf = await stempeltUndAbmelden(b9);
    reihe.length = 0;
    await b9.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await b9.page.waitForSelector('.login-user, #login-suche', { timeout: 20000 });
    const bfNach = s.db.eins('SELECT id, typ, lat, lng, genauigkeit FROM buchung WHERE id = ?', bf.id);
    const iOrt = reihe.indexOf(`POST /zeit/stempeln/${bf.id}/standort`), iAb = reihe.indexOf('POST /auth/logout');
    pruef(nahe(bfNach) && iOrt >= 0 && (iAb < 0 || iOrt < iAb), `Fokus beim Warten: Standort verloren bzw. Abmelden zuerst gesendet (${JSON.stringify({ lat: bfNach.lat, reihe })})`);
    pruef(await warteBis(() => sitzungen() === 0, 3000), 'Fokus beim Warten: Sitzung danach noch am Server');
    await b9.zu('Fokus beim Warten');

    // 9c) Seite wird während des Wartens geschlossen: Sitzung (auch die Wochen-Sitzung) endet, keine Daten der Person bleiben am Gerät
    const c9 = await kontext({ langsamMs: 15000 });
    await c9.anmelden(4);
    pruef(sitzungen() === 1, 'Vorbedingung: Roland nicht angemeldet');
    await stempeltUndAbmelden(c9);
    await c9.page.close();
    pruef(await warteBis(() => sitzungen() === 0, 4000), `Seite geschlossen: Sitzung bleibt am Server gültig (${sitzungen()})`);
    const c9b = await c9.ctx.newPage();
    await c9b.goto(s.basis + '/manifest.webmanifest'); // gleiche Herkunft, ohne die App zu starten
    // bt_tresor (nur Geräteschlüssel + ID, keine Daten) bleibt, bis das Versiegeln beim nächsten Öffnen nachgeholt ist
    const rest9 = (await restSchluessel(c9b)).filter((x) => x !== 'bt_tresor');
    pruef(rest9.length === 0, `Seite geschlossen: Daten der Person bleiben am Gerät (${rest9.join(', ')})`);
    const ich9 = await c9b.evaluate(async () => (await fetch('/api/auth/ich')).status);
    pruef(ich9 === 401, `Seite geschlossen: /api/auth/ich im selben Browser ${ich9}`);
    await c9b.goto(s.basis + '/#/login');
    await c9b.waitForSelector('.login-user, #login-suche', { timeout: 10000 });
    await c9b.waitForTimeout(800);
    const rest9b = await restSchluessel(c9b);
    pruef(rest9b.length === 0, `Seite geschlossen, App wieder geöffnet: am Gerät bleibt ${rest9b.join(', ')}`);
    await c9b.close();
    await c9.ctx.close();

    // 9d) App stürzt während des Wartens ab (kein pagehide): beim nächsten Öffnen wird das Abmelden fertig gemacht
    const e9 = await kontext({ langsamMs: 15000 });
    await e9.anmelden(4);
    await stempeltUndAbmelden(e9);
    const cdp = await e9.ctx.newCDPSession(e9.page);
    const absturz = e9.page.waitForEvent('crash', { timeout: 5000 }).catch(() => null);
    cdp.send('Page.crash').catch(() => {});
    await absturz;
    const e9b = await e9.ctx.newPage();
    await e9b.goto(s.basis + '/#/login');
    await e9b.waitForSelector('.login-user, #login-suche', { timeout: 10000 });
    await e9b.waitForTimeout(800);
    const rest9d = await restSchluessel(e9b);
    pruef(rest9d.length === 0, `Nach Absturz neu geöffnet: Daten der Person bleiben am Gerät (${rest9d.join(', ')})`);
    pruef(await warteBis(() => sitzungen() === 0, 3000), `Nach Absturz neu geöffnet: Sitzung bleibt am Server (${sitzungen()})`);
    pruef(await e9b.evaluate(async () => (await fetch('/api/auth/ich')).status) === 401, 'Nach Absturz neu geöffnet: /api/auth/ich nicht 401');
    pruef(await e9b.evaluate(() => /(^|; )bt_bindung=[^;]/.test(document.cookie)) === false, 'Nach Absturz neu geöffnet: Bindungs-Cookie noch gesetzt');
    await e9b.close();
    await e9.ctx.close();

    // 9e) Prüfbefund n8-s: Buchung bei wackeliger Verbindung in die Warteschlange (Server nicht erreichbar), gleich abgemeldet –
    // die Ortung wird fertig, das Nachsenden der Buchung (mit Standort) geht noch unter der Sitzung hinaus, das Abmelden erst danach
    const g9 = await kontext({ langsamMs: 5000 });
    await g9.anmelden(4);
    const reiheG = [];
    g9.page.on('request', (r) => { const u = r.url(); if (u.includes('/api/')) reiheG.push(`${r.method()} ${u.replace(/^.*\/api/, '').replace(/\?.*$/, '')}`); });
    await g9.geh('#/stempeln');
    await g9.page.waitForSelector('.clock-card[data-status="arbeit"], .clock-card[data-status="pause"]');
    const vorG = letzte(4);
    await g9.page.route('**/api/zeit/stempeln', (r) => (r.request().method() === 'POST' ? r.abort('internetdisconnected') : r.continue()));
    const typG = (await g9.page.locator('[data-stempel="pause_ende"]').count()) ? 'pause_ende' : 'pause_start';
    await g9.page.click(`[data-stempel="${typG}"]`);
    if (typG === 'pause_start') { await g9.page.waitForSelector('dialog[open] #pause-wahl'); await g9.page.click('dialog[open] [data-pause-min="offen"]'); }
    const qG = () => g9.page.evaluate(() => JSON.parse(localStorage.getItem('bt_stempel_queue') || '[]'));
    try { await g9.page.waitForFunction(() => JSON.parse(localStorage.getItem('bt_stempel_queue') || '[]').some((e) => typeof e.standortWartet === 'number'), null, { timeout: 4000 }); } catch (e) { /* unten geprüft */ }
    const qG1 = await qG();
    pruef(qG1.length === 1 && qG1[0].typ === typG && typeof qG1[0].standortWartet === 'number', `Vorbedingung 9e: Buchung nicht wartend in der Warteschlange (${JSON.stringify(qG1)})`);
    await g9.page.unroute('**/api/zeit/stempeln'); // Verbindung wieder da
    await g9.geh('#/mehr');
    reiheG.length = 0;
    await g9.page.click('#abmelden');
    const dG = g9.page.locator('dialog[open] .btn.primary, dialog[open] .btn.danger');
    try { await dG.first().waitFor({ timeout: 2000 }); await dG.first().click(); } catch (e) { /* keine Rückfrage */ }
    let warteG = 0;
    try { await g9.page.waitForSelector('#abmelden-standort', { timeout: 3000 }); warteG = 1; } catch (e) { /* unten geprüft */ }
    pruef(warteG === 1, '9e: kein „Standort wird noch gesendet …“ beim Abmelden mit wartender Buchung');
    await g9.page.waitForSelector('.login-user, #login-suche', { timeout: 25000 });
    await g9.page.waitForTimeout(500);
    const nachG = letzte(4);
    pruef(nachG.id > vorG.id && nachG.typ === typG && nachG.quelle === 'offline' && nahe(nachG), `9e: wartende Buchung nicht (mit Standort) vor dem Abmelden angekommen (${JSON.stringify({ nachG, reihe: reiheG })})`);
    const iStG = reiheG.indexOf('POST /zeit/stempeln'), iAbG = reiheG.indexOf('POST /auth/logout');
    pruef(iStG >= 0 && iAbG > iStG, `9e: Abmelden vor dem Nachsenden gesendet (${JSON.stringify(reiheG)})`);
    pruef((await qG()).length === 0, `9e: Buchung bleibt in der Warteschlange (${JSON.stringify(await qG())})`);
    pruef(await warteBis(() => sitzungen() === 0, 3000), `9e: Sitzung danach noch am Server (${sitzungen()})`);
    await g9.zu('Wartende Buchung beim Abmelden');

    // 9f) Prüfbefund n8-l: zwei Buchungen in der Warteschlange – die erste (Standort schon ermittelt) wird beim Abmelden gerade
    // langsam nachgesendet, die zweite wartet noch auf die Ortung. Der laufende Lauf bricht bei der wartenden ab; das Abmelden
    // wartet auch auf den Folgelauf mit der georteten zweiten Buchung – beide kommen (mit Standort) vor dem Logout an.
    const h9 = await kontext({ langsamMs: 5000 });
    await h9.anmelden(4);
    const reiheH = [];
    h9.page.on('request', (r) => { const u = r.url(); if (u.includes('/api/') && r.method() !== 'GET') reiheH.push(`${r.method()} ${u.replace(/^.*\/api/, '').replace(/\?.*$/, '')}`); });
    await h9.geh('#/stempeln');
    await h9.page.waitForSelector('.clock-card[data-status="arbeit"], .clock-card[data-status="pause"]');
    const vorH = letzte(4);
    let modusH = 'abbruch', ersteH = true;
    await h9.page.route('**/api/zeit/stempeln', async (r) => {
      if (r.request().method() !== 'POST') return r.continue();
      if (modusH === 'abbruch') return r.abort('internetdisconnected');
      if (ersteH) { ersteH = false; await new Promise((ok) => setTimeout(ok, 7000)); } // langsame Verbindung: die erste braucht 7 s
      return r.continue();
    });
    const qH = () => h9.page.evaluate(() => JSON.parse(localStorage.getItem('bt_stempel_queue') || '[]'));
    const pauseH = async (typ) => {
      await h9.page.click(`[data-stempel="${typ}"]`);
      if (typ === 'pause_start') { await h9.page.waitForSelector('dialog[open] #pause-wahl'); await h9.page.click('dialog[open] [data-pause-min="offen"]'); }
    };
    const typH1 = (await h9.page.locator('[data-stempel="pause_ende"]').count()) ? 'pause_ende' : 'pause_start';
    const typH2 = typH1 === 'pause_ende' ? 'pause_start' : 'pause_ende';
    await pauseH(typH1);
    try { await h9.page.waitForFunction(() => { const q = JSON.parse(localStorage.getItem('bt_stempel_queue') || '[]'); return q.length === 1 && q[0].standort && q[0].standortWartet === undefined; }, null, { timeout: 9000 }); } catch (e) { /* unten geprüft */ }
    await h9.page.waitForSelector(`[data-stempel="${typH2}"]`, { timeout: 5000 });
    await pauseH(typH2);
    try { await h9.page.waitForFunction(() => { const q = JSON.parse(localStorage.getItem('bt_stempel_queue') || '[]'); return q.length === 2 && typeof q[1].standortWartet === 'number'; }, null, { timeout: 4000 }); } catch (e) { /* unten geprüft */ }
    const qH1 = await qH();
    pruef(qH1.length === 2 && qH1[0].typ === typH1 && !!qH1[0].standort && qH1[0].standortWartet === undefined && qH1[1].typ === typH2 && typeof qH1[1].standortWartet === 'number',
      `Vorbedingung 9f: nicht eine geortete und eine wartende Buchung in der Warteschlange (${JSON.stringify(qH1)})`);
    modusH = 'langsam'; // Verbindung wieder da, aber langsam
    reiheH.length = 0;
    await h9.page.evaluate(() => window.dispatchEvent(new Event('online'))); // Nachsenden der ersten beginnt
    await h9.geh('#/mehr');
    await h9.page.click('#abmelden');
    const dH = h9.page.locator('dialog[open] .btn.primary, dialog[open] .btn.danger');
    try { await dH.first().waitFor({ timeout: 1500 }); await dH.first().click(); } catch (e) { /* keine Rückfrage */ }
    let warteH = 0;
    try { await h9.page.waitForSelector('#abmelden-standort', { timeout: 3000 }); warteH = 1; } catch (e) { /* unten geprüft */ }
    pruef(warteH === 1, '9f: kein „Standort wird noch gesendet …“ beim Abmelden mit wartender Buchung');
    await h9.page.waitForSelector('.login-user, #login-suche', { timeout: 30000 });
    await h9.page.waitForTimeout(500);
    const neuH = s.db.alle('SELECT id, typ, quelle, lat, lng, genauigkeit FROM buchung WHERE benutzer_id = 4 AND id > ? ORDER BY id', vorH.id);
    pruef(neuH.length === 2 && neuH[0].typ === typH1 && neuH[1].typ === typH2 && neuH.every((x) => x.quelle === 'offline' && nahe(x)),
      `9f: nicht beide Buchungen (mit Standort) vor dem Abmelden angekommen (${JSON.stringify({ neuH, reihe: reiheH })})`);
    const iSt2H = reiheH.lastIndexOf('POST /zeit/stempeln'), iAbH = reiheH.indexOf('POST /auth/logout');
    pruef(reiheH.filter((x) => x === 'POST /zeit/stempeln').length >= 2 && iAbH > iSt2H, `9f: Abmelden vor dem Folgelauf gesendet (${JSON.stringify(reiheH)})`);
    pruef((await qH()).length === 0, `9f: Buchung bleibt in der Warteschlange (${JSON.stringify(await qH())})`);
    pruef(await warteBis(() => sitzungen() === 0, 3000), `9f: Sitzung danach noch am Server (${sitzungen()})`);
    await h9.zu('Zwei Buchungen in der Warteschlange beim Abmelden');

    /* ---- 8) Zusammen mit „Pause beim Gehen“ (15.27): Standort an der Gehen-Buchung, nicht an der nachgetragenen Pause ---- */
    s.uhr.plus(300); // Fabian ist seit 6) eingestempelt (ohne Pause) – 5 Std. später gehen, die Pause passt in die Schicht
    const f = await kontext();
    await f.anmelden(6);
    await f.geh('#/stempeln');
    await f.page.waitForSelector('.clock-card[data-status="arbeit"] [data-stempel="gehen"]');
    f.anfragen.length = 0;
    await f.page.click('[data-stempel="gehen"]');
    let pgOffen = true;
    try { await f.page.waitForSelector('dialog[open] #pause-gehen', { timeout: 5000 }); } catch (e) { pgOffen = false; }
    pruef(pgOffen, 'Gehen mit Pause: Dialog „Heute keine Pause gestempelt“ kommt nicht');
    pruef(!f.anfragen.some((a) => a.methode === 'POST'), 'Gehen mit Pause: vor der Wahl im Dialog schon gebucht');
    if (pgOffen) await f.page.click('dialog[open] [data-pg-min="30"]');
    await f.page.waitForSelector('.clock-card[data-status="aus"]');
    await ortZeile(f.page, /^Standort erfasst \(±25 m\)$/, 'Gehen mit Pause: „Standort erfasst (±25 m)“');
    const fb = s.db.alle('SELECT id, typ, nachgetragen, lat, lng, genauigkeit FROM buchung WHERE benutzer_id = 6 AND id > ? ORDER BY zeit, id', ma14.id);
    const gehen8 = fb.find((x) => x.typ === 'gehen');
    pruef(fb.map((x) => `${x.typ}:${x.nachgetragen}`).join(',') === 'pause_start:1,pause_ende:1,gehen:0', `Gehen mit Pause: Buchungen ${JSON.stringify(fb)}`);
    pruef(nahe(gehen8), `Gehen mit Pause: Standort nicht am Gehen (${JSON.stringify(gehen8)})`);
    pruef(fb.filter((x) => x.nachgetragen).every((x) => x.lat === null), `Gehen mit Pause: nachgetragene Pause mit Standort (${JSON.stringify(fb)})`);
    const st8 = f.anfragen.filter((a) => a.methode === 'POST' && a.url === '/zeit/stempeln');
    pruef(st8.length === 1 && st8[0].body.includes('pauseBeimGehen') && !st8[0].body.includes('standort'), `Gehen mit Pause: Stempel-Anfrage ${JSON.stringify(st8.map((x) => x.body))}`);
    pruef(!!gehen8 && f.anfragen.filter((a) => /\/standort$/.test(a.url)).map((a) => a.url).join() === `/zeit/stempeln/${gehen8.id}/standort`, `Gehen mit Pause: Standort an ${JSON.stringify(f.anfragen.map((a) => a.url))} statt an das Gehen`);
    await f.abmelden();
    await f.zu('Gehen mit Pause');
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
