/**
 * Tests unitaires de `computeMaxDateForLimit` — fonction pure qui calcule
 * la dernière date de cycle ramenant le compte de DateSlots futurs à ≤ 100.
 */
import { describe, it, expect } from 'vitest';
import { computeMaxDateForLimit } from '$lib/utils/dateSlotLimit';
import { generateRecurrenceDates } from '$lib/utils/recurrence';
import type { TimeSlot } from '$lib/types/planning.types';

const SLOT: TimeSlot = { id: 's1', startTime: '14:00', endTime: '18:00' };
const SLOT2: TimeSlot = { id: 's2', startTime: '18:00', endTime: '22:00' };
const TODAY = '2026-01-01';

/** Formate une Date JS en YYYY-MM-DD (utilitaire de test). */
function ymd(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
		d.getDate()
	).padStart(2, '0')}`;
}

/** Génère N dates au format YYYY-MM-DD à partir de `start`, espacées de `stepDays` jours. */
function datesFrom(start: string, count: number, stepDays = 7): string[] {
	const [y, m, d] = start.split('-').map(Number);
	const out: string[] = [];
	const cur = new Date(y, m - 1, d);
	for (let i = 0; i < count; i++) {
		out.push(ymd(cur));
		cur.setDate(cur.getDate() + stepDays);
	}
	return out;
}

describe('computeMaxDateForLimit', () => {
	it('retourne null si déjà sous la limite', () => {
		// WEEKLY Jan 7 → Dec 31 2026 = 52 dates, mono-slot = 52 DateSlots < 100.
		const result = computeMaxDateForLimit({
			firstDate: '2026-01-07',
			lastDate: '2026-12-31',
			recurrenceType: 'WEEKLY',
			manualDates: [],
			timeSlots: [SLOT],
			disabledSlotKeys: new Set(),
			todayStr: TODAY
		});
		expect(result).toBeNull();
	});

	it('mono-slot : tronque la borne sup à la 100e date de cycle', () => {
		// DAILY Jan 2 → Jun 30 2026 = 180 dates, mono-slot. La 100e date depuis
		// firstDate tombe sur le 11 avril 2026 (Jan 2 + 99 jours).
		const result = computeMaxDateForLimit({
			firstDate: '2026-01-02',
			lastDate: '2026-06-30',
			recurrenceType: 'DAILY',
			manualDates: [],
			timeSlots: [SLOT],
			disabledSlotKeys: new Set(),
			todayStr: TODAY
		});
		expect(result).toBe('2026-04-11');
	});

	it('multi-slot : tronque en tenant compte du nombre de slots', () => {
		// DAILY Jan 2 → Apr 30 = 119 dates × 2 slots = 238 DateSlots.
		// Budget : 100 / 2 = 50 dates. 50e date depuis firstDate = 20 fév 2026.
		const result = computeMaxDateForLimit({
			firstDate: '2026-01-02',
			lastDate: '2026-04-30',
			recurrenceType: 'DAILY',
			manualDates: [],
			timeSlots: [SLOT, SLOT2],
			disabledSlotKeys: new Set(),
			todayStr: TODAY
		});
		expect(result).toBe('2026-02-20');
	});

	it('sans manualDates : tronque au cycle pur (garde firstDate)', () => {
		// DAILY 180 dates, mono-slot. Vérifie que la 1re date du cycle (Jan 2)
		// reste dans la nouvelle borne.
		const result = computeMaxDateForLimit({
			firstDate: '2026-01-02',
			lastDate: '2026-06-30',
			recurrenceType: 'DAILY',
			manualDates: [],
			timeSlots: [SLOT],
			disabledSlotKeys: new Set(),
			todayStr: TODAY
		});
		expect(result).toBe('2026-04-11');
		// Le nouveau cycle [firstDate, result] doit contenir exactement 100 dates.
		const regenerated = generateRecurrenceDates({
			type: 'DAILY',
			firstDate: '2026-01-02',
			lastDate: result!
		});
		expect(regenerated).toHaveLength(100);
		expect(regenerated[0]).toBe('2026-01-02');
	});

	it('avec manualDates interspersées : la nouvelle borne respecte le budget', () => {
		// WEEKLY Jan 7 → Dec 31 = 52 mercredis (cycle). On ajoute 50 jeudis
		// (manualDates hors cycle, aucun ne tombe un mercredi). Total = 102.
		// Itération ascendante : 100e date = 50e jeudi (Dec 17), 101e = 51e
		// mercredi (Dec 23) qui déborde. La dernière date de cycle valide est
		// donc le 50e mercredi = Dec 16.
		const manualDates = datesFrom('2026-01-08', 50, 7); // 50 jeudis
		expect(manualDates[manualDates.length - 1]).toBe('2026-12-17');

		const result = computeMaxDateForLimit({
			firstDate: '2026-01-07',
			lastDate: '2026-12-31',
			recurrenceType: 'WEEKLY',
			manualDates,
			timeSlots: [SLOT],
			disabledSlotKeys: new Set(),
			todayStr: TODAY
		});
		expect(result).toBe('2026-12-16');
	});

	it('manualDates seules > maxDateSlots : retourne la 1re date de cycle (edge case)', () => {
		// 200 manualDates (Jan 3 → Jul 21) + 1 date de cycle (Jan 2).
		// Le cumul dépasse 100 dès la 101e date (un mardi manuel) — la 1re date
		// de cycle (Jan 2) a déjà été visitée et validée (cumul = 1), mais
		// aucune autre date de cycle n'a pu l'être → fallback sur futureCycle[0].
		const manualDates = datesFrom('2026-01-03', 200, 1);
		const result = computeMaxDateForLimit({
			firstDate: '2026-01-02',
			lastDate: '2026-01-02', // cycle réduit à 1 date
			recurrenceType: 'DAILY',
			manualDates,
			timeSlots: [SLOT],
			disabledSlotKeys: new Set(),
			todayStr: TODAY
		});
		expect(result).toBe('2026-01-02');
	});

	it('MONTHLY_BY_DAY : utilise monthlyByDayOccurrences', () => {
		// MONTHLY_BY_DAY Jan 7 (1er mercredi) avec [1,2,3,4,5] = tous les mercredis
		// de chaque mois. 52 dates en 2026 × 2 slots = 104 DateSlots > 100.
		// Budget : 50 dates (100 / 2). 50e mercredi depuis Jan 7 = Dec 16.
		const result = computeMaxDateForLimit({
			firstDate: '2026-01-07',
			lastDate: '2026-12-31',
			recurrenceType: 'MONTHLY_BY_DAY',
			monthlyByDayOccurrences: [1, 2, 3, 4, 5],
			manualDates: [],
			timeSlots: [SLOT, SLOT2],
			disabledSlotKeys: new Set(),
			todayStr: TODAY
		});
		expect(result).toBe('2026-12-16');
	});

	it('disabledSlotKeys : réduit le compte de DateSlots par date', () => {
		// DAILY Jan 2 → Jun 30 = 180 dates × 2 slots = 360 DateSlots.
		// On désactive s2 sur toutes les dates → 180 dates × 1 slot = 180 DateSlots.
		// Cutoff attendu : 100e date = Apr 11 (comme le test mono-slot).
		const disabled = new Set<string>();
		const cycle = generateRecurrenceDates({
			type: 'DAILY',
			firstDate: '2026-01-02',
			lastDate: '2026-06-30'
		});
		for (const d of cycle) disabled.add(`${d}|s2`);

		const result = computeMaxDateForLimit({
			firstDate: '2026-01-02',
			lastDate: '2026-06-30',
			recurrenceType: 'DAILY',
			manualDates: [],
			timeSlots: [SLOT, SLOT2],
			disabledSlotKeys: disabled,
			todayStr: TODAY
		});
		expect(result).toBe('2026-04-11');
	});

	it('retourne null si cycle vide (CUSTOM)', () => {
		const result = computeMaxDateForLimit({
			firstDate: '2026-01-02',
			lastDate: '2026-06-30',
			recurrenceType: 'CUSTOM',
			manualDates: [],
			timeSlots: [SLOT],
			disabledSlotKeys: new Set(),
			todayStr: TODAY
		});
		expect(result).toBeNull();
	});

	it('retourne null si dates invalides', () => {
		const result = computeMaxDateForLimit({
			firstDate: '',
			lastDate: '',
			recurrenceType: 'WEEKLY',
			manualDates: [],
			timeSlots: [SLOT],
			disabledSlotKeys: new Set(),
			todayStr: TODAY
		});
		expect(result).toBeNull();
	});

	it('retourne null si toutes les dates du cycle sont passées', () => {
		// Cycle entièrement dans le passé par rapport à todayStr.
		const result = computeMaxDateForLimit({
			firstDate: '2025-01-01',
			lastDate: '2025-12-31',
			recurrenceType: 'WEEKLY',
			manualDates: [],
			timeSlots: [SLOT],
			disabledSlotKeys: new Set(),
			todayStr: TODAY
		});
		expect(result).toBeNull();
	});
});
