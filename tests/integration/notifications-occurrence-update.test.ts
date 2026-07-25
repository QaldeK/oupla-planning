/**
 * Tests d'intégration — Hook C2 : notification_events sur update d'occurrence.
 *
 * Périmètre : valider end-to-end le hook `notify-on-occurrence-update.pb.js`
 * (onRecordAfterUpdateSuccess sur planning_occurrences). Le hook insère une row
 * dans `notification_events` à chaque transition pertinente (schedule_change,
 * status_canceled, status_confirmed, status_deleted).
 *
 * Couverture :
 *   - update horaire → 1 event schedule_change avec payload oldX/newX
 *   - update lieu (place) → 1 event schedule_change
 *   - isCanceled false → true → 1 event status_canceled
 *   - isConfirmed false → true → 1 event status_confirmed
 *   - update non pertinent (lastModifiedBy seulement) → 0 event
 *   - update d'une occ passée → 0 event (filtre temporel)
 *   - update isCanceled true → false (uncancel) → 0 event (becameTrue requis)
 *   - changedBy propagé depuis lastModifiedBy
 *
 * Prérequis :
 *   - PocketBase démarré sur http://127.0.0.1:8090
 *   - Admin de test créé (test@example.com / testpassword)
 *
 * Note : ce hook se déclenche APRÈS commit transactionnel ; on utilise donc le
 * SDK admin (qui passe les API Rules) pour semer puis update les occs. La row
 * notification_events est ensuite lue via le SDK admin.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	authenticateAdmin,
	seedPlanning,
	dateInDays,
	clearTrackedIds,
	cleanupTrackedRecords,
	trackIds
} from './seed';
import type { PlanningMaster, PlanningOccurrence } from '$lib/types/planning.types';
import type { NotificationEventsResponse } from '$lib/types/pocketbase-types';

const AUTHOR_ID = 'user-test-author-0001';

/**
 * Liste les notification_events liés à une occurrence, par ordre de création.
 */
async function listEventsForOcc(
	pb: ReturnType<typeof authenticateAdmin> extends Promise<infer T> ? T : never,
	occId: string
): Promise<NotificationEventsResponse[]> {
	return pb.collection('notification_events').getFullList<NotificationEventsResponse>({
		filter: `occurrence = "${occId}"`,
		sort: 'created'
	});
}

