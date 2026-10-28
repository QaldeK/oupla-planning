# 02: Le workflow de réponse aux Occurrences a une seule maison

**What to build:** Une factory unique `occurrenceResponseWorkflow`, paramétrée par l'acteur (self | admin), qui possède la garde onEvent (« viser ≠ present alors qu'on est inscrit à une tâche onEvent → confirmation requise »), le `pendingResponseChange`, la construction de `ParticipantResponse` (aujourd'hui copiée ×4), la règle « tâche onEvent ⇒ auto present » et la dérivation du message de confirmation. Les trois surfaces (état partagé, modal admin, affectation volontaires) consomment la factory au lieu de porter chacune leur copie.

**Blocked by:** None (can start immediately).

**Status:** done

- Force à la revue : **Forte** — règle dupliquée ×2–4 selon la brique, zéro test sur les factories extraites.
- Source d'évidence (file:line, diagrammes avant/après) : `.scratch/architecture-review/20261015-212715.html`, candidat 2.
- Contraintes : aucune tension ADR. Vocabulaire domaine : Occurrence, Concerné, Message.
- Process : passer par grilling → spec courte avant implémentation.
- [x] La garde onEvent n'existe qu'à un seul endroit, paramétrée par l'acteur.
- [x] La construction de `ParticipantResponse` n'existe qu'à un seul endroit.
- [x] Les deux paires de clés i18n du message de confirmation sont unifiées (ou la duplication est assumée et documentée).
- [x] La factory est testée sans DOM (garde, construction, message).
- [x] Les trois surfaces consomment la factory ; les suites check + test:unit + test:integration passent.
