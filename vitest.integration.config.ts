// Vitest config pour les tests d'integration.
//
// Role :
//   - Charge les fichiers de test dans tests/integration/**/*.test.ts
//   - Utilise le plugin SvelteKit pour resoudre les alias ($lib, $app, etc.)
//   - Force un seul worker (fork unique) pour eviter les conflits PocketBase
//     concurrents (les hooks PB ne sont pas thread-safe)
//   - Active les globals (describe, it, expect, vi) sans import explicite
//   - Importe setup.ts avant chaque fichier de test (polyfills IndexedDB, mocks)
//
// Usage :
//   bunx vitest run --config vitest.integration.config.ts
//   bunx vitest --config vitest.integration.config.ts  (mode watch)
//
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
		name: 'integration',
		include: ['tests/integration/**/*.test.ts'],
		globalSetup: ['tests/integration/globalSetup.ts'],
		setupFiles: ['tests/integration/setup.ts'],
		testTimeout: 30_000,
		hookTimeout: 15_000,
		pool: 'forks',
		maxWorkers: 1,
		globals: true
	}
});
