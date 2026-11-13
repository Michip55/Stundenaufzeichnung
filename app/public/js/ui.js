// BauTag – gemeinsame Bausteine der Oberfläche: Icons, Formatierung (de-AT), Dialoge, Zustände.
import { parseZahl, starkGeaendert } from './zahl.js';

const IC = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18.5 14.9c1.7.8 2.7 2.5 3 5.1"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="8" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.5"/><rect x="3.5" y="14.5" width="7" height="6" rx="1.5"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  tag: '<path d="M3.5 12.5V4.5h8l9 9-8 8z"/><circle cx="8" cy="9" r="1.5"/>',
  chart: '<path d="M4 20V4M4 20h16"/><rect x="7.5" y="11" width="3" height="6" rx=".5"/><rect x="12.5" y="7" width="3" height="10" rx=".5"/><rect x="17.5" y="13" width="2.5" height="4" rx=".5"/>',
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9 9.5v10M15 9.5v10"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  down: '<path d="M5 9l7 7 7-7"/>',
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/>',
  wifiOff: '<path d="M3 3l18 18M5.5 12.5a9.5 9.5 0 0 1 4-2.3M2.5 9a14 14 0 0 1 4.3-2.8M10.5 5.1A14 14 0 0 1 21.5 9M14.5 10.400a9.5 9.5 0 0 1 4 2.1M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/>',
  sync: '<path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9"/><path d="M18.500 3v4.300h-4.300M5.500 21v-4.300h4.300"/>',
  pause: '<rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  swap: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
  logout: '<path d="M10 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H10M15 8l4 4-4 4M19 12H9"/>',
  camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.5-2.5h5L16 7h2.500A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
  pen: '<path d="M4 20l1-4.5L16.5 4 20 7.500 8.5 19z"/><path d="M14 6.5l3.5 3.5"/>',
  download: '<path d="M12 4v11M7.5 11l4.5 4.5 4.5-4.5M4.5 19.5h15"/>',
  alert: '<path d="M12 4l9.5 16h-19z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  truck: '<path d="M2.5 6.5h11v10h-11zM13.5 10h4l3 3.5v3h-7z"/><circle cx="7" cy="17.5" r="2"/><circle cx="17" cy="17.5" r="2"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  file: '<path d="M6.5 3.5h7L18 8v12.5H6.5z"/><path d="M13.5 3.5V8H18M9 13h6M9 16.5h6"/>',
  edit: '<path d="M4 20h4l11-11-4-4L4 16z"/>',
  cloud: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-8.960A6 6 0 0 1 18 11a3.8 3.8 0 0 1-.5 7.5z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.2 4-6.5 8-6.5s7.2 2.3 8 6.5"/>',
  euro: '<path d="M18 6.5A7 7 0 1 0 18 17.5M4 10.5h9M4 13.5h9"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.5-3 8-7.5 9.5-4.5-1.5-7.5-5-7.5-9.5V6z"/><path d="M9 12l2.2 2.2L15.2 10"/>',
  back: '<path d="M10 6l-6 6 6 6M4 12h16"/>',
  more: '<circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/>',
  sign: '<path d="M3 17c2.5-6 4.5-9.5 6-9.5 2.5 0-1.5 9 1 9 1.8 0 2.5-4 4-4 1.3 0 .7 3 2.3 3 1 0 1.9-1 4.2-1M3 20.5h18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  helmet: '<path d="M3.5 17.5h17M5 17.5v-2a7 7 0 0 1 14 0v2M10 8.8V6h4v2.800"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/>',
  sms: '<path d="M4 5.5h16v11H9l-5 4z"/><path d="M8 10h8M8 13h5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.500"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>',
  scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.500A1.5 1.5 0 0 1 20 5.5V8M20 16v2.500a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M4 12h16"/>',
  away: '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M9.5 13.5l5 5M14.5 13.5l-5 5"/>',
  plug: '<path d="M9 3v5M15 3v5M6.5 8h11v3.500a5.5 5.5 0 0 1-11 0zM12 17v4"/>',
};
export const ic = (n, cls = '') =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${IC[n] || ''}</svg>`;

// Neutrale Produktmarke (Schutzhelm) – bewusst kein Firmenlogo
export const MARK = '<svg class="mark" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="10" fill="#d4302b"/><path d="M8 27.5h24" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M11 24v-2.5a9 9 0 0 1 18 0V24z" fill="#fff"/><rect x="17.5" y="9.5" width="5" height="7" rx="1.2" fill="#fff" stroke="#d4302b" stroke-width="1.4"/></svg>';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Formatierung de-AT ---------- */
// Schreibweise wie in österreichischen Angeboten und Rechnungen: Tausenderpunkt und Dezimalkomma (1.234,50).
// (Die CLDR-Vorgabe „de-AT“ setzt bei reinen Zahlen ein Leerzeichen – das passt nicht zur Eingabe „250.000“.)
const nf = (min, max) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: 'always' });
const NF0 = nf(0, 0), NF1 = nf(0, 1), NF2 = nf(2, 2), NF02 = nf(0, 2);
const istZahl = (n) => typeof n === 'number' && isFinite(n);
const WT = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const WTK = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MON = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const p2 = (n) => String(n).padStart(2, '0');
const dt = (s) => { if (s instanceof Date) return s; const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };

export const fmt = {
  WT, WTK, MON, dt,
  zahl: (n, max = 2) => (istZahl(n) ? (max === 0 ? NF0 : max === 1 ? NF1 : NF02).format(n) : '–'),
  eur: (n) => (istZahl(n) ? '€ ' + NF2.format(n) : '–'),
  betrag: (n) => (istZahl(n) ? NF2.format(n) : ''),
  eur0: (n) => (istZahl(n) ? '€ ' + NF0.format(Math.round(n)) : '–'),
  std: (n) => (istZahl(n) ? NF02.format(n) + ' Std.' : '–'),
  pct: (n) => (istZahl(n) ? NF1.format(n) + ' %' : '–'),
  iso: (d = new Date()) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`,
  addTage: (s, n) => { const d = dt(s); d.setDate(d.getDate() + n); return fmt.iso(d); },
  datum: (s) => { if (!s) return '–'; const d = dt(s); return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`; },
  datumKurz: (s) => { const d = dt(s); return `${WTK[d.getDay()]}, ${p2(d.getDate())}.${p2(d.getMonth() + 1)}.`; },
  datumLang: (s) => { const d = dt(s); return `${WT[d.getDay()]}, ${d.getDate()}. ${MON[d.getMonth()]} ${d.getFullYear()}`; },
  // Uhrzeit aus ISO-Zeitstempel oder "HH:MM"
  uhr: (s) => { if (!s) return '–'; if (/^\d{1,2}:\d{2}/.test(s)) return s.slice(0, 5); const d = new Date(s); return isNaN(d) ? '–' : `${p2(d.getHours())}:${p2(d.getMinutes())}`; },
  zeitpunkt: (s) => { if (!s) return '–'; const d = new Date(s); if (isNaN(d)) return esc(s); return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}, ${p2(d.getHours())}:${p2(d.getMinutes())}`; },
  dauer: (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 3600)}:${p2(Math.floor((s % 3600) / 60))}:${p2(s % 60)}`; },
  hm: (stunden) => { if (!istZahl(stunden)) return '–'; const m = Math.round(stunden * 60); return `${Math.floor(m / 60)}:${p2(m % 60)}`; },
  monat: (ym) => { const [y, m] = ym.split('-').map(Number); return `${MON[m - 1]} ${y}`; },
};
// Zahleneingabe (de-AT) liegt in zahl.js – dort auch unter Node getestet (Prüfbericht B-04)
export { parseZahl, starkGeaendert };

export const ROLLEN = { mitarbeiter: 'Mitarbeiter', polier: 'Polier', bauleiter: 'Bauleiter', buero: 'Büro', gf: 'Geschäftsführung' };
export const rolleText = (r) => ROLLEN[r] || r || '';
export const initialen = (name) => String(name || '?').trim().split(/\s+/).map((t) => t[0]).slice(0, 2).join('').toUpperCase();
export const avatar = (name, cls = '') => `<span class="avatar ${cls}" aria-hidden="true">${esc(initialen(name))}</span>`;

export const STATUS_BERICHT = { entwurf: ['Entwurf', 'st-grey'], unterschrieben: ['Unterschrieben', 'st-amber'], freigegeben: ['Freigegeben', 'st-green'] };
export const statusChip = (s) => { const [t, c] = STATUS_BERICHT[s] || [s, 'st-grey']; return `<span class="chip ${c}"><i class="dot"></i>${esc(t)}</span>`; };
export const KALK_STATUS = { ok: ['Im Plan', 'st-green'], warnung: ['Warnung', 'st-amber'], kritisch: ['Kritisch', 'st-red'] };
export const kalkChip = (s) => { const [t, c] = KALK_STATUS[s] || [s || '–', 'st-grey']; return `<span class="chip ${c}"><i class="dot"></i>${esc(t)}</span>`; };

/* ---------- Zustände ---------- */
export const laden = (text = 'Wird geladen …') => `<div class="state" role="status"><span class="spinner" aria-hidden="true"></span><p>${esc(text)}</p></div>`;
export const leer = (text, icon = 'info', extra = '') => `<div class="state empty">${ic(icon)}<p>${esc(text)}</p>${extra}</div>`;
export const keinZugriff = (text) => `<div class="page narrow"><div class="card state big" data-zustand="kein-zugriff">${ic('lock')}<h2>Kein Zugriff</h2><p>${esc(text || 'Für diesen Bereich fehlt Ihnen die Berechtigung. Wenden Sie sich bei Bedarf an die Geschäftsführung.')}</p><a class="btn ghost" href="#/">Zur Startseite</a></div></div>`;
export const fehlerBox = (err, mitNeu = true) => {
  const netz = err && err.netz;
  return `<div class="page narrow"><div class="card state big" data-zustand="fehler">${ic(netz ? 'wifiOff' : 'alert')}<h2>${netz ? 'Keine Verbindung' : 'Das hat nicht geklappt'}</h2><p>${esc(netz ? 'Der Server ist gerade nicht erreichbar. Stempeln funktioniert weiterhin – die Buchung wird nachgesendet.' : (err && err.message) || 'Unbekannter Fehler.')}</p>${mitNeu ? '<button class="btn ghost" data-neu-laden>Erneut versuchen</button>' : ''}</div></div>`;
};
export const banner = (art, text, icon) => `<div class="banner ${art}" role="${art === 'warn' || art === 'err' ? 'alert' : 'note'}">${ic(icon || (art === 'ok' ? 'check' : art === 'info' ? 'info' : 'alert'))}<span>${text}</span></div>`;

/* ---------- Toast ---------- */
export function toast(text, art = 'ok') {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast ' + art;
  el.setAttribute('role', art === 'ok' ? 'status' : 'alert');
  el.innerHTML = ic(art === 'ok' ? 'check' : 'alert') + `<span>${esc(text)}</span>`;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, art === 'ok' ? 2800 : 4800);
}
export const fehlerToast = (e) => toast(e && e.netz ? 'Keine Verbindung zum Server.' : (e && e.message) || 'Fehler', 'warn');

/* ---------- Dialog (natives <dialog>: Fokusfalle, Esc, aria-modal) ---------- */
let dlgNr = 0;
export function dialog({ titel, inhalt, breit = false, seite = false, fuss = '' }) {
  const id = 'dlg' + ++dlgNr;
  const el = document.createElement('dialog');
  el.className = 'dlg' + (breit ? ' wide' : '') + (seite ? ' side' : '');
  el.setAttribute('aria-labelledby', id);
  el.innerHTML = `<div class="dlg-head"><h2 id="${id}">${esc(titel)}</h2><button class="icon-btn" type="button" data-zu aria-label="Schließen">${ic('x')}</button></div><div class="dlg-body">${inhalt}</div>${fuss ? `<div class="dlg-foot">${fuss}</div>` : ''}`;
  document.body.appendChild(el);
  const zu = (wert) => { if (el.open) el.close(); el.wert = wert; };
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-zu]')) zu(); });
  el.addEventListener('close', () => { el.remove(); });
  el.showModal();
  return { el, zu, body: el.querySelector('.dlg-body'), geschlossen: new Promise((r) => el.addEventListener('close', () => r(el.wert))) };
}
export function bestaetigen(titel, text, okText = 'Ja', art = 'primary') {
  const d = dialog({ titel, inhalt: `<p>${esc(text)}</p>`, fuss: `<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn ${art}" type="button" data-ok>${esc(okText)}</button>` });
  d.el.querySelector('[data-ok]').addEventListener('click', () => d.zu(true));
  return d.geschlossen.then((w) => w === true);
}

