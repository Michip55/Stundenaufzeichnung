/* Büro-Ansichten: Dashboard, Baustellen, Berichte, Preise, Nachkalkulation, Monatsauswertung */
(function () {
  'use strict';
  const A = window.App, D = window.DATA, S = A.state, F = A.fmt, icon = A.icon, esc = F.esc;
  const act = A.actions, inp = A.inputs;
  const mine = (b) => !(S.user && S.user.rolle === 'bauleiter') || S.user.sites.includes(b.kst);
  const sites = () => D.baustellen.filter((b) => !b.intern && mine(b));
  const can = (k) => A.can(k);
  const AMPEL = { gruen: ['Im Plan', 'green'], gelb: ['Beobachten', 'amber'], rot: ['Kritisch', 'red'] };
  const ampel = (a, withLabel) => `<span class="ampel a-${a}" title="${AMPEL[a][0]}"><i></i>${withLabel ? AMPEL[a][0] : ''}</span>`;
  const polierOf = (kst) => D.mitarbeiter.find((m) => m.kst === kst && m.rolle === 'polier');
  const crewOf = (kst) => D.mitarbeiter.filter((m) => A.stamp(m.id).kst === kst);
  const isIn = (m) => ['ein', 'pause'].includes(A.stamp(m.id).status);
  const avatars = (list, max) => `<span class="avatars">${list.slice(0, max).map((m) => `<span class="avatar sm ${isIn(m) ? 'on' : 'off'}" title="${esc(m.name)}${A.stamp(m.id).code ? ' · ' + A.codeName[A.stamp(m.id).code] : ''}">${F.initials(m)}</span>`).join('')}${list.length > max ? `<span class="avatar sm more">+${list.length - max}</span>` : ''}</span>`;

  function warnungen(from, to) {
    const out = [];
    D.mitarbeiter.forEach((m) => Object.values(A.TS[m.id]).forEach((t) => {
      if (!t.warn || t.d < from || t.d > to) return;
      const txt = t.warn === 'azg10' ? [`${F.num(t.std, 1)} Std. – Tageshöchstarbeitszeit von 10 Std. überschritten`, 'AZG § 9', 'red'] : t.warn === 'pause' ? [`${F.num(t.std, 1)} Std. ohne Ruhepause gebucht`, 'AZG § 11', 'amber'] : ['Ausstempeln vergessen – automatisch um 16:00 beendet, bitte prüfen', 'Korrektur', 'amber'];
      out.push({ m, d: t.d, txt: txt[0], tag: txt[1], lvl: txt[2] });
    }));
    return out.sort((a, b) => (a.d < b.d ? 1 : -1));
  }

  /* ---------- Dashboard ---------- */
  A.tickers.stdheute = () => F.num(D.mitarbeiter.reduce((a, m) => a + A.workedSec(m.id), 0) / 3600, 1);
  A.route('/dashboard', {
    nav: 'dashboard', title: 'Dashboard', sub: () => 'Heute · ' + F.datumLang(D.HEUTE),
    render() {
      const all = D.mitarbeiter, inN = all.filter(isIn).length, fertig = all.filter((m) => A.stamp(m.id).status === 'fertig').length;
      const U = all.filter((m) => A.stamp(m.id).code === 'U'), K = all.filter((m) => A.stamp(m.id).code === 'K'), offen = all.filter((m) => A.stamp(m.id).status === 'aus' && !A.stamp(m.id).code);
      const zurFreigabe = S.reports.filter((r) => r.status === 'unterschrieben' && mine(A.site(r.kst))).sort((a, b) => (a.datum < b.datum ? 1 : -1));
      const entwurf = S.reports.filter((r) => r.status === 'entwurf' && mine(A.site(r.kst)));
      const warn = warnungen('2026-11-05', D.HEUTE);
      const siteRows = D.baustellen.filter(mine).map((b) => {
        const crew = crewOf(b.kst); if (!crew.length) return '';
        const n = crew.filter(isIn).length, pol = polierOf(b.kst), rep = S.reports.find((r) => r.kst === b.kst && r.datum === D.HEUTE);
        const c = b.intern || !can('kalk') ? null : A.calc(b.kst);
        const first = Math.min(...crew.filter((m) => A.stamp(m.id).segs.length).map((m) => A.stamp(m.id).segs[0].von).concat([1e9]));
        return `<a class="site-line" href="#/baustellen/${b.kst}" data-demo="dash-baustelle-${b.kst}">
          <div class="sl-main"><small>KST ${b.kst}${pol ? ' · Polier ' + esc(pol.nn) : ''}</small><b>${esc(b.name)}</b><span>${esc(b.ort)}</span></div>
          <div class="sl-crew">${avatars(crew, 5)}<small><b>${n}</b> von ${crew.length} vor Ort${first < 1e9 ? ' · seit ' + F.hm(first / 60) : ''}</small></div>
          <div class="sl-rep">${rep ? A.statusChip(rep.status) : b.intern ? '<span class="chip st-outline">intern</span>' : '<span class="chip st-outline">Bericht offen</span>'}</div>
          <div class="sl-db">${c ? `${ampel(c.ampel)}<span><b>${F.pct(c.dbPct)}</b><small>DB</small></span>` : ''}</div>${icon('right')}</a>`;
      }).join('');
      const feed = all.filter((m) => A.stamp(m.id).segs.length).map((m) => ({ m, t: A.stamp(m.id).segs[A.stamp(m.id).segs.length - 1].von })).sort((a, b) => b.t - a.t).slice(0, 6);
      const wk = ['2026-11-09', '2026-11-10', '2026-11-11'].map((d) => ({ d, h: D.mitarbeiter.reduce((a, m) => a + ((A.TS[m.id][d] || {}).std || 0), 0) }));
      return `<div class="page dash">
        <div class="kpi-row four">
          <div class="kpi hero" data-demo="kpi-eingestempelt"><small>Jetzt eingestempelt</small><b>${inN}<i> von ${all.length}</i></b><span class="meter seg">${`<i class="g" style="flex:${inN}"></i><i class="d" style="flex:${fertig}"></i><i class="u" style="flex:${U.length + K.length}"></i><i class="o" style="flex:${offen.length}"></i>`}</span>
            <em>${fertig ? fertig + ' Feierabend · ' : ''}${U.length} Urlaub · ${K.length} Krank · ${offen.length} noch offen</em></div>
          <div class="kpi"><small>Stunden heute (live)</small><b><span data-tick="stdheute">0</span><i> Std.</i></b><em>auf ${sites().length} Baustellen + Kieswerk</em></div>
          <a class="kpi link" href="#/berichte" data-demo="kpi-berichte"><small>Berichte zur Freigabe</small><b>${zurFreigabe.length}</b><em>${entwurf.length} weitere im Entwurf</em></a>
          <div class="kpi"><small>Offene Warnungen</small><b>${warn.length + (offen.length ? 1 : 0)}</b><em>AZG-Prüfung automatisch</em></div>
        </div>
        <div class="dash-grid">
          <div class="stack">
            <div class="card"><div class="card-h pad-h"><h3>${S.user.rolle === 'bauleiter' ? 'Meine Baustellen heute' : 'Baustellen heute'} <span class="count">${D.baustellen.filter((b) => mine(b) && crewOf(b.kst).length).length} aktiv</span></h3><a class="btn ghost sm" href="#/baustellen">Alle Baustellen</a></div><div class="site-lines">${siteRows}</div></div>
            <div class="card pad"><div class="card-h"><h3>Geleistete Stunden · KW 46</h3><span class="muted sm">alle Mitarbeiter</span></div>
              <div class="hbar-list">${wk.map((x) => `<div class="hbar"><span>${F.datumKurz(x.d)}</span><div class="hbar-track"><i style="width:${(x.h / 280) * 100}%"></i></div><b>${F.num(x.h, 1)} Std.</b></div>`).join('')}
                <div class="hbar live"><span>${F.datumKurz(D.HEUTE)}</span><div class="hbar-track"><i style="width:${Math.min(100, (D.mitarbeiter.reduce((a, m) => a + A.workedSec(m.id), 0) / 3600 / 280) * 100)}%"></i></div><b><span data-tick="stdheute">0</span> Std. · läuft</b></div></div></div>
          </div>
          <div class="stack">
            <div class="card"><div class="card-h pad-h"><h3>Warnungen <span class="count red">${warn.length + (offen.length ? 1 : 0)}</span></h3><a class="btn ghost sm" href="#/monat">Monatsauswertung</a></div>
              <ul class="warn-list">
                ${offen.length ? `<li class="w-amber" data-demo="warnung-offen">${icon('clock')}<div><b>${offen.length} Mitarbeiter noch nicht eingestempelt</b><small>${offen.map((m) => esc(m.name)).join(', ')}</small></div><span class="chip st-amber">heute</span></li>` : ''}
                ${warn.map((w) => `<li class="w-${w.lvl}">${icon('alert')}<div><b>${esc(w.m.name)} · ${F.datumKurz(w.d)}</b><small>${w.txt}</small></div><span class="chip st-${w.lvl}">${w.tag}</span></li>`).join('')}
              </ul></div>
            <div class="card"><div class="card-h pad-h"><h3>Berichte zur Freigabe <span class="count">${zurFreigabe.length}</span></h3><a class="btn ghost sm" href="#/berichte">Alle</a></div>
              <div class="rep-mini">${zurFreigabe.slice(0, 5).map((r) => `<a href="#/berichte/${r.id}" data-demo="dash-bericht-${r.id}"><span class="file-ic">${icon('file')}</span><div><b>${esc(A.site(r.kst).kurz)}</b><small>${F.datumKurz(r.datum)} · ${F.num(A.repStd(r), 1)} Std. · ${Object.keys(r.geraete).length} Geräte</small></div>${A.statusChip(r.status)}</a>`).join('') || '<div class="empty">Alles freigegeben</div>'}</div></div>
            <div class="card pad"><div class="card-h"><h3>Letzte Buchungen</h3><span class="chip st-green"><i class="dot pulse-dot"></i>live</span></div>
              <ul class="feed">${feed.map((f) => `<li>${A.avatar(f.m, 'sm')}<span><b>${esc(f.m.name)}</b> eingestempelt · ${esc(A.site(A.stamp(f.m.id).kst).kurz)}</span><time>${F.hm(f.t / 60)}</time></li>`).join('')}</ul></div>
          </div>
        </div>
      </div>`;
    }
  });

  /* ---------- Baustellen ---------- */
  A.route('/baustellen', {
    nav: 'baustellen', title: 'Baustellen', sub: () => sites().length + ' laufende Baustellen · Kostenstellen 2026',
    render() {
      return `<div class="page"><div class="site-cards">${sites().map((b) => {
        const c = A.calc(b.kst), crew = crewOf(b.kst), pol = polierOf(b.kst);
        return `<a class="card site-card" href="#/baustellen/${b.kst}" data-demo="baustelle-karte-${b.kst}">
          <div class="sc-top"><span class="kst">KST ${b.kst}</span>${can('kalk') ? ampel(c.ampel, true) : `<span class="chip st-outline">${esc(b.art)}</span>`}</div>
          <h3>${esc(b.name)}</h3><p>${esc(b.ag)} · ${esc(b.ort)}</p>
          <div class="sc-prog"><div><small>Leistungsstand</small><b>${F.pct(b.fertig, 0)}</b></div><span class="meter"><i style="width:${b.fertig * 100}%"></i></span></div>
          ${can('kalk') ? `<div class="sc-kpis"><div><small>Erlös bisher</small><b>${F.eur(c.erloes, 0)}</b></div><div><small>Kosten</small><b>${F.eur(c.kosten, 0)}</b></div><div><small>DB</small><b>${F.pct(c.dbPct)}</b></div></div>` : `<div class="sc-kpis"><div><small>Lohnstunden</small><b>${F.num(c.stunden, 0)} Std.</b></div><div><small>Berichte</small><b>${c.nBerichte}</b></div><div><small>Heute</small><b>${crew.filter(isIn).length}/${crew.length}</b></div></div>`}
          <div class="sc-foot">${avatars(crew, 5)}<small>${pol ? 'Polier ' + esc(pol.nn) + ' · ' : ''}${F.datum(b.start).slice(0, 6)} – ${F.datum(b.ende)}</small></div></a>`; }).join('')}</div></div>`;
    }
  });
  A.route('/baustellen/:kst', {
    nav: 'baustellen', title: 'Baustelle', sub: (p) => 'KST ' + p.kst,
    render(p) {
      const b = A.site(p.kst); if (!b) return '<div class="page"><div class="card pad">Baustelle nicht gefunden</div></div>';
      const c = b.intern ? null : A.calc(b.kst), crew = crewOf(b.kst), reps = S.reports.filter((r) => r.kst === b.kst).sort((x, y) => (x.datum < y.datum ? 1 : -1)), heute = reps.find((r) => r.datum === D.HEUTE);
      const st = (m) => { const s = A.stamp(m.id); return s.code ? `<span class="chip st-grey">${s.code} · ${A.codeName[s.code]}</span>` : s.status === 'ein' ? `<span class="chip st-green"><i class="dot"></i>seit ${F.hm(s.segs[s.segs.length - 1].von / 60)}</span>` : s.status === 'pause' ? '<span class="chip st-amber"><i class="dot"></i>Pause</span>' : s.status === 'fertig' ? '<span class="chip st-grey">Feierabend</span>' : '<span class="chip st-outline">nicht eingestempelt</span>'; };
      return `<div class="page">
        <div class="detail-head"><a class="btn ghost sm" href="#/baustellen">${icon('left')} Baustellen</a>
          <div class="dh-main"><small>KST ${b.kst} · ${esc(b.art)}</small><h2>${esc(b.name)}</h2><p>${icon('pin')} ${esc(b.ort)}</p></div>
          ${c && can('kalk') ? `<div class="dh-right">${ampel(c.ampel, true)}<a class="btn primary" href="#/nachkalkulation/${b.kst}" data-demo="baustelle-zur-nachkalkulation">${icon('chart')} Nachkalkulation</a></div>` : ''}</div>
        ${c && !can('kalk') ? `<div class="kpi-row four"><div class="kpi"><small>Leistungsstand</small><b>${F.pct(b.fertig, 0)}</b><span class="meter"><i style="width:${b.fertig * 100}%"></i></span></div><div class="kpi"><small>Lohnstunden bisher</small><b>${F.num(c.stunden, 0)}<i> Std.</i></b><em>aus der Stempeluhr</em></div><div class="kpi"><small>Gerätestunden</small><b>${F.num(Object.values(c.ger).reduce((a, x) => a + x.menge, 0), 0)}<i> Std.</i></b><em>laut Bautagesberichten</em></div><div class="kpi"><small>Bautagesberichte</small><b>${reps.length}</b><em>${reps.filter((r) => r.status === 'unterschrieben').length} zur Freigabe</em></div></div>` : ''}
        ${c && can('kalk') ? `<div class="kpi-row four"><div class="kpi"><small>Auftragssumme</small><b>${F.eur(c.auftrag, 0)}</b><em>netto laut Angebot</em></div><div class="kpi"><small>Leistungsstand</small><b>${F.pct(b.fertig, 0)}</b><span class="meter"><i style="width:${b.fertig * 100}%"></i></span></div><div class="kpi"><small>Kosten bisher</small><b>${F.eur(c.kosten, 0)}</b><em>${F.num(c.stunden, 0)} Lohnstunden</em></div><div class="kpi"><small>Deckungsbeitrag</small><b>${F.pct(c.dbPct)}</b><em>${F.eur(c.db, 0)}</em></div></div>` : ''}
        <div class="dash-grid">
          <div class="stack">
            <div class="card"><div class="card-h pad-h"><h3>Heute vor Ort <span class="count">${crew.filter(isIn).length} von ${crew.length}</span></h3></div>
              <div class="crew-list ro">${crew.map((m) => `<div class="crew-row">${A.avatar(m)}<span class="crew-txt"><b>${esc(m.name)}</b><small>${esc(A.lgName(m.lg))}</small></span><span class="crew-h"><b>${F.num(A.workedSec(m.id) / 3600, 2)}</b> Std.</span>${st(m)}</div>`).join('')}</div></div>
            <div class="card"><div class="card-h pad-h"><h3>Bautagesberichte <span class="count">${reps.length}</span></h3></div>
              <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Datum</th><th class="r">Std.</th><th>Geräte</th><th>Arbeitsleistung</th><th>Status</th></tr></thead><tbody>
              ${reps.slice(0, 8).map((r) => `<tr class="click" data-act="go" data-to="/berichte/${r.id}"><td class="nw">${F.datumKurz(r.datum)}</td><td class="r num">${F.num(A.repStd(r), 1)}</td><td class="nw">${Object.keys(r.geraete).length} Geräte</td><td class="ell">${esc((r.arbeit || '–').split('\n')[0])}</td><td>${A.statusChip(r.status)}</td></tr>`).join('')}</tbody></table></div></div>
          </div>
          <div class="stack">
            <div class="card def-list"><div><span>Auftraggeber</span><b>${esc(b.ag)}<small>${esc(b.agAdr)}</small></b></div><div><span>Bauvorhaben</span><b>${esc(b.bv)}</b></div><div><span>Vertreter Bauherr</span><b>${esc(b.bauherrVertreter || '–')}</b></div><div><span>Bauzeit</span><b>${F.datum(b.start)} – ${F.datum(b.ende)}</b></div><div><span>Polier</span><b>${esc((polierOf(b.kst) || {}).name || '–')}</b></div></div>
            ${heute ? `<div class="card pad"><div class="card-h"><h3>Geräte heute</h3>${A.statusChip(heute.status)}</div>${Object.keys(heute.geraete).length ? `<div class="mini-cost">${Object.keys(heute.geraete).map((k) => `<div><span>${icon('truck')} ${esc(A.byId(D.geraete, k).name)}</span><b>${F.menge(heute.geraete[k])} Std.</b></div>`).join('')}</div>` : '<p class="muted sm">Noch keine Geräte im heutigen Bericht.</p>'}<a class="btn ghost block" href="#/berichte/${heute.id}">${icon('file')} Bericht ansehen</a></div>` : ''}
            ${c ? `<div class="card pad"><div class="card-h"><h3>Leistungspositionen</h3></div>${c.pos.map((x) => `<div class="pos-prog"><div><span>${esc(x.pos.name)}</span><b>${F.menge(x.ist)} / ${F.menge(x.lv)} ${x.pos.einheit}</b></div><span class="meter thin"><i style="width:${Math.min(100, (x.ist / x.lv) * 100)}%"></i></span></div>`).join('')}</div>` : ''}
          </div>
        </div></div>`;
    }
  });

  /* ---------- Berichte-Liste ---------- */
  A.route('/berichte', {
    nav: 'berichte', title: 'Bautagesberichte', sub: () => 'Alle Baustellen · Status und PDF',
    render() {
      const f = S.ui.berichtFilter, k = S.ui.berichtKst;
      const base = S.reports.filter((r) => k === 'alle' || r.kst === k);
      const list = base.filter((r) => f === 'alle' || r.status === f).sort((a, b) => (a.datum === b.datum ? (a.kst < b.kst ? -1 : 1) : a.datum < b.datum ? 1 : -1));
      const cnt = (s) => base.filter((r) => s === 'alle' || r.status === s).length;
      const lim = S.ui.berichtLimit || 40;
      return `<div class="page">
        <div class="toolbar">
          <div class="seg-tabs">${[['alle', 'Alle'], ['entwurf', 'Entwurf'], ['unterschrieben', 'Unterschrieben'], ['freigegeben', 'Freigegeben'], ['verrechnet', 'Verrechnet']].map((x) => `<button class="${f === x[0] ? 'sel' : ''}" data-act="ber-filter" data-f="${x[0]}" data-demo="berichte-filter-${x[0]}">${x[1]}<i>${cnt(x[0])}</i></button>`).join('')}</div>
          <span class="grow"></span>
          <label class="select">${icon('pin')}<select data-input="ber-kst" data-demo="berichte-baustelle"><option value="alle">Alle Baustellen</option>${sites().map((b) => `<option value="${b.kst}" ${k === b.kst ? 'selected' : ''}>${b.kst} · ${esc(b.kurz)}</option>`).join('')}</select></label>
          ${f === 'unterschrieben' && list.length && can('freigabe') ? `<button class="btn primary" data-act="ber-alle-frei" data-demo="berichte-alle-freigeben">${icon('check')} Alle ${list.length} freigeben</button>` : ''}
        </div>
        <div class="card"><div class="tbl-wrap"><table class="tbl reports"><thead><tr><th>Datum</th><th>KST</th><th>Baustelle</th><th class="hide-md">Polier</th><th class="r">Personal</th><th class="r">Std.</th><th class="hide-md">Geräte</th>${can('preise') ? '<th class="r hide-md">Tageskosten</th>' : ''}<th>Status</th><th></th></tr></thead><tbody>
          ${list.slice(0, lim).map((r) => { const b = A.site(r.kst), pol = polierOf(r.kst); return `<tr class="click" data-act="go" data-to="/berichte/${r.id}" data-demo="bericht-zeile-${r.id}"><td class="nw"><b>${F.datumKurz(r.datum)}</b>${r.heute ? ' <span class="chip st-red xs">heute</span>' : ''}</td><td class="nw num">${r.kst}</td><td class="ell"><b>${esc(b.kurz)}</b><small>${esc(b.ag)}</small></td><td class="hide-md nw">${esc(pol ? pol.name : '')}</td><td class="r num">${r.personal.filter((p) => p.std > 0).length}</td><td class="r num">${F.num(A.repStd(r), 1)}</td><td class="hide-md ell">${Object.keys(r.geraete).slice(0, 3).map((g) => A.byId(D.geraete, g).name).join(', ') || '–'}</td>${can('preise') ? `<td class="r num hide-md">${F.eur(A.dayCost(r).sum, 0)}</td>` : ''}<td>${A.statusChip(r.status)}</td><td class="r"><span class="row-act">${icon('file')} PDF</span></td></tr>`; }).join('')}
        </tbody></table></div>
        ${list.length > lim ? `<button class="add-row" data-act="ber-mehr" data-demo="berichte-mehr">${icon('down')} Weitere ${Math.min(40, list.length - lim)} von ${list.length} Berichten laden</button>` : `<div class="tbl-foot">${list.length} Berichte</div>`}</div></div>`;
    }
  });
  act['ber-filter'] = (el) => { S.ui.berichtFilter = el.dataset.f; S.ui.berichtLimit = 40; A.render(); };
  inp['ber-kst'] = (el) => { S.ui.berichtKst = el.value; A.render(); };
  act['ber-mehr'] = () => { S.ui.berichtLimit = (S.ui.berichtLimit || 40) + 40; A.render(); };
  act['ber-alle-frei'] = () => { let n = 0; S.reports.forEach((r) => { if (r.status === 'unterschrieben' && (S.ui.berichtKst === 'alle' || r.kst === S.ui.berichtKst)) { r.status = 'freigegeben'; n++; } }); A.render(); A.toast(n + ' Berichte freigegeben'); };

  /* ---------- Preise & Stammdaten ---------- */
  const TABS = [['lohn', 'Lohn', 'users'], ['geraete', 'Geräte', 'truck'], ['material', 'Material', 'layers'], ['leistungen', 'Leistungspositionen', 'clipboard']];
  const tabKey = { lohn: 'lohn', geraete: 'geraete', material: 'material', leistungen: 'leistung' };
  function diffs() {
    const B = A.basePreise(), out = [];
    [['lohn', ['kosten', 'vk']], ['geraete', ['kosten', 'vk']], ['material', ['ek', 'vk']], ['leistung', ['ep']]].forEach(([k, fs]) => S.preise[k].forEach((x, i) => fs.forEach((f) => { if (Math.abs(x[f] - B[k][i][f]) > 1e-9) out.push({ k, id: x.id, name: x.name, f, alt: B[k][i][f], neu: x[f] }); })));
    return out;
  }
  A.preisDiffs = diffs;
  const fLbl = { kosten: 'Kosten', vk: 'Verrechnung', ek: 'EK', ep: 'EP' };
  A.route('/preise/:tab?', {
    nav: 'preise', title: 'Preise & Stammdaten', sub: () => 'Kosten- und Verrechnungssätze · Grundlage der Nachkalkulation',
    render(p) {
      const tab = TABS.some((t) => t[0] === p.tab) ? p.tab : 'lohn', key = tabKey[tab], B = A.basePreise(), df = diffs();
      const ro = !can('preise_edit');
      const cell = (x, i, f) => { const ch = Math.abs(x[f] - B[key][i][f]) > 1e-9; return `<td class="r price-cell ${ch ? 'changed' : ''}"><label class="price-in ${ro ? 'ro' : ''}"><span>€</span><input type="text" inputmode="decimal" ${ro ? 'readonly' : ''} value="${F.num(x[f], 2)}" data-input="preis" data-k="${key}" data-id="${x.id}" data-f="${f}" data-demo="preis-${tab}-${x.id}-${f}"></label>${ch ? `<small class="was">vorher ${F.eur(B[key][i][f])}</small>` : ''}</td>`; };
      const auf = (a, b) => `<td class="r num muted">${a ? '+' + F.num((b / a - 1) * 100, 0) + ' %' : ''}</td>`;
      const used = {}; S.reports.forEach((r) => Object.keys(r.geraete).forEach((g) => (used[g] = (used[g] || 0) + r.geraete[g])));
      let table;
      if (tab === 'lohn' && false) table = `<div class="empty lock">${icon('shield')}<b>Lohnsätze sind für diese Rolle ausgeblendet</b><span>Sichtbar nur mit dem Recht „Lohnsätze sehen“.</span></div>`;
      else if (tab === 'lohn') table = `<table class="tbl prices"><thead><tr><th>Lohngruppe</th><th class="hide-md">Einstufung</th><th class="r hide-md">Mitarbeiter</th><th class="r">Kosten intern<small>€ / Std. · Mittellohn inkl. LNK</small></th><th class="r">Verrechnung<small>€ / Std. · Regie</small></th><th class="r">Aufschlag</th></tr></thead><tbody>${S.preise.lohn.map((x, i) => `<tr data-demo="preiszeile-lohn-${x.id}"><td><b>${esc(x.name)}</b></td><td class="hide-md muted">${esc(x.kv)}</td><td class="r num hide-md">${D.mitarbeiter.filter((m) => m.lg === x.id).length}</td>${cell(x, i, 'kosten')}${cell(x, i, 'vk')}${auf(x.kosten, x.vk)}</tr>`).join('')}</tbody></table>`;
      else if (tab === 'geraete') table = `<table class="tbl prices"><thead><tr><th>Gerät</th><th class="hide-md">Gruppe</th><th class="r hide-md">Einsatz lfd.<small>Std. seit September</small></th><th class="r">Kosten intern<small>€ / Std. · ohne Bedienung</small></th><th class="r">Verrechnung<small>€ / Std.</small></th><th class="r">Aufschlag</th></tr></thead><tbody>${S.preise.geraete.map((x, i) => `<tr data-demo="preiszeile-geraete-${x.id}"><td><b>${esc(x.name)}</b></td><td class="hide-md muted">${x.kat}</td><td class="r num hide-md">${F.num(used[x.id] || 0, 0)}</td>${cell(x, i, 'kosten')}${cell(x, i, 'vk')}${auf(x.kosten, x.vk)}</tr>`).join('')}</tbody></table>`;
      else if (tab === 'material') table = `<table class="tbl prices"><thead><tr><th>Material</th><th>Einheit</th><th class="hide-md">Hinweis</th><th class="r">Einkauf (EK)<small>€ / Einheit</small></th><th class="r">Verkauf (VK)<small>€ / Einheit</small></th><th class="r">Aufschlag</th></tr></thead><tbody>${S.preise.material.map((x, i) => `<tr data-demo="preiszeile-material-${x.id}"><td><b>${esc(x.name)}</b>${x.vorlage ? ' <span class="chip st-outline xs">Vorlage</span>' : ''}</td><td>${x.einheit === 'to' ? 'to.' : x.einheit}${x.alt ? ' / m³' : ''}</td><td class="hide-md muted">${esc(x.hinweis)}</td>${cell(x, i, 'ek')}${cell(x, i, 'vk')}${auf(x.ek, x.vk)}</tr>`).join('')}</tbody></table>
        <div class="sub-h">Paletten-Pfand</div><table class="tbl prices"><tbody>${S.preise.paletten.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td class="muted">Gutschrift bei Retour laut Bautagesbericht</td><td class="r price-cell"><label class="price-in"><span>€</span><input type="text" inputmode="decimal" value="${F.num(x.pfand, 2)}" data-input="pfand" data-id="${x.id}" data-demo="preis-palette-${x.id}"></label></td></tr>`).join('')}</tbody></table>`;
      else table = `<table class="tbl prices"><thead><tr><th>Pos.</th><th>Leistung</th><th>Einheit</th><th class="r">Einheitspreis<small>€ netto</small></th></tr></thead><tbody>${S.preise.leistung.map((x, i) => `<tr data-demo="preiszeile-leistungen-${x.id}"><td class="num muted">${x.nr}</td><td><b>${esc(x.name)}</b></td><td>${x.einheit}</td>${cell(x, i, 'ep')}</tr>`).join('')}</tbody></table>`;
      const impact = sites().map((b) => ({ b, neu: A.calc(b.kst), alt: A.calcBase(b.kst) })).filter((x) => Math.abs(x.neu.db - x.alt.db) > 0.5).sort((x, y) => Math.abs(y.neu.db - y.alt.db) - Math.abs(x.neu.db - x.alt.db));
      return `<div class="page">
        <div class="toolbar"><div class="seg-tabs big">${TABS.map((t) => `<a class="${tab === t[0] ? 'sel' : ''}" href="#/preise/${t[0]}" data-demo="preise-tab-${t[0]}">${icon(t[2])}${t[1]}</a>`).join('')}</div><span class="grow"></span><span class="chip st-outline">${icon('info')} Beispielwerte 2026 · netto</span></div>
        <div class="price-grid">
          <div class="card"><div class="tbl-wrap">${table}</div><div class="tbl-foot">${ro ? icon('shield') + ' Nur Lesezugriff – Preise bearbeiten ist für diese Rolle nicht freigegeben.' : icon('edit') + ' Preis anklicken, ändern, Enter – die Nachkalkulation aller Baustellen rechnet sofort neu.'}</div></div>
          <aside class="stack">
            <div class="card pad impact ${df.length ? 'has' : ''}" data-demo="preise-auswirkung"><div class="card-h"><h3>Auswirkung</h3>${df.length ? `<span class="chip st-amber">${df.length} Änderung${df.length > 1 ? 'en' : ''}</span>` : ''}</div>
              ${df.length ? `<ul class="diff-list">${df.map((d) => `<li><span><b>${esc(d.name)}</b><small>${fLbl[d.f]}</small></span><span class="dv"><s>${F.eur(d.alt)}</s> ${icon('right')} <b>${F.eur(d.neu)}</b></span></li>`).join('')}</ul>
                ${impact.length ? `<div class="field-label">Deckungsbeitrag je Baustelle</div>${impact.map((x) => { const dd = x.neu.db - x.alt.db; return `<a class="impact-row" href="#/nachkalkulation/${x.b.kst}" data-demo="auswirkung-${x.b.kst}"><span><b>${esc(x.b.kurz)}</b><small>DB ${F.pct(x.alt.dbPct)} → ${F.pct(x.neu.dbPct)}</small></span><span class="delta ${dd < 0 ? 'neg' : 'pos'}">${dd < 0 ? '▼' : '▲'} ${F.eur(Math.abs(dd), 0)}</span>${icon('right')}</a>`; }).join('')}` : '<p class="muted sm">Diese Änderung betrifft keine laufende Baustelle.</p>'}
                <button class="btn ghost block" data-act="preise-reset" data-demo="preise-zuruecksetzen">Änderungen zurücksetzen</button>`
              : `<p class="muted sm">Noch keine Änderung. Sobald ein Preis geändert wird, zeigt diese Karte sofort, wie sich der Deckungsbeitrag der laufenden Baustellen verschiebt.</p>`}
              ${can('kalk') ? `<a class="btn primary block" href="#/nachkalkulation/26-041" data-demo="preise-zur-nachkalkulation">${icon('chart')} Nachkalkulation öffnen</a>` : ''}</div>
            <div class="card pad"><div class="card-h"><h3>So rechnet die Plattform</h3></div><ul class="how"><li><b>Lohn:</b> Stunden aus der Stempeluhr × Kostensatz der Lohngruppe</li><li><b>Geräte:</b> Std. aus dem Bautagesbericht × Gerätesatz</li><li><b>Material:</b> Mengen aus dem Bericht × Einkaufspreis</li><li><b>Erlös:</b> Leistungsstand × Einheitspreis laut Angebot</li></ul></div>
          </aside>
        </div></div>`;
    }
  });
  const parseNum = (s) => parseFloat(String(s).replace(/[€\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  inp.preis = (el, ev) => {
    const v = parseNum(el.value), x = A.byId(S.preise[el.dataset.k], el.dataset.id); if (!(v >= 0)) { if (ev.type === 'change') A.render(); return; }
    const old = x[el.dataset.f]; x[el.dataset.f] = v;
    if (ev.type === 'change') { A.render(); if (Math.abs(old - v) > 1e-9 || el.dataset.dirty) A.toast(x.name + ': ' + F.eur(v) + ' – Nachkalkulation neu berechnet'); }
    else if (Math.abs(old - v) > 1e-9) el.dataset.dirty = '1';
  };
  inp.pfand = (el, ev) => { const v = parseNum(el.value); if (v >= 0) A.byId(S.preise.paletten, el.dataset.id).pfand = v; if (ev.type === 'change') A.render(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches && e.target.matches('.price-in input')) e.target.blur(); });
  document.addEventListener('focusin', (e) => { if (e.target.matches && e.target.matches('.price-in input')) e.target.select(); });
  act['preise-reset'] = () => { const B = A.basePreise(); ['lohn', 'geraete', 'material', 'leistung'].forEach((k) => (S.preise[k] = JSON.parse(JSON.stringify(B[k])))); A.render(); A.toast('Preise auf Ausgangswerte zurückgesetzt'); };

  /* ---------- Nachkalkulation ---------- */
  const CAT = [['lohn', 'Lohn', 'c-lohn'], ['geraete', 'Geräte', 'c-ger'], ['material', 'Material', 'c-mat'], ['fremd', 'Fremdleistung', 'c-fremd']];
  function trendChart(c) {
    const W = 1080, H = 270, L = 56, Rr = 128, T = 14, Bm = 30, t = c.tage; if (t.length < 2) return '<div class="empty">Noch zu wenige Tage für einen Verlauf.</div>';
    const max = Math.max(t[t.length - 1].kumK, t[t.length - 1].kumE) * 1.08, x = (i) => L + (i / (t.length - 1)) * (W - L - Rr), y = (v) => T + (1 - v / max) * (H - T - Bm);
    const step = max / 4, mag = Math.pow(10, Math.floor(Math.log10(step))), nice = Math.ceil(step / mag / 2.5) * 2.5 * mag;
    let grid = ''; for (let v = 0; v <= max; v += nice) grid += `<line x1="${L}" x2="${W - Rr}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 8}" y="${y(v) + 4}" class="ax" text-anchor="end">${v >= 1000 ? F.num(v / 1000, 0) + ' T€' : '0'}</text>`;
    const path = (k) => t.map((d, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(d[k]).toFixed(1)).join(' ');
    const ticks = t.map((d, i) => (i % Math.ceil(t.length / 6) === 0 ? `<text x="${x(i)}" y="${H - 8}" class="ax" text-anchor="middle">${F.datum(d.d).slice(0, 6)}</text>` : '')).join('');
    const last = t[t.length - 1]; let yE = y(last.kumE), yK = y(last.kumK); if (Math.abs(yE - yK) < 16) { const mid = (yE + yK) / 2; if (yE < yK) { yE = mid - 8; yK = mid + 8; } else { yE = mid + 8; yK = mid - 8; } }
    return `<div class="chart-wrap" id="trend" data-n="${t.length}"><svg viewBox="0 0 ${W} ${H}" class="chart">${grid}${ticks}
      <path d="${path('kumE')} L${x(t.length - 1)} ${y(0)} L${x(0)} ${y(0)} Z" class="area-e"/>
      <path d="${path('kumE')}" class="line-e"/><path d="${path('kumK')}" class="line-k"/>
      <circle cx="${x(t.length - 1)}" cy="${y(last.kumE)}" r="4" class="pt-e"/><circle cx="${x(t.length - 1)}" cy="${y(last.kumK)}" r="4" class="pt-k"/>
      <text x="${x(t.length - 1) + 10}" y="${yE + 4}" class="lbl">Erlös ${F.num(last.kumE / 1000, 1)} T€</text><text x="${x(t.length - 1) + 10}" y="${yK + 4}" class="lbl">Kosten ${F.num(last.kumK / 1000, 1)} T€</text>
      <line id="trend-x" class="cross" y1="${T}" y2="${H - Bm}" x1="-10" x2="-10"/><circle id="trend-pe" r="4" class="pt-e" cx="-10" cy="0"/><circle id="trend-pk" r="4" class="pt-k" cx="-10" cy="0"/>
      </svg><div class="chart-tip" id="trend-tip"></div>
      <script type="application/json" id="trend-data">${JSON.stringify({ L, Rr, W, H, T, Bm, max, t: t.map((d) => [d.d, Math.round(d.kumK), Math.round(d.kumE), Math.round(d.kosten)]) })}</script></div>`;
  }
  function trendHover() {
    const wrap = document.getElementById('trend'); if (!wrap) return; const svg = wrap.querySelector('svg'), tip = document.getElementById('trend-tip'), d = JSON.parse(document.getElementById('trend-data').textContent);
    const set = (id, a, v) => document.getElementById(id).setAttribute(a, v);
    svg.addEventListener('mousemove', (e) => {
      const r = svg.getBoundingClientRect(), sx = ((e.clientX - r.left) / r.width) * d.W; const i = Math.max(0, Math.min(d.t.length - 1, Math.round(((sx - d.L) / (d.W - d.L - d.Rr)) * (d.t.length - 1))));
      const X = d.L + (i / (d.t.length - 1)) * (d.W - d.L - d.Rr), y = (v) => d.T + (1 - v / d.max) * (d.H - d.T - d.Bm), p = d.t[i];
      set('trend-x', 'x1', X); set('trend-x', 'x2', X); set('trend-pe', 'cx', X); set('trend-pe', 'cy', y(p[2])); set('trend-pk', 'cx', X); set('trend-pk', 'cy', y(p[1]));
      tip.innerHTML = `<b>${F.datumKurz(p[0])}</b><span><i class="sw e"></i>Erlös kumuliert <b>${F.eur(p[2], 0)}</b></span><span><i class="sw k"></i>Kosten kumuliert <b>${F.eur(p[1], 0)}</b></span><span class="muted">Tageskosten ${F.eur(p[3], 0)}</span>`;
      tip.style.display = 'flex'; const px = (X / d.W) * r.width; tip.style.left = Math.min(r.width - 190, Math.max(0, px + 12)) + 'px';
    });
    svg.addEventListener('mouseleave', () => { tip.style.display = 'none'; set('trend-x', 'x1', -10); set('trend-x', 'x2', -10); set('trend-pe', 'cx', -10); set('trend-pk', 'cx', -10); });
  }
  A.route('/nachkalkulation/:kst?', {
    nav: 'nachkalkulation', title: 'Nachkalkulation', sub: () => 'Kosten, Erlös und Deckungsbeitrag je Baustelle · automatisch aus Stempeluhr und Bautagesberichten',
    render(p) {
      const b = A.site(p.kst) && !A.site(p.kst).intern && mine(A.site(p.kst)) ? A.site(p.kst) : sites()[0], c = A.calc(b.kst), c0 = A.calcBase(b.kst), df = A.preisDiffs();
      const changed = Math.abs(c.db - c0.db) > 0.5 || Math.abs(c.erloes - c0.erloes) > 0.5;
      const dl = (neu, alt, invert) => { const d = neu - alt; if (!changed || Math.abs(d) < 0.5) return ''; const bad = invert ? d > 0 : d < 0; return `<span class="delta ${bad ? 'neg' : 'pos'}" data-demo="kalk-delta">${d < 0 ? '▼' : '▲'} ${F.eur(Math.abs(d), 0)} durch Preisänderung</span>`; };
      const maxSI = Math.max(...CAT.map((k) => Math.max(c[k[0]], c.soll[k[0]]))) || 1;
      const tab = S.ui.kalkTab, P = S.preise;
      const rows = { lohn: Object.keys(c.lg).map((k) => { const x = A.byId(P.lohn, k); return [x.name, c.lg[k].menge, 'Std.', x.kosten, c.lg[k].kosten, c.lg[k].menge * x.vk]; }), geraete: Object.keys(c.ger).map((k) => { const x = A.byId(P.geraete, k); return [x.name, c.ger[k].menge, 'Std.', x.kosten, c.ger[k].kosten, c.ger[k].menge * x.vk, k]; }), material: Object.keys(c.mat).map((k) => { const x = A.byId(P.material, k); return [x.name, c.mat[k].menge, x.einheit === 'to' ? 'to.' : x.einheit, x.ek, c.mat[k].kosten, c.mat[k].menge * x.vk]; }) };
      Object.values(rows).forEach((r) => r.sort((a, b2) => b2[4] - a[4]));
      let tbl;
      if (tab === 'leistung') tbl = `<table class="tbl"><thead><tr><th>Pos.</th><th>Leistung</th><th class="r">Menge LV</th><th class="r">Menge Ist</th><th class="r">EP</th><th class="r">Erlös bisher</th><th class="r hide-md">Auftrag</th></tr></thead><tbody>${c.pos.map((x) => `<tr><td class="num muted">${x.pos.nr}</td><td><b>${esc(x.pos.name)}</b></td><td class="r num">${F.menge(x.lv)} ${x.pos.einheit}</td><td class="r num">${F.menge(x.ist)} ${x.pos.einheit}</td><td class="r num">${F.eur(x.pos.ep)}</td><td class="r num"><b>${F.eur(x.erloes, 0)}</b></td><td class="r num hide-md muted">${F.eur(x.auftrag, 0)}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="5">Summe Erlös (Leistungsstand ${F.pct(b.fertig, 0)})</td><td class="r num">${F.eur(c.erloes, 0)}</td><td class="r num hide-md">${F.eur(c.auftrag, 0)}</td></tr></tfoot></table>`;
      else if (tab === 'fremd') tbl = `<table class="tbl"><thead><tr><th>Datum</th><th>Fremdleistung / Eingangsrechnung</th><th class="r">Betrag</th></tr></thead><tbody>${b.fremd.map((f) => `<tr><td class="nw">${F.datum(f.d)}</td><td><b>${esc(f.text)}</b></td><td class="r num"><b>${F.eur(f.betrag, 0)}</b></td></tr>`).join('')}</tbody><tfoot><tr><td colspan="2">Summe Fremdleistung</td><td class="r num">${F.eur(c.fremd, 0)}</td></tr></tfoot></table>`;
      else { const ch = (id) => tab === 'geraete' && df.some((d) => d.k === 'geraete' && d.id === id && d.f === 'kosten'); tbl = `<table class="tbl"><thead><tr><th>${tab === 'lohn' ? 'Lohngruppe' : tab === 'geraete' ? 'Gerät' : 'Material'}</th><th class="r">Menge</th><th class="r">Kostensatz</th><th class="r">Kosten</th><th class="r hide-md">Anteil</th><th class="r hide-md">Verrechnungswert</th></tr></thead><tbody>${rows[tab].map((r) => `<tr class="${ch(r[6]) ? 'row-changed' : ''}" ${r[6] ? `data-demo="kalk-zeile-${r[6]}"` : ''}><td><b>${esc(r[0])}</b>${ch(r[6]) ? ' <span class="chip st-amber xs">Preis geändert</span>' : ''}</td><td class="r num">${F.num(r[1], 1)} ${r[2]}</td><td class="r num">${tab === 'lohn' && false ? '–' : F.eur(r[3])}</td><td class="r num"><b>${F.eur(r[4], 0)}</b></td><td class="r hide-md"><span class="share"><i style="width:${(r[4] / c[tab]) * 100}%"></i></span></td><td class="r num hide-md muted">${F.eur(r[5], 0)}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="3">Summe ${CAT.find((k) => k[0] === tab)[1]}</td><td class="r num" data-demo="kalk-summe-${tab}">${F.eur(c[tab], 0)}</td><td class="hide-md"></td><td class="hide-md"></td></tr></tfoot></table>`; }
      return `<div class="page kalk">
        <div class="site-tabs">${sites().map((s) => { const x = A.calc(s.kst); return `<a class="${s.kst === b.kst ? 'sel' : ''}" href="#/nachkalkulation/${s.kst}" data-demo="kalk-baustelle-${s.kst}">${ampel(x.ampel)}<span><b>${esc(s.kurz)}</b><small>KST ${s.kst} · DB ${F.pct(x.dbPct)}</small></span></a>`; }).join('')}</div>
        <div class="detail-head"><div class="dh-main"><small>KST ${b.kst} · ${esc(b.ag)}</small><h2>${esc(b.name)}</h2><p>${c.nBerichte} Bautagesberichte · ${F.num(c.stunden, 0)} Lohnstunden · Leistungsstand ${F.pct(b.fertig, 0)} · Stand ${F.datum(D.HEUTE)}, ${F.hm(A.nowMin())} Uhr</p></div>
          <div class="dh-right"><button class="btn ghost" data-act="pdf-demo" data-t="Excel-Export erstellt: Nachkalkulation_${b.kst}.xlsx" data-demo="kalk-export-excel">${icon('download')} Excel</button><button class="btn ghost" data-act="pdf-demo" data-t="PDF-Bericht erstellt: Nachkalkulation_${b.kst}.pdf" data-demo="kalk-export-pdf">${icon('file')} PDF-Bericht</button></div></div>
        ${changed ? `<div class="banner warn" data-demo="kalk-preis-banner">${icon('tag')}<span><b>Mit geänderten Preisen neu berechnet:</b> ${df.slice(0, 3).map((d) => `${esc(d.name)} ${F.eur(d.alt)} → ${F.eur(d.neu)}`).join(' · ')}${df.length > 3 ? ' · …' : ''}</span><a class="btn ghost sm" href="#/preise/geraete">Preise</a></div>` : ''}
        <div class="kpi-row four">
          <div class="kpi" data-demo="kpi-erloes"><small>Erlös (Leistungsstand)</small><b>${F.eur(c.erloes, 0)}</b><em>von ${F.eur(c.auftrag, 0)} Auftragssumme</em>${dl(c.erloes, c0.erloes)}</div>
          <div class="kpi" data-demo="kpi-kosten"><small>Kosten Ist</small><b>${F.eur(c.kosten, 0)}</b><em>Soll laut Kalkulation ${F.eur(c.sollKosten, 0)}</em>${dl(c.kosten, c0.kosten, true)}</div>
          <div class="kpi" data-demo="kpi-db"><small>Deckungsbeitrag</small><b>${F.eur(c.db, 0)}</b><em>Erlös minus Kosten</em>${dl(c.db, c0.db)}</div>
          <div class="kpi ampel-kpi a-${c.ampel}" data-demo="kpi-db-prozent"><small>DB in %</small><b>${F.pct(c.dbPct)}</b><em>${ampel(c.ampel, true)} · Ziel ≥ 15 %</em>${changed ? `<span class="delta ${c.dbPct < c0.dbPct ? 'neg' : 'pos'}">vorher ${F.pct(c0.dbPct)}</span>` : ''}</div>
        </div>
        ${A.kalkInsights ? A.kalkInsights(b, c) : ''}
        <div class="kalk-grid">
          <div class="card pad"><div class="card-h"><h3>Kostenverteilung</h3><span class="muted sm">Ist bis heute</span></div>
            <div class="stackbar">${CAT.map((k) => `<i class="${k[2]}" style="flex:${c[k[0]]}" title="${k[1]}: ${F.eur(c[k[0]], 0)}"></i>`).join('')}</div>
            <div class="cost-legend">${CAT.map((k) => `<div><span><i class="sw ${k[2]}"></i>${k[1]}</span><b data-demo="kosten-${k[0]}">${F.eur(c[k[0]], 0)}</b><small>${F.pct(c[k[0]] / c.kosten, 0)}</small></div>`).join('')}<div class="sum"><span>Kosten gesamt</span><b>${F.eur(c.kosten, 0)}</b><small>100 %</small></div></div></div>
          <div class="card pad"><div class="card-h"><h3>Soll / Ist</h3><div class="legend"><span><i class="sw soll"></i>Soll (Kalkulation, anteilig)</span><span><i class="sw ist"></i>Ist</span></div></div>
            <div class="si-list">${CAT.map((k) => { const s = c.soll[k[0]], i = c[k[0]], d = s ? i / s - 1 : 0, over = d > 0.03; return `<div class="si"><div class="si-l"><b>${k[1]}</b><span class="si-d ${over ? 'neg' : d < -0.03 ? 'pos' : ''}">${over ? icon('alert') : ''}${d >= 0 ? '+' : '−'}${F.num(Math.abs(d) * 100, 1)} %</span></div>
              <div class="si-bars"><div title="Soll ${F.eur(s, 0)}"><i class="soll" style="width:${(s / maxSI) * 100}%"></i><span>${F.eur(s, 0)}</span></div><div title="Ist ${F.eur(i, 0)}"><i class="ist" style="width:${(i / maxSI) * 100}%"></i><span><b>${F.eur(i, 0)}</b></span></div></div></div>`; }).join('')}</div></div>
          <div class="card pad span2"><div class="card-h"><h3>Verlauf · Kosten und Erlös kumuliert</h3><div class="legend"><span><i class="sw e"></i>Erlös (Leistungsstand)</span><span><i class="sw k"></i>Kosten</span></div></div>${trendChart(c)}</div>
          <div class="card span2"><div class="card-h pad-h"><h3>Aufstellung</h3><div class="seg-tabs sm">${[['geraete', 'Geräte'], ['lohn', 'Lohn'], ['material', 'Material'], ['fremd', 'Fremdleistung'], ['leistung', 'Leistungspositionen']].map((t) => `<button class="${tab === t[0] ? 'sel' : ''}" data-act="kalk-tab" data-t="${t[0]}" data-demo="kalk-tab-${t[0]}">${t[1]}</button>`).join('')}</div></div><div class="tbl-wrap">${tbl}</div></div>
        </div></div>`;
    },
    after() { trendHover(); }
  });
  act['kalk-tab'] = (el) => { S.ui.kalkTab = el.dataset.t; A.render(); };

  /* ---------- Monatsauswertung ---------- */
  function monatData(mon) {
    const [y, mo] = mon.split('-').map(Number), n = new Date(y, mo, 0).getDate(), days = Array.from({ length: n }, (_, i) => mon + '-' + String(i + 1).padStart(2, '0'));
    const rows = D.mitarbeiter.map((m) => {
      const r = { m, cells: [], normal: 0, ue: 0, sw: 0, k: 0, u: 0, seg: 0, tg: 0 };
      days.forEach((d) => { const t = A.TS[m.id][d], soll = A.sollTag(d), wd = F.dt(d).getDay(); let c = { d, we: wd === 0 || wd === 6, ft: !!A.FEIERTAGE[d] };
        if (t) { c.code = t.code; c.std = t.std; c.warn = t.warn; if (t.code === 'K') r.k++; else if (t.code === 'U') r.u++; r.normal += Math.min(t.std, soll); r.ue += Math.max(0, t.std - soll); r.sw += t.sw || 0; r.seg += t.seg || 0; if (t.std >= 3 && m.kst !== '90-001') r.tg++; c.ue = t.std > soll; }
        else if (d >= D.HEUTE) c.future = true;
        r.cells.push(c); });
      return r;
    });
    return { days, rows };
  }
  A.route('/monat', {
    nav: 'monat', title: 'Monatsauswertung', sub: () => 'Stunden je Mitarbeiter · Grundlage für Lohnverrechnung und BUAK',
    render() {
      const mon = S.ui.monat, md = monatData(mon), [y, mo] = mon.split('-').map(Number), lfd = mon === '2026-11';
      const sum = (k) => md.rows.reduce((a, r) => a + r[k], 0);
      const warn = (() => { const [a, b] = [mon + '-01', mon + '-31']; return []; })();
      const w = (function () { const out = []; md.rows.forEach((r) => r.cells.forEach((c) => { if (c.warn) out.push({ m: r.m, c }); })); return out; })();
      const wTxt = { azg10: ['über 10 Std. Tagesarbeitszeit', 'AZG § 9', 'red'], pause: ['Ruhepause fehlt', 'AZG § 11', 'amber'], offen: ['Ausstempeln vergessen', 'Korrektur', 'amber'] };
      const head = md.days.map((d) => { const wd = F.dt(d).getDay(); return `<th class="d ${wd === 0 || wd === 6 ? 'we' : ''} ${A.FEIERTAGE[d] ? 'ft' : ''} ${d === D.HEUTE ? 'today' : ''}"><small>${F.WTK[wd]}</small>${F.dt(d).getDate()}</th>`; }).join('');
      const cell = (c) => { let cls = 'd', t = '', ti = '';
        if (c.ft) { cls += ' ft'; t = 'F'; } else if (c.we) cls += ' we'; else if (c.future) cls += ' fu';
        else if (c.code === 'K' || c.code === 'U') { cls += ' c-' + c.code; t = c.code; }
        else if (c.code === 'SW') { cls += ' c-SW'; t = F.std(c.std); ti = 'Schlechtwetter'; }
        else if (c.std != null) { t = F.std(c.std); if (c.ue) cls += ' ue'; }
        if (c.warn) { cls += ' wn'; ti = wTxt[c.warn][0]; }
        if (c.d === D.HEUTE) cls += ' today';
        return `<td class="${cls}" ${ti ? `title="${ti}"` : ''}>${t}</td>`; };
      const body = md.rows.map((r) => `<tr data-demo="monat-zeile-${r.m.id}"><th class="name"><b>${esc(r.m.nn)} ${esc(r.m.vn)}</b><small>${esc(A.lgName(r.m.lg))}</small></th>${r.cells.map(cell).join('')}<td class="s first">${F.num(r.normal, 1)}</td><td class="s ${r.ue ? 'hl' : 'z'}">${F.num(r.ue, 1)}</td><td class="s ${r.sw ? '' : 'z'}">${F.num(r.sw, 1)}</td><td class="s ${r.k ? '' : 'z'}">${r.k}</td><td class="s ${r.u ? '' : 'z'}">${r.u}</td><td class="s ${r.seg ? '' : 'z'}">${r.seg}</td><td class="s">${r.tg}</td></tr>`).join('');
      return `<div class="page monat">
        <div class="toolbar">
          <div class="seg-tabs">${[['2026-10', 'Oktober 2026'], ['2026-11', 'November 2026 · laufend']].map((x) => `<button class="${mon === x[0] ? 'sel' : ''}" data-act="monat-set" data-m="${x[0]}" data-demo="monat-${x[0]}">${x[1]}</button>`).join('')}</div>
          <span class="chip ${lfd ? 'st-amber' : 'st-green'}"><i class="dot"></i>${lfd ? 'Monat läuft · Stand 11.11.' : 'Abgeschlossen · bereit für Export'}</span>
          <span class="grow"></span>
          <button class="btn ghost" data-act="export-buak" data-demo="export-buak">${icon('shield')} BUAK-Meldung</button>
          <button class="btn primary" data-act="export-lohn" data-demo="export-lohn">${icon('download')} Export Lohnverrechnung (BMD/CSV)</button>
        </div>
        <div class="kpi-row six">
          <div class="kpi sm"><small>Normalstunden</small><b>${F.num(sum('normal'), 1)}</b></div><div class="kpi sm"><small>Überstunden 50 %</small><b>${F.num(sum('ue'), 1)}</b></div><div class="kpi sm"><small>Schlechtwetter-Std.</small><b>${F.num(sum('sw'), 1)}</b></div><div class="kpi sm"><small>Krankenstandstage</small><b>${sum('k')}</b></div><div class="kpi sm"><small>Urlaubstage</small><b>${sum('u')}</b></div><div class="kpi sm"><small>SEG-Std. · Taggelder</small><b>${sum('seg')} · ${sum('tg')}</b></div>
        </div>
        ${w.length ? `<div class="card warn-strip" data-demo="monat-warnungen"><div class="ws-h">${icon('alert')}<b>${w.length} AZG-Hinweise</b><small>vor dem Export prüfen</small></div><div class="ws-items">${w.map((x) => `<span class="ws-item w-${wTxt[x.c.warn][2]}"><b>${esc(x.m.nn)}</b> ${F.datum(x.c.d).slice(0, 6)} · ${wTxt[x.c.warn][0]}${x.c.warn === 'azg10' ? ' (' + F.num(x.c.std, 1) + ' Std.)' : ''} <em>${wTxt[x.c.warn][1]}</em></span>`).join('')}</div></div>` : ''}
        <div class="card"><div class="matrix-wrap"><table class="matrix" data-demo="monat-matrix"><thead><tr><th class="name">Mitarbeiter <small>${md.rows.length} · ${F.MON[mo - 1]} ${y}</small></th>${head}<th class="s first" title="Normalstunden">Norm.</th><th class="s" title="Überstunden 50 %">Üst.</th><th class="s" title="Schlechtwetterstunden">SW</th><th class="s" title="Krank (Tage)">K</th><th class="s" title="Urlaub (Tage)">U</th><th class="s" title="SEG-Zulagen (Std.)">SEG</th><th class="s" title="Taggeld (Tage)">Tagg.</th></tr></thead>
          <tbody>${body}</tbody><tfoot><tr><th class="name">Summe</th>${md.days.map(() => '<td class="d"></td>').join('')}<td class="s first">${F.num(sum('normal'), 0)}</td><td class="s">${F.num(sum('ue'), 0)}</td><td class="s">${F.num(sum('sw'), 0)}</td><td class="s">${sum('k')}</td><td class="s">${sum('u')}</td><td class="s">${sum('seg')}</td><td class="s">${sum('tg')}</td></tr></tfoot></table></div>
          <div class="tbl-foot legend-row"><span><span class="code-badge c-K">K</span> Krank</span><span><span class="code-badge c-U">U</span> Urlaub</span><span><span class="code-badge c-SW">SW</span> Schlechtwetter</span><span><span class="code-badge c-F">F</span> Feiertag</span><span><i class="lg-ue"></i> Überstunden</span><span><i class="lg-wn"></i> AZG-Hinweis</span><span class="muted">Norm. = Normalstunden · Üst. = Überstunden 50 % · Tagg. = Taggeld-Tage</span></div></div>
      </div>`;
    }
  });
  act['monat-set'] = (el) => { S.ui.monat = el.dataset.m; A.render(); };
  function exportModal(title, file, lines, facts, demo) {
    A.sheet(`<div class="send-modal export" data-demo="${demo}">
      <div class="send-anim"><div class="spinner"></div><div class="send-ok">${icon('check')}</div></div>
      <h3 class="send-t1">Export wird erstellt …</h3><h3 class="send-t2">${title}</h3>
      <div class="file-chip">${icon('file')}<span><b>${file}</b><small>${facts}</small></span></div>
      <pre class="csv">${lines.map(esc).join('\n')}</pre>
      <div class="send-btns"><button class="btn primary lg" data-act="sheet-close" data-demo="export-fertig">Fertig</button></div></div>`, { cls: 'modal wide' });
    setTimeout(() => { const m = document.querySelector('.send-modal'); if (m) m.classList.add('done'); }, 1200);
  }
  act['export-lohn'] = () => { const md = monatData(S.ui.monat); const lines = ['PersNr;Name;Lohnart;Bezeichnung;Menge;Einheit'].concat(md.rows.slice(0, 4).flatMap((r) => [`${r.m.pnr};${r.m.nn} ${r.m.vn};1000;Normalstunden;${F.num(r.normal, 2)};Std`, `${r.m.pnr};${r.m.nn} ${r.m.vn};1150;Überstunden 50 %;${F.num(r.ue, 2)};Std`].concat(r.sw ? [`${r.m.pnr};${r.m.nn} ${r.m.vn};1420;Schlechtwetter;${F.num(r.sw, 2)};Std`] : []))).concat(['… ' + (md.rows.length - 4) + ' weitere Mitarbeiter']); exportModal('Export für die Lohnverrechnung erstellt', `Lohn_${S.ui.monat}_BMD.csv`, lines, `${md.rows.length} Mitarbeiter · BMD-Importformat · ${F.datum(D.HEUTE)}`, 'export-lohn-dialog'); };
  act['export-buak'] = () => { const md = monatData(S.ui.monat); const lines = ['PersNr;Name;Beschäftigungstage;SW-Stunden;Urlaubstage'].concat(md.rows.slice(0, 6).map((r) => `${r.m.pnr};${r.m.nn} ${r.m.vn};${r.cells.filter((c) => c.std > 0 || c.code).length};${F.num(r.sw, 1)};${r.u}`)).concat(['… ' + (md.rows.length - 6) + ' weitere Mitarbeiter']); exportModal('BUAK-Meldung vorbereitet', `BUAK_Meldung_${S.ui.monat}.csv`, lines, `Beschäftigungszeiten, Schlechtwetter- und Urlaubstage · ${md.rows.length} Arbeitnehmer`, 'export-buak-dialog'); };
})();
