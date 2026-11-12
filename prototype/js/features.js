/* Zusatzfunktionen: Sprache, Baustellen-Modus, Hinweise, Diktat, Lieferschein-Scan, Wetter, Geräte-Scan,
   Fernunterschrift, Prognose/Insights, Benutzer & Berechtigungen, Frage-Box. Alles simuliert (Prototyp). */
(function () {
  'use strict';
  const A = window.App, D = window.DATA, S = A.state, F = A.fmt, icon = A.icon, esc = F.esc;
  const act = A.actions, inp = A.inputs;
  const qs = new URLSearchParams(location.search);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const timers = [];
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const clearTimers = () => { timers.splice(0).forEach(clearTimeout); };

  /* ---------- Zugriffsregeln je Route ---------- */
  const office = (u) => A.isOffice(u);
  const PERM = {
    '/kolonne': [() => A.can('kolonne'), 'Poliere und Vorarbeiter'], '/bericht/:step?': [() => A.can('bericht'), 'Poliere, Vorarbeiter und Bauleitung'], '/bericht/uebersicht': [() => A.can('bericht'), 'Poliere, Vorarbeiter und Bauleitung'],
    '/dashboard': [office, 'Bauleitung, Büro und Geschäftsführung'], '/baustellen': [office, 'Bauleitung, Büro und Geschäftsführung'], '/baustellen/:kst': [office, 'Bauleitung, Büro und Geschäftsführung'], '/berichte': [office, 'Bauleitung, Büro und Geschäftsführung'],
    '/berichte/:id': [(u) => office(u) || A.can('bericht'), 'Poliere, Bauleitung und Büro'],
    '/preise/:tab?': [() => A.can('preise'), 'Büro, Geschäftsführung und Bauleitung'], '/nachkalkulation/:kst?': [() => A.can('kalk'), 'Büro, Geschäftsführung und Bauleitung'],
    '/monat': [() => A.can('lohn'), 'Büro/Lohnverrechnung und Geschäftsführung'], '/benutzer': [() => A.can('benutzer'), 'die Geschäftsführung']
  };

  /* ---------- Mehrsprachigkeit (Stempeluhr + Navigation) ---------- */
  const LANGS = [['de', 'Deutsch', 'DE'], ['bks', 'Bosanski / Hrvatski / Srpski', 'BKS'], ['hu', 'Magyar', 'HU'], ['ro', 'Română', 'RO'], ['tr', 'Türkçe', 'TR']];
  const I18N = {
    bks: { nav_stempeluhr: 'Evidencija', nav_kolonne: 'Ekipa', nav_bericht: 'Izvještaj', nav_woche: 'Sedmica', nav_profil: 'Profil', gruss: 'Dobro jutro', gruss2: 'Zdravo', gruss3: 'Dobro veče', plan: 'Današnje gradilište prema planu', aendern: 'Promijeni', einstempeln: 'Prijavi se', hinweis_ort: 'Lokacija se bilježi samo u trenutku prijave – bez stalnog praćenja.', eingestempelt: 'Prijavljen', seit: 'od', pause_laeuft: 'Pauza traje', arbeitszeit: 'Radno vrijeme danas', pause: 'Pauza', pause_ende: 'Završi pauzu', wechseln: 'Promijeni gradilište', geraet: 'Skeniraj stroj', ausstempeln: 'Odjavi se', tag_ende: 'Završi radni dan', standort: 'Lokacija zabilježena pri prijavi', kein_tracking: 'bez stalnog praćenja', buchungen: 'Današnje evidencije', keine_buchung: 'Danas još nema evidencije.', diese_woche: 'Ova sedmica', modus: 'Način rada za gradilište', sprache: 'Jezik' },
    hu: { nav_stempeluhr: 'Blokkolás', nav_kolonne: 'Brigád', nav_bericht: 'Jelentés', nav_woche: 'Hét', nav_profil: 'Profil', gruss: 'Jó reggelt', gruss2: 'Szia', gruss3: 'Jó estét', plan: 'Mai munkaterület a beosztás szerint', aendern: 'Módosítás', einstempeln: 'Munkakezdés', hinweis_ort: 'A helyadatot csak a blokkolás pillanatában rögzítjük – nincs folyamatos követés.', eingestempelt: 'Munkában', seit: 'kezdés', pause_laeuft: 'Szünet folyamatban', arbeitszeit: 'Mai munkaidő', pause: 'Szünet', pause_ende: 'Szünet vége', wechseln: 'Munkaterület váltása', geraet: 'Gép beolvasása', ausstempeln: 'Munka vége', tag_ende: 'Munkanap lezárása', standort: 'Helyadat rögzítve blokkoláskor', kein_tracking: 'nincs folyamatos követés', buchungen: 'Mai bejegyzések', keine_buchung: 'Ma még nincs bejegyzés.', diese_woche: 'Ez a hét', modus: 'Építkezési mód', sprache: 'Nyelv' },
    ro: { nav_stempeluhr: 'Pontaj', nav_kolonne: 'Echipă', nav_bericht: 'Raport', nav_woche: 'Săptămână', nav_profil: 'Profil', gruss: 'Bună dimineața', gruss2: 'Salut', gruss3: 'Bună seara', plan: 'Șantierul de azi conform planului', aendern: 'Schimbă', einstempeln: 'Începe lucrul', hinweis_ort: 'Locația se înregistrează doar în momentul pontajului – fără urmărire continuă.', eingestempelt: 'Pontat', seit: 'din', pause_laeuft: 'Pauză în curs', arbeitszeit: 'Timp de lucru azi', pause: 'Pauză', pause_ende: 'Încheie pauza', wechseln: 'Schimbă șantierul', geraet: 'Scanează utilajul', ausstempeln: 'Încheie lucrul', tag_ende: 'Încheie ziua de lucru', standort: 'Locație înregistrată la pontaj', kein_tracking: 'fără urmărire continuă', buchungen: 'Înregistrările de azi', keine_buchung: 'Încă nicio înregistrare azi.', diese_woche: 'Săptămâna aceasta', modus: 'Mod șantier', sprache: 'Limbă' },
    tr: { nav_stempeluhr: 'Mesai', nav_kolonne: 'Ekip', nav_bericht: 'Rapor', nav_woche: 'Hafta', nav_profil: 'Profil', gruss: 'Günaydın', gruss2: 'Merhaba', gruss3: 'İyi akşamlar', plan: 'Plana göre bugünkü şantiye', aendern: 'Değiştir', einstempeln: 'Mesaiye başla', hinweis_ort: 'Konum yalnızca giriş anında kaydedilir – sürekli takip yoktur.', eingestempelt: 'Mesaide', seit: 'başlangıç', pause_laeuft: 'Mola sürüyor', arbeitszeit: 'Bugünkü çalışma süresi', pause: 'Mola', pause_ende: 'Molayı bitir', wechseln: 'Şantiye değiştir', geraet: 'Makineyi tara', ausstempeln: 'Mesaiyi bitir', tag_ende: 'İş gününü bitir', standort: 'Konum giriş anında kaydedildi', kein_tracking: 'sürekli takip yok', buchungen: 'Bugünkü kayıtlar', keine_buchung: 'Bugün henüz kayıt yok.', diese_woche: 'Bu hafta', modus: 'Şantiye modu', sprache: 'Dil' }
  };
  A.t = (k, d) => { const L = I18N[S.lang]; if (!L || A.isOffice(S.user)) return d; if (L[k]) return L[k]; if (k.startsWith('title_')) return L['nav_' + k.slice(6)] || d; return d; };
  const langName = () => LANGS.find((l) => l[0] === S.lang) || LANGS[0];
  A.stempelTop = () => `<div class="quick-row">
      <button class="quick-pill" data-act="sprache" data-demo="sprache">${icon('globe')}<span>${langName()[1]}</span>${icon('down')}</button>
      <button class="quick-pill toggle ${S.bm ? 'on' : ''}" data-act="bm-toggle" data-demo="baustellen-modus">${icon('sun')}<span>${A.t('modus', 'Baustellen-Modus')}</span><i class="switch ${S.bm ? 'on' : ''}"></i></button></div>`;
  A.profilExtra = (u) => A.isOffice(u) ? '' : `<div class="card def-list"><div><span>Sprache</span><button class="btn ghost sm" data-act="sprache" data-demo="profil-sprache">${icon('globe')} ${langName()[1]}</button></div><div><span>Baustellen-Modus<small class="muted" style="display:block">Extra große Tasten, maximaler Kontrast</small></span><button class="switch-btn" data-act="bm-toggle" data-demo="profil-baustellen-modus"><i class="switch ${S.bm ? 'on' : ''}"></i></button></div></div>`;
  act.sprache = () => A.sheet(`<div class="sheet-head"><h3>Sprache wählen</h3><button class="icon-btn" data-act="sheet-close" aria-label="Schließen">${icon('x')}</button></div><div class="sheet-body list">${LANGS.map((l) => `<button class="pick-row ${S.lang === l[0] ? 'sel' : ''}" data-act="sprache-set" data-l="${l[0]}" data-demo="sprache-${l[0]}"><span class="lang-code">${l[2]}</span><span class="pick-txt"><b>${l[1]}</b></span>${S.lang === l[0] ? icon('check', 'ok') : ''}</button>`).join('')}<p class="muted sm" style="padding:8px 10px">Stempeluhr und Navigation werden sofort übersetzt. Berichte bleiben auf Deutsch – so wie sie der Auftraggeber bekommt.</p></div>`);
  act['sprache-set'] = (el) => { S.lang = el.dataset.l; A.closeSheet(); A.render(); };
  act['bm-toggle'] = () => { S.bm = !S.bm; A.render(); A.toast(S.bm ? 'Baustellen-Modus ein: große Tasten, maximaler Kontrast' : 'Baustellen-Modus aus'); };

  /* ---------- Overlay + Rückgängig ---------- */
  const oroot = () => document.getElementById('overlay-root');
  function overlay(html) { clearTimers(); const r = oroot(); r.innerHTML = html; requestAnimationFrame(() => r.classList.add('open')); }
  function closeOverlay() { clearTimers(); const r = oroot(); r.classList.remove('open'); setTimeout(() => { if (!r.classList.contains('open')) r.innerHTML = ''; }, 220); }
  act['overlay-close'] = closeOverlay;
  window.addEventListener('hashchange', closeOverlay);
  let undoFn = null;
  function toastUndo(msg, fn) {
    undoFn = fn; const root = document.getElementById('toast-root'); const el = document.createElement('div');
    el.className = 'toast undo'; el.innerHTML = icon('check') + '<span>' + msg + '</span><button data-act="undo" data-demo="rueckgaengig">' + icon('undo') + ' Rückgängig</button>';
    root.appendChild(el); requestAnimationFrame(() => el.classList.add('in')); setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, 6000);
  }
  act.undo = (el) => { if (undoFn) { undoFn(); undoFn = null; A.render(); A.toast('Rückgängig gemacht'); } const t = el.closest('.toast'); if (t) t.remove(); };

  /* ---------- D) Hinweise: Ankunft, AZG-Wächter ---------- */
  function hinweis(typ) {
    const u = S.user; if (!u || !A.stamp(u.id)) return; const st = A.stamp(u.id), b = A.site(S.ui.stempelKst || u.kst);
    const V = {
      ankunft: ['pin', 'Du bist bei ' + b.kurz + ' angekommen', 'Jetzt einstempeln? KST ' + b.kst + ' laut Einsatzplan.', 'Einstempeln', 'ankunft-einstempeln', 'Prüfung nur am Gerät · kein Tracking'],
      pause: ['pause', '6 Std. ohne Pause', 'Das Arbeitszeitgesetz verlangt spätestens jetzt 30 Minuten Pause. Pause jetzt starten?', 'Pause starten', 'hinweis-pause-starten', 'AZG-Wächter · § 11'],
      ausstempeln: ['clock', 'Ausstempeln vergessen?', 'Du hast die Baustelle um 16:02 verlassen, bist aber noch eingestempelt.', 'Um 16:02 ausstempeln', 'hinweis-ausstempeln', 'Prüfung nur am Gerät · kein Tracking']
    }[typ]; if (!V) return;
    const old = document.querySelector('.notif'); if (old) old.remove();
    const el = document.createElement('div'); el.className = 'notif n-' + typ; el.setAttribute('data-demo', 'hinweis-banner');
    el.innerHTML = `<div class="notif-top">${A.mark}<span>BauTag</span><time>jetzt</time></div><div class="notif-body"><span class="notif-ic">${icon(V[0])}</span><div><b>${esc(V[1])}</b><p>${esc(V[2])}</p></div></div>
      <div class="notif-btns"><button class="btn ghost" data-act="hinweis-zu" data-demo="hinweis-spaeter">Später</button><button class="btn primary" data-act="hinweis-ok" data-typ="${typ}" data-demo="${V[4]}">${V[3]}</button></div><small>${icon('shield')} ${V[5]}</small>`;
    document.body.appendChild(el); requestAnimationFrame(() => el.classList.add('in'));
  }
  const hinweisZu = () => { const n = document.querySelector('.notif'); if (n) { n.classList.remove('in'); setTimeout(() => n.remove(), 300); } };
  act['hinweis-zu'] = hinweisZu;
  act['hinweis-ok'] = (el) => {
    const u = S.user, st = A.stamp(u.id), typ = el.dataset.typ; hinweisZu();
    if (typ === 'ankunft') { if (st.status === 'aus' || st.status === 'fertig') { const b = A.site(S.ui.stempelKst || u.kst); A.clockIn(u.id, b.kst); A.go('/stempeluhr'); A.render(); A.toast('Eingestempelt · ' + b.kurz + ' · ' + F.hm(A.nowMin()) + ' Uhr'); } }
    else if (typ === 'pause') { if (st.status === 'ein') A.togglePause(u.id); A.go('/stempeluhr'); A.render(); A.toast('Pause gestartet – guten Appetit'); }
    else { if (['ein', 'pause'].includes(st.status)) { A.clockOut(u.id); const g = st.segs[st.segs.length - 1]; g.bis = Math.max(g.von + 60, Math.min(g.bis, 16 * 3600 + 120)); } A.go('/stempeluhr'); A.render(); A.toast('Ausgestempelt um 16:02 Uhr – danke fürs Nachtragen'); }
  };

  /* ---------- E) Gerät per NFC / QR ---------- */
  A.tickers.geraetlauf = () => (S.geraetLauf ? F.hms(A.nowSec() - S.geraetLauf.von) : null);
  A.stempelExtra = () => { const g = S.geraetLauf; if (!g) return ''; const x = A.byId(D.geraete, g.id); return `<div class="dev-run" data-demo="geraet-laeuft">${icon('nfc')}<span><b>${esc(x.name)} · Gerätestunden laufen</b><small>auf KST ${g.kst} · seit ${F.hm(g.von / 60)} · <em data-tick="geraetlauf">00:00:00</em></small></span><button class="btn ghost sm" data-act="geraet-stopp" data-demo="geraet-stopp">Stopp</button></div>`; };
  act['geraet-scan'] = () => {
    const st = A.stamp(S.user.id), g = A.byId(D.geraete, 'b9');
    overlay(`<div class="ov dark" data-demo="geraet-scan-overlay" data-state="scan"><button class="ov-x" data-act="overlay-close" aria-label="Schließen">${icon('x')}</button>
      <div class="nfc"><i></i><i></i><i></i><span>${icon('nfc')}</span></div>
      <div class="ov-scan"><h2>Handy an das Gerät halten</h2><p>NFC-Plakette oder QR-Code am Gerät scannen</p></div>
      <div class="ov-result"><span class="ok-ic">${icon('check')}</span><h2>${esc(g.name)}</h2><p>Inventar-Nr. B-09 · Kennzeichen NK-417 PI</p>
        <div class="ov-card"><div><small>Gerätestunden laufen auf</small><b>KST ${st.kst} · ${esc(A.site(st.kst).kurz)}</b></div><div><small>Bediener</small><b>${esc(S.user.name)}</b></div><div><small>Start</small><b>${F.hm(A.nowMin())} Uhr</b></div></div>
        <button class="btn primary lg block" data-act="geraet-scan-ok" data-demo="geraet-scan-fertig">${icon('check')} Passt</button><small class="ov-hint">Die Stunden landen automatisch im Bautagesbericht.</small></div></div>`);
    later(() => { const o = document.querySelector('[data-demo="geraet-scan-overlay"]'); if (o) { o.dataset.state = 'fertig'; S.geraetLauf = { id: 'b9', kst: st.kst, von: A.nowSec() }; } }, 1700);
  };
  act['geraet-scan-ok'] = () => { closeOverlay(); A.render(); A.toast('Bagger 9 to. – Gerätestunden laufen auf KST ' + S.geraetLauf.kst); };
  act['geraet-stopp'] = () => { const g = S.geraetLauf; if (!g) return; const h = Math.max(0.5, Math.round(((A.nowSec() - g.von) / 3600) * 2) / 2); const rep = A.heuteBericht(); if (rep.kst === g.kst) rep.geraete[g.id] = (rep.geraete[g.id] || 0) + h; S.geraetLauf = null; A.render(); A.toast(A.byId(D.geraete, g.id).name + ': ' + F.menge(h) + ' Std. in den Bautagesbericht übernommen'); };

  /* ---------- C) Wetter automatisch ---------- */
  S.wetterRegen = qs.get('wetter') === 'regen';
  const wx = () => (S.wetterRegen ? { t: 5, regen: 6.2, wind: 38, txt: 'Starkregen', ic: 'rain', std: [['06', 'cloud', 6], ['08', 'rain', 6], ['10', 'rain', 5], ['12', 'rain', 5], ['14', 'rain', 5], ['16', 'cloud', 6]] } : { t: 7, regen: 0.2, wind: 14, txt: 'Bewölkt, trocken', ic: 'cloud', std: [['06', 'cloud', 4], ['08', 'cloud', 6], ['10', 'sun', 8], ['12', 'sun', 10], ['14', 'cloud', 9], ['16', 'cloud', 7]] });
  A.wetterCard = (rep, b) => {
    const w = wx(); rep.temp = w.t; rep.wetter = S.wetterRegen ? 'Regen' : 'bewölkt';
    const swDone = rep.personal.some((p) => p.code === 'SW');
    return `<div class="card pad wx ${S.wetterRegen ? 'bad' : ''}" data-demo="wetter-karte">
      <div class="card-h"><h3>${icon(w.ic)} Wetter <span class="chip st-green xs">${icon('check')} automatisch</span></h3><button class="btn ghost sm" data-act="wetter-demo" data-demo="wetter-demo-regen">${S.wetterRegen ? 'Demo: Normalwetter' : 'Demo: Starkregen'}</button></div>
      <div class="wx-main"><div class="wx-now"><b>${w.t} °C</b><span>${w.txt}</span></div>
        <div class="wx-facts"><div>${icon('rain')}<span><b>${F.num(w.regen, 1)} mm/h</b><small>Niederschlag</small></span></div><div>${icon('wind')}<span><b>${w.wind} km/h</b><small>Wind</small></span></div><div>${icon('pin')}<span><b>${esc(b.ort.split(',')[0].replace(/^\d+ /, ''))}</b><small>Standort Baustelle</small></span></div></div></div>
      <div class="wx-hours">${w.std.map((h) => `<div>${icon(h[1])}<b>${h[2]}°</b><small>${h[0]} Uhr</small></div>`).join('')}</div>
      <small class="muted">Wetterdaten für die Baustellen-Adresse, abgerufen um ${F.hm(A.nowMin() - 2)} Uhr · wird im Bericht mitgespeichert</small></div>
      ${S.wetterRegen && !swDone ? `<div class="card pad suggest" data-demo="sw-vorschlag"><span class="sg-ic">${icon('rain')}</span><div><b>Schlechtwetter (SW) für die Partie eintragen?</b><p>Seit 08:00 Uhr über 5 mm/h Regen. Vorschlag: Arbeitsende 11:00 Uhr, Rest als Schlechtwetter für ${rep.personal.filter((p) => p.v1 != null).length} Mitarbeiter.</p>
        <div class="sg-btns"><button class="btn primary" data-act="sw-eintragen" data-demo="sw-eintragen">${icon('check')} SW ab 11:00 eintragen</button><button class="btn ghost" data-act="sw-nein" data-demo="sw-ablehnen">Nein, wir arbeiten</button></div></div></div>` : ''}
      ${swDone ? `<div class="banner ok" data-demo="sw-eingetragen">${icon('check')}<span><b>Schlechtwetter eingetragen</b> – ab 11:00 Uhr für die Partie, Hinweis steht unter „Besondere Vorkommnisse“.</span></div>` : ''}`;
  };
  act['wetter-demo'] = () => { S.wetterRegen = !S.wetterRegen; A.render(); };
  act['sw-nein'] = () => { S.wetterRegen = false; A.render(); };
  act['sw-eintragen'] = () => {
    const rep = A.heuteBericht(), snap = { manuell: clone(rep.manuell), vk: rep.vorkommnisse, kat: rep.vkKat }; let n = 0;
    rep.personal.forEach((p) => { if (p.v1 == null || p.code === 'K' || p.code === 'U') return; const v1 = Math.min(p.v1, 600); rep.manuell[p.ma] = { ma: p.ma, v1, b1: 660, v2: null, b2: null, pause: 0, std: Math.round(((660 - v1) / 60) * 4) / 4, code: 'SW', laeuft: false }; n++; });
    rep.vorkommnisse = (rep.vorkommnisse ? rep.vorkommnisse + '\n' : '') + 'Schlechtwetter ab 11:00 Uhr (Starkregen 6,2 mm/h), Baustelle gesichert.'; rep.vkKat = rep.vkKat || 'Sonstiges';
    A.render(); toastUndo('SW für ' + n + ' Mitarbeiter eingetragen', () => { rep.manuell = snap.manuell; rep.vorkommnisse = snap.vk; rep.vkKat = snap.kat; });
  };

  /* ---------- A) Sprach-Bautagesbericht ---------- */
  const DIKTAT = 'Heute mit Brandstätter und Kerschbaumer Frostschutz eingebaut, 42 Tonnen, Bagger 9 Tonnen 8 Stunden, LKW 3-Achser 4 Stunden, Rüttelplatte 6 Stunden, 6 Tonnen Splitt, Randsteine gesetzt.';
  const FELDER = [['users', 'Personal', 'Brandstätter, Kerschbaumer erkannt'], ['truck', 'Bagger 9 to.', '8 Std.'], ['truck', 'LKW 3-Achser', '4 Std.'], ['truck', 'Rüttelplatte', '6 Std.'], ['layers', 'Frostschutz', '42 to.'], ['layers', 'Splitt', '6 to.'], ['clipboard', 'Arbeitsleistung', 'Text formuliert']];
  A.wizTop = (rep, step) => {
    const n = rep.ai ? rep.aiN : 0;
    const chip = rep.ai ? `<div class="ai-chip" data-demo="ki-chip">${icon('spark')}<span><b>${n} Felder automatisch ausgefüllt</b> – bitte prüfen</span><button data-act="ai-undo" data-demo="ki-rueckgaengig">${icon('undo')} Rückgängig</button><button class="ok" data-act="ai-ok" data-demo="ki-bestaetigen">${icon('check')} Passt</button></div>` : '';
    if (step === 1 && !rep.ai && rep.status === 'entwurf') return `<button class="mic-hero" data-act="diktat-start" data-demo="bericht-diktieren"><span class="mic-ring">${icon('mic')}</span><span><b>Bericht diktieren</b><small>Einfach erzählen, was heute war – Geräte, Material und Text werden automatisch eingetragen.</small></span></button>`;
    if (!rep.ai && step >= 3 && step <= 5 && rep.status === 'entwurf') return `<button class="mic-bar" data-act="diktat-start" data-demo="bericht-diktieren">${icon('mic')}<span><b>Bericht diktieren</b> statt tippen</span>${icon('right')}</button>`;
    return chip;
  };
  act['diktat-start'] = () => {
    const words = DIKTAT.split(' ');
    overlay(`<div class="ov dark dikt" data-demo="diktat-overlay" data-state="hoert"><button class="ov-x" data-act="overlay-close" data-demo="diktat-abbrechen" aria-label="Abbrechen">${icon('x')}</button>
      <div class="dk-head"><span class="mic-ring live">${icon('mic')}</span><div><b class="dk-s1">Ich höre zu …</b><b class="dk-s2">KI ordnet die Angaben zu …</b><b class="dk-s3">Erkannt – bitte prüfen</b><small>Bautagesbericht · ${esc(A.site(A.heuteBericht().kst).kurz)} · ${F.datum(D.HEUTE)}</small></div></div>
      <div class="wave">${Array.from({ length: 34 }, (_, i) => `<i style="animation-delay:${-((i * 137) % 900)}ms;animation-duration:${700 + ((i * 71) % 500)}ms"></i>`).join('')}</div>
      <p class="dk-text" data-demo="diktat-transkript"></p>
      <div class="dk-fields"></div>
      <div class="dk-foot"><button class="btn ghost lg" data-act="overlay-close">Verwerfen</button><button class="btn primary lg grow" data-act="diktat-ok" data-demo="diktat-uebernehmen" disabled>${icon('spark')} ${FELDER.length} Felder übernehmen</button></div></div>`);
    const txt = () => document.querySelector('.dk-text'), ov = () => document.querySelector('.dikt');
    words.forEach((w, i) => later(() => { const t = txt(); if (t) { const s = document.createElement('span'); s.textContent = w + ' '; t.appendChild(s); } }, 500 + i * 105));
    const t1 = 500 + words.length * 105 + 400;
    later(() => { if (ov()) ov().dataset.state = 'denkt'; }, t1);
    FELDER.forEach((f, i) => later(() => { const c = document.querySelector('.dk-fields'); if (!c) return; if (i === 0) ov().dataset.state = 'felder'; const d = document.createElement('div'); d.className = 'dk-field'; d.setAttribute('data-demo', 'diktat-feld-' + i); d.innerHTML = `${icon(f[0])}<span><small>${f[1]}</small><b>${f[2]}</b></span>${icon('check', 'ok')}`; c.appendChild(d); }, t1 + 900 + i * 230));
    later(() => { if (ov()) { ov().dataset.state = 'fertig'; ov().querySelector('[data-demo="diktat-uebernehmen"]').disabled = false; } }, t1 + 900 + FELDER.length * 230 + 200);
  };
  act['diktat-ok'] = () => {
    const rep = A.heuteBericht(), snap = clone({ geraete: rep.geraete, material: rep.material, arbeit: rep.arbeit });
    Object.assign(rep.geraete, { b9: 8, lkw3: 4, ruettel: 6 }); Object.assign(rep.material, { frostschutz: 42, splitt: 6 });
    const t = 'Frostschutz eingebaut und verdichtet (42 to.), Splittbett hergestellt (6 to.).\nRandsteine gesetzt.';
    if (!rep.arbeit.includes('Randsteine gesetzt')) rep.arbeit = (rep.arbeit ? rep.arbeit.replace(/\s+$/, '') + '\n' : '') + t;
    rep.ai = { 'geraet-b9': 1, 'geraet-lkw3': 1, 'geraet-ruettel': 1, 'material-frostschutz': 1, 'material-splitt': 1, arbeit: 1 }; rep.aiN = FELDER.length; rep.aiSnap = snap;
    closeOverlay(); A.go('/bericht/3'); A.render();
  };
  act['ai-undo'] = () => { const rep = A.heuteBericht(); if (rep.aiSnap) Object.assign(rep, rep.aiSnap); delete rep.ai; delete rep.aiSnap; A.render(); A.toast('Automatisch ausgefüllte Felder zurückgesetzt'); };
  act['ai-ok'] = () => { const rep = A.heuteBericht(); delete rep.ai; delete rep.aiSnap; A.render(); A.toast('Geprüft – danke!'); };

  /* ---------- B) Lieferschein scannen ---------- */
  const LS = { nr: 'LS 2026-11482', lieferant: 'Steinwerk Schwarzatal GmbH', rows: [['splitt', 'material', 'Splitt 2/4', 6, 'to.'], ['pflaster8', 'zusatz', 'Betonsteinpflaster 8 cm grau', 38, 'm²'], ['randstein', 'zusatz', 'Randleiste 8/25/100', 24, 'lfm'], ['euro', 'pal', 'Euro-Paletten (Pfand)', 4, 'Stk.']] };
  A.matTop = (rep) => `<button class="scan-bar" data-act="ls-start" data-demo="lieferschein-scannen"><span class="scan-ic">${icon('camera')}</span><span><b>Lieferschein fotografieren</b><small>Material, Menge und Lieferant werden automatisch erkannt</small></span>${icon('right')}</button>
    ${(rep.lieferscheine || []).map((l) => `<div class="banner ok" data-demo="lieferschein-angehaengt">${icon('file')}<span><b>${l.nr}</b> · ${esc(l.lieferant)} · ${l.n} Positionen übernommen, Foto angehängt</span></div>`).join('')}`;
  act['ls-start'] = () => {
    const rep = A.heuteBericht(), b = A.site(rep.kst);
    overlay(`<div class="ov dark cam" data-demo="lieferschein-overlay" data-state="kamera"><button class="ov-x" data-act="overlay-close" aria-label="Schließen">${icon('x')}</button>
      <div class="cam-view"><div class="ls-paper"><div class="ls-h"><div><b>${LS.lieferant}</b><small>Werk Neunkirchen · Baustoffe · Pflaster · Splitt</small></div><div class="ls-nr"><b>LIEFERSCHEIN</b><small>Nr. ${LS.nr.slice(3)} · ${F.datum(D.HEUTE)}</small></div></div>
        <div class="ls-adr"><div><small>Empfänger</small>Michael Pichler Ges.m.b.H.<br>2624 Breitenau</div><div><small>Lieferadresse / Baustelle</small>${esc(b.kurz)} · KST ${b.kst}<br>${esc(b.ort)}</div></div>
        <table><tr><th>Pos.</th><th>Bezeichnung</th><th>Menge</th><th>Einh.</th></tr>${LS.rows.map((r, i) => `<tr><td>${i + 1}</td><td>${r[2]}</td><td>${F.menge(r[3])}</td><td>${r[4]}</td></tr>`).join('')}</table>
        <div class="ls-f"><span>Ware übernommen:</span>${A.sigSvg(A.demoSignatur('ls'))}<i>LKW NK-882 GT · 09:40</i></div></div>
        <i class="corner c1"></i><i class="corner c2"></i><i class="corner c3"></i><i class="corner c4"></i><i class="scanline"></i></div>
      <div class="cam-status"><span class="cs1">${icon('camera')} Lieferschein ins Bild halten …</span><span class="cs2">${icon('spark')} Dokument erkannt – wird gelesen …</span></div>
      <div class="cam-result"><div class="cr-h"><span>${icon('check', 'ok')}</span><div><b>${LS.nr} · ${LS.lieferant}</b><small>${LS.rows.length} Positionen erkannt · Zuordnung vorgeschlagen</small></div></div>
        <div class="cr-rows">${LS.rows.map((r, i) => `<div class="cr-row" data-demo="lieferschein-zeile-${i}" style="transition-delay:${i * 140}ms"><span><b>${r[2]}</b><small>${r[1] === 'material' ? 'Material (Menge)' : r[1] === 'zusatz' ? 'Materialbeistellung · Eigenmaterial' : 'Paletten – Pfand vermerkt'}</small></span><em>${F.menge(r[3])} ${r[4]}</em></div>`).join('')}</div>
        <div class="dk-foot"><button class="btn ghost lg" data-act="overlay-close">Verwerfen</button><button class="btn primary lg grow" data-act="ls-ok" data-demo="lieferschein-uebernehmen">${icon('check')} ${LS.rows.length} Positionen übernehmen</button></div></div></div>`);
    const ov = () => document.querySelector('.cam');
    later(() => { if (ov()) ov().dataset.state = 'scan'; }, 1100);
    later(() => { if (ov()) ov().dataset.state = 'fertig'; }, 3100);
  };
  act['ls-ok'] = () => {
    const rep = A.heuteBericht(), snap = clone({ material: rep.material, zusatz: rep.zusatz, lieferscheine: rep.lieferscheine || [], ai: rep.ai || null });
    rep.material.splitt = 6; rep.zusatz.pflaster8 = 38; rep.zusatz.randstein = 24;
    rep.lieferscheine = (rep.lieferscheine || []).filter((l) => l.nr !== LS.nr).concat([{ nr: LS.nr, lieferant: LS.lieferant, n: LS.rows.length }]);
    rep.ai = Object.assign(rep.ai || {}, { 'material-splitt': 1, 'zusatz-pflaster8': 1, 'zusatz-randstein': 1 }); if (!rep.aiN) { rep.aiN = 3; rep.aiSnap = clone({ geraete: rep.geraete, material: snap.material, arbeit: rep.arbeit, zusatz: snap.zusatz }); }
    closeOverlay(); A.go('/bericht/4'); A.render();
    toastUndo(LS.rows.length + ' Positionen aus Lieferschein übernommen', () => { rep.material = snap.material; rep.zusatz = snap.zusatz; rep.lieferscheine = snap.lieferscheine; if (snap.ai) rep.ai = snap.ai; else { delete rep.ai; delete rep.aiSnap; rep.aiN = 0; } });
  };

  /* ---------- H) Fernunterschrift per SMS ---------- */
  A.fernSig = (rep) => rep.fern ? `<div class="fern-status ${rep.fern.done ? 'done' : ''}" data-demo="fernunterschrift-status">${icon(rep.fern.done ? 'check' : 'sms')}<span>${rep.fern.done ? '<b>Per Link unterschrieben</b> · ' + rep.fern.done + ' Uhr' : '<b>Link gesendet · ' + rep.fern.t + ' Uhr</b> – wartet auf Unterschrift …'}</span></div>` : `<button class="btn ghost sm sig-auto" data-act="fern-start" data-demo="fernunterschrift">${icon('sms')} Bauherr nicht vor Ort? Link per SMS senden</button>`;
  act['fern-start'] = () => { const rep = A.heuteBericht(), b = A.site(rep.kst);
    A.sheet(`<div class="sheet-head"><h3>Unterschrift per Link einholen</h3><button class="icon-btn" data-act="sheet-close" aria-label="Schließen">${icon('x')}</button></div><div class="sheet-body">
      <div class="def-list card"><div><span>Empfänger</span><b>${esc(b.bauherrVertreter)}<small>${esc(b.ag)}</small></b></div><div><span>Mobilnummer</span><b>+43 664 555 01 42<small>aus den Baustellen-Stammdaten</small></b></div></div>
      <div class="field-label">Vorschau SMS</div>
      <div class="sms" data-demo="sms-vorschau"><div class="sms-bubble">Michael Pichler Ges.m.b.H.: Bautagesbericht vom ${F.datum(rep.datum)} (${esc(b.kurz)}, KST ${rep.kst}) liegt zur Unterschrift bereit:<br><u>https://bautag.example/s/7K4Q9</u><br>Link 48 Std. gültig.</div><small>SMS · Absender „BauTag“</small></div>
      <div class="banner info">${icon('shield')}<span>Der Bauherr sieht den Bericht wie auf Papier und unterschreibt am eigenen Handy – ohne App, ohne Login.</span></div>
      <button class="btn primary lg block" data-act="fern-send" data-demo="sms-senden">${icon('send')} SMS senden</button></div>`); };
  act['fern-send'] = () => { const rep = A.heuteBericht(); rep.fern = { t: F.hm(A.nowMin()) }; A.closeSheet(); A.render(); A.toast('SMS mit Unterschrifts-Link gesendet');
    setTimeout(() => { if (rep.fern && !rep.fern.done && rep.status === 'entwurf') { rep.sigBH = A.demoSignatur('bh' + rep.kst + 'x'); rep.fern.done = F.hm(A.nowMin()); if (location.hash.includes('uebersicht')) A.render(); A.toast('Bauherr hat per Link unterschrieben'); } }, 5000); };

  /* ---------- G) Prognose & Hinweise in der Nachkalkulation ---------- */
  A.kalkInsights = (b, c) => {
    const t = c.tage, last = t.slice(-6), dK = last.length > 1 ? last[last.length - 1].kumK - last[0].kumK : 0, dE = last.length > 1 ? last[last.length - 1].kumE - last[0].kumE : 0;
    const ratio = dE > 0 ? Math.min(1.25, Math.max(0.6, dK / dE)) : c.kosten / c.erloes;
    const rest = Math.max(0, c.auftrag - c.erloes), eac = c.kosten + rest * ratio, progDB = c.auftrag ? (c.auftrag - eac) / c.auftrag : 0, planDB = c.erloes ? (c.erloes - c.sollKosten) / c.erloes : 0, diff = progDB - planDB;
    const tone = diff < -0.02 ? 'neg' : diff > 0.01 ? 'pos' : '';
    const mk = Object.keys(c.mat).sort((x, y) => c.mat[y].kosten - c.mat[x].kosten), mid = c.mat.frostschutz ? 'frostschutz' : mk[0], mv = c.soll.material ? c.material / c.soll.material - 1 : 0, mm = mid ? A.byId(S.preise.material, mid) : null;
    let regie = 0, pe = 0, pw = 0; S.reports.filter((r) => r.kst === b.kst && r.status !== 'verrechnet').forEach((r) => { regie += (r.regie || []).reduce((a, x) => a + x.std, 0); }); S.reports.filter((r) => r.kst === b.kst).forEach((r) => { pe += r.paletten.euro; pw += r.paletten.weiss; });
    const vk = A.byId(S.preise.lohn, 'fa').vk, pf = pe * A.byId(S.preise.paletten, 'euro').pfand + pw * A.byId(S.preise.paletten, 'weiss').pfand;
    const cards = [];
    if (mm) { const ist = c.mat[mid].menge, soll = ist / (1 + mv), u = mm.einheit === 'to' ? 'to.' : mm.einheit; cards.push([mv > 0.03 ? 'warn' : 'ok', 'layers', `${mm.name}-Verbrauch ${mv >= 0 ? '+' : '−'}${F.num(Math.abs(mv) * 100, 0)} % ${mv >= 0 ? 'über' : 'unter'} Kalkulation`, `${F.num(ist, 0)} ${u} statt ${F.num(soll, 0)} ${u} kalkuliert · ${mv >= 0 ? 'Mehrkosten' : 'Ersparnis'} ${F.eur(Math.abs(ist - soll) * mm.ek, 0)}`, 'Mengen prüfen', '/berichte']); }
    cards.push([regie > 0 ? 'warn' : 'ok', 'clock', regie > 0 ? `Regiestunden noch nicht verrechnet: ${F.menge(regie)} Std. = ${F.eur(regie * vk, 0)}` : 'Alle Regiestunden sind verrechnet', regie > 0 ? `aus unterschriebenen Bautagesberichten · Regiesatz Facharbeiter ${F.eur(vk)}` : 'Kein offener Regieaufwand auf dieser Baustelle', 'Regieschein erstellen', null]);
    cards.push(['info', 'tag', `Paletten-Pfand: ${pe + pw} Paletten retour = ${F.eur(pf, 0)} Gutschrift`, `${pe} Euro · ${pw} Weissenböck laut Bautagesberichten – mit Lieferantenrechnung abgleichen`, 'Aufstellung', null]);
    return `<div class="prognose ${tone}" data-demo="kalk-prognose"><div class="pg-l"><span class="pg-ic">${icon('spark')}</span><div><small>Hochrechnung bis Fertigstellung · automatisch</small><h3>Bei aktuellem Verlauf: DB <b>${F.pct(progDB)}</b> statt kalkuliert ${F.pct(planDB)}</h3><p>Erwartete Gesamtkosten ${F.eur(eac, 0)} bei Auftragssumme ${F.eur(c.auftrag, 0)} · Restleistung ${F.eur(rest, 0)} · Trend der letzten ${last.length} Arbeitstage</p></div></div>
        <div class="pg-r"><div class="pg-scale"><i class="plan" style="left:${Math.max(0, Math.min(100, (planDB / 0.3) * 100))}%"><u>Plan</u></i><i class="prog" style="left:${Math.max(0, Math.min(100, (progDB / 0.3) * 100))}%"><u>Prognose</u></i><span></span></div><div class="pg-ax"><small>0 %</small><small>15 % Ziel</small><small>30 %</small></div></div></div>
      <div class="insights">${cards.map((x, i) => `<div class="insight i-${x[0]}" data-demo="insight-${i}"><span class="in-ic">${icon(x[1])}</span><div><b>${x[2]}</b><small>${x[3]}</small></div><button class="btn ghost sm" data-act="insight" data-to="${x[5] || ''}" data-t="${x[4]}">${x[4]}</button></div>`).join('')}</div>`;
  };
  act.insight = (el) => { if (el.dataset.to) A.go(el.dataset.to); else A.toast(el.dataset.t + ': im Prototyp nur angedeutet', 'warn'); };

  /* ---------- Frage-Box im Büro ---------- */
  A.topExtra = (u) => A.isOffice(u) ? `<label class="ask" data-demo="frage-box">${icon('spark')}<input type="text" placeholder="Frag BauTag … z. B. „Wie viel Frostschutz auf KST 26-041?“" data-demo="frage-input" id="ask-in"><kbd>↵</kbd></label>` : '';
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'ask-in' && e.target.value.trim()) frage(e.target.value.trim()); });
  function frage(q) {
    const lq = q.toLowerCase(), kst = (q.match(/\d{2}-\d{3}/) || [])[0], b = (kst && A.site(kst)) || D.baustellen.find((x) => lq.includes(x.kurz.toLowerCase().split(' ').pop())) || A.site('26-041');
    const mat = D.material.find((m) => lq.includes(m.name.toLowerCase().slice(0, 6))), person = D.mitarbeiter.find((m) => lq.includes(m.nn.toLowerCase()));
    let head, big, sub, rows = [], link = null;
    if (mat) { const rs = S.reports.filter((r) => r.kst === b.kst && ((r.material || {})[mat.id] || (r.zusatz || {})[mat.id])); const sum = rs.reduce((a, r) => a + ((r.material || {})[mat.id] || 0) + ((r.zusatz || {})[mat.id] || 0), 0); const u = mat.einheit === 'to' ? 'to.' : mat.einheit;
      head = `${mat.name} auf KST ${b.kst} · ${b.kurz}`; big = F.num(sum, 0) + ' ' + u; sub = `aus ${rs.length} Bautagesberichten seit ${F.datum(b.start)}`; rows = rs.slice(-4).reverse().map((r) => [F.datumKurz(r.datum), F.menge((r.material || {})[mat.id] || (r.zusatz || {})[mat.id]) + ' ' + u]); link = ['/berichte', 'Berichte öffnen']; }
    else if (person) { const w = A.weekData(person.id, 46); head = `Stunden ${person.name} · KW 46`; big = F.num(w.ist, 2) + ' Std.'; sub = `davon ${F.num(w.ue, 2)} Überstunden · ${A.site(person.kst).kurz}`; rows = w.tage.filter((t) => t.std > 0).map((t) => [F.datumKurz(t.d), F.num(t.std, 2) + ' Std.']); if (A.can('lohn')) link = ['/monat', 'Monatsauswertung']; }
    else if (A.can('kalk')) { const c = A.calc(b.kst); head = `Deckungsbeitrag KST ${b.kst} · ${b.kurz}`; big = F.pct(c.dbPct); sub = `${F.eur(c.db, 0)} bei ${F.eur(c.erloes, 0)} Erlös`; rows = [['Lohn', F.eur(c.lohn, 0)], ['Geräte', F.eur(c.geraete, 0)], ['Material', F.eur(c.material, 0)], ['Fremdleistung', F.eur(c.fremd, 0)]]; link = ['/nachkalkulation/' + b.kst, 'Nachkalkulation öffnen']; }
    else { head = 'Dazu habe ich keine Daten gefunden'; big = '–'; sub = 'Versuch es mit Material, Mitarbeiter oder Baustelle.'; }
    A.sheet(`<div class="answer" data-demo="frage-antwort"><div class="an-q">${icon('spark')}<span>${esc(q)}</span></div><small>${esc(head)}</small><div class="an-big">${big}</div><p>${esc(sub)}</p>
      ${rows.length ? `<div class="mini-cost">${rows.map((r) => `<div><span>${r[0]}</span><b>${r[1]}</b></div>`).join('')}</div>` : ''}
      <div class="send-btns">${link ? `<a class="btn ghost lg" href="#${link[0]}">${link[1]}</a>` : ''}<button class="btn primary lg" data-act="sheet-close" data-demo="frage-schliessen">Schließen</button></div>
      <small class="muted">Antwort direkt aus Stempeluhr und Bautagesberichten berechnet.</small></div>`, { cls: 'modal' });
  }

  /* ---------- Benutzer & Berechtigungen ---------- */
  const log = (was) => S.audit.unshift({ t: F.datum(D.HEUTE) + ' ' + F.hm(A.nowMin()), wer: (S.preview ? S.preview.real : S.user).name, was, neu: true });
  const NUR = { preise: 1, preise_edit: 1, kalk: 1 };
  const sw = (on, attrs, locked, title) => `<button class="switch-btn ${locked ? 'locked' : ''}" ${attrs} ${locked ? 'disabled' : ''} title="${title || ''}"><i class="switch ${on ? 'on' : ''}"></i>${locked ? icon('lock') : ''}</button>`;
  A.route('/benutzer', {
    nav: 'benutzer', title: 'Benutzer & Berechtigungen', sub: () => 'Wer darf was sehen? Rollen, Ausnahmen und Protokoll',
    render() {
      const users = D.buero.concat(D.mitarbeiter), n = (r) => users.filter((u) => u.rolle === r).length, all = S.ui.benAll;
      const exc = Object.keys(S.ausnahmen).flatMap((id) => Object.keys(S.ausnahmen[id]).filter((k) => S.ausnahmen[id][k]).map((k) => ({ u: A.ma(id), k })));
      const cell = (r, key) => { const lockedF = A.gesperrt(r, key), lockedG = r === 'gf'; return `<td>${sw(!!S.perm[r][key], `data-act="recht-toggle" data-r="${r}" data-k="${key}" data-demo="recht-${key}-${r}"`, lockedF || lockedG, lockedF ? 'Für Baustellen-Rollen gesperrt' : lockedG ? 'Geschäftsführung hat immer alle Rechte' : '')}</td>`; };
      let grp = '';
      const rows = A.RECHTE.map((x) => { const g = x[2] !== grp ? `<tr class="grp"><th colspan="6">${(grp = x[2])}</th></tr>` : ''; return `${g}<tr data-demo="recht-zeile-${x[0]}"><th>${x[1]}${NUR[x[0]] ? `<span class="chip st-amber xs">${icon('lock')} nur Büro, Geschäftsführung &amp; Bauleitung</span>` : ['lohnsaetze', 'lohn'].includes(x[0]) ? `<span class="chip st-amber xs">${icon('lock')} nur Büro &amp; Geschäftsführung</span>` : ''}${x[0] === 'kalk' ? '<small>Bauleiter: nur eigene Baustellen · rechnet mit Lohngruppen-Sätzen, nie mit persönlichen Löhnen</small>' : ''}</th>${A.ROLLEN.map((r) => cell(r[0], x[0])).join('')}</tr>`; }).join('');
      const badge = (r) => `<span class="chip role-${r}">${A.rolleName(r)}</span>`;
      return `<div class="page perm">
        <div class="banner info">${icon('shield')}<span><b>Grundregel:</b> Preise, €-Werte und Nachkalkulation sehen nur Büro, Geschäftsführung und Bauleitung (eigene Baustellen). Für Poliere und Mitarbeiter sind diese Rechte fix gesperrt – auch nicht als Ausnahme vergebbar.</span></div>
        <div class="perm-grid">
          <div class="card"><div class="card-h pad-h"><h3>Berechtigungsmatrix</h3><span class="muted sm">Änderungen gelten sofort auf allen Geräten</span></div>
            <div class="tbl-wrap"><table class="pm" data-demo="rechte-matrix"><thead><tr><th>Funktion</th>${A.ROLLEN.map((r) => `<th><b>${r[1]}</b><small>${n(r[0])} Benutzer</small>${r[0] !== 'gf' ? `<button class="btn ghost sm" data-act="vorschau" data-r="${r[0]}" data-demo="vorschau-${r[0]}">${icon('user')} Ansicht testen</button>` : '<span class="chip st-grey xs">Admin</span>'}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div></div>
          <div class="stack">
            <div class="card pad"><div class="card-h"><h3>Ausnahmen je Benutzer <span class="count">${exc.length}</span></h3></div>
              ${exc.map((e) => `<div class="exc" data-demo="ausnahme-${e.u.id}-${e.k}"><span>${A.avatar(e.u, 'sm')}</span><div><b>${esc(e.u.name)}</b><small>${A.isOffice(e.u) ? esc(e.u.funktion) : esc(A.lgName(e.u.lg))} darf zusätzlich: „${A.RECHTE.find((x) => x[0] === e.k)[1].split(' (')[0]}“</small></div><button class="icon-btn sm" data-act="ausnahme-del" data-id="${e.u.id}" data-k="${e.k}" aria-label="Entfernen">${icon('x')}</button></div>`).join('') || '<p class="muted sm">Keine Ausnahmen vergeben.</p>'}
              <p class="muted sm" style="margin-top:8px">Neue Ausnahme: in der Benutzerliste auf „Rechte“ klicken.</p></div>
            <div class="card pad"><div class="card-h"><h3>Änderungsprotokoll</h3><span class="muted sm">wer · wann · was</span></div>
              <ul class="audit" data-demo="protokoll">${S.audit.slice(0, 6).map((a) => `<li class="${a.neu ? 'neu' : ''}"><i></i><div><b>${esc(a.was)}</b><small>${a.t} · ${esc(a.wer)}</small></div></li>`).join('')}</ul></div>
          </div>
        </div>
        <div class="card"><div class="card-h pad-h"><h3>Benutzer <span class="count">${users.length}</span></h3><div class="legend">${A.ROLLEN.map((r) => badge(r[0])).join('')}</div></div>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Rolle</th><th class="hide-md">Funktion / Lohngruppe</th><th class="hide-md">Baustelle</th><th>Ausnahmen</th><th></th></tr></thead><tbody>
          ${users.slice(0, all ? 99 : 9).map((u) => { const ex = Object.keys(S.ausnahmen[u.id] || {}).filter((k) => S.ausnahmen[u.id][k]); return `<tr data-demo="benutzer-zeile-${u.id}"><td><span class="u-cell">${A.avatar(u, 'sm')}<b>${esc(u.name)}</b></span></td><td>${badge(u.rolle)}</td><td class="hide-md muted">${esc(A.isOffice(u) ? u.funktion : A.lgName(u.lg))}</td><td class="hide-md muted">${u.kst ? esc(A.site(u.kst).kurz) : u.sites ? u.sites.length + ' Baustellen' : 'alle'}</td><td>${ex.map((k) => `<span class="chip st-blue xs">+ ${A.RECHTE.find((x) => x[0] === k)[1].split(' (')[0]}</span>`).join(' ') || '<span class="muted">–</span>'}</td><td class="r">${u.rolle === 'gf' ? '' : `<button class="btn ghost sm" data-act="ausnahme" data-id="${u.id}" data-demo="benutzer-${u.id}-rechte">${icon('shield')} Rechte</button>`}</td></tr>`; }).join('')}</tbody></table></div>
          ${all ? '' : `<button class="add-row" data-act="ben-alle" data-demo="benutzer-alle">${icon('down')} Alle ${users.length} Benutzer anzeigen</button>`}</div>
      </div>`;
    }
  });
  act['ben-alle'] = () => { S.ui.benAll = true; A.render(); };
  act['recht-toggle'] = (el) => { const r = el.dataset.r, k = el.dataset.k; if (A.gesperrt(r, k) || r === 'gf') return; S.perm[r][k] = !S.perm[r][k]; log(`Rolle ${A.rolleName(r)}: „${A.RECHTE.find((x) => x[0] === k)[1].split(' (')[0]}“ ${S.perm[r][k] ? 'aktiviert' : 'deaktiviert'}`); A.render(); A.toast('Berechtigung geändert – gilt sofort für alle ' + A.rolleName(r)); };
  act.vorschau = (el) => { const real = S.preview ? S.preview.real : S.user; S.preview = { real }; S.user = A.roleUser(el.dataset.r); A.go(A.home()); A.render(); };
  act['ausnahme-del'] = (el) => { delete S.ausnahmen[el.dataset.id][el.dataset.k]; log(`Ausnahme entfernt: ${A.ma(el.dataset.id).name}`); A.render(); };
  function ausnahmeSheet(id) { const u = A.ma(id), ex = S.ausnahmen[id] || {};
    A.sheet(`<div class="sheet-head"><h3>Rechte · ${esc(u.name)}</h3><button class="icon-btn" data-act="sheet-close" aria-label="Schließen">${icon('x')}</button></div><div class="sheet-body">
      <p class="muted sm">Rolle <b>${A.rolleName(u.rolle)}</b>. Hier können einzelne Rechte zusätzlich freigegeben werden.</p>
      <div class="card">${A.RECHTE.filter((x) => x[0] !== 'benutzer').map((x) => { const role = !!S.perm[u.rolle][x[0]], lock = A.gesperrt(u.rolle, x[0]); return `<div class="exc-row ${lock ? 'locked' : ''}"><span><b>${x[1].split(' (')[0]}</b><small>${lock ? 'Für Baustellen-Rollen gesperrt' : role ? 'über die Rolle erlaubt' : ex[x[0]] ? 'Ausnahme aktiv' : 'nicht erlaubt'}</small></span>${sw(role || !!ex[x[0]], `data-act="ausnahme-toggle" data-id="${id}" data-k="${x[0]}" data-demo="ausnahme-${x[0]}"`, lock || role, lock ? 'Für Baustellen-Rollen gesperrt' : '')}</div>`; }).join('')}</div>
      <button class="btn primary lg block" data-act="sheet-close" data-demo="ausnahme-fertig">Fertig</button></div>`); }
  act.ausnahme = (el) => ausnahmeSheet(el.dataset.id);
  act['ausnahme-toggle'] = (el) => { const id = el.dataset.id, k = el.dataset.k, u = A.ma(id); if (A.gesperrt(u.rolle, k)) return; S.ausnahmen[id] = S.ausnahmen[id] || {}; S.ausnahmen[id][k] = !S.ausnahmen[id][k]; if (!S.ausnahmen[id][k]) delete S.ausnahmen[id][k]; log(`Ausnahme ${S.ausnahmen[id][k] ? 'vergeben' : 'entfernt'}: ${u.name} – „${A.RECHTE.find((x) => x[0] === k)[1].split(' (')[0]}“`); A.render(); ausnahmeSheet(id); };

  /* ---------- Start-Hooks ---------- */
  const start0 = A.start;
  A.start = function () {
    A.routes.forEach((r) => { const p = PERM[r.pattern]; if (p) { r.perm = p[0]; r.permText = p[1]; } });
    start0();
    Object.assign(window.demo, { ankunft: () => hinweis('ankunft'), hinweis, diktat: () => act['diktat-start'](), sprache: (l) => { S.lang = l; A.render(); }, vorschau: (r) => act.vorschau({ dataset: { r } }) });
    const h = qs.get('hinweis'); if (h) setTimeout(() => hinweis(h), 1200);
  };
})();
