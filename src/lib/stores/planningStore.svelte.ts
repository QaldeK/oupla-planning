import type {
	PlanningMaster,
	PlanningOccurrence,
	Participant,
	Task,
	ParticipantResponse,
	OccurrenceComment
} from '$lib/types/planning.types';
import { getPlanningByToken } from '$lib/services/planningActions';
import { commentStateService } from '$lib/services/commentStateService';
import { userStore } from '$lib/stores/userStore.svelte';
import { networkStore } from '$lib/stores/networkStore.svelte';
import { pb } from '$lib/pocketbase/pb';
import { createSyncCollection, mergeByKey } from '$lib/pb-sync/collection';
import { db } from '$lib/pb-sync/db';
import { liveQuery } from 'dexie';
import type { Subscription } from 'dexie';

// Compteur de subscriptions actives pour networkStore
let activeSubscriptionCount = 0;

function notifySubscriptionChange(active: boolean) {
	activeSubscriptionCount += active ? 1 : -1;
	if (activeSubscriptionCount < 0) activeSubscriptionCount = 0;
	networkStore.setHasActiveSubscription(activeSubscriptionCount > 0);
}

// pb-sync collections avec merge strategies pour la résolution de conflits
export const mastersCollection = createSyncCollection<PlanningMaster>(
	pb,
	db.masters,
	'planning_masters',
	{
		mergeStrategies: {
			participants: mergeByKey<Participant>('id'),
			tasks: mergeByKey<Task>('id')
		},
		onSubscriptionChange: notifySubscriptionChange
	}
);

export const occurrencesCollection = createSyncCollection<PlanningOccurrence>(
	pb,
	db.occurrences,
	'planning_occurrences',
	{
		mergeStrategies: {
			responses: mergeByKey<ParticipantResponse>('participantId'),
			comments: mergeByKey<OccurrenceComment>('id'),
			tasks: mergeByKey<Task>('id')
		},
		onSubscriptionChange: notifySubscriptionChange
	}
);

// Type de retour pour getOrFetchMaster
type GetOrFetchMasterResult = PlanningMaster | { error: 'network' | 'not_found' };

class PlanningStore {
	// Cache interne : token → master (pour éviter les fetchs)
	#tokenCache = new Map<string, PlanningMaster>();
	// Mapping pour l'invalidation : masterId → Set<tokens>
	#masterTokens = new Map<string, Set<string>>();

