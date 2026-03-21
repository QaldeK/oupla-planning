import { on } from 'svelte/events';
import { browser } from '$app/environment';
import { pb } from '$lib/pocketbase/pb';
import { planningStore } from './planningStore.svelte';
import { syncService } from '$lib/services/syncService';
import { userStore } from '$lib/stores/userStore.svelte';

interface NetworkStatus {
	online: boolean;
	pocketbaseReachable: boolean;
	realtimeConnected: boolean;
	lastError: Date | null;
}

const status = $state<NetworkStatus>({
	online: browser ? navigator.onLine : true,
	pocketbaseReachable: true,
	realtimeConnected: true,
	lastError: null
});

// Écouter online/offline (Svelte 5 way)
if (browser) {
	on(window, 'online', () => {
		status.online = true;
		// Ne pas remettre pocketbaseReachable à true —
		// on attend la confirmation du SDK (onConnect ou polling isConnected)
	});

	on(window, 'offline', () => {
		status.online = false;
		status.pocketbaseReachable = false;
		status.realtimeConnected = false;
	});

	// onDisconnect : hook officiel, appelé dès que l'EventSource se ferme
	pb.realtime.onDisconnect = () => {
		console.log('🔴 Realtime déconnecté');
		status.realtimeConnected = false;
		status.lastError = new Date();
		// Le SDK gère la reconnexion automatiquement — on observe seulement
	};

	// Polling pour détecter la remontée (il n'y a pas de onConnect dans le SDK)
	setInterval(() => {
		if (pb.realtime.isConnected && !status.realtimeConnected) {
			console.log('🟢 Realtime reconnecté (polling)');
			status.realtimeConnected = true;
			status.pocketbaseReachable = true;
			status.lastError = null;

			// Re-sync après reconnexion
			if (pb.authStore.record) {
				// Auth : rafraîchir tous les plannings et occurrences
				syncService.sync(userStore.savedPlannings);
			} else if (planningStore.activeMasterId) {
				// Guest : rafraîchir uniquement le planning actif
				planningStore.refreshActive();
			}
		}
	}, 2000);
}

// Wrapper avec timeout pour les requêtes PocketBase
export async function withPocketBaseTimeout<T>(promise: Promise<T>, timeoutMs = 8000): Promise<T> {
	try {
		const result = await Promise.race([
			promise,
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeoutMs))
		]);

		status.pocketbaseReachable = true;
		status.lastError = null;
		return result;
	} catch (err) {
		status.pocketbaseReachable = false;
		status.lastError = new Date();
		throw err;
	}
}

// Export read-only
export const networkStore = {
	get online() {
		return status.online;
	},
	get pocketbaseReachable() {
		return status.pocketbaseReachable;
	},
	get realtimeConnected() {
		return status.realtimeConnected;
	},
	get lastError() {
		return status.lastError;
	}
};
