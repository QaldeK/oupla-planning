/**
 * Tests unitaires de `runAuthTransition` — fonction pure avec fakes en deps.
 *
 * Vérifie :
 *   - Le snapshot guest identity est lu AVANT le clear Dexie
 *   - unsubscribe collections avant POST sync
 *   - guestClaim retourné contient la bonne identité
 *   - Gestion d'erreur : sync échoué → clear quand même
 */
import { describe, it, expect, vi } from 'vitest';
import { runAuthTransition } from '$lib/utils/authTransition';
import type {
	AuthTransitionContext,
	AuthTransitionDeps,
	AuthTransitionResult
} from '$lib/utils/authTransition';
import type { SavedPlanning } from '$lib/types/planning.types';

// =============================================
// Helpers : fakes
// =============================================

function createFakeDeps(callTracker?: { order: string[] }): AuthTransitionDeps {
	const track = (name: string) => {
		if (callTracker) callTracker.order.push(name);
	};

	return {
		planningStore: {
			initGlobalSync: vi.fn().mockImplementation(() => track('initGlobalSync')),
			invalidateActiveToken: vi.fn().mockImplementation(() => track('invalidateActiveToken')),
			setActiveToken: vi.fn().mockImplementation(async () => track('setActiveToken'))
		},
		mastersCollection: {
			unsubscribeAll: vi.fn().mockImplementation(() => track('mastersCollection.unsubscribeAll')),
			initialFetch: vi.fn().mockImplementation(async () => track('mastersCollection.initialFetch')),
			subscribe: vi.fn().mockImplementation(() => track('mastersCollection.subscribe'))
		},
		occurrencesCollection: {
			unsubscribeAll: vi
				.fn()
				.mockImplementation(() => track('occurrencesCollection.unsubscribeAll')),
			initialFetch: vi
				.fn()
				.mockImplementation(async () => track('occurrencesCollection.initialFetch')),
			subscribe: vi.fn().mockImplementation(() => track('occurrencesCollection.subscribe'))
		},
		commentStateService: {
			syncCommentReadState: vi.fn().mockImplementation(async () => track('syncCommentReadState'))
		},
		pb: {
			send: vi.fn().mockImplementation(async (_path, _config) => {
				track('pb.send');
				return { success: true };
			})
		},
		db: {
			masters: {
				get: vi.fn().mockImplementation(async (id: string) => {
					track(`db.masters.get:${id}`);
					return { participantToken: 'tok-part', adminToken: 'tok-admin' };
				}),
				clear: vi.fn().mockImplementation(async () => track('db.masters.clear'))
			},
			occurrences: { clear: vi.fn().mockImplementation(async () => track('db.occurrences.clear')) },
			commentState: {
				clear: vi.fn().mockImplementation(async () => track('db.commentState.clear'))
			},
			localMeta: { clear: vi.fn().mockImplementation(async () => track('db.localMeta.clear')) }
		}
	};
}

function createContext(overrides: Partial<AuthTransitionContext> = {}): AuthTransitionContext {
	return {
		currentToken: 'token-123',
		activeMasterId: 'master-1',
		savedPlannings: [],
		...overrides
	};
}

// =============================================
// Tests
// =============================================

describe('runAuthTransition', () => {
	it('snapshot guest identity est lu AVANT le clear Dexie', async () => {
		const savedPlannings: SavedPlanning[] = [
			{
				masterId: 'master-1',
				currentUser: { id: 'guest-1', name: 'Alice' }
			}
		];
		const deps = createFakeDeps();
		const ctx = createContext({ savedPlannings });

		const result = await runAuthTransition(ctx, deps);

		// Le guestClaim doit contenir l'identité guest snapshotée
		expect(result).toEqual<AuthTransitionResult>({
			guestClaim: {
				masterId: 'master-1',
				participantId: 'guest-1',
				name: 'Alice'
			}
		});
	});

	it('unsubscribe collections appelé AVANT le POST sync', async () => {
		const callTracker = { order: [] as string[] };
		const deps = createFakeDeps(callTracker);
		const ctx = createContext();

		await runAuthTransition(ctx, deps);

		// Vérifier l'ordre : initGlobalSync → snapshot (pas d'appel) → unsubscribe AVANT pb.send
		const unsubscribeIndex = Math.min(
			callTracker.order.indexOf('mastersCollection.unsubscribeAll'),
			callTracker.order.indexOf('occurrencesCollection.unsubscribeAll')
		);
		const pbSendIndex = callTracker.order.indexOf('pb.send');

		expect(unsubscribeIndex).toBeGreaterThan(-1);
		expect(pbSendIndex).toBeGreaterThan(unsubscribeIndex);
	});

	it('guestClaim null si pas de planning actif', async () => {
		const deps = createFakeDeps();
		const ctx = createContext({ currentToken: null, activeMasterId: null });

		const result = await runAuthTransition(ctx, deps);

		expect(result.guestClaim).toBeNull();
	});

	it('guestClaim null si guest sans identité locale', async () => {
		const deps = createFakeDeps();
		const ctx = createContext({
			activeMasterId: 'master-1',
			savedPlannings: [{ masterId: 'master-1' }] // pas de currentUser
		});

		const result = await runAuthTransition(ctx, deps);

		expect(result.guestClaim).toBeNull();
	});

	it('gestion d erreur : sync échoué → clear Dexie quand même', async () => {
		const callTracker = { order: [] as string[] };
		const deps = createFakeDeps(callTracker);
		// Faire échouer pb.send
		(deps.pb.send as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

		const ctx = createContext();

		// Ne doit pas throw — l'erreur est catchée
		await expect(runAuthTransition(ctx, deps)).resolves.toBeDefined();

		// Vérifier que le clear a bien eu lieu malgré l'erreur sync
		expect(deps.db.masters.clear).toHaveBeenCalled();
		expect(deps.db.occurrences.clear).toHaveBeenCalled();
		expect(deps.db.commentState.clear).toHaveBeenCalled();
		expect(deps.db.localMeta.clear).toHaveBeenCalled();
	});

	it('fetch et subscribe sont appelés après le clear', async () => {
		const callTracker = { order: [] as string[] };
		const deps = createFakeDeps(callTracker);
		const ctx = createContext();

		await runAuthTransition(ctx, deps);

		// db clear avant fetch
		const clearIndex = callTracker.order.indexOf('db.localMeta.clear');
		const fetchIndex = callTracker.order.indexOf('mastersCollection.initialFetch');

		expect(clearIndex).toBeGreaterThan(-1);
		expect(fetchIndex).toBeGreaterThan(-1);
		expect(fetchIndex).toBeGreaterThan(clearIndex);
	});

	it('setActiveToken est appelé avec le bon token', async () => {
		const deps = createFakeDeps();
		const ctx = createContext({ currentToken: 'my-token' });

		await runAuthTransition(ctx, deps);

		expect(deps.planningStore.invalidateActiveToken).toHaveBeenCalled();
		expect(deps.planningStore.setActiveToken).toHaveBeenCalledWith('my-token');
	});

	it('skip sync si pas de token actif', async () => {
		const deps = createFakeDeps();
		const ctx = createContext({ currentToken: null, activeMasterId: null });

		await runAuthTransition(ctx, deps);

		expect(deps.pb.send).not.toHaveBeenCalled();
	});
});
