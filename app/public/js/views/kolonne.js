// Kolonne stempeln: Polier/Bauleiter bucht mehrere Leute auf einmal.
import { get, post } from '../api.js';
import { ic, esc, avatar, rolleText, banner, toast, speicher, $, $$ } from '../ui.js';

const TYPEN = [['kommen', 'Kommen', 'play'], ['pause_start', 'Pause', 'pause'], ['pause_ende', 'Pause Ende', 'play'], ['gehen', 'Gehen', 'logout']];

export default async function kolonne(el, ctx) {
  const [baustellen, mitarbeiter, anwesend] = await Promise.all([
    get('/baustellen'), get('/mitarbeiter'),
    get('/zeit/anwesend').catch(() => null), // optional (additiv): wer ist gerade eingestempelt
  ]);
  const aktive = baustellen.filter((b) => !b.status || b.status === 'aktiv');
  const leute = mitarbeiter.filter((m) => m.aktiv !== false && m.aktiv !== 0);
  const eigene = (ctx.ich.baustellenIds || []).find((id) => aktive.some((b) => b.id === id));
  let baustelleId = aktive.some((b) => b.id === speicher.lies('bt_baustelle')) ? speicher.lies('bt_baustelle') : (eigene ?? (aktive[0] && aktive[0].id));
  let typ = 'kommen';
  const gewaehlt = new Set();
  let ergebnis = new Map();
  let status = new Map((Array.isArray(anwesend) ? anwesend : (anwesend && anwesend.anwesend) || []).map((a) => [a.benutzerId ?? a.id, a]));
  let suche = '';
  let sendet = false;

  function zeile(m) {
    const erg = ergebnis.get(m.id);
    const s = status.get(m.id);
    const an = gewaehlt.has(m.id);
    const info = erg ? (erg.ok ? '<span class="chip xs st-green">gebucht</span>' : `<span class="crew-err">${esc(erg.fehler || 'nicht gebucht')}</span>`)
      : s ? `<span class="chip xs ${s.status === 'pause' ? 'st-amber' : 'st-green'}">${s.status === 'pause' ? 'Pause' : 'eingestempelt'}</span>` : '';
    return `<label class="crew-row${an ? ' sel' : ''}${erg && !erg.ok ? ' err' : ''}"><input type="checkbox" class="vh" data-ma="${m.id}" ${an ? 'checked' : ''}><span class="check">${ic('check')}</span>${avatar(m.name)}<span class="crew-txt"><b>${esc(m.name)}</b><small>${esc(m.lohngruppe || rolleText(m.rolle))}</small></span>${info}</label>`;
  }
  function zeichne() {
    const sicht = leute.filter((m) => m.name.toLowerCase().includes(suche.toLowerCase()));
    el.innerHTML = `
    <div class="page narrow wide-md">
      <section class="card pad stack-s">
        <label class="field"><span class="field-label">Baustelle</span>
          <select id="kol-bs" class="input lg">${aktive.map((b) => `<option value="${b.id}" ${b.id === baustelleId ? 'selected' : ''}>${esc((b.kst ? b.kst + ' · ' : '') + b.name)}</option>`).join('')}</select></label>
        <div><span class="field-label" id="kol-typ-l">Buchung</span>
          <div class="seg-ctl" role="radiogroup" aria-labelledby="kol-typ-l">${TYPEN.map(([k, t, i]) => `<button type="button" role="radio" aria-checked="${typ === k}" class="${typ === k ? 'on' : ''}" data-typ="${k}">${ic(i)}${t}</button>`).join('')}</div></div>
      </section>
      <section class="card">
        <div class="card-h pad-h"><h3>Mitarbeiter <span class="count" id="kol-zahl">${gewaehlt.size} gewählt</span></h3><button type="button" class="btn ghost sm" data-alle>${gewaehlt.size === sicht.length && sicht.length ? 'Keine' : 'Alle'}</button></div>
        <div class="pad-x"><label class="search sm"><span>${ic('user')}</span><input type="search" id="kol-suche" placeholder="Name suchen" aria-label="Mitarbeiter suchen" value="${esc(suche)}"></label></div>
        <div class="crew-list" id="kol-liste">${sicht.length ? sicht.map(zeile).join('') : '<div class="state empty"><p>Niemand gefunden.</p></div>'}</div>
      </section>
      ${!aktive.length ? banner('warn', 'Keine aktive Baustelle vorhanden.') : ''}
    </div>
    <div class="foot-bar"><button type="button" class="btn primary lg block" id="kol-los" ${gewaehlt.size && baustelleId != null && !sendet ? '' : 'disabled'}>${ic('check')}${gewaehlt.size} ${gewaehlt.size === 1 ? 'Person' : 'Personen'} buchen: ${TYPEN.find((t) => t[0] === typ)[1]}</button></div>`;
  }

  el.addEventListener('change', (e) => {
    if (e.target.id === 'kol-bs') { baustelleId = Number(e.target.value); speicher.setz('bt_baustelle', baustelleId); return; }
    const c = e.target.closest('[data-ma]');
    if (c) { const id = Number(c.dataset.ma); if (c.checked) gewaehlt.add(id); else gewaehlt.delete(id); ergebnis = new Map(); zeichne(); }
  });
  el.addEventListener('input', (e) => {
    if (e.target.id !== 'kol-suche') return;
    suche = e.target.value;
    const sicht = leute.filter((m) => m.name.toLowerCase().includes(suche.toLowerCase()));
    $('#kol-liste', el).innerHTML = sicht.length ? sicht.map(zeile).join('') : '<div class="state empty"><p>Niemand gefunden.</p></div>';
  });
  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-typ]');
    if (t) { typ = t.dataset.typ; ergebnis = new Map(); zeichne(); return; }
    if (e.target.closest('[data-alle]')) {
      const sicht = leute.filter((m) => m.name.toLowerCase().includes(suche.toLowerCase()));
      if (gewaehlt.size === sicht.length) gewaehlt.clear(); else sicht.forEach((m) => gewaehlt.add(m.id));
      zeichne(); return;
    }
    if (e.target.closest('#kol-los') && !sendet) {
      sendet = true; zeichne();
      try {
        const r = await post('/zeit/kolonne', { baustelleId, benutzerIds: [...gewaehlt], typ });
        const erg = r.ergebnisse || [];
        ergebnis = new Map(erg.map((x) => [x.benutzerId, x]));
        const ok = erg.filter((x) => x.ok).length, nok = erg.length - ok;
        toast(nok ? `${ok} gebucht, ${nok} nicht möglich – Details in der Liste.` : `${ok} ${ok === 1 ? 'Person' : 'Personen'} gebucht.`, nok ? 'warn' : 'ok');
        erg.filter((x) => x.ok).forEach((x) => gewaehlt.delete(x.benutzerId));
        const neu = await get('/zeit/anwesend').catch(() => null);
        if (neu) status = new Map((Array.isArray(neu) ? neu : neu.anwesend || []).map((a) => [a.benutzerId ?? a.id, a]));
      } catch (err) {
        toast(err.netz ? 'Keine Verbindung – Kolonnen-Buchung braucht Netz. Bitte später erneut versuchen.' : err.message, 'warn');
      }
      sendet = false;
      if (ctx.aktuell()) zeichne();
    }
  });
  zeichne();
}
