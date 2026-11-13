'use strict';
/**
 * Nachkalkulation und Budget-Kennzahlen (reine Funktionen, ohne Datenbank).
 *
 *  Kosten   = Σ Personalstunden × Kostensatz Lohngruppe + Σ Gerätestunden × Gerätekostensatz
 *           + Σ Materialmenge × EK + Σ Fremdleistungen      (Berichte mit Status ≠ entwurf)
 *  Erlös    = Σ Leistungsmeldungen × EP + Σ Regiestunden × Regiesatz Facharbeiter
 *  Leistungsstand  = Erlös aus Leistungsmeldungen ÷ Auftragssumme gesamt
 *  Budget-Verbrauch = Kosten gesamt ÷ Auftragssumme gesamt
 *  Status kritisch, wenn Verbrauch − Leistungsstand > 10 Prozentpunkte (ab 15 % Leistungsstand)
 *  oder Verbrauch ≥ 100 %; warnung ab der ersten erreichten Schwelle.
 */

const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const r1 = (x) => Math.round((x + Number.EPSILON) * 10) / 10;
const KRITISCH_PP = 10;
const KRITISCH_AB_LEISTUNG = 15;
const STANDARD_SCHWELLEN = [80, 90, 100];

function get(map, id) {
  if (!map) return undefined;
  return map instanceof Map ? map.get(id) : map[id];
}

/** Kosten eines einzelnen Berichts (für kostenTag) */
function kostenBericht(bericht, preise) {
  let lohn = 0, geraete = 0, material = 0;
  for (const p of bericht.personal || []) {
    const lg = get(preise.lohngruppen, p.lohngruppeId);
    if (lg) lohn += (p.stunden || 0) * lg.kostensatz;
  }
  for (const g of bericht.geraete || []) {
    const ge = get(preise.geraete, g.geraetId);
    if (ge) geraete += (g.stunden || 0) * ge.kostensatz;
  }
  for (const m of bericht.material || []) {
    const ma = get(preise.materialien, m.materialId);
    if (ma) material += (m.menge || 0) * ma.ek;
  }
  return { lohn: r2(lohn), geraete: r2(geraete), material: r2(material), gesamt: r2(lohn + geraete + material) };
}

/** Schwellen, die bei diesem Verbrauch erreicht sind (aufsteigend) */
function erreichteSchwellen(verbrauchProzent, schwellen = STANDARD_SCHWELLEN) {
  if (verbrauchProzent == null) return [];
  return [...schwellen].sort((a, b) => a - b).filter((s) => verbrauchProzent >= s);
}

function istKritisch(verbrauch, leistungsstand) {
  if (verbrauch == null) return false;
  if (verbrauch >= 100) return true;
  return leistungsstand != null && leistungsstand >= KRITISCH_AB_LEISTUNG && verbrauch - leistungsstand > KRITISCH_PP;
}

/** Budget-Hinweise (typ alarm/kritisch/warnung, budget:true) */
function budgetHinweise(verbrauch, leistungsstand, schwellen = STANDARD_SCHWELLEN, was = 'Die Kosten') {
  const status = budgetStatus(verbrauch, leistungsstand, schwellen);
  if (verbrauch != null && verbrauch >= 100) return [{ typ: 'alarm', budget: true, text: `${was} haben die Auftragssumme erreicht – jede weitere Stunde ist Verlust, außer es kommt ein Nachtrag.` }];
  if (istKritisch(verbrauch, leistungsstand)) return [{ typ: 'kritisch', budget: true, text: `Budget-Verbrauch liegt ${r1(verbrauch - leistungsstand).toLocaleString('de-AT')} Prozentpunkte über dem Leistungsstand – die Kosten laufen der Leistung davon.` }];
  if (status === 'warnung') return [{ typ: 'warnung', budget: true, text: `Budget-Schwelle ${Math.max(...erreichteSchwellen(verbrauch, schwellen))} % erreicht – Restleistung und Restbudget prüfen.` }];
  return [];
}

function budgetStatus(verbrauch, leistungsstand, schwellen = STANDARD_SCHWELLEN) {
  if (verbrauch == null) return 'ok';
  if (istKritisch(verbrauch, leistungsstand)) return 'kritisch';
  if (erreichteSchwellen(verbrauch, schwellen).length) return 'warnung';
  return 'ok';
}

