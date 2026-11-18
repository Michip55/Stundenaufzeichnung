// Positionskatalog (Firmenvorlage der Nachkalkulation, API.md Abschnitt 10): pflegen und aus Excel importieren.
// Änderungen hier wirken nur auf neue Baustellen – bestehende Bauvorhaben behalten ihre Positionen und Preise.
import { get, post, put, del } from '../api.js';
import { preisDialog, geplantChip } from '../preisstand.js';
import { wienHeute } from '../zahl.js';
import { ic, esc, fmt, parseZahl, starkOk, laden, leer, banner, dialog, bestaetigen, toast, $ } from '../ui.js';
import { GRUPPEN, istBetrag, aufschlag, zuPruefen, naturPruefen, herkunftChip } from './positionen.js';

// E-02: höchstens 5 MB je Datei (Server-Grenze laut API.md 10f); nie zwei Importe gleichzeitig
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
let importLaeuft = false;

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
      <div class="banner err" id="kat-fehler" role="alert" hidden>${ic('alert')}<span></span></div>
      ${banner('info', 'Das ist die <b>Firmenvorlage</b>. Neue Baustellen bekommen eine Kopie. Änderungen wirken nicht rückwirkend – je Baustelle gibt es „Aus Vorlage übernehmen“ mit Vorschau.')}
      ${k.gruppen.map((g) => {
        const liste = (g.positionen || []).filter((p) => mitInaktiven || p.aktiv !== false);
        return `<details class="pg kat" data-gruppe="${esc(g.schluessel)}" open><summary><span class="pg-name">${esc(g.name || GRUPPEN[g.schluessel] || g.schluessel)}</span><span class="count">${liste.length}</span><span class="grow"></span>${ic('down')}</summary>
          <div class="tbl-wrap"><table class="tbl price-tbl kat-tbl"><thead><tr><th>Bezeichnung</th><th>EH</th><th class="r">EP</th>${darf ? '<th></th>' : ''}</tr></thead><tbody>
          ${liste.map((p) => `<tr data-kat="${p.id}" class="${p.aktiv === false ? 'aus' : ''}">
            <td class="main">${darf ? `<input class="pt-in" data-kfeld="bezeichnung" value="${esc(p.bezeichnung)}" aria-label="Bezeichnung">` : esc(p.bezeichnung)}
              <span class="pt-marken">${herkunftChip(p)}${zuPruefen(p) ? '<span class="chip xs st-amber">Zuordnung prüfen</span>' : ''}${(p.naturmaterialMoeglich ?? /^t$/i.test(String(p.einheit || '').trim())) && darf ? `<label class="chip xs ${p.naturmaterial ? 'st-blue' : 'st-outline'} nat"><input type="checkbox" data-kfeld="naturmaterial" ${p.naturmaterial ? 'checked' : ''}> Naturmaterial${naturPruefen(p) ? ' · bitte prüfen' : ''}</label>` : p.naturmaterial ? `<span class="chip xs st-blue">Naturmaterial${naturPruefen(p) ? ' · bitte prüfen' : ''}</span>` : ''}${p.aktiv === false ? '<span class="chip xs st-grey">deaktiviert</span>' : ''}</span></td>
            <td>${darf ? `<input class="pt-in c eh" data-kfeld="einheit" value="${esc(p.einheit || '')}" aria-label="Einheit von ${esc(p.bezeichnung)}">` : esc(p.einheit || '')}</td>
            <td class="r">${darf ? `<label class="price-in"><span class="vh">${istBetrag(p) ? 'Faktor' : 'Einheitspreis'} ${esc(p.bezeichnung)}</span><span aria-hidden="true">${istBetrag(p) ? '×' : '€'}</span><input type="text" inputmode="decimal" class="num" data-kfeld="ep" value="${fmt.betrag(p.ep)}" autocomplete="off"></label>${istBetrag(p) ? ` <small class="auf">${aufschlag(p.ep)}</small>` : ''}<button type="button" class="icon-btn sm pv-btn" data-kverlauf aria-label="Preisverlauf ${esc(p.bezeichnung)}" title="Preisverlauf">${ic('clock')}</button>${geplantChip(p.epGeplant, istBetrag(p))}` : `<span class="num">${istBetrag(p) ? `× ${fmt.zahl(p.ep)} (${aufschlag(p.ep)})` : fmt.eur(p.ep)}</span>`}</td>
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
    // E-02: Grenze passend zum Server (API.md 10f); die Vorlage des Betriebs hat rund 25 KB
    const fehler = (text) => { const b = $('#kat-fehler', box); if (b) { b.hidden = !text; $('span', b).textContent = text || ''; if (text) b.scrollIntoView({ block: 'nearest' }); } if (text) toast(text, 'warn'); };
    fehler('');
    if (!/\.xlsx$/i.test(datei.name)) { fehler('Bitte eine Excel-Datei im Format .xlsx wählen (im Aufbau der Firmenvorlage).'); return; }
    if (datei.size > MAX_IMPORT_BYTES) { fehler(`Die Datei ist zu groß (${fmt.zahl(datei.size / 1024 / 1024, 1)} MB). Erlaubt sind höchstens ${fmt.zahl(MAX_IMPORT_BYTES / 1024 / 1024, 1)} MB – die Firmenvorlage hat nur wenige Kilobyte.`); return; }
    if (importLaeuft) { fehler('Ein Import läuft bereits – bitte warten, bis die Vorschau erscheint.'); return; }
    importLaeuft = true;
    const knopf = $('#kat-import', box); if (knopf) { knopf.disabled = true; knopf.dataset.laeuft = '1'; }
    const fertig = () => { importLaeuft = false; const k2 = $('#kat-import', box); if (k2) { k2.disabled = false; delete k2.dataset.laeuft; } };
    const meldung = (e) => (e.netz ? 'Keine Verbindung zum Server – die Datei wurde nicht übertragen.'
      : e.status === 413 ? `Die Datei ist für den Import zu groß. Erlaubt sind höchstens ${fmt.zahl(MAX_IMPORT_BYTES / 1024 / 1024, 1)} MB.`
      : e.status === 409 || e.status === 429 || e.status === 423 ? (e.message || 'Ein Import läuft bereits – bitte kurz warten und noch einmal versuchen.')
      : `Die Datei wurde abgelehnt: ${e.message}`);
    const b64 = await new Promise((ok, nok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, '')); r.onerror = () => nok(r.error); r.readAsDataURL(datei); });
    let v;
    try { v = await post('/positionen/katalog/import', { dateiBase64: b64 }); } catch (e) { fertig(); fehler(meldung(e)); return; }
    fertig();
    const neuL = v.neu || [], geaendert = v.geaendert || [];
    const umbenannt = v.umbenannt || [], zeilenFehler = v.fehler || [], doppelt = v.doppelt || [], ohneSumme = v.ohneSummenzeile || [];
    const geschuetzt = geaendert.filter((x) => x.geschuetzt), frei = geaendert.filter((x) => !x.geschuetzt);
    const kannUebernehmen = !zeilenFehler.length && (neuL.length || frei.length || geschuetzt.length);
    const d = dialog({ titel: 'Excel-Vorlage importieren – Vorschau', breit: true, inhalt: `<div class="stack-s" id="import-vorschau">
      <p class="muted sm">${esc(datei.name)}</p>
      <div class="kpi-row three"><div class="kpi sm"><small>Neue Positionen</small><b data-imp="neu">${neuL.length}</b></div><div class="kpi sm"><small>Geänderte Preise</small><b data-imp="geaendert">${geaendert.length}</b></div><div class="kpi sm"><small>Unverändert</small><b data-imp="unveraendert">${Array.isArray(v.unveraendert) ? v.unveraendert.length : v.unveraendert || 0}</b></div></div>
      ${zeilenFehler.length ? `<div data-imp-fehler>${banner('err', `<b>${zeilenFehler.length} Zeile${zeilenFehler.length > 1 ? 'n' : ''} mit Fehlern – es wird nichts übernommen.</b> Bitte die Datei korrigieren und erneut importieren.`)}<ul class="warn-list imp-liste">${zeilenFehler.slice(0, 50).map((x) => `<li>${ic('alert')}<span>Zeile ${esc(x.zeile)}: ${esc(x.text)}</span></li>`).join('')}</ul></div>` : ''}
      ${doppelt.length ? `<div data-imp-doppelt>${banner('warn', `<b>${doppelt.length} doppelte Zeile${doppelt.length > 1 ? 'n' : ''}</b> in der Datei – jede Position wird nur einmal übernommen: ${doppelt.slice(0, 12).map((x) => `Zeile ${esc(x.zeile)} „${esc(x.bezeichnung)}“`).join(', ')}${doppelt.length > 12 ? ' …' : ''}`)}</div>` : ''}
      ${ohneSumme.length ? `<div data-imp-ignoriert>${banner('warn', `<b>${ohneSumme.length} Zeile${ohneSumme.length > 1 ? 'n' : ''} ohne Gruppe</b> (stehen hinter der letzten Summenzeile) werden nicht übernommen: ${ohneSumme.slice(0, 12).map((x) => `Zeile ${esc(x.zeile)} „${esc(x.bezeichnung)}“`).join(', ')}${ohneSumme.length > 12 ? ' …' : ''}`)}</div>` : ''}
      ${umbenannt.length ? `<div data-imp-umbenannt>${banner('info', `<b>${umbenannt.length} Position${umbenannt.length > 1 ? 'en' : ''} mit altem Namen erkannt</b> – sie werden der umbenannten Position zugeordnet, es entsteht nichts doppelt: ${umbenannt.slice(0, 10).map((x) => `„${esc(x.alt)}“ → „${esc(x.neu)}“`).join(', ')}${umbenannt.length > 10 ? ' …' : ''}`)}</div>` : ''}
      ${geaendert.length ? `<h4 class="sub-h">Geänderte Preise</h4><div class="tbl-wrap vl-liste"><table class="tbl"><thead><tr><th>Position</th><th class="r">bisher</th><th class="r">Datei</th></tr></thead><tbody>${geaendert.slice(0, 300).map((x) => `<tr ${x.geschuetzt ? 'data-geschuetzt class="geschuetzt"' : ''}><td>${esc(x.bezeichnung)} <small class="muted">${esc(x.einheit || '')}${x.wiederAktiv ? ' · wird wieder aktiv' : ''}</small>${x.geschuetzt ? `<span class="chip xs st-amber">${ic('lock')}${esc(x.hinweis || 'weicht von Preisliste-2026-Anpassung ab')} – wird nicht übernommen</span>` : x.hinweis ? `<small class="muted"> · ${esc(x.hinweis)}</small>` : ''}</td><td class="r num">${fmt.eur(x.epAlt)}</td><td class="r num"><b>${fmt.eur(x.epNeu)}</b></td></tr>`).join('')}</tbody></table></div>` : ''}
      ${geaendert.length && !zeilenFehler.length ? `<label class="field"><span class="field-label">Geänderte Preise gelten ab</span><input class="input lg" type="date" id="imp-ab" value="${wienHeute()}" min="2000-01-01"></label>` : ''}
      ${geschuetzt.length && !zeilenFehler.length ? `<label class="check-inline"><input type="checkbox" id="imp-ueberschreiben"> Freigegebene Anpassungen (Preisliste 2026) trotzdem mit den Werten der Datei überschreiben</label>` : ''}
      ${neuL.length ? `<h4 class="sub-h">Neue Positionen</h4><div class="tbl-wrap vl-liste"><table class="tbl"><thead><tr><th>Position</th><th>Gruppe</th><th class="r">EP</th></tr></thead><tbody>${neuL.slice(0, 300).map((x) => `<tr><td>${esc(x.bezeichnung)} <small class="muted">${esc(x.einheit || '')}</small></td><td>${esc(GRUPPEN[x.gruppe] || x.gruppe || '')}</td><td class="r num">${fmt.eur(x.ep)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${!neuL.length && !geaendert.length && !zeilenFehler.length ? banner('ok', 'Die Datei entspricht dem Katalog – es gibt nichts zu übernehmen.') : zeilenFehler.length ? '' : banner('info', 'Bestehende Baustellen bleiben unverändert. Positionen, die in der Datei fehlen, bleiben im Katalog.')}</div>`,
      fuss: `<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="button" id="imp-ok" ${kannUebernehmen && (neuL.length || frei.length) ? '' : 'disabled'}>In den Katalog übernehmen</button>` });
    const ueb = $('#imp-ueberschreiben', d.el);
    if (ueb) ueb.addEventListener('change', () => { $('#imp-ok', d.el).disabled = !(neuL.length || frei.length || ueb.checked); });
    $('#imp-ok', d.el).addEventListener('click', async () => {
      if (ueb && ueb.checked && !(await bestaetigen('Freigegebene Preise überschreiben?', `${geschuetzt.length} vom Kunden freigegebene Anpassung${geschuetzt.length > 1 ? 'en' : ''} aus der Preisliste 2026 werden durch die Werte der Datei ersetzt.`, 'Überschreiben', 'danger'))) return;
      $('#imp-ok', d.el).disabled = true;
      const abFeld = $('#imp-ab', d.el); const ab = abFeld && abFeld.value ? abFeld.value : '';
      let rueck = '';
      if (ab && ab < wienHeute()) {
        if (!(await bestaetigen('Preise rückwirkend übernehmen?', `Die geänderten Katalogpreise gelten dann schon ab ${fmt.datum(ab)}. Das wird protokolliert.`, 'Ja, rückwirkend', 'danger'))) { $('#imp-ok', d.el).disabled = false; return; }
        rueck = '&rueckwirkend=1';
      }
      try { await post(`/positionen/katalog/import?uebernehmen=1${ab ? '&gueltigAb=' + ab : ''}${rueck}${ueb && ueb.checked ? '&anpassungenUeberschreiben=1' : ''}`, { dateiBase64: b64 }); d.zu(); toast('Katalog aus der Excel-Datei übernommen.'); neu(); }
      catch (e) { d.zu(); fehler(meldung(e)); }
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
    const kv = e.target.closest('[data-kverlauf]');
    if (kv) { const p = finde(kv.closest('[data-kat]').dataset.kat); if (await preisDialog({ was: `${p.bezeichnung} (Katalog)`, faktor: istBetrag(p), darf, verlauf: () => get(`/positionen/katalog/${p.id}/verlauf`), loeschen: (vid) => del(`/positionen/katalog/${p.id}/verlauf/${vid}`) })) neu(); return; }
    const a = e.target.closest('[data-kakt]'); if (!a) return;
    const p = finde(a.closest('[data-kat]').dataset.kat);
    if (a.dataset.kakt === 'an') return aendere(p, { aktiv: true }, 'Position wieder aktiv.');
    if (!(await bestaetigen('Position deaktivieren?', `„${p.bezeichnung}“ wird für neue Baustellen nicht mehr angeboten. Bestehende Baustellen behalten sie.`, 'Deaktivieren', 'danger'))) return;
    try { await del(`/positionen/katalog/${p.id}`); toast('Position deaktiviert.'); neu(); } catch (x) { toast(x.message, 'warn'); }
  });
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-kfeld]')) { e.preventDefault(); e.target.blur(); } });
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
      const ok = await preisDialog({ was: `${p.bezeichnung} (Katalog)`, alt: p.ep, neu: wert, faktor: istBetrag(p), darf: true,
        senden: (x) => put(`/positionen/katalog/${p.id}`, { version: p.version, ep: wert, ...x }),
        verlauf: () => get(`/positionen/katalog/${p.id}/verlauf`), loeschen: (vid) => del(`/positionen/katalog/${p.id}/verlauf/${vid}`) });
      if (!ok) t.value = fmt.betrag(p.ep);
      return neu();
    }
    const wert = t.value.trim();
    if (!wert) { t.value = p[feld] || ''; return; }
    if (wert !== (p[feld] || '')) aendere(p, { [feld]: wert }, 'Gespeichert.');
  });
  zeichne();
}
