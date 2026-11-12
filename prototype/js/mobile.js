/* Baustellen-Ansichten: Login, Stempeluhr, Kolonne, Meine Woche, Profil, Bautagesbericht-Assistent */
(function () {
  'use strict';
  const A = window.App, D = window.DATA, S = A.state, F = A.fmt, icon = A.icon, esc = F.esc;
  const act = A.actions, inp = A.inputs;
  const T = (k, d) => (A.t ? A.t(k, d) : d);

  /* ---------- UI-Bausteine ---------- */
  const bump = (key) => (S.ui.bump === key ? ' bump' : '');
  const stepper = (key, val, unit, actName, attrs, big) => `
    <div class="stepper ${val > 0 ? 'on' : ''} ${big ? 'big' : ''}">
      <button class="st-btn" data-act="${actName}" ${attrs} data-d="-1" data-demo="${key}-minus" aria-label="weniger" ${val <= 0 ? 'disabled' : ''}>${icon('minus')}</button>
      <span class="st-val${bump(key)}" data-demo="${key}-wert"><b>${F.menge(val)}</b><small>${unit}</small></span>
      <button class="st-btn plus" data-act="${actName}" ${attrs} data-d="1" data-demo="${key}-plus" aria-label="mehr">${icon('plus')}</button>
    </div>`;
  const STATUS = { entwurf: ['Entwurf', 'grey'], unterschrieben: ['Unterschrieben', 'amber'], freigegeben: ['Freigegeben', 'green'], verrechnet: ['Verrechnet', 'blue'] };
  A.statusChip = (s) => `<span class="chip st-${STATUS[s][1]}"><i class="dot"></i>${STATUS[s][0]}</span>`;
  A.STATUS = STATUS;
  const codeName = { K: 'Krank', U: 'Urlaub', SW: 'Schlechtwetter', F: 'Feiertag' };
  A.codeName = codeName;
  const avatar = (m, cls) => `<span class="avatar ${cls || ''}" title="${esc(m.name)}">${F.initials(m)}</span>`;
  A.avatar = avatar;
  const siteCard = (b, extra) => `
    <div class="site-row"><span class="site-ic">${icon('pin')}</span>
      <div class="site-txt"><small>KST ${b.kst} · ${esc(b.art)}</small><b>${esc(b.name)}</b><span>${esc(b.ort)}</span></div>${extra || ''}</div>`;

  /* ---------- Login ---------- */
  A.route('/login', {
    bare: true,
    render() {
      const pick = S.loginPick ? A.ma(S.loginPick) : null;
      const q = (S.ui.loginSuche || '').toLowerCase();
      const row = (m) => `<button class="login-user" data-act="login-pick" data-id="${m.id}" data-demo="login-user-${m.id}">${avatar(m)}<span><b>${esc(m.name)}</b><small>${esc(A.isOffice(m) ? m.funktion : A.lgName(m.lg) + ' · ' + A.site(m.kst).kurz)}</small></span>${icon('right')}</button>`;
      const all = D.mitarbeiter.concat(D.buero).filter((m) => !q || m.name.toLowerCase().includes(q)).sort((a, b) => a.nn.localeCompare(b.nn, 'de'));
      const recent = [2, 1, 101, 102].map(A.ma);
      const list = `
        <div class="login-head"><h2>Anmelden</h2><p>Wer bist du? Namen antippen und PIN eingeben.</p></div>
        <label class="search"><span>${icon('search')}</span><input type="search" placeholder="Name suchen …" value="${esc(S.ui.loginSuche || '')}" data-input="login-suche" data-demo="login-suche"></label>
        <div class="login-list" id="login-list">
          ${q ? '' : `<div class="list-label">Zuletzt an diesem Gerät</div>${recent.map(row).join('')}<div class="list-label">Alle Mitarbeiter (${all.length})</div>`}
          ${all.map(row).join('') || '<div class="empty">Kein Treffer</div>'}
        </div>`;
      const pin = pick ? `
        <button class="link-back" data-act="login-back" data-demo="login-zurueck">${icon('left')} Anderer Benutzer</button>
        <div class="pin-user">${avatar(pick, 'xl')}<h2>${esc(pick.name)}</h2><p>${esc(A.isOffice(pick) ? pick.funktion : A.lgName(pick.lg))}</p></div>
        <div class="pin-dots" data-demo="pin-dots">${[0, 1, 2, 3].map((i) => `<i class="${S.pin.length > i ? 'on' : ''}"></i>`).join('')}</div>
        <div class="pin-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-act="pin" data-n="${n}" data-demo="pin-${n}">${n}</button>`).join('')}
          <span></span><button data-act="pin" data-n="0" data-demo="pin-0">0</button><button class="pin-del" data-act="pin" data-n="x" data-demo="pin-loeschen" aria-label="Löschen">${icon('back')}</button></div>
        <p class="pin-hint">PIN vergessen? Bitte im Büro melden.<br><span>Demo: beliebige 4 Ziffern</span></p>` : '';
      return `
      <div class="login">
        <div class="login-brand">
          <div class="lb-top">${A.mark}<div><b>BauTag</b><small>Die Baustellen-Plattform</small></div></div>
          <div class="lb-mid">
            <h1>Eine Plattform.<br>Büro, Baustelle, Bauherr.</h1>
            <ul><li>${icon('clock')}<span><b>Zeiterfassung</b> – Einstempeln je Baustelle, auch offline</span></li>
              <li>${icon('clipboard')}<span><b>Digitaler Bautagesbericht</b> – wie die Papiervorlage, mit Unterschrift</span></li>
              <li>${icon('chart')}<span><b>Nachkalkulation</b> – Kosten und Deckungsbeitrag automatisch</span></li></ul>
          </div>
          <div class="lb-foot">Michael Pichler Ges.m.b.H. · 2624 Breitenau<br>Erdbau · Pflasterungen · Asphaltierungen · Transporte · Kieswerk</div>
        </div>
        <div class="login-panel">
          <div class="login-mobile-brand">${A.mark}<div><b>BauTag</b><small>Michael Pichler Ges.m.b.H.</small></div><span class="lm-clock"><b data-tick="clock"></b><small>${F.datumKurz(D.HEUTE)}</small></span></div>
          <div class="login-card ${pick ? 'is-pin' : ''}">${pick ? pin : list}</div>
        </div>
      </div>`;
    }
  });
  act['login-pick'] = (el) => { S.loginPick = +el.dataset.id; S.pin = ''; A.render(); };
  act['login-back'] = () => { S.loginPick = null; S.pin = ''; A.render(); };
  act.pin = (el) => {
    const n = el.dataset.n; if (n === 'x') S.pin = S.pin.slice(0, -1); else if (S.pin.length < 4) S.pin += n;
    A.render();
    if (S.pin.length === 4) setTimeout(() => { S.user = A.ma(S.loginPick); S.loginPick = null; S.pin = ''; const w = S.wunsch && !S.wunsch.startsWith('/login') ? S.wunsch : null; S.wunsch = null; A.go(w || A.home()); }, 380);
  };
  inp['login-suche'] = (el) => { S.ui.loginSuche = el.value; const q = el.value.toLowerCase(); document.querySelectorAll('#login-list .login-user').forEach((b) => { b.style.display = b.textContent.toLowerCase().includes(q) ? '' : 'none'; }); document.querySelectorAll('#login-list .list-label').forEach((l) => (l.style.display = q ? 'none' : '')); };

  /* ---------- Baustellen-Auswahl (Sheet) ---------- */
  function siteSheet(title, actName, currentKst) {
    A.sheet(`<div class="sheet-head"><h3>${title}</h3><button class="icon-btn" data-act="sheet-close" aria-label="Schließen">${icon('x')}</button></div>
      <div class="sheet-body list">${D.baustellen.map((b) => `<button class="pick-row ${b.kst === currentKst ? 'sel' : ''}" data-act="${actName}" data-kst="${b.kst}" data-demo="baustelle-${b.kst}">
        <span class="site-ic">${icon('pin')}</span><span class="pick-txt"><small>KST ${b.kst}</small><b>${esc(b.name)}</b><span>${esc(b.ort)}</span></span>${b.kst === currentKst ? icon('check', 'ok') : ''}</button>`).join('')}</div>`);
  }

  /* ---------- Stempeluhr ---------- */
  const myKst = () => S.ui.stempelKst || (S.user && S.user.kst) || '26-041';
  A.tickers.worked = () => F.hms(A.workedSec(S.user.id));
  A.tickers.pauselauf = () => { const st = A.stamp(S.user.id); const p = st.pausen[st.pausen.length - 1]; return p && p.bis == null ? F.hms(A.nowSec() - p.von) : '00:00:00'; };
  A.tickers.gruss = () => { const h = A.nowSec() / 3600; return h < 10 ? T('gruss', 'Guten Morgen') : h < 17 ? T('gruss2', 'Servus') : T('gruss3', 'Guten Abend'); };

  A.route('/stempeluhr', {
    nav: 'stempeluhr', title: 'Stempeluhr', sub: () => F.datumLang(D.HEUTE),
    render() {
      const u = S.user; if (!A.stamp(u.id)) return `<div class="page narrow"><div class="card pad"><h3>Keine Stempeluhr für Büro-Benutzer</h3><p class="muted">Die Stempeluhr ist für gewerbliche Mitarbeiter gedacht.</p><a class="btn primary" href="#/dashboard">Zum Dashboard</a></div></div>`;
      const st = A.stamp(u.id), b = A.site(st.status === 'aus' ? myKst() : st.kst);
      const first = st.segs[0];
      let hero;
      if (st.status === 'aus') {
        hero = `
        <div class="card clock-card">
          <div class="cc-greet"><span data-tick="gruss">Guten Morgen</span>, ${esc(u.vn)}</div>
          <div class="cc-time" data-tick="clocksec">${F.hms(A.nowSec())}</div>
          <div class="cc-date">${F.datumLang(D.HEUTE)}</div>
          <div class="plan-box">
            <div class="plan-label">${icon('calendar')} ${T('plan', 'Heutige Baustelle laut Einsatzplan')}${myKst() !== u.kst ? ' · <b>geändert</b>' : ''}</div>
            ${siteCard(b, `<button class="btn ghost sm" data-act="site-pick" data-demo="baustelle-aendern">${T('aendern', 'Ändern')}</button>`)}
          </div>
          <button class="punch in" data-act="einstempeln" data-demo="einstempeln"><span class="punch-ic">${icon('play')}</span><span><b>${T('einstempeln', 'Einstempeln')}</b><small>${esc(b.kurz)} · KST ${b.kst}</small></span></button>
          <div class="cc-note">${icon('shield')} ${T('hinweis_ort', 'Der Standort wird nur im Moment des Stempelns erfasst – kein laufendes Tracking.')}</div>
        </div>`;
      } else if (st.status === 'fertig') {
        hero = `
        <div class="card clock-card done">
          <div class="done-ic">${icon('check')}</div>
          <div class="cc-greet">Schönen Feierabend, ${esc(u.vn)}!</div>
          <div class="cc-time">${F.hms(A.workedSec(u.id))}</div>
          <div class="cc-date">Arbeitszeit heute · ${F.hm(first.von / 60)} – ${F.hm(st.segs[st.segs.length - 1].bis / 60)} · Pause ${Math.round(A.pauseSec(u.id) / 60)} min</div>
          ${siteCard(b)}
          <button class="btn ghost block" data-act="einstempeln" data-demo="einstempeln">${icon('play')} Erneut einstempeln</button>
        </div>`;
      } else {
        const p = st.status === 'pause';
        hero = `
        <div class="card clock-card running ${p ? 'paused' : ''}">
          <div class="run-state"><i class="pulse"></i>${p ? T('pause_laeuft', 'Pause läuft') : T('eingestempelt', 'Eingestempelt')} <span>${T('seit', 'seit')} ${F.hm((p ? st.pausen[st.pausen.length - 1].von : first.von) / 60)}</span></div>
          <div class="cc-time big" data-tick="${p ? 'pauselauf' : 'worked'}" data-demo="timer">${p ? '00:00:00' : F.hms(A.workedSec(u.id))}</div>
          <div class="cc-date">${p ? `${T('arbeitszeit', 'Arbeitszeit heute')} <b data-tick="worked">${F.hms(A.workedSec(u.id))}</b>` : `${T('arbeitszeit', 'Arbeitszeit heute')} · ${T('pause', 'Pause')} ${Math.round(A.pauseSec(u.id) / 60)} min`}</div>
          ${siteCard(b)}
          <div class="loc-badge" data-demo="standort-badge">${icon('pin')}<span><b>${T('standort', 'Standort beim Stempeln erfasst')}</b><small>${esc(b.ort)} · ± 12 m · ${F.hm(st.segs[st.segs.length - 1].von / 60)} · ${T('kein_tracking', 'kein laufendes Tracking')}</small></span>${icon('check', 'ok')}</div>
          ${A.stempelExtra ? A.stempelExtra(u, st) : ''}
          <div class="act-grid three">
            <button class="act-btn ${p ? 'resume' : ''}" data-act="pause" data-demo="pause">${icon(p ? 'play' : 'pause')}<span>${p ? T('pause_ende', 'Pause beenden') : T('pause', 'Pause')}</span></button>
            <button class="act-btn" data-act="site-switch" data-demo="baustelle-wechseln" ${p ? 'disabled' : ''}>${icon('swap')}<span>${T('wechseln', 'Baustelle wechseln')}</span></button>
            <button class="act-btn" data-act="geraet-scan" data-demo="geraet-scannen" ${p ? 'disabled' : ''}>${icon('nfc')}<span>${T('geraet', 'Gerät scannen')}</span></button>
          </div>
          <button class="punch out" data-act="ausstempeln" data-demo="ausstempeln"><span class="punch-ic">${icon('logout')}</span><span><b>${T('ausstempeln', 'Ausstempeln')}</b><small>${T('tag_ende', 'Arbeitstag beenden')}</small></span></button>
        </div>`;
      }
      const ev = [];
      st.segs.forEach((g, i) => { ev.push([g.von, i === 0 ? 'Eingestempelt' : 'Baustelle gewechselt', A.site(g.kst).kurz + ' · KST ' + g.kst, i === 0 ? 'in' : 'swap']); });
      st.pausen.forEach((p) => { ev.push([p.von, 'Pause begonnen', '', 'pause']); if (p.bis != null) ev.push([p.bis, 'Pause beendet', Math.max(1, Math.round((p.bis - p.von) / 60)) + ' min', 'in']); });
      if (st.status === 'fertig') ev.push([st.segs[st.segs.length - 1].bis, 'Ausgestempelt', F.std(Math.round(A.workedSec(u.id) / 36) / 100) + ' Std.', 'out']);
      ev.sort((a, b) => a[0] - b[0]);
      const wk = weekData(u.id, 46);
      const side = `
        <div class="card pad">
          <div class="card-h"><h3>${T('buchungen', 'Heutige Buchungen')}</h3><span class="chip ${S.sync === 'online' ? 'st-green' : 'st-amber'}">${icon(S.sync === 'online' ? 'wifi' : 'wifiOff')}${S.sync === 'online' ? 'Synchronisiert' : 'Am Gerät gespeichert'}</span></div>
          ${ev.length ? `<ul class="timeline">${ev.map((e) => `<li class="tl-${e[3]}"><time>${F.hm(e[0] / 60)}</time><i></i><div><b>${e[1]}</b><small>${esc(e[2])}</small></div></li>`).join('')}</ul>` : `<div class="empty">${icon('clock')}<span>${T('keine_buchung', 'Noch keine Buchung heute.')}</span></div>`}
        </div>
        <a class="card pad week-mini" href="#/woche" data-demo="woche-mini">
          <div class="card-h"><h3>${T('diese_woche', 'Diese Woche')} · KW 46</h3>${icon('right')}</div>
          <div class="wm-bars">${wk.tage.slice(0, 5).map((t) => `<div class="wm-day ${t.heute ? 'today' : ''}"><div class="wm-bar"><i style="height:${Math.min(100, (t.std / 10) * 100)}%"></i></div><small>${F.WTK[F.dt(t.d).getDay()]}</small></div>`).join('')}</div>
          <div class="wm-sum"><span><b>${F.std(wk.ist)}</b> von ${F.std(39)} Std.</span><span class="muted">Überstunden ${F.std(wk.ue)} Std.</span></div>
        </a>
        ${u.rolle === 'polier' ? `<a class="card pad link-card" href="#/kolonne" data-demo="zur-kolonne">${icon('users')}<span><b>Kolonne einstempeln</b><small>${kolonneStatus(u)}</small></span>${icon('right')}</a>` : ''}`;
      return `<div class="page stempel"><div class="stempel-grid"><div class="stack">${A.stempelTop ? A.stempelTop(u, st) : ''}${hero}</div><div class="stack">${side}</div></div></div>`;
    }
  });
  const kolonneStatus = (u) => { const c = D.mitarbeiter.filter((m) => m.kst === u.kst); const n = c.filter((m) => ['ein', 'pause'].includes(A.stamp(m.id).status)).length; return n + ' von ' + c.length + ' eingestempelt'; };
  act['site-pick'] = () => siteSheet('Baustelle wählen', 'site-set', myKst());
  act['site-set'] = (el) => { S.ui.stempelKst = el.dataset.kst; A.closeSheet(); A.render(); };
  act.einstempeln = () => { const b = A.site(myKst()); A.clockIn(S.user.id, b.kst); A.render(); A.toast('Eingestempelt · ' + b.kurz + ' · ' + F.hm(A.nowMin()) + ' Uhr'); };
  act.pause = () => { const was = A.stamp(S.user.id).status; A.togglePause(S.user.id); A.render(); A.toast(was === 'ein' ? 'Pause gestartet' : 'Pause beendet – weiter geht’s'); };
  act['site-switch'] = () => siteSheet('Auf welche Baustelle wechseln?', 'site-switch-do', A.stamp(S.user.id).kst);
  act['site-switch-do'] = (el) => { const st = A.stamp(S.user.id); if (el.dataset.kst !== st.kst) { A.switchSite(S.user.id, el.dataset.kst); A.toast('Gewechselt auf ' + A.site(el.dataset.kst).kurz + ' · Standort erfasst'); } A.closeSheet(); A.render(); };
  act.ausstempeln = () => {
    const u = S.user, st = A.stamp(u.id);
    A.sheet(`<div class="sheet-head"><h3>Arbeitstag beenden?</h3><button class="icon-btn" data-act="sheet-close" aria-label="Schließen">${icon('x')}</button></div>
      <div class="sheet-body"><div class="sum-grid"><div><small>Beginn</small><b>${F.hm(st.segs[0].von / 60)}</b></div><div><small>Ende</small><b>${F.hm(A.nowMin())}</b></div><div><small>Pause</small><b>${Math.round(A.pauseSec(u.id) / 60)} min</b></div><div><small>Arbeitszeit</small><b data-tick="worked">${F.hms(A.workedSec(u.id))}</b></div></div>
      ${A.pauseSec(u.id) < 60 && A.workedSec(u.id) > 6 * 3600 ? `<div class="banner warn">${icon('alert')}<span>Über 6 Stunden ohne Pause – bitte Pause nachtragen (AZG § 11).</span></div>` : ''}
      <button class="punch out" data-act="ausstempeln-ok" data-demo="ausstempeln-bestaetigen"><span class="punch-ic">${icon('logout')}</span><span><b>Jetzt ausstempeln</b><small>${esc(A.site(st.kst).kurz)}</small></span></button>
      <button class="btn ghost block" data-act="sheet-close">Abbrechen</button></div>`);
  };
  act['ausstempeln-ok'] = () => { A.clockOut(S.user.id); A.closeSheet(); A.render(); A.toast('Ausgestempelt · ' + F.hm(A.nowMin()) + ' Uhr'); };

  /* ---------- Kolonne ---------- */
  function kolonne() {
    const u = S.user; const kst = S.ui.kolonneKst || u.kst || '26-041';
    if (!S.ui.kolonne) { S.ui.kolonneExtra = []; S.ui.kolonne = {}; D.mitarbeiter.filter((m) => m.kst === kst).forEach((m) => { const st = A.stamp(m.id); if (st.status === 'aus' && !st.code) S.ui.kolonne[m.id] = true; }); }
    const members = D.mitarbeiter.filter((m) => m.kst === kst || S.ui.kolonneExtra.includes(m.id));
    return { kst, members, sel: members.filter((m) => S.ui.kolonne[m.id] && A.stamp(m.id).status === 'aus' && !A.stamp(m.id).code) };
  }
  A.route('/kolonne', {
    nav: 'kolonne', title: 'Kolonne einstempeln', sub: () => 'Partie ' + (S.user.nn || ''),
    render() {
      const k = kolonne(), b = A.site(k.kst);
      const inN = k.members.filter((m) => ['ein', 'pause'].includes(A.stamp(m.id).status)).length;
      const row = (m) => {
        const st = A.stamp(m.id); let chip, cls = '';
        if (st.code) { chip = `<span class="chip st-grey">${st.code} · ${codeName[st.code]}</span>`; cls = 'absent'; }
        else if (st.status === 'ein') { chip = `<span class="chip st-green"><i class="dot"></i>${F.hm(st.segs[st.segs.length - 1].von / 60)}</span>`; cls = 'in'; }
        else if (st.status === 'pause') { chip = `<span class="chip st-amber"><i class="dot"></i>Pause</span>`; cls = 'in'; }
        else if (st.status === 'fertig') { chip = `<span class="chip st-grey">Feierabend</span>`; cls = 'in'; }
        else chip = `<span class="chip st-outline">Offen</span>`;
        const selectable = st.status === 'aus' && !st.code;
        return `<button class="crew-row ${cls} ${selectable && S.ui.kolonne[m.id] ? 'sel' : ''}" data-act="kolonne-toggle" data-id="${m.id}" data-demo="kolonne-ma-${m.id}" ${selectable ? '' : 'disabled'}>
          <span class="check">${icon('check')}</span>${avatar(m)}<span class="crew-txt"><b>${esc(m.name)}${m.id === S.user.id ? ' <em>(ich)</em>' : ''}</b><small>${esc(A.lgName(m.lg))}</small></span>${chip}</button>`;
      };
      const n = k.sel.length;
      return `<div class="page narrow has-foot">
        <div class="card pad"><div class="plan-label">${icon('pin')} Baustelle der Kolonne</div>${siteCard(b, `<button class="btn ghost sm" data-act="kolonne-site" data-demo="kolonne-baustelle">Ändern</button>`)}</div>
        <div class="card">
          <div class="card-h pad-h"><h3>Meine Partie <span class="count">${inN} von ${k.members.length} eingestempelt</span></h3><button class="btn ghost sm" data-act="kolonne-alle" data-demo="kolonne-alle">Alle</button></div>
          <div class="crew-list">${k.members.map(row).join('')}</div>
          <button class="add-row" data-act="kolonne-add" data-demo="kolonne-hinzufuegen">${icon('plus')} Mitarbeiter aus anderer Partie hinzufügen</button>
        </div>
        <div class="banner info">${icon('shield')}<span>Standort wird einmalig beim Einstempeln am Gerät des Poliers erfasst. Jeder Mitarbeiter sieht seine Buchung in der eigenen App.</span></div>
      </div>
      <div class="foot-bar">
        ${n ? `<button class="punch in" data-act="kolonne-ein" data-demo="kolonne-einstempeln"><span class="punch-ic">${icon('users')}</span><span><b>${n} Mitarbeiter einstempeln</b><small>${esc(b.kurz)} · ${F.hm(A.nowMin())} Uhr</small></span></button>`
        : inN ? `<div class="foot-split"><button class="btn ghost lg" data-act="kolonne-pause" data-demo="kolonne-pause">${icon('pause')} Pause für alle</button><button class="btn danger lg" data-act="kolonne-aus" data-demo="kolonne-ausstempeln">${icon('logout')} Alle ausstempeln</button></div>`
        : `<button class="punch in" disabled><span class="punch-ic">${icon('users')}</span><span><b>Niemand ausgewählt</b><small>Mitarbeiter antippen</small></span></button>`}
      </div>`;
    }
  });
  act['kolonne-toggle'] = (el) => { kolonne(); S.ui.kolonne[el.dataset.id] = !S.ui.kolonne[el.dataset.id]; A.render(); };
  act['kolonne-alle'] = () => { const k = kolonne(); const all = k.members.filter((m) => A.stamp(m.id).status === 'aus' && !A.stamp(m.id).code); const on = all.every((m) => S.ui.kolonne[m.id]); all.forEach((m) => (S.ui.kolonne[m.id] = !on)); A.render(); };
  act['kolonne-ein'] = () => { const k = kolonne(); k.sel.forEach((m) => A.clockIn(m.id, k.kst)); A.render(); A.toast(k.sel.length + ' Mitarbeiter eingestempelt · ' + A.site(k.kst).kurz); };
  act['kolonne-pause'] = () => { const k = kolonne(); let n = 0; const anyPause = k.members.some((m) => A.stamp(m.id).status === 'pause'); k.members.forEach((m) => { const s = A.stamp(m.id).status; if ((anyPause && s === 'pause') || (!anyPause && s === 'ein')) { A.togglePause(m.id); n++; } }); A.render(); A.toast(anyPause ? 'Pause beendet für ' + n + ' Mitarbeiter' : 'Pause gestartet für ' + n + ' Mitarbeiter'); };
  act['kolonne-aus'] = () => { const k = kolonne(); let n = 0; k.members.forEach((m) => { if (['ein', 'pause'].includes(A.stamp(m.id).status)) { A.clockOut(m.id); n++; } }); A.render(); A.toast(n + ' Mitarbeiter ausgestempelt'); };
  act['kolonne-site'] = () => siteSheet('Baustelle der Kolonne', 'kolonne-site-set', kolonne().kst);
  act['kolonne-site-set'] = (el) => { S.ui.kolonneKst = el.dataset.kst; S.ui.kolonne = null; A.closeSheet(); A.render(); };
  act['kolonne-add'] = () => {
    const k = kolonne(); const others = D.mitarbeiter.filter((m) => !k.members.includes(m));
    A.sheet(`<div class="sheet-head"><h3>Mitarbeiter hinzufügen</h3><button class="icon-btn" data-act="sheet-close" aria-label="Schließen">${icon('x')}</button></div><div class="sheet-body list">${others.map((m) => `<button class="pick-row" data-act="kolonne-add-do" data-id="${m.id}" data-demo="kolonne-add-${m.id}">${avatar(m)}<span class="pick-txt"><b>${esc(m.name)}</b><span>${esc(A.lgName(m.lg))} · ${esc(A.site(m.kst).kurz)}</span></span>${icon('plus')}</button>`).join('')}</div>`);
  };
  act['kolonne-add-do'] = (el) => { S.ui.kolonneExtra.push(+el.dataset.id); S.ui.kolonne[el.dataset.id] = true; A.closeSheet(); A.render(); };

  /* ---------- Meine Woche ---------- */
  function weekData(id, kw) {
    const mon = F.addDays('2026-11-09', (kw - 46) * 7); const tage = []; let ist = 0, soll = 0, ue = 0;
    for (let i = 0; i < 7; i++) {
      const d = F.addDays(mon, i); let t;
      if (d === D.HEUTE) { const st = A.stamp(id); const h = st ? A.workedSec(id) / 3600 : 0; t = { d, heute: true, std: h, v: st && st.segs[0] ? st.segs[0].von / 60 : null, b: st && st.status === 'fertig' ? st.segs[st.segs.length - 1].bis / 60 : null, pause: st ? Math.round(A.pauseSec(id) / 60) : 0, code: st ? st.code : '', kst: st ? st.kst : null, laeuft: st && ['ein', 'pause'].includes(st.status) }; }
      else if (d > D.HEUTE) t = { d, zukunft: true, std: 0 };
      else { const r = (A.TS[id] || {})[d]; t = r ? { d, std: r.std, v: r.v1, b: r.b2 != null ? r.b2 : r.b1, pause: r.pause, code: r.code, sw: r.sw, kst: r.kst, warn: r.warn } : { d, std: 0, frei: true, feiertag: A.FEIERTAGE[d] }; }
      t.soll = A.sollTag(d); tage.push(t);
      if (!t.zukunft) { const paid = t.std + (t.code === 'K' || t.code === 'U' ? t.soll : 0) + (t.sw || 0); ist += t.std; if (d < D.HEUTE || (t.heute && !t.laeuft && t.std > 0)) { soll += t.soll; ue += Math.max(0, paid - t.soll); } }
    }
    return { mon, tage, ist, soll, ue };
  }
  A.weekData = weekData;
  A.route('/woche', {
    nav: 'woche', title: 'Meine Woche', sub: () => 'Stundenübersicht',
    render() {
      const u = S.user, id = A.stamp(u.id) ? u.id : 2, kw = S.ui.wocheKW, w = weekData(id, kw);
      const days = w.tage.map((t) => {
        const wd = F.dt(t.d).getDay(), we = wd === 0 || wd === 6;
        let right, mid, cls = '';
        if (t.code === 'K' || t.code === 'U') { cls = 'code'; mid = `<span class="code-badge c-${t.code}">${t.code}</span><span class="wd-line">${codeName[t.code]}</span>`; right = `<b>${F.std(t.soll)}</b><small>Std. angerechnet</small>`; }
        else if (t.zukunft || (we && !t.std)) { cls = 'off'; mid = `<span class="wd-line muted">${t.zukunft && !we ? 'geplant · ' + A.site(u.kst || '26-041').kurz : 'frei'}</span>`; right = '<b class="muted">–</b>'; }
        else if (t.feiertag) { cls = 'off'; mid = `<span class="code-badge c-F">F</span><span class="wd-line">${t.feiertag}</span>`; right = '<b class="muted">–</b>'; }
        else if (t.heute && !t.v) { mid = `<span class="wd-line muted">Noch nicht eingestempelt</span>`; right = '<b class="muted">–</b>'; }
        else {
          mid = `<span class="wd-line">${F.hm(t.v)} – ${t.b != null ? F.hm(t.b) : '<em class="live">läuft</em>'}<small> · Pause ${t.pause || 0} min</small></span>
            <span class="wd-site">${t.code === 'SW' ? `<span class="code-badge c-SW">SW</span> ${F.std(t.sw)} Std. Schlechtwetter · ` : ''}${esc(A.site(t.kst).kurz)}</span>
            <span class="wd-bar"><i style="width:${Math.min(100, (t.std / 10.5) * 100)}%"></i>${t.std > t.soll ? `<u style="left:${(t.soll / 10.5) * 100}%;width:${((Math.min(10.5, t.std) - t.soll) / 10.5) * 100}%"></u>` : ''}</span>`;
          right = `<b ${t.heute && t.laeuft ? 'data-tick="workedh"' : ''}>${F.num(t.std, 2)}</b><small>Std.</small>`;
        }
        return `<div class="wd ${cls} ${t.heute ? 'today' : ''}"><div class="wd-day"><b>${F.WTK[wd]}</b><small>${F.dt(t.d).getDate()}.${F.dt(t.d).getMonth() + 1}.</small></div><div class="wd-mid">${mid}</div><div class="wd-std">${right}</div></div>`;
      }).join('');
      const kTage = w.tage.filter((t) => t.code === 'K').length, uTage = w.tage.filter((t) => t.code === 'U').length, swStd = w.tage.reduce((a, t) => a + (t.sw || 0), 0);
      return `<div class="page narrow">
        <div class="week-switch"><button class="icon-btn" data-act="woche-kw" data-d="-1" data-demo="woche-zurueck" ${kw <= 41 ? 'disabled' : ''}>${icon('left')}</button><div><b>KW ${kw}</b><small>${F.datum(w.mon).slice(0, 6)} – ${F.datum(F.addDays(w.mon, 6))}</small></div><button class="icon-btn" data-act="woche-kw" data-d="1" data-demo="woche-vor" ${kw >= 46 ? 'disabled' : ''}>${icon('right')}</button></div>
        <div class="kpi-row three">
          <div class="kpi"><small>Gearbeitet</small><b>${F.num(w.ist, 2)}<i> Std.</i></b><span class="meter"><i style="width:${Math.min(100, (w.ist / 39) * 100)}%"></i></span><em>Soll 39 Std. / Woche</em></div>
          <div class="kpi"><small>Überstunden</small><b>${F.num(w.ue, 2)}<i> Std.</i></b><em>50 % Zuschlag</em></div>
          <div class="kpi"><small>K / U / SW</small><b>${kTage} · ${uTage} · ${F.std(swStd)}<i> Std.</i></b><em>Tage · Tage · Std.</em></div>
        </div>
        <div class="card week-list">${days}</div>
        <div class="legend-row"><span><span class="code-badge c-K">K</span> Krank</span><span><span class="code-badge c-U">U</span> Urlaub</span><span><span class="code-badge c-SW">SW</span> Schlechtwetter</span><span><i class="lg-ue"></i> Überstunden</span></div>
        <div class="card pad two-stats"><div><small>Zeitkonto November</small><b>+ 6,50 Std.</b></div><div><small>Resturlaub 2026</small><b>11 Tage</b></div></div>
      </div>`;
    }
  });
  A.tickers.workedh = () => F.num(A.workedSec(A.stamp(S.user.id) ? S.user.id : 2) / 3600, 2);
  act['woche-kw'] = (el) => { S.ui.wocheKW = Math.max(41, Math.min(46, S.ui.wocheKW + +el.dataset.d)); A.render(); };

  /* ---------- Profil ---------- */
  A.route('/profil', {
    nav: 'profil', title: 'Profil', sub: () => 'Konto & Gerät',
    render() {
      const u = S.user, g = !A.isOffice(u);
      return `<div class="page narrow">
        <div class="card pad profile">${avatar(u, 'xl')}<div><h2>${esc(u.name)}</h2><p>${esc(g ? A.lgName(u.lg) + ' · Personalnr. ' + u.pnr : u.funktion)}</p></div></div>
        ${g ? `<div class="card def-list"><div><span>Stammbaustelle</span><b>${esc(A.site(u.kst).name)}</b></div><div><span>Kostenstelle</span><b>KST ${u.kst}</b></div><div><span>Wochenarbeitszeit</span><b>39,0 Std. (KV Bau)</b></div><div><span>Resturlaub 2026</span><b>11 Tage</b></div><div><span>Zeitkonto</span><b>+ 6,50 Std.</b></div></div>` : ''}
        ${A.profilExtra ? A.profilExtra(u) : ''}
        <div class="card def-list"><div><span>Gerät</span><b>${window.innerWidth < 720 ? 'Handy' : window.innerWidth < 1280 ? 'Tablet' : 'PC'} · angemeldet seit ${F.hm(A.nowMin())}</b></div><div><span>Offline-Modus</span><b>${S.sync === 'online' ? 'Bereit · alles synchronisiert' : 'Aktiv · ' + S.pending + ' Buchungen warten'}</b></div><div><span>Standort</span><b>Nur beim Stempeln · kein Tracking</b></div></div>
        <button class="btn ghost block lg" data-act="logout" data-demo="logout">${icon('logout')} Abmelden</button>
        <p class="fineprint">BauTag · Entwurf / Prototyp · Demo-Daten sind frei erfunden (Beispielwerte)</p>
      </div>`;
    }
  });

  /* ---------- Bautagesbericht-Assistent ---------- */
  const STEPS = [['Kopf', 'Kopfdaten'], ['Personal', 'Personal & Arbeitszeit'], ['Geräte', 'Geräte (Std.)'], ['Material', 'Material (Menge)'], ['Leistung', 'Arbeitsleistung'], ['Beistellung', 'Materialbeistellung · Leerpaletten · Regie'], ['Vorkommnisse', 'Besondere Vorkommnisse'], ['Abschluss', 'Zusammenfassung & Unterschrift']];
  A.STEPS = STEPS;
  A.eigenLines = (rep) => Object.keys(rep.zusatz || {}).filter((k) => rep.zusatz[k] > 0).map((k) => { const m = A.byId(D.material, k); return m.name + ' – ' + F.menge(rep.zusatz[k]) + ' ' + m.einheit; }).concat(rep.eigen || []);
  const gStd = (rep) => Object.values(rep.geraete).reduce((a, b) => a + b, 0);
  const zeit = (v) => (v == null ? '–' : F.hm(v));

  const stepHtml = {
    1(rep, b) {
      const w = [['sonnig', 'sun'], ['bewölkt', 'cloud'], ['Regen', 'rain'], ['Frost', 'cloud']];
      return `<div class="banner ok">${icon('check')}<span><b>Automatisch ausgefüllt</b> aus Baustelle und Einsatzplan – nichts zu tippen.</span></div>
      <div class="card def-list big">
        <div><span>Datum</span><b data-demo="kopf-datum">${F.datumLang(rep.datum)}</b></div>
        <div><span>KST.</span><b data-demo="kopf-kst">${rep.kst}</b></div>
        <div><span>Auftraggeber</span><b data-demo="kopf-ag">${esc(b.ag)}<small>${esc(b.agAdr)}</small></b></div>
        <div><span>Bauvorhaben</span><b data-demo="kopf-bv">${esc(b.bv)}</b></div>
        <div><span>Polier</span><b>${esc((D.mitarbeiter.find((m) => m.kst === rep.kst && m.rolle === 'polier') || S.user).name)}</b></div>
      </div>
      ${A.wetterCard ? A.wetterCard(rep, b) : ''}`;
    },
    2(rep) {
      const rows = rep.personal.map((p) => {
        const m = A.ma(p.ma);
        const times = p.code && !p.std ? `<span class="code-badge c-${p.code}">${p.code}</span> ${codeName[p.code]}` : p.v1 == null ? '<span class="muted">nicht eingestempelt</span>' : `${zeit(p.v1)} – ${p.b1 == null ? '<em class="live">läuft</em>' : zeit(p.b1)}${p.v2 != null ? ` &nbsp;·&nbsp; ${zeit(p.v2)} – ${p.b2 == null ? '<em class="live">läuft</em>' : zeit(p.b2)}` : ''}`;
        return `<button class="pers-row" data-act="pers-edit" data-id="${p.ma}" data-demo="personal-ma-${p.ma}">${avatar(m)}<span class="pers-txt"><b>${esc(m.name)}</b><small>${times}${p.pause ? ' · Pause ' + p.pause + ' min' : ''}${p.code === 'SW' ? ' · <span class="code-badge c-SW">SW</span>' : ''}</small></span><span class="pers-std"><b>${F.num(p.std, 2)}</b><small>Std.</small></span>${icon('right')}</button>`;
      }).join('');
      return `<div class="banner ok">${icon('check')}<span><b>Aus den Stempelungen übernommen.</b> Zum Korrigieren Zeile antippen.</span></div>
      <div class="card"><div class="pers-list">${rows}</div><div class="total-row"><span>Gesamtstunden</span><b data-demo="personal-gesamt">${F.num(A.repStd(rep), 2)} Std.</b></div></div>
      <div class="legend-row"><span><span class="code-badge c-K">K</span> Krank</span><span><span class="code-badge c-U">U</span> Urlaub</span><span><span class="code-badge c-SW">SW</span> Schlechtwetter</span></div>
      <div class="card pad"><div class="card-h"><h3>SEG-Zulagen</h3><span class="muted sm">Schmutz · Erschwernis · Gefahr</span></div>
        ${rep.seg.map((s, i) => `<div class="line-row"><span>${esc(s.t)}</span>${stepper('seg-' + i, s.std, 'Std.', 'seg-step', `data-i="${i}"`)}</div>`).join('')}
        <div class="chip-row">${D.segArten.filter((t) => !rep.seg.some((s) => s.t === t)).map((t, i) => `<button class="pick-chip" data-act="seg-add" data-t="${esc(t)}" data-demo="seg-add-${i}">${icon('plus')}${esc(t)}</button>`).join('')}</div></div>`;
    },
    3(rep, b) {
      const fav = Object.keys(b.geraete || {}); const q = (S.ui.geraetSuche || '').toLowerCase();
      const row = (g) => `<div class="eq-row ${rep.geraete[g.id] ? 'on' : ''} ${rep.ai && rep.ai['geraet-' + g.id] ? 'ai' : ''}" data-name="${esc(g.name.toLowerCase())}" data-demo="geraet-${g.id}" ${q && !g.name.toLowerCase().includes(q) ? 'style="display:none"' : ''}><span class="eq-txt"><b>${esc(g.name)}</b><small>${g.kat}</small></span>${stepper('geraet-' + g.id, rep.geraete[g.id] || 0, 'Std.', 'geraet-step', `data-id="${g.id}"`)}</div>`;
      const favs = D.geraete.filter((g) => fav.includes(g.id)).sort((x, y) => (rep.ai ? (rep.ai['geraet-' + y.id] || 0) - (rep.ai['geraet-' + x.id] || 0) : 0)), rest = D.geraete.filter((g) => !fav.includes(g.id));
      const n = Object.keys(rep.geraete).length;
      return `<label class="search"><span>${icon('search')}</span><input type="search" placeholder="Gerät suchen, z. B. Bagger" value="${esc(S.ui.geraetSuche || '')}" data-input="geraet-suche" data-demo="geraete-suche"></label>
      <div class="sum-strip" data-demo="geraete-summe"><b>${n}</b> ${n === 1 ? 'Gerät' : 'Geräte'} · <b>${F.menge(gStd(rep))}</b> Std. erfasst<span class="muted">+ / − in ganzen Stunden</span></div>
      <div id="eq-lists">
      <div class="list-label">Häufig auf dieser Baustelle</div><div class="card eq-list">${favs.map(row).join('')}</div>
      <div class="list-label">Weitere Geräte laut Vorlage</div><div class="card eq-list">${rest.map(row).join('')}</div>
      </div>`;
    },
    4(rep) {
      const row = (m) => {
        const v = rep.material[m.id] || 0, e = rep.einheit[m.id] || m.einheit, lbl = (x) => (x === 'm3' ? 'm³' : 'to.');
        return `<div class="mat-row ${v ? 'on' : ''} ${rep.ai && rep.ai['material-' + m.id] ? 'ai' : ''}" data-demo="material-${m.id}">
          <div class="mat-top"><span class="eq-txt"><b>${esc(m.name)}</b><small>${esc(m.hinweis)}</small></span>
            ${m.alt ? `<span class="seg-toggle">${[m.einheit, m.alt].map((x) => `<button class="${e === x ? 'sel' : ''}" data-act="mat-einheit" data-id="${m.id}" data-e="${x}" data-demo="material-${m.id}-einheit-${x}">${lbl(x)}</button>`).join('')}</span>` : `<span class="unit-fix">${lbl(e)}</span>`}</div>
          <div class="mat-ctl"><button class="st-btn" data-act="mat-step" data-id="${m.id}" data-d="-1" data-demo="material-${m.id}-minus" ${v <= 0 ? 'disabled' : ''}>${icon('minus')}</button>
            <label class="num-in${bump('material-' + m.id)}"><input type="text" inputmode="decimal" value="${v ? F.menge(v) : ''}" placeholder="0" data-input="mat-in" data-id="${m.id}" data-demo="material-${m.id}-input"><span>${lbl(e)}</span></label>
            <button class="st-btn plus" data-act="mat-step" data-id="${m.id}" data-d="1" data-demo="material-${m.id}-plus">${icon('plus')}</button>
            <button class="fuhre" data-act="mat-step" data-id="${m.id}" data-d="14" data-demo="material-${m.id}-fuhre">${icon('truck')}<span>+ Fuhre<small>14 ${lbl(e)}</small></span></button></div></div>`;
      };
      return `${A.matTop ? A.matTop(rep) : ''}<div class="card mat-list">${D.material.filter((m) => m.vorlage).map(row).join('')}</div>`;
    },
    5(rep) {
      return `<div class="card pad"><div class="card-h"><h3>Arbeitsleistung</h3><button class="btn ghost sm" data-act="diktat-start" data-demo="diktieren">${icon('mic')} Diktieren</button></div>
        <textarea class="ta ${rep.ai && rep.ai.arbeit ? 'ai' : ''}" rows="6" placeholder="Was wurde heute gemacht?" data-input="arbeit" data-demo="arbeit-text">${esc(rep.arbeit)}</textarea>
        <div class="field-label">Textbausteine – antippen statt tippen</div>
        <div class="chip-row">${D.textbausteine.map((t, i) => `<button class="pick-chip" data-act="baustein" data-i="${i}" data-demo="baustein-${i}">${icon('plus')}${esc(t)}</button>`).join('')}</div></div>
      <div class="card pad"><div class="card-h"><h3>Fotos <span class="count">${rep.fotos.length}</span></h3></div>
        <div class="photo-grid">${rep.fotos.map((f, i) => `<figure class="photo" data-demo="foto-${i}"><img src="assets/foto-${f}.jpg" alt="Baustellenfoto"><figcaption>${F.hm(A.nowMin() - (rep.fotos.length - i) * 3)} · ${esc(A.site(rep.kst).kurz)}</figcaption><button class="photo-x" data-act="foto-del" data-i="${i}" aria-label="Foto entfernen">${icon('x')}</button></figure>`).join('')}
          <button class="photo-add" data-act="foto" data-demo="foto-aufnehmen">${icon('camera')}<span>Foto aufnehmen</span></button></div></div>`;
    },
    6(rep) {
      const zus = D.material.filter((m) => !m.vorlage);
      return `<div class="card pad"><div class="card-h"><h3>Materialbeistellung</h3></div>
        <div class="field-label">Eigenmaterial</div>
        ${zus.map((m) => `<div class="line-row ${rep.zusatz[m.id] ? 'on' : ''} ${rep.ai && rep.ai['zusatz-' + m.id] ? 'ai' : ''}"><span>${esc(m.name)}</span>${stepper('zusatz-' + m.id, rep.zusatz[m.id] || 0, m.einheit, 'zusatz-step', `data-id="${m.id}"`)}</div>`).join('')}
        <div class="field-label">Fremdmaterial (vom Auftraggeber beigestellt)</div>
        ${rep.fremdmat.map((t, i) => `<div class="text-line"><span>${esc(t)}</span><button class="icon-btn sm" data-act="fremd-del" data-i="${i}" aria-label="Entfernen">${icon('x')}</button></div>`).join('')}
        <div class="add-line"><input type="text" placeholder="z. B. Schachtabdeckung, beigestellt vom AG" id="fremd-in" data-demo="fremdmaterial-input"><button class="btn ghost" data-act="fremd-add" data-demo="fremdmaterial-add">${icon('plus')}</button></div></div>
      <div class="card pad"><div class="card-h"><h3>Leerpaletten retour</h3><span class="muted sm">leer zurück an den Lieferanten</span></div>
        <div class="line-row"><span>Euro-Paletten</span>${stepper('palette-euro', rep.paletten.euro, 'Stk.', 'pal-step', 'data-id="euro"')}</div>
        <div class="line-row"><span>Weissenböck-Paletten</span>${stepper('palette-weiss', rep.paletten.weiss, 'Stk.', 'pal-step', 'data-id="weiss"')}</div></div>
      <div class="card pad"><div class="card-h"><h3>Regieleistungen</h3><span class="muted sm">nach Aufwand, außerhalb des Auftrags</span></div>
        ${rep.regie.map((r, i) => `<div class="line-row col"><span>${esc(r.t)}</span><div class="line-ctl">${stepper('regie-' + i, r.std, 'Std.', 'regie-step', `data-i="${i}"`)}<button class="icon-btn sm" data-act="regie-del" data-i="${i}" aria-label="Entfernen">${icon('trash')}</button></div></div>`).join('')}
        <div class="add-line"><input type="text" placeholder="Regieleistung beschreiben …" id="regie-in" data-demo="regie-input"><button class="btn ghost" data-act="regie-add" data-demo="regie-add">${icon('plus')}</button></div>
        <div class="chip-row">${['Zusatzarbeit laut Anweisung Bauleitung', 'Wartezeit wegen Behinderung durch Dritte', 'Händischer Aushub bei Leitungen'].map((t, i) => `<button class="pick-chip" data-act="regie-chip" data-t="${esc(t)}" data-demo="regie-chip-${i}">${icon('plus')}${esc(t)}</button>`).join('')}</div></div>`;
    },
    7(rep) {
      const kats = ['Keine', 'Anweisung AG', 'Beschädigung', 'Behinderung', 'Sonstiges'];
      return `<div class="card pad"><div class="card-h"><h3>Besondere Vorkommnisse</h3></div>
        <p class="muted sm">z. B. Anweisungen AG, Beschädigungen, Sonstiges</p>
        <div class="chip-row">${kats.map((k, i) => `<button class="pick-chip ${(rep.vkKat || (rep.vorkommnisse ? '' : 'Keine')) === k ? 'sel' : ''}" data-act="vk-kat" data-k="${k}" data-demo="vorkommnis-${i}">${k}</button>`).join('')}</div>
        <textarea class="ta" rows="5" placeholder="Kurz beschreiben – was, wer, wann?" data-input="vorkommnisse" data-demo="vorkommnisse-text">${esc(rep.vorkommnisse)}</textarea>
        <div class="chip-row">${['Anweisung AG: ', 'Beschädigung festgestellt an ', 'Behinderung durch Fremdfirma: '].map((t, i) => `<button class="pick-chip" data-act="vk-chip" data-t="${esc(t)}" data-demo="vorkommnis-chip-${i}">${icon('plus')}${esc(t.replace(/[: ]+$/, ''))}</button>`).join('')}</div></div>
      <div class="banner info">${icon('camera')}<span>Bei Beschädigungen bitte ein Foto im Schritt „Arbeitsleistung“ ergänzen.</span></div>`;
    },
    8(rep, b) {
      const g = Object.keys(rep.geraete), m = Object.keys(rep.material);
      const card = (step, title, body, ok) => `<a class="sum-card ${ok ? 'ok' : 'open'}" href="#/bericht/${step}" data-demo="zusammenfassung-${step}"><span class="sum-ic">${icon(ok ? 'check' : 'info')}</span><span class="sum-txt"><b>${title}</b><small>${body}</small></span>${icon('right')}</a>`;
      const pers = rep.personal.filter((p) => p.std > 0).length;
      return `<div class="card pad sum-head"><small>KST ${rep.kst} · ${F.datumLang(rep.datum)}</small><h3>${esc(b.name)}</h3><p>${esc(b.ag)}</p></div>
      <div class="card sum-list">
        ${card(2, 'Personal', `${pers} Mitarbeiter · ${F.num(A.repStd(rep), 2)} Std.${rep.personal.some((p) => p.code) ? ' · ' + rep.personal.filter((p) => p.code).map((p) => p.code).join(', ') : ''}`, pers > 0)}
        ${card(3, 'Geräte', g.length ? g.map((k) => A.byId(D.geraete, k).name + ' ' + F.menge(rep.geraete[k]) + ' Std.').join(' · ') : 'Noch keine Geräte erfasst', g.length > 0)}
        ${card(4, 'Material', m.length ? m.map((k) => A.byId(D.material, k).name + ' ' + F.menge(rep.material[k]) + ' ' + (rep.einheit[k] === 'm3' ? 'm³' : 'to.')).join(' · ') : 'Kein Material erfasst', m.length > 0)}
        ${card(5, 'Arbeitsleistung', rep.arbeit ? esc(rep.arbeit.split('\n')[0]) + (rep.fotos.length ? ' · ' + rep.fotos.length + ' Fotos' : '') : 'Noch kein Text', !!rep.arbeit)}
        ${card(6, 'Beistellung · Leerpaletten · Regie', `${A.eigenLines(rep).length + rep.fremdmat.length} Positionen · Leerpaletten ${rep.paletten.euro} Euro / ${rep.paletten.weiss} Weissenböck · Regie ${F.menge(rep.regie.reduce((a, r) => a + r.std, 0))} Std.`, true)}
        ${card(7, 'Besondere Vorkommnisse', rep.vorkommnisse ? esc(rep.vorkommnisse) : 'Keine', true)}
      </div>
      <div class="banner ${rep.status === 'entwurf' ? 'info' : 'ok'}">${icon(rep.status === 'entwurf' ? 'sign' : 'check')}<span>${rep.status === 'entwurf' ? 'Nächster Schritt: Bericht gemeinsam mit dem Bauherrn am Tablet durchsehen und unterschreiben.' : '<b>Bericht ist unterschrieben</b> und wurde an den Auftraggeber gesendet.'}</span></div>`;
    }
  };

  A.route('/bericht/:step?', {
    nav: 'bericht', title: 'Bautagesbericht', sub: () => F.datumLang(D.HEUTE), cls: 'wiz-view',
    render(p) {
      const step = Math.max(1, Math.min(8, +p.step || 1)), rep = A.heuteBericht(), b = A.site(rep.kst);
      const done = (i) => i < step;
      return `<div class="wiz">
        <aside class="wiz-steps"><div class="wiz-site"><small>KST ${rep.kst}</small><b>${esc(b.kurz)}</b>${A.statusChip(rep.status)}</div>
          ${STEPS.map((s, i) => `<a class="wiz-step ${i + 1 === step ? 'cur' : ''} ${done(i + 1) ? 'done' : ''}" href="#/bericht/${i + 1}" data-demo="wizard-step-${i + 1}"><i>${done(i + 1) ? icon('check') : i + 1}</i><span>${s[1]}</span></a>`).join('')}</aside>
        <div class="wiz-main">
          <div class="wiz-head"><div class="wiz-prog">${STEPS.map((s, i) => `<a href="#/bericht/${i + 1}" class="${i + 1 === step ? 'cur' : ''} ${done(i + 1) ? 'done' : ''}" aria-label="${s[0]}"></a>`).join('')}</div>
            <div class="wiz-title"><small>Schritt ${step} von 8 · ${esc(b.kurz)}</small><h2 data-demo="wizard-titel">${STEPS[step - 1][1]}</h2></div></div>
          <div class="wiz-body">${A.wizTop ? A.wizTop(rep, step) : ''}${stepHtml[step](rep, b)}</div>
        </div>
      </div>
      <div class="foot-bar wiz-foot"><div class="foot-split">
        ${step > 1 ? `<a class="btn ghost lg" href="#/bericht/${step - 1}" data-demo="wizard-zurueck">${icon('left')} Zurück</a>` : `<a class="btn ghost lg" href="#/stempeluhr">Abbrechen</a>`}
        ${step < 8 ? `<a class="btn primary lg grow" href="#/bericht/${step + 1}" data-demo="wizard-weiter">Weiter: ${STEPS[step][0]} ${icon('right')}</a>` : `<a class="btn primary lg grow" href="#/bericht/uebersicht" data-demo="zur-unterschrift">${icon('sign')} Zur Unterschrift</a>`}
      </div></div>`;
    }
  });
  const R = () => A.heuteBericht();
  const re = (key) => { S.ui.bump = key; A.render(); S.ui.bump = null; };
  act.wetter = (el) => { R().wetter = el.dataset.w; A.render(); };
  act['temp-step'] = (el) => { R().temp += +el.dataset.d; re('temp'); };
  act['geraet-step'] = (el) => { const r = R(), id = el.dataset.id; const v = Math.max(0, Math.min(24, (r.geraete[id] || 0) + +el.dataset.d)); if (v) r.geraete[id] = v; else delete r.geraete[id]; re('geraet-' + id); };
  inp['geraet-suche'] = (el) => { S.ui.geraetSuche = el.value; const q = el.value.toLowerCase(); document.querySelectorAll('#eq-lists .eq-row').forEach((r) => (r.style.display = r.dataset.name.includes(q) ? '' : 'none')); document.querySelectorAll('#eq-lists .eq-list').forEach((l) => { const any = [...l.children].some((c) => c.style.display !== 'none'); l.style.display = any ? '' : 'none'; l.previousElementSibling.style.display = any ? '' : 'none'; }); };
  act['mat-step'] = (el) => { const r = R(), id = el.dataset.id; const v = Math.max(0, (r.material[id] || 0) + +el.dataset.d); if (v) r.material[id] = v; else delete r.material[id]; re('material-' + id); };
  act['mat-einheit'] = (el) => { R().einheit[el.dataset.id] = el.dataset.e; A.render(); };
  inp['mat-in'] = (el, ev) => { const r = R(), id = el.dataset.id; const v = parseFloat(el.value.replace(/\./g, '').replace(',', '.')); if (v > 0) r.material[id] = v; else delete r.material[id]; el.closest('.mat-row').classList.toggle('on', v > 0); if (ev.type === 'change') A.render(); };
  inp.arbeit = (el) => { R().arbeit = el.value; };
  act.baustein = (el) => { const r = R(); const t = D.textbausteine[+el.dataset.i]; r.arbeit = (r.arbeit ? r.arbeit.replace(/\s+$/, '') + '\n' : '') + t + '.'; A.render(); };
  act.diktat = () => A.toast('Diktierfunktion: im Prototyp nicht aktiv', 'warn');
  act.foto = () => { const r = R(); const all = ['frostschutz', 'pflaster', 'kuenette']; r.fotos.push(all[r.fotos.length % 3]); const v = document.getElementById('view'); v.classList.add('flash'); setTimeout(() => v.classList.remove('flash'), 350); A.render(); A.toast('Foto hinzugefügt · wird bei WLAN hochgeladen'); };
  act['foto-del'] = (el) => { R().fotos.splice(+el.dataset.i, 1); A.render(); };
  act['zusatz-step'] = (el) => { const r = R(), id = el.dataset.id; const big = ['pflaster8', 'randstein', 'rohr150'].includes(id); const v = Math.max(0, (r.zusatz[id] || 0) + +el.dataset.d * (big ? 1 : 0.5)); if (v) r.zusatz[id] = v; else delete r.zusatz[id]; re('zusatz-' + id); };
  act['fremd-add'] = () => { const i = document.getElementById('fremd-in'); if (i.value.trim()) { R().fremdmat.push(i.value.trim()); A.render(); } };
  act['fremd-del'] = (el) => { R().fremdmat.splice(+el.dataset.i, 1); A.render(); };
  act['pal-step'] = (el) => { const r = R(); r.paletten[el.dataset.id] = Math.max(0, r.paletten[el.dataset.id] + +el.dataset.d); re('palette-' + el.dataset.id); };
  act['regie-step'] = (el) => { const r = R().regie[+el.dataset.i]; r.std = Math.max(0, r.std + +el.dataset.d * 0.5); re('regie-' + el.dataset.i); };
  act['regie-del'] = (el) => { R().regie.splice(+el.dataset.i, 1); A.render(); };
  act['regie-add'] = () => { const i = document.getElementById('regie-in'); if (i.value.trim()) { R().regie.push({ t: i.value.trim(), std: 1 }); A.render(); } };
  act['regie-chip'] = (el) => { R().regie.push({ t: el.dataset.t, std: 1 }); A.render(); };
  act['seg-add'] = (el) => { R().seg.push({ t: el.dataset.t, std: 2 }); A.render(); };
  act['seg-step'] = (el) => { const r = R(), i = +el.dataset.i; r.seg[i].std = Math.max(0, r.seg[i].std + +el.dataset.d * 0.5); if (!r.seg[i].std) r.seg.splice(i, 1); re('seg-' + i); };
  act['vk-kat'] = (el) => { const r = R(); r.vkKat = el.dataset.k; if (r.vkKat === 'Keine') r.vorkommnisse = ''; A.render(); };
  act['vk-chip'] = (el) => { const r = R(); r.vorkommnisse = (r.vorkommnisse ? r.vorkommnisse + '\n' : '') + el.dataset.t; r.vkKat = el.dataset.t.startsWith('Anw') ? 'Anweisung AG' : el.dataset.t.startsWith('Besch') ? 'Beschädigung' : 'Behinderung'; A.render(); const t = document.querySelector('[data-demo="vorkommnisse-text"]'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } };
  inp.vorkommnisse = (el) => { const r = R(); r.vorkommnisse = el.value; if (el.value && (!r.vkKat || r.vkKat === 'Keine')) r.vkKat = 'Sonstiges'; };

  // Personal bearbeiten
  act['pers-edit'] = (el) => {
    const r = R(), id = +el.dataset.id; S.ui.persEdit = Object.assign({}, r.personal.find((p) => p.ma === id)); persSheet();
  };
  function persSheet() {
    const p = S.ui.persEdit, m = A.ma(p.ma), nowM = A.nowMin();
    const t = (k, lbl) => `<div class="time-ctl"><small>${lbl}</small><div><button class="st-btn" data-act="pers-t" data-k="${k}" data-d="-15" data-demo="personal-${k}-minus">${icon('minus')}</button><b>${p[k] == null ? '–:–' : F.hm(p[k])}</b><button class="st-btn plus" data-act="pers-t" data-k="${k}" data-d="15" data-demo="personal-${k}-plus">${icon('plus')}</button></div></div>`;
    const calcStd = () => { const e1 = p.b1 == null ? (p.v2 == null ? nowM : p.v1) : p.b1, e2 = p.v2 == null ? 0 : (p.b2 == null ? nowM : p.b2) - p.v2; return p.v1 == null ? 0 : Math.max(0, Math.round(((e1 - p.v1 + e2) / 60) * 4) / 4); };
    if (!(p.code === 'K' || p.code === 'U')) p.std = calcStd(); else p.std = 0;
    A.sheet(`<div class="sheet-head"><h3>${esc(m.name)}</h3><button class="icon-btn" data-act="sheet-close" aria-label="Schließen">${icon('x')}</button></div>
      <div class="sheet-body">
        <div class="field-label">Arbeitszeit · 1. Block</div><div class="time-grid">${t('v1', 'von')}${t('b1', 'bis')}</div>
        <div class="field-label">Arbeitszeit · 2. Block</div><div class="time-grid">${t('v2', 'von')}${t('b2', 'bis')}</div>
        <div class="field-label">Kennzeichen</div>
        <div class="chip-row">${[['', 'Anwesend'], ['K', 'K · Krank'], ['U', 'U · Urlaub'], ['SW', 'SW · Schlechtwetter']].map((c) => `<button class="pick-chip ${p.code === c[0] ? 'sel' : ''}" data-act="pers-code" data-c="${c[0]}" data-demo="personal-code-${c[0] || 'ok'}">${c[1]}</button>`).join('')}</div>
        <div class="total-row flat"><span>Arbeitsstunden</span><b>${F.num(p.std, 2)} Std.</b></div>
        <button class="btn primary lg block" data-act="pers-save" data-demo="personal-speichern">${icon('check')} Übernehmen</button>
      </div>`);
  }
  act['pers-t'] = (el) => { const p = S.ui.persEdit, k = el.dataset.k; const def = { v1: 420, b1: 720, v2: 750, b2: 960 }; p[k] = p[k] == null ? def[k] : Math.max(0, Math.min(1439, Math.round(p[k] / 15) * 15 + +el.dataset.d)); p.pause = p.v2 != null && p.b1 != null ? Math.max(0, p.v2 - p.b1) : p.pause; persSheet(); };
  act['pers-code'] = (el) => { S.ui.persEdit.code = el.dataset.c; persSheet(); };
  act['pers-save'] = () => { const p = S.ui.persEdit; p.laeuft = false; R().manuell[p.ma] = p; A.closeSheet(); A.render(); A.toast('Arbeitszeit von ' + A.ma(p.ma).name + ' korrigiert'); };
})();
