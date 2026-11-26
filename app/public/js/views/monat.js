// Monatsauswertung: Stundenmatrix je Mitarbeiter und Tag, Warnungen, CSV-Export.
// 15.23: Über- und Mehrstunden je Person nach ihrem Arbeitszeitmodell am jeweiligen Tag (Name unter der Person).
// 15.25: Stunden als Std:Min („9:51“); Schalter „Std:Min | Dezimal“ (je Gerät gemerkt) zeigt zum Abgleich mit der Lohnverrechnung
// die Dezimalzahlen wie bisher („9,85“). SW, K und U sind Tage und bleiben Zahlen. Die Exporte bleiben immer dezimal.
import { get } from '../api.js';
import { ic, esc, fmt, laden, leer, banner, speicher, $ } from '../ui.js';
import { warnText, warnTextRoh } from './stempeln.js';
import { stundenSumme } from '../zahl.js';

export const STUNDEN_FORMAT = 'bt_stunden_format';
const FORMATE = [['hm', 'Std:Min'], ['dezimal', 'Dezimal']];
const formatJetzt = () => (speicher.lies(STUNDEN_FORMAT, 'hm') === 'dezimal' ? 'dezimal' : 'hm');

/**
 * 15.25: Summen für die Std:Min-Anzeige so bilden, dass sie zu den sichtbaren Tageswerten passen. Die API summiert auf
 * 2 Dezimalstellen gerundete Tage (5 × 7,67 = 38,35 = „38:21“), sichtbar sind aber 5 × „7:40“ = „38:20“. Deshalb hier:
 * Summe (und Lohngruppen-/Modell-Abschnitte) = Summe der auf Minuten gerundeten Tage; Über- und Mehrstunden kommen aus der
 * API (Regel des Arbeitszeitmodells), auf Minuten gerundet; Normal = Summe − Über − Mehr. Im Dezimal-Modus und in allen
 * Exporten gelten unverändert die Werte der API.
 */
export function minutenSummen(m) {
  const tage = m.tage || {};
  const zwischen = (von, bis) => stundenSumme(Object.keys(tage).filter((t) => t >= von && t <= bis).map((t) => tage[t].stunden));
  const summe = stundenSumme(Object.values(tage).map((z) => z.stunden));
  const ueberstunden = stundenSumme([m.ueberstunden]), mehrstunden = stundenSumme([m.mehrstunden]);
  return {
    ...m, summe, ueberstunden, mehrstunden, normal: Math.max(0, Math.round((summe - ueberstunden - mehrstunden) * 60)) / 60,
    ...(Array.isArray(m.lohngruppen) ? { lohngruppen: m.lohngruppen.map((l) => ({ ...l, stunden: zwischen(l.von, l.bis) })) } : {}),
    ...(Array.isArray(m.arbeitszeitmodelle) ? { arbeitszeitmodelle: m.arbeitszeitmodelle.map((a) => ({ ...a, stunden: zwischen(a.von, a.bis) })) } : {})
  };
}

