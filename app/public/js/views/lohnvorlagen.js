// BMD-Lohn: Export-Vorlagen (API.md 12.20) – Spalten und Lohnarten für die Übergabe an die Lohnverrechnung einstellen.
import { get, post, put, del } from '../api.js';
import { ic, esc, leer, banner, dialog, bestaetigen, toast, $, $$ } from '../ui.js';

const FELDER = { pnr: 'Personalnummer', name: 'Name', monat: 'Monat', lohnart: 'Lohnart', stunden: 'Stunden', tage: 'Tage', betrag: 'Betrag', kst: 'Kostenstelle', datum: 'Datum', fest: 'Fester Wert' };
const LOHNARTEN = { normal: 'Normalstunden', ueberstunden: 'Überstunden', sw: 'Schlechtwetter', u: 'Urlaub', k: 'Krank', za: 'Zeitausgleich', seg: 'SEG-Zulage', taggeld: 'Taggeld' };

export default async function lohnvorlagen(el, ctx) {
  let liste = [];
  const monat = ctx.query.get('monat') || '';
  async function lade() { liste = await get('/lohn-vorlagen'); }
  await lade();
  function zeichne() {
    el.innerHTML = `<div class="page">
      <div class="form-top"><a class="link-back" href="#/monat">${ic('left')}Monatsauswertung</a><span class="grow"></span><button type="button" class="btn primary" id="lv-neu">${ic('plus')}Neue Vorlage</button></div>
      ${banner('info', 'Die Vorlage bestimmt, wie die Lohn-Datei für BMD aufgebaut ist (Spalten, Trennzeichen, Lohnart-Nummern). Die Lohnart-Nummern bitte mit der Lohnverrechnung abstimmen.')}
      <section class="card">${liste.length ? `<ul class="plain rows" id="lohn-vorlagen">${liste.map((v) => `<li data-vorlage="${v.id}"><span class="grow"><b>${esc(v.name)}</b><small>${(v.spalten || []).map((s) => esc(s.feld === 'fest' ? `„${s.wert || ''}“` : FELDER[s.feld] || s.feld)).join(' · ')}</small><small>${v.zeileJe === 'person_tag_lohnart' ? 'eine Zeile je Person, Tag und Lohnart' : 'eine Zeile je Person und Lohnart'} · Trennzeichen ${esc(v.trennzeichen === '\t' ? 'Tab' : v.trennzeichen || ';')} · ${esc(v.kodierung || 'utf-8')}</small></span>${monat ? `<a class="btn ghost sm" data-export href="/api/monat/export.csv?monat=${esc(monat)}&vorlage=${v.id}" download>${ic('download', 'xs')}Export ${esc(monat)}</a>` : ''}<button type="button" class="btn ghost sm" data-edit="${v.id}">${ic('edit', 'xs')}Bearbeiten</button></li>`).join('')}</ul>` : leer('Noch keine Vorlage.', 'table')}</section></div>`;
  }
  function vorlageDialog(v) {
    const spalten = v ? (v.spalten || []).map((s) => ({ ...s })) : [{ feld: 'pnr' }, { feld: 'name' }, { feld: 'lohnart' }, { feld: 'stunden' }];
    const la = (v && v.lohnarten) || {};
    const spHtml = () => spalten.map((s, i) => `<li data-sp="${i}"><span class="lv-nr">${i + 1}</span><select class="input" data-sp-feld aria-label="Spalte ${i + 1}">${Object.entries(FELDER).map(([k, t]) => `<option value="${k}" ${s.feld === k ? 'selected' : ''}>${t}</option>`).join('')}</select><input class="input" data-sp-wert placeholder="fester Wert" maxlength="60" value="${esc(s.wert || '')}" aria-label="Fester Wert Spalte ${i + 1}" ${s.feld === 'fest' ? '' : 'hidden'}><button type="button" class="icon-btn sm" data-sp-auf aria-label="Spalte ${i + 1} nach oben" ${i ? '' : 'disabled'}>${ic('left')}</button><button type="button" class="icon-btn sm" data-sp-ab aria-label="Spalte ${i + 1} nach unten" ${i < spalten.length - 1 ? '' : 'disabled'}>${ic('right')}</button><button type="button" class="icon-btn sm" data-sp-weg aria-label="Spalte ${i + 1} entfernen">${ic('trash')}</button></li>`).join('');
    const tz = v ? (v.trennzeichen === '\t' ? 'TAB' : v.trennzeichen) : ';';
    const dlg = dialog({ titel: v ? 'Vorlage bearbeiten' : 'Neue Vorlage', breit: true, inhalt: `<form id="lvf" class="form-grid" novalidate>
      <label class="field full"><span class="field-label">Name</span><input class="input lg" name="name" required maxlength="80" value="${esc((v && v.name) || '')}"></label>
      <label class="field"><span class="field-label">Trennzeichen</span><select class="input lg" name="trennzeichen">${[[';', 'Strichpunkt ;'], [',', 'Komma ,'], ['TAB', 'Tabulator']].map(([w, t]) => `<option value="${w}" ${tz === w ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="field"><span class="field-label">Zeichensatz</span><select class="input lg" name="kodierung"><option value="utf-8" ${!v || v.kodierung !== 'windows-1252' ? 'selected' : ''}>UTF-8</option><option value="windows-1252" ${v && v.kodierung === 'windows-1252' ? 'selected' : ''}>Windows-1252 (ANSI)</option></select></label>
      <label class="field"><span class="field-label">Dezimalzeichen</span><select class="input lg" name="dezimal"><option value="," ${!v || v.dezimal !== '.' ? 'selected' : ''}>Komma</option><option value="." ${v && v.dezimal === '.' ? 'selected' : ''}>Punkt</option></select></label>
      <label class="field"><span class="field-label">Zeilen</span><select class="input lg" name="zeileJe"><option value="person_lohnart" ${!v || v.zeileJe !== 'person_tag_lohnart' ? 'selected' : ''}>je Person und Lohnart (Monatssumme)</option><option value="person_tag_lohnart" ${v && v.zeileJe === 'person_tag_lohnart' ? 'selected' : ''}>je Person, Tag und Lohnart</option></select></label>
      <label class="check-inline full"><input type="checkbox" name="kopfzeile" ${!v || v.kopfzeile !== false ? 'checked' : ''}> Erste Zeile mit Spaltenüberschriften</label>
      <fieldset class="field full"><legend class="field-label">Spalten (Reihenfolge wie in der Datei)</legend><ol class="plain lv-spalten" id="lv-spalten">${spHtml()}</ol><button type="button" class="btn ghost sm" id="lv-sp-neu">${ic('plus', 'xs')}Spalte</button></fieldset>
      <fieldset class="field full"><legend class="field-label">Lohnart-Nummern in BMD</legend><div class="form-grid" id="lv-lohnarten">${Object.entries(LOHNARTEN).map(([k, t]) => `<label class="field"><span class="field-label">${t}</span><input class="input" name="la_${k}" maxlength="20" value="${esc(la[k] ?? '')}"></label>`).join('')}</div></fieldset>
      <p class="form-err full" role="alert" hidden></p></form>`, fuss: `${v ? '<button class="btn danger" type="button" id="lv-weg">Löschen</button><span class="grow"></span>' : ''}<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="lvf">Speichern</button>` });
    const lies = () => { $$('#lv-spalten li', dlg.el).forEach((li) => { const i = Number(li.dataset.sp); const feld = $('[data-sp-feld]', li).value; spalten[i] = feld === 'fest' ? { feld, wert: $('[data-sp-wert]', li).value } : { feld }; }); };
    const neuSp = () => { $('#lv-spalten', dlg.el).innerHTML = spHtml(); };
    dlg.el.addEventListener('change', (e) => { if (e.target.matches('[data-sp-feld]')) { lies(); neuSp(); } });
    dlg.el.addEventListener('click', async (e) => {
      const li = e.target.closest('[data-sp]'); const i = li ? Number(li.dataset.sp) : -1;
      if (e.target.closest('#lv-sp-neu')) { lies(); spalten.push({ feld: 'kst' }); return neuSp(); }
      if (e.target.closest('[data-sp-weg]')) { lies(); spalten.splice(i, 1); return neuSp(); }
      if (e.target.closest('[data-sp-auf]')) { lies(); [spalten[i - 1], spalten[i]] = [spalten[i], spalten[i - 1]]; return neuSp(); }
      if (e.target.closest('[data-sp-ab]')) { lies(); [spalten[i + 1], spalten[i]] = [spalten[i], spalten[i + 1]]; return neuSp(); }
      if (e.target.closest('#lv-weg')) { if (!(await bestaetigen('Vorlage löschen?', '', 'Löschen', 'danger'))) return; try { await del(`/lohn-vorlagen/${v.id}`); dlg.zu(); toast('Vorlage gelöscht.'); } catch (x) { toast(x.message, 'warn'); } await lade(); zeichne(); }
    });
    $('#lvf', dlg.el).addEventListener('submit', async (e) => {
      e.preventDefault(); lies(); const f = new FormData(e.target); const err = $('.form-err', dlg.el);
      if (!String(f.get('name')).trim() || !spalten.length) { err.hidden = false; err.textContent = 'Bitte einen Namen und mindestens eine Spalte angeben.'; return; }
      const body = { name: String(f.get('name')).trim(), trennzeichen: f.get('trennzeichen') === 'TAB' ? '\t' : f.get('trennzeichen'), kodierung: f.get('kodierung'), dezimal: f.get('dezimal'), kopfzeile: f.get('kopfzeile') === 'on', zeileJe: f.get('zeileJe'), spalten, lohnarten: Object.fromEntries(Object.keys(LOHNARTEN).map((k) => [k, String(f.get('la_' + k) || '').trim()])) };
      try { if (v) await put(`/lohn-vorlagen/${v.id}`, body); else await post('/lohn-vorlagen', body); dlg.zu(); toast('Vorlage gespeichert.'); await lade(); zeichne(); } catch (x) { err.hidden = false; err.textContent = x.message; }
    });
  }
  el.addEventListener('click', (e) => {
    if (e.target.closest('#lv-neu')) return vorlageDialog(null);
    const ed = e.target.closest('[data-edit]'); if (ed) vorlageDialog(liste.find((v) => String(v.id) === ed.dataset.edit));
  });
  zeichne();
}
