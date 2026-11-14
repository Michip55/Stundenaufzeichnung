// Assistenten im Bautagesbericht (API.md 12.9–12.12): Fernunterschrift per Link, Diktat, Lieferschein, Papierbericht.
// Alle liefern nur VORSCHLÄGE – übernommen wird erst nach Bestätigung, und die ausgefüllten Felder werden markiert.
import { get, post, del } from '../api.js';
import { ic, esc, fmt, parseZahl, banner, dialog, bestaetigen, toast, integAktiv, integMitKi, integVon, $, $$ } from '../ui.js';
import { bildVerkleinern } from '../schaden-offline.js';

const kiChip = (quelle) => (quelle === 'ki' ? `<span class="chip xs st-blue" data-quelle="ki">${ic('spark')}mit KI verbessert</span>` : `<span class="chip xs st-grey" data-quelle="${esc(quelle || 'regeln')}">ohne KI – feste Regeln</span>`);

/* =================== A · Fernunterschrift per Link =================== */
const LINK_STATUS = { offen: ['Link gesendet – wartet', 'st-amber'], verwendet: ['unterschrieben', 'st-green'], abgelaufen: ['abgelaufen', 'st-grey'], ungueltig: ['ungültig (Bericht geändert)', 'st-grey'] };
export const fernKnopf = (integ) => (integAktiv(integ, 'fernunterschrift')
  ? `<button type="button" class="btn ghost block" data-fern-anfordern>${ic('send')}Unterschrift per Link anfordern</button><div data-fern-links></div>`
  : '');
