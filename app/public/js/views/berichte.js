// Bautagesberichte: Liste und Bearbeitung.
// Handy: Schritt-für-Schritt-Assistent. Tablet/PC: Formular im Aufbau der Papiervorlage.
import { get, post, put, del } from '../api.js';
import { ic, esc, fmt, parseZahl, laden, leer, banner, dialog, bestaetigen, toast, statusChip, entprellt, integBtn, $, $$, integAktiv, integVon } from '../ui.js';
import { stundenAus, personalFehler, bloecke } from '../zahl.js';
import { bildVerkleinern } from '../schaden-offline.js';
import { fernKnopf, fernDialog, fernLinksZeigen, fernWiderrufen, diktatHtml, diktatMikro, diktatVorschlag, lieferscheinKnopf, lieferscheinVorschlag, papierKnopf, papierAnhaengen, papierErkennen } from './bericht-assistent.js';

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
    ${darfNeu && integ.some((i) => i.schluessel === 'papier') ? `<div class="integ-row"><span class="assist-knopf"><button type="button" class="btn ghost sm" id="papier-liste">${ic('camera')}Papierbericht fotografieren</button><input type="file" id="papier-liste-datei" class="vh" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Papierbericht fotografieren"><small>Datum und Kostenstelle werden vom Formular gelesen und der passende Bericht vorgeschlagen. Handschrift nur mit der optionalen KI.</small></span></div>` : ''}
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
        <span class="rep-meta">${b.geaendertNachUnterschrift ? `<span class="chip xs st-amber" title="Eine Unterschrift wurde zurückgezogen – Inhalt kann danach geändert worden sein">${ic('alert')}nach Unterschrift geändert</span>` : ''}${b.stunden != null ? `<span class="muted sm nw">${fmt.zahl(b.stunden)} Std.</span>` : ''}${b.unterschriften ? `<span class="muted sm nw" title="Unterschriften">${ic('sign')}${(u.an ? 1 : 0) + (u.bh ? 1 : 0)}/2</span>` : ''}${statusChip(b.status)}</span>
        ${ic('right')}</a></li>`;
    }).join('')}</ul>` : leer(f.status || f.baustelleId ? 'Keine Berichte für diese Auswahl.' : 'Noch kein Bautagesbericht vorhanden.', 'clipboard');
  }
  el.addEventListener('change', (e) => {
    if (e.target.id === 'f-bs') { f.baustelleId = e.target.value; ladeListe(); }
    if (e.target.id === 'f-st') { f.status = e.target.value; ladeListe(); }
    if (e.target.id === 'papier-liste-datei') {
      const datei = (e.target.files || [])[0]; e.target.value = ''; if (!datei) return;
      papierErkennen(datei).then((r) => {
        const v = (r && r.vorschlag) || {};
        if (!v.datum && !v.baustelleId) { toast('Datum und Kostenstelle konnten nicht gelesen werden – bitte den Bericht händisch anlegen und das Foto dort anhängen.', 'warn'); neuerBericht(ctx, baustellen, f.baustelleId); return; }
        toast(`Erkannt: ${[v.kst ? 'KST ' + v.kst : '', v.datum ? fmt.datum(v.datum) : ''].filter(Boolean).join(', ')} – bitte prüfen.`);
        neuerBericht(ctx, baustellen, v.baustelleId || f.baustelleId, v.datum);
      }).catch((x) => toast(x.netz ? 'Keine Verbindung.' : x.message, 'warn'));
    }
  });
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-nochmal]')) ladeListe();
    if (e.target.closest('#neu')) neuerBericht(ctx, baustellen, f.baustelleId);
    if (e.target.closest('#papier-liste')) $('#papier-liste-datei', el).click();
  });
  await ladeListe();
}