/**
 * @param {object} e
 * @param {number|null} e.auftragssumme
 * @param {Array<{id,text,betrag}>} e.nachtraege
 * @param {number[]} e.schwellen
 * @param {{lohngruppen, geraete, materialien, leistungen}} e.preise  Maps/Objekte id → Eintrag
 * @param {Array<{datum,status,personal:[{lohngruppeId,stunden}],geraete:[{geraetId,stunden}],material:[{materialId,menge}],regie:[{stunden}]}>} e.berichte
 * @param {Array<{id,text,betrag,datum}>} e.fremdleistungen
 * @param {Array<{leistungId,menge,datum}>} e.leistungsmeldungen
 * @param {string} [e.regieLohngruppe='fa']
 */
function berechneKalkulation(e) {
  const preise = e.preise;
  const schwellen = e.schwellen && e.schwellen.length ? e.schwellen : STANDARD_SCHWELLEN;
  const nachtraege = e.nachtraege || [];
  const auftragssumme = e.auftragssumme == null ? null : Number(e.auftragssumme);
  const auftragGesamt = auftragssumme == null && !nachtraege.length ? null
    : (auftragssumme || 0) + nachtraege.reduce((a, n) => a + n.betrag, 0);

  const gezaehlt = (e.berichte || []).filter((b) => b.status !== 'entwurf');
  const posLohn = new Map(), posGeraet = new Map(), posMaterial = new Map();
  const verlauf = new Map();
  const tag = (d) => { if (!verlauf.has(d)) verlauf.set(d, { kosten: 0, erloes: 0 }); return verlauf.get(d); };
  let ohneLohngruppe = 0, regieStunden = 0, lohnStunden = 0;
  const regieSatz = (get(preise.lohngruppen, e.regieLohngruppe || 'fa') || { regiesatz: 0 }).regiesatz;

  for (const b of gezaehlt) {
    const t = tag(b.datum);
    for (const p of b.personal || []) {
      const st = p.stunden || 0;
      if (!st) continue;
      lohnStunden += st;
      const lg = get(preise.lohngruppen, p.lohngruppeId);
      if (!lg) { ohneLohngruppe += st; continue; }
      const x = posLohn.get(p.lohngruppeId) || { lohngruppeId: p.lohngruppeId, name: lg.name, stunden: 0, satz: lg.kostensatz, betrag: 0 };
      x.stunden += st; x.betrag += st * lg.kostensatz;
      posLohn.set(p.lohngruppeId, x);
      t.kosten += st * lg.kostensatz;
    }
    for (const g of b.geraete || []) {
      const ge = get(preise.geraete, g.geraetId);
      if (!ge || !g.stunden) continue;
      const x = posGeraet.get(g.geraetId) || { geraetId: g.geraetId, code: ge.code, name: ge.name, stunden: 0, satz: ge.kostensatz, betrag: 0 };
      x.stunden += g.stunden; x.betrag += g.stunden * ge.kostensatz;
      posGeraet.set(g.geraetId, x);
      t.kosten += g.stunden * ge.kostensatz;
    }
    for (const m of b.material || []) {
      const ma = get(preise.materialien, m.materialId);
      if (!ma || !m.menge) continue;
      const x = posMaterial.get(m.materialId) || { materialId: m.materialId, code: ma.code, name: ma.name, einheit: ma.einheit, menge: 0, satz: ma.ek, betrag: 0 };
      x.menge += m.menge; x.betrag += m.menge * ma.ek;
      posMaterial.set(m.materialId, x);
      t.kosten += m.menge * ma.ek;
    }
    for (const r of b.regie || []) {
      regieStunden += r.stunden || 0;
      t.erloes += (r.stunden || 0) * regieSatz;
    }
  }

  const fremd = (e.fremdleistungen || []).map((f) => ({ id: f.id, text: f.text, datum: f.datum, betrag: r2(f.betrag) }));
  for (const f of e.fremdleistungen || []) tag(f.datum).kosten += f.betrag;

  const posLeistung = new Map();
  let erloesLeistung = 0;
  for (const l of e.leistungsmeldungen || []) {
    const le = get(preise.leistungen, l.leistungId);
    if (!le) continue;
    const x = posLeistung.get(l.leistungId) || { leistungId: l.leistungId, code: le.code, text: le.text, einheit: le.einheit, menge: 0, ep: le.ep, betrag: 0 };
    x.menge += l.menge; x.betrag += l.menge * le.ep;
    posLeistung.set(l.leistungId, x);
    erloesLeistung += l.menge * le.ep;
    tag(l.datum).erloes += l.menge * le.ep;
  }

  const sum = (m) => [...m.values()].reduce((a, x) => a + x.betrag, 0);
  const kLohn = sum(posLohn), kGeraete = sum(posGeraet), kMaterial = sum(posMaterial);
  const kFremd = (e.fremdleistungen || []).reduce((a, f) => a + f.betrag, 0);
  const kGesamt = kLohn + kGeraete + kMaterial + kFremd;
  const erloesRegie = regieStunden * regieSatz;
  const erloes = erloesLeistung + erloesRegie;
  const db = erloes - kGesamt;

  const basisOk = auftragGesamt != null && auftragGesamt > 0;
  const verbrauch = basisOk ? r1((kGesamt / auftragGesamt) * 100) : null;
  const leistungsstand = basisOk ? r1((erloesLeistung / auftragGesamt) * 100) : null;
  const status = budgetStatus(verbrauch, leistungsstand, schwellen);

  const hinweise = [];
  if (!basisOk) hinweise.push({ typ: 'info', text: 'Keine Auftragssumme erfasst – Budget-Verbrauch und Leistungsstand können nicht berechnet werden.' });
  hinweise.push(...budgetHinweise(verbrauch, leistungsstand, schwellen));
  const ungeprueft = gezaehlt.filter((b) => b.status !== 'freigegeben').length;
  if (ungeprueft) hinweise.push({ typ: 'info', text: `${ungeprueft} Bericht(e) unterschrieben, aber noch nicht freigegeben (ungeprüft).` });
  const entwuerfe = (e.berichte || []).length - gezaehlt.length;
  if (entwuerfe) hinweise.push({ typ: 'info', text: `${entwuerfe} Bericht(e) im Entwurf sind noch nicht enthalten.` });
  if (ohneLohngruppe) hinweise.push({ typ: 'warnung', text: `${r2(ohneLohngruppe).toLocaleString('de-AT')} Std. ohne Lohngruppe – dafür sind keine Lohnkosten gerechnet.` });
  if (lohnStunden > 0 && !posLeistung.size) hinweise.push({ typ: 'warnung', text: 'Stunden ohne Leistungsmeldung – bitte Leistung melden, sonst fehlt der Leistungsstand.' });
  hinweise.push({ typ: 'info', text: 'Vorläufig: Eingangsrechnungen (Fremdleistungen) werden laufend nachgetragen.' });

  let kumK = 0, kumE = 0;
  const verlaufListe = [...verlauf.keys()].sort().map((d) => {
    kumK += verlauf.get(d).kosten; kumE += verlauf.get(d).erloes;
    return { datum: d, kosten: r2(kumK), erloes: r2(kumE) };
  });

  const rund = (m, mengeFeld) => [...m.values()].map((x) => ({ ...x, [mengeFeld]: r2(x[mengeFeld]), betrag: r2(x.betrag) }));
  return {
    auftragssumme: auftragssumme == null ? null : r2(auftragssumme),
    nachtraege: nachtraege.map((n) => ({ id: n.id, text: n.text, betrag: r2(n.betrag) })),
    auftragGesamt: auftragGesamt == null ? null : r2(auftragGesamt),
    erloes: r2(erloes),
    erloesLeistung: r2(erloesLeistung),
    erloesRegie: r2(erloesRegie),
    kosten: { lohn: r2(kLohn), geraete: r2(kGeraete), material: r2(kMaterial), fremd: r2(kFremd), gesamt: r2(kGesamt) },
    db: r2(db),
    dbProzent: erloes > 0 ? r1((db / erloes) * 100) : null,
    budgetVerbrauchProzent: verbrauch,
    leistungsstandProzent: leistungsstand,
    status,
    schwellen: [...schwellen].sort((a, b) => a - b),
    stunden: { lohn: r2(lohnStunden), regie: r2(regieStunden) },
    positionen: {
      lohn: rund(posLohn, 'stunden'),
      geraete: rund(posGeraet, 'stunden'),
      material: rund(posMaterial, 'menge'),
      fremd,
      leistungen: rund(posLeistung, 'menge'),
      regie: { stunden: r2(regieStunden), satz: r2(regieSatz), betrag: r2(erloesRegie) }
    },
    verlauf: verlaufListe,
    hinweise
  };
}

module.exports = { berechneKalkulation, kostenBericht, budgetStatus, budgetHinweise, erreichteSchwellen, istKritisch, STANDARD_SCHWELLEN, KRITISCH_PP, KRITISCH_AB_LEISTUNG, r2, r1 };
