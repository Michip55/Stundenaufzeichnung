'use strict';
/**
 * Hilfen für die vollständige Rechte-Prüfung (Prüfbericht 7):
 * - Routen-Liste direkt aus dem Express-Router (keine Handliste)
 * - Basis-Datenbank mit Demo-Seed + gezielt angelegten Objekten („Kanarienvögel“) je Baustelle
 * - Scanner: verbotene Schlüssel, €-Beträge und Kanarien-Werte in JSON/CSV/PDF/XLSX/Text
 * - DB-Fingerabdruck für Schreibproben (Datenbank unverändert nach Ablehnung)
 *
 * Kanarienvögel: auffällige, eindeutige Werte (z. B. Rechnung netto 87654.32 auf Baustelle 1), die nur
 * bestimmte Rollen je sehen dürfen. Taucht ein solcher Wert in irgendeiner Antwort einer anderen Rolle auf
 * – egal unter welchem Feldnamen, in welchem Format oder in welcher Fehlermeldung –, ist das ein Leck.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { starte, U, BS } = require('./hilfe');
const { testJpeg } = require('./fuhrpark-bilder');

const ROLLEN = ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf'];
const ID = { mitarbeiter: U.mitarbeiter, polier: U.polier, bauleiter: U.bauleiter, buero: U.buero, gf: U.gf };
const TOKEN = 'rechte-matrix-test-token-0123456789';
// Mitarbeiter 3 (Daniel Schwarz) gehört zur Partie von Polier 1 auf Baustelle 1 (Pitten)
const ANDERER_MA = 3;
// Mitarbeiter 14 (Mario Gruber) gehört zur Baustelle 3 (Reisinger, Bauleiter = GF, Polier 13)
const FREMDER_MA = 14;

/* ------------------------------------------------------------------ Routen */

/**
 * Alle registrierten Routen (Methode + vollständiger Pfad) aus dem Router-Stack der App.
 * Eingehängte Router werden rekursiv durchsucht; der Einhängepunkt wird über den Matcher der Schicht ermittelt.
 */
function routenAusApp(app) {
  const out = [];
  const praefixVon = (layer) => {
    for (const p of ['/api', '']) {
      try { const m = layer.matchers && layer.matchers[0] && layer.matchers[0](p + '/__probe__'); if (m) return m.path === '/' ? '' : m.path; } catch (_) { /* weiter */ }
    }
    throw new Error('Unbekannter Einhängepunkt eines Routers – routenAusApp erweitern');
  };
  const lauf = (stack, praefix) => {
    for (const l of stack) {
      if (l.route) {
        const pfade = Array.isArray(l.route.path) ? l.route.path : [l.route.path];
        for (const p of pfade) {
          if (typeof p !== 'string') throw new Error(`Route mit RegExp-Pfad gefunden (${p}) – Matrix kann sie nicht prüfen`);
          for (const m of Object.keys(l.route.methods)) if (m !== '_all') out.push(`${m.toUpperCase()} ${praefix}${p}`);
          if (l.route.methods._all) out.push(`ALL ${praefix}${p}`);
        }
      } else if (l.handle && Array.isArray(l.handle.stack)) {
        lauf(l.handle.stack, praefix + praefixVon(l));
      }
    }
  };
  lauf(app.router.stack, '');
  return out;
}

/* ------------------------------------------------------------------ Kanarienvögel */

// Geld je Baustelle (Bauleiter 103 besitzt BS 1 Pitten, nicht BS 3 Reisinger)
const GELD = {
  bs1: { rechnungNetto: 87654.32, nachtrag: 76543.21, fremdleistung: 65432.19, zahlung: 3456.78, haftruecklass: 5432.11, posEp: 777.77, mengePa: 6666.66, auftragssumme: 345678.91 },
  bs3: { rechnungNetto: 81818.18, nachtrag: 72727.27, fremdleistung: 63636.36, zahlung: 3939.39, haftruecklass: 5151.51, posEp: 717.17, mengePa: 6161.61, auftragssumme: 312312.31 },
  global: { leistungEp: 4321.98, geplantEp: 1234.56, katalogEp: 999.88, geraetSatz: 188.77, reparatur: 2468.13 }
};
const TEXT = {
  rechnungNrBs1: 'R-KANARIE-BS1', rechnungNrBs3: 'R-KANARIE-BS3',
  nachtragBs3: 'NACHTRAG-KANARIE-BS3', fremdBs3: 'FREMD-KANARIE-BS3', nachtragBs1: 'NACHTRAG-KANARIE-BS1', fremdBs1: 'FREMD-KANARIE-BS1',
  dokFinBs1: 'DOKFIN-KANARIE-BS1', dokFinBs3: 'DOKFIN-KANARIE-BS3', dokSvBs1: 'DOKSV-KANARIE-BS1', dokPlanBs3: 'DOKPLAN-KANARIE-BS3', dokPlanBs1: 'DOKPLAN-OK-BS1',
  krank: 'KRANK-KANARIE-DIAGNOSE', urlaubAnderer: 'URLAUB-KANARIE-3', planNotizAnderer: 'PLANNOTIZ-KANARIE-3', planNotizEigen: 'PLANNOTIZ-EIGEN-2',
  telefonAnderer: '+43 699 3333 3131', telefonPolier: '+43 664 1111 1111', smtp: 'smtp-kanarie.example.test', alarmAn: 'alarm-kanarie@example.test',
  schadenEigen: 'SCHADEN-EIGEN-KANARIE von Mitarbeiter 2', schadenFremd: 'SCHADEN-FREMD-KANARIE von Mitarbeiter 14', lvKurztext: 'LV-KANARIE-POSITION'
};

function zahlFormen(z) {
  const [g, n] = z.toFixed(2).split('.');
  const tausend = g.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return [`${g}.${n}`, `${g},${n}`, `${tausend},${n}`, `${g.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${n}`, `${g.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${n}`, `${g.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${n}`, `${g.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${n}`]
    .concat(n === '00' ? [] : []);
}

/**
 * Kanarienvögel, die eine Rolle NIE sehen darf (je Antwort, alle Formate).
 * @returns {{name:string, formen:string[]}[]}
 */
