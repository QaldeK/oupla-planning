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
 */
import 'fake-indexeddb/auto';
import { IDBKeyRange } from 'fake-indexeddb';

globalThis.IDBKeyRange = IDBKeyRange;
