// Fuhrpark & Geräte (Servicebuch): gemeinsame Bausteine und Dialoge.
// Texte, Status-Darstellung (immer Symbol + Wort), Mangel melden, Zählerstand, Eintrag, Anlage, Planposition, Vorlagen.
// €-Felder erscheinen nur, wenn der Server sie liefert bzw. das Recht „preise_sehen“ vorhanden ist.
import { get, post, put, del } from '../api.js';
import { ic, esc, fmt, parseZahl, geldFelder, geldWert, dialog, bestaetigen, toast, banner, $, $$ } from '../ui.js';

/* ---------- Begriffe ---------- */
export const KLASSE = { pkw: 'PKW', bus: 'Bus', lkw: 'LKW', anhaenger: 'Anhänger', baumaschine: 'Baumaschine', walze: 'Walze', brecher: 'Brecher', kleingeraet: 'Kleingerät', sonstiges: 'Sonstiges' };
// Filter „Art“: Walzen und Brecher zählen zu den Baumaschinen
export const ART_GRUPPEN = [
  ['pkw', 'PKW', ['pkw']], ['lkw', 'LKW', ['lkw']], ['bus', 'Bus', ['bus']], ['baumaschine', 'Baumaschine', ['baumaschine', 'walze', 'brecher']],
  ['anhaenger', 'Anhänger', ['anhaenger']], ['kleingeraet', 'Kleingerät', ['kleingeraet']], ['sonstiges', 'Sonstiges', ['sonstiges']],
];
export const FAHRZEUGKLASSEN = ['M1', 'M2', 'M3', 'N1', 'N2', 'N3', 'O1', 'O2', 'O3', 'O4'];
export const EIGENTUM = { eigen: 'Eigentum', leasing: 'Leasing', miete: 'Miete' };
// Ampel: [Text, Chip-Klasse, Symbol]
export const STATUS = {
  einsatzbereit: ['Einsatzbereit', 'st-green', 'check'], ok: ['In Ordnung', 'st-green', 'check'],
  bald: ['Bald fällig', 'st-amber', 'clock'], faellig: ['Fällig', 'st-orange', 'calendar'],
  ueberfaellig: ['Überfällig', 'st-red', 'alert'], gesperrt: ['Gesperrt', 'st-dark', 'lock'],
  ausgeschieden: ['Ausgeschieden', 'st-grey', 'x'], unvollstaendig: ['Angaben fehlen', 'st-grey', 'info'], erledigt: ['Erledigt', 'st-grey', 'check'],
};
export const statusChip = (s, cls = '') => { const [t, c, i] = STATUS[s] || [s || '–', 'st-grey', 'info']; return `<span class="chip ${c} ${cls}" data-fp-status="${esc(s || '')}">${ic(i)}${esc(t)}</span>`; };
// Anlagenstatus für die Anzeige: „fällig“ wird zu „überfällig“, wenn der nächste Termin überfällig ist
export const anlageStatus = (a) => (a.status === 'faellig' && a.naechsterTermin && a.naechsterTermin.status === 'ueberfaellig' ? 'ueberfaellig' : a.status || 'einsatzbereit');
export const STATUS_FOLGE = ['gesperrt', 'ueberfaellig', 'faellig', 'bald', 'einsatzbereit', 'ausgeschieden'];

export const ZAEHLER = { km: ['Kilometer', 'Kilometerstand', 'km'], bh: ['Betriebsstunden', 'Betriebsstundenstand', 'Std.'], brecher: ['Brecherstunden', 'Brecherstundenstand', 'Std.'], kran: ['Kranstunden', 'Kranstundenstand', 'Std.'], hub: ['Hubzahl', 'Hubzahl', 'Hübe'] };
export const zName = (art) => (ZAEHLER[art] || [art])[0];
export const zStand = (art) => (ZAEHLER[art] || [art, 'Zählerstand'])[1];
export const zEinheit = (z) => (z && z.einheit) || (ZAEHLER[z && z.art] || [])[2] || '';
export const fmtZ = (wert, z) => (typeof wert === 'number' && isFinite(wert) ? `${fmt.zahl(wert, z && (z.art === 'km' || z.art === 'hub') ? 0 : 1)} ${zEinheit(z)}` : '–');
// Zähler aus Liste, Detail (letzterStand als Objekt) oder Zählerabfrage (letzterStand als Zahl) vereinheitlichen
export function normZaehler(z) {
  const ls = z.letzterStand;
  const obj = ls && typeof ls === 'object';
  const letzt = obj ? (ls.anzeige ?? ls.wert) : typeof ls === 'number' ? ls : null;
  const letztDatum = obj ? ls.datum : z.letzterDatum || null;
  // Vorbelegung: letzter Ablesewert, bei Schätzung aus Bautagesberichten der geschätzte Stand
  let vorschlag = letzt;
  if (z.geschaetzt && typeof z.aktuell === 'number' && obj && typeof ls.wert === 'number' && letzt != null) vorschlag = Math.round((letzt + (z.aktuell - ls.wert)) * 10) / 10;
  else if (letzt == null && typeof z.aktuell === 'number') vorschlag = z.aktuell;
  return { id: z.id, art: z.art, einheit: zEinheit(z), aktuell: z.aktuell, geschaetzt: !!z.geschaetzt, letzt, letztDatum, vorschlag };
}

export const PLAN_ART = { gesetzlich: 'Gesetzliche Prüfung', hersteller: 'Herstellerservice', intern: 'Interne Kontrolle', vertrag: 'Vertragsfrist' };
export const EINTRAG_ART = { service: ['Service', 'wrench'], reparatur: ['Reparatur', 'wrench'], pruefung: ['Prüfung', 'shield'], reifen: ['Reifen', 'truck'], sonstiges: ['Sonstiges', 'file'] };
export const PRUEF = { ohne_maengel: ['Ohne Mängel', 'st-green'], leichte_maengel: ['Leichte Mängel', 'st-amber'], schwere_maengel: ['Schwere Mängel', 'st-red'] };
export const DRINGLICH = { hinweis: ['Hinweis', 'st-grey', 'info'], bald: ['Bald beheben', 'st-amber', 'clock'], sofort: ['Sofort stillgelegt', 'st-red', 'lock'] };
export const MANGEL_STATUS = { offen: ['Offen', 'st-red'], in_arbeit: ['In Arbeit', 'st-amber'], behoben: ['Behoben', 'st-green'], verworfen: ['Verworfen', 'st-grey'] };
export const dringChip = (d) => { const [t, c, i] = DRINGLICH[d] || [d, 'st-grey', 'info']; return `<span class="chip xs ${c}">${ic(i)}${esc(t)}</span>`; };
export const mangelChip = (s) => { const [t, c] = MANGEL_STATUS[s] || [s, 'st-grey']; return `<span class="chip xs ${c}" data-mangel-status="${esc(s)}"><i class="dot"></i>${esc(t)}</span>`; };

export const anlageName = (a) => `${a.bezeichnung || ''}${a.kennzeichen ? ' · ' + a.kennzeichen : ''}`;
export const liste = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);

// Fälligkeit einer Planposition bzw. Frist in Worten; Zählertermine mit Prognose „voraussichtlich fällig am …“
export function faelligTeile(p) {
  const t = [];
  const regel = p.regel || {};
  if (p.faelligAm) {
    const monat = regel.monatsgenau || regel.folgeMonate || p.monatsgenau;
    t.push({ art: 'datum', text: monat ? `Begutachtungsmonat ${fmt.monat(p.faelligAm.slice(0, 7))}` : `fällig am ${fmt.datum(p.faelligAm)}`, neben: p.spaetestens && p.spaetestens !== p.faelligAm ? `spätestens ${fmt.datum(p.spaetestens)}` : '' });
  }
  const rest = liste(p.rest);
  liste(p.faelligBei).forEach((f, i) => {
    const r = rest.find((x) => x.art === f.art) || rest[i];
    const z = { art: f.art };
    t.push({ art: 'zaehler', text: `fällig bei ${fmtZ(f.wert, z)}`, neben: r && typeof r.wert === 'number' ? (r.wert >= 0 ? `noch ${fmtZ(r.wert, z)}` : `${fmtZ(-r.wert, z)} überzogen`) : '' });
  });
  if (p.prognoseAm) t.push({ art: 'prognose', text: `voraussichtlich fällig am ${fmt.datum(p.prognoseAm)}`, neben: '' });
  // Kurzinfo ohne Leserecht: nur das nächste Datum ist bekannt
  if (!t.length && p.naechstesDatum) { const prog = p.grund && p.grund !== 'Datum'; t.push({ art: prog ? 'prognose' : 'datum', text: `${prog ? 'voraussichtlich fällig am' : 'fällig am'} ${fmt.datum(p.naechstesDatum)}`, neben: '' }); }
  return t;
}
export const faelligHtml = (p) => {
  const t = faelligTeile(p);
  if (!t.length) return p.status === 'unvollstaendig' ? '<span class="muted">Angaben fehlen (z. B. Erstzulassung oder Zähler)</span>' : '<span class="muted">–</span>';
  return t.map((x) => `<span class="fp-due ${x.art}"${x.art === 'prognose' ? ' data-prognose' : ''}>${x.art === 'prognose' ? ic('chart', 'xs') + ' ' : ''}${esc(x.text)}${x.neben ? ` <small>· ${esc(x.neben)}</small>` : ''}</span>`).join('');
};
export const grundHtml = (g) => (g ? `<small class="muted">maßgeblich: ${esc(g)}</small>` : '');

