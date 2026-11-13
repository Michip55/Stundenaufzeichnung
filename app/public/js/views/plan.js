// Baustellenplaner (API.md 12.8) – nach dem freigegebenen Entwurf:
// Wochenplan (Baustellen × Tage, Ziehen & Ablegen mit Maus und Finger, Auswahl + „Einteilen“ als Tastatur-Weg),
// Geräte-Disposition, Projektzeitplan (eigene Datei), Handy „Mein Einsatz“ und Polier „Meine Partie“.
// Keine Preise in der Planung.
import { get, post, put, del } from '../api.js';
import { ic, esc, fmt, leer, banner, dialog, bestaetigen, toast, rolleText, speicher, $, $$ } from '../ui.js';
import { wienHeute, wienLokal } from '../zahl.js';
import { ziehbar } from '../ziehen.js';
import { zeitplanHtml, zeitplanLaden, zeitplanBinden } from './zeitplan.js';

export const montag = (iso) => { const w = fmt.dt(iso).getDay(); return fmt.addTage(iso, w === 0 ? -6 : 1 - w); };
export const kw = (iso) => { const d = fmt.dt(iso); const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const n = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - n); const j = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - j) / 86400000 + 1) / 7); };
const MONATE = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const tagKurz = (iso) => `${fmt.WTK[fmt.dt(iso).getDay()]} ${String(fmt.dt(iso).getDate()).padStart(2, '0')}.${String(fmt.dt(iso).getMonth() + 1).padStart(2, '0')}.`;
const wochenText = (a, b) => { const x = fmt.dt(a), y = fmt.dt(b); return `KW ${kw(a)} · ${x.getDate()}.${x.getMonth() === y.getMonth() ? '' : ' ' + MONATE[x.getMonth()]}–${y.getDate()}. ${MONATE[y.getMonth()]} ${y.getFullYear()}`; };
const eins = (r) => (r && r.einsatz) || r || {};
const KONFLIKT_KURZ = { person_doppelt: 'doppelt eingeteilt', abwesenheit: 'abwesend', anlage_doppelt: 'doppelt eingeteilt', anlage_gesperrt: 'gesperrt', anlage_faellig: 'Prüfung fällig', wetter: 'Wetter' };

