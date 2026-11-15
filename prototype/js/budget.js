/* Auftragssumme & Budget-Alarm, Benachrichtigungen (Glocke), Papier-Bautagesbericht scannen (KI/OCR simuliert) */
(function () {
  'use strict';
  const A = window.App, D = window.DATA, S = A.state, F = A.fmt, icon = A.icon, esc = F.esc;
  const act = A.actions, inp = A.inputs;
  const qs = new URLSearchParams(location.search);
  const sitesAll = () => D.baustellen.filter((b) => !b.intern);
  const phone = () => window.innerWidth < 720;
  const parseNum = (s) => parseFloat(String(s).replace(/[€\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  const p0 = (v) => F.num(v * 100, 0) + ' %';

  /* ================= Budget ================= */
  const bg = (kst) => S.budget[kst];
  const kritisch = (b, c) => { const g = bg(b.kst), t = g.schwellen.filter((s) => s.on).map((s) => s.p).sort((x, y) => x - y)[0] || 80; return g.smart && c.verbrauch * 100 >= t && b.fertig < c.verbrauch - 0.05; };
  const stufe = (b, c) => { const g = bg(b.kst), hit = g.schwellen.filter((s) => s.on && c.verbrauch * 100 >= s.p).map((s) => s.p); const max = hit.length ? Math.max(...hit) : 0; return kritisch(b, c) || max >= 100 ? 'rot' : max ? 'gelb' : 'gruen'; };

  A.onReset = (A.onReset || []).concat([function () {
    D.baustellen.forEach((b) => { b.fremd = b.fremd.filter((f) => !f.demo); });
    S.budget = {}; S.notifs = []; S.papierDone = false;
    sitesAll().forEach((b) => { S.budget[b.kst] = { basis: null, nachtraege: b.kst === '26-038' ? [{ t: 'Nachtrag 01 – Entwässerungsrinne Lagerfläche', betrag: 6400 }] : [], schwellen: [{ p: 80, on: true }, { p: 90, on: true }, { p: 100, on: true }], smart: true, rollen: { bauleiter: true, buero: true, gf: true }, kanaele: { app: true, push: true, mail: false }, fired: {} }; });
    // bereits überschrittene Schwellen: still vermerken, höchste als (ungelesene) Meldung anzeigen
    sitesAll().forEach((b) => { const c = A.calc(b.kst), g = bg(b.kst); let top = 0; g.schwellen.forEach((s) => { if (c.verbrauch * 100 >= s.p) { g.fired[s.p] = true; top = s.p; } }); if (top) S.notifs.push({ typ: 'budget', lvl: top >= 100 ? 'rot' : 'gelb', kst: b.kst, titel: 'Budget-Warnung: ' + b.kurz, text: `${top} % der Auftragssumme verbraucht (Leistungsstand ${p0(b.fertig)})`, t: 'gestern, 17:12', neu: true, link: '/nachkalkulation/' + b.kst, rollen: ['bauleiter', 'buero', 'gf'] }); });
    S.notifs.push({ typ: 'azg', lvl: 'rot', titel: 'AZG-Warnung: Zoran Petrović', text: '11,0 Std. am Mi, 11.11. – Tageshöchstarbeitszeit überschritten (§ 9)', t: 'heute, 06:10', neu: true, link: '/monat', rollen: ['buero', 'gf'] });
    S.notifs.push({ typ: 'azg', lvl: 'gelb', titel: 'Ausstempeln vergessen: Ivan Horvat', text: 'Mi, 11.11. automatisch um 16:00 beendet – bitte prüfen', t: 'heute, 06:10', neu: false, link: '/monat', rollen: ['buero', 'gf', 'bauleiter'] });
    const nF = S.reports.filter((r) => r.status === 'unterschrieben').length;
    S.notifs.push({ typ: 'bericht', lvl: 'info', titel: nF + ' Bautagesberichte warten auf Freigabe', text: 'unterschrieben vom Bauherrn, zuletzt Mi, 11.11.', t: 'heute, 07:02', neu: true, link: '/berichte', rollen: ['bauleiter', 'buero', 'gf'] });
  }]);

  const mineN = (n) => { const u = S.user; if (!u || !A.isOffice(u) || !n.rollen.includes(u.rolle)) return false; if (n.typ === 'budget' && (!A.can('kalk') || (u.rolle === 'bauleiter' && !u.sites.includes(n.kst)))) return false; return true; };
  const myNotifs = () => S.notifs.filter(mineN);

  function pruefen(kst, quiet) {
    const b = A.site(kst), c = A.calc(kst), g = bg(kst); let neu = null;
    g.schwellen.forEach((s) => { if (!s.on) return; if (c.verbrauch * 100 >= s.p && !g.fired[s.p]) { g.fired[s.p] = true; neu = s.p; } else if (c.verbrauch * 100 < s.p) delete g.fired[s.p]; });
    if (neu == null) return;
    const krit = kritisch(b, c) || neu >= 100;
    const n = { typ: 'budget', lvl: krit ? 'rot' : 'gelb', kst, titel: 'Budget-Warnung: ' + b.kurz, text: `${neu} % der Auftragssumme verbraucht (Leistungsstand ${p0(b.fertig)})${krit && neu < 100 ? ' – kritisch: Kosten laufen der Leistung davon' : ''}`, t: 'jetzt · ' + F.hm(A.nowMin()), neu: true, link: '/nachkalkulation/' + kst, rollen: Object.keys(g.rollen).filter((r) => g.rollen[r]), kanaele: Object.assign({}, g.kanaele) };
    S.notifs.unshift(n);
    if (!quiet && mineN(n)) melden(n);
  }
  function melden(n) {
    document.querySelectorAll('.dnotif, .notif').forEach((e) => e.remove());
    const el = document.createElement('div');
    if (phone()) {
      el.className = 'notif n-budget ' + (n.lvl === 'rot' ? 'krit' : ''); el.setAttribute('data-demo', 'push-banner');
      el.innerHTML = `<div class="notif-top">${A.mark}<span>BauTag</span><time>jetzt</time></div><div class="notif-body"><span class="notif-ic">${icon('alert')}</span><div><b>${esc(n.titel)}</b><p>${esc(n.text)}</p></div></div>
        <div class="notif-btns"><button class="btn ghost" data-act="melden-zu" data-demo="push-spaeter">Später</button><button class="btn primary" data-act="melden-auf" data-to="${n.link}" data-demo="push-ansehen">Ansehen</button></div><small>${icon('shield')} Push nur an Bauleitung, Büro und Geschäftsführung</small>`;
    } else {
      el.className = 'dnotif ' + (n.lvl === 'rot' ? 'krit' : ''); el.setAttribute('data-demo', 'budget-meldung');
      el.innerHTML = `<span class="dn-ic">${icon('alert')}</span><div><small>Benachrichtigung · jetzt${n.kanaele && n.kanaele.push ? ' · auch als Push aufs Handy' : ''}${n.kanaele && n.kanaele.mail ? ' · E-Mail' : ''}</small><b>${esc(n.titel)}</b><p>${esc(n.text)}</p><div class="dn-btns"><button class="btn ghost sm" data-act="bell" data-demo="budget-meldung-ansehen">Alle Benachrichtigungen</button><button class="btn primary sm" data-act="melden-auf" data-to="${n.link}" data-demo="budget-meldung-oeffnen">Nachkalkulation</button></div></div><button class="icon-btn sm" data-act="melden-zu" aria-label="Schließen">${icon('x')}</button>`;
    }
    document.body.appendChild(el); requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => { if (el.isConnected) { el.classList.remove('in'); setTimeout(() => el.remove(), 320); } }, 9000);
    const bell = document.querySelector('.bell'); if (bell) { bell.classList.add('ring'); }
  }
  act['melden-zu'] = () => document.querySelectorAll('.dnotif, .notif').forEach((e) => { e.classList.remove('in'); setTimeout(() => e.remove(), 320); });
  act['melden-auf'] = (el) => { act['melden-zu'](); closePanel(); A.go(el.dataset.to); };

  /* ---- Glocke + Panel ---- */
  A.topBell = (u) => { if (!A.isOffice(u)) return ''; const n = myNotifs().filter((x) => x.neu).length; return `<button class="bell ${n ? 'has' : ''}" data-act="bell" data-demo="benachrichtigungen" aria-label="Benachrichtigungen">${icon('bell')}${n ? `<i data-demo="benachrichtigungen-badge">${n}</i>` : ''}</button>`; };
  const TYP = { budget: ['Budget-Warnungen', 'euro'], azg: ['AZG-Warnungen', 'clock'], bericht: ['Berichte zur Freigabe', 'clipboard'] };
  function panelHtml() {
    const list = myNotifs();
    const grp = (typ) => { const l = list.filter((n) => n.typ === typ); return l.length ? `<div class="np-grp">${icon(TYP[typ][1])}${TYP[typ][0]}<span>${l.length}</span></div>` + l.map((n) => `<button class="np-item lvl-${n.lvl} ${n.neu ? 'neu' : ''}" data-act="notif-open" data-i="${S.notifs.indexOf(n)}" data-demo="benachrichtigung-${typ}-${l.indexOf(n)}"><i></i><span><b>${esc(n.titel)}</b><small>${esc(n.text)}</small><time>${n.t}</time></span>${icon('right')}</button>`).join('') : ''; };
    return `<div class="np-head"><h3>Benachrichtigungen</h3><button class="btn ghost sm" data-act="notif-alle" data-demo="benachrichtigungen-alle-gelesen">${icon('check')} Alle gelesen</button><button class="icon-btn sm" data-act="bell-zu" aria-label="Schließen">${icon('x')}</button></div>
      <div class="np-body">${grp('budget')}${grp('azg')}${grp('bericht')}${list.length ? '' : '<div class="empty">Keine Benachrichtigungen</div>'}</div>
      <div class="np-foot">${icon('shield')} Budget-Meldungen gehen nur an Bauleitung, Büro und Geschäftsführung – nie an Poliere oder Mitarbeiter.</div>`;
  }
  function closePanel() { const p = document.querySelector('.npanel-wrap'); if (p) p.remove(); }
  act['bell-zu'] = closePanel;
  act.bell = () => { act['melden-zu'](); if (document.querySelector('.npanel-wrap')) return closePanel(); const w = document.createElement('div'); w.className = 'npanel-wrap'; w.innerHTML = `<div class="np-back" data-act="bell-zu"></div><div class="npanel" data-demo="benachrichtigungen-panel">${panelHtml()}</div>`; document.body.appendChild(w); };
  act['notif-open'] = (el) => { const n = S.notifs[+el.dataset.i]; n.neu = false; closePanel(); A.go(n.link); A.render(); };
  act['notif-alle'] = () => { myNotifs().forEach((n) => (n.neu = false)); A.render(); const p = document.querySelector('.npanel'); if (p) p.innerHTML = panelHtml(); };
  window.addEventListener('hashchange', closePanel);

  /* ---- Budget-Karte ---- */
  A.budgetMini = (b, c) => { if (!A.can('kalk')) return ''; const st = stufe(b, c); return `<div class="bmini b-${st}" data-demo="budget-mini-${b.kst}"><div><small>Auftragssumme ${F.eur(c.auftrag, 0)}</small><b>Budget ${p0(c.verbrauch)} verbraucht</b></div><span class="meter"><i style="width:${Math.min(100, c.verbrauch * 100)}%"></i></span></div>`; };
  A.budgetCard = (b, c) => {
    if (!A.can('kalk') || b.intern) return '';
    const g = bg(b.kst), st = stufe(b, c), krit = kritisch(b, c), v = c.verbrauch, MAX = 110, x = (p) => Math.min(100, (p / MAX) * 100), ro = !A.can('preise_edit');
    const aktiv = g.schwellen.filter((s) => s.on), diff = Math.round((b.fertig - v) * 100);
    const txt = krit ? `<b>Kritisch:</b> ${p0(v)} der Auftragssumme verbraucht, Leistungsstand aber erst ${p0(b.fertig)}.` : st === 'rot' ? `<b>Auftragssumme überschritten</b> – jede weitere Stunde geht vom Ergebnis ab.` : st === 'gelb' ? `<b>Schwelle erreicht:</b> ${p0(v)} verbraucht bei Leistungsstand ${p0(b.fertig)}.` : `<b>Im Rahmen:</b> Verbrauch liegt ${Math.abs(diff)} Punkte ${diff >= 0 ? 'unter' : 'über'} dem Leistungsstand.`;
    const fired = !!b.fremd.some((f) => f.demo);
    return `<div class="card budget b-${st}" data-demo="budget-karte">
      <div class="bu-l"><div class="field-label">Auftragssumme (netto)</div>
        <label class="money-in ${ro ? 'ro' : ''}"><span>€</span><input type="text" inputmode="decimal" ${ro ? 'readonly' : ''} value="${F.num(c.auftragBasis, 0)}" data-input="auftrag" data-kst="${b.kst}" data-demo="auftragssumme-input"></label>
        <div class="nt-list">${g.nachtraege.map((n, i) => `<div class="nt" data-demo="nachtrag-${i}"><span>${esc(n.t)}</span><b>+ ${F.eur(n.betrag, 0)}</b>${ro ? '' : `<button class="icon-btn sm" data-act="nachtrag-del" data-kst="${b.kst}" data-i="${i}" aria-label="Entfernen">${icon('x')}</button>`}</div>`).join('')}</div>
        ${ro ? '' : `<div class="nt-add"><input type="text" placeholder="Nachtrag / Zusatzauftrag" id="nt-text" data-demo="nachtrag-text"><label class="money-in sm"><span>€</span><input type="text" inputmode="decimal" placeholder="0" id="nt-betrag" data-demo="nachtrag-betrag"></label><button class="btn ghost" data-act="nachtrag-add" data-kst="${b.kst}" data-demo="nachtrag-add">${icon('plus')}</button></div>`}
        <div class="bu-sum"><span>Auftragssumme gesamt</span><b data-demo="auftragssumme-gesamt">${F.eur(c.auftrag, 0)}</b></div></div>
      <div class="bu-m"><div class="bu-h"><div><small>Budget-Verbrauch · Kosten Ist ÷ Auftragssumme</small><b data-demo="budget-verbrauch">${F.num(v * 100, 1)} %</b></div><span class="chip st-${st === 'rot' ? 'red' : st === 'gelb' ? 'amber' : 'green'}"><i class="dot"></i>${krit ? 'Kritisch' : st === 'rot' ? 'Überschritten' : st === 'gelb' ? 'Warnung' : 'Im Rahmen'}</span></div>
        <div class="bu-bar"><div class="bu-track"><i class="fill" style="width:${x(v * 100)}%"></i></div>${aktiv.map((s) => `<u class="${v * 100 >= s.p ? 'hit' : ''}" style="left:${x(s.p)}%"><em>${s.p} %</em></u>`).join('')}</div>
        <div class="bu-bar ls"><div class="bu-track"><i class="fill" style="width:${x(b.fertig * 100)}%"></i></div></div>
        <div class="bu-leg"><span><i class="sw k"></i>Kosten Ist ${F.eur(c.kosten, 0)}</span><span><i class="sw e"></i>Leistungsstand ${p0(b.fertig)}</span><span class="muted">Rest bis Auftragssumme ${F.eur(c.auftrag - c.kosten, 0)}</span></div>
        <div class="bu-txt ${krit || st === 'rot' ? 'krit' : ''}" data-demo="budget-status">${krit || st !== 'gruen' ? icon('alert') : icon('check')}<span>${txt}</span></div></div>
      <div class="bu-r"><div class="field-label">Budget-Alarm</div>
        <div class="bu-chips">${g.schwellen.map((s) => `<span class="chip ${s.on ? (v * 100 >= s.p ? 'st-amber' : 'st-outline') : 'st-grey off'}">${icon('bell')}${s.p} %</span>`).join('')}${g.smart ? `<span class="chip st-outline">${icon('spark')}Leistung</span>` : ''}</div>
        <small class="muted">an ${Object.keys(g.rollen).filter((r) => g.rollen[r]).map((r) => ({ bauleiter: 'Bauleiter', buero: 'Büro', gf: 'GF' }[r])).join(', ') || 'niemanden'} · ${[g.kanaele.app && 'In-App', g.kanaele.push && 'Push', g.kanaele.mail && 'E-Mail'].filter(Boolean).join(', ')}</small>
        <button class="btn ghost sm" data-act="alarm-sheet" data-kst="${b.kst}" data-demo="budget-alarm-einstellen">${icon('bell')} Schwellen einstellen</button>
        ${fired ? `<button class="btn ghost sm" data-act="budget-demo-reset" data-kst="${b.kst}" data-demo="budget-demo-reset">${icon('undo')} Demo zurücksetzen</button>` : `<button class="btn ghost sm demo" data-act="budget-demo" data-kst="${b.kst}" data-demo="budget-demo-80">${icon('play')} Demo: 80 % auslösen</button>`}</div>
    </div>`;
  };
  inp.auftrag = (el, ev) => { const v = parseNum(el.value); if (!(v > 0)) return; bg(el.dataset.kst).basis = v; if (ev.type === 'change') { pruefen(el.dataset.kst); A.render(); A.toast('Auftragssumme geändert – Budget-Verbrauch ' + F.num(A.calc(el.dataset.kst).verbrauch * 100, 1) + ' %'); } };
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches && e.target.matches('.money-in input')) { if (e.target.id === 'nt-betrag') { const b = document.querySelector('[data-demo="nachtrag-add"]'); if (b) b.click(); } else e.target.blur(); } });
  act['nachtrag-add'] = (el) => { const g = bg(el.dataset.kst), t = document.getElementById('nt-text').value.trim(), v = parseNum(document.getElementById('nt-betrag').value); if (!(v > 0)) { A.toast('Bitte einen Betrag eingeben', 'warn'); return; } g.nachtraege.push({ t: t || 'Nachtrag ' + String(g.nachtraege.length + 1).padStart(2, '0'), betrag: v }); pruefen(el.dataset.kst); A.render(); A.toast('Nachtrag + ' + F.eur(v, 0) + ' – Budget-Verbrauch jetzt ' + F.num(A.calc(el.dataset.kst).verbrauch * 100, 1) + ' %'); };
  act['nachtrag-del'] = (el) => { bg(el.dataset.kst).nachtraege.splice(+el.dataset.i, 1); pruefen(el.dataset.kst); A.render(); };
  function demoPush(kst, quiet) { const b = A.site(kst), c = A.calc(kst); if (b.fremd.some((f) => f.demo)) return; const ziel = Math.max(0.804, c.verbrauch + 0.02), betrag = Math.round((ziel * c.auftrag - c.kosten) / 10) * 10; b.fremd.push({ d: D.HEUTE, text: 'Eingangsrechnung Subunternehmer Erdbau (Demo-Buchung)', betrag, demo: true }); A.render(); pruefen(kst, quiet); A.render(); return betrag; }
  act['budget-demo'] = (el) => { demoPush(el.dataset.kst); };
  act['budget-demo-reset'] = (el) => { const b = A.site(el.dataset.kst); b.fremd = b.fremd.filter((f) => !f.demo); pruefen(el.dataset.kst, true); A.render(); A.toast('Demo-Buchung entfernt'); };
  const sw = (on, attrs) => `<button class="switch-btn" ${attrs}><i class="switch ${on ? 'on' : ''}"></i></button>`;
  function alarmSheet(kst) {
    const g = bg(kst), b = A.site(kst);
    A.sheet(`<div class="sheet-head"><h3>Budget-Alarm · ${esc(b.kurz)}</h3><button class="icon-btn" data-act="sheet-close" aria-label="Schließen">${icon('x')}</button></div><div class="sheet-body" data-demo="budget-alarm-sheet">
      <div class="field-label">Schwellen (Kosten Ist in % der Auftragssumme)</div>
      <div class="card">${g.schwellen.map((s, i) => `<div class="exc-row"><span><b>Schwelle ${i + 1}</b><small>${i === 2 ? 'Auftragssumme aufgebraucht' : i === 1 ? 'dringend' : 'Vorwarnung'}</small></span><div class="al-ctl"><button class="st-btn" data-act="schwelle-step" data-kst="${kst}" data-i="${i}" data-d="-5" data-demo="schwelle-${i}-minus">${icon('minus')}</button><b data-demo="schwelle-${i}-wert">${s.p} %</b><button class="st-btn plus" data-act="schwelle-step" data-kst="${kst}" data-i="${i}" data-d="5" data-demo="schwelle-${i}-plus">${icon('plus')}</button>${sw(s.on, `data-act="schwelle-toggle" data-kst="${kst}" data-i="${i}" data-demo="schwelle-${i}-toggle"`)}</div></div>`).join('')}
        <div class="exc-row"><span><b>${icon('spark')} Intelligente Regel</b><small>Kritisch, wenn die Kosten dem Leistungsstand davonlaufen – z. B. „Kosten 80 % erreicht, Leistungsstand aber erst 62 %“</small></span>${sw(g.smart, `data-act="budget-smart" data-kst="${kst}" data-demo="budget-smart"`)}</div></div>
      <div class="field-label">Empfänger</div>
      <div class="card">${[['bauleiter', 'Bauleiter', 'für seine Baustellen'], ['buero', 'Büro / Lohnverrechnung', ''], ['gf', 'Geschäftsführung', '']].map((r) => `<div class="exc-row"><span><b>${r[1]}</b><small>${r[2]}</small></span>${sw(g.rollen[r[0]], `data-act="empf-toggle" data-kst="${kst}" data-r="${r[0]}" data-demo="empfaenger-${r[0]}"`)}</div>`).join('')}
        <div class="exc-row locked"><span><b>Polier · Mitarbeiter</b><small>erhalten nie Budget- oder Preis-Meldungen</small></span><button class="switch-btn locked" disabled><i class="switch"></i>${icon('lock')}</button></div></div>
      <div class="field-label">Kanäle</div>
      <div class="card">${[['app', 'In-App (Glocke)'], ['push', 'Push aufs Handy'], ['mail', 'E-Mail']].map((k) => `<div class="exc-row"><span><b>${k[1]}</b></span>${sw(g.kanaele[k[0]], `data-act="kanal-toggle" data-kst="${kst}" data-k="${k[0]}" data-demo="kanal-${k[0]}"`)}</div>`).join('')}</div>
      <button class="btn primary lg block" data-act="alarm-fertig" data-demo="budget-alarm-fertig">Fertig</button></div>`);
  }
  act['alarm-sheet'] = (el) => alarmSheet(el.dataset.kst);
  act['alarm-fertig'] = () => { A.closeSheet(); A.render(); A.toast('Budget-Alarm gespeichert'); };
  act['schwelle-step'] = (el) => { const s = bg(el.dataset.kst).schwellen[+el.dataset.i]; s.p = Math.max(50, Math.min(120, s.p + +el.dataset.d)); alarmSheet(el.dataset.kst); };
  act['schwelle-toggle'] = (el) => { const s = bg(el.dataset.kst).schwellen[+el.dataset.i]; s.on = !s.on; alarmSheet(el.dataset.kst); };
  act['budget-smart'] = (el) => { const g = bg(el.dataset.kst); g.smart = !g.smart; alarmSheet(el.dataset.kst); };
  act['empf-toggle'] = (el) => { const g = bg(el.dataset.kst); g.rollen[el.dataset.r] = !g.rollen[el.dataset.r]; alarmSheet(el.dataset.kst); };
  act['kanal-toggle'] = (el) => { const g = bg(el.dataset.kst); g.kanaele[el.dataset.k] = !g.kanaele[el.dataset.k]; alarmSheet(el.dataset.kst); };

  /* ================= Papier-Bautagesbericht scannen ================= */
  const PK = '26-044', PD = '2026-11-11';
  function papierRep() {
    const personal = D.mitarbeiter.filter((m) => m.kst === PK).map((m) => { const t = A.TS[m.id][PD]; return { ma: m.id, v1: t.v1, b1: t.b1, v2: t.v2, b2: t.b2, pause: t.pause, std: t.std, code: t.code }; });
    return { id: PK + '_' + PD, kst: PK, datum: PD, status: 'papier', personal, seg: [{ t: 'Staub (Schneiden)', std: 2 }], geraete: { b27: 6.5, lkw2: 3, ruettel: 5, schneid: 2 }, material: { frostschutz: 16, splitt: 4 }, einheit: {}, zusatz: { pflaster8: 26 },
      arbeit: 'Pflaster im Hof verlegt, ca. 26 m², Zuschnitte Hausmauer.\nRandleisten Zufahrt versetzt, Splittbett abgezogen.', fotos: [], eigen: [], fremdmat: [], paletten: { euro: 2, weiss: 5 }, regie: [{ t: 'Kanaldeckel angehoben lt. Bauherrin', std: 1.5 }], vorkommnisse: '', wetter: 'bewölkt', temp: 8, sigAN: A.demoSignatur('an' + PK), sigBH: A.demoSignatur('bhpapier'), w: 1 };
  }
  const kurzName = (m) => m.nn + ' ' + m.vn.slice(0, m.vn.length > 5 ? 2 : 1) + '.';
  function papierBild(rep) {
    let h = A.paper(rep); D.mitarbeiter.filter((m) => m.kst === PK).forEach((m) => { h = h.split(esc(m.name)).join(esc(kurzName(m))); });
    let i = 0; h = h.replace(/class="ink"/g, () => { i++; return `class="ink" style="--r:${((i * 37) % 9) - 4};--y:${((i * 53) % 5) - 2};--s:${96 + ((i * 29) % 10)}"`; });
    return h;
  }
  A.papierBtn = () => (A.isOffice(S.user) ? `<button class="btn ghost" data-act="papier-start" data-demo="papier-scannen">${icon('camera')} Papierbericht scannen/hochladen</button>` : '');
  const wizTop0 = A.wizTop;
  A.wizTop = (rep, step) => (wizTop0 ? wizTop0(rep, step) : '') + (step === 1 && !rep.ai && rep.status === 'entwurf' ? `<button class="paper-bar" data-act="papier-start" data-demo="papier-scannen">${icon('camera')}<span><b>Papierbericht fotografieren</b><small>Ausgefüllte Papiervorlage einlesen statt abtippen</small></span>${icon('right')}</button>` : '');
  const conf = (p) => `<span class="conf ${p < 80 ? 'low' : ''}">${p < 80 ? icon('alert') + 'bitte prüfen · ' : ''}${p} %</span>`;
  act['papier-start'] = () => {
    const rep = papierRep(), b = A.site(PK), o = document.getElementById('overlay-root');
    const row = (k, lbl, val, p, extra) => `<div class="pr-row ${p < 80 ? 'low' : ''}" data-demo="papier-feld-${k}"><small>${lbl}</small><b>${val}</b>${extra || ''}${conf(p)}</div>`;
    const pers = rep.personal.map((p, i) => { const m = A.ma(p.ma), cf = [97, 93, 78][i] || 95; return `<div class="pr-row pers ${cf < 80 ? 'low' : ''}" data-demo="papier-feld-personal-${p.ma}"><small>„${esc(kurzName(m))}“ ${icon('right')}</small><b>${esc(m.name)}<em>${esc(A.lgName(m.lg))} · aus Stammdaten zugeordnet</em></b><span class="pr-t">${p.code && !p.std ? p.code : `${F.hm(p.v1)}–${F.hm(p.b1)}${p.v2 != null ? ' · ' + F.hm(p.v2) + '–' + F.hm(p.b2) : ''} · Pause ${F.num((p.pause || 0) / 60, 2)} · <b>${F.num(p.std, 2)} Std.</b>`}</span>${conf(cf)}</div>`; }).join('');
    const ger = Object.keys(rep.geraete).map((k, i) => row('geraet-' + k, A.byId(D.geraete, k).name, k === 'b27' ? `<input class="pr-in" value="6,5" data-demo="papier-eingabe-b27"> Std. <em>„6,5“ oder „8,5“?</em>` : F.menge(rep.geraete[k]) + ' Std.', k === 'b27' ? 71 : [0, 96, 94, 92][i])).join('');
    const mat = Object.keys(rep.material).map((k, i) => row('material-' + k, A.byId(D.material, k).name, F.menge(rep.material[k]) + ' to.', [97, 95][i])).join('');
    A.sheet && A.closeSheet();
    o.innerHTML = `<div class="ov paper-ov" data-demo="papier-overlay" data-state="upload">
      <div class="po-head"><span class="po-ic">${icon('camera')}</span><div><b>Papier-Bautagesbericht einlesen</b><small class="po-s0">Foto oder Scan der ausgefüllten Vorlage – die KI liest Handschrift und ordnet alles zu.</small><small class="po-s1">${icon('spark')} KI liest Handschrift und gleicht mit Stammdaten ab …</small><small class="po-s2" data-demo="papier-zusammenfassung"><b>34 Felder erkannt</b> · <b class="amber">2 bitte prüfen</b> · Ø Sicherheit 94 % · KST und Mitarbeiter automatisch zugeordnet</small></div><button class="icon-btn" data-act="overlay-close" data-demo="papier-verwerfen" aria-label="Schließen">${icon('x')}</button></div>
      <div class="po-upload"><div class="drop"><span>${icon('file')}</span><b>Papierbericht hierher ziehen</b><small>JPG, PNG oder PDF · auch mehrere Seiten</small><div class="drop-btns"><button class="btn primary lg" data-act="papier-datei" data-demo="papier-datei">${icon('camera')} ${phone() ? 'Foto aufnehmen' : 'Datei wählen'}</button><button class="btn ghost lg" data-act="papier-datei" data-demo="papier-beispiel">${icon('file')} Scan_Bautagesbericht_11-11.jpg</button></div><em>Für die Übergangszeit: Papierzettel bleiben gültig und landen trotzdem in der Nachkalkulation.</em></div></div>
      <div class="po-main"><div class="po-paper"><div class="po-zoom"><div class="hand">${papierBild(rep)}</div></div><i class="scanline"></i></div>
        <div class="po-fields">
          <div class="pr-grp">Kopf</div>${row('datum', 'Datum', F.datumLang(PD), 99)}${row('kst', 'KST.', PK + ` <em>${icon('check')} Baustelle zugeordnet: ${esc(b.name)}</em>`, 97)}${row('ag', 'Auftraggeber', esc(b.ag), 96)}${row('bv', 'Bauvorhaben', esc(b.bv), 93)}
          <div class="pr-grp">Personal <span>${rep.personal.length} Zeilen · Gesamt ${F.num(A.repStd(rep), 2)} Std.</span></div>${pers}
          <div class="pr-grp">Geräte (Std.)</div>${ger}
          <div class="pr-grp">Material (Menge)</div>${mat}${row('zusatz', 'Eigenmaterial', 'Betonsteinpflaster 8 cm grau – 26 m²', 90)}
          <div class="pr-grp">Arbeitsleistung</div>${row('arbeit', 'Text', esc(rep.arbeit).replace(/\n/g, '<br>'), 91)}
          <div class="pr-grp">Paletten · Regie · Vorkommnisse</div>${row('paletten', 'Leerpaletten retour', 'Euro 2 · Weissenböck 5', 96)}${row('regie', 'Regieleistung', esc(rep.regie[0].t) + ' – 1,5 Std.', 88)}${row('vorkommnisse', 'Besondere Vorkommnisse', '<span class="muted">leer</span>', 99)}
          <div class="pr-grp">Unterschriften</div>${row('sig-an', 'Auftragnehmer', icon('check') + ' Unterschrift erkannt', 98)}${row('sig-bh', 'Bauherr', icon('check') + ' Unterschrift erkannt', 95)}
        </div></div>
      <div class="po-foot"><span class="muted">${icon('file')} Original-Scan wird am Bericht angehängt</span><button class="btn ghost lg" data-act="overlay-close">Verwerfen</button><button class="btn primary lg" data-act="papier-ok" data-demo="papier-uebernehmen">${icon('check')} Alle übernehmen</button></div>
    </div>`;
    requestAnimationFrame(() => { o.classList.add('open'); fit(); });
    // unsichere Felder am Papier markieren
    o.querySelectorAll('.hand .ink').forEach((e) => { const t = e.textContent.trim(); if (t === '6,5' || t === kurzName(A.ma(rep.personal[2].ma))) e.classList.add('low'); });
  };
  function fit() { const w = document.querySelector('.po-paper'), z = document.querySelector('.po-zoom'); if (w && z) z.style.zoom = Math.max(0.3, (w.clientWidth - 24) / 830); }
  window.addEventListener('resize', fit);
  let pt = [];
  act['papier-datei'] = () => { const ov = document.querySelector('.paper-ov'); if (!ov) return; ov.dataset.state = 'scan'; fit(); pt.forEach(clearTimeout); pt = [setTimeout(() => { if (ov.isConnected) { ov.dataset.state = 'fertig'; fit(); } }, 2600)]; };
  act['papier-ok'] = () => {
    const rep = papierRep(); const v = parseNum((document.querySelector('[data-demo="papier-eingabe-b27"]') || {}).value || '6,5'); if (v > 0) rep.geraete.b27 = v;
    rep.scan = S.user.name; S.reports = S.reports.filter((r) => r.id !== rep.id).concat([rep]); S.papierDone = true;
    const o = document.getElementById('overlay-root'); o.classList.remove('open'); setTimeout(() => (o.innerHTML = ''), 220);
    if (A.isOffice(S.user)) { A.go('/berichte/' + rep.id); A.render(); } else { A.go('/berichte/' + rep.id); A.render(); }
    A.toast('Papierbericht übernommen – fließt in die Nachkalkulation von ' + A.site(PK).kurz);
  };
  A.scanThumb = (rep) => `<div class="hand mini"><div style="zoom:.3">${papierBild(rep)}</div></div>`;

  /* ---- Start ---- */
  const start0 = A.start;
  A.start = function () {
    start0();
    Object.assign(window.demo, { budgetAlarm: (kst) => demoPush(kst || '26-041'), papier: () => act['papier-start']() });
    if (qs.get('budget')) setTimeout(() => demoPush('26-041'), 1500);
  };
})();
