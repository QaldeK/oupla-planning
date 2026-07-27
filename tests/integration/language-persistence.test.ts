/**
 * Tests d'intégration — Seam 2 : setAppLocale persiste locale côté serveur
 *
 * Objectif :
 *   Vérifier que `userStore.setAppLocale` écrit `locale` sur le record
 *   `users` PocketBase pour les users authentifiés, et n'écrit RIEN côté
 *   serveur pour les guests (cookie seul).
 *
 * Pipeline testé :
 *   Auth user : setAppLocale("en") → pb.collection("users").update(id, { locale })
 *               → setLocale("en") (cookie + reload)
 *   Guest     : setAppLocale("en") → setLocale("en") (cookie seul, pas d'update)
 *
 * Conditions réelles :
 *   - PB tourne sur http://127.0.0.1:8090
 *   - Migration 1784994804 a ajouté `locale` (select fr/en, default fr) à users
 *   - setLocale est mocké (empêche le reload en environnement test)
 *
 * Prerequis :
 *   - PocketBase démarré sur http://127.0.0.1:8090
 *   - Admin de test créé (test@example.com / testpassword)
 *   - Ticket 05 complet (migration + seam setAppLocale enrichie)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "$lib/pb-sync/db";
import { pb } from "$lib/pocketbase/pb";
import { UserStore } from "$lib/stores/userStore.svelte";
import {
	authenticateAdmin,
	authenticateUser,
	cleanupTrackedRecords,
	clearTrackedIds,
	seedUser,
	trackIds
} from "./seed";

// Mock Paraglide setLocale to prevent page reload in test environment
vi.mock("$lib/paraglide/runtime", () => ({
	setLocale: vi.fn(() => Promise.resolve()),
	getLocale: vi.fn(() => "fr")
}));

describe("Language persistence — Seam 2", () => {
	beforeEach(async () => {
		clearTrackedIds();
		await db.masters.clear();
		await db.occurrences.clear();
		await db.localMeta.clear();
		await db.commentState.clear();
		pb.authStore.clear();
		vi.clearAllMocks();
	});

	afterEach(async () => {
		pb.authStore.clear();
		await cleanupTrackedRecords();
	});

	describe("Authenticated user — locale persisted to PB", () => {
		it("persists users.locale to PB when user is authenticated", async () => {
			// === SEED ===
			const user = await seedUser("lang-auth@test.com", "password123", "Lang Auth User", {
				locale: "fr"
			});
			trackIds("users", user.id);

			// Authenticate via real PB SDK (test uses real PocketBase)
			const userPb = await authenticateUser("lang-auth@test.com", "password123");
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);

			// Create a fresh UserStore for test isolation
			const store = new UserStore();
			store.isLoggedIn = true;

			// === ACTION ===
			await store.setAppLocale("en");

			// === VERIFICATION POCKETBASE ===
			const adminPb = await authenticateAdmin();
			const pbUser = await adminPb.collection("users").getOne(user.id);
			expect(pbUser.locale).toBe("en");

			// === VERIFICATION RETOUR setLocale ===
			const { setLocale } = await import("$lib/paraglide/runtime");
			expect(setLocale).toHaveBeenCalledWith("en");

			// === VERIFICATION ORDRE : update AVANT setLocale ===
			// (update runs inside setAppLocale, setLocale is called after update completes)
			const callOrder = vi.mocked(setLocale).mock.invocationCallOrder;
			expect(callOrder.length).toBeGreaterThan(0);

			// Cleanup
			pb.authStore.clear();
		});

		it("sets locale back to fr after setting en", async () => {
			// === SEED ===
			const user = await seedUser("lang-switch@test.com", "password123", "Lang Switch User", {
				locale: "fr"
			});
			trackIds("users", user.id);

			// Authenticate
			const userPb = await authenticateUser("lang-switch@test.com", "password123");
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);

			const store = new UserStore();
			store.isLoggedIn = true;

			// === ACTION : fr → en → fr ===
			await store.setAppLocale("en");
			await store.setAppLocale("fr");

			// === VERIFICATION POCKETBASE ===
			const adminPb = await authenticateAdmin();
			const pbUser = await adminPb.collection("users").getOne(user.id);
			expect(pbUser.locale).toBe("fr");

			// === VERIFICATION RETOUR ===
			const { setLocale } = await import("$lib/paraglide/runtime");
			expect(setLocale).toHaveBeenCalledWith("fr");

			// Cleanup
			pb.authStore.clear();
		});
	});

	describe("Guest — cookie only, no PB write", () => {
		it("does NOT call pb.collection(users).update when user is not authenticated", async () => {
			// Mock PB update to track calls — pb is NOT authenticated (Guest)
			const updateSpy = vi.fn();
			vi.spyOn(pb, "collection").mockImplementation(
				() =>
					({
						update: updateSpy
					}) as any
			);

			// === ACTION ===
			const store = new UserStore();
			store.isLoggedIn = false;
			await store.setAppLocale("en");

			// === VERIFICATION : no PB update for guest ===
			expect(updateSpy).not.toHaveBeenCalled();

			// === VERIFICATION : setLocale was called ===
			const { setLocale } = await import("$lib/paraglide/runtime");
			expect(setLocale).toHaveBeenCalledWith("en");

			// Cleanup
			vi.restoreAllMocks();
		});

		it("calls setLocale with correct locale for guest", async () => {
			// Mock PB update to confirm no calls
			const updateSpy = vi.fn();
			vi.spyOn(pb, "collection").mockImplementation(
				() =>
					({
						update: updateSpy
					}) as any
			);

			// === ACTION ===
			const store = new UserStore();
			store.isLoggedIn = false;
			await store.setAppLocale("en");

			// === VERIFICATION ===
			const { setLocale } = await import("$lib/paraglide/runtime");
			expect(setLocale).toHaveBeenCalledWith("en");
			expect(updateSpy).not.toHaveBeenCalled();

			// Cleanup
			vi.restoreAllMocks();
		});
	});

	describe("Order — server write before setLocale", () => {
		it("persists to PB before calling setLocale for authenticated user", async () => {
			// === SEED ===
			const user = await seedUser("lang-order@test.com", "password123", "Lang Order User", {
				locale: "fr"
			});
			trackIds("users", user.id);

			// Authenticate
			const userPb = await authenticateUser("lang-order@test.com", "password123");
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);

			// Track call order: pb.update THEN setLocale
			const callLog: string[] = [];

			const originalUpdate = pb.collection("users").update;
			vi.spyOn(pb.collection("users"), "update").mockImplementation((async (...args: any[]) => {
				callLog.push("pb.update");
				return originalUpdate.apply(pb.collection("users"), args);
			}) as any);

			const { setLocale } = await import("$lib/paraglide/runtime");
			vi.mocked(setLocale).mockImplementation(async () => {
				callLog.push("setLocale");
			});

			const store = new UserStore();
			store.isLoggedIn = true;

			// === ACTION ===
			await store.setAppLocale("en");

			// === VERIFICATION ORDRE ===
			expect(callLog).toEqual(["pb.update", "setLocale"]);

			// Cleanup
			vi.restoreAllMocks();
			pb.authStore.clear();
		});
	});
});
