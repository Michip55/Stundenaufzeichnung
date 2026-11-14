// Benutzer & Rechte: Rechte-Matrix (mit gesperrten Zellen), Ausnahmen je Benutzer, Benutzerverwaltung, Protokoll.
// Geschäftsführung: alles. Büro (Prüfbericht 2, C-14): nur Benutzer der Rollen Mitarbeiter/Polier/Bauleiter anlegen,
// PIN zurücksetzen und gesperrte Konten entsperren – keine Rechte-Matrix, kein Protokoll.
import { get, post, put, del } from '../api.js';
import { ic, esc, fmt, rolleText, ROLLEN, avatar, leer, banner, dialog, bestaetigen, toast, speicher, istIntern, $, $$ } from '../ui.js';
import { wienHeute } from '../zahl.js';
import { diensteTab } from './dienste.js';

export default async function benutzer(el, ctx) {
  const voll = ctx.kann('benutzer');
  const BUERO_ROLLEN = ['mitarbeiter', 'polier', 'bauleiter']; // diese Benutzer pflegt das Büro
  const BUERO_VERGIBT = ['mitarbeiter', 'polier'];             // D-02: die Rolle Bauleiter (€-Einsicht) vergibt nur die GF
  let r = {}, leute, lohngruppen = [], baustellen = [];
  let tab = !voll ? 'benutzer' : ctx.query.get('reiter') === 'dienste' ? 'dienste' : ['matrix', 'benutzer', 'dienste', 'protokoll'].includes(speicher.lies('bt_rechtetab')) ? speicher.lies('bt_rechtetab') : 'matrix';
  const darfBearbeiten = (m) => voll || BUERO_ROLLEN.includes(m.rolle); // rolle-ok: Rolle der ZIEL-Person (C-14, wie rechte.BUERO_VERWALTBAR am Server)
  const istGesperrt = (m) => !!(m.gesperrt || m.kontoGesperrt || m.sperre || m.gesperrtSeit);
  async function lade() {
    [r, leute, baustellen] = await Promise.all([voll ? get('/rechte') : {}, get('/benutzer'), get('/baustellen').catch(() => [])]);
    if (!lohngruppen.length && ctx.kann('preise_sehen')) { try { lohngruppen = (await get('/preise')).lohngruppen || []; } catch (e) { /* optional */ } }
  }
  await lade();
  // rolle-ok: Rollenwahl für die ZIEL-Person (nur die GF macht zum/vom Bauleiter, Server prüft)
  const rollen = (m) => (voll ? r.rollen || Object.keys(ROLLEN) : m && m.rolle === 'bauleiter' ? ['bauleiter'] : BUERO_VERGIBT).map((x) => (typeof x === 'string' ? { schluessel: x, name: rolleText(x) } : { schluessel: x.schluessel || x.id, name: x.name || x.text || rolleText(x.schluessel || x.id) }));
  const gesperrt = (rolle, recht) => ((r.gesperrt || {})[rolle] || []).includes(recht);
  const fest = (rolle, recht) => (rolle === 'gf' && recht === 'benutzer') || (((r.immer || {})[rolle]) || []).includes(recht);
  const rechtText = (k) => ((r.rechte || []).find((x) => x.schluessel === k) || {}).text || k;
  const name = (id) => (leute.find((m) => m.id === id) || {}).name || `Benutzer ${id}`;

  function matrixHtml() {
    const ro = rollen();
    return `
      ${banner('info', '<b>Gesperrte Felder</b> (Schloss) können für diese Rolle nie vergeben werden – auch nicht als Ausnahme. So bleiben Preise und Lohndaten vor Polier und Mitarbeitern verborgen.', 'lock')}
      <section class="card"><div class="tbl-wrap"><table class="tbl rights" id="matrix"><thead><tr><th>Recht</th>${ro.map((x) => `<th class="c">${esc(x.name)}</th>`).join('')}</tr></thead>
        <tbody>${(r.rechte || []).map((re) => `<tr><th scope="row">${esc(re.text)}<small>${esc(re.schluessel)}</small></th>${ro.map((x) => {
          const an = !!((r.matrix || {})[x.schluessel] || {})[re.schluessel];
          if (gesperrt(x.schluessel, re.schluessel)) return `<td class="c locked" data-rolle="${x.schluessel}" data-recht="${re.schluessel}" data-gesperrt><span class="lock-cell" role="img" aria-label="Gesperrt: für ${esc(x.name)} nicht vergebbar" title="Gesperrt – für ${esc(x.name)} nicht vergebbar">${ic('lock')}</span></td>`;
          const f = fest(x.schluessel, re.schluessel);
          return `<td class="c" data-rolle="${x.schluessel}" data-recht="${re.schluessel}"><label class="tgl" title="${f ? 'Immer aktiv – die Geschäftsführung kann sich nicht aussperren' : ''}"><input type="checkbox" class="vh" ${an ? 'checked' : ''} ${f ? 'disabled' : ''} aria-label="${esc(re.text)} für ${esc(x.name)}"><span class="switch" aria-hidden="true"></span></label></td>`;
        }).join('')}</tr>`).join('')}</tbody></table></div></section>
      <section class="card" aria-labelledby="h-aus">
        <div class="card-h pad-h"><h3 id="h-aus">Ausnahmen je Benutzer <span class="count">${(r.ausnahmen || []).length}</span></h3><button type="button" class="btn ghost sm" data-akt="ausnahme">${ic('plus')}Ausnahme</button></div>
        ${(r.ausnahmen || []).length ? `<ul class="plain rows" id="ausnahmen">${r.ausnahmen.map((a) => `<li data-b="${a.benutzerId}" data-r="${esc(a.recht)}">${avatar(a.name || name(a.benutzerId), 'sm')}<span class="grow"><b>${esc(a.name || name(a.benutzerId))}</b><small>${esc(rechtText(a.recht))}</small></span><button type="button" class="icon-btn sm" data-aus-weg aria-label="Ausnahme entfernen">${ic('trash')}</button></li>`).join('')}</ul>` : '<p class="muted sm pad-s">Keine Ausnahmen. Ausnahmen erweitern die Rechte einzelner Personen – z. B. ein Polier, der selbst freigeben darf.</p>'}
      </section>`;
  }
  function benutzerHtml() {
    const gesperrte = leute.filter(istGesperrt);
    const zeile = (m) => `<li class="${m.aktiv === false || m.aktiv === 0 ? 'inaktiv' : ''}" data-benutzer="${m.id}" ${istGesperrt(m) ? 'data-gesperrt' : ''}>${avatar(m.name, 'sm')}<span class="grow"><b>${esc(m.name)}</b><small>${esc(rolleText(m.rolle))}${m.pnr ? ' · Nr. ' + esc(m.pnr) : ''}${m.lohngruppe ? ' · ' + esc((lohngruppen.find((l) => l.id === m.lohngruppe) || {}).name || m.lohngruppe) : ''}${m.aktiv === false || m.aktiv === 0 ? ' · inaktiv' : ''}</small></span>
      ${istGesperrt(m) ? `<span class="chip st-red" title="${m.gesperrtBis ? 'läuft ab am ' + esc(fmt.zeitpunkt(m.gesperrtBis)) + ' Uhr' : ''}">${ic('lock')}Gesperrt${m.gesperrtBis ? ` bis ${esc(fmt.zeitpunkt(m.gesperrtBis).slice(0, 6))} ${esc(fmt.uhr(m.gesperrtBis))}` : ''}</span><button type="button" class="btn primary sm" data-entsperren="${m.id}">${darfBearbeiten(m) ? 'Entsperren' : 'Anmeldesperre aufheben'}</button>` : ''}
      ${darfBearbeiten(m) ? `<button type="button" class="btn ghost sm" data-bearb="${m.id}">${ic('edit')}Bearbeiten</button>` : '<span class="muted sm nw">Bearbeiten nur durch GF</span>'}</li>`;
    return `${!voll ? banner('info', 'Als Büro legen Sie Mitarbeiter, Poliere und Bauleiter an, setzen PINs zurück und entsperren Konten. Rollen Büro/Geschäftsführung und die Rechte-Matrix verwaltet die Geschäftsführung.', 'shield') : ''}
      ${gesperrte.length ? `<section class="card" id="gesperrte" aria-labelledby="h-gesp"><div class="card-h pad-h"><h3 id="h-gesp">${ic('lock')}Gesperrte Konten <span class="count red">${gesperrte.length}</span></h3></div><ul class="plain rows">${gesperrte.map(zeile).join('')}</ul><p class="card-note">Nach zu vielen falschen PIN-Eingaben wird ein Konto befristet gesperrt (24 Std., dann länger). „Entsperren“ hebt die Sperre sofort auf – das Büro auch für Konten von Büro und Geschäftsführung; wenn die PIN vergessen wurde, zusätzlich unter „Bearbeiten“ eine neue Start-PIN vergeben.</p></section>` : ''}
      <div class="toolbar"><span class="grow"></span><button type="button" class="btn primary" data-akt="neu">${ic('plus')}Neuer Benutzer</button></div>
      <section class="card">${leute.length ? `<ul class="plain rows" id="benutzerliste">${leute.map(zeile).join('')}</ul>` : leer('Keine Benutzer.', 'users')}</section>`;
  }
  function protokollHtml() {
    const p = r.protokoll || [];
    return `<section class="card">${p.length ? `<ul class="plain rows log" id="protokoll">${p.map((x) => `<li><span class="log-ic">${ic('shield')}</span><span class="grow"><b>${esc(x.text || [x.art, x.objekt].filter(Boolean).join(' · '))}</b><small>${esc(fmt.zeitpunkt(x.zeit))}${x.name || x.benutzerId ? ' · ' + esc(x.name || name(x.benutzerId)) : ''}</small></span></li>`).join('')}</ul>` : leer('Noch keine Einträge.', 'shield')}
      <p class="card-note">Das Protokoll ist unveränderbar – Einträge können weder geändert noch gelöscht werden.</p></section>`;
  }
  function zeichne() {
    const T = voll ? [['matrix', 'Rechte'], ['benutzer', 'Benutzer'], ['dienste', 'Dienste & Sicherheit'], ['protokoll', 'Protokoll']] : [['benutzer', 'Benutzer']];
    el.innerHTML = `<div class="page">
      <div class="tabs" role="tablist" aria-label="Bereiche">${T.map(([k, t]) => `<button type="button" role="tab" aria-selected="${k === tab}" class="${k === tab ? 'on' : ''}" data-tab="${k}">${t}</button>`).join('')}</div>
      <div class="stack" role="tabpanel" id="b-panel">${tab === 'matrix' ? matrixHtml() : tab === 'benutzer' ? benutzerHtml() : tab === 'dienste' ? '' : protokollHtml()}</div></div>`;
    if (tab === 'dienste') { const box = document.createElement('div'); $('#b-panel', el).appendChild(box); diensteTab(box, ctx); }
  }
  const neuLaden = async () => { await lade(); if (ctx.aktuell()) zeichne(); };

  function benutzerDialog(m) {
    const lg = lohngruppen.length ? `<select class="input lg" name="lohngruppe"><option value="">– keine –</option>${lohngruppen.map((l) => `<option value="${esc(l.id)}" ${m && (m.lohngruppe === l.id || m.lohngruppe === l.name || m.lohngruppeId === l.id) ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>`
      : `<input class="input lg" name="lohngruppe" value="${esc((m && m.lohngruppe) || '')}">`;
    const d = dialog({ titel: m ? 'Benutzer bearbeiten' : 'Neuer Benutzer', breit: true, inhalt: `<form id="bf" class="stack-s" autocomplete="off">
      <label class="field"><span class="field-label">Name</span><input class="input lg" name="name" required minlength="2" maxlength="80" value="${esc((m && m.name) || '')}"></label>
      <label class="field"><span class="field-label">Rolle</span><select class="input lg" name="rolle" ${!voll && m && m.rolle === 'bauleiter' /* rolle-ok: Rolle der ZIEL-Person (Anzeige), Server prüft */ ? 'disabled' : ''} aria-describedby="rolle-hinweis">${rollen(m).map((x) => `<option value="${x.schluessel}" ${m && m.rolle === x.schluessel ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      ${!voll ? '<p class="muted sm" id="rolle-hinweis">Die Rolle Bauleiter (gleiche Rechte wie das Büro) vergibt nur die Geschäftsführung. Über neue Benutzer und Rollenwechsel wird die Geschäftsführung benachrichtigt.</p>' : '<span id="rolle-hinweis" hidden></span>'}
      <div class="form-grid"><label class="field"><span class="field-label">Lohngruppe</span>${lg}</label>
      ${m && lohngruppen.length ? `<div class="field" id="lg-ab-box" hidden><label><span class="field-label">Neue Lohngruppe gültig ab</span><input class="input lg" type="date" name="lohngruppeGueltigAb" id="lg-ab" value="${m.lohngruppe || m.lohngruppeId ? wienHeute() : ''}" min="2000-01-01" aria-describedby="lg-anfang"></label><small class="muted" id="lg-anfang" hidden>Erste Lohngruppe: leer lassen = gilt von Anfang an – auch für bereits erfasste Stunden.</small><small class="price-err" id="lg-rueck" hidden>Ändert die Kosten bereits erfasster Tage ab diesem Datum – wird beim Speichern eigens bestätigt.</small></div>` : ''}
      <label class="field"><span class="field-label">Personalnummer</span><input class="input lg" name="pnr" inputmode="numeric" pattern="[0-9]{1,6}" maxlength="6" value="${esc((m && m.pnr) || '')}" placeholder="${m ? '' : 'wird automatisch vergeben'}"></label>
      <label class="field"><span class="field-label">Telefon (dienstlich)</span><input class="input lg" name="telefon" type="tel" inputmode="tel" maxlength="30" value="${esc((m && m.telefon) || '')}" placeholder="+43 664 …"></label></div>
      <label class="field"><span class="field-label">Stamm-Baustelle (Partie)</span><select class="input lg" name="baustelleId"><option value="">– keine –</option>${baustellen.filter((x) => (x.status !== 'abgeschlossen' && !istIntern(x)) || (m && m.baustelleId === x.id)).map((x) => `<option value="${x.id}" ${m && m.baustelleId === x.id ? 'selected' : ''}>${esc((x.kst ? x.kst + ' · ' : '') + x.name)}</option>`).join('')}</select></label>
      <label class="field"><span class="field-label">Standard-Kostenstelle beim Stempeln</span><select class="input lg" name="standardKostenstelleId" id="std-kst" aria-describedby="std-kst-hinweis"><option value="">– automatisch –</option>${baustellen.filter((x) => x.status !== 'abgeschlossen' || (m && m.standardKostenstelleId === x.id)).map((x) => `<option value="${x.id}" ${m && m.standardKostenstelleId === x.id ? 'selected' : ''}>${esc((x.kst ? x.kst + ' · ' : '') + x.name)}${istIntern(x) ? ' (intern)' : ''}</option>`).join('')}</select><small class="muted" id="std-kst-hinweis">Automatisch: Büro, Bauleiter und Geschäftsführung stempeln auf „Büro“, alle anderen auf ihre Stamm-Baustelle. Hier z. B. „Werkstatt“ fest vorgeben.</small></label>
      <label class="field"><span class="field-label">${m ? 'PIN zurücksetzen (leer lassen = unverändert)' : 'Start-PIN'}</span><input class="input lg" name="pin" inputmode="numeric" pattern="[0-9]{4,12}" maxlength="12" aria-describedby="pin-hinweis" ${m ? '' : 'required'} placeholder="••••" autocomplete="new-password"></label>
      <p class="muted sm" id="pin-hinweis">4 bis 12 Ziffern (Bauleiter, Büro und Geschäftsführung mindestens 6), keine Folgen wie 1234. Die Person muss die PIN bei der nächsten Anmeldung selbst ändern.</p>
      ${m ? `<button type="button" class="btn ghost sm" data-entsperren="${m.id}">${ic('lock')}Anmeldesperre aufheben</button>` : ''}
      ${m && voll && m.id !== ctx.ich.benutzer.id && ['bauleiter', 'buero', 'gf'].includes(m.rolle) ? `<button type="button" class="btn ghost sm" id="zf-reset">${ic('shield')}Zwei-Faktor zurücksetzen (Gerät verloren)</button>` : ''}
      ${m ? `<label class="switch-row flat"><span><b>Aktiv</b><small>Inaktive Benutzer können sich nicht anmelden.</small></span><input type="checkbox" class="vh" name="aktiv" ${m.aktiv === false || m.aktiv === 0 ? '' : 'checked'}><span class="switch" aria-hidden="true"></span></label>` : ''}
      <p class="form-err" role="alert" hidden></p></form>`,
      fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="bf">Speichern</button>' });
    const zfR = $('#zf-reset', d.el);
    if (zfR) zfR.addEventListener('click', async () => {
      zfR.disabled = true;
      try { await del(`/benutzer/${m.id}/2fa`); toast(`Zwei-Faktor von ${m.name} zurückgesetzt – die Person meldet sich wieder nur mit der PIN an bzw. richtet neu ein.`); }
      catch (x) { toast(x.message, 'warn'); zfR.disabled = false; }
    });
    const entB = $('[data-entsperren]', d.el);
    if (entB) entB.addEventListener('click', async () => {
      entB.disabled = true;
      try { await post(`/benutzer/${m.id}/entsperren`); toast('Konto entsperrt – Anmeldung ist wieder möglich.'); lade(); }
      catch (x) { toast(x.message, 'warn'); entB.disabled = false; }
    });
    const lgWahl = $('#bf [name="lohngruppe"]', d.el);
    const lgAlt = lgWahl ? lgWahl.value : '';
    const lgBox = $('#lg-ab-box', d.el);
    if (lgBox) {
      // N-078: erste Lohngruppe (keine bisherige, kein Verlauf) – Datum leer = gilt von Anfang an (Basisstand 2000-01-01, 12.22)
      let ersteLg = !lgAlt;
      const zeig = () => { lgBox.hidden = lgWahl.value === lgAlt; const ab = $('#lg-ab', d.el).value; $('#lg-anfang', d.el).hidden = !(ersteLg && !ab); $('#lg-rueck', d.el).hidden = !(ab && ab < wienHeute()); };
      lgWahl.addEventListener('change', zeig); $('#lg-ab', d.el).addEventListener('input', zeig);
      // Verlauf (vertraulich – nur wer die Lohngruppe sieht)
      const verlaufZeigen = (liste) => {
        if (liste.length && ersteLg) { ersteLg = false; if (!$('#lg-ab', d.el).value) $('#lg-ab', d.el).value = wienHeute(); zeig(); }
        let box = $('#lg-verlauf', d.el);
        if (!box) { box = document.createElement('div'); box.id = 'lg-verlauf'; box.className = 'stack-s'; $('#bf', d.el).appendChild(box); }
        box.innerHTML = `<h4 class="sub-h">Lohngruppen-Verlauf <span class="count">${liste.length}</span></h4><ul class="plain rows">${liste.slice().reverse().map((v) => `<li data-lg-stand="${v.id ?? ''}" class="${v.kuenftig ? 'geplant' : ''}"><span class="grow"><b>${esc(v.name || (v.lohngruppeId ? v.lohngruppeId : 'keine Lohngruppe'))}</b><small>${v.gueltigAb <= '2000-01-01' ? 'von Anfang an' : 'ab ' + esc(fmt.datum(v.gueltigAb))}${v.erstelltVon ? ' · ' + esc(v.erstelltVon.name) : ''}</small></span>${v.aktuell ? '<span class="chip xs st-green">gilt jetzt</span>' : v.kuenftig ? '<span class="chip xs st-blue">künftig</span>' : ''}${v.kuenftig && v.id != null ? `<button type="button" class="btn ghost sm" data-lg-weg="${v.id}">Zurücknehmen</button>` : ''}</li>`).join('')}</ul>`;
      };
      get(`/benutzer/${m.id}/lohngruppen-verlauf`).then(verlaufZeigen).catch(() => {});
      d.el.addEventListener('click', async (ev) => {
        const w = ev.target.closest('[data-lg-weg]'); if (!w) return;
        if (!(await bestaetigen('Künftige Lohngruppe zurücknehmen?', 'Der geplante Wechsel wird gelöscht; die bisherige Lohngruppe gilt weiter.', 'Zurücknehmen', 'danger'))) return;
        try { const r = await del(`/benutzer/${m.id}/lohngruppen-verlauf/${w.dataset.lgWeg}`); verlaufZeigen(r.lohngruppeVerlauf || []); toast('Geplanter Wechsel zurückgenommen.'); } catch (x) { toast(x.message, 'warn'); }
      });
    }
    $('#bf', d.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const lgNeu = f.get('lohngruppe') || null;
      const lgGeaendert = !m || (lgNeu || '') !== (lgAlt || '');
      const body = { name: f.get('name').trim(), rolle: f.get('rolle') || (m && m.rolle), ...(lgGeaendert ? { lohngruppe: lgNeu } : {}), baustelleId: f.get('baustelleId') ? Number(f.get('baustelleId')) : null, telefon: String(f.get('telefon') || '').trim() };
      { const std = f.get('standardKostenstelleId') ? Number(f.get('standardKostenstelleId')) : null; if (std !== ((m && m.standardKostenstelleId) || null)) body.standardKostenstelleId = std; } // 12.25
      if (f.get('pnr')) body.pnr = Number(f.get('pnr'));
      if (m && m.id === ctx.ich.benutzer.id) { delete body.rolle; } // eigene Rolle ändert niemand selbst
      if (f.get('pin')) body.pin = f.get('pin');
      if (m && m.id !== ctx.ich.benutzer.id) body.aktiv = f.get('aktiv') === 'on';
      if (m && body.rolle === m.rolle) delete body.rolle;
      // 12.22: Lohngruppe gilt ab einem Stichtag; ein Datum in der Vergangenheit ändert schon gerechnete Tage → ausdrücklich bestätigen
      if (m && lgGeaendert && f.get('lohngruppeGueltigAb')) {
        body.lohngruppeGueltigAb = f.get('lohngruppeGueltigAb');
        if (body.lohngruppeGueltigAb < wienHeute()) {
          if (!(await bestaetigen('Lohngruppe rückwirkend ändern?', `Ändert die Kosten bereits erfasster Tage ab diesem Datum (${fmt.datum(body.lohngruppeGueltigAb)}): Nachkalkulation, interne Kosten und Lohn-Auswertung werden neu gerechnet. Das wird protokolliert.`, 'Ja, rückwirkend ändern', 'danger'))) return;
          body.lohngruppeRueckwirkend = true;
        }
      }
      try {
        const antwort = m ? await put(`/benutzer/${m.id}`, body) : await post('/benutzer', body);
        d.zu(); toast(m ? 'Benutzer gespeichert.' : 'Benutzer angelegt.'); neuLaden();
        zeigeFolgen(antwort);
      }
      catch (x) { const err = $('.form-err', d.el); err.hidden = false; err.textContent = x.message; }
    });
  }
  // D-11: Nach einem Rollenwechsel meldet der Server gelöste Baustellen-Zuordnungen; D-02: Hinweis auf die Meldung an die GF
  function zeigeFolgen(a) {
    if (!a || typeof a !== 'object') return;
    const roh = a.zuordnungenEntfernt || [];
    const liste = Array.isArray(roh) ? roh : [];
    const hinweis = a.hinweis || (a.gfBenachrichtigt ? 'Die Geschäftsführung wurde benachrichtigt.' : '');
    if (!liste.length && !hinweis) return;
    const text = (z) => (typeof z === 'string' ? z : `${z.kst ? z.kst + ' · ' : ''}${z.name || (baustellen.find((b) => b.id === (z.baustelleId ?? z.id)) || {}).name || 'Baustelle ' + (z.baustelleId ?? z.id)}${z.feld || z.als ? ` (${/polier/i.test(z.feld || z.als) ? 'Polier' : 'Bauleiter'})` : ''}`);
    dialog({ titel: 'Hinweis zur Änderung', inhalt: `<div id="folgen">${liste.length ? `<p><b>${esc(a.name || 'Die Person')}</b> war diesen Baustellen zugeordnet. Die Zuordnung wurde wegen des Rollenwechsels gelöst – bitte neu besetzen:</p><ul class="plain" data-geloest>${liste.map((z) => `<li><span>${esc(text(z))}</span></li>`).join('')}</ul>` : ''}${hinweis ? `<p class="muted" data-gf-hinweis>${esc(hinweis)}</p>` : ''}</div>`, fuss: '<button class="btn primary" type="button" data-zu>Verstanden</button>' });
  }
  function ausnahmeDialog() {
    const d = dialog({ titel: 'Ausnahme vergeben', inhalt: `<form id="af" class="stack-s">
      <label class="field"><span class="field-label">Benutzer</span><select class="input lg" name="benutzerId" id="af-b">${leute.filter((m) => m.aktiv !== false && m.aktiv !== 0).map((m) => `<option value="${m.id}" data-rolle="${esc(m.rolle)}">${esc(m.name)} (${esc(rolleText(m.rolle))})</option>`).join('')}</select></label>
      <label class="field"><span class="field-label">Zusätzliches Recht</span><select class="input lg" name="recht" id="af-r"></select></label>
      <p class="muted sm">Gesperrte Rechte der jeweiligen Rolle stehen nicht zur Auswahl.</p><p class="form-err" role="alert" hidden></p></form>`,
      fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="af">Vergeben</button>' });
    const fuelle = () => { const rolle = $('#af-b', d.el).selectedOptions[0].dataset.rolle; $('#af-r', d.el).innerHTML = (r.rechte || []).map((re) => `<option value="${re.schluessel}" ${gesperrt(rolle, re.schluessel) ? 'disabled' : ''}>${esc(re.text)}${gesperrt(rolle, re.schluessel) ? ' (gesperrt)' : ''}</option>`).join(''); const frei = $$('#af-r option:not([disabled])', d.el)[0]; if (frei) frei.selected = true; };
    fuelle(); $('#af-b', d.el).addEventListener('change', fuelle);
    $('#af', d.el).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target);
      try { await put('/rechte/ausnahme', { benutzerId: Number(f.get('benutzerId')), recht: f.get('recht'), wert: true }); d.zu(); toast('Ausnahme vergeben.'); neuLaden(); }
      catch (x) { const err = $('.form-err', d.el); err.hidden = false; err.textContent = x.message; }
    });
  }

  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; speicher.setz('bt_rechtetab', tab); if (tab === 'protokoll') await lade(); zeichne(); return; }
    const a = e.target.closest('[data-akt]');
    if (a && a.dataset.akt === 'neu') return benutzerDialog(null);
    if (a && a.dataset.akt === 'ausnahme') return ausnahmeDialog();
    const ent = e.target.closest('[data-entsperren]');
    if (ent) {
      ent.disabled = true;
      try { await post(`/benutzer/${ent.dataset.entsperren}/entsperren`); toast('Konto entsperrt – Anmeldung ist wieder möglich.'); if (!ent.closest('dialog')) neuLaden(); else lade(); }
      catch (x) { toast(x.message, 'warn'); ent.disabled = false; }
      return;
    }
    const b = e.target.closest('[data-bearb]');
    if (b) return benutzerDialog(leute.find((m) => String(m.id) === b.dataset.bearb));
    const w = e.target.closest('[data-aus-weg]');
    if (w) { const li = w.closest('li'); try { await put('/rechte/ausnahme', { benutzerId: Number(li.dataset.b), recht: li.dataset.r, wert: false }); toast('Ausnahme entfernt.'); neuLaden(); } catch (x) { toast(x.message, 'warn'); } }
  });
  el.addEventListener('change', async (e) => {
    const td = e.target.closest('#matrix td[data-rolle]'); if (!td || td.hasAttribute('data-gesperrt')) return;
    const inp = e.target, wert = inp.checked;
    inp.disabled = true;
    try {
      await put('/rechte/matrix', { rolle: td.dataset.rolle, recht: td.dataset.recht, wert });
      r.matrix[td.dataset.rolle] = r.matrix[td.dataset.rolle] || {}; r.matrix[td.dataset.rolle][td.dataset.recht] = wert;
      toast(`${rechtText(td.dataset.recht)}: für ${rolleText(td.dataset.rolle)} ${wert ? 'eingeschaltet' : 'ausgeschaltet'}.`);
      get('/rechte').then((n) => { r = n; }).catch(() => {});
    } catch (x) { inp.checked = !wert; toast(x.message, 'warn'); }
    inp.disabled = false;
  });
  zeichne();
}
