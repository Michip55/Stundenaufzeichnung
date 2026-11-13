// Zeitkorrektur durch Büro/GF (Prüfbericht B-05): Buchungen ansehen, nachtragen, ändern, löschen – immer mit Grund.
import { get, post, put, api } from '../api.js';
import { ic, esc, fmt, laden, leer, banner, dialog, toast, speicher, $ } from '../ui.js';
import { wienIso, wienLokal, wienHeute } from '../zahl.js';

const TYP = { kommen: 'Kommen', gehen: 'Gehen', pause_start: 'Pause Beginn', pause_ende: 'Pause Ende', wechsel: 'Baustellenwechsel' };
const QUELLE = { app: 'App', offline: 'offline nachgebucht', kolonne: 'durch Polier', buero: 'Korrektur Büro' };
// C-15: Alle Zeiten sind österreichische Ortszeit – unabhängig davon, welche Zeitzone am Gerät eingestellt ist
const lokal = (iso) => wienLokal(iso);
const alsIso = (wert) => wienIso(wert.slice(0, 10), wert.slice(11, 16));

export default async function korrektur(el, ctx) {
  const [leute, baustellen] = await Promise.all([get('/mitarbeiter'), get('/baustellen')]);
  const aktive = leute.filter((m) => m.aktiv !== false);
  let benutzerId = Number(ctx.query.get('benutzerId')) || speicher.lies('bt_korr_ma') || (aktive[0] && aktive[0].id);
  if (!leute.some((m) => m.id === benutzerId)) benutzerId = aktive[0] && aktive[0].id;
  let bis = ctx.query.get('bis') || wienHeute();
  let von = ctx.query.get('von') || fmt.addTage(bis, -13);
  let liste = [];
  const bsName = (id) => { const b = baustellen.find((x) => x.id === id); return b ? `${b.kst ? b.kst + ' · ' : ''}${b.name}` : id != null ? `Baustelle ${id}` : '–'; };

  el.innerHTML = `
  <div class="page">
    ${banner('info', 'Korrekturen ändern die Lohnstunden. Jede Änderung braucht einen <b>Grund</b> und wird unveränderbar protokolliert.', 'shield')}
    <div class="toolbar">
      <label class="field inline"><span class="vh">Mitarbeiter</span><select class="input" id="k-ma">${leute.map((m) => `<option value="${m.id}" ${m.id === benutzerId ? 'selected' : ''}>${esc(m.name)}${m.aktiv === false ? ' (inaktiv)' : ''}</option>`).join('')}</select></label>
      <label class="field inline"><span class="vh">von</span><input class="input" type="date" id="k-von" value="${von}"></label>
      <label class="field inline"><span class="vh">bis</span><input class="input" type="date" id="k-bis" value="${bis}"></label>
      <span class="grow"></span>
      <button type="button" class="btn primary" id="k-neu">${ic('plus')}Buchung nachtragen</button>
    </div>
    <section class="card" id="k-liste">${laden()}</section>
  </div>`;

  async function ladeListe() {
    const box = $('#k-liste', el);
    box.innerHTML = laden();
    try { liste = await get(`/zeit/buchungen?benutzerId=${benutzerId}&von=${von}&bis=${bis}`); }
    catch (e) { box.innerHTML = `<div class="state">${ic(e.status === 403 ? 'lock' : 'alert')}<p>${esc(e.status === 403 ? 'Kein Zugriff' : e.message)}</p></div>`; return; }
    if (!ctx.aktuell()) return;
    liste.sort((a, b) => (a.zeit < b.zeit ? 1 : -1));
    let tag = '';
    box.innerHTML = liste.length ? `<ul class="plain rows korr">${liste.map((x) => {
      const d = x.datum || lokal(x.zeit).slice(0, 10);
      const kopf = d !== tag ? `<li class="korr-tag">${esc(fmt.datumLang(d))}</li>` : '';
      tag = d;
      return `${kopf}<li data-buchung="${x.id}"><time>${esc(x.uhrzeit || lokal(x.zeit).slice(11))}</time><span class="grow"><b>${esc(TYP[x.typ] || x.typ)}</b><small>${esc(bsName(x.baustelleId))}${x.quelle && x.quelle !== 'app' ? ' · ' + esc(QUELLE[x.quelle] || x.quelle) : ''}</small></span>
        <button type="button" class="btn ghost sm" data-aendern="${x.id}">${ic('edit')}Ändern</button><button type="button" class="icon-btn sm" data-loeschen="${x.id}" aria-label="Buchung ${esc(TYP[x.typ] || x.typ)} um ${esc(x.uhrzeit || fmt.uhr(x.zeit))} löschen">${ic('trash')}</button></li>`;
    }).join('')}</ul>` : leer('Keine Buchungen in diesem Zeitraum.', 'clock');
  }

  function formDialog({ titel, x, loeschen }) {
    const neu = !x;
    const d = dialog({
      titel,
      inhalt: `<form id="kf" class="stack-s">
        ${loeschen ? `<p>${esc(TYP[x.typ] || x.typ)} am ${esc(fmt.datum(lokal(x.zeit).slice(0, 10)))} um ${esc(lokal(x.zeit).slice(11))} Uhr wird gelöscht.</p>` : `
        ${neu ? `<label class="field"><span class="field-label">Art</span><select class="input lg" name="typ">${Object.entries(TYP).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>` : ''}
        <label class="field"><span class="field-label">Zeitpunkt (österreichische Ortszeit)</span><input class="input lg" type="datetime-local" name="zeit" required value="${lokal(x ? x.zeit : new Date().toISOString())}" max="${lokal(new Date().toISOString())}"></label>
        <label class="field"><span class="field-label">Baustelle</span><select class="input lg" name="baustelleId"><option value="">– unverändert / keine –</option>${baustellen.map((b) => `<option value="${b.id}" ${x && x.baustelleId === b.id ? 'selected' : ''}>${esc(bsName(b.id))}</option>`).join('')}</select></label>`}
        <label class="field"><span class="field-label">Grund (Pflicht)</span><input class="input lg" name="grund" required minlength="3" maxlength="300" placeholder="z. B. Ausstempeln vergessen, laut Polier 16:00"></label>
        <p class="form-err" role="alert" hidden></p></form>`,
      fuss: `<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn ${loeschen ? 'danger' : 'primary'}" type="submit" form="kf">${loeschen ? 'Löschen' : 'Speichern'}</button>`,
    });
    $('#kf', d.el).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target); const m = $('.form-err', d.el);
      const grund = String(f.get('grund') || '').trim();
      if (grund.length < 3) { m.hidden = false; m.textContent = 'Bitte einen Grund angeben.'; return; }
      try {
        if (loeschen) await api('DELETE', `/zeit/buchungen/${x.id}`, { grund });
        else {
          const body = { zeit: alsIso(String(f.get('zeit'))), grund };
          if (f.get('baustelleId')) body.baustelleId = Number(f.get('baustelleId'));
          if (neu) await post('/zeit/buchungen', { ...body, benutzerId, typ: f.get('typ') }); else await put(`/zeit/buchungen/${x.id}`, body);
        }
        d.zu(); toast(loeschen ? 'Buchung gelöscht.' : neu ? 'Buchung nachgetragen.' : 'Buchung geändert.'); ladeListe();
      } catch (err) { m.hidden = false; m.textContent = err.message; }
    });
  }

  el.addEventListener('change', (e) => {
    if (e.target.id === 'k-ma') { benutzerId = Number(e.target.value); speicher.setz('bt_korr_ma', benutzerId); ladeListe(); }
    if (e.target.id === 'k-von' && e.target.value) { von = e.target.value; ladeListe(); }
    if (e.target.id === 'k-bis' && e.target.value) { bis = e.target.value; ladeListe(); }
  });
  el.addEventListener('click', (e) => {
    if (e.target.closest('#k-neu')) return formDialog({ titel: `Buchung nachtragen – ${(leute.find((m) => m.id === benutzerId) || {}).name || ''}` });
    const a = e.target.closest('[data-aendern]');
    if (a) return formDialog({ titel: 'Buchung ändern', x: liste.find((y) => String(y.id) === a.dataset.aendern) });
    const l = e.target.closest('[data-loeschen]');
    if (l) return formDialog({ titel: 'Buchung löschen', x: liste.find((y) => String(y.id) === l.dataset.loeschen), loeschen: true });
  });
  await ladeListe();
}