function neuerBericht(ctx, baustellen, vorwahl, datumVorschlag) {
  const aktive = baustellen.filter((b) => !b.status || b.status === 'aktiv');
  const eigene = (ctx.ich.baustellenIds || []).map(String);
  const start = vorwahl || (aktive.find((b) => eigene.includes(String(b.id))) || aktive[0] || {}).id;
  const d = dialog({
    titel: 'Neuer Bautagesbericht',
    inhalt: `<form id="nb" class="stack-s">
      <label class="field"><span class="field-label">Baustelle</span><select class="input lg" name="baustelleId" required>${aktive.map((b) => `<option value="${b.id}" ${String(b.id) === String(start) ? 'selected' : ''}>${esc((b.kst ? b.kst + ' · ' : '') + b.name)}</option>`).join('')}</select></label>
      <label class="field"><span class="field-label">Datum</span><input class="input lg" type="date" name="datum" required value="${datumVorschlag && datumVorschlag <= fmt.iso() ? datumVorschlag : fmt.iso()}" max="${fmt.iso()}"></label>
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
export function signaturFeld(canvas) {
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
  // C-06: Die Unterschrift des Bauherrn zieht nur Büro/GF zurück (der Server prüft das ebenfalls)
  const darfZurueckziehen = (rolle) => b.status === 'entwurf' && (rolle === 'bh' ? ['buero', 'gf'].includes(ctx.ich.benutzer.rolle) : signierbar());
  const dis = () => (editierbar() ? '' : 'disabled');
  const gStd = (gid) => (b.geraete.find((g) => g.geraetId === gid) || {}).stunden || 0;
  // Servicebuch 7.2: konkrete Anlage je Gerätezeile (Auswahl bei mehreren, Warnung bei gesperrten)
  const gAnlagen = (gid) => ((geraeteKat.find((g) => g.id === gid) || {}).anlagen || []);
  const gZeile = (gid) => b.geraete.find((g) => g.geraetId === gid);
  const gAnlage = (gid) => { const z = gZeile(gid), l = gAnlagen(gid); if (!z || !(z.stunden > 0)) return null; return l.find((a) => a.id === z.anlageId) || (l.length === 1 ? l[0] : null); };
  let anlageHinweise = [];
  // F-11: dasselbe Gerät darf mehrfach vorkommen, wenn jede Zeile eine andere gewählte Anlage hat (z. B. zwei Radlader am selben Tag)
  const gWeitere = (gid) => b.geraete.filter((g) => g.geraetId === gid).slice(1);
  function anlagenZeile(gid) {
    const l = gAnlagen(gid), z = gZeile(gid);
    if (!l.length || !z || !(z.stunden > 0)) return '';
    const wahl = gAnlage(gid);
    const weitere = gWeitere(gid).filter((x) => x.stunden > 0 || x.neu);
    const belegt = new Set(weitere.map((x) => x.anlageId));
    const name = (a) => `${esc(a.bezeichnung)}${a.kennzeichen ? ' · ' + esc(a.kennzeichen) : ''}`;
    const warnung = (a) => (a && a.gesperrt ? `<p class="pf-ga-warn" role="alert" data-anlage-gesperrt="${a.id}">${ic('lock')}<span><b>${name(a)} ist gesperrt.</b> Das Gerät darf nicht verwendet werden – bitte im Büro bzw. in der Werkstatt nachfragen.</span></p>` : '');
    const chips = l.length > 1
      ? `<div class="pf-ga-chips" role="radiogroup" aria-label="Welches Gerät war im Einsatz?">${l.filter((a) => !belegt.has(a.id)).map((a) => `<button type="button" class="chip-btn${wahl && wahl.id === a.id ? ' on' : ''}${a.gesperrt ? ' gesperrt' : ''}" role="radio" aria-checked="${!!(wahl && wahl.id === a.id)}" data-anlage-wahl="${gid}:${a.id}" ${dis()}>${a.gesperrt ? ic('lock') + '<span class="vh">gesperrt: </span>' : ''}${name(a)}</button>`).join('')}</div>${wahl ? '' : '<small class="pf-ga-frage">Welches Gerät war im Einsatz?</small>'}`
      : `<small class="pf-ga-eins">${ic(l[0].gesperrt ? 'lock' : 'truck', 'xs')} ${name(l[0])}</small>`;
    const zusatz = weitere.map((x) => { const a = l.find((y) => y.id === x.anlageId) || { id: x.anlageId, bezeichnung: (x.anlage && x.anlage.bezeichnung) || 'Gerät' }; return `<div class="pf-ga-extra" data-extra="${gid}:${a.id}"><span>${a.gesperrt ? ic('lock', 'xs') + ' ' : ''}${name(a)}</span>${stepper(`data-geraet-extra="${gid}:${a.id}"`, x.stunden, 0.5, 'Stunden', a.bezeichnung)}<small>Std.</small></div>${warnung(a)}`; }).join('');
    const frei = l.filter((a) => (!wahl || a.id !== wahl.id) && !belegt.has(a.id));
    const dazu = l.length > 1 && wahl && z.anlageId != null && frei.length && editierbar() ? `<div class="pf-ga-dazu">${frei.map((a) => `<button type="button" class="btn ghost sm" data-anlage-dazu="${gid}:${a.id}">${ic('plus')}auch im Einsatz: ${name(a)}</button>`).join('')}</div>` : '';
    return chips + warnung(wahl) + zusatz + dazu;
  }
  const zeigHinweise = () => { const h = $('#anlage-hinweise', el); if (!h) return; h.hidden = !anlageHinweise.length; h.innerHTML = anlageHinweise.length ? banner('warn', `<b>Gesperrtes Gerät im Bericht:</b> ${anlageHinweise.map((x) => esc(x.text)).join(' · ')} – der Bericht wird trotzdem gespeichert, das Büro wird verständigt.`, 'lock') : ''; };
  const mMenge = (mid) => (b.material.find((m) => m.materialId === mid) || {}).menge || 0;
  // Menge, die aus erledigten Fuhren in die Materialzeile kam (12.8b) – nur zur Kennzeichnung
  const matZeile = (mid) => b.material.find((m) => m.materialId === mid) || {};
  const fuhrMarke = (m) => { const z = matZeile(m.id); if (!z.quelle || !(z.ausFuhren > 0)) return ''; return ` <i class="chip xs st-outline" data-aus-fuhre="${esc(z.quelle)}">${ic('truck')}${z.quelle === 'fuhre' ? 'aus Fuhre' : `davon ${esc(fmt.zahl(z.ausFuhren, 2))} ${esc(m.einheit || '')} aus Fuhren`}</i>`; };
  // Material, das im Bericht steht, aber inzwischen deaktiviert ist: bleibt sichtbar, steht aber in keiner neuen Auswahl
  const matListe = () => [...matKat, ...b.material.filter((z) => !matKat.some((m) => m.id === z.materialId)).map((z) => ({ id: z.materialId, name: z.name || 'Material', einheit: z.einheit, deaktiviert: true }))];
  const gesamt = () => rund2(b.personal.reduce((s, p) => s + (Number(p.stunden) || 0), 0));

  /* ---- Speichern (automatisch, entprellt) ---- */
  const offen = new Set();
  let speichert = false, fehlerText = '';
  let gespeichertUm = null;
  let konflikt = false;
  // Fehlermeldung des Servers der betroffenen Personalzeile zuordnen („personal[2]: …“ oder über den Namen)
  function zeigeServerFehler(text) {
    $$('#personal .bp-row .bp-srv', el).forEach((x) => x.remove());
    $$('#personal .bp-row.srv', el).forEach((x) => x.classList.remove('srv'));
    const m = /personal\[(\d+)\]/.exec(text || '');
    let i = m ? Number(m[1]) : b.personal.findIndex((p) => p.name && String(text || '').includes(p.name));
    const pr = i >= 0 ? $(`#personal .bp-row[data-i="${i}"]`, el) : null;
    if (!pr) return;
    pr.classList.add('srv');
    const h = document.createElement('p'); h.className = 'bp-err bp-srv'; h.setAttribute('role', 'alert'); h.textContent = String(text).replace(/^personal\[\d+\]:?\s*/, '');
    pr.appendChild(h);
  }
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
      u.dataset.art = konflikt ? 'konflikt' : inv ? 'ungueltig' : 'fehler';
      let nl = $('[data-konflikt-laden]', u);
      if (konflikt && !nl) { nl = document.createElement('button'); nl.type = 'button'; nl.className = 'btn ghost sm'; nl.dataset.konfliktLaden = '1'; nl.textContent = 'Neu laden'; u.appendChild(nl); }
      if (!konflikt && nl) nl.remove();
      $('span', u).textContent = inv
        ? 'Nicht gespeichert: Beim Personal sind Zeiten unvollständig oder widersprüchlich (rot markiert). Bitte korrigieren – vorher kann nicht unterschrieben werden.'
        : konflikt ? 'Inzwischen von jemand anderem geändert. Ihre letzten Eingaben wurden NICHT gespeichert und überschreiben nichts. Bitte neu laden und die Änderung noch einmal eintragen.'
        : fehlerText ? `Nicht gespeichert: ${fehlerText}${/Verbindung/.test(fehlerText) ? ' Die Eingaben bleiben am Bildschirm und werden bei der nächsten Änderung erneut gesendet.' : ''}` : '';
    }
  };
  const wert = (feld) => {
    if (feld === 'geraete') return b.geraete.filter((g, i) => g.stunden > 0 && (g.anlageId != null || b.geraete.findIndex((x) => x.geraetId === g.geraetId) === i)).map((g) => ({ geraetId: g.geraetId, stunden: g.stunden, ...(g.anlageId != null ? { anlageId: g.anlageId } : {}) }));
    if (feld === 'material') return b.material.filter((m) => m.menge > 0).map((m) => ({ materialId: m.materialId, menge: m.menge }));
    if (feld === 'personal') return b.personal.map((p) => ({ benutzerId: p.benutzerId, von1: p.von1 || null, bis1: p.bis1 || null, von2: p.von2 || null, bis2: p.bis2 || null, pauseMin: Number(p.pauseMin) || 0, code: p.code || null, segStunden: Number(p.segStunden) || 0, ...(p.gast ? { gast: true } : {}) })); // Stunden berechnet der Server
    if (feld === 'regie') return b.regie.filter((r) => (r.text || '').trim() || r.stunden > 0).map((r) => ({ text: r.text || '', stunden: Number(r.stunden) || 0 }));
    return b[feld];
  };
  async function sichern() {
    if (speichert || !offen.size || konflikt) return;
    // Ungültiges Personal wird nicht gesendet – es bleibt als „offen“ stehen, bis es stimmt
    const felder = [...offen].filter((f) => f !== 'personal' || !ungueltig());
    if (!felder.length) { anzeige(); return; }
    felder.forEach((f) => offen.delete(f));
    speichert = true; anzeige();
    try {
      const body = {}; felder.forEach((f) => { body[f] = wert(f); });
      body.version = b.version; // C-08: der Server lehnt veraltete Stände ab
      const neu = await put(`/berichte/${id}`, body);
      if (neu && neu.version != null) b.version = neu.version;
      if (neu && 'kostenTag' in neu) { b.kostenTag = neu.kostenTag; zeichneKosten(); }
      if (neu && Array.isArray(neu.hinweise) && felder.includes('geraete')) { anlageHinweise = neu.hinweise.filter((h) => h.typ === 'anlage_gesperrt'); zeigHinweise(); }
      // Die vom Server berechneten Stunden sind maßgeblich – Anzeige danach richten
      if (neu && Array.isArray(neu.personal) && felder.includes('personal') && !offen.has('personal')) {
        neu.personal.forEach((np) => { const p = b.personal.find((x) => x.benutzerId === np.benutzerId); if (p) { p.stunden = np.stunden; p.hinweis = np.hinweis; } });
        $$('#personal .bp-row', el).forEach((pr) => { const p = b.personal[Number(pr.dataset.i)]; if (p) $('[data-p-std]', pr).textContent = fmt.zahl(p.stunden || 0); });
        const g = $('#gesamt', el); if (g) g.textContent = fmt.zahl(gesamt());
      }
      fehlerText = ''; gespeichertUm = Date.now();
    } catch (e) {
      felder.forEach((f) => offen.add(f)); // nichts gilt als gespeichert, was der Server nicht bestätigt hat
      fehlerText = e.netz ? 'Keine Verbindung zum Server.' : e.message;
      speichert = false; anzeige();
      if (e.status === 409 && e.daten && e.daten.version != null) {
        // C-08: jemand anderer hat inzwischen gespeichert – nichts überschreiben, Eingaben stehen lassen, Neu-Laden anbieten
        konflikt = true; fehlerText = 'Inzwischen von jemand anderem geändert.'; anzeige();
      } else if (e.status === 409) { toast('Der Bericht wurde inzwischen unterschrieben – er wird neu geladen.', 'warn'); offen.clear(); ctx.neuLaden(); }
      else if (e.status === 400) zeigeServerFehler(e.message); // C-01: z. B. Überschneidung – an der betroffenen Zeile zeigen
      return;
    }
    speichert = false; anzeige();
    if ([...offen].some((f) => f !== 'personal' || !ungueltig())) sichern();
  }
  const spaeter = entprellt(sichern, 600);
  const geaendert = (feld) => { if (!editierbar()) return; offen.add(feld); if (!konflikt) fehlerText = ''; if (feld === 'personal') zeigeServerFehler(''); anzeige(); spaeter(); };
  const allesSichern = async () => { if (ungueltig() || konflikt) return false; spaeter.sofort(); for (let i = 0; i < 40 && (speichert || offen.size) && !fehlerText; i++) await new Promise((r) => setTimeout(r, 100)); return !fehlerText && !offen.size && !speichert; };

  /* ---- Bausteine ---- */
  const stepper = (attr, val, schrittw, einheit, label) => `
    <span class="stepper" data-stepper ${attr} data-schritt="${schrittw}">
      <button type="button" data-d="-1" aria-label="${esc(label)} verringern" ${dis()}>${ic('minus')}</button>
      <input type="text" inputmode="decimal" value="${val ? fmt.zahl(val) : ''}" placeholder="0" aria-label="${esc(label)}${einheit ? ' in ' + esc(einheit) : ''}" ${dis()}>
      <button type="button" data-d="1" aria-label="${esc(label)} erhöhen" ${dis()}>${ic('plus')}</button>
    </span>`;

  function personalHtml() {
    const waehlbar = mitarbeiter.filter((m) => m.aktiv !== false && m.aktiv !== 0 && ['mitarbeiter', 'polier'].includes(m.rolle) && !b.personal.some((p) => p.benutzerId === m.id));
    const inPartie = (m) => m.baustelleId === b.baustelleId || m.id === bs.polierId;
    const partie = waehlbar.filter(inPartie), gaeste = waehlbar.filter((m) => !inPartie(m));
    const frei = waehlbar;
    return `
      <div class="bp" role="table" aria-label="Personal">
        <div class="bp-head" role="row"><span role="columnheader">Name</span><span role="columnheader">von</span><span role="columnheader">bis</span><span role="columnheader">von</span><span role="columnheader">bis</span><span role="columnheader">Pause</span><span role="columnheader">Arbstd.</span><span role="columnheader">SEG</span><span role="columnheader">Code</span><span></span></div>
        ${b.personal.length ? b.personal.map((p, i) => `
        <div class="bp-row" role="row" data-i="${i}">
          <span class="bp-name" role="cell"><b>${esc(p.name || (mitarbeiter.find((m) => m.id === p.benutzerId) || {}).name || 'Mitarbeiter')}</b>${p.gast ? '<span class="chip xs st-amber" data-gast>Gast</span>' : ''}${p.hinweis ? `<small class="bp-hinweis">${ic('alert', 'xs')} ${esc(p.hinweis)}</small>` : ''}</span>
          ${['von1', 'bis1', 'von2', 'bis2'].map((k, n) => `<label role="cell"><span class="bp-l">${n % 2 ? 'bis' : 'von'}${n > 1 ? ' (2)' : ''}</span><input type="time" class="input s" data-p="${k}" value="${esc(p[k] || '')}" aria-label="${esc(p.name || '')} ${n % 2 ? 'bis' : 'von'} ${n > 1 ? 'Nachmittag' : 'Vormittag'}" ${dis()}></label>`).join('')}
          <label role="cell"><span class="bp-l">Pause (min)</span><input type="text" inputmode="numeric" class="input s num" data-p="pauseMin" value="${p.pauseMin || ''}" placeholder="0" aria-label="${esc(p.name || '')} Pause in Minuten" ${dis()}></label>
          <span role="cell" class="bp-std"><span class="bp-l">Arbeitsstd.</span><output data-p-std aria-label="${esc(p.name || '')} Arbeitsstunden (berechnet aus den Zeiten)" title="Wird aus den Zeiten und der Pause berechnet">${fmt.zahl(p.stunden || 0)}</output></span>
          <label role="cell"><span class="bp-l">SEG-Std.</span><input type="text" inputmode="decimal" class="input s num" data-p="segStunden" value="${p.segStunden ? fmt.zahl(p.segStunden) : ''}" placeholder="0" aria-label="${esc(p.name || '')} SEG-Stunden (Schmutz, Erschwernis, Gefahr)" ${dis()}></label>
          <label role="cell"><span class="bp-l">Code</span><select class="input s" data-p="code" aria-label="${esc(p.name || '')} Abwesenheits-Code" ${dis()}>${CODES.map(([k, t]) => `<option value="${k}" ${(p.code || '') === k ? 'selected' : ''}>${k ? esc(k) : '–'}</option>`).join('')}</select></label>
          <span role="cell" class="bp-del">${editierbar() ? `<button type="button" class="icon-btn sm" data-p-weg aria-label="${esc(p.name || 'Person')} entfernen">${ic('trash')}</button>` : ''}</span>
        </div>`).join('') : `<div class="state empty small">${ic('users')}<p>Für diesen Tag wurde auf dieser Baustelle niemand gestempelt. Personen können händisch ergänzt werden.</p></div>`}
        <div class="bp-foot"><span>Gesamtstunden</span><b id="gesamt">${fmt.zahl(gesamt())}</b></div>
      </div>
      <p class="pf-legend">K = Krank · U = Urlaub · SW = Schlechtwetter · ZA = Zeitausgleich</p>
      ${editierbar() ? `<div class="add-line">${frei.length ? `<select class="input" id="p-neu" aria-label="Person hinzufügen"><option value="">Person hinzufügen …</option>${partie.length ? `<optgroup label="Partie dieser Baustelle">${partie.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</optgroup>` : ''}${gaeste.length ? `<optgroup label="Gast aus anderer Partie (wird protokolliert)">${gaeste.map((m) => `<option value="${m.id}" data-gast="1">${esc(m.name)} (Gast)</option>`).join('')}</optgroup>` : ''}</select>` : ''}<button type="button" class="btn ghost sm" data-p-sync>${ic('sync')}Aus Stempelungen neu übernehmen</button></div>` : ''}`;
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
    if (u) return `<div class="sig-box signed" data-sig="${rolle}"><div class="sig-h"><div><b>${titel}</b><small>${sub}</small></div><span class="chip st-green">${ic('check')}Unterschrieben</span></div><div class="sig-done">${u.bildPng && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(u.bildPng) ? `<img src="${u.bildPng}" alt="Unterschrift ${esc(u.name || '')}">` : ic('sign')}<div><b>${esc(u.name || '')}</b><small>${esc(fmt.zeitpunkt(u.zeit))} Uhr</small></div></div>${darfZurueckziehen(rolle) ? `<button type="button" class="btn ghost sm" data-sig-weg="${rolle}">Unterschrift zurückziehen</button>` : rolle === 'bh' && signierbar() ? '<p class="muted sm" data-bh-fest>Die Unterschrift des Bauherrn kann nur das Büro oder die Geschäftsführung zurückziehen.</p>' : ''}</div>`;
    if (!signierbar()) return `<div class="sig-box" data-sig="${rolle}"><div class="sig-h"><div><b>${titel}</b><small>${sub}</small></div></div><p class="muted sm">Keine Unterschrift vorhanden.</p></div>`;
    return `<div class="sig-box" data-sig="${rolle}">
      <div class="sig-h"><div><b>${titel}</b><small>${sub}</small></div><button type="button" class="btn ghost sm" data-sig-clear>Löschen</button></div>
      <div class="sig-pad"><canvas aria-label="Unterschriftsfeld ${titel}" role="img"></canvas><span class="sig-ph">${ic('sign')}Hier unterschreiben</span><span class="sig-line"></span></div>
      <label class="field"><span class="field-label">Name in Blockschrift</span><input type="text" class="input" data-sig-name value="${rolle === 'an' ? esc(ctx.ich.benutzer.name) : ''}" placeholder="${rolle === 'an' ? 'Name' : 'Name Bauherr / Vertreter'}" autocomplete="off"></label>
      <button type="button" class="btn primary block" data-sig-save>${ic('check')}Unterschrift speichern</button>
      ${rolle === 'bh' ? fernKnopf(integ) : ''}
    </div>`;
  }
  // 12.5: „PDF an Auftraggeber senden“ ist echt, sobald der E-Mail-Versand eingerichtet ist – sonst deaktiviert mit Hinweis
  const darfMailen = () => ctx.kann('bericht_freigeben') || ctx.kann('stammdaten');
  const mailAn = () => !!(integ.find((i) => i.schluessel === 'email') || {}).angebunden;
  function mailKnopf() {
    if (!darfMailen()) return '';
    const grund = !mailAn() ? 'E-Mail-Versand ist noch nicht eingerichtet (Geschäftsführung: Benutzer & Rechte → Dienste & Sicherheit).' : b.status === 'entwurf' ? 'Erst nach beiden Unterschriften möglich.' : '';
    return `<span class="mail-ag" data-mail="${grund ? 'aus' : 'an'}"><button type="button" class="btn ghost" id="mail-ag" ${grund ? 'disabled aria-describedby="mail-ag-hinweis"' : ''}>${ic('mail')}PDF an Auftraggeber senden</button>${grund ? `<small id="mail-ag-hinweis">${!mailAn() ? '<b>Noch nicht eingerichtet</b> · ' : ''}${esc(grund)}</small>` : ''}</span>`;
  }
  const VERSAND = { wartet: ['wird gesendet', 'st-amber'], gesendet: ['gesendet', 'st-green'], fehler: ['fehlgeschlagen', 'st-red'] };
  const versandHtml = () => ((b.emailVersand || []).length ? `<ul class="plain rows" id="mail-versand">${b.emailVersand.map((v) => `<li><span class="grow"><b>${esc(v.an || '')}</b><small>${esc(fmt.zeitpunkt(v.zeit))}${v.fehler ? ' · ' + esc(v.fehler) : ''}</small></span><span class="chip xs ${(VERSAND[v.status] || ['', 'st-grey'])[1]}" data-versand="${esc(v.status)}">${esc((VERSAND[v.status] || [v.status])[0])}</span></li>`).join('')}</ul>` : '');
  function mailDialog() {
    const d = dialog({ titel: 'Bericht an den Auftraggeber senden', inhalt: `<form id="mf2" class="stack-s" novalidate>
      <label class="field"><span class="field-label">Empfänger (mehrere mit Komma)</span><input class="input lg" name="an" maxlength="300" value="${esc(bs.agEmail || '')}" placeholder="name@auftraggeber.at"></label>
      ${banner('info', 'Gesendet wird das PDF der Fassung für den Auftraggeber – ohne Preise und ohne interne Angaben.')}
      <p class="form-err" role="alert" hidden></p></form>`, fuss: '<button class="btn ghost" type="button" data-zu>Abbrechen</button><button class="btn primary" type="submit" form="mf2">Senden</button>' });
    $('#mf2', d.el).addEventListener('submit', async (e) => {
      e.preventDefault(); const an = String(new FormData(e.target).get('an') || '').trim(); const err = $('.form-err', d.el);
      if (!an || !an.split(',').every((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x.trim()))) { err.hidden = false; err.textContent = 'Bitte eine gültige E-Mail-Adresse eintragen.'; return; }
      try {
        const r = await post(`/berichte/${id}/email`, { an });
        b.emailVersand = [...(b.emailVersand || []), { id: r.id, zeit: new Date().toISOString(), an, status: r.status || 'wartet' }];
        d.zu(); toast('Der Bericht wird gesendet.'); $('#abschluss', el).innerHTML = abschlussHtml(); sigInit();
        setTimeout(async () => { try { const neu = await get(`/berichte/${id}`); if (ctx.aktuell() && neu.emailVersand) { b.emailVersand = neu.emailVersand; const v = $('#mail-versand-box', el); if (v) v.innerHTML = versandHtml(); } } catch (x) { /* Anzeige bleibt */ } }, 2500);
      } catch (x) { err.hidden = false; err.textContent = x.message; }
    });
  }
  function abschlussHtml() {
    const u = b.unterschriften;
    const darfFrei = ctx.kann('bericht_freigeben');
    return `
      <div class="pf-two sigs">${sigHtml('an', 'AUFTRAGNEHMER', 'oder dessen Beauftragter')}${sigHtml('bh', 'BAUHERR', 'oder dessen bevollmächtigter Vertreter')}</div>
      ${signierbar() && !signiert() ? banner('info', 'Mit der ersten Unterschrift wird der Inhalt gesperrt. Bitte vorher alles prüfen.') : ''}
      <div class="final-bar">
        <div class="final-state">${statusChip(b.status)}<span class="muted sm">${b.status === 'entwurf' ? `${(u.an ? 1 : 0) + (u.bh ? 1 : 0)} von 2 Unterschriften` : b.status === 'unterschrieben' ? 'Wartet auf Freigabe durch Büro/Bauleitung' : 'Freigegeben – fließt in die Auswertungen ein'}</span></div>
        <a class="btn ghost" id="pdf" href="/api/berichte/${id}/pdf${(b.fotos || []).length ? '?fotos=1' : ''}" target="_blank" rel="noopener">${ic('file')}PDF öffnen</a>
        ${mailKnopf()}
        ${darfFrei && b.status !== 'freigegeben' ? `<button type="button" class="btn primary" id="freigeben" ${b.status === 'unterschrieben' ? '' : 'disabled'} ${b.status === 'unterschrieben' ? '' : 'title="Freigabe erst möglich, wenn beide unterschrieben haben"'}>${ic('check')}Freigeben</button>` : ''}
      </div>
      <div id="mail-versand-box">${darfMailen() ? versandHtml() : ''}</div>`;
  }
  /* ---- Wetter (API.md 12.4): echte Daten von GeoSphere Austria oder ehrlich „nicht verfügbar“ ---- */
  const MAX_FOTOS = 10;
  let wetterGrund = '';
  function wetterHtml() {
    const w = b.wetter; const v = b.wetterVorschlag;
    const text = w ? (typeof w === 'string' ? w : w.text || [w.temperatur != null ? `${fmt.zahl(w.temperatur, 1)} °C` : '', w.niederschlag != null ? `${fmt.zahl(w.niederschlag, 1)} mm` : '', w.wind != null ? `Wind ${fmt.zahl(w.wind, 0)} km/h` : ''].filter(Boolean).join(', ')) : '';
    const knopf = editierbar() ? `<button type="button" class="btn ghost sm" id="wetter-holen">${ic('sync')}${w ? 'Wetter aktualisieren' : 'Wetter abrufen'}</button>` : '';
    if (!w) return `<div class="wetter leer" data-wetter="fehlt">${ic('cloud')}<span><b>Wetter nicht verfügbar</b><small id="wetter-grund">${esc(wetterGrund || 'Für diesen Bericht liegen keine Wetterdaten vor.')}</small></span>${knopf}</div>`;
    return `<div class="wetter" data-wetter="da">${ic('cloud')}<span><b>${esc(text)}</b><small>${esc((typeof w === 'object' && w.quelle) || 'Wetterdaten')}</small></span>${knopf}</div>
      ${v && v.vorschlag ? `<div class="banner warn" id="sw-vorschlag" role="note">${ic('alert')}<span><b>Schlechtwetter möglich${v.ab ? ` ab ${esc(v.ab)} Uhr` : ''}:</b> ${esc((v.gruende || []).join(', '))}. Das ist nur ein Hinweis – ob Schlechtwetter gilt, entscheidet der Polier; gemeldet wird es unter „Abwesenheiten“.</span></div>` : ''}`;
  }
  async function wetterGrundLaden() {
    if (b.wetter || !bs.id) return;
    if (!integAktiv(integ, 'wetter')) { wetterGrund = (integVon(integ, 'wetter') || {}).hinweis || 'Der Wetterabruf ist nicht eingerichtet.'; const g0 = $('#wetter-grund', el); if (g0) g0.textContent = wetterGrund; return; }
    try {
      const r = await get(`/baustellen/${bs.id}/wetter?datum=${b.datum}`);
      wetterGrund = r.verfuegbar ? 'Für diesen Tag gibt es Wetterdaten – mit „Wetter abrufen“ in den Bericht übernehmen.' : [r.hinweis, r.grund].filter(Boolean).join(': ');
    } catch (e) { wetterGrund = e.netz ? 'Keine Verbindung – Wetter kann gerade nicht abgerufen werden.' : ''; }
    const g = $('#wetter-grund', el); if (g && wetterGrund) g.textContent = wetterGrund;
  }
  async function wetterHolen() {
    const k = $('#wetter-holen', el); if (k) k.disabled = true;
    if (!(await allesSichern())) { toast('Bitte zuerst die offenen Änderungen speichern.', 'warn'); if (k) k.disabled = false; return; }
    try {
      const neu = await post(`/berichte/${id}/wetter`, { version: b.version });
      b.wetter = neu.wetter; b.wetterVorschlag = neu.wetterVorschlag; if (neu.version != null) b.version = neu.version;
      toast(b.wetter ? 'Wetter übernommen.' : 'Wetter nicht verfügbar.', b.wetter ? 'ok' : 'warn');
    } catch (e) { toast(e.message, 'warn'); }
    if (!b.wetter) await wetterGrundLaden();
    const box = $('#wetter-karte', el); if (box) box.innerHTML = wetterHtml();
  }

  /* ---- Fotos (API.md 12.6): bis zu 10, am Gerät verkleinert, nur im Entwurf ohne Unterschrift ---- */
  function fotosHtml() {
    const f = b.fotos || [];
    return `${f.length ? `<ul class="foto-galerie" id="foto-liste">${f.map((x) => `<li data-foto="${x.id}"><a href="${esc(x.url || `/api/berichte/${id}/fotos/${x.id}`)}" target="_blank" rel="noopener" aria-label="Foto ${esc(x.beschreibung || x.dateiname || '')} groß ansehen"><img src="${esc(x.url || `/api/berichte/${id}/fotos/${x.id}`)}" alt="${esc(x.beschreibung || 'Foto zum Bautagesbericht')}" loading="lazy"></a>${x.art && x.art !== 'foto' ? `<span class="chip xs st-outline foto-art" data-foto-art="${esc(x.art)}">${x.art === 'lieferschein' ? 'Lieferschein' : 'Papierbericht'}</span>` : ''}
        ${editierbar() ? `<input class="input s foto-text" data-foto-text value="${esc(x.beschreibung || '')}" maxlength="300" placeholder="Beschreibung" aria-label="Beschreibung zum Foto"><button type="button" class="icon-btn sm foto-weg" data-foto-weg aria-label="Foto entfernen">${ic('trash')}</button>` : x.beschreibung ? `<small>${esc(x.beschreibung)}</small>` : ''}</li>`).join('')}</ul>` : `<p class="muted sm" id="foto-leer">${editierbar() ? 'Noch keine Fotos.' : 'Keine Fotos.'}</p>`}
      ${editierbar() ? `<div class="foto-leiste"><button type="button" class="btn ghost" id="foto-neu" ${f.filter((x) => x.art !== 'papier').length >= MAX_FOTOS ? 'disabled' : ''}>${ic('camera')}Foto hinzufügen</button><input type="file" id="foto-datei" class="vh" accept="image/jpeg,image/png,image/webp" multiple aria-label="Fotos auswählen oder aufnehmen"><span class="muted sm" id="foto-zahl">${f.filter((x) => x.art !== 'papier').length} von ${MAX_FOTOS}</span></div><p class="form-err" id="foto-err" role="alert" hidden></p>` : ''}`;
  }
  const fotosNeu = () => { const box = $('#fotos', el); if (box) box.innerHTML = fotosHtml(); };
  async function fotosHochladen(dateien) {
    const err = (t) => { const e = $('#foto-err', el); if (e) { e.hidden = !t; e.textContent = t || ''; } };
    err('');
    const frei = MAX_FOTOS - (b.fotos || []).filter((x) => x.art !== 'papier').length;
    let liste = [...dateien];
    if (liste.length > frei) { err(`Es sind höchstens ${MAX_FOTOS} Fotos je Bericht möglich – ${liste.length - frei} wurde${liste.length - frei > 1 ? 'n' : ''} nicht übernommen.`); liste = liste.slice(0, Math.max(0, frei)); }
    const k = $('#foto-neu', el); if (k) { k.disabled = true; k.dataset.laedt = '1'; }
    for (const datei of liste) {
      try {
        if (!/^image\/(jpeg|png|webp)$/.test(datei.type)) throw new Error(`„${datei.name}“ ist kein Foto (JPEG, PNG oder WebP).`);
        const bild = await bildVerkleinern(datei);
        const neu = await post(`/berichte/${id}/fotos`, { bildBase64: bild.daten, dateiname: bild.dateiname });
        b.fotos = b.fotos || [];
        if (!b.fotos.some((x) => x.id === neu.id)) b.fotos.push(neu);
      } catch (e) { err(e.netz ? 'Keine Verbindung – das Foto wurde nicht hochgeladen. Bitte später erneut versuchen.' : e.message); if (e.netz || e.status === 409) break; }
    }
    const e0 = $('#foto-err', el); const text = e0 && !e0.hidden ? e0.textContent : '';
    fotosNeu(); if (text) err(text);
  }

  /* ---- Übernahme von Vorschlägen (Diktat, Lieferschein): Felder füllen und markieren ---- */
  const kiFelder = new Set();
  function markiereKi() {
    $$('.ki-neu', el).forEach((x) => x.classList.remove('ki-neu'));
    for (const k of kiFelder) {
      const [art, wert] = k.split(':');
      const ziel = art === 'g' ? $(`.pf-g[data-g="${wert}"]`, el) : art === 'm' ? $(`.mat-row[data-m="${wert}"]`, el) : art === 'p' ? $(`.bp-row[data-i="${b.personal.findIndex((x) => String(x.benutzerId) === wert)}"]`, el) : art === 'r' ? $('#regie', el) : $(`[data-f="${wert}"]`, el);
      if (ziel) ziel.classList.add('ki-neu');
    }
    const chip = $('#ki-chip', el);
    if (chip) { chip.hidden = !kiFelder.size; chip.dataset.anzahl = kiFelder.size; chip.innerHTML = `${ic('spark')}${kiFelder.size} ${kiFelder.size === 1 ? 'Feld' : 'Felder'} ausgefüllt – bitte prüfen`; }
  }
  function uebernehmen(wahl, { addieren = false } = {}) {
    if (!wahl) return 0;
    let n = 0;
    for (const z of wahl.geraete || []) { let g = b.geraete.find((x) => x.geraetId === z.id); if (!g) { g = { geraetId: z.id, stunden: 0 }; b.geraete.push(g); } g.stunden = rund2(z.wert); kiFelder.add(`g:${z.id}`); offen.add('geraete'); n++; }
    for (const z of wahl.material || []) { let m = b.material.find((x) => x.materialId === z.id); if (!m) { m = { materialId: z.id, menge: 0 }; b.material.push(m); } m.menge = rund2(addieren ? (m.menge || 0) + z.wert : z.wert); kiFelder.add(`m:${z.id}`); offen.add('material'); n++; }
    for (const z of wahl.personal || []) { const p = b.personal.find((x) => x.benutzerId === z.id); if (!p) continue; p.von1 = z.von; p.bis1 = z.bis; p.von2 = ''; p.bis2 = ''; p.stunden = stundenAus(p, b.datum); kiFelder.add(`p:${z.id}`); offen.add('personal'); n++; }
    for (const z of wahl.arbeitsleistung || []) { b.arbeitsleistung = [b.arbeitsleistung, z.wert].filter((x) => x && String(x).trim()).join('\n'); kiFelder.add('f:arbeitsleistung'); offen.add('arbeitsleistung'); n++; }
    for (const z of wahl.vorkommnisse || []) { b.vorkommnisse = [b.vorkommnisse, z.wert].filter((x) => x && String(x).trim()).join('\n'); kiFelder.add('f:vorkommnisse'); offen.add('vorkommnisse'); n++; }
    for (const z of wahl.regie || []) { b.regie.push({ text: z.text, stunden: rund2(z.wert) }); kiFelder.add('r:x'); offen.add('regie'); n++; }
    for (const z of wahl.beistellung || []) { b.materialbeistellung.fremd = [b.materialbeistellung.fremd, z.wert].filter((x) => x && String(x).trim()).join('\n'); kiFelder.add('f:materialbeistellung.fremd'); offen.add('materialbeistellung'); n++; }
    if (n) { fehlerText = ''; zeichne(); spaeter(); }
    return n;
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
    const gSpalte = (liste) => liste.map((g) => `<div class="pf-g${gStd(g.id) ? ' on' : ''}" data-g="${g.id}"><span>${esc(g.name)}</span>${stepper(`data-geraet="${g.id}"`, gStd(g.id), 0.5, 'Stunden', g.name)}<small>Std.</small></div>${(g.anlagen || []).length ? `<div class="pf-ga" data-ga="${g.id}">${anlagenZeile(g.id)}</div>` : ''}`).join('');
    const wetter = b.wetter ? (typeof b.wetter === 'string' ? b.wetter : [b.wetter.text || b.wetter.beschreibung, b.wetter.temperatur != null ? `${fmt.zahl(b.wetter.temperatur, 1)} °C` : ''].filter(Boolean).join(', ')) : '';
    el.innerHTML = `
    <div class="page form-page">
      <div class="form-top">
        <a class="link-back" href="#/berichte">${ic('left')}Alle Berichte</a>
        <span class="grow"></span>
        ${statusChip(b.status)}
        <span class="chip st-blue" id="ki-chip" hidden></span>
        ${editierbar() ? '<span class="save-state neutral" id="save-state" role="status"></span>' : ''}
      </div>
      ${b.status === 'entwurf' && signiert() ? `<div id="gesperrt-hinweis">${banner('info', '<b>Inhalt gesperrt:</b> Es liegt bereits eine Unterschrift vor. Der Bericht kann nicht mehr geändert werden – es fehlt nur noch die zweite Unterschrift.', 'lock')}</div>` : !editierbar() && b.status === 'entwurf' ? banner('info', 'Nur Ansicht – zum Bearbeiten fehlt die Berechtigung.') : ''}
      ${b.selbstfreigabe ? `<div id="selbstfreigabe">${banner('warn', '<b>Selbstfreigabe:</b> Dieser Bericht wurde von derselben Person freigegeben, die die Unterschrift des Auftragnehmers erfasst hat (nur der Geschäftsführung möglich, im Protokoll vermerkt).')}</div>` : ''}
      ${b.geaendertNachUnterschrift ? `<div id="nach-unterschrift">${banner('warn', `<b>Achtung – Unterschrift wurde zurückgezogen:</b> ${b.geaendertNachUnterschrift.zeit ? `am ${esc(fmt.zeitpunkt(b.geaendertNachUnterschrift.zeit))} Uhr` : ''}${b.geaendertNachUnterschrift.rolle ? ` (${b.geaendertNachUnterschrift.rolle === 'bh' ? 'Bauherr' : 'Auftragnehmer'})` : ''}${b.geaendertNachUnterschrift.von ? ` durch ${esc(typeof b.geaendertNachUnterschrift.von === 'object' ? b.geaendertNachUnterschrift.von.name || '' : (mitarbeiter.find((m) => m.id === b.geaendertNachUnterschrift.von) || {}).name || b.geaendertNachUnterschrift.von)}` : ''}. Der Inhalt kann danach geändert worden sein – vor der Freigabe bitte genau prüfen. Der Vermerk steht auch im PDF.`)}</div>` : ''}
      <div class="banner err" id="unsaved" role="alert" hidden>${ic('alert')}<span></span></div>
      ${b.status !== 'entwurf' ? banner(b.status === 'freigegeben' ? 'ok' : 'info', b.status === 'freigegeben' ? 'Dieser Bericht ist freigegeben und abgeschlossen.' : 'Dieser Bericht ist unterschrieben und kann nicht mehr geändert werden.', b.status === 'freigegeben' ? 'check' : 'lock') : ''}
      <div id="anlage-hinweise" hidden></div>
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
          <section class="pf-sec a-mat" data-step="3" aria-labelledby="h-mat"><h4 id="h-mat">MATERIAL <span>Menge</span></h4>
          ${(b.fuhrenVorschlag || []).length ? `<div class="fuhr-vorschlag" id="fuhren-vorschlag"><b>${ic('truck')}${b.fuhrenVorschlag.length} Fuhre${b.fuhrenVorschlag.length === 1 ? '' : 'n'} abgeladen – noch nicht im Bericht</b><ul class="plain">${b.fuhrenVorschlag.map((v) => `<li data-fuhre="${v.fuhreId}"><span class="grow">${esc(v.name || 'Material')} · <b>${esc(fmt.zahl(v.menge, 2))} ${esc(v.einheit || '')}</b>${v.fahrer ? ` · ${esc(v.fahrer)}` : ''}${v.zeit ? ` · ${esc(fmt.uhr(v.zeit))}` : ''}${v.hinweis ? `<small>${esc(v.hinweis)}</small>` : ''}</span></li>`).join('')}</ul>${editierbar() ? `<button type="button" class="btn primary" id="fuhren-uebernehmen">${ic('check')}In den Bericht übernehmen</button>` : '<small class="muted">Übernahme nur im Entwurf.</small>'}</div>` : ''}
          <div class="pf-box flush mat-list">
            ${matListe().map((m) => `<div class="mat-row${mMenge(m.id) ? ' on' : ''}" data-m="${m.id}"><span>${esc(m.name)}${m.deaktiviert ? ' <i class="chip xs st-grey" data-deaktiviert>deaktiviert</i>' : ''}${fuhrMarke(m)}</span>${stepper(`data-material="${m.id}"`, mMenge(m.id), 1, m.einheit, m.name)}<small>${esc(m.einheit || '')}</small></div>`).join('')}
          </div>${editierbar() ? `<div class="integ-row">${lieferscheinKnopf(integ)}</div>` : ''}</section>
          <section class="pf-sec a-leist" data-step="4" aria-labelledby="h-leist"><h4 id="h-leist">ARBEITSLEISTUNG</h4><div class="pf-box flush"><textarea class="input area" rows="5" data-f="arbeitsleistung" aria-labelledby="h-leist" placeholder="Was wurde heute gemacht?" ${dis()}>${esc(b.arbeitsleistung || '')}</textarea></div>
            ${editierbar() ? diktatHtml(integ) : ''}</section>
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
            <div id="wetter-karte">${wetterHtml()}</div></section>
          <section class="pf-sec a-fotos" data-step="5" aria-labelledby="h-fotos"><h4 id="h-fotos">FOTOS <span>höchstens ${MAX_FOTOS} · ohne Standortdaten</span></h4><div class="pf-box" id="fotos">${fotosHtml()}</div><div class="integ-row" id="papier-zeile">${papierKnopf(integ, ctx.kann('bericht_erstellen'))}</div></section>
          <section class="a-sig" data-step="6" aria-label="Unterschriften und Abschluss" id="abschluss">${abschlussHtml()}</section>
        </div>
      </div>
    </div>
    <div class="foot-bar wiz-foot"><div class="foot-split">
      <button type="button" class="btn ghost lg" id="wiz-zurueck">${ic('left')}Zurück</button>
      <button type="button" class="btn primary lg grow" id="wiz-weiter">Weiter${ic('right')}</button>
    </div></div>`;
    Object.keys(pads).forEach((k) => delete pads[k]);
    alleZeilenStatus(); anzeige(); zeichneKosten(); zeigHinweise(); setzSchritt(schritt, false); sigInit(); wetterGrundLaden(); markiereKi(); fernLinksZeigen($('[data-fern-links]', el), id, signierbar());
    const mic = $('#diktat-mic', el); if (mic) diktatMikro(mic, $('#diktat-text', el));
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
    if (sp.dataset.geraetExtra) {
      const [gid, aid] = sp.dataset.geraetExtra.split(':').map(Number);
      const x = gWeitere(gid).find((y) => y.anlageId === aid);
      if (x) { x.stunden = v; delete x.neu; if (!(v > 0)) { b.geraete.splice(b.geraete.indexOf(x), 1); $(`[data-ga="${gid}"]`, el).innerHTML = anlagenZeile(gid); } geaendert('geraete'); }
    } else if (sp.dataset.geraet) {
      const gid = Number(sp.dataset.geraet); let g = b.geraete.find((x) => x.geraetId === gid);
      if (!g) { g = { geraetId: gid, stunden: 0 }; b.geraete.push(g); }
      // Bei mehreren Anlagen je Gerät: zuletzt auf dieser Baustelle verwendete vorbelegen
      if (v > 0 && !(g.stunden > 0) && g.anlageId == null && gAnlagen(gid).length > 1) { const vor = (b.anlagenVorschlag || {})[gid]; if (gAnlagen(gid).some((a) => a.id === vor)) g.anlageId = vor; }
      // Zeile auf 0 → auch die weiteren Anlagen dieser Gerätezeile entfallen
      if (!(v > 0)) gWeitere(gid).forEach((x) => b.geraete.splice(b.geraete.indexOf(x), 1));
      g.stunden = v; sp.closest('.pf-g').classList.toggle('on', v > 0); geaendert('geraete');
      const ga = $(`[data-ga="${gid}"]`, el); if (ga) ga.innerHTML = anlagenZeile(gid);
    } else if (sp.dataset.material) {
      const mid = Number(sp.dataset.material); let m = b.material.find((x) => x.materialId === mid);
      if (!m) { m = { materialId: mid, menge: 0 }; b.material.push(m); }
      m.menge = v; sp.closest('.mat-row').classList.toggle('on', v > 0); geaendert('material');
    } else if (sp.dataset.pal) { b.paletten[sp.dataset.pal] = Math.round(v); geaendert('paletten'); }
  }
  el.addEventListener('click', async (e) => {
    if (e.target.closest('#fuhren-uebernehmen')) {
      try { await post(`/berichte/${id}/fuhren-uebernehmen`, { fuhreIds: (b.fuhrenVorschlag || []).map((v) => v.fuhreId) }); toast('Fuhren in den Bericht übernommen.'); ctx.neuLaden(); } catch (x) { toast(x.message, 'warn'); }
      return;
    }
    const d = e.target.closest('[data-stepper] [data-d]');
    if (d) { const sp = d.closest('[data-stepper]'); setzStepper(sp, zahl($('input', sp).value) + Number(d.dataset.d) * Number(sp.dataset.schritt)); return; }
    const aw = e.target.closest('[data-anlage-wahl]');
    if (aw && !aw.disabled) {
      const [gid, aid] = aw.dataset.anlageWahl.split(':').map(Number); const g = gZeile(gid);
      if (g && g.anlageId !== aid) { g.anlageId = aid; $(`[data-ga="${gid}"]`, el).innerHTML = anlagenZeile(gid); geaendert('geraete'); }
      return;
    }
    const ad = e.target.closest('[data-anlage-dazu]');
    if (ad && editierbar()) {
      const [gid, aid] = ad.dataset.anlageDazu.split(':').map(Number);
      const idx = b.geraete.map((g) => g.geraetId).lastIndexOf(gid);
      b.geraete.splice(idx + 1, 0, { geraetId: gid, anlageId: aid, stunden: 0.5 });
      $(`[data-ga="${gid}"]`, el).innerHTML = anlagenZeile(gid); geaendert('geraete');
      return;
    }
    const sn = e.target.closest('[data-schritt-nr]');
    if (sn) { setzSchritt(Number(sn.dataset.schrittNr)); return; }
    if (e.target.closest('[data-konflikt-laden]')) { ctx.neuLaden(); return; }
    if (e.target.closest('#wiz-zurueck')) { setzSchritt(schritt - 1); return; }
    if (e.target.closest('#wiz-weiter')) { setzSchritt(schritt + 1); return; }
    if (e.target.closest('[data-p-weg]')) {
      const i = Number(e.target.closest('.bp-row').dataset.i);
      if (await bestaetigen('Person entfernen?', `${b.personal[i].name || 'Diese Person'} aus dem Bericht entfernen? Die Stempelungen bleiben erhalten.`, 'Entfernen', 'danger')) { b.personal.splice(i, 1); $('#personal', el).innerHTML = personalHtml(); alleZeilenStatus(); geaendert('personal'); }
      return;
    }
    if (e.target.closest('[data-p-sync]')) {
      if (!(await bestaetigen('Personal neu übernehmen?', 'Die Zeiten werden aus den Stempelungen dieses Tages neu eingetragen. Händische Änderungen am Personal gehen verloren.', 'Übernehmen'))) return;
      try { const neu = await post(`/berichte/${id}/personal-aktualisieren`, { version: b.version }); if (neu.version != null) b.version = neu.version; b.personal = neu.personal || []; offen.delete('personal'); $('#personal', el).innerHTML = personalHtml(); alleZeilenStatus(); anzeige(); toast('Personal aus den Stempelungen übernommen.'); } catch (x) { toast(x.message, 'warn'); }
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
      try { const neu = await del(`/berichte/${id}/unterschrift/${sw.dataset.sigWeg}`); b.unterschriften = (neu && neu.unterschriften) || {}; if (neu && neu.status) b.status = neu.status; if (neu && neu.version != null) b.version = neu.version; if (neu) b.geaendertNachUnterschrift = neu.geaendertNachUnterschrift; toast('Unterschrift zurückgezogen.'); zeichne(); }
      catch (x) { toast(x.message, 'warn'); }
      return;
    }
    if (e.target.closest('#wetter-holen')) return wetterHolen();
    if (e.target.closest('[data-fern-anfordern]')) {
      if (ungueltig()) { toast('Bitte zuerst die rot markierten Zeiten beim Personal korrigieren.', 'warn'); return; }
      if (!(await allesSichern())) { toast('Bitte zuerst die offenen Änderungen speichern.', 'warn'); return; }
      return fernDialog({ id, bs, integ, fertig: () => fernLinksZeigen($('[data-fern-links]', el), id, signierbar()) });
    }
    const lw = e.target.closest('[data-link-weg]');
    if (lw) { if (await fernWiderrufen(id, lw.dataset.linkWeg)) fernLinksZeigen($('[data-fern-links]', el), id, signierbar()); return; }
    if (e.target.closest('#diktat-los')) {
      const feld = $('#diktat-text', el); const text = feld.value.trim(); const knopf = $('#diktat-los', el);
      if (text.length < 3) { feld.focus(); toast('Bitte zuerst etwas diktieren oder tippen.', 'warn'); return; }
      knopf.disabled = true;
      try { const wahl = await diktatVorschlag(id, text); const n = uebernehmen(wahl); if (n) toast(`${n} ${n === 1 ? 'Feld' : 'Felder'} ausgefüllt – bitte prüfen.`); }
      catch (x) { toast(x.netz ? 'Keine Verbindung – der Vorschlag braucht den Server.' : x.message, 'warn'); }
      const k2 = $('#diktat-los', el); if (k2) k2.disabled = false;
      return;
    }
    if (e.target.closest('#ls-foto')) { $('#ls-datei', el).click(); return; }
    if (e.target.closest('#pp-foto')) { $('#pp-datei', el).click(); return; }
    if (e.target.closest('#mail-ag')) return mailDialog();
    if (e.target.closest('#foto-neu')) { $('#foto-datei', el).click(); return; }
    const fw = e.target.closest('[data-foto-weg]');
    if (fw) {
      const fid = fw.closest('[data-foto]').dataset.foto;
      if (!(await bestaetigen('Foto entfernen?', 'Das Foto wird aus dem Bericht gelöscht.', 'Entfernen', 'danger'))) return;
      try { await del(`/berichte/${id}/fotos/${fid}`); b.fotos = (b.fotos || []).filter((x) => String(x.id) !== String(fid)); fotosNeu(); toast('Foto entfernt.'); } catch (x) { toast(x.message, 'warn'); }
      return;
    }
    if (e.target.closest('#freigeben')) { freigeben(); }
  });
  el.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'ls-datei') {
      const datei = (t.files || [])[0]; t.value = ''; if (!datei) return;
      if (!(await allesSichern())) { toast('Bitte zuerst die offenen Änderungen speichern.', 'warn'); return; }
      const k = $('#ls-foto', el); if (k) k.disabled = true;
      try {
        const r = await lieferscheinVorschlag(id, datei);
        if (r.foto) { b.fotos = b.fotos || []; if (!b.fotos.some((x) => x.id === r.foto.id)) b.fotos.push(r.foto); }
        try { const frisch = await get(`/berichte/${id}`); if (frisch.version != null) b.version = frisch.version; } catch (x) { /* Version folgt beim nächsten Speichern */ }
        const n = uebernehmen(r.wahl, { addieren: true });
        if (n) toast(`${n} ${n === 1 ? 'Feld' : 'Felder'} aus dem Lieferschein übernommen – bitte prüfen.`); else fotosNeu();
      } catch (x) { toast(x.netz ? 'Keine Verbindung – der Lieferschein wurde nicht hochgeladen.' : x.message, 'warn'); }
      const k2 = $('#ls-foto', el); if (k2) k2.disabled = false;
      return;
    }
    if (t.id === 'pp-datei') {
      const datei = (t.files || [])[0]; t.value = ''; if (!datei) return;
      try { const foto = await papierAnhaengen(id, datei); if (foto) { b.fotos = b.fotos || []; if (!b.fotos.some((x) => x.id === foto.id)) b.fotos.push(foto); fotosNeu(); } }
      catch (x) { toast(x.netz ? 'Keine Verbindung – das Foto wurde nicht hochgeladen.' : x.message, 'warn'); }
      return;
    }
    if (t.id === 'foto-datei') { const dateien = [...(t.files || [])]; t.value = ''; if (dateien.length) fotosHochladen(dateien); return; }
    if (t.dataset.fotoText !== undefined) {
      const fid = t.closest('[data-foto]').dataset.foto; const f = (b.fotos || []).find((x) => String(x.id) === String(fid));
      try { const neu = await put(`/berichte/${id}/fotos/${fid}`, { beschreibung: t.value.trim() }); if (f) f.beschreibung = (neu && neu.beschreibung) ?? t.value.trim(); toast('Beschreibung gespeichert.'); } catch (x) { toast(x.message, 'warn'); }
      return;
    }
    const sp = t.closest('[data-stepper]');
    if (sp) {
      const alt = sp.dataset.geraetExtra ? (gWeitere(Number(sp.dataset.geraetExtra.split(':')[0])).find((y) => y.anlageId === Number(sp.dataset.geraetExtra.split(':')[1])) || {}).stunden || 0 : sp.dataset.geraet ? gStd(Number(sp.dataset.geraet)) : sp.dataset.material ? mMenge(Number(sp.dataset.material)) : b.paletten[sp.dataset.pal] || 0;
      setzStepper(sp, zahl(t.value, alt)); return;
    }
    if (t.id === 'p-neu' && t.value) {
      const m = mitarbeiter.find((x) => String(x.id) === t.value);
      const gast = t.selectedOptions[0].dataset.gast === '1';
      b.personal.push({ benutzerId: m.id, name: m.name, von1: '', bis1: '', von2: '', bis2: '', pauseMin: 0, stunden: 0, code: '', ...(gast ? { gast: true } : {}) });
      if (gast) toast(`${m.name} wird als Gast eingetragen – das wird protokolliert.`, 'warn');
      $('#personal', el).innerHTML = personalHtml(); alleZeilenStatus(); geaendert('personal'); return;
    }
    const pr = t.closest('.bp-row');
    if (pr && t.dataset.p) {
      const p = b.personal[Number(pr.dataset.i)], k = t.dataset.p;
      if (k === 'segStunden') { p.segStunden = zahl(t.value, p.segStunden); t.value = p.segStunden ? fmt.zahl(p.segStunden) : ''; }
      else if (k === 'pauseMin') { p.pauseMin = Math.round(zahl(t.value, p.pauseMin)); t.value = p.pauseMin || ''; }
      else p[k] = t.value;
      // C-02: Arbeitsstunden sind nie frei eingebbar – sie folgen aus Zeiten und Pause (gleiche Regel wie am Server)
      if (k !== 'code' && k !== 'segStunden') { p.stunden = stundenAus(p, b.datum); $('[data-p-std]', pr).textContent = fmt.zahl(p.stunden); }
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
    if (t.dataset.fotoText !== undefined) return;
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
      const r = await post(`/berichte/${id}/unterschrift`, { rolle, name, bildPng: pad.png(), version: b.version }); // D-07: unterschrieben wird genau der angezeigte Stand
      const neu = r && r.unterschriften ? r : await get(`/berichte/${id}`);
      b.unterschriften = neu.unterschriften || {}; b.status = neu.status; if (neu.version != null) b.version = neu.version;
      delete pads[rolle];
      toast(b.status === 'unterschrieben' ? 'Beide Unterschriften vorhanden – Bericht abgeschlossen.' : 'Unterschrift gespeichert.');
      zeichne(); // Inhalt ist ab jetzt gesperrt (M-02)
      if (b.status !== 'entwurf') ctx.meldungenNeu();
    } catch (e) {
      knopf.disabled = false;
      if (e.status === 409) {
        // D-07: Bericht wurde inzwischen geändert · D-05: für diese Rolle gibt es schon eine Unterschrift
        const veraltet = e.daten && e.daten.version != null && e.daten.version !== b.version;
        const d = dialog({
          titel: veraltet ? 'Bericht wurde inzwischen geändert' : 'Unterschrift nicht möglich',
          inhalt: `<p data-sig-konflikt="${veraltet ? 'version' : 'vorhanden'}">${esc(e.message)}</p><p class="muted sm">${veraltet ? 'Unterschrieben wird immer der aktuelle Stand. Bitte neu laden, den Inhalt noch einmal zeigen und dann unterschreiben lassen.' : 'Eine vorhandene Unterschrift wird nie überschrieben. Sie muss zuerst zurückgezogen werden – die des Bauherrn nur durch Büro oder Geschäftsführung (mit Vermerk im Bericht).'}</p>`,
          fuss: '<button class="btn primary" type="button" data-zu>Neu laden</button>',
        });
        d.geschlossen.then(() => ctx.neuLaden());
      } else toast(e.message, 'warn');
    }
  }
  async function freigeben() {
    if (!(await bestaetigen('Bericht freigeben?', 'Der Bericht fließt damit in Nachkalkulation und Monatsauswertung ein.', 'Freigeben'))) return;
    try {
      const r = await post(`/berichte/${id}/freigeben`);
      b.status = (r && r.status) || 'freigegeben'; if (r && r.version != null) b.version = r.version; if (r) b.selbstfreigabe = r.selbstfreigabe;
      toast('Bericht freigegeben.'); zeichne(); ctx.meldungenNeu();
    } catch (e) {
      if (e.status === 403) dialog({ titel: 'Freigabe nicht möglich', inhalt: `<p data-freigabe-abgelehnt>${esc(e.message)}</p><p class="muted sm">Vier-Augen-Prinzip: Wer die Unterschrift des Auftragnehmers erfasst hat, gibt den Bericht nicht selbst frei.</p>`, fuss: '<button class="btn primary" type="button" data-zu>Verstanden</button>' });
      else toast(e.message, 'warn');
    }
  }

  zeichne();
  const groesse = () => { Object.entries(pads).forEach(([r, p]) => { const box = $(`.sig-box[data-sig="${r}"]`, el); if (box && !box.classList.contains('hat')) p.loeschen(); }); };
  window.addEventListener('resize', groesse);
  return () => { window.removeEventListener('resize', groesse); spaeter.sofort(); };
}
