'use strict';
// E2E: Restkorrekturen (API.md 15.7) – verbotene Funktionen werden nicht angezeigt (Regel 5). Eigener Server mit der
// Standard-Uhr (Do 12.11.2026). Aufruf über ausbau2.TEILE.restApp (E2E_NUR_A2=restApp).
const PIN = '1234';

async function restApp(h) {
  const { pruef, g } = h;
  const srv = await h.starteServer({ BAUTAG_TEST: '1' });
  const ctx = await h.neuerKontext({ viewport: { width: g.width, height: g.height }, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: g.mobil });
  const P = (t) => `Restkorrekturen (${g.name}): ${t}`;
  try {
    const page = await ctx.newPage(); page.setDefaultTimeout(10000);
    const fehler = []; page.on('pageerror', (e) => fehler.push(e.message));
    const login = async (name) => {
      await page.goto(srv.url + '/#/login'); await page.waitForSelector('.login-user');
      await page.fill('#login-suche', name.split(' ')[1]); await page.click(`.login-user:has-text("${name}")`);
      for (const z of PIN) await page.click(`.pin-pad [data-z="${z}"]`);
      await page.click('.pin-pad [data-ok]'); await page.waitForSelector('#view'); await page.waitForTimeout(300);
    };
    const api = (m, pfad, body) => page.evaluate(async ([m2, p2, b2]) => { const r = await fetch('/api' + p2, { method: m2, headers: { 'Content-Type': 'application/json' }, body: m2 === 'GET' ? undefined : JSON.stringify(b2 || {}) }); let j = null; try { j = await r.json(); } catch (e) { /* leer */ } return { status: r.status, json: j }; }, [m, pfad, body]);
    const geh = async (r) => { await page.evaluate((x) => { location.hash = x; }, '#' + r); await page.waitForFunction((x) => location.hash === '#' + x, r); await page.waitForFunction(() => !document.querySelector('#view .view-box > .state .spinner'), null, { timeout: 10000 }); await page.waitForTimeout(250); };
    const abmelden = async () => { await api('POST', '/auth/logout'); };

    /* ---- Vorbereitung als GF: Ausnahme bericht_freigeben für Polier 22, Urlaub des Büros genehmigt ---- */
    await login('Michael Pichler');
    pruef((await api('PUT', '/rechte/ausnahme', { benutzerId: 22, recht: 'bericht_freigeben', wert: true })).status === 200, P('Ausnahme bericht_freigeben nicht vergeben'));
    await abmelden();
    await login('Martina Koller');
    const eigen = (await api('POST', '/abwesenheiten/zeitraum', { benutzerId: 101, von: '2026-12-14', bis: '2026-12-15', code: 'U' })).json;
    const fremd = (await api('POST', '/abwesenheiten/zeitraum', { benutzerId: 4, von: '2026-12-16', bis: '2026-12-17', code: 'U' })).json;
    pruef(eigen && eigen.antragId && fremd && fremd.antragId, P('Urlaubsanträge nicht angelegt'));
    if (fremd && fremd.status !== 'genehmigt') await api('PUT', `/abwesenheiten/antraege/${fremd.antragId}`, { status: 'genehmigt' });
    // N-034 Vorbedingung: die erste Zeile der Konten hat ein anderes Urlaubsjahr als die Vorgabe
    const konten = (await api('GET', '/urlaub/konto')).json;
    const erste = konten[0];
    pruef((await api('PUT', `/urlaub/konto/${erste.benutzerId}/2026`, { urlaubsjahrBeginn: '12-01' })).status === 200, P('Konto-Beginn nicht gespeichert'));
    await abmelden();
    await login('Michael Pichler');
    pruef((await api('PUT', `/abwesenheiten/antraege/${eigen.antragId}`, { status: 'genehmigt' })).status === 200, P('Urlaub des Büros nicht genehmigt'));
    await abmelden();

    /* ---- N-069/N-070/N-093: Büro sieht am EIGENEN entschiedenen Antrag kein „Korrigieren“ ---- */
    await login('Martina Koller');
    await geh(g.mobil ? '/urlaub' : '/urlaub?monat=2026-12');
    await page.waitForSelector(`[data-antrag="${eigen.antragId}"]`, { state: 'attached' });
    const eigKorr = await page.locator(`[data-antrag="${eigen.antragId}"] [data-antrag-korrigieren], [data-antrag="${eigen.antragId}"] [data-antrag-entscheid]`).count();
    pruef(eigKorr === 0, P(`N-069: eigener genehmigter Antrag zeigt ${eigKorr} Korrigieren/Entscheiden-Knöpfe`));
    if (!g.mobil) {
      const frKorr = await page.locator(`[data-antrag="${fremd.antragId}"] [data-antrag-korrigieren]`).count();
      pruef(frKorr === 1, P(`N-069: fremder genehmigter Antrag ohne „Korrigieren“ (${frKorr})`));
      /* ---- N-034: CSV-Link und Jahresnavigation nach dem laufenden Urlaubsjahr der Vorgabe, nicht der ersten Zeile ---- */
      await geh('/urlaub?ansicht=konten');
      await page.waitForSelector('#ur-csv');
      const href = await page.locator('#ur-csv').getAttribute('href');
      pruef(href === '/api/urlaub/export.csv' && (await page.locator('#ur-csv').getAttribute('data-jahr')) === '2026', P(`N-034: CSV-Link „${href}“ (Jahr ${await page.locator('#ur-csv').getAttribute('data-jahr')})`));
      await page.click('[data-kjahr="-1"]');
      await page.waitForFunction(() => /Urlaubsjahr \d{4}/.test((document.querySelector('#ur-konto-jahr') || {}).textContent || ''));
      const jt = await page.locator('#ur-konto-jahr').innerText();
      pruef(jt === 'Urlaubsjahr 2025', P(`N-034: „Voriges Urlaubsjahr“ führt zu „${jt}“ (erwartet 2025)`));
    }
    // F-049: Büro hat die AN-Unterschrift nicht erfasst → „Freigeben“ sichtbar
    await geh('/bericht/82');
    await page.waitForSelector('#abschluss', { state: 'attached' });
    pruef(await page.locator('#freigeben').count() === 1, P('F-049: Büro sieht „Freigeben“ bei fremder AN-Unterschrift nicht'));
    await abmelden();

    /* ---- F-049: Polier 22 hat die AN-Unterschrift selbst erfasst → kein „Freigeben“, neutraler Hinweis ---- */
    await login('Andreas Stangl');
    await geh('/bericht/82');
    await page.waitForSelector('#abschluss', { state: 'attached' });
    pruef(await page.locator('#freigeben').count() === 0, P('F-049: „Freigeben“ trotz eigener AN-Unterschrift sichtbar'));
    pruef(/zweite Person/.test(await page.locator('#abschluss').innerText()), P('F-049: Hinweis „Freigabe durch eine zweite Person“ fehlt'));
    await abmelden();

    /* ---- F-048: „Neuer Bericht“ bietet dem Polier nur Baustellen seines Bereichs ---- */
    await login('Josef Haidbauer');
    const ich = (await api('GET', '/auth/ich')).json;
    await geh('/berichte');
    await page.click('#neu');
    await page.waitForSelector('dialog[open] select[name="baustelleId"]');
    const werte = await page.locator('dialog[open] select[name="baustelleId"] option').evaluateAll((l) => l.map((o) => Number(o.value)));
    pruef(werte.length >= 1 && werte.every((v) => ich.baustellenIds.includes(v)), P(`F-048: Auswahl ${JSON.stringify(werte)}, eigene ${JSON.stringify(ich.baustellenIds)}`));
    pruef(!JSON.stringify(ich.benutzer).includes('lohngruppe'), P('F-059: Lohngruppe im Anmelde-Objekt des Poliers'));
    await page.click('dialog[open] [data-zu]');
    pruef(fehler.length === 0, P(`Seitenfehler: ${fehler.slice(0, 3).join(' | ')}`));
  } finally { await ctx.close(); srv.stop(); }
}

module.exports = { restApp };
