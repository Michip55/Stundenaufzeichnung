'use strict';
/**
 * Prüfbericht 7 – Rechte in der Oberfläche (Playwright, eigenständig):
 *   node tests/e2e/rechte-ui.js            (im Ordner app; Exit-Code 1 bei Befunden)
 *
 * - Mitarbeiter und Polier, Handy- und PC-Breite: jede Route der SPA direkt per URL (auch versteckte),
 *   sichtbarer Text ohne € / Beträge, keine verbotenen Menüpunkte.
 * - ALLE Netzwerkantworten während des Rundgangs werden wie in rechte-matrix.test.js geprüft
 *   (Schlüssel, €-Beträge, Kanarienvögel): Die Oberfläche darf verbotene Daten nicht einmal EMPFANGEN.
 * - Geteiltes Gerät: Polier meldet sich ab, Mitarbeiter meldet sich an – im Browser-Speicher
 *   (localStorage, IndexedDB, Cache Storage) darf nichts vom Polier lesbar bleiben; die Offline-
 *   Warteschlange des Poliers darf nie mit der Sitzung des Mitarbeiters gesendet werden.
 * - Service Worker: /api wird nie zwischengespeichert.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../api/rechte-matrix-hilfe');
const { U, BS, START } = require('../api/hilfe');

const GROESSEN = [{ name: 'handy', width: 390, height: 844, mobil: true }, { name: 'pc', width: 1440, height: 900, mobil: false }];
// Menüpunkte (data-nav), die eine Rolle nie sehen darf
const VERBOTENE_NAV = {
  mitarbeiter: ['dashboard', 'kolonne', 'berichte', 'baustellen', 'plan', 'partie', 'offeneposten', 'kalkulation', 'preise', 'monat', 'benutzer'],
  polier: ['dashboard', 'plan', 'offeneposten', 'kalkulation', 'preise', 'monat', 'benutzer']
};
// sichtbarer Text: €-Zeichen oder Betrag mit zwei Nachkommastellen und Währung
const GELD_SICHTBAR = /€|\bEUR\b|\d+,\d{2}\s?€/;

async function main() {
  const basis = await H.erstelleBasis();
  const F = basis.F;
  const s = await H.starteKopie(basis);
  const browser = await chromium.launch();
  const befunde = [];
  const notiere = (x) => { befunde.push(x); console.log('  ✗ ' + x); };
  let antworten = 0, seiten = 0;

  const ROUTEN = ['/stempeln', '/kolonne', '/woche', '/berichte', `/bericht/${F.bericht.bs1}`, `/bericht/${F.bericht.bs3}`, `/bericht/${F.bericht.bs1Alt}`, '/dashboard', '/baustellen', '/baustellen/archiv',
    `/baustelle/${BS.pitten}`, `/baustelle/${BS.reisinger}`, '/plan', '/einsatz', '/partie', '/offene-posten', '/preise', '/preise?tab=katalog', '/urlaub', '/lohn-vorlagen', '/kalkulation',
    `/kalkulation/${BS.pitten}`, `/kalkulation/${BS.pitten}/positionen`, `/kalkulation/${BS.reisinger}`, '/monat', '/benutzer', '/fuhrpark', '/fuhrpark/anlage/4', '/fuhrpark/anlage/30',
    '/mehr', '/zwei-faktor', '/push', '/hilfe', '/abwesenheiten', '/korrektur', '/pin', '/gibt-es-nicht'];

  async function kontext(g) {
    const ctx = await browser.newContext({ viewport: { width: g.width, height: g.height }, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: g.mobil, serviceWorkers: 'allow' });
    await ctx.clock.install({ time: new Date(START) });
    return ctx;
  }
  async function anmelden(page, id) {
    await page.goto(s.basis + '/#/login', { waitUntil: 'domcontentloaded' });
    const r = await page.evaluate(async (bid) => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ benutzerId: bid, pin: '1234' }) })).status, id);
    if (r !== 200) throw new Error(`Anmeldung ${id}: ${r}`);
    // wie nach der Anmeldung über die Oberfläche: Hinweis „angemeldet“ für den App-Start (app.js ladeIch)
    await page.evaluate(() => localStorage.setItem('bt_ich', '{}'));
    // vollständig neu laden (anderer Query-Teil erzwingt echten Seitenaufruf, nicht nur Hash-Wechsel)
    await page.goto(`${s.basis}/?nach-login=${Date.now()}#/stempeln`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const ok = await page.evaluate(() => !!document.querySelector('[data-nav]'));
    if (!ok) throw new Error(`Nach der Anmeldung von ${id} kein App-Rahmen sichtbar`);
  }
  function mitschneiden(page, rolle, wo) {
    const offen = [];
    page.on('response', (r) => {
      const url = r.url();
      if (!url.startsWith(s.basis)) return;
      offen.push((async () => {
        let buf;
        try { buf = await Promise.race([r.body(), new Promise((_, nok) => setTimeout(() => nok(new Error('Zeit')), 5000))]); } catch (_) { return; }
        antworten++;
        const ct = r.headers()['content-type'] || '';
        let daten = buf;
        if (ct.includes('application/json')) { try { daten = JSON.parse(buf.toString('utf8')); } catch (_) { daten = buf.toString('utf8'); } }
        else if (!/pdf|spreadsheet|image/.test(ct)) daten = buf.toString('utf8');
        const pfad = url.slice(s.basis.length);
        const v = await H.scanne(rolle, { status: r.status(), daten, headers: { get: (k) => r.headers()[k.toLowerCase()] } }, { route: `${r.request().method()} ${pfad.split("?")[0]}`, url: `${pfad} (${wo})`, nurKanarien: !pfad.startsWith('/api/') }); // statische Dateien: Programmtext, nur auf Daten (Kanarienvögel) prüfen
        v.forEach(notiere);
      })());
    });
    return () => Promise.race([Promise.all(offen), new Promise((ok) => setTimeout(ok, 10000))]);
  }

  /* ---------- 1) Rundgang Mitarbeiter und Polier, Handy und PC ---------- */
  for (const rolle of process.env.BAUTAG_RECHTE_UI_NUR_GERAET ? [] : ['mitarbeiter', 'polier']) {
    for (const g of GROESSEN) {
      const ctx = await kontext(g);
      const page = await ctx.newPage();
      const warten = mitschneiden(page, rolle, `${rolle}/${g.name}`);
      await anmelden(page, H.ID[rolle]);
      for (const r of ROUTEN) {
        if (process.env.BAUTAG_RECHTE_UI_LOG) console.log(`  ${rolle}/${g.name} #${r}`);
        // Adresse direkt eintippen: jede 4. Route als vollständiger Neuaufruf, sonst Hash-Wechsel (SPA)
        if (seiten % 4 === 0) await page.goto(`${s.basis}/?direkt=${seiten}#${r}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        else await page.evaluate((h) => { location.hash = h; }, r);
        await page.waitForTimeout(900);
        seiten++;
        const text = await page.evaluate(() => document.body.innerText);
        if (!(await page.evaluate(() => !!document.querySelector('[data-nav]')))) notiere(`${rolle}/${g.name} #${r}: kein App-Rahmen (abgemeldet?) – Rundgang ungültig`);
        const m = GELD_SICHTBAR.exec(text);
        if (m) notiere(`${rolle}/${g.name} #${r}: sichtbar „${text.slice(Math.max(0, m.index - 50), m.index + 30).replace(/\s+/g, ' ')}“`);
        for (const kan of H.verboteneKanarien(rolle)) for (const f of kan.formen) if (text.includes(f)) notiere(`${rolle}/${g.name} #${r}: Kanarienvogel ${kan.name} sichtbar`);
        // Krankenstand anderer: der Polier selbst ist in den Testdaten nie krank – jedes „Krank“ betrifft andere
        // Legenden der Code-Kürzel (Bautagesbericht „K = Krank · U = Urlaub …“, Urlaubskalender „U Urlaub ZA Zeitausgleich K Krank …“) sind keine Personendaten
        const ohneLegende = text.replace(/K\s*=\s*Krank/g, '').replace(/ZA\s+Zeitausgleich\s+K\s+Krank\s+SW\s+Schlechtwetter/g, '');
        if (rolle === 'polier') { const k = /\bKrank(enstand)?\b/.exec(ohneLegende); if (k) notiere(`${rolle}/${g.name} #${r}: „${k[0]}“ sichtbar: „${ohneLegende.slice(Math.max(0, k.index - 60), k.index + 30).replace(/\s+/g, ' ')}“`); }
        const nav = await page.evaluate(() => [...document.querySelectorAll('[data-nav]')].map((e) => e.dataset.nav));
        for (const n of VERBOTENE_NAV[rolle]) if (nav.includes(n)) notiere(`${rolle}/${g.name} #${r}: verbotener Menüpunkt „${n}“`);
        // versteckte Inhalte zählen auch: gesamtes DOM (inkl. display:none) auf Kanarienvögel prüfen
        const html = await page.content();
        for (const kan of H.verboteneKanarien(rolle)) for (const f of kan.formen) if (html.includes(f)) notiere(`${rolle}/${g.name} #${r}: Kanarienvogel ${kan.name} im DOM (versteckt)`);
      }
      // Service Worker: nie /api im Cache
      if (process.env.BAUTAG_RECHTE_UI_LOG) console.log('  Cache-Prüfung');
      const cacheApi = await page.evaluate(async () => { const out = []; for (const n of await caches.keys()) { const c = await caches.open(n); for (const k of await c.keys()) if (new URL(k.url).pathname.startsWith('/api/')) out.push(k.url); } return out; });
      if (cacheApi.length) notiere(`${rolle}/${g.name}: Service-Worker-Cache enthält API-Antworten: ${cacheApi.join(', ')}`);
      if (process.env.BAUTAG_RECHTE_UI_LOG) console.log('  warte auf Antworten');
      await warten();
      await ctx.close();
    }
  }

  /* ---------- 2) Geteiltes Gerät: Polier → Abmelden → Mitarbeiter ---------- */
  const log = (x) => { if (process.env.BAUTAG_RECHTE_UI_LOG) console.log('  [Gerät] ' + x); };
  {
    const ctx = await kontext(GROESSEN[0]);
    const page = await ctx.newPage();
    await anmelden(page, U.polier);
    log('Polier angemeldet');
    for (const r of ['/stempeln', '/einsatz', '/partie', '/fuhrpark', '/berichte', `/bericht/${F.bericht.bs1}`, '/abwesenheiten', '/urlaub']) { await page.evaluate((h) => { location.hash = h; }, r); await page.waitForTimeout(900); }
    // Offline-Warteschlange des Poliers (wie nach Stempeln ohne Netz)
    await page.evaluate((id) => {
      const q = JSON.parse(localStorage.getItem('bt_stempel_queue') || '[]');
      q.push({ typ: 'kommen', baustelleId: 1, benutzerId: id, zeit: new Date().toISOString(), nr: 'rechte-test-1' });
      localStorage.setItem('bt_stempel_queue', JSON.stringify(q));
    }, U.polier);
    log('Warteschlange gesetzt');
    // Abmelden über die Oberfläche (Mehr → Abmelden)
    await page.evaluate(() => { location.hash = '/mehr'; });
    await page.waitForTimeout(900);
    page.once('dialog', (d) => d.accept());
    if (!(await page.$('#abmelden'))) { await page.goto(`${s.basis}/?mehr=1#/mehr`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500); }
    if (!(await page.$('#abmelden'))) throw new Error('Abmelden-Schaltfläche fehlt: ' + (await page.evaluate(() => document.body.innerText)).slice(0, 300));
    await page.click('#abmelden');
    await page.waitForTimeout(800);
    const bestaetige = await page.$('[data-ok]');
    if (bestaetige) { await bestaetige.click().catch(() => {}); await page.waitForTimeout(500); }
    log('abgemeldet');
    const speicher = await page.evaluate(async () => {
      const ls = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = localStorage.getItem(k); }
      const idb = {};
      if (indexedDB.databases) {
        for (const d of await indexedDB.databases()) {
          idb[d.name] = await new Promise((ok) => { const r = indexedDB.open(d.name); r.onsuccess = () => { const db = r.result; const out = {}; const st = [...db.objectStoreNames]; if (!st.length) return ok(out); const t = db.transaction(st, 'readonly'); let n = st.length; for (const x of st) { const g = t.objectStore(x).getAll(); g.onsuccess = () => { out[x] = g.result; if (!--n) ok(out); }; } }; r.onerror = () => ok(null); });
        }
      }
      const ss = {}; for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); ss[k] = sessionStorage.getItem(k); }
      return { ls, idb, ss, cookie: document.cookie };
    });
    log('Speicher gelesen: ' + Object.keys(speicher.ls).join(','));
    const polierDaten = (wert) => {
      const t = JSON.stringify(wert);
      return /"uid":1\b|"benutzerId":1\b|Haidbauer|"benutzer":\{"id":1\b/.test(t);
    };
    for (const [k, w] of Object.entries(speicher.ls)) {
      if (k === 'bt_stempel_queue') continue; // absichtlich (Offline-Buchung darf nicht verloren gehen, M-04) – wird unten auf Missbrauch geprüft
      if (polierDaten(w) || k === 'bt_einsatz' || k === 'bt_ich' || k === 'bt_status') notiere(`geteiltes Gerät: nach Abmelden des Poliers bleibt localStorage[${k}] lesbar (${String(w).length} Zeichen): ${String(w).slice(0, 160)}`);
    }
    for (const [k, w] of Object.entries(speicher.idb)) if (polierDaten(w)) notiere(`geteiltes Gerät: nach Abmelden bleibt IndexedDB ${k} mit Daten des Poliers`);
    if (speicher.cookie) notiere(`geteiltes Gerät: Cookie nach Abmelden per JS lesbar: ${speicher.cookie}`);
    // Mitarbeiter meldet sich am selben Gerät an – die Warteschlange des Poliers darf nicht mit seiner Sitzung gesendet werden
    const vorher = s.db.eins("SELECT COUNT(*) AS n FROM buchung WHERE quelle = 'offline'").n;
    await anmelden(page, U.mitarbeiter);
    await page.goto(`${s.basis}/?ma=1#/stempeln`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForTimeout(1000);
    const nachher = s.db.alle("SELECT benutzer_id FROM buchung WHERE quelle = 'offline'");
    if (nachher.length !== vorher) notiere(`geteiltes Gerät: Offline-Buchung des Poliers wurde nach Benutzerwechsel gesendet (als Benutzer ${nachher.map((x) => x.benutzer_id).join(',')})`);
    const sichtbar = await page.evaluate(() => document.body.innerText);
    if (/Haidbauer/.test(sichtbar) && !/Polier/.test(sichtbar)) notiere('geteiltes Gerät: Name des Vorbenutzers in der Oberfläche des Mitarbeiters');
    await ctx.close();
  }

  /* ---------- 3) Statische Dateien: keine Daten im Bundle ---------- */
  for (const f of ['/', '/index.html', '/sw.js', '/manifest.webmanifest', '/offline.html']) {
    const r = await fetch(s.basis + f);
    const t = await r.text();
    for (const kan of H.verboteneKanarien('mitarbeiter')) for (const x of kan.formen) if (t.includes(x)) notiere(`statisch ${f}: Kanarienvogel ${kan.name}`);
  }

  await browser.close();
  await s.stop();
  fs.rmSync(basis.ordner, { recursive: true, force: true });
  console.log(`\nRechte-UI: ${seiten} Seitenaufrufe, ${antworten} Netzwerkantworten geprüft, ${befunde.length} Befund(e).`);
  if (process.env.BAUTAG_RECHTE_UI_BERICHT) fs.writeFileSync(process.env.BAUTAG_RECHTE_UI_BERICHT, JSON.stringify({ seiten, antworten, befunde }, null, 1));
  process.exitCode = befunde.length ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 2; });
