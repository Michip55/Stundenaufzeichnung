// Anmeldung: Benutzer wählen (oder Personalnummer eingeben, wenn die Namensliste abgeschaltet ist), dann PIN.
import { get, post, geraetArt, setzGeraetArt } from '../api.js';
import { ic, esc, MARK, avatar, rolleText, laden, speicher, fmt, geraetWahl, bindeGeraetWahl, $ } from '../ui.js';
import { geraetPushAbo } from './push.js';

// 15.5: Anmeldung der App am Gerät – Sitzung mit Bindungs-Cookie (F-029); das Push-Abo dieses Geräts nennen,
// damit der Server es einer anderen Person entzieht (F-014)
async function geraetAngaben() {
  const sub = await geraetPushAbo();
  return { bindung: true, ...(sub && sub.endpoint ? { pushEndpoint: sub.endpoint } : {}) };
}

const PIN_MAX = 12;
// D-01: Wenn der Server ein Ende der Sperre mitteilt, wird es angezeigt („läuft ab um …“)
function ablaufText(e) {
  const d = e.daten || {};
  const bis = d.gesperrtBis || d.sperreBis || d.ablauf || d.bis || (d.retryAfter ? new Date(Date.now() + d.retryAfter * 1000).toISOString() : null);
  if (!bis || /läuft ab/i.test(e.message || '')) return '';
  const t = new Date(bis); if (isNaN(t)) return '';
  const heute = fmt.iso(t) === fmt.iso();
  return ` Die Sperre läuft ab ${heute ? 'um' : `am ${fmt.datum(fmt.iso(t))} um`} ${fmt.uhr(t.toISOString())} Uhr.`;
}

