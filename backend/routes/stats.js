/**
 * stats.js — Statistiques du stock de filament
 *
 * Tout est calculé à partir des bobines actives et de l'historique des pesées.
 *
 *  - Stock : poids restant et valeur (prix de la bobine × part restante), par matière et par couleur.
 *  - Fraîcheur : répartition des bobines selon l'âge de leur dernière pesée / validation d'inventaire.
 *  - Consommation estimée : somme des baisses de poids entre deux pesées (previous_weight → net_weight).
 *      · la première pesée de chaque bobine est ignorée : son « poids précédent » est le poids théorique
 *        saisi à la création, pas une pesée, donc l'écart mêle tout ce qui a été imprimé avant le suivi ;
 *      · une pesée où le poids remonte (correction, bobine remplacée) n'est pas de la consommation : ignorée.
 *    La date d'une consommation est celle de la pesée : c'est une estimation, d'autant moins précise
 *    que les pesées sont espacées.
 *  - Bobines dormantes : bobines actives entamées (les bobines neuves sont exclues) avec du filament
 *    restant et aucune baisse de poids mesurée sur la période choisie. La tolérance de l'inventaire
 *    sert de marge de balance : une baisse inférieure n'est pas une utilisation, et une bobine à
 *    moins de cette marge sous son poids total est considérée comme neuve.
 *  - Consommation mensuelle : mêmes baisses de poids, regroupées par mois civil (matière) ; le mois en cours est partiel.
 *  - Autonomie : stock restant d'une couleur (matière + couleur, bobines actives) divisé par sa consommation moyenne
 *    des 90 derniers jours (ou depuis le début du suivi s'il est plus récent, 30 jours au minimum). Une couleur
 *    consommée mais sans bobine active est en rupture. Sous le seuil d'alerte (jours), la couleur est « à racheter » ;
 *    les couleurs consommées de moins de 30 g/mois ne sont pas jugées (trop peu de signal).
 */
const router = require('express').Router();
const db = require('../db');

const toDate = v => (v ? new Date(String(v).replace(' ', 'T')) : null);
const num = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const round1 = n => Math.round(n * 10) / 10;
const DAY = 86400000;
const RATE_WINDOW_DAYS = 90;        // fenêtre de la consommation moyenne pour l'autonomie
const RATE_MIN_WINDOW_DAYS = 30;
const MIN_RATE_G_MONTH = 30;        // en dessous, l'autonomie n'est pas jugée
const ym = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');

// Valeur d'une quantité de filament d'une bobine (prix de la bobine au prorata de son poids total)
function valueOf(grams, price, total) {
  if (!price || price <= 0 || !total || total <= 0 || !grams) return 0;
  return grams * price / total;
}

/**
 * Calcul pur (sans accès base) : testable isolément.
 * @param filaments  lignes de `filaments` (actives et archivées)
 * @param weighings  lignes de `filament_weighings` (toutes, toute période)
 * @param opts       { months: 0 = tout | 3 | 6 | 12, inventoryDays, tolerance (g), now,
 *                     autonomyDays (seuil « à racheter », jours), lowPct (seuil % bobine presque vide, null = aucun) }
 */
