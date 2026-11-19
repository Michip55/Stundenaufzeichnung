'use strict';
/**
 * Bautagesbericht löschen mit Papierkorb (API.md 15.34, Inhaber 19.11.2026).
 *
 * - Löschen ist „weich“: bericht.geloescht_zeit/_von/_grund werden gesetzt, alle Kindzeilen (Personal, Geräte, Material, Regie,
 *   Unterschriften, Fotos, Sichtstand) bleiben unverändert an derselben ID. Jede Abfrage auf bericht schließt gelöschte
 *   Berichte aus (`geloescht_zeit IS NULL`) – Listen, Zähler, Nachkalkulation, Monat/Lohn/BUAK, Servicebuch, Fuhren, PDFs.
 * - 30 Tage wiederherstellbar; danach löscht der stündliche Lauf (server/index.js bt.stuendlich) den Bericht endgültig – samt
 *   Fotos/Lieferscheinen/Papierbericht-Dateien, Unterschriften, Personal-/Geräte-/Material-/Regiezeilen und Fern-Links.
 * - Stempelzeiten (Tabelle buchung) gehören nicht zum Bericht und bleiben immer unverändert.
 * - Fuhren (12.8b), die mit dem Bericht verknüpft waren, werden wieder „Vorschlag“ ohne Bericht (ein neuer Bericht für den Tag
 *   kann sie übernehmen); beim Wiederherstellen werden die noch unveränderten Fuhren wieder verknüpft.
 */
const fs = require('node:fs');
const path = require('node:path');

const FRIST_TAGE = 30;
const FRIST_MS = FRIST_TAGE * 24 * 60 * 60 * 1000;
const MIN_GRUND = 5;

/** Zeitpunkt (ISO), ab dem ein am `zeit` gelöschter Bericht endgültig weg ist */
const endgueltigAm = (zeit) => new Date(new Date(zeit).getTime() + FRIST_MS).toISOString();

/** Nicht gelöschter Bericht derselben Baustelle am selben Tag (außer `ohneId`) */
function aktiverBericht(db, baustelleId, datum, ohneId = -1) {
  return db.eins('SELECT id, status FROM bericht WHERE baustelle_id = ? AND datum = ? AND geloescht_zeit IS NULL AND id <> ?', baustelleId, datum, ohneId);
}

const tagText = (datum) => datum.split('-').reverse().join('.');
const STATUS_TEXT = { entwurf: 'Entwurf', unterschrieben: 'unterschrieben', freigegeben: 'freigegeben' };

/** Offene Hinweise zum Bericht („Bericht zur Freigabe“, „Zeiten überschneiden sich“) als gelesen markieren bzw. löschen */
const HINWEIS_MUSTER = (id) => [`bericht:${id}:%`, `bericht-ueberschneidung:${id}:%`];

/**
 * Bericht in den Papierkorb (in einer Transaktion). `b` = ladeBerichtRoh (nicht gelöscht), Rechte sind geprüft.
 * @returns {{geloeschtZeit:string, endgueltigAm:string}}
 */
function loeschen(bt, ctx, b, grund) {
  const { db } = bt;
  const zeit = bt.uhr().toISOString();
  db.transaktion(() => {
    const fuhren = db.alle('SELECT id, bericht_status AS status FROM plan_fuhre WHERE bericht_id = ? ORDER BY id', b.id);
    // übernommene und vorgeschlagene Fuhren: wieder Vorschlag ohne Bericht; „prüfen“ behält den Hinweis, nur ohne Verweis
    db.lauf("UPDATE plan_fuhre SET bericht_status = 'vorschlag', bericht_id = NULL WHERE bericht_id = ? AND bericht_status IN ('uebernommen', 'vorschlag')", b.id);
    db.lauf('UPDATE plan_fuhre SET bericht_id = NULL WHERE bericht_id = ?', b.id);
    const n = db.lauf('UPDATE bericht SET geloescht_zeit = ?, geloescht_von = ?, geloescht_grund = ?, geloescht_fuhren = ?, version = version + 1 WHERE id = ? AND geloescht_zeit IS NULL',
      zeit, ctx.benutzer.id, grund, fuhren.length ? JSON.stringify(fuhren) : null, b.id).changes;
    require('./berichtsicht').nachfuehren(db, b.id, null); // 15.15 (H-G4): Sichtstand mitführen (Inhalt unverändert)
    if (!n) throw require('./fehler').konflikt('Der Bericht wurde inzwischen schon gelöscht.');
    require('./routes/berichte').linksUngueltig(db, b.id); // offene Fernunterschrift-Links gelten nicht mehr (12.9)
    for (const m of HINWEIS_MUSTER(b.id)) db.lauf('UPDATE benachrichtigung SET gelesen = 1 WHERE gelesen = 0 AND schluessel LIKE ?', m);
    db.protokolliere({ zeit, benutzerId: ctx.benutzer.id, art: 'bericht', objekt: `bericht:${b.id}`,
      alt: { status: b.status, unterschriften: b.unterschriften.map((u) => u.rolle), fuhren: fuhren.map((f) => f.id) }, neu: { geloescht: zeit, grund },
      text: `Bericht ${b.baustelle.kst} ${b.datum} (${STATUS_TEXT[b.status] || b.status}) gelöscht – im Papierkorb bis ${tagText(require('./datum').wienDatum(new Date(endgueltigAm(zeit))))}. Begründung: ${grund}` });
  });
  folgen(bt, b, ctx.benutzer.id, 'Bautagesbericht gelöscht');
  return { geloeschtZeit: zeit, endgueltigAm: endgueltigAm(zeit) };
}

