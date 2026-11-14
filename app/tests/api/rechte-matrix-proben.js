'use strict';
/**
 * Proben der Rechte-Matrix (rechte-matrix.json): konkrete Anfrage je Route × Rolle × Variante.
 * Gemeinsam genutzt von rechte-matrix.test.js (jede Route × jede Rolle) und rechte-matrix-paritaet.test.js
 * (15.4: Büro = Bauleiter bei jeder Matrix). `ueber` ersetzt Platzhalter (z. B. eigene Objekte eines anderen Benutzers).
 */
const H = require('./rechte-matrix-hilfe');
const { BS } = require('./hilfe');
const { testJpeg } = require('./fuhrpark-bilder');
const { ROLLEN, ID, ANDERER_MA, FREMDER_MA } = H;

/** Erwartung je Rolle aus dem Matrix-Eintrag */
function erwartung(eintrag, rolle) {
  const teile = eintrag.r.split(/\s+/);
  if (teile.length !== 5) throw new Error(`Matrix-Eintrag mit ${teile.length} statt 5 Rollen: ${eintrag.r}`);
  return teile[ROLLEN.indexOf(rolle)];
}

/** Platzhalter je Rolle und Variante (eigen = Objekt im eigenen Bereich, fremd = außerhalb) */
const BEREICHS_PLATZHALTER = new Set(['bs', 'bericht', 'berichtAlt', 'berichtFoto', 'berichtLink', 'rechnung', 'zahlung', 'pos', 'posStand', 'posMenge', 'leistung', 'nachtrag', 'fremd', 'lv',
  'dok', 'einsatz', 'einsatzPerson', 'einsatzAnlage', 'fuhre', 'fuhreFoto', 'abschnitt', 'anfrage', 'schaden', 'schadenFoto', 'ichOderAnderer', 'person', 'abwEigen', 'antragEigen', 'abwAnderer', 'antragAnderer',
  'benachrichtigung', 'pushAbo', 'bsVersion']);
