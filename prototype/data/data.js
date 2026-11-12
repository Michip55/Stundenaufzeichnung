/* Demo-Stammdaten – ausschließlich fiktive Beispielwerte (Stand: Entwurf November 2026) */
(function () {
  'use strict';

  const HEUTE = '2026-11-12';

  const lohngruppen = [
    { id: 'pol', name: 'Polier', kv: 'Polier · Angestellte Bau A3', kosten: 58.0, vk: 74.0 },
    { id: 'va', name: 'Vorarbeiter', kv: 'KV Bau · Lohngruppe IIa', kosten: 49.5, vk: 66.0 },
    { id: 'fa', name: 'Facharbeiter / Pflasterer', kv: 'KV Bau · Lohngruppe IIb', kosten: 46.0, vk: 62.0 },
    { id: 'ma', name: 'Maschinist', kv: 'KV Bau · Lohngruppe IIb', kosten: 47.0, vk: 63.0 },
    { id: 'lkw', name: 'LKW-Fahrer', kv: 'KV Güterbeförderung', kosten: 44.0, vk: 58.0 },
    { id: 'hi', name: 'Hilfsarbeiter', kv: 'KV Bau · Lohngruppe IV', kosten: 39.5, vk: 52.0 },
    { id: 'le', name: 'Lehrling', kv: 'KV Bau · 2. Lehrjahr', kosten: 19.0, vk: 34.0 }
  ];

  // Reihenfolge exakt wie auf der Papiervorlage (linke Spalte, dann rechte Spalte)
  const geraete = [
    { id: 'kran3', name: 'LKW mit Kran 3-A', kat: 'LKW', kosten: 52, vk: 78 },
    { id: 'kran4', name: 'LKW mit Kran 4-A', kat: 'LKW', kosten: 58, vk: 86 },
    { id: 'lkw2', name: 'LKW 2-Achser', kat: 'LKW', kosten: 38, vk: 58 },
    { id: 'lkw3', name: 'LKW 3-Achser', kat: 'LKW', kosten: 46, vk: 68 },
    { id: 'lkw4', name: 'LKW 4-Achser', kat: 'LKW', kosten: 52, vk: 76 },
    { id: 'sattel', name: 'LKW Zug oder Sattel', kat: 'LKW', kosten: 60, vk: 88 },
    { id: 'tieflader', name: 'LKW mit Tieflader', kat: 'LKW', kosten: 64, vk: 95 },
    { id: 'verlege', name: 'Verlegemaschine', kat: 'Pflasterung', kosten: 24, vk: 42 },
    { id: 'schneid', name: 'Schneidgerät', kat: 'Pflasterung', kosten: 9, vk: 18 },
    { id: 'kompressor', name: 'Kompressor', kat: 'Kleingerät', kosten: 12, vk: 22 },
    { id: 'dumper', name: 'Dumper', kat: 'Erdbau', kosten: 18, vk: 32 },
    { id: 'bobcat', name: 'Bobcat', kat: 'Erdbau', kosten: 22, vk: 38 },
    { id: 'b15', name: 'Bagger 1,5 to.', kat: 'Bagger', kosten: 16, vk: 29 },
    { id: 'b27', name: 'Bagger 2,7 to.', kat: 'Bagger', kosten: 19, vk: 34 },
    { id: 'b9', name: 'Bagger 9 to.', kat: 'Bagger', kosten: 34, vk: 56 },
    { id: 'b23', name: 'Bagger 23 to.', kat: 'Bagger', kosten: 58, vk: 92 },
    { id: 'radlader', name: 'Radlader', kat: 'Erdbau', kosten: 36, vk: 58 },
    { id: 'graeder', name: 'Gräder', kat: 'Erdbau', kosten: 48, vk: 78 },
    { id: 'bomag', name: 'Bomag BW 177', kat: 'Verdichtung', kosten: 32, vk: 52 },
    { id: 'hamm', name: 'Hamm Walz 2 to.', kat: 'Verdichtung', kosten: 18, vk: 30 },
    { id: 'handwalze', name: 'Handwalze', kat: 'Verdichtung', kosten: 9, vk: 16 },
    { id: 'ruettel', name: 'Rüttelplatte', kat: 'Verdichtung', kosten: 7, vk: 14 },
    { id: 'grabenwalze', name: 'Grabenwalze', kat: 'Verdichtung', kosten: 14, vk: 24 }
  ];

  const material = [
    // Vorlage
    { id: 'aushub', name: 'Aushub', einheit: 'to', alt: 'm3', vorlage: true, ek: 9.5, vk: 16.0, hinweis: 'Deponie / Verfuhr' },
    { id: 'betonbruch', name: 'Betonbruch', einheit: 'to', alt: 'm3', vorlage: true, ek: 14.0, vk: 22.0, hinweis: 'Entsorgung' },
    { id: 'asphaltbruch', name: 'Asphaltbruch', einheit: 'to', alt: 'm3', vorlage: true, ek: 18.0, vk: 28.0, hinweis: 'Entsorgung' },
    { id: 'frostschutz', name: 'Frostschutz', einheit: 'to', vorlage: true, ek: 13.8, vk: 21.5, hinweis: 'KK 0/63 · Kieswerk Breitenau' },
    { id: 'graeder', name: 'Grädermaterial', einheit: 'to', vorlage: true, ek: 15.2, vk: 23.5, hinweis: 'KK 0/32' },
    { id: 'splitt', name: 'Splitt', einheit: 'to', vorlage: true, ek: 24.5, vk: 36.0, hinweis: 'Körnung 2/4' },
    // Zusatzmaterial (Materialbeistellung)
    { id: 'pflaster8', name: 'Betonsteinpflaster 8 cm grau', einheit: 'm²', ek: 16.9, vk: 24.5, hinweis: 'Weissenböck, Rechteck 20/10' },
    { id: 'randstein', name: 'Randleiste 8/25/100', einheit: 'lfm', ek: 6.4, vk: 9.8, hinweis: '' },
    { id: 'beton', name: 'Beton C20/25 erdfeucht', einheit: 'm³', ek: 112.0, vk: 148.0, hinweis: 'Lieferbeton' },
    { id: 'asphalt', name: 'Asphalt AC 11 deck', einheit: 'to', ek: 96.0, vk: 128.0, hinweis: 'ab Mischwerk' },
    { id: 'rohr150', name: 'Kanalrohr PVC DN 150', einheit: 'lfm', ek: 11.8, vk: 17.5, hinweis: '' }
  ];

  const leistungen = [
    { id: 'be', nr: '01.01', name: 'Baustelleneinrichtung und -räumung', einheit: 'PA', ep: 2850.0 },
    { id: 'aushub', nr: '02.01', name: 'Aushub BKL 3–5 inkl. Verfuhr und Deponie', einheit: 'm³', ep: 24.8 },
    { id: 'frost', nr: '02.04', name: 'Frostschutzschicht 30 cm liefern, einbauen, verdichten', einheit: 'm²', ep: 14.6 },
    { id: 'planum', name: 'Feinplanum herstellen', nr: '02.06', einheit: 'm²', ep: 2.9 },
    { id: 'pflaster', nr: '03.01', name: 'Betonsteinpflaster 8 cm verlegen inkl. Splittbett', einheit: 'm²', ep: 68.5 },
    { id: 'rand', nr: '03.04', name: 'Randleisten versetzen in Beton C20/25', einheit: 'lfm', ep: 34.0 },
    { id: 'trag', nr: '04.01', name: 'Asphalttragschicht AC 16 trag, 8 cm', einheit: 'm²', ep: 31.5 },
    { id: 'deck', nr: '04.02', name: 'Asphaltdeckschicht AC 11 deck, 3 cm', einheit: 'm²', ep: 17.8 },
    { id: 'kuenette', nr: '05.01', name: 'Künette ausheben, Rohr verlegen, verfüllen', einheit: 'lfm', ep: 86.0 },
    { id: 'regie', nr: '09.01', name: 'Regiestunde Facharbeiter', einheit: 'Std.', ep: 62.0 }
  ];

  const paletten = [
    { id: 'euro', name: 'Euro-Palette', pfand: 12.5 },
    { id: 'weiss', name: 'Weissenböck-Palette', pfand: 14.0 }
  ];

  const segArten = ['Schmutzzulage', 'Staubzulage (Schneidarbeiten)', 'Erschwerniszulage Asphalt', 'Erschwerniszulage Künette'];

  // ---- Mitarbeiter (fiktiv) ----
  const M = (id, vn, nn, lg, kst, extra) => Object.assign({ id, vn, nn, name: vn + ' ' + nn, lg, kst, rolle: 'mitarbeiter', pnr: 1000 + id }, extra || {});
  const mitarbeiter = [
    M(1, 'Josef', 'Haidbauer', 'pol', '26-041', { rolle: 'polier' }),
    M(2, 'Lukas', 'Brandstätter', 'fa', '26-041'),
    M(3, 'Daniel', 'Schwarz', 'fa', '26-041'),
    M(4, 'Roland', 'Kerschbaumer', 'ma', '26-041'),
    M(5, 'Mehmet', 'Yıldız', 'hi', '26-041'),
    M(6, 'Fabian', 'Stickler', 'le', '26-041'),
    M(7, 'Karl', 'Ungersböck', 'lkw', '26-041'),
    M(8, 'Franz', 'Leitgeb', 'pol', '26-038', { rolle: 'polier' }),
    M(9, 'Christian', 'Trimmel', 'fa', '26-038'),
    M(10, 'Günter', 'Scherz', 'ma', '26-038'),
    M(11, 'Bogdan', 'Ionescu', 'hi', '26-038'),
    M(12, 'Zoran', 'Petrović', 'lkw', '26-038'),
    M(13, 'Thomas', 'Riegler', 'va', '26-044', { rolle: 'polier' }),
    M(14, 'Mario', 'Gruber', 'fa', '26-044'),
    M(15, 'Peter', 'Schabauer', 'hi', '26-044'),
    M(16, 'Patrick', 'Hofer', 'fa', '26-029'),
    M(17, 'Markus', 'Zöchling', 'fa', '26-029'),
    M(18, 'Reinhard', 'Luef', 'lkw', '26-029'),
    M(19, 'Manfred', 'Puchegger', 'va', '26-047', { rolle: 'polier' }),
    M(20, 'Herbert', 'Flasch', 'ma', '26-047'),
    M(21, 'Dominik', 'Kogelbauer', 'hi', '26-047'),
    M(22, 'Andreas', 'Stangl', 'va', '26-035', { rolle: 'polier' }),
    M(23, 'Stefan', 'Weninger', 'fa', '26-035'),
    M(24, 'Elias', 'Woltron', 'le', '26-035'),
    M(25, 'Gerhard', 'Wallner', 'pol', '26-050', { rolle: 'polier' }),
    M(26, 'Werner', 'Posch', 'ma', '26-050'),
    M(27, 'Ivan', 'Horvat', 'hi', '26-050'),
    M(28, 'Erwin', 'Pürrer', 'lkw', '26-050'),
    M(29, 'Johann', 'Tisch', 'lkw', '26-050'),
    M(30, 'Alois', 'Dorfmeister', 'ma', '90-001')
  ];
  const buero = [
    { id: 101, vn: 'Martina', nn: 'Koller', name: 'Martina Koller', lg: null, rolle: 'buero', funktion: 'Büro · Lohnverrechnung' },
    { id: 102, vn: 'Michael', nn: 'Pichler', name: 'Michael Pichler', lg: null, rolle: 'buero', funktion: 'Geschäftsführung' }
  ];

  // ---- Baustellen ----
  const baustellen = [
    {
      kst: '26-041', name: 'Wohnhausanlage Pitten – Außenanlagen', kurz: 'WHA Pitten',
      ag: 'Wohnbau Schwarzatal Gen.m.b.H.', agAdr: 'Hauptplatz 14, 2620 Neunkirchen', agMail: 'bauleitung@wohnbau-schwarzatal.example',
      bv: 'Wohnhausanlage Pitten, Feldgasse 7–11 · Zufahrt, Parkplätze, Gehwege', ort: '2823 Pitten, Feldgasse 7–11',
      bauherrVertreter: 'Ing. Helga Auer', art: 'Erdbau · Pflasterung', start: '2026-09-28', ende: '2026-11-27', fertig: 0.72, zielDB: 0.184,
      soll: { lohn: 1.05, geraete: 1.08, material: 0.98, fremd: 1.0 },
      geraete: { b9: [8, 0.85], lkw3: [4, 0.7], ruettel: [6, 0.75], bomag: [3, 0.3], dumper: [4, 0.35], schneid: [3, 0.45], verlege: [5, 0.3], b27: [4, 0.25], kran3: [2, 0.2] },
      material: { frostschutz: [42, 0.5], splitt: [6, 0.45], aushub: [56, 0.35], graeder: [14, 0.25], betonbruch: [8, 0.08] },
      zusatz: { pflaster8: [46, 0.45], randstein: [28, 0.3], beton: [2.5, 0.3] },
      pos: { be: 0.02, aushub: 0.14, frost: 0.2, planum: 0.04, pflaster: 0.42, rand: 0.14, regie: 0.04 },
      fremd: [{ d: '2026-10-06', text: 'Vermessung Absteckung – ZT Büro Kern', betrag: 1480 }, { d: '2026-10-20', text: 'Saugbagger Leitungsfreilegung – Fa. Kanal-Tec', betrag: 2260 }, { d: '2026-11-04', text: 'Deponiegebühr Baurestmassen', betrag: 940 }],
      texte: ['Aushub Zufahrt Stiege 2 bis Planum, Verfuhr mit 3-Achser.', 'Frostschutz 0/63 lagenweise eingebracht und verdichtet (Bomag).', 'Randleisten versetzt Parkplatz Reihe B, 28 lfm.', 'Betonsteinpflaster 8 cm verlegt Gehweg Stiege 1, Fugen eingekehrt und abgerüttelt.', 'Feinplanum hergestellt, Splittbett abgezogen.', 'Schneidarbeiten Anschlüsse Schachtdeckel und Einfassungen.']
    },
    {
      kst: '26-038', name: 'Betriebszufahrt Holzbau Kogler', kurz: 'Zufahrt Kogler',
      ag: 'Holzbau Kogler GmbH', agAdr: 'Industriestraße 22, 2620 Neunkirchen', agMail: 'office@holzbau-kogler.example',
      bv: 'Betriebsgelände Neunkirchen · Zufahrt und Lagerfläche asphaltieren', ort: '2620 Neunkirchen, Industriestraße 22',
      bauherrVertreter: 'Bernhard Kogler', art: 'Erdbau · Asphaltierung', start: '2026-10-05', ende: '2026-11-20', fertig: 0.8, zielDB: 0.142,
      soll: { lohn: 0.97, geraete: 1.02, material: 1.03, fremd: 1.0 },
      geraete: { b23: [7, 0.5], lkw4: [6, 0.7], graeder: [5, 0.45], bomag: [6, 0.6], radlader: [4, 0.4], hamm: [4, 0.3], sattel: [5, 0.3] },
      material: { frostschutz: [84, 0.55], graeder: [38, 0.45], aushub: [120, 0.4], asphaltbruch: [22, 0.2] },
      zusatz: { asphalt: [38, 0.22] },
      pos: { be: 0.03, aushub: 0.2, frost: 0.25, planum: 0.05, trag: 0.3, deck: 0.15, regie: 0.02 },
      fremd: [{ d: '2026-11-03', text: 'Asphalteinbau Fertiger samt Partie – Fa. Asphaltbau Süd', betrag: 11800 }, { d: '2026-10-14', text: 'Bodenprüfung Lastplatte', betrag: 620 }],
      texte: ['Abtrag Oberboden und Aushub Lagerfläche.', 'Frostschutz eingebaut und verdichtet, Lastplattenversuch vorbereitet.', 'Grädermaterial eingebaut, Planum auf ± 2 cm abgezogen.', 'Asphalttragschicht AC 16 eingebaut (Fertiger Fremdfirma), Anschlüsse händisch.']
    },
    {
      kst: '26-044', name: 'Einfamilienhaus Reisinger – Hof und Zufahrt', kurz: 'EFH Reisinger',
      ag: 'Fam. Reisinger', agAdr: 'Schlossweg 3, 2824 Seebenstein', agMail: 'reisinger@privat.example',
      bv: 'Hofpflasterung, Zufahrt und Terrassenunterbau', ort: '2824 Seebenstein, Schlossweg 3',
      bauherrVertreter: 'Claudia Reisinger', art: 'Pflasterung', start: '2026-10-19', ende: '2026-11-13', fertig: 0.9, zielDB: 0.226,
      soll: { lohn: 1.06, geraete: 1.0, material: 1.02, fremd: 1.0 },
      geraete: { b27: [6, 0.7], lkw2: [3, 0.5], ruettel: [5, 0.8], schneid: [3, 0.5], dumper: [3, 0.3], kran3: [1.5, 0.25] },
      material: { frostschutz: [16, 0.4], splitt: [4, 0.5], aushub: [18, 0.3] },
      zusatz: { pflaster8: [24, 0.6], randstein: [12, 0.35], beton: [1, 0.3] },
      pos: { be: 0.02, aushub: 0.1, frost: 0.14, pflaster: 0.56, rand: 0.14, regie: 0.04 },
      fremd: [{ d: '2026-10-22', text: 'Containerdienst Grünschnitt', betrag: 380 }],
      texte: ['Aushub Hof bis Planum, Material seitlich gelagert.', 'Frostschutz eingebracht, verdichtet.', 'Pflaster im Hof verlegt (Fischgrät), Zuschnitte an der Hausmauer.', 'Randleisten Zufahrt versetzt.']
    },
    {
      kst: '26-029', name: 'Gemeinde Breitenau – Gehsteig Hauptstraße', kurz: 'Gehsteig Breitenau',
      ag: 'Gemeinde Breitenau', agAdr: 'Gemeindeplatz 1, 2624 Breitenau', agMail: 'bauamt@breitenau.example',
      bv: 'Gehsteigsanierung Hauptstraße, Abschnitt Kirche bis Feuerwehrhaus', ort: '2624 Breitenau, Hauptstraße',
      bauherrVertreter: 'Bauamtsleiter K. Steiner', art: 'Pflasterung · Regie', start: '2026-09-14', ende: '2026-11-18', fertig: 0.85, zielDB: 0.118,
      soll: { lohn: 0.93, geraete: 0.98, material: 1.0, fremd: 1.0 },
      geraete: { b15: [6, 0.7], lkw2: [3, 0.5], ruettel: [5, 0.7], schneid: [4, 0.6], kompressor: [3, 0.3], handwalze: [3, 0.3] },
      material: { betonbruch: [6, 0.4], asphaltbruch: [5, 0.35], frostschutz: [9, 0.4], splitt: [3, 0.5] },
      zusatz: { pflaster8: [18, 0.55], randstein: [16, 0.5], beton: [1.2, 0.4] },
      pos: { be: 0.03, aushub: 0.08, frost: 0.1, pflaster: 0.45, rand: 0.24, regie: 0.1 },
      fremd: [{ d: '2026-10-08', text: 'Verkehrssicherung / Ampelregelung', betrag: 1650 }],
      texte: ['Abbruch bestehender Gehsteig, Asphaltbruch verladen.', 'Randleisten neu versetzt, 16 lfm.', 'Pflaster verlegt, Einfahrten angepasst.', 'Regie: Schieberkappen und Hydrant auf Niveau gesetzt (Anweisung Bauamt).']
    },
    {
      kst: '26-047', name: 'Kanalanschluss Werkstraße Ternitz', kurz: 'Kanal Ternitz',
      ag: 'Stahlservice Ternitz GmbH', agAdr: 'Werkstraße 40, 2630 Ternitz', agMail: 'technik@stahlservice-ternitz.example',
      bv: 'Schmutzwasserkanal-Anschluss Halle 3, Künette 86 lfm', ort: '2630 Ternitz, Werkstraße 40',
      bauherrVertreter: 'DI Martin Ebner', art: 'Erdbau · Kanal', start: '2026-10-27', ende: '2026-11-25', fertig: 0.55, zielDB: 0.168,
      soll: { lohn: 1.03, geraete: 1.04, material: 1.0, fremd: 1.0 },
      geraete: { b9: [8, 0.8], lkw3: [3, 0.5], grabenwalze: [4, 0.6], dumper: [5, 0.5], kompressor: [3, 0.25] },
      material: { aushub: [34, 0.5], frostschutz: [18, 0.4], graeder: [10, 0.3], asphaltbruch: [6, 0.15] },
      zusatz: { rohr150: [9, 0.6], beton: [0.8, 0.2] },
      pos: { be: 0.04, aushub: 0.12, kuenette: 0.66, frost: 0.12, regie: 0.06 },
      fremd: [{ d: '2026-11-05', text: 'Kanal-TV-Befahrung und Dichtheitsprüfung', betrag: 890 }],
      texte: ['Künette ausgehoben, Verbau gesetzt, 9 lfm Rohr DN 150 verlegt.', 'Künette lagenweise verfüllt und mit Grabenwalze verdichtet.', 'Schacht S2 versetzt.']
    },
    {
      kst: '26-035', name: 'Parkplatz Nahversorger Gloggnitz', kurz: 'Parkplatz Gloggnitz',
      ag: 'Frischemarkt Semmering KG', agAdr: 'Wiener Straße 61, 2640 Gloggnitz', agMail: 'filiale.gloggnitz@frischemarkt.example',
      bv: 'Erweiterung Kundenparkplatz, 18 Stellplätze, Pflaster und Entwässerung', ort: '2640 Gloggnitz, Wiener Straße 61',
      bauherrVertreter: 'Filialleiter R. Pammer', art: 'Erdbau · Pflasterung', start: '2026-09-21', ende: '2026-11-13', fertig: 0.95, zielDB: 0.031,
      soll: { lohn: 0.84, geraete: 0.9, material: 0.97, fremd: 0.8 },
      geraete: { b9: [7, 0.6], lkw3: [4, 0.5], ruettel: [6, 0.7], verlege: [6, 0.4], schneid: [3, 0.4], bomag: [3, 0.25] },
      material: { frostschutz: [30, 0.4], splitt: [5, 0.5], aushub: [40, 0.3] },
      zusatz: { pflaster8: [38, 0.55], randstein: [14, 0.3], beton: [1.5, 0.3] },
      pos: { be: 0.03, aushub: 0.14, frost: 0.2, planum: 0.03, pflaster: 0.46, rand: 0.12, regie: 0.02 },
      fremd: [{ d: '2026-10-01', text: 'Mehraufwand Felsabtrag – Hydraulikhammer Miete', betrag: 3900 }, { d: '2026-10-16', text: 'Entwässerungsrinnen Lieferung und Versetzen', betrag: 4200 }],
      texte: ['Aushub erschwert (Fels), Hydraulikhammer im Einsatz.', 'Frostschutz eingebracht und verdichtet.', 'Pflaster maschinell verlegt, Stellplatzmarkierung mit Farbsteinen.']
    },
    {
      kst: '26-050', name: 'Lagerhalle Wiener Neustadt – Unterbau', kurz: 'Halle Wr. Neustadt',
      ag: 'Logistikpark Steinfeld GmbH', agAdr: 'Ferdinand-Graf-von-Zeppelin-Straße 9, 2700 Wiener Neustadt', agMail: 'projekt@logistikpark-steinfeld.example',
      bv: 'Neubau Lagerhalle C · Erdbau, Unterbau Bodenplatte und Umfahrung', ort: '2700 Wiener Neustadt, Civitas Nova',
      bauherrVertreter: 'Bmst. Ing. P. Holzer', art: 'Erdbau', start: '2026-11-02', ende: '2027-01-29', fertig: 0.12, zielDB: 0.205,
      soll: { lohn: 1.02, geraete: 1.03, material: 1.0, fremd: 1.0 },
      geraete: { b23: [8.5, 0.9], sattel: [8, 0.8], lkw4: [8, 0.8], radlader: [6, 0.6], graeder: [4, 0.3], bomag: [5, 0.5], tieflader: [2, 0.12] },
      material: { aushub: [260, 0.8], frostschutz: [140, 0.5], graeder: [40, 0.2] },
      zusatz: {},
      pos: { be: 0.06, aushub: 0.52, frost: 0.36, planum: 0.04, regie: 0.02 },
      fremd: [{ d: '2026-11-03', text: 'Vermessung Höhenfestpunkte', betrag: 760 }],
      texte: ['Humusabtrag und Aushub Baufeld Achse 1–4, Verfuhr mit Sattel und 4-Achser.', 'Frostschutz lagenweise eingebaut, Verdichtung mit Bomag BW 177.']
    },
    {
      kst: '90-001', name: 'Kieswerk Breitenau (intern)', kurz: 'Kieswerk', intern: true,
      ag: 'Michael Pichler Ges.m.b.H.', agAdr: '2624 Breitenau', agMail: '', bv: 'Kieswerk – Aufbereitung und Verladung', ort: '2624 Breitenau', bauherrVertreter: '', art: 'Kieswerk',
      start: '2026-01-07', ende: '2026-12-18', fertig: 0, zielDB: 0, soll: { lohn: 1, geraete: 1, material: 1, fremd: 1 }, geraete: {}, material: {}, zusatz: {}, pos: {}, fremd: [], texte: []
    }
  ];

  // Heutiger Status laut Demo (12.11.2026): U = Urlaub, K = Krank, offen = noch nicht eingestempelt
  const heuteAbwesend = { 3: 'U', 28: 'U', 24: 'K' };
  const heuteOffen = [29, 16, 27];

  const textbausteine = ['Aushub bis Planum hergestellt', 'Frostschutz eingebracht und verdichtet', 'Feinplanum hergestellt', 'Randleisten in Beton versetzt', 'Betonsteinpflaster 8 cm verlegt', 'Fugen eingekehrt und abgerüttelt', 'Schneidarbeiten Anschlüsse', 'Baustelle geräumt und abgesichert'];

  window.DATA = { HEUTE, lohngruppen, geraete, material, leistungen, paletten, segArten, mitarbeiter, buero, baustellen, heuteAbwesend, heuteOffen, textbausteine };
})();
