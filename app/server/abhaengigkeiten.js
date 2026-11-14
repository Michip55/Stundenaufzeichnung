'use strict';
/**
 * N-046: Sind alle Programmteile (npm-Pakete aus package.json) installiert und passen sie zum Lockfile?
 * Nur eingebaute Module – läuft auch, wenn node_modules fehlt oder veraltet ist.
 *
 *   node server/abhaengigkeiten.js        Exit 0 = alles da und aktuell, 1 = „npm install“ nötig (Startskripte)
 *
 * Der Server (server/index.js) prüft das beim Start **vor** dem Öffnen der Datenbank: fehlt ein Paket, startet er
 * nicht und verändert die Datenbank nicht (keine Migration mit einem Programm, das danach abbricht).
 */
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..');

function liesJson(datei) {
  try { return JSON.parse(fs.readFileSync(datei, 'utf8')); } catch (_) { return null; }
}

/** package.json eines installierten Pakets suchen (wie Node: node_modules von appDir aufwärts) */
function installiert(appDir, name) {
  let dir = path.resolve(appDir);
  for (;;) {
    const p = path.join(dir, 'node_modules', ...name.split('/'), 'package.json');
    if (fs.existsSync(p)) return liesJson(p) || {};
    const oben = path.dirname(dir);
    if (oben === dir) return null;
    dir = oben;
  }
}

/**
 * @param {string} [appDir]  Ordner mit package.json (Standard: app/)
 * @returns {{ok:boolean, fehlen:string[], veraltet:Array<{name:string, ist:string, soll:string}>}}
 */
function pruefeAbhaengigkeiten(appDir = APP) {
  const pkg = liesJson(path.join(appDir, 'package.json')) || {};
  const lock = liesJson(path.join(appDir, 'package-lock.json'));
  const fehlen = [];
  const veraltet = [];
  for (const name of Object.keys(pkg.dependencies || {}).sort()) {
    const ist = installiert(appDir, name);
    if (!ist) { fehlen.push(name); continue; }
    const soll = lock && lock.packages && lock.packages[`node_modules/${name}`] && lock.packages[`node_modules/${name}`].version;
    if (soll && ist.version !== soll) veraltet.push({ name, ist: String(ist.version || '?'), soll });
  }
  return { ok: !fehlen.length && !veraltet.length, fehlen, veraltet };
}

/** Meldung für Menschen (deutsch) */
function meldung(r) {
  const teile = [];
  if (r.fehlen.length) teile.push(`es fehlen: ${r.fehlen.join(', ')}`);
  if (r.veraltet.length) teile.push(`veraltet: ${r.veraltet.map((v) => `${v.name} ${v.ist} statt ${v.soll}`).join(', ')}`);
  return `Programmteile sind nicht vollständig installiert (${teile.join('; ')}). Bitte im Ordner „app“ „npm install“ ausführen (Testversion: das Startskript erneut doppelklicken).`;
}

module.exports = { pruefeAbhaengigkeiten, meldung };

if (require.main === module) {
  const r = pruefeAbhaengigkeiten(process.argv[2] || APP);
  if (!r.ok) process.stdout.write(`${meldung(r)}\n`);
  process.exitCode = r.ok ? 0 : 1;
}
