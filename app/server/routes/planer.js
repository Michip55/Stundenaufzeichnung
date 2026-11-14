'use strict';
/** Baustellenplaner, Fuhraufträge, Projektzeitplan (API.md 12.8–12.8c) – keine €-Felder */
const fs = require('node:fs');
const path = require('node:path');
const v = require('../validierung');
const { ungueltig, keinZugriff, nichtGefunden, konflikt, ApiFehler } = require('../fehler');
const { wienDatum, wienZeit, plusTage, istArbeitstag, feiertag, wochentag, istZeit } = require('../datum');
const { baustelleImBereich } = require('../rechte');
const { benachrichtige, empfaengerMitRecht } = require('../benachrichtigung');
const P = require('../planer');
const F = require('../fuhren');
const Bild = require('../fuhrpark-bild');

const unprozessierbar = (text) => new ApiFehler(422, 'UNGUELTIG', text);
const istPlaner = (ctx) => ['buero', 'gf'].includes(ctx.benutzer.rolle) || ctx.hat('stammdaten');
const zeigtAbwesenheit = (ctx) => require('../datenschutz').stufe(ctx) === 'voll'; // Büro/Lohn/GF und Bauleiter: echter Grund

module.exports = function planerRouten(api, bt) {
  const { db } = bt;
  const jetzt = () => bt.uhr().toISOString();
  const heute = () => wienDatum(bt.uhr());
  const prot = (req, objekt, text, neu) => db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'plan', objekt, neu, text });

  /* ---------- Rechte ---------- */
  const eigeneBs = (ctx, bsId) => { const bs = db.eins('SELECT bauleiter_id FROM baustelle WHERE id = ?', bsId); return Boolean(bs && bs.bauleiter_id === ctx.benutzer.id); };
  function darfBearbeiten(ctx, bsId) {
    if (istPlaner(ctx)) return true;
    return ctx.benutzer.rolle === 'bauleiter' && eigeneBs(ctx, bsId);
  }
  function pruefeBearbeiten(ctx, bsId) {
    if (!darfBearbeiten(ctx, bsId)) throw keinZugriff('Einteilen dürfen Büro, GF und der Bauleiter der Baustelle.');
  }
  function istLeser(ctx) { return istPlaner(ctx) || ctx.benutzer.rolle === 'bauleiter'; }
  function datumPruefen(d, feld = 'datum') {
    const x = v.datum(d, feld);
    if (x < plusTage(heute(), -7) || x > plusTage(heute(), 366)) throw ungueltig(`${feld}: höchstens 7 Tage zurück und 366 Tage voraus.`);
    return x;
  }
  const kontext = (von, bis) => P.kontextDaten(db, heute(), von, bis);

  /* ---------- Einstellungen ---------- */
  api.get('/einstellungen/plan', (req, res) => {
    if (!istLeser(req.ctx)) throw keinZugriff();
    res.json(P.einstellungen(db));
  });
  api.put('/einstellungen/plan', (req, res) => {
    if (!istPlaner(req.ctx)) throw keinZugriff('Einstellungen des Planers ändern Büro bzw. GF.');
    const body = v.objekt(req.body);
    const e = { ...(db.einstellung('plan', {}) || {}) };
    if (body.planFortschreiben !== undefined) e.planFortschreiben = v.bool(body.planFortschreiben, 'planFortschreiben');
    if (body.planErinnerung !== undefined) {
      if (body.planErinnerung !== null && !istZeit(body.planErinnerung)) throw ungueltig('planErinnerung: HH:MM oder null.');
      e.planErinnerung = body.planErinnerung;
    }
    if (body.grube !== undefined) {
      const g = v.objekt(body.grube, 'grube');
      const h = F.haltPruefen(db, { art: 'adresse', text: g.text, lat: g.lat, lon: g.lon, link: g.link }, 'grube', ['adresse'], null);
      e.grube = { text: h.text, lat: h.lat ?? null, lon: h.lon ?? null };
    }
    db.setzeEinstellung('plan', e);
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'einstellung', objekt: 'plan', neu: e, text: 'Einstellungen Baustellenplaner geändert' });
    res.json(P.einstellungen(db));
  });

  /* ---------- Wochenplan ---------- */
  /** Einsätze eines Tages (gespeichert oder Vorschau) */
  function tagEinsaetze(d, K, voll = false) {
    const gespeichert = P.ladeEinsaetze(db, d, d);
    if (gespeichert.length) return { einsaetze: gespeichert, vorschau: null };
    const vs = P.vorschauTag(db, d, K, { voll });
    return vs ? { einsaetze: vs.einsaetze, vorschau: vs } : { einsaetze: [], vorschau: null };
  }
  function wetterKarte(einsaetze, K) {
    const W = require('../wetter');
    const m = new Map();
    for (const e of einsaetze) {
      const bs = K.baustellen.get(e.baustelle_id);
      if (!bs || bs.lat == null || e.datum > plusTage(K.heute, 9) || e.datum < K.heute) continue;
      const w = W.wetterAusCache(db, bs, e.datum);
      if (w) m.set(`${bs.id}|${e.datum}`, w.schlechtwetter);
      else if (bt.wetterAn) W.wetterFuer(bt, bs, e.datum).catch(() => {}); // im Hintergrund nachladen
    }
    return m;
  }

  api.get('/plan/woche', (req, res) => {
    const ctx = req.ctx;
    if (!istLeser(ctx)) throw keinZugriff('Den Wochenplan sehen Büro, GF und Bauleiter.');
    const von0 = req.query.von ? v.datum(String(req.query.von), 'von') : heute();
    const wt = wochentag(von0);
    const von = plusTage(von0, wt === 0 ? -6 : 1 - wt);
    const anzahl = String(req.query.tage) === '7' ? 7 : 5;
    const bis = plusTage(von, anzahl - 1);
    const K = kontext(plusTage(von, -60), plusTage(bis, 1));
    K.heute = heute();
    const planer = istPlaner(ctx);
    const sicht = (bsId) => planer || eigeneBs(ctx, bsId);
    const voll = zeigtAbwesenheit(ctx);
    const tage = [], einsaetze = [], konflikte = [], frei = {}, kennzahlen = {};
    const fuhrenAlle = db.alle("SELECT * FROM plan_fuhre WHERE datum >= ? AND datum <= ? AND status <> 'storniert'", von, bis);
    const aktivePersonen = [...K.personen.values()].filter((b) => b.aktiv && ['mitarbeiter', 'polier'].includes(b.rolle));
    const aktiveAnlagen = [...K.S.anlagen.values()].filter((A) => !A.row.ausgeschieden);
    let unveroeffentlicht = 0;
    const zuordnung = new Map(); // datum → {personen: Map, anlagen: Map}
    for (let d = von; d <= bis; d = plusTage(d, 1)) {
      const { einsaetze: liste, vorschau } = tagEinsaetze(d, K, voll);
      const wetter = wetterKarte(liste, K);
      const kt = P.konflikteTag(d, liste, fuhrenAlle.filter((f) => f.datum === d), K, { voll, wetter });
      const sichtbarVeroeff = liste.filter((e) => e.veroeffentlicht_zeit && sicht(e.baustelle_id)).map((e) => e.veroeffentlicht_zeit).sort();
      tage.push({ datum: d, wochentag: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][wochentag(d)], ...(feiertag(d) ? { feiertag: feiertag(d) } : {}), vorschau: Boolean(vorschau), veroeffentlichtUm: sichtbarVeroeff.length ? sichtbarVeroeff[sichtbarVeroeff.length - 1] : null, ...(vorschau ? { quelleDatum: vorschau.quelleDatum, uebersprungen: vorschau.uebersprungen.filter((u) => !u.baustelleId || sicht(u.baustelleId)) } : {}) });
      const lese = new Map(db.alle('SELECT benutzer_id, gelesen, bestaetigt FROM plan_mitteilung WHERE datum = ?', d).map((x) => [x.benutzer_id, x]));
      for (const e of liste) {
        if (!sicht(e.baustelle_id)) continue;
        const j = P.einsatzJson(e, K, { notizen: true, lesestand: lese });
        j.konflikte = P.konflikteFuer(e, kt, true).map((k) => (planer ? k : { ...k, text: k.text }));
        if (!e.vorschau && (!e.veroeffentlicht_zeit || j.geaendertNachVeroeffentlichung)) unveroeffentlicht++;
        einsaetze.push(j);
      }
      // G-14: gelöschte, schon veröffentlichte Einsätze und Fuhren sind unveröffentlichte Änderungen (Meldung erst beim Veröffentlichen)
      unveroeffentlicht += db.alle('SELECT baustelle_id FROM plan_einsatz WHERE datum = ? AND geloescht = 1 AND veroeffentlicht_stand IS NOT NULL', d).filter((e) => sicht(e.baustelle_id)).length;
      // N-021/N-060: auch neue und nach der Veröffentlichung geänderte Fuhren (stornierte veröffentlichte wie bisher)
      unveroeffentlicht += P.offeneFuhren(db, d, K).filter((f) => fuhreRechte(ctx, f)).length;
      for (const k of kt) {
        const betrifft = liste.filter((e) => P.konflikteBetreffen(k, e));
        if (planer || betrifft.some((e) => sicht(e.baustelle_id)) || (k.fuhreIds && !k.einsatzIds.length)) {
          konflikte.push(planer ? k : { ...k, text: betrifft.every((e) => sicht(e.baustelle_id)) ? k.text : k.text.replace(/\(([^)]*)\)/, '(andere Baustelle)') });
        }
      }
      const eingeteilt = new Set(liste.flatMap((e) => e.personen.map((p) => p.benutzer_id)));
      const belegt = new Set(liste.flatMap((e) => e.anlagen.map((a) => a.anlage_id)));
      frei[d] = {
        personen: aktivePersonen.filter((b) => !eingeteilt.has(b.id)).map((b) => {
          const a = K.abw.get(`${b.id}|${d}`);
          return { benutzerId: b.id, name: b.name, rolle: b.rolle, status: a ? 'abwesend' : 'frei', ...(a ? { text: P.abwText(a, voll) } : {}) };
        }),
        anlagen: aktiveAnlagen.filter((A) => !belegt.has(A.row.id)).map((A) => {
          const st = P.anlageStatus(K, A.row.id);
          return { anlageId: A.row.id, bezeichnung: st.bezeichnung, kennzeichen: st.kennzeichen, status: st.status, gesperrt: st.gesperrt, standort: (A.standort && A.standort.text) || (A.row.standort_text || '') };
        })
      };
      kennzahlen[d] = { eingeteilt: [...eingeteilt].filter((id) => aktivePersonen.some((b) => b.id === id)).length, gesamt: aktivePersonen.length };
      zuordnung.set(d, {
        personen: new Map(liste.flatMap((e) => e.personen.map((p) => [p.benutzer_id, e.baustelle_id]))),
        anlagen: new Map(liste.flatMap((e) => e.anlagen.map((a) => [a.anlage_id, e.baustelle_id])))
      });
    }
    // Serien (12.8c): zusammenhängende Arbeitstage auf derselben Baustelle
    const tagZuordnung = (d) => {
      if (zuordnung.has(d)) return zuordnung.get(d);
      const { einsaetze: l } = tagEinsaetze(d, K);
      const z = { personen: new Map(l.flatMap((e) => e.personen.map((p) => [p.benutzer_id, e.baustelle_id]))), anlagen: new Map(l.flatMap((e) => e.anlagen.map((a) => [a.anlage_id, e.baustelle_id]))) };
      zuordnung.set(d, z);
      return z;
    };
    const serien = { personen: {}, anlagen: {} };
    for (const art of ['personen', 'anlagen']) {
      for (let d = von; d <= bis; d = plusTage(d, 1)) {
        if (!istArbeitstag(d)) continue;
        for (const [id, bsId] of tagZuordnung(d)[art]) {
          if (!sicht(bsId)) continue;
          let seit = d, tageAnz = 1, x = d;
          for (let i = 0; i < 60; i++) {
            x = P.vorigerArbeitstag(x);
            if (tagZuordnung(x)[art].get(id) !== bsId) break;
            seit = x; tageAnz++;
          }
          if (!serien[art][id]) serien[art][id] = {};
          serien[art][id][d] = { baustelleId: bsId, seit, tage: tageAnz };
        }
      }
    }
    const baustellen = [...K.baustellen.values()]
      .filter((b) => !b.intern && sicht(b.id) && (P.PLANBAR.includes(b.phase) || einsaetze.some((e) => e.baustelleId === b.id)))
      .map((b) => { const pol = b.polier_id ? K.personen.get(b.polier_id) : null; return { id: b.id, kst: b.kst, name: b.name, kurz: b.kurz, polier: pol ? { id: b.polier_id, name: pol.name } : null, phase: b.phase }; })
      .sort((a, b) => a.kst.localeCompare(b.kst));
    res.json({ von, bis, tage, baustellen, einsaetze, frei, konflikte, kennzahlen, unveroeffentlicht, serien });
  });

  /* ---------- Einsätze schreiben ---------- */
  function einsatzAntwort(req, id, status = 200) {
    const e = P.ladeEinsatz(db, id);
    const K = kontext(e.datum, e.datum);
    const fuhren = db.alle("SELECT * FROM plan_fuhre WHERE datum = ? AND status <> 'storniert'", e.datum);
    const alle = P.ladeEinsaetze(db, e.datum, e.datum);
    const kt = P.konflikteTag(e.datum, alle, fuhren, K, { voll: zeigtAbwesenheit(req.ctx) });
    const j = P.einsatzJson(e, K, { notizen: true });
    j.konflikte = P.konflikteFuer(e, kt, true);
    j.konflikteTag = kt.filter((k) => istPlaner(req.ctx) || alle.filter((x) => (k.einsatzIds || []).includes(x.id)).some((x) => eigeneBs(req.ctx, x.baustelle_id)));
    return { status, j };
  }
  const senden = (res, r) => res.status(r.status).json(r.j);

  function personenPruefen(liste, feld) {
    const ids = v.liste(liste, feld, { max: 60 }).map((x, i) => v.id(x, `${feld}[${i}]`));
    for (const id of ids) {
      const b = db.eins('SELECT id, rolle, aktiv, name FROM benutzer WHERE id = ?', id);
      if (!b || !b.aktiv) throw ungueltig(`${feld}: Person ${id} nicht gefunden oder inaktiv.`);
      // 12.25: Bauleiter sind keine eingeplanten Personen (sie arbeiten im Büro) → 422
      if (b.rolle === 'bauleiter') throw unprozessierbar(`${feld}: ${b.name} ist Bauleiter und wird nicht im Baustellenplaner eingeteilt.`);
      if (!['mitarbeiter', 'polier'].includes(b.rolle)) throw ungueltig(`${feld}: ${b.name} kann nicht eingeteilt werden (nur Mitarbeiter und Polier).`);
    }
    return ids;
  }
  function kolonne(polierId) {
    const p = db.eins("SELECT id, baustelle_id, aktiv FROM benutzer WHERE id = ? AND rolle = 'polier'", polierId);
    if (!p || !p.aktiv) throw ungueltig(`kolonnePolierIds: Polier ${polierId} nicht gefunden.`);
    const mitglieder = p.baustelle_id ? db.alle("SELECT id FROM benutzer WHERE aktiv = 1 AND rolle IN ('mitarbeiter','polier') AND baustelle_id = ? AND id <> ?", p.baustelle_id, p.id).map((x) => x.id) : [];
    return [p.id, ...mitglieder];
  }
  function anlagenPruefen(liste, feld) {
    const ids = v.liste(liste, feld, { max: 30 }).map((x, i) => v.id(x, `${feld}[${i}]`));
    for (const id of ids) {
      const a = db.eins('SELECT id, ausgeschieden FROM anlage WHERE id = ?', id);
      if (!a || a.ausgeschieden) throw ungueltig(`${feld}: Anlage ${id} nicht gefunden oder ausgeschieden.`);
    }
    return ids;
  }
  function textFeld(body, k, max) { return body[k] === undefined ? undefined : body[k] === null ? null : v.text(body[k], k, { max, pflicht: false }) || null; }
  function kopfFelder(body) {
    const f = {};
    if (body.beginn !== undefined) { if (body.beginn !== null && !istZeit(body.beginn)) throw ungueltig('Beginn: Uhrzeit im Format HH:MM.'); f.beginn = body.beginn; }
    for (const [k, max] of [['treffpunkt', 200], ['arbeit', 200], ['notiz', 500], ['benoetigt', 500], ['fahrzeugText', 200]]) {
      const x = textFeld(body, k, max);
      if (x !== undefined) f[k === 'fahrzeugText' ? 'fahrzeug_text' : k] = x;
    }
    if (body.fahrzeugAnlageId !== undefined) f.fahrzeug_anlage_id = body.fahrzeugAnlageId === null ? null : anlagenPruefen([body.fahrzeugAnlageId], 'fahrzeugAnlageId')[0];
    return f;
  }
  const geaendert = (id) => db.lauf('UPDATE plan_einsatz SET version = version + 1, geaendert = ? WHERE id = ?', jetzt(), id);

  function personenHinzu(einsatzId, ids, kolonnePolierId, notizen) {
    for (const id of ids) {
      db.lauf(`INSERT INTO plan_person (einsatz_id, benutzer_id, kolonne_polier_id, notiz) VALUES (?, ?, ?, ?)
        ON CONFLICT(einsatz_id, benutzer_id) DO UPDATE SET kolonne_polier_id = COALESCE(excluded.kolonne_polier_id, kolonne_polier_id), notiz = COALESCE(excluded.notiz, notiz)`,
      einsatzId, id, kolonnePolierId ? kolonnePolierId(id) : null, notizen && notizen[id] != null ? String(notizen[id]).slice(0, 200) : null);
    }
  }
  function notizMap(body, k) {
    if (body[k] === undefined) return null;
    const o = v.objekt(body[k], k);
    for (const [id, t] of Object.entries(o)) if (t != null && (typeof t !== 'string' || t.length > 200)) throw ungueltig(`${k}.${id}: Text bis 200 Zeichen.`);
    return o;
  }
  function fahrerMap(body) {
    if (body.fahrer === undefined) return null;
    const o = v.objekt(body.fahrer, 'fahrer');
    for (const [id, f] of Object.entries(o)) if (f !== null && !(Number.isInteger(Number(f)) && Number(f) > 0)) throw ungueltig(`fahrer.${id}: Benutzer-ID erwartet.`);
    return o;
  }
  function anlagenHinzu(einsatzId, ids, notizen, fahrer) {
    const im = new Set(db.alle('SELECT benutzer_id FROM plan_person WHERE einsatz_id = ?', einsatzId).map((x) => x.benutzer_id));
    for (const id of ids) {
      const f = fahrer && fahrer[id] != null ? Number(fahrer[id]) : null;
      if (f != null && !im.has(f)) throw unprozessierbar(`Fahrer ${f} ist in diesem Einsatz nicht eingeteilt.`);
      db.lauf(`INSERT INTO plan_anlage (einsatz_id, anlage_id, notiz, fahrer_id) VALUES (?, ?, ?, ?)
        ON CONFLICT(einsatz_id, anlage_id) DO UPDATE SET notiz = COALESCE(excluded.notiz, notiz), fahrer_id = COALESCE(excluded.fahrer_id, fahrer_id)`,
      einsatzId, id, notizen && notizen[id] != null ? String(notizen[id]).slice(0, 200) : null, f);
    }
  }
  function einsatzLaden(req, schreiben) {
    const id = v.pfadId(req.params.id, 'Einsatz-ID');
    const e = db.eins('SELECT * FROM plan_einsatz WHERE id = ? AND geloescht = 0', id);
    if (!e) throw nichtGefunden('Einsatz nicht gefunden.');
    if (schreiben) pruefeBearbeiten(req.ctx, e.baustelle_id);
    return e;
  }
  /** Personen aus anderen Zellen desselben Tages entfernen (Ziehen) */
  function verschieben(body, datum, art) {
    if (body.verschiebenVon === undefined || body.verschiebenVon === null) return;
    const q = db.eins('SELECT * FROM plan_einsatz WHERE id = ? AND geloescht = 0 AND datum = ?', v.id(body.verschiebenVon, 'verschiebenVon'), datum);
    if (!q) throw ungueltig('verschiebenVon: Einsatz am selben Tag nicht gefunden.');
    return q;
  }

  api.post('/plan/einsaetze', (req, res) => {
    const body = v.objekt(req.body);
    const datum = datumPruefen(body.datum);
    const bsId = v.id(body.baustelleId, 'baustelleId');
    const bs = db.eins('SELECT * FROM baustelle WHERE id = ?', bsId);
    if (!bs) throw ungueltig('Baustelle nicht gefunden.');
    pruefeBearbeiten(req.ctx, bsId);
    require('../kostenstellen').nurBaustelle(bs, 'Einsätze im Baustellenplaner'); // 12.25
    if (!P.PLANBAR.includes(bs.phase)) throw ungueltig(`Die Baustelle ${bs.kst} ist nicht planbar (${bs.phase}).`);
    const f = kopfFelder(body);
    const ids = body.benutzerIds ? personenPruefen(body.benutzerIds, 'benutzerIds') : [];
    const kol = new Map();
    for (const pid of body.kolonnePolierIds ? v.liste(body.kolonnePolierIds, 'kolonnePolierIds', { max: 10 }) : []) for (const m of kolonne(v.id(pid, 'kolonnePolierIds'))) if (!kol.has(m)) kol.set(m, Number(pid));
    const anl = body.anlageIds ? anlagenPruefen(body.anlageIds, 'anlageIds') : [];
    const notizen = notizMap(body, 'notizen');
    const fahrer = fahrerMap(body);
    // Vorschau-Tag zuerst in einem eigenen, festgeschriebenen Schritt speichern: ein 409 nennt dann
    // immer die ID eines tatsächlich vorhandenen Einsatzes (API.md 12.8c)
    db.transaktion(() => P.materialisieren(bt, datum, req.ctx.benutzer.id));
    const id = db.transaktion(() => {
      const vorhanden = db.eins('SELECT id FROM plan_einsatz WHERE datum = ? AND baustelle_id = ? AND geloescht = 0', datum, bsId);
      if (vorhanden) throw konflikt('Für diese Baustelle gibt es an diesem Tag schon einen Einsatz.', { id: vorhanden.id });
      const r = db.lauf(`INSERT INTO plan_einsatz (datum, baustelle_id, beginn, treffpunkt, fahrzeug_anlage_id, fahrzeug_text, arbeit, notiz, benoetigt, erstellt, erstellt_von, geaendert)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, datum, bsId, f.beginn ?? null, f.treffpunkt ?? null, f.fahrzeug_anlage_id ?? null, f.fahrzeug_text ?? null, f.arbeit ?? null, f.notiz ?? null, f.benoetigt ?? null, jetzt(), req.ctx.benutzer.id, jetzt());
      personenHinzu(r.id, [...new Set([...ids, ...kol.keys()])], (pid) => kol.get(pid) || null, notizen);
      anlagenHinzu(r.id, anl, notizen, fahrer);
      prot(req, `plan:${datum}`, `Einsatz ${bs.kst} am ${P.de(datum)} angelegt`, { baustelleId: bsId, personen: ids.length + kol.size, anlagen: anl.length });
      return r.id;
    });
    senden(res, einsatzAntwort(req, id, 201));
  });

  api.put('/plan/einsaetze/:id', (req, res) => {
    let e = einsatzLaden(req, true);
    const body = v.objekt(req.body);
    const ver = v.zahl(body.version, 'version', { min: 0, ganz: true });
    if (ver !== e.version) throw konflikt('Der Einsatz wurde inzwischen geändert. Bitte neu laden.', { version: e.version });
    const f = kopfFelder(body);
    if (!Object.keys(f).length) throw ungueltig('Keine Änderungen angegeben.');
    db.transaktion(() => {
      const k = Object.keys(f);
      db.lauf(`UPDATE plan_einsatz SET ${k.map((x) => `${x} = ?`).join(', ')}, version = version + 1, geaendert = ? WHERE id = ?`, ...k.map((x) => f[x]), jetzt(), e.id);
      prot(req, `plan:${e.datum}`, `Einsatz ${e.id} am ${P.de(e.datum)} geändert`, f);
    });
    senden(res, einsatzAntwort(req, e.id));
  });

  api.delete('/plan/einsaetze/:id', (req, res) => {
    const e = einsatzLaden(req, true);
    db.transaktion(() => {
      if (e.veroeffentlicht_zeit) db.lauf('UPDATE plan_einsatz SET geloescht = 1, version = version + 1 WHERE id = ?', e.id); // Abmeldung bei der nächsten Veröffentlichung
      else db.lauf('DELETE FROM plan_einsatz WHERE id = ?', e.id);
      prot(req, `plan:${e.datum}`, `Einsatz ${e.id} am ${P.de(e.datum)} gelöscht`, null);
    });
    res.json({ ok: true });
  });

  api.post('/plan/einsaetze/:id/personen', (req, res) => {
    const e = einsatzLaden(req, true);
    const body = v.objekt(req.body);
    const ids = body.benutzerIds ? personenPruefen(body.benutzerIds, 'benutzerIds') : [];
    const kol = new Map();
    if (body.kolonnePolierId !== undefined && body.kolonnePolierId !== null) for (const m of kolonne(v.id(body.kolonnePolierId, 'kolonnePolierId'))) kol.set(m, Number(body.kolonnePolierId));
    if (!ids.length && !kol.size) throw ungueltig('benutzerIds oder kolonnePolierId angeben.');
    const notizen = notizMap(body, 'notizen');
    const quelle = verschieben(body, e.datum);
    if (quelle) pruefeBearbeiten(req.ctx, quelle.baustelle_id);
    db.transaktion(() => {
      const alle = [...new Set([...ids, ...kol.keys()])];
      if (quelle) {
        for (const id of alle) { db.lauf('DELETE FROM plan_person WHERE einsatz_id = ? AND benutzer_id = ?', quelle.id, id); db.lauf('UPDATE plan_anlage SET fahrer_id = NULL WHERE einsatz_id = ? AND fahrer_id = ?', quelle.id, id); }
        geaendert(quelle.id);
      }
      personenHinzu(e.id, alle, (pid) => kol.get(pid) || null, notizen);
      geaendert(e.id);
    });
    senden(res, einsatzAntwort(req, e.id));
  });

  api.put('/plan/einsaetze/:id/personen/:bid', (req, res) => {
    const e = einsatzLaden(req, true);
    const bid = v.pfadId(req.params.bid, 'Benutzer-ID');
    if (!db.eins('SELECT 1 AS x FROM plan_person WHERE einsatz_id = ? AND benutzer_id = ?', e.id, bid)) throw nichtGefunden('Person ist in diesem Einsatz nicht eingeteilt.');
    const body = v.objekt(req.body);
    const notiz = body.notiz == null ? null : v.text(body.notiz, 'notiz', { max: 200, pflicht: false }) || null;
    db.transaktion(() => { db.lauf('UPDATE plan_person SET notiz = ? WHERE einsatz_id = ? AND benutzer_id = ?', notiz, e.id, bid); geaendert(e.id); });
    senden(res, einsatzAntwort(req, e.id));
  });

  api.delete('/plan/einsaetze/:id/personen/:bid', (req, res) => {
    const e = einsatzLaden(req, true);
    const bid = v.pfadId(req.params.bid, 'Benutzer-ID');
    db.transaktion(() => {
      db.lauf('DELETE FROM plan_person WHERE einsatz_id = ? AND benutzer_id = ?', e.id, bid);
      db.lauf('UPDATE plan_anlage SET fahrer_id = NULL WHERE einsatz_id = ? AND fahrer_id = ?', e.id, bid);
      geaendert(e.id);
    });
    senden(res, einsatzAntwort(req, e.id));
  });

  api.post('/plan/einsaetze/:id/anlagen', (req, res) => {
    const e = einsatzLaden(req, true);
    const body = v.objekt(req.body);
    const ids = anlagenPruefen(body.anlageIds, 'anlageIds');
    const quelle = verschieben(body, e.datum);
    if (quelle) pruefeBearbeiten(req.ctx, quelle.baustelle_id);
    db.transaktion(() => {
      if (quelle) { for (const id of ids) db.lauf('DELETE FROM plan_anlage WHERE einsatz_id = ? AND anlage_id = ?', quelle.id, id); geaendert(quelle.id); }
      anlagenHinzu(e.id, ids, notizMap(body, 'notizen'), fahrerMap(body));
      geaendert(e.id);
    });
    senden(res, einsatzAntwort(req, e.id));
  });

  api.put('/plan/einsaetze/:id/anlagen/:aid', (req, res) => {
    const e = einsatzLaden(req, true);
    const aid = v.pfadId(req.params.aid, 'Anlagen-ID');
    if (!db.eins('SELECT 1 AS x FROM plan_anlage WHERE einsatz_id = ? AND anlage_id = ?', e.id, aid)) throw nichtGefunden('Anlage ist in diesem Einsatz nicht eingeteilt.');
    const body = v.objekt(req.body);
    const set = {};
    if (body.notiz !== undefined) set.notiz = body.notiz == null ? null : v.text(body.notiz, 'notiz', { max: 200, pflicht: false }) || null;
    if (body.fahrerId !== undefined) {
      if (body.fahrerId === null) set.fahrer_id = null;
      else {
        const f = v.id(body.fahrerId, 'fahrerId');
        if (!db.eins('SELECT 1 AS x FROM plan_person WHERE einsatz_id = ? AND benutzer_id = ?', e.id, f)) throw unprozessierbar('Der Fahrer muss in diesem Einsatz eingeteilt sein.');
        set.fahrer_id = f;
      }
    }
    if (!Object.keys(set).length) throw ungueltig('notiz oder fahrerId angeben.');
    db.transaktion(() => { const k = Object.keys(set); db.lauf(`UPDATE plan_anlage SET ${k.map((x) => `${x} = ?`).join(', ')} WHERE einsatz_id = ? AND anlage_id = ?`, ...k.map((x) => set[x]), e.id, aid); geaendert(e.id); });
    senden(res, einsatzAntwort(req, e.id));
  });

  api.delete('/plan/einsaetze/:id/anlagen/:aid', (req, res) => {
    const e = einsatzLaden(req, true);
    db.transaktion(() => { db.lauf('DELETE FROM plan_anlage WHERE einsatz_id = ? AND anlage_id = ?', e.id, v.pfadId(req.params.aid, 'Anlagen-ID')); geaendert(e.id); });
    senden(res, einsatzAntwort(req, e.id));
  });

  api.post('/plan/tag/uebernehmen', (req, res) => {
    if (!istLeser(req.ctx)) throw keinZugriff();
    const datum = datumPruefen(v.objekt(req.body).datum);
    const K = kontext(datum, datum);
    const vs = P.vorschauTag(db, datum, K);
    if (vs && !istPlaner(req.ctx) && !vs.einsaetze.some((e) => eigeneBs(req.ctx, e.baustelle_id))) throw keinZugriff('Nur Tage mit eigenen Baustellen übernehmen.');
    const angelegt = db.transaktion(() => P.materialisieren(bt, datum, req.ctx.benutzer.id));
    const K2 = kontext(datum, datum);
    res.json({ angelegt, einsaetze: P.ladeEinsaetze(db, datum, datum).filter((e) => istPlaner(req.ctx) || eigeneBs(req.ctx, e.baustelle_id)).map((e) => P.einsatzJson(e, K2)) });
  });

  api.post('/plan/vorwoche-uebernehmen', (req, res) => {
    if (!istLeser(req.ctx)) throw keinZugriff();
    const body = v.objekt(req.body);
    const von0 = v.datum(body.von, 'von');
    const wt = wochentag(von0);
    const von = plusTage(von0, wt === 0 ? -6 : 1 - wt);
    const nur = body.baustelleIds ? new Set(v.liste(body.baustelleIds, 'baustelleIds', { max: 100 }).map(Number)) : null;
    const angelegt = [], uebersprungen = [];
    const K = kontext(plusTage(von, -7), plusTage(von, 6));
    db.transaktion(() => {
      for (let i = 0; i < 7; i++) {
        const ziel = plusTage(von, i), quelle = plusTage(ziel, -7);
        if (ziel < plusTage(heute(), -7)) continue;
        const kopien = P.ladeEinsaetze(db, quelle, quelle).filter((e) => (!nur || nur.has(e.baustelle_id)) && darfBearbeiten(req.ctx, e.baustelle_id));
        // N-016 (12.8c): ein Vorschau-Tag wird zuerst GANZ gespeichert (alle Vorschau-Zellen), dann wird kopiert –
        // so verschwinden nicht gewählte Vorschau-Zellen nicht still, und vorhandene Zellen bleiben („vorhanden“)
        if (kopien.length) P.materialisieren(bt, ziel, req.ctx.benutzer.id);
        for (const e of kopien) {
          const bs = K.baustellen.get(e.baustelle_id);
          if (!bs || !P.PLANBAR.includes(bs.phase)) { uebersprungen.push({ datum: ziel, typ: 'baustelle', text: `${bs ? bs.kst : '?'} nicht planbar` }); continue; }
          if (db.eins('SELECT 1 AS x FROM plan_einsatz WHERE datum = ? AND baustelle_id = ? AND geloescht = 0', ziel, e.baustelle_id)) { uebersprungen.push({ datum: ziel, typ: 'vorhanden', text: `${bs.kst}: Zelle schon belegt` }); continue; }
          const schonPers = new Set(db.alle('SELECT p.benutzer_id FROM plan_person p JOIN plan_einsatz e ON e.id = p.einsatz_id WHERE e.datum = ? AND e.geloescht = 0', ziel).map((x) => x.benutzer_id));
          const schonAnl = new Set(db.alle('SELECT a.anlage_id FROM plan_anlage a JOIN plan_einsatz e ON e.id = a.einsatz_id WHERE e.datum = ? AND e.geloescht = 0', ziel).map((x) => x.anlage_id));
          const r = db.lauf(`INSERT INTO plan_einsatz (datum, baustelle_id, beginn, treffpunkt, fahrzeug_anlage_id, fahrzeug_text, arbeit, erstellt, erstellt_von, geaendert) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ziel, e.baustelle_id, e.beginn, e.treffpunkt, e.fahrzeug_anlage_id, e.fahrzeug_text, e.arbeit, jetzt(), req.ctx.benutzer.id, jetzt());
          for (const p of e.personen) {
            const b = K.personen.get(p.benutzer_id);
            const a = K.abw.get(`${p.benutzer_id}|${ziel}`);
            if (!b || !b.aktiv) { uebersprungen.push({ datum: ziel, typ: 'inaktiv', text: `${b ? b.name : '?'} inaktiv`, benutzerId: p.benutzer_id }); continue; }
            if (!['mitarbeiter', 'polier'].includes(b.rolle)) { uebersprungen.push({ datum: ziel, typ: 'rolle', text: `${b.name} wird nicht eingeplant`, benutzerId: p.benutzer_id }); continue; } // 12.25
            if (a) { uebersprungen.push({ datum: ziel, typ: 'abwesenheit', text: `${b.name}: ${P.abwText(a, zeigtAbwesenheit(req.ctx))}`, benutzerId: p.benutzer_id }); continue; }
            if (schonPers.has(p.benutzer_id)) { uebersprungen.push({ datum: ziel, typ: 'person_doppelt', text: `${b.name} ist schon eingeteilt`, benutzerId: p.benutzer_id }); continue; }
            db.lauf('INSERT INTO plan_person (einsatz_id, benutzer_id, kolonne_polier_id) VALUES (?, ?, ?)', r.id, p.benutzer_id, p.kolonne_polier_id);
          }
          for (const a of e.anlagen) {
            const st = P.anlageStatus(K, a.anlage_id);
            if (!st || st.gesperrt || st.ausgeschieden) { uebersprungen.push({ datum: ziel, typ: 'anlage_gesperrt', text: `${st ? st.bezeichnung : '?'} gesperrt`, anlageId: a.anlage_id }); continue; }
            if (schonAnl.has(a.anlage_id)) { uebersprungen.push({ datum: ziel, typ: 'anlage_doppelt', text: `${st.bezeichnung} schon eingeteilt`, anlageId: a.anlage_id }); continue; }
            const fahrerDa = a.fahrer_id && db.eins('SELECT 1 AS x FROM plan_person WHERE einsatz_id = ? AND benutzer_id = ?', r.id, a.fahrer_id);
            db.lauf('INSERT INTO plan_anlage (einsatz_id, anlage_id, fahrer_id) VALUES (?, ?, ?)', r.id, a.anlage_id, fahrerDa ? a.fahrer_id : null);
          }
          angelegt.push(r.id);
        }
      }
      prot(req, `plan:${von}`, `Vorwoche in die Woche ab ${P.de(von)} übernommen (${angelegt.length} Einsätze)`, { uebersprungen: uebersprungen.length });
    });
    res.json({ angelegt: angelegt.length, uebersprungen });
  });

  /* ---------- Veröffentlichen ---------- */
  api.post('/plan/veroeffentlichen', (req, res) => {
    if (!istLeser(req.ctx)) throw keinZugriff();
    const body = v.objekt(req.body);
    const von = v.datum(body.von, 'von');
    const bis = body.bis == null ? von : v.datum(body.bis, 'bis');
    if (bis < von || plusTage(von, 13) < bis) throw ungueltig('Zeitraum: höchstens 14 Tage.');
    const trocken = body.vorschau === true;
    const planer = istPlaner(req.ctx);
    const r = P.veroeffentlichen(bt, {
      ctx: req.ctx, von, bis, trocken,
      baustellenFilter: (bsId) => planer || eigeneBs(req.ctx, bsId),
      fuhreFilter: (f) => planer || [JSON.parse(f.von), JSON.parse(f.nach)].some((h) => h.baustelleId && eigeneBs(req.ctx, h.baustelleId))
    });
    // anzahl/benachrichtigt = tatsächlich eingefügte Meldungen (N-005/N-014), personen = verschiedene Empfänger (N-094)
    if (trocken) return res.json({ empfaenger: r.empfaenger.map((e) => ({ benutzerId: e.benutzerId, name: e.name, art: e.art, datum: e.datum, ...(e.baustelleId ? { baustelleId: e.baustelleId } : {}), titel: e.titel, text: e.text })), anzahl: r.anzahl, personen: r.personen });
    res.json({ benachrichtigt: r.anzahl, personen: r.personen, einsaetze: r.einsaetze, empfaenger: r.empfaenger });
  });

  /* ---------- Mein Einsatz ---------- */
  api.get('/plan/ich', (req, res) => {
    // 12.25: Bauleiter werden nicht eingeplant – „Mein Einsatz“ ist für sie leer
    if (req.ctx.benutzer.rolle === 'bauleiter') return res.json({ morgen: null, tage: [] });
    const ich = req.ctx.benutzer.id;
    const h = heute();
    const von = req.query.von ? v.datum(String(req.query.von), 'von') : h;
    const bis = req.query.bis ? v.datum(String(req.query.bis), 'bis') : plusTage(von, 6);
    if (bis < von || plusTage(von, 62) < bis) throw ungueltig('Zeitraum höchstens 62 Tage.');
    const zeilen = new Map(db.alle('SELECT * FROM plan_mitteilung WHERE benutzer_id = ? AND datum >= ? AND datum <= ?', ich, plusTage(von, -10), bis).map((z) => [z.datum, z]));
    const tage = [];
    const W = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    const vergleich = (x) => (x && x.einsatz ? JSON.stringify([x.einsatz.baustelle.id, x.einsatz.beginn, x.einsatz.treffpunkt, x.einsatz.fahrzeug, x.einsatz.meinFahrzeug]) : null);
    for (let d = von; d <= bis; d = plusTage(d, 1)) {
      const z = zeilen.get(d);
      const inhalt = z && z.inhalt ? JSON.parse(z.inhalt) : null;
      let wieVortag = false;
      if (inhalt && inhalt.einsatz) {
        const vt = zeilen.get(P.vorigerArbeitstag(d));
        wieVortag = Boolean(vt && vt.inhalt && vergleich(JSON.parse(vt.inhalt)) === vergleich(inhalt));
      }
      if (inhalt && inhalt.einsatz && inhalt.einsatz.polier) {
        const t = db.eins('SELECT telefon FROM benutzer WHERE id = ?', inhalt.einsatz.polier.id);
        if (t && t.telefon) inhalt.einsatz.polier.telefon = t.telefon; // 12.8d
      }
      const fuhren = inhalt ? inhalt.fuhren.map((fx) => { const r = db.eins('SELECT status FROM plan_fuhre WHERE id = ?', fx.id); return { ...fx, status: r ? r.status : 'storniert' }; }) : [];
      // N-083: geaendert = die zuletzt gesendete Meldung für diesen Tag war eine Änderung („Geändert: …“)
      tage.push({ datum: d, wochentag: W[wochentag(d)], einsatz: inhalt ? inhalt.einsatz : null, fuhren, gelesen: Boolean(z && z.gelesen), bestaetigt: Boolean(z && z.bestaetigt), geaendert: Boolean(inhalt && z.art === 'geaendert'), wieVortag });
      if (z && z.inhalt && !z.gelesen) db.lauf('UPDATE plan_mitteilung SET gelesen = ? WHERE benutzer_id = ? AND datum = ?', jetzt(), ich, d);
    }
    // N-058: nächster Einsatztag – ein Sa/So/Feiertag mit veröffentlichtem Einsatz bzw. Fuhren vor dem nächsten Arbeitstag zählt
    const hat = (x) => { const t = tage.find((y) => y.datum === x); return Boolean(t && (t.einsatz || t.fuhren.length)); };
    const morgen = P.naechsterEinsatztag(h, hat);
    const mt = tage.find((t) => t.datum === morgen);
    res.json({ morgen: mt && (mt.einsatz || mt.fuhren.length) ? mt : null, tage });
  });

  api.post('/plan/ich/bestaetigen', (req, res) => {
    const d = v.datum(v.objekt(req.body).datum, 'datum');
    const r = db.lauf('UPDATE plan_mitteilung SET bestaetigt = ?, gelesen = COALESCE(gelesen, ?) WHERE benutzer_id = ? AND datum = ? AND inhalt IS NOT NULL', jetzt(), jetzt(), req.ctx.benutzer.id, d);
    if (!r.changes) throw nichtGefunden('Für diesen Tag gibt es keinen veröffentlichten Einsatz.');
    res.json({ ok: true });
  });

  /* ---------- Meine Partie (Polier) ---------- */
  api.get('/plan/partie', (req, res) => {
    const ich = req.ctx.benutzer;
    if (!['polier', 'bauleiter'].includes(ich.rolle) && !istPlaner(req.ctx)) throw keinZugriff('„Meine Partie“ ist für Poliere.');
    // G-05: nächster Arbeitstag; N-058: ein Sa/So/Feiertag davor mit veröffentlichtem Einsatz der Partie bzw. Fuhre geht vor
    let Kx = null;
    const meinTag = (x) => {
      Kx = Kx || kontext(x, x);
      return db.alle('SELECT veroeffentlicht_stand FROM plan_einsatz WHERE datum = ? AND veroeffentlicht_stand IS NOT NULL', x).map((e) => JSON.parse(e.veroeffentlicht_stand))
        .some((st) => st.personen.some((p) => p.benutzerId === ich.id) || baustelleImBereich(ich, Kx.baustellen.get(st.baustelleId)))
        || db.alle("SELECT veroeffentlicht_stand FROM plan_fuhre WHERE datum = ? AND veroeffentlicht_stand IS NOT NULL AND status <> 'storniert'", x).map((f) => JSON.parse(f.veroeffentlicht_stand))
          .some((st) => st.nach && st.nach.baustelleId && baustelleImBereich(ich, Kx.baustellen.get(st.nach.baustelleId)));
    };
    const d = req.query.datum ? v.datum(String(req.query.datum), 'datum') : P.naechsterEinsatztag(heute(), meinTag);
    const K = kontext(d, d);
    const lese = new Map(db.alle('SELECT benutzer_id, gelesen, bestaetigt FROM plan_mitteilung WHERE datum = ?', d).map((x) => [x.benutzer_id, x]));
    const S = K.S;
    const einsaetze = db.alle('SELECT * FROM plan_einsatz WHERE datum = ? AND veroeffentlicht_stand IS NOT NULL', d).map((e) => JSON.parse(e.veroeffentlicht_stand))
      .filter((st) => st.personen.some((p) => p.benutzerId === ich.id) || baustelleImBereich(ich, K.baustellen.get(st.baustelleId)))
      .map((st) => ({
        ...st,
        personen: st.personen.map((p) => { const l = lese.get(p.benutzerId); const tel = (db.eins('SELECT telefon FROM benutzer WHERE id = ?', p.benutzerId) || {}).telefon; return { ...p, gelesen: Boolean(l && l.gelesen), bestaetigt: Boolean(l && l.bestaetigt), ...(tel ? { telefon: tel } : {}) }; }),
        anlagen: st.anlagen.map((a) => {
          const A = S.anlagen.get(a.anlageId);
          const nt = A && A.status && A.status.naechsterTermin;
          return { ...a, status: A ? A.status.status : a.status, hinweis: A && A.status.gesperrt ? 'gesperrt' : nt ? `${nt.titel || 'Termin'}: ${nt.datum ? P.de(nt.datum) : ''}`.trim() : null };
        })
      }));
    const fuhren = db.alle("SELECT * FROM plan_fuhre WHERE datum = ? AND veroeffentlicht_stand IS NOT NULL AND status <> 'storniert'", d)
      .map((f) => ({ roh: f, st: JSON.parse(f.veroeffentlicht_stand) }))
      .filter(({ st }) => st.nach.baustelleId && baustelleImBereich(ich, K.baustellen.get(st.nach.baustelleId)))
      .map(({ roh, st }) => ({ ...F.fuhreFuerFahrer(st), status: roh.status, fahrer: st.fahrer, nach: st.nach, berichtZeile: roh.bericht_status || null }));
    res.json({ datum: d, einsaetze, fuhren });
  });

  /* ---------- Anfragen ---------- */
  api.post('/plan/anfragen', (req, res) => {
    const ich = req.ctx.benutzer;
    if (ich.rolle !== 'polier') throw keinZugriff('Änderungen fragt der Polier an; Büro und Bauleiter ändern den Plan selbst.'); // Inhaber 13.11.2026: Bauleiter = Büro
    const body = v.objekt(req.body);
    const datum = v.datum(body.datum, 'datum');
    const text = v.text(body.text, 'text', { max: 500 });
    if (text.length < 3) throw ungueltig('text: mindestens 3 Zeichen.');
    let e = null;
    if (body.einsatzId != null) { e = db.eins('SELECT * FROM plan_einsatz WHERE id = ?', v.id(body.einsatzId, 'einsatzId')); if (!e) throw ungueltig('einsatzId nicht gefunden.'); }
    const bsId = e ? e.baustelle_id : ich.baustelle_id || null;
    const r = db.transaktion(() => {
      const x = db.lauf('INSERT INTO plan_anfrage (datum, einsatz_id, baustelle_id, text, von, zeit) VALUES (?, ?, ?, ?, ?, ?)', datum, e ? e.id : null, bsId, text, ich.id, jetzt());
      const empf = empfaengerMitRecht(db, 'stammdaten', { ohne: ich.id }); // 15.3: Büro und Bauleiter (= Büro) über das Recht
      for (const b of empf) benachrichtige(db, { benutzerId: b.id, typ: 'plan', titel: `Änderung angefragt: ${P.deKurz(datum)}`, text: `${ich.name}: ${text.slice(0, 200)}`, zeit: jetzt(), baustelleId: bsId, schluessel: `plan:anfrage:${x.id}` });
      return x;
    });
    res.status(201).json(anfrageJson(db.eins('SELECT * FROM plan_anfrage WHERE id = ?', r.id)));
  });
  function anfrageJson(a) {
    const n = (id) => (id ? { id, name: (db.eins('SELECT name FROM benutzer WHERE id = ?', id) || {}).name } : null);
    return { id: a.id, datum: a.datum, einsatzId: a.einsatz_id, baustelleId: a.baustelle_id, text: a.text, von: n(a.von), zeit: a.zeit, status: a.status, antwort: a.antwort || null, erledigtVon: n(a.erledigt_von), erledigtZeit: a.erledigt_zeit };
  }
  api.get('/plan/anfragen', (req, res) => {
    if (!istLeser(req.ctx)) {
      return res.json(db.alle('SELECT * FROM plan_anfrage WHERE von = ? ORDER BY zeit DESC LIMIT 100', req.ctx.benutzer.id).map(anfrageJson));
    }
    const status = req.query.status ? v.auswahl(String(req.query.status), 'status', ['offen', 'erledigt']) : null;
    res.json(db.alle(`SELECT * FROM plan_anfrage ${status ? 'WHERE status = ?' : ''} ORDER BY zeit DESC LIMIT 200`, ...(status ? [status] : []))
      .filter((a) => istPlaner(req.ctx) || (a.baustelle_id && eigeneBs(req.ctx, a.baustelle_id)) || a.von === req.ctx.benutzer.id).map(anfrageJson));
  });
  api.put('/plan/anfragen/:id', (req, res) => {
    const a = db.eins('SELECT * FROM plan_anfrage WHERE id = ?', v.pfadId(req.params.id));
    if (!a) throw nichtGefunden('Anfrage nicht gefunden.');
    if (!istPlaner(req.ctx) && !(a.baustelle_id && eigeneBs(req.ctx, a.baustelle_id))) throw keinZugriff();
    const body = v.objekt(req.body);
    v.auswahl(body.status, 'status', ['erledigt']);
    const antwort = body.antwort == null ? null : v.text(body.antwort, 'antwort', { max: 500, pflicht: false }) || null;
    db.transaktion(() => {
      db.lauf("UPDATE plan_anfrage SET status = 'erledigt', antwort = ?, erledigt_von = ?, erledigt_zeit = ? WHERE id = ?", antwort, req.ctx.benutzer.id, jetzt(), a.id);
      benachrichtige(db, { benutzerId: a.von, typ: 'plan', titel: `Anfrage erledigt: ${P.deKurz(a.datum)}`, text: antwort || 'Ihre Änderungsanfrage wurde erledigt.', zeit: jetzt(), schluessel: `plan:anfrage-erledigt:${a.id}` });
    });
    res.json(anfrageJson(db.eins('SELECT * FROM plan_anfrage WHERE id = ?', a.id)));
  });

  /* ---------- Projektzeitplan ---------- */
  const ABSCHNITT_ARTEN = ['erdbau', 'kanal', 'unterbau', 'pflaster', 'asphalt', 'eigen'];
  const ABSCHNITT_NAMEN = { erdbau: 'Erdbau', kanal: 'Kanal', unterbau: 'Unterbau', pflaster: 'Pflaster', asphalt: 'Asphalt', eigen: 'Abschnitt' };
  const abschnittJson = (a) => ({ id: a.id, baustelleId: a.baustelle_id, art: a.art, name: a.name, von: a.von, bis: a.bis, sortierung: a.sortierung, version: a.version });
  function zeitplanSicht(ctx, bs) {
    if (istPlaner(ctx)) return true;
    if (ctx.benutzer.rolle === 'bauleiter') return bs.bauleiter_id === ctx.benutzer.id;
    if (ctx.benutzer.rolle === 'polier') return baustelleImBereich(ctx.benutzer, bs);
    return false;
  }
  api.get('/plan/zeitplan', (req, res) => {
    const ctx = req.ctx;
    if (!istLeser(ctx) && ctx.benutzer.rolle !== 'polier') throw keinZugriff();
    const archiv = req.query.archiv === '1';
    const phase = req.query.phase ? String(req.query.phase) : null;
    const { kalkulationFuer } = require('../daten');
    const { darfKalk } = require('../rechte');
    const alle = db.alle('SELECT * FROM baustelle WHERE intern = 0 ORDER BY kst').filter((b) => zeitplanSicht(ctx, b));
    const filter = {};
    for (const b of alle) if (b.phase !== 'archiviert') filter[b.phase] = (filter[b.phase] || 0) + 1;
    const liste = alle.filter((b) => (archiv ? b.phase === 'archiviert' : b.phase !== 'archiviert')).filter((b) => !phase || b.phase === phase);
    const vonQ = req.query.von ? v.datum(String(req.query.von), 'von') : null;
    const bisQ = req.query.bis ? v.datum(String(req.query.bis), 'bis') : null;
    const bauvorhaben = liste.map((b) => {
      const ab = db.alle('SELECT * FROM plan_abschnitt WHERE baustelle_id = ? ORDER BY von, sortierung, id', b.id).filter((a) => (!vonQ || a.bis >= vonQ) && (!bisQ || a.von <= bisQ)).map(abschnittJson);
      const ph = new Map(db.alle('SELECT phase, MAX(datum) AS d FROM baustelle_phase WHERE baustelle_id = ? GROUP BY phase', b.id).map((x) => [x.phase, x.d]));
      const meilensteine = [];
      for (const [art, d] of [['fertiggestellt', ph.get('fertiggestellt')], ['abgenommen', b.abnahme_datum || ph.get('abgenommen')], ['schlussrechnung', ph.get('schlussrechnung')], ['bezahlt', ph.get('bezahlt')], ['gewaehrleistung', b.gewaehrleistung_bis]]) {
        if (d) meilensteine.push({ art, datum: d, erreicht: d <= heute() });
      }
      const o = { baustelle: { id: b.id, kst: b.kst, name: b.name, kurz: b.kurz, phase: b.phase }, abschnitte: ab, meilensteine };
      if (darfKalk(ctx, b)) { try { o.baustelle.leistungsstandProzent = kalkulationFuer(db, b).leistungsstandProzent; } catch (_) { /* egal */ } }
      return o;
    });
    // N-114: Zähler zusätzlich als Liste – der Schlüssel „schlussrechnung“ in `filter` fällt für Rollen ohne preise_sehen dem
    // €-Sicherheitsnetz (Schlüsselname) zum Opfer; die Phase als Wert ist kein €-Feld
    const phasen = Object.entries(filter).map(([phase, anzahl]) => ({ phase, anzahl }));
    res.json({ bauvorhaben, filter, phasen, archivAnzahl: alle.filter((b) => b.phase === 'archiviert').length });
  });
  function abschnittFelder(body, teil) {
    const f = {};
    if (!teil || body.art !== undefined) f.art = v.auswahl(body.art, 'art', ABSCHNITT_ARTEN);
    if (!teil || body.name !== undefined) f.name = body.name == null ? ABSCHNITT_NAMEN[f.art || 'eigen'] : v.text(body.name, 'name', { max: 80 });
    if (!teil || body.von !== undefined) f.von = v.datum(body.von, 'von');
    if (!teil || body.bis !== undefined) f.bis = v.datum(body.bis, 'bis');
    if (body.sortierung !== undefined) f.sortierung = v.zahl(body.sortierung, 'sortierung', { min: 0, max: 1e6, ganz: true });
    return f;
  }
  api.post('/baustellen/:id/abschnitte', (req, res) => {
    const bsId = v.pfadId(req.params.id, 'Baustellen-ID');
    if (!db.eins('SELECT id FROM baustelle WHERE id = ?', bsId)) throw nichtGefunden('Baustelle nicht gefunden.');
    pruefeBearbeiten(req.ctx, bsId);
    const f = abschnittFelder(v.objekt(req.body), false);
    if (f.bis < f.von) throw ungueltig('bis liegt vor von.');
    const r = db.lauf('INSERT INTO plan_abschnitt (baustelle_id, art, name, von, bis, sortierung) VALUES (?, ?, ?, ?, ?, ?)', bsId, f.art, f.name, f.von, f.bis, f.sortierung || 0);
    prot(req, `baustelle:${bsId}`, `Bauabschnitt „${f.name}“ angelegt`, f);
    res.status(201).json(abschnittJson(db.eins('SELECT * FROM plan_abschnitt WHERE id = ?', r.id)));
  });
  function abschnittLaden(req) {
    const a = db.eins('SELECT * FROM plan_abschnitt WHERE id = ? AND baustelle_id = ?', v.pfadId(req.params.aid), v.pfadId(req.params.id));
    if (!a) throw nichtGefunden('Abschnitt nicht gefunden.');
    pruefeBearbeiten(req.ctx, a.baustelle_id);
    return a;
  }
  api.put('/baustellen/:id/abschnitte/:aid', (req, res) => {
    const a = abschnittLaden(req);
    const body = v.objekt(req.body);
    if (v.zahl(body.version, 'version', { min: 1, ganz: true }) !== a.version) throw konflikt('Der Abschnitt wurde inzwischen geändert.', { version: a.version });
    const f = abschnittFelder(body, true);
    if ((f.bis || a.bis) < (f.von || a.von)) throw ungueltig('bis liegt vor von.');
    const k = Object.keys(f);
    if (!k.length) throw ungueltig('Keine Änderungen angegeben.');
    db.lauf(`UPDATE plan_abschnitt SET ${k.map((x) => `${x} = ?`).join(', ')}, version = version + 1 WHERE id = ?`, ...k.map((x) => f[x]), a.id);
    res.json(abschnittJson(db.eins('SELECT * FROM plan_abschnitt WHERE id = ?', a.id)));
  });
  api.delete('/baustellen/:id/abschnitte/:aid', (req, res) => {
    const a = abschnittLaden(req);
    db.lauf('DELETE FROM plan_abschnitt WHERE id = ?', a.id);
    prot(req, `baustelle:${a.baustelle_id}`, `Bauabschnitt „${a.name}“ gelöscht`, null);
    res.json({ ok: true });
  });

  /* ================= Fuhraufträge (12.8b) ================= */
  const fahrzeug = (A) => A && (['lkw', 'pkw', 'bus', 'anhaenger'].includes(A.klasse) || A.kennzeichen);
  function fuhreRechte(ctx, f) {
    if (istPlaner(ctx)) return true;
    if (ctx.benutzer.rolle !== 'bauleiter') return false;
    return [JSON.parse(f.von), JSON.parse(f.nach)].some((h) => h.baustelleId && eigeneBs(ctx, h.baustelleId));
  }
  function fuhrFelder(body, alt) {
    const f = {};
    const E = P.einstellungen(db);
    if (!alt || body.datum !== undefined) f.datum = datumPruefen(body.datum);
    if (!alt || body.anlageId !== undefined) {
      const a = db.eins('SELECT * FROM anlage WHERE id = ?', v.id(body.anlageId, 'anlageId'));
      if (!a || a.ausgeschieden) throw ungueltig('Fahrzeug nicht gefunden oder ausgeschieden.');
      if (!fahrzeug(a)) throw ungueltig('Fuhren nur mit Fahrzeugen (LKW).');
      f.anlage_id = a.id;
    }
    if (body.fahrerId !== undefined) f.fahrer_id = body.fahrerId === null ? null : personenPruefen([body.fahrerId], 'fahrerId')[0];
    if (body.reihenfolge !== undefined) f.reihenfolge = v.zahl(body.reihenfolge, 'reihenfolge', { min: 0, max: 1000, ganz: true });
    if (body.beginn !== undefined) { if (body.beginn !== null && !istZeit(body.beginn)) throw ungueltig('Beginn: Uhrzeit im Format HH:MM.'); f.beginn = body.beginn; }
    if (body.materialId !== undefined) {
      if (body.materialId === null) f.material_id = null;
      else { const m = db.eins('SELECT id, aktiv FROM material WHERE id = ?', v.id(body.materialId, 'materialId')); if (!m || !m.aktiv) throw ungueltig('Material nicht gefunden oder inaktiv.'); f.material_id = m.id; }
    }
    if (body.materialText !== undefined) f.material_text = body.materialText == null ? null : v.text(body.materialText, 'materialText', { max: 120, pflicht: false }) || null;
    if (!alt && f.material_id == null && !f.material_text) throw ungueltig('Material auswählen oder als Freitext angeben.');
    if (!alt || body.menge !== undefined) { f.menge = v.zahl(body.menge, 'menge', { min: 0.001, max: 100000 }); f.menge = Math.round(f.menge * 1000) / 1000; }
    if (!alt || body.einheit !== undefined) f.einheit = v.auswahl(body.einheit, 'einheit', ['t', 'm3', 'fuhren']);
    if (body.anzahlFuhren !== undefined) f.anzahl_fuhren = body.anzahlFuhren === null ? null : v.zahl(body.anzahlFuhren, 'anzahlFuhren', { min: 1, max: 200, ganz: true });
    if (body.notiz !== undefined) f.notiz = body.notiz == null ? null : v.text(body.notiz, 'notiz', { max: 300, pflicht: false }) || null;
    const grube = { art: 'grube', text: E.grube.text, ...(E.grube.lat != null ? { lat: E.grube.lat, lon: E.grube.lon } : {}) };
    if (!alt || body.von !== undefined) f.von = JSON.stringify(F.haltPruefen(db, body.von, 'von', ['grube', 'baustelle', 'adresse'], grube) || grube);
    if (!alt || body.nach !== undefined) {
      if (!body.nach) throw ungueltig('nach fehlt.');
      f.nach = JSON.stringify(F.haltPruefen(db, body.nach, 'nach', ['baustelle', 'adresse'], null));
    }
    return f;
  }
  const fuhreAntwort = (id, status = 200) => {
    const f = db.eins('SELECT * FROM plan_fuhre WHERE id = ?', id);
    const K = kontext(f.datum, f.datum);
    const j = F.fuhreJson(db, f, K);
    j.konflikte = P.konflikteTag(f.datum, [], [f], K).map((k) => ({ typ: k.typ, text: k.text }));
    j.geaendertNachVeroeffentlichung = Boolean(f.veroeffentlicht_zeit) && f.veroeffentlicht_hash !== F.fuhreHash(j);
    if (j.berichtZeile && j.berichtZeile.status === 'uebernommen' && f.bericht_id) j.berichtZeile.berichtVersion = (db.eins('SELECT version FROM bericht WHERE id = ?', f.bericht_id) || {}).version; // G-02
    return { status, j };
  };
  function fuhreLaden(req) {
    const f = db.eins('SELECT * FROM plan_fuhre WHERE id = ?', v.pfadId(req.params.id, 'Fuhren-ID'));
    if (!f) throw nichtGefunden('Fuhre nicht gefunden.');
    return f;
  }

  api.get('/plan/fuhren', (req, res) => {
    if (!istLeser(req.ctx)) throw keinZugriff();
    const von = req.query.von ? v.datum(String(req.query.von), 'von') : heute();
    const bis = req.query.bis ? v.datum(String(req.query.bis), 'bis') : von;
    if (bis < von || plusTage(von, 62) < bis) throw ungueltig('Zeitraum höchstens 62 Tage.');
    const anlageId = req.query.anlageId ? Number(req.query.anlageId) : null;
    const bsId = req.query.baustelleId ? Number(req.query.baustelleId) : null;
    const K = kontext(von, bis);
    const liste = db.alle('SELECT * FROM plan_fuhre WHERE datum >= ? AND datum <= ? ORDER BY datum, anlage_id, reihenfolge, id', von, bis)
      .filter((f) => (!anlageId || f.anlage_id === anlageId) && fuhreRechte(req.ctx, f))
      .filter((f) => !bsId || [JSON.parse(f.von), JSON.parse(f.nach)].some((h) => h.baustelleId === bsId));
    res.json(liste.map((f) => {
      const j = F.fuhreJson(db, f, K);
      j.konflikte = P.konflikteTag(f.datum, [], [f], K).map((k) => ({ typ: k.typ, text: k.text }));
      j.geaendertNachVeroeffentlichung = Boolean(f.veroeffentlicht_zeit) && f.veroeffentlicht_hash !== F.fuhreHash(j);
      return j;
    }));
  });

  api.post('/plan/fuhren', (req, res) => {
    const body = v.objekt(req.body);
    const f = fuhrFelder(body, null);
    if (!fuhreRechte(req.ctx, { von: f.von, nach: f.nach })) throw keinZugriff('Fuhren planen Büro, GF und Bauleiter (für eigene Baustellen).');
    if (f.reihenfolge === undefined) f.reihenfolge = (db.eins('SELECT MAX(reihenfolge) AS m FROM plan_fuhre WHERE datum = ? AND anlage_id = ?', f.datum, f.anlage_id).m || 0) + 10;
    const k = Object.keys(f);
    const r = db.lauf(`INSERT INTO plan_fuhre (${k.join(', ')}, erstellt, erstellt_von, geaendert) VALUES (${k.map(() => '?').join(', ')}, ?, ?, ?)`, ...k.map((x) => f[x]), jetzt(), req.ctx.benutzer.id, jetzt());
    prot(req, `fuhre:${r.id}`, `Fuhre am ${P.de(f.datum)} angelegt`, { anlageId: f.anlage_id, menge: f.menge, einheit: f.einheit });
    senden(res, fuhreAntwort(r.id, 201));
  });

  api.put('/plan/fuhren/:id', (req, res) => {
    const alt = fuhreLaden(req);
    if (!fuhreRechte(req.ctx, alt)) throw keinZugriff();
    const body = v.objekt(req.body);
    if (v.zahl(body.version, 'version', { min: 1, ganz: true }) !== alt.version) throw konflikt('Die Fuhre wurde inzwischen geändert.', { version: alt.version });
    if (alt.status === 'erledigt' || alt.status === 'storniert') throw konflikt('Erledigte bzw. stornierte Fuhren sind nicht mehr änderbar.');
    const f = fuhrFelder(body, alt);
    if (!fuhreRechte(req.ctx, { von: f.von || alt.von, nach: f.nach || alt.nach })) throw keinZugriff();
    const k = Object.keys(f);
    if (!k.length) throw ungueltig('Keine Änderungen angegeben.');
    // N-021/N-041: Eine veröffentlichte Fuhre wird auf einen anderen Tag VERSCHOBEN = am alten Tag storniert (offene Änderung,
    // „Fuhre entfällt“ mit der nächsten Veröffentlichung) und am neuen Tag als neue, unveröffentlichte Fuhre angelegt
    if (f.datum && f.datum !== alt.datum && alt.veroeffentlicht_zeit) {
      if (alt.status !== 'geplant') throw konflikt('Die Fuhre ist schon unterwegs – sie kann nicht mehr auf einen anderen Tag verschoben werden.');
      const neuId = db.transaktion(() => {
        db.lauf("UPDATE plan_fuhre SET status = 'storniert', version = version + 1, geaendert = ? WHERE id = ?", jetzt(), alt.id);
        const id = fuhreKopieren(req, { ...alt, ...f }, f.datum);
        prot(req, `fuhre:${alt.id}`, `Fuhre ${alt.id} vom ${P.de(alt.datum)} auf ${P.de(f.datum)} verschoben (neu: Fuhre ${id})`, { von: alt.datum, nach: f.datum, neu: id });
        return id;
      });
      const r = fuhreAntwort(neuId);
      r.j.ersetzt = alt.id;
      return senden(res, r);
    }
    db.lauf(`UPDATE plan_fuhre SET ${k.map((x) => `${x} = ?`).join(', ')}, version = version + 1, geaendert = ? WHERE id = ?`, ...k.map((x) => f[x]), jetzt(), alt.id);
    senden(res, fuhreAntwort(alt.id));
  });

  api.delete('/plan/fuhren/:id', (req, res) => {
    const f = fuhreLaden(req);
    if (!fuhreRechte(req.ctx, f)) throw keinZugriff();
    // N-022/N-040: wie PUT – eine erledigte (gefahrene) Fuhre steht im Bautagesbericht bzw. als Vorschlag; Korrektur dort
    if (f.status === 'erledigt') throw konflikt('Die Fuhre ist schon abgeladen gemeldet und kann nicht mehr storniert werden – die Menge bitte im Bautagesbericht korrigieren.');
    if (f.status === 'storniert') throw konflikt('Die Fuhre ist schon storniert.');
    db.transaktion(() => {
      if (f.veroeffentlicht_zeit) db.lauf("UPDATE plan_fuhre SET status = 'storniert', version = version + 1, geaendert = ? WHERE id = ?", jetzt(), f.id);
      else db.lauf('DELETE FROM plan_fuhre WHERE id = ?', f.id);
      prot(req, `fuhre:${f.id}`, `Fuhre am ${P.de(f.datum)} ${f.veroeffentlicht_zeit ? 'storniert' : 'gelöscht'}`, null);
    });
    res.json({ ok: true });
  });

  function fuhreKopieren(req, f, d) {
    const k = ['anlage_id', 'fahrer_id', 'reihenfolge', 'beginn', 'material_id', 'material_text', 'menge', 'einheit', 'anzahl_fuhren', 'von', 'nach', 'notiz'];
    return db.lauf(`INSERT INTO plan_fuhre (datum, ${k.join(', ')}, erstellt, erstellt_von, geaendert) VALUES (?, ${k.map(() => '?').join(', ')}, ?, ?, ?)`, d, ...k.map((x) => f[x]), jetzt(), req.ctx.benutzer.id, jetzt()).id;
  }
  api.post('/plan/fuhren/kopieren', (req, res) => {
    const body = v.objekt(req.body);
    const f = db.eins('SELECT * FROM plan_fuhre WHERE id = ?', v.id(body.id, 'id'));
    if (!f) throw nichtGefunden('Fuhre nicht gefunden.');
    if (!fuhreRechte(req.ctx, f)) throw keinZugriff();
    const alleTage = v.liste(body.tage, 'tage', { max: 31 }).map((d, i) => datumPruefen(d, `tage[${i}]`));
    // N-092: Sa/So und Feiertage werden übersprungen und gemeldet (wie „wie Vortag“ nur Arbeitstage)
    const tage = alleTage.filter((d) => istArbeitstag(d));
    const uebersprungen = alleTage.filter((d) => !istArbeitstag(d)).map((d) => ({ datum: d, text: `${P.deKurz(d)}: ${feiertag(d) ? `Feiertag (${feiertag(d)})` : 'kein Arbeitstag'} – nicht kopiert` }));
    const angelegt = db.transaktion(() => tage.map((d) => fuhreKopieren(req, f, d)));
    res.json({ angelegt, uebersprungen });
  });
  api.post('/plan/fuhren/wie-vortag', (req, res) => {
    if (!istLeser(req.ctx)) throw keinZugriff();
    const body = v.objekt(req.body);
    const d = datumPruefen(body.datum);
    const vt = P.vorigerArbeitstag(d);
    const nur = body.anlageIds ? new Set(v.liste(body.anlageIds, 'anlageIds', { max: 50 }).map(Number)) : null;
    const angelegt = db.transaktion(() => db.alle("SELECT * FROM plan_fuhre WHERE datum = ? AND status <> 'storniert' ORDER BY anlage_id, reihenfolge", vt)
      .filter((f) => (!nur || nur.has(f.anlage_id)) && fuhreRechte(req.ctx, f)).map((f) => fuhreKopieren(req, f, d)));
    res.json({ angelegt, quelleDatum: vt });
  });

  api.post('/plan/fuhren/:id/status', (req, res) => {
    const f = fuhreLaden(req);
    const ich = req.ctx.benutzer;
    if (f.fahrer_id !== ich.id && !fuhreRechte(req.ctx, f)) throw keinZugriff('Den Status meldet der eingeteilte Fahrer.');
    if (f.fahrer_id === ich.id && !istPlaner(req.ctx) && !f.veroeffentlicht_zeit) throw keinZugriff('Die Fuhre ist noch nicht veröffentlicht.');
    const body = v.objekt(req.body);
    const status = v.auswahl(body.status, 'status', ['unterwegs', 'erledigt']);
    if (f.status === 'storniert') throw konflikt('Die Fuhre ist storniert.');
    db.transaktion(() => {
      if (status === 'unterwegs') {
        if (f.status === 'erledigt') throw konflikt('Die Fuhre ist schon erledigt.');
        db.lauf("UPDATE plan_fuhre SET status = 'unterwegs', version = version + 1 WHERE id = ?", f.id);
      } else {
        if (f.status === 'erledigt') {
          // N-039/N-062: schon abgeladen gemeldet – dieselbe Meldung (z. B. aus der Warteschlange) ist harmlos,
          // eine andere Menge/Einheit würde Fuhre und Berichtszeile auseinanderlaufen lassen → 409
          const e0 = JSON.parse(f.erledigt || 'null') || {};
          const m = body.menge !== undefined ? Math.round(v.zahl(body.menge, 'menge', { min: 0.001, max: 100000 }) * 1000) / 1000 : e0.menge;
          const eh = body.einheit !== undefined ? v.auswahl(body.einheit, 'einheit', ['t', 'm3', 'fuhren']) : e0.einheit;
          if (m !== e0.menge || eh !== e0.einheit) throw konflikt(`Die Fuhre ist schon abgeladen gemeldet (${String(e0.menge).replace('.', ',')} ${e0.einheit === 'm3' ? 'm³' : e0.einheit}). Eine andere Menge korrigiert das Büro im Bautagesbericht.`);
          return;
        }
        const erl = JSON.parse(f.erledigt || 'null') || {};
        const neu = {
          menge: body.menge !== undefined ? Math.round(v.zahl(body.menge, 'menge', { min: 0.001, max: 100000 }) * 1000) / 1000 : erl.menge ?? f.menge,
          einheit: body.einheit !== undefined ? v.auswahl(body.einheit, 'einheit', ['t', 'm3', 'fuhren']) : erl.einheit || f.einheit,
          zeit: erl.zeit || jetzt(), ...(erl.lieferscheinFotoId ? { lieferscheinFotoId: erl.lieferscheinFotoId } : {}),
          ...(body.bemerkung != null ? { bemerkung: v.text(body.bemerkung, 'bemerkung', { max: 300, pflicht: false }) } : erl.bemerkung ? { bemerkung: erl.bemerkung } : {})
        };
        db.lauf("UPDATE plan_fuhre SET status = 'erledigt', erledigt = ?, version = version + 1 WHERE id = ?", JSON.stringify(neu), f.id);
        F.inBericht(bt, db.eins('SELECT * FROM plan_fuhre WHERE id = ?', f.id), ich.id); // genau einmal (bericht_status)
      }
      prot(req, `fuhre:${f.id}`, `Fuhre ${f.id}: ${status}`, { status });
    });
    senden(res, fuhreAntwort(f.id));
  });

  const fotoOrdner = () => path.join(bt.uploads, 'fuhren');
  api.post('/plan/fuhren/:id/foto', (req, res) => {
    const f = fuhreLaden(req);
    if (f.fahrer_id !== req.ctx.benutzer.id && !fuhreRechte(req.ctx, f)) throw keinZugriff();
    const body = v.objekt(req.body);
    let b;
    try { b = Bild.bildPruefen(body.bildBase64); } catch (e) { throw ungueltig(e.message); }
    const gleich = db.eins('SELECT id FROM plan_fuhre_foto WHERE fuhre_id = ? AND sha256 = ?', f.id, b.sha256);
    if (gleich) return res.json({ id: gleich.id, url: `/api/plan/fuhren/${f.id}/foto/${gleich.id}` });
    if (db.eins('SELECT COUNT(*) AS n FROM plan_fuhre_foto WHERE fuhre_id = ?', f.id).n >= 5) throw ungueltig('Höchstens 5 Fotos je Fuhre.');
    const datei = Bild.speichere(fotoOrdner(), b.mime, b.daten);
    const id = db.transaktion(() => {
      const r = db.lauf('INSERT INTO plan_fuhre_foto (fuhre_id, datei, mime, groesse, sha256, dateiname, erstellt, erstellt_von) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', f.id, datei, b.mime, b.daten.length, b.sha256, Bild.sichererName(body.dateiname, b.mime), jetzt(), req.ctx.benutzer.id);
      const erl = JSON.parse(f.erledigt || 'null');
      if (erl && !erl.lieferscheinFotoId) db.lauf('UPDATE plan_fuhre SET erledigt = ? WHERE id = ?', JSON.stringify({ ...erl, lieferscheinFotoId: r.id }), f.id);
      return r.id;
    });
    res.status(201).json({ id, url: `/api/plan/fuhren/${f.id}/foto/${id}` });
  });
  api.get('/plan/fuhren/:id/foto/:fid', (req, res) => {
    const f = fuhreLaden(req);
    const ich = req.ctx.benutzer;
    const nach = JSON.parse(f.nach);
    const polier = ich.rolle === 'polier' && nach.baustelleId && baustelleImBereich(ich, db.eins('SELECT * FROM baustelle WHERE id = ?', nach.baustelleId));
    if (f.fahrer_id !== ich.id && !fuhreRechte(req.ctx, f) && !polier) throw keinZugriff();
    const x = db.eins('SELECT * FROM plan_fuhre_foto WHERE id = ? AND fuhre_id = ?', v.pfadId(req.params.fid), f.id);
    if (!x) throw nichtGefunden('Foto nicht gefunden.');
    let daten;
    try { daten = fs.readFileSync(Bild.dateiPfad(fotoOrdner(), x.datei)); } catch (_) { throw nichtGefunden('Fotodatei nicht vorhanden.'); }
    res.setHeader('Content-Type', x.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="fuhre-${f.id}-${x.id}.${Bild.ENDUNG[x.mime]}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.send(daten);
  });

  /* ---------- Bericht: Fuhren-Vorschläge übernehmen ---------- */
  const B = require('./berichte');
  B.fuhrenVorschlag = (dbx, b) => F.vorschlaegeFuer(dbx, b);
  api.post('/berichte/:id/fuhren-uebernehmen', (req, res) => {
    const b = B.ladeBerichtRoh(db, v.pfadId(req.params.id, 'Berichts-ID'));
    if (!b) throw nichtGefunden('Bericht nicht gefunden.');
    B.pruefeSchreiben(req.ctx, b.baustelle);
    if (b.status !== 'entwurf' || b.unterschriften.length) throw konflikt(B.GESPERRT_TEXT);
    const ids = v.liste(v.objekt(req.body).fuhreIds, 'fuhreIds', { max: 100 }).map(Number);
    let n = 0;
    db.transaktion(() => {
      for (const id of ids) {
        const f = db.eins("SELECT * FROM plan_fuhre WHERE id = ? AND bericht_status = 'vorschlag' AND status = 'erledigt' AND datum = ? AND json_extract(nach, '$.baustelleId') = ?", id, b.datum, b.baustelle_id); // N-023: nie stornierte
        if (!f) continue;
        F.zeileHinzufuegen(db, b.id, f.material_id, f.bericht_menge);
        db.lauf("UPDATE plan_fuhre SET bericht_status = 'uebernommen', bericht_id = ? WHERE id = ?", b.id, f.id);
        n++;
      }
      if (n) {
        B.berichtGeaendert(db, b.id, jetzt()); // G-02: Version +1 und Fern-Links ungültig
        db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'bericht', objekt: `bericht:${b.id}`, neu: { fuhreIds: ids }, text: `${n} Fuhre(n) in den Bericht übernommen` });
      }
    });
    const bj = B.berichtJson(db, req.ctx, B.ladeBerichtRoh(db, b.id));
    res.json({ uebernommen: n, berichtVersion: bj.version, bericht: bj });
  });

  // 12.8b: Dichte über PUT /materialien/:id (Alias zu 12.21)
  api.put('/materialien/:id', (req, res) => {
    if (!req.ctx.hat('stammdaten')) throw keinZugriff();
    const m = db.eins('SELECT * FROM material WHERE id = ?', v.pfadId(req.params.id));
    if (!m) throw nichtGefunden('Material nicht gefunden.');
    const body = v.objekt(req.body);
    const dichte = body.dichte === null ? null : Math.round(v.zahl(body.dichte, 'dichte', { min: 0.1, max: 5 }) * 1000) / 1000;
    db.lauf('UPDATE material SET dichte = ?, version = version + 1 WHERE id = ?', dichte, m.id);
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'stammdaten', objekt: `materialien:${m.id}`, alt: { dichte: m.dichte }, neu: { dichte }, text: `Dichte ${m.name} geändert` });
    res.json({ id: m.id, code: m.code, name: m.name, einheit: m.einheit, dichte });
  });
  /* ---------- Druckbarer Tages-/Wochenplan (12.23) – nie €-Werte ---------- */
  const WT_LANG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const ROLLE_KURZ = { mitarbeiter: 'Mitarbeiter', polier: 'Polier', bauleiter: 'Bauleiter', buero: 'Büro', gf: 'GF' };
  const zeitHM = (iso) => (iso ? wienZeit(new Date(iso)) : null);
  function bsFilterAus(q) {
    if (q.baustelleIds === undefined || q.baustelleIds === '') return null;
    const ids = String(q.baustelleIds).split(',').map((x) => x.trim()).filter(Boolean);
    if (!ids.length || ids.length > 100 || ids.some((x) => !/^\d{1,9}$/.test(x))) throw ungueltig('baustelleIds: Liste von IDs (Komma).');
    return new Set(ids.map(Number));
  }
  function druckRolle(ctx) {
    if (istPlaner(ctx)) return 'planer';
    if (ctx.benutzer.rolle === 'bauleiter') return 'bauleiter';
    if (ctx.benutzer.rolle === 'polier') return 'polier';
    throw keinZugriff('Den Einteilungsplan drucken Büro, GF, Bauleiter und Poliere.');
  }
  /** Partie des Poliers: Stamm-Baustelle eine seiner Baustellen bzw. über seine Kolonne eingeteilt */
  function partieVon(ich, K) {
    const meine = new Set([...K.baustellen.values()].filter((b) => b.polier_id === ich.id).map((b) => b.id));
    return new Set([ich.id, ...[...K.personen.values()].filter((p) => p.baustelle_id != null && meine.has(p.baustelle_id)).map((p) => p.id)]);
  }
  const fahrzeugText = (f) => (f ? [f.bezeichnung, f.kennzeichen ? `(${f.kennzeichen})` : null, f.text].filter(Boolean).join(' ') : '');
  function fuhrZeile(f) {
    const menge = `${String(f.menge).replace('.', ',')} ${f.einheit === 'm3' ? 'm³' : f.einheit}${f.anzahlFuhren ? ` (${f.anzahlFuhren} Fuhren)` : ''}`;
    const nach = `${(f.nach && f.nach.text) || ''}${f.nach && f.nach.abladestelle ? ` – ${f.nach.abladestelle}` : ''}`;
    return { zeit: f.beginn || '', material: f.material ? f.material.name : f.materialText || '', menge, strecke: `${(f.von && f.von.text) || ''} » ${nach}`, fahrer: f.fahrer ? f.fahrer.name : '', reihenfolge: f.reihenfolge || 0 };
  }
  function fuhrGruppen(liste) {
    const g = new Map();
    for (const f of liste) {
      const lkw = f.anlage ? `${f.anlage.bezeichnung || ''}${f.anlage.kennzeichen ? ` (${f.anlage.kennzeichen})` : ''}` : 'LKW';
      if (!g.has(lkw)) g.set(lkw, []);
      g.get(lkw).push(fuhrZeile(f));
    }
    return [...g].sort((a, b) => a[0].localeCompare(b[0])).map(([lkw, z]) => ({ lkw, zeilen: z.sort((a, b) => (a.zeit || '99').localeCompare(b.zeit || '99') || a.reihenfolge - b.reihenfolge) }));
  }

  /**
   * Druckmodell eines Tages nach Rechten → {bloecke, fuhren, nichtEingeteilt, entwurf, veroeffentlichtUm, nichtsVeroeffentlicht}
   */
  function druckTag(ctx, rolle, d, K, filter) {
    const ich = ctx.benutzer;
    const voll = zeigtAbwesenheit(ctx);
    const tel = (id) => (id ? (db.eins('SELECT telefon FROM benutzer WHERE id = ?', id) || {}).telefon || null : null);
    let einsaetze, fuhren, eingeteilt, entwurf, partie = null;
    if (rolle === 'polier') {
      partie = partieVon(ich, K);
      const st = db.alle('SELECT * FROM plan_einsatz WHERE datum = ? AND veroeffentlicht_stand IS NOT NULL', d).map((e) => ({ e, st: JSON.parse(e.veroeffentlicht_stand) }));
      eingeteilt = new Set(st.flatMap(({ st: x }) => x.personen.map((p) => p.benutzerId)));
      einsaetze = st.filter(({ st: x }) => x.personen.some((p) => p.benutzerId === ich.id) || baustelleImBereich(ich, K.baustellen.get(x.baustelleId))).map(({ e, st: x }) => {
        const eigen = baustelleImBereich(ich, K.baustellen.get(x.baustelleId));
        return {
          ...x, veroeffentlichtUm: e.veroeffentlicht_zeit,
          notiz: eigen ? x.notiz : '', benoetigt: x.benoetigt,
          personen: x.personen.map((p) => ({ ...p, notiz: p.benutzerId === ich.id || partie.has(p.benutzerId) || p.kolonnePolierId === ich.id ? p.notiz : '' })),
          anlagen: x.anlagen.map((a) => ({ ...a, notiz: eigen ? a.notiz : '' }))
        };
      });
      fuhren = db.alle("SELECT * FROM plan_fuhre WHERE datum = ? AND veroeffentlicht_stand IS NOT NULL AND status <> 'storniert'", d).map((f) => JSON.parse(f.veroeffentlicht_stand))
        .filter((f) => f.nach && f.nach.baustelleId && baustelleImBereich(ich, K.baustellen.get(f.nach.baustelleId)));
      entwurf = false;
    } else {
      const sicht = (bsId) => rolle === 'planer' || eigeneBs(ctx, bsId);
      const { einsaetze: liste, vorschau } = tagEinsaetze(d, K, voll);
      eingeteilt = new Set(liste.flatMap((e) => e.personen.map((p) => p.benutzer_id)));
      einsaetze = liste.filter((e) => sicht(e.baustelle_id)).map((e) => ({ ...P.einsatzJson(e, K, { notizen: true }), vorschau: Boolean(vorschau) }));
      for (const e of einsaetze) { const bs = K.baustellen.get(e.baustelleId) || {}; e.polier = bs.polier_id ? { id: bs.polier_id, name: (K.personen.get(bs.polier_id) || {}).name } : null; }
      fuhren = db.alle("SELECT * FROM plan_fuhre WHERE datum = ? AND status <> 'storniert' ORDER BY anlage_id, reihenfolge, id", d)
        .filter((f) => fuhreRechte(ctx, f)).map((f) => ({ ...F.fuhreJson(db, f, K), geaendertNachVeroeffentlichung: F.fuhreOffen(db, f, K) && Boolean(f.veroeffentlicht_zeit) })); // N-077
      entwurf = Boolean(vorschau);
    }
    if (filter) {
      einsaetze = einsaetze.filter((e) => filter.has(e.baustelleId));
      fuhren = fuhren.filter((f) => [f.von, f.nach].some((h) => h && filter.has(h.baustelleId)));
    }
    // N-079 (12.23): Wasserzeichen nur nach den GEZEIGTEN Einsätzen und Fuhren
    if (rolle !== 'polier') entwurf = entwurf || !einsaetze.length || einsaetze.some((e) => !e.veroeffentlicht || e.geaendertNachVeroeffentlichung) || fuhren.some((f) => !f.veroeffentlicht || f.geaendertNachVeroeffentlichung);
    const zeiten = einsaetze.map((e) => e.veroeffentlichtUm).filter(Boolean).sort();
    const bloecke = einsaetze.sort((a, b) => String(a.baustelle.kst).localeCompare(String(b.baustelle.kst))).map((e) => ({
      baustelleId: e.baustelleId, kst: e.baustelle.kst, name: e.baustelle.name, adresse: e.baustelle.adresse || '',
      polier: e.polier ? { name: e.polier.name, telefon: tel(e.polier.id) } : null,
      beginn: e.beginn || '', treffpunkt: e.treffpunkt || '', arbeit: e.arbeit || '', fahrzeug: fahrzeugText(e.fahrzeug),
      personen: e.personen.map((p) => ({ name: p.name, rolle: ROLLE_KURZ[p.rolle] || '', notiz: p.notiz || '' })),
      anlagen: e.anlagen.map((a) => ({ bezeichnung: a.bezeichnung || `Gerät ${a.anlageId}`, kennzeichen: a.kennzeichen || '', fahrer: a.fahrer ? a.fahrer.name : '', notiz: a.notiz || '' })),
      benoetigt: e.benoetigt || '', notiz: e.notiz || ''
    }));
    // Inhaber 13.11.2026: der Polier sieht keine Abwesenheiten anderer → Abschnitt „Nicht eingeteilt“ entfällt für ihn ganz
    const kandidaten = rolle === 'polier' ? [] : [...K.personen.values()].filter((b) => b.aktiv && ['mitarbeiter', 'polier'].includes(b.rolle) && !eingeteilt.has(b.id) && (!partie || partie.has(b.id)));
    const nichtEingeteilt = kandidaten.sort((a, b) => a.name.localeCompare(b.name)).map((b) => {
      const a = K.abw.get(`${b.id}|${d}`);
      return { name: b.name, rolle: ROLLE_KURZ[b.rolle], status: a ? P.abwText(a, voll) : 'frei' };
    });
    return { bloecke, fuhren: fuhrGruppen(fuhren), nichtEingeteilt, entwurf, veroeffentlichtUm: zeiten.length ? zeitHM(zeiten[zeiten.length - 1]) : null, nichtsVeroeffentlicht: !zeiten.length };
  }
  const gedruckt = () => `${P.de(heute())} ${wienZeit(bt.uhr())}`;
  const firma = () => db.einstellung('firma', { name: 'Michael Pichler Ges.m.b.H.', ort: '2624 Breitenau' });
  function pdfSenden(res, buf, name) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${name}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  }

  api.get('/plan/tag.pdf', async (req, res) => {
    const rolle = druckRolle(req.ctx);
    const d = v.datum(String(req.query.datum ?? ''), 'datum');
    const filter = bsFilterAus(req.query);
    const K = kontext(plusTage(d, -60), plusTage(d, 1));
    K.heute = heute();
    const t = druckTag(req.ctx, rolle, d, K, filter);
    if (rolle === 'polier' && t.nichtsVeroeffentlicht) throw nichtGefunden('Für diesen Tag ist noch keine Einteilung veröffentlicht.');
    const m = { ...t, titel: `Einteilung ${WT_LANG[wochentag(d)]} ${P.de(d)}`, gedruckt: gedruckt() };
    const buf = await require('../planer-pdf').tagesplanPdf(m, { unkomprimiert: Boolean(bt.pdfUnkomprimiert), firma: firma() });
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'export', objekt: `plan:${d}`, text: `Tagesplan ${P.de(d)} gedruckt${m.entwurf ? ' (Entwurf)' : ''}` });
    pdfSenden(res, buf, `Einteilung_${d}.pdf`);
  });

  api.get('/plan/woche.pdf', async (req, res) => {
    const rolle = druckRolle(req.ctx);
    const von0 = req.query.von ? v.datum(String(req.query.von), 'von') : heute();
    const wt = wochentag(von0);
    const von = plusTage(von0, wt === 0 ? -6 : 1 - wt);
    const filter = bsFilterAus(req.query);
    const K = kontext(plusTage(von, -60), plusTage(von, 5));
    K.heute = heute();
    const tage = [], zeilen = new Map();
    let entwurf = false, zuletzt = null, irgendwas = false;
    for (let i = 0; i < 5; i++) {
      const d = plusTage(von, i);
      const t = druckTag(req.ctx, rolle, d, K, filter);
      if (!t.nichtsVeroeffentlicht) irgendwas = true;
      const tagEntwurf = rolle !== 'polier' && t.entwurf && t.bloecke.length > 0; // leere Tage ohne Einsätze nicht markieren
      entwurf = entwurf || tagEntwurf;
      if (t.veroeffentlichtUm && (!zuletzt || d >= zuletzt.d)) zuletzt = { d, um: t.veroeffentlichtUm };
      tage.push({ datum: d, label: `${['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][wochentag(d)]} ${d.slice(8, 10)}.${d.slice(5, 7)}.${feiertag(d) ? ` ${feiertag(d)}` : ''}`, entwurf: tagEntwurf });
      for (const b of t.bloecke) {
        if (!zeilen.has(b.baustelleId)) zeilen.set(b.baustelleId, { kst: b.kst, name: b.name, zellen: {} });
        zeilen.get(b.baustelleId).zellen[d] = [...(b.beginn ? [b.beginn] : []), ...b.personen.map((p) => p.name)];
      }
    }
    if (rolle === 'polier' && !irgendwas) throw nichtGefunden('Für diese Woche ist noch keine Einteilung veröffentlicht.');
    const m = {
      titel: `Wochenplan ${P.de(von)} – ${P.de(plusTage(von, 4))}`, gedruckt: gedruckt(), entwurf,
      veroeffentlichtUm: zuletzt ? `${P.de(zuletzt.d).slice(0, 6)} ${zuletzt.um}` : null,
      tage, zeilen: [...zeilen.values()].sort((a, b) => String(a.kst).localeCompare(String(b.kst)))
    };
    const buf = await require('../planer-pdf').wochenplanPdf(m, { unkomprimiert: Boolean(bt.pdfUnkomprimiert), firma: firma() });
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'export', objekt: `plan:woche:${von}`, text: `Wochenplan ab ${P.de(von)} gedruckt${entwurf ? ' (Entwurf)' : ''}` });
    pdfSenden(res, buf, `Wochenplan_${von}.pdf`);
  });
};

/** Stempeluhr (12.8): heutiger veröffentlichter Einsatz */
module.exports.geplantHeute = (db, benutzerId, heute) => {
  const z = db.eins('SELECT inhalt FROM plan_mitteilung WHERE benutzer_id = ? AND datum = ? AND inhalt IS NOT NULL', benutzerId, heute);
  if (!z) return null;
  const i = JSON.parse(z.inhalt);
  if (!i.einsatz) return null;
  return { baustelleId: i.einsatz.baustelle.id, kst: i.einsatz.baustelle.kst, name: i.einsatz.baustelle.name, beginn: i.einsatz.beginn, treffpunkt: i.einsatz.treffpunkt };
};
/** Heute veröffentlichte eingeplante Personen einer Baustelle */
module.exports.geplantAufBaustelle = (db, baustelleId, heute) => db.alle('SELECT benutzer_id, inhalt FROM plan_mitteilung WHERE datum = ? AND inhalt IS NOT NULL', heute)
  .filter((z) => { const i = JSON.parse(z.inhalt); return i.einsatz && i.einsatz.baustelle.id === baustelleId; }).map((z) => z.benutzer_id);
