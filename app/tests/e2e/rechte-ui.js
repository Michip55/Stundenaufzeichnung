'use strict';
/**
 * Prüfbericht 7 – Rechte in der Oberfläche (Playwright, eigenständig):
 *   node tests/e2e/rechte-ui.js            (im Ordner app; Exit-Code 1 bei Befunden; E2E_NUR=handy|pc, BAUTAG_RECHTE_UI_IDENT=<RegExp>)
 *
 * - Mitarbeiter und Polier, Handy- und PC-Breite: jede Route der SPA direkt per URL (auch versteckte),
 *   sichtbarer Text ohne € / Beträge, keine verbotenen Menüpunkte.
 * - ALLE Netzwerkantworten während des Rundgangs werden wie in rechte-matrix.test.js geprüft
 *   (Schlüssel, €-Beträge, Kanarienvögel): Die Oberfläche darf verbotene Daten nicht einmal EMPFANGEN.
 * - Geteiltes Gerät: Polier meldet sich ab, Mitarbeiter meldet sich an – in KEINEM Speicher des Geräts (G2-011:
 *   localStorage, sessionStorage, IndexedDB aller Datenbanken, Cache Storage samt Inhalt der Antworten, Cookies auch
 *   HttpOnly) darf etwas vom Polier im Klartext lesbar bleiben: sein Name in jeder Schreibweise, seine Kennung/Pnr.,
 *   Telefon, Sitzung, und nichts, was der Mitarbeiter selbst nicht sehen darf (H.scanne mit allen Kanarien); nach dem
 *   Abmelden bleibt nur die feste Positivliste. Die Offline-Warteschlange des Poliers darf nie mit der Sitzung des
 *   Mitarbeiters gesendet werden.
 * - Service Worker: /api wird nie zwischengespeichert.
 * - F-044: Identitäten auch MIT allen vergebbaren Ausnahmen (Mitarbeiter, Polier) und der Bauleiter (Menü = Büro-Menü,
 *   keine GF-Vorbehalte). Eine Antwort, die nicht (rechtzeitig) gelesen werden kann, ist ein Befund – nie still verworfen.
 * - 15.17 (H-T6): Bauleiter = Büro auch je Seite – zwei Zwillinge (rechte-zwilling.js: gleiche Person 900001, gleiche
 *   eigene Daten, nur Rolle und bauleiterId verschieden) besuchen dieselben Seiten; die sichtbaren Bedienelemente (Text,
 *   Ziel, data-*, gesperrt/schreibgeschützt) müssen gleich sein – nicht nur das Menü.
 * - 15.17 (H-T2): nach dem Abmelden gilt die Positivliste für JEDEN Speicher: IndexedDB nur versiegelte Schadensmeldungen
 *   (bautag-schaden/meldungen: {clientId, versiegelt:{iv, d}}), Cache Storage nur die App-Hülle (aktueller Cache des
 *   Service Workers, Dateien aus public/ mit unverändertem Inhalt); dazu eine Selbstprobe mit einem Test-Eintrag.
 * - F-042: jedes sichtbare Bedienelement mit Ziel (Links, data-href/-nav, Knöpfe mit Klick-Handler im Trockenlauf,
 *   Benachrichtigungen) darf nicht auf eine für die Identität gesperrte Seite oder Datei führen. G2-010: auch jedes
 *   Element außerhalb von #view (Kopfleiste, Seitenleiste, untere Leiste, Glocke-Panel), je Bildschirmgröße.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../api/rechte-matrix-hilfe');
const { U, BS, START } = require('../api/hilfe');
const BE = require('./bedienelemente');
const { Z, zwillingsBasis } = require('../api/rechte-zwilling');
// Oberfläche, die der Testserver ausliefert (BT_PUBLIC nur in Injektions-Kopien der Nachkontrolle)
const PUBLIC = process.env.BT_PUBLIC || path.join(__dirname, '..', '..', 'public');

const GROESSEN = [{ name: 'handy', width: 390, height: 844, mobil: true }, { name: 'pc', width: 1440, height: 900, mobil: false }]
  .filter((g) => !process.env.E2E_NUR || process.env.E2E_NUR.split(',').includes(g.name));
// Menüpunkte (data-nav), die eine Rolle nie sehen darf
const VERBOTENE_NAV = {
  mitarbeiter: ['dashboard', 'kolonne', 'berichte', 'baustellen', 'plan', 'partie', 'rechnungen', 'offeneposten', 'kalkulation', 'preise', 'monat', 'benutzer'],
  polier: ['dashboard', 'plan', 'rechnungen', 'offeneposten', 'kalkulation', 'preise', 'monat', 'benutzer'],
  // mit allen vergebbaren Ausnahmen bleiben Preise, Kalkulation, Lohn und Benutzerverwaltung gesperrt (rechte.js GESPERRT)
  ausnahmen: ['rechnungen', 'offeneposten', 'kalkulation', 'preise', 'monat', 'benutzer']
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

/* ---------- G2-011: Gerätespeicher ---------- */
// nach dem Abmelden erlaubt (gehört zum Gerät bzw. ist versiegelt, ui.js abmelden: GERAET/WARTEND); Testattrappen e2e_*
const SPEICHER_NACH_ABMELDEN = new Set(['bt_uebersicht_klassisch', 'bt_stunden_format', 'bt_install_weg', 'bt_installiert', 'bt_letzter', 'bt_letzte_pnr', 'bt_geraet_benutzer', 'bt_abmelden_offen', 'bt_geraet_art', 'bt_stempel_queue', 'bt_stempel_abgelehnt', 'bt_fuhren_warten', 'bt_fuhren_abgelehnt', 'bt_aktiv']);