describe('Hook C2 — notify-on-occurrence-update (notification_events insertion)', () => {
	let adminPb: Awaited<ReturnType<typeof authenticateAdmin>>;
	let master: PlanningMaster;
	let occurrences: PlanningOccurrence[];

	beforeEach(async () => {
		clearTrackedIds();
		adminPb = await authenticateAdmin();

		// Les occs doivent être futures pour franchir le filtre temporel du hook C2.
		const result = await seedPlanning({
			occurrenceCount: 1,
			occurrenceDate: dateInDays(7)
		});
		master = result.master;
		occurrences = result.occurrences;
	});

	afterEach(async () => {
		// Nettoyer aussi les notification_events créés pendant le test.
		// Ils ne sont pas trackés par seed.ts, on les supprime manuellement.
		const events = await adminPb
			.collection('notification_events')
			.getFullList({ filter: `master = "${master.id}"` });
		for (const ev of events) {
			await adminPb.collection('notification_events').delete(ev.id);
		}
		await cleanupTrackedRecords();
	});

	describe('Updates qui génèrent un event', () => {
		it('changement de startTime → 1 event schedule_change avec payload', async () => {
			const occ = occurrences[0];
			// Seed utilise startTime='09:00' par défaut ; on bump à 10:30.
			const updated = await adminPb
				.collection('planning_occurrences')
				.update<PlanningOccurrence>(occ.id, {
					startTime: '10:30',
					lastModifiedBy: AUTHOR_ID
				});

			const events = await listEventsForOcc(adminPb, occ.id);
			expect(events).toHaveLength(1);
			expect(events[0].type).toBe('schedule_change');
			expect(events[0].reminderValue).toBe(0);
			expect(events[0].occurrence).toBe(occ.id);
			expect(events[0].master).toBe(master.id);
			expect(events[0].changedBy).toBe(AUTHOR_ID);

			// Payload : contient oldStartTime / newStartTime (les autres champs sont absents).
			const payload = events[0].payload as Record<string, string> | null;
			expect(payload).toBeTruthy();
			expect(payload!.oldStartTime).toBe('09:00');
			expect(payload!.newStartTime).toBe('10:30');
			expect(payload).not.toHaveProperty('oldDate');
			expect(payload).not.toHaveProperty('oldEndTime');

			// Sanity check : l'occ a bien été modifiée.
			expect(updated.startTime).toBe('10:30');
		});

		it('changement de place → 1 event schedule_change (place dans le payload)', async () => {
			// seedPlanning ne propage pas `place` aux occs ; on la crée avec place
			// explicite pour pouvoir tester la détection de changement.
			const result2 = await seedPlanning({
				occurrenceCount: 0
			});
			trackIds('planning_masters', result2.master.id);
			const occ = await adminPb.collection('planning_occurrences').create({
				master: result2.master.id,
				date: dateInDays(7),
				startTime: '09:00',
				endTime: '17:00',
				place: 'Salle A',
				responses: [],
				comments: [],
				tasks: [],
				isConfirmed: false,
				isCanceled: false,
				lastModifiedBy: ''
			});
			trackIds('planning_occurrences', occ.id);

			await adminPb.collection('planning_occurrences').update(occ.id, {
				place: 'Salle B',
				lastModifiedBy: AUTHOR_ID
			});

			const events = await listEventsForOcc(adminPb, occ.id);
			expect(events).toHaveLength(1);
			expect(events[0].type).toBe('schedule_change');
			const payload = events[0].payload as Record<string, string>;
			expect(payload.oldPlace).toBe('Salle A');
			expect(payload.newPlace).toBe('Salle B');

			// Cleanup events du master2
			const events2 = await adminPb
				.collection('notification_events')
				.getFullList({ filter: `master = "${result2.master.id}"` });
			for (const ev of events2) {
				await adminPb.collection('notification_events').delete(ev.id);
			}
		});

		it('isCanceled false → true → 1 event status_canceled (sans payload)', async () => {
			const occ = occurrences[0];
			await adminPb.collection('planning_occurrences').update(occ.id, {
				isCanceled: true,
				lastModifiedBy: AUTHOR_ID
			});

			const events = await listEventsForOcc(adminPb, occ.id);
			expect(events).toHaveLength(1);
			expect(events[0].type).toBe('status_canceled');
			expect(events[0].payload).toBeNull();
			expect(events[0].changedBy).toBe(AUTHOR_ID);
		});

		it('isConfirmed false → true → 1 event status_confirmed', async () => {
			// On force toConfirm=true pour que le master autorise la confirmation.
			await adminPb.collection('planning_masters').update(master.id, { toConfirm: true });
			const occ = occurrences[0];
			await adminPb.collection('planning_occurrences').update(occ.id, {
				isConfirmed: true,
				lastModifiedBy: AUTHOR_ID
			});

			const events = await listEventsForOcc(adminPb, occ.id);
			expect(events).toHaveLength(1);
			expect(events[0].type).toBe('status_confirmed');
		});
	});

	describe("Updates qui ne génèrent PAS d'event", () => {
		it('update lastModifiedBy seul → 0 event', async () => {
			const occ = occurrences[0];
			await adminPb.collection('planning_occurrences').update(occ.id, {
				lastModifiedBy: AUTHOR_ID
			});

			const events = await listEventsForOcc(adminPb, occ.id);
			expect(events).toHaveLength(0);
		});

		it("update d'une occ passée → 0 event (filtre temporel)", async () => {
			// Semic une occ à J-5 (passée) puis change son startTime.
			const pastResult = await seedPlanning({ occurrenceCount: 0 });
			trackIds('planning_masters', pastResult.master.id);
			const pastOcc = await adminPb.collection('planning_occurrences').create({
				master: pastResult.master.id,
				date: dateInDays(-5),
				startTime: '09:00',
				endTime: '17:00',
				responses: [],
				comments: [],
				tasks: [],
				isConfirmed: false,
				isCanceled: false,
				lastModifiedBy: ''
			});
			trackIds('planning_occurrences', pastOcc.id);

			await adminPb.collection('planning_occurrences').update(pastOcc.id, {
				startTime: '14:00',
				lastModifiedBy: AUTHOR_ID
			});

			const events = await listEventsForOcc(adminPb, pastOcc.id);
			expect(events).toHaveLength(0);

			// Cleanup events du master past
			const eventsPast = await adminPb
				.collection('notification_events')
				.getFullList({ filter: `master = "${pastResult.master.id}"` });
			for (const ev of eventsPast) {
				await adminPb.collection('notification_events').delete(ev.id);
			}
		});

		it('isCanceled true → false (uncancel) → 0 event (becameTrue requis)', async () => {
			const occ = occurrences[0];
			// 1er update : cancel (génère 1 event)
			await adminPb.collection('planning_occurrences').update(occ.id, {
				isCanceled: true,
				lastModifiedBy: AUTHOR_ID
			});
			// 2e update : un-cancel (ne doit PAS générer d'event)
			await adminPb.collection('planning_occurrences').update(occ.id, {
				isCanceled: false,
				lastModifiedBy: AUTHOR_ID
			});

			const events = await listEventsForOcc(adminPb, occ.id);
			// Uniquement l'event du cancel, pas d'event pour l'uncancel.
			expect(events).toHaveLength(1);
			expect(events[0].type).toBe('status_canceled');
		});
	});

	describe('Propagation des métadonnées', () => {
		it('reminderValue est toujours 0 pour les events C2', async () => {
			const occ = occurrences[0];
			await adminPb.collection('planning_occurrences').update(occ.id, {
				isCanceled: true,
				lastModifiedBy: AUTHOR_ID
			});

			const events = await listEventsForOcc(adminPb, occ.id);
			expect(events[0].reminderValue).toBe(0);
		});

		it("processedAt est vide à l'insertion (pending)", async () => {
			const occ = occurrences[0];
			await adminPb.collection('planning_occurrences').update(occ.id, {
				isCanceled: true,
				lastModifiedBy: AUTHOR_ID
			});

			const events = await listEventsForOcc(adminPb, occ.id);
			expect(events[0].processedAt).toBe('');
		});

		it('changedBy reflète lastModifiedBy même quand vide', async () => {
			const occ = occurrences[0];
			await adminPb.collection('planning_occurrences').update(occ.id, {
				isCanceled: true,
				lastModifiedBy: ''
			});

			const events = await listEventsForOcc(adminPb, occ.id);
			expect(events[0].changedBy).toBe('');
		});
	});

	describe('Déduplication C2', () => {
		it('deux updates successifs génèrent deux events (pas de dédup sur C2)', async () => {
			// C2 n'a PAS de mécanisme de déduplication (contrairement à C3 qui filtre
			// sur occurrence+type+reminderValue). Chaque update notifiable = 1 event.
			const occ = occurrences[0];
			// Update 1 : startTime 09:00 → 10:00
			await adminPb.collection('planning_occurrences').update(occ.id, {
				startTime: '10:00',
				lastModifiedBy: AUTHOR_ID
			});
			// Update 2 : startTime 10:00 → 11:00
			await adminPb.collection('planning_occurrences').update(occ.id, {
				startTime: '11:00',
				lastModifiedBy: AUTHOR_ID
			});

			const events = await listEventsForOcc(adminPb, occ.id);
			expect(events).toHaveLength(2);
			expect(events.every((e) => e.type === 'schedule_change')).toBe(true);
		});
	});
});

