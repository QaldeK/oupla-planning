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
import { planningStore } from '$lib/stores/planningStore.svelte';
import { goto } from '$app/navigation';

const PLANNINGS_KEY = 'planning_saved';
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
	savedPlannings = $state<SavedPlanning[]>([]);
	authModal = $state<AuthModalState>({ open: false });
	appPreferences = $state<AppPreferences>({
		theme: 'my',
		occurrenceView: 'compact'
	});
	isReady = $state(false);
	isLoggedIn = $state();
	hasSyncedThisSession = $state(false); // évite les appels multiples au sync

	async init() {
		// Synchro authStore
		this.isLoggedIn = pb.authStore.isValid;
		pb.authStore.onChange(() => {
			const wasLoggedIn = this.isLoggedIn;
			this.isLoggedIn = pb.authStore.isValid;

			// Reset le flag au changement d'état d'auth
			if (!wasLoggedIn && this.isLoggedIn) {
				this.hasSyncedThisSession = false;
			}
		});

		// 1. Plannings - TOUJOURS en localStorage (persist: true)
		this.savedPlannings =
			(await storage.getItem<SavedPlanning[]>(PLANNINGS_KEY, { persist: true })) || [];

		// 2. Préférences de l'application (thème, vue)
		const savedPrefs = await storage.getItem<AppPreferences>(APP_PREFS_KEY);
		if (savedPrefs) {
			this.appPreferences = {
				theme: savedPrefs.theme || 'my',
				occurrenceView: savedPrefs.occurrenceView || (mediaQuery.isMobile ? 'minimal' : 'compact')
			};
		} else {
			// Valeurs par défaut intelligentes par device
			this.appPreferences = {
				theme: 'my',
				occurrenceView: mediaQuery.isMobile ? 'minimal' : 'compact'
			};
		}

		this.isReady = true;
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

	// === Gestion de l'identité par planning ===

	getPlanningIdentity(masterId: string): PlanningIdentity | null {
		return this.savedPlannings.find((p) => p.masterId === masterId)?.currentUser || null;
	}

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

	async setPlanningIdentity(masterId: string, identity: PlanningIdentity) {
		const idx = this.savedPlannings.findIndex((p) => p.masterId === masterId);
		if (idx >= 0) {
			this.savedPlannings[idx].currentUser = identity;
			await this.savePlanningsLocal();
		} else {
			// Créer une entrée minimale (sera complétée par savePlanning plus tard)
			this.savedPlannings.push({
				masterId,
				title: '', // sera mis à jour par savePlanning
				participantToken: '',
				adminToken: '',
				lastAccessed: new Date().toISOString(),
				currentUser: identity
			});
			await this.savePlanningsLocal();
		}
	}

	// === Gestion des Plannings ===

	async savePlanning(planning: SavedPlanning) {
		const idx = this.savedPlannings.findIndex((p) => p.masterId === planning.masterId);

		if (idx >= 0) {
			this.savedPlannings[idx] = {
				...this.savedPlannings[idx],
				...planning,
				adminToken: planning.adminToken || this.savedPlannings[idx].adminToken,
				participantToken: planning.participantToken || this.savedPlannings[idx].participantToken,
				currentUser: planning.currentUser || this.savedPlannings[idx].currentUser
			};
		} else {
			this.savedPlannings.push(planning);
		}
		await this.savePlanningsLocal();
	}

	async savePlanningsLocal() {
		// TOUJOURS localStorage (persist: true)
		await storage.setItem(PLANNINGS_KEY, this.savedPlannings, { persist: true });
	}

	async removePlanning(masterId: string) {
		this.savedPlannings = this.savedPlannings.filter((p) => p.masterId !== masterId);
		await this.savePlanningsLocal();
	}

	async clearSavedPlannings() {
		this.savedPlannings = [];
		await storage.removeItem(PLANNINGS_KEY);
	}

	async logout() {
		goto('/');
		this.savedPlannings = [];
		await storage.removeItem(PLANNINGS_KEY);
		pb.authStore.clear();

		// Clear planningStore cache on logout
		planningStore.invalidateAll();
	}

	async clearUser() {
		// Alias pour compatibilité - même comportement que logout()
		await this.logout();
	}

	/**
	 * Supprime TOUTES les données locales de l'application.
	 */
	async clearAllLocalData() {
		const wasLoggedIn = this.isLoggedIn;

		// Supprimer TOUTES les données locales
		this.savedPlannings = [];
		this.appPreferences = { theme: 'my', occurrenceView: 'compact' };
		await storage.removeItem(PLANNINGS_KEY);
		await storage.removeItem(APP_PREFS_KEY);

		// Clear planningStore cache
		planningStore.invalidateAll();

		// Recharger la page pour nettoyer l'état en mémoire
		if (wasLoggedIn) {
			window.location.reload();
		} else {
			this.isReady = false;
			await this.init();
		}
	}

	hasAdminAccess(masterId: string): boolean {
		const planning = this.savedPlannings.find((p) => p.masterId === masterId);
		return !!planning && !!planning.adminToken;
	}

	getAdminToken(masterId: string): string | undefined {
		return this.savedPlannings.find((p) => p.masterId === masterId)?.adminToken;
	}

	getSavedPlanning(masterId: string): SavedPlanning | undefined {
		return this.savedPlannings.find((p) => p.masterId === masterId);
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
