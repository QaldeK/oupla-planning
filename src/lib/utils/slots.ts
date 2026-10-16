import type { PlanningMaster, PlanningOccurrence, TimeSlot } from "$lib/types/planning.types";

/**
 * Clé de réconciliation date×slot : `${date}|${slotId}`.
 * Utilisée côté formulaire (sélection) et côté service (réconciliation occurrences↔cibles).
 * Source unique — un changement de format ne peut pas casser silencieusement la réconciliation.
 */
export function formatSlotKey(date: string, slotId?: string): string {
	return `${date}|${slotId ?? ""}`;
}

/**
 * Génère un id court type `s1`, `s2`... pour un nouveau timeSlot.
 *
 * Algo : `s${maxNumericId + 1}` calculé depuis les ids `s<N>` déjà présents dans
 * `existing`. Les ids non conformes (UUID legacy, etc.) sont ignorés. Particularités :
 *  - Déterministe et lisible en DB.
 *  - Évite la collision avec les slots déjà présents au moment de l'ajout.
 *  - Un id supprimé peut être réutilisé une fois ses occurrences soft-deletées
 *    au save (la suppression d'un slot entraîne le soft-delete de ses occurrences
 *    via le diff) — sans risque de mal-référencement d'une occurrence active.
 */
export function generateTimeSlotId(existing: { id: string }[]): string {
	let max = 0;
	for (const s of existing) {
		const match = /^s(\d+)$/.exec(s.id);
		if (match) {
			const n = Number(match[1]);
			if (n > max) max = n;
		}
	}
	return `s${max + 1}`;
}

/**
 * Résout les templates de créneaux effectifs d'un master. Renvoie toujours au
 * moins un slot explicite : si `timeSlots` est absent ou vide (master legacy
 * mono-créneau non encore nettoyé), on synthétise un slot unique `s1` depuis
 * `defaultStartTime`/`defaultEndTime`. Plus de sentinelle `'default'`.
 */
export function resolveTimeSlots(
	master: Pick<PlanningMaster, "timeSlots" | "defaultStartTime" | "defaultEndTime">
): TimeSlot[] {
	if (master.timeSlots && master.timeSlots.length > 0) {
		return master.timeSlots;
	}
	return [
		{
			id: "s1",
			startTime: master.defaultStartTime,
			endTime: master.defaultEndTime
		}
	];
}

/**
 * Shape attendue par `isOverridden` pour résoudre les slots templates de référence.
 * Accepte aussi bien un `PlanningMaster` complet qu'un `CreatePlanningData`
 * (qui est l'état cible du master après save).
 */
type TimeSlotResolvable = Pick<PlanningMaster, "timeSlots" | "defaultStartTime" | "defaultEndTime">;

/**
 * Détermine si une occurrence est en override d'horaires par rapport au slot
 * template qu'elle référence. La comparaison se fait contre `master` vu comme
 * l'état **cible** du master après save — d'où l'acceptation d'un type
 * structural qui couvre `CreatePlanningData`.
 *
 * Une occurrence sans `slotId` (custom pur) n'est jamais overridée. Un `slotId`
 * orphelin (template supprimé) est traité comme non-overridé afin de ne pas
 * écarter une occurrence dont le template d'origine a disparu.
 */
export function isOverridden(
	occ: Pick<PlanningOccurrence, "slotId" | "startTime" | "endTime">,
	master: TimeSlotResolvable
): boolean {
	if (!occ.slotId) return false;
	const slot = resolveTimeSlots(master).find((s) => s.id === occ.slotId);
	if (!slot) return false;
	return occ.startTime !== slot.startTime || occ.endTime !== slot.endTime;
}
