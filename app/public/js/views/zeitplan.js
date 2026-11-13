// Projektzeitplan (API.md 12.8): Bauvorhaben über Kalenderwochen mit Abschnitten (Erdbau, Kanal …) und Meilensteinen.
// Abschnitte lassen sich ziehen (Maus/Finger) oder über den Dialog mit Datum verschieben. Keine Preise.
import { get, post, put, del } from '../api.js';
import { ic, esc, fmt, leer, dialog, bestaetigen, toast, $ } from '../ui.js';
import { ziehbar } from '../ziehen.js';
import { PHASEN, phaseText } from './lebenslauf.js';

const WOCHEN = 16;
const ARTEN = { erdbau: 'Erdbau', kanal: 'Kanal', unterbau: 'Unterbau', pflaster: 'Pflaster', asphalt: 'Asphalt', eigen: 'Eigener Abschnitt' };
const MEILEN = { fertiggestellt: 'Fertig', abgenommen: 'Abnahme', schlussrechnung: 'Schlussrechn.', bezahlt: 'Bezahlt', gewaehrleistung: 'Gewährl.' };
const kwNr = (iso) => { const d = fmt.dt(iso); const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const n = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - n); const j = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - j) / 86400000 + 1) / 7); };
const tageZw = (a, b) => Math.round((fmt.dt(b) - fmt.dt(a)) / 86400000);
const wIdx = (von, iso) => Math.floor(tageZw(von, iso) / 7);

export async function zeitplanLaden(zp) {
  zp.bis = fmt.addTage(zp.von, WOCHEN * 7 - 1);
  zp.daten = await get(`/plan/zeitplan?von=${zp.von}&bis=${zp.bis}${zp.phase ? '&phase=' + zp.phase : ''}`);
}
const darfBv = (ctx, id) => ['buero', 'bauleiter', 'gf'].includes(ctx.ich.benutzer.rolle) || ctx.kann('stammdaten') || (ctx.ich.benutzer.rolle === 'bauleiter' && (ctx.ich.baustellenIds || []).map(Number).includes(Number(id)));

