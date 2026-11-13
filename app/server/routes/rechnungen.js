'use strict';
/** Ausgangsrechnungen, Zahlungen, Offene Posten (API.md 12.17) – € nur mit preise_sehen */
const v = require('../validierung');
const { ungueltig, keinZugriff, nichtGefunden, konflikt } = require('../fehler');
const { darfPreise } = require('../rechte');
const { wienDatum, plusTage } = require('../datum');
const { csv } = require('../export');
const R = require('../rechnungen');

module.exports = function rechnungRouten(api, bt) {
  const { db } = bt;
  const jetzt = () => bt.uhr().toISOString();
  const heute = () => wienDatum(bt.uhr());
  const namen = () => new Map(db.alle('SELECT id, name FROM benutzer').map((b) => [b.id, b.name]));
  const prot = (req, objekt, text, alt, neu) => db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'rechnung', objekt, alt, neu, text });
  const bsMap = () => new Map(db.alle('SELECT * FROM baustelle').map((b) => [b.id, b]));

  function sichtbar(ctx, bs) { return bs && ctx.hat('preise_sehen') && darfPreise(ctx, bs); }
  function laden(req, schreiben) {
    const r = db.eins('SELECT * FROM rechnung WHERE id = ?', v.pfadId(req.params.id, 'Rechnungs-ID'));
    if (!r) throw nichtGefunden('Rechnung nicht gefunden.');
    const bs = db.eins('SELECT * FROM baustelle WHERE id = ?', r.baustelle_id);
    if (!sichtbar(req.ctx, bs)) throw keinZugriff('Rechnungen sehen Büro, GF und der Bauleiter der Baustelle.');
    if (schreiben && !req.ctx.hat('preise_bearbeiten')) throw keinZugriff('Rechnungen erfassen Büro bzw. GF.');
    return r;
  }
  const antwort = (id) => R.rechnungJson(db, db.eins('SELECT * FROM rechnung WHERE id = ?', id), namen());

  function felder(body, teil, bsId) {
    const f = {};
    if (!teil || body.nr !== undefined) {
      f.nr = v.text(body.nr, 'nr', { max: 40 }).trim();
      f.nr_norm = R.nrNorm(f.nr);
      if (!f.nr_norm) throw ungueltig('nr ist ungültig.');
    }
    if (!teil || body.typ !== undefined) f.typ = v.auswahl(body.typ, 'typ', Object.keys(R.TYPEN));
    if (!teil || body.datum !== undefined) f.datum = v.datum(body.datum, 'datum');
    if (body.leistungVon !== undefined) f.leistung_von = v.datum(body.leistungVon, 'leistungVon', { pflicht: false });
    if (body.leistungBis !== undefined) f.leistung_bis = v.datum(body.leistungBis, 'leistungBis', { pflicht: false });
    if (!teil || body.netto !== undefined) f.netto = v.betrag(body.netto, 'netto', { min: 0, max: 1e9 });
    if (body.ustModus !== undefined) f.ust_modus = v.auswahl(body.ustModus, 'ustModus', ['normal', 'reverse_charge']);
    if (body.ustSatz !== undefined) f.ust_satz = v.zahl(body.ustSatz, 'ustSatz', { min: 0, max: 30 });
    if (body.zahlungszielTage !== undefined) f.zahlungsziel_tage = v.zahl(body.zahlungszielTage, 'zahlungszielTage', { min: 0, max: 365, ganz: true });
    if (body.skontoProzent !== undefined) f.skonto_prozent = body.skontoProzent === null ? null : v.zahl(body.skontoProzent, 'skontoProzent', { min: 0, max: 10 });
    if (body.skontoTage !== undefined) f.skonto_tage = body.skontoTage === null ? null : v.zahl(body.skontoTage, 'skontoTage', { min: 0, max: 90, ganz: true });
    if (body.ruecklassArt !== undefined) f.ruecklass_art = body.ruecklassArt === null ? null : v.auswahl(body.ruecklassArt, 'ruecklassArt', ['haft', 'deckung']);
    if (body.ruecklassProzent !== undefined) f.ruecklass_prozent = body.ruecklassProzent === null ? null : v.zahl(body.ruecklassProzent, 'ruecklassProzent', { min: 0, max: 20 });
    if (body.ruecklassBetrag !== undefined) f.ruecklass_betrag = body.ruecklassBetrag === null ? null : v.betrag(body.ruecklassBetrag, 'ruecklassBetrag', { min: 0, max: 1e9 });
    if (body.notiz !== undefined) f.notiz = body.notiz == null ? null : v.text(body.notiz, 'notiz', { max: 1000, pflicht: false }) || null;
    if (body.dokumentId !== undefined) {
      if (body.dokumentId === null) f.dokument_id = null;
      else {
        const d = db.eins("SELECT id FROM dokument WHERE id = ? AND baustelle_id = ? AND kategorie = 'ausgangsrechnungen' AND geloescht_zeit IS NULL", v.id(body.dokumentId, 'dokumentId'), bsId);
        if (!d) throw ungueltig('dokumentId: Dokument der Kategorie „Ausgangsrechnungen“ dieser Baustelle nicht gefunden.');
        f.dokument_id = d.id;
      }
    }
    if ((f.skonto_prozent && !f.skonto_tage && !teil) || (f.skonto_tage && !f.skonto_prozent && !teil)) throw ungueltig('Skonto: Prozent und Frist gemeinsam angeben.');
    return f;
  }

  api.get('/rechnungen', (req, res) => {
    if (!req.ctx.hat('preise_sehen')) throw keinZugriff();
    const q = req.query;
    const bs = bsMap();
    const n = namen();
    let liste = db.alle('SELECT * FROM rechnung ORDER BY datum DESC, id DESC').filter((r) => sichtbar(req.ctx, bs.get(r.baustelle_id)));
    if (q.baustelleId) liste = liste.filter((r) => r.baustelle_id === Number(q.baustelleId));
    if (q.von) liste = liste.filter((r) => r.datum >= String(q.von));
    if (q.bis) liste = liste.filter((r) => r.datum <= String(q.bis));
    if (q.auftraggeber) { const a = String(q.auftraggeber).toLowerCase(); liste = liste.filter((r) => String((bs.get(r.baustelle_id) || {}).auftraggeber || '').toLowerCase().includes(a)); }
    let out = liste.map((r) => R.rechnungJson(db, r, n));
    if (q.status) out = out.filter((r) => r.status === String(q.status));
    res.json(out);
  });

  api.get('/rechnungen/:id', (req, res) => res.json(antwort(laden(req, false).id)));

  api.post('/baustellen/:id/rechnungen', (req, res) => {
    const bs = db.eins('SELECT * FROM baustelle WHERE id = ?', v.pfadId(req.params.id, 'Baustellen-ID'));
    if (!bs) throw nichtGefunden('Baustelle nicht gefunden.');
    if (!req.ctx.hat('preise_bearbeiten') || !sichtbar(req.ctx, bs)) throw keinZugriff('Rechnungen erfassen Büro bzw. GF.');
    const f = felder(v.objekt(req.body), false, bs.id);
    if (db.eins('SELECT id FROM rechnung WHERE nr_norm = ?', f.nr_norm)) throw konflikt(`Die Rechnungsnummer ${f.nr} gibt es bereits.`);
    f.baustelle_id = bs.id; f.erstellt = jetzt(); f.erstellt_von = req.ctx.benutzer.id;
    const k = Object.keys(f);
    const id = db.transaktion(() => {
      const r = db.lauf(`INSERT INTO rechnung (${k.join(', ')}) VALUES (${k.map(() => '?').join(', ')})`, ...k.map((x) => f[x]));
      prot(req, `rechnung:${r.id}`, `${R.TYPEN[f.typ]} ${f.nr} zu ${bs.kst} erfasst`, null, f);
      return r.id;
    });
    res.status(201).json(antwort(id));
  });

  api.put('/rechnungen/:id', (req, res) => {
    const r = laden(req, true);
    if (r.storniert) throw konflikt('Die Rechnung ist storniert.');
    const body = v.objekt(req.body);
    if (v.zahl(body.version, 'version', { min: 1, ganz: true }) !== r.version) throw konflikt('Die Rechnung wurde inzwischen geändert.', { version: r.version });
    const f = felder(body, true, r.baustelle_id);
    const hatZahlungen = db.eins('SELECT 1 AS x FROM rechnung_zahlung WHERE rechnung_id = ? LIMIT 1', r.id);
    if (hatZahlungen && ['netto', 'ust_modus', 'ust_satz', 'ruecklass_art', 'ruecklass_prozent', 'ruecklass_betrag'].some((k) => f[k] !== undefined && f[k] !== r[k])) throw konflikt('Nach erfassten Zahlungen sind Betrag, USt und Rücklass gesperrt.');
    if (f.nr_norm && f.nr_norm !== r.nr_norm && db.eins('SELECT id FROM rechnung WHERE nr_norm = ? AND id <> ?', f.nr_norm, r.id)) throw konflikt('Die Rechnungsnummer gibt es bereits.');
    const k = Object.keys(f);
    if (!k.length) throw ungueltig('Keine Änderungen angegeben.');
    db.transaktion(() => {
      db.lauf(`UPDATE rechnung SET ${k.map((x) => `${x} = ?`).join(', ')}, version = version + 1 WHERE id = ?`, ...k.map((x) => f[x]), r.id);
      prot(req, `rechnung:${r.id}`, `Rechnung ${r.nr} geändert`, Object.fromEntries(k.map((x) => [x, r[x]])), f);
    });
    res.json(antwort(r.id));
  });

  api.post('/rechnungen/:id/storno', (req, res) => {
    const r = laden(req, true);
    if (r.storniert) throw konflikt('Die Rechnung ist bereits storniert.');
    const grund = v.text(v.objekt(req.body).grund, 'grund', { max: 300 });
    if (grund.length < 3) throw ungueltig('grund: mindestens 3 Zeichen.');
    db.transaktion(() => {
      db.lauf('UPDATE rechnung SET storniert = ?, storniert_grund = ?, storniert_von = ?, version = version + 1 WHERE id = ?', jetzt(), grund, req.ctx.benutzer.id, r.id);
      prot(req, `rechnung:${r.id}`, `Rechnung ${r.nr} storniert: ${grund}`, null, { grund });
    });
    res.json(antwort(r.id));
  });

  api.post('/rechnungen/:id/zahlungen', (req, res) => {
    const r = laden(req, true);
    if (r.storniert) throw konflikt('Die Rechnung ist storniert.');
    const body = v.objekt(req.body);
    const datum = v.datum(body.datum, 'datum');
    if (datum > heute()) throw ungueltig('datum liegt in der Zukunft.');
    const betrag = v.betrag(body.betrag, 'betrag', { min: 0, max: 1e9 });
    const skonto = body.skonto == null ? 0 : v.betrag(body.skonto, 'skonto', { min: 0, max: 1e9 });
    const ruecklass = body.ruecklass === undefined ? false : v.bool(body.ruecklass, 'ruecklass');
    if (betrag <= 0 && skonto <= 0) throw ungueltig('betrag muss größer als 0 sein.');
    const s = R.rechnungStand(db, r, heute());
    if (skonto > 0) {
      if (!s.skontoBis || datum > s.skontoBis) throw ungueltig('Skonto nur bei Zahlung innerhalb der Skontofrist.');
      if (ruecklass) throw ungueltig('Kein Skonto auf den Rücklass.');
    }
    if (ruecklass && !r.ruecklass_art) throw ungueltig('Diese Rechnung hat keinen Rücklass.');
    if (!ruecklass && betrag + skonto > s.offen + 0.005) throw ungueltig(`Die Zahlung übersteigt den offenen Betrag (${s.offen.toFixed(2).replace('.', ',')}).`);
    if (ruecklass && betrag > s.ruecklassOffen + 0.005) throw ungueltig('Die Zahlung übersteigt den offenen Rücklass.');
    const notiz = body.notiz == null ? null : v.text(body.notiz, 'notiz', { max: 300, pflicht: false }) || null;
    const id = db.transaktion(() => {
      const z = db.lauf('INSERT INTO rechnung_zahlung (rechnung_id, datum, betrag, skonto, ruecklass, notiz, quelle, erfasst, erfasst_von) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', r.id, datum, betrag, skonto, ruecklass ? 1 : 0, notiz, 'manuell', jetzt(), req.ctx.benutzer.id);
      prot(req, `rechnung:${r.id}`, `Zahlungseingang zu ${r.nr} erfasst`, null, { datum, betrag, skonto, ruecklass });
      return z.id;
    });
    res.status(201).json({ ...antwort(r.id), zahlungId: id });
  });

  api.delete('/rechnungen/:id/zahlungen/:zid', (req, res) => {
    const r = laden(req, true);
    const z = db.eins('SELECT * FROM rechnung_zahlung WHERE id = ? AND rechnung_id = ?', v.pfadId(req.params.zid), r.id);
    if (!z) throw nichtGefunden('Zahlung nicht gefunden.');
    db.transaktion(() => { db.lauf('DELETE FROM rechnung_zahlung WHERE id = ?', z.id); prot(req, `rechnung:${r.id}`, `Zahlung zu ${r.nr} gelöscht`, { datum: z.datum, betrag: z.betrag, skonto: z.skonto }, null); });
    res.json(antwort(r.id));
  });

  api.post('/rechnungen/:id/mahnungen', (req, res) => {
    const r = laden(req, true);
    const body = v.objekt(req.body);
    const stufe = v.zahl(body.stufe, 'stufe', { min: 1, max: 3, ganz: true });
    const datum = body.datum == null ? heute() : v.datum(body.datum, 'datum');
    const s = R.rechnungStand(db, r, heute());
    if (r.storniert || s.offen <= 0) throw konflikt('Keine offene Forderung.');
    if (stufe <= s.mahnstufe) throw konflikt(`Mahnstufe ${s.mahnstufe} ist bereits vermerkt (nur steigend).`);
    db.transaktion(() => { db.lauf('INSERT INTO rechnung_mahnung (rechnung_id, stufe, datum, erfasst, erfasst_von) VALUES (?, ?, ?, ?, ?)', r.id, stufe, datum, jetzt(), req.ctx.benutzer.id); prot(req, `rechnung:${r.id}`, `${R.MAHN[stufe]} zu ${r.nr} vermerkt`, null, { stufe, datum }); });
    res.status(201).json(antwort(r.id));
  });

  /* ---------- Offene Posten ---------- */
  function offenePosten(req) {
    if (!req.ctx.hat('preise_sehen')) throw keinZugriff();
    const bs = bsMap();
    const n = namen();
    const h = heute();
    const alle = db.alle('SELECT * FROM rechnung WHERE storniert IS NULL').filter((r) => sichtbar(req.ctx, bs.get(r.baustelle_id)));
    const posten = [], ruecklaesse = [], ag = new Map();
    let summeOffen = 0, summeUeber = 0, anzahlUeber = 0, ruecklassSumme = 0;
    const dauer = [];
    for (const r of alle) {
      const s = R.rechnungStand(db, r, h);
      const b = bs.get(r.baustelle_id);
      if (s.status === 'bezahlt' && s.bezahltAm && s.bezahltAm >= plusTage(h, -365)) dauer.push(R.tageZwischen(r.datum, s.bezahltAm));
      if (s.ruecklassOffen > 0) { ruecklassSumme += s.ruecklassOffen; ruecklaesse.push({ rechnungId: r.id, nr: r.nr, baustelle: { id: b.id, kst: b.kst, name: b.name }, ruecklassOffen: s.ruecklassOffen, ruecklassFaellig: s.ruecklassFaellig }); }
      if (s.offen <= 0) continue;
      const j = R.rechnungJson(db, r, n);
      const betrag = s.vorzeichen * s.offen;
      summeOffen += betrag;
      if (s.status === 'ueberfaellig') { summeUeber += betrag; anzahlUeber++; }
      const k = (b && b.auftraggeber) || '(ohne Auftraggeber)';
      const a = ag.get(k) || { auftraggeber: k, offen: 0, ueberfaellig: 0, anzahl: 0 };
      a.offen = R.r2(a.offen + betrag); if (s.status === 'ueberfaellig') a.ueberfaellig = R.r2(a.ueberfaellig + betrag); a.anzahl++;
      ag.set(k, a);
      posten.push({ id: j.id, nr: j.nr, typ: j.typ, baustelle: j.baustelle, datum: j.datum, faellig: j.faellig, brutto: j.brutto, zahlbetrag: j.zahlbetrag, bezahlt: j.bezahlt, offen: j.offen, status: j.status, ueberfaelligTage: j.ueberfaelligTage, mahnstufe: j.mahnstufe });
    }
    posten.sort((a, b) => a.faellig.localeCompare(b.faellig));
    return {
      summeOffen: R.r2(summeOffen), summeUeberfaellig: R.r2(summeUeber), anzahlOffen: posten.length, anzahlUeberfaellig: anzahlUeber,
      ruecklaesseOffen: R.r2(ruecklassSumme), zahlungsdauerTage: dauer.length ? Math.round(dauer.reduce((a, x) => a + x, 0) / dauer.length) : null,
      jeAuftraggeber: [...ag.values()].sort((a, b) => b.offen - a.offen), posten, ruecklaesse
    };
  }
  api.get('/offene-posten', (req, res) => res.json(offenePosten(req)));

  const de = (d) => (d ? d.split('-').reverse().join('.') : '');
  api.get('/offene-posten.csv', (req, res) => {
    const op = offenePosten(req);
    const z = [['Rechnungs-Nr.', 'Art', 'KST', 'Baustelle', 'Auftraggeber', 'Rechnungsdatum', 'Fällig', 'Brutto', 'Zahlbetrag', 'Bezahlt', 'Offen', 'Status', 'Tage überfällig', 'Mahnstufe']];
    const bs = bsMap();
    for (const p of op.posten) z.push([p.nr, R.TYPEN[p.typ], p.baustelle.kst, p.baustelle.name, (bs.get(p.baustelle.id) || {}).auftraggeber || '', de(p.datum), de(p.faellig), p.brutto, p.zahlbetrag, p.bezahlt, p.offen, p.status, p.ueberfaelligTage, p.mahnstufe]);
    for (const x of op.ruecklaesse) z.push([x.nr, 'Rücklass', x.baustelle.kst, x.baustelle.name, '', '', de(x.ruecklassFaellig), '', '', '', x.ruecklassOffen, 'ruecklass', '', '']);
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'export', objekt: 'offene-posten', text: 'Offene-Posten-Liste als CSV exportiert' });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Offene_Posten_${heute()}.csv"`);
    res.send(csv(z));
  });
  api.get('/zahlungseingaenge.csv', (req, res) => {
    if (!req.ctx.hat('preise_sehen')) throw keinZugriff();
    const von = req.query.von ? v.datum(String(req.query.von), 'von') : plusTage(heute(), -31);
    const bis = req.query.bis ? v.datum(String(req.query.bis), 'bis') : heute();
    const bs = bsMap();
    const z = [['Datum', 'Rechnungs-Nr.', 'KST', 'Baustelle', 'Auftraggeber', 'Betrag', 'Skonto', 'Rücklass', 'Quelle', 'Notiz']];
    for (const x of db.alle('SELECT z.*, r.nr, r.baustelle_id FROM rechnung_zahlung z JOIN rechnung r ON r.id = z.rechnung_id WHERE z.datum >= ? AND z.datum <= ? ORDER BY z.datum, z.id', von, bis)) {
      const b = bs.get(x.baustelle_id);
      if (!sichtbar(req.ctx, b)) continue;
      z.push([de(x.datum), x.nr, b.kst, b.name, b.auftraggeber || '', x.betrag, x.skonto, x.ruecklass ? 'ja' : 'nein', x.quelle, x.notiz || '']);
    }
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'export', objekt: 'zahlungseingaenge', text: `Zahlungseingänge ${von}–${bis} als CSV exportiert` });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Zahlungseingaenge_${von}_${bis}.csv"`);
    res.send(csv(z));
  });
};