export async function fernLinksZeigen(box, id, darf) {
  if (!box) return;
  let liste = [];
  try { liste = await get(`/berichte/${id}/unterschrift-links`); } catch (e) { return; }
  box.innerHTML = liste.length ? `<ul class="plain rows fern-links">${liste.slice(0, 5).map((l) => { const [t, c] = LINK_STATUS[l.status] || [l.status, 'st-grey']; return `<li data-link="${l.id}" data-link-status="${esc(l.status)}"><span class="grow"><b>${esc(l.name || 'Bauherr')}</b><small>${esc(fmt.zeitpunkt(l.erstellt))}${l.status === 'offen' ? ` · gültig bis ${esc(fmt.zeitpunkt(l.ablauf))}` : ''}</small></span><span class="chip xs ${c}">${esc(t)}</span>${l.status === 'offen' && darf ? `<button type="button" class="btn ghost sm" data-link-weg="${l.id}">Widerrufen</button>` : ''}</li>`; }).join('')}</ul>` : '';
}
export function fernDialog({ id, bs, integ, fertig }) {
  const mailGeht = integAktiv(integ, 'email');
  const d = dialog({ titel: 'Unterschrift per Link anfordern', breit: true, inhalt: `<div id="fern-dlg" class="stack-s">
    <form id="fl-form" class="stack-s" novalidate>
      <p>Der Bauherr bekommt einen Link, sieht den Bericht (ohne Preise) am eigenen Handy und unterschreibt dort. Der Link gilt 72 Stunden und nur einmal.</p>
      <label class="field"><span class="field-label">Name des Bauherrn / Vertreters (optional)</span><input class="input lg" name="name" maxlength="100" value="${esc(bs.bauherrVertreter || '')}"></label>
      ${mailGeht ? `<label class="field"><span class="field-label">Zusätzlich per E-Mail senden an (optional)</span><input class="input lg" type="email" name="email" maxlength="200" value="${esc(String(bs.agEmail || '').split(',')[0].trim())}"></label>` : ''}
      ${banner('info', 'Wird der Bericht danach noch geändert, verliert der Link seine Gültigkeit – dann bitte einen neuen anfordern.')}
      <p class="form-err" role="alert" hidden></p>
      <button type="submit" class="btn primary lg block" id="fl-ok">${ic('send')}Link erzeugen</button>
    </form></div>`, fuss: '<button class="btn ghost" type="button" data-zu>Schließen</button>' });
  $('#fl-form', d.el).addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const err = $('.form-err', d.el);
    const body = { rolle: 'bh' };
    if (String(f.get('name') || '').trim()) body.name = String(f.get('name')).trim();
    if (String(f.get('email') || '').trim()) body.email = String(f.get('email')).trim();
    $('#fl-ok', d.el).disabled = true;
    let r;
    try { r = await post(`/berichte/${id}/unterschrift-link`, body); } catch (x) { err.hidden = false; err.textContent = x.message; $('#fl-ok', d.el).disabled = false; return; }
    const text = `Bautagesbericht ${bs.name || ''} – bitte hier ansehen und unterschreiben: ${r.url}`;
    $('#fern-dlg', d.el).innerHTML = `<div class="stack-s" data-link-erzeugt>
      ${banner('ok', `Link erzeugt${body.email ? ' und per E-Mail gesendet' : ''}. Gültig bis ${esc(fmt.zeitpunkt(r.ablauf))} Uhr.`)}
      <div class="link-box"><code id="fl-url">${esc(r.url)}</code><button type="button" class="btn ghost sm" id="fl-kopie">${ic('copy')}Kopieren</button></div>
      <div class="btn-zeile">${navigator.share ? `<button type="button" class="btn primary" id="fl-teilen">${ic('send')}Teilen …</button>` : ''}
        <a class="btn ghost" id="fl-whatsapp" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener noreferrer">Per WhatsApp senden</a>
        <a class="btn ghost" id="fl-mail" href="mailto:?subject=${encodeURIComponent('Bautagesbericht zur Unterschrift')}&body=${encodeURIComponent(text)}">Per E-Mail-Programm</a></div>
      <p class="muted sm">Den Link nur an die Person schicken, die unterschreiben soll – wer ihn hat, kann unterschreiben.</p></div>`;
    const kopie = async () => { try { await navigator.clipboard.writeText(r.url); toast('Link kopiert.'); } catch (x) { const c = $('#fl-url', d.el); const sel = window.getSelection(); const rg = document.createRange(); rg.selectNodeContents(c); sel.removeAllRanges(); sel.addRange(rg); toast('Bitte den markierten Link kopieren.', 'warn'); } };
    $('#fl-kopie', d.el).addEventListener('click', kopie);
    const t = $('#fl-teilen', d.el);
    if (t) t.addEventListener('click', async () => { try { await navigator.share({ title: 'Bautagesbericht zur Unterschrift', text: `Bautagesbericht ${bs.name || ''} – bitte ansehen und unterschreiben:`, url: r.url }); } catch (x) { if (x && x.name !== 'AbortError') kopie(); } });
    if (fertig) fertig();
  });
}
export async function fernWiderrufen(id, lid) {
  if (!(await bestaetigen('Link widerrufen?', 'Mit diesem Link kann dann nicht mehr unterschrieben werden.', 'Widerrufen', 'danger'))) return false;
  try { await del(`/berichte/${id}/unterschrift-links/${lid}`); toast('Link widerrufen.'); return true; } catch (x) { toast(x.message, 'warn'); return false; }
}

