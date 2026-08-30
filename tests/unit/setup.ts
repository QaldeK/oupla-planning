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

// En environnement de test, Paraglide s'exécute côté serveur (isServer=true,
// import.meta.env.SSR=true) : la strategy `preferredLanguage` est alors ignorée,
// et getLocale() tombe sur la baseLocale (en). Forcer `navigator.languages` ici
// ne pinnait donc pas vraiment « fr » — les assertions localisées doivent pinner
// la locale explicitement (overwriteGetLocale(() => "fr") ou mock de getLocale),
// cf. recurrence.test.ts. On garde ce pin pour les éventuels contextes navigateur
// (happy-dom) où preferredLanguage serait consultée.
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

// La détection serveur du runtime paraglide compilé (dossier gitignoré, régénéré
// par dev/build ou CLI) varie selon le mode de génération : en test DOM, le chemin
// client peut s'activer et résoudre "fr" via preferredLanguage, alors que les
// assertions de composants sont écrites contre la baseLocale ("en"). Pin explicite
// et déterministe ; les tests voulant du français le pinne localement (recurrence.test.ts).
import { overwriteGetLocale } from "$lib/paraglide/runtime";

overwriteGetLocale(() => "en");
