// Benutzer & Rechte: Rechte-Matrix (mit gesperrten Zellen), Ausnahmen je Benutzer, Benutzerverwaltung, Protokoll.
// Geschäftsführung: alles. Büro (Prüfbericht 2, C-14): nur Benutzer der Rollen Mitarbeiter/Polier/Bauleiter anlegen,
// PIN zurücksetzen und gesperrte Konten entsperren – keine Rechte-Matrix, kein Protokoll.
import { get, post, put } from '../api.js';
import { ic, esc, fmt, rolleText, ROLLEN, avatar, leer, banner, dialog, toast, speicher, $, $$ } from '../ui.js';

export default async function benutzer(el, ctx) {
  const voll = ctx.kann('benutzer');
  const BUERO_ROLLEN = ['mitarbeiter', 'polier', 'bauleiter']; // diese Benutzer pflegt das Büro
  const BUERO_VERGIBT = ['mitarbeiter', 'polier'];             // D-02: die Rolle Bauleiter (€-Einsicht) vergibt nur die GF
  let r = {}, leute, lohngruppen = [], baustellen = [];
  let tab = !voll ? 'benutzer' : ['matrix', 'benutzer', 'protokoll'].includes(speicher.lies('bt_rechtetab')) ? speicher.lies('bt_rechtetab') : 'matrix';
  const darfBearbeiten = (m) => voll || BUERO_ROLLEN.includes(m.rolle);
  const istGesperrt = (m) => !!(m.gesperrt || m.kontoGesperrt || m.sperre || m.gesperrtSeit);
  async function lade() {
    [r, leute, baustellen] = await Promise.all([voll ? get('/rechte') : {}, get('/benutzer'), get('/baustellen').catch(() => [])]);
    if (!lohngruppen.length && ctx.kann('preise_sehen')) { try { lohngruppen = (await get('/preise')).lohngruppen || []; } catch (e) { /* optional */ } }
  }
  await lade();
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
    const T = voll ? [['matrix', 'Rechte'], ['benutzer', 'Benutzer'], ['protokoll', 'Protokoll']] : [['benutzer', 'Benutzer']];
    el.innerHTML = `<div class="page">
      <div class="tabs" role="tablist" aria-label="Bereiche">${T.map(([k, t]) => `<button type="button" role="tab" aria-selected="${k === tab}" class="${k === tab ? 'on' : ''}" data-tab="${k}">${t}</button>`).join('')}</div>
      <div class="stack" role="tabpanel">${tab === 'matrix' ? matrixHtml() : tab === 'benutzer' ? benutzerHtml() : protokollHtml()}</div></div>`;
  }
  const neuLaden = async () => { await lade(); if (ctx.aktuell()) zeichne(); };

  function benutzerDialog(m) {
    const lg = lohngruppen.length ? `<select class="input lg" name="lohngruppe"><option value="">– keine –</option>${lohngruppen.map((l) => `<option value="${esc(l.id)}" ${m && (m.lohngruppe === l.id || m.lohngruppe === l.name || m.lohngruppeId === l.id) ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>`
      : `<input class="input lg" name="lohngruppe" value="${esc((m && m.lohngruppe) || '')}">`;
    const d = dialog({ titel: m ? 'Benutzer bearbeiten' : 'Neuer Benutzer', breit: true, inhalt: `<form id="bf" class="stack-s" autocomplete="off">
      <label class="field"><span class="field-label">Name</span><input class="input lg" name="name" required minlength="2" maxlength="80" value="${esc((m && m.name) || '')}"></label>
      <label class="field"><span class="field-label">Rolle</span><select class="input lg" name="rolle" ${!voll && m && m.rolle === 'bauleiter' ? 'disabled' : ''} aria-describedby="rolle-hinweis">${rollen(m).map((x) => `<option value="${x.schluessel}" ${m && m.rolle === x.schluessel ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      ${!voll ? '<p class="muted sm" id="rolle-hinweis">Die Rolle Bauleiter (mit Einsicht in Preise der eigenen Baustellen) vergibt nur die Geschäftsführung. Über neue Benutzer und Rollenwechsel wird die Geschäftsführung benachrichtigt.</p>' : '<span id="rolle-hinweis" hidden></span>'}
      <div class="form-grid"><label class="field"><span class="field-label">Lohngruppe</span>${lg}</label>
      <label class="field"><span class="field-label">Personalnummer</span><input class="input lg" name="pnr" inputmode="numeric" pattern="[0-9]{1,6}" maxlength="6" value="${esc((m && m.pnr) || '')}" placeholder="${m ? '' : 'wird automatisch vergeben'}"></label></div>
      <label class="field"><span class="field-label">Stamm-Baustelle (Partie)</span><select class="input lg" name="baustelleId"><option value="">– keine –</option>${baustellen.filter((x) => x.status !== 'abgeschlossen' || (m && m.baustelleId === x.id)).map((x) => `<option value="${x.id}" ${m && m.baustelleId === x.id ? 'selected' : ''}>${esc((x.kst ? x.kst + ' · ' : '') + x.name)}</option>`).join('')}</select></label>
      <label class="field"><span class="field-label">${m ? 'PIN zurücksetzen (leer lassen = unverändert)' : 'Start-PIN'}</span><input class="input lg" name="pin" inputmode="numeric" pattern="[0-9]{4,12}" maxlength="12" aria-describedby="pin-hinweis" ${m ? '' : 'required'} placeholder="••••" autocomplete="new-password"></label>
      <p class="muted sm" id="pin-hinweis">4 bis 12 Ziffern (Bauleiter, Büro und Geschäftsführung mindestens 6), keine Folgen wie 1234. Die Person muss die PIN bei der nächsten Anmeldung selbst ändern.</p>
      ${m ? `<button type="button" class="btn ghost sm" data-entsperren="${m.id}">${ic('lock')}Anmeldesperre aufheben</button>` : ''}
      ${m ? `<label class="switch-row flat"><span><b>Aktiv</b><small>Inaktive Benutzer können sich nicht anmelden.</small></span><input type="checkbox" class="vh" name="aktiv" ${m.aktiv === false || m.aktiv === 0 ? '' : 'checked'}><span class="switch" aria-hidden="true"></span></label>` : ''}
      <p class="form-err" role="alert" hidden></p></form>`,
      fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="bf">Speichern</button>' });
    const entB = $('[data-entsperren]', d.el);
    if (entB) entB.addEventListener('click', async () => {
      entB.disabled = true;
      try { await post(`/benutzer/${m.id}/entsperren`); toast('Konto entsperrt – Anmeldung ist wieder möglich.'); lade(); }
      catch (x) { toast(x.message, 'warn'); entB.disabled = false; }
    });
    $('#bf', d.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const body = { name: f.get('name').trim(), rolle: f.get('rolle') || (m && m.rolle), lohngruppe: f.get('lohngruppe') || null, baustelleId: f.get('baustelleId') ? Number(f.get('baustelleId')) : null };
      if (f.get('pnr')) body.pnr = Number(f.get('pnr'));
      if (m && m.id === ctx.ich.benutzer.id) { delete body.rolle; } // eigene Rolle ändert niemand selbst
      if (f.get('pin')) body.pin = f.get('pin');
      if (m && m.id !== ctx.ich.benutzer.id) body.aktiv = f.get('aktiv') === 'on';
      if (m && body.rolle === m.rolle) delete body.rolle;
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
