# Reconstruire le Pi FilaFlow après une panne

Procédure pour repartir d'une carte SD neuve à partir des sauvegardes du NAS. Compter environ une heure.

Elle se déroule en trois temps : **récupérer** les sauvegardes, **installer** les outils, **restaurer** la configuration et les données. Puis vérifier.

Chaque dossier de sauvegarde (`/filaflow/AAAA-MM-JJ_HH-MM/` sur le NAS) contient :

| Fichier | Contenu |
|---|---|
| `database.sql.gz` | Dump complet de la base `filaflow` |
| `prepflow.sql.gz` | Dump complet de la base `prepflow` (seulement si PrepFlow est installé) |
| `system.tar.gz` | Configuration du Pi : Nginx et certificats, `.env` de FilaFlow et de PrepFlow, stack Docker Adminer, MariaDB, réseau, service systemd, log2ram, crontabs, `config.txt`/`cmdline.txt`, plus `system-info.txt` (paquets, services, conteneurs, versions) et `LISEZMOI.txt` |

> `system.tar.gz` contient des secrets (clé privée du certificat, mots de passe de la base et du Wi-Fi, clé de chiffrement des mots de passe NAS et SMTP). Ne pas le copier ailleurs que sur le NAS ou sur le Pi.

Le fichier le plus important est **`.env`** : il contient le mot de passe de la base et la clé `ENCRYPTION_KEY`. En le restaurant **avant** d'installer FilaFlow, les mots de passe NAS et SMTP enregistrés dans la base restent lisibles et rien n'est à ressaisir.

---

## A. Récupérer

### 1. Télécharger la dernière sauvegarde

Depuis le Mac, dans le Finder : partage du NAS › `filaflow` › dossier le plus récent. Copier `database.sql.gz`, `prepflow.sql.gz` et `system.tar.gz` sur le bureau.

### 2. Préparer la carte SD

Avec **Raspberry Pi Imager** : Raspberry Pi OS (64 bits), puis dans les réglages avancés :

- nom d'hôte : `filaflow`
- utilisateur : `pi`
- SSH activé
- Wi-Fi si le Pi n'est pas en Ethernet

Démarrer le Pi, puis vérifier depuis le Mac : `ping filaflow.local`.

**Adresse IP** : le Pi doit retrouver `192.168.1.145` (la balance TigerTag appelle cette IP). Si l'IP est réservée dans la box, rien à faire. Sinon, voir l'étape 8.

### 3. Copier les sauvegardes sur le Pi et extraire la configuration

Depuis le Mac :

```bash
scp ~/Desktop/database.sql.gz ~/Desktop/prepflow.sql.gz ~/Desktop/system.tar.gz pi@filaflow.local:~/
```

Sur le Pi :

```bash
mkdir -p ~/restore/sys
sudo tar -xzf ~/system.tar.gz -C ~/restore/sys
sudo ls ~/restore/sys
```

Le dossier est dans le répertoire personnel et non dans `/tmp`, qui est vidé au redémarrage de l'étape 4.

Ne **jamais** extraire `system.tar.gz` directement dans `/` : les fichiers écraseraient la configuration du nouveau système sans contrôle.

---

## B. Installer

### 4. Installations préalables

Tout ce qui n'est pas installé par FilaFlow lui-même, en une fois, suivi d'un seul redémarrage.

```bash
# Système à jour
sudo apt-get update && sudo apt-get full-upgrade -y

# Outils de base
sudo apt-get install -y git rsync

# Docker et Docker Compose (pour Adminer) — script officiel
curl -fsSL https://get.docker.com | sudo sh

# Cockpit (administration système, port 9090)
sudo apt-get install -y cockpit

# log2ram (préserve la carte SD) — méthode officielle : https://github.com/azlux/log2ram
. /etc/os-release
sudo wget -O /usr/share/keyrings/azlux-archive-keyring.gpg https://azlux.fr/repo.gpg
echo "deb [signed-by=/usr/share/keyrings/azlux-archive-keyring.gpg] http://packages.azlux.fr/debian/ $VERSION_CODENAME main" \
  | sudo tee /etc/apt/sources.list.d/azlux.list
sudo apt-get update && sudo apt-get install -y log2ram
```

