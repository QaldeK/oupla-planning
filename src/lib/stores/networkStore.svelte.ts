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
	hasActiveSubscription: boolean; // ✅ Nouveau : vrai si au moins un canal est souscrit
	lastError: Date | null;
}

const status = $state<NetworkStatus>({
	online: browser ? navigator.onLine : true,
	pocketbaseReachable: true,
	realtimeConnected: true,
	hasActiveSubscription: false,
	lastError: null
});

// Écouter online/offline (Svelte 5 way)
if (browser) {
	on(window, 'online', () => {
		status.online = true;
	});

	on(window, 'offline', () => {
		status.online = false;
		status.pocketbaseReachable = false;
		status.realtimeConnected = false;
	});

	// onDisconnect : hook officiel, appelé dès que l'EventSource se ferme
	pb.realtime.onDisconnect = () => {
		// Ignorer si aucune souscription active (évite race condition lors de la transition guest→auth)
		if (!status.hasActiveSubscription) return;
		console.log('🔴 Realtime déconnecté');
		status.realtimeConnected = false;
		status.lastError = new Date();
	};

	// Polling pour détecter la remontée
	setInterval(() => {
		// On ne poll le realtime que si on a une souscription active
		if (status.hasActiveSubscription && pb.realtime.isConnected && !status.realtimeConnected) {
			console.log('🟢 Realtime reconnecté (polling)', new Date().getMinutes());
			status.realtimeConnected = true;
			status.pocketbaseReachable = true;
			status.lastError = null;

			// Re-sync après reconnexion
			if (pb.authStore.record) {
				syncService.sync(userStore.savedPlannings);
			} else if (planningStore.activeMasterId) {
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
	get hasActiveSubscription() {
		return status.hasActiveSubscription;
	},
	get lastError() {
		return status.lastError;
	},
	/**
	 * Combine les indicateurs pour savoir si l'édition est possible.
	 * Si aucune souscription realtime n'est active, on ne bloque pas sur realtimeConnected.
	 */
	get isNetworkOk() {
		return (
			status.online &&
			status.pocketbaseReachable &&
			(!status.hasActiveSubscription || status.realtimeConnected)
		);
	},
	setHasActiveSubscription(value: boolean) {
		status.hasActiveSubscription = value;
		// Si on active une souscription, on assume que le realtime est OK au départ
		if (value) status.realtimeConnected = true;
	}
};
