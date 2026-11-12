// Bautagesberichte: Liste und Bearbeitung.
// Handy: Schritt-für-Schritt-Assistent. Tablet/PC: Formular im Aufbau der Papiervorlage.
import { get, post, put, del } from '../api.js';
import { ic, esc, fmt, parseZahl, laden, leer, banner, dialog, bestaetigen, toast, statusChip, entprellt, integBtn, $, $$ } from '../ui.js';
import { stundenAus, personalFehler, bloecke } from '../zahl.js';

/* =================== Liste =================== */
export async function berichte(el, ctx) {
  const [baustellen, integ] = await Promise.all([get('/baustellen'), ctx.integrationen()]);
  const bsVon = (b) => { const k = baustellen.find((x) => x.id === b.baustelleId) || {}; return typeof b.baustelle === 'object' && b.baustelle ? b.baustelle : { ...k, name: (typeof b.baustelle === 'string' && b.baustelle) || k.name, kst: b.kst || k.kst }; };
  const f = { baustelleId: ctx.query.get('baustelleId') || '', status: ctx.query.get('status') || '' };
  const darfNeu = ctx.kann('bericht_erstellen');

  el.innerHTML = `
  <div class="page">
    <div class="toolbar">
      <label class="field inline"><span class="vh">Baustelle</span><select class="input" id="f-bs"><option value="">Alle Baustellen</option>${baustellen.map((b) => `<option value="${b.id}" ${String(b.id) === f.baustelleId ? 'selected' : ''}>${esc((b.kst ? b.kst + ' · ' : '') + b.name)}</option>`).join('')}</select></label>
      <label class="field inline"><span class="vh">Status</span><select class="input" id="f-st"><option value="">Alle Status</option><option value="entwurf">Entwurf</option><option value="unterschrieben">Unterschrieben – zur Freigabe</option><option value="freigegeben">Freigegeben</option></select></label>
      <span class="grow"></span>
      ${darfNeu ? `<button type="button" class="btn primary" id="neu">${ic('plus')}Neuer Bericht</button>` : ''}
    </div>
    <section class="card" id="liste" aria-live="polite">${laden()}</section>
    ${darfNeu ? `<div class="integ-row">${integBtn(integ, 'scan_papier', 'Papier-Bericht scannen', 'camera')}</div>` : ''}
  </div>`;
  $('#f-st', el).value = f.status;

  async function ladeListe() {
    const box = $('#liste', el);
    box.innerHTML = laden();
    const q = new URLSearchParams();
    if (f.baustelleId) q.set('baustelleId', f.baustelleId);
    if (f.status) q.set('status', f.status);
    let liste;
    try { liste = await get('/berichte' + (q.toString() ? '?' + q : '')); }
    catch (e) { box.innerHTML = `<div class="state">${ic('alert')}<p>${esc(e.message)}</p><button class="btn ghost sm" type="button" data-nochmal>Erneut versuchen</button></div>`; return; }
    if (!ctx.aktuell()) return;
    liste.sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : b.id - a.id));
    box.innerHTML = liste.length ? `<ul class="rep-list">${liste.map((b) => {
      const bs = bsVon(b);
      const u = b.unterschriften || {};
      return `<li><a class="rep-row" href="#/bericht/${b.id}" data-status="${esc(b.status)}">
        <span class="rep-date"><b>${esc(fmt.datumKurz(b.datum))}</b><small>${fmt.dt(b.datum).getFullYear()}</small></span>
        <span class="rep-txt"><b>${esc(bs.name || b.baustelleName || 'Baustelle')}</b><small>${esc([bs.kst || b.kst, bs.auftraggeber].filter(Boolean).join(' · '))}</small></span>
        <span class="rep-meta">${b.stunden != null ? `<span class="muted sm nw">${fmt.zahl(b.stunden)} Std.</span>` : ''}${b.unterschriften ? `<span class="muted sm nw" title="Unterschriften">${ic('sign')}${(u.an ? 1 : 0) + (u.bh ? 1 : 0)}/2</span>` : ''}${statusChip(b.status)}</span>
        ${ic('right')}</a></li>`;
    }).join('')}</ul>` : leer(f.status || f.baustelleId ? 'Keine Berichte für diese Auswahl.' : 'Noch kein Bautagesbericht vorhanden.', 'clipboard');
  }
  el.addEventListener('change', (e) => {
    if (e.target.id === 'f-bs') { f.baustelleId = e.target.value; ladeListe(); }
    if (e.target.id === 'f-st') { f.status = e.target.value; ladeListe(); }
  });
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-nochmal]')) ladeListe();
    if (e.target.closest('#neu')) neuerBericht(ctx, baustellen, f.baustelleId);
  });
  await ladeListe();
}

function neuerBericht(ctx, baustellen, vorwahl) {
  const aktive = baustellen.filter((b) => !b.status || b.status === 'aktiv');
  const eigene = (ctx.ich.baustellenIds || []).map(String);
  const start = vorwahl || (aktive.find((b) => eigene.includes(String(b.id))) || aktive[0] || {}).id;
  const d = dialog({
    titel: 'Neuer Bautagesbericht',
    inhalt: `<form id="nb" class="stack-s">
      <label class="field"><span class="field-label">Baustelle</span><select class="input lg" name="baustelleId" required>${aktive.map((b) => `<option value="${b.id}" ${String(b.id) === String(start) ? 'selected' : ''}>${esc((b.kst ? b.kst + ' · ' : '') + b.name)}</option>`).join('')}</select></label>
      <label class="field"><span class="field-label">Datum</span><input class="input lg" type="date" name="datum" required value="${fmt.iso()}" max="${fmt.iso()}"></label>
      ${banner('info', 'Das Personal wird automatisch aus den Stempelungen dieses Tages übernommen.')}
      <p class="form-err" id="nb-err" role="alert" hidden></p></form>`,
    fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="nb" id="nb-ok">Bericht anlegen</button>',
  });
  $('#nb', d.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    $('#nb-ok', d.el).disabled = true;
    try {
      const b = await post('/berichte', { baustelleId: Number(fd.get('baustelleId')), datum: fd.get('datum') });
      d.zu(); location.hash = `#/bericht/${b.id}`;
    } catch (err) {
      const id = err.daten && (err.daten.id || (err.daten.bericht && err.daten.bericht.id));
      if (err.status === 409 && id) { d.zu(); toast('Für diesen Tag gibt es schon einen Bericht – er wurde geöffnet.', 'warn'); location.hash = `#/bericht/${id}`; return; }
      const m = $('#nb-err', d.el); m.hidden = false; m.textContent = err.message; $('#nb-ok', d.el).disabled = false;
    }
  });
}

