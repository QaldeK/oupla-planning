# Stores

État réactif de l'application : qui détient quoi, qui écrit quoi dans Dexie, et comment le
planning actif est activé. Vocabulaire : `CONTEXT.md` (Saved planning, Planning actif,
pb-sync, Dexie).

Ce document couvre le contrat d'état. La mécanique de synchronisation est dans
`offline-sync.md`, le verrou d'édition admin dans `admin-lock.md`, le statut réseau dans
`network-realtime.md`, le compte et les identités dans `auth-identity.md`.

## Règle de couche et boucles acceptées

Les flèches descendent : `pb-sync → data → stores → services → components` (et `routes`). Chaque
module ne connaît que ce qui est en dessous de lui. `data/collections.ts` est importable par
tout le monde, donc il n'importe aucun store : l'état « au moins une souscription realtime est
ouverte », dont dépend le polling de reconnexion (`network-realtime.md`), lui remonte par un
observer injecté au boot dans `+layout.svelte`.

Une arête montante n'est pas illégale en soi — c'est la **boucle** qu'elle referme qui coûte :
deux modules d'une même boucle ne se lisent, ne se testent ni ne se remplacent séparément, et
leur ordre d'initialisation devient un contrat implicite.

Une seule boucle est acceptée : le trio d'authentification `userStore` ↔ `planningStore` ↔
`authTransition` (cinq arêtes). La transition guest → auth doit lire l'état des deux stores, et
les deux stores doivent pouvoir la déclencher (ADR-0009) ; en sortir demande de déplacer
l'orchestration de la transition, pas d'en retirer un appel.

Ce gel est tenu par un test : `tests/unit/import-graph.test.ts` recalcule le graphe d'imports de
`src/`, en extrait les composantes fortement connexes, et échoue dès qu'une arête **interne** à
une composante > 1 n'est pas déclarée nommément dans sa liste d'arêtes acceptées. La granularité
est l'arête, pas la composante : ajouter un appel à l'intérieur d'une boucle existante doit
rester un acte conscient. Retirer une arête de la liste est toujours légitime ; en ajouter une
est une décision.

## Propriété des tables Dexie

L'invariant le plus utile à connaître avant de toucher un store : **plusieurs acteurs
écrivent la même table, chacun sur ses propres champs, en patch partiel**. Aucun ne
réécrit le record entier (ADR-0009).

| Table Dexie    | Écrivains                           | Champs écrits                        |
| -------------- | ----------------------------------- | ------------------------------------ |
| `masters`      | collections pb-sync, `upsertRecord` | record complet                       |
| `occurrences`  | collections pb-sync, `upsertRecord` | record complet                       |
| `commentState` | `commentStateService`               | `isUserInConversation`, `lastReadAt` |
| `localMeta`    | `guestStateStore`                   | `currentUser`, `hasQuit`             |
| `localMeta`    | `planningStore`                     | `lastFetchAt`                        |

Les écrivains de `localMeta` passent par `upsertLocalMeta` (patch partiel). `guestStates`
est un **miroir liveQuery** de cette table : `$state` alimenté par la subscription, aucun
double-write ni bookkeeping manuel. Le reset devient automatique quand un orchestrateur
vide `localMeta` (`runAuthTransition`, `userStore.#clearLocalDexie`).

## `userStore`

Compte authentifié, préférences et orchestration du boot.

