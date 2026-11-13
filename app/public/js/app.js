// BauTag – Start, Rahmen (Seitenleiste / Schiene / Tab-Leiste) und Hash-Routing.
// Alles Rollenabhängige ergibt sich ausschließlich aus den Rechten von GET /api/auth/ich.
import { get, post } from './api.js';
import { ic, esc, MARK, fmt, laden, keinZugriff, fehlerBox, avatar, rolleText, dialog, speicher, toast, $, $$ } from './ui.js';
import { syncStatus, setzBenutzer, setzOnline, nachsenden } from './offline.js';
import login from './views/login.js';
import stempeln from './views/stempeln.js';
import kolonne from './views/kolonne.js';
import woche from './views/woche.js';
import { berichte, bericht } from './views/berichte.js';
import dashboard from './views/dashboard.js';
import { baustellen, baustelle } from './views/baustellen.js';
import preise from './views/preise.js';
import { kalkUebersicht, kalkDetail } from './views/kalkulation.js';
import monat from './views/monat.js';
import benutzer from './views/benutzer.js';
import mehr from './views/mehr.js';
import pin, { pinErzwungen } from './views/pin.js';
import abwesenheiten from './views/abwesenheiten.js';
import korrektur from './views/korrektur.js';
import positionen from './views/positionen.js';

const root = document.getElementById('root');

// M-06 (Content-Security-Policy): Die Vorlagen enthalten keine style-Attribute und kein Inline-Skript.
// Maße wie Balkenbreiten stehen als data-st im Markup und werden hier über das CSSOM gesetzt.
const setzStile = (knoten) => {
  if (knoten.nodeType !== 1) return;
  if (knoten.dataset && knoten.dataset.st != null) knoten.style.cssText = knoten.dataset.st;
  knoten.querySelectorAll('[data-st]').forEach((e) => { e.style.cssText = e.dataset.st; });
};
new MutationObserver((liste) => { for (const m of liste) m.addedNodes.forEach(setzStile); }).observe(document.body, { childList: true, subtree: true });
let ich = null;            // {benutzer, rechte, baustellenIds}
let aufraeumen = null;     // Aufräumfunktion der aktuellen Ansicht
let lauf = 0;              // schützt vor überholten Renderläufen
let meldungen = [];        // Benachrichtigungen
let integCache = null;
let pollTimer = null;

const kann = (recht) => !!ich && ich.rechte.includes(recht);
const eines = (...r) => () => r.some(kann);
// C-14: Das Büro pflegt Benutzer (Mitarbeiter, Polier, Bauleiter) – laut API eine Regel der Rolle, kein eigenes Recht
const darfBenutzerPflegen = () => !!ich && ich.benutzer.rolle === 'buero';

