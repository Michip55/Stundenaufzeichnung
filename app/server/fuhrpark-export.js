'use strict';
/**
 * Servicebuch – CSV-Exporte und Servicebuch-PDF je Anlage. Standard ohne €; Kosten nur, wenn ausdrücklich
 * angefordert UND das Recht preise_sehen geprüft wurde (Aufrufer).
 */
const PDFDocument = require('pdfkit');
const { csv } = require('./export');
const { winAnsi } = require('./pdf');
const { deDatum, wienDatum } = require('./datum');
const F = require('./fuhrpark');
const D = require('./fuhrpark-daten');

const STATUS_TEXT = { ok: 'ok', bald: 'bald', faellig: 'fällig', ueberfaellig: 'überfällig', unvollstaendig: 'unvollständig', erledigt: 'erledigt',
  einsatzbereit: 'einsatzbereit', gesperrt: 'gesperrt', ausgeschieden: 'ausgeschieden' };
const EINTRAG_ART = { service: 'Service', reparatur: 'Reparatur', pruefung: 'Prüfung', reifen: 'Reifen', sonstiges: 'Sonstiges' };
const PRUEF_TEXT = { ohne_maengel: 'ohne Mängel', leichte_maengel: 'leichte Mängel', schwere_maengel: 'schwere Mängel' };
const PLAN_ART = { gesetzlich: 'gesetzlich', hersteller: 'Hersteller', intern: 'intern', vertrag: 'Vertrag' };
const KLASSE = { pkw: 'PKW', bus: 'Bus', lkw: 'LKW', anhaenger: 'Anhänger', baumaschine: 'Baumaschine', walze: 'Walze', brecher: 'Brecher', kleingeraet: 'Kleingerät', sonstiges: 'Sonstiges' };
const zw = (x) => (x && x.wert !== undefined ? `${F.zahlDe(x.wert, 0)} ${F.EINHEIT[x.art]}` : '');
const kostenCtx = (kosten) => ({ hat: (r) => kosten && r === 'preise_sehen', benutzer: { id: 0, rolle: 'system' } });

function eintraegeFuer(db, { anlageId, von, bis }) {
  const w = [], p = [];
  if (anlageId) { w.push('anlage_id = ?'); p.push(anlageId); }
  if (von) { w.push('datum >= ?'); p.push(von); }
  if (bis) { w.push('datum <= ?'); p.push(bis); }
  return db.alle(`SELECT * FROM servicebuch_eintrag ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY datum, id`, ...p);
}

