# 05b: pb-sync — trancher le batch (adopt-or-delete)

**What to build:** Trancher consciemment l'incohérence batch, puis appliquer la décision. Deux affirmations incompatibles coexistent : `executeBatch` existe (Dexie-first, rollback, reconcile) avec **zéro caller et zéro test** ; et le service d'actions affirme en commentaire que le batch multi-collections n'est pas pris en charge par pb-sync, tout en écrivant son propre batch inline qui **ne touche pas Dexie**. Soit `executeBatch` devient l'abstraction unique et la mise à jour de Planning avec Occurrences le consomme, soit il est supprimé et le statu quo est documenté honnêtement.

**Blocked by:** None (mais la décision précède le code).

**Status:** needs-triage

- **Force à la revue** : **À explorer** — un module exporté sans contrat clair est une fausse promesse, et le commentaire contredit est un piège pour le prochain lecteur.
- Source d'évidence : `executeBatch` (0 caller, 0 test) ; commentaire du service d'actions ; `.scratch/architecture-review/20261015-212715.html`, candidat 5.
- Contraintes : ADR-0003 (offline-first) intact. Le batch inline actuel n'écrit pas Dexie : la convergence locale repose sur le SSE ou la sync suivante — acceptable offline-first, mais **décidé par omission**, ce qui est précisément ce que l'ADR doit corriger.
- Process : grilling court → ADR → implémentation. La sortie de ce ticket est d'abord une décision, pas du code.
- [x] La décision est écrite en ADR (adopt ou delete, avec le trade-off de convergence Dexie) — `docs/adr/0018-multi-collection-batch-reconcile.md`.
- [x] Une seule abstraction batch existe dans le code — `executeMultiCollectionBatch` (multi-collections, non optimiste, reconcile Dexie) + builder `collection.createBatch()` (mono-collection, optimiste) ; `BatchOp` morte supprimée de `types.ts`.
- [x] Le commentaire contredit est corrigé ou rendu vrai — rendu vrai : `updatePlanningWithOccurrences` consomme pb-sync (ADR-0018).
- [x] test:unit + test:integration + `bun run check` passent — 511 unit (44 fichiers), 263 intégration (23 fichiers), check 0 erreur.

**Indépendance** : ce ticket ne partage aucun fichier avec [06](06-auth-data-sync.md) ni [05a](05a-pb-sync-contracts.md). Il peut être pris à tout moment, mais reste volontairement en dernier dans l'ordre suggéré : c'est une décision d'architecture, pas une passe de nettoyage.
