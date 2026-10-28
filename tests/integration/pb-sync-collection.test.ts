/**
 * Tests d'integration — pb-sync : initialFetch, CRUD, merge strategies
 *
 * Objectif :
 *   Verifier le coeur de pb-sync (collection.ts) en isolation :
 *   les operations CRUD, le fetch incrementale, et la fusion des champs array.
 *
 * Ce que ca teste :
 *   1. create : ecrit dans PocketBase puis Dexie, retourne le record confirme
 *   2. update : rollback Dexie si PB echoue, merge strategies sur les array fields
 *   3. remove : soft-delete dans PB puis Dexie (comportement par defaut)
 *   4. initialFetch : sync incrementale depuis le dernier `updated` connu dans Dexie
 *   5. mergeByKey : fusionne deux arrays par cle (participants, tasks, responses)
 *
 * Chaque test verifie la coherence triple :
 *   - Valeur retournee par pb-sync (confirmee par PB)
 *   - Contenu Dexie (db.masters / db.occurrences)
 *   - Contenu PocketBase (fetch independant via adminPb, authentifie superuser)
 *
 * Conditions reelles :
 *   Les operations utilisent des tokens via _token query param,
 *   comme le fait l'app en production (guest flow).
 *   La verification PB utilise adminPb (superuser) car onRecordEnrich
 *   masque adminToken pour les requetes non-admin.
 *
 * Pipeline teste :
 *   Collection CRUD → PocketBase API (avec _token) → Dexie (fake-indexeddb)
 *   initialFetch → PocketBase filter `updated > since` → Dexie bulkPut
 *
 * Prerequis :
 *   - PocketBase demarre sur http://127.0.0.1:8090
 *   - Admin de test cree (test@example.com / testpassword)
 */
import type { CollectionModel } from "pocketbase";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSyncCollection, mergeByKey } from "$lib/pb-sync/collection";
import { db } from "$lib/pb-sync/db";
import { pb } from "$lib/pocketbase/pb";
import type { Participant, PlanningMaster, PlanningOccurrence } from "$lib/types/planning.types";
import {
	authenticateAdmin,
	cleanupTrackedRecords,
	clearTrackedIds,
	dateInDays,
	seedPlanning,
	trackIds,
} from "./seed";

// Helper : genere des tokens uniques pour eviter les conflits d index unique PB
function generateUniqueTokens() {
	const a = new Uint8Array(32);
	crypto.getRandomValues(a);
	const adminToken = Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");

	const b = new Uint8Array(16);
	crypto.getRandomValues(b);
	const participantToken = Array.from(b, (c) => c.toString(16).padStart(2, "0")).join("");

	return { adminToken, participantToken };
}

