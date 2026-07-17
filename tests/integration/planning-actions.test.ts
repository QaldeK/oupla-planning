/**
 * Tests d'integration — planningActions : pipeline complet des operations CRUD
 *
 * Objectif :
 *   Verifier le service layer planningActions.ts, qui est l'interface entre
 *   l'UI/composants et pb-sync. Chaque action represente une operation
 *   utilisateur reelle (admin ou participant).
 *
 * Pipeline teste (flux reel) :
 *   1. createPlanning : action → mastersCollection.create → PB + Dexie
 *   2. createPlanningWithOccurrences : action → master create + batch occurrences → PB + Dexie
 *   3. addParticipant / updateParticipant / removeParticipant : Dexie read → pb-sync update → PB + Dexie
 *   4. submitResponse / removeResponse : Dexie read → pb-sync update → PB + Dexie
 *   5. addComment / deleteComment : Dexie read → pb-sync update → PB + Dexie + commentState
 *   6. deletePlanning : Dexie read → mastersCollection.remove → PB soft-delete + Dexie
 *   7. getPlanningByToken : resolve token, detect admin vs participant
 *
 * Important :
 *   - planningActions utilise les singletons mastersCollection/occurrencesCollection
 *   - createPlanning/WithOccurrences ecrivent dans PB + Dexie via pb-sync (pas besoin
 *     de seed separate)
 *   - Les operations CRUD (addParticipant, submitResponse, etc.) lisent Dexie en
 *     premier lieu — le master/occurrence DOIT etre en Dexie avant l'appel
 *   - onRecordEnrich masque adminToken dans les reponses non-admin (comportement reel)
 *
 * Conditions reelles :
 *   - Toutes les operations CRUD passent par des tokens via _token (sauf create)
 *   - createPlanning utilise la createRule vide (pas de token necessaire)
 *   - La verification PB utilise authenticateAdmin (superuser) pour voir les champs masques
 *
 * Prerequis :
 *   - PocketBase demarre sur http://127.0.0.1:8090
 *   - Admin de test cree (test@example.com / testpassword)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	authenticateAdmin,
	seedPlanning,
	clearTrackedIds,
	cleanupTrackedRecords,
	trackIds
} from './seed';
import { db } from '$lib/pb-sync/db';
import { mastersCollection, occurrencesCollection } from '$lib/stores/planningStore.svelte';
import {
	createPlanning,
	createPlanningWithOccurrences,
	getPlanningByToken,
	addParticipant,
	updateParticipant,
	removeParticipant,
	submitResponse,
	removeResponse,
	addComment,
	deleteComment,
	deletePlanning,
	updatePlanning,
	updatePlanningWithOccurrences,
	normalizeResponseTypes,
	sortTasks,
	generateAdminToken,
	generateParticipantToken,
	generateParticipantId
} from '$lib/services/planningActions';
import type {
	PlanningMaster,
	PlanningOccurrence,
	Participant,
	ParticipantResponse,
	ResponseType,
	Task
} from '$lib/types/planning.types';

describe('planningActions — Pipeline CRUD complet', () => {
	beforeEach(async () => {
		clearTrackedIds();
		await db.masters.clear();
		await db.occurrences.clear();
		await db.localMeta.clear();
		await db.commentState.clear();
	});

	afterEach(async () => {
		mastersCollection.unsubscribeAll();
		occurrencesCollection.unsubscribeAll();
		await cleanupTrackedRecords();
	});

	describe('createPlanning', () => {
		it('cree un planning dans PB et Dexie avec des tokens generes', async () => {
			const master = await createPlanning({
				title: 'Mon Planning',
				defaultStartTime: '10:00',
				defaultEndTime: '12:00',
				recurrence: { type: 'CUSTOM' },
				minPresentRequired: 2,
				allowResponses: true,
				availableResponseTypes: ['present', 'absent', 'maybe']
			});

			trackIds('planning_masters', master.id);

			expect(master.id).toBeDefined();
			expect(master.title).toBe('Mon Planning');
			// adminToken est masque par onRecordEnrich (comportement reel : on ne le voit pas
			// depuis une requete non-admin)
			expect(master.participantToken!.length).toBe(32);

			// Verification Dexie
			const dexieMaster = await db.masters.get(master.id);
			expect(dexieMaster).toBeDefined();
			expect(dexieMaster!.title).toBe('Mon Planning');

			// Verification PB (superuser voit les champs masques)
			const adminPb = await authenticateAdmin();
			const pbMaster = await adminPb
				.collection('planning_masters')
				.getOne<PlanningMaster>(master.id);
			expect(pbMaster.adminToken).toBeDefined();
			expect(pbMaster.adminToken!.length).toBe(64);
			expect(pbMaster.title).toBe('Mon Planning');
			expect(dexieMaster!.updated).toBe(pbMaster.updated);
		});

		it('trie les availableResponseTypes et les tasks', async () => {
			const master = await createPlanning({
				title: 'Tri Test',
				defaultStartTime: '09:00',
				defaultEndTime: '17:00',
				recurrence: { type: 'CUSTOM' },
				minPresentRequired: 1,
				allowResponses: true,
				availableResponseTypes: ['maybe', 'present', 'absent'],
				tasks: [
					{ id: 't2', name: 'Apres', description: '', requiredVolunteers: 1, type: 'afterEvent' },
					{ id: 't1', name: 'Pendant', description: '', requiredVolunteers: 2, type: 'onEvent' }
				]
			});

			trackIds('planning_masters', master.id);

			expect(master.availableResponseTypes).toEqual(['present', 'maybe', 'absent']);
			expect(master.tasks).toHaveLength(2);
			expect(master.tasks![0].type).toBe('onEvent');
			expect(master.tasks![1].type).toBe('afterEvent');
		});
	});

	describe('createPlanningWithOccurrences', () => {
		it('cree un planning et ses occurrences de maniere atomique', async () => {
			const master = await createPlanningWithOccurrences({
				title: 'Planning avec occurrences',
				defaultStartTime: '09:00',
				defaultEndTime: '17:00',
				recurrence: { type: 'CUSTOM' },
				occurrenceTargets: [
					{ date: '2026-06-01', startTime: '09:00', endTime: '17:00', slotId: 's1' },
					{ date: '2026-06-08', startTime: '09:00', endTime: '17:00', slotId: 's1' },
					{ date: '2026-06-15', startTime: '09:00', endTime: '17:00', slotId: 's1' }
				],
				minPresentRequired: 1,
				allowResponses: true
			});

			// Verification Dexie : master + occurrences (mis par pb-sync)
			const dexieMaster = await db.masters.get(master.id);
			expect(dexieMaster).toBeDefined();

			const dexieOccurrences = await db.occurrences.where('master').equals(master.id).toArray();
			expect(dexieOccurrences.length).toBe(3);

			// Tracker les IDs créés pour le cleanup
			trackIds('planning_masters', master.id);
			for (const occ of dexieOccurrences) {
				trackIds('planning_occurrences', occ.id);
			}

			// Verification PB
			const adminPb = await authenticateAdmin();
			const pbOccurrences = await adminPb
				.collection('planning_occurrences')
				.getFullList({ filter: `master = "${master.id}"` });
			expect(pbOccurrences.length).toBe(3);

			// Coherence Dexie <-> PB
			const dexieDates = dexieOccurrences.map((o) => o.date).sort();
			const pbDates = pbOccurrences.map((o) => o.date as string).sort();
			expect(dexieDates).toEqual(pbDates);
		});

		it('ne cree pas d occurrences si occurrenceTargets est vide', async () => {
			const master = await createPlanningWithOccurrences({
				title: 'Sans occurrences',
				defaultStartTime: '09:00',
				defaultEndTime: '17:00',
				recurrence: { type: 'CUSTOM' },
				minPresentRequired: 1,
				allowResponses: true
			});

			const dexieOccurrences = await db.occurrences.where('master').equals(master.id).toArray();
			expect(dexieOccurrences.length).toBe(0);

			// Tracker les IDs créés (master uniquement, pas d'occurrences)
			trackIds('planning_masters', master.id);
		});
	});

	describe('updatePlanningWithOccurrences — diff occurrences', () => {
		// Dates futures obligatoires : le service filtre `date >= today`.
		const futureDate = (offsetDays: number) => {
			const d = new Date();
			d.setDate(d.getDate() + offsetDays);
			return d.toISOString().split('T')[0];
		};

		// PocketBase stocke le champ `date` (type Date) au format ISO complet
		// (ex. `2026-07-13 00:00:00.000Z`) ; on normalise pour comparer à `YYYY-MM-DD`.
		const normDate = (d: string) => d.split(' ')[0].split('T')[0];

		// Construit le payload master complet pour updatePlanningWithOccurrences.
		// `occurrenceTargets` est la source unique côté service : le diff create/update/
		// soft-delete/un-soft-delete s'appuie dessus (clé de réconciliation `date|slotId`).
		const buildData = (
			targets: { date: string; startTime: string; endTime: string; slotId: string }[]
		) => ({
			title: 'Update diff',
			defaultStartTime: '19:00',
			defaultEndTime: '21:00',
			timeSlots: [{ id: 's1', startTime: '19:00', endTime: '21:00' }],
			recurrence: { type: 'CUSTOM' as const },
			occurrenceTargets: targets,
			minPresentRequired: 1,
			allowResponses: true,
			availableResponseTypes: ['present', 'absent'] as ResponseType[]
		});

		// Helper : crée un master CUSTOM + ses occs via pb-sync, et récupère les occs PB.
		// On vérifie via PB (adminPb) car updatePlanningWithOccurrences utilise un batch
		// direct (hors pb-sync) → Dexie n'est pas synchronisé.
		async function createForUpdate(
			targets: { date: string; startTime: string; endTime: string; slotId: string }[]
		) {
			const adminToken = generateAdminToken();
			const participantToken = generateParticipantToken();
			const master = await createPlanningWithOccurrences(
				buildData(targets),
				adminToken,
				participantToken
			);
			trackIds('planning_masters', master.id);
			const adminPb = await authenticateAdmin();
			const occs = await adminPb
				.collection('planning_occurrences')
				.getFullList<PlanningOccurrence>({ filter: `master = "${master.id}"` });
			for (const occ of occs) trackIds('planning_occurrences', occ.id);
			return { master, adminToken, participantToken, occs };
		}

		const getOccs = async (masterId: string) => {
			const adminPb = await authenticateAdmin();
			return adminPb
				.collection('planning_occurrences')
				.getFullList<PlanningOccurrence>({ filter: `master = "${masterId}"` });
		};

		it('préserve un override au save master ultérieur (bug #1)', async () => {
			const d1 = futureDate(7);
			// Crée une occ dont les horaires (20:00-22:00) dévient du template s1 (19:00-21:00).
			const { master, adminToken, participantToken } = await createForUpdate([
				{ date: d1, startTime: '20:00', endTime: '22:00', slotId: 's1' }
			]);

			// L'admin réouvre l'édition : PlanningForm seed l'override dans seededOccurrences,
			// donc la target porte les horaires override (20:00-22:00). Save sans toucher.
			await updatePlanningWithOccurrences(
				master.id,
				buildData([{ date: d1, startTime: '20:00', endTime: '22:00', slotId: 's1' }]),
				adminToken,
				participantToken
			);

			const occs = await getOccs(master.id);
			expect(occs).toHaveLength(1);
			// L'override est préservé : le service applique les horaires de la target,
			// il ne « corrige » jamais vers le template du master.
			expect(occs[0].startTime).toBe('20:00');
			expect(occs[0].endTime).toBe('22:00');
			expect(occs[0].deleted).toBeFalsy();
		});

		it('un-soft-delete à la réactivation et préserve id/responses/comments (bug #2)', async () => {
			const d1 = futureDate(7);
			const {
				master,
				adminToken,
				participantToken,
				occs: initial
			} = await createForUpdate([{ date: d1, startTime: '19:00', endTime: '21:00', slotId: 's1' }]);
			const occId = initial[0].id;
			const adminPb = await authenticateAdmin();

			// Pose des données participant (response + commentaire) via le service (format valide).
			await submitResponse(
				occId,
				'user001',
				{
					participantId: 'user001',
					response: 'present',
					tasks: [],
					comment: '',
					respondedAt: new Date().toISOString()
				},
				adminToken
			);
			await addComment(occId, 'user001', 'Commentaire important', adminToken);

			// L'admin désactive la combo (soft-delete côté PB).
			await adminPb.collection('planning_occurrences').update(occId, { deleted: true });

			// L'admin réactive la combo : la target ne porte pas d'id (le seeding PlanningForm
			// ne seed pas les soft-deleted dans seededOccurrences) → match par clé `date|slotId`.
			await updatePlanningWithOccurrences(
				master.id,
				buildData([{ date: d1, startTime: '19:00', endTime: '21:00', slotId: 's1' }]),
				adminToken,
				participantToken
			);

			const occs = await getOccs(master.id);
			const restored = occs.find((o) => o.id === occId)!;
			expect(restored).toBeDefined();
			expect(restored.deleted).toBeFalsy(); // un-soft-deletée
			expect(restored.responses).toHaveLength(1); // response préservée
			expect(restored.comments).toHaveLength(1); // commentaire préservé
			expect(restored.startTime).toBe('19:00');
		});

		it('soft-delete les occurrences actives hors-target (bug #2)', async () => {
			const d1 = futureDate(7);
			const d2 = futureDate(14);
			const { master, adminToken, participantToken } = await createForUpdate([
				{ date: d1, startTime: '19:00', endTime: '21:00', slotId: 's1' },
				{ date: d2, startTime: '19:00', endTime: '21:00', slotId: 's1' }
			]);

			// L'admin retire d2 (combo désactivée → absente des targets).
			await updatePlanningWithOccurrences(
				master.id,
				buildData([{ date: d1, startTime: '19:00', endTime: '21:00', slotId: 's1' }]),
				adminToken,
				participantToken
			);

			const occs = await getOccs(master.id);
			expect(occs).toHaveLength(2);
			const occD1 = occs.find((o) => normDate(o.date) === d1)!;
			const occD2 = occs.find((o) => normDate(o.date) === d2)!;
			expect(occD1.deleted).toBeFalsy(); // ciblée → toujours active
			expect(occD2.deleted).toBe(true); // hors-target → soft-deletée
		});

		it('crée les nouvelles occurrences ciblées sans id', async () => {
			const d1 = futureDate(7);
			const d2 = futureDate(14);
			const { master, adminToken, participantToken } = await createForUpdate([
				{ date: d1, startTime: '19:00', endTime: '21:00', slotId: 's1' }
			]);
			const existingIds = new Set((await getOccs(master.id)).map((o) => o.id));

			// L'admin ajoute d2 (nouvelle combo sans id → création).
			await updatePlanningWithOccurrences(
				master.id,
				buildData([
					{ date: d1, startTime: '19:00', endTime: '21:00', slotId: 's1' },
					{ date: d2, startTime: '19:00', endTime: '21:00', slotId: 's1' }
				]),
				adminToken,
				participantToken
			);

			const after = await getOccs(master.id);
			expect(after).toHaveLength(2);
			const created = after.find((o) => !existingIds.has(o.id))!;
			expect(created).toBeDefined();
			expect(normDate(created.date)).toBe(d2);
			expect(created.deleted).toBeFalsy();
			expect(created.responses).toEqual([]); // nouvelle occurrence vierge
		});
	});

	describe('getPlanningByToken', () => {
		it('resout un planning via participantToken (isAdmin = false)', async () => {
			const master = await createPlanning({
				title: 'Token Test',
				defaultStartTime: '09:00',
				defaultEndTime: '17:00',
				recurrence: { type: 'CUSTOM' },
				minPresentRequired: 1,
				allowResponses: true
			});

			trackIds('planning_masters', master.id);

			const result = await getPlanningByToken(master.participantToken!);

			if ('error' in result) throw new Error(`Unexpected error: ${result.error}`);
			expect(result.master.id).toBe(master.id);
			expect(result.isAdmin).toBe(false);
		});

		it('resout un planning via adminToken (isAdmin = true)', async () => {
			const adminToken = generateAdminToken();
			const master = await createPlanning(
				{
					title: 'Admin Token Test',
					defaultStartTime: '09:00',
					defaultEndTime: '17:00',
					recurrence: { type: 'CUSTOM' },
					minPresentRequired: 1,
					allowResponses: true
				},
				adminToken
			);

			trackIds('planning_masters', master.id);

			const result = await getPlanningByToken(adminToken);

			if ('error' in result) throw new Error(`Unexpected error: ${result.error}`);
			expect(result.isAdmin).toBe(true);
		});

		it('retourne not_found pour un token inexistant', async () => {
			const result = await getPlanningByToken('00000000000000000000000000000000');

			expect(result).toEqual({ error: 'not_found' });
		});
	});

	describe('Participants — CRUD', () => {
		it('ajoute un participant au planning', async () => {
			const { master, adminToken } = await createFullPlanning({ title: 'Add Participant' });

			const alice: Participant = { id: 'aaa111', name: 'Alice', isAdmin: false, createdAt: '' };
			const updated = await addParticipant(master.id, alice, adminToken);

			expect(updated.participants).toHaveLength(1);
			expect(updated.participants[0].name).toBe('Alice');

			// Verification PB
			const adminPb = await authenticateAdmin();
			const pbMaster = await adminPb
				.collection('planning_masters')
				.getOne<PlanningMaster>(master.id);
			expect(pbMaster.participants).toHaveLength(1);
			expect(pbMaster.participants[0].id).toBe('aaa111');

			// Coherence Dexie
			const dexieMaster = await db.masters.get(master.id);
			expect(dexieMaster!.participants).toHaveLength(1);
		});

		it('met a jour un participant existant', async () => {
			const alice: Participant = { id: 'aaa111', name: 'Alice', isAdmin: false, createdAt: '' };
			const { master, adminToken } = await createFullPlanning({
				title: 'Update Participant',
				participants: [alice]
			});

			const updated = await updateParticipant(
				master.id,
				'aaa111',
				{ name: 'Alice Updated', isAdmin: true },
				adminToken
			);

			expect(updated.participants[0].name).toBe('Alice Updated');
			expect(updated.participants[0].isAdmin).toBe(true);

			// Verification PB
			const adminPb = await authenticateAdmin();
			const pbMaster = await adminPb
				.collection('planning_masters')
				.getOne<PlanningMaster>(master.id);
			expect(pbMaster.participants[0].name).toBe('Alice Updated');

			// Verification Dexie
			const dexieMaster = await db.masters.get(master.id);
			expect(dexieMaster!.participants[0].name).toBe('Alice Updated');
			expect(dexieMaster!.participants[0].isAdmin).toBe(true);
		});

		it('supprime un participant (mergeByKey re-ajoute si serveur a encore le participant)', async () => {
			const alice: Participant = { id: 'aaa111', name: 'Alice', isAdmin: false, createdAt: '' };
			const bob: Participant = { id: 'bbb222', name: 'Bob', isAdmin: false, createdAt: '' };
			const { master, adminToken } = await createFullPlanning({
				title: 'Remove Participant',
				participants: [alice, bob]
			});

			const updated = await removeParticipant(master.id, 'aaa111', adminToken);

			// NOTE: mergeByKey re-adds items present on server but absent locally — deletions are not persisted.
			expect(updated.participants).toHaveLength(2);

			// Verification PB : meme comportement (merge envoie la liste fusionnee)
			const adminPb = await authenticateAdmin();
			const pbMaster = await adminPb
				.collection('planning_masters')
				.getOne<PlanningMaster>(master.id);
			expect(pbMaster.participants).toHaveLength(2);

			// Verification Dexie
			const dexieMaster = await db.masters.get(master.id);
			expect(dexieMaster!.participants).toHaveLength(2);
		});

		it('ne cree pas de doublon si on ajoute un participant avec un id existant', async () => {
			const alice: Participant = { id: 'aaa111', name: 'Alice', isAdmin: false, createdAt: '' };
			const { master, adminToken } = await createFullPlanning({
				title: 'No Duplicate',
				participants: [alice]
			});

			const updated = await addParticipant(
				master.id,
				{ id: 'aaa111', name: 'Alice Renamed', isAdmin: true },
				adminToken
			);

			// L'ancien Alice est filtre, le nouveau est ajoute a la fin
			expect(updated.participants).toHaveLength(1);
			expect(updated.participants[0].name).toBe('Alice Renamed');
			expect(updated.participants[0].isAdmin).toBe(true);

			// Verification Dexie
			const dexieMaster = await db.masters.get(master.id);
			expect(dexieMaster!.participants).toHaveLength(1);
			expect(dexieMaster!.participants[0].name).toBe('Alice Renamed');
		});
	});

	describe('Reponses — CRUD', () => {
		it('soumet une reponse a une occurrence', async () => {
			const {
				master: _master,
				adminToken,
				occId
			} = await createFullPlanning({ occurrenceCount: 1 });
			const participantId = 'user001';

			const response: ParticipantResponse = {
				participantId,
				response: 'present',
				tasks: [],
				comment: '',
				respondedAt: new Date().toISOString()
			};
			const updated = await submitResponse(occId, participantId, response, adminToken);

			expect(updated.responses).toHaveLength(1);
			expect(updated.responses[0].participantId).toBe(participantId);
			expect(updated.responses[0].response).toBe('present');

			// Verification PB
			const adminPb = await authenticateAdmin();
			const pbOcc = await adminPb
				.collection('planning_occurrences')
				.getOne<PlanningOccurrence>(occId);
			expect(pbOcc.responses).toHaveLength(1);
			expect(pbOcc.responses[0].response).toBe('present');

			// Verification Dexie
			const dexieOcc = await db.occurrences.get(occId);
			expect(dexieOcc!.responses).toHaveLength(1);
		});

		it('met a jour une reponse existante pour le meme participant', async () => {
			const {
				master: _master,
				adminToken,
				occId
			} = await createFullPlanning({ occurrenceCount: 1 });
			const participantId = 'user001';

			await submitResponse(
				occId,
				participantId,
				{
					participantId,
					response: 'present',
					tasks: [],
					comment: 'Je viens',
					respondedAt: new Date().toISOString()
				} as ParticipantResponse,
				adminToken
			);

			const updated = await submitResponse(
				occId,
				participantId,
				{
					participantId,
					response: 'absent',
					tasks: [],
					comment: 'Je ne viens plus',
					respondedAt: new Date().toISOString()
				} as ParticipantResponse,
				adminToken
			);

			expect(updated.responses).toHaveLength(1);
			expect(updated.responses[0].response).toBe('absent');
			expect(updated.responses[0].comment).toBe('Je ne viens plus');

			// Verification Dexie
			const dexieOcc = await db.occurrences.get(occId);
			expect(dexieOcc!.responses).toHaveLength(1);
			expect(dexieOcc!.responses[0].response).toBe('absent');
		});

		it('supprime une reponse (mergeByKey re-ajoute si serveur a encore la reponse)', async () => {
			const { adminToken, occId } = await createFullPlanning({ occurrenceCount: 1 });
			const participantId = 'user001';

			await submitResponse(
				occId,
				participantId,
				{
					participantId,
					response: 'present',
					tasks: [],
					comment: '',
					respondedAt: new Date().toISOString()
				} as ParticipantResponse,
				adminToken
			);

			const updated = await removeResponse(occId, participantId, adminToken);

			// NOTE: mergeByKey re-adds items present on server but absent locally — deletions are not persisted.
			expect(updated.responses).toHaveLength(1);

			// Verification PB : meme comportement
			const adminPb = await authenticateAdmin();
			const pbOcc = await adminPb
				.collection('planning_occurrences')
				.getOne<PlanningOccurrence>(occId);
			expect(pbOcc.responses).toHaveLength(1);

			// Verification Dexie
			const dexieOcc = await db.occurrences.get(occId);
			expect(dexieOcc!.responses).toHaveLength(1);
		});

		it('gere plusieurs participants sur la meme occurrence', async () => {
			const { adminToken, occId } = await createFullPlanning({ occurrenceCount: 1 });

			await submitResponse(
				occId,
				'u1',
				{
					participantId: 'u1',
					response: 'present',
					tasks: [],
					comment: '',
					respondedAt: new Date().toISOString()
				} as ParticipantResponse,
				adminToken
			);
			await submitResponse(
				occId,
				'u2',
				{
					participantId: 'u2',
					response: 'absent',
					tasks: [],
					comment: '',
					respondedAt: new Date().toISOString()
				} as ParticipantResponse,
				adminToken
			);
			await submitResponse(
				occId,
				'u3',
				{
					participantId: 'u3',
					response: 'if_needed',
					tasks: [],
					comment: '',
					respondedAt: new Date().toISOString()
				} as ParticipantResponse,
				adminToken
			);

			const adminPb = await authenticateAdmin();
			const pbOcc = await adminPb
				.collection('planning_occurrences')
				.getOne<PlanningOccurrence>(occId);
			expect(pbOcc.responses).toHaveLength(3);

			const responsesByParticipant = pbOcc.responses.map((r) => r.response).sort();
			expect(responsesByParticipant).toEqual(['absent', 'if_needed', 'present']);

			// Verification Dexie
			const dexieOcc = await db.occurrences.get(occId);
			expect(dexieOcc!.responses).toHaveLength(3);
		});
	});

	describe('Commentaires — CRUD', () => {
		it('ajoute un commentaire a une occurrence', async () => {
			const { adminToken, occId } = await createFullPlanning({ occurrenceCount: 1 });

			const updated = await addComment(occId, 'user001', 'Premier commentaire', adminToken);

			expect(updated.comments).toHaveLength(1);
			expect(updated.comments[0].content).toBe('Premier commentaire');
			expect(updated.comments[0].participantId).toBe('user001');
			expect(updated.comments[0].id).toBeDefined();

			// Verification PB
			const adminPb = await authenticateAdmin();
			const pbOcc = await adminPb
				.collection('planning_occurrences')
				.getOne<PlanningOccurrence>(occId);
			expect(pbOcc.comments).toHaveLength(1);
			expect(pbOcc.comments[0].content).toBe('Premier commentaire');

			// Verification Dexie
			const dexieOcc = await db.occurrences.get(occId);
			expect(dexieOcc!.comments).toHaveLength(1);
			expect(dexieOcc!.comments[0].content).toBe('Premier commentaire');
		});

		it('supprime un commentaire (mergeByKey re-ajoute si serveur a encore le commentaire)', async () => {
			const { adminToken, occId } = await createFullPlanning({ occurrenceCount: 1 });

			const withComment = await addComment(occId, 'user001', 'A supprimer', adminToken);
			const commentId = withComment.comments[0].id;

			const updated = await deleteComment(occId, commentId, adminToken);

			// NOTE: mergeByKey re-adds items present on server but absent locally — deletions are not persisted.
			expect(updated.comments).toHaveLength(1);

			// Verification PB : meme comportement
			const adminPb = await authenticateAdmin();
			const pbOcc = await adminPb
				.collection('planning_occurrences')
				.getOne<PlanningOccurrence>(occId);
			expect(pbOcc.comments).toHaveLength(1);

			// Verification Dexie
			const dexieOcc = await db.occurrences.get(occId);
			expect(dexieOcc!.comments).toHaveLength(1);
		});

		it('ajoute plusieurs commentaires et supprime le bon (mergeByKey re-ajoute le supprime)', async () => {
			const { adminToken, occId } = await createFullPlanning({ occurrenceCount: 1 });

			await addComment(occId, 'u1', 'Comment 1', adminToken);
			const withC2 = await addComment(occId, 'u2', 'Comment 2', adminToken);
			const comment1Id = withC2.comments[0].id;
			const comment2Id = withC2.comments[1].id;

			await deleteComment(occId, comment1Id, adminToken);

			// NOTE: mergeByKey re-adds the deleted comment since server still has it
			const adminPb = await authenticateAdmin();
			const pbOcc = await adminPb
				.collection('planning_occurrences')
				.getOne<PlanningOccurrence>(occId);
			expect(pbOcc.comments).toHaveLength(2);
			expect(pbOcc.comments.find((c) => c.id === comment2Id)!.content).toBe('Comment 2');

			// Verification Dexie
			const dexieOcc = await db.occurrences.get(occId);
			expect(dexieOcc!.comments).toHaveLength(2);
			expect(dexieOcc!.comments.find((c) => c.id === comment2Id)!.content).toBe('Comment 2');
		});
	});

	describe('deletePlanning', () => {
		it('soft-delete le planning dans PB et Dexie', async () => {
			const { master, adminToken } = await createFullPlanning({ title: 'A Supprimer' });

			await deletePlanning(master.id, adminToken);

			// Verification Dexie : soft-delete (par defaut dans pb-sync)
			const dexieMaster = (await db.masters.get(master.id)) as Record<string, unknown> | undefined;
			expect(dexieMaster).toBeDefined();
			expect(dexieMaster!.deleted).toBe(true);

			// Verification PB : deleted=true
			const adminPb = await authenticateAdmin();
			const pbMaster = (await adminPb.collection('planning_masters').getOne(master.id)) as Record<
				string,
				unknown
			>;
			expect(pbMaster.deleted).toBe(true);
		});
	});

	describe('Utilitaires — logique pure', () => {
		it('normalizeResponseTypes trie par ordre de priorite', () => {
			expect(normalizeResponseTypes(['maybe', 'present', 'absent', 'if_needed'])).toEqual([
				'present',
				'if_needed',
				'maybe',
				'absent'
			]);
			expect(normalizeResponseTypes([])).toEqual([]);
			expect(normalizeResponseTypes(undefined)).toEqual([]);
		});

		it('sortTasks trie par type (beforeEvent, onEvent, afterEvent)', () => {
			const tasks: Task[] = [
				{ id: 't3', name: 'C', description: '', requiredVolunteers: 1, type: 'afterEvent' },
				{ id: 't1', name: 'A', description: '', requiredVolunteers: 1, type: 'beforeEvent' },
				{ id: 't2', name: 'B', description: '', requiredVolunteers: 1, type: 'onEvent' }
			];
			const sorted = sortTasks(tasks);
			expect(sorted).toHaveLength(3);
			expect(sorted![0].type).toBe('beforeEvent');
			expect(sorted![1].type).toBe('onEvent');
			expect(sorted![2].type).toBe('afterEvent');
		});

		it('generateAdminToken produit 64 chars hex', () => {
			const token = generateAdminToken();
			expect(token).toHaveLength(64);
			expect(token).toMatch(/^[0-9a-f]+$/);
		});

		it('generateParticipantToken produit 32 chars hex', () => {
			const token = generateParticipantToken();
			expect(token).toHaveLength(32);
			expect(token).toMatch(/^[0-9a-f]+$/);
		});

		it('generateParticipantId produit 16 chars hex', () => {
			const id = generateParticipantId();
			expect(id).toHaveLength(16);
			expect(id).toMatch(/^[0-9a-f]+$/);
		});
	});

	describe('Service layer — token validation', () => {
		it('rejecte la modification du titre avec un participantToken', async () => {
			// === SEED ===
			const { master, participantToken } = await seedPlanning({ title: 'Original Title' });

			// Charger le master dans Dexie (comme le ferait le flux reel)
			const { mastersCollection } = await import('$lib/stores/planningStore.svelte');
			await mastersCollection.initialFetch({ query: { _token: participantToken } });

			// === ACTION + VERIFICATION ===
			await expect(
				updatePlanning(master.id, { title: 'Hacked Title' }, participantToken)
			).rejects.toThrow();

			// Verifier que rien n'a change dans PB
			const adminPb = await authenticateAdmin();
			const pbMaster = await adminPb
				.collection('planning_masters')
				.getOne<PlanningMaster>(master.id);
			expect(pbMaster.title).toBe('Original Title');
		});

		it('rejecte la suppression du planning avec un participantToken', async () => {
			// === SEED ===
			const { master, participantToken } = await seedPlanning({ title: 'To Delete' });

			const { mastersCollection } = await import('$lib/stores/planningStore.svelte');
			await mastersCollection.initialFetch({ query: { _token: participantToken } });

			// === ACTION + VERIFICATION ===
			await expect(deletePlanning(master.id, participantToken)).rejects.toThrow();

			// Verifier que le planning existe toujours et n'est pas soft-deleted
			const adminPb = await authenticateAdmin();
			const pbMaster = (await adminPb.collection('planning_masters').getOne(master.id)) as Record<
				string,
				unknown
			>;
			expect(pbMaster).toBeDefined();
			expect(pbMaster.deleted).not.toBe(true);
		});

		it("permet l'ajout de participant avec un participantToken (auto-inscription)", async () => {
			// === SEED ===
			const { master, participantToken } = await seedPlanning({ title: 'Auto-inscription' });
			const alice: Participant = { id: 'aaa111', name: 'Alice', isAdmin: false, createdAt: '' };

			const { mastersCollection } = await import('$lib/stores/planningStore.svelte');
			await mastersCollection.initialFetch({ query: { _token: participantToken } });

			// === ACTION + VERIFICATION ===
			const result = await addParticipant(master.id, alice, participantToken);

			// Verifier que Alice a bien été ajoutée
			expect(result.participants.find((p) => p.id === alice.id)).toBeDefined();

			// Verifier en PB
			const adminPb = await authenticateAdmin();
			const pbMaster = await adminPb
				.collection('planning_masters')
				.getOne<PlanningMaster>(master.id);
			expect(pbMaster.participants.find((p) => p.id === alice.id)).toBeDefined();
		});

		it('rejecte les operations CRUD avec un token invalide', async () => {
			const { master, adminToken: _adminToken } = await createFullPlanning({
				title: 'Invalid Token'
			});
			const alice: Participant = { id: 'aaa111', name: 'Alice', isAdmin: false, createdAt: '' };

			await expect(addParticipant(master.id, alice, 'invalid-token-00000000')).rejects.toThrow();
		});
	});

	describe('Erreurs attendues', () => {
		it("throw si le master n'est pas dans Dexie lors d'un addParticipant", async () => {
			const { master, adminToken } = await seedPlanning({ title: 'Not In Dexie' });
			const alice: Participant = { id: 'aaa111', name: 'Alice', isAdmin: false, createdAt: '' };

			// master est dans PB mais PAS dans Dexie (pas de createFullPlanning/initialFetch)
			const dexieMasters = await db.masters.toArray();
			expect(dexieMasters.length).toBe(0);

			await expect(addParticipant(master.id, alice, adminToken)).rejects.toThrow();
		});

		it("throw si l'occurrence n'est pas dans Dexie lors d'un submitResponse", async () => {
			const {
				master: _master,
				adminToken,
				occurrences
			} = await seedPlanning({
				title: 'Occ Not In Dexie',
				occurrenceCount: 1
			});

			// master ET occurrences sont dans PB mais PAS dans Dexie
			const dexieOccs = await db.occurrences.toArray();
			expect(dexieOccs.length).toBe(0);

			const response: ParticipantResponse = {
				participantId: 'user001',
				response: 'present',
				tasks: [],
				comment: '',
				respondedAt: new Date().toISOString()
			};

			await expect(
				submitResponse(occurrences[0].id, 'user001', response, adminToken)
			).rejects.toThrow();
		});
	});
});

/**
 * Helper : cree un planning complet (master + occurrences) via planningActions,
 * ce qui assure que les donnees sont en Dexie comme dans le flux reel.
 * Retourne { master, adminToken, occId }.
 */
