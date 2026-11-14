'use strict';
/**
 * Rechte-Matrix – schreibende Routen (aufgeteilt auf rechte-matrix-schreiben-<n>.test.js, damit `npm test` die Teile
 * parallel ausführt). Je Route × Rolle × Variante:
 *  - verweigert: 401/403/404 (bzw. 400 bei nein400) UND nichts verändert – alle Tabellen (auch sitzung, push_abo,
 *    login_*), Upload-Dateien und Test-Ausgang (Push/Mail/KI); ausgenommen nur die Spalten in H.DB_FLUECHTIG (F-041).
 *  - erlaubt: frische DB-Kopie je Probe. Polier/Mitarbeiter: die Probe muss GELINGEN (2xx), damit die Erfolgsantwort
 *    gescannt wird – mit gültigem Body aus `erfolg` (Platzhalter {version} = aktuelle Version, `vorher` = nötige
 *    Vorbereitung). Andere Status nur mit `erfolg.ok` und Begründung `erfolg.okGrund` (F-025).
 *  - Antwort (Inhalt UND Kopfzeilen) ohne verbotene Schlüssel, Beträge, Kanarien (H.scanne).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./rechte-matrix-hilfe');
const { erwartung, brauchtVarianten, anfrage, ersetze, platzhalter } = require('./rechte-matrix-proben');

const MATRIX_ALLE = JSON.parse(fs.readFileSync(path.join(__dirname, 'rechte-matrix.json'), 'utf8')).routen;
const NUR = process.env.BAUTAG_RECHTE_NUR ? new RegExp(process.env.BAUTAG_RECHTE_NUR) : null;
const VERWEIGERT = [401, 403, 404];
const { ROLLEN } = H;
const FELD = ['mitarbeiter', 'polier'];

/** Schreibende Routen dieses Teils (Index modulo Anzahl) */
function schreibRouten(teil, teile) {
  return Object.entries(MATRIX_ALLE).filter(([k, e]) => k.split(' ')[0] !== 'GET' && !e.spezial).filter((_, i) => i % teile === teil - 1).filter(([k]) => !NUR || NUR.test(k));
}

/**
 * Konkrete Erfolgs-Probe für Polier/Mitarbeiter (F-025): `erfolg` ersetzt pfad/body; {version} = aktuelle Version der
 * Ressource (versionVon, sonst der Pfad selbst bzw. ohne letzten Abschnitt), gelesen als GF.
 */
async function erfolgsAnfrage(k, schluessel, e, F, rolle, variante) {
  const a = anfrage(schluessel, e, F, rolle, variante);
  const er = e.erfolg;
  if (!er) return a;
  const P = { ...platzhalter(F, rolle, variante), version: '{version}' }; // {version} erst unmittelbar vor der Anfrage
  const gf = k.als('gf');
  const mitVersion = async (body, quelle) => {
    if (!JSON.stringify(body || {}).includes('{version}')) return body;
    const q = ersetze(quelle, P).replace(/^\/api/, '');
    const g = await gf.get(q);
    const ver = g.daten && g.daten.version !== undefined ? g.daten.version : (await gf.get(q.replace(/\/[^/]+$/, ''))).daten.version;
    return JSON.parse(JSON.stringify(body).split('"{version}"').join(String(ver)));
  };
  // Vorbereitung (als dieselbe Rolle); die ID der ersten Antwort steht danach als {vorherId} zur Verfügung
  for (const [i, [m, p, b]] of (er.vorher || []).entries()) {
    const pf = ersetze(p, P).replace(/^\/api/, '');
    const body = b === undefined ? undefined : await mitVersion(ersetze(b, P), er.versionVon || p);
    const r = await k.als(rolle).anfrage(m, pf, body);
    if (r.status >= 300) throw new Error(`${schluessel}: Vorbereitung ${m} ${pf} → ${r.status} ${JSON.stringify(r.daten).slice(0, 200)}`);
    if (i === 0) P.vorherId = r.daten && (r.daten.id !== undefined ? r.daten.id : r.daten.antragId);
  }
  const pfad = er.pfad ? ersetze(er.pfad, P).replace(/^\/api/, '') : a.pfad;
  let body = er.body === undefined ? a.body : ersetze(er.body, P);
  body = await mitVersion(body, er.versionVon || `/api${pfad}`);
  return { ...a, pfad, body };
}

/** Feld-Probe ok? 2xx, sonst nur begründete Ausnahmen */
function feldOk(e, status) {
  if (e.erfolg && e.erfolg.ok) return e.erfolg.ok.includes(status);
  return status >= 200 && status < 300;
}

