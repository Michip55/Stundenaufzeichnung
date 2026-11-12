'use strict';
/** Eingabeprüfung: wirft bei Fehlern ApiFehler 400 mit deutschem Text. */
const { ungueltig } = require('./fehler');
const { istDatum, istZeit, istMonat } = require('./datum');

function objekt(body, name = 'Anfrage') {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw ungueltig(`${name}: JSON-Objekt erwartet.`);
  return body;
}

function zahl(wert, feld, { min = -Infinity, max = Infinity, pflicht = true, ganz = false } = {}) {
  if (wert === undefined || wert === null || wert === '') {
    if (pflicht) throw ungueltig(`${feld} fehlt.`);
    return null;
  }
  if (typeof wert !== 'number' || !Number.isFinite(wert)) throw ungueltig(`${feld} muss eine Zahl sein.`);
  if (ganz && !Number.isInteger(wert)) throw ungueltig(`${feld} muss eine ganze Zahl sein.`);
  if (wert < min || wert > max) throw ungueltig(`${feld} muss zwischen ${min} und ${max} liegen.`);
  return wert;
}

function id(wert, feld) {
  return zahl(wert, feld, { min: 1, max: 1e12, ganz: true });
}

/** ID aus URL-Parameter */
function pfadId(wert, feld = 'ID') {
  if (typeof wert !== 'string' || !/^\d{1,12}$/.test(wert)) throw ungueltig(`${feld} ist ungültig.`);
  return Number(wert);
}

function text(wert, feld, { max = 500, pflicht = true, min = 1 } = {}) {
  if (wert === undefined || wert === null) {
    if (pflicht) throw ungueltig(`${feld} fehlt.`);
    return null;
  }
  if (typeof wert !== 'string') throw ungueltig(`${feld} muss ein Text sein.`);
  const t = wert.trim();
  if (pflicht && t.length < min) throw ungueltig(`${feld} darf nicht leer sein.`);
  if (t.length > max) throw ungueltig(`${feld} ist zu lang (max. ${max} Zeichen).`);
  // Steuerzeichen außer Zeilenumbruch/Tab entfernen
  return t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function bool(wert, feld, { pflicht = true } = {}) {
  if (wert === undefined || wert === null) {
    if (pflicht) throw ungueltig(`${feld} fehlt.`);
    return null;
  }
  if (typeof wert !== 'boolean') throw ungueltig(`${feld} muss true oder false sein.`);
  return wert;
}

function datum(wert, feld = 'Datum', { pflicht = true } = {}) {
  if (wert === undefined || wert === null || wert === '') {
    if (pflicht) throw ungueltig(`${feld} fehlt.`);
    return null;
  }
  if (!istDatum(wert)) throw ungueltig(`${feld} muss ein gültiges Datum im Format JJJJ-MM-TT sein.`);
  return wert;
}

function uhrzeit(wert, feld) {
  if (wert === undefined || wert === null || wert === '') return null;
  if (!istZeit(wert)) throw ungueltig(`${feld} muss eine Uhrzeit im Format HH:MM sein.`);
  return wert;
}

function monat(wert, feld = 'Monat') {
  if (!istMonat(wert)) throw ungueltig(`${feld} muss im Format JJJJ-MM angegeben werden.`);
  return wert;
}

function auswahl(wert, feld, erlaubt, { pflicht = true } = {}) {
  if (wert === undefined || wert === null) {
    if (pflicht) throw ungueltig(`${feld} fehlt.`);
    return null;
  }
  if (!erlaubt.includes(wert)) throw ungueltig(`${feld} ist ungültig (erlaubt: ${erlaubt.join(', ')}).`);
  return wert;
}

function liste(wert, feld, { max = 200 } = {}) {
  if (!Array.isArray(wert)) throw ungueltig(`${feld} muss eine Liste sein.`);
  if (wert.length > max) throw ungueltig(`${feld}: höchstens ${max} Einträge.`);
  return wert;
}

/** Geldbetrag auf 2 Nachkommastellen */
function betrag(wert, feld, { min = 0, max = 1e9, pflicht = true } = {}) {
  const z = zahl(wert, feld, { min, max, pflicht });
  return z === null ? null : Math.round(z * 100) / 100;
}

module.exports = { objekt, zahl, id, pfadId, text, bool, datum, uhrzeit, monat, auswahl, liste, betrag };
