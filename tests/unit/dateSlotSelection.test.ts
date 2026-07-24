/**
 * Tests unitaires de `computeDateSlotSelection` et `seedFromOccurrences` —
 * fonctions pures, pas de montage composant, pas de DOM.
 * Objectif : ~5ms par test, lisibilité maximale, un concept par test.
 */
import { describe, it, expect } from 'vitest';
import { computeDateSlotSelection, seedFromOccurrences } from '$lib/utils/dateSlotSelection';
import type { DateSlotSelectionInput, DateSlotSelectionState } from '$lib/utils/dateSlotSelection';
import type { TimeSlot } from '$lib/types/planning.types';

const SLOT: TimeSlot = { id: 's1', startTime: '14:00', endTime: '18:00' };
const SLOT2: TimeSlot = { id: 's2', startTime: '18:00', endTime: '22:00' };
const TODAY = '2026-01-01';

function makeInput(overrides: Partial<DateSlotSelectionInput> = {}): DateSlotSelectionInput {
	return {
		recurrenceType: 'WEEKLY',
		firstDate: '2026-01-07',
		lastDate: '2026-03-31',
		manualDates: [],
		timeSlots: [SLOT],
		todayStr: TODAY,
		...overrides
	};
}

function makeState(overrides: Partial<DateSlotSelectionState> = {}): DateSlotSelectionState {
	return {
		disabledSlotKeys: new Set(),
		seededOccurrences: new Map(),
		...overrides
	};
}

// =============================================
// computeDateSlotSelection
// =============================================

