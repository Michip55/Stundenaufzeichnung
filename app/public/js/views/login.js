// Anmeldung: Benutzer wählen, PIN eingeben.
import { get, post } from '../api.js';
import { ic, esc, MARK, avatar, rolleText, laden, speicher, $, $$ } from '../ui.js';

export default async function login(root, { angemeldet }) {
  let liste = [];
  let gewaehlt = null;
  let pin = '';
  let sendet = false;
  let suche = '';

  root.innerHTML = `
  <div class="login">
    <aside class="login-brand">
      <div class="lb-top">${MARK}<span><b>BauTag</b><small>Baustellen-Plattform</small></span></div>
      <div class="lb-mid">
        <h1>Stunden, Bautagesbericht und Nachkalkulation an einem Ort.</h1>
        <ul>
          <li>${ic('clock')}<span><b>Stempeln</b> in zwei Sekunden – auch ohne Netz</span></li>
          <li>${ic('clipboard')}<span><b>Bautagesbericht</b> wie auf Papier, mit Unterschrift am Gerät</span></li>
          <li>${ic('shield')}<span><b>Rechte je Rolle</b> – jeder sieht nur, was er sehen darf</span></li>
        </ul>
      </div>
      <div class="lb-foot">Die Daten liegen am eigenen Server des Betriebs.</div>
    </aside>
    <main class="login-panel">
      <div class="login-mobile-brand">${MARK}<span><b>BauTag</b><small>Baustellen-Plattform</small></span></div>
      <div class="login-card" id="login-card">${laden('Benutzer werden geladen …')}</div>
    </main>
  </div>`;
  const card = $('#login-card', root);

  function zeigeListe() {
    gewaehlt = null; pin = '';
    const zuletzt = speicher.lies('bt_letzter');
    card.innerHTML = `
      <div class="login-head"><h2>Anmelden</h2><p>Wer bist du?</p></div>
      <label class="search"><span>${ic('user')}</span><input id="login-suche" type="search" placeholder="Name suchen" aria-label="Name suchen" value="${esc(suche)}" autocomplete="off"></label>
      <div class="login-list" id="login-list"></div>`;
    const zeichne = () => {
      const g = liste.filter((b) => b.name.toLowerCase().includes(suche.toLowerCase()));
      g.sort((a, b) => (b.id === zuletzt) - (a.id === zuletzt));
      $('#login-list', card).innerHTML = g.length
        ? g.map((b) => `<button type="button" class="login-user" data-id="${b.id}" data-rolle="${esc(b.rolle)}">${avatar(b.name)}<span><b>${esc(b.name)}</b><small>${esc(rolleText(b.rolle))}${b.id === zuletzt ? ' · zuletzt angemeldet' : ''}</small></span>${ic('right')}</button>`).join('')
        : '<div class="state empty"><p>Kein Benutzer gefunden.</p></div>';
    };
    zeichne();
    const s = $('#login-suche', card);
    s.addEventListener('input', () => { suche = s.value; zeichne(); });
  }

  function zeigePin(meldung = '', gesperrt = false) {
    card.innerHTML = `
      <button type="button" class="link-back" data-zurueck>${ic('left')}Anderer Benutzer</button>
      <div class="pin-user">${avatar(gewaehlt.name, 'xl')}<h2>${esc(gewaehlt.name)}</h2><p>${esc(rolleText(gewaehlt.rolle))}</p></div>
      <div class="pin-dots${meldung ? ' shake' : ''}" aria-hidden="true"></div>
      <p class="pin-msg${meldung ? ' err' : ''}" id="pin-msg" role="${meldung ? 'alert' : 'status'}">${esc(meldung || 'PIN eingeben und bestätigen')}</p>
      <div class="pin-pad" role="group" aria-label="PIN-Eingabe">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-z="${n}" ${gesperrt ? 'disabled' : ''}>${n}</button>`).join('')}
        <button type="button" class="pin-del" data-loeschen aria-label="Letzte Ziffer löschen">${ic('back')}</button>
        <button type="button" data-z="0" ${gesperrt ? 'disabled' : ''}>0</button>
        <button type="button" class="pin-ok" data-ok aria-label="Anmelden" disabled>${ic('check')}</button>
      </div>`;
    punkte();
  }
  const punkte = () => {
    const d = $('.pin-dots', card); if (!d) return;
    d.innerHTML = Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join('');
    const ok = $('[data-ok]', card); if (ok) ok.disabled = pin.length < 4 || sendet;
  };

  async function sende() {
    if (sendet || pin.length < 4) return;
    sendet = true; punkte();
    $('#pin-msg', card).textContent = 'Wird geprüft …';
    try {
      await post('/auth/login', { benutzerId: gewaehlt.id, pin });
      speicher.setz('bt_letzter', gewaehlt.id);
      sendet = false;
      await angemeldet();
    } catch (e) {
      sendet = false; pin = '';
      const text = e.netz ? 'Keine Verbindung zum Server. Bitte später erneut versuchen.'
        : e.status === 429 ? (e.message || 'Zu viele Fehlversuche. Bitte in 5 Minuten erneut versuchen.')
        : e.status === 401 || e.status === 400 ? (e.message || 'PIN falsch. Bitte erneut eingeben.')
        : e.message;
      zeigePin(text, e.status === 429);
    }
  }
  function ziffer(z) {
    if (sendet || !gewaehlt || pin.length >= 8) return;
    pin += z; punkte();
  }
  card.addEventListener('click', (e) => {
    const u = e.target.closest('.login-user');
    if (u) { gewaehlt = liste.find((b) => String(b.id) === u.dataset.id); pin = ''; zeigePin(); return; }
    if (e.target.closest('[data-zurueck]')) { zeigeListe(); return; }
    const z = e.target.closest('[data-z]');
    if (z && !z.disabled) { ziffer(z.dataset.z); return; }
    if (e.target.closest('[data-loeschen]')) { pin = pin.slice(0, -1); punkte(); }
    if (e.target.closest('[data-ok]')) sende();
    if (e.target.closest('[data-neu-laden]')) lade();
  });
  const taste = (e) => {
    if (!gewaehlt) return;
    if (/^\d$/.test(e.key)) ziffer(e.key);
    else if (e.key === 'Backspace') { pin = pin.slice(0, -1); punkte(); }
    else if (e.key === 'Enter') { e.preventDefault(); sende(); }
    else if (e.key === 'Escape') zeigeListe();
  };
  document.addEventListener('keydown', taste);

  async function lade() {
    card.innerHTML = laden('Benutzer werden geladen …');
    try { liste = await get('/auth/benutzerliste'); zeigeListe(); }
    catch (e) {
      card.innerHTML = `<div class="state big">${ic(e.netz ? 'wifiOff' : 'alert')}<h2>${e.netz ? 'Keine Verbindung' : 'Fehler'}</h2><p>${esc(e.netz ? 'Der Server ist nicht erreichbar. Zum Anmelden wird eine Verbindung benötigt.' : e.message)}</p><button type="button" class="btn ghost" data-neu-laden>Erneut versuchen</button></div>`;
    }
  }
  await lade();
  return () => document.removeEventListener('keydown', taste);
}
