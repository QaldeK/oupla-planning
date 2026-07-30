/**
 * Tests d'intégration — Restrictions de sécurité côté hooks update.
 *
 * Couvre deux correctifs de l'audit de sécurité (.scratch/security-audit) :
 *
 *  F2 — Un participant (token participantToken) ne peut pas écrire les champs
 *       scalaire admin-only d'une occurrence (isCanceled, isConfirmed, date,
 *       startTime, endTime, place, description, deleted, minPresentRequired,
 *       master). La restriction par rôle, auparavant commentée, est désormais
 *       active. Un admin (adminToken) conserve tous les droits.
 *
 *  F5 — `lastModifiedBy` est forgé côté serveur depuis le contexte d'authent
 *       (e.auth.id pour un user auth, '' pour un guest token-only). La valeur
 *       envoyée par le client n'est jamais trustée — un participant ne peut
 *       donc pas usurper l'auteur d'un changement pour exclure une victime des
 *       notifications.
 *
 * Prérequis :
 *   - PocketBase démarré sur http://127.0.0.1:8090 (./pocketbase serve --dev)
 *   - Admin de test créé (test@example.com / testpassword)
 */
import PocketBase from "pocketbase";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlanningOccurrence } from "$lib/types/planning.types";
import {
	authenticateAdmin,
	cleanupTrackedRecords,
	clearTrackedIds,
	seedPlanning,
	seedUser
} from "./seed";

const PB_URL = process.env.VITE_PLANNING_PB_URL || "http://127.0.0.1:8090";

// Client PB sans auth — communique uniquement via le token en query param,
// comme un vrai client guest. Les hooks (token check, restrictions) s'appliquent.
function tokenClient(): PocketBase {
	return new PocketBase(PB_URL);
}

describe("F2 — Restriction des champs scalaire d'occurrence par rôle", () => {
	beforeEach(() => {
		clearTrackedIds();
	});
	afterEach(async () => {
		await cleanupTrackedRecords();
	});

	it("rejette l'annulation d'une occurrence par un participant (isCanceled)", async () => {
		const { occurrences, participantToken } = await seedPlanning({
			title: "F2 isCanceled by participant",
			occurrenceCount: 1
		});
		const occ = occurrences[0];

		const client = tokenClient();
		let caught: unknown;
		try {
			await client
				.collection("planning_occurrences")
				.update(occ.id, { isCanceled: true }, { query: { _token: participantToken } });
		} catch (err) {
			caught = err;
		}

		expect(caught).toBeDefined();
		expect((caught as { status?: number })?.status).toBe(403);

		// Vérification serveur : l'occurrence n'a pas été annulée.
		const adminPb = await authenticateAdmin();
		const finalOcc = await adminPb
			.collection("planning_occurrences")
			.getOne<PlanningOccurrence>(occ.id);
		expect(finalOcc.isCanceled).toBe(false);
	});

	it("rejette la reprogrammation d'une occurrence par un participant (date/startTime)", async () => {
		const { occurrences, participantToken } = await seedPlanning({
			title: "F2 reschedule by participant",
			occurrenceCount: 1
		});
		const occ = occurrences[0];

		const client = tokenClient();
		let caught: unknown;
		try {
			await client
				.collection("planning_occurrences")
				.update(
					occ.id,
					{ date: "2099-12-31", startTime: "23:59" },
					{ query: { _token: participantToken } }
				);
		} catch (err) {
			caught = err;
		}

		expect(caught).toBeDefined();
		expect((caught as { status?: number })?.status).toBe(403);
	});

	it("rejette la modification du slotId par un participant", async () => {
		const { occurrences, participantToken } = await seedPlanning({
			title: "F2 slotId by participant",
			occurrenceCount: 1
		});
		const occ = occurrences[0];

		const client = tokenClient();
		let caught: unknown;
		try {
			await client
				.collection("planning_occurrences")
				.update(occ.id, { slotId: "attacker-slot" }, { query: { _token: participantToken } });
		} catch (err) {
			caught = err;
		}

		expect(caught).toBeDefined();
		expect((caught as { status?: number })?.status).toBe(403);
	});

	it("autorise un participant à mettre à jour responses/comments (non-régression)", async () => {
		const { occurrences, participantToken } = await seedPlanning({
			title: "F2 participant allowed fields",
			occurrenceCount: 1
		});
		const occ = occurrences[0];

		const client = tokenClient();
		const updated = await client.collection("planning_occurrences").update<PlanningOccurrence>(
			occ.id,
			{
				responses: [
					{
						participantId: "p1",
						response: "present",
						tasks: [],
						respondedAt: "2026-01-01T00:00:00Z"
					}
				]
			},
			{ query: { _token: participantToken } }
		);

		expect(updated.responses).toHaveLength(1);
		expect(updated.isCanceled).toBe(false);
	});

	it("autorise un admin (adminToken) à annuler une occurrence", async () => {
		const { occurrences, adminToken } = await seedPlanning({
			title: "F2 admin can cancel",
			occurrenceCount: 1
		});
		const occ = occurrences[0];

		const client = tokenClient();
		const updated = await client
			.collection("planning_occurrences")
			.update<PlanningOccurrence>(occ.id, { isCanceled: true }, { query: { _token: adminToken } });

		expect(updated.isCanceled).toBe(true);
	});
});

