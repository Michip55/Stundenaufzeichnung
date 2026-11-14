'use strict';
/**
 * „Keine Sackgassen“ (Inhaber: „Wenn die Funktionen gesperrt sind … sollen sie nicht mal den Menüpunkt sehen können.“)
 *   node tests/e2e/sackgassen.js        (im Ordner app; E2E_NUR=handy|tablet|pc; Exit-Code 1 bei Befunden)
 * Wird auch von run.js je Bildschirmgröße aufgerufen.
 *
 * Je Rolle (GF, Büro, Bauleiter, Polier, Mitarbeiter sowie ein Polier und ein Mitarbeiter mit Ausnahmen):
 *  1. Menü: die sichtbaren Menüpunkte sind GENAU die hier festgelegte Liste – ein neuer Menüpunkt braucht eine bewusste Entscheidung.
 *  2. Rundgang nur über die sichtbare Oberfläche (Breitensuche): jeder sichtbare Link, jede Kachel, jeder Reiter und jeder
 *     Menüeintrag wird angeklickt. Kein Klick darf zu einer 401/403-Antwort, zu „Seite nicht verfügbar“ oder zu einem
 *     Konsolenfehler führen.
 *  3. Mitarbeiter und Polier: der sichtbare Text enthält keine gesperrten Begriffe (Nachkalkulation, Preis, €, Rechnung,
 *     Lohngruppe, Budget, Auftragssumme) und keine Abwesenheiten anderer.
 *  4. Direkt eingetippte gesperrte Adressen: neutrale Seite „Seite nicht verfügbar“ – ohne Titel der Seite und ohne
 *     dass vorher gesperrte Daten angefragt werden (keine 401/403-Antwort, keine Fach-Anfrage).
 */
const { chromium } = require('playwright');
const { starte, U, START } = require('../api/hilfe');

const GROESSEN = [
  { name: 'handy', width: 390, height: 844, mobil: true },
  { name: 'tablet', width: 1180, height: 820, mobil: true },
  { name: 'pc', width: 1440, height: 900, mobil: false }
];

// Sichtbare Menüpunkte je Rolle (Reihenfolge wie in der Seitenleiste). Bewusst ausgeschrieben – nicht aus der App abgeleitet.
const BUERO_MENUE = ['dashboard', 'berichte', 'baustellen', 'plan', 'offeneposten', 'kalkulation', 'preise', 'fuhrpark', 'monat', 'abwesenheiten', 'urlaub', 'benutzer', 'stempeln', 'woche'];
const MENUE = {
  gf: ['dashboard', 'berichte', 'baustellen', 'plan', 'offeneposten', 'kalkulation', 'preise', 'fuhrpark', 'monat', 'abwesenheiten', 'urlaub', 'benutzer', 'stempeln', 'kolonne', 'woche'],
  buero: BUERO_MENUE,
  bauleiter: BUERO_MENUE, // Inhaber 13.11.2026: wie das Büro (Stempeluhr und Urlaub hat auch das Büro)
  polier: ['stempeln', 'partie', 'kolonne', 'berichte', 'woche', 'baustellen', 'einsatz2', 'fuhrpark', 'abwesenheiten', 'urlaub'],
  mitarbeiter: ['stempeln', 'einsatz', 'woche', 'fuhrpark', 'abwesenheiten', 'urlaub'],
  // Ausnahmen je Person (nur Erweiterungen möglich): Polier darf zusätzlich Berichte freigeben und den Fuhrpark pflegen
  polierPlus: ['dashboard', 'partie', 'berichte', 'baustellen', 'einsatz2', 'fuhrpark', 'urlaub', 'stempeln', 'kolonne', 'woche', 'abwesenheiten'],
  // Mitarbeiter darf zusätzlich die Kolonne stempeln und Berichte erstellen
  mitarbeiterPlus: ['stempeln', 'einsatz', 'kolonne', 'berichte', 'woche', 'fuhrpark', 'abwesenheiten', 'urlaub']
};
const PERSONEN = [
  { schluessel: 'gf', id: U.gf },
  { schluessel: 'buero', id: U.buero },
  { schluessel: 'bauleiter', id: U.bauleiter },
  { schluessel: 'polier', id: U.polier, feld: true },
  { schluessel: 'mitarbeiter', id: U.mitarbeiter, feld: true },
  { schluessel: 'polierPlus', id: U.polier2, feld: true, ausnahmen: ['bericht_freigeben', 'fuhrpark'] },
  { schluessel: 'mitarbeiterPlus', id: 3, feld: true, ausnahmen: ['kolonne', 'bericht_erstellen'] }
];
// Gesperrte Begriffe für Polier und Mitarbeiter (sichtbarer Text der ganzen Seite)
const VERBOTEN = /Nachkalkulation|Preis|€|Rechnung|Lohngruppe|Budget|Auftragssumme|Abwesenheiten (meiner|der) Partie|\babwesend\b|\babw\./;
// Direkt eingetippte Adressen (alle Routen der SPA mit Rechteprüfung)
const DIREKT = ['/dashboard', '/kolonne', '/berichte', '/bericht/1', '/baustellen', '/baustellen/archiv', '/baustelle/1', '/plan', '/partie', '/offene-posten', '/preise', '/lohn-vorlagen',
  '/kalkulation', '/kalkulation/1', '/kalkulation/1/positionen', '/monat', '/benutzer', '/korrektur'];
