'use strict';
/**
 * Liefer- und Wiegescheine (Inhaberentscheidung N-112, API.md 15.7) – EINE Regel für alle Kanäle.
 *
 * Lieferschein-/Wiegeschein-Fotos und der daraus erkannte Text (OCR/KI) können Lieferantenpreise zeigen. Sie sieht
 *  - wer das Recht preise_sehen ODER stammdaten hat (Büro, Bauleiter, GF laut Matrix – nie nach Rollenname): alle,
 *  - jede andere Person (Polier, LKW-Fahrer, Mitarbeiter, auch mit Ausnahmen ohne diese Rechte): NUR selbst hochgeladene.
 * Gilt für den Bericht (JSON, internes PDF, AG-PDF), Fuhren (Foto-Abruf, /plan/ich, /plan/partie), Projektdokumente der
 * Kategorie „Lieferscheine“ (Liste, Suche, Einzelabruf, Datei, Versionen), Fernansicht, E-Mails und Benachrichtigungen.
 * Kanäle ohne angemeldeten Empfänger (Fernunterschrift-Link, E-Mail an den Auftraggeber) zeigen sie nie.
 * Andere Fotoarten (Baustellenfoto, Papierbericht, Schadensfoto) sind davon nicht betroffen.
 */

/** Kategorie der Projektdokumente, für die die Regel gilt */
const DOKUMENT_KATEGORIE = 'lieferscheine';
/** Arten von Berichtsfotos, für die die Regel gilt */
const BERICHT_ARTEN = ['lieferschein'];

/** Sieht ctx alle Liefer-/Wiegescheine (auch fremd hochgeladene)? */
function siehtAlle(ctx) {
  return Boolean(ctx && ctx.benutzer && typeof ctx.hat === 'function' && (ctx.hat('preise_sehen') || ctx.hat('stammdaten')));
}
/** Darf ctx einen Beleg sehen, den `erstelltVon` hochgeladen hat? (ohne ctx – externer Empfänger – nie) */
function sichtbar(ctx, erstelltVon) {
  if (siehtAlle(ctx)) return true;
  return Boolean(ctx && ctx.benutzer && erstelltVon != null && Number(erstelltVon) === ctx.benutzer.id);
}
/** Berichtsfoto (Zeile bericht_foto) für ctx sichtbar? Andere Arten immer. */
function berichtFotoSichtbar(ctx, f) {
  return !BERICHT_ARTEN.includes(f.art) || sichtbar(ctx, f.erstellt_von);
}
/** Projektdokument (Zeile dokument) für ctx sichtbar? Andere Kategorien unverändert (Kategorie-Rechte gelten zusätzlich). */
function dokumentSichtbar(ctx, d) {
  return d.kategorie !== DOKUMENT_KATEGORIE || sichtbar(ctx, d.erstellt_von);
}
/** Version (Zeile dokument_datei) eines Lieferschein-Dokuments für ctx sichtbar? */
function dokumentDateiSichtbar(ctx, d, x) {
  return d.kategorie !== DOKUMENT_KATEGORIE || sichtbar(ctx, x.erstellt_von);
}

module.exports = { DOKUMENT_KATEGORIE, BERICHT_ARTEN, siehtAlle, sichtbar, berichtFotoSichtbar, dokumentSichtbar, dokumentDateiSichtbar };
