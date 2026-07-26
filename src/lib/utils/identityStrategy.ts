/**
 * Stratégie d'identité pour la page `/p/[token]` (deepening ADR-0009).
 *
 * Encapsule l'arbre de décision CAS A/B/C qui déterminait auparavant quelle
 * action entreprendre à l'arrivée sur un planning. Fonction pure — aucun
 * `$state`, aucun appel async, aucun import de store. La décision et la
 * réaction sont séparées : la stratégie décide, la page réagit via un `switch`
 * sur le `action.type`.
 *
 * Utilise `hasNameConflict` en interne pour la garde anti-doublon de nom du
 * CAS C. Ne duplique pas la règle ADR-0002 (`resolveCurrentIdentity`) — le
 * participant résolu (`myParticipant`) est attendu en entrée.
 */
import type { Participant, PlanningIdentity, PlanningMaster } from "$lib/types/planning.types";
import { hasNameConflict } from "$lib/utils/participantConflict";

// =============================================
// Types d'entrée / sortie
// =============================================

/** État figé au moment de l'appel — snapshot réactif consommé par la stratégie. */
export interface StrategyInput {
	/** Planning actif — `null` si la page n'a pas encore chargé le master. */
	master: PlanningMaster | null;
	/** Participant résolu pour l'utilisateur courant via `resolveCurrentIdentity`. */
	myParticipant: Participant | null;
	/** Utilisateur authentifié PocketBase. */
	isLoggedIn: boolean;
	/** Identité PocketBase si `isLoggedIn`. */
	pbUser: { id: string; name: string; email: string } | null;
	/** Identité guest locale (Dexie `localMeta`) pour ce planning. */
	guestIdentity: PlanningIdentity | null;
	/** true si l'utilisateur a déjà quitté ce planning (modal de retour à proposer). */
	hasQuitThisPlanning: boolean;
	/** true pendant la transition guest → auth (gardé pour éviter les races). */
	isTransitioning: boolean;
	/** Snapshot de l'identité guest capturé par `runAuthTransition` avant clear Dexie. */
	pendingGuestClaim: { masterId: string; participantId: string; name: string } | null;
	/** Masters pour lesquels un auto-add silencieux a déjà été fait (CAS C). */
	autoAddedMasterIds: Set<string>;
	/** `true` si le `IdentityClaimModal` est déjà ouvert (évite le re-trigger). */
	showClaimModal: boolean;
}

/**
 * Action décidée par la stratégie. Union discriminée par `type`.
 * La page exécute l'action via un `switch`.
 */
export type StrategyAction =
	| { type: "none" }
	| { type: "block_quit" }
	| { type: "silent_sync" }
	| { type: "show_claim_suggestion"; participant: Participant }
	| { type: "show_claim_modal"; suggestionParticipant: Participant | null }
	| {
			type: "auto_add";
			identity: PlanningIdentity;
			additionalFields: Partial<Participant>;
	  }
	| { type: "identify_as_guest" };

/** Résultat de la stratégie. */
export interface StrategyResult {
	/** Action à exécuter. */
	action: StrategyAction;
	/**
	 * `true` quand le `pendingGuestClaim` est obsolète et doit être expiré
	 * via `authTransition.clearPendingGuestClaim()`. Couvre deux cas :
	 * - CAS A (`silent_sync`) : l'utilisateur est déjà lié, la suggestion n'a plus de sens.
	 * - Suggestion invalide (participant claimé ailleurs, quitté, supprimé) qui
	 *   retombe sur CAS B/C : on l'expire avant d'exécuter l'action suivante.
	 */
	expirePendingClaim: boolean;
}

// =============================================
// Stratégie
// =============================================

/**
 * Résout l'action à entreprendre à l'arrivée sur un planning.
 *
 * Chaîne de priorité (court-circuite au premier match) :
 * 1. Garde `master`/`isTransitioning` → `none`
 * 2. Garde `hasQuitThisPlanning` → `block_quit`
 * 3. Auth user :
 *    - CAS A (`myParticipant` lié via `userId`) → `silent_sync`
 *    - Modal déjà ouvert → `none` (préserve l'état courant)
 *    - Suggestion `pendingGuestClaim` valide → `show_claim_suggestion`
 *    - CAS B (name match) → `show_claim_modal`
 *    - CAS C (name conflict) → `show_claim_modal`
 *    - CAS C (pas de conflit) → `auto_add`
 *    - Déjà auto-ajouté → `none`
 * 4. Guest sans identité → `identify_as_guest`
 * 5. Guest déjà identifié → `none`
 *
 * @returns L'action à exécuter et si le `pendingGuestClaim` doit être expiré.
 */
