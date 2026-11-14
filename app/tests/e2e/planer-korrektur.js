'use strict';
// E2E: Korrekturen Nachprüfung – Planer (API.md 14.1). Eigener Server mit fester Uhr Fr 13.11.2026 15:00
// (Wochenende vor dem nächsten Arbeitstag). Aufruf über ausbau2.TEILE.planerKorr (E2E_NUR_A2=planerKorr).
const PIN = '1234';
const FR = '2026-11-13', SA = '2026-11-14', MO = '2026-11-16', DI = '2026-11-17';

async function planerKorrektur(h) {
  const { pruef, g } = h;
  const uhr = '2026-11-13T15:00:00+01:00';
  const srv = await h.starteServer({ BAUTAG_TEST: '1', BAUTAG_UHR: uhr });
  const ctx = await h.neuerKontext({ viewport: { width: g.width, height: g.height }, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: g.mobil });
  const P = (t) => `Planer-Korrektur (${g.name}): ${t}`;
  try {
    await ctx.clock.setSystemTime(new Date(uhr));
    const page = await ctx.newPage(); page.setDefaultTimeout(10000);
    const fehler = []; page.on('pageerror', (e) => fehler.push(e.message));
    const login = async (name) => {
      await page.goto(srv.url + '/#/login'); await page.waitForSelector('.login-user');
      await page.fill('#login-suche', name.split(' ')[1]); await page.click(`.login-user:has-text("${name}")`);
      for (const z of PIN) await page.click(`.pin-pad [data-z="${z}"]`);
      await page.click('.pin-pad [data-ok]'); await page.waitForSelector('#view'); await page.waitForTimeout(300);
    };
    const api = (m, pfad, body) => page.evaluate(async ([m2, p2, b2]) => { const r = await fetch('/api' + p2, { method: m2, headers: { 'Content-Type': 'application/json' }, body: m2 === 'GET' ? undefined : JSON.stringify(b2 || {}) }); let j = null; try { j = await r.json(); } catch (e) { /* leer */ } return { status: r.status, json: j }; }, [m, pfad, body]);
    const geh = async (r) => { await page.evaluate((x) => { location.hash = x; }, '#' + r); await page.waitForFunction((x) => location.hash === '#' + x, r); await page.waitForFunction(() => !document.querySelector('#view .view-box > .state .spinner'), null, { timeout: 10000 }); await page.waitForTimeout(150); };
    const nachsenden = (id) => page.evaluate((x) => import('/js/views/fuhren.js').then((m) => m.fuhrenNachsenden(x)), id);
    const warteschlange = () => page.evaluate(() => JSON.parse(localStorage.getItem('bt_fuhren_warten') || '[]'));

    /* ---- Büro: Einteilung Mo (mit Notiz), Samstagsschicht, Fuhren ---- */
    await login('Martina Koller');
    const leute = (await api('GET', '/mitarbeiter')).json;
    const id = (name) => leute.find((m) => m.name === name).id;
    const JOSEF = id('Josef Haidbauer'), LUKAS = id('Lukas Brandstätter'), DANIEL = id('Daniel Schwarz');
    const pitten = (await api('GET', '/baustellen')).json.find((b) => b.kst === '26-041');
    for (const a of (await api('GET', `/abwesenheiten?von=${FR}&bis=${DI}`)).json.filter((x) => [JOSEF, LUKAS, DANIEL].includes(x.benutzerId))) await api('DELETE', `/abwesenheiten/${a.id}`);
    pruef((await api('POST', '/plan/einsaetze', { datum: MO, baustelleId: pitten.id, beginn: '06:30', notiz: 'Schlüssel beim Bauherrn', benutzerIds: [LUKAS, JOSEF] })).status === 201, P('Mo-Einsatz nicht anlegbar'));
    pruef((await api('POST', '/plan/einsaetze', { datum: SA, baustelleId: pitten.id, beginn: '06:00', benutzerIds: [DANIEL] })).status === 201, P('Samstagsschicht nicht anlegbar'));
    pruef((await api('POST', '/plan/veroeffentlichen', { von: SA, bis: MO })).status === 200, P('Sa–Mo veröffentlichen nicht möglich'));
    const mat = (await api('GET', '/materialien')).json;
    const lkw = (await api('GET', '/fuhrpark/anlagen')).json;
    const lkwListe = (Array.isArray(lkw) ? lkw : lkw.anlagen || []);
    const lkwA01 = lkwListe.find((a) => a.nummer === 'A01');
    const fuhre = async (menge) => (await api('POST', '/plan/fuhren', { datum: FR, anlageId: lkwA01.id, fahrerId: LUKAS, materialId: mat[3].id, menge, einheit: 't', nach: { art: 'baustelle', baustelleId: pitten.id } })).json;
    const fOk = await fuhre(10), fWeg = await fuhre(12), fAnz = await fuhre(14);
    pruef((await api('POST', '/plan/veroeffentlichen', { von: FR })).status === 200, P('Fr veröffentlichen nicht möglich'));
    pruef((await api('DELETE', `/plan/fuhren/${fWeg.id}`)).status === 200, P('Fuhre nicht stornierbar'));

    // N-049: Woche mit veröffentlichtem Mo und Vorschau-Tagen Di–Fr → „Plan veröffentlichen“ oben ist aktiv
    await geh(`/plan?ansicht=woche&datum=${MO}`);
    await page.waitForSelector('.wp-gitter');
    pruef(!(await page.locator('#wp-pub').isDisabled()) && Number(await page.locator('#wp-pub').getAttribute('data-anzahl')) >= 4, P(`N-049: „Plan veröffentlichen“ oben gesperrt, obwohl Di–Fr nur Vorschau sind (${await page.locator('#wp-pub').getAttribute('data-anzahl')})`));
    // N-098: Notizen-Knopf nennt den Quelltag (Mo 16.11.), nicht „gestern“
    const knopf = page.locator(`.wp-gitter [data-zelle][data-datum="${DI}"][data-bs="${pitten.id}"] [data-vortag-notizen]`);
    pruef(await knopf.count() === 1 && /Notizen von Mo 16\.11\. übernehmen/.test(await knopf.innerText()), P(`N-098: Knopf „${await knopf.count() ? await knopf.innerText() : '–'}“`));
    // N-094: Rückmeldung nennt Personen und Nachrichten getrennt (Polier: Einsatz + Partie-Meldung)
    // (ist der Knopf oben gesperrt – Fehler oben –, über die Tagesansicht Di veröffentlichen, damit die übrigen Prüfungen laufen)
    if (await page.locator('#wp-pub').isDisabled()) { await geh(`/plan?ansicht=tag&datum=${DI}`); await page.waitForSelector(`#tg-tag[data-datum="${DI}"]`); await page.click('#tg-pub'); } else await page.click('#wp-pub');
    await page.waitForSelector('dialog[open] #pub-vorschau');
    const nDialog = Number(await page.locator('#pub-vorschau').getAttribute('data-anzahl'));
    await page.click('#pub-ok');
    const t = page.locator('.toast:has-text("Veröffentlicht")').last();
    await t.waitFor();
    const tt = await t.innerText();
    pruef(new RegExp(`${nDialog} Personen benachrichtigt \\(\\d+ Nachrichten\\)`).test(tt), P(`N-094: Dialog ${nDialog} Personen, Rückmeldung „${tt}“`));

    // N-048/N-102: Fuhren-Formular – nur LKW (gesperrte gekennzeichnet), Material frisch geladen
    await geh(`/plan?ansicht=tag&datum=${FR}`);
    await page.waitForSelector(`#tg-tag[data-datum="${FR}"]`);
    const fuhreFormular = async () => { await page.locator('#tg-fuhren [data-fuhre-neu]').first().click(); await page.waitForSelector('dialog[open] #fuf'); };
    await fuhreFormular();
    const optionen = await page.locator('#fuf [name="anlageId"] option').allInnerTexts();
    pruef(optionen.length > 2 && !optionen.some((o) => /PKW|Mannschaftsbus|Pritschenbus|Radlader|Kippsattel|Anhänger|Mobilbagger/.test(o)), P(`N-102: LKW-Auswahl enthält andere Fahrzeuge: ${optionen.join(' | ')}`));
    const a03 = lkwListe.find((a) => a.nummer === 'A03');
    pruef(!a03 || !(a03.gesperrt || a03.status === 'gesperrt') || optionen.some((o) => /A03|Scania/.test(o) && /gesperrt/.test(o)), P('N-102: gesperrter LKW ohne Hinweis'));
    pruef(await page.locator(`#fu-mat option[value="${mat[1].name}"]`).count() === 1, P('Material fehlt im Formular'));
    await page.click('dialog[open] [data-zu]');
    const m1 = (await api('GET', '/stammdaten/materialien')).json;
    const z = (Array.isArray(m1) ? m1 : m1.eintraege || m1.liste || []).find((x) => x.id === mat[1].id);
    const deakt = await api('PUT', `/stammdaten/materialien/${mat[1].id}`, { version: z ? z.version : 1, aktiv: false });
    pruef(deakt.status === 200, P(`Material nicht deaktivierbar (${deakt.status})`));
    await fuhreFormular();
    pruef(await page.locator(`#fu-mat option[value="${mat[1].name}"]`).count() === 0, P('N-048: deaktiviertes Material wird weiter angeboten'));
    await page.click('dialog[open] [data-zu]');
    await api('POST', '/auth/logout');

    /* ---- Polier: „Meine Partie“ zeigt am Freitag zuerst den Samstag (N-058) ---- */
    await login('Josef Haidbauer');
    await geh('/partie');
    const reiter = await page.locator('[data-partie-tag]').evaluateAll((l) => l.map((x) => [x.dataset.partieTag, x.getAttribute('aria-selected')]));
    pruef(JSON.stringify(reiter) === JSON.stringify([[FR, 'false'], [SA, 'true'], [MO, 'false']]), P(`N-058: Reiter der Partie ${JSON.stringify(reiter)}`));
    pruef(await page.locator('[data-partie-einsatz]').count() === 1, P('N-058: Samstagseinsatz nicht sichtbar'));
    await api('POST', '/auth/logout');

    /* ---- Mitarbeiter: Wochenliste, Warteschlange bei abgelaufener Sitzung und abgelehnte Meldungen ---- */
    await login('Lukas Brandstätter');
    await geh('/einsatz');
    const zeile = (d) => page.locator(`#einsatz-woche li[data-tag="${d}"]`);
    pruef(/frei \(Wochenende\)/.test(await zeile(SA).innerText()) && !/noch nicht eingeteilt/.test(await zeile('2026-11-15').innerText()), P(`N-097: Wochenende als „noch nicht eingeteilt“ (${await zeile(SA).innerText()})`));
    // N-039: „Losgefahren“ und „Abgeladen“ ohne Netz → die Karte zeigt den letzten Stand
    await ctx.setOffline(true);
    await page.evaluate(([idF, idB]) => localStorage.setItem('bt_fuhren_warten', JSON.stringify([
      { nr: 'k-a', benutzerId: idB, fuhreId: idF, body: { status: 'unterwegs' }, foto: null, zeit: new Date().toISOString() },
      { nr: 'k-b', benutzerId: idB, fuhreId: idF, body: { status: 'erledigt', menge: 14, einheit: 't' }, foto: null, zeit: new Date().toISOString() }])), [fAnz.id, LUKAS]);
    await geh('/stempeln'); await geh('/einsatz');
    pruef(await page.locator(`#meine-fuhren li[data-fuhre="${fAnz.id}"][data-status="erledigt"]`).count() === 1 && await page.locator(`#meine-fuhren li[data-fuhre="${fAnz.id}"] [data-fuhr-ab]`).count() === 0, P('N-039: Karte zeigt nicht die zuletzt gemerkte Meldung (Abgeladen)'));
    await page.evaluate(() => localStorage.removeItem('bt_fuhren_warten'));
    await ctx.setOffline(false);
    // N-017: Sitzung abgelaufen (401) → Meldung bleibt gemerkt, nach der Anmeldung wird sie gesendet
    await page.evaluate(([idF, idB]) => localStorage.setItem('bt_fuhren_warten', JSON.stringify([{ nr: 'k-401', benutzerId: idB, fuhreId: idF, body: { status: 'unterwegs' }, foto: null, zeit: new Date().toISOString() }])), [fOk.id, LUKAS]);
    await ctx.clearCookies();
    await h.absichtlich(() => nachsenden(LUKAS)); // 401 ist hier gewollt
    pruef((await warteschlange()).some((w) => w.nr === 'k-401'), P('N-017: Meldung bei abgelaufener Sitzung verworfen'));
    await login('Lukas Brandstätter');
    await page.evaluate(([idF, idB]) => { if (!localStorage.getItem('bt_fuhren_warten')) localStorage.setItem('bt_fuhren_warten', JSON.stringify([{ nr: 'k-401', benutzerId: idB, fuhreId: idF, body: { status: 'unterwegs' }, foto: null, zeit: new Date().toISOString() }])); }, [fOk.id, LUKAS]);
    await nachsenden(LUKAS);
    const ich = (await api('GET', `/plan/ich?von=${FR}&bis=${FR}`)).json;
    pruef((await warteschlange()).length === 0 && ich.tage[0].fuhren.some((f) => f.id === fOk.id && f.status === 'unterwegs'), P('N-017: Meldung nach der Anmeldung nicht nachgesendet'));
    // abgelehnte Meldung (Fuhre storniert) bleibt mit Menge sichtbar, bis der Fahrer sie bestätigt
    await page.evaluate(([idF, idB]) => localStorage.setItem('bt_fuhren_warten', JSON.stringify([{ nr: 'k-409', benutzerId: idB, fuhreId: idF, body: { status: 'erledigt', menge: 12.5, einheit: 't' }, foto: null, zeit: new Date().toISOString() }])), [fWeg.id, LUKAS]);
    await h.absichtlich(() => nachsenden(LUKAS)); // 409 ist hier gewollt
    await geh('/stempeln'); await geh('/einsatz');
    const ab = page.locator('#fuhren-abgelehnt [data-fuhr-abgelehnt="k-409"]');
    pruef(await ab.count() === 1 && /12,5/.test(await ab.innerText()) && /storniert/i.test(await ab.innerText()), P('N-017: abgelehnte Meldung nicht sichtbar'));
    if (await ab.count()) { await ab.locator('[data-fuhr-abgelehnt-ok]').click(); await page.waitForFunction(() => !document.querySelector('[data-fuhr-abgelehnt="k-409"]')); }
    pruef((await page.evaluate(() => JSON.parse(localStorage.getItem('bt_fuhren_abgelehnt') || '[]'))).length === 0, P('N-017: bestätigte Meldung bleibt gespeichert'));
    const roh = (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
    pruef(roh <= 1 && !(await page.evaluate(() => document.body.innerText)).includes('€'), P('Überlauf oder € in „Mein Einsatz“'));
    await api('POST', '/auth/logout');
    // Mitarbeiter ohne Einsatz: Leertext nennt den nächsten Arbeitstag (N-097)
    await login('Roland Kerschbaumer');
    await geh('/einsatz');
    pruef(/nächsten Arbeitstag \(Mo 16\.11\.\)/.test(await page.locator('#einsatz-leer').innerText()), P(`N-097: Leertext „${await page.locator('#einsatz-leer').innerText()}“`));
    pruef(fehler.length === 0, P(`Seitenfehler: ${fehler.slice(0, 3).join(' | ')}`));
  } finally { await ctx.close(); srv.stop(); }
}

module.exports = { planerKorrektur };
