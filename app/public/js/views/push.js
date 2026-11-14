// Push-Benachrichtigungen (API.md 12.3): auf diesem Gerät einschalten, Kategorien wählen, Test senden, Geräte verwalten.
import { get, post, put, del, api } from '../api.js';
import { ic, esc, fmt, banner, toast, bestaetigen, $ } from '../ui.js';
import { installStatus } from '../installieren.js';

const TYP = {
  plan: ['Einsatzplan', 'Wo und wann ich morgen eingeteilt bin'], abwesenheit: ['Urlaub & Abwesenheiten', 'Anträge und Entscheidungen'], azg: ['Arbeitszeit-Hinweise', 'z. B. Ausstempeln vergessen'],
  bericht: ['Bautagesberichte', 'Berichte zur Freigabe'], budget: ['Budget', 'Schwellen der Nachkalkulation – ohne Beträge am Sperrbildschirm'], fuhrpark: ['Fuhrpark & Fristen', 'Service, §57a, Prüfungen'],
  schaden: ['Schäden & Mängel', 'Neue Meldungen zu Geräten'], sicherheit: ['Sicherheit', 'Kontosperren, Anmeldung'], email: ['E-Mail-Versand', 'Fehler beim Versand'],
};
const b64url = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };
export const pushMoeglich = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
/** 15.5 (F-014): Push-Abo dieses Geräts (oder null) – ohne auf einen Service Worker zu warten, der nie kommt */
export async function geraetPushAbo() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    const reg = await Promise.race([navigator.serviceWorker.getRegistration(), new Promise((ok) => setTimeout(() => ok(null), 1500))]);
    return reg && reg.pushManager ? (await reg.pushManager.getSubscription()) || null : null;
  } catch (e) { return null; }
}
const geraetName = () => { const ua = navigator.userAgent; return `${/iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android-Gerät' : /Windows/.test(ua) ? 'Windows-PC' : /Mac/.test(ua) ? 'Mac' : 'Gerät'} · ${/Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'}`; };

