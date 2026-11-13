// Fuhrpark & Geräte: Übersicht (Ampel), Geräteliste, Fristen, Schäden, Vorlagen.
// Handy: Karten und einfache Abläufe. Tablet/PC: Tabellen. Was jemand sieht, ergibt sich aus den Rechten
// (fuhrpark = pflegen, bericht_erstellen = Servicebuch lesen); €-Werte nur, wenn der Server sie liefert.
import { get } from '../api.js';
import { ic, esc, fmt, leer, banner, toast, dialog, $, $$ } from '../ui.js';
import { KLASSE, ART_GRUPPEN, STATUS, STATUS_FOLGE, PLAN_ART, statusChip, anlageStatus, fmtZ, faelligHtml, grundHtml, dringChip, mangelChip, regelText, liste as arr,
  mangelMelden, zaehlerstandDialog, anlageDialog, mangelBearbeiten, vorlageDialog, vorlageAnwenden } from './fuhrpark-dialoge.js';
import { schaedenReiter, schadenMelden, schadenZahl, merkAnlagen } from './schaeden.js';

const REITER = [
  { id: 'uebersicht', text: 'Übersicht', icon: 'grid', darf: (c) => c.kann('fuhrpark') },
  { id: 'geraete', text: 'Geräte', icon: 'truck', darf: () => true },
  { id: 'fristen', text: 'Fristen', icon: 'calendar', darf: (c) => c.kann('fuhrpark') },
  { id: 'schaeden', text: 'Schäden', icon: 'camera', darf: () => true },
  { id: 'vorlagen', text: 'Vorlagen', icon: 'clipboard', darf: (c) => c.kann('fuhrpark') },
];
export const reiterLeiste = (ctx, aktiv, zahlen = {}) => {
  const sicht = REITER.filter((r) => r.darf(ctx));
  return `<div class="tabs fp-tabs" role="tablist" aria-label="Bereiche Fuhrpark">${sicht.map((r) => `<button type="button" role="tab" data-reiter="${r.id}" aria-selected="${r.id === aktiv}" class="${r.id === aktiv ? 'on' : ''}">${ic(r.icon)}${esc(r.text)}${zahlen[r.id] ? `<span class="count${r.id === 'schaeden' ? ' red' : ''}" data-reiter-zahl="${r.id}">${zahlen[r.id]}</span>` : ''}</button>`).join('')}</div>`;
};

const zaehlerKurz = (a) => (a.zaehler || []).map((z) => `<span class="nw">${z.geschaetzt ? '≈ ' : ''}${esc(fmtZ(z.aktuell, z))}</span>`).join('<br>') || '<span class="muted">–</span>';
const standortText = (a) => (a.standort && (a.standort.text || a.standort.kst)) || '';
const terminKurz = (a) => { const t = a.naechsterTermin; return t ? `<span class="fp-termin"><b>${esc(t.titel)}</b><small>${t.datum ? esc(fmt.datum(t.datum)) : '–'}${t.grund && t.grund !== 'Datum' ? ' · voraussichtlich' : ''}</small></span>` : '<span class="muted">kein Termin</span>'; };
const sperrText = (a) => arr(a.sperrGruende).map((g) => (typeof g === 'string' ? g : g.text || g.grund || '')).filter(Boolean).join(' · ');

export const anlageKarte = (a) => {
  const s = anlageStatus(a);
  return `<a class="card pad fp-card" href="#/fuhrpark/anlage/${a.id}" data-anlage="${a.id}" data-status="${esc(s)}">
    <div class="kc-h"><div><small>${esc([a.nummer, KLASSE[a.klasse] || a.klasse].filter(Boolean).join(' · '))}</small><b>${esc(a.bezeichnung)}</b></div>${statusChip(s)}</div>
    <p class="fp-meta">${a.kennzeichen ? `<span class="kennz">${esc(a.kennzeichen)}</span>` : ''}${standortText(a) ? `<span>${ic('pin', 'xs')} ${esc(standortText(a))}</span>` : ''}${a.offeneMaengel ? `<span class="fp-mg">${ic('alert', 'xs')} ${a.offeneMaengel} ${a.offeneMaengel === 1 ? 'Mangel' : 'Mängel'}</span>` : ''}</p>
    ${a.gesperrt && sperrText(a) ? `<p class="fp-sperr">${ic('lock', 'xs')} ${esc(sperrText(a))}</p>` : ''}
    ${a.naechsterTermin ? `<p class="fp-next">${ic('calendar', 'xs')} <span>${esc(a.naechsterTermin.titel)}${a.naechsterTermin.datum ? ` · ${a.naechsterTermin.grund && a.naechsterTermin.grund !== 'Datum' ? 'voraussichtlich ' : ''}${esc(fmt.datum(a.naechsterTermin.datum))}` : ''}</span></p>` : ''}
  </a>`;
};