function verboteneKanarien(rolle) {
  const k = [];
  const geld = (gruppe, schluessel) => k.push({ name: `€ ${gruppe}.${schluessel}=${GELD[gruppe][schluessel]}`, formen: zahlFormen(GELD[gruppe][schluessel]) });
  const text = (schluessel) => k.push({ name: `Text ${schluessel}`, formen: [TEXT[schluessel]] });
  if (rolle === 'mitarbeiter' || rolle === 'polier') {
    for (const g of ['bs1', 'bs3', 'global']) for (const s of Object.keys(GELD[g])) geld(g, s);
    ['rechnungNrBs1', 'rechnungNrBs3', 'nachtragBs3', 'fremdBs3', 'nachtragBs1', 'fremdBs1', 'dokFinBs1', 'dokFinBs3', 'dokSvBs1', 'dokPlanBs3', 'krank', 'smtp', 'alarmAn', 'schadenFremd', 'lvKurztext'].forEach(text);
    if (rolle === 'mitarbeiter') ['urlaubAnderer', 'planNotizAnderer', 'telefonAnderer', 'dokPlanBs1'].forEach(text);
  } else if (rolle === 'bauleiter') {
    for (const s of Object.keys(GELD.bs3)) geld('bs3', s);
    ['rechnungNrBs3', 'nachtragBs3', 'fremdBs3', 'dokFinBs3', 'dokPlanBs3', 'krank', 'smtp', 'alarmAn', 'schadenFremd'].forEach(text);
  } else if (rolle === 'buero') {
    ['smtp', 'alarmAn'].forEach(text); // SMTP-Einstellungen: nur Recht `benutzer` (GF)
  }
  return k;
}

/* ------------------------------------------------------------------ Text aus Antworten */

/** Text aus einem PDF (Flate-Streams entpacken, Tj/TJ-Strings dekodieren; Hex und Literal) */
function pdfText(buf) {
  const roh = buf.toString('latin1');
  const teile = [roh];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(roh))) {
    const start = m.index + m[0].length;
    const ende = roh.indexOf('endstream', start);
    if (ende < 0) break;
    const daten = buf.subarray(start, ende);
    try { teile.push(zlib.inflateSync(daten).toString('latin1')); } catch (_) { try { teile.push(zlib.inflateSync(daten.subarray(0, daten.length - 1)).toString('latin1')); } catch (__) { /* kein Flate */ } }
  }
  const out = [];
  for (const t of teile) {
    for (const x of t.matchAll(/\[((?:[^\]\\]|\\.)*)\]\s*TJ/g)) out.push(stringsAus(x[1]).join(''));
    for (const x of t.matchAll(/(<[0-9a-fA-F]*>|\((?:[^)\\]|\\.)*\))\s*Tj/g)) out.push(stringsAus(x[1]).join(''));
  }
  return out.join('\n');
}
function stringsAus(s) {
  const r = [];
  for (const x of s.matchAll(/<([0-9a-fA-F]*)>|\(((?:[^)\\]|\\.)*)\)/g)) {
    if (x[1] !== undefined) r.push(Buffer.from(x[1], 'hex').toString('latin1'));
    else r.push(x[2].replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, e) => (/^[0-7]/.test(e) ? String.fromCharCode(parseInt(e, 8)) : ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[e] || e))));
  }
  return r;
}
/** WinAnsi → Unicode für €, Umlaute (pdfkit-Standardschriften) */
function winAnsi(s) { return s.replace(/\x80/g, '€'); }

async function xlsxText(buf) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const out = [];
  wb.eachSheet((ws) => {
    out.push(`[Blatt ${ws.name}]`);
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (c) => {
        const v = c.value;
        if (v == null) return;
        if (typeof v === 'object') {
          if (v.formula !== undefined) out.push(`=${v.formula} → ${v.result === undefined ? '' : JSON.stringify(v.result)}`);
          else if (v.richText) out.push(v.richText.map((x) => x.text).join(''));
          else if (v instanceof Date) out.push(v.toISOString());
          else out.push(JSON.stringify(v));
        } else out.push(String(v));
        if (c.numFmt && /€|EUR/.test(c.numFmt)) out.push(`[Zahlenformat mit €: ${c.numFmt}]`);
      });
    });
  });
  return out.join('\n');
}

/** Gesamter lesbarer Inhalt einer Antwort (für Text-/Kanarien-Suche) */
async function antwortText(r) {
  const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
  if (Buffer.isBuffer(r.daten)) {
    if (ct.includes('pdf')) return winAnsi(pdfText(r.daten));
    if (ct.includes('spreadsheetml')) { try { return await xlsxText(r.daten); } catch (e) { return `[XLSX unlesbar: ${e.message}]`; } }
    return r.daten.toString('utf8');
  }
  return typeof r.daten === 'string' ? r.daten : JSON.stringify(r.daten);
}

/* ------------------------------------------------------------------ Scanner */

// Feldnamen mit €-Bezug (Liste aus API.md 2/6/10–12 + Sicherheitsnetz EURO_FELDER, großzügig)
const GELD_SCHLUESSEL = /preis|^eps?$|^ep[A-Z_]|^epAb$|kosten|^satz$|kostensatz|verrechnungssatz|regiesatz|stundensatz|betrag|summe|euro|€|budget|^auftrag(?!geber)|rechnung|zahlung|^ek$|^vk$|netto|brutto|^ust|skonto|r(ue|ü)ckla(ss|ß)|erloes|^db$|dbprozent|mahn|^gp$|^soll$|perioden|leistungsstand|verrechnet|offeneposten|^offen$|nachtr(ae|ä)ge/i;
const LOHN_SCHLUESSEL = /^lohngruppe(n|Id|Verlauf|GueltigAb)?$/i;
// Betrag mit Währung in Texten (z. B. „1.234,50 €“, „EUR 12“, „€ 5“)
const GELD_TEXT = /\d[\d.,   ]*\s?(€|EUR\b)|(€|\bEUR)\s?-?\d/;

/**
 * Ausnahmen der Schlüsselprüfung: Feld + Route (+ Rolle), immer mit Begründung.
 * route: exakter Routen-Schlüssel oder '*'
 */