Si Raspberry Pi OS est basé sur Debian 13 « Trixie » (`echo $VERSION_CODENAME` affiche `trixie`), consulter d'abord la page de log2ram : elle indique un réglage supplémentaire pour cette version.

log2ram demande un redémarrage **avant toute autre installation** :

```bash
sudo reboot
```

Après le redémarrage, vérifier :

```bash
docker --version && docker compose version
systemctl is-active cockpit.socket log2ram
```

### 5. Rattraper les paquets oubliés

L'inventaire de l'ancien Pi liste les paquets installés à la main. Cette commande affiche ceux qui manquent sur le nouveau :

```bash
sudo sed -n '/^### Paquets installés manuellement/,/^###/p' ~/restore/sys/system-info.txt \
  | grep -v '^###' | grep . | sort > ~/restore/paquets-avant.txt
apt-mark showmanual | sort > ~/restore/paquets-apres.txt
comm -23 ~/restore/paquets-avant.txt ~/restore/paquets-apres.txt
```

La liste affichée contient normalement les paquets que FilaFlow installe à l'étape suivante (`nginx`, `mariadb-server`, `nodejs`, `pcscd`, `cifs-utils`…) : pas d'inquiétude pour ceux-là. Réinstaller à la main ce qui reste et qui a encore une utilité (`sudo apt-get install -y <paquet>`).

---

## C. Restaurer

### 6. FilaFlow, avec le `.env` d'origine

`install.sh` installe aussi des paquets (Nginx, MariaDB, Node.js, lecteur NFC), mais il fait partie de la restauration et pas des installations préalables : il doit trouver le `.env` d'origine **déjà en place**. Sinon il génère une nouvelle clé de chiffrement et les mots de passe NAS et SMTP de la base deviennent illisibles.

```bash
# .env d'origine en place AVANT l'installation (install.sh le conserve)
sudo mkdir -p /opt/filaflow/backend
sudo cp ~/restore/sys/opt/filaflow/backend/.env /opt/filaflow/backend/.env
sudo chmod 600 /opt/filaflow/backend/.env

# Installation, avec le même mot de passe de base que dans le .env
git clone https://github.com/Fabdub59650/filaflow.git ~/filaflow
cd ~/filaflow
DBPASS=$(sudo grep '^DB_PASSWORD=' /opt/filaflow/backend/.env | cut -d= -f2-)
sudo DB_PASS="$DBPASS" bash scripts/install.sh

# Base de données
gunzip -c ~/database.sql.gz | sudo mariadb filaflow
sudo systemctl restart filaflow
sudo mariadb filaflow -e "SELECT COUNT(*) AS filaments FROM filaments;"
```

Pour pousser vers GitHub depuis le Pi, reconfigurer ensuite les identifiants (jeton GitHub), volontairement absents de la sauvegarde.

### 7. Nginx et certificat

