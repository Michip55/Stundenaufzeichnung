// Abwesenheiten (Prüfbericht B-07): eigene Anträge mit Status, Genehmigung durch Büro/GF,
// Krank/Schlechtwetter für andere eintragen (Büro/GF), Schlechtwetter für die Partie (Polier).
import { get, post, put, del } from '../api.js';
import { ic, esc, fmt, avatar, laden, leer, banner, dialog, bestaetigen, toast, $, $$ } from '../ui.js';

export const CODES = { K: 'Krank', U: 'Urlaub', SW: 'Schlechtwetter', ZA: 'Zeitausgleich' };
const STATUS = { beantragt: ['Beantragt', 'st-amber'], genehmigt: ['Genehmigt', 'st-green'], abgelehnt: ['Abgelehnt', 'st-red'] };
export const abwChip = (s) => { const [t, c] = STATUS[s] || [s || '–', 'st-grey']; return `<span class="chip ${c}" data-abw-status="${esc(s || '')}"><i class="dot"></i>${esc(t)}</span>`; };
const badge = (c) => `<span class="code-badge c-${esc(c)}">${esc(c)}</span>`;

export default async function abwesenheiten(el, ctx) {
  const ich = ctx.ich.benutzer;
  const darfEntscheiden = ctx.kann('stammdaten') || ctx.kann('lohn');
  const istPolier = !darfEntscheiden && ctx.kann('kolonne');
  const heute = fmt.iso();
  const von = fmt.addTage(heute, -62), bis = fmt.addTage(heute, 366);
  let liste = [], leute = [];

  async function lade() {
    [liste, leute] = await Promise.all([
      get(`/abwesenheiten?von=${von}&bis=${bis}`),
      darfEntscheiden || istPolier ? get('/mitarbeiter').catch(() => []) : [],
    ]);
    liste.sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0));
  }
  const zeile = (a, { mitName, aktionen }) => `
    <li data-abw="${a.id}" data-status="${esc(a.status)}">
      ${mitName ? avatar(a.name || '?', 'sm') : badge(a.code)}
      <span class="grow"><b>${mitName ? esc(a.name || `Benutzer ${a.benutzerId}`) : esc(CODES[a.code] || a.code)}</b><small>${mitName ? `${badge(a.code)} ${esc(CODES[a.code] || a.code)} · ` : ''}${esc(fmt.datumLang(a.datum))}</small></span>
      ${abwChip(a.status)}
      ${aktionen ? `<span class="abw-akt">${aktionen}</span>` : ''}
    </li>`;

  function zeichne() {
    const eigene = liste.filter((a) => a.benutzerId === ich.id);
    const offen = liste.filter((a) => a.status === 'beantragt' && (darfEntscheiden ? true : false)).sort((a, b) => (a.datum > b.datum ? 1 : -1));
    const andere = liste.filter((a) => a.benutzerId !== ich.id && (!darfEntscheiden || a.status !== 'beantragt'));
    el.innerHTML = `
    <div class="page narrow wide-md">
      ${darfEntscheiden ? `
      <section class="card" id="abw-offen" aria-labelledby="h-offen">
        <div class="card-h pad-h"><h3 id="h-offen">${ic('calendar')}Anträge zur Genehmigung <span class="count${offen.length ? ' red' : ''}">${offen.length}</span></h3></div>
        ${offen.length ? `<ul class="plain rows">${offen.map((a) => zeile(a, { mitName: true, aktionen: a.benutzerId === ich.id ? '<span class="muted sm" data-eigener>Eigener Antrag – entscheidet eine andere Person</span>' : `<button type="button" class="btn primary sm" data-entscheid="genehmigt" data-id="${a.id}">${ic('check')}Genehmigen</button><button type="button" class="btn ghost sm" data-entscheid="abgelehnt" data-id="${a.id}">Ablehnen</button>` })).join('')}</ul>` : leer('Keine offenen Anträge.', 'check')}
        <p class="card-note">Nur genehmigte Abwesenheiten zählen in Monatsauswertung, Lohn- und BUAK-Export.</p>
      </section>` : ''}

      <section class="card" id="abw-eigene" aria-labelledby="h-eigene">
        <div class="card-h pad-h"><h3 id="h-eigene">Meine Abwesenheiten</h3><button type="button" class="btn primary sm" data-akt="antrag">${ic("plus")}Beantragen</button></div>
        ${eigene.length ? `<ul class="plain rows">${eigene.map((a) => zeile(a, { mitName: false, aktionen: a.status === 'beantragt' ? `<button type="button" class="btn ghost sm" data-zurueckziehen="${a.id}">Zurückziehen</button>` : '' })).join('')}</ul>` : leer('Keine Abwesenheiten eingetragen.', 'calendar')}
      </section>

      ${darfEntscheiden || istPolier ? `
      <section class="card" id="abw-andere" aria-labelledby="h-andere">
        <div class="card-h pad-h"><h3 id="h-andere">${darfEntscheiden ? 'Alle Abwesenheiten' : 'Abwesenheiten meiner Partie'}</h3><button type="button" class="btn ghost sm" data-akt="eintragen">${ic('plus')}${darfEntscheiden ? 'Abwesenheit eintragen' : 'Schlechtwetter eintragen'}</button></div>
        ${andere.length ? `<ul class="plain rows">${andere.slice(0, 80).map((a) => zeile(a, { mitName: true, aktionen: darfEntscheiden ? `<button type="button" class="icon-btn sm" data-loeschen="${a.id}" aria-label="Abwesenheit von ${esc(a.name || '')} am ${esc(fmt.datum(a.datum))} löschen">${ic('trash')}</button>` : '' })).join('')}</ul>` : leer('Keine Einträge.', 'calendar')}
        ${istPolier ? '<p class="card-note">Als Polier melden Sie Schlechtwetter (SW) für Ihre Partie – höchstens 3 Tage zurück. Die Meldung zählt erst, wenn Bauleitung oder Büro sie bestätigt hat. Krankenstand trägt das Büro ein.</p>' : ''}
      </section>` : ''}
    </div>`;
  }
  const neu = async () => { await lade(); if (ctx.aktuell()) zeichne(); ctx.meldungenNeu(); };

  function antragDialog() {
    const d = dialog({
      titel: 'Abwesenheit beantragen',
      inhalt: `<form id="abw-f" class="stack-s">
        <label class="field"><span class="field-label">Datum</span><input class="input lg" type="date" name="datum" required min="${fmt.addTage(heute, -7)}" value="${fmt.addTage(heute, 1)}"></label>
        <label class="field"><span class="field-label">Art</span><select class="input lg" name="code"><option value="U">Urlaub</option><option value="ZA">Zeitausgleich</option></select></label>
        ${banner('info', 'Der Antrag geht ans Büro. Erst nach der Genehmigung zählt der Tag als Urlaub bzw. Zeitausgleich.')}
        <p class="form-err" role="alert" hidden></p></form>`,
      fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="abw-f">Beantragen</button>',
    });
    $('#abw-f', d.el).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target);
      try { const r = await post('/abwesenheiten', { benutzerId: ich.id, datum: f.get('datum'), code: f.get('code') }); d.zu(); toast(r && r.status === 'genehmigt' ? 'Abwesenheit eingetragen und genehmigt.' : 'Antrag gestellt – wartet auf Genehmigung durch eine andere Person.'); neu(); }
      catch (x) { const m = $('.form-err', d.el); m.hidden = false; m.textContent = x.message; }
    });
  }
  function eintragenDialog() {
    const eigeneBs = ctx.ich.baustellenIds || [];
    const wahl = leute.filter((m) => m.aktiv !== false && (darfEntscheiden || (m.id !== ich.id && ['mitarbeiter', 'polier'].includes(m.rolle) && (m.baustelleId == null || eigeneBs.includes(m.baustelleId)))));
    const codes = darfEntscheiden ? ['K', 'SW', 'U', 'ZA'] : ['SW'];
    const d = dialog({
      titel: darfEntscheiden ? 'Abwesenheit eintragen' : 'Schlechtwetter eintragen', breit: true,
      inhalt: `<form id="abw-e" class="stack-s">
        <div class="form-grid">
          <label class="field"><span class="field-label">Datum</span><input class="input lg" type="date" name="datum" required value="${heute}" min="${fmt.addTage(heute, darfEntscheiden ? -62 : -3)}"></label>
          <label class="field"><span class="field-label">Art</span><select class="input lg" name="code">${codes.map((c) => `<option value="${c}">${c} · ${CODES[c]}</option>`).join('')}</select></label>
        </div>
        <fieldset class="field"><legend class="field-label">Wer? ${darfEntscheiden ? '' : '(meine Partie)'}</legend>
          <div class="pick-multi">${wahl.length ? wahl.map((m) => `<label class="check-inline"><input type="checkbox" name="wer" value="${m.id}"> ${esc(m.name)}</label>`).join('') : '<p class="muted sm">Niemand zur Auswahl.</p>'}</div></fieldset>
        <p class="form-err" role="alert" hidden></p></form>`,
      fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="abw-e">Eintragen</button>',
    });
    $('#abw-e', d.el).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target); const m = $('.form-err', d.el);
      const wer = f.getAll('wer').map(Number);
      if (!wer.length) { m.hidden = false; m.textContent = 'Bitte mindestens eine Person auswählen.'; return; }
      const fehler = [];
      let wartend = 0;
      for (const id of wer) {
        try { const r = await post('/abwesenheiten', { benutzerId: id, datum: f.get('datum'), code: f.get('code') }); if (r && r.status === 'beantragt') wartend++; }
        catch (x) { fehler.push(`${(leute.find((l) => l.id === id) || {}).name || id}: ${x.message}`); }
      }
      if (fehler.length) { m.hidden = false; m.textContent = fehler.join(' · '); if (fehler.length < wer.length) neu(); return; }
      d.zu(); toast(wartend ? `${wer.length === 1 ? 'Eingetragen' : wer.length + ' Einträge'} – wartet auf Bestätigung durch Bauleitung oder Büro.` : wer.length === 1 ? 'Abwesenheit eingetragen.' : `${wer.length} Abwesenheiten eingetragen.`); neu();
    });
  }

  el.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-akt]');
    if (a && a.dataset.akt === 'antrag') return antragDialog();
    if (a && a.dataset.akt === 'eintragen') return eintragenDialog();
    const en = e.target.closest('[data-entscheid]');
    if (en) {
      en.disabled = true;
      try { await put(`/abwesenheiten/${en.dataset.id}`, { status: en.dataset.entscheid }); toast(en.dataset.entscheid === 'genehmigt' ? 'Antrag genehmigt.' : 'Antrag abgelehnt.'); neu(); }
      catch (x) { toast(x.message, 'warn'); en.disabled = false; }
      return;
    }
    const z = e.target.closest('[data-zurueckziehen]');
    if (z && await bestaetigen('Antrag zurückziehen?', 'Der Antrag wird gelöscht.', 'Zurückziehen')) {
      try { await del(`/abwesenheiten/${z.dataset.zurueckziehen}`); toast('Antrag zurückgezogen.'); neu(); } catch (x) { toast(x.message, 'warn'); }
      return;
    }
    const l = e.target.closest('[data-loeschen]');
    if (l && await bestaetigen('Abwesenheit löschen?', 'Der Eintrag wird entfernt und zählt nicht mehr in Auswertung und Export.', 'Löschen', 'danger')) {
      try { await del(`/abwesenheiten/${l.dataset.loeschen}`); toast('Abwesenheit gelöscht.'); neu(); } catch (x) { toast(x.message, 'warn'); }
    }
  });
  await lade();
  zeichne();
}
