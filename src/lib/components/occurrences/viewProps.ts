import type { Participant, PlanningMaster, PlanningOccurrence } from "$lib/types/planning.types";

/**
 * Props communes des vues d'occurrence.
 *
 * Hors du barrel : une vue importe cette feuille, et non `index.ts` qui l'importe
 * — sinon le couple barrel ↔ vue forme une boucle d'imports.
 */
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
