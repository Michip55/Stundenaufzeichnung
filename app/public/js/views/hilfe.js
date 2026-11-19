// Hilfe / Erste Schritte – je nach Rechten des angemeldeten Benutzers (Ausbaustufe 2, Schritt 1).
// Enthält auch die Anleitung „Zum Startbildschirm hinzufügen“ für Android, iPhone/iPad und PC.
import { ic, esc, rolleText, toast, $ } from '../ui.js';
import { installStatus, installieren } from '../installieren.js';

// Karte „App installieren“ – wird auch unter „Mehr“ gezeigt
export function installKarte() {
  const s = installStatus();
  const kopf = `<div class="card-h pad-h"><h3 id="inst-h">${ic('download')}App am Gerät installieren</h3>${s.installiert ? '<span class="chip st-green">Installiert</span>' : ''}</div>`;
  let inhalt;
  if (s.installiert) inhalt = '<p class="pad-s muted sm">BauTag läuft als installierte App. Das Symbol liegt am Startbildschirm.</p>';
  else if (s.art === 'dialog') inhalt = `<div class="pad-s stack-s"><p>BauTag kann wie eine App am Startbildschirm liegen – ohne App-Store, ein Fingertipp genügt.</p><button type="button" class="btn primary lg" data-installieren>${ic('download')}Zum Startbildschirm hinzufügen</button></div>`;
  else if (s.art === 'ios') inhalt = `<div class="pad-s"><p>Am iPhone oder iPad in <b>Safari</b>:</p><ol class="schritte" data-ios-anleitung><li>Unten auf <b>Teilen</b> tippen (Quadrat mit Pfeil nach oben).</li><li><b>„Zum Home-Bildschirm“</b> wählen.</li><li>Mit <b>„Hinzufügen“</b> bestätigen – das BauTag-Symbol liegt dann am Startbildschirm.</li></ol><p class="muted sm">In anderen Browsern am iPhone geht das nicht – bitte Safari verwenden.</p></div>`;
  else inhalt = `<div class="pad-s"><ol class="schritte" data-browser-anleitung><li><b>Android (Chrome):</b> Menü <b>⋮</b> oben rechts → <b>„App installieren“</b> bzw. „Zum Startbildschirm hinzufügen“.</li><li><b>PC (Chrome/Edge):</b> in der Adresszeile auf das <b>Installieren-Symbol</b> klicken.</li><li><b>iPhone/iPad:</b> in Safari auf <b>Teilen</b> → „Zum Home-Bildschirm“.</li></ol><p class="muted sm">Erscheint der Punkt nicht, ist BauTag vielleicht schon installiert oder die Seite wird nicht über HTTPS geöffnet.</p></div>`;
  return `<section class="card" id="install-karte" data-install="${s.art}" aria-labelledby="inst-h">${kopf}${inhalt}</section>`;
}
export function bindeInstall(el, neuZeichnen) {
  const b = $('[data-installieren]', el);
  if (b) b.addEventListener('click', async () => {
    b.disabled = true;
    const r = await installieren();
    toast(r === 'accepted' ? 'BauTag wird installiert – das Symbol erscheint am Startbildschirm.' : r === 'dismissed' ? 'Installation abgebrochen – sie ist später jederzeit hier möglich.' : 'Der Browser bietet die Installation gerade nicht an – bitte die Anleitung verwenden.', r === 'accepted' ? 'ok' : 'warn');
    if (neuZeichnen) neuZeichnen();
  });
}

