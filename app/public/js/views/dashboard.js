// Übersicht für Büro, Geschäftsführung und Bauleitung:
// wer ist eingestempelt, Berichte zur Freigabe, Warnungen, Budget-Status.
import { get } from '../api.js';
import { ic, esc, fmt, avatar, leer, statusChip, kalkChip, $ } from '../ui.js';
import { budgetBalken } from './kalkulation.js';
import { warnText } from './stempeln.js';

// Jede Kachel lädt für sich: fehlt ein Recht (403), zeigt nur diese Kachel „Kein Zugriff“.
async function teil(fn) { try { return { ok: true, daten: await fn() }; } catch (e) { return { ok: false, fehler: e }; } }
const teilFehler = (t) => `<div class="state small">${ic(t.fehler.status === 403 ? 'lock' : t.fehler.netz ? 'wifiOff' : 'alert')}<p>${t.fehler.status === 403 ? 'Kein Zugriff' : esc(t.fehler.netz ? 'Keine Verbindung' : t.fehler.message)}</p></div>`;

export default async function dashboard(el, ctx) {
  const heute = fmt.iso();
  const [bs, anw, offen, entw, kalk, mon] = await Promise.all([
    teil(() => get('/baustellen')),
    teil(() => get('/zeit/anwesend')),
    teil(() => get('/berichte?status=unterschrieben')),
    teil(() => get('/berichte?status=entwurf')),
    ctx.kann('kalk_sehen') ? teil(() => get('/kalkulation')) : null,
    ctx.kann('lohn') ? teil(() => get(`/monat?monat=${heute.slice(0, 7)}`)) : null,
  ]);
  // Bauvorhaben-Kennzahlen (12.15) und offene Posten (12.17) – jede Kachel nur, wenn der Server sie liefert
  const planer = ['buero', 'gf', 'bauleiter'].includes(ctx.ich.benutzer.rolle) || ctx.kann('stammdaten');
  const [kz, op, alleBs] = await Promise.all([planer ? teil(() => get('/baustellen-kennzahlen')) : null, ctx.kann('preise_sehen') ? teil(() => get('/offene-posten')) : null, planer ? teil(() => get('/baustellen?alle=1')) : null]);
  const bald = fmt.addTage(heute, 92);
  const gewaehr = alleBs && alleBs.ok ? alleBs.daten.filter((b) => b.gewaehrleistungBis && b.gewaehrleistungBis >= heute && b.gewaehrleistungBis <= bald) : [];
  // Ohne jede Verbindung/Recht: Fehler an den Rahmen weitergeben
  if (!bs.ok && (bs.fehler.netz || bs.fehler.status === 401)) throw bs.fehler;
  const baustellen = bs.ok ? bs.daten : [];
  const bsName = (id) => (baustellen.find((b) => b.id === id) || {}).name || '';
  const bsVon = (b) => { const k = baustellen.find((x) => x.id === b.baustelleId) || {}; return typeof b.baustelle === 'object' && b.baustelle ? b.baustelle : { ...k, name: (typeof b.baustelle === 'string' && b.baustelle) || k.name, kst: b.kst || k.kst }; };
  const anwesend = anw.ok ? (Array.isArray(anw.daten) ? anw.daten : anw.daten.anwesend || []) : [];
  const kalkListe = kalk && kalk.ok ? (Array.isArray(kalk.daten) ? kalk.daten : kalk.daten.baustellen || []) : [];
  const warnungen = mon && mon.ok ? mon.daten.warnungen || [] : [];
  const auffaellig = kalkListe.filter((k) => k.status && k.status !== 'ok').length;
  const darfFrei = ctx.kann('bericht_freigeben');

  const repZeile = (b) => { const s = bsVon(b); return `<li><a class="rep-row" href="#/bericht/${b.id}"><span class="rep-date"><b>${esc(fmt.datumKurz(b.datum))}</b></span><span class="rep-txt"><b>${esc(s.name || 'Baustelle')}</b><small>${esc(s.kst || '')}</small></span>${statusChip(b.status)}${ic('right')}</a></li>`; };

  el.innerHTML = `
  <div class="page">
    <div class="kpi-row four">
      <a class="kpi link" href="#anwesend-karte" data-kpi="anwesend"><small>Jetzt eingestempelt</small><b>${anw.ok ? anwesend.length : '–'}</b><em>${anw.ok ? `${anwesend.filter((a) => a.status === 'pause').length} in Pause` : 'nicht abrufbar'}</em></a>
      <a class="kpi link" href="#/berichte?status=unterschrieben" data-kpi="freigabe"><small>Berichte zur Freigabe</small><b>${offen.ok ? offen.daten.length : '–'}</b><em>${entw.ok ? `${entw.daten.length} noch im Entwurf` : ''}</em></a>
      ${kalk ? `<a class="kpi link" href="#/kalkulation" data-kpi="budget"><small>Baustellen mit Budget-Warnung</small><b class="${auffaellig ? 'neg' : ''}">${kalk.ok ? auffaellig : '–'}</b><em>von ${kalkListe.length} Baustellen</em></a>` : `<div class="kpi"><small>Aktive Baustellen</small><b>${baustellen.filter((b) => !b.status || b.status === 'aktiv').length}</b><em>in Ihrem Bereich</em></div>`}
      ${mon ? `<a class="kpi link" href="#/monat" data-kpi="warnungen"><small>Arbeitszeit-Warnungen</small><b class="${warnungen.length ? 'neg' : ''}">${mon.ok ? warnungen.length : '–'}</b><em>${esc(fmt.monat(heute.slice(0, 7)))}</em></a>` : `<div class="kpi"><small>Heute</small><b class="date">${esc(fmt.datumKurz(heute))}</b><em>${fmt.dt(heute).getFullYear()}</em></div>`}
    </div>
    ${kz && kz.ok ? `<div class="kpi-row four" id="bv-kacheln">
      <a class="kpi sm link" href="#/baustellen?phase=schlussrechnung" data-kpi="schlussrechnungen"><small>Offene Schlussrechnungen</small><b>${kz.daten.offeneSchlussrechnungen ? kz.daten.offeneSchlussrechnungen.anzahl : 0}</b><em>${kz.daten.offeneSchlussrechnungen && kz.daten.offeneSchlussrechnungen.summe != null ? fmt.eur(kz.daten.offeneSchlussrechnungen.summe) : 'gelegt, noch nicht bezahlt'}</em></a>
      <a class="kpi sm link" href="#/baustellen?phase=abgenommen" data-kpi="abnahme-ohne-rechnung"><small>Abnahmen ohne Rechnung</small><b class="${kz.daten.abnahmeOhneSchlussrechnung ? 'neg' : ''}">${kz.daten.abnahmeOhneSchlussrechnung ?? 0}</b><em>abgenommen, Schlussrechnung fehlt</em></a>
      <a class="kpi sm link" href="#/baustellen/archiv" data-kpi="gewaehrleistung"><small>Gewährleistung läuft ab</small><b class="${gewaehr.length ? 'neg' : ''}">${gewaehr.length}</b><em>${gewaehr.length ? esc(gewaehr.slice(0, 2).map((b) => `${b.kurz || b.name} (${fmt.datum(b.gewaehrleistungBis)})`).join(', ')) : 'in den nächsten 3 Monaten'}</em></a>
      ${op && op.ok ? `<a class="kpi sm link" href="#/offene-posten" data-kpi="offene-posten"><small>Offene Posten</small><b>${fmt.eur(op.daten.summeOffen)}</b><em>${op.daten.anzahlUeberfaellig ? `<span class="chip xs st-red">${op.daten.anzahlUeberfaellig} überfällig · ${fmt.eur(op.daten.summeUeberfaellig)}</span>` : `${op.daten.anzahlOffen ?? 0} Rechnungen offen`}</em></a>` : `<a class="kpi sm link" href="#/baustellen" data-kpi="fertigmeldungen"><small>Fertigmeldungen offen</small><b>${kz.daten.fertigmeldungenOffen ?? 0}</b><em>vom Polier gemeldet</em></a>`}
    </div>` : ''}
    <div class="two-col">
      <section class="card" id="anwesend-karte" aria-labelledby="h-anw">
        <div class="card-h pad-h"><h3 id="h-anw">${ic('users')}Eingestempelt <span class="count">${anwesend.length}</span></h3></div>
        ${!anw.ok ? teilFehler(anw) : anwesend.length ? `<ul class="plain rows">${anwesend.map((a) => `<li>${avatar(a.name, 'sm ' + (a.status === 'pause' ? 'pause' : 'on'))}<span class="grow"><b>${esc(a.name)}</b><small>${esc(a.baustelleName || (a.baustelle && a.baustelle.name) || bsName(a.baustelleId))}</small></span><span class="chip xs ${a.status === 'pause' ? 'st-amber' : 'st-green'}">${a.status === 'pause' ? 'Pause' : 'Arbeit'}</span><span class="muted sm nw">seit ${fmt.uhr(a.seit)}</span></li>`).join('')}</ul>` : leer('Derzeit ist niemand eingestempelt.', 'clock')}
      </section>
      <section class="card" aria-labelledby="h-frei">
        <div class="card-h pad-h"><h3 id="h-frei">${ic('clipboard')}${darfFrei ? 'Berichte zur Freigabe' : 'Unterschriebene Berichte'} <span class="count${offen.ok && offen.daten.length ? ' red' : ''}">${offen.ok ? offen.daten.length : 0}</span></h3><a class="btn ghost sm" href="#/berichte">Alle</a></div>
        ${!offen.ok ? teilFehler(offen) : offen.daten.length ? `<ul class="rep-list">${offen.daten.slice(0, 8).map(repZeile).join('')}</ul>` : leer('Keine Berichte warten auf Freigabe.', 'check')}
      </section>
    </div>
    ${kalk ? `<section class="card" aria-labelledby="h-bud">
      <div class="card-h pad-h"><h3 id="h-bud">${ic('chart')}Budget-Status</h3><a class="btn ghost sm" href="#/kalkulation">Nachkalkulation</a></div>
      ${!kalk.ok ? teilFehler(kalk) : kalkListe.length ? `<ul class="plain rows bud-rows">${kalkListe.map((k) => { const b = k.baustelle || k; return `<li><a href="#/kalkulation/${b.id ?? k.baustelleId}"><span class="bud-name"><b>${esc(b.name || '')}</b><small>${esc(b.kst || '')}</small></span><span class="bud-bar">${budgetBalken(k, true)}</span><span class="bud-pct num">${fmt.pct(k.budgetVerbrauchProzent)}</span>${kalkChip(k.status)}</a></li>`; }).join('')}</ul>` : leer('Keine Baustellen.', 'chart')}
    </section>` : ''}
    ${mon ? `<section class="card pad" aria-labelledby="h-warn"><div class="card-h"><h3 id="h-warn">${ic('alert')}Warnungen Arbeitszeit <span class="count${warnungen.length ? ' red' : ''}">${warnungen.length}</span></h3><a class="btn ghost sm" href="#/monat">Monatsauswertung</a></div>
      ${!mon.ok ? teilFehler(mon) : warnungen.length ? `<ul class="warn-list">${warnungen.slice(0, 8).map((w) => `<li>${ic('alert')}<span>${w && typeof w === 'object' && w.name ? `<b>${esc(w.name)}</b> · ` : ''}${esc(warnText(w))}</span></li>`).join('')}</ul>${warnungen.length > 8 ? `<p class="muted sm">und ${warnungen.length - 8} weitere</p>` : ''}` : '<p class="muted sm">Keine Auffälligkeiten in diesem Monat.</p>'}</section>` : ''}
  </div>`;
  const k = $('[data-kpi="anwesend"]', el);
  k.addEventListener('click', (e) => { e.preventDefault(); $('#anwesend-karte', el).scrollIntoView({ behavior: 'smooth', block: 'start' }); });
}