function platzhalter(F, rolle, variante, ueber = {}) {
  const e = variante !== 'fremd';
  const anderRolle = rolle === 'gf' ? 'buero' : 'gf';
  return {
    bs: e ? BS.pitten : BS.reisinger,
    bericht: e ? F.bericht.bs1 : F.bericht.bs3,
    berichtAlt: e ? F.bericht.bs1Alt : F.bericht.bs3Alt,
    berichtFoto: e ? F.bericht.bs1Foto : F.bericht.bs3Foto,
    berichtLink: e ? F.bericht.bs1Link : F.bericht.bs3Link,
    rechnung: e ? F.rechnung.bs1 : F.rechnung.bs3,
    zahlung: e ? F.rechnung.bs1Zahlung : F.rechnung.bs3Zahlung,
    pos: e ? F.pos.bs1 : F.pos.bs3,
    posStand: e ? F.pos.bs1Stand : F.pos.bs3Stand,
    posMenge: e ? F.pos.bs1MengeBl : F.pos.bs3MengePos,
    bsVersion: e ? F.bsVersion.bs1 : F.bsVersion.bs3,
    leistung: e ? F.leistung.bs1 : F.leistung.bs3,
    nachtrag: e ? F.nachtrag.bs1 : F.nachtrag.bs3,
    fremd: e ? F.fremd.bs1 : F.fremd.bs3,
    lv: e ? F.lv.bs1 : F.lv.bs3,
    dok: e ? F.dok.planBs1 : F.dok.planBs3,
    einsatz: e ? F.einsatz.bs1 : F.einsatz.bs3,
    einsatzPerson: e ? ANDERER_MA : FREMDER_MA,
    einsatzAnlage: e ? 4 : 5,
    fuhre: e ? F.fuhre.bs1 : F.fuhre.bs3,
    fuhreFoto: e ? F.fuhreFoto.bs1 : F.fuhreFoto.bs3,
    abschnitt: e ? F.abschnitt.bs1 : F.abschnitt.bs3,
    anfrage: e ? F.anfrage.bs1 : F.anfrage.bs3,
    schaden: e ? F.schaden.eigen : F.schaden.fremd,
    schadenFoto: e ? F.schaden.eigenFoto : F.schaden.fremdFoto,
    ichOderAnderer: e ? ID[rolle] : ANDERER_MA,
    person: e ? ANDERER_MA : FREMDER_MA,
    abwEigen: e ? F.urlaubEigenRolle[rolle].tag : F.urlaubAndererTag,
    antragEigen: e ? F.urlaubEigenRolle[rolle].antrag : F.urlaubAnderer,
    abwAnderer: e ? F.urlaubAnderer1Tag : F.urlaubFremdTag,
    antragAnderer: e ? F.urlaubAnderer : F.urlaubFremd,
    benachrichtigung: e ? F.benachrichtigung[rolle] : F.benachrichtigung[anderRolle],
    pushAbo: e ? F.pushAbo[rolle] : F.pushAbo[anderRolle],
    // ohne Bereich
    anlage: F.anlage, zaehler: F.zaehler, zaehlerstand: F.zaehlerstand, planposition: F.planposition, vorlage: F.vorlage, mangel: F.mangel, eintrag: F.eintrag,
    katalogPos: F.katalogPos, katalogStand: F.katalogStand, preisStand: F.preisStand, kategorie: F.kategorie, lohnVorlage: F.lohnVorlage, lohngruppeVerlauf: F.lohngruppeVerlauf,
    swMeldung: F.swMeldung,
    dummy: F.dummyBenutzer, buchungAnderer: F.buchung.anderer, schichtAnderer: F.schicht.anderer, token: F.bericht.bs1Token,
    jpeg: testJpeg().toString('base64'), pdf: H.kleinesPdf('Probe').toString('base64'),
    ...ueber
  };
}
function brauchtVarianten(eintrag) {
  const s = JSON.stringify([eintrag.pfad || '', eintrag.query || '', eintrag.body || null]);
  return [...s.matchAll(/\{([a-zA-Z]+)\}/g)].some((m) => BEREICHS_PLATZHALTER.has(m[1]));
}
function ersetze(wert, P) {
  if (typeof wert === 'string') {
    const ganz = /^\{([a-zA-Z]+)\}$/.exec(wert);
    if (ganz) { if (!(ganz[1] in P)) throw new Error(`Platzhalter {${ganz[1]}} unbekannt`); return P[ganz[1]]; }
    return wert.replace(/\{([a-zA-Z]+)\}/g, (_, k) => { if (!(k in P)) throw new Error(`Platzhalter {${k}} unbekannt`); return String(P[k]); });
  }
  if (Array.isArray(wert)) return wert.map((x) => ersetze(x, P));
  if (wert && typeof wert === 'object') return Object.fromEntries(Object.entries(wert).map(([k, x]) => [k, ersetze(x, P)]));
  return wert;
}
/** Konkrete Anfrage (Pfad ohne /api, Body) für Route × Rolle × Variante */
function anfrage(schluessel, eintrag, F, rolle, variante, ueber) {
  const [methode, routePfad] = schluessel.split(' ');
  const P = platzhalter(F, rolle, variante, typeof ueber === 'function' ? ueber(variante) : ueber);
  let pfad = eintrag.pfad || routePfad;
  if (/:[a-zA-Z]|\*/.test(pfad)) throw new Error(`${schluessel}: Pfad mit Parametern braucht "pfad" in der Matrix`);
  pfad = ersetze(pfad, P) + (eintrag.query ? ersetze(eintrag.query, P) : '');
  const body = eintrag.body === undefined ? undefined : ersetze(eintrag.body, P);
  return { methode, pfad: pfad.replace(/^\/api/, ''), body };
}
module.exports = { erwartung, platzhalter, brauchtVarianten, ersetze, anfrage, BEREICHS_PLATZHALTER };
