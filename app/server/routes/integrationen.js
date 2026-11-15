'use strict';
/** Integrationen mit echtem Zustand (API.md 12.14) – keine vorgetäuschten Ergebnisse. */
const { nichtAngebunden, nichtGefunden } = require('../fehler');

const NAMEN = {
  push: 'Push-Benachrichtigungen', wetter: 'Wetter automatisch (GeoSphere Austria)', email: 'E-Mail-Versand',
  fernunterschrift: 'Fernunterschrift per Link', diktat: 'Bericht per Sprache diktieren', lieferschein: 'Lieferschein fotografieren und auslesen',
  papier: 'Papier-Bautagesbericht einscannen', ki: 'KI-Unterstützung (Anthropic Claude, optional)', sms: 'Fernunterschrift per SMS'
};

const versuch = (f, standard) => { try { return f(); } catch (_) { return standard; } };

function stand(bt) {
  const ki = versuch(() => require('../ki').aktiv(bt), false);
  const ocr = versuch(() => require('../ocr').verfuegbar(bt), false);
  const email = versuch(() => require('../mail').eingerichtet(bt), false);
  const vapid = Boolean(bt.db.einstellung('vapid', null));
  const z = (zustand, hinweis) => ({ zustand, hinweis });
  const liste = {
    push: vapid ? z('aktiv', 'Web-Push eingerichtet – in den Einstellungen je Gerät erlauben.') : z('fehlt', 'Schlüssel werden beim Start erzeugt.'),
    wetter: bt.wetterAn ? z('aktiv', 'GeoSphere Austria (ohne Schlüssel); Koordinaten je Baustelle nötig.') : z('aus', 'Abgeschaltet (BAUTAG_WETTER=0).'),
    email: email ? z('aktiv', 'SMTP eingerichtet.') : z('fehlt', 'Mailserver (SMTP) unter Einstellungen → E-Mail eintragen.'),
    fernunterschrift: z('aktiv', 'Einmal-Link (72 Std.) per WhatsApp/E-Mail teilen.'),
    diktat: ki ? z('aktiv_mit_ki', 'Mikrofon der Handy-Tastatur → Vorschlag mit KI.') : z('aktiv_ohne_ki', 'Mikrofon der Handy-Tastatur → Vorschlag nach festen Regeln.'),
    lieferschein: !ocr && !ki ? z('optional', 'Texterkennung braucht die Sprachdaten (deploy/ocr-daten.sh); Foto wird trotzdem gespeichert.') : ki ? z('aktiv_mit_ki', 'Texterkennung mit KI – das Foto wird an die KI übermittelt (ohne EXIF/GPS; Lieferscheine können Preise enthalten).') : z('aktiv_ohne_ki', 'Texterkennung auf dem Server (Deutsch).'),
    papier: !ocr && !ki ? z('optional', 'Archivfoto möglich; Erkennung braucht die Sprachdaten (deploy/ocr-daten.sh).') : ki ? z('aktiv_mit_ki', 'Archiv + Erkennung inkl. Handschrift (KI) – das Foto wird an die KI übermittelt (ohne EXIF/GPS).') : z('aktiv_ohne_ki', 'Archiv + Erkennung gedruckter Teile (Datum, KST).'),
    ki: ki ? z('aktiv', 'Anthropic Claude – nur Vorschläge. Übermittelt werden der Diktat-Text und bei Lieferschein/Papierbericht das Foto (es kann Preise enthalten).') : z('optional', 'Aus. Einschalten unter Einstellungen → KI (API-Schlüssel + Datenschutz-Bestätigung).'),
    sms: z('optional', 'Anbieter nötig – stattdessen Link per WhatsApp/E-Mail teilen.')
  };
  return Object.entries(liste).map(([schluessel, x]) => ({ schluessel, name: NAMEN[schluessel], angebunden: x.zustand.startsWith('aktiv'), zustand: x.zustand, hinweis: x.hinweis }));
}

module.exports = function integrationsRouten(api, bt) {
  api.get('/integrationen', (req, res) => res.json(stand(bt)));
  const nichtDa = (req) => {
    if (!NAMEN[req.params.schluessel]) throw nichtGefunden('Unbekannte Integration.');
    if (req.params.schluessel === 'sms') throw nichtAngebunden('Fernunterschrift per SMS ist nicht angebunden (SMS-Anbieter nötig) – bitte den Link per WhatsApp/E-Mail teilen.');
    throw nichtGefunden('Diese Funktion hat eigene Routen (API.md 12).');
  };
  api.post('/integrationen/:schluessel', nichtDa);
  api.post('/integrationen/:schluessel/*rest', nichtDa);
};

module.exports.stand = stand;
