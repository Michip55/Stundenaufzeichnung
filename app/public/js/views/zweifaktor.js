// Zwei-Faktor-Anmeldung (TOTP, API.md 12.7) für Bauleiter, Büro und Geschäftsführung:
// einrichten (QR-Code vom Server, Code bestätigen), Wiederherstellungscodes anzeigen/herunterladen, neue Codes, ausschalten.
import { get, post } from '../api.js';
import { ic, esc, MARK, banner, toast, dialog, $ } from '../ui.js';

function codesHtml(codes, name) {
  return `<div id="zf-codes" class="stack-s">
    ${banner('warn', '<b>Wiederherstellungscodes jetzt sichern.</b> Sie werden nur dieses eine Mal angezeigt. Jeder Code gilt einmal – für den Fall, dass das Handy mit der Authenticator-App fehlt.')}
    <ol class="zf-codeliste">${codes.map((c) => `<li><code>${esc(c)}</code></li>`).join('')}</ol>
    <div class="btn-zeile"><a class="btn ghost" id="zf-download" download="BauTag-Wiederherstellungscodes.txt" href="data:text/plain;charset=utf-8,${encodeURIComponent(`BauTag – Wiederherstellungscodes für ${name}\nErstellt am ${new Date().toLocaleDateString('de-AT')}\nJeder Code gilt einmal.\n\n${codes.join('\n')}\n`)}">${ic('download')}Als Datei speichern</a>
      <button type="button" class="btn ghost" id="zf-kopieren">Kopieren</button></div>
    <label class="check-inline"><input type="checkbox" id="zf-gesichert"> Ich habe die Codes sicher aufbewahrt.</label>
    <button type="button" class="btn primary lg block" id="zf-fertig" disabled>Fertig</button></div>`;
}