describe('Hook C2 — new_comment events (détection + push + cleanup)', () => {
	let adminPb: Awaited<ReturnType<typeof authenticateAdmin>>;
	let master: PlanningMaster;
	let occurrences: PlanningOccurrence[];

	beforeEach(async () => {
		clearTrackedIds();
		adminPb = await authenticateAdmin();
		const result = await seedPlanning({
			occurrenceCount: 1,
			occurrenceDate: dateInDays(7)
		});
		master = result.master;
		occurrences = result.occurrences;
	});

	afterEach(async () => {
		const events = await adminPb
			.collection('notification_events')
			.getFullList({ filter: `master = "${master.id}"` });
		for (const ev of events) {
			await adminPb.collection('notification_events').delete(ev.id);
		}
		await cleanupTrackedRecords();
	});

	function mkComment(
		id: string,
		content: string,
		participantId = 'p-author'
	): {
		id: string;
		participantId: string;
		content: string;
		createdAt: string;
	} {
		return { id, participantId, content, createdAt: new Date().toISOString() };
	}

	it('addComment → 1 event new_comment avec payload complet', async () => {
		const occ = occurrences[0];
		const comment = mkComment('c1', 'On se voit à 19h');
		await adminPb.collection('planning_occurrences').update(occ.id, {
			comments: [comment],
			lastModifiedBy: AUTHOR_ID
		});

		const events = await listEventsForOcc(adminPb, occ.id);
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe('new_comment');
		expect(events[0].reminderValue).toBe(0);
		expect(events[0].occurrence).toBe(occ.id);
		expect(events[0].master).toBe(master.id);
		// changedBy porte l'auteur (utilisé comme excludeUserId pour le push).
		expect(events[0].changedBy).toBe(AUTHOR_ID);

		const payload = events[0].payload as Record<string, unknown> | null;
		expect(payload).toBeTruthy();
		expect(payload!.commentId).toBe('c1');
		expect(payload!.commentCreatedAt).toBe(comment.createdAt);
		// authorName : lastModifiedBy n'est pas un user PB ici → fallback sur l'id brut.
		expect(payload!.authorName).toBe(AUTHOR_ID);
		expect(payload!.contentPreview).toBe('On se voit à 19h');
	});

	it('authorName résolu depuis le user quand lastModifiedBy est un user PB', async () => {
		// Crée un user réel pour valider la résolution du nom affichable.
		const email = `author-${Math.random().toString(36).slice(2)}@test.com`;
		const author = await adminPb.collection('users').create({
			email,
			password: 'password123',
			passwordConfirm: 'password123',
			name: 'Alice Author',
			emailVisibility: true,
			verified: true
		});
		trackIds('users', author.id);

		const occ = occurrences[0];
		const comment = mkComment('c1', 'Hello');
		await adminPb.collection('planning_occurrences').update(occ.id, {
			comments: [comment],
			lastModifiedBy: author.id
		});

		const events = await listEventsForOcc(adminPb, occ.id);
		const payload = events[0].payload as Record<string, unknown>;
		expect(payload.authorName).toBe('Alice Author');
	});

	it("update d'une occ passée → 0 event new_comment (filtre temporel)", async () => {
		const pastResult = await seedPlanning({ occurrenceCount: 0 });
		trackIds('planning_masters', pastResult.master.id);
		const pastOcc = await adminPb.collection('planning_occurrences').create({
			master: pastResult.master.id,
			date: dateInDays(-5),
			startTime: '09:00',
			endTime: '17:00',
			responses: [],
			comments: [],
			tasks: [],
			isConfirmed: false,
			isCanceled: false,
			lastModifiedBy: ''
		});
		trackIds('planning_occurrences', pastOcc.id);

		await adminPb.collection('planning_occurrences').update(pastOcc.id, {
			comments: [mkComment('c1', 'Message sur occ passée')],
			lastModifiedBy: AUTHOR_ID
		});

		const events = await listEventsForOcc(adminPb, pastOcc.id);
		expect(events).toHaveLength(0);

		const eventsPast = await adminPb
			.collection('notification_events')
			.getFullList({ filter: `master = "${pastResult.master.id}"` });
		for (const ev of eventsPast) {
			await adminPb.collection('notification_events').delete(ev.id);
		}
	});

	it('update batch avec 2 nouveaux messages → 2 events new_comment', async () => {
		const occ = occurrences[0];
		await adminPb.collection('planning_occurrences').update(occ.id, {
			comments: [mkComment('c1', 'Premier'), mkComment('c2', 'Second')],
			lastModifiedBy: AUTHOR_ID
		});

		const events = await listEventsForOcc(adminPb, occ.id);
		expect(events).toHaveLength(2);
		expect(events.every((e) => e.type === 'new_comment')).toBe(true);
		const commentIds = events.map((e) => (e.payload as Record<string, unknown>).commentId);
		expect(commentIds.sort()).toEqual(['c1', 'c2']);
	});

	it('deleteComment → cleanup : les events new_comment non-consommés sont marqués processedAt', async () => {
		const occ = occurrences[0];
		// 1. Ajoute un commentaire → 1 event new_comment pending.
		await adminPb.collection('planning_occurrences').update(occ.id, {
			comments: [mkComment('c1', 'À supprimer')],
			lastModifiedBy: AUTHOR_ID
		});
		let events = await listEventsForOcc(adminPb, occ.id);
		expect(events).toHaveLength(1);
		expect(events[0].processedAt).toBe('');

		// 2. Supprime le commentaire (superuser bypass le merge → comments=[]).
		await adminPb.collection('planning_occurrences').update(occ.id, {
			comments: [],
			lastModifiedBy: AUTHOR_ID
		});

		// 3. L'event new_comment doit être marqué traité (cleanup sur suppression).
		events = await listEventsForOcc(adminPb, occ.id);
		// Aucun nouvel event n'a dû être inséré par la suppression.
		expect(events).toHaveLength(1);
		expect(events[0].processedAt).not.toBe('');
	});

	it('ne cleanup que les events liés au commentId supprimé (un autre reste pending)', async () => {
		const occ = occurrences[0];
		// Ajoute c1 puis c2 en deux updates (2 events distincts).
		await adminPb.collection('planning_occurrences').update(occ.id, {
			comments: [mkComment('c1', 'Un'), mkComment('c2', 'Deux')],
			lastModifiedBy: AUTHOR_ID
		});
		let events = await listEventsForOcc(adminPb, occ.id);
		expect(events).toHaveLength(2);
		expect(events.every((e) => e.processedAt === '')).toBe(true);

		// Supprime uniquement c1.
		await adminPb.collection('planning_occurrences').update(occ.id, {
			comments: [mkComment('c2', 'Deux')],
			lastModifiedBy: AUTHOR_ID
		});

		events = await listEventsForOcc(adminPb, occ.id);
		const byId = new Map(
			events.map((e) => [(e.payload as Record<string, unknown>).commentId as string, e])
		);
		expect(byId.get('c1')!.processedAt as string).not.toBe('');
		// c2 n'a pas été supprimé → son event reste pending.
		expect(byId.get('c2')!.processedAt).toBe('');
	});

	it('ajout + modification simultanée (content ≠) → seul le nouvel ID est ajouté', async () => {
		const occ = occurrences[0];
		// Pré-existant c1.
		await adminPb.collection('planning_occurrences').update(occ.id, {
			comments: [mkComment('c1', 'Avant')],
			lastModifiedBy: AUTHOR_ID
		});
		// Cleanup des events du premier ajout pour repartir à zéro.
		for (const ev of await listEventsForOcc(adminPb, occ.id)) {
			await adminPb.collection('notification_events').delete(ev.id);
		}

		// Update : c1 avec content modifié + c2 nouveau (pas de détection modified en v1).
		await adminPb.collection('planning_occurrences').update(occ.id, {
			comments: [mkComment('c1', 'Après'), mkComment('c2', 'Nouveau')],
			lastModifiedBy: AUTHOR_ID
		});

		const events = await listEventsForOcc(adminPb, occ.id);
		expect(events).toHaveLength(1);
		expect((events[0].payload as Record<string, unknown>).commentId).toBe('c2');
	});
});