const NAV = [
  { id: 'dashboard', pfad: '/dashboard', text: 'Übersicht', kurz: 'Übersicht', icon: 'grid', darf: eines('bericht_freigeben', 'kalk_sehen', 'stammdaten', 'lohn') },
  { id: 'stempeln', pfad: '/stempeln', text: 'Stempeluhr', kurz: 'Stempeln', icon: 'clock', darf: eines('zeit_eigen') },
  { id: 'kolonne', pfad: '/kolonne', text: 'Kolonne stempeln', kurz: 'Kolonne', icon: 'users', darf: eines('kolonne') },
  { id: 'berichte', pfad: '/berichte', text: 'Bautagesberichte', kurz: 'Berichte', icon: 'clipboard', darf: eines('bericht_erstellen', 'bericht_freigeben') },
  { id: 'woche', pfad: '/woche', text: 'Meine Woche', kurz: 'Woche', icon: 'calendar', darf: eines('zeit_eigen') },
  { id: 'baustellen', pfad: '/baustellen', text: 'Baustellen', kurz: 'Baustellen', icon: 'pin', darf: eines('stammdaten', 'kalk_sehen', 'bericht_freigeben') },
  { id: 'kalkulation', pfad: '/kalkulation', text: 'Nachkalkulation', kurz: 'Kalkulation', icon: 'chart', darf: eines('kalk_sehen') },
  { id: 'preise', pfad: '/preise', text: 'Preise & Stammdaten', kurz: 'Preise', icon: 'tag', darf: eines('preise_sehen') },
  { id: 'monat', pfad: '/monat', text: 'Monatsauswertung', kurz: 'Monat', icon: 'table', darf: eines('lohn') },
  { id: 'abwesenheiten', pfad: '/abwesenheiten', text: 'Abwesenheiten', kurz: 'Abwesend', icon: 'away', darf: eines('zeit_eigen', 'stammdaten', 'lohn') },
  { id: 'benutzer', pfad: '/benutzer', text: 'Benutzer & Rechte', kurz: 'Benutzer', icon: 'shield', darf: () => kann('benutzer') || darfBenutzerPflegen() },
];
const navErlaubt = () => {
  const liste = NAV.filter((n) => n.darf());
  // Büro-Rollen: Übersicht/Berichte zuerst, eigene Stempeluhr dahinter
  if (liste[0] && liste[0].id === 'dashboard') {
    const hinten = ['stempeln', 'kolonne', 'woche'];
    if (!kann('stammdaten') && !kann('lohn')) hinten.push('abwesenheiten');
    return [...liste.filter((n) => !hinten.includes(n.id)), ...liste.filter((n) => hinten.includes(n.id))];
  }
  return liste;
};
const start = () => { const n = navErlaubt()[0]; return n ? n.pfad : '/mehr'; };

const ROUTEN = [
  { muster: /^\/stempeln$/, nav: 'stempeln', titel: 'Stempeluhr', view: stempeln, darf: eines('zeit_eigen') },
  { muster: /^\/kolonne$/, nav: 'kolonne', titel: 'Kolonne stempeln', view: kolonne, darf: eines('kolonne') },
  { muster: /^\/woche$/, nav: 'woche', titel: 'Meine Woche', view: woche, darf: eines('zeit_eigen') },
  { muster: /^\/berichte$/, nav: 'berichte', titel: 'Bautagesberichte', view: berichte, darf: eines('bericht_erstellen', 'bericht_freigeben') },
  { muster: /^\/bericht\/(\d+)$/, nav: 'berichte', titel: 'Bautagesbericht', view: bericht, darf: eines('bericht_erstellen', 'bericht_freigeben') },
  { muster: /^\/dashboard$/, nav: 'dashboard', titel: 'Übersicht', view: dashboard, darf: eines('bericht_freigeben', 'kalk_sehen', 'stammdaten', 'lohn') },
  { muster: /^\/baustellen$/, nav: 'baustellen', titel: 'Baustellen', view: baustellen, darf: eines('stammdaten', 'kalk_sehen', 'bericht_freigeben') },
  { muster: /^\/baustelle\/(\d+)$/, nav: 'baustellen', titel: 'Baustelle', view: baustelle, darf: eines('stammdaten', 'kalk_sehen', 'bericht_freigeben') },
  { muster: /^\/preise$/, nav: 'preise', titel: 'Preise & Stammdaten', view: preise, darf: eines('preise_sehen') },
  { muster: /^\/kalkulation$/, nav: 'kalkulation', titel: 'Nachkalkulation', view: kalkUebersicht, darf: eines('kalk_sehen') },
  { muster: /^\/kalkulation\/(\d+)\/positionen$/, nav: 'kalkulation', titel: 'Nachkalkulation', view: positionen, darf: eines('kalk_sehen') },
  { muster: /^\/kalkulation\/(\d+)$/, nav: 'kalkulation', titel: 'Nachkalkulation', view: kalkDetail, darf: eines('kalk_sehen') },
  { muster: /^\/monat$/, nav: 'monat', titel: 'Monatsauswertung', view: monat, darf: eines('lohn') },
  { muster: /^\/benutzer$/, nav: 'benutzer', titel: 'Benutzer & Rechte', view: benutzer, darf: () => kann('benutzer') || darfBenutzerPflegen() },
  { muster: /^\/mehr$/, nav: 'mehr', titel: 'Mehr', view: mehr },
  { muster: /^\/abwesenheiten$/, nav: 'abwesenheiten', titel: 'Abwesenheiten', view: abwesenheiten, darf: eines('zeit_eigen', 'stammdaten', 'lohn') },
  { muster: /^\/korrektur$/, nav: 'monat', titel: 'Zeiten korrigieren', view: korrektur, darf: eines('stammdaten') },
  { muster: /^\/pin$/, nav: 'mehr', titel: 'PIN ändern', view: pin },
];

