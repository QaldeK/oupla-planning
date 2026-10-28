# 02: Service worker modernisé sur les modules Kit 3

**What to build:** Le service worker PWA devient idiomatique Kit 3 : `self` correctement typé, URLs d'assets résolues par l'API officielle au lieu de concaténations manuelles, précache potentiellement enrichi des pages prérendues. Le flux de mise à jour offline est revalidé de bout en bout sur un build réel (détection d'une nouvelle version → rafraîchissement du cache → activation selon la mécanique existante). Zone critique PWA : consulter la documentation avant toute modification.

**Blocked by:** 01 (Bascule SvelteKit 3).

**Status:** ready-for-agent

- [ ] `self` typé via `$app/service-worker`, avec tsconfig dédié du service worker
- [ ] URLs d'assets construites via `asset()`/`resolved` (plus de concaténation manuelle du base path)
- [ ] Utilité de `prerendered`/`routes` (précache sélectif) évaluée — décision notée, même négative
- [ ] Flux de mise à jour vérifié sur build réel : nouvelle version détectée, cache rafraîchi, activation conforme à la mécanique en place
- [ ] Doc PWA (`pwa-architecture.md`) et ADR-0004 mis à jour (adapter-static 4)