async function pruefeSchreiben(basis, teil, teile) {
  const F = basis.F;
  const v = [];
  let gelungen = 0;
  for (const [schluessel, e] of schreibRouten(teil, teile)) {
    const varianten = brauchtVarianten(e) ? ['eigen', 'fremd'] : ['ohne'];
    const proben = [];
    for (const rolle of ROLLEN) for (const variante of varianten) {
      const erw = erwartung(e, rolle);
      proben.push({ rolle, variante, erw, erlaubt: erw === 'J' || erw === 'O' || (erw === 'E' && variante !== 'fremd') });
    }
    // 1) verweigerte Proben auf einer Kopie, vollständiger Zustand vor/nach jeder Probe
    let k = await H.starteKopie(basis);
    for (const p of proben.filter((x) => !x.erlaubt)) {
      const a = anfrage(schluessel, e, F, p.rolle, p.variante);
      await k.ruhe();
      const vorher = H.dbHash(k);
      const r = await k.als(p.rolle).anfrage(a.methode, a.pfad, a.body === undefined ? {} : a.body, p.erw === 'T' ? { 'x-bautag-test-token': '' } : undefined);
      await k.ruhe();
      const nachher = H.dbHash(k);
      const wo = `${p.rolle} ${a.methode} ${a.pfad} [${p.variante}]`;
      const ok = p.erw === 'T' ? [403] : e.nein400 ? [...VERWEIGERT, 400] : VERWEIGERT;
      if (!ok.includes(r.status)) v.push(`${wo}: LECK – verweigert laut Matrix (${e.grund}), aber ${r.status} ${JSON.stringify(r.daten).slice(0, 200)}`);
      const diff = H.dbUnterschied(vorher, nachher);
      if (diff.length) v.push(`${wo}: Zustand geändert trotz Ablehnung (${r.status}): ${diff.join(', ')}`);
      v.push(...await H.scanne(p.rolle, r, { route: schluessel, variante: p.variante, url: a.pfad }));
    }
    // 2) erlaubte Proben: je Probe eine frische Kopie (die erste nutzt die unveränderte Kopie von oben)
    let erste = true;
    for (const p of proben.filter((x) => x.erlaubt)) {
      if (!erste) { await k.stop(); k = await H.starteKopie(basis); }
      erste = false;
      const feld = FELD.includes(p.rolle);
      let a;
      try { a = feld ? await erfolgsAnfrage(k, schluessel, e, F, p.rolle, p.variante) : anfrage(schluessel, e, F, p.rolle, p.variante); } catch (x) { v.push(`${p.rolle} ${schluessel} [${p.variante}]: ${x.message}`); continue; }
      const r = await k.als(p.rolle).anfrage(a.methode, a.pfad, a.body === undefined ? {} : a.body);
      const wo = `${p.rolle} ${a.methode} ${a.pfad} [${p.variante}]`;
      const ok = feld ? feldOk(e, r.status) : e.ok ? e.ok.includes(r.status) : !VERWEIGERT.includes(r.status) && r.status < 500;
      if (!ok) v.push(`${wo}: erlaubt laut Matrix, aber ${r.status}${feld ? ' (Polier/Mitarbeiter: Erfolg 2xx verlangt, F-025)' : ''} ${JSON.stringify(r.daten).slice(0, 200)}`);
      if (feld && r.status >= 200 && r.status < 300) gelungen++;
      v.push(...await H.scanne(p.rolle, r, { route: schluessel, variante: p.variante, url: a.pfad }));
      // Folgen der Schreibprobe (Benachrichtigungen, Push, Mails) für Polier/Mitarbeiter ebenso prüfen
      await k.ruhe();
      v.push(...await H.pruefeAusgaenge(k, `nach ${wo}`));
    }
    await k.stop();
  }
  return { v, gelungen };
}

/** node:test-Rahmen für einen Teil */
function teilTest(teil, teile) {
  const test = require('node:test');
  test(`Rechte-Matrix Schreiben (Teil ${teil}/${teile}): verweigert = abgewiesen und nichts verändert; erlaubt für Polier/Mitarbeiter = Erfolg, Antwort ohne Leck`, { timeout: 30 * 60 * 1000 }, async (t) => {
    const basis = await H.erstelleBasis();
    t.after(() => fs.rmSync(basis.ordner, { recursive: true, force: true }));
    const { v, gelungen } = await pruefeSchreiben(basis, teil, teile);
    if (!NUR) assert.ok(gelungen >= 5, `nur ${gelungen} erfolgreiche Schreibproben von Polier/Mitarbeiter in Teil ${teil} – Prüfung wirkungslos?`);
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });
}

module.exports = { teilTest, pruefeSchreiben, erfolgsAnfrage, feldOk, schreibRouten };