export default async function login(root, { angemeldet }) {
  let liste = [];
  let ohneListe = false;   // Server liefert keine Namensliste (BAUTAG_LOGIN_LISTE=0) → Anmeldung mit Personalnummer
  let gewaehlt = null;     // {id, name, rolle?} oder {pnr, name}
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
      <div class="login-card" id="login-card">${laden('Wird geladen …')}</div>
    </main>
  </div>`;
  const card = $('#login-card', root);
  // 15.8: Gerätewahl je Gerät – gilt sofort für die nächste Anmeldung und bleibt nach dem Abmelden erhalten
  bindeGeraetWahl(card, setzGeraetArt);
  const untertitel = (b) => [b.rolle ? rolleText(b.rolle) : '', b.id === speicher.lies('bt_letzter') ? 'zuletzt angemeldet' : ''].filter(Boolean).join(' · ');

  function zeigeListe() {
    if (ohneListe) return zeigePnr();
    gewaehlt = null; pin = '';
    const zuletzt = speicher.lies('bt_letzter');
    card.innerHTML = `
      <div class="login-head"><h2>Anmelden</h2><p>Wer bist du?</p></div>
      <label class="search"><span>${ic('user')}</span><input id="login-suche" type="search" placeholder="Name suchen" aria-label="Name suchen" value="${esc(suche)}" autocomplete="off"></label>
      <div class="login-list" id="login-list"></div>
      ${geraetWahl(geraetArt())}`;
    const zeichne = () => {
      const g = liste.filter((b) => b.name.toLowerCase().includes(suche.toLowerCase()));
      g.sort((a, b) => (b.id === zuletzt) - (a.id === zuletzt));
      $('#login-list', card).innerHTML = g.length
        ? g.map((b) => `<button type="button" class="login-user" data-id="${b.id}">${avatar(b.name)}<span><b>${esc(b.name)}</b>${untertitel(b) ? `<small>${esc(untertitel(b))}</small>` : ''}</span>${ic('right')}</button>`).join('')
        : '<div class="state empty"><p>Kein Benutzer gefunden.</p></div>';
    };
    zeichne();
    const s = $('#login-suche', card);
    s.addEventListener('input', () => { suche = s.value; zeichne(); });
  }

  function zeigePnr(meldung = '') {
    gewaehlt = null; pin = '';
    card.innerHTML = `
      <div class="login-head"><h2>Anmelden</h2><p>Mit Personalnummer und PIN</p></div>
      <form id="pnr-form" class="stack-s" autocomplete="off" novalidate>
        <label class="field"><span class="field-label">Personalnummer</span><input class="input lg" id="pnr" name="pnr" inputmode="numeric" pattern="[0-9]*" maxlength="6" required autocomplete="username" value="${esc(speicher.lies('bt_letzte_pnr') || '')}"></label>
        <p class="form-err" id="pnr-err" role="alert" ${meldung ? '' : 'hidden'}>${esc(meldung)}</p>
        <button type="submit" class="btn primary lg block">Weiter${ic('right')}</button>
        <p class="muted sm">Die Personalnummer steht am Lohnzettel. Bei Fragen hilft das Büro.</p>
      </form>
      ${geraetWahl(geraetArt())}`;
    $('#pnr-form', card).addEventListener('submit', (e) => {
      e.preventDefault();
      const wert = $('#pnr', card).value.trim();
      if (!/^\d{1,6}$/.test(wert)) { const m = $('#pnr-err', card); m.hidden = false; m.textContent = 'Bitte die Personalnummer (nur Ziffern) eingeben.'; return; }
      gewaehlt = { pnr: Number(wert), name: `Personalnummer ${wert}` };
      pin = ''; zeigePin();
    });
    $('#pnr', card).focus();
  }

  function zeigePin(meldung = '', gesperrt = false) {
    card.innerHTML = `
      <button type="button" class="link-back" data-zurueck>${ic('left')}${ohneListe ? 'Andere Personalnummer' : 'Anderer Benutzer'}</button>
      <div class="pin-user">${gewaehlt.pnr ? `<span class="avatar xl" aria-hidden="true">${ic('user')}</span>` : avatar(gewaehlt.name, 'xl')}<h2>${esc(gewaehlt.name)}</h2><p>${esc(gewaehlt.rolle ? rolleText(gewaehlt.rolle) : '')}</p></div>
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
  function zeigeCode(vorgang, meldung = '', gesperrt = false) {
    card.innerHTML = `
      <button type="button" class="link-back" data-zurueck>${ic('left')}Abbrechen</button>
      <div class="pin-user">${gewaehlt.pnr ? `<span class="avatar xl" aria-hidden="true">${ic('user')}</span>` : avatar(gewaehlt.name, 'xl')}<h2>${esc(gewaehlt.name)}</h2><p>Zweiter Faktor</p></div>
      <form id="zf-login" class="stack-s" novalidate autocomplete="off">
        <label class="field"><span class="field-label">Code aus der Authenticator-App</span><input class="input lg zf-code" id="zf-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="9" placeholder="6 Ziffern" ${gesperrt ? 'disabled' : ''}></label>
        <p class="pin-msg${meldung ? ' err' : ''}" id="zf-msg" role="${meldung ? 'alert' : 'status'}">${esc(meldung || 'Die PIN stimmt. Bitte jetzt den aktuellen Code eingeben.')}</p>
        <button type="submit" class="btn primary lg block" id="zf-ok" ${gesperrt ? 'disabled' : ''}>${ic('check')}Anmelden</button>
        <p class="muted sm">Handy nicht zur Hand? Statt des Codes einen <b>Wiederherstellungscode</b> (xxxx-xxxx) eingeben. Sind keine mehr übrig, setzt die Geschäftsführung den zweiten Faktor zurück.</p>
      </form>`;
    const feld = $('#zf-code', card); if (feld && !gesperrt) feld.focus();
    $('#zf-login', card).addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = feld.value.trim().replace(/\s/g, '');
      if (!/^(\d{6}|[A-Za-z0-9]{4}-?[A-Za-z0-9]{4})$/.test(code)) { zeigeCode(vorgang, 'Bitte die 6 Ziffern aus der App oder einen Wiederherstellungscode eingeben.'); return; }
      $('#zf-ok', card).disabled = true;
      try {
        await post('/auth/login/2fa', { vorgang, code, ...(await geraetAngaben()) });
        if (gewaehlt.pnr) speicher.setz('bt_letzte_pnr', String(gewaehlt.pnr)); else speicher.setz('bt_letzter', gewaehlt.id);
        await angemeldet();
      } catch (x) {
        const zu = x.status === 429 || x.status === 423;
        const abgelaufen = x.status === 410 || x.status === 404 || /abgelaufen|Vorgang/i.test(x.message || '') && x.status !== 400 && x.status !== 401;
        if (abgelaufen && !zu) { zeigePin(`${x.message || 'Die Anmeldung ist abgelaufen.'} Bitte die PIN noch einmal eingeben.`); return; }
        zeigeCode(vorgang, x.netz ? 'Keine Verbindung zum Server.' : `${x.message || 'Der Code stimmt nicht.'}${x.status === 423 ? ablaufText(x) : ''}`, zu);
      }
    });
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
      const antwort = await post('/auth/login', { ...(gewaehlt.pnr ? { pnr: gewaehlt.pnr, pin } : { benutzerId: gewaehlt.id, pin }), ...(await geraetAngaben()) });
      // 12.7: PIN stimmt, aber es fehlt noch der Code aus der Authenticator-App
      if (antwort && antwort.zweiterFaktor) { sendet = false; pin = ''; zeigeCode(antwort.vorgang); return; }
      if (gewaehlt.pnr) speicher.setz('bt_letzte_pnr', String(gewaehlt.pnr)); else speicher.setz('bt_letzter', gewaehlt.id);
      sendet = false;
      await angemeldet();
    } catch (e) {
      sendet = false; pin = '';
      const text = e.netz ? 'Keine Verbindung zum Server. Bitte später erneut versuchen.'
        : e.status === 423 || e.code === 'KONTO_GESPERRT' ? `${e.message || 'Dieses Konto ist gesperrt.'}${/Büro/i.test(e.message || '') ? '' : ' Bitte im Büro melden – dort wird das Konto entsperrt.'}${ablaufText(e)}`
        : e.status === 429 ? (e.message || 'Zu viele Fehlversuche. Bitte später erneut versuchen.')
        : e.status === 401 || e.status === 400 ? (e.message || 'PIN falsch. Bitte erneut eingeben.')
        : e.message;
      zeigePin(text, e.status === 429 || e.status === 423);
    }
  }
  function ziffer(z) {
    if (sendet || !gewaehlt || pin.length >= PIN_MAX) return;
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
    if (!gewaehlt || !$('.pin-pad', card)) return;
    if (/^\d$/.test(e.key)) ziffer(e.key);
    else if (e.key === 'Backspace') { pin = pin.slice(0, -1); punkte(); }
    else if (e.key === 'Enter') { e.preventDefault(); sende(); }
    else if (e.key === 'Escape') zeigeListe();
  };
  document.addEventListener('keydown', taste);

  async function lade() {
    card.innerHTML = laden('Wird geladen …');
    try { liste = await get('/auth/benutzerliste'); ohneListe = false; zeigeListe(); }
    catch (e) {
      // Namensliste abgeschaltet (404/403): Anmeldung über die Personalnummer
      if (e.status === 404 || e.status === 403) { ohneListe = true; zeigePnr(); return; }
      card.innerHTML = `<div class="state big">${ic(e.netz ? 'wifiOff' : 'alert')}<h2>${e.netz ? 'Keine Verbindung' : 'Fehler'}</h2><p>${esc(e.netz ? 'Der Server ist nicht erreichbar. Zum Anmelden wird eine Verbindung benötigt.' : e.message)}</p><button type="button" class="btn ghost" data-neu-laden>Erneut versuchen</button></div>`;
    }
  }
  await lade();
  // 15.5: wieder online → Namensliste neu laden (davor holt api.js ein vorgemerktes Abmelden nach)
  const wiederOnline = () => { if (!gewaehlt && card.querySelector('[data-neu-laden]')) lade(); };
  window.addEventListener('online', wiederOnline);
  return () => { document.removeEventListener('keydown', taste); window.removeEventListener('online', wiederOnline); };
}
