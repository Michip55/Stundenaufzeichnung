'use strict';
/**
 * Wetter (API.md 12.4) – Adapter für den GeoSphere Austria Data Hub (ohne Schlüssel).
 *
 * Schnittstelle des Adapters: `holeStunden(bt, {lat, lng, datum, heute})` → `{datensatz, stunden:[{zeit:"HH:MM", temperatur °C,
 * niederschlag mm/h, wind km/h, boeen? km/h}]}` (Wiener Ortszeit des Tages). Quellen:
 *   - Tag ≥ heute: Vorhersage `nwp-v1-1h-2500m` (t2m, rr_acc kumuliert, u10m/v10m, ugust/vgust)
 *   - vergangene Tage: Analyse `inca-v1-1h-1km` (T2M, RR je Stunde, UU/VV)
 * Antwortformat (GeoJSON): `{timestamps:[ISO], features:[{properties:{parameters:{<p>:{data:[…]}}}}]}`.
 * Der HTTP-Abruf ist austauschbar (`bt.wetterAbruf(url)` → JSON) – Tests rufen nie live ab.
 */
const { wienDatum, wienZeit, plusTage } = require('./datum');

const BASIS = 'https://dataset.api.hub.geosphere.at/v1/timeseries';
const QUELLE = 'GeoSphere Austria – Data Hub (CC BY 4.0)';
const REGELN = [
  'Hitze: über 32,5 °C (Stunde)',
  'Niederschlag: ab 1 mm in der Stunde',
  'Sturm: Wind ab 60 km/h',
  'Kälte: −10 °C oder darunter',
  'Nur Stunden 06:00–18:00; Grenzwerte bei der BUAK bestätigen (Prüfen) – entscheiden muss der Arbeitgeber (§ 5 BSchEG).'
];

const r1 = (x) => Math.round(x * 10) / 10;
const kmh = (u, v) => (u == null || v == null ? null : r1(Math.sqrt(u * u + v * v) * 3.6));

