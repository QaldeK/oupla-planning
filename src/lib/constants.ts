import { Check, HelpCircle, Info, X } from "@lucide/svelte";
import * as m from "$lib/paraglide/messages.js";
import type { ResponseType } from "./types/planning.types";

// === ResponseType disponibles ===
export const AVAILABLE_RESPONSE_TYPES: ResponseType[] = ["present", "if_needed", "maybe", "absent"];

// Configuration complète pour chaque type de réponse
export const RESPONSE_TYPE_CONFIG = {
	present: {
		label: () => m.response_present(),
		icon: Check,
		badgeClass: "badge-success",
		bgClass: "bg-success/20",
		bgClass10: "bg-success/10",
		btnClass: "bg-success/20",
		ringClass: "ring-success",
		borderClass: "border border-success"
	},
	if_needed: {
		label: () => m.response_if_needed(),
		icon: Info,
		badgeClass: "badge-info",
		bgClass: "bg-info/20",
		bgClass10: "bg-info/10",
		btnClass: "btn-info btn-soft",
		ringClass: "ring-info",
		borderClass: "border border-info"
	},
	maybe: {
		label: () => m.response_maybe(),
		icon: HelpCircle,
		badgeClass: "badge-warning",
		bgClass: "bg-warning/20",
		bgClass10: "bg-warning/10",
		btnClass: "btn-warning btn-soft",
		ringClass: "ring-warning",
		borderClass: "border border-warning"
	},
	absent: {
		label: () => m.response_absent(),
		icon: X,
		badgeClass: "badge-error",
		bgClass: "bg-error/20",
		bgClass10: "bg-error/10",
		btnClass: "btn-error btn-soft",
		ringClass: "ring-error",
		borderClass: "border border-error"
	}
} as const satisfies Record<
	ResponseType,
	{
		label: () => string;
		icon: typeof Check;
		badgeClass: string;
		bgClass: string;
		bgClass10: string;
		btnClass: string;
		ringClass: string;
		borderClass: string;
	}
>;

// Accès au label seul. Dérivé de RESPONSE_TYPE_CONFIG pour éviter toute
// duplication des chaînes : la source de vérité du label reste la config.
// Le getter est conservé tel quel pour que le label se résolve à l'appel
// (rendu), prêt pour Paraglide qui y substituera ses fonctions de message.
export const RESPONSE_TYPE_LABELS: Record<ResponseType, () => string> = {
	present: RESPONSE_TYPE_CONFIG.present.label,
	if_needed: RESPONSE_TYPE_CONFIG.if_needed.label,
	maybe: RESPONSE_TYPE_CONFIG.maybe.label,
	absent: RESPONSE_TYPE_CONFIG.absent.label
};
