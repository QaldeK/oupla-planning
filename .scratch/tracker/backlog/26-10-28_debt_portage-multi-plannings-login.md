> Backlog — ouvert tant que ce fichier existe. Supprimer quand implémenté ou rejeté (l'historique git est l'archive).

Tag: debt · Urgence: soon · Source: spec mur d'authentification (26-10-28_install-sans-compte) · Ancre: src/lib/utils/authTransition.ts:128

La transition guest → auth ne réclame que le planning actif (`runAuthTransition`, étape 4), puis vide Dexie/`localMeta` : un invité multi-plannings qui crée son compte depuis le mur — premier lancement sur `/` : aucun planning réclamé du tout — perd l'accès local aux autres plannings (récupérables seulement via le lien d'origine). Or l'endpoint `/api/sync-plannings` accepte un batch et ignore silencieusement les tokens invalides, et `syncService.sync()` applique déjà le pattern « tous les masters Dexie ».

## Pourquoi le mur rend le cas inconditionnel

Avant le mur, la perte restait optionnelle : un invité pouvait continuer sans compte. Depuis `d930f8f`, toute app installée sans session affiche le mur (`authWallActive`, `src/routes/+layout.svelte:135`) et la création de compte déclenche la transition. Le scénario n'est donc plus un cas de bord : c'est le chemin de tout invité déjà installé au premier lancement après mise à jour.

## Chaîne exacte à modifier

1. `src/routes/+layout.svelte:135` — `authWallActive = installStore.isInstalled && userStore.isReady && !userStore.isLoggedIn`.
2. `src/lib/stores/userStore.svelte.ts:57-70` — `pb.authStore.onChange` déclenche `authTransition.transitionToAuth()` sur guest → auth.
3. `src/lib/utils/authTransition.ts:128-147` — étape 4 : `if (currentToken && activeMasterId)` puis claim d'**un seul** master. Sur `/`, `currentToken` est `null` → zéro claim.
4. `src/lib/utils/authTransition.ts:149-151` — étape 5 : `db.masters.clear()`, `db.occurrences.clear()`, `db.commentState.clear()`, `db.localMeta.clear()`.
5. `src/lib/services/claimPlannings.ts` — batch vers `/api/sync-plannings`.

## Contraintes déjà connues

- Un premier portage complet (claim de tous les masters) a été abandonné : cas limites des événements terminaux partagés et risque de vol d'identité. Toute reprise doit rouvrir ce dossier, pas seulement boucler `db.masters.toArray()`.
- `tests/unit/authTransition.test.ts` asserte aujourd'hui le claim du planning actif seul : il faudra le faire évoluer avec la décision.
- L'identité guest vit en `localMeta` : le `clear()` de l'étape 5 efface aussi les identités, pas seulement le cache.
- `docs/architecture/auth-identity.md:128-129` décrit correctement le claim unique ; d'autres passages (guide PWA, `auth-identity.md:196-199`) parlent de « plannings » au pluriel et devront être alignés.

## Pistes à arbitrer

- **A. Claim de tous les masters Dexie** avant le clear — le plus complet ; rouvre les cas limites d'identité et de terminalité qui avaient fait abandonner le premier portage.
- **B. Claim du courant + conservation des masters non réclamés** (ne pas clear ceux dont le claim a échoué) — préserve l'accès local, mais laisse des copies guest à côté des copies auth ; il faut définir la règle de cohabitation et le nettoyage ultérieur.
- **C. Flux dédié au mur** : réclamer explicitement, avant le clear, ce que l'utilisateur voit et choisit (écran « rattacher vos plannings ») — plus de travail UI, mais rend la décision visible et évite la perte silencieuse.

## Critères d'acceptation (quelle que soit la piste)

- Invité installé avec N plannings, création de compte depuis `/` : les N plannings restent accessibles après la transition (ou sont explicitement proposés au rattachement).
- Création de compte depuis `/p/<token>` : le planning courant est réclamé, les autres ne disparaissent pas silencieusement.
- Échec réseau pendant le claim : rien n'est effacé avant confirmation.
- Tests : un cas unitaire sur `runAuthTransition` (claim multiple / conservation) et un cas d'intégration sur `/api/sync-plannings` en batch.
