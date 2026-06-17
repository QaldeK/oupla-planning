/**
 * Tests d'integration — userStore : identity, auth transitions, logout
 *
 * Objectif :
 *   Verifier le pipeline de gestion des identites guest et des transitions auth :
 *     userStore.setPlanningIdentity() -> Dexie localMeta -> getIdentityForPlanning()
 *     userStore.onAuthTransition() -> /api/sync-plannings -> PB + Dexie
 *     userStore.logout() -> clear Dexie + authStore + planningStore
 *
 * Pipeline teste :
 *   1. Identity management : setPlanningIdentity -> Dexie localMeta -> getIdentityForPlanning
 *   2. Auth transition : guest -> /api/sync-plannings -> PB masterId update -> Dexie masters
 *   3. Logout : action -> clear Dexie + authStore + planningStore
 *
 * Conditions reelles :
 *   - Dexie localMeta persiste les identites guest ({ masterId, currentUser? })
 *   - Auth transition utilise /api/sync-plannings (endpoint custom PB)
 *   - onRecordEnrich masque adminToken pour les non-admins
 *
 * Prerequis :
 *   - PocketBase demarre sur http://127.0.0.1:8090
 *   - Admin de test cree (test@example.com / testpassword)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
import { userStore } from '$lib/stores/userStore.svelte';
import {
	planningStore,
	mastersCollection,
	occurrencesCollection
} from '$lib/stores/planningStore.svelte';
import { pb } from '$lib/pocketbase/pb';
import type { PlanningIdentity } from '$lib/types/planning.types';

const USER_EMAIL = 'userstore-test@test.com';
const USER_PWD = 'password123';

describe('userStore — identity, auth transitions, logout', () => {
	beforeEach(async () => {
		clearTrackedIds();
		await db.masters.clear();
		await db.occurrences.clear();
		await db.localMeta.clear();
		await db.commentState.clear();

		planningStore.destroy();
		userStore.savedPlannings = [];
		userStore.appPreferences = { theme: 'my', occurrenceView: 'compact' };
		pb.authStore.clear();
		userStore.isLoggedIn = false;
		mastersCollection.unsubscribeAll();
		occurrencesCollection.unsubscribeAll();
	});

	afterEach(async () => {
		mastersCollection.unsubscribeAll();
		occurrencesCollection.unsubscribeAll();
		await cleanupTrackedRecords();
		await cleanupUsers([USER_EMAIL]);
	});

	// ============================================
	// Identity management
	// ============================================

	describe('Planning identity', () => {
		it('definit et recupere l identite d un participant guest', async () => {
			// === SEED ===
			const { master } = await seedPlanning({ title: 'Identity Test' });

			// === ACTION ===
			const identity: PlanningIdentity = {
				id: 'guest123',
				name: 'Alice',
				email: 'alice@test.com'
			};
			await userStore.setPlanningIdentity(master.id, identity);

			// === VERIFICATION STORE ===
			const retrieved = userStore.getIdentityForPlanning(master.id);
			expect(retrieved).toEqual(identity);

			// === VERIFICATION DEXIE localMeta ===
			const dexieEntry = await db.localMeta.get(master.id);
			expect(dexieEntry).toBeDefined();
			expect(dexieEntry!.masterId).toBe(master.id);
			expect(dexieEntry!.currentUser).toEqual(identity);
		});

		it('retourne null pour un planning sans identite', async () => {
			// === SEED : master en Dexie mais pas d'identite dans localMeta ===
			const { master, participantToken } = await seedPlanning({ title: 'No Identity' });

			// === VERIFICATION ===
			expect(userStore.getIdentityForPlanning(master.id)).toBeNull();
		});

		it('retourne l identite du user auth quand isLoggedIn', async () => {
			// === SEED ===
			const { master } = await seedPlanning({ title: 'Auth Identity' });

			const user = await seedUser(USER_EMAIL, USER_PWD, 'Auth User', {
				masterIds: [master.id]
			});
			trackIds('users', user.id);

			const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);
			userStore.isLoggedIn = true;

			// === ACTION + VERIFICATION ===
			const identity = userStore.getIdentityForPlanning(master.id);
			expect(identity).not.toBeNull();
			expect(identity!.id).toBe(user.id);
			expect(identity!.name).toBe('Auth User');

			// Cleanup
			pb.authStore.clear();
			userStore.isLoggedIn = false;
		});

		it('priorise pb.authStore sur savedPlanning.currentUser', async () => {
			// === SEED ===
			const { master } = await seedPlanning({ title: 'Priority Test' });

			// Pre-registrer une identite guest dans localMeta
			const guestIdentity: PlanningIdentity = { id: 'guest1', name: 'Guest', email: '' };
			await userStore.setPlanningIdentity(master.id, guestIdentity);

			// Puis simuler un login
			const user = await seedUser(USER_EMAIL, USER_PWD, 'Auth User', {
				masterIds: [master.id]
			});
			trackIds('users', user.id);

			const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);
			userStore.isLoggedIn = true;

			// === VERIFICATION : auth identity doit primer ===
			const identity = userStore.getIdentityForPlanning(master.id);
			expect(identity!.id).toBe(user.id);
			expect(identity!.name).toBe('Auth User');

			// Cleanup
			pb.authStore.clear();
			userStore.isLoggedIn = false;
		});

		it('met a jour l identite existante sans creer de doublon', async () => {
			// === SEED ===
			const { master } = await seedPlanning({ title: 'Update Identity' });

			const identity1: PlanningIdentity = {
				id: 'guest1',
				name: 'Alice',
				email: 'alice@test.com'
			};
			await userStore.setPlanningIdentity(master.id, identity1);

			// === ACTION : mise a jour de l identite ===
			const identity2: PlanningIdentity = {
				id: 'guest1',
				name: 'Alice Updated',
				email: 'alice@test.com'
			};
			await userStore.setPlanningIdentity(master.id, identity2);

			// === VERIFICATION ===
			expect(userStore.savedPlannings).toHaveLength(1);
			const retrieved = userStore.getIdentityForPlanning(master.id);
			expect(retrieved!.name).toBe('Alice Updated');

			// Dexie coherent
			const dexieEntry = await db.localMeta.get(master.id);
			expect(dexieEntry!.currentUser!.name).toBe('Alice Updated');
		});

		it('removeIdentity supprime l identite du store et de Dexie', async () => {
			// === SEED ===
			const { master } = await seedPlanning({ title: 'Remove Identity' });

			const identity: PlanningIdentity = { id: 'guest1', name: 'Bob', email: '' };
			await userStore.setPlanningIdentity(master.id, identity);

			// === ACTION ===
			await userStore.removeIdentity(master.id);

			// === VERIFICATION ===
			expect(userStore.savedPlannings).toHaveLength(0);
			expect(userStore.getIdentityForPlanning(master.id)).toBeNull();

			const dexieEntry = await db.localMeta.get(master.id);
			expect(dexieEntry).toBeUndefined();
		});

		it('setPlanningIdentity ne fait rien si l utilisateur est connecte', async () => {
			// === SEED ===
			const { master } = await seedPlanning({ title: 'Auth Skip' });

			const user = await seedUser(USER_EMAIL, USER_PWD, 'Auth User');
			trackIds('users', user.id);

			const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);
			userStore.isLoggedIn = true;

			// === ACTION : setPlanningIdentity ne doit rien faire ===
			const guestIdentity: PlanningIdentity = { id: 'guest1', name: 'Guest', email: '' };
			await userStore.setPlanningIdentity(master.id, guestIdentity);

			// === VERIFICATION : pas d'entree dans savedPlannings ===
			expect(userStore.savedPlannings).toHaveLength(0);

			// L'identite retournee est celle de l'auth (getIdentityForPlanning
			// retourne toujours le user auth quand isLoggedIn, quel que soit le masterId)
			const identity = userStore.getIdentityForPlanning(master.id);
			expect(identity).not.toBeNull();
			expect(identity!.id).toBe(user.id);

			// Cleanup
			pb.authStore.clear();
			userStore.isLoggedIn = false;
		});
	});

	// ============================================
	// Auth transition — guest → auth
	// ============================================

	describe('Auth transition — guest to auth', () => {
		it('sync le planning courant vers PB via /api/sync-plannings (CAS 1 : sur /p/[token])', async () => {
			// === SEED ===
			const { master, participantToken } = await seedPlanning({
				title: 'Transition Test',
				occurrenceCount: 2
			});

			// User SANS masterIds — c'est /api/sync-plannings qui doit le peupler
			const user = await seedUser(USER_EMAIL, USER_PWD, 'Transition User');
			trackIds('users', user.id);

			// Simuler une session guest sur /p/[token] :
			// setActiveToken déclenche #setActiveGuest qui fetch le master et le met en Dexie.
			await planningStore.setActiveToken(participantToken);

			// Pré-requis : master en Dexie + currentToken positionné
			expect(planningStore.currentToken).toBe(participantToken);
			const preDexieMaster = await db.masters.get(master.id);
			expect(preDexieMaster).toBeDefined();

			// === AUTH (simule login) ===
			const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);
			userStore.isLoggedIn = true;

			// === ACTION ===
			await userStore.onAuthTransition();

			// Attendre que la sync complète : Dexie clearé puis re-rempli via initialFetch
			await vi.waitFor(
				async () => {
					const dexieMaster = await db.masters.get(master.id);
					expect(dexieMaster).toBeDefined();
					expect(dexieMaster!.title).toBe('Transition Test');
				},
				{ timeout: 5000 }
			);

			// === VERIFICATION DEXIE ===
			const dexieMaster = await db.masters.get(master.id);
			expect(dexieMaster).toBeDefined();
			expect(dexieMaster!.title).toBe('Transition Test');

			const dexieOccurrences = await db.occurrences.where('master').equals(master.id).toArray();
			expect(dexieOccurrences).toHaveLength(2);

			// === VERIFICATION POCKETBASE ===
			// user.masterId doit contenir master.id VIA LE VRAI ENDPOINT /api/sync-plannings
			// (pas de pré-remplissage artificiel dans le seed)
			const adminPb = await authenticateAdmin();
			const pbUser = await adminPb.collection('users').getOne(user.id);
			expect(pbUser.masterId).toContain(master.id);

			// Cohérence croisée : timestamps à jour entre Dexie et PB
			const pbMaster = await adminPb.collection('planning_masters').getOne(master.id);
			expect(pbMaster.title).toBe('Transition Test');
			expect(dexieMaster!.updated).toBe(pbMaster.updated);

			// Cleanup
			pb.authStore.clear();
			userStore.isLoggedIn = false;
			planningStore.destroy();
		});

		it('ne sync rien si pas de planning actif (CAS 2 : sur homepage /)', async () => {
			// === SEED ===
			const { master } = await seedPlanning({
				title: 'Homepage Login',
				occurrenceCount: 2
			});

			// User SANS masterIds
			const user = await seedUser(USER_EMAIL, USER_PWD, 'Homepage User');
			trackIds('users', user.id);

			// IMPORTANT : ne pas appeler setActiveToken → simule la homepage /
			expect(planningStore.currentToken).toBeNull();

			// Placer quand même un master en Dexie (simule un cache résiduel
			// d'un précédent guest sur ce terminal partagé)
			await db.masters.put({ ...master });
			expect(await db.masters.toArray()).toHaveLength(1);

			// === AUTH (simule login depuis /) ===
			const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);
			userStore.isLoggedIn = true;

			// === ACTION ===
			await userStore.onAuthTransition();

			// === VERIFICATION POCKETBASE ===
			// user.masterId doit rester VIDE — aucun token n'a été sync
			const adminPb = await authenticateAdmin();
			const pbUser = await adminPb.collection('users').getOne(user.id);
			expect(pbUser.masterId).toEqual([]);

			// === VERIFICATION DEXIE ===
			// Le master résiduel a été clearé, et comme user.masterId est vide,
			// initialFetch() retourne 0 → Dexie reste vide.
			const dexieMasters = await db.masters.toArray();
			expect(dexieMasters).toHaveLength(0);

			const dexieOccurrences = await db.occurrences.toArray();
			expect(dexieOccurrences).toHaveLength(0);

			// === VERIFICATION PLANNING STORE ===
			// currentToken doit rester null (pas de token actif, et pas de re-setActiveToken)
			expect(planningStore.currentToken).toBeNull();

			// Cleanup
			pb.authStore.clear();
			userStore.isLoggedIn = false;
			planningStore.destroy();
		});

		it('nettoie les identites guest lors de la transition', async () => {
			// === SEED ===
			const { master, participantToken } = await seedPlanning({ title: 'Clear Identity' });

			// User SANS masterIds
			const user = await seedUser(USER_EMAIL, USER_PWD, 'Clear User');
			trackIds('users', user.id);

			// Simuler guest sur /p/[token] (pré-requis pour que la sync fonctionne)
			await planningStore.setActiveToken(participantToken);

			// Identité guest dans localMeta
			await userStore.setPlanningIdentity(master.id, {
				id: 'guest1',
				name: 'Guest',
				email: ''
			});

			// === AUTH ===
			const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);
			userStore.isLoggedIn = true;

			// === ACTION ===
			await userStore.onAuthTransition();

			await vi.waitFor(
				async () => {
					const dexieMaster = await db.masters.get(master.id);
					expect(dexieMaster).toBeDefined();
				},
				{ timeout: 5000 }
			);

			// === VERIFICATION : localMeta est vide (identités guest effacées) ===
			const localMetaEntries = await db.localMeta.toArray();
			expect(localMetaEntries).toHaveLength(0);

			// savedPlannings est vide
			expect(userStore.savedPlannings).toHaveLength(0);

			// L'identité pour ce planning est celle du user auth (via pb.authStore)
			const identity = userStore.getIdentityForPlanning(master.id);
			expect(identity).not.toBeNull();
			expect(identity!.id).toBe(user.id);

			// Cleanup
			pb.authStore.clear();
			userStore.isLoggedIn = false;
			planningStore.destroy();
		});
	});

	// ============================================
	// Logout
	// ============================================

	describe('Logout', () => {
		it('vide tous les stores et Dexie', async () => {
			// === SEED ===
			const { master } = await seedPlanning({ title: 'Logout Test' });

			// Identite dans localMeta
			await userStore.setPlanningIdentity(master.id, {
				id: 'guest1',
				name: 'Guest',
				email: ''
			});

			// Master en Dexie
			await db.masters.put({ ...master });

			// Simuler un etat auth
			pb.authStore.save('fake-token', { id: 'user1', email: 'test@test.com' } as any);
			userStore.isLoggedIn = true;

			// === ACTION ===
			await userStore.logout();

			// === VERIFICATION ===
			expect(userStore.savedPlannings).toHaveLength(0);
			expect(pb.authStore.isValid).toBe(false);

			const dexieMasters = await db.masters.toArray();
			expect(dexieMasters).toHaveLength(0);

			const dexieOccurrences = await db.occurrences.toArray();
			expect(dexieOccurrences).toHaveLength(0);

			const dexieLocalMeta = await db.localMeta.toArray();
			expect(dexieLocalMeta).toHaveLength(0);

			const dexieCommentState = await db.commentState.toArray();
			expect(dexieCommentState).toHaveLength(0);
		});
	});

	// ============================================
	// pbUser getter
	// ============================================

	describe('pbUser getter', () => {
		it('retourne null quand non authentifie', () => {
			pb.authStore.clear();
			expect(userStore.pbUser).toBeNull();
		});

		it('retourne les infos du user quand authentifie', async () => {
			// === SEED ===
			const user = await seedUser(USER_EMAIL, USER_PWD, 'PB User');
			trackIds('users', user.id);

			const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);

			// === VERIFICATION ===
			expect(userStore.pbUser).not.toBeNull();
			expect(userStore.pbUser!.id).toBe(user.id);
			expect(userStore.pbUser!.name).toBe('PB User');
			expect(userStore.pbUser!.email).toBe(USER_EMAIL);

			// Cleanup
			pb.authStore.clear();
		});
	});
});
