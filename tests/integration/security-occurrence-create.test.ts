/**
 * Tests d'intégration — createRule de planning_occurrences (fix F4).
 *
 * F4 — La création d'occurrence exige l'adminToken du master propriétaire
 *      (createRule : master.adminToken = @request.query._token). Avant le fix,
 *      createRule était "" (publique) : n'importe qui connaissant un masterId
 *      pouvait injecter de fausses occurrences visibles par tous les participants.
 *
 * Couverture :
 *   - Create sans _token → 403 (la faille est fermée)
 *   - Create avec adminToken → 200 (non-régression admin)
 *   - Batch de creates avec adminToken → 200 (non-régression /new)
 *
 * Prérequis :
 *   - PocketBase démarré sur http://127.0.0.1:8090 (./pocketbase serve --dev)
 *   - Admin de test créé (test@example.com / testpassword)
 */
import PocketBase from "pocketbase";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	authenticateAdmin,
	cleanupTrackedRecords,
	clearTrackedIds,
	seedPlanning,
	trackIds
} from "./seed";

const PB_URL = process.env.VITE_PLANNING_PB_URL || "http://127.0.0.1:8090";

function tokenClient(): PocketBase {
	return new PocketBase(PB_URL);
}

describe("F4 — createRule de planning_occurrences (adminToken requis)", () => {
	beforeEach(() => {
		clearTrackedIds();
	});
	afterEach(async () => {
		await cleanupTrackedRecords();
	});

	it("rejette la création d'une occurrence sans _token", async () => {
		const { master } = await seedPlanning({
			title: "F4 create sans token",
			occurrenceCount: 0
		});

		const client = tokenClient();
		let caught: unknown;
		try {
			await client.collection("planning_occurrences").create({
				master: master.id,
				date: "2099-01-01",
				startTime: "09:00",
				endTime: "17:00",
				responses: [],
				comments: [],
				isConfirmed: false,
				isCanceled: false
			});
		} catch (err) {
			caught = err;
		}

		expect(caught).toBeDefined();
		// PB retourne 400 quand la createRule référence @request.query._token absent
		// (filtre inévaluable) ou 403 si la condition est simplement fausse. Les deux
		// bloquent la création — l'assertion sur l'absence d'occurrence est la garantie réelle.
		const status = (caught as { status?: number })?.status;
		expect(status === 400 || status === 403).toBe(true);

		// Vérification serveur : aucune occurrence n'a été créée.
		const adminPb = await authenticateAdmin();
		const occurrences = await adminPb
			.collection("planning_occurrences")
			.getFullList({ filter: `master = "${master.id}"` });
		expect(occurrences).toHaveLength(0);
	});

	it("autorise la création d'une occurrence avec l'adminToken", async () => {
		const { master, adminToken } = await seedPlanning({
			title: "F4 create avec adminToken",
			occurrenceCount: 0
		});

		const client = tokenClient();
		const occ = await client.collection("planning_occurrences").create(
			{
				master: master.id,
				date: "2099-01-01",
				startTime: "09:00",
				endTime: "17:00",
				responses: [],
				comments: [],
				isConfirmed: false,
				isCanceled: false
			},
			{ query: { _token: adminToken } }
		);

		expect(occ.id).toBeDefined();
		trackIds("planning_occurrences", occ.id);
	});

	it("autorise un batch de creates avec l'adminToken (non-régression /new)", async () => {
		const { master, adminToken } = await seedPlanning({
			title: "F4 batch create avec adminToken",
			occurrenceCount: 0
		});

		const client = tokenClient();
		const batch = client.createBatch();
		for (let i = 0; i < 3; i++) {
			batch.collection("planning_occurrences").create(
				{
					master: master.id,
					date: `2099-01-${String(i + 1).padStart(2, "0")}`,
					startTime: "09:00",
					endTime: "17:00",
					responses: [],
					comments: [],
					isConfirmed: false,
					isCanceled: false
				},
				{ query: { _token: adminToken } }
			);
		}

		const results = await batch.send();
		expect(results).toHaveLength(3);
		for (const r of results) {
			if (r.body?.id) trackIds("planning_occurrences", r.body.id);
		}

		const adminPb = await authenticateAdmin();
		const occurrences = await adminPb
			.collection("planning_occurrences")
			.getFullList({ filter: `master = "${master.id}"` });
		expect(occurrences).toHaveLength(3);
	});
});
