# ADR 0010 — i18n : Paraglide v2 côté client, texte serveur hors scope

L'UI est localisée FR/EN avec **Paraglide JS v2** (`@inlang/paraglide-sveltekit-vite`),
i18n officiel de SvelteKit — compilé au build, messages type-safe et tree-shakables
(bundle léger, cohérent avec la PWA). L'app étant une SPA pure sans SSR (`adapter-static`
+ fallback, cf. ADR 0004) et les liens d'un Planning étant partagés à des personnes de
langues différentes, la locale est **personnelle et portée par un cookie** (détection via
`navigator.language`, surcharge depuis `/settings`), **sans stratégie d'URL** : les routes
`/p/[token]` et `/admin/[token]` restent inchangées.

La locale choisie est également écrite sur `users.locale` pour les utilisateurs authentifiés
(champ write-only pour l'instant), afin qu'un futur effort de localisation côté serveur
démarre avec une donnée déjà collectée.

Hors scope délibéré : le texte généré côté serveur — notifications push
(`buildPushTitle`/`buildPushBody`) et emails agrégés par le cron PocketBase — reste en
français. Un utilisateur en anglais recevra donc des push/emails en français jusqu'à un
effort séparé, qui nécessitera au préalable que le serveur connaisse la locale de chaque
destinataire (le champ `users.locale` posé ici prépare ce besoin). Les Guests ne recevant
jamais de texte serveur, leur locale reste strictement navigateur (cookie seul).

Alternatives rejetées : `svelte-i18n` / `FormatJS` / `Lingui` (runtime plus lourd, moins
type-safe, moins natif SvelteKit) ; stratégie `url` `/en/…` (casserait les liens partagés
et contredirait le caractère personnel de la locale).
