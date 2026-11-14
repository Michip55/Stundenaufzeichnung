'use strict';
/** Eingabeprüfung: wirft bei Fehlern ApiFehler 400 mit deutschem Text. */
const { ungueltig } = require('./fehler');
const { istDatum, istZeit, istMonat } = require('./datum');

/**
 * N-096: Fehlermeldungen nennen das Feld deutsch (statt des technischen JSON-Namens) und Zahlen im deutschen Format.
 * Nur bekannte technische Namen werden übersetzt; bereits deutsche Bezeichnungen (z. B. „Datum“) bleiben unverändert.
 */
const FELDNAMEN = {
  von: 'Von', bis: 'Bis', datum: 'Datum', notiz: 'Notiz', status: 'Status', version: 'Version', art: 'Art', name: 'Name', titel: 'Titel', typ: 'Typ', text: 'Text',
  baustelleId: 'Baustelle', baustelleIds: 'Baustellen', benutzerId: 'Mitarbeiter', benutzerIds: 'Mitarbeiter', aktiv: 'Aktiv', rolle: 'Rolle', grund: 'Grund', jahr: 'Jahr', monat: 'Monat',
  einheit: 'Einheit', menge: 'Menge', wert: 'Wert', sortierung: 'Sortierung', reihenfolge: 'Reihenfolge', klasse: 'Klasse', code: 'Code', gruppe: 'Gruppe',
  bezeichnung: 'Bezeichnung', beschreibung: 'Beschreibung', bemerkung: 'Bemerkung', kommentar: 'Kommentar', antwort: 'Antwort', tags: 'Schlagworte',
  dichte: 'Dichte', naturmaterial: 'Naturmaterial', material: 'Material', materialId: 'Material', materialText: 'Material (Freitext)',
  anlageId: 'Fahrzeug/Gerät', geraetId: 'Gerät', fahrerId: 'Fahrer', anzahlFuhren: 'Anzahl Fuhren', beginn: 'Beginn', ende: 'Ende', pauseMin: 'Pause (Minuten)',
  kennzeichen: 'Kennzeichen', baujahr: 'Baujahr', hersteller: 'Hersteller', zaehler: 'Zählerstand', kst: 'Kostenstelle', email: 'E-Mail', agEmail: 'E-Mail des Auftraggebers',
  nummer: 'Nummer', nr: 'Nummer', anspruch: 'Urlaubsanspruch', uebertrag: 'Übertrag', kv: 'Kollektivvertrag',
  ep: 'Einheitspreis', vk: 'Verkaufspreis', ek: 'Einkaufspreis', betrag: 'Betrag', netto: 'Nettobetrag', auftragssumme: 'Auftragssumme', ustSatz: 'USt-Satz',
  skontoProzent: 'Skonto (%)', skontoTage: 'Skontofrist (Tage)', zahlungszielTage: 'Zahlungsziel (Tage)',
};
const feldname = (feld) => (Object.prototype.hasOwnProperty.call(FELDNAMEN, feld) ? FELDNAMEN[feld] : feld);
/** Zahl im deutschen Format (0,1; 1.000.000) */
const zahlText = (n) => Number(n).toLocaleString('de-DE', { maximumFractionDigits: 6, useGrouping: true });

function objekt(body, name = 'Anfrage') {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw ungueltig(`${name}: JSON-Objekt erwartet.`);
  return body;
}

function zahl(wert, feld, { min = -Infinity, max = Infinity, pflicht = true, ganz = false } = {}) {
  if (wert === undefined || wert === null || wert === '') {
    if (pflicht) throw ungueltig(`${feldname(feld)} fehlt.`);
    return null;
  }
  if (typeof wert !== 'number' || !Number.isFinite(wert)) throw ungueltig(`${feldname(feld)} muss eine Zahl sein.`);
  if (ganz && !Number.isInteger(wert)) throw ungueltig(`${feldname(feld)} muss eine ganze Zahl sein.`);
  if (wert < min || wert > max) throw ungueltig(Number.isFinite(min) && Number.isFinite(max) ? `${feldname(feld)} muss zwischen ${zahlText(min)} und ${zahlText(max)} liegen.`
    : Number.isFinite(min) ? `${feldname(feld)} muss mindestens ${zahlText(min)} sein.` : `${feldname(feld)} darf höchstens ${zahlText(max)} sein.`);
  return wert;
}

