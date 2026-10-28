# Mise en ordre PWA — installation : labelling, UX, détection

Status: ready-for-agent

## Problem Statement

L'expérience d'installation de la PWA est incohérente pour l'utilisateur : une question
sans réponse (« Pourquoi installer l'application ? ») sert de texte à la bannière
compacte ; un utilisateur Android Firefox reçoit des instructions iOS ; un utilisateur
iPad reçoit des instructions Android (détection user-agent cassée depuis iPadOS 13) ; une
icône cloche accompagne le texte « messages » et une icône participants le texte
« alertes » ; la même action porte trois libellés différents selon la surface ; le bouton
« Plus tard » disparaît au premier changement de page sans jamais rien mémoriser.
Un utilisateur qui a déjà installé l'app continue de voir l'incitation dans son
navigateur (cas Brave vérifié sur device).

Côté développement, le vocabulaire ne décrit plus la réalité : des clés préfixées `ios`
sont utilisées hors iOS, une clé « subtitle » sert de titre, deux clés ont exactement la
même valeur, le « modal de bienvenue » est un formulaire d'inscription, et un store nommé
d'après le domaine mélange deux cycles de vie sans rapport (installation de l'app,
récurrente, vs mise à jour du service worker). Le composant contient du code mort
(boutons en commentaire, prop sans effet).

## Solution

Une règle de nommage unique — **un nom décrit le quoi, jamais le où ni le comment ; la
plateforme n'apparaît que si le contenu lui est propre** — appliquée aux clés i18n, aux
composants et aux stores. L'invite d'installation devient une information permanente
(plus de bouton de fermeture), empilée verticalement sur mobile, avec un texte qui énonce
un bénéfice. La détection d'installation standard (`getInstalledRelatedApps`) masque
l'invite quand l'app est déjà installée sur le terminal. Le store est scindé en deux
modules à responsabilité unique. La documentation d'architecture est mise à jour dans la
même passe que le code.

## User Stories

1. En tant qu'utilisateur sans l'app, je vois une invite d'installation permanente sous
   forme d'alerte, pour que je sois informé sans être interrompu dans ma tâche.
2. En tant qu'utilisateur mobile, je vois le contenu de l'invite empilé verticalement
   (icône, texte, action), pour que l'alerte soit lisible sur petit écran.
3. En tant qu'utilisateur Chromium (Chrome, Brave, Edge), je déclenche le prompt natif
   depuis l'invite, pour que l'installation passe par l'interface de mon navigateur.
4. En tant qu'utilisateur iOS Safari, je vois des instructions manuelles exactes
   (Partager → Ajouter à l'écran d'accueil), pour que je puisse installer sans prompt
   natif.
5. En tant qu'utilisateur Android Firefox, je vois des instructions correspondant à mon
   navigateur (menu ⋮), pour que les étapes affichées soient réalisables telles quelles.
6. En tant qu'utilisateur iPad, je suis reconnu comme iOS et je vois les instructions
   Safari, pour que l'on ne m'affiche pas des instructions d'un autre système.
7. En tant qu'utilisateur ayant installé l'app, je ne vois plus aucune invite
   d'installation, pour que l'interface ne me propose pas ce que j'ai déjà fait.
8. En tant qu'utilisateur ayant installé l'app via Brave et consultant l'app dans un
   onglet Brave, l'invite est masquée par la détection d'installation, pour que
   l'incitation ne réapparaisse pas à tort.
9. En tant qu'utilisateur, je vois chaque bénéfice accompagné d'une icône cohérente
   (cloche pour les alertes, participants pour les messages), pour que l'information
   soit crédible.
10. En tant qu'utilisateur sur une page de planning, je vois une bannière compacte
    d'une ligne énonçant un bénéfice avec un bouton d'action, pour que l'incitation
    n'encombre pas la vue du planning.
11. En tant qu'utilisateur mobile non-Chromium, j'ouvre le modal d'instructions
    manuelles depuis la bannière compacte, pour que je sache comment installer pas à
    pas.
12. En tant qu'utilisateur, je vois le même libellé d'action (« Installer l'app ») sur
    toutes les surfaces (accueil, planning, footer), pour que l'action soit
    immédiatement reconnaissable.
13. En tant qu'utilisateur de lecteur d'écran, le bouton d'installation porte un
    libellé explicite, pour que l'action soit annoncée correctement.
14. En tant qu'utilisateur desktop Firefox ou Safari, je ne suis pas sollicité, pour
    que l'on ne m'affiche pas d'instructions potentiellement fausses (périmètre
    documenté).
15. En tant qu'utilisateur dont le navigateur ne supporte pas la détection
    d'installation (iOS, Firefox), je garde le comportement actuel basé sur le
    display-mode, pour que rien ne régresse là où l'API n'existe pas.
