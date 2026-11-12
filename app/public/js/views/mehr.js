// Mehr: Konto, alle Bereiche, Einstellungen, Zusatzdienste (ehrlich: noch nicht angebunden), Abmelden.
import { get } from '../api.js';
import { ic, esc, avatar, rolleText, speicher, toast, bestaetigen, $ } from '../ui.js';
import { syncStatus, nachsenden } from '../offline.js';

const INTEG_ICON = { diktat: 'mic', scan_lieferschein: 'scan', scan_papier: 'camera', sms: 'sms', push: 'bell', email: 'mail', wetter: 'cloud' };

export const integKarte = (integ) => `
  <section class="card" aria-labelledby="integ-h">
    <div class="card-h pad-h"><h3 id="integ-h">${ic('plug')}Zusatzdienste</h3><span class="chip st-grey">Noch nicht angebunden</span></div>
    ${integ.length ? `<ul class="integ-list">${integ.map((i) => `<li class="${i.angebunden ? 'on' : ''}" data-integ="${esc(i.schluessel)}"><span class="integ-ic">${ic(INTEG_ICON[i.schluessel] || 'plug')}</span><span><b>${esc(i.name)}</b><small>${esc(i.hinweis || '')}</small></span><span class="chip xs ${i.angebunden ? 'st-green' : 'st-grey'}">${i.angebunden ? 'Angebunden' : 'Noch nicht angebunden'}</span></li>`).join('')}</ul>`
      : '<div class="state empty small"><p>Liste der Zusatzdienste derzeit nicht abrufbar.</p></div>'}
    <p class="card-note">Diese Funktionen brauchen einen externen Anbieter. Solange kein Vertrag besteht, bleiben sie ausgeschaltet – es werden keine Ergebnisse vorgetäuscht.</p>
  </section>`;

export default async function mehr(el, ctx) {
  const u = ctx.ich.benutzer;
  const [integ, gesund] = await Promise.all([ctx.integrationen(), get('/gesundheit').catch(() => null)]);
  const s = syncStatus();
  const standort = speicher.lies('bt_standort', false);
  el.innerHTML = `
  <div class="page narrow wide-md">
    <section class="card pad profile">${avatar(u.name, 'xl')}<div><h2>${esc(u.name)}</h2><p>${esc(rolleText(u.rolle))}${u.lohngruppe ? ' · ' + esc(u.lohngruppe) : ''}</p></div></section>
    <nav class="card menu-list" aria-label="Alle Bereiche">
      ${ctx.navErlaubt().map((n) => `<a href="#${n.pfad}">${ic(n.icon)}<span>${esc(n.text)}</span>${ic('right')}</a>`).join('')}
    </nav>
    <section class="card" aria-labelledby="einst-h">
      <div class="card-h pad-h"><h3 id="einst-h">Einstellungen</h3></div>
      <label class="switch-row"><span><b>Standort beim Stempeln mitsenden</b><small>Nur im Moment des Stempelns, keine laufende Ortung. Das Gerät fragt beim ersten Mal um Erlaubnis.</small></span>
        <input type="checkbox" class="vh" id="opt-standort" ${standort ? 'checked' : ''} ${navigator.geolocation ? '' : 'disabled'}><span class="switch" aria-hidden="true"></span></label>
      <div class="switch-row"><span><b>Offline-Buchungen</b><small id="sync-info">${s.ausstehend ? `${s.ausstehend} Stempelung${s.ausstehend > 1 ? 'en' : ''} warten auf Verbindung.` : 'Alles gesendet.'}</small></span>
        <button type="button" class="btn ghost sm" id="sync-jetzt" ${s.ausstehend ? '' : 'disabled'}>${ic('sync')}Jetzt senden</button></div>
    </section>
    ${integKarte(integ)}
    <button type="button" class="btn ghost lg block" id="abmelden">${ic('logout')}Abmelden</button>
    <p class="fineprint">BauTag${gesund && gesund.version ? ' · Version ' + esc(gesund.version) : ''}</p>
  </div>`;
  $('#opt-standort', el).addEventListener('change', (e) => {
    speicher.setz('bt_standort', e.target.checked);
    toast(e.target.checked ? 'Standort wird ab jetzt beim Stempeln mitgesendet.' : 'Standort wird nicht mehr erfasst.');
  });
  $('#sync-jetzt', el).addEventListener('click', async () => { await nachsenden(); if (ctx.aktuell()) ctx.neuLaden(); });
  $('#abmelden', el).addEventListener('click', async () => {
    const offen = syncStatus().ausstehend;
    if (offen && !(await bestaetigen('Abmelden?', `${offen} Stempelung${offen > 1 ? 'en sind' : ' ist'} noch nicht gesendet. Sie bleiben am Gerät gespeichert und werden nach der nächsten Anmeldung gesendet.`, 'Abmelden'))) return;
    ctx.abmelden();
  });
}
