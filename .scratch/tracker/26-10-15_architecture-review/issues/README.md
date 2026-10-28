# Tracker — revue d'architecture du 2026-10-15

Source : `.scratch/architecture-review/20261015-212715.html`.

## Tickets

| Ticket | Statut | Bloqueur | En une ligne |
| --- | --- | --- | --- |
| [01](01-notification-events-producer.md) | done | — | producteur unique d'events de notification (serveur) |
| [02](02-occurrence-response-workflow.md) | done | — | factory unique du workflow de réponse |
| [03](03-planning-actions-three-tiers.md) | done | — | planningActions séparé en trois étages |
| [08](08-planning-store-token-cache.md) | done | — | cache mémoire de tokens supprimé (commit `340c8cb`) |
| [06](06-auth-data-sync.md) | done | — | `claimPlannings` + `syncAuthData` ; marqueur de fraîcheur infalsifiable |
| [05a](05a-pb-sync-contracts.md) | done | — | frontière de couche + contrats pb-sync (commits `2326a1c`, `2e40580`, `4e51943`) |
| [05b](05b-batch-decision.md) | needs-triage | — | batch : adopt-or-delete (ADR d'abord) |
| [04](04-identity-session-p-token.md) | needs-triage | flux identity stabilisé | module `planningIdentitySession` |
| [07](07-planning-form-product-rules.md) | needs-triage | — | règles produit hors du PlanningForm |

## Specs

| Spec | Sujet |
| --- | --- |
| [spec-01](../spec-01-notification-events-producer.md) | producteur d'events de notification |
| [spec-02](../spec-02-occurrence-response-workflow.md) | workflow de réponse aux Occurrences |
| [spec-03](../spec-03-planning-actions-three-tiers.md) | planningActions |
| [spec-06](../spec-06-auth-data-sync.md) | séquence de données post-auth |

05a n'a pas de spec (mécanique). 05b produit une **ADR**, qui tient lieu de spec.

## Ordre suggéré

**06 → 05a → 05b.**

Aucune dépendance dure entre les trois : les fichiers touchés sont disjoints.

- **06 d'abord** : corrige un défaut réel (marqueur jamais posé après connexion), périmètre clos, n'ajoute aucun état.
- **05a ensuite** : casse le cycle et rend la frontière de couche vérifiable ; à ce stade, la vérification couvre aussi les modules ajoutés par 06.
- **05b en dernier** : décision d'architecture (ADR), indépendante de tout code.

Inverser 06 et 05a se fait **sans reprise de travail** : si l'objectif immédiat est le paquet réemployable, 05a peut passer devant.

## Dette connue, hors périmètre

Cycle d'orchestration `userStore ↔ planningStore ↔ authTransition.svelte` : seul cycle de valeur restant après 05a. Usages différés, aucun effet runtime, app-internal. Noté dans [04](04-identity-session-p-token.md), faits mesurés (composantes, arêtes, questions à trancher) : idem 04. Instrument de mesure ajouté à [05a](05a-pb-sync-contracts.md) : contrôle du graphe d'imports, liste d'arêtes acceptées (granularité arête, pas composante).

## Statuts

`done` · `ready-for-agent` (spécifié, implémentable) · `needs-triage` (à arbitrer avant d'implémenter).
