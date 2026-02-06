import type { PlanningOccurrence, PlanningMaster, Participant } from '$lib/types/planning.types';

export type ViewType = 'card' | 'compact';

export interface ViewProps {
	occurrence: PlanningOccurrence;
	master: PlanningMaster;
	participants: Participant[];
	currentUserId?: string;
	isAdmin: boolean;
	readOnly?: boolean;
}

// Export du composant unique
import OccurrenceView from './views/OccurrenceView.svelte';
export { OccurrenceView };
