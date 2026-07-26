import type { Participant } from "$lib/types/planning.types";

/**
 * Détecte un conflit de nom (case-insensitive) entre un nom donné et les participants
 * actifs d'un planning, en excluant les participants appartenant à l'utilisateur
 * courant (par `userId` pour un participant claimé, ou par `id` pour le participant
 * auto-ajouté du CAS C dont l'id vaut déjà `pbUser.id`).
 *
 * Garantit l'invariante « un nom unique par planning parmi les participants actifs »,
 * cœur du fix anti-doublon de la garde CAS C dans `/p/[token]/+page.svelte`.
 *
 * @param participants Liste des participants du master.
 * @param name Nom à tester (typiquement `pbUser.name`).
 * @param currentUserId ID du compte authentifié (typiquement `pbUser.id`).
 * @returns true si un autre participant actif porte déjà ce nom.
 */
export function hasNameConflict(
	participants: Participant[],
	name: string,
	currentUserId: string
): boolean {
	const normalized = name.trim().toLowerCase();
	if (!normalized) return false;
	return participants.some(
		(p) =>
			!p.hasQuit &&
			p.userId !== currentUserId &&
			p.id !== currentUserId &&
			p.name.toLowerCase() === normalized
	);
}
