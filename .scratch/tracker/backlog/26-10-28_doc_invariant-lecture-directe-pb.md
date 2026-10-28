> Backlog — ouvert tant que ce fichier existe. Supprimer quand implémenté ou rejeté (l'historique git est l'archive).

Tag: doc · Urgence: light · Source: code-review mur d'authentification (26-10-28_install-sans-compte) · Ancre: docs/architecture/README.md:40

L'invariant blueprint « le client ne lit jamais PocketBase directement : tout passe par pb-sync et Dexie » est contredit par `src/lib/services/planningReads.ts` (`getPlanningByToken`, lecture directe `getFirstListItem`, antérieure au mur d'authentification qui vient d'en ajouter un consommateur via `getPlanningTitleByToken`). Les stores ne lisent pas PB, mais les services si — la frontière réelle n'est pas celle que la doc énonce.

Reco : soit documenter l'exception réelle (lectures par token hors session/pb-sync : `planningReads.ts`), soit reworder l'invariant en « les stores lisent via Dexie ; les services peuvent lire PB par token ». Impact faible mais un blueprint faux piège le prochain agent.
