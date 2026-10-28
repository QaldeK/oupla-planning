# 06: La séquence de données post-auth a un seul propriétaire

**What to build:** Deux modules neutres remplacent la séquence recopiée : `claimPlannings(masters)` (le payload du POST `/api/sync-plannings`, aujourd'hui écrit ×3) et `syncAuthData()` (fetch masters → fetch occurrences → `markAuthSynced`, aujourd'hui écrit ×3 — dont un chemin qui l'a oublié). Les trois chemins auth (boot, transition guest→auth, polling réseau) et `#attachMasterToUser` les consomment. **Aucun état nouveau, aucun cycle d'import, `subscribe` exclu de la séquence.**

**Blocked by:** None (can start immediately).

**Status:** done

- **Re-scopé après grilling (2026-10-18)** : le ticket d'origine demandait un `fullResync()` incluant `subscribe` et `read-state`. La mesure du code a montré que seuls *fetch + marqueur* sont communs aux trois chemins ; le reste diverge légitimement (périmètres de claim différents, clear Dexie au milieu de la transition, polling qui ne doit ni souscrire ni recalculer les badges). Forcer l'ensemble dans une fonction unique produisait un drapeau d'état (`#globalSubActive`) doublant le registre de pb-sync. Décisions et interface complètes : [spec-06](../spec-06-auth-data-sync.md).
- **Force à la revue** : **Forte** — deux défauts réels, pas un simple nettoyage.
  1. Le payload du claim est recopié ×3 ([syncService](../../../../src/lib/services/syncService.ts), [authTransition](../../../../src/lib/utils/authTransition.ts), [planningStore](../../../../src/lib/stores/planningStore.svelte.ts)), et la forme du triplet se retrouve dans les tests.
  2. La transition guest→auth n'appelle **jamais** `markAuthSynced`, alors que la doc de [userStore.svelte.ts](../../../../src/lib/stores/userStore.svelte.ts) désigne explicitement ce chemin. La « Dernière sync » reste périmée après une connexion jusqu'au prochain polling.
- Source d'évidence (file:line, diagrammes avant/après) : `.scratch/architecture-review/20261015-212715.html`, candidat 6 ; grilling 2026-10-18.
- Contraintes : ADR-0009 (le marqueur de fraîcheur appartient au store — il n'est pas déplacé, seulement *déclenché* par le module), ADR-0017 (fenêtre de date, non touchée). Les fakes de `authTransition` (ports & adapters) se réutilisent : `syncAuthData` est une dépendance injectée.
- Process : grilling bouclé, décisions verrouillées dans la spec. Implémentation directe.
- [x] Le payload du POST `/api/sync-plannings` est construit à un seul endroit (`claimPlannings`), et il n'existe qu'un seul `POST` dans le code.
- [x] `markAuthSynced` n'est invoqué que par `syncAuthData`, après les fetch — les appelants passent la référence, jamais un appel direct. L'invariant est structurel, pas défensif.
- [x] Les trois chemins auth passent par `syncAuthData` ; le test unitaire de la transition vérifie l'ordre (claim → clear → sync → subscribe → read-state).
- [x] Un test d'intégration vérifie que `userStore.lastAuthSyncAt` est posé après `transitionToAuth` (régression du drift).
- [x] Aucun cycle d'import ajouté : `userStore ↔ syncService` n'apparaît pas (module neutre à marqueur injecté).
- [x] test:unit + test:integration + `bun run check` passent.

## Comments

**Implémentation (2026-10-18)** — commit `be9b823`.

- Modules : `src/lib/services/claimPlannings.ts` et `src/lib/services/authDataSync.ts`. Tous deux sont **injectés** aux sites qui traversent un store (`AuthTransitionDeps.claimPlannings`, `AuthTransitionDeps.syncAuthData`) ; `syncService` et `planningStore` les importent directement, comme prévu.
- Marqueur structurel : `markSynced` est appelé après les deux fetch dans le même corps de `syncAuthData`, sans `try/catch` interne ; les appelants ne passent que la référence (`() => this.markAuthSynced()`). Vérifié par grep : aucune invocation directe hors du module.
- Arête ajoutée, assumée : `stores/authTransition.svelte → stores/userStore.svelte` (lecture de `markAuthSynced`). Mesure du graphe d'imports : elle ne change pas la composition de la composante fortement connexe — le wrapper y est déjà via `planningStore` — mais c'est une arête de plus à retirer le jour où la boucle est cassée. Faits consignés dans [04](04-identity-session-p-token.md) ; le contrôle de composantes ajouté à [05a](05a-pb-sync-contracts.md) la rendra visible.
- Validation : `bun run check` 0 erreur ; `test:unit` 502 passés / 3 ignorés (4 tests unitaires de modules ajoutés, `authTransition` porté à 11 cas d'ordre et d'erreur) ; `test:integration` 257 passés, dont le nouveau cas « pose le marqueur de fraîcheur après la transition ». `svelte-autofixer` sans signalement sur `authTransition.svelte.ts`.
- `bun run lint` reste rouge (23 erreurs) : **toutes préexistantes**, mesurées sur l'arbre d'avant le commit (`noNonNullAssertion` dans `pb-sync/*` et `routes/*`, `useLiteralKeys`, `organizeImports`). Une seule était introduite par ce commit (ordre des imports dans `utils/authTransition.ts`), corrigée. `bun run lint` n'entre pas dans la validation requise par AGENTS.md.

**Non-objectifs** (explicites) : pas de `fullResync` incluant `subscribe`/`read-state` (le SDK se resouscrit seul) ; pas d'idempotence de `subscribe` ; pas de travail sur l'interface pb-sync ([05a](05a-pb-sync-contracts.md)) ; pas de traitement du cycle d'orchestration `userStore ↔ planningStore ↔ authTransition.svelte`.

**Revue code (2026-10-18)** — diff `be9b823` relu sur les deux axes (Standards, Spec), citations re-vérifiées sur l'arbre.

- Aucun défaut de fond : D3/D5/D6/D7/D9 vérifiés par lecture ; les 6 critères confirmés — le 6e (`check` + suites) rejoué le 2026-10-18 sur `7e26583` : `bun run check` 0 erreur / 0 warning, `test:unit` 502 passés / 3 ignorés, `test:integration` 257 passés.
- Corrigés en `7627160` : `docs/architecture/stores.md:43` (« seul écrivain de `lastAuthSyncAt` » ignorait les remises à `null` de `logout()`/`clearAllLocalData()`) et la JSDoc de `markAuthSynced`, qui listait encore les trois appelants directs supprimés par D2 — un prochain auteur suivant la doc aurait contourné `syncAuthData`.
- Corrigés en `7e26583` : le nom du cas d'intégration et son commentaire d'état initial énoncent l'invariant au lieu de raconter la régression corrigée (`tests/integration/user-store.test.ts:352`, `:362-363`) ; renvoi ADR-0009 retiré de la doc de `claimPlannings.ts:6-8` (l'ADR traite du seam identité/auth, pas des imports) ; ligne `// === SEED ===` fusionnée réparée par `biome format` sur ce fichier.
- Dette de lint (22 erreurs préexistantes, mesurées sur `be9b823`) portée au backlog du tracker.
