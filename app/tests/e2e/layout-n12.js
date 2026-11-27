'use strict';
/**
 * Layout-Verbesserungen (API.md 15.39, Inhaber 26.11.2026): die 23 freigegebenen Punkte über echte Seiten,
 * berechnete Stile und DOM-Maße.
 *   node tests/e2e/layout-n12.js        (im Ordner app; E2E_NUR=handy|tablet|pc; Exit-Code 1 bei Befunden)
 * Wird auch von run.js je Bildschirmgröße aufgerufen (abschaltbar mit E2E_OHNE_LAYOUT12=1).
 *
 * Jede Prüfung trägt die Nummer ihres Punkts („Nr. 7: …“), damit die Gegenprobe gegen den alten Stand je Punkt zählbar ist.
 *   Nr. 1  eigene Symbole für Einsatz, Kolonne, Urlaub          Nr. 17 Stammdaten: Name in einer Linie mit den Preisen (Tablet, PC)
 *   Nr. 2  gesperrte Knöpfe grau, nicht halbdurchsichtig        Nr. 18 Monatsauswertung: Summe bleibt sichtbar (Tablet, PC)
 *   Nr. 3  PIN-Seite: Fehler als Schildchen, Ziffern unten      Nr. 19 Urlaubskalender ohne Wischen (Tablet, PC)
 *   Nr. 4  Fehlermeldungen im hellroten Kasten                  Nr. 21 Bericht: Personal über die volle Breite (Tablet, PC)
 *   Nr. 5  Kolonne: Name ganz, Status darunter (Handy)          Nr. 25 Tablet-Seitenleiste: alle Punkte sichtbar (Tablet)
 *   Nr. 6  „Meine Anträge“ mit Abstand zum Kartenrand           Nr. 26 Planer: Mo–Fr ganz sichtbar (Tablet)
 *   Nr. 7  Nebenschrift --faint mind. 4,5:1                     Nr. 30 Feldnamen 13,5 px, normale Schreibung
 *   Nr. 8  „Heute“ in „Meine Woche“                             Nr. 32 Ankreuz-Listen: Kästchen 22 px, Zeilen ≥ 44 px
 *   Nr. 9  Statusschilder größer (Handy, Tablet)                Nr. 35 Genehmigen/Freigeben grün
 *   Nr. 10 „Kommen“ kräftiger grün                              Nr. 36 Abwesenheits-Kürzel überall gleiche Farbe
 *   Nr. 11 Ränder von Feldern/Kästchen, deckender Fokus         Nr. 41 Budget-Warnung mit Wort
 *                                                               Nr. 42 color-scheme „only light“ (index.html, offline.html)
 * Dazu je Gerät: kein waagrechter Überlauf auf allen besuchten Seiten, Tippflächen am Handy ≥ 44 px, Polier/Mitarbeiter sehen
 * auf den besuchten Seiten kein € und keine Abwesenheiten anderer (dieselbe DOM-Prüfung wie rechte-ui.js). Standorte anderer
 * (Koordinaten-Kanarien) und die Netzwerkantworten prüfen rechte-ui.js und standort.js.
 */
const { chromium } = require('playwright');
const { starte, U, BS, START } = require('../api/hilfe');

