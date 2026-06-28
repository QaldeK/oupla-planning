/**
 * Tests unitaires — hasNameConflict : détection de conflit de nom (case-insensitive)
 * entre un nom et les participants actifs d'un planning.
 *
 * Ce helper porte l'invariante « un nom unique par planning parmi les participants
 * actifs (non-hasQuit) », cœur du fix anti-doublon de la garde CAS C dans
 * `/p/[token]/+page.svelte`. Les exclusions par `userId` ET par `id` couvrent :
 *   - `userId === currentUserId` : participant claimé (auth déjà lié via le snapshot)
 *   - `id === currentUserId` : participant auto-ajouté du CAS C (id = pbUser.id)
 * Sans la seconde exclusion, la garde se re-déclencherait indéfiniment après un
 * claim réussi (le participant claimé porte toujours le nom, son id reste l'UUID
 * guest ≠ pbUser.id).
 */
import { describe, it, expect } from 'vitest';
import { hasNameConflict } from '$lib/utils/participantConflict';
import type { Participant } from '$lib/types/planning.types';

const CURRENT_USER_ID = 'user-auth-1';

function makeParticipant(overrides: Partial<Participant> = {}): Participant {
	return {
		id: 'p-' + Math.random().toString(36).slice(2, 8),
		name: 'Anonymous',
		isAdmin: false,
		createdAt: new Date().toISOString(),
		...overrides
	};
}

describe("hasNameConflict — invariante d'unicité du nom par planning", () => {
	it('retourne false quand aucun participant ne porte le nom', () => {
		const participants = [makeParticipant({ name: 'Alice' }), makeParticipant({ name: 'Bob' })];
		expect(hasNameConflict(participants, 'Charlie', CURRENT_USER_ID)).toBe(false);
	});

	it('détecte un conflit avec un guest (pas de userId)', () => {
		const participants = [makeParticipant({ name: 'Alice' })]; // guest : pas de userId
		expect(hasNameConflict(participants, 'Alice', CURRENT_USER_ID)).toBe(true);
	});

	it('détecte un conflit avec un user auth lié (userId défini)', () => {
		const participants = [makeParticipant({ name: 'Alice', userId: 'another-user-id' })];
		expect(hasNameConflict(participants, 'Alice', CURRENT_USER_ID)).toBe(true);
	});

	it("ignore un participant hasQuit même s'il porte le même nom", () => {
		const participants = [makeParticipant({ name: 'Alice', hasQuit: true })];
		expect(hasNameConflict(participants, 'Alice', CURRENT_USER_ID)).toBe(false);
	});

	it("exclut le participant claimé par l'user courant (userId === currentUserId)", () => {
		// Cas clé du re-déclenchement : après un claim réussi, le participant
		// claimé porte toujours le nom mais son userId est désormais posé.
		const participants = [makeParticipant({ name: 'Alice', userId: CURRENT_USER_ID })];
		expect(hasNameConflict(participants, 'Alice', CURRENT_USER_ID)).toBe(false);
	});

	it('exclut le participant auto-ajouté du CAS C (id === currentUserId)', () => {
		// Le CAS C crée un participant avec id = pbUser.id (avant le check, userId
		// n'est pas encore posé côté Dexie). Sans cette exclusion, la garde
		// bloquerait son propre auto-add.
		const participants = [makeParticipant({ id: CURRENT_USER_ID, name: 'Alice' })];
		expect(hasNameConflict(participants, 'Alice', CURRENT_USER_ID)).toBe(false);
	});

	it('est insensible à la casse ("Alice" vs "alice")', () => {
		const participants = [makeParticipant({ name: 'Alice' })];
		expect(hasNameConflict(participants, 'alice', CURRENT_USER_ID)).toBe(true);
		expect(hasNameConflict(participants, 'ALICE', CURRENT_USER_ID)).toBe(true);
		expect(hasNameConflict(participants, 'aLiCe', CURRENT_USER_ID)).toBe(true);
	});

	it('retourne false pour un nom vide ou composé uniquement de whitespace', () => {
		const participants = [makeParticipant({ name: 'Alice' })];
		expect(hasNameConflict(participants, '', CURRENT_USER_ID)).toBe(false);
		expect(hasNameConflict(participants, '   ', CURRENT_USER_ID)).toBe(false);
	});

	it('retourne false quand les participants ont des noms différents', () => {
		const participants = [
			makeParticipant({ name: 'Alice' }),
			makeParticipant({ name: 'Bob' }),
			makeParticipant({ name: 'Charlie' })
		];
		expect(hasNameConflict(participants, 'Dave', CURRENT_USER_ID)).toBe(false);
	});

	// --- Cas combinés pour durcir la confiance dans l'invariante ---

	it('détecte le conflit parmi un mélange de participants (actif, hasQuit, claimé)', () => {
		const participants = [
			makeParticipant({ name: 'Alice', hasQuit: true }), // ignoré
			makeParticipant({ name: 'Alice', userId: CURRENT_USER_ID }), // exclu (claimé par moi)
			makeParticipant({ id: CURRENT_USER_ID, name: 'Alice' }), // exclu (auto-add CAS C)
			makeParticipant({ name: 'Alice' }), // ← conflit (guest actif)
			makeParticipant({ name: 'Bob' })
		];
		expect(hasNameConflict(participants, 'Alice', CURRENT_USER_ID)).toBe(true);
	});

	it("retourne false si les seuls homonymes sont hasQuit ou appartiennent à l'user courant", () => {
		const participants = [
			makeParticipant({ name: 'Alice', hasQuit: true }),
			makeParticipant({ name: 'Alice', userId: CURRENT_USER_ID }),
			makeParticipant({ id: CURRENT_USER_ID, name: 'Alice' })
		];
		expect(hasNameConflict(participants, 'Alice', CURRENT_USER_ID)).toBe(false);
	});

	it('détecte aussi un conflit quand le nom saisi a des whitespace autour', () => {
		// Le helper normalise (trim+lowercase) le nom testé, pas les noms des participants.
		const participants = [makeParticipant({ name: 'Alice' })];
		expect(hasNameConflict(participants, '  Alice  ', CURRENT_USER_ID)).toBe(true);
	});
});
