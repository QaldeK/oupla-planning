import type { PlanningOccurrence, PlanningMaster } from '$lib/types/planning.types';
import { planningStore } from './planningStore.svelte';

export interface DrawerData {
	occurrenceId: string;
	currentUserId?: string;
	isAdmin: boolean;
}

class DrawerStore {
	/** État d'ouverture du drawer */
	open = $state(false);

	/** Métadonnées du drawer (userId, rôle) */
	#metadata = $state<{ currentUserId?: string; isAdmin: boolean }>({
		isAdmin: false
	});

	/**
	 * Données calculées combinant l'état local et le planningStore
	 */
	data = $derived.by(() => {
		const occurrence = planningStore.currentOccurrence;
		const master = planningStore.master;

		if (!occurrence || !master) return null;

		return {
			occurrence,
			master,
			currentUserId: this.#metadata.currentUserId,
			isAdmin: this.#metadata.isAdmin
		};
	});

	/**
	 * Ouvre le drawer des commentaires pour une occurrence
	 */
	showComments(data: DrawerData) {
		planningStore.setSelectedOccurrenceId(data.occurrenceId);
		this.#metadata = {
			currentUserId: data.currentUserId,
			isAdmin: data.isAdmin
		};
		this.open = true;
	}

	/**
	 * Ferme le drawer
	 */
	close() {
		this.open = false;
		// On ne nettoie pas l'ID immédiatement pour éviter que le contenu
		// disparaisse brutalement pendant l'animation de fermeture
		setTimeout(() => {
			if (!this.open) {
				planningStore.setSelectedOccurrenceId(null);
			}
		}, 300);
	}
}

export const drawerStore = new DrawerStore();
