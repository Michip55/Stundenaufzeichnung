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
/** Gründe einer Differenz beim Zahlungsabgleich (15.24) */
const DIFF_GRUENDE = { skonto: 'Skonto', deckung: 'Deckungsrücklass einbehalten', haft: 'Haftrücklass einbehalten', umlage: 'Umlage/Abzug des Auftraggebers', maengel: 'Mängel/Gegenforderung', spesen: 'Bankspesen/Rundung', sonstiges: 'Sonstiges', ueberzahlung: 'Überzahlung' };
const MAHN = { 1: 'Zahlungserinnerung', 2: '1. Mahnung', 3: '2. Mahnung' };
const TYPEN = { abschlag: 'Abschlagsrechnung', teil: 'Teilrechnung', schluss: 'Schlussrechnung', regie: 'Regierechnung', gutschrift: 'Gutschrift' };
const tageZwischen = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
const nrNorm = (nr) => String(nr).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Toleranz für Beträge „wie auf dem Papier“ (Rundung im Rechnungsprogramm, 15.24) */
const TOLERANZ = 0.02;
/** Welcher Rücklass ist auf der Rechnung? (Betrag geht vor Prozent, wie bisher) */
const hatRuecklass = (r, art) => (r[`${art}_betrag`] != null) || !!r[`${art}_prozent`];

/**
 * Beträge einer Rechnung aus den Kopfdaten (je Schritt auf Cent, 12.17) – auch für die Prüfung vor dem Speichern.
 * 15.24: USt und Brutto laut Rechnung (ust_betrag/brutto), sonst gerechnet; Deckungs- und Haftrücklass getrennt
 * (je Betrag oder Prozent vom Brutto); Zahlbetrag = Brutto − Deckungsrücklass − Haftrücklass;
 * Skonto = eingegebener Betrag oder Prozent × Zahlbetrag.
 */
function betraege(r) {
  const netto = r2(r.netto || 0);
  const rc = r.ust_modus === 'reverse_charge';
  const ustGerechnet = rc ? 0 : prozentVon(netto, r.ust_satz == null ? 20 : r.ust_satz);
  const ust = r.ust_betrag != null ? r2(r.ust_betrag) : ustGerechnet;
  const brutto = r.brutto != null ? r2(r.brutto) : r2(netto + ust);
  const rl = (art) => (r[`${art}_betrag`] != null ? r2(r[`${art}_betrag`]) : prozentVon(brutto, r[`${art}_prozent`] || 0));
  const deckung = rl('deckung'), haft = rl('haft');
  const ruecklass = r2(deckung + haft);
  const zahlbetrag = r2(brutto - ruecklass);
  const skontoMax = r.skonto_betrag != null ? r2(r.skonto_betrag) : r.skonto_prozent ? prozentVon(zahlbetrag, r.skonto_prozent) : 0;
  // Prozent zum eingegebenen Skonto-Betrag (nur zur Anzeige, drei Nachkommastellen)
  const skontoProzent = r.skonto_betrag != null ? (zahlbetrag > 0 ? Math.round((r.skonto_betrag / zahlbetrag) * 100000) / 1000 : 0) : (r.skonto_prozent ?? null);
  return { netto, ustGerechnet, ust, brutto, deckung, haft, ruecklass, zahlbetrag, skontoMax, skontoProzent };
}

/**
 * Prüft Netto/USt/Brutto „wie auf dem Papier“ (±0,02 €; Reverse Charge → USt 0). Gibt null oder einen Fehlertext
 * mit den erwarteten Werten zurück.
 */
