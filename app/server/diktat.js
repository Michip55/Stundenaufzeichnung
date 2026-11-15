'use strict';
/**
 * Diktat-Assistent (API.md 12.10): deterministischer deutscher Parser für diktierten Berichtstext.
 * Liefert nur einen Vorschlag (Geräte mit Stunden, Material mit Menge/Einheit, Personal, Regie, Arbeitsleistung).
 */

const EINER = { null: 0, ein: 1, eins: 1, eine: 1, einen: 1, einem: 1, einer: 1, zwei: 2, zwo: 2, drei: 3, vier: 4, fünf: 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9 };
const ZEHNER_SONDER = { zehn: 10, elf: 11, zwölf: 12, zwoelf: 12, dreizehn: 13, vierzehn: 14, fünfzehn: 15, fuenfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19 };
const ZEHNER = { zwanzig: 20, dreißig: 30, dreissig: 30, vierzig: 40, fünfzig: 50, fuenfzig: 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90 };

/** Zahlwort (0–9999, „dreieinhalb“, „halb“) → Zahl oder null */
function zahlwort(w) {
  let s = String(w).toLowerCase().trim();
  if (!s) return null;
  if (s === 'halb' || s === 'halbe' || s === 'einhalb') return 0.5;
  if (s === 'eineinhalb' || s === 'anderthalb') return 1.5;
  let plusHalb = 0;
  if (s.endsWith('einhalb') && s.length > 7) { plusHalb = 0.5; s = s.slice(0, -7); }
  const teil = (x) => {
    if (x === '') return 0;
    if (x in EINER) return EINER[x];
    if (x in ZEHNER_SONDER) return ZEHNER_SONDER[x];
    if (x in ZEHNER) return ZEHNER[x];
    const m = /^(.*?)und(zwanzig|dreißig|dreissig|vierzig|fünfzig|fuenfzig|sechzig|siebzig|achtzig|neunzig)$/.exec(x);
    if (m && m[1] in EINER) return EINER[m[1]] + ZEHNER[m[2]];
    return null;
  };
  let wert = 0, rest = s;
  const tm = /^(.*?)tausend(.*)$/.exec(rest);
  if (tm) { const v = tm[1] === '' ? 1 : teil(tm[1]); if (v === null) return null; wert += v * 1000; rest = tm[2]; }
  const hm = /^(.*?)hundert(.*)$/.exec(rest);
  if (hm) { const v = hm[1] === '' ? 1 : teil(hm[1]); if (v === null) return null; wert += v * 100; rest = hm[2]; }
  const r = teil(rest);
  if (r === null) return null;
  wert += r;
  if (wert === 0 && !/^null/.test(s) && !plusHalb) return null;
  return wert + plusHalb;
}

const EINHEITEN = [
  [/^(tonnen?|to|t)$/, 't'], [/^(kubik(meter)?|m3|m³|cbm|kubikmetern)$/, 'm³'], [/^(quadratmeter|m2|m²|qm)$/, 'm²'],
  [/^(laufmeter|lfm|lm)$/, 'lfm'], [/^(meter|m)$/, 'm'], [/^(stück|stueck|stk|st)$/, 'Stk'], [/^(stunden?|std|h)$/, 'Std.'],
  [/^(kilo(gramm)?|kg)$/, 'kg'], [/^(liter|l)$/, 'l'], [/^(fuhren?)$/, 'Fuhren'], [/^(paletten?)$/, 'Paletten']
];
function einheit(w) {
  const s = String(w || '').toLowerCase().replace(/[.,]$/, '');
  for (const [re, e] of EINHEITEN) if (re.test(s)) return e;
  return null;
}

