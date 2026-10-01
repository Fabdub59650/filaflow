/**
 * inventory.js — Inventaire des bobines : poids à vérifier
 *
 * Une bobine active est « à vérifier » quand :
 *  - âge         : jamais pesée, ou dernière pesée / dernière validation plus vieille que N jours ;
 *  - événement   : la dernière pesée remonte au-dessus de la précédente (+ tolérance),
 *                  ou son poids brut est inférieur à la tare ;
 *  - état        : tare manquante, poids restant supérieur au poids total, 0 g mais non archivée.
 * « Confirmer » efface l'âge et les événements (jusqu'à la prochaine pesée) ;
 * les problèmes d'état ne disparaissent qu'une fois corrigés sur la fiche.
 */
const router = require('express').Router();
const db = require('../db');
const { logAction } = require('../history');

const REASONS = {
  rising:       { group: 'incoherence', label: 'Poids qui remonte' },
  under_tare:   { group: 'incoherence', label: 'Pesée sous la tare' },
  over_full:    { group: 'incoherence', label: 'Plus que plein' },
  no_tare:      { group: 'donnees',     label: 'Tare manquante' },
  empty_active: { group: 'donnees',     label: 'Vide mais active' },
  never:        { group: 'age',         label: 'Jamais pesée' },
  stale:        { group: 'age',         label: 'Pesée ancienne' },
};
const GROUP_RANK = { incoherence: 0, donnees: 1, age: 2 };

async function readSettings() {
  const [rows] = await db.query(
    "SELECT key_name, value FROM settings WHERE key_name IN ('inventory_enabled','inventory_days','inventory_tolerance')");
  const s = Object.fromEntries(rows.map(r => [r.key_name, r.value]));
  return {
    enabled:   s.inventory_enabled !== 'false',
    days:      Math.max(1, parseInt(s.inventory_days, 10) || 90),
    tolerance: Math.max(0, parseFloat(s.inventory_tolerance) || 10),
  };
}

const toDate = v => (v ? new Date(String(v).replace(' ', 'T')) : null);
const num = v => (v === null || v === undefined || v === '' ? null : parseFloat(v));

async function computeInventory() {
  const settings = await readSettings();
  if (!settings.enabled) return { settings, items: [], count: 0 };

  const [filaments] = await db.query(
    `SELECT id, name, brand, material, color_name, color_hex, spool_number, spool_label, location,
            weight_total, weight_remaining, spool_weight, inventory_checked_at
     FROM filaments WHERE archived = 0`);
  if (!filaments.length) return { settings, items: [], count: 0 };

  // Deux dernières pesées de chaque bobine active
  const [weighings] = await db.query(
    `SELECT filament_id, gross_weight, spool_weight, net_weight, created_at FROM (
       SELECT w.*, ROW_NUMBER() OVER (PARTITION BY w.filament_id ORDER BY w.created_at DESC, w.id DESC) AS rn
       FROM filament_weighings w JOIN filaments f ON f.id = w.filament_id AND f.archived = 0
     ) t WHERE rn <= 2 ORDER BY filament_id, rn`);
  const byFil = new Map();
  for (const w of weighings) {
    if (!byFil.has(w.filament_id)) byFil.set(w.filament_id, []);
    byFil.get(w.filament_id).push(w);
  }

  const now = Date.now();
  const tol = settings.tolerance;
  const items = [];
  for (const f of filaments) {
    const [last, prev] = byFil.get(f.id) || [];
    const lastAt = last ? toDate(last.created_at) : null;
    const checkedAt = toDate(f.inventory_checked_at);
    // Une validation postérieure à la dernière pesée efface les alertes liées à cette pesée
    const eventCleared = checkedAt && lastAt && checkedAt >= lastAt;
    const refDate = [lastAt, checkedAt].filter(Boolean).sort((a, b) => b - a)[0] || null;
    const reasons = [];
    const add = (code, detail) => reasons.push({ code, ...REASONS[code], detail });

    const remaining = num(f.weight_remaining), total = num(f.weight_total), tare = num(f.spool_weight);

    if (last && prev && !eventCleared && num(last.net_weight) > num(prev.net_weight) + tol) {
      add('rising', `${Math.round(num(prev.net_weight))} g → ${Math.round(num(last.net_weight))} g`);
    }
    if (last && !eventCleared && num(last.spool_weight) > 0 && num(last.gross_weight) < num(last.spool_weight)) {
      add('under_tare', `brut ${Math.round(num(last.gross_weight))} g < tare ${Math.round(num(last.spool_weight))} g`);
    }
    if (total !== null && remaining !== null && remaining > total + tol) {
      add('over_full', `${Math.round(remaining)} g pour ${Math.round(total)} g au total`);
    }
    if (!tare) add('no_tare', 'poids de la bobine vide non renseigné');
    if (remaining !== null && remaining <= 0) add('empty_active', '0 g restant');
    if (!refDate) add('never', 'aucune pesée');
    else {
      const days = Math.floor((now - refDate.getTime()) / 86400000);
      if (days >= settings.days) add('stale', `il y a ${days} jours`);
    }

    if (reasons.length) {
      const rank = Math.min(...reasons.map(r => GROUP_RANK[r.group]));
      items.push({
        ...f,
        last_weighed_at: last ? last.created_at : null,
        reasons,
        rank,
        // « Confirmer » n'a de sens que s'il reste une alerte d'âge ou d'événement
        can_confirm: reasons.some(r => ['rising', 'under_tare', 'never', 'stale'].includes(r.code)),
      });
    }
  }
  items.sort((a, b) =>
    a.rank - b.rank ||
    (toDate(a.last_weighed_at)?.getTime() || 0) - (toDate(b.last_weighed_at)?.getTime() || 0) ||
    String(a.name).localeCompare(String(b.name), 'fr'));
  return { settings, items, count: items.length };
}

router.get('/', async (req, res) => {
  try { res.json(await computeInventory()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Nombre de bobines à vérifier (compteur du menu Outils)
router.get('/count', async (req, res) => {
  try {
    const r = await computeInventory();
    res.json({ enabled: r.settings.enabled, count: r.count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// « J'ai vérifié, le poids est bon » : pas de fausse pesée, une date de validation
router.post('/:id/confirm', async (req, res) => {
  try {
    const [[f]] = await db.query('SELECT id, name, weight_remaining FROM filaments WHERE id=?', [req.params.id]);
    if (!f) return res.status(404).json({ error: 'Bobine introuvable' });
    await db.query('UPDATE filaments SET inventory_checked_at = NOW() WHERE id=?', [f.id]);
    await logAction('filament', f.id, 'inventory',
      'Inventaire : poids confirmé (' + Math.round(parseFloat(f.weight_remaining) || 0) + 'g) — ' + f.name);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.computeInventory = computeInventory;
