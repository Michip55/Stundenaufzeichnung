'use strict';
/**
 * Bauvorhaben: Lebenslauf (Phasen), Archiv, Gewährleistung und Haftrücklass (API.md 12.15).
 */
const { ungueltig, konflikt, keinZugriff } = require('./fehler');
const { wienDatum, plusTage, istDatum } = require('./datum');
const { parseJson } = require('./daten');
const { benachrichtige } = require('./budget');

const PHASEN = ['angebot', 'geplant', 'in_arbeit', 'pausiert', 'fertiggestellt', 'abgenommen', 'schlussrechnung', 'bezahlt', 'archiviert', 'storniert'];
const PHASE_NAMEN = {
  angebot: 'Angebot', geplant: 'Geplant', in_arbeit: 'In Arbeit', pausiert: 'Pausiert', fertiggestellt: 'Fertiggestellt',
  abgenommen: 'Abgenommen', schlussrechnung: 'Schlussrechnung gelegt', bezahlt: 'Bezahlt', archiviert: 'Archiviert', storniert: 'Storniert'
};
const UEBERGAENGE = {
  angebot: ['geplant', 'storniert'],
  geplant: ['in_arbeit', 'pausiert', 'storniert', 'angebot'],
  in_arbeit: ['pausiert', 'fertiggestellt', 'storniert'],
  pausiert: ['in_arbeit', 'storniert'],
  fertiggestellt: ['abgenommen', 'in_arbeit'],
  abgenommen: ['schlussrechnung', 'fertiggestellt'],
  schlussrechnung: ['bezahlt', 'abgenommen'],
  bezahlt: ['archiviert', 'schlussrechnung'],
  storniert: ['archiviert', 'geplant'],
  archiviert: []
};
const BAULEITER_ZIELE = ['geplant', 'in_arbeit', 'pausiert', 'fertiggestellt', 'abgenommen'];

/** Bisheriges Feld `status` aus der Phase */
function statusAusPhase(phase) {
  if (phase === 'angebot' || phase === 'geplant') return 'geplant';
  if (phase === 'in_arbeit' || phase === 'pausiert') return 'aktiv';
  return 'abgeschlossen';
}
/** Phase aus dem bisherigen Feld `status` (PUT /baustellen/:id) */
function phaseAusStatus(status) {
  return { geplant: 'geplant', aktiv: 'in_arbeit', abgeschlossen: 'fertiggestellt' }[status];
}

const istPlaner = (ctx) => ['buero', 'gf'].includes(ctx.benutzer.rolle) || ctx.hat('stammdaten');

/** Felder für das Baustellen-JSON (ohne €; € ergänzt der Aufrufer mit Preisrecht) */
function phaseFelder(db, bs, mitPreisen) {
  const fm = parseJson(bs.fertigmeldung, null);
  const o = {
    phase: bs.phase, phaseName: PHASE_NAMEN[bs.phase], phaseSeit: bs.phase_seit, archiviert: bs.phase === 'archiviert',
    abnahmeDatum: bs.abnahme_datum, gewaehrleistungBis: bs.gewaehrleistung_bis
  };
  if (fm) {
    const b = db.eins('SELECT id, name FROM benutzer WHERE id = ?', fm.von);
    o.fertigmeldung = { von: b ? { id: b.id, name: b.name } : null, zeit: fm.zeit, notiz: fm.notiz || '' };
  }
  if (mitPreisen) {
    // R-04: der Vorschlag leitet sich aus Rechnungen/Zahlungen ab – nur mit Preis-/Rechnungsrecht für diese Baustelle
    const v = phaseVorschlag(db, bs);
    if (v) o.phaseVorschlag = v;
    const sr = parseJson(bs.schlussrechnung, null);
    if (sr) o.schlussrechnung = sr;
    const hr = parseJson(bs.haftruecklass, null);
    if (hr) o.haftruecklass = hr;
  }
  return o;
}

/** Vorschlag aus den Rechnungen (12.17); null, wenn es (noch) keine Rechnungsdaten gibt */
function phaseVorschlag(db, bs) {
  if (!db.eins("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rechnung'")) return null;
  const r = db.alle("SELECT * FROM rechnung WHERE baustelle_id = ? AND storniert IS NULL", bs.id);
  const vor = PHASEN.indexOf(bs.phase);
  if (r.some((x) => x.typ === 'schluss') && vor < PHASEN.indexOf('schlussrechnung') && ['abgenommen', 'fertiggestellt'].includes(bs.phase)) {
    return { phase: 'schlussrechnung', grund: 'Schlussrechnung ist erfasst.' };
  }
  if (!r.length) return null;
  const { rechnungStand } = require('./rechnungen');
  const staende = r.map((x) => rechnungStand(db, x));
  const allesBezahlt = staende.every((x) => x.status === 'bezahlt');
  const ruecklass = staende.reduce((a, x) => a + x.ruecklassOffen, 0);
  if (bs.phase === 'schlussrechnung' && allesBezahlt) return { phase: 'bezahlt', grund: ruecklass > 0 ? 'Alle Rechnungen bezahlt (Haftrücklass noch offen).' : 'Alle Rechnungen bezahlt.' };
  if (bs.phase === 'bezahlt' && allesBezahlt && ruecklass <= 0.005) return { phase: 'archiviert', grund: 'Bezahlt, kein offener Rücklass – kann archiviert werden.' };
  return null;
}

