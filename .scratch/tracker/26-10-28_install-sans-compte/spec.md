# Spec — Mur d'authentification pour l'app installée

Status: done
Issue: [issues/01-politique-compte-apres-install.md](issues/01-politique-compte-apres-install.md) (grill du 28-10-2026)

## Problem Statement

L'application incite à l'installation avec une promesse : « recevez des alertes
instantanées ». Or les deux canaux de notification (push et email) ne servent que des
participants authentifiés — un invité n'y a accès à aucun des deux. Une installation sans
compte livre donc une app structurellement muette : aucune alerte, pas de liste
centralisée des plannings, pas de multi-appareils. L'invite post-installation actuelle
est fermable définitivement (marquée « vue » à l'ouverture), laissant cet état s'installer
sans jamais convertir.

## Solution

Quand l'app tourne installée (mode standalone) sans session authentifiée, un mur
d'authentification plein écran remplace toute surface de l'app : connexion ou création de
compte, sans contournement. Créer le compte rattache automatiquement les plannings connus
localement (flux existant). Le navigateur — y compris le lien d'invitation ouvert dedans —
reste sans friction : le mur ne s'applique qu'à l'app installée. L'invite
post-installation distincte est supprimée ; le mur devient l'unique moment de conversion.

## User Stories

1. En tant qu'invité qui installe l'app, je veux qu'elle me demande un compte (création ou
   connexion) au premier lancement, pour que la promesse d'alertes qui m'a fait installer
   soit tenue.
2. En tant qu'invité qui crée son compte depuis le mur, je veux que mes plannings rejoints
   localement apparaissent dans mon compte, pour que créer un compte ne me coûte rien.
3. En tant qu'utilisateur authentifié qui installe depuis son navigateur (desktop
   Chrome/Edge, Android), je veux ouvrir l'app installée déjà connecté, pour que le mur ne
   m'atteigne jamais.
4. En tant qu'utilisateur iOS ayant installé l'app alors que j'étais connecté dans Safari,
   je veux que le mur me propose la connexion (pas une impasse), pour retrouver ma session
   en un geste.
5. En tant qu'invité qui clique une invitation sur un appareil où l'app est installée, je
   veux que le mur m'indique de quel planning je suis invité, pour que la création de
   compte soit un choix informé.
6. En tant qu'invité sur un appareil sans l'app, je veux que les liens partagés s'ouvrent
   dans le navigateur sans friction de compte, pour que le parcours d'adoption reste
   intact.
7. En tant qu'invité dans le navigateur, je veux continuer à créer des plannings sans
   compte, pour que rien ne change hors de l'app installée.
8. En tant qu'utilisateur qui se déconnecte dans l'app installée, je veux être prévenu que
   je retomberai sur le mur, pour que la déconnexion ne soit pas un piège.
9. En tant qu'utilisateur dont la session a expiré, je veux un écran de connexion clair au
   lieu d'une app en échec, pour retrouver ma session sans confusion.
10. En tant qu'invité existant ayant déjà installé l'app sans compte, je veux voir le mur
    au prochain lancement, pour que la politique s'applique à moi aussi, sans période de
    grâce.
11. En tant qu'admin ouvrant un lien d'administration dans l'app installée sans être
    connecté, je veux subir le même mur, pour que la politique soit cohérente.
12. En tant qu'utilisateur, je ne veux plus voir l'ancienne invite post-installation, pour
    qu'il n'existe qu'un seul moment de conversion.
13. En tant qu'invité face au mur, je veux voir rappelés les bénéfices du compte (alertes,
    plannings sur tous mes appareils), pour que le mur soit un argument et pas seulement
    un blocage.
14. En tant que participant identifié localement (identité par planning), je veux que mon
    identité invité soit proposée à la fusion quand je crée mon compte depuis le mur, pour
    ne pas dupliquer ma participation.

## Implementation Decisions

- **Un seul point de décision** : la condition du mur vit dans le layout racine — app
  installée (détection standalone existante) ET session non authentifiée ET initialisation
  du store utilisateur terminée. Tant que l'initialisation n'est pas terminée, rien ne
  s'affiche : pas de flash de mur pendant la restauration d'une session valide. Aucun
  guard par route — le mur remplace le contenu entier, vues participant et admin incluses.
