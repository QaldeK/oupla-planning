# PWA

Configuration installable (SvelteKit + `adapter-static` en mode SPA) et détection des mises
à jour. Décision : ADR-0004 (adapter-static avec fallback SPA). Guide utilisateur :
`user_guide/pwa-guide.md`.

## Les quatre couches

```mermaid
flowchart TD
  SETUP["1. Configuration<br/>svelte.config.js, app.html<br/>manifest.webmanifest, icônes"]
  SW["2. Service worker<br/>src/service-worker.ts<br/>cache-first assets, /api/* exclue"]
  DETECT["3. Détection de mise à jour<br/>swUpdateStore.svelte.ts"]
  UX["4. UX<br/>+layout.svelte<br/>toast persistant"]
  SETUP --> SW
  SW --> DETECT
  DETECT --> UX
  OFFLINE["Hors couche : offline-first<br/>Dexie + pb-sync"]
  OFFLINE -.->|"les données ne passent pas par le SW"| SW
```

**Le service worker ne sert que les assets statiques.** Les données hors ligne sont gérées
par Dexie et pb-sync, en parallèle, sans dépendre du cache du SW.

## 1. Configuration

- `svelte.config.js` — `adapter-static` avec `fallback: 'index.html'`, `pages` et `assets`
  sur `build/`. Le fallback SPA laisse le routeur SvelteKit prendre n'importe quelle URL
  côté client ; Cloudflare Pages le sert nativement, sans fichier `_redirects`.
- `src/app.html` — `<link rel="manifest">`, `<link rel="apple-touch-icon">` (iOS ne lit pas
  le manifest pour l'icône d'accueil) et `<meta name="theme-color">`.
- `static/manifest.webmanifest` — écrit **à la main**, SvelteKit ne le génère pas ;
  `adapter-static` le copie tel quel. `display: "standalone"`, icônes 192 et 512, dont une
  en `purpose: "maskable"` — sans elle, Android écrase l'icône dans un masque rond.
  `id` et `scope` explicites (`"/"`) : identité d'app stable, scope couvrant tout le site
  (capture de liens desktop Chrome 139+). `launch_handler: "navigate-existing"` : un lien
  capturé focalise la fenêtre existante au lieu d'en ouvrir une nouvelle.
  `related_applications` (plateforme `webapp`, auto-référence du manifest) : prérequis de
  `getInstalledRelatedApps()` — voir § 4.
- `src/app.d.ts` — l'interface `BeforeInstallPromptEvent`. L'événement `beforeinstallprompt`
  est propre à Chromium et absent de la bibliothèque de types DOM.

## 2. Service worker

`src/service-worker.ts` est le service worker natif de SvelteKit. Il porte quatre
directives de référence de type en tête (`no-default-lib`, `esnext`, `webworker`,
`@sveltejs/kit`) et importe `build`, `files` et `version` depuis `$service-worker`.

| Cycle      | Comportement                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| Cache      | nommé `cache-${version}` — le hash de build change à chaque déploiement, donc chaque déploiement a son cache |
| `install`  | pré-cache de `[...build, ...files]`                                                                          |
| `activate` | `clients.claim()` **avant** la suppression des anciens caches                                                |
| `message`  | `skipWaiting()` sur demande du client                                                                        |
| `fetch`    | assets en cache-first, reste en network-first avec repli sur le cache, `/api/*` exclue                       |

**L'ordre du `activate` n'est pas cosmétique.** Supprimer les anciens caches avant le
`claim` laisse un instant où l'ancien contrôleur sert des requêtes contre un cache en cours
de suppression.

**Pas de `skipWaiting()` automatique dans l'`install`.** L'activation est différée à une
action de l'utilisateur : un rechargement au milieu d'une saisie ou d'une mutation en vol
est exactement ce que le report évite.

