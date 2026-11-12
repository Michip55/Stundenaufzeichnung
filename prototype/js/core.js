/* Kern: Hilfsfunktionen, Demo-Uhr, Datengenerator, Zustand, Kalkulation, Router, Shell */
(function () {
  'use strict';
  const D = window.DATA;
  const A = (window.App = {});
  const qs = new URLSearchParams(location.search);

  /* ---------- Format ---------- */
  const num = (n, dec = 2) => {
    const neg = n < 0; n = Math.abs(n);
    let [i, f] = n.toFixed(dec).split('.');
    i = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '−' : '') + i + (f ? ',' + f : '');
  };
  const eur = (n, dec = 2) => (n < 0 ? '−' : '') + '€ ' + num(Math.abs(n), dec);
  const std = (n) => num(n, Math.abs(n * 2 - Math.round(n * 2)) < 1e-9 && n % 1 === 0 ? 0 : (Math.abs(n * 10 - Math.round(n * 10)) < 1e-9 ? 1 : 2));
  const menge = (n) => num(n, n % 1 === 0 ? 0 : (Math.abs(n * 10 - Math.round(n * 10)) < 1e-9 ? 1 : 2));
  const pct = (n, dec = 1) => num(n * 100, dec) + ' %';
  const hm = (min) => (min == null ? '' : String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(Math.floor(min % 60)).padStart(2, '0'));
  const hms = (sec) => { sec = Math.max(0, Math.floor(sec)); return String(Math.floor(sec / 3600)).padStart(2, '0') + ':' + String(Math.floor((sec % 3600) / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0'); };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const WT = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const WTK = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const MON = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const dt = (iso) => new Date(iso + 'T12:00:00');
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const addDays = (s, n) => { const d = dt(s); d.setDate(d.getDate() + n); return iso(d); };
  const datum = (s) => { const d = dt(s); return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear(); };
  const datumKurz = (s) => { const d = dt(s); return WTK[d.getDay()] + ', ' + String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.'; };
  const datumLang = (s) => { const d = dt(s); return WT[d.getDay()] + ', ' + d.getDate() + '. ' + MON[d.getMonth()] + ' ' + d.getFullYear(); };
  const initials = (m) => (m.vn[0] + m.nn[0]).toUpperCase();
  A.fmt = { num, eur, std, menge, pct, hm, hms, esc, datum, datumKurz, datumLang, WT, WTK, MON, dt, iso, addDays, initials };

  /* ---------- Icons (inline SVG) ---------- */
  const IC = {
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.900 1.900 6.500 5.500"/><path d="M16 4.800a3.500 3.500 0 0 1 0 6.400M18.500 14.900c1.700.800 2.700 2.500 3 5.100"/>',
    clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>',
    calendar: '<rect x="3.500" y="5" width="17" height="16" rx="2"/><path d="M3.500 10h17M8 3v4M16 3v4"/>',
    grid: '<rect x="3.500" y="3.500" width="7" height="8" rx="1.500"/><rect x="13.500" y="3.500" width="7" height="5" rx="1.500"/><rect x="13.500" y="11.500" width="7" height="9" rx="1.500"/><rect x="3.500" y="14.500" width="7" height="6" rx="1.500"/>',
    pin: '<path d="M12 21s7-6.200 7-11.500A7 7 0 0 0 5 9.500C5 14.800 12 21 12 21z"/><circle cx="12" cy="9.500" r="2.500"/>',
    tag: '<path d="M3.500 12.500V4.500h8l9 9-8 8z"/><circle cx="8" cy="9" r="1.500"/>',
    chart: '<path d="M4 20V4M4 20h16"/><rect x="7.500" y="11" width="3" height="6" rx=".5"/><rect x="12.500" y="7" width="3" height="10" rx=".5"/><rect x="17.500" y="13" width="2.500" height="4" rx=".5"/>',
    table: '<rect x="3.500" y="4.500" width="17" height="15" rx="2"/><path d="M3.500 9.500h17M3.500 14.500h17M9 9.500v10M15 9.500v10"/>',
    check: '<path d="M5 12.500l4.500 4.500L19 7.500"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    right: '<path d="M9 5l7 7-7 7"/>',
    left: '<path d="M15 5l-7 7 7 7"/>',
    down: '<path d="M5 9l7 7 7-7"/>',
    search: '<circle cx="11" cy="11" r="6.500"/><path d="M16 16l4.500 4.500"/>',
    wifi: '<path d="M2.500 9a14 14 0 0 1 19 0M5.500 12.500a9.500 9.500 0 0 1 13 0M8.500 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.500" r="1" fill="currentColor"/>',
    wifiOff: '<path d="M3 3l18 18M5.500 12.500a9.500 9.500 0 0 1 4-2.300M2.500 9a14 14 0 0 1 4.300-2.800M10.500 5.100A14 14 0 0 1 21.500 9M14.500 10.400a9.500 9.500 0 0 1 4 2.100M8.500 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.500" r="1" fill="currentColor"/>',
    pause: '<rect x="6.500" y="5" width="3.500" height="14" rx="1"/><rect x="14" y="5" width="3.500" height="14" rx="1"/>',
    play: '<path d="M7 4.500v15l12-7.500z"/>',
    swap: '<path d="M4 8h14l-3.500-3.500M20 16H6l3.500 3.500"/>',
    logout: '<path d="M10 4H5.500a1.500 1.500 0 0 0-1.500 1.500v13A1.500 1.500 0 0 0 5.500 20H10M15 8l4 4-4 4M19 12H9"/>',
    camera: '<path d="M4 8.500A1.500 1.500 0 0 1 5.500 7H8l1.500-2.500h5L16 7h2.500A1.500 1.500 0 0 1 20 8.500v9a1.500 1.500 0 0 1-1.500 1.500h-13A1.500 1.500 0 0 1 4 17.500z"/><circle cx="12" cy="13" r="3.500"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.500 11.500a6.500 6.500 0 0 0 13 0M12 18v3"/>',
    pen: '<path d="M4 20l1-4.500L16.500 4l3.500 3.500L8.500 19z"/><path d="M14 6.500l3.500 3.500"/>',
    send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
    printer: '<path d="M7 8V3.500h10V8M7 17H4.500V9.500A1.500 1.500 0 0 1 6 8h12a1.500 1.500 0 0 1 1.500 1.500V17H17"/><rect x="7" y="14" width="10" height="6.500" rx="1"/>',
    download: '<path d="M12 4v11M7.500 11l4.500 4.500 4.500-4.500M4.500 19.500h15"/>',
    alert: '<path d="M12 4l9.500 16h-19z"/><path d="M12 10v4.500M12 17.500v.01"/>',
    truck: '<path d="M2.500 6.500h11v10h-11zM13.500 10h4l3 3.500v3h-7z"/><circle cx="7" cy="17.500" r="2"/><circle cx="17" cy="17.500" r="2"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    file: '<path d="M6.500 3.500h7l4.500 4.500v12.500h-11.500z"/><path d="M13.500 3.500V8H18M9 13h6M9 16.500h6"/>',
    edit: '<path d="M4 20h4l11-11-4-4L4 16z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.500v2.500M12 19v2.500M2.500 12H5M19 12h2.500M5.300 5.300L7 7M17 17l1.700 1.700M18.700 5.300L17 7M7 17l-1.700 1.700"/>',
    cloud: '<path d="M7 18.500a4.500 4.500 0 0 1-.6-8.960A6 6 0 0 1 18 11a3.800 3.800 0 0 1-.500 7.500z"/>',
    rain: '<path d="M7 15.500a4.500 4.500 0 0 1-.6-8.960A6 6 0 0 1 18 8a3.800 3.800 0 0 1-.500 7.500zM8.500 18.500l-1 2.500M12.500 18.500l-1 2.500M16.500 18.500l-1 2.500"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.200 4-6.500 8-6.500s7.200 2.300 8 6.500"/>',
    euro: '<path d="M18 6.500A7 7 0 1 0 18 17.500M4 10.500h9M4 13.500h9"/>',
    shield: '<path d="M12 3l7.500 3v5.500c0 4.500-3 8-7.500 9.500-4.500-1.500-7.500-5-7.500-9.500V6z"/><path d="M9 12l2.200 2.200L15.200 10"/>',
    back: '<path d="M10 6l-6 6 6 6M4 12h16"/>',
    more: '<circle cx="5" cy="12" r="1.500" fill="currentColor"/><circle cx="12" cy="12" r="1.500" fill="currentColor"/><circle cx="19" cy="12" r="1.500" fill="currentColor"/>',
    filter: '<path d="M4 5.500h16l-6 7.500v5.500l-4 1.500v-7z"/>',
    sign: '<path d="M3 17c2.500-6 4.500-9.500 6-9.500 2.500 0-1.500 9 1 9 1.800 0 2.500-4 4-4 1.300 0 .7 3 2.300 3 1 0 1.900-1 4.200-1M3 20.500h18"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.500v.01"/>',
    trash: '<path d="M4.500 7h15M9.500 7V4.500h5V7M6.500 7l1 13h9l1-13"/>',
    helmet: '<path d="M3.500 17.500h17M5 17.500v-2a7 7 0 0 1 14 0v2M10 8.800V6h4v2.800"/>',
    layers: '<path d="M12 3.500l9 4.500-9 4.500-9-4.500zM3 12.500l9 4.500 9-4.500M3 16.500l9 4.500 9-4.500"/>'
  };
  const icon = (n, cls) => `<svg class="ic ${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(IC[n] || '').replace(/(\d)\.(\d)00\b/g, '$1.$2')}</svg>`;
  A.icon = icon;
  // Neutrale Produkt-Wortmarke (kein Firmenlogo): Schutzhelm auf rotem Grund
  A.mark = '<svg class="mark" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="10" fill="var(--red)"/><path d="M8 27.500h24" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M11 24v-2.500a9 9 0 0 1 18 0V24z" fill="#fff"/><rect x="17.500" y="9.500" width="5" height="7" rx="1.200" fill="#fff" stroke="var(--red)" stroke-width="1.400"/></svg>'.replace(/(\d)\.(\d)00\b/g, '$1.$2');

  /* ---------- Demo-Uhr ---------- */
  const role0 = qs.get('rolle');
  const OFFICE = ['buero', 'gf', 'bauleiter'].includes(role0);
  const szenario = qs.get('szenario') || (OFFICE ? 'tag' : 'morgen');
  A.szenario = szenario;
  const uhrDefault = szenario === 'morgen' ? '06:52' : szenario === 'tag' ? '10:24' : szenario === 'signiert' ? '16:40' : '16:05';
  const uhr = (qs.get('uhr') || uhrDefault).split(':');
  let clockBase = (+uhr[0]) * 3600 + (+uhr[1] || 0) * 60;
  let t0 = Date.now();
  const nowSec = () => clockBase + (Date.now() - t0) / 1000;
  const nowMin = () => Math.floor(nowSec() / 60);
  A.nowSec = nowSec; A.nowMin = nowMin; A.HEUTE = D.HEUTE;

  /* ---------- Lookup ---------- */
  const byId = (arr, id, key = 'id') => arr.find((x) => String(x[key]) === String(id));
  const ma = (id) => byId(D.mitarbeiter, id) || byId(D.buero, id);
  const site = (kst) => byId(D.baustellen, kst, 'kst');
  const lgName = (id) => (byId(D.lohngruppen, id) || {}).name || '';
  A.ma = ma; A.site = site; A.lgName = lgName; A.byId = byId;

  /* ---------- Generator (deterministisch) ---------- */
  function mulberry(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const FEIERTAGE = { '2026-10-26': 'Nationalfeiertag', '2026-11-01': 'Allerheiligen', '2026-12-08': 'Mariä Empfängnis' };
  const SW_TAGE = ['2026-09-23', '2026-10-14', '2026-10-29', '2026-11-03'];
  const isWork = (s) => { const d = dt(s).getDay(); return d >= 1 && d <= 5 && !FEIERTAGE[s]; };
  const sollTag = (s) => (isWork(s) ? (dt(s).getDay() === 5 ? 5 : 8.5) : 0);
  A.FEIERTAGE = FEIERTAGE; A.isWork = isWork; A.sollTag = sollTag;

  const TS = {}; // TS[maId][iso]
  function genTimesheets() {
    const special = {
      '10|2026-10-21': { v1: 360, b1: 720, v2: 750, b2: 1050, warn: 'azg10' },
      '14|2026-10-08': { v1: 420, b1: 930, v2: null, b2: null, pause: 0, warn: 'pause' },
      '21|2026-10-28': { v1: 420, b1: 720, v2: 750, b2: 960, warn: 'offen' },
      '4|2026-10-15': { v1: 390, b1: 720, v2: 750, b2: 1050, warn: 'azg10' },
      '12|2026-11-11': { v1: 360, b1: 720, v2: 750, b2: 1050, warn: 'azg10' },
      '27|2026-11-11': { v1: 420, b1: 720, v2: 750, b2: 960, warn: 'offen' },
      '17|2026-11-10': { v1: 420, b1: 930, v2: null, b2: null, pause: 0, warn: 'pause' }
    };
    D.mitarbeiter.forEach((m) => {
      const r = mulberry(hash('ts' + m.id));
      const out = (TS[m.id] = {});
      let block = null;
      for (let s = '2026-09-01'; s <= '2026-11-11'; s = addDays(s, 1)) {
        if (!isWork(s)) continue;
        const wd = dt(s).getDay();
        const rec = { d: s, ma: m.id, kst: m.kst, v1: null, b1: null, v2: null, b2: null, pause: 0, std: 0, code: '', sw: 0, seg: 0, warn: '' };
        if (!block) { const x = r(); if (x < 0.012) block = { c: 'K', n: 2 + Math.floor(r() * 3) }; else if (x < 0.024) block = { c: 'U', n: 3 + Math.floor(r() * 3) }; }
        const sp = special[m.id + '|' + s];
        if (sp) { Object.assign(rec, { pause: 30 }, sp); }
        else if (block) { rec.code = block.c; block.n--; if (block.n <= 0) block = null; out[s] = rec; continue; }
        else if (SW_TAGE.includes(s) && m.lg !== 'lkw' && m.kst !== '90-001') { rec.v1 = 420; rec.b1 = 660; rec.code = 'SW'; rec.sw = 4.5; }
        else if (wd === 5) { rec.v1 = m.lg === 'lkw' ? 390 : 420; rec.b1 = rec.v1 + (r() < 0.2 ? 360 : 300); }
        else {
          rec.v1 = m.lg === 'lkw' || m.lg === 'ma' ? (r() < 0.5 ? 390 : 420) : 420; rec.b1 = 720; rec.v2 = 750; rec.pause = 30;
          const x = r(); rec.b2 = rec.v1 + 9 * 60 + (x < 0.04 ? 60 : x < 0.16 ? 30 : 0);
        }
        rec.std = ((rec.b1 - rec.v1) + (rec.v2 != null ? rec.b2 - rec.v2 : 0)) / 60;
        if (!rec.code && ['fa', 'hi', 'le'].includes(m.lg) && r() < 0.18) rec.seg = 2 + Math.floor(r() * 3);
        out[s] = rec;
      }
    });
  }

  function demoSignatur(seedStr) {
    const r = mulberry(hash('sig' + seedStr));
    const a = 6 + r() * 5, b = 9 + r() * 6, ph = r() * 6, pts = [];
    for (let i = 0; i <= 70; i++) { const t = i / 70; pts.push([0.1 + t * 0.78 + 0.045 * Math.sin(a * 2.3 * t + ph), 0.52 + (0.3 - 0.16 * t) * Math.sin(b * t + ph) * Math.cos(a * 0.6 * t)]); }
    const u = [[0.14, 0.82], [0.4, 0.78], [0.86, 0.8]];
    return [pts, u];
  }
  A.demoSignatur = demoSignatur;

  const REPORTS = [];
  function personalRows(kst, s) {
    return D.mitarbeiter.filter((m) => m.kst === kst).map((m) => { const t = TS[m.id][s]; return t ? { ma: m.id, v1: t.v1, b1: t.b1, v2: t.v2, b2: t.b2, pause: t.pause, std: t.std, code: t.code, seg: t.seg } : null; }).filter(Boolean);
  }
  function genReports() {
    D.baustellen.filter((b) => !b.intern).forEach((b) => {
      const end = b.ende < '2026-11-11' ? b.ende : '2026-11-11';
      for (let s = b.start; s <= end; s = addDays(s, 1)) {
        if (!isWork(s)) continue;
        const r = mulberry(hash(b.kst + s));
        const personal = personalRows(b.kst, s);
        if (!personal.some((p) => p.std > 0)) continue;
        const sw = SW_TAGE.includes(s), fr = dt(s).getDay() === 5, f = sw ? 0.45 : fr ? 0.6 : 1;
        const pick = (prof, round) => { const o = {}; Object.keys(prof).forEach((k) => { const [q, p] = prof[k]; if (r() < p) { const v = q * f * (0.8 + r() * 0.4); o[k] = Math.max(round, Math.round(v / round) * round); } }); return o; };
        const geraete = pick(b.geraete, 0.5), material = pick(b.material, 1), zusatz = pick(b.zusatz, 0.5);
        const segSum = personal.reduce((a, p) => a + (p.seg || 0), 0);
        const status = s <= '2026-10-30' ? 'verrechnet' : s <= '2026-11-09' ? 'freigegeben' : 'unterschrieben';
        const t1 = b.texte[Math.floor(r() * b.texte.length)], t2 = b.texte[Math.floor(r() * b.texte.length)];
        const rep = {
          id: b.kst + '_' + s, kst: b.kst, datum: s, status, personal,
          seg: segSum ? [{ t: geraete.schneid ? 'Staubzulage (Schneidarbeiten)' : 'Schmutzzulage', std: segSum }] : [],
          geraete, material, einheit: {}, zusatz,
          arbeit: sw ? 'Arbeiten wegen Starkregen um 11:00 eingestellt (Schlechtwetter). ' + t1 : t1 === t2 ? t1 : t1 + '\n' + t2,
          fotos: r() < 0.6 ? ['pflaster', 'frostschutz', 'kuenette'].slice(0, 1 + Math.floor(r() * 3)) : [],
          eigen: [], fremdmat: r() < 0.15 ? ['Schachtabdeckung Kl. D 400 – beigestellt vom AG'] : [],
          paletten: { euro: zusatz.pflaster8 && r() < 0.5 ? Math.floor(2 + r() * 6) : 0, weiss: zusatz.pflaster8 && r() < 0.6 ? Math.floor(2 + r() * 8) : 0 },
          regie: r() < 0.14 ? [{ t: 'Zusatzarbeit laut Anweisung Bauleitung (Regie)', std: 1 + Math.floor(r() * 3) }] : [],
          vorkommnisse: sw ? 'Schlechtwetter ab 11:00 Uhr, Baustelle gesichert.' : r() < 0.08 ? 'Anweisung AG: Einfahrt bis 15:00 Uhr freihalten.' : '',
          wetter: sw ? 'Regen' : ['sonnig', 'bewölkt', 'bewölkt', 'sonnig'][Math.floor(r() * 4)], temp: Math.round(4 + r() * 10),
          sigAN: demoSignatur('an' + b.kst), sigBH: demoSignatur('bh' + b.kst), w: 0.6 + r() * 0.8
        };
        // ein paar Berichte bewusst noch offen
        if (s === '2026-11-11' && (b.kst === '26-047' || b.kst === '26-029')) { rep.status = 'entwurf'; rep.sigBH = null; rep.sigAN = null; }
        REPORTS.push(rep);
      }
    });
  }

  /* ---------- Zustand ---------- */
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const S = (A.state = {});
  let BASE = null;

  function seedStamps() {
    S.stamps = {};
    const crew041 = D.mitarbeiter.filter((m) => m.kst === '26-041').map((m) => m.id);
    D.mitarbeiter.forEach((m) => {
      const r = mulberry(hash('st' + m.id));
      const st = { status: 'aus', kst: m.kst, segs: [], pausen: [], ort: null, code: D.heuteAbwesend[m.id] || '' };
      const open = D.heuteOffen.includes(m.id) || st.code;
      const demoCrew = crew041.includes(m.id);
      if (!open) {
        if (demoCrew && szenario === 'morgen') { /* noch nicht eingestempelt */ }
        else if (demoCrew) {
          st.segs = [{ kst: m.kst, von: 7 * 3600, bis: null }]; st.pausen = nowSec() > 12.5 * 3600 ? [{ von: 12 * 3600, bis: 12.5 * 3600 }] : []; st.status = 'ein';
          if (nowSec() >= 16 * 3600) { st.segs[0].bis = 16 * 3600; st.status = 'fertig'; }
          st.ort = true;
        } else {
          const von = (6 * 60 + 25 + Math.floor(r() * 5) * 5) * 60 + Math.floor(r() * 50);
          st.segs = [{ kst: m.kst, von, bis: null }]; st.status = 'ein'; st.ort = true;
          if (nowSec() > 12.6 * 3600) st.pausen = [{ von: 12 * 3600, bis: 12.5 * 3600 }];
        }
      }
      S.stamps[m.id] = st;
    });
  }

  function leererBericht(kst) {
    return { id: kst + '_' + D.HEUTE, kst, datum: D.HEUTE, status: 'entwurf', personal: [], manuell: {}, seg: [], geraete: {}, material: {}, einheit: {}, zusatz: {}, arbeit: '', fotos: [], eigen: [], fremdmat: [], paletten: { euro: 0, weiss: 0 }, regie: [], vorkommnisse: '', vkKat: '', wetter: 'bewölkt', temp: 7, sigAN: null, sigBH: null, w: 1, heute: true };
  }
  function seedHeute() {
    const rep = leererBericht('26-041');
    if (szenario !== 'morgen') {
      Object.assign(rep, {
        geraete: { b9: 8, lkw3: 4, ruettel: 6 }, material: { frostschutz: 42, splitt: 6 },
        zusatz: { pflaster8: 38, randstein: 24 },
        arbeit: 'Frostschutz 0/63 eingebracht und verdichtet, Parkplatz Reihe C.\nRandleisten in Beton versetzt, 24 lfm.\nBetonsteinpflaster 8 cm verlegt Gehweg Stiege 2, ca. 38 m². Fugen eingekehrt und abgerüttelt.',
        fotos: ['frostschutz', 'pflaster'], eigen: [], fremdmat: ['Schachtabdeckung Kl. D 400 – beigestellt vom AG'],
        paletten: { euro: 4, weiss: 6 }, regie: [{ t: 'Zufahrt Müllplatz provisorisch geschottert (Anweisung Bauleitung)', std: 2 }],
        vorkommnisse: 'Anweisung AG (Ing. Auer): Zufahrt Stiege 1 bis Freitag 12:00 Uhr befahrbar halten.', vkKat: 'Anweisung AG',
        seg: [{ t: 'Staubzulage (Schneidarbeiten)', std: 3 }]
      });
      if (szenario === 'signiert') { rep.sigAN = demoSignatur('an26-041'); rep.sigBH = demoSignatur('bh26-041x'); rep.status = 'unterschrieben'; rep.gesendet = '16:12'; }
    }
    return rep;
  }

  function reset() {
    t0 = Date.now();
    S.preise = clone({ lohn: D.lohngruppen, geraete: D.geraete, material: D.material, leistung: D.leistungen, paletten: D.paletten });
    S.aenderungen = [];
    S.reports = clone(REPORTS);
    seedStamps();
    S.reports.push(seedHeute());
    S.sync = 'online'; S.pending = 0;
    S.user = null; S.loginPick = null; S.pin = '';
    S.ui = { wocheKW: 46, monat: '2026-10', berichtFilter: 'alle', berichtKst: 'alle', geraetSuche: '', preisTab: 'lohn', kolonne: null, kalkTab: 'geraete', loginSuche: '' };
    S.perm = clone(PERM_DEFAULT); S.ausnahmen = { 13: { freigabe: true } }; S.preview = null; S.lang = qs.get('sprache') || 'de'; S.bm = qs.get('modus') === 'baustelle';
    S.audit = [
      { t: '10.11.2026 08:14', wer: 'Michael Pichler', was: 'Ausnahme: Vorarbeiter Thomas Riegler darf „Bautagesbericht freigeben“' },
      { t: '03.11.2026 16:40', wer: 'Michael Pichler', was: 'Rolle Bauleiter: „Nachkalkulation sehen“ deaktiviert' },
      { t: '02.11.2026 07:55', wer: 'Martina Koller', was: 'Benutzer Ivan Horvat angelegt (Rolle Mitarbeiter)' }
    ];
    S.user = roleUser(qs.get('rolle'));
  }

  /* ---------- Stempel-Logik ---------- */
  const stamp = (id) => S.stamps[id];
  function workedSec(id, upto) {
    const st = stamp(id); if (!st) return 0; const now = upto == null ? nowSec() : upto;
    let s = 0; st.segs.forEach((g) => { s += Math.max(0, (g.bis == null ? now : g.bis) - g.von); });
    st.pausen.forEach((p) => { s -= Math.max(0, (p.bis == null ? now : p.bis) - p.von); });
    return Math.max(0, s);
  }
  function pauseSec(id) { const st = stamp(id), now = nowSec(); return st.pausen.reduce((a, p) => a + Math.max(0, (p.bis == null ? now : p.bis) - p.von), 0); }
  function clockIn(id, kst) { const st = stamp(id); if (st.status !== 'aus' && st.status !== 'fertig') return; st.segs.push({ kst, von: nowSec(), bis: null }); st.status = 'ein'; st.kst = kst; st.ort = true; st.code = ''; queueSync(); }
  function clockOut(id) { const st = stamp(id); const now = nowSec(); st.pausen.forEach((p) => { if (p.bis == null) p.bis = now; }); st.segs.forEach((g) => { if (g.bis == null) g.bis = now; }); st.status = 'fertig'; queueSync(); }
  function togglePause(id) { const st = stamp(id); const now = nowSec(); if (st.status === 'ein') { st.pausen.push({ von: now, bis: null }); st.status = 'pause'; } else if (st.status === 'pause') { st.pausen[st.pausen.length - 1].bis = now; st.status = 'ein'; } queueSync(); }
  function switchSite(id, kst) { const st = stamp(id); const now = nowSec(); const cur = st.segs[st.segs.length - 1]; if (cur && cur.bis == null) cur.bis = now; st.segs.push({ kst, von: now, bis: null }); st.kst = kst; queueSync(); }
  function queueSync() { if (S.sync === 'offline') S.pending++; }
  Object.assign(A, { stamp, workedSec, pauseSec, clockIn, clockOut, togglePause, switchSite });

  /* Personal-Zeilen des heutigen Berichts aus den Stempelungen ableiten */
  function syncPersonal(rep) {
    if (!rep.heute) return rep;
    const crew = D.mitarbeiter.filter((m) => { const st = stamp(m.id); return m.kst === rep.kst || st.segs.some((g) => g.kst === rep.kst); });
    rep.personal = crew.map((m) => {
      if (rep.manuell[m.id]) return rep.manuell[m.id];
      const st = stamp(m.id);
      const row = { ma: m.id, v1: null, b1: null, v2: null, b2: null, pause: 0, std: 0, code: st.code || '', laeuft: false };
      if (st.segs.length) {
        const first = st.segs[0], last = st.segs[st.segs.length - 1], p = st.pausen[0];
        const end = last.bis == null ? null : last.bis;
        row.v1 = Math.floor(first.von / 60);
        if (p && p.bis != null) { row.b1 = Math.floor(p.von / 60); row.v2 = Math.floor(p.bis / 60); row.b2 = end == null ? null : Math.floor(end / 60); }
        else row.b1 = end == null ? null : Math.floor(end / 60);
        row.pause = Math.round(pauseSec(m.id) / 60);
        row.laeuft = end == null;
        row.std = Math.round((workedSec(m.id) / 3600) * 4) / 4;
      }
      return row;
    });
    return rep;
  }
  const heuteBericht = () => syncPersonal(S.reports.find((r) => r.heute));
  const report = (id) => { const r = S.reports.find((x) => x.id === id); return r && r.heute ? syncPersonal(r) : r; };
  const repStd = (rep) => (rep.heute ? syncPersonal(rep) : rep).personal.reduce((a, p) => a + (p.std || 0), 0);
  Object.assign(A, { heuteBericht, report, repStd, syncPersonal });

  /* ---------- Nachkalkulation ---------- */
  function calc(kst, preise, opts) {
    preise = preise || S.preise; opts = opts || {};
    const b = site(kst);
    const P = { lohn: {}, geraete: {}, material: {}, leistung: {} };
    preise.lohn.forEach((x) => (P.lohn[x.id] = x)); preise.geraete.forEach((x) => (P.geraete[x.id] = x)); preise.material.forEach((x) => (P.material[x.id] = x)); preise.leistung.forEach((x) => (P.leistung[x.id] = x));
    const res = { lohn: 0, geraete: 0, material: 0, fremd: 0, stunden: 0, lg: {}, ger: {}, mat: {}, tage: [], nBerichte: 0 };
    const tag = {};
    S.reports.filter((r) => r.kst === kst && !(opts.ohneHeute && r.heute)).forEach((r) => {
      let k = 0;
      r.personal.forEach((p) => { if (!p.std) return; const m = ma(p.ma), c = p.std * P.lohn[m.lg].kosten; res.lohn += c; res.stunden += p.std; k += c; const o = (res.lg[m.lg] = res.lg[m.lg] || { menge: 0, kosten: 0 }); o.menge += p.std; o.kosten += c; });
      Object.keys(r.geraete).forEach((g) => { const c = r.geraete[g] * P.geraete[g].kosten; res.geraete += c; k += c; const o = (res.ger[g] = res.ger[g] || { menge: 0, kosten: 0 }); o.menge += r.geraete[g]; o.kosten += c; });
      [r.material, r.zusatz].forEach((mm) => Object.keys(mm || {}).forEach((g) => { const c = mm[g] * P.material[g].ek; res.material += c; k += c; const o = (res.mat[g] = res.mat[g] || { menge: 0, kosten: 0 }); o.menge += mm[g]; o.kosten += c; }));
      if (k > 0) { res.nBerichte++; tag[r.datum] = { d: r.datum, kosten: (tag[r.datum] ? tag[r.datum].kosten : 0) + k, w: r.w || 1 }; }
    });
    b.fremd.forEach((f) => { res.fremd += f.betrag; if (tag[f.d]) tag[f.d].kosten += f.betrag; else tag[f.d] = { d: f.d, kosten: f.betrag, w: 0.2 }; });
    res.kosten = res.lohn + res.geraete + res.material + res.fremd;
    res.pos = Object.keys(b.posIst || {}).map((id) => ({ id, pos: P.leistung[id], ist: b.posIst[id], lv: b.posLV[id], erloes: b.posIst[id] * P.leistung[id].ep, auftrag: b.posLV[id] * P.leistung[id].ep }));
    res.erloes = res.pos.reduce((a, p) => a + p.erloes, 0);
    res.auftrag = res.pos.reduce((a, p) => a + p.auftrag, 0);
    res.db = res.erloes - res.kosten; res.dbPct = res.erloes ? res.db / res.erloes : 0;
    const days = Object.values(tag).sort((x, y) => (x.d < y.d ? -1 : 1)); const wsum = days.reduce((a, d) => a + d.w, 0) || 1;
    let ck = 0, ce = 0; res.tage = days.map((d) => { ck += d.kosten; ce += (res.erloes * d.w) / wsum; return { d: d.d, kosten: d.kosten, kumK: ck, kumE: ce }; });
    res.ampel = res.dbPct >= 0.15 ? 'gruen' : res.dbPct >= 0.07 ? 'gelb' : 'rot';
    res.soll = b.sollWerte || { lohn: 0, geraete: 0, material: 0, fremd: 0 };
    res.sollKosten = res.soll.lohn + res.soll.geraete + res.soll.material + res.soll.fremd;
    return res;
  }
  function freezeKalkulation() {
    BASE = clone({ lohn: D.lohngruppen, geraete: D.geraete, material: D.material, leistung: D.leistungen });
    D.baustellen.filter((b) => !b.intern).forEach((b) => {
      b.posIst = {}; b.posLV = {};
      const c = calc(b.kst, BASE, { ohneHeute: true });
      const ziel = c.kosten / (1 - b.zielDB);
      Object.keys(b.pos).forEach((id) => { const p = byId(D.leistungen, id); const q = (ziel * b.pos[id]) / p.ep; b.posIst[id] = p.einheit === 'PA' ? Math.min(1, Math.round(q * 20) / 20) : Math.round(q); b.posLV[id] = p.einheit === 'PA' ? 1 : Math.round(b.posIst[id] / b.fertig / 5) * 5; });
      b.sollWerte = { lohn: c.lohn * b.soll.lohn, geraete: c.geraete * b.soll.geraete, material: c.material * b.soll.material, fremd: c.fremd * b.soll.fremd };
    });
  }
  A.calc = calc; A.calcBase = (kst) => calc(kst, BASE); A.basePreise = () => BASE;
  A.preiseGeaendert = () => S.aenderungen.length > 0;

  /* ---------- Sheets / Toast ---------- */
  function sheet(html, opts) {
    const root = document.getElementById('sheet-root');
    root.innerHTML = `<div class="sheet-backdrop" data-act="sheet-close"></div><div class="sheet ${(opts && opts.cls) || ''}" role="dialog">${html}</div>`;
    requestAnimationFrame(() => root.classList.add('open'));
  }
  function closeSheet() { const root = document.getElementById('sheet-root'); root.classList.remove('open'); setTimeout(() => { if (!root.classList.contains('open')) root.innerHTML = ''; }, 220); }
  function toast(msg, kind) {
    const root = document.getElementById('toast-root'); const el = document.createElement('div');
    el.className = 'toast ' + (kind || ''); el.setAttribute('data-demo', 'toast'); el.innerHTML = icon(kind === 'warn' ? 'alert' : 'check') + '<span>' + msg + '</span>';
    root.appendChild(el); requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, 3200);
  }
  Object.assign(A, { sheet, closeSheet, toast });

  /* ---------- Router & Shell ---------- */
  const routes = [];
  A.route = (pattern, def) => routes.push(Object.assign({ pattern, parts: pattern.split('/') }, def));
  const actions = (A.actions = {}), inputs = (A.inputs = {}), tickers = (A.tickers = {});
  let current = null;

  /* ---------- Rollen & Berechtigungen ---------- */
  const ROLLEN = [['mitarbeiter', 'Mitarbeiter'], ['polier', 'Polier / Vorarbeiter'], ['bauleiter', 'Bauleiter'], ['buero', 'Büro / Lohnverrechnung'], ['gf', 'Geschäftsführung']];
  const RECHTE = [
    ['zeit', 'Zeiterfassung (eigene Zeiten, Woche, Abwesenheit)', 'Baustelle'], ['kolonne', 'Kolonne stempeln', 'Baustelle'], ['bericht', 'Bautagesbericht erstellen & senden', 'Baustelle'],
    ['freigabe', 'Bautagesbericht freigeben', 'Büro'], ['preise', 'Preise sehen (€-Werte, Tageskosten)', 'Büro'], ['preise_edit', 'Preise bearbeiten', 'Büro'], ['lohnsaetze', 'Lohnsätze sehen', 'Büro'], ['kalk', 'Nachkalkulation sehen', 'Büro'], ['lohn', 'Lohnauswertung & Export', 'Büro'],
    ['benutzer', 'Benutzer & Berechtigungen verwalten', 'Verwaltung']
  ];
  const PERM_DEFAULT = {
    mitarbeiter: { zeit: true }, polier: { zeit: true, kolonne: true, bericht: true },
    bauleiter: { bericht: true, freigabe: true },
    buero: { freigabe: true, preise: true, preise_edit: true, lohnsaetze: true, kalk: true, lohn: true },
    gf: { zeit: true, kolonne: true, bericht: true, freigabe: true, preise: true, preise_edit: true, lohnsaetze: true, kalk: true, lohn: true, benutzer: true }
  };
  const FELD = ['mitarbeiter', 'polier'], isOffice = (u) => !!u && !FELD.includes(u.rolle);
  const roleUser = (r) => ({ mitarbeiter: ma(2), polier: ma(1), bauleiter: ma(103), buero: ma(101), gf: ma(102) }[r] || null);
  const GESPERRT = ['preise', 'preise_edit', 'lohnsaetze', 'kalk', 'lohn', 'benutzer'];
  A.gesperrt = (rolle, key) => FELD.includes(rolle) && GESPERRT.includes(key);
  const can = (key, u) => { u = u || S.user; if (!u) return false; if (A.gesperrt(u.rolle, key)) return false; return !!((S.perm[u.rolle] || {})[key] || (S.ausnahmen[u.id] || {})[key]); };
  Object.assign(A, { ROLLEN, RECHTE, PERM_DEFAULT, can, isOffice, roleUser, rolleName: (r) => (ROLLEN.find((x) => x[0] === r) || [])[1] });
  const NAVALL = [
    ['stempeluhr', 'Stempeluhr', 'clock', null, (u) => !isOffice(u)], ['kolonne', 'Kolonne', 'users', null, (u) => !isOffice(u) && can('kolonne')], ['bericht', 'Bautagesbericht', 'clipboard', 'Bericht', (u) => !isOffice(u) && can('bericht')], ['woche', 'Meine Woche', 'calendar', 'Woche', (u) => !isOffice(u)], ['profil', 'Profil', 'user', null, (u) => u.rolle === 'mitarbeiter'],
    ['dashboard', 'Dashboard', 'grid', 'Heute', isOffice], ['baustellen', 'Baustellen', 'pin', null, isOffice], ['berichte', 'Bautagesberichte', 'clipboard', 'Berichte', isOffice],
    ['preise', 'Preise & Stammdaten', 'tag', 'Preise', () => can('preise')], ['nachkalkulation', 'Nachkalkulation', 'chart', 'Kalkulation', () => can('kalk')], ['monat', 'Monatsauswertung', 'table', 'Monat', () => can('lohn')], ['benutzer', 'Benutzer & Rechte', 'shield', 'Rechte', () => can('benutzer')]
  ];
  const NAV = {};
  const navFor = (u) => NAVALL.filter((it) => it[4](u));
  const home = () => (S.user ? (isOffice(S.user) ? '/dashboard' : '/stempeluhr') : '/login');

  function match(path) {
    const seg = path.split('/').filter(Boolean);
    for (const r of routes) {
      const p = r.parts.filter(Boolean); if (p.length < seg.length) continue;
      const params = {}; let ok = true;
      for (let i = 0; i < p.length; i++) {
        if (p[i][0] === ':') { const opt = p[i].endsWith('?'); if (seg[i] == null && !opt) { ok = false; break; } params[p[i].replace(/[:?]/g, '')] = seg[i] == null ? null : decodeURIComponent(seg[i]); }
        else if (p[i] !== seg[i]) { ok = false; break; }
      }
      if (ok) return { r, params };
    }
    return null;
  }

  function go(route) { if (route[0] !== '/') route = '/' + route.replace(/^#\/?/, ''); if (location.hash === '#' + route) render(); else location.hash = route; }
  A.go = go;

  function shell(m) {
    const u = S.user, items = navFor(u), tr = A.t || ((k, d) => d);
    const key = m.r.nav;
    const navItems = (short) => items.filter((it) => !(short && isOffice(u) && ['baustellen', 'benutzer'].includes(it[0]))).slice(0, short ? 5 : 99).map((it) => `<a class="nav-item ${key === it[0] ? 'active' : ''}" href="#/${it[0]}" data-demo="nav-${it[0]}">${icon(it[2])}<span class="lbl-long">${tr('nav_' + it[0], it[1])}</span><span class="lbl-short">${tr('nav_' + it[0], it[3] || it[1])}</span></a>`).join('');
    const rolle = isOffice(u) ? u.funktion : lgName(u.lg);
    return `
    <div class="app role-${u.rolle} ${S.preview ? 'has-preview' : ''}">${S.preview ? `<div class="preview-bar" data-demo="vorschau-leiste">${icon('user')}<span>Vorschau: Ansicht als <b>${A.rolleName(u.rolle)}</b> (${esc(u.name)})</span><button class="btn sm" data-act="vorschau-ende" data-demo="vorschau-beenden">${icon('x')} Vorschau beenden</button></div>` : ''}
      <aside class="sidenav">
        <a class="brand" href="#${home()}">${A.mark}<span class="brand-txt"><b>BauTag</b><small>Michael Pichler Ges.m.b.H.</small></span></a>
        <nav class="nav-list">${navItems(false)}</nav>
        <div class="nav-foot">
          <a class="nav-user" href="#/profil" data-demo="nav-profil"><span class="avatar">${initials(u)}</span><span class="nav-user-txt"><b>${esc(u.name)}</b><small>${esc(rolle)}</small></span></a>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <a class="top-logo" href="#${home()}">${A.mark}</a>
          <div class="top-title"><h1 id="page-title">${tr('title_' + (m.r.nav || ''), m.r.title || '')}</h1><div class="top-sub" id="page-sub">${m.r.sub ? m.r.sub(m.params) : ''}</div></div>
          ${A.topExtra ? A.topExtra(u) : ''}<div class="top-right">
            <button class="sync-chip ${S.sync}" data-act="sync-toggle" data-demo="sync-chip" title="Verbindung (Demo: antippen zum Umschalten)">${syncChipInner()}</button>
            <div class="top-clock"><b data-tick="clock">${hm(nowMin())}</b><small>${datumKurz(D.HEUTE)}${dt(D.HEUTE).getFullYear()}</small></div>
            <a class="avatar top-avatar" href="#/profil" title="${esc(u.name)}">${initials(u)}</a>
          </div>
        </header>
        <main class="view" id="view"></main>
      </div>
      <nav class="tabbar">${navItems(true)}</nav>
    </div>`;
  }
  const syncChipInner = () => (S.sync === 'online' ? icon('wifi') + '<span>Synchronisiert</span>' : icon('wifiOff') + `<span>Offline${S.pending ? ' · ' + S.pending + ' wartet' : ''}</span>`);
  actions['sync-toggle'] = () => {
    if (S.sync === 'online') { S.sync = 'offline'; toast('Offline-Modus: Buchungen werden am Gerät gespeichert', 'warn'); }
    else { const n = S.pending; S.sync = 'online'; S.pending = 0; toast(n ? n + ' Buchung' + (n > 1 ? 'en' : '') + ' nachträglich synchronisiert' : 'Wieder online – alles synchronisiert'); }
    render();
  };

  function render() {
    const root = document.getElementById('root');
    let path = location.hash.replace(/^#/, '') || '';
    if (!S.user && !path.startsWith('/login')) { S.wunsch = path; path = '/login'; history.replaceState(null, '', location.pathname + location.search + '#/login'); }
    if (!path || path === '/') { path = home(); history.replaceState(null, '', location.pathname + location.search + '#' + path); }
    let m = match(path);
    if (!m) { path = home(); m = match(path); }
    const same = current && current.r === m.r && JSON.stringify(current.params) === JSON.stringify(m.params) && current.user === S.user;
    const oldView = document.getElementById('view'); const scroll = same && oldView ? oldView.scrollTop : 0;
    const winScroll = same ? window.scrollY : 0;
    current = { r: m.r, params: m.params, user: S.user };
    if (m.r.bare) { root.innerHTML = m.r.render(m.params); }
    else {
      root.innerHTML = shell(m);
      const ok = !m.r.perm || m.r.perm(S.user);
      const v = document.getElementById('view'); v.className = 'view ' + (ok ? m.r.cls || '' : '');
      v.innerHTML = ok ? m.r.render(m.params) : `<div class="page narrow"><div class="card pad noaccess" data-demo="kein-zugriff"><span class="na-ic">${icon('shield')}</span><h2>Kein Zugriff</h2><p>Diese Ansicht ist nur für ${m.r.permText || 'Bauleitung und Geschäftsführung'} freigegeben.</p><p class="muted sm">Angemeldet als ${esc(S.user.name)} · Rolle ${A.rolleName(S.user.rolle)}. Preise, €-Werte und Nachkalkulation sind für diese Rolle ausgeblendet.</p><a class="btn primary" href="#${home()}" data-demo="kein-zugriff-zurueck">${icon('left')} Zurück zur Startseite</a></div></div>`;
      if (!ok) m = { r: Object.assign({}, m.r, { after: null }), params: m.params };
      v.scrollTop = scroll;
    }
    document.body.dataset.route = m.r.pattern; document.body.dataset.rolle = S.user ? S.user.rolle : ''; document.body.classList.toggle('bm', !!S.bm);
    if (winScroll) window.scrollTo(0, winScroll);
    if (m.r.after) m.r.after(m.params);
    tick();
  }
  A.render = render; A.refresh = render;
  A.setTitle = (t, sub) => { const a = document.getElementById('page-title'); if (a) a.textContent = t; const b = document.getElementById('page-sub'); if (b && sub != null) b.innerHTML = sub; };

  function tick() { document.querySelectorAll('[data-tick]').forEach((el) => { const f = tickers[el.dataset.tick]; if (f) { const v = f(el); if (v != null && el.textContent !== v) el.textContent = v; } }); }
  tickers.clock = () => hm(nowMin());
  tickers.clocksec = () => hms(nowSec());

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]'); if (!el || el.disabled) return;
    const f = actions[el.dataset.act]; if (f) { if (el.tagName === 'A' || el.tagName === 'BUTTON') ev.preventDefault(); f(el, ev); }
  });
  ['input', 'change'].forEach((t) => document.addEventListener(t, (ev) => { const el = ev.target.closest('[data-input]'); if (!el) return; const f = inputs[el.dataset.input]; if (f) f(el, ev); }));
  actions['sheet-close'] = () => closeSheet();
  actions.go = (el) => go(el.dataset.to);
  actions['vorschau-ende'] = () => { if (S.preview) { S.user = S.preview.real; S.preview = null; go('/benutzer'); render(); toast('Vorschau beendet'); } };
  actions.logout = () => { S.preview = null; S.user = null; S.loginPick = null; S.pin = ''; go('/login'); };

  A.start = function () {
    genTimesheets(); genReports(); S.reports = clone(REPORTS); freezeKalkulation(); reset();
    window.addEventListener('hashchange', () => { closeSheet(); render(); });
    render(); setInterval(tick, 250);
    window.demo = {
      reset() { reset(); closeSheet(); go(home()); render(); },
      go(route) { go(route); },
      login(rolle) { S.preview = null; S.user = roleUser(rolle) || ma(2); go(home()); render(); },
      setClock(hhmm) { const p = hhmm.split(':'); clockBase = +p[0] * 3600 + +p[1] * 60; t0 = Date.now(); render(); },
      state: S
    };
  };
  A.TS = TS; A.home = home; A.NAV = NAV;
})();
