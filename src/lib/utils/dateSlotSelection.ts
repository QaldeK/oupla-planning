/**
 * Moteur pur de sélection de DateSlots — extrait de PlanningForm.
 *
 * Fonctions pures, pas de runes Svelte, pas d'état interne.
 * Le composant appelle `computeDateSlotSelection` avec ses bindings et reçoit
 * toutes les vues dérivées dans un objet plat. Les ~12 étapes internes vivent
 * en helpers privés non exportés.
 */
import { generateRecurrenceDates } from './recurrence';
import { formatSlotKey } from './slots';
import type { DateSlot, OccurrenceTarget, RecurrenceType, TimeSlot } from '$lib/types/planning.types';

// =============================================
// Types d'entrée / sortie
// =============================================

/** Entrée du moteur — état du formulaire (figé au moment de l'appel). */
export interface DateSlotSelectionInput {
	recurrenceType: RecurrenceType;
	firstDate: string;
	lastDate: string;
	monthlyByDayOccurrences?: number[];
	manualDates: string[];
	timeSlots: TimeSlot[];
	todayStr: string; // YYYY-MM-DD, figé par le composant
}

/** État de sélection — converti en types natifs (Set/Map) aux frontières d'appel. */
export interface DateSlotSelectionState {
	disabledSlotKeys: Set<string>;
	seededOccurrences: Map<string, OccurrenceTarget>;
}

/** Vues dérivées retournées par le moteur. */
export interface DateSlotSelectionViews {
	allGeneratedDates: string[];
	arbitraryDates: string[];
	allDatesToDisplay: string[];
	allDateSlots: DateSlot[];
	occurrenceTargets: OccurrenceTarget[];
	activeDateSlots: DateSlot[];
	activeDates: Set<string>;
	displayedDateSlots: DateSlot[];
	hiddenPastDateCount: number;
	futureActiveDateSlotCount: number;
	maxManualDatesForLimit: number;
}

/** Résultat du seeding édition (occurrences existantes → état de sélection initial). */
export interface SeedingResult {
	disabledKeys: Set<string>;
	seeded: Map<string, OccurrenceTarget>;
	manualDatesToAdd: string[];
}

// =============================================
// Helpers privés
// =============================================

function compareDateSlots(a: DateSlot, b: DateSlot): number {
	return a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime);
}

function computeGeneratedDates(
	recurrenceType: RecurrenceType,
	firstDate: string,
	lastDate: string,
	monthlyByDayOccurrences: number[] | undefined,
	todayStr: string
): string[] {
	if (recurrenceType === 'CUSTOM') return [];
	if (!firstDate || !lastDate || !recurrenceType) return [];

	const generated = generateRecurrenceDates({
		type: recurrenceType,
		firstDate,
		lastDate,
		monthlyByDayOccurrences:
			recurrenceType === 'MONTHLY_BY_DAY' ? monthlyByDayOccurrences : undefined
	});

	// On ne retient que les dates futures (inutiles au rendu), sans tronquer à 100 :
	// l'alerte UI et le blocage submit appliquent la limite sur les DateSlots futurs,
	// pas sur les dates nues. Tronquer ici rendrait la génération non pure et masquerait
	// silencieusement un cycle qui déborde (ex : DAILY sur 4 mois ~120 dates).
	return generated.filter((d) => d >= todayStr);
}

function computeArbitraryDates(
	recurrenceType: RecurrenceType,
	allGeneratedDates: string[],
	manualDates: string[]
): string[] {
	if (recurrenceType === 'CUSTOM') return [];
	const generatedSet = new Set(allGeneratedDates);
	return manualDates.filter((d) => !generatedSet.has(d));
}

function computeDatesToDisplay(
	recurrenceType: RecurrenceType,
	allGeneratedDates: string[],
	manualDates: string[]
): string[] {
	if (recurrenceType === 'CUSTOM') {
		return manualDates;
	}
	return [...new Set([...allGeneratedDates, ...manualDates])].sort();
}

function computeAllDateSlots(allDatesToDisplay: string[], timeSlots: TimeSlot[]): DateSlot[] {
	const result: DateSlot[] = [];
	for (const date of allDatesToDisplay) {
		for (const slot of timeSlots) {
			result.push({
				date,
				startTime: slot.startTime,
				endTime: slot.endTime,
				slotId: slot.id
			});
		}
	}
	return result.sort(compareDateSlots);
}