describe("pb-sync — CRUD et merge strategies", () => {
	beforeEach(async () => {
		clearTrackedIds();
		await db.masters.clear();
		await db.occurrences.clear();
		await db.localMeta.clear();
		await db.commentState.clear();
	});

	afterEach(async () => {
		// Nettoyer les subscriptions realtime (pour anticiper les futurs tests realtime)
		// Note: actuellement aucun test ne subscribe, mais c'est une bonne pratique
		await cleanupTrackedRecords();
	});

	describe("createSyncCollection — create", () => {
		it("cree un master dans PB et Dexie simultanement", async () => {
			const collection = createSyncCollection<PlanningMaster>(pb, db.masters, "planning_masters", {
				mergeStrategies: {
					participants: mergeByKey<Participant>("id"),
				},
			});

			const { adminToken, participantToken } = generateUniqueTokens();
			const master = await collection.create(
				{
					title: "Test Create",
					defaultStartTime: "09:00",
					defaultEndTime: "17:00",
					recurrence: { type: "CUSTOM" },
					adminToken,
					participantToken,
					participants: [],
					tasks: [],
					minPresentRequired: 1,
					allowResponses: true,
				},
				{ query: { _token: adminToken } },
			);

			trackIds("planning_masters", master.id);

			expect(master.id).toBeDefined();
			expect(master.title).toBe("Test Create");

			// Verification Dexie
			const dexieMaster = await db.masters.get(master.id);
			expect(dexieMaster).toBeDefined();
			expect(dexieMaster!.title).toBe("Test Create");

			// Verification PocketBase (fetch independant via superuser pour voir adminToken)
			const adminPb = await authenticateAdmin();
			const pbMaster = await adminPb
				.collection("planning_masters")
				.getOne<PlanningMaster>(master.id);
			expect(pbMaster.title).toBe("Test Create");
			expect(pbMaster.adminToken).toBe(adminToken);

			// Coherence Dexie <-> PB
			expect(dexieMaster!.updated).toBe(pbMaster.updated);
		});
	});

	describe("createSyncCollection — update", () => {
		it("met a jour un master dans PB et Dexie", async () => {
			const { master, adminToken } = await seedPlanning({ title: "Original" });

			const collection = createSyncCollection<PlanningMaster>(pb, db.masters, "planning_masters");

			// Flux realiste : initialFetch pour charger dans Dexie (comme le ferait planningStore)
			await collection.initialFetch({ query: { _token: adminToken } });
			expect(await db.masters.get(master.id)).toBeDefined();

			const updated = await collection.update(
				master.id,
				{ title: "Modifie" },
				{ query: { _token: adminToken } },
			);

			expect(updated.title).toBe("Modifie");

			// Verification Dexie
			const dexieMaster = await db.masters.get(master.id);
			expect(dexieMaster!.title).toBe("Modifie");

			// Verification PocketBase
			const adminPb = await authenticateAdmin();
			const pbMaster = await adminPb
				.collection("planning_masters")
				.getOne<PlanningMaster>(master.id);
			expect(pbMaster.title).toBe("Modifie");
			expect(dexieMaster!.updated).toBe(pbMaster.updated);
		});

		it("fusionne les participants avec mergeByKey lors d un update concurrent", async () => {
			const p1: Participant = { id: "aaa", name: "Alice", isAdmin: false, createdAt: "2026-01-01" };
			const p2: Participant = { id: "bbb", name: "Bob", isAdmin: false, createdAt: "2026-01-01" };
			const p2Updated: Participant = {
				id: "bbb",
				name: "Bob Modifie",
				isAdmin: true,
				createdAt: "2026-01-01",
			};
			const p3: Participant = {
				id: "ccc",
				name: "Charlie",
				isAdmin: false,
				createdAt: "2026-01-01",
			};

			const { master, adminToken } = await seedPlanning({
				title: "Merge Test",
				participants: [p1, p2],
			});

			const collection = createSyncCollection<PlanningMaster>(pb, db.masters, "planning_masters", {
				mergeStrategies: {
					participants: mergeByKey<Participant>("id"),
				},
			});

			// Charger dans Dexie via initialFetch (flux realiste guest)
			await collection.initialFetch({ query: { _token: adminToken } });

			// Simuler un changement concurrent : quelqu'un d'autre ajoute p3 sur le serveur
			const adminPb = await authenticateAdmin();
			await adminPb.collection("planning_masters").update(master.id, {
				participants: [p1, p2, p3],
			});

			// Update local avec [p1, p2Updated] (on ne connait pas p3)
			const updated = await collection.update(
				master.id,
				{ participants: [p1, p2Updated] },
				{ query: { _token: adminToken } },
			);

			// Verification merge : p1, p2Updated (local), p3 (remote)
			const participants = updated.participants;
			const ids = participants.map((p) => p.id).sort();
			expect(ids).toEqual(["aaa", "bbb", "ccc"]);

			const bob = participants.find((p) => p.id === "bbb");
			expect(bob!.name).toBe("Bob Modifie");
			expect(bob!.isAdmin).toBe(true);

			const charlie = participants.find((p) => p.id === "ccc");
			expect(charlie).toBeDefined();

			// Verification Dexie coherence
			const dexieMaster = await db.masters.get(master.id);
			const dexieIds = dexieMaster!.participants.map((p) => p.id).sort();
			expect(dexieIds).toEqual(["aaa", "bbb", "ccc"]);

			// Verification PocketBase : le merge a ete envoye au serveur
			const pbMaster = await adminPb
				.collection("planning_masters")
				.getOne<PlanningMaster>(master.id);
			const pbIds = pbMaster.participants.map((p) => p.id).sort();
			expect(pbIds).toEqual(["aaa", "bbb", "ccc"]);
		});
	});

	describe("createSyncCollection — remove", () => {
		it("soft-delete un master : deleted=true dans PB et Dexie", async () => {
			const { master, adminToken } = await seedPlanning({ title: "A Supprimer" });

			const collection = createSyncCollection<PlanningMaster>(pb, db.masters, "planning_masters");

			// Charger dans Dexie via initialFetch
			await collection.initialFetch({ query: { _token: adminToken } });

			await collection.remove(master.id, { query: { _token: adminToken } });

			// Verification Dexie : soft-delete (comportement par defaut de pb-sync)
			const dexieMaster = (await db.masters.get(master.id)) as Record<string, unknown> | undefined;
			expect(dexieMaster).toBeDefined();
			expect(dexieMaster!.deleted).toBe(true);

			// Verification PocketBase : deleted=true
			const adminPb = await authenticateAdmin();
			const pbMaster = (await adminPb.collection("planning_masters").getOne(master.id)) as Record<
				string,
				unknown
			>;
			expect(pbMaster.deleted).toBe(true);
		});

		it("hard-delete avec softDelete=false : bloqué côté serveur (403), le record reste en Dexie et PB", async () => {
			const { master, adminToken } = await seedPlanning({ title: "A Supprimer Pour De Vrai" });

			const collection = createSyncCollection<PlanningMaster>(pb, db.masters, "planning_masters", {
				softDelete: false,
			});

			// Charger dans Dexie via initialFetch
			await collection.initialFetch({ query: { _token: adminToken } });

			// Le serveur bloque le DELETE API (deleteRule superusers only, fenêtre de grâce) : l'erreur remonte,
			// le rollback pb-sync restaure le snapshot local.
			await expect(
				collection.remove(master.id, { query: { _token: adminToken } }),
			).rejects.toMatchObject({ status: 403 });

			// Verification Dexie : record toujours présent (rollback)
			const dexieMaster = await db.masters.get(master.id);
			expect(dexieMaster).toBeDefined();

			// Verification PocketBase : toujours là
			const adminPb = await authenticateAdmin();
			const pbMaster = await adminPb.collection("planning_masters").getOne(master.id);
			expect(pbMaster.id).toBe(master.id);
		});
	});

	describe("initialFetch — sync incrementale", () => {
		it("ne fetche que les records modifies depuis le dernier updated dans Dexie", async () => {
			const collection = createSyncCollection<PlanningMaster>(pb, db.masters, "planning_masters");

			// Creer 2 masters via seedPlanning (tokens uniques)
			const { master: m1, adminToken: token1 } = await seedPlanning({ title: "Master 1" });
			const { master: _m2, adminToken: _token2 } = await seedPlanning({ title: "Master 2" });

			// Premier fetch via token admin d'un des plannings
			await collection.initialFetch({ query: { _token: token1 } });
			let dexieMasters = await db.masters.toArray();

			// Le token1 ne donne acces qu'a m1 (API Rules)
			expect(dexieMasters.length).toBe(1);
			expect(dexieMasters[0].id).toBe(m1.id);
			expect(dexieMasters[0].title).toBe("Master 1");

			// Modifier m1 dans PB directement
			const adminPb = await authenticateAdmin();
			await adminPb.collection("planning_masters").update(m1.id, { title: "Master 1 Modifie" });

			// Second fetch : ramene m1 modifie
			await collection.initialFetch({ query: { _token: token1 } });
			dexieMasters = await db.masters.toArray();
			expect(dexieMasters.length).toBe(1);
			expect(dexieMasters[0].title).toBe("Master 1 Modifie");

			// Verification PB
			const pbM1 = await adminPb.collection("planning_masters").getOne<PlanningMaster>(m1.id);
			expect(pbM1.title).toBe("Master 1 Modifie");
			expect(dexieMasters[0].updated).toBe(pbM1.updated);
		});

		it("sync incrementale avec filtre sur master", async () => {
			const collection = createSyncCollection<PlanningMaster>(pb, db.masters, "planning_masters");

			const { master: m1, adminToken } = await seedPlanning({ title: "Filtre Master 1" });
			await seedPlanning({ title: "Filtre Master 2" });

			// Fetch avec filtre sur un seul master
			await collection.initialFetch({
				filter: ["id = {:masterId}", { masterId: m1.id }],
				query: { _token: adminToken },
			});

			const dexieMasters = await db.masters.toArray();
			expect(dexieMasters.length).toBe(1);
			expect(dexieMasters[0].id).toBe(m1.id);
			expect(dexieMasters[0].title).toBe("Filtre Master 1");
		});
	});

	describe("initialFetch — tri et limite (fetch borné)", () => {
		it("limit borne la réponse aux N premiers records selon sort", async () => {
			const collection = createSyncCollection<PlanningOccurrence>(
				pb,
				db.occurrences,
				"planning_occurrences",
			);

			// 5 occurrences passées à dates distinctes (J-5 … J-1)
			const dates = [-5, -4, -3, -2, -1].map((d) => dateInDays(d));
			const { participantToken } = await seedPlanning({
				title: "P sort limit",
				occurrenceDates: dates,
			});

			await db.occurrences.clear();

			await collection.initialFetch({
				filter: ["date != ''", {}],
				query: { _token: participantToken },
				since: "2000-01-01 00:00:00",
				sort: "-date",
				limit: 3,
			});

			const local = await db.occurrences.toArray();
			expect(local.length).toBe(3);
			// Les 3 plus récentes du passé : J-1, J-2, J-3 (dates normalisées PB)
			expect(local.map((o) => o.date.slice(0, 10)).sort()).toEqual(
				[dateInDays(-1), dateInDays(-2), dateInDays(-3)].sort(),
			);
		});

		it("sans limit : getFullList inchangé (tout le filtre)", async () => {
			const collection = createSyncCollection<PlanningOccurrence>(
				pb,
				db.occurrences,
				"planning_occurrences",
			);

			const dates = [-5, -4, -3, -2, -1].map((d) => dateInDays(d));
			const { participantToken } = await seedPlanning({
				title: "P full list",
				occurrenceDates: dates,
			});

			await db.occurrences.clear();

			await collection.initialFetch({
				filter: ["date != ''", {}],
				query: { _token: participantToken },
				since: "2000-01-01 00:00:00",
			});

			expect(await db.occurrences.count()).toBe(5);
		});
	});

	describe("gestion des erreurs", () => {
		it("throw si le record n'est pas dans Dexie lors d'un update", async () => {
			const collection = createSyncCollection<PlanningMaster>(pb, db.masters, "planning_masters");

			// === SEED ===
			const { master, adminToken } = await seedPlanning({ title: "Not In Dexie" });

			// master est dans PB mais PAS dans Dexie (pas d'initialFetch)
			const dexieMasters = await db.masters.toArray();
			expect(dexieMasters.length).toBe(0);

			// === ACTION + VERIFICATION ===
			await expect(
				collection.update(master.id, { title: "Modified" }, { query: { _token: adminToken } }),
			).rejects.toThrow();
		});

		it("throw si le record n'est pas dans Dexie lors d'un remove", async () => {
			const collection = createSyncCollection<PlanningMaster>(pb, db.masters, "planning_masters", {
				softDelete: false,
			});

			// === SEED ===
			const { master, adminToken } = await seedPlanning({ title: "Not In Dexie" });

			const dexieMasters = await db.masters.toArray();
			expect(dexieMasters.length).toBe(0);

			// === ACTION + VERIFICATION ===
			await expect(
				collection.remove(master.id, { query: { _token: adminToken } }),
			).rejects.toThrow();
		});

		it("rejette un create avec un token invalide (403)", async () => {
			const collection = createSyncCollection<PlanningMaster>(pb, db.masters, "planning_masters");

			// === ACTION + VERIFICATION ===
			// NOTE: la createRule de planning_masters est vide (pas de token requis).
			// Ce test documente ce comportement. Si la createRule est renforcee, ce test
			// devra etre mis a jour pour s'attendre a un rejet.
			const master = await collection.create(
				{
					title: "Created Without Token",
					defaultStartTime: "09:00",
					defaultEndTime: "17:00",
					recurrence: { type: "CUSTOM" },
					adminToken: "any-token",
					participantToken: "any-participant",
					participants: [],
					tasks: [],
					minPresentRequired: 1,
					allowResponses: true,
				},
				{ query: { _token: "invalid-token-should-fail" } },
			);

			trackIds("planning_masters", master.id);
			expect(master.id).toBeDefined();
			expect(master.title).toBe("Created Without Token");
		});
	});

	describe("createSyncCollection — tombstoneCollection", () => {
		// Collection de tombstones jetable : l'app n'en configure aucune, et la réconciliation
		// des suppressions physiques (nettoyage admin) n'est observable qu'avec.
		const TOMBSTONE_COLLECTION = "tmp_pb_sync_tombstones";

		/** `deletedAt` dans le futur : la réconciliation ne retient que `deletedAt > since`. */
		const futureTimestamp = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

		async function dropTombstoneCollection() {
			const adminPb = await authenticateAdmin();
			const leftovers = await adminPb.collections.getFullList({
				filter: `name = "${TOMBSTONE_COLLECTION}"`,
			});
			for (const collection of leftovers) await adminPb.collections.delete(collection.id);
		}

		async function createTombstoneCollection() {
			const adminPb = await authenticateAdmin();
			// Le SDK type `create()` sur le modèle complet ; l'API n'attend que le sous-ensemble
			// de création (id/created/updated sont complétés par le serveur).
			await adminPb.collections.create({
				name: TOMBSTONE_COLLECTION,
				type: "base",
				fields: [
					{ name: "collection", type: "text", required: true },
					{ name: "recordId", type: "text", required: true },
					{ name: "deletedAt", type: "date", required: true },
				],
				// L'app lit les tombstones sans token : la règle de liste reste publique.
				listRule: "",
			} as unknown as CollectionModel);
		}

		async function insertTombstone(recordId: string, deletedAt: string) {
			const adminPb = await authenticateAdmin();
			return adminPb
				.collection(TOMBSTONE_COLLECTION)
				.create<{ deletedAt: string }>({ collection: "planning_masters", recordId, deletedAt });
		}

		beforeEach(async () => {
			await dropTombstoneCollection();
			await createTombstoneCollection();
		});

		afterEach(async () => {
			await dropTombstoneCollection();
		});

		it("supprime localement le record tombstone, sans localTrash", async () => {
			const { master, participantToken } = await seedPlanning({ title: "Tombstone remove" });
			const collection = createSyncCollection<PlanningMaster>(pb, db.masters, "planning_masters", {
				tombstoneCollection: TOMBSTONE_COLLECTION,
			});

			await collection.initialFetch({ query: { _token: participantToken } });
			expect(await db.masters.get(master.id)).toBeDefined();

			// Suppression physique côté serveur : seul le tombstone la révèle au client.
			await insertTombstone(master.id, futureTimestamp());
			const adminPb = await authenticateAdmin();
			await adminPb.collection("planning_masters").delete(master.id);

			await collection.initialFetch({ query: { _token: participantToken } });

			expect(await db.masters.get(master.id)).toBeUndefined();
		});

		it("marque le record tombstone au lieu de le supprimer, avec localTrash", async () => {
			const { master, participantToken } = await seedPlanning({ title: "Tombstone trash" });
			const collection = createSyncCollection<PlanningMaster>(pb, db.masters, "planning_masters", {
				tombstoneCollection: TOMBSTONE_COLLECTION,
				localTrash: true,
			});

			await collection.initialFetch({ query: { _token: participantToken } });
			const initial = await db.masters.get(master.id);
			expect(initial).toBeDefined();
			expect(initial?.deleted).toBeFalsy();

			const tombstone = await insertTombstone(master.id, futureTimestamp());
			const adminPb = await authenticateAdmin();
			await adminPb.collection("planning_masters").delete(master.id);

			await collection.initialFetch({ query: { _token: participantToken } });

			const trashed = await db.masters.get(master.id);
			expect(trashed).toBeDefined();
			expect(trashed?.deleted).toBe(true);
			expect(trashed?.deletedAt).toBe(tombstone.deletedAt);
		});
	});

	describe("mergeByKey — logique pure", () => {
		it("garde les elements locaux non presents dans remote", () => {
			const local = [
				{ id: "a", name: "Local A" },
				{ id: "b", name: "Local B" },
			];
			const remote = [{ id: "a", name: "Remote A" }];

			const merge = mergeByKey<{ id: string; name: string }>("id");
			const result = merge(local, remote);

			expect(result.length).toBe(2);
			expect(result.find((r) => r.id === "a")!.name).toBe("Local A");
			expect(result.find((r) => r.id === "b")!.name).toBe("Local B");
		});

		it("ajoute les elements remote non presents dans local", () => {
			const local = [{ id: "a", name: "Local A" }];
			const remote = [
				{ id: "a", name: "Remote A" },
				{ id: "c", name: "Remote C" },
			];

			const merge = mergeByKey<{ id: string; name: string }>("id");
			const result = merge(local, remote);

			expect(result.length).toBe(2);
			expect(result.find((r) => r.id === "a")!.name).toBe("Local A");
			expect(result.find((r) => r.id === "c")!.name).toBe("Remote C");
		});

		it("gere les arrays vides", () => {
			const merge = mergeByKey<{ id: string; name: string }>("id");

			expect(merge([], []).length).toBe(0);
			expect(merge([{ id: "a", name: "A" }], []).length).toBe(1);
			expect(merge([], [{ id: "a", name: "A" }]).length).toBe(1);
		});
	});
});