/* =================== Unterschriftsfeld (Pointer Events) =================== */
function signaturFeld(canvas) {
  const c = canvas.getContext('2d');
  let zeichnet = false, hat = false, letzter = null;
  const groesse = () => {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!r.width) return;
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.lineWidth = 2.4; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = '#17307a';
    hat = false;
  };
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* synthetische Zeiger */ }
    zeichnet = true; letzter = pos(e);
    c.beginPath(); c.arc(letzter.x, letzter.y, 1.2, 0, 6.3); c.fillStyle = '#17307a'; c.fill();
    hat = true; canvas.dispatchEvent(new CustomEvent('gezeichnet'));
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!zeichnet) return;
    e.preventDefault();
    const p = pos(e);
    c.beginPath(); c.moveTo(letzter.x, letzter.y); c.lineTo(p.x, p.y); c.stroke();
    letzter = p;
  });
  const ende = () => { zeichnet = false; };
  canvas.addEventListener('pointerup', ende);
  canvas.addEventListener('pointercancel', ende);
  groesse();
  return { leer: () => !hat, loeschen: groesse, png: () => canvas.toDataURL('image/png') };
}

/* =================== Bearbeitung =================== */
const SCHRITTE = ['Personal', 'Geräte', 'Material', 'Leistung', 'Regie & Vorkommnisse', 'Unterschrift'];
const CODES = [['', '–'], ['K', 'K · Krank'], ['U', 'U · Urlaub'], ['SW', 'SW · Schlechtwetter'], ['ZA', 'ZA · Zeitausgleich']];
const rund2 = (n) => Math.round(n * 100) / 100;
export async function bericht(el, ctx) {
  const id = ctx.params[0];
  const [b, geraeteKat, matKat, mitarbeiter, integ] = await Promise.all([
    get(`/berichte/${id}`), get('/geraete'), get('/materialien'), get('/mitarbeiter').catch(() => []), ctx.integrationen(),
  ]);
  b.personal = b.personal || []; b.geraete = b.geraete || []; b.material = b.material || []; b.regie = b.regie || [];
  b.seg = b.seg || { taetigkeit: '', stunden: 0 };
  b.materialbeistellung = b.materialbeistellung || { eigen: '', fremd: '' };
  b.paletten = b.paletten || { euro: 0, weissenboeck: 0 };
  b.unterschriften = b.unterschriften || {};
  let schritt = Math.min(6, Math.max(1, Number(ctx.query.get('schritt')) || (b.status === 'entwurf' ? 1 : 6)));
  const bs = b.baustelle || {};
  ctx.titel('Bautagesbericht', `${bs.kst ? bs.kst + ' · ' : ''}${bs.name || ''} · ${fmt.datum(b.datum)}`);

  const signiert = () => !!(b.unterschriften.an || b.unterschriften.bh);
  const signierbar = () => b.status === 'entwurf' && ctx.kann('bericht_erstellen');
  // M-02: Sobald eine Unterschrift vorliegt, ist der Inhalt gesperrt (der Server lehnt Änderungen mit 409 ab)
  const editierbar = () => signierbar() && !signiert();
  const ungueltig = () => b.personal.some((p) => personalFehler(p));
  const dis = () => (editierbar() ? '' : 'disabled');
  const gStd = (gid) => (b.geraete.find((g) => g.geraetId === gid) || {}).stunden || 0;
  const mMenge = (mid) => (b.material.find((m) => m.materialId === mid) || {}).menge || 0;
  const gesamt = () => rund2(b.personal.reduce((s, p) => s + (Number(p.stunden) || 0), 0));

  /* ---- Speichern (automatisch, entprellt) ---- */
  const offen = new Set();
  let speichert = false, fehlerText = '';
  let gespeichertUm = null;
  const anzeige = () => {
    const s = $('#save-state', el);
    const inv = ungueltig();
    const zustand = inv ? 'invalid' : fehlerText ? 'err' : speichert || offen.size ? 'busy' : gespeichertUm ? 'ok' : 'neutral';
    if (s) {
      s.dataset.zustand = zustand;
      s.className = 'save-state ' + (zustand === 'invalid' ? 'err' : zustand);
      s.innerHTML = zustand === 'invalid' ? `${ic('alert')}<span>Nicht gespeichert</span>`
        : zustand === 'err' ? `${ic('alert')}<span>Nicht gespeichert</span>`
        : zustand === 'busy' ? '<span class="spinner xs"></span><span>Speichert …</span>'
        : zustand === 'ok' ? `${ic('check')}<span>Gespeichert</span>` : '<span>Keine Änderungen</span>';
    }
    const u = $('#unsaved', el);
    if (u) {
      u.hidden = !(inv || fehlerText);
      $('span', u).textContent = inv
        ? 'Nicht gespeichert: Beim Personal sind Zeiten unvollständig oder widersprüchlich (rot markiert). Bitte korrigieren – vorher kann nicht unterschrieben werden.'
        : fehlerText ? `Nicht gespeichert: ${fehlerText}${/Verbindung/.test(fehlerText) ? ' Die Eingaben bleiben am Bildschirm und werden bei der nächsten Änderung erneut gesendet.' : ''}` : '';
    }
  };
  const wert = (feld) => {
    if (feld === 'geraete') return b.geraete.filter((g) => g.stunden > 0).map((g) => ({ geraetId: g.geraetId, stunden: g.stunden }));
    if (feld === 'material') return b.material.filter((m) => m.menge > 0).map((m) => ({ materialId: m.materialId, menge: m.menge }));
    if (feld === 'personal') return b.personal.map((p) => ({ benutzerId: p.benutzerId, von1: p.von1 || null, bis1: p.bis1 || null, von2: p.von2 || null, bis2: p.bis2 || null, pauseMin: Number(p.pauseMin) || 0, stunden: Number(p.stunden) || 0, code: p.code || null, segStunden: Number(p.segStunden) || 0 }));
    if (feld === 'regie') return b.regie.filter((r) => (r.text || '').trim() || r.stunden > 0).map((r) => ({ text: r.text || '', stunden: Number(r.stunden) || 0 }));
    return b[feld];
  };
  async function sichern() {
    if (speichert || !offen.size) return;
    // Ungültiges Personal wird nicht gesendet – es bleibt als „offen“ stehen, bis es stimmt
    const felder = [...offen].filter((f) => f !== 'personal' || !ungueltig());
    if (!felder.length) { anzeige(); return; }
    felder.forEach((f) => offen.delete(f));
    speichert = true; anzeige();
    try {
      const body = {}; felder.forEach((f) => { body[f] = wert(f); });
      const neu = await put(`/berichte/${id}`, body);
      if (neu && 'kostenTag' in neu) { b.kostenTag = neu.kostenTag; zeichneKosten(); }
      fehlerText = ''; gespeichertUm = Date.now();
    } catch (e) {
      felder.forEach((f) => offen.add(f)); // nichts gilt als gespeichert, was der Server nicht bestätigt hat
      fehlerText = e.netz ? 'Keine Verbindung zum Server.' : e.message;
      speichert = false; anzeige();
      if (e.status === 409) { toast('Der Bericht wurde inzwischen unterschrieben oder geändert – er wird neu geladen.', 'warn'); offen.clear(); ctx.neuLaden(); }
      return;
    }
    speichert = false; anzeige();
    if ([...offen].some((f) => f !== 'personal' || !ungueltig())) sichern();
  }
  const spaeter = entprellt(sichern, 600);
  const geaendert = (feld) => { if (!editierbar()) return; offen.add(feld); fehlerText = ''; anzeige(); spaeter(); };
  const allesSichern = async () => { if (ungueltig()) return false; spaeter.sofort(); for (let i = 0; i < 40 && (speichert || offen.size) && !fehlerText; i++) await new Promise((r) => setTimeout(r, 100)); return !fehlerText && !offen.size && !speichert; };

  /* ---- Bausteine ---- */
  const stepper = (attr, val, schrittw, einheit, label) => `
    <span class="stepper" data-stepper ${attr} data-schritt="${schrittw}">
      <button type="button" data-d="-1" aria-label="${esc(label)} verringern" ${dis()}>${ic('minus')}</button>
      <input type="text" inputmode="decimal" value="${val ? fmt.zahl(val) : ''}" placeholder="0" aria-label="${esc(label)}${einheit ? ' in ' + esc(einheit) : ''}" ${dis()}>
      <button type="button" data-d="1" aria-label="${esc(label)} erhöhen" ${dis()}>${ic('plus')}</button>
    </span>`;

  function personalHtml() {
    const frei = mitarbeiter.filter((m) => m.aktiv !== false && m.aktiv !== 0 && !b.personal.some((p) => p.benutzerId === m.id));
    return `
      <div class="bp" role="table" aria-label="Personal">
        <div class="bp-head" role="row"><span role="columnheader">Name</span><span role="columnheader">von</span><span role="columnheader">bis</span><span role="columnheader">von</span><span role="columnheader">bis</span><span role="columnheader">Pause</span><span role="columnheader">Arbstd.</span><span role="columnheader">Code</span><span></span></div>
        ${b.personal.length ? b.personal.map((p, i) => `
        <div class="bp-row" role="row" data-i="${i}">
          <span class="bp-name" role="cell"><b>${esc(p.name || (mitarbeiter.find((m) => m.id === p.benutzerId) || {}).name || 'Mitarbeiter')}</b>${p.hinweis ? `<small class="bp-hinweis">${ic('alert', 'xs')} ${esc(p.hinweis)}</small>` : ''}</span>
          ${['von1', 'bis1', 'von2', 'bis2'].map((k, n) => `<label role="cell"><span class="bp-l">${n % 2 ? 'bis' : 'von'}${n > 1 ? ' (2)' : ''}</span><input type="time" class="input s" data-p="${k}" value="${esc(p[k] || '')}" aria-label="${esc(p.name || '')} ${n % 2 ? 'bis' : 'von'} ${n > 1 ? 'Nachmittag' : 'Vormittag'}" ${dis()}></label>`).join('')}
          <label role="cell"><span class="bp-l">Pause (min)</span><input type="text" inputmode="numeric" class="input s num" data-p="pauseMin" value="${p.pauseMin || ''}" placeholder="0" aria-label="${esc(p.name || '')} Pause in Minuten" ${dis()}></label>
          <label role="cell"><span class="bp-l">Arbeitsstd.</span><input type="text" inputmode="decimal" class="input s num strong" data-p="stunden" value="${p.stunden ? fmt.zahl(p.stunden) : ''}" placeholder="0" aria-label="${esc(p.name || '')} Arbeitsstunden" ${dis()}></label>
          <label role="cell"><span class="bp-l">Code</span><select class="input s" data-p="code" aria-label="${esc(p.name || '')} Abwesenheits-Code" ${dis()}>${CODES.map(([k, t]) => `<option value="${k}" ${(p.code || '') === k ? 'selected' : ''}>${k ? esc(k) : '–'}</option>`).join('')}</select></label>
          <span role="cell" class="bp-del">${editierbar() ? `<button type="button" class="icon-btn sm" data-p-weg aria-label="${esc(p.name || 'Person')} entfernen">${ic('trash')}</button>` : ''}</span>
        </div>`).join('') : `<div class="state empty small">${ic('users')}<p>Für diesen Tag wurde auf dieser Baustelle niemand gestempelt. Personen können händisch ergänzt werden.</p></div>`}
        <div class="bp-foot"><span>Gesamtstunden</span><b id="gesamt">${fmt.zahl(gesamt())}</b></div>
      </div>
      <p class="pf-legend">K = Krank · U = Urlaub · SW = Schlechtwetter · ZA = Zeitausgleich</p>
      ${editierbar() ? `<div class="add-line">${frei.length ? `<select class="input" id="p-neu" aria-label="Person hinzufügen"><option value="">Person hinzufügen …</option>${frei.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>` : ''}<button type="button" class="btn ghost sm" data-p-sync>${ic('sync')}Aus Stempelungen neu übernehmen</button></div>` : ''}`;
  }
  function zeilenStatus(pr, p) {
    const fehler = personalFehler(p);
    pr.classList.toggle('invalid', !!fehler);
    let h = $('.bp-err', pr);
    if (fehler && !h) { h = document.createElement('p'); h.className = 'bp-err'; h.setAttribute('role', 'alert'); pr.appendChild(h); }
    if (h) { h.textContent = fehler; h.hidden = !fehler; }
    const nacht = !fehler && bloecke(p).naechsterTag;
    let n = $('.bp-nacht', pr);
    if (nacht && !n) { n = document.createElement('p'); n.className = 'bp-nacht'; pr.appendChild(n); }
    if (n) { n.hidden = !nacht; n.innerHTML = nacht ? '<span class="chip xs st-blue">+1 Tag</span> Schicht über Mitternacht – das Ende liegt am nächsten Tag.' : ''; }
  }
  const alleZeilenStatus = () => $$('#personal .bp-row', el).forEach((pr) => zeilenStatus(pr, b.personal[Number(pr.dataset.i)]));
  function regieHtml() {
    return `${b.regie.map((r, i) => `<div class="regie-row" data-i="${i}">
        <input type="text" class="input" data-r="text" value="${esc(r.text || '')}" placeholder="Regieleistung beschreiben" aria-label="Regieleistung ${i + 1}" ${dis()}>
        <label class="unit"><input type="text" inputmode="decimal" class="input num" data-r="stunden" value="${r.stunden ? fmt.zahl(r.stunden) : ''}" placeholder="0" aria-label="Regiestunden ${i + 1}" ${dis()}><span>Std.</span></label>
        ${editierbar() ? `<button type="button" class="icon-btn sm" data-r-weg aria-label="Regieleistung ${i + 1} entfernen">${ic('trash')}</button>` : '<span></span>'}
      </div>`).join('') || (editierbar() ? '' : '<p class="muted sm pad-s">Keine Regieleistungen.</p>')}
      ${editierbar() ? `<button type="button" class="add-row" data-r-neu>${ic('plus')}Regieleistung hinzufügen</button>` : ''}`;
  }
  function sigHtml(rolle, titel, sub) {
    const u = b.unterschriften[rolle];
    if (u) return `<div class="sig-box signed" data-sig="${rolle}"><div class="sig-h"><div><b>${titel}</b><small>${sub}</small></div><span class="chip st-green">${ic('check')}Unterschrieben</span></div><div class="sig-done">${u.bildPng && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(u.bildPng) ? `<img src="${u.bildPng}" alt="Unterschrift ${esc(u.name || '')}">` : ic('sign')}<div><b>${esc(u.name || '')}</b><small>${esc(fmt.zeitpunkt(u.zeit))} Uhr</small></div></div>${signierbar() ? `<button type="button" class="btn ghost sm" data-sig-weg="${rolle}">Unterschrift zurückziehen</button>` : ''}</div>`;
    if (!signierbar()) return `<div class="sig-box" data-sig="${rolle}"><div class="sig-h"><div><b>${titel}</b><small>${sub}</small></div></div><p class="muted sm">Keine Unterschrift vorhanden.</p></div>`;
    return `<div class="sig-box" data-sig="${rolle}">
      <div class="sig-h"><div><b>${titel}</b><small>${sub}</small></div><button type="button" class="btn ghost sm" data-sig-clear>Löschen</button></div>
      <div class="sig-pad"><canvas aria-label="Unterschriftsfeld ${titel}" role="img"></canvas><span class="sig-ph">${ic('sign')}Hier unterschreiben</span><span class="sig-line"></span></div>
      <label class="field"><span class="field-label">Name in Blockschrift</span><input type="text" class="input" data-sig-name value="${rolle === 'an' ? esc(ctx.ich.benutzer.name) : ''}" placeholder="${rolle === 'an' ? 'Name' : 'Name Bauherr / Vertreter'}" autocomplete="off"></label>
      <button type="button" class="btn primary block" data-sig-save>${ic('check')}Unterschrift speichern</button>
      ${rolle === 'bh' ? integBtn(integ, 'sms', 'Per SMS-Link unterschreiben lassen', 'sms', 'block') : ''}
    </div>`;
  }
  function abschlussHtml() {
    const u = b.unterschriften;
    const darfFrei = ctx.kann('bericht_freigeben');
    return `
      <div class="pf-two sigs">${sigHtml('an', 'AUFTRAGNEHMER', 'oder dessen Beauftragter')}${sigHtml('bh', 'BAUHERR', 'oder dessen bevollmächtigter Vertreter')}</div>
      ${signierbar() && !signiert() ? banner('info', 'Mit der ersten Unterschrift wird der Inhalt gesperrt. Bitte vorher alles prüfen.') : ''}
      <div class="final-bar">
        <div class="final-state">${statusChip(b.status)}<span class="muted sm">${b.status === 'entwurf' ? `${(u.an ? 1 : 0) + (u.bh ? 1 : 0)} von 2 Unterschriften` : b.status === 'unterschrieben' ? 'Wartet auf Freigabe durch Büro/Bauleitung' : 'Freigegeben – fließt in die Auswertungen ein'}</span></div>
        <a class="btn ghost" id="pdf" href="/api/berichte/${id}/pdf" target="_blank" rel="noopener">${ic('file')}PDF öffnen</a>
        ${darfFrei && b.status !== 'freigegeben' ? `<button type="button" class="btn primary" id="freigeben" ${b.status === 'unterschrieben' ? '' : 'disabled'} ${b.status === 'unterschrieben' ? '' : 'title="Freigabe erst möglich, wenn beide unterschrieben haben"'}>${ic('check')}Freigeben</button>` : ''}
      </div>`;
  }
  function zeichneKosten() {
    const k = $('#kosten', el); if (!k) return;
    const v = b.kostenTag;
    if (v == null) { k.hidden = true; return; }
    k.hidden = false;
    const TXT = { lohn: 'Lohn', geraete: 'Geräte', material: 'Material', fremd: 'Fremdleistungen', gesamt: 'Gesamt' };
    k.innerHTML = typeof v === 'number'
      ? `<span>Kosten dieses Tages (laut Preisliste)</span><b>${fmt.eur(v)}</b>`
      : `<span>Kosten dieses Tages</span>${Object.entries(v).filter(([, x]) => typeof x === 'number').map(([key, x]) => `<span class="kt ${key === 'gesamt' ? 'sum' : ''}">${esc(TXT[key] || key)} <b>${fmt.eur(x)}</b></span>`).join('')}`;
  }

  const pads = {};
  function zeichne() {
    const halb = Math.ceil(geraeteKat.length / 2);
    const gSpalte = (liste) => liste.map((g) => `<div class="pf-g${gStd(g.id) ? ' on' : ''}" data-g="${g.id}"><span>${esc(g.name)}</span>${stepper(`data-geraet="${g.id}"`, gStd(g.id), 0.5, 'Stunden', g.name)}<small>Std.</small></div>`).join('');
    const wetter = b.wetter ? (typeof b.wetter === 'string' ? b.wetter : [b.wetter.text || b.wetter.beschreibung, b.wetter.temperatur != null ? `${fmt.zahl(b.wetter.temperatur, 1)} °C` : ''].filter(Boolean).join(', ')) : '';
    el.innerHTML = `
    <div class="page form-page">
      <div class="form-top">
        <a class="link-back" href="#/berichte">${ic('left')}Alle Berichte</a>
        <span class="grow"></span>
        ${statusChip(b.status)}
        ${editierbar() ? '<span class="save-state neutral" id="save-state" role="status"></span>' : ''}
      </div>
      ${b.status === 'entwurf' && signiert() ? `<div id="gesperrt-hinweis">${banner('info', '<b>Inhalt gesperrt:</b> Es liegt bereits eine Unterschrift vor. Der Bericht kann nicht mehr geändert werden – es fehlt nur noch die zweite Unterschrift.', 'lock')}</div>` : !editierbar() && b.status === 'entwurf' ? banner('info', 'Nur Ansicht – zum Bearbeiten fehlt die Berechtigung.') : ''}
      <div class="banner err" id="unsaved" role="alert" hidden>${ic('alert')}<span></span></div>
      ${b.status !== 'entwurf' ? banner(b.status === 'freigegeben' ? 'ok' : 'info', b.status === 'freigegeben' ? 'Dieser Bericht ist freigegeben und abgeschlossen.' : 'Dieser Bericht ist unterschrieben und kann nicht mehr geändert werden.', b.status === 'freigegeben' ? 'check' : 'lock') : ''}
      <div class="kosten-zeile" id="kosten" hidden></div>

      <nav class="wiz-steps" aria-label="Schritte">
        <div class="wiz-now"><b id="wiz-nr">Schritt ${schritt} von 6</b><span id="wiz-name">${SCHRITTE[schritt - 1]}</span></div>
        <ol>${SCHRITTE.map((s, i) => `<li><button type="button" data-schritt-nr="${i + 1}" aria-label="Schritt ${i + 1}: ${esc(s)}" ${i + 1 === schritt ? 'aria-current="step"' : ''}></button></li>`).join('')}</ol>
      </nav>

      <div class="pform bform" data-aktiv="${schritt}">
        <div class="pf-head bf-kopf">
          <div class="pf-co"><b>BauTag</b><small>Digitaler Bautagesbericht</small></div>
          <div class="pf-title"><h2>BAUTAGESBERICHT</h2><div class="pf-meta"><span>Datum: <b>${esc(fmt.datumLang(b.datum))}</b></span><span>KST.: <b>${esc(bs.kst || '–')}</b></span></div></div>
        </div>
        <div class="pf-two tight bf-kopf">
          <div class="pf-sec"><h4>AUFTRAGGEBER</h4><div class="pf-box"><b>${esc(bs.auftraggeber || '–')}</b></div></div>
          <div class="pf-sec"><h4>BAUVORHABEN</h4><div class="pf-box"><b>${esc(bs.name || '–')}</b><small>${esc(bs.adresse || '')}</small></div></div>
        </div>
        <div class="bf-kopf-m"><b>${esc(bs.name || '')}</b><span>${esc(fmt.datumLang(b.datum))} · KST ${esc(bs.kst || '–')}</span></div>

        <div class="bf-grid">
          <section class="pf-sec a-pers" data-step="1" aria-labelledby="h-pers"><h4 id="h-pers">PERSONAL <span>Arbeitszeit aus den Stempelungen</span></h4><div class="pf-box flush" id="personal">${personalHtml()}</div></section>
          <section class="pf-sec a-seg" data-step="1" aria-labelledby="h-seg"><h4 id="h-seg">SEG-ZULAGEN</h4><div class="pf-box seg-box">
            <label class="field"><span class="field-label">Tätigkeit</span><input type="text" class="input" data-f="seg.taetigkeit" value="${esc(b.seg.taetigkeit || '')}" placeholder="z. B. Arbeiten im Künettenverbau" ${dis()}></label>
            <label class="field w-s"><span class="field-label">Stunden</span><input type="text" inputmode="decimal" class="input num" data-f="seg.stunden" value="${b.seg.stunden ? fmt.zahl(b.seg.stunden) : ''}" placeholder="0" ${dis()}></label>
          </div></section>
          <section class="pf-sec a-ger" data-step="2" aria-labelledby="h-ger"><h4 id="h-ger">GERÄTE <span>Einsatzstunden</span></h4><div class="pf-ggrid"><div>${gSpalte(geraeteKat.slice(0, halb))}</div><div>${gSpalte(geraeteKat.slice(halb))}</div></div></section>
          <section class="pf-sec a-mat" data-step="3" aria-labelledby="h-mat"><h4 id="h-mat">MATERIAL <span>Menge</span></h4><div class="pf-box flush mat-list">
            ${matKat.map((m) => `<div class="mat-row${mMenge(m.id) ? ' on' : ''}" data-m="${m.id}"><span>${esc(m.name)}</span>${stepper(`data-material="${m.id}"`, mMenge(m.id), 1, m.einheit, m.name)}<small>${esc(m.einheit || '')}</small></div>`).join('')}
          </div>${editierbar() ? `<div class="integ-row">${integBtn(integ, 'scan_lieferschein', 'Lieferschein scannen', 'scan')}</div>` : ''}</section>
          <section class="pf-sec a-leist" data-step="4" aria-labelledby="h-leist"><h4 id="h-leist">ARBEITSLEISTUNG</h4><div class="pf-box flush"><textarea class="input area" rows="5" data-f="arbeitsleistung" aria-labelledby="h-leist" placeholder="Was wurde heute gemacht?" ${dis()}>${esc(b.arbeitsleistung || '')}</textarea></div>
            ${editierbar() ? `<div class="integ-row">${integBtn(integ, 'diktat', 'Diktieren', 'mic')}</div>` : ''}</section>
          <section class="pf-sec a-beist" data-step="4" aria-labelledby="h-beist"><h4 id="h-beist">MATERIALBEISTELLUNG</h4><div class="pf-two tight inner">
            <label class="pf-box flush"><span class="sub-l">Eigenmaterial</span><textarea class="input area" rows="3" data-f="materialbeistellung.eigen" ${dis()}>${esc(b.materialbeistellung.eigen || '')}</textarea></label>
            <label class="pf-box flush"><span class="sub-l">Fremdmaterial</span><textarea class="input area" rows="3" data-f="materialbeistellung.fremd" ${dis()}>${esc(b.materialbeistellung.fremd || '')}</textarea></label>
          </div></section>
          <section class="pf-sec a-pal" data-step="4" aria-labelledby="h-pal"><h4 id="h-pal">PALETTEN RETOUR <span>Leerpaletten</span></h4><div class="pf-box pal-box">
            <div class="pal"><span>Euro</span>${stepper('data-pal="euro"', b.paletten.euro, 1, 'Stück', 'Europaletten retour')}<small>Stk.</small></div>
            <div class="pal"><span>Weissenböck</span>${stepper('data-pal="weissenboeck"', b.paletten.weissenboeck, 1, 'Stück', 'Weissenböck-Paletten retour')}<small>Stk.</small></div>
          </div></section>
          <section class="pf-sec a-regie" data-step="5" aria-labelledby="h-regie"><h4 id="h-regie">REGIELEISTUNGEN</h4><div class="pf-box flush" id="regie">${regieHtml()}</div></section>
          <section class="pf-sec a-vork" data-step="5" aria-labelledby="h-vork"><h4 id="h-vork">BESONDERE VORKOMMNISSE <span>z. B. Anweisungen AG, Beschädigungen, Sonstiges</span></h4><div class="pf-box flush"><textarea class="input area" rows="3" data-f="vorkommnisse" aria-labelledby="h-vork" ${dis()}>${esc(b.vorkommnisse || '')}</textarea></div>
            <div class="integ-row">${wetter ? `<span class="chip st-blue">${ic('cloud')}Wetter: ${esc(wetter)}</span>` : integBtn(integ, 'wetter', 'Wetter automatisch eintragen', 'cloud')}</div></section>
          <section class="a-sig" data-step="6" aria-label="Unterschriften und Abschluss" id="abschluss">${abschlussHtml()}</section>
        </div>
      </div>
    </div>
    <div class="foot-bar wiz-foot"><div class="foot-split">
      <button type="button" class="btn ghost lg" id="wiz-zurueck">${ic('left')}Zurück</button>
      <button type="button" class="btn primary lg grow" id="wiz-weiter">Weiter${ic('right')}</button>
    </div></div>`;
    Object.keys(pads).forEach((k) => delete pads[k]);
    alleZeilenStatus(); anzeige(); zeichneKosten(); setzSchritt(schritt, false); sigInit();
  }

  function sigInit() {
    $$('.sig-box:not(.signed) canvas', el).forEach((cv) => {
      const box = cv.closest('.sig-box');
      const pad = signaturFeld(cv);
      pads[box.dataset.sig] = pad;
      cv.addEventListener('gezeichnet', () => box.classList.add('hat'));
    });
  }
  function setzSchritt(n, scroll = true) {
    schritt = Math.min(6, Math.max(1, n));
    const f = $('.bform', el); if (!f) return;
    f.dataset.aktiv = schritt;
    $('#wiz-nr', el).textContent = `Schritt ${schritt} von 6`;
    $('#wiz-name', el).textContent = SCHRITTE[schritt - 1];
    $$('[data-schritt-nr]', el).forEach((x) => { const an = Number(x.dataset.schrittNr) === schritt; x.classList.toggle('on', an); x.classList.toggle('done', Number(x.dataset.schrittNr) < schritt); if (an) x.setAttribute('aria-current', 'step'); else x.removeAttribute('aria-current'); });
    $('#wiz-zurueck', el).disabled = schritt === 1;
    const w = $('#wiz-weiter', el);
    w.hidden = schritt === 6;
    // Unterschriftsfelder brauchen sichtbare Größe
    if (schritt === 6) Object.entries(pads).forEach(([r, p]) => { const box = $(`.sig-box[data-sig="${r}"]`, el); if (box && !box.classList.contains('hat')) p.loeschen(); });
    if (scroll) { const v = document.getElementById('view'); if (v) v.scrollTop = 0; }
  }

  /* ---- Ereignisse ---- */
  const zahl = (s, alt = 0) => {
    if (String(s).trim() === '') return 0;
    const n = parseZahl(s);
    if (!isFinite(n) || n < 0) { toast(`„${s}“ ist als Zahl unklar – der bisherige Wert bleibt.`, 'warn'); return alt || 0; }
    return rund2(n);
  };
  function setzStepper(sp, v) {
    v = Math.max(0, rund2(v));
    $('input', sp).value = v ? fmt.zahl(v) : '';
    if (sp.dataset.geraet) {
      const gid = Number(sp.dataset.geraet); let g = b.geraete.find((x) => x.geraetId === gid);
      if (!g) { g = { geraetId: gid, stunden: 0 }; b.geraete.push(g); }
      g.stunden = v; sp.closest('.pf-g').classList.toggle('on', v > 0); geaendert('geraete');
    } else if (sp.dataset.material) {
      const mid = Number(sp.dataset.material); let m = b.material.find((x) => x.materialId === mid);
      if (!m) { m = { materialId: mid, menge: 0 }; b.material.push(m); }
      m.menge = v; sp.closest('.mat-row').classList.toggle('on', v > 0); geaendert('material');
    } else if (sp.dataset.pal) { b.paletten[sp.dataset.pal] = Math.round(v); geaendert('paletten'); }
  }
  el.addEventListener('click', async (e) => {
    const d = e.target.closest('[data-stepper] [data-d]');
    if (d) { const sp = d.closest('[data-stepper]'); setzStepper(sp, zahl($('input', sp).value) + Number(d.dataset.d) * Number(sp.dataset.schritt)); return; }
    const sn = e.target.closest('[data-schritt-nr]');
    if (sn) { setzSchritt(Number(sn.dataset.schrittNr)); return; }
    if (e.target.closest('#wiz-zurueck')) { setzSchritt(schritt - 1); return; }
    if (e.target.closest('#wiz-weiter')) { setzSchritt(schritt + 1); return; }
    if (e.target.closest('[data-p-weg]')) {
      const i = Number(e.target.closest('.bp-row').dataset.i);
      if (await bestaetigen('Person entfernen?', `${b.personal[i].name || 'Diese Person'} aus dem Bericht entfernen? Die Stempelungen bleiben erhalten.`, 'Entfernen', 'danger')) { b.personal.splice(i, 1); $('#personal', el).innerHTML = personalHtml(); alleZeilenStatus(); geaendert('personal'); }
      return;
    }
    if (e.target.closest('[data-p-sync]')) {
      if (!(await bestaetigen('Personal neu übernehmen?', 'Die Zeiten werden aus den Stempelungen dieses Tages neu eingetragen. Händische Änderungen am Personal gehen verloren.', 'Übernehmen'))) return;
      try { const neu = await post(`/berichte/${id}/personal-aktualisieren`); b.personal = neu.personal || []; offen.delete('personal'); $('#personal', el).innerHTML = personalHtml(); alleZeilenStatus(); anzeige(); toast('Personal aus den Stempelungen übernommen.'); } catch (x) { toast(x.message, 'warn'); }
      return;
    }
    if (e.target.closest('[data-r-neu]')) { b.regie.push({ text: '', stunden: 0 }); $('#regie', el).innerHTML = regieHtml(); const ins = $$('#regie [data-r="text"]', el); ins[ins.length - 1].focus(); return; }
    if (e.target.closest('[data-r-weg]')) { b.regie.splice(Number(e.target.closest('.regie-row').dataset.i), 1); $('#regie', el).innerHTML = regieHtml(); geaendert('regie'); return; }
    const box = e.target.closest('.sig-box');
    if (box && e.target.closest('[data-sig-clear]')) { pads[box.dataset.sig].loeschen(); box.classList.remove('hat'); return; }
    if (box && e.target.closest('[data-sig-save]')) { unterschreiben(box); return; }
    const sw = e.target.closest('[data-sig-weg]');
    if (sw) {
      if (!(await bestaetigen('Unterschrift zurückziehen?', 'Die Unterschrift wird gelöscht. Danach kann der Bericht wieder geändert werden und muss neu unterschrieben werden.', 'Zurückziehen', 'danger'))) return;
      try { const neu = await del(`/berichte/${id}/unterschrift/${sw.dataset.sigWeg}`); b.unterschriften = (neu && neu.unterschriften) || {}; if (neu && neu.status) b.status = neu.status; toast('Unterschrift zurückgezogen.'); zeichne(); }
      catch (x) { toast(x.message, 'warn'); }
      return;
    }
    if (e.target.closest('#freigeben')) { freigeben(); }
  });
  el.addEventListener('change', (e) => {
    const t = e.target;
    const sp = t.closest('[data-stepper]');
    if (sp) {
      const alt = sp.dataset.geraet ? gStd(Number(sp.dataset.geraet)) : sp.dataset.material ? mMenge(Number(sp.dataset.material)) : b.paletten[sp.dataset.pal] || 0;
      setzStepper(sp, zahl(t.value, alt)); return;
    }
    if (t.id === 'p-neu' && t.value) {
      const m = mitarbeiter.find((x) => String(x.id) === t.value);
      b.personal.push({ benutzerId: m.id, name: m.name, von1: '', bis1: '', von2: '', bis2: '', pauseMin: 0, stunden: 0, code: '' });
      $('#personal', el).innerHTML = personalHtml(); alleZeilenStatus(); geaendert('personal'); return;
    }
    const pr = t.closest('.bp-row');
    if (pr && t.dataset.p) {
      const p = b.personal[Number(pr.dataset.i)], k = t.dataset.p;
      if (k === 'stunden') { p.stunden = zahl(t.value, p.stunden); t.value = p.stunden ? fmt.zahl(p.stunden) : ''; }
      else if (k === 'pauseMin') { p.pauseMin = Math.round(zahl(t.value, p.pauseMin)); t.value = p.pauseMin || ''; }
      else p[k] = t.value;
      if (k !== 'stunden' && k !== 'code') { p.stunden = stundenAus(p); $('[data-p="stunden"]', pr).value = p.stunden ? fmt.zahl(p.stunden) : ''; }
      $('#gesamt', el).textContent = fmt.zahl(gesamt());
      zeilenStatus(pr, p);
      geaendert('personal'); // ungültige Zeilen werden nicht gesendet, bleiben aber sichtbar „nicht gespeichert“
      return;
    }
    const rr = t.closest('.regie-row');
    if (rr && t.dataset.r) {
      const r = b.regie[Number(rr.dataset.i)];
      if (t.dataset.r === 'stunden') { r.stunden = zahl(t.value, r.stunden); t.value = r.stunden ? fmt.zahl(r.stunden) : ''; } else r.text = t.value;
      geaendert('regie'); return;
    }
    if (t.dataset.f === 'seg.stunden') { b.seg.stunden = zahl(t.value, b.seg.stunden); t.value = b.seg.stunden ? fmt.zahl(b.seg.stunden) : ''; geaendert('seg'); }
  });
  el.addEventListener('input', (e) => {
    const t = e.target, f = t.dataset.f;
    if (!f || f === 'seg.stunden') return;
    const [a, c] = f.split('.');
    if (c) b[a][c] = t.value; else b[a] = t.value;
    geaendert(a);
  });

  async function unterschreiben(box) {
    const rolle = box.dataset.sig, pad = pads[rolle];
    const name = $('[data-sig-name]', box).value.trim();
    if (!pad || pad.leer()) { box.classList.add('shake'); setTimeout(() => box.classList.remove('shake'), 500); toast('Bitte zuerst im Feld unterschreiben.', 'warn'); return; }
    if (!name) { $('[data-sig-name]', box).focus(); toast('Bitte den Namen eintragen.', 'warn'); return; }
    const knopf = $('[data-sig-save]', box);
    if (!ungueltig()) knopf.disabled = true;
    if (ungueltig()) { toast('Unterschrift nicht möglich: Beim Personal sind Zeiten ungültig (rot markiert).', 'warn'); setzSchritt(1); anzeige(); return; }
    const knopfAus = () => { knopf.disabled = false; };
    if (!(await allesSichern())) { toast('Unterschrift nicht möglich: Die letzten Änderungen sind noch nicht gespeichert.', 'warn'); anzeige(); knopfAus(); return; }
    try {
      const r = await post(`/berichte/${id}/unterschrift`, { rolle, name, bildPng: pad.png() });
      const neu = r && r.unterschriften ? r : await get(`/berichte/${id}`);
      b.unterschriften = neu.unterschriften || {}; b.status = neu.status;
      delete pads[rolle];
      toast(b.status === 'unterschrieben' ? 'Beide Unterschriften vorhanden – Bericht abgeschlossen.' : 'Unterschrift gespeichert.');
      zeichne(); // Inhalt ist ab jetzt gesperrt (M-02)
      if (b.status !== 'entwurf') ctx.meldungenNeu();
    } catch (e) { toast(e.message, 'warn'); knopf.disabled = false; }
  }
  async function freigeben() {
    if (!(await bestaetigen('Bericht freigeben?', 'Der Bericht fließt damit in Nachkalkulation und Monatsauswertung ein.', 'Freigeben'))) return;
    try {
      const r = await post(`/berichte/${id}/freigeben`);
      b.status = (r && r.status) || 'freigegeben';
      toast('Bericht freigegeben.'); zeichne(); ctx.meldungenNeu();
    } catch (e) { toast(e.message, 'warn'); }
  }

  zeichne();
  const groesse = () => { Object.entries(pads).forEach(([r, p]) => { const box = $(`.sig-box[data-sig="${r}"]`, el); if (box && !box.classList.contains('hat')) p.loeschen(); }); };
  window.addEventListener('resize', groesse);
  return () => { window.removeEventListener('resize', groesse); spaeter.sofort(); };
}
