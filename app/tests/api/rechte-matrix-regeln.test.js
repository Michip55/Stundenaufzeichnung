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
  // neue Routen seit e6e3de3: Mitarbeiter nie erlaubt, Polier höchstens eigene Daten – außer ausdrücklich beschlossenen Routen
  // OHNE Daten, die nur die eigene Sitzung betreffen (FUER_ALLE; ihre Antwort prüft der Test unten)
  const neu = Object.keys(M.routen).filter((k) => !ALT.routen[k] && !FUER_ALLE[k]);
  for (const k of neu) assert.ok(['N', 'E'].includes(spalten(M.routen[k].r).mitarbeiter), `${k}: Mitarbeiter ${M.routen[k].r}`);
  for (const [k, grund] of Object.entries(FUER_ALLE)) assert.ok(M.routen[k] && M.routen[k].grund.includes(grund.split(':')[0]), `${k}: Eintrag/Begründung fehlt`);
});

/**
 * Neue Routen für alle Rollen (Inhaberentscheidung), die keine Daten liefern und nur die EIGENE Sitzung betreffen.
 * POST /api/auth/geraet (15.28): Gerätewahl „Geteiltes Gerät“ kürzt die eigene Sitzung; „eigen“ ändert nichts.
 * GET /api/auth/anmeldung (15.33): öffentlich, nur ob die Namensliste eingeschaltet ist (Antwort geprüft in anmeldung-pnr.test.js).
 */
const FUER_ALLE = {
  'POST /api/auth/geraet': '15.28: Inhaber 19.11.2026 – PIN einmal pro Woche für alle Rollen; Antwort nur {sitzungArt, sitzungBis}',
  // 15.33: öffentlich wie die Anmeldung selbst – Antwort nur {namensliste} (ob die Namensliste eingeschaltet ist), keine Daten
  'GET /api/auth/anmeldung': '15.33: Inhaber 19.11.2026 – Anmeldung mit eigenem Namen am eigenen Handy; Antwort nur {namensliste}'
};
test('15.28: Routen für alle Rollen ohne Daten – Antwort nur die Lebensdauer der eigenen Sitzung', async () => {
  const { starte, U } = require('./hilfe');
  const s = await starte();
  try {
    for (const id of Object.values(U)) {
      const c = await s.login(id);
      for (const art of ['eigen', 'geteilt']) {
        const r = await c.post('/auth/geraet', { art });
        assert.equal(r.status, 200, `${id}/${art}`);
        assert.deepEqual(Object.keys(r.daten).sort(), ['sitzungArt', 'sitzungBis'], `${id}/${art}: ${JSON.stringify(r.daten)}`);
      }
    }
  } finally { await s.stop(); }
});

/**
 * 15.17 (H-T7): Begründungen der Abwesenheits- und Urlaubsrouten, die Polier oder Mitarbeiter erreichen (J/E), stützen
 * sich auf die verbindliche Regel 13.2 (nur eigene Einträge, keine Platzhalter, keine Zählungen; SW-Meldung des Poliers
 * immer angenommen) – keine veralteten Begründungen („Bereich“, „Sichtbarkeit wie …“), die eine lockerere Regel nahelegen.
 * Die Erwartungen selbst prüft der Test oben (nichts gelockert).
 */
test('15.17: Abwesenheits-/Urlaubsrouten mit Polier-/Mitarbeiter-Zugriff begründen mit 13.2', () => {
  const OHNE_PERSONENDATEN = new Set(['GET /api/urlaub/feiertage']); // gesetzliche Feiertage, keine Abwesenheit einer Person
  const v = [];
  for (const [k, e] of Object.entries(M.routen)) {
    if (!/^\w+ \/api\/(abwesenheiten|urlaub)\b/.test(k) || OHNE_PERSONENDATEN.has(k)) continue;
    const s = spalten(e.r);
    if (!['J', 'E'].includes(s.mitarbeiter) && !['J', 'E'].includes(s.polier)) continue;
    if (!/\b13\.2\b/.test(e.grund || '')) v.push(`${k} (${e.r}): Begründung ohne 13.2 – „${e.grund}“`);
    if (/Bereich|Sichtbarkeit wie/.test(e.grund || '')) v.push(`${k}: veraltete Begründung „${e.grund}“`);
  }
  assert.deepEqual(v, []);
});
