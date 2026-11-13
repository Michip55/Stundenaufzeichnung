// Plantafel / Einsatzplanung (API.md 12.8).
// Tablet/PC: Tafel Baustellen × Tage mit Ziehen & Ablegen von Personen und Geräten – jede Aktion geht auch ohne Maus
// über „+“ in der Zelle bzw. einen Klick auf den Eintrag. Handy: ein Tag je Ansicht und die Liste „Mein Einsatz“.
import { get, post, put, del } from '../api.js';
import { ic, esc, fmt, avatar, laden, leer, banner, dialog, bestaetigen, toast, rolleText, speicher, $, $$ } from '../ui.js';
import { wienHeute } from '../zahl.js';

const montag = (iso) => { const d = fmt.dt(iso); const w = d.getDay(); return fmt.addTage(iso, w === 0 ? -6 : 1 - w); };
const tagText = (iso, heute) => (iso === heute ? 'Heute' : iso === fmt.addTage(heute, 1) ? 'Morgen' : fmt.WT[fmt.dt(iso).getDay()]);

// „Mein Einsatz“ – eigene veröffentlichte Einträge; auch auf der Stempeluhr verwendet
export function einsatzHtml(liste, heute, { leerText = 'Für die nächsten Tage ist noch nichts veröffentlicht.' } = {}) {
  if (!liste.length) return `<p class="muted sm pad-s" data-einsatz-leer>${esc(leerText)}</p>`;
  return `<ul class="plain rows einsatz-liste">${liste.map((e) => `<li data-einsatz="${esc(e.datum)}"><span class="einsatz-tag"><b>${esc(tagText(e.datum, heute))}</b><small>${esc(fmt.datum(e.datum).slice(0, 6))}</small></span>
    <span class="grow"><b>${esc((e.baustelle && (e.baustelle.kurz || e.baustelle.name)) || 'Baustelle')}</b><small>${e.beginn ? `Beginn ${esc(e.beginn)} Uhr` : 'Beginn wie üblich'}${e.treffpunkt ? ' · Treffpunkt: ' + esc(e.treffpunkt) : ''}</small>${e.notiz ? `<small>${esc(e.notiz)}</small>` : ''}${(e.anlagen || []).length ? `<small>${ic('truck', 'xs')} ${e.anlagen.map((a) => esc(a.bezeichnung + (a.kennzeichen ? ' (' + a.kennzeichen + ')' : ''))).join(', ')}</small>` : ''}</span></li>`).join('')}</ul>`;
}
export const meinEinsatz = (von, bis) => get(`/plan/ich?von=${von}&bis=${bis}`);

