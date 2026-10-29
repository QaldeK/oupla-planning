/**
 * Tests d'intégration — intégrité de `planning_participants`.
 *
 * Objectif :
 *   Verrouiller l'invariant « au plus une ligne de préférences par
 *   (planning, user) » et les defaults dépendant du rôle :
 *     - l'index unique rejette un doublon (400) ;
 *     - `ensurePlanningParticipant` est idempotent, séquentiel et concurrent
 *       (deux appels en course → une seule ligne, aucune erreur) ;
 *     - `/api/claim-admin` crée la ligne admin avec `newCommentScope 'all'`
 *       et `onConfirmationNeeded true`.
 *
 * Prérequis : instance jetable démarrée (cf. docs/agents/integration-tests.md).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pb } from "$lib/pocketbase/pb";
import { ensurePlanningParticipant } from "$lib/services/planningParticipants";
import {
	authenticateAdmin,
	authenticateUser,
	cleanupTrackedRecords,
	cleanupUsers,
	clearTrackedIds,
	seedPlanning,
	seedUser,
	trackIds,
} from "./seed";

const USER_EMAIL = "pp-integrity@test.local";
const USER_PWD = "password123";

async function countRows(planningId: string, userId: string) {
	const adminPb = await authenticateAdmin();
	return await adminPb.collection("planning_participants").getFullList({
		filter: `planning = "${planningId}" && user = "${userId}"`,
	});
}

/** Authifie le singleton `pb` (celui qu'utilise le service) comme user. */
async function loginSingleton(email: string, password: string) {
	const userPb = await authenticateUser(email, password);
	pb.authStore.save(userPb.authStore.token, userPb.authStore.record);
}

describe("planning_participants — intégrité", () => {
	beforeEach(() => {
		clearTrackedIds();
		pb.authStore.clear();
	});

	afterEach(async () => {
		await cleanupTrackedRecords();
		await cleanupUsers([USER_EMAIL]);
		pb.authStore.clear();
	});

	it("l'index unique rejette un doublon (planning, user) → 400", async () => {
		const { master } = await seedPlanning({ title: "PP Unicite", occurrenceCount: 1 });
		const user = await seedUser(USER_EMAIL, USER_PWD, "PP Unique", {});
		trackIds("users", user.id);
		const adminPb = await authenticateAdmin();

		const first = await adminPb.collection("planning_participants").create({
			planning: master.id,
			user: user.id,
		});
		trackIds("planning_participants", first.id);

		await expect(
			adminPb.collection("planning_participants").create({
				planning: master.id,
				user: user.id,
			}),
		).rejects.toMatchObject({ status: 400 });

		expect((await countRows(master.id, user.id)).length).toBe(1);
	});

	it("ensurePlanningParticipant deux fois de suite → une seule ligne", async () => {
		const { master } = await seedPlanning({ title: "PP Sequentiel", occurrenceCount: 1 });
		const user = await seedUser(USER_EMAIL, USER_PWD, "PP Seq", {});
		trackIds("users", user.id);
		await loginSingleton(USER_EMAIL, USER_PWD);

		await ensurePlanningParticipant(master.id, user.id, "WEEKLY", false);
		await ensurePlanningParticipant(master.id, user.id, "WEEKLY", false);

		const rows = await countRows(master.id, user.id);
		expect(rows.length).toBe(1);
		trackIds("planning_participants", rows[0].id);
	});

	it("deux ensurePlanningParticipant concurrents → une seule ligne, aucune erreur", async () => {
		const { master } = await seedPlanning({ title: "PP Concurrent", occurrenceCount: 1 });
		const user = await seedUser(USER_EMAIL, USER_PWD, "PP Conc", {});
		trackIds("users", user.id);
		await loginSingleton(USER_EMAIL, USER_PWD);

		await Promise.all([
			ensurePlanningParticipant(master.id, user.id, "WEEKLY", false),
			ensurePlanningParticipant(master.id, user.id, "WEEKLY", false),
		]);

		const rows = await countRows(master.id, user.id);
		expect(rows.length).toBe(1);
		trackIds("planning_participants", rows[0].id);
	});

	it("/api/claim-admin crée la ligne admin avec newCommentScope 'all' et onConfirmationNeeded true", async () => {
		const { master, adminToken } = await seedPlanning({
			title: "PP Claim Admin",
			occurrenceCount: 1,
		});
		const user = await seedUser(USER_EMAIL, USER_PWD, "PP Admin", {});
		trackIds("users", user.id);
		await loginSingleton(USER_EMAIL, USER_PWD);

		await pb.send("/api/claim-admin", { method: "POST", body: { token: adminToken } });

		const rows = await countRows(master.id, user.id);
		expect(rows.length).toBe(1);
		trackIds("planning_participants", rows[0].id);
		expect(rows[0].newCommentScope).toBe("all");
		expect(rows[0].onConfirmationNeeded).toBe(true);
	});
});
