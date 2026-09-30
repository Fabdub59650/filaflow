#!/bin/bash
# ── FilaFlow — Configuration HTTPS ──────────────────────
# Usage : sudo bash scripts/setup-https.sh
# Génère un certificat SSL auto-signé pour <nom d'hôte>.local et l'IP du Pi,
# puis configure Nginx en HTTPS. Si la configuration Nginx est déjà en HTTPS,
# seul le certificat est régénéré : la configuration existante (Adminer,
# Cockpit…) est conservée.

set -e

INSTALL_DIR="/opt/filaflow"
SSL_DIR="/etc/nginx/ssl/filaflow"
NGINX_CONF="/etc/nginx/sites-available/filaflow"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   FilaFlow — Configuration HTTPS    ║"
echo "╚══════════════════════════════════════╝"
echo ""

# Vérifier que Nginx est installé
if ! command -v nginx &>/dev/null; then
  echo "❌ Nginx n'est pas installé. Lancez d'abord install.sh"
  exit 1
fi

# Vérifier que OpenSSL est disponible
if ! command -v openssl &>/dev/null; then
  echo "[+] Installation d'OpenSSL..."
  apt-get install -y openssl
fi

# Récupérer l'IP locale
LOCAL_IP=$(hostname -I | awk '{print $1}')
HOSTNAME=$(hostname)
echo "  IP locale     : $LOCAL_IP"
echo "  Nom d'hôte    : $HOSTNAME"
echo ""

# Demander confirmation
read -p "  Configurer HTTPS pour ce Pi ? [o/N] " confirm
if [[ "$confirm" != "o" && "$confirm" != "O" ]]; then
  echo "  Annulé."
  exit 0
fi

echo ""
echo "[1/4] Création du dossier SSL..."
mkdir -p "$SSL_DIR"

echo "[2/4] Génération du certificat auto-signé (valable 10 ans)..."
openssl req -x509 -nodes -days 3650 \
  -newkey rsa:2048 \
  -keyout "$SSL_DIR/privkey.pem" \
  -out    "$SSL_DIR/fullchain.pem" \
  -subj "/CN=${HOSTNAME}.local/O=FilaFlow/OU=Local" \
  -addext "subjectAltName=DNS:${HOSTNAME}.local,IP:${LOCAL_IP}" \
  2>/dev/null

chmod 600 "$SSL_DIR/privkey.pem"
chmod 644 "$SSL_DIR/fullchain.pem"
echo "  ✓ Certificat généré dans $SSL_DIR"

echo "[3/4] Configuration Nginx HTTPS..."
if [ -f "$NGINX_CONF" ] && grep -q "listen 443" "$NGINX_CONF"; then
  echo "  ✓ Configuration HTTPS existante conservée (seul le certificat est renouvelé)"
  if ! grep -q "$SSL_DIR/" "$NGINX_CONF"; then
    echo "  ⚠ Cette configuration ne pointe pas vers $SSL_DIR :"
    grep -n "ssl_certificate" "$NGINX_CONF" || true
    echo "    Adaptez les lignes ssl_certificate pour utiliser le nouveau certificat."
  fi
else
cat > "$NGINX_CONF" << NGINXEOF
# FilaFlow — Configuration Nginx avec HTTPS
# Générée par setup-https.sh le $(date '+%d/%m/%Y')

# Redirection HTTP → HTTPS
server {
    listen 80;
    server_name _;
    return 301 https://\$host\$request_uri;
}

# HTTPS
server {
    listen 443 ssl;
    server_name _;

    ssl_certificate     $SSL_DIR/fullchain.pem;
    ssl_certificate_key $SSL_DIR/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 10m;

    # Sécurité
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-Content-Type-Options nosniff;

    # Taille max upload (restauration de sauvegardes)
    client_max_body_size 100M;

    # Proxy vers FilaFlow Node.js
    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_cache_bypass \$http_upgrade;

        # SSE — critique pour le NFC (connexion longue durée)
        proxy_buffering    off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
NGINXEOF
ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/filaflow
echo "  ✓ Configuration Nginx mise à jour"
fi

echo "[4/4] Test et rechargement de Nginx..."
if nginx -t 2>/dev/null; then
  systemctl reload nginx
  echo "  ✓ Nginx rechargé"
else
  echo "  ❌ Erreur de configuration Nginx :"
  nginx -t
  exit 1
fi

# Exporter le certificat pour les appareils clients
CERT_EXPORT="$INSTALL_DIR/filaflow-ca.crt"
cp "$SSL_DIR/fullchain.pem" "$CERT_EXPORT"
chmod 644 "$CERT_EXPORT"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   ✅  HTTPS configuré avec succès !                      ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "  🔒 FilaFlow accessible sur :"
echo "     https://${HOSTNAME}.local  ou  https://$LOCAL_IP"
echo ""
echo "  ⚠  Le navigateur affichera un avertissement la première fois."
echo "     Pour l'éviter, installez le certificat sur vos appareils :"
echo ""
echo "  📄 Certificat à installer : $CERT_EXPORT"
echo ""
echo "  Mac :"
echo "    Copier le fichier sur le Mac puis double-cliquer"
echo "    → Trousseaux d'accès → Faire confiance → Toujours"
echo ""
echo "  iPhone / iPad :"
echo "    Envoyer par AirDrop ou mail → Réglages"
echo "    → Général → Gestion des profils → Faire confiance"
echo ""
echo "  Android :"
echo "    Réglages → Sécurité → Installer certificat → CA"
echo ""
