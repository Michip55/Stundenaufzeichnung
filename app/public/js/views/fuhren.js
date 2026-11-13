// Fuhraufträge (LKW-Fuhrplan, API.md 12.8b): Bahn „Fuhren“ im Baustellenplaner, Formular, „Meine Fuhren“ für den Fahrer
// (mit Warteschlange ohne Netz wie bei der Stempeluhr) und eingehende Fuhren für den Polier. Keine Preise.
import { get, post, put, del } from '../api.js';
import { ic, esc, fmt, parseZahl, banner, dialog, bestaetigen, toast, speicher, $ } from '../ui.js';
import { bildVerkleinern } from '../schaden-offline.js';

export const F_STATUS = { geplant: ['geplant', 'st-blue'], unterwegs: ['unterwegs', 'st-amber'], erledigt: ['abgeladen', 'st-green'], storniert: ['storniert', 'st-grey'] };
const EH = { t: 't', m3: 'm³', fuhren: 'Fuhren' };
export const fStatus = (f) => { const [t, c] = F_STATUS[f.status] || [f.status, 'st-grey']; return `<span class="chip xs ${c}" data-fuhr-status="${esc(f.status)}">${esc(t)}</span>`; };
const matName = (f) => (f.material && typeof f.material === 'object' ? f.material.name : f.material) || f.materialText || 'Material';
const mengeText = (f) => `${fmt.zahl(f.menge, 2)} ${EH[f.einheit] || f.einheit || ''}`;
const ort = (o) => (o && (o.text || (o.art === 'grube' ? 'Grube' : ''))) || '–';
export const fuhrText = (f) => [f.beginn, f.anzahlFuhren ? `${f.anzahlFuhren} Fuhre${f.anzahlFuhren === 1 ? '' : 'n'}` : '', matName(f), mengeText(f), `${ort(f.von)} → ${ort(f.nach)}`].filter(Boolean).join(' · ');
export const fuhrenLaden = (von, bis) => get(`/plan/fuhren?von=${von}&bis=${bis}`);
const istFahrzeug = (a) => !!a.kennzeichen || /lkw|fahrzeug/i.test(`${a.klasse || ''}`);

