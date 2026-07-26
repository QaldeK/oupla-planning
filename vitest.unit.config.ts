import { sveltekit } from "@sveltejs/kit/vite";
import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [sveltekit()],
	resolve: {
		alias: {
			$lib: path.resolve("./src/lib")
		},
		// Forcer la résolution des exports "browser" des dépendances (notamment
		// Svelte 5) pour les tests de composants. Sans ça, Vite résout vers les
		// exports "server" (SSR) qui rendent `mount()` indisponible → erreur
		// `lifecycle_function_unavailable`. Les tests purement Node n'ont pas
		// de dépendances qui différencient browser/server, donc sans impact.
		conditions: ["browser"]
	},
	test: {
		name: "unit",
		include: ["tests/unit/**/*.test.ts"],
		// Polyfill IndexedDB pour tous les tests unitaires : l'import (en cascade)
		// de modules qui instancient `db = new AppDB()` au module load déclenche la
		// création de Tables Dexie nécessitant `indexedDB` + `IDBKeyRange`. Sans
		// ce setup, ces imports échouent avec `MissingAPIError`.
		// fake-indexeddb est en mémoire — chaque test commence avec une DB vide.
		setupFiles: ["tests/unit/setup.ts"],
		testTimeout: 10_000,
		globals: true
	}
});
