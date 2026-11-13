'use strict';
/**
 * Servicebuch – Datenbank-Schicht: lädt den ganzen Fuhrpark-Stand (Anlagen, Zähler, Stände, Positionen, Mängel,
 * Zurechnung der Gerätestunden aus Bautagesberichten) und baut die JSON-Antworten (ohne € ohne preise_sehen).
 */
const F = require('./fuhrpark');
const { parseJson } = require('./daten');
const { plusTage, deDatum } = require('./datum');
const { baustelleImBereich } = require('./rechte');

const OFFEN = ['offen', 'in_arbeit'];
const STUNDEN_STATUS = ['unterschrieben', 'freigegeben'];

/** Leserecht Servicebuch */
const leserecht = (ctx) => ctx.hat('fuhrpark') || ctx.hat('bericht_erstellen');
const euro = (ctx) => ctx.hat('preise_sehen');
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

/**
 * Lädt und berechnet den Fuhrpark-Stand zum Tag H.
 * @returns {{H, anlagen: Map<number, object>, liste: object[], namen: Map, nichtZugeordnet: object[], geraete: Map}}
 */
function ladeStand(db, H) {
  const namen = new Map(db.alle('SELECT id, name FROM benutzer').map((b) => [b.id, b.name]));
  const geraete = new Map(db.alle('SELECT id, code, name, verrechnungssatz FROM geraet').map((g) => [g.id, g]));
  const baustellen = new Map(db.alle('SELECT id, kst, name, kurz, polier_id, bauleiter_id FROM baustelle').map((b) => [b.id, b]));
  const zeilen = db.alle('SELECT * FROM anlage ORDER BY bezeichnung, id');
  const anlagen = new Map();
  for (const a of zeilen) anlagen.set(a.id, { row: a, zaehler: [], positionen: [], maengel: [], stunden: [], letzterBericht: null });

  // Zurechnung der Gerätestunden (7.1)
  const aktivJeGeraet = new Map();
  for (const a of zeilen) if (!a.ausgeschieden && a.geraet_id) {
    if (!aktivJeGeraet.has(a.geraet_id)) aktivJeGeraet.set(a.geraet_id, []);
    aktivJeGeraet.get(a.geraet_id).push(a.id);
  }
  const grenze90 = plusTage(H, -90);
  const nz = new Map();
  for (const z of db.alle(`SELECT bg.bericht_id, bg.geraet_id, bg.anlage_id, bg.stunden, b.datum, b.status, b.baustelle_id
      FROM bericht_geraet bg JOIN bericht b ON b.id = bg.bericht_id WHERE b.status <> 'entwurf' ORDER BY b.datum, b.id`)) {
    let aid = z.anlage_id;
    if (!aid) { const k = aktivJeGeraet.get(z.geraet_id) || []; if (k.length === 1) aid = k[0]; }
    const A = aid ? anlagen.get(aid) : null;
    if (A) {
      if (STUNDEN_STATUS.includes(z.status)) A.stunden.push({ datum: z.datum, stunden: z.stunden, berichtId: z.bericht_id });
      if (!A.letzterBericht || z.datum >= A.letzterBericht.datum) A.letzterBericht = { datum: z.datum, baustelleId: z.baustelle_id };
    } else if (STUNDEN_STATUS.includes(z.status) && z.datum > grenze90 && z.datum <= H) {
      if (!nz.has(z.geraet_id)) { const g = geraete.get(z.geraet_id) || {}; nz.set(z.geraet_id, { geraetId: z.geraet_id, code: g.code, name: g.name, stunden: 0, berichte: 0 }); }
      const e = nz.get(z.geraet_id); e.stunden = r2(e.stunden + z.stunden); e.berichte++;
    }
  }

  const staende = new Map();
  for (const s of db.alle('SELECT * FROM zaehlerstand ORDER BY datum, id')) {
    if (!staende.has(s.zaehler_id)) staende.set(s.zaehler_id, []);
    staende.get(s.zaehler_id).push(s);
  }
  for (const z of db.alle('SELECT * FROM zaehler ORDER BY id')) {
    const A = anlagen.get(z.anlage_id);
    if (!A) continue;
    const st = staende.get(z.id) || [];
    const info = F.zaehlerInfo(z, st, A.stunden, H);
    const gueltig = st.filter((s) => s.status === 'gueltig').sort(F.sortStaende);
    const start = st.find((s) => s.quelle === 'start');
    A.zaehler.push({
      row: z, staende: st, info,
      startstand: start ? start.wert : z.startstand,
      standAm: (d) => { const v = gueltig.filter((s) => s.datum <= d); return v.length ? v[v.length - 1].wert : null; },
      unplausibel: st.filter((s) => s.status === 'unplausibel').length
    });
  }
  for (const m of db.alle(`SELECT * FROM mangel WHERE status IN ('offen','in_arbeit') AND anlage_id IS NOT NULL ORDER BY gemeldet DESC, id DESC`)) {
    const A = anlagen.get(m.anlage_id);
    if (A) A.maengel.push(m);
  }
  const positionen = db.alle(`SELECT p.*, v.schluessel AS vorlage_schluessel, v.pruefen AS vorlage_pruefen FROM planposition p
    LEFT JOIN plan_vorlage v ON v.id = p.vorlage_id ORDER BY p.id`);
  for (const p of positionen) {
    const A = anlagen.get(p.anlage_id);
    if (A) A.positionen.push({ row: p });
  }

  for (const A of anlagen.values()) berechneAnlage(A, H, baustellen);
  const liste = [...anlagen.values()].sort(sortAnlagen);
  return { H, anlagen, liste, namen, geraete, baustellen, nichtZugeordnet: [...nz.values()].sort((a, b) => b.stunden - a.stunden) };
}

