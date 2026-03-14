import { pb } from '$lib/pocketbase/pb';

export interface PlanningParticipantPrefs {
	push: boolean;
	email: boolean;
	reminderDays: number;
	missingParticipantsDays: number;
	onCancellation: boolean;
	onTimeChange: boolean;
}

export const defaultPlanningPrefs: Partial<PlanningParticipantPrefs> = {
	push: false,
	email: false,
	reminderDays: 0,
	missingParticipantsDays: 0,
	onCancellation: true,
	onTimeChange: true
};

function urlBase64ToUint8Array(base64String: string) {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');

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

		// @ts-ignore
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
		// @ts-ignore
		await pb.collection('users').update(userId, { push_subscription: null });
	} catch (error) {
		console.error('Erreur unsubscribe push', error);
	}
}