/** Auswertungen, die vom Bericht abhängen, neu bewerten (Budget-Alarme, Servicebuch-Gerätestunden) */
function folgen(bt, b, benutzerId, anlass) {
  if (b.status !== 'entwurf') require('./budget').pruefeBudget(bt, b.baustelle_id, { anlass, benutzerId });
  if (b.status !== 'entwurf' && b.geraete && b.geraete.length) require('./fuhrpark-erinnerung').pruefeFuhrparkSicher(bt);
}

/**
 * Gelöschten Bericht wiederherstellen (Rechte geprüft). 409, wenn es inzwischen einen neuen Bericht für denselben Tag gibt
 * oder die Frist abgelaufen ist.
 */
function wiederherstellen(bt, ctx, z) {
  const { db } = bt;
  const { konflikt } = require('./fehler');
  const zeit = bt.uhr().toISOString();
  if (endgueltigAm(z.geloescht_zeit) <= zeit) throw konflikt('Die 30 Tage im Papierkorb sind abgelaufen – der Bericht wird endgültig gelöscht und kann nicht mehr wiederhergestellt werden.');
  const anderer = aktiverBericht(db, z.baustelle_id, z.datum, z.id);
  if (anderer) {
    throw konflikt(`Für ${z.kst} am ${tagText(z.datum)} gibt es inzwischen einen neuen Bericht. Wiederherstellen geht erst, wenn dieser neue Bericht gelöscht ist – oder die Angaben bitte von Hand in den neuen Bericht übernehmen.`, { id: anderer.id });
  }
  db.transaktion(() => {
    const n = db.lauf('UPDATE bericht SET geloescht_zeit = NULL, geloescht_von = NULL, geloescht_grund = NULL, geloescht_fuhren = NULL, version = version + 1 WHERE id = ? AND geloescht_zeit IS NOT NULL', z.id).changes;
    require('./berichtsicht').nachfuehren(db, z.id, null); // 15.15 (H-G4)
    if (!n) throw konflikt('Der Bericht ist nicht mehr im Papierkorb.');
    // Fuhren wieder verknüpfen – nur, wenn sie seitdem unverändert „Vorschlag ohne Bericht“ geblieben sind
    let fuhren = [];
    try { fuhren = JSON.parse(z.geloescht_fuhren || '[]'); } catch (_) { fuhren = []; }
    let wieder = 0;
    for (const f of fuhren) {
      const jetztStatus = f.status === 'pruefen' ? 'pruefen' : 'vorschlag'; // so hat loeschen() sie hinterlassen
      wieder += db.lauf('UPDATE plan_fuhre SET bericht_status = ?, bericht_id = ? WHERE id = ? AND bericht_id IS NULL AND bericht_status = ?',
        f.status, z.id, f.id, jetztStatus).changes;
    }
    db.protokolliere({ zeit, benutzerId: ctx.benutzer.id, art: 'bericht', objekt: `bericht:${z.id}`, alt: { geloescht: z.geloescht_zeit, grund: z.geloescht_grund }, neu: { status: z.status, fuhren: wieder },
      text: `Bericht ${z.kst} ${z.datum} (${STATUS_TEXT[z.status] || z.status}) aus dem Papierkorb wiederhergestellt` });
  });
  const b = require('./routes/berichte').ladeBerichtRoh(db, z.id);
  folgen(bt, b, ctx.benutzer.id, 'Bautagesbericht wiederhergestellt');
  return b;
}

