import type { ResponseType } from './types/planning.types';
import { Check, X, HelpCircle, Info } from 'lucide-svelte';

// === ResponseType disponibles ===
export const AVAILABLE_RESPONSE_TYPES: ResponseType[] = ['present', 'if_needed', 'maybe', 'absent'];

// Configuration complète pour chaque type de réponse
export const RESPONSE_TYPE_CONFIG = {
	present: {
		label: 'Présent',
		icon: Check,
		badgeClass: 'badge-success',
		bgClass: 'bg-success/20',
		btnClass: 'btn-success',
		ringClass: 'ring-success',
		borderClass: 'border border-success'
	},
	if_needed: {
		label: 'Si besoin',
		icon: Info,
		badgeClass: 'badge-warning',
		bgClass: 'bg-warning/20',
		btnClass: 'btn-warning',
		ringClass: 'ring-warning',
		borderClass: 'border border-warning'
	},
	maybe: {
		label: 'Peut-être',
		icon: HelpCircle,
		badgeClass: 'badge-warning',
		bgClass: 'bg-warning/20',
		btnClass: 'btn-warning',
		ringClass: 'ring-warning',
		borderClass: 'border border-warning'
	},
	absent: {
		label: 'Absent',
		icon: X,
		badgeClass: 'badge-error',
		bgClass: 'bg-error/20',
		btnClass: 'btn-error',
		ringClass: 'ring-error',
		borderClass: 'border border-error'
	}
} as const satisfies Record<
	ResponseType,
	{
		label: string;
		icon: any;
		badgeClass: string;
		bgClass: string;
		btnClass: string;
		ringClass: string;
		borderClass: string;
	}
>;

// Helper pour accéder au label uniquement
export const RESPONSE_TYPE_LABELS: Record<ResponseType, string> = {
	present: 'Présent',
	if_needed: 'Si besoin',
	maybe: 'Peut-être',
	absent: 'Absent'
};
