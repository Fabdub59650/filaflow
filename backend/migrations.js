/**
 * migrations.js — Mises à niveau de la base appliquées au démarrage du service
 *
 * Filet de sécurité : sql/schema.sql reste la référence (rejoué par scripts/patch.sh), mais une mise à jour
 * qui oublie de le rejouer ne doit pas casser l'application. Chaque instruction est idempotente.
 * À chaque changement de schéma, ajouter ici la même instruction que dans sql/schema.sql.
 */
const db = require('./db');

const STATEMENTS = [
  // v1.10.0 — Inventaire
  "ALTER TABLE `filaments` ADD COLUMN IF NOT EXISTS `inventory_checked_at` datetime DEFAULT NULL",
  // v1.13.0 — Pesées suspectes
  "ALTER TABLE `filament_weighings` ADD COLUMN IF NOT EXISTS `flag` varchar(120) DEFAULT NULL",
];

async function run() {
  for (const sql of STATEMENTS) {
    try { await db.query(sql); }
    catch (e) { console.warn('[Migration] Échec :', sql.slice(0, 70), '→', e.message); }
  }
}

module.exports = { run };
