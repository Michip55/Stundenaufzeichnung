'use strict';
/**
 * Ausgangsrechnungen und Zahlungen (API.md 12.17) – Berechnung (kaufmännisch gerundet je Schritt),
 * Status, Offene Posten, Erinnerungen. €-Werte nur nach Rechteprüfung ausliefern.
 */
const { wienDatum, plusTage } = require('./datum');
const { parseJson } = require('./daten');
const { benachrichtige, empfaengerMitRecht } = require('./benachrichtigung');

/**
 * Kaufmännisch auf Cent runden (½ Cent weg von 0). Der relative Zuschlag gleicht die Darstellungsfehler
 * von Gleitkommazahlen aus (z. B. 2400,055 als 2400,0549999…, N-018); echte Werte liegen nie so nah an ½ Cent.
 */
const r2 = (x) => {
  const n = Number(x);
  if (!Number.isFinite(n) || n === 0) return n === 0 ? 0 : n;
  const a = Math.abs(n) * 100;
  return Math.sign(n) * Math.round(a + a * 1e-13 + 1e-9) / 100;
};
/** Prozent eines Cent-Betrags, exakt in ganzen Cent (BigInt) kaufmännisch gerundet – USt, Rücklass, Skonto (N-018) */
function prozentVon(betrag, prozent) {
  if (!betrag || !prozent) return 0;
  const c = BigInt(Math.round(Math.abs(betrag) * 100));
  const p = BigInt(Math.round(Math.abs(prozent) * 1e6)); // Prozent in Millionstel
  const nenner = 100n * 1000000n;
  const q = (2n * c * p + nenner) / (2n * nenner);
  return (Math.sign(betrag) * Math.sign(prozent) * Number(q)) / 100;
}
const MAHN = { 1: 'Zahlungserinnerung', 2: '1. Mahnung', 3: '2. Mahnung' };
const TYPEN = { abschlag: 'Abschlagsrechnung', teil: 'Teilrechnung', schluss: 'Schlussrechnung', regie: 'Regierechnung', gutschrift: 'Gutschrift' };
const tageZwischen = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
const nrNorm = (nr) => String(nr).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Beträge einer Rechnung aus den Kopfdaten (je Schritt auf Cent, 12.17) – auch für die Prüfung vor dem Speichern */
function betraege(r) {
  const netto = r2(r.netto || 0);
  const ust = r.ust_modus === 'reverse_charge' ? 0 : prozentVon(netto, r.ust_satz == null ? 20 : r.ust_satz);
  const brutto = r2(netto + ust);
  const ruecklass = r.ruecklass_art ? (r.ruecklass_betrag != null ? r2(r.ruecklass_betrag) : prozentVon(brutto, r.ruecklass_prozent || 0)) : 0;
  const zahlbetrag = r2(brutto - ruecklass);
  const skontoMax = r.skonto_prozent ? prozentVon(zahlbetrag, r.skonto_prozent) : 0;
  return { ust, brutto, ruecklass, zahlbetrag, skontoMax };
}

/** Kennzahlen einer Rechnung (Beträge positiv; Gutschriften zählen in Summen negativ → vorzeichen) */
function rechnungStand(db, r, heute = wienDatum(db.uhr ? db.uhr() : new Date())) {
  const { ust, brutto, ruecklass, zahlbetrag, skontoMax } = betraege(r);
  const faellig = plusTage(r.datum, r.zahlungsziel_tage || 0);
  const skontoBis = r.skonto_tage ? plusTage(r.datum, r.skonto_tage) : null;
  const z = db.alle('SELECT * FROM rechnung_zahlung WHERE rechnung_id = ? ORDER BY datum, id', r.id);
  const normal = z.filter((x) => !x.ruecklass);
  const bezahlt = r2(normal.reduce((a, x) => a + x.betrag, 0));
  const skontoGenommen = r2(normal.reduce((a, x) => a + x.skonto, 0));
  const offen = Math.max(0, r2(zahlbetrag - bezahlt - skontoGenommen));
  const ruecklassBezahlt = r2(z.filter((x) => x.ruecklass).reduce((a, x) => a + x.betrag, 0));
  const ruecklassOffen = Math.max(0, r2(ruecklass - ruecklassBezahlt));
  const m = db.alle('SELECT * FROM rechnung_mahnung WHERE rechnung_id = ? ORDER BY stufe', r.id);
  let status;
  if (r.storniert) status = 'storniert';
  else if (offen <= 0.004) status = 'bezahlt';
  else if (heute > faellig && r.typ !== 'gutschrift') status = 'ueberfaellig'; // Gutschrift: wir schulden – nie überfällig/gemahnt (N-106)
  else if (normal.length) status = 'teilbezahlt';
  else status = 'offen';
  let bezahltAm = null;
  if (status === 'bezahlt' && normal.length) bezahltAm = normal[normal.length - 1].datum;
  const bs = db.eins('SELECT haftruecklass FROM baustelle WHERE id = ?', r.baustelle_id);
  const hr = bs ? parseJson(bs.haftruecklass, null) : null;
  return {
    ust, brutto, ruecklass, zahlbetrag, skontoMax, faellig, skontoBis, bezahlt, skontoGenommen, offen, status, bezahltAm, ruecklassBezahlt,
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

/**
 * Summen je Baustelle für die Nachkalkulation – alle Werte gezeichnet (Gutschrift negativ, N-019).
 * bezahlt = Σ betrag ohne Skonto und ohne Rücklass-Zahlungen (12.17, N-054); Skonto und Rücklass-Zahlungen getrennt.
 */
function summenBaustelle(db, baustelleId) {
  let verrechnetNetto = 0, bezahlt = 0, skontoGenommen = 0, offen = 0, ruecklassOffen = 0, ruecklassBezahlt = 0;
  for (const r of db.alle('SELECT * FROM rechnung WHERE baustelle_id = ? AND storniert IS NULL', baustelleId)) {
    const s = rechnungStand(db, r);
    verrechnetNetto += s.vorzeichen * r.netto;
    bezahlt += s.vorzeichen * s.bezahlt;
    skontoGenommen += s.vorzeichen * s.skontoGenommen;
    offen += s.vorzeichen * s.offen;
    ruecklassOffen += s.vorzeichen * s.ruecklassOffen;
    ruecklassBezahlt += s.vorzeichen * s.ruecklassBezahlt;
  }
  return { verrechnetNetto: r2(verrechnetNetto), bezahlt: r2(bezahlt), skontoGenommen: r2(skontoGenommen), offen: r2(offen), ruecklassOffen: r2(ruecklassOffen), ruecklassBezahlt: r2(ruecklassBezahlt) };
}

/** Stündliche Erinnerungen (je Rechnung und Stufe einmal; Texte ohne €) */
function pruefeRechnungen(bt) {
  const { db } = bt;
  const heute = wienDatum(bt.uhr());
  const zeit = bt.uhr().toISOString();
  const empf = empfaengerMitRecht(db, 'preise_sehen'); // 15.3: Rechnungsnummern nur mit preise_sehen (Bauleiter = Büro)
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

module.exports = { r2, prozentVon, betraege, MAHN, TYPEN, nrNorm, tageZwischen, rechnungStand, rechnungJson, summenBaustelle, pruefeRechnungen };
