import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			// index.html comme fallback SPA pour Cloudflare Pages
			// CF Pages gère nativement le fallback sans _redirects
			fallback: "index.html",
			pages: "build",
			assets: "build",
			precompress: false,
			strict: true
		})
	},
	vitePlugin: {
		inspector: {
			toggleKeyCombo: "alt-x",
			showToggleButton: "always",
			toggleButtonPos: "bottom-right"
		}
	},
	preprocess: vitePreprocess({ script: true })
};

export default config;
