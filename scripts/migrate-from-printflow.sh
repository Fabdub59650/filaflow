#!/bin/bash
# ── FilaFlow — Migration des données depuis PrintFlow ─────────────
# Copie l'inventaire filament (bobines, pesées, puces NFC, bobines de
# référence, historique filaments et réglages utiles) de la base
# PrintFlow vers la base FilaFlow. La base PrintFlow n'est jamais modifiée.
#
# Usage : sudo bash scripts/migrate-from-printflow.sh [--force]
#   --force : écrase une base FilaFlow qui contient déjà des filaments

set -e

SRC_DB="${SRC_DB:-printflow}"
DST_DB="${DST_DB:-filaflow}"
FORCE=0
[ "$1" == "--force" ] && FORCE=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MYSQL="mariadb --default-character-set=utf8mb4"
DUMP="mariadb-dump --default-character-set=utf8mb4 --single-transaction"
TABLES="filaments filament_weighings nfc_write_history spool_weights settings"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ "$EUID" -ne 0 ]; then
  echo "❌ À lancer avec sudo."; exit 1
fi

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   FilaFlow — Migration depuis PrintFlow      ║"
echo "╚══════════════════════════════════════════════╝"
echo "  Source      : ${SRC_DB} (lecture seule)"
echo "  Destination : ${DST_DB}"
echo ""

# ── Vérifications ──────────────────────────────────────────────────
if ! $MYSQL -e "USE \`${SRC_DB}\`" 2>/dev/null; then
  echo "❌ Base source '${SRC_DB}' introuvable."; exit 1
fi
$MYSQL -e "CREATE DATABASE IF NOT EXISTS \`${DST_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

EXISTING=$($MYSQL -N -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='${DST_DB}' AND TABLE_NAME='filaments'")
if [ "$EXISTING" -gt 0 ]; then
  COUNT=$($MYSQL -N -e "SELECT COUNT(*) FROM \`${DST_DB}\`.filaments")
  if [ "$COUNT" -gt 0 ] && [ "$FORCE" -ne 1 ]; then
    echo "❌ La base '${DST_DB}' contient déjà ${COUNT} filament(s)."
    echo "   Relancez avec --force pour l'écraser."
    exit 1
  fi
fi

# ── 1. Copie des tables (structure réelle + données) ──────────────
echo "[1/4] Copie des tables : ${TABLES}"
$DUMP "$SRC_DB" $TABLES > "$TMP/tables.sql"
# Historique : uniquement les entrées liées aux filaments, NFC et réglages
$DUMP "$SRC_DB" audit_log --where="entity IN ('filament','nfc','settings')" > "$TMP/audit.sql"
$MYSQL "$DST_DB" < "$TMP/tables.sql"
$MYSQL "$DST_DB" < "$TMP/audit.sql"

# ── 2. Compléments de schéma (idempotent) ──────────────────────────
echo "[2/4] Application du schéma FilaFlow"
$MYSQL "$DST_DB" < "${PROJECT_DIR}/sql/schema.sql"

# ── 3. Nettoyage des réglages ──────────────────────────────────────
echo "[3/4] Adaptation des réglages"
$MYSQL "$DST_DB" <<'SQL'
-- Réglages des modules supprimés
DELETE FROM settings WHERE
  key_name LIKE 'smtp\_%' OR key_name LIKE 'report\_%' OR key_name LIKE 'tapo\_%'
  OR key_name LIKE 'telegram\_%' OR key_name LIKE 'tg\_%' OR key_name LIKE 'pixelit\_%'
  OR key_name LIKE 'spoolman\_%' OR key_name LIKE 'quote\_%' OR key_name LIKE 'vapid\_%'
  OR key_name LIKE 'maintenance\_%' OR key_name LIKE 'backup\_meta\_%'
  OR key_name IN ('projects_enabled','quotes_enabled','gallery_enabled','dashboard_widgets',
                  'library_path','prints_photo_path','electricity_price_kwh','push_enabled',
                  'report_email','backup_last_run','backup_last_status','_version','_build_date');

-- Identité de l'application
UPDATE settings SET value='FilaFlow' WHERE key_name='app_name';

-- Sauvegardes : dossiers distincts de PrintFlow (la rétention supprime les
-- anciens dossiers datés du dossier cible — ne jamais partager le dossier)
UPDATE settings SET value='/filaflow'              WHERE key_name='backup_nas_folder';
UPDATE settings SET value='/opt/filaflow/backups'  WHERE key_name='backup_path';
UPDATE settings SET value='false'                  WHERE key_name IN ('backup_library_enabled','backup_report_email');

-- Le mot de passe NAS était chiffré avec la clé de PrintFlow : à ressaisir.
-- Sauvegarde désactivée tant qu'elle n'a pas été reconfigurée.
UPDATE settings SET value=''      WHERE key_name='backup_nas_password';
UPDATE settings SET value='false' WHERE key_name='backup_enabled';
SQL

# ── 4. Contrôle ────────────────────────────────────────────────────
echo "[4/4] Contrôle"
for T in filaments filament_weighings nfc_write_history spool_weights audit_log settings; do
  SRC_N=$($MYSQL -N -e "SELECT COUNT(*) FROM \`${SRC_DB}\`.\`${T}\`" 2>/dev/null || echo "?")
  DST_N=$($MYSQL -N -e "SELECT COUNT(*) FROM \`${DST_DB}\`.\`${T}\`")
  printf "  %-20s PrintFlow : %6s   →   FilaFlow : %6s\n" "$T" "$SRC_N" "$DST_N"
done
NFC_N=$($MYSQL -N -e "SELECT COUNT(*) FROM \`${DST_DB}\`.filaments WHERE nfc_uid IS NOT NULL AND nfc_uid<>''")
echo "  Bobines avec puce NFC liée : ${NFC_N}"
echo ""
echo "  ✅ Migration terminée. (audit_log et settings sont volontairement filtrés)"
echo "  ⚠ Pensez à ressaisir le mot de passe NAS et à réactiver la sauvegarde"
echo "    dans Paramètres → Données."
echo ""
