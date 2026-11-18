'use strict';
/** System: Status der Datensicherung (API.md 12.1) */
const { brauche } = require('./hilfe');
const { sicherungsStatus } = require('../sicherung-pruefung');

module.exports = function systemRouten(api, bt) {
  api.get('/system/sicherung', brauche('benutzer'), (req, res) => res.json(sicherungsStatus(bt)));
};