export async function fuhrpark(el, ctx) {
  const darf = ctx.kann('fuhrpark');
  const sicht = REITER.filter((r) => r.darf(ctx));
  let reiter = ctx.query.get('reiter') || sicht[0].id;
  if (!sicht.some((r) => r.id === reiter)) reiter = sicht[0].id;
  const TITEL = { uebersicht: 'Übersicht Fuhrpark', geraete: 'Fahrzeuge und Geräte', fristen: 'Fristen und Termine', schaeden: 'Schäden', vorlagen: 'Vorlagen für Fristen' };
  ctx.titel('Fuhrpark & Geräte', TITEL[reiter]);
  const zahlen = { schaeden: await schadenZahl(ctx) };
  const kopf = () => reiterLeiste(ctx, reiter, zahlen);
  el.addEventListener('click', (e) => {
    const r = e.target.closest('[data-reiter]');
    if (r) { location.hash = `#/fuhrpark?reiter=${r.dataset.reiter}`; return; }
  });
  if (reiter === 'schaeden') return schaedenReiter(el, ctx, kopf);
  if (reiter === 'uebersicht') return uebersicht(el, ctx, kopf);
  if (reiter === 'fristen') return fristen(el, ctx, kopf);
  if (reiter === 'vorlagen') return vorlagen(el, ctx, kopf);
  return geraete(el, ctx, kopf, darf);
}

