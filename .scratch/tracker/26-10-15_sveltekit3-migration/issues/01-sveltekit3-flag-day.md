# 01: Bascule SvelteKit 3 (flag day)

**What to build:** L'application compile, démarre et passe le trio de validation complet sous SvelteKit 3. Démarche : bumps (`@sveltejs/kit` ^3, `@sveltejs/adapter-static` ^4, TypeScript 6.0.x, `svelte-check` ^6 — versions déjà cadrées par les peers), puis `sv migrate sveltekit-3` (réécrit automatiquement `#lib`, config, tsconfig, env, shallow routing, paths), puis traitement de ses TODO `@migration-task` et des résidus. Le swap minimal des imports du service worker (`build`/`files`/`version` vers les nouveaux modules) fait partie de ce ticket : le build ne peut pas passer vert sinon — la modernisation complète est le ticket 02.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] `sv migrate sveltekit-3` exécuté ; plus aucun TODO `@migration-task` non traité
- [ ] Grep résidus = 0 : `$lib`, `$app/stores`, `pushState`/`replaceState`, `invalidateAll`
- [ ] Configuration unique dans le plugin Vite (adapter fallback SPA, inspector, preprocess) ; `svelte.config.js` supprimé
- [ ] `tsconfig.json` étend `$app/tsconfig` ; variables d'env déclarées explicitement (`src/env.ts`), dont l'URL PocketBase
- [ ] Service worker compile sur les nouveaux modules Kit 3
- [ ] Trio vert : `check` + `test:unit` + `test:integration` (instance jetable 8091, procédure `docs/agents/integration-tests.md`)
- [ ] AGENTS.md à jour (SvelteKit 3, TypeScript 6)

## Comments

- Prefactoring déjà fait : `$app/stores` → `$app/state` migré en avance (commit 8fef549), une tâche du script en moins.
- Stratégie `#lib` validée : déléguée au script, pas d'expand-contract manuel.
- Pièges connus : paths sans `/` initial (`resolve`, `asset`), `goto` rejette les URLs hors routes, redirects externes à opt-in (`allowExternal`), CSRF toujours actif (`trustedOrigins` si besoin) — sans form actions ni cookies Kit, l'app est peu exposée.