/** Synonyme (eingebaut) → Suchwörter */
const SYNONYME = {
  geraet: { bagger: ['bagger', 'mobilbagger', 'kettenbagger', 'minibagger'], walze: ['walze', 'walzen', 'tandemwalze', 'grabenwalze'], ruettel: ['rüttelplatte', 'rüttler', 'ruettelplatte', 'platte', 'rüttelplatten'],
    lkw: ['lkw', 'laster', 'kipper', 'lastwagen'], lader: ['radlader', 'lader', 'schaufellader'], dumper: ['dumper'], kran: ['kran', 'ladekran'], schneid: ['schneidgerät', 'trennschleifer', 'flex'], kompressor: ['kompressor'] },
  material: { frostschutz: ['frostschutz', 'frostschutzkies', 'fsm', 'frostkoffer'], splitt: ['splitt'], aushub: ['aushub', 'erdaushub', 'erde'], asphalt: ['asphalt', 'heißmischgut', 'mischgut'],
    beton: ['beton'], pflaster: ['pflaster', 'pflastersteine', 'pflastersteinen', 'betonsteinpflaster'], randstein: ['randstein', 'randsteine', 'randleiste', 'randleisten', 'bordstein'], rohr: ['rohr', 'rohre', 'kanalrohr', 'kanalrohre'],
    schotter: ['schotter', 'rollschotter', 'kantkorn'], betonbruch: ['betonbruch'], asphaltbruch: ['asphaltbruch'], graeder: ['grädermaterial', 'gräder', 'graeder'] }
};

const norm = (s) => String(s || '').toLowerCase().normalize('NFC').replace(/ß/g, 'ss');
const woerter = (s) => norm(s).split(/[^a-zäöü0-9³²]+/).filter(Boolean);

/**
 * Zahlwörter im Text durch Ziffern ersetzen; „vier komma fünf“ → 4.5.
 * `dezimal`: Zeichen für das Dezimaltrennzeichen (Standard '.' für die Zahlerkennung). N-115: auswerten() bildet
 * mit einem Platzhalter eine gleich lange Anzeige-Fassung, damit Freitext das Dezimalkomma behält.
 */
function zahlenNormalisieren(text, dezimal = '.') {
  const d = dezimal;
  const dz = (x) => String(x).replace('.', d);
  const t = String(text).replace(/(\d),(\d)/g, `$1${d}$2`);
  const ws = t.split(/(\s+)/);
  const out = [];
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    const z = /^\s+$/.test(w) ? null : zahlwort(w.replace(/[.,;:!?]$/, ''));
    if (z !== null && !/^(ein|eine|einen|einem|einer)$/i.test(w.replace(/[.,;:!?]$/, '').trim())) {
      out.push(dz(z) + (/[.,;:!?]$/.test(w) ? w.slice(-1) : ''));
    } else if (/^(ein|eine|einen|einem|einer)$/i.test(w) && ws[i + 2] && (einheit(ws[i + 2]) || /^(halb|einhalb)$/i.test(ws[i + 2]))) {
      out.push('1');
    } else out.push(w);
  }
  const e = d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return out.join('').replace(new RegExp(`(\\d+(?:${e}\\d+)?)\\s+komma\\s+(\\d+)`, 'gi'), `$1${d}$2`).replace(/(\d+)\s+(und\s+)?(ein)?halb\b/gi, (m, a) => dz(Number(a) + 0.5))
    .replace(new RegExp(`(\\d+)\\s+und\\s+0${e}5\\b`, 'g'), (m, a) => dz(Number(a) + 0.5));
}

function kandidaten(liste, art) {
  return liste.map((x) => {
    const eigen = new Set([...woerter(x.name), norm(x.code)].filter((w) => w.length >= 3 && !/^\d/.test(w)));
    const syn = new Set();
    for (const [schl, liste2] of Object.entries(SYNONYME[art])) {
      const passt = (x.code && norm(x.code).includes(schl)) || woerter(x.name).some((w) => w === schl || liste2.some((s) => w === norm(s))) || (x.gruppe && norm(x.gruppe).includes(schl));
      if (passt) for (const s of liste2) if (!eigen.has(norm(s))) syn.add(norm(s));
    }
    return { x, eigen: [...eigen], syn: [...syn] };
  });
}
function treffer(segment, kand) {
  const ws = woerter(segment);
  let best = [], bestScore = 0;
  for (const k of kand) {
    let score = 0;
    for (const n of k.eigen) {
      if (ws.includes(n)) score += 5;
      else if (n.length >= 5 && ws.some((w) => w.length >= 5 && (w.startsWith(n) || n.startsWith(w)))) score += 3;
    }
    for (const n of k.syn) if (ws.includes(n)) score += 2;
    if (score > bestScore) { bestScore = score; best = [k.x]; } else if (score === bestScore && score > 0) best.push(k.x);
  }
  return { best, score: bestScore };
}

