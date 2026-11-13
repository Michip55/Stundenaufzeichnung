// Fuhrpark: ein Fahrzeug / Gerät mit Servicebuch.
// Reiter: Übersicht · Zähler (Verlaufskurve) · Plan (Fristen mit Prognose) · Servicebuch (Zeitleiste) · Mängel · Stammdaten.
// Ohne Leserecht (weder fuhrpark noch bericht_erstellen): Kurzinfo, nächste Termine, Mangel melden, Zählerstand eintragen.
import { get } from '../api.js';
import { ic, esc, fmt, leer, banner, $, $$ } from '../ui.js';
import { KLASSE, EIGENTUM, PLAN_ART, EINTRAG_ART, PRUEF, STATUS, statusChip, anlageStatus, fmtZ, zName, zStand, zEinheit, faelligHtml, grundHtml, regelText, dringChip, mangelChip, liste as arr,
  mangelMelden, zaehlerstandDialog, eintragDialog, eintragStorno, mangelBearbeiten, sperreDialog, ausscheidenDialog, standKorrektur, tauschDialog, zaehlerNeu, anlageDialog, planDialog } from './fuhrpark-dialoge.js';
import { schadenMelden, schaedenFuerAnlage, schadenZeile, schadenOeffnen } from './schaeden.js';

const merkReiter = new Map(); // gewählter Reiter je Anlage (bleibt nach dem Speichern erhalten)
const QUELLE = { manuell: 'Ablesung', eintrag: 'Servicebuch-Eintrag', korrektur: 'Korrektur', tausch_alt: 'Zählertausch (alt)', tausch_neu: 'Zählertausch (neu)', start: 'Startstand' };

