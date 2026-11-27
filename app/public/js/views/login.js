// Anmeldung (15.33, Inhaber 19.11.2026: „eigener Name am eigenen Handy“): Standard ohne öffentliche Namensliste –
//  - eigenes Handy mit gemerkter Person: Name + „Auf diesem Handy gemerkt“ + PIN; „Andere Person“ → Personalnummer;
//  - sonst (und immer am geteilten Gerät, ohne Namen und ohne Vorbelegung): Personalnummer, dann PIN;
//  - nur mit BAUTAG_LOGIN_LISTE=1 am Server: Benutzer aus der Namensliste wählen, dann PIN (wie bis 15.32).
import { get, post, geraetArt, geraetVorwahl, handyPerson, vergissHandyPerson } from '../api.js';
import { ic, esc, MARK, avatar, rolleText, laden, speicher, fmt, geraetWahl, bindeGeraetWahl, $ } from '../ui.js';
import { geraetPushAbo } from './push.js';

// 15.5: Anmeldung der App am Gerät – Sitzung mit Bindungs-Cookie (F-029); das Push-Abo dieses Geräts nennen,
// damit der Server es einer anderen Person entzieht (F-014).
// 15.28: dazu die Gerätewahl der Anmeldeseite – „eigen“ ergibt eine Sitzung bis Sonntag 24:00 (nur Lebensdauer, nie Rechte)
async function geraetAngaben() {
  const sub = await geraetPushAbo();
  return { bindung: true, geraet: geraetArt() === 'eigen' ? 'eigen' : 'geteilt', ...(sub && sub.endpoint ? { pushEndpoint: sub.endpoint } : {}) };
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
  let ohneListe = true;    // 15.33: Standard – Server ohne Namensliste (nur BAUTAG_LOGIN_LISTE=1 schaltet sie ein) → Personalnummer
  let gewaehlt = null;     // {id, name, rolle?} (Namensliste), {pnr, name} (Personalnummer) oder {pnr, name, gemerkt: true} (eigenes Handy)
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
  // 15.8: Gerätewahl je Gerät – bleibt nach dem Abmelden erhalten. 15.21: Standard „Eigenes Handy“; die hier gezeigte Wahl gilt
  // nach der Anmeldung sofort für die Person, die sich anmeldet (ohne Bestätigung). „Geteiltes Gerät“ bleibt für das Gerät gemerkt.
  // 15.33: „Geteiltes Gerät“ gewählt → die gemerkte Person ist sofort vergessen (api.js), es geht mit der Personalnummer weiter
  bindeGeraetWahl(card, (art) => {
    geraetVorwahl(art);
    if (art !== 'geteilt') return;
    if (gewaehlt && gewaehlt.gemerkt) { zeigePnr(); return; }
    const z = $('#pnr-form', card) && $('[data-zurueck]', card); if (z) z.remove();
  });
  const untertitel = (b) => [b.rolle ? rolleText(b.rolle) : '', b.id === speicher.lies('bt_letzter') ? 'zuletzt angemeldet' : ''].filter(Boolean).join(' · ');

  /** Startansicht: Namensliste (nur wenn eingeschaltet), gemerkte Person am eigenen Handy oder Personalnummer */
  function anfang() {
    if (!ohneListe) return zeigeListe();
    const p = handyPerson();
    if (p) { gewaehlt = { pnr: p.pnr, name: p.name, gemerkt: true }; pin = ''; return zeigePin(); }
    return zeigePnr();
  }

  function zeigeListe() {
    if (ohneListe) return anfang();
    gewaehlt = null; pin = '';
    const zuletzt = speicher.lies('bt_letzter');
    card.innerHTML = `
      <div class="login-head"><h2>Anmelden</h2><p>Wer bist du?</p></div>
      <label class="search"><span>${ic('user')}</span><input id="login-suche" type="search" placeholder="Name suchen" aria-label="Name suchen" value="${esc(suche)}" autocomplete="off"></label>
      <div class="login-list" id="login-list"></div>
      ${geraetWahl(geraetArt(), { anmeldeseite: true })}`;
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

  // 15.33: nie vorbelegt (am geteilten Gerät verrät nichts, wer sich zuletzt angemeldet hat); am eigenen Handy mit gemerkter
  // Person führt „Zurück“ wieder zu ihr
  function zeigePnr(meldung = '') {
    gewaehlt = null; pin = '';
    const p = handyPerson();
    card.innerHTML = `
      ${p ? `<button type="button" class="link-back" data-zurueck>${ic('left')}Zurück</button>` : ''}
      <div class="login-head"><h2>Anmelden</h2><p>Mit Personalnummer und PIN</p></div>
      <form id="pnr-form" class="stack-s" autocomplete="off" novalidate>
        <label class="field"><span class="field-label">Personalnummer</span><input class="input lg" id="pnr" name="pnr" inputmode="numeric" pattern="[0-9]*" maxlength="6" required autocomplete="off"></label>
        <p class="form-err" id="pnr-err" role="alert" ${meldung ? '' : 'hidden'}>${esc(meldung)}</p>
        <button type="submit" class="btn primary lg block">Weiter${ic('right')}</button>
        <p class="muted sm">Die Personalnummer steht am Lohnzettel und in der App unter „Mehr“. Bei Fragen hilft das Büro.</p>
      </form>
      ${geraetWahl(geraetArt(), { anmeldeseite: true })}`;
    $('#pnr-form', card).addEventListener('submit', (e) => {
      e.preventDefault();
      const wert = $('#pnr', card).value.trim();
      if (!/^\d{1,6}$/.test(wert)) { const m = $('#pnr-err', card); m.hidden = false; m.textContent = 'Bitte die Personalnummer (nur Ziffern) eingeben.'; return; }
      gewaehlt = { pnr: Number(wert), name: `Personalnummer ${wert}` };
      pin = ''; zeigePin();
    });
    $('#pnr', card).focus();
  }

  const kopfBild = () => (gewaehlt.pnr && !gewaehlt.gemerkt ? `<span class="avatar xl" aria-hidden="true">${ic('user')}</span>` : avatar(gewaehlt.name, 'xl'));
  // 15.33 Nachprüfung: `hilfe` – bei der gemerkten Person nach „Benutzer oder PIN falsch“ der Ausweg (Personalnummer geändert,
  // Konto deaktiviert); verrät nicht, ob Nummer oder PIN falsch war
  function zeigePin(meldung = '', gesperrt = false, hilfe = false) {
    const gemerkt = !!gewaehlt.gemerkt;
    card.innerHTML = `
      ${gemerkt ? '' : `<button type="button" class="link-back" ${ohneListe ? 'data-zurueck-pnr' : 'data-zurueck'}>${ic('left')}${ohneListe ? 'Andere Personalnummer' : 'Anderer Benutzer'}</button>`}
      <div class="pin-user${gemerkt ? ' gemerkt' : ''}">${kopfBild()}<h2>${esc(gewaehlt.name)}</h2><p>${esc(gemerkt ? 'Auf diesem Handy gemerkt' : gewaehlt.rolle ? rolleText(gewaehlt.rolle) : '')}</p></div>
      <div class="pin-dots${meldung ? ' shake' : ''}" aria-hidden="true"></div>
      <p class="pin-msg${meldung ? ' err' : ''}" id="pin-msg" role="${meldung ? 'alert' : 'status'}">${esc(meldung || 'PIN eingeben und bestätigen')}</p>
      ${gemerkt && hilfe ? '<p class="pin-hilfe" id="pin-hilfe">Stimmt die PIN sicher? Dann unten über „Andere Person“ mit der Personalnummer anmelden – oder im Büro nachfragen.</p>' : ''}
      <div class="pin-pad" role="group" aria-label="PIN-Eingabe">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-z="${n}" ${gesperrt ? 'disabled' : ''}>${n}</button>`).join('')}
        <button type="button" class="pin-del" data-loeschen aria-label="Letzte Ziffer löschen">${ic('back')}</button>
        <button type="button" data-z="0" ${gesperrt ? 'disabled' : ''}>0</button>
        <button type="button" class="pin-ok" data-ok aria-label="Anmelden" disabled>${ic('check')}</button>
      </div>
      ${gemerkt ? `<button type="button" class="btn ghost lg block login-andere" data-andere>${ic('users')}Andere Person</button>
      ${geraetWahl(geraetArt(), { anmeldeseite: true })}` : ''}`;
    punkte();
  }
  function zeigeCode(vorgang, meldung = '', gesperrt = false) {
    card.innerHTML = `
      <button type="button" class="link-back" data-zurueck>${ic('left')}Abbrechen</button>
      <div class="pin-user">${kopfBild()}<h2>${esc(gewaehlt.name)}</h2><p>Zweiter Faktor</p></div>
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
        if (!gewaehlt.pnr) speicher.setz('bt_letzter', gewaehlt.id); // 15.33: Name + Personalnummer merkt app.js (nur am eigenen Handy)
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
      if (!gewaehlt.pnr) speicher.setz('bt_letzter', gewaehlt.id); // 15.33: Name + Personalnummer merkt app.js (nur am eigenen Handy)
      sendet = false;
      await angemeldet();
    } catch (e) {
      sendet = false; pin = '';
      const text = e.netz ? 'Keine Verbindung zum Server. Bitte später erneut versuchen.'
        : e.status === 423 || e.code === 'KONTO_GESPERRT' ? `${e.message || 'Dieses Konto ist gesperrt.'}${/Büro/i.test(e.message || '') ? '' : ' Bitte im Büro melden – dort wird das Konto entsperrt.'}${ablaufText(e)}`
        : e.status === 429 ? (e.message || 'Zu viele Fehlversuche. Bitte später erneut versuchen.')
        : e.status === 401 || e.status === 400 ? (e.message || 'PIN falsch. Bitte erneut eingeben.')
        : e.message;
      zeigePin(text, e.status === 429 || e.status === 423, !e.netz && (e.status === 401 || e.status === 400));
    }
  }
  function ziffer(z) {
    if (sendet || !gewaehlt || pin.length >= PIN_MAX) return;
    // Nr. 3: beim ersten neuen Tippen nach einer falschen PIN Schildchen und rote Kreise zurücknehmen (nicht bei gesperrtem Ziffernblock)
    const m = $('#pin-msg', card); if (m && m.classList.contains('err') && !$('.pin-pad [data-z]:disabled', card)) m.classList.remove('err');
    pin += z; punkte();
  }
  card.addEventListener('click', (e) => {
    const u = e.target.closest('.login-user');
    if (u) { gewaehlt = liste.find((b) => String(b.id) === u.dataset.id); pin = ''; zeigePin(); return; }
    if (e.target.closest('[data-zurueck]')) { anfang(); return; }
    if (e.target.closest('[data-zurueck-pnr]') || e.target.closest('[data-andere]')) { zeigePnr(); return; }
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
    else if (e.key === 'Escape') { if (ohneListe && !gewaehlt.gemerkt) zeigePnr(); else anfang(); }
  };
  document.addEventListener('keydown', taste);

  async function lade() {
    card.innerHTML = laden('Wird geladen …');
    speicher.weg('bt_letzte_pnr'); // 15.33: bis 15.32 gemerkte Personalnummer – wird nicht mehr vorbelegt
    if (geraetArt() !== 'eigen') vergissHandyPerson();
    try {
      // 15.33: erst fragen, ob die Namensliste eingeschaltet ist – ohne sie (Standard) wird sie gar nicht abgefragt
      const a = await get('/auth/anmeldung');
      ohneListe = !(a && a.namensliste === true);
      if (!ohneListe) {
        try { liste = await get('/auth/benutzerliste'); } catch (e) { if (e.status === 404 || e.status === 403) ohneListe = true; else throw e; }
      }
      anfang();
    } catch (e) {
      card.innerHTML = `<div class="state big">${ic(e.netz ? 'wifiOff' : 'alert')}<h2>${e.netz ? 'Keine Verbindung' : 'Fehler'}</h2><p>${esc(e.netz ? 'Der Server ist nicht erreichbar. Zum Anmelden wird eine Verbindung benötigt.' : e.message)}</p><button type="button" class="btn ghost" data-neu-laden>Erneut versuchen</button></div>`;
    }
  }
  await lade();
  // 15.5: wieder online → Namensliste neu laden (davor holt api.js ein vorgemerktes Abmelden nach)
  const wiederOnline = () => { if (!gewaehlt && card.querySelector('[data-neu-laden]')) lade(); };
  window.addEventListener('online', wiederOnline);
  return () => { document.removeEventListener('keydown', taste); window.removeEventListener('online', wiederOnline); };
}
