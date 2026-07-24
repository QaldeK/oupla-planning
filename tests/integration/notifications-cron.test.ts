/**
 * Tests d'intégration — Cron notifications-daily (Phase 1 + Phase 2 + push).
 *
 * Périmètre : valider end-to-end le cron `cron-notifications.pb.js` :
 *   - Phase 1 : insertion des events J-X (reminder, missings, confirmation)
 *   - Phase 2 : envoi agrégé (1 email par user/master) + marquage processedAt
 *   - Circuit breaker SMTP (3 échecs consécutifs → break)
 *   - Déduplication (occ déjà traitée → 0 nouvel event)
 *   - Push J-X pour users avec push=true
 *
 * Déclenchement du cron : `pb.crons.run('notifications-daily')` (API superuser).
 *
 * Note sur le SMTP : en dev, le SMTP configuré (`smtp.oupla.net:587`) est
 * injoignable depuis le réseau de test → les envois échouent naturellement,
 * ce qui permet de valider le circuit breaker sans mock supplémentaire.
 *
 * Prérequis :
 *   - PocketBase démarré sur http://127.0.0.1:8090
 *   - Admin de test créé (test@example.com / testpassword)
 *   - SMTP dev injoignable (comportement par défaut)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import PocketBase from 'pocketbase';
import {
	authenticateAdmin,
	dateInDays,
	clearTrackedIds,
	cleanupTrackedRecords,
	trackIds
} from './seed';
import type { PlanningMaster, PlanningOccurrence, Participant } from '$lib/types/planning.types';
import type { NotificationEventsResponse } from '$lib/types/pocketbase-types';

const PARTICIPANT_ID = 'p-test-participant-0001';

/**
 * Déclenche le cron notifications-daily via l'API superuser et attend
 * un court délai pour que les effets de bord DB soient visibles.
 */
async function runNotificationsCron(pb: PocketBase): Promise<void> {
	await pb.crons.run('notifications-daily');
	// Laisser au runtime PB le temps de committer les writes du cron.
	await new Promise((resolve) => setTimeout(resolve, 500));
}

/**
 * Helper de seed pour un scénario cron complet :
 *   - master avec 1 participant authentifié dans `participants[]`
 *   - user en collection `users`
 *   - participant pref dans `planning_participants` (email/push/reminderDays)
 *   - occurrence à J+X avec responses[], tasks[]
 *
 * Le `participantId` est partagé entre `master.participants[].id`,
 * `occ.responses[].participantId` et la pref n'a pas besoin de le connaître
 * (elle match sur `user` uniquement).
 */
async function seedCronScenario(
	pb: PocketBase,
	options: {
		occDayOffset: number;
		recurrenceType?: string;
		toConfirm?: boolean;
		minPresentRequired?: number;
		responses?: Array<{ response: string; tasks?: string[] }>;
		tasks?: Array<{ id: string; requiredVolunteers?: number }>;
		participantPrefs?: {
			email?: boolean;
			push?: boolean;
			reminderDays?: string[];
			missingDays?: string[];
			onConfirmationNeeded?: boolean;
		};
	}
): Promise<{ master: PlanningMaster; occ: PlanningOccurrence; userId: string }> {
	const { occDayOffset } = options;
	const recurrenceType = options.recurrenceType ?? 'WEEKLY';

	// 1. User
	const email = `cron-${Math.random().toString(36).slice(2)}@test.com`;
	const user = await pb.collection('users').create({
		email,
		password: 'password123',
		passwordConfirm: 'password123',
		name: 'Cron User',
		emailVisibility: true,
		verified: true
	});
	trackIds('users', user.id);

	// 2. Master avec participant authentifié dans participants[]
	const participant: Participant = {
		id: PARTICIPANT_ID,
		name: 'Cron User',
		email,
		isAdmin: true,
		createdAt: new Date().toISOString(),
		userId: user.id
	};
	const adminToken = Array.from({ length: 64 }, () =>
		Math.floor(Math.random() * 16).toString(16)
	).join('');
	const participantToken = Array.from({ length: 32 }, () =>
		Math.floor(Math.random() * 16).toString(16)
	).join('');

	const master = await pb.collection('planning_masters').create<PlanningMaster>({
		title: `Cron Test ${occDayOffset}`,
		defaultStartTime: '09:00',
		defaultEndTime: '17:00',
		recurrence: { type: recurrenceType as never },
		tasks: (options.tasks as never) || [],
		participants: [participant as never],
		minPresentRequired: options.minPresentRequired ?? 1,
		allowResponses: true,
		toConfirm: options.toConfirm ?? false,
		availableResponseTypes: ['present', 'absent'],
		adminToken,
		participantToken,
		lastModifiedBy: ''
	});
	trackIds('planning_masters', master.id);

	// 3. Occurrence avec responses mappées sur participantId
	const occResponses = (options.responses || []).map((r) => ({
		participantId: PARTICIPANT_ID,
		response: r.response,
		tasks: r.tasks || [],
		respondedAt: new Date().toISOString()
	}));
	const occ = await pb.collection('planning_occurrences').create<PlanningOccurrence>({
		master: master.id,
		date: dateInDays(occDayOffset),
		startTime: '09:00',
		endTime: '17:00',
		responses: occResponses as never,
		comments: [],
		tasks: (options.tasks as never) || [],
		isConfirmed: false,
		isCanceled: false,
		lastModifiedBy: ''
	});
	trackIds('planning_occurrences', occ.id);

	// 4. Planning_participants prefs (liaison via user, pas via participantId)
	const prefs = options.participantPrefs || {};
	await pb.collection('planning_participants').create({
		planning: master.id,
		user: user.id,
		email: prefs.email ?? true,
		push: prefs.push ?? false,
		reminderDays: prefs.reminderDays || [],
		missingDays: prefs.missingDays || [],
		onConfirmationNeeded: prefs.onConfirmationNeeded ?? false
	});

	return { master, occ, userId: user.id };
}

