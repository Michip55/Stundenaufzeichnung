// Zeitkorrektur durch Büro/GF (Prüfbericht 1 B-05, Prüfbericht 2 C-04/C-15):
// ganze Schichten nachtragen oder löschen, einzelne Buchungen nachtragen, ändern, löschen – immer mit Grund.
// Alle Zeiten sind österreichische Ortszeit, unabhängig von der Zeitzone des Geräts.
import { get, post, put, api } from '../api.js';
import { ic, esc, fmt, parseZahl, laden, leer, banner, dialog, toast, speicher, $ } from '../ui.js';
import { wienIso, wienLokal, wienHeute, stundenAus } from '../zahl.js';

const TYP = { kommen: 'Kommen', gehen: 'Gehen', pause_start: 'Pause Beginn', pause_ende: 'Pause Ende', wechsel: 'Baustellenwechsel' };
const QUELLE = { app: 'App', offline: 'offline nachgebucht', kolonne: 'durch Polier', buero: 'Korrektur Büro' };
const lokal = (iso) => wienLokal(iso);
const alsIso = (wert) => wienIso(wert.slice(0, 10), wert.slice(11, 16));
const uhr = (x) => (!x ? '–' : /^\d{1,2}:\d{2}/.test(x) ? x.slice(0, 5) : lokal(x).slice(11));

