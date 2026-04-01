import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			// 200.html comme fallback SPA : évite le conflit avec les pages prérenderées
			// (qui génèrent leur propre index.html).
			fallback: '200.html',
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
