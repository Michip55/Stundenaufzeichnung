// Stammdaten & Preise: Positionskatalog, Geräte, Material, Lohngruppen, Leistungen – an einer Stelle (API.md 12.2, 12.21).
// Anlegen, Bearbeiten, Deaktivieren/Löschen, Excel herunter-/hochladen mit Vorschau. Preise direkt in der Tabelle,
// jede Preisänderung fragt „gültig ab“. € nur mit Preis-Recht; Lohngruppen sind vertraulich (nur mit preise_bearbeiten pflegbar).
import { get, post, put, del } from '../api.js';
import { preisDialog, geplantChip } from '../preisstand.js';
import { ic, esc, fmt, parseZahl, starkOk, leer, banner, dialog, toast, speicher, $, $$ } from '../ui.js';
import { wienHeute } from '../zahl.js';
import { katalogTab } from './katalog.js';
import { dateiBase64 } from './dokumente.js';

const TABS = [
  { art: 'lohngruppen', text: 'Lohngruppen', ein: 'Lohngruppe', vertraulich: true, spalten: [['name', 'Lohngruppe'], ['kv', 'Kollektivvertrag']], preise: [['kostensatz', 'Kostensatz / Std.'], ['regiesatz', 'Regiesatz / Std.']],
    felder: [['id', 'Code (optional – sonst aus dem Namen)', { max: 20, code: true, nurNeu: true }], ['name', 'Bezeichnung', { max: 120, pflicht: true, breit: true }], ['kv', 'Kollektivvertrag / Einstufung', { max: 120, breit: true }]] },
  { art: 'geraete', text: 'Geräte', ein: 'Gerät', spalten: [['code', 'Code'], ['name', 'Gerät'], ['gruppe', 'Gruppe'], ['einheit', 'Einheit']], preise: [['kostensatz', 'Kostensatz / Std.'], ['verrechnungssatz', 'Verrechnungssatz / Std.']],
    felder: [['code', 'Code', { max: 20, pflicht: true, code: true }], ['name', 'Bezeichnung', { max: 120, pflicht: true, breit: true }], ['gruppe', 'Gruppe', { max: 60 }], ['einheit', 'Einheit', { max: 20, standard: 'Std.' }]] },
  { art: 'materialien', text: 'Material', ein: 'Material', spalten: [['code', 'Code'], ['name', 'Material'], ['einheit', 'Einheit']], preise: [['ek', 'Einkauf (EK)'], ['vk', 'Verkauf (VK)']],
    felder: [['code', 'Code', { max: 20, pflicht: true, code: true }], ['name', 'Bezeichnung', { max: 120, pflicht: true, breit: true }], ['einheit', 'Einheit', { max: 20, pflicht: true, standard: 't' }], ['dichte', 'Dichte in t/m³ (für Fuhren in m³)', { zahl: true }], ['naturmaterial', 'Naturmaterial (Landschaftsabgabe)', { ja: true }]] },
  { art: 'leistungen', text: 'Leistungen', ein: 'Leistung', spalten: [['code', 'Pos.'], ['text', 'Leistung'], ['einheit', 'Einheit']], preise: [['ep', 'Einheitspreis (EP)']],
    felder: [['code', 'Pos.-Code', { max: 20, pflicht: true, code: true }], ['text', 'Leistung', { max: 200, pflicht: true, breit: true }], ['einheit', 'Einheit', { max: 20, pflicht: true, standard: 'm²' }]] },
];
const VERW = { berichte: ['Bericht', 'Berichten'], positionen: ['Position', 'Positionen'], personen: ['Person', 'Personen'], fuhren: ['Fuhre', 'Fuhren'], meldungen: ['Leistungsmeldung', 'Leistungsmeldungen'] };