/* ---------- Rahmen ---------- */
function navLink(n, aktiv) {
  return `<a class="nav-item${aktiv === n.id ? ' active' : ''}" href="#${n.pfad}" data-nav="${n.id}"${aktiv === n.id ? ' aria-current="page"' : ''}>${ic(n.icon)}<span class="lbl-long">${esc(n.text)}</span><span class="lbl-short">${esc(n.kurz)}</span></a>`;
}
function rahmen() {
  const u = ich.benutzer;
  const nav = navErlaubt();
  const MEHR = { id: 'mehr', pfad: '/mehr', text: 'Mehr', kurz: 'Mehr', icon: 'more' };
  const tabs = nav.length > 4 ? [...nav.slice(0, 4), MEHR] : [...nav, MEHR];
  root.innerHTML = `
  <a class="skip" href="#view">Zum Inhalt springen</a>
  <div class="app">
    <nav class="sidenav" aria-label="Hauptnavigation">
      <a class="brand" href="#${start()}" aria-label="BauTag Startseite">${MARK}<span class="brand-txt"><b>BauTag</b><small>Baustellen-Plattform</small></span></a>
      <div class="nav-list" id="nav-seite">${nav.map((n) => navLink(n)).join('')}</div>
      <a class="nav-user" href="#/mehr" data-nav="mehr" title="Konto, Einstellungen, Abmelden">${avatar(u.name)}<span class="nav-user-txt"><b>${esc(u.name)}</b><small>${esc(rolleText(u.rolle))}</small></span></a>
    </nav>
    <div class="main">
      <header class="topbar">
        <a class="top-logo" href="#${start()}" aria-label="BauTag Startseite">${MARK}</a>
        <div class="top-title"><h1 id="titel">BauTag</h1><div class="top-sub" id="untertitel"></div></div>
        <div class="top-right">
          <span id="sync"></span>
          <button class="bell" id="glocke" type="button" aria-label="Benachrichtigungen" aria-haspopup="dialog">${ic('bell')}<i id="glocke-zahl" hidden></i></button>
          <div class="top-clock" aria-hidden="true"><b id="uhr"></b><small id="uhr-datum"></small></div>
        </div>
      </header>
      <main class="view" id="view" tabindex="-1"></main>
      <nav class="tabbar" id="nav-tab" aria-label="Hauptnavigation">${tabs.map((n) => navLink(n)).join('')}</nav>
    </div>
  </div>`;
  $('#glocke').addEventListener('click', glockeAuf);
  zeigeSync();
  zeigeGlocke();
  tick();
}
function markiereNav(id) {
  const tabIds = $$('#nav-tab .nav-item').map((a) => a.dataset.nav);
  $$('.nav-item, .nav-user').forEach((a) => {
    // Auf dem Handy liegt alles, was nicht in der Tab-Leiste ist, unter "Mehr"
    const an = a.dataset.nav === id || (a.closest('#nav-tab') && a.dataset.nav === 'mehr' && !tabIds.includes(id));
    a.classList.toggle('active', an);
    if (an) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}
function tick() {
  const u = $('#uhr'); if (!u) return;
  const d = new Date();
  u.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  $('#uhr-datum').textContent = fmt.datumKurz(d) + d.getFullYear();
}
setInterval(tick, 15000);

function zeigeSync() {
  const el = $('#sync'); if (!el) return;
  const s = syncStatus();
  let cls = 'online', icon = 'wifi', text = 'Online';
  if (s.abgelehnt) { cls = 'rejected'; icon = 'alert'; text = `${s.abgelehnt} nicht übernommen`; }
  else if (s.ausstehend) { cls = 'pending'; icon = 'sync'; text = `${s.ausstehend} ausstehend`; }
  else if (!s.online) { cls = 'offline'; icon = 'wifiOff'; text = 'Offline'; }
  const lang = s.abgelehnt ? `${s.abgelehnt} Offline-Buchung${s.abgelehnt > 1 ? 'en wurden' : ' wurde'} vom Server nicht übernommen – Details in der Stempeluhr` : s.ausstehend ? `${s.ausstehend} Stempelung${s.ausstehend > 1 ? 'en' : ''} gespeichert – wird gesendet, sobald Verbindung besteht` : s.online ? 'Verbunden – alle Buchungen gesendet' : 'Keine Verbindung – Stempeln wird zwischengespeichert';
  el.outerHTML = `<button type="button" id="sync" class="sync-chip ${cls}" data-sync="${cls}" data-ausstehend="${s.ausstehend}" data-abgelehnt="${s.abgelehnt}" title="${esc(lang)}" aria-label="${esc(lang)}">${ic(icon)}<span>${esc(text)}</span></button>`;
  $('#sync').addEventListener('click', () => { toast(lang, s.abgelehnt || s.ausstehend || !s.online ? 'warn' : 'ok'); nachsenden(); if (s.abgelehnt && kann('zeit_eigen')) location.hash = '#/stempeln'; });
}
window.addEventListener('bt:sync', zeigeSync);

/* ---------- Benachrichtigungen (Glocke) ---------- */
async function holeMeldungen() {
  if (!ich) return;
  try { meldungen = await get('/benachrichtigungen'); setzOnline(true); zeigeGlocke(); } catch (e) { if (e.netz) setzOnline(false); }
}
function zeigeGlocke() {
  const z = $('#glocke-zahl'); if (!z) return;
  const n = meldungen.filter((m) => !m.gelesen).length;
  z.hidden = !n; z.textContent = n > 99 ? '99+' : String(n);
  $('#glocke').classList.toggle('has', !!n);
  $('#glocke').setAttribute('aria-label', n ? `Benachrichtigungen, ${n} ungelesen` : 'Benachrichtigungen');
}
const MELD_ICON = { budget: 'chart', azg: 'clock', bericht: 'clipboard', abwesenheit: 'calendar', sicherheit: 'lock' };
function meldungZiel(m) {
  if (m.typ === 'budget' && m.baustelleId && kann('kalk_sehen')) return `#/kalkulation/${m.baustelleId}`;
  if (m.typ === 'bericht' && (kann('bericht_erstellen') || kann('bericht_freigeben'))) return m.berichtId ? `#/bericht/${m.berichtId}` : '#/berichte';
  if (m.typ === 'azg' && kann('zeit_eigen')) return '#/woche';
  if (m.typ === 'abwesenheit') return '#/abwesenheiten';
  if (m.typ === 'sicherheit' && (kann('benutzer') || darfBenutzerPflegen())) return '#/benutzer';
  return '';
}
async function glockeAuf() {
  const liste = () => meldungen.length
    ? `<ul class="notif-list">${meldungen.map((m) => `<li class="notif ${m.gelesen ? '' : 'neu'} t-${esc(m.typ)}" data-id="${m.id}"><button type="button" class="notif-btn" data-auf="${m.id}"><span class="notif-ic">${ic(MELD_ICON[m.typ] || 'bell')}</span><span class="notif-txt"><b>${esc(m.titel)}</b><span>${esc(m.text)}</span><small>${esc(fmt.zeitpunkt(m.zeit))}${m.gelesen ? '' : ' · <em>neu</em>'}</small></span></button></li>`).join('')}</ul>`
    : `<div class="state empty">${ic('bell')}<p>Keine Benachrichtigungen.</p></div>`;
  const d = dialog({ titel: 'Benachrichtigungen', seite: true, inhalt: `<div id="notif-inhalt">${laden()}</div>`, fuss: '<button class="btn ghost" type="button" data-alle>Alle als gelesen markieren</button>' });
  d.el.id = 'notif-panel';
  const zeichne = () => { $('#notif-inhalt', d.el).innerHTML = liste(); $('[data-alle]', d.el).disabled = !meldungen.some((m) => !m.gelesen); };
  await holeMeldungen();
  zeichne();
  d.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-auf]');
    if (b) {
      const m = meldungen.find((x) => String(x.id) === b.dataset.auf);
      if (m && !m.gelesen) { try { await post(`/benachrichtigungen/${m.id}/gelesen`); m.gelesen = true; zeigeGlocke(); zeichne(); } catch (err) { toast(err.message, 'warn'); } }
      const ziel = m && meldungZiel(m);
      if (ziel) { d.zu(); location.hash = ziel; }
    } else if (e.target.closest('[data-alle]')) {
      try { await post('/benachrichtigungen/alle-gelesen'); meldungen.forEach((m) => { m.gelesen = true; }); zeigeGlocke(); zeichne(); } catch (err) { toast(err.message, 'warn'); }
    }
  });
}

