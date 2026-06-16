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
		testTimeout: 10_000,
		globals: true
	}
});
