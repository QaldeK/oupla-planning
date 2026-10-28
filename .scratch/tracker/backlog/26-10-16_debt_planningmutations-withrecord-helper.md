> Backlog — ouvert tant que ce fichier existe. Supprimer quand implémenté ou rejeté (l'historique git est l'archive).

Tag: `debt` · Urgence: `light` · Source: code-review du refactor planningActions (2cfded3) · Ancre: `planningMutations.ts`

- Le couple « lecture Dexie (`getTable().get`) + `if (!current) throw` » se répète ×3 côté masters (`addParticipant`, `updateParticipant`, `quitPlanning`) et ×3 côté occurrences (`submitResponse`, `addComment`, `deleteComment`) — hérité de l'ancien `planningActions.ts` ; un helper `withMasterRecord`/`withOccurrenceRecord` absorberait les six sites. Impact : lisible mais toute évolution de la stratégie de relecture touche six endroits. Poids : ~20 lignes, risque nul (tests verts à chaque étage).
