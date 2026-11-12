// Preise: Lohngruppen, Geräte, Material, Leistungen – mit direkter Bearbeitung in der Tabelle.
import { get, put } from '../api.js';
import { ic, esc, fmt, parseZahl, starkOk, leer, banner, toast, speicher, $, $$ } from '../ui.js';

const TABS = [
  { art: 'lohngruppen', text: 'Lohngruppen', spalten: [['name', 'Lohngruppe']], preise: [['kostensatz', 'Kostensatz / Std.'], ['regiesatz', 'Regiesatz / Std.']] },
  { art: 'geraete', text: 'Geräte', spalten: [['code', 'Code'], ['name', 'Gerät']], preise: [['kostensatz', 'Kostensatz / Std.'], ['verrechnungssatz', 'Verrechnungssatz / Std.']] },
  { art: 'materialien', text: 'Material', spalten: [['code', 'Code'], ['name', 'Material'], ['einheit', 'Einheit']], preise: [['ek', 'Einkauf (EK)'], ['vk', 'Verkauf (VK)']] },
  { art: 'leistungen', text: 'Leistungen', spalten: [['code', 'Pos.'], ['text', 'Leistung'], ['einheit', 'Einheit']], preise: [['ep', 'Einheitspreis (EP)']] },
];

export default async function preise(el, ctx) {
  const daten = await get('/preise');
  const darf = ctx.kann('preise_bearbeiten');
  let tab = TABS.some((t) => t.art === speicher.lies('bt_preistab')) ? speicher.lies('bt_preistab') : 'lohngruppen';

  function tabelle(t) {
    const zeilen = daten[t.art] || [];
    if (!zeilen.length) return leer('Keine Einträge vorhanden.', 'tag');
    return `<div class="tbl-wrap"><table class="tbl price-tbl"><thead><tr>${t.spalten.map(([, h]) => `<th>${h}</th>`).join('')}${t.preise.map(([, h]) => `<th class="r">${h}</th>`).join('')}</tr></thead>
      <tbody>${zeilen.map((z) => `<tr data-id="${esc(z.id)}">${t.spalten.map(([k], i) => `<td class="${i === t.spalten.length - 1 || k === 'name' || k === 'text' ? 'main' : 'muted nw'}">${esc(z[k] ?? '')}</td>`).join('')}
        ${t.preise.map(([k, h]) => `<td class="r">${darf
          ? `<label class="price-in"><span class="vh">${esc(h)} – ${esc(z.name || z.text || '')}</span><span aria-hidden="true">€</span><input type="text" inputmode="decimal" class="num" data-feld="${k}" value="${z[k] != null ? fmt.betrag(z[k]) : ''}" autocomplete="off"></label>`
          : `<span class="num">${fmt.eur(z[k])}</span>`}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function zeichne() {
    const t = TABS.find((x) => x.art === tab);
    el.innerHTML = `
    <div class="page">
      ${darf ? '' : banner('info', 'Nur Ansicht – Preise ändern dürfen Büro und Geschäftsführung.', 'lock')}
      <div class="tabs" role="tablist" aria-label="Preisarten">${TABS.map((x) => `<button type="button" role="tab" id="tab-${x.art}" aria-selected="${x.art === tab}" aria-controls="tabpanel" class="${x.art === tab ? 'on' : ''}" data-tab="${x.art}">${x.text}<span class="count">${(daten[x.art] || []).length}</span></button>`).join('')}</div>
      <section class="card" id="tabpanel" role="tabpanel" aria-labelledby="tab-${t.art}">${tabelle(t)}</section>
      ${darf ? `<p class="fineprint">Änderungen werden sofort gespeichert, protokolliert und wirken auf alle Nachkalkulationen.</p>` : ''}
    </div>`;
  }
  el.addEventListener('click', (e) => { const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; speicher.setz('bt_preistab', tab); zeichne(); } });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('.price-in input')) e.target.blur(); });
  el.addEventListener('change', async (e) => {
    const inp = e.target.closest('.price-in input'); if (!inp) return;
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
    box.classList.add('busy');
    try {
      const neu = await put(`/preise/${tab}/${encodeURIComponent(zeile.id)}`, { feld, wert });
      Object.assign(zeile, neu && typeof neu === 'object' ? neu : { [feld]: wert });
      if (zeile[feld] == null) zeile[feld] = wert;
      inp.value = fmt.betrag(zeile[feld]);
      box.classList.remove('busy'); box.classList.add('saved'); setTimeout(() => box.classList.remove('saved'), 1600);
      toast('Preis gespeichert.');
      ctx.meldungenNeu();
    } catch (err) { box.classList.remove('busy'); toast(err.message, 'warn'); zurueck(); }
  });
  zeichne();
}