/* ---------- Router ---------- */
function pfadJetzt() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [pfad, qs] = h.split('?');
  return { pfad: pfad || '/', query: new URLSearchParams(qs || '') };
}
async function zeige() {
  const nr = ++lauf;
  if (aufraeumen) { try { aufraeumen(); } catch (e) { /* egal */ } aufraeumen = null; }
  $$('dialog[open]').forEach((d) => d.close());
  if (!ich) {
    document.title = 'BauTag · Anmelden';
    aufraeumen = await login(root, { angemeldet: nachLogin });
    return;
  }
  // B-03: Start-PIN oder zurückgesetzte PIN muss zuerst geändert werden – vorher gibt es keine andere Ansicht
  if (ich.mussPinAendern) {
    document.title = 'BauTag · PIN ändern';
    pinErzwungen(root, ich, { fertig: async () => { await ladeIch(); location.hash = '#' + start(); zeige(); }, abmelden });
    return;
  }
  const { pfad, query } = pfadJetzt();
  if (pfad === '/' || pfad === '/login') { location.replace('#' + start()); return; }
  if (!$('#view')) rahmen();
  const view = $('#view');
  const route = ROUTEN.find((r) => r.muster.test(pfad));
  const setzTitel = (t, sub = '') => { if (nr !== lauf) return; $('#titel').textContent = t; $('#untertitel').textContent = sub; document.title = `${t} · BauTag`; };
  markiereNav(route ? route.nav : '');
  view.scrollTop = 0;
  if (!route) { setzTitel('Nicht gefunden'); view.innerHTML = `<div class="page narrow"><div class="card state big">${ic('info')}<h2>Seite nicht gefunden</h2><p>Diese Adresse gibt es in BauTag nicht.</p><a class="btn ghost" href="#${start()}">Zur Startseite</a></div></div>`; return; }
  setzTitel(route.titel);
  if (route.darf && !route.darf()) { view.innerHTML = keinZugriff(); return; }
  // Jede Ansicht bekommt einen frischen Behälter (keine Ereignis-Altlasten der vorigen Ansicht)
  view.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'view-box';
  box.innerHTML = laden();
  view.appendChild(box);
  const ctx = {
    ich, kann, query, params: pfad.match(route.muster).slice(1), titel: setzTitel,
    aktuell: () => nr === lauf,
    neuLaden: zeige,
    navErlaubt, abmelden,
    integrationen: async () => { if (!integCache) { try { integCache = await get('/integrationen'); } catch (e) { return []; } } return integCache; },
    meldungenNeu: holeMeldungen,
  };
  try {
    const fertig = await route.view(box, ctx);
    if (nr !== lauf) { if (typeof fertig === 'function') fertig(); return; }
    aufraeumen = typeof fertig === 'function' ? fertig : null;
    setzOnline(true);
  } catch (e) {
    if (nr !== lauf) return;
    if (e.status === 401) return; // Abmelde-Ereignis übernimmt
    if (e.status === 403) { view.innerHTML = keinZugriff(e.message && e.code !== 'KEIN_ZUGRIFF' ? e.message : ''); return; }
    if (e.netz) setzOnline(false); else if (!e.status) console.error(e);
    view.innerHTML = fehlerBox(e);
    const b = $('[data-neu-laden]', view); if (b) b.addEventListener('click', zeige);
  }
}
window.addEventListener('hashchange', zeige);

