/**
 * Contrôle du graphe d'imports — garde-fou de la règle de couche.
 *
 * Les flèches descendent (`pb-sync → data → stores → services → components`). C'est la
 * boucle qu'elles referment qui coûte : deux modules d'une même composante fortement
 * connexe ne se lisent, ne se testent ni ne se remplacent séparément, et leur ordre
 * d'initialisation devient un contrat implicite. Ce test recalcule le graphe d'imports de
 * `src/`, en extrait les composantes, et échoue dès qu'une arête INTERNE à une composante
 * > 1 n'est pas déclarée dans ACCEPTED_EDGES : la dette gelée est donc écrite noir sur
 * blanc, et son référentiel est la liste elle-même.
 *
 * La granularité est l'arête, pas la composante : un appel ajouté à l'intérieur d'une
 * boucle existante doit rester un acte conscient. Les arêtes `import type` comptent comme
 * les autres — elles gèlent autant, et le scan ne les distingue pas.
 *
 * Le scan est lexical (`ts.preProcessFile` sur les scripts, `svelte/compiler` pour extraire
 * ceux des composants) : un spécificateur hors du graphe interne (paquet, asset, CSS, code
 * généré) est ignoré, comme une arête sortant de `src/`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "svelte/compiler";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SRC = join(ROOT, "src");
const STORES_DIR = join(SRC, "lib", "stores");

/** Couches basses, importables par tous : elles n'atteignent jamais `stores/`. */
const STORE_FREE_DIRS = [join(SRC, "lib", "data"), join(SRC, "lib", "pb-sync")];

/**
 * Dette gelée : les arêtes internes à une boucle, assumées nommément. Seule boucle
 * acceptée aujourd'hui, le trio d'authentification — la transition guest → auth lit l'état
 * des deux stores, et les deux stores la déclenchent (ADR-0009). Déclarer une arête de plus
 * ici est une décision, pas une formalité.
 */
const ACCEPTED_EDGES = [
	"src/lib/stores/userStore.svelte.ts -> src/lib/stores/planningStore.svelte.ts",
	"src/lib/stores/planningStore.svelte.ts -> src/lib/stores/userStore.svelte.ts",
	"src/lib/stores/userStore.svelte.ts -> src/lib/stores/authTransition.svelte.ts",
	"src/lib/stores/authTransition.svelte.ts -> src/lib/stores/userStore.svelte.ts",
	"src/lib/stores/authTransition.svelte.ts -> src/lib/stores/planningStore.svelte.ts"
];

const rel = (file: string) => relative(ROOT, file);

function sourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) files.push(...sourceFiles(path));
		else if (/\.(ts|svelte)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) files.push(path);
	}
	return files;
}

/** Scripts d'un fichier : le fichier entier, ou les blocs `<script>` d'un composant. */
function scriptSources(file: string): string[] {
	const source = readFileSync(file, "utf8");
	if (!file.endsWith(".svelte")) return [source];

	const { instance, module } = parse(source, { modern: true });
	return [instance, module]
		.filter((script) => script != null)
		.map((script) => source.slice(script.content.start, script.content.end));
}

/** Spécificateurs importés — statiques, dynamiques, side-effect, `export … from`. */
function specifiersOf(file: string): string[] {
	return scriptSources(file).flatMap((script) =>
		ts.preProcessFile(script, true, true).importedFiles.map((imported) => imported.fileName)
	);
}

