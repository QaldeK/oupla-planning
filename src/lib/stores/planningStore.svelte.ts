import type { PlanningMaster, PlanningOccurrence } from '$lib/types/planning.types';
import { pb } from '$lib/pocketbase/pb';
import { getPlanningByToken, getOccurrencesByMaster } from '$lib/services/planningActions';
import { realtimeService } from '$lib/services/realtime.svelte';
import { userStore } from '$lib/stores/userStore.svelte';
import { SvelteMap } from 'svelte/reactivity';

class PlanningStore {
	// Cache interne : token → master (pour éviter les fetchs)
	#tokenCache = new Map<string, PlanningMaster>();
	// Mapping pour l'invalidation : masterId → Set<tokens>
	#masterTokens = new Map<string, Set<string>>();

	#masters = new SvelteMap<string, PlanningMaster>();
	#occurrences = new SvelteMap<string, PlanningOccurrence[]>();
	// État page-scoped (planning actif, guest ou connecté)
	#activeMasterId = $state<string | null>(null);

	#selectedOccurrenceId = $state<string | null>(null);

	#isLoading = $state(false);
	#error = $state<string | null>(null);

	constructor() {
		// Enregistrement unique des handlers — realtimeService ne connaît plus planningStore
		realtimeService.registerHandlers({
			onMasterChange: (action, record) => this.#handleMasterEvent(action, record),
			onOccurrenceChange: (action, record) => this.#handleOccurrenceEvent(action, record)
		});
	}

	// Getters dérivés pour la page active
	get master() {
		return this.#activeMasterId ? (this.#masters.get(this.#activeMasterId) ?? null) : null;
	}
	get occurrences() {
		return this.#activeMasterId ? (this.#occurrences.get(this.#activeMasterId) ?? []) : [];
	}

