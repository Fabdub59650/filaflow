# Changelog — FilaFlow

## 1.6.1 — septembre 2026

- Correction : une puce inconnue posée sur le lecteur NFC ne déclenchait rien si la fenêtre NFC
  n'était pas déjà ouverte. Une notification « Puce inconnue — non liée » s'affiche désormais,
  avec « Lire la puce » (lecture et création de fiche ELEGOO) et « Lier à une bobine »
- Balance : la notification de puce inconnue propose « Nouvelle fiche » (liée à la puce)
  et « Lier à une bobine », au lieu d'un simple message
- Notification « bobine détectée » (puce connue) harmonisée avec le style Atelier
- Sélecteur de liaison : les bobines sans puce sont listées en premier

## 1.6.0 — septembre 2026 — suggestions de saisie

- Fiche filament : les champs « Nom couleur » et « Marque » proposent les valeurs déjà utilisées
- Si la saisie correspond à une valeur existante écrite autrement (casse, accents, espaces),
  indication « Déjà utilisé sous la forme … » avec correction en un clic
- Pour chaque nom, l'orthographe proposée est la plus fréquente dans l'inventaire
- Création depuis une puce ELEGOO : le nom de couleur approché reprend l'orthographe existante

## 1.5.0 — septembre 2026 — fiche créée depuis une puce ELEGOO

- Fenêtre NFC › « Lire la puce » : sur une puce ELEGOO non liée, bouton
  « Créer la fiche depuis cette puce »
- Fiche pré-remplie : nom (sous-type + couleur), marque ELEGOO, matière, sous-type, couleur,
  nom de couleur approché, températures buse, diamètre, poids ; tout reste modifiable
- À l'enregistrement, la puce est liée automatiquement à la nouvelle bobine

## 1.4.0 — septembre 2026 — pesées en temps réel

- Balance connectée : dès qu'une bobine est pesée, une notification apparaît sur tous les écrans
  ouverts (nom, couleur, poids restant, % et variation depuis la dernière pesée)
- La carte de la bobine se met à jour sans recharger la page, avec une brève surbrillance ;
  aucun rafraîchissement pendant qu'une fenêtre ou un menu est ouvert
- Puce inconnue posée sur la balance : notification avec l'UID pour pouvoir la lier
- Les pesées manuelles mettent aussi à jour les autres écrans ouverts
- Barre latérale : heure de dernière pesée actualisée immédiatement
- Diffusion via le flux temps réel existant (SSE du module NFC), sans nouvelle dépendance

## 1.3.1 — septembre 2026

