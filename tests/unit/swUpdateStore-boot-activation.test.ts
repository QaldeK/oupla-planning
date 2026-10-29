/**
 * Tests unitaires — swUpdateStore : auto-activation du SW en attente au
 * chargement frais.
 *
 * Invariant : un `reg.waiting` présent au boot d'un document neuf est activé
 * immédiatement et silencieusement — aucune saisie en cours à perdre, le
 * consentement ne protège rien et un toast serait imperceptible avant le
 * reload. Sans contrôleur (premier install), un waiting n'a pas de sens :
 * aucun effet. La découverte en session, elle, reste consentie via le toast
 * (couvert par l'autre fichier de test).
 *
 * Environnement : node pur, APIs browser stubbées. Le singleton porte de
 * l'état (`#initialized`, drapeaux privés) : chaque test réimporte le module
 * après `vi.resetModules()` pour repartir d'une instance vierge.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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
			// Même contrat que svelte/events : `event.target` et `event.type`
			// sont lus par le wrapper avant d'appeler le handler.
			const e = { ...event, type, target: this };
			for (const cb of [...(listeners.get(type) ?? [])]) cb(e);
		},
	};
}

function makeRegistration(withWaiting: boolean) {
	return {
		waiting: withWaiting ? { postMessage: vi.fn() } : null,
		update: vi.fn(() => Promise.resolve()),
		...makeEventTarget(),
	};
}

type Registration = ReturnType<typeof makeRegistration>;

let serviceWorker: {
	controller: { controller: unknown } & ReturnType<typeof makeEventTarget> & {
		getRegistration: ReturnType<typeof vi.fn>;
	};
};
let reg: Registration;
let reload: ReturnType<typeof vi.fn>;
let swUpdateStore: (typeof import("$lib/stores/swUpdateStore.svelte"))["swUpdateStore"];

async function flushMicrotasks() {
	for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(async () => {
	vi.resetModules();
	reload = vi.fn();
	serviceWorker = {
		controller: {
			// Page fraîche déjà contrôlée par l'ancien SW : le cas nominal.
			controller: {},
			...makeEventTarget(),
			getRegistration: vi.fn(),
		},
	};
	vi.stubGlobal("window", { ...makeEventTarget(), location: { reload } });
	vi.stubGlobal("document", { ...makeEventTarget(), visibilityState: "visible" });
	vi.stubGlobal("navigator", { serviceWorker: serviceWorker.controller });
	({ swUpdateStore } = await import("$lib/stores/swUpdateStore.svelte"));
});

describe("swUpdateStore — auto-activation du waiting au chargement frais", () => {
	it("waiting au boot : activation immédiate, pas de toast, reload au controllerchange", async () => {
		reg = makeRegistration(true);
		serviceWorker.controller.getRegistration.mockResolvedValue(reg);

		await swUpdateStore.init();
		await flushMicrotasks();

		expect(reg.waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
		expect(swUpdateStore.hasUpdate).toBe(false);

		serviceWorker.controller.dispatch("controllerchange");
		expect(reload).toHaveBeenCalledOnce();
	});

	it("waiting au boot sans contrôleur (premier install) : aucun effet", async () => {
		serviceWorker.controller.controller = null;
		reg = makeRegistration(true);
		serviceWorker.controller.getRegistration.mockResolvedValue(reg);

		await swUpdateStore.init();
		await flushMicrotasks();

		expect(reg.waiting.postMessage).not.toHaveBeenCalled();
		expect(swUpdateStore.hasUpdate).toBe(false);
		expect(reload).not.toHaveBeenCalled();
	});

	it("pas de waiting au boot : aucun effet", async () => {
		reg = makeRegistration(false);
		serviceWorker.controller.getRegistration.mockResolvedValue(reg);

		await swUpdateStore.init();
		await flushMicrotasks();

		expect(swUpdateStore.hasUpdate).toBe(false);
		expect(reload).not.toHaveBeenCalled();
	});
});

/**
 * Boot SANS waiting : aucune demande locale posée, le `controllerchange` ne
 * peut venir que d'un autre onglet — ou suivre un `applyUpdate()` explicite.
 * Un `waiting` apparu en session reste découvert via `updatefound` → toast
 * (branché côté layout), non rejoué ici.
 */
describe("swUpdateStore — consentement de reload au controllerchange", () => {
	async function bootWithoutWaiting() {
		reg = makeRegistration(false);
		serviceWorker.controller.getRegistration.mockResolvedValue(reg);
		await swUpdateStore.init();
		await flushMicrotasks();
	}

	it("controllerchange venu d'un autre onglet : pas de reload, MAJ signalée", async () => {
		await bootWithoutWaiting();

		serviceWorker.controller.dispatch("controllerchange");

		expect(reload).not.toHaveBeenCalled();
		expect(swUpdateStore.hasUpdate).toBe(true);
	});

	it("après applyUpdate, controllerchange recharge l'onglet demandeur", async () => {
		await bootWithoutWaiting();
		// Un waiting apparaît en session (second déploiement découvert).
		reg.waiting = { postMessage: vi.fn() };

		await swUpdateStore.applyUpdate();
		expect(reg.waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });

		serviceWorker.controller.dispatch("controllerchange");
		expect(reload).toHaveBeenCalledOnce();
	});
});
