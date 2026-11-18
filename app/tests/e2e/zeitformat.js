'use strict';
/**
 * Stunden als Stunden:Minuten statt Dezimalzahl (API.md 15.25, Inhaber 18.11.2026) in der Oberfläche.
 *   node tests/e2e/zeitformat.js   (im Ordner app; E2E_NUR=handy|tablet|pc; Exit-Code 1 bei Befunden)
 * Wird auch von run.js je Bildschirmgröße aufgerufen (abschaltbar mit E2E_OHNE_ZEITFORMAT=1).
 * Vorbereitung am Server: Lukas stempelt am Do 12.11.2026 von 07:00 bis 16:51 ohne Pause = 9,85 Std.
 *  1. Büro, Monatsauswertung: Schalter „Std:Min | Dezimal“, Vorgabe Std:Min – Tageszelle „9:51“, Summen und Kacheln
 *     als Std:Min (gleich der API); „Dezimal“ zeigt „9,85“ wie bisher und bleibt nach dem Neuladen; Pfeiltaste zurück.
 *     Die CSV für die Lohnverrechnung bleibt dezimal („9,85“). Handy: auch bei 320 px kein Überlauf, nichts abgeschnitten.
 *  2. Mitarbeiter: „Meine Woche“ in Langform („25 Std. 51 Min.“, Tag „9 Std.“ / „51 Min.“), Stempeluhr „Heute“
 *     „9 Std. 51 Min.“.
 *  3. Summen = Summe der sichtbaren Einzelwerte: 5 × „7:40“ ergibt „38:20“ (nicht „38:21“ aus 5 × 7,67) in Meine Woche,
 *     Monatsauswertung (Summe, Normal + Üst. + Mehr, Kachel) und Bautagesbericht (3 × 7:40 = „23:00“); Dezimal bleibt die
 *     Summe der API. Arbeitszeitmodell-Dialog meldet dezimal wie die Eingabe; Hinweis der Nachkalkulation in Langform.
 */
const { chromium } = require('playwright');
const { starte, U, BS } = require('../api/hilfe');

