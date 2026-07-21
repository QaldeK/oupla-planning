/**
 * Setup des tests unitaires — exécuté AVANT chaque fichier de test.
 *
 * Polyfill IndexedDB via fake-indexeddb. Nécessaire parce que l'import (en
 * cascade) de modules comme `$lib/services/planningActions` ou
 * `$lib/stores/planningStore.svelte` instancie `db = new AppDB()` au module
 * load, et déclenche la création de Tables Dexie qui nécessitent les APIs
 * IndexedDB (`indexedDB`, `IDBKeyRange`). Sans ce polyfill, ces imports
 * échouent avec `MissingAPIError: IndexedDB API missing`.
 *
 * fake-indexeddb est en mémoire — chaque test commence avec une DB vide.
 *
 * Jest-dom matchers (`toBeInTheDocument`, `toHaveTextContent`, etc.) sont
 * enregistrés globalement — ils ne nécessitent pas de DOM au moment de
 * l'import, seulement quand ils sont invoqués sur un element. Les tests de
 * composants (qui tournent en `@vitest-environment happy-dom`) les utilisent
 * via `expect(el).toBeInTheDocument()` ; les tests purement Node restent
 * opérationnels sans impact.
 */
import 'fake-indexeddb/auto';
import { IDBKeyRange } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';

globalThis.IDBKeyRange = IDBKeyRange;
