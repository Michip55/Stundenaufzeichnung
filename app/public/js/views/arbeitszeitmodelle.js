// Arbeitszeitmodelle (API.md 15.23): Stammdaten der Firma – Wochenstunden, Normalstunden je Wochentag, Überstunden-Regel,
// bei Teilzeit Vollzeit-Wochenstunden (Mehrstunden). Ansehen mit stammdaten oder lohn, pflegen nur mit dem Recht stammdaten.
// Zuordnung je Person mit Stichtag im Benutzer-Dialog (Benutzer & Rechte).
import { get, post, put, del } from '../api.js';
import { ic, esc, fmt, parseZahl, laden, leer, banner, dialog, bestaetigen, toast, $, $$ } from '../ui.js';

export const TAGE = [['mo', 'Mo'], ['di', 'Di'], ['mi', 'Mi'], ['do', 'Do'], ['fr', 'Fr'], ['sa', 'Sa'], ['so', 'So']];
export const REGEL_TEXT = { tag_oder_woche: 'Tag oder Woche (die größere Überschreitung)', woche: 'nur Woche' };
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const std = (x) => fmt.zahl(x || 0, 2).replace(/,00$/, '');

/** Kurzbeschreibung eines Modells, z. B. „39 Std. · Mo–Do 8, Fr 7 · Tag oder Woche“ */
export function modellKurz(m) {
  if (!m) return '';
  const tage = TAGE.filter(([k]) => (m.stunden || {})[k] > 0);
  const gruppen = [];
  for (const [k, t] of tage) {
    const h = m.stunden[k]; const l = gruppen[gruppen.length - 1];
    const idx = TAGE.findIndex(([x]) => x === k);
    if (l && l.h === h && l.idx === idx - 1) { l.bis = t; l.idx = idx; } else gruppen.push({ von: t, bis: t, h, idx });
  }
  const tagText = gruppen.map((g) => `${g.von}${g.bis !== g.von ? '–' + g.bis : ''} ${std(g.h)}`).join(', ');
  return `${std(m.wochenstunden)} Std./Woche · ${tagText || 'keine Tage'} · ${m.regel === 'woche' ? 'Überstunden nur je Woche' : 'Überstunden je Tag oder Woche'}${m.vollzeitWochenstunden ? ` · Mehrstunden bis ${std(m.vollzeitWochenstunden)} Std.` : ''}`;
}

