/**
 * Tests unitaires de `runAuthTransition` — fonction pure avec fakes en deps.
 *
 * Vérifie :
 *   - Le snapshot guest identity est lu AVANT le clear Dexie
 *   - L'ordre de la séquence : claim → clear → syncAuthData → subscribe → read-state
 *   - guestClaim retourné contient la bonne identité
 *   - Gestion d'erreur : une étape non bloquante qui échoue n'interrompt pas la suite
 */
import { describe, expect, it, vi } from "vitest";
import type { SavedPlanning } from "$lib/types/planning.types";
import type {
	AuthTransitionContext,
	AuthTransitionDeps,
	AuthTransitionResult,
} from "$lib/utils/authTransition";
import { runAuthTransition } from "$lib/utils/authTransition";

// =============================================
// Helpers : fakes
// =============================================

function createFakeDeps(callTracker?: { order: string[] }): AuthTransitionDeps {
	const track = (name: string) => {
		if (callTracker) callTracker.order.push(name);
	};

	return {
		planningStore: {
			initGlobalSync: vi.fn().mockImplementation(() => track("initGlobalSync")),
			invalidateActiveToken: vi.fn().mockImplementation(() => track("invalidateActiveToken")),
			setActiveToken: vi.fn().mockImplementation(async () => track("setActiveToken")),
		},
		mastersCollection: {
			unsubscribeAll: vi.fn().mockImplementation(() => track("mastersCollection.unsubscribeAll")),
			subscribe: vi.fn().mockImplementation(() => track("mastersCollection.subscribe")),
		},
		occurrencesCollection: {
			unsubscribeAll: vi
				.fn()
				.mockImplementation(() => track("occurrencesCollection.unsubscribeAll")),
			subscribe: vi.fn().mockImplementation(() => track("occurrencesCollection.subscribe")),
		},
		claimPlannings: vi.fn().mockImplementation(async () => track("claimPlannings")),
		syncAuthData: vi.fn().mockImplementation(async () => track("syncAuthData")),
		commentStateService: {
			syncCommentReadState: vi.fn().mockImplementation(async () => track("syncCommentReadState")),
		},
		db: {
			masters: {
				get: vi.fn().mockImplementation(async (id: string) => {
					track(`db.masters.get:${id}`);
					return { participantToken: "tok-part", adminToken: "tok-admin" };
				}),
				clear: vi.fn().mockImplementation(async () => track("db.masters.clear")),
			},
			occurrences: { clear: vi.fn().mockImplementation(async () => track("db.occurrences.clear")) },
			commentState: {
				clear: vi.fn().mockImplementation(async () => track("db.commentState.clear")),
			},
			localMeta: { clear: vi.fn().mockImplementation(async () => track("db.localMeta.clear")) },
		},
	};
}

function createContext(overrides: Partial<AuthTransitionContext> = {}): AuthTransitionContext {
	return {
		currentToken: "token-123",
		activeMasterId: "master-1",
		savedPlannings: [],
		...overrides,
	};
}

// =============================================
// Tests
// =============================================

