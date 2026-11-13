'use strict';
// BauTag – E2E-Prüfungen „Fuhrpark & Geräte“ (Servicebuch) und „Schäden mit Fotos“.
// Wird von run.js je Rolle und Bildschirmgröße aufgerufen; h = Werkzeuge des Laufs (page, api, geh, pruef, …),
// z = gemeinsamer Zustand über die Rollen hinweg (z. B. die Nummer der gemeldeten Schadensmeldung).

const dlgZu = (page) => page.waitForFunction(() => !document.querySelector('dialog[open]'), null, { timeout: 15000 });
const finde = (liste, muster) => (liste || []).find((a) => muster.test(a.bezeichnung));
const anlagen = async (h) => (await h.api('GET', '/fuhrpark/anlagen')).json || [];
const sichtbar = (page, sel) => page.locator(`${sel}:visible`);

// Testfoto (PNG, 2400 × 1800) im Browser erzeugen – wird von der Oberfläche auf max. 1600 px verkleinert
async function testBild(page, farbe, text) {
  const url = await page.evaluate(([f, t]) => {
    const c = document.createElement('canvas'); c.width = 2400; c.height = 1800;
    const g = c.getContext('2d'); g.fillStyle = f; g.fillRect(0, 0, 2400, 1800);
    for (let i = 0; i < 60; i++) { g.fillStyle = `hsl(${(i * 37) % 360} 70% ${30 + (i % 5) * 10}%)`; g.fillRect((i * 173) % 2300, (i * 97) % 1700, 180, 120); }
    g.fillStyle = '#fff'; g.font = 'bold 160px sans-serif'; g.fillText(t, 200, 900);
    return c.toDataURL('image/png');
  }, [farbe, text]);
  return { name: `${text}.png`, mimeType: 'image/png', buffer: Buffer.from(url.split(',')[1], 'base64') };
}
const reiterIds = (page) => page.evaluate(() => [...document.querySelectorAll('.fp-tabs [data-reiter]')].map((b) => b.dataset.reiter));
const geladen = (page) => page.evaluate(() => [...document.querySelectorAll('dialog[open] img, #view img')].every((i) => i.complete && i.naturalWidth > 0));

// Schaden über die Oberfläche melden. start = Funktion, die den Dialog öffnet.
async function meldeSchaden(h, { start, suche, fremd, fotos = [], art = 'defekt', ursache, einsatz = 'ja', wo }) {
  const { page, pruef } = h;
  await start();
  await page.waitForSelector('#schaden-dlg[open]');
  if (suche || fremd) {
    await page.waitForSelector('#schaden-dlg #sm-suche');
    if (fremd) { await page.click('#schaden-dlg [data-sm-fremd-auf]'); await page.fill('#sm-fremd', fremd); await page.click('#schaden-dlg [data-sm-fremd-ok]'); }
    else { await page.fill('#sm-suche', suche); await page.locator('#schaden-dlg [data-sm-anlage]').first().click(); }
  }
  await page.waitForSelector('#schaden-dlg #sm-galerie', { state: 'attached' });
  const kamera = page.locator('#schaden-dlg #sm-kamera');
  pruef((await kamera.getAttribute('accept')) === 'image/*' && (await kamera.getAttribute('capture')) === 'environment' && (await kamera.getAttribute('multiple')) != null, `[${wo}] Foto-Eingabe ohne accept/capture/multiple`);
  if (fotos.length) {
    await page.setInputFiles('#schaden-dlg #sm-galerie', fotos);
    await page.waitForFunction((n) => document.querySelectorAll('#schaden-dlg .sm-foto[data-foto]').length === n && !document.querySelector('#schaden-dlg .sm-foto.laedt'), fotos.length, { timeout: 20000 });
  }
  await h.dialogUeberlauf(`${wo} schaden fotos`); await h.shot(`${wo}-schaden-fotos`);
  await page.click('#schaden-dlg [data-sm-geh="3"]');
  // Ursache ist Pflicht
  await page.click('#schaden-dlg [data-sm-weiter3]');
  pruef(await sichtbar(page, '#schaden-dlg .form-err').count() === 1, `[${wo}] Schaden ohne Art/Ursache: keine Fehlermeldung`);
  await page.click(`#schaden-dlg [data-sm-art="${art}"]`);
  await page.fill('#sm-ursache', ursache);
  await h.dialogUeberlauf(`${wo} schaden ursache`); await h.shot(`${wo}-schaden-ursache`);
  await page.click('#schaden-dlg [data-sm-weiter3]');
  await page.waitForSelector(`#schaden-dlg [data-sm-einsatz="${einsatz}"]`);
  await page.click(`#schaden-dlg [data-sm-einsatz="${einsatz}"]`);
  if (einsatz === 'nein') pruef(await sichtbar(page, '#schaden-dlg #sm-warn').count() === 1, `[${wo}] „Nein – stilllegen“ ohne deutliche Warnung`);
  await h.dialogUeberlauf(`${wo} schaden einsatz`); await h.shot(`${wo}-schaden-einsatz`);
  await page.click('#schaden-dlg [data-sm-senden]');
  if (einsatz === 'nein') { await page.waitForSelector('dialog[open] [data-ok]'); await page.click('dialog[open] [data-ok]'); }
  await page.waitForFunction(() => !document.querySelector('#schaden-dlg'), null, { timeout: 30000 });
}

