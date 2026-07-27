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
import "fake-indexeddb/auto";
import { IDBKeyRange } from "fake-indexeddb";
import "@testing-library/jest-dom/vitest";

globalThis.IDBKeyRange = IDBKeyRange;

// Paraglide résout la locale via sa stratégie `preferredLanguage` en lisant
// `navigator.languages`. happy-dom expose une valeur non contrôlée par défaut
// (typiquement ["en-US"]), ce qui ferait basculer le rendu en EN et casser
// toute assertion écrite contre le français. On force FR pour que chaque test
// hérite du comportement de la base locale, indépendamment de l'environnement.
Object.defineProperty(globalThis.navigator, "language", {
	value: "fr",
	configurable: true,
	writable: true
});
Object.defineProperty(globalThis.navigator, "languages", {
	value: ["fr"],
	configurable: true,
	writable: true
});