const STATUS_FOLGE = { gesperrt: 0, faellig: 1, bald: 2, einsatzbereit: 3, ausgeschieden: 4 };
function sortAnlagen(a, b) {
  return STATUS_FOLGE[a.status.status] - STATUS_FOLGE[b.status.status] || a.row.bezeichnung.localeCompare(b.row.bezeichnung, 'de') || a.row.id - b.row.id;
}

/** Rechenkontext einer Anlage für berechnePosition */
function kontextFuer(A, H) {
  const a = A.row;
  const zMap = {};
  for (const z of A.zaehler.filter((x) => x.row.aktiv)) zMap[z.row.art] = { info: z.info, standAm: z.standAm, startstand: z.startstand };
  const startdaten = A.zaehler.map((z) => z.row.startdatum).sort();
  return { H, erstzulassung: a.erstzulassung, basisErsatz: startdaten[0] || (a.erstellt || '').slice(0, 10) || null, zaehler: zMap };
}

function berechneAnlage(A, H, baustellen) {
  const a = A.row;
  const ctx = kontextFuer(A, H);
  for (const P of A.positionen) {
    P.regel = parseJson(P.row.regel, {});
    P.letzteZaehler = parseJson(P.row.letzte_zaehler, null);
    P.calc = F.berechnePosition({ regel: P.regel, letzteDatum: P.row.letzte_datum, letzteZaehler: P.letzteZaehler }, ctx);
  }
  const aktivePos = A.positionen.filter((p) => p.row.aktiv);
  const sperr = A.maengel.filter((m) => m.dringlichkeit === 'sofort');
  A.status = F.anlagenStatus(a, aktivePos.map((p) => ({ ...p.calc, id: p.row.id, titel: p.row.titel })), sperr);
  // Standort (7.1): jüngster Bericht, außer danach händisch gesetzt
  let standort;
  const lb = A.letzterBericht;
  if (lb && (!a.standort_datum || lb.datum > a.standort_datum)) standort = { baustelleId: lb.baustelleId, quelle: 'bericht', datum: lb.datum };
  else if (a.standort_baustelle_id || a.standort_text) standort = { baustelleId: a.standort_baustelle_id, quelle: 'manuell', datum: a.standort_datum };
  else standort = { baustelleId: null, quelle: null, datum: null };
  const bs = standort.baustelleId ? baustellen.get(standort.baustelleId) : null;
  A.standort = {
    ...(bs ? { baustelleId: bs.id, kst: bs.kst, name: bs.kurz || bs.name } : {}),
    text: standort.quelle === 'manuell' && a.standort_text ? a.standort_text : bs ? `${bs.kst} ${bs.kurz || bs.name}` : (a.standort_text || 'Bauhof / unbekannt'),
    quelle: standort.quelle,
    ...(standort.datum ? { datum: standort.datum } : {})
  };
  A.standortBaustelle = bs || null;
  // nächster Termin
  const offen = aktivePos.filter((p) => !['erledigt'].includes(p.calc.status))
    .sort((x, y) => F.RANG[y.calc.status] - F.RANG[x.calc.status] || (x.calc.naechstesDatum || '9999') .localeCompare(y.calc.naechstesDatum || '9999'));
  A.naechste = [...aktivePos].filter((p) => p.calc.status !== 'erledigt')
    .sort((x, y) => {
      const rx = F.RANG[x.calc.status] >= F.RANG.faellig ? 0 : 1, ry = F.RANG[y.calc.status] >= F.RANG.faellig ? 0 : 1;
      return rx - ry || (x.calc.naechstesDatum || '9999').localeCompare(y.calc.naechstesDatum || '9999') || F.RANG[y.calc.status] - F.RANG[x.calc.status];
    });
  A.offenePositionen = offen;
}

