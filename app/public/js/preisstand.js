// BauTag – Preise mit „gültig ab“ (API.md 12.2). Gemeinsamer Dialog für Preise & Stammdaten, Positionskatalog und Projektpositionen:
// neuer Preis → ab wann gilt er? (Standard heute) · rückwirkend nur nach ausdrücklicher Bestätigung · Verlauf mit geplanten Ständen.
import { ic, esc, fmt, dialog, bestaetigen, toast, laden, $ } from './ui.js';
import { wienHeute } from './zahl.js';

const wertText = (w, faktor) => (faktor ? `× ${fmt.zahl(w)}` : fmt.eur(w));
export const geplantChip = (liste, faktor) => {
  const l = (liste || []).slice().sort((a, b) => (a.gueltigAb < b.gueltigAb ? -1 : 1));
  if (!l.length) return '';
  const n = l[0];
  return `<span class="chip xs st-blue" data-geplant title="Dieser Preis ist geplant und gilt noch nicht">${ic('calendar')}ab ${esc(fmt.datum(n.gueltigAb))}: ${wertText(n.wert ?? n.ep, faktor)}${l.length > 1 ? ` (+${l.length - 1})` : ''}</span>`;
};

function verlaufHtml(liste, { faktor, darf, feldText }) {
  const heute = wienHeute();
  if (!liste.length) return '<p class="muted sm">Noch kein Verlauf.</p>';
  const sort = liste.slice().sort((a, b) => ((a.feld || '') === (b.feld || '') ? (a.gueltigAb < b.gueltigAb ? 1 : -1) : (a.feld || '') < (b.feld || '') ? -1 : 1));
  // je Feld: der jüngste Stand mit gueltigAb <= heute ist der aktuelle
  const aktuell = new Set();
  const gesehen = new Set();
  for (const v of sort) { const k = v.feld || ''; if (v.gueltigAb <= heute && !gesehen.has(k)) { aktuell.add(v.id); gesehen.add(k); } }
  return `<ul class="plain rows pv-liste">${sort.map((v) => {
    const zukunft = v.gueltigAb > heute;
    return `<li data-stand="${v.id}" class="${zukunft ? 'geplant' : aktuell.has(v.id) ? 'aktuell' : 'alt'}"><span class="grow"><b>${wertText(v.wert ?? v.ep, faktor)}${v.feld && feldText ? ` <small class="muted">${esc(feldText(v.feld))}</small>` : ''}</b><small>gültig ab ${esc(fmt.datum(v.gueltigAb))}${v.gueltigAb === '2000-01-01' ? ' (Anfangsstand)' : ''}${v.erstelltVon && v.erstelltVon.name ? ' · ' + esc(v.erstelltVon.name) : ''}</small></span>
      ${zukunft ? '<span class="chip xs st-blue" data-stand-geplant>geplant</span>' : aktuell.has(v.id) ? '<span class="chip xs st-green">gilt jetzt</span>' : ''}
      ${zukunft && darf ? `<button type="button" class="btn ghost sm" data-stand-weg="${v.id}">Zurücknehmen</button>` : ''}</li>`;
  }).join('')}</ul>`;
}

/**
 * Dialog „Preis ändern“ bzw. (ohne `neu`) nur „Preisverlauf“.
 * opt: { was, alt, neu?, faktor?, darf, feld?, feldText?, senden?({gueltigAb, rueckwirkend}), verlauf(), loeschen?(vid) }
 * Rückgabe (Promise): true, wenn etwas gespeichert/zurückgenommen wurde.
 */
