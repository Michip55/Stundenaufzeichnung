// Stempeluhr: Status, laufende Zeit, Baustelle wählen, Kommen / Pause / Wechsel / Gehen.
// Ohne Netz wird die Buchung lokal gemerkt und später nachgesendet (siehe offline.js).
import { get, post } from '../api.js';
import { ic, esc, fmt, banner, dialog, toast, speicher, $, $$ } from '../ui.js';
import { einreihen, warteschlange, nachsenden, setzOnline } from '../offline.js';

const TYP = {
  kommen: ['Gekommen', 'tl-in'], gehen: ['Gegangen', 'tl-out'], pause_start: ['Pause begonnen', 'tl-pause'],
  pause_ende: ['Pause beendet', 'tl-in'], wechsel: ['Baustelle gewechselt', 'tl-swap'],
};
export const warnText = (w) => (typeof w === 'string' ? w : (w && (w.text || w.meldung || w.titel)) || '');

// Lokaler Folgezustand für Offline-Buchungen
function wendeAn(st, b) {
  const neu = { ...st, heute: { ...(st.heute || {}), buchungen: [...((st.heute && st.heute.buchungen) || []), { typ: b.typ, zeit: b.zeit, baustelleId: b.baustelleId, quelle: 'offline', ausstehend: true }] } };
  if (b.typ === 'kommen' || b.typ === 'wechsel') { neu.status = 'arbeit'; neu.seit = b.zeit; if (b.baustelleId != null) neu.baustelleId = b.baustelleId; }
  else if (b.typ === 'pause_start') { neu.status = 'pause'; neu.seit = b.zeit; }
  else if (b.typ === 'pause_ende') { neu.status = 'arbeit'; neu.seit = b.zeit; }
  else if (b.typ === 'gehen') { neu.status = 'aus'; neu.seit = b.zeit; }
  return neu;
}

async function standortHolen() {
  // Standort nur im Moment des Stempelns und nur, wenn in den Einstellungen eingeschaltet
  if (!speicher.lies('bt_standort', false) || !navigator.geolocation) return null;
  return new Promise((fertig) => {
    const t = setTimeout(() => fertig(null), 4000);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(t); fertig({ lat: p.coords.latitude, lng: p.coords.longitude, genauigkeit: Math.round(p.coords.accuracy) }); },
      () => { clearTimeout(t); fertig(null); },
      { enableHighAccuracy: true, timeout: 3500, maximumAge: 30000 },
    );
  });
}

