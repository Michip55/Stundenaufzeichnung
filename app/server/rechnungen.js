'use strict';
/**
 * Ausgangsrechnungen und Zahlungen (API.md 12.17) – Berechnung (kaufmännisch gerundet je Schritt),
 * Status, Offene Posten, Erinnerungen. €-Werte nur nach Rechteprüfung ausliefern.
 */
const { wienDatum, plusTage } = require('./datum');
const { parseJson } = require('./daten');
const { benachrichtige } = require('./budget');

const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const MAHN = { 1: 'Zahlungserinnerung', 2: '1. Mahnung', 3: '2. Mahnung' };
const TYPEN = { abschlag: 'Abschlagsrechnung', teil: 'Teilrechnung', schluss: 'Schlussrechnung', regie: 'Regierechnung', gutschrift: 'Gutschrift' };
const tageZwischen = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
const nrNorm = (nr) => String(nr).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Kennzahlen einer Rechnung (Beträge positiv; Gutschriften zählen in Summen negativ → vorzeichen) */
function rechnungStand(db, r, heute = wienDatum(db.uhr ? db.uhr() : new Date())) {
  const ust = r.ust_modus === 'reverse_charge' ? 0 : r2(r.netto * r.ust_satz / 100);
  const brutto = r2(r.netto + ust);
  const ruecklass = r.ruecklass_art ? (r.ruecklass_betrag != null ? r2(r.ruecklass_betrag) : r2(brutto * (r.ruecklass_prozent || 0) / 100)) : 0;
  const zahlbetrag = r2(brutto - ruecklass);
  const faellig = plusTage(r.datum, r.zahlungsziel_tage || 0);
  const skontoBis = r.skonto_tage ? plusTage(r.datum, r.skonto_tage) : null;
  const z = db.alle('SELECT * FROM rechnung_zahlung WHERE rechnung_id = ? ORDER BY datum, id', r.id);
  const normal = z.filter((x) => !x.ruecklass);
  const bezahlt = r2(normal.reduce((a, x) => a + x.betrag, 0));
  const skontoGenommen = r2(normal.reduce((a, x) => a + x.skonto, 0));
  const offen = Math.max(0, r2(zahlbetrag - bezahlt - skontoGenommen));
  const ruecklassOffen = Math.max(0, r2(ruecklass - z.filter((x) => x.ruecklass).reduce((a, x) => a + x.betrag, 0)));
  const m = db.alle('SELECT * FROM rechnung_mahnung WHERE rechnung_id = ? ORDER BY stufe', r.id);
  let status;
  if (r.storniert) status = 'storniert';
  else if (offen <= 0.004) status = 'bezahlt';
  else if (heute > faellig) status = 'ueberfaellig';
  else if (normal.length) status = 'teilbezahlt';
  else status = 'offen';
  let bezahltAm = null;
  if (status === 'bezahlt' && normal.length) bezahltAm = normal[normal.length - 1].datum;
  const bs = db.eins('SELECT haftruecklass FROM baustelle WHERE id = ?', r.baustelle_id);
  const hr = bs ? parseJson(bs.haftruecklass, null) : null;
  return {
    ust, brutto, ruecklass, zahlbetrag, faellig, skontoBis, bezahlt, skontoGenommen, offen, status, bezahltAm,
    ueberfaelligTage: status === 'ueberfaellig' ? tageZwischen(faellig, heute) : 0,
    ruecklassOffen, ruecklassFaellig: r.ruecklass_art === 'haft' && hr && hr.freigabeAm ? hr.freigabeAm : null,
    zahlungen: z, mahnungen: m, mahnstufe: m.length ? m[m.length - 1].stufe : 0,
    vorzeichen: r.typ === 'gutschrift' ? -1 : 1
  };
}

