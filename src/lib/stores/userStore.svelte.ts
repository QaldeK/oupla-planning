import type {
	GlobalUserProfile,
	SavedPlanning,
	PlanningIdentity,
	Participant,
	ViewType,
	ThemeType,
	AppPreferences
} from '$lib/types/planning.types';
import type { PlanningMastersRecord } from '$lib/types/pocketbase-types';
import { mediaQuery } from '$lib/stores/mediaQuery.svelte';
import { storage, isTauri } from '$lib/utils/storage';
import { pb } from '$lib/pocketbase/pb';
import { planningStore } from '$lib/stores/planningStore.svelte';
import { goto } from '$app/navigation';

const STORAGE_KEY = 'planning_global_profile';
const PLANNINGS_KEY = 'planning_saved';
const APP_PREFS_KEY = 'app_preferences';
export const BACKUP_KEY = 'backupUser-single';

interface AuthModalState {
	open: boolean;
	mode: 'homepage' | 'edit-global';
	masterId?: string;
	existingParticipants?: Participant[];
	onGlobalProfileCreate?: (name: string, email?: string, persist?: boolean) => Promise<void>;
	onRequireLogin?: () => void;
}

export interface BackupProfile {
	globalProfile: GlobalUserProfile;
	savedPlannings: SavedPlanning[];
	timestamp: string;
}

class UserStore {
	globalProfile = $state<GlobalUserProfile | null>(null);
	savedPlannings = $state<SavedPlanning[]>([]); // Liste unifiée
	authModal = $state<AuthModalState>({ open: false, mode: 'homepage' });
	appPreferences = $state<AppPreferences>({
		theme: 'my',
		occurrenceView: 'compact'
	});
	isReady = $state(false);
	isLoggedIn = $state();
	hasSyncedThisSession = $state(false); // évite les appels multiples au sync
	preserveLocalProfile = $state(false); // évite l'écrasement du profil local pendant l'auth

