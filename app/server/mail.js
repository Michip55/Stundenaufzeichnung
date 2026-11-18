'use strict';
/**
 * E-Mail über SMTP (API.md 12.5) mit nodemailer. Einstellung (DB, Passwort verschlüsselt) vor Umgebung (SMTP_*).
 * Mit bt.test landen Mails in bt.testAusgang.mails.
 */
const G = require('./geheim');
const { benachrichtige, empfaengerMitRecht } = require('./benachrichtigung');

/** Wirksame Konfiguration → {host, port, sicher, benutzer, passwort, absender, alarmAn, aktiv, quelle} | null */
function konfig(bt) {
  const e = bt.db.einstellung('email', null);
  if (e && e.host) {
    return { host: e.host, port: e.port || 587, sicher: Boolean(e.sicher), benutzer: e.benutzer || '', passwort: e.passwort ? G.entschluesseln(bt, e.passwort) : '', absender: e.absender, alarmAn: e.alarmAn || process.env.ALARM_EMAIL || '', aktiv: e.aktiv !== false, quelle: 'einstellung', passwortGesetzt: Boolean(e.passwort) };
  }
  if (bt.test) return { host: 'test', port: 25, sicher: false, benutzer: '', passwort: '', absender: 'bautag@test.invalid', alarmAn: (e && e.alarmAn) || 'alarm@test.invalid', aktiv: true, quelle: 'test', passwortGesetzt: false };
  if (process.env.SMTP_HOST) {
    return {
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), sicher: process.env.SMTP_SECURE === '1', benutzer: process.env.SMTP_USER || '',
      passwort: process.env.SMTP_PASS || '', absender: process.env.SMTP_FROM || process.env.SMTP_USER || '', alarmAn: (e && e.alarmAn) || process.env.ALARM_EMAIL || '',
      aktiv: true, quelle: 'umgebung', passwortGesetzt: Boolean(process.env.SMTP_PASS)
    };
  }
  return null;
}

const eingerichtet = (bt) => { const k = konfig(bt); return Boolean(k && k.aktiv && k.host && k.absender); };

/**
 * Mail senden. @returns {Promise<void>} wirft bei Fehler
 * @param {{an:string, betreff:string, text:string, anhaenge?:Array<{dateiname, inhalt:Buffer, typ?}>}} m
 */
async function senden(bt, m) {
  const k = konfig(bt);
  if (!k || !k.aktiv) throw new Error('E-Mail ist nicht eingerichtet.');
  if (bt.test) {
    const f = bt.testVorgaben.emailFehler;
    if (f) { bt.testVorgaben.emailFehler = null; throw new Error(f); }
    bt.testAusgang.mails.push({ an: m.an, betreff: m.betreff, text: m.text, anhaenge: (m.anhaenge || []).map((a) => ({ dateiname: a.dateiname, groesse: a.inhalt.length })), zeit: bt.uhr().toISOString() });
    return;
  }
  const transport = typeof bt.mailTransport === 'function' ? bt.mailTransport(k) : require('nodemailer').createTransport({
    host: k.host, port: k.port, secure: k.sicher, auth: k.benutzer ? { user: k.benutzer, pass: k.passwort } : undefined,
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000, tls: { minVersion: 'TLSv1.2' }
  });
  await transport.sendMail({
    from: k.absender, to: m.an, subject: m.betreff, text: m.text,
    attachments: (m.anhaenge || []).map((a) => ({ filename: a.dateiname, content: a.inhalt, contentType: a.typ || 'application/pdf' }))
  });
}

/** Alarm an `alarmAn` (Sicherung, Versandfehler) – Fehler werden nur protokolliert */
function alarm(bt, betreff, text) {
  const k = konfig(bt);
  if (!k || !k.aktiv || !k.alarmAn) return;
  senden(bt, { an: k.alarmAn, betreff, text }).catch((e) => console.error('[BauTag] Alarm-Mail:', e.message));
}

/**
 * Bericht (AG-Fassung) im Hintergrund versenden; Eintrag in mail_ausgang.
 * @returns {number} Ausgangs-ID
 */
function berichtVersenden(bt, berichtId, an, benutzerId = null) {
  const { db } = bt;
  const b = db.eins('SELECT r.id, r.datum, s.kst, s.name, s.kurz FROM bericht r JOIN baustelle s ON s.id = r.baustelle_id WHERE r.id = ?', berichtId);
  const betreff = `Bautagesbericht ${b.kst} ${b.kurz || b.name} vom ${b.datum.split('-').reverse().join('.')}`;
  const id = db.lauf("INSERT INTO mail_ausgang (art, bezug, an, betreff, status, erstellt, erstellt_von) VALUES ('bericht', ?, ?, ?, 'wartet', ?, ?)", `bericht:${berichtId}`, an, betreff, bt.uhr().toISOString(), benutzerId).id;
  const lauf = (async () => {
    try {
      const pdf = await require('./routes/berichte').agPdf(bt, berichtId);
      const firma = db.einstellung('firma', { name: 'BauTag' });
      await senden(bt, {
        an, betreff,
        text: `Sehr geehrte Damen und Herren,\n\nim Anhang erhalten Sie den unterschriebenen ${betreff}.\n\nMit freundlichen Grüßen\n${firma.name}`,
        anhaenge: [{ dateiname: `Bautagesbericht_${b.kst}_${b.datum}.pdf`, inhalt: pdf }]
      });
      db.lauf("UPDATE mail_ausgang SET status = 'gesendet', gesendet = ?, versuche = versuche + 1, fehler = NULL WHERE id = ?", bt.uhr().toISOString(), id);
      db.protokolliere({ zeit: bt.uhr().toISOString(), benutzerId, art: 'email', objekt: `bericht:${berichtId}`, neu: { an }, text: `Bericht ${b.kst} ${b.datum} per E-Mail an den Auftraggeber gesendet` });
    } catch (e) {
      const fehler = String(e.message || e).slice(0, 300);
      db.lauf("UPDATE mail_ausgang SET status = 'fehler', fehler = ?, versuche = versuche + 1 WHERE id = ?", fehler, id);
      db.protokolliere({ zeit: bt.uhr().toISOString(), benutzerId, art: 'email', objekt: `bericht:${berichtId}`, neu: { an, fehler }, text: `E-Mail-Versand Bericht ${b.kst} ${b.datum} fehlgeschlagen` });
      for (const e2 of empfaengerMitRecht(db, 'stammdaten')) { // 15.3: Büro/Bauleiter/GF über das Recht
        benachrichtige(db, { benutzerId: e2.id, typ: 'email', titel: `E-Mail nicht zugestellt: ${b.kst}`, text: `Der Bautagesbericht vom ${b.datum.split('-').reverse().join('.')} konnte nicht an ${an} gesendet werden: ${fehler}`, zeit: bt.uhr().toISOString(), schluessel: `mail:${id}` });
      }
      alarm(bt, `BauTag: E-Mail nicht zugestellt (${b.kst})`, `${betreff}\nan: ${an}\nFehler: ${fehler}`);
    }
  })();
  bt.laufend = (bt.laufend || []).concat(lauf);
  lauf.finally(() => { bt.laufend = (bt.laufend || []).filter((x) => x !== lauf); });
  return id;
}

module.exports = { konfig, eingerichtet, senden, alarm, berichtVersenden };
