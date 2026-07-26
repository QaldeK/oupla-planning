// Données de test partagées pour notify-templates.
//
// Source de vérité des 9 maquettes du brainstorm § 13.8, utilisée par :
//   - notify-templates.test.ts (assertions)
//   - notify-templates.snapshot.ts (baseline HTML visuelle)
//
// Le mock mkRecord() imite core.Record PocketBase (getString/getBool/getInt).
// Si vous modifiez ces cas, regénérez le snapshot :
//   bun run tests/unit/notify-templates.snapshot.ts

export interface MockRecord {
	_data: Record<string, unknown>;
	get(field: string): unknown;
	getString(field: string): string;
	getBool(field: string): boolean;
	getInt(field: string): number;
	getFloat(field: string): number;
}

/** Mock minimal de core.Record (subset utilisé par notify-templates). */
export function mkRecord(data: Record<string, unknown>): MockRecord {
	return {
		_data: data,
		get(field: string) {
			return data[field];
		},
		getString(field: string) {
			const v = data[field];
			return v === null || v === undefined ? "" : String(v);
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
		}
	};
}

// ============================================================================
// Données de base partagées
// ============================================================================

export const MASTER_BASE = {
	id: "m1",
	title: "Repas hebdo",
	description: "Repas hebdomadaire du jeudi",
	participantToken: "abc123",
	toConfirm: false,
	minPresentRequired: 5,
	recurrence: JSON.stringify({ type: "WEEKLY", daysOfWeek: [4] })
};

export const OCC_31_MARS = {
	id: "o1",
	date: "2026-03-31",
	startTime: "19:00",
	endTime: "22:00",
	place: "Salle des fêtes",
	description: "",
	isConfirmed: false,
	isCanceled: false,
	minPresentRequired: 5,
	responses: [{ participantId: "u1", response: "present" }],
	tasks: []
};

export const OCC_5_AVRIL = {
	id: "o2",
	date: "2026-04-05",
	startTime: "19:00",
	endTime: "22:00",
	place: "Salle des fêtes",
	description: "",
	isConfirmed: false,
	isCanceled: false,
	minPresentRequired: 5,
	responses: [
		{ participantId: "u1", response: "present" },
		{ participantId: "u2", response: "present" },
		{ participantId: "u3", response: "maybe" }
	],
	tasks: []
};

export const OCC_6_AVRIL = {
	id: "o3",
	date: "2026-04-06",
	startTime: "19:00",
	endTime: "22:00",
	place: "Salle des fêtes",
	description: "",
	isConfirmed: false,
	isCanceled: false,
	minPresentRequired: 5,
	responses: [{ participantId: "u1", response: "present" }],
	tasks: [
		{
			name: "Rangement",
			type: "afterEvent",
			signedUpParticipants: ["u1"]
		}
	]
};

export const USER_PRESENT = mkRecord({ id: "u1", name: "Sarah" });

export function buildCtx(master: any, occs: any[]) {
	const occCache = new Map();
	for (const o of occs) occCache.set(o.id, mkRecord(o));
	return {
		occCache,
		userNamesById: new Map([
			["u1", "Sarah"],
			["u2", "Bob"]
		]),
		master,
		baseUrl: "https://planning.oupla.net"
	};
}

// ============================================================================
// Les 9 cas (brainstorm § 13.8)
// ============================================================================

export interface TestCase {
	name: string;
	master: Record<string, unknown>;
	occs: Record<string, unknown>[];
	user: MockRecord;
	events: any[];
	/** Substrings attendus dans le sujet (test uniquement). */
	expectedSubjectContains?: string[];
	/** Substrings attendus dans le corps texte (test uniquement). */
	expectedBodyContains?: string[];
}

