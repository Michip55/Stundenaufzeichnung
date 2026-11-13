// Mehr: Konto, alle Bereiche, Einstellungen, Zusatzdienste (ehrlich: noch nicht angebunden), Abmelden.
import { get, put } from '../api.js';
import { ic, esc, avatar, rolleText, speicher, toast, bestaetigen, integAktiv, integZustand, $ } from '../ui.js';
import { syncStatus, nachsenden } from '../offline.js';
import { installKarte, bindeInstall } from './hilfe.js';
import { schadenMelden } from './schaeden.js';
import { fuhrenWartend } from './fuhren.js';

const INTEG_ICON = { diktat: 'mic', lieferschein: 'scan', papier: 'camera', sms: 'sms', push: 'bell', email: 'mail', wetter: 'cloud', fernunterschrift: 'sign', ki: 'spark', scan_lieferschein: 'scan', scan_papier: 'camera' };
// Wohin „Einrichten“ führt – je nach Dienst und Recht
const einrichten = (i, ctx) => {
  if (i.schluessel === 'push') return ['#/push', 'Einschalten'];
  if (ctx && ctx.kann('benutzer') && ['email', 'ki'].includes(i.schluessel) && !/^aktiv/.test(i.zustand || (i.angebunden ? 'aktiv' : ''))) return ['#/benutzer?reiter=dienste', 'Einrichten'];
  return null;
};
export const integKarte = (integ, ctx) => `
  <section class="card" id="zusatzdienste" aria-labelledby="integ-h">
    <div class="card-h pad-h"><h3 id="integ-h">${ic('plug')}Zusatzdienste</h3><span class="chip ${integ.some((i) => integAktiv(integ, i.schluessel)) ? 'st-green' : 'st-grey'}">${integ.filter((i) => integAktiv(integ, i.schluessel)).length} von ${integ.length} aktiv</span></div>
    ${integ.length ? `<ul class="integ-list">${integ.map((i) => { const [t, c] = integZustand(i); const e = einrichten(i, ctx); return `<li class="${integAktiv(integ, i.schluessel) ? 'on' : ''}" data-integ="${esc(i.schluessel)}" data-zustand="${esc(i.zustand || (i.angebunden ? 'aktiv' : 'fehlt'))}"><span class="integ-ic">${ic(INTEG_ICON[i.schluessel] || 'plug')}</span><span><b>${esc(i.name)}</b><small>${esc(i.hinweis || '')}</small></span><span class="integ-zustand"><span class="chip xs ${c}">${esc(t)}</span>${e ? `<a class="link sm" href="${e[0]}" data-einrichten>${e[1]}</a>` : ''}</span></li>`; }).join('')}</ul>`
      : '<div class="state empty small"><p>Liste der Zusatzdienste derzeit nicht abrufbar.</p></div>'}
    <p class="card-note">„Aktiv – ohne KI“ heißt: Die Funktion arbeitet mit festen Regeln bzw. Texterkennung am eigenen Server. Die KI-Unterstützung ist freiwillig und wird von der Geschäftsführung eingerichtet. Es werden nie Ergebnisse vorgetäuscht.</p>
  </section>`;

