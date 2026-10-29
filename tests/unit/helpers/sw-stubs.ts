/**
 * Stubs navigateur pour les tests unitaires du store de MAJ du SW (node pur,
 * sans jsdom).
 */
import { vi } from "vitest";

/** EventTarget factice. La fabrique d'events porte `target` et `type` : le
 * wrapper `create_event` de svelte/events les lit avant d'appeler le handler. */
export function makeEventTarget() {
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
			const e = { ...event, type, target: this };
			for (const cb of [...(listeners.get(type) ?? [])]) cb(e);
		},
	};
}

export type SwEventTarget = ReturnType<typeof makeEventTarget>;

/** Registration factice : `waiting` présent ou non, `update()` espionné. */
export function makeRegistration(waiting: boolean) {
	return {
		waiting: waiting ? { postMessage: vi.fn() } : null,
		update: vi.fn(() => Promise.resolve()),
		...makeEventTarget(),
	};
}

export type SwRegistrationStub = ReturnType<typeof makeRegistration>;

/** Purge la file de microtasks pour laisser les `.then()` de `init()` passer. */
export async function flushMicrotasks() {
	for (let i = 0; i < 5; i++) await Promise.resolve();
}
