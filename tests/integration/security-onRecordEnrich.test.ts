/**
 * Tests d'integration — securite : onRecordEnrich, API Rules, endpoints custom
 *
 * Objectif :
 *   Verifier le comportement de securite cote serveur PocketBase :
 *   - Le hook onRecordEnrich masque/adminToken selon le demandeur
 *   - Les API Rules controlent l'acces (list, view, create, update, delete)
 *   - Les endpoints custom (/api/claim-admin, /api/sync-plannings) fonctionnent
 *   - Le hook onRecordUpdateRequest pour planning_masters verifie adminOf
 *
 * Architecture :
 *   - Users crees une seule fois en beforeAll (evite rate limiting PB)
 *   - Clients PB reutilises (un par user, un guest, un admin)
 *   - Plannings crees/nettoyes par test
 *
 * Prerequis :
 *   - PocketBase demarre sur http://127.0.0.1:8090
 *   - Admin de test cree (test@example.com / testpassword)
 */

import PocketBase from "pocketbase";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mastersCollection } from "$lib/data/collections";
import { pb } from "$lib/pocketbase/pb";
import type { PlanningMaster, PlanningOccurrence } from "$lib/types/planning.types";
import {
	authenticateAdmin,
	cleanupTrackedRecords,
	cleanupUsers,
	clearTrackedIds,
	seedPlanning
} from "./seed";

const PB_URL = process.env.VITE_PLANNING_PB_URL || "http://127.0.0.1:8090";
const USER_A_EMAIL = "auth-a@test.com";
const USER_B_EMAIL = "auth-b@test.com";
const USER_A_PWD = "password123";
const USER_B_PWD = "password123";

