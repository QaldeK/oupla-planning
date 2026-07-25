import { describe, it, expect } from 'vitest';
import path from 'path';

// Runner isolé (pas de PocketBase nécessaire) qui valide le calcul des
// destinataires d'un event selon la matrice § 3 du brainstorm + les prefs
// individuelles + le filtrage hasQuit.
//
// Couverture :
//   - Chaque type d'event avec filtres response caractéristiques
//   - Filtres prefs (email, reminderDays, missingDays, onOccurrenceChange,
//     onConfirmationNeeded)
//   - Filtre hasQuit
//   - Mapping user↔participant (CAS A userId==participantId et CAS B distincts)
//   - Sans-réponse (null response) selon le type d'event

// ============================================================================
// Module under test — dynamic import pour bénéficier de l'interoperabilité
// CommonJS (le hook exporte via `module.exports`).
// ============================================================================

const HOOKS_DIR = path.resolve(__dirname, '../../', 'pocketbase/pb_hooks');
(globalThis as any).__hooks = HOOKS_DIR;

const { computeRecipients } = await import('../../pocketbase/pb_hooks/notification-recipients.js');

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

function mkMaster({ participants = [] }: { participants?: any[] } = {}): any {
	return mkRecord({
		participantToken: 'abc123',
		participants
	});
}

function mkParticipant({
	id,
	userId,
	hasQuit = false,
	isAdmin = false
}: {
	id: string;
	userId: string | undefined;
	hasQuit?: boolean;
	isAdmin?: boolean;
}): any {
	return { id, userId, name: id, hasQuit, isAdmin };
}

function mkPlanningParticipant({
	userId,
	email = true,
	push = false,
	onOccurrenceChange = false,
	onConfirmationNeeded = false,
	reminderDays = [],
	missingDays = [],
	newCommentScope
}: {
	userId: string;
	email?: boolean;
	push?: boolean;
	onOccurrenceChange?: boolean;
	onConfirmationNeeded?: boolean;
	reminderDays?: Array<string | number>;
	missingDays?: Array<string | number>;
	newCommentScope?: string;
}): any {
	return mkRecord({
		user: userId,
		email,
		push,
		onOccurrenceChange,
		onConfirmationNeeded,
		reminderDays,
		missingDays,
		newCommentScope
	});
}

function mkOcc({ responses = [], tasks = [] }: { responses?: any[]; tasks?: any[] } = {}): any {
	return mkRecord({ responses, tasks });
}

// ============================================================================
// Helper de comparaison — projection + tri stable des destinataires calculés.
// ============================================================================

type NormalizedRecipient = {
	userId: string;
	participantId: string;
	response: unknown;
	tasks: string[];
	email: boolean;
	push: boolean;
};

function normalize(list: any[]): NormalizedRecipient[] {
	return list
		.map((r) => ({
			userId: r.userId,
			participantId: r.participantId,
			response: r.response === undefined ? null : r.response,
			tasks: Array.isArray(r.tasks) ? [...r.tasks].sort() : [],
			email: r.email ?? true,
			push: r.push ?? false
		}))
		.sort((a, b) => a.userId.localeCompare(b.userId));
}

// ============================================================================
// Cas de test — chaque section du runner original devient un `describe`.
// ============================================================================

