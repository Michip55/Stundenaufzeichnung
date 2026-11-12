// Benutzer & Rechte: Rechte-Matrix (mit gesperrten Zellen), Ausnahmen je Benutzer, Benutzerverwaltung, Protokoll.
import { get, post, put } from '../api.js';
import { ic, esc, fmt, rolleText, ROLLEN, avatar, leer, banner, dialog, toast, speicher, $, $$ } from '../ui.js';

export default async function benutzer(el, ctx) {
  let r, leute, lohngruppen = [];
  let tab = ['matrix', 'benutzer', 'protokoll'].includes(speicher.lies('bt_rechtetab')) ? speicher.lies('bt_rechtetab') : 'matrix';
  async function lade() {
    [r, leute] = await Promise.all([get('/rechte'), get('/mitarbeiter')]);
    if (!lohngruppen.length && ctx.kann('preise_sehen')) { try { lohngruppen = (await get('/preise')).lohngruppen || []; } catch (e) { /* optional */ } }
  }
  await lade();
  const rollen = () => (r.rollen || Object.keys(ROLLEN)).map((x) => (typeof x === 'string' ? { schluessel: x, name: rolleText(x) } : { schluessel: x.schluessel || x.id, name: x.name || x.text || rolleText(x.schluessel || x.id) }));
  const gesperrt = (rolle, recht) => ((r.gesperrt || {})[rolle] || []).includes(recht);
  const fest = (rolle, recht) => rolle === 'gf' && recht === 'benutzer';
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
    return `<div class="toolbar"><span class="grow"></span><button type="button" class="btn primary" data-akt="neu">${ic('plus')}Neuer Benutzer</button></div>
      <section class="card">${leute.length ? `<ul class="plain rows" id="benutzerliste">${leute.map((m) => `<li class="${m.aktiv === false || m.aktiv === 0 ? 'inaktiv' : ''}">${avatar(m.name, 'sm')}<span class="grow"><b>${esc(m.name)}</b><small>${esc(rolleText(m.rolle))}${m.lohngruppe ? ' · ' + esc(m.lohngruppe) : ''}${m.aktiv === false || m.aktiv === 0 ? ' · inaktiv' : ''}</small></span><button type="button" class="btn ghost sm" data-bearb="${m.id}">${ic('edit')}Bearbeiten</button></li>`).join('')}</ul>` : leer('Keine Benutzer.', 'users')}</section>`;
  }
  function protokollHtml() {
    const p = r.protokoll || [];
    return `<section class="card">${p.length ? `<ul class="plain rows log" id="protokoll">${p.map((x) => `<li><span class="log-ic">${ic('shield')}</span><span class="grow"><b>${esc(x.text || [x.art, x.objekt].filter(Boolean).join(' · '))}</b><small>${esc(fmt.zeitpunkt(x.zeit))}${x.benutzer || x.benutzerName || x.benutzerId ? ' · ' + esc(x.benutzerName || (typeof x.benutzer === 'string' ? x.benutzer : x.benutzer && x.benutzer.name) || name(x.benutzerId)) : ''}${x.alt != null || x.neu != null ? ` · ${esc(String(x.alt ?? '–'))} → ${esc(String(x.neu ?? '–'))}` : ''}</small></span></li>`).join('')}</ul>` : leer('Noch keine Einträge.', 'shield')}
      <p class="card-note">Das Protokoll ist unveränderbar – Einträge können weder geändert noch gelöscht werden.</p></section>`;
  }
  function zeichne() {
    const T = [['matrix', 'Rechte'], ['benutzer', 'Benutzer'], ['protokoll', 'Protokoll']];
    el.innerHTML = `<div class="page">
      <div class="tabs" role="tablist" aria-label="Bereiche">${T.map(([k, t]) => `<button type="button" role="tab" aria-selected="${k === tab}" class="${k === tab ? 'on' : ''}" data-tab="${k}">${t}</button>`).join('')}</div>
      <div class="stack" role="tabpanel">${tab === 'matrix' ? matrixHtml() : tab === 'benutzer' ? benutzerHtml() : protokollHtml()}</div></div>`;
  }
  const neuLaden = async () => { await lade(); if (ctx.aktuell()) zeichne(); };

  function benutzerDialog(m) {
    const lg = lohngruppen.length ? `<select class="input lg" name="lohngruppe"><option value="">– keine –</option>${lohngruppen.map((l) => `<option value="${esc(l.id)}" ${m && (m.lohngruppe === l.id || m.lohngruppe === l.name || m.lohngruppeId === l.id) ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>`
      : `<input class="input lg" name="lohngruppe" value="${esc((m && m.lohngruppe) || '')}">`;
    const d = dialog({ titel: m ? 'Benutzer bearbeiten' : 'Neuer Benutzer', inhalt: `<form id="bf" class="stack-s" autocomplete="off">
      <label class="field"><span class="field-label">Name</span><input class="input lg" name="name" required minlength="2" maxlength="80" value="${esc((m && m.name) || '')}"></label>
      <label class="field"><span class="field-label">Rolle</span><select class="input lg" name="rolle">${rollen().map((x) => `<option value="${x.schluessel}" ${m && m.rolle === x.schluessel ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <label class="field"><span class="field-label">Lohngruppe</span>${lg}</label>
      <label class="field"><span class="field-label">${m ? 'Neue PIN (leer lassen = unverändert)' : 'PIN (4 Ziffern)'}</span><input class="input lg" name="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" ${m ? '' : 'required'} placeholder="••••" autocomplete="new-password"></label>
      ${m ? `<label class="switch-row flat"><span><b>Aktiv</b><small>Inaktive Benutzer können sich nicht anmelden.</small></span><input type="checkbox" class="vh" name="aktiv" ${m.aktiv === false || m.aktiv === 0 ? '' : 'checked'}><span class="switch" aria-hidden="true"></span></label>` : ''}
      <p class="form-err" role="alert" hidden></p></form>`,
      fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="bf">Speichern</button>' });
    $('#bf', d.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const body = { name: f.get('name').trim(), rolle: f.get('rolle'), lohngruppe: f.get('lohngruppe') || null };
      if (f.get('pin')) body.pin = f.get('pin');
      if (m) body.aktiv = f.get('aktiv') === 'on';
      try { if (m) await put(`/benutzer/${m.id}`, body); else await post('/benutzer', body); d.zu(); toast(m ? 'Benutzer gespeichert.' : 'Benutzer angelegt.'); neuLaden(); }
      catch (x) { const err = $('.form-err', d.el); err.hidden = false; err.textContent = x.message; }
    });
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
