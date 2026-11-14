'use strict';
/**
 * Prüfbericht 7 – Rechte in der Oberfläche (Playwright, eigenständig):
 *   node tests/e2e/rechte-ui.js            (im Ordner app; Exit-Code 1 bei Befunden; E2E_NUR=handy|pc, BAUTAG_RECHTE_UI_IDENT=<RegExp>)
 *
 * - Mitarbeiter und Polier, Handy- und PC-Breite: jede Route der SPA direkt per URL (auch versteckte),
 *   sichtbarer Text ohne € / Beträge, keine verbotenen Menüpunkte.
 * - ALLE Netzwerkantworten während des Rundgangs werden wie in rechte-matrix.test.js geprüft
 *   (Schlüssel, €-Beträge, Kanarienvögel): Die Oberfläche darf verbotene Daten nicht einmal EMPFANGEN.
 * - Geteiltes Gerät: Polier meldet sich ab, Mitarbeiter meldet sich an – im Browser-Speicher
 *   (localStorage, IndexedDB, Cache Storage) darf nichts vom Polier lesbar bleiben; die Offline-
 *   Warteschlange des Poliers darf nie mit der Sitzung des Mitarbeiters gesendet werden.
 * - Service Worker: /api wird nie zwischengespeichert.
 * - F-044: Identitäten auch MIT allen vergebbaren Ausnahmen (Mitarbeiter, Polier) und der Bauleiter (Menü = Büro-Menü,
 *   keine GF-Vorbehalte). Eine Antwort, die nicht (rechtzeitig) gelesen werden kann, ist ein Befund – nie still verworfen.
 * - F-042: jedes sichtbare Bedienelement mit Ziel (Links, data-href/-nav, Knöpfe mit Klick-Handler im Trockenlauf,
 *   Benachrichtigungen) darf nicht auf eine für die Identität gesperrte Seite oder Datei führen.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../api/rechte-matrix-hilfe');
const { U, BS, START } = require('../api/hilfe');
const BE = require('./bedienelemente');

const GROESSEN = [{ name: 'handy', width: 390, height: 844, mobil: true }, { name: 'pc', width: 1440, height: 900, mobil: false }]
  .filter((g) => !process.env.E2E_NUR || process.env.E2E_NUR.split(',').includes(g.name));
// Menüpunkte (data-nav), die eine Rolle nie sehen darf
const VERBOTENE_NAV = {
  mitarbeiter: ['dashboard', 'kolonne', 'berichte', 'baustellen', 'plan', 'partie', 'offeneposten', 'kalkulation', 'preise', 'monat', 'benutzer'],
  polier: ['dashboard', 'plan', 'offeneposten', 'kalkulation', 'preise', 'monat', 'benutzer'],
  // mit allen vergebbaren Ausnahmen bleiben Preise, Kalkulation, Lohn und Benutzerverwaltung gesperrt (rechte.js GESPERRT)
  ausnahmen: ['offeneposten', 'kalkulation', 'preise', 'monat', 'benutzer']
};
// Identitäten des Rundgangs (F-044): ohne und mit allen vergebbaren Ausnahmen, dazu der Bauleiter (= Büro)
const IDENTITAETEN = [
  { name: 'mitarbeiter', rolle: 'mitarbeiter' }, { name: 'polier', rolle: 'polier' },
  { name: 'mitarbeiter+Ausnahmen', rolle: 'mitarbeiter', ausnahmen: true }, { name: 'polier+Ausnahmen', rolle: 'polier', ausnahmen: true },
  { name: 'bauleiter', rolle: 'bauleiter' }
];
const ZEIT_ANTWORT = 15000, ZEIT_WARTEN = 30000;
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
    '/mehr', '/zwei-faktor', '/push', '/hilfe', '/abwesenheiten', '/korrektur', '/pin', '/gibt-es-nicht',
    // Inhaber 13.11.2026: Abwesenheiten anderer (Testdaten: Krank 16./17.11., Urlaub im Dezember) dürfen nirgends erscheinen
    '/urlaub?monat=2026-11', '/urlaub?monat=2026-12', '/urlaub?ansicht=jahr', '/urlaub?ansicht=konten', '/kolonne?plan=1'];

  async function kontext(g) {
    const ctx = await browser.newContext({ viewport: { width: g.width, height: g.height }, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: g.mobil, serviceWorkers: 'allow' });
    await ctx.clock.install({ time: new Date(START) });
    return ctx;
  }
  async function anmelden(page, id) {
    await page.goto(s.basis + '/#/login', { waitUntil: 'domcontentloaded' });
    // Antwort vollständig lesen und kurz warten, damit der Mitschnitt sie vor dem Neuladen prüfen kann (F-044)
    const r = await page.evaluate(async (bid) => { const x = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ benutzerId: bid, pin: '1234' }) }); await x.text(); return x.status; }, id);
    if (r !== 200) throw new Error(`Anmeldung ${id}: ${r}`);
    await page.waitForTimeout(500);
    // wie nach der Anmeldung über die Oberfläche: Hinweis „angemeldet“ für den App-Start (app.js ladeIch)
    await page.evaluate(() => localStorage.setItem('bt_ich', '{}'));
    // vollständig neu laden (anderer Query-Teil erzwingt echten Seitenaufruf, nicht nur Hash-Wechsel)
    await page.goto(`${s.basis}/?nach-login=${Date.now()}#/stempeln`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const ok = await page.evaluate(() => !!document.querySelector('[data-nav]'));
    if (!ok) throw new Error(`Nach der Anmeldung von ${id} kein App-Rahmen sichtbar`);
  }
  function mitschneiden(page, rolle, wo, opt = {}) {
    const offen = new Set();
    page.on('response', (r) => {
      const url = r.url();
      if (!url.startsWith(s.basis)) return;
      const pfad = url.slice(s.basis.length);
      const p = (async () => {
        let buf;
        try { buf = await Promise.race([r.body(), new Promise((_, nok) => setTimeout(() => nok(new Error('Zeitüberschreitung')), ZEIT_ANTWORT))]); } catch (e) {
          // F-044: nie still verwerfen – eine ungeprüfte Antwort ist ein Befund (Weiterleitungen haben keinen Inhalt).
          // Downloads (Content-Disposition) liefert der Browser nicht an Playwright: GET-Antworten werden dann im selben
          // Kontext erneut abgerufen und geprüft; nur wenn auch das nicht geht, bleibt es ein Befund.
          if (r.status() >= 300 && r.status() < 400) return;
          if (r.request().method() === 'GET' && !page.isClosed()) {
            const neu = await page.evaluate(async (u) => { try { const x = await fetch(u); const b = new Uint8Array(await x.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192)); return { ok: true, b64: btoa(s) }; } catch (f) { return { ok: false, f: String(f) }; } }, url).catch((f) => ({ ok: false, f: String(f) }));
            if (neu.ok) { buf = Buffer.from(neu.b64, 'base64'); }
          }
          if (buf === undefined) {
          if (/Target page, context or browser has been closed/.test(e.message)) { notiere(`${wo}: Antwort ${r.request().method()} ${pfad} nicht mehr lesbar (Seite geschlossen) – ungeprüft`); return; }
          notiere(`${wo}: Antwort ${r.request().method()} ${pfad} nicht gelesen (${e.message}) – ungeprüft`); return;
          }
        }
        antworten++;
        const ct = r.headers()['content-type'] || '';
        let daten = buf;
        if (ct.includes('application/json')) { try { daten = JSON.parse(buf.toString('utf8')); } catch (_) { daten = buf.toString('utf8'); } }
        else if (!/pdf|spreadsheet|image/.test(ct)) daten = buf.toString('utf8');
        const v = await H.scanne(rolle, { status: r.status(), daten, headers: { get: (k) => r.headers()[k.toLowerCase()], forEach: (f) => Object.entries(r.headers()).forEach(([k, x]) => f(x, k)) } }, { route: `${r.request().method()} ${pfad.split("?")[0]}`, url: `${pfad} (${wo})`, nurKanarien: !pfad.startsWith('/api/'), mitAusnahmen: opt.mitAusnahmen, erlaubteKanarien: opt.mitAusnahmen ? ['Text schadenFremd'] : [] }); // statische Dateien: Programmtext, nur auf Daten (Kanarienvögel) prüfen
        v.forEach(notiere);
      })();
      offen.add(p);
      p.finally(() => offen.delete(p));
    });
    return async () => {
      const fertig = await Promise.race([Promise.all([...offen]).then(() => true), new Promise((ok) => setTimeout(() => ok(false), ZEIT_WARTEN))]);
      if (!fertig && offen.size) notiere(`${wo}: ${offen.size} Netzwerkantwort(en) nach ${ZEIT_WARTEN / 1000} s noch nicht geprüft – Rundgang unvollständig`);
    };
  }

  /* ---------- 1) Rundgang Mitarbeiter und Polier, Handy und PC ---------- */
  // Menü des Büros je Bildschirmgröße (Vergleich für den Bauleiter, F-044)
  const bueroNav = {};
  for (const g of GROESSEN) {
    const ctx = await kontext(g); const page = await ctx.newPage();
    await anmelden(page, U.buero);
    bueroNav[g.name] = await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-nav]')].map((e) => e.dataset.nav))].sort());
    await ctx.close();
  }
  let ausnahmenVergeben = false;
  // nur zur Fehlersuche: BAUTAG_RECHTE_UI_IDENT=<RegExp> beschränkt die Identitäten (z. B. „bauleiter“)
  const NUR_IDENT = process.env.BAUTAG_RECHTE_UI_IDENT ? new RegExp(process.env.BAUTAG_RECHTE_UI_IDENT) : null;
  for (const ident of process.env.BAUTAG_RECHTE_UI_NUR_GERAET ? [] : IDENTITAETEN.filter((x) => !NUR_IDENT || NUR_IDENT.test(x.name))) {
    const rolle = ident.rolle;
    const feld = rolle !== 'bauleiter';
    if (ident.ausnahmen && !ausnahmenVergeben) {
      // alle vergebbaren Rechte als Ausnahme für Mitarbeiter 2 und Polier 1 (über die offizielle API, wie die GF)
      const gf = await s.login(U.gf);
      const rechte = (await gf.get('/rechte')).daten;
      for (const [r2, id] of [['mitarbeiter', U.mitarbeiter], ['polier', U.polier]]) for (const recht of rechte.rechte.map((x) => x.schluessel).filter((x) => !rechte.gesperrt[r2].includes(x))) {
        const a = await gf.put('/rechte/ausnahme', { benutzerId: id, recht, wert: true });
        if (a.status !== 200) notiere(`Ausnahme ${recht} für ${r2} → ${a.status}`);
      }
      ausnahmenVergeben = true;
    }
    for (const g of GROESSEN) {
      const ctx = await kontext(g);
      await BE.vorbereiten(ctx);
      const page = await ctx.newPage();
      const wo0 = `${ident.name}/${g.name}`;
      const warten = mitschneiden(page, rolle, wo0, { mitAusnahmen: ident.ausnahmen });
      await anmelden(page, H.ID[rolle]);
      const gesperrteSeiten = new Set(), ziele = [];
      for (const r of ROUTEN) {
        if (process.env.BAUTAG_RECHTE_UI_LOG) console.log(`  ${wo0} #${r}`);
        // Adresse direkt eintippen: jede 4. Route als vollständiger Neuaufruf, sonst Hash-Wechsel (SPA)
        if (seiten % 4 === 0) await page.goto(`${s.basis}/?direkt=${seiten}#${r}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        else await page.evaluate((h) => { location.hash = h; }, r);
        await page.waitForTimeout(900);
        seiten++;
        // gesperrte Seite genau dieser Adresse (bei Objekt-Adressen gilt die Sperre nur für dieses Objekt)
        if (await page.evaluate(() => Boolean(document.querySelector('[data-zustand="kein-zugriff"]')))) gesperrteSeiten.add(r.split('?')[0]);
        for (const z of await BE.ausdrueckliche(page)) ziele.push({ seite: r, ...z });
        // F-042: Knöpfe/Kacheln/Zeilen im Trockenlauf (nur Handy-Breite, dort sind alle Funktionen über „Mehr“ erreichbar)
        if (g.name === 'handy') for (const k of await BE.trockenKlicks(page, s.basis, { max: 25 })) {
          if (k.hash) ziele.push({ seite: r, ziel: k.hash, name: `${k.name} (Klick)` });
          for (const u of [...k.geoeffnet, ...k.downloads]) { const st = await BE.urlStatus(page, u); if ([401, 403].includes(st)) notiere(`${wo0} #${r}: „${k.name}“ öffnet gesperrte Adresse ${u} (${st})`); }
          if (k.gesperrt.length) notiere(`${wo0} #${r}: „${k.name}“ löst gesperrte Anfrage aus (${k.gesperrt.join(', ')})`);
        }
        const text = await page.evaluate(() => document.body.innerText);
        if (!(await page.evaluate(() => !!document.querySelector('[data-nav]')))) notiere(`${wo0} #${r}: kein App-Rahmen (abgemeldet?) – Rundgang ungültig`);
        const m = feld && GELD_SICHTBAR.exec(text);
        if (m) notiere(`${wo0} #${r}: sichtbar „${text.slice(Math.max(0, m.index - 50), m.index + 30).replace(/\s+/g, ' ')}“`);
        for (const kan of H.verboteneKanarien(rolle)) for (const f of kan.formen) if (text.includes(f) && !(ident.ausnahmen && kan.name === 'Text schadenFremd')) notiere(`${wo0} #${r}: Kanarienvogel ${kan.name} sichtbar`);
        // Geld-Kanarien (jede Preis-Spalte der Test-DB) im sichtbaren Text, in jeder Schreibweise
        if (feld) for (const gk of H.W.findeGeld(text, H.ZUSTAND.geld).slice(0, 3)) notiere(`${wo0} #${r}: Geld-Kanarie ${gk.name} sichtbar als „${gk.form}“`);
        // Krankenstand anderer: der Polier selbst ist in den Testdaten nie krank – jedes „Krank“ betrifft andere
        // Legenden der Code-Kürzel (Bautagesbericht „K = Krank · U = Urlaub …“, Urlaubskalender „U Urlaub ZA Zeitausgleich K Krank …“) sind keine Personendaten
        const ohneLegende = text.replace(/K\s*=\s*Krank/g, '').replace(/ZA\s+Zeitausgleich\s+K\s+Krank\s+SW\s+Schlechtwetter/g, '');
        if (rolle === 'polier') { const k = /\bKrank(enstand)?\b/.exec(ohneLegende); if (k) notiere(`${wo0} #${r}: „${k[0]}“ sichtbar: „${ohneLegende.slice(Math.max(0, k.index - 60), k.index + 30).replace(/\s+/g, ' ')}“`); }
        // Inhaber 13.11.2026: Polier und Mitarbeiter sehen Abwesenheiten anderer gar nicht – auch nicht als „abwesend“/„abw.“,
        // nicht als Zähler („6 von 7 Personen abwesend“) und nicht als Zeile im Kalender (die Netzwerkantworten prüft H.scanne)
        const fremd = !feld ? [] : await page.evaluate((ich) => {
          const out = [];
          const sicht = (document.querySelector('#view') || document.body).innerText;
          const m = /\babwesend\b|\babw\.|Abwesenheiten meiner Partie|Meine Partie – Abwesenheiten/.exec(sicht);
          if (m) out.push(`„${sicht.slice(Math.max(0, m.index - 50), m.index + 30).replace(/\s+/g, ' ')}“`);
          if (document.querySelector('#ur-partie, #abw-andere, #ur-warnungen, [data-abwesend], .wp-frei.abwesend')) out.push('Abschnitt für Abwesenheiten anderer im DOM');
          const zeilen = [...document.querySelectorAll('#ur-kalender [data-person], #ur-konten [data-person]')].filter((x) => Number(x.dataset.person) !== ich).length;
          if (zeilen) out.push(`${zeilen} Kalender-/Kontozeilen anderer Personen`);
          const marken = document.querySelectorAll('.crew-row .code-badge, [data-partie-personen] .code-badge').length;
          if (marken) out.push(`${marken} Abwesenheits-Kürzel in Personenlisten`);
          return out;
        }, H.ID[rolle]);
        for (const f of fremd) notiere(`${wo0} #${r}: Abwesenheit anderer sichtbar – ${f}`);
        const nav = await page.evaluate(() => [...document.querySelectorAll('[data-nav]')].map((e) => e.dataset.nav));
        if (feld) for (const n of VERBOTENE_NAV[ident.ausnahmen ? 'ausnahmen' : rolle]) if (nav.includes(n)) notiere(`${wo0} #${r}: verbotener Menüpunkt „${n}“`);
        // Bauleiter = Büro: dasselbe Menü wie das Büro (keine GF-Vorbehalte, nichts weniger)
        if (!feld) { const ist = [...new Set(nav)].sort(); if (JSON.stringify(ist) !== JSON.stringify(bueroNav[g.name])) notiere(`${wo0} #${r}: Menü ${ist.join(',')} ≠ Büro-Menü ${bueroNav[g.name].join(',')}`); }
        // versteckte Inhalte zählen auch: gesamtes DOM (inkl. display:none) auf Kanarienvögel prüfen
        const html = await page.content();
        for (const kan of H.verboteneKanarien(rolle)) for (const f of kan.formen) if (html.includes(f) && !(ident.ausnahmen && kan.name === 'Text schadenFremd')) notiere(`${wo0} #${r}: Kanarienvogel ${kan.name} im DOM (versteckt)`);
        if (feld) for (const gk of H.W.findeGeld(html.replace(/<script[\s\S]*?<\/script>|data:[a-z/+]+;base64,[A-Za-z0-9+/=]+/g, ''), H.ZUSTAND.geld).slice(0, 3)) notiere(`${wo0} #${r}: Geld-Kanarie ${gk.name} im DOM als „${gk.form}“`);
      }
      // F-042: kein sichtbares Bedienelement zeigt auf eine für diese Identität gesperrte Seite
      for (const z of ziele) {
        const m2 = z.ziel.replace(/^#/, '').split('?')[0];
        if (gesperrteSeiten.has(m2)) notiere(`${wo0} #${z.seite}: Bedienelement „${z.name}“ führt zu gesperrter Seite ${z.ziel}`);
      }
      // Service Worker: nie /api im Cache
      if (process.env.BAUTAG_RECHTE_UI_LOG) console.log('  Cache-Prüfung');
      const cacheApi = await page.evaluate(async () => { const out = []; for (const n of await caches.keys()) { const c = await caches.open(n); for (const k of await c.keys()) if (new URL(k.url).pathname.startsWith('/api/')) out.push(k.url); } return out; });
      if (cacheApi.length) notiere(`${wo0}: Service-Worker-Cache enthält API-Antworten: ${cacheApi.join(', ')}`);
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