/* ---------- 15.17 (H-T2): Positivliste für IndexedDB und Cache Storage nach dem Abmelden ---------- */
// IndexedDB: nur versiegelte Einträge der Schadens-Warteschlange (tresor.js) – ohne jede Angabe im Klartext
const IDB_NACH_ABMELDEN = {
  'bautag-schaden': { meldungen: (e) => Boolean(e) && typeof e === 'object' && Object.keys(e).sort().join(',') === 'clientId,versiegelt' && /^v-[\w-]+$/.test(e.clientId) && e.versiegelt && typeof e.versiegelt === 'object' && Object.keys(e.versiegelt).sort().join(',') === 'd,iv' && typeof e.versiegelt.iv === 'string' && typeof e.versiegelt.d === 'string' }
};
function idbBefunde(idb) {
  const v = [];
  for (const [db, stores] of Object.entries(idb || {})) {
    if (db === '__fehler') { v.push(`IndexedDB nicht lesbar (${stores}) – ungeprüft`); continue; }
    if (stores && stores.fehler) { v.push(`IndexedDB ${db} nicht lesbar – ungeprüft`); continue; }
    for (const [st, x] of Object.entries(stores || {})) {
      const regel = IDB_NACH_ABMELDEN[db] && IDB_NACH_ABMELDEN[db][st];
      (x.werte || []).forEach((w, i) => { if (!regel || !regel(w)) v.push(`IndexedDB ${db}/${st}[${(x.schluessel || [])[i]}] außerhalb der Positivliste: ${JSON.stringify(w).slice(0, 160)}`); });
    }
  }
  return v;
}
// Cache Storage: nur der aktuelle Cache des Service Workers mit Dateien der App-Hülle in unverändertem Inhalt
const SW_CACHE = (/const VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8')) || [])[1];
function cacheBefunde(cache) {
  const v = [];
  for (const [k, inhalt] of Object.entries(cache || {})) {
    if (k === '__fehler') { v.push(`Cache Storage nicht lesbar (${inhalt}) – ungeprüft`); continue; }
    const name = k.split(' ')[0], url = k.split(' ').slice(1).join(' ');
    let pfad;
    try { pfad = decodeURIComponent(new URL(url).pathname); } catch (_) { v.push(`Cache ${k}: keine gültige Adresse`); continue; }
    if (name !== SW_CACHE) { v.push(`Cache Storage „${name}“ (nicht der Cache der App-Hülle ${SW_CACHE}): ${url}`); continue; }
    const datei = path.join(PUBLIC, pfad === '/' ? 'index.html' : pfad);
    if (!datei.startsWith(PUBLIC) || !fs.existsSync(datei) || !fs.statSync(datei).isFile()) { v.push(`Cache ${url}: keine Datei der App-Hülle`); continue; }
    if (/\.(html|js|css|webmanifest|svg|json)$/.test(datei) && inhalt !== fs.readFileSync(datei, 'utf8').slice(0, inhalt.length)) v.push(`Cache ${url}: Inhalt weicht von der App-Hülle ab`);
  }
  return v;
}

/** Alle Speicher des Geräts: localStorage, sessionStorage, IndexedDB (alle DBs, alle Stores, Schlüssel + Werte), Cache Storage (Inhalt), Cookies (auch HttpOnly) */
async function geraeteSpeicher(page, ctx) {
  const roh = await page.evaluate(async () => {
    const ls = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = localStorage.getItem(k); }
    const ss = {}; for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); ss[k] = sessionStorage.getItem(k); }
    const idb = {};
    try {
      for (const d of (indexedDB.databases ? await indexedDB.databases() : [])) {
        idb[d.name] = await new Promise((ok) => {
          const r = indexedDB.open(d.name);
          r.onsuccess = () => {
            const db = r.result; const out = {}; const st = [...db.objectStoreNames];
            if (!st.length) { db.close(); return ok(out); }
            const t = db.transaction(st, 'readonly'); let n = st.length;
            for (const x of st) { const g = t.objectStore(x).getAll(); const gk = t.objectStore(x).getAllKeys(); g.onsuccess = () => { gk.onsuccess = () => { out[x] = { schluessel: gk.result.map(String), werte: g.result }; if (!--n) { db.close(); ok(out); } }; }; }
          };
          r.onerror = () => ok({ fehler: 'nicht lesbar' });
        });
      }
    } catch (e) { idb.__fehler = String(e); }
    const cache = {};
    try {
      for (const n of await caches.keys()) {
        const c = await caches.open(n);
        for (const q of await c.keys()) { const a = await c.match(q); let t = ''; try { const b = new Uint8Array(await a.clone().arrayBuffer()); t = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, 300000)); } catch (_) { t = '[unlesbar]'; } cache[`${n} ${q.url}`] = t; }
      }
    } catch (e) { cache.__fehler = String(e); }
    let swCaches = [];
    try { swCaches = navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope) : []; } catch (_) { /* egal */ }
    return { ls, ss, idb, cache, swCaches, cookie: document.cookie };
  });
  roh.cookies = (await ctx.cookies()).map((c) => ({ name: c.name, value: c.value, httpOnly: c.httpOnly }));
  return roh;
}

