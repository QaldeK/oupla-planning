import type { PlanningMaster, PlanningOccurrence } from '$lib/types/planning.types';
import { pb } from '$lib/pocketbase/pb';
import { getPlanningByToken, getOccurrencesByMaster } from '$lib/services/planningActions';
import { realtimeService } from '$lib/services/realtime.svelte';
import { userStore } from '$lib/stores/userStore.svelte';

class PlanningStore {
	// Cache interne des masters
	#masterCache = $state(new Map<string, PlanningMaster>());
	#pendingFetches = new Map<string, Promise<PlanningMaster | null>>();

	#master = $state<PlanningMaster | null>(null);
	#occurrences = $state<PlanningOccurrence[]>([]);
	#selectedOccurrenceId = $state<string | null>(null);
	#isLoading = $state(false);
	#error = $state<string | null>(null);

	get master() {
		return this.#master;
	}
	get occurrences() {
		return this.#occurrences;
	}
	get selectedOccurrenceId() {
		return this.#selectedOccurrenceId;
	}
	get isLoading() {
		return this.#isLoading;
	}
	get error() {
		return this.#error;
	}

	get currentOccurrence() {
		return this.#occurrences.find((o) => o.id === this.#selectedOccurrenceId) || null;
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

			this.#master = master;

			// Déterminer si l'utilisateur est admin
			const isAdmin = master.adminToken === token;

			// Charger les occurrences avec les options passées
			const occs = await getOccurrencesByMaster(master.id, token, options);
			this.#occurrences = occs;

			// Sauvegarde
			const identity = userStore.getPlanningIdentity(master.id);

			await userStore.savePlanning({
				masterId: master.id,
				title: master.title,
				adminToken: isAdmin ? token : undefined,
				participantToken: (isAdmin ? master.participantToken : token) || '',
				lastAccessed: new Date().toISOString(),
				currentUser: identity || undefined
			});

			await realtimeService.subscribeToMaster(master.id, token, {
				onMasterChange: (_, updatedMaster) => {
					this.#master = updatedMaster;
					// Sauvegarder les métadonnées mises à jour
					userStore.savePlanning({
						masterId: updatedMaster.id,
						title: updatedMaster.title,
						participantToken: (isAdmin ? master.participantToken : token) || '',
						adminToken: isAdmin ? token : undefined,
						lastAccessed: new Date().toISOString()
					});
				},
				onOccurrenceChange: (action, updatedOccurrence) => {
					this.#handleOccurrenceUpdate(action, updatedOccurrence);
				},
				onReconnect: () => {
					this.init(token, options);
				}
			});

			return { master, isAdmin };
		} catch (err) {
			console.error('PlanningStore init error:', err);
			this.#error = 'Erreur lors du chargement';
			return null;
		} finally {
			this.#isLoading = false;
		}
	}

	#handleOccurrenceUpdate(action: string, updated: PlanningOccurrence) {
		switch (action) {
			case 'create':
				if (!this.#occurrences.find((o) => o.id === updated.id)) {
					this.#occurrences = [...this.#occurrences, updated].sort((a, b) =>
						a.date.localeCompare(b.date)
					);
				}
				break;
			case 'update':
				this.updateOccurrence(updated);
				break;
			case 'delete':
				this.#occurrences = this.#occurrences.filter((o) => o.id !== updated.id);
				break;
		}
	}

	updateOccurrence(updated: PlanningOccurrence) {
		this.#occurrences = this.#occurrences.map((o) => (o.id === updated.id ? updated : o));
	}

	cleanup() {
		realtimeService.unsubscribe();
		this.#selectedOccurrenceId = null;
	}

	setMaster(master: PlanningMaster | null) {
		this.#master = master;
	}

	updateParticipants(participants: PlanningMaster['participants']) {
		if (this.#master) {
			this.#master.participants = participants;
		}
	}

	setOccurrences(occs: PlanningOccurrence[]) {
		this.#occurrences = occs;
	}
	setSelectedOccurrenceId(id: string | null) {
		this.#selectedOccurrenceId = id;
	}

	/**
	 * Récupère un master depuis le cache ou le fetch depuis PB
	 */
	async getOrFetchMaster(token: string): Promise<PlanningMaster | null> {
		const result = await getPlanningByToken(token);
		if (!result) return null;

		const masterId = result.master.id;

		// 1. Vérifier le cache
		if (this.#masterCache.has(masterId)) {
			return this.#masterCache.get(masterId)!;
		}

		// 2. Dédupliquer les requêtes en cours
		if (this.#pendingFetches.has(masterId)) {
			return this.#pendingFetches.get(masterId)!;
		}

		// 3. Fetch et mise en cache
		const fetchPromise = this.fetchAndCacheMaster(result.master);
		this.#pendingFetches.set(masterId, fetchPromise);

		try {
			return await fetchPromise;
		} finally {
			this.#pendingFetches.delete(masterId);
		}
	}

	/**
	 * Fetch un master depuis PB et le met en cache
	 */
	private async fetchAndCacheMaster(master: PlanningMaster): Promise<PlanningMaster> {
		// Fetch avec expand des relations
		const fullMaster = await pb.collection('planning_masters').getOne<PlanningMaster>(master.id, {
			expand: 'participants.user'
		});

		// Mise en cache
		this.#masterCache.set(master.id, fullMaster);

		return fullMaster;
	}

	/**
	 * Invalide le cache pour un master spécifique
	 */
	invalidateMaster(masterId: string): void {
		this.#masterCache.delete(masterId);
	}

	/**
	 * Invalide tout le cache (déconnexion, etc.)
	 */
	invalidateAll(): void {
		this.#masterCache.clear();
	}
}

export const planningStore = new PlanningStore();
