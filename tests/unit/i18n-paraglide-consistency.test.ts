/**
 * Filet anti-régression i18n (Paraglide) — cohérence des clés.
 *
 * Trois classes de bugs i18n ont déjà été introduites puis corrigées à la main
 * dans ce projet, parce qu'aucun test ne les attrapait :
 *  1. Clé appelée dans le code mais absente des messages JSON
 *     → warning build `IMPORT_IS_UNDEFINED` + runtime
 *     `undefined is not a function`. `bun run check` (tsgo) ne voit rien.
 *  2. Asymétrie fr/en → une clé dans un JSON mais pas l'autre → fallback
 *     silencieux (texte FR affiché en contexte EN).
 *
 * Ce test statique attrape les cas 1 et 2 de façon déterministe (Niveau 1).
 *
 * POURQUOI PAS LA DÉTECTION DE TEXTE EN DUR (Niveau 2) ?
 * La détection heuristique de texte français non traduit dans les composants
 * produit massivement des faux positifs (mots courts dans des commentaires,
 * classes CSS, fragments de code). Un test CI rouge sur des faux positifs est
 * pire que pas de test — il serait ignoré puis désactivé. Le texte en dur
 * relève d'une smoke pass séparée, pas de ce filet.
 *
 * POURQUOI LES CLÉS MORTES NE FONT PAS ÉCHOUER LE TEST :
 * Une clé définie mais jamais appelée n'est PAS une régression : le projet peut
 * légitimement préparer des clés pour une feature à venir. On les signale en
 * `console.warn` (utile pour le nettoyage), mais le verdict reste vert.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Robuste quel que soit le cwd : on remonte depuis ce fichier de test vers la
// racine du repo (tests/unit/<ce fichier> → ../../ = racine).
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const MESSAGES_DIR = path.join(PROJECT_ROOT, "messages");
const SRC_DIR = path.join(PROJECT_ROOT, "src");
// Code généré par Paraglide : CONTIENT toutes les clés comme exports nommés.
// Le scanner ne doit SURTOUT PAS le parcourir, sinon chaque clé apparaîtrait
// comme « appelée » alors que c'est sa définition générée.
const PARAGLIDE_GEN_DIR = path.join(SRC_DIR, "lib", "paraglide");
const SCAN_EXTENSIONS = new Set([".svelte", ".ts", ".js"]);

type Location = string; // ex: "src/lib/components/X.svelte:42"

/** Clés définies dans `messages/<locale>.json` (top-level, plates). */
function loadMessageKeys(locale: "fr" | "en"): Set<string> {
	const file = path.join(MESSAGES_DIR, `${locale}.json`);
	const data = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
	return new Set(Object.keys(data));
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Détecte dynamiquement le ou les alias locaux sous lesquels le namespace
 * Paraglide est importé dans un fichier source. On ne hardcode PAS "m"/"msg" :
 * chaque fichier peut utiliser n'importe quel alias, et `+layout.svelte`
 * utilise `import { m }` (named import) plutôt que `import * as m`.
 *
 * Gère : `import * as X from "...paraglide/messages..."` et
 * `import { m } from "..."` / `import { m as X } from "..."` (le namespace
 * ré-exporté par `messages.js` porte toujours le nom `m`).
 * Les imports nommés de clés individuelles (`import { common_add }`) sont
 * ignorés : l'invariant couvre l'accès namespace `ALIAS.KEY(`.
 */
function detectParaglideAliases(source: string): Set<string> {
	const aliases = new Set<string>();
	const pathPattern = String.raw`paraglide\/messages(?:\.js)?`;

	// import * as X from "...paraglide/messages(.js)?"
	const namespaceRe = new RegExp(
		String.raw`import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["'][^"']*${pathPattern}["']`,
		"g"
	);
	for (const match of source.matchAll(namespaceRe)) aliases.add(match[1]);

	// import { ... } from "...paraglide/messages(.js)?"
	const namedRe = new RegExp(
		String.raw`import\s+\{([^}]*)\}\s+from\s+["'][^"']*${pathPattern}["']`,
		"g"
	);
	for (const match of source.matchAll(namedRe)) {
		for (const spec of match[1].split(",")) {
			const trimmed = spec.trim();
			if (!trimmed) continue;
			const parts = trimmed.split(/\s+as\s+/);
			const importedName = parts[0].trim();
			const localName = (parts[1] ?? parts[0]).trim();
			// Le namespace ré-exporté s'appelle `m` : son binding local est l'alias.
			if (importedName === "m") aliases.add(localName);
		}
	}

	return aliases;
}

/**
 * Extrait les appels `ALIAS.KEY(` dans le source. Le lookbehind `(?<![\w.$])`
 * évite les faux positifs : il bloque `form.key(` (le `m` est précédé d'un
 * mot) et `obj.m.key(` (le `m` est précédé d'un `.` — chaîne de propriétés).
 */
function extractCalls(source: string, alias: string): Array<{ key: string; line: number }> {
	const callRe = new RegExp(
		String.raw`(?<![\w.$])${escapeRegex(alias)}\.([A-Za-z_$][\w$]*)\s*\(`,
		"g"
	);
	const calls: Array<{ key: string; line: number }> = [];
	for (const match of source.matchAll(callRe)) {
		const key = match[1];
		const line = source.slice(0, match.index ?? 0).split("\n").length;
		calls.push({ key, line });
	}
	return calls;
}

/** Parcourt `src/` récursivement, en excluant le code généré Paraglide. */
function walkSourceFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			// Coupe à la racine tout le sous-arbre généré par Paraglide.
			if (full === PARAGLIDE_GEN_DIR) continue;
			walkSourceFiles(full, acc);
		} else if (entry.isFile() && SCAN_EXTENSIONS.has(path.extname(entry.name))) {
			acc.push(full);
		}
	}
	return acc;
}

