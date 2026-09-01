/**
 * Tests unitaires de `resolveCurrentIdentity` — fonction pure.
 * Couvre les 5 cas de la règle ADR-0002.
 * Aucun montage Svelte, ~5ms/test.
 */
import { describe, expect, it } from "vitest";
import type { Participant, PlanningIdentity } from "$lib/types/planning.types";
import type { IdentityInput, IdentityResolution } from "$lib/utils/identityResolution";
import { resolveCurrentIdentity } from "$lib/utils/identityResolution";

// =============================================
// Helpers
// =============================================

const GUEST_ID: PlanningIdentity = { id: "guest-1", name: "Alice" };
const PB_USER = { id: "pb-1", name: "Alice Auth", email: "alice@test.com" };

const PARTICIPANT_GUEST: Participant = {
	id: "guest-1",
	name: "Alice",
	isAdmin: false,
	createdAt: "2026-01-01T00:00:00Z"
};

const PARTICIPANT_WITH_USER_ID: Participant = {
	id: "participant-1",
	name: "Alice",
	isAdmin: false,
	createdAt: "2026-01-01T00:00:00Z",
	userId: "pb-1"
};

const PARTICIPANT_CLAIMED: Participant = {
	id: "guest-1",
	name: "Alice",
	isAdmin: false,
	createdAt: "2026-01-01T00:00:00Z",
	userId: "pb-remote"
};

/** Post-claim par le compte courant : le participant guest garde son id (clé des données), seul userId est posé. */
const PARTICIPANT_GUEST_CLAIMED: Participant = {
	id: "guest-1",
	name: "Alice",
	isAdmin: false,
	createdAt: "2026-01-01T00:00:00Z",
	userId: "pb-1"
};

function makeInput(overrides: Partial<IdentityInput> = {}): IdentityInput {
	return {
		isLoggedIn: false,
		pbUser: null,
		guestIdentity: null,
		participants: [],
		...overrides
	};
}

// =============================================
// Tests
// =============================================

