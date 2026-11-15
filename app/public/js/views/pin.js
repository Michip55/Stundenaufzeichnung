// PIN ändern (Prüfbericht B-03): freiwillig über „Mehr“ oder erzwungen nach der ersten Anmeldung / PIN-Reset.
import { post } from '../api.js';
import { ic, esc, MARK, banner, toast, rolleText, $ } from '../ui.js';

export const pinMin = (rolle) => (['bauleiter', 'buero', 'gf'].includes(rolle) ? 6 : 4);
// Gleiche Regeln wie am Server: nur Ziffern, Mindestlänge je Rolle, keine einfachen Folgen
export function pinFehler(pin, rolle) {
  const min = pinMin(rolle);
  if (!/^\d*$/.test(pin)) return 'Die PIN darf nur aus Ziffern bestehen.';
  if (pin.length < min) return `Die PIN braucht mindestens ${min} Ziffern.`;
  if (pin.length > 12) return 'Die PIN darf höchstens 12 Ziffern haben.';
  if (/^(\d)\1+$/.test(pin)) return 'Bitte nicht lauter gleiche Ziffern verwenden.';
  const d = [...pin].map(Number);
  const folge = (s) => d.every((x, i) => i === 0 || x === (d[i - 1] + s + 10) % 10);
  if (folge(1) || folge(-1)) return 'Bitte keine Zahlenfolge wie 1234 oder 654321 verwenden.';
  return '';
}

function formular(ich, erzwungen) {
  const min = pinMin(ich.benutzer.rolle);
  return `
    <form id="pinform" class="stack-s" autocomplete="off" novalidate>
      ${erzwungen ? banner('info', '<b>Bitte zuerst eine eigene PIN festlegen.</b> Die Start-PIN ist nur für die erste Anmeldung gedacht – danach kennt nur mehr du deine PIN.', 'lock') : ''}
      <label class="field"><span class="field-label">Bisherige PIN</span><input class="input lg" type="password" name="alt" inputmode="numeric" pattern="[0-9]*" maxlength="12" autocomplete="current-password" required></label>
      <label class="field"><span class="field-label">Neue PIN (mindestens ${min} Ziffern)</span><input class="input lg" type="password" name="neu" inputmode="numeric" pattern="[0-9]*" maxlength="12" autocomplete="new-password" required aria-describedby="pin-regel"></label>
      <label class="field"><span class="field-label">Neue PIN wiederholen</span><input class="input lg" type="password" name="neu2" inputmode="numeric" pattern="[0-9]*" maxlength="12" autocomplete="new-password" required></label>
      <p class="muted sm" id="pin-regel">${min} bis 12 Ziffern, keine Folgen wie 1234 und nicht lauter gleiche Ziffern.${min > 4 ? ` Für ${esc(rolleText(ich.benutzer.rolle))} gilt die längere PIN, weil Preise und Lohndaten sichtbar sind.` : ''}</p>
      <p class="form-err" id="pin-err" role="alert" hidden></p>
      <button type="submit" class="btn primary lg block" id="pin-ok">${ic('check')}PIN ändern</button>
    </form>`;
}
function binde(el, ich, fertig) {
  const form = $('#pinform', el), err = $('#pin-err', el);
  const zeig = (t) => { err.hidden = !t; err.textContent = t || ''; };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const alt = form.elements.alt.value, neu = form.elements.neu.value, neu2 = form.elements.neu2.value;
    if (!alt) { zeig('Bitte die bisherige PIN eingeben.'); form.elements.alt.focus(); return; }
    const f = pinFehler(neu, ich.benutzer.rolle);
    if (f) { zeig(f); form.elements.neu.focus(); return; }
    if (neu !== neu2) { zeig('Die beiden neuen PINs stimmen nicht überein.'); form.elements.neu2.focus(); return; }
    if (neu === alt) { zeig('Die neue PIN muss sich von der bisherigen unterscheiden.'); form.elements.neu.focus(); return; }
    zeig(''); $('#pin-ok', el).disabled = true;
    try {
      await post('/auth/pin', { alt, neu });
      toast('PIN geändert.');
      await fertig();
    } catch (x) {
      $('#pin-ok', el).disabled = false;
      zeig(x.netz ? 'Keine Verbindung zum Server.' : x.status === 401 ? (x.message || 'Die bisherige PIN stimmt nicht.') : x.message);
    }
  });
}

// Erzwungen: ganzer Bildschirm ohne Navigation – erst nach der Änderung geht es weiter
export function pinErzwungen(root, ich, { fertig, abmelden }) {
  root.innerHTML = `
  <div class="login"><main class="login-panel solo">
    <div class="login-mobile-brand always">${MARK}<span><b>BauTag</b><small>Baustellen-Plattform</small></span></div>
    <div class="login-card" id="pin-pflicht" data-zustand="pin-aendern">
      <div class="login-head"><h2>Neue PIN festlegen</h2><p>${esc(ich.benutzer.name)}</p></div>
      ${formular(ich, true)}
      <button type="button" class="link-back" id="pin-abmelden">${ic('logout')}Abmelden</button>
    </div>
  </main></div>`;
  binde(root, ich, fertig);
  $('#pin-abmelden', root).addEventListener('click', abmelden);
}

// Freiwillig (Route #/pin)
export default async function pin(el, ctx) {
  el.innerHTML = `<div class="page narrow"><a class="link-back" href="#/mehr">${ic('left')}Zurück</a><section class="card pad">${formular(ctx.ich, false)}</section></div>`;
  binde(el, ctx.ich, async () => { location.hash = '#/mehr'; });
}