export function zeitplanHtml(zp, ctx) {
  const d = zp.daten || { bauvorhaben: [], filter: {}, archivAnzahl: 0 };
  const wochen = Array.from({ length: WOCHEN }, (_, i) => fmt.addTage(zp.von, i * 7));
  const jetzt = wIdx(zp.von, fmt.iso());
  const balken = (a, schreib) => {
    let s = wIdx(zp.von, a.von), e = wIdx(zp.von, a.bis);
    if (e < 0 || s >= WOCHEN) return '';
    s = Math.max(0, s); e = Math.min(WOCHEN - 1, e);
    const name = a.name || ARTEN[a.art] || 'Abschnitt';
    return `<button type="button" class="zp-balken art-${esc(a.art)}" ${schreib ? 'data-zieh' : ''} data-abschnitt="${a.id}" data-start="${s}" data-st="grid-column:${s + 1} / span ${e - s + 1}" aria-label="${esc(name)}: ${esc(fmt.datumKurz(a.von))} bis ${esc(fmt.datumKurz(a.bis))}${schreib ? ' – bearbeiten' : ''}">${esc(name)}</button>`;
  };
  const meile = (m) => { const i = wIdx(zp.von, m.datum); if (i < 0 || i >= WOCHEN || !m.datum) return ''; return `<span class="zp-meile${m.erreicht ? ' erreicht' : ''}" data-meilenstein="${esc(m.art)}" data-st="grid-column:${i + 1}" title="${esc(MEILEN[m.art] || m.art)} ${esc(fmt.datumKurz(m.datum))}${m.erreicht ? '' : ' (geplant)'}">${esc(MEILEN[m.art] || m.art)}</span>`; };
  return `<div class="stack zp" id="zeitplan">
    <header class="wp-header"><p class="muted">Alle Bauvorhaben über die Saison – Abschnitte verschieben, Abnahme und Schlussrechnung im Blick.</p>
      <div class="wp-aktionen"><a class="btn ghost" id="zp-archiv" href="#/baustellen/archiv">Archiv · ${d.archivAnzahl ?? 0} abgeschlossen</a>${ctx.kann('stammdaten') ? `<a class="btn primary" href="#/baustellen?neu=1">${ic('plus')}Bauvorhaben</a>` : ''}</div></header>
    <div class="chip-row" aria-label="Status-Filter"><button type="button" class="chip-btn${zp.phase ? '' : ' on'}" data-zp-phase="">Alle</button>${Object.keys(PHASEN).filter((k) => (d.filter || {})[k] != null && !['archiviert', 'storniert', 'angebot'].includes(k) || k === zp.phase).map((k) => `<button type="button" class="chip-btn${zp.phase === k ? ' on' : ''}" data-zp-phase="${k}">${esc(phaseText(k))} <span>${(d.filter || {})[k] ?? 0}</span></button>`).join('')}</div>
    <section class="card zp-karte" aria-label="Zeitplan ${esc(fmt.datumKurz(zp.von))} bis ${esc(fmt.datumKurz(zp.bis))}">
      <div class="wp-kopf"><div class="wp-nav"><button type="button" class="icon-btn" data-zp-weiter="-28" aria-label="Vier Wochen zurück">${ic('left')}</button><b>KW ${kwNr(zp.von)}–${kwNr(wochen[WOCHEN - 1])} · ${esc(fmt.datumKurz(zp.von))} – ${esc(fmt.datum(zp.bis))}</b><button type="button" class="icon-btn" data-zp-weiter="28" aria-label="Vier Wochen vor">${ic('right')}</button></div></div>
      <div class="wp-scroll" data-zieh-scroll><div class="zp-gitter" role="table">
        <div class="zp-zeile kopf" role="row"><div class="zp-name" role="columnheader">Bauvorhaben · Status</div><div class="zp-spur">${wochen.map((w, i) => `<span class="zp-kw${i === jetzt ? ' jetzt' : ''}" role="columnheader">${i === 0 || kwNr(w) === 1 ? 'KW ' : ''}${kwNr(w)}</span>`).join('')}</div></div>
        ${d.bauvorhaben.length ? d.bauvorhaben.map((p) => { const b = p.baustelle, schreib = darfBv(ctx, b.id); return `<div class="zp-zeile" role="row" data-bv="${b.id}">
          <div class="zp-name" role="rowheader"><a href="#/baustelle/${b.id}"><b>${esc(b.name)}</b></a><small>KST ${esc(b.kst || '–')} · <b data-phase="${esc(b.phase)}">${esc(phaseText(b.phase))}</b>${b.leistungsstandProzent != null ? ' · ' + fmt.pct(b.leistungsstandProzent) : ''}</small>${schreib ? `<button type="button" class="btn ghost sm" data-abschnitt-neu="${b.id}">${ic('plus', 'xs')}Abschnitt</button>` : ''}</div>
          <div class="zp-spur" data-spur="${b.id}">${wochen.map((w, i) => `<i class="zp-zelle${i === jetzt ? ' jetzt' : ''}" data-kw-zelle="${i}" data-bv="${b.id}" data-st="grid-column:${i + 1}"></i>`).join('')}${(p.abschnitte || []).map((a) => balken(a, schreib)).join('')}${(p.meilensteine || []).map(meile).join('')}</div></div>`; }).join('') : `<div class="pad">${leer('Keine Bauvorhaben in diesem Zeitraum.', 'calendar')}</div>`}
      </div></div>
    </section>
    <div class="legend-row zp-legende">${Object.entries(ARTEN).filter(([k]) => k !== 'eigen').map(([k, t]) => `<span><i class="zp-leg art-${k}"></i>${t}</span>`).join('')}<span><i class="zp-leg art-ok"></i>Abnahme / Rechnung</span></div>
  </div>`;
}

