# PWA via adapter-static + SPA fallback sur Cloudflare Pages

L'application est construite avec `@sveltejs/adapter-static` en mode SPA (`fallback: 'index.html'`) et déployée sur Cloudflare Pages. Ce choix permet une PWA installable avec un Service Worker qui pré-cache tous les assets statiques, rendant l'application entièrement fonctionnelle hors ligne.

Le mode SPA est contre-intuitif pour SvelteKit (qui favorise le SSR), mais nécessaire ici : adapter-static avec prerender ne peut pas générer toutes les routes dynamiques (`/p/[token]`, `/admin/[token]`). Le fallback SPA délègue le routage au client SvelteKit, qui gère toutes les URLs dynamiques. Cloudflare Pages sert ce fallback nativement sans `_redirects`.

Alternative rejetée : adapter-node avec SSR. Inutile pour cette application — toutes les données viennent de PocketBase via le client SDK, il n'y a pas de backend SvelteKit. Le SSR n'apporterait qu'une latence supplémentaire sans bénéfice.