function csvExport(db, S, { art, von, bis, kosten, rechnung = kosten }) {
  const z = [];
  if (art === 'fristen') {
    z.push(['Anlage-Nr.', 'Bezeichnung', 'Kennzeichen', 'Klasse', 'Termin', 'Art', 'Status', 'Nächstes Datum', 'Fällig am', 'Spätestens', 'Fällig bei', 'Rest', 'Voraussichtlich', 'Grund', 'Vorlage prüfen']);
    for (const { A, P } of D.fristen(S, { bis: bis || F.plusMonate(S.H, 12) })) {
      const c = P.calc;
      z.push([A.row.nummer, A.row.bezeichnung, A.row.kennzeichen, KLASSE[A.row.klasse], P.row.titel, PLAN_ART[P.row.art], STATUS_TEXT[c.status], deDatum(c.naechstesDatum),
        deDatum(c.faelligAm), deDatum(c.spaetestens), zw(c.faelligBei), zw(c.rest), deDatum(c.prognoseAm), c.grund || '', P.row.vorlage_pruefen === 1 ? 'ja' : '']);
    }
  } else if (art === 'eintraege') {
    // Rechnungsnr. der Werkstatt nur mit preise_sehen (14.11.2026)
    const kopf = ['Datum', 'Anlage-Nr.', 'Bezeichnung', 'Kennzeichen', 'Art', 'Titel', 'Werkstatt', 'Arbeiten', 'Teile', 'Arbeitsstunden intern', ...(rechnung ? ['Rechnungsnr.'] : []), 'Prüfergebnis', 'Prüfer', 'Zählerstände', 'Erledigt', 'Storniert'];
    if (kosten) kopf.push('Kosten netto');
    z.push(kopf);
    const ctx = kostenCtx(kosten);
    for (const e of eintraegeFuer(db, { von, bis })) {
      const j = D.eintragJson(db, e, S, ctx);
      const zeile = [deDatum(e.datum), j.anlage && j.anlage.nummer, j.anlage && j.anlage.bezeichnung, j.anlage && j.anlage.kennzeichen, EINTRAG_ART[e.art], e.titel, e.werkstatt, e.arbeiten, e.teile,
        e.arbeitsstunden_intern, ...(rechnung ? [e.rechnung_nr] : []), PRUEF_TEXT[e.pruef_ergebnis] || '', e.pruefer, j.zaehler.map((x) => `${F.zahlDe(x.anzeige, 0)} ${F.EINHEIT[x.art]}`).join(', '),
        j.erledigt.map((x) => x.titel).join(', '), e.storniert ? `storniert: ${e.storno_grund || ''}` : ''];
      if (kosten) zeile.push(e.kosten);
      z.push(zeile);
    }
  } else {
    const kopf = ['Anlage-Nr.', 'Bezeichnung', 'Klasse', 'Fahrzeugklasse', 'Hersteller', 'Typ', 'Kennzeichen', 'FIN/Seriennr.', 'Baujahr', 'Erstzulassung', 'Eigentum', 'Vertragsende', 'Standort', 'Verantwortlich', 'Status', 'Sperrgründe', 'Nächster Termin', 'Termin-Datum', 'Zählerstände', 'Offene Mängel/Schäden'];
    if (kosten) kopf.push(von || bis ? 'Kosten netto (Zeitraum)' : 'Kosten netto (lfd. Jahr)');
    z.push(kopf);
    let zeitraum = null;
    if (kosten && (von || bis)) {
      zeitraum = new Map();
      for (const e of eintraegeFuer(db, { von, bis })) if (!e.storniert && e.kosten != null) zeitraum.set(e.anlage_id, Math.round(((zeitraum.get(e.anlage_id) || 0) + e.kosten) * 100) / 100);
    }
    const k = kosten ? D.ladeKosten(db, S.H) : null;
    for (const A of S.liste) {
      const a = A.row, n = A.naechste[0];
      const zeile = [a.nummer, a.bezeichnung, KLASSE[a.klasse], a.fahrzeugklasse, a.hersteller, a.typ, a.kennzeichen, a.fin, a.baujahr, deDatum(a.erstzulassung), a.eigentum, deDatum(a.vertragsende),
        A.standort.text, a.verantwortlich_id ? S.namen.get(a.verantwortlich_id) : '', STATUS_TEXT[A.status.status], A.status.sperrGruende.map((g) => g.text).join('; '),
        n ? n.row.titel : '', n ? deDatum(n.calc.naechstesDatum) : '', A.zaehler.filter((x) => x.row.aktiv).map((x) => `${F.zahlDe(x.info.aktuell, 0)} ${F.EINHEIT[x.row.art]}${x.info.geschaetzt ? ' (geschätzt)' : ''}`).join(', '),
        A.maengel.length];
      if (kosten) zeile.push(zeitraum ? zeitraum.get(a.id) || 0 : k.jahr.get(a.id) || 0);
      z.push(zeile);
    }
  }
  return csv(z);
}

