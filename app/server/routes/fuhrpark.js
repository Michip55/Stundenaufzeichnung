'use strict';
/**
 * Servicebuch für Fahrzeuge und Geräte – Routen unter /api/fuhrpark (SERVICEBUCH_ENTWURF.md 8, API.md 11).
 * Rechte: Kurzinfo/Zählerstand/Mangel/Schaden alle; Leserecht = fuhrpark oder bericht_erstellen; Pflege = fuhrpark;
 * € nur mit preise_sehen (Antworten werden ohne Recht gar nicht erst mit €-Feldern aufgebaut).
 */
const fs = require('node:fs');
const v = require('../validierung');
const { ungueltig, keinZugriff, nichtGefunden, konflikt } = require('../fehler');
const { wienDatum, plusTage, tageZwischen, deDatum } = require('../datum');
const { parseJson } = require('../daten');
const F = require('../fuhrpark');
const D = require('../fuhrpark-daten');
const E = require('../fuhrpark-erinnerung');
const B = require('../fuhrpark-bild');
const { vorlagePasst, EMPFOHLEN } = require('../fuhrpark-vorlagen');
const X = require('../fuhrpark-export');
const { brauche } = require('./hilfe');

const EIGENTUM = ['eigen', 'leasing', 'miete'];
const EINTRAG_ARTEN = ['service', 'reparatur', 'pruefung', 'reifen', 'sonstiges'];
const PRUEF = ['ohne_maengel', 'leichte_maengel', 'schwere_maengel'];
const DRING = ['hinweis', 'bald', 'sofort'];
const MANGEL_STATUS = ['offen', 'in_arbeit', 'behoben', 'verworfen'];
const SCHADEN_ARTEN = ['defekt', 'verschleiss', 'unfall', 'beschaedigung_dritte', 'sonstiges'];
const EINSATZ = ['ja', 'eingeschraenkt', 'nein'];
const SCHADEN_UEBERGANG = { gemeldet: ['in_bearbeitung', 'behoben', 'abgelehnt'], in_bearbeitung: ['behoben', 'abgelehnt'], behoben: ['in_bearbeitung'], abgelehnt: ['in_bearbeitung'] };

/** Feldbeschreibung der Anlage: camelCase → [Spalte, Prüfung] */
const ANLAGE_FELDER = {
  nummer: ['nummer', (x) => v.text(x, 'nummer', { max: 20, pflicht: false })],
  bezeichnung: ['bezeichnung', (x) => v.text(x, 'bezeichnung', { max: 200 })],
  klasse: ['klasse', (x) => v.auswahl(x, 'klasse', F.KLASSEN)],
  fahrzeugklasse: ['fahrzeugklasse', (x) => { const t = v.text(x, 'fahrzeugklasse', { max: 10, pflicht: false }); if (t && !/^[A-Z0-9]{1,6}$/i.test(t)) throw ungueltig('fahrzeugklasse ist ungültig (z. B. M1, N3, O4).'); return t ? t.toUpperCase() : null; }],
  hersteller: ['hersteller', (x) => v.text(x, 'hersteller', { max: 100, pflicht: false })],
  typ: ['typ', (x) => v.text(x, 'typ', { max: 100, pflicht: false })],
  kennzeichen: ['kennzeichen', (x) => { const t = v.text(x, 'kennzeichen', { max: 20, pflicht: false }); return t ? t.toUpperCase().replace(/\s+/g, ' ') : null; }],
  fin: ['fin', (x) => { const t = v.text(x, 'fin', { max: 40, pflicht: false }); return t ? t.toUpperCase() : null; }],
  baujahr: ['baujahr', (x) => v.zahl(x, 'baujahr', { min: 1950, max: 2100, ganz: true, pflicht: false })],
  erstzulassung: ['erstzulassung', (x) => v.datum(x, 'erstzulassung', { pflicht: false })],
  hzgKg: ['hzg_kg', (x) => v.zahl(x, 'hzgKg', { min: 0, max: 200000, ganz: true, pflicht: false })],
  eigentum: ['eigentum', (x) => v.auswahl(x, 'eigentum', EIGENTUM)],
  vertragsende: ['vertragsende', (x) => v.datum(x, 'vertragsende', { pflicht: false })],
  versicherung: ['versicherung', (x) => v.text(x, 'versicherung', { max: 300, pflicht: false })],
  geraetId: ['geraet_id', null],
  verantwortlichId: ['verantwortlich_id', null],
  standortBaustelleId: ['standort_baustelle_id', null],
  standortText: ['standort_text', (x) => v.text(x, 'standortText', { max: 200, pflicht: false })],
  notiz: ['notiz', (x) => v.text(x, 'notiz', { max: 2000, pflicht: false })]
};

