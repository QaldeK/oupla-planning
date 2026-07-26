/**
 * Tests d'intégration — Delta sync per-master des occurrences
 *
 * Objectif :
 *   Vérifier le correctif du bug "occurrences manquantes à l'activation d'un planning"
 *   causé par un `since` global incohérent avec un filtre `master = X`.
 *
 * Ce que ça teste :
 *   1. initialFetch accepte un `since` explicite (InitialFetchOptions) et l'utilise
 *   2. initialFetch sans `since` conserve le comportement par défaut (delta sync globale)
 *   3. planningStore : un cache partiel d'un master n'empêche pas le fetch complet
 *      d'un autre master (le bug original)
 *   4. planningStore : re-navigation vers un master déjà fetché préserve les occurrences
 *   5. planningStore : lastFetchAt est écrit dans localMeta après un fetch
 *   6. planningStore (auth) : corrige le bug occCount === 0 (cache partiel → re-fetch)
 *
 * Scénario clé (bug original) :
 *   - Cache Dexie contient une occ de P1 avec updated futur (simule realtime sub)
 *   - Naviguer vers P2 → toutes les occ de P2 récupérées (lastFetchAt[P2] absent → epoch)
 *   - Naviguer vers P1 → toutes les occ de P1 récupérées (lastFetchAt[P1] absent → epoch)
 *   Avant le fix : since global = 2030 (occ P1) appliqué à P2 → 0 occ récupérées.
 *
 * Prérequis :
 *   - PocketBase démarré sur http://127.0.0.1:8090
 *   - Admin de test créé (test@example.com / testpassword)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	seedPlanning,
	seedUser,
	authenticateUser,
	clearTrackedIds,
	cleanupTrackedRecords,
	cleanupUsers,
	trackIds
} from './seed';
import { db } from '$lib/pb-sync/db';
import { pb } from '$lib/pocketbase/pb';
import { createSyncCollection } from '$lib/pb-sync/collection';
import { planningStore } from '$lib/stores/planningStore.svelte';
import { mastersCollection, occurrencesCollection } from '$lib/data/collections';
import { userStore } from '$lib/stores/userStore.svelte';
import { guestStateStore } from '$lib/stores/guestStateStore.svelte';
import type { PlanningOccurrence } from '$lib/types/planning.types';

describe('initialFetch — paramètre since explicite', () => {
	beforeEach(async () => {
		clearTrackedIds();
		await db.masters.clear();
		await db.occurrences.clear();
	});

	afterEach(async () => {
		await cleanupTrackedRecords();
	});

	it('utilise le since explicite fourni (filtre updated > since)', async () => {
		const collection = createSyncCollection<PlanningOccurrence>(
			pb,
			db.occurrences,
			'planning_occurrences'
		);

		const { participantToken } = await seedPlanning({
			title: 'P since explicite',
			occurrenceCount: 2
		});

		// since futur → ne doit rien récupérer
		await collection.initialFetch({
			filter: ['master != ""', {}],
			query: { _token: participantToken },
			since: '2030-01-01 00:00:00.000Z'
		});
		expect(await db.occurrences.count()).toBe(0);

		// since epoch → récupère tout
		await collection.initialFetch({
			query: { _token: participantToken },
			since: '2000-01-01 00:00:00'
		});
		expect(await db.occurrences.count()).toBe(2);
	});

	it('sans since : conserve le comportement par défaut (delta sync globale)', async () => {
		const collection = createSyncCollection<PlanningOccurrence>(
			pb,
			db.occurrences,
			'planning_occurrences'
		);

		const { participantToken } = await seedPlanning({ title: 'P sans since', occurrenceCount: 2 });

		// Premier fetch (table Dexie vide → since = epoch par défaut)
		await collection.initialFetch({
			filter: ['master != ""', {}],
			query: { _token: participantToken }
		});
		expect(await db.occurrences.count()).toBe(2);
	});
});

describe('planningStore — delta sync per-master (bug original)', () => {
	beforeEach(async () => {
		clearTrackedIds();
		await db.masters.clear();
		await db.occurrences.clear();
		await db.localMeta.clear();
		await db.commentState.clear();

		planningStore.destroy();
	});

	afterEach(async () => {
		mastersCollection.unsubscribeAll();
		occurrencesCollection.unsubscribeAll();
		await cleanupTrackedRecords();
	});

	it('cache partiel avec occ très récente n empêche pas le fetch complet d un autre master', async () => {
		// === SEED : P1 (3 occ) et P2 (3 occ) ===
		const {
			master: m1,
			occurrences: occs1,
			participantToken: token1
		} = await seedPlanning({
			title: 'P1',
			occurrenceCount: 3
		});
		const { master: m2, participantToken: token2 } = await seedPlanning({
			title: 'P2',
			occurrenceCount: 3
		});

		// === SIMULATION cache partiel ===
		// Une occ de P1 avec updated futur (simule une realtime sub précédente).
		// Avant le fix : since global = 2030, appliqué à P2 → 0 occ récupérées (bug).
		await db.occurrences.put({
			...occs1[0],
			updated: '2030-01-01 00:00:00.000Z'
		} as PlanningOccurrence);

		// === ACTION : naviguer vers P2 (jamais fetché → lastFetchAt[P2] absent → epoch) ===
		await planningStore.setActiveToken(token2);
		await vi.waitFor(
			() => {
				expect(planningStore.occurrences.length).toBe(3);
			},
			{ timeout: 3000 }
		);

		// === VÉRIFICATION : TOUTES les occ de P2 récupérées malgré l'occ 2030 de P1 en cache ===
		expect(planningStore.activeMasterId).toBe(m2.id);
		expect(planningStore.occurrences.length).toBe(3);

		const dexieOccP2 = await db.occurrences.where('master').equals(m2.id).toArray();
		expect(dexieOccP2.length).toBe(3);

		// === ACTION : naviguer vers P1 (jamais fetché via planningStore → lastFetchAt[P1] absent) ===
		planningStore.invalidateActiveToken();
		await planningStore.setActiveToken(token1);
		await vi.waitFor(
			() => {
				expect(planningStore.occurrences.length).toBe(3);
			},
			{ timeout: 3000 }
		);

		// === VÉRIFICATION : les 3 occ de P1 sont là (le cache partiel 2030 n a pas bloqué) ===
		expect(planningStore.activeMasterId).toBe(m1.id);
		expect(planningStore.occurrences.length).toBe(3);

		const dexieOccP1 = await db.occurrences.where('master').equals(m1.id).toArray();
		expect(dexieOccP1.length).toBe(3);
	});

	it('re-navigation vers un master déjà fetché préserve ses occurrences', async () => {
		// === SEED ===
		const { participantToken: token1 } = await seedPlanning({
			title: 'P1 retour',
			occurrenceCount: 3
		});
		const { master: m2, participantToken: token2 } = await seedPlanning({
			title: 'P2 retour',
			occurrenceCount: 3
		});

		// === ÉTAPE 1 : charger P1 ===
		await planningStore.setActiveToken(token1);
		await vi.waitFor(() => expect(planningStore.occurrences.length).toBe(3));

		// === ÉTAPE 2 : charger P2 ===
		await planningStore.setActiveToken(token2);
		await vi.waitFor(() => expect(planningStore.occurrences.length).toBe(3));
		expect(planningStore.activeMasterId).toBe(m2.id);

		// === ÉTAPE 3 : revenir à P1 (delta sync, since = lastFetchAt[P1]) ===
		planningStore.invalidateActiveToken();
		await planningStore.setActiveToken(token1);
		await vi.waitFor(() => expect(planningStore.occurrences.length).toBe(3));

		// Les occ de P1 sont toujours là (pas effacées par la navigation vers P2)
		expect(planningStore.occurrences.length).toBe(3);
	});

	it('écrit lastFetchAt dans localMeta après un fetch', async () => {
		const { master, participantToken } = await seedPlanning({
			title: 'P lastFetchAt',
			occurrenceCount: 2
		});

		await planningStore.setActiveToken(participantToken);
		await vi.waitFor(() => expect(planningStore.occurrences.length).toBe(2));

		// === VÉRIFICATION : lastFetchAt écrit pour ce master ===
		const meta = await db.localMeta.get(master.id);
		expect(meta).toBeDefined();
		expect(meta!.lastFetchAt).toBeDefined();
		// Format ISO UTC
		expect(meta!.lastFetchAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
	});

	it('préserve lastFetchAt après setGuestIdentity (régression I1)', async () => {
		// Régression : avant le fix, #markFetched écrivait dans Dexie sans synchroniser
		// userStore.savedPlannings. Quand le guest s'identifiait ensuite,
		// setPlanningIdentity faisait bulkPut(savedPlannings) qui écrasait lastFetchAt.
		// setGuestIdentity écrit seulement localMeta.currentUser, pas lastFetchAt.
		const { master, participantToken } = await seedPlanning({
			title: 'P régression I1',
			occurrenceCount: 2
		});

		// === ÉTAPE 1 : guest active le planning → #markFetched écrit lastFetchAt ===
		await planningStore.setActiveToken(participantToken);
		await vi.waitFor(() => expect(planningStore.occurrences.length).toBe(2));

		const metaAvant = await db.localMeta.get(master.id);
		expect(metaAvant?.lastFetchAt).toBeDefined();
		const tsAvant = metaAvant!.lastFetchAt!;

		// === ÉTAPE 2 : guest s'identifie (flux guest first-visit) ===
		await guestStateStore.setGuestIdentity(master.id, {
			id: 'guest-1',
			name: 'Alice'
		});

		// === VÉRIFICATION : lastFetchAt PRÉSERVÉ (pas écrasé) ===
		const metaApres = await db.localMeta.get(master.id);
		expect(metaApres).toBeDefined();
		expect(metaApres!.lastFetchAt).toBe(tsAvant);
		expect(metaApres!.currentUser?.name).toBe('Alice');
	});
});

describe('planningStore — markFetched coexistence with guestStateStore (AC 03)', () => {
	beforeEach(async () => {
		clearTrackedIds();
		await db.masters.clear();
		await db.occurrences.clear();
		await db.localMeta.clear();
		await db.commentState.clear();

		planningStore.destroy();
	});

	afterEach(async () => {
		mastersCollection.unsubscribeAll();
		occurrencesCollection.unsubscribeAll();
		await cleanupTrackedRecords();
	});

	it('planningStore.markFetched preserves currentUser and hasQuit set by guestStateStore', async () => {
		// === SEED : planning with 2 occurrences ===
		const { master, participantToken } = await seedPlanning({
			title: 'P coexistence',
			occurrenceCount: 2
		});

		// === ÉTAPE 1 : guest activates planning → lastFetchAt written via setActiveToken ===
		await planningStore.setActiveToken(participantToken);
		await vi.waitFor(() => expect(planningStore.occurrences.length).toBe(2));

		// === ÉTAPE 2 : guest identifies → sets currentUser via guestStateStore ===
		await guestStateStore.setGuestIdentity(master.id, {
			id: 'guest-coexist',
			name: 'Coexist User'
		});

		// === ÉTAPE 3 : guest marks quit ===
		await guestStateStore.markGuestQuit(master.id);

		// === VÉRIFICATION intermédiaire : both fields present ===
		const metaMid = await db.localMeta.get(master.id);
		expect(metaMid).toBeDefined();
		expect(metaMid!.currentUser?.name).toBe('Coexist User');
		expect(metaMid!.hasQuit).toBe(true);
		expect(metaMid!.lastFetchAt).toBeDefined();
		const tsBefore = metaMid!.lastFetchAt!;

		// === ÉTAPE 4 : planningStore.markFetched writes lastFetchAt via partial update ===
		// This is the critical assertion: markFetched must NOT overwrite currentUser/hasQuit
		await planningStore.markFetched(master.id);

		// === VÉRIFICATION : lastFetchAt updated, currentUser + hasQuit preserved ===
		const metaAfter = await db.localMeta.get(master.id);
		expect(metaAfter).toBeDefined();
		expect(metaAfter!.lastFetchAt).toBeDefined();
		expect(metaAfter!.lastFetchAt).not.toBe(tsBefore); // updated
		expect(metaAfter!.currentUser?.name).toBe('Coexist User'); // preserved
		expect(metaAfter!.currentUser?.id).toBe('guest-coexist'); // preserved
		expect(metaAfter!.hasQuit).toBe(true); // preserved
	});

	it('planningStore.restoreLastFetchAt preserves currentUser and hasQuit', async () => {
		// === SEED ===
		const { master, participantToken } = await seedPlanning({
			title: 'P restore coexist',
			occurrenceCount: 2
		});

		// === ÉTAPE 1 : activate + identify + quit ===
		await planningStore.setActiveToken(participantToken);
		await vi.waitFor(() => expect(planningStore.occurrences.length).toBe(2));

		await guestStateStore.setGuestIdentity(master.id, {
			id: 'guest-restore',
			name: 'Restore User'
		});
		await guestStateStore.markGuestQuit(master.id);

		// === ÉTAPE 2 : markFetched writes lastFetchAt ===
		await planningStore.markFetched(master.id);
		const metaMid = await db.localMeta.get(master.id);
		const tsFetched = metaMid!.lastFetchAt!;

		// === ÉTAPE 3 : restoreLastFetchAt to a previous value ===
		const previousValue = '2020-01-01T00:00:00.000Z';
		await planningStore.restoreLastFetchAt(master.id, previousValue);

		// === VÉRIFICATION : lastFetchAt restored, currentUser + hasQuit preserved ===
		const metaAfter = await db.localMeta.get(master.id);
		expect(metaAfter).toBeDefined();
		expect(metaAfter!.lastFetchAt).toBe(previousValue);
		expect(metaAfter!.lastFetchAt).not.toBe(tsFetched);
		expect(metaAfter!.currentUser?.name).toBe('Restore User'); // preserved
		expect(metaAfter!.hasQuit).toBe(true); // preserved
	});

	it('planningStore.restoreLastFetchAt(null) clears lastFetchAt, preserves other fields', async () => {
		// === SEED ===
		const { master, participantToken } = await seedPlanning({
			title: 'P restore null',
			occurrenceCount: 2
		});

		// === ÉTAPE 1 : activate + identify ===
		await planningStore.setActiveToken(participantToken);
		await vi.waitFor(() => expect(planningStore.occurrences.length).toBe(2));

		await guestStateStore.setGuestIdentity(master.id, {
			id: 'guest-null',
			name: 'Null User'
		});

		// === ÉTAPE 2 : markFetched ===
		await planningStore.markFetched(master.id);

		// === ÉTAPE 3 : restoreLastFetchAt with null (clear) ===
		await planningStore.restoreLastFetchAt(master.id, null);

		// === VÉRIFICATION : lastFetchAt cleared, currentUser preserved ===
		const metaAfter = await db.localMeta.get(master.id);
		expect(metaAfter).toBeDefined();
		expect(metaAfter!.lastFetchAt).toBeUndefined();
		expect(metaAfter!.currentUser?.name).toBe('Null User'); // preserved
	});

	it('lastFetchAtFor est réactif : reflète markFetched et restoreLastFetchAt', async () => {
		// Régression : un Map natif dans $state n'est PAS réactif (les mutations
		// .set()/.delete() ne déclenchent pas de mise à jour). SvelteMap l'est.
		// Ce test vérifie que le getter expose bien les valeurs écrites par
		// markFetched/restoreLastFetchAt (la réactivité SvelteMap est testée
		// implicitement : si on revenait à un Map natif, le getter renverrait
		// stale values après markFetched car le .set() ne déclencherait rien).
		const { master, participantToken } = await seedPlanning({
			title: 'P reactivité',
			occurrenceCount: 1
		});

		// Avant activation : pas de valeur
		expect(planningStore.lastFetchAtFor(master.id)).toBeUndefined();

		// Activation → markFetched appelé en interne
		await planningStore.setActiveToken(participantToken);
		await vi.waitFor(() => expect(planningStore.occurrences.length).toBe(1));

		// Le getter doit refléter la valeur écrite par markFetched
		const tsAfterActivate = planningStore.lastFetchAtFor(master.id);
		expect(tsAfterActivate).toBeDefined();
		expect(new Date(tsAfterActivate!).toString()).not.toBe('Invalid Date');

		// markFetched explicite → valeur mise à jour
		await planningStore.markFetched(master.id);
		const tsAfterMark = planningStore.lastFetchAtFor(master.id);
		expect(tsAfterMark).toBeDefined();
		expect(tsAfterMark).not.toBe(tsAfterActivate); // timestamp a avancé

		// restoreLastFetchAt avec une valeur explicite → getter reflète la restore
		const restored = '2019-06-15T12:00:00.000Z';
		await planningStore.restoreLastFetchAt(master.id, restored);
		expect(planningStore.lastFetchAtFor(master.id)).toBe(restored);

		// restoreLastFetchAt(null) → getter renvoie undefined
		await planningStore.restoreLastFetchAt(master.id, null);
		expect(planningStore.lastFetchAtFor(master.id)).toBeUndefined();
	});
});

describe('planningStore — #activatePlanning corrige le bug occCount === 0 (D4)', () => {
	const USER_EMAIL = 'auth-d4@test.local';
	const USER_PWD = 'password123';

	beforeEach(async () => {
		clearTrackedIds();
		await db.masters.clear();
		await db.occurrences.clear();
		await db.localMeta.clear();
		await db.commentState.clear();

		planningStore.destroy();
		pb.authStore.clear();
	});

	afterEach(async () => {
		mastersCollection.unsubscribeAll();
		occurrencesCollection.unsubscribeAll();
		await cleanupTrackedRecords();
		await cleanupUsers([USER_EMAIL]);
		pb.authStore.clear();
	});

	it('auth user avec cache partiel → re-fetch complet des occurrences', async () => {
		// === SEED : master avec 3 occ + user auth associé ===
		const { master, occurrences, participantToken } = await seedPlanning({
			title: 'P auth D4',
			occurrenceCount: 3
		});
		const user = await seedUser(USER_EMAIL, USER_PWD, 'Auth D4', {
			masterIds: [master.id]
		});
		trackIds('users', user.id);

		// Authentifier dans le singleton pb + setter isLoggedIn
		const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
		pb.authStore.save(userPb.authStore.token, userPb.authStore.record);
		userStore.isLoggedIn = true;

		// === SIMULATION cache partiel : master en Dexie + 1 seule occ sur 3 ===
		// Nécessaire car #activatePlanning résout d'abord depuis Dexie (offline-first).
		await db.masters.put(master);
		await db.occurrences.put(occurrences[0]);
		expect(await db.occurrences.where('master').equals(master.id).count()).toBe(1);

		// === ACTION : setActiveToken → #activatePlanning (branche auth, isLoggedIn) ===
		// Avant le fix (D4) : occCount === 1 → on skip l'initialFetch → liste figée à 1.
		// Après le fix : initialFetch inconditionnel → 3 occ.
		await planningStore.setActiveToken(participantToken);
		await vi.waitFor(
			() => {
				expect(planningStore.occurrences.length).toBe(3);
			},
			{ timeout: 3000 }
		);

		// === VÉRIFICATION : toutes les occ récupérées (cache partiel complété) ===
		expect(planningStore.activeMasterId).toBe(master.id);
		expect(planningStore.occurrences.length).toBe(3);

		const dexieOcc = await db.occurrences.where('master').equals(master.id).toArray();
		expect(dexieOcc.length).toBe(3);
	});
});