/* ---------- Verlaufskurve eines Zählers: Punkte = Ablesung, gestrichelt = Schätzung aus Bautagesberichten ---------- */
const kurven = new Map();
function verlaufChart(z, v) {
  const echte = arr(v.punkte).filter((p) => p.status !== 'ungueltig' && p.status !== 'unplausibel').map((p) => ({ datum: p.datum, wert: p.wert, anzeige: p.anzeige, art: 'echt', quelle: p.quelle }));
  const schaetz = arr(v.schaetzung).map((p) => ({ datum: p.datum, wert: p.wert, art: 'schaetz' }));
  const pts = [...echte, ...schaetz].sort((a, b) => a.datum.localeCompare(b.datum) || (a.art === 'echt' ? -1 : 1));
  if (pts.length < 2) return leer('Für eine Verlaufskurve braucht es mindestens zwei Zählerstände.', 'chart');
  const W = 720, H = 240, L = 64, R = 20, T = 14, B = 30;
  const tag = (s) => fmt.dt(s).getTime() / 864e5;
  const x0 = tag(pts[0].datum), x1 = Math.max(tag(pts[pts.length - 1].datum), x0 + 1);
  const lo = Math.min(...pts.map((p) => p.wert)), hi = Math.max(...pts.map((p) => p.wert));
  const spanne = Math.max(hi - lo, 1);
  const stufe = (() => { const roh = spanne / 4, p = Math.pow(10, Math.floor(Math.log10(roh))); return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= roh) || roh; })();
  const unten = Math.floor(lo / stufe) * stufe, oben = Math.max(Math.ceil(hi / stufe) * stufe, unten + stufe);
  const x = (p) => L + ((tag(p.datum) - x0) / (x1 - x0)) * (W - L - R);
  const y = (w) => T + (1 - (w - unten) / (oben - unten)) * (H - T - B);
  const pfad = (l) => l.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)} ${y(p.wert).toFixed(1)}`).join(' ');
  const ticks = []; for (let w = unten; w <= oben + 1e-9; w += stufe) ticks.push(w);
  const nX = Math.min(pts.length, 5);
  const xIdx = [...new Set(Array.from({ length: nX }, (_, i) => Math.round((i / Math.max(1, nX - 1)) * (pts.length - 1))))];
  const letzterEchter = echte[echte.length - 1];
  const zz = { art: z.art, einheit: zEinheit(z) };
  kurven.set(String(z.id), { pts, x: pts.map(x), y: pts.map((p) => y(p.wert)), W, T, H, B, zz });
  return `<figure class="chart fp-chart" data-kurve="${z.id}">
    ${schaetz.length ? '<div class="legend-row" aria-hidden="true"><span><i class="lg-line fp-lg-echt"></i>Abgelesen</span><span><i class="lg-dash"></i>Geschätzt aus Bautagesberichten</span></div>' : ''}
    <div class="chart-box"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Verlauf ${esc(zName(z.art))}: von ${esc(fmtZ(pts[0].wert, zz))} am ${esc(fmt.datum(pts[0].datum))} auf ${esc(fmtZ(pts[pts.length - 1].wert, zz))} am ${esc(fmt.datum(pts[pts.length - 1].datum))}." preserveAspectRatio="xMidYMid meet">
      ${ticks.map((w) => `<line x1="${L}" x2="${W - R}" y1="${y(w)}" y2="${y(w)}" class="grid"/><text x="${L - 8}" y="${y(w) + 4}" text-anchor="end" class="ax">${fmt.zahl(w, 0)}</text>`).join('')}
      ${xIdx.map((i) => `<text x="${x(pts[i])}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}" class="ax">${fmt.datum(pts[i].datum).slice(0, 6)}</text>`).join('')}
      ${echte.length > 1 ? `<path d="${pfad(echte)}" class="fp-linie"/>` : ''}
      ${schaetz.length && letzterEchter ? `<path d="${pfad([letzterEchter, ...schaetz])}" class="fp-linie schaetz"/>` : ''}
      ${echte.map((p) => `<circle cx="${x(p).toFixed(1)}" cy="${y(p.wert).toFixed(1)}" r="4" class="fp-punkt"/>`).join('')}
      <g class="hover" hidden><line class="cross" y1="${T}" y2="${H - B}"/><circle r="5.500" class="fp-punkt hp"/></g>
      <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" class="hit" tabindex="0" aria-label="Verlauf: mit dem Zeiger oder den Pfeiltasten die einzelnen Stände ablesen"/>
    </svg><div class="chart-tip" hidden></div></div>
  </figure>`;
}
function kurveHover(fig) {
  const d = kurven.get(fig.dataset.kurve); if (!d) return;
  const svg = $('svg', fig), tip = $('.chart-tip', fig), g = $('.hover', fig), hit = $('.hit', fig);
  let akt = d.pts.length - 1;
  const zeig = (i) => {
    akt = Math.max(0, Math.min(d.pts.length - 1, i)); const p = d.pts[akt];
    g.removeAttribute('hidden');
    $('.cross', g).setAttribute('x1', d.x[akt]); $('.cross', g).setAttribute('x2', d.x[akt]);
    $('.hp', g).setAttribute('cx', d.x[akt]); $('.hp', g).setAttribute('cy', d.y[akt]);
    tip.hidden = false;
    tip.innerHTML = `<b>${esc(fmt.datum(p.datum))}</b><span>${p.art === 'echt' ? esc(QUELLE[p.quelle] || 'Ablesung') : 'Geschätzt'} <b>${p.art === 'echt' ? '' : '≈ '}${esc(fmtZ(p.wert, d.zz))}</b></span>`;
    const r = svg.getBoundingClientRect(), px = (d.x[akt] / d.W) * r.width;
    tip.style.left = Math.max(0, Math.min(r.width - tip.offsetWidth, px + (px > r.width / 2 ? -tip.offsetWidth - 12 : 12))) + 'px';
  };
  const weg = () => { g.setAttribute('hidden', ''); tip.hidden = true; };
  hit.addEventListener('pointermove', (e) => { const r = svg.getBoundingClientRect(); const sx = ((e.clientX - r.left) / r.width) * d.W; let best = 0; d.x.forEach((v, i) => { if (Math.abs(v - sx) < Math.abs(d.x[best] - sx)) best = i; }); zeig(best); });
  hit.addEventListener('pointerleave', weg);
  hit.addEventListener('focus', () => zeig(akt));
  hit.addEventListener('blur', weg);
  hit.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') { zeig(akt - 1); e.preventDefault(); } if (e.key === 'ArrowRight') { zeig(akt + 1); e.preventDefault(); } });
}

export async function anlage(el, ctx) {
  const id = ctx.params[0];
  const darf = ctx.kann('fuhrpark');
  const a = await get(`/fuhrpark/anlagen/${id}`);
  const lesen = a.leserecht != null ? !!a.leserecht : darf || ctx.kann('bericht_erstellen');
  a.zaehler = a.zaehler || []; a.plan = a.plan || [];
  const ruhig = (p) => p.catch((e) => (e.status === 403 || e.status === 404 ? null : Promise.reject(e)));
  const [eintraege, maengel, schaeden, ...verlaeufe] = await Promise.all([
    lesen ? ruhig(get(`/fuhrpark/eintraege?anlageId=${id}`)) : null,
    ruhig(get(`/fuhrpark/maengel?anlageId=${id}`)),
    schaedenFuerAnlage(id),
    ...(lesen ? a.zaehler.filter((z) => z.id != null).map((z) => ruhig(get(`/fuhrpark/zaehler/${z.id}/verlauf`))) : []),
  ]);
  const verlauf = new Map(); if (lesen) a.zaehler.filter((z) => z.id != null).forEach((z, i) => { if (verlaeufe[i]) verlauf.set(z.id, verlaeufe[i]); });
  const mg = maengel || a.maengel || [];
  const offeneMg = mg.filter((m) => m.status === 'offen' || m.status === 'in_arbeit');
  const s = anlageStatus(a);
  ctx.titel(a.bezeichnung || 'Gerät', [a.nummer, KLASSE[a.klasse], a.kennzeichen].filter(Boolean).join(' · '));
  const aktiv = a.status !== 'ausgeschieden';
  const plan = a.plan.filter((p) => p.aktiv !== false && p.aktiv !== 0);
  const kurzTermine = arr(a.naechsteTermine).map((t) => ({ ...t, id: t.planpositionId }));
  const planSort = [...plan].sort((x, y) => String(x.naechstesDatum || '9999').localeCompare(String(y.naechstesDatum || '9999')));
  const mitKosten = ['kostenJahr', 'kostenGesamt', 'kostenJeStunde', 'verrechnungssatz'].some((k) => k in a);

  const REITER = [
    ['uebersicht', 'Übersicht', true], ['zaehler', 'Zähler', a.zaehler.length > 0 || darf], ['plan', 'Plan', plan.length > 0 || darf],
    ['servicebuch', 'Servicebuch', lesen], ['maengel', 'Mängel', true], ['stammdaten', 'Stammdaten', lesen],
  ].filter((r) => r[2]);
  let reiter = ctx.query.get('reiter') || merkReiter.get(id) || 'uebersicht';
  if (!REITER.some((r) => r[0] === reiter)) reiter = 'uebersicht';
  let tlFilter = '';

  /* ---- Bausteine ---- */
  const sperrGruende = arr(a.sperrGruende).map((g) => (typeof g === 'string' ? g : g.text || g.grund || '')).filter(Boolean);
  const zaehlerKachel = (z) => `<div class="kpi sm fp-zk" data-zaehler="${esc(z.art)}"><small>${esc(zName(z.art))}</small><b>${z.geschaetzt ? '<i>≈ </i>' : ''}${esc(fmt.zahl(z.aktuell, z.art === 'km' || z.art === 'hub' ? 0 : 1))} <i>${esc(zEinheit(z))}</i></b>
    <em>${z.letzterStand && z.letzterStand.datum ? `abgelesen ${esc(fmt.datum(z.letzterStand.datum))}${z.geschaetzt ? ' · seither geschätzt' : ''}` : 'noch nicht abgelesen'}${z.wochenschnitt != null ? ` · Ø ${esc(fmt.zahl(z.wochenschnitt, 1))} ${esc(zEinheit(z))}/Woche` : ''}</em></div>`;
  const planZeile = (p) => `<li data-plan="${p.id}" data-status="${esc(p.status)}"><span class="grow"><b>${esc(p.titel)}${p.vorlage && p.vorlage.pruefen ? ' <span class="chip xs st-amber" title="Intervall noch nicht abgestimmt">Prüfen</span>' : ''}</b><small class="fp-dues">${faelligHtml(p)}</small></span>${statusChip(p.status)}</li>`;
  const mangelZeile = (m) => `<li data-mangel="${m.id}" data-status="${esc(m.status)}"><span class="grow"><b>${esc(m.text)}</b><small>${esc((m.gemeldetVon && m.gemeldetVon.name) || '')} · ${esc(fmt.zeitpunkt(m.gemeldet))}${m.notiz ? ` · Werkstatt: ${esc(m.notiz)}` : ''}</small></span>${dringChip(m.dringlichkeit)}${mangelChip(m.status)}${darf && (m.status === 'offen' || m.status === 'in_arbeit') ? `<button type="button" class="btn ghost sm" data-mangel-bearb="${m.id}">Bearbeiten</button>` : ''}</li>`;
  const eintragKopf = (e) => { const [t, i] = EINTRAG_ART[e.art] || [e.art, 'file']; return { t, i }; };

  function uebersichtHtml() {
    return `<div class="two-col">
      <div class="stack">
        <section class="card" aria-labelledby="h-termine"><div class="card-h pad-h"><h3 id="h-termine">${ic('calendar')}Nächste Termine</h3>${REITER.some((r) => r[0] === 'plan') && plan.length > 3 ? '<button type="button" class="btn ghost sm" data-geh="plan">Alle Fristen</button>' : ''}</div>
          ${planSort.length || kurzTermine.length ? `<ul class="plain rows fp-plan-kurz" id="fp-termine">${(planSort.length ? planSort.filter((p) => p.status !== 'erledigt') : kurzTermine).slice(0, 3).map(planZeile).join('')}</ul>` : a.naechsterTermin ? `<ul class="plain rows" id="fp-termine"><li data-status="${esc(a.naechsterTermin.status)}"><span class="grow"><b>${esc(a.naechsterTermin.titel)}</b><small>${a.naechsterTermin.datum ? esc(fmt.datum(a.naechsterTermin.datum)) : ''}</small></span>${statusChip(a.naechsterTermin.status)}</li></ul>` : leer('Keine Fristen hinterlegt.', 'calendar')}</section>
        ${offeneMg.length ? `<section class="card" aria-labelledby="h-omg"><div class="card-h pad-h"><h3 id="h-omg">${ic('alert')}Offene Mängel <span class="count red">${offeneMg.length}</span></h3></div><ul class="plain rows">${offeneMg.map(mangelZeile).join('')}</ul></section>` : ''}
      </div>
      <div class="stack">
        ${a.zaehler.length ? `<div class="kpi-row two fp-zaehler-kacheln">${a.zaehler.map(zaehlerKachel).join('')}</div>` : ''}
        ${mitKosten ? `<section class="card" id="fp-kosten" aria-labelledby="h-kost"><div class="card-h pad-h"><h3 id="h-kost">${ic('euro')}Kosten</h3></div><dl class="def-list">
          ${'kostenJahr' in a ? `<div><dt>Laufendes Jahr</dt><dd>${fmt.eur(a.kostenJahr || 0)}</dd></div>` : ''}${'kostenGesamt' in a ? `<div><dt>Gesamt laut Servicebuch</dt><dd>${fmt.eur(a.kostenGesamt || 0)}</dd></div>` : ''}
          ${a.kostenJeStunde != null ? `<div><dt>Werkstattkosten je Betriebsstunde</dt><dd>${fmt.eur(a.kostenJeStunde)}</dd></div>` : ''}${a.verrechnungssatz != null ? `<div><dt>Verrechnungssatz Gerät</dt><dd>${fmt.eur(a.verrechnungssatz)} / Std.</dd></div>` : ''}</dl></section>` : ''}
        ${lesen && arr(a.letzteEintraege).length ? `<section class="card" aria-labelledby="h-le"><div class="card-h pad-h"><h3 id="h-le">${ic('wrench')}Letzte Einträge</h3><button type="button" class="btn ghost sm" data-geh="servicebuch">Servicebuch</button></div><ul class="plain rows">${arr(a.letzteEintraege).slice(0, 5).map((e) => `<li><span class="grow"><b>${esc(e.titel)}</b><small>${esc(eintragKopf(e).t)} · ${esc(fmt.datum(e.datum))} · ${esc(e.werkstatt || '')}</small></span>${'kosten' in e && e.kosten != null ? `<b class="num nw">${fmt.eur(e.kosten)}</b>` : ''}</li>`).join('')}</ul></section>` : ''}
        ${!lesen ? `<p class="muted sm">${ic('info', 'xs')} Das vollständige Servicebuch sehen Polier, Werkstatt und Büro.</p>` : ''}
      </div></div>`;
  }
  function zaehlerHtml() {
    if (!a.zaehler.length) return `<div class="card">${leer('Für dieses Gerät ist kein Zähler angelegt.', 'gauge', darf ? '<button type="button" class="btn ghost sm" data-akt="zaehler-neu">Zähler anlegen</button>' : '')}</div>`;
    return a.zaehler.map((z) => {
      const v = verlauf.get(z.id);
      const punkte = v ? [...arr(v.punkte)].sort((x, y) => y.datum.localeCompare(x.datum) || (y.id || 0) - (x.id || 0)) : [];
      return `<section class="card fp-zaehler" data-zaehler-karte="${esc(z.art)}" aria-labelledby="h-z-${esc(z.art)}">
        <div class="card-h pad-h"><h3 id="h-z-${esc(z.art)}">${ic('gauge')}${esc(zName(z.art))}</h3>${darf && z.id != null ? `<button type="button" class="btn ghost sm" data-tausch="${z.id}">Zählertausch</button>` : ''}</div>
        <div class="pad stack-s">${zaehlerKachel(z)}
          ${z.schnittQuelle === 'bericht' ? '<p class="muted sm">Wochenschnitt aus den Gerätestunden der Bautagesberichte.</p>' : ''}
          ${v ? verlaufChart(z, v) : ''}</div>
        ${punkte.length ? `<details class="fp-staende" ${punkte.some((p) => p.status === 'unplausibel') ? 'open' : ''}><summary>Alle Zählerstände (${punkte.length})</summary><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Datum</th><th class="r">Stand</th><th>Quelle</th><th>Erfasst von</th><th></th></tr></thead><tbody>
          ${punkte.map((p) => `<tr data-stand="${p.id}" data-status="${esc(p.status || 'gueltig')}" class="${p.status === 'ungueltig' ? 'inaktiv' : ''}"><td class="nw">${esc(fmt.datum(p.datum))}</td><td class="r num nw">${esc(fmtZ(p.anzeige ?? p.wert, z))}</td><td>${esc(QUELLE[p.quelle] || p.quelle || '')}${p.status === 'unplausibel' ? ' <span class="chip xs st-amber">unplausibel</span>' : p.status === 'ungueltig' ? ' <span class="chip xs st-grey">ungültig</span>' : ''}${p.hinweis ? `<small>${esc(p.hinweis)}</small>` : ''}</td><td>${esc(typeof p.erfasstVon === 'object' && p.erfasstVon ? p.erfasstVon.name || '' : p.erfasstVon || '')}</td><td class="r">${darf && p.id != null && p.status !== 'ungueltig' ? `<button type="button" class="btn ghost sm" data-stand-bearb="${p.id}" data-z="${z.id}">${p.status === 'unplausibel' ? 'Prüfen' : 'Korrigieren'}</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div></details>` : ''}
      </section>`;
    }).join('') + (darf && a.zaehler.length < 5 && aktiv ? '<div><button type="button" class="btn ghost" data-akt="zaehler-neu">' + ic('plus') + 'Weiteren Zähler anlegen</button></div>' : '');
  }
  function planHtml() {
    if (!plan.length) return `<div class="card">${leer('Noch keine Fristen hinterlegt.', 'calendar', darf && aktiv ? '<button type="button" class="btn primary" data-akt="plan-neu">' + ic('plus') + 'Frist hinzufügen</button>' : '')}</div>`;
    return `${darf && aktiv ? `<div class="toolbar"><span class="grow"></span><button type="button" class="btn primary" data-akt="plan-neu">${ic('plus')}Frist hinzufügen</button></div>` : ''}
      <div class="card fp-plan-tbl"><div class="tbl-wrap"><table class="tbl" id="fp-plan"><thead><tr><th>Frist</th><th>Intervall</th><th>Zuletzt</th><th>Fälligkeit</th><th>Status</th>${darf ? '<th></th>' : ''}</tr></thead><tbody>
      ${planSort.map((p) => `<tr data-plan="${p.id}" data-status="${esc(p.status)}"><td class="main">${esc(p.titel)}${p.vorlage && p.vorlage.pruefen ? ' <span class="chip xs st-amber" title="Intervall noch nicht abgestimmt">Prüfen</span>' : ''}<small>${esc(PLAN_ART[p.art] || p.art || '')}${p.regel && p.regel.sperrtBeiUeberfaellig ? ' · sperrt bei Überfälligkeit' : ''}</small></td>
        <td>${esc(regelText(p.regel))}</td><td class="nw">${p.letzteDatum ? esc(fmt.datum(p.letzteDatum)) : '<span class="muted">–</span>'}${Object.entries(p.letzteZaehler || {}).filter(([, w]) => w != null).map(([art, w]) => `<small>${esc(fmtZ(w, { art }))}</small>`).join('')}</td>
        <td class="fp-dues">${faelligHtml(p)}${grundHtml(p.grund)}</td><td>${statusChip(p.status)}</td>${darf ? `<td class="r"><button type="button" class="btn ghost sm" data-plan-bearb="${p.id}" aria-label="Frist ${esc(p.titel)} bearbeiten">${ic('edit')}Bearbeiten</button></td>` : ''}</tr>`).join('')}
      </tbody></table></div></div>
      <ul class="plain rows card fp-plan-karten">${planSort.map((p) => `<li data-plan="${p.id}" data-status="${esc(p.status)}"><span class="grow"><b>${esc(p.titel)}${p.vorlage && p.vorlage.pruefen ? ' <span class="chip xs st-amber">Prüfen</span>' : ''}</b><small>${esc(regelText(p.regel))}${p.letzteDatum ? ` · zuletzt ${esc(fmt.datum(p.letzteDatum))}` : ''}</small><small class="fp-dues">${faelligHtml(p)}</small></span><span class="fp-plan-akt">${statusChip(p.status)}${darf ? `<button type="button" class="btn ghost sm" data-plan-bearb="${p.id}">Bearbeiten</button>` : ''}</span></li>`).join('')}</ul>`;
  }
  // Zeitleiste: Einträge, Mängel, Schäden und Zählerstände in einer Reihe, neueste zuerst
  function zeitleiste() {
    const z = [];
    arr(eintraege).forEach((e) => z.push({ typ: 'eintrag', gruppe: e.art === 'pruefung' ? 'pruefung' : e.art === 'reparatur' ? 'reparatur' : 'service', datum: e.datum, sort: e.erfasst || e.datum, e }));
    mg.forEach((m) => z.push({ typ: 'mangel', gruppe: 'mangel', datum: String(m.gemeldet).slice(0, 10), sort: m.gemeldet, m }));
    arr(schaeden).forEach((sch) => z.push({ typ: 'schaden', gruppe: 'mangel', datum: String(sch.gemeldet || sch.erstellt || sch.datum || '').slice(0, 10), sort: sch.gemeldet || sch.erstellt || sch.datum || '', sch }));
    a.zaehler.forEach((zz) => { const v = verlauf.get(zz.id); arr(v && v.punkte).filter((p) => p.quelle !== 'eintrag' && p.status !== 'ungueltig').forEach((p) => z.push({ typ: 'zaehler', gruppe: 'zaehler', datum: p.datum, sort: p.datum, p, zz })); });
    return z.sort((x, y) => y.datum.localeCompare(x.datum) || String(y.sort).localeCompare(String(x.sort)));
  }
  function tlZeile(x) {
    if (x.typ === 'eintrag') {
      const e = x.e, k = eintragKopf(e), st = !!e.storniert;
      return `<li class="tl-${esc(e.art)}${st ? ' storniert' : ''}" data-typ="eintrag" data-eintrag="${e.id}" data-art="${esc(e.art)}"><time datetime="${esc(e.datum)}">${esc(fmt.datum(e.datum))}</time><i>${ic(k.i)}</i><div class="sb-body">
        <div class="sb-kopf"><b>${esc(e.titel)}</b><span class="chip xs st-outline">${esc(k.t)}</span>${st ? '<span class="chip xs st-grey">storniert</span>' : ''}${e.pruefErgebnis ? `<span class="chip xs ${(PRUEF[e.pruefErgebnis] || [])[1] || 'st-grey'}">${esc((PRUEF[e.pruefErgebnis] || [e.pruefErgebnis])[0])}</span>` : ''}${'kosten' in e && e.kosten != null ? `<span class="sb-kosten num">${fmt.eur(e.kosten)}</span>` : ''}</div>
        <small>${esc(e.werkstatt || '')}${e.pruefer ? ` · Prüfer: ${esc(e.pruefer)}` : ''}${arr(e.zaehler).map((zz) => ` · ${esc(fmtZ(zz.anzeige ?? zz.wert, zz))}`).join('')}${e.rechnungNr ? ` · Rechnung ${esc(e.rechnungNr)}` : ''}${e.arbeitsstundenIntern ? ` · ${esc(fmt.std(e.arbeitsstundenIntern))} intern` : ''}</small>
        ${e.arbeiten ? `<p>${esc(e.arbeiten)}</p>` : ''}${e.teile ? `<p class="muted">Teile: ${esc(e.teile)}</p>` : ''}
        ${arr(e.erledigt).length ? `<p class="sb-erl">${ic('check', 'xs')} erledigt: ${arr(e.erledigt).map((p) => esc(p.titel)).join(', ')}</p>` : ''}
        ${st && e.storniert.grund ? `<p class="muted">Storniert${e.storniert.von ? ' von ' + esc(e.storniert.von.name) : ''}: ${esc(e.storniert.grund)}</p>` : ''}
        ${darf && !st ? `<button type="button" class="btn ghost sm" data-storno="${e.id}">Stornieren</button>` : ''}</div></li>`;
    }
    if (x.typ === 'mangel') {
      const m = x.m;
      return `<li class="tl-mangel" data-typ="mangel" data-mangel="${m.id}"><time datetime="${esc(x.datum)}">${esc(fmt.datum(x.datum))}</time><i>${ic('alert')}</i><div class="sb-body"><div class="sb-kopf"><b>${esc(m.text)}</b><span class="chip xs st-outline">Mangel</span>${dringChip(m.dringlichkeit)}${mangelChip(m.status)}</div><small>gemeldet von ${esc((m.gemeldetVon && m.gemeldetVon.name) || '–')}${m.notiz ? ` · Werkstatt: ${esc(m.notiz)}` : ''}</small></div></li>`;
    }
    if (x.typ === 'schaden') return schadenZeile(x.sch, x.datum);
    const p = x.p;
    return `<li class="tl-zaehler" data-typ="zaehler"><time datetime="${esc(p.datum)}">${esc(fmt.datum(p.datum))}</time><i>${ic('gauge')}</i><div class="sb-body"><div class="sb-kopf"><b>${esc(zStand(x.zz.art))} ${esc(fmtZ(p.anzeige ?? p.wert, x.zz))}</b><span class="chip xs st-outline">${esc(QUELLE[p.quelle] || 'Ablesung')}</span>${p.status === 'unplausibel' ? '<span class="chip xs st-amber">unplausibel</span>' : ''}</div>${p.erfasstVon ? `<small>${esc(typeof p.erfasstVon === 'object' ? p.erfasstVon.name || '' : p.erfasstVon)}</small>` : ''}</div></li>`;
  }
  function servicebuchHtml() {
    const alle = zeitleiste();
    const F = [['', 'Alles'], ['service', 'Service'], ['reparatur', 'Reparaturen'], ['pruefung', 'Prüfungen'], ['mangel', 'Mängel & Schäden'], ['zaehler', 'Zählerstände']];
    const sicht = alle.filter((x) => !tlFilter || x.gruppe === tlFilter);
    return `<div class="toolbar"><div class="fp-arten" role="group" aria-label="Zeitleiste filtern">${F.map(([k, t]) => `<button type="button" class="chip-btn${tlFilter === k ? ' on' : ''}" data-tl="${k}" aria-pressed="${tlFilter === k}">${t} <span>${k ? alle.filter((x) => x.gruppe === k).length : alle.length}</span></button>`).join('')}</div>
      <span class="grow"></span>${lesen ? `<a class="btn ghost" id="fp-pdf" href="/api/fuhrpark/anlagen/${id}/servicebuch.pdf" target="_blank" rel="noopener">${ic('file')}PDF</a>${ctx.kann('preise_sehen') ? `<a class="btn ghost" id="fp-pdf-kosten" href="/api/fuhrpark/anlagen/${id}/servicebuch.pdf?kosten=1" target="_blank" rel="noopener">${ic('file')}PDF mit Kosten</a>` : ''}` : ''}</div>
      <section class="card pad" aria-label="Servicebuch">${sicht.length ? `<ol class="timeline sb-tl" id="fp-zeitleiste">${sicht.map(tlZeile).join('')}</ol>` : leer(alle.length ? 'Für diesen Filter gibt es keine Einträge.' : 'Das Servicebuch ist noch leer.', 'wrench')}</section>`;
  }
  function maengelHtml() {
    return `<section class="card" aria-labelledby="h-mgl"><div class="card-h pad-h"><h3 id="h-mgl">${ic('alert')}${lesen ? 'Mängel' : 'Meine Meldungen'} <span class="count">${mg.length}</span></h3></div>
      ${mg.length ? `<ul class="plain rows" id="fp-maengel">${mg.map(mangelZeile).join('')}</ul>` : leer(lesen ? 'Zu diesem Gerät wurde noch kein Mangel gemeldet.' : 'Sie haben zu diesem Gerät noch keinen Mangel gemeldet.', 'check')}</section>
      ${arr(schaeden).length ? `<section class="card" aria-labelledby="h-sch"><div class="card-h pad-h"><h3 id="h-sch">${ic('camera')}Schadensmeldungen <span class="count">${arr(schaeden).length}</span></h3></div><ol class="timeline sb-tl pad">${arr(schaeden).map((x) => schadenZeile(x, String(x.gemeldet || x.erstellt || x.datum || '').slice(0, 10))).join('')}</ol></section>` : ''}`;
  }
  function stammHtml() {
    const z = (t, w) => (w != null && w !== '' ? `<div><dt>${t}</dt><dd>${esc(w)}</dd></div>` : '');
    return `<div class="two-col"><section class="card" aria-labelledby="h-st"><div class="card-h pad-h"><h3 id="h-st">Stammdaten</h3>${darf && aktiv ? `<button type="button" class="btn ghost sm" data-akt="bearbeiten">${ic('edit')}Bearbeiten</button>` : ''}</div><dl class="def-list">
      ${z('Bezeichnung', a.bezeichnung)}${z('Interne Nummer', a.nummer)}${z('Art', KLASSE[a.klasse])}${z('Fahrzeugklasse', a.fahrzeugklasse)}${z('Hersteller', a.hersteller)}${z('Typ', a.typ)}${z('Kennzeichen', a.kennzeichen)}${z('FIN / Seriennummer', a.fin)}${z('Baujahr', a.baujahr)}${z('Erstzulassung', a.erstzulassung && fmt.datum(a.erstzulassung))}${z('Höchstzul. Gesamtgewicht', a.hzgKg != null ? fmt.zahl(a.hzgKg, 0) + ' kg' : null)}
    </dl></section>
    <section class="card" aria-labelledby="h-st2"><div class="card-h pad-h"><h3 id="h-st2">Einsatz und Vertrag</h3></div><dl class="def-list">
      ${z('Gerätezeile im Bautagesbericht', a.geraet && a.geraet.name)}${z('Verantwortlich', a.verantwortlich && a.verantwortlich.name)}${z('Standort', a.standort && (a.standort.text || a.standort.kst))}${z('Eigentum', EIGENTUM[a.eigentum])}${z('Leasing-/Mietende', a.vertragsende && fmt.datum(a.vertragsende))}${z('Versicherung', a.versicherung)}${z('Ausgeschieden am', a.ausgeschieden && fmt.datum(a.ausgeschieden))}${z('Notiz', a.notiz)}
    </dl>${darf && aktiv ? `<div class="card-actions"><button type="button" class="btn ghost sm" data-akt="ausscheiden">${ic('trash')}Gerät ausscheiden (verkauft / verschrottet)</button></div>` : ''}</section></div>`;
  }
  const INHALT = { uebersicht: uebersichtHtml, zaehler: zaehlerHtml, plan: planHtml, servicebuch: servicebuchHtml, maengel: maengelHtml, stammdaten: stammHtml };

  function zeichne() {
    el.innerHTML = `<div class="page fp-page">
      <div class="form-top"><a class="link-back" href="#/fuhrpark?reiter=geraete">${ic('left')}Alle Geräte</a></div>
      <section class="card pad fp-kopf st-${esc(s)}" id="fp-kopf" data-status="${esc(s)}">
        <div class="fp-kopf-status"><span class="fp-ampel-ic">${ic((STATUS[s] || STATUS.einsatzbereit)[2])}</span><div><small>Zustand</small><b id="fp-status-text">${esc((STATUS[s] || [s])[0])}</b></div></div>
        <div class="fp-kopf-txt"><h2>${esc(a.bezeichnung)}</h2><p class="fp-meta">${a.kennzeichen ? `<span class="kennz">${esc(a.kennzeichen)}</span>` : ''}${a.nummer ? `<span>Nr. ${esc(a.nummer)}</span>` : ''}<span>${esc(KLASSE[a.klasse] || '')}</span>${a.standort && (a.standort.text || a.standort.kst) ? `<span>${ic('pin', 'xs')} ${esc(a.standort.text || a.standort.kst)}</span>` : ''}${a.verantwortlich ? `<span>${ic('user', 'xs')} ${esc(a.verantwortlich.name)}</span>` : ''}</p></div>
        ${aktiv ? `<div class="fp-kopf-akt">
          <button type="button" class="act-btn fp-schaden" data-akt="schaden">${ic('camera')}Schaden melden</button>
          <button type="button" class="act-btn" data-akt="mangel">${ic('alert')}Mangel melden</button>
          ${a.zaehler.length ? `<button type="button" class="act-btn" data-akt="zaehlerstand">${ic('gauge')}Zählerstand eintragen</button>` : ''}
          ${darf ? `<button type="button" class="act-btn" data-akt="eintrag">${ic('wrench')}Eintrag erfassen</button><button type="button" class="act-btn" data-akt="sperre" data-sperren="${a.gesperrt ? '0' : '1'}">${ic('lock')}${a.gesperrt ? 'Sperre aufheben' : 'Sperren'}</button>` : ''}
        </div>` : ''}
      </section>
      ${s === 'gesperrt' ? `<div id="fp-sperre">${banner('err', `<b>Gesperrt – nicht verwenden.</b> ${sperrGruende.length ? esc(sperrGruende.join(' · ')) : ''}`, 'lock')}</div>` : ''}
      ${a.status === 'ausgeschieden' ? banner('info', `Dieses Gerät ist ausgeschieden${a.ausgeschieden ? ' seit ' + esc(fmt.datum(a.ausgeschieden)) : ''}. Das Servicebuch bleibt lesbar.`) : ''}
      ${REITER.length > 1 ? `<div class="tabs fp-tabs" role="tablist" aria-label="Bereiche des Geräts">${REITER.map(([k, t]) => `<button type="button" role="tab" data-ar="${k}" aria-selected="${k === reiter}" class="${k === reiter ? 'on' : ''}">${t}${k === 'maengel' && offeneMg.length ? `<span class="count red">${offeneMg.length}</span>` : ''}</button>`).join('')}</div>` : ''}
      <div id="fp-inhalt" class="stack" role="tabpanel">${INHALT[reiter]()}</div>
    </div>`;
    $$('[data-kurve]', el).forEach(kurveHover);
  }
  const nurInhalt = () => { $('#fp-inhalt', el).innerHTML = INHALT[reiter](); $$('[data-ar]', el).forEach((b) => { const an = b.dataset.ar === reiter; b.classList.toggle('on', an); b.setAttribute('aria-selected', an); }); $$('[data-kurve]', el).forEach(kurveHover); };
  const geh = (r) => { reiter = r; merkReiter.set(id, r); nurInhalt(); };

  el.addEventListener('click', (e) => {
    const r = e.target.closest('[data-ar]'); if (r) { geh(r.dataset.ar); return; }
    const g = e.target.closest('[data-geh]'); if (g) { geh(g.dataset.geh); $('.fp-tabs', el).scrollIntoView({ block: 'start' }); return; }
    const tl = e.target.closest('[data-tl]'); if (tl) { tlFilter = tl.dataset.tl; nurInhalt(); return; }
    const mb = e.target.closest('[data-mangel-bearb]'); if (mb) { mangelBearbeiten(ctx, mg.find((m) => String(m.id) === mb.dataset.mangelBearb)); return; }
    const st = e.target.closest('[data-storno]'); if (st) { eintragStorno(ctx, arr(eintraege).find((x) => String(x.id) === st.dataset.storno)); return; }
    const pb = e.target.closest('[data-plan-bearb]'); if (pb) { planDialog(ctx, a, plan.find((p) => String(p.id) === pb.dataset.planBearb)); return; }
    const tz = e.target.closest('[data-tausch]'); if (tz) { tauschDialog(ctx, a.zaehler.find((z) => String(z.id) === tz.dataset.tausch)); return; }
    const sb = e.target.closest('[data-stand-bearb]');
    if (sb) { const z = a.zaehler.find((x) => String(x.id) === sb.dataset.z); const p = arr((verlauf.get(z.id) || {}).punkte).find((x) => String(x.id) === sb.dataset.standBearb); if (p) standKorrektur(ctx, z, p); return; }
    const so = e.target.closest('[data-schaden]'); if (so && !e.target.closest('a')) { schadenOeffnen(ctx, so.dataset.schaden); return; }
    const akt = e.target.closest('[data-akt]'); if (!akt) return;
    const was = akt.dataset.akt;
    if (was === 'schaden') schadenMelden(ctx, { anlage: a });
    else if (was === 'mangel') mangelMelden(ctx, { anlage: a });
    else if (was === 'zaehlerstand') zaehlerstandDialog(ctx, a);
    else if (was === 'eintrag') eintragDialog(ctx, a, { maengel: mg, schaeden: arr(schaeden) });
    else if (was === 'sperre') sperreDialog(ctx, { ...a, _sperren: akt.dataset.sperren === '1' });
    else if (was === 'bearbeiten') anlageDialog(ctx, a);
    else if (was === 'ausscheiden') ausscheidenDialog(ctx, a);
    else if (was === 'plan-neu') planDialog(ctx, a);
    else if (was === 'zaehler-neu') zaehlerNeu(ctx, a);
  });
  zeichne();
}