/* =================== Geräteliste =================== */
async function geraete(el, ctx, kopf, darf) {
  let inaktiv = false;
  let alle = await get('/fuhrpark/anlagen');
  merkAnlagen(alle);
  const ich = ctx.ich.benutzer.id;
  const meineBs = ctx.ich.baustellenIds || [];
  let art = ctx.query.get('art') || '';
  let status = ctx.query.get('status') || '';
  let suche = '';
  const mitKosten = () => alle.some((a) => 'kostenJahr' in a);
  const gruppeVon = (a) => (ART_GRUPPEN.find((g) => g[2].includes(a.klasse)) || ['sonstiges'])[0];
  const passt = (a) => (!art || gruppeVon(a) === art) && (!status || anlageStatus(a) === status)
    && (!suche || `${a.bezeichnung} ${a.kennzeichen || ''} ${a.nummer || ''} ${standortText(a)} ${(a.verantwortlich && a.verantwortlich.name) || ''}`.toLowerCase().includes(suche));
  const rang = (a) => STATUS_FOLGE.indexOf(anlageStatus(a));

  function listeHtml() {
    const treffer = alle.filter(passt).sort((x, y) => rang(x) - rang(y) || String(x.bezeichnung).localeCompare(String(y.bezeichnung), 'de'));
    if (!treffer.length) return `<div class="card">${leer(alle.length ? 'Kein Gerät passt zu Suche und Filter.' : 'Noch keine Fahrzeuge oder Geräte angelegt.', 'truck')}</div>`;
    const ohneFilter = !art && !status && !suche;
    const meine = ohneFilter ? treffer.filter((a) => a.verantwortlich && a.verantwortlich.id === ich) : [];
    const baustelle = ohneFilter ? treffer.filter((a) => a.standort && meineBs.includes(a.standort.baustelleId) && !meine.includes(a)) : [];
    const gruppe = (titel, l, id) => (l.length ? `<section class="fp-gruppe" id="${id}" aria-label="${esc(titel)}"><h3 class="list-label">${esc(titel)} <span class="count">${l.length}</span></h3><div class="fp-cards">${l.map(anlageKarte).join('')}</div></section>` : '');
    const k = mitKosten();
    return `<div class="fp-liste-karten">${gruppe('Meine Fahrzeuge', meine, 'fp-meine')}${gruppe('Auf meiner Baustelle', baustelle, 'fp-baustelle')}${gruppe(meine.length || baustelle.length ? 'Alle Geräte' : `${treffer.length} ${treffer.length === 1 ? 'Gerät' : 'Geräte'}`, treffer, 'fp-alle')}</div>
      <div class="card fp-liste-tabelle"><div class="tbl-wrap"><table class="tbl fp-tbl" id="fp-tabelle"><thead><tr><th>Status</th><th>Nr.</th><th>Bezeichnung</th><th>Kennzeichen</th><th class="sp-standort">Standort</th><th>Nächster Termin</th><th class="r">Zähler</th><th class="c">Mängel</th>${k ? '<th class="r">Kosten Jahr</th>' : ''}</tr></thead>
      <tbody>${treffer.map((a) => { const s = anlageStatus(a); return `<tr data-anlage="${a.id}" data-status="${esc(s)}"><td>${statusChip(s)}</td><td class="muted nw">${esc(a.nummer || '')}</td><td class="fp-haupt"><a href="#/fuhrpark/anlage/${a.id}">${esc(a.bezeichnung)}</a><small>${esc(KLASSE[a.klasse] || '')}${a.verantwortlich ? ' · ' + esc(a.verantwortlich.name) : ''}</small></td><td class="nw">${a.kennzeichen ? `<span class="kennz">${esc(a.kennzeichen)}</span>` : '<span class="muted">–</span>'}</td><td class="sp-standort">${esc(standortText(a) || '–')}</td><td>${terminKurz(a)}</td><td class="r num">${zaehlerKurz(a)}</td><td class="c">${a.offeneMaengel ? `<span class="count red">${a.offeneMaengel}</span>` : '<span class="muted">–</span>'}</td>${k ? `<td class="r num nw">${'kostenJahr' in a ? fmt.eur0(a.kostenJahr || 0) : ''}</td>` : ''}</tr>`; }).join('')}</tbody></table></div></div>`;
  }
  function zeichne() {
    const anzahl = (g) => alle.filter((a) => gruppeVon(a) === g).length;
    el.innerHTML = `<div class="page fp-page">
      ${kopf()}
      <div class="fp-schnell">
        <button type="button" class="act-btn fp-schaden" data-akt="schaden">${ic('camera')}Schaden melden</button>
        <button type="button" class="act-btn" data-akt="mangel">${ic('alert')}Mangel melden</button>
        <button type="button" class="act-btn" data-akt="zaehler">${ic('gauge')}Zählerstand eintragen</button>
        ${darf ? `<button type="button" class="act-btn" data-akt="neu">${ic('plus')}Neues Gerät</button>` : ''}
      </div>
      <div class="toolbar fp-filter">
        <label class="search grow"><span>${ic('truck')}</span><input type="search" id="fp-suche" placeholder="Bezeichnung, Kennzeichen, Nummer …" aria-label="Geräte durchsuchen" autocomplete="off" value="${esc(suche)}"></label>
        <label class="field inline fp-status"><span class="vh">Status</span><select class="input" id="fp-status" aria-label="Nach Status filtern"><option value="">Alle Zustände</option>${['einsatzbereit', 'bald', 'faellig', 'ueberfaellig', 'gesperrt'].map((s) => `<option value="${s}" ${status === s ? 'selected' : ''}>${esc(STATUS[s][0])}</option>`).join('')}</select></label>
        ${darf ? `<label class="check-inline"><input type="checkbox" id="fp-inaktiv" ${inaktiv ? 'checked' : ''}> Ausgeschiedene anzeigen</label>` : ''}
      </div>
      <div class="fp-arten" role="group" aria-label="Nach Art filtern"><button type="button" class="chip-btn${art ? '' : ' on'}" data-art="" aria-pressed="${!art}">Alle <span>${alle.length}</span></button>${ART_GRUPPEN.filter((g) => anzahl(g[0])).map((g) => `<button type="button" class="chip-btn${art === g[0] ? ' on' : ''}" data-art="${g[0]}" aria-pressed="${art === g[0]}">${esc(g[1])} <span>${anzahl(g[0])}</span></button>`).join('')}</div>
      <div id="fp-liste">${listeHtml()}</div>
    </div>`;
  }
  const nurListe = () => { $('#fp-liste', el).innerHTML = listeHtml(); };
  el.addEventListener('input', (e) => { if (e.target.id === 'fp-suche') { suche = e.target.value.trim().toLowerCase(); nurListe(); } });
  el.addEventListener('change', async (e) => {
    if (e.target.id === 'fp-status') { status = e.target.value; nurListe(); }
    if (e.target.id === 'fp-inaktiv') { inaktiv = e.target.checked; try { alle = await get('/fuhrpark/anlagen' + (inaktiv ? '?inaktiv=1' : '')); } catch (x) { toast(x.message, 'warn'); } zeichne(); }
  });
  el.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-art]');
    if (a) { art = a.dataset.art; $$('[data-art]', el).forEach((b) => { const an = b.dataset.art === art; b.classList.toggle('on', an); b.setAttribute('aria-pressed', an); }); nurListe(); return; }
    const zeile = e.target.closest('tr[data-anlage]');
    if (zeile && !e.target.closest('a')) { location.hash = `#/fuhrpark/anlage/${zeile.dataset.anlage}`; return; }
    const akt = e.target.closest('[data-akt]'); if (!akt) return;
    const aktive = alle.filter((x) => x.status !== 'ausgeschieden');
    if (akt.dataset.akt === 'schaden') schadenMelden(ctx, { anlagen: aktive });
    else if (akt.dataset.akt === 'mangel') mangelMelden(ctx, { anlagen: aktive });
    else if (akt.dataset.akt === 'neu') anlageDialog(ctx);
    else if (akt.dataset.akt === 'zaehler') {
      const mit = aktive.filter((x) => (x.zaehler || []).length);
      const eigene = mit.filter((x) => x.verantwortlich && x.verantwortlich.id === ich);
      const wahl = eigene.length === 1 ? eigene[0] : await waehleAnlage('Zählerstand: welches Gerät?', [...eigene, ...mit.filter((x) => !eigene.includes(x))]);
      if (!wahl) return;
      // Die Liste kennt nur den aktuellen Stand – für „letzter Stand am …“ die Anlage nachladen
      let voll = wahl; try { voll = await get(`/fuhrpark/anlagen/${wahl.id}`); } catch (x) { /* Kurzinfo genügt */ }
      zaehlerstandDialog(ctx, voll);
    }
  });
  zeichne();
}
// Auswahl eines Geräts (mit Suche)
export function waehleAnlage(titel, anlagen) {
  const zeile = (a) => `<button type="button" class="pick-row" data-wahl="${a.id}"><span class="site-ic">${ic(a.gesperrt ? 'lock' : 'truck')}</span><span class="pick-txt"><small>${esc([a.nummer, KLASSE[a.klasse]].filter(Boolean).join(' · '))}</small><b>${esc(a.bezeichnung)}</b><span>${esc(a.kennzeichen || '')}</span></span>${ic('right')}</button>`;
  const d = dialog({ titel, inhalt: `<label class="search"><span>${ic('truck')}</span><input type="search" id="wa-suche" placeholder="Gerät oder Kennzeichen suchen" aria-label="Gerät suchen" autocomplete="off"></label><div class="pick-list" id="wa-liste"></div>` });
  const fuelle = () => { const q = $('#wa-suche', d.el).value.trim().toLowerCase(); const s = anlagen.filter((a) => !q || `${a.bezeichnung} ${a.kennzeichen || ''} ${a.nummer || ''}`.toLowerCase().includes(q)); $('#wa-liste', d.el).innerHTML = s.length ? s.map(zeile).join('') : '<div class="state empty small"><p>Kein Gerät gefunden.</p></div>'; };
  $('#wa-suche', d.el).addEventListener('input', fuelle); fuelle();
  d.el.addEventListener('click', (e) => { const r = e.target.closest('[data-wahl]'); if (r) d.zu(anlagen.find((a) => String(a.id) === r.dataset.wahl)); });
  return d.geschlossen;
}

