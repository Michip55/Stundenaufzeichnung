// Stempeluhr: Status, laufende Zeit, Baustelle wählen, Kommen / Pause / Wechsel / Gehen.
// Ohne Netz wird die Buchung lokal gemerkt und später nachgesendet (siehe offline.js).
import { get, post, sitzungGeneration } from '../api.js';
import { ic, esc, fmt, banner, dialog, bestaetigen, toast, speicher, wieBuero, istIntern, $, $$ } from '../ui.js';
import { zaehlerAbfrage } from './fuhrpark-dialoge.js';
import { schadenMelden } from './schaeden.js';
import { einreihen, warteschlange, nachsenden, setzOnline, vorlaeufig, abgelehnte, abgelehntErledigt, buchungText, wartetAufStandort, standortZurBuchung } from '../offline.js';
import { pauseWaehlen, pausenAuswahl, merkeAuswahl, bisText, pauseFrageBeimGehen } from '../pausen.js';
import { grussName, schichtStart, fragePauseBeimGehen } from '../pause-gehen.js';
import { stundenImText } from '../zahl.js';
import { ortHolen, genauText } from '../standort.js';
import { standortEingeschaltet, standortAltEntfernen, nachtragLaeuft, nachtragLaeuftSchon, nachtragErgebnis, nachtragMerken, nachtragStandort, nachtragErledigt, nachtraegeGemerkt } from '../standort-einwilligung.js';

const TYP = {
  kommen: ['Gekommen', 'tl-in'], gehen: ['Gegangen', 'tl-out'], pause_start: ['Pause begonnen', 'tl-pause'],
  pause_ende: ['Pause beendet', 'tl-in'], wechsel: ['Baustelle gewechselt', 'tl-swap'],
};
// 15.25: Stunden in Server-Hinweisen („11,08 Std.“) als „11 Std. 5 Min.“ zeigen – der Text der API bleibt unverändert
export const warnTextRoh = (w) => (typeof w === 'string' ? w : (w && (w.text || w.meldung || w.titel)) || '');
export const warnText = (w) => stundenImText(warnTextRoh(w));

/**
 * 15.22: Pause mit fester Dauer ist bis `bis` (ms) abgelaufen → lokal wie am Server: Arbeit ab dem geplanten Ende.
 * (Der Server trägt das Ende selbst ein; hier nur die Anzeige ohne Netz bzw. bis zum nächsten Laden.)
 */
export function autoEnde(st, bis = Date.now()) {
  if (!st || st.status !== 'pause' || !st.pauseBis || new Date(st.pauseBis).getTime() > bis) return st;
  const buch = (st.heute && st.heute.buchungen) || [];
  return { ...st, status: 'arbeit', seit: st.pauseBis, pauseBis: null, pauseDauerMin: null,
    heute: { ...(st.heute || {}), buchungen: [...buch, { typ: 'pause_ende', zeit: st.pauseBis, baustelleId: st.baustelleId, automatisch: true, lokal: true }] } };
}

