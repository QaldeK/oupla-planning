# Auto-activation du SW en attente au chargement frais

**Type:** task
**Status:** ready-for-agent
**Date:** 2026-10-14

## Problème

Après la suppression du court-circuit sur `reg.waiting` dans
`#triggerUpdateCheck` (piste 1), un second déploiement pendant qu'un toast est
affiché finit par être découvert — mais seulement au prochain signal
d'activité throttlé. Et dans le cas « utilisateur absent pendant v2 + v3 »,
le clic « Mettre à jour » peut encore déclencher **deux reloads en chaîne**
(reload vers v2 → le check navigateur du reload découvre v3 → second toast).

Par ailleurs, à chaque ouverture de l'app tant que l'update n'est pas pris,
l'utilisateur paie un toast persistant + un clic pour une décision qui ne
protège rien : au chargement frais, aucune saisie n'est en cours.

## Solution validée (discussion 2026-10-29)

Au **chargement frais** (document neuf, `swUpdateStore.init()` au boot) : si
`reg.waiting` existe dès `getRegistration()` et que
`navigator.serviceWorker.controller` est non-null, activer immédiatement —
`postMessage({ type: 'SKIP_WAITING' })` — puis reload via `controllerchange`.

**Sans aucun toast.** L'activation d'un worker déjà installé est locale, le
reload suit en ~100-500 ms : un toast « Mise à jour en cours… » serait à
peine perceptible, et pas de toast « Mettre à jour » non plus — l'utilisateur
n'a rien à décider.

### Point d'implémentation critique

`#reloadRequested` n'est posé que dans `applyUpdate()`. Le chemin de boot doit
le poser AVANT le `postMessage`, sinon `controllerchange` prend la branche
« autre onglet » (`hasUpdate = true` → toast persistant au lieu du reload).
Refactor : extraire un helper privé `#activateWaiting()` (flag + postMessage)
partagé par `applyUpdate()` et le boot ; remplacer le
`if (reg.waiting) this.hasUpdate = true` du boot par cet appel — pas de
`hasUpdate` dans ce chemin.

### Garde-fous

Déjà en place : `firstClaimDone` (pas de reload au premier install),
`#refreshing` (un seul reload), check navigateur automatique au load (pas de
`reg.update()` explicite nécessaire). Le test `controller` non-null est le cas
nominal « page fraîche déjà contrôlée par l'ancien SW » et élimine le coin
théorique premier-install.

Offline : `SKIP_WAITING` sur un worker déjà installé est purement local ;
après reload, le cache-first sert le nouveau cache. Multi-onglets : l'onglet
en pleine session reçoit le `controllerchange` sans l'avoir demandé → toast
sans reload (consentement préservé). BFCache : `#initialized` rend `init()`
unique par document, le restore ne rejoue jamais l'auto-activation — aucun
code dédié. Le reload ~100-500 ms après le boot est bénin : l'offline-first
(Dexie, `/api/*` hors SW) reprend la sync après reload.

## Périmètre réel sur la chaîne v2→v3

Le fix ne couvre que le cas « `waiting` déjà présent au boot » (installs
terminés avant l'ouverture). Le cas « clic active v2 → le reload découvre v3
encore en cours d'installation » garde le second toast quelques secondes
après le reload (via `updatefound`), `waiting` étant null au boot de la page
rechargée. Extension rejetée : auto-activer toute découverte dans une fenêtre
de N secondes après le boot — non déterministe, l'utilisateur peut déjà
saisir. Ne pas mesurer le fix sur ce scénario.

## Fichiers pressentis

- `src/lib/stores/swUpdateStore.svelte.ts` — helper `#activateWaiting()`,
  branche boot dans `init()`, garde `controller` non-null
- `tests/unit/swUpdateStore-update-check.test.ts` — boot avec `waiting` :
  `postMessage(SKIP_WAITING)` + reload au `controllerchange`, pas de
  `hasUpdate`
- `docs/architecture/pwa.md` — §3 : activation conditionnelle (chargement
  frais vs action utilisateur) ; tableau Pièges

## À dissocier (lot séparé, non spécifié)

Toast post-MAJ « Mise à jour effectuée (vX.Y.Z) » avec action « Voir les
nouveautés » (lien externe vers `CHANGELOG.md` sur GitHub). Détection par
comparaison de version (`localStorage 'pwa-last-seen-version'` vs `version`
de `package.json`), sans flag session — validé en discussion ; garde à
prévoir : premier install (stockage silencieux, sans toast) et éventuellement
ne toaster qu'en montée de version. Hypothèse fonctionnelle : tout
déploiement bumpe la version (procédure release).
