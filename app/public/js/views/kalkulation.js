// Nachkalkulation & Budget: Übersicht aller Baustellen und Detail je Baustelle.
import { get, post, del } from '../api.js';
import { ic, esc, fmt, parseZahl, geldFelder, geldWert, leer, banner, dialog, bestaetigen, toast, kalkChip, $, $$ } from '../ui.js';

const FARBE = { lohn: '#3b6fd4', geraete: '#e08a1e', material: '#2a9d8f', fremd: '#8b5fbf' };
const KTXT = { lohn: 'Lohn', geraete: 'Geräte', material: 'Material', fremd: 'Fremdleistungen' };

/* Budget-Balken: Verbrauch (Kosten) gegen Leistungsstand, mit Schwellen-Marken */
export function budgetBalken(k, klein = false) {
  const v = k.budgetVerbrauchProzent, l = k.leistungsstandProzent;
  if (v == null) return `<div class="bud none"><span class="muted sm">Keine Auftragssumme erfasst</span></div>`;
  const max = Math.max(110, Math.min(160, Math.ceil((v + 5) / 10) * 10));
  const x = (p) => Math.min(100, (p / max) * 100);
  const st = k.status || 'ok';
  return `<div class="bud ${klein ? 'sm' : ''} s-${esc(st)}" role="img" aria-label="Budget-Verbrauch ${fmt.pct(v)}, Leistungsstand ${fmt.pct(l)}">
    <div class="bud-track"><i class="bud-fill" data-st="width:${x(v)}%"></i>${l != null ? `<i class="bud-leist" data-st="left:${x(l)}%" title="Leistungsstand ${fmt.pct(l)}"></i>` : ''}
      ${(k.schwellen || [80, 90, 100]).map((s) => `<i class="bud-mark${v >= s ? ' hit' : ''}" data-st="left:${x(s)}%"></i>`).join('')}</div>
    ${klein ? '' : `<div class="bud-scale">${(k.schwellen || [80, 90, 100]).map((s) => `<span data-st="left:${x(s)}%">${s}</span>`).join('')}</div>`}
  </div>`;
}

/* =================== Übersicht =================== */
export async function kalkUebersicht(el, ctx) {
  const roh = await get('/kalkulation');
  const liste = Array.isArray(roh) ? roh : roh.baustellen || [];
  el.innerHTML = `<div class="page">
    ${liste.length ? `<div class="kalk-cards">${liste.map((k) => {
      const b = k.baustelle || k;
      const id = b.id ?? k.baustelleId;
      return `<a class="card pad kalk-card" href="#/kalkulation/${id}" data-status="${esc(k.status || '')}">
        <div class="kc-h"><div><small>${esc(b.kst || '')}</small><b>${esc(b.name || '')}</b></div>${kalkChip(k.status)}</div>
        ${budgetBalken(k, true)}
        <dl class="kc-kpi"><div><dt>Budget verbraucht</dt><dd>${fmt.pct(k.budgetVerbrauchProzent)}</dd></div><div><dt>Leistungsstand</dt><dd>${fmt.pct(k.leistungsstandProzent)}</dd></div>
        <div><dt>Kosten</dt><dd>${fmt.eur0(k.kosten && typeof k.kosten === 'object' ? k.kosten.gesamt : k.kosten)}</dd></div><div><dt>Auftrag gesamt</dt><dd>${fmt.eur0(k.auftragGesamt)}</dd></div></dl>
      </a>`;
    }).join('')}</div>` : `<div class="card">${leer('Keine Baustellen mit Nachkalkulation vorhanden.', 'chart')}</div>`}
  </div>`;
}

