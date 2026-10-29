/**
 * Tests unitaires — swUpdateStore : auto-activation du SW en attente au
 * chargement frais (silencieuse, sans toast — document neuf, rien à perdre),
 * et consentement de reload au `controllerchange`. Instance fraîche par test
 * (`vi.resetModules()`) : le singleton porte l'état de boot.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushMicrotasks, makeEventTarget, makeRegistration, type SwRegistrationStub } from "./helpers/sw-stubs";

let sw: { controller: unknown } & ReturnType<typeof makeEventTarget> & {
	getRegistration: ReturnType<typeof vi.fn>;
};
let reg: SwRegistrationStub;
let reload: ReturnType<typeof vi.fn>;
let swUpdateStore: (typeof import("$lib/stores/swUpdateStore.svelte"))["swUpdateStore"];

beforeEach(async () => {
	vi.resetModules();
	reload = vi.fn();
	// `sw` stubbe `navigator.serviceWorker` : contrôleur établi par défaut
	// (page fraîche déjà contrôlée par l'ancien SW, cas nominal).
	sw = { controller: {}, ...makeEventTarget(), getRegistration: vi.fn() };
	vi.stubGlobal("window", { ...makeEventTarget(), location: { reload } });
	vi.stubGlobal("document", { ...makeEventTarget(), visibilityState: "visible" });
	vi.stubGlobal("navigator", { serviceWorker: sw });
	({ swUpdateStore } = await import("$lib/stores/swUpdateStore.svelte"));
});

describe("swUpdateStore — auto-activation du waiting au chargement frais", () => {
	it("waiting au boot : activation immédiate, pas de toast, reload au controllerchange", async () => {
		reg = makeRegistration(true);
		sw.getRegistration.mockResolvedValue(reg);

		await swUpdateStore.init();
		await flushMicrotasks();

		expect(reg.waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
		expect(swUpdateStore.hasUpdate).toBe(false);

		sw.dispatch("controllerchange");
		expect(reload).toHaveBeenCalledOnce();
	});

	it("waiting au boot sans contrôleur (premier install) : aucun effet", async () => {
		sw.controller = null;
		reg = makeRegistration(true);
		sw.getRegistration.mockResolvedValue(reg);

		await swUpdateStore.init();
		await flushMicrotasks();

		expect(reg.waiting.postMessage).not.toHaveBeenCalled();
		expect(swUpdateStore.hasUpdate).toBe(false);
		expect(reload).not.toHaveBeenCalled();
	});

	it("pas de waiting au boot : aucun effet", async () => {
		reg = makeRegistration(false);
		sw.getRegistration.mockResolvedValue(reg);

		await swUpdateStore.init();
		await flushMicrotasks();

		expect(swUpdateStore.hasUpdate).toBe(false);
		expect(reload).not.toHaveBeenCalled();
	});
});

// Boot sans waiting : le `controllerchange` ne peut venir que d'un autre
// onglet, ou suivre un `applyUpdate()` explicite.
describe("swUpdateStore — consentement de reload au controllerchange", () => {
	async function bootWithoutWaiting() {
		reg = makeRegistration(false);
		sw.getRegistration.mockResolvedValue(reg);
		await swUpdateStore.init();
		await flushMicrotasks();
	}

	it("controllerchange venu d'un autre onglet : pas de reload, MAJ signalée", async () => {
		await bootWithoutWaiting();

		sw.dispatch("controllerchange");

		expect(reload).not.toHaveBeenCalled();
		expect(swUpdateStore.hasUpdate).toBe(true);
	});

	it("après applyUpdate, controllerchange recharge l'onglet demandeur", async () => {
		await bootWithoutWaiting();
		// Un waiting apparaît en session (second déploiement découvert).
		reg.waiting = { postMessage: vi.fn() };

		await swUpdateStore.applyUpdate();
		expect(reg.waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });

		sw.dispatch("controllerchange");
		expect(reload).toHaveBeenCalledOnce();
	});
});