export const CASES: TestCase[] = [
	{
		name: "Cas 1 — reminder simple (1 event, user présent sans tâche)",
		master: { ...MASTER_BASE },
		occs: [OCC_31_MARS],
		user: USER_PRESENT,
		events: [
			{
				type: "reminder",
				occurrence: "o1",
				reminderValue: 1,
				changedBy: "",
				payload: { userResponse: "present", userTasks: [] }
			}
		]
	},
	{
		name: "Cas 2 — reminder avec tâches + occ non confirmée",
		master: { ...MASTER_BASE, toConfirm: true },
		occs: [
			{
				...OCC_31_MARS,
				tasks: [
					{ name: "Préparer salle", type: "beforeEvent", signedUpParticipants: ["u1"] },
					{ name: "Accueil", type: "onEvent", signedUpParticipants: ["u1"] }
				],
				isConfirmed: false
			}
		],
		user: USER_PRESENT,
		events: [
			{
				type: "reminder",
				occurrence: "o1",
				reminderValue: 1,
				changedBy: "",
				payload: {
					userResponse: "present",
					userTasks: ["Préparer salle (avant)", "Accueil (pendant)"]
				}
			}
		]
	},
	{
		name: "Cas 3 — change (modification horaire)",
		master: { ...MASTER_BASE },
		occs: [{ ...OCC_31_MARS, startTime: "20:00" }],
		user: USER_PRESENT,
		events: [
			{
				type: "schedule_change",
				occurrence: "o1",
				reminderValue: 0,
				changedBy: "u1",
				payload: { oldStartTime: "19:00", newStartTime: "20:00" }
			}
		]
	},
	{
		name: "Cas 4 — cancel (annulation)",
		master: { ...MASTER_BASE },
		occs: [{ ...OCC_31_MARS, isCanceled: true }],
		user: USER_PRESENT,
		events: [
			{
				type: "status_canceled",
				occurrence: "o1",
				reminderValue: 0,
				changedBy: "u1",
				payload: {}
			}
		]
	},
	{
		name: "Cas 5 — missings simple",
		master: { ...MASTER_BASE },
		occs: [OCC_5_AVRIL],
		user: USER_PRESENT,
		events: [
			{
				type: "quorum_missing",
				occurrence: "o2",
				reminderValue: 3,
				changedBy: "",
				payload: {
					presentCount: 2,
					ifNeededCount: 1,
					maybeCount: 1,
					minPresentRequired: 5,
					tasksToFill: [
						{ name: "Accueil", type: "onEvent", signedUp: 0, required: 2 },
						{ name: "Rangement", type: "afterEvent", signedUp: 1, required: 3 }
					]
				}
			}
		]
	},
	{
		name: "Cas 6 — confirmation (admin)",
		master: { ...MASTER_BASE },
		occs: [OCC_5_AVRIL],
		user: USER_PRESENT,
		events: [
			{
				type: "confirmation_needed",
				occurrence: "o2",
				reminderValue: 3,
				changedBy: "",
				payload: {}
			}
		]
	},
	{
		name: "Cas 7 — Multi-events même occ (admin présent + manque + à confirmer + J-3)",
		master: { ...MASTER_BASE },
		occs: [
			{
				...OCC_5_AVRIL,
				tasks: [{ name: "Préparer salle", type: "beforeEvent", signedUpParticipants: ["u1"] }]
			}
		],
		user: USER_PRESENT,
		events: [
			{
				type: "confirmation_needed",
				occurrence: "o2",
				reminderValue: 3,
				changedBy: "",
				payload: {}
			},
			{
				type: "quorum_missing",
				occurrence: "o2",
				reminderValue: 3,
				changedBy: "",
				payload: { presentCount: 2, ifNeededCount: 0, maybeCount: 1, minPresentRequired: 5 }
			},
			{
				type: "reminder",
				occurrence: "o2",
				reminderValue: 3,
				changedBy: "",
				payload: {
					userResponse: "present",
					userTasks: ["Préparer salle (avant)"]
				}
			}
		]
	},
	{
		name: "Cas 8 — Multi-occ avec cancel/change/reminder",
		master: { ...MASTER_BASE },
		occs: [
			{ ...OCC_31_MARS, isCanceled: true },
			{ ...OCC_5_AVRIL, id: "o2b", place: "Gymnase" },
			{ ...OCC_6_AVRIL }
		],
		user: USER_PRESENT,
		events: [
			{
				type: "status_canceled",
				occurrence: "o1",
				reminderValue: 0,
				changedBy: "u1",
				payload: {}
			},
			{
				type: "schedule_change",
				occurrence: "o2b",
				reminderValue: 0,
				changedBy: "u1",
				payload: { oldPlace: "Salle des fêtes", newPlace: "Gymnase" }
			},
			{
				type: "reminder",
				occurrence: "o3",
				reminderValue: 1,
				changedBy: "",
				payload: {
					userResponse: "present",
					userTasks: ["Rangement (après)"]
				}
			}
		]
	},
	{
		name: "Cas 9 — Batch edit (5+ modifs même type)",
		master: { ...MASTER_BASE },
		occs: [
			{ ...OCC_31_MARS, id: "b1", startTime: "20:00" },
			{ ...OCC_5_AVRIL, id: "b2", place: "Gymnase" },
			{
				id: "b3",
				date: "2026-04-13",
				startTime: "18:30",
				endTime: "21:30",
				place: "Salle des fêtes",
				isCanceled: false,
				isConfirmed: false,
				minPresentRequired: 5,
				responses: [],
				tasks: []
			},
			{
				id: "b4",
				date: "2026-04-20",
				startTime: "19:00",
				endTime: "22:00",
				place: "Salle des fêtes",
				isCanceled: false,
				isConfirmed: false,
				minPresentRequired: 5,
				responses: [],
				tasks: []
			},
			{
				id: "b5",
				date: "2026-04-27",
				startTime: "19:00",
				endTime: "22:00",
				place: "Salle des fêtes",
				isCanceled: false,
				isConfirmed: false,
				minPresentRequired: 5,
				responses: [],
				tasks: []
			}
		],
		user: USER_PRESENT,
		events: [
			{
				type: "schedule_change",
				occurrence: "b1",
				reminderValue: 0,
				changedBy: "u1",
				payload: { oldStartTime: "19:00", newStartTime: "20:00" }
			},
			{
				type: "schedule_change",
				occurrence: "b2",
				reminderValue: 0,
				changedBy: "u1",
				payload: { oldPlace: "Salle des fêtes", newPlace: "Gymnase" }
			},
			{
				type: "schedule_change",
				occurrence: "b3",
				reminderValue: 0,
				changedBy: "u1",
				payload: { oldStartTime: "19:00", newStartTime: "18:30" }
			},
			{
				type: "schedule_change",
				occurrence: "b4",
				reminderValue: 0,
				changedBy: "u1",
				payload: { oldStartTime: "19:00", newStartTime: "20:00" }
			},
			{
				type: "schedule_change",
				occurrence: "b5",
				reminderValue: 0,
				changedBy: "u1",
				payload: { oldStartTime: "19:00", newStartTime: "21:00" }
			}
		]
	}
];