const THEMEN = [
  { id: 'stempeln', recht: ['zeit_eigen'], icon: 'clock', titel: 'Stempeln', ziel: '/stempeln', schritte: ['Baustelle wählen (die App merkt sich die letzte).', 'Auf <b>Kommen</b> tippen – fertig. Pause und Gehen genauso.', 'Kein Netz? Einfach stempeln: Die Buchung wird gespeichert und später automatisch gesendet (oben steht dann „ausstehend“).', 'Pause vergessen? Beim <b>Gehen</b> fragt die App, wie lange die Pause war – Dauer antippen (Beginn ca. 12:00, änderbar) oder „Keine Pause“.'] },
  { id: 'kolonne', recht: ['kolonne'], icon: 'users', titel: 'Kolonne stempeln', ziel: '/kolonne', schritte: ['Baustelle und Art der Buchung wählen (Kommen, Pause, Gehen).', 'Die Leute der Partie anhaken, dann auf <b>buchen</b>.', 'Wer nicht gebucht werden konnte, steht mit Begründung in der Liste.'] },
  { id: 'bericht', recht: ['bericht_erstellen'], icon: 'clipboard', titel: 'Bautagesbericht schreiben', ziel: '/berichte', schritte: ['<b>Neuer Bericht</b> – Baustelle und Tag wählen. Das Personal kommt aus den Stempelungen.', 'Geräte, Material, Arbeitsleistung, Regie und Vorkommnisse eintragen. Es wird laufend gespeichert.', 'Am Ende unterschreiben: zuerst Sie, dann der Bauherr am Gerät. Danach ist der Inhalt gesperrt.'] },
  { id: 'freigabe', recht: ['bericht_freigeben'], icon: 'check', titel: 'Berichte prüfen und freigeben', ziel: '/berichte?status=unterschrieben', schritte: ['Unterschriebene Berichte stehen in der Übersicht unter „Berichte zur Freigabe“.', 'Bericht öffnen, prüfen, <b>Freigeben</b>. Erst dann zählt er in Nachkalkulation und Lohn.', 'Wer selbst für den Auftragnehmer unterschrieben hat, gibt nicht selbst frei (Vier-Augen-Prinzip).'] },
  { id: 'woche', recht: ['zeit_eigen'], icon: 'calendar', titel: 'Meine Stunden und Urlaub', ziel: '/woche', schritte: ['Unter <b>Meine Woche</b> stehen die eigenen Stunden je Tag.', 'Urlaub oder Zeitausgleich unter <b>Abwesenheiten</b> beantragen – das Büro genehmigt.', 'Stimmt eine Zeit nicht? Bitte im Büro melden, dort wird sie korrigiert.'] },
  { id: 'geraete', recht: [], icon: 'truck', titel: 'Schaden oder Mangel an einem Gerät melden', ziel: '/fuhrpark', schritte: ['Unter <b>Fuhrpark &amp; Geräte</b> das Gerät suchen.', '<b>Schaden melden</b> – kurz beschreiben, Foto dazu.', 'Die Werkstatt bzw. das Büro sieht die Meldung sofort.'] },
  { id: 'kalk', recht: ['kalk_sehen'], icon: 'chart', titel: 'Nachkalkulation und Budget', ziel: '/kalkulation', schritte: ['Je Baustelle zeigt <b>Positionen</b> die Nachkalkulation wie in der Excel-Vorlage.', 'Mengen kommen aus den Berichten; Rechnungen und Sonstiges werden händisch erfasst.', 'Bei 80, 90 und 100 % der Auftragssumme kommt eine Benachrichtigung (Glocke).'] },
  { id: 'preise', recht: ['preise_bearbeiten'], icon: 'tag', titel: 'Preise und Positionskatalog pflegen', ziel: '/preise', schritte: ['<b>Preise &amp; Stammdaten</b>: Kostensätze und der Positionskatalog (Firmenvorlage).', 'Preise je Bauvorhaben werden direkt in der Nachkalkulation der Baustelle geändert.', 'Jede Änderung wird protokolliert.'] },
  { id: 'monat', recht: ['lohn'], icon: 'table', titel: 'Monatsauswertung und Lohn-Export', ziel: '/monat', schritte: ['<b>Monatsauswertung</b> zeigt Stunden, Über- und Mehrstunden (nach dem Arbeitszeitmodell der Person) und Abwesenheiten je Person – als Stunden:Minuten (9:51 = 9 Std. 51 Min.). Der Schalter „Std:Min | Dezimal“ zeigt zum Vergleich mit der Lohnverrechnung die Dezimalzahl (9,85); das Gerät merkt sich die Wahl.', 'Warnungen prüfen, Zeiten bei Bedarf unter „Zeiten korrigieren“ berichtigen (immer mit Grund).', 'CSV für die Lohnverrechnung und die BUAK-Grundlage (nur BUAK-pflichtige Personen) herunterladen.'] },
  { id: 'benutzer', recht: ['benutzer'], icon: 'shield', titel: 'Benutzer und Rechte', ziel: '/benutzer', schritte: ['Benutzer anlegen, PIN zurücksetzen, gesperrte Konten entsperren.', 'Jede aktive Person braucht eine <b>Personalnummer</b> – damit meldet sie sich an. Fehlt sie, steht oben eine Warnung mit den Namen; unter „Bearbeiten“ eintragen.', 'Die Rechte-Matrix legt fest, was jede Rolle sieht. Gesperrte Felder bleiben gesperrt.', 'Alle Änderungen stehen im Protokoll.'] },
];