// Lokaler Folgezustand für Offline-Buchungen
function wendeAn(st, b) {
  st = autoEnde(st, new Date(b.zeit).getTime()); // eine geplante Pause war vor dieser Buchung schon zu Ende
  const alt = (st.heute && st.heute.buchungen) || [];
  // 15.27: „Gehen“ mit nachgetragener Pause – Beginn und Ende der Pause vor dem „Gehen“ in die Zeitleiste
  const nt = b.typ === 'gehen' && b.pauseBeimGehen && b.pauseBeimGehen.beginn ? b.pauseBeimGehen : null;
  const ntBs = nt ? (alt.filter((x) => (x.typ === 'kommen' || x.typ === 'wechsel') && new Date(x.zeit) <= new Date(nt.beginn)).map((x) => x.baustelleId).pop() ?? st.baustelleId) : null;
  const pauseZeilen = nt ? [
    { typ: 'pause_start', zeit: nt.beginn, baustelleId: ntBs, quelle: 'offline', ausstehend: true, nachgetragen: true, dauerMin: nt.dauerMin },
    { typ: 'pause_ende', zeit: new Date(new Date(nt.beginn).getTime() + nt.dauerMin * 60000).toISOString(), baustelleId: ntBs, quelle: 'offline', ausstehend: true, nachgetragen: true },
  ] : [];
  let buchungen = [...alt, ...pauseZeilen, { typ: b.typ, zeit: b.zeit, baustelleId: b.baustelleId, quelle: 'offline', ausstehend: true, ...(b.dauerMin ? { dauerMin: b.dauerMin } : {}) }];
  if (nt) buchungen = buchungen.map((x, i) => ({ x, i })).sort((a, c) => new Date(a.x.zeit) - new Date(c.x.zeit) || a.i - c.i).map((y) => y.x);
  const neu = { ...st, heute: { ...(st.heute || {}), buchungen, ...(nt ? { pauseMin: ((st.heute && st.heute.pauseMin) || 0) + nt.dauerMin } : {}) } };
  neu.pauseBis = null; neu.pauseDauerMin = null;
  if (b.typ === 'kommen') { neu.schichtBeginn = b.zeit; neu.pauseInSchicht = false; }
  if (b.typ === 'kommen' || b.typ === 'wechsel') { neu.status = 'arbeit'; neu.seit = b.zeit; if (b.baustelleId != null) neu.baustelleId = b.baustelleId; }
  else if (b.typ === 'pause_start') { neu.status = 'pause'; neu.seit = b.zeit; neu.pauseInSchicht = true; if (b.dauerMin) { neu.pauseBis = new Date(new Date(b.zeit).getTime() + b.dauerMin * 60000).toISOString(); neu.pauseDauerMin = b.dauerMin; } }
  else if (b.typ === 'pause_ende') { neu.status = 'arbeit'; neu.seit = b.zeit; }
  else if (b.typ === 'gehen') { neu.status = 'aus'; neu.seit = b.zeit; neu.schichtBeginn = null; neu.pauseInSchicht = false; }
  return neu;
}

// 15.30: Standort nur im Moment des Stempelns und nur, wenn die Person es selbst eingeschaltet hat (je Person am Server).
// Die Buchung geht sofort mit der Zeit des Drückens hinaus; die Ortung (bis 15 s) wird danach angehängt.
const ORT = { timeout: 15000, maximumAge: 60000 };
const ORT_TEXT = {
  laeuft: () => 'Standort wird ermittelt …',
  ok: (o) => `Standort erfasst${genauText(o.genauigkeit) ? ` (${genauText(o.genauigkeit)})` : ''}${o.offline ? ' – wird mit der Buchung gesendet' : ''}`,
  fehlt: () => 'Standort nicht verfügbar',
  verweigert: () => 'Standort nicht verfügbar – das Gerät erlaubt BauTag keinen Zugriff (siehe „Mehr“)',
};
const ortHtml = (o) => `<p class="cc-standort" id="cc-standort" role="status" aria-live="polite"${o ? ` data-zustand="${o.zustand}"` : ' hidden'}>${o ? `${ic('pin', 'xs')}<span>${esc(ORT_TEXT[o.zustand](o))}</span>` : ''}</p>`;