export default async function stempeln(el, ctx) {
  let st = null;
  let baustellen = [];
  let offlineModus = false;
  let wahl = speicher.lies('bt_baustelle');
  let beschaeftigt = false;
  let timer = null;

  async function lade() {
    try {
      const [s, b] = await Promise.all([get('/zeit/status'), get('/baustellen')]);
      st = s; baustellen = b; offlineModus = false;
      speicher.setz('bt_status', { status: s.status, seit: s.seit, baustelleId: s.baustelleId, heute: s.heute, tag: fmt.iso() });
      speicher.setz('bt_baustellen', b.map((x) => ({ id: x.id, kst: x.kst, name: x.name, adresse: x.adresse, status: x.status }))); // ohne Beträge
    } catch (e) {
      if (!e.netz) throw e;
      setzOnline(false);
      offlineModus = true;
      const alt = speicher.lies('bt_status');
      st = alt && alt.tag === fmt.iso() ? alt : { status: 'aus', seit: null, baustelleId: null, heute: { stunden: 0, pauseMin: 0, buchungen: [] } };
      baustellen = speicher.lies('bt_baustellen', []);
    }
    // noch nicht gesendete Buchungen einrechnen
    for (const b of warteschlange()) st = wendeAn(st, b);
    st.heute = st.heute || { stunden: 0, pauseMin: 0, buchungen: [] };
    st.warnungen = st.warnungen || [];
  }
  const aktive = () => baustellen.filter((b) => !b.status || b.status === 'aktiv' || b.id === st.baustelleId);
  const bs = (id) => baustellen.find((b) => b.id === id);
  const bsName = (id) => { const b = bs(id); return b ? b.name : id != null ? `Baustelle ${id}` : ''; };

  function zeichne() {
    const u = ctx.ich.benutzer;
    const std = new Date().getHours();
    const gruss = std < 10 ? 'Guten Morgen' : std < 17 ? 'Servus' : 'Guten Abend';
    const laeuft = st.status === 'arbeit', pause = st.status === 'pause';
    if (st.status === 'aus' && (wahl == null || !bs(wahl))) wahl = (ctx.ich.baustellenIds || []).find((id) => aktive().some((b) => b.id === id)) ?? (aktive()[0] && aktive()[0].id);
    const b = bs(st.status === 'aus' ? wahl : st.baustelleId);
    const buch = st.heute.buchungen || [];
    const offen = warteschlange().length;

    const baustelleZeile = b
      ? `<span class="site-ic">${ic('pin')}</span><span class="site-txt"><small>${esc(b.kst || '')}</small><b>${esc(b.name)}</b>${b.adresse ? `<span>${esc(b.adresse)}</span>` : ''}</span>`
      : `<span class="site-ic">${ic('pin')}</span><span class="site-txt"><b>Keine Baustelle gewählt</b><span>Bitte Baustelle auswählen</span></span>`;

    let aktion;
    if (st.status === 'aus') {
      aktion = `
        <button type="button" class="site-row pick" data-akt="waehlen" aria-label="Baustelle wählen${b ? ': ' + esc(b.name) : ''}">${baustelleZeile}<span class="pick-cta">Ändern${ic('right')}</span></button>
        <button type="button" class="punch in" data-stempel="kommen" ${b ? '' : 'disabled'}><span class="punch-ic">${ic('play')}</span><span><b>Kommen</b><small>Arbeitsbeginn jetzt buchen</small></span></button>`;
    } else {
      aktion = `
        <div class="site-row">${baustelleZeile}</div>
        <div class="act-grid">
          ${pause
            ? `<button type="button" class="act-btn resume" data-stempel="pause_ende">${ic('play')}Pause beenden</button>`
            : `<button type="button" class="act-btn" data-stempel="pause_start">${ic('pause')}Pause</button>`}
          <button type="button" class="act-btn" data-akt="wechsel" ${pause ? 'disabled' : ''}>${ic('swap')}Baustelle wechseln</button>
        </div>
        <button type="button" class="punch out" data-stempel="gehen"><span class="punch-ic">${ic('logout')}</span><span><b>Gehen</b><small>Arbeitsende jetzt buchen</small></span></button>`;
    }

    el.innerHTML = `
    <div class="page"><div class="stempel-grid">
      <div class="stack">
        ${offlineModus || offen ? banner('warn', offen ? `<b>${offen} Buchung${offen > 1 ? 'en' : ''} noch nicht gesendet.</b> Wird automatisch nachgesendet, sobald Verbindung besteht.` : '<b>Keine Verbindung.</b> Stempeln funktioniert – die Buchung wird gespeichert und später gesendet.', 'wifiOff') : ''}
        <section class="card clock-card ${laeuft ? 'running' : pause ? 'paused' : ''}" aria-label="Stempeluhr" data-status="${esc(st.status)}">
          <div class="cc-greet">${gruss}, ${esc(u.name.split(' ')[0])}</div>
          ${st.status === 'aus'
            ? `<div class="cc-time" id="cc-zeit" aria-live="off">${fmt.uhr(new Date().toISOString())}</div><div class="cc-date">${esc(fmt.datumLang(new Date()))} · <span class="run-state aus">Nicht eingestempelt</span></div>`
            : `<div class="run-state"><i class="pulse"></i>${laeuft ? 'Arbeitszeit läuft' : 'Pause läuft'}<span>seit ${fmt.uhr(st.seit)} Uhr</span></div><div class="cc-time big" id="cc-zeit" role="timer" aria-label="${laeuft ? 'Arbeitszeit' : 'Pause'} seit ${fmt.uhr(st.seit)} Uhr">${fmt.dauer(Date.now() - new Date(st.seit).getTime())}</div><div class="cc-date">${esc(fmt.datumLang(new Date()))}</div>`}
          ${aktion}
          <p class="cc-note">${ic('info')}<span>${speicher.lies('bt_standort', false) ? 'Standort wird nur im Moment des Stempelns erfasst – keine laufende Ortung.' : 'Standort wird nicht erfasst (in „Mehr“ einschaltbar, dann nur im Moment des Stempelns).'}</span></p>
        </section>
        ${(st.warnungen || []).map((w) => banner('warn', esc(warnText(w)))).join('')}
      </div>
      <div class="stack">
        <section class="card pad">
          <div class="card-h"><h3>Heute</h3><span class="chip st-outline">${esc(fmt.datumKurz(new Date()))}</span></div>
          <div class="sum-grid"><div><small>Arbeitszeit</small><b>${fmt.hm(st.heute.stunden || 0)} <i>Std.</i></b></div><div><small>Pause</small><b>${fmt.zahl(st.heute.pauseMin || 0, 0)} <i>min</i></b></div></div>
          ${buch.length ? `<ol class="timeline" aria-label="Buchungen heute">${buch.map((x) => { const [t, c] = TYP[x.typ] || [x.typ, '']; return `<li class="${c}"><time>${esc(x.uhrzeit || fmt.uhr(x.zeit))}</time><i></i><div><b>${esc(t)}</b><small>${esc(bsName(x.baustelleId))}${x.ausstehend ? ' · <em class="pend">noch nicht gesendet</em>' : x.quelle === 'offline' ? ' · offline nachgebucht' : x.quelle === 'kolonne' ? ' · durch Polier' : ''}</small></div></li>`; }).join('')}</ol>` : `<div class="state empty small">${ic('clock')}<p>Heute noch keine Buchung.</p></div>`}
        </section>
        <a class="card pad link-card" href="#/woche">${ic('calendar')}<span><b>Meine Woche</b><small>Stunden, Überstunden und Abwesenheiten</small></span>${ic('right')}</a>
      </div>
    </div></div>`;
    clearInterval(timer);
    timer = setInterval(() => {
      const z = $('#cc-zeit', el); if (!z) return;
      z.textContent = st.status === 'aus' ? fmt.uhr(new Date().toISOString()) : fmt.dauer(Date.now() - new Date(st.seit).getTime());
    }, 1000);
  }

  function waehleBaustelle(titel) {
    const liste = aktive();
    const d = dialog({ titel, inhalt: liste.length ? `<div class="pick-list">${liste.map((b) => `<button type="button" class="pick-row${b.id === (st.status === 'aus' ? wahl : st.baustelleId) ? ' sel' : ''}" data-bs="${b.id}"><span class="site-ic">${ic('pin')}</span><span class="pick-txt"><small>${esc(b.kst || '')}</small><b>${esc(b.name)}</b><span>${esc(b.adresse || '')}</span></span>${ic('right')}</button>`).join('')}</div>` : `<div class="state empty"><p>Keine aktive Baustelle vorhanden.</p></div>` });
    d.el.addEventListener('click', (e) => { const r = e.target.closest('[data-bs]'); if (r) d.zu(Number(r.dataset.bs)); });
    return d.geschlossen;
  }

  async function stemple(typ, baustelleId) {
    if (beschaeftigt) return;
    beschaeftigt = true;
    $$('[data-stempel],[data-akt]', el).forEach((b) => { b.disabled = true; });
    const zeit = new Date().toISOString();
    const body = { typ };
    if (baustelleId != null) body.baustelleId = baustelleId;
    try {
      const ort = await standortHolen();
      if (ort) body.standort = ort;
      if (warteschlange().length) await nachsenden(); // Reihenfolge wahren
      if (warteschlange().length) throw { netz: true };
      await post('/zeit/stempeln', body);
      setzOnline(true);
      toast((TYP[typ] || [typ])[0] + ' – gebucht.');
    } catch (e) {
      if (e.netz) {
        einreihen({ ...body, zeit });
        toast('Keine Verbindung – Buchung gespeichert, wird nachgesendet.', 'warn');
      } else {
        toast(e.message, 'warn');
      }
    }
    beschaeftigt = false;
    if (!ctx.aktuell()) return;
    try { await lade(); zeichne(); } catch (e) { toast(e.message, 'warn'); }
  }

  el.addEventListener('click', async (e) => {
    const s = e.target.closest('[data-stempel]');
    if (s && !s.disabled) { stemple(s.dataset.stempel, s.dataset.stempel === 'kommen' ? wahl : undefined); return; }
    const a = e.target.closest('[data-akt]');
    if (!a || a.disabled) return;
    if (a.dataset.akt === 'waehlen') {
      const id = await waehleBaustelle('Baustelle wählen');
      if (id != null) { wahl = id; speicher.setz('bt_baustelle', id); zeichne(); }
    } else if (a.dataset.akt === 'wechsel') {
      const id = await waehleBaustelle('Auf welche Baustelle wechseln?');
      if (id != null && id !== st.baustelleId) { speicher.setz('bt_baustelle', id); stemple('wechsel', id); }
    }
  });

  await lade();
  zeichne();
  return () => clearInterval(timer);
}
