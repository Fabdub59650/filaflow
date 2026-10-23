const router = require('express').Router();
const db     = require('../db');
const rules  = require('../weighing-rules');
const { logAction } = require('../history');

// GET /api/weighings?filament_id=X
router.get('/', async (req, res) => {
  try {
    const { filament_id, limit } = req.query;
    let sql = `SELECT w.*, f.name AS filament_name, f.color_hex
               FROM filament_weighings w
               JOIN filaments f ON w.filament_id = f.id
               WHERE 1=1`;
    const params = [];
    if (filament_id) { sql += ' AND w.filament_id=?'; params.push(filament_id); }
    sql += ' ORDER BY w.created_at DESC LIMIT ' + (parseInt(limit) || 100);
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/weighings — enregistrer une pesée et mettre à jour le stock
router.post('/', async (req, res) => {
  try {
    const { filament_id, gross_weight, notes, confirmed } = req.body;
    if (!filament_id || gross_weight === undefined) {
      return res.status(400).json({ error: 'filament_id et gross_weight requis' });
    }

    // Récupérer le filament pour avoir le poids de bobine vide
    const [[filament]] = await db.query('SELECT * FROM filaments WHERE id=?', [filament_id]);
    if (!filament) return res.status(404).json({ error: 'Filament non trouvé' });

    const spoolWeight  = parseFloat(filament.spool_weight) || 0;
    const grossW       = parseFloat(gross_weight);
    const netWeight    = Math.max(0, grossW - spoolWeight);
    const prevWeight   = parseFloat(filament.weight_remaining);

    // Contrôle de cohérence : une pesée inhabituelle doit être confirmée (confirmed: true)
    const ev = await rules.evaluate(filament, grossW, spoolWeight, netWeight);
    if (ev.issues.length && !confirmed) {
      return res.status(409).json({
        error: 'Pesée inhabituelle', suspect: true, issues: ev.issues,
        last_net: ev.lastNet, new_net: netWeight, filament_name: filament.name,
      });
    }

    // Enregistrer la pesée
    const [result] = await db.query(
      `INSERT INTO filament_weighings
         (filament_id, gross_weight, spool_weight, net_weight, previous_weight, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [filament_id, grossW, spoolWeight, netWeight, prevWeight, notes || null]
    );

    // Mettre à jour le poids restant
    await db.query(
      'UPDATE filaments SET weight_remaining=? WHERE id=?',
      [netWeight, filament_id]
    );

    const [[weighing]] = await db.query('SELECT * FROM filament_weighings WHERE id=?', [result.insertId]);
    const [[updated]]  = await db.query('SELECT * FROM filaments WHERE id=?', [filament_id]);

    try {
      require('../nfc').broadcast('weighing', {
        source: 'manual', weighing_id: result.insertId,
        filament_id: updated.id, name: updated.name, spool_number: updated.spool_number || null, color_hex: updated.color_hex,
        net: netWeight, previous: prevWeight, total: parseFloat(updated.weight_total) || 0,
        at: new Date().toISOString(),
      });
    } catch (_) {}

    res.status(201).json({ weighing, filament: updated, spool_empty: rules.isEmpty(netWeight, ev.settings, updated) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/weighings/:id — annuler une pesée (erreur de bobine, mauvaise puce…)
// Si c'est la dernière pesée de la bobine et que son poids restant n'a pas bougé depuis
// (ni impression, ni correction à la main), le poids d'avant la pesée est rétabli.
// Sinon la ligne est supprimée et le poids actuel est laissé tel quel.
router.delete('/:id', async (req, res) => {
  try {
    const [[w]] = await db.query(
      `SELECT w.*, f.name AS filament_name, f.weight_remaining
       FROM filament_weighings w JOIN filaments f ON f.id = w.filament_id WHERE w.id=?`, [req.params.id]);
    if (!w) return res.status(404).json({ error: 'Pesée introuvable' });

    const [[last]] = await db.query(
      'SELECT id FROM filament_weighings WHERE filament_id=? ORDER BY created_at DESC, id DESC LIMIT 1', [w.filament_id]);
    const isLast = !!last && last.id === w.id;
    const unchanged = Math.abs(parseFloat(w.weight_remaining) - parseFloat(w.net_weight)) < 0.01;
    const restored = isLast && unchanged;

    // La pesée suivante repart de l'ancien poids : on lui donne le « avant » de celle qu'on retire
    const [[next]] = await db.query(
      `SELECT id FROM filament_weighings WHERE filament_id=? AND (created_at > ? OR (created_at = ? AND id > ?))
       ORDER BY created_at ASC, id ASC LIMIT 1`, [w.filament_id, w.created_at, w.created_at, w.id]);
    await db.query('DELETE FROM filament_weighings WHERE id=?', [w.id]);
    if (next) await db.query('UPDATE filament_weighings SET previous_weight=? WHERE id=?', [w.previous_weight, next.id]);
    if (restored) {
      await db.query('UPDATE filaments SET weight_remaining=? WHERE id=?', [w.previous_weight, w.filament_id]);
    }
    await logAction('filament', w.filament_id, 'weigh_cancel',
      'Pesée annulée : ' + Math.round(w.net_weight) + 'g — ' + w.filament_name +
      (restored ? ' (restant remis à ' + Math.round(w.previous_weight) + 'g)' : ' (restant inchangé)'),
      { weighing_id: w.id, net_weight: parseFloat(w.net_weight), previous_weight: parseFloat(w.previous_weight), restored });

    const [[filament]] = await db.query('SELECT * FROM filaments WHERE id=?', [w.filament_id]);
    res.json({ ok: true, restored, is_last: isLast, filament });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