| Membre                                            | Rôle                                                                                                                                                        |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isLoggedIn`                                      | reflet de `pb.authStore.isValid`, maintenu par `authStore.onChange`                                                                                         |
| `pbUser`                                          | getter `{ id, name, email }` dérivé de `pb.authStore.record`, `null` sinon                                                                                  |
| `appPreferences`                                  | `{ theme, occurrenceView }` — persisté sous `app_preferences`                                                                                               |
| `authModal`                                       | état du modal d'identification (ouvert, contexte du planning)                                                                                               |
| `isReady`                                         | true après `init()`                                                                                                                                         |
| `lastAuthSyncAt`                                  | date de la dernière sync globale auth, persistée sous `auth_sync_at`, pour la fraîcheur affichée par `NetworkAlert`                                         |
| `init()`                                          | séquence de boot (ci-dessous)                                                                                                                               |
| `markAuthSynced()`                                | écrivain du marqueur de fraîcheur (`logout()`/`clearAllLocalData()` le remettent à `null`) ; sa référence est passée à `syncAuthData`, qui décide du moment |
| `setTheme` / `setOccurrenceView` / `setAppLocale` | préférences ; la locale s'écrit aussi sur le record `users` si connecté (ADR-0010)                                                                          |
| `logout()` / `clearUser()`                        | redirection `/`, clear authStore, clear Dexie, `planningStore.destroy()`                                                                                    |
| `logoutAndStayOnPlanning(token)`                  | déconnexion sans quitter le planning (voir `auth-identity.md`)                                                                                              |
| `deleteAccount()`                                 | endpoint `/api/delete-account` puis `logout()` (ADR-0013)                                                                                                   |
| `clearAllLocalData()`                             | purge complète ; recharge la page si connecté                                                                                                               |

Séquence de `init()` :

1. `ensureDbReady()` — ouverture défensive de la base, reset automatique si migration cassée (ADR-0006).
2. `isLoggedIn` armé, puis `pb.authStore.onChange` : la bascule guest → auth délègue à `authTransition.transitionToAuth()` (fire-and-forget, le callback n'accepte pas d'`async`).
3. `planningStore.initGlobalSync()` — liveQuery global sidebar/homepage.
4. Préférences : thème OS par défaut, `occurrenceView` dérivé du support (`mediaQuery.isMobile`).
5. `lastAuthSyncAt` relu depuis `auth_sync_at`.
6. Si déjà connecté : `refreshSessionSilently()` (session glissante, non bloquant), `#subscribeAuth()`, `syncPushSubscription()`.

`#subscribeAuth()` délègue la séquence de données à `syncAuthData` (fetch complet des
masters → fetch des occurrences actives → marqueur de fraîcheur, ADR-0017), puis monte les
deux souscriptions globales pb-sync et synchronise l'état de lecture des commentaires.

**Ce que `userStore` ne fait plus** : les identités guest (`guestStateStore`), la transition
guest → auth (`authTransition`), le cache du planning actif (`planningStore`). Les identités
guest et la transition y ont été retirées — ADR-0009 pour la seconde.

## `guestStateStore`

État guest par planning, adossé à Dexie `localMeta`.

| Membre                                                    | Rôle                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------- |
| `guestStates`                                             | miroir liveQuery de `localMeta`                                   |
| `loadGuestState()`                                        | monte la subscription, idempotente, résout à la première émission |
| `getGuestIdentity(masterId)`                              | identité guest du planning, ou `null`                             |
| `setGuestIdentity(masterId, identity)`                    | écrit `currentUser` (patch partiel)                               |
| `markGuestQuit(masterId)` / `getGuestQuitState(masterId)` | état « a quitté ce planning »                                     |

**Contrainte d'ordonnancement** : `loadGuestState()` doit être appelé au boot **avant**
`userStore.init()`. Le liveQuery doit avoir émis au moins une fois, sinon la transition
guest → auth n'a pas de snapshot d'identité à capturer. La promesse résout à la première
émission précisément pour rendre cet ordre possible.

La subscription n'est jamais démontée : même cycle de vie que le liveQuery global de
`planningStore`.

## `planningStore`

État du **planning actif** — celui désigné par le token de l'URL. Pont entre Dexie et
PocketBase : Dexie est le seul cache des masters (indexé par token), le liveQuery en est
le miroir réactif.

### État et getters

