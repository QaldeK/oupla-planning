import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Plugin } from 'vite';

export function injectRootCss(): Plugin {
	return {
		name: 'inject-root-css',
		enforce: 'post',
		writeBundle() {
			const root = process.cwd();

			const manifestPath = join(root, '.svelte-kit/output/client/.vite/manifest.json');
			const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

			const layoutKey = '.svelte-kit/generated/client-optimized/nodes/0.js';
			const rootCss = manifest[layoutKey]?.css?.[0];

			if (!rootCss) {
				console.warn('[inject-root-css] Aucun CSS racine trouvé dans le manifest');
				return;
			}

			const htmlPath = join(root, 'build/index.html');
			let html = readFileSync(htmlPath, 'utf-8');

			if (!html.includes(`href="/${rootCss}"`)) {
				html = html.replace('</head>', `<link rel="stylesheet" href="/${rootCss}"></head>`);
				writeFileSync(htmlPath, html, 'utf-8');
				console.log(`[inject-root-css] CSS injecté: ${rootCss}`);
			}
		}
	};
}