export default async function stempeln(el, ctx) {
  let st = null;
  let baustellen = [];
  let offlineModus = false;
  let wahl = speicher.lies('bt_baustelle');
  let beschaeftigt = false;
  let timer = null;
  let ort = null; // 15.30: Standort der letzten Stempelung {zustand:'laeuft'|'ok'|'fehlt'|'verweigert', genauigkeit?, offline?}
  let ortLauf = 0;

  async function lade() {
    try {
      const [s, b] = await Promise.all([get('/zeit/status'), get('/baustellen')]);
      st = s; baustellen = b; offlineModus = false;
      // Baustellenplaner: heutiger veröffentlichter Einsatz → diese Baustelle vorschlagen (einmal je Tag, danach gilt die eigene Wahl)
      if (s.status === 'aus' && s.geplant && b.some((x) => x.id === s.geplant.baustelleId) && speicher.lies('bt_plan_vorschlag') !== `${fmt.iso()}:${s.geplant.baustelleId}`) { wahl = s.geplant.baustelleId; speicher.setz('bt_plan_vorschlag', `${fmt.iso()}:${s.geplant.baustelleId}`); speicher.setz('bt_baustelle', wahl); }
      // 12.25: Büro, Bauleiter und Geschäftsführung stempeln im Regelfall auf die interne Kostenstelle „Büro“ – einmal am Tag
      // vorgeschlagen; eine andere Wahl (echte Baustelle) bleibt danach erhalten. Alle anderen: nur wenn noch nichts gewählt ist.
      if (s.status === 'aus' && s.standardKostenstelleId != null && !s.geplant && b.some((x) => x.id === s.standardKostenstelleId)) {
        const marke = `${fmt.iso()}:${s.standardKostenstelleId}`;
        if (wieBuero(ctx.ich.benutzer.rolle) /* rolle-ok: nur Vorschlag der eigenen Kostenstelle (12.25), keine Rechteprüfung */ ? speicher.lies('bt_kst_standard') !== marke : wahl == null || !b.some((x) => x.id === wahl)) { wahl = s.standardKostenstelleId; speicher.setz('bt_kst_standard', marke); speicher.setz('bt_baustelle', wahl); }
      }
      speicher.setz('bt_status', { status: s.status, seit: s.seit, baustelleId: s.baustelleId, schichtBeginn: s.schichtBeginn || null, pauseInSchicht: !!s.pauseInSchicht, pauseBis: s.pauseBis || null, pauseDauerMin: s.pauseDauerMin || null, heute: s.heute, tag: fmt.iso() });
      if (Array.isArray(s.pausenAuswahl)) merkeAuswahl(s.pausenAuswahl); // 15.22: Auswahl auch ohne Netz anbieten
      speicher.setz('bt_baustellen', b.map((x) => ({ id: x.id, kst: x.kst, name: x.name, adresse: x.adresse, status: x.status, intern: istIntern(x) }))); // ohne Beträge
    } catch (e) {
      if (!e.netz) throw e;
      setzOnline(false);
      offlineModus = true;
      const alt = speicher.lies('bt_status');
      // Eine laufende Schicht gilt auch nach Mitternacht weiter (M-04); nur die Tagesliste beginnt neu
      const laeuftNoch = alt && alt.status !== 'aus' && alt.seit && Date.now() - new Date(alt.seit).getTime() < 24 * 3600e3;
      st = alt && alt.tag === fmt.iso() ? alt
        : laeuftNoch ? { ...alt, heute: { stunden: 0, pauseMin: 0, buchungen: [] } }
        : { status: 'aus', seit: null, baustelleId: null, heute: { stunden: 0, pauseMin: 0, buchungen: [] } };
      baustellen = speicher.lies('bt_baustellen', []);
    }
    // noch nicht gesendete Buchungen einrechnen
    for (const b of warteschlange()) st = wendeAn(st, b);
    st = autoEnde(st); // 15.22: geplante Pause inzwischen vorbei (ohne Netz bzw. Server noch nicht gefragt)
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
    const abg = abgelehnte();

    const baustelleZeile = b
      ? `<span class="site-ic">${ic('pin')}</span><span class="site-txt"><small>${esc(b.kst || '')}</small><b>${esc(b.name)}</b>${b.adresse ? `<span>${esc(b.adresse)}</span>` : ''}</span>`
      : `<span class="site-ic">${ic('pin')}</span><span class="site-txt"><b>Keine Baustelle gewählt</b><span>Bitte Baustelle auswählen</span></span>`;

    let aktion;
    if (st.status === 'aus') {
      aktion = `
        ${st.geplant ? `<p class="plan-vorschlag" id="plan-vorschlag" data-geplant="${st.geplant.baustelleId}">${ic('calendar', 'xs')}<span>Heute eingeplant: <b>${esc(st.geplant.name || '')}</b>${st.geplant.beginn ? ` · ${esc(st.geplant.beginn)} Uhr` : ''}${st.geplant.treffpunkt ? ` · Treffpunkt ${esc(st.geplant.treffpunkt)}` : ''}</span></p>` : ''}
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
          <div class="cc-greet">${gruss}, ${esc(grussName(u.name))}</div>
          ${st.status === 'aus'
            ? `<div class="cc-time" id="cc-zeit" aria-live="off">${fmt.uhr(new Date().toISOString())}</div><div class="cc-date">${esc(fmt.datumLang(new Date()))} · <span class="run-state aus">Nicht eingestempelt</span></div>`
            : `<div class="run-state"><i class="pulse"></i>${laeuft ? 'Arbeitszeit läuft' : 'Pause läuft'}<span>seit ${fmt.uhr(st.seit)} Uhr</span></div><div class="cc-time big" id="cc-zeit" role="timer" aria-label="${laeuft ? 'Arbeitszeit' : 'Pause'} seit ${fmt.uhr(st.seit)} Uhr">${fmt.dauer(Date.now() - new Date(st.seit).getTime())}</div>${pause ? `<div class="pause-bis" id="pause-bis" data-bis="${esc(st.pauseBis || '')}">${ic('clock', 'xs')}${st.pauseBis ? `<span>${esc(bisText(st.pauseBis))} Uhr</span> <small class="muted">· endet von selbst</small>` : '<span>Pause offen</span> <small class="muted">· bis „Pause beenden“</small>'}</div>` : ''}<div class="cc-date">${esc(fmt.datumLang(new Date()))}</div>`}
          ${aktion}
          ${ortHtml(ort)}
          <p class="cc-note" id="cc-standort-note">${ic('info')}<span>${standortEingeschaltet(ctx) ? 'Standort wird nur im Moment des Stempelns erfasst – keine laufende Ortung.' : 'Standort wird nicht erfasst (freiwillig – in „Mehr“ selbst einschaltbar, dann nur im Moment des Stempelns).'}</span></p>
        </section>
        ${(st.warnungen || []).map((w) => banner('warn', esc(warnText(w)))).join('')}
        ${abg.length ? `<section class="card" id="abgelehnt" aria-labelledby="h-abg">
          <div class="card-h pad-h"><h3 id="h-abg">${ic('alert')}Nicht übernommene Buchungen <span class="count red">${abg.length}</span></h3></div>
          <ul class="plain rows">${abg.map((x) => `<li data-nr="${esc(x.nr)}"><span class="grow"><b>${esc((TYP[x.typ] || [x.typ])[0])} · ${esc(buchungText(x))}</b><small>${esc(bsName(x.baustelleId))}</small><small class="abg-grund">Grund: ${esc(x.grund || 'vom Server abgelehnt')}</small></span>
            <span class="abg-akt"><button type="button" class="btn ghost sm" data-abg-kopie="${esc(x.nr)}">Text fürs Büro kopieren</button><button type="button" class="btn ghost sm" data-abg-weg="${esc(x.nr)}">Erledigt</button></span></li>`).join('')}</ul>
          <p class="card-note">Diese Buchungen wurden offline erfasst, vom Server aber nicht angenommen. Bitte dem Büro melden – es kann die Zeit nachtragen. Die Einträge bleiben hier, bis sie als erledigt bestätigt werden.</p>
        </section>` : ''}
      </div>
      <div class="stack">
        <section class="card pad">
          <div class="card-h"><h3>Heute</h3><span class="chip st-outline">${esc(fmt.datumKurz(new Date()))}</span></div>
          <div class="sum-grid"><div><small>Arbeitszeit</small><b id="heute-arbeitszeit">${fmt.stdLangHtml(st.heute.stunden || 0)}</b></div><div><small>Pause</small><b id="heute-pause">${fmt.zahl(st.heute.pauseMin || 0, 0)}\u00a0<i>Min.</i></b></div></div>
          ${buch.length ? `<ol class="timeline" aria-label="Buchungen heute">${buch.map((x) => { const [t, c] = TYP[x.typ] || [x.typ, '']; return `<li class="${c}"${x.automatisch ? ' data-automatisch' : ''}${x.nachgetragen ? ' data-nachgetragen' : ''}><time>${esc(x.uhrzeit || fmt.uhr(x.zeit))}</time><i></i><div><b>${esc(t)}${x.typ === 'pause_start' && x.dauerMin ? ` (${x.dauerMin} Min)` : ''}${x.automatisch ? ' – automatisch' : ''}</b><small>${esc(bsName(x.baustelleId))}${x.nachgetragen ? ' · beim Gehen nachgetragen' : ''}${x.ausstehend ? ' · <em class="pend">noch nicht gesendet</em>' : x.nachgetragen ? '' : x.quelle === 'offline' ? ' · offline nachgebucht' : x.quelle === 'kolonne' ? ' · durch Polier' : ''}</small></div></li>`; }).join('')}</ol>` : `<div class="state empty small">${ic('clock')}<p>Heute noch keine Buchung.</p></div>`}
        </section>
        <button type="button" class="card pad link-card" id="schaden-kurz" data-akt="schaden">${ic('camera')}<span><b>Schaden melden</b><small>Defekt oder Unfall an Fahrzeug oder Gerät – mit Fotos</small></span>${ic('right')}</button>
        <a class="card pad link-card" href="#/woche">${ic('calendar')}<span><b>Meine Woche</b><small>Stunden, Überstunden und Abwesenheiten</small></span>${ic('right')}</a>
      </div>
    </div></div>`;
    clearInterval(timer);
    timer = setInterval(() => {
      const z = $('#cc-zeit', el); if (!z) return;
      // 15.22: geplante Pause zu Ende → Anzeige sofort auf „Arbeitszeit läuft“, dann (mit Netz) den Stand des Servers holen
      if (st.status === 'pause' && st.pauseBis && Date.now() >= new Date(st.pauseBis).getTime() && !beschaeftigt) {
        st = autoEnde(st); zeichne();
        if (!offlineModus) lade().then(() => { if (ctx.aktuell()) zeichne(); }).catch(() => {});
        return;
      }
      z.textContent = st.status === 'aus' ? fmt.uhr(new Date().toISOString()) : fmt.dauer(Date.now() - new Date(st.seit).getTime());
    }, 1000);
  }

  function waehleBaustelle(titel) {
    const liste = aktive();
    const d = dialog({ titel, inhalt: liste.length ? `<div class="pick-list">${liste.map((b) => `<button type="button" class="pick-row${b.id === (st.status === 'aus' ? wahl : st.baustelleId) ? ' sel' : ''}" data-bs="${b.id}"${istIntern(b) ? ' data-intern' : ''}><span class="site-ic">${ic('pin')}</span><span class="pick-txt"><small>${esc(b.kst || '')}</small><b>${esc(b.name)}</b><span>${istIntern(b) ? 'Interne Kostenstelle' : esc(b.adresse || '')}</span></span>${ic('right')}</button>`).join('')}</div>` : `<div class="state empty"><p>Keine aktive Baustelle vorhanden.</p></div>` });
    d.el.addEventListener('click', (e) => { const r = e.target.closest('[data-bs]'); if (r) d.zu(Number(r.dataset.bs)); });
    return d.geschlossen;
  }

  async function stemple(typ, baustelleId, dauerMin, pauseAngabe) {
    if (beschaeftigt) return;
    beschaeftigt = true;
    $$('[data-stempel],[data-akt]', el).forEach((b) => { b.disabled = true; });
    const zeit = new Date().toISOString();
    // 15.30: Ortung gleich beim Drücken starten – die Buchung wartet nicht darauf
    const ortP = standortEingeschaltet(ctx) ? ortHolen(ORT) : null;
    const lauf = ++ortLauf;
    ort = ortP ? { zustand: 'laeuft' } : null;
    const ortZeile = $('#cc-standort', el); if (ortZeile) ortZeile.outerHTML = ortHtml(ort);
    let buchungId = null, nr = null;
    const body = { typ };
    if (typ === 'pause_start' && dauerMin != null) body.dauerMin = dauerMin; // 15.22
    if (typ === 'gehen' && pauseAngabe) body.pauseBeimGehen = pauseAngabe; // 15.27: eine Buchung – Pause und Gehen zusammen
    const ntText = body.pauseBeimGehen ? ` Pause ${body.pauseBeimGehen.dauerMin} Min ab ${fmt.uhr(body.pauseBeimGehen.beginn)} Uhr nachgetragen.` : '';
    let abfrage = null;
    if (baustelleId != null) body.baustelleId = baustelleId;
    try {
      if (warteschlange().length) await nachsenden(); // Reihenfolge wahren
      if (warteschlange().length) throw { netz: navigator.onLine === false, status: 503, reihe: warteschlange().every(wartetAufStandort) };
      const antwort = await post('/zeit/stempeln', body);
      buchungId = antwort && antwort.buchungId;
      if (typ === 'gehen' && antwort && Array.isArray(antwort.zaehlerAbfrage) && antwort.zaehlerAbfrage.length) abfrage = antwort.zaehlerAbfrage;
      setzOnline(true);
      // 15.27: Pause war inzwischen schon gebucht (z. B. vom Polier) – Gehen gebucht, die Angabe nicht übernommen
      const verworfen = body.pauseBeimGehen && antwort && antwort.pauseVerworfen ? ' Deine Pausenangabe wurde nicht übernommen – in dieser Schicht war schon eine Pause gebucht.' : '';
      toast((TYP[typ] || [typ])[0] + (body.dauerMin ? ` – ${body.dauerMin} Min, endet um ${fmt.uhr(new Date(new Date(zeit).getTime() + body.dauerMin * 60000).toISOString())} Uhr.` : ' – gebucht.') + (verworfen || ntText), verworfen ? 'warn' : undefined);
    } catch (e) {
      if (vorlaeufig(e)) {
        // Kein Netz oder Server gerade nicht bereit: Buchung behalten und später senden
        nr = einreihen({ ...body, zeit, ...(ortP ? { standortWartet: Date.now() } : {}) });
        if (e.netz) setzOnline(false);
        toast((e.netz ? 'Keine Verbindung – Buchung gespeichert, wird nachgesendet.' : e.reihe ? 'Buchung gespeichert – wird gleich nach der vorigen gesendet.' : 'Server gerade nicht erreichbar – Buchung gespeichert, wird nachgesendet.') + ntText, 'warn');
      } else {
        toast(e.message, 'warn');
      }
    }
    beschaeftigt = false;
    if (ortP) {
      if (buchungId || nr) standortAnhaengen(ortP, { buchungId, nr, lauf });
      else if (lauf === ortLauf) ort = null; // nichts gebucht (abgelehnt) – kein Standort
    }
    if (!ctx.aktuell()) return;
    try { await lade(); zeichne(); } catch (e) { toast(e.message, 'warn'); }
    // Servicebuch 7.3: nach dem Ausstempeln um den Kilometer-/Betriebsstundenstand bitten (überspringbar)
    if (abfrage) zaehlerAbfrage(ctx, abfrage);
  }

  /**
   * 15.30: Ergebnis der Ortung an die eben gebuchte Stempelung hängen (online: eigene Schnittstelle, offline: in die
   * Warteschlange). Der Nachtrag läuft weiter, wenn die Ansicht wechselt; das Abmelden wartet kurz auf ihn (app.js), und am
   * Gerät gemerkt holt ihn die Stempeluhr nach einem Neuladen nach (nachtraegeFortsetzen). `standort`: schon ermittelt.
   */
  function standortAnhaengen(ortP, { buchungId, nr, lauf, standort = null }) {
    const gen = sitzungGeneration();
    if (buchungId) nachtragMerken(ctx.ich.benutzer.id, buchungId);
    return ortAnzeigen(lauf, nachtragLaeuft(buchungId ? `b${buchungId}` : `q${nr}`, (async () => {
      const r = standort ? { standort } : await ortP;
      let neu;
      if (!r.standort) {
        if (nr) standortZurBuchung(nr, null); else nachtragErledigt(buchungId);
        neu = { zustand: r.fehler === 'verweigert' ? 'verweigert' : 'fehlt' };
      } else if (nr) {
        neu = standortZurBuchung(nr, r.standort) ? { zustand: 'ok', genauigkeit: r.standort.genauigkeit, offline: true } : { zustand: 'fehlt' };
      } else {
        nachtragStandort(buchungId, r.standort); // falls die App jetzt geschlossen wird
        neu = { zustand: 'fehlt' };
        let behalten = false;
        for (let versuch = 0; versuch < 3 && gen === sitzungGeneration(); versuch++) {
          // vorAbmelden: geht noch unter der Sitzung der Person hinaus, auch wenn sie gerade abmeldet (das Abmelden wartet darauf)
          try { await post(`/zeit/stempeln/${buchungId}/standort`, { standort: r.standort }, { vorAbmelden: true }); neu = { zustand: 'ok', genauigkeit: r.standort.genauigkeit }; break; }
          catch (e) { if (!vorlaeufig(e)) break; behalten = versuch === 2; if (!behalten) await new Promise((w) => setTimeout(w, 4000)); }
        }
        if (!behalten) nachtragErledigt(buchungId); // ohne Netz: gemerkt lassen, die Stempeluhr versucht es später noch einmal
      }
      return neu;
    })().catch(() => null)));
  }
  /** Ergebnis eines (laufenden) Nachtrags anzeigen – auch in einer neueren Stempeluhr-Ansicht, die ihn nicht selbst gestartet hat */
  function ortAnzeigen(lauf, p) {
    p.then((neu) => {
      if (!neu || lauf !== ortLauf) return; // inzwischen neu gestempelt – die Anzeige gehört der neueren Stempelung
      ort = neu;
      const z = ctx.aktuell() && $('#cc-standort', el);
      if (z) z.outerHTML = ortHtml(ort);
    });
    return p;
  }

  /**
   * 15.30: am Gerät gemerkte Nachträge dieser Person (App nach dem Stempeln geschlossen oder neu geladen) nachholen – aber nur
   * mit dem Standort, der beim Stempeln schon ermittelt war. Prüfbefund n8-g: keine neue Ortung beim Öffnen; ein späterer Ort
   * (bis zu 10 Minuten danach, z. B. schon unterwegs) gehört nicht zur Stempelung. Ohne gemerkten Standort → verworfen.
   */
  function nachtraegeFortsetzen() {
    const gemerkt = nachtraegeGemerkt(ctx.ich.benutzer.id);
    // läuft schon (z. B. aus einer eben ersetzten Ansicht derselben Seite): nur das Ergebnis hier anzeigen
    for (const x of gemerkt.filter((y) => nachtragLaeuftSchon(`b${y.buchungId}`))) { ort = { zustand: 'laeuft' }; ortAnzeigen(++ortLauf, nachtragErgebnis(`b${x.buchungId}`)); }
    const offen = gemerkt.filter((x) => !nachtragLaeuftSchon(`b${x.buchungId}`));
    if (!offen.length) return;
    if (!standortEingeschaltet(ctx)) { offen.forEach((x) => nachtragErledigt(x.buchungId)); return; }
    for (const x of offen) {
      if (!x.standort) { nachtragErledigt(x.buchungId); continue; }
      ort = { zustand: 'laeuft' };
      standortAnhaengen(null, { buchungId: x.buchungId, lauf: ++ortLauf, standort: x.standort });
    }
  }

  el.addEventListener('click', async (e) => {
    const s = e.target.closest('[data-stempel]');
    if (s && !s.disabled && s.dataset.stempel === 'pause_start') {
      // 15.22: Pause mit fester Dauer (endet von selbst) oder offen
      const w = await pauseWaehlen({ auswahl: Array.isArray(st.pausenAuswahl) ? st.pausenAuswahl : pausenAuswahl() });
      if (w === undefined || !ctx.aktuell()) return;
      stemple('pause_start', undefined, w === 'offen' ? null : w);
      return;
    }
    if (s && !s.disabled && s.dataset.stempel === 'gehen' && fragePauseBeimGehen(st)) {
      // 15.27: heute (in dieser Schicht) keine Pause gestempelt → vor dem Gehen nach der Pause fragen; Abbrechen bucht nichts.
      // Mit Netz zuerst den Stand frisch holen: der Polier kann die Pause inzwischen über die Kolonne gebucht oder die Baustelle
      // gewechselt haben (die Stempeluhr lädt nicht laufend nach). Ohne Netz gilt der gespeicherte Stand – sollte die Pause
      // dann schon gebucht sein, nimmt der Server das Gehen trotzdem an und verwirft nur die Pausenangabe.
      if (beschaeftigt) return;
      if (!offlineModus && navigator.onLine !== false && !warteschlange().length) {
        beschaeftigt = true;
        try { await lade(); zeichne(); } catch (err) { /* alter Stand bleibt – der Server prüft ohnehin */ }
        beschaeftigt = false;
        if (!ctx.aktuell()) return;
      }
    }
    if (s && !s.disabled && s.dataset.stempel === 'gehen' && fragePauseBeimGehen(st)) {
      const auswahl = (Array.isArray(st.pausenAuswahl) ? st.pausenAuswahl : pausenAuswahl()).filter((m) => Number.isInteger(m) && m > 0);
      if (auswahl.length) {
        const start = schichtStart(st);
        const w = await pauseFrageBeimGehen({ auswahl, start, buchungen: (st.heute.buchungen || []).filter((x) => new Date(x.zeit).getTime() >= start) });
        if (w === undefined || !ctx.aktuell()) return;
        stemple('gehen', undefined, undefined, w === 'keine' ? null : w);
        return;
      }
    }
    if (s && !s.disabled) { stemple(s.dataset.stempel, s.dataset.stempel === 'kommen' ? wahl : undefined); return; }
    const kopie = e.target.closest('[data-abg-kopie]');
    if (kopie) {
      const x = abgelehnte().find((y) => y.nr === kopie.dataset.abgKopie); if (!x) return;
      const text = `Nicht übernommene Stempelung: ${ctx.ich.benutzer.name}, ${(TYP[x.typ] || [x.typ])[0]} am ${buchungText(x)}${bsName(x.baustelleId) ? ', ' + bsName(x.baustelleId) : ''}. Grund: ${x.grund || 'abgelehnt'}. Bitte nachtragen.`;
      try { await navigator.clipboard.writeText(text); toast('Text kopiert – bitte ans Büro schicken.'); }
      catch (err) { dialog({ titel: 'Text fürs Büro', inhalt: `<p>${esc(text)}</p>`, fuss: '<button class="btn primary" type="button" data-zu>Schließen</button>' }); }
      return;
    }
    const weg = e.target.closest('[data-abg-weg]');
    if (weg) {
      if (await bestaetigen('Als erledigt markieren?', 'Die Buchung wird aus dieser Liste entfernt. Bitte nur bestätigen, wenn das Büro Bescheid weiß oder die Buchung nicht mehr gebraucht wird.', 'Erledigt')) { abgelehntErledigt(weg.dataset.abgWeg); zeichne(); }
      return;
    }
    const a = e.target.closest('[data-akt]');
    if (!a || a.disabled) return;
    if (a.dataset.akt === 'schaden') { schadenMelden(ctx, { baustelleId: st.status !== 'aus' && st.baustelleId != null ? st.baustelleId : null }); return; }
    if (a.dataset.akt === 'waehlen') {
      const id = await waehleBaustelle('Baustelle wählen');
      if (id != null) { wahl = id; speicher.setz('bt_baustelle', id); zeichne(); }
    } else if (a.dataset.akt === 'wechsel') {
      const id = await waehleBaustelle('Auf welche Baustelle wechseln?');
      if (id != null && id !== st.baustelleId) { speicher.setz('bt_baustelle', id); stemple('wechsel', id); }
    }
  });

  standortAltEntfernen(); // 15.30: alte Wahl nur am Gerät (bt_standort) gilt nicht als Einwilligung – entfernen
  nachtraegeFortsetzen();
  await lade();
  zeichne();
  return () => clearInterval(timer);
}