/* ---------- An-/Abmelden ---------- */
async function nachLogin() {
  await ladeIch();
  if (location.hash && location.hash !== '#/login' && location.hash !== '#/') zeige(); else location.hash = '#' + start();
}
async function ladeIch(nurMitHinweis = false) {
  // Beim Start ohne gemerkte Anmeldung gleich zur Anmeldeseite (spart eine sichere 401-Antwort)
  if (nurMitHinweis && !speicher.lies('bt_ich')) { ich = null; setzBenutzer(null); return; }
  try {
    ich = await get('/auth/ich');
    ich.rechte = ich.rechte || [];
    // Nur Name/Rolle/Rechte für den Offline-Start merken (keine Preis- oder Lohndaten)
    speicher.setz('bt_ich', ich);
    setzOnline(true);
  } catch (e) {
    if (e.netz) { ich = speicher.lies('bt_ich'); setzOnline(false); }
    else { ich = null; speicher.weg('bt_ich'); }
  }
  setzBenutzer(ich ? ich.benutzer.id : null);
  clearInterval(pollTimer);
  if (ich) {
    root.innerHTML = '';
    if (ich.mussPinAendern) return; // erst PIN ändern – keine weiteren Abfragen
    rahmen();
    holeMeldungen();
    nachsenden();
    pollTimer = setInterval(holeMeldungen, 45000);
  }
}
async function abmelden() {
  try { await post('/auth/logout'); } catch (e) { /* offline: lokal abmelden */ }
  lokalAbmelden();
}
function lokalAbmelden() {
  ich = null; meldungen = []; integCache = null;
  speicher.weg('bt_ich'); speicher.weg('bt_status');
  setzBenutzer(null); clearInterval(pollTimer);
  root.innerHTML = '';
  if (location.hash !== '#/login') location.hash = '#/login'; else zeige();
}
window.addEventListener('bt:abgemeldet', () => { if (ich) { toast('Sitzung abgelaufen – bitte neu anmelden.', 'warn'); lokalAbmelden(); } });
window.addEventListener('bt:pin', () => { if (ich && !ich.mussPinAendern) { ich.mussPinAendern = true; clearInterval(pollTimer); root.innerHTML = ''; zeige(); } });
window.addEventListener('bt:nachgesendet', () => { holeMeldungen(); const { pfad } = pfadJetzt(); if (pfad === '/stempeln' || pfad === '/woche') zeige(); });
window.addEventListener('focus', () => { if (ich) { holeMeldungen(); nachsenden(); } });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* ohne SW läuft die App normal weiter */ }); });
}

(async function los() {
  root.innerHTML = laden('BauTag wird gestartet …');
  await ladeIch(true);
  if (!ich) root.innerHTML = '';
  zeige();
})();