describe('computeDateSlotSelection', () => {
	it('produit cartésien : 12 semaines × 1 slot = 12 DateSlots', () => {
		// WEEKLY Jan 7 → Mar 31 = 12 mercredis, mono-slot (tous >= todayStr=Jan 1)
		const views = computeDateSlotSelection(makeInput(), makeState());
		expect(views.allDateSlots).toHaveLength(12);
		expect(views.occurrenceTargets).toHaveLength(12);
		expect(views.activeDateSlots).toHaveLength(12);
	});

	it('multi-slot : 12 semaines × 2 slots = 24 DateSlots', () => {
		const views = computeDateSlotSelection(makeInput({ timeSlots: [SLOT, SLOT2] }), makeState());
		expect(views.allDateSlots).toHaveLength(24);
		expect(views.activeDateSlots).toHaveLength(24);
	});

	it('filtrage désactivées : une clé disabled retire le DateSlot de occurrenceTargets', () => {
		const state = makeState({
			disabledSlotKeys: new Set(['2026-01-07|s1'])
		});
		const views = computeDateSlotSelection(makeInput(), state);
		expect(views.activeDateSlots).toHaveLength(11);
		expect(views.occurrenceTargets.find((t) => t.date === '2026-01-07')).toBeUndefined();
	});

	it('overrides seedés : les horaires du seeded remplacent ceux du slot', () => {
		const state = makeState({
			seededOccurrences: new Map([
				[
					'2026-01-07|s1',
					{ id: 'occ-1', date: '2026-01-07', startTime: '10:00', endTime: '12:00', slotId: 's1' }
				]
			])
		});
		const views = computeDateSlotSelection(makeInput(), state);
		const target = views.occurrenceTargets.find((t) => t.date === '2026-01-07');
		expect(target).toBeDefined();
		expect(target!.startTime).toBe('10:00');
		expect(target!.endTime).toBe('12:00');
		expect(target!.id).toBe('occ-1');
	});

	it('masquage dates passées : displayedDateSlots exclut les dates < todayStr', () => {
		// DAILY Jan 2 → Jan 10, todayStr = Jan 5
		// computeGeneratedDates filtre à d >= todayStr → Jan 5-10 = 6 dates
		const views = computeDateSlotSelection(
			makeInput({
				recurrenceType: 'DAILY',
				firstDate: '2026-01-02',
				lastDate: '2026-01-10',
				todayStr: '2026-01-05'
			}),
			makeState()
		);
		// allDateSlots = 6 dates futures (Jan 5-10) × 1 slot = 6
		expect(views.allDateSlots).toHaveLength(6);
		// displayedDateSlots = mêmes 6 dates (toutes >= todayStr)
		expect(views.displayedDateSlots).toHaveLength(6);
		expect(views.hiddenPastDateCount).toBe(0);
	});

	it('masquage dates passées avec manualDates hors-cycle : pastes non affichées', () => {
		// DAILY Jan 2 → Jan 10, todayStr = Jan 5
		// manualDates inclut Jan 3 (passée) → dans allDatesToDisplay mais pas dans displayed
		const views = computeDateSlotSelection(
			makeInput({
				recurrenceType: 'DAILY',
				firstDate: '2026-01-02',
				lastDate: '2026-01-10',
				manualDates: ['2026-01-03'],
				todayStr: '2026-01-05'
			}),
			makeState()
		);
		// allDateSlots = 6 futures + 1 passée (Jan 3) = 7
		expect(views.allDateSlots).toHaveLength(7);
		// displayedDateSlots = 6 futures seulement
		expect(views.displayedDateSlots).toHaveLength(6);
		expect(views.hiddenPastDateCount).toBe(1);
	});

	it('futureActiveDateSlotCount : compte les slots actifs futurs uniquement', () => {
		// DAILY Jan 2 → Jan 10, todayStr = Jan 5
		const views = computeDateSlotSelection(
			makeInput({
				recurrenceType: 'DAILY',
				firstDate: '2026-01-02',
				lastDate: '2026-01-10',
				todayStr: '2026-01-05'
			}),
			makeState({
				disabledSlotKeys: new Set(['2026-01-05|s1']) // désactive Jan 5
			})
		);
		// 6 dates futures (Jan 5-10), mais Jan 5 désactivée → 5 actifs
		expect(views.futureActiveDateSlotCount).toBe(5);
	});

	it('maxManualDatesForLimit : ⌊100/nbSlots⌋', () => {
		expect(
			computeDateSlotSelection(makeInput({ timeSlots: [SLOT] }), makeState()).maxManualDatesForLimit
		).toBe(100);
		expect(
			computeDateSlotSelection(makeInput({ timeSlots: [SLOT, SLOT2] }), makeState())
				.maxManualDatesForLimit
		).toBe(50);
		expect(
			computeDateSlotSelection(
				makeInput({ timeSlots: [SLOT, SLOT2, { id: 's3', startTime: '08:00', endTime: '12:00' }] }),
				makeState()
			).maxManualDatesForLimit
		).toBe(33);
	});

	it('maxManualDatesForLimit : 0 slots → 100 (fallback)', () => {
		expect(
			computeDateSlotSelection(makeInput({ timeSlots: [] }), makeState()).maxManualDatesForLimit
		).toBe(100);
	});

	it('CUSTOM : toutes les dates sont manuelles', () => {
		const views = computeDateSlotSelection(
			makeInput({
				recurrenceType: 'CUSTOM',
				manualDates: ['2026-01-05', '2026-01-10', '2026-01-15']
			}),
			makeState()
		);
		expect(views.allGeneratedDates).toHaveLength(0);
		expect(views.arbitraryDates).toHaveLength(0);
		expect(views.allDatesToDisplay).toEqual(['2026-01-05', '2026-01-10', '2026-01-15']);
		expect(views.allDateSlots).toHaveLength(3);
	});

	it('arbitraryDates : dates manuelles hors cycle', () => {
		// WEEKLY Jan 7, Jan 14, Jan 21, ... On ajoute Jan 8 (hors cycle)
		const views = computeDateSlotSelection(
			makeInput({ manualDates: ['2026-01-07', '2026-01-08'] }),
			makeState()
		);
		expect(views.arbitraryDates).toEqual(['2026-01-08']);
	});

	it('allDatesToDisplay : union triée du cycle et des manuelles', () => {
		// WEEKLY Jan 7 → Mar 31 = 12 dates. On ajoute Jan 8 (manuelle hors cycle).
		const views = computeDateSlotSelection(
			makeInput({
				manualDates: ['2026-01-07', '2026-01-08']
			}),
			makeState()
		);
		// 12 dates cycle + 1 manuelle = 13, triées
		expect(views.allDatesToDisplay).toHaveLength(13);
		expect(views.allDatesToDisplay[0]).toBe('2026-01-07');
		expect(views.allDatesToDisplay[1]).toBe('2026-01-08');
		expect(views.allDatesToDisplay[2]).toBe('2026-01-14');
	});

	it('activeDates : set des dates ayant au moins un slot actif', () => {
		const state = makeState({
			disabledSlotKeys: new Set(['2026-01-07|s1'])
		});
		const views = computeDateSlotSelection(makeInput(), state);
		expect(views.activeDates.has('2026-01-07')).toBe(false);
		expect(views.activeDates.has('2026-01-14')).toBe(true);
	});

	it('cycle vide (CUSTOM sans dates) → tout est vide', () => {
		const views = computeDateSlotSelection(
			makeInput({ recurrenceType: 'CUSTOM', manualDates: [] }),
			makeState()
		);
		expect(views.allDateSlots).toHaveLength(0);
		expect(views.occurrenceTargets).toHaveLength(0);
	});

	it('DAILY long cycle : produit le bon nombre de slots', () => {
		// DAILY Jan 2 → Jun 30 = 180 dates × 1 slot = 180 DateSlots
		const views = computeDateSlotSelection(
			makeInput({
				recurrenceType: 'DAILY',
				firstDate: '2026-01-02',
				lastDate: '2026-06-30'
			}),
			makeState()
		);
		expect(views.allDateSlots).toHaveLength(180);
	});

	it('MONTHLY_BY_DAY : passe monthlyByDayOccurrences au générateur', () => {
		// MONTHLY_BY_DAY Jan 7 avec [1,2,3,4,5] = tous les mercredis
		const views = computeDateSlotSelection(
			makeInput({
				recurrenceType: 'MONTHLY_BY_DAY',
				firstDate: '2026-01-07',
				lastDate: '2026-12-31',
				monthlyByDayOccurrences: [1, 2, 3, 4, 5]
			}),
			makeState()
		);
		// 52 mercredis en 2026
		expect(views.allDateSlots).toHaveLength(52);
	});
});