function computeOccurrenceTargets(
	allDateSlots: DateSlot[],
	disabledSlotKeys: Set<string>,
	seededOccurrences: Map<string, OccurrenceTarget>
): OccurrenceTarget[] {
	const result: OccurrenceTarget[] = [];
	for (const ds of allDateSlots) {
		const key = formatSlotKey(ds.date, ds.slotId);
		if (disabledSlotKeys.has(key)) continue;
		const seeded = seededOccurrences.get(key);
		result.push(
			seeded ?? {
				date: ds.date,
				startTime: ds.startTime,
				endTime: ds.endTime,
				slotId: ds.slotId
			}
		);
	}
	return result;
}

function computeActiveDateSlots(occurrenceTargets: OccurrenceTarget[]): DateSlot[] {
	return occurrenceTargets
		.map((t) => ({
			date: t.date,
			startTime: t.startTime,
			endTime: t.endTime,
			slotId: t.slotId
		}))
		.sort(compareDateSlots);
}

function computeActiveDates(activeDateSlots: DateSlot[]): Set<string> {
	return new Set(activeDateSlots.map((ds) => ds.date));
}

function computeDisplayedDateSlots(allDateSlots: DateSlot[], todayStr: string): DateSlot[] {
	return allDateSlots.filter((ds) => ds.date >= todayStr);
}

function computeFutureActiveCount(activeDateSlots: DateSlot[], todayStr: string): number {
	return activeDateSlots.filter((ds) => ds.date >= todayStr).length;
}

// =============================================
// Fonctions exportées
// =============================================

/**
 * Calcule toutes les vues dérivées de la sélection DateSlot.
 * Fat function : une seule entrée, un seul appel, toutes les vues.
 * Les ~12 étapes internes sont des helpers privés (seams internes au module).
 */
export function computeDateSlotSelection(
	input: DateSlotSelectionInput,
	state: DateSlotSelectionState
): DateSlotSelectionViews {
	const {
		recurrenceType,
		firstDate,
		lastDate,
		monthlyByDayOccurrences,
		manualDates,
		timeSlots,
		todayStr
	} = input;
	const { disabledSlotKeys, seededOccurrences } = state;

	const allGeneratedDates = computeGeneratedDates(
		recurrenceType,
		firstDate,
		lastDate,
		monthlyByDayOccurrences,
		todayStr
	);

	const arbitraryDates = computeArbitraryDates(recurrenceType, allGeneratedDates, manualDates);

	const allDatesToDisplay = computeDatesToDisplay(recurrenceType, allGeneratedDates, manualDates);

	const allDateSlots = computeAllDateSlots(allDatesToDisplay, timeSlots);

	const occurrenceTargets = computeOccurrenceTargets(
		allDateSlots,
		disabledSlotKeys,
		seededOccurrences
	);

	const activeDateSlots = computeActiveDateSlots(occurrenceTargets);

	const activeDates = computeActiveDates(activeDateSlots);

	const displayedDateSlots = computeDisplayedDateSlots(allDateSlots, todayStr);

	const hiddenPastDateCount = allDateSlots.length - displayedDateSlots.length;

	const futureActiveDateSlotCount = computeFutureActiveCount(activeDateSlots, todayStr);

	const maxManualDatesForLimit =
		timeSlots.length === 0 ? 100 : Math.max(1, Math.floor(100 / timeSlots.length));

	return {
		allGeneratedDates,
		arbitraryDates,
		allDatesToDisplay,
		allDateSlots,
		occurrenceTargets,
		activeDateSlots,
		activeDates,
		displayedDateSlots,
		hiddenPastDateCount,
		futureActiveDateSlotCount,
		maxManualDatesForLimit
	};
}

/**
 * Transforme les occurrences existantes d'un master en édition en l'état de sélection
 * initial (clés désactivées, overrides seedés, dates hors-cycle à préserver).
 * Fonction pure : le composant applique le résultat aux SvelteSet/SvelteMap.
 */
export function seedFromOccurrences(
	occurrences: Array<{
		date: string;
		slotId?: string;
		deleted?: boolean;
		id: string;
		startTime: string;
		endTime: string;
	}>,
	generatedDates: Set<string>
): SeedingResult {
	const disabledKeys = new Set<string>();
	const seeded = new Map<string, OccurrenceTarget>();
	const manualAdded = new Set<string>();

	for (const occ of occurrences) {
		const d = occ.date.split(' ')[0].split('T')[0];
		const key = formatSlotKey(d, occ.slotId);
		if (occ.deleted === true) {
			disabledKeys.add(key);
		} else {
			seeded.set(key, {
				id: occ.id,
				date: d,
				startTime: occ.startTime,
				endTime: occ.endTime,
				slotId: occ.slotId
			});
			if (!generatedDates.has(d)) manualAdded.add(d);
		}
	}

	return {
		disabledKeys,
		seeded,
		manualDatesToAdd: [...manualAdded]
	};
}
