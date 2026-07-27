import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { injectRootCss } from "./src/lib/vite/inject-css-plugin";

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		// Strategy sans `url` : la locale est personnelle (cookie + langue
		// navigateur), jamais portée par l'URL — les liens `/p/[token]`
		// partagés entre langues restent inchangés (ADR 0010).
		paraglideVitePlugin({
			project: "./project.inlang",
			outdir: "./src/lib/paraglide",
			strategy: ["cookie", "preferredLanguage", "baseLocale"]
		}),
		injectRootCss()
	]
});