```bash
sudo cp ~/restore/sys/etc/nginx/sites-available/filaflow /etc/nginx/sites-available/filaflow
sudo cp -r ~/restore/sys/etc/nginx/ssl /etc/nginx/
# Bloc /prepflow/ appelé par la configuration : sans lui, nginx -t échoue
sudo cp ~/restore/sys/etc/nginx/snippets/prepflow.conf /etc/nginx/snippets/ 2>/dev/null || true
sudo cp ~/restore/sys/etc/nginx/.htpasswd* /etc/nginx/ 2>/dev/null || true
sudo ln -sf /etc/nginx/sites-available/filaflow /etc/nginx/sites-enabled/filaflow
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Le certificat restauré est le même qu'avant : les appareils qui lui faisaient confiance n'ont rien à refaire, et la PWA du téléphone continue de fonctionner.

### 8. Réseau (si l'IP n'est pas réservée dans la box)

```bash
sudo ls ~/restore/sys/etc/NetworkManager/system-connections/
sudo cp ~/restore/sys/etc/NetworkManager/system-connections/*.nmconnection /etc/NetworkManager/system-connections/
sudo chmod 600 /etc/NetworkManager/system-connections/*.nmconnection
sudo nmcli connection reload
```

Puis redémarrer le Pi et vérifier l'IP avec `hostname -I`.

### 9. Adminer

Adminer se connecte à MariaDB via le réseau Docker (`172.18.0.1`) : MariaDB doit écouter sur ce réseau, et l'utilisateur `pi` doit être recréé (il ne fait pas partie du dump de la base).

```bash
# Configuration MariaDB : comparer avec l'origine (bind-address notamment)
sudo diff -r ~/restore/sys/etc/mysql /etc/mysql
# Si besoin, reprendre le fichier modifié, par exemple :
# sudo cp ~/restore/sys/etc/mysql/mariadb.conf.d/50-server.cnf /etc/mysql/mariadb.conf.d/
sudo systemctl restart mariadb

# Utilisateur Adminer (choisir un mot de passe)
sudo mariadb -e "CREATE USER 'pi'@'172.%.%.%' IDENTIFIED BY 'mot_de_passe'; GRANT ALL PRIVILEGES ON filaflow.* TO 'pi'@'172.%.%.%'; FLUSH PRIVILEGES;"

# Conteneur
sudo cp -r ~/restore/sys/opt/stacks /opt/
cd /opt/stacks/adminer && sudo docker compose up -d
```

Accès : `https://filaflow.local/adminer/` (serveur `172.18.0.1`, utilisateur `pi`).

### 10. PrepFlow

À faire seulement si PrepFlow était installé (`prepflow.sql.gz` présent dans la sauvegarde). Même principe que FilaFlow : le `.env` d'origine d'abord, pour garder le même mot de passe de base.

```bash
sudo mkdir -p /opt/prepflow/backend
sudo cp ~/restore/sys/opt/prepflow/backend/.env /opt/prepflow/backend/.env

git clone https://github.com/Fabdub59650/prepflow.git ~/prepflow
cd ~/prepflow
sudo bash scripts/install.sh

gunzip -c ~/prepflow.sql.gz | sudo mariadb prepflow
sudo systemctl restart prepflow
```

`install.sh` réutilise le mot de passe du `.env`, donne les droits à l'utilisateur Adminer `pi` (recréé à l'étape 9) et détecte que la configuration Nginx restaurée contient déjà le bloc `/prepflow/`.

### 11. Réglages système

```bash
# Configuration log2ram d'origine (taille de la zone en RAM…)
sudo cp ~/restore/sys/etc/log2ram.conf /etc/log2ram.conf
```

Comparer aussi, **sans les écraser à l'aveugle** (un mauvais réglage peut empêcher le Pi de démarrer) :

```bash
sudo diff ~/restore/sys/boot/firmware/config.txt /boot/firmware/config.txt
sudo diff ~/restore/sys/boot/firmware/cmdline.txt /boot/firmware/cmdline.txt
sudo diff ~/restore/sys/etc/fstab /etc/fstab
sudo ls ~/restore/sys/var/spool/cron/crontabs/ 2>/dev/null
```

Reporter à la main uniquement ce qui est encore utile, puis redémarrer :

```bash
sudo reboot
```

---

## D. Vérifier

- [ ] `https://filaflow.local` : connexion et liste des filaments
- [ ] Paramètres › Sauvegarde : **Tester** la connexion NAS, puis **Envoyer un test** pour l'email
- [ ] **Sauvegarder maintenant** : mail « [OK] » reçu, colonnes « Système » et « PrepFlow » renseignées
- [ ] `https://filaflow.local/prepflow/` : liste des projets
- [ ] Balance : une pesée arrive dans FilaFlow
- [ ] Lecteur NFC : lecture d'une puce
- [ ] Adminer (`/adminer/`) et Cockpit (`/cockpit`) répondent
- [ ] `systemctl --failed` : aucun service en échec

Pour finir, supprimer les fichiers de restauration (ils contiennent des secrets) :

```bash
sudo rm -rf ~/restore ~/system.tar.gz ~/database.sql.gz ~/prepflow.sql.gz
```
