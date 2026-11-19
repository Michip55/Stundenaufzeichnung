// BauTag – Start, Rahmen (Seitenleiste / Schiene / Tab-Leiste) und Hash-Routing.
// Alles Rollenabhängige ergibt sich ausschließlich aus den Rechten von GET /api/auth/ich.
import { get, post, abmeldenVormerken, abmeldenSenden, bindungLoeschen, geraetArtFuer, setzGeraetArt, geraetArtBeiAnmeldung, sperreMinutenFuer, sitzungWechsel, setzAngemeldet, pushNachAnmeldung } from './api.js';
import { ic, esc, MARK, fmt, laden, keinZugriff, fehlerBox, avatar, rolleText, dialog, speicher, toast, $, $$ } from './ui.js';
import { syncStatus, setzBenutzer, setzOnline, nachsenden, nachsendenFertig } from './offline.js';
import { standortNachtragOffen, standortNachtraegeFertig } from './standort-einwilligung.js';
import login from './views/login.js';
import stempeln from './views/stempeln.js';
import kolonne from './views/kolonne.js';
import woche from './views/woche.js';
import { berichte, bericht } from './views/berichte.js';
import dashboard from './views/dashboard.js';
import { baustellen, baustelle } from './views/baustellen.js';
import { archiv } from './views/lebenslauf.js';
import plan, { einsatz, partie } from './views/plan.js';
import { offenePosten, rechnungenSeite } from './views/rechnungen.js';
import faelligkeiten from './views/faelligkeiten.js';
import urlaub from './views/urlaub.js';
import lohnvorlagen from './views/lohnvorlagen.js';
import preise from './views/preise.js';
import { kalkUebersicht, kalkDetail } from './views/kalkulation.js';
import monat from './views/monat.js';
import benutzer from './views/benutzer.js';
import mehr from './views/mehr.js';
import hilfe from './views/hilfe.js';
import push, { geraetPushAbo, pushStillEinschalten, pushGeraetArtMelden } from './views/push.js';
import zweifaktor, { zweiFaktorErzwungen } from './views/zweifaktor.js';
import { installStatus } from './installieren.js';
import pin, { pinErzwungen } from './views/pin.js';
import abwesenheiten from './views/abwesenheiten.js';
import korrektur from './views/korrektur.js';
import positionen from './views/positionen.js';
import { fuhrpark } from './views/fuhrpark.js';
import { anlage } from './views/anlage.js';
import { schadenNachsenden, schadenUngesendet, schadenNachsendenFertig } from './schaden-offline.js';
import { stammVergessen, fuhrenNachsendenFertig } from './views/fuhren.js';
import { versiegeln, entsiegeln, schluesselHolen } from './tresor.js';

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
let schadenNeu = 0;        // neu gemeldete Schäden (für alle, die sie bearbeiten)
let schadenWartet = 0;     // eigene Schadensmeldungen, die noch auf Verbindung warten

const kann = (recht) => !!ich && ich.rechte.includes(recht);
const eines = (...r) => () => r.some(kann);
// C-14/15.4: Benutzer (Mitarbeiter, Polier, Bauleiter) pflegt, wer das Recht stammdaten hat – wie der Server, nie nach Rollenname
const darfBenutzerPflegen = () => kann('stammdaten');
const rolle = (...r) => () => !!ich && r.includes(ich.benutzer.rolle);
// Baustellenplaner (15.4): planen allein mit dem Recht „stammdaten“ (Büro = Bauleiter = GF laut Matrix); Polier sieht seine Partie,
// alle Eingeteilten „Mein Einsatz“
const darfPlanen = () => kann('stammdaten');
const siehtBaustellen = () => eines('stammdaten', 'kalk_sehen', 'bericht_freigeben')() || rolle('polier')();

