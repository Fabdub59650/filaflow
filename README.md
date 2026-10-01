# FilaFlow

Gestion du stock de filament pour imprimante 3D, sur Raspberry Pi : inventaire des bobines,
pesées (manuelles ou automatiques via la balance TigerTag Scale en Wi-Fi) et puces NFC (lecteur ACR122U).

FilaFlow est dérivé de [PrintFlow-3D](https://github.com/Fabdub59650/printflow-3d) (archivé), recentré sur la
seule gestion des filaments.

## Fonctionnalités

- Inventaire des bobines (matière, couleur, marque, bobines partielles, archivage, étiquettes, QR codes)
- Pesées manuelles et historique par bobine ; base de référence des poids de bobines vides
- Contrôle d'inventaire (Outils › Inventaire) : bobines pesées il y a longtemps ou aux valeurs incohérentes, à peser ou à confirmer
- Balance connectée : `POST /api/tigertag/webhook` avec `{ "uid_hex": "...", "weight_gross": 875 }`
- Lecture, liaison et écriture de puces NFC (format FilaFlow, compatible avec les puces PrintFlow, et format Elegoo)
- Bandeau d'alerte stock faible, import/export CSV, export PDF
- Sauvegarde automatique locale ou NAS avec rapport par email, restauration, mise à jour depuis GitHub, PWA

## Installation

```bash
git clone https://github.com/Fabdub59650/filaflow.git
cd filaflow
sudo bash scripts/install.sh
```

HTTPS (certificat auto-signé pour `<nom d'hôte>.local` et l'IP du Pi) :

```bash
sudo bash scripts/setup-https.sh
```

Si Nginx est déjà configuré en HTTPS, le script régénère seulement le certificat et conserve la
configuration existante (Adminer, Cockpit…).

## Sauvegarde et reconstruction

Chaque sauvegarde contient la base (`database.sql.gz`), la configuration du Pi (`system.tar.gz`) et, si PrepFlow est installé, sa base (`prepflow.sql.gz`).
Procédure pour reconstruire le Pi sur une carte SD neuve : [docs/RECONSTRUCTION.md](docs/RECONSTRUCTION.md).

## Mise à jour

```bash
git pull && sudo bash scripts/patch.sh
```
