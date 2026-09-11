import { mastersCollection, occurrencesCollection } from "$lib/data/collections";
import { db } from "$lib/pb-sync/db";
import { pb } from "$lib/pocketbase/pb";
import { userStore } from "$lib/stores/userStore.svelte";

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

		await pb.send("/api/sync-plannings", {
			method: "POST",
			body: { tokens }
		});

		// Étape 2 : Sync incrémental des masters (API Rules auto-filtrent)
		// Curseur conservatif : min(updated) local. Un curseur max(updated) sauterait
		// définitivement les mises à jour manquées (trou SSE) sur tout planning plus
		// ancien que le plus récent. Toute update manquée d'un record R est plus
		// récente que la copie locale de R, donc plus récente que le min global.
		const oldest = await db.masters.orderBy("updated").first();
		const oldestUpdated = oldest?.updated ?? "2000-01-01 00:00:00";
		await mastersCollection.initialFetch({ since: oldestUpdated });

		// Étape 3 : Sync incrémental des occurrences (API Rules auto-filtrent)
		await occurrencesCollection.initialFetch();

		// Étape 4 : Marquer la fraîcheur auth (UI NetworkAlert)
		await userStore.markAuthSynced();
	}
}

export const syncService = new SyncService();
