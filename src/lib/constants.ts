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
		bgClass10: 'bg-success/10',
		btnClass: 'bg-success/20',
		ringClass: 'ring-success',
		borderClass: 'border border-success'
	},
	if_needed: {
		label: 'Si besoin',
		icon: Info,
		badgeClass: 'badge-info',
		bgClass: 'bg-info/20',
		bgClass10: 'bg-info/10',
		btnClass: 'btn-info btn-soft',
		ringClass: 'ring-info',
		borderClass: 'border border-info'
	},
	maybe: {
		label: 'Peut-être',
		icon: HelpCircle,
		badgeClass: 'badge-warning',
		bgClass: 'bg-warning/20',
		bgClass10: 'bg-warning/10',
		btnClass: 'btn-warning btn-soft',
		ringClass: 'ring-warning',
		borderClass: 'border border-warning'
	},
	absent: {
		label: 'Absent',
		icon: X,
		badgeClass: 'badge-error',
		bgClass: 'bg-error/20',
		bgClass10: 'bg-error/10',
		btnClass: 'btn-error btn-soft',
		ringClass: 'ring-error',
		borderClass: 'border border-error'
	}
} as const satisfies Record<
	ResponseType,
	{
		label: string;
		icon: typeof Check;
		badgeClass: string;
		bgClass: string;
		bgClass10: string;
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
