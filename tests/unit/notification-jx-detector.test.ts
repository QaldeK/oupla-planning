import { describe, it, expect } from 'vitest';

// Mock isolé (pas de PocketBase nécessaire) qui valide la détection des
// events J-X (rappels, missings, confirmation) sur planning_occurrences.
// Les records PB sont mockés via mkRecord().
//
// Couverture :
//   - Timing : daysUntil hors {1,3,7,15}, jour même, occ passée
//   - reminder : pref activée, response absente, response present, response absent+tâche
//   - quorum_missing : present < min vs present >= min
//   - task_unassigned : volunteers < required vs volunteers >= required, tâche sans exigence
//   - confirmation_needed : toConfirm, isConfirmed, recurrenceType, onConfirmationNeeded
//   - Cas combinés (multi-types simultanés sur une occ)
//   - X = 15 (uniquement missings et confirmation non-WEEKLY)

// ============================================================================
// Module under test — dynamic import pour bénéficier de l'interoperabilité
// CommonJS (le hook exporte via `module.exports`).
// ============================================================================

const { detectJxEvents } = await import('../../pocketbase/pb_hooks/notification-jx-detector.js');

// ============================================================================
// Factory de mock pour core.Record
// ============================================================================

function mkRecord(data: Record<string, unknown>): any {
	return {
		get(field: string) {
			return data[field];
		},
		getString(field: string) {
			const v = data[field];
			if (v === null || v === undefined) return '';
			if (typeof v === 'string') return v;
			if (Array.isArray(v) || typeof v === 'object') return JSON.stringify(v);
			return String(v);
		},
		getBool(field: string) {
			return !!data[field];
		},
		getInt(field: string) {
			const v = Number(data[field]);
			return Number.isFinite(v) ? v : 0;
		},
		getStringSlice(field: string) {
			const v = data[field];
			return Array.isArray(v) ? v.map(String) : [];
		}
	};
}

// ============================================================================
// Fixtures
// ============================================================================

const NOW = new Date('2026-07-19T00:00:00Z');

function mkDate(daysFromNow: number): string {
	const d = new Date(NOW.getTime() + daysFromNow * 24 * 60 * 60 * 1000);
	return d
		.toISOString()
		.replace('T', ' ')
		.replace(/\.\d+Z$/, '.000Z');
}

function mkOcc(overrides: Record<string, unknown> = {}): any {
	return mkRecord({
		date: mkDate(3),
		isConfirmed: false,
		isCanceled: false,
		deleted: false,
		minPresentRequired: 2,
		responses: [],
		tasks: [],
		...overrides
	});
}

function mkMaster(overrides: Record<string, unknown> = {}): any {
	return mkRecord({
		toConfirm: false,
		deleted: false,
		minPresentRequired: 2,
		recurrence: JSON.stringify({ type: 'WEEKLY' }),
		...overrides
	});
}

function mkParticipant({
	reminderDays = [],
	missingDays = [],
	onConfirmationNeeded = false
}: {
	reminderDays?: Array<string | number>;
	missingDays?: Array<string | number>;
	onConfirmationNeeded?: boolean;
} = {}): any {
	return mkRecord({ reminderDays, missingDays, onConfirmationNeeded });
}

// ============================================================================
// Helper de comparaison — projection + tri stable des events détectés.
// ============================================================================

type NormalizedEvent = { type: string; reminderValue: number };

function normalize(events: any[]): NormalizedEvent[] {
	return events
		.map((e) => ({ type: e.type, reminderValue: e.reminderValue }))
		.sort((a, b) =>
			a.type === b.type ? a.reminderValue - b.reminderValue : a.type.localeCompare(b.type)
		);
}

// ============================================================================
// Cas de test — chaque section du runner original devient un `describe`.
// ============================================================================

