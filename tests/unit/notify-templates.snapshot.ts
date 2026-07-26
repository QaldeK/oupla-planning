// Générateur de snapshot HTML réutilisable pour notify-templates.js.
//
// Produit .scratch/notify-templates-baseline.html : un fichier autonome
// ouvrable dans un navigateur, présentant les 9 maquettes du brainstorm § 13.8
// avec aperçu rendu (iframe srcdoc), source HTML, corps texte et events.
//
// Usage :
//   bun run tests/unit/notify-templates.snapshot.ts
//
// But : servir de baseline visuelle avant retravail du templating. Re-joüer
// après modifications pour générer un second fichier et faire un diff visuel.

import { mkdirSync, writeFileSync } from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { buildCtx, CASES, mkRecord } from "./notify-templates.cases";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// ============================================================================
// Chargement du module sous test
// ============================================================================
// Bun gère nativement l'interop CJS/ESM. On expose `__hooks` (global PocketBase)
// avant le require. On passe par `createRequire` (au lieu d'un `require` global)
// pour satisfaire la règle ESLint `@typescript-eslint/no-require-imports`.

const HOOKS_DIR = path.resolve(__dirname, "../../", "pocketbase/pb_hooks");
(globalThis as any).__hooks = HOOKS_DIR;

const templates = require(path.join(HOOKS_DIR, "notify-templates.js")) as {
	buildSubject: (m: any, e: any[], ctx: any) => string;
	buildHtmlEmail: (m: any, e: any[], u: any, ctx: any) => string;
	buildTextEmail: (m: any, e: any[], u: any, ctx: any) => string;
};

// ============================================================================
// Échappements HTML
// ============================================================================

