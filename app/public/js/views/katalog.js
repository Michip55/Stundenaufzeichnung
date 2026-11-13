// Positionskatalog (Firmenvorlage der Nachkalkulation, API.md Abschnitt 10): pflegen und aus Excel importieren.
// Änderungen hier wirken nur auf neue Baustellen – bestehende Bauvorhaben behalten ihre Positionen und Preise.
import { get, post, put, del } from '../api.js';
import { ic, esc, fmt, parseZahl, starkOk, laden, leer, banner, dialog, bestaetigen, toast, $ } from '../ui.js';
import { GRUPPEN, istBetrag, aufschlag, zuPruefen, naturPruefen } from './positionen.js';

export async function katalogTab(box, ctx) {
  const darf = ctx.kann('preise_bearbeiten');
  let k;
  let mitInaktiven = false;
  box.innerHTML = laden();
  const lade = async () => { k = await get('/positionen/katalog'); k.gruppen = k.gruppen || []; };
  try { await lade(); } catch (e) { box.innerHTML = `<div class="state">${ic(e.status === 403 ? 'lock' : 'alert')}<p>${esc(e.status === 403 ? 'Kein Zugriff' : e.message)}</p></div>`; return; }
  const finde = (id) => k.gruppen.flatMap((g) => g.positionen || []).find((p) => String(p.id) === String(id));

  function zeichne() {
    const anzahl = k.gruppen.reduce((s, g) => s + (g.positionen || []).filter((p) => p.aktiv !== false).length, 0);
    box.innerHTML = `<div data-katalog>
      <div class="card-h pad-h"><h3>Positionskatalog <span class="count">${anzahl}</span></h3>
        <span class="muted sm">${k.stand ? `Stand ${esc(/^\d{4}-\d{2}-\d{2}/.test(k.stand) ? fmt.datum(k.stand) : k.stand)}` : ''}</span><span class="grow"></span>
        ${darf ? `<label class="check-inline"><input type="checkbox" id="kat-inaktiv" ${mitInaktiven ? 'checked' : ''}> Deaktivierte zeigen</label>
        <button type="button" class="btn ghost sm" id="kat-import">${ic('download', 'up')}Excel importieren</button><input type="file" id="kat-datei" class="vh" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Excel-Datei der Vorlage wählen">` : ''}</div>
      ${banner('info', 'Das ist die <b>Firmenvorlage</b>. Neue Baustellen bekommen eine Kopie. Änderungen wirken nicht rückwirkend – je Baustelle gibt es „Aus Vorlage übernehmen“ mit Vorschau.')}
      ${k.gruppen.map((g) => {
        const liste = (g.positionen || []).filter((p) => mitInaktiven || p.aktiv !== false);
        return `<details class="pg kat" data-gruppe="${esc(g.schluessel)}" open><summary><span class="pg-name">${esc(g.name || GRUPPEN[g.schluessel] || g.schluessel)}</span><span class="count">${liste.length}</span><span class="grow"></span>${ic('down')}</summary>
          <div class="tbl-wrap"><table class="tbl price-tbl kat-tbl"><thead><tr><th>Bezeichnung</th><th>EH</th><th class="r">EP</th>${darf ? '<th></th>' : ''}</tr></thead><tbody>
          ${liste.map((p) => `<tr data-kat="${p.id}" class="${p.aktiv === false ? 'aus' : ''}">
            <td class="main">${darf ? `<input class="pt-in" data-kfeld="bezeichnung" value="${esc(p.bezeichnung)}" aria-label="Bezeichnung">` : esc(p.bezeichnung)}
              <span class="pt-marken">${zuPruefen(p) ? '<span class="chip xs st-amber">Zuordnung prüfen</span>' : ''}${p.naturmaterial != null && darf ? `<label class="chip xs ${p.naturmaterial ? 'st-blue' : 'st-outline'} nat"><input type="checkbox" data-kfeld="naturmaterial" ${p.naturmaterial ? 'checked' : ''}> Naturmaterial${naturPruefen(p) ? ' · bitte prüfen' : ''}</label>` : p.naturmaterial ? `<span class="chip xs st-blue">Naturmaterial${naturPruefen(p) ? ' · bitte prüfen' : ''}</span>` : ''}${p.aktiv === false ? '<span class="chip xs st-grey">deaktiviert</span>' : ''}</span></td>
            <td>${darf ? `<input class="pt-in c eh" data-kfeld="einheit" value="${esc(p.einheit || '')}" aria-label="Einheit von ${esc(p.bezeichnung)}">` : esc(p.einheit || '')}</td>
            <td class="r">${darf ? `<label class="price-in"><span class="vh">${istBetrag(p) ? 'Faktor' : 'Einheitspreis'} ${esc(p.bezeichnung)}</span><span aria-hidden="true">${istBetrag(p) ? '×' : '€'}</span><input type="text" inputmode="decimal" class="num" data-kfeld="ep" value="${fmt.betrag(p.ep)}" autocomplete="off"></label>${istBetrag(p) ? ` <small class="auf">${aufschlag(p.ep)}</small>` : ''}` : `<span class="num">${istBetrag(p) ? `× ${fmt.zahl(p.ep)} (${aufschlag(p.ep)})` : fmt.eur(p.ep)}</span>`}</td>
            ${darf ? `<td class="r">${p.aktiv === false ? `<button type="button" class="btn ghost sm" data-kakt="an">Aktivieren</button>` : `<button type="button" class="icon-btn sm" data-kakt="aus" aria-label="${esc(p.bezeichnung)} deaktivieren">${ic('trash')}</button>`}</td>` : ''}</tr>`).join('') || `<tr><td colspan="4" class="muted">Keine Positionen.</td></tr>`}
          </tbody></table></div>
          ${darf ? `<div class="pg-foot"><button type="button" class="btn ghost sm" data-kneu="${esc(g.schluessel)}">${ic('plus')}Position</button><span></span></div>` : ''}</details>`;
      }).join('') || leer('Der Katalog ist leer.', 'table')}
    </div>`;
  }
  const neu = async () => { await lade(); zeichne(); };
  async function aendere(p, body, ok) {
    try { await put(`/positionen/katalog/${p.id}`, { version: p.version, ...body }); if (ok) toast(ok); await neu(); }
    catch (e) { toast(e.status === 409 && e.daten && e.daten.version != null ? 'Inzwischen von jemand anderem geändert – Katalog wird neu geladen.' : e.message, 'warn'); await neu(); }
  }

  /* ---- Excel-Import mit Vorschau ---- */
  async function importiere(datei) {
    if (datei.size > 5 * 1024 * 1024) { toast('Die Datei ist zu groß (höchstens 5 MB).', 'warn'); return; }
    const b64 = await new Promise((ok, nok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, '')); r.onerror = () => nok(r.error); r.readAsDataURL(datei); });
    let v;
    try { v = await post('/positionen/katalog/import', { dateiBase64: b64 }); } catch (e) { toast(e.message, 'warn'); return; }
    const neuL = v.neu || [], geaendert = v.geaendert || [];
    const d = dialog({ titel: 'Excel-Vorlage importieren – Vorschau', breit: true, inhalt: `<div class="stack-s" id="import-vorschau">
      <p class="muted sm">${esc(datei.name)}</p>
      <div class="kpi-row three"><div class="kpi sm"><small>Neue Positionen</small><b data-imp="neu">${neuL.length}</b></div><div class="kpi sm"><small>Geänderte Preise</small><b data-imp="geaendert">${geaendert.length}</b></div><div class="kpi sm"><small>Unverändert</small><b data-imp="unveraendert">${Array.isArray(v.unveraendert) ? v.unveraendert.length : v.unveraendert || 0}</b></div></div>
      ${geaendert.length ? `<h4 class="sub-h">Geänderte Preise</h4><div class="tbl-wrap vl-liste"><table class="tbl"><thead><tr><th>Position</th><th class="r">bisher</th><th class="r">neu</th></tr></thead><tbody>${geaendert.slice(0, 300).map((x) => `<tr><td>${esc(x.bezeichnung)} <small class="muted">${esc(x.einheit || '')}${x.wiederAktiv ? ' · wird wieder aktiv' : ''}</small></td><td class="r num">${fmt.eur(x.epAlt)}</td><td class="r num"><b>${fmt.eur(x.epNeu)}</b></td></tr>`).join('')}</tbody></table></div>` : ''}
      ${neuL.length ? `<h4 class="sub-h">Neue Positionen</h4><div class="tbl-wrap vl-liste"><table class="tbl"><thead><tr><th>Position</th><th>Gruppe</th><th class="r">EP</th></tr></thead><tbody>${neuL.slice(0, 300).map((x) => `<tr><td>${esc(x.bezeichnung)} <small class="muted">${esc(x.einheit || '')}</small></td><td>${esc(GRUPPEN[x.gruppe] || x.gruppe || '')}</td><td class="r num">${fmt.eur(x.ep)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${!neuL.length && !geaendert.length ? banner('ok', 'Die Datei entspricht dem Katalog – es gibt nichts zu übernehmen.') : banner('info', 'Bestehende Baustellen bleiben unverändert. Positionen, die in der Datei fehlen, bleiben im Katalog.')}</div>`,
      fuss: `<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="button" id="imp-ok" ${neuL.length || geaendert.length ? '' : 'disabled'}>In den Katalog übernehmen</button>` });
    $('#imp-ok', d.el).addEventListener('click', async () => {
      $('#imp-ok', d.el).disabled = true;
      try { await post('/positionen/katalog/import?uebernehmen=1', { dateiBase64: b64 }); d.zu(); toast('Katalog aus der Excel-Datei übernommen.'); neu(); }
      catch (e) { toast(e.message, 'warn'); $('#imp-ok', d.el).disabled = false; }
    });
  }

  box.addEventListener('click', async (e) => {
    if (e.target.closest('#kat-import')) { $('#kat-datei', box).click(); return; }
    const n = e.target.closest('[data-kneu]');
    if (n) {
      const gruppe = n.dataset.kneu;
      const d = dialog({ titel: `Neue Katalog-Position – ${GRUPPEN[gruppe] || gruppe}`, inhalt: `<form id="kf" class="form-grid" novalidate>
        <label class="field full"><span class="field-label">Bezeichnung</span><input class="input lg" name="bezeichnung" required maxlength="200"></label>
        <label class="field"><span class="field-label">Einheit</span><input class="input lg" name="einheit" required maxlength="12" placeholder="Std., t, m³, PA …"></label>
        <label class="field"><span class="field-label">Einheitspreis (€) bzw. Faktor</span><input class="input lg num" name="ep" inputmode="decimal" required placeholder="0,00"></label>
        <p class="form-err full" role="alert" hidden></p></form>`, fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="kf">Anlegen</button>' });
      $('#kf', d.el).addEventListener('submit', async (ev) => {
        ev.preventDefault(); const f = new FormData(ev.target); const err = $('.form-err', d.el); const ep = parseZahl(f.get('ep'));
        if (!String(f.get('bezeichnung')).trim() || !String(f.get('einheit')).trim()) { err.hidden = false; err.textContent = 'Bitte Bezeichnung und Einheit eintragen.'; return; }
        if (!Number.isFinite(ep) || ep < 0) { err.hidden = false; err.textContent = 'Preis unklar – bitte so schreiben: 1.250,00'; return; }
        try { await post('/positionen/katalog', { gruppe, bezeichnung: String(f.get('bezeichnung')).trim(), einheit: String(f.get('einheit')).trim(), ep }); d.zu(); toast('Position im Katalog angelegt.'); neu(); }
        catch (x) { err.hidden = false; err.textContent = x.message; }
      });
      return;
    }
    const a = e.target.closest('[data-kakt]'); if (!a) return;
    const p = finde(a.closest('[data-kat]').dataset.kat);
    if (a.dataset.kakt === 'an') return aendere(p, { aktiv: true }, 'Position wieder aktiv.');
    if (!(await bestaetigen('Position deaktivieren?', `„${p.bezeichnung}“ wird für neue Baustellen nicht mehr angeboten. Bestehende Baustellen behalten sie.`, 'Deaktivieren', 'danger'))) return;
    try { await del(`/positionen/katalog/${p.id}`); toast('Position deaktiviert.'); neu(); } catch (x) { toast(x.message, 'warn'); }
  });
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-kfeld]')) e.target.blur(); });
  box.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'kat-inaktiv') { mitInaktiven = t.checked; zeichne(); return; }
    if (t.id === 'kat-datei') { const f = t.files && t.files[0]; t.value = ''; if (f) importiere(f); return; }
    if (!t.dataset.kfeld) return;
    const p = finde(t.closest('[data-kat]').dataset.kat); const feld = t.dataset.kfeld;
    if (feld === 'naturmaterial') return aendere(p, { naturmaterial: t.checked }, t.checked ? 'Als Naturmaterial gekennzeichnet.' : 'Kennzeichen Naturmaterial entfernt.');
    if (feld === 'ep') {
      const wert = parseZahl(t.value);
      if (!Number.isFinite(wert) || wert < 0) { t.closest('.price-in').classList.add('invalid'); toast(`„${t.value}“ ist als Preis unklar – bitte so schreiben: 1.250,00`, 'warn'); return; }
      if (wert === p.ep) { t.value = fmt.betrag(p.ep); return; }
      if (!(await starkOk(p.ep, wert, `Der Katalogpreis „${p.bezeichnung}“`))) { t.value = fmt.betrag(p.ep); return; }
      return aendere(p, { ep: wert }, 'Katalogpreis gespeichert – gilt für neue Baustellen.');
    }
    const wert = t.value.trim();
    if (!wert) { t.value = p[feld] || ''; return; }
    if (wert !== (p[feld] || '')) aendere(p, { [feld]: wert }, 'Gespeichert.');
  });
  zeichne();
}
