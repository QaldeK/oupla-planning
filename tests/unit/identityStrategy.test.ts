/**
 * Tests unitaires de `resolveIdentityStrategy` — fonction pure, pas de montage
 * composant, pas de DOM, pas de store. Objectif : ~5ms par test, un concept
 * par test, couvrir tous les chemins de l'arbre CAS A/B/C.
 *
 * Couvre les 9 chemins listés dans `.scratch/identity-auth-split/spec.md` §5
 * (PR 2 — gate obligatoire avant branchement dans `/p/[token]/+page.svelte`).
 */
import { describe, expect, it } from "vitest";
import type { Participant, PlanningMaster } from "$lib/types/planning.types";
import { resolveIdentityStrategy, type StrategyInput } from "$lib/utils/identityStrategy";

// =============================================
// Fabriques de fixtures
// =============================================

function makeParticipant(overrides: Partial<Participant> = {}): Participant {
	return {
		id: "p1",
		name: "Alice",
		isAdmin: false,
		createdAt: "2026-01-01T00:00:00.000Z",
		...overrides
	};
}

function makeMaster(overrides: Partial<PlanningMaster> = {}): PlanningMaster {
	return {
		id: "m1",
		title: "Planning test",
		defaultStartTime: "14:00",
		defaultEndTime: "18:00",
		minPresentRequired: 1,
		allowResponses: true,
		recurrence: { type: "WEEKLY", firstDate: "2026-01-07", lastDate: "2026-03-31" },
		tasks: [],
		participants: [],
		created: "2026-01-01T00:00:00.000Z",
		updated: "2026-01-01T00:00:00.000Z",
		...overrides
	};
}

function makeInput(overrides: Partial<StrategyInput> = {}): StrategyInput {
	return {
		master: makeMaster(),
		myParticipant: null,
		isLoggedIn: false,
		pbUser: null,
		guestIdentity: null,
		hasQuitThisPlanning: false,
		isTransitioning: false,
		pendingGuestClaim: null,
		autoAddedMasterIds: new Set<string>(),
		showClaimModal: false,
		...overrides
	};
}

const PB_USER = { id: "u1", name: "Bob", email: "bob@example.com" };

// =============================================
// Gardes
// =============================================

describe("resolveIdentityStrategy — gardes", () => {
	it("master null → none (page pas prête)", () => {
		const result = resolveIdentityStrategy(makeInput({ master: null }));
		expect(result.action).toEqual({ type: "none" });
		expect(result.expirePendingClaim).toBe(false);
	});

	it("isTransitioning=true → none (transition guest→auth en cours)", () => {
		const result = resolveIdentityStrategy(makeInput({ isTransitioning: true }));
		expect(result.action).toEqual({ type: "none" });
		expect(result.expirePendingClaim).toBe(false);
	});

	it("hasQuitThisPlanning=true → block_quit (retour après quit)", () => {
		const result = resolveIdentityStrategy(
			makeInput({ hasQuitThisPlanning: true, isLoggedIn: true, pbUser: PB_USER })
		);
		expect(result.action).toEqual({ type: "block_quit" });
		expect(result.expirePendingClaim).toBe(false);
	});

	it("hasQuitThisPlanning prend la priorité sur CAS A même si myParticipant est lié", () => {
		// Garde quit avant tout — l'utilisateur ne peut pas répondre tant qu'il
		// n'a pas choisi de rejoindre ou quitter définitivement.
		const result = resolveIdentityStrategy(
			makeInput({
				hasQuitThisPlanning: true,
				isLoggedIn: true,
				pbUser: PB_USER,
				myParticipant: makeParticipant({ userId: PB_USER.id })
			})
		);
		expect(result.action.type).toBe("block_quit");
	});
});

// =============================================
// CAS A — silent_sync
// =============================================

