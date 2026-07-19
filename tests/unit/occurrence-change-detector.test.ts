import { describe, it, expect } from 'vitest';

// Mock isolé (pas de PocketBase nécessaire) qui valide la détection des
// transitions pertinentes sur planning_occurrences. Les records PB sont mockés
// via mkRecord() avec un .original() qui renvoie un mock séparé.
//
// Couverture :
//   - Cas nominaux (cancel, delete, schedule_change, confirm)
//   - Edge cases : rien modifié, occ passée mais logique de détection inchangée,
//     transitions true→false ignorées, plusieurs champs schedule modifiés
//     (agrégation en 1 seul event), payload ne contenant QUE les champs modifiés.

// ============================================================================
// Module under test — dynamic import pour bénéficier de l'interopérabilité
// CommonJS (le hook exporte via `module.exports`).
// ============================================================================

const { detectOccurrenceChange } =
	await import('../../pocketbase/pb_hooks/occurrence-change-detector.js');

// ============================================================================
// Factory de mock pour core.Record
// ============================================================================

function mkRecord(data: Record<string, unknown>): any {
	return {
		_data: data,
		get(field: string) {
			return data[field];
		},
		getString(field: string) {
			const v = data[field];
			return v === null || v === undefined ? '' : String(v);
		},
		getBool(field: string) {
			return !!data[field];
		},
		getInt(field: string) {
			const v = Number(data[field]);
			return Number.isFinite(v) ? v : 0;
		},
		getFloat(field: string) {
			return Number(data[field]) || 0;
		},
		original() {
			return mkRecord(this._originalData);
		}
	};
}

/**
 * Construit une paire (record, original) où `record.original()` renvoie un
 * mock reflectif de l'état pré-update.
 */
function mkUpdatePair(
	originalData: Record<string, unknown>,
	updatedFields: Record<string, unknown>
): any {
	const newData = { ...originalData, ...updatedFields };
	const rec = mkRecord(newData);
	rec._originalData = originalData;
	return rec;
}

// ============================================================================
// Données de test
// ============================================================================

const BASE_OCC: Record<string, unknown> = {
	id: 'o1',
	master: 'm1',
	date: '2027-01-21 00:00:00.000Z',
	startTime: '19:00',
	endTime: '21:00',
	place: 'Salle des fêtes',
	isConfirmed: false,
	isCanceled: false,
	deleted: false,
	lastModifiedBy: 'user-1'
};

// ============================================================================
// Cas de test — chaque section du runner original devient un `describe`.
// ============================================================================

describe('Aucun changement pertinent', () => {
	const cases = [
		{
			name: 'rien modifié → null',
			rec: mkUpdatePair(BASE_OCC, {}),
			expected: null
		},
		{
			// Modifier lastModifiedBy seul ne déclenche rien (c'est un champ d'audit).
			name: 'lastModifiedBy seul → null',
			rec: mkUpdatePair(BASE_OCC, { lastModifiedBy: 'user-2' }),
			expected: null
		},
		{
			// Modifier responses seul ne déclenche rien (pas un changement notifiable
			// par ce hook ; les réponses alimentent les events missings/confirmation
			// via le cron Phase 1, pas via ce hook update).
			name: 'responses seul → null',
			rec: mkUpdatePair(BASE_OCC, { responses: '[{"p":"u1","r":"present"}]' }),
			expected: null
		}
	];

	for (const c of cases) {
		it(c.name, () => {
			const d = detectOccurrenceChange(c.rec, c.rec.original());
			expect(d).toEqual(c.expected);
		});
	}
});

describe('Transition isCanceled false→true', () => {
	const cases = [
		{
			name: 'cancel → status_canceled',
			rec: mkUpdatePair(BASE_OCC, { isCanceled: true }),
			expected: { type: 'status_canceled' }
		},
		{
			// Transition true→true (déjà canceled) : non pertinente.
			name: 'déjà canceled → null',
			rec: mkUpdatePair({ ...BASE_OCC, isCanceled: true }, {}),
			expected: null
		},
		{
			// Transition true→false (uncancel) : non pertinente pour ce pipeline.
			name: 'uncancel → null',
			rec: mkUpdatePair({ ...BASE_OCC, isCanceled: true }, { isCanceled: false }),
			expected: null
		}
	];

	for (const c of cases) {
		it(c.name, () => {
			const d = detectOccurrenceChange(c.rec, c.rec.original());
			expect(d).toEqual(c.expected);
		});
	}
});

