import { db } from "$lib/pb-sync/db";
import { syncAuthData } from "$lib/services/authDataSync";
import { claimPlannings } from "$lib/services/claimPlannings";
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
		// Étape 1 : revendiquer les plannings connus localement (hook idempotent).
		await claimPlannings(await db.masters.toArray());

		// Étapes 2-3 : re-sync complète puis marqueur de fraîcheur (ADR 0017).
		// L'échec remonte : `networkStore.runResyncOnce` s'appuie dessus pour retenter.
		await syncAuthData(() => userStore.markAuthSynced());
	}
}

export const syncService = new SyncService();
