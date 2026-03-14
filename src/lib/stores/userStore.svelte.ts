import type {
	GlobalUserProfile,
	SavedPlanning,
	PlanningIdentity,
	Participant,
	ViewType
} from '$lib/types/planning.types';
import { mediaQuery } from '$lib/stores/mediaQuery.svelte';
import { storage, isTauri } from '$lib/utils/storage';
import { pb } from '$lib/pocketbase/pb';

const STORAGE_KEY = 'planning_global_profile';
const PLANNINGS_KEY = 'planning_saved';
const VIEW_PREF_KEY = 'occurrence_view_pref';

interface AuthModalState {
	open: boolean;
	mode: 'homepage' | 'planning' | 'conflict' | 'edit-global';
	masterId?: string;
	existingParticipants?: Participant[];
	onPlanningIdentify?: (identity: PlanningIdentity, isNewParticipant: boolean) => Promise<void>;
}

class UserStore {
	globalProfile = $state<GlobalUserProfile | null>(null);
	savedPlannings = $state<SavedPlanning[]>([]); // Liste unifiée
	authModal = $state<AuthModalState>({ open: false, mode: 'homepage' });
	preferredOccurrenceView = $state<ViewType>('compact');
	isReady = $state(false);
	isLoggedIn = $state(pb.authStore.isValid);

	async init() {
		// Synchro authStore
		this.isLoggedIn = pb.authStore.isValid;
		pb.authStore.onChange(() => {
			this.isLoggedIn = pb.authStore.isValid;
		});
		// 1. Profil global
		this.globalProfile = await storage.getItem<GlobalUserProfile>(STORAGE_KEY);

		// 2. Plannings
		if (isTauri) {
			// Sous Tauri, une seule source
			this.savedPlannings = (await storage.getItem<SavedPlanning[]>(PLANNINGS_KEY)) || [];
		} else {
			// Sur le Web, on fusionne Local et Session
			const local =
				(await storage.getItem<SavedPlanning[]>(PLANNINGS_KEY, { persist: true })) || [];
			const session =
				(await storage.getItem<SavedPlanning[]>(PLANNINGS_KEY, { persist: false })) || [];

			// Union par masterId (priorité au local en cas de doublon bizarre)
			const merged = [...local];
			session.forEach((sp) => {
				if (!merged.find((p) => p.masterId === sp.masterId)) {
					merged.push(sp);
				}
			});
			this.savedPlannings = merged;
		}

		// 3. Préférence de vue
		if (mediaQuery.isMobile) {
			this.preferredOccurrenceView = 'compact';
		} else {
			const viewPref = await storage.getItem<string>(VIEW_PREF_KEY);
			if (viewPref && ['card', 'compact'].includes(viewPref)) {
				this.preferredOccurrenceView = viewPref as ViewType;
			}
		}

		this.isReady = true;

		// 4. Ouvrir le modal homepage si PAS de profil global
		if (!this.globalProfile) {
			this.authModal = { open: true, mode: 'homepage' };
		}
	}

	async setOccurrenceView(view: ViewType) {
		this.preferredOccurrenceView = view;
		await storage.setItem(VIEW_PREF_KEY, view, { persist: true });
	}

	// === Gestion du profil global ===

	async createGlobalProfile(name: string, email?: string, persist = true) {
		this.globalProfile = {
			id: crypto.randomUUID(),
			defaultName: name,
			defaultEmail: email,
			persist: isTauri ? true : persist // Toujours persister sous Tauri
		};
		await this.saveGlobalProfile();
	}

	async updateGlobalProfile(
		updates: Partial<Pick<GlobalUserProfile, 'id' | 'defaultName' | 'defaultEmail' | 'persist'>>,
		persist?: boolean
	) {
		if (!this.globalProfile) return;

		const shouldPersist = isTauri
			? true
			: persist !== undefined
				? persist
				: this.globalProfile.persist;

		this.globalProfile = {
			...this.globalProfile,
			...updates,
			persist: shouldPersist
		};
		await this.saveGlobalProfile();
	}

	private async saveGlobalProfile() {
		if (!this.globalProfile) return;
		await storage.setItem(STORAGE_KEY, this.globalProfile, {
			persist: this.globalProfile.persist
		});
	}

	// === Gestion de l'identité par planning ===

	getPlanningIdentity(masterId: string): PlanningIdentity | null {
		return this.savedPlannings.find((p) => p.masterId === masterId)?.currentUser || null;
	}

	getIdentityForPlanning(masterId: string): PlanningIdentity | null {
		const specific = this.getPlanningIdentity(masterId);
		if (specific) return specific;

		if (this.globalProfile) {
			return {
				id: this.globalProfile.id,
				name: this.globalProfile.defaultName,
				email: this.globalProfile.defaultEmail,
				notifyOnMissingParticipants: false
			};
		}
		return null;
	}

	async setPlanningIdentity(masterId: string, identity: PlanningIdentity) {
		const idx = this.savedPlannings.findIndex((p) => p.masterId === masterId);
		if (idx >= 0) {
			this.savedPlannings[idx].currentUser = identity;
			// Toujours persister sous Tauri
			this.savedPlannings[idx].persist = isTauri
				? true
				: (identity.rememberMe ?? this.savedPlannings[idx].persist);
			await this.savePlannings();
		}
	}

	// === Gestion des Plannings ===

	async savePlanning(planning: SavedPlanning, persist?: boolean) {
		const shouldPersist = isTauri ? true : persist !== undefined ? persist : planning.persist;

		const finalPlanning = { ...planning, persist: shouldPersist };
		if (finalPlanning.currentUser) {
			finalPlanning.currentUser.rememberMe = shouldPersist;
		}

		const idx = this.savedPlannings.findIndex((p) => p.masterId === finalPlanning.masterId);
		if (idx >= 0) {
			this.savedPlannings[idx] = {
				...this.savedPlannings[idx],
				...finalPlanning,
				adminToken: finalPlanning.adminToken || this.savedPlannings[idx].adminToken,
				participantToken:
					finalPlanning.participantToken || this.savedPlannings[idx].participantToken,
				currentUser: finalPlanning.currentUser || this.savedPlannings[idx].currentUser
			};
		} else {
			this.savedPlannings.push(finalPlanning);
		}
		await this.savePlannings();
	}

	private async savePlannings() {
		if (isTauri) {
			// Sous Tauri, on sauve tout d'un coup
			await storage.setItem(PLANNINGS_KEY, this.savedPlannings);
			return;
		}

		// Sur le Web, on ventile
		const persistent = this.savedPlannings.filter((p) => p.persist);
		const session = this.savedPlannings.filter((p) => !p.persist);

		await storage.setItem(PLANNINGS_KEY, persistent, { persist: true });
		await storage.setItem(PLANNINGS_KEY, session, { persist: false });
	}

	async removePlanning(masterId: string) {
		this.savedPlannings = this.savedPlannings.filter((p) => p.masterId !== masterId);
		await this.savePlannings();
	}

	async clearSavedPlannings() {
		this.savedPlannings = [];
		await storage.removeItem(PLANNINGS_KEY);
	}

	async logout() {
		pb.authStore.clear();
	}

	async clearUser() {
		this.globalProfile = null;
		this.savedPlannings = [];
		await storage.removeItem(STORAGE_KEY);
		await storage.removeItem(PLANNINGS_KEY);
		this.logout();
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
}

export const userStore = new UserStore();
