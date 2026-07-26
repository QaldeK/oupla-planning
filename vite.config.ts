import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { injectRootCss } from "./src/lib/vite/inject-css-plugin";

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), injectRootCss()]
});