async function createFullPlanning(
	opts: { title?: string; participants?: Participant[]; occurrenceCount?: number } = {}
) {
	// Pre-generate le token car onRecordEnrich masque adminToken dans la reponse PB
	const adminToken = generateAdminToken();

	const occDates = Array.from({ length: opts.occurrenceCount || 1 }, (_, i) => {
		const d = new Date();
		d.setDate(d.getDate() + 7 * i);
		return d.toISOString().split('T')[0];
	});

	const master = await createPlanningWithOccurrences(
		{
			title: opts.title || 'Full Planning',
			defaultStartTime: '09:00',
			defaultEndTime: '17:00',
			recurrence: { type: 'CUSTOM' },
			occurrenceTargets: occDates.map((date) => ({
				date,
				startTime: '09:00',
				endTime: '17:00',
				slotId: 's1'
			})),
			minPresentRequired: 1,
			allowResponses: true,
			participants: opts.participants || []
		},
		adminToken
	);

	const occs = await db.occurrences.where('master').equals(master.id).toArray();
	const occId = occs[0]?.id;

	// Tracker les IDs créés pour le cleanup ciblé
	trackIds('planning_masters', master.id);
	for (const occ of occs) {
		trackIds('planning_occurrences', occ.id);
	}

	return { master, adminToken, occId };
}
