import type {
	SavedPlanning,
	PlanningIdentity,
	Participant,
	ViewType,
	ThemeType,
	AppPreferences
} from '$lib/types/planning.types';
import { mediaQuery } from '$lib/stores/mediaQuery.svelte';
import { storage } from '$lib/utils/storage';
import { pb } from '$lib/pocketbase/pb';
import {
	planningStore,
	mastersCollection,
	occurrencesCollection
} from '$lib/stores/planningStore.svelte';
import { db } from '$lib/pb-sync/db';
import { commentStateService } from '$lib/services/commentStateService';
import { goto } from '$app/navigation';

const APP_PREFS_KEY = 'app_preferences';
const AUTH_SYNC_AT_KEY = 'auth_sync_at';

interface AuthModalState {
	open: boolean;
	masterId?: string;
	existingParticipants?: Participant[];
	onPlanningIdentify?: (identity: PlanningIdentity, isNewParticipant: boolean) => Promise<void>;
	initialName?: string; // Nom prérempli pour les users auth
	hideExistingParticipants?: boolean; // Cacher la liste des participants existants
	currentIdentity?: PlanningIdentity | null; // Identité actuelle pour éviter de créer un nouveau participant
}

class UserStore {
	/** Identités guest par planning — { masterId, currentUser? } */
	savedPlannings = $state<SavedPlanning[]>([]);
	authModal = $state<AuthModalState>({ open: false });
	appPreferences = $state<AppPreferences>({
		theme: 'my',
		occurrenceView: 'compact'
	});
	isReady = $state(false);
	isLoggedIn = $state();
	/**
	 * Date de la dernière sync globale réussie en mode auth (persistée via storage).
	 * Utilisé par l'UI (NetworkAlert) pour afficher la fraîcheur des données.
	 * En mode guest, la fraîcheur vient de `lastFetchAt` per-master (Dexie localMeta).
	 */
	lastAuthSyncAt = $state<Date | null>(null);
	/**
	 * True pendant onAuthTransition() (guest → auth).
	 * Utilisé par les $effect des pages pour éviter de déclencher des actions
	 * (auto-add participant, ouverture de modal) pendant que Dexie est en cours
	 * de clear + re-fetch. Sans ce guard, l'$effect de /p/[token] peut voir un
	 * état intermédiaire (master temporairement sans userId) et déclencher un
	 * CAS B/C intempestif → toast d'erreur / doublon potentiel.
	 */
	isTransitioning = $state(false);
	/**
	 * Snapshot de l'identité guest de session capturé pendant onAuthTransition(),
	 * AVANT le clear de savedPlannings. Permet à /p/[token] de proposer directement
	 * la revendication de cette identité (modal de suggestion) au lieu de deviner
	 * par heuristique de nom.
	 *
	 * In-memory uniquement (non persisté) : une transition ne survit pas à un reload.
	 * Consommé/invalidé par la page /p/[token] après résolution.
	 */
	pendingGuestClaim: { masterId: string; participantId: string; name: string } | null =
		$state(null);

	async init() {
		// Synchro authStore
		this.isLoggedIn = pb.authStore.isValid;
		pb.authStore.onChange(() => {
			const wasLoggedIn = this.isLoggedIn;
			this.isLoggedIn = pb.authStore.isValid;

			// Guest → Auth : déclencher la transition
			if (!wasLoggedIn && this.isLoggedIn) {
				// Fire-and-forget — onChange callback ne supporte pas async.
				// Les erreurs internes sont catchées dans onAuthTransition(),
				// ce .catch() protège contre d'éventuelles rejections résiduelles.
				this.onAuthTransition().catch((err) => console.error('onAuthTransition failed:', err));
			}
		});

		// 1. Identités — charger depuis Dexie localMeta
		this.savedPlannings = await db.localMeta.toArray();

		// 2. Initialiser le liveQuery global de planningStore (sidebar/homepage)
		planningStore.initGlobalSync();

		// 3. Préférences de l'application (thème, vue)
		const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		const defaultTheme: ThemeType = prefersDark ? 'nord-dark' : 'my';

		const savedPrefs = await storage.getItem<AppPreferences>(APP_PREFS_KEY);
		if (savedPrefs) {
			this.appPreferences = {
				theme: savedPrefs.theme || defaultTheme,
				occurrenceView: savedPrefs.occurrenceView || (mediaQuery.isMobile ? 'minimal' : 'compact')
			};
		} else {
			// Valeurs par défaut intelligentes par device + OS theme
			this.appPreferences = {
				theme: defaultTheme,
				occurrenceView: mediaQuery.isMobile ? 'minimal' : 'compact'
			};
		}

		// 4. Curseur de fraîcheur auth (UI NetworkAlert). Null si jamais sync.
		const savedSyncAt = await storage.getItem<string>(AUTH_SYNC_AT_KEY);
		this.lastAuthSyncAt = savedSyncAt ? new Date(savedSyncAt) : null;

		// Si déjà auth au chargement → données déjà en Dexie, delta fetch + subscribe
		if (this.isLoggedIn) {
			this.#subscribeAuth();
		}

		this.isReady = true;
	}

