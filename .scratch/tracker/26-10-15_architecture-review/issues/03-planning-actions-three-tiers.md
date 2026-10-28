# 03: planningActions — séparer les trois étages

**What to build:** Éclater le gros service d'actions Planning selon ses coutures : un module pur `occurrenceDiff` (targets vs occurrences existantes → ops, aujourd'hui ~140 lignes noyées), un module de mutations qui possède `lastModifiedBy` (aujourd'hui répété ×17) et la résolution du Token (aujourd'hui threadée par chaque caller), les helpers purs déménagés hors du service (aujourd'hui inatteignables en test sans instance PB à cause des effets de bord d'import), et les six exports morts supprimés (vérifiés à la revue).

**Blocked by:** None (can start immediately).

**Status:** done

- Force à la revue : **Forte** — ~27 exports pour 12 callers, interface presque aussi large que l'implémentation.
- Source d'évidence (file:line, diagrammes avant/après) : `.scratch/architecture-review/20261015-212715.html`, candidat 3.
- Contraintes : ADR-0001 (Token via query param), ADR-0003 (écritures via pb-sync) et ADR-0012 respectés. La couverture intégration existante (planning-actions, create-flow, claim-identity) sert de filet.
- Process : passer par grilling → spec courte avant implémentation.
- [x] Le diff d'occurrences vit dans un module pur, testable sans instance PocketBase. (occurrenceDiff.ts + 12 tests unitaires en ~0,6 s)
- [x] Les mutations posent `lastModifiedBy` et résolvent le Token elles-mêmes ; les callers ne les threadent plus. (`withAudit` interne ; exceptions documentées : créations — `restorePlanning` surcédée par `resolveWriteToken()`, 26-10-18)
- [x] Les paramètres de cache (`currentMaster?`/`currentOccurrence?`) ne fuient plus dans l'interface (celui accepté puis ignoré est supprimé). (+ le `participantToken` mort d'`updatePlanningWithOccurrences`)
- [x] Les six exports morts sont supprimés. (tests réorientés : setup → `createPlanningWithOccurrences`, sécurité → `updatePlanningWithOccurrences` ; blocs `removeParticipant`/`removeResponse` retirés)
- [x] test:unit + test:integration + bun run check passent. (check 0 erreur · unit 491 ✓ · integration 256 ✓)

**Complété** : voir commit de refactor ; deux écarts de spec assumés documentés dans [spec-03](../spec-03-planning-actions-three-tiers.md) §2 (D2, D6).