describe('reminder', () => {
	const cases = [
		{
			name: 'reminder J-3 : user présent + reminderDays=[3] → destinataire',
			event: { type: 'reminder', reminderValue: 3 },
			master: mkMaster({ participants: [mkParticipant({ id: 'p1', userId: 'u1' })] }),
			planningParticipants: [mkPlanningParticipant({ userId: 'u1', reminderDays: ['3'] })],
			occ: mkOcc({
				responses: [{ participantId: 'p1', response: 'present', tasks: [] }]
			}),
			expected: [
				{
					userId: 'u1',
					participantId: 'p1',
					response: 'present',
					tasks: [],
					email: true,
					push: false
				}
			]
		},
		{
			name: 'reminder J-3 : user absent + inscrit tâche → destinataire',
			event: { type: 'reminder', reminderValue: 3 },
			master: mkMaster({ participants: [mkParticipant({ id: 'p1', userId: 'u1' })] }),
			planningParticipants: [mkPlanningParticipant({ userId: 'u1', reminderDays: ['3'] })],
			occ: mkOcc({
				responses: [{ participantId: 'p1', response: 'absent', tasks: ['t1'] }]
			}),
			expected: [
				{
					userId: 'u1',
					participantId: 'p1',
					response: 'absent',
					tasks: ['t1'],
					email: true,
					push: false
				}
			]
		},
		{
			name: 'reminder J-3 : user absent sans tâche → pas destinataire',
			event: { type: 'reminder', reminderValue: 3 },
			master: mkMaster({ participants: [mkParticipant({ id: 'p1', userId: 'u1' })] }),
			planningParticipants: [mkPlanningParticipant({ userId: 'u1', reminderDays: ['3'] })],
			occ: mkOcc({
				responses: [{ participantId: 'p1', response: 'absent', tasks: [] }]
			}),
			expected: []
		},
		{
			name: 'reminder J-3 : sans-réponse → pas destinataire (reminder filtre)',
			event: { type: 'reminder', reminderValue: 3 },
			master: mkMaster({ participants: [mkParticipant({ id: 'p1', userId: 'u1' })] }),
			planningParticipants: [mkPlanningParticipant({ userId: 'u1', reminderDays: ['3'] })],
			occ: mkOcc({ responses: [] }),
			expected: []
		},
		{
			name: 'reminder J-3 : reminderDays=[1,7] ne contient pas 3 → pas destinataire',
			event: { type: 'reminder', reminderValue: 3 },
			master: mkMaster({ participants: [mkParticipant({ id: 'p1', userId: 'u1' })] }),
			planningParticipants: [mkPlanningParticipant({ userId: 'u1', reminderDays: ['1', '7'] })],
			occ: mkOcc({
				responses: [{ participantId: 'p1', response: 'present', tasks: [] }]
			}),
			expected: []
		}
	];

	for (const c of cases) {
		it(c.name, () => {
			const got = normalize(computeRecipients(c.event, c.master, c.planningParticipants, c.occ));
			expect(got).toEqual(normalize(c.expected));
		});
	}
});

describe('missings (quorum_missing / task_unassigned)', () => {
	const cases = [
		{
			name: 'quorum_missing J-3 : sans-réponse + missingDays=[3] → destinataire',
			event: { type: 'quorum_missing', reminderValue: 3 },
			master: mkMaster({ participants: [mkParticipant({ id: 'p1', userId: 'u1' })] }),
			planningParticipants: [mkPlanningParticipant({ userId: 'u1', missingDays: ['3'] })],
			occ: mkOcc({ responses: [] }),
			expected: [
				{ userId: 'u1', participantId: 'p1', response: null, tasks: [], email: true, push: false }
			]
		},
		{
			name: 'quorum_missing J-3 : présent + missingDays=[3] → destinataire',
			event: { type: 'quorum_missing', reminderValue: 3 },
			master: mkMaster({ participants: [mkParticipant({ id: 'p1', userId: 'u1' })] }),
			planningParticipants: [mkPlanningParticipant({ userId: 'u1', missingDays: ['3'] })],
			occ: mkOcc({
				responses: [{ participantId: 'p1', response: 'present', tasks: [] }]
			}),
			expected: [
				{
					userId: 'u1',
					participantId: 'p1',
					response: 'present',
					tasks: [],
					email: true,
					push: false
				}
			]
		},
		{
			name: 'quorum_missing J-3 : absent → pas destinataire',
			event: { type: 'quorum_missing', reminderValue: 3 },
			master: mkMaster({ participants: [mkParticipant({ id: 'p1', userId: 'u1' })] }),
			planningParticipants: [mkPlanningParticipant({ userId: 'u1', missingDays: ['3'] })],
			occ: mkOcc({
				responses: [{ participantId: 'p1', response: 'absent', tasks: [] }]
			}),
			expected: []
		}
	];

	for (const c of cases) {
		it(c.name, () => {
			const got = normalize(computeRecipients(c.event, c.master, c.planningParticipants, c.occ));
			expect(got).toEqual(normalize(c.expected));
		});
	}
});

