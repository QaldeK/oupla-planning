> Backlog — ouvert tant que ce fichier existe. Supprimer quand implémenté ou rejeté (l'historique git est l'archive).

Tag: `bug` · Urgence: `soon` · Source: code-review du fix 403 · Ancre: `tests/integration/planning-actions.test.ts:694`

- `deletePlanning(master.id)` appelé sans le `expectedVersion` requis par la signature ; invisible car les tests sont hors du périmètre de `bun run check`. Compléter l'appel — et à terme, brancher les tests sur le typecheck.