/** Servicebuch-PDF einer Anlage (pdfkit, Standardschrift) */
function servicebuchPdf(db, S, A, { kosten = false, firma, unkomprimiert = false, texte = [], ctx: sicht = null } = {}) {
  const a = A.row;
  const doc = new PDFDocument({ size: 'A4', margin: 40, compress: !unkomprimiert, info: { Title: `Servicebuch ${a.bezeichnung}`, Author: firma.name, Creator: 'BauTag' } });
  const teile = [];
  doc.on('data', (c) => teile.push(c));
  const fertig = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(teile))); doc.on('error', reject); });
  const X0 = 40, B = 515, UNTEN = 800;
  const t = (s, x, y, o = {}) => {
    const str = winAnsi(s);
    texte.push(str);
    doc.font(o.fett ? 'Helvetica-Bold' : 'Helvetica').fontSize(o.gr || 8.5).fillColor(o.farbe || '#000').text(str, x, y, { width: o.b, lineBreak: Boolean(o.umbruch), ellipsis: o.umbruch ? undefined : true });
  };
  let y = 40;
  const platz = (h) => { if (y + h > UNTEN) { doc.addPage(); y = 40; } };
  const titel = (s) => { platz(30); y += 8; t(s, X0, y, { fett: true, gr: 11 }); y += 16; doc.moveTo(X0, y - 3).lineTo(X0 + B, y - 3).lineWidth(0.5).stroke('#888'); };
  const zeile = (spalten, fett = false) => {
    let h = 12;
    for (const [s, , b] of spalten) { const hh = doc.font(fett ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).heightOfString(winAnsi(s), { width: b }); h = Math.max(h, hh + 3); }
    platz(h);
    for (const [s, x, b] of spalten) t(s, x, y, { b, fett, umbruch: true });
    y += h;
  };

  t(firma.name, X0, y, { fett: true, gr: 10 }); t(`Stand ${deDatum(S.H)}`, X0 + 300, y, { b: 215, gr: 8.5 }); y += 16;
  t(`Servicebuch: ${a.bezeichnung}`, X0, y, { fett: true, gr: 15 }); y += 22;
  const kopf = [
    ['Anlagen-Nr.', a.nummer], ['Kennzeichen', a.kennzeichen], ['FIN / Seriennr.', a.fin], ['Klasse', `${KLASSE[a.klasse]}${a.fahrzeugklasse ? ' ' + a.fahrzeugklasse : ''}`],
    ['Hersteller / Typ', [a.hersteller, a.typ].filter(Boolean).join(' ')], ['Baujahr', a.baujahr], ['Erstzulassung', deDatum(a.erstzulassung)], ['Status', STATUS_TEXT[A.status.status] + (A.status.gesperrt ? ` – ${A.status.sperrGruende.map((g) => g.text).join('; ')}` : '')],
    ['Standort', A.standort.text], ['Verantwortlich', a.verantwortlich_id ? S.namen.get(a.verantwortlich_id) : '']
  ];
  for (let i = 0; i < kopf.length; i += 2) {
    for (let j = 0; j < 2 && i + j < kopf.length; j++) {
      const [k, w] = kopf[i + j];
      t(k, X0 + j * 260, y, { gr: 7.5, farbe: '#555' }); t(w == null || w === '' ? '–' : String(w), X0 + j * 260 + 80, y, { b: 175 });
    }
    y += 13;
  }

  titel('Fristen und Termine');
  zeile([['Termin', X0, 170], ['Art', X0 + 175, 60], ['Status', X0 + 240, 65], ['Nächstes Datum', X0 + 310, 75], ['Fällig bei / Rest', X0 + 390, 125]], true);
  for (const P of A.positionen.filter((p) => p.row.aktiv)) {
    const c = P.calc;
    zeile([[P.row.titel + (P.row.vorlage_pruefen === 1 ? ' (Vorlage prüfen)' : ''), X0, 170], [PLAN_ART[P.row.art], X0 + 175, 60], [STATUS_TEXT[c.status], X0 + 240, 65],
      [deDatum(c.naechstesDatum) || '–', X0 + 310, 75], [c.faelligBei ? `${zw(c.faelligBei)} / Rest ${zw(c.rest)}` : (c.hinweis || ''), X0 + 390, 125]]);
  }
  if (!A.positionen.some((p) => p.row.aktiv)) zeile([['Keine Planpositionen.', X0, 300]]);

  titel('Zählerstände');
  for (const z of A.zaehler) {
    zeile([[F.ZAEHLER_NAME[z.row.art] + (z.row.aktiv ? '' : ' (inaktiv)'), X0, 120], [`${F.zahlDe(z.info.aktuell, 0)} ${F.EINHEIT[z.row.art]}${z.info.geschaetzt ? ' (geschätzt)' : ''}`, X0 + 125, 110],
      [`Ablesung ${F.zahlDe(z.info.letzterStand.anzeige, 0)} am ${deDatum(z.info.letzterStand.datum)}`, X0 + 240, 150], [z.info.wochenschnitt != null ? `Ø ${F.zahlDe(z.info.wochenschnitt)} je Woche` : '', X0 + 395, 120]]);
  }
  if (!A.zaehler.length) zeile([['Kein Zähler.', X0, 300]]);

  titel('Servicebuch-Einträge');
  const ctx = kostenCtx(kosten);
  const kopfE = [['Datum', X0, 55], ['Art', X0 + 58, 55], ['Arbeiten', X0 + 116, kosten ? 230 : 290], ['Werkstatt / Zähler', X0 + (kosten ? 350 : 410), kosten ? 105 : 105]];
  if (kosten) kopfE.push(['Kosten netto', X0 + 458, 57]);
  zeile(kopfE, true);
  const eintraege = eintraegeFuer(db, { anlageId: a.id });
  for (const e of eintraege) {
    const j = D.eintragJson(db, e, S, ctx);
    const text = [e.titel, e.arbeiten, e.teile ? `Teile: ${e.teile}` : '', e.pruef_ergebnis ? `Prüfergebnis: ${PRUEF_TEXT[e.pruef_ergebnis]}${e.pruefer ? ' (' + e.pruefer + ')' : ''}` : '',
      j.erledigt.length ? `Erledigt: ${j.erledigt.map((x) => x.titel).join(', ')}` : '', e.storniert ? `STORNIERT: ${e.storno_grund || ''}` : ''].filter(Boolean).join('\n');
    const sp = [[deDatum(e.datum), X0, 55], [EINTRAG_ART[e.art], X0 + 58, 55], [text, X0 + 116, kosten ? 230 : 290],
      [[e.werkstatt, j.zaehler.map((x) => `${F.zahlDe(x.anzeige, 0)} ${F.EINHEIT[x.art]}`).join(', ')].filter(Boolean).join('\n'), X0 + (kosten ? 350 : 410), 105]];
    if (kosten) sp.push([e.kosten == null ? '' : `${F.zahlDe(e.kosten, 2)} €`, X0 + 458, 57]);
    zeile(sp);
  }
  if (!eintraege.length) zeile([['Noch keine Einträge.', X0, 300]]);
  if (kosten) {
    const k = D.ladeKosten(db, S.H);
    y += 4; zeile([[`Summe Kosten netto: ${F.zahlDe(k.gesamt.get(a.id) || 0, 2)} € (lfd. Jahr ${F.zahlDe(k.jahr.get(a.id) || 0, 2)} €)`, X0, 400]], true);
  }

  titel('Offene Mängel und Schäden');
  // F-13: Schäden nur im Sichtbereich des Anfragenden (Ursache, Melder)
  const cache = {};
  const offen = db.alle("SELECT * FROM mangel WHERE anlage_id = ? AND status IN ('offen','in_arbeit') ORDER BY gemeldet", a.id)
    .filter((m) => m.typ !== 'schaden' || !sicht || D.schadenSichtbar(db, sicht, m, cache));
  for (const m of offen) {
    zeile([[deDatum(wienDatum(m.gemeldet)), X0, 55], [m.typ === 'schaden' ? 'Schaden' : 'Mangel', X0 + 58, 55], [m.text, X0 + 116, 290], [`${m.dringlichkeit === 'sofort' ? 'stillgelegt' : m.dringlichkeit}, ${S.namen.get(m.gemeldet_von) || ''}`, X0 + 410, 105]]);
  }
  if (!offen.length) zeile([['Keine offenen Mängel.', X0, 300]]);
  y += 10; platz(14);
  t(kosten ? 'Fassung mit Kosten (intern).' : 'Fassung ohne Kosten.', X0, y, { gr: 7, farbe: '#666' });
  doc.end();
  return fertig;
}

module.exports = { csvExport, servicebuchPdf };