/* ---------------- JSON ---------------- */

const person = (namen, id) => (id ? { id, name: namen.get(id) || '?' } : null);

function zaehlerKurz(z) {
  return { id: z.row.id, art: z.row.art, einheit: F.EINHEIT[z.row.art], aktuell: z.info.aktuell, geschaetzt: z.info.geschaetzt };
}

function zaehlerJson(z) {
  return {
    id: z.row.id, art: z.row.art, einheit: F.EINHEIT[z.row.art], aktiv: z.row.aktiv === 1, ausBericht: z.row.aus_bericht === 1,
    startstand: z.row.startstand, startdatum: z.row.startdatum, versatz: z.row.versatz,
    aktuell: z.info.aktuell, geschaetzt: z.info.geschaetzt, letzterStand: z.info.letzterStand,
    wochenschnitt: z.info.wochenschnitt, schnittQuelle: z.info.schnittQuelle, unplausibel: z.unplausibel
  };
}

function positionJson(P, anlageId) {
  const c = P.calc;
  const o = {
    id: P.row.id, anlageId: anlageId ?? P.row.anlage_id, titel: P.row.titel, art: P.row.art,
    ...(P.row.vorlage_id ? { vorlage: { id: P.row.vorlage_id, schluessel: P.row.vorlage_schluessel, pruefen: P.row.vorlage_pruefen === 1 } } : {}),
    regel: P.regel, letzteDatum: P.row.letzte_datum, letzteZaehler: P.letzteZaehler, letzteEintragId: P.row.letzte_eintrag_id,
    status: c.status, ampel: c.ampel, grund: c.grund, ...(c.hinweis ? { hinweis: c.hinweis } : {}),
    ...(c.faelligAm ? { faelligAm: c.faelligAm } : {}), ...(c.fruehestens ? { fruehestens: c.fruehestens } : {}), ...(c.spaetestens ? { spaetestens: c.spaetestens } : {}),
    ...(c.faelligBei ? { faelligBei: c.faelligBei, rest: c.rest, prognoseAm: c.prognoseAm } : {}),
    naechstesDatum: c.naechstesDatum, sperrt: c.sperrt,
    kriterien: c.kriterien.map((k) => {
      const x = { ...k }; delete x.zyklus; return x;
    }),
    aktiv: P.row.aktiv === 1, version: P.row.version
  };
  return o;
}

function terminKurz(P) {
  return { planpositionId: P.row.id, titel: P.row.titel, status: P.calc.status, naechstesDatum: P.calc.naechstesDatum, grund: P.calc.grund, datum: P.calc.naechstesDatum };
}

function anlageListeJson(S, A, ctx, kosten) {
  const a = A.row;
  const n = A.naechste[0];
  const o = {
    id: a.id, nummer: a.nummer, bezeichnung: a.bezeichnung, klasse: a.klasse, fahrzeugklasse: a.fahrzeugklasse, kennzeichen: a.kennzeichen,
    geraetId: a.geraet_id, ...(a.geraet_id && S.geraete.get(a.geraet_id) ? { geraet: { id: a.geraet_id, code: S.geraete.get(a.geraet_id).code, name: S.geraete.get(a.geraet_id).name } } : {}),
    standort: A.standort,
    ...(a.verantwortlich_id ? { verantwortlich: person(S.namen, a.verantwortlich_id) } : {}),
    status: A.status.status, ampel: A.status.ampel, gesperrt: A.status.gesperrt, sperrGruende: A.status.sperrGruende,
    ...(n && !a.ausgeschieden ? { naechsterTermin: { planpositionId: n.row.id, titel: n.row.titel, datum: n.calc.naechstesDatum, status: n.calc.status, grund: n.calc.grund } } : {}),
    zaehler: A.zaehler.filter((z) => z.row.aktiv).map(zaehlerKurz),
    offeneMaengel: A.maengel.filter((m) => m.typ === 'mangel').length,
    offeneSchaeden: A.maengel.filter((m) => m.typ === 'schaden').length
  };
  if (euro(ctx) && kosten) o.kostenJahr = kosten.jahr.get(a.id) || 0;
  return o;
}