/** Gelöschte Berichte (Zeilen mit Baustelle), neueste Löschung zuerst */
function geloeschte(db, { id = null } = {}) {
  return db.alle(`SELECT r.id, r.baustelle_id, r.datum, r.status, r.version, r.geloescht_zeit, r.geloescht_von, r.geloescht_grund, r.geloescht_fuhren,
      b.kst, b.name, b.kurz, b.polier_id, b.bauleiter_id, u.name AS geloescht_von_name,
      (SELECT COUNT(*) FROM unterschrift x WHERE x.bericht_id = r.id) AS unterschriften
    FROM bericht r JOIN baustelle b ON b.id = r.baustelle_id LEFT JOIN benutzer u ON u.id = r.geloescht_von
    WHERE r.geloescht_zeit IS NOT NULL ${id != null ? 'AND r.id = ?' : ''} ORDER BY r.geloescht_zeit DESC, r.id DESC`, ...(id != null ? [id] : []));
}

/** Eintrag der Papierkorb-Liste (ohne €, ohne Personal) */
function eintragJson(db, z) {
  const anderer = aktiverBericht(db, z.baustelle_id, z.datum, z.id);
  return {
    id: z.id, baustelleId: z.baustelle_id, kst: z.kst, baustelle: z.kurz || z.name, datum: z.datum, status: z.status, version: z.version,
    unterschriften: z.unterschriften,
    geloescht: { zeit: z.geloescht_zeit, von: z.geloescht_von ? { id: z.geloescht_von, name: z.geloescht_von_name || '?' } : null, grund: z.geloescht_grund },
    endgueltigAm: endgueltigAm(z.geloescht_zeit),
    endgueltigDatum: require('./datum').wienDatum(new Date(endgueltigAm(z.geloescht_zeit))),
    wiederherstellbar: !anderer,
    ...(anderer ? { neuerBerichtId: anderer.id } : {})
  };
}

/**
 * Stündlicher Lauf: Berichte, die länger als 30 Tage im Papierkorb liegen, endgültig löschen (samt Dateien).
 * @returns {number} Anzahl endgültig gelöschter Berichte
 */
function endgueltigLoeschen(bt) {
  const { db } = bt;
  const jetzt = bt.uhr();
  const grenze = new Date(jetzt.getTime() - FRIST_MS).toISOString();
  const faellig = db.alle(`SELECT r.id, r.datum, r.status, r.geloescht_zeit, r.geloescht_grund, b.kst FROM bericht r JOIN baustelle b ON b.id = r.baustelle_id
    WHERE r.geloescht_zeit IS NOT NULL AND r.geloescht_zeit <= ? ORDER BY r.geloescht_zeit, r.id`, grenze);
  if (!faellig.length) return 0;
  const Bild = require('./fuhrpark-bild');
  const ordner = path.join(bt.uploads, 'berichte'); // = routes/berichtfotos.js ordner()
  let n = 0;
  for (const z of faellig) {
    const dateien = db.alle('SELECT datei FROM bericht_foto WHERE bericht_id = ?', z.id).map((f) => f.datei);
    db.transaktion(() => {
      db.lauf('UPDATE plan_fuhre SET bericht_id = NULL WHERE bericht_id = ?', z.id); // Fremdschlüssel ohne CASCADE
      for (const m of HINWEIS_MUSTER(z.id)) db.lauf('DELETE FROM benachrichtigung WHERE schluessel LIKE ?', m);
      // ON DELETE CASCADE: Personal, Geräte, Material, Regie, Unterschriften (+ Widerrufe), Fotos, Fern-Links, Sichtstand
      db.lauf('DELETE FROM bericht WHERE id = ? AND geloescht_zeit IS NOT NULL', z.id);
      db.protokolliere({ zeit: jetzt.toISOString(), benutzerId: null, art: 'bericht', objekt: `bericht:${z.id}`, alt: { geloescht: z.geloescht_zeit, grund: z.geloescht_grund, dateien: dateien.length },
        text: `Bericht ${z.kst} ${z.datum} endgültig gelöscht (${FRIST_TAGE} Tage im Papierkorb abgelaufen${dateien.length ? `, ${dateien.length} Datei(en)` : ''})` });
    });
    for (const d of dateien) { try { fs.unlinkSync(Bild.dateiPfad(ordner, d)); } catch (_) { /* schon weg */ } }
    n++;
  }
  return n;
}

module.exports = { FRIST_TAGE, FRIST_MS, MIN_GRUND, endgueltigAm, aktiverBericht, loeschen, wiederherstellen, geloeschte, eintragJson, endgueltigLoeschen };
