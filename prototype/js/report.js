/* Bautagesbericht: Tablet-Übersicht mit Unterschrift + A4-Druckansicht nach Papiervorlage */
(function () {
  'use strict';
  const A = window.App, D = window.DATA, S = A.state, F = A.fmt, icon = A.icon, esc = F.esc;
  const act = A.actions;
  const z = (v) => (v == null ? '' : F.hm(v));
  const unitLbl = (rep, m) => ((rep.einheit && rep.einheit[m.id]) || m.einheit) === 'm3' ? 'm³' : 'to.';
  const GL = ['kran3', 'kran4', 'lkw2', 'lkw3', 'lkw4', 'sattel', 'tieflader', null, 'verlege', 'schneid', 'kompressor', 'dumper'];
  const GR = ['bobcat', 'b15', 'b27', 'b9', 'b23', 'radlader', 'graeder', 'bomag', 'hamm', 'handwalze', 'ruettel', 'grabenwalze'];
  const polierOf = (kst) => D.mitarbeiter.find((m) => m.kst === kst && m.rolle === 'polier') || A.ma(1);

  const sigSvg = (strokes, cls) => !strokes ? '' : `<svg class="sig-svg ${cls || ''}" viewBox="0 0 300 100" preserveAspectRatio="xMidYMid meet">${strokes.map((s) => `<path d="${s.map((p, i) => (i ? 'L' : 'M') + (p[0] * 300).toFixed(1) + ' ' + (p[1] * 100).toFixed(1)).join(' ')}"/>`).join('')}</svg>`;
  A.sigSvg = sigSvg;

  /* ---------- Tablet-Übersicht ---------- */
  A.route('/bericht/uebersicht', {
    nav: 'bericht', title: 'Bautagesbericht', sub: () => 'Übersicht & Unterschrift', cls: 'form-view',
    render() {
      const rep = A.heuteBericht(), b = A.site(rep.kst), locked = rep.status !== 'entwurf';
      const ed = (step) => (locked ? '' : `<a class="pf-edit" href="#/bericht/${step}" data-demo="uebersicht-edit-${step}">${icon('edit')}<span>Ändern</span></a>`);
      const pers = rep.personal.map((p) => { const m = A.ma(p.ma); const off = p.code && !p.std;
        return `<tr><td class="l"><b>${esc(m.name)}</b></td>${off ? `<td colspan="4" class="codecell"><span class="code-badge c-${p.code}">${p.code}</span> ${A.codeName[p.code]}</td>` : `<td>${z(p.v1)}</td><td>${p.b1 == null && p.v1 != null && p.v2 == null ? '<em class="live">läuft</em>' : z(p.b1)}</td><td>${z(p.v2)}</td><td>${p.v2 != null && p.b2 == null ? '<em class="live">läuft</em>' : z(p.b2)}</td>`}<td>${p.pause ? p.pause + '′' : ''}</td><td class="r"><b>${p.std ? F.num(p.std, 2) : ''}</b></td></tr>`; }).join('');
      const gcell = (id) => { if (!id) return '<div class="pf-g empty"></div>'; const g = A.byId(D.geraete, id), v = rep.geraete[id]; return `<div class="pf-g ${v ? 'on' : ''}"><span>${esc(g.name)}</span><b>${v ? F.menge(v) : ''}</b><small>Std.</small></div>`; };
      const mats = D.material.filter((m) => m.vorlage).map((m) => { const v = rep.material[m.id]; return `<tr class="${v ? 'on' : ''}"><td class="l">${esc(m.name)}</td><td class="r"><b>${v ? F.menge(v) : ''}</b></td><td class="u">${m.alt ? (v ? unitLbl(rep, m) : 'to/m³') : 'to.'}</td></tr>`; }).join('');
      const eigen = A.eigenLines(rep);
      const lines = (arr) => (arr.length ? arr.map((t) => `<li>${esc(t)}</li>`).join('') : '<li class="muted">–</li>');
      const pad = (who, title, sub, name) => { const sig = who === 'bh' ? rep.sigBH : rep.sigAN; return `
        <div class="sig-box ${sig ? 'signed' : ''}" id="sigbox-${who}">
          <div class="sig-h"><div><b>${title}</b><small>${sub}</small></div>${locked ? '' : `<button class="btn ghost sm" data-act="sig-clear" data-who="${who}" data-demo="signatur-${who === 'bh' ? 'bauherr' : 'auftragnehmer'}-loeschen">${icon('trash')} Löschen</button>`}</div>
          <div class="sig-pad" data-who="${who}" data-demo="signatur-${who === 'bh' ? 'bauherr' : 'auftragnehmer'}"><canvas></canvas><span class="sig-ph">${icon('sign')} Hier unterschreiben</span><i class="sig-line"></i></div>
          <div class="sig-f"><span>${esc(name)}</span><span class="sig-time">${sig ? 'Unterschrieben · ' + F.datum(rep.datum) : ''}</span></div>
          ${who === 'bh' && !locked && A.fernSig ? A.fernSig(rep) : ''}
          ${who === 'an' && !locked ? `<button class="btn ghost sm sig-auto" data-act="sig-auto" data-demo="signatur-auftragnehmer-hinterlegt">${icon('pen')} Hinterlegte Unterschrift einsetzen</button>` : ''}
        </div>`; };
      return `<div class="page form-page has-foot">
        ${locked ? `<div class="banner ok">${icon('check')}<span><b>Bericht abgeschlossen.</b> Unterschrieben und um ${rep.gesendet || '16:12'} Uhr als PDF an ${esc(b.agMail)} gesendet.</span></div>` : ''}
        <div class="pform" data-demo="bericht-formular">
          <div class="pf-head">
            <div class="pf-co"><b>Michael Pichler Ges.m.b.H.</b><small>Erdbau · Pflasterungen · Asphaltierungen · Transporte · Kieswerk<br>2624 Breitenau</small></div>
            <div class="pf-title"><h2>BAUTAGESBERICHT</h2><div class="pf-meta"><span>Datum: <b>${F.datum(rep.datum)}</b></span><span>KST.: <b>${rep.kst}</b></span>${A.statusChip(rep.status)}</div></div>
          </div>
          <div class="pf-two">
            <div class="pf-sec"><h4>AUFTRAGGEBER</h4><div class="pf-box"><b>${esc(b.ag)}</b><small>${esc(b.agAdr)}</small></div></div>
            <div class="pf-sec"><h4>BAUVORHABEN</h4><div class="pf-box"><b>${esc(b.bv)}</b><small>${esc(b.ort)}</small></div></div>
          </div>
          <div class="pf-two top">
            <div class="pf-col">
              <div class="pf-sec"><h4>PERSONAL ${ed(2)}</h4>
                <table class="pf-table pers"><thead><tr><th class="l">Name</th><th>von</th><th>bis</th><th>von</th><th>bis</th><th>Pause</th><th class="r">Arbstd.</th></tr></thead><tbody>${pers}</tbody>
                <tfoot><tr><td class="l" colspan="6">Gesamtstunden</td><td class="r"><b data-demo="uebersicht-gesamtstunden">${F.num(A.repStd(rep), 2)}</b></td></tr></tfoot></table>
                <div class="pf-legend">K = Krank &nbsp; U = Urlaub &nbsp; SW = Schlechtwetter</div></div>
              <div class="pf-sec"><h4>MATERIAL <span>Menge</span> ${ed(4)}</h4><table class="pf-table mat"><tbody>${mats}</tbody></table></div>
            </div>
            <div class="pf-col">
              <div class="pf-sec"><h4>SEG-Zulagen ${ed(2)}</h4><div class="pf-box seg">${rep.seg.length ? rep.seg.map((s) => `<div><span>Tätigkeit: <b>${esc(s.t)}</b></span><span>Stunden: <b>${F.menge(s.std)}</b></span></div>`).join('') : '<div><span>Tätigkeit: –</span><span>Stunden: –</span></div>'}</div></div>
              <div class="pf-sec"><h4>GERÄTE <span>Std.</span> ${ed(3)}</h4><div class="pf-ggrid"><div>${GL.map(gcell).join('')}</div><div>${GR.map(gcell).join('')}</div></div></div>
            </div>
          </div>
          <div class="pf-sec"><h4>ARBEITSLEISTUNG ${ed(5)}</h4><div class="pf-box text">${rep.arbeit ? esc(rep.arbeit).replace(/\n/g, '<br>') : '<span class="muted">–</span>'}
            ${rep.fotos.length ? `<div class="pf-photos">${rep.fotos.map((f) => `<img src="assets/foto-${f}.jpg" alt="Foto">`).join('')}<span>${rep.fotos.length} Foto${rep.fotos.length > 1 ? 's' : ''} als Anhang</span></div>` : ''}</div></div>
          <div class="pf-sec"><h4>MATERIALBEISTELLUNG ${ed(6)}</h4><div class="pf-two tight"><div class="pf-box"><em>Eigenmaterial</em><ul>${lines(eigen)}</ul></div><div class="pf-box"><em>Fremdmaterial</em><ul>${lines(rep.fremdmat)}</ul></div></div></div>
          <div class="pf-two top">
            <div class="pf-sec"><h4>PALETTEN RETOUR ${ed(6)}</h4><div class="pf-box pal"><span>Euro: <b>${rep.paletten.euro || '–'}</b></span><span>Weissenböck: <b>${rep.paletten.weiss || '–'}</b></span></div></div>
            <div class="pf-sec"><h4>REGIELEISTUNGEN ${ed(6)}</h4><div class="pf-box"><ul>${lines(rep.regie.map((r) => r.t + ' – ' + F.menge(r.std) + ' Std.'))}</ul></div></div>
          </div>
          <div class="pf-sec"><h4>BESONDERE VORKOMMNISSE <span>z. B. Anweisungen AG, Beschädigungen, Sonstiges</span> ${ed(7)}</h4><div class="pf-box text">${rep.vorkommnisse ? esc(rep.vorkommnisse).replace(/\n/g, '<br>') : '<span class="muted">Keine</span>'}</div></div>
          <div class="pf-two top sigs">
            ${pad('an', 'AUFTRAGNEHMER', 'oder dessen Beauftragter', polierOf(rep.kst).name + ', Polier')}
            ${pad('bh', 'BAUHERR', 'oder dessen bevollmächtigter Vertreter', b.bauherrVertreter + ' · ' + b.ag)}
          </div>
        </div>
      </div>
      <div class="foot-bar form-foot">
        <div class="ff-info">${locked ? `${icon('check', 'ok')}<span><b>Gesendet an ${esc(b.agMail)}</b><small>Kopie ans Büro · PDF im Archiv</small></span>` : `${icon('send')}<span><b>PDF geht an ${esc(b.agMail)}</b><small>Kopie automatisch ans Büro · identisch zur Papiervorlage</small></span>`}</div>
        ${locked ? `<a class="btn ghost lg" href="#/berichte/${rep.id}" data-demo="pdf-ansehen">${icon('file')} PDF ansehen</a>` : `<button class="btn primary lg" data-act="bericht-senden" data-demo="bericht-senden">${icon('send')} Abschließen &amp; PDF an Auftraggeber senden</button>`}
      </div>`;
    },
    after() { setupPads(); }
  });

  function drawStrokes(cv, strokes) {
    const ctx = cv.getContext('2d'), w = cv.width, h = cv.height; ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 2.6 * (window.devicePixelRatio || 1); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#17307a';
    (strokes || []).forEach((s) => { if (!s.length) return; ctx.beginPath(); s.forEach((p, i) => (i ? ctx.lineTo(p[0] * w, p[1] * h) : ctx.moveTo(p[0] * w, p[1] * h))); if (s.length === 1) ctx.lineTo(s[0][0] * w + 0.1, s[0][1] * h); ctx.stroke(); });
  }
  function setupPads() {
    const rep = A.heuteBericht(), locked = rep.status !== 'entwurf';
    document.querySelectorAll('.sig-pad').forEach((pad) => {
      const who = pad.dataset.who, key = who === 'bh' ? 'sigBH' : 'sigAN', cv = pad.querySelector('canvas');
      const dpr = window.devicePixelRatio || 1, rc = pad.getBoundingClientRect();
      cv.width = Math.round(rc.width * dpr); cv.height = Math.round(rc.height * dpr);
      drawStrokes(cv, rep[key]);
      if (locked) return;
      let cur = null;
      const pt = (e) => { const r = cv.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]; };
      cv.addEventListener('pointerdown', (e) => { e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (x) {} cur = [pt(e)]; rep[key] = (rep[key] || []).concat([cur]); pad.parentNode.classList.add('signed'); drawStrokes(cv, rep[key]); });
      cv.addEventListener('pointermove', (e) => { if (!cur) return; cur.push(pt(e)); drawStrokes(cv, rep[key]); });
      const end = () => { if (!cur) return; cur = null; const t = pad.parentNode.querySelector('.sig-time'); if (t) t.textContent = 'Unterschrieben · ' + F.hm(A.nowMin()) + ' Uhr'; };
      cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    });
  }
  act['sig-clear'] = (el) => { const rep = A.heuteBericht(); rep[el.dataset.who === 'bh' ? 'sigBH' : 'sigAN'] = null; A.render(); };
  act['sig-auto'] = () => { const rep = A.heuteBericht(); rep.sigAN = A.demoSignatur('an' + rep.kst); A.render(); };
  act['bericht-senden'] = () => {
    const rep = A.heuteBericht(), b = A.site(rep.kst);
    if (!rep.sigBH || !rep.sigBH.length) { A.toast('Bitte zuerst den Bauherrn unterschreiben lassen', 'warn'); const p = document.getElementById('sigbox-bh'); if (p) { p.scrollIntoView({ behavior: 'smooth', block: 'center' }); p.classList.add('shake'); setTimeout(() => p.classList.remove('shake'), 600); } return; }
    if (!rep.sigAN) rep.sigAN = A.demoSignatur('an' + rep.kst);
    const file = `Bautagesbericht_${rep.kst}_${rep.datum}.pdf`;
    A.sheet(`<div class="send-modal" data-demo="senden-dialog">
        <div class="send-anim"><div class="spinner"></div><div class="send-ok">${icon('check')}</div></div>
        <h3 class="send-t1">PDF wird erzeugt …</h3><h3 class="send-t2">Bericht abgeschlossen &amp; gesendet</h3>
        <ul class="send-steps"><li>${icon('check')}<span>Unterschriften gespeichert (Bauherr &amp; Auftragnehmer)</span></li><li>${icon('check')}<span>PDF nach Vorlage erzeugt · <b>${file}</b></span></li><li>${icon('check')}<span>Gesendet an <b>${esc(b.agMail)}</b></span></li><li>${icon('check')}<span>Kopie ans Büro – wartet auf Freigabe</span></li></ul>
        <div class="send-btns"><a class="btn ghost lg" href="#/berichte/${rep.id}" data-demo="senden-pdf-ansehen">${icon('file')} PDF ansehen</a><button class="btn primary lg" data-act="sheet-close" data-demo="senden-fertig">Fertig</button></div>
      </div>`, { cls: 'modal' });
    rep.status = 'unterschrieben'; rep.gesendet = F.hm(A.nowMin());
    setTimeout(() => { const m = document.querySelector('.send-modal'); if (m) m.classList.add('done'); A.render(); }, 1500);
  };

  /* ---------- A4-Papieransicht (wie Vorlage) ---------- */
  function paper(rep) {
    const b = A.site(rep.kst);
    const ink = (t) => `<span class="ink">${t}</span>`;
    const n = Math.max(7, rep.personal.length);
    const pers = Array.from({ length: n }, (_, i) => { const p = rep.personal[i]; if (!p) return '<tr><td class="l"></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>'; const m = A.ma(p.ma); const off = p.code && !p.std;
      return `<tr><td class="l">${ink(esc(m.name))}</td><td>${ink(off ? p.code : z(p.v1))}</td><td>${ink(off ? '' : z(p.b1 != null ? p.b1 : null))}</td><td>${ink(z(p.v2))}</td><td>${ink(z(p.b2))}</td><td>${ink(p.pause ? F.num(p.pause / 60, 2) : '')}</td><td>${ink(p.std ? F.num(p.std, 2) + (p.code === 'SW' ? ' SW' : '') : '')}</td></tr>`; }).join('');
    const g = (id) => { if (!id) return '<td class="gn"></td><td class="gv"></td><td class="gu">Std.</td>'; const x = A.byId(D.geraete, id), v = rep.geraete[id]; return `<td class="gn">${esc(x.name)}</td><td class="gv">${ink(v ? F.menge(v) : '')}</td><td class="gu">Std.</td>`; };
    const mats = D.material.filter((m) => m.vorlage).map((m) => { const v = rep.material[m.id]; return `<tr><td class="l">${esc(m.name)}</td><td>${ink(v ? F.menge(v) + (m.alt ? ' ' + unitLbl(rep, m) : '') : '')}</td><td class="u">${m.alt ? 'to/m3' : 'to.'}</td></tr>`; }).join('');
    const ruled = (arr, count) => Array.from({ length: Math.max(count, arr.length) }, (_, i) => `<div class="rl">${ink(esc(arr[i] || ''))}</div>`).join('');
    const wrap = (text, max) => { const out = []; String(text || '').split('\n').forEach((par) => { let line = ''; par.split(' ').forEach((w) => { if ((line + ' ' + w).trim().length > max) { out.push(line); line = w; } else line = (line + ' ' + w).trim(); }); out.push(line); }); return out; };
    const arbeit = wrap(rep.arbeit, 104); if (rep.fotos && rep.fotos.length) arbeit.push('(' + rep.fotos.length + ' Foto' + (rep.fotos.length > 1 ? 's' : '') + ' im digitalen Anhang)');
    const eigen = A.eigenLines(rep), seg = rep.seg || [];
    return `<div class="a4" data-demo="pdf-seite">
      <div class="a4-row hd">
        <div class="a4-logo"><b>Michael Pichler Ges.m.b.H.</b><span>Erdbau · Pflasterungen · Asphaltierungen · Transporte · Kieswerk</span><strong>2624 BREITENAU</strong></div>
        <div class="a4-title"><div class="t">B A U T A G E S B E R I C H T</div><div class="m"><span>Datum: ${ink(F.datum(rep.datum))}</span><span>KST.: ${ink(rep.kst)}</span></div></div>
      </div>
      <div class="a4-row ab">
        <div class="a4-lab"><div class="tab">AUFTRAGGEBER:</div><div class="val">${ink(esc(b.ag))}<br>${ink(esc(b.agAdr))}</div></div>
        <div class="a4-lab"><div class="tab">BAUVORHABEN:</div><div class="val">${ink(esc(b.bv))}</div></div>
      </div>
      <div class="a4-row mid">
        <div class="a4-left">
          <table class="a4-pers"><colgroup><col style="width:33%"><col><col><col><col><col style="width:10.5%"><col style="width:12%"></colgroup><thead><tr class="az"><th class="nob"></th><th colspan="4">Arbeitszeit</th><th class="nob" colspan="2"></th></tr><tr><th class="l lab">PERSONAL:</th><th>von</th><th>bis</th><th>von</th><th>bis</th><th>Pause</th><th>Arbstd.</th></tr></thead>
            <tbody>${pers}</tbody><tfoot><tr><td class="gs" colspan="6">Gesamtstunden:</td><td>${ink(F.num(A.repStd(rep), 2))}</td></tr><tr><td class="leg" colspan="7">K= Krank &nbsp;&nbsp;&nbsp;&nbsp; U= Urlaub &nbsp;&nbsp;&nbsp;&nbsp; SW=Schlechtwetter</td></tr></tfoot></table>
          <table class="a4-mat"><thead><tr><th class="lab">MATERIAL:</th><th class="mh">Menge</th><th class="nobt"></th></tr></thead><tbody>${mats}</tbody></table>
        </div>
        <div class="a4-right">
          <div class="a4-seg"><div class="tab">SEG-Zulagen:</div>
            <div class="sg"><span>Tätigkeit:</span><span class="dots">${ink(esc(seg.map((s) => s.t).join(', ')))}</span></div>
            <div class="sg"><span>Stunden:</span><span class="dots">${ink(seg.map((s) => F.menge(s.std)).join(' / '))}</span></div></div>
          <table class="a4-ger"><colgroup><col style="width:33%"><col style="width:9%"><col style="width:8%"><col style="width:33%"><col style="width:9%"><col style="width:8%"></colgroup><thead><tr><th class="lab" colspan="6">GERÄTE:</th></tr></thead><tbody>${GL.map((id, i) => `<tr>${g(id)}${g(GR[i])}</tr>`).join('')}</tbody></table>
        </div>
      </div>
      <div class="a4-block"><div class="tabrow"><div class="tab w">ARBEITSLEISTUNG:</div></div>${ruled(arbeit, 7)}</div>
      <div class="a4-block mb"><div class="tabrow three"><div class="tab">MATERIALBEISTELLUNG:</div><div class="tab lt c">Eigenmaterial</div><div class="tab lt">Fremdmaterial</div><div></div></div>
        <div class="a4-2col"><div>${ruled(eigen, 5)}</div><div>${ruled(rep.fremdmat || [], 5)}</div></div></div>
      <div class="a4-block pal"><div class="tabrow"><div class="tab w">PALETTEN RETOUR:</div></div>
        <div class="a4-pal"><div class="tab lt">Euro:</div><div class="v">${ink(rep.paletten.euro ? rep.paletten.euro + ' Stk.' : '')}</div><div class="tab lt">Weissenböck:</div><div class="v">${ink(rep.paletten.weiss ? rep.paletten.weiss + ' Stk.' : '')}</div></div></div>
      <div class="a4-block gap"><div class="tabrow"><div class="tab w2">REGIELEISTUNGEN:</div></div>${ruled((rep.regie || []).map((r) => r.t + ' – ' + F.menge(r.std) + ' Std.'), 3)}
        <div class="tabrow split"><div class="tab w3">BESONDERE VORKOMMNISSE:</div><div class="hint">z.B.: Anweisungen AG, Beschädigungen, Sonstiges</div></div>
        <div class="a4-vk">${ink(esc(rep.vorkommnisse || '').replace(/\n/g, '<br>'))}</div>
        <div class="a4-sigh"><span><b>AUFTRAGNEHMER</b> oder dessen Beauftragter</span><span><b>BAUHERR</b> oder dessen bevollmächtigter Vertreter</span></div>
        <div class="a4-sig"><div>${A.sigSvg(rep.sigAN)}${rep.sigAN ? `<small>${esc(polierOf(rep.kst).name)} · digital signiert</small>` : ''}</div><div>${A.sigSvg(rep.sigBH)}${rep.sigBH ? `<small>${esc(b.bauherrVertreter)} · digital signiert ${F.datum(rep.datum)}</small>` : ''}</div></div>
      </div>
    </div>`;
  }
  A.paper = paper;

  function dayCost(rep) {
    const P = S.preise; let lohn = 0, ger = 0, mat = 0;
    rep.personal.forEach((p) => { if (p.std) lohn += p.std * A.byId(P.lohn, A.ma(p.ma).lg).kosten; });
    Object.keys(rep.geraete).forEach((k) => (ger += rep.geraete[k] * A.byId(P.geraete, k).kosten));
    [rep.material, rep.zusatz].forEach((mm) => Object.keys(mm || {}).forEach((k) => (mat += mm[k] * A.byId(P.material, k).ek)));
    return { lohn, ger, mat, sum: lohn + ger + mat };
  }
  A.dayCost = dayCost;

  A.route('/berichte/:id', {
    nav: 'berichte', title: 'Bautagesbericht', sub: () => 'PDF-/Druckansicht', cls: 'print-view',
    render(p) {
      const rep = A.report(p.id); if (!rep) return `<div class="page"><div class="card pad"><h3>Bericht nicht gefunden</h3><a class="btn primary" href="#/berichte">Zur Liste</a></div></div>`;
      const b = A.site(rep.kst), c = dayCost(rep), pol = polierOf(rep.kst);
      const order = ['entwurf', 'unterschrieben', 'freigegeben', 'verrechnet'], si = order.indexOf(rep.status);
      const tl = [['Erstellt am Handy', pol.name + ' · Polier', true], ['Vom Bauherrn unterschrieben', b.bauherrVertreter, si >= 1], ['PDF an Auftraggeber gesendet', b.agMail, si >= 1], ['Vom Büro freigegeben', si >= 2 ? 'Martina Koller' : 'offen', si >= 2], ['In Abrechnung übernommen', si >= 3 ? 'Teilrechnung' : 'offen', si >= 3]];
      return `<div class="page print-page">
        <div class="print-bar">
          <a class="btn ghost" href="#${A.isOffice(S.user) ? '/berichte' : '/bericht/uebersicht'}" data-demo="pdf-zurueck">${icon('left')} ${A.isOffice(S.user) ? 'Alle Berichte' : 'Zurück'}</a>
          <div class="pb-title"><b>${esc(b.kurz)} · ${F.datum(rep.datum)}</b><small>Bautagesbericht_${rep.kst}_${rep.datum}.pdf</small></div>
          ${A.statusChip(rep.status)}
          <span class="grow"></span>
          <button class="btn ghost" data-act="pdf-demo" data-t="Druckauftrag an Bürodrucker gesendet" data-demo="pdf-drucken">${icon('printer')}<span class="hide-sm">Drucken</span></button>
          <button class="btn ghost" data-act="pdf-demo" data-t="PDF heruntergeladen" data-demo="pdf-download">${icon('download')}<span class="hide-sm">PDF</span></button>
          ${!A.can('freigabe') ? '' : rep.status === 'unterschrieben' ? `<button class="btn primary" data-act="bericht-freigeben" data-id="${rep.id}" data-demo="bericht-freigeben">${icon('check')} Freigeben</button>` : rep.status === 'freigegeben' ? `<button class="btn primary" data-act="bericht-verrechnen" data-id="${rep.id}" data-demo="bericht-verrechnen">${icon('euro')} In Abrechnung übernehmen</button>` : ''}
        </div>
        <div class="print-grid">
          <div class="paper-wrap" id="paper-wrap"><div class="paper-zoom" id="paper-zoom">${paper(rep)}</div></div>
          <aside class="print-side">
            <div class="card pad"><div class="card-h"><h3>1:1 wie die Papiervorlage</h3></div><p class="muted sm">Gleiche Felder, gleiche Reihenfolge – für Auftraggeber und Bauherr ändert sich nichts. Das PDF entsteht automatisch aus den Eingaben am Handy.</p><div class="banner info" style="margin-top:10px">${icon('shield')}<span>Das PDF enthält <b>keine internen Kosten oder Preise</b>.</span></div></div>
            <div class="card pad"><div class="card-h"><h3>Verlauf</h3></div><ul class="timeline compact">${tl.map((t) => `<li class="${t[2] ? 'tl-in' : 'tl-open'}"><i></i><div><b>${t[0]}</b><small>${esc(t[1])}</small></div></li>`).join('')}</ul></div>
            ${!A.can('preise') ? '' : `<div class="card pad"><div class="card-h"><h3>Kosten dieses Tages</h3><span class="chip st-outline xs">${icon('lock')} intern</span></div>
              <div class="mini-cost"><div><span><i class="sw c-lohn"></i>Lohn · ${F.num(A.repStd(rep), 2)} Std.</span><b>${F.eur(c.lohn)}</b></div><div><span><i class="sw c-ger"></i>Geräte</span><b>${F.eur(c.ger)}</b></div><div><span><i class="sw c-mat"></i>Material</span><b>${F.eur(c.mat)}</b></div><div class="sum"><span>Summe</span><b data-demo="tageskosten">${F.eur(c.sum)}</b></div></div>
              ${A.can('kalk') ? `<a class="btn ghost block" href="#/nachkalkulation/${rep.kst}" data-demo="pdf-zur-nachkalkulation">${icon('chart')} Nachkalkulation ${esc(b.kurz)}</a>` : ''}</div>`}
          </aside>
        </div>
      </div>`;
    },
    after() { fitPaper(); }
  });
  function fitPaper() { const w = document.getElementById('paper-wrap'), zm = document.getElementById('paper-zoom'); if (!w || !zm) return; const s = Math.min(1.25, (w.clientWidth - 2) / 794); zm.style.zoom = s; }
  window.addEventListener('resize', fitPaper);
  act['pdf-demo'] = (el) => A.toast(el.dataset.t + ' (Demo)');
  act['bericht-freigeben'] = (el) => { const r = A.report(el.dataset.id); r.status = 'freigegeben'; A.render(); A.toast('Bericht freigegeben – Stunden und Mengen sind in der Nachkalkulation'); };
  act['bericht-verrechnen'] = (el) => { const r = A.report(el.dataset.id); r.status = 'verrechnet'; A.render(); A.toast('In Abrechnung übernommen'); };
})();
