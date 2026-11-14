'use strict';
/**
 * Regeln über der Rechte-Matrix (Inhaber 13.11.2026):
 *  1. Bauleiter „in allem wie Büro“ – jede Bauleiter-Erwartung ist gleich der Büro-Erwartung (können nie auseinanderlaufen).
 *  2. Polier und Mitarbeiter: keine Erwartung gegenüber Commit e6e3de3 (Prüfbericht 7) gelockert – Spalten unverändert.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./rechte-matrix.json');
const ALT = require('./rechte-matrix-pm-e6e3de3.json');
const R = require('../../server/rechte');

const spalten = (r) => { const t = r.split(' '); return { mitarbeiter: t[0], polier: t[1], bauleiter: t[2], buero: t[3], gf: t[4] }; };

test('Bauleiter = Büro: jede Route hat für Bauleiter dieselbe Erwartung wie für das Büro', () => {
  const abweichend = Object.entries(M.routen).filter(([, e]) => spalten(e.r).bauleiter !== spalten(e.r).buero).map(([k, e]) => `${k}: ${e.r}`);
  assert.deepEqual(abweichend, []);
  // und im Server: gleiche Standardrechte und gleiche Sperren
  assert.deepEqual(R.STANDARD_MATRIX.bauleiter, R.STANDARD_MATRIX.buero);
  assert.deepEqual(R.GESPERRT.bauleiter, R.GESPERRT.buero);
  assert.equal(R.bereich({ rolle: 'bauleiter', id: 1 }), 'alle');
});

/**
 * Ausdrücklich beschlossene VERSCHÄRFUNGEN gegenüber e6e3de3 (nur strenger: J → E → N), je mit Fundstelle.
 * Jede andere Änderung der Spalten bleibt ein Fehler.
 */
const VERSCHAERFT = {
  'GET /api/plan/fuhren/:id/foto/:fid': { polier: 'N', grund: 'API.md 15.7, Inhaberentscheidung N-112: Liefer-/Wiegescheine nur für den Hochladenden' }
};
const STRENGE = { J: 0, O: 0, E: 1, N: 2 };

test('Polier/Mitarbeiter: Erwartungen gegenüber e6e3de3 unverändert (nichts gelockert)', () => {
  const v = [];
  for (const [k, alt] of Object.entries(ALT.routen)) {
    const neu = M.routen[k];
    if (!neu) { v.push(`${k}: Route fehlt in der Matrix`); continue; }
    const s = spalten(neu.r);
    const verschaerft = (rolle) => VERSCHAERFT[k] && VERSCHAERFT[k][rolle] === s[rolle] && STRENGE[s[rolle]] > STRENGE[alt[rolle]];
    if (s.mitarbeiter !== alt.mitarbeiter && !verschaerft('mitarbeiter')) v.push(`${k}: mitarbeiter ${alt.mitarbeiter} → ${s.mitarbeiter}`);
    if (s.polier !== alt.polier && !verschaerft('polier')) v.push(`${k}: polier ${alt.polier} → ${s.polier}`);
    // auch die Probe selbst (Pfad/Query/Body) ist unverändert, damit die Spalten dasselbe prüfen
    const probe = (x) => JSON.stringify({ pfad: x.pfad, query: x.query, body: x.body });
    if (probe(neu) !== probe(alt.eintrag)) v.push(`${k}: Probe geändert`);
  }
  assert.deepEqual(v, []);
  // neue Routen seit e6e3de3: Mitarbeiter nie erlaubt, Polier höchstens eigene Daten
  const neu = Object.keys(M.routen).filter((k) => !ALT.routen[k]);
  for (const k of neu) assert.ok(['N', 'E'].includes(spalten(M.routen[k].r).mitarbeiter), `${k}: Mitarbeiter ${M.routen[k].r}`);
});
