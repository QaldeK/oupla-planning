/**
 * Orchestration pure de la transition guest → auth.
 *
 * Fonction pure — aucun `$state`, toutes les dépendances sont injectées
 * via le paramètre `deps`. Le wrapper réactif (`authTransition.svelte.ts`)
 * instancie les deps réelles et gère les guards (`isTransitioning`).
 */
import type { SavedPlanning } from "$lib/types/planning.types";

// =============================================
// Types
// =============================================

/** Contexte figé au moment de l'appel (snapshot de l'état courant). */
export interface AuthTransitionContext {
	/** Token actif (participant ou admin) — null si aucune page */
	currentToken: string | null;
	/** ID du planning actif — null si aucune page active */
	activeMasterId: string | null;
	/**
	 * Snapshot des savedPlannings AVANT clear.
	 * Permet de capturer l'identité guest avant qu'elle ne soit effacée.
	 */
	savedPlannings: SavedPlanning[];
}

/** Dépendances injectées pour la transition. */
export interface AuthTransitionDeps {
	planningStore: {
		initGlobalSync(): void;
		invalidateActiveToken(): void;
		setActiveToken(token: string): Promise<void>;
	};
	mastersCollection: {
		unsubscribeAll(): void;
		initialFetch(): Promise<void>;
		subscribe(): void;
	};
	occurrencesCollection: {
		unsubscribeAll(): void;
		initialFetch(config?: {
			filter?: [string, Record<string, unknown>];
			since?: string;
		}): Promise<void>;
		subscribe(): void;
	};
	commentStateService: {
		syncCommentReadState(): Promise<void>;
	};
	pb: {
		send(
			path: string,
			config: {
				method: string;
				body: Record<string, unknown>;
			}
		): Promise<unknown>;
	};
	db: {
		masters: {
			clear(): Promise<void>;
			get(id: string): Promise<
				| {
						participantToken?: string;
						adminToken?: string;
				  }
				| undefined
			>;
		};
		occurrences: { clear(): Promise<void> };
		commentState: { clear(): Promise<void> };
		localMeta: { clear(): Promise<void> };
	};
}

/** Résultat de la transition. */
export interface AuthTransitionResult {
	/**
	 * Snapshot de l'identité guest capturé AVANT le clear Dexie.
	 * Consommé par `/p/[token]` pour proposer le modal de suggestion de claim.
	 * `null` si aucun planning actif ou pas d'identité guest.
	 */
	guestClaim: { masterId: string; participantId: string; name: string } | null;
}

// =============================================
// Transition
// =============================================

/**
 * Exécute la transition guest → auth.
 *
 * Ordre :
 * 1. Réactiver le liveQuery global (sidebar/homepage)
 * 2. Snapshot de l'identité guest AVANT tout clear
 * 3. Unsubscribe des collections guest realtime
 * 4. Sync PocketBase : planning courant (non bloquant)
 * 5. Clear des données locales Dexie (cache technique jetable)
 * 6. Fetch depuis PB (API Rules)
 * 7. Subscribe realtime global + comment state
 * 8. Re-charger le planning courant dans le bon mode (auth)
 *
 * @param ctx - Contexte figé (snapshot de l'état courant)
 * @param deps - Dépendances injectées (pour test avec fakes)
 * @returns Le guestClaim (snapshot avant clear) ou null
 */
export async function runAuthTransition(
	ctx: AuthTransitionContext,
	deps: AuthTransitionDeps
): Promise<AuthTransitionResult> {
	const { currentToken, activeMasterId, savedPlannings } = ctx;
	const { planningStore, mastersCollection, occurrencesCollection, commentStateService, pb, db } =
		deps;

	// 1. Réactiver le liveQuery global alimentant #allMasters (sidebar + homepage)
	planningStore.initGlobalSync();

	// 2. Snapshot AVANT clear : token + master + identité guest
	//    Lecture directe de savedPlannings (et non getIdentityForPlanning) :
	//    à ce moment isLoggedIn est déjà true dans userStore, donc
	//    getIdentityForPlanning retournerait pbUser au lieu de l'identité guest.
	const guestIdentity = activeMasterId
		? (savedPlannings.find((p) => p.masterId === activeMasterId)?.currentUser ?? null)
		: null;

	// 3. Unsubscribe guest realtime
	mastersCollection.unsubscribeAll();
	occurrencesCollection.unsubscribeAll();

	// 4. Sync PocketBase : UNIQUEMENT le planning courant (si sur /p ou /admin)
	//    Échec non bloquant — on clear quand même Dexie (données guest orphelines)
	if (currentToken && activeMasterId) {
		// Résoudre le master depuis Dexie (pas encore clearée à ce stade)
		// pour extraire participantToken et adminToken nécessaires au endpoint.
		const activeMaster = await db.masters.get(activeMasterId);
		if (activeMaster) {
			try {
				await pb.send("/api/sync-plannings", {
					method: "POST",
					body: {
						tokens: [
							{
								masterId: activeMasterId,
								participantToken: activeMaster.participantToken,
								adminToken: activeMaster.adminToken
							}
						]
					}
				});
			} catch (err) {
				console.error("Token sync failed:", err);
			}
		}
	}

	// 5. Clear local (cache technique jetable)
	await Promise.all([db.masters.clear(), db.occurrences.clear(), db.commentState.clear()]);
	await db.localMeta.clear();

	// Construction du guestClaim APRÈS le clear de savedPlannings,
	// consommable par la page /p/[token] pour ouvrir le modal de suggestion.
	const guestClaim = guestIdentity
		? {
				masterId: activeMasterId!,
				participantId: guestIdentity.id,
				name: guestIdentity.name
			}
		: null;

	// 6. Fetch depuis PB (API Rules filtrent automatiquement via user.masterId)
	try {
		await mastersCollection.initialFetch();
		await occurrencesCollection.initialFetch();
	} catch (err) {
		console.error("Post-login fetch failed:", err);
	}

	// 7. Subscribe realtime global + comment state
	mastersCollection.subscribe();
	occurrencesCollection.subscribe();
	await commentStateService.syncCommentReadState();

	// 8. Re-charger le planning courant dans le bon mode (auth)
	if (currentToken) {
		planningStore.invalidateActiveToken();
		await planningStore.setActiveToken(currentToken);
	}

	return { guestClaim };
}