export function zeitplanBinden(el, ctx, holZp, neu) {
  const finde = (aid) => { const zp = holZp(); for (const p of (zp && zp.daten && zp.daten.bauvorhaben) || []) { const a = (p.abschnitte || []).find((x) => Number(x.id) === Number(aid)); if (a) return { a, b: p.baustelle }; } return null; };
  function abschnittDialog(bsId, a) {
    const zp = holZp();
    const dlg = dialog({ titel: a ? 'Abschnitt bearbeiten' : 'Neuer Abschnitt', inhalt: `<form id="zpf" class="form-grid" novalidate>
      <label class="field"><span class="field-label">Art</span><select class="input lg" name="art">${Object.entries(ARTEN).map(([k, t]) => `<option value="${k}" ${a && a.art === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="field"><span class="field-label">Bezeichnung (optional)</span><input class="input lg" name="name" maxlength="80" value="${esc((a && a.name) || '')}"></label>
      <label class="field"><span class="field-label">Von</span><input class="input lg" type="date" name="von" required value="${a ? a.von : zp.von}"></label>
      <label class="field"><span class="field-label">Bis</span><input class="input lg" type="date" name="bis" required value="${a ? a.bis : fmt.addTage(zp.von, 13)}"></label>
      <p class="form-err full" role="alert" hidden></p></form>`,
      fuss: `${a ? '<button class="btn danger" type="button" id="zp-weg">Löschen</button><span class="grow"></span>' : ''}<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="zpf">Speichern</button>` });
    $('#zpf', dlg.el).addEventListener('submit', async (ev) => {
      ev.preventDefault(); const f = new FormData(ev.target); const err = $('.form-err', dlg.el);
      const name = String(f.get('name') || '').trim();
      const body = { art: f.get('art'), name: name || ARTEN[f.get('art')] || 'Abschnitt', von: f.get('von'), bis: f.get('bis') };
      if (!body.von || !body.bis || body.bis < body.von) { err.hidden = false; err.textContent = 'Bitte Von und Bis eintragen – Bis darf nicht vor Von liegen.'; return; }
      try { if (a) await put(`/baustellen/${bsId}/abschnitte/${a.id}`, { ...body, version: a.version }); else await post(`/baustellen/${bsId}/abschnitte`, body); dlg.zu(); toast('Gespeichert.'); neu(); }
      catch (x) { err.hidden = false; err.textContent = x.status === 409 ? 'Inzwischen geändert – bitte schließen und erneut öffnen.' : x.message; }
    });
    const weg = $('#zp-weg', dlg.el);
    if (weg) weg.addEventListener('click', async () => { if (!(await bestaetigen('Abschnitt löschen?', '', 'Löschen', 'danger'))) return; try { await del(`/baustellen/${bsId}/abschnitte/${a.id}`); dlg.zu(); toast('Abschnitt gelöscht.'); } catch (x) { toast(x.message, 'warn'); } neu(); });
  }
  el.addEventListener('click', (e) => {
    const zp = holZp(); if (!zp || !e.target.closest('#zeitplan')) return;
    const ph = e.target.closest('[data-zp-phase]'); if (ph) { zp.phase = ph.dataset.zpPhase; return neu(); }
    const w = e.target.closest('[data-zp-weiter]'); if (w) { zp.von = fmt.addTage(zp.von, Number(w.dataset.zpWeiter)); return neu(); }
    const n = e.target.closest('[data-abschnitt-neu]'); if (n) return abschnittDialog(n.dataset.abschnittNeu, null);
    const b = e.target.closest('[data-abschnitt]'); if (b) { const t = finde(b.dataset.abschnitt); if (t && darfBv(ctx, t.b.id)) abschnittDialog(t.b.id, t.a); }
  });
  return ziehbar(el, {
    quelle: '#zeitplan [data-zieh][data-abschnitt]', ziel: '[data-kw-zelle]',
    darf: (q, z) => q.closest('[data-spur]') === z.closest('[data-spur]'),
    ablegen: async (q, z) => {
      const t = finde(q.dataset.abschnitt); if (!t) return;
      const delta = (Number(z.dataset.kwZelle) - Number(q.dataset.start)) * 7; if (!delta) return;
      try { await put(`/baustellen/${t.b.id}/abschnitte/${t.a.id}`, { version: t.a.version, von: fmt.addTage(t.a.von, delta), bis: fmt.addTage(t.a.bis, delta) }); toast(`Verschoben um ${Math.abs(delta / 7)} Woche${Math.abs(delta) === 7 ? '' : 'n'}.`); } catch (x) { toast(x.message, 'warn'); }
      neu();
    },
  });
}