describe('Timing', () => {
	const cases = [
		{
			name: 'daysUntil hors fenêtre (X=5) → aucun event',
			occ: mkOcc({ date: mkDate(5) }),
			master: mkMaster(),
			participants: [mkParticipant({ reminderDays: ['3', '7'], missingDays: ['3', '7'] })],
			expected: []
		},
		{
			name: 'jour même (daysUntil=0) → aucun event',
			occ: mkOcc({ date: mkDate(0) }),
			master: mkMaster(),
			participants: [mkParticipant({ reminderDays: ['1'], missingDays: ['1'] })],
			expected: []
		},
		{
			name: 'occ passée (daysUntil=-3) → aucun event',
			occ: mkOcc({ date: mkDate(-3) }),
			master: mkMaster(),
			participants: [mkParticipant({ reminderDays: ['3'], missingDays: ['3'] })],
			expected: []
		}
	];

	for (const c of cases) {
		it(c.name, () => {
			const got = normalize(detectJxEvents(c.occ, c.master, c.participants, NOW));
			expect(got).toEqual(normalize(c.expected));
		});
	}
});

describe('reminder', () => {
	const cases = [
		{
			name: 'reminder à J-3 : pref + response present → 1 event reminder',
			occ: mkOcc({ responses: [{ participantId: 'p1', response: 'present', tasks: [] }] }),
			master: mkMaster(),
			participants: [mkParticipant({ reminderDays: ['3'] })],
			expected: [{ type: 'reminder', reminderValue: 3 }]
		},
		{
			name: 'reminder à J-3 : pref + absent inscrit tâche → 1 event reminder',
			occ: mkOcc({
				responses: [{ participantId: 'p1', response: 'absent', tasks: ['t1'] }]
			}),
			master: mkMaster(),
			participants: [mkParticipant({ reminderDays: ['3'] })],
			expected: [{ type: 'reminder', reminderValue: 3 }]
		},
		{
			name: 'reminder à J-3 : pref mais aucun engagé → pas de reminder',
			occ: mkOcc({
				responses: [{ participantId: 'p1', response: 'absent', tasks: [] }]
			}),
			master: mkMaster(),
			participants: [mkParticipant({ reminderDays: ['3'] })],
			expected: []
		},
		{
			name: 'reminder à J-3 : engagé mais pas de pref → pas de reminder',
			occ: mkOcc({ responses: [{ participantId: 'p1', response: 'present', tasks: [] }] }),
			master: mkMaster(),
			participants: [mkParticipant({ reminderDays: ['1', '7'] })],
			expected: []
		},
		{
			name: 'reminder à J-15 : impossible (15 ∉ reminderDays enum)',
			occ: mkOcc({
				date: mkDate(15),
				responses: [{ participantId: 'p1', response: 'present', tasks: [] }]
			}),
			master: mkMaster(),
			participants: [mkParticipant({ reminderDays: ['1', '3', '7'] })],
			expected: []
		}
	];

	for (const c of cases) {
		it(c.name, () => {
			const got = normalize(detectJxEvents(c.occ, c.master, c.participants, NOW));
			expect(got).toEqual(normalize(c.expected));
		});
	}
});

describe('quorum_missing', () => {
	const cases = [
		{
			name: 'quorum_missing à J-3 : pref + present(1) < min(2) → 1 event',
			occ: mkOcc({
				minPresentRequired: 2,
				responses: [{ participantId: 'p1', response: 'present', tasks: [] }]
			}),
			master: mkMaster(),
			participants: [mkParticipant({ missingDays: ['3'] })],
			expected: [{ type: 'quorum_missing', reminderValue: 3 }]
		},
		{
			name: 'quorum_missing à J-3 : present >= min → pas de quorum_missing',
			occ: mkOcc({
				minPresentRequired: 1,
				responses: [{ participantId: 'p1', response: 'present', tasks: [] }]
			}),
			master: mkMaster(),
			participants: [mkParticipant({ missingDays: ['3'] })],
			expected: []
		},
		{
			name: 'quorum_missing à J-3 : min lu sur le master (occ à 0)',
			occ: mkOcc({
				minPresentRequired: 0,
				responses: [{ participantId: 'p1', response: 'present', tasks: [] }]
			}),
			master: mkMaster({ minPresentRequired: 2 }),
			participants: [mkParticipant({ missingDays: ['3'] })],
			expected: [{ type: 'quorum_missing', reminderValue: 3 }]
		}
	];

	for (const c of cases) {
		it(c.name, () => {
			const got = normalize(detectJxEvents(c.occ, c.master, c.participants, NOW));
			expect(got).toEqual(normalize(c.expected));
		});
	}
});

