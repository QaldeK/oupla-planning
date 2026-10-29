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

import { mastersCollection, occurrencesCollection } from "$lib/data/collections";
import { db } from "$lib/pb-sync/db";
import { syncAuthData } from "$lib/services/authDataSync";
import { claimPlannings } from "$lib/services/claimPlannings";
import { commentStateService } from "$lib/services/commentStateService";
import { syncPushSubscription } from "$lib/services/push";
import { guestStateStore } from "$lib/stores/guestStateStore.svelte";
import { installStore } from "$lib/stores/installStore.svelte";
import { planningStore } from "$lib/stores/planningStore.svelte";
import { userStore } from "$lib/stores/userStore.svelte";
import { pb } from "$lib/pocketbase/pb";
import type { AuthTransitionResult } from "$lib/utils/authTransition";
import { runAuthTransition } from "$lib/utils/authTransition";

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
	 * Consentement au portage des plannings locaux (bascule du mur
	 * d'authentification, mode création de compte). Posé réactivement par le
	 * mur avant submit, consommé puis réinitialisé par la transition
	 * ci-dessous — un login ultérieur repart du défaut (pas de portage).
	 * Jamais posé hors mur : le parcours navigateur reste au comportement
	 * standard.
	 */
	wallPortageConsent = $state(false);

	/**
	 * Déclenche la transition guest → auth.
	 * Appelé par le callback pb.authStore.onChange de userStore.
	 * Les erreurs sont catchées en interne — l'appelant reste protégé.
	 */
	async transitionToAuth(): Promise<void> {
		// Guard : empêche les $effect des pages de réagir à un état intermédiaire
		this.isTransitioning = true;

		// Portage mur : double garde — l'origine (app installée : le mur est la
		// seule surface de login en contexte standalone) ET le consentement
		// explicite. Consommé ici, atomiquement avec la lecture.
		const portage = installStore.isInstalled && this.wallPortageConsent;
		this.wallPortageConsent = false;

		try {
			const deps = {
				planningStore,
				mastersCollection,
				occurrencesCollection,
				claimPlannings,
				// Propage masterId/adminOf du claim batch au record d'auth local.
				refreshAuthRecord: async () => {
					await pb.collection("users").authRefresh();
				},
				// Le marqueur de fraîcheur appartient à userStore (ADR 0009) ;
				// son moment appartient à syncAuthData.
				syncAuthData: () => syncAuthData(() => userStore.markAuthSynced()),
				commentStateService,
				db,
			};

			const ctx = {
				currentToken: planningStore.currentToken,
				activeMasterId: planningStore.activeMasterId,
				savedPlannings: guestStateStore.guestStates,
				portage,
			};

			const result: AuthTransitionResult = await runAuthTransition(ctx, deps);
			this.pendingGuestClaim = result.guestClaim;
			// Pas de cleanup Dexie ici : runAuthTransition a déjà fait le teardown
			// (étape 5 vide db.localMeta — sauf portage, où les identités guest
			// survivent délibérément comme indice de suggestion durable).
			// Le marqueur lastFetchAt (ré)écrit ultérieurement par planningStore lors
			// d'une activation ou re-sync doit pouvoir coexister sans être wipe hors
			// du périmètre de guestStateStore (modèle de propriété ADR 0009).
		} catch (err) {
			console.error("transitionToAuth failed:", err);
		} finally {
			this.isTransitioning = false;
		}

		// Réactivation push silencieuse après login — fire-and-forget : ne doit
		// jamais bloquer ni faire échouer la transition (aucun prompt ici).
		syncPushSubscription().catch((err) => console.error("push sync failed:", err));
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
