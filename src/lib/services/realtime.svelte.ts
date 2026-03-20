import { pb } from '$lib/pocketbase/pb';
import { withPocketBaseTimeout } from '$lib/stores/networkStore.svelte';
import { userStore } from '$lib/stores/userStore.svelte';

class RealtimeService {
	private masterUnsub: (() => Promise<void>) | null = null;
	private occurrencesUnsub: (() => Promise<void>) | null = null;
	private currentMasterId: string | null = null;
	private currentToken: string | null = null;
	private globalUnsubscribes = new Map<string, () => Promise<void>>();

	// Un seul point d'entrée pour les events
	private handlers = {
		onMasterChange: null as ((action: string, record: any) => void) | null,
		onOccurrenceChange: null as ((action: string, record: any) => void) | null
	};

	registerHandlers(h: typeof this.handlers) {
		this.handlers = h;
	}

	// --- Dispatch interne unique ---

	private dispatch(type: 'master' | 'occurrence', action: string, record: any) {
		if (type === 'master') {
			this.handlers.onMasterChange?.(action, record);
		} else {
			this.handlers.onOccurrenceChange?.(action, record);
		}
	}

	// --- Guest : page-scoped ---

	async subscribeToMaster(masterId: string, token: string): Promise<void> {
		// Guard : utilisateur connecté → pas de souscription page-scoped
		if (userStore.isLoggedIn) {
			this.currentMasterId = masterId;
			return;
		}

		if (this.currentMasterId === masterId && this.currentToken === token) return;
		if (this.masterUnsub || this.occurrencesUnsub) await this.unsubscribe();

		this.currentMasterId = masterId;
		this.currentToken = token;

		try {
			this.masterUnsub = await withPocketBaseTimeout(
				pb.realtime.subscribe(
					`planning_masters/${masterId}`,
					(e) => this.dispatch('master', e.action, e.record),
					{ query: { _token: token } }
				),
				8000
			);

			this.occurrencesUnsub = await withPocketBaseTimeout(
				pb.realtime.subscribe(
					'planning_occurrences',
					(e) => this.dispatch('occurrence', e.action, e.record),
					{ query: { _token: token } }
				),
				8000
			);
		} catch (error) {
			console.error('❌ Realtime: subscribeToMaster failed:', error);
			throw error;
		}
	}

	// --- Auth : global ---

	async subscribeGlobally(): Promise<void> {
		if (!pb.authStore.record) return;

		if (this.globalUnsubscribes.has('__auth__')) {
			console.log('⏭ Realtime: Already subscribed globally');
			return; // Guard idempotence
		}

		try {
			const masterUnsub = await withPocketBaseTimeout(
				pb.realtime.subscribe('planning_masters', (e) =>
					this.dispatch('master', e.action, e.record)
				),
				8000
			);

			const occurrencesUnsub = await withPocketBaseTimeout(
				pb.realtime.subscribe('planning_occurrences', (e) =>
					this.dispatch('occurrence', e.action, e.record)
				),
				8000
			);

			this.globalUnsubscribes.set('__auth__', async () => {
				await masterUnsub();
				await occurrencesUnsub();
			});

			console.log('✅ Realtime: Global auth subscriptions active');
		} catch (error) {
			console.error('❌ Realtime: subscribeGlobally failed:', error);
			throw error;
		}
	}

	// --- Cleanup ---

	async unsubscribe(): Promise<void> {
		if (this.masterUnsub) {
			await this.masterUnsub();
			this.masterUnsub = null;
		}
		if (this.occurrencesUnsub) {
			await this.occurrencesUnsub();
			this.occurrencesUnsub = null;
		}
		this.currentMasterId = null;
		this.currentToken = null;
	}

	async unsubscribeGlobally(): Promise<void> {
		for (const unsub of this.globalUnsubscribes.values()) {
			try {
				await unsub();
			} catch {}
		}
		this.globalUnsubscribes.clear();
	}
}

export const realtimeService = new RealtimeService();
