// Urlaubsübersicht und Urlaubskonto (API.md 12.19). Keine €-Felder.
// PC/Tablet: Team-Kalender (Zeilen = Mitarbeiter je Partie, Spalten = Tage), Jahresübersicht, Konten, offene Anträge, Warnungen.
// Handy: „Mein Urlaub“ (Konto, Liste, Antrag) – Polier/Bauleiter/Büro zusätzlich die Abwesenheiten ihres Bereichs.
// Beantragt und genehmigt unterscheiden sich in Helligkeit UND Muster (schraffiert/umrandet gegen gefüllt), nicht nur in der Farbe.
import { get, post, put, del } from '../api.js';
import { ic, esc, fmt, parseZahl, leer, banner, dialog, bestaetigen, toast, rolleText, speicher, $ } from '../ui.js';
import { wienHeute } from '../zahl.js';

const CODES = { U: 'Urlaub', ZA: 'Zeitausgleich', K: 'Krank', SW: 'Schlechtwetter', BU: 'Betriebsurlaub', abwesend: 'abwesend' };
const MON = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const monEnde = (ym) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`; };
const monPlus = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const zelleKl = (e) => (e ? `ur-${esc(e.code)} ${e.status === 'genehmigt' ? 'ok' : e.status === 'abgelehnt' ? 'nein' : 'offen'}` : '');
const legende = () => `<div class="ur-legende" id="ur-legende" aria-label="Legende">${['U', 'ZA', 'K', 'SW', 'BU'].map((c) => `<span><i class="ur-z ur-${c} ok">${c}</i>${CODES[c]}</span>`).join('')}<span><i class="ur-z ur-U offen">U</i>beantragt (schraffiert)</span><span><i class="ur-z ur-U ok">U</i>genehmigt (gefüllt)</span><span><i class="ur-z feiertag">F</i>Feiertag</span><span><i class="ur-z we"></i>Wochenende</span></div>`;

export default async function urlaub(el, ctx) {
  const ich = ctx.ich.benutzer, heute = wienHeute();
  const verwaltet = ctx.kann('stammdaten') || ctx.kann('lohn');
  const darfBu = ctx.kann('stammdaten');
  const leitet = verwaltet || ['bauleiter', 'polier'].includes(ich.rolle); // sieht mehr als sich selbst
  const handy = window.matchMedia('(max-width: 719px)').matches;
  let tab = ['monat', 'jahr', 'konten'].includes(ctx.query.get('ansicht')) ? ctx.query.get('ansicht') : 'monat';
  let monat = /^\d{4}-\d{2}$/.test(ctx.query.get('monat') || '') ? ctx.query.get('monat') : heute.slice(0, 7);
  let jahr = Number(monat.slice(0, 4));
  let fBs = '', fRolle = '';
  let kal = { tage: [], personen: [], warnungen: [] }, konten = [], baustellen = [], jahrDaten = null, fehler = '';
  const bsName = (id) => { const b = baustellen.find((x) => Number(x.id) === Number(id)); return b ? b.kurz || b.name : 'Ohne Partie'; };

  async function ladeKal(von, bis) { return get(`/urlaub/kalender?von=${von}&bis=${bis}${fBs ? '&baustelleId=' + fBs : ''}`); }
  async function lade() {
    fehler = '';
    try {
      if (handy) { [kal, konten] = await Promise.all([ladeKal(heute, fmt.addTage(heute, 60)), get(`/urlaub/konto?jahr=${jahr}`)]); return; }
      if (tab === 'monat') kal = await ladeKal(`${monat}-01`, monEnde(monat));
      else if (tab === 'jahr') { const teile = await Promise.all([0, 2, 4, 6, 8, 10].map((m) => ladeKal(`${jahr}-${String(m + 1).padStart(2, '0')}-01`, monEnde(`${jahr}-${String(m + 2).padStart(2, '0')}`)))); const map = new Map(); teile.forEach((t) => t.personen.forEach((p) => { if (!map.has(p.benutzerId)) map.set(p.benutzerId, { ...p, tage: {} }); Object.assign(map.get(p.benutzerId).tage, p.tage); })); jahrDaten = [...map.values()]; }
      else konten = await get(`/urlaub/konto?jahr=${jahr}`);
    } catch (e) { if (e.status === 401 || e.netz) throw e; fehler = e.status === 403 ? 'Kein Zugriff.' : e.message; }
  }
  baustellen = leitet ? await get('/baustellen').catch(() => []) : [];
  await lade();

  const sichtbar = (p) => !fRolle || p.rolle === fRolle;
  const gruppen = (personen) => { const g = new Map(); personen.filter(sichtbar).forEach((p) => { const k = p.baustelleId ?? 0; if (!g.has(k)) g.set(k, []); g.get(k).push(p); }); return [...g.entries()].sort((a, b) => bsName(a[0]).localeCompare(bsName(b[0]), 'de')); };
  const offeneAntraege = () => { const l = []; kal.personen.forEach((p) => Object.entries(p.tage || {}).forEach(([datum, e]) => { if (e.status === 'beantragt') l.push({ ...e, datum, benutzerId: p.benutzerId, name: p.name }); })); return l.sort((a, b) => a.datum.localeCompare(b.datum)); };
  const darfEntscheiden = (benutzerId) => ctx.kann('stammdaten') && Number(benutzerId) !== Number(ich.id);

  /* ---------- Monat ---------- */
  function monatHtml() {
    const [y, m] = monat.split('-').map(Number);
    const offen = offeneAntraege();
    return `<div class="toolbar wrap"><div class="wp-nav"><button type="button" class="icon-btn" data-mon="-1" aria-label="Voriger Monat">${ic('left')}</button><b id="ur-monat">${MON[m - 1]} ${y}</b><button type="button" class="icon-btn" data-mon="1" aria-label="Nächster Monat">${ic('right')}</button><button type="button" class="btn ghost sm" data-mon="0">Heute</button></div><span class="grow"></span>
        ${leitet ? `<label class="field inline"><span class="vh">Partie / Baustelle</span><select class="input" id="ur-bs"><option value="">Alle Partien</option>${baustellen.filter((b) => !b.intern).map((b) => `<option value="${b.id}" ${String(b.id) === fBs ? 'selected' : ''}>${esc(b.kurz || b.name)}</option>`).join('')}</select></label>
        <label class="field inline"><span class="vh">Rolle</span><select class="input" id="ur-rolle"><option value="">Alle Rollen</option>${['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf'].map((r) => `<option value="${r}" ${fRolle === r ? 'selected' : ''}>${esc(rolleText(r))}</option>`).join('')}</select></label>` : ''}
        ${darfBu ? `<button type="button" class="btn ghost" id="ur-bu">${ic('calendar')}Betriebsurlaub eintragen</button><button type="button" class="icon-btn" id="ur-einst" aria-label="Einstellungen Urlaub" title="Einstellungen">${ic('wrench')}</button>` : ''}</div>
      ${(kal.warnungen || []).length ? `<section class="card pad" id="ur-warnungen" aria-label="Warnungen"><ul class="warn-list">${kal.warnungen.map((w) => `<li data-warnung="${esc(w.typ)}">${ic('alert')}<span>${w.datum ? `<b>${esc(fmt.datumKurz(w.datum))}</b> ` : ''}${esc(w.text)}${w.typ === 'plan_konflikt' ? ` <a class="link sm" href="#/plan?datum=${w.datum}&ansicht=woche">im Planer ansehen</a>` : ''}</span></li>`).join('')}</ul></section>` : ''}
      <div class="ur-wrap">
        <section class="card ur-karte" aria-label="Team-Kalender ${MON[m - 1]} ${y}"><div class="wp-scroll"><table class="ur-tbl" id="ur-kalender"><thead><tr><th class="ur-name">Mitarbeiter</th>${kal.tage.map((t) => { const d = fmt.dt(t.datum); return `<th class="${t.feiertag ? 'feiertag' : !t.arbeitstag ? 'we' : ''}${t.datum === heute ? ' heute' : ''}" title="${t.feiertag ? esc(t.feiertag === true ? 'Feiertag' : t.feiertag) : ''}"><small>${fmt.WTK[d.getDay()]}</small>${d.getDate()}</th>`; }).join('')}</tr></thead>
          <tbody>${gruppen(kal.personen).map(([bs, leute]) => `<tr class="ur-gruppe"><th colspan="${kal.tage.length + 1}">${esc(bsName(bs))} · ${leute.length}</th></tr>${leute.map((p) => `<tr data-person="${p.benutzerId}"><th class="ur-name" scope="row">${esc(p.name)}<small>${esc(rolleText(p.rolle))}</small></th>${kal.tage.map((t) => { const e = (p.tage || {})[t.datum]; const frei = t.feiertag ? 'feiertag' : !t.arbeitstag ? 'we' : ''; return `<td class="${frei}"><button type="button" class="ur-z ${frei} ${zelleKl(e)}" data-zelle data-datum="${t.datum}" data-person="${p.benutzerId}" ${e ? `data-code="${esc(e.code)}" data-status="${esc(e.status)}" data-id="${e.id}"` : ''} aria-label="${esc(p.name)}, ${esc(fmt.datumKurz(t.datum))}: ${e ? `${esc(CODES[e.code] || e.code)} ${esc(e.status)}` : t.feiertag ? 'Feiertag' : 'frei'}">${e ? esc(e.code === 'abwesend' ? '–' : e.code) : t.feiertag ? 'F' : ''}</button></td>`; }).join('')}</tr>`).join('')}`).join('') || `<tr><td colspan="${kal.tage.length + 1}">${leer('Niemand in diesem Bereich.', 'users')}</td></tr>`}</tbody></table></div>${legende()}</section>
        ${leitet ? `<aside class="card ur-seite" id="ur-antraege" aria-label="Offene Anträge"><h3>Offene Anträge <span class="count${offen.length ? ' red' : ''}">${offen.length}</span></h3>${offen.length ? `<ul class="plain rows">${offen.map((a) => `<li data-antrag="${a.id}"><span class="grow"><b>${esc(a.name)}</b><small>${esc(fmt.datumKurz(a.datum))} · ${esc(CODES[a.code] || a.code)}</small></span>${darfEntscheiden(a.benutzerId) ? `<button type="button" class="btn ghost sm" data-entscheid="genehmigt" data-id="${a.id}" aria-label="Antrag von ${esc(a.name)} genehmigen">${ic('check', 'xs')}</button><button type="button" class="btn ghost sm" data-entscheid="abgelehnt" data-id="${a.id}" aria-label="Antrag von ${esc(a.name)} ablehnen">${ic('x', 'xs')}</button>` : ''}</li>`).join('')}</ul>` : '<p class="muted sm">Keine offenen Anträge in diesem Monat.</p>'}</aside>` : ''}
      </div>`;
  }
  /* ---------- Jahr: kompakte Wärmekarte (Abwesenheitstage je Monat) ---------- */
  function jahrHtml() {
    const zaehl = (p, mi) => { const pre = `${jahr}-${String(mi + 1).padStart(2, '0')}`; return Object.entries(p.tage || {}).filter(([dt, e]) => dt.startsWith(pre) && e.status !== 'abgelehnt').length; };
    const stufe = (n) => (n === 0 ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : n <= 10 ? 3 : 4);
    return `<div class="toolbar"><div class="wp-nav"><button type="button" class="icon-btn" data-jahr="-1" aria-label="Voriges Jahr">${ic('left')}</button><b id="ur-jahr">${jahr}</b><button type="button" class="icon-btn" data-jahr="1" aria-label="Nächstes Jahr">${ic('right')}</button></div><span class="muted sm">Abwesenheitstage je Monat – je dunkler, desto mehr. Klick auf einen Monat öffnet den Kalender.</span></div>
      <section class="card"><div class="wp-scroll"><table class="ur-tbl jahr" id="ur-jahr-tbl"><thead><tr><th class="ur-name">Mitarbeiter</th>${MON.map((n) => `<th>${n.slice(0, 3)}</th>`).join('')}<th>Summe</th></tr></thead><tbody>${gruppen(jahrDaten || []).map(([bs, leute]) => `<tr class="ur-gruppe"><th colspan="14">${esc(bsName(bs))}</th></tr>${leute.map((p) => { const z = MON.map((_, i) => zaehl(p, i)); return `<tr><th class="ur-name" scope="row">${esc(p.name)}</th>${z.map((n, i) => `<td><button type="button" class="ur-hz s${stufe(n)}" data-zum-monat="${jahr}-${String(i + 1).padStart(2, '0')}" aria-label="${esc(p.name)}, ${MON[i]}: ${n} Tage">${n || ''}</button></td>`).join('')}<td class="num"><b>${z.reduce((a, b) => a + b, 0)}</b></td></tr>`; }).join('')}`).join('')}</tbody></table></div>
        <div class="ur-legende"><span><i class="ur-hz s1">1</i>1–2</span><span><i class="ur-hz s2">4</i>3–5</span><span><i class="ur-hz s3">8</i>6–10</span><span><i class="ur-hz s4">15</i>über 10 Tage</span></div></section>`;
  }
  /* ---------- Konten ---------- */
  const anspruchText = (k) => `${fmt.zahl(k.anspruch, 1)} ${esc(k.einheit || 'Arbeitstage')}${k.art === 'buak' ? `<small class="muted">laut BUAK-Kontoauszug${k.buak && k.buak.datum ? ' vom ' + esc(fmt.datum(k.buak.datum)) : ' – noch nicht eingetragen'}</small>` : ''}`;
  function kontenHtml() {
    return `<div class="toolbar wrap"><div class="wp-nav"><button type="button" class="icon-btn" data-jahr="-1" aria-label="Voriges Jahr">${ic('left')}</button><b>Urlaubsjahr ${jahr}</b><button type="button" class="icon-btn" data-jahr="1" aria-label="Nächstes Jahr">${ic('right')}</button></div><span class="grow"></span>${verwaltet ? `<a class="btn ghost" id="ur-csv" href="/api/urlaub/export.csv?jahr=${jahr}" download>${ic('download')}CSV für die Lohnverrechnung</a>` : ''}</div>
      <section class="card">${konten.length ? `<div class="tbl-wrap"><table class="tbl" id="ur-konten"><thead><tr><th>Mitarbeiter</th><th>Anspruch</th><th class="num">Übertrag</th><th class="num">Genommen</th><th class="num">Geplant</th><th class="num">Beantragt</th><th class="num">Rest</th>${verwaltet ? '<th></th>' : ''}</tr></thead><tbody>${konten.map((k) => `<tr data-konto="${k.benutzerId}"><td><b>${esc(k.name)}</b><small class="muted"> ${esc(rolleText(k.rolle))}</small>${k.hinweis ? `<small class="muted block">${esc(k.hinweis)}</small>` : ''}</td><td>${anspruchText(k)}</td><td class="num">${fmt.zahl(k.uebertrag, 1)}</td><td class="num">${fmt.zahl(k.genommen, 1)}</td><td class="num">${fmt.zahl(k.geplant, 1)}</td><td class="num">${fmt.zahl(k.beantragt, 1)}</td><td class="num"><b class="${k.rest < 0 ? 'neg' : ''}" data-rest>${fmt.zahl(k.rest, 1)}</b></td>${verwaltet ? `<td><button type="button" class="btn ghost sm" data-konto-edit="${k.benutzerId}">${ic('edit', 'xs')}Konto</button></td>` : ''}</tr>`).join('')}</tbody></table></div>` : leer('Keine Urlaubskonten.', 'calendar')}</section>
      <p class="muted sm">Gezählt werden Arbeitstage (Mo–Fr ohne Feiertage) mit Urlaub oder Betriebsurlaub. Bauarbeiter: Der Anspruch kommt aus dem BUAK-Kontoauszug und gilt ab dessen Datum. Angestellte: Anspruch nach Urlaubsgesetz – bitte mit der Lohnverrechnung abstimmen.</p>`;
  }
  function kontoDialog(k) {
    const dlg = dialog({ titel: `Urlaubskonto ${jahr} · ${k.name}`, breit: true, inhalt: `<form id="ukf" class="form-grid" novalidate>
      <label class="field full"><span class="field-label">Art</span><select class="input lg" name="art"><option value="buak" ${k.art === 'buak' ? 'selected' : ''}>Bauarbeiter – Urlaub über die BUAK</option><option value="urlg" ${k.art !== 'buak' ? 'selected' : ''}>Angestellte – Urlaubsgesetz</option></select></label>
      <label class="field" data-nur="buak"><span class="field-label">Anspruch laut BUAK-Kontoauszug (Tage)</span><input class="input lg num" name="buakStand" inputmode="decimal" value="${k.buak && k.buak.stand != null ? esc(fmt.zahl(k.buak.stand, 1)) : ''}"></label>
      <label class="field" data-nur="buak"><span class="field-label">Datum des Kontoauszugs</span><input class="input lg" type="date" name="buakDatum" value="${esc((k.buak && k.buak.datum) || '')}"></label>
      <label class="field" data-nur="urlg"><span class="field-label">Anspruch</span><input class="input lg num" name="anspruch" inputmode="decimal" value="${esc(fmt.zahl(k.anspruch, 1))}"></label>
      <label class="field" data-nur="urlg"><span class="field-label">Einheit</span><select class="input lg" name="einheit"><option ${k.einheit !== 'Werktage' ? 'selected' : ''}>Arbeitstage</option><option ${k.einheit === 'Werktage' ? 'selected' : ''}>Werktage</option></select></label>
      <label class="field"><span class="field-label">Übertrag aus dem Vorjahr</span><input class="input lg num" name="uebertrag" inputmode="decimal" value="${esc(fmt.zahl(k.uebertrag || 0, 1))}"></label>
      <label class="field full"><span class="field-label">Notiz</span><input class="input lg" name="notiz" maxlength="300" value="${esc(k.notiz || '')}"></label>
      <p class="muted sm full" data-nur="buak">Genommene und geplante Tage zählen erst ab dem Datum des Kontoauszugs.</p><p class="muted sm full" data-nur="urlg">Üblich: 25 Arbeitstage (30 Werktage), ab dem 25. Dienstjahr 30 (36) – bitte mit der Lohnverrechnung prüfen.</p>
      <p class="form-err full" role="alert" hidden></p></form>`, fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="ukf">Speichern</button>' });
    const form = $('#ukf', dlg.el);
    const zeig = () => dlg.el.querySelectorAll('[data-nur]').forEach((x) => { x.hidden = x.dataset.nur !== form.elements.art.value; });
    form.elements.art.addEventListener('change', zeig); zeig();
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(form); const err = $('.form-err', dlg.el);
      const z = (n) => { const t = String(f.get(n) || '').trim(); return t === '' ? null : parseZahl(t); };
      const body = { art: f.get('art'), uebertrag: z('uebertrag') ?? 0, notiz: String(f.get('notiz') || '').trim() };
      if (body.art === 'buak') { body.buakStand = z('buakStand'); body.buakDatum = f.get('buakDatum') || null; if (body.buakStand != null && !body.buakDatum) { err.hidden = false; err.textContent = 'Bitte das Datum des BUAK-Kontoauszugs eintragen.'; return; } } else { body.anspruch = z('anspruch'); body.einheit = f.get('einheit'); }
      if ([body.uebertrag, body.buakStand, body.anspruch].some((x) => x != null && !Number.isFinite(x))) { err.hidden = false; err.textContent = 'Bitte Tage als Zahl eintragen, z. B. 25 oder 12,5.'; return; }
      try { await put(`/urlaub/konto/${k.benutzerId}/${jahr}`, body); dlg.zu(); toast('Urlaubskonto gespeichert.'); neu(); } catch (x) { err.hidden = false; err.textContent = x.message; }
    });
  }
  /* ---------- Zelle: beantragen / eintragen / entscheiden ---------- */
  function zellDialog(z) {
    const pid = Number(z.dataset.person), datum = z.dataset.datum, selbst = pid === Number(ich.id);
    const p = kal.personen.find((x) => Number(x.benutzerId) === pid) || { name: ich.name };
    if (z.dataset.id) {
      const status = z.dataset.status, code = z.dataset.code;
      const kannEntscheiden = status === 'beantragt' && darfEntscheiden(pid);
      const kannWeg = (selbst && status === 'beantragt') || (ctx.kann('stammdaten') && !selbst);
      const dlg = dialog({ titel: `${p.name} · ${fmt.datumKurz(datum)}`, inhalt: `<div class="stack-s" id="ur-eintrag"><p><span class="ur-z ${zelleKl({ code, status })}">${esc(code === 'abwesend' ? '–' : code)}</span> <b>${esc(CODES[code] || code)}</b> – ${esc(status)}</p>${selbst && status === 'beantragt' ? '<p class="muted sm">Eigene Anträge entscheidet immer jemand anderer (Vier-Augen-Prinzip).</p>' : ''}</div>`,
        fuss: `${kannWeg ? `<button class="btn danger" type="button" id="ur-weg">${selbst ? 'Antrag zurückziehen' : 'Löschen'}</button><span class="grow"></span>` : ''}<button class="btn ghost" type="button" data-zu>Schließen</button>${kannEntscheiden ? '<button class="btn ghost" type="button" data-entscheid="abgelehnt">Ablehnen</button><button class="btn primary" type="button" data-entscheid="genehmigt">Genehmigen</button>' : ''}` });
      dlg.el.addEventListener('click', async (e) => {
        const en = e.target.closest('[data-entscheid]');
        if (en) { try { await put(`/abwesenheiten/${z.dataset.id}`, { status: en.dataset.entscheid }); dlg.zu(); toast(en.dataset.entscheid === 'genehmigt' ? 'Antrag genehmigt.' : 'Antrag abgelehnt.'); ctx.meldungenNeu(); } catch (x) { toast(x.message, 'warn'); } return neu(); }
        if (e.target.closest('#ur-weg')) { try { await del(`/abwesenheiten/${z.dataset.id}`); dlg.zu(); toast(selbst ? 'Antrag zurückgezogen.' : 'Abwesenheit gelöscht.'); } catch (x) { toast(x.message, 'warn'); } neu(); }
      });
      return;
    }
    const darfEintragen = selbst || ctx.kann('stammdaten') || ich.rolle === 'polier';
    if (!darfEintragen) return;
    antragDialog(pid, p.name, datum);
  }
  function antragDialog(pid, name, datum) {
    const selbst = pid === Number(ich.id);
    const codes = ctx.kann('stammdaten') && !selbst ? ['U', 'ZA', 'K', 'SW'] : selbst ? ['U', 'ZA'] : ['SW'];
    const dlg = dialog({ titel: selbst ? 'Urlaub beantragen' : `Abwesenheit eintragen · ${name}`, inhalt: `<form id="uaf" class="form-grid" novalidate>
      <label class="field full"><span class="field-label">Art</span><select class="input lg" name="code">${codes.map((c) => `<option value="${c}">${CODES[c]}</option>`).join('')}</select></label>
      <label class="field"><span class="field-label">Von</span><input class="input lg" type="date" name="von" required value="${esc(datum)}"></label>
      <label class="field"><span class="field-label">Bis</span><input class="input lg" type="date" name="bis" required value="${esc(datum)}"></label>
      <p class="muted sm full">${selbst ? 'Der Antrag wartet auf Genehmigung durch das Büro. ' : ''}Wochenenden und Feiertage werden ausgelassen.</p><p class="form-err full" role="alert" hidden></p></form>`,
      fuss: `<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="uaf" id="ua-ok">${selbst ? 'Beantragen' : 'Eintragen'}</button>` });
    $('#uaf', dlg.el).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target); const err = $('.form-err', dlg.el);
      const von = f.get('von'), bis = f.get('bis');
      if (!von || !bis || bis < von) { err.hidden = false; err.textContent = 'Bitte Von und Bis eintragen – Bis darf nicht vor Von liegen.'; return; }
      const frei = new Set((await get(`/urlaub/feiertage?jahr=${von.slice(0, 4)}`).catch(() => [])).map((x) => x.datum));
      const tage = []; for (let t = von; t <= bis && tage.length <= 62; t = fmt.addTage(t, 1)) if (![0, 6].includes(fmt.dt(t).getDay()) && !frei.has(t)) tage.push(t);
      if (!tage.length) { err.hidden = false; err.textContent = 'In diesem Zeitraum liegt kein Arbeitstag.'; return; }
      $('#ua-ok', dlg.el).disabled = true; let ok = 0; const fehl = [];
      for (const t of tage) { try { await post('/abwesenheiten', { benutzerId: pid, datum: t, code: f.get('code') }); ok += 1; } catch (x) { fehl.push(`${fmt.datumKurz(t)}: ${x.message}`); } }
      if (fehl.length && !ok) { $('#ua-ok', dlg.el).disabled = false; err.hidden = false; err.textContent = fehl[0]; return; }
      dlg.zu(); toast(fehl.length ? `${ok} Tag${ok === 1 ? '' : 'e'} eingetragen, ${fehl.length} nicht möglich (${fehl[0]}).` : selbst ? `Antrag für ${ok} Tag${ok === 1 ? '' : 'e'} gestellt.` : `${ok} Tag${ok === 1 ? '' : 'e'} eingetragen.`, fehl.length ? 'warn' : 'ok'); ctx.meldungenNeu(); neu();
    });
  }
  /* ---------- Betriebsurlaub / Winterpause: Vorschau, dann anlegen ---------- */
  function buDialog() {
    const dlg = dialog({ titel: 'Betriebsurlaub eintragen', breit: true, inhalt: `<form id="buf" class="form-grid" novalidate>
      <label class="field"><span class="field-label">Von</span><input class="input lg" type="date" name="von" required value="${jahr}-12-24"></label><label class="field"><span class="field-label">Bis</span><input class="input lg" type="date" name="bis" required value="${jahr + 1}-01-06"></label>
      <label class="field"><span class="field-label">Für wen?</span><select class="input lg" name="wer"><option value="alle">Alle Mitarbeiter</option>${baustellen.filter((b) => !b.intern).map((b) => `<option value="${b.id}">Partie ${esc(b.kurz || b.name)}</option>`).join('')}</select></label>
      <label class="field"><span class="field-label">Wird gebucht als</span><select class="input lg" name="code"><option value="BU">Betriebsurlaub (zählt wie Urlaub)</option><option value="U">Urlaub</option></select></label>
      <label class="field full"><span class="field-label">Notiz</span><input class="input lg" name="notiz" maxlength="200" placeholder="z. B. Winterpause"></label>
      <div class="full" id="bu-vorschau" aria-live="polite"></div><p class="form-err full" role="alert" hidden></p></form>`,
      fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn ghost" type="submit" form="buf" id="bu-pruefen">Vorschau</button><button class="btn primary" type="button" id="bu-ok" disabled>Eintragen</button>' });
    const form = $('#buf', dlg.el); let geprueft = '';
    const body = (probe) => { const f = new FormData(form); return { von: f.get('von'), bis: f.get('bis'), code: f.get('code'), notiz: String(f.get('notiz') || '').trim(), vorschau: probe, ...(f.get('wer') === 'alle' ? { alle: true } : { baustelleIds: [Number(f.get('wer'))] }) }; };
    form.addEventListener('input', () => { $('#bu-ok', dlg.el).disabled = true; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); const err = $('.form-err', dlg.el); err.hidden = true;
      try {
        const r = await post('/urlaub/betriebsurlaub', body(true)); geprueft = JSON.stringify(body(false));
        const konf = (r.personen || []).filter((p) => (p.konflikte || []).length);
        $('#bu-vorschau', dlg.el).innerHTML = `<div class="stack-s" data-bu-tage="${(r.tage || []).length}" data-bu-personen="${(r.personen || []).length}"><p><b>${(r.tage || []).length} Arbeitstage</b> für <b>${(r.personen || []).length} Personen</b> – Feiertage und Wochenenden sind ausgelassen. Bereits genehmigte Abwesenheiten bleiben, beantragte werden ersetzt.</p>
          ${konf.length ? `<ul class="warn-list">${konf.slice(0, 12).map((p) => `<li>${ic('alert')}<span><b>${esc(p.name)}</b>: ${p.konflikte.slice(0, 3).map((k) => `${esc(fmt.datumKurz(k.datum))} ${esc(k.text)}`).join(' · ')}${p.konflikte.length > 3 ? ` (+${p.konflikte.length - 3})` : ''}</span></li>`).join('')}</ul>` : '<p class="muted sm">Keine Konflikte mit bestehenden Abwesenheiten oder dem Baustellenplaner.</p>'}
          <details><summary>${(r.personen || []).length} Personen ansehen</summary><p class="sm">${(r.personen || []).map((p) => `${esc(p.name)} (${p.neu ?? 0} Tage)`).join(', ')}</p></details></div>`;
        $('#bu-ok', dlg.el).disabled = !(r.personen || []).length;
      } catch (x) { err.hidden = false; err.textContent = x.message; }
    });
    $('#bu-ok', dlg.el).addEventListener('click', async (e) => {
      if (JSON.stringify(body(false)) !== geprueft) { e.target.disabled = true; return; }
      e.target.disabled = true;
      try { const r = await post('/urlaub/betriebsurlaub', body(false)); dlg.zu(); toast(`Betriebsurlaub eingetragen${r.angelegt != null ? `: ${r.angelegt} Tage` : ''}.`); neu(); } catch (x) { e.target.disabled = false; const err = $('.form-err', dlg.el); err.hidden = false; err.textContent = x.message; }
    });
  }
  /* ---------- Handy ---------- */
  function handyHtml() {
    const k = konten.find((x) => Number(x.benutzerId) === Number(ich.id));
    const ichP = kal.personen.find((p) => Number(p.benutzerId) === Number(ich.id));
    const meine = Object.entries((ichP && ichP.tage) || {}).sort((a, b) => a[0].localeCompare(b[0]));
    const andere = []; kal.personen.filter((p) => Number(p.benutzerId) !== Number(ich.id)).forEach((p) => Object.entries(p.tage || {}).forEach(([datum, e]) => { if (e.status !== 'abgelehnt') andere.push({ ...e, datum, name: p.name, benutzerId: p.benutzerId }); }));
    andere.sort((a, b) => a.datum.localeCompare(b.datum) || a.name.localeCompare(b.name, 'de'));
    const kz = (t, v, kl = '') => `<div class="${kl}"><small>${t}</small><b>${v}</b></div>`;
    return `<section class="card pad stack-s" id="mein-urlaub" aria-labelledby="h-mu"><h2 class="me-h flach" id="h-mu">Mein Urlaub ${jahr}</h2>
        ${k ? `<div class="ur-konto" id="ur-mein-konto">${kz('Anspruch', fmt.zahl(k.anspruch, 1))}${kz('Übertrag', fmt.zahl(k.uebertrag, 1))}${kz('Genommen', fmt.zahl(k.genommen, 1))}${kz('Geplant', fmt.zahl(k.geplant, 1))}${kz('Beantragt', fmt.zahl(k.beantragt, 1))}${kz('Rest', fmt.zahl(k.rest, 1), 'rest')}</div><p class="muted sm">${esc(k.einheit || 'Arbeitstage')}${k.art === 'buak' ? ` · Anspruch laut BUAK-Kontoauszug${k.buak && k.buak.datum ? ' vom ' + esc(fmt.datum(k.buak.datum)) : ' (noch nicht eingetragen)'}` : ''}</p>` : '<p class="muted sm">Für dieses Jahr ist noch kein Urlaubskonto angelegt.</p>'}
        <button type="button" class="btn primary lg" id="ur-antrag">${ic('plus')}Urlaub beantragen</button></section>
      <section class="card" aria-label="Meine Abwesenheiten"><h2 class="me-h">Meine nächsten Abwesenheiten</h2><ul class="plain rows" id="ur-meine">${meine.map(([datum, e]) => `<li><span class="ur-z ${zelleKl(e)}">${esc(e.code)}</span><span class="grow"><b>${esc(fmt.datumKurz(datum))}${fmt.dt(datum).getFullYear()}</b><small>${esc(CODES[e.code] || e.code)} · ${esc(e.status)}</small></span>${e.status === 'beantragt' ? `<button type="button" class="btn ghost sm" data-zurueck="${e.id}">Zurückziehen</button>` : ''}</li>`).join('') || '<li class="muted">Nichts eingetragen.</li>'}</ul></section>
      ${leitet ? `<section class="card" id="ur-partie" aria-label="Abwesenheiten im Bereich"><h2 class="me-h">${ich.rolle === 'polier' ? 'Meine Partie – Abwesenheiten' : 'Abwesenheiten in meinem Bereich'}</h2><ul class="plain rows">${andere.slice(0, 60).map((a) => `<li data-antrag="${a.id}"><span class="ur-z ${zelleKl(a)}">${esc(a.code === 'abwesend' ? '–' : a.code)}</span><span class="grow"><b>${esc(a.name)}</b><small>${esc(fmt.datumKurz(a.datum))} · ${esc(CODES[a.code] || a.code)} · ${esc(a.status)}</small></span>${a.status === 'beantragt' && darfEntscheiden(a.benutzerId) ? `<button type="button" class="btn ghost sm" data-entscheid="genehmigt" data-id="${a.id}" aria-label="genehmigen">${ic('check', 'xs')}</button><button type="button" class="btn ghost sm" data-entscheid="abgelehnt" data-id="${a.id}" aria-label="ablehnen">${ic('x', 'xs')}</button>` : ''}</li>`).join('') || '<li class="muted">In den nächsten 60 Tagen ist niemand abwesend.</li>'}</ul></section>` : ''}
      ${darfBu ? `<button type="button" class="btn ghost" id="ur-einst">${ic('wrench')}Einstellungen Urlaub</button>` : ''}
      ${legende()}`;
  }
  /* ---------- Einstellungen (Büro/GF): Warngrenze je Partie, Beginn des Urlaubsjahres ---------- */
  async function einstDialog() {
    let ein; try { ein = await get('/einstellungen/urlaub'); } catch (x) { toast(x.message, 'warn'); return; }
    const [mm, tt] = String(ein.urlaubsjahrBeginn || '01-01').split('-');
    const dlg = dialog({ titel: 'Einstellungen Urlaub', inhalt: `<form id="uef" class="form-grid" novalidate>
      <p class="muted sm full">Gewarnt wird, wenn in einer Partie am selben Tag mehr Personen abwesend sind als hier erlaubt – es gilt die Grenze, die zuerst erreicht ist.</p>
      <label class="field"><span class="field-label">Höchstens abwesend je Partie (Personen)</span><input class="input lg num" name="partieGrenze" inputmode="numeric" value="${esc(ein.partieGrenze ?? 2)}"></label>
      <label class="field"><span class="field-label">bzw. höchstens (% der Partie)</span><input class="input lg num" name="partieGrenzeProzent" inputmode="decimal" value="${esc(String(ein.partieGrenzeProzent ?? 30).replace('.', ','))}"></label>
      <fieldset class="field full"><legend class="field-label">Beginn des Urlaubsjahres (Standard für neue Konten)</legend><div class="form-grid"><label class="field"><span class="vh">Tag</span><select class="input lg" name="tag">${Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')).map((x) => `<option ${x === tt ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label class="field"><span class="vh">Monat</span><select class="input lg" name="monat">${MON.map((n, i) => `<option value="${String(i + 1).padStart(2, '0')}" ${String(i + 1).padStart(2, '0') === mm ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div><small class="muted">Üblich ist der 1. Jänner; bei Abweichung bitte mit der Lohnverrechnung abstimmen.</small></fieldset>
      <p class="form-err full" role="alert" hidden></p></form>`, fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="uef" id="ue-ok">Speichern</button>' });
    $('#uef', dlg.el).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target); const err = $('.form-err', dlg.el);
      const g = Number(String(f.get('partieGrenze')).trim()), p = parseZahl(f.get('partieGrenzeProzent'));
      if (!Number.isInteger(g) || g < 1 || g > 50 || !(p >= 1 && p <= 100)) { err.hidden = false; err.textContent = 'Bitte 1–50 Personen und 1–100 % eintragen.'; return; }
      if (new Date(2001, Number(f.get('monat')) - 1, Number(f.get('tag'))).getMonth() !== Number(f.get('monat')) - 1) { err.hidden = false; err.textContent = 'Diesen Tag gibt es in dem Monat nicht.'; return; }
      try { await put('/einstellungen/urlaub', { partieGrenze: g, partieGrenzeProzent: p, urlaubsjahrBeginn: `${f.get('monat')}-${f.get('tag')}` }); dlg.zu(); toast('Einstellungen gespeichert.'); neu(); } catch (x) { err.hidden = false; err.textContent = x.message; }
    });
  }

  function zeichne() {
    el.innerHTML = `<div class="page ur-page${handy ? ' narrow' : ' breit'}">
      ${handy ? '' : `<div class="tabs" role="tablist" aria-label="Ansicht">${[['monat', 'Monat'], ['jahr', 'Jahr'], ['konten', 'Urlaubskonten']].map(([k, t]) => `<button type="button" role="tab" aria-selected="${tab === k}" class="${tab === k ? 'on' : ''}" data-tab="${k}">${t}</button>`).join('')}</div>`}
      ${fehler ? banner('err', esc(fehler)) : handy ? handyHtml() : tab === 'monat' ? monatHtml() : tab === 'jahr' ? jahrHtml() : kontenHtml()}</div>`;
  }
  const neu = async () => { try { await lade(); } catch (x) { toast(x.message, 'warn'); } if (ctx.aktuell()) zeichne(); };
  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; speicher.setz('bt_urlaub_tab', tab); return neu(); }
    const m = e.target.closest('[data-mon]'); if (m) { monat = m.dataset.mon === '0' ? heute.slice(0, 7) : monPlus(monat, Number(m.dataset.mon)); jahr = Number(monat.slice(0, 4)); return neu(); }
    const j = e.target.closest('[data-jahr]'); if (j) { jahr += Number(j.dataset.jahr); return neu(); }
    const zm = e.target.closest('[data-zum-monat]'); if (zm) { monat = zm.dataset.zumMonat; tab = 'monat'; return neu(); }
    if (e.target.closest('#ur-bu')) return buDialog();
    if (e.target.closest('#ur-einst')) return einstDialog();
    if (e.target.closest('#ur-antrag')) return antragDialog(Number(ich.id), ich.name, fmt.addTage(heute, 1));
    const en = e.target.closest('[data-entscheid]');
    if (en && en.dataset.id) { try { await put(`/abwesenheiten/${en.dataset.id}`, { status: en.dataset.entscheid }); toast(en.dataset.entscheid === 'genehmigt' ? 'Antrag genehmigt.' : 'Antrag abgelehnt.'); ctx.meldungenNeu(); } catch (x) { toast(x.message, 'warn'); } return neu(); }
    const zr = e.target.closest('[data-zurueck]');
    if (zr) { if (!(await bestaetigen('Antrag zurückziehen?', '', 'Zurückziehen'))) return; try { await del(`/abwesenheiten/${zr.dataset.zurueck}`); toast('Antrag zurückgezogen.'); } catch (x) { toast(x.message, 'warn'); } return neu(); }
    const ke = e.target.closest('[data-konto-edit]'); if (ke) { const k = konten.find((x) => String(x.benutzerId) === ke.dataset.kontoEdit); if (k) kontoDialog(k); return; }
    const z = e.target.closest('[data-zelle]'); if (z && !z.classList.contains('we') && !z.classList.contains('feiertag')) zellDialog(z);
  });
  el.addEventListener('change', (e) => { if (e.target.id === 'ur-bs') { fBs = e.target.value; neu(); } if (e.target.id === 'ur-rolle') { fRolle = e.target.value; zeichne(); } });
  zeichne();
}
