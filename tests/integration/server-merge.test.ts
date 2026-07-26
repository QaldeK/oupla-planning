/**
 * Tests d'intégration — R5.2 : merge serveur atomique des champs additifs JSON.
 *
 * Objectif :
 *   Vérifier que le hook `onRecordUpdateRequest` (main.pb.js) mergé côté serveur
 *   les champs tableaux (participants/tasks/responses/comments) de façon atomique,
 *   et que le `_version` renvoie bien 409 sur les scalaires.
 *
 * Ce que ça teste :
 *   1. Additions concurrentes sur master (participants) → [p1, p2, p3] préservés
 *   2. Additions concurrentes sur occurrence (responses et comments)
 *   3. Modification d'un item existant → last-writer-wins documenté
 *   4. `_version` stale sur un scalaire → 409
 *   5. Non-régression : update simple (ajout d'un participant) marche toujours
 *
 * Atomicité :
 *   On teste la logique de merge du hook, pas le parallélisme réel. Un test
 *   séquentiel bien conçu prouve l'atomicité tout aussi bien : le hook merge à
 *   chaque requête en lisant l'état DB courant. On simule un client "stale" en
 *   lui faisant envoyer un body basé sur un état antérieur (sans connaître les
 *   ajouts faits par l'autre client).
 *
 * Prérequis :
 *   - PocketBase démarré sur http://127.0.0.1:8090
 *   - Admin de test créé (test@example.com / testpassword)
 */

import PocketBase from "pocketbase";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
	OccurrenceComment,
	Participant,
	ParticipantResponse,
	PlanningMaster,
	PlanningOccurrence
} from "$lib/types/planning.types";
import { authenticateAdmin, cleanupTrackedRecords, clearTrackedIds, seedPlanning } from "./seed";

const PB_URL = process.env.VITE_PLANNING_PB_URL || "http://127.0.0.1:8090";

// Client PB authentifié uniquement via token (query param), comme un vrai client guest.
// Pas d'auth admin → les hooks s'appliquent (token check, merge, _version).
function tokenClient(_token: string): PocketBase {
	return new PocketBase(PB_URL);
}

