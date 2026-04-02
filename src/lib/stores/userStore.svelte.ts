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
import { syncService } from '$lib/services/syncService';
import { commentStateService } from '$lib/services/commentStateService';
import { goto } from '$app/navigation';

const APP_PREFS_KEY = 'app_preferences';

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

	async init() {
		// Synchro authStore
		this.isLoggedIn = pb.authStore.isValid;
		pb.authStore.onChange(() => {
			const wasLoggedIn = this.isLoggedIn;
			this.isLoggedIn = pb.authStore.isValid;

			// Guest → Auth : déclencher la transition
			if (!wasLoggedIn && this.isLoggedIn) {
				this.onAuthTransition();
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

		// Si déjà auth au chargement → données déjà en Dexie, delta fetch + subscribe
		if (this.isLoggedIn) {
			this.#subscribeAuth();
		}

		this.isReady = true;
	}

	/**
	 * Delta fetch + subscribe realtime global pour un user auth.
	 * Les données sont déjà en Dexie (persistées), on ne fait que rattraper le delta
	 * et s'abonner aux mises à jour temps réel (API Rules filtrent automatiquement).
	 */
	async #subscribeAuth() {
		try {
			await mastersCollection.initialFetch();
			await occurrencesCollection.initialFetch();
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
	 */
	async onAuthTransition() {
		// Unsubscribe guest realtime
		mastersCollection.unsubscribeAll();
		occurrencesCollection.unsubscribeAll();

		// Clear Dexie (PAS localMeta — les identités guest sont nettoyées ci-dessous)
		await Promise.all([db.masters.clear(), db.occurrences.clear(), db.commentState.clear()]);

		// Clear les identités guest (inutiles pour un user auth)
		this.savedPlannings = [];
		await db.localMeta.clear();

		// Sync via syncService (register tokens depuis masters + fetch)
		try {
			await syncService.authTransition();
		} catch (err) {
			console.error('Auth transition sync failed:', err);
		}

		// Subscribe realtime global
		mastersCollection.subscribe();
		occurrencesCollection.subscribe();
		await commentStateService.syncCommentReadState();
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

	// === Persistance identités → Dexie localMeta ===

	async #persistIdentities() {
		await db.localMeta.bulkPut(this.savedPlannings);
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

		const idx = this.savedPlannings.findIndex((p) => p.masterId === masterId);
		if (idx >= 0) {
			this.savedPlannings[idx] = { ...this.savedPlannings[idx], currentUser: identity };
		} else {
			this.savedPlannings.push({ masterId, currentUser: identity });
		}
		await this.#persistIdentities();
	}

	/**
	 * Supprime l'identité locale pour un planning.
	 */
	async removeIdentity(masterId: string) {
		this.savedPlannings = this.savedPlannings.filter((p) => p.masterId !== masterId);
		await db.localMeta.delete(masterId);
	}

	/**
	 * Supprime l'identité pour un planning (wrapper pour le flow "quitter").
	 * Pour les guests : supprime l'identité locale.
	 * Pour les users auth : ne fait rien (l'identité vient de pb.authStore).
	 */
	async removePlanningIdentity(masterId: string) {
		if (this.isLoggedIn) return;
		await this.removeIdentity(masterId);
	}

	// === Auth ===

	async logout() {
		goto('/');
		this.savedPlannings = [];
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

	async clearUser() {
		await this.logout();
	}

	/**
	 * Supprime TOUTES les données locales de l'application.
	 */
	async clearAllLocalData() {
		const wasLoggedIn = this.isLoggedIn;

		this.savedPlannings = [];
		this.appPreferences = { theme: 'my', occurrenceView: 'compact' };
		await storage.removeItem(APP_PREFS_KEY);

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
