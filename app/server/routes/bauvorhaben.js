'use strict';
/** Bauvorhaben: Phasen, Fertigmeldung, Archiv, Abschluss, Kennzahlen (API.md 12.15) */
const v = require('../validierung');
const { ungueltig, keinZugriff, konflikt } = require('../fehler');
const { baustelleAusPfad } = require('./hilfe');
const { darfPreise, baustelleImBereich } = require('../rechte');
const { parseJson } = require('../daten');
const { benachrichtige, empfaengerMitRecht } = require('../benachrichtigung');
const BV = require('../bauvorhaben');

module.exports = function bauvorhabenRouten(api, bt, { baustelleJson, sichtbar }) {
  const { db } = bt;
  const jetzt = () => bt.uhr().toISOString();
  const detail = (req, id) => baustelleJson(db, req.ctx, db.eins('SELECT * FROM baustelle WHERE id = ?', id), { detail: true });
  const version = (body, bs) => {
    const x = v.zahl(body.version, 'version', { min: 1, max: 1e9, ganz: true });
    if (x !== bs.version) throw konflikt('Die Baustelle wurde inzwischen geändert. Bitte neu laden.', { version: bs.version });
  };

  api.post('/baustellen/:id/phase', (req, res) => {
    BV.pruefePhaseRecht(req.ctx); // R-07: Recht vor Version; 15.7 (F-036): auch vor Existenz und Body
    const bs = baustelleAusPfad(db, req.params.id);
    const body = v.objekt(req.body);
    version(body, bs);
    db.transaktion(() => BV.wechslePhase(bt, req.ctx, bs, body));
    res.json(detail(req, bs.id));
  });

  api.post('/baustellen/:id/fertigmeldung', (req, res) => {
    const ich = req.ctx.benutzer;
    if (ich.rolle !== 'polier') throw keinZugriff('Die Fertigstellung meldet der Polier der Baustelle; Büro und Bauleiter bestätigen sie über die Phase.'); // 15.7 (F-036): vor Existenz
    const bs = baustelleAusPfad(db, req.params.id);
    // Inhaber 13.11.2026: Bauleiter = Büro – er meldet nicht, er bestätigt (Phasenwechsel „fertiggestellt“)
    const zustaendig = ich.rolle === 'polier' && baustelleImBereich(ich, bs);
    if (!zustaendig) throw keinZugriff('Die Fertigstellung meldet der Polier der Baustelle; Büro und Bauleiter bestätigen sie über die Phase.');
    if (bs.phase !== 'in_arbeit') throw konflikt('Fertigmeldung nur für Baustellen „In Arbeit“.');
    const body = v.objekt(req.body);
    const notiz = body.notiz == null ? '' : v.text(body.notiz, 'notiz', { max: 500, pflicht: false });
    const fm = { von: ich.id, zeit: jetzt(), notiz };
    db.transaktion(() => {
      db.lauf('UPDATE baustelle SET fertigmeldung = ?, version = version + 1 WHERE id = ?', JSON.stringify(fm), bs.id);
      db.protokolliere({ zeit: fm.zeit, benutzerId: ich.id, art: 'baustelle_phase', objekt: `baustelle:${bs.id}`, neu: { fertigmeldung: notiz }, text: `Bauvorhaben ${bs.kst}: Fertigstellung gemeldet von ${ich.name}` });
      const empf = empfaengerMitRecht(db, 'stammdaten', { ohne: ich.id }); // 15.3: Büro und Bauleiter (= Büro) über das Recht
      for (const e of empf) {
        benachrichtige(db, { benutzerId: e.id, typ: 'baustelle', titel: `Fertigstellung gemeldet: ${bs.kurz || bs.name}`, text: `${ich.name} meldet die Baustelle ${bs.kst} als fertiggestellt${notiz ? ` – „${notiz.slice(0, 120)}“` : ''}. Bitte prüfen und bestätigen.`, zeit: fm.zeit, baustelleId: bs.id, schluessel: `bv:fm:${bs.id}:${fm.zeit}` });
      }
    });
    res.status(201).json({ fertigmeldung: { von: { id: ich.id, name: ich.name }, zeit: fm.zeit, notiz } });
  });

  api.post('/baustellen/:id/archiv-aufheben', (req, res) => {
    if (req.ctx.benutzer.rolle !== 'gf') throw keinZugriff('Das Archiv hebt nur die Geschäftsführung auf.');
    const bs = baustelleAusPfad(db, req.params.id);
    if (bs.phase !== 'archiviert') throw konflikt('Die Baustelle ist nicht archiviert.');
    const body = v.objekt(req.body);
    const grund = v.text(body.grund, 'grund', { min: 3, max: 500 });
    const ziel = bs.phase_vor_archiv && BV.PHASEN.includes(bs.phase_vor_archiv) ? bs.phase_vor_archiv : 'bezahlt';
    db.transaktion(() => {
      db.lauf('UPDATE baustelle SET phase = ?, status = ?, phase_seit = ?, archiviert_am = NULL, version = version + 1 WHERE id = ?', ziel, BV.statusAusPhase(ziel), require('../datum').wienDatum(bt.uhr()), bs.id);
      db.lauf('INSERT INTO baustelle_phase (baustelle_id, phase, datum, zeit, von, notiz) VALUES (?, ?, ?, ?, ?, ?)', bs.id, ziel, require('../datum').wienDatum(bt.uhr()), jetzt(), req.ctx.benutzer.id, `Archiv aufgehoben: ${grund}`);
      db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'baustelle_phase', objekt: `baustelle:${bs.id}`, alt: { phase: 'archiviert' }, neu: { phase: ziel, grund }, text: `Bauvorhaben ${bs.kst}: Archiv aufgehoben (${grund})` });
    });
    res.json(detail(req, bs.id));
  });

  api.get('/baustellen/:id/phasen', (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    if (!sichtbar(req.ctx, bs)) throw keinZugriff();
    // N-111: Notizen zum Phasenwechsel (oft mit Rechnungsangaben) nur mit Preisrecht für diese Baustelle – sonst fehlt das Feld
    const mitNotiz = req.ctx.hat('preise_sehen') && darfPreise(req.ctx, bs);
    res.json(db.alle(`SELECT p.*, b.name AS von_name FROM baustelle_phase p LEFT JOIN benutzer b ON b.id = p.von WHERE p.baustelle_id = ? ORDER BY p.zeit, p.id`, bs.id)
      .map((p) => ({ phase: p.phase, phaseName: BV.PHASE_NAMEN[p.phase], von: p.von ? { id: p.von, name: p.von_name } : null, zeit: p.zeit, datum: p.datum, ...(mitNotiz ? { notiz: p.notiz || '' } : {}) })));
  });

  api.put('/baustellen/:id/abschluss', (req, res) => {
    if (!BV.istPlaner(req.ctx)) throw keinZugriff('Gewährleistung und Haftrücklass pflegt, wer das Recht stammdaten hat.'); // 15.7 (F-036): vor Existenz
    const bs = baustelleAusPfad(db, req.params.id);
    const body = v.objekt(req.body);
    version(body, bs);
    const set = {};
    if (body.gewaehrleistungBis !== undefined) set.gewaehrleistung_bis = v.datum(body.gewaehrleistungBis, 'gewaehrleistungBis', { pflicht: false });
    if (body.haftruecklass !== undefined) {
      if (!req.ctx.hat('preise_bearbeiten')) throw keinZugriff('Den Haftrücklass erfassen Büro bzw. GF mit Preisrecht.');
      if (body.haftruecklass === null) set.haftruecklass = null;
      else {
        const h = v.objekt(body.haftruecklass, 'haftruecklass');
        const alt = parseJson(bs.haftruecklass, {}) || {};
        const o = { ...alt };
        if (h.betrag !== undefined) o.betrag = h.betrag === null ? null : v.betrag(h.betrag, 'haftruecklass.betrag', { min: 0, max: 1e8 });
        if (h.prozent !== undefined) o.prozent = h.prozent === null ? null : v.zahl(h.prozent, 'haftruecklass.prozent', { min: 0, max: 100 });
        if (h.bankgarantieBis !== undefined) o.bankgarantieBis = v.datum(h.bankgarantieBis, 'haftruecklass.bankgarantieBis', { pflicht: false });
        if (h.freigabeAm !== undefined) o.freigabeAm = v.datum(h.freigabeAm, 'haftruecklass.freigabeAm', { pflicht: false });
        if (h.freigegeben !== undefined) o.freigegeben = v.bool(h.freigegeben, 'haftruecklass.freigegeben');
        set.haftruecklass = JSON.stringify(o);
      }
    }
    if (!Object.keys(set).length) throw ungueltig('Keine Änderungen angegeben.');
    const k = Object.keys(set);
    db.transaktion(() => {
      db.lauf(`UPDATE baustelle SET ${k.map((x) => `${x} = ?`).join(', ')}, version = version + 1 WHERE id = ?`, ...k.map((x) => set[x]), bs.id);
      db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: set.haftruecklass !== undefined ? 'auftrag' : 'stammdaten', objekt: `baustelle:${bs.id}`, alt: { gewaehrleistung_bis: bs.gewaehrleistung_bis, haftruecklass: parseJson(bs.haftruecklass, null) }, neu: { ...set, haftruecklass: set.haftruecklass === undefined ? undefined : parseJson(set.haftruecklass, null) }, text: `Bauvorhaben ${bs.kst}: Gewährleistung/Haftrücklass geändert` });
    });
    res.json(detail(req, bs.id));
  });

  api.get('/baustellen-kennzahlen', (req, res) => {
    // 15.4 (F-019/F-021): allein das Recht stammdaten – kein Teilumfang „eigene Baustellen“ über bauleiterId
    if (!BV.istPlaner(req.ctx)) throw keinZugriff('Kennzahlen der Bauvorhaben sieht, wer das Recht stammdaten hat.');
    const liste = db.alle('SELECT * FROM baustelle WHERE intern = 0');
    const phasen = Object.fromEntries(BV.PHASEN.map((p) => [p, 0]));
    for (const b of liste) phasen[b.phase]++;
    const heute = require('../datum').wienDatum(bt.uhr());
    const offen = liste.filter((b) => b.phase === 'schlussrechnung');
    const o = {
      phasen,
      fertigmeldungenOffen: liste.filter((b) => b.fertigmeldung && b.phase === 'in_arbeit').length,
      abnahmeOhneSchlussrechnung: liste.filter((b) => b.phase === 'abgenommen' && b.abnahme_datum && require('../datum').plusTage(b.abnahme_datum, 14) < heute).length,
      offeneSchlussrechnungen: { anzahl: offen.length }
    };
    if (offen.every((b) => darfPreise(req.ctx, b)) && req.ctx.hat('preise_sehen')) {
      // N-057: offener Betrag der erfassten (nicht stornierten) Schlussrechnungen.
      // 15.7 (Rest N-057): EINE Basis je Feld – `summe` = offener Zahlbetrag (brutto abzüglich Rücklass, wie Offene Posten);
      // der Phasen-Betrag (netto, ohne erfasste Schlussrechnung) wird nicht mehr hineingemischt, sondern getrennt ausgewiesen
      const R = require('../rechnungen');
      let summe = 0, ohneAnzahl = 0, ohneNetto = 0;
      for (const b of offen) {
        const sr = db.alle("SELECT * FROM rechnung WHERE baustelle_id = ? AND typ = 'schluss' AND storniert IS NULL", b.id);
        if (sr.length) summe += sr.reduce((x, r) => x + R.rechnungStand(db, r).offen, 0);
        else { ohneAnzahl += 1; ohneNetto += (parseJson(b.schlussrechnung, {}) || {}).betrag || 0; }
      }
      o.offeneSchlussrechnungen.summe = R.r2(summe);
      if (ohneAnzahl) o.offeneSchlussrechnungen.ohneRechnung = { anzahl: ohneAnzahl, netto: R.r2(ohneNetto) };
    }
    res.json(o);
  });
};