16. En tant qu'utilisateur, quand un lien vers l'app est capturé par la PWA installée,
    la fenêtre existante est focalisée au lieu d'en ouvrir une nouvelle, pour que je ne
    me retrouve pas avec plusieurs fenêtres de la même app.
17. En tant qu'utilisateur venant d'installer l'app, je vois une fois l'invite
    post-installation (création de compte), pour que je sache ce que le compte apporte
    (comportement inchangé).
18. En tant que mainteneur, chaque cycle de vie vit dans son store (installation vs
    mise à jour du service worker), pour que je modifie l'un sans lire l'autre.
19. En tant que mainteneur, les clés i18n sont nommées d'après leur contenu, pour que
    je trouve la bonne clé sans connaître l'historique des écrans.
20. En tant que mainteneur, toute clé renommée non migrée casse la vérification de
    types, pour que la migration i18n soit mécaniquement vérifiable.
21. En tant que mainteneur, le template du composant ne contient plus de code mort, pour
    qu'il reflète le comportement réel.
22. En tant que mainteneur, l'invariant de throttle des mises à jour reste couvert par
    son test unitaire après la scission du store, pour qu'aucune régression ne passe
    inaperçue.
23. En tant que mainteneur, la documentation d'architecture décrit la structure
    post-chantier, pour que le code et la doc ne divergent pas.

## Implementation Decisions

### Règle transverse

- Nommage : le nom décrit le contenu ou l'intention, jamais la position ni le mécanisme ;
  préfixe plateforme uniquement quand le contenu est spécifique à la plateforme. La
  règle est consignée dans la documentation d'architecture PWA.
- Vocabulaire utilisateur figé dans le glossaire : invite d'installation, prompt natif,
  instructions manuelles, invite post-installation.

### Stores

- Le store PWA est scindé en deux modules : **installStore** (détection de l'installation,
  prompt différé, invite post-installation, enregistrement de l'installation côté
  PocketBase) et **swUpdateStore** (détection de mise à jour, throttle, activation). La
  moitié mise à jour est déplacée **sans changement de comportement** ; son test unitaire
  existant suit.
- `showNativeHint` renommée `needsManualInstructions` (revue : nommer l'état, pas un
  conseil d'affichage) ; le scope mobile reste dans le composant.
- La famille « welcome » est renommée d'après son intention (invite post-installation :
  état `hasSeenPostInstallInvite`, marqueur, clé de stockage) **sans changement de
  comportement** — l'invite reste marquée vue à l'ouverture. Le renommage de la clé de
  stockage ré-affiche une fois l'invite aux invités l'ayant déjà vue (effet accepté).

### Composants

- `PwaInstallCard` devient **PwaInstallBanner** ; le modal d'instructions est extrait en
  **PwaManualInstallModal**, contrôlé par le banner.
- Suppression complète de la fermeture : state local de dismissal, prop
  `isDismissible`, clé « Plus tard », boutons en commentaire.
- Les alertes passent leur contenu interne en pile sur mobile (la rangée flex
  icône/texte/action devient une colonne sous le breakpoint mobile).
- La bannière compacte Chromium affiche un bénéfice en une ligne (réutilise la clé
  bénéfice « alertes ») + bouton d'action ; le modal reste réservé à la branche
  non-Chromium.
- La détection iOS est extraite en fonction pure (iPadOS 13+ : user-agent Mac +
  multi-touch → iOS) remplaçant le test user-agent actuel.

### i18n — migration des clés

| Ancienne | Devenir |
| --- | --- |
| `common_install_app` | conservée, **verbe canonique** sur toutes les surfaces |
| `pwa_install` | supprimée (usage → verbe canonique) |
| `pwa_install_action` | supprimée ; le libellé cité dans les instructions va dans la famille howto |
| `pwa_later` | supprimée |
| `pwa_install_title`, `pwa_install_modal_title` | dédoublonnées en une seule clé titre |
| `pwa_install_subtitle` | renommée d'après son rôle réel (titre de la variante instructions manuelles) |
| `pwa_install_description` | conservée |
| `pwa_why_install` | conservée pour le modal uniquement ; la bannière compacte ne l'utilise plus |
| `pwa_benefit_{messages,alerts,cancellations}` | conservées, icônes recroisées (cloche ↔ alertes, participants ↔ messages) |
| `pwa_prefs_description` | conservée, plein format uniquement |
| `pwa_how` | renommée `pwa_howto_install` (« Comment installer ? ») |
| `pwa_ios_press_button`, `pwa_ios_share`, `pwa_ios_step_2` | famille `pwa_howto_ios_*` |
| `pwa_ios_press_menu`, `pwa_ios_browser_continue`, `pwa_ios_install_desktop` | famille `pwa_howto_android_*` avec **contenu corrigé** (menu ⋮, pas de flux Partager) |
| `pwa_ios_or` | supprimée ; le « ou » est absorbé dans `pwa_howto_android_step_2` |
| `pwa_ios_press`, `pwa_ios_step_guide` | supprimées (titre utilisé comme étape ; fusion dans les étapes) |
| `pwa_add_home_action` | famille `pwa_howto_*` (libellé de menu cité) |

