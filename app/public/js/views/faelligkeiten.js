// Fälligkeiten (API.md 15.24, Inhaber 17.11.2026): „eine übersichtliche Übersicht, wann was fällig ist – mit Skonto-Betrag und ohne“.
// Ruhig wie die neue Übersicht (.ue-*): Gruppen Überfällig · Diese Woche · Nächste Woche · Später, je Rechnung eine Zeile
// mit „mit Skonto € X bis TT.MM.“ (nur solange die Skontofrist läuft) und „ohne Skonto € Y bis TT.MM.“ (Zahlungsziel);
// Rücklass-Freigaben als eigene, gedämpfte Zeilen. Beträge = Zahlbetrag (Brutto − Rücklässe, abzüglich bereits bezahlt),
// „mit Skonto“ zusätzlich abzüglich des noch möglichen Skontos. Alle Beträge kommen vom Server (Recht preise_sehen).
// 15.37: Reiter „Fälligkeiten“ der Seite „Rechnungen“ (Leiste aus rechnungen.js mitRechnungsReitern) – „Alle Rechnungen“ ist der erste Reiter.
import { get } from '../api.js';
import { ic, esc, fmt } from '../ui.js';
import { rechnungOeffnen, bezahltDialog, offenGesamtHtml } from './rechnungen.js';

const RL = { haftruecklass: 'Haftrücklass', deckungruecklass: 'Deckungsrücklass' };

