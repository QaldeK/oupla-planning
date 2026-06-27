import { browser } from '$app/environment';
import { pb } from '$lib/pocketbase/pb';
import { syncService } from '$lib/services/syncService';
import { on } from 'svelte/events';
import { planningStore } from './planningStore.svelte';

interface NetworkStatus {
	online: boolean;
	pocketbaseReachable: boolean;
	realtimeConnected: boolean;
	hasActiveSubscription: boolean; // ✅ Nouveau : vrai si au moins un canal est souscrit
	lastError: Date | null;
	lastSyncAt: Date | null; // R6 : curseur de throttle pour les re-syncs (visibility/pageshow)
}

const status = $state<NetworkStatus>({
	online: browser ? navigator.onLine : true,
	pocketbaseReachable: true,
	realtimeConnected: true,
	hasActiveSubscription: false,
	lastError: null,
	lastSyncAt: null
});

/**
 * Déclenche une re-sync selon le mode (auth ou guest), avec un retry léger sur échec.
 *
 * Garanties :
 * - `lastSyncAt` n'est marqué qu'en cas de sync réussie.
 * - Un guard in-flight (`resyncInFlight`) empêche les cycles concurrents quand
 *   plusieurs sources (visibilitychange, polling de reconnexion SSE) se chevauchent.
 * - 1 retry avec délai de 2 s : au retour d'un freeze background, le navigateur
 *   rétablit le réseau de façon asynchrone — la première tentative peut échouer
 *   alors que le réseau serait prêt quelques centaines de ms plus tard.
 *
 * Distinction importante entre deux timestamps qui coïncident souvent mais ne sont
 * pas redondants :
 *
 * - `lastFetchAt` (userStore, per-master, persisté en Dexie `localMeta`) :
 *   curseur de DELTA SYNC (correctness). `since = lastFetchAt` → récupère tout depuis
 *   ce point. Géré par capture/restore dans planningStore (markFetched avant le fetch,
 *   restoreLastFetchAt en cas d'échec réseau pour ne pas perdre le delta).
 *   ⚠️ Non maintenu par `syncService.sync()` en mode auth (qui utilise `since` basé
 *   sur `max(updated)` local).
 *
 * - `lastSyncAt` (ce champ, global, éphémère en mémoire) : curseur de THROTTLE (UX).
 *   "Quand a-t-on déclenché une sync réussie ?" Non persisté intentionnellement :
 *   au boot, on veut toujours re-sync. Marqué uniquement au succès : si la sync
 *   échoue, le throttle du `visibilitychange` ne bloque pas un retry légitime.
 */
let resyncInFlight = false;
async function triggerResync(): Promise<void> {
	// Guard anti-spam : visibilitychange et le polling peuvent tomber dans la même
	// fenêtre au retour foreground. Un seul cycle retry à la fois.
	if (resyncInFlight) return;
	resyncInFlight = true;
	try {
		if (await runResyncOnce()) {
			status.lastSyncAt = new Date();
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 2000));
		if (await runResyncOnce()) {
			status.lastSyncAt = new Date();
		}
	} finally {
		resyncInFlight = false;
	}
}

/**
 * Exécute une tentative de sync (mode auth ou guest).
 * Retourne true si réussie (ou nothing-to-sync), false sur erreur réseau.
 * Ne throw jamais — toutes les erreurs sont catchées pour le retry de `triggerResync`.
 */
async function runResyncOnce(): Promise<boolean> {
	try {
		if (pb.authStore.record) {
			await syncService.sync();
		} else if (planningStore.activeMasterId) {
			await planningStore.refreshActive();
		}
		return true;
	} catch (err) {
		console.warn('[networkStore] resync attempt failed:', err);
		return false;
	}
}

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

	// R6 — Retour au premier plan après freeze background (iOS Safari, Android PWA).
	// Les navigateurs mobiles freezent les timers JS en background (~30s), donc le polling
	// 2s ne tourne plus et ne détecte pas la reconnexion SSE au retour. On force une
	// re-sync indépendamment du flag `realtimeConnected` (qui peut être faux : SSE
	// "connectée" mais events droppés silencieusement pendant le freeze, TCP half-open).
	on(document, 'visibilitychange', () => {
		if (document.visibilityState !== 'visible') return;
		// Rien à synchroniser sans subscription active (ex: landing page /)
		if (!status.hasActiveSubscription) return;
		// Throttle 5s : évite le spam sur switches d'onglets rapides
		const last = status.lastSyncAt?.getTime() ?? 0;
		if (Date.now() - last < 5000) return;
		console.log('👁️ visibilitychange — re-sync foreground (R6)');
		// Re-sync du flag local (peut être désynchronisé après un freeze iOS)
		status.realtimeConnected = pb.realtime.isConnected;
		triggerResync();
	});

	// R6 — Restauration depuis bfcache (iOS Safari navigation back/forward).
	// `event.persisted` true = page restaurée depuis le cache, pas un load normal.
	// Non throttled : un restore bfcache est rare et signifie que la page a été gelée.
	on(window, 'pageshow', (event: PageTransitionEvent) => {
		if (!event.persisted) return;
		if (!status.hasActiveSubscription) return;
		console.log('📄 pageshow (bfcache) — re-sync (R6)');
		status.realtimeConnected = pb.realtime.isConnected;
		triggerResync();
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
		// Cas 1 : Reconnexion realtime avec subscription active
		if (status.hasActiveSubscription && pb.realtime.isConnected && !status.realtimeConnected) {
			console.log('🟢 Realtime reconnecté (polling)');
			status.realtimeConnected = true;
			status.pocketbaseReachable = true;
			status.lastError = null;
			triggerResync();
		}

		// Cas 2 : PB était down mais revient (même sans subscription active)
		if (!status.pocketbaseReachable && status.online && pb.realtime.isConnected) {
			console.log('🟢 Serveur PocketBase de nouveau joignable');
			status.pocketbaseReachable = true;
			status.lastError = null;
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
	get lastSyncAt() {
		return status.lastSyncAt;
	},
	get isNetworkOk() {
		return (
			status.online &&
			status.pocketbaseReachable &&
			(!status.hasActiveSubscription || status.realtimeConnected)
		);
	},
	setHasActiveSubscription(value: boolean) {
		status.hasActiveSubscription = value;
		if (value) status.realtimeConnected = true;
	}
};