/**
 * Récupère tous les events liés à un master, triés par created.
 */
async function listEventsForMaster(
	pb: PocketBase,
	masterId: string
): Promise<NotificationEventsResponse[]> {
	return pb.collection('notification_events').getFullList<NotificationEventsResponse>({
		filter: `master = "${masterId}"`,
		sort: 'created'
	});
}

/** Types d'events issus du hook C2 (notifications sur update d'occ). */
const C2_EVENT_TYPES = new Set([
	'schedule_change',
	'status_canceled',
	'status_deleted',
	'status_confirmed'
]);

/**
 * Filtre les events J-X (issus du cron Phase 1) en excluant les events C2
 * (qui peuvent être insérés en parallèle par le hook update si l'occ est
 * modifiée pendant le test).
 */
function jxEventsOnly(events: NotificationEventsResponse[]): NotificationEventsResponse[] {
	return events.filter((e) => !C2_EVENT_TYPES.has(e.type));
}

describe('Cron notifications-daily — Phase 1 (insertion events J-X)', () => {
	let adminPb: PocketBase;
	const scenarioIds: { masterId: string; userId?: string }[] = [];

	beforeEach(async () => {
		clearTrackedIds();
		adminPb = await authenticateAdmin();
		scenarioIds.length = 0;
	});

	afterEach(async () => {
		// Cleanup : events créés pendant le test (non trackés par seed.ts)
		for (const { masterId } of scenarioIds) {
			const events = await adminPb
				.collection('notification_events')
				.getFullList({ filter: `master = "${masterId}"` });
			for (const ev of events) {
				await adminPb.collection('notification_events').delete(ev.id);
			}
		}
		await cleanupTrackedRecords();
	});

	it('reminder à J-3 : pref activée + response present → 1 event reminder inséré', async () => {
		const { master } = await seedCronScenario(adminPb, {
			occDayOffset: 3,
			responses: [{ response: 'present' }],
			participantPrefs: { email: true, reminderDays: ['3'] }
		});
		scenarioIds.push({ masterId: master.id });

		await runNotificationsCron(adminPb);

		const events = await listEventsForMaster(adminPb, master.id);
		const reminders = events.filter((e) => e.type === 'reminder');
		expect(reminders).toHaveLength(1);
		expect(reminders[0].reminderValue).toBe(3);
		expect(reminders[0].processedAt).toBe('');
	});

	it('reminder à J-7 : pref activée → event reminder avec reminderValue=7', async () => {
		const { master } = await seedCronScenario(adminPb, {
			occDayOffset: 7,
			responses: [{ response: 'present' }],
			participantPrefs: { email: true, reminderDays: ['7'] }
		});
		scenarioIds.push({ masterId: master.id });

		await runNotificationsCron(adminPb);

		const events = await listEventsForMaster(adminPb, master.id);
		const reminders = events.filter((e) => e.type === 'reminder');
		expect(reminders).toHaveLength(1);
		expect(reminders[0].reminderValue).toBe(7);
	});

	it('quorum_missing à J-3 : pref missingDays + present < min → 1 event', async () => {
		const { master } = await seedCronScenario(adminPb, {
			occDayOffset: 3,
			minPresentRequired: 2,
			responses: [{ response: 'present' }], // 1 present < 2 required
			participantPrefs: { email: true, missingDays: ['3'] }
		});
		scenarioIds.push({ masterId: master.id });

		await runNotificationsCron(adminPb);

		const events = await listEventsForMaster(adminPb, master.id);
		const missings = events.filter((e) => e.type === 'quorum_missing');
		expect(missings).toHaveLength(1);
		expect(missings[0].reminderValue).toBe(3);
	});

	it('confirmation_needed : master toConfirm + pref onConfirmationNeeded → 1 event', async () => {
		const { master } = await seedCronScenario(adminPb, {
			occDayOffset: 3,
			recurrenceType: 'WEEKLY',
			toConfirm: true,
			participantPrefs: { email: true, onConfirmationNeeded: true }
		});
		scenarioIds.push({ masterId: master.id });

		await runNotificationsCron(adminPb);

		const events = await listEventsForMaster(adminPb, master.id);
		const confirmations = events.filter((e) => e.type === 'confirmation_needed');
		expect(confirmations.length).toBeGreaterThanOrEqual(1);
		expect(confirmations[0].reminderValue).toBe(3);
	});

	it('déduplication : 2 crons successifs sur la même occ → pas de doublon', async () => {
		const { master } = await seedCronScenario(adminPb, {
			occDayOffset: 3,
			responses: [{ response: 'present' }],
			participantPrefs: { email: true, reminderDays: ['3'] }
		});
		scenarioIds.push({ masterId: master.id });

		await runNotificationsCron(adminPb);
		await runNotificationsCron(adminPb);

		const events = await listEventsForMaster(adminPb, master.id);
		const reminders = events.filter((e) => e.type === 'reminder' && e.reminderValue === 3);
		expect(reminders).toHaveLength(1);
	});

	it("occ annulée : isCanceled=true → ignorée par Phase 1 (pas d'event J-X)", async () => {
		const { master, occ } = await seedCronScenario(adminPb, {
			occDayOffset: 3,
			responses: [{ response: 'present' }],
			participantPrefs: { email: true, reminderDays: ['3'] }
		});
		scenarioIds.push({ masterId: master.id });

		// Annuler l'occ avant le cron. Note : le hook C2 va insérer un event
		// `status_canceled` en parallèle — c'est attendu et non testé ici.
		await adminPb.collection('planning_occurrences').update(occ.id, { isCanceled: true });

		await runNotificationsCron(adminPb);

		const events = await listEventsForMaster(adminPb, master.id);
		// Aucun event J-X (reminder/missings/confirmation) ne doit être inséré
		// par le cron car l'occ est annulée.
		expect(jxEventsOnly(events)).toHaveLength(0);
	});

	it('occ hors fenêtre (J+25) → ignorée par Phase 1', async () => {
		const { master } = await seedCronScenario(adminPb, {
			occDayOffset: 25,
			responses: [{ response: 'present' }],
			participantPrefs: { email: true, reminderDays: ['7'] }
		});
		scenarioIds.push({ masterId: master.id });

		await runNotificationsCron(adminPb);

		const events = await listEventsForMaster(adminPb, master.id);
		expect(events).toHaveLength(0);
	});
});

