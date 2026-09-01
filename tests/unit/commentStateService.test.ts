/**
 * Tests unitaires de commentStateService.backfillCommentState — résolution
 * claim-aware de l'id de participant (« suis-je dans la conversation »).
 *
 * Régression : les commentaires sont keyés par participant.id, qui diffère de
 * pbUser.id après un claim d'identité guest. Le backfill doit résoudre le
 * participant via participants[].userId, pas utiliser pbUser.id brut.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "$lib/pb-sync/db";
import { pb } from "$lib/pocketbase/pb";
import { commentStateService } from "$lib/services/commentStateService";
import { guestStateStore } from "$lib/stores/guestStateStore.svelte";
import type {
	OccurrenceComment,
	Participant,
	PlanningMaster,
	PlanningOccurrence
} from "$lib/types/planning.types";

const MASTER_ID = "m1";

/** Participant claimé par le compte pb-1 : id guest conservé (clé des données), userId posé. */
const CLAIMED_PARTICIPANT: Participant = {
	id: "guest-1",
	name: "Alice",
	isAdmin: false,
	createdAt: "2026-01-01T00:00:00Z",
	userId: "pb-1"
};

/** Participant auto-ajouté (CAS C) : id = pbUser.id par construction. */
const AUTO_ADDED_PARTICIPANT: Participant = {
	id: "pb-2",
	name: "Bob Auth",
	isAdmin: false,
	createdAt: "2026-01-01T00:00:00Z",
	userId: "pb-2"
};

function makeMaster(participants: Participant[]): PlanningMaster {
	return {
		id: MASTER_ID,
		title: "Test Planning",
		defaultStartTime: "20:00",
		defaultEndTime: "23:00",
		recurrence: { type: "WEEKLY" },
		participants
	} as unknown as PlanningMaster;
}

function makeOccurrence(id: string, comments: OccurrenceComment[]): PlanningOccurrence {
	return {
		id,
		master: MASTER_ID,
		date: "2026-01-05",
		startTime: "20:00",
		endTime: "23:00",
		responses: [],
		comments
	} as unknown as PlanningOccurrence;
}

function makeComment(id: string, participantId: string): OccurrenceComment {
	return { id, participantId, content: "Un commentaire", createdAt: "2026-01-02T10:00:00Z" };
}

async function seedMaster(participants: Participant[]) {
	await db.masters.put(makeMaster(participants));
}

describe("commentStateService.backfillCommentState — résolution claim-aware", () => {
	beforeEach(async () => {
		pb.authStore.clear();
		await db.masters.clear();
		await db.occurrences.clear();
		await db.commentState.clear();
		await db.localMeta.clear();
	});

	afterEach(() => {
		pb.authStore.clear();
	});

	it("auth claimé : isUserInConversation true — commentaires keyés par participant.id, pas pbUser.id", async () => {
		await seedMaster([CLAIMED_PARTICIPANT]);
		await db.occurrences.put(makeOccurrence("occ-1", [makeComment("c1", "guest-1")]));
		pb.authStore.save("fake-token", { id: "pb-1", name: "Alice" } as never);

		await commentStateService.backfillCommentState(MASTER_ID, await db.occurrences.toArray());

		const state = await db.commentState.get("occ-1");
		expect(state?.isUserInConversation).toBe(true);
	});

	it("auth auto-add (id = pbUser.id) : comportement inchangé", async () => {
		await seedMaster([AUTO_ADDED_PARTICIPANT]);
		await db.occurrences.put(makeOccurrence("occ-2", [makeComment("c2", "pb-2")]));
		pb.authStore.save("fake-token", { id: "pb-2", name: "Bob Auth" } as never);

		await commentStateService.backfillCommentState(MASTER_ID, await db.occurrences.toArray());

		const state = await db.commentState.get("occ-2");
		expect(state?.isUserInConversation).toBe(true);
	});

	it("guest : isUserInConversation via l'identité locale du planning", async () => {
		await seedMaster([CLAIMED_PARTICIPANT]);
		await db.occurrences.put(makeOccurrence("occ-3", [makeComment("c3", "guest-1")]));
		// Monte le miroir liveQuery (fait au boot dans l'app) puis écrit l'identité locale
		await guestStateStore.loadGuestState();
		await guestStateStore.setGuestIdentity(MASTER_ID, { id: "guest-1", name: "Alice" });

		await commentStateService.backfillCommentState(MASTER_ID, await db.occurrences.toArray());

		const state = await db.commentState.get("occ-3");
		expect(state?.isUserInConversation).toBe(true);
	});

	it("guest sans identité locale : aucune entrée créée", async () => {
		await seedMaster([CLAIMED_PARTICIPANT]);
		await db.occurrences.put(makeOccurrence("occ-4", [makeComment("c4", "guest-1")]));

		await commentStateService.backfillCommentState(MASTER_ID, await db.occurrences.toArray());

		expect(await db.commentState.get("occ-4")).toBeUndefined();
	});

	it("commentaires d'un autre participant : isUserInConversation false", async () => {
		await seedMaster([CLAIMED_PARTICIPANT]);
		await db.occurrences.put(makeOccurrence("occ-5", [makeComment("c5", "autre-1")]));
		pb.authStore.save("fake-token", { id: "pb-1", name: "Alice" } as never);

		await commentStateService.backfillCommentState(MASTER_ID, await db.occurrences.toArray());

		const state = await db.commentState.get("occ-5");
		expect(state?.isUserInConversation).toBe(false);
	});
});
