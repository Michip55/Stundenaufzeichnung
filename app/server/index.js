'use strict';
/**
 * BauTag – Server. App-Fabrik `createApp({dbPath, uhr})` für Tests; Start mit `node server/index.js`.
 */
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { oeffneDatenbank } = require('./db');
const { erzeugeUhr } = require('./datum');
const { ApiFehler, nichtGefunden } = require('./fehler');
const { sitzungMiddleware, angemeldet, LoginBremse, sitzungsKonfig } = require('./auth');
const { entferneEuroFelder, schreibeStandardMatrix } = require('./rechte');

const VERSION = require('../package.json').version;
const PUBLIC = path.join(__dirname, '..', 'public');
// Oberfläche nutzt keine Inline-Skripte; style-Attribute kommen vor → 'unsafe-inline' nur für Styles
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "connect-src 'self'", "font-src 'self'", "manifest-src 'self'", "worker-src 'self'", "object-src 'none'",
  "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"
].join('; ');

/**
 * @param {object} [opt]
 * @param {string} [opt.dbPath]  Pfad der SQLite-Datei oder ':memory:' (Standard: BAUTAG_DB bzw. data/bautag.db)
 * @param {Function|string} [opt.uhr]  Uhr-Funktion () => Date oder ISO-Startzeit (Standard: BAUTAG_UHR)
 * @param {boolean} [opt.seed]  Testdaten einspielen (nur sinnvoll mit :memory:)
 * @param {boolean} [opt.euroSicherheitsnetz=true]  zusätzliches Entfernen von €-Feldern vor dem Senden
 * @param {string} [opt.publicDir]
 */