	get currentOccurrence() {
		return this.occurrences.find((o) => o.id === this.#selectedOccurrenceId) ?? null;
	}

	get selectedOccurrenceId() {
		return this.#selectedOccurrenceId;
	}

	get activeMasterId() {
		return this.#activeMasterId;
	}

	get isLoading() {
		return this.#isLoading;
	}

	get error() {
		return this.#error;
	}

	async init(
		token: string,
		options: { dateFilter: 'future' | 'past' | 'all' } = { dateFilter: 'future' }
	) {
		this.#isLoading = true;
		this.#error = null;

		try {
			// Utiliser le cache si disponible
			const master = await this.getOrFetchMaster(token);
			if (!master) {
				this.#error = 'Planning introuvable';
				return null;
			}

			// Mettre en cache dans la Map
			this.#masters.set(master.id, master);
			this.#activeMasterId = master.id;

			// Déterminer si l'utilisateur est admin
			const isAdmin = master.adminToken === token;

			// Si auth + occurrences déjà fetchées globalement → pas de re-fetch
			if (!this.#occurrences.has(master.id)) {
				const occs = await getOccurrencesByMaster(master.id, token, options);
				this.#occurrences.set(master.id, occs);
			}
			// Sauvegarde
			const identity = userStore.getPlanningIdentity(master.id);
			const existing = userStore.savedPlannings.find((p) => p.masterId === master.id);
			await userStore.savePlanning({
				masterId: master.id,
				title: master.title!,
				participantToken: master.participantToken!,
				...(isAdmin ? { adminToken: token } : {}),
				lastAccessed: new Date().toISOString(),
				currentUser: identity || undefined,
				isSync: userStore.isLoggedIn ? false : undefined // false si auth, undefined si guest
			});

			// Guest uniquement — auth est couvert par subscribeGlobally() dans le layout
			await realtimeService.subscribeToMaster(master.id, token);

			return { master, isAdmin };
		} catch (err) {
			console.error('PlanningStore init error:', err);
			this.#error = 'Erreur lors du chargement';
			return null;
		} finally {
			this.#isLoading = false;
		}
	}

	#handleMasterEvent(action: string, record: any) {
		// Guard : ignorer les events qui ne concernent pas un master connu
		if (!this.#masters.has(record.id) && action !== 'create') return;

		if (action === 'update') {
			const updated: PlanningMaster = {
				...record,
				tasks: record.tasks || [],
				participants: record.participants || []
			};
			this.#masters.set(record.id, updated);

			userStore.savePlanning({
				masterId: updated.id,
				title: updated.title!,
				participantToken: updated.participantToken!,
				lastAccessed: new Date().toISOString()
			});
		} else if (action === 'delete') {
			this.#masters.delete(record.id);
			this.#occurrences.delete(record.id);
		}
	}

	#handleOccurrenceEvent(action: string, record: any) {
		const masterId = record.master;
		if (!masterId) return;

		const current = this.#occurrences.get(masterId) ?? [];

		const occurrence: PlanningOccurrence = {
			...record,
			tasks: record.tasks || [],
			responses: record.responses || [],
			comments: record.comments || []
		};

		switch (action) {
			case 'create':
				if (!current.find((o) => o.id === occurrence.id)) {
					this.#occurrences.set(
						masterId,
						[...current, occurrence].sort((a, b) => a.date.localeCompare(b.date))
					);
				}
				break;
			case 'update':
				this.#occurrences.set(
					masterId,
					current.map((o) => (o.id === occurrence.id ? occurrence : o))
				);
				break;
			case 'delete':
				this.#occurrences.set(
					masterId,
					current.filter((o) => o.id !== occurrence.id)
				);
				break;
		}
	}

	async refreshActive(): Promise<void> {
		if (!this.#activeMasterId) return;
		const saved = userStore.savedPlannings.find((p) => p.masterId === this.#activeMasterId);
		if (!saved) return;

		const token = saved.adminToken ?? saved.participantToken;
		const occs = await getOccurrencesByMaster(this.#activeMasterId, token, {
			dateFilter: 'future'
		});
		this.#occurrences.set(this.#activeMasterId, occs);
	}

	async fetchAllOccurrences(): Promise<void> {
		if (!pb.authStore.record) return;

		// Source 1 : masterId depuis PB (référence)
		const pbMasterIds: string[] = (pb.authStore.record as any).masterId || [];

		// Source 2 : localStorage (pour les tokens)
		const localPlannings = userStore.savedPlannings;

		// Merge : PB dicte QUELS plannings, localStorage fournit LES TOKENS
		const planningsToFetch = pbMasterIds.map((masterId) => {
			const local = localPlannings.find((p) => p.masterId === masterId);
			return {
				masterId,
				token: local?.adminToken ?? local?.participantToken ?? null
			};
		});

		// Ajouter les plannings locaux pas encore dans PB (sync en attente)
		for (const local of localPlannings) {
			if (!pbMasterIds.includes(local.masterId)) {
				planningsToFetch.push({
					masterId: local.masterId,
					token: local.adminToken ?? local.participantToken ?? null
				});
			}
		}

		await Promise.allSettled(
			planningsToFetch
				.filter((p) => !!p.masterId && !!p.token)
				.map(async ({ masterId, token }) => {
					try {
						const occs = await getOccurrencesByMaster(masterId, token!, { dateFilter: 'future' });
						this.#occurrences.set(masterId, occs);

						if (!this.#masters.has(masterId)) {
							const master = await this.getOrFetchMaster(token!);
							if (master) this.#masters.set(masterId, master);
						}
					} catch (err) {
						console.warn(`fetchAllOccurrences: failed for ${masterId}`, err);
					}
				})
		);
	}

	// --- Cache ---

	async getOrFetchMaster(token: string): Promise<PlanningMaster | null> {
		if (this.#tokenCache.has(token)) return this.#tokenCache.get(token)!;

		const result = await getPlanningByToken(token);
		if (!result) return null;

		const master = result.master;
		this.#tokenCache.set(token, master);

		if (!this.#masterTokens.has(master.id)) this.#masterTokens.set(master.id, new Set());
		this.#masterTokens.get(master.id)!.add(token);

		return master;
	}

	invalidateAll(): void {
		this.#tokenCache.clear();
		this.#masterTokens.clear();
	}

	// --- Cleanup page ---

	cleanup() {
		realtimeService.unsubscribe();
		this.#activeMasterId = null;
		this.#selectedOccurrenceId = null;
	}

	// --- Setters ---

	setSelectedOccurrenceId(id: string | null) {
		this.#selectedOccurrenceId = id;
	}
	setOccurrences(occs: PlanningOccurrence[]) {
		if (this.#activeMasterId) this.#occurrences.set(this.#activeMasterId, occs);
	}

	updateParticipants(participants: PlanningMaster['participants']) {
		if (!this.#activeMasterId) return;
		const master = this.#masters.get(this.#activeMasterId);
		if (master) this.#masters.set(this.#activeMasterId, { ...master, participants });
	}

	updateMaster(master: PlanningMaster) {
		this.#masters.set(master.id, master);
	}
}

export const planningStore = new PlanningStore();