/** Grundrecht für Phasenwechsel (vor jeder Zustands-/Versionsprüfung, R-07) */
function pruefePhaseRecht(ctx, bs) {
  if (istPlaner(ctx)) return;
  if (!(ctx.benutzer.rolle === 'bauleiter' && bs.bauleiter_id === ctx.benutzer.id)) throw keinZugriff('Den Stand des Bauvorhabens ändern Büro, GF und der Bauleiter der Baustelle.');
}

/**
 * Phase wechseln (Rechte, Übergang, Pflichtfelder) – im Aufrufer in einer Transaktion.
 * @returns {object} aktualisierte Baustelle
 */
function wechslePhase(bt, ctx, bs, body) {
  const { db } = bt;
  const ziel = body.phase;
  if (!PHASEN.includes(ziel)) throw ungueltig(`phase muss einer von ${PHASEN.join(', ')} sein.`);
  if (bs.phase === 'archiviert') throw konflikt('Die Baustelle ist archiviert – zuerst das Archiv aufheben (nur Geschäftsführung).');
  if (!(UEBERGAENGE[bs.phase] || []).includes(ziel)) throw konflikt(`Von „${PHASE_NAMEN[bs.phase]}“ geht es nicht nach „${PHASE_NAMEN[ziel]}“ (möglich: ${(UEBERGAENGE[bs.phase] || []).map((p) => PHASE_NAMEN[p]).join(', ') || '–'}).`);
  const ich = ctx.benutzer;
  pruefePhaseRecht(ctx, bs);
  if (!istPlaner(ctx)) {
    if (!BAULEITER_ZIELE.includes(ziel) || !BAULEITER_ZIELE.includes(bs.phase)) throw keinZugriff('Als Bauleiter bis „Abgenommen“ – Schlussrechnung, Bezahlung und Archiv erledigt das Büro.');
  }
  const heute = wienDatum(bt.uhr());
  const datum = body.datum === undefined || body.datum === null ? heute : body.datum;
  if (!istDatum(datum) || datum > plusTage(heute, 1) || datum < plusTage(heute, -3650)) throw ungueltig('datum ist ungültig (nicht in der Zukunft).');
  const notiz = body.notiz == null ? null : String(body.notiz).slice(0, 500);
  const set = { phase: ziel, phase_seit: datum, status: statusAusPhase(ziel) };
  if (ziel === 'abgenommen') {
    if (!istDatum(body.abnahmeDatum || '')) throw ungueltig('abnahmeDatum (Übernahme durch den Auftraggeber) fehlt.');
    set.abnahme_datum = body.abnahmeDatum;
    const gb = body.gewaehrleistungBis;
    if (gb !== undefined && gb !== null && !istDatum(gb)) throw ungueltig('gewaehrleistungBis ist ungültig.');
    set.gewaehrleistung_bis = gb || `${Number(body.abnahmeDatum.slice(0, 4)) + 3}${body.abnahmeDatum.slice(4)}`;
  }
  if (ziel === 'schlussrechnung' && body.schlussrechnung) {
    const sr = body.schlussrechnung;
    if (typeof sr !== 'object' || Array.isArray(sr)) throw ungueltig('schlussrechnung muss ein Objekt sein.');
    const o = { nr: sr.nr == null ? null : String(sr.nr).slice(0, 40), datum: sr.datum && istDatum(sr.datum) ? sr.datum : datum };
    if (sr.betrag !== undefined && sr.betrag !== null) {
      if (!ctx.hat('preise_bearbeiten')) throw keinZugriff('Den Betrag der Schlussrechnung erfassen Büro bzw. GF.');
      if (!(typeof sr.betrag === 'number' && Number.isFinite(sr.betrag) && Math.abs(sr.betrag) <= 1e9)) throw ungueltig('schlussrechnung.betrag ist ungültig.');
      o.betrag = Math.round(sr.betrag * 100) / 100;
    }
    set.schlussrechnung = JSON.stringify(o);
  }
  if (ziel === 'archiviert') { set.phase_vor_archiv = bs.phase; set.archiviert_am = heute; }
  if (ziel === 'fertiggestellt' || ziel === 'storniert') set.fertigmeldung = null;
  const k = Object.keys(set);
  db.lauf(`UPDATE baustelle SET ${k.map((x) => `${x} = ?`).join(', ')}, version = version + 1 WHERE id = ?`, ...k.map((x) => set[x]), bs.id);
  db.lauf('INSERT INTO baustelle_phase (baustelle_id, phase, datum, zeit, von, notiz) VALUES (?, ?, ?, ?, ?, ?)', bs.id, ziel, datum, bt.uhr().toISOString(), ich.id, notiz);
  db.protokolliere({ zeit: bt.uhr().toISOString(), benutzerId: ich.id, art: 'baustelle_phase', objekt: `baustelle:${bs.id}`, alt: { phase: bs.phase }, neu: { phase: ziel, datum, notiz }, text: `Bauvorhaben ${bs.kst}: ${PHASE_NAMEN[bs.phase]} → ${PHASE_NAMEN[ziel]}` });
  return db.eins('SELECT * FROM baustelle WHERE id = ?', bs.id);
}