/* =================== Vorschlags-Dialog (Diktat, Lieferschein) =================== */
// abschnitte: [{schluessel, titel, zeilen:[{id, text, wert?, einheit?, zahl:true|false}]}] → Promise<{[schluessel]: [{id, wert}]} | null>
export function vorschlagDialog({ titel, quelle, abschnitte, unklar = [], hinweis = '', text = '', ok = 'In den Bericht übernehmen' }) {
  const gefuellt = abschnitte.filter((a) => a.zeilen.length);
  const n = gefuellt.reduce((s, a) => s + a.zeilen.length, 0);
  const d = dialog({ titel, breit: true, inhalt: `<div id="vorschlag" class="stack-s" data-anzahl="${n}">
    <p><span class="chip st-blue" id="vs-chip">${ic('spark')}${n} ${n === 1 ? 'Feld' : 'Felder'} erkannt – bitte prüfen</span> ${kiChip(quelle)}</p>
    ${hinweis ? banner('info', esc(hinweis)) : ''}
    ${n ? gefuellt.map((a) => `<fieldset class="field vs-abschnitt" data-abschnitt="${a.schluessel}"><legend class="field-label">${esc(a.titel)}</legend>
      ${a.zeilen.map((z, i) => `<label class="vs-zeile"><input type="checkbox" data-vs="${a.schluessel}:${i}" checked><span class="grow">${esc(z.text)}</span>${z.zahl ? `<input class="input s num" data-vs-wert="${a.schluessel}:${i}" inputmode="decimal" value="${esc(fmt.zahl(z.wert))}" aria-label="${esc(z.text)} – Wert"><small>${esc(z.einheit || '')}</small>` : ''}</label>`).join('')}</fieldset>`).join('')
      : banner('warn', 'Es wurde nichts erkannt, das in den Bericht übernommen werden kann. Bitte die Angaben händisch eintragen.')}
    ${unklar.length ? `<div class="vs-unklar" data-unklar="${unklar.length}">${banner('warn', `<b>Nicht zugeordnet – bitte selbst eintragen:</b> ${unklar.map((u) => esc(typeof u === 'string' ? u : u.text || '')).join(' · ')}`)}</div>` : ''}
    ${text ? `<details class="einzeln"><summary>Erkannter Text</summary><pre class="vs-text">${esc(text)}</pre></details>` : ''}
    <p class="muted sm">Das ist nur ein Vorschlag. Übernommene Felder sind im Bericht markiert und können jederzeit geändert werden.</p></div>`,
    fuss: `<button class="btn ghost" type="button" data-zu>Verwerfen</button><button class="btn primary" type="button" id="vs-ok" ${n ? '' : 'disabled'}>${esc(ok)}</button>` });
  $('#vs-ok', d.el).addEventListener('click', () => {
    const erg = {};
    for (const a of gefuellt) {
      erg[a.schluessel] = [];
      a.zeilen.forEach((z, i) => {
        if (!$(`[data-vs="${a.schluessel}:${i}"]`, d.el).checked) return;
        let wert = z.wert;
        if (z.zahl) { const w = parseZahl($(`[data-vs-wert="${a.schluessel}:${i}"]`, d.el).value); if (!Number.isFinite(w) || w < 0) return; wert = w; }
        erg[a.schluessel].push({ ...z, wert });
      });
    }
    d.zu(erg);
  });
  return d.geschlossen.then((w) => (w && typeof w === 'object' ? w : null));
}