/** Résout un spécificateur interne en chemin de fichier ; `null` hors du graphe. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
	let base: string;
	if (specifier.startsWith("$lib/")) base = join(SRC, "lib", specifier.slice("$lib/".length));
	else if (specifier.startsWith(".")) base = resolve(dirname(fromFile), specifier);
	else return null; // paquet, asset, code généré : hors du graphe interne

	// Extension explicite (`.svelte`, `.js` — que Vite/TS résolvent vers `.ts`) ou chemin nu :
	// on essaie toutes les formes, l'ordre ne tranche que des ambiguïtés qui n'existent pas ici.
	const candidates = [
		base,
		`${base}.ts`,
		`${base}.svelte`,
		`${base}.svelte.ts`,
		base.replace(/\.js$/, ".ts"),
		base.replace(/\.js$/, ".svelte.ts"),
		join(base, "index.ts"),
		join(base, "index.svelte")
	];
	const found = candidates.find(
		(candidate) => existsSync(candidate) && statSync(candidate).isFile()
	);
	return found ?? null;
}

function buildGraph(files: string[]): Map<string, string[]> {
	const graph = new Map<string, string[]>(files.map((file) => [file, []]));
	for (const file of files) {
		const targets = graph.get(file) ?? [];
		for (const specifier of specifiersOf(file)) {
			const target = resolveSpecifier(file, specifier);
			if (target && graph.has(target) && !targets.includes(target)) targets.push(target);
		}
	}
	return graph;
}

/** Composantes fortement connexes (Tarjan). */
function strongComponents(graph: Map<string, string[]>): string[][] {
	let counter = 0;
	const index = new Map<string, number>();
	const low = new Map<string, number>();
	const stack: string[] = [];
	const onStack = new Set<string>();
	const components: string[][] = [];

	const visit = (node: string): void => {
		index.set(node, counter);
		low.set(node, counter);
		counter += 1;
		stack.push(node);
		onStack.add(node);

		for (const next of graph.get(node) ?? []) {
			if (!index.has(next)) {
				visit(next);
				low.set(node, Math.min(low.get(node)!, low.get(next)!));
			} else if (onStack.has(next)) {
				low.set(node, Math.min(low.get(node)!, index.get(next)!));
			}
		}

		if (low.get(node) !== index.get(node)) return;

		const component: string[] = [];
		let popped = stack.pop()!;
		component.push(popped);
		onStack.delete(popped);
		while (popped !== node) {
			popped = stack.pop()!;
			component.push(popped);
			onStack.delete(popped);
		}
		components.push(component);
	};

	for (const node of graph.keys()) if (!index.has(node)) visit(node);
	return components;
}

const FILES = sourceFiles(SRC);
const GRAPH = buildGraph(FILES);
const COMPONENTS = strongComponents(GRAPH).filter((component) => component.length > 1);

type Edge = { from: string; to: string };

/** Arêtes dont les deux extrémités vivent dans la même composante > 1 : celles qui bouclent. */
function internalEdges(): Edge[] {
	const edges: Edge[] = [];
	for (const component of COMPONENTS) {
		const members = new Set(component);
		for (const from of component) {
			for (const to of GRAPH.get(from) ?? []) {
				if (members.has(to)) edges.push({ from: rel(from), to: rel(to) });
			}
		}
	}
	return edges;
}

describe("graphe d'imports de src/", () => {
	it("déclare nommément chaque arête interne à une boucle", () => {
		const undeclared = internalEdges().filter(
			(edge) => !ACCEPTED_EDGES.includes(`${edge.from} -> ${edge.to}`)
		);

		const report = [
			`${FILES.length} fichiers scannés, ${COMPONENTS.length} composante(s) fortement connexe(s) > 1 :`,
			...COMPONENTS.map((component) => `  ${component.map(rel).join(", ")}`),
			"",
			"Arêtes internes non déclarées :",
			...undeclared.map((edge) => `  ${edge.from} -> ${edge.to}`),
			"",
			"Une arête `import type` se casse en sortant le type de l'un des deux modules.",
			"Si l'arête est assumée, la déclarer nommément dans ACCEPTED_EDGES :",
			...undeclared.map((edge) => `  "${edge.from} -> ${edge.to}",`)
		].join("\n");

		expect(
			undeclared.map((edge) => `${edge.from} -> ${edge.to}`),
			report
		).toEqual([]);
	});

	it("ne laisse ni data/ ni pb-sync/ dépendre d'un store", () => {
		const offenders = FILES.filter((file) =>
			STORE_FREE_DIRS.some((dir) => file.startsWith(`${dir}/`))
		).flatMap((file) =>
			specifiersOf(file)
				.filter((specifier) => {
					const target = resolveSpecifier(file, specifier);
					return target ? target.startsWith(`${STORES_DIR}/`) : specifier.includes("/stores/");
				})
				.map((specifier) => `${rel(file)} -> ${specifier}`)
		);

		expect(
			offenders,
			"`data/` et `pb-sync/` sont importés par toute la couche haute : un store en dépendance les rendrait indissociables de lui."
		).toEqual([]);
	});
});
