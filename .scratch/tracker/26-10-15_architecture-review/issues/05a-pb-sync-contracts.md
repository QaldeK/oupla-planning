# 05a: pb-sync — contrats et frontière de couche

**What to build:** Rendre la frontière de couche vérifiable et couvrir les contrats du paquet. (1) Inverser la seule arête montante `data/collections → networkStore` : `collections.ts` expose un observer injecté, câblé dans `+layout.svelte`. (2) Retirer la table Dexie `deletions`, morte depuis sa création (version Dexie 6). (3) Couvrir `tombstoneCollection` par un test d'intégration, dans ses deux modes. (4) Conserver `mergeByKey`/`applyMergeStrategies` (déjà testés) et documenter les contrats non exercés par l'app. (5) Documenter la sémantique realtime du SDK.

**Blocked by:** None (can start immediately).

**Status:** done

- **Re-scopé après grilling (2026-10-18)** : le ticket 05 d'origine visait « 8 membres sur 16 réellement utilisés ». Mauvais critère pour un paquet : l'API d'une bibliothèque est un contrat, pas un inventaire d'appels. `mergeByKey` est testé et documenté, simplement désactivé dans cette app ; le supprimer serait une régression. Critère retenu : **chaque membre exposé est exercé par l'app, ou couvert par un test qui documente son contrat.**
- **Force à la revue** : **Forte** sur le volet structure. `data/` doit être importable par tous, donc ne jamais importer un store ; une seule arête viole la règle et agrège 8 modules en une composante fortement connexe (`collections → networkStore → syncService → userStore → collections`, mesuré après [06](06-auth-data-sync.md)).
- Source d'évidence : graphe d'imports calculé sur `src/` (118 fichiers ; une composante de 8 modules, plus le barrel `components/occurrences` en type-only) ; la table `deletions` naît avec le paquet (`git log -S deletions -- src/lib/pb-sync/db.ts` → `5eca3d4`), `git log -S "db.deletions"` est vide et rien ne la lit ni ne l'écrit ; `tombstoneCollection` jamais configuré ni testé. Le volet batch est déplacé dans [05b](05b-batch-decision.md).
- Contraintes : ADR-0003 (offline-first pb-sync/Dexie) intact ; ADR-0017 (pas de curseur) non touché. `pb-sync/*` n'importe déjà aucun store — c'est `data/collections.ts` (composition applicative) qui crée le cycle.
- Process : implémentation directe. Seule la mise en test du tombstone est exploratoire (création d'une collection temporaire côté serveur jetable).
- [x] `data/` n'importe plus aucun store ; l'observer de souscription est injecté au boot.
- [x] La table Dexie `deletions` est supprimée par une version Dexie 6 ; README pb-sync à jour — trois drifts mesurés (2026-10-18) : la section « Usage in the Project » montre encore les collections créées dans `planningStore.svelte.ts` **avec** `mergeStrategies` (réel : `data/collections.ts`, merge client retiré, décision documentée dans le fichier) ; le schéma Dexie liste encore `deletions:` ; `onSubscriptionChange` — l'option réellement utilisée par l'app (`pb-sync/types.ts:83`) — n'y figure pas.
- [x] `tombstoneCollection` est couvert par un test d'intégration (`localTrash: true` et `false`).
- [x] `mergeByKey` est conservé et documenté comme contrat du paquet.
- [x] La sémantique realtime est documentée : dédoublonnage transport par `(topic + options)`, listeners locaux non dédoublonnés, reconnexion automatique du SDK.
- [x] Vérification : aucun import de `$lib/stores` dans `src/lib/data/` ni `src/lib/pb-sync/` ; test:unit + test:integration + `bun run check` passent.
- [x] Le contrôle du graphe d'imports échoue dès qu'une arête **interne** à une composante fortement connexe > 1 de `src/lib` n'est pas déclarée nommément dans une liste d'arêtes acceptées. Granularité = l'arête, pas la composante : une arête ajoutée dans une zone gelée doit être déclarée consciemment même quand la composante ne bouge pas — c'est exactement ce qu'a fait [06](06-auth-data-sync.md) au trio (`authTransition → userStore`), qu'un contrôle par composante aurait laissé passer. Liste amorcée sur les 5 arêtes du trio (cf. [04](04-identity-session-p-token.md)) ; le contrôle vit dans `tests/unit/`, il court donc avec `bun run test:unit` ; son échec affiche les arêtes fautives et les lignes à déclarer. Protège l'acquis de ce ticket et celui de 06, sans exiger la sortie du trio.
- [x] Le barrel `components/occurrences` (`index.ts ↔ views/OccurrenceView.svelte`, deux arêtes type-only, aucune au runtime) est **réparé** — le type partagé sort du barrel — pour que la liste d'arêtes acceptées ne contienne que le trio.

**Preuves à conserver dans le ticket** (pour la reprise à froid) :

| Constat | Commande / source |
|---|---|
| Composante de 8 modules, 18 arêtes internes | graphe d'imports de `src/` (118 fichiers, 2 SCC > 1) ; retirer l'arête `collections → networkStore` la ramène à 3 (le trio) |
| `deletions` mort-née | `git log -S "db.deletions"` vide ; seule `pb-sync/db.ts` la mentionne |
| Tombstone non couvert | aucun test ne configure `tombstoneCollection` |
| `mergeByKey` couvert | `tests/integration/pb-sync-collection.test.ts:80` |

## Comments

**Implémentation (2026-10-18)** — commits `2326a1c`, `2e40580`, `4e51943` (+ `ad67d81` pour l'instance de test).

- Le gros du lot (observer injecté dans `data/collections.ts`, Dexie v6 sans `deletions`, README, docs, barrel réparé, test d'intégration des tombstones) est arrivé dans `2326a1c`, embarqué par une session parallèle de triage de lint qui a committé l'arbre modifié avec ses propres fichiers. Les deux fichiers neufs étaient restés non suivis et forment les deux commits suivants : `2e40580` (`viewProps.ts` — sans lui, un checkout propre de HEAD importait un module absent) et `4e51943` (`tests/unit/import-graph.test.ts`).
- Le correctif du serveur de test (`--automigrate=false` dans `pocketbase/dev-test-server.sh`) a été emporté par le même sweep, dans `ad67d81` : les changements de schéma faits par les tests via l'API n'écrivent plus de fichier de migration dans le dépôt. Vérifié sur base vierge : le drapeau ne coupe que la génération, l'application des migrations du dépôt au démarrage est intacte.
- Validation rejouée sur la révision finale (`4e51943`) : `bun run check` 61 fichiers / 0 erreur / 0 warning ; `test:unit` 43 fichiers, 504 passés / 3 ignorés ; `test:integration` 22 fichiers, 259 passés, `pb_migrations/` inchangé après le run.
- Garde-fou : `tests/unit/import-graph.test.ts` (Tarjan sur `src/`, granularité arête, liste acceptée = les 5 arêtes du trio d'auth). Non-vacuité prouvée pendant le développement : liste vidée → les 5 arêtes du trio listées ; liste pointée sur `services/` → 2 fautifs réels.
- Trou connu porté au backlog : `unsubscribe(ref)` (référence, unitaire) n'est appelé nulle part et ne prévient pas `onSubscriptionChange` — `hasActiveSubscription` resterait vrai après un tel appel.