function createApp(opt = {}) {
  const dbPath = opt.dbPath || process.env.BAUTAG_DB || path.join(__dirname, '..', 'data', 'bautag.db');
  const uhr = erzeugeUhr(opt.uhr !== undefined ? opt.uhr : process.env.BAUTAG_UHR);
  const db = opt.db || oeffneDatenbank(dbPath);
  const bt = { db, uhr, version: VERSION, pdfUnkomprimiert: Boolean(opt.pdfUnkomprimiert), sitzung: sitzungsKonfig(opt.sitzung || {}) };
  bt.demo = opt.demo !== undefined ? Boolean(opt.demo) : process.env.BAUTAG_DEMO === '1';
  bt.loginListe = opt.loginListe !== undefined ? Boolean(opt.loginListe) : process.env.BAUTAG_LOGIN_LISTE !== '0';
  bt.bremse = new LoginBremse(db, uhr);

  // Rechte-Matrix beim ersten Start anlegen
  if (!db.eins('SELECT 1 AS x FROM rolle_recht LIMIT 1')) db.transaktion(() => schreibeStandardMatrix(db));
  // Positionskatalog (Firmenvorlage, API.md 10) beim ersten Start anlegen
  require('./positionen').katalogAnlegen(db, uhr());
  if (opt.seed) require('./seed').seed(db, { uhr: uhr(), demo: bt.demo });

  bt.warnungen = [];
  const verwalter = require('./rechte').entsperrKonten(db);
  if (verwalter.length < 2) {
    bt.warnungen.push(`Nur ${verwalter.length} aktives Verwaltungs-Konto (GF/Büro) kann gesperrte Konten entsperren – bitte mindestens zwei anlegen (Notfall: node server/entsperren.js <Personalnummer>).`);
  }

  const app = express();
  app.disable('x-powered-by');
  // Nur hinter einem Reverse-Proxy: dann gelten X-Forwarded-For/-Proto (Client-IP, HTTPS)
  const trustProxy = opt.trustProxy !== undefined ? opt.trustProxy : process.env.TRUST_PROXY === '1';
  app.set('trust proxy', trustProxy ? 1 : false);
  app.locals.bt = bt;

  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  const api = express.Router();

  // Schreibende Anfragen nur als JSON (CSRF-Schutz zusätzlich zu SameSite=Strict)
  api.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const ct = (req.headers['content-type'] || '').toLowerCase();
      const hatBody = Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'];
      if (ct ? !ct.startsWith('application/json') : hatBody) {
        return next(new ApiFehler(415, 'UNGUELTIG', 'Schreibende Anfragen müssen als JSON gesendet werden (Content-Type: application/json).'));
      }
    }
    next();
  });
  api.use(express.json({ limit: '2mb', strict: true }));
  api.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && (req.body === undefined || req.body === null)) req.body = {};
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && (typeof req.body !== 'object' || Array.isArray(req.body))) {
      return next(new ApiFehler(400, 'UNGUELTIG', 'Anfrage: JSON-Objekt erwartet.'));
    }
    next();
  });
  api.use(sitzungMiddleware(bt));

  // Öffentlich (vor dem €-Sicherheitsnetz, damit 'db' nicht als €-Feld entfernt wird)
  api.get('/gesundheit', (req, res) => {
    let ok = 'ok';
    try { db.eins('SELECT 1 AS x'); } catch (_) { ok = 'fehler'; }
    res.json({ ok: ok === 'ok', version: VERSION, db: ok });
  });

  // Sicherheitsnetz: ohne preise_sehen verlassen keine €-Felder den Server
  if (opt.euroSicherheitsnetz !== false) {
    api.use((req, res, next) => {
      const ctx = req.ctx;
      if (ctx && !ctx.hat('preise_sehen')) {
        const orig = res.json.bind(res);
        res.json = (body) => orig(entferneEuroFelder(body, { kalk: ctx.hat('kalk_sehen') }));
      }
      next();
    });
  }

  require('./routes/auth')(api, bt);

  // Ab hier nur angemeldet – und erst nach Änderung einer vorgegebenen PIN
  api.use(angemeldet);
  api.use((req, res, next) => {
    if (req.ctx.benutzer.muss_pin_aendern) return next(new ApiFehler(403, 'PIN_AENDERN', 'Bitte zuerst die PIN ändern.'));
    next();
  });
  require('./routes/stammdaten')(api, bt);
  require('./routes/preise')(api, bt);
  require('./routes/zeit')(api, bt);
  require('./routes/abwesenheiten')(api, bt);
  require('./routes/berichte')(api, bt);
  require('./routes/kalkulation')(api, bt);
  require('./routes/benachrichtigungen')(api, bt);
  require('./routes/monat')(api, bt);
  require('./routes/benutzer')(api, bt);
  require('./routes/integrationen')(api, bt);

  api.use((req, res, next) => next(nichtGefunden('Unbekannte API-Adresse.')));
  app.use('/api', api);

  // Oberfläche (statisch) + SPA-Fallback
  const publicDir = opt.publicDir || PUBLIC;
  app.use(express.static(publicDir, { index: 'index.html', fallthrough: true }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    // Fehlende Dateien (Endung) oder Punkt-Pfade (/.git/…) → 404 statt index.html
    if (/\.[A-Za-z0-9]{1,8}$/.test(req.path) || /(^|\/)\./.test(req.path)) {
      return res.status(404).type('text/plain; charset=utf-8').send('Nicht gefunden.');
    }
    const index = path.join(publicDir, 'index.html');
    if (fs.existsSync(index)) return res.sendFile(index);
    res.status(404).type('text/plain; charset=utf-8').send('BauTag: Oberfläche (app/public) ist noch nicht vorhanden.');
  });

  // Fehlerbehandlung
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err instanceof ApiFehler) {
      if (err.retryAfter) res.setHeader('Retry-After', String(err.retryAfter));
      return res.status(err.status).json({ fehler: err.message, code: err.code, ...(err.extra || {}) });
    }
    if (err && /UNIQUE constraint failed/.test(String(err.message))) return res.status(409).json({ fehler: 'Der Eintrag ist bereits vorhanden (doppelter Wert).', code: 'KONFLIKT' });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ fehler: 'Ungültiges JSON.', code: 'UNGUELTIG' });
    if (err && err.type === 'entity.too.large') return res.status(413).json({ fehler: 'Anfrage zu groß.', code: 'UNGUELTIG' });
    if (err && err.status >= 400 && err.status < 500) return res.status(err.status).json({ fehler: 'Ungültige Anfrage.', code: 'UNGUELTIG' });
    console.error('[BauTag] Fehler:', err);
    res.status(500).json({ fehler: 'Interner Fehler. Bitte später erneut versuchen.', code: 'SERVER' });
  });

  app.bt = bt;
  app.schliessen = () => db.schliessen();
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const app = createApp();
  for (const w of app.bt.warnungen) console.warn('[BauTag] WARNUNG: ' + w);
  const server = app.listen(port, () => {
    console.log(`BauTag läuft auf http://localhost:${port} (DB: ${app.bt.db.pfad})`);
  });
  const stopp = () => { server.close(() => { app.schliessen(); process.exit(0); }); };
  process.on('SIGINT', stopp);
  process.on('SIGTERM', stopp);
}

module.exports = { createApp };
