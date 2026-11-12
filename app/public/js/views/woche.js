// Meine Woche: Stunden je Tag, Summe, Überstunden, Abwesenheits-Antrag (Urlaub / Zeitausgleich).
import { get, post } from '../api.js';
import { ic, esc, fmt, dialog, toast, laden, fehlerBox, $ } from '../ui.js';

const CODES = { K: 'Krank', U: 'Urlaub', SW: 'Schlechtwetter', ZA: 'Zeitausgleich', F: 'Feiertag' };
export const codeBadge = (c) => (c ? `<span class="code-badge c-${esc(c)}" title="${esc(CODES[c] || c)}">${esc(c)}</span>` : '');

export default async function woche(el, ctx) {
  let datum = ctx.query.get('datum') || fmt.iso();
  let baustellen = [];
  try { baustellen = await get('/baustellen'); } catch (e) { if (!e.netz) throw e; }
  const bsName = (x) => (x && typeof x === 'object' ? x.name || (baustellen.find((b) => b.id === x.id || b.id === x.baustelleId) || {}).name : (baustellen.find((b) => b.id === x) || {}).name || (typeof x === 'string' ? x : '')) || '';

  async function zeichne() {
    el.innerHTML = laden();
    let w;
    try { w = await get(`/zeit/woche?datum=${datum}`); }
    catch (e) { if (e.status === 403 || e.status === 401) throw e; el.innerHTML = fehlerBox(e); $('[data-neu-laden]', el).addEventListener('click', zeichne); return; }
    if (!ctx.aktuell()) return;
    const tage = w.tage || [];
    const heute = fmt.iso();
    const von = tage[0] ? tage[0].datum : datum, bis = tage.length ? tage[tage.length - 1].datum : datum;
    const max = Math.max(10, ...tage.map((t) => t.stunden || 0));
    el.innerHTML = `
    <div class="page narrow wide-md">
      <div class="week-switch">
        <button type="button" class="icon-btn" data-w="-7" aria-label="Vorige Woche">${ic('left')}</button>
        <div><b>${esc(fmt.datum(von).slice(0, 6))} – ${esc(fmt.datum(bis))}</b><small>${von <= heute && heute <= bis ? 'Diese Woche' : 'Woche'}</small></div>
        <button type="button" class="icon-btn" data-w="7" aria-label="Nächste Woche">${ic('right')}</button>
      </div>
      <div class="kpi-row two">
        <div class="kpi"><small>Stunden gesamt</small><b>${fmt.zahl(w.summe || 0)} <i>Std.</i></b></div>
        <div class="kpi"><small>davon Überstunden</small><b>${fmt.zahl(w.ueberstunden || 0)} <i>Std.</i></b></div>
      </div>
      <section class="card week-list" aria-label="Tage der Woche">
        ${tage.length ? tage.map((t) => {
          const d = fmt.dt(t.datum);
          const frei = !t.stunden && !t.code;
          return `<div class="wd${t.datum === heute ? ' today' : ''}${frei ? ' off' : ''}">
            <div class="wd-day"><b>${fmt.WTK[d.getDay()]}</b><small>${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.</small></div>
            <div class="wd-mid">${t.code ? `<span>${codeBadge(t.code)} ${esc(CODES[t.code] || t.code)}</span>` : ''}${(t.baustellen || []).length ? `<span class="wd-site">${(t.baustellen || []).map((x) => esc(bsName(x))).filter(Boolean).join(' · ')}</span>` : frei ? '<span class="wd-site">–</span>' : ''}
              ${t.stunden ? `<span class="wd-bar"><i style="width:${Math.min(100, (Math.min(t.stunden, 8) / max) * 100)}%"></i>${t.stunden > 8 ? `<u style="left:${(8 / max) * 100}%;width:${((t.stunden - 8) / max) * 100}%"></u>` : ''}</span>` : ''}</div>
            <div class="wd-std"><b>${t.stunden ? fmt.zahl(t.stunden) : '–'}</b><small>Std.</small></div>
          </div>`;
        }).join('') : `<div class="state empty">${ic('calendar')}<p>Keine Einträge in dieser Woche.</p></div>`}
      </section>
      <div class="legend-row"><span><i class="lg-n"></i>Normalstunden</span><span><i class="lg-ue"></i>über 8 Std.</span></div>
      <button type="button" class="btn ghost block" data-antrag>${ic('calendar')}Urlaub oder Zeitausgleich beantragen</button>
    </div>`;
  }
  el.addEventListener('click', async (e) => {
    const w = e.target.closest('[data-w]');
    if (w) { datum = fmt.addTage(datum, Number(w.dataset.w)); zeichne(); return; }
    if (e.target.closest('[data-antrag]')) {
      const d = dialog({
        titel: 'Abwesenheit beantragen',
        inhalt: `<form id="abw" class="stack-s">
          <label class="field"><span class="field-label">Datum</span><input class="input lg" type="date" name="datum" required value="${fmt.addTage(fmt.iso(), 1)}"></label>
          <label class="field"><span class="field-label">Art</span><select class="input lg" name="code"><option value="U">Urlaub</option><option value="ZA">Zeitausgleich</option></select></label>
          <p class="muted sm">Krankenstand und Schlechtwetter trägt das Büro bzw. der Polier ein.</p></form>`,
        fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="abw">Beantragen</button>',
      });
      $('#abw', d.el).addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const f = new FormData(ev.target);
        try { await post('/abwesenheiten', { benutzerId: ctx.ich.benutzer.id, datum: f.get('datum'), code: f.get('code') }); d.zu(); toast('Abwesenheit eingetragen.'); datum = f.get('datum'); zeichne(); }
        catch (err) { toast(err.message, 'warn'); }
      });
    }
  });
  await zeichne();
}