/* =================== B · Diktat =================== */
export function diktatHtml(integ) {
  if (!integAktiv(integ, 'diktat')) return '';
  const sprach = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  return `<div class="diktat" id="diktat">
    <div class="diktat-kopf"><b>${ic('mic')}Diktieren</b>${integMitKi(integ, 'diktat') ? `<span class="chip xs st-blue">${ic('spark')}mit KI verbessert</span>` : '<span class="chip xs st-grey">ohne KI</span>'}</div>
    <label class="vh" for="diktat-text">Diktierter Text</label>
    <textarea class="input area diktat-text" id="diktat-text" rows="4" maxlength="5000" placeholder="Hier tippen und die Mikrofon-Taste der Tastatur verwenden – einfach erzählen: „Bagger 9 Tonnen sechs Stunden, 42 Tonnen Frostschutz eingebaut, Randleisten versetzt …“"></textarea>
    <p class="muted sm">${ic('info', 'xs')} <b>Mikrofon-Taste der Tastatur verwenden</b> – das Handy schreibt mit. Danach „Felder ausfüllen“: BauTag schlägt Geräte, Material und Text vor.</p>
    <div class="btn-zeile">${sprach ? `<button type="button" class="btn ghost" id="diktat-mic" aria-pressed="false">${ic('mic')}Aufnahme im Browser</button>` : ''}<button type="button" class="btn primary" id="diktat-los">${ic('spark')}Felder ausfüllen</button></div>
  </div>`;
}
// Optionale Spracheingabe des Browsers (wo vorhanden); die Tastatur-Diktierfunktion geht immer
export function diktatMikro(knopf, feld) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return;
  let r = null;
  knopf.addEventListener('click', () => {
    if (r) { r.stop(); return; }
    r = new SR(); r.lang = 'de-AT'; r.continuous = true; r.interimResults = false;
    r.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) feld.value = `${feld.value}${feld.value && !/\s$/.test(feld.value) ? ' ' : ''}${e.results[i][0].transcript.trim()}`; };
    r.onerror = () => { toast('Die Aufnahme im Browser funktioniert hier nicht – bitte die Mikrofon-Taste der Tastatur verwenden.', 'warn'); };
    r.onend = () => { r = null; knopf.setAttribute('aria-pressed', 'false'); knopf.classList.remove('an'); };
    try { r.start(); knopf.setAttribute('aria-pressed', 'true'); knopf.classList.add('an'); } catch (x) { r = null; }
  });
}
export async function diktatVorschlag(id, text) {
  const r = await post('/bericht-assistent/text', { berichtId: Number(id), text });
  const v = r.vorschlag || {};
  const wahl = await vorschlagDialog({
    titel: 'Vorschlag aus dem Diktat', quelle: r.quelle, hinweis: r.hinweis || '', unklar: r.unklar || [],
    abschnitte: [
      { schluessel: 'geraete', titel: 'Geräte (Stunden)', zeilen: (v.geraete || []).map((g) => ({ id: g.geraetId, text: g.name, wert: g.stunden, einheit: 'Std.', zahl: true })) },
      { schluessel: 'material', titel: 'Material (Menge)', zeilen: (v.material || []).map((m) => ({ id: m.materialId, text: m.name, wert: m.menge, einheit: m.einheit, zahl: true })) },
      { schluessel: 'personal', titel: 'Personal (Arbeitszeit)', zeilen: (v.personal || []).filter((p) => p.von && p.bis).map((p) => ({ id: p.benutzerId, text: `${p.name}: ${p.von}–${p.bis}`, von: p.von, bis: p.bis })) },
      { schluessel: 'arbeitsleistung', titel: 'Arbeitsleistung', zeilen: v.arbeitsleistung ? [{ id: 'a', text: v.arbeitsleistung, wert: v.arbeitsleistung }] : [] },
      { schluessel: 'vorkommnisse', titel: 'Besondere Vorkommnisse', zeilen: v.vorkommnisse ? [{ id: 'v', text: v.vorkommnisse, wert: v.vorkommnisse }] : [] },
      { schluessel: 'regie', titel: 'Regieleistungen (Stunden)', zeilen: (v.regie || []).map((x, i) => ({ id: i, text: x.text, wert: x.stunden, einheit: 'Std.', zahl: true })) },
    ],
  });
  return wahl ? { ...wahl, quelle: r.quelle } : null;
}

/* =================== C · Lieferschein =================== */
export const lieferscheinKnopf = (integ) => {
  const i = integVon(integ, 'lieferschein');
  if (!i) return '';
  const ocr = integAktiv(integ, 'lieferschein');
  return `<span class="assist-knopf"><button type="button" class="btn ghost sm" id="ls-foto">${ic('scan')}Lieferschein fotografieren</button><input type="file" id="ls-datei" class="vh" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Lieferschein fotografieren oder auswählen">
    <small>${ocr ? (integMitKi(integ, 'lieferschein') ? 'Mengen werden vorgeschlagen – mit KI verbessert.' : 'Mengen werden per Texterkennung vorgeschlagen (ohne KI).') : esc(i.hinweis || 'Das Foto wird angehängt; Texterkennung ist nicht eingerichtet.')}</small></span>`;
};
export async function lieferscheinVorschlag(id, datei) {
  const bild = await bildVerkleinern(datei, 2000, 0.88);
  const r = await post(`/berichte/${id}/lieferschein`, { bildBase64: bild.daten, dateiname: bild.dateiname });
  if (!r.vorschlag) { toast([r.hinweis || 'Foto angehängt – Texterkennung ist nicht eingerichtet, bitte die Mengen händisch eintragen.', r.kiHinweis].filter(Boolean).join(' '), 'warn'); return { foto: r.foto, wahl: null }; }
  const v = r.vorschlag;
  const kopf = [v.lieferant, v.lieferscheinNr ? `Lieferschein ${v.lieferscheinNr}` : '', v.datum ? fmt.datum(v.datum) : ''].filter(Boolean).join(' · ');
  const wahl = await vorschlagDialog({
    titel: 'Vorschlag aus dem Lieferschein', quelle: r.quelle, hinweis: [r.hinweis, r.kiHinweis].filter(Boolean).join(' '), unklar: r.unklar || [], text: r.text || '',
    abschnitte: [
      { schluessel: 'material', titel: 'Material (Menge wird dazugezählt)', zeilen: (v.material || []).map((m) => ({ id: m.materialId, text: m.name, wert: m.menge, einheit: m.einheit, zahl: true })) },
      { schluessel: 'beistellung', titel: 'Vermerk bei „Fremdmaterial“', zeilen: kopf ? [{ id: 'k', text: kopf, wert: kopf }] : [] },
    ],
  });
  return { foto: r.foto, wahl: wahl ? { ...wahl, quelle: r.quelle } : null };
}

