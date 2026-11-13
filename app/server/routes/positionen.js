'use strict';
/** Nachkalkulation nach Positionen – Routen (API.md Abschnitt 10) */
const v = require('../validierung');
const { ungueltig, keinZugriff, nichtGefunden, konflikt } = require('../fehler');
const { darfKalk, darfPreise } = require('../rechte');
const { parseJson } = require('../daten');
const { GRUPPEN, GRUPPEN_SCHLUESSEL, leseVorlage, schreibeExport, pruefeZip, ladeAnpassungen } = require('../katalog-excel');
const { katalogKopieren, projektPositionen, positionJson, einheitNorm } = require('../positionen');
const { schluessel } = require('../positionen-zuordnung');
const { pruefeBudget } = require('../budget');
const { wienDatum, plusTage } = require('../datum');
const { brauche, baustelleAusPfad } = require('./hilfe');
const { kalkulationFuer } = require('../daten');
const PV = require('../preise-verlauf');

const ARTEN = ['personal', 'geraet', 'material', 'naturmaterial'];

module.exports = function positionenRouten(api, bt) {
  const { db } = bt;
  const jetzt = () => bt.uhr().toISOString();
  const prot = (req, objekt, text, alt, neu) => db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'nachkalkulation', objekt, alt, neu, text });

  /* ---------- Prüfungen ---------- */
  function pruefeQuelle(q) {
    if (q === null) return null;
    v.objekt(q, 'quelle');
    const art = v.auswahl(q.art, 'quelle.art', ARTEN);
    if (art === 'naturmaterial') return { art }; // Landschaftsabgabe: Σ Tonnen Naturmaterial
    const refs = Array.isArray(q.ref) ? v.liste(q.ref, 'quelle.ref', { max: 30 }) : [q.ref];
    if (!refs.length) throw ungueltig('quelle.ref: mindestens ein Eintrag.');
    const gueltig = new Set(art === 'personal' ? db.alle('SELECT id FROM lohngruppe').map((x) => x.id)
      : art === 'geraet' ? db.alle('SELECT code FROM geraet').map((x) => x.code) : db.alle('SELECT code FROM material').map((x) => x.code));
    for (const r of refs) {
      if (typeof r !== 'string' || (r !== 'alle' && !gueltig.has(r))) throw ungueltig(`quelle.ref „${r}“ ist für ${art} unbekannt.`);
    }
    const o = { art, ref: refs };
    if (q.faktor !== undefined && q.faktor !== null) o.faktor = v.zahl(q.faktor, 'quelle.faktor', { min: 0.0001, max: 10000 });
    return o;
  }

  /**
   * @param {object} body
   * @param {boolean} teil  Teil-Update
   * @param {object} [alt]  bisherige Zeile (Katalog oder Projekt) für die Schutzregeln (E-01)
   */
  function pruefeFelder(body, teil, alt) {
    const f = {};
    if (!teil || body.gruppe !== undefined) f.gruppe = v.auswahl(body.gruppe, 'gruppe', GRUPPEN_SCHLUESSEL);
    if (!teil || body.bezeichnung !== undefined) f.bezeichnung = v.text(body.bezeichnung, 'bezeichnung', { max: 200 });
    if (!teil || body.einheit !== undefined) f.einheit = v.text(body.einheit, 'einheit', { max: 20 });
    if (!teil || body.ep !== undefined) f.ep = v.betrag(body.ep, 'ep', { min: 0, max: 1e6 });
    if (body.aktiv !== undefined) f.aktiv = v.bool(body.aktiv, 'aktiv') ? 1 : 0;
    if (body.sortierung !== undefined) f.sortierung = v.zahl(body.sortierung, 'sortierung', { min: 0, max: 1e6, ganz: true });
    if (body.quelle !== undefined) {
      // E-01: die automatische Landschaftsabgabe nie stillschweigend entfernen
      const altQ = alt ? parseJson(alt.quelle, null) : null;
      if (body.quelle === null && altQ && altQ.art === 'naturmaterial' && body.naturmaterialQuelleEntfernen !== true) {
        throw ungueltig('Diese Position rechnet automatisch aus den Tonnen Naturmaterial (Landschaftsabgabe). Zum Entfernen der Quelle zusätzlich naturmaterialQuelleEntfernen:true senden.');
      }
      f.quelle = body.quelle === null ? null : JSON.stringify(pruefeQuelle(body.quelle));
      f.zuordnung_pruefen = 0; // bewusst gesetzt
    }
    if (body.naturmaterial !== undefined) { f.naturmaterial = v.bool(body.naturmaterial, 'naturmaterial') ? 1 : 0; f.naturmaterial_pruefen = 0; }
    // E-01: Naturmaterial nur bei Einheit t
    const einheitNeu = f.einheit ?? (alt ? alt.einheit : undefined);
    if (einheitNeu !== undefined && einheitNorm(einheitNeu) !== 't') {
      if (f.naturmaterial === 1) throw ungueltig('Naturmaterial kann nur bei Positionen mit der Einheit t gesetzt werden.');
      if (alt && alt.naturmaterial === 1 && f.einheit !== undefined) f.naturmaterial = 0;
    }
    if (body.zuordnungPruefen !== undefined) f.zuordnung_pruefen = v.bool(body.zuordnungPruefen, 'zuordnungPruefen') ? 1 : 0;
    return f;
  }

  /** EP-Änderung aus den Feldern lösen → Stand mit gueltigAb (API.md 12.2) */
  function epAenderung(f, body) {
    if (f.ep === undefined) return null;
    const wert = f.ep;
    delete f.ep;
    return { wert, ...PV.pruefeGueltigAb(db, body.gueltigAb, body.rueckwirkend) };
  }

  function lesen(req, bs) {
    if (!darfKalk(req.ctx, bs)) throw keinZugriff('Die Nachkalkulation sehen Büro, GF und der Bauleiter der Baustelle.');
  }
  function schreibenPreise(req) {
    if (!req.ctx.hat('preise_bearbeiten')) throw keinZugriff('Positionen und Preise ändern Büro bzw. Geschäftsführung.');
  }
  function schreibenMengen(req, bs) {
    const ich = req.ctx.benutzer;
    if (!(req.ctx.hat('preise_bearbeiten') || (ich.rolle === 'bauleiter' && bs.bauleiter_id === ich.id && darfKalk(req.ctx, bs)))) {
      throw keinZugriff('Mengen erfassen Büro, GF und der Bauleiter der Baustelle.');
    }
  }
  function position(bs, pidText) {
    const pid = v.pfadId(pidText, 'Positions-ID');
    const p = db.eins('SELECT * FROM projektposition WHERE id = ? AND baustelle_id = ?', pid, bs.id);
    if (!p) throw nichtGefunden('Position nicht gefunden.');
    return p;
  }

  /** Antwort für die Baustelle; ohne preise_sehen keine €-Werte */
  function antwort(req, bs) {
    const k = kalkulationFuer(db, bs);
    const r = projektPositionen(db, bs, k.auftragGesamt);
    const mitPreis = darfPreise(req.ctx, bs);
    const gruppen = r.gruppen.map((g) => ({
      schluessel: g.schluessel, name: g.name,
      ...(mitPreis ? { summe: g.summe, anteilProzent: g.anteilProzent } : {}),
      positionen: g.positionen.map((p) => {
        if (mitPreis) return p;
        const { ep, summe, perioden, epGeplant, ...rest } = p; // eslint-disable-line no-unused-vars
        // E-08: PA/VE-Mengen sind Rechnungsbeträge in € – ohne preise_sehen nur die Anzahl der Einträge
        if (['pa', 've'].includes(String(p.einheit).trim().toLowerCase())) {
          const { menge, mengeAuto, mengeManuell, eintraege, ...ohne } = rest; // eslint-disable-line no-unused-vars
          return { ...ohne, eintraegeAnzahl: (eintraege || []).length };
        }
        return rest;
      })
    }));
    const o = { baustelleId: bs.id, gruppen, budgetVerbrauchProzent: r.budgetVerbrauchProzent, positionenFehlen: r.positionenFehlen, hinweise: r.hinweise, stand: db.einstellung('katalog_stand', null) };
    if (mitPreis) Object.assign(o, { rechnungen: require('../rechnungen').summenBaustelle(db, bs.id), auftragGesamt: r.auftragGesamt, gesamtsumme: r.gesamtsumme, anteilSummeProzent: r.anteilSummeProzent, ergebnis: r.ergebnis, ergebnisProzent: r.ergebnisProzent });
    return o;
  }

  const budget = (req, bs, anlass) => pruefeBudget(bt, bs.id, { anlass, benutzerId: req.ctx.benutzer.id });

  /* ---------- Katalog (Firmenvorlage) ---------- */

  function katalogJson() {
    const alle = db.alle('SELECT * FROM katalog ORDER BY sortierung, id');
    const seit = PV.gueltigSeit(db, 'katalog'), plan = PV.geplant(db, 'katalog');
    return {
      stand: db.einstellung('katalog_stand', null),
      gruppen: GRUPPEN.map((g) => ({
        schluessel: g.schluessel, name: g.name,
        positionen: alle.filter((k) => k.gruppe === g.schluessel).map((k) => ({
          id: k.id, gruppe: k.gruppe, bezeichnung: k.bezeichnung, einheit: k.einheit, ep: k.ep, sortierung: k.sortierung,
          quelle: parseJson(k.quelle, null), zuordnungPruefen: k.zuordnung_pruefen === 1,
          naturmaterial: k.naturmaterial === 1, naturmaterialPruefen: k.naturmaterial_pruefen === 1, naturmaterialMoeglich: einheitNorm(k.einheit) === 't', herkunft: k.herkunft, aktiv: k.aktiv === 1, version: k.version,
          epAb: (seit.get(String(k.id)) || {}).ep || PV.BASIS_DATUM,
          ...(plan.has(String(k.id)) ? { epGeplant: plan.get(String(k.id)).map((x) => ({ id: x.id, ep: x.wert, gueltigAb: x.gueltigAb })) } : {})
        }))
      }))
    };
  }

  api.get('/positionen/katalog', brauche('preise_sehen'), (req, res) => res.json(katalogJson()));

  api.post('/positionen/katalog', brauche('preise_bearbeiten'), (req, res) => {
    const f = pruefeFelder(v.objekt(req.body), false);
    const sort = f.sortierung ?? ((db.eins('SELECT MAX(sortierung) AS m FROM katalog WHERE gruppe = ?', f.gruppe).m || 0) + 10);
    const r = db.lauf('INSERT INTO katalog (gruppe, bezeichnung, einheit, ep, sortierung, quelle, zuordnung_pruefen, aktiv, version, geaendert, naturmaterial) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)',
      f.gruppe, f.bezeichnung, f.einheit, f.ep, sort, f.quelle ?? null, f.zuordnung_pruefen ?? 0, jetzt(), f.naturmaterial ?? 0);
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'katalog', objekt: `katalog:${r.id}`, neu: f, text: `Katalog: Position „${f.bezeichnung}“ angelegt` });
    res.status(201).json(katalogJson().gruppen.flatMap((g) => g.positionen).find((p) => p.id === r.id));
  });

  api.put('/positionen/katalog/:id', brauche('preise_bearbeiten'), (req, res) => {
    const id = v.pfadId(req.params.id, 'Katalog-ID');
    const alt = db.eins('SELECT * FROM katalog WHERE id = ?', id);
    if (!alt) throw nichtGefunden('Katalogposition nicht gefunden.');
    const body = v.objekt(req.body);
    if (body.version !== undefined && v.zahl(body.version, 'version', { min: 1, ganz: true }) !== alt.version) throw konflikt('Die Katalogposition wurde inzwischen geändert. Bitte neu laden.', { version: alt.version });
    const f = pruefeFelder(body, true, alt);
    if (!Object.keys(f).length) throw ungueltig('Keine Änderungen angegeben.');
    const ep = epAenderung(f, body);
    const k = Object.keys(f);
    db.transaktion(() => {
      db.lauf(`UPDATE katalog SET ${[...k.map((x) => `${x} = ?`), 'version = version + 1', 'geaendert = ?'].join(', ')} WHERE id = ?`, ...k.map((x) => f[x]), jetzt(), id);
      if (ep) PV.setzePreis(db, { art: 'katalog', ref: id, feld: 'ep', wert: ep.wert, gueltigAb: ep.gueltigAb, benutzerId: req.ctx.benutzer.id, jetzt: bt.uhr() });
      const a = {}; for (const x of k) a[x] = alt[x];
      if (ep) a.ep = alt.ep;
      db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'katalog', objekt: `katalog:${id}`, alt: a, neu: { ...f, ...(ep ? { ep: ep.wert, gueltigAb: ep.gueltigAb, ...(ep.rueckwirkend ? { rueckwirkend: true } : {}) } : {}) }, text: `Katalog: „${alt.bezeichnung}“ geändert${ep ? ` (EP ab ${ep.gueltigAb.split('-').reverse().join('.')})` : ''} (bestehende Baustellen unverändert)` });
    });
    res.json(katalogJson().gruppen.flatMap((g) => g.positionen).find((p) => p.id === id));
  });

  api.delete('/positionen/katalog/:id', brauche('preise_bearbeiten'), (req, res) => {
    const id = v.pfadId(req.params.id, 'Katalog-ID');
    const alt = db.eins('SELECT * FROM katalog WHERE id = ?', id);
    if (!alt) throw nichtGefunden('Katalogposition nicht gefunden.');
    db.lauf('UPDATE katalog SET aktiv = 0, version = version + 1, geaendert = ? WHERE id = ?', jetzt(), id);
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'katalog', objekt: `katalog:${id}`, text: `Katalog: „${alt.bezeichnung}“ deaktiviert` });
    res.json({ ok: true });
  });

  /** Nur ein Import gleichzeitig (E-02) */
  let importLaeuft = false;

  api.post('/positionen/katalog/import', brauche('preise_bearbeiten'), async (req, res) => {
    if (importLaeuft) throw konflikt('Es läuft bereits ein Excel-Import. Bitte kurz warten und erneut versuchen.');
    importLaeuft = true;
    try {
      const body = v.objekt(req.body);
      if (typeof body.dateiBase64 !== 'string' || !body.dateiBase64.length) throw ungueltig('dateiBase64 fehlt (Excel-Datei als Base64).');
      const b64 = body.dateiBase64.replace(/^data:[^,]*,/, '');
      if (!/^[A-Za-z0-9+/\r\n]+={0,2}$/.test(b64)) throw ungueltig('dateiBase64 ist kein gültiges Base64.');
      const buf = Buffer.from(b64, 'base64');
      let gelesen;
      try {
        pruefeZip(buf); // E-02: ZIP-Bomben vor dem Lesen abweisen
        gelesen = await leseVorlage(buf);
      } catch (e) { throw ungueltig(`Die Excel-Datei wurde abgewiesen: ${e.message}`); }
      if (!gelesen.positionen.length) throw ungueltig('In der Datei wurden keine Positionen im Aufbau der Vorlage gefunden (Summenzeilen „Summe Arbeit“ … „Summe Abgaben“).');
      const uebernehmen = req.query.uebernehmen === '1';
      const ueberschreiben = req.query.anpassungenUeberschreiben === '1';

      // E-04: 10d-Umbenennungen und freigegebene Preise kennen
      const anp = ladeAnpassungen();
      const umbenennung = new Map(anp.flatMap((a) => (a.umbenennungen || []).map((u) => [schluessel(u.alt, u.einheit), u.neu])));
      const geschuetzt = new Map(anp.flatMap((a) => (a.preise || []).map((pr) => [schluessel(pr.bezeichnung, pr.einheit), { ep: pr.ep, version: a.version }])));
      const bestand = new Map(db.alle('SELECT * FROM katalog').map((k) => [`${k.gruppe}|${schluessel(k.bezeichnung, k.einheit)}`, k]));
      const neu = [], geaendert = [], fehler = [], doppelt = [], umbenannt = [];
      const gesehen = new Set();
      let unveraendert = 0;
      for (const p of gelesen.positionen) {
        // E-05: dieselben Regeln wie POST /positionen/katalog
        const zf = [];
        if (!p.bezeichnung || (p.laenge && p.laenge.bezeichnung > 200) || p.bezeichnung.length > 200) zf.push('Bezeichnung fehlt oder ist länger als 200 Zeichen');
        if (!p.einheit || (p.laenge && p.laenge.einheit > 20) || p.einheit.length > 20) zf.push('Einheit fehlt oder ist länger als 20 Zeichen');
        if (!(Number.isFinite(p.ep) && p.ep >= 0 && p.ep <= 1e6)) zf.push(`EP ${p.ep} liegt nicht zwischen 0 und 1.000.000`);
        if (zf.length) { fehler.push({ zeile: p.zeile, text: `${p.bezeichnung.slice(0, 60)}: ${zf.join('; ')}.` }); continue; }
        const ep = Math.round((p.ep + Number.EPSILON) * 100) / 100;
        let name = p.bezeichnung;
        const umb = umbenennung.get(schluessel(name, p.einheit));
        if (umb && !bestand.has(`${p.gruppe}|${schluessel(name, p.einheit)}`) && bestand.has(`${p.gruppe}|${schluessel(umb, p.einheit)}`)) {
          umbenannt.push({ alt: name, neu: umb, zeile: p.zeile });
          name = umb;
        }
        const key = `${p.gruppe}|${schluessel(name, p.einheit)}`;
        if (gesehen.has(key)) { doppelt.push({ zeile: p.zeile, bezeichnung: name, einheit: p.einheit }); continue; }
        gesehen.add(key);
        const k = bestand.get(key);
        if (!k) { neu.push({ gruppe: p.gruppe, bezeichnung: name, einheit: p.einheit, ep, zeile: p.zeile }); continue; }
        if (Math.abs(k.ep - ep) > 1e-9 || !k.aktiv) {
          const g = { id: k.id, gruppe: p.gruppe, bezeichnung: k.bezeichnung, einheit: k.einheit, epAlt: k.ep, epNeu: ep, wiederAktiv: !k.aktiv };
          const s10d = geschuetzt.get(schluessel(k.bezeichnung, k.einheit));
          if (s10d && Math.abs(k.ep - s10d.ep) < 1e-9 && Math.abs(ep - k.ep) > 1e-9) {
            Object.assign(g, { geschuetzt: true, anpassung: s10d.version, hinweis: 'weicht von Preisliste-2026-Anpassung ab' });
          }
          geaendert.push(g);
        } else unveraendert++;
      }
      const ohneSummenzeile = gelesen.offen.map((p) => ({ zeile: p.zeile, bezeichnung: p.bezeichnung }));
      const gab = uebernehmen ? PV.pruefeGueltigAb(db, req.query.gueltigAb, req.query.rueckwirkend === '1') : null;
      if (uebernehmen) {
        if (fehler.length) throw ungueltig(`Die Datei enthält ${fehler.length} ungültige Zeile(n) – nichts übernommen.`, { zeilenFehler: fehler });
        db.transaktion(() => {
          for (const p of neu) {
            const sort = (db.eins('SELECT MAX(sortierung) AS m FROM katalog WHERE gruppe = ?', p.gruppe).m || 0) + 10;
            db.lauf("INSERT INTO katalog (gruppe, bezeichnung, einheit, ep, sortierung, aktiv, version, geaendert, herkunft) VALUES (?, ?, ?, ?, ?, 1, 1, ?, 'vorlage_excel')", p.gruppe, p.bezeichnung, p.einheit, p.ep, sort, jetzt());
          }
          for (const g of geaendert) {
            if (g.geschuetzt && !ueberschreiben) continue;
            db.lauf('UPDATE katalog SET aktiv = 1, version = version + 1, geaendert = ? WHERE id = ?', jetzt(), g.id);
            if (Math.abs(g.epNeu - g.epAlt) > 1e-9) PV.setzePreis(db, { art: 'katalog', ref: g.id, feld: 'ep', wert: g.epNeu, gueltigAb: gab.gueltigAb, benutzerId: req.ctx.benutzer.id, jetzt: bt.uhr() });
          }
          db.setzeEinstellung('katalog_stand', wienDatum(bt.uhr()));
          db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'katalog', objekt: 'katalog',
            neu: { neu: neu.length, geaendert: geaendert.filter((g) => !g.geschuetzt || ueberschreiben).length, geschuetztBehalten: ueberschreiben ? 0 : geaendert.filter((g) => g.geschuetzt).length },
            text: `Katalog aus Excel übernommen: ${neu.length} neu, ${geaendert.length} geändert` });
        });
      }
      res.json({ uebernommen: uebernehmen, neu, geaendert, unveraendert, umbenannt, fehler, doppelt, ohneSummenzeile });
    } finally {
      importLaeuft = false;
    }
  });

  /* ---------- Projektpositionen ---------- */

  api.get('/baustellen/:id/positionen', (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    lesen(req, bs);
    res.json(antwort(req, bs));
  });

  api.post('/baustellen/:id/positionen', (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    lesen(req, bs); schreibenPreise(req);
    const f = pruefeFelder(v.objekt(req.body), false);
    const sort = f.sortierung ?? ((db.eins('SELECT MAX(sortierung) AS m FROM projektposition WHERE baustelle_id = ? AND gruppe = ?', bs.id, f.gruppe).m || 0) + 10);
    const r = db.lauf(`INSERT INTO projektposition (baustelle_id, katalog_id, gruppe, bezeichnung, einheit, ep, sortierung, quelle, zuordnung_pruefen, aktiv, version, erstellt, geaendert, naturmaterial)
      VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`, bs.id, f.gruppe, f.bezeichnung, f.einheit, f.ep, sort, f.quelle ?? null, f.zuordnung_pruefen ?? 0, jetzt(), jetzt(), f.naturmaterial ?? 0);
    prot(req, `baustelle:${bs.id}`, `Nachkalkulation ${bs.kst}: eigene Position „${f.bezeichnung}“ angelegt`, null, f);
    budget(req, bs, 'neue Position');
    res.status(201).json(positionJson(db.eins('SELECT * FROM projektposition WHERE id = ?', r.id)));
  });

  api.put('/baustellen/:id/positionen/:pid', (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    lesen(req, bs); schreibenPreise(req);
    const p = position(bs, req.params.pid);
    const body = v.objekt(req.body);
    const version = v.zahl(body.version, 'version', { min: 1, ganz: true });
    if (version !== p.version) throw konflikt('Die Position wurde inzwischen geändert. Bitte neu laden.', { version: p.version });
    const f = pruefeFelder(body, true, p);
    if (!Object.keys(f).length) throw ungueltig('Keine Änderungen angegeben.');
    const ep = epAenderung(f, body);
    const k = Object.keys(f);
    db.transaktion(() => {
      db.lauf(`UPDATE projektposition SET ${[...k.map((x) => `${x} = ?`), 'version = version + 1', 'geaendert = ?'].join(', ')} WHERE id = ?`, ...k.map((x) => f[x]), jetzt(), p.id);
      if (ep) PV.setzePreis(db, { art: 'projektposition', ref: p.id, feld: 'ep', wert: ep.wert, gueltigAb: ep.gueltigAb, benutzerId: req.ctx.benutzer.id, jetzt: bt.uhr() });
      const a = {}; for (const x of k) a[x] = p[x];
      if (ep) a.ep = p.ep;
      prot(req, `position:${p.id}`, `Nachkalkulation ${bs.kst}: „${p.bezeichnung}“ geändert${ep ? ` (EP ab ${ep.gueltigAb.split('-').reverse().join('.')}${ep.rueckwirkend ? ', rückwirkend' : ''})` : ''}`, a, { ...f, ...(ep ? { ep: ep.wert, gueltigAb: ep.gueltigAb } : {}) });
    });
    budget(req, bs, 'Änderung einer Position');
    res.json(positionJson(db.eins('SELECT * FROM projektposition WHERE id = ?', p.id)));
  });

  api.delete('/baustellen/:id/positionen/:pid', (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    lesen(req, bs); schreibenPreise(req);
    const p = position(bs, req.params.pid);
    const k = kalkulationFuer(db, bs);
    const r = projektPositionen(db, bs, k.auftragGesamt);
    const akt = r.gruppen.flatMap((g) => g.positionen).find((x) => x.id === p.id);
    if (akt && (akt.menge !== 0 || (akt.eintraege || []).length)) throw konflikt('Für die Position sind Mengen gebucht – bitte ausblenden statt löschen.');
    db.transaktion(() => {
      db.lauf('DELETE FROM projektposition WHERE id = ?', p.id);
      db.lauf("DELETE FROM preis_stand WHERE art = 'projektposition' AND ref = ?", String(p.id));
      prot(req, `position:${p.id}`, `Nachkalkulation ${bs.kst}: „${p.bezeichnung}“ gelöscht`, positionJson(p), null);
    });
    res.json({ ok: true });
  });

  api.post('/baustellen/:id/positionen/aus-vorlage', (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    lesen(req, bs); schreibenPreise(req);
    const body = v.objekt(req.body);
    const modus = v.auswahl(body.modus ?? 'fehlende', 'modus', ['fehlende', 'preise']);
    const vorschau = body.vorschau === undefined ? false : v.bool(body.vorschau, 'vorschau');
    const gab = modus === 'preise' ? PV.pruefeGueltigAb(db, body.gueltigAb, body.rueckwirkend) : null;
    let aenderungen;
    if (modus === 'fehlende') {
      const da = new Set(db.alle('SELECT katalog_id FROM projektposition WHERE baustelle_id = ? AND katalog_id IS NOT NULL', bs.id).map((x) => x.katalog_id));
      aenderungen = db.alle('SELECT * FROM katalog WHERE aktiv = 1 ORDER BY sortierung, id').filter((k) => !da.has(k.id))
        .map((k) => ({ katalogId: k.id, gruppe: k.gruppe, bezeichnung: k.bezeichnung, einheit: k.einheit, epNeu: k.ep }));
      if (!vorschau && aenderungen.length) db.transaktion(() => { katalogKopieren(db, bs.id, bt.uhr()); prot(req, `baustelle:${bs.id}`, `Nachkalkulation ${bs.kst}: ${aenderungen.length} Positionen aus der Vorlage übernommen`); });
    } else {
      aenderungen = db.alle(`SELECT p.id AS positionId, p.bezeichnung, p.einheit, p.ep AS epAlt, k.ep AS epNeu, k.id AS katalogId FROM projektposition p
        JOIN katalog k ON k.id = p.katalog_id WHERE p.baustelle_id = ? AND abs(p.ep - k.ep) > 0.000001 ORDER BY p.gruppe, p.sortierung`, bs.id);
      if (!vorschau && aenderungen.length) {
        db.transaktion(() => {
          for (const a of aenderungen) {
            db.lauf('UPDATE projektposition SET version = version + 1, geaendert = ? WHERE id = ?', jetzt(), a.positionId);
            PV.setzePreis(db, { art: 'projektposition', ref: a.positionId, feld: 'ep', wert: a.epNeu, gueltigAb: gab.gueltigAb, benutzerId: req.ctx.benutzer.id, jetzt: bt.uhr() });
          }
          prot(req, `baustelle:${bs.id}`, `Nachkalkulation ${bs.kst}: ${aenderungen.length} Preise aus der Vorlage übernommen (gültig ab ${gab.gueltigAb.split('-').reverse().join('.')})`, null, aenderungen.map((a) => ({ id: a.positionId, ep: a.epNeu, gueltigAb: gab.gueltigAb })));
        });
      }
    }
    if (!vorschau && aenderungen.length) budget(req, bs, 'Übernahme aus der Vorlage');
    res.json({ modus, vorschau, anzahl: aenderungen.length, aenderungen });
  });

  api.post('/baustellen/:id/positionen/:pid/mengen', (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    lesen(req, bs); schreibenMengen(req, bs);
    const p = position(bs, req.params.pid);
    const body = v.objekt(req.body);
    const datum = v.datum(body.datum, 'datum');
    const heute = wienDatum(bt.uhr());
    if (datum > heute) throw ungueltig('datum darf nicht in der Zukunft liegen.');
    if (datum < plusTage(heute, -731)) throw ungueltig('datum liegt mehr als 2 Jahre zurück.');
    const menge = Math.round(v.zahl(body.menge, 'menge', { min: 0.001, max: 1e7 }) * 1000) / 1000; // E-06: 3 Nachkommastellen
    const notiz = body.notiz === undefined || body.notiz === null ? null : v.text(body.notiz, 'notiz', { max: 300, pflicht: false });
    const r = db.transaktion(() => {
      const ins = db.lauf('INSERT INTO projektposition_menge (position_id, datum, menge, notiz, erstellt, erstellt_von) VALUES (?, ?, ?, ?, ?, ?)', p.id, datum, menge, notiz, jetzt(), req.ctx.benutzer.id);
      prot(req, `position:${p.id}`, `Nachkalkulation ${bs.kst}: Menge zu „${p.bezeichnung}“ erfasst`, null, { id: ins.id, datum, menge, notiz });
      return ins;
    });
    budget(req, bs, 'Mengeneintrag');
    res.status(201).json({ id: r.id, positionId: p.id, datum, menge, notiz });
  });

  api.delete('/baustellen/:id/positionen/:pid/mengen/:mid', (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    lesen(req, bs); schreibenMengen(req, bs);
    const p = position(bs, req.params.pid);
    const mid = v.pfadId(req.params.mid, 'Mengen-ID');
    const m = db.eins('SELECT * FROM projektposition_menge WHERE id = ? AND position_id = ?', mid, p.id);
    if (!m) throw nichtGefunden('Mengeneintrag nicht gefunden.');
    // E-07: Bauleiter storniert nur selbst erfasste Einträge
    if (!req.ctx.hat('preise_bearbeiten') && m.erstellt_von !== req.ctx.benutzer.id) {
      throw keinZugriff('Einträge anderer Personen (z. B. Rechnungen des Büros) storniert nur das Büro bzw. die Geschäftsführung.');
    }
    db.transaktion(() => {
      db.lauf('DELETE FROM projektposition_menge WHERE id = ?', mid);
      prot(req, `position:${p.id}`, `Nachkalkulation ${bs.kst}: Menge zu „${p.bezeichnung}“ storniert`, { id: m.id, datum: m.datum, menge: m.menge, notiz: m.notiz }, null);
    });
    budget(req, bs, 'Storno Mengeneintrag');
    res.json({ ok: true });
  });

  /* ---------- Preis-Verlauf (API.md 12.2) ---------- */
  const verlaufKatalog = (feld) => (s) => ({ id: s.id, [feld]: s.wert, gueltigAb: s.gueltigAb, erstellt: s.erstellt, erstelltVon: s.erstelltVon });
  api.get('/positionen/katalog/:id/verlauf', brauche('preise_sehen'), (req, res) => {
    const id = v.pfadId(req.params.id, 'Katalog-ID');
    if (!db.eins('SELECT id FROM katalog WHERE id = ?', id)) throw nichtGefunden('Katalogposition nicht gefunden.');
    res.json(PV.verlaufJson(db, 'katalog', id).map(verlaufKatalog('ep')));
  });
  api.delete('/positionen/katalog/:id/verlauf/:vid', brauche('preise_bearbeiten'), (req, res) => {
    const id = v.pfadId(req.params.id, 'Katalog-ID');
    const s = PV.loescheStand(db, { art: 'katalog', ref: id, id: v.pfadId(req.params.vid, 'Stand-ID') });
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'katalog', objekt: `katalog:${id}`, alt: { ep: s.wert, gueltigAb: s.gueltig_ab }, text: `Katalog: geplanten EP ab ${s.gueltig_ab} gelöscht` });
    res.json({ ok: true });
  });
  api.get('/baustellen/:id/positionen/:pid/verlauf', (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    lesen(req, bs);
    if (!darfPreise(req.ctx, bs)) throw keinZugriff('Preise sehen Büro, GF und der Bauleiter der Baustelle.');
    const p = position(bs, req.params.pid);
    res.json(PV.verlaufJson(db, 'projektposition', p.id).map(verlaufKatalog('ep')));
  });
  api.delete('/baustellen/:id/positionen/:pid/verlauf/:vid', (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    lesen(req, bs); schreibenPreise(req);
    const p = position(bs, req.params.pid);
    const s = PV.loescheStand(db, { art: 'projektposition', ref: p.id, id: v.pfadId(req.params.vid, 'Stand-ID') });
    prot(req, `position:${p.id}`, `Nachkalkulation ${bs.kst}: geplanten EP von „${p.bezeichnung}“ ab ${s.gueltig_ab} gelöscht`, { ep: s.wert, gueltigAb: s.gueltig_ab }, null);
    res.json({ ok: true });
  });

  /** API.md 12.2: Position mit mehreren EP-Perioden → eine Zeile je Periode (eigene Menge, eigener EP) */
  const de = (d) => d.split('-').reverse().join('.');
  function exportZeilen(p) {
    if (!p.perioden) return [p];
    const mit = p.perioden.filter((x) => x.menge !== 0);
    const liste = mit.length ? mit : [p.perioden[p.perioden.length - 1]];
    return liste.map((x) => {
      const erste = x.gueltigAb === PV.BASIS_DATUM;
      const zusatz = erste ? (x.bis ? `bis ${de(x.bis)}` : '') : x.bis ? `ab ${de(x.gueltigAb)} bis ${de(x.bis)}` : `ab ${de(x.gueltigAb)}`;
      return { bezeichnung: zusatz ? `${p.bezeichnung} (${zusatz})` : p.bezeichnung, einheit: p.einheit, ep: x.ep, mengeAuto: x.menge, eintraege: [] };
    });
  }

  api.get('/baustellen/:id/positionen/export.xlsx', async (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    lesen(req, bs);
    if (!darfPreise(req.ctx, bs)) throw keinZugriff('Der Export enthält Preise.');
    const k = kalkulationFuer(db, bs);
    const r = projektPositionen(db, bs, k.auftragGesamt);
    const buf = await schreibeExport({
      titel: `Nachkalkulation ${bs.kst} ${bs.kurz || bs.name}`,
      gruppen: r.gruppen.map((g) => ({ schluessel: g.schluessel, positionen: g.positionen.filter((p) => p.aktiv).flatMap(exportZeilen) }))
    });
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'export', objekt: `baustelle:${bs.id}`, text: `Nachkalkulation ${bs.kst} als Excel exportiert` });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Nachkalkulation_${bs.kst}.xlsx"`);
    res.send(buf);
  });
};
