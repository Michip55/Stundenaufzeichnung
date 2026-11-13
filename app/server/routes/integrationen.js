'use strict';
/** Integrationen ehrlich als „nicht angebunden“ – keine vorgetäuschten Ergebnisse. */
const { nichtAngebunden, nichtGefunden } = require('../fehler');

const INTEGRATIONEN = [
  { schluessel: 'diktat', name: 'Bericht per Sprache diktieren', hinweis: 'Spracherkennung (Anbieter/Vertrag fehlt) – noch nicht angebunden.' },
  { schluessel: 'scan_lieferschein', name: 'Lieferschein fotografieren und auslesen', hinweis: 'Texterkennung (Anbieter/Vertrag fehlt) – noch nicht angebunden.' },
  { schluessel: 'scan_papier', name: 'Papier-Bautagesbericht einscannen', hinweis: 'Formularerkennung (Anbieter/Vertrag fehlt) – noch nicht angebunden.' },
  { schluessel: 'sms', name: 'Fernunterschrift per SMS-Link', hinweis: 'SMS-Anbieter fehlt – noch nicht angebunden.' },
  { schluessel: 'push', name: 'Push-Benachrichtigungen', hinweis: 'Web-Push (Schlüssel/Dienst) noch nicht eingerichtet – Benachrichtigungen nur in der App.' },
  { schluessel: 'email', name: 'E-Mail-Versand', hinweis: 'Mailserver (SMTP) noch nicht eingerichtet – kein automatischer Versand.' },
  { schluessel: 'wetter', name: 'Wetter automatisch (GeoSphere Austria)', hinweis: 'Wetterdienst noch nicht angebunden – Wetter bitte händisch eintragen.' }
];

module.exports = function integrationsRouten(api) {
  api.get('/integrationen', (req, res) => {
    res.json(INTEGRATIONEN.map((i) => ({ ...i, angebunden: false })));
  });

  const nichtDa = (req) => {
    const i = INTEGRATIONEN.find((x) => x.schluessel === req.params.schluessel);
    if (!i) throw nichtGefunden('Unbekannte Integration.');
    throw nichtAngebunden(`${i.name} ist noch nicht angebunden (Anbieter/Vertrag fehlt).`);
  };
  api.post('/integrationen/:schluessel', nichtDa);
  api.post('/integrationen/:schluessel/*rest', nichtDa);
};

module.exports.INTEGRATIONEN = INTEGRATIONEN;