function pruefePapier(r) {
  const { netto, ustGerechnet, ust, brutto } = betraege(r);
  const de = (x) => r2(x).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const erwartet = { ust: ustGerechnet, brutto: r2(netto + ust) };
  if (r.ust_modus === 'reverse_charge' && Math.abs(ust) > 0.004) return { text: `Reverse Charge: Die Rechnung weist keine Umsatzsteuer aus – USt muss 0,00 sein (eingetragen ${de(ust)}).`, erwartet: { ust: 0, brutto: netto } };
  if (Math.abs(ust - ustGerechnet) > TOLERANZ + 1e-9) return { text: `USt passt nicht zum Netto: ${de(netto)} × ${String(r.ust_satz == null ? 20 : r.ust_satz).replace('.', ',')} % = ${de(ustGerechnet)}, eingetragen ${de(ust)} (Toleranz 0,02).`, erwartet };
  if (Math.abs(brutto - (netto + ust)) > TOLERANZ + 1e-9) return { text: `Brutto passt nicht: Netto ${de(netto)} + USt ${de(ust)} = ${de(netto + ust)}, eingetragen ${de(brutto)} (Toleranz 0,02).`, erwartet };
  return null;
}

/** Freigabe-Datum des Haftrücklasses: laut Rechnung, sonst laut Bauvorhaben (Freigabe am), sonst Ende der Gewährleistung */
function haftFreiAb(db, r) {
  if (r.haft_frei_ab) return r.haft_frei_ab;
  const bs = db.eins('SELECT haftruecklass, gewaehrleistung_bis FROM baustelle WHERE id = ?', r.baustelle_id);
  const hr = bs ? parseJson(bs.haftruecklass, null) : null;
  return (hr && hr.freigabeAm) || (bs && bs.gewaehrleistung_bis) || null;
}
/** Deckungsrücklass wird mit der Schlussrechnung frei: deren Fälligkeit (jüngste, nicht stornierte), sonst offen (null) */
function deckungFreiAb(db, r) {
  const sr = r.typ === 'schluss' ? r : db.eins("SELECT * FROM rechnung WHERE baustelle_id = ? AND typ = 'schluss' AND storniert IS NULL ORDER BY datum DESC, id DESC LIMIT 1", r.baustelle_id);
  return sr ? plusTage(sr.datum, sr.zahlungsziel_tage || 0) : null;
}

