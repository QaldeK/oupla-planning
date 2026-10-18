/**
 * Tests d'intégration — Robustesse de la synchronisation inter-clients
 *
 * L'ancien delta-sync (curseur client `lastFetchAt` comparé à `updated`
 * serveur) ratait silencieusement les writes du jour et ne se réparait jamais :
 * causes et récit dans ADR 0017. Ces tests verrouillent le design remplacé :
 * re-sync de routine = fetch complet borné `date >= J-2` ; archive = fetch à
 * la demande borné au passé récent.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { occurrencesCollection } from "$lib/data/collections";
import { db, upsertLocalMeta } from "$lib/pb-sync/db";
import { planningStore } from "$lib/stores/planningStore.svelte";
import type { PlanningOccurrence } from "$lib/types/planning.types";
import { cleanupTrackedRecords, clearTrackedIds, dateInDays, seedPlanning } from "./seed";

/** Client distant (l'autre participant) : write direct via l'API, hors Dexie local. */
async function remoteWriteResponses(occId: string, token: string) {
	const { pb } = await import("$lib/pocketbase/pb");
	return pb
		.collection("planning_occurrences")
		.update<PlanningOccurrence>(
			occId,
			{ responses: [{ participantId: "participant-A", response: "present" }] },
			{ query: { _token: token } }
		);
}

async function remoteAddComment(occId: string, token: string) {
	const { pb } = await import("$lib/pocketbase/pb");
	return pb
		.collection("planning_occurrences")
		.update<PlanningOccurrence>(
			occId,
			{ comments: [{ id: "c-remote", participantId: "participant-A", text: "vu sur place" }] },
			{ query: { _token: token } }
		);
}

describe("resync de routine — fenêtre date, sans curseur", () => {
	beforeEach(async () => {
		clearTrackedIds();
		await db.masters.clear();
		await db.occurrences.clear();
		await db.localMeta.clear();
		planningStore.destroy();
	});

	afterEach(async () => {
		occurrencesCollection.unsubscribeAll();
		await cleanupTrackedRecords();
	});

	it("rattrape un write du jour effectué après l'activation (scénario du bug)", async () => {
		const { occurrences, participantToken } = await seedPlanning({
			title: "P write du jour",
			occurrenceCount: 2
		});

		// Activation locale (fetch initial) puis write distant
		await planningStore.setActiveToken(participantToken);
		await remoteWriteResponses(occurrences[0].id, participantToken);

		// Re-sync de routine (même signal que visibilitychange / reconnexion SSE)
		await planningStore.refreshActive();

		const local = await db.occurrences.get(occurrences[0].id);
		expect(local?.responses).toHaveLength(1);
	});

	it("un lastFetchAt persisté corrompu (horloge déréglée, ancienne version) ne bloque plus le rattrapage", async () => {
		const { master, occurrences, participantToken } = await seedPlanning({
			title: "P curseur corrompu",
			occurrenceCount: 2
		});

		await planningStore.setActiveToken(participantToken);

		// Simule un client dont l'horloge avance de 5 min (curseur persisté par
		// l'ancienne implémentation, au format JS ISO)
		const skewed = new Date(Date.now() + 5 * 60 * 1000).toISOString();
		await upsertLocalMeta(master.id, { lastFetchAt: skewed });

		await remoteWriteResponses(occurrences[0].id, participantToken);
		await planningStore.refreshActive();

		const local = await db.occurrences.get(occurrences[0].id);
		expect(local?.responses).toHaveLength(1);
	});

	it("la fenêtre de routine exclut les vieilles occurrences jamais vues (elles relèvent de l'archive)", async () => {
		const { master, participantToken, adminToken } = await seedPlanning({
			title: "P fenêtres",
			occurrenceDates: [dateInDays(7)]
		});

		await planningStore.setActiveToken(participantToken);

		// Simule une SSE morte : sans elle, le realtime propagerait le create
		// avant la re-sync et le test ne porterait plus sur la fenêtre.
		occurrencesCollection.unsubscribeAll();

		// Occurrence passée lointaine créée après coup par un admin (ADR 0012 :
		// création d'occurrence réservée admin)
		const { pb } = await import("$lib/pocketbase/pb");
		const oldOcc = await pb.collection("planning_occurrences").create<PlanningOccurrence>(
			{
				master: master.id,
				date: dateInDays(-30),
				startTime: "09:00",
				endTime: "17:00",
				responses: [],
				comments: [],
				tasks: [],
				isConfirmed: false,
				isCanceled: false,
				lastModifiedBy: ""
			},
			{ query: { _token: adminToken } }
		);

		await planningStore.refreshActive();
		expect(await db.occurrences.get(oldOcc.id)).toBeUndefined();

		// Le fetch archive la rattrape
		await planningStore.refreshArchiveOccurrences();
		expect(await db.occurrences.get(oldOcc.id)).toBeDefined();
	});
});

describe("fetch archive — à la demande, borné au passé récent", () => {
	beforeEach(async () => {
		clearTrackedIds();
		await db.masters.clear();
		await db.occurrences.clear();
		await db.localMeta.clear();
		planningStore.destroy();
	});

	afterEach(async () => {
		occurrencesCollection.unsubscribeAll();
		await cleanupTrackedRecords();
	});

	it("rattrape un commentaire ajouté sur une occurrence passée (l'ancien trou du delta)", async () => {
		const { occurrences, participantToken } = await seedPlanning({
			title: "P archive commentaires",
			occurrenceDates: [dateInDays(-10), dateInDays(7)]
		});
		// PB normalise le champ date en datetime ("YYYY-MM-DD 00:00:00.000Z")
		const pastOcc = occurrences.find((o) => o.date.startsWith(dateInDays(-10)))!;

		await planningStore.setActiveToken(participantToken);

		await remoteAddComment(pastOcc.id, participantToken);
		await planningStore.refreshArchiveOccurrences();

		const local = await db.occurrences.get(pastOcc.id);
		expect(local?.comments).toHaveLength(1);
	});
});
