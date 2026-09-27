const router = require('express').Router();
const db     = require('../db');

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
    const { filament_id, gross_weight, notes } = req.body;
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
        filament_id: updated.id, name: updated.name, color_hex: updated.color_hex,
        net: netWeight, previous: prevWeight, total: parseFloat(updated.weight_total) || 0,
        at: new Date().toISOString(),
      });
    } catch (_) {}

    res.status(201).json({ weighing, filament: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
