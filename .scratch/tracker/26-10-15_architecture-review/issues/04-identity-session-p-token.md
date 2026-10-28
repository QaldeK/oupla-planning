# 04: La session d'identité de la vue participant

**What to build:** Un module `planningIdentitySession` qui possède le workflow d'identification de la vue participant : identify / switch / decline — addParticipant ou updateParticipant → ensurePlanningParticipant → setGuestIdentity (aujourd'hui déroulé depuis 4 sites), avec statut de retour. La page ne garde que le mapping action → modal (aujourd'hui 7 flags + un `$effect` à 8 branches), et délègue la garde CAS C au lieu de la recopier (aujourd'hui dupliquée entre la page et la stratégie).

**Blocked by:** None (can start immediately), **mais** : à attaquer quand le flux identity sera stabilisé — les surfaces viennent d'être retravaillées (split rename/switch, correctifs claim). Une 4e surface identity qui réexige la garde est le signal idéal.

**Status:** needs-triage

- Force à la revue : **À explorer** — churn maximal (75 commits sur la page, la plus churnée du repo) mais flux fraîchement stabilisé ; risque de casser du frais pour ~20 lignes de locality si fait trop tôt.
- Source d'évidence (file:line, diagrammes de séquence avant/après) : `.scratch/architecture-review/20261015-212715.html`, candidat 4.
- Contraintes : **prolonge l'ADR-0009** (split identity/auth/observation) sans le rouvrir — même mouvement, étage exécution. ADR-0002 (identité scopée au planning) respecté.
- Process : grilling obligatoire avant implémentation — la forme du module (fonction vs store réactif, périmètre exact) est la question ouverte.
- [ ] L'ordonnancement « écriture serveur → identité locale → fermeture modal » vit dans un seul module.
- [ ] La garde CAS C n'existe qu'à un seul endroit (la copie de la page est supprimée).
- [ ] `ensurePlanningParticipant` est appelé depuis un seul site.
- [ ] Le workflow d'identification est testé avec des fakes (réutilisables de ceux d'authTransition), sans monter la page.
- [ ] La page ne porte plus que le mapping action → modal.

**Contexte lié (2026-10-18)** : après [05a](05a-pb-sync-contracts.md), le seul cycle de valeur restant est `userStore ↔ planningStore ↔ authTransition.svelte`. Ce ticket est le candidat naturel pour l'attaquer, puisque le workflow d'identité traverse ces trois modules — mais il n'y est pas tenu : le cycle est stable et sans effet runtime.

**Articulation avec [05a](05a-pb-sync-contracts.md)** : le contrôle de graphe ajouté par 05a gèle le trio sous forme d'une **liste d'arêtes acceptées** (les 5 arêtes, nommées), pas d'une exception de composante. Si le grilling de ce ticket conclut à casser une ou plusieurs de ces arêtes, la liste se réduit **dans la même passe** ; à l'inverse, toute arête nouvelle dans le trio (comme celle ajoutée par [06](06-auth-data-sync.md), `authTransition → userStore`) doit être déclarée consciemment — sinon le contrôle échoue.

**Faits mesurés (2026-10-18, composantes fortement connexes du graphe d'imports de `src/lib`)** :

- La composante contient **7 modules** avant [06](06-auth-data-sync.md) et **8** après (`services/authDataSync` s'y branche, et en sort avec 05a). Retirer l'arête `data/collections → stores/networkStore` — celle de 05a — la ramène à **3** : `userStore`, `planningStore`, `authTransition.svelte`.
- Ce trio tient par **4 arêtes** : `userStore → planningStore` (5 usages : `initGlobalSync`, `destroy` ×2, `setActiveToken`, `invalidateActiveToken`), `planningStore → userStore` (**1 usage** : `userStore.isLoggedIn` dans la branche auth/guest de `#activatePlanning`), `userStore → authTransition` (**1 appel** : `transitionToAuth()` depuis `authStore.onChange`), `authTransition → planningStore` (injection + `currentToken`/`activeMasterId`).
- Sortir du cycle demande de trancher deux questions : `planningStore` reçoit-il le mode (auth / guest) au lieu de lire `userStore.isLoggedIn` ? Qui porte l'abonnement `pb.authStore.onChange` ? Instrument de mesure : le contrôle du graphe d'imports ajouté à 05a.
- Arête ajoutée par 06 : `authTransition.svelte → userStore` (le marqueur `markAuthSynced` est importé par le wrapper, variante retenue contre le passage en paramètre). Elle ne change pas la composition de la composante — elle est déjà dans le trio — mais c'est une arête de plus à retirer le jour où l'on casse la boucle.