describe("runAuthTransition", () => {
	it("snapshot guest identity est lu AVANT le clear Dexie", async () => {
		const savedPlannings: SavedPlanning[] = [
			{
				masterId: "master-1",
				currentUser: { id: "guest-1", name: "Alice" },
			},
		];
		const deps = createFakeDeps();
		const ctx = createContext({ savedPlannings });

		const result = await runAuthTransition(ctx, deps);

		// Le guestClaim doit contenir l'identité guest snapshotée
		expect(result).toEqual<AuthTransitionResult>({
			guestClaim: {
				masterId: "master-1",
				participantId: "guest-1",
				name: "Alice",
			},
		});
	});

	it("unsubscribe collections appelé AVANT le claim", async () => {
		const callTracker = { order: [] as string[] };
		const deps = createFakeDeps(callTracker);
		const ctx = createContext();

		await runAuthTransition(ctx, deps);

		// Vérifier l'ordre : initGlobalSync → snapshot (pas d'appel) → unsubscribe AVANT le claim
		const unsubscribeIndex = Math.min(
			callTracker.order.indexOf("mastersCollection.unsubscribeAll"),
			callTracker.order.indexOf("occurrencesCollection.unsubscribeAll"),
		);
		const claimIndex = callTracker.order.indexOf("claimPlannings");

		expect(unsubscribeIndex).toBeGreaterThan(-1);
		expect(claimIndex).toBeGreaterThan(unsubscribeIndex);
	});

	it("claim -> clear -> syncAuthData -> subscribe -> read-state", async () => {
		const callTracker = { order: [] as string[] };
		const deps = createFakeDeps(callTracker);

		await runAuthTransition(createContext(), deps);

		const at = (name: string) => callTracker.order.indexOf(name);
		expect(at("claimPlannings")).toBeGreaterThan(-1);
		expect(at("claimPlannings")).toBeLessThan(at("db.masters.clear"));
		expect(at("db.masters.clear")).toBeLessThan(at("syncAuthData"));
		expect(at("syncAuthData")).toBeLessThan(at("mastersCollection.subscribe"));
		expect(at("mastersCollection.subscribe")).toBeLessThan(at("syncCommentReadState"));
	});

	it("claim le planning courant avec ses deux tokens", async () => {
		const deps = createFakeDeps();

		await runAuthTransition(createContext(), deps);

		expect(deps.claimPlannings).toHaveBeenCalledExactlyOnceWith([
			{ id: "master-1", participantToken: "tok-part", adminToken: "tok-admin" },
		]);
	});

	it("guestClaim null si pas de planning actif", async () => {
		const deps = createFakeDeps();
		const ctx = createContext({ currentToken: null, activeMasterId: null });

		const result = await runAuthTransition(ctx, deps);

		expect(result.guestClaim).toBeNull();
	});

	it("guestClaim null si guest sans identité locale", async () => {
		const deps = createFakeDeps();
		const ctx = createContext({
			activeMasterId: "master-1",
			savedPlannings: [{ masterId: "master-1" }], // pas de currentUser
		});

		const result = await runAuthTransition(ctx, deps);

		expect(result.guestClaim).toBeNull();
	});

	it("gestion d erreur : claim échoué → la séquence continue", async () => {
		const callTracker = { order: [] as string[] };
		const deps = createFakeDeps(callTracker);
		(deps.claimPlannings as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));

		// Ne doit pas throw — l'erreur du claim est catchée
		await expect(runAuthTransition(createContext(), deps)).resolves.toBeDefined();

		expect(deps.db.masters.clear).toHaveBeenCalled();
		expect(deps.db.occurrences.clear).toHaveBeenCalled();
		expect(deps.db.commentState.clear).toHaveBeenCalled();
		expect(deps.db.localMeta.clear).toHaveBeenCalled();
		expect(deps.syncAuthData).toHaveBeenCalled();
	});

	it("gestion d erreur : syncAuthData échoué → subscribe et read-state assurés", async () => {
		const deps = createFakeDeps();
		(deps.syncAuthData as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Fetch failed"));

		await expect(runAuthTransition(createContext(), deps)).resolves.toBeDefined();

		expect(deps.mastersCollection.subscribe).toHaveBeenCalled();
		expect(deps.occurrencesCollection.subscribe).toHaveBeenCalled();
		expect(deps.commentStateService.syncCommentReadState).toHaveBeenCalled();
	});

	it("fetch et subscribe sont appelés après le clear", async () => {
		const callTracker = { order: [] as string[] };
		const deps = createFakeDeps(callTracker);
		const ctx = createContext();

		await runAuthTransition(ctx, deps);

		// db clear avant fetch
		const clearIndex = callTracker.order.indexOf("db.localMeta.clear");
		const fetchIndex = callTracker.order.indexOf("syncAuthData");

		expect(clearIndex).toBeGreaterThan(-1);
		expect(fetchIndex).toBeGreaterThan(-1);
		expect(fetchIndex).toBeGreaterThan(clearIndex);
	});

	it("setActiveToken est appelé avec le bon token", async () => {
		const deps = createFakeDeps();
		const ctx = createContext({ currentToken: "my-token" });

		await runAuthTransition(ctx, deps);

		expect(deps.planningStore.invalidateActiveToken).toHaveBeenCalled();
		expect(deps.planningStore.setActiveToken).toHaveBeenCalledWith("my-token");
	});

	it("skip claim et setActiveToken si pas de token actif", async () => {
		const deps = createFakeDeps();
		const ctx = createContext({ currentToken: null, activeMasterId: null });

		await runAuthTransition(ctx, deps);

		expect(deps.claimPlannings).not.toHaveBeenCalled();
		expect(deps.syncAuthData).toHaveBeenCalled();
	});
});