describe("resolveCurrentIdentity", () => {
	it("CAS 1 — guest sans identité locale : null identity, null participant", () => {
		const result = resolveCurrentIdentity(makeInput({ participants: [PARTICIPANT_GUEST] }));

		expect(result).toEqual<IdentityResolution>({
			participant: null,
			identity: null,
			claimedByAuth: false
		});
	});

	it("CAS 2 — guest avec identité locale et participant matching : retourne les deux", () => {
		const result = resolveCurrentIdentity(
			makeInput({
				guestIdentity: GUEST_ID,
				participants: [PARTICIPANT_GUEST]
			})
		);

		expect(result).toEqual<IdentityResolution>({
			participant: PARTICIPANT_GUEST,
			identity: GUEST_ID,
			claimedByAuth: false
		});
	});

	it("CAS 2 — guest avec identité locale mais pas de participant matching : identity mais pas de participant", () => {
		// L'identité guest existe localement mais aucun participant dans le planning
		// n'a cet id — possible si le participant a été supprimé côté serveur.
		const result = resolveCurrentIdentity(
			makeInput({
				guestIdentity: GUEST_ID,
				participants: [PARTICIPANT_WITH_USER_ID]
			})
		);

		expect(result).toEqual<IdentityResolution>({
			participant: null,
			identity: GUEST_ID,
			claimedByAuth: false
		});
	});

	it("CAS 3 — guest dont le participant a un userId (revendiqué cross-device) : claimedByAuth", () => {
		const result = resolveCurrentIdentity(
			makeInput({
				guestIdentity: GUEST_ID,
				participants: [PARTICIPANT_CLAIMED]
			})
		);

		expect(result).toEqual<IdentityResolution>({
			participant: null,
			identity: null,
			claimedByAuth: true
		});
	});

	it("CAS 4 — auth user avec participant lié via userId : identity alignée sur le participant", () => {
		// Après un claim, participant.id ≠ pbUser.id (seul userId est posé).
		// Les données du planning (réponses, commentaires, quit) étant keyées par
		// participant.id, l'identité opérationnelle doit porter participant.id.
		const result = resolveCurrentIdentity(
			makeInput({
				isLoggedIn: true,
				pbUser: PB_USER,
				participants: [PARTICIPANT_WITH_USER_ID]
			})
		);

		expect(result).toEqual<IdentityResolution>({
			participant: PARTICIPANT_WITH_USER_ID,
			identity: { id: "participant-1", name: "Alice", email: "alice@test.com" },
			claimedByAuth: false
		});
	});

	it("auth claimé : identity.id référence le participant claimé (clé des réponses migrées)", () => {
		// Régression bug « boucle du modal d'identité » : currentUserId (= identity.id)
		// devait retrouver le participant via participants.find(p => p.id === currentUserId),
		// sinon occurrenceState déclenchait onNeedReidentify en boucle.
		const result = resolveCurrentIdentity(
			makeInput({
				isLoggedIn: true,
				pbUser: PB_USER,
				participants: [PARTICIPANT_GUEST_CLAIMED]
			})
		);

		const currentUserId = result.identity?.id;
		const found = [PARTICIPANT_GUEST_CLAIMED].find((p) => p.id === currentUserId);

		expect(found).toBe(PARTICIPANT_GUEST_CLAIMED);
		expect(result.identity?.name).toBe("Alice"); // nom du planning, suit les renames
	});

	it("auth claimé : currentResponse retrouvé — les réponses restent keyées par participant.id", () => {
		const result = resolveCurrentIdentity(
			makeInput({
				isLoggedIn: true,
				pbUser: PB_USER,
				participants: [PARTICIPANT_GUEST_CLAIMED]
			})
		);

		const responses = [{ participantId: "guest-1", response: "present", tasks: [] }];
		const currentResponse = responses.find((r) => r.participantId === result.identity?.id);

		expect(currentResponse).toBeDefined();
	});

	it("CAS 5 — auth user sans participant lié : pbUser, pas de participant", () => {
		const result = resolveCurrentIdentity(
			makeInput({
				isLoggedIn: true,
				pbUser: PB_USER,
				participants: [PARTICIPANT_GUEST]
			})
		);

		expect(result).toEqual<IdentityResolution>({
			participant: null,
			identity: PB_USER,
			claimedByAuth: false
		});
	});

	it("auth sans pbUser.record (edge case) : identité non résolvable", () => {
		// isLoggedIn true mais pbUser null (auth store valid mais record pas encore chargé).
		// On ne peut pas résoudre d'identité guest non plus (le mode auth prime).
		const result = resolveCurrentIdentity(
			makeInput({
				isLoggedIn: true,
				pbUser: null,
				guestIdentity: GUEST_ID,
				participants: [PARTICIPANT_GUEST]
			})
		);

		expect(result).toEqual<IdentityResolution>({
			participant: null,
			identity: null,
			claimedByAuth: false
		});
	});

	it("participants vides : aucun participant trouvé", () => {
		const result = resolveCurrentIdentity(
			makeInput({
				isLoggedIn: true,
				pbUser: PB_USER
			})
		);

		expect(result).toEqual<IdentityResolution>({
			participant: null,
			identity: PB_USER,
			claimedByAuth: false
		});
	});

	it("claimedByAuth prioritaire sur guest matching : participant avec userId prime", () => {
		// Même si l'identité guest locale match un participant, si ce participant
		// a un userId, c'est claimedByAuth (cross-device).
		const claimedMatch: Participant = {
			...PARTICIPANT_GUEST,
			userId: "pb-remote"
		};
		const result = resolveCurrentIdentity(
			makeInput({
				guestIdentity: GUEST_ID,
				participants: [claimedMatch]
			})
		);

		expect(result.claimedByAuth).toBe(true);
		expect(result.identity).toBeNull();
	});
});
