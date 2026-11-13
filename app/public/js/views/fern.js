// Fernunterschrift (API.md 12.9): öffentliche Seite ohne Anmeldung – der Bauherr sieht den Bericht in der Fassung
// für den Auftraggeber (ohne Preise, ohne interne Angaben) und unterschreibt am eigenen Gerät.
import { get, post } from '../api.js';
import { ic, esc, MARK, fmt, banner, laden, $ } from '../ui.js';
import { signaturFeld } from './berichte.js';

const zeile = (k, v) => (v ? `<div><dt>${k}</dt><dd>${v}</dd></div>` : '');
const mehrz = (t) => esc(t || '').replace(/\n/g, '<br>');

export default async function fern(root, token) {
  document.title = 'Bautagesbericht unterschreiben · BauTag';
  const rahmen = (inhalt) => { root.innerHTML = `<div class="fern"><header class="fern-kopf">${MARK}<span><b>BauTag</b><small>Bautagesbericht unterschreiben</small></span></header><main class="fern-inhalt" id="fern">${inhalt}</main></div>`; };
  rahmen(laden('Bericht wird geladen …'));
  let d;
  try { d = await get(`/fern/${encodeURIComponent(token)}`); }
  catch (e) {
    const weg = e.status === 410 || e.status === 404;
    rahmen(`<section class="card state big" data-fern="${weg ? 'ungueltig' : 'fehler'}">${ic(weg ? 'lock' : e.netz ? 'wifiOff' : 'alert')}<h2>${weg ? 'Dieser Link ist nicht mehr gültig' : e.status === 429 ? 'Zu viele Aufrufe' : 'Der Bericht kann gerade nicht geladen werden'}</h2><p>${esc(weg ? 'Der Link wurde schon verwendet, ist abgelaufen oder der Bericht wurde inzwischen geändert. Bitte bei der Baufirma einen neuen Link anfordern.' : e.netz ? 'Keine Verbindung – bitte später noch einmal versuchen.' : e.message)}</p></section>`);
    return;
  }
  const b = d.bericht || {}; const bs = b.baustelle || {};
  const firma = (d.firma && (d.firma.name || d.firma)) || '';
  rahmen(`
    <section class="card pad"><h1 class="h-gross">Bautagesbericht</h1><p class="muted">${esc(firma)}</p>
      <dl class="def-list tight">${zeile('Bauvorhaben', esc(bs.name || ''))}${zeile('Auftraggeber', esc(bs.auftraggeber || ''))}${zeile('Datum', esc(b.datum ? fmt.datumLang(b.datum) : ''))}${zeile('Kostenstelle', esc(bs.kst || ''))}${zeile('Wetter', esc(b.wetter ? (typeof b.wetter === 'string' ? b.wetter : b.wetter.text || '') : ''))}</dl>
      <a class="btn ghost" id="fern-pdf" href="/api/fern/${encodeURIComponent(token)}/pdf" target="_blank" rel="noopener">${ic('file')}Bericht als PDF ansehen</a></section>
    <section class="card" aria-labelledby="f-pers"><div class="card-h pad-h"><h3 id="f-pers">Personal</h3><b>${fmt.zahl((b.personal || []).reduce((s, p) => s + (p.stunden || 0), 0))} Std.</b></div>
      ${(b.personal || []).length ? `<ul class="plain rows">${b.personal.map((p) => `<li><span class="grow"><b>${esc(p.name || '')}</b><small>${[p.von1 && p.bis1 ? `${esc(p.von1)}–${esc(p.bis1)}` : '', p.von2 && p.bis2 ? `${esc(p.von2)}–${esc(p.bis2)}` : ''].filter(Boolean).join(' · ')}</small></span><b class="num">${fmt.zahl(p.stunden || 0)} Std.</b></li>`).join('')}</ul>` : '<p class="muted sm pad-s">Keine Einträge.</p>'}</section>
    ${(b.geraete || []).length ? `<section class="card" aria-labelledby="f-ger"><div class="card-h pad-h"><h3 id="f-ger">Geräte</h3></div><ul class="plain rows">${b.geraete.map((g) => `<li><span class="grow"><b>${esc(g.name || '')}</b></span><b class="num">${fmt.zahl(g.stunden || 0)} Std.</b></li>`).join('')}</ul></section>` : ''}
    ${(b.material || []).length ? `<section class="card" aria-labelledby="f-mat"><div class="card-h pad-h"><h3 id="f-mat">Material</h3></div><ul class="plain rows">${b.material.map((m) => `<li><span class="grow"><b>${esc(m.name || '')}</b></span><b class="num">${fmt.zahl(m.menge || 0)} ${esc(m.einheit || '')}</b></li>`).join('')}</ul></section>` : ''}
    <section class="card pad stack-s"><h3 class="h-klein">Arbeitsleistung</h3><p>${mehrz(b.arbeitsleistung) || '<span class="muted">–</span>'}</p>
      ${b.materialbeistellung && (b.materialbeistellung.eigen || b.materialbeistellung.fremd) ? `<h3 class="h-klein">Materialbeistellung</h3><p>${b.materialbeistellung.eigen ? `<b>Eigenmaterial:</b> ${mehrz(b.materialbeistellung.eigen)}<br>` : ''}${b.materialbeistellung.fremd ? `<b>Fremdmaterial:</b> ${mehrz(b.materialbeistellung.fremd)}` : ''}</p>` : ''}
      ${b.paletten && (b.paletten.euro || b.paletten.weissenboeck) ? `<h3 class="h-klein">Paletten retour</h3><p>Euro: ${fmt.zahl(b.paletten.euro || 0, 0)} · Weissenböck: ${fmt.zahl(b.paletten.weissenboeck || 0, 0)}</p>` : ''}
      ${(b.regie || []).length ? `<h3 class="h-klein">Regieleistungen</h3><ul class="punkte">${b.regie.map((r) => `<li>${esc(r.text || '')} – ${fmt.zahl(r.stunden || 0)} Std.</li>`).join('')}</ul>` : ''}
      ${b.vorkommnisse ? `<h3 class="h-klein">Besondere Vorkommnisse</h3><p>${mehrz(b.vorkommnisse)}</p>` : ''}</section>
    <section class="card pad" id="fern-sig" aria-labelledby="f-sig"><h3 class="h-klein" id="f-sig">${d.rolle === 'an' ? 'Unterschrift Auftragnehmer' : 'Unterschrift Bauherr bzw. bevollmächtigter Vertreter'}</h3>
      <form id="fern-form" class="stack-s" novalidate>
        <div class="sig-box" id="fern-box"><div class="sig-h"><div><small>Bitte im Feld unterschreiben</small></div><button type="button" class="btn ghost sm" id="fern-clear">Löschen</button></div>
          <div class="sig-pad"><canvas aria-label="Unterschriftsfeld" role="img"></canvas><span class="sig-ph">${ic('sign')}Hier unterschreiben</span><span class="sig-line"></span></div></div>
        <label class="field"><span class="field-label">Name in Blockschrift</span><input class="input lg" name="name" required minlength="3" maxlength="100" value="${esc(d.nameVorschlag || '')}" autocomplete="name"></label>
        <label class="check-inline"><input type="checkbox" name="ok" required> Ich habe den Bautagesbericht gelesen und bestätige ihn mit meiner Unterschrift.</label>
        <p class="form-err" role="alert" hidden></p>
        <button type="submit" class="btn primary lg block" id="fern-ok">${ic('check')}Unterschreiben</button>
        <p class="muted sm">Der Link gilt bis ${esc(fmt.zeitpunkt(d.ablauf))} Uhr und kann nur einmal verwendet werden.</p>
      </form></section>`);
  const box = $('#fern-box', root); const pad = signaturFeld($('canvas', box));
  $('canvas', box).addEventListener('gezeichnet', () => box.classList.add('hat'));
  $('#fern-clear', root).addEventListener('click', () => { pad.loeschen(); box.classList.remove('hat'); });
  window.addEventListener('resize', () => { if (!box.classList.contains('hat')) pad.loeschen(); });
  $('#fern-form', root).addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const err = $('.form-err', root); const zeig = (t) => { err.hidden = !t; err.textContent = t || ''; };
    const name = String(f.get('name') || '').trim();
    if (pad.leer()) return zeig('Bitte zuerst im Feld unterschreiben.');
    if (name.length < 3) return zeig('Bitte den Namen eintragen.');
    if (!f.get('ok')) return zeig('Bitte bestätigen, dass der Bericht gelesen wurde.');
    zeig(''); $('#fern-ok', root).disabled = true;
    try {
      await post(`/fern/${encodeURIComponent(token)}`, { name, bildPng: pad.png(), bestaetigt: true });
      $('#fern', root).innerHTML = `<section class="card state big" data-fern="unterschrieben">${ic('check')}<h2>Danke – der Bericht ist unterschrieben</h2><p>Die Unterschrift von ${esc(name)} wurde übermittelt. Dieses Fenster kann geschlossen werden.</p><a class="btn ghost" href="/api/fern/${encodeURIComponent(token)}/pdf" target="_blank" rel="noopener" hidden>PDF</a></section>`;
    } catch (x) {
      $('#fern-ok', root).disabled = false;
      zeig(x.status === 410 ? 'Dieser Link ist nicht mehr gültig – bitte bei der Baufirma einen neuen anfordern.' : x.netz ? 'Keine Verbindung – bitte noch einmal versuchen.' : x.message);
    }
  });
}