export default async function plan(el, ctx) {
  const ich = ctx.ich.benutzer;
  const heute = wienHeute();
  const planer = ['buero', 'gf'].includes(ich.rolle) || ctx.kann('stammdaten');
  const darfSchreiben = planer || ich.rolle === 'bauleiter';
  const siehtTafel = darfSchreiben || ich.rolle === 'polier';
  let von = montag(ctx.query.get('datum') || speicher.lies('bt_plan_woche') || heute);
  let tagWahl = ctx.query.get('datum') || heute; // Handy: gewählter Tag
  let d = { eintraege: [], tage: [] }, meine = [], baustellen = [], leute = [], anlagen = [];
  let sucheP = '', fehlerTafel = '';
  const tage = () => Array.from({ length: 7 }, (_, i) => fmt.addTage(von, i));
  const eigeneBs = (ctx.ich.baustellenIds || []).map(Number);
  const darfBs = (id) => planer || (ich.rolle === 'bauleiter' && eigeneBs.includes(Number(id)));

  async function lade() {
    fehlerTafel = '';
    const t = tage();
    const [m, p] = await Promise.all([meinEinsatz(heute, fmt.addTage(heute, 6)).catch(() => []), siehtTafel ? get(`/plan?von=${t[0]}&bis=${t[6]}`).catch((e) => { if (e.status === 401) throw e; fehlerTafel = e.status === 403 ? 'Kein Zugriff auf die Plantafel.' : e.message; return { eintraege: [], tage: [] }; }) : { eintraege: [], tage: [] }]);
    meine = m; d = p;
  }
  if (siehtTafel) {
    [baustellen, leute, anlagen] = await Promise.all([get('/baustellen').catch(() => []), darfSchreiben ? get('/mitarbeiter').catch(() => []) : [], darfSchreiben ? get('/fuhrpark/anlagen').catch(() => []) : []]);
    baustellen = baustellen.filter((b) => (!b.status || b.status === 'aktiv') && !b.intern);
    leute = leute.filter((m) => m.aktiv !== false && ['mitarbeiter', 'polier', 'bauleiter'].includes(m.rolle));
    anlagen = (Array.isArray(anlagen) ? anlagen : anlagen.anlagen || []).filter((a) => a.status !== 'ausgeschieden');
  }
  await lade();
  if (!t0()) tagWahl = tage().includes(heute) ? heute : tage()[0];
  function t0() { return tage().includes(tagWahl); }

  const veroeff = (datum, bsId) => ((d.tage || []).find((x) => x.datum === datum) || { veroeffentlicht: [] }).veroeffentlicht.map(Number).includes(Number(bsId));
  const zelle = (datum, bsId) => d.eintraege.filter((e) => e.datum === datum && Number(e.baustelleId) === Number(bsId));
  const eName = (e) => (e.art === 'anlage' ? (e.anlage && (e.anlage.bezeichnung || e.anlage.nummer)) || 'Gerät' : e.name || 'Person');
  function chip(e) {
    const k = e.konflikte || [];
    return `<button type="button" class="pl-chip ${e.art === 'anlage' ? 'anlage' : 'person'}${k.length ? ' konflikt' : ''}${e.veroeffentlicht && !e.geaendertNachVeroeffentlichung ? ' pub' : ''}" data-eintrag="${e.id}" ${darfBs(e.baustelleId) ? 'draggable="true"' : ''}
      aria-label="${esc(eName(e))}${e.beginn ? ', Beginn ' + esc(e.beginn) : ''}${k.length ? ', Konflikt: ' + esc(k.map((x) => x.text).join('; ')) : ''}${e.veroeffentlicht ? '' : ', noch nicht veröffentlicht'}">
      ${ic(e.art === 'anlage' ? 'truck' : 'user', 'xs')}<span>${esc(eName(e))}</span>${e.beginn ? `<small>${esc(e.beginn)}</small>` : ''}${k.length ? `<i class="pl-warn" data-konflikt="${esc(k[0].typ)}" title="${esc(k.map((x) => x.text).join(' · '))}">${ic('alert', 'xs')}${k.length > 1 ? k.length : ''}</i>` : ''}</button>`;
  }
  function tagKopf(t) {
    const n = d.eintraege.filter((e) => e.datum === t);
    const offen = n.filter((e) => !e.veroeffentlicht || e.geaendertNachVeroeffentlichung).length;
    const zustand = !n.length ? 'leer' : offen ? (n.some((e) => e.veroeffentlicht) ? 'geaendert' : 'entwurf') : 'veroeffentlicht';
    const x = fmt.dt(t);
    return `<div class="pl-tag${t === heute ? ' heute' : ''}${t === tagWahl ? ' wahl' : ''}" role="columnheader" data-tag="${t}" data-zustand="${zustand}">
      <b>${fmt.WTK[x.getDay()]} ${String(x.getDate()).padStart(2, '0')}.${String(x.getMonth() + 1).padStart(2, '0')}.</b>
      <span class="chip xs ${zustand === 'veroeffentlicht' ? 'st-green' : zustand === 'leer' ? 'st-grey' : 'st-amber'}" data-plan-zustand="${zustand}">${zustand === 'veroeffentlicht' ? 'veröffentlicht' : zustand === 'geaendert' ? `${offen} geändert` : zustand === 'entwurf' ? 'Entwurf' : 'leer'}</span>
      ${darfSchreiben && n.length ? `<span class="pl-tag-akt"><button type="button" class="btn ${offen ? 'primary' : 'ghost'} sm" data-pub="${t}" ${offen ? '' : 'disabled'}>${ic('send')}Veröffentlichen</button><button type="button" class="icon-btn sm" data-kopie="${t}" aria-label="Plan vom ${esc(fmt.datum(t))} auf einen anderen Tag kopieren" title="Tag kopieren">${ic('copy')}</button></span>` : ''}</div>`;
  }
  function zeichne() {
    const t = tage();
    const pSicht = leute.filter((m) => m.name.toLowerCase().includes(sucheP.toLowerCase()));
    const aSicht = anlagen.filter((a) => `${a.bezeichnung || ''} ${a.kennzeichen || ''} ${a.nummer || ''}`.toLowerCase().includes(sucheP.toLowerCase()));
    el.innerHTML = `
    <div class="page plan-page">
      <section class="card" id="mein-einsatz" aria-labelledby="h-me"><div class="card-h pad-h"><h3 id="h-me">${ic('calendar')}Mein Einsatz</h3><span class="muted sm">nächste 7 Tage</span></div>${einsatzHtml(meine, heute)}</section>
      ${!siehtTafel ? '' : `
      <div class="toolbar plan-bar">
        <div class="week-switch slim"><button type="button" class="icon-btn" data-woche="-7" aria-label="Vorige Woche">${ic('left')}</button><div><b>${esc(fmt.datum(t[0]).slice(0, 6))} – ${esc(fmt.datum(t[6]))}</b></div><button type="button" class="icon-btn" data-woche="7" aria-label="Nächste Woche">${ic('right')}</button></div>
        <button type="button" class="btn ghost sm" data-heute>Heute</button><span class="grow"></span>
        ${darfSchreiben ? '<span class="muted sm plan-tipp">Ziehen &amp; Ablegen oder „+“ in der Zelle</span>' : '<span class="chip st-grey">nur Ansicht</span>'}
      </div>
      ${fehlerTafel ? banner('err', esc(fehlerTafel)) : ''}
      <div class="plan-tage" role="tablist" aria-label="Tag wählen">${t.map((x) => `<button type="button" role="tab" aria-selected="${x === tagWahl}" class="${x === tagWahl ? 'on' : ''}${x === heute ? ' heute' : ''}" data-tagwahl="${x}"><small>${fmt.WTK[fmt.dt(x).getDay()]}</small><b>${fmt.dt(x).getDate()}</b></button>`).join('')}</div>
      <div class="plan-wrap">
        ${darfSchreiben ? `<aside class="plan-pool card" aria-label="Personal und Geräte zum Einplanen">
          <label class="search sm"><span>${ic('user')}</span><input type="search" id="pl-suche" placeholder="Suchen" aria-label="Personal und Geräte suchen" value="${esc(sucheP)}"></label>
          <h4 class="sub-h">Personal <span class="count">${pSicht.length}</span></h4>
          <div class="pl-pool-liste" id="pool-personen">${pSicht.map((m) => `<span class="pl-chip person pool" draggable="true" data-pool-person="${m.id}" title="${esc(rolleText(m.rolle))}">${ic('user', 'xs')}<span>${esc(m.name)}</span></span>`).join('') || '<p class="muted sm">–</p>'}</div>
          <h4 class="sub-h">Geräte <span class="count">${aSicht.length}</span></h4>
          <div class="pl-pool-liste" id="pool-anlagen">${aSicht.slice(0, 80).map((a) => `<span class="pl-chip anlage pool" draggable="true" data-pool-anlage="${a.id}">${ic('truck', 'xs')}<span>${esc(a.bezeichnung || a.nummer || 'Gerät')}${a.kennzeichen ? ` <small>${esc(a.kennzeichen)}</small>` : ''}</span></span>`).join('') || '<p class="muted sm">–</p>'}</div>
        </aside>` : ''}
        <div class="plan-tafel" role="table" aria-label="Plantafel ${esc(fmt.datum(t[0]))} bis ${esc(fmt.datum(t[6]))}" data-tagwahl="${tagWahl}">
          <div class="pl-zeile kopf" role="row"><div class="pl-bs" role="columnheader">Baustelle</div>${t.map(tagKopf).join('')}</div>
          ${baustellen.length ? baustellen.map((b) => `<div class="pl-zeile" role="row" data-bs="${b.id}"><div class="pl-bs" role="rowheader"><small>${esc(b.kst || '')}</small><b>${esc(b.kurz || b.name)}</b></div>
            ${t.map((x) => { const l = zelle(x, b.id); return `<div class="pl-zelle${x === heute ? ' heute' : ''}${x === tagWahl ? ' wahl' : ''}${veroeff(x, b.id) ? ' pub' : ''}" role="cell" data-zelle data-datum="${x}" data-bs="${b.id}">${l.map(chip).join('')}${darfBs(b.id) ? `<button type="button" class="pl-plus" data-plus aria-label="Einplanen: ${esc(b.kurz || b.name)}, ${esc(fmt.datumKurz(x))}">${ic('plus')}</button>` : ''}</div>`; }).join('')}</div>`).join('') : `<div class="pad">${leer('Keine aktive Baustelle.', 'pin')}</div>`}
        </div>
      </div>
      <div class="legend-row"><span><i class="pl-leg pub"></i>veröffentlicht</span><span><i class="pl-leg"></i>Entwurf / geändert</span><span>${ic('alert', 'xs')} Konflikt (doppelt eingeplant, abwesend, Gerät gesperrt …)</span></div>`}
    </div>`;
  }
  const neu = async () => { try { await lade(); } catch (e) { toast(e.message, 'warn'); } if (ctx.aktuell()) { const v = document.getElementById('view'); const st = v ? v.scrollTop : 0; zeichne(); if (v) v.scrollTop = st; } };
  const konfliktToast = (r) => { const k = (r && r.konflikte) || ((r && r.eintraege) || []).flatMap((e) => e.konflikte || []); if (k.length) toast(`Eingeplant – Achtung: ${k[0].text || 'Konflikt'}${k.length > 1 ? ` (+${k.length - 1})` : ''}`, 'warn'); else toast('Eingeplant.'); };

  /* ---- Einplanen per Dialog (Tastatur-/Touch-Alternative zum Ziehen) ---- */
  function plusDialog(datum, bsId) {
    const b = baustellen.find((x) => Number(x.id) === Number(bsId)) || {};
    const schon = zelle(datum, bsId);
    const frP = leute.filter((m) => !schon.some((e) => e.art === 'person' && e.benutzerId === m.id));
    const frA = anlagen.filter((a) => !schon.some((e) => e.art === 'anlage' && e.anlageId === a.id));
    const partie = frP.filter((m) => Number(m.baustelleId) === Number(bsId));
    const dlg = dialog({ titel: `Einplanen · ${b.kurz || b.name || ''} · ${fmt.datumKurz(datum)}`, breit: true, inhalt: `<form id="plf" class="stack-s" novalidate>
      ${partie.length ? `<label class="check-inline"><input type="checkbox" name="partie"> Ganze Partie dieser Baustelle (${partie.length} Personen)</label>` : ''}
      <fieldset class="field"><legend class="field-label">Personen</legend><div class="pick-multi">${frP.map((m) => `<label class="check-inline"><input type="checkbox" name="p" value="${m.id}"> ${esc(m.name)}</label>`).join('') || '<p class="muted sm">Alle sind schon eingeplant.</p>'}</div></fieldset>
      <fieldset class="field"><legend class="field-label">Geräte und Fahrzeuge</legend><div class="pick-multi">${frA.slice(0, 120).map((a) => `<label class="check-inline"><input type="checkbox" name="a" value="${a.id}"> ${esc(a.bezeichnung || a.nummer || 'Gerät')}${a.kennzeichen ? ' · ' + esc(a.kennzeichen) : ''}</label>`).join('') || '<p class="muted sm">–</p>'}</div></fieldset>
      <div class="form-grid"><label class="field"><span class="field-label">Beginn</span><input class="input lg" type="time" name="beginn"></label><label class="field"><span class="field-label">Treffpunkt</span><input class="input lg" name="treffpunkt" maxlength="200" placeholder="z. B. Lagerplatz Breitenau"></label></div>
      <label class="field"><span class="field-label">Notiz</span><input class="input lg" name="notiz" maxlength="500"></label>
      <p class="form-err" role="alert" hidden></p></form>`, fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="plf">Einplanen</button>' });
    $('#plf', dlg.el).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target); const err = $('.form-err', dlg.el);
      const body = { datum, baustelleId: Number(bsId), benutzerIds: f.getAll('p').map(Number), anlageIds: f.getAll('a').map(Number) };
      if (f.get('partie')) body.partieBaustelleId = Number(bsId);
      if (!body.benutzerIds.length && !body.anlageIds.length && !body.partieBaustelleId) { err.hidden = false; err.textContent = 'Bitte mindestens eine Person oder ein Gerät wählen.'; return; }
      if (f.get('beginn')) body.beginn = f.get('beginn'); if (String(f.get('treffpunkt')).trim()) body.treffpunkt = String(f.get('treffpunkt')).trim(); if (String(f.get('notiz')).trim()) body.notiz = String(f.get('notiz')).trim();
      try { const r = await post('/plan', body); dlg.zu(); konfliktToast(r); neu(); } catch (x) { err.hidden = false; err.textContent = x.message; }
    });
  }
  function eintragDialog(eid) {
    const e = d.eintraege.find((x) => String(x.id) === String(eid)); if (!e) return;
    const schreib = darfBs(e.baustelleId);
    const dlg = dialog({ titel: eName(e), inhalt: `<form id="pef" class="stack-s" novalidate>
      ${(e.konflikte || []).length ? `<div id="pl-konflikte">${e.konflikte.map((k) => banner('warn', esc(k.text))).join('')}</div>` : ''}
      <p class="muted sm">${e.veroeffentlicht ? (e.geaendertNachVeroeffentlichung ? 'Nach der Veröffentlichung geändert – erneut veröffentlichen, damit die Person es erfährt.' : 'Veröffentlicht.') : 'Noch nicht veröffentlicht – die Person sieht den Einsatz noch nicht.'}</p>
      <div class="form-grid"><label class="field"><span class="field-label">Tag</span><input class="input lg" type="date" name="datum" value="${e.datum}" ${schreib ? '' : 'disabled'}></label>
        <label class="field"><span class="field-label">Baustelle</span><select class="input lg" name="baustelleId" ${schreib ? '' : 'disabled'}>${baustellen.filter((b) => darfBs(b.id) || Number(b.id) === Number(e.baustelleId)).map((b) => `<option value="${b.id}" ${Number(b.id) === Number(e.baustelleId) ? 'selected' : ''}>${esc((b.kst ? b.kst + ' · ' : '') + (b.kurz || b.name))}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Beginn</span><input class="input lg" type="time" name="beginn" value="${esc(e.beginn || '')}" ${schreib ? '' : 'disabled'}></label>
        <label class="field"><span class="field-label">Treffpunkt</span><input class="input lg" name="treffpunkt" maxlength="200" value="${esc(e.treffpunkt || '')}" ${schreib ? '' : 'disabled'}></label></div>
      <label class="field"><span class="field-label">Notiz</span><input class="input lg" name="notiz" maxlength="500" value="${esc(e.notiz || '')}" ${schreib ? '' : 'disabled'}></label>
      <p class="form-err" role="alert" hidden></p></form>`,
      fuss: schreib ? '<button class="btn danger" type="button" id="pe-weg">Entfernen</button><span class="grow"></span><button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="pef">Speichern</button>' : '<button class="btn ghost" type="button" data-zu>Schließen</button>' });
    if (!schreib) return;
    $('#pef', dlg.el).addEventListener('submit', async (ev) => {
      ev.preventDefault(); const f = new FormData(ev.target); const err = $('.form-err', dlg.el);
      try { await put(`/plan/${e.id}`, { version: e.version, datum: f.get('datum'), baustelleId: Number(f.get('baustelleId')), beginn: f.get('beginn') || null, treffpunkt: String(f.get('treffpunkt') || '').trim(), notiz: String(f.get('notiz') || '').trim() }); dlg.zu(); toast('Gespeichert.'); neu(); }
      catch (x) { err.hidden = false; err.textContent = x.status === 409 ? 'Inzwischen von jemand anderem geändert – bitte schließen und erneut öffnen.' : x.message; if (x.status === 409) neu(); }
    });
    $('#pe-weg', dlg.el).addEventListener('click', async () => { try { await del(`/plan/${e.id}`); dlg.zu(); toast(e.veroeffentlicht ? 'Entfernt – beim nächsten Veröffentlichen erfährt die Person, dass der Einsatz entfällt.' : 'Entfernt.'); neu(); } catch (x) { toast(x.message, 'warn'); } });
  }
  async function verschiebe(eid, datum, bsId) {
    const e = d.eintraege.find((x) => String(x.id) === String(eid)); if (!e || (e.datum === datum && Number(e.baustelleId) === Number(bsId))) return;
    try { const r = await put(`/plan/${e.id}`, { version: e.version, datum, baustelleId: Number(bsId) }); konfliktToast({ eintraege: [r && r.id ? r : {}] }); } catch (x) { toast(x.status === 409 ? 'Inzwischen von jemand anderem geändert – die Tafel wird neu geladen.' : x.message, 'warn'); }
    neu();
  }

  /* ---- Ereignisse ---- */
  el.addEventListener('click', async (e) => {
    const w = e.target.closest('[data-woche]');
    if (w) { von = fmt.addTage(von, Number(w.dataset.woche)); tagWahl = tage().includes(heute) ? heute : von; speicher.setz('bt_plan_woche', von); return neu(); }
    if (e.target.closest('[data-heute]')) { von = montag(heute); tagWahl = heute; speicher.setz('bt_plan_woche', von); return neu(); }
    const tw = e.target.closest('[data-tagwahl]');
    if (tw && tw.matches('button')) { tagWahl = tw.dataset.tagwahl; return zeichne(); }
    const plus = e.target.closest('[data-plus]');
    if (plus) { const z = plus.closest('[data-zelle]'); return plusDialog(z.dataset.datum, z.dataset.bs); }
    const ch = e.target.closest('[data-eintrag]');
    if (ch) return eintragDialog(ch.dataset.eintrag);
    const pub = e.target.closest('[data-pub]');
    if (pub) {
      const datum = pub.dataset.pub; const n = d.eintraege.filter((x) => x.datum === datum);
      const konf = n.filter((x) => (x.konflikte || []).length).length;
      if (!(await bestaetigen(`Plan für ${fmt.datumKurz(datum)} veröffentlichen?`, `${n.filter((x) => x.art === 'person').length} Personen erfahren ihren Einsatz (in der App und per Push, wenn eingeschaltet).${konf ? ` Achtung: ${konf} Eintr${konf > 1 ? 'äge haben' : 'ag hat'} einen Konflikt.` : ''}`, 'Veröffentlichen'))) return;
      try { const r = await post('/plan/veroeffentlichen', { datum }); toast(`Veröffentlicht – ${r.benachrichtigt ?? 0} Person${r.benachrichtigt === 1 ? '' : 'en'} benachrichtigt.`); ctx.meldungenNeu(); } catch (x) { toast(x.message, 'warn'); }
      return neu();
    }
    const kp = e.target.closest('[data-kopie]');
    if (kp) {
      const quelle = kp.dataset.kopie;
      const dlg = dialog({ titel: `Plan vom ${fmt.datumKurz(quelle)} kopieren`, inhalt: `<form id="pkf" class="stack-s"><label class="field"><span class="field-label">Auf welchen Tag?</span><input class="input lg" type="date" name="nach" required value="${fmt.addTage(quelle, fmt.dt(quelle).getDay() === 5 ? 3 : 1)}" min="${fmt.addTage(heute, -7)}"></label><p class="muted sm">Kopiert werden alle Einträge dieses Tages. Der neue Tag ist ein Entwurf, bis er veröffentlicht wird.</p><p class="form-err" role="alert" hidden></p></form>`, fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="pkf">Kopieren</button>' });
      $('#pkf', dlg.el).addEventListener('submit', async (ev) => { ev.preventDefault(); const nach = new FormData(ev.target).get('nach'); try { const r = await post('/plan/kopieren', { von: quelle, nach }); dlg.zu(); toast(`${r.angelegt ?? 0} Einträge kopiert.`); if (!tage().includes(nach)) { von = montag(nach); } tagWahl = nach; neu(); } catch (x) { const err = $('.form-err', dlg.el); err.hidden = false; err.textContent = x.message; } });
    }
  });
  el.addEventListener('input', (e) => { if (e.target.id === 'pl-suche') { sucheP = e.target.value; const pos = e.target.selectionStart; zeichne(); const s = $('#pl-suche', el); if (s) { s.focus(); s.setSelectionRange(pos, pos); } } });
  // Ziehen & Ablegen
  el.addEventListener('dragstart', (e) => {
    const c = e.target.closest && e.target.closest('[data-eintrag], [data-pool-person], [data-pool-anlage]'); if (!c || !e.dataTransfer) return;
    const daten = c.dataset.eintrag ? { eintrag: c.dataset.eintrag } : c.dataset.poolPerson ? { person: Number(c.dataset.poolPerson) } : { anlage: Number(c.dataset.poolAnlage) };
    e.dataTransfer.setData('text/plain', JSON.stringify(daten)); e.dataTransfer.effectAllowed = 'move';
    el.classList.add('zieht');
  });
  el.addEventListener('dragend', () => { el.classList.remove('zieht'); $$('.pl-zelle.ziel', el).forEach((z) => z.classList.remove('ziel')); });
  el.addEventListener('dragover', (e) => { const z = e.target.closest && e.target.closest('[data-zelle]'); if (!z || !darfBs(z.dataset.bs)) return; e.preventDefault(); $$('.pl-zelle.ziel', el).forEach((x) => { if (x !== z) x.classList.remove('ziel'); }); z.classList.add('ziel'); });
  el.addEventListener('drop', async (e) => {
    const z = e.target.closest && e.target.closest('[data-zelle]'); if (!z || !darfBs(z.dataset.bs)) return;
    e.preventDefault(); z.classList.remove('ziel');
    let daten; try { daten = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (x) { return; }
    if (daten.eintrag) return verschiebe(daten.eintrag, z.dataset.datum, z.dataset.bs);
    try { const r = await post('/plan', { datum: z.dataset.datum, baustelleId: Number(z.dataset.bs), ...(daten.person ? { benutzerIds: [daten.person] } : { anlageIds: [daten.anlage] }) }); konfliktToast(r); } catch (x) { toast(x.message, 'warn'); }
    neu();
  });
  zeichne();
}