function computeStats(filaments, weighings, opts) {
  const now = opts.now || Date.now();
  const months = opts.months > 0 ? opts.months : 0;
  const inventoryDays = Math.max(1, opts.inventoryDays || 90);
  const tolerance = Math.max(0, opts.tolerance === undefined ? 10 : opts.tolerance);
  const since = months ? now - months * 30.4375 * DAY : null;   // début de la période (null = tout)
  const sinceIso = since !== null ? new Date(since) : null;

  const byId = new Map(filaments.map(f => [f.id, f]));

  // Pesées triées par bobine puis par date : la première de chaque bobine est repérée
  const sorted = weighings.slice().sort((a, b) =>
    a.filament_id - b.filament_id ||
    toDate(a.created_at) - toDate(b.created_at) ||
    a.id - b.id);

  const autonomyDays = Math.max(1, opts.autonomyDays || 30);
  const monthMap = new Map();       // 'AAAA-MM' → { matière → grammes }
  const rateByColor = new Map();    // matière|couleur → { grams, hex } sur la fenêtre d'autonomie
  const nowDate = new Date(now);
  const weekAgo = now - 7 * DAY;
  const monthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1);
  let weekGrams = 0, monthGrams = 0, firstWeighAt = null;
  const consByMat = new Map();      // matière → { grams, cost }
  const consByColor = new Map();    // matière|couleur → { grams, cost }
  const lastUseById = new Map();    // bobine → date de la dernière baisse mesurée (période ignorée)
  const lastWeighById = new Map();  // bobine → date de la dernière pesée
  let consGrams = 0, consCost = 0, gramsNoPrice = 0;
  let usedCount = 0, ignoredFirst = 0, ignoredRises = 0;
  let prevFilament = null, seenFirst = false;

  for (const w of sorted) {
    const at = toDate(w.created_at);
    if (w.filament_id !== prevFilament) { prevFilament = w.filament_id; seenFirst = false; }
    const f = byId.get(w.filament_id);
    const prevAt = lastWeighById.get(w.filament_id);
    if (!prevAt || at > prevAt) lastWeighById.set(w.filament_id, at);
    if (!firstWeighAt || at < firstWeighAt) firstWeighAt = at;
    if (!f) continue;

    const isFirst = !seenFirst;
    seenFirst = true;
    const inPeriod = !sinceIso || at >= sinceIso;

    const delta = num(w.previous_weight) - num(w.net_weight);
    if (!Number.isFinite(delta)) continue;

    if (isFirst) { if (inPeriod) ignoredFirst++; continue; }
    if (delta < 0) { if (inPeriod) ignoredRises++; continue; }
    if (delta === 0) continue;

    // Baisse mesurée (au-dessus de la tolérance de la balance) : sert à repérer les bobines dormantes
    if (delta > tolerance) {
      const lu = lastUseById.get(w.filament_id);
      if (!lu || at > lu) lastUseById.set(w.filament_id, at);
    }

    // Consommation par mois civil, consommation récente et débit par couleur : indépendants de la période choisie
    {
      const matKey = f.material || 'autre';
      const mm = monthMap.get(ym(at)) || {};
      mm[matKey] = (mm[matKey] || 0) + delta;
      monthMap.set(ym(at), mm);
      if (at.getTime() >= weekAgo) weekGrams += delta;
      if (at >= monthStart) monthGrams += delta;
      if (at.getTime() >= now - RATE_WINDOW_DAYS * DAY) {
        const rk = matKey + '|' + (f.color_name || '—');
        const r = rateByColor.get(rk) || { grams: 0, hex: f.color_hex || null };
        r.grams += delta; if (!r.hex && f.color_hex) r.hex = f.color_hex;
        rateByColor.set(rk, r);
      }
    }

    if (!inPeriod) continue;

    const price = num(f.price), total = num(f.weight_total);
    const cost = valueOf(delta, price, total);
    consGrams += delta;
    if (cost > 0) consCost += cost; else gramsNoPrice += delta;
    usedCount++;

    const mat = f.material || 'autre';
    const colorKey = mat + '|' + (f.color_name || '—');
    for (const [map, key] of [[consByMat, mat], [consByColor, colorKey]]) {
      const e = map.get(key) || { grams: 0, cost: 0 };
      e.grams += delta; e.cost += cost;
      map.set(key, e);
    }
  }

  // ── Stock (bobines actives) ──────────────────────────────
  const active = filaments.filter(f => !f.archived);
  const stockByMat = new Map();
  const stockByColor = new Map();
  let stockGrams = 0, stockValue = 0, started = 0, noPriceCount = 0;

  for (const f of active) {
    const remaining = Math.max(0, num(f.weight_remaining) || 0);
    const total = num(f.weight_total);
    const price = num(f.price);
    const value = valueOf(remaining, price, total);
    const mat = f.material || 'autre';
    const colorName = f.color_name || '—';

    stockGrams += remaining; stockValue += value;
    if (total && remaining < total) started++;
    if (!price || price <= 0) noPriceCount++;

    const m = stockByMat.get(mat) || { material: mat, count: 0, grams: 0, value: 0, started: 0 };
    m.count++; m.grams += remaining; m.value += value; if (total && remaining < total) m.started++;
    stockByMat.set(mat, m);

    const ck = mat + '|' + colorName;
    const c = stockByColor.get(ck) ||
      { material: mat, color_name: colorName, color_hex: f.color_hex || null, count: 0, grams: 0, value: 0 };
    c.count++; c.grams += remaining; c.value += value;
    stockByColor.set(ck, c);
  }

  // ── Fraîcheur des pesées ─────────────────────────────────
  const fresh = { recent: 0, mid: 0, old: 0, never: 0 };
  const staleItems = [];
  for (const f of active) {
    const lastW = lastWeighById.get(f.id) || null;
    const checked = toDate(f.inventory_checked_at);
    const ref = [lastW, checked].filter(Boolean).sort((a, b) => b - a)[0] || null;
    const staleRow = days => staleItems.push({ id: f.id, name: f.name, material: f.material, color_name: f.color_name,
      color_hex: f.color_hex, spool_number: f.spool_number, days });
    if (!ref) { fresh.never++; staleRow(null); continue; }
    const days = Math.floor((now - ref.getTime()) / DAY);
    if (days <= 30) fresh.recent++;
    else if (days <= inventoryDays) fresh.mid++;
    else { fresh.old++; staleRow(days); }
  }
  staleItems.sort((a, b) => (b.days === null) - (a.days === null) || (b.days || 0) - (a.days || 0));

  // ── Consommation mensuelle (mois civils, le dernier est le mois en cours) ──
  let monthCount = months || 12;
  if (!months) {   // « tout » : depuis le premier mois consommé, 36 mois au plus
    const keys = [...monthMap.keys()].sort();
    if (keys.length) {
      const [fy, fm] = keys[0].split('-').map(Number);
      monthCount = Math.min(36, (nowDate.getFullYear() - fy) * 12 + (nowDate.getMonth() + 1 - fm) + 1);
    }
  }
  const monthList = [];
  for (let i = monthCount - 1; i >= 0; i--) monthList.push(ym(new Date(nowDate.getFullYear(), nowDate.getMonth() - i, 1)));
  const monthMats = new Set();
  monthList.forEach(k => Object.keys(monthMap.get(k) || {}).forEach(m => monthMats.add(m)));
  const monthTotals = monthList.map(k => Math.round(Object.values(monthMap.get(k) || {}).reduce((a, b) => a + b, 0)));
  const monthlyByMat = [...monthMats].map(m => ({
    material: m,
    grams: monthList.map(k => Math.round((monthMap.get(k) || {})[m] || 0)),
  })).sort((a, b) => b.grams.reduce((x, y) => x + y, 0) - a.grams.reduce((x, y) => x + y, 0));

  // ── Autonomie par couleur ───────────────────────────────
  const windowDays = Math.min(RATE_WINDOW_DAYS, Math.max(RATE_MIN_WINDOW_DAYS, firstWeighAt ? (now - firstWeighAt.getTime()) / DAY : RATE_MIN_WINDOW_DAYS));
  const autonomy = [];
  for (const [key, r] of rateByColor) {
    const perMonth = r.grams / windowDays * 30.4375;
    if (perMonth < MIN_RATE_G_MONTH) continue;
    const st = stockByColor.get(key);
    const grams = st ? st.grams : 0;
    const daysLeft = Math.floor(grams / (perMonth / 30.4375));
    const [material, color_name] = key.split('|');
    autonomy.push({
      material, color_name, color_hex: (st && st.color_hex) || r.hex || null,
      spools: st ? st.count : 0, grams: Math.round(grams),
      rate_month: Math.round(perMonth), days_left: daysLeft,
      level: grams <= 0 ? 'rupture' : daysLeft <= autonomyDays ? 'low' : 'ok',
    });
  }
  autonomy.sort((a, b) => a.days_left - b.days_left || b.rate_month - a.rate_month);

  // ── Bobines presque vides (seuil en % du poids total) ───
  const lowItems = [];
  if (opts.lowPct) {
    for (const f of active) {
      const total = num(f.weight_total), remaining = Math.max(0, num(f.weight_remaining) || 0);
      if (!total || total <= 0) continue;
      const pct = remaining / total * 100;
      if (pct <= opts.lowPct) lowItems.push({
        id: f.id, name: f.name, material: f.material, color_name: f.color_name, color_hex: f.color_hex,
        spool_number: f.spool_number, weight_remaining: round1(remaining), pct: Math.round(pct),
      });
    }
    lowItems.sort((a, b) => a.pct - b.pct);
  }

  // ── Bobines dormantes ────────────────────────────────────
  // Sans baisse mesurée sur la période (ou jamais, si la période est « tout »).
  const dormant = [];
  for (const f of active) {
    const remaining = Math.max(0, num(f.weight_remaining) || 0);
    if (remaining <= 0) continue;
    // Bobine neuve (poids restant = poids total, à la tolérance de la balance près) : pas dormante
    const total = num(f.weight_total);
    if (total && remaining >= total - tolerance) continue;
    const lu = lastUseById.get(f.id) || null;
    if (lu && (!sinceIso || lu >= sinceIso)) continue;
    dormant.push({
      id: f.id, name: f.name, material: f.material, color_name: f.color_name, color_hex: f.color_hex,
      spool_number: f.spool_number, location: f.location,
      weight_remaining: round1(remaining),
      value: round1(valueOf(remaining, num(f.price), num(f.weight_total))),
      last_use_at: lu ? lu.toISOString().slice(0, 10) : null,
    });
  }
  dormant.sort((a, b) => b.value - a.value || b.weight_remaining - a.weight_remaining);
  const dormantValue = dormant.reduce((s, d) => s + d.value, 0);

  const outMap = (map, label) => [...map.entries()]
    .map(([k, e]) => ({ ...label(k), grams: Math.round(e.grams), cost: round1(e.cost) }))
    .sort((a, b) => b.grams - a.grams);

  return {
    period: { months: months || null, since: sinceIso ? sinceIso.toISOString().slice(0, 10) : null },
    stock: {
      spools: active.length,
      started,
      grams: Math.round(stockGrams),
      value: round1(stockValue),
      without_price: noPriceCount,
      by_material: [...stockByMat.values()]
        .map(m => ({ ...m, grams: Math.round(m.grams), value: round1(m.value) }))
        .sort((a, b) => b.grams - a.grams),
      by_color: [...stockByColor.values()]
        .map(c => ({ ...c, grams: Math.round(c.grams), value: round1(c.value) }))
        .sort((a, b) => a.material.localeCompare(b.material) || b.grams - a.grams),
    },
    freshness: { ...fresh, inventory_days: inventoryDays, items: staleItems.slice(0, 15) },
    consumption: {
      grams: Math.round(consGrams),
      cost: round1(consCost),
      grams_without_price: Math.round(gramsNoPrice),
      weighings_used: usedCount,
      ignored_first: ignoredFirst,
      ignored_rises: ignoredRises,
      by_material: outMap(consByMat, k => ({ material: k })),
      by_color: outMap(consByColor, k => { const [material, color_name] = k.split('|'); return { material, color_name }; }),
      last_7d_g: Math.round(weekGrams),
      this_month_g: Math.round(monthGrams),
    },
    monthly: { months: monthList, total: monthTotals, by_material: monthlyByMat },
    autonomy: { alert_days: autonomyDays, window_days: Math.round(windowDays), min_rate_month: MIN_RATE_G_MONTH,
      items: autonomy, to_buy: autonomy.filter(a => a.level !== 'ok') },
    low_stock: { threshold: opts.lowPct || null, items: lowItems },
    dormant: { count: dormant.length, value: round1(dormantValue), items: dormant },
  };
}

