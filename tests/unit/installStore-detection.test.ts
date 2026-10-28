/**
 * Tests unitaires — installStore : gate de détection d'installation (terminal)
 * et cycle du prompt natif.
 *
 * Le gate repose sur getInstalledRelatedApps (Chromium ; manifest auto-déclaré
 * via related_applications) : une PWA détectée sur le terminal masque l'invite
 * d'installation — cas du navigateur installateur qui redéclenche malgré tout
 * beforeinstallprompt dans son onglet (vérifié sur Brave Android). API absente
 * (iOS, Firefox) ou en échec : check simplement terminé, détection display-mode
 * seule.
 *
 * Environnement : node pur, APIs browser stubbées. Le store étant un singleton
 * avec une garde d'init, chaque scénario réimporte le module (vi.resetModules)
 * avec une fenêtre fraîche — les listeners ne doivent pas accumuler entre
 * scénarios. storage et pb sont mockés (aucun accès disque ni réseau).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateSpy } = vi.hoisted(() => ({ updateSpy: vi.fn(() => Promise.resolve({})) }));

vi.mock("$lib/utils/storage", () => ({
	storage: {
		getItem: vi.fn(() => Promise.resolve(null)),
		setItem: vi.fn(() => Promise.resolve()),
	},
}));

vi.mock("$lib/pocketbase/pb", () => ({
	pb: {
		authStore: { record: { id: "user1" } },
		collection: () => ({ update: updateSpy }),
	},
}));

function makeEventTarget() {
	const listeners = new Map<string, Set<(event: unknown) => void>>();
	return {
		addEventListener(type: string, cb: (event: unknown) => void) {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type)!.add(cb);
		},
		removeEventListener(type: string, cb: (event: unknown) => void) {
			listeners.get(type)?.delete(cb);
		},
		dispatch(type: string, event: Record<string, unknown> = {}) {
			// Le wrapper d'écoute de svelte (`create_event`) lit `event.target` et
			// `event.type` avant d'appeler le handler — l'event factice doit porter
			// ces propriétés.
			const e = { ...event, type, target: this };
			for (const cb of [...(listeners.get(type) ?? [])]) cb(e);
		},
	};
}

type Mql = { matches: boolean } & ReturnType<typeof makeEventTarget>;

interface Harness {
	store: Awaited<(typeof import("$lib/stores/installStore.svelte"))["installStore"]>;
	mql: Map<string, Mql>;
	window: ReturnType<typeof makeEventTarget>;
}

async function freshStore(
	relatedApps?: () => Promise<Array<{ platform: string }>>,
	opts: { standalone?: boolean; init?: boolean } = {},
) {
	vi.resetModules();

	// Fenêtre fraîche par scénario : chaque init pose ses listeners dessus, un
	// objet partagé les accumulerait et un dispatch toucherait tous les stores.
	const mql = new Map<string, Mql>();
	const window = Object.assign(makeEventTarget(), {
		navigator: { standalone: opts.standalone ?? false },
		matchMedia: vi.fn((query: string) => {
			if (!mql.has(query)) mql.set(query, { matches: false, ...makeEventTarget() });
			return mql.get(query)!;
		}),
		location: { reload: vi.fn() },
	});

	const navigatorObj: Record<string, unknown> = {
		standalone: opts.standalone ?? false,
		maxTouchPoints: 0,
	};
	if (relatedApps) navigatorObj.getInstalledRelatedApps = vi.fn(relatedApps);

	vi.stubGlobal("window", window);
	vi.stubGlobal("navigator", navigatorObj);

	const mod = await import("$lib/stores/installStore.svelte");
	if (opts.init !== false) {
		await mod.installStore.init();
		await flushMicrotasks();
	}
	return { store: mod.installStore, mql, window } satisfies Harness;
}

async function flushMicrotasks() {
	for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
	updateSpy.mockClear();
});

describe("installStore — gate de détection d'installation", () => {
	it("API absente (iOS, Firefox) : check terminé, gate ouvert", async () => {
		const { store } = await freshStore();
		expect(store.installCheckPending).toBe(false);
		expect(store.installedOnDevice).toBe(false);
		expect(store.promptGateClear).toBe(true);
	});

	it("PWA webapp détectée sur le terminal : gate fermé (invite masquée)", async () => {
		const { store } = await freshStore(() => Promise.resolve([{ platform: "webapp", id: "/" }]));
		expect(store.installedOnDevice).toBe(true);
		expect(store.installCheckPending).toBe(false);
		expect(store.promptGateClear).toBe(false);
	});

	it("apps non-webapp ignorées (store natif, etc.)", async () => {
		const { store } = await freshStore(() => Promise.resolve([{ platform: "play" }]));
		expect(store.installedOnDevice).toBe(false);
		expect(store.promptGateClear).toBe(true);
	});

	it("échec de l'API avalé (debug, gate ouvert)", async () => {
		const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
		const { store } = await freshStore(() => Promise.reject(new Error("offline")));
		expect(store.installCheckPending).toBe(false);
		expect(store.promptGateClear).toBe(true);
		expect(debugSpy).toHaveBeenCalledWith("getInstalledRelatedApps failed:", expect.any(Error));
		debugSpy.mockRestore();
	});
});

describe("installStore — cycle du prompt natif", () => {
	it("beforeinstallprompt capture le prompt différé ; install() résout l'issue", async () => {
		const { store, window } = await freshStore();
		expect(store.canInstall).toBe(false);

		const prompt = vi.fn();
		window.dispatch("beforeinstallprompt", {
			preventDefault: vi.fn(),
			prompt,
			userChoice: Promise.resolve({ outcome: "accepted" }),
		});
		expect(store.canInstall).toBe(true);

		const outcome = await store.install();
		expect(outcome).toBe("accepted");
		expect(prompt).toHaveBeenCalledTimes(1);
		expect(store.canInstall).toBe(false);
	});

	it("appinstalled : isInstalled, gate fermé, installation enregistrée", async () => {
		const { store, window } = await freshStore();
		window.dispatch("appinstalled");
		expect(store.isInstalled).toBe(true);
		expect(store.promptGateClear).toBe(false);

		await flushMicrotasks();
		// "users" est consommé par collection() ; update() reçoit l'id et le flag.
		expect(updateSpy).toHaveBeenCalledTimes(1);
		expect(updateSpy).toHaveBeenCalledWith("user1", { pwa_installed: true });
	});

	it("bascule display-mode : isInstalled suit le matchMedia", async () => {
		const { store, mql } = await freshStore();
		mql.get("(display-mode: standalone)")!.dispatch("change", { matches: true });
		expect(store.isInstalled).toBe(true);
	});

	it("isInstalled est posé dès la construction, avant init()", async () => {
		// Le mur d'authentification lit isInstalled ; init() n'arrive qu'après
		// des await au boot. Calculé là, il laisserait l'app installée
		// s'afficher un instant avant le mur.
		const { store } = await freshStore(undefined, { standalone: true, init: false });
		expect(store.isInstalled).toBe(true);
	});

	it("refus (dismissed) : le prompt est consommé, pas de second appel possible", async () => {
		const { store, window } = await freshStore();
		const prompt = vi.fn();
		window.dispatch("beforeinstallprompt", {
			preventDefault: vi.fn(),
			prompt,
			userChoice: Promise.resolve({ outcome: "dismissed" }),
		});

		const outcome = await store.install();
		expect(outcome).toBe("dismissed");
		// L'événement natif est à usage unique : le garder laisserait un bouton
		// mort qui rappellerait prompt() sur un événement consommé.
		expect(store.canInstall).toBe(false);
		expect(await store.install()).toBeNull();
		expect(prompt).toHaveBeenCalledTimes(1);
	});

	it("acceptation : isInstalled passe à vrai sans attendre appinstalled", async () => {
		const { store, window } = await freshStore();
		window.dispatch("beforeinstallprompt", {
			preventDefault: vi.fn(),
			prompt: vi.fn(),
			userChoice: Promise.resolve({ outcome: "accepted" }),
		});

		await store.install();
		expect(store.isInstalled).toBe(true);
	});

	it("prompt() qui jette : issue null, pas de rejet non géré", async () => {
		const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
		const { store, window } = await freshStore();
		window.dispatch("beforeinstallprompt", {
			preventDefault: vi.fn(),
			prompt: vi.fn(() => {
				throw new Error("InvalidStateError");
			}),
			userChoice: Promise.resolve({ outcome: "accepted" }),
		});

		await expect(store.install()).resolves.toBeNull();
		expect(store.canInstall).toBe(false);
		debugSpy.mockRestore();
	});
});
