'use strict';
/** Einheitliches Fehlerformat: { fehler, code } */

class ApiFehler extends Error {
  constructor(status, code, text, extra) {
    super(text);
    this.status = status;
    this.code = code;
    this.extra = extra || null;
  }
}

const ungueltig = (text, extra) => new ApiFehler(400, 'UNGUELTIG', text, extra);
const nichtAngemeldet = (text = 'Bitte anmelden.') => new ApiFehler(401, 'NICHT_ANGEMELDET', text);
const keinZugriff = (text = 'Dafür fehlt die Berechtigung.') => new ApiFehler(403, 'KEIN_ZUGRIFF', text);
const nichtGefunden = (text = 'Nicht gefunden.') => new ApiFehler(404, 'NICHT_GEFUNDEN', text);
const konflikt = (text, extra) => new ApiFehler(409, 'KONFLIKT', text, extra);
const nichtAngebunden = (text) => new ApiFehler(501, 'NICHT_ANGEBUNDEN', text);

/*
 * 15.11 (G2-015, Inhaberregel 2 „auch Fehlertexte“): Wer weder preise_sehen noch kalk_sehen hat (Polier, Mitarbeiter – auch mit
 * Ausnahmen), bekommt keinen Fehlertext mit Geldwörtern oder Währungszeichen. Sicherheitsnetz in der Fehlerbehandlung
 * (server/index.js) zusätzlich zu geldfreien Texten an der Quelle; Zusatzfelder fallen dann bis auf `version` weg.
 */
const GELD_WORTE = /€|\bEUR\b|\bEuro|Preis|preise_|Rechnung|Zahlung|bezahlt|\bKosten\b|Kostensatz|Lohnkosten|Betrag|Beträge|Rücklass|Ruecklass|Skonto|Auftragssumme|Nachtr[aä]g|Gutschrift|\bbrutto\b|\bnetto\b|\bUSt\b|Umsatzsteuer|Verrechnungssatz|Regiesatz/i;
const GELDFREI_403 = 'Diese Funktion ist für Ihr Konto nicht freigegeben.';
const GELDFREI_SONST = 'Die Anfrage lässt sich so nicht ausführen – bitte im Büro klären.';
const enthaeltGeld = (text) => GELD_WORTE.test(String(text || ''));
/** Fehlertext für ctx: ohne Preis-/Kalkulationsrecht nie mit Geldwörtern → {text, extra} */
function geldfreierFehler(ctx, status, text, extra) {
  const ohneGeld = ctx && typeof ctx.hat === 'function' && !ctx.hat('preise_sehen') && !ctx.hat('kalk_sehen');
  if (!ohneGeld) return { text, extra };
  const extraText = extra ? JSON.stringify(extra) : '';
  if (!enthaeltGeld(text) && !enthaeltGeld(extraText)) return { text, extra };
  return { text: status === 403 ? GELDFREI_403 : GELDFREI_SONST, extra: extra && extra.version != null ? { version: extra.version } : null };
}

module.exports = { GELD_WORTE, enthaeltGeld, geldfreierFehler, ApiFehler, ungueltig, nichtAngemeldet, keinZugriff, nichtGefunden, konflikt, nichtAngebunden };
