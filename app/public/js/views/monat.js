// Monatsauswertung: Stundenmatrix je Mitarbeiter und Tag, Warnungen, CSV-Export.
import { get } from '../api.js';
import { ic, esc, fmt, laden, leer, banner, $ } from '../ui.js';
import { warnText } from './stempeln.js';

export default async function monat(el, ctx) {
  let ym = ctx.query.get('monat') || fmt.iso().slice(0, 7);
  const schieb = (n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

  async function zeichne() {
    el.innerHTML = laden();
    const d = await get(`/monat?monat=${ym}`);
    if (!ctx.aktuell()) return;
    const tage = (d.tage || []).map((t) => (typeof t === 'string' ? { datum: t } : t));
    const ma = d.mitarbeiter || [];
    const sum = (k) => ma.reduce((s, m) => s + (Number(m[k]) || 0), 0);
    const we = (t) => { const w = fmt.dt(t.datum).getDay(); return w === 0 || w === 6 || t.feiertag; };
    el.innerHTML = `
    <div class="page">
      <div class="toolbar">
        <div class="week-switch slim"><button type="button" class="icon-btn" data-m="-1" aria-label="Voriger Monat">${ic('left')}</button><div><b>${esc(fmt.monat(ym))}</b></div><button type="button" class="icon-btn" data-m="1" aria-label="Nächster Monat">${ic('right')}</button></div>
        <span class="grow"></span>
        ${ctx.kann('stammdaten') ? `<a class="btn ghost" id="zu-korrektur" href="#/korrektur">${ic('edit')}Zeiten korrigieren</a>` : ''}
        <a class="btn ghost" href="#/abwesenheiten">${ic('away')}Abwesenheiten</a>
        <a class="btn ghost" id="csv-lohn" href="/api/monat/export.csv?monat=${ym}" download="lohn-${ym}.csv">${ic('download')}CSV Lohnverrechnung</a>
        <a class="btn ghost" id="csv-buak" href="/api/monat/buak.csv?monat=${ym}" download="buak-${ym}.csv">${ic('download')}CSV BUAK-Grundlage</a>
      </div>
      <div class="kpi-row four">
        <div class="kpi sm"><small>Stunden gesamt</small><b>${fmt.zahl(sum('summe'), 1)}</b></div>
        <div class="kpi sm"><small>Überstunden</small><b>${fmt.zahl(sum('ueberstunden'), 1)}</b></div>
        <div class="kpi sm"><small>Schlechtwetter</small><b>${fmt.zahl(sum('sw'), 1)}</b></div>
        <div class="kpi sm"><small>Krank / Urlaub</small><b>${fmt.zahl(sum('k'), 1)} / ${fmt.zahl(sum('u'), 1)}</b></div>
      </div>
      ${(d.warnungen || []).length ? `<section class="card pad" aria-labelledby="h-warn"><div class="card-h"><h3 id="h-warn">${ic('alert')}Warnungen <span class="count red">${d.warnungen.length}</span></h3></div><ul class="warn-list">${d.warnungen.map((w) => `<li>${ic('alert')}<span>${w && typeof w === 'object' && w.name ? `<b>${esc(w.name)}</b> · ` : ''}${esc(warnText(w))}</span></li>`).join('')}</ul></section>` : ''}
      ${(d.offeneSchichten || []).length ? `<section class="card pad" id="offene-schichten" aria-labelledby="h-offen"><div class="card-h"><h3 id="h-offen">${ic('alert')}Offene oder unplausible Schichten <span class="count red">${d.offeneSchichten.length}</span></h3></div><ul class="warn-list">${d.offeneSchichten.map((o) => `<li>${ic('alert')}<span><b>${esc(o.name || '')}</b> · ${esc(fmt.datum(o.datum))}: ${esc(o.text || 'Ausstempeln fehlt')}${ctx.kann('stammdaten') ? ` <a class="link" href="#/korrektur?benutzerId=${o.benutzerId}&von=${o.datum}&bis=${fmt.addTage(o.datum, 2)}">Korrigieren</a>` : ''}</span></li>`).join('')}</ul><p class="muted sm">Diese Schichten zählen mit 0 Stunden, bis das Büro die Zeiten korrigiert hat.</p></section>` : ''}
      <section class="card" aria-label="Stundenmatrix ${esc(fmt.monat(ym))}">
        ${ma.length ? `<div class="tbl-wrap matrix-wrap" tabindex="0" role="region" aria-label="Stundenmatrix, horizontal scrollbar"><table class="tbl matrix"><thead><tr><th class="sticky">Mitarbeiter</th>${tage.map((t) => { const x = fmt.dt(t.datum); return `<th class="${we(t) ? 'we' : ''}"><span>${fmt.WTK[x.getDay()]}</span>${x.getDate()}</th>`; }).join('')}<th class="r">Summe</th><th class="r">Normal</th><th class="r">Üst.</th><th class="r">SW</th><th class="r">K</th><th class="r">U</th><th class="r">SEG</th></tr></thead>
          <tbody>${ma.map((m) => `<tr><th scope="row" class="sticky">${esc(m.name)}</th>${tage.map((t) => { const z = (m.tage || {})[t.datum]; return `<td class="${we(t) ? 'we' : ''}${z && z.stunden > 10 ? ' hot' : ''}">${z ? (z.unplausibel ? '<span class="code-badge c-offen" title="Ausstempeln fehlt – 0 Std. gezählt">?</span>' : z.code ? `<span class="code-badge c-${esc(z.code)}${z.codeStatus === 'beantragt' ? ' offen' : ''}" title="${z.codeStatus === 'beantragt' ? 'beantragt – noch nicht genehmigt, zählt nicht' : ''}">${esc(z.code)}</span>` : z.stunden ? fmt.zahl(z.stunden) : '') : ''}</td>`; }).join('')}
            <td class="r num strong">${fmt.zahl(m.summe || 0)}</td><td class="r num">${fmt.zahl(m.normal || 0)}</td><td class="r num${m.ueberstunden ? ' ue' : ''}">${fmt.zahl(m.ueberstunden || 0)}</td><td class="r num">${fmt.zahl(m.sw || 0)}</td><td class="r num">${fmt.zahl(m.k || 0)}</td><td class="r num">${fmt.zahl(m.u || 0)}</td><td class="r num">${fmt.zahl(m.seg || 0)}</td></tr>`).join('')}</tbody></table></div>`
          : leer('Für diesen Monat gibt es keine Stunden.', 'table')}
      </section>
      <div class="legend-row"><span><span class="code-badge c-K">K</span> Krank</span><span><span class="code-badge c-U">U</span> Urlaub</span><span><span class="code-badge c-SW">SW</span> Schlechtwetter</span><span><span class="code-badge c-ZA">ZA</span> Zeitausgleich</span><span><span class="code-badge c-U offen">U</span> beantragt (zählt noch nicht)</span><span><i class="lg-hot"></i>über 10 Std.</span></div>
      ${banner('info', 'Die BUAK-Datei ist eine <b>Grundlage</b> – das Format ist mit BUAK bzw. Lohnverrechnung abzustimmen. Überstunden-Regel (über 8 Std./Tag bzw. 39 Std./Woche) ist eine Annahme und zu prüfen.')}
    </div>`;
  }
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (b) { schieb(Number(b.dataset.m)); zeichne().catch((x) => { el.innerHTML = `<div class="page"><div class="card state">${ic('alert')}<p>${esc(x.message)}</p></div></div>`; }); } });
  await zeichne();
}
