// Vordefinierte Pausen (Inhaber 17.11.2026, API.md 15.22): Auswahl „30 Min · 45 Min · 60 Min · offen“ für Stempeluhr und Kolonne.
// Mit fester Dauer endet die Pause am Server von selbst (start + Dauer) – auch ohne Netz oder bei ausgeschaltetem Handy.
import { esc, fmt, dialog, speicher } from './ui.js';
import { hm, zeitpunktAus, vorschlagBeginn, pruefePause } from './pause-gehen.js';

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

/**
 * 15.27 (Inhaber 19.11.2026): „Gehen“ ohne gestempelte Pause – „Wie lange war deine Pause?“ mit den angebotenen Dauern
 * (ohne „offen“), „Beginn ca.“ (Standard 12:00, sonst Mitte der Schicht) und „Keine Pause“. Schließen/Abbrechen bucht nichts.
 * Ergebnis: {beginn: ISO, dauerMin} · 'keine' · undefined (abgebrochen).
 * @param {{auswahl:number[], start:number, buchungen:Array, jetzt?:()=>number}} o  start = Kommen der Schicht (ms)
 */
export function pauseFrageBeimGehen({ auswahl, start, buchungen = [], jetzt = () => Date.now() }) {
  const kleinste = Math.min(...auswahl);
  let geaendert = false; // „Beginn ca.“ von Hand geändert? Sonst passt der Vorschlag sich der gewählten Dauer an
  const vorschlag = (dauer) => vorschlagBeginn(start, jetzt(), dauer);
  const d = dialog({
    titel: 'Heute keine Pause gestempelt',
    inhalt: `<div class="pause-gehen" id="pause-gehen">
      <p class="pg-frage"><b>Wie lange war deine Pause?</b></p>
      <label class="field pg-beginn"><span class="field-label">Beginn ca.</span><input type="time" class="input lg" id="pg-beginn" value="${esc(hm(vorschlag(kleinste)))}" required aria-describedby="pg-fehler"></label>
      <div class="pause-wahl" id="pg-wahl" role="group" aria-label="Dauer der Pause">
        ${auswahl.map((m) => `<button type="button" class="pause-opt" data-pg-min="${m}"><b>${m} Min</b><small data-pg-spanne></small></button>`).join('')}</div>
      <p class="pg-fehler" id="pg-fehler" role="alert" hidden></p>
      <button type="button" class="btn ghost lg pg-keine" data-pg-keine>Keine Pause</button>
      <p class="fineprint">Die Pause wird mit „Gehen“ zusammen gebucht – das Büro sieht, dass sie nachgetragen wurde.</p></div>`,
    fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button>',
  });
  const feld = d.el.querySelector('#pg-beginn');
  const fehler = d.el.querySelector('#pg-fehler');
  const beginnFuer = (dauer) => (geaendert ? zeitpunktAus(feld.value, jetzt()) : vorschlag(dauer));
  const spannen = () => {
    for (const b of d.el.querySelectorAll('[data-pg-min]')) {
      const m = Number(b.dataset.pgMin), von = beginnFuer(m);
      b.querySelector('[data-pg-spanne]').textContent = von == null ? '' : `${hm(von)} – ${hm(von + m * 60000)}`;
    }
  };
  spannen();
  feld.addEventListener('input', () => { geaendert = true; fehler.hidden = true; feld.removeAttribute('aria-invalid'); spannen(); });
  d.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-pg-keine]')) { d.zu('keine'); return; }
    const b = e.target.closest('[data-pg-min]');
    if (!b) return;
    const dauer = Number(b.dataset.pgMin);
    const r = pruefePause({ start, jetzt: jetzt(), beginn: beginnFuer(dauer), dauer, buchungen });
    if (r.fehler) {
      fehler.textContent = r.fehler; fehler.hidden = false; feld.setAttribute('aria-invalid', 'true');
      return;
    }
    d.zu({ beginn: new Date(r.beginn).toISOString(), dauerMin: dauer });
  });
  // Fokus auf die erste Dauer (nicht ins Zeitfeld – sonst springt am Handy sofort die Tastatur bzw. Uhr auf)
  const erste = d.el.querySelector('[data-pg-min]');
  if (erste) erste.focus();
  return d.geschlossen;
}
