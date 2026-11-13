'use strict';
/** Prüfbericht 6 – Betrieb: G-06 (Docker erzwingt Produktion ohne Test), G-09 (Größengrenzen), G-10 (Probe lesbar für uid 1000), G-17 (Token nicht im Log) */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const APP = path.join(__dirname, '..', '..');
const DEPLOY = path.join(APP, '..', 'deploy');
const SERVER = path.join(APP, 'server');
const lies = (f) => fs.readFileSync(path.join(DEPLOY, f), 'utf8');

test('G-06: Container läuft immer mit NODE_ENV=production und ohne BAUTAG_TEST', () => {
  const docker = lies('Dockerfile');
  assert.match(docker, /ENV NODE_ENV=production \\\n\s+BAUTAG_TEST= \\/);
  const compose = lies('docker-compose.yml');
  const app = compose.slice(compose.indexOf('  app:'), compose.indexOf('  caddy:'));
  assert.match(app, /environment:\n(\s+#.*\n)?\s+NODE_ENV: production\n\s+BAUTAG_TEST: ""\n\s+BAUTAG_TEST_TOKEN: ""/);
  assert.ok(app.indexOf('env_file') < app.indexOf('environment:'), 'environment überschreibt .env');
  assert.ok(!/^BAUTAG_TEST=1/m.test(lies('.env.beispiel')));
});

test('G-09: Caddy-Grenze liegt über der größten App-Grenze; Tabelle in ANLEITUNG.md', () => {
  const index = fs.readFileSync(path.join(SERVER, 'index.js'), 'utf8');
  const app = [...index.matchAll(/express\.json\(\{ limit: '(\d+)mb'/g)].map((m) => Number(m[1]));
  assert.ok(app.length >= 4);
  const max = Math.max(...app);
  const caddy = Number(/request_body \{\s*max_size (\d+)MB/.exec(lies('Caddyfile'))[1]);
  assert.ok(caddy >= max + 2, `Caddy ${caddy} MB vs. App ${max} MB`);
  const dok = require(path.join(SERVER, 'dokument-pruefung')).MAX_BYTES;
  assert.ok(Math.ceil((dok * 4) / 3 / 1024 / 1024) + 1 <= max, 'größtes Dokument passt als Base64 in die JSON-Grenze');
  const anl = lies('ANLEITUNG.md');
  assert.match(anl, /## Größengrenzen beim Hochladen/);
  assert.ok(anl.includes(`**${caddy} MB**`) && anl.includes(`| ${max} MB |`));
});

test('G-17: Fernunterschrift-Token werden im Caddy-Zugriffsprotokoll maskiert', () => {
  const c = lies('Caddyfile');
  const m = /request>uri regexp (\S+) (\S+)/.exec(c);
  assert.ok(m, 'Filter für request>uri');
  assert.match(c, /format filter \{\s*wrap json/);
  assert.match(c, /request>headers>Referer delete/);
  assert.match(c, /request>headers>Cookie delete/);
  const re = new RegExp(m[1]);
  const ersetze = (u) => u.replace(re, m[2]); // Go-Regexp-Ersetzung $1 entspricht hier JavaScript
  const tok = 'AbC_dEf-0123456789abcdefghijklmnopqrstuvwxy';
  assert.equal(ersetze(`/api/fern/${tok}`), '/api/fern/***');
  assert.equal(ersetze(`/api/fern/${tok}/pdf`), '/api/fern/***/pdf');
  assert.equal(ersetze(`/api/fern/${tok}?x=1`), '/api/fern/***?x=1');
  assert.equal(ersetze(`/unterschrift/${tok}`), '/unterschrift/***');
  assert.equal(ersetze('/api/berichte/5'), '/api/berichte/5');
  assert.ok(!ersetze(`/api/fern/${tok}`).includes(tok));
});

test('G-10: backup.sh macht den Probeordner für den Container-Benutzer (uid 1000) lesbar', (t) => {
  if (process.getuid && process.getuid() !== 0) { t.skip('nur als root prüfbar (setpriv)'); return; }
  if (spawnSync('setpriv', ['--version']).status !== 0) { t.skip('setpriv fehlt'); return; }
  if (spawnSync('setpriv', ['--reuid=1000', '--regid=1000', '--clear-groups', process.execPath, '-e', `require(${JSON.stringify(path.join(SERVER, 'sicherung.js'))})`]).status !== 0) { t.skip('Server-Ordner für uid 1000 nicht lesbar'); return; }
  const o = fs.mkdtempSync(path.join(os.tmpdir(), 'bautag-g10-'));
  t.after(() => fs.rmSync(o, { recursive: true, force: true }));
  fs.chmodSync(o, 0o755);
  const { oeffneDatenbank } = require(path.join(SERVER, 'db'));
  const datei = path.join(o, 'daten', 'bautag.db');
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  oeffneDatenbank(datei).schliessen();
  const ziel = path.join(o, 'sicherung');
  const env = {
    ...process.env, BAUTAG_DB: datei, BAUTAG_LOG: path.join(o, 'log.txt'), TMPDIR: o,
    BAUTAG_SICHERUNG: ziel, BAUTAG_SICHERUNG_APP: ziel, BAUTAG_UPLOADS_APP: path.join(o, 'daten', 'uploads'),
    BAUTAG_RESTIC_ENV: path.join(o, 'fehlt.env'), BAUTAG_SICHERUNG_CMD: `${process.execPath} ${SERVER}/sicherung.js`,
    // Prüfung wie im Container: als uid 1000 („node“), nur lesend
    BAUTAG_PRUEF_CMD: `setpriv --reuid=1000 --regid=1000 --clear-groups ${process.execPath} ${SERVER}/sicherung.js pruefen`,
    BAUTAG_TEST_IMMER: '1', NODE_OPTIONS: '--disable-warning=ExperimentalWarning'
  };
  const r = spawnSync('bash', [path.join(DEPLOY, 'backup.sh')], { env, encoding: 'utf8' });
  const log = fs.existsSync(env.BAUTAG_LOG) ? fs.readFileSync(env.BAUTAG_LOG, 'utf8') : '';
  assert.equal(r.status, 0, r.stdout + r.stderr + log);
  const st = JSON.parse(spawnSync(process.execPath, [`${SERVER}/sicherung.js`, 'anzeigen'], { env, encoding: 'utf8' }).stdout).sicherung;
  assert.equal(st.test.ok, true, JSON.stringify(st.test));
});
