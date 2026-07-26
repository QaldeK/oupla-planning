/**
 * AuthTransition — wrapper réactif de la transition guest → auth.
 *
 * Gère les guards `isTransitioning` (empêche les $effect des pages de réagir
 * à un état intermédiaire) et `pendingGuestClaim` (snapshot de l'identité
 * guest consommé par `/p/[token]` pour proposer le modal de claim).
 *
 * Le wrapper instancie les deps réelles et appelle la fonction pure
 * `runAuthTransition` qui contient la logique d'orchestration.
 */
import { planningStore } from '$lib/stores/planningStore.svelte';
import { mastersCollection, occurrencesCollection } from '$lib/data/collections';
import { commentStateService } from '$lib/services/commentStateService';
import { pb } from '$lib/pocketbase/pb';
import { db } from '$lib/pb-sync/db';
import { runAuthTransition } from '$lib/utils/authTransition';
import { guestStateStore } from '$lib/stores/guestStateStore.svelte';
import type { AuthTransitionResult } from '$lib/utils/authTransition';

class AuthTransitionWrapper {
	/**
	 * True pendant une transition guest → auth.
	 * Utilisé par les $effect des pages pour éviter de déclencher des actions
	 * (auto-add participant, ouverture de modal) pendant que Dexie est en cours
	 * de clear + re-fetch.
	 */
	isTransitioning = $state(false);

	/**
	 * Snapshot de l'identité guest de session capturé pendant la transition,
	 * AVANT le clear de guestStates. Permet à /p/[token] de proposer directement
	 * la revendication de cette identité (modal de suggestion) au lieu de deviner
	 * par heuristique de nom.
	 *
	 * In-memory uniquement (non persisté) : une transition ne survit pas à un reload.
	 * Consommé/invalidé par la page /p/[token] après résolution.
	 */
	pendingGuestClaim: { masterId: string; participantId: string; name: string } | null =
		$state(null);

	/**
	 * Déclenche la transition guest → auth.
	 * Appelé par le callback pb.authStore.onChange de userStore.
	 * Les erreurs sont catchées en interne — l'appelant reste protégé.
	 */
	async transitionToAuth(): Promise<void> {
		// Guard : empêche les $effect des pages de réagir à un état intermédiaire
		this.isTransitioning = true;
		try {
			const deps = {
				planningStore,
				mastersCollection,
				occurrencesCollection,
				commentStateService,
				pb,
				db
			};

			const ctx = {
				currentToken: planningStore.currentToken,
				activeMasterId: planningStore.activeMasterId,
				savedPlannings: guestStateStore.guestStates
			};

			const result: AuthTransitionResult = await runAuthTransition(ctx, deps);
			this.pendingGuestClaim = result.guestClaim;
			// Pas de cleanup Dexie ici : runAuthTransition a déjà fait le teardown
			// (étape 5 vide db.localMeta). Le reset de guestStates est automatique —
			// la subscription liveQuery propage le [] vers le $state. Tout curseur
			// lastFetchAt (ré)écrit ultérieurement par planningStore lors d'une
			// activation ou delta-sync doit pouvoir coexister sans être wipe hors
			// du périmètre de guestStateStore (modèle de propriété ADR 0009).
		} catch (err) {
			console.error('transitionToAuth failed:', err);
		} finally {
			this.isTransitioning = false;
		}
	}

	/**
	 * Invalide le snapshot pendingGuestClaim. À appeler après résolution (claim,
	 * auto-add, refus) ou si le participant cible n'est plus claimable.
	 */
	clearPendingGuestClaim(): void {
		this.pendingGuestClaim = null;
	}
}

export const authTransition = new AuthTransitionWrapper();
