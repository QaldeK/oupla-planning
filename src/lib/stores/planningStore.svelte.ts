import type { PlanningMaster, PlanningOccurrence } from '$lib/types/planning.types';
import { getPlanningByToken, getOccurrencesByMaster } from '$lib/services/planningActions';
import { realtimeService } from '$lib/services/realtime.svelte';
import { userStore } from '$lib/stores/userStore.svelte';

class PlanningStore {
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
			const result = await getPlanningByToken(token);
			if (!result) {
				this.#error = 'Planning introuvable';
				return null;
			}

			this.#master = result.master;

			// Charger les occurrences avec les options passées
			const occs = await getOccurrencesByMaster(result.master.id, token, options);
			this.#occurrences = occs;

			// Sauvegarde
			const identity = userStore.getPlanningIdentity(result.master.id);
			const shouldPersist = identity?.rememberMe === true;

			await userStore.savePlanning({
				masterId: result.master.id,
				title: result.master.title,
				adminToken: result.isAdmin ? token : undefined,
				participantToken: (result.isAdmin ? result.master.participantToken : token) || '',
				lastAccessed: new Date().toISOString(),
				currentUser: identity || undefined,
				persist: shouldPersist
			});

			await realtimeService.subscribeToMaster(result.master.id, token, {
				onMasterChange: (_, updatedMaster) => {
					this.#master = updatedMaster;
				},
				onOccurrenceChange: (action, updatedOccurrence) => {
					this.#handleOccurrenceUpdate(action, updatedOccurrence);
				},
				onReconnect: () => {
					this.init(token, options);
				}
			});

			return result;
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
}

export const planningStore = new PlanningStore();