export default async function preise(el, ctx) {
  const siehtPreise = ctx.kann('preise_sehen');
  const darf = ctx.kann('preise_bearbeiten');
  const darfStamm = ctx.kann('stammdaten');
  const tabs = TABS.filter((t) => !t.vertraulich || siehtPreise);
  const darfPflegen = (t) => (t.vertraulich ? darf : darfStamm);
  const daten = siehtPreise ? await get('/preise') : {};
  const stamm = {}; // art → Liste aus /stammdaten (mit Version, aktiv, inaktiven); null = Server kennt 12.21 nicht
  let tab = ctx.query.get('tab') || speicher.lies('bt_preistab');
  if (tab !== 'katalog' && !tabs.some((t) => t.art === tab)) tab = tabs[0].art;
  if (tab === 'katalog' && !siehtPreise) tab = tabs[0].art;
  let suche = '', mitInaktiven = false;

  async function ladeStamm(art) {
    try { stamm[art] = await get(`/stammdaten/${art}?inaktiv=1`); }
    catch (e) { if (e.status === 401 || e.netz) throw e; stamm[art] = null; }
  }
  const alle = (t) => {
    const preisZ = daten[t.art] || [];
    return stamm[t.art] ? stamm[t.art].map((z) => { const p = preisZ.find((x) => String(x.id) === String(z.id)) || {}; return { ...p, ...z, geplant: (p.geplant && p.geplant.length ? p.geplant : z.geplant) || [] }; }) : preisZ.map((z) => ({ aktiv: true, ...z }));
  };
  const zeilen = (t) => { const q = suche.trim().toLowerCase(); return alle(t).filter((z) => (mitInaktiven || z.aktiv !== false) && (!q || t.spalten.some(([k]) => String(z[k] ?? '').toLowerCase().includes(q)))); };
  const titel = (z) => z.name || z.text || z.code || '';

  function tabelle(t) {
    const l = zeilen(t), pflege = darfPflegen(t) && !!stamm[t.art];
    if (!l.length) return leer(suche ? 'Kein Eintrag gefunden.' : 'Keine Einträge vorhanden.', 'tag');
    return `<div class="tbl-wrap"><table class="tbl price-tbl karten-handy" id="stamm-tabelle"><thead><tr>${t.spalten.map(([, h]) => `<th>${h}</th>`).join('')}${siehtPreise ? t.preise.map(([, h]) => `<th class="r">${h}</th>`).join('') : ''}${pflege ? '<th><span class="vh">Aktionen</span></th>' : ''}</tr></thead>
      <tbody>${l.map((z) => `<tr data-id="${esc(z.id)}" class="${z.aktiv === false ? 'aus' : ''}" data-aktiv="${z.aktiv !== false}">${t.spalten.map(([k, h], i) => `<td data-th="${esc(h)}" class="${k === 'name' || k === 'text' ? 'main' : 'muted nw'}">${esc(z[k] ?? '')}${i === 0 && z.aktiv === false ? ' <span class="chip xs st-grey" data-inaktiv>inaktiv</span>' : ''}${k === 'name' && z.naturmaterial ? ' <span class="chip xs st-outline">Natur</span>' : ''}</td>`).join('')}
        ${siehtPreise ? t.preise.map(([k, h]) => `<td class="r" data-th="${esc(h)}">${darf && z.aktiv !== false
          ? `<label class="price-in"><span class="vh">${esc(h)} – ${esc(titel(z))}</span><span aria-hidden="true">€</span><input type="text" inputmode="decimal" class="num" data-feld="${k}" value="${z[k] != null ? fmt.betrag(z[k]) : ''}" autocomplete="off"></label>`
          : `<span class="num">${fmt.eur(z[k])}</span>`}<button type="button" class="icon-btn sm pv-btn" data-verlauf="${k}" aria-label="Preisverlauf ${esc(h)} – ${esc(titel(z))}" title="Preisverlauf">${ic('clock')}</button>${geplantChip((z.geplant || []).filter((x) => x.feld === k))}</td>`).join('') : ''}
        ${pflege ? `<td class="nw st-akt">${z.aktiv === false ? `<button type="button" class="btn ghost sm" data-reaktiv="${esc(z.id)}">Wieder aktivieren</button>` : `<button type="button" class="icon-btn sm" data-edit="${esc(z.id)}" aria-label="${esc(titel(z))} bearbeiten" title="Bearbeiten">${ic('edit')}</button>`}<button type="button" class="icon-btn sm" data-weg="${esc(z.id)}" aria-label="${esc(titel(z))} löschen" title="Löschen">${ic('trash')}</button></td>` : ''}</tr>`).join('')}</tbody></table></div>`;
  }
  function zeichne() {
    const t = tabs.find((x) => x.art === tab);
    const anz = (x) => (stamm[x.art] ? stamm[x.art].filter((z) => z.aktiv !== false).length : (daten[x.art] || []).length);
    el.innerHTML = `
    <div class="page">
      ${siehtPreise && !darf ? banner('info', 'Nur Ansicht – Preise ändern dürfen Büro und Geschäftsführung.', 'lock') : ''}
      <div class="tabs" role="tablist" aria-label="Stammdaten und Preise">${tabs.map((x) => `<button type="button" role="tab" id="tab-${x.art}" aria-selected="${x.art === tab}" aria-controls="tabpanel" class="${x.art === tab ? 'on' : ''}" data-tab="${x.art}">${x.text}<span class="count">${anz(x)}</span></button>`).join('')}${siehtPreise ? `<button type="button" role="tab" id="tab-katalog" aria-selected="${tab === 'katalog'}" aria-controls="tabpanel" class="${tab === 'katalog' ? 'on' : ''}" data-tab="katalog">Positionskatalog</button>` : ''}</div>
      ${t ? `<div class="toolbar wrap" id="stamm-leiste"><label class="search weit"><span>${ic('tag')}</span><input type="search" id="stamm-suche" placeholder="${esc(t.text)} durchsuchen" aria-label="${esc(t.text)} durchsuchen" value="${esc(suche)}"></label>
        ${stamm[t.art] ? `<label class="check-inline sm"><input type="checkbox" id="stamm-inaktiv" ${mitInaktiven ? 'checked' : ''}> Inaktive anzeigen</label><a class="btn ghost" id="stamm-export" href="/api/stammdaten/${t.art}/export.xlsx" download>${ic('download')}Excel herunterladen</a>` : ''}
        ${darfPflegen(t) && stamm[t.art] ? `<button type="button" class="btn ghost" id="stamm-import">${ic('file')}Excel hochladen</button><input type="file" id="stamm-datei" class="vh" accept=".xlsx" tabindex="-1" aria-hidden="true"><button type="button" class="btn primary" id="stamm-neu">${ic('plus')}Neu</button>` : ''}</div>` : ''}
      <section class="card" id="tabpanel" role="tabpanel" aria-labelledby="tab-${tab}">${t ? tabelle(t) : ''}</section>
      ${t && darf ? `<p class="fineprint">Preis ändern: Betrag überschreiben – es wird „gültig ab“ gefragt (Standard heute). Deaktivierte Einträge verschwinden aus allen Auswahllisten, bleiben aber in alten Berichten sichtbar. Die Verrechnungspreise der Nachkalkulation stehen im Positionskatalog bzw. je Bauvorhaben.</p>` : ''}
      <nav class="chip-row" aria-label="Weitere Stammdaten" id="stamm-links"><span class="muted sm">Weitere Stammdaten:</span>${ctx.kann('benutzer') || ctx.ich.benutzer.rolle === 'buero' ? '<a class="chip-btn" href="#/benutzer">Mitarbeiter</a>' : ''}<a class="chip-btn" href="#/baustellen">Baustellen</a><a class="chip-btn" href="#/fuhrpark">Fuhrpark &amp; Geräte</a></nav>
    </div>`;
    if (tab === 'katalog') { const box = document.createElement('div'); $('#tabpanel', el).appendChild(box); katalogTab(box, ctx); }
  }
  async function neuLaden() {
    try { if (siehtPreise) Object.assign(daten, await get('/preise')); if (tab !== 'katalog') await ladeStamm(tab); } catch (x) { toast(x.message, 'warn'); }
    if (ctx.aktuell()) zeichne();
  }
  const finde = (id) => { const t = tabs.find((x) => x.art === tab); return t ? alle(t).find((z) => String(z.id) === String(id)) : null; };

  /* ---------- Anlegen / Bearbeiten ---------- */
  function eintragDialog(t, z) {
    const feld = ([k, text, o]) => {
      if (o.nurNeu && z) return '';
      if (o.ja) return `<label class="check-inline full"><input type="checkbox" name="${k}" ${z && z[k] ? 'checked' : ''}> ${esc(text)}</label>`;
      return `<label class="field${o.breit ? ' full' : ''}"><span class="field-label">${esc(text)}</span><input class="input lg${o.zahl ? ' num' : ''}" name="${k}" ${o.max ? `maxlength="${o.max}"` : ''} ${o.zahl ? 'inputmode="decimal"' : ''} value="${esc(z ? (o.zahl && z[k] != null ? String(z[k]).replace('.', ',') : z[k] ?? '') : o.standard || '')}" ${o.pflicht ? 'required' : ''} autocomplete="off"><small class="price-err" data-fehler="${k}" role="alert" hidden></small></label>`;
    };
    const dlg = dialog({ titel: z ? `${t.ein} bearbeiten` : `${t.ein} anlegen`, breit: true, inhalt: `<form id="stf" class="form-grid" novalidate>${t.felder.map(feld).join('')}
      ${!z && darf ? `<fieldset class="field full"><legend class="field-label">Preise (optional – gelten ab heute)</legend><div class="form-grid">${t.preise.map(([k, h]) => `<label class="field"><span class="field-label">${esc(h)} in Euro</span><input class="input lg num" name="p_${k}" inputmode="decimal" autocomplete="off" placeholder="0,00"></label>`).join('')}</div></fieldset>` : ''}
      <p class="form-err full" role="alert" hidden></p></form>`, fuss: `<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="stf" id="st-ok">${z ? 'Speichern' : 'Anlegen'}</button>` });
    $('#stf', dlg.el).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target); const err = $('.form-err', dlg.el);
      $$('[data-fehler]', dlg.el).forEach((x) => { x.hidden = true; }); err.hidden = true;
      const zeig = (text, k) => { const fe = k && $(`[data-fehler="${k}"]`, dlg.el); if (fe) { fe.hidden = false; fe.textContent = text; e.target.elements[k].focus(); } else { err.hidden = false; err.textContent = text; } };
      const body = {};
      for (const [k, text, o] of t.felder) {
        if (o.nurNeu && z) continue;
        if (o.ja) { body[k] = f.get(k) === 'on'; continue; }
        const v = String(f.get(k) || '').trim();
        if (o.pflicht && !v) return zeig(`${text} fehlt.`, k);
        if (o.code && v && !/^[a-z0-9_-]{1,20}$/i.test(v)) return zeig('Nur Buchstaben, Ziffern, Bindestrich und Unterstrich (höchstens 20 Zeichen).', k);
        if (o.zahl) { if (v === '') { body[k] = null; continue; } const n = parseZahl(v); if (!(n >= 0.1 && n <= 5)) return zeig('Bitte eine Zahl zwischen 0,1 und 5 eintragen.', k); body[k] = n; continue; }
        if (o.nurNeu && !v) continue;
        body[k] = o.code ? v.toLowerCase() : v;
      }
      if (!z && darf) for (const [k, h] of t.preise) { const roh = String(f.get('p_' + k) || '').trim(); if (!roh) continue; const n = parseZahl(roh); if (!(n >= 0)) return zeig(`${h}: „${roh}“ ist unklar – bitte so schreiben: 1.250,00`); body[k] = n; }
      $('#st-ok', dlg.el).disabled = true;
      try {
        if (z) await put(`/stammdaten/${t.art}/${encodeURIComponent(z.id)}`, { ...body, version: z.version }); else await post(`/stammdaten/${t.art}`, body);
        dlg.zu(); toast(z ? 'Gespeichert.' : `${t.ein} angelegt.`); neuLaden();
      } catch (x) {
        $('#st-ok', dlg.el).disabled = false;
        const codeFeld = t.felder.some(([k]) => k === 'code') ? 'code' : z ? null : 'id';
        if (x.status === 422) return zeig('Code wird verwendet – nicht änderbar.', codeFeld);
        if (x.status === 409 && !(x.daten && x.daten.version != null)) return zeig('Diesen Code gibt es schon.', codeFeld);
        zeig(x.status === 409 ? 'Inzwischen von jemand anderem geändert – bitte schließen und neu laden.' : x.message);
      }
    });
  }
  async function aktivSetzen(t, z, aktiv) {
    try { await put(`/stammdaten/${t.art}/${encodeURIComponent(z.id)}`, { version: z.version, aktiv }); toast(aktiv ? `„${titel(z)}“ ist wieder aktiv.` : `„${titel(z)}“ deaktiviert – erscheint in keiner Auswahl mehr.`); if (!aktiv) mitInaktiven = true; } catch (x) { toast(x.message, 'warn'); }
    neuLaden();
  }
  function loeschen(t, z) {
    const dlg = dialog({ titel: `${t.ein} löschen?`, inhalt: `<div class="stack-s" id="st-weg-dialog"><p>„${esc(titel(z))}“ wird endgültig gelöscht – das geht nur, wenn der Eintrag nie verwendet wurde.</p><div id="st-verwendet"></div></div>`, fuss: `<button class="btn ghost" type="button" data-zu>Abbrechen</button>${z.aktiv !== false ? '<button class="btn ghost" type="button" id="st-deaktiv">Nur deaktivieren</button>' : ''}<button class="btn danger" type="button" id="st-weg-ok">Löschen</button>` });
    const deaktiv = () => { dlg.zu(); aktivSetzen(t, z, false); };
    if ($('#st-deaktiv', dlg.el)) $('#st-deaktiv', dlg.el).addEventListener('click', deaktiv);
    $('#st-weg-ok', dlg.el).addEventListener('click', async (e) => {
      e.target.disabled = true;
      try { await del(`/stammdaten/${t.art}/${encodeURIComponent(z.id)}`); dlg.zu(); toast(`${t.ein} gelöscht.`); neuLaden(); }
      catch (x) {
        if (x.status !== 409 || !x.daten || !x.daten.verwendet) { e.target.disabled = false; toast(x.message, 'warn'); return; }
        const v = x.daten.verwendet;
        const teile = Object.entries(VERW).filter(([k]) => v[k] > 0).map(([k, [ein, mehr]]) => `${v[k]} ${v[k] === 1 ? ein : mehr}`);
        $('#st-verwendet', dlg.el).innerHTML = banner('warn', `<b>Wird in ${esc(teile.join(', ') || 'bestehenden Daten')} verwendet</b> – stattdessen deaktivieren? Der Eintrag verschwindet dann aus allen Auswahllisten, alte Berichte bleiben unverändert.`);
        e.target.remove();
        const d = $('#st-deaktiv', dlg.el);
        if (d) { d.className = 'btn primary'; d.textContent = 'Deaktivieren'; } else $('#st-verwendet', dlg.el).insertAdjacentHTML('beforeend', '<p class="muted sm">Der Eintrag ist bereits inaktiv.</p>');
      }
    });
  }
  /* ---------- Excel hochladen: erst Vorschau, dann übernehmen ---------- */
  async function importieren(t, datei) {
    if (!/\.xlsx$/i.test(datei.name) || datei.size > 5 * 1048576) { toast('Bitte eine Excel-Datei (.xlsx) bis 5 MB wählen – am besten die heruntergeladene Liste bearbeiten.', 'warn'); return; }
    let b64, v;
    try { b64 = await dateiBase64(datei); v = await post(`/stammdaten/${t.art}/import`, { dateiBase64: b64, vorschau: true }); } catch (x) { toast(x.message, 'warn'); return; }
    const feldName = (k) => ((t.felder.find(([f]) => f === k) || t.preise.find(([f]) => f === k) || [])[1] || k);
    const wert = (k, w) => (w == null || w === '' ? '–' : t.preise.some(([f]) => f === k) ? fmt.eur(w) : esc(String(w)));
    const mitPreis = [...(v.geaendert || []).flatMap((g) => Object.keys(g.felder || {})), ...(v.neu || []).flatMap((n) => (typeof n === 'object' && n ? Object.keys(n) : []))].some((k) => t.preise.some(([f]) => f === k));
    const fehler = v.fehler || [], etwas = !fehler.length && ((v.neu || []).length + (v.geaendert || []).length) > 0;
    const heute = wienHeute();
    const dlg = dialog({ titel: `Excel hochladen · ${t.text}`, breit: true, inhalt: `<div class="stack-s" id="st-import">
      <div class="chip-row"><span class="chip st-green" data-imp-neu="${(v.neu || []).length}">${(v.neu || []).length} neu</span><span class="chip st-amber" data-imp-geaendert="${(v.geaendert || []).length}">${(v.geaendert || []).length} geändert</span><span class="chip st-grey">${v.unveraendert ?? 0} unverändert</span>${(v.fehlend || []).length ? `<span class="chip st-outline" data-imp-fehlend="${v.fehlend.length}">${v.fehlend.length} nicht in der Datei</span>` : ''}${fehler.length ? `<span class="chip st-red">${fehler.length} Fehler</span>` : ''}</div>
      ${fehler.length ? `${banner('err', 'Die Datei enthält Fehler – es wird nichts übernommen. Bitte korrigieren und erneut hochladen.')}<ul class="warn-list">${fehler.slice(0, 30).map((x) => `<li>${ic('alert')}<span>Zeile ${x.zeile}: ${esc(x.text)}</span></li>`).join('')}</ul>` : ''}
      ${(v.neu || []).length ? `<h4 class="sub-h">Neu</h4><p class="sm">${v.neu.map((n) => esc(typeof n === 'string' ? n : n.name || n.text || n.code || n.id)).join(', ')}</p>` : ''}
      ${(v.geaendert || []).length ? `<h4 class="sub-h">Geändert</h4><div class="tbl-wrap imp-hoch"><table class="tbl" id="st-imp-geaendert"><thead><tr><th>Code</th><th>Feld</th><th>bisher</th><th>neu</th></tr></thead><tbody>${v.geaendert.map((g) => Object.entries(g.felder || {}).map(([k, w]) => `<tr><td>${esc(g.code)}</td><td>${esc(feldName(k))}</td><td>${wert(k, w.alt)}</td><td><b>${wert(k, w.neu)}</b></td></tr>`).join('')).join('')}</tbody></table></div>` : ''}
      ${(v.fehlend || []).length ? `<p class="muted sm" id="st-imp-fehlend">Nicht in der Datei: ${v.fehlend.map(esc).join(', ')}. Diese Einträge bleiben unverändert bestehen – beim Hochladen wird nie etwas gelöscht.</p>` : ''}
      ${etwas && mitPreis ? `<div class="form-grid"><label class="field"><span class="field-label">Neue Preise gültig ab</span><input class="input lg" type="date" id="st-imp-ab" value="${heute}"></label><p class="muted sm" id="st-imp-rueck" hidden>Rückwirkend: Bereits erfasste Berichte ab diesem Tag werden mit den neuen Preisen neu bewertet.</p></div>` : ''}</div>`,
      fuss: `<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="button" id="st-imp-ok" ${etwas ? '' : 'disabled'}>Übernehmen</button>` });
    const ab = $('#st-imp-ab', dlg.el);
    if (ab) ab.addEventListener('change', () => { $('#st-imp-rueck', dlg.el).hidden = !(ab.value && ab.value < heute); });
    $('#st-imp-ok', dlg.el).addEventListener('click', async (e) => {
      e.target.disabled = true;
      const rueck = ab && ab.value && ab.value < heute;
      try { const r = await post(`/stammdaten/${t.art}/import`, { dateiBase64: b64, vorschau: false, ...(ab && ab.value ? { gueltigAb: ab.value } : {}), ...(rueck ? { rueckwirkend: true } : {}) }); dlg.zu(); toast(`Übernommen: ${typeof r.uebernommen === 'number' ? r.uebernommen : (r.neu || []).length + (r.geaendert || []).length} Einträge.`); neuLaden(); ctx.meldungenNeu(); }
      catch (x) { e.target.disabled = false; toast(x.message, 'warn'); }
    });
  }

  el.addEventListener('click', async (e) => {
    const tb = e.target.closest('[data-tab]');
    if (tb && !tb.closest('[data-katalog]')) { tab = tb.dataset.tab; suche = ''; speicher.setz('bt_preistab', tab); if (tab !== 'katalog' && stamm[tab] === undefined) await ladeStamm(tab); return zeichne(); }
    const t = tabs.find((x) => x.art === tab); if (!t || e.target.closest('[data-katalog]')) return;
    if (e.target.closest('#stamm-neu')) return eintragDialog(t, null);
    if (e.target.closest('#stamm-import')) return $('#stamm-datei', el).click();
    const ed = e.target.closest('[data-edit]'); if (ed) { const z = finde(ed.dataset.edit); if (z) eintragDialog(t, z); return; }
    const weg = e.target.closest('[data-weg]'); if (weg) { const z = finde(weg.dataset.weg); if (z) loeschen(t, z); return; }
    const re = e.target.closest('[data-reaktiv]'); if (re) { const z = finde(re.dataset.reaktiv); if (z) aktivSetzen(t, z, true); return; }
    const v = e.target.closest('[data-verlauf]');
    if (v) {
      const zeile = finde(v.closest('tr').dataset.id);
      const feldText = (f) => ((t.preise.find(([k]) => k === f) || [])[1] || f);
      const ok = await preisDialog({ was: `${titel(zeile)} – ${feldText(v.dataset.verlauf)}`, darf, feld: v.dataset.verlauf, feldText,
        verlauf: () => get(`/preise/${tab}/${encodeURIComponent(zeile.id)}/verlauf`), loeschen: (vid) => del(`/preise/${tab}/${encodeURIComponent(zeile.id)}/verlauf/${vid}`) });
      if (ok) neuLaden();
    }
  });
  el.addEventListener('input', (e) => { if (e.target.id === 'stamm-suche') { suche = e.target.value; const pos = e.target.selectionStart; zeichne(); const s = $('#stamm-suche', el); s.focus(); s.setSelectionRange(pos, pos); } });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('.price-in input')) { e.preventDefault(); e.target.blur(); } });
  el.addEventListener('change', async (e) => {
    if (e.target.id === 'stamm-inaktiv') { mitInaktiven = e.target.checked; return zeichne(); }
    if (e.target.id === 'stamm-datei') { const d = e.target.files[0]; e.target.value = ''; const t = tabs.find((x) => x.art === tab); if (d && t) importieren(t, d); return; }
    const inp = e.target.closest('.price-in input'); if (!inp || inp.closest('[data-katalog]')) return;
    const tr = inp.closest('tr'), feld = inp.dataset.feld;
    const zeile = finde(tr.dataset.id);
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
    if (!(await starkOk(zeile[feld], wert, `Der Preis „${titel(zeile)}“`))) { zurueck(); return; }
    // 12.2: jeder neue Preis ist ein Stand mit „gültig ab“ – der Dialog fragt das Datum ab (Standard heute)
    const t = tabs.find((x) => x.art === tab);
    const feldText = (f) => ((t.preise.find(([k]) => k === f) || [])[1] || f);
    const ok = await preisDialog({
      was: `${titel(zeile)} – ${feldText(feld)}`, alt: zeile[feld], neu: wert, darf: true, feld, feldText,
      senden: (x) => put(`/preise/${tab}/${encodeURIComponent(zeile.id)}`, { feld, wert, ...x }),
      verlauf: () => get(`/preise/${tab}/${encodeURIComponent(zeile.id)}/verlauf`),
      loeschen: (vid) => del(`/preise/${tab}/${encodeURIComponent(zeile.id)}/verlauf/${vid}`),
    });
    if (!ok) { zurueck(); return; }
    await neuLaden(); ctx.meldungenNeu();
  });
  if (tab !== 'katalog') await ladeStamm(tab);
  zeichne();
}
