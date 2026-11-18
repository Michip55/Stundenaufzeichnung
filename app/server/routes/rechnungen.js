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
    // 15.7 (F-036): Grundrecht vor Existenz – ohne Preisrecht dieselbe 403 für vorhandene und fehlende Rechnungen
    if (!req.ctx.hat('preise_sehen')) throw keinZugriff('Rechnungen sieht, wer das Recht preise_sehen hat.');
    if (schreiben && !req.ctx.hat('preise_bearbeiten')) throw keinZugriff('Rechnungen erfassen Büro bzw. GF.');
    const r = db.eins('SELECT * FROM rechnung WHERE id = ?', v.pfadId(req.params.id, 'Rechnungs-ID'));
    if (!r) throw nichtGefunden('Rechnung nicht gefunden.');
    const bs = db.eins('SELECT * FROM baustelle WHERE id = ?', r.baustelle_id);
    if (!sichtbar(req.ctx, bs)) throw keinZugriff('Rechnungen sieht, wer das Recht preise_sehen hat.');
    if (schreiben && !req.ctx.hat('preise_bearbeiten')) throw keinZugriff('Rechnungen erfassen Büro bzw. GF.');
    return r;
  }
  const antwort = (id) => R.rechnungJson(db, db.eins('SELECT * FROM rechnung WHERE id = ?', id), namen());

  /**
   * Felder aus der Anfrage. alt = gespeicherte Rechnung (PUT) – für die bisherige Schnittstelle ruecklassArt/-Prozent/-Betrag
   * (ein Rücklass) und dafür, dass eine neue Eingabe (Prozent ODER Betrag) die andere Angabe löscht (15.24).
   */
  function felder(body, teil, bsId, alt = null) {
    const f = {};
    const nullOder = (wert, fn) => (wert === null || wert === '' ? null : fn());
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
    // 15.24: USt-Betrag und Brutto wie auf der Rechnung (optional; ohne Angabe gerechnet)
    if (body.ustBetrag !== undefined) f.ust_betrag = nullOder(body.ustBetrag, () => v.betrag(body.ustBetrag, 'ustBetrag', { min: 0, max: 1e9 }));
    if (body.brutto !== undefined) f.brutto = nullOder(body.brutto, () => v.betrag(body.brutto, 'brutto', { min: 0, max: 1e9 }));
    // Netto/USt-Art/Satz geändert, ohne neue Papierwerte → USt/Brutto wieder rechnen (keine veralteten Papierwerte)
    if (teil && ['netto', 'ust_modus', 'ust_satz'].some((k) => f[k] !== undefined)) {
      if (f.ust_betrag === undefined) f.ust_betrag = null;
      if (f.brutto === undefined) f.brutto = null;
    }
    if (body.zahlungszielTage !== undefined) f.zahlungsziel_tage = v.zahl(body.zahlungszielTage, 'zahlungszielTage', { min: 0, max: 365, ganz: true });
    // Skonto: Prozent ODER Betrag (15.24) – gespeichert wird die Eingabe, das andere gerechnet
    if (body.skontoProzent !== undefined) f.skonto_prozent = nullOder(body.skontoProzent, () => v.zahl(body.skontoProzent, 'skontoProzent', { min: 0, max: 10 }));
    if (body.skontoBetrag !== undefined) f.skonto_betrag = nullOder(body.skontoBetrag, () => v.betrag(body.skontoBetrag, 'skontoBetrag', { min: 0, max: 1e9 }));
    // 15.26: oder als „Zahlbetrag mit Skonto“ (Betrag laut Rechnung nach Abzug) – das Skonto in € rechnet pruefeGesamt
    if (body.skontoZahlbetrag !== undefined) f.skonto_zahlbetrag = nullOder(body.skontoZahlbetrag, () => v.betrag(body.skontoZahlbetrag, 'skontoZahlbetrag', { min: 0, max: 1e9 }));
    if (f.skonto_prozent && f.skonto_betrag) throw ungueltig('Skonto entweder in Prozent oder als Betrag angeben, nicht beides.');
    if (f.skonto_zahlbetrag != null && (f.skonto_prozent || f.skonto_betrag)) throw ungueltig('Skonto entweder in Prozent, als Betrag oder als „Zahlbetrag mit Skonto“ angeben – nur eines davon.');
    if (f.skonto_zahlbetrag != null && !(f.skonto_zahlbetrag > 0)) throw ungueltig('Zahlbetrag mit Skonto: bitte den Betrag wie auf der Rechnung eintragen (größer als 0).');
    if (f.skonto_prozent) f.skonto_betrag = null;
    if (f.skonto_betrag) f.skonto_prozent = null;
    if (f.skonto_zahlbetrag != null) f.skonto_prozent = null;
    else if (body.skontoZahlbetrag === undefined && (body.skontoProzent !== undefined || body.skontoBetrag !== undefined)) f.skonto_zahlbetrag = null; // neue Eingabe in % bzw. € ersetzt den Zahlbetrag mit Skonto
    else if (body.skontoZahlbetrag !== undefined && body.skontoProzent === undefined && body.skontoBetrag === undefined && (!alt || alt.skonto_zahlbetrag != null)) f.skonto_betrag = null; // skontoZahlbetrag:null allein → kein Skonto
    if (body.skontoTage !== undefined) f.skonto_tage = nullOder(body.skontoTage, () => v.zahl(body.skontoTage, 'skontoTage', { min: 0, max: 90, ganz: true }));
    // Rücklässe (15.24): Deckungs- und Haftrücklass getrennt, je Prozent (vom Brutto) ODER Betrag
    for (const art of ['deckung', 'haft']) {
      const P = body[`${art}Prozent`], B = body[`${art}Betrag`];
      if (P !== undefined) f[`${art}_prozent`] = nullOder(P, () => v.zahl(P, `${art}Prozent`, { min: 0, max: 20 }));
      if (B !== undefined) f[`${art}_betrag`] = nullOder(B, () => v.betrag(B, `${art}Betrag`, { min: 0, max: 1e9 }));
      if (f[`${art}_prozent`] && f[`${art}_betrag`] != null) throw ungueltig(`${art === 'haft' ? 'Haftrücklass' : 'Deckungsrücklass'}: entweder Prozent oder Betrag angeben, nicht beides.`);
      if (f[`${art}_prozent`]) f[`${art}_betrag`] = null;
      if (f[`${art}_betrag`] != null && P === undefined) f[`${art}_prozent`] = null;
    }
    if (body.haftFreiAb !== undefined) f.haft_frei_ab = v.datum(body.haftFreiAb || null, 'haftFreiAb', { pflicht: false }) || null;
    // bisherige Schnittstelle (ein Rücklass): ruecklassArt + ruecklassProzent/ruecklassBetrag
    if (['ruecklassArt', 'ruecklassProzent', 'ruecklassBetrag'].some((k) => body[k] !== undefined)) {
      if (['deckung', 'haft'].some((a) => body[`${a}Prozent`] !== undefined || body[`${a}Betrag`] !== undefined)) throw ungueltig('Rücklass: entweder deckung…/haft… oder ruecklassArt angeben.');
      const vorhanden = alt ? ['deckung', 'haft'].filter((a) => R.hatRuecklass(alt, a)) : [];
      let art = body.ruecklassArt === undefined ? (vorhanden.length === 1 ? vorhanden[0] : null) : body.ruecklassArt === null ? null : v.auswahl(body.ruecklassArt, 'ruecklassArt', ['haft', 'deckung']);
      if (body.ruecklassArt === undefined && !art) throw ungueltig('ruecklassArt angeben (haft oder deckung).');
      const p = body.ruecklassProzent === undefined ? undefined : body.ruecklassProzent === null ? null : v.zahl(body.ruecklassProzent, 'ruecklassProzent', { min: 0, max: 20 });
      const b = body.ruecklassBetrag === undefined ? undefined : body.ruecklassBetrag === null ? null : v.betrag(body.ruecklassBetrag, 'ruecklassBetrag', { min: 0, max: 1e9 });
      if (body.ruecklassArt !== undefined) for (const a of ['deckung', 'haft']) { f[`${a}_prozent`] = null; f[`${a}_betrag`] = null; }
      if (art) {
        if (p !== undefined) f[`${art}_prozent`] = p;
        else if (body.ruecklassArt !== undefined && alt && vorhanden.length === 1) f[`${art}_prozent`] = alt[`${vorhanden[0]}_prozent`];
        if (b !== undefined) f[`${art}_betrag`] = b;
        else if (body.ruecklassArt !== undefined && alt && vorhanden.length === 1) f[`${art}_betrag`] = alt[`${vorhanden[0]}_betrag`];
      }
    }
    if (body.empfaenger !== undefined) f.empfaenger = body.empfaenger == null ? null : v.text(body.empfaenger, 'empfaenger', { max: 300, pflicht: false }).trim() || null;
    if (body.agZeichen !== undefined) f.ag_zeichen = body.agZeichen == null ? null : v.text(body.agZeichen, 'agZeichen', { max: 100, pflicht: false }).trim() || null;
    if (body.notiz !== undefined) f.notiz = body.notiz == null ? null : v.text(body.notiz, 'notiz', { max: 1000, pflicht: false }) || null;
    if (body.dokumentId !== undefined) {
      if (body.dokumentId === null) f.dokument_id = null;
      else {
        const d = db.eins("SELECT id FROM dokument WHERE id = ? AND baustelle_id = ? AND kategorie = 'ausgangsrechnungen' AND geloescht_zeit IS NULL", v.id(body.dokumentId, 'dokumentId'), bsId);
        if (!d) throw ungueltig('dokumentId: Dokument der Kategorie „Ausgangsrechnungen“ dieser Baustelle nicht gefunden.');
        f.dokument_id = d.id;
      }
    }
    const skonto = f.skonto_prozent || f.skonto_betrag || f.skonto_zahlbetrag;
    if (!teil && ((skonto && !f.skonto_tage) || (f.skonto_tage && !skonto))) throw ungueltig('Skonto: Prozent bzw. Betrag und Frist gemeinsam angeben.');
    return f;
  }

  /**
   * Prüfungen über mehrere Felder auf dem Stand nach dem Speichern (N-019, N-107, 15.24). Beim Ändern (geaendert = Feldnamen)
   * nur die Prüfungen, deren Felder sich ändern – eine Notiz scheitert nicht an früher gespeicherten Werten.
   */
  function pruefeGesamt(m, geaendert = null, f = null) {
    const bei = (...k) => !geaendert || k.some((x) => geaendert.includes(x));
    const BETRAG = ['netto', 'ust_modus', 'ust_satz', 'ust_betrag', 'brutto'];
    const RL = ['deckung_prozent', 'deckung_betrag', 'haft_prozent', 'haft_betrag'];
    const de = (x) => R.r2(x).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (bei('typ', ...RL) && m.typ === 'gutschrift' && (R.hatRuecklass(m, 'deckung') || R.hatRuecklass(m, 'haft'))) throw ungueltig('Eine Gutschrift hat keinen Rücklass.');
    if (bei(...BETRAG)) { const papier = R.pruefePapier(m); if (papier) throw ungueltig(papier.text, { erwartet: papier.erwartet }); }
    let b = R.betraege(m);
    if (bei(...BETRAG, ...RL) && b.ruecklass > b.brutto + 0.005) throw ungueltig(`Der Rücklass (${b.ruecklass.toFixed(2).replace('.', ',')}) ist höher als der Bruttobetrag (${b.brutto.toFixed(2).replace('.', ',')}).`);
    // 15.26 Zahlbetrag mit Skonto: Skonto € = Zahlbetrag − eingetragener Betrag (gespeichert in skonto_betrag; auch neu,
    // wenn sich Brutto oder Rücklass ändern – der Betrag laut Rechnung bleibt die Eingabe)
    const mitZahlbetrag = m.skonto_zahlbetrag != null && bei(...BETRAG, ...RL, 'skonto_zahlbetrag');
    if (mitZahlbetrag) {
      if (!(m.skonto_zahlbetrag < b.zahlbetrag - 0.004)) throw ungueltig(`Der Zahlbetrag mit Skonto (${de(m.skonto_zahlbetrag)}) muss kleiner sein als der Zahlbetrag (${de(b.zahlbetrag)}).`);
      m.skonto_betrag = R.r2(b.zahlbetrag - m.skonto_zahlbetrag);
      m.skonto_prozent = null;
      if (f) { f.skonto_betrag = m.skonto_betrag; f.skonto_prozent = null; }
      b = R.betraege(m);
      if (b.skontoMax > b.zahlbetrag * 0.1 + 0.005) throw ungueltig(`Der Zahlbetrag mit Skonto (${de(m.skonto_zahlbetrag)}) ergibt ein Skonto von ${de(b.skontoMax)} (${String(b.skontoProzent).replace('.', ',')} %) – mehr als 10 % vom Zahlbetrag. Bitte mit der Rechnung vergleichen.`);
    }
    if (bei(...BETRAG, ...RL, 'skonto_betrag') && m.skonto_betrag != null && m.skonto_betrag > 0 && b.skontoMax > b.zahlbetrag * 0.1 + 0.005) throw ungueltig(`Das Skonto (${b.skontoMax.toFixed(2).replace('.', ',')}) ist höher als 10 % vom Zahlbetrag.`);
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
    if (q.typ) { const t = String(q.typ).split(','); liste = liste.filter((r) => t.includes(r.typ)); }
    if (q.auftraggeber) { const a = String(q.auftraggeber).toLowerCase(); liste = liste.filter((r) => String((bs.get(r.baustelle_id) || {}).auftraggeber || '').toLowerCase().includes(a)); }
    let out = liste.map((r) => R.rechnungJson(db, r, n));
    if (q.status) { const st = String(q.status).split(','); out = out.filter((r) => st.includes(r.status)); } // 15.24: auch mehrere (offen,teilbezahlt,ueberfaellig)
    res.json(out);
  });

  api.get('/rechnungen/:id', (req, res) => res.json(antwort(laden(req, false).id)));

  api.post('/baustellen/:id/rechnungen', (req, res) => {
    if (!req.ctx.hat('preise_bearbeiten')) throw keinZugriff('Rechnungen erfassen Büro bzw. GF.'); // 15.7 (F-036)
    const bs = db.eins('SELECT * FROM baustelle WHERE id = ?', v.pfadId(req.params.id, 'Baustellen-ID'));
    if (!bs) throw nichtGefunden('Baustelle nicht gefunden.');
    if (!req.ctx.hat('preise_bearbeiten') || !sichtbar(req.ctx, bs)) throw keinZugriff('Rechnungen erfassen Büro bzw. GF.');
    const f = felder(v.objekt(req.body), false, bs.id);
    pruefeGesamt({ ust_modus: 'normal', ust_satz: 20, ...f }, null, f);
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
    const body = v.objekt(req.body);
    // 15.7 (N-050 Rest): an einer stornierten Rechnung lässt sich nur noch die Verknüpfung des PDF lösen ({version, dokumentId:null}) –
    // sonst bliebe ihr PDF (zeigt Beträge) für immer in „Ausgangsrechnungen“ gesperrt (rechnungZu zählt auch stornierte)
    if (r.storniert && !(body.dokumentId === null && Object.keys(body).every((k) => ['version', 'dokumentId'].includes(k)))) throw konflikt('Die Rechnung ist storniert – nur die Verknüpfung des PDF lässt sich noch lösen (dokumentId:null).');
    if (v.zahl(body.version, 'version', { min: 1, ganz: true }) !== r.version) throw konflikt('Die Rechnung wurde inzwischen geändert.', { version: r.version });
    const f = felder(body, true, r.baustelle_id, r);
    const hatZahlungen = db.eins('SELECT 1 AS x FROM rechnung_zahlung WHERE rechnung_id = ? LIMIT 1', r.id);
    // N-108: nach Zahlungen auch Rechnungsdatum (Fälligkeit, Skontofrist), Skonto und der Wechsel zu/von Gutschrift (Vorzeichen) gesperrt
    const gutschriftWechsel = f.typ !== undefined && (f.typ === 'gutschrift') !== (r.typ === 'gutschrift');
    if (hatZahlungen && (gutschriftWechsel || ['netto', 'ust_modus', 'ust_satz', 'ust_betrag', 'brutto', 'deckung_prozent', 'deckung_betrag', 'haft_prozent', 'haft_betrag', 'datum', 'skonto_prozent', 'skonto_betrag', 'skonto_zahlbetrag', 'skonto_tage'].some((k) => f[k] !== undefined && f[k] !== r[k]))) throw konflikt('Nach erfassten Zahlungen sind Betrag, USt, Rücklass, Rechnungsdatum, Skonto und der Wechsel zu oder von einer Gutschrift gesperrt.');
    pruefeGesamt({ ...r, ...f }, Object.keys(f), f);
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
    // N-053: eine Rechnung mit Zahlungen nicht stornieren – sonst verschwindet das Geld aus Kalkulation und Offenen Posten
    if (db.eins('SELECT 1 AS x FROM rechnung_zahlung WHERE rechnung_id = ? LIMIT 1', r.id)) throw konflikt('Die Rechnung hat Zahlungen – bitte zuerst die Zahlungen löschen, dann stornieren.');
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
      if (!s.skontoMax || !s.skontoBis) throw ungueltig('Diese Rechnung hat kein Skonto.');
      if (datum > s.skontoBis) throw ungueltig('Skonto nur bei Zahlung innerhalb der Skontofrist.');
      if (ruecklass) throw ungueltig('Kein Skonto auf den Rücklass.');
      // N-055: höchstens Skontosatz × Zahlbetrag bzw. der eingetragene Skonto-Betrag (über alle Zahlungen zusammen)
      const rest = R.r2(s.skontoMax - s.skontoGenommen);
      if (skonto > rest + 0.005) throw ungueltig(`Das Skonto ist zu hoch – höchstens ${Math.max(0, rest).toFixed(2).replace('.', ',')} (${r.skonto_betrag != null ? 'laut Rechnung' : `${String(r.skonto_prozent).replace('.', ',')} % vom Zahlbetrag`}).`);
    }
    // 15.24: welcher Rücklass wird ausbezahlt? ohne Angabe der einzige offene
    let ruecklassArt = null;
    if (ruecklass) {
      const offenArten = ['deckung', 'haft'].filter((a) => s[`${a}Offen`] > 0);
      if (!s.deckung && !s.haft) throw ungueltig('Diese Rechnung hat keinen Rücklass.');
      if (body.ruecklassArt != null) ruecklassArt = v.auswahl(body.ruecklassArt, 'ruecklassArt', ['haft', 'deckung']);
      else if (offenArten.length === 1) ruecklassArt = offenArten[0];
      else if (offenArten.length > 1) throw ungueltig('Welcher Rücklass wird ausbezahlt? ruecklassArt angeben (deckung oder haft).');
      else ruecklassArt = s.haft ? 'haft' : 'deckung';
      if (!s[ruecklassArt]) throw ungueltig(`Diese Rechnung hat keinen ${ruecklassArt === 'haft' ? 'Haftrücklass' : 'Deckungsrücklass'}.`);
      if (betrag > s[`${ruecklassArt}Offen`] + 0.005) throw ungueltig(`Die Zahlung übersteigt den offenen ${ruecklassArt === 'haft' ? 'Haftrücklass' : 'Deckungsrücklass'}.`);
    } else if (body.ruecklassArt != null) throw ungueltig('ruecklassArt nur zusammen mit ruecklass:true.');
    if (!ruecklass && betrag + skonto > s.offen + 0.005) throw ungueltig(`Die Zahlung übersteigt den offenen Betrag (${s.offen.toFixed(2).replace('.', ',')}).`);
    const notiz = body.notiz == null ? null : v.text(body.notiz, 'notiz', { max: 300, pflicht: false }) || null;
    const id = db.transaktion(() => {
      const z = db.lauf('INSERT INTO rechnung_zahlung (rechnung_id, datum, betrag, skonto, ruecklass, ruecklass_art, notiz, quelle, erfasst, erfasst_von) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', r.id, datum, betrag, skonto, ruecklass ? 1 : 0, ruecklassArt, notiz, 'manuell', jetzt(), req.ctx.benutzer.id);
      prot(req, `rechnung:${r.id}`, `Zahlungseingang zu ${r.nr} erfasst`, null, { datum, betrag, skonto, ruecklass, ruecklassArt });
      return z.id;
    });
    res.status(201).json({ ...antwort(r.id), zahlungId: id });
  });

  /**
   * 15.24 „Als bezahlt markieren“: eine Buchung über das bestehende Zahlungsmodell (rechnung_zahlung, quelle 'markiert').
   * Vorschlag: Datum heute; innerhalb der Skontofrist offener Betrag minus noch mögliches Skonto (Skonto genommen),
   * sonst der volle offene Betrag. Rücklässe bleiben offen, außer inklRuecklass:true (je offene Art eine Rücklass-Zahlung).
   * Betrag/Skonto/Datum/Notiz änderbar – Prüfungen wie bei POST /zahlungen (Teilzahlung bleibt möglich).
   */
  api.post('/rechnungen/:id/bezahlt', (req, res) => {
    const r = laden(req, true);
    if (r.storniert) throw konflikt('Die Rechnung ist storniert.');
    const body = v.objekt(req.body);
    const datum = body.datum == null ? heute() : v.datum(body.datum, 'datum');
    if (datum > heute()) throw ungueltig('datum liegt in der Zukunft.');
    const inkl = body.inklRuecklass === undefined ? false : v.bool(body.inklRuecklass, 'inklRuecklass');
    const s = R.rechnungStand(db, r, heute());
    const amTag = R.rechnungStand(db, r, datum); // Skonto, das am Zahlungstag noch möglich ist
    const rlArten = inkl ? ['deckung', 'haft'].filter((a) => s[`${a}Offen`] > 0) : [];
    // 15.24 Zahlungsabgleich: Gründe der Differenz zwischen erwartet und tatsächlich bezahlt
    const spaet = !!(s.skontoBis && datum > s.skontoBis);
    const diffs = body.differenzen == null ? null : v.liste(body.differenzen, 'differenzen', { max: 10 }).map((x, i) => {
      const o = v.objekt(x, `differenzen[${i}]`);
      const grund = v.auswahl(o.grund, `differenzen[${i}].grund`, Object.keys(R.DIFF_GRUENDE));
      const betrag = v.betrag(o.betrag, `differenzen[${i}].betrag`, { min: 0.01, max: 1e9 });
      const text = o.text == null ? null : v.text(o.text, `differenzen[${i}].text`, { max: 200, pflicht: false }).trim() || null;
      // Skonto nach der Frist bzw. ohne Skonto-Vereinbarung ist unberechtigt → vorgeschlagen „strittig“
      const verspaetet = grund === 'skonto' && (spaet || !s.skontoMax) ? 1 : 0;
      let status;
      if (grund === 'deckung' || grund === 'haft') status = 'einbehalten';
      else if (grund === 'ueberzahlung') status = 'offen';
      else status = o.status == null && verspaetet ? 'strittig' : v.auswahl(o.status, `differenzen[${i}].status`, ['akzeptiert', 'strittig']);
      if (grund === 'sonstiges' && !text) throw ungueltig(`differenzen[${i}].text: bei „Sonstiges“ bitte den Grund nennen.`);
      return { grund, betrag, text, status, verspaetet };
    });
    if (diffs && r.typ === 'gutschrift') throw ungueltig('Bei einer Gutschrift gibt es keinen Zahlungsabgleich mit Differenzen.');
    if (diffs && diffs.filter((d) => d.grund === 'ueberzahlung').length && diffs.some((d) => d.grund !== 'ueberzahlung')) throw ungueltig('Eine Überzahlung steht allein (mehr bezahlt als erwartet).');
    if (s.offen <= 0 && !rlArten.length) throw konflikt('Die Rechnung ist bereits bezahlt.');
    const basis = s.regulaer; // offen ohne bereits strittige Differenzen
    let skonto = 0, betrag = 0;
    if (s.offen > 0) {
      // ohne Angaben: Skonto, das am Zahlungstag noch möglich ist; mit eigenem Betrag ohne Skonto-Angabe: kein Skonto
      skonto = body.skonto != null ? v.betrag(body.skonto, 'skonto', { min: 0, max: 1e9 }) : (body.betrag != null && !diffs) || r.typ === 'gutschrift' ? 0 : amTag.skontoRest;
      if (skonto > 0) {
        if (!s.skontoMax || !s.skontoBis) throw ungueltig('Diese Rechnung hat kein Skonto.');
        if (datum > s.skontoBis) throw ungueltig('Skonto nur bei Zahlung innerhalb der Skontofrist (verspätetes Skonto als Differenz „Skonto“ erfassen).');
        const rest = R.r2(s.skontoMax - s.skontoGenommen);
        if (skonto > rest + 0.005) throw ungueltig(`Das Skonto ist zu hoch – höchstens ${Math.max(0, rest).toFixed(2).replace('.', ',')}.`);
      }
      betrag = body.betrag == null ? R.r2((diffs ? basis : s.offen) - skonto) : v.betrag(body.betrag, 'betrag', { min: 0, max: 1e9 });
      if (diffs) {
        // erwartet = offen (ohne strittige) − Skonto; Differenz = erwartet − tatsächlich bezahlt muss vollständig aufgeteilt sein
        const erwartet = R.r2(basis - skonto);
        const differenz = R.r2(erwartet - betrag);
        const aufgeteilt = R.r2(diffs.reduce((x, d) => x + (d.grund === 'ueberzahlung' ? -d.betrag : d.betrag), 0));
        if (Math.abs(differenz - aufgeteilt) > 0.005) throw ungueltig(`Die Differenz ist nicht vollständig aufgeteilt: erwartet ${erwartet.toFixed(2).replace('.', ',')}, bezahlt ${betrag.toFixed(2).replace('.', ',')}, Differenz ${differenz.toFixed(2).replace('.', ',')}, aufgeteilt ${aufgeteilt.toFixed(2).replace('.', ',')}.`, { erwartet, differenz, aufgeteilt });
        if (betrag <= 0) throw ungueltig('Tatsächlich bezahlt muss größer als 0 sein.');
      } else if (betrag + skonto > s.offen + 0.005) throw ungueltig(`Die Zahlung übersteigt den offenen Betrag (${s.offen.toFixed(2).replace('.', ',')}).`);
      if (betrag <= 0 && skonto <= 0) throw ungueltig('betrag muss größer als 0 sein.');
    } else if (body.betrag != null || body.skonto != null || diffs) throw ungueltig('Die Rechnung ist bezahlt – nur der Rücklass ist noch offen (ohne Betrag/Skonto).');
    const notiz = body.notiz == null ? null : v.text(body.notiz, 'notiz', { max: 300, pflicht: false }) || null;
    const zeit = jetzt();
    const ids = db.transaktion(() => {
      const neu = [];
      const ein = (b, sk, art) => db.lauf('INSERT INTO rechnung_zahlung (rechnung_id, datum, betrag, skonto, ruecklass, ruecklass_art, notiz, quelle, erfasst, erfasst_von) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', r.id, datum, b, sk, art ? 1 : 0, art, notiz, 'markiert', zeit, req.ctx.benutzer.id).id;
      if (betrag > 0 || skonto > 0) neu.push(ein(betrag, skonto, null));
      for (const d of diffs || []) db.lauf('INSERT INTO rechnung_differenz (rechnung_id, zahlung_id, grund, text, betrag, status, skonto_verspaetet, erfasst, erfasst_von) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', r.id, neu[0], d.grund, d.text, d.betrag, d.status, d.verspaetet, zeit, req.ctx.benutzer.id);
      for (const a of rlArten) neu.push(ein(R.rechnungStand(db, r, heute())[`${a}Offen`], 0, a));
      prot(req, `rechnung:${r.id}`, `Rechnung ${r.nr} als bezahlt markiert${diffs && diffs.length ? ` (Differenz: ${diffs.map((d) => `${R.DIFF_GRUENDE[d.grund]}${d.text ? ' ' + d.text : ''} ${d.betrag.toFixed(2).replace('.', ',')} ${d.status}`).join('; ')})` : ''}`, null, { datum, betrag, skonto, differenzen: diffs, ruecklass: rlArten, zahlungIds: neu });
      return neu;
    });
    res.status(201).json({ ...antwort(r.id), zahlungIds: ids });
  });

  /** 15.24: strittige Differenz später akzeptieren (oder wieder strittig), Überzahlung erledigt/offen – protokolliert */
  api.put('/rechnungen/:id/differenzen/:did', (req, res) => {
    const r = laden(req, true);
    if (r.storniert) throw konflikt('Die Rechnung ist storniert.');
    const d = db.eins('SELECT * FROM rechnung_differenz WHERE id = ? AND rechnung_id = ?', v.pfadId(req.params.did, 'Differenz-ID'), r.id);
    if (!d) throw nichtGefunden('Differenz nicht gefunden.');
    const erlaubt = d.grund === 'ueberzahlung' ? ['offen', 'erledigt'] : ['deckung', 'haft'].includes(d.grund) ? [] : ['akzeptiert', 'strittig'];
    if (!erlaubt.length) throw konflikt('Ein einbehaltener Rücklass wird mit der Rücklass-Zahlung erledigt.');
    const status = v.auswahl(v.objekt(req.body).status, 'status', erlaubt);
    db.transaktion(() => {
      db.lauf('UPDATE rechnung_differenz SET status = ?, geaendert = ?, geaendert_von = ? WHERE id = ?', status, jetzt(), req.ctx.benutzer.id, d.id);
      prot(req, `rechnung:${r.id}`, `Differenz zu ${r.nr} (${R.DIFF_GRUENDE[d.grund]}${d.text ? ' ' + d.text : ''}, ${d.betrag.toFixed(2).replace('.', ',')}): ${d.status} → ${status}`, { status: d.status }, { status });
    });
    res.json(antwort(r.id));
  });

  /** 15.24 „Rückgängig“: löscht die Buchungen einer Markierung (nur quelle 'markiert' dieser Rechnung), protokolliert */
  api.post('/rechnungen/:id/bezahlt/rueckgaengig', (req, res) => {
    const r = laden(req, true);
    if (r.storniert) throw konflikt('Die Rechnung ist storniert.');
    const ids = v.liste(v.objekt(req.body).zahlungIds, 'zahlungIds', { max: 10 }).map((x) => v.id(x, 'zahlungIds'));
    if (!ids.length) throw ungueltig('zahlungIds: mindestens eine Zahlung.');
    const z = ids.map((id) => db.eins("SELECT * FROM rechnung_zahlung WHERE id = ? AND rechnung_id = ? AND quelle = 'markiert'", id, r.id));
    const dz = z.every(Boolean) ? db.alle(`SELECT * FROM rechnung_differenz WHERE zahlung_id IN (${ids.map(() => '?').join(', ')})`, ...ids) : [];
    // keine 404: die Rechnung gibt es (Rechte geprüft) – nur diese Zahlungen sind keine Markierung „bezahlt“ dieser Rechnung
    if (z.some((x) => !x)) throw konflikt('Nur Zahlungen aus „Als bezahlt markieren“ dieser Rechnung lassen sich hier zurücknehmen.');
    db.transaktion(() => {
      for (const x of z) db.lauf('DELETE FROM rechnung_zahlung WHERE id = ?', x.id); // Differenzen hängen an der Zahlung (ON DELETE CASCADE)
      prot(req, `rechnung:${r.id}`, `Markierung „bezahlt“ zu ${r.nr} rückgängig gemacht`, { zahlungen: z.map((x) => ({ id: x.id, datum: x.datum, betrag: x.betrag, skonto: x.skonto, ruecklass: x.ruecklass_art })), differenzen: dz.map((x) => ({ grund: x.grund, text: x.text, betrag: x.betrag, status: x.status })) }, null);
    });
    res.json(antwort(r.id));
  });

  api.delete('/rechnungen/:id/zahlungen/:zid', (req, res) => {
    const r = laden(req, true);
    const z = db.eins('SELECT * FROM rechnung_zahlung WHERE id = ? AND rechnung_id = ?', v.pfadId(req.params.zid), r.id);
    if (!z) throw nichtGefunden('Zahlung nicht gefunden.');
    if (r.storniert) throw konflikt('Die Rechnung ist storniert.'); // N-053
    db.transaktion(() => { db.lauf('DELETE FROM rechnung_zahlung WHERE id = ?', z.id); prot(req, `rechnung:${r.id}`, `Zahlung zu ${r.nr} gelöscht`, { datum: z.datum, betrag: z.betrag, skonto: z.skonto }, null); });
    res.json(antwort(r.id));
  });

  api.post('/rechnungen/:id/mahnungen', (req, res) => {
    const r = laden(req, true);
    const body = v.objekt(req.body);
    const stufe = v.zahl(body.stufe, 'stufe', { min: 1, max: 3, ganz: true });
    const datum = body.datum == null ? heute() : v.datum(body.datum, 'datum');
    const s = R.rechnungStand(db, r, heute());
    if (r.typ === 'gutschrift') throw konflikt('Gutschriften werden nicht gemahnt.'); // N-106
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
    let summeOffen = 0, summeUeber = 0, anzahlUeber = 0, ruecklassSumme = 0, summeStrittig = 0;
    const dauer = [];
    for (const r of alle) {
      const s = R.rechnungStand(db, r, h);
      const b = bs.get(r.baustelle_id);
      if (s.status === 'bezahlt' && s.bezahltAm && s.bezahltAm >= plusTage(h, -365)) dauer.push(R.tageZwischen(r.datum, s.bezahltAm));
      // N-019: Rücklass einer (Alt-)Gutschrift zählt in der Summe negativ
      // 15.24: je Rücklass-Art eine Zeile (Deckungsrücklass frei mit der Schlussrechnung, Haftrücklass ab Freigabe/Gewährleistung)
      for (const art of ['deckung', 'haft']) {
        const o = s[`${art}Offen`];
        if (o > 0) { ruecklassSumme += s.vorzeichen * o; ruecklaesse.push({ rechnungId: r.id, nr: r.nr, typ: r.typ, art, artName: art === 'haft' ? 'Haftrücklass' : 'Deckungsrücklass', baustelle: { id: b.id, kst: b.kst, name: b.name }, ruecklassOffen: o, ruecklassFaellig: art === 'haft' ? s.haftFrei : s.deckungFrei }); }
      }
      if (s.offen <= 0) continue;
      const j = R.rechnungJson(db, r, n);
      const betrag = s.vorzeichen * s.offen;
      summeOffen += betrag;
      if (s.status === 'ueberfaellig') { summeUeber += betrag; anzahlUeber++; }
      const k = (b && b.auftraggeber) || '(ohne Auftraggeber)';
      const a = ag.get(k) || { auftraggeber: k, offen: 0, ueberfaellig: 0, anzahl: 0 };
      a.offen = R.r2(a.offen + betrag); if (s.status === 'ueberfaellig') a.ueberfaellig = R.r2(a.ueberfaellig + betrag); a.anzahl++;
      ag.set(k, a);
      if (s.strittig > 0) summeStrittig += betrag >= 0 ? s.strittig : -s.strittig;
      posten.push({ id: j.id, nr: j.nr, typ: j.typ, baustelle: j.baustelle, datum: j.datum, faellig: j.faellig, brutto: j.brutto, zahlbetrag: j.zahlbetrag, bezahlt: j.bezahlt, offen: j.offen, strittig: j.strittig, status: j.status, ueberfaelligTage: j.ueberfaelligTage, mahnstufe: j.mahnstufe });
    }
    posten.sort((a, b) => a.faellig.localeCompare(b.faellig));
    return {
      summeOffen: R.r2(summeOffen), summeUeberfaellig: R.r2(summeUeber), summeStrittig: R.r2(summeStrittig), anzahlOffen: posten.length, anzahlUeberfaellig: anzahlUeber,
      ruecklaesseOffen: R.r2(ruecklassSumme), zahlungsdauerTage: dauer.length ? Math.round(dauer.reduce((a, x) => a + x, 0) / dauer.length) : null,
      jeAuftraggeber: [...ag.values()].sort((a, b) => b.offen - a.offen), posten, ruecklaesse
    };
  }
  api.get('/offene-posten', (req, res) => res.json(offenePosten(req)));

  /* ---------- Fälligkeiten (15.24): wann was fällig ist – mit und ohne Skonto, Rücklass-Freigaben ---------- */
  const GRUPPEN = [['ueberfaellig', 'Überfällig'], ['diese_woche', 'Diese Woche'], ['naechste_woche', 'Nächste Woche'], ['spaeter', 'Später'], ['differenzen', 'Offene Differenzen']];
  api.get('/faelligkeiten', (req, res) => {
    if (!req.ctx.hat('preise_sehen')) throw keinZugriff('Fälligkeiten sieht, wer das Recht preise_sehen hat.');
    const { wochenbeginn } = require('../datum');
    const h = heute();
    const wocheBis = plusTage(wochenbeginn(h), 6), naechsteBis = plusTage(wochenbeginn(h), 13);
    const gruppeVon = (d) => (!d ? 'spaeter' : d < h ? 'ueberfaellig' : d <= wocheBis ? 'diese_woche' : d <= naechsteBis ? 'naechste_woche' : 'spaeter');
    const bs = bsMap();
    const g = Object.fromEntries(GRUPPEN.map(([k, t]) => [k, { schluessel: k, titel: t, eintraege: [] }]));
    for (const r of db.alle('SELECT * FROM rechnung WHERE storniert IS NULL').filter((x) => sichtbar(req.ctx, bs.get(x.baustelle_id)))) {
      const s = R.rechnungStand(db, r, h);
      const b = bs.get(r.baustelle_id);
      const kopf = { rechnungId: r.id, nr: r.nr, typ: r.typ, typName: R.TYPEN[r.typ], baustelle: { id: b.id, kst: b.kst, name: b.name }, auftraggeber: b.auftraggeber || '' };
      const vz = s.vorzeichen;
      if (s.regulaer > 0) {
        // ohne Skonto: offener Zahlbetrag (Brutto − Rücklässe − Zahlungen − genommenes Skonto − akzeptierte Abzüge, ohne strittige
        // Differenzen) bis zum Zahlungsziel; mit Skonto: zusätzlich minus dem noch möglichen Skonto, nur solange die Skontofrist
        // nicht vorbei ist (nicht bei Gutschriften)
        const mit = r.typ !== 'gutschrift' && s.skontoRest > 0 ? { betrag: R.r2(vz * (s.regulaer - s.skontoRest)), skonto: R.r2(vz * s.skontoRest), bis: s.skontoBis, prozent: s.skontoProzent, tage: r.skonto_tage } : null;
        const datum = mit ? mit.bis : s.faellig;
        g[gruppeVon(datum)].eintraege.push({
          art: r.typ === 'gutschrift' ? 'gutschrift' : 'rechnung', ...kopf, datum,
          mitSkonto: mit, ohneSkonto: { betrag: R.r2(vz * s.regulaer), bis: s.faellig, tage: r.zahlungsziel_tage },
          zahlbetrag: R.r2(vz * s.zahlbetrag), bezahlt: R.r2(vz * s.bezahlt), teilbezahlt: s.bezahlt > 0 || s.skontoGenommen > 0,
          ueberfaelligTage: s.faellig < h ? R.tageZwischen(s.faellig, h) : 0, mahnstufe: s.mahnstufe
        });
      }
      // 15.24: strittige Differenzen (bis zur Höhe des noch offenen strittigen Betrags) und offene Überzahlungen
      let rest = s.strittig;
      for (const d of s.differenzen) {
        if (d.status === 'strittig' && rest > 0.004) {
          const b = Math.min(d.betrag, rest); rest = R.r2(rest - b);
          g.differenzen.eintraege.push({ art: 'differenz', ...kopf, datum: d.erfasst.slice(0, 10), differenzId: d.id, grund: d.grund, grundName: R.DIFF_GRUENDE[d.grund], text: d.text || '', skontoVerspaetet: d.skonto_verspaetet === 1, betrag: R.r2(vz * b) });
        } else if (d.grund === 'ueberzahlung' && d.status === 'offen') g.differenzen.eintraege.push({ art: 'ueberzahlung', ...kopf, datum: d.erfasst.slice(0, 10), differenzId: d.id, grund: d.grund, grundName: R.DIFF_GRUENDE[d.grund], text: d.text || '', betrag: R.r2(-vz * d.betrag) });
      }
      for (const art of ['deckung', 'haft']) {
        const o = s[`${art}Offen`];
        if (!(o > 0)) continue;
        const frei = art === 'haft' ? s.haftFrei : s.deckungFrei;
        g[gruppeVon(frei)].eintraege.push({ art: `${art}ruecklass`, ...kopf, datum: frei, betrag: R.r2(vz * o), freiAb: frei });
      }
    }
    const gruppen = GRUPPEN.map(([k]) => g[k]).map((x) => {
      x.eintraege.sort((a, b) => (a.datum || '9999').localeCompare(b.datum || '9999') || a.nr.localeCompare(b.nr));
      const re = x.eintraege.filter((e) => e.ohneSkonto);
      return {
        ...x, anzahl: x.eintraege.length,
        summeOhneSkonto: R.r2(re.reduce((a, e) => a + e.ohneSkonto.betrag, 0)),
        summeMitSkonto: R.r2(re.reduce((a, e) => a + (e.mitSkonto ? e.mitSkonto.betrag : e.ohneSkonto.betrag), 0)),
        summeRuecklass: R.r2(x.eintraege.filter((e) => /ruecklass$/.test(e.art)).reduce((a, e) => a + e.betrag, 0)),
        summeDifferenz: R.r2(x.eintraege.filter((e) => e.art === 'differenz' || e.art === 'ueberzahlung').reduce((a, e) => a + e.betrag, 0))
      };
    });
    // 15.24 „Offen gesamt“ = offene Zahlbeträge aller Rechnungen (Gutschriften negativ) + einbehaltene Rücklässe;
    // davon überfällig (Zahlungsziel vor heute, ohne Gutschriften), in den nächsten 7 Tagen fällig (Zahlungsziel heute … heute + 7)
    const alleE = gruppen.flatMap((x) => x.eintraege);
    const reE = alleE.filter((e) => e.ohneSkonto);
    const sum = (l, fn) => R.r2(l.reduce((a, e) => a + fn(e), 0));
    // strittige Differenzen gehören zum offenen Rechnungsbetrag (wie in den Offenen Posten); Überzahlungen werden abgezogen
    const strittig = sum(alleE.filter((e) => e.art === 'differenz'), (e) => e.betrag);
    const ueberzahlung = -sum(alleE.filter((e) => e.art === 'ueberzahlung'), (e) => e.betrag);
    const rechnungen = R.r2(sum(reE, (e) => e.ohneSkonto.betrag) + strittig), ruecklaesse = sum(alleE.filter((e) => /ruecklass$/.test(e.art)), (e) => e.betrag);
    const offenGesamt = {
      betrag: R.r2(rechnungen + ruecklaesse - ueberzahlung), rechnungen, ruecklaesse, strittig, ueberzahlung, anzahl: reE.length,
      ueberfaellig: sum(reE.filter((e) => e.art !== 'gutschrift' && e.ohneSkonto.bis < h), (e) => e.ohneSkonto.betrag),
      naechste7Tage: sum(reE.filter((e) => e.ohneSkonto.bis >= h && e.ohneSkonto.bis <= plusTage(h, 7)), (e) => e.ohneSkonto.betrag)
    };
    res.json({ heute: h, wocheBis, naechsteWocheBis: naechsteBis, offenGesamt, gruppen });
  });

  const de = (d) => (d ? d.split('-').reverse().join('.') : '');
  api.get('/offene-posten.csv', (req, res) => {
    const op = offenePosten(req);
    const z = [['Rechnungs-Nr.', 'Art', 'KST', 'Baustelle', 'Auftraggeber', 'Rechnungsdatum', 'Fällig', 'Brutto', 'Zahlbetrag', 'Bezahlt', 'Offen', 'Status', 'Tage überfällig', 'Mahnstufe']];
    const bs = bsMap();
    // N-052: Gutschriften negativ (wie in den Summen), Summenzeilen = summeOffen bzw. ruecklaesseOffen
    const vz = (typ) => (typ === 'gutschrift' ? -1 : 1);
    for (const p of op.posten) { const g = vz(p.typ); z.push([p.nr, R.TYPEN[p.typ], p.baustelle.kst, p.baustelle.name, (bs.get(p.baustelle.id) || {}).auftraggeber || '', de(p.datum), de(p.faellig), R.r2(g * p.brutto), R.r2(g * p.zahlbetrag), R.r2(g * p.bezahlt), R.r2(g * p.offen), p.status, p.ueberfaelligTage, p.mahnstufe]); }
    z.push(['Summe offene Rechnungen', '', '', '', '', '', '', '', '', '', op.summeOffen, '', '', '']);
    for (const x of op.ruecklaesse) z.push([x.nr, x.artName, x.baustelle.kst, x.baustelle.name, '', '', de(x.ruecklassFaellig), '', '', '', R.r2(vz(x.typ) * x.ruecklassOffen), 'ruecklass', '', '']);
    if (op.ruecklaesse.length) z.push(['Summe offene Rücklässe', '', '', '', '', '', '', '', '', '', op.ruecklaesseOffen, '', '', '']);
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
    // N-052/N-053: ohne stornierte Rechnungen; Zahlungen auf Gutschriften (Auszahlungen) negativ; Summenzeile
    const z = [['Datum', 'Rechnungs-Nr.', 'KST', 'Baustelle', 'Auftraggeber', 'Betrag', 'Skonto', 'Rücklass', 'Quelle', 'Notiz', 'Rechnungsart']];
    let summe = 0, summeSkonto = 0;
    for (const x of db.alle('SELECT z.*, r.nr, r.baustelle_id, r.typ FROM rechnung_zahlung z JOIN rechnung r ON r.id = z.rechnung_id WHERE z.datum >= ? AND z.datum <= ? AND r.storniert IS NULL ORDER BY z.datum, z.id', von, bis)) {
      const b = bs.get(x.baustelle_id);
      if (!sichtbar(req.ctx, b)) continue;
      const g = x.typ === 'gutschrift' ? -1 : 1;
      summe += g * x.betrag; summeSkonto += g * x.skonto;
      z.push([de(x.datum), x.nr, b.kst, b.name, b.auftraggeber || '', R.r2(g * x.betrag), R.r2(g * x.skonto), x.ruecklass ? (x.ruecklass_art === 'deckung' ? 'Deckungsrücklass' : x.ruecklass_art === 'haft' ? 'Haftrücklass' : 'ja') : 'nein', x.quelle, x.notiz || '', R.TYPEN[x.typ]]);
    }
    z.push(['Summe', '', '', '', '', R.r2(summe), R.r2(summeSkonto), '', '', '', '']);
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'export', objekt: 'zahlungseingaenge', text: `Zahlungseingänge ${von}–${bis} als CSV exportiert` });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Zahlungseingaenge_${von}_${bis}.csv"`);
    res.send(csv(z));
  });
};