const SCHLUESSEL_AUSNAHMEN = [
  { schluessel: 'summe', route: 'GET /api/zeit/woche', grund: 'Stundensumme der eigenen Woche (Stunden, kein €)' },
  { schluessel: 'satz', route: '*', nurWennWert: (v) => v === null, grund: 'nie belegt' },
  { schluessel: 'lohngruppe', route: 'GET /api/auth/ich', pfad: /^\$\.benutzer\.lohngruppe$/, grund: 'eigene Lohngruppe im Anmelde-Objekt ist laut API.md 12.22 erlaubt' },
  { schluessel: 'lohngruppe', route: 'POST /api/auth/login', pfad: /^\$\.benutzer\.lohngruppe$/, grund: 'eigene Lohngruppe nach der Anmeldung (wie /auth/ich)' },
  { schluessel: 'lohngruppe', route: 'POST /api/auth/login/2fa', pfad: /^\$\.benutzer\.lohngruppe$/, grund: 'eigene Lohngruppe nach der Anmeldung (wie /auth/ich)' },
  { schluessel: 'rechnung', route: 'GET /api/push/einstellungen', pfad: /^\$\.typen\.rechnung$/, grund: 'nur Schalter-Name eines Push-Typs (bool); Wert wird zusätzlich geprüft', nurWennWert: (v) => typeof v === 'boolean' },
  { schluessel: 'budget', route: 'GET /api/push/einstellungen', pfad: /^\$\.typen\.budget$/, grund: 'nur Schalter-Name eines Push-Typs (bool)', nurWennWert: (v) => typeof v === 'boolean' },
  { schluessel: 'rechnung', route: 'PUT /api/push/einstellungen', pfad: /^\$\.typen\.rechnung$/, grund: 'nur Schalter-Name', nurWennWert: (v) => typeof v === 'boolean' },
  { schluessel: 'budget', route: 'PUT /api/push/einstellungen', pfad: /^\$\.typen\.budget$/, grund: 'nur Schalter-Name', nurWennWert: (v) => typeof v === 'boolean' },
  { schluessel: 'auftraggeber', route: '*', grund: 'Name des Auftraggebers (kein €-Wert; Konzept: Baustellen-Stammdaten)' },
  { schluessel: 'euro', route: '*', pfad: /\.paletten\.euro$/, grund: 'Anzahl Europaletten im Bautagesbericht (Stück, kein Geld)' },
  { schluessel: 'lohngruppen', route: 'GET /api/preise', pfad: /^\$\.lohngruppen$/, grund: 'Preisliste je Lohngruppe (Kostensatz/Regiesatz) – Recht preise_sehen, keine Person' },
  { schluessel: 'lohngruppeId', route: 'GET /api/kalkulation/:baustelleId', pfad: /^\$\.positionen\.lohn\[\d+\]\.lohngruppeId$/, grund: 'aggregierte Stunden je Lohngruppe der eigenen Baustelle (API.md 6, kalk_sehen), keine Person' }
];
/** Nur Zahlen, Zahl-Texte und Objekte/Listen gelten unter einem €-Schlüssel als Geldwert (nicht bool/Text wie offen=false, db="ok") */
const geldWert = (w) => typeof w === 'number' || (typeof w === 'string' && /^-?\d+([.,]\d+)?$/.test(w.trim())) || (w && typeof w === 'object' && Object.keys(w).length > 0);

function schluesselErlaubt(route, pfad, k, wert) {
  return SCHLUESSEL_AUSNAHMEN.some((a) => a.schluessel === k && (a.route === '*' || a.route === route) && (!a.pfad || a.pfad.test(pfad)) && (!a.nurWennWert || a.nurWennWert(wert)));
}

/** Routen, die nur Daten des Aufrufers liefern (Einträge ohne benutzerId gehören ihm selbst) */
const EIGENE_ROUTEN = ['GET /api/zeit/woche', 'GET /api/zeit/status', 'GET /api/plan/ich', 'GET /api/auth/ich'];

/** Darf diese Rolle (in dieser Variante) €-Schlüssel sehen? */
function geldErlaubt(rolle, variante) {
  if (rolle === 'buero' || rolle === 'gf') return true;
  if (rolle === 'bauleiter') return variante !== 'fremd';
  return false;
}
const lohnErlaubt = (rolle) => rolle === 'buero' || rolle === 'gf';

/**
 * Prüft eine Antwort. Liefert Verstöße als Texte.
 * @param {string} rolle
 * @param {{status:number, daten:any, headers:any}} r
 * @param {{route:string, variante?:string, url?:string}} k
 */
