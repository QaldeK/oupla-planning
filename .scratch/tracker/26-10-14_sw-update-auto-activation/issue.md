# Auto-activation du SW en attente au chargement frais

**Type:** task
**Status:** needs-triage
**Date:** 2026-10-14

## Problème

Après la suppression du court-circuit sur `reg.waiting` dans
`#triggerUpdateCheck` (piste 1), un second déploiement pendant qu'un toast est
affiché finit par être découvert — mais seulement au prochain signal
d'activité throttlé. Et dans le cas « utilisateur absent pendant v2 + v3 »,
le clic « Mettre à jour » peut encore déclencher **deux reloads en chaîne**
(reload vers v2 → le check navigateur du reload découvre v3 → second toast).

## Solution envisagée

Au **chargement frais** (document neuf, `pwaStore.init()` au boot) : si
`reg.waiting` existe dès `getRegistration()`, activer immédiatement —
`postMessage({ type: 'SKIP_WAITING' })` — et afficher un toast transient
« Mise à jour en cours… » pour expliquer le reload qui suit. Pas de toast
« Mettre à jour » : l'utilisateur n'a rien à décider.

Sûr par construction : au chargement frais il n'existe aucun état de
formulaire en cours. **Jamais** sur restore BFCache (`pageshow` +
`event.persisted`) : la page y est ressuscitée avec son état.

Garde-fous déjà en place : `firstClaimDone` (pas de reload au premier
install), `#refreshing` (un seul reload), check navigateur automatique au
load (pas de `reg.update()` explicite nécessaire).

## Fichiers pressentis

- `src/lib/stores/pwaStore.svelte.ts` — logique d'auto-activation au boot
- `src/routes/+layout.svelte` — toast « Mise à jour en cours… »
- `messages/fr.json` + `messages/en.json` — 1 clé

## À dissocier (lot séparé, non spécifié)

Toast post-MAJ « Mise à jour effectuée (vX.Y.Z) » avec action « Voir les
nouveautés » (lien externe vers `CHANGELOG.md` sur GitHub). Détection par
comparaison de version (`localStorage 'pwa-last-seen-version'` vs `version`
de `package.json`), sans flag session — validé en discussion ; garde à
prévoir : premier install (stockage silencieux, sans toast) et éventuellement
ne toaster qu'en montée de version. Hypothèse fonctionnelle : tout
déploiement bumpe la version (procédure release).
