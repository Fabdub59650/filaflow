# FilaFlow

Gestion du stock de filament pour imprimante 3D, sur Raspberry Pi : inventaire des bobines,
pesées (manuelles ou automatiques via la balance TigerTag Scale en Wi-Fi) et puces NFC (lecteur ACR122U).

FilaFlow est dérivé de [PrintFlow-3D](https://github.com/Fabdub59650/printflow-3d), recentré sur la seule
gestion des filaments. PrintFlow reste disponible pour un retour arrière.

## Fonctionnalités

- Inventaire des bobines (matière, couleur, marque, bobines partielles, archivage, étiquettes, QR codes)
- Pesées manuelles et historique par bobine ; base de référence des poids de bobines vides
- Balance connectée : `POST /api/tigertag/webhook` avec `{ "uid_hex": "...", "weight_gross": 875 }`
- Lecture, liaison et écriture de puces NFC (format FilaFlow/PrintFlow et format Elegoo)
- Bandeau d'alerte stock faible, import/export CSV, export PDF
- Sauvegarde automatique locale ou NAS, restauration, mise à jour depuis GitHub, PWA

## Installation

```bash
git clone https://github.com/Fabdub59650/filaflow.git
cd filaflow
sudo bash scripts/install.sh
```

Sur un Pi où PrintFlow est installé, le script conserve la configuration Nginx existante et propose
d'arrêter PrintFlow (même port 3000, même lecteur NFC). Rien n'est supprimé.

## Reprise des données PrintFlow

```bash
sudo bash /opt/filaflow/scripts/migrate-from-printflow.sh
```

Copie filaments, pesées, historique NFC, bobines de référence, historique filaments et réglages utiles
dans la base `filaflow`. La base `printflow` n'est pas modifiée. Le mot de passe NAS est à ressaisir
et la sauvegarde à réactiver (dossier distinct `/filaflow`).

## Retour à PrintFlow

```bash
sudo systemctl disable --now filaflow
sudo systemctl enable --now printflow
```

## Mise à jour

```bash
git pull && sudo bash scripts/patch.sh
```
