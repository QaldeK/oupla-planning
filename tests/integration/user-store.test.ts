/**
 * Tests d'integration — userStore, guestStateStore, authTransition : identity, auth, logout
 *
 * Objectif :
 *   Verifier le pipeline de gestion des identites guest et des transitions auth :
 *     guestStateStore.setGuestIdentity() -> Dexie localMeta -> getGuestIdentity()
 *     authTransition.transitionToAuth() -> /api/sync-plannings -> PB + Dexie
 *     resolveCurrentIdentity() -> pbUser ?? guestIdentity
 *     userStore.logout() -> clear Dexie + authStore + planningStore
 *
 * Pipeline teste :
 *   1. Identity management : guestStateStore -> Dexie localMeta -> resolveCurrentIdentity
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
import { guestStateStore } from '$lib/stores/guestStateStore.svelte';
import { authTransition } from '$lib/stores/authTransition.svelte';
import { resolveCurrentIdentity } from '$lib/utils/identityResolution';
import { planningStore } from '$lib/stores/planningStore.svelte';
import { mastersCollection, occurrencesCollection } from '$lib/data/collections';
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
		userStore.appPreferences = { theme: 'my', occurrenceView: 'compact' };
		pb.authStore.clear();
		userStore.isLoggedIn = false;
		mastersCollection.unsubscribeAll();
		occurrencesCollection.unsubscribeAll();

		// guestStateStore.guestStates est désormais un miroir liveQuery : on monte la
		// subscription (idempotente) APRÈS le clear de localMeta pour que la première
		// émission reflète un état vide. Pour les tests suivants (subscription déjà
		// montée), loadGuestState() résout immédiatement — on attend alors la
		// propagation du clear via vi.waitFor.
		await guestStateStore.loadGuestState();
		await vi.waitFor(() => expect(guestStateStore.guestStates).toHaveLength(0));
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
			await guestStateStore.setGuestIdentity(master.id, identity);

			// === VERIFICATION STORE ===
			// La propagation Dexie → $state est désormais liveQuery-driven (async).
			await vi.waitFor(() => {
				expect(guestStateStore.getGuestIdentity(master.id)).toEqual(identity);
			});

			// === VERIFICATION DEXIE localMeta ===
			const dexieEntry = await db.localMeta.get(master.id);
			expect(dexieEntry).toBeDefined();
			expect(dexieEntry!.masterId).toBe(master.id);
			expect(dexieEntry!.currentUser).toEqual(identity);
		});

		it('retourne null pour un planning sans identite', async () => {
			// === SEED : master en Dexie mais pas d'identite dans localMeta ===
			const { master, participantToken: _participantToken } = await seedPlanning({
				title: 'No Identity'
			});

			// === VERIFICATION ===
			expect(guestStateStore.getGuestIdentity(master.id)).toBeNull();
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
			const result = resolveCurrentIdentity({
				isLoggedIn: true,
				pbUser: userStore.pbUser,
				guestIdentity: guestStateStore.getGuestIdentity(master.id),
				participants: []
			});
			expect(result.identity).not.toBeNull();
			expect(result.identity!.id).toBe(user.id);
			expect(result.identity!.name).toBe('Auth User');

			// Cleanup
			pb.authStore.clear();
			userStore.isLoggedIn = false;
		});

		it('priorise pb.authStore sur l identite guest stockee', async () => {
			// === SEED ===
			const { master } = await seedPlanning({ title: 'Priority Test' });

			// Pre-registrer une identite guest dans localMeta
			const guestIdentity: PlanningIdentity = { id: 'guest1', name: 'Guest', email: '' };
			await guestStateStore.setGuestIdentity(master.id, guestIdentity);
			// Attendre la propagation liveQuery vers le $state avant la lecture.
			await vi.waitFor(() => {
				expect(guestStateStore.getGuestIdentity(master.id)).toEqual(guestIdentity);
			});

			// Puis simuler un login
			const user = await seedUser(USER_EMAIL, USER_PWD, 'Auth User', {
				masterIds: [master.id]
			});
			trackIds('users', user.id);

			const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);
			userStore.isLoggedIn = true;

			// === VERIFICATION : auth identity doit primer ===
			const result = resolveCurrentIdentity({
				isLoggedIn: true,
				pbUser: userStore.pbUser,
				guestIdentity: guestStateStore.getGuestIdentity(master.id),
				participants: []
			});
			expect(result.identity!.id).toBe(user.id);
			expect(result.identity!.name).toBe('Auth User');

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
			await guestStateStore.setGuestIdentity(master.id, identity1);

			// === ACTION : mise a jour de l identite ===
			const identity2: PlanningIdentity = {
				id: 'guest1',
				name: 'Alice Updated',
				email: 'alice@test.com'
			};
			await guestStateStore.setGuestIdentity(master.id, identity2);

			// === VERIFICATION ===
			// guestStates est un miroir liveQuery : la propagation est async.
			await vi.waitFor(() => {
				expect(guestStateStore.guestStates).toHaveLength(1);
				expect(guestStateStore.getGuestIdentity(master.id)?.name).toBe('Alice Updated');
			});

			// Dexie coherent
			const dexieEntry = await db.localMeta.get(master.id);
			expect(dexieEntry!.currentUser!.name).toBe('Alice Updated');
		});

		it('setGuestIdentity stocke mais resolveCurrentIdentity priorise l auth', async () => {
			// === SEED ===
			const { master } = await seedPlanning({ title: 'Auth Skip' });

			const user = await seedUser(USER_EMAIL, USER_PWD, 'Auth User');
			trackIds('users', user.id);

			const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);
			userStore.isLoggedIn = true;

			// === ACTION : setGuestIdentity stocke toujours (plus de garde auth) ===
			const guestIdentity: PlanningIdentity = { id: 'guest1', name: 'Guest', email: '' };
			await guestStateStore.setGuestIdentity(master.id, guestIdentity);

			// === VERIFICATION : l identite guest est bien stockee ===
			// (propagation liveQuery async)
			await vi.waitFor(() => {
				expect(guestStateStore.guestStates).toHaveLength(1);
			});

			// Mais resolveCurrentIdentity retourne toujours le user auth
			const result = resolveCurrentIdentity({
				isLoggedIn: true,
				pbUser: userStore.pbUser,
				guestIdentity: guestStateStore.getGuestIdentity(master.id),
				participants: []
			});
			expect(result.identity).not.toBeNull();
			expect(result.identity!.id).toBe(user.id);

			// Cleanup
			pb.authStore.clear();
			userStore.isLoggedIn = false;
		});
	});

	describe('Boot ordering — loadGuestState', () => {
		it('loadGuestState est awaitable et guestStates reflète localMeta après résolution', async () => {
			// Comportement C (boot ordering) : la séquence de boot fait
			// `await guestStateStore.loadGuestState()` AVANT `userStore.init()`
			// (qui branche pb.authStore.onChange, pouvant déclencher la transition).
			// La promesse de loadGuestState résout à la première émission du liveQuery,
			// garantissant que guestStates est peuplé avant qu'un onChange puisse fire.
			//
			// La subscription est montée idempotemment par beforeEach ; ce test valide
			// le contrat apparent du boot : après `await loadGuestState()`, une entrée
			// dans localMeta est reflétée par guestStates (propagation liveQuery).

			// === SEED : une identité guest pré-existante dans localMeta ===
			const identity: PlanningIdentity = { id: 'boot-1', name: 'Boot Guest', email: '' };
			await db.localMeta.put({ masterId: 'boot-master', currentUser: identity });

			// === ACTION ===
			// Idempotente (subscription déjà montée) — dans le boot réel, le premier
			// appel monte la subscription et résout à la première émission.
			await guestStateStore.loadGuestState();

			// === VERIFICATION : guestStates reflète localMeta ===
			await vi.waitFor(() => {
				expect(guestStateStore.getGuestIdentity('boot-master')).toEqual(identity);
			});
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
			// setActiveToken déclenche #activatePlanning (branche guest) qui fetch le master et le met en Dexie.
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
			await authTransition.transitionToAuth();

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
			await authTransition.transitionToAuth();

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
			await guestStateStore.setGuestIdentity(master.id, {
				id: 'guest1',
				name: 'Guest',
				email: ''
			});

			// === AUTH ===
			const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);
			userStore.isLoggedIn = true;

			// === ACTION ===
			await authTransition.transitionToAuth();

			await vi.waitFor(
				async () => {
					const dexieMaster = await db.masters.get(master.id);
					expect(dexieMaster).toBeDefined();
				},
				{ timeout: 5000 }
			);

			// === VERIFICATION : localMeta est vidé par runAuthTransition (étape 5) ===
			// L'identité guest est effacée ; le curseur lastFetchAt n'est pas réécrit
			// ici (step 8 early-return car #activeMasterId déjà master.id).
			const localMetaEntries = await db.localMeta.toArray();
			expect(localMetaEntries).toHaveLength(0);

			// guestStates est vide (miroir liveQuery de localMeta — propagation async)
			await vi.waitFor(() => {
				expect(guestStateStore.guestStates).toHaveLength(0);
			});

			// L'identité pour ce planning est celle du user auth (via pb.authStore)
			const result = resolveCurrentIdentity({
				isLoggedIn: true,
				pbUser: userStore.pbUser,
				guestIdentity: guestStateStore.getGuestIdentity(master.id),
				participants: []
			});
			expect(result.identity).not.toBeNull();
			expect(result.identity!.id).toBe(user.id);

			// Cleanup
			pb.authStore.clear();
			userStore.isLoggedIn = false;
			planningStore.destroy();
		});

		it('préserve un curseur lastFetchAt coexistant après la transition guest→auth', async () => {
			// Garde-fou du contrat de coexistence multi-écrivains sur localMeta
			// (ADR 0009) : guestStateStore (currentUser/hasQuit) et planningStore
			// (lastFetchAt) écrivent des champs distincts via patch partiel.
			// Après une transition guest→auth, l'identité guest est effacée
			// (runAuthTransition étape 5), mais un curseur lastFetchAt écrit
			// ultérieurement (markFetched, lors d'une activation/delta-sync) doit
			// coexister avec un guestStates sans identité guest.

			// === SEED ===
			const { master, participantToken } = await seedPlanning({ title: 'Cursor Survival' });
			const user = await seedUser(USER_EMAIL, USER_PWD, 'Cursor User');
			trackIds('users', user.id);

			await planningStore.setActiveToken(participantToken);
			await guestStateStore.setGuestIdentity(master.id, {
				id: 'guest-cursor',
				name: 'Cursor Guest',
				email: ''
			});

			// === AUTH + TRANSITION ===
			const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);
			userStore.isLoggedIn = true;

			await authTransition.transitionToAuth();
			await vi.waitFor(
				async () => {
					const dexieMaster = await db.masters.get(master.id);
					expect(dexieMaster).toBeDefined();
				},
				{ timeout: 5000 }
			);

			// === VERIFICATION 1 : l'identité guest a été effacée par la transition ===
			await vi.waitFor(() => {
				expect(guestStateStore.getGuestIdentity(master.id)).toBeNull();
			});

			// === ACTION : écrire le curseur post-transition ===
			// Modélise markFetched lors de la prochaine activation/delta-sync —
			// l'étape qui, dans l'app réelle, suit immédiatement la transition.
			await planningStore.markFetched(master.id);

			// === VERIFICATION 2 : le curseur survit dans localMeta ===
			const meta = await db.localMeta.get(master.id);
			expect(meta).toBeDefined();
			expect(meta!.lastFetchAt).toBeDefined();
			// Patch partiel : l'identité guest n'est PAS restaurée par markFetched
			expect(meta!.currentUser).toBeUndefined();

			// === VERIFICATION 3 : guestStates reflète localMeta (miroir liveQuery) ===
			// Le miroir montre l'entrée curseur SANS identité guest : pas d'identité
			// fantôme, coexistence correcte avec le champ de planningStore.
			await vi.waitFor(() => {
				expect(guestStateStore.getGuestIdentity(master.id)).toBeNull();
				const entry = guestStateStore.guestStates.find((p) => p.masterId === master.id);
				expect(entry).toBeDefined();
				expect(entry!.lastFetchAt).toBeDefined();
				expect(entry!.currentUser).toBeUndefined();
			});

			// Cleanup
			pb.authStore.clear();
			userStore.isLoggedIn = false;
			planningStore.destroy();
		});
	});

	// ============================================
	// Reactive liveQuery global — bug logout -> login
	// ============================================
	// planningStore.initGlobalSync() souscrit au liveQuery Dexie qui alimente
	// #allMasters (lu par sidebar + homepage). userStore.logout() détruit ce
	// liveQuery via planningStore.destroy(). Si onAuthTransition() ne le
	// réactive pas, les masters fetchés en Dexie ne sont jamais propagés à
	// l'UI — d'où le bug "homepage/sidebar vides après re-login sans reload".

	describe('Reactive liveQuery after destroy() (logout -> login)', () => {
		it('propage les masters a activeMasters meme si le liveQuery a ete detruit avant', async () => {
			// === SEED ===
			// User existant AVEC masterId déjà populated côté serveur.
			// Simule un compte qui reconnecte (pas un guest qui claim).
			const { master } = await seedPlanning({ title: 'Re-Login Master' });
			const user = await seedUser(USER_EMAIL, USER_PWD, 'Re-Login User', {
				masterIds: [master.id]
			});
			trackIds('users', user.id);

			// === PRECONDITION ===
			// beforeEach a appelé planningStore.destroy() → #allMastersSub est null,
			// #allMasters est []. C'est l'état laissé par userStore.logout() :
			// le liveQuery global est désactivé.
			expect(planningStore.activeMasters).toHaveLength(0);

			// === AUTH (simule login depuis homepage /) ===
			// Pas de setActiveToken → currentToken reste null (CAS homepage).
			const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
			pb.authStore.save(userPb.authStore.token, userPb.authStore.record);
			userStore.isLoggedIn = true;

			// === ACTION ===
			await authTransition.transitionToAuth();

			// === VERIFICATION DEXIE ===
			// Masters chargés en Dexie via initialFetch (API Rule filtre par user.masterId).
			await vi.waitFor(
				async () => {
					const dexieMaster = await db.masters.get(master.id);
					expect(dexieMaster).toBeDefined();
					expect(dexieMaster!.title).toBe('Re-Login Master');
				},
				{ timeout: 5000 }
			);

			// === VERIFICATION STORE (le bug) ===
			// planningStore.activeMasters dépend de #allMasters via le liveQuery global.
			// Sans initGlobalSync() dans onAuthTransition, le liveQuery reste désactivé
			// et activeMasters reste [] même si Dexie est rempli.
			await vi.waitFor(
				() => {
					expect(planningStore.activeMasters.length).toBe(1);
					expect(planningStore.activeMasters[0].id).toBe(master.id);
					expect(planningStore.activeMasters[0].title).toBe('Re-Login Master');
				},
				{ timeout: 5000 }
			);

			// === VERIFICATION POCKETBASE (cohérence croisée) ===
			const adminPb = await authenticateAdmin();
			const pbMaster = await adminPb.collection('planning_masters').getOne(master.id);
			expect(pbMaster.title).toBe('Re-Login Master');

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
			await guestStateStore.setGuestIdentity(master.id, {
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
			expect(pb.authStore.isValid).toBe(false);

			const dexieMasters = await db.masters.toArray();
			expect(dexieMasters).toHaveLength(0);

			const dexieOccurrences = await db.occurrences.toArray();
			expect(dexieOccurrences).toHaveLength(0);

			const dexieLocalMeta = await db.localMeta.toArray();
			expect(dexieLocalMeta).toHaveLength(0);

			const dexieCommentState = await db.commentState.toArray();
			expect(dexieCommentState).toHaveLength(0);

			// guestStates (miroir liveQuery) reflète le clear de localMeta fait par
			// userStore.#clearLocalDexie — reset automatique, sans appel explicite
			// à une méthode de reset (clearGuestState a été supprimée).
			await vi.waitFor(() => {
				expect(guestStateStore.guestStates).toHaveLength(0);
			});
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
