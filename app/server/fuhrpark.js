'use strict';
/**
 * Servicebuch – reine Rechenfunktionen (ohne Datenbank): Zählerstand/Schätzung, Wochenschnitt, Prognose,
 * Fälligkeit je Planposition („was zuerst eintritt“) und Anlagenstatus.
 * Vertrag: SERVICEBUCH_ENTWURF.md Abschnitte 4 und 5, API.md 11.2. Alle Daten 'YYYY-MM-DD' (Europe/Vienna).
 */
const { plusTage, tageZwischen, deDatum, wienDatum } = require('./datum');

const KLASSEN = ['pkw', 'bus', 'lkw', 'anhaenger', 'baumaschine', 'walze', 'brecher', 'kleingeraet', 'sonstiges'];
const ZAEHLER_ARTEN = ['km', 'bh', 'brecher', 'kran', 'hub'];
const STUNDEN_ARTEN = ['bh', 'brecher', 'kran', 'hub'];
const PLAN_ARTEN = ['gesetzlich', 'hersteller', 'intern', 'vertrag'];
const EINHEIT = { km: 'km', bh: 'Std.', brecher: 'Std.', kran: 'Std.', hub: 'Hübe' };
const ZAEHLER_NAME = { km: 'Kilometer', bh: 'Betriebsstunden', brecher: 'Brecherstunden', kran: 'Kranstunden', hub: 'Hubzahl' };
const ZAEHLER_STAND_NAME = { km: 'Kilometerstand', bh: 'Betriebsstundenstand', brecher: 'Brecherstundenstand', kran: 'Kranstundenstand', hub: 'Hubzähler-Stand' };

const RANG = { erledigt: -1, ok: 0, unvollstaendig: 1, bald: 2, faellig: 3, ueberfaellig: 4 };
const STANDARD = { vorlaufTage: 90, toleranzNachTage: 14, vorlaufStunden: 50, vorlaufKm: 2000 };
const MONATSNAMEN = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/* ---------------- Datum ---------------- */

const letzterTagImMonat = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12
const p2 = (n) => String(n).padStart(2, '0');

