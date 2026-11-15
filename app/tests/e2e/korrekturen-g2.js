'use strict';
/**
 * Oberfläche zu API.md 15.11 (Korrekturen G2 – Zahlungsstand und Texte), je Bildschirmgröße:
 *   node tests/e2e/korrekturen-g2.js      (im Ordner app; E2E_NUR=handy|tablet|pc; Exit-Code 1 bei Befunden)
 * Wird auch von run.js aufgerufen (abschaltbar mit E2E_OHNE_G2=1).
 *
 *  1. G2-001/G2-023: Polier und Mitarbeiter sehen an einer bezahlten Baustelle weder „Schlussrechnung“ noch „Bezahlt“ –
 *     Detail (Lebenslauf, Verlauf), Liste, Tafel (keine Spalten Schlussrechnung/Bezahlt) und Archiv zeigen „Abgeschlossen“.
 *  2. G2-025: Die Tafel zeigt Polier/Mitarbeiter (auch mit Ausnahmen) keine Ziehen-Anleitung; das Büro schon.
 *  3. G2-024: Eine gesperrte Bericht-Adresse lädt vor der neutralen Seite keine Geräte-, Material- oder Mitarbeiterlisten.
 */
const { chromium } = require('playwright');
const { starte, U, BS, START } = require('../api/hilfe');
const { wienDatum, plusTage } = require('../../server/datum');

const GROESSEN = [
  { name: 'handy', width: 390, height: 844, mobil: true },
  { name: 'tablet', width: 1180, height: 820, mobil: true },
  { name: 'pc', width: 1440, height: 900, mobil: false }
];
const GELD_TEXT = /Schlussrechnung|Bezahlt|Archiviert/;
const LISTEN = /\/api\/(geraete|materialien|mitarbeiter)(\?|$)/;