/** Kosten je Anlage (nur intern berechnen, nur mit preise_sehen ausliefern) */
function ladeKosten(db, H) {
  const jahr = new Map(), gesamt = new Map(), j365 = new Map();
  const jahrBeginn = `${H.slice(0, 4)}-01-01`, g365 = plusTage(H, -365);
  for (const e of db.alle('SELECT anlage_id, datum, kosten FROM servicebuch_eintrag WHERE storniert IS NULL AND kosten IS NOT NULL')) {
    gesamt.set(e.anlage_id, r2((gesamt.get(e.anlage_id) || 0) + e.kosten));
    if (e.datum >= jahrBeginn && e.datum <= H) jahr.set(e.anlage_id, r2((jahr.get(e.anlage_id) || 0) + e.kosten));
    if (e.datum > g365 && e.datum <= H) j365.set(e.anlage_id, r2((j365.get(e.anlage_id) || 0) + e.kosten));
  }
  return { jahr, gesamt, j365 };
}

function kostenJeStunde(A, kosten, H) {
  const bh = A.zaehler.find((z) => z.row.art === 'bh' && z.row.aktiv);
  const k = kosten.j365.get(A.row.id) || 0;
  if (!bh || !k) return null;
  const vorher = bh.standAm(plusTage(H, -365)) ?? bh.startstand;
  const zuwachs = bh.info.aktuell - vorher;
  return zuwachs >= 50 ? r2(k / zuwachs) : null;
}

function standJson(s, namen, extra = {}) {
  return {
    id: s.id, zaehlerId: s.zaehler_id, ...extra, datum: s.datum, anzeige: s.anzeige, wert: s.wert, quelle: s.quelle, status: s.status,
    hinweis: s.hinweis, notiz: s.notiz, eintragId: s.eintrag_id, erfasst: s.erfasst, erfasstVon: person(namen, s.erfasst_von), grund: s.grund
  };
}

function mangelJson(m, S) {
  const A = m.anlage_id ? S.anlagen.get(m.anlage_id) : null;
  return {
    id: m.id, anlageId: m.anlage_id, anlage: A ? { id: A.row.id, nummer: A.row.nummer, bezeichnung: A.row.bezeichnung, kennzeichen: A.row.kennzeichen } : null,
    text: m.text, dringlichkeit: m.dringlichkeit, status: m.status, baustelleId: m.baustelle_id, gemeldet: m.gemeldet,
    gemeldetVon: person(S.namen, m.gemeldet_von), bearbeitet: m.bearbeitet, ...(m.bearbeitet_von ? { bearbeitetVon: person(S.namen, m.bearbeitet_von) } : {}),
    notiz: m.notiz, eintragId: m.eintrag_id, version: m.version
  };
}

/* ---------------- Schäden (API.md 11.9) ---------------- */

const SCHADEN_STATUS = { offen: 'gemeldet', in_arbeit: 'in_bearbeitung', behoben: 'behoben', verworfen: 'abgelehnt' };
const SCHADEN_STATUS_DB = { gemeldet: 'offen', in_bearbeitung: 'in_arbeit', behoben: 'behoben', abgelehnt: 'verworfen' };
const DRINGLICHKEIT = { ja: 'hinweis', eingeschraenkt: 'bald', nein: 'sofort' };
const istVerwaltung = (ctx) => ctx.hat('fuhrpark') || ['buero', 'gf'].includes(ctx.benutzer.rolle);

