# 04: CI/CD Cloudflare Pages + doc de déploiement

**What to build:** La chaîne de déploiement Cloudflare Pages produit un build SvelteKit 3 fonctionnel et vérifié : version de Node du build ≥ 22.17 réglée explicitement, `bun install --frozen-lockfile` vert sur le nouveau lockfile, et un déploiement de contrôle validé (routes directes, fallback SPA, assets immuables). La doc de déploiement reflète la nouvelle stack.

**Blocked by:** 01 (Bascule SvelteKit 3). — Le build CI n'exerce pas le service worker, donc pas de dépendance au ticket 02.

**Status:** ready-for-agent

- [ ] Node du build CF Pages ≥ 22.17, réglage explicite et documenté
- [ ] Build CF Pages vert (`bun install --frozen-lockfile` + build) sur Kit 3
- [ ] Déploiement de contrôle vérifié : route directe, deep-link via fallback SPA, assets hashés
- [ ] `deployment.md` à jour (Kit 3, réglages éventuellement nouveaux)
