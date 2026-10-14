import { fetchAllMasters, syncActiveOccurrences } from "$lib/data/planningSync";
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

		// Étapes 2-3 : Re-sync complète via les ops de data/planningSync
		// (API Rules auto-filtrent par user) — ADR 0017.
		await fetchAllMasters();
		await syncActiveOccurrences();

		// Étape 4 : Marquer la fraîcheur auth (UI NetworkAlert)
		await userStore.markAuthSynced();
	}
}

export const syncService = new SyncService();