/** Darf ctx diesen Schaden sehen? */
function schadenSichtbar(db, ctx, m, cache = {}) {
  if (m.gemeldet_von === ctx.benutzer.id || istVerwaltung(ctx)) return true;
  const rolle = ctx.benutzer.rolle;
  if (!['polier', 'bauleiter'].includes(rolle)) return false;
  const bsMap = cache.bs || (cache.bs = new Map(db.alle('SELECT id, polier_id, bauleiter_id FROM baustelle').map((b) => [b.id, b])));
  if (m.baustelle_id && baustelleImBereich(ctx.benutzer, bsMap.get(m.baustelle_id))) return true;
  if (rolle === 'polier') {
    const melder = cache.melder || (cache.melder = new Map(db.alle('SELECT id, baustelle_id FROM benutzer').map((b) => [b.id, b.baustelle_id])));
    const stamm = melder.get(m.gemeldet_von);
    if (stamm && baustelleImBereich(ctx.benutzer, bsMap.get(stamm))) return true;
  }
  return false;
}

function fotoJson(f, namen) {
  return { id: f.id, dateiname: f.dateiname, mime: f.mime, groesse: f.groesse, erstellt: f.erstellt, erstelltVon: person(namen, f.erstellt_von), url: `/api/fuhrpark/schaeden/${f.mangel_id}/fotos/${f.id}` };
}

function schadenJson(db, m, S, ctx) {
  const A = m.anlage_id ? S.anlagen.get(m.anlage_id) : null;
  const bs = m.baustelle_id ? S.baustellen.get(m.baustelle_id) : null;
  const fotos = db.alle('SELECT * FROM schaden_foto WHERE mangel_id = ? ORDER BY id', m.id);
  let eintrag;
  if (m.eintrag_id) {
    const e = db.eins('SELECT id, art, datum, titel, kosten FROM servicebuch_eintrag WHERE id = ?', m.eintrag_id);
    if (e) { eintrag = { id: e.id, art: e.art, datum: e.datum, titel: e.titel }; if (euro(ctx) && e.kosten != null) eintrag.kosten = e.kosten; }
  }
  const status = SCHADEN_STATUS[m.status];
  const offen = ['gemeldet', 'in_bearbeitung'].includes(status);
  return {
    id: m.id, clientId: m.client_id, anlageId: m.anlage_id,
    anlage: A ? { id: A.row.id, nummer: A.row.nummer, bezeichnung: A.row.bezeichnung, kennzeichen: A.row.kennzeichen, status: A.status.status, gesperrt: A.status.gesperrt } : null,
    fremdGeraet: m.fremd_geraet, baustelleId: m.baustelle_id, ...(bs ? { baustelle: { id: bs.id, kst: bs.kst, name: bs.kurz || bs.name } } : {}),
    zeitpunkt: m.zeitpunkt, art: m.schaden_art, ursache: m.text, beschreibung: m.beschreibung, einsatzfaehig: m.einsatzfaehig,
    status, kommentar: m.notiz, eintragId: m.eintrag_id, ...(eintrag ? { eintrag } : {}),
    gemeldet: m.gemeldet, gemeldetVon: person(S.namen, m.gemeldet_von), bearbeitet: m.bearbeitet,
    ...(m.bearbeitet_von ? { bearbeitetVon: person(S.namen, m.bearbeitet_von) } : {}),
    fotos: fotos.map((f) => fotoJson(f, S.namen)), version: m.version,
    darfFotos: fotos.length < 5 && ((offen && m.gemeldet_von === ctx.benutzer.id) || istVerwaltung(ctx)),
    darfBearbeiten: istVerwaltung(ctx)
  };
}

/* ---------------- Einträge ---------------- */

