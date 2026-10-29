# Changelog

Toutes les modifications notables de ce projet sont documentées ici.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et ce projet adhère au [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.8.0] — 2026-10-29

### Fonctionnalités

- **Application installée — compte obligatoire** — l'app installée (PWA) affiche
  désormais un écran d'authentification plein écran quand aucune session n'est
  active, avec les bénéfices du compte et le titre du planning invité. Sans
  compte, les notifications seraient de toute façon muettes. L'usage dans le
  navigateur reste possible sans compte.
- **Reprise des plannings locaux** — les plannings créés en invité sont
  rattachés au compte au moment de sa création depuis ce même écran.
- **Session entre fenêtres** — une seconde fenêtre du navigateur retrouve la
  session existante au lieu de rejouer la transition d'identité.
- **Rejoindre un planning** — nouveau bouton et fenêtre de saisie pour ouvrir un
  lien de partage (URL complète, chemin relatif ou jeton seul), accessible aussi
  depuis l'app installée qui n'a pas de barre d'adresse.
- **Identité du participant** — l'identité s'affiche comme un badge au lieu d'un
  bouton.
- **Notifications — suivi par destinataire** — e-mail et notification push sont
  suivis séparément pour chaque destinataire : un seul e-mail par événement,
  même si une adresse rejette le message, et les rappels push du jour J partent
  dès le premier passage indépendamment de l'état du serveur mail.
- **Installation PWA** — l'invitation à installer est masquée quand l'app est
  déjà présente sur l'appareil, avec une expérience d'installation remaniée et
  des instructions iOS / Android corrigées (dont Firefox Android et iPadOS).

### Corrections

- **Déconnexion** — confirmation demandée avant d'effacer la session locale, avec
  un avertissement spécifique dans l'app installée.
- **Écran d'authentification** — le contexte de planning y est neutre et l'écran
  redevient prioritaire sur le contenu quand aucune session n'existe.
- **Mises à jour PWA** — le rechargement après mise à jour survient dans la
  fenêtre concernée et ne fait plus échouer l'écran d'authentification.
- **Notifications** — l'issue réelle d'une remise (succès comme échec) est
  enregistrée au lieu d'un état supposé ; le rappel quotidien est fixé à 08 h
  UTC.
- **Revendication d'identité** — refuser une revendication ne rejoue plus la
  même suggestion en boucle.
- **Paramètres** — les informations de compte (planning administré, planning
  actif) sont de nouveau exposées et le bouton de connexion est corrigé.
- **Enregistrement des modifications** — les écritures utilisent le jeton
  administrateur détenu par la session, et non le jeton de la page.
- **Annulation d'occurrence** — les boutons d'annulation et de réactivation ne
  déclenchent plus l'envoi implicite du formulaire.
- **Archive** — la page archive occupe de nouveau toute la largeur disponible.

### Maintenance

- **Refactoring** — propriétaire unique de la séquence post-authentification et
  suppression du cache mémoire de jetons ; producteur unique pour l'événement de
  notification ; actions planning découpées en `occurrenceDiff`, `mutations` et
  `reads` ; workflow de réponse aux occurrences regroupé.
- **Synchronisation** — écritures multi-collections atomiques avec réconciliation
  Dexie, protégées par un garde de graphe d'imports.
- **Outillage** — Biome et Prettier remplacés par le formateur natif `bun fmt` ;
  génération des types PocketBase derrière une option explicite.
- **Tests** — couverture d'intégration étendue (notifications, identités,
  synchronisation).
- **Documentation** — documentation d'architecture versionnée dans
  `docs/architecture/`, ADR, glossaire et vocabulaire d'identité mis à jour.

## [0.7.0] — 2026-10-15

### Fonctionnalités

- **Identité** — le renommage d'un invité et le changement de participant ont
  désormais chacun leur interface dédiée, en remplacement du modal unique.
  Libellés clarifiés et messages de sécurité explicites lors de la
  revendication d'une identité.
- **Mot de passe** — logique de mise à jour revue et formulaire amélioré dans
  les paramètres.
- **Notifications toast** — bordures personnalisées pour un meilleur repérage
  visuel.

### Corrections

- **Formulaire de contact** — l'envoi du mail est désormais précédé d'une sonde
  de joignabilité SMTP (3 s max) : plus d'envoi qui reste bloqué quand le
  serveur mail ne répond pas.
