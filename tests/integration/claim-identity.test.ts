/**
 * Tests d'intégration — claimParticipantIdentity : migration guest → auth
 *
 * Objectif :
 *   Vérifier le pipeline de revendication d'identité guest par un user auth :
 *     claimParticipantIdentity() -> POST /api/claim-participant-identity -> PB
 *     - Merge responses (auth wins sur conflit, drop identical, migrate)
 *     - Re-attribution des comments
 *     - Mise à jour master.participants (suppression auth ou ajout userId)
 *     - Realtime déclenché via txApp.save()
 *
 * Pipeline testé :
 *   claimParticipantIdentity(masterId, guestParticipantId, token)
 *     -> endpoint PB /api/claim-participant-identity (runInTransaction)
 *     -> updates planning_occurrences + planning_masters
 *     -> retourne { success, stats, authParticipantId }
 *
 * Conditions réelles :
 *   - PocketBase démarré avec hooks main.pb.js chargés
 *   - Endpoint utilise runInTransaction (atomique)
 *   - Validation token via participantToken/adminToken du master
 *   - Vérifications : guest existe, pas déjà claimé (userId null), pas hasQuit
 *
 * Prérequis :
 *   - PocketBase démarré sur http://127.0.0.1:8090
 *   - Admin de test créé (test@example.com / testpassword)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	seedPlanning,
	authenticateAdmin,
	authenticateUser,
	seedUser,
	clearTrackedIds,
	cleanupTrackedRecords,
	trackIds,
	cleanupUsers
} from './seed';
import { db } from '$lib/pb-sync/db';
import { pb } from '$lib/pocketbase/pb';
import { claimParticipantIdentity } from '$lib/services/planningActions';
import type { Participant, ParticipantResponse } from '$lib/types/planning.types';

const USER_EMAIL = 'claim-test@test.com';
const USER_PWD = 'password123';

// Helpers locaux pour mettre à jour directement les occurrences via admin
async function adminUpdateOccurrence(
	occId: string,
	patch: { responses?: ParticipantResponse[]; comments?: any[] }
) {
	const adminPb = await authenticateAdmin();
	return await adminPb.collection('planning_occurrences').update(occId, patch);
}

async function adminUpdateMaster(masterId: string, patch: { participants?: Participant[] }) {
	const adminPb = await authenticateAdmin();
	return await adminPb.collection('planning_masters').update(masterId, patch);
}

async function adminGetMaster(masterId: string) {
	const adminPb = await authenticateAdmin();
	return await adminPb.collection('planning_masters').getOne(masterId);
}

async function adminGetOccurrence(occId: string) {
	const adminPb = await authenticateAdmin();
	return await adminPb.collection('planning_occurrences').getOne(occId);
}

describe('claimParticipantIdentity — migration guest → auth', () => {
	beforeEach(async () => {
		clearTrackedIds();
		await db.masters.clear();
		await db.occurrences.clear();
		await db.localMeta.clear();
		await db.commentState.clear();
		pb.authStore.clear();
	});

	afterEach(async () => {
		await cleanupTrackedRecords();
		await cleanupUsers([USER_EMAIL]);
		pb.authStore.clear();
	});

	// ============================================
	// CAS B : auth non-participant, claim direct
	// ============================================

	describe('CAS B : auth non-participant (claim direct)', () => {
		it('ajoute userId sur guest et conserve ses responses (mode simple)', async () => {
			// === SEED ===
			// Master avec 1 participant guest "Alice" (sans userId)
			const guestParticipant: Participant = {
				id: 'guest-alice-1',
				name: 'Alice',
				isAdmin: false,
				createdAt: new Date().toISOString()
			};
			const { master, occurrences, participantToken } = await seedPlanning({
				title: 'Claim Test B',
				participants: [guestParticipant],
				occurrenceCount: 2
			});

			// Guest a répondu à l'occurrence 0
			const guestResponse: ParticipantResponse = {
				participantId: 'guest-alice-1',
				response: 'present',
				tasks: [],
				respondedAt: new Date().toISOString()
			};
			await adminUpdateOccurrence(occurrences[0].id, { responses: [guestResponse] });

			// User auth SANS participant dans le master
			const user = await seedUser(USER_EMAIL, USER_PWD, 'Auth User');
			trackIds('users', user.id);

			// Authentifier dans le singleton pb
			const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);

			// === ACTION ===
			const result = await claimParticipantIdentity(master.id, 'guest-alice-1', participantToken);

			// === VERIFICATION RETOUR ===
			expect(result.success).toBe(true);
			expect(result.authParticipantId).toBe('guest-alice-1');
			expect(result.stats.migrated).toBe(1);
			expect(result.stats.conflict).toBe(0);
			expect(result.stats.identical).toBe(0);
			expect(result.stats.commentsMigrated).toBe(0);

			// === VERIFICATION MASTER ===
			const pbMaster = await adminGetMaster(master.id);
			const participants = pbMaster.participants as Participant[];
			expect(participants).toHaveLength(1);
			expect(participants[0].id).toBe('guest-alice-1');
			expect(participants[0].name).toBe('Alice');
			expect(participants[0].userId).toBe(user.id);

			// === VERIFICATION OCCURRENCE ===
			// La réponse est conservée (guest.id == targetId, pas de changement d'id)
			const pbOcc = await adminGetOccurrence(occurrences[0].id);
			const responses = pbOcc.responses as ParticipantResponse[];
			expect(responses).toHaveLength(1);
			expect(responses[0].participantId).toBe('guest-alice-1');
			expect(responses[0].response).toBe('present');
		});

		it('migré les comments du guest vers targetId', async () => {
			// === SEED ===
			const guestParticipant: Participant = {
				id: 'guest-bob',
				name: 'Bob',
				isAdmin: false,
				createdAt: new Date().toISOString()
			};
			const { master, occurrences, participantToken } = await seedPlanning({
				title: 'Comments Test',
				participants: [guestParticipant],
				occurrenceCount: 1
			});

			// Guest a commenté
			const guestComment = {
				id: 'comment-1',
				participantId: 'guest-bob',
				content: 'Hello world',
				createdAt: new Date().toISOString()
			};
			await adminUpdateOccurrence(occurrences[0].id, { comments: [guestComment] });

			const user = await seedUser(USER_EMAIL, USER_PWD, 'Auth User');
			trackIds('users', user.id);
			const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);

			// === ACTION ===
			const result = await claimParticipantIdentity(master.id, 'guest-bob', participantToken);

			// === VERIFICATION ===
			// En CAS B (auth n'existait pas), les comments du guest sont déjà à targetId (guest.id).
			// Aucune re-attribution nécessaire → commentsMigrated = 0.
			// (Le compteur ne track que les re-attributions effectives sourceId → targetId.)
			expect(result.stats.commentsMigrated).toBe(0);

			const pbOcc = await adminGetOccurrence(occurrences[0].id);
			const comments = pbOcc.comments as any[];
			expect(comments).toHaveLength(1);
			// Comments restent à guest-bob (qui est maintenant le targetId/auth)
			expect(comments[0].participantId).toBe('guest-bob');
			expect(comments[0].content).toBe('Hello world');
			expect(comments[0].id).toBe('comment-1'); // id du commentaire préservé
		});
	});

	// ============================================
	// CAS C + claim : auth existe déjà, merge requis
	// ============================================

	describe('CAS C + claim : auth existe avec responses (merge)', () => {
		it('conflit → auth wins, response auth conservée sous targetId', async () => {
			// === SEED ===
			const guestParticipant: Participant = {
				id: 'guest-alice',
				name: 'Alice',
				isAdmin: false,
				createdAt: new Date().toISOString()
			};
			const authParticipant: Participant = {
				id: 'pbuser-auth', // différent de pbUser.id pour bien tester
				name: 'alice06',
				isAdmin: false,
				createdAt: new Date().toISOString(),
				userId: 'will-be-replaced' // placeholder, mis à jour après seedUser
			};
			const { master, occurrences, participantToken } = await seedPlanning({
				title: 'Conflict Test',
				participants: [guestParticipant, authParticipant],
				occurrenceCount: 1
			});

			// Les deux ont répondu différemment
			await adminUpdateOccurrence(occurrences[0].id, {
				responses: [
					{
						participantId: 'guest-alice',
						response: 'present',
						tasks: [],
						respondedAt: new Date().toISOString()
					},
					{
						participantId: 'pbuser-auth',
						response: 'absent',
						tasks: [],
						respondedAt: new Date().toISOString()
					}
				]
			});

			const user = await seedUser(USER_EMAIL, USER_PWD, 'Auth User');
			trackIds('users', user.id);

			// Mettre à jour le auth participant avec le vrai userId
			const updatedParticipants = [guestParticipant, { ...authParticipant, userId: user.id }];
			await adminUpdateMaster(master.id, { participants: updatedParticipants });

			const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);

			// === ACTION ===
			const result = await claimParticipantIdentity(master.id, 'guest-alice', participantToken);

			// === VERIFICATION RETOUR ===
			expect(result.success).toBe(true);
			expect(result.authParticipantId).toBe('guest-alice'); // target = guest.id
			expect(result.stats.conflict).toBe(1);
			expect(result.stats.migrated).toBe(0);
			expect(result.stats.identical).toBe(0);

			// === VERIFICATION MASTER ===
			const pbMaster = await adminGetMaster(master.id);
			const participants = pbMaster.participants as Participant[];
			// Auth supprimé, guest a userId
			expect(participants).toHaveLength(1);
			expect(participants[0].id).toBe('guest-alice');
			expect(participants[0].userId).toBe(user.id);

			// === VERIFICATION OCCURRENCE ===
			// Auth wins → response 'absent' conservée, re-attribuée à guest-alice
			const pbOcc = await adminGetOccurrence(occurrences[0].id);
			const responses = pbOcc.responses as ParticipantResponse[];
			expect(responses).toHaveLength(1);
			expect(responses[0].participantId).toBe('guest-alice');
			expect(responses[0].response).toBe('absent'); // auth wins
		});

		it('identical → réponse identique conservée sous targetId', async () => {
			const guestParticipant: Participant = {
				id: 'guest-eve',
				name: 'Eve',
				isAdmin: false,
				createdAt: new Date().toISOString()
			};
			const authParticipant: Participant = {
				id: 'pbuser-eve',
				name: 'eve88',
				isAdmin: false,
				createdAt: new Date().toISOString(),
				userId: 'placeholder'
			};
			const { master, occurrences, participantToken } = await seedPlanning({
				title: 'Identical Test',
				participants: [guestParticipant, authParticipant],
				occurrenceCount: 1
			});

			// Les deux ont répondu present
			await adminUpdateOccurrence(occurrences[0].id, {
				responses: [
					{
						participantId: 'guest-eve',
						response: 'present',
						tasks: [],
						respondedAt: new Date().toISOString()
					},
					{
						participantId: 'pbuser-eve',
						response: 'present',
						tasks: [],
						respondedAt: new Date().toISOString()
					}
				]
			});

			const user = await seedUser(USER_EMAIL, USER_PWD, 'Auth User');
			trackIds('users', user.id);
			await adminUpdateMaster(master.id, {
				participants: [guestParticipant, { ...authParticipant, userId: user.id }]
			});

			const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);

			// === ACTION ===
			const result = await claimParticipantIdentity(master.id, 'guest-eve', participantToken);

			// === VERIFICATION ===
			expect(result.stats.identical).toBe(1);
			expect(result.stats.conflict).toBe(0);
			expect(result.stats.migrated).toBe(0);

			const pbOcc = await adminGetOccurrence(occurrences[0].id);
			const responses = pbOcc.responses as ParticipantResponse[];
			expect(responses).toHaveLength(1);
			expect(responses[0].participantId).toBe('guest-eve');
			expect(responses[0].response).toBe('present');
		});

		it('migrate → seule la réponse du guest est conservée (auth avait pas répondu)', async () => {
			const guestParticipant: Participant = {
				id: 'guest-mallory',
				name: 'Mallory',
				isAdmin: false,
				createdAt: new Date().toISOString()
			};
			const authParticipant: Participant = {
				id: 'pbuser-mallory',
				name: 'mal42',
				isAdmin: false,
				createdAt: new Date().toISOString(),
				userId: 'placeholder'
			};
			const { master, occurrences, participantToken } = await seedPlanning({
				title: 'Migrate Test',
				participants: [guestParticipant, authParticipant],
				occurrenceCount: 1
			});

			// Seul guest a répondu
			await adminUpdateOccurrence(occurrences[0].id, {
				responses: [
					{
						participantId: 'guest-mallory',
						response: 'present',
						tasks: [],
						respondedAt: new Date().toISOString()
					}
				]
			});

			const user = await seedUser(USER_EMAIL, USER_PWD, 'Auth User');
			trackIds('users', user.id);
			await adminUpdateMaster(master.id, {
				participants: [guestParticipant, { ...authParticipant, userId: user.id }]
			});

			const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);

			// === ACTION ===
			const result = await claimParticipantIdentity(master.id, 'guest-mallory', participantToken);

			// === VERIFICATION ===
			expect(result.stats.migrated).toBe(1);

			const pbOcc = await adminGetOccurrence(occurrences[0].id);
			const responses = pbOcc.responses as ParticipantResponse[];
			expect(responses).toHaveLength(1);
			expect(responses[0].participantId).toBe('guest-mallory');
			expect(responses[0].response).toBe('present');
		});

		it('re-attribue les comments auth ET guest vers targetId', async () => {
			const guestParticipant: Participant = {
				id: 'guest-carol',
				name: 'Carol',
				isAdmin: false,
				createdAt: new Date().toISOString()
			};
			const authParticipant: Participant = {
				id: 'pbuser-carol',
				name: 'carol99',
				isAdmin: false,
				createdAt: new Date().toISOString(),
				userId: 'placeholder'
			};
			const { master, occurrences, participantToken } = await seedPlanning({
				title: 'Comments Merge Test',
				participants: [guestParticipant, authParticipant],
				occurrenceCount: 1
			});

			// Les deux ont commenté
			await adminUpdateOccurrence(occurrences[0].id, {
				comments: [
					{
						id: 'c-guest',
						participantId: 'guest-carol',
						content: 'Guest comment',
						createdAt: new Date().toISOString()
					},
					{
						id: 'c-auth',
						participantId: 'pbuser-carol',
						content: 'Auth comment',
						createdAt: new Date().toISOString()
					}
				]
			});

			const user = await seedUser(USER_EMAIL, USER_PWD, 'Auth User');
			trackIds('users', user.id);
			await adminUpdateMaster(master.id, {
				participants: [guestParticipant, { ...authParticipant, userId: user.id }]
			});

			const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);

			// === ACTION ===
			const result = await claimParticipantIdentity(master.id, 'guest-carol', participantToken);

			// === VERIFICATION ===
			// 1 comment du source (pbuser-carol) re-attribué au target (guest-carol)
			expect(result.stats.commentsMigrated).toBe(1);

			const pbOcc = await adminGetOccurrence(occurrences[0].id);
			const comments = pbOcc.comments as any[];
			expect(comments).toHaveLength(2);
			// Tous les comments doivent être sur targetId (guest-carol)
			for (const c of comments) {
				expect(c.participantId).toBe('guest-carol');
			}
			// IDs préservés
			expect(comments.map((c) => c.id).sort()).toEqual(['c-auth', 'c-guest']);
		});
	});

	// ============================================
	// Validations et erreurs
	// ============================================

	describe('Validations et erreurs', () => {
		it('rejette hasQuit guest avec 409', async () => {
			const guestParticipant: Participant = {
				id: 'guest-quit',
				name: 'Quit User',
				isAdmin: false,
				createdAt: new Date().toISOString(),
				hasQuit: true
			};
			const { master, participantToken } = await seedPlanning({
				title: 'HasQuit Test',
				participants: [guestParticipant],
				occurrenceCount: 0
			});

			const user = await seedUser(USER_EMAIL, USER_PWD, 'Auth User');
			trackIds('users', user.id);
			const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);

			// === ACTION + VERIFICATION ===
			await expect(
				claimParticipantIdentity(master.id, 'guest-quit', participantToken)
			).rejects.toMatchObject({ status: 409 });
		});

		it('rejette guest déjà claimé (userId non-null) avec 409', async () => {
			const user = await seedUser(USER_EMAIL, USER_PWD, 'Auth User');
			trackIds('users', user.id);

			const claimedByOther: Participant = {
				id: 'guest-claimed',
				name: 'Already Claimed',
				isAdmin: false,
				createdAt: new Date().toISOString(),
				userId: 'other-user-id' // déjà claimé par quelqu'un d'autre
			};
			const { master, participantToken } = await seedPlanning({
				title: 'Already Claimed Test',
				participants: [claimedByOther],
				occurrenceCount: 0
			});

			const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);

			// === ACTION + VERIFICATION ===
			await expect(
				claimParticipantIdentity(master.id, 'guest-claimed', participantToken)
			).rejects.toMatchObject({ status: 409 });
		});

		it('rejette guest introuvable avec 404', async () => {
			const { master, participantToken } = await seedPlanning({
				title: 'Not Found Test',
				participants: [],
				occurrenceCount: 0
			});

			const user = await seedUser(USER_EMAIL, USER_PWD, 'Auth User');
			trackIds('users', user.id);
			const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);

			// === ACTION + VERIFICATION ===
			await expect(
				claimParticipantIdentity(master.id, 'inexistant-id', participantToken)
			).rejects.toMatchObject({ status: 404 });
		});

		it('rejette token invalide avec 403', async () => {
			const guestParticipant: Participant = {
				id: 'guest-token',
				name: 'Token Test',
				isAdmin: false,
				createdAt: new Date().toISOString()
			};
			const { master } = await seedPlanning({
				title: 'Token Invalid Test',
				participants: [guestParticipant],
				occurrenceCount: 0
			});

			const user = await seedUser(USER_EMAIL, USER_PWD, 'Auth User');
			trackIds('users', user.id);
			const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);

			// === ACTION + VERIFICATION ===
			await expect(
				claimParticipantIdentity(master.id, 'guest-token', 'invalid-token-not-matching')
			).rejects.toMatchObject({ status: 403 });
		});

		it('rejette sans auth avec 401', async () => {
			const guestParticipant: Participant = {
				id: 'guest-noauth',
				name: 'NoAuth Test',
				isAdmin: false,
				createdAt: new Date().toISOString()
			};
			const { master, participantToken } = await seedPlanning({
				title: 'NoAuth Test',
				participants: [guestParticipant],
				occurrenceCount: 0
			});

			// Pas d'auth dans le singleton pb

			// === ACTION + VERIFICATION ===
			await expect(
				claimParticipantIdentity(master.id, 'guest-noauth', participantToken)
			).rejects.toMatchObject({ status: 401 });
		});
	});

	// ============================================
	// Cas combiné : merge complet avec plusieurs occurrences
	// ============================================

	describe('Scénario complet multi-occurrences', () => {
		it('merge 3 occurrences avec combinaison de cas', async () => {
			// === SEED ===
			const guestParticipant: Participant = {
				id: 'guest-multi',
				name: 'Multi Guest',
				isAdmin: false,
				createdAt: new Date().toISOString()
			};
			const authParticipant: Participant = {
				id: 'pbuser-multi',
				name: 'Multi Auth',
				isAdmin: false,
				createdAt: new Date().toISOString(),
				userId: 'placeholder'
			};
			const { master, occurrences, participantToken } = await seedPlanning({
				title: 'Multi Test',
				participants: [guestParticipant, authParticipant],
				occurrenceCount: 3
			});

			const user = await seedUser(USER_EMAIL, USER_PWD, 'Auth User');
			trackIds('users', user.id);
			await adminUpdateMaster(master.id, {
				participants: [guestParticipant, { ...authParticipant, userId: user.id }]
			});

			// Occ 0 : conflit (present vs absent)
			await adminUpdateOccurrence(occurrences[0].id, {
				responses: [
					{
						participantId: 'guest-multi',
						response: 'present',
						tasks: [],
						respondedAt: new Date().toISOString()
					},
					{
						participantId: 'pbuser-multi',
						response: 'absent',
						tasks: [],
						respondedAt: new Date().toISOString()
					}
				]
			});

			// Occ 1 : identical (present partout)
			await adminUpdateOccurrence(occurrences[1].id, {
				responses: [
					{
						participantId: 'guest-multi',
						response: 'present',
						tasks: [],
						respondedAt: new Date().toISOString()
					},
					{
						participantId: 'pbuser-multi',
						response: 'present',
						tasks: [],
						respondedAt: new Date().toISOString()
					}
				]
			});

			// Occ 2 : seul guest a répondu
			await adminUpdateOccurrence(occurrences[2].id, {
				responses: [
					{
						participantId: 'guest-multi',
						response: 'maybe',
						tasks: [],
						respondedAt: new Date().toISOString()
					}
				]
			});

			const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);

			// === ACTION ===
			const result = await claimParticipantIdentity(master.id, 'guest-multi', participantToken);

			// === VERIFICATION STATS ===
			expect(result.stats.conflict).toBe(1); // occ 0
			expect(result.stats.identical).toBe(1); // occ 1
			expect(result.stats.migrated).toBe(1); // occ 2

			// === VERIFICATION OCCURRENCES ===
			// Toutes les responses sont sur guest-multi (targetId)
			for (const occ of occurrences) {
				const pbOcc = await adminGetOccurrence(occ.id);
				const responses = pbOcc.responses as ParticipantResponse[];
				expect(responses).toHaveLength(1);
				expect(responses[0].participantId).toBe('guest-multi');
			}

			// Occ 0 : auth wins (absent)
			const occ0 = await adminGetOccurrence(occurrences[0].id);
			expect((occ0.responses as ParticipantResponse[])[0].response).toBe('absent');

			// Occ 1 : present (identical)
			const occ1 = await adminGetOccurrence(occurrences[1].id);
			expect((occ1.responses as ParticipantResponse[])[0].response).toBe('present');

			// Occ 2 : maybe (migrate)
			const occ2 = await adminGetOccurrence(occurrences[2].id);
			expect((occ2.responses as ParticipantResponse[])[0].response).toBe('maybe');

			// === VERIFICATION MASTER ===
			const pbMaster = await adminGetMaster(master.id);
			const participants = pbMaster.participants as Participant[];
			expect(participants).toHaveLength(1);
			expect(participants[0].id).toBe('guest-multi');
			expect(participants[0].userId).toBe(user.id);
			expect(participants[0].name).toBe('Multi Guest');
		});
	});

	// ============================================
	// Guard anti multi-revendication (claimedAt)
	// ============================================

	describe('Guard anti multi-revendication (claimedAt)', () => {
		it('pose claimedAt sur le guest après une revendication réussie (CAS B)', async () => {
			const guestParticipant: Participant = {
				id: 'guest-alice-claimed',
				name: 'Alice',
				isAdmin: false,
				createdAt: new Date().toISOString()
			};
			const { master, participantToken } = await seedPlanning({
				title: 'ClaimedAt Test',
				participants: [guestParticipant],
				occurrenceCount: 1
			});

			const user = await seedUser(USER_EMAIL, USER_PWD, 'Auth User');
			trackIds('users', user.id);
			const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);

			const result = await claimParticipantIdentity(
				master.id,
				'guest-alice-claimed',
				participantToken
			);
			expect(result.success).toBe(true);

			const pbMaster = await adminGetMaster(master.id);
			const participants = pbMaster.participants as Participant[];
			expect(participants).toHaveLength(1);
			expect(participants[0].userId).toBe(user.id);
			expect(participants[0].claimedAt).toBeTruthy();
			expect(typeof participants[0].claimedAt).toBe('string');
		});

		it('rejette une seconde revendication par le même auth sur un autre guest (409)', async () => {
			// === SEED : 2 guests (Alice + Bob) ===
			const guests: Participant[] = [
				{ id: 'guest-alice-2', name: 'Alice', isAdmin: false, createdAt: new Date().toISOString() },
				{ id: 'guest-bob-2', name: 'Bob', isAdmin: false, createdAt: new Date().toISOString() }
			];
			const { master, participantToken } = await seedPlanning({
				title: 'Multi Claim Test',
				participants: guests,
				occurrenceCount: 0
			});

			const user = await seedUser(USER_EMAIL, USER_PWD, 'Auth User');
			trackIds('users', user.id);
			const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);

			// === 1re revendication : Alice (succès) ===
			const result1 = await claimParticipantIdentity(master.id, 'guest-alice-2', participantToken);
			expect(result1.success).toBe(true);

			// Alice a maintenant userId + claimedAt ; Bob est toujours non-lié
			// === 2e revendication : Bob (doit échouer — l'auth a déjà claimedAt) ===
			await expect(
				claimParticipantIdentity(master.id, 'guest-bob-2', participantToken)
			).rejects.toMatchObject({ status: 409 });

			// Bob n'a pas été claimé (toujours pas de userId)
			const pbMaster = await adminGetMaster(master.id);
			const participants = pbMaster.participants as Participant[];
			const bob = participants.find((p) => p.id === 'guest-bob-2');
			expect(bob?.userId).toBeUndefined();
			expect(bob?.claimedAt).toBeUndefined();
		});

		it("autorise la première revendication d'un auth auto-ajouté sans claimedAt (CAS C valide)", async () => {
			// CAS C : l'auth a déjà un participant lié (userId) MAIS sans claimedAt
			// (auto-add silencieux). La première revendication doit être autorisée.
			const guestParticipant: Participant = {
				id: 'guest-alice-c',
				name: 'Alice',
				isAdmin: false,
				createdAt: new Date().toISOString()
			};
			const { master, participantToken } = await seedPlanning({
				title: 'CAS C Valid Claim',
				participants: [guestParticipant],
				occurrenceCount: 0
			});

			const user = await seedUser(USER_EMAIL, USER_PWD, 'Auth User');
			trackIds('users', user.id);
			const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);

			// Simuler l'auto-add silencieux : ajouter un participant auth sans claimedAt
			const authParticipant: Participant = {
				id: 'auth-autoadd',
				name: 'Auth User',
				isAdmin: false,
				createdAt: new Date().toISOString(),
				userId: user.id
				// PAS de claimedAt → l'auth peut encore revendiquer
			};
			await adminUpdateMaster(master.id, {
				participants: [guestParticipant, authParticipant]
			});

			// === Revendication de Alice : doit réussir (le guard ne bloque pas) ===
			const result = await claimParticipantIdentity(master.id, 'guest-alice-c', participantToken);
			expect(result.success).toBe(true);
			expect(result.authParticipantId).toBe('guest-alice-c');

			// L'auth auto-ajouté a été supprimé, Alice a userId + claimedAt
			const pbMaster = await adminGetMaster(master.id);
			const participants = pbMaster.participants as Participant[];
			expect(participants).toHaveLength(1);
			expect(participants[0].id).toBe('guest-alice-c');
			expect(participants[0].userId).toBe(user.id);
			expect(participants[0].claimedAt).toBeTruthy();
		});
	});
});
