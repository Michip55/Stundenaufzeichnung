// Dienste & Sicherheit (nur Geschäftsführung, API.md 12.5 / 12.7): E-Mail-Versand (SMTP) mit Test-Mail, Pflicht zur Zwei-Faktor-Anmeldung je Rolle.
import { get, post, put } from '../api.js';
import { ic, esc, banner, toast, laden, rolleText, $ } from '../ui.js';

export async function diensteTab(box, ctx) {
  box.innerHTML = laden();
  let mail, sich;
  const lade = async () => { [mail, sich] = await Promise.all([get('/einstellungen/email').catch((e) => ({ fehler: e.message })), get('/einstellungen/sicherheit').catch((e) => ({ fehler: e.message }))]); };
  await lade();
  function zeichne() {
    const m = mail || {}; const pflicht = (sich && sich.zweiFaktorPflicht) || {};
    box.innerHTML = `<div class="stack" id="dienste">
      <section class="card" aria-labelledby="h-mail"><div class="card-h pad-h"><h3 id="h-mail">${ic('mail')}E-Mail-Versand (SMTP)</h3><span class="chip ${m.aktiv && m.host ? 'st-green' : 'st-grey'}" data-mail-zustand="${m.aktiv && m.host ? 'aktiv' : 'aus'}">${m.aktiv && m.host ? 'Eingerichtet' : 'Nicht eingerichtet'}</span></div>
        ${m.fehler ? `<p class="pad-s form-err">${esc(m.fehler)}</p>` : `
        <form id="mail-form" class="pad form-grid" autocomplete="off" novalidate>
          ${m.quelle === 'umgebung' ? `<div class="full">${banner('info', 'Die Zugangsdaten kommen derzeit aus den Umgebungsvariablen des Servers (SMTP_…). Wird hier gespeichert, gelten die Einstellungen von hier.')}</div>` : ''}
          ${m.schluesselVorhanden === false ? `<div class="full">${banner('warn', 'Am Server fehlt BAUTAG_SCHLUESSEL – ohne ihn kann kein Passwort gespeichert werden.')}</div>` : ''}
          <label class="field"><span class="field-label">Postausgangsserver (Host)</span><input class="input lg" name="host" value="${esc(m.host || '')}" placeholder="z. B. smtp.anbieter.at" maxlength="200"></label>
          <label class="field"><span class="field-label">Port</span><input class="input lg num" name="port" inputmode="numeric" value="${esc(m.port || 587)}"></label>
          <label class="field"><span class="field-label">Benutzername</span><input class="input lg" name="benutzer" value="${esc(m.benutzer || '')}" autocomplete="off"></label>
          <label class="field"><span class="field-label">Passwort ${m.passwortGesetzt ? '(gespeichert – leer lassen = unverändert)' : ''}</span><input class="input lg" type="password" name="passwort" autocomplete="new-password" placeholder="${m.passwortGesetzt ? '••••••••' : ''}"></label>
          <label class="field full"><span class="field-label">Absender</span><input class="input lg" name="absender" value="${esc(m.absender || '')}" placeholder="BauTag &lt;bautag@firma.at&gt;" maxlength="200"></label>
          <label class="switch-row flat"><span><b>TLS ab Verbindungsbeginn</b><small>Meist Port 465. Port 587 verwendet STARTTLS.</small></span><input type="checkbox" class="vh" name="sicher" ${m.sicher ? 'checked' : ''}><span class="switch" aria-hidden="true"></span></label>
          <label class="switch-row flat"><span><b>Versand aktiv</b><small>Unterschriebene Berichte gehen an den Auftraggeber, wenn bei der Baustelle eine Adresse steht.</small></span><input type="checkbox" class="vh" name="aktiv" ${m.aktiv ? 'checked' : ''}><span class="switch" aria-hidden="true"></span></label>
          <p class="form-err full" role="alert" hidden></p>
          <button type="submit" class="btn primary full" id="mail-ok">${ic('check')}E-Mail-Einstellungen speichern</button>
        </form>
        <form id="mail-test" class="pad bt form-grid" novalidate>
          <label class="field"><span class="field-label">Test-Mail an</span><input class="input lg" type="email" name="an" required placeholder="name@firma.at"></label>
          <div class="field"><span class="field-label">&nbsp;</span><button type="submit" class="btn ghost lg" id="mail-test-ok">${ic('mail')}Test-Mail senden</button></div>
          <p class="full" id="mail-test-erg" role="status" hidden></p>
        </form>`}
      </section>
      <section class="card" aria-labelledby="h-2fa"><div class="card-h pad-h"><h3 id="h-2fa">${ic('shield')}Zwei-Faktor-Anmeldung – Pflicht je Rolle</h3></div>
        ${sich && sich.fehler ? `<p class="pad-s form-err">${esc(sich.fehler)}</p>` : ['gf', 'buero', 'bauleiter'].map((r) => `<label class="switch-row"><span><b>${esc(rolleText(r))}</b><small>Anmeldung nur mit PIN und Code aus der Authenticator-App.</small></span><input type="checkbox" class="vh" data-pflicht="${r}" ${pflicht[r] ? 'checked' : ''}><span class="switch" aria-hidden="true"></span></label>`).join('')}
        <p class="card-note">Wer Pflicht hat und noch keinen zweiten Faktor eingerichtet hat, muss ihn nach der nächsten Anmeldung einrichten. Mitarbeiter und Poliere melden sich weiter nur mit der PIN an.</p>
      </section></div>`;
  }
  zeichne();
  box.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (e.target.id === 'mail-form') {
      const err = $('.form-err', e.target); const port = Number(f.get('port'));
      if (f.get('aktiv') === 'on' && !String(f.get('host')).trim()) { err.hidden = false; err.textContent = 'Bitte den Postausgangsserver eintragen.'; return; }
      if (!(port >= 1 && port <= 65535)) { err.hidden = false; err.textContent = 'Bitte einen gültigen Port eintragen (z. B. 587).'; return; }
      const body = { host: String(f.get('host')).trim(), port, sicher: f.get('sicher') === 'on', benutzer: String(f.get('benutzer')).trim(), absender: String(f.get('absender')).trim(), aktiv: f.get('aktiv') === 'on' };
      if (f.get('passwort')) body.passwort = f.get('passwort');
      try { mail = await put('/einstellungen/email', body); toast('E-Mail-Einstellungen gespeichert.'); zeichne(); } catch (x) { err.hidden = false; err.textContent = x.message; }
    } else if (e.target.id === 'mail-test') {
      const erg = $('#mail-test-erg', box); const b = $('#mail-test-ok', box);
      if (!String(f.get('an')).includes('@')) { erg.hidden = false; erg.className = 'full form-err'; erg.textContent = 'Bitte eine E-Mail-Adresse eintragen.'; return; }
      b.disabled = true; erg.hidden = false; erg.className = 'full muted sm'; erg.textContent = 'Test-Mail wird gesendet …';
      try { await post('/einstellungen/email/test', { an: String(f.get('an')).trim() }); erg.className = 'full banner ok'; erg.dataset.ergebnis = 'ok'; erg.textContent = `Test-Mail an ${f.get('an')} wurde vom Server angenommen.`; }
      catch (x) { erg.className = 'full banner err'; erg.dataset.ergebnis = 'fehler'; erg.textContent = `Versand fehlgeschlagen: ${x.message}`; }
      b.disabled = false;
    }
  });
  box.addEventListener('change', async (e) => {
    const t = e.target.closest('[data-pflicht]'); if (!t) return;
    const neu = { ...((sich && sich.zweiFaktorPflicht) || {}), [t.dataset.pflicht]: t.checked };
    try { sich = await put('/einstellungen/sicherheit', { zweiFaktorPflicht: neu }); toast(`Zwei-Faktor-Pflicht für ${rolleText(t.dataset.pflicht)} ${t.checked ? 'eingeschaltet' : 'ausgeschaltet'}.`); }
    catch (x) { t.checked = !t.checked; toast(x.message, 'warn'); }
  });
}
