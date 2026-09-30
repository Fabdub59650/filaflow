# Reconstruire le Pi FilaFlow après une panne

Procédure pour repartir d'une carte SD neuve à partir des sauvegardes du NAS. Compter environ une heure.

Chaque dossier de sauvegarde (`/filaflow/AAAA-MM-JJ_HH-MM/` sur le NAS) contient :

| Fichier | Contenu |
|---|---|
| `database.sql.gz` | Dump complet de la base `filaflow` |
| `system.tar.gz` | Configuration du Pi : Nginx et certificats, `.env` de FilaFlow, stack Docker Adminer, MariaDB, réseau, service systemd, log2ram, crontabs, `config.txt`/`cmdline.txt`, plus `system-info.txt` (paquets, services, conteneurs, versions) et `LISEZMOI.txt` |

> `system.tar.gz` contient des secrets (clé privée du certificat, mots de passe de la base et du Wi-Fi, clé de chiffrement des mots de passe NAS et SMTP). Ne pas le copier ailleurs que sur le NAS ou sur le Pi.

Le fichier le plus important est **`.env`** : il contient le mot de passe de la base et la clé `ENCRYPTION_KEY`. En le restaurant **avant** d'installer FilaFlow, les mots de passe NAS et SMTP enregistrés dans la base restent lisibles et rien n'est à ressaisir.

## 1. Récupérer la dernière sauvegarde

Depuis le Mac, dans le Finder : partage du NAS › `filaflow` › dossier le plus récent. Copier `database.sql.gz` et `system.tar.gz` sur le bureau.

Un œil sur `system-info.txt` (double-cliquer sur `system.tar.gz` pour l'extraire) donne la liste des paquets, services et conteneurs d'origine.

## 2. Préparer la carte SD

Avec **Raspberry Pi Imager** : Raspberry Pi OS (64 bits), puis dans les réglages avancés :

- nom d'hôte : `filaflow`
- utilisateur : `pi`
- SSH activé
- Wi-Fi si le Pi n'est pas en Ethernet

Démarrer le Pi, puis vérifier depuis le Mac : `ping filaflow.local`.

**Adresse IP** : le Pi doit retrouver `192.168.1.145` (la balance TigerTag appelle cette IP). Si l'IP est réservée dans la box, rien à faire. Sinon, voir l'étape 7.

## 3. Copier les sauvegardes et extraire la configuration

Depuis le Mac :

```bash
scp ~/Desktop/database.sql.gz ~/Desktop/system.tar.gz pi@filaflow.local:~/
```

Sur le Pi :

```bash
mkdir -p /tmp/sys && sudo tar -xzf ~/system.tar.gz -C /tmp/sys
sudo ls /tmp/sys
```

Ne **jamais** extraire `system.tar.gz` directement dans `/` : les fichiers écraseraient la configuration du nouveau système sans contrôle.

## 4. Réinstaller FilaFlow avec le `.env` d'origine

```bash
# .env d'origine en place AVANT l'installation (install.sh le conserve)
sudo mkdir -p /opt/filaflow/backend
sudo cp /tmp/sys/opt/filaflow/backend/.env /opt/filaflow/backend/.env
sudo chmod 600 /opt/filaflow/backend/.env

# Installation, avec le même mot de passe de base que dans le .env
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/Fabdub59650/filaflow.git ~/filaflow
cd ~/filaflow
DBPASS=$(sudo grep '^DB_PASSWORD=' /opt/filaflow/backend/.env | cut -d= -f2-)
sudo DB_PASS="$DBPASS" bash scripts/install.sh
```

Pour pousser vers GitHub depuis le Pi, reconfigurer ensuite les identifiants (jeton GitHub), volontairement absents de la sauvegarde.

## 5. Restaurer la base

```bash
gunzip -c ~/database.sql.gz | sudo mariadb filaflow
sudo systemctl restart filaflow
```

Vérifier : `sudo mariadb filaflow -e "SELECT COUNT(*) FROM filaments;"`

## 6. Nginx et certificat

```bash
sudo cp /tmp/sys/etc/nginx/sites-available/filaflow /etc/nginx/sites-available/filaflow
sudo cp -r /tmp/sys/etc/nginx/ssl /etc/nginx/
sudo cp /tmp/sys/etc/nginx/.htpasswd* /etc/nginx/ 2>/dev/null || true
sudo ln -sf /etc/nginx/sites-available/filaflow /etc/nginx/sites-enabled/filaflow
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Le certificat restauré est le même qu'avant : les appareils qui lui faisaient confiance n'ont rien à refaire, et la PWA du téléphone continue de fonctionner.

## 7. Réseau (si l'IP n'est pas réservée dans la box)

```bash
sudo ls /tmp/sys/etc/NetworkManager/system-connections/
sudo cp /tmp/sys/etc/NetworkManager/system-connections/*.nmconnection /etc/NetworkManager/system-connections/
sudo chmod 600 /etc/NetworkManager/system-connections/*.nmconnection
sudo nmcli connection reload
```

Puis redémarrer le Pi et vérifier l'IP avec `hostname -I`.

## 8. Adminer (Docker)

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo cp -r /tmp/sys/opt/stacks /opt/
cd /opt/stacks/adminer && sudo docker compose up -d
```

Adminer se connecte à MariaDB via le réseau Docker (`172.18.0.1`). Il faut que MariaDB écoute sur ce réseau et que l'utilisateur `pi` existe (il ne fait pas partie du dump de la base) :

```bash
# Comparer avec la config d'origine (bind-address notamment)
sudo diff -r /tmp/sys/etc/mysql /etc/mysql
# Si besoin, reprendre le fichier modifié, par exemple :
# sudo cp /tmp/sys/etc/mysql/mariadb.conf.d/50-server.cnf /etc/mysql/mariadb.conf.d/
sudo systemctl restart mariadb

# Utilisateur Adminer (choisir un mot de passe)
sudo mariadb -e "CREATE USER 'pi'@'172.%.%.%' IDENTIFIED BY 'mot_de_passe'; GRANT ALL PRIVILEGES ON filaflow.* TO 'pi'@'172.%.%.%'; FLUSH PRIVILEGES;"
```

Accès : `https://filaflow.local/adminer/` (serveur `172.18.0.1`, utilisateur `pi`).

## 9. Outils système

```bash
# Cockpit (administration, port 9090)
sudo apt-get install -y cockpit

# log2ram (préserve la carte SD) — voir https://github.com/azlux/log2ram pour l'installation
# puis reprendre la configuration d'origine :
sudo cp /tmp/sys/etc/log2ram.conf /etc/log2ram.conf
```

Comparer aussi, sans les écraser à l'aveugle : `/tmp/sys/boot/firmware/config.txt` et `cmdline.txt` (paramètres matériels), `/tmp/sys/etc/fstab`, et les crontabs dans `/tmp/sys/var/spool/cron/crontabs/`.

## 10. Vérifications

- [ ] `https://filaflow.local` : connexion et liste des filaments
- [ ] Paramètres › Sauvegarde : **Tester** la connexion NAS, puis **Envoyer un test** pour l'email
- [ ] **Sauvegarder maintenant** : mail « [OK] » reçu, colonne « Système » renseignée
- [ ] Balance : une pesée arrive dans FilaFlow
- [ ] Lecteur NFC : lecture d'une puce
- [ ] Adminer et Cockpit répondent

Pour finir, supprimer les fichiers temporaires :

```bash
sudo rm -rf /tmp/sys ~/system.tar.gz ~/database.sql.gz
```