describe("resolveIdentityStrategy — CAS A (silent_sync)", () => {
	it("participant lié via userId → silent_sync + expirePendingClaim", () => {
		// CAS A : user déjà lié. La suggestion éventuelle est obsolète.
		const result = resolveIdentityStrategy(
			makeInput({
				isLoggedIn: true,
				pbUser: PB_USER,
				myParticipant: makeParticipant({ userId: PB_USER.id }),
				pendingGuestClaim: { masterId: "m1", participantId: "p1", name: "Alice" }
			})
		);
		expect(result.action).toEqual({ type: "silent_sync" });
		expect(result.expirePendingClaim).toBe(true);
	});

	it("CAS A sans pendingGuestClaim → silent_sync expire toujours (sécurité)", () => {
		const result = resolveIdentityStrategy(
			makeInput({
				isLoggedIn: true,
				pbUser: PB_USER,
				myParticipant: makeParticipant({ userId: PB_USER.id })
			})
		);
		expect(result.action).toEqual({ type: "silent_sync" });
		expect(result.expirePendingClaim).toBe(true); // CAS A expire toujours (sécurité)
	});
});

// =============================================
// Suggestion pendingGuestClaim
// =============================================

describe("resolveIdentityStrategy — suggestion pendingGuestClaim", () => {
	it("pendingGuestClaim valide → show_claim_suggestion avec le participant cible", () => {
		const target = makeParticipant({ id: "p-guest", name: "Guest Alice" });
		const result = resolveIdentityStrategy(
			makeInput({
				master: makeMaster({ participants: [target] }),
				isLoggedIn: true,
				pbUser: PB_USER,
				pendingGuestClaim: {
					masterId: "m1",
					participantId: "p-guest",
					name: "Guest Alice"
				}
			})
		);
		expect(result.action).toEqual({
			type: "show_claim_suggestion",
			participant: target
		});
		expect(result.expirePendingClaim).toBe(false);
	});

	it("pendingGuestClaim pour un autre master → ignoré, retombe sur CAS B/C", () => {
		// Le snapshot vient d'un autre planning — pas applicable ici.
		const result = resolveIdentityStrategy(
			makeInput({
				master: makeMaster({ participants: [] }),
				isLoggedIn: true,
				pbUser: PB_USER,
				pendingGuestClaim: {
					masterId: "autre-master",
					participantId: "p-guest",
					name: "Guest Alice"
				}
			})
		);
		// Pas de name match, pas de conflit → auto_add
		expect(result.action.type).toBe("auto_add");
		expect(result.expirePendingClaim).toBe(false);
	});

	it("pendingGuestClaim invalide (participant claimé par un userId) → CAS B/C + expirePendingClaim", () => {
		// Participant cible a été claimé ailleurs (présence de userId).
		const claimed = makeParticipant({ id: "p-claimed", userId: "autre-user" });
		const result = resolveIdentityStrategy(
			makeInput({
				master: makeMaster({ participants: [claimed] }),
				isLoggedIn: true,
				pbUser: PB_USER,
				pendingGuestClaim: { masterId: "m1", participantId: "p-claimed", name: "X" }
			})
		);
		// Pas de name match (PB_USER.name='Bob' ≠ 'Alice'), pas de conflit → auto_add
		// mais pendingGuestClaim doit être expiré.
		expect(result.action.type).toBe("auto_add");
		expect(result.expirePendingClaim).toBe(true);
	});

	it("pendingGuestClaim invalide (participant hasQuit) → CAS B/C + expirePendingClaim", () => {
		const quit = makeParticipant({ id: "p-quit", hasQuit: true });
		const result = resolveIdentityStrategy(
			makeInput({
				master: makeMaster({ participants: [quit] }),
				isLoggedIn: true,
				pbUser: PB_USER,
				pendingGuestClaim: { masterId: "m1", participantId: "p-quit", name: "X" }
			})
		);
		expect(result.action.type).toBe("auto_add");
		expect(result.expirePendingClaim).toBe(true);
	});

	it("pendingGuestClaim valide MAIS modal déjà ouvert → none (préserve la suggestion en cours)", () => {
		const target = makeParticipant({ id: "p-guest" });
		const result = resolveIdentityStrategy(
			makeInput({
				master: makeMaster({ participants: [target] }),
				isLoggedIn: true,
				pbUser: PB_USER,
				pendingGuestClaim: { masterId: "m1", participantId: "p-guest", name: "X" },
				showClaimModal: true
			})
		);
		expect(result.action).toEqual({ type: "none" });
		expect(result.expirePendingClaim).toBe(false);
	});
});

// =============================================
// CAS B — name match
// =============================================