// =============================================
// seedFromOccurrences
// =============================================

describe('seedFromOccurrences', () => {
	it('occurrence deleted → disabledKeys', () => {
		const result = seedFromOccurrences(
			[
				{
					id: 'occ-1',
					date: '2026-01-07',
					slotId: 's1',
					startTime: '14:00',
					endTime: '18:00',
					deleted: true
				}
			],
			new Set(['2026-01-07', '2026-01-14'])
		);
		expect(result.disabledKeys.has('2026-01-07|s1')).toBe(true);
		expect(result.seeded.size).toBe(0);
	});

	it('occurrence active → seeded avec son id', () => {
		const result = seedFromOccurrences(
			[{ id: 'occ-1', date: '2026-01-07', slotId: 's1', startTime: '10:00', endTime: '12:00' }],
			new Set(['2026-01-07', '2026-01-14'])
		);
		expect(result.seeded.size).toBe(1);
		const seeded = result.seeded.get('2026-01-07|s1');
		expect(seeded).toBeDefined();
		expect(seeded!.id).toBe('occ-1');
		expect(seeded!.startTime).toBe('10:00');
		expect(seeded!.endTime).toBe('12:00');
		expect(result.disabledKeys.size).toBe(0);
	});

	it('occurrence active hors-cycle → manualDatesToAdd', () => {
		const result = seedFromOccurrences(
			[{ id: 'occ-1', date: '2026-01-08', slotId: 's1', startTime: '14:00', endTime: '18:00' }],
			new Set(['2026-01-07', '2026-01-14']) // Jan 8 n'est pas dans le cycle
		);
		expect(result.manualDatesToAdd).toEqual(['2026-01-08']);
	});

	it('occurrence active dans le cycle → pas dans manualDatesToAdd', () => {
		const result = seedFromOccurrences(
			[{ id: 'occ-1', date: '2026-01-07', slotId: 's1', startTime: '14:00', endTime: '18:00' }],
			new Set(['2026-01-07', '2026-01-14'])
		);
		expect(result.manualDatesToAdd).toHaveLength(0);
	});

	it('mix deleted + active + hors-cycle', () => {
		const result = seedFromOccurrences(
			[
				{
					id: 'occ-1',
					date: '2026-01-07',
					slotId: 's1',
					startTime: '14:00',
					endTime: '18:00',
					deleted: true
				},
				{ id: 'occ-2', date: '2026-01-14', slotId: 's1', startTime: '14:00', endTime: '18:00' },
				{ id: 'occ-3', date: '2026-01-08', slotId: 's1', startTime: '14:00', endTime: '18:00' }
			],
			new Set(['2026-01-07', '2026-01-14'])
		);
		expect(result.disabledKeys.has('2026-01-07|s1')).toBe(true);
		expect(result.seeded.size).toBe(2); // occ-2 et occ-3
		expect(result.manualDatesToAdd).toEqual(['2026-01-08']);
	});

	it('occurrences vides → résultat vide', () => {
		const result = seedFromOccurrences([], new Set(['2026-01-07']));
		expect(result.disabledKeys.size).toBe(0);
		expect(result.seeded.size).toBe(0);
		expect(result.manualDatesToAdd).toHaveLength(0);
	});

	it('normalise les dates (split espace + T)', () => {
		const result = seedFromOccurrences(
			[
				{
					id: 'occ-1',
					date: '2026-01-07 14:00',
					slotId: 's1',
					startTime: '14:00',
					endTime: '18:00'
				}
			],
			new Set(['2026-01-07'])
		);
		const seeded = result.seeded.get('2026-01-07|s1');
		expect(seeded).toBeDefined();
		expect(seeded!.date).toBe('2026-01-07');
	});

	it('occurrence sans slotId → clé avec slotId vide', () => {
		const result = seedFromOccurrences(
			[{ id: 'occ-1', date: '2026-01-07', startTime: '14:00', endTime: '18:00' }],
			new Set(['2026-01-07'])
		);
		const seeded = result.seeded.get('2026-01-07|');
		expect(seeded).toBeDefined();
		expect(seeded!.slotId).toBeUndefined();
	});
});
