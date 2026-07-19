import { describe, it, expect } from 'vitest';
import path from 'path';
import { readFileSync } from 'fs';

// Validation isolée (pas de PocketBase) du rendu des templates de notification.
// Génère les 9 maquettes de référence du brainstorm § 13.8 et compare le sujet
// + corps texte à des substrings attendus.
//
// Les records PB sont mockés via mkRecord().

// ============================================================================
// Module under test — contournement de l'interop CJS de Vite.
//
// notify-templates.js fait `require(`${__hooks}/notify-utils.js`)` au top
// level. Vite ne sait pas transformer ce require dynamique (template literal
// + package.json "type": "module" + module.exports dans notify-utils.js) et
// tente de le résoudre statiquement comme un import ESM, ce qui échoue.
//
// Solution : on lit le source, on remplace le require CJS et le module.exports
// par des références à des globales qu'on injecte, puis on charge le source
// modifié via une data URL. Vite n'intervient pas sur cette chaîne, donc pas
// de résolution statique erronée.
// ============================================================================

const HOOKS_DIR = path.resolve(__dirname, '../../', 'pocketbase/pb_hooks');

// Pré-import de notify-utils via Vite (qui gère son module.exports via son
// plugin CJS quand c'est un import statique).
const notifyUtils = await import('../../pocketbase/pb_hooks/notify-utils.js');
(globalThis as any).__notifyUtils__ = notifyUtils;

// Source de notify-templates.js avec le require CJS et le module.exports
// remplacés par des références à des globales, pour exécution sous Vite ESM.
const templatesSource = readFileSync(path.join(HOOKS_DIR, 'notify-templates.js'), 'utf-8')
	.replace(/require\(`\$\{__hooks\}\/notify-utils\.js`\)/, 'globalThis.__notifyUtils__')
	.replace(/module\.exports\s*=\s*\{/, 'globalThis.__templates_exports__ = {');

const templatesDataUrl =
	'data:text/javascript;base64,' + Buffer.from(templatesSource, 'utf-8').toString('base64');
await import(/* @vite-ignore */ templatesDataUrl);
const templates = (globalThis as any).__templates_exports__;

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
		}
	};
}

// ============================================================================
// Données de test partagées
// ============================================================================

const MASTER_BASE = {
	id: 'm1',
	title: 'Repas hebdo',
	description: 'Repas hebdomadaire du jeudi',
	participantToken: 'abc123',
	toConfirm: false,
	minPresentRequired: 5,
	recurrence: JSON.stringify({ type: 'WEEKLY', daysOfWeek: [4] })
};

const OCC_31_MARS = {
	id: 'o1',
	date: '2026-03-31',
	startTime: '19:00',
	endTime: '22:00',
	place: 'Salle des fêtes',
	description: '',
	isConfirmed: false,
	isCanceled: false,
	minPresentRequired: 5,
	responses: [{ participantId: 'u1', response: 'present' }],
	tasks: []
};

const OCC_5_AVRIL = {
	id: 'o2',
	date: '2026-04-05',
	startTime: '19:00',
	endTime: '22:00',
	place: 'Salle des fêtes',
	description: '',
	isConfirmed: false,
	isCanceled: false,
	minPresentRequired: 5,
	responses: [
		{ participantId: 'u1', response: 'present' },
		{ participantId: 'u2', response: 'present' },
		{ participantId: 'u3', response: 'maybe' }
	],
	tasks: []
};

const OCC_6_AVRIL = {
	id: 'o3',
	date: '2026-04-06',
	startTime: '19:00',
	endTime: '22:00',
	place: 'Salle des fêtes',
	description: '',
	isConfirmed: false,
	isCanceled: false,
	minPresentRequired: 5,
	responses: [{ participantId: 'u1', response: 'present' }],
	tasks: [
		{
			name: 'Rangement',
			type: 'afterEvent',
			signedUpParticipants: ['u1']
		}
	]
};

const USER_PRESENT = mkRecord({ id: 'u1', name: 'Sarah' });

function buildCtx(master: any, occs: any[]) {
	const occCache = new Map();
	for (const o of occs) occCache.set(o.id, mkRecord(o));
	return {
		occCache,
		userNamesById: new Map([
			['u1', 'Sarah'],
			['u2', 'Bob']
		]),
		master,
		baseUrl: 'https://planning.oupla.net'
	};
}

// ============================================================================
// Cas de test (alignés sur brainstorm § 13.8)
// ============================================================================

