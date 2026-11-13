// Projektdokumente je Baustelle (API.md 12.16): Kategorien mit Anzahl, Hochladen (Ziehen, Mehrfachauswahl, Kamera),
// Vorschau (Bild im Lichtkasten, PDF im abgeschotteten Rahmen), Versionen, Suche, Löschen mit Bestätigung.
// Welche Kategorien jemand sieht, bestimmt der Server; finanzielle Kategorien kommen nur mit Preis-Recht.
import { get, post, put, api } from '../api.js';
import { ic, esc, fmt, leer, banner, dialog, bestaetigen, toast, $, $$ } from '../ui.js';
import { wienHeute } from '../zahl.js';

const MAX_MB = 25;
const ERLAUBT = /\.(pdf|jpe?g|png|webp|docx|xlsx)$/i;
const groesse = (n) => (n == null ? '' : n >= 1048576 ? `${fmt.zahl(n / 1048576, 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const istBild = (d) => /^image\//.test(d.mime || '') || /\.(jpe?g|png|webp)$/i.test(d.dateiname || '');
const istPdf = (d) => d.mime === 'application/pdf' || /\.pdf$/i.test(d.dateiname || '');
const symbol = (d) => (istBild(d) ? 'camera' : 'file');
export const dateiBase64 = (datei) => new Promise((ok, nein) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => nein(new Error(`„${datei.name}“ konnte nicht gelesen werden.`)); r.readAsDataURL(datei); });
const dateiUrl = (bsId, d, nr) => d.url && !nr ? d.url : `/api/baustellen/${bsId}/dokumente/${d.id}/datei${nr ? `?version=${nr}` : ''}`;

export async function dokumenteTab(box, b, ctx) {
  const rolle = ctx.ich.benutzer.rolle;
  const planer = ['buero', 'bauleiter', 'gf'].includes(rolle) || ctx.kann('stammdaten'); // Bauleiter wie Büro
  const eigen = (ctx.ich.baustellenIds || []).map(Number).includes(Number(b.id));
  const darfSchreiben = planer;
  const darfKat = (k) => darfSchreiben && (!k.finanziell || ctx.kann('preise_bearbeiten'));
  let kats = [], docs = [], kat = '', suche = '', mitGeloeschten = false, fehler = '';
  async function lade() {
    fehler = '';
    try { [kats, docs] = await Promise.all([get('/dokument-kategorien'), get(`/baustellen/${b.id}/dokumente${mitGeloeschten ? '?geloescht=1' : ''}`)]); }
    catch (e) { if (e.status === 401 || e.netz) throw e; fehler = e.status === 403 ? 'Kein Zugriff auf die Dokumente dieser Baustelle.' : e.message; kats = []; docs = []; }
    // nur Kategorien, die diese Rolle sehen darf (Polier: Pläne, Leitungsauskünfte …; finanzielle nur mit Preis-Recht)
    kats = kats.filter((k) => (rolle !== 'polier' || k.polier) && (!k.finanziell || ctx.kann('preise_sehen')));
    docs = docs.filter((d) => kats.some((k) => k.schluessel === d.kategorie));
    if (kat && !kats.some((k) => k.schluessel === kat)) kat = '';
  }
  await lade();
  const katName = (s) => (kats.find((k) => k.schluessel === s) || {}).name || s;
  const schreibKats = () => kats.filter(darfKat);
  const sicht = () => { const q = suche.trim().toLowerCase(); return docs.filter((d) => (!kat || d.kategorie === kat) && (!q || `${d.titel} ${d.dateiname || ''} ${(d.tags || []).join(' ')} ${d.notiz || ''}`.toLowerCase().includes(q))); };
  const zahl = (s) => docs.filter((d) => !d.geloescht && (!s || d.kategorie === s)).length;

  function zeile(d) {
    return `<li class="dok-zeile${d.geloescht ? ' weg' : ''}" data-dok="${d.id}"><button type="button" class="dok-haupt" data-dok-auf="${d.id}" aria-label="${esc(d.titel)} öffnen"><span class="dok-ic">${ic(symbol(d))}</span><span class="grow"><b>${esc(d.titel)}</b><small>${esc(d.datum ? fmt.datum(d.datum) : fmt.datum(d.erstellt))} · ${esc(katName(d.kategorie))} · ${esc(groesse(d.groesse))}${d.erstelltVon ? ' · ' + esc(d.erstelltVon.name) : ''}</small>${(d.tags || []).length ? `<small>${d.tags.map((t) => `#${esc(t)}`).join(' ')}</small>` : ''}</span></button>
      <span class="chip xs ${Number(d.version) > 1 ? 'st-blue' : 'st-grey'}" data-dok-version="${d.version}" title="Version">v${d.version || 1}</span>${d.geloescht ? `<span class="chip xs st-red">gelöscht</span>${planer ? `<button type="button" class="btn ghost sm" data-dok-zurueck="${d.id}">Wiederherstellen</button>` : ''}` : ''}</li>`;
  }
  function zeichne() {
    const l = sicht();
    box.innerHTML = fehler ? banner('err', esc(fehler)) : `<div class="dok" id="dokumente">
      <aside class="dok-kat" aria-label="Kategorien"><button type="button" class="dok-kat-btn${kat ? '' : ' on'}" data-kat="" aria-pressed="${!kat}"><span>Alle Dokumente</span><b>${zahl('')}</b></button>
        ${kats.map((k) => `<button type="button" class="dok-kat-btn${kat === k.schluessel ? ' on' : ''}" data-kat="${esc(k.schluessel)}" aria-pressed="${kat === k.schluessel}"><span>${esc(k.name)}${k.finanziell ? ` ${ic('euro', 'xs')}` : ''}</span><b>${zahl(k.schluessel)}</b></button>${ctx.kann('benutzer') ? `<button type="button" class="icon-btn sm dok-kat-edit" data-kat-edit="${esc(k.schluessel)}" aria-label="Kategorie ${esc(k.name)} bearbeiten" title="Kategorie bearbeiten">${ic('edit')}</button>` : ''}`).join('')}${ctx.kann('benutzer') ? `<button type="button" class="dok-kat-btn neu" id="dok-kat-neu">${ic('plus', 'xs')}<span>Eigene Kategorie</span></button>` : ''}</aside>
      <div class="dok-haupt-sp stack-s">
        <div class="toolbar wrap"><label class="search weit"><span>${ic('file')}</span><input type="search" id="dok-suche" placeholder="Titel, Dateiname oder Stichwort" aria-label="Dokumente durchsuchen" value="${esc(suche)}"></label>
          ${schreibKats().length ? `<button type="button" class="btn primary" id="dok-neu">${ic('plus')}Hochladen</button><button type="button" class="btn ghost" id="dok-kamera">${ic('camera')}Foto</button><input type="file" id="dok-datei" class="vh" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,application/pdf,image/*" tabindex="-1" aria-hidden="true"><input type="file" id="dok-foto" class="vh" accept="image/*" capture="environment" tabindex="-1" aria-hidden="true">` : `<span class="chip st-grey" id="dok-nur-lesen">nur lesen</span>`}</div>
        ${schreibKats().length ? `<div class="dok-ablage" id="dok-ablage">${ic('download')}<span>Dateien hierher ziehen – PDF, Fotos, Word, Excel, je höchstens ${MAX_MB} MB</span></div>` : ''}
        ${planer ? `<label class="check-inline sm"><input type="checkbox" id="dok-geloescht" ${mitGeloeschten ? 'checked' : ''}> Gelöschte anzeigen</label>` : ''}
        <section class="card">${l.length ? `<ul class="plain dok-liste" id="dok-liste">${l.map(zeile).join('')}</ul>` : leer(suche || kat ? 'Kein Dokument gefunden.' : 'Noch keine Dokumente abgelegt.', 'file')}</section>
      </div></div>`;
  }
  const neu = async () => { await lade(); zeichne(); };

  /* ---- Eigene Kategorie (nur Geschäftsführung) ---- */
  function kategorieDialog(k) {
    // eingebaute Kategorien lassen sich nur umbenennen; eigene auch in den Rechten ändern und – wenn leer – löschen
    const eigen = !k || k.eigen;
    const dlg = dialog({ titel: k ? `Kategorie „${k.name}“` : 'Eigene Kategorie anlegen', inhalt: `<form id="dkk" class="stack-s" novalidate>
      <label class="field"><span class="field-label">Name</span><input class="input lg" name="name" required maxlength="60" value="${esc((k && k.name) || '')}" placeholder="z. B. Vermessung"></label>
      ${eigen ? `<label class="check-inline"><input type="checkbox" name="finanziell" ${k && k.finanziell ? 'checked' : ''}> Enthält Preise – nur mit Preis-Recht sichtbar (nie für Polier)</label>
      <label class="check-inline"><input type="checkbox" name="polier" ${k && k.polier ? 'checked' : ''} ${k && k.finanziell ? 'disabled' : ''}> Polier darf diese Kategorie lesen</label>` : '<p class="muted sm">Eingebaute Kategorie: nur der Name lässt sich ändern.</p>'}
      ${k ? '' : '<p class="muted sm">Die Kategorie gilt für alle Baustellen.</p>'}<p class="form-err" role="alert" hidden></p></form>`,
      fuss: `${k && k.eigen ? '<button class="btn danger" type="button" id="dkk-weg">Löschen</button><span class="grow"></span>' : ''}<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="dkk" id="dkk-ok">${k ? 'Speichern' : 'Anlegen'}</button>` });
    const form = $('#dkk', dlg.el); const err = $('.form-err', dlg.el);
    if (form.elements.finanziell) form.elements.finanziell.addEventListener('change', (e) => { form.elements.polier.disabled = e.target.checked; if (e.target.checked) form.elements.polier.checked = false; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(form); const name = String(f.get('name') || '').trim();
      if (name.length < 2) { err.hidden = false; err.textContent = 'Bitte einen Namen eintragen.'; return; }
      const body = { name, ...(eigen ? { finanziell: f.get('finanziell') === 'on', polier: f.get('polier') === 'on' } : {}) };
      try {
        const r = k ? await put(`/dokument-kategorien/${encodeURIComponent(k.schluessel)}`, body) : await post('/dokument-kategorien', body);
        dlg.zu(); toast(k ? 'Kategorie gespeichert.' : 'Kategorie angelegt.'); if (!k) kat = (r && r.schluessel) || ''; neu();
      } catch (x) { err.hidden = false; err.textContent = x.status === 409 ? (x.message || 'Diese Kategorie gibt es schon.') : x.message; }
    });
    const weg = $('#dkk-weg', dlg.el);
    if (weg) weg.addEventListener('click', async () => {
      if (!(await bestaetigen('Kategorie löschen?', `„${k.name}“ wird entfernt. Das geht nur, solange keine Dokumente darin liegen.`, 'Löschen', 'danger'))) return;
      try { await api('DELETE', `/dokument-kategorien/${encodeURIComponent(k.schluessel)}`); dlg.zu(); toast('Kategorie gelöscht.'); if (kat === k.schluessel) kat = ''; neu(); }
      catch (x) { err.hidden = false; err.textContent = x.status === 409 ? 'In dieser Kategorie liegen noch Dokumente (auch gelöschte zählen) – sie kann nicht gelöscht werden.' : x.message; }
    });
  }

  /* ---- Hochladen ---- */
  function hochladen(dateien, vorKat) {
    const sk = schreibKats(); if (!sk.length) return;
    const ok = [], abgelehnt = [];
    for (const d of dateien) { if (!ERLAUBT.test(d.name)) abgelehnt.push(`„${d.name}“: Dateityp nicht erlaubt (PDF, JPG, PNG, WebP, DOCX, XLSX).`); else if (d.size > MAX_MB * 1048576) abgelehnt.push(`„${d.name}“: größer als ${MAX_MB} MB.`); else ok.push(d); }
    if (!ok.length) { toast(abgelehnt[0] || 'Keine Datei gewählt.', 'warn'); return; }
    const start = sk.some((k) => k.schluessel === (vorKat || kat)) ? vorKat || kat : (sk.find((k) => k.schluessel === 'sonstiges') || sk[0]).schluessel;
    const dlg = dialog({ titel: ok.length > 1 ? `${ok.length} Dateien hochladen` : 'Datei hochladen', breit: true, inhalt: `<form id="dkf" class="stack-s" novalidate>
      ${abgelehnt.length ? banner('warn', abgelehnt.map(esc).join('<br>')) : ''}
      <div class="form-grid"><label class="field"><span class="field-label">Kategorie</span><select class="input lg" name="kategorie">${sk.map((k) => `<option value="${esc(k.schluessel)}" ${k.schluessel === start ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Datum des Dokuments</span><input class="input lg" type="date" name="datum" value="${wienHeute()}"></label></div>
      <ul class="plain dok-upload" id="dok-upload">${ok.map((d, i) => `<li data-up="${i}"><label class="field weit"><span class="field-label">${esc(d.name)} · ${esc(groesse(d.size))}</span><input class="input" name="titel${i}" maxlength="200" required value="${esc(d.name.replace(/\.[^.]+$/, ''))}" aria-label="Titel für ${esc(d.name)}"></label><span class="dok-up-stand" aria-live="polite"></span></li>`).join('')}</ul>
      <label class="field"><span class="field-label">Stichworte (optional, mit Komma)</span><input class="input lg" name="tags" maxlength="200" placeholder="z. B. Einbauten, Stand 11/2026"></label>
      <p class="form-err" role="alert" hidden></p></form>`,
      fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="dkf" id="dok-senden">Hochladen</button>' });
    $('#dkf', dlg.el).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target); const knopf = $('#dok-senden', dlg.el); knopf.disabled = true;
      const tags = String(f.get('tags') || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10);
      let fehl = 0;
      for (let i = 0; i < ok.length; i += 1) {
        const li = $(`[data-up="${i}"]`, dlg.el), stand = $('.dok-up-stand', li);
        if (li.dataset.fertig) continue;
        stand.textContent = 'lädt …';
        try { await post(`/baustellen/${b.id}/dokumente`, { kategorie: f.get('kategorie'), titel: String(f.get('titel' + i) || '').trim() || ok[i].name, datum: f.get('datum') || undefined, tags, dateiBase64: await dateiBase64(ok[i]), dateiname: ok[i].name }); stand.innerHTML = `<span class="chip xs st-green">abgelegt</span>`; li.dataset.fertig = '1'; }
        catch (x) { fehl += 1; stand.innerHTML = `<span class="crew-err">${esc(x.message)}</span>`; }
      }
      if (!fehl) { dlg.zu(); toast(`${ok.length} Dokument${ok.length > 1 ? 'e' : ''} abgelegt.`); kat = f.get('kategorie'); } else { knopf.disabled = false; knopf.textContent = 'Erneut versuchen'; }
      neu();
    });
  }

  /* ---- Ansehen, Versionen, Bearbeiten, Löschen ---- */
  function oeffnen(d) {
    const k = kats.find((x) => x.schluessel === d.kategorie) || {};
    const schreib = !d.geloescht && darfKat(k);
    const url = dateiUrl(b.id, d);
    const schau = istBild(d) ? `<a class="dok-bild" href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="${esc(d.titel)}" id="dok-vorschau-bild"></a>` : istPdf(d) ? `<a class="dok-pdf-karte" id="dok-pdf-oeffnen" href="${esc(url)}" target="_blank" rel="noopener">${ic('file')}<span><b>PDF öffnen</b><small>${esc(d.dateiname || '')} · ${esc(groesse(d.groesse))} – öffnet in einem neuen Tab</small></span></a>` : `<p class="muted sm">Für diesen Dateityp gibt es keine Vorschau – bitte herunterladen.</p>`;
    const dlg = dialog({ titel: d.titel, breit: true, inhalt: `<div class="stack-s" id="dok-dialog" data-dok="${d.id}">
      <div class="dok-vorschau">${schau}</div>
      <div class="btn-row"><a class="btn ghost" id="dok-laden" href="${esc(url)}" download="${esc(d.dateiname || 'dokument')}">${ic('download')}Herunterladen</a></div>
      ${schreib ? `<form id="dmf" class="form-grid" novalidate><label class="field full"><span class="field-label">Titel</span><input class="input lg" name="titel" required maxlength="200" value="${esc(d.titel)}"></label>
        <label class="field"><span class="field-label">Kategorie</span><select class="input lg" name="kategorie">${schreibKats().map((x) => `<option value="${esc(x.schluessel)}" ${x.schluessel === d.kategorie ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Datum</span><input class="input lg" type="date" name="datum" value="${esc(d.datum || '')}"></label>
        <label class="field full"><span class="field-label">Stichworte</span><input class="input lg" name="tags" maxlength="200" value="${esc((d.tags || []).join(', '))}"></label>
        <label class="field full"><span class="field-label">Notiz</span><textarea class="input lg" name="notiz" rows="2" maxlength="2000">${esc(d.notiz || '')}</textarea></label><p class="form-err full" role="alert" hidden></p></form>`
      : `<dl class="def-list"><div><dt>Kategorie</dt><dd>${esc(katName(d.kategorie))}</dd></div><div><dt>Datum</dt><dd>${esc(d.datum ? fmt.datum(d.datum) : '–')}</dd></div>${d.notiz ? `<div><dt>Notiz</dt><dd>${esc(d.notiz)}</dd></div>` : ''}</dl>`}
      <h4 class="sub-h">Versionen <span class="count">${(d.versionen || []).length || 1}</span></h4>
      <ul class="plain rows" id="dok-versionen">${(d.versionen || []).slice().sort((x, y) => y.nr - x.nr).map((v) => `<li data-version="${v.nr}"><span class="grow"><b>Version ${v.nr}${v.nr === d.version ? ' (aktuell)' : ''}</b><small>${esc(v.dateiname || '')} · ${esc(groesse(v.groesse))} · ${esc(fmt.zeitpunkt(v.erstellt))}${v.erstelltVon ? ' · ' + esc(v.erstelltVon.name) : ''}${v.notiz ? ' · ' + esc(v.notiz) : ''}</small></span><a class="btn ghost sm" href="${esc(v.url || dateiUrl(b.id, d, v.nr))}" download="${esc(v.dateiname || 'dokument')}">${ic('download', 'xs')}Laden</a></li>`).join('')}</ul>
      ${schreib ? `<div class="btn-row"><button type="button" class="btn ghost" id="dok-version-neu">${ic('plus')}Neue Version hochladen</button><input type="file" id="dok-version-datei" class="vh" accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx" tabindex="-1" aria-hidden="true"></div>` : ''}
      ${d.geloescht ? banner('warn', `Gelöscht am ${esc(fmt.zeitpunkt(d.geloescht.zeit))} von ${esc((d.geloescht.von && d.geloescht.von.name) || '')}${d.geloescht.grund ? ' – ' + esc(d.geloescht.grund) : ''}`) : ''}</div>`,
      fuss: schreib ? '<button class="btn danger" type="button" id="dok-weg">Löschen</button><span class="grow"></span><button class="btn ghost" type="button" data-zu>Schließen</button><button class="btn primary" type="submit" form="dmf">Speichern</button>' : '<button class="btn ghost" type="button" data-zu>Schließen</button>' });
    if (!schreib) return;
    $('#dmf', dlg.el).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target); const err = $('.form-err', dlg.el);
      try { await put(`/baustellen/${b.id}/dokumente/${d.id}`, { titel: String(f.get('titel')).trim(), kategorie: f.get('kategorie'), datum: f.get('datum') || null, notiz: String(f.get('notiz') || '').trim(), tags: String(f.get('tags') || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10) }); dlg.zu(); toast('Gespeichert.'); neu(); }
      catch (x) { err.hidden = false; err.textContent = x.message; }
    });
    $('#dok-version-neu', dlg.el).addEventListener('click', () => $('#dok-version-datei', dlg.el).click());
    $('#dok-version-datei', dlg.el).addEventListener('change', async (e) => {
      const datei = e.target.files[0]; e.target.value = ''; if (!datei) return;
      if (!ERLAUBT.test(datei.name) || datei.size > MAX_MB * 1048576) { toast(`Nur PDF, Fotos, DOCX, XLSX bis ${MAX_MB} MB.`, 'warn'); return; }
      try { await post(`/baustellen/${b.id}/dokumente/${d.id}/versionen`, { dateiBase64: await dateiBase64(datei), dateiname: datei.name }); dlg.zu(); toast('Neue Version abgelegt – ältere bleiben abrufbar.'); await neu(); const frisch = docs.find((x) => x.id === d.id); if (frisch) oeffnen(frisch); }
      catch (x) { toast(x.message, 'warn'); }
    });
    $('#dok-weg', dlg.el).addEventListener('click', () => {
      const q = dialog({ titel: 'Dokument löschen?', inhalt: `<form id="dlf" class="stack-s"><p>„${esc(d.titel)}“ wird aus der Liste entfernt. Das Büro kann es wiederherstellen; der Vorgang steht im Protokoll.</p><label class="field"><span class="field-label">Grund (optional)</span><input class="input lg" name="grund" maxlength="300"></label></form>`, fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn danger" type="submit" form="dlf" id="dok-weg-ok">Löschen</button>' });
      $('#dlf', q.el).addEventListener('submit', async (ev) => { ev.preventDefault(); try { await api('DELETE', `/baustellen/${b.id}/dokumente/${d.id}`, { grund: String(new FormData(ev.target).get('grund') || '').trim() }); q.zu(); dlg.zu(); toast('Dokument gelöscht.'); } catch (x) { toast(x.message, 'warn'); } neu(); });
    });
  }

  box.addEventListener('click', async (e) => {
    const k = e.target.closest('[data-kat]'); if (k) { kat = k.dataset.kat; return zeichne(); }
    const ke = e.target.closest('[data-kat-edit]'); if (ke) return kategorieDialog(kats.find((x) => x.schluessel === ke.dataset.katEdit));
    if (e.target.closest('#dok-kat-neu')) return kategorieDialog();
    if (e.target.closest('#dok-neu')) return $('#dok-datei', box).click();
    if (e.target.closest('#dok-kamera')) return $('#dok-foto', box).click();
    const z = e.target.closest('[data-dok-zurueck]');
    if (z) { try { await post(`/baustellen/${b.id}/dokumente/${z.dataset.dokZurueck}/wiederherstellen`); toast('Wiederhergestellt.'); } catch (x) { toast(x.message, 'warn'); } return neu(); }
    const a = e.target.closest('[data-dok-auf]');
    if (a) { let d = docs.find((x) => String(x.id) === a.dataset.dokAuf); if (!d) return; if (!d.versionen) d = await get(`/baustellen/${b.id}/dokumente/${d.id}`).catch(() => d); oeffnen(d); }
  });
  box.addEventListener('change', (e) => {
    if (e.target.id === 'dok-datei' || e.target.id === 'dok-foto') { const l = [...(e.target.files || [])]; const foto = e.target.id === 'dok-foto'; e.target.value = ''; if (l.length) hochladen(l, foto ? 'fotos' : ''); }
    if (e.target.id === 'dok-geloescht') { mitGeloeschten = e.target.checked; neu(); }
  });
  box.addEventListener('input', (e) => { if (e.target.id === 'dok-suche') { suche = e.target.value; const pos = e.target.selectionStart; zeichne(); const s = $('#dok-suche', box); s.focus(); s.setSelectionRange(pos, pos); } });
  // Dateien aus dem Explorer hereinziehen
  const mitDatei = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  box.addEventListener('dragover', (e) => { if (!mitDatei(e) || !schreibKats().length) return; e.preventDefault(); const a = $('#dok-ablage', box); if (a) a.classList.add('an'); });
  box.addEventListener('dragleave', (e) => { if (e.target === box || !box.contains(e.relatedTarget)) $$('.dok-ablage.an', box).forEach((a) => a.classList.remove('an')); });
  box.addEventListener('drop', (e) => { if (!mitDatei(e) || !schreibKats().length) return; e.preventDefault(); $$('.dok-ablage.an', box).forEach((a) => a.classList.remove('an')); hochladen([...e.dataTransfer.files]); });
  zeichne();
}
