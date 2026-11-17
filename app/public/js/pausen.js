// Vordefinierte Pausen (Inhaber 17.11.2026, API.md 15.22): Auswahl „30 Min · 45 Min · 60 Min · offen“ für Stempeluhr und Kolonne.
// Mit fester Dauer endet die Pause am Server von selbst (start + Dauer) – auch ohne Netz oder bei ausgeschaltetem Handy.
import { esc, fmt, dialog, speicher } from './ui.js';

export const STANDARD = [30, 45, 60];
const KEY = 'bt_pausen';

/** angebotene Dauern (zuletzt vom Server gemeldet, für ohne Netz gemerkt) */
export function pausenAuswahl() {
  const l = speicher.lies(KEY, null);
  return Array.isArray(l) && l.every((x) => Number.isInteger(x)) ? l : STANDARD;
}
export function merkeAuswahl(l) { if (Array.isArray(l)) speicher.setz(KEY, l); }

export const dauerText = (min) => (min == null ? 'offen' : `${min} Min`);
export const bisText = (iso) => `Pause bis ${fmt.uhr(iso)}`;

/**
 * Auswahldialog. Ergebnis: Minuten (Zahl), 'offen' oder undefined (abgebrochen).
 * Ohne angebotene Dauer gibt es nur „offen“ – dann ohne Rückfrage.
 */
export function pauseWaehlen({ titel = 'Pause – wie lange?', auswahl = pausenAuswahl(), hinweis = '' } = {}) {
  if (!auswahl.length) return Promise.resolve('offen');
  const jetzt = Date.now();
  const d = dialog({
    titel,
    inhalt: `<div class="pause-wahl" id="pause-wahl" role="group" aria-label="Dauer der Pause">
      ${auswahl.map((m) => `<button type="button" class="pause-opt" data-pause-min="${m}"><b>${m} Min</b><small>bis ${fmt.uhr(new Date(jetzt + m * 60000).toISOString())} Uhr</small></button>`).join('')}
      <button type="button" class="pause-opt offen" data-pause-min="offen"><b>offen</b><small>bis „Pause beenden“</small></button></div>
      <p class="fineprint">${hinweis ? esc(hinweis) + ' ' : ''}Mit fester Dauer endet die Pause von selbst – auch ohne Netz oder wenn das Handy aus ist. „Pause beenden“ geht jederzeit früher.</p>`,
  });
  d.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pause-min]');
    if (b) d.zu(b.dataset.pauseMin === 'offen' ? 'offen' : Number(b.dataset.pauseMin));
  });
  return d.geschlossen;
}