function id(wert, feld) {
  if (typeof wert === 'number' && Number.isFinite(wert) && !(Number.isInteger(wert) && wert >= 1 && wert <= 1e12)) throw ungueltig(`${feldname(feld)} ist ungültig.`);
  return zahl(wert, feld, { min: 1, max: 1e12, ganz: true });
}

/** ID aus URL-Parameter */
function pfadId(wert, feld = 'ID') {
  if (typeof wert !== 'string' || !/^\d{1,12}$/.test(wert)) throw ungueltig(`${feldname(feld)} ist ungültig.`);
  return Number(wert);
}

function text(wert, feld, { max = 500, pflicht = true, min = 1 } = {}) {
  if (wert === undefined || wert === null) {
    if (pflicht) throw ungueltig(`${feldname(feld)} fehlt.`);
    return null;
  }
  if (typeof wert !== 'string') throw ungueltig(`${feldname(feld)} muss ein Text sein.`);
  const t = wert.trim();
  if (pflicht && t.length < min) throw ungueltig(`${feldname(feld)} darf nicht leer sein.`);
  if (t.length > max) throw ungueltig(`${feldname(feld)} ist zu lang (max. ${zahlText(max)} Zeichen).`);
  // Steuerzeichen außer Zeilenumbruch/Tab entfernen
  return t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function bool(wert, feld, { pflicht = true } = {}) {
  if (wert === undefined || wert === null) {
    if (pflicht) throw ungueltig(`${feldname(feld)} fehlt.`);
    return null;
  }
  if (typeof wert !== 'boolean') throw ungueltig(`${feldname(feld)} muss true oder false sein.`);
  return wert;
}

function datum(wert, feld = 'Datum', { pflicht = true } = {}) {
  if (wert === undefined || wert === null || wert === '') {
    if (pflicht) throw ungueltig(`${feldname(feld)} fehlt.`);
    return null;
  }
  if (!istDatum(wert)) throw ungueltig(`${feldname(feld)} muss ein gültiges Datum im Format JJJJ-MM-TT sein.`);
  return wert;
}

function uhrzeit(wert, feld) {
  if (wert === undefined || wert === null || wert === '') return null;
  if (!istZeit(wert)) throw ungueltig(`${feldname(feld)} muss eine Uhrzeit im Format HH:MM sein.`);
  return wert;
}

function monat(wert, feld = 'Monat') {
  if (!istMonat(wert)) throw ungueltig(`${feldname(feld)} muss im Format JJJJ-MM angegeben werden.`);
  return wert;
}

function auswahl(wert, feld, erlaubt, { pflicht = true } = {}) {
  if (wert === undefined || wert === null) {
    if (pflicht) throw ungueltig(`${feldname(feld)} fehlt.`);
    return null;
  }
  if (!erlaubt.includes(wert)) throw ungueltig(`${feldname(feld)} ist ungültig (erlaubt: ${erlaubt.join(', ')}).`);
  return wert;
}

function liste(wert, feld, { max = 200 } = {}) {
  if (!Array.isArray(wert)) throw ungueltig(`${feldname(feld)} muss eine Liste sein.`);
  if (wert.length > max) throw ungueltig(`${feldname(feld)}: höchstens ${max} Einträge.`);
  return wert;
}

/** Geldbetrag auf 2 Nachkommastellen */
function betrag(wert, feld, { min = 0, max = 1e9, pflicht = true } = {}) {
  const z = zahl(wert, feld, { min, max, pflicht });
  return z === null ? null : Math.round((z + Math.sign(z) * Number.EPSILON * Math.max(1, Math.abs(z))) * 100) / 100;
}

module.exports = { feldname, zahlText, objekt, zahl, id, pfadId, text, bool, datum, uhrzeit, monat, auswahl, liste, betrag };