- **Synchronisation hors-ligne** — le curseur delta est remplacé par des
  resynchronisations complètes bornées par date, et le planning est rafraîchi
  depuis le serveur à l'activation et à chaque resynchronisation. La synchro
  gagne en fiabilité et en prévisibilité.
- **Sessions** — le token d'authentification est renouvelé au démarrage de
  l'app : les sessions restent actives au lieu d'expirer après inactivité.
- **Mises à jour PWA** — la recherche de mises à jour continue même quand une
  mise à jour attend déjà d'être appliquée.
- **Création de participant** — l'état de soumission du formulaire est
  correctement réinitialisé après un succès (bouton restait bloqué).
- **Aperçus de réponses** — clé de rendu corrigée (avertissements Svelte
  `each_key_duplicate`).

### Maintenance

- **PocketBase 0.40.5** — mise à jour du binaire backend (depuis 0.39.11).
- **Dépendances** — mise à jour des dépendances npm.
- **Tests d'intégration** — instance PocketBase jetable avec provision
  automatique des données de test, pour des tests totalement isolés.
- **Documentation** — ADR 0016 sur les conventions i18n ; doc de déploiement ;
  fichiers de traduction mis à jour.

## [0.6.1] — 2026-09-01

### Fonctionnalités

- **Formulaire de contact** — confirmation de succès centralisée après envoi, en remplacement du formulaire.

### Corrections

- **Réponses après revendication d'identité** — impossible de répondre à un planning après avoir revendiqué son identité guest depuis un compte : le modal « Changer d'identité » s'ouvrait en boucle. L'identité opérationnelle est désormais alignée sur le participant revendiqué (clé des réponses et commentaires) ; quitter le planning et l'état de lecture des commentaires (« participant à la conversation ») sont corrigés par la même occasion.
- **Modal de préférences de notification** — libellés et descriptions clarifiés
  pour refléter le comportement réel : rappels réservés aux événements où l'on
  est présent ou inscrit sur une tâche, « Participants sans réponse » renommé
  « Quorum et volontaires manquants », « Événements non confirmés » décrit comme
  un rappel admin quand un événement proche reste non confirmé, portée des
  notifications de messages explicitée. Ajout d'une description sous
  « Modifications d'occurrences ».
- **Modal de notifications sur mobile** — suppression du débordement horizontal :
  le `white-space: nowrap` imposé par les labels DaisyUI empêchait tout retour
  à la ligne des textes.
- **Image Docker PocketBase** — script d'entrée rendu exécutable et binaire
  correctement référencé dans la commande de démarrage.

### Maintenance

- **Docker PocketBase** — Dockerfile autonome avec binaire 0.39.11 épinglé.
- **Tests** — locale des tests unitaires épinglée explicitement ; chemin de
  données PocketBase configurable pour les tests d'intégration (`IT_PB_DATA`).

## [0.6.0] — 2026-08-25

### Fonctionnalités

- **Suppression de planning** — un admin peut supprimer un planning depuis la page
  de configuration : lecture seule pendant 15 jours, restauration par tout admin,
  purge définitive automatique ensuite. Les participants authentifiés sont prévenus
  par email à la suppression et à la restauration.
- **Suppression de compte** — depuis la page paramètres, avec page unifiée.
- **Mentions légales** — page dédiée et acceptation des conditions d'utilisation.
- **Formulaire de contact public.**
- **Push multi-appareils** — les notifications push parviennent sur tous les
  appareils enregistrés d'un utilisateur.
- **URL publique dynamique** — l'URL de base utilisée dans les notifications est
  configurable.
- **Protection serveur des champs sensibles** — restrictions et audit côté
  PocketBase.

### Corrections

- **Restauration d'un planning supprimé** — le bouton « Restaurer » utilise
  désormais l'adminToken : la restauration échouait (403) depuis un lien
  participant.
- **Préférences de notification** — persistance garantie avant la synchro push.
- **Sécurité occurrences** — création d'occurrences restreinte à l'adminToken.

### Maintenance

- **Hooks PocketBase** — `notify-utils.js` renommé en `.cjs` (convention modules).
- **Tests** — alignement sur les textes i18n post-migration, suppression du test
  de rejeu de migration PocketBase.

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
