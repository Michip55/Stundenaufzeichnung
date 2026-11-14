'use strict';
/** Projektdokumente je Baustelle (API.md 12.16) */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const v = require('../validierung');
const { ungueltig, keinZugriff, nichtGefunden, konflikt } = require('../fehler');
const { darfPreise, baustelleImBereich } = require('../rechte');
const { baustelleAusPfad } = require('./hilfe');
const D = require('../dokument-pruefung');

const istVerwaltung = (ctx) => ['buero', 'gf'].includes(ctx.benutzer.rolle) || ctx.hat('stammdaten');

module.exports = function dokumentRouten(api, bt) {
  const { db } = bt;
  const jetzt = () => bt.uhr().toISOString();
  const ordner = () => path.join(bt.uploads, 'dokumente');
  const namen = () => new Map(db.alle('SELECT id, name FROM benutzer').map((b) => [b.id, b.name]));
  const kategorien = () => new Map(db.alle('SELECT * FROM dokument_kategorie ORDER BY sortierung, name').map((k) => [k.schluessel, k]));

  /** Sicht je Kategorie: 'schreiben' | 'lesen' | null */
  function zugriff(ctx, bs, kat) {
    const ich = ctx.benutzer;
    if (kat.finanziell && !darfPreise(ctx, bs)) return null;
    if (istVerwaltung(ctx)) return 'schreiben';
    if (ich.rolle === 'bauleiter' && bs.bauleiter_id === ich.id) return kat.finanziell && !ctx.hat('preise_bearbeiten') ? 'lesen' : 'schreiben';
    if (ich.rolle === 'polier' && baustelleImBereich(ich, bs) && kat.polier) return 'lesen';
    return null;
  }
  function pruefeBaustelle(ctx, bs) {
    const ich = ctx.benutzer;
    if (istVerwaltung(ctx)) return;
    if (ich.rolle === 'bauleiter' && bs.bauleiter_id === ich.id) return;
    if (ich.rolle === 'polier' && baustelleImBereich(ich, bs)) return;
    throw keinZugriff('Projektdokumente sehen Büro, GF, Bauleiter und Polier der Baustelle.');
  }

  /** N-050: Rechnung, mit der das Dokument verknüpft ist (auch stornierte – das PDF zeigt Beträge) */
  const rechnungZu = (dokumentId) => db.eins('SELECT id, nr FROM rechnung WHERE dokument_id = ? ORDER BY id LIMIT 1', dokumentId);
  function json(d, dateien, n, alleVersionen = true, mitRechnung = false) {
    const r = mitRechnung ? rechnungZu(d.id) : null;
    const akt = dateien.find((x) => x.nr === d.version) || dateien[dateien.length - 1] || {};
    const url = (x) => `/api/baustellen/${d.baustelle_id}/dokumente/${d.id}/datei?version=${x.nr}`;
    return {
      id: d.id, baustelleId: d.baustelle_id, kategorie: d.kategorie, titel: d.titel, datum: d.datum, notiz: d.notiz || '', tags: JSON.parse(d.tags || '[]'),
      version: d.version, dateiname: akt.dateiname, mime: akt.mime, groesse: akt.groesse, url: akt.nr ? url(akt) : null,
      versionen: alleVersionen ? dateien.map((x) => ({ nr: x.nr, dateiname: x.dateiname, mime: x.mime, groesse: x.groesse, erstellt: x.erstellt, erstelltVon: x.erstellt_von ? { id: x.erstellt_von, name: n.get(x.erstellt_von) } : null, notiz: x.notiz || '', url: url(x) })) : undefined,
      erstellt: d.erstellt, erstelltVon: d.erstellt_von ? { id: d.erstellt_von, name: n.get(d.erstellt_von) } : null, geaendert: d.geaendert,
      ...(d.geloescht_zeit ? { geloescht: { zeit: d.geloescht_zeit, von: d.geloescht_von ? { id: d.geloescht_von, name: n.get(d.geloescht_von) } : null, grund: d.geloescht_grund || '' } } : {}),
      ...(r ? { rechnungId: r.id } : {}) // 12.16; nur mit Preisrecht (Inhaberregel 2)
    };
  }
  const dateienVon = (id) => db.alle('SELECT * FROM dokument_datei WHERE dokument_id = ? ORDER BY nr', id);

  function felder(body, teil) {
    const f = {};
    if (!teil || body.kategorie !== undefined) {
      const k = String(body.kategorie || '');
      if (!kategorien().has(k)) throw ungueltig('kategorie ist unbekannt.');
      f.kategorie = k;
    }
    if (!teil || body.titel !== undefined) f.titel = v.text(body.titel, 'titel', { max: 200 });
    if (body.datum !== undefined) f.datum = v.datum(body.datum, 'datum', { pflicht: false });
    if (body.notiz !== undefined) f.notiz = body.notiz == null ? null : v.text(body.notiz, 'notiz', { max: 2000, pflicht: false }) || null;
    if (body.tags !== undefined) {
      const t = v.liste(body.tags, 'tags', { max: 10 }).map((x, i) => v.text(x, `tags[${i}]`, { max: 40 }).trim()).filter(Boolean);
      f.tags = JSON.stringify([...new Set(t)]);
    }
    return f;
  }
  function dateiSpeichern(body) {
    let p;
    try { p = D.dokumentPruefen(body.dateiBase64); } catch (e) { throw ungueltig(e.message); }
    fs.mkdirSync(ordner(), { recursive: true, mode: 0o700 });
    const datei = `${crypto.randomBytes(16).toString('hex')}.${D.ENDUNG[p.mime]}`;
    fs.writeFileSync(path.join(ordner(), datei), p.daten, { flag: 'wx', mode: 0o600 });
    const dateiname = (typeof body.dateiname === 'string' ? body.dateiname : '').split(/[\\/]/).pop().replace(/[\p{Cc}\p{Cf}"<>|:*?]/gu, '').replace(/^\.+/, '').trim().slice(0, 120) || `dokument.${D.ENDUNG[p.mime]}`;
    return { datei, mime: p.mime, groesse: p.daten.length, sha256: p.sha256, dateiname };
  }
  function pfad(datei) {
    if (!/^[0-9a-f]{32}\.(pdf|jpg|png|webp|docx|xlsx)$/.test(datei)) throw nichtGefunden('Ungültiger Dateiname.');
    return path.join(ordner(), datei);
  }
  function laden(req, bs, { geloescht = false } = {}) {
    const d = db.eins(`SELECT * FROM dokument WHERE id = ? AND baustelle_id = ? ${geloescht ? '' : 'AND geloescht_zeit IS NULL'}`, v.pfadId(req.params.did, 'Dokument-ID'), bs.id);
    if (!d) throw nichtGefunden('Dokument nicht gefunden.');
    const z = zugriff(req.ctx, bs, kategorien().get(d.kategorie) || { finanziell: 1 });
    if (!z) throw keinZugriff('Diese Dokumentkategorie ist für Sie nicht sichtbar.');
    return { d, z };
  }

  api.get('/dokument-kategorien', (req, res) => {
    res.json([...kategorien().values()].map((k) => ({ schluessel: k.schluessel, name: k.name, finanziell: k.finanziell === 1, polier: k.polier === 1, eigen: k.eigen === 1 })));
  });
  api.post('/dokument-kategorien', (req, res) => {
    if (!req.ctx.hat('benutzer')) throw keinZugriff('Kategorien legt die Geschäftsführung an.');
    const body = v.objekt(req.body);
    const name = v.text(body.name, 'name', { max: 60 }).trim();
    if (name.length < 2) throw ungueltig('name: mindestens 2 Zeichen.');
    // N-051/N-099: gleicher Name (ohne Groß-/Kleinschreibung) wie im PUT → 409
    if (namePruefen(name)) throw konflikt('Eine Kategorie mit diesem Namen gibt es bereits.');
    const schluessel = name.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || `kat_${Date.now()}`;
    if (kategorien().has(schluessel)) throw konflikt('Diese Kategorie gibt es bereits.');
    const fl = katFlags(body, { finanziell: false, polier: false });
    const sort = (db.eins('SELECT MAX(sortierung) AS m FROM dokument_kategorie').m || 0) + 10;
    db.lauf('INSERT INTO dokument_kategorie (schluessel, name, finanziell, polier, eigen, sortierung) VALUES (?, ?, ?, ?, 1, ?)', schluessel, name, fl.finanziell ? 1 : 0, fl.polier ? 1 : 0, sort);
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'stammdaten', objekt: `dokument_kategorie:${schluessel}`, neu: { name, ...fl }, text: `Dokumentkategorie „${name}“ angelegt` });
    res.status(201).json({ schluessel, name, ...fl, eigen: true });
  });
  /** Name schon vergeben? (ohne Groß-/Kleinschreibung, Leerzeichen am Rand egal) */
  function namePruefen(name, ohne = null) {
    const n = name.trim().toLocaleLowerCase('de');
    return db.alle('SELECT schluessel, name FROM dokument_kategorie').some((x) => x.schluessel !== ohne && x.name.trim().toLocaleLowerCase('de') === n);
  }
  /** Rechte-Flags (finanziell/polier, Aliase enthaeltPreise/polierLesen): enthält Preise → nie für Polier */
  function katFlags(body, alt) {
    const wert = (a, b, feld) => (body[a] !== undefined ? v.bool(body[a], a) : body[b] !== undefined ? v.bool(body[b], b) : alt[feld]);
    const finanziell = wert('finanziell', 'enthaeltPreise', 'finanziell');
    const polier = finanziell ? false : wert('polier', 'polierLesen', 'polier');
    return { finanziell: Boolean(finanziell), polier: Boolean(polier) };
  }
  function katLaden(req) {
    if (!req.ctx.hat('benutzer')) throw keinZugriff('Kategorien verwaltet die Geschäftsführung.');
    const k = db.eins('SELECT * FROM dokument_kategorie WHERE schluessel = ?', String(req.params.schluessel || '').slice(0, 60));
    if (!k) throw nichtGefunden('Kategorie nicht gefunden.');
    return k;
  }
  api.put('/dokument-kategorien/:schluessel', (req, res) => {
    const k = katLaden(req);
    const body = v.objekt(req.body);
    const name = body.name === undefined ? k.name : v.text(body.name, 'name', { max: 60 }).trim();
    if (name.length < 2) throw ungueltig('name: mindestens 2 Zeichen.');
    if (namePruefen(name, k.schluessel)) throw konflikt('Eine Kategorie mit diesem Namen gibt es bereits.');
    const alt = { finanziell: k.finanziell === 1, polier: k.polier === 1 };
    let fl = alt;
    if (k.eigen) fl = katFlags(body, alt);
    else {
      // eingebaute Kategorien: nur der Name; die Rechte (Preise/Polier) sind fest
      const gewollt = katFlags(body, alt);
      if (gewollt.finanziell !== alt.finanziell || gewollt.polier !== alt.polier) throw ungueltig('Bei eingebauten Kategorien lässt sich nur der Name ändern.');
    }
    // N-104: „enthält Preise“ abschalten macht vorhandene Dokumente für Rollen ohne Preisrecht sichtbar → nur mit Bestätigung
    if (alt.finanziell && !fl.finanziell) {
      const anzahl = db.eins('SELECT COUNT(*) AS n FROM dokument WHERE kategorie = ?', k.schluessel).n;
      if (anzahl && body.bestaetigtPreisfrei !== true) {
        throw konflikt(`In „${k.name}“ liegen ${anzahl} Dokument(e), die bisher nur mit Preisrecht sichtbar waren. Ohne „enthält Preise“ werden sie${fl.polier ? ' auch für den Polier' : ''} sichtbar – bitte bestätigen, dass sie keine Preise enthalten (bestaetigtPreisfrei:true).`, { anzahl, bestaetigung: 'bestaetigtPreisfrei' });
      }
    }
    db.transaktion(() => {
      db.lauf('UPDATE dokument_kategorie SET name = ?, finanziell = ?, polier = ? WHERE schluessel = ?', name, fl.finanziell ? 1 : 0, fl.polier ? 1 : 0, k.schluessel);
      db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'stammdaten', objekt: `dokument_kategorie:${k.schluessel}`, alt: { name: k.name, ...alt }, neu: { name, ...fl }, text: `Dokumentkategorie „${k.name}“ geändert` });
    });
    res.json({ schluessel: k.schluessel, name, ...fl, eigen: k.eigen === 1 });
  });
  api.delete('/dokument-kategorien/:schluessel', (req, res) => {
    const k = katLaden(req);
    if (!k.eigen) throw konflikt('Eingebaute Kategorien lassen sich nicht löschen (nur umbenennen).');
    const anzahl = db.eins('SELECT COUNT(*) AS n FROM dokument WHERE kategorie = ?', k.schluessel).n;
    if (anzahl) throw konflikt(`In dieser Kategorie liegen noch ${anzahl} Dokument(e) (auch gelöschte zählen) – erst verschieben bzw. endgültig entfernen.`, { anzahl });
    db.transaktion(() => {
      db.lauf('DELETE FROM dokument_kategorie WHERE schluessel = ?', k.schluessel);
      db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'stammdaten', objekt: `dokument_kategorie:${k.schluessel}`, alt: { name: k.name }, neu: null, text: `Dokumentkategorie „${k.name}“ gelöscht` });
    });
    res.json({ ok: true });
  });

  function liste(req, bsIds, q) {
    const K = kategorien();
    const n = namen();
    const bed = [], par = [];
    bed.push(`baustelle_id IN (${bsIds.map(() => '?').join(',') || 'NULL'})`); par.push(...bsIds);
    if (q.geloescht !== '1' || !istVerwaltung(req.ctx)) bed.push('geloescht_zeit IS NULL');
    if (q.kategorie) { bed.push('kategorie = ?'); par.push(String(q.kategorie)); }
    const such = typeof (q.suche || q.q) === 'string' && (q.suche || q.q) ? String(q.suche || q.q).toLowerCase().slice(0, 100) : null;
    const tag = typeof q.tag === 'string' && q.tag ? q.tag.toLowerCase() : null;
    const bs = new Map(db.alle(`SELECT * FROM baustelle WHERE id IN (${bsIds.map(() => '?').join(',') || 'NULL'})`, ...bsIds).map((b) => [b.id, b]));
    return db.alle(`SELECT * FROM dokument WHERE ${bed.join(' AND ')} ORDER BY COALESCE(datum, substr(erstellt, 1, 10)) DESC, id DESC LIMIT 500`, ...par)
      .filter((d) => zugriff(req.ctx, bs.get(d.baustelle_id), K.get(d.kategorie) || { finanziell: 1 }))
      .filter((d) => !such || [d.titel, d.notiz, d.tags, (K.get(d.kategorie) || {}).name].some((x) => String(x || '').toLowerCase().includes(such)))
      .filter((d) => !tag || JSON.parse(d.tags || '[]').some((t) => t.toLowerCase() === tag))
      .map((d) => json(d, dateienVon(d.id), n, true, darfPreise(req.ctx, bs.get(d.baustelle_id))));
  }

  api.get('/baustellen/:id/dokumente', (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    pruefeBaustelle(req.ctx, bs);
    res.json(liste(req, [bs.id], req.query));
  });

  api.get('/dokumente/suche', (req, res) => {
    const ich = req.ctx.benutzer;
    if (ich.rolle === 'mitarbeiter') throw keinZugriff();
    const ids = db.alle('SELECT * FROM baustelle').filter((b) => { try { pruefeBaustelle(req.ctx, b); return true; } catch (_) { return false; } }).map((b) => b.id);
    res.json(liste(req, ids, { ...req.query, geloescht: '0' }).slice(0, 100));
  });

  api.get('/baustellen/:id/dokumente/:did', (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    pruefeBaustelle(req.ctx, bs);
    const { d } = laden(req, bs, { geloescht: istVerwaltung(req.ctx) });
    res.json(json(d, dateienVon(d.id), namen(), true, darfPreise(req.ctx, bs)));
  });

  api.post('/baustellen/:id/dokumente', (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    pruefeBaustelle(req.ctx, bs);
    const body = v.objekt(req.body);
    const f = felder(body, false);
    if (zugriff(req.ctx, bs, kategorien().get(f.kategorie)) !== 'schreiben') throw keinZugriff('Dokumente dieser Kategorie dürfen Sie nicht hochladen.');
    const x = dateiSpeichern(body);
    try {
      const id = db.transaktion(() => {
        const r = db.lauf('INSERT INTO dokument (baustelle_id, kategorie, titel, datum, notiz, tags, version, erstellt, erstellt_von, geaendert) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)',
          bs.id, f.kategorie, f.titel, f.datum || null, f.notiz || null, f.tags || '[]', jetzt(), req.ctx.benutzer.id, jetzt());
        db.lauf('INSERT INTO dokument_datei (dokument_id, nr, datei, mime, groesse, sha256, dateiname, erstellt, erstellt_von) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)', r.id, x.datei, x.mime, x.groesse, x.sha256, x.dateiname, jetzt(), req.ctx.benutzer.id);
        db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'dokument', objekt: `baustelle:${bs.id}`, neu: { dokumentId: r.id, kategorie: f.kategorie, titel: f.titel, sha256: x.sha256 }, text: `Dokument „${f.titel}“ (${f.kategorie}) zu ${bs.kst} hochgeladen` });
        return r.id;
      });
      res.status(201).json(json(db.eins('SELECT * FROM dokument WHERE id = ?', id), dateienVon(id), namen()));
    } catch (e) { try { fs.unlinkSync(pfad(x.datei)); } catch (_) { /* egal */ } throw e; }
  });

  api.post('/baustellen/:id/dokumente/:did/versionen', (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    pruefeBaustelle(req.ctx, bs);
    const { d, z } = laden(req, bs);
    if (z !== 'schreiben') throw keinZugriff();
    const body = v.objekt(req.body);
    const notiz = body.notiz == null ? null : v.text(body.notiz, 'notiz', { max: 500, pflicht: false }) || null;
    const x = dateiSpeichern(body);
    try {
      db.transaktion(() => {
        const nr = db.eins('SELECT MAX(nr) AS m FROM dokument_datei WHERE dokument_id = ?', d.id).m + 1;
        db.lauf('INSERT INTO dokument_datei (dokument_id, nr, datei, mime, groesse, sha256, dateiname, notiz, erstellt, erstellt_von) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', d.id, nr, x.datei, x.mime, x.groesse, x.sha256, x.dateiname, notiz, jetzt(), req.ctx.benutzer.id);
        db.lauf('UPDATE dokument SET version = ?, geaendert = ? WHERE id = ?', nr, jetzt(), d.id);
        db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'dokument', objekt: `dokument:${d.id}`, neu: { version: nr, sha256: x.sha256 }, text: `Dokument „${d.titel}“: neue Version ${nr}` });
      });
    } catch (e) { try { fs.unlinkSync(pfad(x.datei)); } catch (_) { /* egal */ } throw e; }
    res.status(201).json(json(db.eins('SELECT * FROM dokument WHERE id = ?', d.id), dateienVon(d.id), namen()));
  });

  api.put('/baustellen/:id/dokumente/:did', (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    pruefeBaustelle(req.ctx, bs);
    const { d, z } = laden(req, bs);
    if (z !== 'schreiben') throw keinZugriff();
    const body = v.objekt(req.body);
    const f = felder(body, true);
    if (f.kategorie && zugriff(req.ctx, bs, kategorien().get(f.kategorie)) !== 'schreiben') throw keinZugriff('In diese Kategorie dürfen Sie nicht verschieben.');
    if (f.kategorie && f.kategorie !== d.kategorie) {
      // N-050: ein mit einer Rechnung verknüpftes PDF bleibt in „Ausgangsrechnungen“
      const r = rechnungZu(d.id);
      if (r) throw konflikt(`Das Dokument ist mit der Rechnung ${r.nr} verknüpft und bleibt in „${(kategorien().get(d.kategorie) || {}).name || d.kategorie}“. Erst die Verknüpfung in der Rechnung lösen.`, { rechnungId: r.id });
      // N-103: aus einer Kategorie mit Preisen in eine ohne → alle Versionen werden für Rollen ohne Preisrecht sichtbar
      const von = kategorien().get(d.kategorie) || { finanziell: 1 };
      const nach = kategorien().get(f.kategorie);
      if (von.finanziell && !nach.finanziell && body.bestaetigtPreisfrei !== true) {
        const n = db.eins('SELECT COUNT(*) AS n FROM dokument_datei WHERE dokument_id = ?', d.id).n;
        throw konflikt(`„${d.titel}“ lag in „${von.name}“ (enthält Preise). In „${nach.name}“ werden alle ${n} Version(en)${nach.polier ? ' auch für den Polier' : ''} sichtbar – bitte bestätigen, dass keine Version Preise enthält (bestaetigtPreisfrei:true).`, { versionen: n, bestaetigung: 'bestaetigtPreisfrei' });
      }
    }
    const k = Object.keys(f);
    if (!k.length) throw ungueltig('Keine Änderungen angegeben.');
    db.transaktion(() => {
      db.lauf(`UPDATE dokument SET ${k.map((x) => `${x} = ?`).join(', ')}, geaendert = ? WHERE id = ?`, ...k.map((x) => f[x]), jetzt(), d.id);
      db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'dokument', objekt: `dokument:${d.id}`, alt: Object.fromEntries(k.map((x) => [x, d[x]])), neu: { ...f, ...(body.bestaetigtPreisfrei === true && f.kategorie !== d.kategorie ? { bestaetigtPreisfrei: true } : {}) }, text: `Dokument „${d.titel}“ geändert` });
    });
    res.json(json(db.eins('SELECT * FROM dokument WHERE id = ?', d.id), dateienVon(d.id), namen(), true, darfPreise(req.ctx, bs)));
  });

  api.delete('/baustellen/:id/dokumente/:did', (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    pruefeBaustelle(req.ctx, bs);
    const { d, z } = laden(req, bs);
    if (z !== 'schreiben') throw keinZugriff();
    const grund = req.body && req.body.grund != null ? v.text(req.body.grund, 'grund', { max: 300, pflicht: false }) : null;
    const r = rechnungZu(d.id); // N-050: verknüpftes Rechnungs-PDF nicht stillschweigend löschen
    if (r) throw konflikt(`Das Dokument ist mit der Rechnung ${r.nr} verknüpft. Erst die Verknüpfung in der Rechnung lösen, dann löschen.`, { rechnungId: r.id });
    db.transaktion(() => {
      db.lauf('UPDATE dokument SET geloescht_zeit = ?, geloescht_von = ?, geloescht_grund = ? WHERE id = ?', jetzt(), req.ctx.benutzer.id, grund, d.id);
      db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'dokument', objekt: `dokument:${d.id}`, neu: { geloescht: true, grund }, text: `Dokument „${d.titel}“ gelöscht (wiederherstellbar)` });
    });
    res.json({ ok: true });
  });

  api.post('/baustellen/:id/dokumente/:did/wiederherstellen', (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    if (!istVerwaltung(req.ctx)) throw keinZugriff('Wiederherstellen dürfen Büro bzw. GF.');
    const { d } = laden(req, bs, { geloescht: true });
    db.transaktion(() => {
      db.lauf('UPDATE dokument SET geloescht_zeit = NULL, geloescht_von = NULL, geloescht_grund = NULL WHERE id = ?', d.id);
      db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'dokument', objekt: `dokument:${d.id}`, text: `Dokument „${d.titel}“ wiederhergestellt` });
    });
    res.json(json(db.eins('SELECT * FROM dokument WHERE id = ?', d.id), dateienVon(d.id), namen()));
  });

  api.get('/baustellen/:id/dokumente/:did/datei', (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    pruefeBaustelle(req.ctx, bs);
    const { d } = laden(req, bs, { geloescht: istVerwaltung(req.ctx) });
    const nr = req.query.version ? v.zahl(Number(req.query.version), 'version', { min: 1, ganz: true }) : d.version;
    const x = db.eins('SELECT * FROM dokument_datei WHERE dokument_id = ? AND nr = ?', d.id, nr);
    if (!x) throw nichtGefunden('Version nicht gefunden.');
    let daten;
    try { daten = fs.readFileSync(pfad(x.datei)); } catch (_) { throw nichtGefunden('Datei nicht vorhanden.'); }
    const inline = x.mime.startsWith('image/') || x.mime === 'application/pdf';
    const name = (x.dateiname || `dokument-${d.id}.${D.ENDUNG[x.mime]}`).replace(/[^\w.\- äöüÄÖÜß]/g, '_');
    res.setHeader('Content-Type', x.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; plugin-types application/pdf; sandbox");
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(daten);
  });
};