const NAV = [
  { id: 'dashboard', pfad: '/dashboard', text: 'Übersicht', kurz: 'Übersicht', icon: 'grid', darf: eines('bericht_freigeben', 'kalk_sehen', 'stammdaten', 'lohn') },
  { id: 'stempeln', pfad: '/stempeln', text: 'Stempeluhr', kurz: 'Stempeln', icon: 'clock', darf: eines('zeit_eigen') },
  { id: 'einsatz', pfad: '/einsatz', text: 'Mein Einsatz', kurz: 'Einsatz', icon: 'calendar', darf: rolle('mitarbeiter') },
  { id: 'partie', pfad: '/partie', text: 'Meine Partie', kurz: 'Partie', icon: 'users', darf: rolle('polier') },
  { id: 'kolonne', pfad: '/kolonne', text: 'Kolonne stempeln', kurz: 'Kolonne', icon: 'users', darf: eines('kolonne') },
  { id: 'berichte', pfad: '/berichte', text: 'Bautagesberichte', kurz: 'Berichte', icon: 'clipboard', darf: eines('bericht_erstellen', 'bericht_freigeben') },
  { id: 'woche', pfad: '/woche', text: 'Meine Woche', kurz: 'Woche', icon: 'calendar', darf: eines('zeit_eigen') },
  { id: 'baustellen', pfad: '/baustellen', text: 'Baustellen', kurz: 'Baustellen', icon: 'pin', darf: siehtBaustellen },
  { id: 'plan', pfad: '/plan', text: 'Baustellenplaner', kurz: 'Planer', icon: 'board', darf: darfPlanen },
  { id: 'einsatz2', pfad: '/einsatz', text: 'Mein Einsatz', kurz: 'Einsatz', icon: 'calendar', darf: rolle('polier'), nurMehr: true }, // Bauleiter: Navigation wie das Büro plus Stempeluhr und Urlaub (kein „Mein Einsatz“ – er arbeitet im Büro)
  // 15.24: alle Rechnungen über alle Baustellen (Rechte wie Offene Posten); Fälligkeiten über Übersicht und diese Seite
  { id: 'rechnungen', pfad: '/rechnungen', text: 'Rechnungen', kurz: 'Rechnungen', icon: 'file', darf: eines('preise_sehen') },
  { id: 'offeneposten', pfad: '/offene-posten', text: 'Offene Posten', kurz: 'Posten', icon: 'euro', darf: eines('preise_sehen') },
  { id: 'kalkulation', pfad: '/kalkulation', text: 'Nachkalkulation', kurz: 'Kalkulation', icon: 'chart', darf: eines('kalk_sehen') },
  { id: 'preise', pfad: '/preise', text: 'Stammdaten & Preise', kurz: 'Stammdaten', icon: 'tag', darf: eines('preise_sehen', 'stammdaten') },
  // Fuhrpark & Geräte: für alle (Geräteliste, Schaden/Mangel melden, Zählerstand); Pflege nur mit Recht „fuhrpark“. Am Handy unter „Mehr“.
  { id: 'fuhrpark', pfad: '/fuhrpark', text: 'Fuhrpark & Geräte', kurz: 'Geräte', icon: 'truck', darf: () => !!ich, nurMehr: true },
  { id: 'monat', pfad: '/monat', text: 'Monatsauswertung', kurz: 'Monat', icon: 'table', darf: eines('lohn') },
  { id: 'abwesenheiten', pfad: '/abwesenheiten', text: 'Abwesenheiten', kurz: 'Abwesend', icon: 'away', darf: eines('zeit_eigen', 'stammdaten', 'lohn') },
  { id: 'urlaub', pfad: '/urlaub', text: 'Urlaub', kurz: 'Urlaub', icon: 'away', darf: eines('zeit_eigen', 'stammdaten', 'lohn'), nurMehr: true },
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
// Handy (Inhaber-Entscheidung 16.11.2026, API.md 15.18): Startseite für alle ist die Stempeluhr; in der Tab-Leiste der
// Büro-Rollen „Stempeln · Übersicht · …“ – „Berichte“ rückt unter „Mehr“. Grenze wie die Tab-Leiste in app.css.
const HANDY = '(max-width: 719px)';
const istHandy = () => !!(window.matchMedia && window.matchMedia(HANDY).matches);
const handyReihenfolge = (nav) => {
  if (!istHandy()) return nav;
  const st = nav.find((n) => n.id === 'stempeln');
  if (!st) return nav;
  const rest = nav.filter((n) => n !== st);
  if (rest[0] && rest[0].id === 'dashboard') return [st, ...rest.filter((n) => n.id !== 'berichte'), ...rest.filter((n) => n.id === 'berichte')];
  return [st, ...rest];
};
const start = () => { const n = handyReihenfolge(navErlaubt())[0]; return n ? n.pfad : '/mehr'; };
const MEHR_NAV = { id: 'mehr', pfad: '/mehr', text: 'Mehr', kurz: 'Mehr', icon: 'more' };
function tabLeiste() {
  const tabNav = handyReihenfolge(navErlaubt()).filter((n) => !n.nurMehr);
  const tabs = tabNav.length > 4 ? [...tabNav.slice(0, 4), MEHR_NAV] : [...tabNav, MEHR_NAV];
  return tabs.map((n) => navLink(n)).join('');
}

const ROUTEN = [
  { muster: /^\/stempeln$/, nav: 'stempeln', titel: 'Stempeluhr', view: stempeln, darf: eines('zeit_eigen') },
  { muster: /^\/kolonne$/, nav: 'kolonne', titel: 'Kolonne stempeln', view: kolonne, darf: eines('kolonne') },
  { muster: /^\/woche$/, nav: 'woche', titel: 'Meine Woche', view: woche, darf: eines('zeit_eigen') },
  { muster: /^\/berichte$/, nav: 'berichte', titel: 'Bautagesberichte', view: berichte, darf: eines('bericht_erstellen', 'bericht_freigeben') },
  { muster: /^\/bericht\/(\d+)$/, nav: 'berichte', titel: 'Bautagesbericht', view: bericht, darf: eines('bericht_erstellen', 'bericht_freigeben') },
  { muster: /^\/dashboard$/, nav: 'dashboard', titel: 'Übersicht', view: dashboard, darf: eines('bericht_freigeben', 'kalk_sehen', 'stammdaten', 'lohn') },
  { muster: /^\/baustellen$/, nav: 'baustellen', titel: 'Baustellen', view: baustellen, darf: siehtBaustellen },
  { muster: /^\/baustellen\/archiv$/, nav: 'baustellen', titel: 'Abgeschlossene Bauvorhaben', view: archiv, darf: siehtBaustellen },
  { muster: /^\/baustelle\/(\d+)$/, nav: 'baustellen', titel: 'Baustelle', view: baustelle, darf: siehtBaustellen },
  { muster: /^\/plan$/, nav: 'plan', titel: 'Baustellenplaner', view: plan, darf: darfPlanen },
  { muster: /^\/einsatz$/, nav: 'einsatz', titel: 'Mein Einsatz', view: einsatz, darf: rolle('mitarbeiter', 'polier') }, // eingeplant werden nur sie (12.25); Bauleiter wie Büro
  { muster: /^\/partie$/, nav: 'partie', titel: 'Meine Partie', view: partie, darf: rolle('polier') },
  { muster: /^\/rechnungen$/, nav: 'rechnungen', titel: 'Rechnungen', view: rechnungenSeite, darf: eines('preise_sehen') },
  { muster: /^\/faelligkeiten$/, nav: 'rechnungen', titel: 'Fälligkeiten', view: faelligkeiten, darf: eines('preise_sehen') },
  { muster: /^\/offene-posten$/, nav: 'offeneposten', titel: 'Offene Posten', view: offenePosten, darf: eines('preise_sehen') },
  { muster: /^\/preise$/, nav: 'preise', titel: 'Stammdaten & Preise', view: preise, darf: eines('preise_sehen', 'stammdaten') },
  { muster: /^\/urlaub$/, nav: 'urlaub', titel: 'Urlaub', view: urlaub, darf: eines('zeit_eigen', 'stammdaten', 'lohn') },
  { muster: /^\/lohn-vorlagen$/, nav: 'monat', titel: 'Lohn-Export: Vorlagen', view: lohnvorlagen, darf: eines('lohn') },
  { muster: /^\/kalkulation$/, nav: 'kalkulation', titel: 'Nachkalkulation', view: kalkUebersicht, darf: eines('kalk_sehen') },
  { muster: /^\/kalkulation\/(\d+)\/positionen$/, nav: 'kalkulation', titel: 'Nachkalkulation', view: positionen, darf: eines('kalk_sehen') },
  { muster: /^\/kalkulation\/(\d+)$/, nav: 'kalkulation', titel: 'Nachkalkulation', view: kalkDetail, darf: eines('kalk_sehen') },
  { muster: /^\/monat$/, nav: 'monat', titel: 'Monatsauswertung', view: monat, darf: eines('lohn') },
  { muster: /^\/benutzer$/, nav: 'benutzer', titel: 'Benutzer & Rechte', view: benutzer, darf: () => kann('benutzer') || darfBenutzerPflegen() },
  { muster: /^\/fuhrpark$/, nav: 'fuhrpark', titel: 'Fuhrpark & Geräte', view: fuhrpark },
  { muster: /^\/fuhrpark\/anlage\/(\d+)$/, nav: 'fuhrpark', titel: 'Fuhrpark & Geräte', view: anlage },
  { muster: /^\/mehr$/, nav: 'mehr', titel: 'Mehr', view: mehr },
  { muster: /^\/zwei-faktor$/, nav: 'mehr', titel: 'Zwei-Faktor-Anmeldung', view: zweifaktor },
  { muster: /^\/push$/, nav: 'mehr', titel: 'Push-Benachrichtigungen', view: push },
  { muster: /^\/hilfe$/, nav: 'mehr', titel: 'Hilfe & erste Schritte', view: hilfe },
  { muster: /^\/abwesenheiten$/, nav: 'abwesenheiten', titel: 'Abwesenheiten', view: abwesenheiten, darf: eines('zeit_eigen', 'stammdaten', 'lohn') },
  { muster: /^\/korrektur$/, nav: 'monat', titel: 'Zeiten korrigieren', view: korrektur, darf: eines('stammdaten') },
  { muster: /^\/pin$/, nav: 'mehr', titel: 'PIN ändern', view: pin },
];

/* ---------- Rahmen ---------- */
function navLink(n, aktiv) {
  return `<a class="nav-item${aktiv === n.id ? ' active' : ''}" href="#${n.pfad}" data-nav="${n.id}"${aktiv === n.id ? ' aria-current="page"' : ''}>${ic(n.icon)}<span class="lbl-long">${esc(n.text)}</span><span class="lbl-short">${esc(n.kurz)}</span>${n.id === 'fuhrpark' || n.id === 'mehr' ? '<i class="nav-badge" data-badge hidden></i>' : ''}</a>`;
}
function rahmen() {
  const u = ich.benutzer;
  const nav = navErlaubt();
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
      <div id="install-hinweis" hidden></div>
      <main class="view" id="view" tabindex="-1"></main>
      <nav class="tabbar" id="nav-tab" aria-label="Hauptnavigation">${tabLeiste()}</nav>
    </div>
  </div>`;
  $('#glocke').addEventListener('click', glockeAuf);
  zeigeInstallHinweis();
  zeigeSync();
  zeigeGlocke();
  zeigeBadge();
  tick();
}
// Dezenter Hinweis am Handy, solange BauTag noch nicht am Startbildschirm liegt (einmal wegklickbar)
function zeigeInstallHinweis() {
  const el = $('#install-hinweis'); if (!el) return;
  const s = installStatus();
  const zeigen = !s.installiert && (s.kannFragen || s.ios) && !speicher.lies('bt_install_weg', false);
  el.hidden = !zeigen;
  el.innerHTML = zeigen ? `${ic('download')}<a href="#/hilfe">BauTag am Startbildschirm ablegen – so geht’s</a><button type="button" class="icon-btn sm" aria-label="Hinweis schließen">${ic('x')}</button>` : '';
  const zu = $('button', el); if (zu) zu.addEventListener('click', () => { speicher.setz('bt_install_weg', true); zeigeInstallHinweis(); });
}
window.addEventListener('bt:install', zeigeInstallHinweis);
/**
 * Gerätewahl der angemeldeten Person in „Mehr“ – „Eigenes Handy“ gilt für diese Person (G2-021), „Geteiltes Gerät“ für das Gerät
 * (15.21). 15.16 (H-S3): das Push-Abo dieses Geräts erfährt die neue Art (geteilt → Zustellung nur innerhalb der Sperre nach
 * Untätigkeit); wählt die Person „Eigenes Handy“ und hatte sie Push hier eingeschaltet, kommt es wie nach der Anmeldung still zurück (15.12).
 */
function geraetGewaehlt(art) {
  if (!ich) return geraetArtFuer(null);
  const id = ich.benutzer.id;
  const neu = setzGeraetArt(art, id);
  const erlaubnis = typeof Notification === 'undefined' ? 'default' : Notification.permission;
  if (neu === 'eigen' && pushNachAnmeldung(id, erlaubnis)) pushStillEinschalten({ geteilt: false }).catch(() => {});
  else pushGeraetArtMelden(neu !== 'eigen').catch(() => {});
  if (neu !== 'eigen') sitzungAnGeraetAngleichen(); // 15.28: die Wochen-Sitzung endet als solche sofort
  return neu;
}
/**
 * 15.28: Gilt am Server eine Wochen-Sitzung („Eigenes Handy“ bei der Anmeldung), ist das Gerät für diese Person aber kein
 * „Eigenes Handy“ (mehr), stellt POST /auth/geraet die Sitzung sofort auf die normalen Regeln. Ohne Netz: beim nächsten Start der
 * App erneut – am Gerät gilt die Sperre nach Untätigkeit des geteilten Geräts ohnehin schon.
 */
function sitzungAnGeraetAngleichen() {
  if (!ich || ich.sitzungArt !== 'woche' || geraetArtFuer(ich.benutzer.id) === 'eigen') return;
  const wer = ich;
  post('/auth/geraet', { art: 'geteilt' }).then((r) => {
    if (ich !== wer || !r) return;
    ich.sitzungArt = r.sitzungArt === 'woche' ? 'woche' : 'normal'; ich.sitzungBis = r.sitzungBis || null;
    speicher.setz('bt_ich', ich);
  }).catch(() => { /* ohne Netz bzw. abgemeldet: siehe oben */ });
}
let navAktiv = '';
function markiereNav(id) {
  navAktiv = id;
  const tabIds = $$('#nav-tab .nav-item').map((a) => a.dataset.nav);
  $$('.nav-item, .nav-user').forEach((a) => {
    // Auf dem Handy liegt alles, was nicht in der Tab-Leiste ist, unter "Mehr"
    const an = a.dataset.nav === id || (a.closest('#nav-tab') && a.dataset.nav === 'mehr' && !tabIds.includes(id));
    a.classList.toggle('active', an);
    if (an) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}
// 15.19 (Inhaber 16.11.2026): iOS schiebt das Dokument nach Tastatur/Auswahlliste/Drehen gelegentlich hoch und lässt es dort
// („Kopfleiste weg, unten Leerraum“). Gescrollt wird nur in #view – das Dokument selbst gehört immer auf 0/0.
{
  const eingabeAktiv = () => { const a = document.activeElement; return !!a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable); };
  const zurueck = () => {
    if (eingabeAktiv()) return; // während der Eingabe darf iOS das Feld über die Tastatur schieben
    const d = document.documentElement, b = document.body;
    if (window.scrollX || window.scrollY || d.scrollTop || d.scrollLeft || (b && (b.scrollTop || b.scrollLeft))) {
      window.scrollTo(0, 0); d.scrollTop = 0; d.scrollLeft = 0; if (b) { b.scrollTop = 0; b.scrollLeft = 0; }
    }
  };
  const spaeter = () => { setTimeout(zurueck, 60); setTimeout(zurueck, 400); };
  window.addEventListener('scroll', zurueck, { passive: true });
  ['focusout', 'orientationchange', 'pageshow', 'resize'].forEach((e) => window.addEventListener(e, spaeter, { passive: true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) spaeter(); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', spaeter, { passive: true });
}
// Wechsel zwischen Handy- und Breitbild (Drehen, Fenstergröße): Tab-Leiste neu ordnen, Markierung behalten
if (window.matchMedia) {
  const mq = window.matchMedia(HANDY);
  const neu = () => { const t = $('#nav-tab'); if (t && ich) { t.innerHTML = tabLeiste(); markiereNav(navAktiv); } };
  if (mq.addEventListener) mq.addEventListener('change', neu); else if (mq.addListener) mq.addListener(neu);
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
  if (!ich || gemerktPruefen()) return; // 15.16 (H-S2)
  try { meldungen = await get('/benachrichtigungen'); setzOnline(true); zeigeGlocke(); } catch (e) { if (e.netz) setzOnline(false); }
  holeSchadenZahl();
}
/* ---------- Schäden: Zahl am Menüpunkt, Nachsenden wartender Meldungen ---------- */
const bearbeitetSchaeden = () => kann('fuhrpark'); // 15.4: wie der Server (Schäden bearbeiten = Recht fuhrpark)
function zeigeBadge() {
  const n = schadenNeu + schadenWartet;
  const text = [schadenNeu ? `${schadenNeu} neue Schadensmeldung${schadenNeu > 1 ? 'en' : ''}` : '', schadenWartet ? `${schadenWartet} Schadensmeldung${schadenWartet > 1 ? 'en warten' : ' wartet'} auf Verbindung` : ''].filter(Boolean).join(', ');
  $$('.nav-badge[data-badge]').forEach((b) => { b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n); b.dataset.schNeu = schadenNeu; b.dataset.schWartet = schadenWartet; b.title = text; });
}
async function holeSchadenZahl() {
  if (!ich) return;
  const id = ich.benutzer.id;
  let wartet = (await schadenUngesendet(id)).length;
  if (wartet) { await schadenNachsenden(id); wartet = (await schadenUngesendet(id)).length; }
  let neu = schadenNeu;
  if (bearbeitetSchaeden()) { try { neu = (await get('/fuhrpark/schaeden?status=gemeldet')).length; } catch (e) { /* Zahl bleibt */ } } else neu = 0;
  if (!ich || ich.benutzer.id !== id) return;
  schadenNeu = neu; schadenWartet = wartet; zeigeBadge();
}
window.addEventListener('bt:schaden', async () => { if (!ich) return; schadenWartet = (await schadenUngesendet(ich.benutzer.id)).length; zeigeBadge(); });
window.addEventListener('bt:schaden-gesendet', (e) => { toast(e.detail > 1 ? `${e.detail} Schadensmeldungen wurden nachgesendet.` : 'Schadensmeldung wurde nachgesendet.'); holeMeldungen(); });
window.addEventListener('online', () => { if (ich) holeSchadenZahl(); });
function zeigeGlocke() {
  const z = $('#glocke-zahl'); if (!z) return;
  const n = meldungen.filter((m) => !m.gelesen).length;
  z.hidden = !n; z.textContent = n > 99 ? '99+' : String(n);
  $('#glocke').classList.toggle('has', !!n);
  $('#glocke').setAttribute('aria-label', n ? `Benachrichtigungen, ${n} ungelesen` : 'Benachrichtigungen');
}
const MELD_ICON = { budget: 'chart', azg: 'clock', bericht: 'clipboard', abwesenheit: 'calendar', sicherheit: 'lock', fuhrpark: 'truck', plan: 'board', email: 'mail' };
function meldungZiel(m) {
  if (m.typ === 'budget' && m.baustelleId && kann('kalk_sehen')) return `#/kalkulation/${m.baustelleId}`;
  if (m.typ === 'bericht' && (kann('bericht_erstellen') || kann('bericht_freigeben'))) return m.berichtId ? `#/bericht/${m.berichtId}` : '#/berichte';
  if (m.typ === 'azg' && kann('zeit_eigen')) return '#/woche';
  if (m.typ === 'abwesenheit') return '#/abwesenheiten';
  if (m.typ === 'fuhrpark') return m.schadenId ? `#/fuhrpark?reiter=schaeden&schaden=${m.schadenId}` : /Schaden/.test(m.titel || '') ? '#/fuhrpark?reiter=schaeden' : m.anlageId ? `#/fuhrpark/anlage/${m.anlageId}` : '#/fuhrpark';
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
  if (ich && gemerktPruefen()) return; // 15.16 (H-S2): in einem anderen Tab ab- bzw. umgemeldet – dieser Tab ist schon gesperrt
  if (ich && abmeldenLauf) return; // 15.30: Abmelden wartet noch auf einen Standort-Nachtrag – keine Ansicht der Person mehr
  const nr = ++lauf;
  if (aufraeumen) { try { aufraeumen(); } catch (e) { /* egal */ } aufraeumen = null; }
  $$('dialog[open]').forEach((d) => d.close());
  if (!ich) {
    await geraetAufgeraeumt; // 15.5: erst wenn die Daten der vorigen Person versiegelt/gelöscht sind, erscheint die Anmeldung
    if (nr !== lauf || ich) return;
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
  // 12.7: Zwei-Faktor-Anmeldung ist für die Rolle Pflicht, aber noch nicht eingerichtet
  if (ich.zweiFaktor && ich.zweiFaktor.pflicht && !ich.zweiFaktor.aktiv) {
    document.title = 'BauTag · Zwei-Faktor einrichten';
    zweiFaktorErzwungen(root, ich, { fertig: async () => { await ladeIch(); location.hash = '#' + start(); zeige(); }, abmelden });
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
  // Gesperrte Adresse (direkt eingetippt): neutrale Seite – kein Titel der Seite, keine Anfrage an den Server
  if (route.darf && !route.darf()) { markiereNav(''); setzTitel('Seite nicht verfügbar'); view.innerHTML = keinZugriff(); return; }
  setzTitel(route.titel);
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
    navErlaubt, abmelden, geraetGewaehlt,
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
    if (e.status === 401 || e.veraltet) return; // Abmelde-Ereignis übernimmt; 15.12 (G2-018): Antwort einer beendeten Anmeldung
    if (e.status === 403) { markiereNav(''); setzTitel('Seite nicht verfügbar'); view.innerHTML = keinZugriff(); return; }
    if (e.netz) setzOnline(false); else if (!e.status) console.error(e);
    view.innerHTML = fehlerBox(e);
    const b = $('[data-neu-laden]', view); if (b) b.addEventListener('click', zeige);
  }
}
window.addEventListener('hashchange', zeige);

/* ---------- An-/Abmelden ---------- */
// 15.5 (F-029/F-046): Aufräumen nach dem Abmelden (laufendes Nachsenden abwarten, versiegeln, löschen) – die nächste Anmeldung wartet darauf
let geraetAufgeraeumt = Promise.resolve();
function geraetAufraeumen({ amServer = false } = {}) {
  geraetAufgeraeumt = geraetAufgeraeumt.then(async () => {
    const sub = await geraetPushAbo();
    // 15.16 (H-S1): das Abmelden am Server läuft im Hintergrund. Es ist schon vorgemerkt (bt_abmelden_offen) – jede weitere Anfrage
    // holt es zuerst nach –, und ohne Bindungs-Cookie gilt die Sitzung ohnehin nicht mehr. Die Anmeldeseite wartet nicht auf das Netz.
    if (amServer) {
      if (sub && sub.endpoint) abmeldenVormerken(sub.endpoint); // 15.5 (F-014): Push-Abo dieses Geräts am Server mitlöschen
      abmeldenSenden().catch((e) => { if (e && e.netz) toast('Ohne Verbindung abgemeldet. Am Server wird das Abmelden bei der nächsten Verbindung nachgeholt.', 'warn'); });
    }
    // 15.12 (G2-032): auch beim Sitzungsablauf (401) endet das Push-Abo im Browser – am Server ist es mit der Sitzung schon gelöscht
    await pushAbmelden(sub);
    await Promise.all([nachsendenFertig(), schadenNachsendenFertig(), fuhrenNachsendenFertig()]).catch(() => {});
    await versiegeln().catch(() => {});
    speicher.raeumeBenutzer(); stammVergessen(); // R-08: Einsatzplan, Auswahl, Entwürfe … des Benutzers vom Gerät entfernen
  });
  return geraetAufgeraeumt;
}
// 15.5 (F-014): Push-Abo dieses Geräts der vorigen Person beenden
async function pushAbmelden(sub) { if (sub) { try { await sub.unsubscribe(); } catch (e) { /* ohne Netz: der Server löscht das Abo beim Nachholen */ } } }

/* ---------- 15.16 (H-S2): Anmeldung über alle Tabs desselben Browsers ---------- */
// Abmelden, Ablauf und jede Anmeldung werden allen anderen Tabs gemeldet (BroadcastChannel, dazu das storage-Ereignis auf bt_ich).
// Zeigt ein anderer Tab noch den Rahmen einer Person, die hier nicht mehr angemeldet ist, sperrt er sich sofort (fremdBeendet).
const KANAL = (() => { try { return typeof BroadcastChannel === 'function' ? new BroadcastChannel('bautag-sitzung') : null; } catch (e) { return null; } })();
function sitzungMelden(art, benutzerId = null) { if (KANAL) { try { KANAL.postMessage({ art, benutzerId }); } catch (e) { /* egal */ } } }
let ichGemerkt = false; // bt_ich ließ sich am Gerät speichern (sonst kein Abgleich über den Speicher)
/** Ist laut einem anderen Tab jetzt `benutzerId` (null = niemand) angemeldet? Weicht das von diesem Tab ab → sofort sperren. */
function anmeldungAbgleichen(benutzerId) {
  if (!ich) return false;
  if (benutzerId != null && Number(benutzerId) === ich.benutzer.id) return false;
  fremdBeendet(benutzerId != null);
  return true;
}
/** gemerkte Anmeldung (bt_ich, von allen Tabs geteilt) gegen diesen Tab prüfen – vor jeder Bedienung, bei Fokus und Abruf */
function gemerktPruefen() {
  if (!ich || !ichGemerkt) return false;
  const g = speicher.lies('bt_ich');
  return anmeldungAbgleichen(g && g.benutzer ? g.benutzer.id : null);
}
if (KANAL) KANAL.addEventListener('message', (e) => { const d = (e && e.data) || {}; if (d.art === 'ab') anmeldungAbgleichen(null); else if (d.art === 'an') anmeldungAbgleichen(d.benutzerId); });
window.addEventListener('storage', (e) => { if (e.key === 'bt_ich' || e.key === null) { const g = speicher.lies('bt_ich'); anmeldungAbgleichen(g && g.benutzer ? g.benutzer.id : null); } });
window.addEventListener('bt:fremd', () => fremdBeendet(true)); // 409 ANMELDUNG_ANDERS (api.js): Antwort unter dem Cookie einer anderen Person
/**
 * In einem anderen Tab wurde abgemeldet bzw. jemand anderer angemeldet: Rahmen und Daten dieses Tabs sofort entfernen.
 * Speicher, Push-Abo und Versiegeln übernimmt der Tab, in dem ab-/angemeldet wurde – hier wird nichts davon angefasst.
 * Danach neu laden (frischer Zustand ohne Zwischenspeicher der vorigen Person); ist schon eine andere Person angemeldet,
 * erst auf Wunsch (ein Knopf), damit dieser Tab nicht in deren Anmeldung hinein aufräumt.
 */
function fremdBeendet(anderePerson = false) {
  if (!ich) return;
  sitzungWechsel();
  if (aufraeumen) { try { aufraeumen(); } catch (e) { /* egal */ } aufraeumen = null; }
  $$('dialog[open]').forEach((d) => d.close());
  toastsWeg();
  ich = null; meldungen = []; integCache = null; schadenNeu = 0; schadenWartet = 0; ichGemerkt = false;
  setzBenutzer(null); clearInterval(pollTimer);
  lauf++;
  document.title = 'BauTag';
  if (!anderePerson) { root.innerHTML = laden('Abgemeldet …'); location.reload(); return; }
  root.innerHTML = `<div class="state big" id="fremd-angemeldet">${ic('lock')}<h2>Abgemeldet</h2><p>In einem anderen Fenster dieses Browsers ist jetzt eine andere Person angemeldet.</p><button type="button" class="btn primary" id="fremd-neu">Neu laden</button></div>`;
  const b = $('#fremd-neu'); if (b) b.addEventListener('click', () => location.reload());
}

async function nachLogin() {
  sitzungWechsel(); // 15.12 (G2-018): nichts, was vor dieser Anmeldung gestartet wurde, landet in ihrem Zustand
  await ladeIch(false, { frisch: true });
  if (location.hash && location.hash !== '#/login' && location.hash !== '#/') zeige(); else location.hash = '#' + start();
}
async function ladeIch(nurMitHinweis = false, { frisch = false } = {}) {
  await geraetAufgeraeumt;
  // Beim Start ohne gemerkte Anmeldung gleich zur Anmeldeseite (spart eine sichere 401-Antwort)
  if (nurMitHinweis && !speicher.lies('bt_ich')) { ich = null; setzBenutzer(null); await versiegeln().catch(() => {}); return; }
  try {
    ich = await get('/auth/ich');
    ich.rechte = ich.rechte || [];
    setzAngemeldet(ich.benutzer.id); // 15.16 (H-S2): jede weitere Anfrage nennt die Person dieses Rahmens
    // R-08: Meldet sich an diesem Gerät jemand anderer an, bleibt nichts vom Vorbenutzer zurück
    const vorher = speicher.lies('bt_geraet_benutzer');
    if (vorher != null && vorher !== ich.benutzer.id) {
      await versiegeln().catch(() => {}); // 15.5 (F-046): wartende Einträge der vorigen Person versiegeln
      speicher.raeumeBenutzer(); stammVergessen();
      await pushAbmelden(await geraetPushAbo()); // 15.5 (F-014): ihr Push-Abo an diesem Gerät endet
    }
    // 15.21: bei der Anmeldung über die Anmeldeseite gilt deren Gerätewahl sofort für diese Person (Standard „Eigenes Handy“,
    // ohne Bestätigung); beim Neustart mit bestehender Sitzung bleibt es bei der gespeicherten Wahl (geraetArtFuer)
    if (frisch) geraetArtBeiAnmeldung(ich.benutzer.id);
    speicher.setz('bt_geraet_benutzer', ich.benutzer.id);
    if (frisch) { aktivMem = Date.now(); aktivGeschrieben = aktivMem; speicher.setz(AKTIV, aktivMem); } // Untätigkeit zählt ab der Anmeldung
    // Nur Name/Rolle/Rechte für den Offline-Start merken (keine Preis- oder Lohndaten)
    speicher.setz('bt_ich', ich);
    ichGemerkt = !!(speicher.lies('bt_ich') || {}).benutzer;
    sitzungAnGeraetAngleichen(); // 15.28: Wochen-Sitzung an einem Gerät, das für diese Person kein „Eigenes Handy“ ist
    if (frisch) sitzungMelden('an', ich.benutzer.id); // 15.16 (H-S2): andere Tabs mit einer anderen Person sperren sich
    setzOnline(true);
    // 15.5 (F-046): eigene versiegelte Einträge öffnen (Schlüssel nur mit Anmeldung)
    await schluesselHolen(ich.benutzer.id);
    await entsiegeln(ich.benutzer.id, { frisch }).catch(() => {});
    // 15.12: das Abo endet mit der Sitzung – nach der Anmeldung derselben Person auf ihrem eigenen Handy still wieder einschalten
    if (frisch && pushNachAnmeldung(ich.benutzer.id, typeof Notification === 'undefined' ? 'default' : Notification.permission)) pushStillEinschalten({ geteilt: false }).catch(() => {}); // ohne die Oberfläche aufzuhalten
  } catch (e) {
    if (e.veraltet) return; // 15.12 (G2-018): inzwischen ab- bzw. neu angemeldet – der neuere Lauf übernimmt
    if (e.netz) { ich = speicher.lies('bt_ich'); if (ich && ich.benutzer) { setzAngemeldet(ich.benutzer.id); ichGemerkt = true; } setzOnline(false); }
    else {
      // Sitzung am Server beendet (abgelaufen, abgemeldet): wie Abmelden – Einträge versiegeln, Benutzerdaten löschen
      ich = null; ichVergessen(); bindungLoeschen();
      await geraetAufraeumen();
    }
  }
  if (ich && untaetig()) { setzBenutzer(ich.benutzer.id); await abmelden({ grund: 'untaetig' }); return; }
  setzBenutzer(ich ? ich.benutzer.id : null);
  clearInterval(pollTimer);
  if (ich) {
    root.innerHTML = '';
    if (ich.mussPinAendern) return; // erst PIN ändern – keine weiteren Abfragen
    if (ich.zweiFaktor && ich.zweiFaktor.pflicht && !ich.zweiFaktor.aktiv) return; // erst zweiten Faktor einrichten
    rahmen();
    holeMeldungen();
    nachsenden();
    pollTimer = setInterval(holeMeldungen, 45000);
  }
}
/** Meldungen der vorigen Person (z. B. „Offline-Buchung nachgesendet“) nicht stehen lassen */
function toastsWeg() { const t = document.getElementById('toast-root'); if (t) t.innerHTML = ''; }
/** bt_ich entfernen (ein Neuladen startet nie mehr als diese Person) und allen anderen Tabs melden (15.16, H-S2) */
function ichVergessen() { speicher.weg('bt_ich'); ichGemerkt = false; sitzungMelden('ab'); }
/**
 * Abmelden (15.5, 15.16 H-S1): SOFORT und ohne auf das Netz zu warten – Anfragen abbrechen, Rahmen und Daten der Person entfernen,
 * Bindungs-Cookie löschen (das alte Sitzungs-Cookie gilt damit am Server nicht mehr) und das Abmelden am Server vormerken: jede
 * weitere Anfrage holt es zuerst nach (F-029). Danach im Hintergrund: POST /auth/logout mit dem Push-Abo dieses Geräts (F-014),
 * Abo im Browser beenden, laufendes Nachsenden abwarten, versiegeln, Benutzerdaten löschen; erst dann erscheint die Anmeldeseite.
 */
let abmeldenLauf = null;
function abmelden(opt = {}) {
  if (abmeldenLauf) return abmeldenLauf;
  abmeldenVormerken(); // vor allem anderen: ab jetzt geht keine Anfrage mehr unter dieser Sitzung hinaus
  const ab = () => { const f = lokalAbmelden({ amServer: true }); if (opt.grund === 'untaetig') toast('Wegen Untätigkeit abgemeldet – bitte neu anmelden.', 'warn'); return f; };
  abmeldenLauf = (standortNachtragOffen() ? standortAbwarten().then(ab) : ab()).finally(() => { abmeldenLauf = null; });
  return abmeldenLauf;
}
/**
 * 15.30: Eben gestempelt, die Ortung läuft noch – der Standort wird danach unter dieser Sitzung angehängt (vorAbmelden).
 * Die Ansicht der Person schließt sofort (wie 15.16 H-S1), bt_ich ist weg und das Abmelden vorgemerkt (ein Neuladen meldet
 * ab); nur die Sitzung bleibt höchstens STANDORT_ABMELDEN_MS bestehen. „Nicht warten“ meldet sofort ab (ohne Standort).
 */
function standortAbwarten() {
  if (aufraeumen) { try { aufraeumen(); } catch (e) { /* egal */ } aufraeumen = null; }
  $$('dialog[open]').forEach((d) => d.close());
  toastsWeg();
  lauf++; clearInterval(pollTimer);
  ichVergessen();
  root.innerHTML = `<div class="state" role="status" id="abmelden-standort"><span class="spinner" aria-hidden="true"></span><p>Abmelden … Standort wird noch gesendet …</p><button type="button" class="btn ghost sm" id="abmelden-sofort">Nicht warten</button></div>`;
  return new Promise((fertig) => {
    standortNachtraegeFertig().then(fertig);
    const b = $('#abmelden-sofort'); if (b) b.addEventListener('click', () => fertig());
  });
}
function lokalAbmelden({ amServer = false } = {}) {
  sitzungWechsel(); // 15.12 (G2-018): auch beim Ablauf der Sitzung (401) und bei der Sperre nach Untätigkeit
  // 15.16 (H-S1): Ansicht und Dialoge der Person sofort schließen – vor jedem await
  if (aufraeumen) { try { aufraeumen(); } catch (e) { /* egal */ } aufraeumen = null; }
  $$('dialog[open]').forEach((d) => d.close());
  toastsWeg();
  lauf++; // ein noch laufender Renderlauf der Person zeichnet nichts mehr
  ich = null; meldungen = []; integCache = null; schadenNeu = 0; schadenWartet = 0;
  setzBenutzer(null); clearInterval(pollTimer);
  bindungLoeschen();
  ichVergessen();
  root.innerHTML = laden('Abmelden …');
  document.title = 'BauTag · Anmelden';
  const fertig = geraetAufraeumen({ amServer });
  if (location.hash !== '#/login') location.hash = '#/login'; else zeige();
  return fertig;
}

/* ---------- 15.5 (F-029): Sperre nach Untätigkeit am Gerät ---------- */
// Nach ich.sperreMinuten ohne Bedienung (Feldrollen 30 min, Büro wie die Sitzung) meldet die App ab – auch ohne Netz.
// Die letzte Bedienung wird am Gerät gemerkt, damit auch ein Neustart der App nach langer Pause abmeldet.
// 15.8: Auf einem Gerät, das als „Eigenes Handy“ gewählt ist, gilt stattdessen die Sitzungsdauer des Servers (ich.sitzungMinuten) –
// keine zusätzliche Sperre am Gerät; Abmelden, Versiegeln und Benutzerwechsel bleiben wie in 15.5.
// 15.28: mit Wochen-Sitzung (ich.sitzungArt "woche") meldet die App am eigenen Handy nie wegen Untätigkeit ab – die Sitzung endet
// am Server am Montag 00:00 Wiener Zeit (401 → „Sitzung abgelaufen“, Anmeldeseite); ohne Netz merkt die App das erst bei der nächsten
// Verbindung (Stempeln ohne Netz geht weiter, wie bisher nachgesendet unter der nächsten Anmeldung derselben Person).
const AKTIV = 'bt_aktiv';
let aktivMem = Date.now(), aktivGeschrieben = 0;
const letzteBedienung = () => { const g = Number(speicher.lies(AKTIV, 0)) || 0; return g || aktivMem; };
function untaetig() { const min = ich ? sperreMinutenFuer(ich, geraetArtFuer(ich.benutzer.id)) : 0; return !!ich && min > 0 && Date.now() - letzteBedienung() > min * 60000; } // 15.21: „eigen“ nur, wenn es für diese Person gespeichert ist
let sperrt = false;
function sperrePruefen() {
  if (sperrt || !untaetig()) return false;
  sperrt = true;
  abmelden({ grund: 'untaetig' }).finally(() => { sperrt = false; });
  return true;
}
function bedient(e) {
  const blocken = () => { if (e && e.cancelable) { e.preventDefault(); e.stopPropagation(); } };
  if (abmeldenLauf && e && e.target && e.target.closest && !e.target.closest('#login-card, #abmelden-standort')) { blocken(); return; } // 15.16 (H-S1)
  if (!ich) return;
  if (gemerktPruefen() || sperrePruefen()) { blocken(); return; } // 15.16 (H-S2): in einem anderen Tab ab-/umgemeldet
  aktivMem = Date.now();
  if (aktivMem - aktivGeschrieben > 5000) { aktivGeschrieben = aktivMem; speicher.setz(AKTIV, aktivMem); }
}
for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel']) window.addEventListener(ev, bedient, { capture: true, passive: false });
window.addEventListener('hashchange', () => bedient());
document.addEventListener('visibilitychange', () => { if (!document.hidden && !gemerktPruefen()) sperrePruefen(); });
window.addEventListener('pageshow', () => { gemerktPruefen(); }); // 15.16 (H-S2): Tab aus dem Zwischenspeicher des Browsers zurück
setInterval(sperrePruefen, 30000);
// 15.8: Gerätewahl geändert (Mehr): die Untätigkeit zählt ab jetzt – ein Wechsel auf „geteilt“ meldet nicht sofort ab
window.addEventListener('bt:geraet-art', () => { aktivMem = Date.now(); aktivGeschrieben = aktivMem; if (ich) speicher.setz(AKTIV, aktivMem); });
window.addEventListener('bt:abgemeldet', () => { if (ich && !abmeldenLauf) { lokalAbmelden(); toast('Sitzung abgelaufen – bitte neu anmelden.', 'warn'); } });
// 15.5 (F-029): wieder online → ein vorgemerktes Abmelden sofort nachholen (api.js holt es vor jeder Anfrage nach)
window.addEventListener('online', () => { if (!ich) get('/auth/benutzerliste').catch(() => {}); });
window.addEventListener('bt:2fa', () => { if (ich && !(ich.zweiFaktor && ich.zweiFaktor.pflicht && !ich.zweiFaktor.aktiv)) { ich.zweiFaktor = { aktiv: false, pflicht: true }; clearInterval(pollTimer); root.innerHTML = ''; zeige(); } });
window.addEventListener('bt:pin', () => { if (ich && !ich.mussPinAendern) { ich.mussPinAendern = true; clearInterval(pollTimer); root.innerHTML = ''; zeige(); } });
window.addEventListener('bt:nachgesendet', () => { holeMeldungen(); const { pfad } = pfadJetzt(); if (pfad === '/stempeln' || pfad === '/woche') zeige(); });
window.addEventListener('focus', () => { if (ich && !gemerktPruefen()) { holeMeldungen(); nachsenden(); } });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* ohne SW läuft die App normal weiter */ }); });
}

(async function los() {
  // 12.9: öffentliche Seite der Fernunterschrift – ohne Anmeldung und ohne App-Rahmen
  const fernLink = /^\/unterschrift\/([A-Za-z0-9_-]{16,200})\/?$/.exec(location.pathname);
  if (fernLink) { const { default: fern } = await import('./views/fern.js'); return fern(root, fernLink[1]); }
  root.innerHTML = laden('BauTag wird gestartet …');
  await ladeIch(true);
  if (!ich) root.innerHTML = '';
  zeige();
})();
