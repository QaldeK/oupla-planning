/**
 * Tests d'intégration — PlanningStore : Guest Flow
 *
 * Objectif :
 *   Vérifier que le pipeline complet fonctionne pour un utilisateur guest (anonynme) :
 *     Token → planningStore.setActiveToken() → fetch PocketBase → Dexie → liveQuery → Store state
 *
 * Ce que ça teste :
 *   1. Résolution du token (participant ou admin) vers un PlanningMaster via API
 *   2. Stockage du master dans Dexie (db.masters)
 *   3. Fetch des occurrences via pb-sync (db.occurrences)
 *   4. Branchement des liveQuery Dexie → $state du store
 *   5. Les masters/tokens sont lus depuis db.masters (plus de localMeta pour les tokens)
 *   6. Cohérence des données : Store ↔ Dexie ↔ PocketBase
 *
 * Scénarios couverts :
 *   - Guest avec participantToken (32 chars)
 *   - Guest avec adminToken (64 chars)
 *   - Token invalide → erreur not_found
 *   - Changement de token → unsubscribe ancien, subscribe nouveau
 *
 * Prérequis :
 *   - PocketBase démarré sur http://127.0.0.1:8090
 *   - Admin de test créé (test@example.com / testpassword)
 *   - fake-indexeddb polyfill (via setup.ts)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mastersCollection, occurrencesCollection } from "$lib/data/collections";
import { db } from "$lib/pb-sync/db";
import { planningStore } from "$lib/stores/planningStore.svelte";
import { authenticateAdmin, cleanupTrackedRecords, clearTrackedIds, seedPlanning } from "./seed";

describe("PlanningStore — Guest Flow", () => {
	beforeEach(async () => {
		clearTrackedIds();
		// Nettoyer Dexie entre chaque test
		await db.masters.clear();
		await db.occurrences.clear();
		await db.localMeta.clear();
		await db.commentState.clear();

		// Reset l'état des stores
		planningStore.destroy();
	});

	afterEach(async () => {
		// Nettoyer les subscriptions realtime
		mastersCollection.unsubscribeAll();
		occurrencesCollection.unsubscribeAll();
		// Nettoyer les records PocketBase créés par le test
		await cleanupTrackedRecords();
	});

	describe("setActiveToken — participant token", () => {
		it("charge un planning guest et synchronise Dexie + PocketBase", async () => {
			// === SEED ===
			const {
				master,
				occurrences: _occurrences,
				participantToken
			} = await seedPlanning({
				title: "Planning Guest Test",
				occurrenceCount: 3
			});

			// === ACTION ===
			await planningStore.setActiveToken(participantToken);

			// Attendre que le liveQuery Dexie émette
			await vi.waitFor(
				() => {
					expect(planningStore.master).not.toBeNull();
				},
				{ timeout: 2000 }
			);

			// === VÉRIFICATION STORE ===
			expect(planningStore.activeMasterId).toBe(master.id);
			expect(planningStore.master?.title).toBe("Planning Guest Test");
			expect(planningStore.occurrences.length).toBe(3);
			expect(planningStore.isLoading).toBe(false);
			expect(planningStore.error).toBeNull();

			// === VÉRIFICATION DEXIE ===
			const dexieMaster = await db.masters.get(master.id);
			expect(dexieMaster).toBeDefined();
			expect(dexieMaster!.title).toBe("Planning Guest Test");
			expect(dexieMaster!.participantToken).toBe(participantToken);

			const dexieOccurrences = await db.occurrences.where("master").equals(master.id).toArray();
			expect(dexieOccurrences.length).toBe(3);

			// === VÉRIFICATION Dexie masters (source de vérité pour tokens) ===
			const dexieMasterForToken = await db.masters.get(master.id);
			expect(dexieMasterForToken).toBeDefined();
			expect(dexieMasterForToken!.participantToken).toBe(participantToken);
			// adminToken ne doit PAS être présent pour un participant token
			expect(dexieMasterForToken!.adminToken).toBeUndefined();

			// === VÉRIFICATION POCKETBASE ===
			const adminPb = await authenticateAdmin();
			const pbMaster = await adminPb.collection("planning_masters").getOne(master.id);
			expect(pbMaster.title).toBe("Planning Guest Test");
			expect(pbMaster.participantToken).toBe(participantToken);
			expect(dexieMaster!.updated).toBe(pbMaster.updated);

			const pbOccurrences = await adminPb.collection("planning_occurrences").getFullList({
				filter: `master = "${master.id}"`
			});
			expect(pbOccurrences.length).toBe(3);
			const pbDates = pbOccurrences.map((o) => o.date).sort();
			const dexieDates = dexieOccurrences.map((o) => o.date).sort();
			expect(dexieDates).toEqual(pbDates);
		});

		it("rejette un token invalide avec une erreur not_found", async () => {
			// === ACTION ===
			await planningStore.setActiveToken("invalid-token-does-not-exist");

			// === VÉRIFICATION ===
			expect(planningStore.activeMasterId).toBeNull();
			expect(planningStore.master).toBeNull();
			expect(planningStore.error).not.toBeNull();
			expect(planningStore.error!.type).toBe("not_found");

			// Dexie doit rester vide (aucun master créé)
			const masters = await db.masters.toArray();
			expect(masters.length).toBe(0);
		});
	});

	describe("setActiveToken — admin token", () => {
		it("charge un planning admin et persiste le adminToken", async () => {
			// === SEED ===
			const { master, adminToken } = await seedPlanning({
				title: "Planning Admin Test",
				occurrenceCount: 2
			});

			// === ACTION ===
			await planningStore.setActiveToken(adminToken);

			// Attendre que la liveQuery Dexie émette son premier résultat
			await vi.waitFor(
				() => {
					expect(planningStore.master).not.toBeNull();
				},
				{ timeout: 500 }
			);

			// === VÉRIFICATION STORE ===
			expect(planningStore.activeMasterId).toBe(master.id);
			expect(planningStore.master?.title).toBe("Planning Admin Test");

			// === VÉRIFICATION DEXIE ===
			const dexieMaster = await db.masters.get(master.id);
			expect(dexieMaster).toBeDefined();
			expect(dexieMaster!.title).toBe("Planning Admin Test");

			const dexieOccurrences = await db.occurrences.where("master").equals(master.id).toArray();
			expect(dexieOccurrences.length).toBe(2);

			// === VÉRIFICATION Dexie masters (adminToken persisté) ===
			const dexieMasterForToken = await db.masters.get(master.id);
			expect(dexieMasterForToken).toBeDefined();
			expect(dexieMasterForToken!.adminToken).toBe(adminToken);
			expect(dexieMasterForToken!.participantToken).toBe(master.participantToken);

			// === VÉRIFICATION POCKETBASE ===
			const adminPb = await authenticateAdmin();
			const pbMaster = await adminPb.collection("planning_masters").getOne(master.id);
			expect(pbMaster.title).toBe("Planning Admin Test");
			expect(dexieMaster!.updated).toBe(pbMaster.updated);

			const pbOccurrences = await adminPb.collection("planning_occurrences").getFullList({
				filter: `master = "${master.id}"`
			});
			expect(pbOccurrences.length).toBe(2);
		});
	});

	describe("changement de token", () => {
		it("désactive l ancien planning et charge le nouveau", async () => {
			// === SEED ===
			const { participantToken: token1, master: master1 } = await seedPlanning({
				title: "Planning 1"
			});
			const { participantToken: token2, master: master2 } = await seedPlanning({
				title: "Planning 2"
			});

			// === ACTION 1 ===
			await planningStore.setActiveToken(token1);
			await vi.waitFor(() => {
				expect(planningStore.master).not.toBeNull();
			});
			expect(planningStore.activeMasterId).toBe(master1.id);

			// === ACTION 2 ===
			await planningStore.setActiveToken(token2);

			// Attendre que la liveQuery Dexie émette pour le nouveau planning
			await vi.waitFor(
				() => {
					expect(planningStore.master?.title).toBe("Planning 2");
				},
				{ timeout: 500 }
			);

			// === VÉRIFICATION ===
			expect(planningStore.activeMasterId).toBe(master2.id);

			// Les deux plannings sont en Dexie
			const dexieMasters = await db.masters.toArray();
			expect(dexieMasters.length).toBe(2);

			// === VÉRIFICATION POCKETBASE ===
			const adminPb = await authenticateAdmin();
			const pbMaster1 = await adminPb.collection("planning_masters").getOne(master1.id);
			expect(pbMaster1.title).toBe("Planning 1");
			const dexieMaster1 = dexieMasters.find((m) => m.id === master1.id);
			expect(dexieMaster1!.updated).toBe(pbMaster1.updated);

			const pbMaster2 = await adminPb.collection("planning_masters").getOne(master2.id);
			expect(pbMaster2.title).toBe("Planning 2");
			const dexieMaster2 = dexieMasters.find((m) => m.id === master2.id);
			expect(dexieMaster2!.updated).toBe(pbMaster2.updated);

			const pbOccurrences1 = await adminPb.collection("planning_occurrences").getFullList({
				filter: `master = "${master1.id}"`
			});
			const pbOccurrences2 = await adminPb.collection("planning_occurrences").getFullList({
				filter: `master = "${master2.id}"`
			});
			const dexieOccurrences1 = await db.occurrences.where("master").equals(master1.id).toArray();
			const dexieOccurrences2 = await db.occurrences.where("master").equals(master2.id).toArray();
			expect(dexieOccurrences1.length).toBe(pbOccurrences1.length);
			expect(dexieOccurrences2.length).toBe(pbOccurrences2.length);
		});
	});

	describe("realtime — guest subscriptions", () => {
		it("met a jour le store quand un autre client modifie le master", async () => {
			// === SEED ===
			const { master, participantToken } = await seedPlanning({
				title: "Realtime Test",
				occurrenceCount: 1
			});
			const adminPb = await authenticateAdmin();

			// === ACTION : activer le planning (souscrit au realtime) ===
			await planningStore.setActiveToken(participantToken);
			await vi.waitFor(() => {
				expect(planningStore.master).not.toBeNull();
			});
			expect(planningStore.master?.title).toBe("Realtime Test");

			// === ACTION : modification externe via client independant ===
			await adminPb.collection("planning_masters").update(master.id, {
				title: "Updated via Realtime"
			});

			// === VERIFICATION : realtime → Dexie → liveQuery → store ===
			await vi.waitFor(
				() => {
					expect(planningStore.master?.title).toBe("Updated via Realtime");
				},
				{ timeout: 5000 }
			);

			// Verification Dexie coherence
			const dexieMaster = await db.masters.get(master.id);
			expect(dexieMaster?.title).toBe("Updated via Realtime");
		});

		it("met a jour les occurrences quand un autre client modifie une occurrence", async () => {
			// === SEED ===
			const {
				master: _master,
				occurrences,
				participantToken,
				adminToken
			} = await seedPlanning({
				title: "Realtime Occ Test",
				occurrenceCount: 2
			});
			const adminPb = await authenticateAdmin();

			// === ACTION ===
			await planningStore.setActiveToken(participantToken);
			await vi.waitFor(() => {
				expect(planningStore.occurrences.length).toBe(2);
			});

			// Modification externe d'une occurrence (token requis par API Rules)
			const targetOcc = occurrences[0];
			await adminPb
				.collection("planning_occurrences")
				.update(targetOcc.id, { isConfirmed: true }, { query: { _token: adminToken } });

			// === VERIFICATION ===
			await vi.waitFor(
				() => {
					const occ = planningStore.occurrences.find((o) => o.id === targetOcc.id);
					expect(occ?.isConfirmed).toBe(true);
				},
				{ timeout: 5000 }
			);
		});
	});

	describe("planning supprimé", () => {
		it("active en lecture seule un master soft-deleté (pas d'erreur, isDeleted true)", async () => {
			// === SEED ===
			const { master, participantToken } = await seedPlanning({
				title: "Planning Soft Deleted",
				occurrenceCount: 2
			});
			const adminPb = await authenticateAdmin();
			await adminPb.collection("planning_masters").update(master.id, { deleted: true });

			// === ACTION ===
			await planningStore.setActiveToken(participantToken);

			await vi.waitFor(
				() => {
					expect(planningStore.master).not.toBeNull();
				},
				{ timeout: 2000 }
			);

			// === VÉRIFICATION STORE ===
			expect(planningStore.error).toBeNull();
			expect(planningStore.isDeleted).toBe(true);
			expect(planningStore.master?.id).toBe(master.id);
			expect(planningStore.activeMasterId).toBe(master.id);

			// Occurrences encore lisibles
			await vi.waitFor(
				() => {
					expect(planningStore.occurrences.length).toBe(2);
				},
				{ timeout: 2000 }
			);
		});

		it("renvoie not_found quand le master n'existe plus côté serveur (purge)", async () => {
			// === SEED : master en Dexie uniquement, inexistant côté serveur ===
			const fakeId = "fake00000000000000000000000000";
			await db.masters.put({
				id: fakeId,
				title: "Planning Purged",
				participantToken: "p".repeat(32),
				adminToken: "a".repeat(64),
				participants: [],
				tasks: [],
				recurrence: { type: "CUSTOM" },
				defaultStartTime: "09:00",
				defaultEndTime: "17:00",
				minPresentRequired: 1,
				allowResponses: true,
				deleted: false,
				created: new Date().toISOString(),
				updated: new Date().toISOString()
			});

			// === ACTION ===
			await planningStore.setActiveToken("p".repeat(32));

			// === VÉRIFICATION ===
			expect(planningStore.error).not.toBeNull();
			expect(planningStore.error!.type).toBe("not_found");

			// Le store a marqué deleted localement
			const dexieMaster = await db.masters.get(fakeId);
			expect(dexieMaster?.deleted).toBe(true);
		});
	});
});
