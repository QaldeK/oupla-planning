/**
 * Tests unitaires — recover.ts (routine de recover autonome au boot)
 *
 * Objectif : vérifier que `recoverAllData` enchaîne bien les 4 étapes de
 * nettoyage (caches, SW, IndexedDB, web storage) puis déclenche un redirect.
 *
 * Environnement : node pur. Toutes les APIs browser sont mockées via
 * `vi.stubGlobal` avec des `vi.fn()` explicites pour permettre les assertions
 * `.toHaveBeenCalled*()`. Le module est volontairement sans dépendances pour
 * pouvoir tourner même en cas de crash applicatif.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { recoverAllData } from '$lib/utils/recover';

function makeSpies() {
	return {
		cachesKeys: vi.fn().mockResolvedValue(['cache-v1']),
		cachesDelete: vi.fn().mockResolvedValue(true),
		swGetRegistrations: vi
			.fn()
			.mockResolvedValue([{ unregister: vi.fn().mockResolvedValue(true) }]),
		idbDeleteDatabase: vi.fn().mockImplementation(() => {
			const req = {
				onsuccess: null as (() => void) | null,
				onerror: null as (() => void) | null,
				onblocked: null as (() => void) | null,
				error: null
			};
			queueMicrotask(() => req.onsuccess?.());
			return req;
		}),
		localClear: vi.fn(),
		sessionClear: vi.fn(),
		locationReplace: vi.fn()
	};
}

let spies: ReturnType<typeof makeSpies>;

beforeEach(() => {
	spies = makeSpies();
	vi.stubGlobal('caches', {
		keys: spies.cachesKeys,
		delete: spies.cachesDelete
	});
	vi.stubGlobal('navigator', {
		serviceWorker: { getRegistrations: spies.swGetRegistrations }
	});
	vi.stubGlobal('indexedDB', { deleteDatabase: spies.idbDeleteDatabase });
	vi.stubGlobal('localStorage', { clear: spies.localClear });
	vi.stubGlobal('sessionStorage', { clear: spies.sessionClear });
	vi.stubGlobal('window', { location: { replace: spies.locationReplace } });
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('recoverAllData — séquence complète', () => {
	it('appelle les 4 étapes de nettoyage puis redirect vers /', async () => {
		await recoverAllData();

		expect(spies.cachesKeys).toHaveBeenCalledOnce();
		expect(spies.swGetRegistrations).toHaveBeenCalledOnce();
		expect(spies.idbDeleteDatabase).toHaveBeenCalledWith('appDB');
		expect(spies.localClear).toHaveBeenCalledOnce();
		expect(spies.sessionClear).toHaveBeenCalledOnce();
		expect(spies.locationReplace).toHaveBeenCalledWith('/');
	});

	it('accepte une URL cible personnalisée', async () => {
		await recoverAllData('/p/abc123');
		expect(spies.locationReplace).toHaveBeenCalledWith('/p/abc123');
	});

	it('continue le nettoyage même si caches.keys lève', async () => {
		spies.cachesKeys.mockRejectedValueOnce(new Error('quota'));
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await recoverAllData();

		expect(spies.idbDeleteDatabase).toHaveBeenCalled();
		expect(spies.localClear).toHaveBeenCalledOnce();
		expect(spies.locationReplace).toHaveBeenCalledWith('/');
		warnSpy.mockRestore();
	});

	it('continue le nettoyage même si SW.getRegistrations lève', async () => {
		spies.swGetRegistrations.mockRejectedValueOnce(new Error('SW unavailable'));
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await recoverAllData();

		expect(spies.localClear).toHaveBeenCalledOnce();
		expect(spies.locationReplace).toHaveBeenCalledWith('/');
		warnSpy.mockRestore();
	});

	it('ne crash pas si localStorage.clear lève (privacy mode)', async () => {
		spies.localClear.mockImplementation(() => {
			throw new DOMException('Forbidden');
		});
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await recoverAllData();

		expect(spies.locationReplace).toHaveBeenCalledWith('/');
		warnSpy.mockRestore();
	});
});
