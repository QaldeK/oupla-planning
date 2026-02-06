import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			// fallback: 'index.html' est crucial pour les Single Page Applications (SPA)
			// car il redirige toutes les routes vers l'index pour que SvelteKit gère le routage.
			fallback: 'index.html',
			pages: 'build',
			assets: 'build',
			precompress: false,
			strict: true
		})
	},
	vitePlugin: {
		inspector: {
			toggleKeyCombo: 'alt-x',
			showToggleButton: 'always',
			toggleButtonPos: 'bottom-right'
		}
	},
	preprocess: vitePreprocess({ script: true })
};

export default config;
