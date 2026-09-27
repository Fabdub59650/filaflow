# Changelog — FilaFlow

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