export function fuhrKarte(f, schreib) {
  const pruefen = f.berichtZeile && f.berichtZeile.status === 'pruefen';
  const k = (f.konflikte || []).filter((x) => x.typ !== 'wetter');
  return `<button type="button" class="fu-karte${k.length ? ' konflikt' : ''}${f.status === 'storniert' ? ' weg' : ''}" data-fuhre="${f.id}" ${schreib ? '' : 'data-nur-lesen'} aria-label="Fuhre: ${esc(fuhrText(f))}">
    <b>${esc([f.beginn, f.anzahlFuhren ? `${f.anzahlFuhren} Fuhre${f.anzahlFuhren === 1 ? '' : 'n'}` : ''].filter(Boolean).join(' · ') || 'Fuhre')}</b><span>${esc(matName(f))} · ${esc(mengeText(f))}</span><span>${esc(ort(f.von))} → ${esc(ort(f.nach))}</span>
    <span class="fu-fuss">${fStatus(f)}${f.fahrer ? `<small>${ic('user', 'xs')}${esc(f.fahrer.name)}</small>` : '<small class="warn">kein Fahrer</small>'}${k.length ? `<small class="warn" title="${esc(k.map((x) => x.text).join(' · '))}">${ic('alert', 'xs')}${esc(k[0].text)}</small>` : ''}${pruefen ? `<small class="warn" data-bericht-pruefen title="${esc(f.berichtZeile.hinweis || '')}">${ic('alert', 'xs')}Bericht: bitte prüfen</small>` : ''}${f.veroeffentlicht && !f.geaendertNachVeroeffentlichung ? '' : '<i class="wp-stand" title="noch nicht veröffentlicht"></i>'}</span></button>`;
}
// Bahn im Wochenplan: eine Zeile je LKW, Spalten = Tage
export function fuhrenBahn(fuhren, tage, schreib, tagWahl) {
  const lkw = new Map();
  fuhren.forEach((f) => { if (!lkw.has(f.anlageId)) lkw.set(f.anlageId, f.anlage || { id: f.anlageId, bezeichnung: 'LKW' }); });
  const zeilen = [...lkw.entries()].sort((a, b) => String(a[1].bezeichnung).localeCompare(String(b[1].bezeichnung), 'de'));
  return `<div class="wp-zeile kopf fu-kopf" role="row"><div class="wp-bs" role="columnheader">Fuhren · je LKW</div>${tage.map((t) => `<div class="fu-kopf-zelle wp-zelle${t.datum === tagWahl ? ' wahl' : ''}">${schreib ? `<button type="button" class="wp-mini" data-fuhre-neu data-datum="${t.datum}" aria-label="Fuhre anlegen am ${esc(fmt.datumKurz(t.datum))}">${ic('plus', 'xs')}Fuhre</button>` : ''}</div>`).join('')}</div>
    ${zeilen.map(([aid, a]) => `<div class="wp-zeile fu-zeile" role="row" data-fuhr-lkw="${aid}"><div class="wp-bs" role="rowheader"><small>${esc(a.kennzeichen || a.nummer || 'LKW')}</small><b>${esc(a.bezeichnung || 'LKW')}</b>${a.gesperrt ? '<small class="warn">gesperrt</small>' : ''}</div>
      ${tage.map((t) => `<div class="wp-zelle fu-zelle${t.datum === tagWahl ? ' wahl' : ''}" role="cell" data-fuhr-ablage data-datum="${t.datum}" data-anlage="${aid}">${fuhren.filter((f) => f.anlageId === aid && f.datum === t.datum).sort((x, y) => (x.reihenfolge || 0) - (y.reihenfolge || 0)).map((f) => fuhrKarte(f, schreib)).join('')}</div>`).join('')}</div>`).join('') || `<div class="wp-zeile fu-zeile" role="row"><div class="wp-bs"><small class="muted">noch keine Fuhre</small></div>${tage.map((t) => `<div class="wp-zelle fu-zelle${t.datum === tagWahl ? ' wahl' : ''}" data-fuhr-ablage data-datum="${t.datum}"></div>`).join('')}</div>`}`;
}
// Tagesansicht: Fuhren zu einer Baustelle (Ziel) – zugleich Ablagefläche für einen LKW
export const fuhrenZone = (fuhren, tag, bsId, schreib) => `<div class="fu-zone" data-fuhr-ablage data-datum="${tag}" data-nach="${bsId}"><h4 class="sub-h">Fuhren <span class="count">${fuhren.length}</span>${schreib ? `<button type="button" class="btn ghost sm" data-fuhre-neu data-datum="${tag}" data-nach="${bsId}">${ic('plus', 'xs')}Fuhre</button>` : ''}</h4>${fuhren.map((f) => `<div class="fu-mit-lkw"><small>${esc((f.anlage && f.anlage.bezeichnung) || 'LKW')}</small>${fuhrKarte(f, schreib)}</div>`).join('') || `<p class="muted sm">${schreib ? 'LKW hierher ziehen oder „+ Fuhre“.' : 'Keine Fuhre.'}</p>`}</div>`;

/* ---------- Formular ---------- */
let stamm = null;
async function ladeStamm() {
  if (stamm) return stamm;
  const [anl, leute, mat, bs, ein] = await Promise.all([get('/fuhrpark/anlagen').catch(() => []), get('/mitarbeiter').catch(() => []), get('/materialien').catch(() => []), get('/baustellen').catch(() => []), get('/einstellungen/plan').catch(() => ({}))]);
  stamm = { anlagen: (Array.isArray(anl) ? anl : anl.anlagen || []).filter((a) => a.status !== 'ausgeschieden' && istFahrzeug(a)), leute: leute.filter((m) => m.aktiv !== false && ['mitarbeiter', 'polier', 'bauleiter'].includes(m.rolle)), mat, bs: bs.filter((b) => !b.intern), grube: (ein && ein.grube) || { text: 'Grube Breitenau' } };
  return stamm;
}
export function stammVergessen() { stamm = null; }
const naechsteTage = (iso, n) => { const l = []; let t = iso; while (l.length < n) { t = fmt.addTage(t, 1); if (![0, 6].includes(fmt.dt(t).getDay())) l.push(t); } return l; };