async function scanne(rolle, r, k) {
  const v = [];
  const wo = `${rolle} ${k.url || k.route}${k.variante ? ` [${k.variante}]` : ''} → ${r.status}`;
  // 1) Schlüssel (nur JSON)
  if (r.daten && typeof r.daten === 'object' && !Buffer.isBuffer(r.daten)) {
    const geld = geldErlaubt(rolle, k.variante), lohn = lohnErlaubt(rolle);
    const lauf = (x, pfad) => {
      if (Array.isArray(x)) return x.forEach((e, i) => lauf(e, `${pfad}[${i}]`));
      if (x && typeof x === 'object') {
        for (const [key, wert] of Object.entries(x)) {
          const p = `${pfad}.${key}`;
          if (!geld && GELD_SCHLUESSEL.test(key) && geldWert(wert) && !schluesselErlaubt(k.route, p, key, wert)) v.push(`${wo}: €-Schlüssel ${p}=${JSON.stringify(wert).slice(0, 80)}`);
          if (!lohn && LOHN_SCHLUESSEL.test(key) && wert != null && !schluesselErlaubt(k.route, p, key, wert)) v.push(`${wo}: Lohngruppe ${p}=${JSON.stringify(wert).slice(0, 80)}`);
          lauf(wert, p);
        }
      }
    };
    lauf(r.daten, '$');
    // Krankenstand (Code K) anderer Personen nur für stammdaten/lohn (API.md 12.19/12.24)
    if (!lohn) {
      const eigeneId = ID[rolle];
      const kLauf = (x, pfad, person) => {
        if (Array.isArray(x)) return x.forEach((e, i) => kLauf(e, `${pfad}[${i}]`, person));
        if (x && typeof x === 'object') {
          const p2 = x.benutzerId !== undefined ? x.benutzerId : person;
          const eigeneRoute = p2 === undefined && EIGENE_ROUTEN.includes(k.route);
          if (x.code === 'K' && p2 !== eigeneId && !eigeneRoute) v.push(`${wo}: Krankenstand (Code K) einer anderen Person (${p2}) bei ${pfad}`);
          if (x.pnr != null && p2 !== eigeneId && !eigeneRoute) v.push(`${wo}: Personalnummer einer anderen Person (${p2}) bei ${pfad}`);
          // Mitarbeiter: Zeiten, Abwesenheiten und Urlaub nur von sich selbst (API.md 7 B-07, 12.19)
          if (rolle === 'mitarbeiter' && !k.mitAusnahmen && x.benutzerId !== undefined && x.benutzerId !== eigeneId && /(GET|POST) \/api\/(abwesenheiten|urlaub|zeit)\b/.test(k.route)) v.push(`${wo}: Daten einer anderen Person (${x.benutzerId}) bei ${pfad}`);
          for (const [key, wert] of Object.entries(x)) kLauf(wert, `${pfad}.${key}`, p2);
        }
      };
      kLauf(r.daten, '$', undefined);
    }
  }
  // 2) Text: €-Beträge und Kanarienvögel (alle Formate, auch Fehlermeldungen)
  const text = await antwortText(r);
  if (k.nurKanarien) {
    for (const kan of verboteneKanarien(rolle)) for (const f of kan.formen) if (text.includes(f)) { v.push(`${wo}: Kanarienvogel ${kan.name} gefunden`); break; }
    return v;
  }
  if (!geldErlaubt(rolle, k.variante === 'fremd' && rolle === 'bauleiter' ? 'fremd' : k.variante) && rolle !== 'bauleiter') {
    const m = GELD_TEXT.exec(text);
    if (m) v.push(`${wo}: €-Betrag im Text „${text.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' ')}“`);
  }
  if (['mitarbeiter', 'polier', 'bauleiter'].includes(rolle)) {
    const m = /\bKrank(enstand|meldung)?\b/.exec(text);
    if (m) v.push(`${wo}: Wort „${m[0]}“ (Gesundheitsdaten) im Text „…${text.slice(Math.max(0, m.index - 60), m.index + 40).replace(/\s+/g, ' ')}…“`);
  }
  for (const kan of verboteneKanarien(rolle).filter((x) => !(k.erlaubteKanarien || []).includes(x.name))) {
    for (const f of kan.formen) {
      const i = text.indexOf(f);
      if (i >= 0) { v.push(`${wo}: Kanarienvogel ${kan.name} gefunden („…${text.slice(Math.max(0, i - 60), i + f.length + 20).replace(/\s+/g, ' ')}…“)`); break; }
    }
  }
  return v;
}

/* ------------------------------------------------------------------ DB-Fingerabdruck */

