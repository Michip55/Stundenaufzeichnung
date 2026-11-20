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

/**
 * 15.33 (Inhaber 19.11.2026): Namensliste standardmäßig aus. update.sh stellt eine aus der alten Vorlage stammende Zeile
 * BAUTAG_LOGIN_LISTE=1 EINMALIG auf 0 (deploy/namensliste-umstellen.sh): Sicherung vorher, nur für root lesbar, Merkzeile –
 * danach bleibt eine bewusst gesetzte 1 stehen. Geprüft in einem leeren Ordner mit bash: =1, =0, fehlt, Merkzeile vorhanden.
 */
test('15.33: einmalige Umstellung BAUTAG_LOGIN_LISTE=1 → 0 (alle Fälle, Sicherung, Rechte 600, Merkzeile)', () => {
  const skript = path.join(DEPLOY, 'namensliste-umstellen.sh');
  const lauf = (datei) => spawnSync('bash', [skript, datei], { encoding: 'utf8' });
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'bautag-env-'));
  const fall = (name, inhalt) => { const f = path.join(ordner, name, '.env'); fs.mkdirSync(path.dirname(f)); fs.writeFileSync(f, inhalt, { mode: 0o600 }); fs.chmodSync(f, 0o600); return f; };
  const sicherungen = (f) => fs.readdirSync(path.dirname(f)).filter((n) => n.startsWith('.env.vor-15.33-'));
  const modus = (f) => (fs.statSync(f).mode & 0o777).toString(8);
  try {
    // 1) Zeile =1 (alte Vorlage) → 0, Merkzeile davor, Sicherung mit altem Inhalt, Rechte 600, Exit-Code 3
    const alt = 'BAUTAG_DOMAIN=bautag.example.at\n# Namensliste beim Anmelden (1 = Namen wählen, 0 = nur Personalnummer)\nBAUTAG_LOGIN_LISTE=1\nBAUTAG_WETTER=1\n';
    const an = fall('an', alt);
    let r = lauf(an);
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(r.stdout, /EINMALIGE UMSTELLUNG/);
    let neu = fs.readFileSync(an, 'utf8');
    assert.match(neu, /^# 15\.33 Namensliste aus \(einmalig umgestellt am \d\d\.\d\d\.\d{4}.*\)\nBAUTAG_LOGIN_LISTE_GEPRUEFT=15\.33\nBAUTAG_LOGIN_LISTE=0\n/m);
    assert.ok(!/^BAUTAG_LOGIN_LISTE=1/m.test(neu));
    assert.ok(neu.startsWith('BAUTAG_DOMAIN=bautag.example.at\n') && neu.endsWith('BAUTAG_WETTER=1\n'), 'übrige Zeilen verändert');
    assert.equal(modus(an), '600');
    const s1 = sicherungen(an);
    assert.equal(s1.length, 1);
    assert.equal(fs.readFileSync(path.join(path.dirname(an), s1[0]), 'utf8'), alt);
    assert.equal(modus(path.join(path.dirname(an), s1[0])), '600');
    assert.deepEqual(fs.readdirSync(path.dirname(an)).filter((n) => n.startsWith('.env-15.33.')), [], 'Zwischendatei liegen geblieben');
    // 2) zweiter Lauf: nichts mehr (idempotent); danach bewusst wieder 1 → bleibt 1
    r = lauf(an);
    assert.equal(r.status, 0); assert.equal(r.stdout, '');
    fs.writeFileSync(an, fs.readFileSync(an, 'utf8').replace('BAUTAG_LOGIN_LISTE=0', 'BAUTAG_LOGIN_LISTE=1'));
    r = lauf(an);
    assert.equal(r.status, 0);
    assert.match(fs.readFileSync(an, 'utf8'), /^BAUTAG_LOGIN_LISTE=1$/m, 'bewusst gesetzte 1 erneut umgestellt');
    assert.equal(sicherungen(an).length, 1);
    // 3) Zeile =0 → unverändert, nur Merkzeile; Exit-Code 0
    const aus = fall('aus', 'BAUTAG_LOGIN_LISTE=0\nBAUTAG_WETTER=1');
    r = lauf(aus);
    assert.equal(r.status, 0, r.stderr);
    neu = fs.readFileSync(aus, 'utf8');
    assert.equal(neu.split('\n').slice(0, 2).join('\n'), 'BAUTAG_LOGIN_LISTE=0\nBAUTAG_WETTER=1');
    assert.match(neu, /\n# 15\.33 Namensliste aus \(einmalig geprüft am .*war nicht 1.*\)\nBAUTAG_LOGIN_LISTE_GEPRUEFT=15\.33\n$/);
    assert.equal(modus(aus), '600');
    // 4) keine Zeile → unverändert (Standard aus), Merkzeile; später gesetzte 1 bleibt
    const fehlt = fall('fehlt', 'BAUTAG_DOMAIN=x\n');
    r = lauf(fehlt);
    assert.equal(r.status, 0, r.stderr);
    assert.match(fs.readFileSync(fehlt, 'utf8'), /^BAUTAG_DOMAIN=x\n# 15\.33 Namensliste aus \(einmalig geprüft am .*keine Zeile BAUTAG_LOGIN_LISTE.*\)\nBAUTAG_LOGIN_LISTE_GEPRUEFT=15\.33\n$/);
    fs.appendFileSync(fehlt, 'BAUTAG_LOGIN_LISTE=1\n');
    assert.equal(lauf(fehlt).status, 0);
    assert.match(fs.readFileSync(fehlt, 'utf8'), /^BAUTAG_LOGIN_LISTE=1$/m);
    // 5) Merkzeile schon vorhanden (mit 1): nichts, keine Sicherung
    const marke = fall('marke', '# 15.33 Namensliste aus (einmalig umgestellt am 19.11.2026)\nBAUTAG_LOGIN_LISTE=1\n');
    r = lauf(marke);
    assert.equal(r.status, 0); assert.equal(sicherungen(marke).length, 0);
    assert.equal(fs.readFileSync(marke, 'utf8'), '# 15.33 Namensliste aus (einmalig umgestellt am 19.11.2026)\nBAUTAG_LOGIN_LISTE=1\n');
    // 6) Schreibweisen der alten 1: Leerzeichen, Anführungszeichen, Windows-Zeilenende → 0 (Zeilenende bleibt)
    const crlf = fall('crlf', 'A=1\r\nBAUTAG_LOGIN_LISTE = "1"\r\nB=2\r\n');
    assert.equal(lauf(crlf).status, 3);
    assert.match(fs.readFileSync(crlf, 'utf8'), /^A=1\r\n# 15\.33 Namensliste aus [^\n]*\)\r\nBAUTAG_LOGIN_LISTE_GEPRUEFT=15\.33\r\nBAUTAG_LOGIN_LISTE=0\r\nB=2\r\n$/);
    // 7) .env fehlt: nichts
    assert.equal(lauf(path.join(ordner, 'gibtsnicht', '.env')).status, 0);
    // update.sh ruft die Umstellung nach dem Holen des Programmstands auf und startet bei Code 3 neu
    const u = lies('update.sh');
    assert.match(u, /bash "\$DIR\/namensliste-umstellen\.sh" "\$DIR\/\.env"/);
    assert.ok(u.indexOf('namensliste-umstellen.sh" "$DIR/.env"') > u.indexOf('git pull --ff-only'));
    assert.match(u, /ENV_NEU" == 1[\s\S]*up -d --no-build app/);
    // Vorlage: 0 mit Erklärung, Merkzeile und BAUTAG_LOGIN_LISTE_GEPRUEFT – eine neue Installation wird nie umgestellt
    const vorlage = fall('vorlage', lies('.env.beispiel'));
    assert.match(lies('.env.beispiel'), /^# 15\.33 Namensliste aus .*\nBAUTAG_LOGIN_LISTE_GEPRUEFT=15\.33\nBAUTAG_LOGIN_LISTE=0$/m);
    r = lauf(vorlage);
    assert.equal(r.status, 0); assert.equal(r.stdout, ''); assert.equal(fs.readFileSync(vorlage, 'utf8'), lies('.env.beispiel'));
  } finally { fs.rmSync(ordner, { recursive: true, force: true }); }
});

/**
 * Nachprüfung 15.33 (Befund 2): Das Update AUF 15.33 führt noch das ALTE update.sh aus (bash liest die geöffnete alte Datei weiter,
 * git pull legt die neue nur daneben). Darum (a) zählt im Docker-Betrieb eine 1 erst mit BAUTAG_LOGIN_LISTE_GEPRUEFT=15.33 – das
 * alte update.sh baut und startet mit der NEUEN docker-compose.yml, die Namensliste ist also schon nach diesem Update aus;
 * (b) update.sh startet sich nach git pull mit der neuen Fassung neu, wenn sich update.sh geändert hat (künftige Updates).
 */
test('15.33 Nachprüfung: alte 1 aus der Vorlage wirkt im Docker-Betrieb nicht, bis die .env geprüft ist', () => {
  const { loginListeAusUmgebung: f } = require(path.join(SERVER, 'index.js'));
  const docker = { BAUTAG_LOGIN_LISTE_NUR_GEPRUEFT: '1' };
  assert.equal(f({ ...docker, BAUTAG_LOGIN_LISTE: '1' }), false, 'alte 1 ohne Prüfung');
  assert.equal(f({ ...docker, BAUTAG_LOGIN_LISTE: '1', BAUTAG_LOGIN_LISTE_GEPRUEFT: '15.33' }), true, 'bewusste 1 nach der Prüfung');
  assert.equal(f({ ...docker, BAUTAG_LOGIN_LISTE: '0', BAUTAG_LOGIN_LISTE_GEPRUEFT: '15.33' }), false);
  assert.equal(f({ ...docker, BAUTAG_LOGIN_LISTE_GEPRUEFT: '15.33' }), false);
  assert.equal(f({ BAUTAG_LOGIN_LISTE: '1' }), true, 'ohne Docker (Entwicklung, Tests) zählt die 1 wie bisher');
  assert.equal(f({}), false);
  const compose = lies('docker-compose.yml');
  const app = compose.slice(compose.indexOf('  app:'), compose.indexOf('  caddy:'));
  assert.match(app, /environment:[\s\S]*\n {6}BAUTAG_LOGIN_LISTE_NUR_GEPRUEFT: "1"\n/);
  const ohneKommentar = app.split('\n').filter((z) => !/^\s*#/.test(z)).join('\n');
  assert.ok(!/BAUTAG_LOGIN_LISTE_GEPRUEFT|BAUTAG_LOGIN_LISTE:/.test(ohneKommentar), 'die Prüfung selbst kommt nur aus .env');
});

test('15.33 Nachprüfung: update.sh startet sich nach git pull mit der neuen Fassung neu (Ablauf alt → neu in einem Git-Klon)', () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'bautag-upd-'));
  const git = (wo, ...a) => { const r = spawnSync('git', ['-C', wo, ...a], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  try {
    // Quelle: Stand „alt“ (update.sh ohne Umstellung, gibt ALT aus), dann Stand „neu“ (echtes update.sh)
    const quelle = path.join(ordner, 'quelle'); fs.mkdirSync(path.join(quelle, 'deploy'), { recursive: true });
    git(quelle, 'init', '-q', '-b', 'main'); git(quelle, 'config', 'user.email', 't@t'); git(quelle, 'config', 'user.name', 't');
    const neuUpdate = lies('update.sh');
    // Docker, Sicherung und Gesundheitsprüfung durch Attrappen ersetzen (PATH), sonst bleibt das Skript unverändert
    const attrappen = path.join(ordner, 'bin'); fs.mkdirSync(attrappen);
    fs.writeFileSync(path.join(attrappen, 'docker'), `#!/usr/bin/env bash\necho "docker $*" >> "${ordner}/docker.log"\ncase "$*" in *"image inspect"*) exit 1;; *"ps -q"*) exit 0;; esac\nexit 0\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(quelle, 'deploy', 'backup.sh'), '#!/usr/bin/env bash\necho "SICHERUNG $*" >> "$(dirname "$0")/../../sicherung.log"\n');
    fs.writeFileSync(path.join(quelle, 'deploy', 'update.sh'), '#!/usr/bin/env bash\nset -e\nDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"\nbash "$DIR/backup.sh" --lokal\ncd "$DIR/.."\ngit pull -q --ff-only\necho "ALTES update.sh"\n');
    git(quelle, 'add', '-A'); git(quelle, 'commit', '-q', '-m', 'alt');
    const server = path.join(ordner, 'server');
    spawnSync('git', ['clone', '-q', quelle, server]);
    fs.writeFileSync(path.join(server, 'deploy', '.env'), 'BAUTAG_DOMAIN=x\nBAUTAG_LOGIN_LISTE=1\n', { mode: 0o600 });
    fs.writeFileSync(path.join(quelle, 'deploy', 'update.sh'), neuUpdate);
    fs.copyFileSync(path.join(DEPLOY, 'namensliste-umstellen.sh'), path.join(quelle, 'deploy', 'namensliste-umstellen.sh'));
    git(quelle, 'add', '-A'); git(quelle, 'commit', '-q', '-m', 'neu');
    const env = { ...process.env, PATH: `${attrappen}:${process.env.PATH}`, BAUTAG_GESUND_VERSUCHE: '1' };
    delete env.BAUTAG_UPDATE_NEUSTART;
    // 1) erstes Update mit dem ALTEN update.sh: .env bleibt (dafür die Prüfung in der App, Test oben)
    let r = spawnSync('bash', [path.join(server, 'deploy', 'update.sh')], { env, encoding: 'utf8' });
    assert.match(r.stdout, /ALTES update\.sh/);
    assert.match(fs.readFileSync(path.join(server, 'deploy', '.env'), 'utf8'), /^BAUTAG_LOGIN_LISTE=1$/m);
    // 2) ein weiterer Stand mit geändertem update.sh: das (jetzt neue) update.sh startet sich nach dem Pull mit der neuesten Fassung
    fs.writeFileSync(path.join(quelle, 'deploy', 'update.sh'), neuUpdate.replace('echo "==> 3/5 Container bauen', 'echo "NEUESTE FASSUNG"\necho "==> 3/5 Container bauen'));
    git(quelle, 'add', '-A'); git(quelle, 'commit', '-q', '-m', 'neuer');
    const altRev = git(server, 'rev-parse', 'HEAD');
    r = spawnSync('bash', [path.join(server, 'deploy', 'update.sh')], { env, encoding: 'utf8' });
    const aus = r.stdout + r.stderr;
    assert.match(aus, /update\.sh wurde mit dem Programmstand erneuert/, aus);
    assert.match(aus, /NEUESTE FASSUNG/, 'neue Fassung läuft nicht weiter');
    assert.equal((aus.match(/==> 1\/5/g) || []).length, 1, 'Sicherung doppelt angekündigt');
    assert.equal(fs.readFileSync(path.join(ordner, 'sicherung.log'), 'utf8').split('\n').filter(Boolean).length, 2, 'Sicherung beim Neustart wiederholt');
    assert.match(aus, new RegExp(`${altRev.slice(0, 7)}|\\bneuer\\b`), 'ALT ging beim Neustart verloren (Liste der neuen Stände fehlt)');
    assert.match(aus, /\bneuer\b/);
    assert.match(aus, /EINMALIGE UMSTELLUNG/);
    assert.match(fs.readFileSync(path.join(server, 'deploy', '.env'), 'utf8'), /^BAUTAG_LOGIN_LISTE_GEPRUEFT=15\.33\nBAUTAG_LOGIN_LISTE=0$/m);
    // 3) ohne Änderung an update.sh kein Neustart
    r = spawnSync('bash', [path.join(server, 'deploy', 'update.sh')], { env, encoding: 'utf8' });
    assert.ok(!/erneuert/.test(r.stdout + r.stderr));
  } finally { fs.rmSync(ordner, { recursive: true, force: true }); }
});
