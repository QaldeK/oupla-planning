import { pb } from '$lib/pocketbase/pb';
import { userStore } from '$lib/stores/userStore.svelte';
import { planningStore } from '$lib/stores/planningStore.svelte';
import type { SavedPlanning, PlanningMaster, PlanningOccurrence } from '$lib/types/planning.types';

interface SyncResponse {
	success: boolean;
	syncedIds: string[];
	masters: PlanningMaster[];
	occurrences?: Record<string, PlanningOccurrence[]>;
}

class SyncService {
	#syncPromise: Promise<void> | null = null;

	async sync(plannings: SavedPlanning[]): Promise<void> {
		if (!userStore.isLoggedIn) return;

		// Mutex pour éviter les syncs concurrents
		if (this.#syncPromise) {
			await this.#syncPromise;
			return;
		}

		this.#syncPromise = this.#doSync(plannings);
		try {
			await this.#syncPromise;
		} finally {
			this.#syncPromise = null;
		}
	}

	async #doSync(plannings: SavedPlanning[]): Promise<void> {
		// Envoyer TOUS les tokens (ou tableau vide si nouveau device)
		const tokens = plannings.map((p) => ({
			masterId: p.masterId,
			participantToken: p.participantToken,
			adminToken: p.adminToken
		}));

		const response = (await pb.send('/api/sync-plannings', {
			method: 'POST',
			body: { tokens, includeOccurrences: true }
		})) as SyncResponse;

		// Upsert les masters reçus dans le localStorage
		this.upsertMasters(response.masters);

		// Stocker les occurrences dans planningStore
		if (response.occurrences) {
			planningStore.setOccurrencesForMasters(response.occurrences);
		}

		// Marquer tous les plannings comme synchronisés
		this.markAllAsSynced();
	}

	/**
	 * Upsert les masters reçus dans le localStorage
	 * Préserve les champs locaux comme currentUser
	 */
	upsertMasters(masters: PlanningMaster[]): void {
		for (const master of masters) {
			// Ignorer les masters sans données essentielles
			if (!master.title || !master.participantToken) continue;

			const existing = userStore.savedPlannings.find((p) => p.masterId === master.id);

			if (existing) {
				// Mettre à jour l'entrée existante, préserver currentUser
				existing.title = master.title;
				existing.participantToken = master.participantToken;
				existing.adminToken = master.adminToken || existing.adminToken;
				existing.lastAccessed = new Date().toISOString();
				existing.isSync = true;
			} else {
				// Créer une nouvelle entrée
				userStore.savedPlannings.push({
					masterId: master.id,
					title: master.title,
					participantToken: master.participantToken,
					adminToken: master.adminToken,
					lastAccessed: new Date().toISOString(),
					isSync: true
				});
			}
		}
		userStore.savePlanningsLocal();
	}

	markAllAsSynced(): void {
		for (const planning of userStore.savedPlannings) {
			planning.isSync = true;
		}
		userStore.savePlanningsLocal();
	}
}

export const syncService = new SyncService();