export default async function push(el, ctx) {
  const integ = await ctx.integrationen();
  const angebunden = !!(integ.find((i) => i.schluessel === 'push') || {}).angebunden;
  let abos = [], einst = { typen: {} }, hier = null, fehler = '';
  async function lade() {
    fehler = '';
    try { [abos, einst] = await Promise.all([get('/push/abos'), get('/push/einstellungen')]); }
    catch (e) { if (e.status === 401) throw e; fehler = e.message; abos = []; einst = { typen: {} }; }
    hier = null;
    if (pushMoeglich()) { try { const reg = await navigator.serviceWorker.ready; hier = await reg.pushManager.getSubscription(); } catch (e) { hier = null; } }
  }
  await lade();

  function zeichne() {
    const erlaubnis = pushMoeglich() ? Notification.permission : 'nicht-moeglich';
    const s = installStatus();
    const an = !!hier && erlaubnis === 'granted';
    el.innerHTML = `
    <div class="page narrow wide-md" id="push">
      <a class="link-back" href="#/mehr">${ic('left')}Zurück</a>
      ${!angebunden ? banner('warn', 'Push ist am Server noch nicht eingerichtet. Benachrichtigungen erscheinen weiterhin in der App (Glocke).') : ''}
      ${fehler ? banner('err', esc(fehler)) : ''}
      <section class="card" aria-labelledby="h-pg"><div class="card-h pad-h"><h3 id="h-pg">${ic('bell')}Auf diesem Gerät</h3><span class="chip ${an ? 'st-green' : 'st-grey'}" data-push-zustand="${an ? 'an' : erlaubnis === 'denied' ? 'gesperrt' : 'aus'}">${an ? 'Eingeschaltet' : erlaubnis === 'denied' ? 'Im Browser gesperrt' : 'Ausgeschaltet'}</span></div>
        <div class="pad-s stack-s">
          ${!pushMoeglich() ? `<p>Dieser Browser kann keine Push-Benachrichtigungen empfangen.${s.ios && !s.installiert ? ' Am iPhone/iPad funktioniert Push erst, wenn BauTag am Home-Bildschirm installiert ist – siehe <a class="link" href="#/hilfe">Hilfe</a>.' : ''}</p>`
            : erlaubnis === 'denied' ? '<p>Benachrichtigungen sind für BauTag im Browser gesperrt. Bitte in den Website-Einstellungen des Browsers (Schloss-Symbol neben der Adresse) „Benachrichtigungen“ erlauben und die Seite neu laden.</p>'
            : an ? `<p class="muted sm">Dieses Gerät erhält Benachrichtigungen auch, wenn BauTag geschlossen ist. Am Sperrbildschirm stehen nie Beträge.</p><div class="btn-zeile"><button type="button" class="btn ghost" id="push-test" ${angebunden ? '' : 'disabled'}>${ic('bell')}Test senden</button><button type="button" class="btn ghost" id="push-aus">Auf diesem Gerät ausschalten</button></div>`
            : `<p>Mit Push erfahren Sie z. B. Ihren Einsatz für morgen, auch wenn BauTag geschlossen ist. Der Browser fragt einmal um Erlaubnis.</p><button type="button" class="btn primary lg" id="push-an" ${angebunden ? '' : 'disabled'}>${ic('bell')}Auf diesem Gerät einschalten</button>${s.ios && !s.installiert ? '<p class="muted sm">iPhone/iPad: zuerst BauTag am Home-Bildschirm installieren.</p>' : ''}`}
        </div></section>
      <section class="card" aria-labelledby="h-pt"><div class="card-h pad-h"><h3 id="h-pt">Wovon möchte ich hören?</h3></div>
        ${Object.keys(einst.typen || {}).length ? Object.entries(einst.typen).map(([k, v]) => `<label class="switch-row"><span><b>${esc((TYP[k] || [k])[0])}</b><small>${esc((TYP[k] || ['', ''])[1])}</small></span><input type="checkbox" class="vh" data-typ="${esc(k)}" ${v ? 'checked' : ''}><span class="switch" aria-hidden="true"></span></label>`).join('') : '<p class="pad-s muted sm">Keine Kategorien verfügbar.</p>'}
        <p class="card-note">Gilt für alle Ihre Geräte. In der App (Glocke) erscheint weiterhin alles.</p></section>
      <section class="card" aria-labelledby="h-pa"><div class="card-h pad-h"><h3 id="h-pa">Meine Geräte <span class="count">${abos.length}</span></h3></div>
        ${abos.length ? `<ul class="plain rows" id="push-geraete">${abos.map((a) => `<li data-abo="${a.id}"><span class="grow"><b>${esc(a.geraet || 'Gerät')}</b><small>seit ${esc(fmt.zeitpunkt(a.erstellt))}${a.zuletzt ? ' · zuletzt ' + esc(fmt.zeitpunkt(a.zuletzt)) : ''}${a.fehler ? ' · Zustellung zuletzt fehlgeschlagen' : ''}</small></span><button type="button" class="btn ghost sm" data-abo-weg="${a.id}">Entfernen</button></li>`).join('')}</ul>` : '<p class="pad-s muted sm">Noch kein Gerät angemeldet.</p>'}</section>
    </div>`;
  }
  const neu = async () => { await lade(); if (ctx.aktuell()) zeichne(); };

  async function einschalten() {
    const b = $('#push-an', el); b.disabled = true;
    try {
      const erlaubt = await Notification.requestPermission();
      if (erlaubt !== 'granted') { toast(erlaubt === 'denied' ? 'Benachrichtigungen wurden im Browser abgelehnt.' : 'Ohne Erlaubnis des Browsers geht es nicht.', 'warn'); return neu(); }
      const { publicKey } = await get('/push/schluessel');
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64url(publicKey) }));
      const j = sub.toJSON();
      await post('/push/abo', { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth }, geraet: geraetName() });
      toast('Push ist auf diesem Gerät eingeschaltet.');
    } catch (e) { toast(e.status ? e.message : 'Push konnte auf diesem Gerät nicht eingeschaltet werden. Bitte später erneut versuchen.', 'warn'); }
    neu();
  }
  el.addEventListener('click', async (e) => {
    if (e.target.closest('#push-an')) return einschalten();
    if (e.target.closest('#push-aus')) {
      try { const ep = hier && hier.endpoint; if (hier) await hier.unsubscribe(); if (ep) await api('DELETE', '/push/abo', { endpoint: ep }); toast('Push ist auf diesem Gerät ausgeschaltet.'); } catch (x) { toast(x.message || 'Ausschalten nicht möglich.', 'warn'); }
      return neu();
    }
    if (e.target.closest('#push-test')) {
      try { const r = await post('/push/test'); toast(r.gesendet ? `Test gesendet an ${r.gesendet} Gerät${r.gesendet > 1 ? 'e' : ''}${r.fehler ? ` (${r.fehler} fehlgeschlagen)` : ''}.` : 'Kein Gerät erreichbar – bitte Push neu einschalten.', r.gesendet ? 'ok' : 'warn'); } catch (x) { toast(x.message, 'warn'); }
      return;
    }
    const w = e.target.closest('[data-abo-weg]');
    if (w && await bestaetigen('Gerät entfernen?', 'Dieses Gerät erhält dann keine Push-Benachrichtigungen mehr.', 'Entfernen', 'danger')) { try { await del(`/push/abos/${w.dataset.aboWeg}`); toast('Gerät entfernt.'); } catch (x) { toast(x.message, 'warn'); } neu(); }
  });
  el.addEventListener('change', async (e) => {
    const t = e.target.closest('[data-typ]'); if (!t) return;
    try { einst = await put('/push/einstellungen', { typen: { ...einst.typen, [t.dataset.typ]: t.checked } }); toast('Gespeichert.'); } catch (x) { t.checked = !t.checked; toast(x.message, 'warn'); }
  });
  zeichne();
}
