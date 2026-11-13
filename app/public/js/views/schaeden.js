// Schäden: Schadensmeldung mit Fotos (alle Rollen, groß und einfach am Handy), Liste, Detail mit Galerie und Bearbeitung.
// Fotos werden am Gerät verkleinert (ohne EXIF/GPS) und einzeln hochgeladen; ohne Netz wartet die Meldung in IndexedDB.
import { get, put, post, del } from '../api.js';
import { ic, esc, fmt, leer, banner, dialog, bestaetigen, toast, speicher, $, $$ } from '../ui.js';
import { neueClientId, schadenMerken, schadenEntfernen, schadenWarteschlange, schadenSenden, schadenNachsenden, schadenVorlaeufig, bildVerkleinern } from '../schaden-offline.js';
import { KLASSE, EINTRAG_ART, liste as arr, eintragDialog } from './fuhrpark-dialoge.js';

export const S_ART = { defekt: 'Defekt', verschleiss: 'Verschleiß', unfall: 'Unfall', beschaedigung_dritte: 'Beschädigung durch Dritte', sonstiges: 'Sonstiges' };
export const S_EINSATZ = { ja: ['Einsatzfähig', 'st-green', 'check'], eingeschraenkt: ['Eingeschränkt einsatzfähig', 'st-amber', 'alert'], nein: ['Nicht einsatzfähig', 'st-red', 'lock'] };
export const S_STATUS = { gemeldet: ['Gemeldet', 'st-blue'], in_bearbeitung: ['In Bearbeitung', 'st-amber'], behoben: ['Behoben', 'st-green'], abgelehnt: ['Abgelehnt', 'st-grey'] };
const MAX_FOTOS = 5;
export const sStatusChip = (s) => { const [t, c] = S_STATUS[s] || [s, 'st-grey']; return `<span class="chip ${c}" data-schaden-status="${esc(s)}"><i class="dot"></i>${esc(t)}</span>`; };
const einsatzChip = (e, cls = 'xs') => { const [t, c, i] = S_EINSATZ[e] || [e, 'st-grey', 'info']; return `<span class="chip ${cls} ${c}">${ic(i)}${esc(t)}</span>`; };
const geraetName = (s) => (s.anlage ? `${s.anlage.bezeichnung}${s.anlage.kennzeichen ? ' · ' + s.anlage.kennzeichen : ''}` : s.fremdGeraet || 'Gerät');
const offen = (s) => s.status === 'gemeldet' || s.status === 'in_bearbeitung';
const fotoUrl = (s, f) => f.url || `/api/fuhrpark/schaeden/${s.id}/fotos/${f.id}`;
const darfAlle = (ctx) => ctx.kann('fuhrpark') || ['buero', 'gf'].includes(ctx.ich.benutzer.rolle);
const weiteSicht = (ctx) => darfAlle(ctx) || ['bauleiter', 'polier'].includes(ctx.ich.benutzer.rolle);

/* ---------- kleine Abfragen für andere Ansichten ---------- */
export const schaedenFuerAnlage = (id) => get(`/fuhrpark/schaeden?anlageId=${id}`).catch(() => []);
// Zahl am Reiter: offene Schäden im eigenen Sichtbereich plus Meldungen, die noch auf Verbindung warten
export async function schadenZahl(ctx) {
  const [liste, warten] = await Promise.all([get('/fuhrpark/schaeden').catch(() => []), schadenWarteschlange(ctx.ich.benutzer.id)]);
  return arr(liste).filter(offen).length + warten.length;
}
// Zeile in der Servicebuch-Zeitleiste einer Anlage
export const schadenZeile = (s, datum) => `<li class="tl-schaden" data-typ="schaden" data-schaden="${s.id}" tabindex="0" role="button" aria-label="Schadensmeldung öffnen"><time datetime="${esc(datum)}">${datum ? esc(fmt.datum(datum)) : ''}</time><i>${ic('camera')}</i><div class="sb-body">
  <div class="sb-kopf"><b>${esc(s.ursache || '')}</b><span class="chip xs st-outline">Schaden · ${esc(S_ART[s.art] || s.art || '')}</span>${einsatzChip(s.einsatzfaehig)}${sStatusChip(s.status).replace('class="chip ', 'class="chip xs ')}</div>
  <small>gemeldet von ${esc((s.gemeldetVon && s.gemeldetVon.name) || '–')}${arr(s.fotos).length ? ` · ${arr(s.fotos).length} Foto${arr(s.fotos).length > 1 ? 's' : ''}` : ''}${s.eintrag ? ` · Reparatur: ${esc(s.eintrag.titel)}` : ''}</small></div></li>`;