// Kern: zeichnet in `box`; `fertig()` wird nach erfolgreichem Einrichten (und Sichern der Codes) aufgerufen
async function einrichtung(box, ich, { fertig, erzwungen }) {
  let st;
  try { st = await get('/auth/2fa'); } catch (e) { box.innerHTML = `<div class="state">${ic('alert')}<p>${esc(e.message)}</p></div>`; return; }
  let schritt = 'start', daten = null, codes = null;
  function zeichne(meldung = '') {
    if (!st.moeglich) { box.innerHTML = `<div class="pad-s">${banner('info', 'Die Zwei-Faktor-Anmeldung gibt es für Bauleitung, Büro und Geschäftsführung. Für Ihre Rolle genügt die PIN.')}</div>`; return; }
    if (schritt === 'codes') { box.innerHTML = `<div class="pad">${codesHtml(codes, ich.benutzer.name)}</div>`; return; }
    if (st.aktiv && schritt === 'start') {
      box.innerHTML = `<div class="pad stack-s" data-zf="aktiv">
        <p><span class="chip st-green">${ic('check')}Eingeschaltet</span> ${st.pflicht ? 'Für Ihre Rolle ist der zweite Faktor Pflicht.' : ''}</p>
        <p class="muted sm">Noch ${st.restcodes ?? '–'} unbenutzte Wiederherstellungscodes.</p>
        <form id="zf-neu" class="form-grid" novalidate><label class="field"><span class="field-label">Aktueller Code aus der App</span><input class="input lg" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="9"></label>
          <div class="field"><span class="field-label">&nbsp;</span><button type="submit" class="btn ghost lg">Neue Wiederherstellungscodes</button></div></form>
        ${st.pflicht ? '' : `<form id="zf-aus" class="form-grid bt-oben" novalidate><label class="field"><span class="field-label">PIN</span><input class="input lg" type="password" name="pin" inputmode="numeric" autocomplete="current-password" maxlength="12"></label>
          <label class="field"><span class="field-label">Code aus der App</span><input class="input lg" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="9"></label>
          <button type="submit" class="btn danger full">Zwei-Faktor-Anmeldung ausschalten</button></form>`}
        <p class="form-err" id="zf-err" role="alert" ${meldung ? '' : 'hidden'}>${esc(meldung)}</p></div>`;
      return;
    }
    if (schritt === 'start') {
      box.innerHTML = `<form id="zf-start" class="pad stack-s" data-zf="start" novalidate>
        ${erzwungen ? banner('info', '<b>Für Ihre Rolle ist die Zwei-Faktor-Anmeldung Pflicht.</b> Bitte jetzt einrichten – das dauert zwei Minuten.', 'lock') : '<p>Zusätzlich zur PIN wird bei der Anmeldung ein Code aus einer Authenticator-App verlangt (z. B. Google Authenticator, Microsoft Authenticator, Aegis). Das schützt Preise und Lohndaten, falls jemand die PIN errät.</p>'}
        <ol class="schritte"><li>Authenticator-App am Handy installieren.</li><li>Hier die PIN eingeben – dann erscheint ein QR-Code zum Scannen.</li><li>Den 6-stelligen Code aus der App eintragen.</li></ol>
        <label class="field"><span class="field-label">Zur Bestätigung: Ihre PIN</span><input class="input lg" type="password" name="pin" inputmode="numeric" autocomplete="current-password" maxlength="12" required></label>
        <p class="form-err" id="zf-err" role="alert" ${meldung ? '' : 'hidden'}>${esc(meldung)}</p>
        <button type="submit" class="btn primary lg block">${ic('shield')}Einrichtung starten</button></form>`;
      return;
    }
    // schritt === 'qr'
    box.innerHTML = `<form id="zf-best" class="pad stack-s" data-zf="qr" novalidate>
      <p><b>1.</b> Diesen QR-Code mit der Authenticator-App scannen:</p>
      <div class="zf-qr">${/^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/.test(daten.qrSvg || '') ? `<img src="${daten.qrSvg}" alt="QR-Code für die Authenticator-App" width="220" height="220">` : '<p class="muted sm">QR-Code nicht verfügbar – bitte den Schlüssel händisch eintragen.</p>'}</div>
      <details class="einzeln"><summary>Scannen geht nicht? Schlüssel händisch eintragen</summary><p class="zf-geheim"><code id="zf-geheimnis">${esc(String(daten.geheimnis || '').replace(/(.{4})/g, '$1 ').trim())}</code></p><p class="muted sm">Konto: BauTag · Art: zeitbasiert (TOTP), 6 Ziffern.</p></details>
      <label class="field"><span class="field-label"><b>2.</b> Code aus der App (6 Ziffern)</span><input class="input lg zf-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>
      <p class="form-err" id="zf-err" role="alert" ${meldung ? '' : 'hidden'}>${esc(meldung)}</p>
      <button type="submit" class="btn primary lg block">${ic('check')}Code prüfen und einschalten</button></form>`;
    const c = $('input[name="code"]', box); if (c) c.focus();
  }
  zeichne();
  box.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    try {
      if (e.target.id === 'zf-start') {
        if (!f.get('pin')) return zeichne('Bitte die PIN eingeben.');
        daten = await post('/auth/2fa/einrichten', { pin: f.get('pin') }); schritt = 'qr'; zeichne();
      } else if (e.target.id === 'zf-best') {
        const code = String(f.get('code') || '').replace(/\s/g, '');
        if (!/^\d{6}$/.test(code)) return zeichne('Bitte die 6 Ziffern aus der App eingeben.');
        const r = await post('/auth/2fa/bestaetigen', { code }); codes = r.wiederherstellungscodes || []; st.aktiv = true; schritt = 'codes'; zeichne();
      } else if (e.target.id === 'zf-neu') {
        const r = await post('/auth/2fa/codes', { code: String(f.get('code') || '').trim() }); codes = r.wiederherstellungscodes || r.codes || []; schritt = 'codes'; zeichne();
      } else if (e.target.id === 'zf-aus') {
        await post('/auth/2fa/aus', { pin: f.get('pin'), code: String(f.get('code') || '').trim() }); st = await get('/auth/2fa'); schritt = 'start'; toast('Zwei-Faktor-Anmeldung ausgeschaltet.'); zeichne();
      }
    } catch (x) { zeichne(x.netz ? 'Keine Verbindung zum Server.' : x.message); }
  });
  box.addEventListener('change', (e) => { if (e.target.id === 'zf-gesichert') $('#zf-fertig', box).disabled = !e.target.checked; });
  box.addEventListener('click', async (e) => {
    if (e.target.closest('#zf-kopieren')) { try { await navigator.clipboard.writeText(codes.join('\n')); toast('Codes kopiert.'); } catch (x) { toast('Kopieren nicht möglich – bitte die Datei speichern.', 'warn'); } }
    if (e.target.closest('#zf-fertig')) { codes = null; schritt = 'start'; try { st = await get('/auth/2fa'); } catch (x) { /* Anzeige bleibt */ } toast('Zwei-Faktor-Anmeldung ist eingeschaltet.'); if (fertig) await fertig(); else zeichne(); }
  });
}

// Erzwungen (Pflicht für die Rolle): ganzer Bildschirm ohne Navigation
export function zweiFaktorErzwungen(root, ich, { fertig, abmelden }) {
  root.innerHTML = `<div class="login"><main class="login-panel solo">
    <div class="login-mobile-brand always">${MARK}<span><b>BauTag</b><small>Baustellen-Plattform</small></span></div>
    <div class="login-card zf-karte" id="zf-pflicht" data-zustand="2fa-einrichten"><div class="login-head"><h2>Zwei-Faktor-Anmeldung einrichten</h2><p>${esc(ich.benutzer.name)}</p></div><div id="zf-box"></div>
      <button type="button" class="link-back" id="zf-abmelden">${ic('logout')}Abmelden</button></div></main></div>`;
  einrichtung($('#zf-box', root), ich, { fertig, erzwungen: true });
  $('#zf-abmelden', root).addEventListener('click', abmelden);
}
export default async function zweifaktor(el, ctx) {
  el.innerHTML = `<div class="page narrow wide-md"><a class="link-back" href="#/mehr">${ic('left')}Zurück</a><section class="card" id="zf-karte"><div class="card-h pad-h"><h3>${ic('shield')}Zwei-Faktor-Anmeldung</h3></div><div id="zf-box"></div></section></div>`;
  await einrichtung($('#zf-box', el), ctx.ich, { fertig: null, erzwungen: false });
}
