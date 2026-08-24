import { pb } from "$lib/pocketbase/pb";
import type { RecurrenceType } from "$lib/types/planning.types";
import type {
	PlanningParticipantsMissingDaysOptions,
	PlanningParticipantsReminderDaysOptions
} from "$lib/types/pocketbase-types";
import { storage } from "$lib/utils/storage";

/**
 * Périmètre des notifications de nouveaux messages sur les occurrences.
 * - `off` : aucune notification
 * - `concerned` : uniquement les occurrences où le participant est impliqué
 *   (réponse présente/if_needed/maybe OU inscrit à une tâche)
 * - `all` : toutes les occurrences du planning
 */
export type NewCommentScope = "off" | "concerned" | "all";

/**
 * Préférences de notification d'un participant pour un planning.
 * Reflète exactement les champs de la collection `planning_participants`
 * (hors `commentReadState`, géré séparément).
 */
export interface PlanningParticipantPrefs {
	push: boolean;
	email: boolean;
	onOccurrenceChange: boolean;
	onConfirmationNeeded: boolean;
	reminderDays: PlanningParticipantsReminderDaysOptions[];
	missingDays: PlanningParticipantsMissingDaysOptions[];
	newCommentScope: NewCommentScope;
}

/**
 * Defaults communs (booléens), ne dépendant ni du `recurrenceType` ni du rôle.
 * `reminderDays`/`missingDays` dépendent du `recurrenceType`, `newCommentScope`
 * dépend du rôle — voir `getDefaultPlanningPrefs`.
 */
const baseDefaultPlanningPrefs: Omit<
	PlanningParticipantPrefs,
	"reminderDays" | "missingDays" | "newCommentScope"
> = {
	push: false,
	email: true,
	onOccurrenceChange: true,
	onConfirmationNeeded: false
};

/**
 * Defaults de `reminderDays` / `missingDays` selon le `recurrenceType` du master.
 */
const RECURRENCE_DEFAULTS: Record<
	RecurrenceType,
	Pick<PlanningParticipantPrefs, "reminderDays" | "missingDays">
> = {
	WEEKLY: { reminderDays: ["1", "3"], missingDays: ["1", "3"] },
	BIWEEKLY: { reminderDays: ["1", "3"], missingDays: ["1", "3", "7"] },
	MONTHLY_BY_DATE: { reminderDays: ["1", "3", "7"], missingDays: ["1", "3", "7"] },
	MONTHLY_BY_DAY: { reminderDays: ["1", "3", "7"], missingDays: ["1", "3", "7"] },
	DAILY: { reminderDays: ["1"], missingDays: ["1"] },
	CUSTOM: { reminderDays: ["1", "3", "7"], missingDays: ["1", "3", "7", "15"] }
};

/**
 * Defaults de prefs à appliquer à la création d'un `planning_participants`
 * (quand un user rejoint un planning). Les valeurs de rappel / missings
 * dépendent du `recurrenceType` du master ; `newCommentScope` dépend du rôle
 * (un admin suit toutes les conversations, un participant uniquement ce qui
 * le concerne). Ce default n'est posé qu'à la création — les transitions de
 * rôle ultérieures ne le réécrivent jamais.
 */
export function getDefaultPlanningPrefs(
	recurrenceType: RecurrenceType,
	isAdmin = false
): PlanningParticipantPrefs {
	return {
		...baseDefaultPlanningPrefs,
		...RECURRENCE_DEFAULTS[recurrenceType],
		newCommentScope: isAdmin ? "all" : "concerned"
	};
}

function urlBase64ToUint8Array(base64String: string) {
	const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");

	const rawData = window.atob(base64);
	const outputArray = new Uint8Array(rawData.length);

	for (let i = 0; i < rawData.length; ++i) {
		outputArray[i] = rawData.charCodeAt(i);
	}
	return outputArray;
}

/**
 * Helper pour éviter le blocage infini si le service worker est cassé
 */
async function getServiceWorkerWithTimeout(): Promise<ServiceWorkerRegistration | null> {
	try {
		return await Promise.race([
			navigator.serviceWorker.ready,
			new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))
		]);
	} catch {
		return null;
	}
}

/**
 * Flag local (persistant) posé quand l'utilisateur retire explicitement cet
 * appareil : sans lui, le sync au login/visite recréerait une subscription
 * que l'utilisateur vient de supprimer.
 */
const PUSH_OPTOUT_KEY = "oupla_push_optout";

async function isPushOptOut(): Promise<boolean> {
	return (await storage.getItem<boolean>(PUSH_OPTOUT_KEY)) === true;
}