	/**
	 * Marque le succès d'une sync globale auth (UI NetworkAlert).
	 * À appeler après tout fetch auth réussi (syncService, #subscribeAuth, onAuthTransition).
	 */
	async markAuthSynced(): Promise<void> {
		this.lastAuthSyncAt = new Date();
		await storage.setItem(AUTH_SYNC_AT_KEY, this.lastAuthSyncAt.toISOString(), { persist: true });
	}
	async #subscribeAuth() {
		try {
			await mastersCollection.initialFetch();
			await occurrencesCollection.initialFetch();
			await this.markAuthSynced();
		} catch (err) {
			console.error('Delta sync failed:', err);
		}
		mastersCollection.subscribe();
		occurrencesCollection.subscribe();
		await commentStateService.syncCommentReadState();
	}

	/**
	 * Transition guest → auth : clear les données guest, sync les données auth.
	 * Appelé par pb.authStore.onChange lors du changement d'état.
	 *
	 * Stratégie : sync minimale — seul le planning actuellement consulté
	 * (si sur /p/[token] ou /admin/[token]) est associé au compte PocketBase.
	 * Le cache Dexie d'un guest est jetable (terminal potentiellement partagé).
	 */
	async onAuthTransition() {
		// Guard : empêche les $effect des pages de réagir à un état intermédiaire
		// (master cleared, userId pas encore posé, etc.) pendant la transition.
		this.isTransitioning = true;
		try {
			// 1. Snapshot AVANT clear : token + master actifs
			const activeToken = planningStore.currentToken;
			const activeMasterId = planningStore.activeMasterId;
			// Snapshot de l'identité guest du planning actif. Lecture directe de
			// this.savedPlannings (et non getIdentityForPlanning) : à ce moment
			// this.isLoggedIn est déjà true, donc getIdentityForPlanning retournerait
			// pbUser au lieu de l'identité guest de session.
			const guestIdentity = activeMasterId
				? (this.savedPlannings.find((p) => p.masterId === activeMasterId)?.currentUser ?? null)
				: null;

			// Unsubscribe guest realtime
			mastersCollection.unsubscribeAll();
			occurrencesCollection.unsubscribeAll();

			// 2. Sync PocketBase : UNIQUEMENT le planning courant (si sur /p ou /admin)
			//    Échec non bloquant — on clear quand même Dexie (données guest orphelines sinon)
			if (activeToken && activeMasterId) {
				const activeMaster = await db.masters.get(activeMasterId);
				if (activeMaster) {
					try {
						await pb.send('/api/sync-plannings', {
							method: 'POST',
							body: {
								tokens: [
									{
										masterId: activeMaster.id,
										participantToken: activeMaster.participantToken,
										adminToken: activeMaster.adminToken
									}
								]
							}
						});
					} catch (err) {
						console.error('Token sync failed:', err);
					}
				}
			}

			// 3. Clear local (cache technique jetable)
			await Promise.all([db.masters.clear(), db.occurrences.clear(), db.commentState.clear()]);
			this.savedPlannings = [];
			await db.localMeta.clear();

			// Snapshot guest posé APRÈS le clear de savedPlannings, consommable par
			// la page /p/[token] pour ouvrir le modal de suggestion.
			if (guestIdentity) {
				this.pendingGuestClaim = {
					masterId: activeMasterId!,
					participantId: guestIdentity.id,
					name: guestIdentity.name
				};
			}

			// 4. Fetch depuis PB (API Rules filtrent automatiquement via user.masterId)
			//    - CAS 1 (planning actif) : user.masterId contient le master → retrouvé
			//    - CAS 2 (homepage) : user.masterId vide → 0 master (cohérent avec UI guest)
			try {
				await mastersCollection.initialFetch();
				await occurrencesCollection.initialFetch();
				await this.markAuthSynced();
			} catch (err) {
				console.error('Post-login fetch failed:', err);
			}

			// 5. Subscribe realtime global + comment state
			mastersCollection.subscribe();
			occurrencesCollection.subscribe();
			await commentStateService.syncCommentReadState();

			// 6. Re-charger le planning courant dans le bon mode (auth)
			//    - invalidateActiveToken() pour bypasser l'early return de setActiveToken
			//    - setActiveToken() re-déclenche le cycle auth complet, qui va aussi
			//      cleaner les anciennes liveQuery guest via #subscribeDexieQueries
			//    - Le $effect du layout ne se re-déclenche pas seul (URL inchangée),
			//      donc on doit le faire explicitement ici
			if (activeToken) {
				planningStore.invalidateActiveToken();
				await planningStore.setActiveToken(activeToken);
			}
		} finally {
			this.isTransitioning = false;
		}
	}

	/**
	 * Invalide le snapshot pendingGuestClaim. À appeler après résolution (claim,
	 * auto-add, refus) ou si le participant cible n'est plus claimable.
	 */
	clearPendingGuestClaim() {
		this.pendingGuestClaim = null;
	}

	async setOccurrenceView(view: ViewType) {
		this.appPreferences.occurrenceView = view;
		await this.saveAppPreferences();
	}

	async setTheme(theme: ThemeType) {
		this.appPreferences.theme = theme;
		await this.saveAppPreferences();
	}

	private async saveAppPreferences() {
		await storage.setItem(APP_PREFS_KEY, this.appPreferences, { persist: true });
	}

	/**
	 * Source unique de vérité pour mettre à jour un SavedPlanning.
	 * Lit l'existant (in-memory, fallback Dexie pour rattraper les écritures directes
	 * comme lastFetchAt), merge le patch, met à jour l'in-memory ET Dexie de façon cohérente.
	 * Préserve les champs existants (lastFetchAt, currentUser, hasQuit...).
	 */
	async #upsertSavedPlanning(masterId: string, patch: Partial<SavedPlanning>): Promise<void> {
		const idx = this.savedPlannings.findIndex((p) => p.masterId === masterId);
		const existing = idx >= 0 ? this.savedPlannings[idx] : await db.localMeta.get(masterId);
		const merged: SavedPlanning = { ...(existing as SavedPlanning), masterId, ...patch };

		if (idx >= 0) {
			this.savedPlannings[idx] = merged;
		} else {
			this.savedPlannings.push(merged);
		}
		await db.localMeta.put(merged);
	}

	// === Gestion de l'identité par planning ===

	/**
	 * Récupère l'identité pour un planning donné.
	 * - Si user connecté → utiliser pb.authStore.record
	 * - Si guest → retourner currentUser du savedPlanning correspondant
	 */
	getIdentityForPlanning(masterId: string): PlanningIdentity | null {
		// 1. Si user connecté → utiliser pb.authStore.record
		if (this.isLoggedIn && pb.authStore.record) {
			return {
				id: pb.authStore.record.id,
				name: (pb.authStore.record['name'] as string) ?? '',
				email: (pb.authStore.record['email'] as string) ?? ''
			};
		}

		// 2. Si guest → retourner currentUser du savedPlanning correspondant
		const planning = this.savedPlannings.find((p) => p.masterId === masterId);
		return planning?.currentUser ?? null;
	}

	/**
	 * Définit l'identité guest pour un planning.
	 * Ne fait rien si l'utilisateur est connecté (l'identité vient de pb.authStore).
	 */
	async setPlanningIdentity(masterId: string, identity: PlanningIdentity) {
		if (this.isLoggedIn) return;
		await this.#upsertSavedPlanning(masterId, { currentUser: identity });
	}

	/**
	 * Supprime l'identité locale pour un planning.
	 */
	async removeIdentity(masterId: string) {
		this.savedPlannings = this.savedPlannings.filter((p) => p.masterId !== masterId);
		await db.localMeta.delete(masterId);
	}

	/**
	 * Supprime l'identité pour un planning (wrapper pour le flux "quitter").
	 * Pour les guests : supprime l'identité locale.
	 * Pour les users auth : ne fait rien (l'identité vient de pb.authStore).
	 */
	async removePlanningIdentity(masterId: string) {
		if (this.isLoggedIn) return;
		await this.removeIdentity(masterId);
	}

	/**
	 * Marque l'identité guest comme ayant quitté le planning (au lieu de la
	 * supprimer). Permet la détection du retour après quit pour ouvrir le
	 * modal de reconnexion.
	 *
	 * Ne fait rien si l'utilisateur est connecté (l'identité vient de pb.authStore).
	 */
	async markPlanningAsQuit(masterId: string) {
		if (this.isLoggedIn) return;
		await this.#upsertSavedPlanning(masterId, { hasQuit: true });
	}

	/**
	 * Enregistre le timestamp du dernier fetch réussi pour un master.
	 * Utilisé par planningStore pour la delta sync per-master (lastFetchAt).
	 * Passe par #upsertSavedPlanning pour préserver les autres champs et garder
	 * l'in-memory cohérent avec Dexie.
	 *
	 * Le pattern capture/restore (lire l'ancienne valeur avant écriture) est géré
	 * côté planningStore via #resolveSince + restoreLastFetchAt.
	 */
	async markFetched(masterId: string): Promise<void> {
		await this.#upsertSavedPlanning(masterId, { lastFetchAt: new Date().toISOString() });
	}

	/**
	 * Restaure lastFetchAt à une valeur antérieure après l'échec d'un fetch.
	 * Permet de ne pas perdre le delta [previous, now] au prochain cycle de sync.
	 */
	async restoreLastFetchAt(masterId: string, previousValue: string | null): Promise<void> {
		if (previousValue) {
			await this.#upsertSavedPlanning(masterId, { lastFetchAt: previousValue });
			return;
		}
		await this.#clearLastFetchAt(masterId);
	}

	/**
	 * Retire le champ lastFetchAt d'un SavedPlanning (in-memory + Dexie),
	 * en préservant les autres champs (currentUser, hasQuit...).
	 */
	async #clearLastFetchAt(masterId: string): Promise<void> {
		const idx = this.savedPlannings.findIndex((p) => p.masterId === masterId);
		const target = idx >= 0 ? this.savedPlannings[idx] : await db.localMeta.get(masterId);
		if (!target) return;
		const updated = { ...target };
		delete updated.lastFetchAt;
		if (idx >= 0) {
			this.savedPlannings[idx] = updated;
		} else {
			this.savedPlannings.push(updated);
		}
		await db.localMeta.put(updated);
	}

	// === Auth ===

	async logout() {
		goto('/');
		this.savedPlannings = [];
		this.lastAuthSyncAt = null;
		await storage.removeItem(AUTH_SYNC_AT_KEY);
		pb.authStore.clear();

		// Unsubscribe pb-sync and clear Dexie
		mastersCollection.unsubscribeAll();
		occurrencesCollection.unsubscribeAll();
		await db.masters.clear();
		await db.occurrences.clear();
		await db.commentState.clear();
		await db.localMeta.clear();

		// Clear planningStore
		planningStore.destroy();
	}

	/**
	 * Déconnexion sans redirection : reste sur le planning courant et le recharge
	 * en mode guest. Utilisé par le bouton-lien « Se déconnecter pour changer de
	 * compte » du IdentityClaimModal (l'user veut participer sous un autre compte).
	 *
	 * Différences avec logout() :
	 * - pas de goto('/') — on reste sur /p/[token]
	 * - re-activation du planning en guest via setActiveToken(token)
	 *
	 * Effet de bord attendu : l'$effect de /p/[token] (branche guest) détectera
	 * l'absence d'identité et ouvrira IdentifyModal automatiquement.
	 */
	async logoutAndStayOnPlanning(token: string) {
		// Guard isTransitioning pour éviter qu'un $effect ne réagisse à un état
		// intermédiaire (auth cleared, planning pas encore re-activé) pendant le clear.
		this.isTransitioning = true;
		try {
			this.savedPlannings = [];
			pb.authStore.clear();
			this.isLoggedIn = false;

			// Unsubscribe pb-sync + clear Dexie
			mastersCollection.unsubscribeAll();
			occurrencesCollection.unsubscribeAll();
			await db.masters.clear();
			await db.occurrences.clear();
			await db.commentState.clear();
			await db.localMeta.clear();

			// Re-activer le planning en guest (setActiveToken route vers #setActiveGuest
			// car isLoggedIn est false). L'$effect de la page s'occupera d'ouvrir IdentifyModal.
			planningStore.invalidateActiveToken();
			await planningStore.setActiveToken(token);
		} finally {
			this.isTransitioning = false;
		}
	}

	async clearUser() {
		await this.logout();
	}

	/**
	 * Supprime TOUTES les données locales de l'application.
	 */
	async clearAllLocalData() {
		const wasLoggedIn = this.isLoggedIn;

		this.savedPlannings = [];
		this.lastAuthSyncAt = null;
		this.appPreferences = { theme: 'my', occurrenceView: 'compact' };
		await storage.removeItem(APP_PREFS_KEY);
		await storage.removeItem(AUTH_SYNC_AT_KEY);

		mastersCollection.unsubscribeAll();
		occurrencesCollection.unsubscribeAll();
		await db.masters.clear();
		await db.occurrences.clear();
		await db.commentState.clear();
		await db.localMeta.clear();

		// Clear planningStore
		planningStore.destroy();

		// Recharger la page pour nettoyer l'état en mémoire
		if (wasLoggedIn) {
			window.location.reload();
		} else {
			this.isReady = false;
			await this.init();
		}
	}

	get pbUser(): { id: string; name: string; email: string } | null {
		if (!pb.authStore.isValid || !pb.authStore.record) return null;
		const record = pb.authStore.record;
		return {
			id: record.id,
			name: (record['name'] as string) ?? '',
			email: (record['email'] as string) ?? ''
		};
	}
}

export const userStore = new UserStore();