export default async function monat(el, ctx) {
  let ym = ctx.query.get('monat') || fmt.iso().slice(0, 7);
  const schieb = (n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

  let d = null;
  async function zeichne() {
    el.innerHTML = laden();
    d = await get(`/monat?monat=${ym}`);
    if (!ctx.aktuell()) return;
    zeige();
  }
  function zeige() {
    const fm = formatJetzt(), dez = fm === 'dezimal';
    // Stunden in Zellen/Summen (bisher fmt.zahl, 2 Stellen) und Kacheln (bisher 1 Stelle) – im Dezimal-Modus genau wie bisher
    const h = (n) => (dez ? fmt.zahl(n) : fmt.hm(n));
    const hK = (n) => (dez ? fmt.zahl(n, 1) : fmt.hm(n));
    const tage = (d.tage || []).map((t) => (typeof t === 'string' ? { datum: t } : t));
    const ma = dez ? d.mitarbeiter || [] : (d.mitarbeiter || []).map(minutenSummen);
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
        <a class="btn ghost" id="lohn-vorlagen-link" href="#/lohn-vorlagen?monat=${ym}">${ic('table')}BMD-Export (Vorlagen)</a>
        <a class="btn ghost" id="csv-buak" href="/api/monat/buak.csv?monat=${ym}" download="buak-${ym}.csv">${ic('download')}CSV BUAK-Grundlage</a>
      </div>
      ${ma.some((m) => (m.lohngruppen || []).length) ? `<section class="card pad" id="lohngruppen-wechsel" aria-label="Lohngruppenwechsel im Monat"><h3 class="sub-h">Lohngruppenwechsel in diesem Monat</h3><ul class="plain rows">${ma.filter((m) => (m.lohngruppen || []).length).map((m) => `<li><span class="grow"><b>${esc(m.name)}</b><small>${m.lohngruppen.map((l) => `${esc(l.lohngruppe || 'keine')}: ${esc(fmt.datum(l.von).slice(0, 6))}–${esc(fmt.datum(l.bis).slice(0, 6))} · ${h(l.stunden)} Std.`).join(' → ')}</small></span></li>`).join('')}</ul></section>` : ''}
      ${ma.some((m) => (m.arbeitszeitmodelle || []).length > 1) ? `<section class="card pad" id="az-wechsel" aria-label="Wechsel des Arbeitszeitmodells im Monat"><h3 class="sub-h">Wechsel des Arbeitszeitmodells in diesem Monat</h3><ul class="plain rows">${ma.filter((m) => (m.arbeitszeitmodelle || []).length > 1).map((m) => `<li><span class="grow"><b>${esc(m.name)}</b><small>${m.arbeitszeitmodelle.map((a) => `${esc(a.name || '–')}: ${esc(fmt.datum(a.von).slice(0, 6))}–${esc(fmt.datum(a.bis).slice(0, 6))} · ${h(a.stunden)} Std.`).join(' → ')}</small></span></li>`).join('')}</ul><p class="muted sm">Über- und Mehrstunden werden je Abschnitt mit dem jeweiligen Modell gerechnet.</p></section>` : ''}
      <div class="zf-zeile" id="zf-zeile"><span class="zf-l" id="zf-l">Stunden anzeigen als</span><div class="tabs zf-schalter" role="radiogroup" aria-labelledby="zf-l">${FORMATE.map(([k, t]) => `<button type="button" role="radio" data-zf="${k}" class="${fm === k ? 'on' : ''}" aria-checked="${fm === k}" tabindex="${fm === k ? 0 : -1}">${t}</button>`).join('')}</div><small class="muted zf-hinweis" id="zf-hinweis">${dez ? 'wie in der Lohnverrechnung, z. B. 9,85' : 'Stunden:Minuten, z. B. 9:51 = 9 Std. 51 Min.'}</small></div>
      <div class="kpi-row four" id="monat-kpi" data-stunden-format="${fm}">
        <div class="kpi sm"><small>Stunden gesamt</small><b id="kpi-summe">${hK(sum('summe'))}</b></div>
        <div class="kpi sm"><small>Überstunden${sum('mehrstunden') ? ' / Mehrstunden' : ''}</small><b id="kpi-ue">${hK(sum('ueberstunden'))}${sum('mehrstunden') ? ` / ${hK(sum('mehrstunden'))}` : ''}</b></div>
        <div class="kpi sm"><small>Schlechtwetter (Tage)</small><b>${fmt.zahl(sum('sw'), 1)}</b></div>
        <div class="kpi sm"><small>Krank / Urlaub (Tage)</small><b>${fmt.zahl(sum('k'), 1)} / ${fmt.zahl(sum('u'), 1)}</b></div>
      </div>
      ${(d.warnungen || []).length ? `<section class="card pad" aria-labelledby="h-warn"><div class="card-h"><h3 id="h-warn">${ic('alert')}Warnungen <span class="count red">${d.warnungen.length}</span></h3></div><ul class="warn-list">${d.warnungen.map((w) => `<li data-warn-typ="${esc((w && w.typ) || '')}">${ic('alert')}<span>${w && typeof w === 'object' && w.name ? `<b>${esc(w.name)}</b> · ` : ''}${esc(dez ? warnTextRoh(w) : warnText(w))}</span></li>`).join('')}</ul></section>` : ''}
      ${(d.offeneSchichten || []).length ? `<section class="card pad" id="offene-schichten" aria-labelledby="h-offen"><div class="card-h"><h3 id="h-offen">${ic('alert')}Offene oder unplausible Schichten <span class="count red">${d.offeneSchichten.length}</span></h3></div><ul class="warn-list">${d.offeneSchichten.map((o) => `<li>${ic('alert')}<span><b>${esc(o.name || '')}</b> · ${esc(fmt.datum(o.datum))}: ${esc(o.text || 'Ausstempeln fehlt')}${ctx.kann('stammdaten') ? ` <a class="link" href="#/korrektur?benutzerId=${o.benutzerId}&von=${o.datum}&bis=${fmt.addTage(o.datum, 2)}">Korrigieren</a>` : ''}</span></li>`).join('')}</ul><p class="muted sm">Diese Schichten zählen mit 0 Stunden, bis das Büro die Zeiten korrigiert hat.</p></section>` : ''}
      <section class="card" aria-label="Stundenmatrix ${esc(fmt.monat(ym))}">
        ${ma.length ? `<div class="tbl-wrap matrix-wrap" tabindex="0" role="region" aria-label="Stundenmatrix, horizontal scrollbar"><table class="tbl matrix"><thead><tr><th class="sticky">Mitarbeiter</th>${tage.map((t) => { const x = fmt.dt(t.datum); return `<th class="${we(t) ? 'we' : ''}"><span>${fmt.WTK[x.getDay()]}</span>${x.getDate()}</th>`; }).join('')}<th class="r">Summe</th><th class="r">Normal</th><th class="r">Üst.</th><th class="r" title="Mehrstunden (Teilzeit)">Mehr</th><th class="r" title="Schlechtwetter (Tage)">SW</th><th class="r" title="Krank (Tage)">K</th><th class="r" title="Urlaub (Tage)">U</th><th class="r" title="SEG-Stunden (Schmutz, Erschwernis, Gefahr)">SEG</th></tr></thead>
          <tbody>${ma.map((m) => `<tr data-ma="${m.id}"><th scope="row" class="sticky">${esc(m.name)}${m.arbeitszeitmodell && m.arbeitszeitmodell.name ? `<small class="muted az-modell" data-az-name>${esc(m.arbeitszeitmodell.name)}</small>` : ''}</th>${tage.map((t) => { const z = (m.tage || {})[t.datum]; return `<td class="${we(t) ? 'we' : ''}">${z ? (z.unplausibel ? '<span class="code-badge c-offen" title="Ausstempeln fehlt – 0 Std. gezählt">?</span>' : z.code ? `<span class="code-badge c-${esc(z.code)}${z.codeStatus === 'beantragt' ? ' offen' : ''}" title="${z.codeStatus === 'beantragt' ? 'beantragt – noch nicht genehmigt, zählt nicht' : ''}">${esc(z.code)}</span>${z.stunden ? `<span class="mit-std" title="Abwesenheit und Arbeitsstunden am selben Tag – bitte prüfen">+${h(z.stunden)}</span>` : ''}` : z.stunden ? h(z.stunden) : '') : ''}</td>`; }).join('')}
            <td class="r num strong" data-summe>${h(m.summe || 0)}</td><td class="r num" data-normal>${h(m.normal || 0)}</td><td class="r num${m.ueberstunden ? ' ue' : ''}" data-ue>${h(m.ueberstunden || 0)}</td><td class="r num${m.mehrstunden ? ' ue' : ''}" data-mehr>${h(m.mehrstunden || 0)}</td><td class="r num">${fmt.zahl(m.sw || 0)}</td><td class="r num">${fmt.zahl(m.k || 0)}</td><td class="r num">${fmt.zahl(m.u || 0)}</td><td class="r num" data-seg>${h(m.seg || 0)}</td></tr>`).join('')}</tbody></table></div>`
          : leer('Für diesen Monat gibt es keine Stunden.', 'table')}
      </section>
      <div class="legend-row"><span><span class="code-badge c-K">K</span> Krank</span><span><span class="code-badge c-U">U</span> Urlaub</span><span><span class="code-badge c-SW">SW</span> Schlechtwetter</span><span><span class="code-badge c-ZA">ZA</span> Zeitausgleich</span><span><span class="code-badge c-U offen">U</span> beantragt (zählt noch nicht)</span></div>
      ${banner('info', 'Die BUAK-Datei ist eine <b>Grundlage</b> – das Format ist mit BUAK bzw. Lohnverrechnung abzustimmen; sie enthält nur Personen mit dem Kennzeichen „BUAK-pflichtig“ (Benutzer &amp; Rechte). Über- und Mehrstunden rechnet die App je Person nach ihrem <b>Arbeitszeitmodell</b> am jeweiligen Tag (Stammdaten → Arbeitszeitmodelle, z. B. KV Bau: über 8 Std./Tag bzw. 39 Std./Woche; Büro: über 8,5 Std. Mo–Do bzw. 5 Std. Fr oder 39 Std./Woche; Teilzeit: bis zur Vollzeit Mehrstunden) – die Regeln sind mit der Lohnverrechnung zu bestätigen.')}
    </div>`;
  }
  function formatWahl(k) {
    if (k !== 'hm' && k !== 'dezimal') return;
    if (k !== formatJetzt()) {
      speicher.setz(STUNDEN_FORMAT, k);
      // Scrollstand der Matrix behalten – nur neu zeichnen, nicht neu laden
      const w = $('.matrix-wrap', el), x = w ? w.scrollLeft : 0;
      if (d) zeige();
      const w2 = $('.matrix-wrap', el); if (w2) w2.scrollLeft = x;
    }
    const knopf = $(`[data-zf="${k}"]`, el); if (knopf) knopf.focus();
  }
  // Radiogruppe: Pfeiltasten wechseln wie bei anderen Auswahlknöpfen
  el.addEventListener('keydown', (e) => {
    const f = e.target.closest && e.target.closest('[data-zf]');
    if (!f || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    formatWahl(f.dataset.zf === 'hm' ? 'dezimal' : 'hm');
  });
  el.addEventListener('click', (e) => {
    const f = e.target.closest('[data-zf]');
    if (f) { formatWahl(f.dataset.zf); return; }
    const b = e.target.closest('[data-m]'); if (b) { schieb(Number(b.dataset.m)); zeichne().catch((x) => { el.innerHTML = `<div class="page"><div class="card state">${ic('alert')}<p>${esc(x.message)}</p></div></div>`; }); } });
  await zeichne();
}