/** Kalendermonate addieren, Tag auf das Monatsende begrenzt (31.01. + 1 = 28./29.02.) */
function plusMonate(datum, n) {
  const [y, m, d] = datum.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12), nm = (idx % 12) + 1;
  return `${ny}-${p2(nm)}-${p2(Math.min(d, letzterTagImMonat(ny, nm)))}`;
}
const monat = (datum) => datum.slice(0, 7);
function monatPlus(m, n) {
  const [y, mm] = m.split('-').map(Number);
  const idx = y * 12 + (mm - 1) + n;
  return `${Math.floor(idx / 12)}-${p2((idx % 12) + 1)}`;
}
const ersterTag = (m) => `${m}-01`;
function letzterTag(m) {
  const [y, mm] = m.split('-').map(Number);
  return `${m}-${p2(letzterTagImMonat(y, mm))}`;
}
const minDatum = (...d) => d.filter(Boolean).sort()[0] || null;
const monatName = (m) => `${MONATSNAMEN[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

/* ---------------- Zähler ---------------- */

const sortStaende = (a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : a.id - b.id);

/**
 * Aktueller Stand, Schätzung und Wochenschnitt eines Zählers (4.1, 4.3).
 * @param {{art, startstand, startdatum, aus_bericht}} zaehler
 * @param {Array<{id, datum, wert, anzeige, quelle, status}>} staende  alle Stände des Zählers
 * @param {Array<{datum, stunden}>} berichtStunden  der Anlage zugerechnete Gerätestunden (nur unterschrieben/freigegeben)
 * @param {string} H  heute
 */
function zaehlerInfo(zaehler, staende, berichtStunden, H) {
  const gueltig = staende.filter((s) => s.status === 'gueltig' && s.datum <= H).sort(sortStaende);
  const R = gueltig.length ? gueltig[gueltig.length - 1]
    : { id: null, datum: zaehler.startdatum, wert: zaehler.startstand, anzeige: zaehler.startstand, quelle: 'start' };
  const schaetzen = Boolean(zaehler.aus_bericht) && ['bh', 'brecher'].includes(zaehler.art);
  let S = 0;
  if (schaetzen) for (const b of berichtStunden) if (b.datum > R.datum && b.datum <= H) S += b.stunden;
  S = Math.round(S * 100) / 100;
  // Wochenschnitt aus Ablesungen: Fenster 56 Tage + letzter Stand davor
  const grenze = plusTage(H, -56);
  const imFenster = gueltig.filter((s) => s.datum >= grenze);
  const davor = gueltig.filter((s) => s.datum < grenze);
  const fenster = davor.length ? [davor[davor.length - 1], ...imFenster] : imFenster;
  let wochenschnitt = null, schnittQuelle = null;
  if (fenster.length >= 2) {
    const A = fenster[0], B = fenster[fenster.length - 1];
    const tage = tageZwischen(A.datum, B.datum);
    if (tage >= 14) { wochenschnitt = r1(((B.wert - A.wert) / tage) * 7); schnittQuelle = 'ablesung'; }
  }
  if (wochenschnitt === null && schaetzen) {
    let s56 = 0;
    for (const b of berichtStunden) if (b.datum > grenze && b.datum <= H) s56 += b.stunden;
    wochenschnitt = r1(s56 / 8);
    schnittQuelle = 'bericht';
  }
  return {
    aktuell: Math.round((R.wert + S) * 100) / 100,
    geschaetzt: S > 0,
    letzterStand: { id: R.id, wert: R.wert, anzeige: R.anzeige, datum: R.datum, quelle: R.quelle },
    wochenschnitt,
    schnittQuelle,
    berichtStundenSeitStand: S
  };
}

/** Prognose: an welchem Tag ist der Rest verbraucht? (4.3) */
function prognose(rest, wochenschnitt, H) {
  if (rest <= 0) return H;
  if (wochenschnitt > 0) return plusTage(H, Math.ceil(rest / (wochenschnitt / 7) - 1e-9));
  return null;
}

/* ---------------- Regel ---------------- */

const DATUM_KRITERIEN = ['intervallMonate', 'intervallTage', 'folgeMonate', 'jaehrlichAm', 'einmaligAm'];
const REGEL_FELDER = {
  intervallMonate: 'int', intervallTage: 'int', folgeMonate: 'intliste', jaehrlichAm: 'mmdd', einmaligAm: 'datum',
  monatsgenau: 'bool', toleranzVorMonate: 'int0', toleranzNachMonate: 'int0', toleranzNachTage: 'int0',
  intervallStunden: 'zahl', zaehlerArtStunden: 'stundenart', intervallKm: 'zahl', vorlaufTage: 'int0',
  vorlaufStunden: 'zahl0', vorlaufKm: 'zahl0', sperrtBeiUeberfaellig: 'bool', schliesstEin: 'textliste',
  datumAus: 'datumAus', stichtagJeAnlage: 'bool'
};

/**
 * Prüft eine Regel (5.1). Liefert eine bereinigte Kopie oder wirft Error(text).
 * @param {object} regel
 * @param {{vorlage?: boolean}} opt  Vorlage: Platzhalter datumAus/stichtagJeAnlage erlaubt
 */
function pruefeRegel(regel, { vorlage = false } = {}) {
  if (!regel || typeof regel !== 'object' || Array.isArray(regel)) throw new Error('regel muss ein Objekt sein.');
  const out = {};
  for (const [k, v] of Object.entries(regel)) {
    if (v === null || v === undefined || v === '') continue;
    const typ = REGEL_FELDER[k];
    if (!typ) throw new Error(`regel.${k} ist unbekannt.`);
    const fehler = () => new Error(`regel.${k} ist ungültig.`);
    switch (typ) {
      case 'int': if (!Number.isInteger(v) || v < 1 || v > 3650) throw fehler(); break;
      case 'int0': if (!Number.isInteger(v) || v < 0 || v > 3650) throw fehler(); break;
      case 'zahl': if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 1e7) throw fehler(); break;
      case 'zahl0': if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e7) throw fehler(); break;
      case 'bool': if (typeof v !== 'boolean') throw fehler(); break;
      case 'intliste': if (!Array.isArray(v) || !v.length || v.length > 20 || v.some((x) => !Number.isInteger(x) || x < 1 || x > 240)) throw fehler(); break;
      case 'textliste': if (!Array.isArray(v) || v.length > 20 || v.some((x) => typeof x !== 'string' || !/^[a-z0-9_]{1,40}$/.test(x))) throw fehler(); break;
      case 'mmdd': {
        const m = /^(\d{2})-(\d{2})$/.exec(String(v));
        if (!m || +m[1] < 1 || +m[1] > 12 || +m[2] < 1 || +m[2] > letzterTagImMonat(2024, +m[1])) throw fehler();
        break;
      }
      case 'datum': if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || plusTage(v, 0) !== v) throw fehler(); break;
      case 'stundenart': if (!STUNDEN_ARTEN.includes(v)) throw fehler(); break;
      case 'datumAus': if (v !== 'vertragsende') throw fehler(); break;
      default: throw fehler();
    }
    if ((k === 'datumAus' || k === 'stichtagJeAnlage') && !vorlage) continue; // Platzhalter nur in Vorlagen
    out[k] = Array.isArray(v) ? [...v] : v;
  }
  const datum = DATUM_KRITERIEN.filter((k) => out[k] !== undefined);
  if (datum.length > 1) throw new Error(`regel: nur ein Datumskriterium erlaubt (${datum.join(', ')}).`);
  const platzhalter = vorlage && (out.datumAus || out.stichtagJeAnlage);
  if (!datum.length && !out.intervallStunden && !out.intervallKm && !platzhalter) {
    throw new Error('regel: mindestens ein Kriterium (Datum, Stunden oder Kilometer) ist Pflicht.');
  }
  if (out.zaehlerArtStunden && !out.intervallStunden) throw new Error('regel.zaehlerArtStunden nur zusammen mit intervallStunden.');
  return out;
}

/** Benötigte Zählerarten einer Regel */
function zaehlerArtenDerRegel(regel) {
  const a = [];
  if (regel.intervallStunden) a.push(regel.zaehlerArtStunden || 'bh');
  if (regel.intervallKm) a.push('km');
  return a;
}

/* ---------------- Fälligkeit ---------------- */

function datumsStatus(H, faelligAm, spaetestens, vorlauf) {
  if (H > spaetestens) return 'ueberfaellig';
  if (H >= faelligAm) return 'faellig';
  if (H >= plusTage(faelligAm, -vorlauf)) return 'bald';
  return 'ok';
}

/**
 * A) Datumskriterium (5.2 A).
 * @param {object} regel
 * @param {{H, letzteDatum?, erstzulassung?, basisErsatz?, bezugDatum?}} k  basisErsatz = Zähler-Startdatum bzw. Anlagedatum;
 *   bezugDatum = fester Bezugspunkt der Position ohne letzte Durchführung (Anlage der Position, F-02) – fehlt er: H
 */
function datumsKriterium(regel, k) {
  const H = k.H;
  const vorlaufTage = regel.vorlaufTage ?? STANDARD.vorlaufTage;
  const tolNachTage = regel.toleranzNachTage ?? STANDARD.toleranzNachTage;
  const letzte = k.letzteDatum || null;
  const o = { typ: 'datum' };

  if (regel.folgeMonate) {
    if (!k.erstzulassung) return { ...o, status: 'unvollstaendig', hinweis: 'Erstzulassung fehlt – Termin nicht berechenbar.' };
    const f = regel.folgeMonate;
    const vor = regel.toleranzVorMonate ?? 0, nach = regel.toleranzNachMonate ?? 0;
    const EZ = monat(k.erstzulassung), L = letzte ? monat(letzte) : null, B = monat(k.bezugDatum || H);
    let S = EZ, fk = f[0];
    if (L) {
      for (let i = 0; i < 600; i++) {
        fk = f[Math.min(i, f.length - 1)];
        S = monatPlus(S, fk);
        if (monatPlus(S, -vor) > L) break;
      }
    } else {
      // F-02: ohne erfasste Durchführung gilt der jüngste Termin, dessen Fenster zum Bezugspunkt schon offen war
      // (sonst der erste Termin) – fest, wandert nicht mit „heute“ mit.
      let x = EZ, kand = null, kandF = f[0];
      for (let i = 0; i < 600; i++) {
        const fi = f[Math.min(i, f.length - 1)];
        x = monatPlus(x, fi);
        if (monatPlus(x, -vor) > B) { if (!kand) { kand = x; kandF = fi; } break; }
        kand = x; kandF = fi;
      }
      S = kand; fk = kandF;
    }
    const faelligAm = ersterTag(S);
    const spaetestens = letzterTag(monatPlus(S, nach));
    const vorlauf = Math.min(vorlaufTage, Math.floor((fk * 30.44) / 3));
    return {
      ...o, faelligAm, fruehestens: ersterTag(monatPlus(S, -vor)), spaetestens, monatsgenau: true, vorlaufTage: vorlauf,
      zyklus: S, status: datumsStatus(H, faelligAm, spaetestens, vorlauf)
    };
  }

  if (regel.intervallMonate || regel.intervallTage) {
    const basis = letzte || k.erstzulassung || k.basisErsatz;
    if (!basis) return { ...o, status: 'unvollstaendig', hinweis: 'Kein Ausgangsdatum (letzte Durchführung) bekannt.' };
    const mg = Boolean(regel.monatsgenau);
    let faelligAm = regel.intervallMonate ? plusMonate(basis, regel.intervallMonate) : plusTage(basis, regel.intervallTage);
    if (mg) faelligAm = ersterTag(monat(faelligAm));
    let spaetestens = regel.toleranzNachMonate != null ? plusMonate(faelligAm, regel.toleranzNachMonate) : plusTage(faelligAm, tolNachTage);
    if (mg) spaetestens = letzterTag(monat(spaetestens));
    const dauer = regel.intervallMonate ? regel.intervallMonate * 30.44 : regel.intervallTage;
    const vorlauf = Math.min(vorlaufTage, Math.floor(dauer / 3));
    const r = { ...o, faelligAm, spaetestens, vorlaufTage: vorlauf, zyklus: mg ? monat(faelligAm) : faelligAm, status: datumsStatus(H, faelligAm, spaetestens, vorlauf) };
    if (mg && regel.toleranzVorMonate) r.fruehestens = ersterTag(monatPlus(monat(faelligAm), -regel.toleranzVorMonate));
    if (mg) r.monatsgenau = true;
    return r;
  }

  if (regel.jaehrlichAm) {
    const vorlauf = Math.min(vorlaufTage, Math.floor(365 / 3));
    const [mm, dd] = regel.jaehrlichAm.split('-').map(Number);
    const amJahr = (y) => `${y}-${p2(mm)}-${p2(Math.min(dd, letzterTagImMonat(y, mm)))}`;
    let D;
    if (letzte) {
      let y = Number(letzte.slice(0, 4)) - 1;
      for (let i = 0; i < 200; i++) { D = amJahr(y); if (plusTage(D, -vorlauf) > letzte) break; y++; }
    } else {
      // F-02: jüngster Stichtag, dessen Vorlauf zum Bezugspunkt schon begonnen hatte (fest)
      const B = k.bezugDatum || H;
      let y = Number(B.slice(0, 4)) + 1;
      for (let i = 0; i < 200; i++) { D = amJahr(y); if (plusTage(D, -vorlauf) <= B) break; y--; }
    }
    const spaetestens = plusTage(D, tolNachTage);
    return { ...o, faelligAm: D, spaetestens, vorlaufTage: vorlauf, zyklus: D, status: datumsStatus(H, D, spaetestens, vorlauf) };
  }

  if (regel.einmaligAm) {
    const faelligAm = regel.einmaligAm;
    const spaetestens = plusTage(faelligAm, tolNachTage);
    // erledigt, wenn nach Anlage der Frist durchgeführt (F-15)
    if (letzte && (!k.bezugDatum || letzte >= k.bezugDatum)) return { ...o, faelligAm, spaetestens, vorlaufTage, zyklus: faelligAm, status: 'erledigt' };
    return { ...o, faelligAm, spaetestens, vorlaufTage, zyklus: faelligAm, status: datumsStatus(H, faelligAm, spaetestens, vorlaufTage) };
  }
  return null;
}

/**
 * B) Zählerkriterium (5.2 B).
 * @param {{art, intervall, vorlauf, vorlaufTage}} p
 * @param {{aktuell, wochenschnitt}|null} zi  Zählerinfo (null = kein Zähler dieser Art)
 * @param {number|null} basisStand
 */
function zaehlerKriterium(p, zi, basisStand, H) {
  const o = { typ: 'zaehler', art: p.art };
  if (!zi) return { ...o, status: 'unvollstaendig', hinweis: `Kein aktiver Zähler „${ZAEHLER_NAME[p.art]}“ an der Anlage.` };
  const faelligBei = Math.round((basisStand + p.intervall) * 100) / 100;
  const rest = Math.round((faelligBei - zi.aktuell) * 100) / 100;
  const prognoseAm = prognose(rest, zi.wochenschnitt, H);
  const vorlaufEffTage = zi.wochenschnitt > 0 ? Math.min(p.vorlaufTage, Math.floor(p.intervall / (zi.wochenschnitt / 7) / 3)) : null;
  let status;
  if (rest < -0.1 * p.intervall) status = 'ueberfaellig';
  else if (rest <= 0) status = 'faellig';
  else if (rest <= p.vorlauf || (prognoseAm && vorlaufEffTage !== null && prognoseAm <= plusTage(H, vorlaufEffTage))) status = 'bald';
  else status = 'ok';
  return { ...o, faelligBei, aktuell: zi.aktuell, geschaetzt: Boolean(zi.geschaetzt), rest, prognoseAm, vorlaufTage: vorlaufEffTage, zyklus: `${p.art}${Math.round(faelligBei)}`, status };
}

const kriteriumDatum = (k) => (k.typ === 'datum' ? k.faelligAm : k.prognoseAm) || null;
const kriteriumGrund = (k) => (k.typ === 'datum' ? 'Datum' : ZAEHLER_NAME[k.art]);

/** C) Zusammenführen: schlechtester Status, frühestes Datum (5.2 C) */
function zusammenfuehren(kriterien) {
  if (!kriterien.length) return { status: 'unvollstaendig', grund: null, naechstesDatum: null, hinweis: 'Kein Kriterium.' };
  const sortiert = [...kriterien].sort((a, b) => {
    const r = RANG[b.status] - RANG[a.status];
    if (r) return r;
    const da = kriteriumDatum(a), dbb = kriteriumDatum(b);
    if (da && dbb) return da < dbb ? -1 : da > dbb ? 1 : 0;
    return da ? -1 : dbb ? 1 : 0;
  });
  const massgeblich = sortiert[0];
  const daten = kriterien.filter((k) => k.status !== 'erledigt').map(kriteriumDatum).filter(Boolean);
  return {
    status: massgeblich.status,
    grund: kriteriumGrund(massgeblich),
    massgeblich,
    naechstesDatum: daten.length ? minDatum(...daten) : null,
    hinweis: kriterien.map((k) => k.hinweis).filter(Boolean).join(' ') || undefined
  };
}

const AMPEL_POSITION = { ueberfaellig: 'rot', faellig: 'rot', bald: 'gelb', unvollstaendig: 'gelb', ok: 'gruen', erledigt: 'gruen' };

/**
 * Fälligkeit einer Planposition.
 * @param {object} pos  {regel (Objekt), letzteDatum, letzteZaehler (Objekt|null)}
 * @param {object} ctx  {H, erstzulassung, basisErsatz, zaehler: {art → {info, standAm(datum)→wert|null, startstand}}}
 */
function berechnePosition(pos, ctx) {
  const regel = pos.regel || {};
  const H = ctx.H;
  const kriterien = [];
  const d = datumsKriterium(regel, { H, letzteDatum: pos.letzteDatum, erstzulassung: ctx.erstzulassung, basisErsatz: ctx.basisErsatz, bezugDatum: pos.bezugDatum });
  if (d) kriterien.push(d);
  const vorlaufTage = regel.vorlaufTage ?? STANDARD.vorlaufTage;
  const zk = [];
  if (regel.intervallStunden) zk.push({ art: regel.zaehlerArtStunden || 'bh', intervall: regel.intervallStunden, vorlauf: regel.vorlaufStunden ?? STANDARD.vorlaufStunden, vorlaufTage });
  if (regel.intervallKm) zk.push({ art: 'km', intervall: regel.intervallKm, vorlauf: regel.vorlaufKm ?? STANDARD.vorlaufKm, vorlaufTage });
  for (const p of zk) {
    const z = (ctx.zaehler || {})[p.art];
    let basis = null;
    if (z) {
      const lz = pos.letzteZaehler || {};
      basis = lz[p.art] ?? (pos.letzteDatum ? z.standAm(pos.letzteDatum) : null) ?? z.startstand;
    }
    kriterien.push(zaehlerKriterium(p, z ? z.info : null, basis, H));
  }
  const c = zusammenfuehren(kriterien);
  const o = {
    status: c.status, ampel: AMPEL_POSITION[c.status], grund: c.grund, naechstesDatum: c.naechstesDatum,
    sperrt: Boolean(regel.sperrtBeiUeberfaellig), kriterien
  };
  if (c.hinweis) o.hinweis = c.hinweis;
  if (d && d.faelligAm) {
    o.faelligAm = d.faelligAm;
    if (d.fruehestens) o.fruehestens = d.fruehestens;
    o.spaetestens = d.spaetestens;
  }
  const zMass = kriterien.filter((k) => k.typ === 'zaehler' && k.faelligBei !== undefined)
    .sort((a, b) => RANG[b.status] - RANG[a.status] || ((a.prognoseAm || '9') < (b.prognoseAm || '9') ? -1 : 1))[0];
  if (zMass) {
    o.faelligBei = { art: zMass.art, wert: zMass.faelligBei };
    o.rest = { art: zMass.art, wert: zMass.rest };
    o.prognoseAm = zMass.prognoseAm;
  }
  o.zyklus = c.massgeblich && c.massgeblich.zyklus ? c.massgeblich.zyklus : null;
  return o;
}

/* ---------------- Anlagenstatus (5.2 D) ---------------- */

/**
 * @param {{ausgeschieden, gesperrt, sperr_grund, gesperrt_seit}} anlage
 * @param {Array<{status, sperrt, titel, spaetestens?}>} positionen  berechnete aktive Positionen
 * @param {Array<{typ, text, dringlichkeit, gemeldet}>} sperrMaengel  offene Mängel/Schäden mit dringlichkeit 'sofort'
 */
function anlagenStatus(anlage, positionen, sperrMaengel = []) {
  if (anlage.ausgeschieden) return { status: 'ausgeschieden', ampel: 'grau', gesperrt: false, sperrGruende: [] };
  const gruende = [];
  if (anlage.gesperrt) gruende.push({ typ: anlage.sperr_typ || 'manuell', text: anlage.sperr_grund || 'Gesperrt', seit: anlage.gesperrt_seit ? wienDatum(anlage.gesperrt_seit) : undefined });
  for (const m of sperrMaengel) {
    // F-13: Ursache eines Schadens nur im Sichtbereich (Schadensdetail) – im Sperrgrund ein neutraler Text
    gruende.push({ typ: m.typ === 'schaden' ? 'schaden' : 'mangel', text: m.typ === 'schaden' ? 'Schaden gemeldet – nicht einsatzfähig' : m.text, seit: m.gemeldet ? wienDatum(m.gemeldet) : undefined, ...(m.id ? { [m.typ === 'schaden' ? 'schadenId' : 'mangelId']: m.id } : {}) });
  }
  for (const p of positionen) {
    if (p.sperrt && p.status === 'ueberfaellig') gruende.push({ typ: 'frist', text: `${p.titel} überfällig`, seit: p.spaetestens ? plusTage(p.spaetestens, 1) : undefined, planpositionId: p.id });
  }
  for (const g of gruende) if (g.seit === undefined) delete g.seit;
  const schlechteste = positionen.reduce((a, p) => Math.max(a, RANG[p.status] ?? 0), 0);
  if (gruende.length) return { status: 'gesperrt', ampel: 'rot', gesperrt: true, sperrGruende: gruende, positionsStatus: schlechteste };
  if (schlechteste >= RANG.faellig) return { status: 'faellig', ampel: 'rot', gesperrt: false, sperrGruende: [] };
  if (schlechteste >= RANG.bald) return { status: 'bald', ampel: 'gelb', gesperrt: false, sperrGruende: [] };
  return { status: 'einsatzbereit', ampel: 'gruen', gesperrt: false, sperrGruende: [] };
}

/* ---------------- Plausibilität (4.2) ---------------- */

/** Grenze Zuwachs je Tag */
function zuwachsGrenze(art, klasse) {
  if (art === 'km') return klasse === 'lkw' ? 1500 : 1200;
  if (art === 'hub') return 2000;
  return 24;
}

/** Zahl deutsch mit Tausenderpunkt: 4150 → "4.150", 22.5 → "22,5" */
function zahlDe(x, st = 1) {
  if (x == null || !Number.isFinite(Number(x))) return '–';
  const f = 10 ** st;
  const n = Math.round(Math.abs(Number(x)) * f) / f;
  const [ganz, nk] = String(n).split('.');
  return (Number(x) < 0 && n !== 0 ? '-' : '') + ganz.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (nk ? ',' + nk : '');
}

/**
 * Prüft einen neuen Zählerstand gegen Vorgänger/Nachfolger (4.2, Regeln 2–5).
 * @param {{art, klasse, aus_bericht}} z
 * @param {Array} staende  bestehende Stände (alle Status) – der geprüfte Stand selbst nicht enthalten
 * @param {{datum, wert}} neu
 * @param {Array<{datum, stunden}>} berichtStunden
 * @returns {{fehler?: string, status: 'gueltig'|'unplausibel', hinweis?: string, warnung?: string}}
 */
function pruefeZaehlerstand(z, staende, neu, berichtStunden = []) {
  const gueltig = staende.filter((s) => s.status === 'gueltig').sort(sortStaende);
  const vor = gueltig.filter((s) => s.datum <= neu.datum);
  const P = vor.length ? vor[vor.length - 1] : null;
  const N = gueltig.find((s) => s.datum > neu.datum) || null;
  const einheit = EINHEIT[z.art];
  if (!P) return { fehler: 'Das Datum liegt vor dem Beginn der Zählererfassung.' };
  if (neu.wert < P.wert) {
    return { fehler: `Zählerstand kleiner als am ${deDatum(P.datum)} (${zahlDe(P.anzeige)} ${einheit}) – bei Zählertausch bitte das Büro verständigen.` };
  }
  if (N && neu.wert > N.wert) {
    return { fehler: `Zählerstand größer als der spätere Stand am ${deDatum(N.datum)} (${zahlDe(N.anzeige)} ${einheit}) – bitte Datum und Wert prüfen.` };
  }
  const tage = Math.max(1, tageZwischen(P.datum, neu.datum));
  const zuwachs = neu.wert - P.wert;
  const jeTag = zuwachs / tage;
  const grenze = zuwachsGrenze(z.art, z.klasse);
  const o = { status: 'gueltig' };
  if (jeTag > grenze) {
    o.status = 'unplausibel';
    o.hinweis = `Unplausibel: +${zahlDe(zuwachs)} ${einheit} in ${tage} ${tage === 1 ? 'Tag' : 'Tagen'} (mehr als ${zahlDe(grenze, 0)} ${einheit} je Tag) – wird vom Büro geprüft.`;
    o.warnung = o.hinweis;
    return o;
  }
  if (z.aus_bericht && ['bh', 'brecher'].includes(z.art)) {
    let S = 0;
    for (const b of berichtStunden) if (b.datum > P.datum && b.datum <= neu.datum) S += b.stunden;
    if (S >= 30 && (zuwachs / S < 0.5 || zuwachs / S > 2)) {
      o.hinweis = `Abgelesen +${zahlDe(zuwachs)} ${einheit}, laut Bautagesberichten +${zahlDe(S)} ${einheit} – Gerätestunden prüfen`;
    }
  }
  return o;
}

module.exports = {
  KLASSEN, ZAEHLER_ARTEN, STUNDEN_ARTEN, PLAN_ARTEN, EINHEIT, ZAEHLER_NAME, ZAEHLER_STAND_NAME, RANG, STANDARD, DATUM_KRITERIEN,
  plusMonate, monat, monatPlus, ersterTag, letzterTag, monatName, deDatum, zahlDe,
  zaehlerInfo, prognose, pruefeRegel, zaehlerArtenDerRegel, datumsKriterium, zaehlerKriterium, zusammenfuehren,
  berechnePosition, anlagenStatus, zuwachsGrenze, pruefeZaehlerstand, AMPEL_POSITION, sortStaende
};