/** Échappe pour insertion dans un <pre> (contenu textuel). */
function escapeHtml(text: string): string {
	return String(text)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/** Échappe pour attribut srcdoc (double-quoted). */
function escapeSrcdoc(text: string): string {
	return String(text).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// ============================================================================
// Rendu d'un cas
// ============================================================================

function renderCase(idx: number, c: (typeof CASES)[number]): string {
	const master = mkRecord(c.master as Record<string, unknown>);
	const ctx = buildCtx(master, c.occs);
	const subject = templates.buildSubject(master, c.events, ctx);
	const textBody = templates.buildTextEmail(master, c.events, c.user, ctx);
	const htmlBody = templates.buildHtmlEmail(master, c.events, c.user, ctx);
	const num = idx + 1;

	return `
<section id="cas-${num}" class="case">
  <header class="case-header">
    <div class="case-num">Cas ${num}</div>
    <h2 class="case-name">${escapeHtml(c.name)}</h2>
  </header>

  <div class="subject-block">
    <span class="subject-label">Sujet</span>
    <code class="subject-value">${escapeHtml(subject)}</code>
  </div>

  <details class="block">
    <summary>Events en entrée (${c.events.length})</summary>
    <pre>${escapeHtml(JSON.stringify(c.events, null, 2))}</pre>
  </details>

  <h3 class="block-title">Aperçu HTML rendu</h3>
  <div class="preview-wrapper">
    <iframe srcdoc="${escapeSrcdoc(htmlBody)}" sandbox="" loading="lazy" class="preview-iframe"></iframe>
  </div>
  <p class="preview-hint">Rendu isolé dans une <code>&lt;iframe srcdoc sandbox&gt;</code> — CSS inline de l'email préservé, scripts neutralisés.</p>

  <details class="block">
    <summary>Source HTML</summary>
    <pre>${escapeHtml(htmlBody)}</pre>
  </details>

  <details class="block">
    <summary>Corps texte (fallback)</summary>
    <pre>${escapeHtml(textBody)}</pre>
  </details>
</section>`;
}

// ============================================================================
// Page HTML
// ============================================================================

function renderToc(): string {
	return CASES.map((c, i) => {
		const num = i + 1;
		const short = c.name.split("—")[0].trim();
		return `<li><a href="#cas-${num}"><span class="toc-num">${num}</span>${escapeHtml(short)}</a></li>`;
	}).join("\n");
}

function renderPage(): string {
	const sections = CASES.map((c, i) => renderCase(i, c)).join("\n");
	const generatedAt = new Date().toISOString();

	return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Baseline — notify-templates</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f1f5f9;
      --card: #ffffff;
      --border: #e2e8f0;
      --text: #0f172a;
      --muted: #64748b;
      --accent: #3b82f6;
      --code-bg: #f8fafc;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0b1220;
        --card: #111827;
        --border: #1f2937;
        --text: #e5e7eb;
        --muted: #9ca3af;
        --accent: #60a5fa;
        --code-bg: #0a0f1c;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      font-size: 14px;
    }
    .layout {
      display: grid;
      grid-template-columns: 260px 1fr;
      gap: 24px;
      padding: 24px;
      max-width: 1400px;
      margin: 0 auto;
    }
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; padding: 12px; }
      nav { position: static !important; max-height: none !important; }
    }
    nav {
      position: sticky;
      top: 24px;
      align-self: start;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px;
      max-height: calc(100vh - 48px);
      overflow-y: auto;
    }
    nav .brand { font-size: 15px; font-weight: 600; margin: 0 0 4px; }
    nav .brand-sub { font-size: 12px; color: var(--muted); margin: 0 0 16px; }
    nav ol { list-style: none; padding: 0; margin: 0; }
    nav li { margin: 2px 0; }
    nav a {
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 6px;
      color: var(--text);
      text-decoration: none;
      font-size: 12px;
      line-height: 1.35;
    }
    nav a:hover { background: var(--bg); color: var(--accent); }
    nav .toc-num {
      flex: 0 0 auto;
      font-weight: 600;
      color: var(--muted);
      font-variant-numeric: tabular-nums;
    }
    main { min-width: 0; }
    .header-meta {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px 18px;
      margin-bottom: 20px;
      font-size: 12px;
      color: var(--muted);
    }
    .header-meta code { color: var(--text); }
    .case {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 24px;
      margin-bottom: 20px;
      scroll-margin-top: 16px;
    }
    .case-header { margin-bottom: 16px; }
    .case-num {
      display: inline-block;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--accent);
      margin-bottom: 4px;
    }
    .case-name {
      font-size: 17px;
      font-weight: 600;
      margin: 0;
      line-height: 1.3;
    }
    .subject-block {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: baseline;
      background: var(--code-bg);
      padding: 10px 14px;
      border-radius: 8px;
      border: 1px solid var(--border);
      margin-bottom: 16px;
    }
    .subject-label {
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
    }
    .subject-value {
      font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
      font-size: 13px;
    }
    .block-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--muted);
      margin: 20px 0 8px;
      font-weight: 600;
    }
    details.block { margin: 10px 0; }
    details.block > summary {
      cursor: pointer;
      padding: 8px 12px;
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 12px;
      color: var(--muted);
      list-style: none;
      user-select: none;
    }
    details.block > summary:hover { color: var(--text); }
    details.block > summary::-webkit-details-marker { display: none; }
    details.block > summary::before { content: '▸ '; }
    details.block[open] > summary::before { content: '▾ '; }
    details.block > pre {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-top: 0;
      border-radius: 0 0 6px 6px;
      padding: 12px 14px;
      margin: 0 0 8px;
      overflow-x: auto;
      font-size: 11.5px;
      line-height: 1.5;
      font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--text);
    }
    .preview-wrapper {
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      background: #ffffff;
      color-scheme: only light;
    }
    .preview-iframe {
      width: 100%;
      min-height: 620px;
      border: 0;
      display: block;
    }
    .preview-hint {
      margin: 6px 2px 0;
      font-size: 11px;
      color: var(--muted);
    }
    .preview-hint code {
      font-family: ui-monospace, monospace;
      font-size: 10.5px;
      background: var(--code-bg);
      padding: 1px 4px;
      border-radius: 3px;
    }
  </style>
</head>
<body>
  <div class="layout">
    <nav>
      <p class="brand">📋 Baseline</p>
      <p class="brand-sub">notify-templates.js</p>
      <ol>
        ${renderToc()}
      </ol>
    </nav>
    <main>
      <div class="header-meta">
        Snapshot généré depuis <code>pocketbase/pb_hooks/notify-templates.js</code> le <code>${generatedAt}</code>.
        Aperçus rendus dans des <code>&lt;iframe srcdoc sandbox&gt;</code> — CSS inline de chaque email préservé,
        scripts neutralisés. Reculer le curseur CSS de l'iframe n'affecte pas la page parente.
      </div>
      ${sections}
    </main>
  </div>
</body>
</html>
`;
}

// ============================================================================
// Écriture du fichier
// ============================================================================

const OUT_DIR = path.resolve(__dirname, "../../.scratch");
const OUT_FILE = path.join(OUT_DIR, "notify-templates-baseline.html");

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, renderPage());

console.log(`✅ Snapshot écrit : ${path.relative(process.cwd(), OUT_FILE)}`);
console.log(`   ${CASES.length} cas rendus.`);