describe("resolveIdentityStrategy — CAS B (name match)", () => {
	it("name match case-insensitive → show_claim_modal (étape principale)", () => {
		const sameName = makeParticipant({ id: "p-bob", name: "bob" }); // lowercase
		const result = resolveIdentityStrategy(
			makeInput({
				master: makeMaster({ participants: [sameName] }),
				isLoggedIn: true,
				pbUser: PB_USER // name='Bob'
			})
		);
		expect(result.action).toEqual({
			type: "show_claim_modal",
			suggestionParticipant: null
		});
		expect(result.expirePendingClaim).toBe(false);
	});

	it("name match avec participant lié à un autre user → conflit (CAS C → modal)", () => {
		// CAS B ignore les participants liés (!p.userId), mais CAS C détecte quand
		// même le conflit via hasNameConflict : un autre user auth porte le même nom.
		const linkedToOther = makeParticipant({ id: "p-bob", name: "Bob", userId: "autre" });
		const result = resolveIdentityStrategy(
			makeInput({
				master: makeMaster({ participants: [linkedToOther] }),
				isLoggedIn: true,
				pbUser: PB_USER
			})
		);
		expect(result.action.type).toBe("show_claim_modal");
	});

	it("name match avec participant hasQuit → ignoré (CAS C auto-add)", () => {
		const quit = makeParticipant({ id: "p-bob", name: "Bob", hasQuit: true });
		const result = resolveIdentityStrategy(
			makeInput({
				master: makeMaster({ participants: [quit] }),
				isLoggedIn: true,
				pbUser: PB_USER
			})
		);
		// Pas de CAS B (hasQuit exclu). Pas de conflit (hasNameConflict exclut hasQuit).
		expect(result.action.type).toBe("auto_add");
	});
});

// =============================================
// CAS C — auto_add / conflit
// =============================================

describe("resolveIdentityStrategy — CAS C (auto_add)", () => {
	it("pas de name match, pas de conflit → auto_add avec userId", () => {
		const result = resolveIdentityStrategy(
			makeInput({
				master: makeMaster({ participants: [] }),
				isLoggedIn: true,
				pbUser: PB_USER
			})
		);
		expect(result.action).toEqual({
			type: "auto_add",
			identity: { id: "u1", name: "Bob", email: "bob@example.com" },
			additionalFields: { userId: "u1" }
		});
		expect(result.expirePendingClaim).toBe(false);
	});

	it("conflit de nom (autre participant actif porte le même nom) → show_claim_modal", () => {
		// Conflit : autre participant (non hasQuit, non lié à PB_USER) porte le nom 'Bob'.
		const conflict = makeParticipant({ id: "p-autre", name: "Bob" });
		const result = resolveIdentityStrategy(
			makeInput({
				master: makeMaster({ participants: [conflict] }),
				isLoggedIn: true,
				pbUser: PB_USER
			})
		);
		expect(result.action).toEqual({
			type: "show_claim_modal",
			suggestionParticipant: null
		});
	});

	it("déjà auto-ajouté (autoAddedMasterIds contient master.id) → none", () => {
		// Garde contre les re-déclenchements avant propagation Dexie.
		const result = resolveIdentityStrategy(
			makeInput({
				master: makeMaster({ participants: [] }),
				isLoggedIn: true,
				pbUser: PB_USER,
				autoAddedMasterIds: new Set(["m1"])
			})
		);
		expect(result.action).toEqual({ type: "none" });
		expect(result.expirePendingClaim).toBe(false);
	});
});

// =============================================
// Guest fallback
// =============================================

describe("resolveIdentityStrategy — guest", () => {
	it("guest sans identité locale → identify_as_guest", () => {
		const result = resolveIdentityStrategy(
			makeInput({ isLoggedIn: false, pbUser: null, guestIdentity: null })
		);
		expect(result.action).toEqual({ type: "identify_as_guest" });
		expect(result.expirePendingClaim).toBe(false);
	});

	it("guest déjà identifié → none (rien à faire)", () => {
		const result = resolveIdentityStrategy(
			makeInput({
				isLoggedIn: false,
				pbUser: null,
				guestIdentity: { id: "p-guest", name: "Alice" }
			})
		);
		expect(result.action).toEqual({ type: "none" });
		expect(result.expirePendingClaim).toBe(false);
	});
});