/* =================== Übersicht (fuhrpark) =================== */
const posZeile = (p, mitAnlage = true) => {
  const a = p.anlage || {};
  return `<li data-status="${esc(p.status)}"><a class="fp-frist" href="#/fuhrpark/anlage/${p.anlageId}?reiter=plan"><span class="fp-tag">${p.naechstesDatum ? `<b>${esc(fmt.datum(p.naechstesDatum).slice(0, 6))}</b><small>${esc(fmt.dt(p.naechstesDatum).getFullYear())}</small>` : '<b>–</b>'}</span>
    <span class="grow"><b>${esc(p.titel)}${p.pruefen ? ' <span class="chip xs st-amber" title="Intervall noch nicht abgestimmt">Prüfen</span>' : ''}</b>${mitAnlage ? `<small>${esc(a.bezeichnung || '')}${a.kennzeichen ? ' · ' + esc(a.kennzeichen) : ''}</small>` : ''}<small class="fp-dues">${faelligHtml(p)}</small></span>${statusChip(p.status)}</a></li>`;
};
async function uebersicht(el, ctx, kopf) {
  const [u, alle] = await Promise.all([get('/fuhrpark/uebersicht'), get('/fuhrpark/anlagen')]);
  const maengel = Array.isArray(u.offeneMaengel) ? u.offeneMaengel : await get('/fuhrpark/maengel?status=offen').catch(() => []);
  const schaeden = arr(u.offeneSchaeden);
  const n = { einsatzbereit: 0, bald: 0, faellig: 0, ueberfaellig: 0, gesperrt: 0 };
  alle.forEach((a) => { const s = anlageStatus(a); if (s in n) n[s]++; });
  const ueber = arr(u.ueberfaellig), naechste = arr(u.naechsteTermine), nz = arr(u.nichtZugeordnet);
  const unpl = Array.isArray(u.unplausibleStaende) ? u.unplausibleStaende : null;
  const unplZahl = unpl ? unpl.length : Number(u.unplausibleStaende) || 0;
  const offen = maengel.length || (typeof u.offeneMaengel === 'number' ? u.offeneMaengel : arr(u.offeneMaengel).length);
  const kachel = (s, hinweis) => `<a class="kpi fp-kpi k-${s}" href="#/fuhrpark?reiter=geraete&status=${s}" data-kpi="${s}"><small>${ic(STATUS[s][2])}${esc(STATUS[s][0])}</small><b>${n[s]}</b><em>${esc(hinweis)}</em></a>`;
  el.innerHTML = `<div class="page fp-page">
    ${kopf()}
    <div class="kpi-row fp-ampel" aria-label="Zustand des Fuhrparks">
      ${kachel('einsatzbereit', 'keine Frist offen')}${kachel('bald', 'Termin planen')}${kachel('faellig', 'jetzt erledigen')}${kachel('ueberfaellig', 'Frist überschritten')}${kachel('gesperrt', 'nicht verwenden')}
    </div>
    ${'kostenJahr' in u ? `<div class="kosten-zeile" id="fp-kosten"><span>Werkstatt- und Servicekosten ${new Date().getFullYear()} (netto)</span><b>${fmt.eur(u.kostenJahr || 0)}</b></div>` : ''}
    <div class="two-col">
      <div class="stack">
        <section class="card" aria-labelledby="h-ueber"><div class="card-h pad-h"><h3 id="h-ueber">${ic('alert')}Überfällig <span class="count${ueber.length ? ' red' : ''}">${ueber.length}</span></h3></div>
          ${ueber.length ? `<ul class="plain fp-fristen" id="fp-ueberfaellig">${ueber.map((p) => posZeile(p)).join('')}</ul>` : leer('Nichts überfällig.', 'check')}</section>
        <section class="card" aria-labelledby="h-naechste"><div class="card-h pad-h"><h3 id="h-naechste">${ic('calendar')}Nächste Termine <span class="count">${naechste.length}</span></h3><a class="btn ghost sm" href="#/fuhrpark?reiter=fristen">Alle Fristen</a></div>
          ${naechste.length ? `<ul class="plain fp-fristen" id="fp-naechste">${naechste.slice(0, 12).map((p) => posZeile(p)).join('')}</ul>${naechste.length > 12 ? `<p class="card-note">und ${naechste.length - 12} weitere in den nächsten 90 Tagen</p>` : ''}` : leer('In den nächsten 90 Tagen steht nichts an.', 'calendar')}</section>
      </div>
      <div class="stack">
        <section class="card" aria-labelledby="h-mg"><div class="card-h pad-h"><h3 id="h-mg">${ic('alert')}Offene Mängel <span class="count${offen ? ' red' : ''}">${offen}</span></h3></div>
          ${maengel.length ? `<ul class="plain rows" id="fp-maengel">${maengel.slice(0, 8).map((m) => `<li data-mangel="${m.id}"><span class="grow"><b>${esc(m.text)}</b><small>${esc((m.anlage && m.anlage.bezeichnung) || '')} · ${esc((m.gemeldetVon && m.gemeldetVon.name) || '')} · ${esc(fmt.zeitpunkt(m.gemeldet))}</small></span>${dringChip(m.dringlichkeit)}${mangelChip(m.status)}<button type="button" class="btn ghost sm" data-mangel-bearb="${m.id}">Bearbeiten</button></li>`).join('')}</ul>` : leer('Keine offenen Mängel.', 'check')}</section>
        <section class="card" aria-labelledby="h-sch"><div class="card-h pad-h"><h3 id="h-sch">${ic('camera')}Offene Schäden <span class="count${schaeden.length ? ' red' : ''}">${schaeden.length}</span></h3><a class="btn ghost sm" href="#/fuhrpark?reiter=schaeden">Alle Schäden</a></div>
          ${schaeden.length ? `<ul class="plain rows" id="fp-schaeden">${schaeden.slice(0, 6).map((x) => `<li><a class="grow" href="#/fuhrpark?reiter=schaeden&schaden=${x.id}"><b>${esc(x.anlage ? x.anlage.bezeichnung : x.fremdGeraet || 'Gerät')}</b><small>${esc(x.ursache || '')}</small></a>${x.einsatzfaehig === 'nein' ? `<span class="chip xs st-red">${ic('lock')}stillgelegt</span>` : ''}</li>`).join('')}</ul>` : leer('Keine offenen Schäden.', 'check')}</section>
        ${unplZahl ? `<section class="card pad" id="fp-unplausibel">${banner('warn', `<b>${unplZahl} unplausible${unplZahl === 1 ? 'r Zählerstand' : ' Zählerstände'}</b> – bitte beim Gerät unter „Zähler“ bestätigen oder verwerfen.${unpl ? ' ' + unpl.slice(0, 5).map((s) => `<a class="lnk" href="#/fuhrpark/anlage/${s.anlageId}?reiter=zaehler">${esc((s.anlage && s.anlage.bezeichnung) || s.bezeichnung || 'Gerät')}</a>`).join(', ') : ''}`)}</section>` : ''}
        <section class="card" aria-labelledby="h-nz"><div class="card-h pad-h"><h3 id="h-nz">${ic('clipboard')}Gerätestunden ohne Zuordnung <span class="count">${nz.length}</span></h3></div>
          ${nz.length ? `<ul class="plain rows" id="fp-nicht-zugeordnet">${nz.map((g) => `<li><span class="grow"><b>${esc(g.name)}</b><small>${g.berichte != null ? `${Array.isArray(g.berichte) ? g.berichte.length : g.berichte} ${(Array.isArray(g.berichte) ? g.berichte.length : g.berichte) === 1 ? 'Bericht' : 'Berichte'} in den letzten 90 Tagen` : ''}</small></span><b class="num nw">${esc(fmt.std(g.stunden))}</b></li>`).join('')}</ul><p class="card-note">Für diese Gerätezeilen gibt es kein oder mehrere Geräte. Im Bautagesbericht das Gerät auswählen oder das Gerät hier anlegen – sonst fehlen die Stunden für die Service-Prognose.</p>` : leer('Alle Gerätestunden sind einem Gerät zugeordnet.', 'check')}</section>
        <section class="card pad" aria-labelledby="h-exp"><div class="card-h"><h3 id="h-exp">${ic('download')}Exporte</h3></div>
          <div class="fp-export"><a class="btn ghost" href="/api/fuhrpark/export.csv?art=fristen" download data-export="fristen">${ic('table')}Fristen (CSV)</a><a class="btn ghost" href="/api/fuhrpark/export.csv?art=anlagen" download data-export="anlagen">${ic('table')}Geräteliste (CSV)</a><a class="btn ghost" href="/api/fuhrpark/export.csv?art=eintraege" download data-export="eintraege">${ic('table')}Servicebuch-Einträge (CSV)</a></div>
          <p class="muted sm">Das Servicebuch als PDF gibt es beim jeweiligen Gerät.${ctx.kann('preise_sehen') ? '' : ' Exporte enthalten keine Kosten.'}</p></section>
      </div>
    </div></div>`;
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-mangel-bearb]'); if (b) mangelBearbeiten(ctx, maengel.find((m) => String(m.id) === b.dataset.mangelBearb)); });
}