export default async function korrektur(el, ctx) {
  const [alle, baustellen] = await Promise.all([get('/mitarbeiter'), get('/baustellen')]);
  // Vier-Augen-Prinzip: die eigenen Zeiten korrigiert niemand selbst
  const leute = alle.filter((m) => m.id !== ctx.ich.benutzer.id);
  const aktive = leute.filter((m) => m.aktiv !== false);
  let benutzerId = Number(ctx.query.get('benutzerId')) || speicher.lies('bt_korr_ma') || (aktive[0] && aktive[0].id);
  if (!leute.some((m) => m.id === benutzerId)) benutzerId = aktive[0] && aktive[0].id;
  let bis = ctx.query.get('bis') || wienHeute();
  let von = ctx.query.get('von') || fmt.addTage(bis, -13);
  let liste = [], schichten = [];
  const bsName = (id) => { const b = baustellen.find((x) => x.id === id); return b ? `${b.kst ? b.kst + ' · ' : ''}${b.name}` : id != null ? `Baustelle ${id}` : '–'; };
  const person = () => (leute.find((m) => m.id === benutzerId) || {}).name || '';
  const bsWahl = (gewaehlt, leerText) => `<select class="input lg" name="baustelleId" ${leerText ? '' : 'required'}>${leerText ? `<option value="">${leerText}</option>` : ''}${baustellen.filter((b) => b.status !== 'abgeschlossen' || b.id === gewaehlt).map((b) => `<option value="${b.id}" ${gewaehlt === b.id ? 'selected' : ''}>${esc(bsName(b.id))}</option>`).join('')}</select>`;

  el.innerHTML = `
  <div class="page">
    ${banner('info', 'Korrekturen ändern die Lohnstunden. Jede Änderung braucht einen <b>Grund</b> und wird unveränderbar protokolliert. Die eigenen Zeiten korrigiert immer eine andere Person.', 'shield')}
    <div class="toolbar">
      <label class="field inline"><span class="vh">Mitarbeiter</span><select class="input" id="k-ma">${leute.map((m) => `<option value="${m.id}" ${m.id === benutzerId ? 'selected' : ''}>${esc(m.name)}${m.aktiv === false ? ' (inaktiv)' : ''}</option>`).join('')}</select></label>
      <label class="field inline"><span class="vh">von</span><input class="input" type="date" id="k-von" value="${von}"></label>
      <label class="field inline"><span class="vh">bis</span><input class="input" type="date" id="k-bis" value="${bis}"></label>
      <span class="grow"></span>
      <button type="button" class="btn primary" id="k-schicht">${ic('plus')}Ganze Schicht nachtragen</button>
    </div>
    <section class="card" aria-labelledby="h-sch"><div class="card-h pad-h"><h3 id="h-sch">${ic('clock')}Schichten</h3></div><div id="k-schichten">${laden()}</div></section>
    <section class="card" aria-labelledby="h-bu"><div class="card-h pad-h"><h3 id="h-bu">Einzelne Buchungen</h3><button type="button" class="btn ghost sm" id="k-neu">${ic('plus')}Einzelne Buchung</button></div><div id="k-liste">${laden()}</div></section>
  </div>`;

  async function ladeListe() {
    const box = $('#k-liste', el), sbox = $('#k-schichten', el);
    box.innerHTML = laden(); sbox.innerHTML = laden();
    try { [liste, schichten] = await Promise.all([get(`/zeit/buchungen?benutzerId=${benutzerId}&von=${von}&bis=${bis}`), get(`/zeit/schichten?benutzerId=${benutzerId}&von=${von}&bis=${bis}`)]); }
    catch (e) { const t = `<div class="state">${ic(e.status === 403 ? 'lock' : 'alert')}<p>${esc(e.status === 403 ? (e.message || 'Kein Zugriff') : e.message)}</p></div>`; box.innerHTML = t; sbox.innerHTML = ''; return; }
    if (!ctx.aktuell()) return;
    schichten.sort((a, b) => (`${a.datum} ${a.beginn}` < `${b.datum} ${b.beginn}` ? 1 : -1));
    sbox.innerHTML = schichten.length ? `<ul class="plain rows korr" id="k-schichtliste">${schichten.map((x) => `<li data-schicht="${x.id}">
        <span class="korr-datum"><b>${esc(fmt.datumKurz(x.datum))}</b></span>
        <span class="grow"><b>${esc(uhr(x.beginn))} – ${x.offen ? '<em class="pend">offen</em>' : esc(uhr(x.ende))} Uhr${x.arbeitMin != null && !x.offen ? ` · ${fmt.zahl(x.arbeitMin / 60)} Std.` : ''}</b><small>${esc((x.baustellen || []).map(bsName).join(', '))}${x.pauseMin ? ` · Pause ${x.pauseMin} min` : ''}</small></span>
        ${x.unplausibel ? '<span class="chip xs st-red">unplausibel – zählt 0 Std.</span>' : x.offen ? '<span class="chip xs st-amber">läuft</span>' : ''}
        <button type="button" class="btn ghost sm" data-schicht-weg="${x.id}">${ic('trash')}Ganze Schicht löschen</button></li>`).join('')}</ul>` : leer('Keine Schichten in diesem Zeitraum.', 'clock');
    liste.sort((a, b) => (a.zeit < b.zeit ? 1 : -1));
    let tag = '';
    box.innerHTML = liste.length ? `<ul class="plain rows korr">${liste.map((x) => {
      const d = x.datum || lokal(x.zeit).slice(0, 10);
      const kopf = d !== tag ? `<li class="korr-tag">${esc(fmt.datumLang(d))}</li>` : '';
      tag = d;
      return `${kopf}<li data-buchung="${x.id}"><time>${esc(x.uhrzeit || lokal(x.zeit).slice(11))}</time><span class="grow"><b>${esc(TYP[x.typ] || x.typ)}</b><small>${esc(bsName(x.baustelleId))}${x.quelle && x.quelle !== 'app' ? ' · ' + esc(QUELLE[x.quelle] || x.quelle) : ''}</small></span>
        <button type="button" class="btn ghost sm" data-aendern="${x.id}">${ic('edit')}Ändern</button><button type="button" class="icon-btn sm" data-loeschen="${x.id}" aria-label="Buchung ${esc(TYP[x.typ] || x.typ)} um ${esc(x.uhrzeit || lokal(x.zeit).slice(11))} löschen">${ic('trash')}</button></li>`;
    }).join('')}</ul>` : leer('Keine Buchungen in diesem Zeitraum.', 'clock');
  }
  const grundFeld = '<label class="field"><span class="field-label">Grund (Pflicht)</span><input class="input lg" name="grund" required minlength="3" maxlength="300" placeholder="z. B. Stempeln vergessen, laut Polier"></label>';
  const grundAus = (f, m) => { const g = String(f.get('grund') || '').trim(); if (g.length < 3) { m.hidden = false; m.textContent = 'Bitte einen Grund angeben.'; return null; } return g; };

  // C-04: ganze Schicht (Kommen, Pause, Gehen) in einem Schritt nachtragen
  function schichtDialog() {
    const d = dialog({
      titel: `Ganze Schicht nachtragen – ${person()}`, breit: true,
      inhalt: `<form id="sf" class="stack-s" novalidate>
        <div class="form-grid">
          <label class="field"><span class="field-label">Datum (Beginn)</span><input class="input lg" type="date" name="datum" required value="${fmt.addTage(wienHeute(), -1)}" max="${wienHeute()}"></label>
          <label class="field"><span class="field-label">Baustelle</span>${bsWahl(speicher.lies('bt_baustelle'), '')}</label>
          <label class="field"><span class="field-label">von</span><input class="input lg" type="time" name="von" required value="07:00"></label>
          <label class="field"><span class="field-label">bis</span><input class="input lg" type="time" name="bis" required value="16:00"></label>
          <label class="field"><span class="field-label">Pause (Minuten)</span><input class="input lg num" name="pauseMin" inputmode="numeric" value="30"></label>
          <div class="field"><span class="field-label">Ergibt</span><output class="sf-std" id="sf-std" aria-live="polite"></output></div>
        </div>
        <p class="muted sm">Österreichische Ortszeit. Liegt „bis“ vor „von“, endet die Schicht am nächsten Tag.</p>
        ${grundFeld}
        <p class="form-err" role="alert" hidden></p></form>`,
      fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="sf">Schicht nachtragen</button>',
    });
    const form = $('#sf', d.el);
    const rechne = () => {
      const f = new FormData(form); const pause = parseZahl(f.get('pauseMin') || '0');
      const std = f.get('von') && f.get('bis') && f.get('datum') ? stundenAus({ von1: f.get('von'), bis1: f.get('bis'), pauseMin: Number.isFinite(pause) ? pause : 0 }, String(f.get('datum'))) : 0;
      $('#sf-std', d.el).textContent = `${fmt.zahl(std)} Std.${f.get('von') && f.get('bis') && f.get('bis') < f.get('von') ? ' · endet am nächsten Tag' : ''}`;
      return std;
    };
    form.addEventListener('input', rechne); rechne();
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(form); const m = $('.form-err', d.el);
      const pause = parseZahl(f.get('pauseMin') || '0');
      if (!f.get('datum') || !f.get('von') || !f.get('bis') || f.get('von') === f.get('bis')) { m.hidden = false; m.textContent = 'Bitte Datum, „von“ und „bis“ eintragen.'; return; }
      if (!f.get('baustelleId')) { m.hidden = false; m.textContent = 'Bitte die Baustelle wählen.'; return; }
      if (!Number.isFinite(pause) || pause < 0 || pause > 600) { m.hidden = false; m.textContent = 'Pause unklar – bitte Minuten eintragen (z. B. 30).'; return; }
      if (rechne() > 16) { m.hidden = false; m.textContent = 'Eine Schicht darf höchstens 16 Stunden dauern.'; return; }
      const grund = grundAus(f, m); if (!grund) return;
      try {
        await post('/zeit/schichten', { benutzerId, baustelleId: Number(f.get('baustelleId')), datum: f.get('datum'), von: f.get('von'), bis: f.get('bis'), pauseMin: Math.round(pause), grund });
        d.zu(); toast('Schicht nachgetragen.');
        if (f.get('datum') < von) { von = String(f.get('datum')); $('#k-von', el).value = von; }
        ladeListe();
      } catch (err) { m.hidden = false; m.textContent = err.message; }
    });
  }
  function schichtLoeschen(x) {
    const d = dialog({
      titel: 'Ganze Schicht löschen',
      inhalt: `<form id="slf" class="stack-s"><p><b>${esc(person())}</b>, ${esc(fmt.datumLang(x.datum))}, ${esc(uhr(x.beginn))} – ${x.offen ? 'offen' : esc(uhr(x.ende))} Uhr: alle Buchungen dieser Schicht (${(x.buchungIds || []).length || 'Kommen bis Gehen'}) werden gelöscht.</p>${grundFeld}<p class="form-err" role="alert" hidden></p></form>`,
      fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn danger" type="submit" form="slf">Schicht löschen</button>',
    });
    $('#slf', d.el).addEventListener('submit', async (e) => {
      e.preventDefault(); const m = $('.form-err', d.el); const grund = grundAus(new FormData(e.target), m); if (!grund) return;
      try { await api('DELETE', `/zeit/schichten/${x.id}`, { grund }); d.zu(); toast('Schicht gelöscht.'); ladeListe(); }
      catch (err) { m.hidden = false; m.textContent = err.message; }
    });
  }

  function formDialog({ titel, x, loeschen }) {
    const neu = !x;
    const d = dialog({
      titel,
      inhalt: `<form id="kf" class="stack-s">
        ${loeschen ? `<p>${esc(TYP[x.typ] || x.typ)} am ${esc(fmt.datum(lokal(x.zeit).slice(0, 10)))} um ${esc(lokal(x.zeit).slice(11))} Uhr wird gelöscht.</p>` : `
        ${neu ? `<label class="field"><span class="field-label">Art</span><select class="input lg" name="typ">${Object.entries(TYP).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>` : ''}
        <label class="field"><span class="field-label">Zeitpunkt (österreichische Ortszeit)</span><input class="input lg" type="datetime-local" name="zeit" required value="${lokal(x ? x.zeit : new Date().toISOString())}" max="${lokal(new Date().toISOString())}"></label>
        <label class="field"><span class="field-label">Baustelle</span>${bsWahl(x && x.baustelleId, '– unverändert / keine –')}</label>`}
        ${grundFeld}
        <p class="form-err" role="alert" hidden></p></form>`,
      fuss: `<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn ${loeschen ? 'danger' : 'primary'}" type="submit" form="kf">${loeschen ? 'Löschen' : 'Speichern'}</button>`,
    });
    $('#kf', d.el).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target); const m = $('.form-err', d.el);
      const grund = grundAus(f, m); if (!grund) return;
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
    if (e.target.closest('#k-schicht')) return schichtDialog();
    if (e.target.closest('#k-neu')) return formDialog({ titel: `Buchung nachtragen – ${person()}` });
    const sw = e.target.closest('[data-schicht-weg]');
    if (sw) return schichtLoeschen(schichten.find((y) => String(y.id) === sw.dataset.schichtWeg));
    const a = e.target.closest('[data-aendern]');
    if (a) return formDialog({ titel: 'Buchung ändern', x: liste.find((y) => String(y.id) === a.dataset.aendern) });
    const l = e.target.closest('[data-loeschen]');
    if (l) return formDialog({ titel: 'Buchung löschen', x: liste.find((y) => String(y.id) === l.dataset.loeschen), loeschen: true });
  });
  if (benutzerId == null) { $('#k-liste', el).innerHTML = leer('Keine Mitarbeiter vorhanden.', 'users'); $('#k-schichten', el).innerHTML = ''; return; }
  await ladeListe();
}
