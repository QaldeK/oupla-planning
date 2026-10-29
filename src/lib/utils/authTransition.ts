/**
 * Orchestration pure de la transition guest → auth.
 *
 * Fonction pure — aucun `$state`, toutes les dépendances sont injectées
 * via le paramètre `deps`. Le wrapper réactif (`authTransition.svelte.ts`)
 * instancie les deps réelles et gère les guards (`isTransitioning`).
 */
import type { ClaimablePlanning } from "$lib/services/claimPlannings";
import { isPortageCandidate } from "$lib/services/claimPlannings";
import type { SavedPlanning } from "$lib/types/planning.types";

// =============================================
// Types
// =============================================

/** Modes de transition, selon l'origine du login :
 *   - `default` : login local hors mur (navigateur) — statu quo
 *   - `portage` : création de compte au mur, bascule acceptée
 *   - `adopt`   : session détectée via événement `storage` (une autre fenêtre
 *     du profil s'est connectée) — on synchronise sans toucher à l'état local,
 *     dont la transition appartient à la fenêtre d'origine. */
export type AuthTransitionMode = "default" | "portage" | "adopt";

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
	/**
	 * Mode résolu par le wrapper : origine du login + consentement du mur.
	 */
	mode: AuthTransitionMode;
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
		subscribe(): void;
	};
	occurrencesCollection: {
		unsubscribeAll(): void;
		subscribe(): void;
	};
	/** Claim des plannings connus localement (hook serveur idempotent). */
	claimPlannings(masters: ClaimablePlanning[]): Promise<void>;
	/**
	 * Rafraîchit le record d'auth local — propage `masterId`/`adminOf` posés
	 * côté serveur par un claim batch aux guards UI, sans attendre une
	 * activation de planning.
	 */
	refreshAuthRecord(): Promise<void>;
	/** Re-sync des données du compte : fetch masters → occurrences → marqueur. */
	syncAuthData(): Promise<void>;
	commentStateService: {
		syncCommentReadState(): Promise<void>;
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
			/** Snapshot de tous les masters locaux (claim batch du portage). */
			toArray(): Promise<
				Array<{
					id: string;
					participantToken?: string;
					adminToken?: string;
					deleted?: boolean;
				}>
			>;
		};
		occurrences: { clear(): Promise<void> };
		commentState: { clear(): Promise<void> };
		localMeta: {
			clear(): Promise<void>;
			toArray(): Promise<SavedPlanning[]>;
			bulkPut(rows: SavedPlanning[]): Promise<void>;
		};
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
 * 4. Claim : tous les masters locaux si portage mur, le planning courant seul
 *    si défaut, rien si adoption (non bloquant — les tokens vivent en Dexie)
 * 5. Clear des données locales : sélectif si portage (tokens et identités
 *    guest préservés), total si défaut, aucun si adoption
 * 6. Re-sync des données du compte + marqueur de fraîcheur (non bloquant)
 * 7. Subscribe realtime global + comment state
 * 8. Re-charger le planning courant dans le bon mode (auth)
 *
 * @param ctx - Contexte figé (snapshot de l'état courant)
 * @param deps - Dépendances injectées (pour test avec fakes)
 * @returns Le guestClaim (snapshot avant clear) ou null
 */
export async function runAuthTransition(
	ctx: AuthTransitionContext,
	deps: AuthTransitionDeps,
): Promise<AuthTransitionResult> {
	const { currentToken, activeMasterId, savedPlannings, mode } = ctx;
	const {
		planningStore,
		mastersCollection,
		occurrencesCollection,
		claimPlannings,
		refreshAuthRecord,
		syncAuthData,
		commentStateService,
		db,
	} = deps;

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

	// 4. Claim PocketBase :
	//    - portage mur : TOUS les masters locaux non supprimés (batch idempotent),
	//      suivi d'un authRefresh pour propager `masterId`/`adminOf` au record
	//      local — sinon les guards UI (accès admin) restent obsolètes jusqu'à
	//      la première activation d'un planning.
	//    - défaut : UNIQUEMENT le planning courant (si sur /p ou /admin) —
	//      statu quo du parcours navigateur.
	//    - adoption : aucun claim — la fenêtre d'origine possède la transition.
	//    Échec non bloquant — les tokens vivent en Dexie et la prochaine
	//    activation/sync retentera le claim.
	if (mode === "portage") {
		const claimable = (await db.masters.toArray()).filter(isPortageCandidate);
		if (claimable.length > 0) {
			try {
				await claimPlannings(claimable);
				try {
					await refreshAuthRecord();
				} catch (err) {
					console.error("Auth record refresh failed (non-blocking):", err);
				}
			} catch (err) {
				console.error("Batch claim failed (non-blocking):", err);
			}
		}
	} else if (mode === "default" && currentToken && activeMasterId) {
		// Résoudre le master depuis Dexie (pas encore clearée à ce stade)
		// pour extraire participantToken et adminToken nécessaires au endpoint.
		const activeMaster = await db.masters.get(activeMasterId);
		if (activeMaster) {
			try {
				await claimPlannings([
					{
						id: activeMasterId,
						participantToken: activeMaster.participantToken,
						adminToken: activeMaster.adminToken,
					},
				]);
			} catch (err) {
				console.error("Claim failed (non-blocking):", err);
			}
		}
	}

	// 5. Clear local :
	//    - portage mur : sélectif — occurrences et commentState sont des caches
	//      re-remplis par la sync, mais les masters (tokens d'accès, la sidebar
	//      vit dessus) et les identités guest (`currentUser`, seule donnée non
	//      reconstruisible) survivent. `lastFetchAt`/`hasQuit` sont jetables ou
	//      re-dérivables.
	//    - défaut : total (statu quo).
	//    - adoption : aucun — l'état local appartient désormais au compte.
	if (mode === "portage") {
		await Promise.all([db.occurrences.clear(), db.commentState.clear()]);
		const identities = (await db.localMeta.toArray())
			.filter((row) => row.currentUser)
			.map(({ masterId, currentUser }) => ({ masterId, currentUser }) as SavedPlanning);
		await db.localMeta.clear();
		if (identities.length > 0) {
			await db.localMeta.bulkPut(identities);
		}
	} else if (mode === "default") {
		await Promise.all([db.masters.clear(), db.occurrences.clear(), db.commentState.clear()]);
		await db.localMeta.clear();
	}

	// Construction du guestClaim APRÈS le clear de savedPlannings,
	// consommable par la page /p/[token] pour ouvrir le modal de suggestion.
	// Jamais en adoption : la fenêtre adoptante ne doit pas proposer la fusion —
	// c'est à la fenêtre d'origine de la transition.
	const guestClaim =
		mode !== "adopt" && guestIdentity
			? {
					masterId: activeMasterId,
					participantId: guestIdentity.id,
					name: guestIdentity.name,
				}
			: null;

	// 6. Re-sync complète des données du compte (ADR 0017) + marqueur de fraîcheur
	// — le post-login doit converger vers le serveur même après un trou SSE.
	// Les API Rules filtrent automatiquement via user.masterId. Échec non
	// bloquant : subscribe et lecture d'état restent utiles.
	try {
		await syncAuthData();
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
