// Meine Woche: Stunden je Tag, Summe, Überstunden, eigenes Wochen-Soll (15.23, ohne Modellname), Abwesenheits-Antrag (Urlaub / Zeitausgleich).
// 15.25: Stunden in Langform („9 Std. 51 Min.“) statt Dezimalzahl.
import { get } from '../api.js';
import { ic, esc, fmt, laden, fehlerBox, $ } from '../ui.js';
import { stundenSumme } from '../zahl.js';

const CODES = { K: 'Krank', U: 'Urlaub', SW: 'Schlechtwetter', ZA: 'Zeitausgleich', F: 'Feiertag', BU: 'Betriebsurlaub', abwesend: 'abwesend' };
export const codeBadge = (c) => (c ? `<span class="code-badge c-${esc(c)}" title="${esc(CODES[c] || c)}">${c === 'abwesend' ? 'abw.' : esc(c)}</span>` : '');

// Tagessumme rechts in der Zeile, zweizeilig: „9 Std.“ / „51 Min.“ (kein Wert: „–“)
const tagStd = (h) => {
  const t = typeof h === 'number' && h ? fmt.stdLang(h) : '';
  if (!t) return '<b>–</b><small>Std.</small>';
  const m = /^(−?\d+ Std\.)?\s*(\d+ Min\.)?$/.exec(t) || [];
  return m[1] ? `<b>${esc(m[1])}</b>${m[2] ? `<small>${esc(m[2])}</small>` : ''}` : `<b>${esc(t)}</b>`;
};

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
        <div class="kpi"><small>Stunden gesamt</small><b id="woche-summe">${fmt.stdLangHtml(stundenSumme((w.tage || []).map((t) => t.stunden)))}</b></div>
        <div class="kpi"><small>davon Überstunden</small><b id="woche-ue">${fmt.stdLangHtml(w.ueberstunden || 0)}</b></div>
      </div>
      ${w.sollStunden != null ? `<p class="muted sm" id="woche-soll">Soll laut Arbeitszeitmodell: ${esc(fmt.stdLang(w.sollStunden))}${w.mehrstunden ? ` · davon Mehrstunden: ${esc(fmt.stdLang(w.mehrstunden))}` : ''}</p>` : ''}
      <section class="card week-list" aria-label="Tage der Woche">
        ${tage.length ? tage.map((t) => {
          const d = fmt.dt(t.datum);
          const frei = !t.stunden && !t.code;
          return `<div class="wd${t.datum === heute ? ' today' : ''}${frei ? ' off' : ''}">
            <div class="wd-day"><b>${fmt.WTK[d.getDay()]}</b><small>${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.</small></div>
            <div class="wd-mid">${t.code ? `<span>${codeBadge(t.code)} ${esc(CODES[t.code] || t.code)}${t.codeStatus && t.codeStatus !== 'genehmigt' ? ` <span class="chip xs ${t.codeStatus === 'abgelehnt' ? 'st-red' : 'st-amber'}">${t.codeStatus === 'abgelehnt' ? 'abgelehnt' : 'beantragt'}</span>` : ''}</span>` : ''}${t.unplausibel ? '<span class="chip xs st-red">Ausstempeln fehlt – 0 Std. gezählt, bitte im Büro melden</span>' : ''}${(t.baustellen || []).length ? `<span class="wd-site">${(t.baustellen || []).map((x) => esc(bsName(x))).filter(Boolean).join(' · ')}</span>` : frei ? '<span class="wd-site">–</span>' : ''}
              ${t.stunden ? (() => { const n = typeof t.sollStd === 'number' ? t.sollStd : 8; return `<span class="wd-bar"><i data-st="width:${Math.min(100, (Math.min(t.stunden, n) / max) * 100)}%"></i>${t.stunden > n ? `<u data-st="left:${(n / max) * 100}%;width:${((t.stunden - n) / max) * 100}%"></u>` : ''}</span>`; })() : ''}</div>
            <div class="wd-std" data-tag-std="${t.datum}">${tagStd(t.stunden)}</div>
          </div>`;
        }).join('') : `<div class="state empty">${ic('calendar')}<p>Keine Einträge in dieser Woche.</p></div>`}
      </section>
      <div class="legend-row"><span><i class="lg-n"></i>Normalstunden</span><span><i class="lg-ue"></i>über der Normalzeit des Tages</span></div>
      <a class="btn ghost block" href="#/abwesenheiten">${ic('away')}Urlaub, Zeitausgleich und Abwesenheiten</a>
    </div>`;
  }
  el.addEventListener('click', async (e) => {
    const w = e.target.closest('[data-w]');
    if (w) { datum = fmt.addTage(datum, Number(w.dataset.w)); zeichne(); return; }
  });
  await zeichne();
}