export async function fuhreDialog(ctx, vor, fertig) {
  let s; try { s = await ladeStamm(); } catch (x) { toast(x.message, 'warn'); return; }
  const f = vor.fuhre || null;
  const datum = f ? f.datum : vor.datum;
  const nachBs = f ? (f.nach && f.nach.baustelleId) : vor.nachBaustelleId;
  const vonArt = f ? (f.von && f.von.art) || 'grube' : 'grube';
  const nachArt = f ? (f.nach && f.nach.art) || 'baustelle' : 'baustelle';
  const bsWahl = (name, wert) => `<select class="input lg" name="${name}">${s.bs.map((b) => `<option value="${b.id}" ${Number(b.id) === Number(wert) ? 'selected' : ''}>${esc((b.kst ? b.kst + ' · ' : '') + (b.kurz || b.name))}</option>`).join('')}</select>`;
  const fertigStatus = f && ['erledigt', 'storniert'].includes(f.status);
  const dlg = dialog({ titel: f ? 'Fuhre bearbeiten' : 'Fuhre anlegen', breit: true, inhalt: `<form id="fuf" class="form-grid" novalidate>
    ${f ? `<div class="full btn-row">${fStatus(f)}${f.erledigt ? `<span class="sm">Abgeladen: <b>${esc(fmt.zahl(f.erledigt.menge, 2))} ${esc(EH[f.erledigt.einheit] || '')}</b> um ${esc(fmt.uhr(f.erledigt.zeit))}${f.erledigt.bemerkung ? ' · ' + esc(f.erledigt.bemerkung) : ''}</span>` : ''}${f.erledigt && f.erledigt.lieferscheinFotoId ? `<a class="btn ghost sm" href="/api/plan/fuhren/${f.id}/foto/${f.erledigt.lieferscheinFotoId}" target="_blank" rel="noopener">${ic('camera', 'xs')}Lieferschein</a>` : ''}</div>` : ''}
    ${f && f.berichtZeile && f.berichtZeile.status === 'pruefen' ? `<div class="full" id="fu-pruefen">${banner('warn', `Nicht automatisch im Bautagesbericht: ${esc(f.berichtZeile.hinweis || 'bitte prüfen und im Bericht händisch eintragen.')}`)}${f.materialId && f.einheit === 'm3' ? `<div class="btn-row"><label class="field"><span class="field-label">Dichte des Materials (t/m³)</span><input class="input num" id="fu-dichte" inputmode="decimal" placeholder="z. B. 1,8"></label><button type="button" class="btn ghost" id="fu-dichte-ok">Dichte speichern</button></div>` : ''}</div>` : ''}
    <label class="field"><span class="field-label">Tag</span><input class="input lg" type="date" name="datum" required value="${esc(datum)}"></label>
    <label class="field"><span class="field-label">Beginn</span><input class="input lg" type="time" name="beginn" value="${esc((f && f.beginn) || '')}"></label>
    <label class="field"><span class="field-label">LKW</span><select class="input lg" name="anlageId" required><option value="">– wählen –</option>${s.anlagen.map((a) => `<option value="${a.id}" ${Number(a.id) === Number(f ? f.anlageId : vor.anlageId) ? 'selected' : ''}>${esc(a.bezeichnung || a.nummer)}${a.kennzeichen ? ' · ' + esc(a.kennzeichen) : ''}</option>`).join('')}</select></label>
    <label class="field"><span class="field-label">Fahrer</span><select class="input lg" name="fahrerId"><option value="">– noch offen –</option>${s.leute.map((m) => `<option value="${m.id}" ${f && f.fahrer && Number(f.fahrer.benutzerId) === Number(m.id) ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
    <label class="field full"><span class="field-label">Material (aus dem Katalog suchen oder frei eintragen)</span><input class="input lg" name="material" list="fu-mat" required maxlength="120" autocomplete="off" value="${esc(f ? matName(f) : '')}" placeholder="z. B. Rollschotter RK 16/63"><datalist id="fu-mat">${s.mat.map((m) => `<option value="${esc(m.name)}">${esc(m.code || '')}</option>`).join('')}</datalist><small class="muted" id="fu-mat-hinweis"></small></label>
    <label class="field"><span class="field-label">Menge</span><input class="input lg num" name="menge" inputmode="decimal" required value="${f ? esc(fmt.zahl(f.menge, 3)) : ''}" placeholder="z. B. 45"></label>
    <label class="field"><span class="field-label">Einheit</span><select class="input lg" name="einheit">${Object.entries(EH).map(([k, t]) => `<option value="${k}" ${(f ? f.einheit : 't') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label class="field"><span class="field-label">Anzahl Fuhren</span><input class="input lg num" name="anzahlFuhren" inputmode="numeric" value="${f && f.anzahlFuhren != null ? f.anzahlFuhren : ''}" placeholder="z. B. 3"></label>
    <span></span>
    <fieldset class="field full"><legend class="field-label">Von (Ladestelle)</legend><div class="form-grid"><label class="field"><span class="vh">Art der Ladestelle</span><select class="input lg" name="vonArt"><option value="grube" ${vonArt === 'grube' ? 'selected' : ''}>${esc(s.grube.text || 'Grube')}</option><option value="baustelle" ${vonArt === 'baustelle' ? 'selected' : ''}>Baustelle</option><option value="adresse" ${vonArt === 'adresse' ? 'selected' : ''}>Andere Adresse</option></select></label>
      <div class="field" data-von="baustelle"><span class="vh">Baustelle</span>${bsWahl('vonBs', f && f.von && f.von.baustelleId)}</div><label class="field" data-von="adresse"><span class="vh">Adresse</span><input class="input lg" name="vonText" maxlength="200" placeholder="Adresse oder Name" value="${esc(vonArt === 'adresse' ? (f.von.text || '') : '')}"></label>
      <label class="field full" data-von="adresse"><span class="field-label">Google-Maps-Link oder Koordinaten (optional)</span><input class="input lg" name="vonLink" maxlength="500" placeholder="Link einfügen oder 47.62, 16.05"></label></div></fieldset>
    <fieldset class="field full"><legend class="field-label">Nach (Abladen)</legend><div class="form-grid"><label class="field"><span class="vh">Art des Ziels</span><select class="input lg" name="nachArt"><option value="baustelle" ${nachArt === 'baustelle' ? 'selected' : ''}>Baustelle</option><option value="adresse" ${nachArt === 'adresse' ? 'selected' : ''}>Andere Adresse</option></select></label>
      <div class="field" data-nach="baustelle"><span class="vh">Baustelle</span>${bsWahl('nachBs', nachBs)}</div><label class="field" data-nach="adresse"><span class="vh">Adresse</span><input class="input lg" name="nachText" maxlength="200" placeholder="Adresse oder Name" value="${esc(nachArt === 'adresse' ? (f.nach.text || '') : '')}"></label>
      <label class="field"><span class="field-label">Abladestelle</span><input class="input lg" name="abladestelle" maxlength="200" value="${esc((f && f.nach && f.nach.abladestelle) || '')}" placeholder="z. B. Zufahrt hinten, beim Container"></label>
      <label class="field"><span class="field-label">Google-Maps-Link oder Koordinaten (optional)</span><input class="input lg" name="nachLink" maxlength="500" placeholder="Link einfügen oder 47.62, 16.05"></label></div>
      ${f && f.mapsLink ? `<small><a href="${esc(f.mapsLink)}" target="_blank" rel="noopener noreferrer" id="fu-maps">Route in Google Maps ansehen</a></small>` : '<small class="muted">Der Link wird nur gelesen (Koordinaten), nie aufgerufen.</small>'}</fieldset>
    <label class="field full"><span class="field-label">Notiz für den Fahrer</span><input class="input lg" name="notiz" maxlength="300" value="${esc((f && f.notiz) || '')}"></label>
    ${f ? '' : `<fieldset class="field full"><legend class="field-label">Für weitere Tage kopieren</legend><div class="chk-row" id="fu-kopie">${naechsteTage(datum, 5).map((t) => `<label class="check-inline"><input type="checkbox" name="kopie" value="${t}"> ${esc(fmt.datumKurz(t))}</label>`).join('')}</div></fieldset>`}
    <p class="form-err full" role="alert" hidden></p></form>`,
    fuss: `${f ? `<button class="btn danger" type="button" id="fu-weg">${f.veroeffentlicht ? 'Stornieren' : 'Löschen'}</button><span class="grow"></span>` : ''}<button class="btn ghost" type="button" data-zu>Abbrechen</button>${fertigStatus ? '' : `<button class="btn primary" type="submit" form="fuf" id="fu-ok">${f ? 'Speichern' : 'Fuhre anlegen'}</button>`}` });
  const form = $('#fuf', dlg.el);
  const mat = () => s.mat.find((m) => m.name.toLowerCase() === String(form.elements.material.value).trim().toLowerCase());
  function zeig() {
    dlg.el.querySelectorAll('[data-von]').forEach((x) => { x.hidden = x.dataset.von !== form.elements.vonArt.value; });
    dlg.el.querySelectorAll('[data-nach]').forEach((x) => { x.hidden = x.dataset.nach !== form.elements.nachArt.value; });
    const m = mat(), t = String(form.elements.material.value).trim(), eh = form.elements.einheit.value;
    $('#fu-mat-hinweis', dlg.el).textContent = !t ? '' : !m ? 'Freier Text – die Menge kommt nicht automatisch in den Bautagesbericht (Büro prüft).' : eh === 'fuhren' ? 'Einheit „Fuhren“: Menge kommt nicht automatisch in den Bericht.' : eh === 'm3' && !m.dichte ? 'Für m³ fehlt die Dichte dieses Materials – der Bericht muss dann geprüft werden.' : 'Aus dem Katalog – wird nach dem Abladen in den Bautagesbericht übernommen.';
  }
  form.addEventListener('input', zeig); form.addEventListener('change', zeig); zeig();
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); const fd = new FormData(form); const err = $('.form-err', dlg.el);
    const zeigF = (t) => { err.hidden = false; err.textContent = t; };
    const menge = parseZahl(fd.get('menge')), anz = String(fd.get('anzahlFuhren') || '').trim();
    if (!fd.get('datum') || !fd.get('anlageId')) return zeigF('Bitte Tag und LKW wählen.');
    if (!String(fd.get('material')).trim()) return zeigF('Bitte das Material eintragen.');
    if (!(menge > 0)) return zeigF('Menge unklar – bitte eine Zahl größer 0 eintragen, z. B. 45 oder 12,5.');
    if (anz && !(Number.isInteger(Number(anz)) && Number(anz) > 0)) return zeigF('Anzahl Fuhren als ganze Zahl eintragen.');
    const m = mat();
    const von = fd.get('vonArt') === 'grube' ? { art: 'grube' } : fd.get('vonArt') === 'baustelle' ? { art: 'baustelle', baustelleId: Number(fd.get('vonBs')) } : { art: 'adresse', text: String(fd.get('vonText') || '').trim(), ...(String(fd.get('vonLink') || '').trim() ? { link: String(fd.get('vonLink')).trim() } : {}) };
    const nach = fd.get('nachArt') === 'baustelle' ? { art: 'baustelle', baustelleId: Number(fd.get('nachBs')) } : { art: 'adresse', text: String(fd.get('nachText') || '').trim() };
    if ((von.art === 'adresse' && !von.text && !von.link) || (nach.art === 'adresse' && !nach.text && !String(fd.get('nachLink') || '').trim())) return zeigF('Bitte eine Adresse eintragen oder einen Google-Maps-Link bzw. Koordinaten einfügen.');
    if (String(fd.get('abladestelle') || '').trim()) nach.abladestelle = String(fd.get('abladestelle')).trim();
    if (String(fd.get('nachLink') || '').trim()) nach.link = String(fd.get('nachLink')).trim();
    const body = { datum: fd.get('datum'), anlageId: Number(fd.get('anlageId')), fahrerId: fd.get('fahrerId') ? Number(fd.get('fahrerId')) : null, beginn: fd.get('beginn') || null, ...(m ? { materialId: m.id, materialText: null } : { materialId: null, materialText: String(fd.get('material')).trim() }), menge, einheit: fd.get('einheit'), anzahlFuhren: anz ? Number(anz) : null, von, nach, notiz: String(fd.get('notiz') || '').trim() };
    $('#fu-ok', dlg.el).disabled = true;
    try {
      const r = f ? await put(`/plan/fuhren/${f.id}`, { ...body, version: f.version }) : await post('/plan/fuhren', body);
      const tage = fd.getAll('kopie'); let kop = 0;
      if (!f && tage.length && r && r.id) { try { kop = ((await post('/plan/fuhren/kopieren', { id: r.id, tage })).angelegt || []).length; } catch (x) { toast(`Kopieren nicht möglich: ${x.message}`, 'warn'); } }
      dlg.zu(); toast(f ? 'Fuhre gespeichert.' : `Fuhre angelegt${kop ? ` und auf ${kop} weitere${kop === 1 ? 'n Tag' : ' Tage'} kopiert` : ''}.`); fertig();
    } catch (x) { $('#fu-ok', dlg.el).disabled = false; zeigF(x.status === 409 ? 'Inzwischen von jemand anderem geändert – bitte schließen und erneut öffnen.' : x.message); }
  });
  const weg = $('#fu-weg', dlg.el);
  if (weg) weg.addEventListener('click', async () => { if (!(await bestaetigen(f.veroeffentlicht ? 'Fuhre stornieren?' : 'Fuhre löschen?', f.veroeffentlicht ? 'Die Fuhre war schon veröffentlicht: Sie zählt als offene Änderung – der Fahrer erfährt es mit der nächsten Veröffentlichung („entfällt“).' : '', f.veroeffentlicht ? 'Stornieren' : 'Löschen', 'danger'))) return; try { await del(`/plan/fuhren/${f.id}`); dlg.zu(); toast(f.veroeffentlicht ? 'Fuhre storniert – bitte neu veröffentlichen, damit der Fahrer es erfährt.' : 'Fuhre gelöscht.', f.veroeffentlicht ? 'warn' : 'ok'); } catch (x) { toast(x.message, 'warn'); } fertig(); });
  const dk = $('#fu-dichte-ok', dlg.el);
  if (dk) dk.addEventListener('click', async () => { const w = parseZahl($('#fu-dichte', dlg.el).value); if (!(w > 0 && w < 10)) { toast('Dichte in t/m³ eintragen, z. B. 1,8.', 'warn'); return; } try { await put(`/materialien/${f.materialId}`, { dichte: w }); stamm = null; toast('Dichte gespeichert – gilt für künftige Fuhren.'); } catch (x) { toast(x.message, 'warn'); } });
}

