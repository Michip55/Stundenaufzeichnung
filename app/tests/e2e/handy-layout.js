'use strict';
/**
 * Handy-Layout (API.md 15.19, Inhaber 16.11.2026) – nur bei Handy-Breite:
 *   node tests/e2e/handy-layout.js      (im Ordner app; Exit-Code 1 bei Befunden)
 * Wird auch von run.js aufgerufen (abschaltbar mit E2E_OHNE_HANDY_LAYOUT=1).
 *
 * Je Rolle (Büro, Polier, Mitarbeiter) und Breite 320/360/390 sowie quer 667×375, auf allen Seiten der Navigation:
 *  1. kein seitlicher Überlauf (Dokument, body, #view und jedes Element außerhalb eines eigenen Scroll-/Clip-Bereichs),
 *  2. jedes sichtbare Eingabefeld hat mindestens 16 px Schrift (sonst zoomt iOS beim Antippen hinein und bleibt dort),
 *  3. die App bleibt fest: wird das Dokument verschoben (wie iOS nach Tastatur/Auswahlliste), springt es auf 0/0 zurück,
 *     die Kopfleiste bleibt oben sichtbar und die Tab-Leiste unten.
 */
const { chromium } = require('playwright');
const { starte, U, START } = require('../api/hilfe');

const BREITEN = [{ w: 320, h: 640 }, { w: 360, h: 740 }, { w: 390, h: 844 }, { w: 667, h: 375 }];
const ROLLEN = [['buero', U.buero], ['polier', U.polier], ['mitarbeiter', U.mitarbeiter]];

async function laufe(browser, g) {
  const fehler = [];
  let schritte = 0;
  const pruef = (ok, text) => { schritte++; if (!ok) { fehler.push(text); console.log('    ✗ ' + text); } };
  if (g.width > 719) return { fehler, schritte };
  const s = await starte({ test: true, sitzung: { feldMin: 60 * 24 * 60, bueroMin: 60 * 24 * 60, maxH: 24 * 60 } });
  try {
    for (const [rolle, bid] of ROLLEN) {
      for (const b of BREITEN) {
        const ctx = await browser.newContext({ viewport: { width: b.w, height: b.h }, locale: 'de-AT', timezoneId: 'Europe/Vienna', hasTouch: true, isMobile: true, serviceWorkers: 'block' });
        await ctx.clock.install({ time: new Date(START) });
        const page = await ctx.newPage();
        const wo = `${rolle} ${b.w}×${b.h}`;
        try {
          await page.goto(s.basis + '/#/login', { waitUntil: 'domcontentloaded' });
          const st = await page.evaluate(async (id) => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ benutzerId: id, pin: '1234' }) })).status, bid);
          if (st !== 200) throw new Error(`Anmeldung ${rolle}: ${st}`);
          await page.evaluate(() => localStorage.setItem('bt_ich', '{}'));
          await page.goto(`${s.basis}/?start=${bid}#/`, { waitUntil: 'domcontentloaded' });
          await page.waitForSelector('#view', { state: 'attached' });
          await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
          const routen = await page.evaluate(() => [...new Set([...document.querySelectorAll('#nav-seite .nav-item')].map((a) => a.getAttribute('href').slice(1)))].concat(['/mehr']));
          for (const r of routen) {
            await page.evaluate((x) => { location.hash = x; }, '#' + r);
            await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
            await page.waitForTimeout(250);
            const m = await page.evaluate(() => {
              const vw = window.innerWidth, d = document.documentElement, v = document.getElementById('view');
              const clipt = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const ox = getComputedStyle(p).overflowX; if (p.id === 'view') return false; if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true; } return false; };
              const raus = [];
              for (const el of document.querySelectorAll('#view *, .topbar *, .tabbar *')) {
                const r = el.getBoundingClientRect();
                if (!r.width || !r.height) continue;
                if ((r.right > vw + 1 || r.left < -1) && !clipt(el)) raus.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''} (${Math.round(r.left)}–${Math.round(r.right)})`);
              }
              const klein = [];
              for (const el of document.querySelectorAll('input, select, textarea')) {
                if (['checkbox', 'radio', 'range', 'color', 'hidden', 'file'].includes(el.type)) continue;
                const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
                const fs = parseFloat(getComputedStyle(el).fontSize);
                if (fs < 16) klein.push(`${el.tagName.toLowerCase()}${el.name ? '[name=' + el.name + ']' : ''}:${fs}px`);
              }
              return { doc: d.scrollWidth - vw, body: document.body.scrollWidth - vw, view: v ? v.scrollWidth - v.clientWidth : 0, raus: raus.slice(0, 4), klein: klein.slice(0, 4) };
            });
            pruef(m.doc <= 1 && m.body <= 1 && m.view <= 1, `[${wo} ${r}] seitlicher Überlauf (doc ${m.doc}, body ${m.body}, view ${m.view})`);
            pruef(m.raus.length === 0, `[${wo} ${r}] Element ragt über den Bildschirm: ${m.raus.join(' | ')}`);
            pruef(m.klein.length === 0, `[${wo} ${r}] Eingabefeld unter 16 px (iOS zoomt hinein): ${m.klein.join(' | ')}`);
          }
          // 3. App bleibt fest: Dokument verschieben wie iOS nach Tastatur/Auswahlliste
          await page.evaluate(() => { location.hash = '#/mehr'; });
          await page.waitForTimeout(300);
          await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); document.documentElement.scrollTop = 80; document.body.scrollTop = 80; window.scrollTo(0, 80); window.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('resize')); });
          await page.waitForTimeout(700);
          const fest = await page.evaluate(() => {
            const t = document.querySelector('.topbar'), n = document.querySelector('#nav-tab');
            const tr = t && t.getBoundingClientRect(), nr = n && n.getBoundingClientRect();
            return { x: window.scrollX, y: window.scrollY, dt: document.documentElement.scrollTop, bt: document.body.scrollTop, top: tr ? tr.top : null, tabUnten: nr ? Math.round(window.innerHeight - nr.bottom) : null, tabSicht: n ? getComputedStyle(n).display !== 'none' : false };
          });
          pruef(fest.x === 0 && fest.y === 0 && fest.dt === 0 && fest.bt === 0, `[${wo}] Dokument bleibt verschoben (scroll ${fest.x}/${fest.y}, html ${fest.dt}, body ${fest.bt})`);
          pruef(fest.top !== null && fest.top >= 0, `[${wo}] Kopfleiste aus dem Bildschirm geschoben (top ${fest.top})`);
          if (fest.tabSicht) pruef(fest.tabUnten !== null && Math.abs(fest.tabUnten) <= 1, `[${wo}] Tab-Leiste nicht am unteren Rand (Abstand ${fest.tabUnten})`);
        } catch (e) {
          pruef(false, `[${wo}] Abbruch: ${String(e.message).slice(0, 160)}`);
        } finally { await ctx.close(); }
      }
    }
  } finally { await s.stop(); }
  return { fehler, schritte };
}

module.exports = { laufe };

if (require.main === module) {
  (async () => {
    const browser = await chromium.launch();
    const r = await laufe(browser, { name: 'handy', width: 390, height: 844, mobil: true });
    console.log(`  ${r.schritte - r.fehler.length}/${r.schritte} Prüfungen bestanden`);
    await browser.close();
    process.exit(r.fehler.length ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