- Fenêtre NFC : le bouton « Dump » devient « Lire la puce » et reste disponible dans tous les cas —
  puce liée, puce inconnue (ex. bobine ELEGOO d'origine) et juste après une écriture ELEGOO
- Lecture unifiée : format ELEGOO décodé et format FilaFlow (remplace l'ancien bouton « Lire les données »),
  données brutes des pages 16-24 dans un bloc repliable

## 1.3.0 — septembre 2026 — format ELEGOO complet

Tables reprises de github.com/Savion/elegoo-rfid-editor, croisées avec github.com/DnG-Crafts/ELG-RFID.

- 15 matières ELEGOO (ajout de CPE, BVOH, EVA, PP, PPA, PPS ; HIPS a désormais son vrai code
  au lieu d'être codé en ABS) et 50 sous-types officiels
- Fiche filament : liste des sous-types filtrée selon la matière, avec la mention
  « non affiché CC2 » pour les sous-types écrits sur la puce mais ignorés par l'imprimante
- Correction : températures buse ≥ 256 °C (ASA, PC, PA…) mal encodées
  (ex. 260 °C écrit comme 4 °C) — désormais 2 × 16 bits big-endian
- Correction : une bobine non-PLA sans sous-type était codée avec le sous-type PLA
  (0x0000) ; elle reçoit maintenant la variante standard de sa famille (PETG → 0x0100…)
- Correction : sous-types estimés erronés (PA-CF, ASA-CF, ABS-CF, TPU 87A…) remplacés par les codes officiels
- Page 22 laissée à zéro comme sur les puces d'origine (au lieu de températures plateau supposées)
- Contrôle de cohérence matière / sous-type à l'écriture, avec avertissements affichés
- Dump NFC : décodage lisible d'une puce ELEGOO (matière, sous-type, couleur, températures, poids)
- Migration automatique des anciens libellés de sous-types vers les noms officiels
- Code de l'encodage regroupé dans `backend/elegoo.js`

## 1.2.0 — septembre 2026 — regroupement par couleur

- Écran Filaments : nouveau sélecteur « Regrouper » (Aucun / Matière / Couleur), en vue Grille
  comme en vue Liste ; le choix est mémorisé séparément pour chaque vue
- Regroupement sur le champ « Nom couleur » des fiches, insensible à la casse, aux accents et
  aux espaces (« Noir », « noir » et « noir  » forment un seul groupe) ; groupe « Sans couleur » en fin
- Chaque groupe affiche les pastilles des teintes qu'il contient et son nombre de bobines ;
  un clic sur l'en-tête filtre sur ce groupe (pastille « Couleur : … ✕ » pour revenir)
- Tri : l'option « Matière » devient « Par défaut »

## 1.1.2 — septembre 2026

- Paramètres › Système : suppression de la jauge « SSD USB (/mnt/data) », le disque externe
  n'étant plus utilisé (elle affichait en réalité l'espace de la carte SD une fois le disque retiré).
  La jauge disque est renommée « Carte SD ».

## 1.1.1 — septembre 2026 — mises à jour visibles immédiatement

- PWA : stratégie « réseau d'abord » pour les pages, scripts et styles ; le cache ne sert plus
  qu'en cas de coupure réseau (délai de bascule 4 s). Une nouvelle version s'affiche dès le
  premier chargement, sans Ctrl+F5.
- Polices et bibliothèques externes toujours servies depuis le cache (fichiers immuables)
- Le service worker n'intercepte plus l'API ni le flux NFC (SSE)
- Rechargement automatique unique quand une nouvelle version du service worker prend la main
- Flux NFC recyclé toutes les 60 s avec reconnexion silencieuse : débloque la transition
  depuis l'ancien service worker, sans clignotement du badge NFC

## 1.1.0 — septembre 2026 — look « Atelier »

- Nouvelle identité visuelle : graphite par défaut, accent orange « Signal », variante claire « béton »
- Typographies auto-hébergées (Barlow Condensed, IBM Plex Mono, IBM Plex Sans) : aucun appel externe
- Écran Filaments en grille de cartes : anneau dans la couleur réelle du filament, poids et longueur
  restants, date de la dernière pesée, étiquettes Stock bas / NFC / Partielle / Archivée
- Vue Liste (tableau) toujours disponible via le sélecteur Grille / Liste (choix mémorisé)
- Filtres par matière en pastilles, tri Matière / Stock restant / Nom
- Bandeau de stock bas à rayures de signalisation
- Barre supérieure allégée : actions secondaires regroupées dans le menu « Outils »
- État du lecteur NFC et de la dernière pesée de la balance dans la barre latérale
- Mobile : cartes compactes et barre d'actions « Lecteur NFC » / « Pesée »
- API : la liste des filaments renvoie la date de dernière pesée (`last_weighed_at`)

## 1.0.0 — septembre 2026

Première version de FilaFlow, dérivée de PrintFlow-3D v2.9.10.

- Recentrage sur la gestion des filaments : inventaire, pesées, balance TigerTag Scale, NFC
- Supprimés : impressions, imprimantes, planning, devis, projets, bibliothèque 3D, galerie, statistiques,
  maintenance, consommables, kiosque, Telegram, PixelIt, prises Tapo, Spoolman, rapport hebdomadaire,
  recherche globale, aide en ligne
- Nouveau bandeau « stock faible » en tête de la liste des filaments (remplace l'alerte du tableau de bord)
- Sauvegardes : préfixe `filaflow_` et dossier par défaut `/filaflow` (plus de risque d'effacer celles de PrintFlow)
- Routes API inconnues : réponse 404 JSON au lieu de la page d'accueil
- Scripts : installation compatible avec un Pi PrintFlow existant, migration des données, patch
- `node_modules` et `.env` ne sont plus versionnés
- Webhook de la balance inchangé (même route, même format)
- Sécurité : l'authentification s'applique désormais aux requêtes relayées par Nginx
  (auparavant toutes considérées comme locales). Seules les requêtes lancées sur le Pi
  lui-même restent exemptées.
- Balance : webhook exempté de l'authentification de l'interface, avec jeton optionnel
  (`?token=…` ou en-tête `X-Webhook-Token`) configurable dans Paramètres → Balance
- Poids de bobines de référence par défaut insérés uniquement à la première installation
- Service systemd : limite de redémarrages placée dans la section [Unit]
- Connexion : rechargement automatique après login, jeton envoyé aussi sur les
  téléchargements et restaurations

Historique de PrintFlow : voir le dépôt printflow-3d.
