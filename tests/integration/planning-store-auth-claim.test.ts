/**
 * Tests d'intégration — PlanningStore : Auth Claim Flow (bug fix)
 *
 * Objectif :
 *   Vérifier que l'activation d'un planning tiers par un utilisateur authentifié
 *   (lien de partage reçu d'un tiers) déclenche déterministiquement :
 *     - le claim synchrone du master dans user.masterId (via /api/sync-plannings)
 *     - le refresh du authStore côté client (pb.authStore.record.masterId)
 *
 * Ce que ça teste :
 *   1. User auth + planning tiers (jamais visité) → master ajouté à user.masterId
 *      après setActiveToken.
 *   2. User auth + planning déjà dans user.masterId → skip du claim.
 *   3. User auth + planning admin tiers → pas de double claim (/api/claim-admin
 *      fire-and-forget dans getPlanningByToken + /api/sync-plannings dans attachMasterToUser).
 *   4. Réseau en panne pendant le claim → statut dégradé (warn + continue),
 *      pas d'#error fatal, master quand même chargé en Dexie.
 *   5. Realtime (global, mode auth) activé dès la fin de setActiveToken.
 *
 * Bug transitoire corrigé :
 *   Avant le fix, un user auth visitant un planning tiers via lien de partage
 *   passait par #setActiveAuth → fallback #setActiveGuest, mais la garde
 *   `!userStore.isLoggedIn` skip le subscribe individuel → pas de realtime
 *   tant que syncService.sync() n'avait pas ajouté le master à user.masterId.
 *   Le fix unifie les flows dans #activatePlanning et appelle #attachMasterToUser
 *   synchrone dans la branche auth.
 *
 * Prérequis :
 *   - PocketBase démarré sur http://127.0.0.1:8090
 *   - Admin de test créé (test@example.com / testpassword)
 *   - fake-indexeddb polyfill (via setup.ts)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	seedPlanning,
	seedUser,
	authenticateUser,
	authenticateAdmin,
	clearTrackedIds,
	cleanupTrackedRecords,
	cleanupUsers,
	trackIds
} from './seed';
import { db } from '$lib/pb-sync/db';
import { planningStore } from '$lib/stores/planningStore.svelte';
import { mastersCollection, occurrencesCollection } from '$lib/data/collections';
import { userStore } from '$lib/stores/userStore.svelte';
import { pb } from '$lib/pocketbase/pb';

const USER_EMAIL = 'auth-claim@test.local';
const USER_PWD = 'password123';

/**
 * Helper : retourne le masterId courant du user authentifié dans le singleton pb.
 * Après authRefresh(), pb.authStore.record['masterId'] reflète la dernière valeur
 * serveur (le getter userStore.pbUser n'expose pas masterId — on y accède brut).
 */
function currentAuthMasterIds(): string[] {
	const record = pb.authStore.record;
	return (record?.['masterId'] as string[] | undefined) ?? [];
}

