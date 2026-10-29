/**
 * Tests unitaires — swUpdateStore : throttle des checks de MAJ du Service Worker.
 *
 * Invariant : `reg.update()` est throttlé à 1/min (spec browser) et jamais
 * court-circuité par un `reg.waiting` présent — un second déploiement doit
 * remplacer l'attente courante (le dernier découvert gagne), sinon le clic
 * activerait une version intermédiaire.
 *
 * Singleton à état : `init()` une seule fois ; chaque test démarre à une heure
 * distante pour neutraliser le throttle hérité. Le boot porte un `waiting` :
 * l'auto-activation y répond par un `SKIP_WAITING` mocké, sans effet sur les
 * checks comptés ici. Consentement de reload : voir
 * `swUpdateStore-boot-activation.test.ts` (boot sans `waiting`).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { swUpdateStore } from "$lib/stores/swUpdateStore.svelte";
import { flushMicrotasks, makeEventTarget, makeRegistration, type SwRegistrationStub } from "./helpers/sw-stubs";

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

let reg: SwRegistrationStub;
let ready: Promise<void> | null = null;

function ensureInit() {
	if (!ready) {
		ready = (async () => {
			reg = makeRegistration(true);
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
