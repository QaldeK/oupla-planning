import { on } from "svelte/events";
import { browser } from "$app/environment";
import { pb } from "$lib/pocketbase/pb";
import { syncService } from "$lib/services/syncService";
import { planningStore } from "./planningStore.svelte";

interface NetworkStatus {
	online: boolean;
	realtimeConnected: boolean; // debounced (DISCONNECT_DEBOUNCE_MS) — cf. setRealtimeConnected
	hasActiveSubscription: boolean; // vrai si au moins un canal est souscrit
	lastError: Date | null;
	lastSyncAt: Date | null; // R6 : curseur de throttle pour les re-syncs (visibility/pageshow)
}

const status = $state<NetworkStatus>({
	online: browser ? navigator.onLine : true,
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
 * - `lastFetchAt` (planningStore, per-master, persisté en Dexie `localMeta`) :
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
		console.warn("[networkStore] resync attempt failed:", err);
		return false;
	}
}

// État brut de la connexion SSE (immédiat, non réactif).
// la transition false→true et déclencher triggerResync vite.
let realtimeLive = true;
// Debounce sur la descente : PocketBase ferme les SSE inactives après ~5 min
// (idleTimeout natif), et le SDK les reconnecte en <2s. Sans debounce, chaque
// cycle provoquerait un flicker de l'alerte réseau côté UI.
let disconnectDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const DISCONNECT_DEBOUNCE_MS = 5000;

/**
 * Met à jour l'état realtime. La remontée (true) est immédiate (l'alerte doit
 * disparaître vite) ; la descente (false) est debouncée sur DISCONNECT_DEBOUNCE_MS
 * pour masquer les micro-coupures SSE reconnectées nativement par le SDK.
 */
function setRealtimeConnected(connected: boolean): void {
	realtimeLive = connected;
	if (connected) {
		if (disconnectDebounceTimer) {
			clearTimeout(disconnectDebounceTimer);
			disconnectDebounceTimer = null;
		}
		status.realtimeConnected = true;
		return;
	}
	// Descente : un seul timer, non reseté par les onDisconnect répétés pendant
	// les tentatives de reconnexion du SDK (qui appellent disconnect(true) → onDisconnect).
	if (disconnectDebounceTimer) return;
	disconnectDebounceTimer = setTimeout(() => {
		disconnectDebounceTimer = null;
		status.realtimeConnected = false;
	}, DISCONNECT_DEBOUNCE_MS);
}

// Écouter online/offline (Svelte 5 way)
if (browser) {
	on(window, "online", () => {
		status.online = true;
	});

	on(window, "offline", () => {
		status.online = false;
		setRealtimeConnected(false);
	});

	// R6 — Retour au premier plan après freeze background (iOS Safari, Android PWA).
	// Les navigateurs mobiles freezent les timers JS en background (~30s), donc le polling
	// 2s ne tourne plus et ne détecte pas la reconnexion SSE au retour. On force une
	// re-sync indépendamment du flag `realtimeConnected` (qui peut être faux : SSE
	// "connectée" mais events droppés silencieusement pendant le freeze, TCP half-open).
	on(document, "visibilitychange", () => {
		if (document.visibilityState !== "visible") return;
		// Rien à synchroniser sans subscription active (ex: landing page /)
		if (!status.hasActiveSubscription) return;
		// Throttle 5s : évite le spam sur switches d'onglets rapides
		const last = status.lastSyncAt?.getTime() ?? 0;
		if (Date.now() - last < 5000) return;
		console.log("👁️ visibilitychange — re-sync foreground (R6)");
		// Re-sync du flag local (peut être désynchronisé après un freeze iOS)
		setRealtimeConnected(pb.realtime.isConnected);
		triggerResync();
	});

	// R6 — Restauration depuis bfcache (iOS Safari navigation back/forward).
	// `event.persisted` true = page restaurée depuis le cache, pas un load normal.
	// Non throttled : un restore bfcache est rare et signifie que la page a été gelée.
	on(window, "pageshow", (event: PageTransitionEvent) => {
		if (!event.persisted) return;
		if (!status.hasActiveSubscription) return;
		console.log("📄 pageshow (bfcache) — re-sync (R6)");
		setRealtimeConnected(pb.realtime.isConnected);
		triggerResync();
	});

	// onDisconnect : hook officiel, appelé dès que l'EventSource se ferme
	pb.realtime.onDisconnect = () => {
		// Ignorer si aucune souscription active (évite race condition lors de la transition guest→auth)
		if (!status.hasActiveSubscription) return;
		console.log("🔴 Realtime déconnecté");
		setRealtimeConnected(false);
		status.lastError = new Date();
	};

	// Polling pour détecter la remontée
	setInterval(() => {
		// Reconnexion realtime avec subscription active
		// Lecture de realtimeLive (état brut) pour détecter la transition vite, indépendamment du debounce UI.
		if (status.hasActiveSubscription && pb.realtime.isConnected && !realtimeLive) {
			console.log("🟢 Realtime reconnecté (polling)");
			setRealtimeConnected(true);
			status.lastError = null;
			triggerResync();
		}
	}, 2000);
}

// Export read-only
export const networkStore = {
	get online() {
		return status.online;
	},
	/**
	 * État realtime vu par l'UI. Debouncé sur la descente (DISCONNECT_DEBOUNCE_MS) :
	 * PocketBase ferme les SSE inactives après ~5 min (idleTimeout natif) et le SDK
	 * les reconnecte en <2s — sans debounce, chaque cycle ferait flicker l'alerte.
	 * Une déconnexion persistant au-delà du debounce remonte ici comme `false`.
	 */
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
		return status.online && (!status.hasActiveSubscription || status.realtimeConnected);
	},
	setHasActiveSubscription(value: boolean) {
		status.hasActiveSubscription = value;
		if (value) setRealtimeConnected(true);
	}
};
