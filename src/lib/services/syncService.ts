import { pb } from '$lib/pocketbase/pb';
import { userStore } from '$lib/stores/userStore.svelte';
import { mastersCollection, occurrencesCollection } from '$lib/stores/planningStore.svelte';
import { db } from '$lib/pb-sync/db';

class SyncService {
	#syncPromise: Promise<void> | null = null;

	async sync(): Promise<void> {
		if (!userStore.isLoggedIn) return;

		// Mutex pour éviter les syncs concurrents
		if (this.#syncPromise) {
			await this.#syncPromise;
			return;
		}

		this.#syncPromise = this.#doSync();
		try {
			await this.#syncPromise;
		} finally {
			this.#syncPromise = null;
		}
	}

	async #doSync(): Promise<void> {
		// Étape 1 : Enregistrer les tokens depuis Dexie masters
		const masters = await db.masters.toArray();
		const tokens = masters.map((m) => ({
			masterId: m.id,
			participantToken: m.participantToken,
			adminToken: m.adminToken
		}));

		await pb.send('/api/sync-plannings', {
			method: 'POST',
			body: { tokens }
		});

		// Étape 2 : Sync incrémental des masters (API Rules auto-filtrent)
		await mastersCollection.initialFetch();

		// Étape 3 : Sync incrémental des occurrences (API Rules auto-filtrent)
		await occurrencesCollection.initialFetch();
	}
}

export const syncService = new SyncService();
