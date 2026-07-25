import { pb } from '$lib/pocketbase/pb';
import type {
	PlanningParticipantsMissingDaysOptions,
	PlanningParticipantsReminderDaysOptions
} from '$lib/types/pocketbase-types';
import type { RecurrenceType } from '$lib/types/planning.types';

/**
 * Périmètre des notifications de nouveaux messages sur les occurrences.
 * - `off` : aucune notification
 * - `concerned` : uniquement les occurrences où le participant est impliqué
 *   (réponse présente/if_needed/maybe OU inscrit à une tâche)
 * - `all` : toutes les occurrences du planning
 */
export type NewCommentScope = 'off' | 'concerned' | 'all';

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
	'reminderDays' | 'missingDays' | 'newCommentScope'
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
	Pick<PlanningParticipantPrefs, 'reminderDays' | 'missingDays'>
> = {
	WEEKLY: { reminderDays: ['1', '3'], missingDays: ['1', '3'] },
	BIWEEKLY: { reminderDays: ['1', '3'], missingDays: ['1', '3', '7'] },
	MONTHLY_BY_DATE: { reminderDays: ['1', '3', '7'], missingDays: ['1', '3', '7'] },
	MONTHLY_BY_DAY: { reminderDays: ['1', '3', '7'], missingDays: ['1', '3', '7'] },
	DAILY: { reminderDays: ['1'], missingDays: ['1'] },
	CUSTOM: { reminderDays: ['1', '3', '7'], missingDays: ['1', '3', '7', '15'] }
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
		newCommentScope: isAdmin ? 'all' : 'concerned'
	};
}

function urlBase64ToUint8Array(base64String: string) {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');

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

export async function subscribeToPush(userId: string): Promise<boolean> {
	if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;

	const permission = await Notification.requestPermission();
	if (permission !== 'granted') return false;

	try {
		const reg = await getServiceWorkerWithTimeout();
		if (!reg) {
			console.error('ServiceWorker non disponible ou timeout');
			return false;
		}

		let sub = await reg.pushManager.getSubscription();

		if (!sub) {
			const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
			if (!vapidKey) {
				console.error('VITE_VAPID_PUBLIC_KEY missing');
				return false;
			}
			sub = await reg.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: urlBase64ToUint8Array(vapidKey)
			});
		}

		await pb.collection('users').update(userId, {
			push_subscription: JSON.parse(JSON.stringify(sub))
		});
		return true;
	} catch (error) {
		console.error('Erreur lors de la souscription push', error);
		return false;
	}
}

export async function unsubscribeFromPush(userId: string): Promise<void> {
	try {
		const reg = await getServiceWorkerWithTimeout();
		if (!reg) {
			console.warn('ServiceWorker non disponible, skip unsubscribe');
			return;
		}

		const sub = await reg.pushManager.getSubscription();
		if (sub) {
			await sub.unsubscribe();
		}
		await pb.collection('users').update(userId, { push_subscription: null });
	} catch (error) {
		console.error('Erreur unsubscribe push', error);
	}
}
