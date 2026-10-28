/**
 * Tests d'intégration — token porté par les écritures du planning actif.
 *
 * Un planning a deux tokens (ADR 0001) et le rôle de l'acteur se lit dans le
 * cache local, pas dans l'URL : un appareil qui détient l'`adminToken`
 * (`onRecordEnrich` le masque côté API, `upsertRecord` le préserve en Dexie)
 * affiche les affordances admin même derrière un lien participant. Ses écritures
 * doivent partir en admin — sinon le hook serveur refuse les champs admin-only
 * d'une occurrence (403 « Participants can only update responses, comments, and
 * tasks. »).
 *
 * Prérequis : PocketBase jetable (docs/agents/integration-tests.md).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mastersCollection, occurrencesCollection } from "$lib/data/collections";
import { db } from "$lib/pb-sync/db";
import { setActivePlanningToken } from "$lib/services/activePlanningContext";
import {
	createPlanningWithOccurrences,
	deletePlanning,
	restorePlanning,
	updateOccurrence,
} from "$lib/services/planningMutations";
import type { PlanningOccurrence } from "$lib/types/planning.types";
import { generateAdminToken, generateParticipantToken } from "$lib/utils/tokens";
import {
	authenticateAdmin,
	cleanupTrackedRecords,
	clearTrackedIds,
	dateInDays,
	trackIds,
} from "./seed";

/** Crée un planning porteur d'une occurrence, via pb-sync (PB + Dexie). */
async function createPlanningWithOneOccurrence(title: string) {
	const adminToken = generateAdminToken();
	const participantToken = generateParticipantToken();

	const master = await createPlanningWithOccurrences(
		{
			title,
			defaultStartTime: "19:00",
			defaultEndTime: "21:00",
			recurrence: { type: "CUSTOM" },
			minPresentRequired: 1,
			allowResponses: true,
			occurrenceTargets: [
				{ date: dateInDays(7), startTime: "19:00", endTime: "21:00", slotId: "s1" },
			],
		},
		adminToken,
		participantToken,
	);
	trackIds("planning_masters", master.id);

	const adminPb = await authenticateAdmin();
	const occurrences = await adminPb
		.collection("planning_occurrences")
		.getFullList<PlanningOccurrence>({ filter: `master = "${master.id}"` });
	trackIds("planning_occurrences", ...occurrences.map((o) => o.id));

	return { master, occurrence: occurrences[0], participantToken };
}

describe("Token des écritures — capacité détenue localement vs token de la page", () => {
	beforeEach(async () => {
		clearTrackedIds();
		await db.masters.clear();
		await db.occurrences.clear();
		await db.localMeta.clear();
	});

	afterEach(async () => {
		mastersCollection.unsubscribeAll();
		occurrencesCollection.unsubscribeAll();
		await cleanupTrackedRecords();
	});

	it("annule l'occurrence depuis un lien participant quand l'appareil détient l'adminToken", async () => {
		const { master, occurrence, participantToken } = await createPlanningWithOneOccurrence(
			"Lien participant sur un appareil admin",
		);

		// Précondition : l'appareil détient l'adminToken en cache local (c'est ce que
		// l'UI lit pour afficher les affordances admin) alors que la page visitée est
		// le lien participant.
		expect((await db.masters.get(master.id))?.adminToken).toBeTruthy();
		setActivePlanningToken(participantToken);

		const updated = await updateOccurrence(occurrence.id, { isCanceled: true });

		expect(updated.isCanceled).toBe(true);

		const adminPb = await authenticateAdmin();
		const pbOccurrence = await adminPb
			.collection("planning_occurrences")
			.getOne<PlanningOccurrence>(occurrence.id);
		expect(pbOccurrence.isCanceled).toBe(true);
	});

	it("refuse toujours l'annulation depuis un appareil qui n'a que le lien participant", async () => {
		const { master, occurrence, participantToken } =
			await createPlanningWithOneOccurrence("Lien participant seul");

		// Appareil qui n'a jamais vu l'adminToken : le master est rechargé via le token
		// participant, donc sans adminToken (masqué par onRecordEnrich).
		await db.masters.clear();
		await mastersCollection.initialFetch({ query: { _token: participantToken } });
		expect((await db.masters.get(master.id))?.adminToken).toBeFalsy();

		setActivePlanningToken(participantToken);

		await expect(updateOccurrence(occurrence.id, { isCanceled: true })).rejects.toThrow();

		const adminPb = await authenticateAdmin();
		const pbOccurrence = await adminPb
			.collection("planning_occurrences")
			.getOne<PlanningOccurrence>(occurrence.id);
		expect(pbOccurrence.isCanceled).toBe(false);
	});

	it("restaure un planning supprimé depuis un lien participant quand l'appareil détient l'adminToken", async () => {
		const { master, participantToken } = await createPlanningWithOneOccurrence(
			"Restauration depuis un lien participant",
		);
		setActivePlanningToken(participantToken);

		await deletePlanning(master.id, master.updated);
		const deletedMaster = await db.masters.get(master.id);
		expect(deletedMaster?.deleted).toBe(true);

		// Le soft-delete a avancé `updated` : l'OCC de la restauration attend cette version.
		await restorePlanning(master.id, deletedMaster!.updated);

		const adminPb = await authenticateAdmin();
		const pbMaster = (await adminPb.collection("planning_masters").getOne(master.id)) as Record<
			string,
			unknown
		>;
		expect(pbMaster.deleted).toBe(false);
		expect(pbMaster.deletedAt).toBe("");
	});
});