/* =================== Schaden melden =================== */
// Ablauf: 1 Gerät · 2 Fotos · 3 Was ist passiert? · 4 Einsatzfähig? → senden
export function schadenMelden(ctx, { anlage = null, anlagen = null, baustelleId = null } = {}) {
  const ich = ctx.ich.benutzer.id;
  const zuletztIds = speicher.lies('bt_schaden_zuletzt', []);
  const m = { anlage, fremd: '', fotos: [], art: '', ursache: '', beschreibung: '', einsatz: '', baustelleId };
  let schritt = anlage ? 2 : 1;
  let alle = anlagen, baustellen = [], sendet = false, liest = 0;
  const d = dialog({ titel: 'Schaden melden', breit: true, inhalt: '<div id="sm"></div>' });
  d.el.id = 'schaden-dlg';
  d.el.classList.add('voll');
  const box = $('#sm', d.el);
  // Baustelle: aus der laufenden Stempelung vorbelegen, sonst die eigene Baustelle
  Promise.all([get('/baustellen').catch(() => speicher.lies('bt_baustellen', [])), baustelleId == null ? get('/zeit/status').catch(() => speicher.lies('bt_status')) : null]).then(([bs, st]) => {
    baustellen = arr(bs).filter((b) => !b.status || b.status !== 'abgeschlossen');
    if (m.baustelleId == null && st && st.status && st.status !== 'aus' && st.baustelleId != null) m.baustelleId = st.baustelleId;
    if (m.baustelleId == null && m.anlage && m.anlage.standort && m.anlage.standort.baustelleId) m.baustelleId = m.anlage.standort.baustelleId;
    if (m.baustelleId == null) { const eig = (ctx.ich.baustellenIds || []).find((id) => baustellen.some((b) => b.id === id)); if (eig != null) m.baustelleId = eig; }
    if (schritt === 4 && d.el.isConnected) zeichne();
  });
  const NAMEN = ['Gerät', 'Fotos', 'Was ist passiert?', 'Einsatzfähig?'];
  const kopf = () => `<ol class="mm-steps vier" aria-label="Schritte">${NAMEN.map((s, i) => `<li class="${i + 1 === schritt ? 'on' : i + 1 < schritt ? 'done' : ''}"${i + 1 === schritt ? ' aria-current="step"' : ''}><i>${i + 1}</i><span>${s}</span></li>`).join('')}</ol>`;
  const geraetBox = () => `<div class="mm-geraet">${ic('truck')}<span><b>${esc(m.anlage ? m.anlage.bezeichnung : m.fremd)}</b><small>${esc(m.anlage ? m.anlage.kennzeichen || m.anlage.nummer || '' : 'anderes Gerät')}</small></span>${anlage ? '' : '<button type="button" class="btn ghost sm" data-sm-geh="1">Ändern</button>'}</div>`;
  const zeile = (a) => `<button type="button" class="pick-row" data-sm-anlage="${a.id}"><span class="site-ic">${ic(a.gesperrt ? 'lock' : 'truck')}</span><span class="pick-txt"><small>${esc([a.nummer, KLASSE[a.klasse]].filter(Boolean).join(' · '))}</small><b>${esc(a.bezeichnung)}</b><span>${esc(a.kennzeichen || '')}</span></span>${ic('right')}</button>`;
  const fuss = (weiter, text = 'Weiter') => `<div class="sm-fuss">${schritt > (anlage ? 2 : 1) ? `<button type="button" class="btn ghost lg" data-sm-geh="${schritt - 1}">${ic('left')}Zurück</button>` : ''}<button type="button" class="btn primary lg grow" ${weiter}>${text}</button></div>`;

  function zeichne() {
    if (schritt === 1) {
      box.innerHTML = `${kopf()}<label class="search"><span>${ic('truck')}</span><input type="search" id="sm-suche" placeholder="Gerät oder Kennzeichen suchen" aria-label="Gerät suchen" autocomplete="off"></label>
        <div id="sm-liste">${alle ? '' : '<div class="state small"><span class="spinner"></span></div>'}</div>
        <div class="sm-fremd"><button type="button" class="pick-row" data-sm-fremd-auf><span class="site-ic">${ic('plus')}</span><span class="pick-txt"><b>Anderes Gerät</b><span>nicht in der Liste, Mietgerät oder Gerät einer Fremdfirma</span></span>${ic('right')}</button>
          <div id="sm-fremd-feld" ${m.fremd ? '' : 'hidden'}><label class="field"><span class="field-label">Welches Gerät?</span><input class="input lg" id="sm-fremd" maxlength="200" value="${esc(m.fremd)}" placeholder="z. B. Mietbagger Kubota KX057, Fa. Muster"></label><p class="form-err" role="alert" hidden></p>${fuss('data-sm-fremd-ok')}</div></div>`;
      const fuelle = () => {
        const q = ($('#sm-suche', box).value || '').trim().toLowerCase();
        const l = (alle || []).filter((a) => a.status !== 'ausgeschieden');
        const sicht = l.filter((a) => !q || `${a.bezeichnung} ${a.kennzeichen || ''} ${a.nummer || ''}`.toLowerCase().includes(q));
        const zuletzt = q ? [] : zuletztIds.map((id) => l.find((a) => a.id === id)).filter(Boolean);
        const meine = q ? [] : l.filter((a) => a.verantwortlich && a.verantwortlich.id === ich && !zuletzt.includes(a));
        const gruppe = (t, x, id) => (x.length ? `<h3 class="list-label">${t}</h3><div class="pick-list" id="${id}">${x.map(zeile).join('')}</div>` : '');
        $('#sm-liste', box).innerHTML = gruppe('Zuletzt verwendet', zuletzt, 'sm-zuletzt') + gruppe('Meine Fahrzeuge', meine, 'sm-meine') + (sicht.length ? gruppe(zuletzt.length || meine.length ? 'Alle Geräte' : 'Geräte', sicht, 'sm-alle') : '<div class="state empty small"><p>Kein Gerät gefunden – unten „Anderes Gerät“ wählen.</p></div>');
      };
      $('#sm-suche', box).addEventListener('input', fuelle);
      if (alle) fuelle(); else get('/fuhrpark/anlagen').then((l) => { alle = l; if (schritt === 1 && d.el.isConnected) fuelle(); }).catch(() => { $('#sm-liste', box).innerHTML = banner('info', 'Die Geräteliste ist ohne Verbindung nicht abrufbar. Bitte unten „Anderes Gerät“ wählen und das Gerät beschreiben.'); });
    } else if (schritt === 2) {
      box.innerHTML = `${kopf()}${geraetBox()}
        <p class="sm-frage">Fotos vom Schaden <small>(bis zu ${MAX_FOTOS}, empfohlen)</small></p>
        <div class="sm-fotos" id="sm-fotos" aria-live="polite">${m.fotos.map((f, i) => `<figure class="sm-foto" data-foto="${i}"><img src="${f.daten}" alt="Foto ${i + 1}"><button type="button" class="icon-btn sm" data-sm-foto-weg="${i}" aria-label="Foto ${i + 1} entfernen">${ic('x')}</button><figcaption>${esc(fmt.zahl(f.groesse / 1024, 0))} kB</figcaption></figure>`).join('')}${liest ? `<div class="sm-foto laedt"><span class="spinner"></span></div>` : ''}</div>
        <div class="sm-foto-akt">
          <label class="act-btn${m.fotos.length >= MAX_FOTOS ? ' aus' : ''}">${ic('camera')}Foto aufnehmen<input type="file" class="vh" id="sm-kamera" accept="image/*" capture="environment" multiple ${m.fotos.length >= MAX_FOTOS ? 'disabled' : ''}></label>
          <label class="act-btn${m.fotos.length >= MAX_FOTOS ? ' aus' : ''}">${ic('file')}Aus Galerie wählen<input type="file" class="vh" id="sm-galerie" accept="image/*" multiple ${m.fotos.length >= MAX_FOTOS ? 'disabled' : ''}></label>
        </div>
        <p class="muted sm">${ic('info', 'xs')} Fotos werden vor dem Senden verkleinert. Aufnahmeort und andere Bilddaten (EXIF/GPS) werden dabei entfernt.</p>
        <p class="form-err" role="alert" hidden></p>${fuss('data-sm-geh="3"', m.fotos.length ? 'Weiter' : 'Weiter ohne Foto')}`;
    } else if (schritt === 3) {
      box.innerHTML = `${kopf()}${geraetBox()}
        <fieldset><legend class="sm-frage">Art des Schadens</legend><div class="sm-arten" role="radiogroup" aria-label="Art des Schadens">${Object.entries(S_ART).map(([k, t]) => `<button type="button" class="chip-btn gross${m.art === k ? ' on' : ''}" role="radio" aria-checked="${m.art === k}" data-sm-art="${k}">${t}</button>`).join('')}</div></fieldset>
        <label class="field"><span class="sm-frage">Ursache – wie ist es passiert?</span><textarea class="input area mm-text" id="sm-ursache" rows="3" maxlength="2000" placeholder="z. B. Beim Rückwärtsfahren am Bordstein hängen geblieben, Hydraulikschlauch am Ausleger abgerissen.">${esc(m.ursache)}</textarea></label>
        <label class="field"><span class="field-label">Was ist beschädigt? (freiwillig)</span><textarea class="input area" id="sm-beschr" rows="2" maxlength="4000" placeholder="z. B. Schlauch links, Öl tritt aus; Kotflügel verbogen">${esc(m.beschreibung)}</textarea></label>
        <p class="form-err" role="alert" hidden></p>${fuss('data-sm-weiter3')}`;
    } else {
      box.innerHTML = `${kopf()}${geraetBox()}
        <fieldset><legend class="sm-frage">Kann das Gerät weiter verwendet werden?</legend><div class="mm-dring" role="radiogroup" aria-label="Einsatzfähig?">
          <button type="button" class="mm-d gruen${m.einsatz === 'ja' ? ' on' : ''}" role="radio" aria-checked="${m.einsatz === 'ja'}" data-sm-einsatz="ja">${ic('check')}<span><b>Ja</b><small>Gerät kann normal weiterarbeiten</small></span></button>
          <button type="button" class="mm-d amber${m.einsatz === 'eingeschraenkt' ? ' on' : ''}" role="radio" aria-checked="${m.einsatz === 'eingeschraenkt'}" data-sm-einsatz="eingeschraenkt">${ic('alert')}<span><b>Eingeschränkt</b><small>Nur mit Vorsicht bzw. nicht für alle Arbeiten</small></span></button>
          <button type="button" class="mm-d red${m.einsatz === 'nein' ? ' on' : ''}" role="radio" aria-checked="${m.einsatz === 'nein'}" data-sm-einsatz="nein">${ic('lock')}<span><b>Nein – Gerät stilllegen</b><small>Darf nicht mehr verwendet werden</small></span></button>
        </div></fieldset>
        <div id="sm-warn" ${m.einsatz === 'nein' ? '' : 'hidden'}>${banner('err', m.anlage ? '<b>Das Gerät wird sofort gesperrt.</b> Büro, Werkstatt und Bauleitung werden verständigt. Bitte das Gerät abstellen und gegen Benutzung sichern.' : '<b>Bitte das Gerät sofort abstellen</b> und gegen Benutzung sichern. Büro und Werkstatt werden verständigt.', 'lock')}</div>
        <label class="field"><span class="field-label">Baustelle</span><select class="input lg" id="sm-baustelle"><option value="">– keine / Bauhof –</option>${baustellen.map((b) => `<option value="${b.id}" ${m.baustelleId === b.id ? 'selected' : ''}>${esc((b.kst ? b.kst + ' · ' : '') + b.name)}</option>`).join('')}</select></label>
        <div id="sm-fortschritt" hidden><div class="sm-prog"><span class="meter"><i data-st="width:0%"></i></span><small id="sm-prog-text" role="status">Wird gesendet …</small></div></div>
        <p class="form-err" role="alert" hidden></p>${fuss('data-sm-senden', `${ic('check')}Schaden melden`)}`;
    }
  }
  const fehler = (t) => { const e = $$('.form-err', box).pop(); if (e) { e.hidden = false; e.textContent = t; e.scrollIntoView({ block: 'nearest' }); } };
  const merkEingaben = () => { const u = $('#sm-ursache', box), b = $('#sm-beschr', box), bs = $('#sm-baustelle', box); if (u) m.ursache = u.value; if (b) m.beschreibung = b.value; if (bs) m.baustelleId = bs.value ? Number(bs.value) : null; };

  async function fotosDazu(dateien) {
    const frei = MAX_FOTOS - m.fotos.length;
    const l = [...dateien].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
    if (!l.length) { fehler('Bitte ein Foto (Bilddatei) auswählen.'); return; }
    const zuViel = l.length > frei;
    liest = Math.min(l.length, frei); zeichne();
    const fehlerhaft = [];
    for (const f of l.slice(0, frei)) {
      try { m.fotos.push(await bildVerkleinern(f)); } catch (x) { fehlerhaft.push(f.name || 'Foto'); }
      liest--; if (schritt === 2) zeichne();
    }
    liest = 0; if (schritt === 2) zeichne();
    if (fehlerhaft.length) fehler(`Nicht lesbar: ${fehlerhaft.join(', ')}. Bitte ein anderes Foto wählen (JPEG oder PNG).`);
    else if (zuViel) fehler(`Es sind höchstens ${MAX_FOTOS} Fotos möglich – die übrigen wurden nicht übernommen.`);
  }
  async function senden() {
    if (sendet) return;
    merkEingaben();
    if (!m.einsatz) { fehler('Bitte auswählen, ob das Gerät weiter verwendet werden kann.'); return; }
    if (m.einsatz === 'nein' && !(await bestaetigen('Gerät wirklich stilllegen?', `„${m.anlage ? m.anlage.bezeichnung : m.fremd}“ wird als nicht einsatzfähig gemeldet${m.anlage ? ' und sofort gesperrt' : ''}. Büro und Werkstatt werden verständigt.`, 'Ja, stilllegen', 'danger'))) return;
    sendet = true;
    $$('.sm-fuss .btn, [data-sm-einsatz], [data-sm-geh]', box).forEach((b) => { b.disabled = true; });
    const body = { art: m.art, ursache: m.ursache.trim(), einsatzfaehig: m.einsatz, zeitpunkt: new Date().toISOString() };
    if (m.anlage) body.anlageId = m.anlage.id; else body.fremdGeraet = m.fremd.trim();
    if (m.beschreibung.trim()) body.beschreibung = m.beschreibung.trim();
    if (m.baustelleId != null) body.baustelleId = m.baustelleId;
    const e = { clientId: neueClientId(), benutzerId: ich, erstellt: body.zeitpunkt, geraet: m.anlage ? m.anlage.bezeichnung : m.fremd.trim(), body, fotos: m.fotos.map((f) => ({ daten: f.daten, dateiname: f.dateiname, gesendet: false })), zustand: 'wartet' };
    // Zuerst am Gerät sichern – erst dann senden. So geht nichts verloren, wenn die Verbindung abreißt.
    let gemerkt = true;
    try { await schadenMerken(e); } catch (x) { gemerkt = false; }
    if (m.anlage) speicher.setz('bt_schaden_zuletzt', [m.anlage.id, ...zuletztIds.filter((id) => id !== m.anlage.id)].slice(0, 4));
    const pr = $('#sm-fortschritt', box); pr.hidden = false;
    const fortschritt = (n, ges) => { const i = $('.meter i', pr); if (i) i.style.width = `${Math.round((n / ges) * 100)}%`; const t = $('#sm-prog-text', pr); if (t) t.textContent = n === 0 ? 'Meldung wird gesendet …' : n < ges ? `Foto ${n} von ${ges - 1} wird hochgeladen …` : 'Fertig.'; };
    try {
      const r = await schadenSenden(e, fortschritt, gemerkt);
      d.zu(true);
      toast(r.fotoFehler.length ? `Schaden gemeldet – ${r.fotoFehler.length} Foto${r.fotoFehler.length > 1 ? 's' : ''} konnte${r.fotoFehler.length > 1 ? 'n' : ''} nicht übernommen werden.` : m.einsatz === 'nein' && m.anlage ? 'Schaden gemeldet – Gerät ist gesperrt.' : 'Schaden gemeldet. Danke!', r.fotoFehler.length ? 'warn' : 'ok');
      ctx.meldungenNeu(); if (ctx.aktuell()) ctx.neuLaden();
    } catch (x) {
      if (schadenVorlaeufig(x) && gemerkt) {
        d.zu(true);
        toast('Keine Verbindung – die Meldung ist am Gerät gespeichert und wird automatisch gesendet.', 'warn');
        if (ctx.aktuell()) ctx.neuLaden();
      } else {
        if (gemerkt) await schadenEntfernen(e.clientId).catch(() => {});
        sendet = false; pr.hidden = true;
        $$('.sm-fuss .btn, [data-sm-einsatz], [data-sm-geh]', box).forEach((b) => { b.disabled = false; });
        fehler(schadenVorlaeufig(x) ? 'Keine Verbindung – die Meldung konnte nicht gesendet und am Gerät nicht gespeichert werden. Bitte später noch einmal versuchen.' : x.message);
      }
    }
  }
  box.addEventListener('change', (e) => { if (e.target.id === 'sm-kamera' || e.target.id === 'sm-galerie') { const f = e.target.files; if (f && f.length) fotosDazu(f); } });
  box.addEventListener('click', (e) => {
    const a = e.target.closest('[data-sm-anlage]');
    if (a) { m.anlage = alle.find((x) => String(x.id) === a.dataset.smAnlage); m.fremd = ''; schritt = 2; zeichne(); return; }
    if (e.target.closest('[data-sm-fremd-auf]')) { $('#sm-fremd-feld', box).hidden = false; $('#sm-fremd', box).focus(); return; }
    if (e.target.closest('[data-sm-fremd-ok]')) { const v = $('#sm-fremd', box).value.trim(); if (v.length < 3) { fehler('Bitte das Gerät kurz beschreiben (mindestens 3 Zeichen).'); return; } m.fremd = v; m.anlage = null; schritt = 2; zeichne(); return; }
    const weg = e.target.closest('[data-sm-foto-weg]');
    if (weg) { m.fotos.splice(Number(weg.dataset.smFotoWeg), 1); zeichne(); return; }
    const art = e.target.closest('[data-sm-art]');
    if (art) { merkEingaben(); m.art = art.dataset.smArt; $$('[data-sm-art]', box).forEach((b) => { const an = b === art; b.classList.toggle('on', an); b.setAttribute('aria-checked', an); }); return; }
    const es = e.target.closest('[data-sm-einsatz]');
    if (es && !es.disabled) { m.einsatz = es.dataset.smEinsatz; $$('[data-sm-einsatz]', box).forEach((b) => { const an = b === es; b.classList.toggle('on', an); b.setAttribute('aria-checked', an); }); $('#sm-warn', box).hidden = m.einsatz !== 'nein'; return; }
    if (e.target.closest('[data-sm-weiter3]')) {
      merkEingaben();
      if (!m.art) { fehler('Bitte die Art des Schadens antippen.'); return; }
      if (m.ursache.trim().length < 10) { fehler('Bitte die Ursache kurz beschreiben (mindestens 10 Zeichen) – das hilft der Werkstatt und der Versicherung.'); $('#sm-ursache', box).focus(); return; }
      schritt = 4; zeichne(); return;
    }
    if (e.target.closest('[data-sm-senden]')) { senden(); return; }
    const g = e.target.closest('[data-sm-geh]');
    if (g && !g.disabled) { if (liest) return; merkEingaben(); schritt = Number(g.dataset.smGeh); zeichne(); }
  });
  zeichne();
  return d.geschlossen;
}