/** Kennzahlen einer Rechnung (Beträge positiv; Gutschriften zählen in Summen negativ → vorzeichen) */
function rechnungStand(db, r, heute = wienDatum(db.uhr ? db.uhr() : new Date())) {
  const { ust, brutto, deckung, haft, ruecklass, zahlbetrag, skontoMax, skontoProzent } = betraege(r);
  const faellig = plusTage(r.datum, r.zahlungsziel_tage || 0);
  const skontoBis = r.skonto_tage ? plusTage(r.datum, r.skonto_tage) : null;
  const z = db.alle('SELECT * FROM rechnung_zahlung WHERE rechnung_id = ? ORDER BY datum, id', r.id);
  const normal = z.filter((x) => !x.ruecklass);
  const bezahlt = r2(normal.reduce((a, x) => a + x.betrag, 0));
  const skontoGenommen = r2(normal.reduce((a, x) => a + x.skonto, 0));
  // 15.24 Zahlungsabgleich: akzeptierte Abzüge schließen den Betrag, strittige bleiben offen (Teil von „offen“),
  // einbehaltene Rücklässe erhöhen den Deckungs-/Haftrücklass, Überzahlungen stehen getrennt
  const dl = db.alle('SELECT * FROM rechnung_differenz WHERE rechnung_id = ? ORDER BY id', r.id);
  const dSum = (fn) => r2(dl.filter(fn).reduce((a, x) => a + x.betrag, 0));
  const extraDeckung = dSum((x) => x.grund === 'deckung'), extraHaft = dSum((x) => x.grund === 'haft');
  const abzuegeAkzeptiert = dSum((x) => x.status === 'akzeptiert');
  const strittigSumme = dSum((x) => x.status === 'strittig');
  const ueberzahlung = dSum((x) => x.grund === 'ueberzahlung' && x.status === 'offen');
  const deckungG = r2(deckung + extraDeckung), haftG = r2(haft + extraHaft);
  const zahlbetragEff = r2(zahlbetrag - extraDeckung - extraHaft);
  const offen = Math.max(0, r2(zahlbetragEff - bezahlt - skontoGenommen - abzuegeAkzeptiert));
  const strittig = Math.min(strittigSumme, offen);
  const regulaer = r2(offen - strittig);
  // Rücklass-Zahlungen je Art (Alt-Zahlung ohne Art: zum vorhandenen Rücklass, Haft zuerst)
  const artVon = (x) => x.ruecklass_art || (haftG > 0 || deckungG <= 0 ? 'haft' : 'deckung');
  const rz = z.filter((x) => x.ruecklass);
  const haftBezahlt = r2(rz.filter((x) => artVon(x) === 'haft').reduce((a, x) => a + x.betrag, 0));
  const deckungBezahlt = r2(rz.filter((x) => artVon(x) === 'deckung').reduce((a, x) => a + x.betrag, 0));
  const ruecklassBezahlt = r2(haftBezahlt + deckungBezahlt);
  const haftOffen = Math.max(0, r2(haftG - haftBezahlt)), deckungOffen = Math.max(0, r2(deckungG - deckungBezahlt));
  const ruecklassOffen = r2(haftOffen + deckungOffen);
  const m = db.alle('SELECT * FROM rechnung_mahnung WHERE rechnung_id = ? ORDER BY stufe', r.id);
  let status;
  if (r.storniert) status = 'storniert';
  else if (offen <= 0.004) status = 'bezahlt';
  else if (regulaer <= 0.004) status = 'differenz'; // bezahlt bis auf strittige Differenzen – nicht überfällig, nicht gemahnt
  else if (heute > faellig && r.typ !== 'gutschrift') status = 'ueberfaellig'; // Gutschrift: wir schulden – nie überfällig/gemahnt (N-106)
  else if (normal.length) status = 'teilbezahlt';
  else status = 'offen';
  let bezahltAm = null;
  if ((status === 'bezahlt' || status === 'differenz') && normal.length) bezahltAm = normal[normal.length - 1].datum;
  const haftFrei = haftG > 0 ? haftFreiAb(db, r) : null;
  const deckungFrei = deckungG > 0 ? deckungFreiAb(db, r) : null;
  // Skonto, das noch genommen werden kann: Rest des Höchstbetrags, anteilig zum offenen (nicht strittigen) Betrag
  const skontoRest = skontoBis && heute <= skontoBis && regulaer > 0 && zahlbetrag > 0
    ? Math.max(0, Math.min(r2(skontoMax - skontoGenommen), r2((skontoMax * regulaer) / zahlbetrag))) : 0;
  return {
    ust, brutto, ruecklass, zahlbetrag, skontoMax, skontoProzent, skontoRest, faellig, skontoBis, bezahlt, skontoGenommen, offen, status, bezahltAm, ruecklassBezahlt,
    ueberfaelligTage: status === 'ueberfaellig' ? tageZwischen(faellig, heute) : 0,
    ruecklassOffen, ruecklassFaellig: (haftOffen > 0 ? haftFrei : null) || (deckungOffen > 0 ? deckungFrei : null),
    deckung: deckungG, haft: haftG, deckungRechnung: deckung, haftRechnung: haft, extraDeckung, extraHaft, deckungBezahlt, haftBezahlt, deckungOffen, haftOffen, haftFrei, deckungFrei,
    differenzen: dl, abzuegeAkzeptiert, strittig, strittigSumme, ueberzahlung, regulaer, zahlbetragEff,
    zahlungen: z, mahnungen: m, mahnstufe: m.length ? m[m.length - 1].stufe : 0,
    vorzeichen: r.typ === 'gutschrift' ? -1 : 1
  };
}