// Charge les données et calcule les statistiques (utilisé par la page Stats et le rapport hebdomadaire)
async function loadStats(months) {
  const [filaments] = await db.query(
    `SELECT id, name, material, color_name, color_hex, price, weight_total, weight_remaining,
            spool_number, location, archived, inventory_checked_at
     FROM filaments`);
  const [weighings] = await db.query(
    `SELECT id, filament_id, previous_weight, net_weight, created_at FROM filament_weighings`);
  const [settingRows] = await db.query(
    `SELECT key_name, value FROM settings WHERE key_name IN
       ('inventory_days','inventory_tolerance','stock_alert_enabled','stock_alert_threshold','autonomy_alert_days')`);
  const s = Object.fromEntries(settingRows.map(r => [r.key_name, r.value]));
  const inventoryDays = parseInt(s.inventory_days, 10) || 90;
  const tolerance = Number.isFinite(parseFloat(s.inventory_tolerance)) ? parseFloat(s.inventory_tolerance) : 10;
  const lowPct = s.stock_alert_enabled === 'false' ? null : (parseInt(s.stock_alert_threshold, 10) || 20);
  const autonomyDays = parseInt(s.autonomy_alert_days, 10) || 30;
  return computeStats(filaments, weighings, { months, inventoryDays, tolerance, lowPct, autonomyDays });
}

router.get('/', async (req, res) => {
  try {
    const months = [3, 6, 12].includes(parseInt(req.query.months, 10)) ? parseInt(req.query.months, 10) : 0;
    res.json(await loadStats(months));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.computeStats = computeStats;
module.exports.loadStats = loadStats;
