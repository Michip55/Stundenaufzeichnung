// Abwesenheit als Zeitraum-Antrag (API.md 12.24): ein Antrag „von–bis“ statt vieler Einzeltage.
// Gemeinsamer Dialog für „Urlaub“ und „Abwesenheiten“ mit Vorschau vom Server (Arbeitstage, Ausgelassenes, Resturlaub)
// sowie die gruppierte Antragsliste mit Entscheidung für den ganzen Antrag oder je Tag. Keine €-Felder.
import { get, post, put, del } from '../api.js';
import { ic, esc, fmt, dialog, bestaetigen, toast, entprellt, $ } from '../ui.js';

export const A_CODES = { U: 'Urlaub', ZA: 'Zeitausgleich', K: 'Krank', SW: 'Schlechtwetter', BU: 'Betriebsurlaub', abwesend: 'abwesend' };
const A_STATUS = { beantragt: ['beantragt', 'st-amber'], genehmigt: ['genehmigt', 'st-green'], abgelehnt: ['abgelehnt', 'st-red'] };
export const antragStatus = (s) => { const [t, c] = A_STATUS[s] || [s, 'st-grey']; return `<span class="chip xs ${c}" data-antrag-status="${esc(s)}">${esc(t)}</span>`; };
const tagKurz = (iso) => fmt.datumKurz(iso).replace(',', '');
export const zeitraumText = (a) => (a.von === a.bis ? tagKurz(a.von) : `${tagKurz(a.von)}–${tagKurz(a.bis)}`);
const tageText = (n) => `${n} Arbeitstag${n === 1 ? '' : 'e'}`;

/**
 * Dialog „von–bis“. opt: { benutzerId, name, selbst, codes:[…], von, formId, okId, titel, fertig(r) }
 */
export function zeitraumDialog(opt) {
  const fid = opt.formId || 'zr-form', okId = opt.okId || 'zr-ok';
  const dlg = dialog({ titel: opt.titel || (opt.selbst ? 'Urlaub beantragen' : `Abwesenheit eintragen · ${opt.name || ''}`), inhalt: `<form id="${fid}" class="form-grid zr-form" novalidate>
    <label class="field"><span class="field-label">Von</span><input class="input lg" type="date" name="von" required value="${esc(opt.von)}"></label>
    <label class="field"><span class="field-label">Bis</span><input class="input lg" type="date" name="bis" required value="${esc(opt.von)}"></label>
    <label class="field full"><span class="field-label">Art</span><select class="input lg" name="code">${opt.codes.map((c) => `<option value="${c}">${esc(A_CODES[c] || c)}</option>`).join('')}</select></label>
    <label class="field full"><span class="field-label">Notiz (optional)</span><input class="input lg" name="notiz" maxlength="200" placeholder="z. B. Familienurlaub"></label>
    <div class="full zr-vorschau" id="zr-vorschau" aria-live="polite"></div>
    ${opt.selbst ? '<p class="muted sm full">Der Antrag geht als Ganzes ans Büro. Erst nach der Genehmigung zählen die Tage.</p>' : ''}
    <p class="form-err full" role="alert" hidden></p></form>`,
    fuss: `<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="${fid}" id="${okId}">${opt.selbst ? 'Beantragen' : 'Eintragen'}</button>` });
  const form = $(`#${fid}`, dlg.el), box = $('#zr-vorschau', dlg.el), err = $('.form-err', dlg.el);
  const body = (probe) => { const f = new FormData(form); const notiz = String(f.get('notiz') || '').trim(); return { benutzerId: opt.benutzerId, von: f.get('von'), bis: f.get('bis'), code: f.get('code'), ...(notiz ? { notiz } : {}), ...(probe ? { vorschau: true } : {}) }; };
  let lauf = 0, gesendet = false;
  const vorschau = entprellt(async () => {
    if (gesendet) return; // nach dem Absenden keine Vorschau mehr (sie würde den eigenen neuen Antrag als Konflikt melden)
    const b = body(true), nr = ++lauf;
    if (!b.von || !b.bis) { box.innerHTML = ''; return; }
    if (b.bis < b.von) { box.innerHTML = '<p class="zr-warn">„Bis“ darf nicht vor „Von“ liegen.</p>'; box.dataset.arbeitstage = ''; return; }
    try {
      const r = await post('/abwesenheiten/zeitraum', b);
      if (nr !== lauf) return;
      const k = r.konto && r.konto.restNachAntrag != null ? r.konto : null;
      box.dataset.arbeitstage = r.arbeitstage;
      box.innerHTML = `<p class="zr-zahl"><b data-zr-tage>${tageText(r.arbeitstage)}</b> <span class="muted">(Wochenende und Feiertage zählen nicht)</span>${k ? ` · Resturlaub danach: <b data-zr-rest class="${k.restNachAntrag < 0 ? 'neg' : ''}">${esc(fmt.zahl(k.restNachAntrag, 1))} Tage</b>` : ''}</p>
        ${k && k.restNachAntrag < 0 ? `<p class="zr-warn" data-zr-negativ>${ic('alert', 'xs')} Der Resturlaub reicht nicht – es fehlen ${esc(fmt.zahl(-k.restNachAntrag, 1))} Tage.</p>` : ''}
        ${(r.uebersprungen || []).length ? `<ul class="plain zr-aus" data-zr-ausgelassen>${r.uebersprungen.map((u) => `<li>${esc(tagKurz(u.datum))}: ${esc(u.grund)} – wird ausgelassen</li>`).join('')}</ul>` : ''}`;
      err.hidden = true;
    } catch (x) { if (nr !== lauf) return; box.dataset.arbeitstage = ''; box.innerHTML = `<p class="zr-warn" data-zr-fehler>${esc(x.netz ? 'Keine Verbindung – die Vorschau kann gerade nicht geladen werden.' : x.message)}</p>`; }
  }, 250);
  form.elements.von.addEventListener('change', () => { if (!form.elements.bis.value || form.elements.bis.value < form.elements.von.value) form.elements.bis.value = form.elements.von.value; });
  form.addEventListener('input', vorschau); form.addEventListener('change', vorschau); vorschau.sofort();
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); const b = body(false);
    if (!b.von || !b.bis || b.bis < b.von) { err.hidden = false; err.textContent = 'Bitte Von und Bis eintragen – Bis darf nicht vor Von liegen.'; return; }
    $(`#${okId}`, dlg.el).disabled = true; gesendet = true; lauf += 1;
    try {
      const r = await post('/abwesenheiten/zeitraum', b);
      dlg.zu();
      toast(r.status === 'genehmigt' ? `${tageText(r.arbeitstage)} eingetragen und genehmigt.` : `Antrag für ${tageText(r.arbeitstage)} gestellt – wartet auf Genehmigung${opt.selbst ? ' durch das Büro' : ''}.`);
      if (opt.fertig) opt.fertig(r);
    } catch (x) { gesendet = false; $(`#${okId}`, dlg.el).disabled = false; err.hidden = false; err.textContent = x.message; }
  });
  return dlg;
}

