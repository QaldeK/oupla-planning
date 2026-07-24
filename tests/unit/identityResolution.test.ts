/**
 * Tests unitaires de `resolveCurrentIdentity` — fonction pure.
 * Couvre les 5 cas de la règle ADR-0002.
 * Aucun montage Svelte, ~5ms/test.
 */
import { describe, it, expect } from 'vitest';
import { resolveCurrentIdentity } from '$lib/utils/identityResolution';
import type { IdentityInput, IdentityResolution } from '$lib/utils/identityResolution';
import type { Participant, PlanningIdentity } from '$lib/types/planning.types';

// =============================================
// Helpers
// =============================================

const GUEST_ID: PlanningIdentity = { id: 'guest-1', name: 'Alice' };
const PB_USER = { id: 'pb-1', name: 'Alice Auth', email: 'alice@test.com' };

const PARTICIPANT_GUEST: Participant = {
	id: 'guest-1',
	name: 'Alice',
	isAdmin: false,
	createdAt: '2026-01-01T00:00:00Z'
};

const PARTICIPANT_WITH_USER_ID: Participant = {
	id: 'participant-1',
	name: 'Alice',
	isAdmin: false,
	createdAt: '2026-01-01T00:00:00Z',
	userId: 'pb-1'
};

const PARTICIPANT_CLAIMED: Participant = {
	id: 'guest-1',
	name: 'Alice',
	isAdmin: false,
	createdAt: '2026-01-01T00:00:00Z',
	userId: 'pb-remote'
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

describe('resolveCurrentIdentity', () => {
	it('CAS 1 — guest sans identité locale : null identity, null participant', () => {
		const result = resolveCurrentIdentity(makeInput({ participants: [PARTICIPANT_GUEST] }));

		expect(result).toEqual<IdentityResolution>({
			participant: null,
			identity: null,
			claimedByAuth: false
		});
	});

	it('CAS 2 — guest avec identité locale et participant matching : retourne les deux', () => {
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

	it('CAS 2 — guest avec identité locale mais pas de participant matching : identity mais pas de participant', () => {
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

	it('CAS 3 — guest dont le participant a un userId (revendiqué cross-device) : claimedByAuth', () => {
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

	it('CAS 4 — auth user avec participant lié via userId : pbUser + participant', () => {
		const result = resolveCurrentIdentity(
			makeInput({
				isLoggedIn: true,
				pbUser: PB_USER,
				participants: [PARTICIPANT_WITH_USER_ID]
			})
		);

		expect(result).toEqual<IdentityResolution>({
			participant: PARTICIPANT_WITH_USER_ID,
			identity: PB_USER,
			claimedByAuth: false
		});
	});

	it('CAS 5 — auth user sans participant lié : pbUser, pas de participant', () => {
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

	it('auth sans pbUser.record (edge case) : identité non résolvable', () => {
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

	it('participants vides : aucun participant trouvé', () => {
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

	it('claimedByAuth prioritaire sur guest matching : participant avec userId prime', () => {
		// Même si l'identité guest locale match un participant, si ce participant
		// a un userId, c'est claimedByAuth (cross-device).
		const claimedMatch: Participant = {
			...PARTICIPANT_GUEST,
			userId: 'pb-remote'
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