const GROESSEN = [
  { name: 'handy', width: 390, height: 844, mobil: true },
  { name: 'tablet', width: 1180, height: 820, mobil: true },
  { name: 'pc', width: 1440, height: 900, mobil: false }
];
const NAME = { 2: 'Lukas Brandstätter', 101: 'Martina Koller' };
const TAG = '2026-11-12';
// Erwartung unabhängig vom Code der App gerechnet (gleiche Regel: Minuten = Math.round(Stunden × 60))
const hm = (x) => { const m = Math.round(Math.abs(x) * 60); return `${x < 0 && m ? '−' : ''}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
// Summe so, wie man sie aus den sichtbaren Tageswerten nachrechnet: jeder Tag auf Minuten gerundet, dann addiert
const min = (x) => Math.round((Number(x) || 0) * 60);
const erwartet = (m) => {
  const summe = Object.values(m.tage || {}).reduce((a, t) => a + min(t.stunden), 0);
  return { summe: summe / 60, normal: Math.max(0, summe - min(m.ueberstunden) - min(m.mehrstunden)) / 60 };
};
const dez = (x, max = 2) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: max, useGrouping: 'always' }).format(x);

async function laufe(browser, g) {
  const fehler = [];
  let schritte = 0;
  const pruef = (ok, text) => { schritte++; if (!ok) { fehler.push(`Zeitformat/${g.name}: ${text}`); console.log(`    ✗ Zeitformat/${g.name}: ${text}`); } };
  const s = await starte({ test: true });
  try {
    // Vorbereitung: eine Schicht mit 9 Std. 51 Min. (9,85) für Lukas am Donnerstag
    const ma = await s.login(U.mitarbeiter);
    s.uhr.setze('2026-11-12T06:00:00Z');
    pruef((await ma.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten })).status === 200, 'Vorbereitung: Kommen');
    s.uhr.setze('2026-11-12T15:51:00Z');
    pruef((await ma.post('/zeit/stempeln', { typ: 'gehen' })).status === 200, 'Vorbereitung: Gehen');
    s.uhr.setze('2026-11-12T16:30:00Z'); // 17:30 Wiener Zeit

    async function sitzung(benutzerId, wo, f, breite) {
      const ctx = await browser.newContext({ viewport: { width: breite || g.width, height: g.height }, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: g.mobil, serviceWorkers: 'block', acceptDownloads: true });
      await ctx.clock.install({ time: s.uhr() });
      const page = await ctx.newPage();
      page.setDefaultTimeout(10000);
      const konsole = [];
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) konsole.push(m.text().slice(0, 160)); });
      page.on('pageerror', (e) => konsole.push(String(e.message).slice(0, 160)));
      const name = NAME[benutzerId];
      await page.goto(s.basis + '/#/login');
      await page.waitForSelector('.login-user');
      await page.fill('#login-suche', name.split(' ')[1]);
      await page.click(`.login-user:has-text("${name}")`);
      await page.waitForSelector('.pin-pad');
      for (const z of '1234') await page.click(`.pin-pad [data-z="${z}"]`);
      await page.click('.pin-pad [data-ok]');
      await page.waitForSelector('#view');
      await page.waitForFunction(() => !document.querySelector('#view .view-box > .state .spinner, #root > .state .spinner'), null, { timeout: 10000 });
      const bereit = () => page.waitForFunction(() => !document.querySelector('#view .view-box > .state .spinner'), null, { timeout: 10000 });
      const geh = async (h) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForFunction((x) => location.hash === x, h); await bereit(); await page.waitForTimeout(200); };
      const api = (pfad) => page.evaluate(async (p) => { const r = await fetch('/api' + p); let j = null; try { j = await r.json(); } catch (e) { /* kein JSON */ } return { status: r.status, json: j }; }, pfad);
      const text = async (sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
      // Kein horizontaler Überlauf der Seite, und in den genannten Elementen ist nichts abgeschnitten
      const layout = async (was, sel) => {
        const r = await page.evaluate((q) => {
          const d = document.documentElement, v = document.getElementById('view');
          const eng = [...document.querySelectorAll(q)].filter((e) => e.offsetParent !== null && e.scrollWidth > e.clientWidth + 1).map((e) => `${e.className || e.tagName}: „${e.textContent.trim().slice(0, 20)}“ ${e.scrollWidth}>${e.clientWidth}`);
          return { doc: d.scrollWidth - window.innerWidth, view: v ? v.scrollWidth - v.clientWidth : 0, eng };
        }, sel);
        pruef(r.doc <= 1 && r.view <= 1, `${was}: horizontaler Überlauf (doc ${r.doc}, view ${r.view})`);
        pruef(r.eng.length === 0, `${was}: Inhalt abgeschnitten: ${r.eng.slice(0, 3).join(' | ')}`);
      };
      try { await f({ page, ctx, geh, api, text, layout }); } finally {
        pruef(konsole.length === 0, `${wo}: Konsolenfehler: ${konsole.slice(0, 3).join(' | ')}`);
        await ctx.close();
      }
    }

    /* ---- 1) Büro: Monatsauswertung mit Schalter ---- */
    const monat = async ({ page, geh, api, text, layout }, breite) => {
      const w = breite ? `Monat ${breite}px` : 'Monat';
      await geh('#/monat?monat=2026-11');
      await page.waitForSelector(`tr[data-ma="${U.mitarbeiter}"]`);
      const d = (await api('/monat?monat=2026-11')).json;
      const tage = d.tage.map((t) => (typeof t === 'string' ? t : t.datum));
      const lukas = d.mitarbeiter.find((x) => x.id === U.mitarbeiter);
      pruef(lukas && lukas.tage[TAG] && lukas.tage[TAG].stunden === 9.85, `${w}: API liefert für Lukas am 12.11. nicht 9,85 (${JSON.stringify(lukas && lukas.tage[TAG])}) – die API bleibt dezimal`);
      const zelle = page.locator(`tr[data-ma="${U.mitarbeiter}"] > td`).nth(tage.indexOf(TAG));
      // Vorgabe: Std:Min
      pruef(await page.locator('#zf-zeile [data-zf="hm"][aria-checked="true"].on').count() === 1 && await page.locator('#zf-zeile [data-zf="dezimal"][aria-checked="false"]').count() === 1, `${w}: Schalter steht nicht auf „Std:Min“`);
      pruef((await text('#zf-zeile')).includes('Std:Min') && (await text('#zf-zeile')).includes('Dezimal'), `${w}: Schalter ohne „Std:Min | Dezimal“`);
      pruef((await zelle.innerText()).trim() === '9:51', `${w}: Tageszelle „${(await zelle.innerText()).trim()}“ statt „9:51“`);
      const summe = (await text(`tr[data-ma="${U.mitarbeiter}"] [data-summe]`));
      pruef(summe === hm(lukas.summe), `${w}: Summe „${summe}“ statt „${hm(lukas.summe)}“`);
      pruef((await text(`tr[data-ma="${U.mitarbeiter}"] [data-ue]`)) === hm(lukas.ueberstunden), `${w}: Überstunden nicht als Std:Min`);
      // alle Personen: Stunden-Spalten gleich der API, als Std:Min; SW/K/U sind Tage und bleiben Zahlen
      const spalten = await page.evaluate(() => [...document.querySelectorAll('table.matrix tbody tr[data-ma]')].map((tr) => ({ id: Number(tr.dataset.ma), summe: tr.querySelector('[data-summe]').textContent, normal: tr.querySelector('[data-normal]').textContent, ue: tr.querySelector('[data-ue]').textContent, mehr: tr.querySelector('[data-mehr]').textContent, seg: tr.querySelector('[data-seg]').textContent, tage: [...tr.querySelectorAll('td')].slice(0, -8).map((td) => td.textContent) })));
      // Summe = Summe der sichtbaren Tageswerte (auf Minuten gerundet), Über/Mehr aus der API, Normal = Summe − Über − Mehr
      const falsch = spalten.filter((z) => { const m = d.mitarbeiter.find((x) => x.id === z.id); if (!m) return true; const e = erwartet(m); return z.summe !== hm(e.summe) || z.normal !== hm(e.normal) || z.ue !== hm(m.ueberstunden || 0) || z.mehr !== hm(m.mehrstunden || 0) || z.seg !== hm(m.seg || 0); });
      pruef(spalten.length === d.mitarbeiter.length && falsch.length === 0, `${w}: Spalten passen nicht zu den Tageswerten (${falsch.slice(0, 2).map((z) => JSON.stringify(z).slice(0, 120)).join(' | ')})`);
      const tagDezimal = spalten.flatMap((z) => z.tage).filter((t) => /\d,\d/.test(t));
      pruef(tagDezimal.length === 0, `${w}: Tageszellen noch dezimal: ${tagDezimal.slice(0, 3).join(', ')}`);
      const sum = (k) => d.mitarbeiter.reduce((a, m) => a + (Number(m[k]) || 0), 0);
      const kpi = d.mitarbeiter.reduce((a, m) => a + erwartet(m).summe, 0);
      pruef((await text('#kpi-summe')) === hm(kpi), `${w}: Kachel „Stunden gesamt“ „${await text('#kpi-summe')}“ statt „${hm(kpi)}“`);
      const kpiUe = d.mitarbeiter.reduce((a, m) => a + min(m.ueberstunden), 0) / 60; // Summe der sichtbaren Üst.-Spalte
      pruef((await text('#kpi-ue')).startsWith(hm(kpiUe)), `${w}: Kachel Überstunden „${await text('#kpi-ue')}“ statt „${hm(kpiUe)}“`);
      // Server-Hinweise („11,08 Std. – mehr als 10 Std.“) in Langform; die API bleibt dezimal
      const dezWarn = (d.warnungen || []).filter((x) => /\d,\d+\s(Std\.|Arbeitsstunden)/.test(x.text || ''));
      pruef(dezWarn.length > 0, `${w}: Testdaten ohne Warnung mit Dezimalstunden – Prüfung nicht aussagekräftig`);
      const warnHm = await text('.warn-list');
      pruef(!/\d,\d+\s(Std\.|Arbeitsstunden)/.test(warnHm) && /\d Std\. \d+ Min\. – mehr als 10 Std\./.test(warnHm), `${w}: Warnungen noch mit Dezimalstunden: „${(warnHm.match(/[^·]{0,30}\d,\d+\sStd\.[^·]{0,20}/) || [''])[0]}“`);
      pruef(/Schlechtwetter \(Tage\)/.test(await text('#monat-kpi')) && /Krank \/ Urlaub \(Tage\)/.test(await text('#monat-kpi')), `${w}: Kacheln in Tagen nicht als „(Tage)“ beschriftet`);
      if (breite || g.width <= 719) await layout(w + ' Std:Min', '#zf-zeile, #zf-zeile button, .kpi, table.matrix td');
      // Dezimal: genau wie bisher
      await page.click('#zf-zeile [data-zf="dezimal"]');
      await page.waitForSelector('#zf-zeile [data-zf="dezimal"][aria-checked="true"]');
      pruef((await zelle.innerText()).trim() === '9,85', `${w}: Dezimal – Tageszelle „${(await zelle.innerText()).trim()}“ statt „9,85“`);
      pruef((await text(`tr[data-ma="${U.mitarbeiter}"] [data-summe]`)) === dez(lukas.summe), `${w}: Dezimal – Summe nicht „${dez(lukas.summe)}“`);
      pruef((await text('#kpi-summe')) === dez(sum('summe'), 1), `${w}: Dezimal – Kachel „${await text('#kpi-summe')}“ statt „${dez(sum('summe'), 1)}“`);
      pruef(await page.locator('#monat-kpi[data-stunden-format="dezimal"]').count() === 1, `${w}: Dezimal – Kennzeichen fehlt`);
      pruef(/\d,\d+\sStd\./.test(await text('.warn-list')), `${w}: Dezimal – Warnungen nicht wie bisher dezimal`);
      const gemerkt = await page.evaluate(() => localStorage.getItem('bt_stunden_format'));
      pruef(gemerkt === '"dezimal"', `${w}: Wahl nicht auf dem Gerät gemerkt (${gemerkt})`);
      if (breite || g.width <= 719) await layout(w + ' Dezimal', '#zf-zeile, #zf-zeile button, .kpi, table.matrix td');
      await page.reload();
      await page.waitForSelector(`tr[data-ma="${U.mitarbeiter}"]`);
      pruef(await page.locator('#zf-zeile [data-zf="dezimal"][aria-checked="true"]').count() === 1 && (await page.locator(`tr[data-ma="${U.mitarbeiter}"] > td`).nth(tage.indexOf(TAG)).innerText()).trim() === '9,85', `${w}: Dezimal nach dem Neuladen nicht erhalten`);
      // CSV für die Lohnverrechnung bleibt dezimal – gleich, was angezeigt wird
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#csv-lohn')]);
      const csv = require('node:fs').readFileSync(await dl.path(), 'utf8');
      const zeile = csv.split(/\r?\n/).find((z) => z.includes('Brandstätter') && z.includes('12.11.2026')) || '';
      pruef(zeile.split(';').includes('9,85') && !/\b9:51\b/.test(csv), `CSV Lohnverrechnung nicht dezimal: „${zeile}“`);
      // zurück mit der Pfeiltaste (Radiogruppe)
      await page.focus('#zf-zeile [data-zf="dezimal"]');
      await page.keyboard.press('ArrowLeft');
      await page.waitForSelector('#zf-zeile [data-zf="hm"][aria-checked="true"]');
      pruef((await page.locator(`tr[data-ma="${U.mitarbeiter}"] > td`).nth(tage.indexOf(TAG)).innerText()).trim() === '9:51' && await page.evaluate(() => localStorage.getItem('bt_stunden_format')) === '"hm"', `${w}: Pfeiltaste schaltet nicht zurück auf Std:Min`);
      pruef(await page.evaluate(() => document.activeElement && document.activeElement.dataset.zf) === 'hm', `${w}: Fokus nach dem Umschalten nicht auf „Std:Min“`);
    };
    await sitzung(U.buero, 'Monatsauswertung', (h) => monat(h));
    if (g.width <= 719) await sitzung(U.buero, 'Monatsauswertung 320px', (h) => monat(h, 320), 320);

    /* ---- 2) Mitarbeiter: Meine Woche und Stempeluhr in Langform ---- */
    const feld = async ({ page, geh, api, text, layout }, breite) => {
      const w = breite ? ` ${breite}px` : '';
      await geh(`#/woche?datum=${TAG}`);
      await page.waitForSelector('#woche-summe');
      const wo = (await api(`/zeit/woche?datum=${TAG}`)).json;
      pruef(wo.summe === 25.85 && wo.ueberstunden === 1.85, `Woche${w}: API ${wo.summe}/${wo.ueberstunden} statt 25,85/1,85`);
      pruef((await text('#woche-summe')) === '25 Std. 51 Min.', `Woche${w}: Summe „${await text('#woche-summe')}“ statt „25 Std. 51 Min.“`);
      pruef((await text('#woche-ue')) === '1 Std. 51 Min.', `Woche${w}: Überstunden „${await text('#woche-ue')}“ statt „1 Std. 51 Min.“`);
      pruef((await text(`[data-tag-std="${TAG}"]`)) === '9 Std. 51 Min.', `Woche${w}: Donnerstag „${await text(`[data-tag-std="${TAG}"]`)}“ statt „9 Std. 51 Min.“`);
      pruef((await text('[data-tag-std="2026-11-10"]')) === '8 Std.', `Woche${w}: Dienstag „${await text('[data-tag-std="2026-11-10"]')}“ statt „8 Std.“`);
      pruef((await text('[data-tag-std="2026-11-13"]')) === '– Std.', `Woche${w}: leerer Tag „${await text('[data-tag-std="2026-11-13"]')}“`);
      pruef(/Soll laut Arbeitszeitmodell: 39 Std\./.test(await text('#woche-soll')), `Woche${w}: Soll „${await text('#woche-soll')}“`);
      pruef(!/\d,\d/.test(await text('.week-list')) && !/\d,\d/.test(await text('.kpi-row')), `Woche${w}: noch Dezimalzahlen sichtbar`);
      if (breite || g.width <= 719) await layout('Woche' + w, '.kpi, .wd, .wd-std');
      await geh('#/stempeln');
      await page.waitForSelector('#heute-arbeitszeit');
      pruef((await text('#heute-arbeitszeit')) === '9 Std. 51 Min.', `Stempeluhr${w}: „Heute“ „${await text('#heute-arbeitszeit')}“ statt „9 Std. 51 Min.“`);
      pruef(/Pause 0 min/.test(await text('.sum-grid')), `Stempeluhr${w}: Pause „${await text('.sum-grid')}“`);
      if (breite || g.width <= 719) await layout('Stempeluhr' + w, '.sum-grid > div');
      // Der Mitarbeiter hat keinen Schalter und keine Monatsauswertung
      pruef(await page.locator('[data-zf]').count() === 0, `Stempeluhr${w}: Schalter Std:Min/Dezimal bei Mitarbeiter`);
    };
    await sitzung(U.mitarbeiter, 'Meine Woche', (h) => feld(h));
    if (g.width <= 719) await sitzung(U.mitarbeiter, 'Meine Woche 320px', (h) => feld(h, 320), 320);

    /* ---- 3) Summen passen zu den sichtbaren Einzelwerten (Review 15.25) ----
     * Lukas stempelt Mo 16.11. bis Fr 20.11. je 07:00–14:40 = „7:40“ (API je 7,67). Die API summiert die gerundeten Tage
     * (5 × 7,67 = 38,35 = „38:21“); sichtbar und richtig ist 5 × 7:40 = „38:20“. Ebenso Monatsauswertung und Bericht. */
    const WO2 = ['16', '17', '18', '19', '20'].map((x) => `2026-11-${x}`);
    for (const t of WO2) {
      s.uhr.setze(`${t}T06:00:00Z`);
      const ich = await s.login(U.mitarbeiter); // neue Anmeldung je Tag (die Uhr springt um Tage)
      const k1 = await ich.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
      pruef(k1.status === 200, `Vorbereitung ${t}: Kommen ${k1.status} ${JSON.stringify(k1.daten).slice(0, 120)}`);
      s.uhr.setze(`${t}T13:40:00Z`);
      pruef((await ich.post('/zeit/stempeln', { typ: 'gehen' })).status === 200, `Vorbereitung ${t}: Gehen`);
    }
    s.uhr.setze('2026-11-20T16:30:00Z');
    // Bericht Pitten 18.11. mit drei Personen zu je 07:00–14:40 (Gesamt 23:00, aus der Dezimalsumme 23,01 wäre es „23:01“)
    const pol = await s.login(U.polier);
    const nb = await pol.post('/berichte', { baustelleId: BS.pitten, datum: '2026-11-18' });
    pruef(nb.status === 201, `Vorbereitung Bericht: ${nb.status} ${JSON.stringify(nb.daten).slice(0, 120)}`);
    const BID = nb.daten && nb.daten.id;
    const b0 = (await pol.get(`/berichte/${BID}`)).daten;
    const rb = await pol.put(`/berichte/${BID}`, { version: b0.version, personal: [[U.mitarbeiter], [U.polier], [U.polier2, true]].map(([id, gast]) => ({ benutzerId: id, von1: '07:00', bis1: '14:40', ...(gast ? { gast: true } : {}) })) });
    pruef(rb.status === 200, `Vorbereitung Bericht Personal: ${rb.status} ${JSON.stringify(rb.daten).slice(0, 160)}`);
    // Nachkalkulation: 12,5 Std. ohne Lohngruppe (Person ohne Lohngruppe in einem freigegebenen Bericht)
    const gf = await s.login(U.gf);
    const ohne = await gf.post('/benutzer', { name: 'E2E Zeitformat ohne Lohngruppe', rolle: 'mitarbeiter', pin: '4826' });
    const frei = s.db.eins("SELECT id FROM bericht WHERE baustelle_id = ? AND status = 'freigegeben' ORDER BY datum DESC LIMIT 1", BS.pitten);
    pruef(ohne.status === 201 && frei, `Vorbereitung Nachkalkulation: ${ohne.status}`);
    if (ohne.status === 201 && frei) s.db.lauf("INSERT INTO bericht_personal (bericht_id, benutzer_id, von1, bis1, pause_min, stunden, seg_stunden, pos, gast) VALUES (?, ?, '07:00', '19:30', 0, 12.5, 0, 99, 1)", frei.id, ohne.daten.id);

    await sitzung(U.mitarbeiter, 'Summe Woche', async ({ page, geh, api, text }) => {
      await geh('#/woche?datum=2026-11-18');
      await page.waitForSelector('#woche-summe');
      const wo = (await api('/zeit/woche?datum=2026-11-18')).json;
      pruef(wo.tage.filter((t) => t.stunden === 7.67).length === 5 && wo.summe === 38.35, `Summe Woche: API ${JSON.stringify(wo.tage.map((t) => t.stunden))} / ${wo.summe} – Testfall nicht aussagekräftig`);
      for (const t of WO2) pruef((await text(`[data-tag-std="${t}"]`)) === '7 Std. 40 Min.', `Summe Woche: ${t} „${await text(`[data-tag-std="${t}"]`)}“ statt „7 Std. 40 Min.“`);
      pruef((await text('#woche-summe')) === '38 Std. 20 Min.', `Summe Woche: „${await text('#woche-summe')}“ statt „38 Std. 20 Min.“ (5 × 7:40)`);
      // Überstunden nach der Regel des Modells (Fr Soll 7 Std. → 7:40 = 40 Min. darüber), aus der API auf Minuten gerundet
      pruef(wo.ueberstunden === 0.67 && (await text('#woche-ue')) === '40 Min.', `Summe Woche: Überstunden „${await text('#woche-ue')}“ (API ${wo.ueberstunden})`);
    });

    await sitzung(U.buero, 'Summe Monat', async ({ page, geh, api, text }) => {
      await geh('#/monat?monat=2026-11');
      await page.waitForSelector(`tr[data-ma="${U.mitarbeiter}"]`);
      const d = (await api('/monat?monat=2026-11')).json;
      const lukas = d.mitarbeiter.find((x) => x.id === U.mitarbeiter);
      const zeile = `tr[data-ma="${U.mitarbeiter}"]`;
      // Summe der Zellen so, wie sie dastehen (auch „+4:00“ neben einer Abwesenheit)
      const zellen = await page.evaluate((q) => [...document.querySelectorAll(`${q} > td`)].slice(0, -8).map((td) => td.textContent.trim()), zeile);
      const zellMin = zellen.map((t) => /(−?)(\d+):(\d{2})$/.exec(t)).filter(Boolean).reduce((a, m) => a + (m[1] ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])), 0);
      const zellSumme = `${Math.floor(zellMin / 60)}:${String(zellMin % 60).padStart(2, '0')}`;
      pruef(zellen.filter((t) => t === '7:40').length === 5, `Summe Monat: Zellen ${JSON.stringify(zellen.filter(Boolean))}`);
      pruef(hm(lukas.summe) !== zellSumme, `Summe Monat: Testfall nicht aussagekräftig (API ${lukas.summe} = Zellsumme ${zellSumme})`);
      pruef((await text(`${zeile} [data-summe]`)) === zellSumme, `Summe Monat: Summe „${await text(`${zeile} [data-summe]`)}“ statt Summe der Zellen „${zellSumme}“`);
      const t = async (sel) => { const m = /(\d+):(\d{2})/.exec(await text(`${zeile} ${sel}`)); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
      pruef((await t('[data-normal]')) + (await t('[data-ue]')) + (await t('[data-mehr]')) === zellMin, `Summe Monat: Normal + Üst. + Mehr ≠ Summe`);
      const kpi = d.mitarbeiter.reduce((a, m) => a + erwartet(m).summe, 0);
      pruef((await text('#kpi-summe')) === hm(kpi), `Summe Monat: Kachel „${await text('#kpi-summe')}“ statt „${hm(kpi)}“`);
      // Dezimal: wie in der Lohnverrechnung die Summe der API
      await page.click('#zf-zeile [data-zf="dezimal"]');
      await page.waitForSelector('#zf-zeile [data-zf="dezimal"][aria-checked="true"]');
      pruef((await text(`${zeile} [data-summe]`)) === dez(lukas.summe) && (await text(`${zeile} [data-normal]`)) === dez(lukas.normal), `Summe Monat: Dezimal „${await text(`${zeile} [data-summe]`)}“ statt „${dez(lukas.summe)}“`);
      await page.click('#zf-zeile [data-zf="hm"]');
      await page.waitForSelector('#zf-zeile [data-zf="hm"][aria-checked="true"]');
      // Bericht: Gesamtstunden = Summe der Zeilen
      await geh(`#/bericht/${BID}`);
      await page.waitForSelector('#gesamt');
      const reihen = await page.locator('#personal .bp-row [data-p-std]').allInnerTexts();
      pruef(reihen.length === 3 && reihen.every((x) => x.trim() === '7:40'), `Bericht: Zeilen ${JSON.stringify(reihen)} statt 3 × „7:40“`);
      pruef((await text('#gesamt')) === '23:00', `Bericht: Gesamtstunden „${await text('#gesamt')}“ statt „23:00“ (3 × 7:40)`);
      // Arbeitszeitmodell-Dialog: Rückmeldung in derselben Schreibweise wie die Eingabe (dezimal)
      await geh('#/preise');
      await page.click('#tab-arbeitszeit');
      await page.waitForSelector('#az-tabelle');
      await page.click('#az-neu');
      await page.waitForSelector('dialog[open] #azf');
      await page.fill('dialog[open] [name="name"]', 'E2E Zeitformat');
      await page.fill('dialog[open] [name="wochenstunden"]', '38,5');
      for (const k of ['mo', 'di', 'mi', 'do', 'fr']) await page.fill(`dialog[open] [name="t_${k}"]`, '7,75');
      const live = await page.locator('dialog[open] #az-summe').innerText();
      pruef(live === 'Summe der Tage: 38,75 Std. – muss 38,5 Std. ergeben', `Modell-Dialog: Live-Summe „${live}“`);
      await page.click('dialog[open] #az-ok');
      await page.waitForSelector('dialog[open] [data-az-fehler="stunden"]:not([hidden])');
      const fm = await page.locator('dialog[open] [data-az-fehler="stunden"]').innerText();
      pruef(/Die Tage ergeben 38,75 Std\. – zusammen müssen es die Wochenstunden \(38,5 Std\.\) sein\./.test(fm), `Modell-Dialog: Fehler „${fm}“`);
      await page.click('dialog[open] [data-zu]');
    });

    await sitzung(U.buero, 'Nachkalkulation', async ({ page, geh, api, text }) => {
      const k = (await api(`/kalkulation/${BS.pitten}`)).json;
      pruef((k.hinweise || []).some((h) => /^12,5 Std\. ohne Lohngruppe/.test(h.text)), `Nachkalkulation: API-Hinweis fehlt (${JSON.stringify(k.hinweise).slice(0, 160)}) – die API bleibt dezimal`);
      await geh(`#/kalkulation/${BS.pitten}`);
      await page.waitForSelector('[aria-label="Hinweise"]');
      const h = await text('[aria-label="Hinweise"]');
      pruef(/12 Std\. 30 Min\. ohne Lohngruppe/.test(h) && !/\d,\d+ Std\./.test(h), `Nachkalkulation: Hinweis „${h.slice(0, 160)}“ nicht in Langform`);
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
      console.log(`\n▶ Zeitformat ${g.name} (${g.width}×${g.height})`);
      const t = Date.now();
      const r = await laufe(browser, g);
      gesamt += r.fehler.length;
      console.log(`${r.fehler.length ? '✗' : '✓'} ${g.name}: ${r.schritte - r.fehler.length}/${r.schritte} Prüfungen bestanden (${((Date.now() - t) / 1000).toFixed(1)} s)`);
    }
    await browser.close();
    process.exit(gesamt ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(2); });
}