	// État page-scoped (planning actif, guest ou connecté)
	#activeMasterId = $state<string | null>(null);
	#currentToken = $state<string | null>(null);
	#selectedOccurrenceId = $state<string | null>(null);
	#isLoading = $state(false);
	#error = $state<{
		type: 'network' | 'not_found' | 'deleted';
		message: string;
	} | null>(null);

	// Dexie-backed reactive state — mis à jour par liveQuery subscriptions
	#master = $state<PlanningMaster | null>(null);
	#occurrences = $state<PlanningOccurrence[]>([]);
	#masterSub: Subscription | null = null;
	#occurrencesSub: Subscription | null = null;

	// LiveQuery global pour sidebar/homepage
	#allMasters = $state<PlanningMaster[]>([]);
	#allMastersSub: Subscription | null = null;

	// Masters dont l'existence sur le serveur a été vérifiée ce session
	#verifiedMasterIds = new Set<string>();

	// === Getters page-scoped ===

	get master(): PlanningMaster | null {
		return this.#master;
	}
	get occurrences(): PlanningOccurrence[] {
		return this.#occurrences;
	}

	get currentOccurrence(): PlanningOccurrence | null {
		return this.occurrences.find((o) => o.id === this.#selectedOccurrenceId) ?? null;
	}

	get selectedOccurrenceId(): string | null {
		return this.#selectedOccurrenceId;
	}
	get activeMasterId(): string | null {
		return this.#activeMasterId;
	}
	/** Token actuellement actif (participant ou admin) — null si aucune page /p ou /admin ouverte */
	get currentToken(): string | null {
		return this.#currentToken;
	}
	get isLoading(): boolean {
		return this.#isLoading;
	}
	get error() {
		return this.#error;
	}

	// === Getters globaux (sidebar/homepage) ===

	/** Masters actifs (non supprimés), triés par titre */
	get activeMasters(): PlanningMaster[] {
		return this.#allMasters
			.filter((m) => !m.deleted)
			.sort((a, b) => a.title.localeCompare(b.title));
	}

	/** Masters supprimés détectés */
	get deletedMasters(): PlanningMaster[] {
		return this.#allMasters.filter((m) => m.deleted === true);
	}

	// === Helpers ===

	hasAdminAccess(masterId: string): boolean {
		const master = this.#allMasters.find((m) => m.id === masterId);
		return !!master && !!master.adminToken;
	}

	getAdminToken(masterId: string): string | undefined {
		return this.#allMasters.find((m) => m.id === masterId)?.adminToken;
	}

	// === Initialisation ===

	/**
	 * Initialise le liveQuery global sur db.masters (sidebar/homepage).
	 * Appelé depuis userStore.init() une fois l'auth prête.
	 */
	initGlobalSync() {
		if (this.#allMastersSub) return; // Déjà initialisé
		this.#allMastersSub = liveQuery(() => db.masters.toArray()).subscribe({
			next: (val) => {
				this.#allMasters = val;
			}
		});
	}

	#destroyGlobalSync() {
		this.#allMastersSub?.unsubscribe();
		this.#allMastersSub = null;
		this.#allMasters = [];
	}

	// === LiveQuery page-scoped ===

	/**
	 * Subscribe aux liveQuery Dexie pour le master et ses occurrences.
	 * Les $state #master et #occurrences se mettent à jour automatiquement.
	 */
	#subscribeDexieQueries(masterId: string) {
		this.#masterSub?.unsubscribe();
		this.#occurrencesSub?.unsubscribe();
		this.#master = null;
		this.#occurrences = [];

		this.#masterSub = liveQuery(() => db.masters.get(masterId)).subscribe({
			next: (val) => {
				this.#master = val ?? null;
			}
		});

		this.#occurrencesSub = liveQuery(() =>
			db.occurrences.where('master').equals(masterId).sortBy('date')
		).subscribe({
			next: (val) => {
				this.#occurrences = val;
			}
		});
	}

	#unsubscribeDexieQueries() {
		this.#masterSub?.unsubscribe();
		this.#masterSub = null;
		this.#occurrencesSub?.unsubscribe();
		this.#occurrencesSub = null;
		this.#master = null;
		this.#occurrences = [];
	}

	// === Suppression détectée ===

	/**
	 * Marque un master et ses occurrences comme deleted en local.
	 * Le flag deleted: true dans masters sert de source de vérité pour l'UI.
	 */
	async #markAsDeleted(masterId: string): Promise<void> {
		const master = await db.masters.get(masterId);
		if (master) {
			await db.masters.put({ ...master, deleted: true } as PlanningMaster);
		}

		const occs = await db.occurrences.where('master').equals(masterId).toArray();
		if (occs.length > 0) {
			await db.occurrences.bulkPut(
				occs.map((o) => ({ ...o, deleted: true }) as PlanningOccurrence)
			);
		}

		const tokens = this.#masterTokens.get(masterId);
		if (tokens) {
			for (const t of tokens) this.#tokenCache.delete(t);
			this.#masterTokens.delete(masterId);
		}
	}

	/**
	 * Supprime définitivement les masters marqués deleted et leurs données associées.
	 */
	async cleanDeletedPlannings(): Promise<void> {
		const deletedIds = this.#allMasters.filter((m) => m.deleted === true).map((m) => m.id);

		if (deletedIds.length === 0) return;

		await db.masters.bulkDelete(deletedIds);

		const allOccIds: string[] = [];
		for (const id of deletedIds) {
			const occs = await db.occurrences.where('master').equals(id).toArray();
			allOccIds.push(...occs.map((o) => o.id));
		}
		if (allOccIds.length > 0) await db.occurrences.bulkDelete(allOccIds);

		// Nettoyer les localMeta orphelins (identités guest pour plannings supprimés)
		for (const id of deletedIds) {
			await db.localMeta.delete(id);
		}
	}

	// === Résolution de token ===

	/**
	 * Résout un token en PlanningMaster depuis Dexie (sans réseau).
	 * participantToken et adminToken sont indexés dans la table masters.
	 * Retourne null si pas trouvé localement.
	 */
	async #resolveMasterFromDexie(token: string): Promise<PlanningMaster | null> {
		let master = await db.masters.where('participantToken').equals(token).first();
		if (master) return master;
		master = await db.masters.where('adminToken').equals(token).first();
		return master ?? null;
	}

	// === Activation de planning ===

	/**
	 * Active un planning à partir de son token (participant ou admin).
	 * Appelé par le layout qui observe $page.params.token.
	 */
	async setActiveToken(
		token: string | undefined,
		_dateFilter: 'future' | 'past' | 'all' = 'future'
	): Promise<void> {
		if (!token) {
			this.#deactivate();
			return;
		}

		if (this.#currentToken === token) return;

		this.#isLoading = true;
		this.#error = null;
		this.#currentToken = token;

		try {
			if (userStore.isLoggedIn) {
				await this.#setActiveAuth(token);
			} else {
				await this.#setActiveGuest(token);
			}
		} catch (err) {
			console.error('PlanningStore setActiveToken error:', err);
			this.#error = { type: 'network', message: 'Erreur lors du chargement' };
		} finally {
			this.#isLoading = false;
		}
	}

	/**
	 * Auth fast path : résout le master depuis Dexie, vérifie son existence sur le serveur,
	 * puis branche les liveQuery.
	 */
	async #setActiveAuth(token: string): Promise<void> {
		const master = await this.#resolveMasterFromDexie(token);

		if (!master) {
			// Pas encore en Dexie — sync en cours ou planning nouvellement partagé.
			// Fallback sur le chemin réseau.
			console.info('[PlanningStore] Master not in Dexie, fallback to network fetch');
			return this.#setActiveGuest(token);
		}

		// Déjà marqué supprimé localement (détection précédente)
		if (master.deleted) {
			this.#error = { type: 'deleted', message: 'Ce planning a été supprimé' };
			return;
		}

		// Vérifier l'existence sur le serveur (une seule fois par session)
		if (!this.#verifiedMasterIds.has(master.id)) {
			// Passer le _token pour satisfaire la ViewRule même si user.masterId
			// n'est pas encore peuplé (ex: juste après onAuthTransition).
			const token = master.participantToken ?? master.adminToken;
			try {
				await pb.collection('planning_masters').getOne(master.id, {
					fields: 'id',
					query: token ? { _token: token } : undefined,
					requestKey: null
				});
				this.#verifiedMasterIds.add(master.id);
			} catch (err: any) {
				if (err?.status === 404) {
					await this.#markAsDeleted(master.id);
					this.#error = { type: 'deleted', message: 'Ce planning a été supprimé' };
					return;
				}
				// Erreur réseau → non-bloquant, on affiche les données locales (potentiellement obsolètes)
				console.warn('[PlanningStore] Could not verify master existence:', err?.message);
			}
		}

		if (this.#activeMasterId === master.id) return;

		this.#activeMasterId = master.id;

		// Pour un user auth qui arrive sur un planning dont le master est en Dexie
		// (via initialFetch global) mais dont les occurrences n'ont pas encore été
		// fetchées spécifiquement, on doit les récupérer. Sinon la liste reste vide.
		// Pas de _token requis : les API Rules filtrent via user.masterId.
		const occCount = await db.occurrences.where('master').equals(master.id).count();
		if (occCount === 0) {
			try {
				await occurrencesCollection.initialFetch({
					filter: ['master = {:masterId}', { masterId: master.id }]
				});
			} catch (err) {
				console.warn('[PlanningStore] Could not fetch occurrences for master:', err);
			}
		}

		this.#subscribeDexieQueries(master.id);
	}

	/**
	 * Guest full path : fetch réseau → stockage Dexie → abonnement pb-sync realtime.
	 * Utilisé aussi comme fallback pour les users auth si le master n'est pas en Dexie.
	 */
	async #setActiveGuest(token: string): Promise<void> {
		const result = await this.getOrFetchMaster(token);

		if ('error' in result) {
			if (result.error === 'not_found') {
				// Vérifier si on a des données locales → planning supprimé sur le serveur
				const localMaster = await this.#resolveMasterFromDexie(token);
				if (localMaster) {
					await this.#markAsDeleted(localMaster.id);
					this.#error = {
						type: 'deleted',
						message: 'Ce planning a été supprimé par son administrateur'
					};
				} else {
					this.#error = { type: 'not_found', message: 'Planning introuvable' };
				}
			} else {
				this.#error = { type: result.error, message: 'Connexion impossible' };
			}
			this.#activeMasterId = null;
			this.#unsubscribeDexieQueries();
			return;
		}

		const master = result;

		if (this.#activeMasterId === master.id) return;

		// update() merge les champs — préserve les champs locaux non présents dans le fetch PB
		// (ex: adminToken masqué par onRecordEnrich). put() si le record n'existe pas encore.
		const existing = await db.masters.get(master.id);
		if (existing) {
			await db.masters.update(master.id, master as any);
		} else {
			await db.masters.put(master);
		}
		this.#activeMasterId = master.id;

		// Fetch occurrences (delta sync incrémental via updated > since)
		await occurrencesCollection.initialFetch({
			filter: ['master = {:masterId}', { masterId: master.id }],
			query: { _token: token }
		});

		this.#subscribeDexieQueries(master.id);

		const identity = userStore.getIdentityForPlanning(master.id);
		if (identity) {
			const occs = await db.occurrences.where('master').equals(master.id).toArray();
			commentStateService.backfillCommentState(master.id, occs, identity.id);
		}

		// Realtime via pb-sync (guest uniquement)
		if (!userStore.isLoggedIn) {
			try {
				mastersCollection.subscribe({ record: master.id, query: { _token: token } });
				occurrencesCollection.subscribe({
					filter: ['master = {:masterId}', { masterId: master.id }],
					query: { _token: token }
				});
			} catch (err) {
				console.warn('pb-sync subscription failed (non-blocking):', err);
			}
		}
	}

	#deactivate(): void {
		this.#unsubscribeDexieQueries();
		mastersCollection.unsubscribeAll();
		occurrencesCollection.unsubscribeAll();
		this.#activeMasterId = null;
		this.#selectedOccurrenceId = null;
		this.#currentToken = null;
		this.#tokenCache.clear();
	}

	// --- Cache ---

	async getOrFetchMaster(token: string): Promise<GetOrFetchMasterResult> {
		if (this.#tokenCache.has(token)) return this.#tokenCache.get(token)!;

		const result = await getPlanningByToken(token);

		if ('error' in result) {
			return { error: result.error };
		}

		const master = result.master;
		this.#tokenCache.set(token, master);

		if (!this.#masterTokens.has(master.id)) this.#masterTokens.set(master.id, new Set());
		this.#masterTokens.get(master.id)!.add(token);

		return master;
	}

	invalidateAll(): void {
		this.#tokenCache.clear();
		this.#masterTokens.clear();
	}

	/**
	 * Invalide le token actuellement actif afin que le prochain appel à
	 * setActiveToken(token) repasse un cycle complet (pas d'early return).
	 * Utilisé après onAuthTransition() pour forcer le re-chargement du planning
	 * courant dans le bon mode (guest → auth).
	 */
	invalidateActiveToken(): void {
		this.#currentToken = null;
	}

	// --- Actions ---

	setSelectedOccurrenceId(id: string | null) {
		this.#selectedOccurrenceId = id;
	}

	async refreshActive(): Promise<void> {
		if (!this.#activeMasterId) return;
		const master = await db.masters.get(this.#activeMasterId);
		if (!master) return;

		const token = master.adminToken ?? master.participantToken;
		if (!token) return;

		await occurrencesCollection.initialFetch({
			filter: ['master = {:masterId}', { masterId: this.#activeMasterId }],
			query: { _token: token }
		});
	}

	/**
	 * Détruit tout : utilisé par logout/clearAll.
	 */
	destroy() {
		this.#deactivate();
		this.#destroyGlobalSync();
		this.invalidateAll();
		this.#verifiedMasterIds.clear();
	}
}

export const planningStore = new PlanningStore();
