# Offline-first via pb-sync/Dexie (pas le cache Service Worker)

Les données métier (plannings, occurrences, commentaires) sont stockées et lues depuis Dexie (IndexedDB), synchronisées avec PocketBase via pb-sync en temps réel (SSE). Le Service Worker ne gère que le cache des assets statiques (HTML, JS, CSS, icônes) — il ne met jamais en cache les appels API.

L'approche standard (tout mettre dans le cache SW) aurait été plus simple à implémenter mais beaucoup moins flexible : pas de merge strategies, pas de queries offline riches, pas de résolution de conflits. Dexie + pb-sync permet des lectures instantanées hors ligne avec une vraie base de données locale, des writes optimistes, et une réconciliation automatique via des stratégies de merge configurables (ex: `mergeByKey('id')` pour les participants).

Les stores Svelte lisent Dexie via `useLiveQuery()`, jamais PocketBase directement. La couche service (`src/lib/services/`) est le seul point de contact avec l'API PocketBase.