Le wording exact des instructions par navigateur est validé sur device pendant
l'implémentation ; la spec fige la famille, la règle et les cas de contenu à corriger.

### Détection d'installation

- Le manifest s'auto-déclare : entrée `related_applications` (plateforme webapp, url du
  manifest, id d'app).
- L'installStore interroge `getInstalledRelatedApps()` au démarrage (appel dans le scope,
  requête locale rapide) ; une app détectée masque l'invite d'installation. L'invite
  attend le résultat avant de s'afficher (pas de flash).
- Couverture : Chromium Android 84+, desktop Chromium 140+. API absente (iOS, Firefox) →
  comportement display-mode actuel, trade-off documenté.
- La détection ne change pas la logique du prompt natif : `beforeinstallprompt` garde son
  écoute immédiate au constructeur.

### Manifest

- `id` explicite (`"/"`, valeur équivalente à l'identité calculée aujourd'hui — pas de
  duplication d'app pour les installations existantes), `scope` explicite à la racine,
  `launch_handler` en `navigate-existing` (lien capturé → focus de la fenêtre existante).

### Documentation

- La documentation d'architecture PWA est mise à jour dans la même passe que le code :
  structure post-scission des stores, détection d'installation et ses limites
  plateformes, manifest durci, règle de nommage i18n, tests manuels device (dont le cas
  Brave).

## Testing Decisions

- Un bon test vérifie le comportement externe (événements navigateur → état exposé),
  pas les détails internes. Aucun test de rendu de template.
- **Joint principal (i18n)** : la compilation. Toute clé renommée non migrée casse la
  vérification de types Paraglide — migration vérifiable sans écrire de test.
- **Joint store (unitaire, node pur)** : APIs browser stubbées, pilotage par les
  listeners posés à l'init, fake timers pour le throttle. Prior art : le test existant
  du throttle de mise à jour, qui migre avec sa moitié vers swUpdateStore. Nouveaux cas :
  gate de détection (getInstalledRelatedApps mocké — app détectée → invite masquée),
  transitions `isInstalled`/`canInstall` (beforeinstallprompt, appinstalled, changement
  de display-mode), fonction de détection iOS (pure).
- **Pas de tests d'intégration** : aucun changement de schéma ni d'API PocketBase (le
  champ `pwa_installed` existe déjà).
- **Pas de tests de composant** (joint 3 abandonné d'un commun accord) : la logique
  d'affichage se réduit à composer les flags du store ; couverture par vérification de
  types, autofixer Svelte 5, et revue device.
- **Tests manuels device** (documentés dans l'architecture PWA) : Brave Android après
  installation via Brave → invite masquée ; iOS Safari → instructions exactes et détection
  standalone ; Android Firefox → instructions menu ⋮ ; DevTools onglet Application →
  id, scope, launch_handler, related_applications présents.

## Out of Scope

- **Politique compte après installation** : ticket dédié
  (`.scratch/26-10-28_install-sans-compte/`), grill dédié après vérification de ce que
  perd réellement un invité sans compte. Ici : renommage seul, comportement inchangé.
- **Capture de liens vers la PWA installée** : ticket dédié
  (`.scratch/26-10-28_pwa-link-capturing/`) — vérification device, guide utilisateur,
  exploration optionnelle assetlinks cross-browser. Ici : le manifest durci seulement.
- Instructions manuelles desktop non-Chromium (hors périmètre, documenté comme choix).
- Persistance d'un refus d'installation (supprimé : l'invite est permanente par design).
- Toute modification du service worker lui-même (cache, cycle de vie, push).
- Le wording marketing des bénéfices (les trois textes restent, seules les icônes sont
  corrigées).

## Further Notes

- Deux passes d'implémentation : **passe 1 UX/i18n** (messages, banner, modal, manifest,
  détection, fix iPad) puis **passe 2 DX** (scission du store, renommages, code mort).
  Chaque passe finit sur la vérification de types + suite unitaire ; la doc
  d'architecture est corrigée dans la même passe que le code qu'elle décrit.
- Le cas Brave (invite affichée malgré une installation via Brave) est un défaut du
  navigateur que le gate masquera ; vérifier sur device si le `id` explicite restaure en
  plus la suppression native du prompt.
- Validation complète de fin de chantier : vérification de types + tests unitaires +
  revue device Brave Android (invite masquée, instructions correctes).
