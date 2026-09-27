/**
 * history.js — Historique des modifications (audit log)
 */
const db = require('./db');

async function logAction(entity, entityId, action, detail, diff = null) {
  try {
    await db.query(
      `INSERT INTO audit_log (entity, entity_id, action, detail, diff)
       VALUES (?,?,?,?,?)`,
      [entity, entityId, action, detail, diff ? JSON.stringify(diff) : null]
    );
  } catch(e) { console.warn('[History] Erreur log:', e.message); }
}

function setupRoutes(router) {
  // GET /api/history
  router.get('/', async (req, res) => {
    try {
      const limit  = Math.min(parseInt(req.query.limit) || 50, 200);
      const entity = req.query.entity || null;

      // Cas spécial : historique NFC depuis nfc_write_history
      if (entity === 'nfc') {
        const [rows] = await db.query(
          `SELECT h.*, f.name AS filament_name, f.material, f.color_hex
           FROM nfc_write_history h
           LEFT JOIN filaments f ON f.id = h.filament_id
           ORDER BY h.written_at DESC LIMIT ?`, [limit]
        );
        return res.json(rows.map(r => ({
          id: r.id,
          entity: 'nfc',
          entity_id: r.filament_id,
          action: 'nfc_write',
          detail: 'Écriture NFC — ' + (r.filament_name||'Filament') +
                  ' · ' + (r.format||'') + ' · UID: ' + (r.uid||'?'),
          created_at: r.written_at,
          diff: null,
          uid: r.uid, format: r.format, material: r.material,
          color_hex: r.color_hex, filament_name: r.filament_name,
        })));
      }

      let sql = 'SELECT * FROM audit_log';
      const params = [];
      if (entity) { sql += ' WHERE entity=?'; params.push(entity); }
      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);
      const [rows] = await db.query(sql, params);
      rows.forEach(r => {
        try { r.diff = r.diff ? JSON.parse(r.diff) : null; } catch(_) { r.diff = null; }
      });
      res.json(rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/history/:entity/:id
  router.get('/:entity/:id', async (req, res) => {
    try {
      const [rows] = await db.query(
        'SELECT * FROM audit_log WHERE entity=? AND entity_id=? ORDER BY created_at DESC LIMIT 30',
        [req.params.entity, req.params.id]
      );
      rows.forEach(r => {
        try { r.diff = r.diff ? JSON.parse(r.diff) : null; } catch(_) { r.diff = null; }
      });
      res.json(rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
}

module.exports = { logAction, setupRoutes };
