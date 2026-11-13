// Preise: Lohngruppen, Geräte, Material, Leistungen – mit direkter Bearbeitung in der Tabelle.
import { get, put, del } from '../api.js';
import { preisDialog, geplantChip } from '../preisstand.js';
import { ic, esc, fmt, parseZahl, starkOk, leer, banner, toast, speicher, $, $$ } from '../ui.js';
import { katalogTab } from './katalog.js';

const TABS = [
  { art: 'lohngruppen', text: 'Lohngruppen', spalten: [['name', 'Lohngruppe']], preise: [['kostensatz', 'Kostensatz / Std.'], ['regiesatz', 'Regiesatz / Std.']] },
  { art: 'geraete', text: 'Geräte', spalten: [['code', 'Code'], ['name', 'Gerät']], preise: [['kostensatz', 'Kostensatz / Std.'], ['verrechnungssatz', 'Verrechnungssatz / Std.']] },
  { art: 'materialien', text: 'Material', spalten: [['code', 'Code'], ['name', 'Material'], ['einheit', 'Einheit']], preise: [['ek', 'Einkauf (EK)'], ['vk', 'Verkauf (VK)']] },
  { art: 'leistungen', text: 'Leistungen', spalten: [['code', 'Pos.'], ['text', 'Leistung'], ['einheit', 'Einheit']], preise: [['ep', 'Einheitspreis (EP)']] },
];

