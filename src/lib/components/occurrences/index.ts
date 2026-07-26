import type {
	Participant,
	PlanningMaster,
	PlanningOccurrence,
	ViewType
} from "$lib/types/planning.types";

export type { ViewType };

export interface ViewProps {
	occurrence: PlanningOccurrence;
	master: PlanningMaster;
	participants: Participant[];
	currentUserId?: string;
	isAdmin: boolean;
	readOnly?: boolean;
	/**
	 * Appelé quand l'utilisateur tente de répondre sans être identifié valide.
	 * Si non fourni, un toast d'erreur est affiché (legacy).
	 */
	onNeedReidentify?: () => void;
}

// Export du composant unique
import OccurrenceView from "./views/OccurrenceView.svelte";

export { OccurrenceView };