describe('confirmation_needed (admin only via pref)', () => {
	const cases = [
		{
			name: 'confirmation_needed J-3 : onConfirmationNeeded=true → destinataire',
			event: { type: 'confirmation_needed', reminderValue: 3 },
			master: mkMaster({ participants: [mkParticipant({ id: 'p1', userId: 'u1' })] }),
			planningParticipants: [mkPlanningParticipant({ userId: 'u1', onConfirmationNeeded: true })],
			occ: mkOcc({ responses: [] }),
			expected: [
				{ userId: 'u1', participantId: 'p1', response: null, tasks: [], email: true, push: false }
			]
		},
		{
			name: 'confirmation_needed J-3 : onConfirmationNeeded=false → pas destinataire',
			event: { type: 'confirmation_needed', reminderValue: 3 },
			master: mkMaster({ participants: [mkParticipant({ id: 'p1', userId: 'u1' })] }),
			planningParticipants: [mkPlanningParticipant({ userId: 'u1', onConfirmationNeeded: false })],
			occ: mkOcc({ responses: [] }),
			expected: []
		}
	];

	for (const c of cases) {
		it(c.name, () => {
			const got = normalize(computeRecipients(c.event, c.master, c.planningParticipants, c.occ));
			expect(got).toEqual(normalize(c.expected));
		});
	}
});

describe('schedule_change / status_canceled (onOccurrenceChange)', () => {
	const cases = [
		{
			name: 'schedule_change : présent + onOccurrenceChange=true → destinataire',
			event: { type: 'schedule_change', reminderValue: 0 },
			master: mkMaster({ participants: [mkParticipant({ id: 'p1', userId: 'u1' })] }),
			planningParticipants: [mkPlanningParticipant({ userId: 'u1', onOccurrenceChange: true })],
			occ: mkOcc({
				responses: [{ participantId: 'p1', response: 'present', tasks: [] }]
			}),
			expected: [
				{
					userId: 'u1',
					participantId: 'p1',
					response: 'present',
					tasks: [],
					email: true,
					push: false
				}
			]
		},
		{
			name: 'schedule_change : sans-réponse → pas destinataire',
			event: { type: 'schedule_change', reminderValue: 0 },
			master: mkMaster({ participants: [mkParticipant({ id: 'p1', userId: 'u1' })] }),
			planningParticipants: [mkPlanningParticipant({ userId: 'u1', onOccurrenceChange: true })],
			occ: mkOcc({ responses: [] }),
			expected: []
		},
		{
			name: 'schedule_change : absent → pas destinataire',
			event: { type: 'schedule_change', reminderValue: 0 },
			master: mkMaster({ participants: [mkParticipant({ id: 'p1', userId: 'u1' })] }),
			planningParticipants: [mkPlanningParticipant({ userId: 'u1', onOccurrenceChange: true })],
			occ: mkOcc({
				responses: [{ participantId: 'p1', response: 'absent', tasks: [] }]
			}),
			expected: []
		},
		{
			name: 'schedule_change : onOccurrenceChange=false → pas destinataire',
			event: { type: 'schedule_change', reminderValue: 0 },
			master: mkMaster({ participants: [mkParticipant({ id: 'p1', userId: 'u1' })] }),
			planningParticipants: [mkPlanningParticipant({ userId: 'u1', onOccurrenceChange: false })],
			occ: mkOcc({
				responses: [{ participantId: 'p1', response: 'present', tasks: [] }]
			}),
			expected: []
		}
	];

	for (const c of cases) {
		it(c.name, () => {
			const got = normalize(computeRecipients(c.event, c.master, c.planningParticipants, c.occ));
			expect(got).toEqual(normalize(c.expected));
		});
	}
});

describe('Filtre prefs communes', () => {
	const cases = [
		{
			name: 'email=false → destinataire avec email:false (filtre délégué)',
			event: { type: 'reminder', reminderValue: 3 },
			master: mkMaster({ participants: [mkParticipant({ id: 'p1', userId: 'u1' })] }),
			planningParticipants: [
				mkPlanningParticipant({ userId: 'u1', email: false, reminderDays: ['3'] })
			],
			occ: mkOcc({
				responses: [{ participantId: 'p1', response: 'present', tasks: [] }]
			}),
			expected: [
				{
					userId: 'u1',
					participantId: 'p1',
					response: 'present',
					tasks: [],
					email: false,
					push: false
				}
			]
		},
		{
			name: 'push=true → destinataire avec push:true (filtre délégué)',
			event: { type: 'reminder', reminderValue: 3 },
			master: mkMaster({ participants: [mkParticipant({ id: 'p1', userId: 'u1' })] }),
			planningParticipants: [
				mkPlanningParticipant({ userId: 'u1', push: true, reminderDays: ['3'] })
			],
			occ: mkOcc({
				responses: [{ participantId: 'p1', response: 'present', tasks: [] }]
			}),
			expected: [
				{
					userId: 'u1',
					participantId: 'p1',
					response: 'present',
					tasks: [],
					email: true,
					push: true
				}
			]
		}
	];

	for (const c of cases) {
		it(c.name, () => {
			const got = normalize(computeRecipients(c.event, c.master, c.planningParticipants, c.occ));
			expect(got).toEqual(normalize(c.expected));
		});
	}
});

