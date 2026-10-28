# 08: planningStore — supprimer le double cache de Tokens

**What to build:** Supprimer le cache mémoire de Tokens du store de Plannings (aujourd'hui mémoïse le résultat de la résolution master-par-Token, alors que Dexie est déjà le cache, indexé par participantToken/adminToken). La résolution devient « Dexie puis réseau+upsert » ; les trois chemins d'invalidation qui n'existaient que pour le cas rare token A → token B → token A dans une même session disparaissent. Accessoirement, déplacer l'effet de bord claim-admin (aujourd'hui fire-and-forget dans une fonction de lecture) vers l'activation du Planning, seul endroit qui connaît le contexte.

**Blocked by:** None (can start immediately) — à coupler idéalement avec le ticket 03 (même couche store/service, churn commun).

**Status:** done

- Triage (post-03) : prémisses vérifiées sur le code actuel, et le cache est **encore plus mort que décrit** — `getOrFetchMaster` n'a qu'un caller (`#activatePlanning`), n'y entre que sur échec de la résolution Dexie, et le `upsertRecord` qui suit le fetch réseau remplit déjà Dexie : le scénario token A → B → A est couvert par Dexie, le cache mémoire n'est jamais re-consulté. Il ne masquerait qu'un échec d'upsert (cas où, sans lui, on repasse un fetch réseau). Deletion test pleinement acquis. Force à la revue réévaluée : **faible risque, gain de suppression net**.
- Source d'évidence : `.scratch/architecture-review/20261015-212715.html`, section « Repérés, écartés du périmètre ».
- Contraintes : ADR-0009 (le marqueur de fraîcheur appartient au store — non touché) et ADR-0017 (fenêtre de date, non touché) respectés. Le deletion test passe : la complexité disparaît à la suppression, elle ne se déplace pas.
- Process : trier d'abord ; si retenu, implémentation courte (pas besoin de grilling, la solution est triviale), mais les tests planning-store existants doivent rester verts.
- [x] Le cache mémoire de Tokens est supprimé ; la résolution passe par Dexie puis le réseau. (`getOrFetchMaster` supprimé, fetch réseau inliné dans `#activatePlanning` via `getPlanningByToken`)
- [x] Les chemins d'invalidation associés sont supprimés. (`#tokenCache`, `#masterTokens`, `invalidateAll`, invalidation dans `#markAsDeleted` et `#deactivate` ; `invalidateActiveToken` conservée — elle porte `#currentToken`, pas le cache)
- [x] Le claim-admin ne se déclenche plus depuis la lecture par Token. (`getPlanningByToken` redevenue une lecture pure ; `#claimAdminAccess` appelé dans la branche auth de `#activatePlanning`, awaité, échec non bloquant)
- [x] planning-store-guest + planning-store-auth-claim + master-refresh passent. (check 0 erreur · unit 491 ✓ · integration 256 ✓)

**Complété** (commit `340c8cb`) : deux écarts assumés vs le comportement antérieur — (1) le claim-admin est désormais **awaité** dans l'activation (déterministe, plus de sleep 200 ms dans le test) au lieu de fire-and-forget, échec toujours non bloquant ; (2) il est **skippé pour les masters soft-deleted** (branche readOnly), cohérent avec « pas d'écriture en consultation lecture seule ». Gains collatéraux : retenté à chaque activation tant que `adminOf` ne porte pas le master (avant : uniquement au fetch réseau, donc jamais sur re-visite), et déclenché même si le claim principal est skippé. Doc : `docs/architecture/stores.md` § Résolution et suppression.