export function resolveIdentityStrategy(input: StrategyInput): StrategyResult {
	const {
		master,
		myParticipant,
		isLoggedIn,
		pbUser,
		guestIdentity,
		hasQuitThisPlanning,
		isTransitioning,
		pendingGuestClaim,
		autoAddedMasterIds,
		showClaimModal
	} = input;

	// Garde 1 : page pas prête ou transition guest→auth en cours
	if (!master || isTransitioning) {
		return none(false);
	}

	// Garde 2 : retour après quit — bloquer avant tout CAS A/B/C
	if (hasQuitThisPlanning) {
		return { action: { type: "block_quit" }, expirePendingClaim: false };
	}

	// === Utilisateur authentifié ===
	if (isLoggedIn && pbUser) {
		// CAS A : déjà participant via userId → sync silencieuse. La suggestion
		// éventuelle est obsolète (l'utilisateur est déjà lié à un participant).
		if (myParticipant) {
			return { action: { type: "silent_sync" }, expirePendingClaim: true };
		}

		// Modal déjà ouvert : ne pas re-déclencher CAS B/C. Préserve l'état
		// courant (suggestion en cours ou étape principale affichée).
		if (showClaimModal) {
			return none(false);
		}

		// Suggestion de claim : transition guest→auth sur CE planning. Prioritaire
		// sur CAS B/C — l'utilisateur doit pouvoir réclamer son identité guest
		// avant tout auto-add.
		if (pendingGuestClaim?.masterId === master.id) {
			const target = master.participants.find(
				(p) => p.id === pendingGuestClaim.participantId && !p.userId && !p.hasQuit
			);
			if (target) {
				return {
					action: { type: "show_claim_suggestion", participant: target },
					expirePendingClaim: false
				};
			}
			// Sinon : snapshot invalide (claimé ailleurs, quitté, supprimé).
			// On continue vers CAS B/C en signalant l'expiration.
		}

		const isPendingClaimStale =
			pendingGuestClaim?.masterId === master.id &&
			!master.participants.some(
				(p) => p.id === pendingGuestClaim.participantId && !p.userId && !p.hasQuit
			);

		// CAS B : name match case-insensitive avec un participant non-lié sans hasQuit
		const nameMatch = master.participants.find(
			(p) => !p.userId && !p.hasQuit && p.name.toLowerCase() === pbUser.name.toLowerCase()
		);
		if (nameMatch) {
			return {
				action: { type: "show_claim_modal", suggestionParticipant: null },
				expirePendingClaim: isPendingClaimStale
			};
		}

		// CAS C : pas de name match. Garde anti-doublon via hasNameConflict
		// (double exclusion userId ET id pour ne pas re-déclencher après un claim).
		const nameConflict = hasNameConflict(master.participants, pbUser.name, pbUser.id);
		if (nameConflict) {
			return {
				action: { type: "show_claim_modal", suggestionParticipant: null },
				expirePendingClaim: isPendingClaimStale
			};
		}

		// CAS C : auto-add silencieux. Garde contre les re-déclenchements avant
		// que l'update Dexie ne se propage.
		if (!autoAddedMasterIds.has(master.id)) {
			return {
				action: {
					type: "auto_add",
					identity: { id: pbUser.id, name: pbUser.name, email: pbUser.email },
					additionalFields: { userId: pbUser.id }
				},
				expirePendingClaim: isPendingClaimStale
			};
		}

		// Garde contre les re-déclenchements avant propagation Dexie (autoAddedMasterIds)
		return none(isPendingClaimStale);
	}

	// === Guest ===
	if (!guestIdentity) {
		return { action: { type: "identify_as_guest" }, expirePendingClaim: false };
	}

	// Guest identifié, aucun effet de bord nécessaire
	return none(false);
}

function none(expirePendingClaim: boolean): StrategyResult {
	return { action: { type: "none" }, expirePendingClaim };
}