/* ---------- Fahrer: „Meine Fuhren“ mit Warteschlange ohne Netz ---------- */
const KEY = 'bt_fuhren_warten';
const wartend = () => speicher.lies(KEY, []);
const merke = (l) => { try { speicher.setz(KEY, l); return true; } catch (e) { return false; } };
export const fuhrenWartend = (benutzerId) => wartend().filter((w) => w.benutzerId === benutzerId);
const vorlaeufig = (x) => !!x && (x.netz || x.status >= 500 || x.status === 429 || x.status === 408);
async function sende(w) {
  if (!w.statusFertig) { await post(`/plan/fuhren/${w.fuhreId}/status`, w.body); w.statusFertig = true; }
  if (w.foto) { await post(`/plan/fuhren/${w.fuhreId}/foto`, w.foto); w.foto = null; }
}
let sendet = false;
export async function fuhrenNachsenden(benutzerId) {
  if (sendet) return 0; sendet = true; let ok = 0;
  try {
    for (const w of fuhrenWartend(benutzerId)) {
      try { await sende(w); ok += 1; merke(wartend().filter((x) => x.nr !== w.nr)); }
      catch (x) { if (vorlaeufig(x)) { merke(wartend().map((y) => (y.nr === w.nr ? w : y))); break; } merke(wartend().filter((y) => y.nr !== w.nr)); toast(`Fuhre nicht übernommen: ${x.message}`, 'warn'); }
    }
  } finally { sendet = false; }
  return ok;
}
// Sendet sofort; ohne Netz wird die Meldung gemerkt und später nachgesendet
async function melde(benutzerId, fuhreId, body, foto) {
  const w = { nr: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, benutzerId, fuhreId, body, foto: foto || null, zeit: new Date().toISOString() };
  try { await sende(w); return 'gesendet'; }
  catch (x) {
    if (!vorlaeufig(x)) throw x;
    if (!merke([...wartend(), w])) { w.foto = null; if (!merke([...wartend(), w])) throw new Error('Kein Speicherplatz am Gerät – bitte bei Verbindung erneut melden.'); return 'gemerkt-ohne-foto'; }
    return 'gemerkt';
  }
}
export function meineFuhrenHtml(tage, heute, benutzerId) {
  const mit = tage.filter((t) => (t.fuhren || []).length);
  if (!mit.length) return '';
  const warten = fuhrenWartend(benutzerId);
  return `<section class="stack" id="meine-fuhren" aria-labelledby="h-mf"><h2 class="me-h" id="h-mf">Meine Fuhren</h2>
    ${warten.length ? `<div id="fuhren-warten">${banner('warn', `${warten.length} Meldung${warten.length === 1 ? '' : 'en'} gespeichert – wird gesendet, sobald Verbindung besteht.`)}</div>` : ''}
    ${mit.map((t) => `<h3 class="sub-h">${t.datum === heute ? 'Heute' : t.datum === fmt.addTage(heute, 1) ? 'Morgen' : esc(fmt.datumKurz(t.datum))} · ${t.fuhren.length} Fuhre${t.fuhren.length === 1 ? '' : 'n'}</h3>
      <ol class="plain fu-liste" data-fuhren-tag="${t.datum}">${t.fuhren.slice().sort((a, b) => (a.reihenfolge || 0) - (b.reihenfolge || 0)).map((f, i) => { const w = warten.find((x) => x.fuhreId === f.id); const status = w ? w.body.status : f.status; const nach = f.nach || {};
        return `<li class="card fu-meine" data-fuhre="${f.id}" data-status="${esc(status)}"><div class="fu-nr">${i + 1}</div><div class="fu-inhalt">
          <div class="fu-top">${fStatus({ status })}${w ? '<span class="chip xs st-amber">wartet auf Verbindung</span>' : ''}${f.beginn ? `<b>${esc(f.beginn)} Uhr</b>` : ''}${f.anlage ? `<small>${esc(f.anlage.bezeichnung || '')}${f.anlage.kennzeichen ? ' · ' + esc(f.anlage.kennzeichen) : ''}</small>` : ''}</div>
          <b class="fu-mat">${esc(matName(f))}</b><b class="fu-menge">${esc(mengeText(f))}${f.anzahlFuhren ? ` · ${f.anzahlFuhren} Fuhre${f.anzahlFuhren === 1 ? '' : 'n'}` : ''}</b>
          <p class="fu-weg">${esc(ort(f.von))} → <b>${esc(ort(nach))}</b></p>${nach.abladestelle ? `<p class="fu-ablade"><small>Abladestelle</small>${esc(nach.abladestelle)}</p>` : ''}${f.notiz ? `<p class="me-zeile-notiz">${esc(f.notiz)}</p>` : ''}
          ${f.mapsLink ? `<a class="btn primary lg block" data-maps href="${esc(f.mapsLink)}" target="_blank" rel="noopener noreferrer">${ic('pin')}In Google Maps öffnen</a>` : ''}
          ${t.datum === heute && status !== 'erledigt' && status !== 'storniert' ? `<div class="fu-knoepfe">${status === 'geplant' ? `<button type="button" class="btn dark lg" data-fuhr-los="${f.id}">${ic('truck')}Losgefahren</button>` : ''}<button type="button" class="btn ${status === 'unterwegs' ? 'primary' : 'ghost'} lg" data-fuhr-ab="${f.id}">${ic('check')}Abgeladen</button></div>` : ''}</div></li>`; }).join('')}</ol>`).join('')}</section>`;
}
export function meineFuhrenBinden(el, tage, benutzerId, fertig) {
  const finde = (id) => { for (const t of tage) { const f = (t.fuhren || []).find((x) => Number(x.id) === Number(id)); if (f) return f; } return null; };
  const ergebnis = (r) => { toast(r === 'gesendet' ? 'Gemeldet.' : r === 'gemerkt-ohne-foto' ? 'Keine Verbindung – Meldung gespeichert (Foto bitte später nachreichen).' : 'Keine Verbindung – Meldung gespeichert, wird nachgesendet.', r === 'gesendet' ? 'ok' : 'warn'); fertig(r); };
  el.addEventListener('click', async (e) => {
    const los = e.target.closest('[data-fuhr-los]');
    if (los) { los.disabled = true; try { ergebnis(await melde(benutzerId, Number(los.dataset.fuhrLos), { status: 'unterwegs' })); } catch (x) { los.disabled = false; toast(x.message, 'warn'); } return; }
    const ab = e.target.closest('[data-fuhr-ab]'); if (!ab) return;
    const f = finde(ab.dataset.fuhrAb); if (!f) return;
    const dlg = dialog({ titel: 'Abgeladen', inhalt: `<form id="fab" class="stack-s" novalidate><p class="muted sm">${esc(matName(f))} → ${esc(ort(f.nach))}</p>
      <div class="form-grid"><label class="field"><span class="field-label">Tatsächliche Menge</span><input class="input lg num" name="menge" inputmode="decimal" required value="${esc(fmt.zahl(f.menge, 3))}"></label><label class="field"><span class="field-label">Einheit</span><select class="input lg" name="einheit">${Object.entries(EH).map(([k, t]) => `<option value="${k}" ${f.einheit === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
      <label class="field"><span class="field-label">Liefer-/Wiegeschein fotografieren (optional)</span><input class="input lg" type="file" name="foto" accept="image/*" capture="environment"></label>
      <label class="field"><span class="field-label">Bemerkung (optional)</span><input class="input lg" name="bemerkung" maxlength="300"></label><p class="form-err" role="alert" hidden></p></form>`,
      fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="fab" id="fab-ok">Abgeladen melden</button>' });
    $('#fab', dlg.el).addEventListener('submit', async (ev) => {
      ev.preventDefault(); const fd = new FormData(ev.target); const err = $('.form-err', dlg.el); const menge = parseZahl(fd.get('menge'));
      if (!(menge > 0)) { err.hidden = false; err.textContent = 'Menge unklar – bitte so schreiben: 44,5'; return; }
      $('#fab-ok', dlg.el).disabled = true;
      try {
        const datei = ev.target.elements.foto.files[0]; let foto = null;
        if (datei) { const b = await bildVerkleinern(datei, 1400, 0.8); foto = { bildBase64: b.daten, dateiname: b.dateiname }; }
        const r = await melde(benutzerId, f.id, { status: 'erledigt', menge, einheit: fd.get('einheit'), ...(String(fd.get('bemerkung') || '').trim() ? { bemerkung: String(fd.get('bemerkung')).trim() } : {}) }, foto);
        dlg.zu(); ergebnis(r);
      } catch (x) { $('#fab-ok', dlg.el).disabled = false; err.hidden = false; err.textContent = x.message; }
    });
  });
}
// Polier: eingehende Fuhren zu seinen Baustellen
export const partieFuhrenHtml = (fuhren) => (fuhren && fuhren.length ? `<section class="card" id="partie-fuhren" aria-label="Fuhren"><h2 class="me-h">Fuhren · ${fuhren.length}</h2><ul class="plain rows">${fuhren.map((f) => `<li data-fuhre="${f.id}" data-status="${esc(f.status)}"><span class="grow"><b>${esc(matName(f))} · ${esc(mengeText(f))}</b><small>${[f.beginn, f.anlage && f.anlage.bezeichnung, f.fahrer && f.fahrer.name, `${ort(f.von)} → ${ort(f.nach)}`].filter(Boolean).map(esc).join(' · ')}</small>${f.nach && f.nach.abladestelle ? `<small>Abladestelle: ${esc(f.nach.abladestelle)}</small>` : ''}${f.erledigt ? `<small>abgeladen: ${esc(fmt.zahl(f.erledigt.menge, 2))} ${esc(EH[f.erledigt.einheit] || '')} um ${esc(fmt.uhr(f.erledigt.zeit))}</small>` : ''}</span>${fStatus(f)}</li>`).join('')}</ul></section>` : '');