/* ---------- Kleinkram ---------- */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const entprellt = (fn, ms) => { let t; const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; f.sofort = (...a) => { clearTimeout(t); return fn(...a); }; return f; };
export const speicher = {
  lies(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  setz(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* voll/gesperrt */ } },
  weg(k) { try { localStorage.removeItem(k); } catch (e) { /* egal */ } },
};
// Nicht angebundene Integration als deaktivierte Schaltfläche mit ehrlichem Hinweis
export const integBtn = (integ, schluessel, text, icon, cls = '') => {
  const i = (integ || []).find((x) => x.schluessel === schluessel);
  if (i && i.angebunden) return ''; // angebundene Dienste haben (noch) keine Oberfläche
  const hinweis = (i && i.hinweis) || 'Anbieter/Vertrag fehlt.';
  return `<span class="integ ${cls}" data-integ="${esc(schluessel)}"><button type="button" class="btn ghost sm" disabled aria-describedby="ih-${esc(schluessel)}">${ic(icon)}${esc(text)}</button><small id="ih-${esc(schluessel)}"><b>Noch nicht angebunden</b> · ${esc(hinweis)}</small></span>`;
};

/* ---------- Betragsfelder: sofort zeigen, wie die Eingabe verstanden wird (B-04) ---------- */
// Jedes <input data-geld> bekommt darunter eine Zeile „= € 250.000,00“ bzw. eine Fehlermeldung.
// data-geld="leer" erlaubt ein leeres Feld. Rückgabe von geldWert(): Zahl, null (leer erlaubt) oder NaN.
export function geldWert(inp) {
  const roh = inp.value.trim();
  if (!roh) return inp.dataset.geld === 'leer' ? null : NaN;
  const n = parseZahl(roh);
  return Number.isFinite(n) && (n >= 0 || inp.dataset.negativ === 'ja') ? Math.round(n * 100) / 100 : NaN;
}
export function geldFelder(wurzel) {
  $$('input[data-geld]', wurzel).forEach((inp) => {
    if (inp.dataset.geldAn || inp.disabled) return;
    inp.dataset.geldAn = '1';
    const echo = document.createElement('small');
    echo.className = 'geld-echo'; echo.id = 'ge' + ++dlgNr; echo.setAttribute('aria-live', 'polite');
    inp.setAttribute('aria-describedby', echo.id);
    inp.insertAdjacentElement('afterend', echo);
    const zeig = () => {
      const roh = inp.value.trim(), w = geldWert(inp);
      const fehler = roh !== '' && Number.isNaN(w);
      inp.classList.toggle('invalid', fehler);
      if (fehler) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid');
      echo.classList.toggle('err', fehler);
      echo.textContent = fehler ? 'Eingabe unklar – bitte so schreiben: 250.000,00' : roh === '' ? '' : `wird gespeichert als ${fmt.eur(w)}`;
    };
    inp.addEventListener('input', zeig);
    zeig();
  });
}
// Rückfrage, wenn sich ein Betrag um mehr als Faktor 10 ändert
export async function starkOk(alt, neu, was = 'Der Betrag') {
  if (!starkGeaendert(alt, neu)) return true;
  return bestaetigen('Stimmt dieser Betrag?', `${was} ändert sich stark: von ${fmt.eur(alt)} auf ${fmt.eur(neu)}. Wirklich so speichern?`, 'Ja, speichern');
}