describe('task_unassigned', () => {
	const cases = [
		{
			// min=0 côté occ ET master pour isoler la condition task_unassigned
			// (sinon quorum_missing se déclenche en parallèle).
			name: 'task_unassigned à J-3 : pref + tâche sous-dimensionnée → 1 event',
			occ: mkOcc({
				minPresentRequired: 0,
				tasks: [{ id: 't1', requiredVolunteers: 2, type: 'beforeEvent' }],
				responses: [{ participantId: 'p1', response: 'present', tasks: ['t1'] }]
			}),
			master: mkMaster({ minPresentRequired: 0 }),
			participants: [mkParticipant({ missingDays: ['3'] })],
			expected: [{ type: 'task_unassigned', reminderValue: 3 }]
		},
		{
			name: "task_unassigned à J-3 : tâche complète → pas d'event",
			occ: mkOcc({
				minPresentRequired: 0,
				tasks: [{ id: 't1', requiredVolunteers: 1, type: 'beforeEvent' }],
				responses: [{ participantId: 'p1', response: 'present', tasks: ['t1'] }]
			}),
			master: mkMaster({ minPresentRequired: 0 }),
			participants: [mkParticipant({ missingDays: ['3'] })],
			expected: []
		},
		{
			name: 'task_unassigned à J-3 : tâche sans exigence (required=0) ignorée',
			occ: mkOcc({
				minPresentRequired: 0,
				tasks: [{ id: 't1', requiredVolunteers: 0, type: 'beforeEvent' }],
				responses: []
			}),
			master: mkMaster({ minPresentRequired: 0 }),
			participants: [mkParticipant({ missingDays: ['3'] })],
			expected: []
		}
	];

	for (const c of cases) {
		it(c.name, () => {
			const got = normalize(detectJxEvents(c.occ, c.master, c.participants, NOW));
			expect(got).toEqual(normalize(c.expected));
		});
	}
});

describe('confirmation_needed', () => {
	const cases = [
		{
			name: 'confirmation_needed à J-3 WEEKLY : toutes conditions → 1 event',
			occ: mkOcc({ isConfirmed: false }),
			master: mkMaster({ toConfirm: true, recurrence: JSON.stringify({ type: 'WEEKLY' }) }),
			participants: [mkParticipant({ onConfirmationNeeded: true })],
			expected: [{ type: 'confirmation_needed', reminderValue: 3 }]
		},
		{
			name: "confirmation_needed : occ déjà confirmée → pas d'event",
			occ: mkOcc({ isConfirmed: true }),
			master: mkMaster({ toConfirm: true }),
			participants: [mkParticipant({ onConfirmationNeeded: true })],
			expected: []
		},
		{
			name: "confirmation_needed : master.toConfirm=false → pas d'event",
			occ: mkOcc({ isConfirmed: false }),
			master: mkMaster({ toConfirm: false }),
			participants: [mkParticipant({ onConfirmationNeeded: true })],
			expected: []
		},
		{
			name: "confirmation_needed : aucun admin intéressé → pas d'event",
			occ: mkOcc({ isConfirmed: false }),
			master: mkMaster({ toConfirm: true }),
			participants: [mkParticipant({ onConfirmationNeeded: false })],
			expected: []
		},
		{
			name: 'confirmation_needed à J-15 WEEKLY : 15 ∉ CONFIRMATION_NEEDED_JX[WEEKLY]',
			occ: mkOcc({ date: mkDate(15), isConfirmed: false }),
			master: mkMaster({ toConfirm: true, recurrence: JSON.stringify({ type: 'WEEKLY' }) }),
			participants: [mkParticipant({ onConfirmationNeeded: true })],
			expected: []
		},
		{
			name: 'confirmation_needed à J-15 BIWEEKLY : 15 ∈ CONFIRMATION_NEEDED_JX[BIWEEKLY]',
			occ: mkOcc({ date: mkDate(15), isConfirmed: false }),
			master: mkMaster({ toConfirm: true, recurrence: JSON.stringify({ type: 'BIWEEKLY' }) }),
			participants: [mkParticipant({ onConfirmationNeeded: true })],
			expected: [{ type: 'confirmation_needed', reminderValue: 15 }]
		}
	];

	for (const c of cases) {
		it(c.name, () => {
			const got = normalize(detectJxEvents(c.occ, c.master, c.participants, NOW));
			expect(got).toEqual(normalize(c.expected));
		});
	}
});