describe('Filtre hasQuit', () => {
	const cases = [
		{
			name: 'hasQuit=true → pas destinataire',
			event: { type: 'reminder', reminderValue: 3 },
			master: mkMaster({
				participants: [mkParticipant({ id: 'p1', userId: 'u1', hasQuit: true })]
			}),
			planningParticipants: [mkPlanningParticipant({ userId: 'u1', reminderDays: ['3'] })],
			occ: mkOcc({
				responses: [{ participantId: 'p1', response: 'present', tasks: [] }]
			}),
			expected: []
		}
	];

	for (const c of cases) {
		it(c.name, () => {
			const got = normalize(computeRecipients(c.event, c.master, c.planningParticipants, c.occ));
			expect(got).toEqual(normalize(c.expected));
		});
	}
});

describe('Guest pur (pas de userId)', () => {
	const cases = [
		{
			name: 'guest pur (userId undefined) → pas destinataire email',
			event: { type: 'reminder', reminderValue: 3 },
			master: mkMaster({
				participants: [mkParticipant({ id: 'p1', userId: undefined })]
			}),
			planningParticipants: [mkPlanningParticipant({ userId: 'u1', reminderDays: ['3'] })],
			occ: mkOcc({
				responses: [{ participantId: 'p1', response: 'present', tasks: [] }]
			}),
			expected: []
		}
	];

	for (const c of cases) {
		it(c.name, () => {
			const got = normalize(computeRecipients(c.event, c.master, c.planningParticipants, c.occ));
			expect(got).toEqual(normalize(c.expected));
		});
	}
});

describe('Mapping CAS B : userId ≠ participantId', () => {
	const cases = [
		{
			name: 'CAS B (guest revendiqué) : userId≠participantId, mapping OK',
			event: { type: 'reminder', reminderValue: 3 },
			master: mkMaster({
				participants: [
					// guest revendiqué : id (participantId) = UUID guest, userId = user PB
					mkParticipant({ id: 'guest-uuid-123', userId: 'u1' })
				]
			}),
			planningParticipants: [mkPlanningParticipant({ userId: 'u1', reminderDays: ['3'] })],
			occ: mkOcc({
				responses: [{ participantId: 'guest-uuid-123', response: 'present', tasks: ['t1'] }]
			}),
			expected: [
				{
					userId: 'u1',
					participantId: 'guest-uuid-123',
					response: 'present',
					tasks: ['t1'],
					email: true,
					push: false
				}
			]
		}
	];

	for (const c of cases) {
		it(c.name, () => {
			const got = normalize(computeRecipients(c.event, c.master, c.planningParticipants, c.occ));
			expect(got).toEqual(normalize(c.expected));
		});
	}
});

describe('Multi-destinataires', () => {
	const cases = [
		{
			name: 'multi-destinataires : 2 users matching, 1 exclu',
			event: { type: 'reminder', reminderValue: 3 },
			master: mkMaster({
				participants: [
					mkParticipant({ id: 'p1', userId: 'u1' }),
					mkParticipant({ id: 'p2', userId: 'u2' }),
					mkParticipant({ id: 'p3', userId: 'u3' })
				]
			}),
			planningParticipants: [
				mkPlanningParticipant({ userId: 'u1', reminderDays: ['3'] }),
				mkPlanningParticipant({ userId: 'u2', reminderDays: ['3'] }),
				// u3 n'a pas reminderDays=[3]
				mkPlanningParticipant({ userId: 'u3', reminderDays: ['1', '7'] })
			],
			occ: mkOcc({
				responses: [
					{ participantId: 'p1', response: 'present', tasks: [] },
					{ participantId: 'p2', response: 'present', tasks: ['t1'] },
					{ participantId: 'p3', response: 'present', tasks: [] }
				]
			}),
			expected: [
				{
					userId: 'u1',
					participantId: 'p1',
					response: 'present',
					tasks: [],
					email: true,
					push: false
				},
				{
					userId: 'u2',
					participantId: 'p2',
					response: 'present',
					tasks: ['t1'],
					email: true,
					push: false
				}
			]
		}
	];

	for (const c of cases) {
		it(c.name, () => {
			const got = normalize(computeRecipients(c.event, c.master, c.planningParticipants, c.occ));
			expect(got).toEqual(normalize(c.expected));
		});
	}
});