/** Stündliche Erinnerungen (je Ereignis einmal, Texte ohne €) */
function pruefeBauvorhaben(bt) {
  const { db } = bt;
  const heute = wienDatum(bt.uhr());
  const zeit = bt.uhr().toISOString();
  const buero = db.alle("SELECT id FROM benutzer WHERE aktiv = 1 AND rolle = 'buero'");
  const bueroGf = db.alle("SELECT id FROM benutzer WHERE aktiv = 1 AND rolle IN ('buero','gf')");
  const melde = (empf, bs, titel, text, schluessel) => {
    for (const e of empf) benachrichtige(db, { benutzerId: e.id, typ: 'baustelle', titel, text, zeit, baustelleId: bs.id, schluessel });
  };
  const de = (d) => d.split('-').reverse().join('.');
  for (const bs of db.alle("SELECT * FROM baustelle WHERE phase NOT IN ('archiviert','storniert') AND intern = 0")) { // 12.25: ohne interne Kostenstellen
    const name = `${bs.kst} ${bs.kurz || bs.name}`;
    if (bs.phase === 'abgenommen' && bs.abnahme_datum && plusTage(bs.abnahme_datum, 14) < heute) {
      const sr = db.eins("SELECT name FROM sqlite_master WHERE name = 'rechnung'") ? db.eins("SELECT 1 AS x FROM rechnung WHERE baustelle_id = ? AND typ = 'schluss' AND storniert IS NULL", bs.id) : null;
      if (!sr) melde(buero, bs, `Schlussrechnung fehlt: ${name}`, `Abnahme am ${de(bs.abnahme_datum)} – seit über 14 Tagen ohne Schlussrechnung.`, `bv:sr:${bs.id}:${bs.abnahme_datum}`);
    }
    if (bs.gewaehrleistung_bis && plusTage(heute, 92) >= bs.gewaehrleistung_bis && heute <= bs.gewaehrleistung_bis) {
      melde(bueroGf, bs, `Gewährleistung endet: ${name}`, `Gewährleistungsfrist endet am ${de(bs.gewaehrleistung_bis)} – Mängel vorher prüfen/begehen.`, `bv:gw:${bs.id}:${bs.gewaehrleistung_bis}`);
    }
    const hr = parseJson(bs.haftruecklass, null);
    if (hr && !hr.freigegeben) {
      if (hr.bankgarantieBis && plusTage(heute, 30) >= hr.bankgarantieBis && heute <= hr.bankgarantieBis) {
        melde(bueroGf, bs, `Bankgarantie läuft ab: ${name}`, `Bankgarantie für den Haftrücklass läuft am ${de(hr.bankgarantieBis)} ab.`, `bv:bg:${bs.id}:${hr.bankgarantieBis}`);
      }
      if (hr.freigabeAm && hr.freigabeAm <= heute) {
        melde(bueroGf, bs, `Haftrücklass freigeben lassen: ${name}`, `Ab ${de(hr.freigabeAm)} kann die Freigabe des Haftrücklasses beim Auftraggeber angefordert werden.`, `bv:hr:${bs.id}:${hr.freigabeAm}`);
      }
    }
  }
}

module.exports = { pruefePhaseRecht, PHASEN, PHASE_NAMEN, UEBERGAENGE, BAULEITER_ZIELE, statusAusPhase, phaseAusStatus, phaseFelder, phaseVorschlag, wechslePhase, pruefeBauvorhaben, istPlaner };