- **Composant mur** : écran plein réutilisant le modal de compte existant dans ses deux
  modes (connexion et création), sans bouton de contournement, avec rappel des bénéfices
  du compte.
- **Contexte de planning** : si l'URL courante est un lien participant, le mur lit le
  titre du planning par token et l'affiche ; en cas d'échec (hors ligne, token invalide),
  message générique. C'est le seul bloc de logique nouvelle.
- **Migration = flux existant** : le login ou la création depuis le mur déclenche la
  transition auth existante, qui réclame les plannings locaux (endpoint idempotent de sync)
  et propose la fusion d'identité. Aucune nouvelle logique de migration.
- **Suppression de l'invite post-installation** : l'effet du layout, l'état « vue », la clé
  de stockage, la prop de mode bienvenue du modal de compte et les clés i18n orphelines
  disparaissent.
- **Déconnexion** : l'écran de déconnexion mentionne le retour au mur quand on est dans
  l'app installée.
- **i18n** : nouvelle famille de clés nommée d'après le contenu (le mur et son contexte),
  boutons réutilisant les verbes auth existants ; compilation Paraglide régénérée après
  édition des catalogues.
- **Documentation dans la même passe** : « mur d'authentification » entre au glossaire ;
  la doc d'architecture identité/auth (zone critique) et la doc PWA sont mises à jour ; le
  guide utilisateur décrit le comportement du mur.

## Testing Decisions

- Un bon test couvre le comportement externe, jamais l'implémentation. La condition du mur
  est un ET de deux états réactifs existants — la tester n'apprend rien. Conformément à
  l'act du chantier labelling : pas de tests de composants nouveaux.
- **Suites existantes, vertes et inchangées** : les tests de la transition auth et du
  rattachement de plannings prouvent que login-depuis-le-mur → plannings rattachés
  fonctionne. S'ils demandent une modification, la conception dérape.
- **Un seul nouveau joint** : le helper de lecture du titre par token (dépendances
  injectées), testé au pattern du test de rattachement existant.
- **Gate de fin de feature** : `bun run check` (le typage Paraglide attrape toute clé
  manquante), suites unitaires et d'intégration complètes — les trois obligatoires.
- **Checklist device** (validation manuelle, à consigner dans le guide) :
  - standalone invité → mur ; création de compte → plannings locaux rattachés ;
  - lien capturé dans la PWA → mur avec le titre du planning ;
  - install authée (desktop Chrome, Android) → pas de mur ;
  - iOS : install depuis Safari connecté → mur en mode connexion ;
  - déconnexion dans la PWA → mur, avec message de prévention ;
  - navigateur : parcours invités inchangés (accueil, création, participation par lien) ;
  - session expirée → mur, reconnexion fonctionnelle.

## Out of Scope

- Un canal notificatif pour les invités (tranché au grill : le compte est l'infrastructure
  de notification ; en construire une autre pour les invités paie plus cher pour un état
  plus flou).
- Tauri (chemin dormant, consigné dans AGENTS.md).
- Toute modification du parcours invité dans le navigateur : création de planning sans
  compte, identification par planning, identité scopée — inchangés.
- L'option hybride « compte requis pour créer » du ticket — non retenue.
- Période de grâce pour les invités existants (tranché : mur direct).
- Télémétrie des installations sans compte.

## Further Notes

- **Héritage de session** (vérifié aux sources, octobre 2026) : desktop Chrome/Edge et
  Android (WebAPK comme raccourcis) partagent le stockage du navigateur installateur — un
  utilisateur connecté installe une app connectée, le mur ne s'y voit jamais. iOS isole le
  stockage Home Screen par design : le token (localStorage) ne se transmet pas, le mur
  demandera une reconnexion. Friction plateforme inévitable, à ne pas « réparer » ici.
- **Décision sans télémétrie** : rien ne compte aujourd'hui les installations sans compte
  ; la politique se fonde sur la structure de la promesse (notifications = compte), pas sur
  des chiffres.
- Le périmètre touche le post-installation, pas l'invite d'installation elle-même : les
  décisions du chantier labelling (invite permanente, gate terminal, vocabulaire) restent
  gouvernantes.