describe('Cas combinés', () => {
	const cases = [
		{
			name: 'multi-types J-3 : reminder + quorum + task + confirmation',
			occ: mkOcc({
				minPresentRequired: 5,
				isConfirmed: false,
				tasks: [{ id: 't1', requiredVolunteers: 3, type: 'beforeEvent' }],
				responses: [
					{ participantId: 'p1', response: 'present', tasks: ['t1'] },
					{ participantId: 'p2', response: 'present', tasks: [] }
				]
			}),
			master: mkMaster({ toConfirm: true, recurrence: JSON.stringify({ type: 'WEEKLY' }) }),
			participants: [
				mkParticipant({ reminderDays: ['3'], missingDays: ['3'], onConfirmationNeeded: true })
			],
			expected: [
				{ type: 'reminder', reminderValue: 3 },
				{ type: 'quorum_missing', reminderValue: 3 },
				{ type: 'task_unassigned', reminderValue: 3 },
				{ type: 'confirmation_needed', reminderValue: 3 }
			]
		},
		{
			name: 'missings à J-15 WEEKLY : 2 rows (quorum + task), pas de reminder',
			occ: mkOcc({
				date: mkDate(15),
				minPresentRequired: 5,
				tasks: [{ id: 't1', requiredVolunteers: 3, type: 'beforeEvent' }],
				responses: [{ participantId: 'p1', response: 'present', tasks: ['t1'] }]
			}),
			master: mkMaster({ recurrence: JSON.stringify({ type: 'WEEKLY' }) }),
			participants: [mkParticipant({ missingDays: ['15'] })],
			expected: [
				{ type: 'quorum_missing', reminderValue: 15 },
				{ type: 'task_unassigned', reminderValue: 15 }
			]
		},
		{
			name: 'quorum mais pas de task_unassigned (même pref missingDays)',
			occ: mkOcc({
				minPresentRequired: 5,
				tasks: [{ id: 't1', requiredVolunteers: 1, type: 'beforeEvent' }],
				responses: [
					{ participantId: 'p1', response: 'present', tasks: ['t1'] },
					{ participantId: 'p2', response: 'present', tasks: [] }
				]
			}),
			master: mkMaster(),
			participants: [mkParticipant({ missingDays: ['3'] })],
			expected: [{ type: 'quorum_missing', reminderValue: 3 }]
		}
	];

	for (const c of cases) {
		it(c.name, () => {
			const got = normalize(detectJxEvents(c.occ, c.master, c.participants, NOW));
			expect(got).toEqual(normalize(c.expected));
		});
	}
});

describe('Robustesse', () => {
	const cases = [
		{
			name: 'occs sans responses/tasks (null) → pas de crash',
			occ: mkOcc({ responses: null, tasks: null, minPresentRequired: 5 }),
			master: mkMaster(),
			participants: [mkParticipant({ missingDays: ['3'] })],
			expected: [{ type: 'quorum_missing', reminderValue: 3 }]
		},
		{
			name: 'recurrence vide/malformée → fallback WEEKLY (confirmation J-3 ok)',
			occ: mkOcc({ isConfirmed: false }),
			master: mkMaster({ toConfirm: true, recurrence: '' }),
			participants: [mkParticipant({ onConfirmationNeeded: true })],
			expected: [{ type: 'confirmation_needed', reminderValue: 3 }]
		},
		{
			name: 'participants vide → aucun event même si responses présentes',
			occ: mkOcc({
				responses: [{ participantId: 'p1', response: 'present', tasks: [] }],
				minPresentRequired: 5
			}),
			master: mkMaster(),
			participants: [],
			expected: []
		}
	];

	for (const c of cases) {
		it(c.name, () => {
			const got = normalize(detectJxEvents(c.occ, c.master, c.participants, NOW));
			expect(got).toEqual(normalize(c.expected));
		});
	}
});
