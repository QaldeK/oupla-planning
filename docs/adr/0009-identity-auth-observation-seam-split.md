# Séparation identity / auth observation (seam split)

- **Date** : 2026-07-24
- **Statut** : Accepted
- **Décision** : Séparer les responsabilités identité, auth observation et
  transition guest→auth en 4 modules distincts
- **Mois de décision** : Juillet 2026

## Contexte

`userStore` (499 lignes) fusionnait historiquement 5 responsabilités sans lien :

1. **Auth observation** (`isLoggedIn`, `pbUser`, `logout`)
2. **État guest** (`savedPlannings`, identités locales, `hasQuit`)
3. **Transition auth** (`onAuthTransition`, `isTransitioning`, `pendingGuestClaim`)
4. **Curseur de sync** (`lastFetchAt`, `markFetched`, `restoreLastFetchAt`)
5. **Préférences UI + modal** (`appPreferences`, `authModal`)

Cette fusion avait deux conséquences :

- La règle d'identité ADR-0002 (auth > guest > identité revendiquée) était
  dupliquée entre `userStore.getIdentityForPlanning()` et la dérivation inline
  de `/p/[token]/+page.svelte`. La version du store **ne gérait pas** le cas
  « identité revendiquée par un compte auth sur un autre terminal »
  (`claimedByAuth`) — un bug latent.
- `onAuthTransition()` (92 lignes, 6 dépendances) était piégée dans le callback
  `pb.authStore.onChange`, donc inatteignable aux tests unitaires.

## Décision

Créer 4 modules, chacun avec une responsabilité unique :

### `guestStateStore` (store réactif)

État guest par planning : identités locales (`currentUser`), état `hasQuit`.
`guestStates` est un **miroir `liveQuery`** de `localMeta` (même pattern que
`planningStore.#allMasters`) — Dexie est l'unique source of truth, les écritures
(`setGuestIdentity`, `markGuestQuit`) ne touchent que `currentUser`/`hasQuit`
via patch partiel (`upsertLocalMeta`). Le teardown de `localMeta` appartient à
l'orchestrateur (`runAuthTransition` étape 5, `userStore.#clearLocalDexie`),
jamais au store : le reset du miroir est automatique via la subscription.
`loadGuestState()` monte la subscription et résout à la première émission
(attendue au boot avant `userStore.init()`).

### `userStore` (store réactif — modifié)

Garde uniquement : `isLoggedIn`, `pbUser`, `authModal`, `appPreferences`,
`lastAuthSyncAt`, `logout`, `logoutAndStayOnPlanning`, `markAuthSynced`.
Toute la logique guest et transition en est retirée.

### `identityResolution` (fonction pure)

Règle ADR-0002 consolidée dans une fonction pure `resolveCurrentIdentity(input)`.
Input figé (`IdentityInput`), output déterministe (`IdentityResolution`).
Testable sans montage Svelte (~5ms/test). Cinq CAS documentés.

### `authTransition` (pure + wrapper réactif)

- Fonction pure `runAuthTransition(ctx, deps)` : orchestre la séquence
  snapshot → unsubscribe → sync → clear → fetch → subscribe → reactivate.
  Dépendances injectées (`AuthTransitionDeps`) pour test avec fakes.
- Wrapper réactif `AuthTransition` : gère `isTransitioning` (guard anti-$effect)
  et `pendingGuestClaim` (snapshot consommé par `/p/[token]`).

### `planningStore` (modifié)

Propriétaire de `lastFetchAt` (curseur de sync delta). `markFetched`
et `restoreLastFetchAt` y sont déplacés depuis `userStore`.

## Conséquences

### Positives

- La règle ADR-0002 a désormais une adresse unique et complète (5 cas,
  y compris `claimedByAuth`)
- La transition auth est testable unitairement (fakes en deps)
- `userStore` perd ~200 lignes et retrouve de la navigabilité
- L'écriture partielle (`db.localMeta.update`) permet à deux écrivains de
  coexister sur `localMeta` sans écrasement

### Négatives

- Plus de modules à connaître : développeur doit choisir entre 4 stores +
  1 util pour une question d'identité
- Risque de dual-write si un écrivain utilise `put` (full replace) au lieu de
  `update` : atténué par la convention documentée dans la spec et les ADR
- Le boot nécessite un ordering explicite : `loadGuestState()` avant
  `userStore.init()`

### Risques

- **Race au boot** : `authStore.onChange` peut-il fire avant `loadGuestState` ?
  Non — `onChange` ne fire que sur changement, pas sur le load initial.
- **Régression `/p/[token]`** : la re-dérivation inline (lignes 74–103) est
  subtile. Mitigation : tests purs couvrant les 5 cas avant migration, test
  d'intégration existant après.

## Alternatives considérées

- **Ne rien faire** : le bug `claimedByAuth` non géré continue de vivre (rejeté :
  bug latent en production potentielle)
- **Facade unique** : un store `identityStore` qui encapsule les 4 modules
  (rejeté : complexité inutile, chaque module a un consommateur direct distinct)
- **Migration en 1 PR** : tout déplacer d'un coup (rejeté : blast radius trop
  grand, 3 PRs incrémentales pour auditabilité)

## Références

- ADR-0002 : Identité par planning pour les guests — renforcée, non contredite
- `.scratch/identity-auth-split/spec.md` — spec complète du refactor
- Conformité mob : 2026-07-21 architecture review, candidat #2