/* ---------- Formular-Helfer ---------- */
const feld = (label, inhalt, cls = '') => `<label class="field ${cls}"><span class="field-label">${label}</span>${inhalt}</label>`;
const opt = (obj, wahl) => Object.entries(obj).map(([k, v]) => `<option value="${esc(k)}" ${k === wahl ? 'selected' : ''}>${esc(Array.isArray(v) ? v[0] : v)}</option>`).join('');
const zahlOderNull = (s) => { const t = String(s == null ? '' : s).trim(); if (!t) return null; const n = parseZahl(t); return Number.isFinite(n) ? n : NaN; };
const zeigFehler = (d, text) => { const e = $('.form-err', d.el); if (!e) { toast(text, 'warn'); return; } e.hidden = false; e.textContent = text; e.scrollIntoView({ block: 'nearest' }); };
// Veralteter Stand (409 mit version): nichts überschreiben, Neu-Laden anbieten
function fehlerImDialog(d, x, ctx) {
  const e = $('.form-err', d.el);
  if (x.status === 409 && x.daten && x.daten.version != null && e) {
    e.hidden = false; e.dataset.konflikt = '1';
    e.innerHTML = 'Inzwischen von jemand anderem geändert – Ihre Eingabe wurde nicht gespeichert. <button type="button" class="btn ghost sm" data-konflikt-laden>Neu laden</button>';
    $('[data-konflikt-laden]', e).addEventListener('click', () => { d.zu(); ctx.neuLaden(); });
  } else zeigFehler(d, x.netz ? 'Keine Verbindung zum Server – bitte später noch einmal versuchen.' : x.message);
}
const fertig = (ctx, d, text) => { d.zu(true); toast(text); ctx.meldungenNeu(); if (ctx.aktuell()) ctx.neuLaden(); };
const sperr = (d, an) => { $$('.dlg-foot .btn, [data-dring]', d.el).forEach((b) => { b.disabled = an; }); };

/* ---------- Mangel melden (alle Rollen; 3 Schritte: Gerät → Text → Dringlichkeit) ---------- */
export function mangelMelden(ctx, { anlage = null, anlagen = null } = {}) {
  let wahl = anlage;
  let schritt = anlage ? 2 : 1;
  let text = '';
  let alle = anlagen;
  const d = dialog({ titel: 'Mangel melden', inhalt: '<div id="mm"></div>' });
  d.el.id = 'mangel-dlg';
  const box = $('#mm', d.el);
  const kopf = () => `<ol class="mm-steps" aria-label="Schritte">${['Gerät', 'Was ist los?', 'Wie dringend?'].map((s, i) => `<li class="${i + 1 === schritt ? 'on' : i + 1 < schritt ? 'done' : ''}"${i + 1 === schritt ? ' aria-current="step"' : ''}><i>${i + 1}</i><span>${s}</span></li>`).join('')}</ol>`;
  const zeile = (a) => `<button type="button" class="pick-row" data-mm-anlage="${a.id}"><span class="site-ic">${ic(a.gesperrt ? 'lock' : 'truck')}</span><span class="pick-txt"><small>${esc([a.nummer, KLASSE[a.klasse]].filter(Boolean).join(' · '))}</small><b>${esc(a.bezeichnung)}</b><span>${esc(a.kennzeichen || '')}</span></span>${ic('right')}</button>`;
  function zeichne() {
    if (schritt === 1) {
      box.innerHTML = `${kopf()}<label class="search"><span>${ic('truck')}</span><input type="search" id="mm-suche" placeholder="Gerät oder Kennzeichen suchen" aria-label="Gerät suchen" autocomplete="off"></label><div class="pick-list" id="mm-liste">${alle ? '' : '<div class="state small"><span class="spinner"></span></div>'}</div>`;
      const fuelle = () => {
        const q = ($('#mm-suche', box).value || '').trim().toLowerCase();
        const sicht = (alle || []).filter((a) => !q || `${a.bezeichnung} ${a.kennzeichen || ''} ${a.nummer || ''}`.toLowerCase().includes(q));
        $('#mm-liste', box).innerHTML = sicht.length ? sicht.map(zeile).join('') : '<div class="state empty small"><p>Kein Gerät gefunden.</p></div>';
      };
      $('#mm-suche', box).addEventListener('input', fuelle);
      if (alle) fuelle(); else get('/fuhrpark/anlagen').then((l) => { alle = l; if (schritt === 1 && d.el.isConnected) fuelle(); }).catch((x) => { $('#mm-liste', box).innerHTML = `<p class="form-err">${esc(x.message)}</p>`; });
    } else if (schritt === 2) {
      box.innerHTML = `${kopf()}<div class="mm-geraet">${ic('truck')}<span><b>${esc(wahl.bezeichnung)}</b><small>${esc(wahl.kennzeichen || wahl.nummer || '')}</small></span>${anlage ? '' : '<button type="button" class="btn ghost sm" data-mm-zurueck="1">Ändern</button>'}</div>
        <label class="field"><span class="field-label">Was ist kaputt oder auffällig?</span><textarea class="input area mm-text" id="mm-text" rows="4" maxlength="1000" placeholder="z. B. Hydraulikschlauch undicht, Bremslicht links defekt …">${esc(text)}</textarea></label>
        <p class="muted sm">Tipp: Mit dem Mikrofon der Tastatur kann der Text diktiert werden.</p><p class="form-err" role="alert" hidden></p>
        <button type="button" class="btn primary lg block" data-mm-weiter>Weiter${ic('right')}</button>`;
      setTimeout(() => { const t = $('#mm-text', box); if (t) t.focus(); }, 50);
    } else {
      box.innerHTML = `${kopf()}<div class="mm-geraet">${ic('truck')}<span><b>${esc(wahl.bezeichnung)}</b><small>${esc(text)}</small></span><button type="button" class="btn ghost sm" data-mm-zurueck="2">Ändern</button></div>
        <div class="mm-dring" role="group" aria-label="Dringlichkeit">
          <button type="button" class="mm-d" data-dring="hinweis">${ic('info')}<span><b>Hinweis</b><small>Kann beim nächsten Service erledigt werden</small></span></button>
          <button type="button" class="mm-d amber" data-dring="bald">${ic('clock')}<span><b>Bald beheben</b><small>Gerät kann vorerst weiter verwendet werden</small></span></button>
          <button type="button" class="mm-d red" data-dring="sofort">${ic('lock')}<span><b>Sofort stilllegen</b><small>Gerät darf nicht mehr verwendet werden</small></span></button>
        </div><p class="form-err" role="alert" hidden></p>`;
    }
  }
  async function sende(dring) {
    if (dring === 'sofort' && !(await bestaetigen('Gerät wirklich stilllegen?', `„${wahl.bezeichnung}“ wird sofort gesperrt und darf nicht mehr verwendet werden, bis die Werkstatt den Mangel behoben hat. Büro und Bauleitung werden verständigt.`, 'Ja, stilllegen', 'danger'))) return;
    sperr(d, true);
    try {
      const body = { anlageId: wahl.id, text: text.trim(), dringlichkeit: dring };
      const bs = wahl.standort && wahl.standort.baustelleId; if (bs) body.baustelleId = bs;
      await post('/fuhrpark/maengel', body);
      fertig(ctx, d, dring === 'sofort' ? 'Mangel gemeldet – Gerät ist gesperrt.' : 'Mangel gemeldet. Danke!');
    } catch (x) { sperr(d, false); zeigFehler(d, x.netz ? 'Keine Verbindung – der Mangel wurde NICHT gesendet. Bitte später noch einmal versuchen.' : x.message); }
  }
  box.addEventListener('click', (e) => {
    const a = e.target.closest('[data-mm-anlage]');
    if (a) { wahl = alle.find((x) => String(x.id) === a.dataset.mmAnlage); schritt = 2; zeichne(); return; }
    const z = e.target.closest('[data-mm-zurueck]');
    if (z) { if (schritt === 2) text = $('#mm-text', box).value; schritt = Number(z.dataset.mmZurueck); zeichne(); return; }
    if (e.target.closest('[data-mm-weiter]')) {
      text = $('#mm-text', box).value;
      if (text.trim().length < 3) { zeigFehler(d, 'Bitte kurz beschreiben, was nicht passt (mindestens 3 Zeichen).'); $('#mm-text', box).focus(); return; }
      schritt = 3; zeichne(); return;
    }
    const dr = e.target.closest('[data-dring]');
    if (dr && !dr.disabled) sende(dr.dataset.dring);
  });
  zeichne();
  return d.geschlossen;
}

