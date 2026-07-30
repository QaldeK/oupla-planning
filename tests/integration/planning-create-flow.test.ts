/**
 * Tests d'integration — Flux de creation de planning (/new)
 *
 * Objectif :
 *   Verifier le pipeline complet de creation d'un planning depuis la route /new :
 *   FormData → createPlanningWithOccurrences → PB + Dexie
 *
 * Pipeline teste (flux reel) :
 *   1. createPlanningWithOccurrences : master create → occurrences batch → PB + Dexie
 *   2. Tokens coherence : master et occurrences partagent les memes tokens
 *   3. Auto-participant : createur connecte ajoute comme participant admin
 *   4. Recurrence : generation correcte des dates pour chaque type
 *
 * Important :
 *   - Ce fichier teste le pipeline DATA, pas le rendu UI (PlanningForm)
 *   - Les tests de validation formulaire sont unitaires, pas integration
 *   - createPlanningWithOccurrences est appele directement (simule l'appel de +page.svelte)
 *
 * Conditions reelles :
 *   - createRule de planning_masters est vide (pas de token requis)
 *   - createRule de planning_occurrences exige master.adminToken = _token (ADR-0012) ;
 *     createPlanningWithOccurrences génère l'adminToken et le forward au batch
 *   - onRecordEnrich masque adminToken pour les non-admins
 *
 * Prerequis :
 *   - PocketBase demarre sur http://127.0.0.1:8090
 *   - Admin de test cree (test@example.com / testpassword)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mastersCollection, occurrencesCollection } from "$lib/data/collections";
import { db } from "$lib/pb-sync/db";
import { pb } from "$lib/pocketbase/pb";
import {
	createPlanningWithOccurrences,
	generateAdminToken,
	generateParticipantToken
} from "$lib/services/planningActions";
import { planningStore } from "$lib/stores/planningStore.svelte";
import { userStore } from "$lib/stores/userStore.svelte";
import type {
	OccurrenceTarget,
	Participant,
	PlanningMaster,
	RecurrenceConfig
} from "$lib/types/planning.types";
import { generateRecurrenceDates } from "$lib/utils/recurrence";
import {
	authenticateAdmin,
	authenticateUser,
	cleanupTrackedRecords,
	clearTrackedIds,
	seedUser,
	trackIds
} from "./seed";

// Helper: normalise les dates PB (format 'YYYY-MM-DD HH:mm:ss.SSSZ') en 'YYYY-MM-DD'
function normalizeDate(dateStr: string): string {
	return dateStr.split(" ")[0];
}

// Helper: construit les occurrenceTargets depuis une config de récurrence (mono-slot s1).
// Reflète la logique de génération du formulaire PlanningForm.
function buildTargetsFromRecurrence(
	recurrence: RecurrenceConfig,
	startTime: string,
	endTime: string,
	slotId = "s1"
): OccurrenceTarget[] {
	return generateRecurrenceDates(recurrence).map((date) => ({ date, startTime, endTime, slotId }));
}

describe("Planning Create Flow — /new", () => {
	beforeEach(async () => {
		clearTrackedIds();
		await db.masters.clear();
		await db.occurrences.clear();
		await db.localMeta.clear();
		await db.commentState.clear();
	});

	afterEach(async () => {
		mastersCollection.unsubscribeAll();
		occurrencesCollection.unsubscribeAll();
		await cleanupTrackedRecords();
	});

	describe("P0 — Creation complete + post-creation pipeline", () => {
		it("cree un planning et verifie le retour + Dexie master", async () => {
			// === SEED ===
			const adminToken = generateAdminToken();
			const participantToken = generateParticipantToken();
			const expectedDates = ["2026-06-01", "2026-06-08", "2026-06-15"];

			// === ACTION ===
			const master = await createPlanningWithOccurrences(
				{
					title: "Mon Planning Complet",
					description: "Description de test",
					place: "Salle A",
					defaultStartTime: "10:00",
					defaultEndTime: "12:00",
					recurrence: { type: "CUSTOM" },
					occurrenceTargets: expectedDates.map((date) => ({
						date,
						startTime: "10:00",
						endTime: "12:00",
						slotId: "s1"
					})),
					minPresentRequired: 3,
					allowResponses: true,
					availableResponseTypes: ["present", "absent", "maybe"],
					participants: []
				},
				adminToken,
				participantToken
			);

			trackIds("planning_masters", master.id);

			// === VERIFICATION — Valeur de retour ===
			expect(master.id).toBeDefined();
			expect(master.title).toBe("Mon Planning Complet");
			expect(master.description).toBe("Description de test");
			expect(master.place).toBe("Salle A");
			expect(master.defaultStartTime).toBe("10:00");
			expect(master.defaultEndTime).toBe("12:00");
			expect(master.minPresentRequired).toBe(3);

			// === VERIFICATION — Dexie master ===
			const dexieMaster = await db.masters.get(master.id);
			expect(dexieMaster).toBeDefined();
			expect(dexieMaster!.title).toBe("Mon Planning Complet");
			expect(dexieMaster!.participants).toHaveLength(0);

			// === VERIFICATION — Dexie occurrences ===
			const dexieOccurrences = await db.occurrences.where("master").equals(master.id).toArray();
			expect(dexieOccurrences.length).toBe(3);

			const dexieDates = dexieOccurrences.map((o) => normalizeDate(o.date)).sort();
			expect(dexieDates).toEqual([...expectedDates].sort());

			// Tracker les occurrences pour cleanup
			for (const occ of dexieOccurrences) {
				trackIds("planning_occurrences", occ.id);
			}
		});

		it("verifie la coherence PocketBase apres creation", async () => {
			// === SEED ===
			const adminToken = generateAdminToken();
			const participantToken = generateParticipantToken();
			const expectedDates = ["2026-06-01", "2026-06-08", "2026-06-15"];

			// === ACTION ===
			const master = await createPlanningWithOccurrences(
				{
					title: "PB Coherence Test",
					defaultStartTime: "09:00",
					defaultEndTime: "17:00",
					recurrence: { type: "CUSTOM" },
					occurrenceTargets: expectedDates.map((date) => ({
						date,
						startTime: "09:00",
						endTime: "17:00",
						slotId: "s1"
					})),
					minPresentRequired: 1,
					allowResponses: true,
					participants: []
				},
				adminToken,
				participantToken
			);

			trackIds("planning_masters", master.id);

			// === VERIFICATION — PocketBase master ===
			const adminPb = await authenticateAdmin();
			const pbMaster = await adminPb
				.collection("planning_masters")
				.getOne<PlanningMaster>(master.id);
			expect(pbMaster.title).toBe("PB Coherence Test");
			expect(pbMaster.adminToken).toBe(adminToken);
			expect(pbMaster.participantToken).toBe(participantToken);

			// === VERIFICATION — PocketBase occurrences ===
			const pbOccurrences = await adminPb
				.collection("planning_occurrences")
				.getFullList({ filter: `master = "${master.id}"` });
			expect(pbOccurrences.length).toBe(3);

			const pbDates = pbOccurrences.map((o) => normalizeDate(o.date)).sort();
			expect(pbDates).toEqual([...expectedDates].sort());

			// Tracker les occurrences pour cleanup
			for (const occ of pbOccurrences) {
				trackIds("planning_occurrences", occ.id);
			}

			// === VERIFICATION — Coherence Dexie <-> PB ===
			const dexieMaster = await db.masters.get(master.id);
			expect(dexieMaster!.updated).toBe(pbMaster.updated);

			const dexieOccurrences = await db.occurrences.where("master").equals(master.id).toArray();
			const dexieOccMap = new Map(dexieOccurrences.map((o) => [o.date, o]));
			for (const pbOcc of pbOccurrences) {
				const dexieOcc = dexieOccMap.get(pbOcc.date);
				expect(dexieOcc).toBeDefined();
				expect(dexieOcc!.updated).toBe(pbOcc.updated);
			}
		});

		it("ajoute le createur connecte comme participant admin", async () => {
			// === SEED ===
			const testEmail = "creator@test.com";
			const testPwd = "password123";
			const user = await seedUser(testEmail, testPwd, "Createur Test");
			const _userPb = await authenticateUser(testEmail, testPwd);

			const adminToken = generateAdminToken();
			const participantToken = generateParticipantToken();

			// Preparer le participant comme le ferait +page.svelte
			const creatorParticipant: Participant = {
				id: user.id,
				name: "Createur Test",
				isAdmin: true,
				createdAt: new Date().toISOString()
			};

			// === ACTION ===
			const master = await createPlanningWithOccurrences(
				{
					title: "Planning avec Createur",
					defaultStartTime: "09:00",
					defaultEndTime: "17:00",
					recurrence: { type: "CUSTOM" },
					occurrenceTargets: [
						{ date: "2026-07-01", startTime: "09:00", endTime: "17:00", slotId: "s1" }
					],
					minPresentRequired: 1,
					allowResponses: true,
					participants: [creatorParticipant]
				},
				adminToken,
				participantToken
			);

			trackIds("planning_masters", master.id);

			// === VERIFICATION — Valeur de retour ===
			expect(master.participants).toHaveLength(1);
			expect(master.participants[0].id).toBe(user.id);
			expect(master.participants[0].name).toBe("Createur Test");
			expect(master.participants[0].isAdmin).toBe(true);

			// === VERIFICATION — Dexie ===
			const dexieMaster = await db.masters.get(master.id);
			expect(dexieMaster!.participants).toHaveLength(1);
			expect(dexieMaster!.participants[0].id).toBe(user.id);
			expect(dexieMaster!.participants[0].isAdmin).toBe(true);

			// === VERIFICATION — PocketBase ===
			const adminPb = await authenticateAdmin();
			const pbMaster = await adminPb
				.collection("planning_masters")
				.getOne<PlanningMaster>(master.id);
			expect(pbMaster.participants).toHaveLength(1);
			expect(pbMaster.participants[0].id).toBe(user.id);

			// Coherence timestamps
			expect(dexieMaster!.updated).toBe(pbMaster.updated);

			// Cleanup user
			trackIds("users", user.id);
		});

		it("genere les occurrences correctes pour WEEKLY (6 semaines)", async () => {
			// === SEED ===
			const adminToken = generateAdminToken();
			const participantToken = generateParticipantToken();
			const firstDate = "2026-06-01";
			const lastDate = "2026-07-06";

			const recurrence = {
				type: "WEEKLY" as const,
				firstDate,
				lastDate
			};

			// Calculer les dates attendues
			const expectedDates = generateRecurrenceDates(recurrence);
			// === ACTION ===
			const master = await createPlanningWithOccurrences(
				{
					title: "Weekly Planning",
					defaultStartTime: "14:00",
					defaultEndTime: "16:00",
					recurrence,
					occurrenceTargets: buildTargetsFromRecurrence(recurrence, "14:00", "16:00"),
					minPresentRequired: 1,
					allowResponses: true,
					participants: []
				},
				adminToken,
				participantToken
			);

			trackIds("planning_masters", master.id);

			// === VERIFICATION — Occurrences creees ===
			const dexieOccurrences = await db.occurrences.where("master").equals(master.id).toArray();
			expect(dexieOccurrences.length).toBe(expectedDates.length);

			for (const occ of dexieOccurrences) {
				trackIds("planning_occurrences", occ.id);
			}

			const dexieDates = dexieOccurrences.map((o) => normalizeDate(o.date)).sort();
			const expectedSorted = [...expectedDates].sort();
			expect(dexieDates).toEqual(expectedSorted);

			// === VERIFICATION — PocketBase ===
			const adminPb = await authenticateAdmin();
			const pbOccurrences = await adminPb
				.collection("planning_occurrences")
				.getFullList({ filter: `master = "${master.id}"` });
			expect(pbOccurrences.length).toBe(expectedDates.length);

			const pbDates = pbOccurrences.map((o) => normalizeDate(o.date)).sort();
			expect(pbDates).toEqual(expectedSorted);
		});

		it("genere les occurrences correctes pour BIWEEKLY (3 quinzaines)", async () => {
			// === SEED ===
			const adminToken = generateAdminToken();
			const participantToken = generateParticipantToken();
			const firstDate = "2026-06-01";
			const lastDate = "2026-07-13";

			const recurrence = {
				type: "BIWEEKLY" as const,
				firstDate,
				lastDate
			};

			const expectedDates = generateRecurrenceDates(recurrence);

			// === ACTION ===
			const master = await createPlanningWithOccurrences(
				{
					title: "Biweekly Planning",
					defaultStartTime: "10:00",
					defaultEndTime: "12:00",
					recurrence,
					occurrenceTargets: buildTargetsFromRecurrence(recurrence, "10:00", "12:00"),
					minPresentRequired: 1,
					allowResponses: true,
					participants: []
				},
				adminToken,
				participantToken
			);

			trackIds("planning_masters", master.id);

			// === VERIFICATION ===
			const dexieOccurrences = await db.occurrences.where("master").equals(master.id).toArray();
			expect(dexieOccurrences.length).toBe(expectedDates.length);

			for (const occ of dexieOccurrences) {
				trackIds("planning_occurrences", occ.id);
			}

			const dexieDates = dexieOccurrences.map((o) => normalizeDate(o.date)).sort();
			expect(dexieDates).toEqual([...expectedDates].sort());
		});

		it("genere les occurrences correctes pour MONTHLY_BY_DATE (3 mois)", async () => {
			// === SEED ===
			const adminToken = generateAdminToken();
			const participantToken = generateParticipantToken();
			const firstDate = "2026-06-15";
			const lastDate = "2026-08-15";

			const recurrence = {
				type: "MONTHLY_BY_DATE" as const,
				firstDate,
				lastDate
			};

			const expectedDates = generateRecurrenceDates(recurrence);

			// === ACTION ===
			const master = await createPlanningWithOccurrences(
				{
					title: "Monthly by Date Planning",
					defaultStartTime: "09:00",
					defaultEndTime: "17:00",
					recurrence,
					occurrenceTargets: buildTargetsFromRecurrence(recurrence, "09:00", "17:00"),
					minPresentRequired: 1,
					allowResponses: true,
					participants: []
				},
				adminToken,
				participantToken
			);

			trackIds("planning_masters", master.id);

			// === VERIFICATION ===
			const dexieOccurrences = await db.occurrences.where("master").equals(master.id).toArray();
			expect(dexieOccurrences.length).toBe(expectedDates.length);

			for (const occ of dexieOccurrences) {
				trackIds("planning_occurrences", occ.id);
			}

			const dexieDates = dexieOccurrences.map((o) => normalizeDate(o.date)).sort();
			expect(dexieDates).toEqual([...expectedDates].sort());
		});

		it("genere les occurrences correctes pour MONTHLY_BY_DAY (3 mois, 2eme lundi)", async () => {
			// === SEED ===
			const adminToken = generateAdminToken();
			const participantToken = generateParticipantToken();
			const firstDate = "2026-06-01";
			const lastDate = "2026-08-31";

			const recurrence = {
				type: "MONTHLY_BY_DAY" as const,
				firstDate,
				lastDate,
				monthlyByDayOccurrences: [2]
			};

			const expectedDates = generateRecurrenceDates(recurrence);

			// === ACTION ===
			const master = await createPlanningWithOccurrences(
				{
					title: "Monthly by Day Planning",
					defaultStartTime: "14:00",
					defaultEndTime: "18:00",
					recurrence,
					occurrenceTargets: buildTargetsFromRecurrence(recurrence, "14:00", "18:00"),
					minPresentRequired: 1,
					allowResponses: true,
					participants: []
				},
				adminToken,
				participantToken
			);

			trackIds("planning_masters", master.id);

			// === VERIFICATION ===
			const dexieOccurrences = await db.occurrences.where("master").equals(master.id).toArray();
			expect(dexieOccurrences.length).toBe(expectedDates.length);

			for (const occ of dexieOccurrences) {
				trackIds("planning_occurrences", occ.id);
			}

			const dexieDates = dexieOccurrences.map((o) => normalizeDate(o.date)).sort();
			expect(dexieDates).toEqual([...expectedDates].sort());
		});
	});

	describe("P0 — Tokens coherence", () => {
		it("les tokens du master sont sauvegardés (les occurrences n ont plus de tokens)", async () => {
			// === SEED ===
			const adminToken = generateAdminToken();
			const participantToken = generateParticipantToken();

			// === ACTION ===
			const master = await createPlanningWithOccurrences(
				{
					title: "Token Coherence Test",
					defaultStartTime: "09:00",
					defaultEndTime: "17:00",
					recurrence: { type: "CUSTOM" },
					occurrenceTargets: [
						{ date: "2026-06-01", startTime: "09:00", endTime: "17:00", slotId: "s1" },
						{ date: "2026-06-08", startTime: "09:00", endTime: "17:00", slotId: "s1" }
					],
					minPresentRequired: 1,
					allowResponses: true,
					participants: []
				},
				adminToken,
				participantToken
			);

			trackIds("planning_masters", master.id);

			// === VERIFICATION — PocketBase master tokens (superuser voit tout) ===
			const adminPb = await authenticateAdmin();
			const pbMaster = await adminPb
				.collection("planning_masters")
				.getOne<PlanningMaster>(master.id);
			expect(pbMaster.adminToken).toBe(adminToken);
			expect(pbMaster.participantToken).toBe(participantToken);

			// === VERIFICATION — PocketBase occurrences n ont PAS de tokens ===
			const pbOccurrences = await adminPb
				.collection("planning_occurrences")
				.getFullList({ filter: `master = "${master.id}"` });
			expect(pbOccurrences.length).toBe(2);

			for (const pbOcc of pbOccurrences) {
				trackIds("planning_occurrences", pbOcc.id);
				expect((pbOcc as any).adminToken).toBeUndefined();
				expect((pbOcc as any).participantToken).toBeUndefined();
			}

			// === VERIFICATION — Dexie occurrences créées ===
			const dexieOccurrences = await db.occurrences.where("master").equals(master.id).toArray();
			expect(dexieOccurrences.length).toBe(2);
		});
	});

	describe("P1 — Securite post-creation", () => {
		it("un participant ne peut PAS voir adminToken apres creation", async () => {
			// === SEED ===
			const adminToken = generateAdminToken();
			const participantToken = generateParticipantToken();

			const master = await createPlanningWithOccurrences(
				{
					title: "Security Test",
					defaultStartTime: "09:00",
					defaultEndTime: "17:00",
					recurrence: { type: "CUSTOM" },
					occurrenceTargets: [
						{ date: "2026-06-01", startTime: "09:00", endTime: "17:00", slotId: "s1" }
					],
					minPresentRequired: 1,
					allowResponses: true,
					participants: []
				},
				adminToken,
				participantToken
			);

			trackIds("planning_masters", master.id);

			// === ACTION ===
			// Fetch avec participantToken via un client guest
			const { pb } = await import("$lib/pocketbase/pb");
			const guestMaster = await pb
				.collection("planning_masters")
				.getFirstListItem<PlanningMaster>(`participantToken = "${participantToken}"`, {
					query: { _token: participantToken }
				});

			// Tracker les occurrences pour cleanup
			const guestOccurrences = await pb.collection("planning_occurrences").getFullList({
				filter: `master = "${master.id}"`,
				query: { _token: participantToken }
			});
			for (const occ of guestOccurrences) {
				trackIds("planning_occurrences", occ.id);
			}

			// === VERIFICATION ===
			expect(guestMaster.adminToken).toBeUndefined();
			expect(guestMaster.participantToken).toBe(participantToken);
			expect(guestMaster.title).toBe("Security Test");

			// Verifier que les occurrences sont accessibles et n ont pas de tokens
			expect(guestOccurrences.length).toBe(1);
			expect((guestOccurrences[0] as any).adminToken).toBeUndefined();
			expect((guestOccurrences[0] as any).participantToken).toBeUndefined();
		});

		it("le master et son batch d'occurrences sont créés via les tokens générés localement", async () => {
			// createPlanningWithOccurrences génère adminToken/participantToken localement,
			// crée le master, puis forward l'adminToken au batch d'occurrences (createRule
			// de planning_occurrences exige master.adminToken = _token, ADR-0012).

			// === ACTION ===
			const master = await createPlanningWithOccurrences({
				title: "No Token Creation",
				defaultStartTime: "10:00",
				defaultEndTime: "12:00",
				recurrence: { type: "CUSTOM" },
				occurrenceTargets: [
					{ date: "2026-06-01", startTime: "10:00", endTime: "12:00", slotId: "s1" }
				],
				minPresentRequired: 1,
				allowResponses: true,
				participants: []
			});

			trackIds("planning_masters", master.id);

			// === VERIFICATION ===
			expect(master.id).toBeDefined();
			expect(master.title).toBe("No Token Creation");

			// Occurrences creees
			const adminPb = await authenticateAdmin();
			const occurrences = await adminPb
				.collection("planning_occurrences")
				.getFullList({ filter: `master = "${master.id}"` });
			expect(occurrences.length).toBe(1);

			for (const occ of occurrences) {
				trackIds("planning_occurrences", occ.id);
			}
		});
	});

	describe("P2 — Robustesse", () => {
		it("ne cree aucune occurrence si occurrenceTargets est absent", async () => {
			// === ACTION ===
			const master = await createPlanningWithOccurrences({
				title: "Empty Recurrence",
				defaultStartTime: "09:00",
				defaultEndTime: "17:00",
				recurrence: { type: "CUSTOM" },
				minPresentRequired: 1,
				allowResponses: true,
				participants: []
			});

			trackIds("planning_masters", master.id);

			// === VERIFICATION ===
			const dexieOccurrences = await db.occurrences.where("master").equals(master.id).toArray();
			expect(dexieOccurrences.length).toBe(0);

			const adminPb = await authenticateAdmin();
			const pbOccurrences = await adminPb
				.collection("planning_occurrences")
				.getFullList({ filter: `master = "${master.id}"` });
			expect(pbOccurrences.length).toBe(0);
		});

		it("crée un planning avec 100 occurrences (limite max)", async () => {
			// === SEED ===
			const adminToken = generateAdminToken();
			const participantToken = generateParticipantToken();
			const customDates: string[] = [];
			for (let i = 0; i < 100; i++) {
				const d = new Date("2026-06-01");
				d.setDate(d.getDate() + i * 7);
				customDates.push(d.toISOString().split("T")[0]);
			}

			// === ACTION ===
			const master = await createPlanningWithOccurrences(
				{
					title: "Max Occurrences",
					defaultStartTime: "09:00",
					defaultEndTime: "17:00",
					recurrence: { type: "CUSTOM" },
					occurrenceTargets: customDates.map((date) => ({
						date,
						startTime: "09:00",
						endTime: "17:00",
						slotId: "s1"
					})),
					minPresentRequired: 1,
					allowResponses: true,
					participants: []
				},
				adminToken,
				participantToken
			);

			trackIds("planning_masters", master.id);

			// === VERIFICATION — Dexie ===
			const dexieOccurrences = await db.occurrences.where("master").equals(master.id).toArray();
			expect(dexieOccurrences.length).toBe(100);

			for (const occ of dexieOccurrences) {
				trackIds("planning_occurrences", occ.id);
			}

			// === VERIFICATION — PocketBase ===
			const adminPb = await authenticateAdmin();
			const pbOccurrences = await adminPb
				.collection("planning_occurrences")
				.getFullList({ filter: `master = "${master.id}"` });
			expect(pbOccurrences.length).toBe(100);

			// === VERIFICATION — Coherence ===
			const dexieDates = new Set(dexieOccurrences.map((o) => o.date));
			const pbDates = new Set(pbOccurrences.map((o) => o.date));
			expect(dexieDates).toEqual(pbDates);
		});

		it("crée un planning avec des tâches triées par type", async () => {
			// === SEED ===
			const adminToken = generateAdminToken();
			const participantToken = generateParticipantToken();

			// === ACTION ===
			const master = await createPlanningWithOccurrences(
				{
					title: "Tasks Sorted",
					defaultStartTime: "09:00",
					defaultEndTime: "17:00",
					recurrence: { type: "CUSTOM" },
					occurrenceTargets: [
						{ date: "2026-06-01", startTime: "09:00", endTime: "17:00", slotId: "s1" }
					],
					minPresentRequired: 1,
					allowResponses: true,
					participants: [],
					tasks: [
						{ id: "t3", name: "After", description: "", requiredVolunteers: 1, type: "afterEvent" },
						{
							id: "t1",
							name: "Before",
							description: "",
							requiredVolunteers: 1,
							type: "beforeEvent"
						},
						{ id: "t2", name: "During", description: "", requiredVolunteers: 2, type: "onEvent" }
					]
				},
				adminToken,
				participantToken
			);

			trackIds("planning_masters", master.id);

			// === VERIFICATION ===
			expect(master.tasks).toHaveLength(3);
			expect(master.tasks![0].type).toBe("beforeEvent");
			expect(master.tasks![1].type).toBe("onEvent");
			expect(master.tasks![2].type).toBe("afterEvent");

			// Coherence PB
			const adminPb = await authenticateAdmin();
			const pbMaster = await adminPb
				.collection("planning_masters")
				.getOne<PlanningMaster>(master.id);
			expect(pbMaster.tasks![0].type).toBe("beforeEvent");
			expect(pbMaster.tasks![1].type).toBe("onEvent");
			expect(pbMaster.tasks![2].type).toBe("afterEvent");
		});

		it("crée un planning avec availableResponseTypes normalises (tries)", async () => {
			// === SEED ===
			const adminToken = generateAdminToken();
			const participantToken = generateParticipantToken();

			// === ACTION ===
			const master = await createPlanningWithOccurrences(
				{
					title: "Response Types Sorted",
					defaultStartTime: "09:00",
					defaultEndTime: "17:00",
					recurrence: { type: "CUSTOM" },
					minPresentRequired: 1,
					allowResponses: true,
					availableResponseTypes: ["absent", "maybe", "if_needed", "present"],
					participants: []
				},
				adminToken,
				participantToken
			);

			trackIds("planning_masters", master.id);

			// === VERIFICATION ===
			expect(master.availableResponseTypes).toEqual(["present", "if_needed", "maybe", "absent"]);

			// Coherence PB
			const adminPb = await authenticateAdmin();
			const pbMaster = await adminPb
				.collection("planning_masters")
				.getOne<PlanningMaster>(master.id);
			expect(pbMaster.availableResponseTypes).toEqual(["present", "if_needed", "maybe", "absent"]);
		});
	});

	describe("P0 — adminToken persistence in Dexie après création", () => {
		it("adminToken persiste dans Dexie pour un guest après création + setActiveToken", async () => {
			// === SEED ===
			const adminToken = generateAdminToken();
			const participantToken = generateParticipantToken();

			// S'assurer que userStore est en mode guest
			pb.authStore.clear();
			userStore.isLoggedIn = false;

			// === ACTION — Création (simule /new) ===
			const master = await createPlanningWithOccurrences(
				{
					title: "Guest AdminToken Test",
					defaultStartTime: "09:00",
					defaultEndTime: "17:00",
					recurrence: { type: "CUSTOM" },
					minPresentRequired: 1,
					allowResponses: true,
					participants: []
				},
				adminToken,
				participantToken
			);

			trackIds("planning_masters", master.id);

			// === VERIFICATION — Après création seule ===
			const dexieMasterAfterCreate = await db.masters.get(master.id);
			expect(dexieMasterAfterCreate).toBeDefined();
			expect(dexieMasterAfterCreate!.adminToken).toBe(adminToken);

			// === ACTION — setActiveToken (simule la redirection vers /p/participantToken) ===
			await planningStore.setActiveToken(participantToken);

			// === VERIFICATION — Après setActiveToken (le flux réel en navigateur) ===
			const dexieMasterAfterSetActive = await db.masters.get(master.id);
			expect(dexieMasterAfterSetActive).toBeDefined();
			expect(dexieMasterAfterSetActive!.adminToken).toBe(adminToken);
			expect(dexieMasterAfterSetActive!.participantToken).toBe(participantToken);

			// Cleanup
			const occs = await db.occurrences.where("master").equals(master.id).toArray();
			for (const occ of occs) trackIds("planning_occurrences", occ.id);
		});

		it("adminToken persiste dans Dexie pour un user auth après création", async () => {
			// === SEED — User auth ===
			const testEmail = "authtest-creator@test.com";
			const testPwd = "password123";
			const user = await seedUser(testEmail, testPwd, "Auth Creator");
			const userPb = await authenticateUser(testEmail, testPwd);

			// Injecter l'auth dans le singleton pb
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);
			userStore.isLoggedIn = true;

			const adminToken = generateAdminToken();
			const participantToken = generateParticipantToken();

			const creatorParticipant: Participant = {
				id: user.id,
				name: "Auth Creator",
				isAdmin: true,
				createdAt: new Date().toISOString()
			};

			// === ACTION — Création (simule /new) ===
			const master = await createPlanningWithOccurrences(
				{
					title: "Auth AdminToken Test",
					defaultStartTime: "09:00",
					defaultEndTime: "17:00",
					recurrence: { type: "CUSTOM" },
					minPresentRequired: 1,
					allowResponses: true,
					participants: [creatorParticipant]
				},
				adminToken,
				participantToken
			);

			trackIds("planning_masters", master.id);
			trackIds("users", user.id);

			// === VERIFICATION — Dexie a l'adminToken ===
			const dexieMaster = await db.masters.get(master.id);
			expect(dexieMaster).toBeDefined();
			expect(dexieMaster!.adminToken).toBe(adminToken);
			expect(dexieMaster!.participantToken).toBe(participantToken);

			// === VERIFICATION — PocketBase a l'adminToken (via superuser) ===
			const adminPb = await authenticateAdmin();
			const pbMaster = await adminPb
				.collection("planning_masters")
				.getOne<PlanningMaster>(master.id);
			expect(pbMaster.adminToken).toBe(adminToken);

			// Reset auth
			pb.authStore.clear();
			userStore.isLoggedIn = false;
		});
	});
});
