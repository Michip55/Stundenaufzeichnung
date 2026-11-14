'use strict';
/**
 * F-042: Bedienelemente mit Ziel finden – auch solche, die erst beim Klick navigieren (Knöpfe mit Klick-Handler, Kacheln,
 * Karten, Tabellenzeilen, Benachrichtigungen, window.open/Downloads). Gemeinsam für sackgassen.js und rechte-ui.js.
 *
 * Trockenlauf: Während des Klicks beantwortet der Test alle NICHT-GET-Anfragen an /api selbst mit 400 „Trockenlauf“
 * (nichts wird gebucht, gesendet, gelöscht – und weil es keine Netzstörung ist, legt die App auch nichts in ihre
 * Offline-Warteschlangen), Bestätigungsdialoge werden abgelehnt, window.open/print abgefangen. Nie geklickt werden
 * Abmelden (beendet den Rundgang) und die Stempel-Knöpfe (Offline-Warteschlange, eigene Tests). Ergebnis je Klick: neue Adresse (Hash), geöffnete URLs, Downloads, 401/403-Antworten.
 */

// Elemente, die etwas auslösen können (sichtbar, im Inhalt oder in offenen Dialogen)
const KLICKBAR = [
  'button', '[role="button"]', '[role="link"]', '[data-href]', '[data-link]', '[data-ziel]', '[data-nav]', '[data-auf]', '[onclick]',
  'tr[data-anlage]', 'tr[data-id]', '[data-zieh]', '.card[tabindex]', '.kachel', '.tile', 'article[tabindex]', 'li[tabindex]'
].map((s) => `#view ${s}:visible, dialog[open] ${s}:visible`).join(', ');
// nie klicken: beendet die Sitzung bzw. den Rundgang
const NIE = /abmeld|logout|abmelden|\bkommen\b|\bgehen\b|pause|stempel/i;

/** Ausdrückliche Ziele (Links, data-href/-link/-ziel, Menü) der sichtbaren Seite */
async function ausdrueckliche(page) {
  return page.evaluate(() => [...document.querySelectorAll('a[href], [data-href], [data-link], [data-ziel], [data-nav]')]
    .filter((a) => a.offsetParent !== null || a.getClientRects().length)
    .map((a) => ({ ziel: a.getAttribute('href') || a.dataset.href || a.dataset.link || a.dataset.ziel || (a.dataset.nav ? `#/${a.dataset.nav}` : ''), name: (a.innerText || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 50) }))
    .filter((x) => x.ziel));
}

/** Einmal je Kontext: window.open/print abfangen */
async function vorbereiten(ctx) {
  await ctx.addInitScript(() => {
    window.__bt_geoeffnet = [];
    const o = window.open; // eslint-disable-line no-unused-vars
    window.open = (u) => { window.__bt_geoeffnet.push(String(u)); return null; };
    window.print = () => {};
  });
}

/**
 * Klickt jedes klickbare Element der aktuellen Seite im Trockenlauf und meldet, wohin es führt.
 * @returns {Promise<{name:string, hash:string|null, geoeffnet:string[], downloads:string[], gesperrt:string[]}[]>}
 */
async function trockenKlicks(page, basis, { max = 30, ruhe } = {}) {
  const start = await page.evaluate(() => location.hash);
  const out = [];
  const gesperrt = [], downloads = [];
  const aufAntwort = (r) => { if (r.url().startsWith(basis + '/api/') && [401, 403].includes(r.status())) gesperrt.push(`${r.request().method()} ${r.url().slice(basis.length).split('?')[0]} → ${r.status()}`); };
  const aufDownload = (d) => downloads.push(d.url());
  const aufDialog = (d) => d.dismiss().catch(() => {});
  const abbrechen = (route) => (route.request().method() === 'GET' ? route.continue() : route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ fehler: 'Trockenlauf (Test): nichts gespeichert.', code: 'UNGUELTIG' }) }));
  await page.route(`${basis}/api/**`, abbrechen);
  page.__bt_trocken = true; // abgebrochene Schreib-Anfragen erzeugen Konsolenfehler – die zählen hier nicht
  page.on('response', aufAntwort);
  page.on('download', aufDownload);
  page.on('dialog', aufDialog);
  try {
    const anzahl = Math.min(await page.locator(KLICKBAR).count(), max);
    for (let i = 0; i < anzahl; i++) {
      const el = page.locator(KLICKBAR).nth(i);
      if (!(await el.count())) break;
      const name = ((await el.innerText().catch(() => '')) || (await el.getAttribute('aria-label').catch(() => '')) || (await el.getAttribute('title').catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 50);
      const id = (await el.getAttribute('id').catch(() => '')) || '';
      if (NIE.test(name) || NIE.test(id) || (await el.getAttribute('data-stempel').catch(() => null)) !== null || (await el.isDisabled().catch(() => false))) continue;
      gesperrt.length = 0; downloads.length = 0;
      if (process.env.BAUTAG_E2E_LOG) console.log(`      [Trockenlauf] ${start} › „${name || id}“`);
      await page.evaluate(() => { window.__bt_geoeffnet = []; });
      await el.click({ timeout: 2000 }).catch(() => {});
      if (ruhe) await ruhe(); else await page.waitForTimeout(300);
      const hash = await page.evaluate(() => location.hash);
      const geoeffnet = await page.evaluate(() => window.__bt_geoeffnet || []);
      out.push({ name: name || id || `Element ${i + 1}`, hash: hash !== start ? hash : null, geoeffnet, downloads: [...downloads], gesperrt: [...gesperrt] });
      // zurück zum Ausgangszustand
      await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
      if (hash !== start) { await page.evaluate((h) => { location.hash = h; }, start); if (ruhe) await ruhe(); else await page.waitForTimeout(300); }
    }
  } finally {
    if (!page.isClosed()) { await page.waitForTimeout(200); await page.unroute(`${basis}/api/**`, abbrechen); }
    page.__bt_trocken = false;
    page.off('response', aufAntwort);
    page.off('download', aufDownload);
    page.off('dialog', aufDialog);
  }
  return out;
}

/** Ist die Seite unter dieser Adresse für den angemeldeten Benutzer gesperrt („Seite nicht verfügbar“)? */
async function zielGesperrt(page, hash, ruhe) {
  const zurueck = await page.evaluate(() => location.hash);
  await page.evaluate((h) => { location.hash = h; }, hash);
  if (ruhe) await ruhe(); else await page.waitForTimeout(600);
  const g = await page.evaluate(() => Boolean(document.querySelector('[data-zustand="kein-zugriff"]')) || /Seite nicht gefunden/.test(document.body.innerText));
  await page.evaluate((h) => { location.hash = h; }, zurueck);
  if (ruhe) await ruhe(); else await page.waitForTimeout(300);
  return g;
}

/** Geöffnete URL / Download für den angemeldeten Benutzer abrufbar (kein 401/403)? */
async function urlStatus(page, url) {
  return page.evaluate(async (u) => { try { return (await fetch(u, { method: 'GET' })).status; } catch (_) { return 0; } }, url);
}

module.exports = { KLICKBAR, NIE, ausdrueckliche, vorbereiten, trockenKlicks, zielGesperrt, urlStatus };