**`/api/*` est entièrement exclue du `fetch`**, y compris le flux SSE `/api/realtime` (un
stream n'est pas cachable). L'offline-first repose sur Dexie : un SW qui répondrait 200
depuis un cache périmé masquerait une erreur réseau réelle, et l'application afficherait des
données désynchronisées sans aucune alerte. Les routes REST de PocketBase passent donc
directement au réseau.

Le même fichier gère les événements `push` (affichage de la notification) et
`notificationclick` (ouverture de l'URL cible) — voir `push-notifications.md`.

## 3. Détection de mise à jour

`swUpdateStore.svelte.ts` combine deux moitiés, et chacune est nécessaire :

| Moitié    | Rôle                                                                            | Sans elle                                                                                            |
| --------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Réactive  | `updatefound` puis `statechange` sur l'installation, `reg.waiting` au démarrage | le toast ignore qu'une mise à jour existe                                                            |
| Proactive | `reg.update()` sur les signaux de retour d'activité                             | en SPA, `updatefound` ne se déclenche jamais — aucune navigation serveur n'a lieu pendant la session |

**Le problème de la moitié proactive** : SvelteKit navigue côté client, donc le navigateur ne
revérifie jamais le service worker spontanément. Un utilisateur qui enchaîne les pages
pendant un déploiement ne voit jamais le toast ; il apparaît au rechargement suivant, ce qui
donne la fausse impression d'une mise à jour déjà appliquée.

Trois déclencheurs, throttlés à un par minute (limite de spec) :

| Signal                            | Cas couvert                                                                |
| --------------------------------- | -------------------------------------------------------------------------- |
| `visibilitychange` (visible)      | retour d'onglet ou d'application, cas dominant en PWA mobile               |
| `pageshow` avec `event.persisted` | restauration depuis le bfcache — la SPA n'a fait aucune navigation serveur |
| minuterie d'une heure             | session longue, onglet jamais quitté                                       |

Pas de vérification au démarrage : le navigateur la fait au chargement, et le contrôle de
`reg.waiting` couvre la mise à jour laissée en attente par une session précédente.

**Le throttle ne court-circuite pas une mise à jour déjà en attente.** Un second
déploiement pendant qu'une mise à jour attend doit remplacer l'attente courante : sans
cela, le clic activerait une version intermédiaire et imposerait un second cycle.

L'activation (`applyUpdate()`) envoie `SKIP_WAITING` au service worker en attente ; le
rechargement est déclenché par l'écouteur `controllerchange`, posé au démarrage. À défaut
d'attente (état incohérent), un simple `reload()` suffit.

**Le rechargement reste local à l'onglet demandeur.** Un `controllerchange` peut venir d'un
autre onglet qui a activé la mise à jour ; sans drapeau de consentement, tous les onglets
contrôlés se rechargeraient et perdraient une saisie en cours. Seul l'onglet où
`applyUpdate()` a été appelé recharge ; les autres signalent la mise à jour (`hasUpdate`,
toast) sans se recharger.

### Le piège de la première prise de contrôle

`clients.claim()` déclenche `controllerchange` même au premier install, sans qu'aucune mise
à jour n'ait été appliquée. Le store capture donc un drapeau **synchrone au démarrage** :
le premier `controllerchange` est consommé silencieusement, les suivants (issus d'une vraie
mise à jour) déclenchent le rechargement. Un second drapeau (`#refreshing`) évite un double
`reload()` quand l'événement se répète dans la fenêtre de quelques centaines de millisecondes
avant le déchargement — ce n'est pas une boucle, le contrôleur étant établi au rechargement
suivant.

## 4. Installation et UX

Deux stores séparés portent les deux cycles de vie : `installStore.svelte.ts` (adoption :
détection, prompt, gate terminal) et `swUpdateStore.svelte.ts` (maintenance :
mise à jour, § 3). Vocabulaire : voir `CONTEXT.md` (invite d'installation, prompt natif,
instructions manuelles, mur d'authentification).

État d'installation dans `installStore` :

| Membre                                      | Rôle                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `isInstalled`                               | `display-mode: standalone` ou `navigator.standalone` (Safari), suivi dans le temps                                             |
| `canInstall` / `deferredPrompt`             | `beforeinstallprompt` intercepté — l'écouteur est posé dès la construction du store, l'événement pouvant précéder le `onMount` |
| `needsManualInstructions`                   | ni installé ni promptable : la surface appelante décide du scope mobile                                                        |
| `installedOnDevice` / `installCheckPending` | détection terminal via `getInstalledRelatedApps()`                                                                             |
| `promptGateClear`                           | gate commun aux surfaces d'invite : check fait, app absente du terminal                                                        |
| `install()`                                 | déclenche le prompt différé                                                                                                    |

**Mur d'authentification.** L'app installée (standalone) sans session authentifiée
n'affiche plus aucune surface d'app : `+layout.svelte` rend `AuthWall.svelte` à la place,
sans contournement. La condition est un ET de trois états réactifs — `installStore.isInstalled`,
`userStore.isReady`, `!userStore.isLoggedIn` — dans le layout racine, aucun guard par route :
vues participant et admin incluses, liens capturés compris. `isReady` empêche tout flash de mur
pendant la restauration d'une session valide (rien ne s'affiche avant la fin d'init). Le login
depuis le mur déclenche la transition auth standard (claim du planning actif + fusion
d'identité, voir `auth-identity.md`). La **création de compte** depuis le mur propose en plus
le portage des plannings locaux : bascule « Rattacher les plannings de cet appareil »
(`AuthWall`, visible si des masters existent en Dexie, cochée par défaut) — claim batch +
clear sélectif, consentement transmis via `authTransition.wallPortageConsent` (consommé une
fois). Le navigateur reste exclu : parcours invités inchangés. Le mur est
l'unique moment de conversion de l'app installée. Si l'URL est un lien participant ou admin,
le mur affiche le titre du planning (`getPlanningTitleByToken`,
`services/planningReads.ts`) ; échec de lecture → pas de contexte affiché.

**Gate terminal.** Le navigateur installateur peut redéclencher `beforeinstallprompt`
dans son onglet même après installation (vérifié sur Brave Android). `getInstalledRelatedApps()`
— présent sur Chromium Android 84+ et desktop 140+, absent d'iOS et Firefox — répond « app
installée sur ce terminal » ; l'invite est alors masquée. Cross-navigateur (installé via
Chrome, ouvert dans Brave) reste indétectable : trade-off documenté, iOS compris. Les
surfaces d'invite attendent la fin du check (`installCheckPending`) avant de s'afficher :
pas de flash d'invite sur un appareil déjà équipé.

Composants : `PwaInstallBanner` (les surfaces d'invite : plein format sur l'accueil,
compact sur les plannings ; le footer du layout porte le bouton Chromium mobile, même
gate), `PwaManualInstructions` (étapes par plateforme — partagé), `PwaManualInstallModal`
(instructions manuelles, ouvert depuis la variante compacte non-Chromium).
`PwaInstallBanner` est un identifiant code ; le vocabulaire utilisateur reste celui du
glossaire (« invite d'installation »). L'invite est
une alerte **permanente** : pas de fermeture, c'est une information, pas une interruption.
Le contenu des alertes s'empile en colonne sur mobile.

Règle de nommage i18n : **un nom décrit le contenu, jamais la position ni le mécanisme ;
préfixe de plateforme seulement si le contenu est propre à la plateforme** — famille
`pwa_install_*` (l'invitation), `pwa_howto_{ios,android}_*` (instructions, variantes
seulement là où le texte diffère), un verbe canonique `common_install_app`.

L'événement `appinstalled` marque l'installation côté PocketBase
(`users.pwa_installed`, seulement si une session est valide) — un repère d'adoption, sans
effet sur le comportement.

Le toast de mise à jour vit dans `+layout.svelte` : `installStore.init()` et
`swUpdateStore.init()` dans `onMount`, puis un `$effect` sur `swUpdateStore.hasUpdate` qui
affiche un toast **persistant** (durée infinie) tant que l'utilisateur n'a pas agi.
L'identifiant fixe (`sw-update`) est le garde anti-doublon idiomatique de svelte-sonner :
si l'effet se rejoue, le toast existant est mis à jour au lieu d'être dupliqué.

## Pièges

| Piège                                             | Conséquence                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Cacher `/api/*` (REST ou SSE) dans le SW          | 200 périmé sans erreur réseau → données désynchronisées en silence                                                       |
| `skipWaiting()` automatique à l'`install`         | rechargement en pleine saisie                                                                                            |
| Pas de `clients.claim()` à l'`activate`           | le premier service worker n'est actif qu'au rechargement suivant                                                         |
| Pas de drapeau de première prise de contrôle      | rechargement intempestif au premier install, ou absence de rechargement sur une vraie mise à jour                        |
| `reg.update()` au démarrage                       | requête redondante                                                                                                       |
| Pas de throttle sur `reg.update()`                | trafic inutile (limite de spec : 1 par minute)                                                                           |
| `pageshow` sans `event.persisted`                 | vérification inutile à chaque navigation client                                                                          |
| `visibilitychange` sans test `=== 'visible'`      | vérification au moment où l'onglet devient caché                                                                         |
| Pas de `.catch()` sur `reg.update()`              | rejet non traité si hors ligne                                                                                           |
| Toast sans identifiant fixe, ou à durée finie     | doublons, ou toast qui disparaît avant l'action                                                                          |
| Manifest sans icône `maskable`                    | icône écrasée sur Android                                                                                                |
| Afficher l'invite sans attendre le check terminal | flash d'invite sur un appareil où l'app est déjà installée (`installCheckPending`)                                       |
| Mur sans gate `userStore.isReady`                 | flash de mur pendant la restauration d'une session valide au boot                                                        |
| Test user-agent seul pour iOS                     | iPadOS 13+ rapporte un user-agent Macintosh → iPad sur instructions Android ; ajouter `maxTouchPoints` (`isPlatformIos`) |

## Tests manuels

Le service worker est actif aussi en développement — SvelteKit enregistre et sert
nativement `/service-worker.js`, et `localhost` est un contexte sécurisé (push vérifié
de bout en bout). Ces tests demandent néanmoins un build de production : ils exercent le
pré-cache d'assets hachés et le cycle de mise à jour, qui n'ont de sens qu'avec un manifest
de build.

- Premier install silencieux, dans une navigation privée vierge.
- Aller-retour d'onglet → toast sans rechargement (détection proactive).
- Clic « Mettre à jour » → rechargement, nouvelle version active.
- Onglet Network des DevTools : aucune requête `/api/*` servie par le cache, SSE
  `/api/realtime` non intercepté.
- Throttle respecté : au plus une vérification de `/service-worker.js` par minute.
- Brave Android, app installée via Brave, onglet navigateur : invite d'installation
  masquée (gate `getInstalledRelatedApps`).
- iPad (iPadOS 13+) : instructions iOS (Partage → Écran d'accueil), pas Android.
- DevTools onglet Application : manifest avec `id`, `scope`, `launch_handler`,
  `related_applications`.

## Fichiers clés

- `svelte.config.js` — adapter-static, fallback SPA
- `src/app.html` — en-tête HTML (manifest, theme-color, apple-touch-icon)
- `src/app.d.ts` — types `BeforeInstallPromptEvent` et `getInstalledRelatedApps`
- `static/manifest.webmanifest`, `static/icon-{192,512}.png` — manifest et icônes
- `src/service-worker.ts` — cache, cycle de vie, push
- `src/lib/stores/installStore.svelte.ts` — installation : détection, prompt, gate
  terminal
- `src/lib/stores/swUpdateStore.svelte.ts` — détection de mise à jour et activation
- `src/lib/components/auth/AuthWall.svelte` — mur d'authentification de l'app installée
  (contexte planning via `getPlanningTitleByToken`)
- `src/lib/components/auth/AuthPanel.svelte` — formulaire + bascule connexion/création,
  partagé entre AccountModal et AuthWall
- `src/lib/components/PwaInstallBanner.svelte` — surfaces d'invite (plein, compact)
- `src/lib/components/PwaManualInstructions.svelte` — étapes par plateforme
- `src/lib/components/PwaManualInstallModal.svelte` — modal d'instructions manuelles
- `src/lib/utils/platform.ts` — détection iOS pure (user-agent + multi-touch)
- `src/routes/+layout.svelte` — toast de mise à jour, boot des stores, bouton footer,
  condition du mur d'authentification