/* =================== Verlauf: Kosten und Erlös kumuliert (Inline-SVG) =================== */
let chartDaten = null; // Geometrie des zuletzt gezeichneten Diagramms (kein Inline-Skript nötig, M-06)
function verlaufChart(verlauf, auftragGesamt) {
  if (!verlauf || !verlauf.length) return leer('Noch kein Verlauf – es gibt noch keine abgeschlossenen Berichte.', 'chart');
  const W = 720, H = 260, L = 58, R = 76, T = 16, B = 30;
  const pts = verlauf.length === 1 ? [{ datum: verlauf[0].datum, kosten: 0, erloes: 0, null: true }, ...verlauf] : verlauf;
  const maxY = Math.max(1, ...pts.map((p) => Math.max(p.kosten, p.erloes)), auftragGesamt && auftragGesamt < Math.max(...pts.map((p) => p.kosten)) * 1.6 ? auftragGesamt : 0);
  const stufe = (() => { const roh = maxY / 4, p = Math.pow(10, Math.floor(Math.log10(roh))); return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= roh) || roh; })();
  const top = Math.ceil(maxY / stufe) * stufe;
  const x = (i) => L + (pts.length === 1 ? 0 : (i / (pts.length - 1)) * (W - L - R));
  const y = (v) => T + (1 - v / top) * (H - T - B);
  const linie = (key) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(' ');
  const kurz = (v) => (v >= 1000 ? fmt.zahl(v / 1000, 1) + '\u00a0T€' : fmt.zahl(v, 0) + '\u00a0€');
  const letzter = pts[pts.length - 1];
  let yK = y(letzter.kosten), yE = y(letzter.erloes);
  if (Math.abs(yK - yE) < 14) { if (yK < yE) { yK -= 7; yE += 7; } else { yK += 7; yE -= 7; } }
  const ticks = []; for (let v = 0; v <= top + 1e-9; v += stufe) ticks.push(v);
  const nX = Math.min(pts.length, 6);
  const xIdx = [...new Set(Array.from({ length: nX }, (_, i) => Math.round((i / Math.max(1, nX - 1)) * (pts.length - 1))))];
  chartDaten = { pts, L, R, T, B, W, H, top };
  return `<figure class="chart" data-chart>
    <div class="legend-row" aria-hidden="true"><span><i class="lg-line" data-st="background:${FARBE.geraete}"></i>Kosten (kumuliert)</span><span><i class="lg-line" data-st="background:${FARBE.lohn}"></i>Erlös (kumuliert)</span>${auftragGesamt && auftragGesamt <= top ? '<span><i class="lg-dash"></i>Auftragssumme gesamt</span>' : ''}</div>
    <div class="chart-box"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Verlauf von Kosten und Erlös, kumuliert. Zuletzt Kosten ${fmt.eur0(letzter.kosten)}, Erlös ${fmt.eur0(letzter.erloes)}." preserveAspectRatio="xMidYMid meet">
      ${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" class="ax">${kurz(v)}</text>`).join('')}
      ${xIdx.map((i) => `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="ax">${fmt.datum(pts[i].datum).slice(0, 6)}</text>`).join('')}
      ${auftragGesamt && auftragGesamt <= top ? `<line x1="${L}" x2="${W - R}" y1="${y(auftragGesamt)}" y2="${y(auftragGesamt)}" class="soll"/>` : ''}
      <path d="${linie('erloes')}" fill="none" stroke="${FARBE.lohn}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <path d="${linie('kosten')}" fill="none" stroke="${FARBE.geraete}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${x(pts.length - 1)}" cy="${y(letzter.erloes)}" r="4" fill="${FARBE.lohn}" stroke="#fff" stroke-width="2"/>
      <circle cx="${x(pts.length - 1)}" cy="${y(letzter.kosten)}" r="4" fill="${FARBE.geraete}" stroke="#fff" stroke-width="2"/>
      <text x="${W - R + 10}" y="${yK + 4}" class="lbl">Kosten</text><text x="${W - R + 10}" y="${yE + 4}" class="lbl">Erlös</text>
      <g class="hover" hidden><line class="cross" y1="${T}" y2="${H - B}"/><circle r="4.500" fill="${FARBE.geraete}" stroke="#fff" stroke-width="2" class="hk"/><circle r="4.500" fill="${FARBE.lohn}" stroke="#fff" stroke-width="2" class="he"/></g>
      <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" class="hit" tabindex="0" aria-label="Verlauf: mit dem Zeiger oder den Pfeiltasten Werte je Tag ablesen"/>
    </svg><div class="chart-tip" hidden></div></div>
    <details class="chart-table"><summary>Werte als Tabelle</summary><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Datum</th><th class="r">Kosten kumuliert</th><th class="r">Erlös kumuliert</th></tr></thead><tbody>${verlauf.map((p) => `<tr><td>${fmt.datum(p.datum)}</td><td class="r num">${fmt.eur(p.kosten)}</td><td class="r num">${fmt.eur(p.erloes)}</td></tr>`).join('')}</tbody></table></div></details>
  </figure>`;
}
function chartHover(fig) {
  const d = chartDaten, svg = $('svg', fig), tip = $('.chart-tip', fig), g = $('.hover', fig), hit = $('.hit', fig);
  const x = (i) => d.L + (d.pts.length === 1 ? 0 : (i / (d.pts.length - 1)) * (d.W - d.L - d.R));
  const y = (v) => d.T + (1 - v / d.top) * (d.H - d.T - d.B);
  let akt = d.pts.length - 1;
  const zeig = (i) => {
    akt = Math.max(0, Math.min(d.pts.length - 1, i));
    const p = d.pts[akt];
    g.removeAttribute('hidden');
    $('.cross', g).setAttribute('x1', x(akt)); $('.cross', g).setAttribute('x2', x(akt));
    $('.hk', g).setAttribute('cx', x(akt)); $('.hk', g).setAttribute('cy', y(p.kosten));
    $('.he', g).setAttribute('cx', x(akt)); $('.he', g).setAttribute('cy', y(p.erloes));
    tip.hidden = false;
    tip.innerHTML = `<b>${p.null ? 'Beginn' : fmt.datum(p.datum)}</b><span><i data-st="background:${FARBE.geraete}"></i>Kosten <b>${fmt.eur(p.kosten)}</b></span><span><i data-st="background:${FARBE.lohn}"></i>Erlös <b>${fmt.eur(p.erloes)}</b></span>`;
    const r = svg.getBoundingClientRect(), px = (x(akt) / d.W) * r.width;
    tip.style.left = Math.max(0, Math.min(r.width - tip.offsetWidth, px + (px > r.width / 2 ? -tip.offsetWidth - 12 : 12))) + 'px';
  };
  const weg = () => { g.setAttribute('hidden', ''); tip.hidden = true; };
  hit.addEventListener('pointermove', (e) => { const r = svg.getBoundingClientRect(); const sx = ((e.clientX - r.left) / r.width) * d.W; zeig(Math.round(((sx - d.L) / (d.W - d.L - d.R)) * (d.pts.length - 1))); });
  hit.addEventListener('pointerleave', weg);
  hit.addEventListener('focus', () => zeig(akt));
  hit.addEventListener('blur', weg);
  hit.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') { zeig(akt - 1); e.preventDefault(); } if (e.key === 'ArrowRight') { zeig(akt + 1); e.preventDefault(); } });
}

/* =================== Detail =================== */
export async function kalkDetail(el, ctx) {
  const id = ctx.params[0];
  const k = await get(`/kalkulation/${id}`);
  const b = k.baustelle || {};
  const darfMelden = ctx.kann('preise_bearbeiten') || (ctx.kann('kalk_sehen') && (ctx.ich.baustellenIds || []).map(String).includes(String(id)));
  ctx.titel('Nachkalkulation', `${b.kst ? b.kst + ' · ' : ''}${b.name || ''}`);
  const kosten = k.kosten || {};
  const teile = ['lohn', 'geraete', 'material', 'fremd'].map((key) => ({ key, wert: kosten[key] || 0 })).filter((t) => t.wert > 0);
  const pos = k.positionen || {};
  const H_ICON = { alarm: 'alert', kritisch: 'alert', warnung: 'alert', info: 'info' };
  const H_ART = { alarm: 'err', kritisch: 'err', warnung: 'warn', info: 'info' };
  const posTab = (titel, key, zeilen, mengeFeld, einheit) => `
    <details class="pos" ${zeilen.length ? '' : 'data-leer'}><summary><i class="sw" data-st="background:${FARBE[key]}"></i><span>${titel}</span><b class="num">${fmt.eur(kosten[key] || 0)}</b>${ic('down')}</summary>
    ${zeilen.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Position</th><th class="r">Menge</th><th class="r">Satz</th><th class="r">Betrag</th></tr></thead><tbody>${zeilen.map((z) => `<tr><td>${esc(z.name || z.text || '')}${z.datum ? ` <small class="muted">${fmt.datum(z.datum)}</small>` : ''}</td><td class="r num">${mengeFeld && z[mengeFeld] != null ? fmt.zahl(z[mengeFeld]) + '\u00a0' + esc(z.einheit || einheit || '') : ''}</td><td class="r num">${z.satz != null ? fmt.eur(z.satz) : ''}</td><td class="r num">${fmt.eur(z.betrag)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted sm pad-s">Keine Positionen.</p>'}</details>`;

  el.innerHTML = `
  <div class="page">
    <div class="form-top"><a class="link-back" href="#/kalkulation">${ic('left')}Alle Baustellen</a><span class="grow"></span>${kalkChip(k.status)}
      <a class="btn ghost sm" href="#/baustelle/${id}">${ic('pin')}Baustelle &amp; Auftrag</a></div>
    <div class="kpi-row four">
      <div class="kpi"><small>Auftrag gesamt</small><b>${fmt.eur0(k.auftragGesamt)}</b><em>${k.auftragssumme != null ? `Auftrag ${fmt.eur0(k.auftragssumme)}` : 'nicht erfasst'}${(k.nachtraege || []).length ? ` + ${k.nachtraege.length} Nachtr.` : ''}</em></div>
      <div class="kpi" data-kpi="kosten"><small>Kosten bisher</small><b>${fmt.eur0(kosten.gesamt)}</b><em>${fmt.pct(k.budgetVerbrauchProzent)} vom Auftrag</em></div>
      <div class="kpi"><small>Erlös bisher</small><b>${fmt.eur0(k.erloes)}</b><em>Leistungsstand ${fmt.pct(k.leistungsstandProzent)}</em></div>
      <div class="kpi"><small>Deckungsbeitrag</small><b class="${k.db < 0 ? 'neg' : ''}">${fmt.eur0(k.db)}</b><em>${k.dbProzent != null ? fmt.pct(k.dbProzent) + ' vom Erlös' : 'noch kein Erlös'}</em></div>
    </div>
    <section class="card pad" aria-labelledby="h-bud">
      <div class="card-h"><h3 id="h-bud">Budget</h3><span class="muted sm">Kosten gegen Auftragssumme, Strich = Leistungsstand</span></div>
      ${budgetBalken(k)}
      <div class="two-stats"><div><small>Budget verbraucht</small><b data-wert="verbrauch">${fmt.pct(k.budgetVerbrauchProzent)}</b></div><div><small>Leistungsstand</small><b>${fmt.pct(k.leistungsstandProzent)}</b></div></div>
    </section>
    ${(k.hinweise || []).length ? `<div class="stack-s" aria-label="Hinweise">${k.hinweise.map((h) => banner(H_ART[h.typ] || 'info', esc(h.text), H_ICON[h.typ])).join('')}</div>` : ''}
    <div class="two-col">
      <section class="card pad" aria-labelledby="h-kost">
        <div class="card-h"><h3 id="h-kost">Kosten nach Art</h3><b class="num" data-wert="kosten-gesamt">${fmt.eur(kosten.gesamt)}</b></div>
        ${teile.length ? `<div class="stackbar" role="img" aria-label="${teile.map((t) => `${KTXT[t.key]} ${fmt.eur0(t.wert)}`).join(', ')}">${teile.map((t) => `<i data-st="flex:${t.wert};background:${FARBE[t.key]}" title="${KTXT[t.key]}: ${fmt.eur(t.wert)}"></i>`).join('')}</div>` : ''}
        ${posTab('Lohn', 'lohn', pos.lohn || [], 'stunden', 'Std.')}
        ${posTab('Geräte', 'geraete', pos.geraete || [], 'stunden', 'Std.')}
        ${posTab('Material', 'material', pos.material || [], 'menge', '')}
        ${posTab('Fremdleistungen', 'fremd', pos.fremd || [], null, '')}
        ${darfMelden ? `<button type="button" class="btn ghost sm" data-akt="fremd">${ic('plus')}Fremdleistung erfassen</button>` : ''}
      </section>
      <section class="card pad" aria-labelledby="h-erl">
        <div class="card-h"><h3 id="h-erl">Erlös</h3><b class="num">${fmt.eur(k.erloes)}</b></div>
        ${(pos.leistungen || []).length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Leistung</th><th class="r">Menge</th><th class="r">EP</th><th class="r">Betrag</th></tr></thead><tbody>${pos.leistungen.map((z) => `<tr><td>${esc(z.text || '')}</td><td class="r num">${fmt.zahl(z.menge)}\u00a0${esc(z.einheit || '')}</td><td class="r num">${fmt.eur(z.ep)}</td><td class="r num">${fmt.eur(z.betrag)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted sm">Noch keine Leistungsmeldung.</p>'}
        ${pos.regie && pos.regie.stunden ? `<p class="sm">Regie: ${fmt.std(pos.regie.stunden)} × ${fmt.eur(pos.regie.satz)} = <b>${fmt.eur(pos.regie.betrag)}</b></p>` : ''}
        ${darfMelden ? `<button type="button" class="btn ghost sm" data-akt="leistung">${ic('plus')}Leistung melden</button>` : ''}
        ${(k.nachtraege || []).length ? `<h4 class="sub-h">Nachträge</h4><ul class="plain">${k.nachtraege.map((n) => `<li><span>${esc(n.text)}</span><b class="num">${fmt.eur(n.betrag)}</b></li>`).join('')}</ul>` : ''}
      </section>
    </div>
    <section class="card pad" aria-labelledby="h-verl"><div class="card-h"><h3 id="h-verl">Verlauf</h3></div>${verlaufChart(k.verlauf, k.auftragGesamt)}</section>
  </div>`;
  const fig = $('[data-chart]', el); if (fig) chartHover(fig);

  el.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-akt]'); if (!a) return;
    if (a.dataset.akt === 'fremd') {
      const d = dialog({ titel: 'Fremdleistung erfassen', inhalt: `<form id="ff" class="stack-s">
        <label class="field"><span class="field-label">Bezeichnung</span><input class="input lg" name="text" required maxlength="200" placeholder="z. B. Asphaltierung Subunternehmer"></label>
        <label class="field"><span class="field-label">Betrag in Euro (netto)</span><input class="input lg num" name="betrag" data-geld inputmode="decimal" autocomplete="off" required placeholder="0,00"></label>
        <label class="field"><span class="field-label">Datum</span><input class="input lg" type="date" name="datum" required value="${fmt.iso()}"></label><p class="form-err" role="alert" hidden></p></form>`,
        fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="ff">Speichern</button>' });
      geldFelder(d.el);
      $('#ff', d.el).addEventListener('submit', async (ev) => {
        ev.preventDefault(); const f = new FormData(ev.target); const betrag = geldWert(ev.target.elements.betrag);
        const err = $('.form-err', d.el);
        if (!Number.isFinite(betrag) || betrag <= 0) { err.hidden = false; err.textContent = 'Betrag unklar – bitte so schreiben: 12.500,00'; ev.target.elements.betrag.focus(); return; }
        try { await post(`/baustellen/${id}/fremdleistungen`, { text: f.get('text'), betrag, datum: f.get('datum') }); d.zu(); toast('Fremdleistung erfasst.'); ctx.neuLaden(); }
        catch (x) { err.hidden = false; err.textContent = x.message; }
      });
    } else if (a.dataset.akt === 'leistung') {
      let leistungen = [];
      try { leistungen = (await get('/preise')).leistungen || []; } catch (x) { toast(x.message, 'warn'); return; }
      const d = dialog({ titel: 'Leistung melden', inhalt: `<form id="lf" class="stack-s">
        <label class="field"><span class="field-label">Leistung</span><select class="input lg" name="leistungId" required>${leistungen.map((l) => `<option value="${l.id}">${esc((l.code ? l.code + ' · ' : '') + l.text)} (${esc(l.einheit)})</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Menge</span><input class="input lg num" name="menge" inputmode="decimal" required placeholder="0"></label>
        <label class="field"><span class="field-label">Datum</span><input class="input lg" type="date" name="datum" required value="${fmt.iso()}"></label><p class="form-err" role="alert" hidden></p></form>`,
        fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="lf">Melden</button>' });
      $('#lf', d.el).addEventListener('submit', async (ev) => {
        ev.preventDefault(); const f = new FormData(ev.target); const menge = parseZahl(f.get('menge'));
        const err = $('.form-err', d.el);
        if (!isFinite(menge) || menge <= 0) { err.hidden = false; err.textContent = 'Menge unklar – bitte so schreiben: 1.250,5'; ev.target.elements.menge.focus(); return; }
        const lid = f.get('leistungId');
        try { await post(`/baustellen/${id}/leistungen`, { leistungId: /^\d+$/.test(lid) ? Number(lid) : lid, menge, datum: f.get('datum') }); d.zu(); toast('Leistung gemeldet.'); ctx.neuLaden(); ctx.meldungenNeu(); }
        catch (x) { err.hidden = false; err.textContent = x.message; }
      });
    }
  });
}