describe("F5 — lastModifiedBy forgé côté serveur (anti-spoofing)", () => {
	beforeEach(() => {
		clearTrackedIds();
	});
	afterEach(async () => {
		await cleanupTrackedRecords();
	});

	it("ignore le lastModifiedBy envoyé par un user auth et forge depuis e.auth.id", async () => {
		const { occurrences, master, participantToken } = await seedPlanning({
			title: "F5 auth lastModifiedBy forging",
			occurrenceCount: 1
		});
		const occ = occurrences[0];

		// User auth membre du planning (pour que l'updateRule passe via la branche auth).
		const victim = await seedUser("victim-f5@example.com", "password123", "Victim");
		const attacker = await seedUser("attacker-f5@example.com", "password123", "Attacker", {
			masterIds: [master.id]
		});

		// Client authentifié en tant qu'attaquant.
		const authClient = new PocketBase(PB_URL);
		await authClient.collection("users").authWithPassword("attacker-f5@example.com", "password123");

		// L'attaquant tente de spoofer lastModifiedBy avec l'id de la victime.
		const updated = await authClient.collection("planning_occurrences").update<PlanningOccurrence>(
			occ.id,
			{
				responses: [
					{
						participantId: "p1",
						response: "present",
						tasks: [],
						respondedAt: "2026-01-01T00:00:00Z"
					}
				],
				lastModifiedBy: victim.id // spoof
			},
			{ query: { _token: participantToken } }
		);

		// La valeur persistée doit être l'id de l'attaquant (e.auth.id), PAS celle de la victime.
		expect(updated.lastModifiedBy).toBe(attacker.id);
		expect(updated.lastModifiedBy).not.toBe(victim.id);
	});

	it("forge lastModifiedBy à vide pour un guest (token-only, e.auth null)", async () => {
		const { occurrences, participantToken } = await seedPlanning({
			title: "F5 guest lastModifiedBy forging",
			occurrenceCount: 1
		});
		const occ = occurrences[0];

		const guestClient = tokenClient();
		const updated = await guestClient.collection("planning_occurrences").update<PlanningOccurrence>(
			occ.id,
			{
				responses: [
					{
						participantId: "p1",
						response: "absent",
						tasks: [],
						respondedAt: "2026-01-01T00:00:00Z"
					}
				],
				lastModifiedBy: "spoofed-victim-id" // spoof par guest
			},
			{ query: { _token: participantToken } }
		);

		// Aucun auth → lastModifiedBy vidé, la valeur spoofée est ignorée.
		expect(updated.lastModifiedBy).toBe("");
	});
});