/** Agrège toutes les clés appelées via un alias Paraglide → localisations. */
function collectCalledKeys(): Map<string, Location[]> {
	const called = new Map<string, Location[]>();
	for (const file of walkSourceFiles(SRC_DIR)) {
		const source = fs.readFileSync(file, "utf8");
		const aliases = detectParaglideAliases(source);
		if (aliases.size === 0) continue;
		const rel = path.relative(PROJECT_ROOT, file);
		for (const alias of aliases) {
			for (const { key, line } of extractCalls(source, alias)) {
				const locs = called.get(key) ?? [];
				locs.push(`${rel}:${line}`);
				called.set(key, locs);
			}
		}
	}
	return called;
}

describe("i18n Paraglide — cohérence des clés", () => {
	const frKeys = loadMessageKeys("fr");
	const enKeys = loadMessageKeys("en");
	const calledKeys = collectCalledKeys();

	it("fr.json et en.json ont exactement le même ensemble de clés (symétrie)", () => {
		const onlyInFr = [...frKeys].filter((k) => !enKeys.has(k)).sort();
		const onlyInEn = [...enKeys].filter((k) => !frKeys.has(k)).sort();
		expect(
			{ onlyInFr, onlyInEn },
			onlyInFr.length || onlyInEn.length
				? `Asymétrie fr/en —\n  uniquement en FR (${onlyInFr.length}): ${onlyInFr.join(", ")}\n  uniquement en EN (${onlyInEn.length}): ${onlyInEn.join(", ")}`
				: ""
		).toEqual({ onlyInFr: [], onlyInEn: [] });
	});

	it("toute clé appelée dans le code existe dans fr.json", () => {
		const missing = [...calledKeys.keys()]
			.filter((k) => !frKeys.has(k))
			.sort()
			.map((k) => `  - "${k}" → ${(calledKeys.get(k) ?? []).slice(0, 3).join(", ")}`);
		expect(
			missing,
			missing.length ? `Clés appelées mais absentes de fr.json:\n${missing.join("\n")}` : ""
		).toEqual([]);
	});

	it("toute clé appelée dans le code existe dans en.json", () => {
		const missing = [...calledKeys.keys()]
			.filter((k) => !enKeys.has(k))
			.sort()
			.map((k) => `  - "${k}" → ${(calledKeys.get(k) ?? []).slice(0, 3).join(", ")}`);
		expect(
			missing,
			missing.length ? `Clés appelées mais absentes de en.json:\n${missing.join("\n")}` : ""
		).toEqual([]);
	});

	it("n'échoue pas sur les clés mortes (signalées en warning)", () => {
		// Les clés mortes ne sont PAS une régression : une clé peut exister en
		// avance de phase pour une feature à venir. On les signale pour le
		// nettoyage, sans faire rougir le test.
		const dead = [...frKeys].filter((k) => !calledKeys.has(k)).sort();
		if (dead.length > 0) {
			// eslint-disable-next-line no-console
			console.warn(
				`[i18n] ${dead.length} clé(s) définie(s) mais jamais appelée(s) (informationnel, hors verdict):\n` +
					dead.map((k) => `  - ${k}`).join("\n")
			);
		}
		expect(true).toBe(true);
	});
});