describe('Transition deleted false→true', () => {
	const cases = [
		{
			name: 'delete → status_deleted',
			rec: mkUpdatePair(BASE_OCC, { deleted: true }),
			expected: { type: 'status_deleted' }
		},
		{
			// delete + cancel simultanés : delete prioritaire (plus fort que cancel).
			name: 'delete+cancel → status_deleted (priorité)',
			rec: mkUpdatePair(BASE_OCC, { deleted: true, isCanceled: true }),
			expected: { type: 'status_deleted' }
		}
	];

	for (const c of cases) {
		it(c.name, () => {
			const d = detectOccurrenceChange(c.rec, c.rec.original());
			expect(d).toEqual(c.expected);
		});
	}
});

describe('Schedule change', () => {
	const cases = [
		{
			// Un seul champ modifié.
			name: 'startTime modifié → schedule_change avec payload Start',
			rec: mkUpdatePair(BASE_OCC, { startTime: '20:00' }),
			expected: {
				type: 'schedule_change',
				payload: { oldStartTime: '19:00', newStartTime: '20:00' }
			}
		},
		{
			// Plusieurs champs modifiés : 1 seul event avec payload agrégeant les deltas.
			name: '3 champs schedule modifiés → 1 event avec payload agrégé',
			rec: mkUpdatePair(BASE_OCC, {
				startTime: '20:00',
				endTime: '23:00',
				place: 'Autre salle'
			}),
			expected: {
				type: 'schedule_change',
				payload: {
					oldStartTime: '19:00',
					newStartTime: '20:00',
					oldEndTime: '21:00',
					newEndTime: '23:00',
					oldPlace: 'Salle des fêtes',
					newPlace: 'Autre salle'
				}
			}
		},
		{
			// place nullable passé de '' à une valeur : détecté comme changement.
			name: 'place vide → valeur → schedule_change',
			rec: mkUpdatePair({ ...BASE_OCC, place: '' }, { place: 'Gymnase' }),
			expected: {
				type: 'schedule_change',
				payload: { oldPlace: '', newPlace: 'Gymnase' }
			}
		},
		{
			// Modification de la date (date format PB DateTime).
			name: 'date modifiée → schedule_change',
			rec: mkUpdatePair(BASE_OCC, { date: '2027-01-22 00:00:00.000Z' }),
			expected: {
				type: 'schedule_change',
				payload: {
					oldDate: '2027-01-21 00:00:00.000Z',
					newDate: '2027-01-22 00:00:00.000Z'
				}
			}
		}
	];

	for (const c of cases) {
		it(c.name, () => {
			const d = detectOccurrenceChange(c.rec, c.rec.original());
			expect(d).toEqual(c.expected);
		});
	}
});

describe('Transition isConfirmed false→true', () => {
	const cases = [
		{
			name: 'confirm → status_confirmed',
			rec: mkUpdatePair(BASE_OCC, { isConfirmed: true }),
			expected: { type: 'status_confirmed' }
		},
		{
			// confirm + schedule modifié : priorité au schedule (la confirmation coule
			// de source, l'utilisateur change surtout l'horaire pour confirmer).
			// NB : la spec du brainstorm § 11.1 indique que le cron traite la
			// confirmation via onOccurrenceChange, donc l'event schedule_change couvre
			// ce cas correctement.
			name: 'confirm+schedule → schedule_change (priorité)',
			rec: mkUpdatePair(BASE_OCC, { isConfirmed: true, startTime: '20:00' }),
			expected: {
				type: 'schedule_change',
				payload: { oldStartTime: '19:00', newStartTime: '20:00' }
			}
		}
	];

	for (const c of cases) {
		it(c.name, () => {
			const d = detectOccurrenceChange(c.rec, c.rec.original());
			expect(d).toEqual(c.expected);
		});
	}
});

describe('Edge : cancel ou delete prioritaire sur schedule', () => {
	const cases = [
		{
			name: 'cancel+schedule → status_canceled (priorité)',
			rec: mkUpdatePair(BASE_OCC, { isCanceled: true, startTime: '20:00' }),
			expected: { type: 'status_canceled' }
		},
		{
			name: 'delete+schedule → status_deleted (priorité)',
			rec: mkUpdatePair(BASE_OCC, { deleted: true, startTime: '20:00' }),
			expected: { type: 'status_deleted' }
		}
	];

	for (const c of cases) {
		it(c.name, () => {
			const d = detectOccurrenceChange(c.rec, c.rec.original());
			expect(d).toEqual(c.expected);
		});
	}
});

describe('Edge : isConfirmed true→true', () => {
	it('déjà confirmed + schedule → schedule_change', () => {
		// Déjà confirmé, modification du lieu : schedule_change, pas re-confirm.
		const rec = mkUpdatePair({ ...BASE_OCC, isConfirmed: true }, { place: 'Autre' });
		const d = detectOccurrenceChange(rec, rec.original());
		expect(d).toEqual({
			type: 'schedule_change',
			payload: { oldPlace: 'Salle des fêtes', newPlace: 'Autre' }
		});
	});
});
