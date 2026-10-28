> Backlog — ouvert tant que ce fichier existe. Supprimer quand implémenté ou rejeté (l'historique git est l'archive).

Tag: debt · Urgence: conditional · Source: spec mur d'authentification (26-10-28_install-sans-compte) · Ancre: src/lib/utils/authTransition.ts:128

La transition guest → auth ne réclame que le planning actif (`runAuthTransition`, étape 4), puis vide Dexie/`localMeta` : un invité multi-plannings qui crée son compte depuis le mur — premier lancement sur `/` : aucun planning réclamé du tout — perd l'accès local aux autres plannings (récupérables seulement via le lien d'origine). Or l'endpoint `/api/sync-plannings` accepte un batch et ignore silencieusement les tokens invalides, et `syncService.sync()` applique déjà le pattern « tous les masters Dexie ».

Reco : étendre l'étape 4 à `db.masters.toArray()`, mais seulement après investigation poussée des implications (code, UI, UX) — un premier portage complet avait été abandonné pour des problèmes de consistance (edge cases terminaux partagés, risque de vol d'identité). Attention : `tests/unit/authTransition.test.ts` asserte le claim du planning actif seul.