/* ---------- Zählerstand eintragen (alle Rollen; große Eingabe, letzter Stand darunter) ---------- */
const GRENZE_TAG = (art, klasse) => (art === 'km' ? (klasse === 'lkw' ? 1500 : 1200) : art === 'hub' ? 2000 : 24);
export function zaehlerstandDialog(ctx, anlage, { titel = '', ueberspringen = false, nachladen = true } = {}) {
  const zl = (anlage.zaehler || []).filter((z) => z.aktiv !== false && z.aktiv !== 0).map(normZaehler);
  const heute = fmt.iso();
  const d = dialog({ titel: titel || 'Zählerstand eintragen', inhalt: `<form id="zs-f" class="zs-form" novalidate>
    <div class="mm-geraet">${ic('truck')}<span><b>${esc(anlage.bezeichnung)}</b><small>${esc(anlage.kennzeichen || anlage.nummer || '')}</small></span></div>
    ${zl.length ? zl.map((z) => `<label class="field zs-feld"><span class="field-label">${esc(zStand(z.art))}</span>
      <span class="zs-in"><input class="input num zs-wert" name="z-${esc(z.art)}" data-art="${esc(z.art)}" inputmode="decimal" autocomplete="off" placeholder="${z.letzt != null ? esc(fmt.zahl(z.letzt, 1)) : '0'}" aria-describedby="zs-h-${esc(z.art)}"><i>${esc(z.einheit)}</i></span>
      <small class="zs-letzt" id="zs-h-${esc(z.art)}">${z.letzt != null ? `Letzter Stand: <b>${esc(fmtZ(z.letzt, z))}</b>${z.letztDatum ? ` am ${esc(fmt.datum(z.letztDatum))}` : ''}` : 'Noch kein Stand erfasst.'}${z.geschaetzt && typeof z.aktuell === 'number' ? ` · geschätzt ≈ ${esc(fmtZ(z.aktuell, z))}` : ''}</small>
      <small class="zs-warn" data-warn="${esc(z.art)}" role="alert" hidden></small></label>`).join('') : banner('info', 'Für dieses Gerät ist kein Zähler angelegt.')}
    ${zl.length ? `<label class="field"><span class="field-label">Abgelesen am</span><input class="input lg" type="date" name="datum" value="${heute}" max="${heute}" required></label>` : ''}
    <p class="form-err" role="alert" hidden></p></form>`,
    fuss: `<button class="btn ghost" type="button" data-zu>${ueberspringen ? 'Überspringen' : 'Abbrechen'}</button>${zl.length ? '<button class="btn primary" type="submit" form="zs-f">Speichern</button>' : ''}` });
  d.el.id = 'zaehler-dlg';
  const form = $('#zs-f', d.el);
  // Warnung vor dem Senden: kleiner als zuletzt bzw. ungewöhnlich großer Sprung
  const pruefe = (z, wert, datum) => {
    if (z.letzt == null || wert == null || Number.isNaN(wert)) return null;
    if (wert < z.letzt) return { hart: true, text: `Kleiner als der letzte Stand (${fmtZ(z.letzt, z)}${z.letztDatum ? ' am ' + fmt.datum(z.letztDatum) : ''}). Bei Zählertausch bitte das Büro verständigen.` };
    const tage = z.letztDatum ? Math.max(1, Math.round((fmt.dt(datum) - fmt.dt(z.letztDatum)) / 864e5)) : null;
    if (tage && (wert - z.letzt) / tage > GRENZE_TAG(z.art, anlage.klasse)) return { hart: false, text: `Ungewöhnlich viel: +${fmtZ(wert - z.letzt, z)} in ${tage} Tag${tage > 1 ? 'en' : ''}. Bitte Eingabe prüfen.` };
    return null;
  };
  const zeigWarn = () => zl.map((z) => {
    const inp = $(`[data-art="${z.art}"]`, form), w = $(`[data-warn="${z.art}"]`, form);
    const v = zahlOderNull(inp.value), p = Number.isNaN(v) ? { hart: true, text: 'Zahl unklar – bitte so schreiben: 4.150,5' } : pruefe(z, v, form.elements.datum.value || heute);
    w.hidden = !p; w.textContent = p ? p.text : ''; w.classList.toggle('hart', !!(p && p.hart)); inp.classList.toggle('invalid', !!(p && p.hart));
    return { z, v, p };
  });
  if (form && zl.length) {
    form.addEventListener('input', zeigWarn);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = zeigWarn().filter((x) => x.v != null);
      if (!r.length) { zeigFehler(d, 'Bitte den abgelesenen Stand eintragen.'); return; }
      if (r.some((x) => x.p && x.p.hart)) { zeigFehler(d, 'Bitte die rot markierte Eingabe korrigieren.'); return; }
      const weich = r.filter((x) => x.p);
      if (weich.length && !(await bestaetigen('Stimmt dieser Stand?', weich.map((x) => `${zStand(x.z.art)} ${fmtZ(x.v, x.z)}: ${x.p.text}`).join(' ') + ' Trotzdem so speichern?', 'Ja, speichern'))) return;
      sperr(d, true);
      const meld = [];
      try {
        for (const x of r) {
          const a = await post('/fuhrpark/zaehlerstaende', { anlageId: anlage.id, art: x.z.art, anzeige: x.v, datum: form.elements.datum.value || heute });
          const w = a && (a.warnung || a.hinweis); if (w) meld.push(typeof w === 'string' ? w : w.text || '');
        }
        d.zu(true);
        if (meld.filter(Boolean).length) toast(`Gespeichert – Hinweis: ${meld.filter(Boolean).join(' ')}`, 'warn'); else toast('Zählerstand gespeichert. Danke!');
        ctx.meldungenNeu(); if (nachladen && ctx.aktuell()) ctx.neuLaden();
      } catch (x) { sperr(d, false); zeigFehler(d, x.netz ? 'Keine Verbindung – der Stand wurde NICHT gespeichert.' : x.message); }
    });
    setTimeout(() => { const i = $('.zs-wert', form); if (i) i.focus(); }, 50);
  }
  return d.geschlossen;
}
// Nach dem Ausstempeln: je Fahrzeug nachfragen (überspringbar), siehe Vertrag 7.3
export async function zaehlerAbfrage(ctx, abfrage) {
  for (const a of abfrage || []) {
    if (!ctx.aktuell()) return;
    const arten = (a.zaehler || []).map((z) => zStand(z.art));
    await zaehlerstandDialog(ctx, { id: a.anlageId, bezeichnung: a.bezeichnung, kennzeichen: a.kennzeichen, klasse: a.klasse, zaehler: a.zaehler || [] }, { titel: `${arten.length === 1 ? arten[0] : 'Zählerstand'} eintragen?`, ueberspringen: true, nachladen: false });
  }
}

