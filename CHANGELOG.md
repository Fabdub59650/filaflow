# Changelog — FilaFlow

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

Historique de PrintFlow : voir le dépôt printflow-3d.