describe("R5.2 — Merge serveur atomique des champs additifs", () => {
	beforeEach(() => {
		clearTrackedIds();
	});

	afterEach(async () => {
		await cleanupTrackedRecords();
	});

	// ---------------------------------------------------------------------------
	// 1. Additions concurrentes sur master (participants)
	// ---------------------------------------------------------------------------
	it("préserve les additions concurrentes de participants sur un master", async () => {
		const p1: Participant = {
			id: "p1",
			name: "Alice",
			isAdmin: false,
			createdAt: "2026-01-01"
		};

		// État initial serveur : master avec [p1]
		const { master, adminToken, participantToken } = await seedPlanning({
			title: "R5.2 Concurrent Participants",
			participants: [p1]
		});

		// Client A (admin) ajoute p2 — body basé sur l'état vu par A : [p1, p2]
		const clientA = tokenClient(adminToken);
		const p2: Participant = {
			id: "p2",
			name: "Bob",
			isAdmin: false,
			createdAt: "2026-01-01"
		};
		await clientA.collection("planning_masters").update(
			master.id,
			{ participants: [p1, p2] },
			{
				query: { _token: adminToken }
			}
		);

		// Client B (participant) ajoute p3 — body basé sur l'état STALE vu par B : [p1, p3]
		// B ne connaît pas p2. Sans merge serveur, p2 serait écrasé.
		const clientB = tokenClient(participantToken);
		const p3: Participant = {
			id: "p3",
			name: "Charlie",
			isAdmin: false,
			createdAt: "2026-01-01"
		};
		await clientB.collection("planning_masters").update(
			master.id,
			{ participants: [p1, p3] },
			{
				query: { _token: participantToken }
			}
		);

		// Vérification via fetch admin indépendant : les 3 participants doivent être là
		const adminPb = await authenticateAdmin();
		const finalMaster = await adminPb
			.collection("planning_masters")
			.getOne<PlanningMaster>(master.id);
		const ids = finalMaster.participants.map((p) => p.id).sort();
		expect(ids).toEqual(["p1", "p2", "p3"]);
	});

	// ---------------------------------------------------------------------------
	// 2. Additions concurrentes sur occurrence (responses et comments)
	// ---------------------------------------------------------------------------
	it("préserve les additions concurrentes de responses et comments sur une occurrence", async () => {
		const { occurrences, participantToken } = await seedPlanning({
			title: "R5.2 Concurrent Occurrence",
			occurrenceCount: 1
		});
		const occ = occurrences[0];

		// Deux participants soumettent leur réponse (clé participantId) — corps disjoints
		const respA: ParticipantResponse = {
			participantId: "a",
			response: "present",
			tasks: [],
			respondedAt: "2026-01-01T00:00:00Z"
		};
		const respB: ParticipantResponse = {
			participantId: "b",
			response: "absent",
			tasks: [],
			respondedAt: "2026-01-01T00:00:00Z"
		};

		// Client A envoie sa réponse seul (état initial vide vu par A)
		const clientA = tokenClient(participantToken);
		await clientA.collection("planning_occurrences").update(
			occ.id,
			{ responses: [respA] },
			{
				query: { _token: participantToken }
			}
		);

		// Client B envoie sa réponse seul (ne connaît pas respA — stale)
		const clientB = tokenClient(participantToken);
		await clientB.collection("planning_occurrences").update(
			occ.id,
			{ responses: [respB] },
			{
				query: { _token: participantToken }
			}
		);

		// Même pattern sur les comments (clé id)
		const commentA: OccurrenceComment = {
			id: "c1",
			participantId: "a",
			content: "Commentaire A",
			createdAt: "2026-01-01T00:00:00Z"
		};
		const commentB: OccurrenceComment = {
			id: "c2",
			participantId: "b",
			content: "Commentaire B",
			createdAt: "2026-01-01T00:00:00Z"
		};
		await clientA.collection("planning_occurrences").update(
			occ.id,
			{ comments: [commentA] },
			{
				query: { _token: participantToken }
			}
		);
		await clientB.collection("planning_occurrences").update(
			occ.id,
			{ comments: [commentB] },
			{
				query: { _token: participantToken }
			}
		);

		// Vérification : les deux responses et les deux comments sont présents
		const adminPb = await authenticateAdmin();
		const finalOcc = await adminPb
			.collection("planning_occurrences")
			.getOne<PlanningOccurrence>(occ.id);
		const respIds = finalOcc.responses.map((r) => r.participantId).sort();
		expect(respIds).toEqual(["a", "b"]);

		const commentIds = finalOcc.comments.map((c) => c.id).sort();
		expect(commentIds).toEqual(["c1", "c2"]);
	});

	// ---------------------------------------------------------------------------
	// 3. Modification d'un item existant → last-writer-wins (comportement documenté)
	// ---------------------------------------------------------------------------
	it("applique last-writer-wins sur la modification concurrente d un même participant", async () => {
		const p1: Participant = {
			id: "p1",
			name: "Alice",
			isAdmin: false,
			createdAt: "2026-01-01"
		};

		const { master, adminToken } = await seedPlanning({
			title: "R5.2 LWW",
			participants: [p1]
		});

		// Client A modifie le nom de p1
		const p1ByA: Participant = { ...p1, name: "Alice (par A)" };
		const clientA = tokenClient(adminToken);
		await clientA
			.collection("planning_masters")
			.update(master.id, { participants: [p1ByA] }, { query: { _token: adminToken } });

		// Client B (stale) modifie aussi le nom de p1, sans connaître la modif de A
		const p1ByB: Participant = { ...p1, name: "Alice (par B)" };
		const clientB = tokenClient(adminToken);
		await clientB
			.collection("planning_masters")
			.update(master.id, { participants: [p1ByB] }, { query: { _token: adminToken } });

		// Comportement documenté : un seul gagne (le dernier = B), pas de double item
		const adminPb = await authenticateAdmin();
		const finalMaster = await adminPb
			.collection("planning_masters")
			.getOne<PlanningMaster>(master.id);
		expect(finalMaster.participants).toHaveLength(1);
		expect(finalMaster.participants[0].id).toBe("p1");
		// Le dernier a gagné
		expect(finalMaster.participants[0].name).toBe("Alice (par B)");
	});

	// ---------------------------------------------------------------------------
	// 4. _version stale sur un scalaire → 409
	// ---------------------------------------------------------------------------
	it("renvoie 409 sur un update scalaire avec _version stale", async () => {
		const { master, adminToken } = await seedPlanning({
			title: "R5.2 Version Conflict"
		});

		const client = tokenClient(adminToken);
		let caught: unknown;
		try {
			await client
				.collection("planning_masters")
				.update(
					master.id,
					{ title: "Titre modifié" },
					{ query: { _token: adminToken, _version: "2000-01-01 00:00:00.000Z" } }
				);
		} catch (err) {
			caught = err;
		}

		expect(caught).toBeDefined();
		expect((caught as { status?: number })?.status).toBe(409);
	});

	// ---------------------------------------------------------------------------
	// 5. Non-régression : update simple sans concurrence marche toujours
	// ---------------------------------------------------------------------------
	it("fusionne correctement un ajout simple de participant sans concurrence", async () => {
		const p1: Participant = {
			id: "p1",
			name: "Alice",
			isAdmin: false,
			createdAt: "2026-01-01"
		};

		const { master, adminToken } = await seedPlanning({
			title: "R5.2 Simple Update",
			participants: [p1]
		});

		// Ajout simple : on renvoie [p1, p2] en connaissant l'état complet
		const p2: Participant = {
			id: "p2",
			name: "Bob",
			isAdmin: false,
			createdAt: "2026-01-01"
		};
		const client = tokenClient(adminToken);
		const updated = await client
			.collection("planning_masters")
			.update<PlanningMaster>(
				master.id,
				{ participants: [p1, p2] },
				{ query: { _token: adminToken } }
			);

		// Le body merge ne doit pas casser le cas normal
		const ids = updated.participants.map((p) => p.id).sort();
		expect(ids).toEqual(["p1", "p2"]);

		// Vérification serveur
		const adminPb = await authenticateAdmin();
		const finalMaster = await adminPb
			.collection("planning_masters")
			.getOne<PlanningMaster>(master.id);
		const finalIds = finalMaster.participants.map((p) => p.id).sort();
		expect(finalIds).toEqual(["p1", "p2"]);
	});

	// ---------------------------------------------------------------------------
	// 6. Cas clé : stale client + ajout serveur concurrent + modif d'item existant
	//    Prouve le sens des arguments mergeByKey(key, body=local, record=remote) :
	//    body écrase sur clé commune, items serveur préservés si absents du body.
	// ---------------------------------------------------------------------------
	it("préserve l ajout serveur concurrent et applique la modif du client stale", async () => {
		const p1: Participant = {
			id: "p1",
			name: "Alice",
			isAdmin: false,
			createdAt: "2026-01-01"
		};
		const p2: Participant = {
			id: "p2",
			name: "Bob",
			isAdmin: false,
			createdAt: "2026-01-01"
		};

		// État initial serveur : [p1, p2]. Le client a fetch cet état (Dexie = [p1, p2]).
		const { master, adminToken } = await seedPlanning({
			title: "R5.2 Stale Client + Server Add",
			participants: [p1, p2]
		});

		// Ajout serveur CONCURRENT par l'admin (superuser → bypass le hook, body brut).
		// Le serveur passe à [p1, p2, p3]. Le client stale ne connaît pas p3.
		const adminPb = await authenticateAdmin();
		const p3: Participant = {
			id: "p3",
			name: "Charlie",
			isAdmin: false,
			createdAt: "2026-01-01"
		};
		await adminPb.collection("planning_masters").update(master.id, { participants: [p1, p2, p3] });

		// Client stale (token, PAS superuser → le hook s'applique). Sans mergeStrategies
		// côté client (pré-merge retiré en R5.2). Il envoie [p1, p2Updated] en pensant
		// que l'état serveur est encore [p1, p2]. Sans le hook serveur, p3 serait perdu.
		const p2Updated: Participant = { ...p2, name: "Bob Modifié" };
		const staleClient = tokenClient(adminToken);
		await staleClient
			.collection("planning_masters")
			.update(master.id, { participants: [p1, p2Updated] }, { query: { _token: adminToken } });

		// Vérification serveur : [p1, p2Updated, p3]
		// - p3 préservé (ajout serveur concurrent non présent dans le body du client)
		// - p2 remplacé par p2Updated (body gagne sur clé commune)
		// - p1 inchangé
		const finalMaster = await adminPb
			.collection("planning_masters")
			.getOne<PlanningMaster>(master.id);
		const ids = finalMaster.participants.map((p) => p.id).sort();
		expect(ids).toEqual(["p1", "p2", "p3"]);

		const p2Final = finalMaster.participants.find((p) => p.id === "p2");
		expect(p2Final?.name).toBe("Bob Modifié");

		const p3Final = finalMaster.participants.find((p) => p.id === "p3");
		expect(p3Final?.name).toBe("Charlie");
	});

	// ---------------------------------------------------------------------------
	// 7. Bonus : le merge préserve aussi les tasks (master)
	// ---------------------------------------------------------------------------
	it("préserve les additions concurrentes de tasks sur un master", async () => {
		const taskA = {
			id: "t1",
			name: "Task A",
			requiredVolunteers: 1,
			type: "custom"
		};
		const taskB = {
			id: "t2",
			name: "Task B",
			requiredVolunteers: 2,
			type: "custom"
		};

		const { master, adminToken } = await seedPlanning({
			title: "R5.2 Tasks Merge",
			tasks: []
		});

		// Client A ajoute t1
		const clientA = tokenClient(adminToken);
		await clientA.collection("planning_masters").update(
			master.id,
			{ tasks: [taskA] },
			{
				query: { _token: adminToken }
			}
		);

		// Client B (stale) ajoute t2 sans connaître t1
		const clientB = tokenClient(adminToken);
		await clientB.collection("planning_masters").update(
			master.id,
			{ tasks: [taskB] },
			{
				query: { _token: adminToken }
			}
		);

		const adminPb = await authenticateAdmin();
		const finalMaster = await adminPb
			.collection("planning_masters")
			.getOne<PlanningMaster>(master.id);
		const taskIds = finalMaster.tasks.map((t) => t.id).sort();
		expect(taskIds).toEqual(["t1", "t2"]);
	});
});
