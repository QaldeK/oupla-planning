# Changelog

Toutes les modifications notables de ce projet sont documentées ici.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et ce projet adhère au [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] — 2026-07-30

### Fonctionnalités

- **Localisation FR/EN** — traduction intégrale de l'interface via Paraglide JS v2 :
  navigation, formulaires, vues occurrences, page paramètres, homepage, pages d'erreur,
  labels de récurrence, DatePicker. Toggle de langue FR/EN dans les réglages.
- **Persistance de la langue** — la préférence `users.locale` est sauvegardée côté
  serveur pour les utilisateurs authentifiés.
- **Agrégation emails commentaires** — détection des nouveaux commentaires sur les
  occurrences avec envoi de notifications push et emails agrégés.

### Corrections

- **Récurrence mensuelle par date** — correction du compounding qui provoquait un
  décalage cumulatif des jours dans les plannings mensuels par date.
- **i18n** — réparations post-migration Paraglide (templates cassés, couverture
  FR/EN manquante sur les composants restants).

### Maintenance

- **Refactoring occurrences** — extraction de `TaskManager` et
  `VolunteerAssignmentModal` depuis `OccurrenceEditModal`.
- **Refactoring planning-store** — unification du flux d'activation, extraction des
  collections, ajout du sync claim.
- **Refactoring hooks** — extraction des constantes de notification dans
  `notification-core.cjs`.
- **Biome & lint** — adoption de Biome pour le linting et le formatage,
  remplacement de Prettier.
- **Dépendances** — mise à jour des dépendances du projet.

## [0.4.0] — 2026-07-25

### Fonctionnalités

- **Notifications commentaires** — détection automatique des nouveaux
  commentaires sur les occurrences avec envoi de notifications push et emails
  agrégées aux participants concernés
- **Tests notifications** — couverture d'intégration et unitaire complète pour
  le pipeline de notifications (cron, occurrence, templates, recipients, push)

### Maintenance

- **Dépendances** — mise à jour de l'ensemble des dépendances du projet

## [0.3.0] — 2026-07-25

### Fonctionnalités

- **Éditeur riche** — description des plannings avec TipTap (gras, italique,
  titres, listes, liens)
- **Sélection Date×Créneau** — interface unifiée pour choisir combinaisons de
  dates et créneaux horaires
- **Notifications push** — envoi immédiat aux participants (sans attendre le
  cron de notification)
- **Identité revendiquée** — association d'un planning à son compte utilisateur
  même si la création a été faite en mode invité
- **Boot résilient** — récupération automatique si la base locale Dexie est
  corrompue
- **État guest en temps réel** — suivi synchrone des identités invitées via
  Dexie (plus de décalage au re-login)

### Corrections

- **PWA** — page blanche après avoir cliqué sur "Mettre à jour"
- **Boot** — écran d'erreur bloquant au démarrage de l'application
- **Notifications** — formatage des dates et heures dans les emails,
  récupération correcte des IDs utilisateurs, parsing du champ
  `push_subscription`
- **Formulaire admin** — les dates passées n'apparaissent plus dans
  l'avertissement de conflit
- **Participant admin** — l'identité du créateur est maintenant correctement
  enregistrée
- **Cron notifications** — ordre de tri et déclenchement fiabilisés

### Maintenance

- **Dépendances** — migration vers Svelte 5.56, Tailwind CSS v4, DaisyUI 5,
  `@lucide/svelte`, et mise à jour de l'ensemble du stack
- **Refactoring** — occurrences comme source de vérité, édition des créneaux en
  modal unifié, extraction du composant `DescriptionCard`, helper PB partagés,
  nettoyage d'imports inutilisés
- **Terminologie** — `combo` renommé en `DateSlot` dans l'ensemble du codebase
- **Architecture** — séparation identities/auth, hooks de notification
  testables, suppression de la dette UI
- **Documentation** — ADR 0001 à 0010 (architecture, auth, offline, push,
  PWA, i18n), CONTEXT.md versionné
- **Style** — espacements et marges harmonisés, taille de police racine
  standardisée