// Tabellen, die sich durch jede Anfrage ändern dürfen (keine fachlichen Daten), mit Grund
const DB_FLUECHTIG = {
  sitzung: 'letzter Zugriff der Sitzung wird bei jeder Anfrage aktualisiert',
  login_versuch: 'Anmeldebremse (nur bei Login-Routen)',
  login_konto: 'Kontosperre (nur bei Login-Routen)',
  wetter_cache: 'Zwischenspeicher',
  push_abo: 'Zustellversuch (zuletzt/fehler) nach jeder Anfrage (12.3)'
};
function dbHash(db) {
  const tabellen = db.alle("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((t) => t.name);
  const je = {};
  for (const t of tabellen) {
    if (DB_FLUECHTIG[t]) continue;
    const h = crypto.createHash('sha256');
    for (const z of db.alle(`SELECT * FROM "${t}" ORDER BY rowid`)) h.update(JSON.stringify(z));
    je[t] = h.digest('hex');
  }
  return je;
}
function dbUnterschied(a, b) {
  return Object.keys({ ...a, ...b }).filter((t) => a[t] !== b[t]);
}

/* ------------------------------------------------------------------ Basis-Datenbank */

const b64 = (b) => Buffer.from(b).toString('base64');
function kleinesPdf(text = 'Dokument') {
  return Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\n% ${text}\ntrailer << /Root 1 0 R >>\n%%EOF\n`, 'latin1');
}

async function erwarte(r, status, was) {
  const ok = Array.isArray(status) ? status.includes(r.status) : r.status === status;
  if (!ok) throw new Error(`Vorbereitung „${was}“: Status ${r.status} statt ${status}: ${JSON.stringify(r.daten).slice(0, 400)}`);
  return r.daten;
}

/**
 * Legt die Basis-Datenbank an (Demo-Seed + Objekte für eigene/fremde Varianten + Kanarienvögel).
 * @returns {Promise<{ordner:string, datei:string, F:object}>}
 */
async function erstelleBasis() {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'bautag-rechte-basis-'));
  const datei = path.join(ordner, 'basis.db');
  const s = await starte({ dbPath: datei, test: true, testToken: TOKEN, pdfUnkomprimiert: false });
  const F = {};
  try {
    const c = {};
    for (const r of ROLLEN) c[r] = await s.login(ID[r]);
    const gf = c.gf, buero = c.buero;
    const ver = async (p) => (await gf.get(p)).daten.version;

    // --- Auftragssummen, Nachträge, Fremdleistungen, Haftrücklass (€ je Baustelle)
    for (const [bs, g, t] of [[BS.pitten, GELD.bs1, 'Bs1'], [BS.reisinger, GELD.bs3, 'Bs3']]) {
      await erwarte(await gf.put(`/baustellen/${bs}/auftrag`, { version: await ver(`/baustellen/${bs}`), auftragssumme: g.auftragssumme }), 200, 'Auftrag');
      await erwarte(await gf.post(`/baustellen/${bs}/nachtraege`, { text: TEXT[`nachtrag${t}`], betrag: g.nachtrag }), 201, 'Nachtrag');
      await erwarte(await gf.post(`/baustellen/${bs}/fremdleistungen`, { text: TEXT[`fremd${t}`], betrag: g.fremdleistung, datum: '2026-11-10' }), 201, 'Fremdleistung');
      await erwarte(await gf.put(`/baustellen/${bs}/abschluss`, { version: await ver(`/baustellen/${bs}`), haftruecklass: { betrag: g.haftruecklass, prozent: 3 } }), 200, 'Haftrücklass');
    }
    // --- Rechnungen + Zahlung + Mahnung
    F.rechnung = {};
    for (const [bs, g, nr, k] of [[BS.pitten, GELD.bs1, TEXT.rechnungNrBs1, 'bs1'], [BS.reisinger, GELD.bs3, TEXT.rechnungNrBs3, 'bs3']]) {
      const r = await erwarte(await buero.post(`/baustellen/${bs}/rechnungen`, { nr, typ: 'abschlag', datum: '2026-09-01', netto: g.rechnungNetto, zahlungszielTage: 30 }), 201, 'Rechnung');
      F.rechnung[k] = r.id;
      const z = await erwarte(await buero.post(`/rechnungen/${r.id}/zahlungen`, { datum: '2026-10-01', betrag: g.zahlung }), 201, 'Zahlung');
      F.rechnung[`${k}Zahlung`] = (z.zahlungen || []).slice(-1)[0] ? z.zahlungen.slice(-1)[0].id : null;
      await erwarte(await buero.post(`/rechnungen/${r.id}/mahnungen`, { stufe: 1, datum: '2026-11-05' }), [200, 201], 'Mahnung');
    }
    // --- Preise (global, Bauleiter darf lesen)
    await erwarte(await gf.put('/preise/leistungen/1', { feld: 'ep', wert: GELD.global.leistungEp }), 200, 'Preis');
    await erwarte(await gf.put('/preise/leistungen/2', { feld: 'ep', wert: GELD.global.geplantEp, gueltigAb: '2027-01-01' }), 200, 'geplanter Preis');
    await erwarte(await gf.put('/preise/geraete/1', { feld: 'kostensatz', wert: GELD.global.geraetSatz }), 200, 'Gerätesatz');
    F.preisStand = s.db.eins("SELECT id FROM preis_stand WHERE gueltig_ab = '2027-01-01'").id;
    const kat = await erwarte(await gf.get('/positionen/katalog'), 200, 'Katalog');
    F.katalogPos = kat.gruppen[0].positionen[0].id;
    await erwarte(await gf.put(`/positionen/katalog/${F.katalogPos}`, { ep: GELD.global.katalogEp, gueltigAb: '2027-02-01' }), 200, 'Katalog-EP');
    F.katalogStand = (await erwarte(await gf.get(`/positionen/katalog/${F.katalogPos}/verlauf`), 200, 'Katalog-Verlauf')).slice(-1)[0].id;
    // --- Projektpositionen: EP + PA-Menge je Baustelle
    F.pos = {};
    for (const [bs, g, k] of [[BS.pitten, GELD.bs1, 'bs1'], [BS.reisinger, GELD.bs3, 'bs3']]) {
      const p = await erwarte(await gf.get(`/baustellen/${bs}/positionen`), 200, 'Positionen');
      const alle = p.gruppen.flatMap((x) => x.positionen);
      const pos = alle.find((x) => x.einheit === 'm2' || x.einheit === 'm²') || alle[0];
      const pa = alle.find((x) => x.einheit === 'PA');
      await erwarte(await gf.put(`/baustellen/${bs}/positionen/${pos.id}`, { version: pos.version, ep: g.posEp, gueltigAb: '2027-03-01' }), 200, 'Pos-EP');
      const m = await erwarte(await gf.post(`/baustellen/${bs}/positionen/${pa.id}/mengen`, { datum: '2026-11-02', menge: g.mengePa, notiz: 'Lieferantenrechnung' }), 201, 'PA-Menge');
      F.pos[k] = pos.id; F.pos[`${k}Pa`] = pa.id;
      F.pos[`${k}Menge`] = m.id || (m.eintraege ? m.eintraege.slice(-1)[0].id : null);
      F.pos[`${k}Stand`] = (await erwarte(await gf.get(`/baustellen/${bs}/positionen/${pos.id}/verlauf`), 200, 'Pos-Verlauf')).slice(-1)[0].id;
    }
    F.pos.bs3MengePos = (await erwarte(await gf.post(`/baustellen/${BS.reisinger}/positionen/${F.pos.bs3}/mengen`, { datum: '2026-11-03', menge: 2, notiz: 'GF' }), 201, 'Menge BS3')).id;
    // Bauleiter-eigene Menge (für Storno-Proben)
    const blm = await erwarte(await c.bauleiter.post(`/baustellen/${BS.pitten}/positionen/${F.pos.bs1}/mengen`, { datum: '2026-11-03', menge: 3, notiz: 'BL' }), 201, 'BL-Menge');
    F.pos.bs1MengeBl = blm.id || null;
    // Koordinaten (Wetter-Attrappe im Testbetrieb)
    for (const bs of [BS.pitten, BS.reisinger]) await erwarte(await gf.put(`/baustellen/${bs}`, { version: await ver(`/baustellen/${bs}`), lat: 47.71, lng: 16.1 }), 200, 'Koordinaten');
    // --- Leistungsmeldungen je Baustelle
    F.leistung = {};
    for (const [bs, k] of [[BS.pitten, 'bs1'], [BS.reisinger, 'bs3']]) F.leistung[k] = (await erwarte(await gf.post(`/baustellen/${bs}/leistungen`, { leistungId: 3, menge: 1.5, datum: '2026-11-10' }), 201, 'Leistung')).id;
    F.nachtrag = { bs1: s.db.eins('SELECT id FROM nachtrag WHERE baustelle_id = ? ORDER BY id DESC', BS.pitten).id, bs3: s.db.eins('SELECT id FROM nachtrag WHERE baustelle_id = ? ORDER BY id DESC', BS.reisinger).id };
    F.fremd = { bs1: s.db.eins('SELECT id FROM fremdleistung WHERE baustelle_id = ? ORDER BY id DESC', BS.pitten).id, bs3: s.db.eins('SELECT id FROM fremdleistung WHERE baustelle_id = ? ORDER BY id DESC', BS.reisinger).id };

    // --- LV mit Kanarien-Kurztext je Baustelle
    F.lv = {};
    for (const [bs, k] of [[BS.pitten, 'bs1'], [BS.reisinger, 'bs3']]) {
      const xml = `<?xml version="1.0" encoding="UTF-8"?><onlv><lv><position oz="01.01"><kurztext>${TEXT.lvKurztext}</kurztext><einheit>PA</einheit><menge>1</menge><ep>${k === 'bs1' ? '2222.22' : '2323.23'}</ep></position></lv></onlv>`;
      await erwarte(await buero.post(`/baustellen/${bs}/lv-import`, { dateiBase64: b64(xml), dateiname: 'lv.onlv', vorschau: false }), 200, 'LV');
      F.lv[k] = (await erwarte(await buero.get(`/baustellen/${bs}/lv`), 200, 'LV lesen')).positionen[0].id;
    }

    // --- Projektdokumente
    F.dok = {};
    const dok = async (bs, kategorie, titel) => (await erwarte(await gf.post(`/baustellen/${bs}/dokumente`, { kategorie, titel, dateiBase64: b64(kleinesPdf(titel)), dateiname: `${titel}.pdf` }), 201, `Dokument ${titel}`)).id;
    F.dok.finBs1 = await dok(BS.pitten, 'angebot', TEXT.dokFinBs1);
    F.dok.finBs3 = await dok(BS.reisinger, 'angebot', TEXT.dokFinBs3);
    F.dok.svBs1 = await dok(BS.pitten, 'schriftverkehr', TEXT.dokSvBs1);
    F.dok.planBs1 = await dok(BS.pitten, 'plaene', TEXT.dokPlanBs1);
    F.dok.planBs3 = await dok(BS.reisinger, 'plaene', TEXT.dokPlanBs3);
    F.dok.eingangBs1 = await dok(BS.pitten, 'eingangsrechnungen', TEXT.dokFinBs1 + '-ER');
    // eigene Kategorie (GF) für Kategorie-Proben
    F.kategorie = (await erwarte(await gf.post('/dokument-kategorien', { name: 'Rechte-Test-Kategorie', finanziell: false, polier: false }), 201, 'Kategorie')).schluessel;

    // --- Personen: Telefon, Abwesenheiten (Krank mit Notiz = Gesundheitsdaten), Urlaubsanträge
    await erwarte(await gf.put(`/benutzer/${ANDERER_MA}`, { telefon: TEXT.telefonAnderer }), 200, 'Telefon anderer');
    await erwarte(await gf.put(`/benutzer/${U.polier}`, { telefon: TEXT.telefonPolier }), 200, 'Telefon Polier');
    const k = await erwarte(await buero.post('/abwesenheiten/zeitraum', { benutzerId: ANDERER_MA, von: '2026-11-16', bis: '2026-11-17', code: 'K', notiz: TEXT.krank }), 201, 'Krank');
    F.krankAntrag = k.antragId;
    F.krankTag = s.db.eins('SELECT id FROM abwesenheit WHERE benutzer_id = ? AND code = ? ORDER BY id', ANDERER_MA, 'K').id;
    const ma3 = await s.login(ANDERER_MA);
    const u3 = await erwarte(await ma3.post('/abwesenheiten/zeitraum', { benutzerId: ANDERER_MA, von: '2026-12-01', bis: '2026-12-02', code: 'U', notiz: TEXT.urlaubAnderer }), 201, 'Urlaub anderer');
    F.urlaubAnderer = u3.antragId;
    F.urlaubAndererTag = s.db.eins("SELECT id FROM abwesenheit WHERE benutzer_id = ? AND code = 'U' ORDER BY id", ANDERER_MA).id;
    const u2 = await erwarte(await c.mitarbeiter.post('/abwesenheiten/zeitraum', { benutzerId: U.mitarbeiter, von: '2026-12-03', bis: '2026-12-04', code: 'U', notiz: 'eigener Urlaub' }), 201, 'eigener Urlaub');
    F.urlaubEigen = u2.antragId;
    F.urlaubEigenTag = s.db.eins("SELECT id FROM abwesenheit WHERE benutzer_id = ? AND code = 'U' ORDER BY id DESC", U.mitarbeiter).id;
    const ma14 = await s.login(FREMDER_MA);
    const u14 = await erwarte(await ma14.post('/abwesenheiten/zeitraum', { benutzerId: FREMDER_MA, von: '2026-12-07', bis: '2026-12-07', code: 'U', notiz: 'Urlaub 14' }), 201, 'Urlaub fremd');
    F.urlaubFremd = u14.antragId;
    F.urlaubFremdTag = s.db.eins("SELECT id FROM abwesenheit WHERE benutzer_id = ? AND code = 'U' ORDER BY id DESC", FREMDER_MA).id;

    // eintägige Anträge (Entscheidung je Tag) und eigene Anträge von Polier/Bauleiter (Zurückziehen)
    const u3e = await erwarte(await ma3.post('/abwesenheiten/zeitraum', { benutzerId: ANDERER_MA, von: '2026-12-10', bis: '2026-12-10', code: 'U' }), 201, 'Urlaub 1 Tag');
    F.urlaubAnderer1 = u3e.antragId;
    F.urlaubAnderer1Tag = s.db.eins('SELECT id FROM abwesenheit WHERE benutzer_id = ? AND datum = ?', ANDERER_MA, '2026-12-10').id;
    F.urlaubEigenRolle = {};
    for (const [r, d] of [['polier', '2026-12-14'], ['bauleiter', '2026-12-15'], ['buero', '2026-12-16'], ['gf', '2026-12-17']]) {
      const a = await erwarte(await c[r].post('/abwesenheiten/zeitraum', { benutzerId: ID[r], von: d, bis: d, code: 'U' }), 201, `Urlaub ${r}`);
      F.urlaubEigenRolle[r] = { antrag: a.antragId, tag: s.db.eins('SELECT id FROM abwesenheit WHERE benutzer_id = ? AND datum = ?', ID[r], d).id };
    }
    F.urlaubEigenRolle.mitarbeiter = { antrag: F.urlaubEigen, tag: F.urlaubEigenTag };

    // --- Baustellenplaner: Einsätze morgen (Fr 13.11.) auf BS 1 und BS 3, veröffentlicht; Fuhren
    const morgen = '2026-11-13';
    F.datumMorgen = morgen;
    const e1 = await erwarte(await gf.post('/plan/einsaetze', {
      datum: morgen, baustelleId: BS.pitten, beginn: '06:30', treffpunkt: 'Bauhof', arbeit: 'Pflaster', benoetigt: 'Rüttelplatte', notiz: 'Zufahrt hinten',
      benutzerIds: [U.polier, U.mitarbeiter, ANDERER_MA], anlageIds: [4], notizen: { [ANDERER_MA]: TEXT.planNotizAnderer, [U.mitarbeiter]: TEXT.planNotizEigen }, fahrer: { 4: U.mitarbeiter }
    }), 201, 'Einsatz BS1');
    F.einsatz = { bs1: e1.id };
    const e3 = await erwarte(await gf.post('/plan/einsaetze', { datum: morgen, baustelleId: BS.reisinger, beginn: '07:00', benutzerIds: [13, FREMDER_MA], anlageIds: [5] }), 201, 'Einsatz BS3');
    F.einsatz.bs3 = e3.id;
    const f1 = await erwarte(await gf.post('/plan/fuhren', { datum: morgen, anlageId: 4, fahrerId: U.mitarbeiter, materialId: 4, menge: 12, einheit: 't', nach: { art: 'baustelle', baustelleId: BS.pitten } }), 201, 'Fuhre BS1');
    const f3 = await erwarte(await gf.post('/plan/fuhren', { datum: morgen, anlageId: 6, materialId: 4, menge: 8, einheit: 't', nach: { art: 'baustelle', baustelleId: BS.reisinger } }), 201, 'Fuhre BS3');
    F.fuhre = { bs1: f1.id, bs3: f3.id };
    await erwarte(await gf.post('/plan/veroeffentlichen', { von: morgen }), 200, 'Veröffentlichen');
    F.abschnitt = {};
    for (const [bs, kk] of [[BS.pitten, 'bs1'], [BS.reisinger, 'bs3']]) F.abschnitt[kk] = (await erwarte(await gf.post(`/baustellen/${bs}/abschnitte`, { art: 'erdbau', von: '2026-11-16', bis: '2026-11-20' }), 201, 'Abschnitt')).id;
    F.anfrage = { bs1: (await erwarte(await c.polier.post('/plan/anfragen', { datum: morgen, einsatzId: e1.id, text: 'Bitte einen LKW mehr' }), 201, 'Anfrage')).id };
    const pol13 = await s.login(13);
    F.anfrage.bs3 = (await erwarte(await pol13.post('/plan/anfragen', { datum: morgen, einsatzId: e3.id, text: 'Bitte Bagger tauschen' }), 201, 'Anfrage BS3')).id;
    F.fuhreFoto = {};
    for (const k of ['bs1', 'bs3']) F.fuhreFoto[k] = (await erwarte(await gf.post(`/plan/fuhren/${F.fuhre[k]}/foto`, { bildBase64: b64(testJpeg()), dateiname: 'ls.jpg' }), 201, 'Fuhren-Foto')).id;

    // --- Berichte: je Baustelle ein Entwurf von heute (für Schreibproben) + bestehende (unterschrieben/freigegeben)
    F.bericht = {};
    for (const [bs, kk] of [[BS.pitten, 'bs1'], [BS.reisinger, 'bs3']]) {
      const vorhanden = s.db.eins('SELECT id FROM bericht WHERE baustelle_id = ? AND datum = ?', bs, '2026-11-12');
      F.bericht[kk] = vorhanden ? vorhanden.id : (await erwarte(await gf.post('/berichte', { baustelleId: bs, datum: '2026-11-12' }), 201, 'Bericht')).id;
      F.bericht[`${kk}Alt`] = s.db.eins("SELECT id FROM bericht WHERE baustelle_id = ? AND status <> 'entwurf' ORDER BY datum DESC", bs).id;
      const foto = await erwarte(await gf.post(`/berichte/${F.bericht[kk]}/fotos`, { bildBase64: b64(testJpeg()), dateiname: 'foto.jpg', beschreibung: 'Foto' }), 201, 'Berichtsfoto');
      F.bericht[`${kk}Foto`] = foto.id;
      const link = await erwarte(await gf.post(`/berichte/${F.bericht[kk]}/unterschrift-link`, { rolle: 'bh', name: 'Bauherr' }), 201, 'Fern-Link');
      F.bericht[`${kk}Link`] = link.id;
      F.bericht[`${kk}Token`] = link.url.split('/').pop();
    }
    // --- Fuhrpark: Schäden (Mitarbeiter 2 eigener, Mitarbeiter 14 fremder), Mängel
    const sch2 = await erwarte(await c.mitarbeiter.post('/fuhrpark/schaeden', { anlageId: 4, baustelleId: BS.pitten, art: 'defekt', ursache: TEXT.schadenEigen, einsatzfaehig: 'ja', fotos: [{ bildBase64: b64(testJpeg()), dateiname: 's.jpg' }] }), 201, 'Schaden eigen');
    const sch14 = await erwarte(await ma14.post('/fuhrpark/schaeden', { anlageId: 5, baustelleId: BS.reisinger, art: 'defekt', ursache: TEXT.schadenFremd, einsatzfaehig: 'ja', fotos: [{ bildBase64: b64(testJpeg()), dateiname: 's.jpg' }] }), 201, 'Schaden fremd');
    F.schaden = { eigen: sch2.id, eigenFoto: sch2.fotos[0].id, fremd: sch14.id, fremdFoto: sch14.fotos[0].id };
    // Servicebuch-Eintrag mit Reparaturkosten (€ global)
    const a30 = (await gf.get('/fuhrpark/anlagen/30')).daten;
    const eintrag = await erwarte(await gf.post('/fuhrpark/eintraege', { anlageId: 30, zaehler: a30.zaehler.filter((z) => z.aktiv !== false).map((z) => ({ art: z.art, anzeige: Math.ceil(z.aktuell || 0) })), art: 'reparatur', datum: '2026-11-10', titel: 'Reparatur Hydraulik', werkstatt: 'eigen', kosten: GELD.global.reparatur }), 201, 'Servicebuch-Eintrag');
    F.eintrag = eintrag.id;
    F.anlage = 4;
    F.zaehler = s.db.eins('SELECT id FROM zaehler WHERE anlage_id = 4 ORDER BY id').id;
    F.zaehlerstand = s.db.eins('SELECT id FROM zaehlerstand WHERE zaehler_id = ? ORDER BY id DESC', F.zaehler).id;
    F.planposition = s.db.eins('SELECT id FROM planposition WHERE anlage_id = 4 ORDER BY id').id;
    F.vorlage = s.db.eins('SELECT id FROM plan_vorlage ORDER BY id').id;
    F.mangel = s.db.eins("SELECT id FROM mangel WHERE typ IS NULL OR typ <> 'schaden' ORDER BY id").id;
    // --- Einstellungen mit Kanarien (nur GF)
    await erwarte(await gf.put('/einstellungen/email', { host: TEXT.smtp, port: 587, sicher: false, absender: 'bautag@example.test', alarmAn: TEXT.alarmAn, aktiv: true }), 200, 'SMTP');
    // --- Push-Abos je Rolle
    for (const r of ROLLEN) await erwarte(await c[r].post('/push/abo', { endpoint: `https://push.example.invalid/abo/${r}`, keys: { p256dh: 'BPx1-abc_DEF', auth: 'aBc-12_x' }, geraet: `Gerät ${r}` }), [200, 201], 'Push-Abo');
    F.pushAbo = {};
    for (const r of ROLLEN) F.pushAbo[r] = s.db.eins('SELECT id FROM push_abo WHERE benutzer_id = ? ORDER BY id DESC', ID[r]).id;
    // --- Lohngruppen-Verlauf (künftiger Eintrag) und Lohn-Vorlage
    await erwarte(await gf.put(`/benutzer/${ANDERER_MA}`, { lohngruppe: 'va', lohngruppeGueltigAb: '2027-01-01' }), 200, 'Lohngruppe künftig');
    F.lohngruppeVerlauf = s.db.eins('SELECT id FROM benutzer_lohngruppe WHERE benutzer_id = ? AND gueltig_ab = ?', ANDERER_MA, '2027-01-01').id;
    F.lohnVorlage = (await erwarte(await buero.post('/lohn-vorlagen', { name: 'Rechte-Test-Vorlage', spalten: [{ feld: 'pnr' }, { feld: 'stunden' }] }), 201, 'Lohn-Vorlage')).id;
    // --- Benachrichtigungen je Rolle (eine ID je Rolle)
    F.benachrichtigung = {};
    for (const r of ROLLEN) { const n = s.db.eins('SELECT id FROM benachrichtigung WHERE benutzer_id = ? ORDER BY id DESC', ID[r]); F.benachrichtigung[r] = n ? n.id : null; }
    F.fremdeBenachrichtigung = s.db.eins('SELECT id FROM benachrichtigung WHERE benutzer_id = ? ORDER BY id DESC', U.gf).id;
    // --- Zeit: Buchungen/Schichten je Person
    F.buchung = { mitarbeiter: s.db.eins('SELECT id FROM buchung WHERE benutzer_id = ? ORDER BY id DESC', U.mitarbeiter).id, anderer: s.db.eins('SELECT id FROM buchung WHERE benutzer_id = ? ORDER BY id DESC', ANDERER_MA).id };
    F.schicht = { anderer: s.db.eins("SELECT id FROM buchung WHERE benutzer_id = ? AND typ = 'kommen' ORDER BY id DESC", ANDERER_MA).id };
    F.bsVersion = { bs1: await ver(`/baustellen/${BS.pitten}`), bs3: await ver(`/baustellen/${BS.reisinger}`) };
    F.dummyBenutzer = (await erwarte(await gf.post('/benutzer', { name: 'Rechte Dummy', rolle: 'mitarbeiter', pin: '482915' }), 201, 'Dummy')).id;
  } finally {
    await s.stop();
  }
  fs.writeFileSync(path.join(ordner, 'fixtures.json'), JSON.stringify(F, null, 1));
  return { ordner, datei, F };
}