const GROESSEN = [
  { name: 'handy', width: 390, height: 844, mobil: true },
  { name: 'tablet', width: 1180, height: 820, mobil: false },
  { name: 'pc', width: 1440, height: 900, mobil: false },
];
const PIN = '1234';
const NAME = { mitarbeiter: 'Lukas Brandstätter', polier: 'Josef Haidbauer' };
// Farben der Kürzel, Nr. 36 (Werte des Prototyps): SW, ZA, BU genau wie im Urlaubskalender (.ur-*.offen), F sand (im Kalender
// gibt es kein F); U und K bleiben bei ihren bisherigen Werten – gleiche Farbfamilie wie im Kalender (blau, rot), nicht derselbe Wert
const KUERZEL = { U: 'rgb(223, 234, 252)', K: 'rgb(253, 226, 224)', SW: 'rgb(230, 232, 235)', ZA: 'rgb(233, 224, 248)', BU: 'rgb(213, 239, 236)', F: 'rgb(243, 236, 220)' };
const GRUEN_OK = 'rgb(18, 117, 56)'; // var(--green), Nr. 35
const hellrot = (t) => { const c = rgb(t); return !!c && c.a > 0.5 && c.r >= 240 && c.r - c.g >= 12 && c.r - c.b >= 12; }; // var(--red-bg), Nr. 3/4
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Kontrast nach WCAG aus „rgb(a)(…)“-Texten (im Node-Prozess gerechnet)
function rgb(t) { const m = String(t).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
function hex(t) { const m = String(t).trim().match(/^#([0-9a-f]{6})$/i); if (!m) return rgb(t); const n = parseInt(m[1], 16); return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 }; }
function lum(c) { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); }
function kontrast(a, b) { const x = typeof a === 'string' ? hex(a) : a, y = typeof b === 'string' ? hex(b) : b; if (!x || !y) return 0; const l1 = lum(x), l2 = lum(y); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }

async function laufe(browser, g) {
  const fehler = [];
  let schritte = 0;
  const pruef = (ok, text) => { schritte++; if (!ok) { fehler.push(text); console.log('    ✗ ' + text); } };
  const handy = g.width <= 719, tablet = g.width >= 720 && g.width <= 1279;
  const s = await starte({ test: true, sitzung: { feldMin: 60 * 24 * 60, bueroMin: 60 * 24 * 60, maxH: 24 * 60 } });
  const offen = [];
  try {
    async function kontext() {
      const ctx = await browser.newContext({ viewport: { width: g.width, height: g.height }, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: g.mobil, serviceWorkers: 'block' });
      offen.push(ctx);
      await ctx.clock.install({ time: new Date(START) });
      const page = await ctx.newPage();
      page.setDefaultTimeout(10000);
      const konsole = [];
      page.on('console', (m) => { if (m.type() === 'error' && !/status of (401|409|429)/.test(m.text())) konsole.push(m.text().slice(0, 160)); });
      page.on('pageerror', (e) => konsole.push(String(e.message).slice(0, 160)));
      return { ctx, page, konsole };
    }
    // Sitzung über die Anmelde-Schnittstelle (wie kolonne.js), dann die App normal öffnen
    async function sitzung(benutzerId, wer, f) {
      const { ctx, page, konsole } = await kontext();
      try {
        await page.goto(s.basis + '/#/login', { waitUntil: 'domcontentloaded' });
        const st = await page.evaluate(async (bid) => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ benutzerId: bid, pin: '1234' }) })).status, benutzerId);
        if (st !== 200) throw new Error(`Anmeldung ${benutzerId}: ${st}`);
        await page.evaluate(() => localStorage.setItem('bt_ich', '{}'));
        await page.goto(`${s.basis}/?start=${benutzerId}#/`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#nav-seite .nav-item, #view', { state: 'attached' });
        const ohneGeld = ['polier', 'mitarbeiter'].includes(wer);
        const bereit = async () => {
          await page.waitForFunction(() => !document.querySelector('#view .view-box > .state .spinner, #root > .state .spinner'), null, { timeout: 12000 }).catch(() => {});
          await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
          await sleep(200);
        };
        const ueberlauf = async (wo) => {
          const r = await page.evaluate(() => { const v = document.getElementById('view'); const d = document.documentElement; return { doc: d.scrollWidth - window.innerWidth, view: v ? v.scrollWidth - v.clientWidth : 0, body: document.body.scrollWidth - window.innerWidth }; });
          pruef(r.doc <= 1 && r.view <= 1 && r.body <= 1, `${wer}/${g.name} ${wo}: waagrechter Überlauf (doc ${r.doc}, view ${r.view}, body ${r.body})`);
        };
        const keinEuro = async (wo) => { if (!ohneGeld) return; const t = await page.evaluate(() => document.body.innerText); pruef(!t.includes('€') && !/\bEUR\b/.test(t), `${wer}/${g.name} ${wo}: €-Betrag sichtbar für eine Rolle ohne Preisrecht`); };
        // Feste Regel: Polier/Mitarbeiter sehen keine Abwesenheiten anderer – dieselbe DOM-Prüfung wie rechte-ui.js (Inhaber 13.11.2026)
        const keineFremdAbw = async (wo) => {
          if (!ohneGeld) return;
          const f = await page.evaluate((ich) => {
            const out = []; const sicht = (document.querySelector('#view') || document.body).innerText;
            const m = /\babwesend\b|\babw\.|Abwesenheiten meiner Partie|Meine Partie – Abwesenheiten/.exec(sicht);
            if (m) out.push(`„${sicht.slice(Math.max(0, m.index - 40), m.index + 30).replace(/\s+/g, ' ')}“`);
            if (document.querySelector('#ur-partie, #abw-andere, #ur-warnungen, [data-abwesend], .wp-frei.abwesend')) out.push('Abschnitt für Abwesenheiten anderer im DOM');
            const zeilen = [...document.querySelectorAll('#ur-kalender [data-person], #ur-konten [data-person]')].filter((x) => Number(x.dataset.person) !== ich).length;
            if (zeilen) out.push(`${zeilen} Kalenderzeilen anderer`);
            if (document.querySelectorAll('.crew-row .code-badge, [data-partie-personen] .code-badge').length) out.push('Abwesenheits-Kürzel in Personenlisten');
            return out;
          }, benutzerId);
          pruef(!f.length, `${wer}/${g.name} ${wo}: Abwesenheit anderer sichtbar – ${f.join(' | ')}`);
        };
        const geh = async (h) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForFunction((x) => location.hash === x, h).catch(() => {}); await bereit(); await ueberlauf(h); await keinEuro(h); await keineFremdAbw(h); };
        await f({ page, geh, bereit, ueberlauf, keinEuro });
      } finally {
        pruef(konsole.length === 0, `${wer}/${g.name}: Konsolenfehler: ${konsole.slice(0, 3).join(' | ')}`);
        await ctx.close().catch(() => {});
      }
    }
    // Tippflächen am Handy (feste Regel: mind. 44 px hoch und breit)
    const tippflaechen = async (page, sel, wo) => {
      if (!handy) return;
      const m = await page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').map((e) => { const b = e.getBoundingClientRect(); return { t: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 30), h: Math.round(b.height * 10) / 10, w: Math.round(b.width * 10) / 10 }; }), sel);
      pruef(m.length > 0, `Tippflächen ${wo}/${g.name}: „${sel}“ nicht gefunden`);
      const klein = m.filter((x) => x.h < 43.5 || x.w < 43.5);
      pruef(!klein.length, `Tippflächen ${wo}/${g.name}: unter 44 px: ${klein.slice(0, 4).map((x) => `${x.t} ${x.w}×${x.h}`).join(' | ')}`);
    };
    const stil = (page, sel, props) => page.evaluate(([sel, props]) => { const e = document.querySelector(sel); if (!e) return null; const c = getComputedStyle(e); const o = {}; for (const p of props) o[p] = c.getPropertyValue(p); return o; }, [sel, props]);
    const svgVon = (page, id) => page.evaluate((id) => { const a = [...document.querySelectorAll(`[data-nav="${id}"] svg, a[href="#/${id}"] svg`)][0]; return a ? a.innerHTML.replace(/\s+/g, ' ').trim() : null; }, id);
    const ROOT = (page) => page.evaluate(() => { const c = getComputedStyle(document.documentElement); return { faint: c.getPropertyValue('--faint').trim(), muted: c.getPropertyValue('--muted').trim(), bg: getComputedStyle(document.body).backgroundColor, scheme: c.colorScheme }; });

    /* ================= 1) Anmeldung mit falscher PIN (Nr. 3), Nr. 42 ================= */
    {
      const { ctx, page } = await kontext();
      await page.goto(s.basis + '/#/login');
      await page.waitForSelector('.login-user');
      await page.fill('#login-suche', NAME.mitarbeiter.split(' ')[1]);
      await page.click(`.login-user:has-text("${NAME.mitarbeiter}")`);
      await page.waitForSelector('.pin-pad');
      await sleep(250);
      // Nr. 42: kein automatisches Abdunkeln – Meta-Tag in index.html und offline.html, color-scheme an :root
      const meta = await page.evaluate(async () => { const t = async (u) => (await fetch(u, { cache: 'no-store' })).text(); return { index: await t('/index.html'), offline: await t('/offline.html'), dom: (document.querySelector('meta[name="color-scheme"]') || {}).content || '', scheme: getComputedStyle(document.documentElement).colorScheme }; });
      const metaRe = /<meta\s+name="color-scheme"\s+content="only light">/;
      pruef(metaRe.test(meta.index), `Nr. 42/${g.name}: index.html ohne <meta name="color-scheme" content="only light">`);
      pruef(metaRe.test(meta.offline), `Nr. 42/${g.name}: offline.html ohne <meta name="color-scheme" content="only light">`);
      pruef(meta.dom === 'only light', `Nr. 42/${g.name}: geladene Seite hat color-scheme-Meta „${meta.dom}“`);
      pruef(/only/.test(meta.scheme) && /light/.test(meta.scheme) && !/dark/.test(meta.scheme), `Nr. 42/${g.name}: :root color-scheme „${meta.scheme}“ statt „only light“`);
      // Nr. 11: Rand der PIN-Kreise
      const kreis = await stil(page, '.pin-dots i', ['border-top-color', 'width']);
      pruef(kreis && kontrast(kreis['border-top-color'], '#ffffff') >= 3, `Nr. 11/${g.name}: PIN-Kreise mit schwachem Rand ${kreis && kreis['border-top-color']}`);
      pruef(kreis && parseFloat(kreis.width) >= 18, `Nr. 3/${g.name}: PIN-Kreise ${kreis && kreis.width} statt 18 px`);
      for (const z of '9999') await page.click(`.pin-pad [data-z="${z}"]`);
      await page.click('.pin-pad [data-ok]');
      await page.waitForFunction(() => { const m = document.querySelector('#pin-msg'); return m && m.classList.contains('err') && m.textContent.trim(); }, null, { timeout: 10000 });
      await sleep(400);
      const pm = await page.evaluate(() => {
        const m = document.querySelector('#pin-msg'); const c = getComputedStyle(m); const b = m.getBoundingClientRect();
        const punkt = [...document.querySelectorAll('.pin-dots i:not(.on)')].map((i) => getComputedStyle(i).borderTopColor);
        const pad = document.querySelector('.pin-pad').getBoundingClientRect(); const taste = document.querySelector('.pin-pad [data-z="1"]').getBoundingClientRect();
        const card = document.querySelector('.login-card').getBoundingClientRect();
        return { bg: c.backgroundColor, fg: c.color, fw: c.fontWeight, display: c.display, radius: parseFloat(c.borderTopLeftRadius), pl: parseFloat(c.paddingLeft), mitte: Math.abs((b.left + b.right) / 2 - (card.left + card.right) / 2), breite: b.width, cardBreite: card.width, punkt, padUnten: pad.bottom, tasteH: taste.height, vh: innerHeight };
      });
      pruef(hellrot(pm.bg), `Nr. 3/${g.name}: PIN-Fehler ohne hellrotes Schildchen (Hintergrund ${pm.bg})`);
      pruef(pm.display === 'table' && pm.radius >= 12 && pm.pl >= 10 && pm.breite < pm.cardBreite - 20 && pm.mitte <= 2, `Nr. 3/${g.name}: PIN-Fehler nicht als zentriertes Schildchen (display ${pm.display}, Radius ${pm.radius}, Innenabstand ${pm.pl}, Breite ${Math.round(pm.breite)}/${Math.round(pm.cardBreite)})`);
      pruef(Number(pm.fw) >= 700 && kontrast(pm.fg, pm.bg) >= 4.5, `Nr. 3/${g.name}: PIN-Fehlertext schwach (Stärke ${pm.fw}, Kontrast ${kontrast(pm.fg, pm.bg).toFixed(2)})`);
      pruef(pm.punkt.length > 0 && pm.punkt.every((c) => { const x = rgb(c); return x && x.r > 150 && x.g < 90; }), `Nr. 3/${g.name}: PIN-Kreise nach Fehler nicht rot umrandet (${pm.punkt.join(', ')})`);
      if (handy) {
        pruef(pm.tasteH >= 64, `Nr. 3/${g.name}: Zifferntasten ${Math.round(pm.tasteH)} px statt 66 px`);
        pruef(pm.vh - pm.padUnten <= 60, `Nr. 3/${g.name}: Ziffernblock nicht unten beim Daumen (${Math.round(pm.vh - pm.padUnten)} px Abstand zum unteren Rand)`);
        await tippflaechen(page, '.pin-pad button', 'PIN');
      }
      // Nr. 3: Tablet hochkant (820×1180) – Name, Kreise und Ziffernblock rutschen nicht nach unten (der Daumen-Grund gilt nur am Handy)
      if (tablet) {
        await page.setViewportSize({ width: 820, height: 1180 }); await sleep(250);
        const th = await page.evaluate(() => { const c = document.querySelector('.login-card').getBoundingClientRect(); const u = document.querySelector('.pin-user').getBoundingClientRect(); const pad = document.querySelector('.pin-pad').getBoundingClientRect(); return { oben: Math.round(u.top - c.top), unten: Math.round(innerHeight - pad.bottom) }; });
        pruef(th.oben <= 200, `Nr. 3/tablet hochkant: Name und Ziffernblock nach unten geschoben (${th.oben} px unter dem Kartenrand, ${th.unten} px über dem unteren Rand)`);
        await page.setViewportSize({ width: g.width, height: g.height }); await sleep(150);
      }
      await page.click('.pin-pad [data-z="1"]');
      await sleep(150);
      pruef(!(await page.evaluate(() => document.querySelector('#pin-msg').classList.contains('err'))), `Nr. 3/${g.name}: Schildchen bleibt nach dem ersten neuen Tippen stehen`);
      for (const z of PIN.slice(1)) await page.click(`.pin-pad [data-z="${z}"]`);
      await page.click('.pin-pad [data-ok]');
      await page.waitForSelector('#view', { timeout: 15000 });
      await ctx.close();
    }

    /* ================= 2) Mitarbeiter ================= */
    await sitzung(U.mitarbeiter, 'mitarbeiter', async ({ page, geh }) => {
      await geh('#/stempeln');
      await page.waitForSelector('.punch.in, [data-stempel="kommen"]');
      // Nr. 10: „Kommen“
      const k = await page.evaluate(() => { const p = document.querySelector('.punch.in'); if (!p) return null; const c = getComputedStyle(p); const sm = p.querySelector('small'); return { bg: c.backgroundColor, fg: c.color, sm: sm ? getComputedStyle(sm).opacity : '1', dis: p.disabled }; });
      pruef(k && k.bg === 'rgb(21, 128, 61)', `Nr. 10/${g.name}: „Kommen“-Knopf ${k && k.bg} statt rgb(21, 128, 61)`);
      pruef(k && kontrast(k.fg, k.bg) >= 4.5, `Nr. 10/${g.name}: Schrift auf „Kommen“ unter 4,5:1 (${k && kontrast(k.fg, k.bg).toFixed(2)})`);
      pruef(k && Number(k.sm) === 1, `Nr. 10/${g.name}: Unterzeile im „Kommen“-Knopf halbdurchsichtig (opacity ${k && k.sm})`);
      const g2 = await page.evaluate(() => { const p = document.querySelector('.punch.out small, .punch small'); return p ? getComputedStyle(p).opacity : null; });
      pruef(g2 === null || Number(g2) === 1, `Nr. 10/${g.name}: Unterzeile der Stempelknöpfe opacity ${g2}`);
      await tippflaechen(page, '.punch', 'Stempeluhr');
      if (handy) await tippflaechen(page, '#nav-tab a', 'untere Leiste');
      // Nr. 7: Nebenschrift
      const r = await ROOT(page);
      pruef(kontrast(r.faint, '#ffffff') >= 4.5, `Nr. 7/${g.name}: --faint ${r.faint} auf Weiß nur ${kontrast(r.faint, '#ffffff').toFixed(2)}:1`);
      pruef(kontrast(r.faint, rgb(r.bg)) >= 4.5, `Nr. 7/${g.name}: --faint ${r.faint} auf dem Seitenhintergrund ${r.bg} nur ${kontrast(r.faint, rgb(r.bg)).toFixed(2)}:1`);
      // Nr. 11: deckender Fokusrahmen (per Tastatur auf einen Knopf der Seite)
      let fokus = null;
      for (let i = 0; i < 40 && !fokus; i++) {
        await page.keyboard.press('Tab');
        fokus = await page.evaluate(() => { const a = document.activeElement; if (!a || !a.closest('#view') || !a.matches('button, a, [tabindex]') || !a.matches(':focus-visible')) return null; const c = getComputedStyle(a); return { farbe: c.outlineColor, stil: c.outlineStyle, breite: c.outlineWidth }; });
      }
      pruef(fokus && fokus.stil !== 'none' && rgb(fokus.farbe) && rgb(fokus.farbe).a === 1 && fokus.farbe === 'rgb(31, 85, 196)', `Nr. 11/${g.name}: Fokusrahmen nicht deckend blau (${fokus && `${fokus.stil} ${fokus.breite} ${fokus.farbe}`})`);
      // Nr. 1: eigene Symbole (Mitarbeiter: Einsatz ≠ Woche, Urlaub ≠ Abwesenheiten)
      if (handy) await geh('#/mehr');
      const sv = { einsatz: await svgVon(page, 'einsatz'), woche: await svgVon(page, 'woche'), urlaub: await svgVon(page, 'urlaub'), abw: await svgVon(page, 'abwesenheiten') };
      pruef(sv.einsatz && sv.woche && sv.einsatz !== sv.woche, `Nr. 1/${g.name}: „Mein Einsatz“ hat dasselbe Symbol wie „Woche“`);
      pruef(sv.einsatz && /M3\.5 17\.5h17/.test(sv.einsatz), `Nr. 1/${g.name}: „Mein Einsatz“ ohne Helm-Symbol`);
      pruef(sv.urlaub && sv.abw && sv.urlaub !== sv.abw, `Nr. 1/${g.name}: „Urlaub“ hat dasselbe Symbol wie „Abwesenheiten“`);
      pruef(sv.urlaub && /circle cx="12" cy="12" r="4"/.test(sv.urlaub), `Nr. 1/${g.name}: „Urlaub“ ohne Sonnen-Symbol`);
      // Nr. 9 (Folge): „Zusatzdienste“ am Handy – Zustand unter dem Namen, der Name hat die ganze Breite (größere Schilder drücken ihn nicht zusammen)
      if (handy) {
        const ig = await page.evaluate(() => [...document.querySelectorAll('.integ-list li')].map((li) => { const b = li.querySelector('b').getBoundingClientRect(); const z = li.querySelector('.integ-zustand').getBoundingClientRect(); const t = li.querySelector(':scope > span:nth-child(2)').getBoundingClientRect(); return { n: li.querySelector('b').textContent.trim().slice(0, 30), tw: Math.round(t.width), lw: Math.round(li.getBoundingClientRect().width), unter: z.top >= b.bottom - 1 }; }));
        pruef(ig.length >= 5, `Nr. 9/${g.name}: „Zusatzdienste“ unter „Mehr“ fehlen`);
        const eng = ig.filter((x) => !x.unter || x.tw < x.lw - 100);
        pruef(!eng.length, `Nr. 9/${g.name}: „Zusatzdienste“ – Zustand neben dem Namen bzw. Name zu schmal: ${eng.slice(0, 3).map((x) => `${x.n} ${x.tw}/${x.lw} px`).join(' | ')}`);
      }

      // Nr. 8 / Nr. 9: Meine Woche
      await geh('#/woche');
      await page.waitForSelector('.wd');
      const w = await page.evaluate(() => {
        const t = document.querySelector('.wd.today'); if (!t) return null; const c = getComputedStyle(t); const b = t.querySelector('.wd-day b'); const sm = t.querySelector('.wd-day small');
        const leer = !t.querySelector('.wd-bar') && !(t.querySelector('.wd-site') && t.querySelector('.wd-site').textContent.trim() && t.querySelector('.wd-site').textContent.trim() !== '–' && !t.querySelector('.wd-heute'));
        const andere = [...document.querySelectorAll('.wd:not(.today)')].map((x) => getComputedStyle(x).backgroundColor);
        return { bg: c.backgroundColor, sh: c.boxShadow, b: getComputedStyle(b).color, bw: getComputedStyle(b).fontWeight, sm: getComputedStyle(sm).color, leer, heute: t.querySelector('.wd-heute') ? t.querySelector('.wd-heute').textContent.trim() : null, strich: [...t.querySelectorAll('.wd-site')].some((x) => x.textContent.trim() === '–'), andere, green: getComputedStyle(document.documentElement).getPropertyValue('--green').trim() };
      });
      pruef(w, `Nr. 8/${g.name}: kein heutiger Tag (.wd.today) in „Meine Woche“`);
      if (w) {
        pruef(/inset/.test(w.sh) && /rgb\(18, 117, 56\)/.test(w.sh), `Nr. 8/${g.name}: heutiger Tag ohne grünen Balken links (box-shadow ${w.sh})`);
        pruef(w.andere.every((x) => x !== w.bg) && rgb(w.bg).g > rgb(w.bg).r, `Nr. 8/${g.name}: heutiger Tag nicht grün hinterlegt (${w.bg})`);
        pruef(w.b === GRUEN_OK && Number(w.bw) >= 800 && w.sm === GRUEN_OK, `Nr. 8/${g.name}: Wochentag/Datum von heute nicht grün und fett (${w.b} ${w.bw}, ${w.sm})`);
        if (w.leer) pruef(w.heute === 'heute' && !w.strich, `Nr. 8/${g.name}: leerer heutiger Tag zeigt „${w.heute || '–'}“ statt „heute“`);
      }
      // Nr. 7: andere leere Tage behalten „–“ in --faint/--muted, also mind. 4,5:1
      const off = await stil(page, '.wd.off .wd-day b', ['color']);
      if (off) pruef(kontrast(off.color, '#ffffff') >= 4.5, `Nr. 7/${g.name}: freier Tag in „Meine Woche“ nur ${kontrast(off.color, '#ffffff').toFixed(2)}:1`);
      // Nr. 36: Kürzel in der Woche
      const wb = await page.evaluate(() => [...document.querySelectorAll('.code-badge')].map((b) => ({ code: b.textContent.trim(), bg: getComputedStyle(b).backgroundColor, w: b.getBoundingClientRect().width })));
      for (const b of wb) if (KUERZEL[b.code]) pruef(b.bg === KUERZEL[b.code] && b.w >= 29.5, `Nr. 36/${g.name}: Kürzel ${b.code} in „Meine Woche“ ${b.bg}, ${Math.round(b.w)} px breit`);
      // Nr. 9: Statusschilder (Handy, Tablet)
      const chip = await page.evaluate(() => [...document.querySelectorAll('.chip.xs')].filter((c) => c.getClientRects().length).map((c) => parseFloat(getComputedStyle(c).fontSize)));
      if (chip.length && (handy || tablet)) pruef(chip.every((x) => x >= 12.4), `Nr. 9/${g.name}: Statusschilder in „Meine Woche“ ${chip.join('/')} px statt 12,5 px`);

      // Nr. 6 / Nr. 4: Urlaub – eigene Anträge, Vorschau mit Warnung
      await geh('#/urlaub');
      await page.waitForSelector('.an-liste .an-zeile');
      const an = await page.evaluate(() => [...document.querySelectorAll('.an-liste > .an-zeile')].filter((z) => !z.closest('.dlg-body')).map((z) => {
        const karte = z.closest('.card, section'); const kb = karte.getBoundingClientRect(); const k = z.querySelector('.an-kopf').getBoundingClientRect(); const c = getComputedStyle(z);
        return { links: Math.round(k.left - kb.left), rechts: Math.round(kb.right - k.right), pt: parseFloat(c.paddingTop) };
      }));
      pruef(an.length > 0, `Nr. 6/${g.name}: „Meine Anträge“ ohne Einträge`);
      for (const a of an) pruef(a.links >= 12 && a.rechts >= 12 && a.pt >= 10, `Nr. 6/${g.name}: Antrag klebt am Kartenrand (links ${a.links}, rechts ${a.rechts}, oben ${a.pt} px)`);
      await tippflaechen(page, '.an-knoepfe .btn', 'Meine Anträge');
      // Nr. 11: Rand der Rahmenknöpfe (.btn.ghost) #a3abb5 – der Knopf ist zusätzlich an seiner Schrift erkennbar
      const gh = await page.evaluate(() => { const b = [...document.querySelectorAll('#view .btn.ghost')].find((x) => x.getClientRects().length && !x.disabled && x.getAttribute('aria-disabled') !== 'true' && !x.matches(':hover, :focus')); return b ? { t: b.textContent.trim().slice(0, 24), c: getComputedStyle(b).borderTopColor } : null; });
      pruef(gh && gh.c === 'rgb(163, 171, 181)', `Nr. 11/${g.name}: Rahmenknopf „${gh && gh.t}“ mit Rand ${gh && gh.c} statt rgb(163, 171, 181)`);
      await page.click('#ur-antrag');
      await page.waitForSelector('dialog[open] [name="von"]');
      await page.evaluate(() => { const d = document.querySelector('dialog[open]'); const v = d.querySelector('[name="von"]'), b = d.querySelector('[name="bis"]'); v.value = '2026-12-10'; v.dispatchEvent(new Event('change', { bubbles: true })); b.value = '2026-12-01'; b.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.waitForSelector('dialog[open] .zr-warn');
      await sleep(150);
      const zr = await page.evaluate(() => { const v = document.querySelector('dialog[open] .zr-vorschau'); const w = v.querySelector('.zr-warn'); const c = getComputedStyle(v); return { bg: c.backgroundColor, sh: c.boxShadow, fg: getComputedStyle(w).color }; });
      pruef(hellrot(zr.bg) && /inset/.test(zr.sh), `Nr. 4/${g.name}: Warnung in der Urlaubs-Vorschau ohne hellroten Kasten mit Streifen (${zr.bg}, ${zr.sh})`);
      pruef(kontrast(zr.fg, zr.bg) >= 4.5, `Nr. 4/${g.name}: Warntext in der Vorschau nur ${kontrast(zr.fg, zr.bg).toFixed(2)}:1`);
      // Nr. 11 / Nr. 30: Felder im Dialog
      const inp = await stil(page, 'dialog[open] .input:not(:disabled):not(.ro)', ['border-top-color']);
      pruef(inp && kontrast(inp['border-top-color'], '#ffffff') >= 3, `Nr. 11/${g.name}: Feldrand ${inp && inp['border-top-color']} unter 3:1 gegen Weiß`);
      const fl = await stil(page, 'dialog[open] .field-label', ['font-size', 'text-transform', 'letter-spacing', 'font-weight', 'color']);
      pruef(fl && parseFloat(fl['font-size']) >= 13.4 && fl['text-transform'] === 'none' && ['normal', '0px'].includes(fl['letter-spacing']), `Nr. 30/${g.name}: Feldname im Urlaubsantrag ${fl && `${fl['font-size']} ${fl['text-transform']} ${fl['letter-spacing']}`}`);
      pruef(fl && Number(fl['font-weight']) >= 600 && kontrast(fl.color, '#ffffff') >= 7, `Nr. 30/${g.name}: Feldname zu blass (${fl && fl['font-weight']} ${fl && fl.color})`);
      await page.keyboard.press('Escape');
      await sleep(200);

      // Nr. 36: Kürzel auf „Abwesenheiten“
      await geh('#/abwesenheiten');
      await page.waitForSelector('.code-badge');
      const ab = await page.evaluate(() => [...document.querySelectorAll('#view .code-badge')].map((b) => ({ code: b.textContent.trim(), bg: getComputedStyle(b).backgroundColor, w: b.getBoundingClientRect().width })));
      pruef(ab.length > 0, `Nr. 36/${g.name}: keine Kürzel auf „Abwesenheiten“ (Mitarbeiter)`);
      for (const b of ab) if (KUERZEL[b.code]) pruef(b.bg === KUERZEL[b.code] && b.w >= 29.5, `Nr. 36/${g.name}: Kürzel ${b.code} auf „Abwesenheiten“ ${b.bg}, ${Math.round(b.w)} px breit`);
      await geh('#/einsatz');
    });

    /* ================= 3) Polier ================= */
    await sitzung(U.polier, 'polier', async ({ page, geh, bereit }) => {
      await geh('#/kolonne');
      await page.waitForSelector('#kol-liste .crew-row');
      // Nr. 2: gesperrter Knopf (niemand ausgewählt)
      const los = await page.evaluate(() => { const b = document.querySelector('#kol-los'); const c = getComputedStyle(b); return { dis: b.disabled, op: c.opacity, bg: c.backgroundColor, fg: c.color, sh: c.boxShadow, cur: c.cursor, muted: getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() }; });
      pruef(los.dis, `Nr. 2/${g.name}: „buchen“ ohne Auswahl nicht gesperrt`);
      pruef(Number(los.op) === 1, `Nr. 2/${g.name}: gesperrter Knopf halbdurchsichtig (opacity ${los.op})`);
      pruef(los.bg === 'rgb(230, 233, 237)' && los.sh === 'none' && los.cur === 'not-allowed', `Nr. 2/${g.name}: gesperrter Knopf nicht ruhig grau (${los.bg}, Schatten ${los.sh}, ${los.cur})`);
      pruef(kontrast(los.fg, los.bg) >= 4.5, `Nr. 2/${g.name}: Schrift auf gesperrtem Knopf nur ${kontrast(los.fg, los.bg).toFixed(2)}:1`);
      // Nr. 11: Ränder der Ankreuz-Kästchen und Auswahlfelder
      const chk = await stil(page, '.crew-row .check', ['border-top-color']);
      pruef(chk && kontrast(chk['border-top-color'], '#ffffff') >= 3, `Nr. 11/${g.name}: Kästchen-Rand ${chk && chk['border-top-color']} unter 3:1`);
      const sel = await stil(page, '#kol-bs', ['border-top-color']);
      pruef(sel && sel['border-top-color'] === 'rgb(124, 133, 145)', `Nr. 11/${g.name}: Feldrand ${sel && sel['border-top-color']} statt rgb(124, 133, 145)`);
      // Lukas einstempeln → langer Status „eingestempelt seit …“
      await page.locator(`.crew-row:has-text("${NAME.mitarbeiter}") .check`).click();
      await page.click('[data-typ="kommen"]').catch(() => {});
      await page.click('#kol-los');
      await page.waitForSelector(`.crew-row:has-text("${NAME.mitarbeiter}") .chip:has-text("gebucht")`, { timeout: 10000 });
      await page.reload(); await bereit();
      await page.waitForSelector(`.crew-row:has-text("${NAME.mitarbeiter}") .chip`);
      const kol = await page.evaluate(() => [...document.querySelectorAll('#kol-liste .crew-row')].map((r) => {
        const b = r.querySelector('.crew-txt b'); const bb = b.getBoundingClientRect(); const ch = r.querySelector(':scope > .chip'); const cb = ch && ch.getBoundingClientRect();
        return { name: b.textContent.trim(), sw: b.scrollWidth, cw: b.clientWidth, ellipse: getComputedStyle(b).textOverflow === 'ellipsis' && b.scrollWidth > b.clientWidth, nameUnten: bb.bottom, chipOben: cb ? cb.top : null, chipText: ch ? ch.textContent.trim() : null, chipFs: ch ? parseFloat(getComputedStyle(ch).fontSize) : null, chipH: cb ? cb.height : null, chipRaus: cb ? cb.right > r.getBoundingClientRect().right + 1 : false, rowH: r.getBoundingClientRect().height };
      }));
      pruef(kol.length > 2, `Nr. 5/${g.name}: Kolonne ohne Liste`);
      const ab = kol.filter((x) => x.sw > x.cw + 1);
      pruef(!ab.length, `Nr. 5/${g.name}: Namen abgeschnitten: ${ab.map((x) => `${x.name} (${x.sw}>${x.cw})`).join(', ')}`);
      const lang = kol.find((x) => x.chipText && /eingestempelt seit/.test(x.chipText));
      pruef(lang, `Nr. 5/${g.name}: kein Status „eingestempelt seit …“ in der Kolonne`);
      if (handy) {
        const neben = kol.filter((x) => x.chipText && x.chipOben < x.nameUnten - 2);
        pruef(!neben.length, `Nr. 5/${g.name}: Status steht neben statt unter dem Namen: ${neben.map((x) => x.name).join(', ')}`);
      }
      pruef(kol.every((x) => !x.chipRaus), `Nr. 5/${g.name}: Statusschild ragt aus der Zeile`);
      if (handy || tablet) {
        const klein = kol.filter((x) => x.chipText && (x.chipFs < 11.9 || x.chipH < 21.5));
        pruef(!klein.length, `Nr. 9/${g.name}: Statusschilder in der Kolonne zu klein: ${klein.map((x) => `${x.chipFs}px/${Math.round(x.chipH)}px`).join(', ')}`);
      }
      await tippflaechen(page, '#kol-liste .crew-row', 'Kolonne');
      await tippflaechen(page, '#kol-los', 'Kolonne buchen');
      // Nr. 1: Kolonne ≠ Partie
      if (handy) await geh('#/mehr');
      const sk = await svgVon(page, 'kolonne'), sp = await svgVon(page, 'partie');
      pruef(sk && sp && sk !== sp, `Nr. 1/${g.name}: „Kolonne stempeln“ hat dasselbe Symbol wie „Meine Partie“`);
      pruef(sk && /M14\.5 18\.2l2\.300 2\.300 4\.700-4\.700/.test(sk), `Nr. 1/${g.name}: „Kolonne stempeln“ ohne Person-mit-Häkchen-Symbol`);
      // Nr. 4 / Nr. 32: Schlechtwetter eintragen ohne Auswahl
      await geh('#/abwesenheiten');
      await page.click('[data-akt="eintragen"]');
      await page.waitForSelector('dialog[open] .pick-multi');
      await sleep(250);
      const pk = await page.evaluate(() => { const d = document.querySelector('dialog[open]'); return { kaestchen: [...d.querySelectorAll('.pick-multi .check-inline input')].map((i) => { const b = i.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; }), zeilen: [...d.querySelectorAll('.pick-multi .check-inline')].map((l) => l.getBoundingClientRect().height) }; });
      pruef(pk.kaestchen.length > 0 && pk.kaestchen.every(([w, h]) => w === 22 && h === 22), `Nr. 32/${g.name}: Kästchen „Schlechtwetter eintragen“ nicht 22×22 (${JSON.stringify(pk.kaestchen.slice(0, 3))})`);
      pruef(pk.zeilen.length > 0 && Math.min(...pk.zeilen) >= 43.5, `Nr. 32/${g.name}: Zeilen „Schlechtwetter eintragen“ nur ${Math.round(Math.min(...pk.zeilen))} px hoch`);
      await page.click('dialog[open] button[type="submit"]');
      await page.waitForSelector('dialog[open] .form-err:not([hidden])');
      const fe = await page.evaluate(() => { const e = document.querySelector('dialog[open] .form-err'); const c = getComputedStyle(e); return { t: e.textContent.trim(), bg: c.backgroundColor, fg: c.color, sh: c.boxShadow, pl: parseFloat(c.paddingLeft), r: parseFloat(c.borderTopLeftRadius) }; });
      pruef(hellrot(fe.bg), `Nr. 4/${g.name}: Fehlermeldung „${fe.t}“ ohne hellroten Kasten (${fe.bg})`);
      pruef(/inset/.test(fe.sh) && fe.pl >= 10 && fe.r >= 8, `Nr. 4/${g.name}: Fehlerkasten ohne Streifen/Innenabstand (${fe.sh}, ${fe.pl}, ${fe.r})`);
      pruef(kontrast(fe.fg, fe.bg) >= 4.5, `Nr. 4/${g.name}: Fehlertext nur ${kontrast(fe.fg, fe.bg).toFixed(2)}:1`);
      await tippflaechen(page, 'dialog[open] .pick-multi .check-inline', 'Schlechtwetter');
      await page.keyboard.press('Escape');
      await sleep(200);
      // Nr. 41: Polier sieht kein Budget
      await geh('#/baustellen');
      pruef(await page.locator('.site-bud, .bud-wort').count() === 0 && !/Budget/.test(await page.locator('#view').innerText()), `Nr. 41/${g.name}: Polier sieht Budgetangaben`);
      await geh('#/plan');
      await geh('#/urlaub');
      // Nr. 1: Hilfe-Thema „Kolonne stempeln“ mit demselben Symbol wie der Menüpunkt
      await geh('#/hilfe');
      const hk = await page.evaluate(() => { const s = document.querySelector('[data-thema="kolonne"] summary svg'); return s ? s.innerHTML : null; });
      pruef(hk && /M14\.5 18\.2l2\.300 2\.300 4\.700-4\.700/.test(hk), `Nr. 1/${g.name}: Hilfe-Thema „Kolonne stempeln“ ohne Person-mit-Häkchen-Symbol`);
    });

    /* ================= 4) Bauleiter ================= */
    await sitzung(U.bauleiter, 'bauleiter', async ({ page, geh }) => {
      await geh('#/dashboard');
      // Nr. 11: Fokusrahmen in der dunklen Seitenleiste weiß (Tablet, PC)
      if (!handy) {
        let sf = null;
        for (let i = 0; i < 30 && !sf; i++) { await page.keyboard.press('Tab'); sf = await page.evaluate(() => { const a = document.activeElement; if (!a || !a.closest('.sidenav') || !a.matches(':focus-visible')) return null; const c = getComputedStyle(a); return { farbe: c.outlineColor, stil: c.outlineStyle }; }); }
        pruef(sf && sf.stil !== 'none' && sf.farbe === 'rgb(255, 255, 255)', `Nr. 11/${g.name}: Fokusrahmen in der Seitenleiste nicht weiß (${sf && `${sf.stil} ${sf.farbe}`})`);
        await page.evaluate(() => document.activeElement && document.activeElement.blur());
      }
      // Nr. 25: Tablet-Seitenleiste
      if (tablet) {
        const nav = await page.evaluate(() => { const l = document.querySelector('.sidenav .nav-list'); const lr = l.getBoundingClientRect(); return { scroll: l.scrollHeight - l.clientHeight, items: [...l.querySelectorAll('.nav-item')].map((a) => { const b = a.getBoundingClientRect(); return { t: a.dataset.nav, h: b.height, sicht: b.top >= lr.top - 1 && b.bottom <= lr.bottom + 1 }; }) }; });
        const weg = nav.items.filter((x) => !x.sicht).map((x) => x.t);
        pruef(!weg.length && nav.scroll <= 1, `Nr. 25/${g.name}: Menüpunkte in der Seitenleiste verdeckt: ${weg.join(', ')} (scroll ${nav.scroll})`);
        pruef(nav.items.some((x) => x.t === 'woche' && x.sicht), `Nr. 25/${g.name}: „Woche“ in der Seitenleiste nicht sichtbar`);
        pruef(nav.items.every((x) => x.h >= 43.5), `Nr. 25/${g.name}: Menüpunkt unter 44 px (${Math.round(Math.min(...nav.items.map((x) => x.h)))})`);
      }
      // Nr. 35: Genehmigen/Ablehnen auf „Abwesenheiten“
      await geh('#/abwesenheiten');
      await page.waitForSelector('#abw-offen [data-entscheid="genehmigt"]');
      const ent = await page.evaluate(() => [...document.querySelectorAll('#abw-offen [data-entscheid]')].map((b) => { const c = getComputedStyle(b); return { e: b.dataset.entscheid, bg: c.backgroundColor, fg: c.color, svg: !!b.querySelector('svg') }; }));
      for (const b of ent.filter((x) => x.e === 'genehmigt')) pruef(b.bg === GRUEN_OK && b.fg === 'rgb(255, 255, 255)' && b.svg, `Nr. 35/${g.name}: „Genehmigen“ auf Abwesenheiten ${b.bg}/${b.fg} statt grün`);
      for (const b of ent.filter((x) => x.e === 'abgelehnt')) pruef(b.svg && b.bg === 'rgb(255, 255, 255)', `Nr. 35/${g.name}: „Ablehnen“ ohne X-Symbol oder nicht weiß (${b.bg})`);
      await tippflaechen(page, '#abw-offen [data-entscheid]', 'Abwesenheiten Genehmigen');
      const ab = await page.evaluate(() => [...document.querySelectorAll('#view .code-badge')].map((b) => ({ code: b.textContent.trim(), bg: getComputedStyle(b).backgroundColor })));
      for (const b of ab) if (KUERZEL[b.code]) pruef(b.bg === KUERZEL[b.code], `Nr. 36/${g.name}: Kürzel ${b.code} auf „Abwesenheiten“ (Bauleiter) ${b.bg}`);
      // Nr. 19 / Nr. 35 / Nr. 36: Urlaub
      await geh('#/urlaub');
      await page.waitForSelector(handy ? '.an-liste .an-zeile' : '#ur-kalender');
      const ue = await page.evaluate(() => [...document.querySelectorAll('[data-antrag-entscheid="genehmigt"]')].map((b) => getComputedStyle(b).backgroundColor));
      pruef(ue.length > 0 && ue.every((x) => x === GRUEN_OK), `Nr. 35/${g.name}: „Ganzen Antrag genehmigen“ ${ue.join(', ') || 'fehlt'} statt grün`);
      await tippflaechen(page, '.an-knoepfe .btn', 'Urlaub Entscheiden');
      if (!handy) {
        const kal = await page.evaluate(() => {
          const t = document.querySelector('#ur-kalender'); const sc = t.closest('.tbl-wrap, .ur-scroll, [class*="scroll"]') || t.parentElement;
          const seite = document.querySelector('.ur-seite'), karte = document.querySelector('.ur-karte');
          const kopf = [...t.querySelectorAll('thead th')]; const letzte = kopf[kopf.length - 1]; const sr = sc.getBoundingClientRect();
          return { scroll: sc.scrollWidth - sc.clientWidth, letzteSicht: letzte ? letzte.getBoundingClientRect().right <= sr.right + 1 : false, seiteOben: seite && karte ? seite.getBoundingClientRect().bottom <= karte.getBoundingClientRect().top + 1 : null };
        });
        pruef(kal.scroll <= 1 && kal.letzteSicht, `Nr. 19/${g.name}: Urlaubskalender muss seitlich gewischt werden (${kal.scroll} px)`);
        pruef(kal.seiteOben === true, `Nr. 19/${g.name}: „Offene Anträge“ nicht als Streifen über dem Kalender`);
        // Nr. 19: ab 1180 px Warnungen in zwei Spalten
        if (g.width >= 1180) {
          const wl = await stil(page, '#ur-warnungen .warn-list', ['display', 'grid-template-columns']);
          pruef(wl && wl.display === 'grid' && wl['grid-template-columns'].trim().split(/\s+/).length === 2, `Nr. 19/${g.name}: Warnungen im Urlaubskalender nicht zweispaltig (${wl ? `${wl.display} ${wl['grid-template-columns']}` : 'keine Warnungen in den Testdaten'})`);
        }
      }
      // Nr. 36: Kürzel = Kalenderfarben (Probe mit den echten Klassen auf der Urlaubsseite)
      const probe = await page.evaluate(() => {
        const box = document.createElement('div'); document.getElementById('view').appendChild(box);
        const o = {};
        for (const c of ['SW', 'ZA', 'BU']) { box.innerHTML = `<span class="code-badge c-${c}">${c}</span><i class="ur-z ur-${c} offen">${c}</i>`; o[c] = [getComputedStyle(box.children[0]).backgroundColor, getComputedStyle(box.children[1]).backgroundColor, getComputedStyle(box.children[0]).color, getComputedStyle(box.children[1]).color]; }
        box.remove(); return o;
      });
      for (const [c, [b1, b2, f1, f2]] of Object.entries(probe)) pruef(b1 === b2 && f1 === f2, `Nr. 36/${g.name}: Kürzel ${c} (${b1}/${f1}) anders als im Urlaubskalender (${b2}/${f2})`);
      // U und K: Werte des Prototyps, gleiche Farbfamilie wie im Kalender (U blau, K rot)
      const uk = await page.evaluate(() => {
        const box = document.createElement('div'); document.getElementById('view').appendChild(box); const o = {};
        for (const c of ['U', 'K']) { box.innerHTML = `<span class="code-badge c-${c}">${c}</span><i class="ur-z ur-${c} offen">${c}</i>`; o[c] = [getComputedStyle(box.children[0]).backgroundColor, getComputedStyle(box.children[1]).backgroundColor]; }
        box.remove(); return o;
      });
      const fam = { U: (x) => x.b > x.r && x.b > x.g, K: (x) => x.r > x.g && x.r > x.b };
      for (const [c, [b1, b2]] of Object.entries(uk)) pruef(b1 === KUERZEL[c] && fam[c](rgb(b1)) && fam[c](rgb(b2)), `Nr. 36/${g.name}: Kürzel ${c} ${b1} nicht in der Farbfamilie des Urlaubskalenders (${b2})`);
      // Nr. 41: Budget-Wort
      await geh('#/baustellen');
      await page.waitForSelector('.site-bud');
      const bud = await page.evaluate(() => [...document.querySelectorAll('.site-bud')].map((sb) => { const i = sb.querySelector('.meter i'); const w = sb.querySelector('.bud-wort'); return { k: i.classList.contains('red') ? 'red' : i.classList.contains('amber') ? 'amber' : '', wort: w ? w.textContent.trim() : '', wk: w ? w.className : '', farbe: w ? getComputedStyle(w).color : '', fw: w ? getComputedStyle(w).fontWeight : '' }; }));
      pruef(bud.some((b) => b.k === 'red') && bud.some((b) => b.k === 'amber'), `Nr. 41/${g.name}: Testdaten ohne rote und orange Budgetbalken`);
      for (const b of bud) {
        if (b.k === 'red') pruef(b.wort === 'Über Budget' && b.farbe === 'rgb(179, 36, 31)' && Number(b.fw) >= 700, `Nr. 41/${g.name}: roter Balken ohne „Über Budget“ (${b.wort || '–'} ${b.farbe})`);
        else if (b.k === 'amber') pruef(b.wort === 'Budget-Warnung' && b.farbe === 'rgb(154, 82, 5)' && Number(b.fw) >= 700, `Nr. 41/${g.name}: oranger Balken ohne „Budget-Warnung“ (${b.wort || '–'} ${b.farbe})`);
        else pruef(!b.wort, `Nr. 41/${g.name}: Wort „${b.wort}“ ohne Warnfarbe`);
      }
      // Nr. 9: Fuhrpark – Tage der Fristen 12 px (Handy, Tablet); die größeren Schilder drücken die Mängeltitel nicht zusammen
      await geh('#/fuhrpark');
      await page.waitForSelector('#fp-maengel li');
      const fp = await page.evaluate(() => ({ tag: [...document.querySelectorAll('.fp-tag small')].filter((x) => x.getClientRects().length).map((x) => parseFloat(getComputedStyle(x).fontSize)), mg: [...document.querySelectorAll('#fp-maengel > li')].map((li) => { const b = li.querySelector('.grow b'); return { t: b.textContent.trim().slice(0, 30), bw: Math.round(b.getBoundingClientRect().width), lh: Math.round(li.getBoundingClientRect().height) }; }) }));
      if (handy || tablet) pruef(fp.tag.length > 0 && fp.tag.every((x) => x >= 12), `Nr. 9/${g.name}: Tage der Fuhrpark-Fristen ${fp.tag.join('/') || 'fehlen'} px statt 12 px`);
      const zerdrueckt = fp.mg.filter((x) => x.bw < 120 || x.lh > 260);
      pruef(fp.mg.length > 0 && !zerdrueckt.length, `Nr. 9/${g.name}: Mängeltitel zusammengedrückt: ${zerdrueckt.map((x) => `${x.t} ${x.bw} px breit, Zeile ${x.lh} px`).join(' | ') || 'keine Mängel'}`);
      // Nr. 26 / Nr. 7 / Nr. 32: Planer
      await geh('#/plan');
      await page.waitForSelector('.wp-gitter');
      // Nr. 1: Knopf „Urlaub“ im Planer mit Sonne
      const pu = await page.evaluate(() => { const a = document.querySelector('#pool-urlaub svg'); return a ? a.innerHTML : null; });
      pruef(pu && /circle cx="12" cy="12" r="4"/.test(pu), `Nr. 1/${g.name}: Knopf „Urlaub“ im Planer ohne Sonnen-Symbol`);
      if (tablet) {
        const pl = await page.evaluate(() => { const s = document.querySelector('.wp-scroll'); const sr = s.getBoundingClientRect(); const tage = [...document.querySelectorAll('.wp-gitter .wp-zeile.kopf > *')].slice(1).map((x) => { const b = x.getBoundingClientRect(); return { t: x.textContent.trim().slice(0, 10), ganz: b.left >= sr.left - 1 && b.right <= sr.right + 1 }; }); return { scroll: s.scrollWidth - s.clientWidth, tage }; });
        pruef(pl.scroll <= 1, `Nr. 26/${g.name}: Wochentafel rollt seitlich (${pl.scroll} px)`);
        pruef(pl.tage.length >= 5 && pl.tage.slice(0, 5).every((x) => x.ganz), `Nr. 26/${g.name}: nicht alle Tage Mo–Fr ganz sichtbar: ${pl.tage.filter((x) => !x.ganz).map((x) => x.t).join(', ')}`);
      }
      const mini = await page.evaluate(() => { const m = [...document.querySelectorAll('.wp-mini[data-plus]')].find((x) => x.getClientRects().length); return m ? getComputedStyle(m).color : null; });
      const rr = await ROOT(page);
      const mutedRgb = (() => { const c = hex(rr.muted); return c ? `rgb(${c.r}, ${c.g}, ${c.b})` : ''; })();
      pruef(mini && kontrast(mini, '#ffffff') >= 4.5 && mini === mutedRgb, `Nr. 7/${g.name}: „+“ im Planer ${mini} statt var(--muted) ${mutedRgb}`);
      // Nr. 21: Bautagesbericht
      if (!handy) {
        await geh('#/berichte');
        const href = await page.locator('a[href^="#/bericht/"]').first().getAttribute('href');
        await geh(href);
        await page.waitForSelector('.bf-grid .a-pers');
        const bf = await page.evaluate(() => {
          const p = document.querySelector('.a-pers'); const pr = p.getBoundingClientRect(); const grid = document.querySelector('.bf-grid').getBoundingClientRect();
          const raus = [...p.querySelectorAll('.bp-row > *')].filter((c) => { const b = c.getBoundingClientRect(); return b.width && b.right > pr.right + 1; }).length;
          const ger = document.querySelector('.a-ger'), seg = document.querySelector('.a-seg');
          return { anteil: pr.width / grid.width, raus, scroll: p.scrollWidth - p.clientWidth, gerTop: ger && seg ? Math.round(ger.getBoundingClientRect().top - seg.getBoundingClientRect().top) : null };
        });
        pruef(bf.anteil >= 0.97, `Nr. 21/${g.name}: Personal-Tabelle nur ${Math.round(bf.anteil * 100)} % der Breite`);
        pruef(bf.raus === 0 && bf.scroll <= 1, `Nr. 21/${g.name}: Zellen ragen aus der Personal-Tabelle (${bf.raus}, scroll ${bf.scroll})`);
        pruef(bf.gerTop !== null && Math.abs(bf.gerTop) <= 2, `Nr. 21/${g.name}: „Geräte“ beginnt nicht neben „SEG“ (${bf.gerTop} px)`);
        // Nr. 21: Geräte- und Materialnamen nach Silben getrennt; Nr. 11: Zähl-Felder mit Rand wie .input (gesperrt hell)
        const bx = await page.evaluate(() => ({
          hy: [...document.querySelectorAll('.pf-ggrid .pf-g > span:first-child, .mat-row > span:first-child')].map((e) => { const c = getComputedStyle(e); return c.hyphens || c.webkitHyphens; }),
          st: [...document.querySelectorAll('.stepper')].filter((x) => x.getClientRects().length).map((x) => ({ dis: !!x.querySelector('input:disabled'), c: getComputedStyle(x).borderTopColor })),
        }));
        pruef(bx.hy.length > 0 && bx.hy.every((x) => x === 'auto'), `Nr. 21/${g.name}: Geräte-/Materialnamen ohne Silbentrennung (${[...new Set(bx.hy)].join('/') || 'keine Zeilen'})`);
        pruef(bx.st.length > 0, `Nr. 11/${g.name}: keine Zähl-Felder (.stepper) im Bautagesbericht`);
        for (const x of bx.st) pruef(x.dis ? kontrast(x.c, '#ffffff') < 2 : x.c === 'rgb(124, 133, 145)', `Nr. 11/${g.name}: Zähl-Feld${x.dis ? ' (gesperrt)' : ''} mit Rand ${x.c}`);
        // Nr. 21: Die schmälere Geräte-Box darf nicht rechts überlaufen (auch bei 1024 px, kleinstes Tablet quer)
        const ueberlauf = () => page.evaluate(() => ['.a-ger', '.a-seg', '.a-mat'].map((sel) => {
          const box = document.querySelector(sel); if (!box) return `${sel} fehlt`;
          const r = box.getBoundingClientRect();
          const raus = [...box.querySelectorAll('.stepper, .pf-g > *, .mat-row > *')].filter((c) => { const b = c.getBoundingClientRect(); return b.width && b.right > r.right - 1; });
          return raus.length ? `${sel}: ${raus.length} Elemente ragen bis ${Math.round(Math.max(...raus.map((c) => c.getBoundingClientRect().right)) - r.right)} px über den Rand` : '';
        }).filter(Boolean));
        const u1 = await ueberlauf();
        pruef(u1.length === 0, `Nr. 21/${g.name}: ${u1.join('; ')}`);
        const vp = page.viewportSize();
        await page.setViewportSize({ width: 1024, height: vp.height }); await page.waitForTimeout(150);
        const u2 = await ueberlauf();
        pruef(u2.length === 0, `Nr. 21/${g.name} bei 1024 px: ${u2.join('; ')}`);
        await page.setViewportSize(vp); await page.waitForTimeout(150);
      }
    });

    /* ================= 5) Büro ================= */
    await sitzung(U.buero, 'buero', async ({ page, geh }) => {
      // Nr. 18 / Nr. 36: Monatsauswertung
      await geh('#/monat');
      await page.waitForSelector('.matrix td[data-summe]');
      const leg = await page.evaluate(() => [...document.querySelectorAll('.legend-row .code-badge:not(.offen)')].map((b) => ({ code: b.textContent.trim(), bg: getComputedStyle(b).backgroundColor, w: b.getBoundingClientRect().width })));
      pruef(leg.length >= 4, `Nr. 36/${g.name}: Legende der Monatsauswertung ohne Kürzel`);
      for (const b of leg) if (KUERZEL[b.code]) pruef(b.bg === KUERZEL[b.code] && b.w >= 29.5, `Nr. 36/${g.name}: Kürzel ${b.code} in der Legende ${b.bg}, ${Math.round(b.w)} px`);
      const mat = await page.evaluate(() => [...document.querySelectorAll('.matrix .code-badge')].filter((b) => !b.classList.contains('offen')).map((b) => ({ code: b.textContent.trim(), bg: getComputedStyle(b).backgroundColor })));
      for (const b of mat) if (KUERZEL[b.code]) pruef(b.bg === KUERZEL[b.code], `Nr. 36/${g.name}: Kürzel ${b.code} in der Matrix ${b.bg}`);
      if (!handy) {
        const summe = async () => page.evaluate(() => { const w = document.querySelector('.matrix-wrap'); const wr = w.getBoundingClientRect(); return [...document.querySelectorAll('.matrix td[data-summe], .matrix thead .sum-fix')].map((s) => { const b = s.getBoundingClientRect(); return { sicht: b.left >= wr.left - 1 && b.right <= wr.right + 1, pos: getComputedStyle(s).position, bg: getComputedStyle(s).backgroundColor }; }); });
        const a = await summe();
        pruef(a.length > 1 && a.every((x) => x.sicht), `Nr. 18/${g.name}: Summe ohne Scrollen nicht sichtbar`);
        pruef(a.every((x) => x.pos === 'sticky' && rgb(x.bg).a === 1), `Nr. 18/${g.name}: Spalte „Summe“ bleibt nicht stehen (${[...new Set(a.map((x) => x.pos))].join('/')})`);
        await page.evaluate(() => { const w = document.querySelector('.matrix-wrap'); w.scrollLeft = Math.round((w.scrollWidth - w.clientWidth) / 2); });
        await sleep(150);
        const b = await summe();
        pruef(b.every((x) => x.sicht), `Nr. 18/${g.name}: Summe beim waagrechten Scrollen nicht sichtbar`);
      }
      // Nr. 35: Freigeben im unterschriebenen Bericht
      const bid = s.db.eins("SELECT id FROM bericht WHERE status = 'unterschrieben' ORDER BY id LIMIT 1").id;
      await geh(`#/bericht/${bid}`);
      await page.waitForSelector('#freigeben');
      const fr = await page.evaluate(() => { const b = document.querySelector('#freigeben'); const c = getComputedStyle(b); return { dis: b.disabled, bg: c.backgroundColor, fg: c.color, svg: !!b.querySelector('svg') }; });
      pruef(!fr.dis && fr.bg === GRUEN_OK && fr.fg === 'rgb(255, 255, 255)' && fr.svg, `Nr. 35/${g.name}: „Freigeben“ ${fr.bg}/${fr.fg} statt grün`);
      const eid = s.db.eins("SELECT id FROM bericht WHERE status = 'entwurf' ORDER BY id LIMIT 1");
      if (eid) {
        await geh(`#/bericht/${eid.id}`);
        const gs = await page.evaluate(() => { const b = document.querySelector('#freigeben'); if (!b) return null; const c = getComputedStyle(b); return { dis: b.disabled, bg: c.backgroundColor, op: c.opacity }; });
        if (gs) pruef(gs.dis && gs.bg === 'rgb(230, 233, 237)' && Number(gs.op) === 1, `Nr. 2/${g.name}: gesperrtes „Freigeben“ ${gs.bg} opacity ${gs.op} statt ruhig grau`);
        // Nr. 11: Zähl-Felder (.stepper) im bearbeitbaren Bericht mit Rand wie .input (am Handy auch die der anderen Schritte)
        const st = await page.evaluate(() => [...document.querySelectorAll('.stepper')].filter((x) => !x.querySelector('input:disabled')).map((x) => getComputedStyle(x).borderTopColor));
        pruef(st.length > 0 && st.every((c) => c === 'rgb(124, 133, 145)'), `Nr. 11/${g.name}: Zähl-Felder im Bericht-Entwurf mit Rand ${[...new Set(st)].join('/') || 'fehlen'} statt rgb(124, 133, 145)`);
      }
      // Nr. 32: Einteilen
      await geh('#/plan');
      await page.locator('#view [data-plus]:visible').first().waitFor();
      await page.locator('#view [data-plus]:visible').first().click();
      await page.waitForSelector('dialog[open] .pick-multi');
      await sleep(400);
      const ei = await page.evaluate(() => { const d = document.querySelector('dialog[open]'); const b = d.querySelector('.dlg-body'); return { kaestchen: [...d.querySelectorAll('.pick-multi .check-inline input')].map((i) => { const r = i.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }), zeilen: [...d.querySelectorAll('.pick-multi .check-inline')].map((l) => l.getBoundingClientRect().height), small: [...d.querySelectorAll('.pick-multi .check-inline small')].map((x) => getComputedStyle(x).backgroundColor), dlgScroll: b ? b.scrollHeight - b.clientHeight : 0 }; });
      pruef(ei.kaestchen.length > 0 && ei.kaestchen.every(([w, h]) => w === 22 && h === 22), `Nr. 32/${g.name}: Kästchen „Einteilen“ nicht 22×22 (${JSON.stringify([...new Set(ei.kaestchen.map((x) => x.join('×')))])})`);
      pruef(ei.zeilen.length > 0 && Math.min(...ei.zeilen) >= 43.5, `Nr. 32/${g.name}: Zeilen „Einteilen“ nur ${Math.round(Math.min(...ei.zeilen))} px hoch`);
      pruef(ei.small.every((x) => rgb(x).a > 0), `Nr. 32/${g.name}: „mit Partie“ nicht als Schildchen`);
      await tippflaechen(page, 'dialog[open] .pick-multi .check-inline', 'Einteilen');
      await page.keyboard.press('Escape');
      await sleep(200);
      // Nr. 30: Feldnamen im Dialog „Benutzer bearbeiten“, .list-label bleibt in Großbuchstaben
      await geh('#/benutzer');
      await page.click('[data-bearb]');
      await page.waitForSelector('dialog[open] .field-label');
      // bewusst kleinere Feldnamen (nur mit ihrem Selektor ausgenommen): Notizzettel im Planer
      const fl = await page.evaluate(() => [...document.querySelectorAll('dialog[open] .field-label')].map((e) => { const c = getComputedStyle(e); return { fs: parseFloat(c.fontSize), tt: c.textTransform, ls: c.letterSpacing, t: e.textContent.trim().slice(0, 20), aus: e.matches('.wp-notiz-ed .field-label') }; }));
      const falsch = fl.filter((x) => x.tt !== 'none' || !['normal', '0px'].includes(x.ls));
      pruef(fl.length > 0 && !falsch.length, `Nr. 30/${g.name}: Feldnamen in „Benutzer bearbeiten“ ${falsch.slice(0, 3).map((x) => `${x.t}: ${x.tt} ${x.ls}`).join(' | ')}`);
      const klein = fl.filter((x) => !x.aus && x.fs < 13.4);
      pruef(fl.length > 0 && !klein.length, `Nr. 30/${g.name}: Feldnamen kleiner als 13,5 px: ${klein.slice(0, 4).map((x) => `${x.t || '(leer)'} ${x.fs}px`).join(' | ')}`);
      // Nr. 11: Schalter im Aus-Zustand #8a929c (zum Messen kurz aus, ohne Ereignis und ohne Übergang; danach zurück)
      const sw = await page.evaluate(() => { const i = document.querySelector('dialog[open] input:not(:disabled) + .switch') && document.querySelector('dialog[open] input:not(:disabled) + .switch').previousElementSibling; if (!i) return null; const sp = i.nextElementSibling; const vor = i.checked; sp.style.transition = 'none'; i.checked = false; const c = getComputedStyle(sp).backgroundColor; i.checked = vor; sp.style.transition = ''; return c; });
      pruef(sw === 'rgb(138, 146, 156)', `Nr. 11/${g.name}: Schalter im Aus-Zustand ${sw || 'fehlt'} statt rgb(138, 146, 156)`);
      // Nr. 11: schreibgeschützte/gesperrte Felder behalten den hellen Rand
      const ro = await page.evaluate(() => [...document.querySelectorAll('dialog[open] .input.ro, dialog[open] .input:disabled')].map((e) => getComputedStyle(e).borderTopColor));
      for (const c of ro) pruef(kontrast(c, '#ffffff') < 2, `Nr. 11/${g.name}: gesperrtes Feld mit dunklem Rand ${c}`);
      await page.keyboard.press('Escape');
      await sleep(200);
      const ll = await stil(page, '.list-label', ['text-transform']);
      if (ll) pruef(ll['text-transform'] === 'uppercase', `Nr. 30/${g.name}: .list-label nicht mehr in Großbuchstaben`);
    });

    /* ================= 6) Geschäftsführung: Stammdaten (Nr. 17) ================= */
    if (!handy) await sitzung(U.gf, 'gf', async ({ page, geh, bereit }) => {
      await geh('#/preise');
      for (const tab of ['lohngruppen', 'geraete', 'materialien']) {
        const t = page.locator(`[data-tab="${tab}"]`);
        if (await t.count()) { await t.first().click(); await bereit(); }
        await page.waitForSelector('#stamm-tabelle tbody tr');
        const m = await page.evaluate(() => {
          const t = document.querySelector('#stamm-tabelle');
          const zeilen = [...t.querySelectorAll('tbody tr')].slice(0, 8).map((tr) => { const tds = [...tr.children].filter((x) => x.getBoundingClientRect().width); return new Set(tds.map((x) => Math.round(x.getBoundingClientRect().top))).size === 1 && new Set(tds.map((x) => Math.round(x.getBoundingClientRect().bottom))).size === 1; });
          const tr0 = t.querySelector('tbody tr');
          const kopf = [...t.querySelectorAll('thead th.r')].map((th, i) => { const td = tr0.querySelectorAll('td.r')[i]; const f = td && td.querySelector('.price-in input, .price-in, .num'); if (!f) return null; const tb = th.getBoundingClientRect(); return Math.round(tb.right - parseFloat(getComputedStyle(th).paddingRight) - f.getBoundingClientRect().right); }).filter((x) => x !== null);
          const main = t.querySelector('td.main');
          const pin = [...t.querySelectorAll('.price-in')].filter((p) => !p.matches('.saved, .invalid, :hover, :focus-within')).slice(0, 5).map((p) => getComputedStyle(p).borderTopColor);
          return { zeilen, kopf, main: main ? getComputedStyle(main).display : null, pin };
        });
        // Nr. 11: Preis-Eingabefelder mit Rand wie .input (mind. 3:1)
        pruef(m.pin.length > 0 && m.pin.every((c) => c === 'rgb(124, 133, 145)'), `Nr. 11/${g.name} ${tab}: Preisfelder mit Rand ${[...new Set(m.pin)].join('/') || 'fehlen'} statt rgb(124, 133, 145)`);
        pruef(m.main === null || m.main === 'table-cell', `Nr. 17/${g.name} ${tab}: Namenszelle display ${m.main} statt table-cell`);
        pruef(m.zeilen.length > 0 && m.zeilen.every(Boolean), `Nr. 17/${g.name} ${tab}: Name und Preise nicht in einer Linie`);
        pruef(m.kopf.every((x) => x <= 12), `Nr. 17/${g.name} ${tab}: Preiskopf steht rechts neben den Feldern (${m.kopf.join('/')} px)`);
      }
      const az = page.locator('#tab-arbeitszeit, [data-tab="arbeitszeit"]');
      if (await az.count()) {
        await az.first().click(); await bereit();
        const p = await page.evaluate(() => { const x = [...document.querySelectorAll('#view p')].find((e) => /Tag oder Woche/.test(e.textContent)); return x ? { k: x.className, pl: parseFloat(getComputedStyle(x).paddingLeft) } : null; });
        pruef(p && p.k === 'card-note' && p.pl >= 10, `Nr. 17/${g.name}: Erklärtext der Arbeitszeitmodelle ohne Innenabstand (${p && p.k})`);
      }
    });
  } finally {
    for (const c of offen) await c.close().catch(() => {});
    await s.stop();
  }
  return { fehler, schritte };
}

module.exports = { laufe, GROESSEN };

if (require.main === module) {
  (async () => {
    const browser = await chromium.launch();
    let gesamt = 0;
    for (const g of GROESSEN.filter((x) => !process.env.E2E_NUR || process.env.E2E_NUR.split(',').includes(x.name))) {
      console.log(`\n▶ Layout n12 ${g.name} (${g.width}×${g.height})`);
      const t = Date.now();
      const r = await laufe(browser, g);
      gesamt += r.fehler.length;
      console.log(`${r.fehler.length ? '✗' : '✓'} ${g.name}: ${r.schritte - r.fehler.length}/${r.schritte} Prüfungen bestanden (${((Date.now() - t) / 1000).toFixed(1)} s)`);
    }
    await browser.close();
    process.exit(gesamt ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(2); });
}