describe('notify-templates — 9 maquettes § 13.8', () => {
	const cases = [
		{
			name: 'Cas 1 — reminder simple (1 event, user présent sans tâche)',
			master: { ...MASTER_BASE },
			occs: [OCC_31_MARS],
			user: USER_PRESENT,
			events: [
				{
					type: 'reminder',
					occurrence: 'o1',
					reminderValue: 1,
					changedBy: '',
					payload: { userResponse: 'present', userTasks: [] }
				}
			],
			expectedSubjectContains: ['Rappel', 'Repas hebdo'],
			expectedBodyContains: ['mar. 31 mars', 'Salle des fêtes', 'présent·e']
		},
		{
			name: 'Cas 2 — reminder avec tâches + occ non confirmée',
			master: { ...MASTER_BASE, toConfirm: true },
			occs: [
				{
					...OCC_31_MARS,
					tasks: [
						{ name: 'Préparer salle', type: 'beforeEvent', signedUpParticipants: ['u1'] },
						{ name: 'Accueil', type: 'onEvent', signedUpParticipants: ['u1'] }
					],
					isConfirmed: false
				}
			],
			user: USER_PRESENT,
			events: [
				{
					type: 'reminder',
					occurrence: 'o1',
					reminderValue: 1,
					changedBy: '',
					payload: {
						userResponse: 'present',
						userTasks: ['Préparer salle (avant)', 'Accueil (pendant)']
					}
				}
			],
			expectedSubjectContains: ['Rappel', 'Repas hebdo'],
			expectedBodyContains: [
				'présent·e',
				'Préparer salle (avant)',
				'Accueil (pendant)',
				'Non encore confirmé'
			]
		},
		{
			name: 'Cas 3 — change (modification horaire)',
			master: { ...MASTER_BASE },
			occs: [{ ...OCC_31_MARS, startTime: '20:00' }],
			user: USER_PRESENT,
			events: [
				{
					type: 'schedule_change',
					occurrence: 'o1',
					reminderValue: 0,
					changedBy: 'u1',
					payload: { oldStartTime: '19:00', newStartTime: '20:00' }
				}
			],
			expectedSubjectContains: ['Modification', 'Repas hebdo'],
			expectedBodyContains: ['Modifié par Sarah', '19h00 → 20h00']
		},
		{
			name: 'Cas 4 — cancel (annulation)',
			master: { ...MASTER_BASE },
			occs: [{ ...OCC_31_MARS, isCanceled: true }],
			user: USER_PRESENT,
			events: [
				{
					type: 'status_canceled',
					occurrence: 'o1',
					reminderValue: 0,
					changedBy: 'u1',
					payload: {}
				}
			],
			expectedSubjectContains: ['Annulation', 'Repas hebdo'],
			expectedBodyContains: ['mar. 31 mars', 'Annulé par Sarah']
		},
		{
			name: 'Cas 5 — missings simple',
			master: { ...MASTER_BASE },
			occs: [OCC_5_AVRIL],
			user: USER_PRESENT,
			events: [
				{
					type: 'quorum_missing',
					occurrence: 'o2',
					reminderValue: 3,
					changedBy: '',
					payload: {
						presentCount: 2,
						maybeCount: 1,
						noReplyCount: 2,
						minPresentRequired: 5,
						tasksToFill: [
							{ name: 'Accueil', type: 'onEvent', signedUp: 0, required: 2 },
							{ name: 'Rangement', type: 'afterEvent', signedUp: 1, required: 3 }
						]
					}
				}
			],
			expectedSubjectContains: ['Participants manquants', 'Repas hebdo'],
			expectedBodyContains: [
				'2/5 présents requis',
				'1 peut-être',
				'2 sans-réponse',
				'Tâches à pourvoir',
				'Accueil (0/2)',
				'Rangement (1/3)'
			]
		},
		{
			name: 'Cas 6 — confirmation (admin)',
			master: { ...MASTER_BASE },
			occs: [OCC_5_AVRIL],
			user: USER_PRESENT,
			events: [
				{
					type: 'confirmation_needed',
					occurrence: 'o2',
					reminderValue: 3,
					changedBy: '',
					payload: {}
				}
			],
			expectedSubjectContains: ['À confirmer', 'Repas hebdo'],
			expectedBodyContains: ['À confirmer']
		},
		{
			name: 'Cas 7 — Multi-events même occ (admin présent + manque + à confirmer + J-3)',
			master: { ...MASTER_BASE },
			occs: [
				{
					...OCC_5_AVRIL,
					tasks: [{ name: 'Préparer salle', type: 'beforeEvent', signedUpParticipants: ['u1'] }]
				}
			],
			user: USER_PRESENT,
			events: [
				{
					type: 'confirmation_needed',
					occurrence: 'o2',
					reminderValue: 3,
					changedBy: '',
					payload: {}
				},
				{
					type: 'quorum_missing',
					occurrence: 'o2',
					reminderValue: 3,
					changedBy: '',
					payload: { presentCount: 2, maybeCount: 1, noReplyCount: 2, minPresentRequired: 5 }
				},
				{
					type: 'reminder',
					occurrence: 'o2',
					reminderValue: 3,
					changedBy: '',
					payload: {
						userResponse: 'present',
						userTasks: ['Préparer salle (avant)']
					}
				}
			],
			expectedSubjectContains: ['À confirmer', 'Repas hebdo'],
			expectedBodyContains: [
				'À confirmer',
				'2/5 présents requis',
				'présent·e',
				'Préparer salle (avant)'
			]
		},
		{
			name: 'Cas 8 — Multi-occ avec cancel/change/reminder',
			master: { ...MASTER_BASE },
			occs: [
				{ ...OCC_31_MARS, isCanceled: true },
				{ ...OCC_5_AVRIL, id: 'o2b', place: 'Gymnase' },
				{ ...OCC_6_AVRIL }
			],
			user: USER_PRESENT,
			events: [
				{
					type: 'status_canceled',
					occurrence: 'o1',
					reminderValue: 0,
					changedBy: 'u1',
					payload: {}
				},
				{
					type: 'schedule_change',
					occurrence: 'o2b',
					reminderValue: 0,
					changedBy: 'u1',
					payload: { oldPlace: 'Salle des fêtes', newPlace: 'Gymnase' }
				},
				{
					type: 'reminder',
					occurrence: 'o3',
					reminderValue: 1,
					changedBy: '',
					payload: {
						userResponse: 'present',
						userTasks: ['Rangement (après)']
					}
				}
			],
			expectedSubjectContains: ['Important', 'Repas hebdo', '3 événements'],
			expectedBodyContains: [
				'Annulé par Sarah',
				'Modifié par Sarah',
				'lieu',
				'Gymnase',
				'présent·e',
				'Rangement (après)'
			]
		},
		{
			name: 'Cas 9 — Batch edit (5+ modifs même type)',
			master: { ...MASTER_BASE },
			occs: [
				{ ...OCC_31_MARS, id: 'b1', startTime: '20:00' },
				{ ...OCC_5_AVRIL, id: 'b2', place: 'Gymnase' },
				{
					id: 'b3',
					date: '2026-04-13',
					startTime: '18:30',
					endTime: '21:30',
					place: 'Salle des fêtes',
					isCanceled: false,
					isConfirmed: false,
					minPresentRequired: 5,
					responses: [],
					tasks: []
				},
				{
					id: 'b4',
					date: '2026-04-20',
					startTime: '19:00',
					endTime: '22:00',
					place: 'Salle des fêtes',
					isCanceled: false,
					isConfirmed: false,
					minPresentRequired: 5,
					responses: [],
					tasks: []
				},
				{
					id: 'b5',
					date: '2026-04-27',
					startTime: '19:00',
					endTime: '22:00',
					place: 'Salle des fêtes',
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
					type: 'schedule_change',
					occurrence: 'b1',
					reminderValue: 0,
					changedBy: 'u1',
					payload: { oldStartTime: '19:00', newStartTime: '20:00' }
				},
				{
					type: 'schedule_change',
					occurrence: 'b2',
					reminderValue: 0,
					changedBy: 'u1',
					payload: { oldPlace: 'Salle des fêtes', newPlace: 'Gymnase' }
				},
				{
					type: 'schedule_change',
					occurrence: 'b3',
					reminderValue: 0,
					changedBy: 'u1',
					payload: { oldStartTime: '19:00', newStartTime: '18:30' }
				},
				{
					type: 'schedule_change',
					occurrence: 'b4',
					reminderValue: 0,
					changedBy: 'u1',
					payload: { oldStartTime: '19:00', newStartTime: '20:00' }
				},
				{
					type: 'schedule_change',
					occurrence: 'b5',
					reminderValue: 0,
					changedBy: 'u1',
					payload: { oldStartTime: '19:00', newStartTime: '21:00' }
				}
			],
			expectedSubjectContains: ['5 modifications', 'Repas hebdo'],
			expectedBodyContains: ['Modifié par Sarah', '+ 2 autres']
		}
	];

	for (const c of cases) {
		it(c.name, () => {
			const master = mkRecord(c.master);
			const ctx = buildCtx(master, c.occs);

			const subject = templates.buildSubject(master, c.events, ctx);
			const body = templates.buildTextEmail(master, c.events, c.user, ctx);

			for (const s of c.expectedSubjectContains) {
				expect(subject).toContain(s);
			}
			for (const s of c.expectedBodyContains) {
				expect(body).toContain(s);
			}
		});
	}
});