/** Efface l'opt-out local — appelé à la réactivation explicite (modal/settings). */
export async function clearPushOptOut(): Promise<void> {
	await storage.removeItem(PUSH_OPTOUT_KEY);
}

async function upsertSubscription(sub: PushSubscription): Promise<void> {
	await pb.send("/api/push-subscription", {
		method: "POST",
		body: {
			subscription: sub.toJSON(),
			userAgent: navigator.userAgent
		}
	});
}

/**
 * Aligne la subscription push de cet appareil avec l'état serveur.
 *
 * Idempotent et silencieux par design :
 * - opt-out local ou utilisateur non authentifié → no-op ;
 * - permission non accordée → no-op (jamais de `requestPermission()` implicite,
 *   le prompt ne peut être déclenché que sur geste utilisateur via l'option) ;
 * - subscription existante → upsert serveur (rafraîchit clés + ownership,
 *   mécanisme de résilience à la rotation des clés navigateur) ;
 * - pas de subscription → souscription VAPID uniquement si au moins un
 *   planning du user a push activé.
 *
 * @param options.requestPermission Autorise le prompt navigateur (appel sur geste utilisateur uniquement).
 * @returns true si une subscription est enregistrée côté serveur.
 */
export async function syncPushSubscription(
	options: { requestPermission?: boolean } = {}
): Promise<boolean> {
	if (!pb.authStore.isValid || !pb.authStore.record) return false;
	if (await isPushOptOut()) return false;
	if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;

	try {
		if (Notification.permission !== "granted") {
			if (!options.requestPermission) return false;
			if ((await Notification.requestPermission()) !== "granted") return false;
		}

		const reg = await getServiceWorkerWithTimeout();
		if (!reg) {
			console.error("ServiceWorker non disponible ou timeout");
			return false;
		}

		let sub = await reg.pushManager.getSubscription();

		if (!sub) {
			const hasPushPlanning = await pb
				.collection("planning_participants")
				.getList(1, 1, {
					filter: pb.filter(`user = {:userId} && push = true`, {
						userId: pb.authStore.record.id
					})
				})
				.then((r) => r.totalItems > 0)
				.catch(() => false);
			if (!hasPushPlanning) return false;

			const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
			if (!vapidKey) {
				console.error("VITE_VAPID_PUBLIC_KEY missing");
				return false;
			}
			sub = await reg.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: urlBase64ToUint8Array(vapidKey)
			});
		}

		await upsertSubscription(sub);
		return true;
	} catch (error) {
		console.error("Erreur lors de la synchronisation push", error);
		return false;
	}
}

/**
 * Détache l'appareil du compte sans tuer la subscription navigateur : la
 * suppression serveur (par endpoint) est tolérante aux erreurs réseau — une
 * row résiduelle sera nettoyée par le 410 d'un prochain envoi. La subscription
 * reste réutilisable, notamment pour le cas deux-users-un-navigateur.
 */
export async function detachCurrentDeviceFromAccount(): Promise<void> {
	try {
		const reg = await getServiceWorkerWithTimeout();
		if (!reg) return;

		const sub = await reg.pushManager.getSubscription();
		if (!sub) return;

		await pb.send("/api/push-subscription", {
			method: "DELETE",
			body: { endpoint: sub.endpoint }
		});
	} catch (error) {
		console.error("Erreur lors du détachement de l'appareil push", error);
	}
}

/**
 * Retire cet appareil : suppression serveur (par endpoint), unsubscribe
 * navigateur, puis pose de l'opt-out local pour empêcher toute re-souscription
 * automatique au prochain sync.
 */
export async function removeCurrentDevice(): Promise<void> {
	await storage.setItem(PUSH_OPTOUT_KEY, true, { persist: true });

	try {
		const reg = await getServiceWorkerWithTimeout();
		if (!reg) {
			console.warn("ServiceWorker non disponible, skip retrait push");
			return;
		}

		const sub = await reg.pushManager.getSubscription();
		if (!sub) return;

		await pb.send("/api/push-subscription", {
			method: "DELETE",
			body: { endpoint: sub.endpoint }
		});
		await sub.unsubscribe();
	} catch (error) {
		console.error("Erreur lors du retrait de l'appareil push", error);
	}
}

/**
 * Retrait d'un appareil distant (autre navigateur de l'utilisateur) : delete
 * SDK direct, couvert par la deleteRule `user = @request.auth.id`.
 */
export async function removeRemoteDevice(subscriptionId: string): Promise<void> {
	await pb.collection("push_subscriptions").delete(subscriptionId);
}