export default async function plan(el, ctx) {
  const ich = ctx.ich.benutzer;
  const heute = wienHeute();
  const planer = ['buero', 'gf'].includes(ich.rolle) || ctx.kann('stammdaten');
  const eigene = (ctx.ich.baustellenIds || []).map(Number);
  const darfBs = (id) => planer || (ich.rolle === 'bauleiter' && eigene.includes(Number(id)));
  // nächster Arbeitstag („morgen“): Sa/So werden übersprungen
  const naechsterTag = (iso, schritt = 1) => { let t = fmt.addTage(iso, schritt); while ([0, 6].includes(fmt.dt(t).getDay())) t = fmt.addTage(t, schritt); return t; };
  const morgen = naechsterTag(heute);
  const stunde = Number(wienLokal(new Date().toISOString()).slice(11, 13));
  // Tagsüber (06–16 Uhr) geht es ums Einteilen für morgen – dann startet der Planer in der Tagesansicht
  let ansicht = ['woche', 'tag', 'zeitplan', 'geraete'].includes(ctx.query.get('ansicht')) ? ctx.query.get('ansicht') : planer && !ctx.query.get('datum') && stunde >= 6 && stunde < 16 ? 'tag' : 'woche';
  let mitWe = speicher.lies('bt_plan_we') === true;
  let tagWahl = ctx.query.get('datum') || (ansicht === 'tag' ? morgen : '');
  let von = montag(ctx.query.get('datum') || (ansicht === 'tag' ? morgen : speicher.lies('bt_plan_woche') || heute));
  let d = null, anfragen = [], suche = '', fehler = '';
  const wahl = new Map(); // Auswahl für „Einteilen“ ohne Ziehen: schluessel → {art, id, name, vonEinsatz?}
  let zp = null; // Projektzeitplan-Zustand

  async function lade() {
    fehler = '';
    try {
      d = await get(`/plan/woche?von=${von}&tage=${mitWe ? 7 : 5}`);
      von = d.von || von;
    } catch (e) { if (e.status === 401 || e.netz) throw e; fehler = e.status === 403 ? 'Kein Zugriff auf den Baustellenplaner.' : e.message; d = { tage: [], baustellen: [], einsaetze: [], frei: {}, konflikte: [], kennzahlen: {}, unveroeffentlicht: 0 }; }
    const tage = d.tage.map((t) => t.datum);
    if (!tage.includes(tagWahl)) tagWahl = tage.includes(morgen) ? morgen : tage.includes(heute) ? heute : tage[0] || von;
    anfragen = planer || ich.rolle === 'bauleiter' ? await get('/plan/anfragen?status=offen').catch(() => []) : [];
  }
  await lade();

  const einsatz = (datum, bsId) => d.einsaetze.find((e) => e.datum === datum && Number(e.baustelleId) === Number(bsId));
  const einsatzId = (id) => d.einsaetze.find((e) => Number(e.id) === Number(id));
  const konflikteVon = (e) => (d.konflikte || []).filter((k) => (k.einsatzIds || []).map(Number).includes(Number(e.id)));
  const bsName = (id) => { const b = d.baustellen.find((x) => Number(x.id) === Number(id)); return b ? b.kurz || b.name : 'Baustelle'; };

  /* ---------- Chips ---------- */
  const chipAttr = (art, id, name, e) => `data-chip="${art}" data-id="${id}" data-name="${esc(name)}"${e ? ` data-einsatz="${e.id}"` : ''}`;
  // Chip in einer Zelle: Text-Knopf (Details/Verschieben/Entfernen) + kleiner Notiz-Knopf; als Ganzes ziehbar
  function chip(art, id, name, e, schreib, { cls, notiz = '', label, konflikt, extra = '' } = {}) {
    const hat = !!notiz;
    return `<span class="wp-chip ${cls}${hat ? ' mit-notiz' : ''}" ${schreib ? 'data-zieh' : ''} ${chipAttr(art, id, name, e)}${konflikt ? ` data-konflikt="${esc(konflikt.typ)}" title="${esc(konflikt.text)}"` : ''}${hat ? ` data-notiz="${esc(notiz)}"` : ''}>
      <button type="button" class="wp-chip-t" data-chip-auf aria-label="${konflikt ? 'Konflikt: ' + esc(konflikt.text) : esc(name) + ' – Details, verschieben oder entfernen'}">${konflikt ? ic('alert', 'xs') : ''}<span>${label || esc(name)}</span>${extra}</button>
      ${schreib || hat ? `<button type="button" class="wp-nb${hat ? ' an' : ''}" data-notiz-auf aria-label="Notiz zu ${esc(name)}${hat ? ': ' + esc(notiz) : ' hinzufügen'}" title="${hat ? esc(notiz) : 'Notiz hinzufügen'}">${ic(hat ? 'file' : 'edit', 'xs')}</button>` : ''}</span>`;
  }
  function chipTeile(e, schreib) {
    const ks = konflikteVon(e);
    const kPerson = new Map(), kAnlage = new Map(), notizen = [];
    ks.forEach((k) => { if (k.typ === 'wetter') notizen.push(k); else if (k.benutzerId != null) kPerson.set(Number(k.benutzerId), k); else if (k.anlageId != null) kAnlage.set(Number(k.anlageId), k); else notizen.push({ ...k, rot: true }); });
    const inKolonne = new Set();
    const kol = (e.kolonnen || []).map((k) => {
      const leute = (e.personen || []).filter((p) => Number(p.kolonnePolierId) === Number(k.polierId));
      leute.forEach((p) => inKolonne.add(Number(p.benutzerId)));
      const n = Math.max(0, (k.anzahl || leute.length) - 1);
      const text = `${k.name}${n ? ' + ' + n : ''}`;
      const mit = leute.filter((p) => p.notiz).map((p) => `${p.name}: ${p.notiz}`).join(' · ');
      return chip('k', k.polierId, text, e, schreib, { cls: 'person', notiz: mit });
    });
    const einzel = (e.personen || []).filter((p) => !inKolonne.has(Number(p.benutzerId)) || kPerson.has(Number(p.benutzerId))).map((p) => {
      const k = kPerson.get(Number(p.benutzerId));
      return chip('p', p.benutzerId, p.name, e, schreib, k ? { cls: 'konflikt', notiz: p.notiz, konflikt: k, label: `${esc(p.name)} – ${esc(k.typ === 'abwesenheit' ? (k.text.split(/[:–-]\s*/).pop() || 'abwesend') : KONFLIKT_KURZ[k.typ] || 'Konflikt')}` } : { cls: 'person', notiz: p.notiz });
    });
    const ger = (e.anlagen || []).map((a) => {
      const k = kAnlage.get(Number(a.anlageId)), n = a.bezeichnung || a.nummer || 'Gerät';
      const fahrer = a.fahrer ? `<small class="wp-fahrer" data-fahrer="${a.fahrer.benutzerId}">${ic('user', 'xs')}${esc(a.fahrer.name)}</small>` : '';
      return chip('a', a.anlageId, n, e, schreib, k ? { cls: 'konflikt', notiz: a.notiz, konflikt: k, label: `${esc(n)} ${esc(KONFLIKT_KURZ[k.typ] || 'Konflikt')}`, extra: fahrer } : { cls: 'geraet', notiz: a.notiz, extra: fahrer });
    });
    const noten = notizen.map((k) => `<span class="wp-chip ${k.rot ? 'konflikt' : 'notiz'}" data-konflikt="${esc(k.typ)}">${k.rot ? ic('alert', 'xs') : ''}<span>${esc(k.text)}</span></span>`);
    return { personen: [...kol, ...einzel], geraete: ger, noten };
  }
  function zellChips(e, schreib) {
    const t = chipTeile(e, schreib);
    const info = [e.beginn ? `${esc(e.beginn)} Uhr` : '', e.arbeit ? esc(e.arbeit) : ''].filter(Boolean).join(' · ');
    return `${t.personen.join('')}${t.geraete.join('')}${t.noten.join('')}${info || e.notiz || e.benoetigt ? `<span class="wp-info">${info}${e.benoetigt ? `${info ? ' · ' : ''}<b>Mitnehmen:</b> ${esc(e.benoetigt)}` : ''}${e.notiz ? `${info || e.benoetigt ? ' · ' : ''}${esc(e.notiz)}` : ''}</span>` : ''}`;
  }
  function zelle(t, b) {
    const e = einsatz(t.datum, b.id), schreib = darfBs(b.id);
    const zustand = !e ? 'leer' : e.veroeffentlicht && !e.geaendertNachVeroeffentlichung ? 'veroeffentlicht' : e.veroeffentlicht ? 'geaendert' : 'entwurf';
    const ort = `${b.kurz || b.name}, ${tagKurz(t.datum)}`;
    return `<div class="wp-zelle${t.datum === tagWahl ? ' wahl' : ''}${t.datum === heute ? ' heute' : ''}${t.feiertag ? ' frei' : ''}" role="cell" data-zelle data-datum="${t.datum}" data-bs="${b.id}" data-zustand="${zustand}" ${schreib ? 'data-ablage' : ''}>
      ${e ? zellChips(e, schreib) : ''}
      ${schreib ? `<div class="wp-zelle-fuss">${e ? `<button type="button" class="wp-mini" data-details="${e.id}" aria-label="Einsatz ${esc(ort)}: Beginn, Treffpunkt, Fahrzeug, Arbeit">${ic('edit', 'xs')}</button>` : ''}<button type="button" class="wp-mini hier" data-hier aria-label="Auswahl hier einteilen: ${esc(ort)}">${ic('check', 'xs')}Einteilen</button><button type="button" class="wp-mini" data-plus aria-label="Einteilen: ${esc(ort)}">${ic('plus', 'xs')}</button>${e ? `<i class="wp-stand" data-stand="${zustand}" title="${zustand === 'veroeffentlicht' ? 'veröffentlicht' : zustand === 'geaendert' ? 'seit der Veröffentlichung geändert' : 'noch nicht veröffentlicht'}"></i>` : ''}</div>` : ''}
    </div>`;
  }

  /* ---------- Wochenplan ---------- */
  function kacheln() {
    const kz = (d.kennzahlen || {})[tagWahl] || {};
    const rot = (d.konflikte || []).filter((k) => k.typ !== 'wetter');
    const frei = (d.frei || {})[tagWahl] || { personen: [], anlagen: [] };
    const gesp = (frei.anlagen || []).filter((a) => a.gesperrt);
    const wetter = (d.konflikte || []).filter((k) => k.typ === 'wetter');
    const w0 = wetter[0];
    return `<section class="wp-kacheln" aria-label="Überblick der Woche">
      <div class="wp-kachel" data-kachel="eingeteilt"><small>Eingeteilt ${esc(fmt.WTK[fmt.dt(tagWahl).getDay()])}</small><b>${kz.eingeteilt ?? '–'} <i>von ${kz.gesamt ?? '–'}</i></b></div>
      <div class="wp-kachel${rot.length ? ' rot' : ''}" data-kachel="konflikte"><small>Konflikte</small><b>${rot.length}</b></div>
      <div class="wp-kachel${gesp.length ? ' gelb' : ''}" data-kachel="gesperrt"><small>Gerät gesperrt</small><em>${gesp.length ? `${esc(gesp[0].bezeichnung)}${gesp.length > 1 ? ` +${gesp.length - 1}` : ''}` : 'keines'}</em></div>
      <div class="wp-kachel${w0 ? ' blau' : ''}" data-kachel="wetter"><small>Wetter${w0 ? ' ' + esc(fmt.WTK[fmt.dt(w0.datum).getDay()]) : ''}</small><em>${w0 ? esc(w0.text) : 'keine Warnung'}</em></div>
    </section>`;
  }
  function pool() {
    const frei = (d.frei || {})[tagWahl] || { personen: [], anlagen: [] };
    const q = suche.trim().toLowerCase();
    const pass = (s) => !q || String(s).toLowerCase().includes(q);
    const pers = (frei.personen || []).filter((p) => pass(p.name));
    const ger = (frei.anlagen || []).filter((a) => pass(`${a.bezeichnung || ''} ${a.kennzeichen || ''}`));
    const gew = (k) => (wahl.has(k) ? ' aria-pressed="true"' : ' aria-pressed="false"');
    const rot = (d.konflikte || []).filter((k) => k.typ !== 'wetter');
    return `<aside class="wp-pool card" aria-label="Noch nicht eingeteilt">
      <div><h2 id="pool-titel">Noch frei · ${esc(tagKurz(tagWahl))}</h2><p class="muted sm">Auf eine Baustelle ziehen – oder auswählen und in der Zelle „Einteilen“ drücken.</p></div>
      <label class="field"><span class="field-label">Suchen</span><input class="input" type="search" id="wp-suche" placeholder="Name oder Gerät" value="${esc(suche)}"></label>
      <div class="wp-pool-gruppe" id="pool-personen"><span class="wp-pool-h">Mitarbeiter</span>
        ${pers.filter((p) => p.status !== 'abwesend').map((p) => `<button type="button" class="wp-frei person" data-zieh data-pool ${chipAttr('p', p.benutzerId, p.name)}${gew('p:' + p.benutzerId)}><span>${esc(p.name)}</span><small>${esc(rolleText(p.rolle))}</small></button>${p.rolle === 'polier' ? `<button type="button" class="wp-frei person partie" data-zieh data-pool ${chipAttr('k', p.benutzerId, 'Partie ' + p.name)}${gew('k:' + p.benutzerId)}><span>Partie ${esc(p.name)}</span><small>alle</small></button>` : ''}`).join('') || '<p class="muted sm" data-pool-leer>Alle eingeteilt.</p>'}
        ${pers.filter((p) => p.status === 'abwesend').map((p) => `<div class="wp-frei abwesend" data-abwesend="${p.benutzerId}"><span>${esc(p.name)}</span><small>${esc(p.text || 'abwesend')}</small></div>`).join('')}
        <a class="btn ghost sm" href="#/urlaub" id="pool-urlaub">${ic('away')}Urlaub</a>
      </div>
      <div class="wp-pool-gruppe" id="pool-geraete"><span class="wp-pool-h">Geräte</span>
        ${ger.filter((a) => !a.gesperrt).slice(0, 60).map((a) => `<button type="button" class="wp-frei geraet" data-zieh data-pool ${chipAttr('a', a.anlageId, a.bezeichnung || 'Gerät')}${gew('a:' + a.anlageId)}><span>${esc(a.bezeichnung || 'Gerät')}</span><small>${esc(a.standort || a.kennzeichen || '')}</small></button>`).join('') || '<p class="muted sm">Keine freien Geräte.</p>'}
        ${ger.filter((a) => a.gesperrt).map((a) => `<div class="wp-frei gesperrt" data-gesperrt="${a.anlageId}"><span>${esc(a.bezeichnung || 'Gerät')}</span><small>gesperrt${a.status && a.status !== 'gesperrt' ? ' · ' + esc(a.status) : ''}</small></div>`).join('')}
      </div>
      <div class="wp-pool-konflikte" id="wp-konflikte"><span class="wp-pool-h rot">Konflikte</span>
        ${rot.length ? rot.map((k) => `<p data-konflikt-zeile="${esc(k.typ)}">${esc(fmt.WTK[fmt.dt(k.datum).getDay()])}: ${esc(k.text)}</p>`).join('') : '<p class="muted sm">Keine Konflikte in dieser Woche.</p>'}
      </div>
      ${anfragen.length ? `<div class="wp-pool-konflikte" id="wp-anfragen"><span class="wp-pool-h">Anfragen der Poliere</span>${anfragen.map((a) => `<p data-anfrage="${a.id}"><b>${esc((a.von && a.von.name) || '')}</b> · ${esc(fmt.datumKurz(a.datum))}: ${esc(a.text)} <button type="button" class="btn ghost sm" data-anfrage-ok="${a.id}">Erledigt</button></p>`).join('')}</div>` : ''}
    </aside>`;
  }
  function wocheHtml() {
    const sp = d.tage.length;
    return `${kacheln()}
    <div class="wp-wrap">
      <section class="wp-tafel card" aria-label="Wochenplan KW ${kw(von)}">
        <div class="wp-kopf">
          <div class="wp-nav"><button type="button" class="icon-btn" data-woche="-7" aria-label="Vorige Woche">${ic('left')}</button><b id="wp-woche">${esc(wochenText(d.tage[0] ? d.tage[0].datum : von, d.tage[sp - 1] ? d.tage[sp - 1].datum : von))}</b><button type="button" class="icon-btn" data-woche="7" aria-label="Nächste Woche">${ic('right')}</button><button type="button" class="btn ghost sm" data-heute>Heute</button></div>
          <div class="wp-legende"><label class="check-inline sm"><input type="checkbox" id="wp-we" ${mitWe ? 'checked' : ''}> Sa/So</label><span><i class="wp-leg person"></i>Person</span><span><i class="wp-leg geraet"></i>Gerät</span><span><i class="wp-leg konflikt"></i>Konflikt</span></div>
        </div>
        <div class="wp-tage" role="tablist" aria-label="Tag wählen">${d.tage.map((t) => `<button type="button" role="tab" aria-selected="${t.datum === tagWahl}" class="${t.datum === tagWahl ? 'on' : ''}" data-tagwahl="${t.datum}"><small>${fmt.WTK[fmt.dt(t.datum).getDay()]}</small><b>${fmt.dt(t.datum).getDate()}</b></button>`).join('')}</div>
        ${wahl.size ? `<div class="wp-auswahl" id="wp-auswahl" role="status"><b>${wahl.size} ausgewählt:</b> ${[...wahl.values()].map((w) => esc(w.name)).join(', ')} – jetzt in der gewünschten Zelle „Einteilen“ drücken. <button type="button" class="btn ghost sm" data-wahl-weg>Auswahl aufheben</button></div>` : ''}
        <div class="wp-scroll" data-zieh-scroll><div class="wp-gitter${wahl.size ? ' mit-wahl' : ''}" role="table" data-spalten="${sp}" data-st="--sp:${sp}">
          <div class="wp-zeile kopf" role="row"><div class="wp-bs" role="columnheader">Baustelle</div>${d.tage.map((t) => `<button type="button" class="wp-tag${t.datum === tagWahl ? ' wahl' : ''}${t.datum === heute ? ' heute' : ''}" role="columnheader" data-tagwahl="${t.datum}" aria-pressed="${t.datum === tagWahl}" title="Tag für „Noch frei“ wählen">${esc(fmt.WTK[fmt.dt(t.datum).getDay()])} <span>${String(fmt.dt(t.datum).getDate()).padStart(2, '0')}.${String(fmt.dt(t.datum).getMonth() + 1).padStart(2, '0')}.</span>${t.feiertag ? `<small>${esc(t.feiertag === true ? 'Feiertag' : t.feiertag)}</small>` : ''}</button>`).join('')}</div>
          ${d.baustellen.length ? d.baustellen.map((b) => `<div class="wp-zeile" role="row" data-bs-zeile="${b.id}"><div class="wp-bs" role="rowheader"><small>KST ${esc(b.kst || '–')}</small><b>${esc(b.kurz || b.name)}</b><small>${b.polier ? 'Polier ' + esc(b.polier.name) : 'kein Polier'}</small></div>${d.tage.map((t) => zelle(t, b)).join('')}</div>`).join('') : `<div class="pad">${leer('Keine Baustelle in Planung oder Arbeit.', 'pin')}</div>`}
        </div></div>
      </section>
      ${planer || ich.rolle === 'bauleiter' ? pool() : ''}
    </div>`;
  }
  /* ---------- Tagesansicht „Morgen“: je Baustelle eine große Karte ---------- */
  const tagWort = (t) => (t === morgen ? (fmt.addTage(heute, 1) === morgen ? 'morgen' : fmt.WT[fmt.dt(t).getDay()]) : t === heute ? 'heute' : tagKurz(t));
  // Wer bei der Veröffentlichung dieses Tages (voraussichtlich) eine Nachricht bekommt
  function offenFuer(tag) {
    const es = d.einsaetze.filter((e) => e.datum === tag && darfBs(e.baustelleId) && (!e.veroeffentlicht || e.geaendertNachVeroeffentlichung));
    const ids = new Set(); es.forEach((e) => (e.personen || []).forEach((p) => ids.add(Number(p.benutzerId))));
    return { einsaetze: es, personen: ids.size };
  }
  function tagHtml() {
    const tag = tagWahl, t = d.tage.find((x) => x.datum === tag) || { datum: tag };
    const offen = offenFuer(tag);
    return `<div class="tg-kopf"><div class="wp-nav"><button type="button" class="icon-btn" data-tag-weiter="-1" aria-label="Vorheriger Arbeitstag">${ic('left')}</button><b id="tg-tag" data-datum="${tag}">${tag === morgen ? 'Morgen · ' : tag === heute ? 'Heute · ' : ''}${esc(fmt.WT[fmt.dt(tag).getDay()])} ${esc(tagKurz(tag).slice(3))}${t.feiertag ? ` · ${esc(t.feiertag === true ? 'Feiertag' : t.feiertag)}` : ''}</b><button type="button" class="icon-btn" data-tag-weiter="1" aria-label="Nächster Arbeitstag">${ic('right')}</button>${tag === morgen ? '' : '<button type="button" class="btn ghost sm" data-tag-morgen>Morgen</button>'}</div>
        <div class="wp-legende"><span><i class="wp-leg person"></i>Person</span><span><i class="wp-leg geraet"></i>Gerät</span><span><i class="wp-leg konflikt"></i>Konflikt</span></div></div>
      ${wahl.size ? `<div class="wp-auswahl" id="wp-auswahl" role="status"><b>${wahl.size} ausgewählt:</b> ${[...wahl.values()].map((w) => esc(w.name)).join(', ')} – jetzt auf der gewünschten Baustelle „Einteilen“ drücken. <button type="button" class="btn ghost sm" data-wahl-weg>Auswahl aufheben</button></div>` : ''}
      <div class="wp-wrap">
        <section class="tg-spalten${wahl.size ? ' mit-wahl' : ''}" id="tg-spalten" aria-label="Einteilung ${esc(tagKurz(tag))}" data-zieh-scroll>
          ${d.baustellen.length ? d.baustellen.map((b) => {
            const e = einsatz(tag, b.id), schreib = darfBs(b.id);
            const zustand = !e ? 'leer' : e.veroeffentlicht && !e.geaendertNachVeroeffentlichung ? 'veroeffentlicht' : e.veroeffentlicht ? 'geaendert' : 'entwurf';
            const teile = e ? chipTeile(e, schreib) : { personen: [], geraete: [], noten: [] };
            const ort = `${b.kurz || b.name}, ${tagKurz(tag)}`;
            const feld = (k, v, kl = '') => `<div class="${kl}"><dt>${k}</dt><dd>${v ? esc(v) : '<span class="muted">–</span>'}</dd></div>`;
            return `<article class="tg-karte card" data-zelle data-datum="${tag}" data-bs="${b.id}" data-zustand="${zustand}" ${schreib ? 'data-ablage' : ''} aria-label="${esc(b.kurz || b.name)}">
              <header><div><small>KST ${esc(b.kst || '–')} · ${b.polier ? 'Polier ' + esc(b.polier.name) : 'kein Polier'}</small><b>${esc(b.kurz || b.name)}</b></div><span class="chip xs ${zustand === 'veroeffentlicht' ? 'st-green' : zustand === 'leer' ? 'st-grey' : 'st-amber'}" data-stand="${zustand}">${zustand === 'veroeffentlicht' ? 'veröffentlicht' : zustand === 'geaendert' ? 'geändert' : zustand === 'entwurf' ? 'Entwurf' : 'leer'}</span></header>
              <dl class="tg-daten">${feld('Beginn', e && e.beginn ? e.beginn + ' Uhr' : '')}${feld('Treffpunkt', e && e.treffpunkt)}${feld('Arbeit', e && e.arbeit, 'breit')}${feld('Benötigt / Mitnehmen', e && e.benoetigt, 'breit benoetigt')}${feld('Baustellen-Notiz', e && e.notiz, 'breit')}</dl>
              ${schreib ? `<button type="button" class="btn ghost sm" data-details="${e ? e.id : `neu:${tag}:${b.id}`}" aria-label="Einsatz ${esc(ort)} bearbeiten: Beginn, Treffpunkt, Arbeit, Benötigt, Notiz">${ic('edit', 'xs')}Angaben bearbeiten</button>` : ''}
              <h4 class="sub-h">Personal <span class="count">${e ? (e.personen || []).length : 0}</span></h4><div class="tg-chips" data-tg-personen>${teile.personen.join('') || '<p class="muted sm">Noch niemand eingeteilt.</p>'}</div>
              <h4 class="sub-h">Geräte / LKW <span class="count">${e ? (e.anlagen || []).length : 0}</span></h4><div class="tg-chips" data-tg-geraete>${teile.geraete.join('') || '<p class="muted sm">Kein Gerät eingeteilt.</p>'}</div>
              ${teile.noten.length ? `<div class="tg-chips">${teile.noten.join('')}</div>` : ''}
              ${schreib ? `<div class="wp-zelle-fuss"><button type="button" class="wp-mini hier" data-hier aria-label="Auswahl hier einteilen: ${esc(ort)}">${ic('check', 'xs')}Einteilen</button><button type="button" class="btn ghost sm" data-plus aria-label="Einteilen: ${esc(ort)}">${ic('plus', 'xs')}Person / Gerät</button></div>` : ''}
            </article>`; }).join('') : `<div class="card pad">${leer('Keine Baustelle in Planung oder Arbeit.', 'pin')}</div>`}
        </section>
        ${pool()}
      </div>
      <div class="tg-fuss"><button type="button" class="btn primary lg" id="tg-pub" data-personen="${offen.personen}" ${offen.einsaetze.length ? '' : 'disabled'}>${ic('send')}Einteilung für ${esc(tagWort(tag))} veröffentlichen (${offen.personen} Person${offen.personen === 1 ? '' : 'en'})</button>${offen.einsaetze.length ? '' : '<span class="muted sm">Alles veröffentlicht – keine offenen Änderungen.</span>'}</div>`;
  }
  function pubVorschau(tag) {
    const offen = offenFuer(tag); if (!offen.einsaetze.length) return;
    const rot = (d.konflikte || []).filter((k) => k.typ !== 'wetter' && k.datum === tag);
    const dlg = dialog({ titel: `Einteilung für ${tagWort(tag)} veröffentlichen`, breit: true, inhalt: `<div class="stack-s" id="pub-vorschau">
      <p>Diese <b>${offen.personen} Person${offen.personen === 1 ? '' : 'en'}</b> werden benachrichtigt (in der App und per Push, wenn eingeschaltet). Wer schon Bescheid weiß und nicht betroffen ist, bekommt keine neue Meldung.</p>
      ${rot.length ? banner('warn', `${rot.length} Konflikt${rot.length === 1 ? '' : 'e'} offen: ${rot.slice(0, 3).map((k) => esc(k.text)).join(' · ')}`) : ''}
      ${offen.einsaetze.map((e) => `<section data-pub-einsatz="${e.id}"><h4 class="sub-h">${esc(bsName(e.baustelleId))}${e.beginn ? ' · ' + esc(e.beginn) + ' Uhr' : ''}${e.treffpunkt ? ' · Treffpunkt ' + esc(e.treffpunkt) : ''} <span class="chip xs ${e.veroeffentlicht ? 'st-amber' : 'st-blue'}">${e.veroeffentlicht ? 'geändert' : 'neu'}</span></h4>
        <ul class="plain rows">${(e.personen || []).map((p) => `<li data-pub-person="${p.benutzerId}"><span class="grow"><b>${esc(p.name)}</b><small>${esc(rolleText(p.rolle))}${p.notiz ? ' · Notiz: ' + esc(p.notiz) : ''}</small></span></li>`).join('') || '<li class="muted">Nur Geräte – niemand zu benachrichtigen.</li>'}</ul>
        ${e.benoetigt ? `<p class="sm"><b>Mitnehmen:</b> ${esc(e.benoetigt)}</p>` : ''}</section>`).join('')}</div>`,
      fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="button" id="pub-ok">Jetzt veröffentlichen</button>' });
    $('#pub-ok', dlg.el).addEventListener('click', async (ev) => { ev.target.disabled = true; try { const r = await post('/plan/veroeffentlichen', { von: tag, bis: tag }); dlg.zu(); toast(`Veröffentlicht – ${r.benachrichtigt ?? 0} Person${r.benachrichtigt === 1 ? '' : 'en'} benachrichtigt.`); ctx.meldungenNeu(); } catch (x) { ev.target.disabled = false; toast(x.message, 'warn'); } neu(); });
  }
  /* ---------- Notiz direkt am Chip (≤ 200 Zeichen), bei Geräten/LKW mit Fahrer ---------- */
  function notizEditor(c) {
    const e = einsatzId(c.dataset.einsatz); if (!e) return;
    const art = c.dataset.chip, id = Number(c.dataset.id);
    if (art === 'k') return chipDialog(c);
    const stueck = art === 'a' ? (e.anlagen || []).find((a) => Number(a.anlageId) === id) : (e.personen || []).find((p) => Number(p.benutzerId) === id);
    if (!stueck) return;
    $$('.wp-notiz-ed', el).forEach((x) => x.remove());
    const schreib = darfBs(e.baustelleId);
    const f = document.createElement('form'); f.className = 'wp-notiz-ed'; f.noValidate = true; f.dataset.notizFuer = `${art}:${id}`;
    f.innerHTML = `<label class="field"><span class="field-label">Notiz für ${esc(c.dataset.name)}</span><input class="input" name="notiz" maxlength="200" value="${esc(stueck.notiz || '')}" placeholder="${art === 'a' ? 'z. B. vorher tanken, Kran prüfen' : 'z. B. Führerschein C mitnehmen'}" ${schreib ? '' : 'readonly'}></label>
      ${art === 'a' ? `<label class="field"><span class="field-label">Fahrer</span><select class="input" name="fahrerId" ${schreib ? '' : 'disabled'}><option value="">– kein Fahrer –</option>${(e.personen || []).map((p) => `<option value="${p.benutzerId}" ${stueck.fahrer && Number(stueck.fahrer.benutzerId) === Number(p.benutzerId) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : ''}
      <p class="form-err" role="alert" hidden></p><div class="btn-row">${schreib ? '<button class="btn primary sm" type="submit">Speichern</button>' : ''}<button class="btn ghost sm" type="button" data-notiz-zu>${schreib ? 'Abbrechen' : 'Schließen'}</button></div>`;
    c.after(f); f.elements.notiz.focus();
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault(); const fd = new FormData(f);
      const body = { notiz: String(fd.get('notiz') || '').trim() }; if (art === 'a') body.fahrerId = fd.get('fahrerId') ? Number(fd.get('fahrerId')) : null;
      try { await put(`/plan/einsaetze/${e.id}/${art === 'a' ? 'anlagen' : 'personen'}/${id}`, body); toast('Notiz gespeichert.'); neu(); }
      catch (x) { const err = $('.form-err', f); err.hidden = false; err.textContent = x.status === 422 ? 'Der Fahrer muss auf derselben Baustelle eingeteilt sein.' : x.message; }
    });
  }
  function einstellungenDialog() {
    get('/einstellungen/plan').then((ein) => {
      const dlg = dialog({ titel: 'Planer-Erinnerung', inhalt: `<form id="pef" class="stack-s" novalidate><p class="muted sm">Ist die Einteilung für den nächsten Arbeitstag zu dieser Uhrzeit noch nicht veröffentlicht, bekommen Büro, Geschäftsführung und Bauleiter eine Erinnerung.</p>
        <label class="switch-row flat"><span><b>Erinnerung einschalten</b></span><input type="checkbox" class="vh" name="an" ${ein.planErinnerung ? 'checked' : ''}><span class="switch" aria-hidden="true"></span></label>
        <label class="field"><span class="field-label">Uhrzeit</span><input class="input lg" type="time" name="zeit" value="${esc(ein.planErinnerung || '14:00')}"></label><p class="form-err" role="alert" hidden></p></form>`, fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="pef">Speichern</button>' });
      $('#pef', dlg.el).addEventListener('submit', async (ev) => { ev.preventDefault(); const f = new FormData(ev.target); const zeit = f.get('an') === 'on' ? f.get('zeit') || '14:00' : null; try { await put('/einstellungen/plan', { planErinnerung: zeit }); dlg.zu(); toast(zeit ? `Erinnerung um ${zeit} Uhr.` : 'Erinnerung ausgeschaltet.'); } catch (x) { const err = $('.form-err', dlg.el); err.hidden = false; err.textContent = x.message; } });
    }).catch((x) => toast(x.message, 'warn'));
  }

  /* ---------- Geräte-Disposition (aus dem Wochenplan abgeleitet) ---------- */
  function geraeteHtml() {
    const map = new Map();
    d.einsaetze.forEach((e) => (e.anlagen || []).forEach((a) => { if (!map.has(a.anlageId)) map.set(a.anlageId, { a, tage: {} }); (map.get(a.anlageId).tage[e.datum] = map.get(a.anlageId).tage[e.datum] || []).push(e); }));
    Object.values(d.frei || {}).forEach((f) => (f.anlagen || []).forEach((a) => { if (!map.has(a.anlageId)) map.set(a.anlageId, { a, tage: {} }); }));
    const zeilen = [...map.values()].sort((x, y) => String(x.a.bezeichnung).localeCompare(String(y.a.bezeichnung), 'de'));
    return `<section class="card" aria-label="Geräte-Disposition"><div class="wp-kopf"><div class="wp-nav"><button type="button" class="icon-btn" data-woche="-7" aria-label="Vorige Woche">${ic('left')}</button><b>${esc(wochenText(d.tage[0] ? d.tage[0].datum : von, d.tage.length ? d.tage[d.tage.length - 1].datum : von))}</b><button type="button" class="icon-btn" data-woche="7" aria-label="Nächste Woche">${ic('right')}</button></div><span class="muted sm">Wo steht welches Gerät? Einteilen im Wochenplan.</span></div>
      ${zeilen.length ? `<div class="table-wrap"><table class="tbl" id="geraete-dispo"><thead><tr><th>Gerät</th>${d.tage.map((t) => `<th>${esc(tagKurz(t.datum))}</th>`).join('')}</tr></thead><tbody>${zeilen.map(({ a, tage }) => `<tr data-anlage="${a.anlageId}"><th scope="row">${esc(a.bezeichnung || a.nummer || 'Gerät')}${a.kennzeichen ? `<small class="muted"> ${esc(a.kennzeichen)}</small>` : ''}${a.gesperrt ? ' <span class="chip xs st-amber">gesperrt</span>' : ''}</th>${d.tage.map((t) => { const l = tage[t.datum] || []; return `<td>${l.length ? l.map((e) => `<span class="wp-chip ${l.length > 1 ? 'konflikt' : 'geraet'}">${esc(bsName(e.baustelleId))}</span>`).join('') : '<span class="muted sm">frei</span>'}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>` : leer('Keine Geräte im Fuhrpark.', 'truck')}</section>`;
  }

  function zeichne() {
    const n = d.unveroeffentlicht || 0;
    el.innerHTML = `<div class="page wp-page">
      <header class="wp-header"><div><p class="muted">Wer und welches Gerät ist wann auf welcher Baustelle – per Ziehen einteilen, mit einem Klick an alle senden.</p></div>
        ${(ansicht === 'woche' || ansicht === 'tag') && (planer || ich.rolle === 'bauleiter') ? `<div class="wp-aktionen">${planer ? `<button type="button" class="icon-btn" id="wp-einst" aria-label="Planer-Erinnerung einstellen" title="Planer-Erinnerung">${ic('bell')}</button>` : ''}<button type="button" class="btn ghost" id="wp-vorwoche">Vorwoche übernehmen</button><button type="button" class="btn primary" id="wp-pub" data-anzahl="${n}" ${n ? '' : 'disabled'}>${ic('send')}Plan veröffentlichen${n ? ` · ${n} Änderung${n === 1 ? '' : 'en'}` : ''}</button></div>` : ''}</header>
      <div class="chip-row" role="tablist" aria-label="Ansicht">${[['woche', 'Woche'], ['tag', 'Morgen'], ['zeitplan', 'Projektzeitplan'], ['geraete', 'Geräte-Disposition']].map(([k, t]) => `<button type="button" role="tab" class="chip-btn${ansicht === k ? ' on' : ''}" aria-selected="${ansicht === k}" data-ansicht="${k}">${t}</button>`).join('')}</div>
      ${fehler ? banner('err', esc(fehler)) : ''}
      <div id="wp-inhalt">${ansicht === 'woche' ? wocheHtml() : ansicht === 'tag' ? tagHtml() : ansicht === 'geraete' ? geraeteHtml() : zp ? zeitplanHtml(zp, ctx) : '<div class="state">Lädt …</div>'}</div>
    </div>`;
  }
  const neu = async () => { try { await lade(); } catch (e) { toast(e.message, 'warn'); } if (!ctx.aktuell()) return; const v = document.getElementById('view'); const st = v ? v.scrollTop : 0; const sc = $('[data-zieh-scroll]', el); const sl = sc ? sc.scrollLeft : 0; zeichne(); if (v) v.scrollTop = st; const s2 = $('[data-zieh-scroll]', el); if (s2) s2.scrollLeft = sl; };
  async function zeigZeitplan() { zp = zp || { von: fmt.addTage(montag(heute), -70), phase: '' }; try { await zeitplanLaden(zp); } catch (e) { fehler = e.message; } if (ctx.aktuell()) zeichne(); }

  /* ---------- Einteilen ---------- */
  async function zielEinsatz(datum, bsId) {
    const e = einsatz(datum, bsId); if (e) return e.id;
    try { return eins(await post('/plan/einsaetze', { datum, baustelleId: Number(bsId) })).id; }
    catch (x) { if (x.status === 409 && x.daten && x.daten.id) return x.daten.id; throw x; }
  }
  // stuecke: [{art:'p'|'k'|'a', id, vonEinsatz?}]
  async function einteilen(stuecke, datum, bsId) {
    if (!stuecke.length) return;
    try {
      const ziel = await zielEinsatz(datum, bsId);
      const gruppen = new Map(); // je Herkunft ein Aufruf, damit „verschiebenVon“ stimmt
      for (const s of stuecke) {
        const quelle = s.vonEinsatz ? einsatzId(s.vonEinsatz) : null;
        if (quelle && Number(quelle.id) === Number(ziel)) continue;
        const versch = quelle && quelle.datum === datum ? quelle.id : null; // anderer Tag = zusätzlich einteilen
        const k = String(versch || 0);
        if (!gruppen.has(k)) gruppen.set(k, { versch, p: [], a: [], k: [] });
        gruppen.get(k)[s.art].push(Number(s.id));
      }
      for (const g of gruppen.values()) {
        const mit = g.versch ? { verschiebenVon: g.versch } : {};
        if (g.p.length) await post(`/plan/einsaetze/${ziel}/personen`, { benutzerIds: g.p, ...mit });
        for (const pid of g.k) await post(`/plan/einsaetze/${ziel}/personen`, { kolonnePolierId: pid, ...mit });
        if (g.a.length) await post(`/plan/einsaetze/${ziel}/anlagen`, { anlageIds: g.a, ...mit });
      }
      wahl.clear();
      await neu();
      const e = einsatz(datum, bsId); const ks = e ? konflikteVon(e).filter((k) => k.typ !== 'wetter') : [];
      if (ks.length) toast(`Eingeteilt – Achtung: ${ks[0].text}${ks.length > 1 ? ` (+${ks.length - 1})` : ''}`, 'warn'); else toast(`Eingeteilt: ${bsName(bsId)}, ${tagKurz(datum)}.`);
    } catch (x) { toast(x.message, 'warn'); neu(); }
  }
  async function entfernen(art, id, e) {
    try {
      if (art === 'a') await del(`/plan/einsaetze/${e.id}/anlagen/${id}`);
      else if (art === 'k') { for (const p of (e.personen || []).filter((x) => Number(x.kolonnePolierId) === Number(id))) await del(`/plan/einsaetze/${e.id}/personen/${p.benutzerId}`); }
      else await del(`/plan/einsaetze/${e.id}/personen/${id}`);
      toast(e.veroeffentlicht ? 'Entfernt – beim nächsten Veröffentlichen wird die Änderung gemeldet.' : 'Entfernt.');
    } catch (x) { toast(x.message, 'warn'); }
    neu();
  }
  // Klick auf einen Chip in der Zelle: Details, Verschieben (ohne Ziehen), Entfernen
  function chipDialog(c) {
    const e = einsatzId(c.dataset.einsatz); if (!e) return;
    const art = c.dataset.chip, id = Number(c.dataset.id), name = c.dataset.name;
    const schreib = darfBs(e.baustelleId);
    const ks = konflikteVon(e).filter((k) => (art === 'a' ? Number(k.anlageId) === id : Number(k.benutzerId) === id));
    const leute = art === 'k' ? (e.personen || []).filter((p) => Number(p.kolonnePolierId) === id) : [];
    const dlg = dialog({ titel: name, inhalt: `<div class="stack-s" id="chip-dialog">
      <p class="muted sm">${esc(bsName(e.baustelleId))} · ${esc(tagKurz(e.datum))}${e.beginn ? ' · ' + esc(e.beginn) + ' Uhr' : ''}</p>
      ${ks.map((k) => banner('warn', esc(k.text))).join('')}
      ${leute.length ? `<ul class="plain rows" id="kol-notizen">${leute.map((p) => `<li><span class="grow"><b>${esc(p.name)}</b><small>${esc(rolleText(p.rolle))}</small><input class="input" data-person-notiz="${p.benutzerId}" maxlength="200" value="${esc(p.notiz || '')}" placeholder="Notiz für ${esc(p.name)}" aria-label="Notiz für ${esc(p.name)}" ${schreib ? '' : 'readonly'}></span>${p.bestaetigt ? '<span class="chip xs st-green">bestätigt</span>' : p.gelesen ? '<span class="chip xs st-blue">gelesen</span>' : ''}</li>`).join('')}</ul>` : ''}
      ${schreib ? `<form id="vsf" class="form-grid"><label class="field"><span class="field-label">Verschieben auf Baustelle</span><select class="input lg" name="bs">${d.baustellen.filter((b) => darfBs(b.id)).map((b) => `<option value="${b.id}" ${Number(b.id) === Number(e.baustelleId) ? 'selected' : ''}>${esc((b.kst ? b.kst + ' · ' : '') + (b.kurz || b.name))}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Tag</span><select class="input lg" name="tag">${d.tage.map((t) => `<option value="${t.datum}" ${t.datum === e.datum ? 'selected' : ''}>${esc(tagKurz(t.datum))}</option>`).join('')}</select></label><p class="muted sm full">Am selben Tag wird verschoben, an einem anderen Tag zusätzlich eingeteilt.</p></form>` : ''}</div>`,
      fuss: schreib ? '<button class="btn danger" type="button" id="chip-weg">Entfernen</button><span class="grow"></span><button class="btn ghost" type="button" data-zu>Schließen</button><button class="btn primary" type="submit" form="vsf" id="chip-versch">Verschieben</button>' : '<button class="btn ghost" type="button" data-zu>Schließen</button>' });
    if (!schreib) return;
    dlg.el.addEventListener('change', async (ev) => { const i = ev.target.closest('[data-person-notiz]'); if (!i) return; try { await put(`/plan/einsaetze/${e.id}/personen/${i.dataset.personNotiz}`, { notiz: i.value.trim() }); toast('Notiz gespeichert.'); neu(); } catch (x) { toast(x.message, 'warn'); } });
    $('#chip-weg', dlg.el).addEventListener('click', () => { dlg.zu(); entfernen(art, id, e); });
    $('#vsf', dlg.el).addEventListener('submit', (ev) => { ev.preventDefault(); const f = new FormData(ev.target); dlg.zu(); einteilen([{ art, id, vonEinsatz: e.id }], f.get('tag'), f.get('bs')); });
  }
  // „+“ in der Zelle: Auswahl per Liste (Tastatur-/Touch-Weg ohne Ziehen)
  function plusDialog(datum, bsId) {
    const frei = (d.frei || {})[datum] || { personen: [], anlagen: [] };
    const pers = (frei.personen || []).filter((p) => p.status !== 'abwesend'), ger = (frei.anlagen || []).filter((a) => !a.gesperrt);
    const dlg = dialog({ titel: `Einteilen · ${bsName(bsId)} · ${tagKurz(datum)}`, breit: true, inhalt: `<form id="plf" class="stack-s" novalidate>
      <fieldset class="field"><legend class="field-label">Noch frei: Mitarbeiter</legend><div class="pick-multi">${pers.map((p) => `<label class="check-inline"><input type="checkbox" name="${p.rolle === 'polier' ? 'k' : 'p'}" value="${p.benutzerId}"> ${esc(p.name)}${p.rolle === 'polier' ? ' <small class="muted">mit Partie</small>' : ''}</label>`).join('') || '<p class="muted sm">Alle sind schon eingeteilt.</p>'}</div></fieldset>
      <fieldset class="field"><legend class="field-label">Noch frei: Geräte und Fahrzeuge</legend><div class="pick-multi">${ger.slice(0, 120).map((a) => `<label class="check-inline"><input type="checkbox" name="a" value="${a.anlageId}"> ${esc(a.bezeichnung || 'Gerät')}${a.kennzeichen ? ' · ' + esc(a.kennzeichen) : ''}</label>`).join('') || '<p class="muted sm">–</p>'}</div></fieldset>
      <p class="form-err" role="alert" hidden></p></form>`, fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="plf">Einteilen</button>' });
    $('#plf', dlg.el).addEventListener('submit', (ev) => {
      ev.preventDefault(); const f = new FormData(ev.target);
      const st = [...f.getAll('p').map((id) => ({ art: 'p', id })), ...f.getAll('k').map((id) => ({ art: 'k', id })), ...f.getAll('a').map((id) => ({ art: 'a', id }))];
      if (!st.length) { const err = $('.form-err', dlg.el); err.hidden = false; err.textContent = 'Bitte mindestens eine Person oder ein Gerät wählen.'; return; }
      dlg.zu(); einteilen(st, datum, bsId);
    });
  }
  async function detailsDialog(eid) {
    if (String(eid).startsWith('neu:')) { const [, datum, bsId] = String(eid).split(':'); try { eid = await zielEinsatz(datum, bsId); await lade(); zeichne(); } catch (x) { toast(x.message, 'warn'); return; } }
    const e = einsatzId(eid); if (!e) return;
    const dlg = dialog({ titel: `Einsatz · ${bsName(e.baustelleId)} · ${tagKurz(e.datum)}`, breit: true, inhalt: `<form id="edf" class="form-grid" novalidate>
      <label class="field"><span class="field-label">Beginn</span><input class="input lg" type="time" name="beginn" value="${esc(e.beginn || '')}"></label>
      <label class="field"><span class="field-label">Treffpunkt</span><input class="input lg" name="treffpunkt" maxlength="200" value="${esc(e.treffpunkt || '')}" placeholder="z. B. Bauhof 06:00"></label>
      <label class="field"><span class="field-label">Fahrzeug</span><select class="input lg" name="fahrzeugAnlageId"><option value="">– keines / freier Text –</option>${(e.anlagen || []).map((a) => `<option value="${a.anlageId}" ${e.fahrzeug && Number(e.fahrzeug.anlageId) === Number(a.anlageId) ? 'selected' : ''}>${esc(a.bezeichnung || a.nummer)}</option>`).join('')}</select></label>
      <label class="field"><span class="field-label">Fahrzeug (freier Text)</span><input class="input lg" name="fahrzeugText" maxlength="120" value="${esc((e.fahrzeug && e.fahrzeug.text) || '')}"></label>
      <label class="field full"><span class="field-label">Arbeit</span><input class="input lg" name="arbeit" maxlength="200" value="${esc(e.arbeit || '')}" placeholder="z. B. Walzen, Pflaster"></label>
      <label class="field"><span class="field-label">Benötigt / Mitnehmen</span><textarea class="input lg" name="benoetigt" rows="3" maxlength="500" placeholder="z. B. Rüttelplatte, 20 t Schotter 0/32, Absperrgitter">${esc(e.benoetigt || '')}</textarea></label>
      <label class="field"><span class="field-label">Baustellen-Notiz</span><textarea class="input lg" name="notiz" rows="3" maxlength="500" placeholder="Hinweis vom Büro an die Partie">${esc(e.notiz || '')}</textarea></label>
      <p class="muted sm full">${e.veroeffentlicht ? (e.geaendertNachVeroeffentlichung ? 'Seit der Veröffentlichung geändert – erneut veröffentlichen, damit es alle erfahren.' : 'Veröffentlicht.') : 'Noch nicht veröffentlicht – die Mannschaft sieht den Einsatz noch nicht.'}</p>
      <p class="form-err full" role="alert" hidden></p></form>`,
      fuss: '<button class="btn danger" type="button" id="ed-weg">Einsatz löschen</button><span class="grow"></span><button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="edf">Speichern</button>' });
    $('#edf', dlg.el).addEventListener('submit', async (ev) => {
      ev.preventDefault(); const f = new FormData(ev.target); const err = $('.form-err', dlg.el);
      try { await put(`/plan/einsaetze/${e.id}`, { version: e.version, beginn: f.get('beginn') || null, treffpunkt: String(f.get('treffpunkt')).trim(), fahrzeugAnlageId: f.get('fahrzeugAnlageId') ? Number(f.get('fahrzeugAnlageId')) : null, fahrzeugText: String(f.get('fahrzeugText')).trim(), arbeit: String(f.get('arbeit')).trim(), benoetigt: String(f.get('benoetigt')).trim(), notiz: String(f.get('notiz')).trim() }); dlg.zu(); toast('Gespeichert.'); neu(); }
      catch (x) { err.hidden = false; err.textContent = x.status === 409 ? 'Inzwischen von jemand anderem geändert – bitte schließen und erneut öffnen.' : x.message; if (x.status === 409) neu(); }
    });
    $('#ed-weg', dlg.el).addEventListener('click', async () => { if (!(await bestaetigen('Einsatz löschen?', 'Alle Personen und Geräte dieser Zelle werden ausgeteilt.', 'Löschen', 'danger'))) return; try { await del(`/plan/einsaetze/${e.id}`); dlg.zu(); toast('Einsatz gelöscht.'); } catch (x) { toast(x.message, 'warn'); } neu(); });
  }

  /* ---------- Ereignisse ---------- */
  el.addEventListener('click', async (e) => {
    const an = e.target.closest('[data-ansicht]');
    if (an) { ansicht = an.dataset.ansicht; wahl.clear(); if (ansicht === 'zeitplan') { zeichne(); return zeigZeitplan(); } if (ansicht === 'tag') { tagWahl = morgen; if (!d.tage.some((t) => t.datum === morgen)) { von = montag(morgen); return neu(); } } return zeichne(); }
    if (ansicht === 'zeitplan') return;
    const w = e.target.closest('[data-woche]');
    if (w) { von = fmt.addTage(von, Number(w.dataset.woche)); tagWahl = ''; wahl.clear(); speicher.setz('bt_plan_woche', von); return neu(); }
    if (e.target.closest('[data-heute]')) { von = montag(heute); tagWahl = ''; speicher.setz('bt_plan_woche', von); return neu(); }
    const tw = e.target.closest('[data-tagwahl]');
    if (tw) { tagWahl = tw.dataset.tagwahl; return zeichne(); }
    if (e.target.closest('[data-wahl-weg]')) { wahl.clear(); return zeichne(); }
    const tw2 = e.target.closest('[data-tag-weiter]') || e.target.closest('[data-tag-morgen]');
    if (tw2) { tagWahl = tw2.dataset.tagWeiter ? naechsterTag(tagWahl, Number(tw2.dataset.tagWeiter)) : morgen; wahl.clear(); if (!d.tage.some((t) => t.datum === tagWahl)) { von = montag(tagWahl); return neu(); } return zeichne(); }
    if (e.target.closest('#tg-pub')) return pubVorschau(tagWahl);
    if (e.target.closest('#wp-einst')) return einstellungenDialog();
    if (e.target.closest('[data-notiz-zu]')) { e.target.closest('.wp-notiz-ed').remove(); return; }
    const nb = e.target.closest('[data-notiz-auf]');
    if (nb) return notizEditor(nb.closest('[data-chip]'));
    const hier = e.target.closest('[data-hier]');
    if (hier) { const z = hier.closest('[data-zelle]'); return einteilen([...wahl.values()], z.dataset.datum, z.dataset.bs); }
    const plus = e.target.closest('[data-plus]');
    if (plus) { const z = plus.closest('[data-zelle]'); return plusDialog(z.dataset.datum, z.dataset.bs); }
    const det = e.target.closest('[data-details]');
    if (det) return detailsDialog(det.dataset.details);
    const c = e.target.closest('[data-chip]');
    if (c && c.hasAttribute('data-pool')) { const k = `${c.dataset.chip}:${c.dataset.id}`; if (wahl.has(k)) wahl.delete(k); else wahl.set(k, { art: c.dataset.chip, id: Number(c.dataset.id), name: c.dataset.name }); zeichne(); const wieder = $(`[data-pool][data-chip="${c.dataset.chip}"][data-id="${c.dataset.id}"]`, el); if (wieder) wieder.focus(); return; }
    if (c && c.dataset.einsatz && e.target.closest('[data-chip-auf]')) return chipDialog(c);
    const ao = e.target.closest('[data-anfrage-ok]');
    if (ao) {
      const dlg = dialog({ titel: 'Anfrage erledigen', inhalt: '<form id="aof" class="stack-s"><label class="field"><span class="field-label">Antwort an den Polier (optional)</span><input class="input lg" name="antwort" maxlength="500"></label></form>', fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="aof">Erledigt</button>' });
      $('#aof', dlg.el).addEventListener('submit', async (ev) => { ev.preventDefault(); try { await put(`/plan/anfragen/${ao.dataset.anfrageOk}`, { status: 'erledigt', antwort: String(new FormData(ev.target).get('antwort') || '').trim() }); dlg.zu(); toast('Erledigt – der Polier wird benachrichtigt.'); } catch (x) { toast(x.message, 'warn'); } neu(); });
      return;
    }
    if (e.target.closest('#wp-pub')) {
      const n = d.unveroeffentlicht || 0, rot = (d.konflikte || []).filter((k) => k.typ !== 'wetter').length;
      const t = d.tage.map((x) => x.datum);
      if (!(await bestaetigen('Plan veröffentlichen?', `${n} Änderung${n === 1 ? '' : 'en'} in KW ${kw(von)}: Alle Betroffenen erfahren ihren Einsatz in der App (und per Push, wenn eingeschaltet).${rot ? ` Achtung: ${rot} Konflikt${rot === 1 ? '' : 'e'} offen.` : ''}`, 'Veröffentlichen'))) return;
      try { const r = await post('/plan/veroeffentlichen', { von: t[0], bis: t[t.length - 1] }); toast(`Veröffentlicht – ${r.benachrichtigt ?? 0} Person${r.benachrichtigt === 1 ? '' : 'en'} benachrichtigt.`); ctx.meldungenNeu(); } catch (x) { toast(x.message, 'warn'); }
      return neu();
    }
    if (e.target.closest('#wp-vorwoche')) {
      if (!(await bestaetigen('Vorwoche übernehmen?', `Die Einsätze der KW ${kw(fmt.addTage(von, -7))} werden auf dieselben Wochentage der KW ${kw(von)} kopiert. Bereits belegte Zellen bleiben, Abwesende und gesperrte Geräte werden ausgelassen.`, 'Übernehmen'))) return;
      try {
        const r = await post('/plan/vorwoche-uebernehmen', { von });
        const aus = r.uebersprungen || [];
        if (aus.length) dialog({ titel: `${r.angelegt ?? 0} Einsätze übernommen`, inhalt: `<p>Ausgelassen (${aus.length}):</p><ul class="warn-list" id="vw-ausgelassen">${aus.map((u) => `<li>${ic('alert')}<span>${esc(fmt.datumKurz(u.datum))}: ${esc(u.text)}</span></li>`).join('')}</ul>`, fuss: '<button class="btn primary" type="button" data-zu>OK</button>' });
        else toast(`${r.angelegt ?? 0} Einsätze aus der Vorwoche übernommen.`);
      } catch (x) { toast(x.message, 'warn'); }
      return neu();
    }
  });
  el.addEventListener('change', (e) => { if (e.target.id === 'wp-we') { mitWe = e.target.checked; speicher.setz('bt_plan_we', mitWe); neu(); } });
  el.addEventListener('input', (e) => { if (e.target.id === 'wp-suche') { suche = e.target.value; const pos = e.target.selectionStart; zeichne(); const s = $('#wp-suche', el); if (s) { s.focus(); s.setSelectionRange(pos, pos); } } });
  const loese = ziehbar(el, {
    quelle: '.wp-page [data-zieh][data-chip]', ziel: '[data-ablage]',
    ablegen: (q, z) => einteilen([{ art: q.dataset.chip, id: Number(q.dataset.id), vonEinsatz: q.dataset.einsatz || null }], z.dataset.datum, z.dataset.bs),
  });
  const loeseZp = zeitplanBinden(el, ctx, () => zp, zeigZeitplan);
  zeichne();
  if (ansicht === 'zeitplan') zeigZeitplan();
  return () => { loese(); loeseZp(); };
}

/* ================= Handy: „Mein Einsatz“ (alle, die eingeteilt werden können) ================= */
const route = (adr) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(adr)}`;
export async function einsatz(el, ctx) {
  const heute = wienHeute();
  const d = await get(`/plan/ich?von=${heute}&bis=${fmt.addTage(heute, 6)}`);
  const tage = d.tage || [];
  const haupt = d.morgen && d.morgen.einsatz ? d.morgen : tage.find((t) => t.datum === heute && t.einsatz) || null;
  const istMorgen = haupt && haupt.datum === fmt.addTage(heute, 1);
  function karte(t) {
    const e = t.einsatz, b = e.baustelle || {};
    const fz = e.fahrzeug ? e.fahrzeug.bezeichnung || e.fahrzeug.text : (e.anlagen || [])[0] && e.anlagen[0].bezeichnung;
    const feld = (k, v) => (v ? `<div><small>${k}</small><b>${esc(v)}</b></div>` : '');
    return `<section class="me-karte" id="einsatz-karte" data-datum="${t.datum}" aria-label="Einsatz ${istMorgen ? 'morgen' : 'heute'}">
      <span class="me-wann">${istMorgen ? 'Morgen' : 'Heute'} · ${esc(fmt.WT[fmt.dt(t.datum).getDay()])} ${esc(tagKurz(t.datum).slice(3))}${t.geaendert ? ' · geändert' : ''}</span>
      <div class="me-haupt"><b class="me-zeit">${e.beginn ? esc(e.beginn) + ' Uhr' : 'Beginn wie üblich'}</b><b class="me-bs">${esc(b.name || 'Baustelle')}</b><span>${esc(b.adresse || '')}</span></div>
      <div class="me-felder">${feld('Treffpunkt', e.treffpunkt)}${feld('Polier', e.polier && e.polier.name)}${feld('Fahrzeug', fz)}${feld('Arbeit', e.arbeit)}</div>
      ${e.meineNotiz ? `<p class="me-meine" id="me-meine-notiz"><small>Notiz für mich</small>${esc(e.meineNotiz)}</p>` : ''}
      ${e.benoetigt ? `<p class="me-notiz" id="me-benoetigt"><b>Benötigt / Mitnehmen:</b> ${esc(e.benoetigt)}</p>` : ''}
      ${e.meinFahrzeug ? `<p class="me-notiz" id="me-fahrzeug"><b>Mein Fahrzeug:</b> ${esc(e.meinFahrzeug.bezeichnung || '')}${e.meinFahrzeug.kennzeichen ? ' (' + esc(e.meinFahrzeug.kennzeichen) + ')' : ''}${e.meinFahrzeug.notiz ? `<span class="me-zeile-notiz">${esc(e.meinFahrzeug.notiz)}</span>` : ''}</p>` : ''}
      ${e.notiz ? `<p class="me-notiz">${esc(e.notiz)}</p>` : ''}${e.wetterHinweis ? `<p class="me-notiz">${esc(e.wetterHinweis)}</p>` : ''}
      <div class="me-knoepfe">${b.adresse ? `<a class="btn primary" id="me-route" href="${esc(route(b.adresse))}" target="_blank" rel="noopener noreferrer">Route öffnen</a>` : ''}${e.polier && e.polier.telefon ? `<a class="btn dark" id="me-anruf" href="tel:${esc(String(e.polier.telefon).replace(/[^+\d]/g, ''))}">Polier anrufen</a>` : ''}
        ${t.bestaetigt ? `<span class="chip st-green" id="me-bestaetigt">${ic('check', 'xs')}bestätigt</span>` : `<button type="button" class="btn dark" id="me-ok" data-datum="${t.datum}">${ic('check')}Passt – gelesen</button>`}</div>
    </section>`;
  }
  el.innerHTML = `<div class="page narrow me-page">
    ${haupt ? karte(haupt) : `<section class="card pad" id="einsatz-leer">${leer('Für heute und morgen ist noch kein Einsatz veröffentlicht.', 'calendar')}</section>`}
    ${haupt ? `<div class="me-hinweis">Am Morgen schlägt die Stempeluhr diese Baustelle automatisch vor.</div>` : ''}
    <section class="card" aria-labelledby="h-mw"><h2 class="me-h" id="h-mw">Diese Woche</h2>
      <ul class="plain me-woche" id="einsatz-woche">${tage.map((t) => { const e = t.einsatz; return `<li data-tag="${t.datum}" class="${e ? '' : 'leer'}"><span class="me-tag"><small>${esc(fmt.WTK[fmt.dt(t.datum).getDay()])}</small><b>${fmt.dt(t.datum).getDate()}</b></span><span class="grow"><b>${e ? esc((e.baustelle && e.baustelle.name) || 'Baustelle') : 'noch nicht eingeteilt'}</b><small>${e ? [t.datum === heute ? 'heute' : t.datum === fmt.addTage(heute, 1) ? 'morgen' : '', e.beginn, e.arbeit, t.geaendert ? 'neu eingeteilt' : '', e.wetterHinweis].filter(Boolean).map(esc).join(' · ') : ''}</small></span></li>`; }).join('') || '<li class="leer"><span class="grow muted">Noch nichts veröffentlicht.</span></li>'}</ul></section>
  </div>`;
  el.addEventListener('click', async (e) => {
    const ok = e.target.closest('#me-ok'); if (!ok) return;
    try { await post('/plan/ich/bestaetigen', { datum: ok.dataset.datum }); toast('Bestätigt.'); ctx.neuLaden(); } catch (x) { toast(x.message, 'warn'); }
  });
}

/* ================= Polier: „Meine Partie morgen“ ================= */
export async function partie(el, ctx) {
  const heute = wienHeute(), morgen = fmt.addTage(heute, 1);
  let datum = ctx.query.get('datum') === heute ? heute : morgen;
  let d = { einsaetze: [] };
  async function lade() { d = await get(`/plan/partie?datum=${datum}`); }
  await lade();
  function zeichne() {
    const wort = datum === heute ? 'heute' : 'morgen';
    ctx.titel(`Meine Partie ${wort}`, `${fmt.WTK[fmt.dt(datum).getDay()]} ${tagKurz(datum).slice(3)}`);
    el.innerHTML = `<div class="page narrow me-page">
      <div class="tabs" role="tablist" aria-label="Tag">${[[heute, 'Heute'], [morgen, 'Morgen']].map(([k, t]) => `<button type="button" role="tab" aria-selected="${k === datum}" class="${k === datum ? 'on' : ''}" data-partie-tag="${k}">${t}</button>`).join('')}</div>
      ${d.einsaetze.length ? d.einsaetze.map((e) => `<div class="stack" data-partie-einsatz="${e.id}">
        <p class="me-kopf"><b>${esc((e.baustelle && (e.baustelle.name || e.baustelle.kurz)) || 'Baustelle')}</b>${e.beginn ? ` · ${esc(e.beginn)} Uhr` : ''}${e.treffpunkt ? ` · Treffpunkt ${esc(e.treffpunkt)}` : ''}${e.arbeit ? ` · ${esc(e.arbeit)}` : ''}</p>
        <section class="card" aria-label="Personal"><h2 class="me-h">Personal · ${(e.personen || []).length} <small class="muted" data-lesezahl>${(e.personen || []).filter((p) => p.gelesen || p.bestaetigt).length} gelesen · ${(e.personen || []).filter((p) => p.bestaetigt).length} bestätigt</small></h2><ul class="plain rows" data-partie-personen>${(e.personen || []).map((p) => `<li data-person="${p.benutzerId}"><span class="grow"><b>${esc(p.name)}</b><small>${esc(rolleText(p.rolle))}</small>${p.notiz ? `<span class="me-zeile-notiz" data-notiz>${esc(p.notiz)}</span>` : ''}</span><span class="me-status ${p.bestaetigt ? 'ok' : p.gelesen ? 'gelesen' : ''}" data-lesestand="${p.bestaetigt ? 'bestaetigt' : p.gelesen ? 'gelesen' : 'offen'}">${p.bestaetigt ? 'bestätigt' : p.gelesen ? 'gelesen' : 'noch nicht gelesen'}</span></li>`).join('') || '<li class="muted">Niemand eingeteilt.</li>'}</ul></section>
        <section class="card" aria-label="Geräte"><h2 class="me-h">Geräte · ${(e.anlagen || []).length}</h2><ul class="plain rows" data-partie-geraete>${(e.anlagen || []).map((a) => `<li><span class="grow"><b>${esc(a.bezeichnung || a.nummer || 'Gerät')}</b>${a.kennzeichen || a.fahrer ? `<small>${esc(a.kennzeichen || '')}${a.fahrer ? `${a.kennzeichen ? ' · ' : ''}Fahrer ${esc(a.fahrer.name)}` : ''}</small>` : ''}${a.notiz ? `<span class="me-zeile-notiz" data-notiz>${esc(a.notiz)}</span>` : ''}</span><span class="me-status ${a.gesperrt ? 'rot' : a.hinweis ? 'gelb' : 'ok'}">${a.gesperrt ? 'gesperrt' : esc(a.hinweis || 'einsatzbereit')}</span></li>`).join('') || '<li class="muted">Kein Gerät eingeteilt.</li>'}</ul></section>
        ${e.benoetigt ? `<div class="me-hinweis" data-benoetigt><b>Benötigt / Mitnehmen:</b> ${esc(e.benoetigt)}</div>` : ''}
        ${e.notiz ? `<div class="me-buero" data-buero-hinweis><b>Hinweis Büro:</b> ${esc(e.notiz)}</div>` : ''}
        <div class="stack-s">${ctx.kann('kolonne') ? (datum === heute ? `<a class="btn primary lg" data-alle-stempeln href="#/kolonne?baustelleId=${e.baustelleId}&plan=1">${ic('users')}Alle einstempeln${e.beginn ? ` (${esc(e.beginn)})` : ''}</a>` : `<button type="button" class="btn primary lg" data-alle-stempeln disabled>${ic('users')}Morgen alle einstempeln${e.beginn ? ` (${esc(e.beginn)})` : ''}</button><p class="muted sm">Morgen früh hier mit einem Tipp – die eingeplante Mannschaft ist dann schon ausgewählt.</p>`) : ''}
          <button type="button" class="btn ghost lg" data-anfrage="${e.id}">Änderung beim Büro anfragen</button></div>
      </div>`).join('') : `<section class="card pad" id="partie-leer">${leer(`Für ${wort} ist noch kein Plan veröffentlicht.`, 'calendar')}<button type="button" class="btn ghost" data-anfrage="">Änderung beim Büro anfragen</button></section>`}
    </div>`;
  }
  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-partie-tag]');
    if (t) { datum = t.dataset.partieTag; try { await lade(); } catch (x) { toast(x.message, 'warn'); } return zeichne(); }
    const a = e.target.closest('[data-anfrage]');
    if (a) {
      const dlg = dialog({ titel: 'Änderung beim Büro anfragen', inhalt: `<form id="anf" class="stack-s" novalidate><label class="field"><span class="field-label">Was soll geändert werden?</span><textarea class="input lg" name="text" rows="4" maxlength="500" required placeholder="z. B. Ich brauche morgen einen zweiten Maschinisten."></textarea></label><p class="form-err" role="alert" hidden></p></form>`, fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="anf">Senden</button>' });
      $('#anf', dlg.el).addEventListener('submit', async (ev) => {
        ev.preventDefault(); const text = String(new FormData(ev.target).get('text') || '').trim(); const err = $('.form-err', dlg.el);
        if (text.length < 3) { err.hidden = false; err.textContent = 'Bitte kurz beschreiben, was geändert werden soll.'; return; }
        try { await post('/plan/anfragen', { datum, text, ...(a.dataset.anfrage ? { einsatzId: Number(a.dataset.anfrage) } : {}) }); dlg.zu(); toast('Anfrage gesendet – Büro und Bauleiter sind benachrichtigt.'); } catch (x) { err.hidden = false; err.textContent = x.message; }
      });
    }
  });
  zeichne();
}