function eintragJson(db, e, S, ctx) {
  const A = S.anlagen.get(e.anlage_id);
  const zaehler = db.alle('SELECT s.id, s.anzeige, s.wert, s.status, z.art FROM zaehlerstand s JOIN zaehler z ON z.id = s.zaehler_id WHERE s.eintrag_id = ? ORDER BY z.art', e.id)
    .map((s) => ({ zaehlerstandId: s.id, art: s.art, anzeige: s.anzeige, wert: s.wert, status: s.status }));
  const erledigt = db.alle('SELECT p.id, p.titel FROM eintrag_planposition ep JOIN planposition p ON p.id = ep.planposition_id WHERE ep.eintrag_id = ? ORDER BY p.id', e.id)
    .map((p) => ({ planpositionId: p.id, titel: p.titel }));
  const maengel = db.alle('SELECT id FROM mangel WHERE eintrag_id = ? ORDER BY id', e.id).map((m) => m.id);
  const o = {
    id: e.id, anlageId: e.anlage_id, anlage: A ? { id: A.row.id, nummer: A.row.nummer, bezeichnung: A.row.bezeichnung, kennzeichen: A.row.kennzeichen } : null,
    art: e.art, datum: e.datum, werkstatt: e.werkstatt, titel: e.titel, arbeiten: e.arbeiten, teile: e.teile, arbeitsstundenIntern: e.arbeitsstunden_intern,
    rechnungNr: e.rechnung_nr, pruefErgebnis: e.pruef_ergebnis, pruefer: e.pruefer, zaehler, erledigt, maengel,
    ...(e.storniert ? { storniert: { zeit: e.storniert, grund: e.storno_grund, von: person(S.namen, e.storno_von) } } : {}),
    erfasst: e.erfasst, erfasstVon: person(S.namen, e.erfasst_von), version: e.version
  };
  if (euro(ctx)) o.kosten = e.kosten;
  return o;
}

/** Frist-Element (Fristenliste, Übersicht) */
function fristJson(A, P) {
  const c = P.calc;
  return {
    anlageId: A.row.id, anlage: { nummer: A.row.nummer, bezeichnung: A.row.bezeichnung, kennzeichen: A.row.kennzeichen, klasse: A.row.klasse },
    planpositionId: P.row.id, titel: P.row.titel, art: P.row.art, status: c.status, ampel: c.ampel, naechstesDatum: c.naechstesDatum,
    ...(c.faelligAm ? { faelligAm: c.faelligAm } : {}), ...(c.spaetestens ? { spaetestens: c.spaetestens } : {}),
    ...(c.faelligBei ? { prognoseAm: c.prognoseAm, faelligBei: c.faelligBei, rest: c.rest } : {}),
    grund: c.grund, ...(c.hinweis ? { hinweis: c.hinweis } : {}), pruefen: P.row.vorlage_pruefen === 1
  };
}

/** Alle offenen Fristen aktiver Anlagen (sortiert: überfällig zuerst, dann nach Datum) */
function fristen(S, { bis, klasse, art } = {}) {
  const out = [];
  for (const A of S.liste) {
    if (A.row.ausgeschieden) continue;
    if (klasse && A.row.klasse !== klasse) continue;
    for (const P of A.positionen) {
      if (!P.row.aktiv || P.calc.status === 'erledigt') continue;
      if (art && P.row.art !== art) continue;
      const wichtig = ['bald', 'faellig', 'ueberfaellig', 'unvollstaendig'].includes(P.calc.status);
      if (!wichtig && !(bis && P.calc.naechstesDatum && P.calc.naechstesDatum <= bis)) continue;
      out.push({ A, P });
    }
  }
  const gruppe = (P) => (P.calc.status === 'ueberfaellig' ? 0 : P.calc.status === 'unvollstaendig' ? 2 : 1);
  out.sort((x, y) => gruppe(x.P) - gruppe(y.P) || (x.P.calc.naechstesDatum || '9999').localeCompare(y.P.calc.naechstesDatum || '9999') || x.A.row.bezeichnung.localeCompare(y.A.row.bezeichnung, 'de'));
  return out;
}

/** Text „seit wann gesperrt“ für Hinweise */
function sperrText(A) {
  const g = A.status.sperrGruende[0];
  if (!g) return `${A.row.bezeichnung} ist gesperrt`;
  return `${A.row.bezeichnung}${A.row.kennzeichen ? ' ' + A.row.kennzeichen : ''} ist gesperrt${g.seit ? ' seit ' + deDatum(g.seit) : ''}: ${g.text}`;
}

module.exports = {
  kontextFuer, OFFEN, leserecht, euro, ladeStand, ladeKosten, kostenJeStunde, zaehlerKurz, zaehlerJson, positionJson, terminKurz, anlageListeJson,
  standJson, mangelJson, schadenJson, schadenSichtbar, fotoJson, eintragJson, fristJson, fristen, sperrText, person,
  SCHADEN_STATUS, SCHADEN_STATUS_DB, DRINGLICHKEIT, istVerwaltung
};
