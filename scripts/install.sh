#!/bin/bash
# ── FilaFlow — Installation sur Raspberry Pi ─────────────────────
# Usage : sudo bash scripts/install.sh
#
# Sur un Pi où PrintFlow est déjà installé :
#   - la configuration Nginx existante est conservée (elle relaie déjà
#     vers 127.0.0.1:3000, le port de FilaFlow) ;
#   - le service PrintFlow est arrêté et désactivé (même port, même lecteur
#     NFC), sans rien supprimer : retour arrière possible à tout moment.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

INSTALL_DIR="/opt/filaflow"
DB_NAME="filaflow"
DB_USER="filaflow"
DB_PASS="${DB_PASS:-filaflow_secret}"
VERSION=$(python3 -c "import json;print(json.load(open('${PROJECT_DIR}/backend/package.json'))['version'])" 2>/dev/null || echo "?")

if [ "$EUID" -ne 0 ]; then echo "❌ À lancer avec sudo."; exit 1; fi

echo "========================================"
echo "  FilaFlow v${VERSION} — Installation"
echo "========================================"
echo "  Dossier projet : ${PROJECT_DIR}"
echo ""

# ── 1. Dépendances système ────────────────────────────────
echo "[1/7] Dépendances système..."
apt-get update -qq
apt-get install -y -qq curl nginx mariadb-server nodejs npm cifs-utils rsync unzip \
  pcscd pcsc-tools libpcsclite-dev build-essential python3 openssl
NODE_VER=$(node --version 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1)
if [ -z "$NODE_VER" ] || [ "$NODE_VER" -lt 18 ]; then
  echo "  Node.js 18+ requis. Installation via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "  ✓ Node.js $(node --version)"

# ── 2. MariaDB ────────────────────────────────────────────
echo "[2/7] Base de données..."
systemctl enable --now mariadb --quiet
mariadb -e "CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mariadb -e "CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';"
mariadb -e "CREATE USER IF NOT EXISTS '${DB_USER}'@'%' IDENTIFIED BY '${DB_PASS}';"
mariadb -e "GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';"
mariadb -e "GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'%';"
mariadb -e "FLUSH PRIVILEGES;"
mariadb --default-character-set=utf8mb4 ${DB_NAME} < "${PROJECT_DIR}/sql/schema.sql"
echo "  ✓ Base '${DB_NAME}' prête (schéma idempotent)"

# ── 3. NFC (ACR122U) ──────────────────────────────────────
echo "[3/7] Lecteur NFC..."
systemctl enable --now pcscd --quiet
mkdir -p /etc/polkit-1/rules.d
cat > /etc/polkit-1/rules.d/99-pcscd-filaflow.rules << 'POLKIT'
polkit.addRule(function(action, subject) {
    if (action.id == "org.debian.pcsc-lite.access_pcsc" ||
        action.id == "org.debian.pcsc-lite.access_card") {
        if (subject.local) { return polkit.Result.YES; }
    }
});
POLKIT
cat > /etc/modprobe.d/blacklist-nfc.conf << 'MODEOF'
blacklist pn533
blacklist pn533_usb
blacklist nfc
MODEOF
modprobe -r pn533_usb pn533 nfc 2>/dev/null || true
echo "  ✓ pcscd actif, modules noyau NFC blacklistés"

# ── 4. Fichiers ───────────────────────────────────────────
echo "[4/7] Copie des fichiers dans ${INSTALL_DIR}..."
mkdir -p ${INSTALL_DIR}/backups
rsync -a --exclude 'node_modules' --exclude '.env' --exclude '.git' \
  "${PROJECT_DIR}/backend" "${PROJECT_DIR}/frontend" "${PROJECT_DIR}/sql" "${PROJECT_DIR}/scripts" \
  ${INSTALL_DIR}/
if [ ! -f ${INSTALL_DIR}/backend/.env ]; then
  cat > ${INSTALL_DIR}/backend/.env << ENVEOF
DB_HOST=localhost
DB_PORT=3306
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASS}
DB_NAME=${DB_NAME}
PORT=3000
NODE_ENV=production
ENCRYPTION_KEY=$(openssl rand -hex 32)
ENVEOF
  chmod 600 ${INSTALL_DIR}/backend/.env
  echo "  ✓ .env créé (nouvelle clé de chiffrement)"
else
  echo "  ✓ .env existant conservé"
fi

# ── 5. Modules Node.js ────────────────────────────────────
echo "[5/7] Modules Node.js..."
cd ${INSTALL_DIR}/backend
npm install --omit=dev --quiet
echo "  ✓ Modules installés"

# ── 6. Nginx ──────────────────────────────────────────────
echo "[6/7] Nginx..."
if [ -e /etc/nginx/sites-enabled/printflow ]; then
  echo "  ✓ Configuration PrintFlow existante détectée : conservée telle quelle"
  echo "    (HTTPS, Adminer, Cockpit… elle relaie déjà vers le port 3000)"
elif [ -e /etc/nginx/sites-enabled/filaflow ]; then
  echo "  ✓ Configuration FilaFlow déjà en place"
else
  cp "${PROJECT_DIR}/nginx/filaflow.conf" /etc/nginx/sites-available/filaflow
  ln -sf /etc/nginx/sites-available/filaflow /etc/nginx/sites-enabled/filaflow
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl enable nginx --quiet && systemctl restart nginx
  echo "  ✓ Nginx configuré (HTTP). HTTPS : sudo bash ${SCRIPT_DIR}/setup-https.sh"
fi

# ── 7. Service systemd ────────────────────────────────────
echo "[7/7] Service systemd..."
if systemctl list-unit-files printflow.service >/dev/null 2>&1 && \
   systemctl list-unit-files printflow.service | grep -q printflow; then
  echo "  PrintFlow est installé sur ce Pi (même port 3000, même lecteur NFC)."
  read -p "  Arrêter et désactiver PrintFlow maintenant ? (rien n'est supprimé) [o/N] " stop_pf
  if [[ "$stop_pf" == "o" || "$stop_pf" == "O" ]]; then
    systemctl disable --now printflow --quiet || true
    echo "  ✓ PrintFlow arrêté et désactivé"
  else
    echo "  ⚠ FilaFlow ne sera pas démarré tant que PrintFlow tourne."
    echo "    Plus tard : sudo systemctl disable --now printflow && sudo systemctl enable --now filaflow"
  fi
fi
cp "${PROJECT_DIR}/systemd/filaflow.service" /etc/systemd/system/filaflow.service
systemctl daemon-reload
systemctl enable filaflow --quiet
if ! systemctl is-active --quiet printflow 2>/dev/null; then
  systemctl restart filaflow
  sleep 4
  if systemctl is-active --quiet filaflow; then
    IP=$(hostname -I | awk '{print $1}')
    echo ""
    echo "========================================"
    echo "  ✅ FilaFlow v${VERSION} installé et démarré"
    echo "========================================"
    echo "  Accès        : http://${IP}  (ou votre adresse HTTPS habituelle)"
    echo "  Logs         : sudo journalctl -u filaflow -f"
    echo "  Données      : sudo bash ${INSTALL_DIR}/scripts/migrate-from-printflow.sh"
    echo "  Retour à PrintFlow : sudo systemctl disable --now filaflow && sudo systemctl enable --now printflow"
    echo ""
  else
    echo "  ⚠ Le service n'a pas démarré : sudo journalctl -u filaflow -n 50"
    exit 1
  fi
fi
