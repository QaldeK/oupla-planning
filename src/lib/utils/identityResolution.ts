/**
 * Règle de résolution d'identité par planning (ADR-0002).
 *
 * Fonction pure — aucun `$state`, aucun import de store.
 * La règle arbitre entre auth et guest selon :
 *   auth > guest > identité revendiquée cross-device (claimedByAuth)
 */
import type { Participant, PlanningIdentity } from "$lib/types/planning.types";

// =============================================
// Types d'entrée / sortie
// =============================================

/** Entrée de la résolution — état figé au moment de l'appel. */
export interface IdentityInput {
	/** L'utilisateur est connecté à PocketBase */
	isLoggedIn: boolean;
	/** L'identité PocketBase (si connecté) */
	pbUser: { id: string; name: string; email: string } | null;
	/** L'identité guest stockée localement pour ce planning */
	guestIdentity: PlanningIdentity | null;
	/** La liste des participants du planning */
	participants: Participant[];
}

/** Résultat de la résolution d'identité. */
export interface IdentityResolution {
	/**
	 * Le participant correspondant dans le planning, s'il existe.
	 * - Auth : participant dont `userId` match `pbUser.id`
	 * - Guest : participant dont `id` match `guestIdentity.id`
	 */
	participant: Participant | null;
	/**
	 * L'identité résolue (pour l'affichage, les requêtes).
	 * - Auth avec participant lié : identité **alignée sur le participant**
	 *   (`id = participant.id`, `name = participant.name`) — les données d'un
	 *   planning (réponses, commentaires, quit) sont keyées par `participant.id`,
	 *   qui diffère de `pbUser.id` après un claim d'identité guest.
	 * - Auth sans participant lié : `pbUser` (transitoire — la stratégie CAS B/C
	 *   enchaîne modal ou auto-add).
	 * - Guest : `guestIdentity`
	 * - `null` si guest sans identité locale, ou si identité revendiquée
	 */
	identity: PlanningIdentity | null;
	/**
	 * true si l'identité a été revendiquée par un compte auth sur un autre
	 * terminal (le participant a un `userId` mais l'utilisateur actuel n'est
	 * pas connecté). Dans ce cas, l'identité est verrouillée — le guest ne
	 * peut plus répondre.
	 */
	claimedByAuth: boolean;
}

// =============================================
// Résolution
// =============================================

/**
 * Résout l'identité pour un planning selon la règle ADR-0002.
 *
 * @param input - L'état figé au moment de la résolution
 * @returns Le participant, l'identité affichable, et si l'identité est
 *          verrouillée par un compte auth cross-device
 */
export function resolveCurrentIdentity(input: IdentityInput): IdentityResolution {
	const { isLoggedIn, pbUser, guestIdentity, participants } = input;

	// CAS 4 & 5 : Auth user
	if (isLoggedIn && pbUser) {
		const participant = participants.find((p) => p.userId === pbUser.id) ?? null;
		return {
			participant,
			// Invariant : quand un participant est résolu, l'identité opérationnelle
			// porte participant.id (la clé des données). Après un claim, l'id du
			// participant reste l'uuid guest — utiliser pbUser.id casserait toute
			// écriture (réponses, commentaires) et le guard de re-identification.
			identity: participant
				? { id: participant.id, name: participant.name, email: pbUser.email }
				: pbUser,
			claimedByAuth: false
		};
	}

	// CAS 3 : Guest dont le participant a été revendiqué par un auth user
	if (!isLoggedIn && guestIdentity) {
		const participant = participants.find((p) => p.id === guestIdentity.id) ?? null;
		if (participant?.userId) {
			return {
				participant: null,
				identity: null,
				claimedByAuth: true
			};
		}
	}

	// CAS 2 : Guest avec identité locale et participant matching
	if (!isLoggedIn && guestIdentity) {
		const participant = participants.find((p) => p.id === guestIdentity.id) ?? null;
		return {
			participant,
			identity: guestIdentity,
			claimedByAuth: false
		};
	}

	// CAS 1 : Guest sans identité locale
	return {
		participant: null,
		identity: null,
		claimedByAuth: false
	};
}

// =============================================
// Résolution légère (sans participant matching)
// =============================================

/**
 * Identité courante (auth prioritaire sur guest) SANS matching de participant
 * ni détection claimedByAuth. Pour les sites qui ont juste besoin de « qui
 * suis-je » (lock admin, archives, backfill commentaire) là où la résolution
 * complète ADR-0002 (resolveCurrentIdentity) serait surdimensionnée.
 *
 * Concentre la précédence auth > guest en un seul endroit pour empêcher la
 * divergence entre les call sites.
 */
export function resolveActorIdentity(input: {
	pbUser: { id: string; name: string } | null;
	guestIdentity: PlanningIdentity | null;
}): { id: string; name: string } | null {
	if (input.pbUser) return { id: input.pbUser.id, name: input.pbUser.name };
	if (input.guestIdentity) return { id: input.guestIdentity.id, name: input.guestIdentity.name };
	return null;
}