// Fach-Anfragen, die vor der Rechteprüfung nie gestellt werden dürfen (Rahmen: Anmeldung, Glocke, Dienste, Status)
const RAHMEN_API = /^\/api\/(auth\/|benachrichtigungen|integrationen|push\/|zeit\/status|fuhrpark\/schaeden|version|einstellungen\/oeffentlich)/;
const MAX_SEITEN = Number(process.env.SACKGASSEN_MAX || 70); // je Rolle; je Adress-Muster höchstens zwei Beispiele
// Knöpfe mit Wirkung (buchen, senden, löschen, abmelden, drucken …) klickt der Rundgang nicht an
const HEIKEL = /lösch|entfern|abmeld|kommen|gehen|pause|wechsel|send|speicher|freigeb|veröffentlich|buch|storn|bestätig|genehmig|ablehn|zurück|unterschr|übernehm|abschlie|archiv|drucken|pdf|export|csv|excel|herunter|installier|foto|kamera|diktat|aufnahme|abrufen|test|zurücksetz|entsperr|erledigt|gelesen|einteilen|anruf/i;
const muster = (h) => h.replace(/\d+/g, ':id').replace(/=[^&]*/g, '=…');

async function laufe(browser, g) {
  const fehler = [];
  let schritte = 0;
  const pruef = (ok, text) => { schritte++; if (!ok) { fehler.push(text); console.log('    ✗ ' + text); } };
  const s = await starte({ test: true });
  const menues = {};
  try {
    // Ausnahmen je Person vergeben (als Geschäftsführung)
    const gf = s.client();
    await gf.post('/auth/login', { benutzerId: U.gf, pin: '1234' });
    for (const p of PERSONEN) for (const recht of p.ausnahmen || []) { const r = await gf.put('/rechte/ausnahme', { benutzerId: p.id, recht, wert: true }); if (r.status >= 300) throw new Error(`Ausnahme ${recht} für ${p.id}: ${r.status} ${JSON.stringify(r.daten)}`); }

    for (const p of PERSONEN) {
      const wo = `Sackgassen ${p.schluessel}/${g.name}`;
      const ctx = await browser.newContext({ viewport: { width: g.width, height: g.height }, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: g.mobil, serviceWorkers: 'block' });
      await ctx.clock.install({ time: new Date(START) });
      const page = await ctx.newPage();
      let ort = 'Anmeldung';
      const befunde = new Set();
      const anfragen = [], gesperrteAntworten = [];
      page.on('response', (r) => {
        const u = r.url(); if (!u.startsWith(s.basis + '/api/')) return;
        const pfad = u.slice(s.basis.length);
        anfragen.push(pfad);
        if ([401, 403].includes(r.status())) gesperrteAntworten.push(pfad.split('?')[0]);
        if ([401, 403].includes(r.status())) befunde.add(`${ort}: ${r.request().method()} ${pfad.split('?')[0]} → ${r.status()}`);
      });
      page.on('console', (m) => { if (m.type() === 'error') befunde.add(`${ort}: Konsolenfehler „${m.text().slice(0, 140)}“`); });
      page.on('pageerror', (e) => befunde.add(`${ort}: Skriptfehler „${String(e.message).slice(0, 140)}“`));
      const ruhe = async () => { await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {}); await page.waitForTimeout(120); };

      await page.goto(s.basis + '/#/login', { waitUntil: 'domcontentloaded' });
      const st = await page.evaluate(async (bid) => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ benutzerId: bid, pin: '1234' }) })).status, p.id);
      if (st !== 200) throw new Error(`Anmeldung ${p.schluessel}: ${st}`);
      await page.evaluate(() => localStorage.setItem('bt_ich', '{}'));
      await page.goto(`${s.basis}/?start=${p.schluessel}#/`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#nav-seite .nav-item, #view', { state: 'attached' });
      await ruhe();

      /* ---- 1) Menü = festgelegte Liste ---- */
      const menue = await page.evaluate(() => [...new Set([...document.querySelectorAll('#nav-seite .nav-item')].map((a) => a.dataset.nav))]);
      menues[p.schluessel] = await page.evaluate(() => [...document.querySelectorAll('#nav-seite .nav-item .lbl-long')].map((x) => x.textContent.trim()));
      pruef(JSON.stringify(menue) === JSON.stringify(MENUE[p.schluessel]), `${wo}: Menü weicht von der festgelegten Liste ab – ist [${menue}] statt [${MENUE[p.schluessel]}]`);
      // untere Leiste und „Mehr“ zeigen nur Punkte aus derselben Liste
      const leiste = await page.evaluate(() => [...document.querySelectorAll('[data-nav]')].filter((a) => a.offsetParent !== null).map((a) => a.dataset.nav).filter((x) => x !== 'mehr'));
      pruef(leiste.every((x) => MENUE[p.schluessel].includes(x)), `${wo}: sichtbare Navigation zeigt Punkte außerhalb der Liste (${leiste.filter((x) => !MENUE[p.schluessel].includes(x))})`);

      /* ---- 2) Rundgang über sichtbare Links, Kacheln, Reiter, Menüeinträge ---- */
      const gesehen = new Set(), jeMuster = new Map(), schlange = [];
      const knopfSeiten = new Set();
      const merke = (h, von) => {
        if (!h || !h.startsWith('#/') || gesehen.has(h) || /^#\/(login)?$/.test(h)) return;
        const m = muster(h); const n = jeMuster.get(m) || 0; if (n >= 2) return;
        jeMuster.set(m, n + 1); gesehen.add(h); schlange.push([h, von]);
      };
      const sammle = async (von) => {
        const links = await page.evaluate(() => [...document.querySelectorAll('a[href^="#/"]')].filter((a) => a.offsetParent !== null || a.getClientRects().length).map((a) => a.getAttribute('href')));
        links.forEach((h) => merke(h, von));
      };
      const pruefSeite = async (h, von) => {
        const zustand = await page.evaluate(() => ({ gesperrt: !!document.querySelector('[data-zustand="kein-zugriff"]'), text: document.body.innerText, fehlt: /Seite nicht gefunden/.test(document.body.innerText) }));
        pruef(!zustand.gesperrt, `${wo}: ${von} führt zu ${h} → „Seite nicht verfügbar“`);
        pruef(!zustand.fehlt, `${wo}: ${von} führt zu ${h} → „Seite nicht gefunden“`);
        pruef(!/\bKein Zugriff\b/.test(zustand.text), `${wo}: ${h} zeigt „Kein Zugriff“ in einem Teilbereich (von ${von})`);
        if (p.feld) { const m = VERBOTEN.exec(zustand.text); pruef(!m, `${wo}: ${h} zeigt gesperrten Begriff „${m && zustand.text.slice(Math.max(0, m.index - 40), m.index + 30).replace(/\s+/g, ' ')}“`); }
      };
      merke(await page.evaluate(() => location.hash), 'Startseite');
      if (g.name === 'handy') merke('#/mehr', 'untere Leiste „Mehr“');
      await sammle('Navigation');
      let seiten = 0;
      while (schlange.length && seiten < MAX_SEITEN) {
        const [h, von] = schlange.shift();
        ort = `${h} (von ${von})`;
        await page.evaluate((x) => { location.hash = x; }, h);
        await ruhe();
        seiten++;
        await pruefSeite(h, von);
        await sammle(h);
        // Knöpfe, die nur etwas öffnen (Dialog, Auswahl, Assistent): anklicken, auf 401/403 achten, wieder schließen.
        // Nichts, was bucht, sendet, löscht oder abmeldet.
        if (!knopfSeiten.has(muster(h))) {
          knopfSeiten.add(muster(h));
          const SEL = '#view button:visible:not([type="submit"]):not([role="tab"]):not([data-ansicht]):not(.chip-btn):not([data-stempel]):not([disabled])';
          const anzahl = Math.min(await page.locator(SEL).count(), 14);
          for (let i = 0; i < anzahl; i++) {
            const knopf = page.locator(SEL).nth(i);
            if (!(await knopf.count())) break;
            const name = ((await knopf.innerText().catch(() => '')) || (await knopf.getAttribute('aria-label').catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 40);
            if (!name || HEIKEL.test(name)) continue;
            ort = `${h} › Knopf „${name}“`;
            await knopf.click({ timeout: 2000 }).catch(() => {});
            await ruhe();
            const offen = await page.evaluate(() => { const d = [...document.querySelectorAll('dialog[open]')]; const t = d.map((x) => x.innerText).join(' '); d.forEach((x) => x.close()); return { n: d.length, t }; });
            if (offen.n) { pruef(!/Kein Zugriff|nicht verfügbar\b(?!\s*–)/.test(offen.t.replace(/Wetter nicht verfügbar/g, '')), `${wo}: ${ort} öffnet einen gesperrten Dialog`); if (p.feld) { const m = VERBOTEN.exec(offen.t); pruef(!m, `${wo}: ${ort} zeigt gesperrten Begriff „${m && offen.t.slice(Math.max(0, m.index - 40), m.index + 30).replace(/\s+/g, ' ')}“`); } }
            if (await page.evaluate((x) => location.hash !== x, h)) { merke(await page.evaluate(() => location.hash), ort); await page.evaluate((x) => { location.hash = x; }, h); await ruhe(); }
          }
        }
        // Reiter und Umschalter ohne eigene Adresse: jeden einmal anklicken
        const reiter = await page.locator('#view button[role="tab"]:visible, #view button[data-ansicht]:visible, #view .chip-btn:visible').count();
        for (let i = 0; i < Math.min(reiter, 8); i++) {
          const knopf = page.locator('#view button[role="tab"]:visible, #view button[data-ansicht]:visible, #view .chip-btn:visible').nth(i);
          if (!(await knopf.count()) || await knopf.isDisabled().catch(() => true)) continue;
          const name = (await knopf.innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 30);
          ort = `${h} › Reiter „${name}“`;
          await knopf.click({ timeout: 3000 }).catch(() => {});
          await ruhe();
          await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
          if (await page.evaluate((x) => location.hash !== x, h)) { merke(await page.evaluate(() => location.hash), ort); await page.evaluate((x) => { location.hash = x; }, h); await ruhe(); continue; }
          await pruefSeite(h, ort);
          await sammle(ort);
        }
      }
      // Glocke: Verweise in den Benachrichtigungen
      ort = 'Glocke';
      if (await page.locator('#glocke:visible').count()) { await page.click('#glocke').catch(() => {}); await ruhe(); await sammle('Benachrichtigung'); await page.keyboard.press('Escape').catch(() => {}); }
      while (schlange.length && seiten < MAX_SEITEN + 10) {
        const [h, von] = schlange.shift();
        ort = `${h} (von ${von})`;
        await page.evaluate((x) => { location.hash = x; }, h); await ruhe(); seiten++;
        await pruefSeite(h, von);
      }
      pruef(seiten >= (p.feld ? 8 : 20), `${wo}: Rundgang zu kurz (${seiten} Seiten) – Navigation nicht gefunden?`);
      pruef(befunde.size === 0, `${wo}: ${befunde.size} Sackgasse(n): ${[...befunde].slice(0, 6).join(' | ')}`);

      /* ---- 4) direkt eingetippte Adressen ---- */
      befunde.clear();
      for (const r of DIREKT) {
        ort = `direkt ${r}`;
        await page.evaluate(() => { location.hash = '/mehr'; }); await ruhe();
        anfragen.length = 0; gesperrteAntworten.length = 0;
        const vorher = new Set(befunde);
        await page.evaluate((x) => { location.hash = x; }, r);
        await ruhe();
        const z = await page.evaluate(() => ({ gesperrt: !!document.querySelector('[data-zustand="kein-zugriff"]'), sicht: document.querySelector('#view').innerText, titel: (document.querySelector('#titel') || {}).textContent || '', tab: document.title }));
        if (!z.gesperrt) continue;
        pruef(/Seite nicht verfügbar/.test(z.sicht) && /nicht verfügbar/.test(z.titel) && /nicht verfügbar/.test(z.tab), `${wo}: ${r} ist gesperrt, nennt aber die Seite (Titel „${z.titel}“, Reiter „${z.tab}“)`);
        pruef(!VERBOTEN.test(z.sicht + z.titel + z.tab), `${wo}: gesperrte Seite ${r} verrät ihren Inhalt („${z.sicht.replace(/\s+/g, ' ').slice(0, 100)}“)`);
        // Sonderfall einzelnes Objekt (z. B. Bericht einer fremden Baustelle): ob es gesperrt ist, weiß nur der Server – erlaubt ist
        // genau diese eine abgelehnte Anfrage nach dem Objekt selbst; sie liefert keine Daten
        const id = (/\/(\d+)$/.exec(r) || [])[1];
        if (id && gesperrteAntworten.length === 1 && gesperrteAntworten[0].endsWith(`/${id}`) && /^#?\/bericht\//.test(r)) { befunde.clear(); vorher.forEach((x) => befunde.add(x)); continue; }
        const fach = anfragen.filter((a) => !RAHMEN_API.test(a));
        pruef(fach.length === 0, `${wo}: ${r} ist gesperrt, fragt aber vorher Daten an (${fach.slice(0, 3).join(', ')})`);
      }
      pruef(befunde.size === 0, `${wo}: direkt eingetippte Adressen lösen 401/403 oder Fehler aus: ${[...befunde].slice(0, 5).join(' | ')}`);
      await ctx.close();
    }
  } finally { await s.stop(); }
  return { fehler, schritte, menues };
}

module.exports = { laufe, MENUE, GROESSEN };

if (require.main === module) {
  (async () => {
    const browser = await chromium.launch();
    let gesamt = 0;
    for (const g of GROESSEN.filter((x) => !process.env.E2E_NUR || process.env.E2E_NUR.split(',').includes(x.name))) {
      console.log(`\n▶ Sackgassen ${g.name} (${g.width}×${g.height})`);
      const t = Date.now();
      const r = await laufe(browser, g);
      gesamt += r.fehler.length;
      console.log(`${r.fehler.length ? '✗' : '✓'} ${g.name}: ${r.schritte - r.fehler.length}/${r.schritte} Prüfungen bestanden (${((Date.now() - t) / 1000).toFixed(1)} s)`);
      if (process.env.SACKGASSEN_MENUE) for (const [k, v] of Object.entries(r.menues)) console.log(`  ${k}: ${v.join(' · ')}`);
    }
    await browser.close();
    process.exit(gesamt ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(2); });
}