/* =================== D · Papierbericht =================== */
export const papierKnopf = (integ, darf) => {
  const i = integVon(integ, 'papier');
  if (!i || !darf) return '';
  return `<span class="assist-knopf"><button type="button" class="btn ghost sm" id="pp-foto">${ic('camera')}Papierbericht anhängen</button><input type="file" id="pp-datei" class="vh" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Papierbericht fotografieren oder auswählen">
    <small>Foto des ausgefüllten Formulars als Anhang (höchstens 5 Seiten). ${integMitKi(integ, 'papier') ? 'Handschrift wird mit KI gelesen.' : 'Gedruckte Felder (Datum, KST) werden geprüft – Handschrift nur mit der optionalen KI.'}</small></span>`;
};
export async function papierAnhaengen(id, datei) {
  const bild = await bildVerkleinern(datei, 2200, 0.88);
  const r = await post(`/berichte/${id}/papier`, { bildBase64: bild.daten, dateiname: bild.dateiname });
  const v = r.vorschlag || {};
  dialog({ titel: 'Papierbericht angehängt', inhalt: `<div class="stack-s" id="papier-erg" data-passt="${v.passt === false ? 'nein' : v.passt ? 'ja' : 'unbekannt'}">
    ${banner('ok', 'Das Foto ist als Anhang beim Bericht gespeichert.')}
    ${v.datum || v.kst ? `<dl class="def-list tight">${v.datum ? `<div><dt>Erkanntes Datum</dt><dd>${esc(fmt.datum(v.datum))}</dd></div>` : ''}${v.kst ? `<div><dt>Erkannte Kostenstelle</dt><dd>${esc(v.kst)}</dd></div>` : ''}</dl>` : ''}
    ${v.passt === false ? banner('warn', '<b>Achtung:</b> Datum oder Kostenstelle am Papier passen nicht zu diesem Bericht – bitte prüfen, ob das Foto beim richtigen Bericht liegt.') : v.passt ? banner('info', 'Datum und Kostenstelle am Papier passen zu diesem Bericht.') : ''}
    ${banner('info', esc(r.hinweis || 'Erkannt werden nur gedruckte Felder. Handschrift kann mit der optionalen KI-Unterstützung gelesen werden.'))}${r.kiHinweis ? `<p class="muted sm" id="papier-ki-hinweis">${esc(r.kiHinweis)}</p>` : ''}</div>`, fuss: '<button class="btn primary" type="button" data-zu>Schließen</button>' });
  return r.foto;
}
// Liste: Papierbericht nur erkennen (ohne Speichern), um den passenden Bericht anzulegen
export async function papierErkennen(datei) {
  const bild = await bildVerkleinern(datei, 2200, 0.88);
  return post('/berichte/papier', { bildBase64: bild.daten, dateiname: bild.dateiname });
}