/** Werte des Poliers (Vorbenutzer) im Klartext: Name in jeder Schreibweise, Kennung, Pnr., Telefon, Sitzungs-Cookie */
function speicherBefunde(sp, polierSitzung, { nurGeheim = false } = {}) {
  const v = [];
  for (const c of sp.cookies || []) if (polierSitzung.includes(c.value)) v.push(`Sitzungs-Cookie des Poliers (${c.name}) bleibt im Browser`);
  const alles = JSON.stringify({ ls: sp.ls, ss: sp.ss, idb: sp.idb, cache: sp.cache, cookie: sp.cookie });
  for (const g of (H.ZUSTAND.geheim || []).filter((x) => x.id === U.polier)) if (alles.includes(g.wert)) v.push(`${g.art} des Poliers im Gerätespeicher`);
  // nach der Anmeldung des Mitarbeiters gehören neue Einträge ihm (sein Plan nennt z. B. seinen Polier) – dann nur Geheimnisse
  if (nurGeheim) return v;
  const text = H.W.vergleich(JSON.stringify({ ls: sp.ls, ss: sp.ss, idb: sp.idb, cache: sp.cache, cookie: sp.cookie }));
  const formen = H.W.namensVarianten('Josef Haidbauer', 1001).map((x) => x.form);
  for (const f of formen) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu');
    const m = re.exec(text);
    if (m) { v.push(`Name des Poliers („${m[0]}“) im Gerätespeicher: …${text.slice(Math.max(0, m.index - 60), m.index + 60)}…`); break; }
  }
  // Kennung/Pnr. nur in Daten (nicht im Programmtext der App-Hülle im Cache Storage)
  const daten = H.W.vergleich(JSON.stringify({ ls: sp.ls, ss: sp.ss, idb: sp.idb, cookie: sp.cookie, cache: Object.fromEntries(Object.entries(sp.cache || {}).filter(([k]) => /\/api\//.test(k))) }));
  const kennung = /"(uid|benutzerId|erstelltVon|ersteller|personId)"\s*:\s*1\b|"benutzer"\s*:\s*\{\s*"id"\s*:\s*1\b|\\"(uid|benutzerId)\\"\s*:\s*1\b|\b1001\b/.exec(daten);
  if (kennung) v.push(`Kennung/Pnr. des Poliers im Gerätespeicher: …${daten.slice(Math.max(0, kennung.index - 60), kennung.index + 60)}…`);
  if (text.includes(H.TEXT.telefonPolier) || text.includes(H.TEXT.telefonPolier.replace(/\s/g, ''))) v.push('Telefon des Poliers im Gerätespeicher');
  return v;
}

/** Alles im Speicher wie eine Antwort an den Mitarbeiter prüfen (Kanarien, €, fremde Abwesenheiten, Bild-Kanarien) */
async function speicherScan(sp) {
  const parse = (w) => { if (typeof w !== 'string') return w; try { return JSON.parse(w); } catch (_) { return w; } };
  const obj = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, w]) => [k, parse(w)]));
  // Cache Storage: Programmdateien der App-Hülle (Service Worker) sind Programmtext – wie statische Dateien im Rundgang nur
  // auf Daten (Kanarien, Bild-Kanarien) prüfen; alles andere (z. B. /api/…) vollständig
  const statisch = (k) => { try { return !new URL(k.split(' ').slice(1).join(' ')).pathname.startsWith('/api/'); } catch (_) { return false; } };
  const cache = Object.entries(sp.cache || {});
  const daten = { localStorage: obj(sp.ls), sessionStorage: obj(sp.ss), indexedDB: sp.idb, cacheStorage: obj(Object.fromEntries(cache.filter(([k]) => !statisch(k)))), cookies: (sp.cookies || []).map((c) => `${c.name}=${c.value}`) };
  const v = await H.scanne('mitarbeiter', { status: 200, daten, headers: new Map() }, { route: 'GERAETESPEICHER', url: 'Gerätespeicher', ich: U.mitarbeiter });
  for (const [k, t] of cache.filter(([x]) => statisch(x))) v.push(...await H.scanne('mitarbeiter', { status: 200, daten: t, headers: new Map() }, { route: 'GERAETESPEICHER', url: `Cache ${k}`, ich: U.mitarbeiter, nurKanarien: true }));
  return v.map((x) => x.replace(/^mitarbeiter Gerätespeicher → 200: /, ''));
}

async function main() {
  const basis = await H.erstelleBasis();
  const F = basis.F;
  const s = await H.starteKopie(basis);
  const browser = await chromium.launch();
  const befunde = [];
  const notiere = (x) => { befunde.push(x); console.log('  ✗ ' + x); };
  let antworten = 0, seiten = 0;

  const ROUTEN = ['/stempeln', '/kolonne', '/woche', '/berichte', `/bericht/${F.bericht.bs1}`, `/bericht/${F.bericht.bs3}`, `/bericht/${F.bericht.bs1Alt}`, '/dashboard', '/baustellen', '/baustellen/archiv',
    `/baustelle/${BS.pitten}`, `/baustelle/${BS.reisinger}`, '/plan', '/einsatz', '/partie', '/offene-posten', '/rechnungen', '/faelligkeiten', '/preise', '/preise?tab=katalog', '/urlaub', '/lohn-vorlagen', '/kalkulation',
    `/kalkulation/${BS.pitten}`, `/kalkulation/${BS.pitten}/positionen`, `/kalkulation/${BS.reisinger}`, '/monat', '/benutzer', '/fuhrpark', '/fuhrpark/anlage/4', '/fuhrpark/anlage/30',
    '/mehr', '/zwei-faktor', '/push', '/hilfe', '/abwesenheiten', '/korrektur', '/pin', '/gibt-es-nicht',
    // Inhaber 13.11.2026: Abwesenheiten anderer (Testdaten: Krank 16./17.11., Urlaub im Dezember) dürfen nirgends erscheinen
    '/urlaub?monat=2026-11', '/urlaub?monat=2026-12', '/urlaub?ansicht=jahr', '/urlaub?ansicht=konten', '/kolonne?plan=1'];

  async function kontext(g) {
    const ctx = await browser.newContext({ viewport: { width: g.width, height: g.height }, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: g.mobil, serviceWorkers: 'allow' });
    await ctx.clock.install({ time: new Date(START) });
    return ctx;
  }
  async function anmelden(page, id, basisUrl = s.basis) {
    await page.goto(basisUrl + '/#/login', { waitUntil: 'domcontentloaded' });
    // Antwort vollständig lesen und kurz warten, damit der Mitschnitt sie vor dem Neuladen prüfen kann (F-044)
    const r = await page.evaluate(async (bid) => { const x = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ benutzerId: bid, pin: '1234' }) }); await x.text(); return x.status; }, id);
    if (r !== 200) throw new Error(`Anmeldung ${id}: ${r}`);
    await page.waitForTimeout(500);
    // wie nach der Anmeldung über die Oberfläche: Hinweis „angemeldet“ für den App-Start (app.js ladeIch)
    await page.evaluate(() => localStorage.setItem('bt_ich', '{}'));
    // vollständig neu laden (anderer Query-Teil erzwingt echten Seitenaufruf, nicht nur Hash-Wechsel)
    await page.goto(`${basisUrl}/?nach-login=${Date.now()}#/stempeln`, { waitUntil: 'domcontentloaded' });
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
      // G2-010: Rahmen außerhalb von #view (Kopfleiste, Seitenleiste, untere Leiste, Glocke-Panel) – jedes Element
      for (const k of await BE.rahmenKlicks(page, s.basis)) {
        if (k.hash) ziele.push({ seite: '(Rahmen)', ziel: k.hash, name: `${k.name} (Klick im Rahmen)` });
        for (const u of [...k.geoeffnet, ...k.downloads]) { const st = await BE.urlStatus(page, u); if ([401, 403].includes(st)) notiere(`${wo0} (Rahmen): „${k.name}“ öffnet gesperrte Adresse ${u} (${st})`); }
        if (k.gesperrt.length) notiere(`${wo0} (Rahmen): „${k.name}“ löst gesperrte Anfrage aus (${k.gesperrt.join(', ')})`);
      }
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

  /* ---------- 1b) 15.17 (H-T6): Bauleiter = Büro – dieselben Bedienelemente auf jeder Seite (Zwillinge) ---------- */
  if (!process.env.BAUTAG_RECHTE_UI_NUR_GERAET && (!NUR_IDENT || NUR_IDENT.test('bauleiter'))) {
    const zb = { buero: await zwillingsBasis(basis, 'buero'), bauleiter: await zwillingsBasis(basis, 'bauleiter') };
    const srv = { buero: await H.starteKopie(zb.buero), bauleiter: await H.starteKopie(zb.bauleiter) };
    // sichtbare Bedienelemente der ganzen Seite (Rahmen, Inhalt, offene Dialoge): Art, id, Text, Ziel, data-*, Zustand
    const finger = (page) => page.evaluate(() => {
      const sel = 'button, [role="button"], [role="link"], [role="menuitem"], [role="tab"], a[href], [data-href], [data-link], [data-ziel], [data-nav], [data-auf], [onclick], summary, input:not([type="hidden"]), select, textarea, [contenteditable="true"]';
      const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, '<ZEIT>').replace(/http:\/\/127\.0\.0\.1:\d+/g, '<HOST>').replace(/\ba[0-9a-f]{12}\b/g, '<ANTRAG>').replace(/\b(Büro|Bauleiter|buero|bauleiter)\b/g, '<ROLLE>').slice(0, 80);
      const out = [];
      for (const e of document.querySelectorAll(sel)) {
        if (!(e.offsetParent !== null || e.getClientRects().length)) continue;
        const data = [...e.attributes].filter((x) => /^data-/.test(x.name) && !/^data-bt-/.test(x.name)).map((x) => `${x.name}=${norm(x.value)}`).sort().join(' ');
        out.push([e.tagName.toLowerCase(), e.id ? `#${e.id}` : '', e.getAttribute('type') || '', norm(e.innerText || e.value || e.getAttribute('aria-label') || e.getAttribute('title') || ''), e.disabled ? 'gesperrt' : '', e.readOnly ? 'schreibgeschützt' : '', norm(e.getAttribute('href') || ''), data].join('|'));
      }
      return out.sort();
    });
    const stabil = async (page) => { let a = await finger(page); for (let i = 0; i < 12; i++) { await page.waitForTimeout(350); const b = await finger(page); if (JSON.stringify(a) === JSON.stringify(b)) return b; a = b; } return a; };
    let verglichen = 0;
    try {
      for (const g of GROESSEN) {
        const seite = {};
        for (const r of ['buero', 'bauleiter']) {
          seite[r] = { ctx: await kontext(g) };
          seite[r].page = await seite[r].ctx.newPage();
          await anmelden(seite[r].page, Z, srv[r].basis);
        }
        for (const route of ROUTEN) {
          for (const r of ['buero', 'bauleiter']) await seite[r].page.goto(`${srv[r].basis}/?zwilling=${verglichen}#${route}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
          let f = {};
          for (let versuch = 0; versuch < 3; versuch++) {
            if (versuch) await seite.buero.page.waitForTimeout(1200);
            for (const r of ['buero', 'bauleiter']) f[r] = await stabil(seite[r].page);
            if (JSON.stringify(f.buero) === JSON.stringify(f.bauleiter)) break;
          }
          verglichen++;
          const fehlt = f.buero.filter((x) => !f.bauleiter.includes(x)), mehr = f.bauleiter.filter((x) => !f.buero.includes(x));
          if (fehlt.length || mehr.length) notiere(`Bauleiter = Büro/${g.name} #${route}: Bedienelemente verschieden – nur Büro: ${fehlt.slice(0, 6).join(' ; ') || '–'} | nur Bauleiter: ${mehr.slice(0, 6).join(' ; ') || '–'}`);
          if (!f.buero.length) notiere(`Bauleiter = Büro/${g.name} #${route}: keine Bedienelemente gefunden – Vergleich wirkungslos`);
        }
        for (const r of ['buero', 'bauleiter']) await seite[r].ctx.close();
      }
    } finally {
      for (const r of ['buero', 'bauleiter']) { await srv[r].stop(); fs.rmSync(zb[r].ordner, { recursive: true, force: true }); }
    }
    console.log(`  Bauleiter = Büro: ${verglichen} Seiten mit Zwillingen verglichen`);
  }

  /* ---------- 2) Geteiltes Gerät: Polier → Abmelden → Mitarbeiter ---------- */
  const log = (x) => { if (process.env.BAUTAG_RECHTE_UI_LOG) console.log('  [Gerät] ' + x); };
  {
    const ctx = await kontext(GROESSEN[0]);
    const page = await ctx.newPage();
    // 15.21: Standard ist „Eigenes Handy“ – dieses Gerät wird auf der Anmeldeseite bewusst als „Geteiltes Gerät“ gewählt
    await page.goto(s.basis + '/#/login', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#geraet-wahl', { timeout: 15000 });
    await page.click('#geraet-wahl label:has(input[value="geteilt"])');
    if (await page.evaluate(() => localStorage.getItem('bt_geraet_art')) !== 'geteilt') notiere('geteiltes Gerät: Wahl „Geteiltes Gerät“ auf der Anmeldeseite nicht gespeichert');
    await anmelden(page, U.polier);
    log('Polier angemeldet');
    const polierSitzung = (await ctx.cookies()).filter((c) => /session|sitzung|bindung/i.test(c.name)).map((c) => c.value).filter((x) => x && x.length >= 16);
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
    const speicher = await geraeteSpeicher(page, ctx);
    log('Speicher gelesen: ' + Object.keys(speicher.ls).join(','));
    // G2-011: jeder Speicher des Geräts – Werte des Poliers (Name jeder Schreibweise, Kennung, Telefon, Sitzung) und alles,
    // was der Mitarbeiter (nächste Person) nicht sehen darf; nach dem Abmelden nur die Positivliste
    for (const b of speicherBefunde(speicher, polierSitzung)) notiere(`geteiltes Gerät: nach Abmelden des Poliers – ${b}`);
    for (const b of await speicherScan(speicher)) notiere(`geteiltes Gerät: nach Abmelden des Poliers – ${b}`);
    for (const [k, w] of Object.entries(speicher.ls)) if (!SPEICHER_NACH_ABMELDEN.has(k) && w && w !== '[]' && w !== '{}' && w !== 'null') notiere(`geteiltes Gerät: nach Abmelden bleibt localStorage[${k}] (nicht in der Positivliste): ${String(w).slice(0, 120)}`);
    for (const [k, w] of Object.entries(speicher.ss)) if (w) notiere(`geteiltes Gerät: nach Abmelden bleibt sessionStorage[${k}]: ${String(w).slice(0, 120)}`);
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
    // 15.17 (H-T2): Positivliste auch für IndexedDB und Cache Storage – jeder Eintrag außerhalb ist ein Befund, gleich ob er
    // Name oder Kennung des Poliers trägt (z. B. sein letzter Stempelstand ohne Namen)
    for (const b of [...idbBefunde(speicher.idb), ...cacheBefunde(speicher.cache)]) notiere(`geteiltes Gerät: nach Abmelden des Poliers – ${b}`);
    {
      // Selbstprobe: ein Test-Eintrag in einer neuen IndexedDB und im Cache Storage muss gemeldet werden
      await page.evaluate(async () => {
        await new Promise((ok, nok) => { const r = indexedDB.open('bt-selbstprobe', 1); r.onupgradeneeded = () => r.result.createObjectStore('s'); r.onerror = () => nok(r.error); r.onsuccess = () => { const t = r.result.transaction('s', 'readwrite'); t.objectStore('s').put({ x: 'Wert' }, 'probe'); t.oncomplete = () => { r.result.close(); ok(); }; }; });
        const c = await caches.open('bt-selbstprobe'); await c.put('/daten/selbstprobe', new Response('{"x":"Wert"}'));
      });
      const probe = await geraeteSpeicher(page, ctx);
      if (!idbBefunde(probe.idb).some((b) => /bt-selbstprobe/.test(b))) notiere('Selbstprobe: Test-Eintrag in einer neuen IndexedDB nach dem Abmelden nicht erkannt – Prüfung wirkungslos');
      if (!cacheBefunde(probe.cache).some((b) => /bt-selbstprobe/.test(b))) notiere('Selbstprobe: Test-Eintrag im Cache Storage nach dem Abmelden nicht erkannt – Prüfung wirkungslos');
      await page.evaluate(async () => { await new Promise((ok) => { const r = indexedDB.deleteDatabase('bt-selbstprobe'); r.onsuccess = r.onerror = r.onblocked = () => ok(); }); await caches.delete('bt-selbstprobe'); });
    }
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
    // G2-011: auch NACH der Anmeldung des Mitarbeiters – alle Speicher, Werte des Poliers und Kanarien
    const nachMa = await geraeteSpeicher(page, ctx);
    for (const b of speicherBefunde(nachMa, polierSitzung, { nurGeheim: true })) notiere(`geteiltes Gerät: nach Anmeldung des Mitarbeiters – ${b}`);
    for (const b of await speicherScan(nachMa)) notiere(`geteiltes Gerät: nach Anmeldung des Mitarbeiters – ${b}`);
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
