# Déploiement Cloudflare Pages (frontend planning)

Config du projet Pages : `SKIP_DEPENDENCY_INSTALL=true`, `BUN_VERSION=1.4.2` (pin = version bun locale), build command `bun install --frozen-lockfile && bun run build`, output `build`.

Pourquoi : CF Pages détecte le package manager par lockfile et ne reconnaît pas `bun.lock` texte (Bun ≥1.2, seulement le binaire `bun.lockb`) → sinon fallback `npm install` sans lockfile = résolution non reproductible (incident sept 2026 : crash npm `edgesOut` sur l'arbre d'un commit identique au deploy vert précédent).

Règles :
- `--frozen-lockfile` ne se retire jamais — erreur `lockfile had changes` = désynchronisation réelle package.json/bun.lock → `bun install` en local + commit du lockfile.
- Toute édition des deps passe par `bun install` (sinon scories orphelines dans bun.lock, invisibles en local, bloquantes en CI).

Doc complète : `.agents/doc/this-app/deployment.md`. Infra prod (VPS/PocketBase/notify) : skill `vps-contabo`.