/* ---------- Gruppierte Anträge: entschieden wird immer der ganze Antrag, nie tageweise ---------- */
export const antraegeLaden = (filter = {}) => get(`/abwesenheiten/antraege?${new URLSearchParams(Object.entries(filter).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)]))}`);
// r: { entscheiden(a) → bool, zurueck(a) → bool, korrigieren(a) → bool, mitName }
export function antragZeile(a, r) {
  const offen = (a.tage || []).some((t) => t.status === 'beantragt');
  const ent = offen && r.entscheiden(a), zur = offen && r.zurueck(a);
  const korr = !offen && a.status === 'genehmigt' && r.korrigieren && r.korrigieren(a);
  const n = (a.tage || []).length;
  return `<li class="an-zeile" data-antrag="${esc(a.antragId)}" data-status="${esc(a.status)}"><div class="an-kopf"><span class="grow"><b>${r.mitName === false ? '' : esc(a.name) + ' · '}${esc(A_CODES[a.code] || a.code)} · ${esc(zeitraumText(a))}</b><small>${tageText(a.arbeitstage ?? n)}${a.notiz ? ' · ' + esc(a.notiz) : ''}${a.antwort ? ' · Antwort: ' + esc(a.antwort) : ''}</small></span>${antragStatus(a.status)}</div>
    ${ent || zur || korr ? `<div class="an-knoepfe">${ent ? `<button type="button" class="btn primary sm" data-antrag-entscheid="genehmigt">${ic('check', 'xs')}Ganzen Antrag genehmigen</button><button type="button" class="btn ghost sm" data-antrag-entscheid="abgelehnt">${ic('x', 'xs')}Ablehnen</button>` : ''}${zur ? '<button type="button" class="btn ghost sm" data-antrag-zurueck>Antrag zurückziehen</button>' : ''}${korr ? `<button type="button" class="btn ghost sm" data-antrag-korrigieren>${ic('edit', 'xs')}Korrigieren</button>` : ''}</div>` : ''}
    ${n > 1 ? `<details class="an-tage"><summary>${n} Tage ansehen</summary><ul class="plain">${a.tage.map((t) => `<li data-tag="${t.datum}"><span class="grow">${esc(tagKurz(t.datum))}</span></li>`).join('')}</ul></details>` : ''}</li>`;
}
export const antraegeHtml = (liste, r, leerText = 'Keine Anträge.') => (liste.length ? `<ul class="plain an-liste">${liste.map((a) => antragZeile(a, r)).join('')}</ul>` : `<p class="muted sm pad-s">${esc(leerText)}</p>`);
// Korrektur eines genehmigten Antrags durch das Büro: einzelne Tage herausnehmen oder den ganzen Antrag löschen
function korrekturDialog(a, ctx, fertig) {
  const dlg = dialog({ titel: `Antrag korrigieren · ${a.name || ''}`, inhalt: `<form id="an-korr" class="stack-s" novalidate>
    <p>${esc(A_CODES[a.code] || a.code)} · ${esc(zeitraumText(a))} · ${tageText(a.arbeitstage ?? a.tage.length)} – genehmigt.</p>
    <fieldset class="field"><legend class="field-label">Einzelne Tage herausnehmen (z. B. früher zurück)</legend><div class="pick-multi">${a.tage.map((t) => `<label class="check-inline"><input type="checkbox" name="tag" value="${t.id}"> ${esc(tagKurz(t.datum))}</label>`).join('')}</div></fieldset>
    <p class="muted sm">Herausgenommene Tage zählen nicht mehr als Urlaub; das Urlaubskonto wird neu gerechnet. Die Person wird benachrichtigt.</p><p class="form-err" role="alert" hidden></p></form>`,
    fuss: '<button class="btn danger" type="button" id="an-korr-alles">Ganzen Antrag löschen</button><span class="grow"></span><button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="an-korr" id="an-korr-ok">Gewählte Tage entfernen</button>' });
  $('#an-korr', dlg.el).addEventListener('submit', async (e) => {
    e.preventDefault(); const ids = new FormData(e.target).getAll('tag'); const err = $('.form-err', dlg.el);
    if (!ids.length) { err.hidden = false; err.textContent = 'Bitte mindestens einen Tag wählen – oder den ganzen Antrag löschen.'; return; }
    if (ids.length === a.tage.length) { err.hidden = false; err.textContent = 'Alle Tage gewählt – dafür bitte „Ganzen Antrag löschen“ verwenden.'; return; }
    if (!(await bestaetigen(`${ids.length} Tag${ids.length === 1 ? '' : 'e'} aus dem Antrag entfernen?`, 'Die Tage zählen dann nicht mehr als Abwesenheit.', 'Entfernen', 'danger'))) return;
    let fehl = '';
    for (const id of ids) { try { await del(`/abwesenheiten/${id}`); } catch (x) { fehl = x.message; } }
    dlg.zu(); toast(fehl || 'Antrag korrigiert.', fehl ? 'warn' : 'ok'); ctx.meldungenNeu(); fertig();
  });
  $('#an-korr-alles', dlg.el).addEventListener('click', async () => {
    if (!(await bestaetigen('Ganzen Antrag löschen?', `${tageText(a.arbeitstage ?? a.tage.length)} von ${a.name || 'dieser Person'} werden gelöscht und zählen nicht mehr.`, 'Löschen', 'danger'))) return;
    try { await del(`/abwesenheiten/antraege/${encodeURIComponent(a.antragId)}`); dlg.zu(); toast('Antrag gelöscht.'); ctx.meldungenNeu(); } catch (x) { toast(x.message, 'warn'); }
    fertig();
  });
}
// Klicks in einer Antragsliste; holAntrag(antragId) liefert den Antrag, fertig() lädt die Ansicht neu
export function antraegeBinden(el, ctx, holAntrag, fertig) {
  el.addEventListener('click', async (e) => {
    const zeile = e.target.closest('[data-antrag]'); if (!zeile) return;
    const id = encodeURIComponent(zeile.dataset.antrag);
    const en = e.target.closest('[data-antrag-entscheid]');
    if (en) {
      const status = en.dataset.antragEntscheid;
      const senden = async (antwort) => { en.disabled = true; try { await put(`/abwesenheiten/antraege/${id}`, { status, ...(antwort ? { antwort } : {}) }); toast(status === 'genehmigt' ? 'Antrag genehmigt.' : 'Antrag abgelehnt.'); ctx.meldungenNeu(); } catch (x) { toast(x.message, 'warn'); } fertig(); };
      if (status === 'genehmigt') return senden('');
      const q = dialog({ titel: 'Antrag ablehnen', inhalt: '<form id="an-ab" class="stack-s"><p class="muted sm">Abgelehnt wird der ganze Antrag.</p><label class="field"><span class="field-label">Begründung für die Person (optional)</span><input class="input lg" name="antwort" maxlength="300" placeholder="z. B. In dieser Woche sind schon zwei aus der Partie auf Urlaub."></label></form>', fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn danger" type="submit" form="an-ab" id="an-ab-ok">Ablehnen</button>' });
      $('#an-ab', q.el).addEventListener('submit', (ev) => { ev.preventDefault(); const t = String(new FormData(ev.target).get('antwort') || '').trim(); q.zu(); senden(t); });
      return;
    }
    if (e.target.closest('[data-antrag-korrigieren]')) { const a = holAntrag(zeile.dataset.antrag); if (a) korrekturDialog(a, ctx, fertig); return; }
    if (e.target.closest('[data-antrag-zurueck]')) {
      if (!(await bestaetigen('Antrag zurückziehen?', 'Der ganze Antrag wird gelöscht.', 'Zurückziehen'))) return;
      try { await del(`/abwesenheiten/antraege/${id}`); toast('Antrag zurückgezogen.'); ctx.meldungenNeu(); } catch (x) { toast(x.message, 'warn'); }
      fertig();
    }
  });
}