function rechnungJson(db, r, namen) {
  const s = rechnungStand(db, r);
  const bs = db.eins('SELECT id, kst, name, auftraggeber FROM baustelle WHERE id = ?', r.baustelle_id);
  const n = (id) => (id ? { id, name: namen.get(id) || '?' } : null);
  return {
    id: r.id, baustelleId: r.baustelle_id, baustelle: bs, nr: r.nr, typ: r.typ, typName: TYPEN[r.typ], datum: r.datum, leistungVon: r.leistung_von, leistungBis: r.leistung_bis,
    netto: r.netto, ustModus: r.ust_modus, ustSatz: r.ust_modus === 'reverse_charge' ? 0 : r.ust_satz, ust: s.ust, brutto: s.brutto,
    zahlungszielTage: r.zahlungsziel_tage, faellig: s.faellig, skontoProzent: r.skonto_prozent, skontoTage: r.skonto_tage, skontoBis: s.skontoBis,
    ruecklassArt: r.ruecklass_art, ruecklassProzent: r.ruecklass_prozent, ruecklassBetrag: r.ruecklass_betrag, ruecklass: s.ruecklass, zahlbetrag: s.zahlbetrag,
    dokumentId: r.dokument_id, notiz: r.notiz || '',
    zahlungen: s.zahlungen.map((z) => ({ id: z.id, datum: z.datum, betrag: z.betrag, skonto: z.skonto, ruecklass: z.ruecklass === 1, notiz: z.notiz || '', quelle: z.quelle, erfasst: z.erfasst, erfasstVon: n(z.erfasst_von) })),
    bezahlt: s.bezahlt, skontoGenommen: s.skontoGenommen, offen: s.offen, ueberfaelligTage: s.ueberfaelligTage, status: s.status, bezahltAm: s.bezahltAm,
    mahnungen: s.mahnungen.map((m) => ({ stufe: m.stufe, name: MAHN[m.stufe], datum: m.datum, erfasstVon: n(m.erfasst_von) })), mahnstufe: s.mahnstufe,
    ruecklassOffen: s.ruecklassOffen, ruecklassFaellig: s.ruecklassFaellig,
    ...(r.storniert ? { storniert: { zeit: r.storniert, grund: r.storniert_grund, von: n(r.storniert_von) } } : {}),
    erstellt: r.erstellt, version: r.version
  };
}

/** Summen je Baustelle für die Nachkalkulation */
function summenBaustelle(db, baustelleId) {
  let verrechnetNetto = 0, bezahlt = 0, offen = 0, ruecklassOffen = 0;
  for (const r of db.alle('SELECT * FROM rechnung WHERE baustelle_id = ? AND storniert IS NULL', baustelleId)) {
    const s = rechnungStand(db, r);
    verrechnetNetto += s.vorzeichen * r.netto;
    bezahlt += s.vorzeichen * (s.bezahlt + s.skontoGenommen);
    offen += s.vorzeichen * s.offen;
    ruecklassOffen += s.ruecklassOffen;
  }
  return { verrechnetNetto: r2(verrechnetNetto), bezahlt: r2(bezahlt), offen: r2(offen), ruecklassOffen: r2(ruecklassOffen) };
}

/** Stündliche Erinnerungen (je Rechnung und Stufe einmal; Texte ohne €) */
function pruefeRechnungen(bt) {
  const { db } = bt;
  const heute = wienDatum(bt.uhr());
  const zeit = bt.uhr().toISOString();
  const empf = db.alle("SELECT id FROM benutzer WHERE aktiv = 1 AND rolle IN ('buero','gf')");
  for (const r of db.alle('SELECT * FROM rechnung WHERE storniert IS NULL')) {
    const s = rechnungStand(db, r, heute);
    if (s.status === 'bezahlt' || r.typ === 'gutschrift') continue;
    if (heute > s.faellig) {
      for (const e of empf) benachrichtige(db, { benutzerId: e.id, typ: 'rechnung', titel: `Rechnung ${r.nr} fällig`, text: `Die Rechnung ${r.nr} war am ${s.faellig.split('-').reverse().join('.')} fällig und ist noch nicht vollständig bezahlt.`, zeit, baustelleId: r.baustelle_id, schluessel: `re:${r.id}:faellig` });
      const basis = s.mahnungen.length ? s.mahnungen[s.mahnungen.length - 1].datum : s.faellig;
      if (s.mahnstufe < 3 && tageZwischen(basis, heute) >= 14) {
        const n = s.mahnstufe + 1;
        for (const e of empf) benachrichtige(db, { benutzerId: e.id, typ: 'rechnung', titel: `${MAHN[n]} vorschlagen: Rechnung ${r.nr}`, text: `Rechnung ${r.nr} ist seit ${tageZwischen(s.faellig, heute)} Tagen überfällig – ${MAHN[n]} in BMD erstellen und hier vermerken.`, zeit, baustelleId: r.baustelle_id, schluessel: `re:${r.id}:mahn:${n}` });
      }
    }
  }
}

module.exports = { r2, MAHN, TYPEN, nrNorm, tageZwischen, rechnungStand, rechnungJson, summenBaustelle, pruefeRechnungen };