export default async function preise(el, ctx) {
  const daten = await get('/preise');
  const darf = ctx.kann('preise_bearbeiten');
  let tab = ctx.query.get('tab') === 'katalog' || speicher.lies('bt_preistab') === 'katalog' ? 'katalog' : TABS.some((t) => t.art === speicher.lies('bt_preistab')) ? speicher.lies('bt_preistab') : 'lohngruppen';

  function tabelle(t) {
    const zeilen = daten[t.art] || [];
    if (!zeilen.length) return leer('Keine Einträge vorhanden.', 'tag');
    return `<div class="tbl-wrap"><table class="tbl price-tbl"><thead><tr>${t.spalten.map(([, h]) => `<th>${h}</th>`).join('')}${t.preise.map(([, h]) => `<th class="r">${h}</th>`).join('')}</tr></thead>
      <tbody>${zeilen.map((z) => `<tr data-id="${esc(z.id)}">${t.spalten.map(([k], i) => `<td class="${i === t.spalten.length - 1 || k === 'name' || k === 'text' ? 'main' : 'muted nw'}">${esc(z[k] ?? '')}</td>`).join('')}
        ${t.preise.map(([k, h]) => `<td class="r">${darf
          ? `<label class="price-in"><span class="vh">${esc(h)} – ${esc(z.name || z.text || '')}</span><span aria-hidden="true">€</span><input type="text" inputmode="decimal" class="num" data-feld="${k}" value="${z[k] != null ? fmt.betrag(z[k]) : ''}" autocomplete="off"></label>`
          : `<span class="num">${fmt.eur(z[k])}</span>`}<button type="button" class="icon-btn sm pv-btn" data-verlauf="${k}" aria-label="Preisverlauf ${esc(h)} – ${esc(z.name || z.text || '')}" title="Preisverlauf">${ic('clock')}</button>${geplantChip((z.geplant || []).filter((x) => x.feld === k))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function zeichne() {
    const t = TABS.find((x) => x.art === tab) || { art: 'katalog' };
    el.innerHTML = `
    <div class="page">
      ${darf ? '' : banner('info', 'Nur Ansicht – Preise ändern dürfen Büro und Geschäftsführung.', 'lock')}
      <div class="tabs" role="tablist" aria-label="Preisarten">${TABS.map((x) => `<button type="button" role="tab" id="tab-${x.art}" aria-selected="${x.art === tab}" aria-controls="tabpanel" class="${x.art === tab ? 'on' : ''}" data-tab="${x.art}">${x.text}<span class="count">${(daten[x.art] || []).length}</span></button>`).join('')}<button type="button" role="tab" id="tab-katalog" aria-selected="${tab === 'katalog'}" aria-controls="tabpanel" class="${tab === 'katalog' ? 'on' : ''}" data-tab="katalog">Positionskatalog</button></div>
      <section class="card" id="tabpanel" role="tabpanel" aria-labelledby="tab-${t.art}">${tab === 'katalog' ? '' : tabelle(t)}</section>
      ${darf && tab !== 'katalog' ? `<p class="fineprint">Kostensätze für die Ansicht „Interne Kosten“. Änderungen werden sofort gespeichert und protokolliert. Die Verrechnungspreise der Nachkalkulation stehen im Positionskatalog bzw. je Bauvorhaben.</p>` : ''}
    </div>`;
    if (tab === 'katalog') { const box = document.createElement('div'); $('#tabpanel', el).appendChild(box); katalogTab(box, ctx); }
  }
  el.addEventListener('click', (e) => { const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; speicher.setz('bt_preistab', tab); zeichne(); } });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('.price-in input')) e.target.blur(); });
  el.addEventListener('change', async (e) => {
    const inp = e.target.closest('.price-in input'); if (!inp || inp.closest('[data-katalog]')) return;
    const tr = inp.closest('tr'), feld = inp.dataset.feld;
    const zeile = (daten[tab] || []).find((z) => String(z.id) === tr.dataset.id);
    const wert = parseZahl(inp.value);
    const zurueck = () => { inp.value = fmt.betrag(zeile[feld]); };
    const box = inp.closest('.price-in');
    let hinweis = $('.price-err', box.parentElement);
    if (!isFinite(wert) || wert < 0) {
      // B-04: unklare Eingabe nie raten – Feld markieren, alten Wert behalten
      box.classList.add('invalid'); inp.setAttribute('aria-invalid', 'true');
      if (!hinweis) { hinweis = document.createElement('small'); hinweis.className = 'price-err'; hinweis.setAttribute('role', 'alert'); box.insertAdjacentElement('afterend', hinweis); }
      hinweis.textContent = `„${inp.value}“ ist unklar – bitte so schreiben: 1.250,00`;
      return;
    }
    box.classList.remove('invalid'); inp.removeAttribute('aria-invalid'); if (hinweis) hinweis.remove();
    if (wert === zeile[feld]) { zurueck(); return; }
    if (!(await starkOk(zeile[feld], wert, `Der Preis „${zeile.name || zeile.text || ''}“`))) { zurueck(); return; }
    // 12.2: jeder neue Preis ist ein Stand mit „gültig ab“ – der Dialog fragt das Datum ab (Standard heute)
    const t = TABS.find((x) => x.art === tab);
    const feldText = (f) => ((t.preise.find(([k]) => k === f) || [])[1] || f);
    const ok = await preisDialog({
      was: `${zeile.name || zeile.text || ''} – ${feldText(feld)}`, alt: zeile[feld], neu: wert, darf: true, feld, feldText,
      senden: (x) => put(`/preise/${tab}/${encodeURIComponent(zeile.id)}`, { feld, wert, ...x }),
      verlauf: () => get(`/preise/${tab}/${encodeURIComponent(zeile.id)}/verlauf`),
      loeschen: (vid) => del(`/preise/${tab}/${encodeURIComponent(zeile.id)}/verlauf/${vid}`),
    });
    if (!ok) { zurueck(); return; }
    await neuLaden(); ctx.meldungenNeu();
  });
  el.addEventListener('click', async (e) => {
    const v = e.target.closest('[data-verlauf]'); if (!v || v.closest('[data-katalog]')) return;
    const t = TABS.find((x) => x.art === tab);
    const zeile = (daten[tab] || []).find((z) => String(z.id) === v.closest('tr').dataset.id);
    const feldText = (f) => ((t.preise.find(([k]) => k === f) || [])[1] || f);
    const ok = await preisDialog({ was: `${zeile.name || zeile.text || ''} – ${feldText(v.dataset.verlauf)}`, darf, feld: v.dataset.verlauf, feldText,
      verlauf: () => get(`/preise/${tab}/${encodeURIComponent(zeile.id)}/verlauf`), loeschen: (vid) => del(`/preise/${tab}/${encodeURIComponent(zeile.id)}/verlauf/${vid}`) });
    if (ok) neuLaden();
  });
  async function neuLaden() { try { Object.assign(daten, await get('/preise')); } catch (x) { toast(x.message, 'warn'); } if (ctx.aktuell()) zeichne(); }
  zeichne();
}
