/**
 * tigertag.js — Route webhook pour TigerTag Scale (ESP32)
 *
 * L'ESP32 envoie après chaque pesée stable :
 *   POST /api/tigertag/webhook
 *   { "uid_hex": "04A3B2C1D0E5F6", "weight_gross": 875 }
 *
 * PrintFlow :
 *   1. Trouve le filament par nfc_uid
 *   2. Calcule le poids net (brut - bobine vide)
 *   3. Enregistre la pesée
 *   4. Met à jour weight_remaining
 *   5. Retourne { success, net_weight, filament_name, weight_available }
 *      (format compatible avec la réponse cloud TigerTag)
 */

const router = require('express').Router();
const db     = require('../db');

// Diffusion temps réel vers les navigateurs ouverts (flux SSE du module NFC)
function notify(event, data) {
  try { require('../nfc').broadcast(event, data); } catch (_) {}
}

// POST /api/tigertag/webhook
router.post('/webhook', async (req, res) => {
  try {
    // Jeton optionnel : si le réglage tigertag_webhook_token est renseigné,
    // la balance doit l'envoyer (en-tête X-Webhook-Token ou ?token=… dans l'URL).
    const [[tokRow]] = await db.query(
      "SELECT value FROM settings WHERE key_name='tigertag_webhook_token'"
    ).catch(function(){ return [[null]]; });
    const expected = tokRow?.value || '';
    if (expected) {
      const given = req.headers['x-webhook-token'] || req.query?.token || '';
      if (given !== expected) {
        return res.status(401).json({ success: false, error: 'Jeton webhook invalide' });
      }
    }

    const { uid_hex, weight_gross, notes } = req.body;

    if (!uid_hex || weight_gross === undefined) {
      return res.status(400).json({
        success: false,
        error: 'uid_hex et weight_gross requis'
      });
    }

    const grossW = parseFloat(weight_gross);
    if (isNaN(grossW) || grossW < 0) {
      return res.status(400).json({
        success: false,
        error: 'weight_gross invalide'
      });
    }

    // Chercher le filament par nfc_uid (insensible à la casse)
    const [[filament]] = await db.query(
      'SELECT * FROM filaments WHERE UPPER(nfc_uid) = UPPER(?) AND archived = 0',
      [uid_hex.trim()]
    );

    if (!filament) {
      notify('weighing_unknown', { uid: uid_hex.trim(), gross: grossW, at: new Date().toISOString() });
      return res.status(404).json({
        success: false,
        error: 'Filament non trouvé pour cet UID NFC : ' + uid_hex,
        uid_hex: uid_hex
      });
    }

    const spoolWeight = parseFloat(filament.spool_weight) || 0;
    const netWeight   = Math.max(0, grossW - spoolWeight);
    const prevWeight  = parseFloat(filament.weight_remaining);

    // Enregistrer la pesée
    const [result] = await db.query(
      `INSERT INTO filament_weighings
         (filament_id, gross_weight, spool_weight, net_weight, previous_weight, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [filament.id, grossW, spoolWeight, netWeight, prevWeight,
       notes || 'TigerTag Scale (auto)']
    );

    // Mettre à jour le stock
    await db.query(
      'UPDATE filaments SET weight_remaining=? WHERE id=?',
      [netWeight, filament.id]
    );

    // Enregistrer dans l'historique NFC
    await db.query(
      `INSERT INTO nfc_write_history (filament_id, uid, format, material, subtype, color_hex)
       VALUES (?, ?, 'tigertag', ?, ?, ?)`,
      [filament.id, uid_hex, filament.material || null,
       filament.elegoo_subtype || null, filament.color_hex || null]
    ).catch(() => {}); // non bloquant

    console.log(`[TigerTag] Pesée auto : ${filament.name} — brut ${grossW}g → net ${netWeight}g`);

    notify('weighing', {
      source: 'scale', weighing_id: result.insertId,
      filament_id: filament.id, name: filament.name, color_hex: filament.color_hex,
      net: netWeight, previous: prevWeight, total: parseFloat(filament.weight_total) || 0,
      at: new Date().toISOString(),
    });

    // Réponse compatible avec le format cloud TigerTag
    // L'ESP32 utilisera weight_available pour afficher le poids net
    res.json({
      success:          true,
      weight_available: netWeight,      // poids net filament (affiché sur OLED)
      weight:           grossW,         // poids brut envoyé
      container_weight: spoolWeight,    // poids bobine vide
      filament_name:    filament.name,
      filament_id:      filament.id,
      material:         filament.material,
      color_hex:        filament.color_hex,
      weighing_id:      result.insertId
    });

  } catch (e) {
    console.error('[TigerTag] Erreur webhook:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/tigertag/status — état de la configuration
router.get('/status', async (req, res) => {
  try {
    const [[setting]] = await db.query(
      "SELECT value FROM settings WHERE key_name = 'tigertag_enabled'"
    ).catch(() => [[null]]);
    const enabled = setting?.value === 'true';

    // Dernières pesées TigerTag Scale (notes contenant 'TigerTag')
    const [recent] = await db.query(`
      SELECT w.*, f.name AS filament_name, f.color_hex, f.material
      FROM filament_weighings w
      JOIN filaments f ON f.id = w.filament_id
      WHERE w.notes LIKE '%TigerTag%'
      ORDER BY w.created_at DESC LIMIT 10
    `);

    res.json({ enabled, recent });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
