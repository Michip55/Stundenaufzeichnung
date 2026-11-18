// Kolonne stempeln: Polier/Bauleiter bucht mehrere Leute der Partie auf einmal.
import { get, post } from '../api.js';
import { ic, esc, fmt, avatar, rolleText, banner, toast, speicher, laden, $ } from '../ui.js';
import { pauseWaehlen, pausenAuswahl, merkeAuswahl, dauerText, bisText } from '../pausen.js';

const TYPEN = [['kommen', 'Kommen', 'play'], ['pause_start', 'Pause', 'pause'], ['pause_ende', 'Pause Ende', 'play'], ['gehen', 'Gehen', 'logout']];
const ST = { arbeit: ['eingestempelt', 'st-green'], pause: ['Pause', 'st-amber'], aus: ['nicht da', 'st-grey'] };

export default async function kolonne(el, ctx) {
  const [baustellen, mitarbeiter, eigenerStatus] = await Promise.all([get('/baustellen'), get('/mitarbeiter'), ctx.kann('zeit_eigen') ? get('/zeit/status').catch(() => null) : null]);
  // 15.22: vordefinierte Pausen – dieselbe Auswahl wie die Stempeluhr (aus GET /zeit/status, sonst zuletzt gemerkt)
  if (eigenerStatus && Array.isArray(eigenerStatus.pausenAuswahl)) merkeAuswahl(eigenerStatus.pausenAuswahl);
  const auswahl = eigenerStatus && Array.isArray(eigenerStatus.pausenAuswahl) ? eigenerStatus.pausenAuswahl : pausenAuswahl();
  let ablaufTimer = null;
  // F-033 / API.md 15.2: nur Baustellen, auf denen der Server die Kolonne erlaubt. `baustellenIds` (/auth/ich) ist genau die
  // Serverregel (rechte.baustelleImBereich): Büro/GF alle, Polier und Mitarbeiter mit Ausnahme „kolonne“ nur die eigene Partie.
  const eigeneIds = ctx.ich.baustellenIds || [];
  const aktive = baustellen.filter((b) => (!b.status || b.status === 'aktiv') && eigeneIds.includes(b.id));
  const ausPlan = ctx.query.get('plan') === '1' && aktive.some((b) => b.id === Number(ctx.query.get('baustelleId'))) ? Number(ctx.query.get('baustelleId')) : null;
  const gemerkt = ausPlan ?? speicher.lies('bt_baustelle');
  let baustelleId = aktive.some((b) => b.id === gemerkt) ? gemerkt : (aktive.find((b) => eigeneIds.includes(b.id)) || aktive[0] || {}).id;
  let typ = 'kommen';
  let partie = [];          // [{benutzerId, name, rolle, partie, status, seit, code}]
  let fehlerPartie = '';
  let alleZeigen = false;
  const gewaehlt = new Set();
  let ergebnis = new Map();
  let sendet = false;

  async function ladePartie() {
    fehlerPartie = ''; partie = [];
    if (baustelleId == null) return;
    try { partie = await get(`/zeit/kolonne?baustelleId=${baustelleId}&plan=1`); }
    catch (e) { if (e.status === 401) throw e; fehlerPartie = e.netz ? 'Keine Verbindung – die Partie kann gerade nicht geladen werden.' : e.message; }
  }
  const liste = () => {
    const ids = new Set(partie.map((p) => p.benutzerId));
    const rest = alleZeigen ? mitarbeiter.filter((m) => m.aktiv !== false && !ids.has(m.id) && ['mitarbeiter', 'polier'].includes(m.rolle)).map((m) => ({ benutzerId: m.id, name: m.name, rolle: m.rolle, extra: true })) : [];
    return [...partie, ...rest];
  };
  function zeile(m) {
    const erg = ergebnis.get(m.benutzerId);
    const an = gewaehlt.has(m.benutzerId);
    const [st, cls] = ST[m.status] || ['', ''];
    const info = erg ? (erg.ok ? (m.status === 'pause' && m.pauseBis ? `<span class="chip xs st-green" data-pause-bis="${esc(m.pauseBis)}">gebucht · ${esc(bisText(m.pauseBis))}</span>` : '<span class="chip xs st-green">gebucht</span>') : `<span class="crew-err">${esc(erg.fehler || 'nicht gebucht')}</span>`)
      : m.code && (ctx.kann('stammdaten') || ctx.kann('lohn')) ? `<span class="code-badge c-${esc(m.code)}">${m.code === 'abwesend' ? 'abw.' : esc(m.code)}</span>`
      : m.geplant && m.status === 'aus' ? '<span class="chip xs st-blue" data-eingeplant>eingeplant</span>'
      : m.status === 'pause' && m.pauseBis ? `<span class="chip xs ${cls}" data-pause-bis="${esc(m.pauseBis)}">${esc(bisText(m.pauseBis))}</span>`
      : st ? `<span class="chip xs ${cls}">${st}${m.status !== 'aus' && m.seit ? ' seit ' + fmt.uhr(m.seit) : ''}</span>` : '';
    return `<label class="crew-row${an ? ' sel' : ''}${erg && !erg.ok ? ' err' : ''}"><input type="checkbox" class="vh" data-ma="${m.benutzerId}" ${an ? 'checked' : ''}><span class="check">${ic('check')}</span>${avatar(m.name, m.status === 'arbeit' ? 'on' : m.status === 'pause' ? 'pause' : '')}<span class="crew-txt"><b>${esc(m.name)}</b><small>${esc(rolleText(m.rolle))}${m.extra ? ' · Gast (nicht in der Partie, wird protokolliert)' : ''}</small></span>${info}</label>`;
  }
  // 15.22: endet eine geplante Pause, die Liste zu diesem Zeitpunkt neu laden (der Server hat das Ende dann eingetragen)
  function ablaufPlanen() {
    clearTimeout(ablaufTimer);
    const naechste = partie.filter((m) => m.status === 'pause' && m.pauseBis).map((m) => new Date(m.pauseBis).getTime()).sort((a, b) => a - b)[0];
    if (naechste == null) return;
    ablaufTimer = setTimeout(async () => { if (!ctx.aktuell() || sendet) return; try { await ladePartie(); } catch (e) { return; } ergebnis = new Map(); if (ctx.aktuell()) zeichne(); }, Math.max(500, naechste - Date.now() + 1000));
  }
  function zeichne() {
    const sicht = liste();
    const tName = TYPEN.find((t) => t[0] === typ)[1];
    const inArbeit = sicht.filter((m) => m.status === 'arbeit').length;
    ablaufPlanen();
    el.innerHTML = `
    <div class="page narrow wide-md">
      ${!aktive.length ? banner('warn', 'Keine aktive Baustelle, auf der Sie die Kolonne stempeln dürfen.') : ''}
      <section class="card pad stack-s">
        <label class="field"><span class="field-label">Baustelle</span>
          <select id="kol-bs" class="input lg">${aktive.map((b) => `<option value="${b.id}" ${b.id === baustelleId ? 'selected' : ''}>${esc((b.kst ? b.kst + ' · ' : '') + b.name)}</option>`).join('')}</select></label>
        <div><span class="field-label" id="kol-typ-l">Buchung</span>
          <div class="seg-ctl" role="radiogroup" aria-labelledby="kol-typ-l">${TYPEN.map(([k, t, i]) => `<button type="button" role="radio" aria-checked="${typ === k}" class="${typ === k ? 'on' : ''}" data-typ="${k}">${ic(i)}${t}</button>`).join('')}</div></div>
      </section>
      <section class="card">
        <div class="card-h pad-h"><h3>Partie <span class="count" id="kol-zahl">${gewaehlt.size} gewählt</span></h3><span class="btn-zeile"><button type="button" class="btn ghost sm" id="kol-alle-pause" data-alle-pause ${inArbeit && baustelleId != null && !sendet ? '' : 'disabled'}>${ic('pause')}Alle in Pause</button><button type="button" class="btn ghost sm" data-alle ${sicht.length ? '' : 'disabled'}>${sicht.length && gewaehlt.size === sicht.length ? 'Keine' : 'Alle'}</button></span></div>
        ${fehlerPartie ? `<div class="state small">${ic('alert')}<p>${esc(fehlerPartie)}</p></div>` : ''}
        <div class="crew-list" id="kol-liste">${sicht.length ? sicht.map(zeile).join('') : fehlerPartie ? '' : `<div class="state empty small">${ic('users')}<p>Dieser Baustelle ist noch niemand zugeteilt.</p></div>`}</div>
        <button type="button" class="add-row" data-mehr>${ic(alleZeigen ? 'minus' : 'plus')}${alleZeigen ? 'Nur die Partie anzeigen' : 'Gast aus anderer Partie hinzufügen'}</button>
      </section>
    </div>
    <div class="foot-bar"><button type="button" class="btn primary lg block" id="kol-los" ${gewaehlt.size && baustelleId != null && !sendet ? '' : 'disabled'}>${ic('check')}${typ === 'pause_start' ? `${gewaehlt.size} ${gewaehlt.size === 1 ? 'Person' : 'Personen'} in Pause …` : `${gewaehlt.size} ${gewaehlt.size === 1 ? 'Person' : 'Personen'} buchen: ${tName}`}</button></div>`;
  }

  el.addEventListener('change', async (e) => {
    if (e.target.id === 'kol-bs') {
      baustelleId = Number(e.target.value); speicher.setz('bt_baustelle', baustelleId);
      gewaehlt.clear(); ergebnis = new Map();
      $('#kol-liste', el).innerHTML = laden();
      await ladePartie(); if (ctx.aktuell()) zeichne();
      return;
    }
    const c = e.target.closest('[data-ma]');
    if (c) { const id = Number(c.dataset.ma); if (c.checked) gewaehlt.add(id); else gewaehlt.delete(id); ergebnis = new Map(); zeichne(); }
  });
  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-typ]');
    if (t) { typ = t.dataset.typ; ergebnis = new Map(); zeichne(); return; }
    if (e.target.closest('[data-mehr]')) { alleZeigen = !alleZeigen; if (!alleZeigen) { const ids = new Set(partie.map((p) => p.benutzerId)); [...gewaehlt].forEach((id) => { if (!ids.has(id)) gewaehlt.delete(id); }); } zeichne(); return; }
    if (e.target.closest('[data-alle]')) {
      const sicht = liste();
      if (gewaehlt.size === sicht.length) gewaehlt.clear(); else sicht.forEach((m) => gewaehlt.add(m.benutzerId));
      ergebnis = new Map(); zeichne(); return;
    }
    // 15.22: „Alle in Pause“ – alle Eingestempelten der Liste auswählen, dann dieselbe Auswahl wie die Stempeluhr
    const allePause = e.target.closest('[data-alle-pause]');
    if (allePause && !allePause.disabled && !sendet) {
      gewaehlt.clear(); liste().filter((m) => m.status === 'arbeit').forEach((m) => gewaehlt.add(m.benutzerId));
      typ = 'pause_start'; ergebnis = new Map(); zeichne();
    }
    if ((allePause || e.target.closest('#kol-los')) && !sendet && gewaehlt.size) {
      let dauerMin = null;
      if (typ === 'pause_start') {
        const w = await pauseWaehlen({ titel: `Pause für ${gewaehlt.size} ${gewaehlt.size === 1 ? 'Person' : 'Personen'} – wie lange?`, auswahl, hinweis: 'Gilt für jede ausgewählte Person.' });
        if (w === undefined || !ctx.aktuell()) return;
        dauerMin = w === 'offen' ? null : w;
      }
      sendet = true; zeichne();
      try {
        const ids = new Set(partie.map((x) => x.benutzerId));
        const gaeste = [...gewaehlt].filter((id) => !ids.has(id));
        const body = { baustelleId, benutzerIds: [...gewaehlt], typ };
        if (dauerMin != null) body.dauerMin = dauerMin;
        if (gaeste.length) body.gast = true; // fremde Personen nur ausdrücklich als Gast – wird am Server protokolliert
        const r = await post('/zeit/kolonne', body);
        const erg = r.ergebnisse || [];
        const ok = erg.filter((x) => x.ok).length, nok = erg.length - ok;
        const was = typ === 'pause_start' ? ` (Pause ${dauerText(dauerMin)})` : '';
        toast(nok ? `${ok} gebucht${was}, ${nok} nicht möglich – Details in der Liste.` : `${ok} ${ok === 1 ? 'Person' : 'Personen'} gebucht${was}.`, nok ? 'warn' : 'ok');
        erg.filter((x) => x.ok).forEach((x) => gewaehlt.delete(x.benutzerId));
        await ladePartie();
        ergebnis = new Map(erg.map((x) => [x.benutzerId, x]));
      } catch (err) {
        toast(err.netz ? 'Keine Verbindung – die Kolonnen-Buchung braucht Netz. Bitte später erneut versuchen.' : err.message, 'warn');
      }
      sendet = false;
      if (ctx.aktuell()) zeichne();
    }
  });
  await ladePartie();
  // aus „Meine Partie“: die heute eingeplante Mannschaft ist schon ausgewählt – unabhängig von Abwesenheiten (API.md 15.2);
  // `code` kommt nur bei Sicht auf Abwesenheiten (Büro/GF bzw. die eigene), für Polier/Mitarbeiter ist er bei anderen immer null
  if (ausPlan != null) partie.filter((m) => m.geplant && (!m.status || m.status === 'aus') && !m.code).forEach((m) => gewaehlt.add(m.benutzerId));
  zeichne();
  return () => clearTimeout(ablaufTimer);
}