/* =================== Fristen (fuhrpark) =================== */
async function fristen(el, ctx, kopf) {
  let monate = Number(ctx.query.get('monate')) || 6;
  let art = '', klasse = '';
  let daten = [];
  const lade = async () => { const bis = new Date(); bis.setMonth(bis.getMonth() + monate); daten = await get(`/fuhrpark/fristen?bis=${fmt.iso(bis)}`); };
  await lade();
  const gruppeVon = (kl) => (ART_GRUPPEN.find((g) => g[2].includes(kl)) || ['sonstiges'])[0];
  function inhalt() {
    const sicht = daten.filter((p) => (!art || p.art === art) && (!klasse || gruppeVon(p.anlage && p.anlage.klasse) === klasse));
    if (!sicht.length) return `<div class="card">${leer('Keine Fristen im gewählten Zeitraum.', 'calendar')}</div>`;
    const ueber = sicht.filter((p) => p.status === 'ueberfaellig');
    const rest = sicht.filter((p) => p.status !== 'ueberfaellig');
    const gruppen = new Map();
    rest.forEach((p) => { const k = p.naechstesDatum ? p.naechstesDatum.slice(0, 7) : 'ohne'; if (!gruppen.has(k)) gruppen.set(k, []); gruppen.get(k).push(p); });
    const heuteM = fmt.iso().slice(0, 7);
    return `${ueber.length ? `<section class="card fp-monat ueber" aria-label="Überfällig"><div class="card-h pad-h"><h3>${ic('alert')}Überfällig <span class="count red">${ueber.length}</span></h3></div><ul class="plain fp-fristen">${ueber.map((p) => posZeile(p)).join('')}</ul></section>` : ''}
      ${[...gruppen.entries()].sort(([a], [b]) => (a === 'ohne' ? 1 : b === 'ohne' ? -1 : a.localeCompare(b))).map(([k, l]) => `<section class="card fp-monat" data-monat="${k}" aria-label="${k === 'ohne' ? 'Ohne Termin' : esc(fmt.monat(k))}"><div class="card-h pad-h"><h3>${ic('calendar')}${k === 'ohne' ? 'Ohne Termin' : k < heuteM ? `${esc(fmt.monat(k))} (offen)` : esc(fmt.monat(k))} <span class="count">${l.length}</span></h3></div><ul class="plain fp-fristen">${l.map((p) => posZeile(p)).join('')}</ul></section>`).join('')}`;
  }
  function zeichne() {
    el.innerHTML = `<div class="page fp-page">${kopf()}
      <div class="toolbar fp-filter">
        <div class="tabs" role="group" aria-label="Zeitraum">${[3, 6, 12].map((m) => `<button type="button" data-monate="${m}" class="${m === monate ? 'on' : ''}" aria-pressed="${m === monate}">${m} Monate</button>`).join('')}</div>
        <label class="field inline"><span class="vh">Art des Geräts</span><select class="input" id="fr-klasse" aria-label="Art des Geräts"><option value="">Alle Geräte</option>${ART_GRUPPEN.map((g) => `<option value="${g[0]}" ${klasse === g[0] ? 'selected' : ''}>${esc(g[1])}</option>`).join('')}</select></label>
        <label class="field inline"><span class="vh">Art der Frist</span><select class="input" id="fr-art" aria-label="Art der Frist"><option value="">Alle Fristen</option>${Object.entries(PLAN_ART).map(([k, t]) => `<option value="${k}" ${art === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <span class="grow"></span><a class="btn ghost" href="/api/fuhrpark/export.csv?art=fristen" download>${ic('download')}CSV</a>
      </div>
      <p class="muted sm">Termine nach Betriebsstunden oder Kilometern sind hochgerechnet („voraussichtlich fällig am …“) – Grundlage sind die Zählerstände und die Gerätestunden aus den Bautagesberichten.</p>
      <div id="fr-liste" class="stack">${inhalt()}</div></div>`;
  }
  el.addEventListener('change', (e) => { if (e.target.id === 'fr-art') art = e.target.value; else if (e.target.id === 'fr-klasse') klasse = e.target.value; else return; $('#fr-liste', el).innerHTML = inhalt(); });
  el.addEventListener('click', async (e) => { const m = e.target.closest('[data-monate]'); if (!m) return; monate = Number(m.dataset.monate); try { await lade(); } catch (x) { toast(x.message, 'warn'); } if (ctx.aktuell()) zeichne(); });
  zeichne();
}

/* =================== Vorlagen (fuhrpark) =================== */
async function vorlagen(el, ctx, kopf) {
  const vl = await get('/fuhrpark/vorlagen');
  const klassen = (v) => arr(v.klassen).map((k) => { const [kl, fz] = String(k).split(':'); return (KLASSE[kl] || (kl === 'alle' ? 'alle' : kl)) + (fz ? ' ' + fz : ''); }).join(', ');
  el.innerHTML = `<div class="page fp-page">${kopf()}
    ${banner('info', 'Die Intervalle sind <b>Startwerte aus der Recherche</b>. Vorlagen mit dem Kennzeichen „Prüfen“ bitte mit Prüfstelle, WKO bzw. Serviceheft abstimmen und danach das Kennzeichen entfernen.')}
    <div class="card"><div class="tbl-wrap"><table class="tbl fp-vorl" id="fp-vorlagen"><thead><tr><th>Vorlage</th><th>Art</th><th>Gilt für</th><th>Intervall</th><th class="c">Sperrt</th><th></th></tr></thead>
    <tbody>${vl.map((v) => `<tr data-vorlage="${esc(v.schluessel)}" class="${v.aktiv === false || v.aktiv === 0 ? 'inaktiv' : ''}"><td class="fp-haupt">${esc(v.titel)} ${v.pruefen ? '<span class="chip xs st-amber" data-pruefen>Prüfen</span>' : ''}${v.aktiv === false || v.aktiv === 0 ? ' <span class="chip xs st-grey">inaktiv</span>' : ''}<small>${esc(v.rechtsgrundlage || '')}${v.gueltigAb ? ` · gültig ab ${esc(fmt.datum(v.gueltigAb))}` : ''}</small></td><td>${esc(PLAN_ART[v.art] || v.art)}</td><td>${esc(klassen(v))}</td><td>${esc(regelText(v.regel))}</td><td class="c">${v.regel && v.regel.sperrtBeiUeberfaellig ? ic('lock', 'xs') + '<span class="vh">ja</span>' : '<span class="muted">–</span>'}</td>
      <td class="r nw"><button type="button" class="btn ghost sm" data-v-bearb="${v.id}">${ic('edit')}Bearbeiten</button> <button type="button" class="btn ghost sm" data-v-anw="${v.id}">Auf Geräte anwenden</button></td></tr>`).join('')}</tbody></table></div></div></div>`;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v-bearb]'); if (b) { vorlageDialog(ctx, vl.find((v) => String(v.id) === b.dataset.vBearb)); return; }
    const a = e.target.closest('[data-v-anw]'); if (a) vorlageAnwenden(ctx, vl.find((v) => String(v.id) === a.dataset.vAnw));
  });
}
