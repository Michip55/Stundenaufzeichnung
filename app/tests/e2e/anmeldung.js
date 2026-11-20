'use strict';
/**
 * Anmeldung „eigener Name am eigenen Handy“ (API.md 15.33, Inhaber 19.11.2026, Variante B):
 *   node tests/e2e/anmeldung.js     (im Ordner app; E2E_NUR=handy|tablet|pc; Exit-Code 1 bei Befunden; E2E_BILDER=<Ordner>)
 * Wird auch von run.js je Bildschirmgröße aufgerufen (abschaltbar mit E2E_OHNE_ANMELDUNG=1).
 *
 *  1. Server ohne Namensliste (Standard): die Anmeldeseite fragt die Namensliste nie ab, zeigt keine Namen, Personalnummer leer.
 *  2. Eigenes Handy: Anmeldung mit Personalnummer + PIN (falsche PIN → Meldung); danach sind Name und Personalnummer gemerkt,
 *     „Mehr“ zeigt die eigene Personalnummer (keine fremde). Nach dem Abmelden: Name, „Auf diesem Handy gemerkt“, PIN-Feld,
 *     „Andere Person“ über die ganze Breite, Gerätewahl darunter; falsche PIN bleibt in dieser Ansicht; richtige PIN meldet an.
 *  3. „Andere Person“ → Personalnummer (leer), „Zurück“ → wieder die gemerkte Person; eine andere Person meldet sich an →
 *     ersetzt die gemerkte.
 *  4. Laufende Sitzung von vor der Umstellung (nichts gemerkt): beim Start der App wird die Person gemerkt (aus /auth/ich).
 *  5. Geteiltes Gerät: Wahl auf der Anmeldeseite vergisst die gemerkte Person sofort; danach nie Namen, keine Vorbelegung,
 *     auch nicht nach Anmelden/Abmelden; keine Anfrage an die Namensliste.
 *  6. Zwei-Faktor (Büro): eigenes Handy, PIN → Code → angemeldet; danach gemerkt, PIN → Code → angemeldet.
 *  6b. Personalnummer der gemerkten Person geändert: richtige PIN → „Benutzer oder PIN falsch“ mit Hinweis auf „Andere Person“;
 *     dort mit der neuen Nummer → angemeldet, neue Nummer gemerkt. Dazu (Abschnitte 2, 6b) echte Erreichbarkeit von
 *     „Andere Person“ und Gerätewahl per Wischen/Mausrad, auch bei 360×640, 390×664, 1024×768, 1366×768.
 *  7. Sperre: zu viele falsche PINs bei der gemerkten Person → Sperrtext, Ziffern gesperrt, „Andere Person“ bleibt.
 *  8. Benutzerverwaltung (GF): Warnung „N aktive Personen ohne Personalnummer – sie können sich nicht anmelden“ mit Namen (ohne
 *     inaktive), Speichern ohne Nummer → Meldung, mit Nummer → Warnung kleiner; Polier erreicht die Verwaltung nicht.
 *  9. Namensliste ausdrücklich eingeschaltet (BAUTAG_LOGIN_LISTE=1): Anmeldeseite wie bisher mit Namensliste.
 *  Prüfung 20.11.2026: Hilfe passt zur Anmeldeart (8: ohne Liste Personalnummer-Texte; 9: „Namen antippen“, für die GF
 *     Personalnummer freiwillig, ohne die beiden Pflicht-Schritte).
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { starte, U } = require('../api/hilfe');
const T = require('../../server/totp');
const { GROESSEN } = require('./geraet');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function laufe(browser, g) {
  const fehler = [];
  let schritte = 0;
  const pruef = (ok, text) => { schritte++; if (!ok) { fehler.push(`Anmeldung/${g.name}: ${text}`); console.log(`    ✗ Anmeldung/${g.name}: ${text}`); } };
  const s = await starte({ test: true, loginListe: false });
  const bilder = process.env.E2E_BILDER || '';
  let ctx = null, ctx2 = null;
  let abschnitt = '';
  try {
    const db = s.db;
    const person = (id) => db.eins('SELECT id, name, pnr FROM benutzer WHERE id = ?', id);
    const MA = person(U.mitarbeiter), PO = person(U.polier), BU = person(U.buero), P2 = person(U.polier2);

    // Zwei-Faktor für das Büro einrichten (über die API, wie in tests/api/zweifaktor.test.js)
    const bc = await s.login(U.buero);
    const geheimnis = (await bc.post('/auth/2fa/einrichten', { pin: '1234' })).daten.geheimnis;
    const code = () => T.totp(T.base32Dekodieren(geheimnis), s.uhr().getTime());
    pruef((await bc.post('/auth/2fa/bestaetigen', { code: code() })).status === 200, 'Vorbedingung: Zwei-Faktor des Büros nicht eingerichtet');
    s.uhr.plus(1);

    ctx = await browser.newContext({ viewport: { width: g.width, height: g.height }, deviceScaleFactor: bilder ? 2 : 1, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: g.mobil, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    const seitenfehler = [];
    page.on('pageerror', (e) => seitenfehler.push(String(e.message).slice(0, 160)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) seitenfehler.push(m.text().slice(0, 160)); });
    const anfragen = [];
    page.on('request', (r) => { const u = r.url(); if (u.includes('/api/')) anfragen.push(u.slice(u.indexOf('/api/'))); });
    const listeAbgefragt = () => anfragen.some((u) => u.startsWith('/api/auth/benutzerliste'));

    const bereit = async () => { await page.waitForFunction(() => !document.querySelector('#view .view-box > .state .spinner, #root > .state .spinner, #login-card .spinner'), null, { timeout: 15000 }); await sleep(80); };
    const text = () => page.evaluate(() => document.body.innerText);
    const gemerkt = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('bt_handy_person') || 'null'); } catch (e) { return 'kaputt'; } });
    const ich = () => page.evaluate(async () => { const r = await fetch('/api/auth/ich'); return r.ok ? r.json() : { status: r.status }; });
    const ueberlauf = async (wo) => { const d = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); pruef(d <= 1, `${wo}: seitlicher Überlauf (${d} px)`); };
    const bild = async (name) => { if (bilder) await page.screenshot({ path: path.join(bilder, `${name}-${g.width}.png`) }); };
    let ladeNr = 0;
    const zurAnmeldung = async () => { await page.goto(`${s.basis}/?anm=${++ladeNr}#/login`); await page.waitForSelector('#login-card #pnr, #login-card .pin-user, #login-card .login-user'); await bereit(); };
    const pinEingeben = async (pin) => { for (const z of pin) await page.click(`.pin-pad [data-z="${z}"]`); await page.click('.pin-pad [data-ok]'); };
    const pnrEingeben = async (pnr) => { await page.fill('#pnr', String(pnr)); await page.click('#pnr-form button[type="submit"]'); await page.waitForSelector('.pin-pad'); };
    const angemeldet = async () => { await page.waitForSelector('#view', { timeout: 20000 }); await bereit(); };
    const pinMeldung = () => page.locator('#pin-msg').innerText().catch(() => '');
    const warteMeldung = async () => { await page.waitForFunction(() => { const m = document.querySelector('#pin-msg'); return m && m.classList.contains('err'); }, null, { timeout: 15000 }); return pinMeldung(); };
    async function abmelden() {
      await page.evaluate(() => { location.hash = '#/mehr'; }); await page.waitForSelector('#abmelden'); await bereit();
      await page.click('#abmelden');
      await sleep(200);
      const ok = page.locator('dialog[open] [data-ok]');
      if (await ok.count()) await ok.click();
      await page.waitForSelector('#login-card #pnr, #login-card .pin-user', { timeout: 20000 }); await bereit();
    }
    const waehle = async (art) => { await page.click(`#geraet-wahl label:has(input[value="${art}"])`); await sleep(200); };
    // Nachprüfung 15.33 (Befund 1): echte Erreichbarkeit – Seite, body und #root scrollen nicht; ohne programmatisches Scrollen
    // (scrollIntoView ginge auch bei overflow hidden) wischen (Touch) bzw. Mausrad, dann muss „Andere Person“ und „Geteiltes Gerät“
    // ganz im sichtbaren Bereich und kein Teil der Karte unter ihrem Rand liegen.
    async function wische() {
      const k = await page.evaluate(() => { const r = document.querySelector('#login-card').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.7, h: r.height }; });
      if (g.mobil) {
        const cdp = await ctx.newCDPSession(page);
        for (let n = 0; n < 3; n++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: k.x, y: k.y }] });
          for (let i = 1; i <= 12; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: k.x, y: k.y - i * Math.min(25, k.h / 30) }] }); await sleep(16); }
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(250);
        }
        await cdp.detach();
      } else { await page.mouse.move(k.x, k.y); await page.mouse.wheel(0, 1500); await sleep(400); }
    }
    async function erreichbar(wo) {
      await page.evaluate(() => { document.querySelector('#login-card').scrollTop = 0; });
      const vorher = await page.evaluate(() => { const a = document.querySelector('[data-andere]').getBoundingClientRect(); return { andere: Math.round(a.bottom), ih: innerHeight }; });
      await wische();
      const r = await page.evaluate(() => {
        const c = document.querySelector('#login-card').getBoundingClientRect();
        const box = (e) => { const x = e.getBoundingClientRect(); return { top: Math.round(x.top), bottom: Math.round(x.bottom) }; };
        const andere = box(document.querySelector('[data-andere]')), geteilt = box(document.querySelector('#geraet-wahl input[value="geteilt"]').closest('label'));
        const unten = Math.min(innerHeight, Math.round(c.bottom));
        const unter = [...document.querySelectorAll('#login-card > *')].filter((e) => e.getBoundingClientRect().bottom > c.bottom + 1).map((e) => e.className || e.tagName);
        return { andere, geteilt, unten, unter, ok: andere.top >= 0 && andere.bottom <= unten && geteilt.bottom <= unten && !unter.length };
      });
      pruef(r.ok, `${wo}: „Andere Person“/„Geteiltes Gerät“ nach dem Wischen nicht ganz sichtbar bzw. Inhalt unter dem Kartenrand (${JSON.stringify(r)})`);
      await page.evaluate(() => { document.querySelector('#login-card').scrollTop = 0; });
      return vorher;
    }
    // weitere Bildschirmhöhen je Größe: kleines Handy, Handy-Browser mit Adressleiste, Laptop quer
    const ENGE = { handy: [[360, 640], [390, 664], [360, 740]], tablet: [[1024, 768]], pc: [[1366, 768], [1024, 768]] }[g.name] || [];

    /* ---- 1) frisches Gerät, Server ohne Namensliste ---- */

    abschnitt = '1';
    await zurAnmeldung();
    pruef(await page.locator('#pnr').count() === 1, 'Frisches Gerät: Eingabe der Personalnummer fehlt');
    pruef(await page.locator('.login-user, #login-suche').count() === 0, 'Frisches Gerät: Namensliste sichtbar');
    pruef(await page.inputValue('#pnr') === '', 'Frisches Gerät: Personalnummer vorbelegt');
    pruef(!listeAbgefragt(), 'Namensliste wurde abgefragt, obwohl sie aus ist');
    pruef(anfragen.includes('/api/auth/anmeldung'), 'GET /auth/anmeldung fehlt');
    pruef(await page.locator('#geraet-wahl input[value="eigen"]:checked').count() === 1, 'Standard „Eigenes Handy“ fehlt');
    await ueberlauf('Personalnummer');
    await page.fill('#pnr', '12a'); await page.click('#pnr-form button[type="submit"]');
    pruef(/nur Ziffern/.test(await page.locator('#pnr-err').innerText()), 'Ungültige Personalnummer: Meldung fehlt');

    /* ---- 2) eigenes Handy: Personalnummer + PIN, dann gemerkt ---- */

    abschnitt = '2';
    await pnrEingeben(MA.pnr);
    pruef(await page.locator('.pin-user h2').innerText() === `Personalnummer ${MA.pnr}`, 'PIN-Seite nach der Personalnummer verrät einen Namen');
    await pinEingeben('9999');
    let m = await warteMeldung();
    pruef(/PIN falsch/.test(m), `Falsche PIN: Meldung „${m}“`);
    await pinEingeben('1234');
    await angemeldet();
    let gm = await gemerkt();
    pruef(gm && gm.pnr === MA.pnr && gm.name === MA.name && gm.id === MA.id, `Eigenes Handy: Person nicht gemerkt (${JSON.stringify(gm)})`);
    pruef(await page.evaluate(() => localStorage.getItem('bt_letzte_pnr')) === null, 'bt_letzte_pnr wird noch gespeichert');
    await page.evaluate(() => { location.hash = '#/mehr'; }); await page.waitForSelector('#eigene-pnr'); await bereit();
    const eigen = await page.locator('#eigene-pnr').innerText();
    pruef(eigen.includes(String(MA.pnr)), `„Mehr“: eigene Personalnummer fehlt („${eigen}“)`);
    const fremd = db.alle('SELECT pnr FROM benutzer WHERE pnr IS NOT NULL AND id <> ?', MA.id).map((x) => String(x.pnr));
    const mehrText = await text();
    pruef(!fremd.some((p) => new RegExp(`\\b${p}\\b`).test(mehrText)), '„Mehr“ zeigt eine fremde Personalnummer');
    await ueberlauf('Mehr');
    if (g.width <= 719) await bild('eigene-personalnummer');

    await abmelden();
    pruef(await page.locator('.pin-user.gemerkt').count() === 1, 'Nach dem Abmelden: gemerkte Person fehlt');
    pruef((await page.locator('.pin-user h2').innerText()) === MA.name, 'Gemerkte Person: Name falsch');
    pruef(/Auf diesem Handy gemerkt/.test(await page.locator('.pin-user p').innerText()), '„Auf diesem Handy gemerkt“ fehlt');
    pruef(await page.locator('#pnr, .login-user').count() === 0, 'Gemerkte Person: Personalnummer/Namensliste trotzdem sichtbar');
    pruef(await page.locator('[data-andere]').count() === 1 && await page.locator('#geraet-wahl').count() === 1, '„Andere Person“ oder Gerätewahl fehlt');
    const breite = await page.evaluate(() => { const a = document.querySelector('[data-andere]').getBoundingClientRect(), p = document.querySelector('.pin-pad').getBoundingClientRect(), w = document.querySelector('#geraet-wahl').getBoundingClientRect(); return { a: a.width, p: p.width, unter: w.top >= a.bottom - 1 && a.top >= p.bottom - 1 }; });
    pruef(Math.abs(breite.a - breite.p) <= 2 && breite.unter, `„Andere Person“ nicht über die ganze Breite unter dem PIN-Feld bzw. Gerätewahl nicht darunter (${JSON.stringify(breite)})`);
    await ueberlauf('Gemerkte Person');
    // Gerätewahl und „Andere Person“ wirklich erreichbar (Wischen/Mausrad), auch bei wenig Höhe; „Andere Person“ ohne Scrollen sichtbar
    for (const [w, h] of [[g.width, g.height], ...ENGE]) {
      if (w !== g.width || h !== g.height) { await page.setViewportSize({ width: w, height: h }); await sleep(250); }
      const v = await erreichbar(`Gemerkte Person ${w}×${h}`);
      pruef(v.andere <= v.ih, `Gemerkte Person ${w}×${h}: „Andere Person“ erst nach dem Scrollen sichtbar (${v.andere} > ${v.ih})`);
    }
    await page.setViewportSize({ width: g.width, height: g.height }); await sleep(250);
    await bild('eigenes-handy-gemerkt');
    await pinEingeben('9999');
    m = await warteMeldung();
    pruef(/PIN falsch/.test(m) && await page.locator('.pin-user.gemerkt').count() === 1 && await page.locator('[data-andere]').count() === 1, `Gemerkt, falsche PIN: Ansicht/Meldung falsch („${m}“)`);
    // Nachprüfung 15.33 (Befund 3): Ausweg nach „Benutzer oder PIN falsch“ – ohne zu verraten, ob Nummer oder PIN falsch war
    const hilfe = await page.locator('#pin-hilfe').innerText().catch(() => '');
    pruef(/Andere Person/.test(hilfe) && /Personalnummer/.test(hilfe) && /Büro/.test(hilfe), `Gemerkt, falsche PIN: Hinweis auf „Andere Person“ fehlt („${hilfe}“)`);
    await pinEingeben('1234');
    await angemeldet();
    let i = await ich();
    pruef(i.benutzer && i.benutzer.id === MA.id && i.sitzungArt === 'woche', `Gemerkt: angemeldet als ${JSON.stringify(i.benutzer && i.benutzer.name)} (${i.sitzungArt})`);

    /* ---- 3) Andere Person ---- */

    abschnitt = '3';
    await abmelden();
    await page.click('[data-andere]');
    await page.waitForSelector('#pnr');
    pruef(await page.inputValue('#pnr') === '', '„Andere Person“: Personalnummer vorbelegt');
    pruef(await page.locator('#geraet-wahl').count() === 1, '„Andere Person“: Gerätewahl fehlt');
    await ueberlauf('Andere Person');
    await bild('andere-person-personalnummer');
    await page.click('[data-zurueck]');
    await page.waitForSelector('.pin-user.gemerkt');
    pruef((await page.locator('.pin-user h2').innerText()) === MA.name, '„Zurück“ führt nicht zur gemerkten Person');
    await page.click('[data-andere]'); await page.waitForSelector('#pnr');
    await pnrEingeben(PO.pnr);
    await pinEingeben('1234');
    await angemeldet();
    gm = await gemerkt();
    pruef(gm && gm.id === PO.id && gm.name === PO.name, `Andere Person am eigenen Handy ersetzt die gemerkte nicht (${JSON.stringify(gm)})`);

    /* ---- 4) laufende Sitzung von vor der Umstellung: beim Start gemerkt ---- */

    abschnitt = '4';
    await page.evaluate(() => localStorage.removeItem('bt_handy_person'));
    await page.goto(`${s.basis}/?anm=${++ladeNr}#/stempeln`); await angemeldet();
    gm = await gemerkt();
    pruef(gm && gm.id === PO.id && gm.pnr === PO.pnr, `Start mit laufender Wochen-Sitzung: Person nicht gemerkt (${JSON.stringify(gm)})`);
    await abmelden();
    pruef((await page.locator('.pin-user h2').innerText().catch(() => '')) === PO.name, 'Nach dem Start mit laufender Sitzung: Anmeldeseite zeigt die Person nicht');

    /* ---- 5) geteiltes Gerät ---- */

    abschnitt = '5';
    await waehle('geteilt');
    await page.waitForSelector('#pnr');
    pruef(await gemerkt() === null, '„Geteiltes Gerät“: gemerkte Person nicht gelöscht');
    let t = await text();
    pruef(!t.includes(PO.name) && !t.includes(MA.name), '„Geteiltes Gerät“: Name noch sichtbar');
    pruef(await page.locator('[data-zurueck]').count() === 0, '„Geteiltes Gerät“: „Zurück“ zu einer Person sichtbar');
    await bild('geteiltes-geraet');
    await zurAnmeldung();
    t = await text();
    pruef(await page.locator('#pnr').count() === 1 && await page.inputValue('#pnr') === '' && !t.includes(PO.name), 'Geteiltes Gerät nach Neuladen: Name oder Vorbelegung');
    pruef(await page.locator('#geraet-wahl input[value="geteilt"]:checked').count() === 1, 'Geteiltes Gerät nach Neuladen nicht gewählt');
    await pnrEingeben(MA.pnr);
    await pinEingeben('1234');
    await angemeldet();
    pruef(await gemerkt() === null, 'Geteiltes Gerät: Person nach der Anmeldung gemerkt');
    i = await ich();
    pruef(i.sitzungArt === 'normal', `Geteiltes Gerät: Sitzung ${i.sitzungArt}`);
    await abmelden();
    t = await text();
    pruef(await page.locator('#pnr').count() === 1 && await page.inputValue('#pnr') === '' && !t.includes(MA.name) && await page.locator('.pin-user').count() === 0, 'Geteiltes Gerät nach dem Abmelden: Name, Vorbelegung oder PIN-Seite');
    pruef(!listeAbgefragt(), 'Namensliste wurde abgefragt');

    /* ---- 6) Zwei-Faktor (Büro) am eigenen Handy ---- */

    abschnitt = '6';
    await waehle('eigen');
    await pnrEingeben(BU.pnr);
    await pinEingeben('1234');
    await page.waitForSelector('#zf-code');
    await page.fill('#zf-code', code()); await page.click('#zf-ok');
    await angemeldet();
    s.uhr.plus(1);
    gm = await gemerkt();
    pruef(gm && gm.id === BU.id, `Zwei-Faktor: Büro nicht gemerkt (${JSON.stringify(gm)})`);
    await abmelden();
    pruef((await page.locator('.pin-user h2').innerText()) === BU.name, 'Zwei-Faktor: gemerkte Person fehlt');
    await pinEingeben('1234');
    await page.waitForSelector('#zf-code');
    pruef((await page.locator('.pin-user h2').innerText()) === BU.name, 'Zwei-Faktor: Code-Seite ohne Namen');
    await page.fill('#zf-code', '000000'); await page.click('#zf-ok');
    await page.waitForFunction(() => { const x = document.querySelector('#zf-msg'); return x && x.classList.contains('err'); });
    pruef(/Code/i.test(await page.locator('#zf-msg').innerText()), 'Zwei-Faktor: falscher Code ohne Meldung');
    await page.fill('#zf-code', code()); await page.click('#zf-ok');
    await angemeldet();
    s.uhr.plus(1);
    i = await ich();
    pruef(i.benutzer && i.benutzer.id === BU.id, 'Zwei-Faktor: nicht als Büro angemeldet');
    await abmelden();

    /* ---- 6b) Nachprüfung 15.33 (Befund 3): Personalnummer der gemerkten Person im Büro geändert ---- */

    abschnitt = '6b';
    await page.click('[data-andere]'); await page.waitForSelector('#pnr');
    await pnrEingeben(MA.pnr); await pinEingeben('1234'); await angemeldet();
    await abmelden();
    pruef((await page.locator('.pin-user h2').innerText()) === MA.name, 'Personalnummer geändert: gemerkte Person fehlt');
    const neuePnr = 9871;
    db.lauf('UPDATE benutzer SET pnr = ? WHERE id = ?', neuePnr, MA.id);
    await pinEingeben('1234');
    m = await warteMeldung();
    const hilfe2 = await page.locator('#pin-hilfe').innerText().catch(() => '');
    pruef(/falsch/i.test(m) && /Andere Person/.test(hilfe2), `Personalnummer geändert: kein Hinweis auf den Ausweg („${m}“ / „${hilfe2}“)`);
    pruef(!/Personalnummer (ist )?(falsch|unbekannt|geändert)/i.test(m), `Personalnummer geändert: Meldung verrät, dass die Nummer falsch ist („${m}“)`);
    for (const [w, h] of [[g.width, g.height], ...ENGE]) {
      if (w !== g.width || h !== g.height) { await page.setViewportSize({ width: w, height: h }); await sleep(250); }
      await erreichbar(`Gemerkte Person mit Hinweis ${w}×${h}`);
    }
    await page.setViewportSize({ width: g.width, height: g.height }); await sleep(250);
    await bild('gemerkt-hinweis-andere-person');
    await page.click('[data-andere]'); await page.waitForSelector('#pnr');
    await pnrEingeben(neuePnr); await pinEingeben('1234'); await angemeldet();
    gm = await gemerkt();
    pruef(gm && gm.id === MA.id && gm.pnr === neuePnr, `Personalnummer geändert: neue Nummer nach der Anmeldung nicht gemerkt (${JSON.stringify(gm)})`);
    await abmelden();
    pruef((await page.locator('.pin-user h2').innerText()) === MA.name && await page.locator('#pin-hilfe').count() === 0, 'Personalnummer geändert: gemerkte Ansicht danach falsch');

    /* ---- 7) Sperre bei der gemerkten Person ---- */

    abschnitt = '7';
    await page.click('[data-andere]'); await page.waitForSelector('#pnr');
    await pnrEingeben(P2.pnr); await pinEingeben('1234'); await angemeldet();
    await abmelden();
    pruef((await page.locator('.pin-user h2').innerText()) === P2.name, 'Sperre: gemerkte Person fehlt');
    let gesperrt = false;
    for (let n = 0; n < 12 && !gesperrt; n++) {
      const vorher = await page.$('#pin-msg');
      await pinEingeben('9999');
      await page.waitForFunction((el) => !el.isConnected, vorher); // neu gezeichnet (Antwort des Servers da)
      m = await warteMeldung();
      gesperrt = await page.locator('.pin-pad [data-z="1"]').isDisabled();
    }
    pruef(gesperrt && /Zu viele|gesperrt|Sperre/i.test(m), `Sperre: Ziffern nicht gesperrt bzw. Text „${m}“`);
    pruef(await page.locator('.pin-user.gemerkt').count() === 1 && await page.locator('[data-andere]').isEnabled(), 'Sperre: gemerkte Ansicht bzw. „Andere Person“ fehlt');
    await ueberlauf('Sperre');
    pruef(seitenfehler.length === 0, `Konsolenfehler: ${seitenfehler.slice(0, 4).join(' | ')}`);

    /* ---- 8) Benutzerverwaltung: aktive Personen ohne Personalnummer (nur wer Benutzer verwaltet) ---- */
    abschnitt = '8';
    db.lauf('UPDATE benutzer SET pnr = NULL WHERE id IN (5, 7)');
    db.lauf('UPDATE benutzer SET aktiv = 0, pnr = NULL WHERE id = 9');
    const ohne = db.alle('SELECT name FROM benutzer WHERE id IN (5, 7) ORDER BY name').map((x) => x.name);
    const inaktiv = person(9).name;
    {
      const c3 = await browser.newContext({ viewport: { width: g.width, height: g.height }, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: g.mobil, serviceWorkers: 'block' });
      try {
        const p3 = await c3.newPage();
        await p3.goto(`${s.basis}/#/login`); await p3.waitForSelector('#pnr');
        await p3.fill('#pnr', String(person(U.gf).pnr)); await p3.click('#pnr-form button[type="submit"]'); await p3.waitForSelector('.pin-pad');
        for (const z of '1234') await p3.click(`.pin-pad [data-z="${z}"]`);
        await p3.click('.pin-pad [data-ok]'); await p3.waitForSelector('#view');
        await p3.evaluate(() => { location.hash = '#/benutzer?reiter=benutzer'; });
        await p3.waitForSelector('[data-tab="benutzer"]'); await p3.click('[data-tab="benutzer"]');
        await p3.waitForSelector('#ohne-pnr');
        const box = await p3.locator('#ohne-pnr').innerText();
        pruef(/2 aktive Personen ohne Personalnummer – sie können sich nicht anmelden/.test(box), `Warnung: Text „${box.slice(0, 120)}“`);
        pruef(ohne.every((n) => box.includes(n)) && !box.includes(inaktiv), 'Warnung: Namen falsch (inaktive Person aufgeführt oder aktive fehlt)');
        pruef(await p3.locator('#ohne-pnr [data-bearb]').count() === 2, 'Warnung: „Bearbeiten“ fehlt');
        // Speichern ohne Nummer → klare Meldung; mit Nummer → Person verschwindet aus der Warnung
        await p3.click('#ohne-pnr [data-bearb]'); await p3.waitForSelector('dialog[open] #bf');
        await p3.click('dialog[open] button[type="submit"]');
        await p3.waitForFunction(() => { const e = document.querySelector('dialog[open] .form-err'); return e && !e.hidden && e.textContent; });
        pruef(/Personalnummer/.test(await p3.locator('dialog[open] .form-err').innerText()), 'Bearbeiten ohne Personalnummer: Meldung fehlt');
        await p3.fill('dialog[open] input[name="pnr"]', '4711');
        await p3.click('dialog[open] button[type="submit"]');
        await p3.waitForFunction(() => !document.querySelector('dialog[open]'));
        await p3.waitForFunction(() => /1 aktive Person ohne Personalnummer – sie kann sich nicht anmelden/.test((document.querySelector('#ohne-pnr') || {}).innerText || ''));
        const d = await p3.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        pruef(d <= 1, `Benutzerverwaltung: seitlicher Überlauf (${d} px)`);
        if (bilder && g.name === 'pc') await p3.screenshot({ path: path.join(bilder, `benutzerverwaltung-ohne-personalnummer-${g.width}.png`) });
        // Prüfung 20.11.2026: Hilfe passt zur Anmeldeart – ohne Namensliste Personalnummer-Text und beide Personalnummer-Schritte
        await p3.evaluate(() => { location.hash = '#/hilfe'; });
        await p3.waitForSelector('#hilfe-anmelden');
        const ha = await p3.locator('#hilfe-anmelden').innerText();
        pruef(await p3.locator('#hilfe-anmelden[data-namensliste="aus"]').count() === 1 && /mit Personalnummer/.test(ha) && /geteilten Gerät/.test(ha), `Hilfe ohne Namensliste: Anmeldetext „${ha.slice(0, 100)}“`);
        const hb = await p3.locator('[data-thema="benutzer"]').textContent();
        pruef(/Jede aktive Person braucht eine Personalnummer/.test(hb) && /Personalnummer geändert/.test(hb), 'Hilfe ohne Namensliste: Personalnummer-Schritte bei „Benutzer und Rechte“ fehlen');
      } finally { await c3.close(); }
      // Polier: keine Benutzerverwaltung, keine Liste fremder Konten
      const po = await s.login(U.polier);
      pruef((await po.get('/benutzer')).status === 403, 'Polier erreicht die Benutzerverwaltung');
    }

    /* ---- 9) Namensliste ausdrücklich eingeschaltet: wie bisher ---- */
    abschnitt = '9';
    const s2 = await starte({ test: true, loginListe: true });
    try {
      ctx2 = await browser.newContext({ viewport: { width: g.width, height: g.height }, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: g.mobil, serviceWorkers: 'block' });
      const p2 = await ctx2.newPage();
      await p2.goto(`${s2.basis}/#/login`);
      await p2.waitForSelector('#login-card .login-user');
      pruef(await p2.locator('.login-user').count() >= 5 && await p2.locator('#pnr').count() === 0, 'Namensliste eingeschaltet: Liste fehlt');
      await p2.fill('#login-suche', MA.name.split(' ')[1]); await p2.click(`.login-user:has-text("${MA.name}")`);
      await p2.waitForSelector('.pin-pad');
      for (const z of '1234') await p2.click(`.pin-pad [data-z="${z}"]`);
      await p2.click('.pin-pad [data-ok]');
      await p2.waitForSelector('#view');
      pruef((await p2.evaluate(async () => (await (await fetch('/api/auth/ich')).json()).benutzer.id)) === MA.id, 'Namensliste eingeschaltet: Anmeldung über die Liste geht nicht');
      // Prüfung 20.11.2026: Hilfe mit eingeschalteter Namensliste – „Namen antippen“, kein „zeigt die App nie Namen“
      await p2.evaluate(() => { location.hash = '#/hilfe'; });
      await p2.waitForSelector('#hilfe-anmelden');
      const ha2 = await p2.locator('#hilfe-anmelden').innerText();
      pruef(await p2.locator('#hilfe-anmelden[data-namensliste="an"]').count() === 1 && /Namen antippen/.test(ha2) && !/nie Namen|Personalnummer/.test(ha2), `Hilfe mit Namensliste: Anmeldetext „${ha2.slice(0, 120)}“`);
      if (bilder) await p2.screenshot({ path: path.join(bilder, `hilfe-namensliste-an-${g.width}.png`), fullPage: true });
      // GF mit Namensliste: „Benutzer und Rechte“ nennt die Nummer freiwillig, ohne Pflicht-Warnung und ohne Schritt „geändert“
      const ctx3 = await browser.newContext({ viewport: { width: g.width, height: g.height }, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: g.mobil, serviceWorkers: 'block' });
      try {
        const p4 = await ctx3.newPage();
        await p4.goto(`${s2.basis}/#/login`, { waitUntil: 'domcontentloaded' });
        const st = await p4.evaluate(async (bid) => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ benutzerId: bid, pin: '1234' }) })).status, U.gf);
        pruef(st === 200, `Namensliste: GF-Anmeldung ${st}`);
        await p4.evaluate(() => localStorage.setItem('bt_ich', '{}'));
        await p4.goto(`${s2.basis}/?start=${U.gf}#/hilfe`, { waitUntil: 'domcontentloaded' });
        await p4.waitForSelector('#hilfe-anmelden');
        const hb2 = await p4.locator('[data-thema="benutzer"]').textContent();
        pruef(/Personalnummer ist freiwillig/.test(hb2) && !/Jede aktive Person braucht eine Personalnummer – damit/.test(hb2) && !/Personalnummer geändert/.test(hb2), `Hilfe mit Namensliste (GF): „Benutzer und Rechte“ falsch („${hb2.slice(0, 160)}“)`);
      } finally { await ctx3.close(); }
    } finally { await s2.stop(); }
  } catch (e) {
    const zeile = (/anmeldung\.js:(\d+)/.exec(e.stack || '') || [])[1];
    fehler.push(`Anmeldung/${g.name}: Abbruch in Abschnitt ${abschnitt} (Zeile ${zeile}) – ${e.message.split('\n')[0]}`);
    console.log(`    ✗ Anmeldung/${g.name}: Abbruch in Abschnitt ${abschnitt} (Zeile ${zeile}) – ${e.message.split('\n').slice(0, 3).join(' | ')}`);
  } finally {
    if (ctx2) await ctx2.close().catch(() => {});
    if (ctx) await ctx.close().catch(() => {});
    await s.stop();
  }
  return { fehler, schritte };
}

module.exports = { laufe };

if (require.main === module) {
  (async () => {
    const browser = await chromium.launch();
    let alle = [];
    let schritte = 0;
    for (const g of GROESSEN.filter((x) => !process.env.E2E_NUR || process.env.E2E_NUR.split(',').includes(x.name))) {
      console.log(`▶ Anmeldung ${g.name} (${g.width}×${g.height})`);
      const t0 = Date.now();
      if (process.env.E2E_BILDER) fs.mkdirSync(process.env.E2E_BILDER, { recursive: true });
      const r = await laufe(browser, g);
      alle = alle.concat(r.fehler); schritte += r.schritte;
      console.log(`  ${r.fehler.length ? '✗' : '✓'} ${r.schritte} Prüfungen, ${r.fehler.length} Befunde (${Math.round((Date.now() - t0) / 1000)} s)`);
    }
    await browser.close();
    console.log(`\nAnmeldung: ${schritte} Prüfungen, ${alle.length} Befunde`);
    process.exit(alle.length ? 1 : 0);
  })();
}