/**
 * @param {string} text
 * @param {{geraete:Array<{id,code,name,gruppe}>, materialien:Array<{id,code,name,einheit}>, personen:Array<{id,name}>}} stamm
 */
const DEZ = '\uE000'; // Platzhalter für das Dezimalkomma in der Anzeige-Fassung (N-115)
function auswerten(text, stamm) {
  const roh = String(text || '').slice(0, 5000).replace(/\uE000/g, ' ');
  const t = zahlenNormalisieren(roh);
  // N-115: Freitext (Arbeitsleistung, Vorkommnisse, Regie) aus der Anzeige-Fassung – gleiche Länge und Trennstellen wie t,
  // aber das Dezimalkomma bleibt („28,5 lfm“, „1.234,00 EUR“); erkannt wird weiter mit t
  const anzeigeRoh = zahlenNormalisieren(roh, DEZ);
  const trenner = /[\n;!?]+|\.(?!\d)|,\s*(?=[a-zäöüA-ZÄÖÜ\d])|\s+und\s+(?=(?:der|die|das|dann|danach|außerdem|ausserdem|zusätzlich)\b|\d)/g;
  const segmente = [];
  {
    let von = 0, m;
    const stueck = (a, b) => { const x = t.slice(a, b).trim(); if (x) segmente.push([x, anzeigeRoh.slice(a, b).trim().replace(/\uE000/g, ',')]); };
    while ((m = trenner.exec(t))) { stueck(von, m.index); von = m.index + m[0].length; if (!m[0].length) trenner.lastIndex += 1; }
    stueck(von, t.length);
  }
  const kg = kandidaten(stamm.geraete || [], 'geraet');
  const km = kandidaten(stamm.materialien || [], 'material');
  const vorschlag = { geraete: [], material: [], personal: [], arbeitsleistung: '', vorkommnisse: '', regie: [] };
  const erkannt = [], unklar = [], arbeit = [], vork = [];
  const add = (liste, schl, eintrag, summe) => {
    const vorhanden = liste.find((x) => x[schl] === eintrag[schl] && (!eintrag.einheit || x.einheit === eintrag.einheit));
    if (vorhanden) vorhanden[summe] = Math.round((vorhanden[summe] + eintrag[summe]) * 1000) / 1000; else liste.push(eintrag);
  };
  for (const [seg, anzeige] of segmente) {
    const s = norm(seg);
    let verwendet = false;
    // Regie
    if (/\bregie\b/.test(s)) {
      const h = /(\d+(?:\.\d+)?)\s*(stunden?|std|h)\b/.exec(s);
      if (h) { vorschlag.regie.push({ text: anzeige.replace(/\s+/g, ' ').slice(0, 200), stunden: Number(h[1]) }); erkannt.push({ text: anzeige, art: 'regie', zuordnung: `${h[1]} Std.` }); continue; }
    }
    // Personen
    const personen = (stamm.personen || []).filter((p) => {
      const teile = woerter(p.name).filter((w) => w.length >= 3);
      return teile.length && teile.some((w) => woerter(seg).includes(w));
    });
    const zeit = /(?:von\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(?:uhr\s*)?bis\s+(\d{1,2})(?:[:.](\d{2}))?\s*uhr/.exec(s);
    const stundenAngabe = /(\d+(?:\.\d+)?)\s*(stunden|std|h)\b/.exec(s);
    // Mengen mit Einheit
    const mengen = [];
    const re = /(\d+(?:\.\d+)?)\s*([a-zäöü³²]+)/g;
    let m;
    while ((m = re.exec(s))) { const e = einheit(m[2]); if (e) mengen.push({ menge: Number(m[1]), einheit: e }); }
    const g = treffer(seg, kg);
    const ma = treffer(seg, km);
    const stundenMenge = mengen.find((x) => x.einheit === 'Std.');
    if (personen.length && (zeit || (stundenAngabe && g.score < 2))) {
      for (const p of personen) {
        const e = { benutzerId: p.id, name: p.name };
        if (zeit) { e.von = `${zeit[1].padStart(2, '0')}:${zeit[2] || '00'}`; e.bis = `${zeit[3].padStart(2, '0')}:${zeit[4] || '00'}`; }
        if (stundenAngabe) e.stunden = Number(stundenAngabe[1]);
        vorschlag.personal.push(e);
        erkannt.push({ text: seg, art: 'personal', zuordnung: p.name });
      }
      verwendet = true;
    }
    if (g.score >= 2 && stundenMenge) {
      if (g.best.length === 1) {
        add(vorschlag.geraete, 'geraetId', { geraetId: g.best[0].id, code: g.best[0].code, name: g.best[0].name, stunden: stundenMenge.menge }, 'stunden');
        erkannt.push({ text: seg, art: 'geraet', zuordnung: `${g.best[0].name}: ${stundenMenge.menge} Std.` });
      } else unklar.push(`${seg} – mehrere Geräte passen (${g.best.map((x) => x.name).join(', ')})`);
      verwendet = true;
    }
    const mengeMat = mengen.find((x) => x.einheit !== 'Std.');
    if (ma.score >= 2 && mengeMat) {
      if (ma.best.length === 1) {
        const mat = ma.best[0];
        add(vorschlag.material, 'materialId', { materialId: mat.id, code: mat.code, name: mat.name, menge: mengeMat.menge, einheit: mengeMat.einheit === 't' && /^to$/i.test(mat.einheit) ? mat.einheit : mengeMat.einheit }, 'menge');
        if (mat.einheit && norm(mat.einheit).replace('to', 't').replace('³', '3') !== norm(mengeMat.einheit).replace('³', '3') && !(mengeMat.einheit === 't' && /^to?$/i.test(mat.einheit))) {
          unklar.push(`${seg} – Einheit ${mengeMat.einheit} passt nicht zu ${mat.name} (${mat.einheit})`);
        }
        erkannt.push({ text: seg, art: 'material', zuordnung: `${mat.name}: ${mengeMat.menge} ${mengeMat.einheit}` });
      } else unklar.push(`${seg} – mehrere Materialien passen (${ma.best.map((x) => x.name).join(', ')})`);
      verwendet = true;
    } else if (mengeMat && !verwendet && ma.score < 2 && g.score < 2) {
      unklar.push(`${seg} – Menge ${mengeMat.menge} ${mengeMat.einheit} ohne erkanntes Material`);
    }
    if (!verwendet) {
      if (/^(vorkommnis|problem|unfall|behinderung|störung|stoerung|achtung|hinweis)/.test(s)) vork.push(anzeige.replace(/^(vorkommnis(se)?|hinweis)\s*:?\s*/i, ''));
      else if (!/^\s*(und|dann|ok|okay)\s*$/.test(s)) arbeit.push(anzeige);
    }
  }
  const satz = (x) => x.map((y) => y.charAt(0).toUpperCase() + y.slice(1)).join('. ').replace(/\s+/g, ' ').trim();
  vorschlag.arbeitsleistung = arbeit.length ? `${satz(arbeit)}.` : '';
  vorschlag.vorkommnisse = vork.length ? `${satz(vork)}.` : '';
  return { vorschlag, erkannt, unklar, quelle: 'regeln' };
}

module.exports = { zahlwort, zahlenNormalisieren, einheit, auswerten, SYNONYME };