describe('new_comment (newCommentScope dynamic)', () => {
	const newCommentEvent = { type: 'new_comment', reminderValue: 0 };

	const cases = [
		{
			name: "newCommentScope 'off' → exclu",
			scope: 'off',
			responses: [{ participantId: 'p1', response: 'present', tasks: [] }],
			excludeUserId: undefined,
			expected: []
		},
		{
			name: "newCommentScope null → traité comme 'off' (exclu)",
			scope: undefined,
			responses: [{ participantId: 'p1', response: 'present', tasks: [] }],
			excludeUserId: undefined,
			expected: []
		},
		{
			name: "'concerned' + response present → inclus",
			scope: 'concerned',
			responses: [{ participantId: 'p1', response: 'present', tasks: [] }],
			excludeUserId: undefined,
			expected: [
				{
					userId: 'u1',
					participantId: 'p1',
					response: 'present',
					tasks: [],
					email: true,
					push: false
				}
			]
		},
		{
			name: "'concerned' + response absent sans tâche → exclu",
			scope: 'concerned',
			responses: [{ participantId: 'p1', response: 'absent', tasks: [] }],
			excludeUserId: undefined,
			expected: []
		},
		{
			name: "'concerned' + sans réponse (null) + inscrit tâche → inclus",
			scope: 'concerned',
			responses: [{ participantId: 'p1', tasks: ['t1'] }],
			excludeUserId: undefined,
			expected: [
				{
					userId: 'u1',
					participantId: 'p1',
					response: null,
					tasks: ['t1'],
					email: true,
					push: false
				}
			]
		},
		{
			name: "'concerned' + sans-réponse sans tâche → exclu",
			scope: 'concerned',
			responses: [],
			excludeUserId: undefined,
			expected: []
		},
		{
			name: "'all' + response absent → inclus (pas de filtre response)",
			scope: 'all',
			responses: [{ participantId: 'p1', response: 'absent', tasks: [] }],
			excludeUserId: undefined,
			expected: [
				{
					userId: 'u1',
					participantId: 'p1',
					response: 'absent',
					tasks: [],
					email: true,
					push: false
				}
			]
		}
	];

	for (const c of cases) {
		it(c.name, () => {
			const master = mkMaster({ participants: [mkParticipant({ id: 'p1', userId: 'u1' })] });
			const planningParticipants = [
				mkPlanningParticipant({ userId: 'u1', newCommentScope: c.scope })
			];
			const occ = mkOcc({ responses: c.responses });
			const got = normalize(
				computeRecipients(newCommentEvent, master, planningParticipants, occ, c.excludeUserId)
			);
			expect(got).toEqual(normalize(c.expected as any));
		});
	}

	it('excludeUserId exclut le participant correspondant (auteur du message)', () => {
		const master = mkMaster({
			participants: [
				mkParticipant({ id: 'p1', userId: 'author' }),
				mkParticipant({ id: 'p2', userId: 'other' })
			]
		});
		const planningParticipants = [
			mkPlanningParticipant({ userId: 'author', newCommentScope: 'all' }),
			mkPlanningParticipant({ userId: 'other', newCommentScope: 'all' })
		];
		const occ = mkOcc({
			responses: [
				{ participantId: 'p1', response: 'present', tasks: [] },
				{ participantId: 'p2', response: 'present', tasks: [] }
			]
		});

		const got = normalize(
			computeRecipients(newCommentEvent, master, planningParticipants, occ, 'author')
		);
		expect(got).toEqual(
			normalize([
				{
					userId: 'other',
					participantId: 'p2',
					response: 'present',
					tasks: [],
					email: true,
					push: false
				}
			])
		);
	});
});

describe('Type inconnu', () => {
	const cases = [
		{
			name: 'type inconnu → pas de destinataire',
			event: { type: 'unknown_type', reminderValue: 0 },
			master: mkMaster({ participants: [mkParticipant({ id: 'p1', userId: 'u1' })] }),
			planningParticipants: [mkPlanningParticipant({ userId: 'u1' })],
			occ: mkOcc({ responses: [] }),
			expected: []
		}
	];

	for (const c of cases) {
		it(c.name, () => {
			const got = normalize(computeRecipients(c.event, c.master, c.planningParticipants, c.occ));
			expect(got).toEqual(normalize(c.expected));
		});
	}
});