	async init() {
		// Synchro authStore
		this.isLoggedIn = pb.authStore.isValid;
		pb.authStore.onChange(() => {
			const wasLoggedIn = this.isLoggedIn;
			this.isLoggedIn = pb.authStore.isValid;

			// Si l'utilisateur vient de s'authentifier, synchroniser le profil depuis PocketBase
			// La synchronisation des plannings est gérée par syncService dans le layout
			if (!wasLoggedIn && this.isLoggedIn) {
				this.syncProfileFromPocketBase();
			}
		});
		// 1. Profil global
		this.globalProfile = await storage.getItem<GlobalUserProfile>(STORAGE_KEY);

		// 2. Plannings - Une seule source selon la préférence globale
		const persist = this.globalProfile?.persist ?? true;
		this.savedPlannings =
			(await storage.getItem<SavedPlanning[]>(PLANNINGS_KEY, { persist })) || [];

		// 3. Préférences de l'application (thème, vue)
		const savedPrefs = await storage.getItem<AppPreferences>(APP_PREFS_KEY);
		if (savedPrefs) {
			this.appPreferences = {
				theme: savedPrefs.theme || 'my',
				occurrenceView: mediaQuery.isMobile ? 'compact' : savedPrefs.occurrenceView || 'compact'
			};
		} else {
			// Valeurs par défaut
			this.appPreferences.occurrenceView = mediaQuery.isMobile ? 'compact' : 'compact';
		}

		this.isReady = true;

		// 4. Synchroniser le profil depuis PocketBase si déjà authentifié au démarrage
		// La synchronisation des plannings est gérée par syncService dans le layout
		if (this.isLoggedIn) {
			await this.syncProfileFromPocketBase();
		}
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

	// === Gestion du profil global ===

	async createGlobalProfile(name: string, email?: string, persist = true, id?: string) {
		this.globalProfile = {
			id: id || crypto.randomUUID(), // En vrai, on genere maintenant toujours l'id. (voir ce commit)
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

	/**
	 * Récupère le profil utilisateur depuis PocketBase et met à jour le localStorage.
	 * Cette méthode récupère les dernières données depuis PocketBase (modifiées sur un autre appareil).
	 * Appelé automatiquement lors de l'authentification et au démarrage si déjà connecté.
	 */
	private async syncProfileFromPocketBase() {
		if (!pb.authStore.isValid || !pb.authStore.record) return;
		if (!this.globalProfile) return;
		// IMPORTANT: Préserver le profil local si flag activé (évite écrasement pendant l'auth)
		if (this.preserveLocalProfile) return;

		try {
			// Récupérer les données fraîches depuis PocketBase
			const user = await pb.collection('users').getOne(pb.authStore.record.id);
			const pbUserName = user.name;
			const pbUserEmail = user.email;

			// Détecter les changements
			const updates: Partial<Pick<GlobalUserProfile, 'defaultName' | 'defaultEmail'>> = {};
			let hasChanges = false;

			// Synchroniser le nom depuis PocketBase
			if (pbUserName && pbUserName !== this.globalProfile.defaultName) {
				updates.defaultName = pbUserName;
				hasChanges = true;
			}

			// Synchroniser l'email depuis PocketBase
			if (pbUserEmail && pbUserEmail !== this.globalProfile.defaultEmail) {
				updates.defaultEmail = pbUserEmail;
				hasChanges = true;
			}

			// Appliquer les mises à jour si nécessaire
			if (hasChanges) {
				await this.updateGlobalProfile(updates);
				console.log('Profil synchronisé depuis PocketBase:', updates);
			}
		} catch (error) {
			console.error('Erreur lors de la synchronisation du profil depuis PocketBase:', error);
		}
	}

	/**
	 * Synchronise le profil utilisateur vers PocketBase.
	 * Cette méthode est appelée après l'authentification (login ou register).
	 */
	async syncProfileWithPocketBase() {
		if (!pb.authStore.isValid || !pb.authStore.record) return;

		const pbUserName = pb.authStore.record.name;
		const pbUserEmail = pb.authStore.record.email;
		const pbUserId = pb.authStore.record.id;

		if (!this.globalProfile) {
			// Créer un nouveau profil avec les données PocketBase et l'ID PocketBase
			await this.createGlobalProfile(pbUserName, pbUserEmail, true, pbUserId);
		} else {
			// Mettre à jour le profil existant
			const wasPersist = this.globalProfile.persist;

			const updates: Partial<Pick<GlobalUserProfile, 'id' | 'defaultName' | 'defaultEmail'>> = {
				id: pbUserId
			};

			// Synchroniser le nom si différent ou non défini
			if (
				pbUserName &&
				(!this.globalProfile.defaultName || this.globalProfile.defaultName.trim() === '')
			) {
				updates.defaultName = pbUserName;
			}

			// Synchroniser l'email si différent ou non défini
			if (pbUserEmail && !this.globalProfile.defaultEmail) {
				updates.defaultEmail = pbUserEmail;
			}

			await this.updateGlobalProfile(updates, true);

			if (!wasPersist) {
				await this.savePlanningsLocal();
			}
		}
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
				email: this.globalProfile.defaultEmail
			};
		}
		return null;
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
		const isNewPlanning = idx < 0;

		if (idx >= 0) {
			this.savedPlannings[idx] = {
				...this.savedPlannings[idx],
				...planning,
				adminToken: planning.adminToken || this.savedPlannings[idx].adminToken,
				participantToken: planning.participantToken || this.savedPlannings[idx].participantToken,
				currentUser: planning.currentUser || this.savedPlannings[idx].currentUser // TOCHECK: que représente currentUser ?
			};
		} else {
			this.savedPlannings.push(planning);
		}
		await this.savePlanningsLocal();

		// ⚠️ BUG 2 FIX: Race condition dans syncPlanningsToPocketBase()
		// Le hook onRecordListRequest met déjà à jour masterId automatiquement côté serveur
		// La synchronisation se fera via syncPlanningsFromPocketBase() lors de l'authentification
		// ou manuellement via syncPlanningsWithPocketBase() si nécessaire
		// if (this.isLoggedIn && isNewPlanning) {
		// 	await this.syncPlanningsToPocketBase();
		// }
	}

	async savePlanningsLocal() {
		const persist = this.globalProfile?.persist ?? true;
		await storage.setItem(PLANNINGS_KEY, this.savedPlannings, { persist });
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
		this.globalProfile = null;
		this.savedPlannings = [];
		await storage.removeItem(STORAGE_KEY);
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
	 * Contrairement à logout/clearUser, cette méthode nettoie également
	 * les préférences de vue et recharge la page pour un nettoyage complet.
	 *
	 * ⚠️ IMPORTANT : Si l'utilisateur est connecté à PocketBase, les données
	 * seront synchronisées à nouveau depuis le serveur au prochain rechargement.
	 * C'est un comportement normal pour la synchronisation multi-appareils.
	 *
	 * Pour une suppression complète incluant PocketBase, utiliser logout() à la place.
	 */
	async clearAllLocalData() {
		// Sauvegarder l'état de connexion PocketBase
		const wasLoggedIn = this.isLoggedIn;

		// Supprimer TOUTES les données locales
		this.globalProfile = null;
		this.savedPlannings = [];
		this.appPreferences = { theme: 'my', occurrenceView: 'compact' };
		await storage.removeItem(STORAGE_KEY); // planning_global_profile
		await storage.removeItem(PLANNINGS_KEY); // planning_saved
		await storage.removeItem(APP_PREFS_KEY); // app_preferences
		await storage.removeItem(BACKUP_KEY); // backupUser-single

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

	// === Gestion des backups pour collisions de profils ===

	/**
	 * Vérifie si le profil local correspond au compte PocketBase connecté
	 */
	detectCollision(): 'none' | 'collision' {
		if (!this.globalProfile || !pb.authStore.isValid || !pb.authStore.record) return 'none';
		return this.globalProfile.id === pb.authStore.record.id ? 'none' : 'collision';
	}

	/**
	 * Vérifie si un utilisateur existe dans PocketBase via l'endpoint has-account
	 */
	async checkPocketBaseUserExists(userId: string): Promise<boolean> {
		try {
			const result = await pb.send(`/api/has-account/${userId}`, {
				method: 'GET'
			});
			return result.hasAccount === true;
		} catch (err) {
			// En cas d'erreur, on suppose que le compte n'existe pas (conservateur)
			return false;
		}
	}

	/**
	 * Migrate multiple participant IDs via l'endpoint batch
	 * Format: { migrations: { masterId, oldId, newId }[] }
	 */
	async migrateParticipantIds(
		migrations: { masterId: string; oldId: string; newId: string }[]
	): Promise<{
		results: Record<string, { success: boolean; error?: string; occurrencesUpdated?: number }>;
	}> {
		return pb.send('/api/migrate-participants', {
			method: 'POST',
			body: { migrations }
		});
	}

	/**
	 * Met à jour le statut de migration en local (pour retry)
	 */
	updateMigrationStatus(masterId: string, error: string) {
		const planning = this.savedPlannings.find((p) => p.masterId === masterId);
		if (planning) {
			// Ajouter un champ temporaire pour marquer l'échec
			(planning as unknown as { migrationError?: string }).migrationError = error;
		}
	}

	/**
	 * Sauvegarde le profil local dans un backup unique
	 */
	async backupLocalProfile(): Promise<void> {
		if (!this.globalProfile) return;

		const backup: BackupProfile = {
			globalProfile: this.globalProfile,
			savedPlannings: this.savedPlannings,
			timestamp: new Date().toISOString()
		};

		await storage.setItem(BACKUP_KEY, backup, { persist: true });
		console.log(`Backup créé pour ${this.globalProfile.defaultName}`);
	}

	/**
	 * Vérifie si un backup existe
	 */
	async hasBackup(): Promise<boolean> {
		const backup = await storage.getItem<BackupProfile>(BACKUP_KEY);
		return backup !== null;
	}

	/**
	 * Restaure le backup unique
	 */
	async restoreBackup(): Promise<void> {
		const backup = await storage.getItem<BackupProfile>(BACKUP_KEY);
		if (!backup) return;

		this.globalProfile = backup.globalProfile;
		this.savedPlannings = backup.savedPlannings;

		await this.saveGlobalProfile();
		await this.savePlanningsLocal();

		console.log(`Backup restauré pour ${backup.globalProfile.defaultName}`);
	}

	/**
	 * Supprime le backup
	 */
	async deleteBackup(): Promise<void> {
		await storage.removeItem(BACKUP_KEY);
	}
}

export const userStore = new UserStore();