| Membre                                       | Rôle                                                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `master` / `occurrences`                     | alimentés par liveQuery Dexie ; `occurrences` **exclut** les soft-deleted                            |
| `futureOccurrences`                          | occurrences à partir d'aujourd'hui, soft-deleted **incluses** — source du formulaire d'édition admin |
| `currentOccurrence` / `selectedOccurrenceId` | occurrence sélectionnée                                                                              |
| `activeMasterId` / `currentToken`            | planning actif et token courant                                                                      |
| `isLoading` / `error`                        | `error` typé `network` / `not_found` / `deleted`                                                     |
| `isDeleted`                                  | le master actif est soft-deleted — consultation en lecture seule                                     |
| `activeMasters` / `deletedMasters`           | liveQuery global, sidebar et homepage                                                                |
| `lastFetchAtFor(masterId)`                   | marqueur de fraîcheur UI, jamais un curseur de fetch                                                 |

Le seuil `today` de `futureOccurrences` est figé au moment de la souscription : un
changement de jour demande une navigation ou une réactivation.

### Activation

`setActiveToken(token, dateFilter)` est le point d'entrée, appelé par le layout qui observe
`page.params.token`. Il est idempotent : un token déjà actif ne repasse pas le cycle. Après
guards et `ensureDbReady()`, il délègue à `#activatePlanning` :

| Étape | Contenu                                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Résoudre le master : Dexie d'abord, sinon réseau via `getPlanningByToken` + `upsertRecord`                                      |
| 2     | Vérifier la suppression : locale, puis serveur si déjà en Dexie (`#refreshMasterFromServer`)                                    |
| 3     | Idempotence, puis `#activeMasterId`                                                                                             |
| 4     | Sync des occurrences actives **toujours avec `_token`**, puis brancher les liveQuery page-scoped                                |
| 5     | Branche Compte : `#attachMasterToUser` (claim), `#claimAdminAccess` si lien admin, backfill des commentaires si première visite |
| 6     | Branche Guest : souscription realtime individuelle scopée token, backfill des commentaires                                      |

Le `_token` de l'étape 4 est requis même pour un utilisateur connecté : à ce stade,
`user.masterId` n'est pas encore peuplé côté serveur, les API Rules refuseraient un appel
sans token.

Un master soft-deleted (`readOnly`) saute les étapes 5 et 6 : claim et souscription
écriraient au chargement et se heurteraient aux gardes serveur.

**Le claim de l'étape 5 est ce qui débloque le realtime global.** En mode Compte,
`#activatePlanning` ne monte aucune souscription individuelle : c'est la souscription
globale (topic `'*'`, montée par `userStore.#subscribeAuth`) qui couvre le master, et elle
ne le peut qu'une fois `user.masterId` peuplé côté serveur. D'où le claim synchrone ici.

### Actions et cycle de vie

| Méthode                       | Rôle                                                              |
| ----------------------------- | ----------------------------------------------------------------- |
| `setSelectedOccurrenceId(id)` | sélection                                                         |
| `markFetched(masterId)`       | écrit `lastFetchAt` (marqueur de fraîcheur UI)                    |
| `refreshActive()`             | master puis occurrences actives — appelé à la reconnexion réseau  |
| `refreshArchiveOccurrences()` | fetch des occurrences passées, à la demande de la page archive    |
| `invalidateActiveToken()`     | force le prochain `setActiveToken` à repasser un cycle complet    |
| `destroy()`                   | `#deactivate()` + liveQuery global                                |
| `cleanDeletedPlannings()`     | purge définitive des masters soft-deleted et de leurs `localMeta` |

### Résolution et suppression

Dexie est le seul cache des masters : la résolution token → master passe par les index
`participantToken`/`adminToken`, et le fallback réseau (`getPlanningByToken`) upserte sa
réponse dans Dexie — un cache mémoire par-dessus ne servirait qu'à masquer un échec
d'upsert. Le claim des droits admin (lien 64 hex) se fait à l'activation, branche Compte
(`#claimAdminAccess`) : non bloquant, retenté à chaque activation tant que `adminOf` ne
porte pas le master. Un 404 sur le master le marque `deleted: true` localement, lui et ses
occurrences : c'est le seul chemin qui découvre une suppression serveur, le master n'étant
couvert par aucune re-sync d'occurrences.

