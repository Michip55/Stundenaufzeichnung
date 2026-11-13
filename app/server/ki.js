'use strict';
/**
 * Optionale KI (Anthropic Claude) für Diktat, Lieferschein, Papierbericht (API.md 12.13). Standardmäßig AUS.
 * Ergebnis ist immer nur ein Vorschlag; Stammdaten-Zuordnung prüft der Server. Aus der Datenbank werden keine €-Daten
 * gesendet; bei Lieferschein/Papierbericht wird aber das Foto übermittelt (ohne EXIF/GPS – G-15) und kann Preise zeigen.
 */
const Anthropic = require('@anthropic-ai/sdk');
const { z } = require('zod');
const { betaZodOutputFormat } = require('@anthropic-ai/sdk/helpers/beta/zod');
const G = require('./geheim');
const { wienDatum } = require('./datum');

const MODELL = 'claude-opus-5-5';
const AnthropicKlasse = Anthropic.default || Anthropic;

class KiFehler extends Error {
  constructor(text, art) { super(text); this.art = art; }
}

function einstellungen(db) {
  return { aktiv: false, datenschutzBestaetigt: false, tagesLimit: 200, ...(db.einstellung('ki', {}) || {}) };
}
function schluessel(bt) {
  const e = einstellungen(bt.db);
  return e.apiKey ? G.entschluesseln(bt, e.apiKey) : null;
}
function aktiv(bt) {
  const e = einstellungen(bt.db);
  return Boolean(e.aktiv && e.datenschutzBestaetigt && e.apiKey);
}
function heuteNutzung(db, tag) {
  return db.eins('SELECT COUNT(*) AS aufrufe, COALESCE(SUM(eingabe_tokens), 0) AS ein, COALESCE(SUM(ausgabe_tokens), 0) AS aus FROM ki_nutzung WHERE tag = ?', tag);
}

/** Client (im Test austauschbar: bt.kiClient(apiKey) bzw. Attrappe mit BAUTAG_TEST) */
function client(bt, apiKey) {
  if (typeof bt.kiClient === 'function') return bt.kiClient(apiKey);
  if (bt.test) return testClient(bt);
  return new AnthropicKlasse({ apiKey, timeout: 120 * 1000, maxRetries: 2 });
}

/** Attrappe für BAUTAG_TEST (API.md 12.18) */
function testClient(bt) {
  return {
    beta: {
      messages: {
        parse: async (params) => {
          bt.testAusgang.ki.push({ zweck: params.metadata ? params.metadata.user_id : '', zeit: bt.uhr().toISOString() });
          const f = bt.testVorgaben.kiFehler;
          if (f) {
            bt.testVorgaben.kiFehler = null;
            if (f === 'ungueltig') throw Object.assign(Object.create(AnthropicKlasse.AuthenticationError.prototype), { status: 401, message: 'invalid x-api-key' });
            if (f === 'limit') throw Object.assign(Object.create(AnthropicKlasse.RateLimitError.prototype), { status: 429, message: 'rate limit' });
            if (f === 'verbindung') throw Object.assign(Object.create(AnthropicKlasse.APIConnectionError.prototype), { message: 'Connection error.' });
            if (f === 'ablehnung') return { stop_reason: 'refusal', parsed_output: null, usage: { input_tokens: 10, output_tokens: 0 }, content: [] };
          }
          const antwort = bt.testVorgaben.kiAntwort || {};
          const parsed = params.output_config.format.parse(JSON.stringify(antwort));
          return { stop_reason: 'end_turn', parsed_output: parsed, usage: { input_tokens: 100, output_tokens: 50 }, content: [{ type: 'text', text: JSON.stringify(antwort) }] };
        }
      }
    }
  };
}

/**
 * Strukturierte Anfrage an Claude.
 * @param {{zweck:string, system:string, inhalt:Array, schema:import('zod').ZodType, benutzerId?:number, apiKey?:string, ohneLimit?:boolean}} o
 */
