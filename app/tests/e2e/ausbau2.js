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

  /* ---- Bauleiter: nur erlaubte Ziele, Fertiggestellt → Abgenommen ---- */
  await anmelden('bauleiter');
  await geh(`/baustelle/${z.y.id}`);
  await page.click('#phase-andere');
  await page.waitForSelector('dialog[open] #phf');
  const ziele = await page.locator('#ph-ziel option').evaluateAll((o) => o.map((x) => x.value));
  pruef(ziele.includes('fertiggestellt') && ziele.includes('pausiert') && !ziele.includes('storniert') && !ziele.includes('schlussrechnung'), `A2-Leben: Bauleiter-Ziele falsch (${ziele})`);
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
  pruef(await page.locator('#abschluss [data-wert="gewaehrleistung"]').count() === 1 && await page.locator('#phase-weiter').count() === 0, 'A2-Leben: Gewährleistungs-Karte fehlt oder Bauleiter darf zur Schlussrechnung');
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
  for (const a of (await api('GET', `/abwesenheiten?von=${heute}&bis=${morgen}`)).json.filter((x) => x.benutzerId === L)) await api('DELETE', `/abwesenheiten/${a.id}`);
  const woche0 = (await api('GET', `/plan/woche?von=${morgen}&tage=5`)).json;
  pruef(Array.isArray(woche0.baustellen) && woche0.baustellen.some((b) => b.id === B), 'A2-Plan: /plan/woche ohne die Baustelle des Poliers');
  const B2 = woche0.baustellen.find((b) => b.id !== B).id;
  const frei = woche0.frei[morgen];
  const andere = frei.personen.filter((p) => p.status === 'frei' && p.rolle === 'mitarbeiter' && p.benutzerId !== L);
  const [P2, P3, P4, P5] = andere;
  const lkw = frei.anlagen.find((a) => !a.gesperrt && a.kennzeichen);
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
  pruef(emp1.length === 2 && emp1.every(([, a]) => a === 'neu') && emp1.some(([id]) => id === L) && emp1.some(([id]) => id === P2.benutzerId), `A2-Plan: Vorschau der Empfänger falsch (${JSON.stringify(emp1)})`);
  pruef(/2 Personen werden benachrichtigt/.test((await page.locator('#pub-text').innerText()).replace(/\s+/g, ' ')), 'A2-Plan: Text „2 Personen werden benachrichtigt“ fehlt');
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
  pruef(probe.empfaenger.every((e) => e.art === 'neu') && ids.includes(P3.benutzerId) && ids.includes(P5.benutzerId) && !ids.includes(P4.benutzerId) && probe.anzahl === ids.length, `A2-Fort: erste Veröffentlichung meldet nicht alle Eingeteilten bzw. die Person im Urlaub (${JSON.stringify(probe.empfaenger)})`);
  pruef((await api('POST', '/plan/veroeffentlichen', { von: di, bis: di })).status === 200, 'A2-Fort: Dienstag veröffentlichen nicht möglich');
  await page.locator(`.wp-gitter [data-zelle][data-datum="${di}"][data-bs="${B2}"] [data-chip="p"][data-id="${P5.benutzerId}"] [data-chip-auf]`).click();
  await page.waitForSelector('dialog[open] #chip-weg'); await page.click('#chip-weg'); await toastWeg();
  const probe2 = (await api('POST', '/plan/veroeffentlichen', { von: di, bis: di, vorschau: true })).json;
  pruef(probe2.anzahl === 1 && probe2.empfaenger[0].benutzerId === P5.benutzerId && probe2.empfaenger[0].art === 'entfaellt', `A2-Fort: erneute Veröffentlichung trifft nicht nur die geänderte Person (${JSON.stringify(probe2.empfaenger)})`);
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
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => !document.querySelector('#fuhren-warten'), null, { timeout: 8000 });
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
  pruef((await page.locator('#re-detail [data-wert="offen"]').innerText()).includes('6.400,00') && await page.locator('#re-zahlungen li').count() === 1, 'A2-Re: Teilzahlung nicht verbucht');
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
  // BMD: Offene Posten importieren – Datei → Spalten zuordnen → Vorschau → übernehmen
  await page.fill('#op-suche', '');
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
  await dialogUeberlauf('bmd vorschau'); await shot('bmd-vorschau');
  await page.click('#imp-ok');
  await page.waitForSelector('#imp-fertig', { timeout: 6000 }).catch(async () => pruef(false, `A2-BMD: Übernehmen scheitert: ${(await page.locator('#imp-assistent').innerText()).replace(/\s+/g, ' ').slice(-260)}`));
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
  await geh(`/urlaub?monat=${monat}`);
  const liste = g.mobil ? '#ur-partie' : '#ur-antraege';
  await page.waitForSelector(`${liste} [data-antrag="${antrag1}"]`);
  const z1 = page.locator(`${liste} [data-antrag="${antrag1}"]`).first();
  pruef(new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · Urlaub · .*${kurz(von).replace(/\./g, '\\.')}.*${kurz(bis).replace(/\./g, '\\.')}`).test((await z1.innerText()).replace(/\s+/g, ' ')) && /6 Arbeitstage/.test(await z1.innerText()), `A2-Url: Antrag nicht gruppiert dargestellt (${(await z1.innerText()).replace(/\s+/g, ' ').slice(0, 120)})`);
  pruef(await page.locator('[data-tag-entscheid], [data-entscheid]').count() === 0, 'A2-Url: es gibt Knöpfe zum Entscheiden einzelner Tage');
  if (!g.mobil) {
    // Klick auf einen Tag öffnet den ganzen Antrag; beantragt = schraffiert, genehmigt = gefüllt
    pruef(await page.locator('#ur-kalender tr[data-person]').count() >= 10 && await page.locator('#ur-kalender tr.ur-gruppe').count() >= 2 && await page.locator('#ur-legende span').count() >= 7, 'A2-Url: Team-Kalender (Zeilen, Partien, Legende) unvollständig');
    const zelleV = page.locator(`#ur-kalender [data-zelle][data-person="${L}"][data-datum="${von}"]`);
    const stilOffen = await zelleV.evaluate((e) => { const s = getComputedStyle(e); return { bild: s.backgroundImage, rand: s.borderTopStyle, farbe: s.backgroundColor }; });
    await ueberlauf('urlaub monat'); await shot('urlaub-monat');
    await zelleV.click();
    await page.waitForSelector(`dialog[open] #ur-eintrag [data-antrag="${antrag1}"]`);
    pruef(/6 Arbeitstage/.test(await page.locator('#ur-eintrag').innerText()) && await page.locator('#ur-eintrag [data-tag-entscheid], #ur-eintrag [data-entscheid]').count() === 0 && await page.locator('#ur-eintrag .an-tage li').count() === 6, 'A2-Url: Tag öffnet nicht den ganzen Antrag (Tagesliste nur zur Ansicht)');
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
  await page.locator('#an-korr [name="tag"]').last().check();
  await dialogUeberlauf('urlaub korrigieren'); await shot('urlaub-korrigieren');
  await page.click('#an-korr-ok');
  await page.waitForSelector('dialog[open] [data-ok]'); await page.locator('dialog[open] [data-ok]').last().click();
  await page.waitForFunction(() => !document.querySelector('dialog[open] #an-korr'));
  await toastWeg();
  const tage3 = (await api('GET', `/abwesenheiten?von=${von}&bis=${bis}`)).json.filter((a) => a.benutzerId === L);
  const kontoNach = (await api('GET', `/urlaub/konto?jahr=${jahr}&benutzerId=${L}`)).json[0];
  pruef(tage3.length === 5 && !tage3.some((a) => a.datum === bis) && Math.abs((kontoNach.geplant + kontoNach.genommen) - (kontoVor.geplant + kontoVor.genommen) - 5) < 0.001, `A2-Url: Korrektur entfernt den Tag nicht oder das Konto rechnet nicht neu (Tage ${tage3.length}, geplant ${kontoVor.geplant} → ${kontoNach.geplant})`);
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
  await keinEuro('urlaub mitarbeiter 2'); await ueberlauf('urlaub mitarbeiter 2');
  await abmelden();

  /* ---- Polier: Abwesenheiten der eigenen Partie, Krank nicht im Klartext, keine € ---- */
  await anmelden('polier');
  await geh(`/urlaub?monat=${monat}`);
  if (g.mobil) {
    await page.waitForSelector('#ur-partie');
    pruef(/Meine Partie – Abwesenheiten/i.test(await page.locator('#ur-partie h2').innerText()) && await page.locator(`#ur-partie [data-antrag]:has-text("${name}")`).count() >= 1, 'A2-Url: Polier (Handy) sieht „Meine Partie – Abwesenheiten“ nicht');
  } else {
    await page.waitForSelector('#ur-kalender');
    pruef(await page.locator(`#ur-kalender tr[data-person="${L}"]`).count() === 1 && await page.locator('#ur-bu').count() === 0, 'A2-Url: Polier sieht seine Partie nicht oder darf Betriebsurlaub eintragen');
    pruef(await page.locator('#ur-kalender [data-code="K"]').count() === 0, 'A2-Url: Polier sieht „Krank“ im Klartext');
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

// Reihenfolge der Abschnitte (run.js ruft sie nacheinander auf; E2E_NUR_A2=stamm,planer wählt einzelne)
const TEILE = { stamm: stammdatenUndLebenslauf, planer, dokumente: dokumenteUndRechnungen, urlaub, dienste };
module.exports = { TEILE, zieh, naechsterArbeitstag, plusTage, KENN };