/* =================== Liste (Reiter „Schäden“) =================== */
export async function schaedenReiter(el, ctx, kopf) {
  const ich = ctx.ich.benutzer.id;
  const weit = weiteSicht(ctx);
  let [liste, warten] = await Promise.all([get('/fuhrpark/schaeden'), schadenWarteschlange(ich)]);
  liste = arr(liste);
  const f = { status: ctx.query.get('status') || '', anlage: '', baustelle: '', art: '', von: '', bis: '' };
  const passt = (s) => (!f.status || (f.status === 'offen' ? offen(s) : s.status === f.status)) && (!f.anlage || (f.anlage === 'fremd' ? !s.anlageId : String(s.anlageId) === f.anlage))
    && (!f.baustelle || String(s.baustelleId) === f.baustelle) && (!f.art || s.art === f.art)
    && (!f.von || String(s.zeitpunkt || s.gemeldet).slice(0, 10) >= f.von) && (!f.bis || String(s.zeitpunkt || s.gemeldet).slice(0, 10) <= f.bis);
  const einzig = (key, text) => [...new Map(liste.filter((s) => s[key] != null).map((s) => [s[key], text(s)])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'de'));
  const zeit = (s) => fmt.zeitpunkt(s.zeitpunkt || s.gemeldet);
  const daumen = (s) => (arr(s.fotos).length ? `<span class="sch-thumb"><img src="${esc(fotoUrl(s, s.fotos[0]))}" alt="" loading="lazy">${s.fotos.length > 1 ? `<i>${s.fotos.length}</i>` : ''}</span>` : `<span class="sch-thumb leer">${ic('camera')}</span>`);

  function wartenHtml() {
    if (!warten.length) return '';
    return `<section class="card" id="sch-warten" aria-labelledby="h-warten"><div class="card-h pad-h"><h3 id="h-warten">${ic('wifiOff')}Noch nicht gesendet <span class="count red">${warten.length}</span></h3><button type="button" class="btn ghost sm" data-sch-senden>${ic('sync')}Jetzt senden</button></div>
      <ul class="plain rows">${warten.map((w) => `<li data-wartet="${esc(w.clientId)}" data-zustand="${esc(w.zustand || 'wartet')}"><span class="grow"><b>${esc(w.geraet || 'Gerät')}</b><small>${esc(w.body.ursache || '')}</small><small>${esc(fmt.zeitpunkt(w.erstellt))} · ${w.fotos.length} Foto${w.fotos.length === 1 ? '' : 's'}${w.zustand === 'fehler' ? ` · <span class="abg-grund">Vom Server abgelehnt: ${esc(w.grund || '')}</span>` : ''}</small></span>
        ${w.zustand === 'fehler' ? `<button type="button" class="btn ghost sm" data-sch-verwerfen="${esc(w.clientId)}">Verwerfen</button>` : `<span class="chip st-amber">${ic('wifiOff')}wartet auf Verbindung</span>`}</li>`).join('')}</ul>
      <p class="card-note">Diese Meldungen sind samt Fotos am Gerät gespeichert und werden automatisch gesendet, sobald Verbindung besteht. Nichts wird doppelt gemeldet.</p></section>`;
  }
  function listeHtml() {
    const sicht = liste.filter(passt);
    if (!sicht.length) return `<div class="card">${leer(liste.length ? 'Keine Schadensmeldung passt zum Filter.' : weit ? 'Es wurden noch keine Schäden gemeldet.' : 'Sie haben noch keinen Schaden gemeldet.', 'camera')}</div>`;
    return `<div class="sch-karten">${sicht.map((s) => `<button type="button" class="card sch-karte" data-schaden="${s.id}" data-status="${esc(s.status)}">${daumen(s)}<span class="sch-txt"><small>${esc(zeit(s))}${s.baustelle ? ' · ' + esc(s.baustelle.name) : ''}</small><b>${esc(geraetName(s))}</b><span>${esc(S_ART[s.art] || '')} · ${esc(s.ursache || '')}</span><span class="sch-chips">${sStatusChip(s.status)}${einsatzChip(s.einsatzfaehig, '')}</span></span></button>`).join('')}</div>
      <div class="card sch-tabelle"><div class="tbl-wrap"><table class="tbl" id="sch-tbl"><thead><tr><th></th><th>Gemeldet</th><th>Gerät</th><th>Art / Ursache</th><th class="sp-standort">Baustelle</th><th>Gemeldet von</th><th>Einsatzfähig</th><th>Status</th></tr></thead><tbody>
      ${sicht.map((s) => `<tr data-schaden="${s.id}" data-status="${esc(s.status)}" tabindex="0"><td>${daumen(s)}</td><td class="nw">${esc(zeit(s))}</td><td class="main">${esc(geraetName(s))}${s.anlage ? '' : '<small>anderes Gerät</small>'}</td><td><b>${esc(S_ART[s.art] || '')}</b><small class="sch-urs">${esc(s.ursache || '')}</small></td><td class="sp-standort">${esc((s.baustelle && s.baustelle.name) || '–')}</td><td>${esc((s.gemeldetVon && s.gemeldetVon.name) || '')}</td><td>${einsatzChip(s.einsatzfaehig)}</td><td>${sStatusChip(s.status)}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  }
  function zeichne() {
    el.innerHTML = `<div class="page fp-page">${kopf()}
      <button type="button" class="punch out sch-melden" data-akt="schaden"><span class="punch-ic">${ic('camera')}</span><span><b>Schaden melden</b><small>Mit Fotos – dauert eine Minute</small></span></button>
      <div id="sch-warten-box">${wartenHtml()}</div>
      ${weit && liste.length ? `<div class="toolbar fp-filter" id="sch-filter">
        <label class="field inline"><span class="vh">Status</span><select class="input" data-f="status" aria-label="Status"><option value="">Alle Zustände</option><option value="offen" ${f.status === 'offen' ? 'selected' : ''}>Offen (gemeldet / in Bearbeitung)</option>${Object.entries(S_STATUS).map(([k, [t]]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="field inline"><span class="vh">Gerät</span><select class="input" data-f="anlage" aria-label="Gerät"><option value="">Alle Geräte</option>${einzig('anlageId', (s) => geraetName(s)).map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}${liste.some((s) => !s.anlageId) ? '<option value="fremd">Andere Geräte</option>' : ''}</select></label>
        <label class="field inline"><span class="vh">Baustelle</span><select class="input" data-f="baustelle" aria-label="Baustelle"><option value="">Alle Baustellen</option>${einzig('baustelleId', (s) => (s.baustelle && s.baustelle.name) || `Baustelle ${s.baustelleId}`).map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select></label>
        <label class="field inline"><span class="vh">Art</span><select class="input" data-f="art" aria-label="Art des Schadens"><option value="">Alle Arten</option>${Object.entries(S_ART).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
        <label class="field inline sch-datum"><span>von</span><input class="input" type="date" data-f="von" aria-label="Zeitraum von"></label>
        <label class="field inline sch-datum"><span>bis</span><input class="input" type="date" data-f="bis" aria-label="Zeitraum bis"></label>
      </div>` : ''}
      ${!weit ? '<h3 class="list-label">Meine Meldungen</h3>' : ''}
      <div id="sch-liste">${listeHtml()}</div></div>`;
  }
  const neuWarten = async () => { warten = await schadenWarteschlange(ich); const b = $('#sch-warten-box', el); if (b) b.innerHTML = wartenHtml(); };
  const aufGesendet = () => { if (ctx.aktuell()) ctx.neuLaden(); };
  window.addEventListener('bt:schaden', neuWarten);
  window.addEventListener('bt:schaden-gesendet', aufGesendet);
  el.addEventListener('change', (e) => { const k = e.target.dataset && e.target.dataset.f; if (!k) return; f[k] = e.target.value; $('#sch-liste', el).innerHTML = listeHtml(); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('tr[data-schaden]')) schadenOeffnen(ctx, e.target.dataset.schaden); });
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-akt="schaden"]')) { schadenMelden(ctx); return; }
    if (e.target.closest('[data-sch-senden]')) { const n = await schadenNachsenden(ich); if (!n) { toast('Noch keine Verbindung – die Meldungen bleiben gespeichert.', 'warn'); neuWarten(); } return; }
    const v = e.target.closest('[data-sch-verwerfen]');
    if (v) { if (await bestaetigen('Meldung verwerfen?', 'Die Meldung wurde vom Server nicht angenommen. Sie wird samt Fotos vom Gerät gelöscht.', 'Verwerfen', 'danger')) { await schadenEntfernen(v.dataset.schVerwerfen); } return; }
    const s = e.target.closest('[data-schaden]');
    if (s) schadenOeffnen(ctx, s.dataset.schaden);
  });
  zeichne();
  const direkt = ctx.query.get('schaden');
  if (direkt) { history.replaceState(null, '', '#/fuhrpark?reiter=schaeden'); schadenOeffnen(ctx, direkt); }
  if (warten.length) schadenNachsenden(ich);
  return () => { window.removeEventListener('bt:schaden', neuWarten); window.removeEventListener('bt:schaden-gesendet', aufGesendet); };
}

/* =================== Detail mit Galerie und Bearbeitung =================== */
function lichtkasten(s, start) {
  const fotos = arr(s.fotos);
  let i = start;
  const d = dialog({ titel: `Foto ${i + 1} von ${fotos.length}`, breit: true, inhalt: '<div class="lb"></div>' });
  d.el.id = 'lichtkasten'; d.el.classList.add('lb-dlg');
  const zeig = (n) => {
    i = (n + fotos.length) % fotos.length;
    $('h2', d.el).textContent = `Foto ${i + 1} von ${fotos.length}`;
    $('.lb', d.el).innerHTML = `${fotos.length > 1 ? `<button type="button" class="icon-btn lb-nav" data-lb="-1" aria-label="Vorheriges Foto">${ic('left')}</button>` : ''}<img src="${esc(fotoUrl(s, fotos[i]))}" alt="Foto ${i + 1} zum Schaden an ${esc(geraetName(s))}">${fotos.length > 1 ? `<button type="button" class="icon-btn lb-nav" data-lb="1" aria-label="Nächstes Foto">${ic('right')}</button>` : ''}`;
  };
  d.el.addEventListener('click', (e) => { const b = e.target.closest('[data-lb]'); if (b) zeig(i + Number(b.dataset.lb)); });
  d.el.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') zeig(i - 1); if (e.key === 'ArrowRight') zeig(i + 1); });
  zeig(i);
}
export async function schadenOeffnen(ctx, id) {
  let s;
  try { s = await get(`/fuhrpark/schaeden/${id}`); }
  catch (x) { toast(x.status === 403 || x.status === 404 ? 'Diese Schadensmeldung ist für Sie nicht einsehbar.' : x.message, 'warn'); return; }
  const d = dialog({ titel: 'Schadensmeldung', breit: true, inhalt: '<div id="sd"></div>' });
  d.el.id = 'schaden-detail';
  const box = $('#sd', d.el);
  let geaendert = false;
  let modus = ''; // '' | 'behoben' | 'abgelehnt'
  let eintraege = null;
  const zeile = (t, w) => (w ? `<div><dt>${t}</dt><dd>${w}</dd></div>` : '');
  function zeichne() {
    const fotos = arr(s.fotos);
    const bearb = !!s.darfBearbeiten;
    box.innerHTML = `<div class="sd-kopf" data-status="${esc(s.status)}"><div><small>${esc(S_ART[s.art] || '')} · ${esc(fmt.zeitpunkt(s.zeitpunkt || s.gemeldet))}</small><h3>${s.anlageId ? `<a class="lnk" href="#/fuhrpark/anlage/${s.anlageId}">${esc(geraetName(s))}</a>` : esc(geraetName(s))}</h3></div><div class="sch-chips">${sStatusChip(s.status)}${einsatzChip(s.einsatzfaehig, '')}</div></div>
      ${fotos.length ? `<div class="sd-galerie" id="sd-galerie" aria-label="Fotos">${fotos.map((f, i) => `<figure><button type="button" data-foto="${i}" aria-label="Foto ${i + 1} vergrößern"><img src="${esc(fotoUrl(s, f))}" alt="Foto ${i + 1}" loading="lazy"></button>${bearb ? `<button type="button" class="icon-btn sm sd-foto-weg" data-foto-weg="${f.id}" aria-label="Foto ${i + 1} löschen">${ic('trash')}</button>` : ''}</figure>`).join('')}</div>` : '<p class="muted sm">Ohne Foto gemeldet.</p>'}
      ${s.darfFotos && fotos.length < MAX_FOTOS && offen(s) ? `<label class="btn ghost sm sd-foto-dazu">${ic('camera')}Foto nachreichen<input type="file" class="vh" id="sd-foto" accept="image/*" multiple></label>` : ''}
      <dl class="def-list sd-liste">
        ${zeile('Ursache', esc(s.ursache || ''))}${zeile('Beschädigt', esc(s.beschreibung || ''))}${zeile('Baustelle', s.baustelle ? esc((s.baustelle.kst ? s.baustelle.kst + ' · ' : '') + s.baustelle.name) : '')}
        ${zeile('Gemeldet von', `${esc((s.gemeldetVon && s.gemeldetVon.name) || '')}<small>${esc(fmt.zeitpunkt(s.gemeldet))}</small>`)}
        ${zeile('Bearbeitet', s.bearbeitet ? `${esc((s.bearbeitetVon && s.bearbeitetVon.name) || '')}<small>${esc(fmt.zeitpunkt(s.bearbeitet))}</small>` : '')}
        ${zeile('Kommentar der Werkstatt', esc(s.kommentar || ''))}
        ${s.eintrag ? zeile('Reparatur', `<span id="sd-eintrag">${esc(s.eintrag.titel)}<small>${esc((EINTRAG_ART[s.eintrag.art] || [s.eintrag.art])[0])} vom ${esc(fmt.datum(s.eintrag.datum))}${'kosten' in s.eintrag && s.eintrag.kosten != null ? ` · ${fmt.eur(s.eintrag.kosten)}` : ''}</small></span>`) : ''}
      </dl>
      ${bearb ? `<section class="sd-bearb" aria-label="Bearbeitung">
        ${modus === '' ? `<div class="sd-akt">
          ${s.status === 'gemeldet' ? `<button type="button" class="btn primary" data-sd="in_bearbeitung">${ic('wrench')}In Bearbeitung nehmen</button>` : ''}
          ${offen(s) ? `<button type="button" class="btn ${s.status === 'in_bearbeitung' ? 'primary' : 'ghost'}" data-sd-modus="behoben">${ic('check')}Behoben …</button><button type="button" class="btn ghost" data-sd-modus="abgelehnt">${ic('x')}Ablehnen …</button>` : `<button type="button" class="btn ghost" data-sd="in_bearbeitung">Wieder öffnen</button>`}
        </div>` : modus === 'behoben' ? `<form id="sd-f" class="stack-s"><h4 class="sub-h">Als behoben abschließen</h4>
          ${s.anlageId ? `<label class="field"><span class="field-label">Reparatur im Servicebuch</span><select class="input lg" name="eintragId"><option value="">– ohne Verknüpfung –</option>${arr(eintraege).filter((e) => !e.storniert).map((e) => `<option value="${e.id}" ${s.eintragId === e.id ? 'selected' : ''}>${esc(fmt.datum(e.datum))} · ${esc((EINTRAG_ART[e.art] || [e.art])[0])} · ${esc(e.titel)}</option>`).join('')}</select></label>
          ${ctx.kann('fuhrpark') ? `<button type="button" class="btn ghost sm" data-sd-neuer-eintrag>${ic('plus')}Reparatur jetzt neu erfassen</button>` : ''}` : ''}
          <label class="field"><span class="field-label">Kommentar (freiwillig)</span><textarea class="input area" name="kommentar" rows="2" maxlength="1000">${esc(s.kommentar || '')}</textarea></label>
          <p class="form-err" role="alert" hidden></p><div class="sd-akt"><button type="button" class="btn ghost" data-sd-modus="">Zurück</button><button type="submit" class="btn primary">${ic('check')}Als behoben speichern</button></div></form>`
        : `<form id="sd-f" class="stack-s"><h4 class="sub-h">Meldung ablehnen</h4><label class="field"><span class="field-label">Begründung (Pflicht)</span><textarea class="input area" name="kommentar" rows="3" maxlength="1000" required placeholder="z. B. kein Schaden, bereits gemeldet, normale Gebrauchsspur"></textarea></label>
          <p class="form-err" role="alert" hidden></p><div class="sd-akt"><button type="button" class="btn ghost" data-sd-modus="">Zurück</button><button type="submit" class="btn danger">Ablehnen</button></div></form>`}
      </section>` : ''}
      <p class="form-err sd-err" role="alert" hidden></p>`;
  }
  const fehler = (t) => { const e = $$('.form-err', box)[0] || $('.sd-err', box); const z = $('#sd-f .form-err', box) || $('.sd-err', box) || e; z.hidden = false; z.textContent = t; };
  async function speichere(body) {
    try { s = await put(`/fuhrpark/schaeden/${s.id}`, { version: s.version, ...body }); geaendert = true; modus = ''; zeichne(); toast('Schadensmeldung aktualisiert.'); ctx.meldungenNeu(); }
    catch (x) {
      if (x.status === 409) { try { s = await get(`/fuhrpark/schaeden/${s.id}`); zeichne(); } catch (y) { /* Anzeige bleibt */ } fehler('Inzwischen von jemand anderem geändert – der aktuelle Stand wurde geladen. Bitte noch einmal versuchen.'); }
      else fehler(x.netz ? 'Keine Verbindung zum Server.' : x.message);
    }
  }
  box.addEventListener('submit', (e) => {
    e.preventDefault(); const f = new FormData(e.target); const kommentar = (f.get('kommentar') || '').trim();
    if (modus === 'abgelehnt') { if (kommentar.length < 3) { fehler('Bitte kurz begründen, warum die Meldung abgelehnt wird.'); return; } speichere({ status: 'abgelehnt', kommentar }); }
    else speichere({ status: 'behoben', ...(kommentar ? { kommentar } : {}), ...(f.get('eintragId') ? { eintragId: Number(f.get('eintragId')) } : {}) });
  });
  box.addEventListener('change', async (e) => {
    if (e.target.id !== 'sd-foto' || !e.target.files.length) return;
    const frei = MAX_FOTOS - arr(s.fotos).length;
    try {
      for (const datei of [...e.target.files].slice(0, frei)) { const b = await bildVerkleinern(datei); await post(`/fuhrpark/schaeden/${s.id}/fotos`, { bildBase64: b.daten, dateiname: b.dateiname }); }
      s = await get(`/fuhrpark/schaeden/${s.id}`); geaendert = true; zeichne(); toast('Foto hinzugefügt.');
    } catch (x) { fehler(x.netz ? 'Keine Verbindung – das Foto wurde nicht hochgeladen.' : x.message); }
  });
  box.addEventListener('click', async (e) => {
    const fo = e.target.closest('[data-foto]'); if (fo) { lichtkasten(s, Number(fo.dataset.foto)); return; }
    const fw = e.target.closest('[data-foto-weg]');
    if (fw) { if (!(await bestaetigen('Foto löschen?', 'Das Foto wird endgültig entfernt.', 'Löschen', 'danger'))) return; try { await del(`/fuhrpark/schaeden/${s.id}/fotos/${fw.dataset.fotoWeg}`); s = await get(`/fuhrpark/schaeden/${s.id}`); geaendert = true; zeichne(); } catch (x) { fehler(x.message); } return; }
    const st = e.target.closest('[data-sd]'); if (st) { speichere({ status: st.dataset.sd }); return; }
    const mo = e.target.closest('[data-sd-modus]');
    if (mo) {
      modus = mo.dataset.sdModus;
      if (modus === 'behoben' && s.anlageId && eintraege == null) eintraege = await get(`/fuhrpark/eintraege?anlageId=${s.anlageId}`).catch(() => []);
      zeichne(); return;
    }
    if (e.target.closest('[data-sd-neuer-eintrag]')) {
      // Reparatur neu erfassen: der Eintrag setzt den Schaden selbst auf „behoben“ und verknüpft ihn
      try { const a = await get(`/fuhrpark/anlagen/${s.anlageId}`); d.zu(); eintragDialog(ctx, a, { maengel: a.maengel || [], schaeden: [s], vorgewaehlt: [s.id], art: 'reparatur' }); } catch (x) { fehler(x.message); }
    }
  });
  d.geschlossen.then(() => { if (geaendert && ctx.aktuell()) ctx.neuLaden(); });
  zeichne();
  return d.geschlossen;
}