describe('Cron notifications-daily — Phase 2 (envoi agrégé + circuit breaker)', () => {
	let adminPb: PocketBase;
	const scenarioIds: { masterId: string; userId?: string }[] = [];

	beforeEach(async () => {
		clearTrackedIds();
		adminPb = await authenticateAdmin();
		scenarioIds.length = 0;
	});

	afterEach(async () => {
		for (const { masterId } of scenarioIds) {
			const events = await adminPb
				.collection('notification_events')
				.getFullList({ filter: `master = "${masterId}"` });
			for (const ev of events) {
				await adminPb.collection('notification_events').delete(ev.id);
			}
		}
		await cleanupTrackedRecords();
	});

	it('circuit breaker SMTP : SMTP dev injoignable → events restent pending', async () => {
		// En dev, smtp.oupla.net:587 est injoignable depuis le réseau local de test.
		// Le cron doit échouer sur chaque envoi et déclencher le circuit breaker après
		// 3 échecs consécutifs. Les events restent `processedAt=''` (non marqués traités).
		const { master } = await seedCronScenario(adminPb, {
			occDayOffset: 3,
			responses: [{ response: 'present' }],
			participantPrefs: { email: true, reminderDays: ['3'] }
		});
		scenarioIds.push({ masterId: master.id });

		await runNotificationsCron(adminPb);

		const events = await listEventsForMaster(adminPb, master.id);
		expect(events.length).toBeGreaterThanOrEqual(1);

		// Aucun event ne doit être marqué traité si le SMTP est down.
		const pendingEvents = events.filter((e) => e.processedAt === '');
		expect(pendingEvents.length).toBe(events.length);
	});

	it('destinataire sans pref email → pas destinataire, event reste pending', async () => {
		// Participant sans `email: true` dans sa pref → non destinataire → bucket vide.
		// Le cron ne tente aucun envoi pour ce master → pas d'erreur SMTP, pas d'event traité.
		const { master } = await seedCronScenario(adminPb, {
			occDayOffset: 3,
			responses: [{ response: 'present' }],
			participantPrefs: { email: false, reminderDays: ['3'] }
		});
		scenarioIds.push({ masterId: master.id });

		await runNotificationsCron(adminPb);

		const events = await listEventsForMaster(adminPb, master.id);
		expect(events).toHaveLength(1);
		// Pas de destinataire → event jamais traité.
		expect(events[0].processedAt).toBe('');
	});

	it('occ annulée entre Phase 1 et Phase 2 → event J-X skippé en Phase 2', async () => {
		const { master, occ } = await seedCronScenario(adminPb, {
			occDayOffset: 3,
			responses: [{ response: 'present' }],
			participantPrefs: { email: true, reminderDays: ['3'] }
		});
		scenarioIds.push({ masterId: master.id });

		// Phase 1 : insère l'event J-X reminder
		await runNotificationsCron(adminPb);
		const afterPhase1 = await listEventsForMaster(adminPb, master.id);
		expect(jxEventsOnly(afterPhase1)).toHaveLength(1);

		// Annuler l'occ avant Phase 2. Hook C2 va insérer status_canceled en parallèle.
		await adminPb.collection('planning_occurrences').update(occ.id, { isCanceled: true });

		// Phase 2 : doit skipper l'event J-X car occ est canceled
		await runNotificationsCron(adminPb);

		const events = await listEventsForMaster(adminPb, master.id);
		const jxEvents = jxEventsOnly(events);
		expect(jxEvents).toHaveLength(1);
		// L'event J-X reste pending car skipped en Phase 2.
		expect(jxEvents[0].processedAt).toBe('');
	});
});

