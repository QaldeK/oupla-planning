# 01: Un seul producteur d'events de notification côté serveur

**What to build:** Un module serveur unique propriétaire de la plomberie de production d'events de notification — `insertEvent()`, `getMasterContext()` (avec le check `deleted` unifié, aujourd'hui divergent entre hook et cron) et `resolveUserName()`. Les trois points d'entrée (hook occurrence, cron, planning-deletion) deviennent de fins câblages → détecteurs → producteur, et la plomberie devient unit-testable.

**Blocked by:** None (can start immediately).

**Status:** done

- Force à la revue : **Forte** — hot spot le plus chaud (26 commits pb_hooks depuis juillet), duplication triple prouvée file:line.
- Source d'évidence (file:line, diagrammes avant/après) : `.scratch/architecture-review/20261015-212715.html`, candidat 1.
- Contraintes : ADR-0007 (hooks partagés en `.cjs`) respecté — le module sort en `.cjs` testé, sur le pattern déjà prouvé par `notify-utils.cjs` et les détecteurs purs. Aucune tension ADR.
- Process : passer par grilling → spec courte avant implémentation (l'interface exacte du producteur reste à dessiner).
- [x] L'insertion d'une row `notification_events` n'existe qu'à un seul endroit.
- [x] Le contexte master+participants est résolu par une seule fonction, avec le check `deleted` partout.
- [x] La résolution du nom d'affichage d'un userId n'existe qu'à un seul endroit (l'export mort du détecteur est soit utilisé, soit supprimé).
- [x] Le module est couvert par des tests unitaires (pattern `.cjs`).
- [x] Les suites d'intégration notifications (cron, occurrence-update, planning-deletion) passent.
