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
import { db, ensureDbReady } from '$lib/pb-sync/db';
import { commentStateService } from '$lib/services/commentStateService';
import { guestStateStore } from '$lib/stores/guestStateStore.svelte';
import { authTransition } from '$lib/stores/authTransition.svelte';
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
	/* isTransitioning et pendingGuestClaim sont dans authTransition (module dédié) */

	async init() {
		// Open défensif de la DB locale (reset auto si migration cassée — ADR 0006).
		// Avant toute opération Dexie pour garantir que readyPromise est résolu.
		await ensureDbReady();

		// Synchro authStore
		this.isLoggedIn = pb.authStore.isValid;
		pb.authStore.onChange(() => {
			const wasLoggedIn = this.isLoggedIn;
			this.isLoggedIn = pb.authStore.isValid;

			// Guest → Auth : déclencher la transition via authTransition (module dédié).
			// L'état guest est chargé par +layout.svelte AVANT userStore.init().
			if (!wasLoggedIn && this.isLoggedIn) {
				// Fire-and-forget — onChange callback ne supporte pas async.
				// Les erreurs internes sont catchées dans authTransition.transitionToAuth(),
				// ce .catch() protège contre d'éventuelles rejections résiduelles.
				authTransition.transitionToAuth().catch((err) =>
					console.error('authTransition failed:', err)
				);
			}
		});

		// 1. Identités — chargées par guestStateStore.loadGuestState() dans +layout.svelte
		//    AVANT userStore.init() pour garantir l'ordering boot.
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
	 * À appeler après tout fetch auth réussi (syncService, #subscribeAuth, authTransition.transitionToAuth).
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

	/* onAuthTransition, isTransitioning, pendingGuestClaim, clearPendingGuestClaim
	   sont dans authTransition (module dédié). */

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

	/* Les méthodes guest (getIdentityForPlanning, setPlanningIdentity, removeIdentity,
	   removePlanningIdentity, markPlanningAsQuit) sont dans guestStateStore.
	   La règle ADR-0002 résolue par resolveCurrentIdentity (utils/identityResolution). */

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
		authTransition.clearPendingGuestClaim();
		await guestStateStore.clearGuestState();
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
		// Guard authTransition.isTransitioning pour éviter qu'un $effect ne réagisse
		// à un état intermédiaire (auth cleared, planning pas encore re-activé).
		authTransition.isTransitioning = true;
		try {
			authTransition.clearPendingGuestClaim();
			await guestStateStore.clearGuestState();
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
			authTransition.isTransitioning = false;
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

		await guestStateStore.clearGuestState();
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
