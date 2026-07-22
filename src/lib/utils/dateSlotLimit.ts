import { generateRecurrenceDates } from './recurrence';
import { formatSlotKey } from './slots';
import type { RecurrenceType, TimeSlot } from '$lib/types/planning.types';

export interface ComputeMaxDateArgs {
	firstDate: string; // YYYY-MM-DD
	lastDate: string; // YYYY-MM-DD (borne sup actuelle)
	recurrenceType: RecurrenceType; // jamais CUSTOM en pratique (bouton non rendu)
	monthlyByDayOccurrences?: number[]; // pour MONTHLY_BY_DAY
	manualDates: string[]; // dates arbitraires (hors cycle), comptées dans le budget
	timeSlots: TimeSlot[];
	disabledSlotKeys: Set<string>; // clés 'date|slotId' désactivées
	todayStr: string; // YYYY-MM-DD — filtre des dates futures
}

/**
 * Dernière date de cycle (YYYY-MM-DD) ramenant le compte de DateSlots futurs
 * actives à ≤ 100. Préserve les dates les plus anciennes (proches de
 * `firstDate`), tronque les plus récentes. Retournée au bouton « Ajuster au… ».
 *
 * Retourne `null` si recurrence CUSTOM, cycle vide, aucune date future, ou
 * total déjà ≤ 100. Si même la 1re date de cycle déborde (manualDates seules
 * > 100), retourne quand même cette 1re date — l'utilisateur devra réduire les
 * manualDates à la main.
 */
export function computeMaxDateForLimit(args: ComputeMaxDateArgs): string | null {
	const {
		firstDate,
		lastDate,
		recurrenceType,
		monthlyByDayOccurrences,
		manualDates,
		timeSlots,
		disabledSlotKeys,
		todayStr
	} = args;

	// Bouton non rendu en CUSTOM, garde-fou défensif.
	if (recurrenceType === 'CUSTOM') return null;

	const cycleDates = generateRecurrenceDates({
		type: recurrenceType,
		firstDate,
		lastDate,
		monthlyByDayOccurrences:
			recurrenceType === 'MONTHLY_BY_DAY' ? monthlyByDayOccurrences : undefined
	});
	if (cycleDates.length === 0) return null;

	const futureCycle = cycleDates.filter((d) => d >= todayStr);
	if (futureCycle.length === 0) return null;

	const futureManual = manualDates.filter((d) => d >= todayStr);
	const allFutureDates = [...new Set([...futureCycle, ...futureManual])].sort();
	const futureCycleSet = new Set(futureCycle);

	const activeSlotsForDate = (date: string): number => {
		let active = 0;
		for (const slot of timeSlots) {
			if (!disabledSlotKeys.has(formatSlotKey(date, slot.id))) active++;
		}
		return active;
	};

	// Parcours ascendant : on accumule les DateSlots depuis la 1re date future.
	// La 1re date qui ferait dépasser 100 déclenche le retour de la dernière
	// date de cycle valide visitée.
	let cumulative = 0;
	let lastValidCycleDate: string | null = null;

	for (const date of allFutureDates) {
		const dateSlots = activeSlotsForDate(date);
		if (cumulative + dateSlots > 100) {
			return lastValidCycleDate ?? futureCycle[0];
		}
		cumulative += dateSlots;
		if (futureCycleSet.has(date)) {
			lastValidCycleDate = date;
		}
	}

	return null;
}