export default async function mehr(el, ctx) {
  const u = ctx.ich.benutzer;
  const [integ, gesund] = await Promise.all([ctx.integrationen(), get('/gesundheit').catch(() => null)]);
  const s = syncStatus();
  const standort = speicher.lies('bt_standort', false);
  el.innerHTML = `
  <div class="page narrow wide-md">
    <section class="card pad profile">${avatar(u.name, 'xl')}<div><h2>${esc(u.name)}</h2><p>${esc(rolleText(u.rolle))}${u.lohngruppe ? ' · ' + esc(u.lohngruppe) : ''}</p></div></section>
    <form class="card pad stack-s" id="telefon-form" novalidate><label class="field"><span class="field-label">Mein Telefon (dienstlich)</span><input class="input lg" name="telefon" type="tel" inputmode="tel" maxlength="30" value="${esc(u.telefon || '')}" placeholder="+43 664 …"></label><small class="muted">Sieht das Büro – und beim Polier die eigene Partie für „Polier anrufen“.</small><button type="submit" class="btn ghost" id="telefon-ok">Telefon speichern</button></form>
    <button type="button" class="punch out sch-melden" id="mehr-schaden"><span class="punch-ic">${ic('camera')}</span><span><b>Schaden melden</b><small>Defekt oder Unfall an Fahrzeug oder Gerät – mit Fotos</small></span></button>
    <nav class="card menu-list" aria-label="Alle Bereiche">
      ${ctx.navErlaubt().map((n) => `<a href="#${n.pfad}">${ic(n.icon)}<span>${esc(n.text)}</span>${ic('right')}</a>`).join('')}
    </nav>
    <section class="card" aria-labelledby="einst-h">
      <div class="card-h pad-h"><h3 id="einst-h">Einstellungen</h3></div>
      <label class="switch-row"><span><b>Standort beim Stempeln mitsenden</b><small>Nur im Moment des Stempelns, keine laufende Ortung. Das Gerät fragt beim ersten Mal um Erlaubnis.</small></span>
        <input type="checkbox" class="vh" id="opt-standort" ${standort ? 'checked' : ''} ${navigator.geolocation ? '' : 'disabled'}><span class="switch" aria-hidden="true"></span></label>
      <a class="switch-row link" href="#/push" id="push-link"><span><b>Push-Benachrichtigungen</b><small>Auf diesem Gerät einschalten, Kategorien wählen, Test senden.</small></span>${ic('right')}</a>
      ${['bauleiter', 'buero', 'gf'].includes(u.rolle) ? `<a class="switch-row link" href="#/zwei-faktor" id="zf-link"><span><b>Zwei-Faktor-Anmeldung</b><small>${ctx.ich.zweiFaktor && ctx.ich.zweiFaktor.aktiv ? 'Eingeschaltet – Code aus der Authenticator-App bei jeder Anmeldung.' : 'Zusätzlicher Schutz für Preise und Lohndaten: PIN plus Code vom Handy.'}</small></span>${ctx.ich.zweiFaktor && ctx.ich.zweiFaktor.aktiv ? '<span class="chip xs st-green">an</span>' : ''}${ic('right')}</a>` : ''}
      <a class="switch-row link" href="#/pin" id="pin-link"><span><b>PIN ändern</b><small>Eigene PIN neu festlegen. Niemand sonst kennt sie.</small></span>${ic('right')}</a>
      <div class="switch-row"><span><b>Offline-Buchungen</b><small id="sync-info">${s.ausstehend ? `${s.ausstehend} Stempelung${s.ausstehend > 1 ? 'en' : ''} warten auf Verbindung.` : 'Alles gesendet.'}</small></span>
        <button type="button" class="btn ghost sm" id="sync-jetzt" ${s.ausstehend ? '' : 'disabled'}>${ic('sync')}Jetzt senden</button></div>
    </section>
    <nav class="card menu-list" aria-label="Hilfe"><a href="#/hilfe" id="zu-hilfe">${ic('info')}<span>Hilfe &amp; erste Schritte</span>${ic('right')}</a></nav>
    ${installKarte()}
    ${integKarte(integ, ctx)}
    <button type="button" class="btn ghost lg block" id="abmelden">${ic('logout')}Abmelden</button>
    <p class="fineprint">BauTag${gesund && gesund.version ? ' · Version ' + esc(gesund.version) : ''}</p>
  </div>`;
  $('#opt-standort', el).addEventListener('change', (e) => {
    speicher.setz('bt_standort', e.target.checked);
    toast(e.target.checked ? 'Standort wird ab jetzt beim Stempeln mitgesendet.' : 'Standort wird nicht mehr erfasst.');
  });
  $('#mehr-schaden', el).addEventListener('click', () => schadenMelden(ctx));
  $('#telefon-form', el).addEventListener('submit', async (e) => {
    e.preventDefault(); const t = String(new FormData(e.target).get('telefon') || '').trim();
    if (t && !/^[+\d][\d ]{3,29}$/.test(t)) { toast('Bitte nur Ziffern, Leerzeichen und ein + am Anfang – z. B. +43 664 1234567.', 'warn'); return; }
    try { await put('/auth/telefon', { telefon: t }); u.telefon = t; toast(t ? 'Telefon gespeichert.' : 'Telefon entfernt.'); } catch (x) { toast(x.message, 'warn'); }
  });
  $('#sync-jetzt', el).addEventListener('click', async () => { await nachsenden(); if (ctx.aktuell()) ctx.neuLaden(); });
  bindeInstall(el, () => { if (ctx.aktuell()) ctx.neuLaden(); });
  $('#abmelden', el).addEventListener('click', async () => {
    const offen = syncStatus().ausstehend + fuhrenWartend(u.id).length;
    if (offen && !(await bestaetigen('Abmelden?', `${offen} Meldung${offen > 1 ? 'en (Stempelungen, Fuhren) sind' : ' ist'} noch nicht gesendet. Sie bleiben am Gerät gespeichert und werden nach Ihrer nächsten Anmeldung gesendet – alles andere wird vom Gerät gelöscht.`, 'Abmelden'))) return;
    ctx.abmelden();
  });
}
