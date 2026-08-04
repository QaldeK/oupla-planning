/**
 * Tests d'intégration — suppression de compte (ADR-0013).
 *
 * Endpoint : POST /api/delete-account
 *
 * Cascade serveur en transaction :
 *   - participants[] : retrait userId/claimedAt + hasQuit=true sur tous les
 *     masters où le user a une participation (les siens et ceux des autres)
 *   - planning_participants (prefs de notification) : rows du user supprimées
 *   - planning_locks : locks détenus par le user supprimés
 *   - users : record supprimé en dernier (tout échec → rollback, compte intact)
 *
 * Les plannings (masters, occurrences, notification_events) survivent : la
 * vérification du mot de passe est faite côté client (authWithPassword) — un
 * mot de passe erroné ne doit produire aucun changement.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "$lib/pb-sync/db";
import { pb } from "$lib/pocketbase/pb";
import type { Participant } from "$lib/types/planning.types";
import {
	authenticateAdmin,
	authenticateUser,
	cleanupTrackedRecords,
	clearTrackedIds,
	seedParticipantPrefs,
	seedPlanning,
	seedUser,
	trackIds
} from "./seed";

const USER_EMAIL = "delete-account@test.com";
const USER_PWD = "password123";
const OTHER_EMAIL = "other-admin@test.com";
const OTHER_PWD = "password456";

async function adminGetMaster(masterId: string) {
	const adminPb = await authenticateAdmin();
	return await adminPb.collection("planning_masters").getOne(masterId);
}

async function adminGetList(collection: string, filter: string) {
	const adminPb = await authenticateAdmin();
	return await adminPb.collection(collection).getFullList({ filter });
}

async function seedNotificationEvent(masterId: string, occId: string) {
	const adminPb = await authenticateAdmin();
	return await adminPb.collection("notification_events").create({
		type: "new_comment",
		master: masterId,
		occurrence: occId,
		reminderValue: 0,
		changedBy: "author-other-user",
		payload: {
			commentId: "c-del-test",
			commentCreatedAt: new Date().toISOString(),
			authorName: "Other User",
			contentPreview: "Hello"
		},
		processedAt: ""
	});
}

async function seedLock(masterId: string, lockedBy: string) {
	const adminPb = await authenticateAdmin();
	return await adminPb.collection("planning_locks").create({
		master: masterId,
		lockedBy,
		lockedByName: "Alice Delete"
	});
}

describe("POST /api/delete-account — suppression de compte", () => {
	beforeEach(async () => {
		clearTrackedIds();
		await db.masters.clear();
		await db.occurrences.clear();
		await db.localMeta.clear();
		await db.commentState.clear();
		pb.authStore.clear();
	});

	afterEach(async () => {
		await cleanupTrackedRecords();
		pb.authStore.clear();
	});

	it("cascade complet : participations quittées, prefs et locks supprimés, compte supprimé, plannings intacts", async () => {
		// === SEED ===
		const adminPb = await authenticateAdmin();

		// Compte A (celui qui se supprime) : admin de M1, participant de M2
		const userA = await seedUser(USER_EMAIL, USER_PWD, "Alice Delete");
		trackIds("users", userA.id);
		// Compte B (autre admin) : admin de M2 — ne doit pas être affecté
		const userB = await seedUser(OTHER_EMAIL, OTHER_PWD, "Bob Admin");
		trackIds("users", userB.id);

		// M1 : planning dont A est admin — participant lié (userId) + commentaire conservé
		const aliceInM1: Participant = {
			id: "alice-m1",
			name: "Alice Delete",
			isAdmin: true,
			createdAt: new Date().toISOString(),
			userId: userA.id,
			claimedAt: new Date().toISOString()
		};
		const m1 = await seedPlanning({
			title: "M1 owned by A",
			participants: [aliceInM1],
			occurrenceCount: 1
		});

		// M2 : planning dont B est admin — A participe via un guest lié (userId)
		// et via un auto-add CAS C (id = pbUser.id, sans userId)
		const aliceInM2: Participant = {
			id: "alice-m2",
			name: "Alice Delete",
			isAdmin: false,
			createdAt: new Date().toISOString(),
			userId: userA.id,
			claimedAt: new Date().toISOString()
		};
		const aliceAutoAdd: Participant = {
			id: userA.id, // CAS C : participant auto-ajouté avec id = pbUser.id
			name: "Alice Delete",
			isAdmin: false,
			createdAt: new Date().toISOString()
		};
		const bobInM2: Participant = {
			id: "bob-m2",
			name: "Bob Admin",
			isAdmin: true,
			createdAt: new Date().toISOString(),
			userId: userB.id
		};
		const m2 = await seedPlanning({
			title: "M2 owned by B",
			participants: [aliceInM2, aliceAutoAdd, bobInM2],
			occurrenceCount: 2
		});

		// Lier A/B à leurs masters (masterId + adminOf)
		await adminPb.collection("users").update(userA.id, {
			masterId: [m1.master.id, m2.master.id],
			adminOf: { [m1.master.id]: m1.adminToken }
		});
		await adminPb.collection("users").update(userB.id, {
			masterId: [m2.master.id],
			adminOf: { [m2.master.id]: m2.adminToken }
		});

		// Prefs de notification : A sur M1 et M2, B sur M2
		await seedParticipantPrefs(m1.master.id, userA.id);
		await seedParticipantPrefs(m2.master.id, userA.id);
		await seedParticipantPrefs(m2.master.id, userB.id);

		// Données qui doivent SURVIVRE : un event de notification + un commentaire
		const eventId = (await seedNotificationEvent(m1.master.id, m1.occurrences[0].id)).id;
		const commentId = "comment-alice-m1";
		await adminPb.collection("planning_occurrences").update(m1.occurrences[0].id, {
			comments: [
				{
					id: commentId,
					participantId: "alice-m1",
					content: "Message d'Alice",
					createdAt: new Date().toISOString()
				}
			]
		});

		// Lock détenu par A (doit être nettoyé)
		await seedLock(m1.master.id, userA.id);

		// === ACTION ===
		const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
		pb.authStore.save(userPb.authStore.token, userPb.authStore.record);
		const response = await pb.send("/api/delete-account", { method: "POST" });
		expect(response).toEqual({ success: true });

		// === VERIFICATION : compte supprimé ===
		await expect(adminPb.collection("users").getOne(userA.id)).rejects.toMatchObject({
			status: 404
		});

		// === VERIFICATION : participations marquées quittées sur les 2 masters ===
		const m1After = await adminGetMaster(m1.master.id);
		const m1Participants = m1After.participants as Participant[];
		const aliceM1After = m1Participants.find((p) => p.id === "alice-m1");
		expect(aliceM1After?.hasQuit).toBe(true);
		expect(aliceM1After?.userId).toBeUndefined();
		expect(aliceM1After?.claimedAt).toBeUndefined();
		expect(aliceM1After?.name).toBe("Alice Delete"); // pseudonyme conservé

		const m2After = await adminGetMaster(m2.master.id);
		const m2Participants = m2After.participants as Participant[];
		const aliceM2After = m2Participants.find((p) => p.id === "alice-m2");
		expect(aliceM2After?.hasQuit).toBe(true);
		expect(aliceM2After?.userId).toBeUndefined();
		expect(aliceM2After?.claimedAt).toBeUndefined();
		// CAS C : participant avec id = pbUser.id également quitté
		const aliceAutoAddAfter = m2Participants.find((p) => p.id === userA.id);
		expect(aliceAutoAddAfter?.hasQuit).toBe(true);
		// Participant de l'autre admin intact
		const bobM2After = m2Participants.find((p) => p.id === "bob-m2");
		expect(bobM2After?.userId).toBe(userB.id);
		expect(bobM2After?.hasQuit).toBeUndefined();

		// === VERIFICATION : prefs supprimées ===
		const aPrefs = await adminGetList("planning_participants", `user = "${userA.id}"`);
		expect(aPrefs).toHaveLength(0);
		// Prefs de B conservées
		const bPrefs = await adminGetList("planning_participants", `user = "${userB.id}"`);
		expect(bPrefs).toHaveLength(1);

		// === VERIFICATION : locks du user nettoyés ===
		const aLocks = await adminGetList("planning_locks", `lockedBy = "${userA.id}"`);
		expect(aLocks).toHaveLength(0);

		// === VERIFICATION : plannings et contenus survivent ===
		expect((await adminGetMaster(m1.master.id)).title).toBe("M1 owned by A");
		expect((await adminGetMaster(m2.master.id)).title).toBe("M2 owned by B");

		const occs = await adminGetList("planning_occurrences", `master = "${m1.master.id}"`);
		expect(occs).toHaveLength(1);
		const comments = (occs[0].comments ?? []) as { id: string; participantId: string }[];
		expect(comments).toHaveLength(1);
		expect(comments[0].id).toBe(commentId);
		expect(comments[0].participantId).toBe("alice-m1"); // messages conservés avec le pseudonyme

		await expect(adminPb.collection("notification_events").getOne(eventId)).resolves.toBeTruthy();

		// === VERIFICATION : adminOf/masterId de l'AUTRE user non affectés ===
		const bAfter = await adminPb.collection("users").getOne(userB.id);
		expect(bAfter.masterId).toEqual([m2.master.id]);
		expect(bAfter.adminOf).toEqual({ [m2.master.id]: m2.adminToken });
	});

	it("rejette sans auth avec 401 et ne modifie rien", async () => {
		const user = await seedUser(USER_EMAIL, USER_PWD, "NoAuth User");
		trackIds("users", user.id);

		const alice: Participant = {
			id: "alice-noauth",
			name: "NoAuth User",
			isAdmin: false,
			createdAt: new Date().toISOString(),
			userId: user.id
		};
		const { master } = await seedPlanning({
			title: "NoAuth Test",
			participants: [alice],
			occurrenceCount: 0
		});

		// Pas d'auth dans le singleton pb
		await expect(pb.send("/api/delete-account", { method: "POST" })).rejects.toMatchObject({
			status: 401
		});

		// Rien n'a changé : compte et participants intacts
		const adminPb = await authenticateAdmin();
		await expect(adminPb.collection("users").getOne(user.id)).resolves.toBeTruthy();
		const masterAfter = await adminGetMaster(master.id);
		const p = (masterAfter.participants as Participant[])[0];
		expect(p.userId).toBe(user.id);
		expect(p.hasQuit).toBeUndefined();
	});

	it("mot de passe erroné → refus côté client, aucun changement", async () => {
		const user = await seedUser(USER_EMAIL, USER_PWD, "Wrong Pwd");
		trackIds("users", user.id);

		const alice: Participant = {
			id: "alice-wrongpwd",
			name: "Wrong Pwd",
			isAdmin: false,
			createdAt: new Date().toISOString(),
			userId: user.id
		};
		const { master } = await seedPlanning({
			title: "Wrong Pwd Test",
			participants: [alice],
			occurrenceCount: 0
		});

		const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
		pb.authStore.save(userPb.authStore.token, userPb.authStore.record);

		// La vérification du mot de passe (authWithPassword) rejette avant tout appel
		// à l'endpoint (pattern handlePasswordChange) : rien ne doit être modifié.
		await expect(
			pb.collection("users").authWithPassword(USER_EMAIL, "wrong-password")
		).rejects.toThrow();

		const adminPb = await authenticateAdmin();
		await expect(adminPb.collection("users").getOne(user.id)).resolves.toBeTruthy();
		const masterAfter = await adminGetMaster(master.id);
		const p = (masterAfter.participants as Participant[])[0];
		expect(p.userId).toBe(user.id);
		expect(p.hasQuit).toBeUndefined();
	});
});