### Token des écritures

La résolution ci-dessus est aussi celle des écritures (`services/planningMutations.ts`) : le
token de la page atteste la navigation, pas la capacité d'écriture. Un appareil qui détient
l'`adminToken` le garde en Dexie (`onRecordEnrich` le masque côté API, `upsertRecord` préserve
la valeur locale) et affiche donc les affordances admin même derrière un lien participant
(`/p/…`) : `resolveWriteToken()` retient l'`adminToken` du planning visité dès que
l'appareil le détient, à défaut le token de la page. Écrire avec ce dernier ferait refuser par
le hook les champs admin-only d'une occurrence (403 « Participants can only update responses,
comments, and tasks »). La
restauration d'un planning supprimé, ouverte depuis une page `/p` sous participantToken
(redirection post-suppression), repose sur la même règle.

## Autres stores

| Store               | Rôle                                             | Doc                   |
| ------------------- | ------------------------------------------------ | --------------------- |
| `authTransition`    | guards et snapshot de la transition guest → auth | `auth-identity.md`    |
| `networkStore`      | statut réseau, re-sync à la reconnexion          | `network-realtime.md` |
| `commentStateStore` | badges de commentaires non lus                   | `offline-sync.md`     |
| `pwaStore`          | détection de mise à jour du service worker       | `pwa.md`              |
| `drawerStore`       | tiroir latéral (occurrence courante, master)     | —                     |
| `modalStore`        | modales génériques                               | —                     |
| `mediaQuery`        | media queries réactives (`isMobile`)             | —                     |

## Pièges

- **`markFetched` n'est pas un curseur.** `lastFetchAt` sert à afficher la fraîcheur ; la
  re-sync est bornée par `date` et ne s'appuie jamais dessus (ADR-0017). Un code qui
  l'utilise comme `since` réintroduit la classe de bugs du curseur client.
- **`#lastFetchAtMap` est un `SvelteMap`, pas un `Map`.** Un `Map` natif placé dans un
  `$state` de Svelte 5 n'est pas proxifié : la réactivité ne se déclencherait pas.
- **Un liveQuery sur `localMeta` se déclencherait aussi sur les écritures de
  `guestStateStore`.** C'est pourquoi le marqueur de fraîcheur est maintenu dans une map
  ciblée plutôt que par liveQuery — sinon chaque changement d'identité guest re-rendrait
  l'UI de fraîcheur.
- **`initGlobalSync()` est nécessaire à `activeMasters`.** Sans lui, la sidebar et la
  homepage restent vides même si Dexie contient des masters.
- **Le master n'est couvert par aucune re-sync d'occurrences** : sans
  `#refreshMasterFromServer`, des participants ajoutés pendant une coupure SSE seraient
  perdus définitivement, faute de rejouabilité du realtime.

## Fichiers clés

- `src/lib/stores/userStore.svelte.ts` — compte, préférences, boot
- `src/lib/stores/guestStateStore.svelte.ts` — état guest par planning
- `src/lib/stores/planningStore.svelte.ts` — planning actif, résolution token, liveQuery
- `src/lib/stores/authTransition.svelte.ts` — wrapper de transition
- `src/lib/pb-sync/db.ts` — schéma Dexie, `ensureDbReady`, `upsertLocalMeta`, `upsertRecord`
- `src/lib/data/collections.ts` — collections pb-sync (voir `offline-sync.md`)
- `src/lib/types/planning.types.ts` — `SavedPlanning`, `PlanningIdentity`, `Participant`
- `src/routes/+layout.svelte` — ordonnancement du boot (guest state puis `userStore.init()`)
