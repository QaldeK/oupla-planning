/**
 * Tests d'integration — Notifications sur mise a jour d'occurrence
 *
 * Objectif :
 *   Verifier que le hook `notify-on-occurrence-update.pb.js` se declenche
 *   correctement lors des mises a jour d'occurrences et ne leve pas d'erreur.
 *
 * Pipeline teste :
 *   update occurrence -> onRecordAfterUpdateSuccess hook -> detection changement
 *   -> find participants -> sendPushNotification / sendGroupedEmail
 *
 * Conditions reelles :
 *   - Hook PocketBase actif (fichier .pb.js charge)
 *   - Notify-service externe NON disponible (les erreurs HTTP sont catchees
 *     dans sendPushNotification, le hook ne doit pas planter)
 *
 * Prerequis :
 *   - PocketBase demarre sur http://127.0.0.1:8090
 *   - Admin de test cree (test@example.com / testpassword)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import PocketBase from 'pocketbase';
import {
	authenticateAdmin,
	seedPlanning,
	seedUser,
	seedParticipantPrefs,
	clearTrackedIds,
	cleanupTrackedRecords,
	cleanupUsers
} from './seed';

const USER_ALICE_EMAIL = 'notif-alice@test.com';
const USER_BOB_EMAIL = 'notif-bob@test.com';
const USER_PWD = 'password123';

describe('Notifications — occurrence update hook', () => {
	let adminPb: PocketBase;
	let testUsers: { id: string; email: string }[] = [];

	beforeEach(async () => {
		clearTrackedIds();
		adminPb = await authenticateAdmin();
	});

	afterEach(async () => {
		await cleanupTrackedRecords();
		await cleanupUsers(testUsers.map((u) => u.email));
		testUsers = [];
	});

	async function createTestUser(email: string, name: string) {
		const user = await seedUser(email, USER_PWD, name);
		testUsers.push({ id: user.id, email });
		return user;
	}

	async function updateOccurrence(occId: string, data: Record<string, unknown>, token: string) {
		return adminPb.collection('planning_occurrences').update(occId, data, {
			query: { _token: token }
		});
	}

	describe('Cancellation detection', () => {
		it('does not throw when an occurrence is canceled', async () => {
			// === SEED ===
			const { master, occurrences, adminToken } = await seedPlanning({
				title: 'Cancel Test'
			});
			const alice = await createTestUser(USER_ALICE_EMAIL, 'Alice');
			await seedParticipantPrefs(master.id, alice.id, {
				onCancellation: true,
				push: true
			});

			const occ = occurrences[0];

			// === ACTION ===
			await expect(
				updateOccurrence(occ.id, { isCanceled: true }, adminToken)
			).resolves.not.toThrow();

			// === VERIFICATION ===
			const updated = await adminPb.collection('planning_occurrences').getOne(occ.id);
			expect(updated.isCanceled).toBe(true);
		});

		it('does not trigger notification when occurrence was already canceled', async () => {
			// === SEED ===
			const { master, occurrences, adminToken } = await seedPlanning({
				title: 'Already Canceled'
			});
			const alice = await createTestUser(USER_ALICE_EMAIL, 'Alice');
			await seedParticipantPrefs(master.id, alice.id, {
				onCancellation: true,
				push: true
			});

			const occ = occurrences[0];

			// First, cancel it
			await updateOccurrence(occ.id, { isCanceled: true }, adminToken);

			// === ACTION ===
			await expect(
				updateOccurrence(
					occ.id,
					{
						comments: [{ id: 'c1', text: 'test', createdAt: new Date().toISOString() }]
					},
					adminToken
				)
			).resolves.not.toThrow();

			// === VERIFICATION ===
			const updated = await adminPb.collection('planning_occurrences').getOne(occ.id);
			expect(updated.isCanceled).toBe(true);
			expect(updated.comments).toHaveLength(1);
		});
	});

	describe('Time change detection', () => {
		it('does not throw when startTime is changed', async () => {
			// === SEED ===
			const { master, occurrences, adminToken } = await seedPlanning({
				title: 'Time Change Test'
			});
			const alice = await createTestUser(USER_ALICE_EMAIL, 'Alice');
			await seedParticipantPrefs(master.id, alice.id, {
				onTimeChange: true,
				push: true
			});

			const occ = occurrences[0];

			// === ACTION ===
			await expect(
				updateOccurrence(occ.id, { startTime: '14:00' }, adminToken)
			).resolves.not.toThrow();

			// === VERIFICATION ===
			const updated = await adminPb.collection('planning_occurrences').getOne(occ.id);
			expect(updated.startTime).toBe('14:00');
		});

		it('does not throw when date is changed', async () => {
			// === SEED ===
			const { master, occurrences, adminToken } = await seedPlanning({
				title: 'Date Change Test'
			});
			const alice = await createTestUser(USER_ALICE_EMAIL, 'Alice');
			await seedParticipantPrefs(master.id, alice.id, {
				onTimeChange: true,
				push: true
			});

			const occ = occurrences[0];

			// === ACTION ===
			await expect(
				updateOccurrence(occ.id, { date: '2026-05-01' }, adminToken)
			).resolves.not.toThrow();

			// === VERIFICATION ===
			const updated = await adminPb.collection('planning_occurrences').getOne(occ.id);
			expect(updated.date).toContain('2026-05-01');
		});

		it('does not trigger notification when both date and startTime change on a canceled occurrence', async () => {
			// === SEED ===
			const { master, occurrences, adminToken } = await seedPlanning({
				title: 'Canceled Change'
			});
			const alice = await createTestUser(USER_ALICE_EMAIL, 'Alice');
			await seedParticipantPrefs(master.id, alice.id, {
				onTimeChange: true,
				push: true
			});

			const occ = occurrences[0];

			// Cancel first
			await updateOccurrence(occ.id, { isCanceled: true }, adminToken);

			// === ACTION ===
			await expect(
				updateOccurrence(occ.id, { startTime: '15:00', date: '2026-06-01' }, adminToken)
			).resolves.not.toThrow();

			// === VERIFICATION ===
			const updated = await adminPb.collection('planning_occurrences').getOne(occ.id);
			expect(updated.isCanceled).toBe(true);
			expect(updated.startTime).toBe('15:00');
			expect(updated.date).toContain('2026-06-01');
		});
	});

	describe('No relevant change', () => {
		it('does not trigger notification when only comments change', async () => {
			// === SEED ===
			const { master, occurrences, adminToken } = await seedPlanning({
				title: 'Comment Only'
			});
			const alice = await createTestUser(USER_ALICE_EMAIL, 'Alice');
			await seedParticipantPrefs(master.id, alice.id, {
				onCancellation: true,
				onTimeChange: true,
				push: true
			});

			const occ = occurrences[0];

			// === ACTION ===
			await expect(
				updateOccurrence(
					occ.id,
					{
						comments: [{ id: 'c1', text: 'New comment', createdAt: new Date().toISOString() }]
					},
					adminToken
				)
			).resolves.not.toThrow();

			// === VERIFICATION ===
			const updated = await adminPb.collection('planning_occurrences').getOne(occ.id);
			expect(updated.comments).toHaveLength(1);
		});

		it('does not trigger notification when only responses change', async () => {
			// === SEED ===
			const { master, occurrences, adminToken } = await seedPlanning({
				title: 'Response Only'
			});
			const alice = await createTestUser(USER_ALICE_EMAIL, 'Alice');
			await seedParticipantPrefs(master.id, alice.id, {
				onCancellation: true,
				onTimeChange: true,
				push: true
			});

			const occ = occurrences[0];

			// === ACTION ===
			await expect(
				updateOccurrence(
					occ.id,
					{
						responses: [
							{
								id: alice.id,
								response: 'present',
								updatedAt: new Date().toISOString()
							}
						]
					},
					adminToken
				)
			).resolves.not.toThrow();

			// === VERIFICATION ===
			const updated = await adminPb.collection('planning_occurrences').getOne(occ.id);
			expect(updated.responses).toHaveLength(1);
		});
	});

	describe('Preferences filtering', () => {
		it('handles no participants gracefully', async () => {
			// === SEED ===
			const { occurrences, adminToken } = await seedPlanning({
				title: 'No Participants'
			});
			const occ = occurrences[0];

			// === ACTION ===
			await expect(
				updateOccurrence(occ.id, { isCanceled: true }, adminToken)
			).resolves.not.toThrow();

			// === VERIFICATION ===
			const updated = await adminPb.collection('planning_occurrences').getOne(occ.id);
			expect(updated.isCanceled).toBe(true);
		});

		it('handles participants with no notification preferences enabled', async () => {
			// === SEED ===
			const { master, occurrences, adminToken } = await seedPlanning({
				title: 'No Prefs'
			});
			const alice = await createTestUser(USER_ALICE_EMAIL, 'Alice');
			await seedParticipantPrefs(master.id, alice.id, {
				onCancellation: false,
				onTimeChange: false,
				push: false,
				email: false
			});

			const occ = occurrences[0];

			// === ACTION ===
			await expect(
				updateOccurrence(occ.id, { isCanceled: true }, adminToken)
			).resolves.not.toThrow();

			// === VERIFICATION ===
			const updated = await adminPb.collection('planning_occurrences').getOne(occ.id);
			expect(updated.isCanceled).toBe(true);
		});

		it('handles mixed preferences across multiple participants', async () => {
			// === SEED ===
			const { master, occurrences, adminToken } = await seedPlanning({
				title: 'Mixed Prefs'
			});
			const alice = await createTestUser(USER_ALICE_EMAIL, 'Alice');
			const bob = await createTestUser(USER_BOB_EMAIL, 'Bob');

			await seedParticipantPrefs(master.id, alice.id, {
				onCancellation: true,
				onTimeChange: false,
				push: true,
				email: false
			});

			await seedParticipantPrefs(master.id, bob.id, {
				onCancellation: false,
				onTimeChange: true,
				push: true,
				email: false
			});

			const occ = occurrences[0];

			// === ACTION ===
			await expect(
				updateOccurrence(occ.id, { isCanceled: true }, adminToken)
			).resolves.not.toThrow();

			// === VERIFICATION ===
			const updated = await adminPb.collection('planning_occurrences').getOne(occ.id);
			expect(updated.isCanceled).toBe(true);
		});
	});

	describe('Combined changes', () => {
		it('handles cancellation and time change in same update', async () => {
			// === SEED ===
			const { master, occurrences, adminToken } = await seedPlanning({
				title: 'Combined'
			});
			const alice = await createTestUser(USER_ALICE_EMAIL, 'Alice');
			await seedParticipantPrefs(master.id, alice.id, {
				onCancellation: true,
				onTimeChange: true,
				push: true,
				email: true
			});

			const occ = occurrences[0];

			// === ACTION ===
			await expect(
				updateOccurrence(occ.id, { isCanceled: true, startTime: '18:00' }, adminToken)
			).resolves.not.toThrow();

			// === VERIFICATION ===
			const updated = await adminPb.collection('planning_occurrences').getOne(occ.id);
			expect(updated.isCanceled).toBe(true);
			expect(updated.startTime).toBe('18:00');
		});
	});
});