module.exports = function fuhrparkRouten(api, bt) {
  const { db } = bt;
  const zeit = () => bt.uhr().toISOString();
  const heute = () => wienDatum(bt.uhr());
  const stand = () => D.ladeStand(db, heute());
  const pruefen = () => E.pruefeFuhrparkSicher(bt);
  const protokoll = (req, art, objekt, text, alt, neu) => db.protokolliere({ zeit: zeit(), benutzerId: req.ctx.benutzer.id, art, objekt, text, alt, neu });
  const lese = (req, res, next) => (D.leserecht(req.ctx) ? next() : next(keinZugriff('Das Servicebuch ist für Ihre Rolle nicht freigeschaltet.')));
  const pflege = brauche('fuhrpark');
  const R = '/fuhrpark';

  function anlageAus(S, idText) {
    const id = v.pfadId(idText, 'Anlagen-ID');
    const A = S.anlagen.get(id);
    if (!A) throw nichtGefunden('Anlage nicht gefunden.');
    return A;
  }
  function aktiveAnlage(S, id, feld = 'anlageId') {
    const A = S.anlagen.get(v.id(id, feld));
    if (!A) throw ungueltig('Anlage nicht gefunden.');
    if (A.row.ausgeschieden) throw ungueltig(`${A.row.bezeichnung} ist ausgeschieden.`);
    return A;
  }
  function pruefeVersion(body, row, was) {
    const version = v.zahl(body.version, 'version', { min: 1, max: 1e9, ganz: true });
    if (version !== row.version) throw konflikt(`${was} wurde inzwischen von jemand anderem geändert. Bitte neu laden – Ihre Änderung wurde nicht gespeichert.`, { version: row.version });
  }
  const grund = (x, pflicht = true) => v.text(x, 'grund', { max: 500, min: 3, pflicht });

  /* ================= Anlagen ================= */

  function anlageDetail(S, A, ctx) {
    const kosten = D.euro(ctx) ? D.ladeKosten(db, S.H) : null;
    const a = A.row;
    const o = D.anlageListeJson(S, A, ctx, kosten);
    Object.assign(o, {
      hersteller: a.hersteller, typ: a.typ, fin: a.fin, baujahr: a.baujahr, erstzulassung: a.erstzulassung, hzgKg: a.hzg_kg, eigentum: a.eigentum,
      vertragsende: a.vertragsende, versicherung: a.versicherung, notiz: a.notiz, ausgeschieden: a.ausgeschieden,
      verantwortlichId: a.verantwortlich_id, standortBaustelleId: a.standort_baustelle_id, standortText: a.standort_text,
      ...(a.gesperrt ? { sperre: { grund: a.sperr_grund, seit: a.gesperrt_seit, von: D.person(S.namen, a.gesperrt_von) } } : {}),
      erstellt: a.erstellt, version: a.version, leserecht: D.leserecht(ctx),
      zaehler: A.zaehler.map(D.zaehlerJson),
      naechsteTermine: A.naechste.slice(0, 3).map(D.terminKurz)
    });
    const lr = D.leserecht(ctx);
    o.maengel = A.maengel.filter((m) => m.typ === 'mangel' && (lr || m.gemeldet_von === ctx.benutzer.id)).map((m) => D.mangelJson(m, S));
    const cache = {};
    o.schaeden = A.maengel.filter((m) => m.typ === 'schaden' && D.schadenSichtbar(db, ctx, m, cache)).map((m) => D.schadenJson(db, m, S, ctx));
    if (lr) {
      o.plan = A.positionen.map((P) => D.positionJson(P, a.id));
      o.letzteEintraege = db.alle('SELECT * FROM servicebuch_eintrag WHERE anlage_id = ? ORDER BY datum DESC, id DESC LIMIT 5', a.id).map((e) => D.eintragJson(db, e, S, ctx));
    }
    if (kosten) {
      o.kostenGesamt = kosten.gesamt.get(a.id) || 0;
      o.kostenJeStunde = D.kostenJeStunde(A, kosten, S.H);
      const g = a.geraet_id ? S.geraete.get(a.geraet_id) : null;
      o.verrechnungssatz = g ? g.verrechnungssatz : null;
    }
    return o;
  }

  api.get(`${R}/anlagen`, (req, res) => {
    const S = stand();
    const q = req.query;
    const klasse = q.klasse ? v.auswahl(String(q.klasse), 'klasse', F.KLASSEN) : null;
    const status = q.status ? v.auswahl(String(q.status), 'status', ['einsatzbereit', 'bald', 'faellig', 'gesperrt', 'ausgeschieden']) : null;
    const suche = q.suche ? String(q.suche).trim().toLowerCase().slice(0, 100) : '';
    const inaktiv = q.inaktiv === '1' || status === 'ausgeschieden';
    const kosten = D.euro(req.ctx) ? D.ladeKosten(db, S.H) : null;
    const out = [];
    for (const A of S.liste) {
      const a = A.row;
      if (a.ausgeschieden && !inaktiv) continue;
      if (klasse && a.klasse !== klasse) continue;
      if (status && A.status.status !== status) continue;
      if (q.standort) {
        if (String(q.standort) === 'ohne' ? A.standort.baustelleId : A.standort.baustelleId !== Number(q.standort)) continue;
      }
      if (q.verantwortlich === 'ich' && a.verantwortlich_id !== req.ctx.benutzer.id) continue;
      if (suche && ![a.nummer, a.bezeichnung, a.kennzeichen, a.fin, a.hersteller, a.typ].some((x) => x && x.toLowerCase().includes(suche))) continue;
      out.push(D.anlageListeJson(S, A, req.ctx, kosten));
    }
    res.json(out);
  });

  api.get(`${R}/anlagen/:id`, (req, res) => {
    const S = stand();
    res.json(anlageDetail(S, anlageAus(S, req.params.id), req.ctx));
  });

  /** Anlagefelder aus dem Body (nur übergebene) → {spalte: wert} */
  function anlageFelder(body, { neu = false } = {}) {
    const set = {};
    for (const [feld, [spalte, pruef]] of Object.entries(ANLAGE_FELDER)) {
      if (body[feld] === undefined) continue;
      if (feld === 'geraetId') {
        const id = body.geraetId === null ? null : v.id(body.geraetId, 'geraetId');
        if (id && !db.eins('SELECT id FROM geraet WHERE id = ?', id)) throw ungueltig('Gerät (geraetId) nicht gefunden.');
        set[spalte] = id;
      } else if (feld === 'verantwortlichId') {
        const id = body.verantwortlichId === null ? null : v.id(body.verantwortlichId, 'verantwortlichId');
        if (id && !db.eins('SELECT id FROM benutzer WHERE id = ? AND aktiv = 1', id)) throw ungueltig('Verantwortliche Person nicht gefunden.');
        set[spalte] = id;
      } else if (feld === 'standortBaustelleId') {
        const id = body.standortBaustelleId === null ? null : v.id(body.standortBaustelleId, 'standortBaustelleId');
        if (id && !db.eins('SELECT id FROM baustelle WHERE id = ?', id)) throw ungueltig('Baustelle (standortBaustelleId) nicht gefunden.');
        set[spalte] = id;
      } else {
        set[spalte] = body[feld] === null && !['bezeichnung', 'klasse', 'eigentum'].includes(feld) ? null : pruef(body[feld]);
      }
    }
    if (neu) {
      if (set.bezeichnung === undefined) throw ungueltig('bezeichnung fehlt.');
      if (set.klasse === undefined) throw ungueltig('klasse fehlt.');
    }
    return set;
  }

  function pruefeEindeutig(set, id = null, alt = {}) {
    const kz = set.kennzeichen !== undefined ? set.kennzeichen : alt.kennzeichen;
    const fin = set.fin !== undefined ? set.fin : alt.fin;
    const nr = set.nummer !== undefined ? set.nummer : alt.nummer;
    if (kz && db.eins('SELECT id FROM anlage WHERE kennzeichen = ? AND ausgeschieden IS NULL AND id IS NOT ?', kz, id)) throw konflikt(`Kennzeichen ${kz} ist bereits einer aktiven Anlage zugeordnet.`);
    if (fin && db.eins('SELECT id FROM anlage WHERE fin = ? AND ausgeschieden IS NULL AND id IS NOT ?', fin, id)) throw konflikt(`FIN/Seriennummer ${fin} ist bereits einer aktiven Anlage zugeordnet.`);
    if (nr && db.eins('SELECT id FROM anlage WHERE nummer = ? AND id IS NOT ?', nr, id)) throw konflikt(`Anlagennummer ${nr} ist bereits vergeben.`);
  }

  function zaehlerAnlegen(anlageId, z, i, H, benutzerId) {
    v.objekt(z, `zaehler[${i}]`);
    const art = v.auswahl(z.art, `zaehler[${i}].art`, F.ZAEHLER_ARTEN);
    const startstand = v.zahl(z.startstand ?? 0, `zaehler[${i}].startstand`, { min: 0, max: 1e9 });
    const startdatum = v.datum(z.startdatum ?? H, `zaehler[${i}].startdatum`);
    if (startdatum > H) throw ungueltig(`zaehler[${i}].startdatum darf nicht in der Zukunft liegen.`);
    const ausBericht = z.ausBericht === undefined ? false : v.bool(z.ausBericht, `zaehler[${i}].ausBericht`);
    if (ausBericht && !['bh', 'brecher'].includes(art)) throw ungueltig('ausBericht ist nur für Betriebs- und Brecherstunden möglich.');
    if (db.eins('SELECT id FROM zaehler WHERE anlage_id = ? AND art = ?', anlageId, art)) throw konflikt(`Die Anlage hat bereits einen Zähler „${F.ZAEHLER_NAME[art]}“.`);
    const zid = db.lauf('INSERT INTO zaehler (anlage_id, art, startstand, startdatum, versatz, aus_bericht, aktiv) VALUES (?, ?, ?, ?, 0, ?, 1)', anlageId, art, startstand, startdatum, ausBericht ? 1 : 0).id;
    db.lauf("INSERT INTO zaehlerstand (zaehler_id, datum, anzeige, wert, quelle, status, erfasst, erfasst_von) VALUES (?, ?, ?, ?, 'start', 'gueltig', ?, ?)", zid, startdatum, startstand, startstand, zeit(), benutzerId);
    return zid;
  }

  /** Regel einer Vorlage für eine Anlage konkretisieren (Platzhalter, Überschreibungen) */
  function regelAusVorlage(vorlage, anlage, ueber = {}, alteRegel = {}) {
    const r = { ...parseJson(vorlage.regel, {}), ...ueber };
    if (r.datumAus === 'vertragsende') {
      delete r.datumAus;
      if (!r.einmaligAm) r.einmaligAm = anlage.vertragsende || alteRegel.einmaligAm;
      if (!r.einmaligAm) throw ungueltig(`${vorlage.titel}: Vertragsende der Anlage fehlt.`);
    }
    if (r.stichtagJeAnlage) {
      delete r.stichtagJeAnlage;
      if (!r.jaehrlichAm) r.jaehrlichAm = alteRegel.jaehrlichAm;
      if (!r.jaehrlichAm) throw ungueltig(`${vorlage.titel}: Stichtag fehlt (regel.jaehrlichAm, z. B. "03-01").`);
    }
    try { return F.pruefeRegel(r); } catch (e) { throw ungueltig(e.message); }
  }

  function pruefeLetzteZaehler(x) {
    if (x === undefined || x === null) return null;
    v.objekt(x, 'letzteZaehler');
    const o = {};
    for (const [k, w] of Object.entries(x)) {
      if (!F.ZAEHLER_ARTEN.includes(k)) throw ungueltig(`letzteZaehler.${k} ist unbekannt.`);
      if (w === null) continue;
      o[k] = v.zahl(w, `letzteZaehler.${k}`, { min: 0, max: 1e9 });
    }
    return Object.keys(o).length ? o : null;
  }

  /** Planposition anlegen (aus Vorlage oder frei) */
  function positionAnlegen(anlage, p, H) {
    let titel, art, regel, vorlageId = null;
    if (p.vorlageSchluessel !== undefined || p.schluessel !== undefined) {
      const schluessel = v.text(p.vorlageSchluessel ?? p.schluessel, 'vorlageSchluessel', { max: 40 });
      const vo = db.eins('SELECT * FROM plan_vorlage WHERE schluessel = ?', schluessel);
      if (!vo) throw ungueltig(`Vorlage ${schluessel} nicht gefunden.`);
      if (db.eins('SELECT id FROM planposition WHERE anlage_id = ? AND vorlage_id = ? AND aktiv = 1', anlage.id, vo.id)) throw konflikt(`${vo.titel} ist für diese Anlage bereits angelegt.`);
      titel = p.titel !== undefined ? v.text(p.titel, 'titel', { max: 200 }) : vo.titel;
      art = vo.art;
      regel = regelAusVorlage(vo, anlage, p.regel ? v.objekt(p.regel, 'regel') : {});
      vorlageId = vo.id;
    } else {
      titel = v.text(p.titel, 'titel', { max: 200 });
      art = v.auswahl(p.art, 'art', F.PLAN_ARTEN);
      try { regel = F.pruefeRegel(v.objekt(p.regel, 'regel')); } catch (e) { if (e.status) throw e; throw ungueltig(e.message); }
    }
    const letzteDatum = v.datum(p.letzteDatum, 'letzteDatum', { pflicht: false });
    if (letzteDatum && letzteDatum > H) throw ungueltig('letzteDatum darf nicht in der Zukunft liegen.');
    const lz = pruefeLetzteZaehler(p.letzteZaehler);
    const lzJ = lz ? JSON.stringify(lz) : null;
    return db.lauf(`INSERT INTO planposition (anlage_id, vorlage_id, titel, art, regel, letzte_datum, letzte_zaehler, start_datum, start_zaehler, aktiv)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`, anlage.id, vorlageId, titel, art, JSON.stringify(regel), letzteDatum, lzJ, letzteDatum, lzJ).id;
  }

  function vorlagenVorschlag(anlage) {
    const arten = db.alle('SELECT art FROM zaehler WHERE anlage_id = ? AND aktiv = 1', anlage.id).map((z) => z.art);
    return db.alle('SELECT * FROM plan_vorlage WHERE aktiv = 1 ORDER BY id').filter((vo) => vorlagePasst(parseJson(vo.klassen, []), anlage, arten))
      .map((vo) => ({
        schluessel: vo.schluessel, titel: vo.titel, art: vo.art, pruefen: vo.pruefen === 1,
        empfohlen: EMPFOHLEN.get(vo.schluessel) !== false && !(vo.schluessel === 'vertrag_leasing' && !anlage.vertragsende) && vo.schluessel !== 'vertrag_versicherung'
      }));
  }

  api.post(`${R}/anlagen`, pflege, (req, res) => {
    const body = v.objekt(req.body);
    const H = heute();
    const set = anlageFelder(body, { neu: true });
    pruefeEindeutig(set);
    const zaehler = body.zaehler === undefined ? [] : v.liste(body.zaehler, 'zaehler', { max: 5 });
    const vorlagen = body.vorlagen === undefined ? null : v.liste(body.vorlagen, 'vorlagen', { max: 30 });
    const id = db.transaktion(() => {
      if (set.standort_baustelle_id !== undefined || set.standort_text !== undefined) set.standort_datum = H;
      const k = Object.keys(set);
      const aid = db.lauf(`INSERT INTO anlage (${k.join(', ')}, erstellt) VALUES (${k.map(() => '?').join(', ')}, ?)`, ...k.map((x) => set[x]), zeit()).id;
      zaehler.forEach((z, i) => zaehlerAnlegen(aid, z, i, H, req.ctx.benutzer.id));
      const anlage = db.eins('SELECT * FROM anlage WHERE id = ?', aid);
      for (const [i, x] of (vorlagen || []).entries()) {
        const p = typeof x === 'string' ? { vorlageSchluessel: x } : v.objekt(x, `vorlagen[${i}]`);
        positionAnlegen(anlage, p, H);
      }
      protokoll(req, 'fuhrpark_anlage', `anlage:${aid}`, `Anlage ${set.bezeichnung} angelegt`, null, set);
      return aid;
    });
    pruefen();
    const S = stand();
    const o = anlageDetail(S, S.anlagen.get(id), req.ctx);
    if (!vorlagen) o.vorlagenVorschlag = vorlagenVorschlag(S.anlagen.get(id).row);
    res.status(201).json(o);
  });

  api.get(`${R}/anlagen/:id/vorlagen-vorschlag`, pflege, (req, res) => {
    const S = stand();
    res.json(vorlagenVorschlag(anlageAus(S, req.params.id).row));
  });

  api.put(`${R}/anlagen/:id`, pflege, (req, res) => {
    const S = stand();
    const A = anlageAus(S, req.params.id);
    const body = v.objekt(req.body);
    pruefeVersion(body, A.row, 'Die Anlage');
    const set = anlageFelder(body);
    let reaktiv = false;
    if (body.ausgeschieden === null && A.row.ausgeschieden) { set.ausgeschieden = null; reaktiv = true; }
    else if (body.ausgeschieden !== undefined && body.ausgeschieden !== null) throw ungueltig('Ausscheiden bitte über POST /fuhrpark/anlagen/:id/ausscheiden.');
    if (!Object.keys(set).length) throw ungueltig('Keine änderbaren Felder angegeben.');
    if (!A.row.ausgeschieden || reaktiv) pruefeEindeutig(set, A.row.id, A.row);
    if (set.standort_baustelle_id !== undefined || set.standort_text !== undefined) set.standort_datum = heute();
    db.transaktion(() => {
      const k = Object.keys(set);
      db.lauf(`UPDATE anlage SET ${k.map((x) => `${x} = ?`).join(', ')}, version = version + 1 WHERE id = ?`, ...k.map((x) => set[x]), A.row.id);
      // Leasing-/Mietende mitführen
      if (set.vertragsende !== undefined && set.vertragsende) {
        for (const P of A.positionen.filter((p) => p.row.vorlage_schluessel === 'vertrag_leasing' && p.row.aktiv)) {
          if (P.regel.einmaligAm === A.row.vertragsende || !P.regel.einmaligAm) db.lauf('UPDATE planposition SET regel = ?, version = version + 1 WHERE id = ?', JSON.stringify({ ...P.regel, einmaligAm: set.vertragsende }), P.row.id);
        }
      }
      const alt = {};
      for (const x of k) alt[x] = A.row[x];
      protokoll(req, 'fuhrpark_anlage', `anlage:${A.row.id}`, `Anlage ${A.row.bezeichnung} geändert${reaktiv ? ' (wieder aktiv)' : ''}`, alt, set);
    });
    pruefen();
    const S2 = stand();
    res.json(anlageDetail(S2, S2.anlagen.get(A.row.id), req.ctx));
  });

  api.post(`${R}/anlagen/:id/sperre`, pflege, (req, res) => {
    const S = stand();
    const A = anlageAus(S, req.params.id);
    const body = v.objekt(req.body);
    const gesperrt = v.bool(body.gesperrt, 'gesperrt');
    const g = grund(body.grund);
    const z = zeit();
    db.transaktion(() => {
      if (gesperrt) db.lauf("UPDATE anlage SET gesperrt = 1, sperr_grund = ?, sperr_typ = 'manuell', gesperrt_seit = ?, gesperrt_von = ?, version = version + 1 WHERE id = ?", g, z, req.ctx.benutzer.id, A.row.id);
      else db.lauf('UPDATE anlage SET gesperrt = 0, sperr_grund = NULL, sperr_typ = NULL, gesperrt_seit = NULL, gesperrt_von = NULL, version = version + 1 WHERE id = ?', A.row.id);
      protokoll(req, 'fuhrpark_sperre', `anlage:${A.row.id}`, `${A.row.bezeichnung} ${gesperrt ? 'gesperrt' : 'entsperrt'}: ${g}`, { gesperrt: A.row.gesperrt === 1 }, { gesperrt, grund: g });
      const S2 = stand();
      const A2 = S2.anlagen.get(A.row.id);
      if (gesperrt) {
        E.meldeSperre(db, A2, { titel: `Gesperrt: ${A.row.bezeichnung}`, text: `${D.sperrText(A2)}`, zeit: z, schluessel: `fp:sperre:${A.row.id}:${z}` });
      }
    });
    pruefen();
    const S3 = stand();
    res.json(anlageDetail(S3, S3.anlagen.get(A.row.id), req.ctx));
  });

  api.post(`${R}/anlagen/:id/ausscheiden`, pflege, (req, res) => {
    const S = stand();
    const A = anlageAus(S, req.params.id);
    const body = v.objekt(req.body);
    const datum = v.datum(body.datum, 'datum');
    if (datum > heute()) throw ungueltig('Das Datum darf nicht in der Zukunft liegen.');
    const g = grund(body.grund);
    if (A.row.ausgeschieden) throw konflikt('Die Anlage ist bereits ausgeschieden.');
    db.transaktion(() => {
      db.lauf('UPDATE anlage SET ausgeschieden = ?, version = version + 1 WHERE id = ?', datum, A.row.id);
      protokoll(req, 'fuhrpark_anlage', `anlage:${A.row.id}`, `${A.row.bezeichnung} ausgeschieden am ${deDatum(datum)}: ${g}`, null, { ausgeschieden: datum, grund: g });
    });
    const S2 = stand();
    res.json(anlageDetail(S2, S2.anlagen.get(A.row.id), req.ctx));
  });

  /* ================= Zähler ================= */

  function zaehlerAus(S, idText) {
    const zid = v.pfadId(idText, 'Zähler-ID');
    for (const A of S.anlagen.values()) { const z = A.zaehler.find((x) => x.row.id === zid); if (z) return { A, z }; }
    throw nichtGefunden('Zähler nicht gefunden.');
  }
  /** Versatz zum Datum: aus dem jüngsten Zählertausch bis zu diesem Tag */
  function versatzAm(staende, datum) {
    const t = staende.filter((s) => s.quelle === 'tausch_neu' && s.status !== 'ungueltig' && s.datum <= datum).sort(F.sortStaende);
    return t.length ? t[t.length - 1].wert - t[t.length - 1].anzeige : 0;
  }

  api.post(`${R}/anlagen/:id/zaehler`, pflege, (req, res) => {
    const S = stand();
    const A = anlageAus(S, req.params.id);
    const body = v.objekt(req.body);
    const zid = db.transaktion(() => {
      const id = zaehlerAnlegen(A.row.id, body, 0, heute(), req.ctx.benutzer.id);
      protokoll(req, 'fuhrpark_zaehler', `zaehler:${id}`, `Zähler ${F.ZAEHLER_NAME[body.art]} für ${A.row.bezeichnung} angelegt`, null, { art: body.art, startstand: body.startstand ?? 0 });
      return id;
    });
    pruefen();
    const z = zaehlerAus(stand(), String(zid)).z;
    res.status(201).json(D.zaehlerJson(z));
  });

  api.put(`${R}/zaehler/:zid`, pflege, (req, res) => {
    const { A, z } = zaehlerAus(stand(), req.params.zid);
    const body = v.objekt(req.body);
    const set = {};
    if (body.aktiv !== undefined) set.aktiv = v.bool(body.aktiv, 'aktiv') ? 1 : 0;
    if (body.ausBericht !== undefined) {
      const ab = v.bool(body.ausBericht, 'ausBericht');
      if (ab && !['bh', 'brecher'].includes(z.row.art)) throw ungueltig('ausBericht ist nur für Betriebs- und Brecherstunden möglich.');
      set.aus_bericht = ab ? 1 : 0;
    }
    if (!Object.keys(set).length) throw ungueltig('Keine änderbaren Felder angegeben (aktiv, ausBericht).');
    db.transaktion(() => {
      const k = Object.keys(set);
      db.lauf(`UPDATE zaehler SET ${k.map((x) => `${x} = ?`).join(', ')} WHERE id = ?`, ...k.map((x) => set[x]), z.row.id);
      protokoll(req, 'fuhrpark_zaehler', `zaehler:${z.row.id}`, `Zähler ${F.ZAEHLER_NAME[z.row.art]} ${A.row.bezeichnung} geändert`, { aktiv: z.row.aktiv, aus_bericht: z.row.aus_bericht }, set);
    });
    pruefen();
    res.json(D.zaehlerJson(zaehlerAus(stand(), req.params.zid).z));
  });

  api.get(`${R}/zaehler/:zid/verlauf`, lese, (req, res) => {
    const S = stand();
    const { A, z } = zaehlerAus(S, req.params.zid);
    const von = req.query.von ? v.datum(String(req.query.von), 'von') : null;
    const bis = req.query.bis ? v.datum(String(req.query.bis), 'bis') : null;
    const punkte = z.staende.filter((s) => (!von || s.datum >= von) && (!bis || s.datum <= bis)).sort(F.sortStaende)
      .map((s) => ({ id: s.id, datum: s.datum, wert: s.wert, anzeige: s.anzeige, quelle: s.quelle, status: s.status, hinweis: s.hinweis, erfasstVon: D.person(S.namen, s.erfasst_von) }));
    const schaetzung = [];
    if (z.row.aus_bericht && ['bh', 'brecher'].includes(z.row.art)) {
      const R0 = z.info.letzterStand;
      let w = R0.wert;
      schaetzung.push({ datum: R0.datum, wert: w });
      const tage = new Map();
      for (const b of A.stunden) if (b.datum > R0.datum && b.datum <= S.H) tage.set(b.datum, (tage.get(b.datum) || 0) + b.stunden);
      for (const d of [...tage.keys()].sort()) { w = Math.round((w + tage.get(d)) * 100) / 100; schaetzung.push({ datum: d, wert: w }); }
      if (schaetzung[schaetzung.length - 1].datum < S.H) schaetzung.push({ datum: S.H, wert: w });
    }
    res.json({ zaehler: { ...D.zaehlerJson(z), anlageId: A.row.id }, punkte, schaetzung, wochenschnitt: z.info.wochenschnitt, schnittQuelle: z.info.schnittQuelle });
  });

  api.post(`${R}/zaehlerstaende`, (req, res) => {
    const S = stand();
    const body = v.objekt(req.body);
    const A = aktiveAnlage(S, body.anlageId);
    const art = v.auswahl(body.art, 'art', F.ZAEHLER_ARTEN);
    const z = A.zaehler.find((x) => x.row.art === art && x.row.aktiv);
    if (!z) throw ungueltig(`${A.row.bezeichnung} hat keinen aktiven Zähler „${F.ZAEHLER_NAME[art]}“.`);
    const anzeige = v.zahl(body.anzeige, 'anzeige', { min: 0, max: 1e9 });
    const datum = v.datum(body.datum ?? S.H, 'datum');
    const notiz = v.text(body.notiz, 'notiz', { max: 500, pflicht: false });
    if (datum > S.H) throw ungueltig('Das Datum darf nicht in der Zukunft liegen.');
    if (!req.ctx.hat('fuhrpark') && tageZwischen(datum, S.H) > 62) throw ungueltig('Zählerstände können höchstens 62 Tage rückwirkend eingetragen werden – bitte das Büro verständigen.');
    const wert = Math.round((anzeige + versatzAm(z.staende, datum)) * 100) / 100;
    const gleich = z.staende.find((s) => s.datum === datum && s.anzeige === anzeige && s.status !== 'ungueltig');
    if (gleich) return res.status(200).json({ stand: D.standJson(gleich, S.namen, { anlageId: A.row.id, art }) });
    const p = F.pruefeZaehlerstand({ art, klasse: A.row.klasse, aus_bericht: z.row.aus_bericht }, z.staende, { datum, wert }, A.stunden);
    if (p.fehler) throw ungueltig(p.fehler);
    const z0 = zeit();
    const id = db.transaktion(() => {
      const sid = db.lauf("INSERT INTO zaehlerstand (zaehler_id, datum, anzeige, wert, quelle, status, hinweis, notiz, erfasst, erfasst_von) VALUES (?, ?, ?, ?, 'manuell', ?, ?, ?, ?, ?)",
        z.row.id, datum, anzeige, wert, p.status, p.hinweis || null, notiz, z0, req.ctx.benutzer.id).id;
      protokoll(req, 'fuhrpark_zaehler', `zaehlerstand:${sid}`, `${F.ZAEHLER_STAND_NAME[art]} ${A.row.bezeichnung}: ${F.zahlDe(anzeige)} ${F.EINHEIT[art]} am ${deDatum(datum)}${p.status === 'unplausibel' ? ' (unplausibel)' : ''}`, null, { anzeige, wert, datum, status: p.status });
      if (p.status === 'unplausibel') {
        for (const uid of E.fuhrparkBenutzer(db)) {
          E.melde(db, { benutzerId: uid, titel: `Unplausibler Zählerstand: ${A.row.bezeichnung}`, text: `${p.hinweis} Erfasst von ${req.ctx.benutzer.name} (${F.zahlDe(anzeige)} ${F.EINHEIT[art]} am ${deDatum(datum)}).`, zeit: z0, anlageId: A.row.id, schluessel: `fp:unplausibel:${sid}` });
        }
      }
      return sid;
    });
    pruefen();
    const s = db.eins('SELECT * FROM zaehlerstand WHERE id = ?', id);
    res.status(201).json({ stand: D.standJson(s, S.namen, { anlageId: A.row.id, art }), ...(p.warnung ? { warnung: p.warnung } : {}), ...(p.hinweis && !p.warnung ? { hinweis: p.hinweis } : {}) });
  });

  api.put(`${R}/zaehlerstaende/:id`, pflege, (req, res) => {
    const S = stand();
    const id = v.pfadId(req.params.id, 'ID');
    const s = db.eins('SELECT * FROM zaehlerstand WHERE id = ?', id);
    if (!s) throw nichtGefunden('Zählerstand nicht gefunden.');
    const { A, z } = zaehlerAus(S, String(s.zaehler_id));
    const body = v.objekt(req.body);
    const g = grund(body.grund);
    if (['tausch_alt', 'tausch_neu'].includes(s.quelle)) throw ungueltig('Stände eines Zählertauschs können nicht geändert werden.');
    const status = body.status === undefined ? s.status : v.auswahl(body.status, 'status', ['gueltig', 'ungueltig']);
    const anzeige = body.anzeige === undefined ? s.anzeige : v.zahl(body.anzeige, 'anzeige', { min: 0, max: 1e9 });
    if (body.status === undefined && body.anzeige === undefined) throw ungueltig('status oder anzeige angeben.');
    const wert = Math.round((anzeige + versatzAm(z.staende, s.datum)) * 100) / 100;
    if (status === 'gueltig') {
      const p = F.pruefeZaehlerstand({ art: z.row.art, klasse: A.row.klasse }, z.staende.filter((x) => x.id !== s.id), { datum: s.datum, wert });
      if (p.fehler && !(s.quelle === 'start' && /vor dem Beginn/.test(p.fehler))) throw ungueltig(p.fehler);
    }
    db.transaktion(() => {
      db.lauf('UPDATE zaehlerstand SET anzeige = ?, wert = ?, status = ?, grund = ?, hinweis = ? WHERE id = ?', anzeige, wert, status, g,
        status === 'gueltig' && s.status === 'unplausibel' ? `${s.hinweis || ''} Bestätigt durch ${req.ctx.benutzer.name}.`.trim() : s.hinweis, s.id);
      if (s.quelle === 'start') db.lauf('UPDATE zaehler SET startstand = ? WHERE id = ?', anzeige, z.row.id);
      protokoll(req, 'fuhrpark_zaehler', `zaehlerstand:${s.id}`, `Zählerstand ${A.row.bezeichnung} ${deDatum(s.datum)} korrigiert: ${g}`, { anzeige: s.anzeige, status: s.status }, { anzeige, status });
    });
    pruefen();
    res.json({ stand: D.standJson(db.eins('SELECT * FROM zaehlerstand WHERE id = ?', s.id), S.namen, { anlageId: A.row.id, art: z.row.art }) });
  });

  api.post(`${R}/zaehler/:zid/tausch`, pflege, (req, res) => {
    const S = stand();
    const { A, z } = zaehlerAus(S, req.params.zid);
    const body = v.objekt(req.body);
    const datum = v.datum(body.datum ?? S.H, 'datum');
    if (datum > S.H) throw ungueltig('Das Datum darf nicht in der Zukunft liegen.');
    const endAlt = v.zahl(body.endstandAlt, 'endstandAlt', { min: 0, max: 1e9 });
    const startNeu = v.zahl(body.startstandNeu, 'startstandNeu', { min: 0, max: 1e9 });
    const g = grund(body.grund);
    if (z.staende.some((s) => s.status === 'gueltig' && s.datum > datum)) throw ungueltig('Nach dem Tauschdatum gibt es bereits gültige Stände – bitte zuerst korrigieren.');
    const versatzAlt = versatzAm(z.staende, datum);
    const wertAlt = Math.round((endAlt + versatzAlt) * 100) / 100;
    const p = F.pruefeZaehlerstand({ art: z.row.art, klasse: A.row.klasse }, z.staende, { datum, wert: wertAlt });
    if (p.fehler) throw ungueltig(p.fehler);
    const versatzNeu = Math.round((wertAlt - startNeu) * 100) / 100;
    db.transaktion(() => {
      const z0 = zeit();
      db.lauf("INSERT INTO zaehlerstand (zaehler_id, datum, anzeige, wert, quelle, status, erfasst, erfasst_von, grund) VALUES (?, ?, ?, ?, 'tausch_alt', 'gueltig', ?, ?, ?)", z.row.id, datum, endAlt, wertAlt, z0, req.ctx.benutzer.id, g);
      db.lauf("INSERT INTO zaehlerstand (zaehler_id, datum, anzeige, wert, quelle, status, erfasst, erfasst_von, grund) VALUES (?, ?, ?, ?, 'tausch_neu', 'gueltig', ?, ?, ?)", z.row.id, datum, startNeu, wertAlt, z0, req.ctx.benutzer.id, g);
      db.lauf('UPDATE zaehler SET versatz = ? WHERE id = ?', versatzNeu, z.row.id);
      protokoll(req, 'fuhrpark_zaehler', `zaehler:${z.row.id}`, `Zählertausch ${A.row.bezeichnung} am ${deDatum(datum)}: alt ${F.zahlDe(endAlt)}, neu ${F.zahlDe(startNeu)} – ${g}`, { versatz: z.row.versatz }, { versatz: versatzNeu });
    });
    pruefen();
    res.json({ zaehler: D.zaehlerJson(zaehlerAus(stand(), req.params.zid).z) });
  });

  api.get(`${R}/zaehlerabfrage`, (req, res) => {
    res.json(E.zaehlerAbfrage(stand(), req.ctx.benutzer.id));
  });

  /* ================= Vorlagen ================= */

  const vorlageJson = (vo) => ({
    id: vo.id, schluessel: vo.schluessel, titel: vo.titel, art: vo.art, klassen: parseJson(vo.klassen, []), regel: parseJson(vo.regel, {}),
    rechtsgrundlage: vo.rechtsgrundlage, quelleUrl: vo.quelle_url, pruefen: vo.pruefen === 1, gueltigAb: vo.gueltig_ab, aktiv: vo.aktiv === 1, version: vo.version
  });

  function vorlageFelder(body, neu) {
    const set = {};
    if (neu || body.schluessel !== undefined) {
      if (!neu) throw ungueltig('schluessel ist nicht änderbar.');
      const s = v.text(body.schluessel, 'schluessel', { max: 40 });
      if (!/^[a-z0-9_]{2,40}$/.test(s)) throw ungueltig('schluessel: nur Kleinbuchstaben, Ziffern und _ (2–40 Zeichen).');
      set.schluessel = s;
    }
    if (neu || body.titel !== undefined) set.titel = v.text(body.titel, 'titel', { max: 200 });
    if (neu || body.art !== undefined) set.art = v.auswahl(body.art, 'art', F.PLAN_ARTEN);
    if (neu || body.klassen !== undefined) {
      const k = v.liste(body.klassen, 'klassen', { max: 40 });
      if (!k.length) throw ungueltig('klassen darf nicht leer sein.');
      for (const x of k) if (typeof x !== 'string' || !(/^alle$/.test(x) || /^[a-z]+([:+][A-Za-z0-9]{1,6})?$/.test(x))) throw ungueltig(`klassen: „${x}“ ist ungültig (z. B. "lkw", "lkw:N3", "lkw+kran", "alle").`);
      set.klassen = JSON.stringify(k);
    }
    if (neu || body.regel !== undefined) {
      try { set.regel = JSON.stringify(F.pruefeRegel(v.objekt(body.regel, 'regel'), { vorlage: true })); } catch (e) { if (e.status) throw e; throw ungueltig(e.message); }
    }
    if (body.rechtsgrundlage !== undefined) set.rechtsgrundlage = v.text(body.rechtsgrundlage, 'rechtsgrundlage', { max: 500, pflicht: false });
    if (body.quelleUrl !== undefined) {
      const u = v.text(body.quelleUrl, 'quelleUrl', { max: 500, pflicht: false });
      if (u && !/^https?:\/\/[^\s]+$/.test(u)) throw ungueltig('quelleUrl muss mit http:// oder https:// beginnen.');
      set.quelle_url = u;
    }
    if (body.pruefen !== undefined) set.pruefen = v.bool(body.pruefen, 'pruefen') ? 1 : 0;
    if (body.gueltigAb !== undefined) set.gueltig_ab = v.datum(body.gueltigAb, 'gueltigAb', { pflicht: false });
    if (body.aktiv !== undefined) set.aktiv = v.bool(body.aktiv, 'aktiv') ? 1 : 0;
    return set;
  }

  api.get(`${R}/vorlagen`, lese, (req, res) => {
    res.json(db.alle('SELECT * FROM plan_vorlage ORDER BY id').map(vorlageJson));
  });

  api.post(`${R}/vorlagen`, pflege, (req, res) => {
    const set = vorlageFelder(v.objekt(req.body), true);
    if (db.eins('SELECT id FROM plan_vorlage WHERE schluessel = ?', set.schluessel)) throw konflikt(`Vorlage ${set.schluessel} gibt es bereits.`);
    const id = db.transaktion(() => {
      const k = Object.keys(set);
      const nid = db.lauf(`INSERT INTO plan_vorlage (${k.join(', ')}) VALUES (${k.map(() => '?').join(', ')})`, ...k.map((x) => set[x])).id;
      protokoll(req, 'fuhrpark_plan', `vorlage:${nid}`, `Vorlage ${set.schluessel} angelegt`, null, set);
      return nid;
    });
    res.status(201).json(vorlageJson(db.eins('SELECT * FROM plan_vorlage WHERE id = ?', id)));
  });

  function vorlageAus(idText) {
    const vo = db.eins('SELECT * FROM plan_vorlage WHERE id = ?', v.pfadId(idText, 'Vorlagen-ID'));
    if (!vo) throw nichtGefunden('Vorlage nicht gefunden.');
    return vo;
  }

  api.put(`${R}/vorlagen/:id`, pflege, (req, res) => {
    const vo = vorlageAus(req.params.id);
    const body = v.objekt(req.body);
    pruefeVersion(body, vo, 'Die Vorlage');
    const set = vorlageFelder(body, false);
    if (!Object.keys(set).length) throw ungueltig('Keine änderbaren Felder angegeben.');
    db.transaktion(() => {
      const k = Object.keys(set);
      db.lauf(`UPDATE plan_vorlage SET ${k.map((x) => `${x} = ?`).join(', ')}, version = version + 1 WHERE id = ?`, ...k.map((x) => set[x]), vo.id);
      const alt = {}; for (const x of k) alt[x] = vo[x];
      protokoll(req, 'fuhrpark_plan', `vorlage:${vo.id}`, `Vorlage ${vo.schluessel} geändert (wirkt nicht rückwirkend)`, alt, set);
    });
    res.json(vorlageJson(db.eins('SELECT * FROM plan_vorlage WHERE id = ?', vo.id)));
  });

  api.post(`${R}/vorlagen/:id/anwenden`, pflege, (req, res) => {
    const vo = vorlageAus(req.params.id);
    const body = v.objekt(req.body);
    const vorschau = body.vorschau === undefined ? false : v.bool(body.vorschau, 'vorschau');
    const ids = body.anlageIds === undefined ? null : new Set(v.liste(body.anlageIds, 'anlageIds', { max: 1000 }).map((x, i) => v.id(x, `anlageIds[${i}]`)));
    let quelleId = vo.id;
    if (body.ersetztVorlage !== undefined) {
      const q = db.eins('SELECT * FROM plan_vorlage WHERE schluessel = ?', v.text(body.ersetztVorlage, 'ersetztVorlage', { max: 40 }));
      if (!q) throw ungueltig('ersetztVorlage: Vorlage nicht gefunden.');
      if (q.id === vo.id) throw ungueltig('ersetztVorlage muss eine andere Vorlage sein.');
      quelleId = q.id;
    }
    const S = stand();
    const geaendert = [], fehler = [];
    for (const A of S.liste) {
      if (A.row.ausgeschieden || (ids && !ids.has(A.row.id))) continue;
      for (const P of A.positionen.filter((p) => p.row.vorlage_id === quelleId && p.row.aktiv)) {
        let regel;
        try { regel = regelAusVorlage(vo, A.row, {}, P.regel); } catch (e) { fehler.push({ anlageId: A.row.id, planpositionId: P.row.id, fehler: e.message }); continue; }
        const neu = F.berechnePosition({ regel, letzteDatum: P.row.letzte_datum, letzteZaehler: P.letzteZaehler }, D.kontextFuer(A, S.H));
        geaendert.push({
          anlageId: A.row.id, anlage: { bezeichnung: A.row.bezeichnung, kennzeichen: A.row.kennzeichen }, planpositionId: P.row.id, titel: P.row.titel,
          alt: { status: P.calc.status, naechstesDatum: P.calc.naechstesDatum, regel: P.regel }, neu: { status: neu.status, naechstesDatum: neu.naechstesDatum, regel }, _regel: regel
        });
      }
    }
    if (!vorschau && geaendert.length) {
      db.transaktion(() => {
        for (const g of geaendert) {
          if (quelleId !== vo.id) db.lauf('UPDATE planposition SET regel = ?, vorlage_id = ?, titel = ?, version = version + 1 WHERE id = ?', JSON.stringify(g._regel), vo.id, vo.titel, g.planpositionId);
          else db.lauf('UPDATE planposition SET regel = ?, version = version + 1 WHERE id = ?', JSON.stringify(g._regel), g.planpositionId);
        }
        protokoll(req, 'fuhrpark_plan', `vorlage:${vo.id}`, `Vorlage ${vo.schluessel} auf ${geaendert.length} Planposition(en) angewendet${quelleId !== vo.id ? ' (ersetzt andere Vorlage)' : ''}`, null, { planpositionIds: geaendert.map((g) => g.planpositionId) });
      });
      pruefen();
    }
    res.json({ geaendert: geaendert.map(({ _regel, ...g }) => g), fehler, angewendet: !vorschau && geaendert.length > 0 });
  });

  /* ================= Plan ================= */

  api.get(`${R}/anlagen/:id/plan`, lese, (req, res) => {
    const S = stand();
    const A = anlageAus(S, req.params.id);
    res.json(A.positionen.map((P) => D.positionJson(P, A.row.id)));
  });

  api.post(`${R}/anlagen/:id/plan`, pflege, (req, res) => {
    const S = stand();
    const A = anlageAus(S, req.params.id);
    const body = v.objekt(req.body);
    const pid = db.transaktion(() => {
      const id = positionAnlegen(A.row, body, S.H);
      protokoll(req, 'fuhrpark_plan', `planposition:${id}`, `Planposition für ${A.row.bezeichnung} angelegt`, null, body);
      return id;
    });
    pruefen();
    const S2 = stand();
    res.status(201).json(D.positionJson(S2.anlagen.get(A.row.id).positionen.find((p) => p.row.id === pid), A.row.id));
  });

  function positionAus(S, A, pidText) {
    const pid = v.pfadId(pidText, 'Positions-ID');
    const P = A.positionen.find((p) => p.row.id === pid);
    if (!P) throw nichtGefunden('Planposition nicht gefunden.');
    return P;
  }

  api.put(`${R}/anlagen/:id/plan/:pid`, pflege, (req, res) => {
    const S = stand();
    const A = anlageAus(S, req.params.id);
    const P = positionAus(S, A, req.params.pid);
    const body = v.objekt(req.body);
    pruefeVersion(body, P.row, 'Die Planposition');
    const set = {};
    if (body.titel !== undefined) set.titel = v.text(body.titel, 'titel', { max: 200 });
    if (body.regel !== undefined) { try { set.regel = JSON.stringify(F.pruefeRegel(v.objekt(body.regel, 'regel'))); } catch (e) { if (e.status) throw e; throw ungueltig(e.message); } }
    if (body.aktiv !== undefined) set.aktiv = v.bool(body.aktiv, 'aktiv') ? 1 : 0;
    let g = null;
    if (body.letzteDatum !== undefined || body.letzteZaehler !== undefined) {
      g = grund(body.grund);
      if (body.letzteDatum !== undefined) {
        const d = v.datum(body.letzteDatum, 'letzteDatum', { pflicht: false });
        if (d && d > S.H) throw ungueltig('letzteDatum darf nicht in der Zukunft liegen.');
        set.letzte_datum = d; set.start_datum = d;
      }
      if (body.letzteZaehler !== undefined) { const lz = pruefeLetzteZaehler(body.letzteZaehler); set.letzte_zaehler = lz ? JSON.stringify(lz) : null; set.start_zaehler = set.letzte_zaehler; }
      set.letzte_eintrag_id = null;
    }
    if (!Object.keys(set).length) throw ungueltig('Keine änderbaren Felder angegeben.');
    db.transaktion(() => {
      const k = Object.keys(set);
      db.lauf(`UPDATE planposition SET ${k.map((x) => `${x} = ?`).join(', ')}, version = version + 1 WHERE id = ?`, ...k.map((x) => set[x]), P.row.id);
      const alt = {}; for (const x of k) alt[x] = P.row[x];
      protokoll(req, 'fuhrpark_plan', `planposition:${P.row.id}`, `Planposition ${P.row.titel} (${A.row.bezeichnung}) geändert${g ? ': ' + g : ''}`, alt, set);
    });
    pruefen();
    const S2 = stand();
    res.json(D.positionJson(S2.anlagen.get(A.row.id).positionen.find((p) => p.row.id === P.row.id), A.row.id));
  });

  api.delete(`${R}/anlagen/:id/plan/:pid`, pflege, (req, res) => {
    const S = stand();
    const A = anlageAus(S, req.params.id);
    const P = positionAus(S, A, req.params.pid);
    db.transaktion(() => {
      db.lauf('UPDATE planposition SET aktiv = 0, version = version + 1 WHERE id = ?', P.row.id);
      protokoll(req, 'fuhrpark_plan', `planposition:${P.row.id}`, `Planposition ${P.row.titel} (${A.row.bezeichnung}) deaktiviert`);
    });
    pruefen();
    const S2 = stand();
    res.json(D.positionJson(S2.anlagen.get(A.row.id).positionen.find((p) => p.row.id === P.row.id), A.row.id));
  });

  /* ================= Einträge ================= */

  function eintragAus(idText) {
    const e = db.eins('SELECT * FROM servicebuch_eintrag WHERE id = ?', v.pfadId(idText, 'Eintrags-ID'));
    if (!e) throw nichtGefunden('Eintrag nicht gefunden.');
    return e;
  }

  api.get(`${R}/eintraege`, lese, (req, res) => {
    const S = stand();
    const q = req.query;
    const w = [], p = [];
    if (q.anlageId) { w.push('anlage_id = ?'); p.push(v.id(Number(q.anlageId), 'anlageId')); }
    if (q.von) { w.push('datum >= ?'); p.push(v.datum(String(q.von), 'von')); }
    if (q.bis) { w.push('datum <= ?'); p.push(v.datum(String(q.bis), 'bis')); }
    if (q.art) { w.push('art = ?'); p.push(v.auswahl(String(q.art), 'art', EINTRAG_ARTEN)); }
    const zeilen = db.alle(`SELECT * FROM servicebuch_eintrag ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY datum DESC, id DESC LIMIT 1000`, ...p);
    res.json(zeilen.map((e) => D.eintragJson(db, e, S, req.ctx)));
  });

  api.get(`${R}/eintraege/:id`, lese, (req, res) => {
    res.json(D.eintragJson(db, eintragAus(req.params.id), stand(), req.ctx));
  });

  function kostenFeld(req, body) {
    if (body.kosten === undefined || body.kosten === null) return undefined;
    if (!D.euro(req.ctx)) throw ungueltig('Kosten dürfen nur mit dem Recht „Preise sehen“ erfasst werden.');
    return v.betrag(body.kosten, 'kosten', { min: 0, max: 10000000 });
  }

  /** Planposition auf den Stand des jüngsten nicht stornierten Eintrags (bzw. Startwert) setzen */
  function positionNeuBerechnen(pid) {
    const e = db.eins(`SELECT e.* FROM eintrag_planposition ep JOIN servicebuch_eintrag e ON e.id = ep.eintrag_id
      WHERE ep.planposition_id = ? AND e.storniert IS NULL ORDER BY e.datum DESC, e.id DESC LIMIT 1`, pid);
    if (e) {
      const lz = {};
      for (const s of db.alle('SELECT s.wert, z.art FROM zaehlerstand s JOIN zaehler z ON z.id = s.zaehler_id WHERE s.eintrag_id = ?', e.id)) lz[s.art] = s.wert;
      db.lauf('UPDATE planposition SET letzte_datum = ?, letzte_zaehler = ?, letzte_eintrag_id = ?, version = version + 1 WHERE id = ?', e.datum, Object.keys(lz).length ? JSON.stringify(lz) : null, e.id, pid);
    } else {
      db.lauf('UPDATE planposition SET letzte_datum = start_datum, letzte_zaehler = start_zaehler, letzte_eintrag_id = NULL, version = version + 1 WHERE id = ?', pid);
    }
  }

  api.post(`${R}/eintraege`, pflege, (req, res) => {
    const S = stand();
    const body = v.objekt(req.body);
    const A = aktiveAnlage(S, body.anlageId);
    const art = v.auswahl(body.art, 'art', EINTRAG_ARTEN);
    const datum = v.datum(body.datum, 'datum');
    if (datum > S.H) throw ungueltig('Das Datum darf nicht in der Zukunft liegen.');
    const f = {
      werkstatt: v.text(body.werkstatt, 'werkstatt', { max: 200 }), titel: v.text(body.titel, 'titel', { max: 200 }),
      arbeiten: v.text(body.arbeiten, 'arbeiten', { max: 5000, pflicht: false }), teile: v.text(body.teile, 'teile', { max: 5000, pflicht: false }),
      arbeitsstunden_intern: v.zahl(body.arbeitsstundenIntern, 'arbeitsstundenIntern', { min: 0, max: 10000, pflicht: false }),
      rechnung_nr: v.text(body.rechnungNr, 'rechnungNr', { max: 50, pflicht: false }), pruefer: v.text(body.pruefer, 'pruefer', { max: 200, pflicht: false })
    };
    const kosten = kostenFeld(req, body);
    const pruefErgebnis = v.auswahl(body.pruefErgebnis, 'pruefErgebnis', PRUEF, { pflicht: false });
    if (pruefErgebnis && art !== 'pruefung') throw ungueltig('pruefErgebnis ist nur bei Art „pruefung“ möglich.');
    // Zählerstände: Pflicht für jede aktive Zählerart
    const liste = body.zaehler === undefined ? [] : v.liste(body.zaehler, 'zaehler', { max: 5 });
    const eingabe = new Map();
    liste.forEach((z, i) => {
      v.objekt(z, `zaehler[${i}]`);
      const za = v.auswahl(z.art, `zaehler[${i}].art`, F.ZAEHLER_ARTEN);
      if (eingabe.has(za)) throw ungueltig(`zaehler[${i}]: ${F.ZAEHLER_NAME[za]} doppelt angegeben.`);
      if (!A.zaehler.some((x) => x.row.art === za && x.row.aktiv)) throw ungueltig(`zaehler[${i}]: ${A.row.bezeichnung} hat keinen aktiven Zähler „${F.ZAEHLER_NAME[za]}“.`);
      eingabe.set(za, v.zahl(z.anzeige, `zaehler[${i}].anzeige`, { min: 0, max: 1e9 }));
    });
    const staende = [];
    for (const z of A.zaehler.filter((x) => x.row.aktiv)) {
      if (!eingabe.has(z.row.art)) throw ungueltig(`${F.ZAEHLER_STAND_NAME[z.row.art]} fehlt.`);
      const anzeige = eingabe.get(z.row.art);
      const wert = Math.round((anzeige + versatzAm(z.staende, datum)) * 100) / 100;
      const gleich = z.staende.find((s) => s.datum === datum && s.anzeige === anzeige && s.status !== 'ungueltig');
      const p = gleich ? { status: gleich.status } : F.pruefeZaehlerstand({ art: z.row.art, klasse: A.row.klasse, aus_bericht: z.row.aus_bericht }, z.staende, { datum, wert }, A.stunden);
      if (p.fehler) throw ungueltig(`${F.ZAEHLER_STAND_NAME[z.row.art]}: ${p.fehler}`);
      staende.push({ z, anzeige, wert, p, gleich });
    }
    const werte = Object.fromEntries(staende.map((s) => [s.z.row.art, s.wert]));
    // erledigte Planpositionen (+ schliesstEin)
    const pids = body.planpositionIds === undefined ? [] : v.liste(body.planpositionIds, 'planpositionIds', { max: 50 }).map((x, i) => v.id(x, `planpositionIds[${i}]`));
    const erledigt = new Map();
    for (const pid of pids) {
      const P = A.positionen.find((x) => x.row.id === pid && x.row.aktiv);
      if (!P) throw ungueltig(`Planposition ${pid} gehört nicht zu dieser Anlage oder ist inaktiv.`);
      erledigt.set(pid, P);
    }
    for (const P of [...erledigt.values()]) {
      for (const s of P.regel.schliesstEin || []) {
        for (const Q of A.positionen.filter((x) => x.row.aktiv && x.row.vorlage_schluessel === s)) if (!erledigt.has(Q.row.id)) erledigt.set(Q.row.id, Q);
      }
    }
    for (const P of erledigt.values()) {
      for (const za of F.zaehlerArtenDerRegel(P.regel)) if (werte[za] === undefined) throw ungueltig(`${F.ZAEHLER_STAND_NAME[za]} fehlt (für „${P.row.titel}“).`);
    }
    const mids = body.maengelIds === undefined ? [] : v.liste(body.maengelIds, 'maengelIds', { max: 50 }).map((x, i) => v.id(x, `maengelIds[${i}]`));
    for (const mid of mids) {
      const m = db.eins('SELECT * FROM mangel WHERE id = ?', mid);
      if (!m || m.anlage_id !== A.row.id) throw ungueltig(`Mangel/Schaden ${mid} gehört nicht zu dieser Anlage.`);
    }
    const z0 = zeit();
    const warnungen = staende.filter((s) => s.p.warnung).map((s) => `${F.ZAEHLER_STAND_NAME[s.z.row.art]}: ${s.p.warnung}`);
    const id = db.transaktion(() => {
      const eid = db.lauf(`INSERT INTO servicebuch_eintrag (anlage_id, art, datum, werkstatt, titel, arbeiten, teile, arbeitsstunden_intern, kosten, rechnung_nr, pruef_ergebnis, pruefer, erfasst, erfasst_von)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, A.row.id, art, datum, f.werkstatt, f.titel, f.arbeiten, f.teile, f.arbeitsstunden_intern, kosten ?? null, f.rechnung_nr, pruefErgebnis, f.pruefer, z0, req.ctx.benutzer.id).id;
      for (const s of staende) {
        if (s.gleich && !s.gleich.eintrag_id) db.lauf('UPDATE zaehlerstand SET eintrag_id = ? WHERE id = ?', eid, s.gleich.id);
        else if (!s.gleich || s.gleich.eintrag_id) {
          const sid = db.lauf("INSERT INTO zaehlerstand (zaehler_id, datum, anzeige, wert, quelle, status, hinweis, eintrag_id, erfasst, erfasst_von) VALUES (?, ?, ?, ?, 'eintrag', ?, ?, ?, ?, ?)",
            s.z.row.id, datum, s.anzeige, s.wert, s.p.status, s.p.hinweis || null, eid, z0, req.ctx.benutzer.id).id;
          if (s.p.status === 'unplausibel') for (const uid of E.fuhrparkBenutzer(db)) E.melde(db, { benutzerId: uid, titel: `Unplausibler Zählerstand: ${A.row.bezeichnung}`, text: s.p.hinweis, zeit: z0, anlageId: A.row.id, schluessel: `fp:unplausibel:${sid}` });
        }
      }
      for (const P of erledigt.values()) {
        db.lauf('INSERT OR IGNORE INTO eintrag_planposition (eintrag_id, planposition_id) VALUES (?, ?)', eid, P.row.id);
        db.lauf('UPDATE planposition SET letzte_datum = ?, letzte_zaehler = ?, letzte_eintrag_id = ?, version = version + 1 WHERE id = ?', datum, Object.keys(werte).length ? JSON.stringify(werte) : null, eid, P.row.id);
      }
      for (const mid of mids) db.lauf("UPDATE mangel SET status = 'behoben', eintrag_id = ?, bearbeitet = ?, bearbeitet_von = ?, version = version + 1 WHERE id = ?", eid, z0, req.ctx.benutzer.id, mid);
      if (pruefErgebnis === 'schwere_maengel') {
        db.lauf("UPDATE anlage SET gesperrt = 1, sperr_grund = 'Prüfung mit schweren Mängeln', sperr_typ = 'pruefung', gesperrt_seit = ?, gesperrt_von = ?, version = version + 1 WHERE id = ?", z0, req.ctx.benutzer.id, A.row.id);
        protokoll(req, 'fuhrpark_sperre', `anlage:${A.row.id}`, `${A.row.bezeichnung} gesperrt: Prüfung mit schweren Mängeln`, null, { gesperrt: true });
      }
      protokoll(req, 'fuhrpark_eintrag', `eintrag:${eid}`, `Servicebuch ${A.row.bezeichnung}: ${f.titel} (${deDatum(datum)})`, null,
        { art, datum, titel: f.titel, ...(kosten != null ? { kosten } : {}), planpositionIds: [...erledigt.keys()], maengelIds: mids });
      if (pruefErgebnis === 'schwere_maengel') {
        const A2 = stand().anlagen.get(A.row.id);
        E.meldeSperre(db, A2, { titel: `Gesperrt: ${A.row.bezeichnung}`, text: `${D.sperrText(A2)}`, zeit: z0, schluessel: `fp:sperre:${A.row.id}:${z0}` });
      }
      return eid;
    });
    pruefen();
    res.status(201).json({ ...D.eintragJson(db, db.eins('SELECT * FROM servicebuch_eintrag WHERE id = ?', id), stand(), req.ctx), warnungen });
  });

  api.put(`${R}/eintraege/:id`, pflege, (req, res) => {
    const e = eintragAus(req.params.id);
    const body = v.objekt(req.body);
    if (e.storniert) throw konflikt('Der Eintrag ist storniert.');
    pruefeVersion(body, e, 'Der Eintrag');
    for (const k of ['datum', 'zaehler', 'planpositionIds', 'maengelIds', 'anlageId', 'art', 'pruefErgebnis']) {
      if (body[k] !== undefined) throw ungueltig(`${k} ist nur per Storno und Neuerfassung änderbar.`);
    }
    const set = {};
    if (body.werkstatt !== undefined) set.werkstatt = v.text(body.werkstatt, 'werkstatt', { max: 200 });
    if (body.titel !== undefined) set.titel = v.text(body.titel, 'titel', { max: 200 });
    if (body.arbeiten !== undefined) set.arbeiten = v.text(body.arbeiten, 'arbeiten', { max: 5000, pflicht: false });
    if (body.teile !== undefined) set.teile = v.text(body.teile, 'teile', { max: 5000, pflicht: false });
    if (body.arbeitsstundenIntern !== undefined) set.arbeitsstunden_intern = v.zahl(body.arbeitsstundenIntern, 'arbeitsstundenIntern', { min: 0, max: 10000, pflicht: false });
    if (body.rechnungNr !== undefined) set.rechnung_nr = v.text(body.rechnungNr, 'rechnungNr', { max: 50, pflicht: false });
    if (body.pruefer !== undefined) set.pruefer = v.text(body.pruefer, 'pruefer', { max: 200, pflicht: false });
    const kosten = kostenFeld(req, body);
    if (kosten !== undefined) set.kosten = kosten;
    else if (body.kosten === null && D.euro(req.ctx)) set.kosten = null;
    if (!Object.keys(set).length) throw ungueltig('Keine änderbaren Felder angegeben.');
    db.transaktion(() => {
      const k = Object.keys(set);
      db.lauf(`UPDATE servicebuch_eintrag SET ${k.map((x) => `${x} = ?`).join(', ')}, version = version + 1 WHERE id = ?`, ...k.map((x) => set[x]), e.id);
      const alt = {}; for (const x of k) alt[x] = e[x];
      protokoll(req, 'fuhrpark_eintrag', `eintrag:${e.id}`, `Servicebuch-Eintrag ${e.titel} geändert`, alt, set);
    });
    res.json(D.eintragJson(db, eintragAus(req.params.id), stand(), req.ctx));
  });

  api.post(`${R}/eintraege/:id/storno`, pflege, (req, res) => {
    const e = eintragAus(req.params.id);
    const body = v.objekt(req.body);
    const g = grund(body.grund);
    if (e.storniert) throw konflikt('Der Eintrag ist bereits storniert.');
    const z0 = zeit();
    db.transaktion(() => {
      db.lauf('UPDATE servicebuch_eintrag SET storniert = ?, storno_grund = ?, storno_von = ?, version = version + 1 WHERE id = ?', z0, g, req.ctx.benutzer.id, e.id);
      db.lauf("UPDATE zaehlerstand SET status = 'ungueltig', grund = ? WHERE eintrag_id = ?", `Eintrag storniert: ${g}`, e.id);
      for (const p of db.alle('SELECT planposition_id FROM eintrag_planposition WHERE eintrag_id = ?', e.id)) positionNeuBerechnen(p.planposition_id);
      db.lauf("UPDATE mangel SET status = 'offen', eintrag_id = NULL, version = version + 1 WHERE eintrag_id = ? AND status = 'behoben'", e.id);
      protokoll(req, 'fuhrpark_eintrag', `eintrag:${e.id}`, `Servicebuch-Eintrag ${e.titel} (${deDatum(e.datum)}) storniert: ${g}`, null, { storniert: true });
    });
    pruefen();
    res.json(D.eintragJson(db, eintragAus(req.params.id), stand(), req.ctx));
  });

  /* ================= Mängel ================= */

  api.get(`${R}/maengel`, (req, res) => {
    const S = stand();
    const w = ["typ = 'mangel'"], p = [];
    if (req.query.anlageId) { w.push('anlage_id = ?'); p.push(v.id(Number(req.query.anlageId), 'anlageId')); }
    if (req.query.status) {
      const st = String(req.query.status);
      if (st === 'offen_alle') w.push("status IN ('offen','in_arbeit')");
      else { w.push('status = ?'); p.push(v.auswahl(st, 'status', MANGEL_STATUS)); }
    }
    if (!D.leserecht(req.ctx)) { w.push('gemeldet_von = ?'); p.push(req.ctx.benutzer.id); }
    res.json(db.alle(`SELECT * FROM mangel WHERE ${w.join(' AND ')} ORDER BY gemeldet DESC, id DESC LIMIT 500`, ...p).map((m) => D.mangelJson(m, S)));
  });

  function meldeMangel(A, m, { titel, text, z0 }) {
    const gesperrt = m.dringlichkeit === 'sofort';
    if (gesperrt) {
      const A2 = stand().anlagen.get(A.row.id);
      E.meldeSperre(db, A2, { titel, text, zeit: z0, schluessel: `fp:mangel:${m.id}`, buero: m.typ === 'schaden' });
    } else {
      const empf = new Set([...E.fuhrparkBenutzer(db), ...(m.typ === 'schaden' ? E.buroGf(db) : [])]);
      for (const uid of empf) E.melde(db, { benutzerId: uid, titel, text, zeit: z0, anlageId: A ? A.row.id : null, schluessel: `fp:mangel:${m.id}` });
    }
  }

  api.post(`${R}/maengel`, (req, res) => {
    const S = stand();
    const body = v.objekt(req.body);
    const A = aktiveAnlage(S, body.anlageId);
    const text = v.text(body.text, 'text', { max: 1000, min: 3 });
    const dringlichkeit = v.auswahl(body.dringlichkeit, 'dringlichkeit', DRING);
    const bsId = body.baustelleId == null ? null : v.id(body.baustelleId, 'baustelleId');
    if (bsId && !db.eins('SELECT id FROM baustelle WHERE id = ?', bsId)) throw ungueltig('Baustelle nicht gefunden.');
    const z0 = zeit();
    const id = db.transaktion(() => {
      const mid = db.lauf("INSERT INTO mangel (typ, anlage_id, text, dringlichkeit, status, baustelle_id, gemeldet, gemeldet_von) VALUES ('mangel', ?, ?, ?, 'offen', ?, ?, ?)",
        A.row.id, text, dringlichkeit, bsId, z0, req.ctx.benutzer.id).id;
      protokoll(req, 'fuhrpark_mangel', `mangel:${mid}`, `Mangel ${A.row.bezeichnung} gemeldet (${dringlichkeit}): ${text}`, null, { dringlichkeit });
      const m = db.eins('SELECT * FROM mangel WHERE id = ?', mid);
      meldeMangel(A, m, {
        titel: dringlichkeit === 'sofort' ? `Gerät stillgelegt: ${A.row.bezeichnung}` : `Mangel gemeldet: ${A.row.bezeichnung}`,
        text: `${E.anlageName(A.row)}: ${text} – gemeldet von ${req.ctx.benutzer.name}${dringlichkeit === 'sofort' ? ' (sofort stilllegen)' : dringlichkeit === 'bald' ? ' (bald beheben)' : ''}`, z0
      });
      return mid;
    });
    pruefen();
    const S2 = stand();
    res.status(201).json(D.mangelJson(db.eins('SELECT * FROM mangel WHERE id = ?', id), S2));
  });

  api.put(`${R}/maengel/:id`, pflege, (req, res) => {
    const S = stand();
    const m = db.eins("SELECT * FROM mangel WHERE id = ? AND typ = 'mangel'", v.pfadId(req.params.id, 'Mangel-ID'));
    if (!m) throw nichtGefunden('Mangel nicht gefunden.');
    const body = v.objekt(req.body);
    if (body.version !== undefined) pruefeVersion(body, m, 'Der Mangel');
    const status = v.auswahl(body.status ?? m.status, 'status', MANGEL_STATUS);
    const notiz = body.notiz === undefined ? m.notiz : v.text(body.notiz, 'notiz', { max: 2000, pflicht: false });
    if (status === 'verworfen' && !notiz) throw ungueltig('Zum Verwerfen bitte eine Notiz (Begründung) angeben.');
    let eintragId = m.eintrag_id;
    if (body.eintragId !== undefined) {
      eintragId = body.eintragId === null ? null : v.id(body.eintragId, 'eintragId');
      if (eintragId) { const e = db.eins('SELECT * FROM servicebuch_eintrag WHERE id = ?', eintragId); if (!e || e.anlage_id !== m.anlage_id || e.storniert) throw ungueltig('Eintrag gehört nicht zu dieser Anlage oder ist storniert.'); }
    }
    db.transaktion(() => {
      db.lauf('UPDATE mangel SET status = ?, notiz = ?, eintrag_id = ?, bearbeitet = ?, bearbeitet_von = ?, version = version + 1 WHERE id = ?', status, notiz, eintragId, zeit(), req.ctx.benutzer.id, m.id);
      protokoll(req, 'fuhrpark_mangel', `mangel:${m.id}`, `Mangel ${m.id} bearbeitet: ${m.status} → ${status}`, { status: m.status, notiz: m.notiz }, { status, notiz, eintragId });
    });
    pruefen();
    res.json(D.mangelJson(db.eins('SELECT * FROM mangel WHERE id = ?', m.id), S));
  });

  /* ================= Schäden mit Fotos (API.md 11.9) ================= */

  function schadenAus(req, idText) {
    const m = db.eins("SELECT * FROM mangel WHERE id = ? AND typ = 'schaden'", v.pfadId(idText, 'Schadens-ID'));
    if (!m) throw nichtGefunden('Schadensmeldung nicht gefunden.');
    if (!D.schadenSichtbar(db, req.ctx, m)) throw keinZugriff('Diese Schadensmeldung liegt außerhalb Ihres Bereichs.');
    return m;
  }

  function fotoHinzufuegen(req, m, f, i) {
    v.objekt(f, `fotos[${i}]`);
    let bild;
    try { bild = B.bildPruefen(f.bildBase64); } catch (e) { if (e instanceof B.BildFehler) throw ungueltig(i === null ? e.message : `Foto ${i + 1}: ${e.message}`); throw e; }
    const vorhanden = db.eins('SELECT * FROM schaden_foto WHERE mangel_id = ? AND sha256 = ?', m.id, bild.sha256);
    if (vorhanden) return { foto: vorhanden, neu: false };
    if (db.eins('SELECT COUNT(*) AS n FROM schaden_foto WHERE mangel_id = ?', m.id).n >= B.MAX_FOTOS) throw ungueltig(`Höchstens ${B.MAX_FOTOS} Fotos je Schadensmeldung.`);
    const datei = B.speichere(bt.uploads, bild.mime, bild.daten);
    try {
      const id = db.lauf('INSERT INTO schaden_foto (mangel_id, datei, mime, groesse, sha256, dateiname, erstellt, erstellt_von) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        m.id, datei, bild.mime, bild.daten.length, bild.sha256, B.sichererName(f.dateiname, bild.mime), zeit(), req.ctx.benutzer.id).id;
      protokoll(req, 'fuhrpark_schaden', `schaden:${m.id}`, `Foto zu Schaden ${m.id} hinzugefügt (${bild.mime}, ${bild.daten.length} Bytes, Metadaten entfernt)`, null, { fotoId: id });
      return { foto: db.eins('SELECT * FROM schaden_foto WHERE id = ?', id), neu: true };
    } catch (e) {
      try { fs.unlinkSync(B.dateiPfad(bt.uploads, datei)); } catch (_) { /* egal */ }
      throw e;
    }
  }

  api.get(`${R}/schaeden`, (req, res) => {
    const S = stand();
    const w = ["typ = 'schaden'"], p = [];
    if (req.query.anlageId) { w.push('anlage_id = ?'); p.push(v.id(Number(req.query.anlageId), 'anlageId')); }
    if (req.query.baustelleId) { w.push('baustelle_id = ?'); p.push(v.id(Number(req.query.baustelleId), 'baustelleId')); }
    if (req.query.status) {
      const st = String(req.query.status);
      if (st === 'offen') w.push("status IN ('offen','in_arbeit')");
      else { w.push('status = ?'); p.push(D.SCHADEN_STATUS_DB[v.auswahl(st, 'status', Object.keys(D.SCHADEN_STATUS_DB))]); }
    }
    const cache = {};
    res.json(db.alle(`SELECT * FROM mangel WHERE ${w.join(' AND ')} ORDER BY gemeldet DESC, id DESC LIMIT 500`, ...p)
      .filter((m) => D.schadenSichtbar(db, req.ctx, m, cache)).map((m) => D.schadenJson(db, m, S, req.ctx)));
  });

  api.get(`${R}/schaeden/:id`, (req, res) => {
    res.json(D.schadenJson(db, schadenAus(req, req.params.id), stand(), req.ctx));
  });

  api.post(`${R}/schaeden`, (req, res) => {
    const S = stand();
    const body = v.objekt(req.body);
    const clientId = body.clientId == null ? null : v.text(body.clientId, 'clientId', { max: 100 });
    if (clientId && !/^[A-Za-z0-9._:-]{4,100}$/.test(clientId)) throw ungueltig('clientId ist ungültig (4–100 Zeichen, Buchstaben/Ziffern/.-_:).');
    if (clientId) {
      const vorh = db.eins("SELECT * FROM mangel WHERE gemeldet_von = ? AND client_id = ? AND typ = 'schaden'", req.ctx.benutzer.id, clientId);
      if (vorh) return res.status(200).json(D.schadenJson(db, vorh, S, req.ctx));
    }
    let A = null, fremd = null;
    if (body.anlageId != null && body.fremdGeraet != null) throw ungueltig('Entweder anlageId oder fremdGeraet angeben, nicht beides.');
    if (body.anlageId != null) A = aktiveAnlage(S, body.anlageId);
    else fremd = v.text(body.fremdGeraet, 'fremdGeraet (unbekanntes/fremdes Gerät)', { max: 200, min: 3 });
    const art = v.auswahl(body.art, 'art', SCHADEN_ARTEN);
    const ursache = v.text(body.ursache, 'ursache', { max: 2000, min: 10 });
    if (ursache.length < 10) throw ungueltig('ursache: bitte mindestens 10 Zeichen beschreiben.');
    const beschreibung = v.text(body.beschreibung, 'beschreibung', { max: 4000, pflicht: false });
    const einsatzfaehig = v.auswahl(body.einsatzfaehig, 'einsatzfaehig', EINSATZ);
    const bsId = body.baustelleId == null ? null : v.id(body.baustelleId, 'baustelleId');
    if (bsId && !db.eins('SELECT id FROM baustelle WHERE id = ?', bsId)) throw ungueltig('Baustelle nicht gefunden.');
    let zeitpunkt = zeit();
    if (body.zeitpunkt != null) {
      if (typeof body.zeitpunkt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(body.zeitpunkt) || Number.isNaN(Date.parse(body.zeitpunkt))) {
        throw ungueltig('zeitpunkt muss ein ISO-Zeitstempel mit Zeitzone sein (z. B. 2026-11-12T10:30:00+01:00).');
      }
      const t = new Date(body.zeitpunkt);
      if (t.getTime() > bt.uhr().getTime() + 5 * 60000) throw ungueltig('zeitpunkt darf nicht in der Zukunft liegen.');
      if (t.getTime() < bt.uhr().getTime() - 366 * 86400000) throw ungueltig('zeitpunkt liegt mehr als ein Jahr zurück.');
      zeitpunkt = t.toISOString();
    }
    const fotos = body.fotos === undefined ? [] : v.liste(body.fotos, 'fotos', { max: B.MAX_FOTOS });
    // Fotos vorab prüfen (kein halber Datensatz bei ungültigem Bild)
    fotos.forEach((f, i) => { v.objekt(f, `fotos[${i}]`); try { B.bildPruefen(f.bildBase64); } catch (e) { if (e instanceof B.BildFehler) throw ungueltig(`Foto ${i + 1}: ${e.message}`); throw e; } });
    const z0 = zeit();
    const dring = D.DRINGLICHKEIT[einsatzfaehig];
    const id = db.transaktion(() => {
      const mid = db.lauf(`INSERT INTO mangel (typ, anlage_id, fremd_geraet, text, dringlichkeit, status, baustelle_id, gemeldet, gemeldet_von, schaden_art, beschreibung, einsatzfaehig, zeitpunkt, client_id)
        VALUES ('schaden', ?, ?, ?, ?, 'offen', ?, ?, ?, ?, ?, ?, ?, ?)`, A ? A.row.id : null, fremd, ursache, dring, bsId, z0, req.ctx.benutzer.id, art, beschreibung, einsatzfaehig, zeitpunkt, clientId).id;
      const m = db.eins('SELECT * FROM mangel WHERE id = ?', mid);
      fotos.forEach((f, i) => fotoHinzufuegen(req, m, f, i));
      protokoll(req, 'fuhrpark_schaden', `schaden:${mid}`, `Schaden gemeldet: ${A ? A.row.bezeichnung : fremd} (${art}, einsatzfähig: ${einsatzfaehig})`, null, { art, einsatzfaehig, fotos: fotos.length });
      const name = A ? A.row.bezeichnung : fremd;
      meldeMangel(A, m, {
        titel: einsatzfaehig === 'nein' && A ? `Gerät stillgelegt (Schaden): ${name}` : `Schaden gemeldet: ${name}`,
        text: `${A ? E.anlageName(A.row) : fremd}: ${ursache.length > 200 ? ursache.slice(0, 200) + '…' : ursache} – gemeldet von ${req.ctx.benutzer.name}, einsatzfähig: ${einsatzfaehig === 'ja' ? 'ja' : einsatzfaehig === 'nein' ? 'nein' : 'eingeschränkt'}`, z0
      });
      return mid;
    });
    pruefen();
    res.status(201).json(D.schadenJson(db, db.eins('SELECT * FROM mangel WHERE id = ?', id), stand(), req.ctx));
  });

  api.put(`${R}/schaeden/:id`, (req, res) => {
    const m = schadenAus(req, req.params.id);
    if (!D.istVerwaltung(req.ctx)) throw keinZugriff('Schadensmeldungen bearbeiten nur Fuhrpark, Büro und Geschäftsführung.');
    const body = v.objekt(req.body);
    pruefeVersion(body, m, 'Die Schadensmeldung');
    const alt = D.SCHADEN_STATUS[m.status];
    const status = body.status === undefined ? alt : v.auswahl(body.status, 'status', Object.keys(D.SCHADEN_STATUS_DB));
    if (status !== alt && !SCHADEN_UEBERGANG[alt].includes(status)) throw ungueltig(`Statuswechsel ${alt} → ${status} ist nicht möglich.`);
    const kommentar = body.kommentar === undefined ? m.notiz : v.text(body.kommentar, 'kommentar', { max: 2000, pflicht: false });
    if (status === 'abgelehnt' && !kommentar) throw ungueltig('Zum Ablehnen bitte einen Kommentar angeben.');
    const set = { status: D.SCHADEN_STATUS_DB[status], notiz: kommentar };
    if (body.einsatzfaehig !== undefined) { set.einsatzfaehig = v.auswahl(body.einsatzfaehig, 'einsatzfaehig', EINSATZ); set.dringlichkeit = D.DRINGLICHKEIT[set.einsatzfaehig]; }
    if (body.art !== undefined) set.schaden_art = v.auswahl(body.art, 'art', SCHADEN_ARTEN);
    if (body.eintragId !== undefined) {
      const eid = body.eintragId === null ? null : v.id(body.eintragId, 'eintragId');
      if (eid) { const e = db.eins('SELECT * FROM servicebuch_eintrag WHERE id = ?', eid); if (!e || !m.anlage_id || e.anlage_id !== m.anlage_id || e.storniert) throw ungueltig('Eintrag gehört nicht zur Anlage des Schadens oder ist storniert.'); }
      set.eintrag_id = eid;
    }
    db.transaktion(() => {
      const k = Object.keys(set);
      db.lauf(`UPDATE mangel SET ${k.map((x) => `${x} = ?`).join(', ')}, bearbeitet = ?, bearbeitet_von = ?, version = version + 1 WHERE id = ?`, ...k.map((x) => set[x]), zeit(), req.ctx.benutzer.id, m.id);
      protokoll(req, 'fuhrpark_schaden', `schaden:${m.id}`, `Schaden ${m.id} bearbeitet: ${alt} → ${status}`, { status: alt, einsatzfaehig: m.einsatzfaehig }, { status, kommentar, einsatzfaehig: set.einsatzfaehig, eintragId: set.eintrag_id });
    });
    if (set.einsatzfaehig === 'nein' && m.einsatzfaehig !== 'nein' && m.anlage_id) {
      const A2 = stand().anlagen.get(m.anlage_id);
      E.meldeSperre(db, A2, { titel: `Gerät stillgelegt (Schaden): ${A2.row.bezeichnung}`, text: D.sperrText(A2), zeit: zeit(), schluessel: `fp:mangel:${m.id}:nein`, buero: true });
    }
    pruefen();
    res.json(D.schadenJson(db, db.eins('SELECT * FROM mangel WHERE id = ?', m.id), stand(), req.ctx));
  });

  api.post(`${R}/schaeden/:id/fotos`, (req, res) => {
    const m = schadenAus(req, req.params.id);
    const offen = ['offen', 'in_arbeit'].includes(m.status);
    if (!D.istVerwaltung(req.ctx) && !(m.gemeldet_von === req.ctx.benutzer.id && offen)) throw keinZugriff('Fotos ergänzen kann nur der Melder (bei offener Meldung) bzw. Fuhrpark/Büro/GF.');
    const r = db.transaktion(() => fotoHinzufuegen(req, m, v.objekt(req.body), null));
    res.status(r.neu ? 201 : 200).json(D.fotoJson(r.foto, stand().namen));
  });

  function fotoAus(req) {
    const m = schadenAus(req, req.params.id);
    const f = db.eins('SELECT * FROM schaden_foto WHERE id = ? AND mangel_id = ?', v.pfadId(req.params.fid, 'Foto-ID'), m.id);
    if (!f) throw nichtGefunden('Foto nicht gefunden.');
    return { m, f };
  }

  api.get(`${R}/schaeden/:id/fotos/:fid`, (req, res) => {
    const { m, f } = fotoAus(req);
    let daten;
    try { daten = fs.readFileSync(B.dateiPfad(bt.uploads, f.datei)); } catch (_) { throw nichtGefunden('Fotodatei nicht vorhanden.'); }
    res.setHeader('Content-Type', f.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="schaden-${m.id}-${f.id}.${B.ENDUNG[f.mime]}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.send(daten);
  });

  api.delete(`${R}/schaeden/:id/fotos/:fid`, (req, res) => {
    const { m, f } = fotoAus(req);
    if (!D.istVerwaltung(req.ctx)) throw keinZugriff('Fotos löschen nur Fuhrpark, Büro und Geschäftsführung.');
    const g = req.body && req.body.grund !== undefined ? grund(req.body.grund, false) : null;
    db.transaktion(() => {
      db.lauf('DELETE FROM schaden_foto WHERE id = ?', f.id);
      protokoll(req, 'fuhrpark_schaden', `schaden:${m.id}`, `Foto ${f.id} (${f.dateiname || f.mime}) zu Schaden ${m.id} gelöscht${g ? ': ' + g : ''}`, { fotoId: f.id, sha256: f.sha256, groesse: f.groesse }, null);
    });
    try { fs.unlinkSync(B.dateiPfad(bt.uploads, f.datei)); } catch (_) { /* Datei schon weg */ }
    res.json({ ok: true });
  });

  /* ================= Übersicht, Fristen, Exporte ================= */

  api.get(`${R}/fristen`, pflege, (req, res) => {
    const S = stand();
    const bis = req.query.bis ? v.datum(String(req.query.bis), 'bis') : require('../fuhrpark').plusMonate(S.H, 6);
    const klasse = req.query.klasse ? v.auswahl(String(req.query.klasse), 'klasse', F.KLASSEN) : null;
    const art = req.query.art ? v.auswahl(String(req.query.art), 'art', F.PLAN_ARTEN) : null;
    res.json(D.fristen(S, { bis, klasse, art }).map(({ A, P }) => D.fristJson(A, P)));
  });

  api.get(`${R}/uebersicht`, pflege, (req, res) => {
    const S = stand();
    const anzahl = { einsatzbereit: 0, bald: 0, faellig: 0, gesperrt: 0, ausgeschieden: 0, offeneMaengel: 0, offeneSchaeden: 0 };
    for (const A of S.liste) anzahl[A.status.status]++;
    const alle = D.fristen(S, { bis: plusTage(S.H, 90) });
    const offen = db.alle("SELECT * FROM mangel WHERE status IN ('offen','in_arbeit') ORDER BY gemeldet DESC, id DESC");
    anzahl.offeneMaengel = offen.filter((m) => m.typ === 'mangel').length;
    anzahl.offeneSchaeden = offen.filter((m) => m.typ === 'schaden').length;
    const unpl = db.alle(`SELECT s.*, z.art, z.anlage_id FROM zaehlerstand s JOIN zaehler z ON z.id = s.zaehler_id WHERE s.status = 'unplausibel' ORDER BY s.datum DESC, s.id DESC`);
    const o = {
      anzahl,
      ueberfaellig: alle.filter((x) => x.P.calc.status === 'ueberfaellig').map(({ A, P }) => D.fristJson(A, P)),
      naechsteTermine: alle.filter((x) => x.P.calc.status !== 'ueberfaellig' && x.P.calc.status !== 'unvollstaendig' && x.P.calc.naechstesDatum && x.P.calc.naechstesDatum <= plusTage(S.H, 90)).map(({ A, P }) => D.fristJson(A, P)),
      unvollstaendig: alle.filter((x) => x.P.calc.status === 'unvollstaendig').map(({ A, P }) => D.fristJson(A, P)),
      offeneMaengel: offen.filter((m) => m.typ === 'mangel').map((m) => D.mangelJson(m, S)),
      offeneSchaeden: offen.filter((m) => m.typ === 'schaden').map((m) => D.schadenJson(db, m, S, req.ctx)),
      unplausibleStaende: unpl.map((s) => {
        const A = S.anlagen.get(s.anlage_id);
        return { ...D.standJson(s, S.namen, { anlageId: s.anlage_id, art: s.art }), anlage: A ? { bezeichnung: A.row.bezeichnung, kennzeichen: A.row.kennzeichen } : null };
      }),
      nichtZugeordnet: S.nichtZugeordnet
    };
    if (D.euro(req.ctx)) { const k = D.ladeKosten(db, S.H); o.kostenJahr = Math.round([...k.jahr.values()].reduce((a, x) => a + x, 0) * 100) / 100; }
    res.json(o);
  });

  function mitKosten(req) {
    if (req.query.kosten === undefined || req.query.kosten === '0') return false;
    if (req.query.kosten !== '1') throw ungueltig('kosten muss 0 oder 1 sein.');
    if (!D.euro(req.ctx)) throw keinZugriff('Kosten nur mit dem Recht „Preise sehen“.');
    return true;
  }

  api.get(`${R}/export.csv`, pflege, (req, res) => {
    const art = v.auswahl(String(req.query.art || 'fristen'), 'art', ['fristen', 'eintraege', 'anlagen']);
    const von = req.query.von ? v.datum(String(req.query.von), 'von') : null;
    const bis = req.query.bis ? v.datum(String(req.query.bis), 'bis') : null;
    const kosten = mitKosten(req);
    const S = stand();
    const inhalt = X.csvExport(db, S, { art, von, bis, kosten });
    protokoll(req, 'export', `fuhrpark:${art}`, `Fuhrpark-Export ${art}${kosten ? ' mit Kosten' : ''} erstellt`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="BauTag_Fuhrpark_${art}_${S.H}.csv"`);
    res.send(inhalt);
  });

  api.get(`${R}/anlagen/:id/servicebuch.pdf`, lese, async (req, res) => {
    const S = stand();
    const A = anlageAus(S, req.params.id);
    const kosten = mitKosten(req);
    const firma = db.einstellung('firma', { name: 'Michael Pichler Ges.m.b.H.', ort: '2624 Breitenau' });
    const pdf = await X.servicebuchPdf(db, S, A, { kosten, firma, unkomprimiert: Boolean(bt.pdfUnkomprimiert) });
    protokoll(req, 'export', `anlage:${A.row.id}`, `Servicebuch-PDF ${A.row.bezeichnung}${kosten ? ' mit Kosten' : ''} erstellt`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Servicebuch_${(A.row.nummer || A.row.id)}_${S.H}.pdf"`.replace(/[^\x20-\x7e]/g, '_'));
    res.send(pdf);
  });
};
