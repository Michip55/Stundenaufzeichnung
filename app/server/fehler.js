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

module.exports = { ApiFehler, ungueltig, nichtAngemeldet, keinZugriff, nichtGefunden, konflikt, nichtAngebunden };