describe('PlanningStore — Auth claim flow (#activatePlanning, branche auth)', () => {
	beforeEach(async () => {
		clearTrackedIds();
		await db.masters.clear();
		await db.occurrences.clear();
		await db.localMeta.clear();
		await db.commentState.clear();

		planningStore.destroy();
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
		pb.authStore.clear();
		userStore.isLoggedIn = false;
	});

	it('user auth visitant pour la première fois un planning tiers → master ajouté à pbUser.masterId', async () => {
		// === SEED : planning + user SANS masterIds ===
		const { master, participantToken } = await seedPlanning({
			title: 'Planning Tiers',
			occurrenceCount: 2
		});
		const user = await seedUser(USER_EMAIL, USER_PWD, 'Auth Claim', {});
		trackIds('users', user.id);

		// === AUTH ===
		const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
		pb.authStore.save(userPb.authStore.token, userPb.authStore.record);
		userStore.isLoggedIn = true;
		expect(currentAuthMasterIds()).not.toContain(master.id);

		// === ACTION : activation du planning tiers (jamais visité) ===
		await planningStore.setActiveToken(participantToken);

		// Attendre que le liveQuery Dexie émette (master + occurrences)
		await vi.waitFor(
			() => {
				expect(planningStore.master?.title).toBe('Planning Tiers');
				expect(planningStore.occurrences.length).toBe(2);
			},
			{ timeout: 3000 }
		);

		// === VÉRIFICATION STORE ===
		expect(planningStore.activeMasterId).toBe(master.id);
		expect(planningStore.isLoading).toBe(false);
		expect(planningStore.error).toBeNull();

		// === VÉRIFICATION CLAIM — user.masterId mis à jour côté serveur ===
		const adminPb = await authenticateAdmin();
		const pbUser = await adminPb.collection('users').getOne(user.id);
		expect(pbUser.masterId).toContain(master.id);

		// === VÉRIFICATION CLAIM — authStore client rafraîchi ===
		// #attachMasterToUser appelle authRefresh() après /api/sync-plannings
		expect(currentAuthMasterIds()).toContain(master.id);

		// === VÉRIFICATION DEXIE ===
		const dexieMaster = await db.masters.get(master.id);
		expect(dexieMaster).toBeDefined();
		expect(dexieMaster!.title).toBe('Planning Tiers');
		expect(dexieMaster!.participantToken).toBe(participantToken);

		const dexieOcc = await db.occurrences.where('master').equals(master.id).toArray();
		expect(dexieOcc.length).toBe(2);
	});

	it('user auth visitant un planning déjà dans user.masterId → skip du claim', async () => {
		// === SEED : planning + user AVEC le master en masterId ===
		const { master, participantToken } = await seedPlanning({
			title: 'Planning Connu',
			occurrenceCount: 2
		});
		const user = await seedUser(USER_EMAIL, USER_PWD, 'Auth Skip', {
			masterIds: [master.id]
		});
		trackIds('users', user.id);

		// === AUTH ===
		const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
		pb.authStore.save(userPb.authStore.token, userPb.authStore.record);
		userStore.isLoggedIn = true;
		expect(currentAuthMasterIds()).toContain(master.id); // déjà présent après login

		// === SPIE sur pb.send pour détecter un éventuel appel /api/sync-plannings ===
		// (le claim doit être skippé car master.id est déjà dans masterId)
		const sendSpy = vi.spyOn(pb, 'send');

		// === ACTION : activation du planning déjà connu ===
		// Note : le master n'est pas encore en Dexie → résolution réseau → upsertRecord
		await planningStore.setActiveToken(participantToken);

		await vi.waitFor(
			() => {
				expect(planningStore.master?.title).toBe('Planning Connu');
				expect(planningStore.occurrences.length).toBe(2);
			},
			{ timeout: 3000 }
		);

		// === VÉRIFICATION STORE ===
		expect(planningStore.activeMasterId).toBe(master.id);
		expect(planningStore.error).toBeNull();

		// === VÉRIFICATION : aucun appel /api/sync-plannings déclenché ===
		const syncCalls = sendSpy.mock.calls.filter(([url]) => url === '/api/sync-plannings');
		expect(syncCalls.length).toBe(0);

		sendSpy.mockRestore();
	});

	it('user auth visitant un planning admin tiers → pas de double claim', async () => {
		// === SEED : planning + user SANS masterIds ===
		const { master, adminToken, participantToken } = await seedPlanning({
			title: 'Planning Admin Tiers',
			occurrenceCount: 1
		});
		const user = await seedUser(USER_EMAIL, USER_PWD, 'Auth Admin', {});
		trackIds('users', user.id);

		// === AUTH ===
		const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
		pb.authStore.save(userPb.authStore.token, userPb.authStore.record);
		userStore.isLoggedIn = true;

		// === SPIE : compte les appels /api/sync-plannings (claim principal)
		// et /api/claim-admin (fire-and-forget dans getPlanningByToken pour les liens admin)
		const sendSpy = vi.spyOn(pb, 'send');

		// === ACTION : activation via adminToken (lien admin tiers) ===
		await planningStore.setActiveToken(adminToken);

		await vi.waitFor(
			() => {
				expect(planningStore.master?.title).toBe('Planning Admin Tiers');
				expect(planningStore.occurrences.length).toBe(1);
			},
			{ timeout: 3000 }
		);

		// Laisse un cycle pour que le fire-and-forget claim-admin se termine
		await new Promise((r) => setTimeout(r, 200));

		// === VÉRIFICATION STORE ===
		expect(planningStore.activeMasterId).toBe(master.id);
		expect(planningStore.error).toBeNull();

		// === VÉRIFICATION : master.id présent exactement 1 fois dans user.masterId ===
		// (pas de double claim malgré claim-admin + attachMasterToUser — le hook est idempotent)
		const adminPb = await authenticateAdmin();
		const pbUser = await adminPb.collection('users').getOne(user.id);
		const masterIdCount = pbUser.masterId.filter((id: string) => id === master.id).length;
		expect(masterIdCount).toBe(1);

		// Et adminOf est bien peuplé
		const adminOf = (pbUser.adminOf as Record<string, string>) || {};
		expect(adminOf[master.id]).toBe(adminToken);

		// Le participantToken n'a pas été exposé (adminToken utilisé)
		expect(planningStore.currentToken).toBe(adminToken);
		expect(planningStore.currentToken).not.toBe(participantToken);

		sendSpy.mockRestore();
	});

	it('réseau en panne pendant le claim → statut dégradé (warn + continue), pas derreur fatale', async () => {
		// === SEED ===
		const { master, participantToken } = await seedPlanning({
			title: 'Planning Claim Fail',
			occurrenceCount: 2
		});
		const user = await seedUser(USER_EMAIL, USER_PWD, 'Auth Net Fail', {});
		trackIds('users', user.id);

		// === AUTH ===
		const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
		pb.authStore.save(userPb.authStore.token, userPb.authStore.record);
		userStore.isLoggedIn = true;

		// === MOCK : pb.send reject pour /api/sync-plannings uniquement ===
		// Les autres URLs (notamment /api/realtime pour SSE) doivent continuer à
		// fonctionner pour ne pas casser les subscriptions déjà montées.
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const originalSend = pb.send.bind(pb);
		const sendSpy = vi.spyOn(pb, 'send').mockImplementation(async (url, options) => {
			if (url === '/api/sync-plannings') {
				throw new TypeError('Network error simulated');
			}
			return originalSend(url, options);
		});

		// === ACTION : activation malgré le claim cassé ===
		await planningStore.setActiveToken(participantToken);

		await vi.waitFor(
			() => {
				expect(planningStore.master?.title).toBe('Planning Claim Fail');
				expect(planningStore.occurrences.length).toBe(2);
			},
			{ timeout: 3000 }
		);

		// === VÉRIFICATION STORE — pas d'erreur fatale ===
		expect(planningStore.activeMasterId).toBe(master.id);
		expect(planningStore.error).toBeNull();

		// === VÉRIFICATION : master quand même chargé en Dexie ===
		const dexieMaster = await db.masters.get(master.id);
		expect(dexieMaster).toBeDefined();
		expect(dexieMaster!.title).toBe('Planning Claim Fail');

		// === VÉRIFICATION : warn émis (statut dégradé signalé) ===
		expect(warnSpy).toHaveBeenCalled();
		const warnArgs = warnSpy.mock.calls.flat().join(' ');
		expect(warnArgs).toMatch(/attachMasterToUser|degraded|claim/i);

		// === VÉRIFICATION : master.id PAS dans user.masterId (claim a échoué) ===
		const adminPb = await authenticateAdmin();
		const pbUser = await adminPb.collection('users').getOne(user.id);
		expect(pbUser.masterId).not.toContain(master.id);

		sendSpy.mockRestore();
		warnSpy.mockRestore();
	});

	it('erreur fatale pendant le claim (4xx serveur) → #error fatal, pas de degraded', async () => {
		// Complément du test précédent : une erreur NON réseau (ex: 400 serveur)
		// doit remonter au caller et setter #error = 'network'. La spec exige
		// cette distinction fatal/non-bloquant (US 7).
		const { master, participantToken } = await seedPlanning({
			title: 'Planning Fatal Claim',
			occurrenceCount: 1
		});
		const user = await seedUser(USER_EMAIL, USER_PWD, 'Auth Fatal', {});
		trackIds('users', user.id);

		const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
		pb.authStore.save(userPb.authStore.token, userPb.authStore.record);
		userStore.isLoggedIn = true;

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const originalSend = pb.send.bind(pb);
		const sendSpy = vi.spyOn(pb, 'send').mockImplementation(async (url, options) => {
			if (url === '/api/sync-plannings') {
				// 400 Bad Request — erreur fatale, pas réseau
				const { ClientResponseError } = await import('pocketbase');
				throw new ClientResponseError({
					url: 'http://test/api/sync-plannings',
					status: 400,
					response: { code: 400, message: 'Bad request', data: {} }
				});
			}
			return originalSend(url, options);
		});

		// === ACTION : activation avec claim fatal ===
		await planningStore.setActiveToken(participantToken);

		// === VÉRIFICATION : #error fatal positionné (type 'network' selon spec) ===
		expect(planningStore.error).not.toBeNull();
		expect(planningStore.error!.type).toBe('network');

		// Le warn "degraded" ne doit PAS être émis (l'erreur est fatale, pas réseau)
		const warnArgs = warnSpy.mock.calls.flat().join(' ');
		expect(warnArgs).not.toMatch(/attachMasterToUser.*degraded/i);

		sendSpy.mockRestore();
		warnSpy.mockRestore();
	});

	it('realtime (global, mode auth) activé dès la fin du setActiveToken', async () => {
		// === SEED ===
		const { master, participantToken } = await seedPlanning({
			title: 'Realtime Auth Test',
			occurrenceCount: 1
		});
		const user = await seedUser(USER_EMAIL, USER_PWD, 'Auth Realtime', {});
		trackIds('users', user.id);

		// === AUTH ===
		const userPb = await authenticateUser(USER_EMAIL, USER_PWD);
		pb.authStore.save(userPb.authStore.token, userPb.authStore.record);
		userStore.isLoggedIn = true;

		// === SUBSCRIBE GLOBAL (mimique de userStore.#subscribeAuth en mode auth) ===
		// En mode auth, la subscription est globale (topic '*'), pas scopée par master.
		// Après #attachMasterToUser, le serveur route les events vers ce client car
		// le master est désormais dans user.masterId.
		mastersCollection.subscribe();
		occurrencesCollection.subscribe();

		// === ACTION : activation du planning tiers ===
		await planningStore.setActiveToken(participantToken);

		await vi.waitFor(
			() => {
				expect(planningStore.master?.title).toBe('Realtime Auth Test');
				expect(planningStore.occurrences.length).toBe(1);
			},
			{ timeout: 3000 }
		);

		// === MODIFICATION EXTERNE via client indépendant (admin) ===
		const adminPb = await authenticateAdmin();
		await adminPb.collection('planning_masters').update(master.id, {
			title: 'Updated via Realtime Auth'
		});

		// === VÉRIFICATION : realtime → Dexie → liveQuery → store ===
		// Le bug transitoire : avant le fix, ce délai échouait car le master n'était
		// pas encore dans user.masterId côté serveur au moment de l'event realtime
		// (API Rules bloquaient le dispatch). Après le fix synchrone, le claim est
		// fait dans le flow d'activation avant la fin de setActiveToken.
		await vi.waitFor(
			() => {
				expect(planningStore.master?.title).toBe('Updated via Realtime Auth');
			},
			{ timeout: 5000 }
		);

		const dexieMaster = await db.masters.get(master.id);
		expect(dexieMaster?.title).toBe('Updated via Realtime Auth');
	});
});
