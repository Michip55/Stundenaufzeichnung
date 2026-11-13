'use strict';
/**
 * Budget-Alarm (Konzept 4.11): je Baustelle und Schwelle einmalig; erneut scharf, wenn die
 * Schwelle wieder unterschritten wird, nachdem sich die Budget-Basis geändert hat.
 * Empfänger: Bauleiter der Baustelle, Büro, GF (laut Einstellung) – nie Polier/Mitarbeiter.
 */
const { kalkulationFuer, ladeBaustelle, parseJson, ladePreise } = require('./daten');
const { istKritisch, KRITISCH_PP, KRITISCH_AB_LEISTUNG } = require('./kalkulation');
const { kontext, darfKalk } = require('./rechte');

const NIE_EMPFAENGER = ['polier', 'mitarbeiter'];

function benachrichtige(db, { benutzerId, typ, titel, text, zeit, baustelleId = null, schluessel = null }) {
  return db.lauf(`INSERT INTO benachrichtigung (benutzer_id, typ, titel, text, zeit, gelesen, baustelle_id, schluessel)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?) ON CONFLICT(benutzer_id, schluessel) DO NOTHING`,
  benutzerId, typ, titel, text, zeit, baustelleId, schluessel).changes > 0;
}

/** Empfänger eines Budget-Alarms für eine Baustelle */
function budgetEmpfaenger(db, bs) {
  const emp = parseJson(bs.empfaenger, { bauleiter: true, buero: true, gf: true });
  const kandidaten = [];
  if (emp.bauleiter && bs.bauleiter_id) {
    const b = db.eins('SELECT * FROM benutzer WHERE id = ? AND aktiv = 1', bs.bauleiter_id);
    if (b) kandidaten.push(b);
  }
  if (emp.buero) kandidaten.push(...db.alle("SELECT * FROM benutzer WHERE rolle = 'buero' AND aktiv = 1"));
  if (emp.gf) kandidaten.push(...db.alle("SELECT * FROM benutzer WHERE rolle = 'gf' AND aktiv = 1"));
  const gesehen = new Set();
  return kandidaten.filter((b) => {
    if (gesehen.has(b.id) || NIE_EMPFAENGER.includes(b.rolle)) return false;
    gesehen.add(b.id);
    return darfKalk(kontext(db, b), bs);
  });
}

const pz = (x) => (x == null ? '–' : x.toLocaleString('de-AT', { maximumFractionDigits: 1 }));

/**
 * Prüft das Budget einer Baustelle und löst neue Alarme aus.
 * @returns {string[]} neu ausgelöste Stufen ('80','90','100','kritisch')
 */
function pruefeBudget(bt, baustelleId, { anlass = '', benutzerId = null, preise } = {}) {
  const { db } = bt;
  const bs = ladeBaustelle(db, baustelleId);
  if (!bs || bs.intern) return [];
  const k = kalkulationFuer(db, bs, preise);
  const v = k.budgetVerbrauchProzent;
  const ls = k.leistungsstandProzent;
  const basis = k.auftragGesamt;
  const zeit = bt.uhr().toISOString();
  const bestehend = new Map(db.alle('SELECT * FROM budget_alarm WHERE baustelle_id = ?', bs.id).map((a) => [a.schwelle, a]));
  const neu = [];

  return db.transaktion(() => {
    if (v != null) {
      for (const s of k.schwellen) {
        const key = String(s);
        if (v >= s) {
          if (!bestehend.has(key)) {
            db.lauf('INSERT INTO budget_alarm (baustelle_id, schwelle, ausgeloest, verbrauch, leistungsstand, basis) VALUES (?, ?, ?, ?, ?, ?)', bs.id, key, zeit, v, ls, basis);
            neu.push(key);
          }
        } else if (bestehend.has(key) && bestehend.get(key).basis !== basis) {
          db.lauf('DELETE FROM budget_alarm WHERE baustelle_id = ? AND schwelle = ?', bs.id, key);
        }
      }
      const kritPP = ls != null && ls >= KRITISCH_AB_LEISTUNG && v - ls > KRITISCH_PP;
      if (kritPP && !bestehend.has('kritisch')) {
        db.lauf('INSERT INTO budget_alarm (baustelle_id, schwelle, ausgeloest, verbrauch, leistungsstand, basis) VALUES (?, ?, ?, ?, ?, ?)', bs.id, 'kritisch', zeit, v, ls, basis);
        neu.push('kritisch');
      } else if (!kritPP && bestehend.has('kritisch')) {
        db.lauf("DELETE FROM budget_alarm WHERE baustelle_id = ? AND schwelle = 'kritisch'", bs.id);
      }
    }
    if (!neu.length) return neu;

    const name = bs.kurz || bs.name;
    const zahlen = neu.filter((x) => x !== 'kritisch').map(Number);
    const hoechste = zahlen.length ? Math.max(...zahlen) : null;
    const krit = neu.includes('kritisch') || istKritisch(v, ls);
    let titel, text;
    if (hoechste != null && hoechste >= 100) {
      titel = `Budget-Alarm: ${name}`;
      text = `${name}: ${hoechste} % der Auftragssumme erreicht (Budget-Verbrauch ${pz(v)} %, Leistungsstand ${pz(ls)} %).`;
    } else if (hoechste != null) {
      titel = `Budget-Warnung: ${name}`;
      text = `${name}: Budget ${hoechste} % erreicht (Verbrauch ${pz(v)} %, Leistungsstand ${pz(ls)} %).`;
    } else {
      titel = `Budget kritisch: ${name}`;
      text = `${name}: Kosten laufen der Leistung davon – Budget-Verbrauch ${pz(v)} % bei Leistungsstand ${pz(ls)} %.`;
    }
    if (krit && hoechste != null && hoechste < 100) text += ' Kritisch: Verbrauch liegt mehr als 10 Prozentpunkte über dem Leistungsstand.';

    const empfaenger = budgetEmpfaenger(db, bs);
    for (const e of empfaenger) {
      benachrichtige(db, { benutzerId: e.id, typ: 'budget', titel, text, zeit, baustelleId: bs.id, schluessel: `budget:${bs.id}:${neu.join('+')}:${zeit}` });
    }
    db.protokolliere({
      zeit, benutzerId, art: 'budget_alarm', objekt: `baustelle:${bs.id}`,
      neu: { stufen: neu, verbrauch: v, leistungsstand: ls },
      text: `Budget-Alarm ${bs.kst} (${neu.join(', ')})${anlass ? ' nach ' + anlass : ''}. In-App an: ${empfaenger.map((e) => e.name).join(', ') || 'niemand'}. Push/E-Mail nicht gesendet – Integration nicht angebunden.`
    });
    return neu;
  });
}

function pruefeAlleBudgets(bt, opt = {}) {
  const preise = ladePreise(bt.db);
  const out = {};
  for (const b of bt.db.alle('SELECT id FROM baustelle WHERE intern = 0')) {
    const n = pruefeBudget(bt, b.id, { ...opt, preise });
    if (n.length) out[b.id] = n;
  }
  return out;
}

module.exports = { benachrichtige, budgetEmpfaenger, pruefeBudget, pruefeAlleBudgets, NIE_EMPFAENGER };