export async function arbeitszeitTab(box, ctx) {
  const darf = ctx.kann('stammdaten');
  let liste = [];
  let mitInaktiven = false;
  box.innerHTML = laden();
  const lade = async () => { liste = await get('/arbeitszeitmodelle?inaktiv=1'); };
  try { await lade(); } catch (e) { box.innerHTML = `<div class="state">${ic(e.status === 403 ? 'lock' : 'alert')}<p>${esc(e.status === 403 ? 'Kein Zugriff' : e.message)}</p></div>`; return; }
  const finde = (id) => liste.find((m) => String(m.id) === String(id));

  function zeichne() {
    const l = liste.filter((m) => mitInaktiven || m.aktiv !== false);
    box.innerHTML = `<div data-arbeitszeit>
      <div class="card-h pad-h"><h3>Arbeitszeitmodelle <span class="count">${liste.filter((m) => m.aktiv !== false).length}</span></h3><span class="grow"></span>
        <label class="check-inline sm"><input type="checkbox" id="az-inaktiv" ${mitInaktiven ? 'checked' : ''}> Inaktive anzeigen</label>
        ${darf ? `<button type="button" class="btn primary sm" id="az-neu">${ic('plus')}Neues Modell</button>` : ''}</div>
      ${banner('info', 'Über- und Mehrstunden rechnet die App je Person nach ihrem Arbeitszeitmodell am jeweiligen Tag (Monatsauswertung, Lohn-Export). Die Zuordnung mit Stichtag steht im Benutzer-Dialog unter <b>Benutzer &amp; Rechte</b>. Die Regeln bitte mit der Lohnverrechnung bestätigen.')}
      ${l.length ? `<div class="tbl-wrap"><table class="tbl karten-handy" id="az-tabelle"><thead><tr><th>Modell</th><th class="r">Std./Woche</th>${TAGE.map(([, t]) => `<th class="r">${t}</th>`).join('')}<th>Überstunden</th><th class="r">Vollzeit</th><th class="r">Personen</th>${darf ? '<th><span class="vh">Aktionen</span></th>' : ''}</tr></thead>
        <tbody>${l.map((m) => `<tr data-az="${m.id}" class="${m.aktiv === false ? 'aus' : ''}">
          <td class="main" data-th="Modell">${esc(m.name)}${m.vorgabe ? ` <span class="chip xs st-outline" title="Vorgabe für neue Personen">Vorgabe ${m.vorgabe === 'feld' ? 'Mitarbeiter/Polier' : 'Büro'}</span>` : ''}${m.aktiv === false ? ' <span class="chip xs st-grey" data-inaktiv>inaktiv</span>' : ''}</td>
          <td class="r num" data-th="Std./Woche" data-az-woche>${std(m.wochenstunden)}</td>
          ${TAGE.map(([k, t]) => `<td class="r num muted" data-th="${t}">${m.stunden[k] ? std(m.stunden[k]) : '–'}</td>`).join('')}
          <td data-th="Überstunden">${m.regel === 'woche' ? 'nur Woche' : 'Tag oder Woche'}</td>
          <td class="r num" data-th="Vollzeit">${m.vollzeitWochenstunden ? `${std(m.vollzeitWochenstunden)} <small class="muted">(Mehrstunden)</small>` : '–'}</td>
          <td class="r num" data-th="Personen">${m.personen ?? ''}</td>
          ${darf ? `<td class="nw st-akt">${m.aktiv === false ? `<button type="button" class="btn ghost sm" data-az-an="${m.id}">Wieder aktivieren</button>` : `<button type="button" class="icon-btn sm" data-az-edit="${m.id}" aria-label="${esc(m.name)} bearbeiten" title="Bearbeiten">${ic('edit')}</button>`}<button type="button" class="icon-btn sm" data-az-weg="${m.id}" aria-label="${esc(m.name)} löschen" title="Löschen">${ic('trash')}</button></td>` : ''}</tr>`).join('')}</tbody></table></div>` : leer('Keine Arbeitszeitmodelle.', 'clock')}
      <p class="fineprint">„Tag oder Woche“: Überstunden sind die größere der Summe der Tagesüberschreitungen und der Wochenüberschreitung (KV Bau). „Nur Woche“: erst über den Wochenstunden. Teilzeit mit Vollzeit-Angabe: Stunden über den Wochenstunden bis zur Vollzeit sind Mehrstunden, darüber Überstunden. Feiertage zählen mit 0 Normalstunden. Ein verwendetes Modell kann nur deaktiviert werden.</p>
    </div>`;
  }

  function modellDialog(m) {
    const wert = (x) => (x == null ? '' : String(x).replace('.', ','));
    const d = dialog({ titel: m ? 'Arbeitszeitmodell bearbeiten' : 'Neues Arbeitszeitmodell', breit: true, inhalt: `<form id="azf" class="stack-s" novalidate>
      <label class="field"><span class="field-label">Name</span><input class="input lg" name="name" maxlength="80" required value="${esc(m ? m.name : '')}" autocomplete="off" placeholder="z. B. Teilzeit 20 Std."><small class="price-err" data-az-fehler="name" role="alert" hidden></small></label>
      <div class="form-grid">
        <label class="field"><span class="field-label">Wochenstunden</span><input class="input lg num" name="wochenstunden" inputmode="decimal" required value="${esc(wert(m ? m.wochenstunden : ''))}" autocomplete="off" placeholder="39"><small class="price-err" data-az-fehler="wochenstunden" role="alert" hidden></small></label>
        <label class="field"><span class="field-label">Überstunden-Regel</span><select class="input lg" name="regel">${Object.entries(REGEL_TEXT).map(([k, t]) => `<option value="${k}" ${(m ? m.regel : 'woche') === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      </div>
      <fieldset class="field full"><legend class="field-label">Normalstunden je Wochentag</legend><div class="az-tage" id="az-tage">${TAGE.map(([k, t]) => `<label class="field"><span class="field-label">${t}</span><input class="input num" name="t_${k}" inputmode="decimal" value="${esc(wert(m ? m.stunden[k] : ''))}" autocomplete="off" placeholder="0" aria-label="Normalstunden ${t}"></label>`).join('')}</div>
        <small class="muted" id="az-summe" aria-live="polite"></small><small class="price-err" data-az-fehler="stunden" role="alert" hidden></small></fieldset>
      <label class="field"><span class="field-label">Vollzeit-Wochenstunden (nur Teilzeit, sonst leer)</span><input class="input lg num" name="vollzeit" inputmode="decimal" value="${esc(wert(m ? m.vollzeitWochenstunden : ''))}" autocomplete="off" placeholder="z. B. 39" aria-describedby="az-vz-hinweis"><small class="muted" id="az-vz-hinweis">Stunden über den Wochenstunden bis zur Vollzeit zählen als Mehrstunden, darüber als Überstunden.</small><small class="price-err" data-az-fehler="vollzeit" role="alert" hidden></small></label>
      ${m && m.personen ? `<div id="az-rueck-hinweis">${banner('warn', `Dieses Modell gilt für ${m.personen} Person${m.personen === 1 ? '' : 'en'}. Eine Änderung der Stunden oder der Regel wirkt auch auf bereits gerechnete Tage. Für eine Änderung ab einem Stichtag besser ein neues Modell anlegen und den Personen zuordnen.`)}</div>` : ''}
      <p class="form-err" role="alert" hidden></p></form>`,
    fuss: `<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="azf" id="az-ok">${m ? 'Speichern' : 'Anlegen'}</button>` });
    const form = $('#azf', d.el);
    const zahl = (k) => { const s = String(form.elements[k].value || '').trim(); return s === '' ? 0 : parseZahl(s); };
    const summe = () => r2(TAGE.reduce((a, [k]) => a + (zahl('t_' + k) || 0), 0));
    const zeigSumme = () => {
      const w = parseZahl(String(form.elements.wochenstunden.value || '').trim());
      const s = summe();
      $('#az-summe', d.el).textContent = `Summe der Tage: ${std(s)} Std.${isFinite(w) && w > 0 ? (Math.abs(s - w) > 0.011 ? ` – muss ${std(w)} Std. ergeben` : ' ✓') : ''}`;
    };
    form.addEventListener('input', zeigSumme); zeigSumme();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('.form-err', d.el);
      $$('[data-az-fehler]', d.el).forEach((x) => { x.hidden = true; }); err.hidden = true;
      const zeig = (text, k) => { const fe = k && $(`[data-az-fehler="${k}"]`, d.el); if (fe) { fe.hidden = false; fe.textContent = text; const inp = form.elements[k] || form.elements.t_mo; if (inp && inp.focus) inp.focus(); } else { err.hidden = false; err.textContent = text; } };
      const name = String(form.elements.name.value || '').trim();
      if (name.length < 2) return zeig('Bitte einen Namen mit mindestens 2 Zeichen eingeben.', 'name');
      const w = parseZahl(String(form.elements.wochenstunden.value || '').trim());
      if (!(w >= 1 && w <= 60)) return zeig('Bitte Wochenstunden zwischen 1 und 60 eintragen, z. B. 38,5.', 'wochenstunden');
      const stunden = {};
      for (const [k, t] of TAGE) { const h = zahl('t_' + k); if (!(h >= 0 && h <= 12)) return zeig(`${t}: bitte 0 bis 12 Stunden eintragen.`, 'stunden'); stunden[k] = r2(h); }
      if (Math.abs(summe() - w) > 0.011) return zeig(`Die Tage ergeben ${std(summe())} Std. – zusammen müssen es die Wochenstunden (${std(w)} Std.) sein.`, 'stunden');
      const vzRoh = String(form.elements.vollzeit.value || '').trim();
      const vz = vzRoh === '' ? null : parseZahl(vzRoh);
      if (vz != null && !(vz > w && vz <= 60)) return zeig('Vollzeit-Wochenstunden müssen größer als die Wochenstunden sein (höchstens 60) – bei Vollzeit leer lassen.', 'vollzeit');
      const body = { name, wochenstunden: r2(w), stunden, regel: form.elements.regel.value, vollzeitWochenstunden: vz == null ? null : r2(vz) };
      $('#az-ok', d.el).disabled = true;
      try {
        if (m) {
          try { await put(`/arbeitszeitmodelle/${m.id}`, { ...body, version: m.version }); }
          catch (x) {
            if (x.status !== 422) throw x;
            if (!(await bestaetigen('Auch rückwirkend ändern?', x.message, 'Ja, rückwirkend ändern', 'danger'))) { $('#az-ok', d.el).disabled = false; return; }
            await put(`/arbeitszeitmodelle/${m.id}`, { ...body, version: m.version, rueckwirkend: true });
          }
        } else await post('/arbeitszeitmodelle', body);
        d.zu(); toast(m ? 'Arbeitszeitmodell gespeichert.' : `Arbeitszeitmodell „${name}“ angelegt.`); neu();
      } catch (x) {
        $('#az-ok', d.el).disabled = false;
        if (x.status === 409 && !(x.daten && x.daten.version != null)) return zeig(x.message, 'name');
        zeig(x.status === 409 ? 'Inzwischen von jemand anderem geändert – bitte schließen und neu laden.' : x.message);
      }
    });
  }
  async function aktiv(m, an) {
    try { await put(`/arbeitszeitmodelle/${m.id}`, { version: m.version, aktiv: an }); toast(an ? `„${m.name}“ ist wieder aktiv.` : `„${m.name}“ deaktiviert – kann keiner Person mehr neu zugeordnet werden.`); if (!an) mitInaktiven = true; }
    catch (x) { toast(x.message, 'warn'); }
    neu();
  }
  function loeschen(m) {
    const d = dialog({ titel: 'Arbeitszeitmodell löschen?', inhalt: `<div class="stack-s" id="az-weg-dialog"><p>„${esc(m.name)}“ wird endgültig gelöscht – das geht nur, wenn das Modell nie einer Person zugeordnet war.</p><div id="az-verwendet"></div></div>`,
      fuss: `<button class="btn ghost" type="button" data-zu>Abbrechen</button>${m.aktiv !== false && !m.vorgabe ? '<button class="btn ghost" type="button" id="az-deaktiv">Nur deaktivieren</button>' : ''}<button class="btn danger" type="button" id="az-weg-ok">Löschen</button>` });
    const de = $('#az-deaktiv', d.el);
    if (de) de.addEventListener('click', () => { d.zu(); aktiv(m, false); });
    $('#az-weg-ok', d.el).addEventListener('click', async (e) => {
      e.target.disabled = true;
      try { await del(`/arbeitszeitmodelle/${m.id}`); d.zu(); toast('Arbeitszeitmodell gelöscht.'); neu(); }
      catch (x) {
        if (x.status !== 409) { e.target.disabled = false; toast(x.message, 'warn'); return; }
        $('#az-verwendet', d.el).innerHTML = banner('warn', `${esc(x.message)}`);
        e.target.remove();
        const b = $('#az-deaktiv', d.el); if (b) { b.className = 'btn primary'; b.textContent = 'Deaktivieren'; }
      }
    });
  }
  async function neu() { try { await lade(); } catch (x) { toast(x.message, 'warn'); } if (ctx.aktuell()) zeichne(); }

  box.addEventListener('click', (e) => {
    if (e.target.closest('#az-neu')) return modellDialog(null);
    const ed = e.target.closest('[data-az-edit]'); if (ed) return modellDialog(finde(ed.dataset.azEdit));
    const an = e.target.closest('[data-az-an]'); if (an) return aktiv(finde(an.dataset.azAn), true);
    const w = e.target.closest('[data-az-weg]'); if (w) return loeschen(finde(w.dataset.azWeg));
  });
  box.addEventListener('change', (e) => { if (e.target.id === 'az-inaktiv') { mitInaktiven = e.target.checked; zeichne(); } });
  zeichne();
}
