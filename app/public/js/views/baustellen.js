// Baustellen: Liste und Detail (Stammdaten, Auftragssumme, Nachträge, Budget-Schwellen und Empfänger).
import { get, post, put, del } from '../api.js';
import { ic, esc, fmt, parseZahl, geldFelder, geldWert, starkOk, leer, banner, dialog, bestaetigen, toast, kalkChip, rolleText, $, $$ } from '../ui.js';

const STATUS = { geplant: ['Geplant', 'st-blue'], aktiv: ['Aktiv', 'st-green'], abgeschlossen: ['Abgeschlossen', 'st-grey'] };
const stChip = (s) => { const [t, c] = STATUS[s] || [s || '–', 'st-grey']; return `<span class="chip ${c}">${esc(t)}</span>`; };

// C-08: veralteter Stand → nichts überschreiben, Neu-Laden anbieten
function konfliktText(err, x, ctx, d) {
  if (x.status === 409 && x.daten && x.daten.version != null) {
    err.dataset.konflikt = '1';
    err.innerHTML = 'Inzwischen von jemand anderem geändert – Ihre Eingabe wurde nicht gespeichert. <button type="button" class="btn ghost sm" data-konflikt-laden>Neu laden</button>';
    err.querySelector('[data-konflikt-laden]').addEventListener('click', () => { if (d) d.zu(); ctx.neuLaden(); });
  } else err.textContent = x.message;
}
function stammDialog(ctx, leute, b) {
  const wahl = (feld, rollen) => `<select class="input lg" name="${feld}"><option value="">– niemand –</option>${leute.filter((m) => rollen.includes(m.rolle) && m.aktiv !== false && m.aktiv !== 0).map((m) => `<option value="${m.id}" ${b && b[feld] === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>`;
  const d = dialog({ titel: b ? 'Baustelle bearbeiten' : 'Neue Baustelle', breit: true, inhalt: `<form id="bsf" class="form-grid">
    <label class="field"><span class="field-label">Kostenstelle (KST)</span><input class="input lg" name="kst" required maxlength="20" value="${esc((b && b.kst) || '')}" placeholder="z. B. 26-050"></label>
    <label class="field"><span class="field-label">Status</span><select class="input lg" name="status">${Object.entries(STATUS).map(([k, [t]]) => `<option value="${k}" ${(b ? b.status : 'aktiv') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label class="field full"><span class="field-label">Bauvorhaben / Name</span><input class="input lg" name="name" required maxlength="120" value="${esc((b && b.name) || '')}"></label>
    <label class="field full"><span class="field-label">Auftraggeber</span><input class="input lg" name="auftraggeber" maxlength="120" value="${esc((b && b.auftraggeber) || '')}"></label>
    <label class="field full"><span class="field-label">Adresse der Baustelle</span><input class="input lg" name="adresse" maxlength="160" value="${esc((b && b.adresse) || '')}"></label>
    <label class="field"><span class="field-label">Polier</span>${wahl('polierId', ['polier'])}</label>
    <label class="field"><span class="field-label">Bauleiter</span>${wahl('bauleiterId', ['bauleiter', 'gf'])}</label>
    <fieldset class="field full"><legend class="field-label">Lage der Baustelle (für das Wetter)</legend><div class="form-grid">
      <label class="field"><span class="field-label">Breitengrad (lat)</span><input class="input lg num" name="lat" inputmode="decimal" value="${b && b.lat != null ? String(b.lat).replace('.', ',') : ''}" placeholder="z. B. 47,7333"></label>
      <label class="field"><span class="field-label">Längengrad (lng)</span><input class="input lg num" name="lng" inputmode="decimal" value="${b && b.lng != null ? String(b.lng).replace('.', ',') : ''}" placeholder="z. B. 16,1500"></label></div>
      <small class="muted">Dezimalgrad, z. B. aus der Karte am Handy (Punkt lange drücken). Leer = kein automatisches Wetter.</small></fieldset>
    <label class="field full"><span class="field-label">E-Mail des Auftraggebers (für den Bautagesbericht)</span><input class="input lg" name="agEmail" maxlength="300" value="${esc((b && b.agEmail) || '')}" placeholder="name@auftraggeber.at, weitere mit Komma"></label>
    <label class="switch-row flat full"><span><b>Unterschriebene Berichte automatisch senden</b><small>Als PDF ohne Preise – nur wenn der E-Mail-Versand eingerichtet ist.</small></span><input type="checkbox" class="vh" name="berichtMail" ${!b || b.berichtMail !== false ? 'checked' : ''}><span class="switch" aria-hidden="true"></span></label>
    <p class="form-err full" role="alert" hidden></p></form>`,
    fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="bsf">Speichern</button>' });
  $('#bsf', d.el).addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    const body = { kst: f.get('kst').trim(), name: f.get('name').trim(), auftraggeber: f.get('auftraggeber').trim(), adresse: f.get('adresse').trim(), status: f.get('status'), polierId: f.get('polierId') ? Number(f.get('polierId')) : null, bauleiterId: f.get('bauleiterId') ? Number(f.get('bauleiterId')) : null };
    // Koordinaten: Dezimalgrad mit Komma oder Punkt; leer = unbekannt
    const grad = (k) => { const roh = String(f.get(k) || '').trim().replace(',', '.'); return roh === '' ? null : Number(roh); };
    body.lat = grad('lat'); body.lng = grad('lng');
    if ((body.lat === null) !== (body.lng === null) || Number.isNaN(body.lat) || Number.isNaN(body.lng) || (body.lat !== null && (body.lat < 45 || body.lat > 50 || body.lng < 8 || body.lng > 18))) {
      const err = $('.form-err', d.el); err.hidden = false; err.textContent = 'Koordinaten bitte beide eintragen, als Dezimalgrad in Österreich (lat 45–50, lng 8–18) – oder beide leer lassen.'; return;
    }
    body.agEmail = String(f.get('agEmail') || '').trim(); body.berichtMail = f.get('berichtMail') === 'on';
    try {
      const neu = b ? await put(`/baustellen/${b.id}`, { ...body, version: b.version }) : await post('/baustellen', body);
      d.zu(); toast('Baustelle gespeichert.');
      if (!b && neu && neu.id) location.hash = `#/baustelle/${neu.id}`; else ctx.neuLaden();
    } catch (x) { const err = $('.form-err', d.el); err.hidden = false; konfliktText(err, x, ctx, d); }
  });
}

export async function baustellen(el, ctx) {
  const liste = await get('/baustellen');
  const darf = ctx.kann('stammdaten');
  let nurAktiv = true;
  function zeichne() {
    const sicht = liste.filter((b) => !nurAktiv || !b.status || b.status !== 'abgeschlossen');
    el.innerHTML = `<div class="page">
      <div class="toolbar"><label class="check-inline"><input type="checkbox" id="alle" ${nurAktiv ? '' : 'checked'}> Abgeschlossene anzeigen</label><span class="grow"></span>${darf ? `<button type="button" class="btn primary" id="neu">${ic('plus')}Neue Baustelle</button>` : ''}</div>
      ${sicht.length ? `<div class="site-cards">${sicht.map((b) => `<a class="card pad site-card" href="#/baustelle/${b.id}">
        <div class="kc-h"><div><small>${esc(b.kst || '')}</small><b>${esc(b.name)}</b></div>${stChip(b.status)}</div>
        <p class="muted sm">${esc(b.auftraggeber || '')}</p><p class="muted sm">${ic('pin', 'xs')} ${esc(b.adresse || '–')}</p>
        ${b.budgetVerbrauchProzent != null ? `<div class="site-bud"><span class="meter"><i data-st="width:${Math.min(100, b.budgetVerbrauchProzent)}%" class="${b.budgetVerbrauchProzent >= 100 ? 'red' : b.budgetVerbrauchProzent >= 80 ? 'amber' : ''}"></i></span><small>Budget ${fmt.pct(b.budgetVerbrauchProzent)}${b.leistungsstandProzent != null ? ' · Leistung ' + fmt.pct(b.leistungsstandProzent) : ''}</small></div>` : ''}
      </a>`).join('')}</div>` : `<div class="card">${leer('Keine Baustellen vorhanden.', 'pin')}</div>`}
    </div>`;
  }
  el.addEventListener('change', (e) => { if (e.target.id === 'alle') { nurAktiv = !e.target.checked; zeichne(); } });
  el.addEventListener('click', async (e) => { if (e.target.closest('#neu')) stammDialog(ctx, await get('/mitarbeiter'), null); });
  zeichne();
}

export async function baustelle(el, ctx) {
  const id = ctx.params[0];
  const mitKalk = ctx.kann('kalk_sehen');
  const [b, leute] = await Promise.all([get(`/baustellen/${id}`), get('/mitarbeiter').catch(() => [])]);
  // Nachkalkulation nur abfragen, wenn der Server für diese Baustelle Budgetdaten liefert (fremde Baustellen: nein)
  const kalk = mitKalk && ('schwellen' in b || 'budgetVerbrauchProzent' in b) ? await get(`/kalkulation/${id}`).catch((e) => (e.status === 403 ? null : Promise.reject(e))) : null;
  ctx.titel(b.name || 'Baustelle', b.kst || '');
  const darfStamm = ctx.kann('stammdaten'), darfAuftrag = ctx.kann('preise_bearbeiten');
  const name = (pid) => (leute.find((m) => m.id === pid) || {}).name || '–';
  const auftragssumme = b.auftragssumme ?? (kalk && kalk.auftragssumme);
  const schwellen = b.schwellen || (kalk && kalk.schwellen) || [80, 90, 100];
  const empf = b.empfaenger || { bauleiter: true, buero: true, gf: true };
  const nachtraege = b.nachtraege || (kalk && kalk.nachtraege) || [];
  // N-07: Abschnitt nur zeigen, wenn der Server Budgetdaten für diese Baustelle liefert (nicht bei fremden Baustellen)
  const zeigAuftrag = 'auftragssumme' in b || 'schwellen' in b || !!kalk;

  el.innerHTML = `
  <div class="page">
    <div class="form-top"><a class="link-back" href="#/baustellen">${ic('left')}Alle Baustellen</a><span class="grow"></span>${stChip(b.status)}${kalk ? kalkChip(kalk.status) : ''}</div>
    <div class="two-col">
      <section class="card" aria-labelledby="h-stamm">
        <div class="card-h pad-h"><h3 id="h-stamm">Stammdaten</h3>${darfStamm ? `<button type="button" class="btn ghost sm" data-akt="stamm">${ic('edit')}Bearbeiten</button>` : ''}</div>
        <dl class="def-list"><div><dt>Kostenstelle</dt><dd>${esc(b.kst || '–')}</dd></div><div><dt>Bauvorhaben</dt><dd>${esc(b.name || '–')}</dd></div><div><dt>Auftraggeber</dt><dd>${esc(b.auftraggeber || '–')}</dd></div><div><dt>Adresse</dt><dd>${esc(b.adresse || '–')}</dd></div><div><dt>Polier</dt><dd>${esc(b.polierName || name(b.polierId))}</dd></div><div><dt>Bauleiter</dt><dd>${esc(b.bauleiterName || name(b.bauleiterId))}</dd></div><div><dt>Lage (Wetter)</dt><dd data-koordinaten>${b.lat != null && b.lng != null ? `${String(b.lat).replace('.', ',')} / ${String(b.lng).replace('.', ',')}` : 'nicht eingetragen'}</dd></div>${'agEmail' in b ? `<div><dt>Bericht per E-Mail an</dt><dd>${esc(b.agEmail || '–')}${b.agEmail && b.berichtMail === false ? ' (automatischer Versand aus)' : ''}</dd></div>` : ''}</dl>
        <div class="card-actions"><a class="btn ghost sm" href="#/berichte?baustelleId=${id}">${ic('clipboard')}Bautagesberichte</a>${kalk ? `<a class="btn ghost sm" href="#/kalkulation/${id}">${ic('chart')}Nachkalkulation</a>` : ''}</div>
      </section>
      ${zeigAuftrag ? `<section class="card" aria-labelledby="h-auf">
        <div class="card-h pad-h"><h3 id="h-auf">Auftrag &amp; Budget-Alarm</h3></div>
        <form id="auftrag" class="pad stack-s">
          <label class="field"><span class="field-label">Auftragssumme in Euro (netto)</span><input class="input lg num" name="auftragssumme" data-geld="leer" inputmode="decimal" autocomplete="off" value="${auftragssumme != null ? fmt.betrag(auftragssumme) : ''}" placeholder="noch nicht erfasst" ${darfAuftrag ? '' : 'disabled'}></label>
          <fieldset class="field"><legend class="field-label">Warnschwellen (Budget-Verbrauch in %)</legend><div class="thr">${[0, 1, 2].map((i) => `<label><span class="vh">Schwelle ${i + 1}</span><input class="input num" name="s${i}" inputmode="numeric" value="${schwellen[i] ?? ''}" ${darfAuftrag ? '' : 'disabled'}><span>%</span></label>`).join('')}</div></fieldset>
          <fieldset class="field"><legend class="field-label">Wer wird benachrichtigt?</legend><div class="chk-row">${['bauleiter', 'buero', 'gf'].map((r) => `<label class="check-inline"><input type="checkbox" name="e_${r}" ${empf[r] !== false ? 'checked' : ''} ${darfAuftrag ? '' : 'disabled'}> ${esc(rolleText(r))}</label>`).join('')}</div>
            <small class="muted">Polier und Mitarbeiter erhalten nie Budget-Meldungen. Derzeit nur in der App – Push und E-Mail sind noch nicht angebunden.</small></fieldset>
          <p class="form-err" role="alert" hidden></p>
          ${darfAuftrag ? `<button type="submit" class="btn primary" id="auftrag-ok">${ic('check')}Auftrag speichern</button>` : ''}
        </form>
        <div class="card-h pad-h bt"><h3>Nachträge <span class="count">${nachtraege.length}</span></h3>${darfAuftrag ? `<button type="button" class="btn ghost sm" data-akt="nachtrag">${ic('plus')}Nachtrag</button>` : ''}</div>
        ${nachtraege.length ? `<ul class="plain rows" id="nachtraege">${nachtraege.map((n) => `<li><span class="grow"><b>${esc(n.text)}</b></span><b class="num">${fmt.eur(n.betrag)}</b>${darfAuftrag ? `<button type="button" class="icon-btn sm" data-nt-weg="${n.id}" aria-label="Nachtrag ${esc(n.text)} löschen">${ic('trash')}</button>` : ''}</li>`).join('')}</ul>` : '<p class="muted sm pad-s">Keine Nachträge.</p>'}
        ${kalk ? `<dl class="def-list bt"><div><dt>Auftrag gesamt</dt><dd class="num">${fmt.eur(kalk.auftragGesamt)}</dd></div><div><dt>Kosten bisher</dt><dd class="num">${fmt.eur(kalk.kosten && kalk.kosten.gesamt)}</dd></div><div><dt>Budget verbraucht</dt><dd class="num" data-wert="verbrauch">${fmt.pct(kalk.budgetVerbrauchProzent)}</dd></div></dl>` : ''}
      </section>` : ''}
    </div>
  </div>`;

  el.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-akt]');
    if (a && a.dataset.akt === 'stamm') return stammDialog(ctx, leute, b);
    if (a && a.dataset.akt === 'nachtrag') {
      const d = dialog({ titel: 'Nachtrag erfassen', inhalt: `<form id="ntf" class="stack-s"><label class="field"><span class="field-label">Bezeichnung</span><input class="input lg" name="text" required maxlength="200"></label><label class="field"><span class="field-label">Betrag in Euro (netto)</span><input class="input lg num" name="betrag" data-geld data-negativ="ja" inputmode="decimal" autocomplete="off" required placeholder="0,00"></label><p class="form-err" role="alert" hidden></p></form>`, fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="ntf">Speichern</button>' });
      geldFelder(d.el);
      $('#ntf', d.el).addEventListener('submit', async (ev) => {
        ev.preventDefault(); const f = new FormData(ev.target); const betrag = geldWert(ev.target.elements.betrag); const err = $('.form-err', d.el);
        if (!Number.isFinite(betrag) || betrag === 0) { err.hidden = false; err.textContent = 'Betrag unklar – bitte so schreiben: 12.500,00'; ev.target.elements.betrag.focus(); return; }
        try { await post(`/baustellen/${id}/nachtraege`, { text: f.get('text').trim(), betrag }); d.zu(); toast('Nachtrag gespeichert.'); ctx.neuLaden(); ctx.meldungenNeu(); } catch (x) { err.hidden = false; err.textContent = x.message; }
      });
      return;
    }
    const w = e.target.closest('[data-nt-weg]');
    if (w && await bestaetigen('Nachtrag löschen?', 'Der Nachtrag wird aus der Auftragssumme herausgerechnet.', 'Löschen', 'danger')) {
      try { await del(`/baustellen/${id}/nachtraege/${w.dataset.ntWeg}`); toast('Nachtrag gelöscht.'); ctx.neuLaden(); ctx.meldungenNeu(); } catch (x) { toast(x.message, 'warn'); }
    }
  });
  const form = $('#auftrag', el);
  geldFelder(el);
  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault(); if (!darfAuftrag) return;
    const f = new FormData(form), err = $('.form-err', form);
    const summe = geldWert(form.elements.auftragssumme); // null = Auftragssumme löschen (N-09)
    const sw = [0, 1, 2].map((i) => parseZahl(f.get('s' + i))).filter((n) => isFinite(n));
    if (Number.isNaN(summe)) { err.hidden = false; err.textContent = 'Auftragssumme unklar – bitte so schreiben: 250.000,00'; form.elements.auftragssumme.focus(); return; }
    if (!(await starkOk(auftragssumme, summe, 'Die Auftragssumme'))) return;
    if (summe === null && auftragssumme != null && !(await bestaetigen('Auftragssumme löschen?', 'Ohne Auftragssumme gibt es keinen Budget-Verbrauch und keinen Budget-Alarm für diese Baustelle.', 'Löschen', 'danger'))) return;
    if (sw.length !== 3 || sw.some((n) => n <= 0 || n > 200)) { err.hidden = false; err.textContent = 'Bitte drei Schwellen zwischen 1 und 200 % eingeben.'; return; }
    err.hidden = true; $('#auftrag-ok', form).disabled = true;
    try {
      await put(`/baustellen/${id}/auftrag`, { version: b.version, auftragssumme: summe, schwellen: sw.sort((x, y) => x - y), empfaenger: { bauleiter: f.get('e_bauleiter') === 'on', buero: f.get('e_buero') === 'on', gf: f.get('e_gf') === 'on' } });
      toast(summe === null ? 'Auftrag gespeichert – ohne Auftragssumme.' : `Auftrag gespeichert: ${fmt.eur(summe)}.`); await ctx.meldungenNeu(); ctx.neuLaden();
    } catch (x) { err.hidden = false; konfliktText(err, x, ctx, null); $('#auftrag-ok', form).disabled = false; }
  });
}
