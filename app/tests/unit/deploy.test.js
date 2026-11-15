'use strict';
/**
 * Prüfbericht 6 – Betrieb: G-06 (Docker erzwingt Produktion ohne Test), G-09 (Größengrenzen), G-10 (Probe lesbar für uid 1000),
 * G-17 (Token nicht im Log); Nachprüfung N-032 (Caddy-Grenzen je Pfad, Speichergrenze des App-Containers, API.md 14.8)
 */
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

test('G-09/N-032: Caddy erlaubt 40 MB nur für POST auf die Upload-/Import-Pfade der App, sonst 13 MB; Tabelle in ANLEITUNG.md', () => {
  const index = fs.readFileSync(path.join(SERVER, 'index.js'), 'utf8');
  const app = [...index.matchAll(/express\.json\(\{ limit: '(\d+)mb'/g)].map((m) => Number(m[1]));
  assert.ok(app.length >= 4);
  const max = Math.max(...app);
  const grenze = (name) => Number(new RegExp(`const ${name} = express\\.json\\(\\{ limit: '(\\d+)mb'`).exec(index)[1]);
  assert.equal(grenze('jsonDokumente'), max, 'größte App-Grenze = Dokumente/Importe');
  const uebrige = Math.max(grenze('jsonKlein'), grenze('jsonImport'), grenze('jsonFotos'));
  const dok = require(path.join(SERVER, 'dokument-pruefung')).MAX_BYTES;
  assert.ok(Math.ceil((dok * 4) / 3 / 1024 / 1024) + 1 <= max, 'größtes Dokument passt als Base64 in die JSON-Grenze');

  const c = lies('Caddyfile');
  // genau zwei request_body, jede mit Matcher – ohne Matcher gälte sie zusätzlich für alle (dann die kleinere Grenze)
  const rb = [...c.matchAll(/request_body(?: (@\w+))? \{\s*max_size (\d+)MB\s*\}/g)];
  assert.equal(rb.length, 2, 'zwei request_body');
  assert.equal((c.match(/request_body/g) || []).length, 2);
  assert.ok(rb.every((m) => m[1]), 'jede request_body mit Matcher');
  const caddy = Object.fromEntries(rb.map((m) => [m[1].slice(1), Number(m[2])]));
  assert.ok(caddy.gross >= max + 2, `Caddy groß ${caddy.gross} MB vs. App ${max} MB`);
  assert.ok(caddy.klein >= uebrige + 1 && caddy.klein <= 13, `Caddy klein ${caddy.klein} MB vs. übrige App-Grenzen ${uebrige} MB`);
  // die Matcher schließen sich aus: @klein = nicht (@gross)
  const gross = /@gross \{\s*method POST\s*path_regexp \w+ (\S+)\s*\}/.exec(c);
  const klein = /@klein \{\s*not \{\s*method POST\s*path_regexp \w+ (\S+)\s*\}\s*\}/.exec(c);
  assert.ok(gross && klein, 'Matcher @gross und @klein');
  assert.equal(klein[1], gross[1], '@klein ist genau die Umkehrung von @gross');
  // Go-Regexp → JavaScript ((?i) als Flag); gleiche Pfade wie dokumentPfad der App (unter /api)
  const caddyRe = gross[1].startsWith('(?i)') ? new RegExp(gross[1].slice(4), 'i') : new RegExp(gross[1]);
  const appRe = new Function(`return ${/const dokumentPfad = (\/.+\/i);/.exec(index)[1]}`)(); // eslint-disable-line no-new-func
  const pfade = {
    '/baustellen/5/dokumente': true, '/baustellen/5/dokumente/': true, '/Baustellen/12/DOKUMENTE': true, '/baustellen/5/dokumente/7/versionen': true,
    '/baustellen/5/lv-import': true, '/import/bmd-op': true, '/stammdaten/geraete/import': true, '/stammdaten/materialien/import/': true,
    '/baustellen/x/dokumente': false, '/baustellen/5/dokumente/7': false, '/baustellen/5/dokumente/7/versionen/1': false, '/baustellen/5': false,
    '/stammdaten/geraete/import/x': false, '/positionen/katalog/import': false, '/berichte/5/fotos': false, '/fuhrpark/schaeden': false,
    '/fern/abc': false, '/auth/login': false, '/baustellen/5/dokumente-x': false, '/import/bmd-op/x': false
  };
  for (const [p, soll] of Object.entries(pfade)) {
    assert.equal(appRe.test(p), soll, `App ${p}`);
    assert.equal(caddyRe.test(`/api${p}`), soll, `Caddy /api${p}`);
  }
  assert.equal(caddyRe.test('/baustellen/5/dokumente'), false, 'nur unter /api');

  const anl = lies('ANLEITUNG.md');
  assert.match(anl, /## Größengrenzen beim Hochladen/);
  const zeile = (wort) => anl.split('\n').find((z) => z.startsWith('|') && z.includes(wort)) || '';
  assert.ok(zeile('Upload/Import').includes(`**${caddy.gross} MB**`), zeile('Upload/Import'));
  assert.ok(zeile('alle anderen Anfragen**').includes(`**${caddy.klein} MB**`), zeile('alle anderen Anfragen**'));
  assert.ok(anl.includes(`| ${max} MB |`) && anl.includes(`| ${grenze('jsonFotos')} MB |`) && anl.includes(`| ${grenze('jsonKlein')} MB |`));
});

test('N-032: App-Container mit Speichergrenze (mem_limit), gleicher Wert in ANLEITUNG.md', () => {
  const compose = lies('docker-compose.yml');
  const app = compose.slice(compose.indexOf('  app:'), compose.indexOf('  caddy:'));
  const m = /^ {4}mem_limit: (\d+)m$/m.exec(app);
  assert.ok(m, 'mem_limit im Dienst app');
  const mb = Number(m[1]);
  assert.ok(mb >= 1024 && mb <= 2048, `${mb} MB`); // genug für 35-MB-Anfragen samt PDF-Prüfung, Rest des 4-GB-Servers bleibt frei
  assert.match(app, new RegExp(`^ {4}memswap_limit: ${mb}m$`, 'm'), 'ohne zusätzlichen Swap');
  assert.ok(lies('ANLEITUNG.md').includes(`**${mb} MB** Arbeitsspeicher`));
});

test('G-17: Fernunterschrift-Token werden im Caddy-Zugriffsprotokoll maskiert', () => {
  const c = lies('Caddyfile');
  const m = /request>uri regexp (\S+) (\S+)/.exec(c);
  assert.ok(m, 'Filter für request>uri');
  assert.match(c, /format filter \{\s*wrap json/);
  assert.match(c, /request>headers>Referer delete/);
  assert.match(c, /request>headers>Cookie delete/);
  // Go-Regexp → JavaScript: Inline-Flag (?i) als Flag (N-066), Ersetzung $1 entspricht hier JavaScript
  const re = m[1].startsWith('(?i)') ? new RegExp(m[1].slice(4), 'gi') : new RegExp(m[1]);
  const ersetze = (u) => u.replace(re, m[2]);
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