/** Effektives Recht eines Benutzers (für Ausnahmen wie `fuhrpark`) */
function hatRecht(db, benutzerId, recht) {
  const b = db.eins('SELECT * FROM benutzer WHERE id = ?', benutzerId);
  return Boolean(b) && require('../../server/rechte').ladeRechteFuer(db, b).has(recht);
}

/** Startet einen Server auf einer Kopie der Basis (DB + Uploads) */
async function starteKopie(basis, opt = {}) {
  const ziel = fs.mkdtempSync(path.join(os.tmpdir(), 'bautag-rechte-lauf-'));
  fs.copyFileSync(basis.datei, path.join(ziel, 'basis.db'));
  const up = path.join(basis.ordner, 'uploads');
  if (fs.existsSync(up)) fs.cpSync(up, path.join(ziel, 'uploads'), { recursive: true });
  const s = await starte({ dbPath: path.join(ziel, 'basis.db'), seed: false, test: true, testToken: TOKEN, ...opt });
  const stop = s.stop;
  s.stop = async () => { await stop(); fs.rmSync(ziel, { recursive: true, force: true }); };
  return s;
}

module.exports = {
  ROLLEN, ID, TOKEN, ANDERER_MA, FREMDER_MA, GELD, TEXT, GELD_SCHLUESSEL, LOHN_SCHLUESSEL, GELD_TEXT, SCHLUESSEL_AUSNAHMEN, DB_FLUECHTIG,
  routenAusApp, hatRecht, verboteneKanarien, zahlFormen, pdfText, xlsxText, antwortText, scanne, dbHash, dbUnterschied, erstelleBasis, starteKopie, kleinesPdf, b64, geldErlaubt
};
