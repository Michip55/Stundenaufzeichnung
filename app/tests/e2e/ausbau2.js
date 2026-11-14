'use strict';
// Ausbaustufe 2 – Prüfungen der neuen Bereiche (API.md 12): Stammdaten & Preise, Bauvorhaben-Lebenslauf/Archiv,
// Dokumente, Rechnungen/Offene Posten, Baustellenplaner (Woche, Morgen, Notizen, Fortschreiben, Fuhren), Urlaub.
// Läuft am Ende von run.js je Bildschirmgröße; externe Dienste sind Attrappen des Servers (BAUTAG_TEST=1, 12.18).
const KENN = (g) => ({ handy: 'H', tablet: 'T', pc: 'P' }[g.name] || 'X');

// Ziehen mit der Maus (Zeigerereignisse) – wie ein Mensch: drücken, ein Stück bewegen, zum Ziel, loslassen
async function zieh(page, von, nach, { oben = 40 } = {}) {
  await nach.scrollIntoViewIfNeeded();
  await von.scrollIntoViewIfNeeded();
  const a = await von.boundingBox();
  await page.mouse.move(a.x + Math.min(a.width / 2, 30), a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + Math.min(a.width / 2, 30) + 12, a.y + a.height / 2 + 12, { steps: 4 });
  const b = await nach.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, oben), { steps: 10 });
  await page.waitForTimeout(80);
  await page.mouse.up();
}
const naechsterArbeitstag = (iso, n = 1) => { const d = new Date(iso + 'T12:00:00Z'); let rest = n; while (rest > 0) { d.setUTCDate(d.getUTCDate() + 1); if (![0, 6].includes(d.getUTCDay())) rest -= 1; } return d.toISOString().slice(0, 10); };
const plusTage = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** Abwesenheiten aufräumen: offene Anträge nur als Ganzes (Inhaber 13.11.2026, API.md 14.3), entschiedene Tage einzeln */
async function abwWeg(api, liste) {
  const weg = new Set();
  for (const a of liste) {
    if (a.status !== 'beantragt') { await api('DELETE', `/abwesenheiten/${a.id}`); continue; }
    if (!weg.has(a.antragId)) { weg.add(a.antragId); await api('DELETE', `/abwesenheiten/antraege/${encodeURIComponent(a.antragId)}`); }
  }
}

