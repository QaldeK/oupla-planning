/**
 * Setup des tests d'intégration — exécuté AVANT chaque fichier de test.
 *
 * Rôle :
 *   - Polyfill IndexedDB via fake-indexeddb (Dexie en dépend)
 *   - Polyfill crypto (utilisé par generateAdminToken, generateParticipantToken)
 *   - Polyfill window.matchMedia (utilisé par mediaQuery.svelte.ts)
 *   - Mock $app/navigation (goto) — indisponible hors SvelteKit runtime
 *
 * Ce fichier est importé automatiquement par Vitest grâce à la config
 * `setupFiles: ['tests/integration/setup.ts']`.
 *
 * IMPORTANT : fake-indexeddb est en mémoire — chaque test commence avec
 * une base vide. Le cleanup entre les tests est géré dans les beforeEach
 * de chaque fichier .test.ts.
 */
import "fake-indexeddb/auto";
import { EventSource } from "eventsource";
import { IDBKeyRange } from "fake-indexeddb";
import { vi } from "vitest";

// Polyfill IDBKeyRange for fake-indexeddb
globalThis.IDBKeyRange = IDBKeyRange;

// Polyfill EventSource for PocketBase realtime (SSE)
globalThis.EventSource = EventSource as unknown as typeof globalThis.EventSource;

// Mock window.matchMedia for mediaQuery store
Object.defineProperty(globalThis, "matchMedia", {
	writable: true,
	value: (query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: () => {},
		removeListener: () => {},
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => false
	})
});

// Mock $app/navigation (SvelteKit)
vi.mock("$app/navigation", () => ({
	goto: vi.fn()
}));

// Mock $app/environment (browser = false en test)
vi.mock("$app/environment", () => ({
	browser: false,
	dev: false,
	building: false
}));

// Paraglide résout la locale via `preferredLanguage` en lisant `navigator.languages`.
// happy-dom expose une valeur non contrôlée par défaut (souvent ["en-US"]), ce qui
// ferait basculer le rendu en EN de façon non déterministe. On force FR pour aligner
// tous les tests sur la base locale française.
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
