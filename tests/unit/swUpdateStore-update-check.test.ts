/**
 * Tests unitaires — swUpdateStore : throttle des checks de MAJ du Service Worker.
 *
 * Invariant : `reg.update()` est throttlé à 1/min (spec browser), mais ne doit
 * JAMAIS être court-circuité par la présence d'un `reg.waiting` — un second
 * déploiement pendant qu'une MAJ attend doit remplacer le `waiting` courant
 * (le dernier découvert gagne), sinon le clic « Mettre à jour » activerait une
 * version intermédiaire et imposerait un second cycle toast → reload.
 *
 * Environnement : node pur. Les APIs browser (window, document, navigator) sont
 * stubbées ; le throttle est exercé via les listeners posés par `init()`, en
 * pilotant l'horloge avec les fake timers de vitest. Le store étant un
 * singleton, `init()` n'est appelé qu'une fois et chaque test démarre à une
 * heure distincte (> 60 s du check précédent) pour neutraliser l'état partagé.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { swUpdateStore } from "$lib/stores/swUpdateStore.svelte";

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
			// `event.type` pour simuler la propagation avant d'appeler le handler —
			// l'event factice doit donc porter ces propriétés.
			const e = { ...event, type, target: this };
			for (const cb of [...(listeners.get(type) ?? [])]) cb(e);
		},
	};
}

function makeRegistration() {
	return {
		// `waiting` présent : le scénario de régression est exactement
		// « un waiting existe, un check doit quand même partir ».
		waiting: { postMessage: vi.fn() },
		update: vi.fn(() => Promise.resolve()),
		...makeEventTarget(),
	};
}

const fakeWindow = {
	...makeEventTarget(),
	navigator: { standalone: false },
	matchMedia: vi.fn(() => ({ matches: false, ...makeEventTarget() })),
	location: { reload: vi.fn() },
};

const fakeDocument = {
	...makeEventTarget(),
	visibilityState: "visible",
};

const serviceWorker = {
	// Page déjà contrôlée : un statechange `installed` serait une MAJ (pas un
	// premier install). Aucun statechange n'est dispatché ici, mais la valeur
	// doit exister pour refléter le cas réel.
	controller: {},
	...makeEventTarget(),
	getRegistration: vi.fn(),
};

let reg: ReturnType<typeof makeRegistration>;
let ready: Promise<void> | null = null;

async function flushMicrotasks() {
	for (let i = 0; i < 5; i++) await Promise.resolve();
}

function ensureInit() {
	if (!ready) {
		ready = (async () => {
			reg = makeRegistration();
			serviceWorker.getRegistration.mockResolvedValue(reg);
			await swUpdateStore.init();
			await flushMicrotasks();
		})();
	}
	return ready;
}

const BASE = 1_000_000_000_000;
let slot = 0;

beforeAll(async () => {
	vi.stubGlobal("window", fakeWindow);
	vi.stubGlobal("document", fakeDocument);
	vi.stubGlobal("navigator", { serviceWorker });
	await ensureInit();
});

beforeEach(() => {
	vi.useFakeTimers();
	// Chaque test démarre à une heure distante : le curseur #lastUpdateCheckAt
	// du singleton est partagé intra-fichier, on neutralise ainsi le throttle
	// hérité du test précédent.
	vi.setSystemTime(BASE + slot * 3_600_000);
	slot++;
});

afterEach(() => {
	vi.useRealTimers();
});

describe("swUpdateStore — throttle des checks de MAJ SW", () => {
	it("check même quand un SW est déjà en waiting (découverte d'un second déploiement)", async () => {
		await ensureInit();
		const before = reg.update.mock.calls.length;

		fakeDocument.dispatch("visibilitychange");

		expect(reg.update.mock.calls.length).toBe(before + 1);
	});

	it("throttle : un second check dans la même minute est ignoré", async () => {
		await ensureInit();
		const before = reg.update.mock.calls.length;

		fakeDocument.dispatch("visibilitychange");
		fakeDocument.dispatch("visibilitychange");

		expect(reg.update.mock.calls.length).toBe(before + 1);
	});

	it("le check repasse après expiration du throttle (60 s)", async () => {
		await ensureInit();
		const before = reg.update.mock.calls.length;

		fakeDocument.dispatch("visibilitychange");
		expect(reg.update.mock.calls.length).toBe(before + 1);

		vi.setSystemTime(Date.now() + 61_000);
		fakeDocument.dispatch("visibilitychange");
		expect(reg.update.mock.calls.length).toBe(before + 2);
	});

	it("échec transient de reg.update() avalé (debug, pas d'unhandled rejection)", async () => {
		await ensureInit();
		const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
		reg.update.mockRejectedValueOnce(new Error("offline"));
		const before = reg.update.mock.calls.length;

		expect(() => fakeDocument.dispatch("visibilitychange")).not.toThrow();
		await flushMicrotasks();

		expect(reg.update.mock.calls.length).toBe(before + 1);
		expect(debugSpy).toHaveBeenCalledWith("SW update check failed:", expect.any(Error));
		debugSpy.mockRestore();
	});

	it("pageshow hors BFCache et onglet caché ne déclenchent pas de check", async () => {
		await ensureInit();
		const before = reg.update.mock.calls.length;

		fakeWindow.dispatch("pageshow", { persisted: false });
		fakeDocument.visibilityState = "hidden";
		fakeDocument.dispatch("visibilitychange");
		expect(reg.update.mock.calls.length).toBe(before);

		// Retour visible : le check repart (le filtre ne bloque que l'état caché).
		fakeDocument.visibilityState = "visible";
		fakeDocument.dispatch("visibilitychange");
		expect(reg.update.mock.calls.length).toBe(before + 1);
	});
});