export default async function hilfe(el, ctx) {
  const u = ctx.ich.benutzer;
  const themen = THEMEN.filter((t) => !t.recht.length || t.recht.some(ctx.kann));
  function zeichne() {
    el.innerHTML = `
    <div class="page narrow wide-md" id="hilfe">
      <section class="card pad"><h2 class="h-gross">Erste Schritte</h2><p class="muted">Für ${esc(u.name)} · ${esc(rolleText(u.rolle))}. Hier steht nur, was Sie in BauTag auch verwenden können.</p></section>
      ${installKarte()}
      ${themen.map((t, i) => `<details class="card hilfe-thema" data-thema="${t.id}" ${i === 0 ? 'open' : ''}><summary>${ic(t.icon)}<span>${t.titel}</span>${ic('down')}</summary>
        <div class="pad-s"><ol class="schritte">${t.schritte.map((s) => `<li>${s}</li>`).join('')}</ol><a class="btn ghost sm" href="#${t.ziel}">${ic('right')}Dorthin</a></div></details>`).join('')}
      <section class="card pad"><h3 class="h-klein">Gut zu wissen</h3><ul class="punkte">
        <li id="hilfe-anmelden"><b>Anmelden:</b> mit Personalnummer${u.pnr ? ` (deine: <b>${esc(String(u.pnr))}</b>, steht auch unter „Mehr“)` : ' (steht unter „Mehr“ und am Lohnzettel)'} und PIN. Am <b>eigenen Handy</b> merkt sich die App danach deinen Namen – beim nächsten Mal nur noch die PIN eingeben. Will sich jemand anderer anmelden: „Andere Person“. Am <b>geteilten Gerät</b> (z. B. Tablet im Bauhof) zeigt die App nie Namen – dort immer Personalnummer und PIN.</li>
        <li><b>PIN vergessen oder Konto gesperrt?</b> Das Büro setzt die PIN zurück bzw. entsperrt.</li>
        <li><b>PIN ändern:</b> unter „Mehr“ → „PIN ändern“. Die PIN kennt nur die Person selbst.</li>
        <li><b>Ohne Netz:</b> Stempeln und Schadensmeldungen werden am Gerät gespeichert und später gesendet. Alles andere braucht eine Verbindung.</li>
        <li id="hilfe-standort"><b>Standort beim Stempeln:</b> freiwillig – nur du selbst schaltest es unter „Mehr“ ein oder aus, und es bleibt für dich gespeichert (auch nach dem Abmelden, nie für andere am selben Gerät). Erfasst wird nur im Moment des Stempelns; unter der Uhr steht „Standort erfasst“, und das Büro sieht bei der Buchung, ob du bei der Baustelle warst. Schaltest du es aus, werden deine gespeicherten Standorte gelöscht.</li></ul></section>
    </div>`;
    bindeInstall(el, zeichne);
  }
  zeichne();
  const neu = () => { if (ctx.aktuell()) zeichne(); };
  window.addEventListener('bt:install', neu);
  return () => window.removeEventListener('bt:install', neu);
}