export function preisDialog(opt) {
  const heute = wienHeute();
  const max = `${Number(heute.slice(0, 4)) + 2}${heute.slice(4)}`;
  const aendern = opt.neu != null && opt.senden;
  let geaendert = false;
  const d = dialog({
    titel: aendern ? 'Preis ändern' : 'Preisverlauf', breit: true,
    inhalt: `<div class="stack-s" id="preisstand">
      <p class="pv-was"><b>${esc(opt.was)}</b></p>
      ${aendern ? `<form id="pa-form" class="stack-s" novalidate>
        <div class="pv-neu"><span><small>bisher</small><b>${wertText(opt.alt, opt.faktor)}</b></span>${ic('right')}<span class="neu"><small>neu</small><b>${wertText(opt.neu, opt.faktor)}</b></span></div>
        <label class="field"><span class="field-label">Gültig ab</span><input class="input lg" type="date" name="gueltigAb" id="pa-ab" required value="${heute}" min="2000-01-01" max="${max}"></label>
        <p class="muted sm" id="pa-hinweis">Der neue Preis gilt für Berichte und Einträge ab diesem Tag. Ältere Tage rechnen weiter mit dem bisherigen Preis.</p>
        <p class="form-err" role="alert" hidden></p>
      </form>` : ''}
      <h4 class="sub-h">Verlauf</h4><div id="pv-verlauf">${laden('Verlauf wird geladen …')}</div>
    </div>`,
    fuss: aendern ? '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="pa-form" id="pa-ok">Speichern</button>' : '<button class="btn ghost" type="button" data-zu>Schließen</button>',
  });
  const ladeVerlauf = async () => {
    const box = $('#pv-verlauf', d.el); if (!box) return;
    try { const l = await opt.verlauf(); box.innerHTML = verlaufHtml(opt.feld ? l.filter((v) => !v.feld || v.feld === opt.feld) : l, opt); }
    catch (e) { box.innerHTML = `<p class="muted sm">${esc(e.status === 403 ? 'Kein Zugriff auf den Verlauf.' : e.message)}</p>`; }
  };
  ladeVerlauf();
  d.el.addEventListener('click', async (e) => {
    const w = e.target.closest('[data-stand-weg]'); if (!w || !opt.loeschen) return;
    if (!(await bestaetigen('Geplanten Preis zurücknehmen?', 'Der künftige Preis wird gelöscht; der bisherige gilt weiter.', 'Zurücknehmen', 'danger'))) return;
    try { await opt.loeschen(w.dataset.standWeg); geaendert = true; toast('Geplanter Preis zurückgenommen.'); ladeVerlauf(); } catch (x) { toast(x.message, 'warn'); }
  });
  const form = $('#pa-form', d.el);
  if (form) {
    const ab = $('#pa-ab', d.el), hinweis = $('#pa-hinweis', d.el);
    const zeig = () => {
      const v = ab.value;
      hinweis.dataset.art = v < heute ? 'rueck' : v > heute ? 'zukunft' : 'heute';
      hinweis.className = v < heute ? 'banner warn' : 'muted sm';
      hinweis.textContent = !v ? 'Bitte ein Datum wählen.'
        : v < heute ? `Rückwirkend ab ${fmt.datum(v)}: Bereits gerechnete Tage ab diesem Datum werden neu bewertet – Nachkalkulation und Budget ändern sich nachträglich. Das muss beim Speichern ausdrücklich bestätigt werden.`
        : v > heute ? `Geplant: Der neue Preis gilt erst ab ${fmt.datum(v)}. Bis dahin bleibt der bisherige Preis.`
        : 'Der neue Preis gilt für Berichte und Einträge ab heute. Ältere Tage rechnen weiter mit dem bisherigen Preis.';
    };
    ab.addEventListener('input', zeig); zeig();
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); const err = $('.form-err', d.el); const v = ab.value;
      if (!v || v < '2000-01-01' || v > max) { err.hidden = false; err.textContent = 'Bitte ein gültiges Datum wählen (höchstens zwei Jahre voraus).'; return; }
      let rueckwirkend = false;
      if (v < heute) {
        rueckwirkend = await bestaetigen('Preis rückwirkend ändern?', `Der Preis „${opt.was}“ gilt dann schon ab ${fmt.datum(v)}. Alle Berichte und Einträge seit diesem Tag werden mit dem neuen Preis nachgerechnet. Das wird protokolliert.`, 'Ja, rückwirkend ändern', 'danger');
        if (!rueckwirkend) return;
      }
      $('#pa-ok', d.el).disabled = true;
      try { await opt.senden({ gueltigAb: v, ...(rueckwirkend ? { rueckwirkend: true } : {}) }); geaendert = true; d.zu(); toast(v > heute ? `Preis geplant ab ${fmt.datum(v)}.` : rueckwirkend ? `Preis rückwirkend ab ${fmt.datum(v)} geändert.` : 'Preis gespeichert.'); }
      catch (x) { err.hidden = false; err.textContent = x.message; $('#pa-ok', d.el).disabled = false; }
    });
  }
  return d.geschlossen.then(() => geaendert);
}
