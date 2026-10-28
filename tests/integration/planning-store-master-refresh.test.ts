/**
 * Tests d'intégration — Rafraîchissement du master à l'activation / re-sync
 *
 * Bug visé : un client dont le master est déjà en Dexie ne re-fetchait jamais
 * `planning_masters` (l'activation ne vérifiait que l'existence via
 * `fields: "id"`, et `refreshActive` ne delta-synchronisait que les
 * occurrences). Les participants ajoutés côté serveur pendant une coupure
 * SSE restaient donc inconnus localement — d'où des badges affichant l'id
 * brut (`getParticipantName` retombe sur l'id quand l'entrée est absente).
 *
 * Scénarios :
 *   1. Reload (destroy + setActiveToken) → le master local rattrape les
 *      participants ajoutés côté serveur entre-temps.
 *   2. refreshActive (re-sync en session live, chemin guest) → idem.
 *   3. Master supprimé côté serveur → reload → erreur not_found (le refresh
 *      remplace l'ancien check d'existence et doit préserver ce comportement).
 *
 * La SSE est désactivée après la première activation pour simuler une app
 * fermée / une connexion morte : sans ça, l'event realtime soignerait Dexie
 * en course avec l'assertion et masquerait le bug.
 *
 * Prérequis : PocketBase sur http://127.0.0.1:8090, fake-indexeddb (setup.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mastersCollection, occurrencesCollection } from "$lib/data/collections";
import { db } from "$lib/pb-sync/db";
import { planningStore } from "$lib/stores/planningStore.svelte";
import { authenticateAdmin, cleanupTrackedRecords, clearTrackedIds, seedPlanning } from "./seed";

async function getLocalMaster(masterId: string) {
	return db.masters.get(masterId);
}

describe("PlanningStore — master refresh (anti-staleness participants)", () => {
	beforeEach(async () => {
		clearTrackedIds();
		await db.masters.clear();
		await db.occurrences.clear();
		await db.localMeta.clear();
		await db.commentState.clear();
		planningStore.destroy();
	});

	afterEach(async () => {
		mastersCollection.unsubscribeAll();
		occurrencesCollection.unsubscribeAll();
		await cleanupTrackedRecords();
	});

	/** Ajoute un participant côté serveur, hors de tout flux client. */
	async function addParticipantServerSide(masterId: string, name: string) {
		const pb = await authenticateAdmin();
		const master = await pb.collection("planning_masters").getOne(masterId);
		const participants = [
			...(master.participants as unknown[]),
			{
				id: crypto.randomUUID(),
				name,
				isAdmin: false,
				createdAt: new Date().toISOString(),
			},
		];
		await pb.collection("planning_masters").update(masterId, { participants });
	}

	it("reload après ajout serveur d'un participant → le master local contient le nouveau participant", async () => {
		const { master, participantToken } = await seedPlanning({
			title: "Staleness Reload",
			participants: [
				{
					id: crypto.randomUUID(),
					name: "Alice",
					isAdmin: false,
					createdAt: new Date().toISOString(),
				},
			],
		});

		// Première visite : master en Dexie.
		await planningStore.setActiveToken(participantToken);
		await vi.waitFor(() => {
			expect(planningStore.master).not.toBeNull();
		});

		// Simuler une app fermée : plus de realtime, sinon l'event SSE soignerait Dexie.
		mastersCollection.unsubscribeAll();
		occurrencesCollection.unsubscribeAll();

		// Bob rejoint le planning pendant la "fermeture".
		await addParticipantServerSide(master.id, "Bob");

		// Reload : destroy + re-activation (le store repart de zéro, comme un F5).
		planningStore.destroy();
		await planningStore.setActiveToken(participantToken);
		await vi.waitFor(() => {
			expect(planningStore.master).not.toBeNull();
		});

		const local = await getLocalMaster(master.id);
		expect(local?.participants.map((p) => p.name)).toContain("Bob");
		expect(planningStore.master?.participants.map((p) => p.name)).toContain("Bob");
		// Alice n'est pas perdue au passage (merge, pas remplacement).
		expect(local?.participants.map((p) => p.name)).toContain("Alice");
	});

	it("refreshActive après ajout serveur → le master local contient le nouveau participant", async () => {
		const { master, participantToken } = await seedPlanning({
			title: "Staleness Refresh",
			participants: [],
		});

		await planningStore.setActiveToken(participantToken);
		await vi.waitFor(() => {
			expect(planningStore.master).not.toBeNull();
		});

		mastersCollection.unsubscribeAll();
		occurrencesCollection.unsubscribeAll();

		await addParticipantServerSide(master.id, "Bob");

		// Re-sync en session live (chemin networkStore branche guest).
		await planningStore.refreshActive();

		const local = await getLocalMaster(master.id);
		expect(local?.participants.map((p) => p.name)).toContain("Bob");
	});

	it("master supprimé côté serveur → reload → erreur not_found", async () => {
		const { master, participantToken } = await seedPlanning({ title: "Staleness Deleted" });

		await planningStore.setActiveToken(participantToken);
		await vi.waitFor(() => {
			expect(planningStore.master).not.toBeNull();
		});

		mastersCollection.unsubscribeAll();
		occurrencesCollection.unsubscribeAll();

		const pb = await authenticateAdmin();
		await pb.collection("planning_masters").delete(master.id);

		planningStore.destroy();
		await planningStore.setActiveToken(participantToken);

		expect(planningStore.error?.type).toBe("not_found");
	});
});