function rechnungJson(db, r, namen) {
  const s = rechnungStand(db, r);
  const bs = db.eins('SELECT id, kst, name, auftraggeber FROM baustelle WHERE id = ?', r.baustelle_id);
  const n = (id) => (id ? { id, name: namen.get(id) || '?' } : null);
  const arten = ['deckung', 'haft'].filter((a) => hatRuecklass(r, a));
  const extra = { deckung: s.extraDeckung, haft: s.extraHaft };
  const rl = (a) => (hatRuecklass(r, a) || extra[a] > 0 ? {
    eingabe: !hatRuecklass(r, a) ? 'einbehalten' : r[`${a}_betrag`] != null ? 'betrag' : 'prozent', prozent: !hatRuecklass(r, a) || r[`${a}_betrag`] != null ? null : r[`${a}_prozent`], betrag: s[a],
    ...(extra[a] > 0 ? { einbehaltenBeiZahlung: extra[a] } : {}),
    bezahlt: s[`${a}Bezahlt`], offen: s[`${a}Offen`], freiAb: a === 'haft' ? s.haftFrei : s.deckungFrei, ...(a === 'haft' ? { freiAbLautRechnung: r.haft_frei_ab || null } : {})
  } : null);
  return {
    id: r.id, baustelleId: r.baustelle_id, baustelle: bs, nr: r.nr, typ: r.typ, typName: TYPEN[r.typ], datum: r.datum, leistungVon: r.leistung_von, leistungBis: r.leistung_bis,
    netto: r.netto, ustModus: r.ust_modus, ustSatz: r.ust_modus === 'reverse_charge' ? 0 : r.ust_satz, ust: s.ust, brutto: s.brutto, ustLautRechnung: r.ust_betrag != null || r.brutto != null,
    zahlungszielTage: r.zahlungsziel_tage, faellig: s.faellig,
    skontoEingabe: r.skonto_betrag != null ? 'betrag' : r.skonto_prozent ? 'prozent' : null, skontoProzent: s.skontoProzent, skontoBetrag: s.skontoMax, skontoTage: r.skonto_tage, skontoBis: s.skontoBis,
    deckungsruecklass: rl('deckung'), haftruecklass: rl('haft'),
    // bisherige Felder (Summe beider Rücklässe; ruecklassArt 'beide', wenn beide auf der Rechnung stehen)
    ruecklassArt: arten.length === 2 ? 'beide' : arten[0] || null, ruecklassProzent: arten.length === 1 ? r[`${arten[0]}_prozent`] ?? null : null, ruecklassBetrag: arten.length === 1 ? r[`${arten[0]}_betrag`] ?? null : null,
    ruecklass: s.ruecklass, zahlbetrag: s.zahlbetrag,
    empfaenger: r.empfaenger || '', agZeichen: r.ag_zeichen || '',
    dokumentId: r.dokument_id, notiz: r.notiz || '',
    zahlungen: s.zahlungen.map((z) => ({ id: z.id, datum: z.datum, betrag: z.betrag, skonto: z.skonto, ruecklass: z.ruecklass === 1, ruecklassArt: z.ruecklass ? z.ruecklass_art || null : null, notiz: z.notiz || '', quelle: z.quelle, erfasst: z.erfasst, erfasstVon: n(z.erfasst_von) })),
    bezahlt: s.bezahlt, skontoGenommen: s.skontoGenommen, offen: s.offen, ueberfaelligTage: s.ueberfaelligTage, status: s.status, bezahltAm: s.bezahltAm,
    mahnungen: s.mahnungen.map((m) => ({ stufe: m.stufe, name: MAHN[m.stufe], datum: m.datum, erfasstVon: n(m.erfasst_von) })), mahnstufe: s.mahnstufe,
    ruecklassOffen: s.ruecklassOffen, ruecklassFaellig: s.ruecklassFaellig,
    // 15.24 Zahlungsabgleich
    differenzen: s.differenzen.map((d) => ({ id: d.id, zahlungId: d.zahlung_id, grund: d.grund, grundName: DIFF_GRUENDE[d.grund], text: d.text || '', betrag: d.betrag, status: d.status, skontoVerspaetet: d.skonto_verspaetet === 1, erfasst: d.erfasst })),
    abzuegeAkzeptiert: s.abzuegeAkzeptiert, strittig: s.strittig, ueberzahlung: s.ueberzahlung,
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
    if (s.status === 'bezahlt' || s.status === 'differenz' || r.typ === 'gutschrift') continue; // strittige Differenz: kein Mahn-Vorschlag
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

module.exports = { DIFF_GRUENDE, r2, prozentVon, betraege, pruefePapier, hatRuecklass, TOLERANZ, haftFreiAb, deckungFreiAb, MAHN, TYPEN, nrNorm, tageZwischen, rechnungStand, rechnungJson, summenBaustelle, pruefeRechnungen };
