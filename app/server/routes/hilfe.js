'use strict';
/** Kleine Helfer für die Routen */
const { keinZugriff, nichtGefunden } = require('../fehler');
const { baustelleImBereich } = require('../rechte');
const { ladeBaustelle } = require('../daten');
const { pfadId } = require('../validierung');

/** Middleware: verlangt ein Recht */
function brauche(...rechte) {
  return (req, res, next) => {
    if (!rechte.some((r) => req.ctx.hat(r))) return next(keinZugriff());
    next();
  };
}

/** Baustelle aus URL-Parameter laden (404) */
function baustelleAusPfad(db, wert) {
  const bs = ladeBaustelle(db, pfadId(wert, 'Baustellen-ID'));
  if (!bs) throw nichtGefunden('Baustelle nicht gefunden.');
  return bs;
}

/** Bereichsprüfung „eigene Baustellen“ (403) */
function pruefeBereich(ctx, bs, text = 'Diese Baustelle gehört nicht zu Ihrem Bereich.') {
  if (!baustelleImBereich(ctx.benutzer, bs)) throw keinZugriff(text);
}

module.exports = { brauche, baustelleAusPfad, pruefeBereich };