async function abruf(bt, url) {
  if (typeof bt.wetterAbruf === 'function') return bt.wetterAbruf(url);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json', 'user-agent': 'BauTag/1.0' } });
    if (!r.ok) throw new Error(`GeoSphere antwortet ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/** GeoJSON → [{zeitIso, werte:{param: wert}}] */
function reihen(json) {
  const ts = Array.isArray(json && json.timestamps) ? json.timestamps : [];
  const f = json && Array.isArray(json.features) && json.features[0];
  const p = (f && f.properties && f.properties.parameters) || {};
  return ts.map((t, i) => {
    const werte = {};
    for (const [k, v] of Object.entries(p)) {
      const x = v && Array.isArray(v.data) ? v.data[i] : null;
      werte[k.toLowerCase()] = typeof x === 'number' && Number.isFinite(x) ? x : null;
    }
    return { zeit: new Date(t), werte };
  }).filter((z) => !Number.isNaN(z.zeit.getTime()));
}

/** Testdaten (BAUTAG_TEST): fest aus Koordinaten/Datum; Regen um 13:00, wenn lat auf .5 endet */
function testStunden(lat, lng, datum) {
  const regen = Math.round(lat * 10) % 10 === 5;
  const basis = 8 + (Number(datum.slice(8, 10)) % 7);
  const stunden = [];
  for (let h = 0; h < 24; h++) {
    stunden.push({ zeit: `${String(h).padStart(2, '0')}:00`, temperatur: r1(basis + 6 * Math.sin(((h - 8) / 24) * Math.PI)), niederschlag: regen && h === 13 ? 2.4 : 0, wind: 12 + (h % 5) });
  }
  return { datensatz: 'test', stunden };
}

async function holeStunden(bt, { lat, lng, datum, heute }) {
  if (bt.test) {
    if (bt.testVorgaben.wetterAus) throw new Error('Wetterdienst (Test) nicht verfügbar');
    return testStunden(lat, lng, datum);
  }
  const ll = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  let liste, datensatz;
  if (datum >= heute) {
    datensatz = 'nwp-v1-1h-2500m';
    const url = `${BASIS}/forecast/${datensatz}?lat_lon=${ll}&parameters=t2m&parameters=rr_acc&parameters=u10m&parameters=v10m&parameters=ugust&parameters=vgust&output_format=geojson`;
    const z = reihen(await abruf(bt, url));
    let vorher = null;
    liste = z.map((x) => {
      const acc = x.werte.rr_acc;
      const rr = acc == null ? null : vorher == null ? 0 : Math.max(0, acc - vorher);
      if (acc != null) vorher = acc;
      return { zeit: x.zeit, temperatur: x.werte.t2m, niederschlag: rr, wind: kmh(x.werte.u10m, x.werte.v10m), boeen: kmh(x.werte.ugust, x.werte.vgust) };
    });
  } else {
    datensatz = 'inca-v1-1h-1km';
    const url = `${BASIS}/historical/${datensatz}?lat_lon=${ll}&parameters=T2M&parameters=RR&parameters=UU&parameters=VV&start=${plusTage(datum, -1)}T22:00&end=${datum}T23:00&output_format=geojson`;
    liste = reihen(await abruf(bt, url)).map((x) => ({ zeit: x.zeit, temperatur: x.werte.t2m, niederschlag: x.werte.rr, wind: kmh(x.werte.uu, x.werte.vv) }));
  }
  const stunden = liste.filter((x) => wienDatum(x.zeit) === datum).map((x) => ({
    zeit: wienZeit(x.zeit), temperatur: x.temperatur == null ? null : r1(x.temperatur), niederschlag: x.niederschlag == null ? null : r1(x.niederschlag),
    wind: x.wind, ...(x.boeen != null ? { boeen: x.boeen } : {})
  }));
  if (!stunden.length) throw new Error('Keine Werte für diesen Tag');
  return { datensatz, stunden };
}

/** Zusammenfassung und Schlechtwetter-Vorschlag */
function auswerten(stunden) {
  const tag = stunden.filter((s) => s.zeit >= '06:00' && s.zeit <= '18:00');
  const zahlen = (k, liste = stunden) => liste.map((s) => s[k]).filter((x) => typeof x === 'number');
  const t = zahlen('temperatur', tag.length ? tag : stunden);
  const nied = r1(zahlen('niederschlag').reduce((a, x) => a + x, 0));
  const wind = zahlen('wind', tag.length ? tag : stunden);
  const tMin = t.length ? Math.min(...t) : null, tMax = t.length ? Math.max(...t) : null;
  const windMax = wind.length ? Math.max(...wind) : null;
  const gruende = [];
  let ab = null;
  for (const s of tag) {
    const g = [];
    if (s.temperatur != null && s.temperatur > 32.5) g.push(`Hitze ${String(s.temperatur).replace('.', ',')} °C`);
    if (s.niederschlag != null && s.niederschlag >= 1) g.push(`Niederschlag ${String(s.niederschlag).replace('.', ',')} mm`);
    if (s.wind != null && s.wind >= 60) g.push(`Wind ${Math.round(s.wind)} km/h`);
    if (s.temperatur != null && s.temperatur <= -10) g.push(`Kälte ${String(s.temperatur).replace('.', ',')} °C`);
    if (g.length) { if (!ab) ab = s.zeit; gruende.push(`${s.zeit}: ${g.join(', ')}`); }
  }
  const de = (x) => String(x).replace('.', ',');
  const art = nied >= 5 ? 'Regen' : nied >= 0.5 ? 'zeitweise Regen' : 'trocken';
  const text = [art, tMin != null ? `${de(r1(tMin))}–${de(r1(tMax))} °C` : null, nied ? `${de(nied)} mm` : null, windMax != null ? `Wind bis ${Math.round(windMax)} km/h` : null].filter(Boolean).join(', ');
  return {
    zusammenfassung: { text, temperatur: tMax != null ? r1((tMin + tMax) / 2) : null, temperaturMin: tMin != null ? r1(tMin) : null, temperaturMax: tMax != null ? r1(tMax) : null, niederschlag: nied, wind: windMax != null ? Math.round(windMax) : null },
    schlechtwetter: { vorschlag: Boolean(ab), ab, gruende, pruefen: true, regeln: REGELN }
  };
}

/**
 * Wetter einer Baustelle am Datum (mit Zwischenspeicher je Baustelle/Datum/Stunde; Fehler 10 min gemerkt).
 * @returns {Promise<object>} Antwort laut API.md 12.4
 */
async function wetterFuer(bt, bs, datum) {
  const { db } = bt;
  const nicht = (grund) => ({ verfuegbar: false, hinweis: 'Wetter nicht verfügbar', grund });
  if (!bt.wetterAn) return nicht('Wetterabruf ist abgeschaltet (BAUTAG_WETTER=0).');
  if (bs.lat == null || bs.lng == null) return nicht('Für die Baustelle sind keine Koordinaten hinterlegt.');
  const jetzt = bt.uhr();
  const heute = wienDatum(jetzt);
  if (datum > plusTage(heute, 9)) return nicht('Vorhersage nur bis 9 Tage im Voraus.');
  if (datum < plusTage(heute, -366)) return nicht('Wetterdaten nur für das letzte Jahr.');
  const z = db.eins('SELECT * FROM wetter_cache WHERE baustelle_id = ? AND datum = ?', bs.id, datum);
  const gleicheStelle = z && z.lat === bs.lat && z.lng === bs.lng;
  const alterMin = z ? (jetzt - new Date(z.abgerufen)) / 60000 : Infinity;
  // vergangene Tage ändern sich nicht mehr; heute/Zukunft: je Stunde neu; Fehler: 10 min
  const frisch = gleicheStelle && (z.fehler ? alterMin < 10 : datum < heute && z.abgerufen.slice(0, 10) > datum ? true : z.abgerufen.slice(0, 13) === jetzt.toISOString().slice(0, 13));
  let daten;
  if (frisch) {
    if (z.fehler) return nicht(z.fehler);
    daten = JSON.parse(z.daten);
  } else {
    try {
      daten = await holeStunden(bt, { lat: bs.lat, lng: bs.lng, datum, heute });
      daten.abgerufen = jetzt.toISOString();
      db.lauf(`INSERT INTO wetter_cache (baustelle_id, datum, abgerufen, lat, lng, daten, fehler) VALUES (?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(baustelle_id, datum) DO UPDATE SET abgerufen = excluded.abgerufen, lat = excluded.lat, lng = excluded.lng, daten = excluded.daten, fehler = NULL`,
      bs.id, datum, jetzt.toISOString(), bs.lat, bs.lng, JSON.stringify(daten));
    } catch (e) {
      const grund = `Abruf gescheitert: ${String(e.message || e).slice(0, 150)}`;
      db.lauf(`INSERT INTO wetter_cache (baustelle_id, datum, abgerufen, lat, lng, daten, fehler) VALUES (?, ?, ?, ?, ?, NULL, ?)
        ON CONFLICT(baustelle_id, datum) DO UPDATE SET abgerufen = excluded.abgerufen, lat = excluded.lat, lng = excluded.lng, fehler = excluded.fehler`,
      bs.id, datum, jetzt.toISOString(), bs.lat, bs.lng, grund);
      return nicht(grund);
    }
  }
  return { verfuegbar: true, datum, quelle: QUELLE, datensatz: daten.datensatz, abgerufen: daten.abgerufen, stunden: daten.stunden, ...auswerten(daten.stunden) };
}

/** Nur aus dem Zwischenspeicher (für Bericht-JSON ohne Abruf) */
function wetterAusCache(db, bs, datum) {
  const z = db.eins('SELECT * FROM wetter_cache WHERE baustelle_id = ? AND datum = ? AND fehler IS NULL', bs.id, datum);
  if (!z || !z.daten) return null;
  return auswerten(JSON.parse(z.daten).stunden);
}

/** Wetter-Objekt für den Bericht */
function berichtWetter(w) {
  const z = w.zusammenfassung;
  return { text: z.text, temperatur: z.temperatur, niederschlag: z.niederschlag, wind: z.wind, quelle: 'GeoSphere Austria' };
}

module.exports = { wetterFuer, wetterAusCache, berichtWetter, auswerten, reihen, holeStunden, QUELLE, REGELN };