/* ---------- Servicebuch-Eintrag (fuhrpark) ---------- */
export function eintragDialog(ctx, a, { maengel = [], schaeden = [], vorgewaehlt = [], art = 'service' } = {}) {
  const preise = ctx.kann('preise_sehen');
  const zl = (a.zaehler || []).filter((z) => z.aktiv !== false && z.aktiv !== 0).map(normZaehler);
  const plan = (a.plan || []).filter((p) => p.aktiv !== false && p.aktiv !== 0 && p.status !== 'erledigt');
  // Offene Mängel und Schadensmeldungen (gleiche Verknüpfung über maengelIds)
  const offen = [...maengel.filter((m) => m.status === 'offen' || m.status === 'in_arbeit'), ...schaeden.filter((x) => x.status === 'gemeldet' || x.status === 'in_bearbeitung').map((x) => ({ id: x.id, text: x.ursache, schaden: true }))];
  const heute = fmt.iso();
  const d = dialog({ titel: 'Eintrag ins Servicebuch', breit: true, inhalt: `<form id="eb-f" class="form-grid" novalidate>
    <div class="mm-geraet full">${ic('truck')}<span><b>${esc(a.bezeichnung)}</b><small>${esc(a.kennzeichen || a.nummer || '')}</small></span></div>
    ${feld('Art', `<select class="input lg" name="art">${opt(EINTRAG_ART, art)}</select>`)}
    ${feld('Datum', `<input class="input lg" type="date" name="datum" value="${heute}" max="${heute}" required>`)}
    ${feld('Kurztext', '<input class="input lg" name="titel" maxlength="120" required placeholder="z. B. Service 1.000 Std., Pickerl, Hydraulikschlauch getauscht">', 'full')}
    ${feld('Werkstatt', '<input class="input lg" name="werkstatt" maxlength="120" required value="intern" list="eb-ws"><datalist id="eb-ws"><option value="intern"></option></datalist>', 'full')}
    ${zl.length ? `<fieldset class="full eb-zaehler"><legend class="field-label">Zählerstände am Tag der Arbeit (Pflicht)</legend><div class="form-grid">${zl.map((z) => `<label class="field"><span class="field-label">${esc(zStand(z.art))} in ${esc(z.einheit)}</span><input class="input lg num" name="z-${esc(z.art)}" data-z="${esc(z.art)}" inputmode="decimal" required value="${z.vorschlag != null ? esc(fmt.zahl(z.vorschlag, 1)) : ''}" aria-describedby="eb-zh-${esc(z.art)}"><small class="muted" id="eb-zh-${esc(z.art)}">${z.letzt != null ? `Letzter Stand ${esc(fmtZ(z.letzt, z))}${z.letztDatum ? ' am ' + esc(fmt.datum(z.letztDatum)) : ''}` : 'Noch kein Stand'}${z.geschaetzt ? ' · Vorschlag geschätzt – bitte ablesen' : ''}</small></label>`).join('')}</div></fieldset>` : ''}
    ${plan.length ? `<fieldset class="full"><legend class="field-label">Damit erledigt</legend><div class="eb-plan">${plan.map((p) => `<label class="check-inline"><input type="checkbox" name="plan" value="${p.id}" ${p.status === 'faellig' || p.status === 'ueberfaellig' ? 'checked' : ''}><span>${esc(p.titel)} ${statusChip(p.status, 'xs')}</span></label>`).join('')}</div></fieldset>` : ''}
    <div class="full form-grid" data-nur-pruefung hidden>
      ${feld('Ergebnis der Prüfung', `<select class="input lg" name="pruefErgebnis"><option value="">– bitte wählen –</option>${opt(PRUEF, '')}</select>`)}
      ${feld('Prüfer / Prüfstelle', '<input class="input lg" name="pruefer" maxlength="120">')}
      <p class="muted sm full" data-schwer hidden>${ic('lock', 'xs')} Bei schweren Mängeln wird das Gerät gesperrt, bis es wieder freigegeben wird.</p>
    </div>
    ${feld('Durchgeführte Arbeiten', '<textarea class="input area" name="arbeiten" rows="3" maxlength="2000"></textarea>', 'full')}
    ${feld('Verwendete Teile', '<textarea class="input area" name="teile" rows="2" maxlength="2000"></textarea>', 'full')}
    ${feld('Eigene Arbeitsstunden', '<input class="input lg num" name="arbeitsstundenIntern" inputmode="decimal" placeholder="0">')}
    ${preise ? feld('Rechnungsnummer', '<input class="input lg" name="rechnungNr" maxlength="60">') + feld('Kosten netto in €', '<input class="input lg num" name="kosten" inputmode="decimal" data-geld="leer" placeholder="0,00">') : ''}
    ${offen.length ? `<fieldset class="full"><legend class="field-label">Damit behobene Mängel und Schäden</legend><div class="eb-plan">${offen.map((m) => `<label class="check-inline"><input type="checkbox" name="mangel" value="${m.id}" ${vorgewaehlt.includes(m.id) ? 'checked' : ''}><span>${esc(m.text)} ${m.schaden ? '<span class="chip xs st-outline">Schaden</span>' : dringChip(m.dringlichkeit)}</span></label>`).join('')}</div></fieldset>` : ''}
    <p class="form-err full" role="alert" hidden></p></form>`,
    fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="eb-f">Eintrag speichern</button>' });
  d.el.id = 'eintrag-dlg';
  const form = $('#eb-f', d.el);
  geldFelder(form);
  const artWechsel = () => { const p = form.elements.art.value === 'pruefung'; $('[data-nur-pruefung]', form).hidden = !p; $('[data-schwer]', form).hidden = form.elements.pruefErgebnis.value !== 'schwere_maengel'; };
  form.addEventListener('change', artWechsel); artWechsel();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const body = { anlageId: a.id, art: f.get('art'), datum: f.get('datum'), werkstatt: (f.get('werkstatt') || '').trim(), titel: (f.get('titel') || '').trim() };
    if (!body.titel) { zeigFehler(d, 'Bitte einen Kurztext eintragen.'); form.elements.titel.focus(); return; }
    if (!body.werkstatt) { zeigFehler(d, 'Bitte die Werkstatt eintragen („intern“ für die eigene Werkstatt).'); return; }
    body.zaehler = [];
    for (const z of zl) {
      const v = zahlOderNull(f.get('z-' + z.art));
      if (v == null || Number.isNaN(v)) { zeigFehler(d, `${zStand(z.art)} fehlt oder ist unklar – der Stand ist bei jedem Eintrag Pflicht.`); $(`[data-z="${z.art}"]`, form).focus(); return; }
      body.zaehler.push({ art: z.art, anzeige: v });
    }
    for (const k of ['arbeiten', 'teile', 'pruefer', 'rechnungNr']) { const v = (f.get(k) || '').trim(); if (v && (k !== 'pruefer' || body.art === 'pruefung')) body[k] = v; }
    const std = zahlOderNull(f.get('arbeitsstundenIntern'));
    if (Number.isNaN(std) || (std != null && std < 0)) { zeigFehler(d, 'Arbeitsstunden unklar – bitte so schreiben: 2,5'); return; }
    if (std != null) body.arbeitsstundenIntern = std;
    if (body.art === 'pruefung') { if (!f.get('pruefErgebnis')) { zeigFehler(d, 'Bitte das Ergebnis der Prüfung wählen.'); return; } body.pruefErgebnis = f.get('pruefErgebnis'); }
    if (preise && form.elements.kosten) { const k = geldWert(form.elements.kosten); if (Number.isNaN(k)) { zeigFehler(d, 'Kosten unklar – bitte so schreiben: 1.250,00'); return; } if (k != null) body.kosten = k; }
    const pl = f.getAll('plan').map(Number); if (pl.length) body.planpositionIds = pl;
    const mg = f.getAll('mangel').map(Number); if (mg.length) body.maengelIds = mg;
    sperr(d, true);
    try { await post('/fuhrpark/eintraege', body); fertig(ctx, d, 'Eintrag gespeichert.'); }
    catch (x) { sperr(d, false); fehlerImDialog(d, x, ctx); }
  });
  return d.geschlossen;
}
export async function eintragStorno(ctx, e) {
  const d = dialog({ titel: 'Eintrag stornieren', inhalt: `<form id="st-f" class="stack-s"><p>„${esc(e.titel)}“ vom ${esc(fmt.datum(e.datum))} wird storniert. Erledigte Fristen werden zurückgesetzt, die Zählerstände des Eintrags gelten nicht mehr.</p>
    ${feld('Grund', '<input class="input lg" name="grund" required maxlength="200">')}<p class="form-err" role="alert" hidden></p></form>`,
    fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn danger" type="submit" form="st-f">Stornieren</button>' });
  $('#st-f', d.el).addEventListener('submit', async (ev) => {
    ev.preventDefault(); const grund = new FormData(ev.target).get('grund').trim();
    if (!grund) { zeigFehler(d, 'Bitte einen Grund angeben.'); return; }
    try { await post(`/fuhrpark/eintraege/${e.id}/storno`, { grund }); fertig(ctx, d, 'Eintrag storniert.'); } catch (x) { fehlerImDialog(d, x, ctx); }
  });
}

/* ---------- Mangel bearbeiten, Sperre, Ausscheiden (fuhrpark) ---------- */
export function mangelBearbeiten(ctx, m) {
  const d = dialog({ titel: 'Mangel bearbeiten', inhalt: `<form id="mb-f" class="stack-s"><div class="mm-geraet">${ic('alert')}<span><b>${esc(m.text)}</b><small>${esc((m.gemeldetVon && m.gemeldetVon.name) || '')} · ${esc(fmt.zeitpunkt(m.gemeldet))}</small></span></div>
    ${feld('Status', `<select class="input lg" name="status">${opt(MANGEL_STATUS, m.status)}</select>`)}
    ${feld('Notiz der Werkstatt', `<textarea class="input area" name="notiz" rows="3" maxlength="1000">${esc(m.notiz || '')}</textarea>`)}
    <p class="form-err" role="alert" hidden></p></form>`,
    fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="mb-f">Speichern</button>' });
  $('#mb-f', d.el).addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const notiz = f.get('notiz').trim();
    if (f.get('status') === 'verworfen' && !notiz) { zeigFehler(d, 'Beim Verwerfen bitte in der Notiz begründen, warum.'); return; }
    try { await put(`/fuhrpark/maengel/${m.id}`, { status: f.get('status'), ...(notiz ? { notiz } : {}), ...(m.version != null ? { version: m.version } : {}) }); fertig(ctx, d, 'Mangel aktualisiert.'); } catch (x) { fehlerImDialog(d, x, ctx); }
  });
}
export function sperreDialog(ctx, a) {
  const an = a._sperren != null ? a._sperren : !a.sperre;
  const d = dialog({ titel: an ? 'Gerät sperren' : 'Sperre aufheben', inhalt: `<form id="sp-f" class="stack-s"><p>${an ? `„${esc(a.bezeichnung)}“ wird gesperrt und in der Geräteauswahl mit einem Schloss gekennzeichnet.` : `Die händische Sperre von „${esc(a.bezeichnung)}“ wird aufgehoben. Sperren durch offene Mängel („sofort“) oder überfällige Prüfungen bleiben bestehen, bis diese erledigt sind.`}</p>
    ${feld('Grund', '<input class="input lg" name="grund" required maxlength="200">')}<p class="form-err" role="alert" hidden></p></form>`,
    fuss: `<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn ${an ? 'danger' : 'primary'}" type="submit" form="sp-f">${an ? 'Sperren' : 'Sperre aufheben'}</button>` });
  $('#sp-f', d.el).addEventListener('submit', async (e) => {
    e.preventDefault(); const grund = new FormData(e.target).get('grund').trim();
    if (grund.length < 3) { zeigFehler(d, 'Bitte einen Grund angeben (mindestens 3 Zeichen).'); return; }
    try { await post(`/fuhrpark/anlagen/${a.id}/sperre`, { gesperrt: an, grund }); fertig(ctx, d, an ? 'Gerät gesperrt.' : 'Sperre aufgehoben.'); } catch (x) { fehlerImDialog(d, x, ctx); }
  });
}
export function ausscheidenDialog(ctx, a) {
  const d = dialog({ titel: 'Gerät ausscheiden', inhalt: `<form id="au-f" class="stack-s"><p>„${esc(a.bezeichnung)}“ wird als verkauft bzw. verschrottet geführt und erscheint nicht mehr in den Listen. Das Servicebuch bleibt lesbar.</p>
    ${feld('Datum', `<input class="input lg" type="date" name="datum" value="${fmt.iso()}" max="${fmt.iso()}" required>`)}${feld('Grund', '<input class="input lg" name="grund" required maxlength="200" placeholder="z. B. verkauft">')}<p class="form-err" role="alert" hidden></p></form>`,
    fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn danger" type="submit" form="au-f">Ausscheiden</button>' });
  $('#au-f', d.el).addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    if (!f.get('grund').trim()) { zeigFehler(d, 'Bitte einen Grund angeben.'); return; }
    try { await post(`/fuhrpark/anlagen/${a.id}/ausscheiden`, { datum: f.get('datum'), grund: f.get('grund').trim() }); d.zu(); toast('Gerät ausgeschieden.'); location.hash = '#/fuhrpark?reiter=geraete'; } catch (x) { fehlerImDialog(d, x, ctx); }
  });
}

/* ---------- Zählerstand korrigieren, Zählertausch, neuer Zähler (fuhrpark) ---------- */
export function standKorrektur(ctx, z, punkt) {
  const unpl = punkt.status === 'unplausibel';
  const d = dialog({ titel: unpl ? 'Unplausiblen Stand prüfen' : 'Zählerstand korrigieren', inhalt: `<form id="sk-f" class="stack-s"><p>${esc(zStand(z.art))} vom ${esc(fmt.datum(punkt.datum))}: <b>${esc(fmtZ(punkt.anzeige ?? punkt.wert, z))}</b>${punkt.hinweis ? `<br><span class="muted sm">${esc(punkt.hinweis)}</span>` : ''}</p>
    ${feld('Was soll geschehen?', `<select class="input lg" name="akt">${unpl ? '<option value="gueltig">Stand stimmt – übernehmen</option>' : ''}<option value="wert">Wert berichtigen</option><option value="ungueltig">Stand verwerfen (ungültig)</option></select>`)}
    <div data-nur-wert ${unpl ? 'hidden' : ''}>${feld(`Richtiger Stand in ${esc(zEinheit(z))}`, `<input class="input lg num" name="anzeige" inputmode="decimal" value="${esc(fmt.zahl(punkt.anzeige ?? punkt.wert, 1))}">`)}</div>
    ${feld('Grund', '<input class="input lg" name="grund" required maxlength="200">')}<p class="form-err" role="alert" hidden></p></form>`,
    fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="sk-f">Speichern</button>' });
  const form = $('#sk-f', d.el);
  form.elements.akt.addEventListener('change', () => { $('[data-nur-wert]', form).hidden = form.elements.akt.value !== 'wert'; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(form); const grund = f.get('grund').trim();
    if (!grund) { zeigFehler(d, 'Bitte einen Grund angeben.'); return; }
    const body = { grund };
    if (f.get('akt') === 'wert') { const v = zahlOderNull(f.get('anzeige')); if (v == null || Number.isNaN(v)) { zeigFehler(d, 'Stand unklar – bitte so schreiben: 4.150,5'); return; } body.anzeige = v; if (unpl) body.status = 'gueltig'; } else body.status = f.get('akt');
    try { await put(`/fuhrpark/zaehlerstaende/${punkt.id}`, body); fertig(ctx, d, 'Zählerstand aktualisiert.'); } catch (x) { fehlerImDialog(d, x, ctx); }
  });
}
export function tauschDialog(ctx, z) {
  const d = dialog({ titel: 'Zählertausch', inhalt: `<form id="zt-f" class="form-grid"><p class="full">Wurde der Zähler (Tacho, Betriebsstundenzähler) getauscht, läuft der Gesamtstand im Servicebuch stetig weiter. Angezeigt wird weiterhin der Wert am Gerät.</p>
    ${feld('Datum des Tauschs', `<input class="input lg" type="date" name="datum" value="${fmt.iso()}" max="${fmt.iso()}" required>`, 'full')}
    ${feld(`Endstand alter Zähler (${esc(zEinheit(z))})`, '<input class="input lg num" name="endstandAlt" inputmode="decimal" required>')}
    ${feld(`Startstand neuer Zähler (${esc(zEinheit(z))})`, '<input class="input lg num" name="startstandNeu" inputmode="decimal" required value="0">')}
    ${feld('Grund', '<input class="input lg" name="grund" required maxlength="200" placeholder="z. B. Tacho defekt, getauscht">', 'full')}<p class="form-err full" role="alert" hidden></p></form>`,
    fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="zt-f">Tausch speichern</button>' });
  $('#zt-f', d.el).addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    const alt = zahlOderNull(f.get('endstandAlt')), neu = zahlOderNull(f.get('startstandNeu'));
    if (alt == null || neu == null || Number.isNaN(alt) || Number.isNaN(neu)) { zeigFehler(d, 'Bitte beide Stände als Zahl eintragen.'); return; }
    if (!f.get('grund').trim()) { zeigFehler(d, 'Bitte einen Grund angeben.'); return; }
    try { await post(`/fuhrpark/zaehler/${z.id}/tausch`, { datum: f.get('datum'), endstandAlt: alt, startstandNeu: neu, grund: f.get('grund').trim() }); fertig(ctx, d, 'Zählertausch gespeichert.'); } catch (x) { fehlerImDialog(d, x, ctx); }
  });
}
const zaehlerFelder = (vorhandene = []) => `<fieldset class="full az-zaehler"><legend class="field-label">Zähler</legend>
  ${Object.keys(ZAEHLER).filter((k) => !vorhandene.includes(k)).map((k) => `<div class="az-z"><label class="check-inline"><input type="checkbox" name="zart" value="${k}"><span>${esc(zName(k))}</span></label>
    <input class="input num" name="zstart-${k}" inputmode="decimal" placeholder="Stand heute" aria-label="${esc(zStand(k))} heute">
    ${k === 'bh' || k === 'brecher' ? `<label class="check-inline sm"><input type="checkbox" name="zbericht-${k}" checked><span>aus Bautagesberichten schätzen</span></label>` : '<span></span>'}</div>`).join('')}</fieldset>`;
function zaehlerLesen(f, d) {
  const out = [];
  for (const art of f.getAll('zart')) {
    const v = zahlOderNull(f.get('zstart-' + art));
    if (Number.isNaN(v)) { zeigFehler(d, `${zStand(art)}: Zahl unklar.`); return null; }
    out.push({ art, startstand: v || 0, startdatum: fmt.iso(), ausBericht: f.get('zbericht-' + art) === 'on' });
  }
  return out;
}
export function zaehlerNeu(ctx, a) {
  const d = dialog({ titel: 'Zähler anlegen', inhalt: `<form id="zn-f" class="form-grid">${zaehlerFelder((a.zaehler || []).map((z) => z.art))}<p class="form-err full" role="alert" hidden></p></form>`,
    fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="zn-f">Anlegen</button>' });
  $('#zn-f', d.el).addEventListener('submit', async (e) => {
    e.preventDefault(); const zl = zaehlerLesen(new FormData(e.target), d); if (!zl) return;
    if (!zl.length) { zeigFehler(d, 'Bitte mindestens einen Zähler ankreuzen.'); return; }
    try { for (const z of zl) await post(`/fuhrpark/anlagen/${a.id}/zaehler`, z); fertig(ctx, d, 'Zähler angelegt.'); } catch (x) { fehlerImDialog(d, x, ctx); }
  });
}

/* ---------- Anlage anlegen / bearbeiten (fuhrpark) ---------- */
export async function anlageDialog(ctx, a = null) {
  const [geraete, leute, baustellen] = await Promise.all([get('/geraete').catch(() => []), get('/mitarbeiter').catch(() => []), get('/baustellen').catch(() => [])]);
  const v = (k) => esc(a && a[k] != null ? a[k] : '');
  const st = (a && a.standort) || {};
  const d = dialog({ titel: a ? 'Stammdaten bearbeiten' : 'Neues Fahrzeug / Gerät', breit: true, inhalt: `<form id="an-f" class="form-grid" novalidate>
    ${feld('Bezeichnung', `<input class="input lg" name="bezeichnung" required maxlength="120" value="${v('bezeichnung')}" placeholder="z. B. Kettenbagger CAT 320">`, 'full')}
    ${feld('Art', `<select class="input lg" name="klasse">${opt(KLASSE, (a && a.klasse) || 'lkw')}</select>`)}
    ${feld('Interne Nummer', `<input class="input lg" name="nummer" maxlength="20" value="${v('nummer')}" placeholder="z. B. A33">`)}
    ${feld('Kennzeichen', `<input class="input lg" name="kennzeichen" maxlength="20" value="${v('kennzeichen')}">`)}
    ${feld('Fahrzeugklasse (für §57a)', `<select class="input lg" name="fahrzeugklasse"><option value="">– keine –</option>${FAHRZEUGKLASSEN.map((k) => `<option ${a && a.fahrzeugklasse === k ? 'selected' : ''}>${k}</option>`).join('')}</select>`)}
    ${feld('Hersteller', `<input class="input lg" name="hersteller" maxlength="80" value="${v('hersteller')}">`)}
    ${feld('Typ', `<input class="input lg" name="typ" maxlength="80" value="${v('typ')}">`)}
    ${feld('FIN / Seriennummer', `<input class="input lg" name="fin" maxlength="40" value="${v('fin')}">`)}
    ${feld('Baujahr', `<input class="input lg num" name="baujahr" inputmode="numeric" maxlength="4" value="${v('baujahr')}">`)}
    ${feld('Erstzulassung', `<input class="input lg" type="date" name="erstzulassung" value="${v('erstzulassung')}" max="${fmt.iso()}">`)}
    ${feld('Höchstzul. Gesamtgewicht (kg)', `<input class="input lg num" name="hzgKg" inputmode="numeric" value="${a && a.hzgKg != null ? esc(fmt.zahl(a.hzgKg, 0)) : ''}">`)}
    ${feld('Eigentum', `<select class="input lg" name="eigentum">${opt(EIGENTUM, (a && a.eigentum) || 'eigen')}</select>`)}
    ${feld('Leasing-/Mietende', `<input class="input lg" type="date" name="vertragsende" value="${v('vertragsende')}">`)}
    ${feld('Versicherung (Polizze)', `<input class="input lg" name="versicherung" maxlength="120" value="${v('versicherung')}">`, 'full')}
    ${feld('Gerätezeile im Bautagesbericht', `<select class="input lg" name="geraetId"><option value="">– keine –</option>${geraete.map((g) => `<option value="${g.id}" ${a && a.geraetId === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select>`)}
    ${feld('Verantwortlich (Fahrer / Maschinist)', `<select class="input lg" name="verantwortlichId"><option value="">– niemand –</option>${leute.filter((m) => m.aktiv !== false && m.aktiv !== 0).map((m) => `<option value="${m.id}" ${a && (a.verantwortlichId ?? (a.verantwortlich && a.verantwortlich.id)) === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>`)}
    ${feld('Standort: Baustelle', `<select class="input lg" name="standortBaustelleId"><option value="">– Bauhof / keine –</option>${baustellen.filter((b) => b.status !== 'abgeschlossen' || b.id === st.baustelleId).map((b) => `<option value="${b.id}" ${(a && 'standortBaustelleId' in a ? a.standortBaustelleId : st.baustelleId) === b.id ? 'selected' : ''}>${esc((b.kst ? b.kst + ' · ' : '') + b.name)}</option>`).join('')}</select>`)}
    ${feld('Standort: Text', `<input class="input lg" name="standortText" maxlength="120" value="${esc(a && a.standortText != null ? a.standortText : st.baustelleId ? '' : st.text || '')}" placeholder="z. B. Bauhof">`)}
    ${a ? '' : zaehlerFelder()}
    ${feld('Notiz', `<textarea class="input area" name="notiz" rows="2" maxlength="1000">${v('notiz')}</textarea>`, 'full')}
    <p class="form-err full" role="alert" hidden></p></form>`,
    fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="an-f">Speichern</button>' });
  d.el.id = 'anlage-dlg';
  $('#an-f', d.el).addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    const txt = (k) => { const s = (f.get(k) || '').trim(); return s || null; };
    const num = (k) => (f.get(k) ? Number(f.get(k)) : null);
    const body = { bezeichnung: txt('bezeichnung'), klasse: f.get('klasse'), nummer: txt('nummer'), kennzeichen: txt('kennzeichen'), fahrzeugklasse: txt('fahrzeugklasse'), hersteller: txt('hersteller'), typ: txt('typ'), fin: txt('fin'), erstzulassung: txt('erstzulassung'), eigentum: f.get('eigentum'), vertragsende: txt('vertragsende'), versicherung: txt('versicherung'), geraetId: num('geraetId'), verantwortlichId: num('verantwortlichId'), standortBaustelleId: num('standortBaustelleId'), standortText: txt('standortText'), notiz: txt('notiz') };
    if (!body.bezeichnung) { zeigFehler(d, 'Bitte eine Bezeichnung eintragen.'); return; }
    const bj = zahlOderNull(f.get('baujahr')), hzg = zahlOderNull(f.get('hzgKg'));
    if (Number.isNaN(bj) || (bj != null && (bj < 1950 || bj > new Date().getFullYear() + 1))) { zeigFehler(d, 'Baujahr unklar – bitte vierstellig eintragen, z. B. 2021.'); return; }
    if (Number.isNaN(hzg)) { zeigFehler(d, 'Gesamtgewicht unklar – bitte in kg eintragen, z. B. 26.000.'); return; }
    body.baujahr = bj; body.hzgKg = hzg;
    try {
      if (a) { await put(`/fuhrpark/anlagen/${a.id}`, { ...body, version: a.version }); fertig(ctx, d, 'Stammdaten gespeichert.'); return; }
      const zl = zaehlerLesen(f, d); if (!zl) return;
      body.zaehler = zl;
      const neu = await post('/fuhrpark/anlagen', body);
      d.zu(); toast('Gerät angelegt.');
      const vorschlag = (neu && neu.vorlagenVorschlag) || [];
      if (neu && neu.id && vorschlag.length) await vorlagenUebernehmen(ctx, neu, vorschlag);
      if (neu && neu.id) location.hash = `#/fuhrpark/anlage/${neu.id}`; else ctx.neuLaden();
    } catch (x) { fehlerImDialog(d, x, ctx); }
  });
}
// Nach dem Anlegen: passende Vorlagen (Prüf- und Servicefristen) zur Übernahme anbieten
async function vorlagenUebernehmen(ctx, anlage, vorschlag) {
  let vorlagen = [];
  if (vorschlag.some((v) => typeof v === 'string')) vorlagen = await get('/fuhrpark/vorlagen').catch(() => []);
  const zeilen = vorschlag.map((v) => (typeof v === 'string' ? vorlagen.find((x) => x.schluessel === v) || { schluessel: v, titel: v } : v));
  const d = dialog({ titel: 'Fristen übernehmen?', inhalt: `<form id="vu-f" class="stack-s"><p>Für „${esc(anlage.bezeichnung)}“ passen diese Prüf- und Servicefristen. Angekreuzte werden in den Plan übernommen und können danach je Gerät angepasst werden.</p>
    <div class="eb-plan">${zeilen.map((v) => `<label class="check-inline"><input type="checkbox" name="v" value="${esc(v.schluessel)}" ${v.empfohlen === false ? '' : 'checked'}><span>${esc(v.titel)} ${v.pruefen ? '<span class="chip xs st-amber">Prüfen</span>' : ''}<small class="muted"> ${esc(PLAN_ART[v.art] || '')}</small></span></label>`).join('')}</div><p class="form-err" role="alert" hidden></p></form>`,
    fuss: '<button class="btn ghost" type="button" data-zu>Später</button><button class="btn primary" type="submit" form="vu-f">Übernehmen</button>' });
  $('#vu-f', d.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    try { for (const s of new FormData(e.target).getAll('v')) await post(`/fuhrpark/anlagen/${anlage.id}/plan`, { vorlageSchluessel: s }); d.zu(); toast('Fristen übernommen.'); } catch (x) { fehlerImDialog(d, x, ctx); }
  });
  return d.geschlossen;
}

/* ---------- Regel (Intervall) einer Planposition / Vorlage ---------- */
const DATUM_KRIT = { '': 'kein Datumsintervall', intervallMonate: 'alle … Monate', intervallTage: 'alle … Tage', jaehrlichAm: 'jährlich am (TT.MM.)', einmaligAm: 'einmalig am (Datum)', folgeMonate: 'Abstände ab Erstzulassung (Monate, z. B. 36, 24, 12)' };
const datumKrit = (r) => Object.keys(DATUM_KRIT).find((k) => k && r[k] != null) || '';
const kritWert = (r, k) => (k === 'folgeMonate' ? (r[k] || []).join(', ') : k === 'jaehrlichAm' ? String(r[k] || '').split('-').reverse().join('.') + '.' : k === 'einmaligAm' ? fmt.datum(r[k]) : k ? String(r[k]) : '');
export function regelText(r = {}) {
  const t = [];
  if (r.folgeMonate) t.push(`ab Erstzulassung nach ${r.folgeMonate.join(' / ')} Monaten`);
  if (r.intervallMonate) t.push(`alle ${r.intervallMonate} Monate`);
  if (r.intervallTage) t.push(`alle ${r.intervallTage} Tage`);
  if (r.jaehrlichAm) t.push(`jährlich am ${kritWert(r, 'jaehrlichAm')}`);
  if (r.einmaligAm) t.push(`einmalig am ${fmt.datum(r.einmaligAm)}`);
  if (r.intervallStunden) t.push(`alle ${fmt.zahl(r.intervallStunden, 0)} ${(ZAEHLER[r.zaehlerArtStunden || 'bh'] || [])[2] || 'Std.'}${r.zaehlerArtStunden && r.zaehlerArtStunden !== 'bh' ? ' (' + zName(r.zaehlerArtStunden) + ')' : ''}`);
  if (r.intervallKm) t.push(`alle ${fmt.zahl(r.intervallKm, 0)} km`);
  return t.join(' oder ') + (t.length > 1 ? ' – was zuerst eintritt' : '') || '–';
}
const regelFelder = (r = {}) => {
  const k = datumKrit(r);
  return `${feld('Nach Datum', `<select class="input lg" name="dkrit">${opt(DATUM_KRIT, k)}</select>`)}
    ${feld('Wert', `<input class="input lg" name="dwert" value="${esc(kritWert(r, k))}" placeholder="z. B. 12">`)}
    ${feld('Nach Stunden: alle …', `<input class="input lg num" name="intervallStunden" inputmode="numeric" value="${r.intervallStunden != null ? esc(fmt.zahl(r.intervallStunden, 0)) : ''}" placeholder="z. B. 500">`)}
    ${feld('Zähler für Stunden', `<select class="input lg" name="zaehlerArtStunden">${['bh', 'brecher', 'kran', 'hub'].map((a) => `<option value="${a}" ${(r.zaehlerArtStunden || 'bh') === a ? 'selected' : ''}>${esc(zName(a))}</option>`).join('')}</select>`)}
    ${feld('Nach Kilometern: alle …', `<input class="input lg num" name="intervallKm" inputmode="numeric" value="${r.intervallKm != null ? esc(fmt.zahl(r.intervallKm, 0)) : ''}" placeholder="z. B. 30.000">`)}
    ${feld('Erinnern ab … Tage vorher', `<input class="input lg num" name="vorlaufTage" inputmode="numeric" value="${r.vorlaufTage != null ? esc(r.vorlaufTage) : ''}" placeholder="90">`)}
    <label class="check-inline full"><input type="checkbox" name="sperrt" ${r.sperrtBeiUeberfaellig ? 'checked' : ''}><span>Gerät sperren, wenn überfällig</span></label>`;
};
// Liest die Regel aus dem Formular; nicht bearbeitete Schlüssel (Toleranzen, schliesstEin …) bleiben erhalten. null = Fehler (bereits angezeigt)
function regelLesen(f, basis, d) {
  const r = { ...(basis || {}) };
  Object.keys(DATUM_KRIT).forEach((k) => { if (k) delete r[k]; });
  ['intervallStunden', 'zaehlerArtStunden', 'intervallKm', 'vorlaufTage', 'sperrtBeiUeberfaellig'].forEach((k) => delete r[k]);
  const k = f.get('dkrit'), w = (f.get('dwert') || '').trim();
  const ganz = (s) => { const n = zahlOderNull(s); return n != null && Number.isInteger(n) && n > 0 ? n : NaN; };
  if (k === 'intervallMonate' || k === 'intervallTage') { const n = ganz(w); if (Number.isNaN(n)) { zeigFehler(d, 'Bitte beim Datumsintervall eine ganze Zahl eintragen, z. B. 12.'); return null; } r[k] = n; }
  else if (k === 'folgeMonate') { const l = w.split(/[,;/\s]+/).filter(Boolean).map(ganz); if (!l.length || l.some(Number.isNaN)) { zeigFehler(d, 'Bitte die Abstände in Monaten eintragen, z. B. 36, 24, 12.'); return null; } r.folgeMonate = l; r.monatsgenau = true; }
  else if (k === 'jaehrlichAm') { const m = /^(\d{1,2})\.(\d{1,2})\.?$/.exec(w); if (!m || +m[1] < 1 || +m[1] > 31 || +m[2] < 1 || +m[2] > 12) { zeigFehler(d, 'Bitte den Stichtag als TT.MM. eintragen, z. B. 31.10.'); return null; } r.jaehrlichAm = `${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  else if (k === 'einmaligAm') { const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(w) || (/^(\d{4})-(\d{2})-(\d{2})$/.exec(w) || []).slice().reverse().concat([0]).slice(0, 0); const iso = /^(\d{4})-(\d{2})-(\d{2})$/.test(w) ? w : m && m.length ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; if (!iso) { zeigFehler(d, 'Bitte das Datum als TT.MM.JJJJ eintragen.'); return null; } r.einmaligAm = iso; }
  if (k !== 'folgeMonate' && basis && basis.folgeMonate && !r.folgeMonate) delete r.monatsgenau;
  const std = zahlOderNull(f.get('intervallStunden')), km = zahlOderNull(f.get('intervallKm')), vl = zahlOderNull(f.get('vorlaufTage'));
  if ([std, km, vl].some((n) => Number.isNaN(n) || (n != null && n <= 0 && n !== vl))) { zeigFehler(d, 'Intervalle bitte als positive Zahl eintragen.'); return null; }
  if (std != null) { r.intervallStunden = std; r.zaehlerArtStunden = f.get('zaehlerArtStunden') || 'bh'; }
  if (km != null) r.intervallKm = km;
  if (vl != null) r.vorlaufTage = vl;
  if (f.get('sperrt') === 'on') r.sperrtBeiUeberfaellig = true;
  if (!datumKrit(r) && r.intervallStunden == null && r.intervallKm == null) { zeigFehler(d, 'Bitte mindestens ein Intervall angeben (Datum, Stunden oder Kilometer).'); return null; }
  return r;
}

/* ---------- Planposition (fuhrpark) ---------- */
export async function planDialog(ctx, a, p = null) {
  const vorlagen = p ? [] : (await get('/fuhrpark/vorlagen').catch(() => [])).filter((v) => v.aktiv !== false && v.aktiv !== 0);
  const zl = (a.zaehler || []).map(normZaehler);
  const lz = (p && p.letzteZaehler) || {};
  const startFelder = `${feld('Zuletzt durchgeführt am', `<input class="input lg" type="date" name="letzteDatum" value="${esc((p && p.letzteDatum) || '')}" max="${fmt.iso()}">`)}
    ${zl.map((z) => feld(`… bei ${esc(zStand(z.art))} (${esc(z.einheit)})`, `<input class="input lg num" name="lz-${esc(z.art)}" inputmode="decimal" value="${lz[z.art] != null ? esc(fmt.zahl(lz[z.art], 1)) : ''}">`)).join('')}`;
  const d = dialog({ titel: p ? 'Frist bearbeiten' : 'Frist hinzufügen', breit: true, inhalt: `<form id="pl-f" class="form-grid" novalidate>
    ${p ? '' : feld('Vorlage', `<select class="input lg" name="vorlage"><option value="">– eigene Frist ohne Vorlage –</option>${vorlagen.map((v) => `<option value="${esc(v.schluessel)}">${esc(v.titel)}${v.pruefen ? ' (Prüfen)' : ''}</option>`).join('')}</select>`, 'full')}
    <div class="full form-grid" data-eigen>
      ${feld('Titel', `<input class="input lg" name="titel" maxlength="120" value="${esc((p && p.titel) || '')}">`, 'full')}
      ${p ? '' : feld('Art', `<select class="input lg" name="art">${opt(PLAN_ART, 'intern')}</select>`, 'full')}
      ${regelFelder((p && p.regel) || {})}
    </div>
    ${startFelder}
    ${p ? feld('Grund der Änderung (Pflicht, wenn „zuletzt durchgeführt“ geändert wird)', '<input class="input lg" name="grund" maxlength="200">', 'full') : ''}
    <p class="form-err full" role="alert" hidden></p></form>`,
    fuss: `${p ? '<button class="btn ghost" type="button" data-plan-weg>Frist entfernen</button>' : ''}<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="pl-f">Speichern</button>` });
  d.el.id = 'plan-dlg';
  const form = $('#pl-f', d.el);
  if (!p) form.elements.vorlage.addEventListener('change', () => { $('[data-eigen]', form).hidden = !!form.elements.vorlage.value; });
  const weg = $('[data-plan-weg]', d.el);
  if (weg) weg.addEventListener('click', async () => {
    if (!(await bestaetigen('Frist entfernen?', `„${p.titel}“ wird für dieses Gerät nicht mehr überwacht. Bisherige Einträge im Servicebuch bleiben erhalten.`, 'Entfernen', 'danger'))) return;
    try { await del(`/fuhrpark/anlagen/${a.id}/plan/${p.id}`); fertig(ctx, d, 'Frist entfernt.'); } catch (x) { fehlerImDialog(d, x, ctx); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(form);
    const body = {};
    const ld = f.get('letzteDatum') || null;
    const letzteZ = {};
    for (const z of zl) { const v = zahlOderNull(f.get('lz-' + z.art)); if (Number.isNaN(v)) { zeigFehler(d, `${zStand(z.art)}: Zahl unklar.`); return; } if (v != null) letzteZ[z.art] = v; }
    const vs = !p && f.get('vorlage');
    if (vs) body.vorlageSchluessel = vs;
    else {
      const titel = (f.get('titel') || '').trim();
      if (!titel) { zeigFehler(d, 'Bitte einen Titel eintragen.'); return; }
      const regel = regelLesen(f, p && p.regel, d); if (!regel) return;
      body.titel = titel; body.regel = regel; if (!p) body.art = f.get('art');
    }
    const startGeaendert = !p || ld !== (p.letzteDatum || null) || JSON.stringify(letzteZ) !== JSON.stringify(Object.fromEntries(Object.entries(lz).filter(([, v]) => v != null)));
    if (startGeaendert) { if (ld) body.letzteDatum = ld; else if (p) body.letzteDatum = null; if (Object.keys(letzteZ).length || p) body.letzteZaehler = letzteZ; }
    if (p && startGeaendert) { const g = (f.get('grund') || '').trim(); if (!g) { zeigFehler(d, 'Bitte einen Grund angeben – die Änderung von „zuletzt durchgeführt“ wird protokolliert.'); form.elements.grund.focus(); return; } body.grund = g; }
    try {
      if (p) await put(`/fuhrpark/anlagen/${a.id}/plan/${p.id}`, { ...body, version: p.version }); else await post(`/fuhrpark/anlagen/${a.id}/plan`, body);
      fertig(ctx, d, 'Frist gespeichert.');
    } catch (x) { fehlerImDialog(d, x, ctx); }
  });
}

/* ---------- Vorlagen (fuhrpark) ---------- */
export function vorlageDialog(ctx, v) {
  const d = dialog({ titel: 'Vorlage bearbeiten', breit: true, inhalt: `<form id="vo-f" class="form-grid" novalidate>
    ${feld('Titel', `<input class="input lg" name="titel" required maxlength="120" value="${esc(v.titel)}">`, 'full')}
    ${feld('Rechtsgrundlage / Hinweis', `<input class="input lg" name="rechtsgrundlage" maxlength="300" value="${esc(v.rechtsgrundlage || '')}">`, 'full')}
    ${regelFelder(v.regel || {})}
    <label class="check-inline full"><input type="checkbox" name="pruefen" ${v.pruefen ? 'checked' : ''}><span>Kennzeichen „Prüfen“ – Intervall ist noch nicht mit Prüfstelle/Serviceheft abgestimmt</span></label>
    <label class="check-inline full"><input type="checkbox" name="aktiv" ${v.aktiv === false || v.aktiv === 0 ? '' : 'checked'}><span>Aktiv (wird bei neuen Geräten vorgeschlagen)</span></label>
    <p class="muted sm full">Änderungen wirken nicht rückwirkend. Mit „Auf Geräte anwenden“ werden bestehende Fristen aus dieser Vorlage umgestellt.</p>
    <p class="form-err full" role="alert" hidden></p></form>`,
    fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="vo-f">Speichern</button>' });
  $('#vo-f', d.el).addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    const regel = regelLesen(f, v.regel, d); if (!regel) return;
    try { await put(`/fuhrpark/vorlagen/${v.id}`, { version: v.version, titel: f.get('titel').trim(), rechtsgrundlage: (f.get('rechtsgrundlage') || '').trim() || null, regel, pruefen: f.get('pruefen') === 'on', aktiv: f.get('aktiv') === 'on' }); fertig(ctx, d, 'Vorlage gespeichert.'); }
    catch (x) { fehlerImDialog(d, x, ctx); }
  });
}
export async function vorlageAnwenden(ctx, v) {
  let vorschau;
  try { vorschau = await post(`/fuhrpark/vorlagen/${v.id}/anwenden`, { vorschau: true }); } catch (x) { toast(x.message, 'warn'); return; }
  const zeilen = Array.isArray(vorschau) ? vorschau : (vorschau && vorschau.geaendert) || [];
  const dat = (x) => (x ? fmt.datum(x) : '–');
  const d = dialog({ titel: 'Vorlage auf Geräte anwenden', breit: true, inhalt: zeilen.length ? `<p>Die Regel „${esc(v.titel)}“ (${esc(regelText(v.regel))}) wird für diese Fristen übernommen:</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Gerät</th><th>Fälligkeit bisher</th><th>Fälligkeit neu</th></tr></thead><tbody>${zeilen.map((z) => { const alt = z.vorher || z.alt || {}, neu = z.nachher || z.neu || {}; return `<tr><td class="fp-haupt">${esc((z.anlage && z.anlage.bezeichnung) || z.bezeichnung || `Gerät ${z.anlageId || ''}`)}</td><td>${esc(dat(alt.naechstesDatum || alt.faelligAm || (typeof alt === 'string' ? alt : '')))}</td><td>${esc(dat(neu.naechstesDatum || neu.faelligAm || (typeof neu === 'string' ? neu : '')))}</td></tr>`; }).join('')}</tbody></table></div>`
      : '<p>Derzeit stammt keine Frist eines Geräts aus dieser Vorlage – es gibt nichts umzustellen.</p>',
    fuss: `<button class="btn ghost" type="button" data-zu>${zeilen.length ? 'Abbrechen' : 'Schließen'}</button>${zeilen.length ? '<button class="btn primary" type="button" data-anw>Jetzt anwenden</button>' : ''}` });
  const b = $('[data-anw]', d.el);
  if (b) b.addEventListener('click', async () => { try { await post(`/fuhrpark/vorlagen/${v.id}/anwenden`, {}); fertig(ctx, d, 'Vorlage angewendet.'); } catch (x) { toast(x.message, 'warn'); } });
}
