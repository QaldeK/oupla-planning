import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import path from 'path';

export default defineConfig({
	plugins: [sveltekit()],
	resolve: {
		alias: {
			$lib: path.resolve('./src/lib')
		}
	},
	test: {
		name: 'unit',
		include: ['tests/unit/**/*.test.ts'],
		// Polyfill IndexedDB pour tous les tests unitaires : l'import (en cascade)
		// de modules qui instancient `db = new AppDB()` au module load déclenche la
		// création de Tables Dexie nécessitant `indexedDB` + `IDBKeyRange`. Sans
		// ce setup, ces imports échouent avec `MissingAPIError`.
		// fake-indexeddb est en mémoire — chaque test commence avec une DB vide.
		setupFiles: ['tests/unit/setup.ts'],
		testTimeout: 10_000,
		globals: true
	}
});