async function anfrage(bt, o) {
  const { db } = bt;
  const tag = wienDatum(bt.uhr());
  const e = einstellungen(db);
  const key = o.apiKey || schluessel(bt);
  if (!key) throw new KiFehler('Kein API-Schlüssel hinterlegt.', 'ungueltig');
  if (!o.ohneLimit && heuteNutzung(db, tag).aufrufe >= (e.tagesLimit || 200)) throw new KiFehler('KI-Tageslimit erreicht', 'limit_tag');
  const protokoll = (ok, usage, fehler) => db.lauf('INSERT INTO ki_nutzung (zeit, tag, zweck, benutzer_id, eingabe_tokens, ausgabe_tokens, ok, fehler) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    bt.uhr().toISOString(), tag, o.zweck, o.benutzerId || null, usage ? usage.input_tokens : null, usage ? usage.output_tokens : null, ok ? 1 : 0, fehler || null);
  let r;
  try {
    r = await client(bt, key).beta.messages.parse({
      model: MODELL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(o.schema) },
      metadata: { user_id: o.zweck },
      system: o.system,
      messages: [{ role: 'user', content: o.inhalt }]
    });
  } catch (err) {
    let text = 'KI-Dienst: unbekannter Fehler', art = 'fehler';
    if (err instanceof AnthropicKlasse.AuthenticationError || err instanceof AnthropicKlasse.PermissionDeniedError) { text = 'API-Schlüssel ungültig'; art = 'ungueltig'; } else if (err instanceof AnthropicKlasse.RateLimitError) { text = 'KI-Dienst ausgelastet (Rate-Limit) – später erneut versuchen'; art = 'limit'; } else if (err instanceof AnthropicKlasse.APIConnectionError) { text = 'KI-Dienst nicht erreichbar (Netz/Zeitüberschreitung)'; art = 'verbindung'; } else if (err instanceof AnthropicKlasse.BadRequestError) { text = `KI-Anfrage abgelehnt: ${String(err.message).slice(0, 150)}`; art = 'anfrage'; } else if (err instanceof AnthropicKlasse.APIError) { text = `KI-Dienst Fehler ${err.status || ''}`.trim(); art = 'dienst'; }
    protokoll(false, null, text);
    throw new KiFehler(text, art);
  }
  const usage = r.usage || {};
  console.log(`[BauTag] KI ${o.zweck}: ${usage.input_tokens || 0} Eingabe-, ${usage.output_tokens || 0} Ausgabe-Tokens`);
  if (r.stop_reason === 'refusal') { protokoll(false, usage, 'abgelehnt'); throw new KiFehler('Die KI hat die Anfrage abgelehnt.', 'ablehnung'); }
  if (r.stop_reason === 'max_tokens') { protokoll(false, usage, 'max_tokens'); throw new KiFehler('Die KI-Antwort war zu lang (abgeschnitten).', 'max_tokens'); }
  if (r.parsed_output == null) { protokoll(false, usage, 'nicht lesbar'); throw new KiFehler('Die KI-Antwort war nicht lesbar.', 'format'); }
  protokoll(true, usage, null);
  return { daten: r.parsed_output, usage };
}

const SCHEMA = {
  diktat: z.object({
    geraete: z.array(z.object({ name: z.string(), stunden: z.number() })),
    material: z.array(z.object({ name: z.string(), menge: z.number(), einheit: z.string() })),
    personal: z.array(z.object({ name: z.string(), stunden: z.number().nullable(), von: z.string().nullable(), bis: z.string().nullable() })),
    regie: z.array(z.object({ text: z.string(), stunden: z.number() })),
    arbeitsleistung: z.string(),
    vorkommnisse: z.string()
  }),
  lieferschein: z.object({
    lieferant: z.string().nullable(), lieferscheinNr: z.string().nullable(), datum: z.string().nullable(),
    positionen: z.array(z.object({ material: z.string(), menge: z.number(), einheit: z.string() }))
  }),
  papier: z.object({ datum: z.string().nullable(), kst: z.string().nullable(), text: z.string() })
};

const SYSTEM = {
  diktat: 'Du strukturierst diktierte Bautagesberichte einer österreichischen Baufirma. Erfinde nichts: nur, was im Text steht. Zahlen als Zahlen, Uhrzeiten als HH:MM. Gerätenamen, Material und Personen so, wie sie im Text genannt werden; die Zuordnung zu den Stammdaten macht das Programm. Arbeitsleistung als kurze, sachliche Sätze.',
  lieferschein: 'Du liest Lieferscheine bzw. Wiegescheine (Baustoffe) aus. Gib Lieferant, Lieferschein-Nummer, Datum (JJJJ-MM-TT) und die gelieferten Materialien mit Menge und Einheit zurück. Keine Preise. Erfinde nichts; fehlt etwas, null.',
  papier: 'Du liest einen fotografierten Papier-Bautagesbericht (auch Handschrift). Gib Datum (JJJJ-MM-TT), Kostenstelle (Format NN-NNN) und den lesbaren Text zurück. Erfinde nichts.'
};

/** Bild als Inhaltsblock (Base64) */
function bildBlock(mime, buf) {
  return { type: 'image', source: { type: 'base64', media_type: mime, data: buf.toString('base64') } };
}

/** Hinweis in Antworten, wenn ein Foto an die KI geht (G-15) */
const FOTO_HINWEIS = 'Das Foto wird an die KI übermittelt (Anthropic; ohne EXIF/GPS).';

module.exports = { FOTO_HINWEIS, MODELL, KiFehler, einstellungen, aktiv, anfrage, heuteNutzung, SCHEMA, SYSTEM, bildBlock, schluessel };