export default async function faelligkeiten(el, ctx) {
  let d = await get('/faelligkeiten');
  const jahr = () => d.heute.slice(0, 4);
  const tag = (iso) => { if (!iso) return ''; const [y, m, t] = iso.split('-'); return `${t}.${m}.${y === jahr() ? '' : y}`; };
  const eur = (n) => (n < 0 ? `− ${fmt.eur(-n)}` : fmt.eur(n));
  const wer = (e) => `<span class="ue-t">${esc(e.auftraggeber || e.baustelle.name)}</span><span class="ue-sub">${esc(e.nr)} · ${esc(e.baustelle.name)}${e.teilbezahlt ? ' · teilbezahlt' : ''}</span>`;
  const darf = ctx.kann('preise_bearbeiten');
  // Zeile = Fläche zum Öffnen (Knopf) und rechts „✓“ zum Markieren als bezahlt (15.24); Rücklass-Zeilen gedämpft
  const okKnopf = (e) => (darf ? `<button type="button" class="fae-ok" data-bezahlt="${e.rechnungId}" aria-label="${e.ohneSkonto ? `Rechnung ${esc(e.nr)} als bezahlt markieren` : `${esc(RL[e.art] || 'Rücklass')} zu ${esc(e.nr)} als ausbezahlt markieren`}" title="Als bezahlt markieren">${ic('check')}</button>` : ic('right', 'ue-chev'));
  function zeile(e) {
    if (e.ohneSkonto) {
      const ue = e.ohneSkonto.bis < d.heute && e.art !== 'gutschrift';
      return `<div class="ue-row fae-row" data-fae="${esc(e.art)}" data-nr="${esc(e.nr)}"><button type="button" class="fae-auf" data-rechnung="${e.rechnungId}" aria-label="Rechnung ${esc(e.nr)} öffnen">
        <span class="ue-txt">${wer(e)}</span>
        <span class="fae-betraege">
          ${e.mitSkonto ? `<span class="fae-zeile mit" data-skonto="mit"><span class="fae-l">mit Skonto</span><b>${eur(e.mitSkonto.betrag)}</b><span class="fae-bis">bis ${esc(tag(e.mitSkonto.bis))}</span></span>` : ''}
          <span class="fae-zeile ohne${ue ? ' rot' : ''}" data-skonto="ohne"><span class="fae-l">${e.art === 'gutschrift' ? 'Gutschrift' : e.mitSkonto ? 'ohne Skonto' : 'fällig'}</span><b>${eur(e.ohneSkonto.betrag)}</b><span class="fae-bis">${ue ? `seit ${esc(tag(e.ohneSkonto.bis))}` : `bis ${esc(tag(e.ohneSkonto.bis))}`}</span></span>
        </span></button>${okKnopf(e)}</div>`;
    }
    if (e.art === 'differenz' || e.art === 'ueberzahlung') {
      return `<div class="ue-row fae-row fae-rl fae-diff" data-fae="${esc(e.art)}" data-nr="${esc(e.nr)}"><button type="button" class="fae-auf" data-rechnung="${e.rechnungId}" aria-label="${e.art === 'ueberzahlung' ? 'Überzahlung' : 'Strittige Differenz'} zur Rechnung ${esc(e.nr)} öffnen">
      <span class="ue-txt">${wer(e)}</span>
      <span class="fae-betraege"><span class="fae-zeile"><span class="fae-l">${e.art === 'ueberzahlung' ? 'Überzahlung' : 'Differenz strittig'}</span><b>${eur(e.betrag)}</b><span class="fae-bis">${esc(e.art === 'ueberzahlung' ? e.text || 'zurückzahlen/verrechnen' : `${e.text || e.grundName}${e.skontoVerspaetet ? ' (verspätet)' : ''}`)}</span></span></span></button>${ic('right', 'ue-chev')}</div>`;
    }
    return `<div class="ue-row fae-row fae-rl" data-fae="${esc(e.art)}" data-nr="${esc(e.nr)}"><button type="button" class="fae-auf" data-rechnung="${e.rechnungId}" aria-label="${esc(RL[e.art] || 'Rücklass')} zur Rechnung ${esc(e.nr)} öffnen">
      <span class="ue-txt">${wer(e)}</span>
      <span class="fae-betraege"><span class="fae-zeile"><span class="fae-l">${esc(RL[e.art] || 'Rücklass')}</span><b>${eur(e.betrag)}</b><span class="fae-bis">${e.freiAb ? `frei ab ${esc(tag(e.freiAb))}` : e.art === 'deckungruecklass' ? 'mit Schlussrechnung' : 'Freigabe offen'}</span></span></span></button>${ic('right', 'ue-chev')}</div>`;
  }
  function gruppe(g) {
    if (!g.eintraege.length) return '';
    const rot = g.schluessel === 'ueberfaellig';
    const summe = `<span class="fae-summe" data-summe="ohne">${eur(g.summeOhneSkonto)}</span>`;
    const fuss = [g.summeMitSkonto !== g.summeOhneSkonto ? `mit Skonto <b data-summe="mit">${eur(g.summeMitSkonto)}</b>` : '', g.summeRuecklass ? `Rücklässe <b data-summe="ruecklass">${eur(g.summeRuecklass)}</b>` : '', g.summeDifferenz && g.schluessel !== 'differenzen' ? `Differenzen <b>${eur(g.summeDifferenz)}</b>` : ''].filter(Boolean).join(' · ');
    return `<section class="ue-abschnitt fae-gruppe" id="fae-${g.schluessel}" data-gruppe="${g.schluessel}" aria-labelledby="fae-${g.schluessel}-h">
      <h2 class="ue-h fae-h" id="fae-${g.schluessel}-h"><span>${esc(g.titel)} <span class="${rot ? 'rot' : ''}">· ${g.anzahl}</span></span>${g.schluessel === 'differenzen' ? `<span class="fae-summe" data-summe="differenz">${eur(g.summeDifferenz)}</span>` : g.summeOhneSkonto ? summe : ''}</h2>
      <div class="ue-karte">${g.eintraege.map(zeile).join('')}</div>
      ${fuss ? `<p class="fae-fuss">${fuss}</p>` : ''}
    </section>`;
  }
  function zeichne() {
    const leer = d.gruppen.every((g) => !g.eintraege.length);
    el.innerHTML = `<div class="page ue-page fae-page" id="faelligkeiten">
      <p class="ue-kopf" id="fae-kopf">Stand ${esc(fmt.datumLang(d.heute))} · diese Woche bis ${esc(tag(d.wocheBis))}</p>
      ${offenGesamtHtml(d.offenGesamt)}
      ${leer ? `<div class="ue-erledigt" id="fae-leer" role="status">${ic('check')}<span>Nichts offen – keine Rechnung und kein Rücklass fällig.</span></div>` : d.gruppen.map(gruppe).join('')}
      <p class="fae-hinweis">Beträge: Zahlbetrag = Brutto − Deckungs- und Haftrücklass, abzüglich bereits bezahlt (Reverse Charge: Brutto = Netto). „mit Skonto“ zusätzlich abzüglich des noch möglichen Skontos – nur solange die Skontofrist läuft. „Offen gesamt“ = offene Zahlbeträge (inkl. strittiger Differenzen) + einbehaltene Rücklässe − Überzahlungen.</p>
    </div>`;
  }
  const neu = async () => { try { d = await get('/faelligkeiten'); } catch (_) { return; } if (ctx.aktuell()) zeichne(); };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-bezahlt]'); if (b) return bezahltDialog(ctx, b.dataset.bezahlt, neu);
    const z = e.target.closest('[data-rechnung]'); if (z) rechnungOeffnen(ctx, z.dataset.rechnung, neu);
  });
  zeichne();
}