describe("Securite — onRecordEnrich, API Rules, endpoints", () => {
	let adminPb: PocketBase;
	let userPbA: PocketBase;
	let userPbB: PocketBase;
	let guestPb: PocketBase;
	let userAId: string;
	let userBId: string;

	beforeAll(async () => {
		adminPb = await authenticateAdmin();

		const existingA = await adminPb
			.collection("users")
			.getFullList({ filter: `email = "${USER_A_EMAIL}"` });
		if (existingA.length > 0) {
			userAId = existingA[0].id;
		} else {
			const u = await adminPb.collection("users").create({
				email: USER_A_EMAIL,
				password: USER_A_PWD,
				passwordConfirm: USER_A_PWD,
				name: "User A",
				masterId: [],
				adminOf: {},
				emailVisibility: true,
				verified: true
			});
			userAId = u.id;
		}

		const existingB = await adminPb
			.collection("users")
			.getFullList({ filter: `email = "${USER_B_EMAIL}"` });
		if (existingB.length > 0) {
			userBId = existingB[0].id;
		} else {
			const u = await adminPb.collection("users").create({
				email: USER_B_EMAIL,
				password: USER_B_PWD,
				passwordConfirm: USER_B_PWD,
				name: "User B",
				masterId: [],
				adminOf: {},
				emailVisibility: true,
				verified: true
			});
			userBId = u.id;
		}

		userPbA = new PocketBase(PB_URL);
		await userPbA.collection("users").authWithPassword(USER_A_EMAIL, USER_A_PWD);

		userPbB = new PocketBase(PB_URL);
		await userPbB.collection("users").authWithPassword(USER_B_EMAIL, USER_B_PWD);

		guestPb = new PocketBase(PB_URL);
	});

	afterAll(async () => {
		await cleanupTrackedRecords();
		await cleanupUsers([USER_A_EMAIL, USER_B_EMAIL]);
	});

	beforeEach(async () => {
		pb.authStore.clear();
		clearTrackedIds();
		await adminPb.collection("users").update(userAId, { masterId: [], adminOf: {} });
		await adminPb.collection("users").update(userBId, { masterId: [], adminOf: {} });
	});

	afterEach(async () => {
		pb.authStore.clear();
		mastersCollection.unsubscribeAll();
		await cleanupTrackedRecords();
	});

	async function setupUserAWithMaster(
		masterId: string,
		opts?: { adminOf?: string }
	): Promise<void> {
		const update: Record<string, unknown> = { masterId: [masterId] };
		if (opts?.adminOf) {
			update.adminOf = { [masterId]: opts.adminOf };
		} else {
			update.adminOf = {};
		}
		await adminPb.collection("users").update(userAId, update);
	}

	async function setupUserBWithMaster(masterId: string): Promise<void> {
		await adminPb.collection("users").update(userBId, {
			masterId: [masterId],
			adminOf: {}
		});
	}

	// ============================================
	// onRecordEnrich — visibilite adminToken
	// ============================================

	describe("onRecordEnrich — adminToken visibility", () => {
		it("superuser voit toujours adminToken", async () => {
			const { master } = await seedPlanning({ title: "Superuser View" });

			const pbMaster = await adminPb
				.collection("planning_masters")
				.getOne<PlanningMaster>(master.id);

			expect(pbMaster.adminToken).toBeDefined();
			expect(pbMaster.adminToken!.length).toBe(64);
		});

		it("guest avec _token=adminToken voit adminToken (queryToken bypass)", async () => {
			const { master, adminToken } = await seedPlanning({ title: "Guest Admin Token" });

			const pbMaster = await guestPb
				.collection("planning_masters")
				.getOne<PlanningMaster>(master.id, { query: { _token: adminToken } });

			expect(pbMaster.adminToken).toBeDefined();
			expect(pbMaster.adminToken).toBe(adminToken);
		});

		it("guest avec _token=participantToken ne voit PAS adminToken", async () => {
			const { master, participantToken } = await seedPlanning({
				title: "Guest Participant Token"
			});

			const pbMaster = await guestPb
				.collection("planning_masters")
				.getOne<PlanningMaster>(master.id, { query: { _token: participantToken } });

			expect(pbMaster.adminToken).toBeUndefined();
			expect(pbMaster.participantToken).toBeDefined();
		});

		it("auth user avec adminOf[masterId]=adminToken voit adminToken", async () => {
			const { master, adminToken } = await seedPlanning({ title: "Auth AdminOf" });
			await setupUserAWithMaster(master.id, { adminOf: adminToken });

			const pbMaster = await userPbA
				.collection("planning_masters")
				.getOne<PlanningMaster>(master.id);

			expect(pbMaster.adminToken).toBeDefined();
			expect(pbMaster.adminToken).toBe(adminToken);
		});

		it("auth user avec masterId mais SANS adminOf ne voit PAS adminToken", async () => {
			const { master } = await seedPlanning({ title: "Auth No AdminOf" });
			await setupUserAWithMaster(master.id);

			const pbMaster = await userPbA
				.collection("planning_masters")
				.getOne<PlanningMaster>(master.id);

			expect(pbMaster.adminToken).toBeUndefined();
		});

		it("auth user avec adminOf[masterId]=wrongToken ne voit PAS adminToken", async () => {
			const { master } = await seedPlanning({ title: "Auth Wrong AdminOf" });
			await setupUserAWithMaster(master.id, { adminOf: "0".repeat(64) });

			const pbMaster = await userPbA
				.collection("planning_masters")
				.getOne<PlanningMaster>(master.id);

			expect(pbMaster.adminToken).toBeUndefined();
		});

		it("onRecordEnrich ne s applique pas aux occurrences (plus de champ adminToken)", async () => {
			const { occurrences, participantToken } = await seedPlanning({
				title: "Occurrence Enrich",
				occurrenceCount: 1
			});

			const pbOcc = await guestPb
				.collection("planning_occurrences")
				.getOne<PlanningOccurrence>(occurrences[0].id, {
					query: { _token: participantToken }
				});

			// Les occurrences n ont plus de champ adminToken
			expect((pbOcc as any).adminToken).toBeUndefined();
			expect((pbOcc as any).participantToken).toBeUndefined();
		});
	});

	// ============================================
	// API Rules — planning_masters
	// ============================================

	describe("API Rules — planning_masters", () => {
		it("guest avec token peut lister/view le planning", async () => {
			const { master, participantToken } = await seedPlanning({ title: "Guest List" });

			const list = await guestPb.collection("planning_masters").getFullList({
				query: { _token: participantToken }
			});

			expect(list.some((m) => m.id === master.id)).toBe(true);
		});

		it("auth user avec masterId peut lister/view le planning", async () => {
			const { master } = await seedPlanning({ title: "Auth List" });
			await setupUserAWithMaster(master.id);

			const list = await userPbA.collection("planning_masters").getFullList();
			expect(list.some((m) => m.id === master.id)).toBe(true);
		});

		it("auth user SANS masterId ne voit PAS le planning (empty list)", async () => {
			const { master } = await seedPlanning({ title: "Auth No Access" });

			const list = await userPbA.collection("planning_masters").getFullList();
			expect(list.some((m) => m.id === master.id)).toBe(false);
		});

		it("auth user avec masterId mais SANS adminOf ne peut PAS update (401 from hook, before API Rules)", async () => {
			const { master } = await seedPlanning({ title: "Auth Update Blocked" });
			await setupUserAWithMaster(master.id);

			await expect(
				userPbA.collection("planning_masters").update(master.id, { title: "Should Fail" })
			).rejects.toMatchObject({ status: 401 });
		});

		it("deleteRule superusers only — aucun delete HTTP possible (403), master intact", async () => {
			const { master, participantToken, adminToken } = await seedPlanning({
				title: "Delete Rule"
			});
			await setupUserAWithMaster(master.id);

			await userPbA.collection("users").authRefresh();

			// deleteRule = null : seul un superuser peut hard-deleter. User auth,
			// guest participant et adminToken reçoivent tous 403.
			await expect(userPbA.collection("planning_masters").delete(master.id)).rejects.toMatchObject({
				status: 403
			});

			await expect(
				guestPb.collection("planning_masters").delete(master.id, {
					query: { _token: participantToken }
				})
			).rejects.toMatchObject({ status: 403 });

			// Même l'adminToken ne peut plus hard-deleter via l'API : deleteRule = null
			// (superusers only) protège la fenêtre de grâce et la notification des participants.
			await expect(
				guestPb.collection("planning_masters").delete(master.id, {
					query: { _token: adminToken }
				})
			).rejects.toMatchObject({ status: 403 });

			// Le master existe toujours — la fin de vie passe par le soft-delete + cron de purge.
			const stillThere = await adminPb.collection("planning_masters").getOne(master.id);
			expect(stillThere.id).toBe(master.id);
		});

		it("auth user avec masterId mais SANS _token ne peut PAS update occurrence (401 from hook)", async () => {
			const { master, occurrences } = await seedPlanning({
				title: "Occ Auth Update",
				occurrenceCount: 1
			});
			await setupUserAWithMaster(master.id);

			await expect(
				userPbA.collection("planning_occurrences").update(occurrences[0].id, { isConfirmed: true })
			).rejects.toMatchObject({ status: 401 });
		});

		it("auth user SANS _token ne peut PAS update occurrence (401 from occurrence hook)", async () => {
			const { master, occurrences, adminToken } = await seedPlanning({
				title: "Occ Auth AdminOf Update",
				occurrenceCount: 1
			});
			await setupUserAWithMaster(master.id, { adminOf: adminToken });

			await expect(
				userPbA.collection("planning_occurrences").update(occurrences[0].id, { isConfirmed: true })
			).rejects.toMatchObject({ status: 401 });
		});
	});

	// ============================================
	// API Rules — planning_participants
	// ============================================

	describe("API Rules — planning_participants", () => {
		it("auth user ne voit que ses propres planning_participants", async () => {
			const { master } = await seedPlanning({ title: "PP Isolation" });
			await setupUserAWithMaster(master.id);
			await setupUserBWithMaster(master.id);

			await adminPb.collection("planning_participants").create({
				planning: master.id,
				user: userAId,
				push: true
			});
			await adminPb.collection("planning_participants").create({
				planning: master.id,
				user: userBId,
				push: false
			});

			const listA = await userPbA.collection("planning_participants").getFullList();
			expect(listA.length).toBe(1);
			expect(listA[0].push).toBe(true);

			const listB = await userPbB.collection("planning_participants").getFullList();
			expect(listB.length).toBe(1);
			expect(listB[0].push).toBe(false);
		});

		it("auth user peut update ses propres planning_participants", async () => {
			const { master } = await seedPlanning({ title: "PP Update" });
			await setupUserAWithMaster(master.id);

			const ppRecord = await adminPb.collection("planning_participants").create({
				planning: master.id,
				user: userAId,
				push: true,
				email: false
			});

			const updated = await userPbA
				.collection("planning_participants")
				.update(ppRecord.id, { push: false, email: true });

			expect(updated.push).toBe(false);
			expect(updated.email).toBe(true);
		});

		it("auth user ne peut PAS update les planning_participants d un autre user", async () => {
			const { master } = await seedPlanning({ title: "PP Cross Update" });
			await setupUserBWithMaster(master.id);

			const ppRecord = await adminPb.collection("planning_participants").create({
				planning: master.id,
				user: userBId,
				push: true
			});

			await expect(
				userPbA.collection("planning_participants").update(ppRecord.id, { push: false })
			).rejects.toMatchObject({ status: 404 });
		});

		it("auth user ne peut PAS delete ses planning_participants (deleteRule=null)", async () => {
			const { master } = await seedPlanning({ title: "PP Delete" });
			await setupUserAWithMaster(master.id);

			const ppRecord = await adminPb.collection("planning_participants").create({
				planning: master.id,
				user: userAId
			});

			await expect(
				userPbA.collection("planning_participants").delete(ppRecord.id)
			).rejects.toMatchObject({ status: 403 });
		});

		it("createRule est vide (public) — n importe qui peut creer", async () => {
			const { master } = await seedPlanning({ title: "PP Public Create" });
			await setupUserAWithMaster(master.id);

			const created = await userPbA.collection("planning_participants").create({
				planning: master.id,
				user: userAId,
				push: false
			});

			expect(created.id).toBeDefined();
			expect(created.planning).toBe(master.id);
		});
	});

	// ============================================
	// /api/claim-admin
	// ============================================

	describe("/api/claim-admin", () => {
		it("auth user avec adminToken valide → adminOf et masterId mis a jour", async () => {
			const { master, adminToken } = await seedPlanning({ title: "Claim Admin" });

			await userPbA.send("/api/claim-admin", {
				method: "POST",
				body: { token: adminToken }
			});

			const user = await adminPb.collection("users").getOne(userAId);
			expect(user.masterId).toContain(master.id);

			const adminOf = (user.adminOf as Record<string, string>) || {};
			expect(adminOf[master.id]).toBe(adminToken);
		});

		it("adminToken invalide → 403", async () => {
			await expect(
				userPbA.send("/api/claim-admin", {
					method: "POST",
					body: { token: "0".repeat(64) }
				})
			).rejects.toMatchObject({ status: 403 });
		});

		it("pas authentifie → 401", async () => {
			await expect(
				guestPb.send("/api/claim-admin", {
					method: "POST",
					body: { token: "0".repeat(64) }
				})
			).rejects.toMatchObject({ status: 401 });
		});

		it("claim-admin est idempotent (pas de doublon masterId)", async () => {
			const { master, adminToken } = await seedPlanning({ title: "Claim Idempotent" });
			await setupUserAWithMaster(master.id);

			await userPbA.send("/api/claim-admin", {
				method: "POST",
				body: { token: adminToken }
			});

			await userPbA.send("/api/claim-admin", {
				method: "POST",
				body: { token: adminToken }
			});

			const user = await adminPb.collection("users").getOne(userAId);
			const masterIdCount = user.masterId.filter((id: string) => id === master.id).length;
			expect(masterIdCount).toBe(1);
		});
	});

	// ============================================
	// /api/sync-plannings
	// ============================================

	describe("/api/sync-plannings", () => {
		it("participantToken valide → masterId ajoute", async () => {
			const { master, participantToken } = await seedPlanning({ title: "Sync Participant" });

			const result = await userPbA.send("/api/sync-plannings", {
				method: "POST",
				body: {
					tokens: [{ masterId: master.id, participantToken }]
				}
			});

			expect(result.syncedIds).toContain(master.id);

			const user = await adminPb.collection("users").getOne(userAId);
			expect(user.masterId).toContain(master.id);
		});

		it("adminToken valide → masterId ET adminOf mis a jour", async () => {
			const { master, adminToken } = await seedPlanning({ title: "Sync Admin" });

			await userPbA.send("/api/sync-plannings", {
				method: "POST",
				body: {
					tokens: [{ masterId: master.id, adminToken }]
				}
			});

			const user = await adminPb.collection("users").getOne(userAId);
			expect(user.masterId).toContain(master.id);

			const adminOf = (user.adminOf as Record<string, string>) || {};
			expect(adminOf[master.id]).toBe(adminToken);
		});

		it("token invalide → non ajoute a masterId", async () => {
			const { master } = await seedPlanning({ title: "Sync Invalid" });

			await userPbA.send("/api/sync-plannings", {
				method: "POST",
				body: {
					tokens: [{ masterId: master.id, participantToken: "0".repeat(32) }]
				}
			});

			const user = await adminPb.collection("users").getOne(userAId);
			expect(user.masterId).not.toContain(master.id);
		});

		it("tokens deja dans masterId → inclus dans syncedIds", async () => {
			const { master, participantToken } = await seedPlanning({ title: "Sync Skip" });
			await setupUserAWithMaster(master.id);

			const result = await userPbA.send("/api/sync-plannings", {
				method: "POST",
				body: {
					tokens: [{ masterId: master.id, participantToken }]
				}
			});

			expect(result.syncedIds).toContain(master.id);
		});

		it("pas authentifie → 401", async () => {
			await expect(
				guestPb.send("/api/sync-plannings", {
					method: "POST",
					body: { tokens: [] }
				})
			).rejects.toMatchObject({ status: 401 });
		});
	});

	// ============================================
	// onRecordUpdateRequest — adminOf bypass
	// ============================================

	describe("onRecordUpdateRequest — planning_masters access control", () => {
		it("auth user SANS adminOf ne peut PAS update SANS _token (401 from hook)", async () => {
			const { master } = await seedPlanning({ title: "Hook No AdminOf" });
			await setupUserAWithMaster(master.id);

			await expect(
				userPbA.collection("planning_masters").update(master.id, { title: "Should Fail" })
			).rejects.toMatchObject({ status: 401 });
		});

		it("auth user SANS adminOf avec _token est restreint aux champs participants (participantToken)", async () => {
			const { master, participantToken } = await seedPlanning({ title: "Hook Token Bypass" });
			await setupUserAWithMaster(master.id);

			await expect(
				userPbA.collection("planning_masters").update<PlanningMaster>(
					master.id,
					{ title: "Updated via Token" },
					{
						query: { _token: participantToken }
					}
				)
			).rejects.toMatchObject({ status: 403 });
		});
	});
});
