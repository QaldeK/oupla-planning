/**
 * Tests unitaires de `runAuthTransition` — fonction pure avec fakes en deps.
 *
 * Vérifie :
 *   - Le snapshot guest identity est lu AVANT le clear Dexie
 *   - L'ordre de la séquence : claim → clear → syncAuthData → subscribe → read-state
 *   - guestClaim retourné contient la bonne identité
 *   - Gestion d'erreur : une étape non bloquante qui échoue n'interrompt pas la suite
 *   - Portage mur (mode: "portage") : claim batch + clear sélectif + authRefresh
 *   - Défaut (navigateur, mode: "default") : claim unique + clear total, statu quo
 *   - Adoption (mode: "adopt") : login venu d'une autre fenêtre — ni claim ni clear
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
		refreshAuthRecord: vi.fn().mockImplementation(async () => track("refreshAuthRecord")),
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
				toArray: vi.fn().mockImplementation(async () => {
					track("db.masters.toArray");
					return [{ id: "master-1", participantToken: "tok-part", adminToken: "tok-admin" }];
				}),
				clear: vi.fn().mockImplementation(async () => track("db.masters.clear")),
			},
			occurrences: { clear: vi.fn().mockImplementation(async () => track("db.occurrences.clear")) },
			commentState: {
				clear: vi.fn().mockImplementation(async () => track("db.commentState.clear")),
			},
			localMeta: {
				toArray: vi.fn().mockImplementation(async () => {
					track("db.localMeta.toArray");
					return [] as SavedPlanning[];
				}),
				bulkPut: vi.fn().mockImplementation(async () => track("db.localMeta.bulkPut")),
				clear: vi.fn().mockImplementation(async () => track("db.localMeta.clear")),
			},
		},
	};
}

function createContext(overrides: Partial<AuthTransitionContext> = {}): AuthTransitionContext {
	return {
		currentToken: "token-123",
		activeMasterId: "master-1",
		savedPlannings: [],
		mode: "default",
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

	// =============================================
	// Portage mur (app installée, mode: "portage")
	// =============================================

	it("portage : claim batch de tous les masters non supprimés, puis authRefresh", async () => {
		const callTracker = { order: [] as string[] };
		const deps = createFakeDeps(callTracker);
		(deps.db.masters.toArray as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ id: "master-1", participantToken: "tok-1", adminToken: "admin-1" },
			{ id: "master-2", participantToken: "tok-2" },
			{ id: "master-3", participantToken: "tok-3", deleted: true },
		]);

		// Derrière le mur, aucun planning n'est activé
		await runAuthTransition(
			createContext({ currentToken: null, activeMasterId: null, mode: "portage" }),
			deps,
		);

		expect(deps.claimPlannings).toHaveBeenCalledExactlyOnceWith([
			{ id: "master-1", participantToken: "tok-1", adminToken: "admin-1" },
			{ id: "master-2", participantToken: "tok-2" },
		]);
		expect(deps.refreshAuthRecord).toHaveBeenCalledOnce();

		// Ordre : claim → authRefresh → clear sélectif → sync
		expect(callTracker.order.indexOf("refreshAuthRecord")).toBeGreaterThan(
			callTracker.order.indexOf("claimPlannings"),
		);
		expect(callTracker.order.indexOf("db.localMeta.toArray")).toBeGreaterThan(
			callTracker.order.indexOf("refreshAuthRecord"),
		);
		expect(callTracker.order.indexOf("syncAuthData")).toBeGreaterThan(
			callTracker.order.indexOf("db.localMeta.bulkPut"),
		);
	});

	it("portage : clear sélectif — masters et identités guest survivent, le reste est vidé", async () => {
		const deps = createFakeDeps();
		(deps.db.localMeta.toArray as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ masterId: "master-1", currentUser: { id: "guest-1", name: "Alice", email: "" } },
			{ masterId: "master-2", hasQuit: true },
			{ masterId: "master-3", lastFetchAt: "2026-10-29T10:00:00Z" },
		]);

		await runAuthTransition(createContext({ mode: "portage" }), deps);

		// Les tokens font exister la sidebar : masters NON vidé
		expect(deps.db.masters.clear).not.toHaveBeenCalled();
		expect(deps.db.occurrences.clear).toHaveBeenCalled();
		expect(deps.db.commentState.clear).toHaveBeenCalled();

		// localMeta : seule l'identité (non reconstruisible) survit au clear
		expect(deps.db.localMeta.clear).toHaveBeenCalled();
		expect(deps.db.localMeta.bulkPut).toHaveBeenCalledExactlyOnceWith([
			{ masterId: "master-1", currentUser: { id: "guest-1", name: "Alice", email: "" } },
		]);
	});

	it("portage : pas de claim ni d'authRefresh si aucun master local", async () => {
		const deps = createFakeDeps();
		(deps.db.masters.toArray as ReturnType<typeof vi.fn>).mockResolvedValue([]);

		await runAuthTransition(createContext({ mode: "portage" }), deps);

		expect(deps.claimPlannings).not.toHaveBeenCalled();
		expect(deps.refreshAuthRecord).not.toHaveBeenCalled();
		// Le clear sélectif s'applique quand même (identités à préserver éventuelles)
		expect(deps.db.masters.clear).not.toHaveBeenCalled();
	});

	it("portage : échec du claim batch non bloquant — clear sélectif et sync assurés", async () => {
		const deps = createFakeDeps();
		(deps.claimPlannings as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Offline"));

		await expect(runAuthTransition(createContext({ mode: "portage" }), deps)).resolves.toBeDefined();

		expect(deps.refreshAuthRecord).not.toHaveBeenCalled();
		expect(deps.db.masters.clear).not.toHaveBeenCalled();
		expect(deps.syncAuthData).toHaveBeenCalled();
	});

	it("portage : échec de l'authRefresh non bloquant", async () => {
		const deps = createFakeDeps();
		(deps.refreshAuthRecord as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("401"));

		await expect(runAuthTransition(createContext({ mode: "portage" }), deps)).resolves.toBeDefined();

		expect(deps.syncAuthData).toHaveBeenCalled();
		expect(deps.db.masters.clear).not.toHaveBeenCalled();
	});

	it("défaut : pas d'authRefresh, claim unique du planning actif, clear total", async () => {
		const deps = createFakeDeps();

		await runAuthTransition(createContext(), deps);

		expect(deps.refreshAuthRecord).not.toHaveBeenCalled();
		expect(deps.claimPlannings).toHaveBeenCalledExactlyOnceWith([
			{ id: "master-1", participantToken: "tok-part", adminToken: "tok-admin" },
		]);
		expect(deps.db.masters.clear).toHaveBeenCalled();
		expect(deps.db.localMeta.clear).toHaveBeenCalled();
		expect(deps.db.localMeta.bulkPut).not.toHaveBeenCalled();
	});

	// =============================================
	// Adoption cross-fenêtre (mode: "adopt")
	// =============================================

	it("adopt : ni claim ni clear, sync et re-activation assurées, guestClaim null", async () => {
		const deps = createFakeDeps();
		(deps.db.localMeta.toArray as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ masterId: "master-1", currentUser: { id: "guest-1", name: "Alice", email: "" } },
		]);

		// L'onglet adopteur était sur un planning en mode guest
		const result = await runAuthTransition(createContext({ mode: "adopt" }), deps);

		expect(deps.claimPlannings).not.toHaveBeenCalled();
		expect(deps.refreshAuthRecord).not.toHaveBeenCalled();
		expect(deps.db.masters.clear).not.toHaveBeenCalled();
		expect(deps.db.occurrences.clear).not.toHaveBeenCalled();
		expect(deps.db.localMeta.clear).not.toHaveBeenCalled();
		expect(deps.db.localMeta.bulkPut).not.toHaveBeenCalled();
		// L'état local appartient désormais au compte : pas de snapshot
		// de suggestion depuis la fenêtre adoptante.
		expect(result.guestClaim).toBeNull();
		// Le reste de la séquence s'applique : sync + subscribe + re-activation
		expect(deps.syncAuthData).toHaveBeenCalled();
		expect(deps.mastersCollection.subscribe).toHaveBeenCalled();
		expect(deps.planningStore.setActiveToken).toHaveBeenCalledWith("token-123");
	});

	it("adopt : échec de syncAuthData non bloquant", async () => {
		const deps = createFakeDeps();
		(deps.syncAuthData as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Offline"));

		await expect(runAuthTransition(createContext({ mode: "adopt" }), deps)).resolves.toBeDefined();

		expect(deps.mastersCollection.subscribe).toHaveBeenCalled();
	});
});