describe('Cron notifications-daily — Push J-X', () => {
	let adminPb: PocketBase;
	const scenarioIds: { masterId: string; userId?: string }[] = [];

	beforeEach(async () => {
		clearTrackedIds();
		adminPb = await authenticateAdmin();
		scenarioIds.length = 0;
	});

	afterEach(async () => {
		for (const { masterId } of scenarioIds) {
			const events = await adminPb
				.collection('notification_events')
				.getFullList({ filter: `master = "${masterId}"` });
			for (const ev of events) {
				await adminPb.collection('notification_events').delete(ev.id);
			}
		}
		await cleanupTrackedRecords();
	});

	it('participant avec push=true → 1 event inséré (push envoyé en interne)', async () => {
		// Note : sendPushNotification échoue silencieusement si l'user n'a pas de
		// push_subscription valide. On valide ici uniquement que l'event J-X est
		// inséré (le push lui-même est testé unitairement dans notify-utils.test.ts).
		// L'absence d'erreur du cron confirme que la boucle push s'exécute sans crash.
		const { master } = await seedCronScenario(adminPb, {
			occDayOffset: 3,
			responses: [{ response: 'present' }],
			participantPrefs: { email: false, push: true, reminderDays: ['3'] }
		});
		scenarioIds.push({ masterId: master.id });

		// Ne doit pas throw malgré l'absence de push_subscription valide.
		await runNotificationsCron(adminPb);

		const events = await listEventsForMaster(adminPb, master.id);
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe('reminder');
	});
});