/* ================= Mitarbeiter (ohne Sonderrechte) ================= */
async function mitarbeiter(h, z) {
  const { page, context, g, api, geh, pruef, shot, keinEuro, sleep } = h;
  const nav = await h.navIds();
  pruef(nav.includes('fuhrpark'), `Fuhrpark: Menüpunkt fehlt für Mitarbeiter (${nav})`);
  if (g.mobil) {
    pruef(await page.locator('#nav-tab [data-nav="fuhrpark"]').count() === 0, 'Fuhrpark: am Handy soll der Einstieg unter „Mehr“ liegen, nicht in der Tab-Leiste');
    await geh('/mehr');
    pruef(await page.locator('.menu-list a[href="#/fuhrpark"]').count() === 1, 'Fuhrpark: Eintrag unter „Mehr“ fehlt');
    pruef(await sichtbar(page, '#mehr-schaden').count() === 1, 'Schaden melden: großer Knopf unter „Mehr“ fehlt');
  }
  await geh('/stempeln');
  pruef(await sichtbar(page, '#schaden-kurz').count() === 1, 'Schaden melden: Abkürzung auf der Stempeluhr fehlt');

  /* Geräteliste: nur Geräte + Schäden, keine Pflege, kein € */
  await geh('/fuhrpark', 'fuhrpark-mitarbeiter');
  let reiter = await reiterIds(page);
  pruef(reiter.join() === 'geraete,schaeden', `Fuhrpark Mitarbeiter: Reiter ${reiter} (erwartet: geraete, schaeden)`);
  await keinEuro('fuhrpark mitarbeiter');
  let alle = await anlagen(h);
  pruef(alle.length >= 20, `Fuhrpark: Demo-Fuhrpark zu klein (${alle.length})`);
  pruef(!/kosten|verrechnungssatz/i.test(JSON.stringify(alle)), 'Fuhrpark Mitarbeiter: Server liefert €-Felder in der Geräteliste');
  pruef((await api('GET', '/fuhrpark/uebersicht')).status === 403 && (await api('GET', '/fuhrpark/fristen')).status === 403 && (await api('GET', '/fuhrpark/eintraege')).status === 403, 'Fuhrpark Mitarbeiter: Übersicht/Fristen/Einträge nicht gesperrt');
  if (g.mobil) pruef(await sichtbar(page, '.fp-card').count() >= 5 && await sichtbar(page, '#fp-tabelle').count() === 0, 'Fuhrpark Handy: Karten statt Tabelle erwartet');
  else pruef(await sichtbar(page, '#fp-tabelle tbody tr').count() === alle.length && await sichtbar(page, '.fp-card').count() === 0, 'Fuhrpark Tablet/PC: Tabelle mit allen Geräten erwartet');
  const zeilen = g.mobil ? '#fp-alle .fp-card' : '#fp-tabelle tbody tr';
  // Ampel: Symbol + Wort, alle Zustände der Demo vorhanden
  const zust = await page.evaluate((s) => [...new Set([...document.querySelectorAll(s)].map((x) => x.dataset.status))], zeilen);
  pruef(['einsatzbereit', 'bald', 'faellig', 'gesperrt'].every((s) => zust.includes(s)), `Fuhrpark: nicht alle Ampel-Zustände in der Liste (${zust})`);
  pruef(await page.evaluate((s) => [...document.querySelectorAll(s + ' [data-fp-status]')].every((c) => c.querySelector('svg') && c.textContent.trim().length > 3), zeilen), 'Fuhrpark: Ampel ohne Symbol + Wort');
  // Filter nach Art
  const nLkw = alle.filter((a) => a.klasse === 'lkw').length;
  await page.click('.fp-arten [data-art="lkw"]');
  pruef(await sichtbar(page, zeilen).count() === nLkw, `Fuhrpark: Filter LKW zeigt ${await sichtbar(page, zeilen).count()} statt ${nLkw}`);
  const nBm = alle.filter((a) => ['baumaschine', 'walze', 'brecher'].includes(a.klasse)).length;
  await page.click('.fp-arten [data-art="baumaschine"]');
  pruef(await sichtbar(page, zeilen).count() === nBm, 'Fuhrpark: Filter Baumaschine stimmt nicht');
  for (const art of ['pkw', 'bus', 'anhaenger', 'kleingeraet']) pruef(await page.locator(`.fp-arten [data-art="${art}"]`).count() === 1, `Fuhrpark: Filter „${art}“ fehlt`);
  await h.ueberlauf('fuhrpark filter'); await shot('fuhrpark-filter');
  await page.click('.fp-arten [data-art=""]');

  /* Mangel melden – wenige Tipps, große Knöpfe */
  const dumper = finde(alle, /Dumper/);
  await page.click('[data-akt="mangel"]');
  await page.waitForSelector('#mangel-dlg #mm-suche');
  await page.fill('#mm-suche', 'Dumper');
  await page.locator('#mangel-dlg [data-mm-anlage]').first().click();
  await page.fill('#mm-text', 'E2E: Rückfahrwarner piept nicht mehr');
  await h.dialogUeberlauf('mangel text'); await shot('mangel-text');
  await page.click('#mangel-dlg [data-mm-weiter]');
  await page.waitForSelector('#mangel-dlg [data-dring="bald"]');
  pruef(await page.evaluate(() => [...document.querySelectorAll('#mangel-dlg [data-dring]')].every((b) => b.getBoundingClientRect().height >= 64)), 'Mangel melden: Dringlichkeits-Knöpfe zu klein');
  await h.dialogUeberlauf('mangel dringlichkeit'); await shot('mangel-dringlichkeit');
  await page.click('#mangel-dlg [data-dring="bald"]');
  await dlgZu(page); await h.bereit();
  let eigene = (await api('GET', '/fuhrpark/maengel')).json || [];
  pruef(eigene.some((m) => /Rückfahrwarner/.test(m.text) && m.anlageId === dumper.id && m.dringlichkeit === 'bald' && m.status === 'offen'), 'Mangel melden: Meldung nicht am Server');
  // „Sofort stilllegen“ sperrt die zweite Rüttelplatte (wird später im Bautagesbericht gebraucht)
  const platte = finde(alle, /Bomag BPR/);
  z.platteId = platte.id;
  await geh(`/fuhrpark/anlage/${platte.id}`, 'anlage-mitarbeiter');
  pruef(await page.locator('[data-ar="servicebuch"]').count() === 0 && await page.locator('[data-akt="eintrag"]').count() === 0, 'Anlage Mitarbeiter: Servicebuch/Eintrag sichtbar ohne Leserecht');
  pruef(await sichtbar(page, '[data-akt="mangel"]').count() === 1 && await sichtbar(page, '[data-akt="schaden"]').count() === 1, 'Anlage Mitarbeiter: Knöpfe „Mangel melden“/„Schaden melden“ fehlen');
  await keinEuro('anlage mitarbeiter');
  await page.click('[data-akt="mangel"]');
  await page.waitForSelector('#mangel-dlg #mm-text');
  await page.fill('#mm-text', 'E2E: Erregerwelle gebrochen');
  await page.click('#mangel-dlg [data-mm-weiter]');
  await page.click('#mangel-dlg [data-dring="sofort"]');
  await page.waitForSelector('dialog[open] [data-ok]');
  await page.click('dialog[open] [data-ok]');
  await dlgZu(page); await h.bereit();
  await page.waitForSelector('#fp-kopf[data-status="gesperrt"]');
  pruef(await sichtbar(page, '#fp-sperre').count() === 1, 'Mangel „sofort“: Sperr-Hinweis fehlt an der Anlage');
  pruef((await anlagen(h)).find((a) => a.id === platte.id).status === 'gesperrt', 'Mangel „sofort“: Anlage am Server nicht gesperrt');
  await h.ueberlauf('anlage gesperrt'); await shot('anlage-gesperrt'); await h.toastWeg();

  /* Zählerstand: große Eingabe, letzter Stand, Warnung vor dem Senden */
  const bus = finde(alle, /Crafter/);
  await geh(`/fuhrpark/anlage/${bus.id}`);
  const vorher = (await api('GET', `/fuhrpark/anlagen/${bus.id}`)).json.zaehler.find((x) => x.art === 'km');
  await page.click('[data-akt="zaehlerstand"]');
  await page.waitForSelector('#zaehler-dlg .zs-wert');
  pruef(/Letzter Stand/.test(await page.locator('#zaehler-dlg .zs-letzt').innerText()), 'Zählerstand: letzter Stand wird nicht angezeigt');
  pruef(await page.evaluate(() => document.querySelector('#zaehler-dlg .zs-wert').getBoundingClientRect().height >= 60), 'Zählerstand: Eingabe nicht groß');
  await page.fill('#zaehler-dlg .zs-wert', String(Math.round(vorher.letzterStand.anzeige - 500)));
  pruef(await sichtbar(page, '#zaehler-dlg .zs-warn.hart').count() === 1, 'Zählerstand: keine Warnung bei kleinerem Stand');
  await page.click('#zaehler-dlg button[type="submit"]');
  pruef(await page.locator('#zaehler-dlg').count() === 1, 'Zählerstand: kleinerer Stand wurde abgeschickt');
  await h.dialogUeberlauf('zaehlerstand'); await shot('zaehlerstand-warnung');
  const neuerStand = Math.round(vorher.letzterStand.anzeige + 120);
  await page.fill('#zaehler-dlg .zs-wert', String(neuerStand));
  await page.click('#zaehler-dlg button[type="submit"]');
  await dlgZu(page); await h.bereit();
  const nachher = (await api('GET', `/fuhrpark/anlagen/${bus.id}`)).json.zaehler.find((x) => x.art === 'km');
  pruef(nachher.letzterStand.anzeige === neuerStand, `Zählerstand: nicht gespeichert (${nachher.letzterStand.anzeige} statt ${neuerStand})`);
  await h.toastWeg();

  /* Schaden mit 2 Fotos melden */
  const fotos = [await testBild(page, '#7a4b2a', 'schaden-1'), await testBild(page, '#2a4b7a', 'schaden-2'), await testBild(page, '#2a7a4b', 'schaden-3')];
  await geh(g.mobil ? '/stempeln' : '/fuhrpark');
  const URSACHE = 'E2E: Beim Rückwärtsfahren am Bordstein hängen geblieben, Hydraulikschlauch abgerissen';
  await meldeSchaden(h, {
    wo: 'ma', start: async () => { await page.click(g.mobil ? '#schaden-kurz' : '[data-akt="schaden"]'); },
    suche: 'CAT 320', fotos: fotos.slice(0, 2), art: 'unfall', ursache: URSACHE, einsatz: 'eingeschraenkt',
  });
  await h.bereit();
  let meine = (await api('GET', '/fuhrpark/schaeden')).json || [];
  const sch = meine.find((s) => s.ursache === URSACHE);
  pruef(!!sch && sch.fotos.length === 2 && sch.art === 'unfall' && sch.einsatzfaehig === 'eingeschraenkt' && sch.status === 'gemeldet' && /CAT 320/.test(sch.anlage.bezeichnung), `Schaden melden: Meldung mit 2 Fotos nicht am Server (${JSON.stringify(sch && { f: sch.fotos.length, a: sch.art })})`);
  if (!sch) throw new Error('Schadensmeldung nicht am Server – Folgeprüfungen nicht möglich');
  z.schadenId = sch.id; z.schadenAnlageId = sch.anlageId; z.fotoUrl = sch.fotos[0].url; z.ursache = URSACHE;
  pruef(sch.baustelleId != null, 'Schaden melden: Baustelle nicht vorbelegt');
  // Foto: am Gerät verkleinert (max. 1600 px), als JPEG, über die geschützte API-Adresse abrufbar
  const bild = await page.evaluate(async (u) => { const r = await fetch(u); const b = await r.blob(); const i = await createImageBitmap(b); return { status: r.status, typ: r.headers.get('content-type'), b: i.width, h: i.height, kb: Math.round(b.size / 1024) }; }, z.fotoUrl);
  pruef(bild.status === 200 && /jpeg/.test(bild.typ) && Math.max(bild.b, bild.h) === 1600 && bild.kb < 1500, `Schaden-Foto: nicht verkleinert/JPEG (${JSON.stringify(bild)})`);
  await geh('/fuhrpark?reiter=schaeden', 'schaeden-mitarbeiter');
  await keinEuro('schäden mitarbeiter');
  pruef(await page.locator('#sch-filter').count() === 0, 'Schäden Mitarbeiter: Filter der Gesamtliste sichtbar (nur eigene Meldungen erwartet)');
  pruef(await sichtbar(page, `[data-schaden="${sch.id}"]`).count() === 1, 'Schäden: eigene Meldung fehlt in der Liste');
  await sichtbar(page, `[data-schaden="${sch.id}"]`).click();
  await page.waitForSelector('#schaden-detail #sd-galerie img');
  await page.waitForFunction(() => [...document.querySelectorAll('#sd-galerie img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 10000 }).catch(() => {});
  pruef(await page.locator('#sd-galerie img').count() === 2 && await geladen(page), 'Schaden-Detail: Galerie zeigt nicht 2 geladene Fotos');
  pruef(await page.locator('#schaden-detail .sd-bearb').count() === 0, 'Schaden-Detail: Mitarbeiter sieht Bearbeitung');
  await h.dialogUeberlauf('schaden detail'); await shot('schaden-detail-mitarbeiter');
  await page.click('#sd-galerie [data-foto="0"]');
  await page.waitForSelector('#lichtkasten img');
  await page.waitForFunction(() => { const i = document.querySelector('#lichtkasten img'); return i && i.complete && i.naturalWidth > 0; });
  await page.click('#lichtkasten [data-lb="1"]');
  pruef(/Foto 2 von 2/.test(await page.locator('#lichtkasten h2').innerText()), 'Lichtkasten: Blättern funktioniert nicht');
  await shot('schaden-lichtkasten');
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));

  /* Ohne Netz: Meldung samt Foto wartet am Gerät und wird ohne Duplikat nachgesendet */
  const URS2 = 'E2E offline: Spiegel links abgebrochen, in der Einfahrt gestreift';
  const anzahlVor = meine.length;
  await context.setOffline(true);
  await h.absichtlich(async () => {
    await meldeSchaden(h, { wo: 'offline', start: async () => { await page.click('.sch-melden'); }, suche: 'Octavia', fotos: fotos.slice(2), art: 'beschaedigung_dritte', ursache: URS2, einsatz: 'ja' });
    await page.waitForSelector('#sch-warten [data-wartet]', { timeout: 15000 });
  });
  pruef(/wartet auf Verbindung/.test(await page.locator('#sch-warten').innerText()), 'Offline-Schaden: Zustand „wartet auf Verbindung“ nicht sichtbar');
  await page.waitForFunction(() => [...document.querySelectorAll('.nav-badge')].some((b) => b.dataset.wartet === '1'), null, { timeout: 8000 }).catch(() => {});
  pruef(await page.evaluate(() => [...document.querySelectorAll('.nav-badge')].some((b) => b.dataset.wartet === '1' && !b.hidden)), 'Offline-Schaden: Zahl am Menüpunkt fehlt');
  await h.ueberlauf('schäden offline'); await shot('schaeden-offline'); await h.toastWeg();
  await context.setOffline(false);
  // Antwort des Servers geht verloren (Meldung ist am Server, das Gerät weiß es nicht) → erneutes Senden darf nichts verdoppeln
  let verloren = 0;
  await page.route('**/api/fuhrpark/schaeden', async (r) => { if (r.request().method() !== 'POST') return r.continue(); verloren++; try { await r.fetch(); } catch (e) { /* egal */ } return r.abort('connectionreset'); });
  await h.absichtlich(async () => { await page.click('[data-sch-senden]'); await sleep(1200); });
  await page.unroute('**/api/fuhrpark/schaeden');
  pruef(verloren >= 1, 'Offline-Schaden: Test-Vorbedingung – Senden wurde nicht versucht');
  pruef(await page.locator('#sch-warten [data-wartet]').count() === 1, 'Offline-Schaden: Meldung nach verlorener Antwort nicht mehr in der Warteschlange');
  await page.click('[data-sch-senden]');
  await page.waitForFunction(() => !document.querySelector('#sch-warten [data-wartet]'), null, { timeout: 20000 });
  await h.bereit();
  meine = (await api('GET', '/fuhrpark/schaeden')).json || [];
  const off = meine.filter((s) => s.ursache === URS2);
  pruef(off.length === 1 && meine.length === anzahlVor + 1, `Offline-Schaden: ${off.length} Meldungen am Server statt genau einer (gesamt ${meine.length}, vorher ${anzahlVor})`);
  pruef(off[0] && off[0].fotos.length === 1, `Offline-Schaden: Foto fehlt oder doppelt (${off[0] && off[0].fotos.length})`);
  pruef(await page.evaluate(() => [...document.querySelectorAll('.nav-badge')].every((b) => b.dataset.wartet !== '1')), 'Offline-Schaden: Zahl am Menüpunkt bleibt nach dem Senden stehen');
  await h.toastWeg();
}

/* ================= Fremder Mitarbeiter: darf Meldung und Fotos nicht öffnen ================= */
async function fremder(h, z) {
  const { page, api, geh, pruef } = h;
  const r = await api('GET', `/fuhrpark/schaeden/${z.schadenId}`);
  pruef(r.status === 403, `Fremder Mitarbeiter: Schadensmeldung abrufbar (Status ${r.status})`);
  const f = await h.absichtlich(() => page.evaluate(async (u) => (await fetch(u)).status, z.fotoUrl));
  pruef(f === 403, `Fremder Mitarbeiter: Foto abrufbar (Status ${f})`);
  pruef(!((await api('GET', '/fuhrpark/schaeden')).json || []).some((s) => s.id === z.schadenId), 'Fremder Mitarbeiter: fremde Meldung in der eigenen Liste');
  await h.absichtlich(async () => { await geh(`/fuhrpark?reiter=schaeden&schaden=${z.schadenId}`, 'schaden-fremd'); await page.waitForSelector('.toast'); });
  pruef(await page.locator('#schaden-detail').count() === 0, 'Fremder Mitarbeiter: Detail der fremden Meldung wird angezeigt');
  pruef(await page.locator(`[data-schaden="${z.schadenId}"]`).count() === 0, 'Fremder Mitarbeiter: fremde Meldung steht in der Liste');
  await h.keinEuro('schäden fremder mitarbeiter');
  await h.toastWeg();
}

/* ================= Polier: Leserecht Servicebuch, nie € ================= */
async function polier(h, z) {
  const { page, g, api, geh, pruef, shot, keinEuro } = h;
  const ich = (await api('GET', '/auth/ich')).json;
  const pflegt = ich.rechte.includes('fuhrpark');
  await geh('/fuhrpark', 'fuhrpark-polier');
  await keinEuro('fuhrpark polier');
  const reiter = await reiterIds(page);
  pruef(pflegt ? reiter.join() === 'uebersicht,geraete,fristen,schaeden,vorlagen' : reiter.join() === 'geraete,schaeden', `Fuhrpark Polier: Reiter ${reiter}`);
  const alle = await anlagen(h);
  const bagger = finde(alle, /CAT 320/);
  for (const pfad of ['/fuhrpark/anlagen', `/fuhrpark/anlagen/${bagger.id}`, `/fuhrpark/eintraege?anlageId=${bagger.id}`, '/fuhrpark/schaeden', '/fuhrpark/maengel']) {
    const r = await api('GET', pfad);
    pruef(r.status === 200 && !/kosten|verrechnungssatz/i.test(JSON.stringify(r.json)), `Fuhrpark Polier: €-Felder in ${pfad} (Status ${r.status})`);
  }
  await geh(`/fuhrpark/anlage/${bagger.id}?reiter=servicebuch`, 'servicebuch-polier');
  pruef(await page.locator('#fp-zeitleiste li[data-typ="eintrag"]').count() >= 1, 'Polier: Servicebuch-Zeitleiste ohne Einträge');
  pruef(await page.locator('#fp-pdf-kosten').count() === 0, 'Polier: „PDF mit Kosten“ sichtbar');
  await keinEuro('servicebuch polier');
  const pdf = await page.evaluate(async (id) => { const r = await fetch(`/api/fuhrpark/anlagen/${id}/servicebuch.pdf`); return { status: r.status, typ: r.headers.get('content-type') }; }, bagger.id);
  pruef(pdf.status === 200 && /pdf/.test(pdf.typ), `Polier: Servicebuch-PDF nicht abrufbar (${JSON.stringify(pdf)})`);
  const pdfK = await h.absichtlich(() => page.evaluate(async (id) => (await fetch(`/api/fuhrpark/anlagen/${id}/servicebuch.pdf?kosten=1`)).status, bagger.id));
  pruef(pdfK === 403, `Polier: PDF mit Kosten nicht gesperrt (${pdfK})`);
  for (const r of ['plan', 'zaehler', 'uebersicht']) { await geh(`/fuhrpark/anlage/${bagger.id}?reiter=${r}`, `anlage-polier-${r}`); await keinEuro(`anlage polier ${r}`); }
  if (pflegt) {
    await geh('/fuhrpark?reiter=uebersicht', 'fuhrpark-uebersicht-polier'); await keinEuro('fuhrpark übersicht polier');
    pruef(await page.locator('#fp-kosten').count() === 0, 'Polier mit fuhrpark: Kostenzeile sichtbar');
    await geh('/fuhrpark?reiter=fristen', 'fristen-polier'); await keinEuro('fristen polier');
    // Eintrag erfassen: ohne Kostenfelder; Kosten mitsenden lehnt der Server ab
    await geh(`/fuhrpark/anlage/${bagger.id}`);
    await page.click('[data-akt="eintrag"]');
    await page.waitForSelector('#eintrag-dlg #eb-f');
    pruef(await page.locator('#eintrag-dlg [name="kosten"]').count() === 0 && await page.locator('#eintrag-dlg [name="rechnungNr"]').count() === 0, 'Polier mit fuhrpark: Kostenfelder im Eintrag sichtbar');
    await keinEuro('eintrag polier'); await h.dialogUeberlauf('eintrag polier'); await shot('eintrag-polier');
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    const stand = (await api('GET', `/fuhrpark/anlagen/${bagger.id}`)).json.zaehler[0];
    const mitKosten = await h.absichtlich(() => api('POST', '/fuhrpark/eintraege', { anlageId: bagger.id, art: 'sonstiges', datum: h.heute(), werkstatt: 'intern', titel: 'E2E Kosten', kosten: 10, zaehler: [{ art: stand.art, anzeige: Math.ceil(stand.aktuell) + 1 }] }));
    pruef(mitKosten.status === 400, `Polier mit fuhrpark: Kosten senden nicht abgelehnt (${mitKosten.status})`);
  }
  // Der Polier sieht die Meldung aus seinem Bereich bzw. bekommt beim Gerät die Sperre angezeigt
  await geh(`/fuhrpark/anlage/${z.platteId}`, 'anlage-gesperrt-polier');
  pruef(await page.locator('#fp-kopf[data-status="gesperrt"]').count() === 1, 'Polier: gesperrte Rüttelplatte nicht als gesperrt angezeigt');
  await keinEuro('anlage gesperrt polier');
  if (g.mobil) pruef(await sichtbar(page, '.fp-kopf-akt [data-akt="mangel"]').count() === 1, 'Polier Handy: „Mangel melden“ fehlt');
}

/* Bautagesbericht, Schritt Geräte: Auswahl bei mehreren Anlagen, Warnung bei gesperrter Anlage (Stunden danach wieder auf 0) */
async function berichtGeraete(h, z, berichtId) {
  const { page, api, pruef, shot } = h;
  const kat = (await api('GET', '/geraete')).json;
  const typ = kat.find((x) => (x.anlagen || []).some((a) => a.id === z.platteId));
  pruef(!!typ && typ.anlagen.length >= 2, 'Bericht: Gerätezeile der Rüttelplatten hat nicht mehrere Anlagen (Testdaten)');
  if (!typ) return;
  const zeile = page.locator(`.pf-g[data-g="${typ.id}"]`);
  await zeile.locator('[data-d="1"]').click();
  const wahl = page.locator(`[data-ga="${typ.id}"]`);
  await wahl.locator('[data-anlage-wahl]').first().waitFor();
  pruef(await wahl.locator('[data-anlage-wahl]').count() === typ.anlagen.length, 'Bericht: Auswahl der Anlage zeigt nicht alle Geräte dieser Zeile');
  pruef(await wahl.locator(`[data-anlage-wahl="${typ.id}:${z.platteId}"] svg`).count() === 1, 'Bericht: gesperrte Anlage ohne Schloss-Symbol in der Auswahl');
  await wahl.locator(`[data-anlage-wahl="${typ.id}:${z.platteId}"]`).click();
  await page.waitForSelector(`[data-anlage-gesperrt="${z.platteId}"]`);
  await page.waitForSelector('#anlage-hinweise:not([hidden])', { timeout: 8000 });
  pruef(/gesperrt/i.test(await page.locator('#anlage-hinweise').innerText()), 'Bericht: Hinweis des Servers auf die gesperrte Anlage fehlt');
  let ber = (await api('GET', `/berichte/${berichtId}`)).json;
  pruef((ber.geraete.find((x) => x.geraetId === typ.id) || {}).anlageId === z.platteId, 'Bericht: gewählte Anlage nicht gespeichert');
  await h.ueberlauf('bericht gesperrte anlage'); await shot('bericht-anlage-gesperrt'); await h.keinEuro('bericht gesperrte anlage');
  // Andere (freie) Anlage wählen → Warnung verschwindet
  const frei = typ.anlagen.find((a) => a.id !== z.platteId && !a.gesperrt);
  if (frei) {
    await wahl.locator(`[data-anlage-wahl="${typ.id}:${frei.id}"]`).click();
    await page.waitForFunction((id) => !document.querySelector(`[data-anlage-gesperrt="${id}"]`), z.platteId);
    await page.waitForSelector('#anlage-hinweise[hidden]', { state: 'attached', timeout: 8000 }).catch(() => {});
    pruef(await page.locator('#anlage-hinweise:not([hidden])').count() === 0, 'Bericht: Warnung bleibt nach Wechsel auf freie Anlage stehen');
  }
  await zeile.locator('[data-d="-1"]').click(); // zurück auf 0 Std. – die übrigen Prüfungen erwarten genau zwei Gerätezeilen
  await page.waitForFunction((id) => !document.querySelector(`[data-ga="${id}"] [data-anlage-wahl]`), typ.id);
}

/* ================= Büro: Übersicht, Fristen, Eintrag mit Zählerstand, Schaden bearbeiten, Exporte ================= */
async function buero(h, z) {
  const { page, g, api, geh, pruef, shot, sleep } = h;
  /* Erinnerungen in der Glocke */
  const meld = (await api('GET', '/benachrichtigungen')).json || [];
  const fp = meld.filter((m) => m.typ === 'fuhrpark');
  pruef(fp.length >= 3, `Glocke: zu wenige Fuhrpark-Meldungen (${fp.length})`);
  pruef(fp.some((m) => /stillgelegt|gesperrt/i.test(m.titel + m.text)), 'Glocke: Meldung zur Stilllegung fehlt');
  pruef(fp.some((m) => /Schaden gemeldet/i.test(m.titel)), 'Glocke: Meldung „Schaden gemeldet“ fehlt');
  pruef(fp.some((m) => /bald|fällig|überfällig/i.test(m.titel)), `Glocke: Erinnerung an Fristen fehlt (${fp.slice(0, 6).map((m) => m.titel).join(' | ')})`);
  pruef(!fp.some((m) => /€|EUR/.test(m.titel + m.text)), 'Glocke: Fuhrpark-Meldung enthält €');
  await geh('/fuhrpark?reiter=geraete');
  await page.click('#glocke');
  await page.waitForSelector('#notif-panel .notif');
  pruef(await page.locator('#notif-panel .notif.t-fuhrpark').count() >= 3, 'Glocke: Fuhrpark-Meldungen werden nicht angezeigt');
  await shot('glocke-fuhrpark');
  const mitAnlage = fp.find((m) => m.anlageId && !m.schadenId);
  if (mitAnlage) {
    await page.click(`#notif-panel [data-auf="${mitAnlage.id}"]`);
    await page.waitForFunction((id) => location.hash.startsWith(`#/fuhrpark/anlage/${id}`), mitAnlage.anlageId);
    await h.bereit();
  } else await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  pruef(await page.evaluate(() => [...document.querySelectorAll('.nav-badge')].some((b) => Number(b.dataset.neu) >= 1 && !b.hidden)), 'Menü: Zahl neuer Schadensmeldungen fehlt');

  /* Übersicht mit Ampel */
  let alle = await anlagen(h);
  await geh('/fuhrpark', 'fuhrpark-uebersicht');
  pruef((await reiterIds(page)).join() === 'uebersicht,geraete,fristen,schaeden,vorlagen', 'Fuhrpark Büro: Reiter unvollständig');
  const kpi = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.fp-ampel [data-kpi]')].map((k) => [k.dataset.kpi, Number(k.querySelector('b').textContent)])));
  pruef(['einsatzbereit', 'bald', 'faellig', 'ueberfaellig', 'gesperrt'].every((k) => k in kpi), `Übersicht: Ampel-Kacheln unvollständig (${JSON.stringify(kpi)})`);
  pruef(Object.values(kpi).reduce((a, b) => a + b, 0) === alle.length, `Übersicht: Summe der Kacheln ${JSON.stringify(kpi)} ≠ ${alle.length} Geräte`);
  pruef(kpi.gesperrt >= 3 && kpi.bald >= 1 && kpi.einsatzbereit >= 1, `Übersicht: Demo-Zustände fehlen (${JSON.stringify(kpi)})`);
  pruef(/€/.test(await page.locator('#fp-kosten').innerText()), 'Übersicht Büro: Kosten des Jahres fehlen');
  pruef(await page.locator('#fp-ueberfaellig li').count() >= 1, 'Übersicht: Liste „Überfällig“ leer');
  pruef(await page.locator('#fp-naechste li').count() >= 3, 'Übersicht: „Nächste Termine“ leer');
  pruef(/Gräder/.test(await page.locator('#fp-nicht-zugeordnet').innerText()), 'Übersicht: nicht zugeordnete Gerätestunden (Gräder) fehlen');
  pruef(await page.locator('#fp-maengel li').count() >= 2, 'Übersicht: offene Mängel fehlen');
  pruef(await page.locator('#fp-schaeden li').count() >= 1, 'Übersicht: offene Schäden fehlen');
  // Exporte
  for (const art of ['fristen', 'anlagen', 'eintraege']) {
    pruef(await page.locator(`[data-export="${art}"]`).count() === 1, `Übersicht: Export „${art}“ fehlt`);
    const r = await page.evaluate(async (a) => { const x = await fetch(`/api/fuhrpark/export.csv?art=${a}`); return { status: x.status, typ: x.headers.get('content-type'), text: await x.text() }; }, art);
    pruef(r.status === 200 && /csv/.test(r.typ) && r.text.split('\n').length > 3 && !/€|Kosten/.test(r.text), `Export ${art}: Status ${r.status}, ${r.typ}, ${r.text.length} Zeichen (ohne Kosten erwartet)`);
  }
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-export="fristen"]')]);
  pruef(/\.csv$/.test(dl.suggestedFilename()), `Export: Dateiname ${dl.suggestedFilename()}`);
  await page.click('.fp-ampel [data-kpi="gesperrt"]');
  await page.waitForFunction(() => location.hash.includes('status=gesperrt')); await h.bereit();
  const zeilen = g.mobil ? '#fp-alle .fp-card' : '#fp-tabelle tbody tr';
  pruef(await page.evaluate((s) => { const l = [...document.querySelectorAll(s)]; return l.length >= 3 && l.every((x) => x.dataset.status === 'gesperrt'); }, zeilen), 'Geräteliste: Filter „Gesperrt“ aus der Übersicht greift nicht');
  await h.ueberlauf('geräte gesperrt'); await shot('geraete-gesperrt');
  if (!g.mobil) pruef(/€/.test(await page.locator('#fp-tabelle thead').innerText() + await page.locator('#fp-tabelle tbody').innerText()), 'Geräteliste Büro: Spalte „Kosten Jahr“ fehlt');

  /* Fristen mit Prognose */
  await geh('/fuhrpark?reiter=fristen', 'fuhrpark-fristen');
  pruef(await page.locator('.fp-monat').count() >= 3, 'Fristen: keine Gruppierung nach Monat');
  pruef(await page.locator('.fp-monat.ueber li').count() >= 1, 'Fristen: Überfällige stehen nicht oben');
  const prog = await page.locator('[data-prognose]').allInnerTexts();
  pruef(prog.length >= 1 && prog.every((t) => /voraussichtlich fällig am \d{2}\.\d{2}\.\d{4}/.test(t)), `Fristen: Prognose „voraussichtlich fällig am …“ fehlt (${prog.slice(0, 2)})`);
  const n6 = await page.locator('.fp-fristen li').count();
  await page.click('[data-monate="12"]'); await sleep(300); await h.bereit();
  pruef(await page.locator('.fp-fristen li').count() >= n6, 'Fristen: 12 Monate zeigt weniger als 6 Monate');
  await h.ueberlauf('fristen 12'); await shot('fuhrpark-fristen-12');

  /* Anlage: Zähler mit Verlaufskurve, Plan mit Prognose, Zeitleiste */
  const bagger = finde(alle, /CAT 320/);
  await geh(`/fuhrpark/anlage/${bagger.id}?reiter=zaehler`, 'anlage-zaehler');
  pruef(await page.locator('.fp-chart svg .fp-punkt').count() >= 3, 'Anlage: Verlaufskurve ohne Ablesepunkte');
  pruef(await page.locator('.fp-zk').count() >= 1 && /Std\./.test(await page.locator('.fp-zk').first().innerText()), 'Anlage: Zählerkachel fehlt');
  await page.locator('.fp-chart .hit').first().hover();
  pruef(await sichtbar(page, '.fp-chart .chart-tip').count() === 1, 'Anlage: Verlaufskurve ohne Ablesehilfe');
  await page.mouse.move(2, 2);
  await page.click('[data-ar="plan"]');
  const planText = await sichtbar(page, g.mobil ? '.fp-plan-karten' : '#fp-plan').innerText();
  pruef(/fällig bei [\d.]+\s*Std\./.test(planText) && /voraussichtlich fällig am/.test(planText), 'Anlage: Plan ohne „fällig bei … Std.“ und Prognose');
  await h.ueberlauf('anlage plan'); await shot('anlage-plan');
  await page.click('[data-ar="servicebuch"]');
  pruef(await page.locator('#fp-zeitleiste li[data-typ="eintrag"]').count() >= 1 && await page.locator('#fp-zeitleiste li[data-typ="zaehler"]').count() >= 1, 'Anlage: Zeitleiste ohne Einträge/Zählerstände');
  pruef(await page.locator(`#fp-zeitleiste li[data-schaden="${z.schadenId}"]`).count() === 1, 'Anlage: Schadensmeldung fehlt in der Zeitleiste');
  pruef(/€/.test(await page.locator('#fp-zeitleiste').innerText()), 'Anlage Büro: Kosten in der Zeitleiste fehlen');
  await h.ueberlauf('anlage servicebuch'); await shot('anlage-servicebuch');
  await page.click('[data-tl="pruefung"]');
  pruef(await page.evaluate(() => [...document.querySelectorAll('#fp-zeitleiste li')].every((l) => l.dataset.art === 'pruefung')), 'Anlage: Filter der Zeitleiste greift nicht');
  for (const r of ['uebersicht', 'maengel', 'stammdaten']) { await page.click(`[data-ar="${r}"]`); await h.ueberlauf(`anlage ${r}`); await shot(`anlage-${r}`); }

  /* Service mit Zählerstand erfassen → Frist erledigt, Status wechselt */
  const lader = finde(alle, /CASE 721/);
  pruef(lader.status === 'faellig', `Testdaten: Radlader CASE 721G sollte „fällig“ sein (${lader.status})`);
  await geh(`/fuhrpark/anlage/${lader.id}`, 'anlage-faellig');
  pruef(await page.locator('#fp-kopf[data-status="faellig"], #fp-kopf[data-status="ueberfaellig"]').count() === 1, 'Anlage: Status „fällig“ wird nicht groß angezeigt');
  const dVor = (await api('GET', `/fuhrpark/anlagen/${lader.id}`)).json;
  const faellige = dVor.plan.filter((p) => ['faellig', 'ueberfaellig'].includes(p.status));
  await page.click('[data-akt="eintrag"]');
  await page.waitForSelector('#eintrag-dlg #eb-f');
  pruef(await page.locator('#eintrag-dlg [name="kosten"]').count() === 1, 'Eintrag Büro: Kostenfeld fehlt');
  const vorausgewaehlt = await page.evaluate(() => [...document.querySelectorAll('#eintrag-dlg [name="plan"]:checked')].map((c) => Number(c.value)));
  pruef(faellige.length >= 1 && faellige.every((p) => vorausgewaehlt.includes(p.id)), `Eintrag: fällige Fristen nicht vorausgewählt (${vorausgewaehlt})`);
  await page.fill('#eintrag-dlg [name="titel"]', 'E2E Service 1.000 Std.');
  await page.fill('#eintrag-dlg [name="arbeiten"]', 'Motoröl, Hydrauliköl und alle Filter gewechselt');
  await page.fill('#eintrag-dlg [name="kosten"]', '1.480,50');
  // Zählerstand ist Pflicht
  const zFeld = page.locator('#eintrag-dlg [data-z="bh"]');
  const vorschlag = await zFeld.inputValue();
  await zFeld.fill('');
  await page.click('#eintrag-dlg button[type="submit"]');
  pruef(/stand/i.test(await sichtbar(page, '#eintrag-dlg .form-err').innerText()), 'Eintrag: fehlender Zählerstand wird nicht verlangt');
  pruef(vorschlag.trim() !== '', 'Eintrag: Zählerstand nicht vorbelegt');
  const standNeu = Math.ceil(dVor.zaehler.find((x) => x.art === 'bh').aktuell) + 2;
  await zFeld.fill(String(standNeu));
  await h.dialogUeberlauf('eintrag'); await shot('eintrag-buero');
  await page.click('#eintrag-dlg button[type="submit"]');
  await dlgZu(page); await h.bereit();
  const dNach = (await api('GET', `/fuhrpark/anlagen/${lader.id}`)).json;
  pruef(dNach.status !== 'faellig' && faellige.every((p) => ['ok', 'bald'].includes(dNach.plan.find((x) => x.id === p.id).status)), `Eintrag: Status wechselt nicht (${dVor.status} → ${dNach.status})`);
  pruef(dNach.zaehler.find((x) => x.art === 'bh').letzterStand.anzeige === standNeu, 'Eintrag: Zählerstand nicht übernommen');
  await page.waitForSelector(`#fp-kopf[data-status="${dNach.status === 'faellig' ? 'x' : dNach.status}"]`);
  pruef(await page.locator('#fp-kopf[data-status="faellig"]').count() === 0, 'Anlage: Anzeige bleibt nach dem Eintrag auf „fällig“');
  const eintr = ((await api('GET', `/fuhrpark/eintraege?anlageId=${lader.id}`)).json || []).find((e) => e.titel === 'E2E Service 1.000 Std.');
  pruef(!!eintr && eintr.kosten === 1480.5 && eintr.erledigt.length >= 1, `Eintrag: nicht mit Kosten/erledigten Fristen am Server (${JSON.stringify(eintr && { k: eintr.kosten, e: eintr.erledigt.length })})`);
  await page.click('[data-ar="servicebuch"]');
  pruef(/E2E Service 1\.000 Std\./.test(await page.locator('#fp-zeitleiste').innerText()) && /1\.480,50/.test(await page.locator('#fp-zeitleiste').innerText()), 'Anlage: neuer Eintrag fehlt in der Zeitleiste');
  await shot('anlage-nach-eintrag'); await h.toastWeg();

  /* Schaden des Mitarbeiters: in Bearbeitung → behoben mit Verknüpfung zur Reparatur */
  await geh('/fuhrpark?reiter=schaeden', 'schaeden-buero');
  pruef(await page.locator('#sch-filter select, #sch-filter input').count() === 6, 'Schäden Büro: Filter (Status, Gerät, Baustelle, Art, Zeitraum) unvollständig');
  if (g.mobil) pruef(await sichtbar(page, '.sch-karte').count() >= 2 && await sichtbar(page, '#sch-tbl').count() === 0, 'Schäden Handy: Karten erwartet');
  else pruef(await sichtbar(page, '#sch-tbl tbody tr').count() >= 2, 'Schäden Tablet/PC: Tabelle erwartet');
  await page.selectOption('#sch-filter [data-f="art"]', 'unfall');
  pruef(await sichtbar(page, '[data-schaden]').count() === 1 && await sichtbar(page, `[data-schaden="${z.schadenId}"]`).count() === 1, 'Schäden: Filter „Art“ greift nicht');
  await page.selectOption('#sch-filter [data-f="art"]', '');
  await page.selectOption('#sch-filter [data-f="status"]', 'behoben');
  pruef(await sichtbar(page, `[data-schaden="${z.schadenId}"]`).count() === 0, 'Schäden: Filter „Status“ greift nicht');
  await page.selectOption('#sch-filter [data-f="status"]', '');
  await sichtbar(page, `[data-schaden="${z.schadenId}"]`).click();
  await page.waitForSelector('#schaden-detail .sd-bearb');
  await page.waitForFunction(() => [...document.querySelectorAll('#sd-galerie img')].length === 2 && [...document.querySelectorAll('#sd-galerie img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 10000 }).catch(() => {});
  pruef(await page.locator('#sd-galerie img').count() === 2 && await geladen(page), 'Schaden Büro: Fotos werden nicht angezeigt');
  await h.dialogUeberlauf('schaden büro'); await shot('schaden-detail-buero');
  await page.click('#schaden-detail [data-sd="in_bearbeitung"]');
  await page.waitForSelector('#schaden-detail .sd-kopf[data-status="in_bearbeitung"]');
  pruef((await api('GET', `/fuhrpark/schaeden/${z.schadenId}`)).json.status === 'in_bearbeitung', 'Schaden: „In Bearbeitung“ nicht am Server');
  // Ablehnen verlangt eine Begründung
  await page.click('#schaden-detail [data-sd-modus="abgelehnt"]');
  await page.click('#schaden-detail #sd-f button[type="submit"]');
  pruef((await api('GET', `/fuhrpark/schaeden/${z.schadenId}`)).json.status === 'in_bearbeitung', 'Schaden: Ablehnen ohne Begründung möglich');
  await page.click('#schaden-detail [data-sd-modus=""]');
  await page.click('#schaden-detail [data-sd-modus="behoben"]');
  await page.waitForSelector('#schaden-detail [data-sd-neuer-eintrag]');
  await shot('schaden-behoben-dialog');
  await page.click('#schaden-detail [data-sd-neuer-eintrag]');
  await page.waitForSelector('#eintrag-dlg #eb-f');
  pruef(await page.locator(`#eintrag-dlg [name="mangel"][value="${z.schadenId}"]:checked`).count() === 1 && (await page.locator('#eintrag-dlg [name="art"]').inputValue()) === 'reparatur', 'Schaden: Reparatur-Eintrag nicht mit dem Schaden vorbelegt');
  await page.fill('#eintrag-dlg [name="titel"]', 'E2E Hydraulikschlauch erneuert');
  await page.fill('#eintrag-dlg [name="kosten"]', '320');
  await page.click('#eintrag-dlg button[type="submit"]');
  await dlgZu(page); await h.bereit();
  const sNach = (await api('GET', `/fuhrpark/schaeden/${z.schadenId}`)).json;
  pruef(sNach.status === 'behoben' && sNach.eintragId != null && sNach.eintrag && sNach.eintrag.titel === 'E2E Hydraulikschlauch erneuert' && sNach.eintrag.kosten === 320, `Schaden: nicht behoben/verknüpft (${JSON.stringify({ s: sNach.status, e: sNach.eintrag })})`);
  await geh('/fuhrpark?reiter=schaeden');
  await sichtbar(page, `[data-schaden="${z.schadenId}"]`).click();
  await page.waitForSelector('#schaden-detail #sd-eintrag');
  pruef(/E2E Hydraulikschlauch erneuert/.test(await page.locator('#sd-eintrag').innerText()) && /€ 320,00/.test(await page.locator('#sd-eintrag').innerText()), 'Schaden-Detail: Verknüpfung zur Reparatur (mit Kosten fürs Büro) fehlt');
  pruef(await page.locator('#schaden-detail .sd-kopf[data-status="behoben"]').count() === 1, 'Schaden-Detail: Status „Behoben“ fehlt');
  await h.dialogUeberlauf('schaden behoben'); await shot('schaden-behoben');
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));

  /* Vorlagen mit „Prüfen“ */
  await geh('/fuhrpark?reiter=vorlagen', 'fuhrpark-vorlagen');
  pruef(await page.locator('#fp-vorlagen tbody tr').count() >= 15 && await page.locator('#fp-vorlagen [data-pruefen]').count() >= 10, 'Vorlagen: Liste bzw. Kennzeichen „Prüfen“ fehlt');

  /* Neues Gerät anlegen (mit Zähler und vorgeschlagenen Fristen) */
  await geh('/fuhrpark?reiter=geraete');
  await page.click('[data-akt="neu"]');
  await page.waitForSelector('#anlage-dlg #an-f');
  await page.fill('#anlage-dlg [name="bezeichnung"]', `E2E Pritsche ${g.name}`);
  await page.selectOption('#anlage-dlg [name="klasse"]', 'lkw');
  await page.selectOption('#anlage-dlg [name="fahrzeugklasse"]', 'N2');
  await page.fill('#anlage-dlg [name="kennzeichen"]', `NK-9${g.width} E`);
  await page.fill('#anlage-dlg [name="erstzulassung"]', '2022-03-15');
  await page.check('#anlage-dlg [name="zart"][value="km"]');
  await page.fill('#anlage-dlg [name="zstart-km"]', '54.300');
  await h.dialogUeberlauf('anlage neu'); await shot('anlage-neu');
  await page.click('#anlage-dlg button[type="submit"]');
  await page.waitForSelector('dialog[open] #vu-f', { timeout: 10000 });
  pruef(await page.locator('#vu-f [name="v"]').count() >= 2, 'Neues Gerät: keine Fristen vorgeschlagen');
  await shot('anlage-neu-fristen');
  await page.click('dialog[open] button[form="vu-f"]');
  await page.waitForFunction(() => /^#\/fuhrpark\/anlage\/\d+/.test(location.hash)); await h.bereit();
  const neuId = Number((await page.evaluate(() => location.hash)).split('/').pop());
  const neu = (await api('GET', `/fuhrpark/anlagen/${neuId}`)).json;
  pruef(neu.bezeichnung === `E2E Pritsche ${g.name}` && neu.zaehler.length === 1 && neu.zaehler[0].aktuell === 54300 && neu.plan.length >= 2, `Neues Gerät: nicht vollständig angelegt (${JSON.stringify({ z: neu.zaehler.length, p: (neu.plan || []).length })})`);
  await h.ueberlauf('anlage neu detail'); await shot('anlage-neu-detail'); await h.toastWeg();
}

module.exports = { mitarbeiter, fremder, polier, berichtGeraete, buero };