async function laufe(browser, g) {
  const fehler = [];
  let schritte = 0;
  const pruef = (ok, text) => { schritte++; if (!ok) { fehler.push(text); console.log('    ✗ ' + text); } };
  const s = await starte({ test: true, sitzung: { feldMin: 60 * 24 * 60, bueroMin: 60 * 24 * 60, maxH: 24 * 60 } });
  try {
    const gf = await s.login(U.gf), buero = await s.login(U.buero);
    // Ausnahmen für den Mitarbeiter (sieht dann Baustellen/Tafel), ohne Preis-/Kalkulationsrecht (gesperrt)
    for (const recht of ['kolonne', 'bericht_erstellen', 'bericht_freigeben', 'fuhrpark']) await gf.put('/rechte/ausnahme', { benutzerId: U.mitarbeiter, recht, wert: true });
    const heute = wienDatum(s.uhr());
    const ver = () => s.db.eins('SELECT version FROM baustelle WHERE id = ?', BS.pitten).version;
    for (const body of [{ phase: 'fertiggestellt', datum: plusTage(heute, -10) }, { phase: 'abgenommen', datum: plusTage(heute, -8), abnahmeDatum: plusTage(heute, -8) },
      { phase: 'schlussrechnung', datum: plusTage(heute, -6), schlussrechnung: { nr: 'SR-E2E-1' } }, { phase: 'bezahlt', datum: plusTage(heute, -2) }]) {
      const r = await gf.post(`/baustellen/${BS.pitten}/phase`, { version: ver(), ...body });
      if (r.status !== 200) throw new Error(`Phase ${body.phase}: ${r.status} ${JSON.stringify(r.daten)}`);
    }
    // fremder Bericht (Baustelle Reisinger, nicht die des Poliers)
    let fremd = s.db.eins('SELECT id FROM bericht WHERE baustelle_id = ? ORDER BY id LIMIT 1', BS.reisinger);
    if (!fremd) fremd = (await buero.post('/berichte', { baustelleId: BS.reisinger, datum: plusTage(heute, -1) })).daten;
    if (!fremd || !fremd.id) throw new Error('fremder Bericht fehlt');

    async function sitzung(benutzerId, wo, f) {
      const ctx = await browser.newContext({ viewport: { width: g.width, height: g.height }, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: g.mobil, serviceWorkers: 'block' });
      await ctx.clock.install({ time: new Date(START) });
      const page = await ctx.newPage();
      const anfragen = [], konsole = [];
      page.on('request', (r) => { const u = r.url(); if (u.startsWith(s.basis + '/api/')) anfragen.push(`${r.method()} ${u.slice(s.basis.length)}`); });
      page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[34]/.test(m.text())) konsole.push(m.text().slice(0, 140)); }); // 403/404 = erwartete Ablehnung der gesperrten Adresse
      page.on('pageerror', (e) => konsole.push(String(e.message).slice(0, 140)));
      await page.goto(s.basis + '/#/login', { waitUntil: 'domcontentloaded' });
      const st = await page.evaluate(async (bid) => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ benutzerId: bid, pin: '1234' }) })).status, benutzerId);
      if (st !== 200) throw new Error(`Anmeldung ${benutzerId}: ${st}`);
      await page.evaluate(() => localStorage.setItem('bt_ich', '{}'));
      await page.goto(`${s.basis}/?start=${benutzerId}#/`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#nav-seite .nav-item, #view', { state: 'attached' });
      const geh = async (h) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {}); await page.waitForTimeout(200); };
      const text = () => page.locator('#view').innerText();
      try { await f({ page, geh, text, anfragen }); } finally {
        pruef(konsole.length === 0, `${wo}/${g.name}: Konsolenfehler: ${konsole.slice(0, 3).join(' | ')}`);
        await ctx.close();
      }
    }

    for (const [wer, id] of [['Polier', U.polier], ['Mitarbeiter+Ausnahmen', U.mitarbeiter]]) {
      await sitzung(id, wer, async ({ page, geh, text, anfragen }) => {
        // 1) Detail
        await geh(`/baustelle/${BS.pitten}`);
        await page.waitForSelector('#lebenslauf', { timeout: 8000 }).catch(() => {});
        const t1 = await text();
        pruef(await page.locator('#lebenslauf').count() === 1, `${wer}/${g.name}: Lebenslauf fehlt`);
        pruef(!GELD_TEXT.test(t1), `${wer}/${g.name}: Detail zeigt den Zahlungsstand: ${(t1.match(GELD_TEXT) || [])[0]} (G2-001/G2-023)`);
        pruef(await page.locator('#lebenslauf[data-phase="abgeschlossen"] [data-schritt="abgeschlossen"]').count() === 1, `${wer}/${g.name}: Lebenslauf ohne neutralen Schritt „Abgeschlossen“`);
        pruef(await page.locator('[data-schritt="schlussrechnung"], [data-schritt="bezahlt"], [data-phase="bezahlt"], [data-phase="schlussrechnung"]').count() === 0, `${wer}/${g.name}: Schritte Schlussrechnung/Bezahlt sichtbar`);
        // 2) Archiv
        await geh('/baustellen/archiv');
        await page.waitForSelector('#archiv-liste', { timeout: 8000 }).catch(() => {});
        const t2 = await text();
        pruef(await page.locator(`#archiv-tabelle tr[data-bv="${BS.pitten}"]`).count() === 1, `${wer}/${g.name}: bezahlte Baustelle nicht unter „Abgeschlossene Bauvorhaben“`);
        pruef(/Abgeschlossen/.test(t2) && !GELD_TEXT.test(t2), `${wer}/${g.name}: Archiv zeigt den Zahlungsstand (G2-001)`);
        // 3) Tafel: keine Geldspalten, keine Ziehen-Anleitung (G2-025)
        await geh('/baustellen');
        const tafel = page.locator('[data-ansicht="tafel"]');
        if (await tafel.count()) {
          await tafel.first().click();
          await page.waitForSelector('#bv-tafel', { timeout: 6000 }).catch(() => {});
          const t3 = await text();
          pruef(await page.locator('#bv-tafel [data-spalte="schlussrechnung"], #bv-tafel [data-spalte="bezahlt"]').count() === 0, `${wer}/${g.name}: Tafel mit Spalten Schlussrechnung/Bezahlt (G2-023)`);
          pruef(!GELD_TEXT.test(t3), `${wer}/${g.name}: Tafel zeigt den Zahlungsstand`);
          pruef(!/Karte in die nächste Spalte ziehen/.test(t3) && await page.locator('#bv-tafel-hinweis').count() === 0, `${wer}/${g.name}: Tafel zeigt die Ziehen-Anleitung ohne Funktion (G2-025)`);
          pruef(await page.locator('.ll-karte[data-zieh], [data-bv-weiter]').count() === 0, `${wer}/${g.name}: Karten ziehbar bzw. mit Knopf`);
        } else pruef(false, `${wer}/${g.name}: Darstellung „Tafel“ fehlt`);
        // 4) gesperrte Bericht-Adresse: keine Datenlisten vor der neutralen Seite (G2-024)
        await geh('/');
        anfragen.length = 0;
        await geh(`/bericht/${fremd.id}`);
        await page.waitForSelector('[data-zustand="kein-zugriff"]', { timeout: 6000 }).catch(() => {});
        pruef(await page.locator('[data-zustand="kein-zugriff"]').count() === 1, `${wer}/${g.name}: gesperrte Bericht-Adresse zeigt nicht die neutrale Seite`);
        const geladen = anfragen.filter((a) => LISTEN.test(a.split(' ')[1]));
        pruef(geladen.length === 0, `${wer}/${g.name}: gesperrte Bericht-Adresse lädt Listen: ${geladen.join(' | ')} (G2-024)`);
      });
    }
    // Gegenprobe Büro: echte Phasen, Geldspalten und Anleitung vorhanden
    await sitzung(U.buero, 'Büro', async ({ page, geh, text }) => {
      await geh(`/baustelle/${BS.pitten}`);
      await page.waitForSelector('#lebenslauf', { timeout: 8000 }).catch(() => {});
      pruef(/Bezahlt/.test(await text()), `Büro/${g.name}: Detail ohne „Bezahlt“`);
      await geh('/baustellen');
      await page.locator('[data-ansicht="tafel"]').first().click();
      await page.waitForSelector('#bv-tafel', { timeout: 6000 }).catch(() => {});
      pruef(await page.locator('#bv-tafel [data-spalte="bezahlt"]').count() === 1, `Büro/${g.name}: Tafel ohne Spalte „Bezahlt“`);
      pruef(await page.locator('#bv-tafel-hinweis').count() === 1, `Büro/${g.name}: Tafel ohne Ziehen-Anleitung`);
    });
  } finally {
    await s.stop();
  }
  return { fehler, schritte };
}

module.exports = { laufe };

if (require.main === module) {
  (async () => {
    const browser = await chromium.launch();
    let gesamt = 0;
    for (const g of GROESSEN.filter((x) => !process.env.E2E_NUR || process.env.E2E_NUR.split(',').includes(x.name))) {
      console.log(`▶ ${g.name}`);
      const r = await laufe(browser, g);
      gesamt += r.fehler.length;
      console.log(`  ${r.schritte - r.fehler.length}/${r.schritte} Prüfungen bestanden`);
    }
    await browser.close();
    process.exit(gesamt ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
