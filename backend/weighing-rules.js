/**
 * weighing-rules.js — Règles de cohérence d'une pesée, partagées par tous les points d'entrée
 * (saisie manuelle, balance TigerTag, pesée kiosque) et par l'Inventaire.
 *
 * Règles :
 *  - rising     : le poids net remonte au-dessus de la pesée précédente (+ tolérance)
 *  - over_full  : le poids net dépasse le poids total de la bobine neuve (+ tolérance)
 *  - under_tare : le poids brut est inférieur à la tare
 *  - drop       : baisse de plus de 50 % du poids d'origine depuis la pesée précédente
 *
 * Réglages : weighing_check_enabled (défaut true), inventory_tolerance (g, partagé avec l'Inventaire),
 *            spool_empty_grams (poids sous lequel on propose d'archiver, défaut 15 g).
 */
const db = require('./db');

const LABELS = {
  rising:     'Poids qui remonte',
  over_full:  'Plus que plein',
  under_tare: 'Pesée sous la tare',
  drop:       'Baisse brutale',
};
const DROP_RATIO = 0.5;

async function getSettings() {
  const [rows] = await db.query(
    "SELECT key_name, value FROM settings WHERE key_name IN ('weighing_check_enabled','inventory_tolerance','spool_empty_grams')");
  const s = Object.fromEntries(rows.map(r => [r.key_name, r.value]));
  const tol = parseFloat(s.inventory_tolerance);
  const empty = parseFloat(s.spool_empty_grams);
  return {
    enabled:   s.weighing_check_enabled !== 'false',
    tolerance: Number.isFinite(tol) ? Math.max(0, tol) : 10,
    emptyGrams: Number.isFinite(empty) ? Math.max(0, empty) : 15,
  };
}

// Poids net de la pesée précédente d'une bobine (null s'il n'y en a pas)
async function lastNet(filamentId) {
  const [[w]] = await db.query(
    'SELECT net_weight FROM filament_weighings WHERE filament_id=? ORDER BY created_at DESC, id DESC LIMIT 1', [filamentId]);
  return w ? parseFloat(w.net_weight) : null;
}

/**
 * @param {{gross:number, spool:number, net:number, lastNet:?number, total:?number, tolerance:number}} p
 * @returns {{code:string, label:string, detail:string}[]}
 */
function check(p) {
  const out = [];
  const add = (code, detail) => out.push({ code, label: LABELS[code], detail });
  const r = n => Math.round(n);
  if (p.lastNet !== null && p.lastNet !== undefined && p.net > p.lastNet + p.tolerance) {
    add('rising', r(p.lastNet) + ' g → ' + r(p.net) + ' g (+' + r(p.net - p.lastNet) + ' g)');
  }
  if (p.total > 0 && p.net > p.total + p.tolerance) {
    add('over_full', r(p.net) + ' g pour ' + r(p.total) + ' g au total');
  }
  if (p.spool > 0 && p.gross < p.spool) {
    add('under_tare', 'brut ' + r(p.gross) + ' g < tare ' + r(p.spool) + ' g');
  }
  if (p.lastNet > 0 && p.total > 0 && (p.lastNet - p.net) > DROP_RATIO * p.total) {
    add('drop', r(p.lastNet) + ' g → ' + r(p.net) + ' g (−' + r(p.lastNet - p.net) + ' g)');
  }
  return out;
}

// Texte stocké dans filament_weighings.flag (colonne de 120 caractères)
const flagText = issues => issues.map(i => i.label).join(' · ').slice(0, 120) || null;

/** Contrôle une pesée pour une bobine donnée ; renvoie { issues, settings, lastNet } */
async function evaluate(filament, gross, spool, net) {
  const settings = await getSettings();
  const ln = await lastNet(filament.id);
  const issues = settings.enabled
    ? check({ gross, spool, net, lastNet: ln, total: parseFloat(filament.weight_total) || 0, tolerance: settings.tolerance })
    : [];
  return { issues, settings, lastNet: ln };
}

const isEmpty = (net, settings, filament) => !filament.archived && net <= settings.emptyGrams;

module.exports = { LABELS, getSettings, lastNet, check, flagText, evaluate, isEmpty };