/* ================= Stammdaten & Preise (12.21) + Lebenslauf (12.15) ================= */
async function stammdatenUndLebenslauf(h, z) {
  const { page, api, geh, pruef, keinEuro, ueberlauf, dialogUeberlauf, shot, g, anmelden, abmelden, toastWeg } = h;
  const k = KENN(g), heute = h.heute();
  const matName = `E2E Splitt ${k}`;
  const kstY = `99-9${{ H: 1, T: 2, P: 3 }[k] || 9}1`;

  /* ---- Büro: Material anlegen, Bauvorhaben Y anlegen ---- */
  await anmelden('buero');
  let nav = await h.navIds();
  pruef(nav.includes('plan') && nav.includes('offeneposten') && nav.includes('urlaub'), `A2: Büro-Navigation ohne Planer/Offene Posten/Urlaub (${nav})`);
  await geh('/preise');
  pruef(await page.locator('[data-tab]').count() === 5 && await page.locator('#stamm-links a').count() >= 2, 'A2-Stamm: Reiter (Katalog, Geräte, Material, Lohngruppen, Leistungen) oder Verweise fehlen');
  await page.click('[data-tab="materialien"]');
  await page.waitForSelector('#stamm-neu');
  await ueberlauf('stammdaten material'); await shot('stammdaten-material');
  await page.click('#stamm-neu');
  await page.waitForSelector('dialog[open] #stf');
  await page.fill('#stf [name="code"]', `e2e-${k.toLowerCase()}`);
  await page.fill('#stf [name="name"]', matName);
  await page.fill('#stf [name="einheit"]', 't');
  await page.fill('#stf [name="p_ek"]', '10,00');
  await page.fill('#stf [name="p_vk"]', '15,50');
  await dialogUeberlauf('stammdaten neu');
  await page.click('#st-ok');
  await page.waitForSelector(`#stamm-tabelle tr:has-text("${matName}")`);
  const mat = (await api('GET', '/materialien')).json.find((m) => m.name === matName);
  pruef(!!mat, 'A2-Stamm: neues Material fehlt in /materialien');
  z.mat = mat;
  // Code doppelt → Feldfehler, nichts gespeichert
  await page.click('#stamm-neu');
  await page.waitForSelector('dialog[open] #stf');
  await page.fill('#stf [name="code"]', `e2e-${k.toLowerCase()}`); await page.fill('#stf [name="name"]', 'Doppelt'); await page.fill('#stf [name="einheit"]', 't');
  await h.absichtlich(async () => { await page.click('#st-ok'); await page.waitForSelector('#stf [data-fehler="code"]:not([hidden])'); });
  pruef(/gibt es schon/.test(await page.locator('#stf [data-fehler="code"]').innerText()), 'A2-Stamm: doppelter Code ohne Feldfehler');
  await page.click('dialog[open] [data-zu]');
  // Preis mit „gültig ab“ in der Zukunft → als geplant markiert
  const vk = page.locator(`#stamm-tabelle tr[data-id="${mat.id}"] input[data-feld="vk"]`);
  await vk.fill('17,00'); await vk.press('Enter');
  await page.waitForSelector('dialog[open] #pa-form');
  await page.fill('#pa-ab', plusTage(heute, 30));
  await page.click('#pa-ok');
  await page.waitForSelector(`#stamm-tabelle tr[data-id="${mat.id}"] [data-geplant]`);
  pruef(Math.abs((await api('GET', '/preise')).json.materialien.find((m) => m.id === mat.id).vk - 15.5) < 0.001, 'A2-Stamm: geplanter Preis gilt schon heute');
  await toastWeg();

  // 12.22 Lohngruppe stichtaggenau: Wechsel mit „gültig ab“ (künftig) erscheint im Verlauf und lässt sich zurücknehmen
  const lgPerson = (await api('GET', '/mitarbeiter')).json.filter((m) => m.rolle === 'mitarbeiter' && m.aktiv !== false).pop();
  // N-078 (unten): Person ohne Lohngruppe schon vor dem Laden der Benutzerliste anlegen
  const ohne = await api('POST', '/benutzer', { name: `E2E Ohne Lohngruppe ${k}`, rolle: 'mitarbeiter', pin: '4826' });
  pruef(ohne.status === 201 || ohne.status === 200, `A2-Lohn: Person ohne Lohngruppe anlegen → ${ohne.status} ${JSON.stringify(ohne.json).slice(0, 200)}`);
  await geh('/benutzer');
  await page.locator(`[data-bearb="${lgPerson.id}"]`).first().click();
  await page.waitForSelector('dialog[open] #bf');
  await page.waitForSelector('#lg-verlauf li');
  pruef(await page.locator('#lg-ab-box').isHidden(), 'A2-Lohn: „gültig ab“ erscheint, obwohl die Lohngruppe nicht geändert wurde');
  const lgAlt = await page.locator('#bf [name="lohngruppe"]').inputValue();
  const lgNeu = (await page.locator('#bf [name="lohngruppe"] option').evaluateAll((o) => o.map((x) => x.value))).find((v) => v && v !== lgAlt);
  await page.selectOption('#bf [name="lohngruppe"]', lgNeu);
  pruef(await page.locator('#lg-ab').inputValue() === heute, 'A2-Lohn: „gültig ab“ nicht mit heute vorbelegt');
  await page.fill('#lg-ab', plusTage(heute, -10));
  pruef(await page.locator('#lg-rueck').isVisible(), 'A2-Lohn: Warnung bei Datum in der Vergangenheit fehlt');
  await page.fill('#lg-ab', plusTage(heute, 20));
  await dialogUeberlauf('benutzer lohngruppe'); await shot('lohngruppe-gueltig-ab');
  await page.click('dialog[open] button[type="submit"]');
  await page.waitForFunction(() => !document.querySelector('dialog[open] #bf'));
  await toastWeg();
  const verl = (await api('GET', `/benutzer/${lgPerson.id}/lohngruppen-verlauf`)).json;
  pruef(verl.some((v) => v.kuenftig && v.gueltigAb === plusTage(heute, 20) && v.lohngruppeId === lgNeu) && verl.some((v) => v.aktuell && v.lohngruppeId === (lgAlt || null)), `A2-Lohn: Verlauf nach dem Wechsel falsch (${JSON.stringify(verl).slice(0, 200)})`);
  await page.locator(`[data-bearb="${lgPerson.id}"]`).first().click();
  await page.waitForSelector('#lg-verlauf [data-lg-weg]');
  pruef(await page.locator('#lg-verlauf [data-lg-weg]').count() === 1 && await page.locator('#bf [name="lohngruppe"]').inputValue() === lgAlt, 'A2-Lohn: nur der künftige Eintrag darf löschbar sein; heute gilt noch die alte Lohngruppe');
  await page.click('#lg-verlauf [data-lg-weg]');
  await page.waitForSelector('dialog[open] [data-ok]'); await page.locator('dialog[open] [data-ok]').last().click();
  await page.waitForFunction(() => !document.querySelector('#lg-verlauf [data-lg-weg]'));
  await toastWeg();
  await page.locator('dialog[open] [data-zu]').first().click();
  // N-078: erste Lohngruppe über die Oberfläche → Datum leer, gilt von Anfang an (Basisstand 2000-01-01)
  {
    await page.locator(`[data-bearb="${ohne.json.id}"]`).first().click();
    await page.waitForSelector('dialog[open] #bf');
    const lgErst = (await page.locator('#bf [name="lohngruppe"] option').evaluateAll((o) => o.map((x) => x.value))).find((v) => v);
    await page.selectOption('#bf [name="lohngruppe"]', lgErst);
    pruef(await page.locator('#lg-ab').inputValue() === '', 'A2-Lohn: erste Lohngruppe – „gültig ab“ ist vorbelegt (soll leer = von Anfang an)');
    pruef(await page.locator('#lg-anfang').isVisible(), 'A2-Lohn: Hinweis „leer = von Anfang an“ fehlt');
    await page.click('dialog[open] button[type="submit"]');
    await page.waitForFunction(() => !document.querySelector('dialog[open] #bf'));
    await toastWeg();
    const v0 = (await api('GET', `/benutzer/${ohne.json.id}/lohngruppen-verlauf`)).json;
    pruef(Array.isArray(v0) && v0.length === 1 && v0[0].gueltigAb === '2000-01-01' && v0[0].lohngruppeId === lgErst, `A2-Lohn: erste Lohngruppe gilt nicht von Anfang an (${JSON.stringify(v0).slice(0, 200)})`);
    await api('PUT', `/benutzer/${ohne.json.id}`, { aktiv: false });
  }
  // Bauvorhaben Y für den Lebenslauf (Bauleiter zugeteilt)
  const leute = (await api('GET', '/mitarbeiter')).json;
  const bl = leute.find((m) => m.name === 'Stefan Aigner');
  const neuY = await api('POST', '/baustellen', { kst: kstY, name: `E2E Lebenslauf ${k}`, auftraggeber: `E2E Auftraggeber ${k}`, adresse: '2620 Neunkirchen, Testweg 1', status: 'aktiv', bauleiterId: bl ? bl.id : null });
  pruef(neuY.status === 201 || neuY.status === 200, `A2-Leben: Baustelle anlegen → ${neuY.status} ${JSON.stringify(neuY.json).slice(0, 200)}`);
  z.y = neuY.json;
  await abmelden();

  /* ---- Polier: Material im Bericht, Fertigmeldung, keine € ---- */
  const ichP = await anmelden('polier');
  nav = await h.navIds();
  pruef(nav.includes('partie') && nav.includes('baustellen') && !nav.includes('plan') && !nav.includes('offeneposten') && !nav.includes('preise'), `A2: Polier-Navigation falsch (${nav})`);
  const w = ichP.baustellenIds[0]; z.w = w;
  let ber = null;
  for (let i = 40; i < 60 && !ber; i += 1) { const r = await api('POST', '/berichte', { baustelleId: w, datum: plusTage(heute, -i) }); if (r.status === 201) ber = r.json; }
  pruef(!!ber, 'A2-Stamm: kein neuer Berichtsentwurf möglich');
  if (ber) {
    await geh(`/bericht/${ber.id}`);
    pruef(await page.locator(`.mat-row[data-m="${mat.id}"]`).count() === 1, 'A2-Stamm: neues Material fehlt in der Materialliste des Berichts');
    const frisch = (await api('GET', `/berichte/${ber.id}`)).json;
    const r = await api('PUT', `/berichte/${ber.id}`, { version: frisch.version, material: [{ materialId: mat.id, menge: 3 }] });
    pruef(r.status === 200, `A2-Stamm: Material im Bericht speichern → ${r.status}`);
    z.berMat = ber.id;
  }
  for (const r of ['/plan', '/offene-posten', '/preise', '/lohn-vorlagen']) await h.keinZugriff(r);
  await geh('/baustellen'); await keinEuro('polier baustellen');
  await geh(`/baustelle/${w}`); await keinEuro('polier baustelle');
  pruef(await page.locator('#lebenslauf').count() === 1 && await page.locator('#phase-weiter').count() === 0, 'A2-Leben: Polier sieht den Status nicht oder darf ihn ändern');
  pruef(await page.locator('[data-reiter="rechnungen"]').count() === 0 && await page.locator('#auftrag').count() === 0, 'A2-Leben: Polier sieht Rechnungen oder Auftragssumme');
  await page.click('#fertig-melden');
  await page.waitForSelector('dialog[open] #fmf');
  await page.fill('#fmf [name="notiz"]', 'Restarbeiten: Bankett');
  await page.click('dialog[open] button[type="submit"]');
  await page.waitForSelector('#fertigmeldung');
  await ueberlauf('polier fertigmeldung'); await shot('lebenslauf-polier');
  await abmelden();

  /* ---- Bauleiter: Ziele wie das Büro (Inhaber 13.11.2026), Fertiggestellt → Abgenommen ---- */
  await anmelden('bauleiter');
  await geh(`/baustelle/${z.y.id}`);
  await page.click('#phase-andere');
  await page.waitForSelector('dialog[open] #phf');
  const ziele = await page.locator('#ph-ziel option').evaluateAll((o) => o.map((x) => x.value));
  pruef(ziele.includes('fertiggestellt') && ziele.includes('pausiert') && ziele.includes('storniert'), `A2-Leben: Bauleiter-Ziele falsch – erwartet wie beim Büro (${ziele})`);
  await page.selectOption('#ph-ziel', 'fertiggestellt');
  await page.click('#ph-ok');
  await page.waitForSelector('#lebenslauf[data-phase="fertiggestellt"]');
  await toastWeg();
  await page.click('#phase-weiter');
  await page.waitForSelector('dialog[open] #phf');
  pruef(await page.locator('#ph-ziel').inputValue() === 'abgenommen' && await page.locator('#phf [name="abnahmeDatum"]').isVisible(), 'A2-Leben: „Nächster Schritt“ schlägt nicht Abgenommen mit Abnahmedatum vor');
  pruef(await page.locator('#phf [name="gewaehrleistungBis"]').inputValue() === `${Number(heute.slice(0, 4)) + 3}${heute.slice(4)}`, 'A2-Leben: Gewährleistung nicht mit Abnahme + 3 Jahren vorbelegt');
  await dialogUeberlauf('phase abgenommen'); await shot('lebenslauf-dialog');
  await page.click('#ph-ok');
  await page.waitForSelector('#lebenslauf[data-phase="abgenommen"]');
  pruef(await page.locator('#abschluss [data-wert="gewaehrleistung"]').count() === 1 && await page.locator('#phase-weiter').count() === 1, 'A2-Leben: Gewährleistungs-Karte fehlt oder Bauleiter kann nicht (wie das Büro) zur Schlussrechnung weitergehen');
  await ueberlauf('bauleiter lebenslauf');
  await abmelden();

  /* ---- Büro: bestätigen, Tafel (Ziehen bzw. Knopf), Archiv, Material deaktivieren ---- */
  await anmelden('buero');
  await geh(`/baustelle/${w}`);
  await page.click('#fertigmeldung [data-phase-ziel="fertiggestellt"]');
  await page.waitForSelector('dialog[open] #phf');
  await page.click('#ph-ok');
  await page.waitForSelector('#lebenslauf[data-phase="fertiggestellt"]');
  pruef(await page.locator('#phasen-verlauf li').count() >= 1, 'A2-Leben: Verlauf der Phasen fehlt');
  // zurück auf „In Arbeit“, damit die Baustelle für die weiteren Prüfungen läuft
  const wb = (await api('GET', `/baustellen/${w}`)).json;
  pruef((await api('POST', `/baustellen/${w}/phase`, { phase: 'in_arbeit', version: wb.version })).status === 200, 'A2-Leben: Fertiggestellt → In Arbeit nicht möglich');
  await toastWeg();
  await geh('/baustellen');
  pruef(await page.locator('#bs-filter [data-filter]').count() >= 3 && await page.locator('#zum-archiv').count() === 1, 'A2-Leben: Filter-Chips oder Archiv-Verweis fehlen');
  await page.click('[data-ansicht="tafel"]');
  await page.waitForSelector('#bv-tafel');
  pruef(await page.locator('.ll-spalte').count() === 7, 'A2-Leben: Tafel ohne Spalten je Status');
  await ueberlauf('baustellen tafel'); await shot('baustellen-tafel');
  const karte = page.locator(`.ll-karte[data-bv="${z.y.id}"]`);
  pruef(await page.locator(`.ll-spalte[data-spalte="abgenommen"] .ll-karte[data-bv="${z.y.id}"]`).count() === 1, 'A2-Leben: Karte steht nicht in der Spalte Abgenommen');
  if (g.mobil) await karte.locator('[data-bv-weiter]').click(); // Handy: Knopf statt Ziehen
  else {
    // nicht erlaubtes Ziel (Bezahlt) nimmt die Karte nicht an …
    await zieh(page, karte, page.locator('.ll-spalte[data-spalte="bezahlt"]'));
    await page.waitForTimeout(250);
    pruef(await page.locator('dialog[open]').count() === 0, 'A2-Leben: Ziehen auf einen nicht erlaubten Status öffnet den Dialog');
    await zieh(page, karte, page.locator('.ll-spalte[data-spalte="schlussrechnung"]'));
  }
  await page.waitForSelector('dialog[open] #phf');
  pruef(await page.locator('#ph-ziel').inputValue() === 'schlussrechnung', 'A2-Leben: Ablegen/Knopf wählt nicht „Schlussrechnung“');
  await page.fill('#phf [name="srNr"]', `SR-${k}-1`);
  await page.fill('#phf [name="srBetrag"]', '12.500,00');
  await page.click('#ph-ok');
  await page.waitForSelector(`.ll-spalte[data-spalte="schlussrechnung"] .ll-karte[data-bv="${z.y.id}"]`);
  await toastWeg();
  // Übersicht: Kacheln
  await geh('/dashboard');
  pruef(await page.locator('#bv-kacheln [data-kpi="schlussrechnungen"]').count() === 1 && Number(await page.locator('#bv-kacheln [data-kpi="schlussrechnungen"] b').innerText()) >= 1, 'A2-Leben: Kachel „Offene Schlussrechnungen“ fehlt oder zählt nicht');
  pruef(await page.locator('#bv-kacheln [data-kpi="abnahme-ohne-rechnung"]').count() === 1 && await page.locator('#bv-kacheln [data-kpi="gewaehrleistung"]').count() === 1, 'A2-Leben: Kacheln Abnahme/Gewährleistung fehlen');
  await ueberlauf('dashboard kacheln'); await shot('dashboard-bauvorhaben');
  // bezahlt → archiviert (über die Schnittstelle), dann Archiv-Ansicht
  for (const phase of ['bezahlt', 'archiviert']) { const yb = (await api('GET', `/baustellen/${z.y.id}`)).json; const r = await api('POST', `/baustellen/${z.y.id}/phase`, { phase, version: yb.version }); pruef(r.status === 200, `A2-Leben: Phase ${phase} → ${r.status}`); }
  pruef(!(await api('GET', '/baustellen')).json.some((b) => b.id === z.y.id), 'A2-Leben: archivierte Baustelle steht noch in der Auswahl (GET /baustellen)');
  await geh('/baustellen');
  pruef(await page.locator(`[data-bv="${z.y.id}"], [data-bs="${z.y.id}"]`).count() === 0, 'A2-Leben: archivierte Baustelle in der laufenden Liste');
  await geh('/baustellen/archiv');
  await page.waitForSelector(`#archiv-tabelle tr[data-bv="${z.y.id}"]`);
  await page.fill('#ar-suche', 'gibt-es-nicht-xyz');
  await page.waitForSelector('#archiv-liste .state');
  await page.fill('#ar-suche', kstY);
  await page.waitForSelector(`#archiv-tabelle tr[data-bv="${z.y.id}"]`);
  await ueberlauf('archiv'); await shot('archiv');
  await geh(`/baustelle/${z.y.id}`);
  pruef(await page.locator('#lebenslauf[data-phase="archiviert"]').count() === 1 && await page.locator('#archiv-auf').count() === 0, 'A2-Leben: Archiv-Detail falsch oder Büro darf das Archiv aufheben (nur GF)');

  // Material: verwendet → Löschen bietet Deaktivieren an
  await geh('/preise'); await page.click('[data-tab="materialien"]');
  await page.waitForSelector(`#stamm-tabelle tr[data-id="${mat.id}"]`);
  await page.click(`#stamm-tabelle tr[data-id="${mat.id}"] [data-weg]`);
  await page.waitForSelector('dialog[open] #st-weg-ok');
  await h.absichtlich(async () => { await page.click('#st-weg-ok'); await page.waitForSelector('#st-verwendet .banner'); });
  pruef(/1 Bericht\b/.test(await page.locator('#st-verwendet').innerText()), `A2-Stamm: Hinweis „Wird in 1 Bericht verwendet“ fehlt (${(await page.locator('#st-verwendet').innerText()).slice(0, 80)})`);
  await dialogUeberlauf('stammdaten löschen'); await shot('stammdaten-verwendet');
  await page.click('#st-deaktiv');
  await page.waitForSelector(`#stamm-tabelle tr[data-id="${mat.id}"][data-aktiv="false"]`);
  pruef(!(await api('GET', '/materialien')).json.some((m) => m.id === mat.id), 'A2-Stamm: deaktiviertes Material steht noch in der Auswahl');
  await page.uncheck('#stamm-inaktiv');
  pruef(await page.locator(`#stamm-tabelle tr[data-id="${mat.id}"]`).count() === 0, 'A2-Stamm: Filter „Inaktive anzeigen“ wirkt nicht');
  await page.check('#stamm-inaktiv');
  pruef(await page.locator(`#stamm-tabelle tr[data-id="${mat.id}"] [data-reaktiv]`).count() === 1, 'A2-Stamm: „Wieder aktivieren“ fehlt');
  await ueberlauf('stammdaten inaktiv');
  // Excel: Download vorhanden; hochladen derselben Datei → Vorschau „nichts geändert“
  const dl = await h.context.request.get(new URL(await page.locator('#stamm-export').getAttribute('href'), page.url()).toString());
  pruef(dl.ok() && /spreadsheetml/.test(dl.headers()['content-type'] || ''), `A2-Stamm: Excel-Export → ${dl.status()}`);
  await page.setInputFiles('#stamm-datei', { name: 'material.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await dl.body() });
  await page.waitForSelector('dialog[open] #st-import');
  pruef(await page.locator('[data-imp-neu="0"]').count() === 1 && await page.locator('[data-imp-geaendert="0"]').count() === 1 && await page.locator('#st-imp-ok').isDisabled(), 'A2-Stamm: unveränderte Excel-Datei zeigt Änderungen an');
  await dialogUeberlauf('stammdaten import'); await shot('stammdaten-import');
  await page.click('dialog[open] [data-zu]');
  // in Excel geänderter Code: erscheint als neu + fehlend, mit dem Hinweis, Codes im Programm umzubenennen (nichts wird übernommen)
  const ExcelJS = require('exceljs');
  const xlBuch = new ExcelJS.Workbook(); await xlBuch.xlsx.load(await dl.body());
  const xlBlatt = xlBuch.worksheets[0]; const kopf = xlBlatt.getRow(1).values; const spCode = kopf.findIndex((x) => String(x).toLowerCase() === 'code');
  pruef(spCode > 0 && xlBlatt.rowCount >= 3, `A2-Stamm: Excel-Export ohne Spalte „code“ (${JSON.stringify(kopf)})`);
  const codeXl = String(xlBlatt.getRow(2).getCell(spCode).value);
  xlBlatt.getRow(2).getCell(spCode).value = `xl-${k.toLowerCase()}-neu`;
  await page.setInputFiles('#stamm-datei', { name: 'material-code.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await xlBuch.xlsx.writeBuffer()) });
  await page.waitForSelector('dialog[open] #st-import');
  pruef(await page.locator('[data-imp-neu="1"]').count() === 1 && await page.locator('[data-imp-fehlend="1"]').count() === 1 && (await page.locator('#st-imp-fehlend').innerText()).includes(codeXl), `A2-Stamm: geänderter Code erscheint nicht als 1 neu + 1 fehlend (${(await page.locator('#st-import').innerText()).replace(/\s+/g, ' ').slice(0, 160)})`);
  pruef(await page.locator('#st-imp-code-hinweis').count() === 1 && /Codes bitte im Programm umbenennen, nicht in Excel/.test(await page.locator('#st-imp-code-hinweis').innerText()), 'A2-Stamm: Hinweis „Codes bitte im Programm umbenennen, nicht in Excel“ fehlt');
  await dialogUeberlauf('stammdaten import code');
  await page.click('dialog[open] [data-zu]');
  pruef((await api('GET', '/stammdaten/materialien?inaktiv=1')).json.some((m) => m.code === codeXl), 'A2-Stamm: abgebrochene Excel-Vorschau hat etwas geändert');
  // 12.21: Code eines verwendeten Materials umbenennen – Vorschau nennt die Verweise, die Nachkalkulation bleibt gleich; doppelter Code → Feldfehler
  const flach = (pz) => (pz.gruppen || []).flatMap((gr) => (gr.positionen || []).map((x) => ({ id: x.id, menge: x.menge, summe: x.summe, quelle: x.quelle })));
  const stammMat = (await api('GET', '/stammdaten/materialien?inaktiv=1')).json;
  const refs = (x) => [].concat((x.quelle && x.quelle.ref) || []); // Quelle nennt einen oder mehrere Codes
  // eine Position, die ein Material über den Code verwendet und schon Menge hat – in den Testdaten vorhanden (Schotter/Kies …)
  let bsCode = null, posVor = null, mitQuelle = null;
  for (const bx of (await api('GET', '/baustellen')).json) {
    const pz = (await api('GET', `/baustellen/${bx.id}/positionen`)).json;
    const treffer = flach(pz).find((x) => x.quelle && x.quelle.art === 'material' && x.menge > 0 && stammMat.some((m) => m.aktiv !== false && refs(x).includes(m.code)));
    if (treffer) { bsCode = bx.id; posVor = pz; mitQuelle = treffer; break; }
  }
  if (!mitQuelle) throw new Error('A2-Code: Die Testdaten enthalten keine Position mit Material-Quelle und Menge > 0 – die Umbenennung lässt sich so nicht prüfen (Seed prüfen).');
  const umb = stammMat.find((m) => m.aktiv !== false && refs(mitQuelle).includes(m.code));
  const codeAlt = umb.code, codeNeu = `${umb.code}-x`.slice(0, 20), codeFremd = stammMat.find((m) => m.id !== umb.id && m.aktiv !== false).code;
  pruef(mitQuelle.menge > 0, 'A2-Code: Menge der Position vor dem Umbenennen ist 0');
  await page.uncheck('#stamm-inaktiv');
  await page.click(`#stamm-tabelle tr[data-id="${umb.id}"] [data-edit]`);
  await page.waitForSelector('dialog[open] #stf');
  pruef(await page.locator('#stf [name="code"]').isEditable(), 'A2-Code: Code eines verwendeten Materials ist gesperrt');
  await page.fill('#stf [name="code"]', codeNeu);
  await page.click('#st-ok');
  await page.waitForSelector('dialog[open] [data-ok]');
  const frage = (await page.locator('dialog[open]').last().innerText()).replace(/\s+/g, ' ');
  const nVerweise = Number((/(\d+) Verweise? in der Nachkalkulation/.exec(frage) || [])[1]);
  pruef(frage.includes(`„${codeAlt}“ → „${codeNeu}“`) && nVerweise > 0, `A2-Code: Rückfrage vor dem Umbenennen falsch („${frage.slice(0, 160)}“)`);
  pruef((await api('GET', '/stammdaten/materialien?inaktiv=1')).json.find((m) => m.id === umb.id).code === codeAlt, 'A2-Code: schon vor der Bestätigung umbenannt');
  await dialogUeberlauf('code umbenennen'); await shot('stammdaten-code');
  await page.locator('dialog[open] [data-ok]').last().click();
  await page.waitForFunction(() => !document.querySelector('dialog[open] #stf'));
  await toastWeg();
  const posNach = (await api('GET', `/baustellen/${bsCode}/positionen`)).json;
  const nachher = flach(posNach).find((x) => x.id === mitQuelle.id);
  pruef(nachher && nachher.menge === mitQuelle.menge && nachher.menge > 0 && nachher.summe === mitQuelle.summe, `A2-Code: Menge der Position ändert sich durch das Umbenennen (${mitQuelle.menge} → ${nachher && nachher.menge})`);
  pruef(JSON.stringify(flach(posNach).map((x) => [x.id, x.menge, x.summe])) === JSON.stringify(flach(posVor).map((x) => [x.id, x.menge, x.summe])), 'A2-Code: Mengen/Summen der Nachkalkulation ändern sich durch das Umbenennen');
  pruef((await api('GET', '/stammdaten/materialien?inaktiv=1')).json.find((m) => m.id === umb.id).code === codeNeu && refs(nachher).includes(codeNeu) && !refs(nachher).includes(codeAlt), `A2-Code: Code oder Verweis der Position nicht mitgezogen (${JSON.stringify(nachher.quelle)})`);
  // doppelter Code → Fehler am Feld, nichts geändert
  await page.click(`#stamm-tabelle tr[data-id="${umb.id}"] [data-edit]`);
  await page.waitForSelector('dialog[open] #stf');
  await page.fill('#stf [name="code"]', codeFremd);
  await h.absichtlich(async () => { await page.click('#st-ok'); await page.waitForSelector('#stf [data-fehler="code"]:not([hidden])'); });
  pruef(/schon/.test(await page.locator('#stf [data-fehler="code"]').innerText()) && await page.locator('dialog[open] [data-ok]').count() === 0, 'A2-Code: doppelter Code ohne Feldfehler');
  await page.click('dialog[open] [data-zu]');
  const umbJetzt = (await api('GET', '/stammdaten/materialien?inaktiv=1')).json.find((m) => m.id === umb.id);
  pruef((await api('PUT', `/stammdaten/materialien/${umb.id}`, { version: umbJetzt.version, code: codeAlt })).status === 200, 'A2-Code: Zurückbenennen nicht möglich');
  // Lohngruppen: Code fest, Name änderbar
  await page.click('[data-tab="lohngruppen"]');
  await page.waitForSelector('#stamm-tabelle [data-edit]');
  await page.locator('#stamm-tabelle [data-edit]').first().click();
  await page.waitForSelector('dialog[open] #stf');
  pruef(await page.locator('#st-code-fest').count() === 1 && await page.locator('#stf [name="id"], #stf [name="code"]').count() === 0 && /Code fest – Name jederzeit änderbar/.test(await page.locator('#stf').innerText()), 'A2-Code: Lohngruppen-Code ist änderbar oder der Hinweis fehlt');
  await page.click('dialog[open] [data-zu]');
  await page.click('[data-tab="materialien"]'); await page.waitForSelector('#stamm-tabelle');
  // alter Bericht zeigt das Material weiter, ein neuer Entwurf nicht mehr
  if (z.berMat) {
    await geh(`/bericht/${z.berMat}`);
    pruef(await page.locator(`.mat-row[data-m="${mat.id}"]`).count() === 1, 'A2-Stamm: alter Bericht zeigt das deaktivierte Material nicht mehr');
    const b2 = (await api('GET', `/berichte/${z.berMat}`)).json;
    pruef((b2.material || []).some((m) => m.materialId === mat.id && m.menge === 3), 'A2-Stamm: Menge im alten Bericht verloren');
  }
  await abmelden();
}

/* ================= Baustellenplaner (12.8–12.8d): Einteilen, Notizen, Veröffentlichen, Fortschreiben, Fuhren ================= */
async function planer(h, z) {
  const { page, api, geh, pruef, keinEuro, ueberlauf, dialogUeberlauf, shot, g, anmelden, abmelden, toastWeg, context } = h;
  const k = KENN(g), heute = h.heute();
  const morgen = naechsterArbeitstag(heute);
  const POLIER2 = 'Thomas Riegler';
  const ausgang = async () => (await context.request.get(h.srv.url + '/api/test/ausgang')).json();
  const zelle = (datum, bs) => page.locator(`.wp-gitter [data-zelle][data-datum="${datum}"][data-bs="${bs}"]`);
  const karte = (bs) => page.locator(`.tg-karte[data-bs="${bs}"]`);

  /* ---- Polier der Zielbaustelle: Berichtsentwurf für heute (für die Fuhre) ---- */
  const ichR = await anmelden('polier', POLIER2);
  const B = ichR.baustellenIds[0];
  let ber = await api('POST', '/berichte', { baustelleId: B, datum: heute });
  const berId = ber.status === 201 ? ber.json.id : ber.json && ber.json.id;
  ber = (await api('GET', `/berichte/${berId}`)).json;
  const entwurf = ber.status === 'entwurf' && !(ber.unterschriften.an || ber.unterschriften.bh);
  await geh('/partie');
  pruef(await page.locator('#partie-leer').count() === 1, 'A2-Plan: Polier sieht eine Partie, obwohl nichts veröffentlicht ist');
  pruef(await page.locator('#partie-druck').count() === 0 && (await h.absichtlich(() => api('GET', `/plan/tag.pdf?datum=${morgen}`))).status === 404, 'A2-Druck: Polier kann einen nicht veröffentlichten Tag drucken');
  await abmelden();

  /* ---- Mitarbeiter: noch kein Einsatz, Push-Abo (Attrappe) ---- */
  const ichM = await anmelden('mitarbeiter');
  const L = ichM.benutzer.id;
  pruef((await api('POST', '/push/abo', { endpoint: `https://push.example.test/e2e-${k}-${L}`, keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' }, geraet: 'E2E' })).status < 300, 'A2-Plan: Push-Abo (Attrappe) nicht möglich');
  const st = (await api('GET', '/zeit/status')).json;
  if (st.status !== 'aus') { if (st.status === 'pause') await api('POST', '/zeit/stempeln', { typ: 'pause_ende' }); await api('POST', '/zeit/stempeln', { typ: 'gehen' }); }
  await geh('/einsatz');
  pruef(await page.locator('#einsatz-leer').count() === 1, 'A2-Plan: „Mein Einsatz“ zeigt etwas, obwohl nichts veröffentlicht ist');
  await keinEuro('einsatz leer');
  await h.keinZugriff('/plan'); await h.keinZugriff('/partie');
  const planMeldungen = async () => (await api('GET', '/benachrichtigungen')).json.filter((n) => n.typ === 'plan');
  const meldVorher = (await planMeldungen()).length;
  await abmelden();

  /* ---- Büro: einteilen (Ziehen, Tastatur, Dialog), Konflikt, Notizen, Veröffentlichen ---- */
  await anmelden('buero');
  // der Mitarbeiter soll heute und morgen einteilbar sein: eigene Abwesenheits-Anträge aus früheren Prüfungen entfernen
  await abwWeg(api, (await api('GET', `/abwesenheiten?von=${heute}&bis=${morgen}`)).json.filter((x) => x.benutzerId === L));
  const woche0 = (await api('GET', `/plan/woche?von=${morgen}&tage=5`)).json;
  pruef(Array.isArray(woche0.baustellen) && woche0.baustellen.some((b) => b.id === B), 'A2-Plan: /plan/woche ohne die Baustelle des Poliers');
  const B2 = woche0.baustellen.find((b) => b.id !== B).id;
  const frei = woche0.frei[morgen];
  const andere = frei.personen.filter((p) => p.status === 'frei' && p.rolle === 'mitarbeiter' && p.benutzerId !== L);
  const [P2, P3, P4, P5] = andere;
  const lkw = frei.anlagen.find((a) => !a.gesperrt && a.kennzeichen && /^LKW\b/.test(a.bezeichnung || '')); // N-102: Fuhren nur mit LKW (kein Anhänger/PKW)
  pruef(!!(P2 && P3 && P4 && P5 && lkw), 'A2-Plan: zu wenige freie Personen oder kein freier LKW in den Testdaten');
  const pushVorher = (await ausgang()).push.filter((p) => p.benutzerId === L).length;

  await geh(`/plan?ansicht=woche&datum=${morgen}`);
  await page.waitForSelector('.wp-gitter');
  pruef(await page.locator('.wp-kachel').count() === 4 && await page.locator('#wp-vorwoche').count() === 1 && await page.locator('#wp-pub').count() === 1, 'A2-Plan: Kacheln, „Vorwoche übernehmen“ oder „Plan veröffentlichen“ fehlen');
  await ueberlauf('plan woche leer'); await shot('plan-woche-leer');
  const poolP = (id) => page.locator(`.wp-pool [data-pool][data-chip="p"][data-id="${id}"]`);
  // 1) Ziehen (Tablet/PC) bzw. Auswählen + „Einteilen“ (Handy)
  if (g.mobil) { await poolP(L).click(); await zelle(morgen, B).locator('[data-hier]').click(); }
  else await zieh(page, poolP(L), zelle(morgen, B));
  await zelle(morgen, B).locator(`[data-chip="p"][data-id="${L}"]`).waitFor();
  await toastWeg();
  // 2) Tastatur: Chip mit Enter auswählen, in der Zelle „Einteilen“ mit Enter
  await poolP(P2.benutzerId).focus(); await page.keyboard.press('Enter');
  await page.waitForSelector(`.wp-pool [data-pool][data-id="${P2.benutzerId}"][aria-pressed="true"]`);
  pruef(await page.locator('#wp-auswahl').count() === 1, 'A2-Plan: Auswahl-Hinweis fehlt');
  await zelle(morgen, B).locator('[data-hier]').focus(); await page.keyboard.press('Enter');
  await zelle(morgen, B).locator(`[data-chip="p"][data-id="${P2.benutzerId}"]`).waitFor();
  await toastWeg();
  // 3) „+“-Dialog: LKW
  await zelle(morgen, B).locator('[data-plus]').click();
  await page.waitForSelector('dialog[open] #plf');
  await page.check(`#plf input[name="a"][value="${lkw.anlageId}"]`);
  await dialogUeberlauf('plan plus');
  await page.click('dialog[open] button[type="submit"]');
  await zelle(morgen, B).locator(`[data-chip="a"][data-id="${lkw.anlageId}"]`).waitFor();
  await toastWeg();
  // 4) Konflikt: dieselbe Person am selben Tag auf zweiter Baustelle
  pruef((await api('POST', '/plan/einsaetze', { datum: morgen, baustelleId: B2, benutzerIds: [L] })).status === 201, 'A2-Plan: zweiter Einsatz (Konflikt) nicht anlegbar');
  await geh('/plan?ansicht=geraete'); await geh(`/plan?ansicht=woche&datum=${morgen}`); // neu laden (gleiche Adresse lädt nicht neu)
  await page.waitForSelector('.wp-chip.konflikt[data-konflikt="person_doppelt"]');
  pruef(await page.locator('#wp-konflikte [data-konflikt-zeile="person_doppelt"]').count() >= 1 && Number(await page.locator('[data-kachel="konflikte"] b').innerText()) >= 1, 'A2-Plan: Konflikt fehlt in Liste oder Kachel');
  await ueberlauf('plan konflikt'); await shot('plan-woche-konflikt');
  await keinEuro('plan woche');
  // Konflikt lösen: Chip öffnen → Entfernen
  await zelle(morgen, B2).locator(`[data-chip="p"][data-id="${L}"] [data-chip-auf]`).click();
  await page.waitForSelector('dialog[open] #chip-weg');
  await page.click('#chip-weg');
  await page.waitForFunction(() => !document.querySelector('.wp-chip.konflikt[data-konflikt="person_doppelt"]'));
  await toastWeg();

  // 5) Tagesansicht „Morgen“: Angaben, Notizen, Fahrer
  await geh('/plan?ansicht=tag');
  await page.waitForSelector(`.tg-karte[data-bs="${B}"]`);
  pruef((await page.locator('#tg-tag').getAttribute('data-datum')) === morgen && await page.locator('#tg-stand[data-zustand="offen"]').count() === 1, 'A2-Plan: Tagesansicht zeigt nicht „morgen – noch nicht veröffentlicht“');
  await karte(B).locator('[data-details]').click();
  await page.waitForSelector('dialog[open] #edf');
  await page.fill('#edf [name="beginn"]', '06:30'); await page.fill('#edf [name="treffpunkt"]', 'Bauhof');
  await page.fill('#edf [name="arbeit"]', 'Pflaster verlegen'); await page.fill('#edf [name="benoetigt"]', 'Rüttelplatte, Absperrgitter');
  await dialogUeberlauf('plan einsatz');
  await page.click('dialog[open] button[type="submit"]');
  await page.waitForSelector(`.tg-karte[data-bs="${B}"] .benoetigt dd:has-text("Rüttelplatte")`);
  await toastWeg();
  const notiz = async (art, id, text, fahrer) => {
    await karte(B).locator(`[data-chip="${art}"][data-id="${id}"] [data-notiz-auf]`).click();
    await page.waitForSelector('.wp-notiz-ed');
    await page.fill('.wp-notiz-ed [name="notiz"]', text);
    if (fahrer) await page.selectOption('.wp-notiz-ed [name="fahrerId"]', String(fahrer));
    await page.click('.wp-notiz-ed button[type="submit"]');
    await page.waitForSelector(`.tg-karte[data-bs="${B}"] [data-chip="${art}"][data-id="${id}"][data-notiz="${text}"]`);
    await toastWeg();
  };
  await notiz('p', L, 'Führerschein C mitnehmen');
  await notiz('p', P2.benutzerId, `NUR-FUER-P2-${k}`);
  await notiz('a', lkw.anlageId, 'Vorher tanken', L);
  pruef(await karte(B).locator(`[data-chip="a"] .wp-fahrer[data-fahrer="${L}"]`).count() === 1, 'A2-Plan: Fahrer am LKW-Chip fehlt');
  await ueberlauf('plan morgen'); await shot('plan-morgen');
  await keinEuro('plan morgen');

  // Drucken (12.23): Entwurf → Hinweis auf das Wasserzeichen; PDF kommt vom Server
  await page.click('#wp-druck');
  await page.waitForSelector('dialog[open] [data-ok]');
  pruef(/Entwurf – wird mit Wasserzeichen gedruckt/.test(await page.locator('dialog[open]').innerText()), 'A2-Druck: Hinweis „Entwurf – wird mit Wasserzeichen gedruckt“ fehlt');
  await page.click('dialog[open] [data-zu]');
  for (const [name, pfad] of [['Tagesplan', `/api/plan/tag.pdf?datum=${morgen}`], ['Wochenplan', `/api/plan/woche.pdf?von=${morgen}`]]) {
    const pdf = await context.request.get(h.srv.url + pfad); const inhalt = await pdf.body();
    pruef(pdf.ok() && /application\/pdf/.test(pdf.headers()['content-type'] || '') && inhalt.length > 800 && inhalt.subarray(0, 5).toString() === '%PDF-', `A2-Druck: ${name} liefert kein PDF (${pdf.status()}, ${inhalt.length} Bytes)`);
  }
  // 6) Veröffentlichen: vorher keine Meldung; Abbrechen sendet nichts; erste Veröffentlichung → alle
  pruef((await ausgang()).push.filter((p) => p.benutzerId === L).length === pushVorher, 'A2-Plan: Meldung an den Mitarbeiter, bevor veröffentlicht wurde');
  await page.click('#tg-pub');
  await page.waitForSelector('dialog[open] #pub-vorschau');
  const emp1 = await page.locator('#pub-empfaenger li').evaluateAll((l) => l.map((x) => [Number(x.dataset.pubPerson), x.dataset.art]));
  const ohnePartie = emp1.filter(([, a]) => a !== 'partie');
  pruef(ohnePartie.length === 2 && ohnePartie.every(([, a]) => a === 'neu') && ohnePartie.some(([id]) => id === L) && ohnePartie.some(([id]) => id === P2.benutzerId) && emp1.every(([, a]) => ['neu', 'partie'].includes(a)), `A2-Plan: Vorschau der Empfänger falsch (${JSON.stringify(emp1)})`);
  const nEmp = new Set(emp1.map(([id]) => id)).size;
  pruef(new RegExp(`${nEmp} Personen werden benachrichtigt`).test((await page.locator('#pub-text').innerText()).replace(/\s+/g, ' ')), `A2-Plan: Text „${nEmp} Personen werden benachrichtigt“ fehlt`);
  await dialogUeberlauf('plan veröffentlichen'); await shot('plan-veroeffentlichen');
  await page.click('#pub-abbrechen');
  await page.waitForTimeout(300);
  pruef((await ausgang()).push.filter((p) => p.benutzerId === L).length === pushVorher && await page.locator('#tg-stand[data-zustand="offen"]').count() === 1, 'A2-Plan: „Abbrechen“ hat trotzdem gesendet oder veröffentlicht');
  await page.click('#tg-pub');
  await page.waitForSelector('dialog[open] #pub-ok');
  await page.click('#pub-ok');
  await page.waitForSelector('#tg-stand[data-zustand="veroeffentlicht"]');
  pruef(/Veröffentlicht \d{2}:\d{2}/.test(await page.locator('#tg-stand').innerText()), 'A2-Plan: Kopf zeigt nicht „Veröffentlicht HH:MM“');
  let push = (await ausgang()).push.filter((p) => p.benutzerId === L);
  pruef(push.length === pushVorher + 1, `A2-Plan: nach der Veröffentlichung ${push.length - pushVorher} Push-Meldungen statt 1`);
  const p1 = push[push.length - 1] || {};
  pruef(/06:30/.test(p1.body || '') && /Hinweis vorhanden/.test(p1.body || '') && !/Führerschein/.test(p1.body || '') && !/€/.test(`${p1.title}${p1.body}`), `A2-Plan: Kurztext der Meldung falsch („${p1.title} / ${p1.body}“)`);
  await toastWeg();
  // 7) Notiz ändern → erneut veröffentlichen: nur die betroffene Person
  await notiz('p', L, 'Führerschein C und Fahrerkarte');
  pruef(await page.locator('#tg-stand[data-zustand="geaendert"]').count() === 1, 'A2-Plan: geänderter Tag nicht als „Änderungen noch nicht veröffentlicht“ markiert');
  await page.click('#tg-pub');
  await page.waitForSelector('dialog[open] #pub-vorschau');
  const emp2 = await page.locator('#pub-empfaenger li').evaluateAll((l) => l.map((x) => [Number(x.dataset.pubPerson), x.dataset.art]));
  pruef(emp2.length === 1 && emp2[0][0] === L && emp2[0][1] === 'geaendert' && /1 Person mit Änderungen/.test((await page.locator('#pub-text').innerText()).replace(/\s+/g, ' ')), `A2-Plan: erneute Veröffentlichung trifft nicht nur die geänderte Person (${JSON.stringify(emp2)})`);
  await page.click('#pub-ok');
  await page.waitForSelector('#tg-stand[data-zustand="veroeffentlicht"]');
  push = (await ausgang()).push.filter((p) => p.benutzerId === L);
  pruef(push.length === pushVorher + 2 && /Geändert/.test(`${push[push.length - 1].title} ${push[push.length - 1].body}`), 'A2-Plan: „Geändert“-Meldung an die betroffene Person fehlt');
  await toastWeg();

  // 8) Heute: Einsatz für die Stempeluhr-Vorauswahl + Fuhre (Formular), dann veröffentlichen
  const eh = await api('POST', '/plan/einsaetze', { datum: heute, baustelleId: B, beginn: '06:30', benutzerIds: [L] });
  pruef(eh.status === 201, `A2-Plan: Einsatz für heute → ${eh.status}`);
  const mats = (await api('GET', '/materialien')).json;
  const mat = mats.find((m) => m.einheit === 't') || mats[0];
  const mengeVorher = ((ber.material || []).find((m) => m.materialId === mat.id) || {}).menge || 0;
  await page.click('[data-tag-weiter="-1"]');
  await page.waitForSelector(`#tg-tag[data-datum="${heute}"]`);
  if (!g.mobil) { // LKW auf die Fuhren einer Baustelle ziehen → Formular mit LKW und Ziel
    const lkwChip = page.locator(`.wp-pool [data-pool][data-chip="a"]`).first();
    const lkwId = await lkwChip.getAttribute('data-id');
    await zieh(page, lkwChip, karte(B).locator('.fu-zone'), { oben: 20 });
    await page.waitForSelector('dialog[open] #fuf');
    pruef(await page.locator('#fuf [name="nachBs"]').inputValue() === String(B) && [lkwId, ''].includes(await page.locator('#fuf [name="anlageId"]').inputValue()), 'A2-Fuhre: Ziehen des LKW belegt Ziel/LKW nicht vor');
    await page.click('dialog[open] [data-zu]');
  }
  await karte(B).locator('[data-fuhre-neu]').click();
  await page.waitForSelector('dialog[open] #fuf');
  pruef(await page.locator('#fuf [name="nachBs"]').inputValue() === String(B) && await page.locator('#fuf [name="vonArt"]').inputValue() === 'grube', 'A2-Fuhre: Standard Grube → Baustelle fehlt');
  await page.selectOption('#fuf [name="anlageId"]', String(lkw.anlageId));
  await page.selectOption('#fuf [name="fahrerId"]', String(L));
  await page.fill('#fuf [name="beginn"]', '06:30');
  await page.fill('#fuf [name="material"]', mat.name);
  await page.fill('#fuf [name="menge"]', '45'); await page.fill('#fuf [name="anzahlFuhren"]', '3');
  await page.fill('#fuf [name="abladestelle"]', 'Zufahrt hinten');
  await page.fill('#fuf [name="nachLink"]', '47.7012, 16.1034');
  pruef(await page.locator('#fu-kopie input').count() === 5 && !(await page.locator('dialog[open]').innerText()).includes('€'), 'A2-Fuhre: „Für weitere Tage kopieren“ fehlt oder Preise im Formular');
  await dialogUeberlauf('fuhre formular'); await shot('fuhre-formular');
  await page.click('#fu-ok');
  await page.waitForSelector(`.tg-karte[data-bs="${B}"] .fu-zone [data-fuhre]`);
  pruef(/45/.test(await karte(B).locator('.fu-zone [data-fuhre]').first().innerText()), 'A2-Fuhre: Karte zeigt die Menge nicht');
  const fuhre = (await api('GET', `/plan/fuhren?von=${heute}&bis=${heute}`)).json.find((f) => f.fahrer && f.fahrer.benutzerId === L);
  const fuhre2 = (await api('POST', '/plan/fuhren', { datum: heute, anlageId: lkw.anlageId, fahrerId: L, materialId: mat.id, menge: 20, einheit: 't', reihenfolge: 2, nach: { art: 'baustelle', baustelleId: B } })).json;
  pruef((await api('POST', '/plan/veroeffentlichen', { von: heute, bis: heute })).status === 200, 'A2-Plan: heute veröffentlichen nicht möglich');
  await toastWeg();

  // G-14: eine veröffentlichte Fuhre löschen → zählt als unveröffentlichte Änderung; der Dialog nennt, für wen sie entfällt
  const fuhre3 = (await api('POST', '/plan/fuhren', { datum: morgen, anlageId: lkw.anlageId, fahrerId: P2.benutzerId, materialId: mat.id, menge: 10, einheit: 't', nach: { art: 'baustelle', baustelleId: B } })).json;
  pruef((await api('POST', '/plan/veroeffentlichen', { von: morgen, bis: morgen })).status === 200, 'A2-G14: Fuhre veröffentlichen nicht möglich');
  await geh('/plan?ansicht=geraete'); await geh('/plan?ansicht=tag');
  await page.waitForSelector(`#tg-stand[data-zustand="veroeffentlicht"]`);
  pruef(await page.locator('#tg-pub').isDisabled(), 'A2-G14: ohne offene Änderung ist „veröffentlichen“ aktiv');
  await page.locator(`[data-fuhre="${fuhre3.id}"]`).first().click();
  await page.waitForSelector('dialog[open] #fu-weg');
  await page.click('#fu-weg');
  await page.waitForSelector('dialog[open] [data-ok]');
  pruef(/nächsten Veröffentlichung/.test(await page.locator('dialog[open]').last().innerText()), 'A2-G14: Hinweis fehlt, dass der Fahrer es erst mit der Veröffentlichung erfährt');
  await page.locator('dialog[open] [data-ok]').last().click();
  await page.waitForSelector('#tg-stand[data-zustand="geaendert"]');
  pruef(!(await page.locator('#tg-pub').isDisabled()) && Number(await page.locator('#tg-pub').getAttribute('data-personen')) >= 1, 'A2-G14: gelöschte veröffentlichte Fuhre zählt nicht als offene Änderung');
  await toastWeg();
  await page.click('#tg-pub');
  await page.waitForSelector('dialog[open] #pub-vorschau');
  pruef(await page.locator(`#pub-empfaenger li[data-pub-person="${P2.benutzerId}"][data-art="entfaellt"], #pub-empfaenger li[data-pub-person="${P2.benutzerId}"][data-art="geaendert"]`).count() === 1, `A2-G14: der Fahrer der gelöschten Fuhre fehlt im Bestätigungsdialog (${JSON.stringify(await page.locator('#pub-empfaenger li').evaluateAll((l) => l.map((x) => [x.dataset.pubPerson, x.dataset.art])))})`);
  await page.click('#pub-ok');
  await page.waitForSelector('#tg-stand[data-zustand="veroeffentlicht"]');
  await toastWeg();
  await geh('/plan?ansicht=woche');
  pruef(await page.locator('#wp-pub').getAttribute('data-anzahl') !== null, 'A2-G14: Kopf der Woche ohne Zähler der offenen Änderungen');
  // 9) Fortschreiben: Montag planen → Dienstag ist Vorschau ohne die Person im Urlaub → tauschen → veröffentlichen
  const mo = (() => { let t = morgen; while (new Date(t + 'T12:00:00Z').getUTCDay() !== 1) t = plusTage(t, 1); return plusTage(t, 7); })(); // Montag der übernächsten Woche
  const di = plusTage(mo, 1);
  // (der Montag ist bis dahin selbst „wie Freitag“ vorbereitet – die erste Änderung speichert ihn; die Zelle kann es also schon geben)
  await api('POST', '/plan/tag/uebernehmen', { datum: mo });
  const zMo = (await api('GET', `/plan/woche?von=${mo}&tage=5`)).json.einsaetze.find((e) => e.datum === mo && e.baustelleId === B2 && e.id != null);
  const eMo = zMo ? await api('POST', `/plan/einsaetze/${zMo.id}/personen`, { benutzerIds: [P3.benutzerId, P4.benutzerId] }) : await api('POST', '/plan/einsaetze', { datum: mo, baustelleId: B2, beginn: '07:00', benutzerIds: [P3.benutzerId, P4.benutzerId] });
  pruef(eMo.status === 201 || eMo.status === 200, `A2-Fort: Montag planen → ${eMo.status}`);
  pruef((await api('POST', '/abwesenheiten', { benutzerId: P4.benutzerId, datum: di, code: 'U' })).status < 300, 'A2-Fort: Urlaub eintragen nicht möglich');
  await geh(`/plan?ansicht=woche&datum=${di}`);
  await page.waitForSelector(`.wp-gitter [data-zelle][data-datum="${di}"][data-bs="${B2}"][data-vorschau]`);
  const zDi = zelle(di, B2);
  pruef(await zDi.locator(`[data-chip="p"][data-id="${P3.benutzerId}"]`).count() === 1 && await zDi.locator(`[data-chip="p"][data-id="${P4.benutzerId}"]`).count() === 0 && await zDi.locator('[data-uebersprungen="abwesenheit"]').count() === 1 && await zDi.locator('[data-wie-vortag]').count() === 1, 'A2-Fort: Dienstag ist nicht „wie Montag“ ohne die Person im Urlaub (mit Warnung)');
  pruef(await zelle(mo, B2).locator('.wp-chip.serie').count() >= 1, `A2-Fort: durchgehender Balken (Serie) fehlt (${JSON.stringify(((await api('GET', `/plan/woche?von=${mo}&tage=5`)).json.serien.personen || {})[P3.benutzerId])})`);
  await ueberlauf('plan fortschreiben'); await shot('plan-wie-vortag');
  // Ersatz einteilen (Ziehen bzw. Auswahl) → der Tag wird gespeichert
  if (g.mobil) { await poolP(P5.benutzerId).click(); await zDi.locator('[data-hier]').click(); }
  else await zieh(page, poolP(P5.benutzerId), zDi);
  await page.waitForSelector(`.wp-gitter [data-zelle][data-datum="${di}"][data-bs="${B2}"]:not([data-vorschau]) [data-chip="p"][data-id="${P5.benutzerId}"]`);
  pruef(await zelle(di, B2).locator(`[data-chip="p"][data-id="${P3.benutzerId}"]`).count() === 1, 'A2-Fort: beim Speichern des Vorschau-Tags ging die übernommene Person verloren');
  await toastWeg();
  const probe = (await api('POST', '/plan/veroeffentlichen', { von: di, bis: di, vorschau: true })).json;
  const ids = probe.empfaenger.map((e) => e.benutzerId);
  pruef(probe.empfaenger.every((e) => ['neu', 'partie'].includes(e.art)) && ids.includes(P3.benutzerId) && ids.includes(P5.benutzerId) && !ids.includes(P4.benutzerId), `A2-Fort: erste Veröffentlichung meldet nicht alle Eingeteilten bzw. die Person im Urlaub (${JSON.stringify(probe.empfaenger)})`);
  pruef((await api('POST', '/plan/veroeffentlichen', { von: di, bis: di })).status === 200, 'A2-Fort: Dienstag veröffentlichen nicht möglich');
  await page.locator(`.wp-gitter [data-zelle][data-datum="${di}"][data-bs="${B2}"] [data-chip="p"][data-id="${P5.benutzerId}"] [data-chip-auf]`).click();
  await page.waitForSelector('dialog[open] #chip-weg'); await page.click('#chip-weg'); await toastWeg();
  const probe2 = (await api('POST', '/plan/veroeffentlichen', { von: di, bis: di, vorschau: true })).json;
  const p2e = probe2.empfaenger.filter((e) => e.art !== 'partie');
  pruef(p2e.length === 1 && p2e[0].benutzerId === P5.benutzerId && p2e[0].art === 'entfaellt', `A2-Fort: erneute Veröffentlichung trifft nicht nur die geänderte Person (${JSON.stringify(probe2.empfaenger)})`);
  // Projektzeitplan und Geräte-Disposition erreichbar
  await geh('/plan?ansicht=zeitplan');
  await page.waitForSelector('#zeitplan .zp-zeile[data-bv]');
  pruef(await page.locator('.zp-kw').count() === 16 && await page.locator('#zp-archiv').count() === 1, 'A2-Plan: Projektzeitplan ohne Kalenderwochen oder Archiv-Knopf');
  await page.locator(`.zp-zeile[data-bv="${B}"] [data-abschnitt-neu]`).click();
  await page.waitForSelector('dialog[open] #zpf');
  await page.selectOption('#zpf [name="art"]', 'pflaster'); await page.fill('#zpf [name="von"]', heute); await page.fill('#zpf [name="bis"]', plusTage(heute, 13));
  await page.click('dialog[open] button[type="submit"]');
  await page.waitForSelector(`.zp-zeile[data-bv="${B}"] .zp-balken.art-pflaster`);
  await keinEuro('zeitplan'); await ueberlauf('zeitplan'); await shot('plan-zeitplan');
  await toastWeg();
  await page.click('[data-ansicht="geraete"]');
  await page.waitForSelector('#geraete-dispo');
  await ueberlauf('geräte-disposition');
  await abmelden();

  /* ---- Mitarbeiter: Mein Einsatz, Notizen, Stempeluhr-Vorauswahl, Meine Fuhren ---- */
  await anmelden('mitarbeiter');
  pruef((await planMeldungen()).length >= meldVorher + 2, 'A2-Plan: In-App-Meldungen zum Einsatz fehlen');
  await geh('/einsatz');
  await page.waitForSelector(`#einsatz-karte[data-datum="${morgen}"]`);
  const et = await page.locator('#einsatz-karte').innerText();
  pruef(/06:30/.test(et) && /Bauhof/.test(et) && /Pflaster verlegen/.test(et), `A2-Plan: Karte „Morgen“ unvollständig (${et.replace(/\s+/g, ' ').slice(0, 120)})`);
  pruef(/Fahrerkarte/.test(await page.locator('#me-meine-notiz').innerText()) && /Rüttelplatte/.test(await page.locator('#me-benoetigt').innerText()) && /Vorher tanken/.test(await page.locator('#me-fahrzeug').innerText()), 'A2-Plan: Meine Notiz, Benötigt oder Mein Fahrzeug fehlen');
  pruef(!(await h.text()).includes(`NUR-FUER-P2-${k}`), 'A2-Plan: Mitarbeiter sieht die Notiz einer anderen Person');
  pruef(await page.locator('#me-route').count() === 1 && /^https:\/\/www\.google\.com\/maps\/dir\//.test(await page.locator('#me-route').getAttribute('href')), 'A2-Plan: „Route öffnen“ fehlt');
  pruef(await page.locator('#wp-druck, #partie-druck').count() === 0 && (await h.absichtlich(() => api('GET', `/plan/tag.pdf?datum=${morgen}`))).status === 403, 'A2-Druck: Mitarbeiter hat einen Druck-Knopf oder Zugriff auf das PDF');
  await keinEuro('mein einsatz'); await ueberlauf('mein einsatz'); await shot('mein-einsatz');
  // Meine Fuhren
  const fz = page.locator(`#meine-fuhren li[data-fuhre="${fuhre.id}"]`);
  pruef(await page.locator('#meine-fuhren li[data-fuhre]').count() === 2, 'A2-Fuhre: „Meine Fuhren“ zeigt nicht beide Fuhren');
  const maps = await fz.locator('[data-maps]').getAttribute('href');
  pruef(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1/.test(maps) && /destination=47\.7012(%2C|,)16\.1034/.test(maps) && (await fz.locator('[data-maps]').getAttribute('target')) === '_blank', `A2-Fuhre: Maps-Link falsch (${maps})`);
  pruef(/Zufahrt hinten/.test(await fz.innerText()) && /45/.test(await fz.locator('.fu-menge').innerText()), 'A2-Fuhre: Abladestelle oder Menge fehlt');
  await fz.locator('[data-fuhr-los]').click();
  await page.waitForSelector(`#meine-fuhren li[data-fuhre="${fuhre.id}"][data-status="unterwegs"]`);
  await toastWeg();
  await page.locator(`#meine-fuhren li[data-fuhre="${fuhre.id}"] [data-fuhr-ab]`).click();
  await page.waitForSelector('dialog[open] #fab');
  pruef(await page.locator('#fab [name="menge"]').inputValue() === '45', 'A2-Fuhre: tatsächliche Menge nicht vorbelegt');
  await page.fill('#fab [name="menge"]', '44,5');
  await dialogUeberlauf('fuhre abgeladen');
  await page.click('#fab-ok');
  await page.waitForSelector(`#meine-fuhren li[data-fuhre="${fuhre.id}"][data-status="erledigt"]`);
  await toastWeg();
  // ohne Netz: Meldung wird gemerkt und nachgesendet
  await context.setOffline(true);
  await h.absichtlich(async () => { await page.locator(`#meine-fuhren li[data-fuhre="${fuhre2.id}"] [data-fuhr-los]`).click(); await page.waitForSelector('#fuhren-warten'); });
  pruef(await page.locator(`#meine-fuhren li[data-fuhre="${fuhre2.id}"][data-status="unterwegs"]`).count() === 1, 'A2-Fuhre: gemerkte Meldung wird nicht angezeigt');
  // die Meldung liegt jetzt nachweislich in der Warteschlange des Geräts
  pruef(await page.evaluate((id) => JSON.parse(localStorage.getItem('bt_fuhren_warten') || '[]').filter((w) => w.fuhreId === id).length, fuhre2.id) === 1, 'A2-Fuhre: Meldung ohne Netz liegt nicht in der Warteschlange');
  // ein Nachsende-Versuch im Augenblick des Umschaltens darf noch scheitern (die App versucht es erneut) – kein Konsolenfehler des Tests
  await h.absichtlich(async () => {
    await context.setOffline(false);
    // erst wenn der Server wieder erreichbar ist, das Netz-Ereignis auslösen (sonst scheitert das Nachsenden unter Last noch einmal)
    await h.netzDa();
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    // Signal: Warteschlange leer UND der Server kennt den Status – erst dann verschwindet der Hinweis
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('bt_fuhren_warten') || '[]').length === 0, null, { timeout: 20000, polling: 200 });
  });
  await page.waitForSelector(`#meine-fuhren li[data-fuhre="${fuhre2.id}"][data-status="unterwegs"]`);
  await page.waitForFunction(() => !document.querySelector('#fuhren-warten'));
  pruef((((await api('GET', `/plan/ich?von=${heute}&bis=${heute}`)).json || {}).tage || []).flatMap((t) => t.fuhren || []).some((f) => f.id === fuhre2.id && f.status === 'unterwegs'), 'A2-Fuhre: nachgesendete Meldung ist nicht am Server');
  await keinEuro('meine fuhren'); await ueberlauf('meine fuhren'); await shot('meine-fuhren');
  // Stempeluhr schlägt die geplante Baustelle vor
  await geh('/stempeln');
  pruef(await page.locator(`#plan-vorschlag[data-geplant="${B}"]`).count() === 1, 'A2-Plan: Stempeluhr zeigt den geplanten Einsatz nicht');
  const bName = woche0.baustellen.find((b) => b.id === B).name;
  pruef((await page.locator('.site-row.pick').innerText()).includes(bName), 'A2-Plan: Stempeluhr wählt die geplante Baustelle nicht vor');
  await keinEuro('stempeluhr geplant');
  await abmelden();

  /* ---- Polier der Baustelle: Meine Partie, Fuhren-Status, Bericht ---- */
  await anmelden('polier', POLIER2);
  await geh('/partie');
  await page.waitForSelector('[data-partie-einsatz]');
  pruef(await page.locator(`[data-partie-personen] li[data-person="${L}"] [data-lesestand="gelesen"], [data-partie-personen] li[data-person="${L}"] [data-lesestand="bestaetigt"]`).count() === 1, 'A2-Plan: Polier sieht nicht, dass der Mitarbeiter gelesen hat');
  const pt = await h.text();
  pruef(pt.includes(`NUR-FUER-P2-${k}`) && /Fahrerkarte/.test(pt) && /Vorher tanken/.test(pt) && /Rüttelplatte/.test(pt), 'A2-Plan: Polier sieht nicht alle Notizen');
  pruef(await page.locator('#partie-druck').count() === 1, 'A2-Druck: „Partie drucken“ fehlt am veröffentlichten Tag');
  const ppdf = await context.request.get(h.srv.url + await page.locator('#partie-druck').getAttribute('href'));
  pruef(ppdf.ok() && /application\/pdf/.test(ppdf.headers()['content-type'] || '') && (await ppdf.body()).length > 800, `A2-Druck: Partie-PDF → ${ppdf.status()}`);
  await keinEuro('partie'); await ueberlauf('partie'); await shot('partie-morgen');
  await page.locator('[data-anfrage]').first().click();
  await page.waitForSelector('dialog[open] #anf');
  await page.fill('#anf [name="text"]', 'Bitte einen zweiten Maschinisten');
  await page.click('dialog[open] button[type="submit"]');
  await toastWeg();
  await page.click(`[data-partie-tag="${heute}"]`);
  await page.waitForSelector(`#partie-fuhren li[data-fuhre="${fuhre.id}"][data-status="erledigt"]`);
  pruef(await page.locator(`#partie-fuhren li[data-fuhre="${fuhre2.id}"][data-status="unterwegs"]`).count() === 1, 'A2-Fuhre: Polier sieht den Status „unterwegs“ nicht');
  await keinEuro('partie fuhren');
  // Bericht: Menge genau einmal
  const ber2 = (await api('GET', `/berichte/${berId}`)).json;
  if (entwurf) {
    const zeile = (ber2.material || []).find((m) => m.materialId === mat.id) || {};
    pruef(Math.abs((zeile.menge || 0) - mengeVorher - 44.5) < 0.001 && Math.abs((zeile.ausFuhren || 0) - 44.5) < 0.001, `A2-Fuhre: Bericht enthält die Fuhre nicht genau einmal (Menge ${zeile.menge}, vorher ${mengeVorher}, ausFuhren ${zeile.ausFuhren})`);
    const wieder = await h.absichtlich(() => api('POST', `/plan/fuhren/${fuhre.id}/status`, { status: 'erledigt', menge: 44.5, einheit: 't' })); // Polier darf nicht melden (403) – in jedem Fall keine zweite Zeile
    const ber3 = (await api('GET', `/berichte/${berId}`)).json;
    pruef(Math.abs((((ber3.material || []).find((m) => m.materialId === mat.id) || {}).menge || 0) - mengeVorher - 44.5) < 0.001, `A2-Fuhre: wiederholte Meldung (${wieder.status}) erzeugt eine zweite Zeile`);
    await geh(`/bericht/${berId}`);
    pruef(await page.locator(`.mat-row[data-m="${mat.id}"] [data-aus-fuhre]`).count() === 1, 'A2-Fuhre: Kennzeichnung „aus Fuhre“ fehlt im Bericht');
  } else {
    pruef((ber2.fuhrenVorschlag || []).filter((v) => v.fuhreId === fuhre.id).length === 1, 'A2-Fuhre: Vorschlag im unterschriebenen Bericht fehlt oder ist doppelt');
    await geh(`/bericht/${berId}`);
    pruef(await page.locator(`#fuhren-vorschlag li[data-fuhre="${fuhre.id}"]`).count() === 1, 'A2-Fuhre: Vorschlag wird im Bericht nicht angezeigt');
  }
  await keinEuro('bericht fuhre');
  await abmelden();
}

/* ================= Dokumente (12.16), Rechnungen und Offene Posten (12.17) ================= */
const PDF = (text) => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R>>endobj\n4 0 obj<</Length ${text.length + 30}>>stream\nBT /F1 12 Tf 20 100 Td (${text}) Tj ET\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`, 'latin1');
const pngAusBrowser = async (page) => Buffer.from((await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 320; c.height = 200; const x = c.getContext('2d'); x.fillStyle = '#d4302b'; x.fillRect(0, 0, 320, 200); x.fillStyle = '#fff'; x.font = '28px sans-serif'; x.fillText('Einbauten', 20, 110); return c.toDataURL('image/png'); })).split(',')[1], 'base64');
const eur = (n) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }).format(n);

async function dokumenteUndRechnungen(h, z) {
  const { page, api, geh, pruef, keinEuro, ueberlauf, dialogUeberlauf, shot, g, anmelden, abmelden, toastWeg, context } = h;
  const k = KENN(g), heute = h.heute();
  const W = z.w || 1; // Baustelle des Poliers Haidbauer
  const pdfDatei = (name, text) => ({ name, mimeType: 'application/pdf', buffer: PDF(text) });

  await anmelden('buero');
  /* ---- Dokumente ---- */
  await geh(`/baustelle/${W}?reiter=dokumente`);
  await page.waitForSelector('#dokumente');
  pruef(await page.locator('.dok-kat-btn').count() >= 12 && await page.locator('.dok-kat-btn[data-kat="angebot"]').count() === 1 && await page.locator('#dok-ablage').count() === 1, 'A2-Dok: Kategorien (inkl. finanzieller) oder Ablagefläche fehlen');
  pruef(await page.locator('#dok-kat-neu').count() === 0 && (await h.absichtlich(() => api('POST', '/dokument-kategorien', { name: 'Büro darf nicht', finanziell: false, polier: false }))).status === 403, 'A2-Dok: Büro kann eigene Kategorien anlegen (nur Geschäftsführung)');
  await page.setInputFiles('#dok-datei', [pdfDatei(`Lageplan ${k}.pdf`, 'Lageplan'), { name: `Foto Einbauten ${k}.png`, mimeType: 'image/png', buffer: await pngAusBrowser(page) }]);
  await page.waitForSelector('dialog[open] #dkf');
  pruef(await page.locator('#dok-upload li').count() === 2, 'A2-Dok: Mehrfachauswahl zeigt nicht beide Dateien');
  await page.selectOption('#dkf [name="kategorie"]', 'plaene');
  await page.fill('#dkf [name="tags"]', 'Einbauten');
  await dialogUeberlauf('dokumente hochladen'); await shot('dokumente-hochladen');
  await page.click('#dok-senden');
  await page.waitForSelector(`#dok-liste li:has-text("Lageplan ${k}")`);
  pruef(await page.locator('#dok-liste li').count() === 2 && await page.locator('.dok-kat-btn[data-kat="plaene"].on b').innerText() === '2', 'A2-Dok: Liste oder Zähler der Kategorie stimmen nicht');
  await toastWeg();
  // ungültige Datei wird abgelehnt (kein Upload)
  await page.setInputFiles('#dok-datei', { name: 'virus.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
  await page.waitForSelector('.toast');
  pruef(await page.locator('dialog[open] #dkf').count() === 0, 'A2-Dok: nicht erlaubter Dateityp öffnet den Hochlade-Dialog');
  await toastWeg();
  // finanzielles Dokument
  await page.setInputFiles('#dok-datei', pdfDatei(`Angebot ${k}.pdf`, 'Angebot 12.500'));
  await page.waitForSelector('dialog[open] #dkf');
  await page.selectOption('#dkf [name="kategorie"]', 'angebot');
  await page.click('#dok-senden');
  await page.waitForSelector(`#dok-liste li:has-text("Angebot ${k}")`);
  await toastWeg();
  // Dateien hereinziehen (Ablegen aus dem Explorer)
  await page.click('.dok-kat-btn[data-kat=""]');
  await page.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['%PDF-1.4\n%%EOF'], 'Gezogen.pdf', { type: 'application/pdf' })); document.querySelector('#dok-ablage').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); });
  await page.waitForSelector('dialog[open] #dkf');
  pruef(/gezogen/i.test(await page.locator('#dok-upload').innerText()), 'A2-Dok: Ablegen per Ziehen öffnet nicht den Hochlade-Dialog');
  await page.click('dialog[open] [data-zu]');
  // Suche
  await page.fill('#dok-suche', 'Einbauten');
  pruef(await page.locator('#dok-liste li').count() === 2, 'A2-Dok: Suche nach Stichwort findet nicht die zwei Dokumente');
  await page.fill('#dok-suche', `Lageplan ${k}`);
  pruef(await page.locator('#dok-liste li').count() === 1, 'A2-Dok: Suche nach Titel grenzt nicht ein');
  await ueberlauf('dokumente'); await shot('dokumente');
  // Vorschau PDF (abgeschotteter Rahmen), neue Version, Löschen und Wiederherstellen
  await page.click('#dok-liste [data-dok-auf]');
  await page.waitForSelector('dialog[open] #dok-dialog');
  pruef(await page.locator('#dok-pdf-oeffnen[target="_blank"]').count() === 1 && await page.locator('#dok-laden').count() === 1, 'A2-Dok: PDF lässt sich nicht öffnen/herunterladen');
  const pdfAntwort = await context.request.get(new URL(await page.locator('#dok-pdf-oeffnen').getAttribute('href'), page.url()).toString());
  pruef(pdfAntwort.ok() && /sandbox/.test(pdfAntwort.headers()['content-security-policy'] || '') && pdfAntwort.headers()['x-content-type-options'] === 'nosniff', 'A2-Dok: Datei wird nicht abgeschottet ausgeliefert (CSP sandbox, nosniff)');
  await dialogUeberlauf('dokument ansehen');
  await page.setInputFiles('#dok-version-datei', pdfDatei(`Lageplan ${k} v2.pdf`, 'Lageplan Stand 2'));
  await page.waitForSelector('#dok-versionen li[data-version="2"]');
  pruef(await page.locator('#dok-versionen li').count() === 2, 'A2-Dok: Versionsverlauf zeigt nicht beide Versionen');
  await shot('dokument-versionen');
  await page.click('#dok-weg');
  await page.waitForSelector('dialog[open] #dlf');
  await page.click('#dok-weg-ok');
  await page.waitForFunction((t) => ![...document.querySelectorAll('#dok-liste li')].some((li) => li.innerText.includes(t)), `Lageplan ${k}`);
  await toastWeg();
  await page.fill('#dok-suche', '');
  await page.check('#dok-geloescht');
  await page.waitForSelector('#dok-liste li.weg [data-dok-zurueck]');
  await page.click('#dok-liste li.weg [data-dok-zurueck]');
  await page.waitForFunction(() => !document.querySelector('#dok-liste li.weg'));
  await toastWeg();
  // Bild im Lichtkasten
  await page.locator(`#dok-liste li:has-text("Foto Einbauten ${k}") [data-dok-auf]`).click();
  await page.waitForSelector('dialog[open] #dok-vorschau-bild');
  pruef(await page.locator('#dok-vorschau-bild').evaluate((i) => new Promise((ok) => { if (i.complete) ok(i.naturalWidth > 0); else { i.onload = () => ok(true); i.onerror = () => ok(false); } })), 'A2-Dok: Bildvorschau lädt nicht');
  await page.click('dialog[open] [data-zu]');
  const docs = (await api('GET', `/baustellen/${W}/dokumente`)).json;
  const angebot = docs.find((d) => d.kategorie === 'angebot' && d.titel.includes(k));

  /* ---- Rechnungen ---- */
  await geh(`/baustelle/${W}?reiter=rechnungen`);
  await page.waitForSelector('#rechnungen');
  const rt = await h.text();
  pruef(/Rechnung erfassen/.test(rt) && !/Rechnung erstellen|Rechnung schreiben/i.test(rt) && await page.locator('#re-bmd').count() === 1, 'A2-Re: Wortlaut „Rechnung erfassen“ bzw. BMD-Import fehlt');
  await page.click('#re-neu');
  await page.waitForSelector('dialog[open] #ref');
  const nr = `RE-${k}-0001`;
  await page.fill('#ref [name="nr"]', nr);
  await page.fill('#ref [name="netto"]', '10.000,00');
  await page.fill('#ref [name="zahlungszielTage"]', '30');
  pruef((await page.locator('#re-faellig').innerText()).includes(plusTage(heute, 30).split('-').reverse().join('.')), `A2-Re: Fälligkeit nicht aus Datum + Zahlungsziel (${await page.locator('#re-faellig').innerText()})`);
  await page.check('#ref [name="ustModus"][value="reverse_charge"]');
  pruef(await page.locator('#rc-hinweis').isVisible() && (await page.locator('#re-zahlbetrag').innerText()).includes('10.000,00'), 'A2-Re: Reverse Charge ohne Hinweis oder mit Umsatzsteuer');
  await page.check('#ref [name="ustModus"][value="normal"]');
  await page.selectOption('#ref [name="ruecklassArt"]', 'haft'); await page.fill('#ref [name="ruecklassProzent"]', '5');
  await page.fill('#ref [name="skontoProzent"]', '3'); await page.fill('#ref [name="skontoTage"]', '14');
  pruef((await page.locator('#re-zahlbetrag').innerText()).includes('11.400,00'), `A2-Re: Zahlbetrag-Vorschau falsch (${await page.locator('#re-zahlbetrag').innerText()})`);
  await page.setInputFiles('#ref [name="pdf"]', pdfDatei(`${nr}.pdf`, nr));
  await dialogUeberlauf('rechnung erfassen'); await shot('rechnung-erfassen');
  await page.click('#re-ok');
  await page.waitForSelector(`#re-tabelle tr:has-text("${nr}")`);
  let re = (await api('GET', `/rechnungen?baustelleId=${W}`)).json.find((r) => r.nr === nr);
  pruef(re && re.brutto === 12000 && re.ruecklass === 600 && re.zahlbetrag === 11400 && re.faellig === plusTage(heute, 30) && !!re.dokumentId && re.status === 'offen', `A2-Re: Server rechnet anders (${JSON.stringify(re && { b: re.brutto, r: re.ruecklass, z: re.zahlbetrag, f: re.faellig, d: re.dokumentId, s: re.status })})`);
  await toastWeg();
  // doppelte Nummer → Fehler im Formular
  await page.click('#re-neu'); await page.waitForSelector('dialog[open] #ref');
  await page.fill('#ref [name="nr"]', nr); await page.fill('#ref [name="netto"]', '1,00');
  await h.absichtlich(async () => { await page.click('#re-ok'); await page.waitForSelector('#ref .form-err:not([hidden])'); });
  await page.click('dialog[open] [data-zu]');
  // Teilzahlung, Mahnstufe
  await page.locator(`#re-tabelle tr:has-text("${nr}")`).click();
  await page.waitForSelector('dialog[open] #re-detail');
  pruef(await page.locator('#re-pdf').count() === 1, 'A2-Re: Rechnungs-PDF nicht verknüpft');
  await page.click('#re-zahlung');
  await page.waitForSelector('dialog[open] #zaf');
  pruef(await page.locator('#zaf [name="betrag"]').inputValue() === '11.400,00', 'A2-Re: Zahlung nicht mit dem offenen Betrag vorbelegt');
  await page.fill('#zaf [name="betrag"]', '5.000,00');
  await dialogUeberlauf('zahlung');
  await page.click('#za-ok');
  await page.waitForSelector('#re-detail [data-r-status="teilbezahlt"]');
  // nach der Zahlung öffnet sich die Rechnung neu – kurz können der alte und der neue Dialog nebeneinander stehen
  await page.waitForFunction(() => document.querySelectorAll('#re-detail').length === 1 && /6\.400,00/.test(document.querySelector('#re-detail [data-wert="offen"]').textContent), null, { timeout: 8000 }).catch(() => {});
  pruef((await page.locator('#re-detail [data-wert="offen"]').last().innerText()).includes('6.400,00') && await page.locator('#re-zahlungen li').last().count() === 1, 'A2-Re: Teilzahlung nicht verbucht');
  await toastWeg();
  await page.click('#re-mahnung');
  await page.waitForSelector('dialog[open] [data-ok]'); await page.locator('dialog[open] [data-ok]').last().click();
  await page.waitForSelector('#re-detail [data-mahnstufe="1"]');
  await dialogUeberlauf('rechnung detail'); await shot('rechnung-detail');
  await page.locator('dialog[open] .dlg-head button, dialog[open] [data-zu]').first().click().catch(() => {});
  await page.keyboard.press('Escape');
  await toastWeg();
  pruef((await page.locator('#re-summen [data-summe="offen"]').innerText()).includes('6.400,00') && (await page.locator('#re-summen [data-summe="ruecklass"]').innerText()).includes('600,00'), 'A2-Re: Summen (offen, Rücklass) stimmen nicht');
  await ueberlauf('rechnungen'); await shot('rechnungen');
  // überfällige Rechnung (über die Schnittstelle) → Offene Posten
  const nr2 = `RE-${k}-0002`;
  const alt = await api('POST', `/baustellen/${W}/rechnungen`, { typ: 'teil', nr: nr2, datum: plusTage(heute, -60), netto: 2000, ustModus: 'normal', zahlungszielTage: 14 });
  pruef(alt.status === 201, `A2-Re: zweite Rechnung → ${alt.status}`);
  await geh('/offene-posten');
  await page.waitForSelector('#offene-posten #re-tabelle');
  const op = (await api('GET', '/offene-posten')).json;
  pruef((await page.locator('[data-kpi="offen"] b').innerText()).includes(eur(op.summeOffen)) && (await page.locator('[data-kpi="ueberfaellig"] b').innerText()).includes(eur(op.summeUeberfaellig)), 'A2-Re: Kennzahlen der offenen Posten weichen vom Server ab');
  pruef(/überfällig 46 Tage/.test(await page.locator(`#re-tabelle tr:has-text("${nr2}")`).innerText()), `A2-Re: „überfällig x Tage“ fehlt (${(await page.locator(`#re-tabelle tr:has-text("${nr2}")`).innerText()).replace(/\s+/g, ' ')})`);
  await page.click('[data-op-filter="ueberfaellig"]');
  pruef(await page.locator(`#re-tabelle tr:has-text("${nr}")`).count() === 0 && await page.locator(`#re-tabelle tr:has-text("${nr2}")`).count() === 1, 'A2-Re: Filter „Überfällig“ wirkt nicht');
  await page.click('[data-op-filter=""]');
  await page.fill('#op-suche', nr);
  pruef(await page.locator('#re-tabelle tbody tr').count() === 1, 'A2-Re: Suche in den offenen Posten wirkt nicht');
  const csv = await context.request.get(h.srv.url + '/api/offene-posten.csv');
  const csvText = (await csv.body()).toString('utf8');
  pruef(csv.ok() && csvText.includes(nr2) && csvText.includes(';'), `A2-Re: CSV-Export der offenen Posten → ${csv.status()}`);
  pruef(await page.locator('#op-auftraggeber li').count() >= 1 && await page.locator('#op-ruecklaesse li').count() >= 1, 'A2-Re: Listen je Auftraggeber / Rücklässe fehlen');
  await ueberlauf('offene posten'); await shot('offene-posten');
  // G-04: Datei mit einer fehlerhaften Zeile → Vorschau zeigt den Fehler, „Übernehmen“ ist gesperrt, nichts wird gebucht, keine Erfolgsmeldung
  await page.fill('#op-suche', '');
  await page.click('#op-bmd');
  await page.waitForSelector('dialog[open] #imp-datei');
  await page.setInputFiles('#imp-datei', { name: 'op-fehler.csv', mimeType: 'text/csv', buffer: Buffer.from(`Belegnr;Datum;Kunde;Offen\n${nr};12.11.2026;Testkunde;1400,00\n${nr2};12.11.2026;Testkunde;kaputt\n`, 'utf8') });
  await page.click('#imp-weiter1');
  await page.waitForSelector('#imp2');
  await page.selectOption('#imp2 [name="trennzeichen"]', ';'); await page.selectOption('#imp2 [name="kodierung"]', 'utf-8'); await page.selectOption('#imp2 [name="dezimal"]', ','); await page.selectOption('#imp2 [name="datumFormat"]', 'TT.MM.JJJJ'); await page.check('#imp2 [name="kopfzeile"]');
  for (const [f, w] of [['belegnr', 'Belegnr'], ['datum', 'Datum'], ['offen', 'Offen'], ['kunde', 'Kunde'], ['netto', ''], ['brutto', ''], ['faellig', ''], ['bezahlt', ''], ['zahlungsdatum', '']]) await page.fill(`#imp2 [name="sp_${f}"]`, w);
  await page.click('#imp-weiter2');
  await page.waitForSelector('#imp-vorschau');
  pruef(await page.locator('#imp-fehler li').count() >= 1 && await page.locator('#imp-ok').isDisabled() && /nichts übernommen/i.test(await page.locator('#imp-vorschau').innerText()), `A2-G04: Fehlerzeile sperrt „Übernehmen“ nicht (${(await page.locator('#imp-vorschau').innerText()).replace(/\s+/g, ' ').slice(0, 160)})`);
  const direkt = await h.absichtlich(() => api('POST', '/import/bmd-op', { dateiBase64: Buffer.from(`Belegnr;Datum;Kunde;Offen\n${nr};12.11.2026;Testkunde;1400,00\n${nr2};12.11.2026;Testkunde;kaputt\n`).toString('base64'), dateiname: 'op-fehler.csv', vorschau: false }));
  pruef((direkt.status === 400 || direkt.json.uebernommen === false) && (await api('GET', `/rechnungen/${re.id}`)).json.offen === 6400, `A2-G04: Datei mit Fehlerzeile wurde (teilweise) gebucht (${direkt.status})`);
  pruef(!/aktualisiert/.test(await page.locator('#imp-assistent').innerText()) && await page.locator('#imp-fertig').count() === 0, 'A2-G04: Erfolgsmeldung, obwohl nichts übernommen wurde');
  await dialogUeberlauf('bmd fehlerzeile'); await shot('bmd-fehlerzeile');
  await page.click('dialog[open] [data-zu]');
  // BMD: Offene Posten importieren – Datei → Spalten zuordnen → Vorschau → übernehmen
  await page.click('#op-bmd');
  await page.waitForSelector('dialog[open] #imp-datei');
  await page.setInputFiles('#imp-datei', { name: 'op-liste.csv', mimeType: 'text/csv', buffer: Buffer.from(`Belegnr;Datum;Kunde;Offen\n${nr};12.11.2026;Testkunde;1400,00\nRE-FREMD-9;01.11.2026;Fremd GmbH;500,00\n`, 'utf8') });
  await page.click('#imp-weiter1');
  await page.waitForSelector('#imp2');
  pruef(/Belegnr/.test(await page.locator('#imp2').innerText()), 'A2-BMD: Spaltenüberschriften der Datei werden nicht angeboten');
  await page.selectOption('#imp2 [name="trennzeichen"]', ';'); await page.selectOption('#imp2 [name="kodierung"]', 'utf-8'); await page.selectOption('#imp2 [name="dezimal"]', ','); await page.selectOption('#imp2 [name="datumFormat"]', 'TT.MM.JJJJ'); await page.check('#imp2 [name="kopfzeile"]');
  for (const [f, w] of [['belegnr', 'Belegnr'], ['datum', 'Datum'], ['offen', 'Offen'], ['kunde', 'Kunde'], ['netto', ''], ['brutto', ''], ['faellig', ''], ['bezahlt', ''], ['zahlungsdatum', '']]) await page.fill(`#imp2 [name="sp_${f}"]`, w);
  await dialogUeberlauf('bmd zuordnung'); await shot('bmd-zuordnung');
  await page.click('#imp-weiter2');
  await page.waitForSelector('#imp-vorschau');
  pruef(await page.locator('[data-imp-zugeordnet="1"]').count() === 1 && await page.locator('[data-imp-unbekannt="1"]').count() === 1 && /RE-FREMD-9/.test(await page.locator('#imp-unbekannt').innerText()), `A2-BMD: Vorschau (1 zugeordnet, 1 unbekannt) falsch: ${(await page.locator('#imp-vorschau').innerText()).replace(/\s+/g, ' ').slice(0, 200)}`);
  pruef((await api('GET', `/rechnungen/${re.id}`)).json.offen === 6400, 'A2-BMD: Vorschau hat schon gebucht');
  // N-024/N-095: Spalte „Änderung“ als Text (nicht „true“), mit dem zu buchenden Betrag
  { const t = (await page.locator('#imp-zugeordnet').innerText()).replace(/\s+/g, ' '); pruef(!/\btrue\b|\bfalse\b/.test(t) && /Zahlung (€\s*)?5\.000,00 wird gebucht/.test(t), `A2-BMD: Vorschau zeigt die Änderung nicht lesbar (${t.slice(0, 200)})`); }
  await dialogUeberlauf('bmd vorschau'); await shot('bmd-vorschau');
  await page.click('#imp-ok');
  await page.waitForSelector('#imp-fertig', { timeout: 6000 }).catch(async () => pruef(false, `A2-BMD: Übernehmen scheitert: ${(await page.locator('#imp-assistent').innerText()).replace(/\s+/g, ' ').slice(-260)}`));
  pruef(/1 Rechnung aktualisiert/.test(await page.locator('#imp-fertig').innerText()), `A2-BMD: Erfolgsmeldung zählt falsch (${(await page.locator('#imp-assistent').innerText()).replace(/\s+/g, ' ').slice(-160)})`);
  re = (await api('GET', `/rechnungen/${re.id}`)).json;
  pruef(re.offen === 1400 && (re.zahlungen || []).some((x) => x.quelle === 'bmd' || x.betrag === 5000), `A2-BMD: offener Betrag nach Import ${re.offen} statt 1400`);
  pruef((await api('GET', '/import/bmd-op/zuordnung')).json.spalten.belegnr === 'Belegnr', 'A2-BMD: Zuordnung wurde nicht gespeichert');
  await page.click('dialog[open] [data-zu]'); await toastWeg();
  // Auer Success: Leistungsverzeichnis (Excel/CSV-Export) → Soll-Positionen
  await geh(`/baustelle/${W}`);
  await page.click('#lv-import');
  await page.waitForSelector('dialog[open] #imp-datei');
  await page.setInputFiles('#imp-datei', { name: 'lv.csv', mimeType: 'text/csv', buffer: Buffer.from('OZ;Kurztext;Einheit;Menge;EP;GP\n01.01;Aushub;m3;120;18,50;2220,00\n01.02;Pflaster verlegen;m2;300;42,00;12600,00\n', 'utf8') });
  await page.click('#imp-weiter1');
  await page.waitForSelector('#imp2');
  await page.selectOption('#imp2 [name="trennzeichen"]', ';'); await page.selectOption('#imp2 [name="dezimal"]', ',');
  for (const [f, w] of [['oz', 'OZ'], ['kurztext', 'Kurztext'], ['einheit', 'Einheit'], ['menge', 'Menge'], ['ep', 'EP'], ['gp', 'GP']]) await page.fill(`#imp2 [name="sp_${f}"]`, w);
  await page.click('#imp-weiter2');
  await page.waitForSelector('#imp-vorschau');
  pruef(await page.locator('[data-imp-positionen="2"]').count() === 1 && /14\.820,00/.test(await page.locator('#imp-vorschau').innerText()), `A2-LV: Vorschau (2 Positionen, Summe 14.820,00) falsch: ${(await page.locator('#imp-vorschau').innerText()).replace(/\s+/g, ' ').slice(0, 160)}`);
  await dialogUeberlauf('lv vorschau'); await shot('lv-vorschau');
  await page.click('#imp-ok');
  // nach der Übernahme lädt die Baustelle neu (der Assistent schließt sich) und zeigt den neuen Stand
  await page.waitForSelector('#lv-stand:has-text("2 Positionen")');
  await page.locator('dialog[open] [data-zu]').first().click().catch(() => {});
  await toastWeg();
  await page.click('#lv-zeigen');
  await page.waitForSelector('dialog[open] #lv-tabelle');
  pruef(await page.locator('#lv-tabelle tbody tr').count() === 2 && await page.locator('#lv-tabelle [data-lv-zu]').count() === 2, 'A2-LV: Positionen oder Zuordnung zur Nachkalkulation fehlen');
  await page.locator('#lv-tabelle [data-lv-zu]').first().selectOption({ index: 1 });
  await toastWeg();
  await page.click('dialog[open] [data-zu]');
  await geh(`/kalkulation/${W}/positionen`);
  pruef(await page.locator('[data-soll]').count() === 1, 'A2-LV: Soll laut LV fehlt in der Nachkalkulation');
  // BMD-Lohn: Vorlage ansehen, Lohnart ändern, Export
  const monatL = heute.slice(0, 7);
  await geh('/monat');
  pruef(await page.locator('#lohn-vorlagen-link').count() === 1, 'A2-Lohn: Verweis auf die Export-Vorlagen fehlt');
  await geh(`/lohn-vorlagen?monat=${monatL}`);
  await page.waitForSelector('#lohn-vorlagen li');
  await page.locator('#lohn-vorlagen [data-edit]').first().click();
  await page.waitForSelector('dialog[open] #lvf');
  pruef(await page.locator('#lv-spalten li').count() >= 3 && await page.locator('#lv-lohnarten input').count() === 8, 'A2-Lohn: Spalten oder Lohnarten der Vorlage fehlen');
  await page.fill('#lvf [name="la_normal"]', '1000');
  await dialogUeberlauf('lohn vorlage'); await shot('lohn-vorlage');
  await page.click('dialog[open] button[type="submit"]');
  await page.waitForFunction(() => !document.querySelector('dialog[open] #lvf'));
  const vorl = (await api('GET', '/lohn-vorlagen')).json[0];
  pruef(String(vorl.lohnarten.normal) === '1000', 'A2-Lohn: Lohnart-Nummer nicht gespeichert');
  const lcsv = await context.request.get(h.srv.url + (await page.locator('#lohn-vorlagen [data-export]').first().getAttribute('href')));
  pruef(lcsv.ok() && (await lcsv.body()).toString('latin1').includes('1000'), `A2-Lohn: Export mit Vorlage → ${lcsv.status()}`);
  await ueberlauf('lohn vorlagen'); await toastWeg();
  await geh('/dashboard');
  pruef(await page.locator('#bv-kacheln [data-kpi="offene-posten"]').count() === 1 && (await page.locator('#bv-kacheln [data-kpi="offene-posten"]').innerText()).includes('überfällig'), 'A2-Re: Kachel „Offene Posten“ mit Überfälligen fehlt');
  await geh(`/baustelle/${W}`);
  pruef(await page.locator('[data-wert="verrechnet"]').count() === 1 && (await page.locator('[data-wert="verrechnet"]').innerText()).includes('12.000,00'), 'A2-Re: Nachkalkulation zeigt „verrechnet“ nicht');
  await abmelden();

  /* ---- Geschäftsführung: eigene Dokument-Kategorien (eine für den Polier lesbar, eine finanzielle) ---- */
  await anmelden('gf');
  await geh(`/baustelle/${W}?reiter=dokumente`);
  await page.waitForSelector('#dok-kat-neu');
  const neueKat = async (name, finanziell, polier) => {
    await page.click('#dok-kat-neu');
    await page.waitForSelector('dialog[open] #dkk');
    await page.fill('#dkk [name="name"]', name);
    if (finanziell) { await page.check('#dkk [name="finanziell"]'); pruef(await page.locator('#dkk [name="polier"]').isDisabled(), 'A2-Dok: finanzielle Kategorie lässt sich für den Polier freigeben'); }
    if (polier) await page.check('#dkk [name="polier"]');
    await dialogUeberlauf('dokument kategorie');
    await page.click('#dkk-ok');
    await page.waitForSelector(`.dok-kat-btn:has-text("${name}")`);
    await toastWeg();
  };
  await neueKat(`Vermessung ${k}`, false, true);
  await neueKat(`Kalkulation ${k}`, true, false);
  const katListe = (await api('GET', '/dokument-kategorien')).json;
  const kVerm = katListe.find((x) => x.name === `Vermessung ${k}`), kKalk = katListe.find((x) => x.name === `Kalkulation ${k}`);
  pruef(kVerm && kVerm.eigen && kVerm.polier && !kVerm.finanziell && kKalk && kKalk.finanziell && !kKalk.polier, `A2-Dok: eigene Kategorien falsch gespeichert (${JSON.stringify([kVerm, kKalk])})`);
  await page.click('#dok-kat-neu'); await page.waitForSelector('dialog[open] #dkk');
  await page.fill('#dkk [name="name"]', `Vermessung ${k}`);
  await h.absichtlich(async () => { await page.click('#dkk-ok'); await page.waitForSelector('#dkk .form-err:not([hidden])'); });
  // N-099: gleicher Name wie eine eingebaute Kategorie (andere Schreibweise) → abgelehnt, nichts angelegt
  await page.fill('#dkk [name="name"]', 'pläne');
  await h.absichtlich(async () => { await page.click('#dkk-ok'); await page.waitForFunction(() => /bereits/.test((document.querySelector('#dkk .form-err') || {}).textContent || '')); });
  pruef((await api('GET', '/dokument-kategorien')).json.filter((x) => x.name.toLowerCase() === 'pläne').length === 1, 'A2-Dok: zweite Kategorie „Pläne“ angelegt');
  await page.click('dialog[open] [data-zu]');
  // N-099: Zähler und Bearbeiten-Stift überlappen nicht
  {
    const ueberlapp = await page.evaluate(() => [...document.querySelectorAll('.dok-kat-zeile')].filter((z) => {
      const a = z.querySelector('.dok-kat-btn b').getBoundingClientRect(), b = z.querySelector('.dok-kat-edit').getBoundingClientRect();
      return a.width && b.width && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    }).map((z) => z.querySelector('[data-kat]').dataset.kat));
    pruef(ueberlapp.length === 0, `A2-Dok: Zähler und Bearbeiten-Stift überlappen (${ueberlapp.join(', ')})`);
  }
  // N-104: „enthält Preise“ abschalten, solange Dokumente darin liegen → Rückfrage; Abbrechen ändert nichts
  pruef((await api('POST', `/baustellen/${W}/dokumente`, { kategorie: kKalk.schluessel, titel: `Kalkulation intern ${k}`, dateiBase64: PDF('Kalkulation').toString('base64'), dateiname: 'kalk.pdf' })).status === 201, 'A2-Dok: Dokument in finanzieller eigener Kategorie nicht ablegbar');
  await page.click(`[data-kat-edit="${kKalk.schluessel}"]`);
  await page.waitForSelector('dialog[open] #dkk');
  await page.uncheck('#dkk [name="finanziell"]');
  await h.absichtlich(async () => { // 409 mit Rückfrage ist gewollt
    await page.click('#dkk-ok');
    await page.waitForFunction(() => [...document.querySelectorAll('dialog[open] p')].some((p) => /bisher nur mit Preisrecht sichtbar/.test(p.textContent)));
  });
  await page.locator('dialog[open] [data-zu]').last().click();
  await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 1);
  pruef((await api('GET', '/dokument-kategorien')).json.find((x) => x.schluessel === kKalk.schluessel).finanziell === true, 'A2-Dok: „enthält Preise“ ohne Bestätigung abgeschaltet');
  await page.click('dialog[open] [data-zu]');
  // Bearbeiten/Löschen: eigene umbenennen, eingebaute nur umbenennen, löschen nur wenn leer
  await page.click(`[data-kat-edit="${kVerm.schluessel}"]`);
  await page.waitForSelector('dialog[open] #dkk');
  pruef(await page.locator('#dkk [name="polier"]').isChecked() && await page.locator('#dkk-weg').count() === 1, 'A2-Dok: Bearbeiten einer eigenen Kategorie ohne Rechte-Felder oder Löschen');
  await page.fill('#dkk [name="name"]', `Vermessung ${k} neu`);
  await page.click('#dkk-ok');
  await page.waitForSelector(`.dok-kat-btn:has-text("Vermessung ${k} neu")`);
  await toastWeg();
  await page.click('[data-kat-edit="plaene"]');
  await page.waitForSelector('dialog[open] #dkk');
  pruef(await page.locator('#dkk [name="finanziell"], #dkk [name="polier"], #dkk-weg').count() === 0 && await page.locator('#dkk [name="name"]').count() === 1, 'A2-Dok: eingebaute Kategorie lässt mehr als Umbenennen zu');
  await page.click('dialog[open] [data-zu]');
  await neueKat(`Leer ${k}`, false, false);
  const kLeer = (await api('GET', '/dokument-kategorien')).json.find((x) => x.name === `Leer ${k}`);
  await page.click(`[data-kat-edit="${kLeer.schluessel}"]`);
  await page.waitForSelector('dialog[open] #dkk-weg');
  await page.click('#dkk-weg');
  await page.waitForSelector('dialog[open] [data-ok]'); await page.locator('dialog[open] [data-ok]').last().click();
  await page.waitForFunction((n) => ![...document.querySelectorAll('.dok-kat-btn')].some((b) => b.innerText.includes(n)), `Leer ${k}`);
  await toastWeg();
  // nicht leer → Löschen wird abgelehnt und erklärt
  pruef((await api('POST', `/baustellen/${W}/dokumente`, { kategorie: kVerm.schluessel, titel: `Absteckplan ${k}`, dateiBase64: PDF('Absteckplan').toString('base64'), dateiname: 'absteckplan.pdf' })).status === 201, 'A2-Dok: Dokument in eigener Kategorie nicht ablegbar');
  await page.click(`[data-kat-edit="${kVerm.schluessel}"]`);
  await page.waitForSelector('dialog[open] #dkk-weg');
  await page.click('#dkk-weg');
  await page.waitForSelector('dialog[open] [data-ok]');
  await h.absichtlich(async () => { await page.locator('dialog[open] [data-ok]').last().click(); await page.waitForSelector('#dkk .form-err:not([hidden])'); });
  pruef(/noch Dokumente/.test(await page.locator('#dkk .form-err').innerText()) && (await api('GET', '/dokument-kategorien')).json.some((x) => x.schluessel === kVerm.schluessel), 'A2-Dok: nicht leere Kategorie wurde gelöscht oder ohne Erklärung abgelehnt');
  await dialogUeberlauf('kategorie bearbeiten');
  await page.click('dialog[open] [data-zu]');
  await ueberlauf('dokumente kategorien'); await shot('dokumente-kategorien');
  await abmelden();

  /* ---- Polier: Dokumente nur lesen, keine finanziellen, keine Rechnungen ---- */
  await anmelden('polier');
  await geh(`/baustelle/${W}?reiter=dokumente`);
  await page.waitForSelector('#dokumente');
  pruef(await page.locator('.dok-kat-btn[data-kat="plaene"]').count() === 1 && await page.locator('.dok-kat-btn[data-kat="angebot"], .dok-kat-btn[data-kat="ausgangsrechnungen"]').count() === 0, 'A2-Dok: Polier sieht finanzielle Kategorien oder keine Pläne');
  pruef(await page.locator(`.dok-kat-btn:has-text("Vermessung ${k}")`).count() === 1 && await page.locator(`.dok-kat-btn:has-text("Kalkulation ${k}")`).count() === 0 && await page.locator('#dok-kat-neu').count() === 0, 'A2-Dok: eigene Kategorien nicht nach den Regeln sichtbar (Polier: lesbare ja, finanzielle nein)');
  pruef(await page.locator('#dok-nur-lesen').count() === 1 && await page.locator('#dok-neu, #dok-ablage').count() === 0, 'A2-Dok: Polier kann hochladen');
  pruef(await page.locator(`#dok-liste li:has-text("Lageplan ${k}")`).count() === 1 && await page.locator(`#dok-liste li:has-text("Angebot ${k}"), #dok-liste li:has-text("${nr}")`).count() === 0, 'A2-Dok: Polier sieht den Plan nicht oder sieht Angebot/Rechnung');
  await page.locator(`#dok-liste li:has-text("Lageplan ${k}") [data-dok-auf]`).click();
  await page.waitForSelector('dialog[open] #dok-dialog');
  pruef(await page.locator('#dok-weg, #dmf, #dok-version-neu').count() === 0, 'A2-Dok: Polier kann bearbeiten oder löschen');
  await page.click('dialog[open] [data-zu]');
  await keinEuro('polier dokumente'); await ueberlauf('polier dokumente'); await shot('dokumente-polier');
  if (angebot) pruef((await h.absichtlich(() => api('GET', `/baustellen/${W}/dokumente/${angebot.id}`))).status === 403, 'A2-Dok: Polier kann ein finanzielles Dokument direkt abrufen');
  pruef((await h.absichtlich(() => api('GET', `/rechnungen?baustelleId=${W}`))).status === 403, 'A2-Re: Polier kann Rechnungen abrufen');
  await h.keinZugriff('/offene-posten');
  await abmelden();
}

/* ================= Urlaubsübersicht, Urlaubskonto (12.19) und Zeitraum-Anträge (12.24) ================= */
async function urlaub(h, z) {
  const { page, api, geh, pruef, keinEuro, ueberlauf, dialogUeberlauf, shot, g, anmelden, abmelden, toastWeg } = h;
  const heute = h.heute();
  // Montag in gut zwei Wochen bis zum Montag darauf: Mo–Fr + Wochenende + Mo = 6 Arbeitstage
  const von = (() => { let t = plusTage(heute, 16); while (new Date(t + 'T12:00:00Z').getUTCDay() !== 1) t = plusTage(t, 1); return t; })();
  const bis = plusTage(von, 7);
  const zaTag = plusTage(von, 9); // Mittwoch der Folgewoche: zweiter Antrag (wird abgelehnt)
  const monat = von.slice(0, 7), jahr = Number(von.slice(0, 4));
  const kurz = (iso) => `${iso.slice(8)}.${iso.slice(5, 7)}.`;
  const stelle = async (v, b, code, notiz) => {
    await page.waitForSelector('dialog[open] #uaf');
    await page.fill('#uaf [name="von"]', v);
    pruef(await page.locator('#uaf [name="bis"]').inputValue() >= v, 'A2-Url: „Bis“ folgt nicht dem „Von“');
    await page.fill('#uaf [name="bis"]', b); await page.locator('#uaf [name="bis"]').dispatchEvent('change');
    await page.selectOption('#uaf [name="code"]', code);
    if (notiz) await page.fill('#uaf [name="notiz"]', notiz);
  };

  /* ---- Mitarbeiter: ein Antrag von–bis mit Vorschau, zweiter Antrag, dritter wird zurückgezogen ---- */
  const ichM = await anmelden('mitarbeiter');
  const L = ichM.benutzer.id, name = ichM.benutzer.name;
  await geh(`/urlaub?monat=${monat}`);
  const oeffne = async () => { await page.waitForSelector('#ur-antrag'); await page.click('#ur-antrag'); };
  if (!g.mobil) { await page.waitForSelector('#ur-kalender'); pruef(await page.locator('#ur-kalender tr[data-person]').count() === 1, 'A2-Url: Mitarbeiter sieht im Kalender andere Personen'); }
  await oeffne(von);
  await page.waitForSelector('dialog[open] #uaf');
  pruef((await page.locator('#uaf [name="code"] option').evaluateAll((o) => o.map((x) => x.value))).join() === 'U,ZA', 'A2-Url: Mitarbeiter kann anderes als Urlaub/Zeitausgleich beantragen');
  await stelle(von, bis, 'U', 'Familienurlaub');
  await page.waitForSelector('#zr-vorschau[data-arbeitstage="6"]');
  const vt = (await page.locator('#zr-vorschau').innerText()).replace(/\s+/g, ' ');
  pruef(/6 Arbeitstage/.test(vt) && /Wochenende und Feiertage zählen nicht/.test(vt), `A2-Url: Vorschau zeigt nicht „6 Arbeitstage“ (${vt.slice(0, 120)})`);
  const probe = (await api('POST', '/abwesenheiten/zeitraum', { benutzerId: L, von, bis, code: 'U', vorschau: true })).json;
  pruef(probe.arbeitstage === 6 && probe.antragId === null && (!probe.konto || probe.konto.restNachAntrag == null || vt.includes(String(probe.konto.restNachAntrag).replace('.', ','))), `A2-Url: Vorschau weicht vom Server ab (${JSON.stringify(probe).slice(0, 160)})`);
  await dialogUeberlauf('urlaub von-bis'); await shot('urlaub-von-bis');
  await page.click('#ua-ok');
  await page.waitForSelector(`#ur-meine [data-antrag][data-status="beantragt"]:has-text("${kurz(von)}")`);
  const tage1 = (await api('GET', `/abwesenheiten?von=${von}&bis=${bis}`)).json.filter((a) => a.benutzerId === L);
  pruef(tage1.length === 6 && tage1.every((a) => a.status === 'beantragt' && a.code === 'U') && new Set(tage1.map((a) => a.antragId)).size === 1, `A2-Url: Antrag nicht als ein Antrag mit 6 Arbeitstagen gespeichert (${tage1.length} Tage, ${[...new Set(tage1.map((a) => a.antragId))].length} Anträge)`);
  const antrag1 = tage1[0] && tage1[0].antragId;
  pruef(/6 Arbeitstage/.test(await page.locator(`#ur-meine [data-antrag="${antrag1}"]`).innerText()) && await page.locator(`#ur-meine [data-antrag="${antrag1}"] [data-antrag-zurueck]`).count() === 1, 'A2-Url: „Meine Anträge“ zeigt den Antrag nicht gruppiert mit „zurückziehen“');
  await toastWeg();
  // zweiter Antrag (ein Tag Zeitausgleich) – wird später abgelehnt
  await oeffne(zaTag); await stelle(zaTag, zaTag, 'ZA');
  await page.waitForSelector('#zr-vorschau[data-arbeitstage="1"]');
  await page.click('#ua-ok');
  await page.waitForSelector(`#ur-meine [data-antrag]:has-text("${kurz(zaTag)}")`);
  await toastWeg();
  // dritter Antrag: zurückziehen, solange er offen ist
  const weg = plusTage(von, 10);
  await oeffne(weg); await stelle(weg, weg, 'U');
  await page.waitForSelector('#zr-vorschau[data-arbeitstage="1"]');
  await page.click('#ua-ok');
  const zWeg = page.locator(`#ur-meine [data-antrag]:has-text("${kurz(weg)}")`);
  await zWeg.waitFor(); await toastWeg();
  await zWeg.locator('[data-antrag-zurueck]').click();
  await page.waitForSelector('dialog[open] [data-ok]'); await page.locator('dialog[open] [data-ok]').last().click();
  await page.waitForFunction((t) => ![...document.querySelectorAll('#ur-meine [data-antrag]')].some((li) => li.innerText.includes(t)), kurz(weg));
  pruef((await api('GET', `/abwesenheiten?von=${weg}&bis=${weg}`)).json.filter((a) => a.benutzerId === L).length === 0, 'A2-Url: zurückgezogener Antrag ist noch gespeichert');
  await toastWeg();
  // dieselbe Eingabe von der Seite „Abwesenheiten“ (Von–Bis statt einzelner Tag)
  await geh('/abwesenheiten');
  // N-047: zurückgezogen wird nur der ganze Antrag – ein Knopf für den 6-Tage-Antrag, die übrigen Tage verweisen darauf
  await page.waitForSelector('#abw-eigene');
  pruef(await page.locator(`#abw-eigene [data-zurueckziehen][data-antrag-id="${antrag1}"]`).count() === 1 && await page.locator(`#abw-eigene [data-zurueckziehen][data-antrag-id="${antrag1}"][data-tage="6"]`).count() === 1 && await page.locator('#abw-eigene [data-teil-antrag]').count() >= 5, 'A2-Url: „Abwesenheiten“ bietet „Zurückziehen“ je Tag statt je Antrag');
  await page.click('[data-akt="antrag"]');
  await page.waitForSelector('dialog[open] #abw-f');
  pruef(await page.locator('#abw-f [name="von"]').count() === 1 && await page.locator('#abw-f [name="bis"]').count() === 1 && await page.locator('#abw-f [name="notiz"]').count() === 1 && await page.locator('#zr-vorschau').count() === 1, 'A2-Url: „Abwesenheiten“ hat nicht den Von–Bis-Dialog');
  await dialogUeberlauf('abwesenheiten von-bis');
  await page.click('dialog[open] [data-zu]');
  await keinEuro('urlaub mitarbeiter'); await ueberlauf('urlaub mitarbeiter'); await shot('urlaub-mitarbeiter');
  await abmelden();

  /* ---- Büro: genau eine Meldung, ganzer Antrag mit einem Klick, keine Tages-Entscheidung, Korrektur, Ablehnen ---- */
  await anmelden('buero');
  const meld = (await api('GET', '/benachrichtigungen')).json.filter((n) => `${n.titel} ${n.text}`.includes(name) && `${n.titel} ${n.text}`.includes(kurz(von)));
  pruef(meld.length === 1 && /6 Arbeitstage/.test(`${meld[0].titel} ${meld[0].text}`), `A2-Url: nicht genau eine Benachrichtigung zum Antrag (${meld.length})`);
  const kontoVor = (await api('GET', `/urlaub/konto?jahr=${jahr}&benutzerId=${L}`)).json[0];
  // „Abwesenheiten“: Tage des mehrtägigen Antrags nur mit Verweis „als Ganzes entscheiden“, der eintägige ZA-Antrag mit Genehmigen/Ablehnen (N-086)
  await geh('/abwesenheiten');
  await page.waitForSelector('#abw-offen');
  const tageAbw = (await api('GET', `/abwesenheiten?von=${von}&bis=${bis}`)).json.filter((a) => a.benutzerId === L && a.antragId === antrag1);
  const tagFehler = [];
  for (const a of tageAbw) {
    const li = page.locator(`#abw-offen li[data-abw="${a.id}"]`);
    const link = li.locator('a[data-zum-antrag]');
    if (await li.count() !== 1 || await li.locator('[data-entscheid]').count() !== 0 || await link.count() !== 1
      || !/Teil eines Antrags \(6 Tage\) – als Ganzes entscheiden/.test(await link.innerText()) || await link.getAttribute('href') !== `#/urlaub?monat=${a.datum.slice(0, 7)}`) tagFehler.push(a.datum);
  }
  pruef(tageAbw.length === 6 && !tagFehler.length, `A2-Url: „Abwesenheiten“ bietet für Tage eines mehrtägigen Antrags Einzelentscheidung statt „als Ganzes entscheiden“ (${tageAbw.length} Tage, falsch: ${tagFehler.join(', ')})`);
  const zaAbw = (await api('GET', `/abwesenheiten?von=${zaTag}&bis=${zaTag}`)).json.find((a) => a.benutzerId === L);
  const zaLi = page.locator(`#abw-offen li[data-abw="${zaAbw && zaAbw.id}"]`);
  pruef(zaAbw && await zaLi.locator('[data-entscheid="genehmigt"]').count() === 1 && await zaLi.locator('[data-entscheid="abgelehnt"]').count() === 1 && await zaLi.locator('[data-zum-antrag]').count() === 0, 'A2-Url: eintägiger Antrag auf „Abwesenheiten“ ohne Genehmigen/Ablehnen');
  await geh(`/urlaub?monat=${monat}`);
  const liste = g.mobil ? '#ur-partie' : '#ur-antraege';
  await page.waitForSelector(`${liste} [data-antrag="${antrag1}"]`);
  const z1 = page.locator(`${liste} [data-antrag="${antrag1}"]`).first();
  pruef(new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · Urlaub · .*${kurz(von).replace(/\./g, '\\.')}.*${kurz(bis).replace(/\./g, '\\.')}`).test((await z1.innerText()).replace(/\s+/g, ' ')) && /6 Arbeitstage/.test(await z1.innerText()), `A2-Url: Antrag nicht gruppiert dargestellt (${(await z1.innerText()).replace(/\s+/g, ' ').slice(0, 120)})`);
  // Entschieden wird nur über die zwei Knöpfe des ganzen Antrags; die Tagesliste ist reine Ansicht (N-086: Selektoren an tatsächlich gerenderte Elemente geknüpft)
  pruef(await z1.locator('[data-antrag-entscheid]').count() === 2 && await z1.locator('.an-tage li[data-tag]').count() === 6 && await z1.locator('.an-tage li[data-tag] :is(button, a, input, select)').count() === 0, 'A2-Url: Antrag ohne genau einen Genehmigen/Ablehnen-Satz oder Tagesliste mit Bedienelementen');
  pruef(await page.locator('#view button:not([data-antrag-entscheid]), #view a:not([data-antrag-entscheid])').filter({ hasText: /genehmigen|ablehnen|als Ganzes entscheiden/i }).count() === 0, 'A2-Url: es gibt Knöpfe zum Entscheiden einzelner Tage');
  if (!g.mobil) {
    // N-101: „Ganzen Antrag genehmigen“ ragt nicht in den Innenabstand der Karte „Offene Anträge“
    const raus = await page.locator('#ur-antraege').evaluate((karte) => { const k = karte.getBoundingClientRect(), st = getComputedStyle(karte); const l = k.left + parseFloat(st.paddingLeft) - 0.5, r = k.right - parseFloat(st.paddingRight) + 0.5; return [...karte.querySelectorAll('.an-knoepfe .btn')].filter((b) => { const x = b.getBoundingClientRect(); return x.width > 0 && (x.left < l || x.right > r || b.scrollWidth > b.clientWidth + 1); }).map((b) => `${b.textContent.trim()} (${Math.round(b.getBoundingClientRect().right - r)} px)`); });
    pruef(raus.length === 0, `A2-Url: Knöpfe ragen aus „Offene Anträge“ heraus (${raus.join(', ')})`);
    // Klick auf einen Tag öffnet den ganzen Antrag; beantragt = schraffiert, genehmigt = gefüllt
    pruef(await page.locator('#ur-kalender tr[data-person]').count() >= 10 && await page.locator('#ur-kalender tr.ur-gruppe').count() >= 2 && await page.locator('#ur-legende span').count() >= 7, 'A2-Url: Team-Kalender (Zeilen, Partien, Legende) unvollständig');
    const zelleV = page.locator(`#ur-kalender [data-zelle][data-person="${L}"][data-datum="${von}"]`);
    const stilOffen = await zelleV.evaluate((e) => { const s = getComputedStyle(e); return { bild: s.backgroundImage, rand: s.borderTopStyle, farbe: s.backgroundColor }; });
    await ueberlauf('urlaub monat'); await shot('urlaub-monat');
    await zelleV.click();
    await page.waitForSelector(`dialog[open] #ur-eintrag [data-antrag="${antrag1}"]`);
    pruef(/6 Arbeitstage/.test(await page.locator('#ur-eintrag').innerText()) && await page.locator('#ur-eintrag [data-antrag-entscheid]').count() === 2 && await page.locator('#ur-eintrag .an-tage li :is(button, a, input, select)').count() === 0 && await page.locator('#ur-eintrag .an-tage li').count() === 6, 'A2-Url: Tag öffnet nicht den ganzen Antrag (Tagesliste nur zur Ansicht)');
    await dialogUeberlauf('urlaub antrag ganz');
    await page.click('#ur-eintrag [data-antrag-entscheid="genehmigt"]');
    await page.waitForSelector(`#ur-kalender [data-zelle][data-person="${L}"][data-datum="${von}"][data-status="genehmigt"].ok`);
    const stilOk = await zelleV.evaluate((e) => { const s = getComputedStyle(e); return { bild: s.backgroundImage, rand: s.borderTopStyle, farbe: s.backgroundColor }; });
    pruef(/gradient/.test(stilOffen.bild) && stilOffen.rand === 'dashed' && stilOk.bild === 'none' && stilOk.farbe !== stilOffen.farbe, `A2-Url: beantragt/genehmigt unterscheiden sich nicht in Muster und Helligkeit (${JSON.stringify([stilOffen, stilOk])})`);
  } else {
    await z1.locator('[data-antrag-entscheid="genehmigt"]').click();
    await page.waitForSelector(`${liste} [data-antrag="${antrag1}"][data-status="genehmigt"]`);
  }
  await toastWeg();
  const tage2 = (await api('GET', `/abwesenheiten?von=${von}&bis=${bis}`)).json.filter((a) => a.benutzerId === L);
  pruef(tage2.length === 6 && tage2.every((a) => a.status === 'genehmigt'), 'A2-Url: „Ganzen Antrag genehmigen“ setzt nicht alle Tage auf genehmigt');
  // zweiten Antrag als Ganzes ablehnen (mit Begründung)
  const za = (await api('GET', `/abwesenheiten?von=${zaTag}&bis=${zaTag}`)).json.find((a) => a.benutzerId === L);
  await page.locator(`${liste} [data-antrag="${za.antragId}"] [data-antrag-entscheid="abgelehnt"]`).first().click();
  await page.waitForSelector('dialog[open] #an-ab');
  await page.fill('#an-ab [name="antwort"]', 'Betonage in dieser Woche');
  await page.click('#an-ab-ok');
  await page.waitForFunction((id) => !document.querySelector(`[data-antrag="${id}"] [data-antrag-entscheid]`), za.antragId);
  await toastWeg();
  // Korrigieren (nur Büro, nach der Genehmigung): einen Tag herausnehmen → Konto rechnet neu
  if (!g.mobil) await page.locator('#ur-entschieden > summary').click();
  const zKorr = page.locator(`${liste} [data-antrag="${antrag1}"] [data-antrag-korrigieren]`).first();
  await zKorr.scrollIntoViewIfNeeded(); await zKorr.click();
  await page.waitForSelector('dialog[open] #an-korr');
  pruef(await page.locator('#an-korr [name="tag"]').count() === 6 && /früher zurück/i.test(await page.locator('#an-korr').innerText()), 'A2-Url: Korrektur-Dialog ohne Tagesliste oder Hinweis');
  // N-070/N-093: zwei Tage auf einmal herausnehmen – atomar, eine Benachrichtigung
  await page.locator('#an-korr [name="tag"]').nth(4).check(); await page.locator('#an-korr [name="tag"]').last().check();
  await dialogUeberlauf('urlaub korrigieren'); await shot('urlaub-korrigieren');
  await page.click('#an-korr-ok');
  await page.waitForSelector('dialog[open] [data-ok]'); await page.locator('dialog[open] [data-ok]').last().click();
  await page.waitForFunction(() => !document.querySelector('dialog[open] #an-korr'));
  await toastWeg();
  const tage3 = (await api('GET', `/abwesenheiten?von=${von}&bis=${bis}`)).json.filter((a) => a.benutzerId === L);
  const kontoNach = (await api('GET', `/urlaub/konto?jahr=${jahr}&benutzerId=${L}`)).json[0];
  pruef(tage3.length === 4 && !tage3.some((a) => a.datum === bis) && Math.abs((kontoNach.geplant + kontoNach.genommen) - (kontoVor.geplant + kontoVor.genommen) - 4) < 0.001, `A2-Url: Korrektur entfernt die Tage nicht oder das Konto rechnet nicht neu (Tage ${tage3.length}, geplant ${kontoVor.geplant} → ${kontoNach.geplant})`);
  await ueberlauf('urlaub büro'); await shot('urlaub-buero');

  if (!g.mobil) {
    // Filter Partie, Jahr, Konten
    await page.selectOption('#ur-bs', String(ichM.benutzer.baustelleId));
    await page.waitForFunction(() => document.querySelectorAll('#ur-kalender tr.ur-gruppe').length === 1);
    await page.selectOption('#ur-bs', '');
    await page.click('[data-tab="jahr"]');
    await page.waitForSelector('#ur-jahr-tbl tbody tr');
    await ueberlauf('urlaub jahr'); await shot('urlaub-jahr');
    await page.click('[data-tab="konten"]');
    await page.waitForSelector(`#ur-konten tr[data-konto="${L}"]`);
    // N-034: ohne Wahl das laufende Urlaubsjahr (nicht das Jahr des gezeigten Monats)
    const laufend = (await api('GET', `/urlaub/konto?benutzerId=${L}`)).json[0];
    pruef(/Laufendes Urlaubsjahr/.test(await page.locator('#ur-konto-jahr').innerText()) && new RegExp(`Urlaubsjahr ${laufend.jahr}`).test(await page.locator(`#ur-konten tr[data-konto="${L}"] [data-urlaubsjahr]`).innerText()), 'A2-Url: Urlaubskonten zeigen nicht das laufende Urlaubsjahr');
    if (laufend.jahr !== jahr) { await page.click(`[data-kjahr="${jahr > laufend.jahr ? 1 : -1}"]`); await page.waitForSelector(`#ur-konto-jahr:has-text("Urlaubsjahr ${jahr}")`); }
    await page.click(`#ur-konten tr[data-konto="${L}"] [data-konto-edit]`);
    await page.waitForSelector('dialog[open] #ukf');
    await page.selectOption('#ukf [name="art"]', 'buak');
    await page.fill('#ukf [name="buakStand"]', '20'); await page.fill('#ukf [name="buakDatum"]', heute); await page.fill('#ukf [name="uebertrag"]', '2');
    await dialogUeberlauf('urlaubskonto');
    await page.click('dialog[open] button[type="submit"]');
    await page.waitForSelector(`#ur-konten tr[data-konto="${L}"]:has-text("laut BUAK-Kontoauszug vom")`);
    const konto = (await api('GET', `/urlaub/konto?jahr=${jahr}&benutzerId=${L}`)).json[0];
    pruef(konto.art === 'buak' && konto.anspruch === 20 && konto.geplant >= 1 && (await page.locator(`#ur-konten tr[data-konto="${L}"] [data-rest]`).innerText()).replace(',', '.') === String(konto.rest), `A2-Url: Konto/Rest weicht vom Server ab (${JSON.stringify(konto)})`);
    pruef(await page.locator('#ur-csv').count() === 1, 'A2-Url: CSV für die Lohnverrechnung fehlt');
    await ueberlauf('urlaub konten'); await shot('urlaub-konten');
    await toastWeg();
    // Betriebsurlaub: erst Vorschau, dann eintragen
    await page.click('[data-tab="monat"]');
    await page.waitForSelector('#ur-bu');
    await page.click('#ur-bu');
    await page.waitForSelector('dialog[open] #buf');
    pruef(await page.locator('#bu-ok').isDisabled(), 'A2-Url: Betriebsurlaub lässt sich ohne Vorschau eintragen');
    await page.fill('#buf [name="von"]', `${jahr}-12-28`); await page.fill('#buf [name="bis"]', `${jahr}-12-31`);
    await page.selectOption('#buf [name="wer"]', String(ichM.benutzer.baustelleId));
    await page.click('#bu-pruefen');
    await page.waitForSelector('#bu-vorschau [data-bu-tage]');
    pruef(Number(await page.locator('#bu-vorschau [data-bu-tage]').getAttribute('data-bu-tage')) === 4 && Number(await page.locator('#bu-vorschau [data-bu-personen]').getAttribute('data-bu-personen')) >= 2, 'A2-Url: Vorschau Betriebsurlaub (4 Arbeitstage, Partie) falsch');
    await dialogUeberlauf('betriebsurlaub'); await shot('betriebsurlaub');
    await page.click('#bu-ok');
    await page.waitForFunction(() => !document.querySelector('dialog[open] #buf'));
    const bu = (await api('GET', `/abwesenheiten?von=${jahr}-12-28&bis=${jahr}-12-31`)).json.filter((a) => a.benutzerId === L);
    pruef(bu.filter((a) => a.art === 'betriebsurlaub' && a.status === 'genehmigt').length === 4, `A2-Url: Betriebsurlaub nicht als genehmigte BU-Tage angelegt (${JSON.stringify(bu).slice(0, 300)})`);
    await toastWeg();
    await geh(`/urlaub?monat=${jahr}-12`);
    pruef(await page.locator(`#ur-kalender [data-zelle][data-person="${L}"][data-code="BU"].ur-BU.ok`).count() === 4, 'A2-Url: Betriebsurlaub wird im Kalender nicht eigens (BU) dargestellt');
  }
  // Einstellungen Urlaub (nur Büro/GF): Warngrenze je Partie, Beginn des Urlaubsjahres
  await geh(`/urlaub?monat=${monat}`);
  await page.click('#ur-einst');
  await page.waitForSelector('dialog[open] #uef');
  await page.fill('#uef [name="partieGrenze"]', '0');
  await page.click('#ue-ok');
  pruef(await page.locator('#uef .form-err').isVisible(), 'A2-Url: ungültige Warngrenze wird angenommen');
  await page.fill('#uef [name="partieGrenze"]', '1'); await page.fill('#uef [name="partieGrenzeProzent"]', '25');
  await dialogUeberlauf('urlaub einstellungen'); await shot('urlaub-einstellungen');
  await page.click('#ue-ok');
  await page.waitForFunction(() => !document.querySelector('dialog[open] #uef'));
  const ue = (await api('GET', '/einstellungen/urlaub')).json;
  pruef(ue.partieGrenze === 1 && ue.partieGrenzeProzent === 25 && /^\d\d-\d\d$/.test(ue.urlaubsjahrBeginn || ''), `A2-Url: Einstellungen nicht gespeichert (${JSON.stringify(ue)})`);
  await toastWeg();
  // Verweis aus dem Baustellenplaner
  await geh('/plan?ansicht=woche');
  pruef(await page.locator('#pool-urlaub[href="#/urlaub"]').count() === 1, 'A2-Url: Verweis „Urlaub“ im Planer fehlt');
  await abmelden();

  /* ---- Mitarbeiter: sieht „genehmigt“ und die Ablehnung mit Begründung ---- */
  await anmelden('mitarbeiter');
  await geh(`/urlaub?monat=${monat}`); await geh('/mehr'); await geh(`/urlaub?monat=${plusTage(von, 9).slice(0, 7)}`);
  await page.waitForSelector(`#ur-meine [data-antrag="${za.antragId}"][data-status="abgelehnt"]`);
  pruef(/Betonage in dieser Woche/.test(await page.locator(`#ur-meine [data-antrag="${za.antragId}"]`).innerText()) && await page.locator(`#ur-meine [data-antrag="${za.antragId}"] [data-antrag-zurueck]`).count() === 0, 'A2-Url: Ablehnung mit Begründung nicht sichtbar');
  await geh(`/urlaub?monat=${monat}`);
  await page.waitForSelector(`#ur-meine [data-antrag="${antrag1}"][data-status="genehmigt"]`);
  pruef(await page.locator('#ur-meine [data-antrag-entscheid], #ur-meine [data-antrag-korrigieren]').count() === 0 && (await api('GET', '/benachrichtigungen')).json.some((n) => /abgelehnt/i.test(`${n.titel} ${n.text}`)), 'A2-Url: Mitarbeiter kann entscheiden/korrigieren oder bekam keine Meldung zur Ablehnung');
  const korrMeld = (await api('GET', '/benachrichtigungen')).json.filter((n) => /Korrektur durch das Büro/.test(n.text || '') && (n.text || '').includes(kurz(bis)));
  pruef(korrMeld.length === 1 && /2 Arbeitstage/.test(korrMeld[0].text), `A2-Url: Korrektur von zwei Tagen ergibt nicht genau eine Benachrichtigung (${korrMeld.length})`);
  await keinEuro('urlaub mitarbeiter 2'); await ueberlauf('urlaub mitarbeiter 2');
  await abmelden();

  /* ---- Polier: nur die eigenen Einträge (Inhaber 13.11.2026: keine Abwesenheiten anderer, auch nicht der Partie), keine € ---- */
  const polierIch = await anmelden('polier');
  await geh(`/urlaub?monat=${monat}`);
  await page.waitForSelector('#ur-meine');
  pruef(await page.locator('#ur-partie, #ur-warnungen').count() === 0 && !(await page.locator('#view').innerText()).includes(name), 'A2-Url: Polier sieht Abwesenheiten oder Anträge seiner Partie');
  if (!g.mobil) {
    await page.waitForSelector('#ur-kalender');
    const fremdeZeilen = await page.locator('#ur-kalender tr[data-person]').evaluateAll((l, ich) => l.filter((x) => Number(x.dataset.person) !== ich).length, polierIch.benutzer.id);
    pruef(fremdeZeilen === 0 && await page.locator('#ur-bu').count() === 0, `A2-Url: Polier sieht ${fremdeZeilen} andere Personen im Kalender oder darf Betriebsurlaub eintragen`);
  }
  pruef(await page.locator('[data-antrag-entscheid], [data-antrag-korrigieren]').count() === 0, 'A2-Url: Polier kann Anträge entscheiden oder korrigieren');
  pruef(await page.locator('#ur-einst').count() === 0 && (await h.absichtlich(() => api('PUT', '/einstellungen/urlaub', { partieGrenze: 9 }))).status === 403, 'A2-Url: Polier erreicht die Urlaubs-Einstellungen');
  await keinEuro('urlaub polier'); await ueberlauf('urlaub polier'); await shot('urlaub-polier');
  await abmelden();
}

/* ================= Dienste (12.3–12.7, 12.9–12.14): E-Mail, KI, Wetter, Fotos, Diktat, Lieferschein, Papier, Fernunterschrift, Push, 2FA ================= */
const crypto = require('node:crypto');
function totp(base32, ms) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '';
  for (const c of base32.replace(/[\s=-]/g, '').toUpperCase()) bits += A.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from((bits.match(/.{8}/g) || []).map((b) => parseInt(b, 2)));
  const z = Buffer.alloc(8); z.writeBigUInt64BE(BigInt(Math.floor(ms / 30000)));
  const hm = crypto.createHmac('sha1', key).update(z).digest(); const o = hm[19] & 15;
  return String(((hm.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
async function dienste(h, z) {
  const { page, api, geh, pruef, keinEuro, ueberlauf, dialogUeberlauf, shot, g, anmelden, abmelden, toastWeg, context } = h;
  const k = KENN(g), heute = h.heute();
  const ausgang = async () => (await context.request.get(h.srv.url + '/api/test/ausgang')).json();
  const haken = (pfad, body) => context.request.post(h.srv.url + '/api/test/' + pfad, { data: body || {} });
  const bild = async (zeilen) => ({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from((await page.evaluate((zl) => { const c = document.createElement('canvas'); c.width = 900; c.height = 600; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 900, 600); x.fillStyle = '#000'; x.font = '34px sans-serif'; zl.forEach((t, i) => x.fillText(t, 30, 70 + i * 60)); return c.toDataURL('image/png'); }, zeilen)).split(',')[1], 'base64') });

  // Handy: der Bericht ist in Schritte geteilt – zum Schritt blättern, in dem das Element liegt
  const sichtbar = async (sel) => { for (let n = 1; n <= 6; n += 1) { if (await page.locator(sel).first().isVisible().catch(() => false)) return; if (!g.mobil) break; await page.click(`[data-schritt-nr="${n}"]`); await page.waitForTimeout(80); } };

  /* ---- Geschäftsführung: E-Mail-Test, KI einrichten (Schlüssel nie wieder sichtbar), Zustände ---- */
  await anmelden('gf');
  const W = z.w || 1;
  const bsW = (await api('GET', `/baustellen/${W}`)).json;
  pruef((await api('PUT', `/baustellen/${W}`, { version: bsW.version, lat: 47.72, lng: 16.15, agEmail: 'bauherr@example.test', berichtMail: true })).status === 200, 'A2-Dienst: Koordinaten/AG-E-Mail der Baustelle nicht speicherbar');
  await geh('/benutzer?reiter=dienste');
  await page.waitForSelector('#dienste');
  const mailsVor = (await ausgang()).mails.length;
  await page.fill('#mail-test [name="an"]', 'test@example.test');
  await page.click('#mail-test-ok');
  await page.waitForSelector('#mail-test-erg:not([hidden])');
  pruef((await ausgang()).mails.length === mailsVor + 1, 'A2-Dienst: Test-Mail kam nicht im Ausgang an');
  await page.fill('#ki-form [name="apiKey"]', 'sk-test');
  await page.check('#ki-form [name="datenschutzBestaetigt"]', { force: true });
  await page.check('#ki-form [name="aktiv"]', { force: true });
  await page.click('#ki-ok');
  await page.waitForSelector('[data-ki-zustand^="aktiv"]');
  pruef(await page.locator('#ki-form [name="apiKey"]').inputValue() === '' && !(await page.content()).includes('sk-test'), 'A2-KI: der API-Schlüssel wird nach dem Speichern wieder angezeigt');
  await toastWeg();
  await h.absichtlich(async () => { await page.click('#ki-test'); await page.waitForSelector('#ki-test-erg:not([hidden])'); }); // Attrappe: Ergebnis (auch ein Fehler) wird angezeigt, nichts vorgetäuscht
  pruef(await page.locator('[data-pflicht]').count() >= 2, 'A2-2FA: Einstellungen zur Pflicht je Rolle fehlen');
  await ueberlauf('dienste'); await shot('dienste');
  await geh('/mehr');
  const zust = Object.fromEntries(await page.evaluate(() => [...document.querySelectorAll('.integ-list li[data-integ]')].map((li) => [li.dataset.integ, li.dataset.zustand])));
  pruef(/^aktiv/.test(zust.ki || '') && /^aktiv/.test(zust.email || '') && /^aktiv/.test(zust.wetter || '') && zust.sms === 'optional' && /aktiv_mit_ki|aktiv/.test(zust.diktat || ''), `A2-Dienst: Zusatzdienste zeigen falsche Zustände (${JSON.stringify(zust)})`);
  pruef(!(await h.text()).includes('Noch nicht angebunden') || zust.sms === 'optional', 'A2-Dienst: aktive Dienste als „nicht angebunden“ gezeigt');
  await ueberlauf('mehr zusatzdienste'); await shot('zusatzdienste');
  await abmelden();

  /* ---- Polier: Wetter, Fotos, Diktat (mit KI), Lieferschein, Papier, Fernunterschrift ---- */
  await anmelden('polier');
  let ber = null;
  for (let i = 60; i < 80 && !ber; i += 1) { const r = await api('POST', '/berichte', { baustelleId: W, datum: plusTage(heute, -i) }); if (r.status === 201) ber = r.json; }
  pruef(!!ber, 'A2-Dienst: kein neuer Berichtsentwurf möglich');
  await geh(`/bericht/${ber.id}`);
  await page.waitForSelector('#wetter-karte', { state: 'attached' });
  await sichtbar('#wetter-karte');
  pruef(/°C/.test(await page.locator('#wetter-karte').innerText()), `A2-Wetter: Wetterkarte ohne Werte (${(await page.locator('#wetter-karte').innerText()).slice(0, 80)})`);
  // Ausfall des Wetterdienstes: ein neuer Bericht zeigt ehrlich „Wetter nicht verfügbar“ (nichts wird erfunden)
  await haken('wetter', { verfuegbar: false });
  let ber2 = null;
  for (let i = 81; i < 100 && !ber2; i += 1) { const r = await api('POST', '/berichte', { baustelleId: W, datum: plusTage(heute, -i) }); if (r.status === 201) ber2 = r.json; }
  await h.absichtlich(async () => { await geh(`/bericht/${ber2.id}`); await sichtbar('#wetter-karte'); await page.waitForFunction(() => /nicht verfügbar/i.test((document.querySelector('#wetter-karte') || { innerText: '' }).innerText), null, { timeout: 8000 }).catch(() => {}); });
  pruef(/nicht verfügbar/i.test(await page.locator('#wetter-karte').innerText()) && !/°C/.test(await page.locator('#wetter-karte').innerText()), `A2-Wetter: Ausfall wird nicht als „Wetter nicht verfügbar“ gezeigt (${(await page.locator('#wetter-karte').innerText()).slice(0, 100)})`);
  await haken('wetter', { verfuegbar: true });
  await geh(`/bericht/${ber.id}`);
  await toastWeg();
  // Fotos (bis 10), Beschreibung, danach lässt sich der Bericht weiter speichern
  await page.setInputFiles('#foto-datei', [await bild(['Foto 1']), await bild(['Foto 2'])]);
  await page.waitForFunction(() => document.querySelectorAll('#fotos [data-foto]').length === 2);
  await sichtbar('#fotos [data-foto-text]');
  await page.locator('#fotos [data-foto-text]').first().fill('Künette Achse 3'); await page.locator('#fotos [data-foto-text]').first().blur();
  await toastWeg();
  pruef((await api('GET', `/berichte/${ber.id}`)).json.fotos.some((f) => f.beschreibung === 'Künette Achse 3'), 'A2-Foto: Beschreibung nicht gespeichert');
  // Diktat: Vorschlag mit markierten Feldern – mit aktiver KI als „mit KI verbessert“
  await haken('ki', { antwort: { geraete: [], material: [], personal: [], regie: [], arbeitsleistung: 'Schotter eingebaut und verdichtet', vorkommnisse: '' } });
  await sichtbar('#diktat-text');
  await page.fill('#diktat-text', 'Heute Schotter eingebaut und verdichtet, Wetter sonnig.');
  await page.click('#diktat-los');
  await page.waitForSelector('dialog[open] #vorschlag');
  pruef(await page.locator('#vorschlag [data-vs]').count() >= 1 && await page.locator('#vs-chip').count() === 1, 'A2-Diktat: Vorschlag ohne Felder oder ohne Hinweis „bitte prüfen“');
  pruef(await page.locator('#vorschlag [data-quelle="ki"]').count() === 1, 'A2-Diktat: Kennzeichnung „mit KI verbessert“ fehlt');
  await dialogUeberlauf('diktat vorschlag'); await shot('diktat-vorschlag');
  await page.click('#vs-ok');
  await page.waitForSelector('#ki-chip');
  await page.waitForSelector('#save-state[data-zustand="ok"]', { timeout: 10000 });
  pruef(/Schotter eingebaut/.test((await api('GET', `/berichte/${ber.id}`)).json.arbeitsleistung || ''), 'A2-Diktat: bestätigter Vorschlag nicht im Bericht gespeichert (auch nach Foto-Upload ohne Konflikt)');
  await toastWeg();
  // Lieferschein: Texterkennung (Attrappe) → Vorschlag → bestätigt in die Materialmenge
  const mats = (await api('GET', '/materialien')).json; const mat = mats.find((m) => m.einheit === 't') || mats[0];
  await haken('ki', {});
  await haken('ocr', { text: `Lieferschein Nr. 4711\nKieswerk Test GmbH\n${mat.name} 12,5 t\n` });
  const mengeVor = (((await api('GET', `/berichte/${ber.id}`)).json.material || []).find((m) => m.materialId === mat.id) || {}).menge || 0;
  await page.setInputFiles('#ls-datei', await bild(['Lieferschein 4711', `${mat.name} 12,5 t`]));
  await page.waitForSelector('dialog[open] #vorschlag', { timeout: 30000 });
  pruef((await page.locator('#vorschlag').innerText()).includes(mat.name), `A2-Liefer: Vorschlag ohne das erkannte Material (${(await page.locator('#vorschlag').innerText()).replace(/\s+/g, ' ').slice(0, 160)})`);
  await dialogUeberlauf('lieferschein vorschlag'); await shot('lieferschein-vorschlag');
  await page.click('#vs-ok');
  await page.waitForSelector('#save-state[data-zustand="ok"]', { timeout: 10000 });
  await toastWeg();
  let mengeNach = mengeVor;
  for (let i = 0; i < 40 && Math.abs(mengeNach - mengeVor) < 0.001; i += 1) { mengeNach = (((await api('GET', `/berichte/${ber.id}`)).json.material || []).find((m) => m.materialId === mat.id) || {}).menge || 0; if (Math.abs(mengeNach - mengeVor) < 0.001) await page.waitForTimeout(250); } // das automatische Speichern läuft kurz nach der Übernahme
  pruef(Math.abs(mengeNach - mengeVor - 12.5) < 0.001, `A2-Liefer: bestätigte Menge nicht übernommen (${mengeVor} → ${mengeNach})`);
  // Papierbericht: Foto als Anhang
  await page.setInputFiles('#pp-datei', await bild(['Bautagesbericht', 'Papierformular']));
  await page.waitForSelector('#papier-erg:not(:empty)', { state: 'attached', timeout: 30000 });
  pruef(/Anhang/.test(await page.locator('#papier-erg').innerText()), 'A2-Papier: Hinweis „als Anhang gespeichert“ fehlt');
  await page.locator('dialog[open] [data-zu]').first().click().catch(() => {});
  await toastWeg();
  // Unterschrift des Auftragnehmers, dann Bauherr per Link
  await sichtbar('[data-fern-anfordern]');
  await page.locator('[data-fern-anfordern]').first().scrollIntoViewIfNeeded();
  await page.locator('[data-fern-anfordern]').first().click();
  await page.waitForSelector('dialog[open] #fl-form');
  await page.fill('#fl-form [name="name"]', 'Bauherr Test');
  await page.click('#fl-ok');
  await page.waitForSelector('#fl-url');
  const link = (await page.locator('#fl-url').innerText()).trim();
  pruef(/\/unterschrift\/[A-Za-z0-9_-]{20,}$/.test(link) && await page.locator('#fl-whatsapp, #fl-kopie').count() === 2, `A2-Fern: Link oder Teilen/Kopieren fehlt (${link})`);
  await dialogUeberlauf('fern link'); await shot('fern-link');
  await page.click('dialog[open] [data-zu]');
  // Bauherr: fremdes Gerät ohne Anmeldung
  const fremd = await h.neuerKontext({ viewport: { width: 390, height: 844 }, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: true });
  try {
    const p2 = await fremd.newPage(); const fehler2 = [];
    p2.on('console', (m) => { if (m.type() === 'error') fehler2.push(m.text()); });
    await p2.goto(h.srv.url + new URL(link, h.srv.url).pathname);
    await p2.waitForSelector('#fern-form');
    const t2 = await p2.evaluate(() => document.body.innerText);
    pruef(!t2.includes('€') && /Schotter eingebaut/.test(t2), 'A2-Fern: Seite des Bauherrn zeigt Preise oder nicht den Bericht');
    await p2.locator('#fern-box canvas').scrollIntoViewIfNeeded();
    const box = await p2.locator('#fern-box canvas').boundingBox();
    await p2.mouse.move(box.x + 30, box.y + 40); await p2.mouse.down(); await p2.mouse.move(box.x + 120, box.y + 80, { steps: 6 }); await p2.mouse.move(box.x + 200, box.y + 40, { steps: 6 }); await p2.mouse.up();
    await p2.fill('#fern-form [name="name"]', 'Bauherr Test');
    if (await p2.locator('#fern-form [name="ok"]').count()) await p2.check('#fern-form [name="ok"]');
    await p2.click('#fern-ok');
    await p2.waitForSelector('[data-fern="unterschrieben"]');
    pruef((await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, 'A2-Fern: horizontaler Überlauf auf der Seite des Bauherrn');
    await p2.goto(h.srv.url + '/unterschrift/' + 'x'.repeat(43));
    await p2.waitForSelector('[data-fern="ungueltig"]');
    pruef(fehler2.filter((t) => !/Failed to load resource/.test(t)).length === 0, `A2-Fern: Konsolenfehler beim Bauherrn: ${fehler2.slice(0, 2).join(' | ')}`);
  } finally { await fremd.close(); }
  pruef(!!(await api('GET', `/berichte/${ber.id}`)).json.unterschriften.bh, 'A2-Fern: Unterschrift des Bauherrn nicht im Bericht');
  await keinEuro('bericht dienste');
  // Push: Abo (Attrappe) und Test-Meldung
  await geh('/push');
  pruef(await page.locator('[data-push-zustand]').count() === 1 && await page.locator('[data-typ]').count() >= 2, 'A2-Push: Zustand oder Kategorien fehlen');
  pruef((await api('POST', '/push/abo', { endpoint: `https://push.example.test/polier-${k}`, keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' }, geraet: 'Test-Handy' })).status < 300, 'A2-Push: Abo nicht möglich');
  const pushVor = (await ausgang()).push.length;
  pruef((await api('POST', '/push/test')).json.gesendet >= 1 && (await ausgang()).push.length === pushVor + 1, 'A2-Push: Test-Meldung kam nicht im Ausgang an');
  await geh('/mehr'); await geh('/push');
  pruef(/Test-Handy/.test(await page.locator('#push-geraete').innerText()), 'A2-Push: Gerät fehlt in der Liste');
  await keinEuro('push'); await ueberlauf('push'); await shot('push');
  await abmelden();

  /* ---- Bauleiter: Zwei-Faktor einrichten, Wiederherstellungscodes, Anmeldung mit Code ---- */
  await anmelden('bauleiter');
  await geh('/zwei-faktor');
  await page.fill('#zf-start [name="pin"]', PIN_A2);
  await page.click('#zf-start button[type="submit"]');
  await page.waitForSelector('[data-zf="qr"] img');
  const geheim = (await page.locator('#zf-geheimnis').textContent()).replace(/\s/g, '');
  await ueberlauf('2fa qr'); await shot('2fa-qr');
  await page.fill('#zf-best [name="code"]', totp(geheim, h.jetzt()));
  await page.click('#zf-best button[type="submit"]');
  await page.waitForSelector('#zf-codes');
  pruef(await page.locator('#zf-codes li, #zf-codes code').count() >= 8 && await page.locator('#zf-download').count() === 1, 'A2-2FA: Wiederherstellungscodes oder Download fehlen');
  await ueberlauf('2fa codes'); await shot('2fa-codes');
  if (await page.locator('#zf-gesichert').count()) await page.check('#zf-gesichert', { force: true });
  await page.click('#zf-fertig');
  await page.waitForSelector('[data-zf="aktiv"]');
  await abmelden();
  // Anmeldung: nach der PIN wird der Code verlangt; falscher Code → Fehler, richtiger → drin
  await page.fill('#login-suche', NAME_BL.split(' ')[1]);
  await page.click(`.login-user:has-text("${NAME_BL}")`);
  for (const zf of PIN_A2) await page.click(`.pin-pad [data-z="${zf}"]`);
  await page.click('.pin-pad [data-ok]');
  await page.waitForSelector('#zf-login');
  await page.fill('#zf-code', '000000');
  await h.absichtlich(async () => { await page.click('#zf-ok'); await page.waitForFunction(() => { const m = document.querySelector('#zf-msg'); return m && m.textContent.trim().length > 3; }); });
  await ueberlauf('login 2fa'); await shot('login-2fa');
  await page.fill('#zf-code', totp(geheim, h.jetzt() + 30000));
  await page.click('#zf-ok');
  await page.waitForSelector('#view');
  const ichB = (await api('GET', '/auth/ich')).json;
  pruef(ichB.benutzer.name === NAME_BL && ichB.zweiFaktor && ichB.zweiFaktor.aktiv === true, 'A2-2FA: Anmeldung mit Code oder Status „aktiv“ fehlgeschlagen');
  await abmelden();
}
const PIN_A2 = '1234', NAME_BL = 'Stefan Aigner';

/* ================= G-05: „Morgen“ = nächster Arbeitstag (Freitag, Tag vor einem Feiertag) ================= */
async function arbeitstag(h) {
  const { pruef, g } = h;
  const login = async (page, url, name) => {
    await page.goto(url + '/#/login'); await page.waitForSelector('.login-user');
    await page.fill('#login-suche', name.split(' ')[1]); await page.click(`.login-user:has-text("${name}")`);
    for (const zf of PIN_A2) await page.click(`.pin-pad [data-z="${zf}"]`);
    await page.click('.pin-pad [data-ok]'); await page.waitForSelector('#view'); await page.waitForTimeout(300);
  };
  const apiP = (page, m, pfad, body) => page.evaluate(async ([m2, p2, b2]) => { const r = await fetch('/api' + p2, { method: m2, headers: { 'Content-Type': 'application/json' }, body: m2 === 'GET' ? undefined : JSON.stringify(b2 || {}) }); let j = null; try { j = await r.json(); } catch (e) { /* leer */ } return { status: r.status, json: j }; }, [m, pfad, body]);
  const gehP = async (page, r) => { await page.evaluate((x) => { location.hash = x; }, '#' + r); await page.waitForFunction((x) => location.hash === '#' + x, r); await page.waitForFunction(() => !document.querySelector('#view .view-box > .state .spinner'), null, { timeout: 10000 }); await page.waitForTimeout(80); };
  for (const [uhr, heute, naechster, kurz, wochentag] of [['2026-11-13T15:00:00+01:00', '2026-11-13', '2026-11-16', 'Mo 16.11.', 'Montag'], ['2026-12-07T15:00:00+01:00', '2026-12-07', '2026-12-09', 'Mi 09.12.', 'Mittwoch']]) {
    const srv = await h.starteServer({ BAUTAG_TEST: '1', BAUTAG_UHR: uhr });
    const ctx = await h.neuerKontext({ viewport: { width: g.width, height: g.height }, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: g.mobil });
    try {
      await ctx.clock.setSystemTime(new Date(uhr));
      const page = await ctx.newPage(); page.setDefaultTimeout(10000);
      const fehler = []; page.on('console', (m) => { if (m.type() === 'error') fehler.push(m.text()); }); page.on('pageerror', (e) => fehler.push(e.message));
      // Büro: nächsten Arbeitstag einteilen und veröffentlichen
      await login(page, srv.url, 'Martina Koller');
      const leute = (await apiP(page, 'GET', '/mitarbeiter')).json;
      const polier = leute.find((m) => m.name === 'Josef Haidbauer'), lukas = leute.find((m) => m.name === 'Lukas Brandstätter');
      await abwWeg((m, pf) => apiP(page, m, pf), (await apiP(page, 'GET', `/abwesenheiten?von=${heute}&bis=${naechster}`)).json.filter((x) => x.benutzerId === lukas.id));
      pruef((await apiP(page, 'POST', '/plan/einsaetze', { datum: naechster, baustelleId: polier.baustelleId, beginn: '06:30', benutzerIds: [lukas.id, polier.id] })).status === 201, `G-05 (${heute}): Einsatz am nächsten Arbeitstag nicht anlegbar`);
      await gehP(page, '/plan?ansicht=tag');
      await page.waitForSelector('#tg-tag');
      const tt = (await page.locator('#tg-tag').innerText()).replace(/\s+/g, ' ');
      pruef((await page.locator('#tg-tag').getAttribute('data-datum')) === naechster && tt.includes(kurz) && !/^Morgen/.test(tt), `G-05 (${heute}): Tagesansicht zeigt nicht den nächsten Arbeitstag „${kurz}“ („${tt}“, ${await page.locator('#tg-tag').getAttribute('data-datum')})`);
      pruef((await page.locator('[data-ansicht="tag"]').innerText()).includes(kurz), `G-05 (${heute}): Reiter heißt „Morgen“, obwohl der nächste Arbeitstag ${kurz} ist`);
      pruef((await page.locator('#tg-pub').innerText()).includes(kurz) && !/für morgen/i.test(await page.locator('#tg-pub').innerText()), `G-05 (${heute}): Knopf spricht von „morgen“`);
      pruef((await apiP(page, 'POST', '/plan/veroeffentlichen', { von: naechster, bis: naechster })).status === 200, `G-05 (${heute}): veröffentlichen nicht möglich`);
      await apiP(page, 'POST', '/auth/logout');
      // Polier: „Meine Partie“ zeigt gleich den nächsten Arbeitstag
      await login(page, srv.url, 'Josef Haidbauer');
      await gehP(page, '/partie');
      pruef(await page.locator('[data-partie-einsatz]').count() >= 1 && await page.locator('#partie-leer').count() === 0, `G-05 (${heute}): „Meine Partie“ zeigt den veröffentlichten ${kurz} nicht`);
      pruef((await page.locator(`[data-partie-tag="${naechster}"]`).innerText()).includes(kurz) && await page.locator(`[data-partie-tag="${naechster}"][aria-selected="true"]`).count() === 1 && await page.locator('#partie-druck').count() === 1, `G-05 (${heute}): Reiter der Partie ist nicht „${kurz}“`);
      await apiP(page, 'POST', '/auth/logout');
      // Mitarbeiter: Karte für den nächsten Arbeitstag heißt nie „Heute“/„Morgen“
      await login(page, srv.url, 'Lukas Brandstätter');
      await gehP(page, '/einsatz');
      await page.waitForSelector(`#einsatz-karte[data-datum="${naechster}"]`);
      const wann = await page.locator('.me-wann').innerText();
      pruef(!/heute|morgen/i.test(wann.replace(/wie heute/i, '')) && new RegExp(wochentag, 'i').test(wann), `G-05 (${heute}): „Mein Einsatz“ beschriftet den ${kurz} falsch („${wann}“)`);
      pruef((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1 && !(await page.evaluate(() => document.body.innerText)).includes('€'), `G-05 (${heute}): Überlauf oder € in „Mein Einsatz“`);
      pruef(fehler.filter((t) => !/401/.test(t)).length === 0, `G-05 (${heute}): Konsolenfehler: ${fehler.slice(0, 3).join(' | ')}`);
    } finally { await ctx.close(); srv.stop(); }
  }
}

/* ================= R-08: geteiltes Gerät – nach dem Abmelden bleibt nichts vom Vorbenutzer ================= */
async function geteilt(h) {
  const { page, api, geh, pruef, g, anmelden, context } = h;
  const lager = () => page.evaluate(async () => {
    const ls = {}; for (let i = 0; i < localStorage.length; i += 1) ls[localStorage.key(i)] = localStorage.getItem(localStorage.key(i));
    const ss = {}; for (let i = 0; i < sessionStorage.length; i += 1) ss[sessionStorage.key(i)] = sessionStorage.getItem(sessionStorage.key(i));
    const cache = []; for (const n of await caches.keys()) { const c = await caches.open(n); for (const k2 of await c.keys()) if (new URL(k2.url).pathname.startsWith('/api/')) cache.push(k2.url); }
    return { ls, ss, cache, cookie: document.cookie };
  });
  const ichP = await anmelden('polier');
  const P = ichP.benutzer.id, name = ichP.benutzer.name;
  // der Polier arbeitet: Einsatz, Partie, Stempeluhr, Bericht, Urlaub – und hat eine Fuhren-Meldung ohne Netz in der Warteschlange
  const entwurf = (await api('GET', '/berichte?status=entwurf')).json[0];
  for (const r of ['/stempeln', '/einsatz', '/partie', '/berichte', ...(entwurf ? [`/bericht/${entwurf.id}`] : []), '/urlaub', '/fuhrpark', '/baustellen']) await geh(r);
  await page.evaluate((id) => {
    localStorage.setItem('bt_fuhren_warten', JSON.stringify([{ nr: 'e2e-geteilt', benutzerId: id, fuhreId: 999999, body: { status: 'unterwegs' }, foto: null, zeit: new Date().toISOString() }]));
    sessionStorage.setItem('bt_test_sitzung', JSON.stringify({ benutzerId: id }));
  }, P);
  const vor = await lager();
  pruef(Object.keys(vor.ls).some((x) => /einsatz/.test(x)) && 'bt_ich' in vor.ls, `R-08: Vorbedingung fehlt – der Polier hat nichts im Gerätespeicher (${Object.keys(vor.ls).join(',')})`);
  // abmelden (mit Hinweis auf die wartende Meldung)
  await geh('/mehr');
  await page.click('#abmelden');
  await page.waitForSelector('dialog[open] [data-ok]');
  pruef(/noch nicht gesendet/.test(await page.locator('dialog[open]').innerText()), 'R-08: kein Hinweis auf wartende Meldungen beim Abmelden');
  await page.click('dialog[open] [data-ok]');
  await page.waitForSelector('.login-user');
  const nach = await lager();
  const ERLAUBT = ['bt_install_weg', 'bt_installiert', 'bt_letzter', 'bt_letzte_pnr', 'bt_geraet_benutzer', 'bt_stempel_queue', 'bt_stempel_abgelehnt', 'bt_fuhren_warten'];
  const WARTEND = ['bt_stempel_queue', 'bt_stempel_abgelehnt', 'bt_fuhren_warten'];
  const fremd = Object.keys(nach.ls).filter((x) => !ERLAUBT.includes(x));
  pruef(fremd.length === 0, `R-08: nach dem Abmelden bleiben Schlüssel im localStorage: ${fremd.join(', ')}`);
  const mitDaten = Object.entries(nach.ls).filter(([x, w]) => !WARTEND.includes(x) && (w.includes(name) || /"uid":|"benutzer":\{|"einsatz"|"rechte"/.test(w)));
  pruef(mitDaten.length === 0 && Object.keys(nach.ss).length === 0 && nach.cache.length === 0 && !nach.cookie, `R-08: Daten des Vorbenutzers lesbar (localStorage ${mitDaten.map(([x]) => x).join(',')}, sessionStorage ${Object.keys(nach.ss).join(',')}, Cache ${nach.cache.length}, Cookie „${nach.cookie}“)`);
  // anderer Benutzer am selben Gerät: sieht nichts vom Polier, dessen Warteschlange wird nicht mit seiner Sitzung gesendet
  const gesendet = []; const lausche = (req) => { if (/\/api\/plan\/fuhren\/999999\//.test(req.url())) gesendet.push(req.url()); };
  page.on('request', lausche);
  await anmelden('mitarbeiter');
  await geh('/einsatz'); await geh('/stempeln');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(600);
  page.off('request', lausche);
  const dann = await lager();
  pruef(gesendet.length === 0 && JSON.parse(dann.ls.bt_fuhren_warten || '[]').some((w) => w.nr === 'e2e-geteilt' && w.benutzerId === P), 'R-08: wartende Meldung des Poliers wurde mit der Sitzung des Mitarbeiters gesendet oder ging verloren');
  pruef(!Object.entries(dann.ls).some(([x, w]) => !WARTEND.includes(x) && w.includes(name)) && !(await h.text()).includes(name), 'R-08: Daten oder Name des Poliers beim Mitarbeiter sichtbar');
  pruef(JSON.parse(dann.ls.bt_geraet_benutzer) !== P, 'R-08: Gerät merkt sich den Benutzerwechsel nicht');
  await page.evaluate(() => localStorage.removeItem('bt_fuhren_warten'));
  await h.abmelden();
}

/* ================= Inhaber 13.11.2026: Polier und Mitarbeiter sehen Abwesenheiten anderer GAR NICHT (auch nicht „abwesend“) –
   in der Anzeige und im Netzwerk; der Polier meldet Schlechtwetter für seine Partie mit neutraler Rückmeldung ================= */
async function krank(h) {
  const { page, api, geh, pruef, g, anmelden, abmelden } = h;
  const heute = h.heute();
  const tag = naechsterArbeitstag(heute, 4), tagU = naechsterArbeitstag(tag, 1);
  await anmelden('buero');
  const leute = (await api('GET', '/mitarbeiter')).json;
  const polier = leute.find((m) => m.name === 'Josef Haidbauer');
  const partie = leute.filter((m) => m.rolle === 'mitarbeiter' && m.aktiv !== false && m.baustelleId === polier.baustelleId && m.name !== 'Lukas Brandstätter');
  const kollege = partie[0], zweiter = partie[1];
  pruef(!!kollege && !!zweiter, 'Abwesenheiten: zu wenige Kollegen in der Partie des Poliers für die Prüfung');
  await abwWeg(api, (await api('GET', `/abwesenheiten?von=${tag}&bis=${tagU}`)).json.filter((x) => [kollege.id, zweiter.id].includes(x.benutzerId)));
  const k = await api('POST', '/abwesenheiten/zeitraum', { benutzerId: kollege.id, von: tag, bis: tag, code: 'K', notiz: 'DIAGNOSE-GEHEIM' });
  pruef(k.status === 201 && k.json.status === 'genehmigt', `Abwesenheiten: Krankenstand eintragen → ${k.status}`);
  const u = await api('POST', '/abwesenheiten/zeitraum', { benutzerId: kollege.id, von: tagU, bis: tagU, code: 'U', notiz: 'URLAUB-GEHEIM' });
  pruef(u.status === 201, `Abwesenheiten: Urlaub eintragen → ${u.status}`);
  await abmelden();

  // Rundgang einer Rolle: sichtbarer Text, DOM und alle JSON-Antworten ohne jede Abwesenheit anderer Personen
  const FREMD = ['K', 'U', 'ZA', 'BU', 'abwesend'];
  async function rundgang(rolle, ich, routen) {
    const antworten = [];
    const lausche = async (r) => { if (!r.url().includes('/api/') || !/json/.test(r.headers()['content-type'] || '')) return; try { antworten.push([r.url().replace(h.srv.url, ''), await r.text()]); } catch (e) { /* Antwort schon weg */ } };
    page.on('response', lausche);
    const sichtbar = [], imDom = [];
    for (const r of routen) {
      await geh(r); await page.waitForTimeout(300);
      const t = (await page.evaluate(() => (document.querySelector('#view') || document.body).innerText)).replace(/K\s*=\s*Krank/g, '').replace(/ZA\s+Zeitausgleich\s+K\s+Krank\s+SW\s+Schlechtwetter/g, '');
      // der Mitarbeiter der Testdaten war selbst krank (eigener Eintrag, erlaubt) – bei ihm zählt „Krank“ nicht
      const fund = (rolle === 'polier' ? /\bKrank(enstand)?\b|DIAGNOSE-GEHEIM|URLAUB-GEHEIM|\babwesend\b|\babw\.|Abwesenheiten meiner Partie|Meine Partie – Abwesenheiten/ : /DIAGNOSE-GEHEIM|URLAUB-GEHEIM|\babwesend\b|\babw\.|Abwesenheiten meiner Partie/).exec(t);
      if (fund) sichtbar.push(`${r} („${t.slice(Math.max(0, fund.index - 50), fund.index + 30).replace(/\s+/g, ' ')}“)`);
      const dom = await page.evaluate((meine) => {
        const out = [];
        if (document.querySelector('#ur-partie, #abw-andere, [data-abwesend], .wp-frei.abwesend')) out.push('Abschnitt/Marke für Abwesenheiten anderer');
        const fremdeZeilen = [...document.querySelectorAll('#ur-kalender [data-person], #ur-jahr [data-person], #ur-konten [data-person]')].filter((x) => Number(x.dataset.person) !== meine).length;
        if (fremdeZeilen) out.push(`${fremdeZeilen} Kalender-/Kontozeilen anderer Personen`);
        const marken = [...document.querySelectorAll('.crew-row .code-badge, [data-partie-personen] .code-badge')].length;
        if (marken) out.push(`${marken} Abwesenheits-Kürzel in Personenlisten`);
        return out;
      }, ich);
      if (dom.length) imDom.push(`${r}: ${dom.join(', ')}`);
    }
    page.off('response', lausche);
    pruef(sichtbar.length === 0, `Abwesenheiten (${rolle}): Abwesenheit anderer sichtbar auf ${sichtbar.join(', ')}`);
    pruef(imDom.length === 0, `Abwesenheiten (${rolle}): ${imDom.join(' | ')}`);
    const leck = [];
    const suche = (x, url) => {
      if (Array.isArray(x)) return x.forEach((y) => suche(y, url));
      if (!x || typeof x !== 'object') return;
      if (x.benutzerId != null && Number(x.benutzerId) !== ich && FREMD.includes(x.code)) leck.push(`${url}: Code ${x.code} von Person ${x.benutzerId}`);
      Object.values(x).forEach((y) => suche(y, url));
    };
    for (const [url, t] of antworten) {
      if (/DIAGNOSE-GEHEIM|URLAUB-GEHEIM/.test(t)) leck.push(`${url}: Notiz`);
      if (/\/api\/(abwesenheiten|urlaub)\b/.test(url) && !/sw-meldungen|feiertage|einstellungen/.test(url) && new RegExp(`"benutzerId":(${kollege.id}|${zweiter.id})\\b`).test(t)) leck.push(`${url}: Eintrag einer anderen Person`);
      // auch Zähler verraten Abwesenheiten („6 von 7 Personen abwesend“)
      if (/\/api\/urlaub\/kalender/.test(url)) { try { if ((JSON.parse(t).warnungen || []).length) leck.push(`${url}: Warnungen zur Partie-Besetzung`); } catch (e) { /* kein JSON */ } }
      try { suche(JSON.parse(t), url); } catch (e) { /* kein JSON */ }
    }
    pruef(antworten.length > 5 && leck.length === 0, `Abwesenheiten (${rolle}): Netzwerkantworten verraten Abwesenheiten anderer (${[...new Set(leck)].slice(0, 4).join(' | ')})`);
  }

  /* ---- Polier ---- */
  await anmelden('polier');
  // ein Entwurf mit Personalzeilen (für die Code-Auswahl); notfalls ein neuer Entwurf für einen Tag mit Stempelungen
  let entwurf = null; const spurE = [];
  for (const kandidat of (await api('GET', '/berichte?status=entwurf')).json) { const voll = (await api('GET', `/berichte/${kandidat.id}`)).json; spurE.push(`${kandidat.datum}:${(voll.personal || []).length}:${voll.unterschriften.an ? 'an' : ''}${voll.unterschriften.bh ? 'bh' : ''}`); if ((voll.personal || []).length >= 2 && !(voll.unterschriften.an || voll.unterschriften.bh)) { entwurf = kandidat; break; } }
  const spur = [];
  const vorhanden = new Set((await api('GET', `/berichte?baustelleId=${polier.baustelleId}`)).json.map((x) => x.datum));
  for (let i = 0; i < 40 && !entwurf; i += 1) { const d = plusTage(heute, -i); if (vorhanden.has(d)) continue; const r = await api('POST', '/berichte', { baustelleId: polier.baustelleId, datum: d }); spur.push(`${d}:${r.status}:${((r.json || {}).personal || []).length}`); if (r.status === 201 && (r.json.personal || []).length >= 2) entwurf = r.json; }
  if (!entwurf) { // kein Entwurf mit Stempelungen: Personal in einem leeren Entwurf von Hand eintragen
    for (const leer of (await api('GET', `/berichte?baustelleId=${polier.baustelleId}&status=entwurf`)).json.sort((x, y) => (x.datum < y.datum ? 1 : -1))) {
      const voll = (await api('GET', `/berichte/${leer.id}`)).json;
      if (voll.unterschriften.an || voll.unterschriften.bh) continue;
      const r = await api('PUT', `/berichte/${voll.id}`, { version: voll.version, personal: [polier, kollege, zweiter].map((m) => ({ benutzerId: m.id, von1: '07:00', bis1: '16:00', pauseMin: 60, code: null })) });
      spur.push(`PUT ${leer.datum}:${r.status}`);
      if (r.status === 200) { entwurf = voll; break; }
    }
  }
  pruef(!!entwurf, `Abwesenheiten: kein Berichtsentwurf mit Personal für die Prüfung der Code-Auswahl (Entwürfe ${spurE.join(' ')} · neu ${spur.slice(0, 4).join(' ')})`);
  await rundgang('polier', polier.id, [`/urlaub?monat=${tag.slice(0, 7)}`, `/urlaub?ansicht=jahr`, `/urlaub?ansicht=konten`, '/abwesenheiten', '/partie', '/kolonne', '/einsatz', '/woche', '/stempeln', '/berichte', ...(entwurf ? [`/bericht/${entwurf.id}`] : [])]);
  await geh(`/urlaub?monat=${tag.slice(0, 7)}`);
  pruef(await page.locator('#ur-partie').count() === 0 && await page.locator('#ur-meine').count() === 1, 'Abwesenheiten: Polier sieht unter Urlaub nicht nur die eigenen Einträge');
  // Bericht: für andere Personen nur „–“ und „SW“ (kein K/U/ZA, kein „abw.“)
  if (entwurf) {
    await geh(`/bericht/${entwurf.id}`);
    await page.waitForSelector('.bp-row');
    const fremd = await page.evaluate(() => [...document.querySelectorAll('.bp-row')].map((row) => [...row.querySelectorAll('select[data-p="code"] option')].map((o) => o.value).join(',')).filter((x) => x && x !== ',SW'));
    pruef(fremd.length <= 1, `Abwesenheiten: Code-Auswahl im Bericht bietet dem Polier für andere mehr als SW an (${fremd.join(' | ')})`);
  }
  // Schlechtwetter melden: immer dieselbe neutrale Rückmeldung, kein Status je Person – auch wenn jemand schon abwesend ist
  await geh('/abwesenheiten');
  await page.waitForSelector('#abw-sw');
  pruef(await page.locator('#abw-andere').count() === 0, 'Schlechtwetter: Polier sieht eine Liste mit Abwesenheiten der Partie');
  await page.click('#abw-sw [data-akt="eintragen"]');
  await page.waitForSelector('dialog[open] #abw-e');
  pruef((await page.locator('#abw-e [name="code"] option').evaluateAll((o) => o.map((x) => x.value))).join() === 'SW', 'Schlechtwetter: Polier kann anderes als SW eintragen');
  await page.fill('#abw-e [name="datum"]', tag);
  await page.check(`#abw-e [name="wer"][value="${kollege.id}"]`);
  await page.check(`#abw-e [name="wer"][value="${zweiter.id}"]`);
  await h.dialogUeberlauf('schlechtwetter melden');
  const swAntworten = [];
  const swLausche = async (r) => { if (/\/api\/abwesenheiten/.test(r.url()) && r.request().method() === 'POST') { try { swAntworten.push(await r.text()); } catch (e) { /* weg */ } } };
  page.on('response', swLausche);
  await page.click('dialog[open] [type="submit"][form="abw-e"]');
  await page.waitForSelector('.toast');
  const meldung = await page.locator('.toast').first().innerText();
  pruef(/Schlechtwetter gemeldet – das Büro bestätigt\./.test(meldung), `Schlechtwetter: Rückmeldung nicht neutral („${meldung}“)`);
  await page.waitForFunction(() => !document.querySelector('dialog[open] #abw-e'));
  page.off('response', swLausche);
  pruef(swAntworten.length === 2 && swAntworten.every((t) => /Schlechtwetter gemeldet/.test(t) && !/Krank|Urlaub|abwesend|genehmigt|"code":"K"/.test(t)) && new Set(swAntworten.map((t) => t.replace(/"(meldungId|benutzerId)":\d+/g, ''))).size === 1,
    `Schlechtwetter: Antworten des Servers unterscheiden sich je Person oder nennen einen Grund (${swAntworten.join(' | ').slice(0, 300)})`);
  await h.toastWeg();
  pruef(await page.locator('#abw-andere').count() === 0 && !/abwesend|Krank/i.test((await page.locator('#view').innerText()).replace(/K\s*=\s*Krank/g, '')), 'Schlechtwetter: nach der Meldung zeigt die Seite einen Status je Person');
  const eigeneSicht = (await api('GET', `/abwesenheiten?von=${tag}&bis=${tagU}`)).json;
  pruef(Array.isArray(eigeneSicht) && eigeneSicht.every((x) => x.benutzerId === polier.id), 'Schlechtwetter: Polier erhält nach der Meldung Einträge anderer');
  await h.ueberlauf('polier schlechtwetter'); await h.shot('polier-schlechtwetter');
  await abmelden();

  /* ---- Mitarbeiter ---- */
  const ma = await anmelden('mitarbeiter');
  await rundgang('mitarbeiter', ma.benutzer.id, [`/urlaub?monat=${tag.slice(0, 7)}`, '/urlaub?ansicht=jahr', '/urlaub?ansicht=konten', '/abwesenheiten', '/einsatz', '/woche', '/stempeln', '/partie', '/kolonne', '/fuhrpark']);
  await abmelden();

  /* ---- Büro: sieht die Meldung zur Bestätigung; der Krankenstand ist unverändert ---- */
  await anmelden('buero');
  const amTag = (await api('GET', `/abwesenheiten?von=${tag}&bis=${tag}`)).json;
  const vomKollegen = amTag.find((x) => x.benutzerId === kollege.id), vomZweiten = amTag.find((x) => x.benutzerId === zweiter.id);
  pruef(vomKollegen && vomKollegen.code === 'K' && vomKollegen.status === 'genehmigt', `Schlechtwetter: der Krankenstand wurde durch die Meldung verändert (${vomKollegen && vomKollegen.code}/${vomKollegen && vomKollegen.status})`);
  pruef(vomZweiten && vomZweiten.code === 'SW' && vomZweiten.status === 'beantragt', `Schlechtwetter: die Meldung wartet nicht auf die Bestätigung des Büros (${vomZweiten && vomZweiten.code}/${vomZweiten && vomZweiten.status})`);
  await geh('/abwesenheiten');
  await page.waitForSelector('#abw-offen');
  pruef(new RegExp(zweiter.name).test(await page.locator('#abw-offen').innerText()), 'Schlechtwetter: das Büro sieht die Meldung des Poliers nicht unter den offenen Anträgen');
  await abwWeg(api, (await api('GET', `/abwesenheiten?von=${tag}&bis=${tagU}`)).json.filter((x) => [kollege.id, zweiter.id].includes(x.benutzerId)));
  await abmelden();
}

/* ================= 12.25: interne Kostenstellen (Büro, Werkstatt/Bauhof, Kieswerk/Grube) – stempelbar, aber kein Bauvorhaben ================= */
async function intern(h) {
  const { page, api, geh, pruef, g, anmelden, abmelden } = h;
  const k = KENN(g);
  await anmelden('buero');
  let alle = (await api('GET', '/baustellen')).json;
  const istIntern = (b) => b.intern === true || b.kostenstelle === 'intern';
  const buero = alle.find((b) => istIntern(b) && b.name === 'Büro');
  const echte = alle.filter((b) => !istIntern(b) && b.status === 'aktiv');
  pruef(!!buero && alle.filter(istIntern).length >= 2 && echte.length >= 2, `Intern: Kostenstelle „Büro“ oder weitere interne Kostenstellen fehlen in den Testdaten (${alle.filter(istIntern).map((b) => b.name)})`);

  /* ---- Baustellen-Liste: eigene Gruppe, nicht bei den Bauvorhaben, nicht auf der Tafel ---- */
  await geh('/baustellen');
  await page.waitForSelector('#kst-intern');
  pruef(await page.locator(`#kst-intern [data-kst-intern="${buero.id}"]`).count() === 1 && await page.locator(`.site-cards [data-bs="${buero.id}"]`).count() === 0, 'Intern: „Büro“ steht nicht in der Gruppe der internen Kostenstellen oder bei den Bauvorhaben');
  await page.click('#bs-filter [data-filter="alle"]');
  pruef(await page.locator(`.site-cards [data-bs="${buero.id}"]`).count() === 0, 'Intern: „Büro“ erscheint unter „Alle“ als Bauvorhaben');
  await page.click('[data-ansicht="tafel"]');
  await page.waitForSelector('.ll-spalte');
  pruef(await page.locator(`.ll-karte[data-bv="${buero.id}"]`).count() === 0, 'Intern: „Büro“ liegt auf der Tafel der Bauvorhaben');
  await page.click('[data-ansicht="liste"]');
  await h.ueberlauf('baustellen intern'); await h.shot('kostenstellen-intern');

  /* ---- Neue interne Kostenstelle über den Editor ---- */
  const kst = `93-10${{ H: 1, T: 2, P: 3 }[k] || 9}`, name = `E2E Lager ${k}`;
  await page.click('#neu');
  await page.waitForSelector('dialog[open] #bsf');
  await page.check('#bsf [name="intern"]', { force: true });
  pruef(await page.locator('#bsf [data-nur-bs]:visible').count() === 0 && /Bezeichnung/i.test(await page.locator('#bsf [data-name-label]').innerText()), 'Intern: der Editor zeigt bei einer internen Kostenstelle noch Felder des Bauvorhabens');
  await page.fill('#bsf [name="kst"]', kst);
  await page.fill('#bsf [name="name"]', name);
  await h.dialogUeberlauf('kostenstelle intern neu');
  await page.click('dialog[open] [type="submit"][form="bsf"]');
  await page.waitForSelector('#bs-intern-chip');
  alle = (await api('GET', '/baustellen')).json;
  const lager = alle.find((b) => b.kst === kst);
  pruef(!!lager && istIntern(lager), `Intern: neue Kostenstelle nicht als intern gespeichert (${JSON.stringify(lager || null).slice(0, 120)})`);
  // Detail: nur Stammdaten – kein Lebenslauf, kein Auftrag, keine Dokumente/Rechnungen, kein Verweis auf Berichte
  pruef(await page.locator('#lebenslauf, #auftrag, #bs-reiter, #abschluss, #lv-import').count() === 0 && await page.locator('a[href^="#/berichte?baustelleId="], a[href^="#/kalkulation/"]').count() === 0, 'Intern: die Detailseite zeigt Lebenslauf, Auftrag, Reiter oder Verweise auf Berichte/Nachkalkulation');
  await h.keinEuro('kostenstelle intern'); await h.ueberlauf('kostenstelle intern'); await h.shot('kostenstelle-intern');
  // Bearbeiten: der Schalter ist gesetzt
  await page.click('[data-akt="stamm"]');
  await page.waitForSelector('dialog[open] #bsf');
  pruef(await page.locator('#bsf [name="intern"]').isChecked(), 'Intern: der Schalter „Interne Kostenstelle“ ist beim Bearbeiten nicht gesetzt');
  await page.click('dialog[open] [data-zu]');

  /* ---- taucht nirgends als Bauvorhaben auf ---- */
  const ids = alle.filter(istIntern).map((b) => b.id);
  const inAntwort = async (pfad, lies) => { const r = await api('GET', pfad); return r.status === 200 ? lies(r.json).filter((id) => ids.includes(Number(id))) : []; };
  pruef((await inAntwort('/kalkulation', (j) => (Array.isArray(j) ? j : j.baustellen || []).map((x) => x.baustelleId ?? x.id))).length === 0, 'Intern: interne Kostenstelle in der Nachkalkulation');
  pruef((await inAntwort('/baustellen?archiv=1', (j) => j.map((x) => x.id))).length === 0, 'Intern: interne Kostenstelle im Archiv');
  await geh('/kalkulation');
  pruef(!(await h.text()).includes(name) && await page.locator(ids.map((id) => `a[href="#/kalkulation/${id}"]`).join(', ')).count() === 0, 'Intern: interne Kostenstelle in der Liste der Nachkalkulation');
  await geh('/plan');
  await page.waitForSelector('.wp-gitter, .tg-karte, .state');
  pruef(await page.locator(ids.map((id) => `[data-zelle][data-bs="${id}"]`).join(', ')).count() === 0, 'Intern: interne Kostenstelle als Zeile im Baustellenplaner');
  await geh('/plan?ansicht=zeitplan');
  pruef(!(await page.locator('#view').innerText()).includes(name), 'Intern: interne Kostenstelle im Projektzeitplan');
  await geh('/offene-posten');
  pruef(!(await page.locator('#view').innerText()).includes(name), 'Intern: interne Kostenstelle bei den offenen Posten');
  await geh('/dashboard');
  pruef(!(await page.locator('#view').innerText()).includes(name), 'Intern: interne Kostenstelle auf der Übersicht');
  await geh('/berichte');
  pruef((await page.locator('#f-bs option').evaluateAll((o) => o.map((x) => Number(x.value)))).every((id) => !ids.includes(id)), 'Intern: interne Kostenstelle im Filter der Bautagesberichte');
  await page.click('#neu');
  await page.waitForSelector('dialog[open] #nb');
  pruef((await page.locator('#nb [name="baustelleId"] option').evaluateAll((o) => o.map((x) => Number(x.value)))).every((id) => !ids.includes(id)), 'Intern: für eine interne Kostenstelle lässt sich ein Bautagesbericht anlegen');
  await page.click('dialog[open] [data-zu]');
  const verboten = await h.absichtlich(() => api('POST', '/berichte', { baustelleId: buero.id, datum: h.heute() }));
  pruef(verboten.status >= 400, `Intern: der Server legt einen Bericht für „Büro“ an (${verboten.status})`);

  /* ---- Stempeluhr: Büro ist vorgewählt, Wechsel auf eine echte Baustelle bleibt möglich; Monat und Woche zeigen die Kostenstelle ---- */
  const status = async () => (await api('GET', '/zeit/status')).json;
  let st = await status();
  if (st.status !== 'aus') { await api('POST', '/zeit/stempeln', { typ: st.status === 'pause' ? 'pause_ende' : 'gehen' }); if (st.status === 'pause') await api('POST', '/zeit/stempeln', { typ: 'gehen' }); }
  await page.evaluate(() => { localStorage.removeItem('bt_kst_standard'); });
  await geh('/dashboard'); await geh('/stempeln');
  await page.waitForSelector('[data-akt="waehlen"]');
  pruef((await status()).standardKostenstelleId === buero.id && /Büro/.test(await page.locator('[data-akt="waehlen"] .site-txt b').innerText()), `Intern: Stempeluhr des Büros schlägt nicht die Kostenstelle „Büro“ vor („${await page.locator('[data-akt="waehlen"] .site-txt').innerText()}“)`);
  await page.click('[data-akt="waehlen"]');
  await page.waitForSelector('dialog[open] .pick-list');
  pruef(await page.locator(`dialog[open] .pick-row[data-bs="${lager.id}"][data-intern]`).count() === 1 && await page.locator(`dialog[open] .pick-row[data-bs="${echte[0].id}"]:not([data-intern])`).count() === 1, 'Intern: Auswahl der Stempeluhr ohne interne Kostenstellen oder ohne echte Baustellen');
  await h.dialogUeberlauf('stempeluhr kostenstellen');
  await page.click(`dialog[open] .pick-row[data-bs="${buero.id}"]`);
  await page.click('[data-stempel="kommen"]');
  await page.waitForSelector('.clock-card[data-status="arbeit"]');
  st = await status();
  pruef(st.status === 'arbeit' && st.baustelleId === buero.id, `Intern: Kommen wurde nicht auf „Büro“ gebucht (${st.status}/${st.baustelleId})`);
  await h.ueberlauf('stempeluhr büro'); await h.shot('stempeluhr-buero');
  await page.click('[data-akt="wechsel"]');
  await page.waitForSelector('dialog[open] .pick-list');
  await page.click(`dialog[open] .pick-row[data-bs="${echte[0].id}"]`);
  await page.waitForFunction(async (id) => { const r = await fetch('/api/zeit/status'); return (await r.json()).baustelleId === id; }, echte[0].id);
  pruef((await status()).baustelleId === echte[0].id, 'Intern: Wechsel vom Büro auf eine echte Baustelle nicht gebucht');
  await h.toastWeg();
  await page.click('[data-stempel="gehen"]');
  await page.waitForFunction(async () => { const r = await fetch('/api/zeit/status'); return (await r.json()).status === 'aus'; });
  await geh('/woche');
  pruef(/Büro/.test(await page.locator('#view').innerText()), 'Intern: „Meine Woche“ nennt die Kostenstelle „Büro“ nicht');
  await geh('/benutzer');
  await abmelden();

  /* ---- Mitarbeiter: sieht interne Kostenstellen in der Auswahl der Stempeluhr, sonst nirgends ---- */
  await anmelden('mitarbeiter');
  st = await status();
  await geh('/stempeln');
  if (st.status === 'aus') {
    await page.click('[data-akt="waehlen"]');
    await page.waitForSelector('dialog[open] .pick-list');
    pruef(await page.locator('dialog[open] .pick-row[data-intern]').count() >= 1, 'Intern: Mitarbeiter findet keine interne Kostenstelle (z. B. Werkstatt) in der Stempeluhr');
    await page.click('dialog[open] [data-zu]');
  }
  await h.keinEuro('stempeln intern');
  await abmelden();

  // aufräumen: die Test-Kostenstelle abschließen
  await anmelden('buero');
  const lg = (await api('GET', `/baustellen/${lager.id}`)).json;
  await api('PUT', `/baustellen/${lager.id}`, { version: lg.version, status: 'abgeschlossen' });
  await abmelden();
}

// Reihenfolge der Abschnitte (run.js ruft sie nacheinander auf; E2E_NUR_A2=stamm,planer wählt einzelne)
const TEILE = { stamm: stammdatenUndLebenslauf, planer, dokumente: dokumenteUndRechnungen, urlaub, dienste, arbeitstag, geteilt, krank, intern, planerKorr: (h) => require('./planer-korrektur').planerKorrektur(h), restApp: (h) => require('./rest-app').restApp(h) };
module.exports = { TEILE, zieh, naechsterArbeitstag, plusTage, KENN };
