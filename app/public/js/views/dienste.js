// Dienste & Sicherheit (nur Geschäftsführung, API.md 12.5 / 12.7): E-Mail-Versand (SMTP) mit Test-Mail, Pflicht zur Zwei-Faktor-Anmeldung je Rolle.
import { get, post, put } from '../api.js';
import { ic, esc, banner, toast, laden, rolleText, $ } from '../ui.js';

export async function diensteTab(box, ctx) {
  box.innerHTML = laden();
  let mail, sich, ki;
  const lade = async () => { ki = await get('/einstellungen/ki').catch((e) => ({ fehler: e.message })); [mail, sich] = await Promise.all([get('/einstellungen/email').catch((e) => ({ fehler: e.message })), get('/einstellungen/sicherheit').catch((e) => ({ fehler: e.message }))]); };
  await lade();
  function zeichne() {
    const m = mail || {}; const pflicht = (sich && sich.zweiFaktorPflicht) || {}; const k = ki || {};
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
      <section class="card" id="ki-karte" aria-labelledby="h-ki"><div class="card-h pad-h"><h3 id="h-ki">${ic('spark')}KI-Unterstützung (optional)</h3><span class="chip ${k.aktiv ? 'st-green' : 'st-grey'}" data-ki-zustand="${k.aktiv ? 'aktiv' : 'aus'}">${k.aktiv ? 'Aktiv' : 'Ausgeschaltet'}</span></div>
        ${k.fehler ? `<p class="pad-s form-err">${esc(k.fehler)}</p>` : `
        <form id="ki-form" class="pad stack-s" autocomplete="off" novalidate>
          <p class="muted sm">Ohne KI arbeiten Diktat, Lieferschein und Papierbericht mit festen Regeln und Texterkennung am eigenen Server. Mit KI werden Sätze und Handschrift besser verstanden. ${esc(k.hinweis || '')}</p>
          <label class="field"><span class="field-label">API-Schlüssel (Anthropic)${k.schluesselGesetzt ? ' – gespeichert, wird nie wieder angezeigt' : ''}</span><input class="input lg" type="password" name="apiKey" autocomplete="new-password" placeholder="${k.schluesselGesetzt ? '•••••••• (leer lassen = unverändert)' : 'sk-ant-…'}" maxlength="300"></label>
          ${k.schluesselGesetzt ? '<label class="check-inline"><input type="checkbox" name="loeschen"> Gespeicherten Schlüssel löschen</label>' : ''}
          <label class="field w-s"><span class="field-label">Höchstens Aufrufe pro Tag</span><input class="input lg num" name="tagesLimit" inputmode="numeric" value="${esc(k.tagesLimit ?? 200)}"></label>
          <div class="banner info" role="note">${ic('info')}<span><b>Datenverarbeitung:</b> Ist die KI aktiv, werden diktierte Texte und Fotos von Lieferscheinen bzw. Papierberichten zur Verarbeitung an den Anbieter (Anthropic) übermittelt. Aus der Datenbank werden keine Preise, Löhne oder Kalkulationsdaten gesendet. Die Fotos gehen vollständig (ohne Standort- und Kameradaten) an die KI – was auf dem Papier steht, auch Preise auf einem Lieferschein, wird mit übermittelt. Das Ergebnis ist immer nur ein Vorschlag.</span></div>
          <label class="check-inline"><input type="checkbox" name="datenschutzBestaetigt" ${k.datenschutzBestaetigt ? 'checked' : ''}> Ich habe das gelesen und bin mit der Übermittlung einverstanden.${k.bestaetigtAm ? ` <small class="muted">(bestätigt am ${esc(String(k.bestaetigtAm).slice(0, 10).split('-').reverse().join('.'))})</small>` : ''}</label>
          <label class="switch-row flat"><span><b>KI verwenden</b><small>Nur mit Schlüssel und Einverständnis möglich.</small></span><input type="checkbox" class="vh" name="aktiv" ${k.aktiv ? 'checked' : ''}><span class="switch" aria-hidden="true"></span></label>
          <p class="muted sm" id="ki-heute">Heute: ${esc((k.heute && k.heute.aufrufe) ?? 0)} von ${esc(k.tagesLimit ?? 200)} Aufrufen${k.modell ? ` · Modell ${esc(k.modell)}` : ''}</p>
          <p class="form-err" role="alert" hidden></p>
          <div class="btn-zeile"><button type="submit" class="btn primary" id="ki-ok">${ic('check')}KI-Einstellungen speichern</button><button type="button" class="btn ghost" id="ki-test" ${k.schluesselGesetzt ? '' : 'disabled'}>Verbindung testen</button></div>
          <p id="ki-test-erg" role="status" hidden></p>
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
    } else if (e.target.id === 'ki-form') {
      const err = $('.form-err', e.target); const limit = Number(f.get('tagesLimit'));
      if (!(limit >= 1 && limit <= 5000)) { err.hidden = false; err.textContent = 'Bitte ein Tageslimit zwischen 1 und 5.000 eintragen.'; return; }
      const body = { tagesLimit: Math.round(limit), datenschutzBestaetigt: f.get('datenschutzBestaetigt') === 'on', aktiv: f.get('aktiv') === 'on' };
      if (f.get('loeschen') === 'on') { body.apiKey = ''; body.aktiv = false; } else if (String(f.get('apiKey') || '').trim()) body.apiKey = String(f.get('apiKey')).trim();
      if (body.aktiv && !body.datenschutzBestaetigt) { err.hidden = false; err.textContent = 'Bitte zuerst das Einverständnis zur Datenverarbeitung bestätigen.'; return; }
      if (body.aktiv && !(ki && ki.schluesselGesetzt) && !body.apiKey) { err.hidden = false; err.textContent = 'Bitte zuerst den API-Schlüssel eintragen.'; return; }
      try { ki = await put('/einstellungen/ki', body); toast(ki.aktiv ? 'KI-Unterstützung ist aktiv.' : 'KI-Einstellungen gespeichert.'); zeichne(); } catch (x) { err.hidden = false; err.textContent = x.message; }
    } else if (e.target.id === 'mail-test') {
      const erg = $('#mail-test-erg', box); const b = $('#mail-test-ok', box);
      if (!String(f.get('an')).includes('@')) { erg.hidden = false; erg.className = 'full form-err'; erg.textContent = 'Bitte eine E-Mail-Adresse eintragen.'; return; }
      b.disabled = true; erg.hidden = false; erg.className = 'full muted sm'; erg.textContent = 'Test-Mail wird gesendet …';
      try { await post('/einstellungen/email/test', { an: String(f.get('an')).trim() }); erg.className = 'full banner ok'; erg.dataset.ergebnis = 'ok'; erg.textContent = `Test-Mail an ${f.get('an')} wurde vom Server angenommen.`; }
      catch (x) { erg.className = 'full banner err'; erg.dataset.ergebnis = 'fehler'; erg.textContent = `Versand fehlgeschlagen: ${x.message}`; }
      b.disabled = false;
    }
  });
  box.addEventListener('click', async (e) => {
    if (!e.target.closest('#ki-test')) return;
    const erg = $('#ki-test-erg', box); const b = $('#ki-test', box); b.disabled = true; erg.hidden = false; erg.className = 'muted sm'; erg.textContent = 'Verbindung wird geprüft …';
    try { const r = await post('/einstellungen/ki/test'); erg.className = 'banner ok'; erg.dataset.ergebnis = 'ok'; erg.textContent = (r && r.text) || 'Die Verbindung zum KI-Anbieter funktioniert.'; }
    catch (x) { erg.className = 'banner err'; erg.dataset.ergebnis = 'fehler'; erg.textContent = `Test fehlgeschlagen: ${x.message}`; }
    b.disabled = false;
  });
  box.addEventListener('change', async (e) => {
    const t = e.target.closest('[data-pflicht]'); if (!t) return;
    const neu = { ...((sich && sich.zweiFaktorPflicht) || {}), [t.dataset.pflicht]: t.checked };
    try { sich = await put('/einstellungen/sicherheit', { zweiFaktorPflicht: neu }); toast(`Zwei-Faktor-Pflicht für ${rolleText(t.dataset.pflicht)} ${t.checked ? 'eingeschaltet' : 'ausgeschaltet'}.`); }
    catch (x) { t.checked = !t.checked; toast(x.message, 'warn'); }
  });
}
