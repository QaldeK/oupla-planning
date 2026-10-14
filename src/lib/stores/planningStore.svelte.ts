import { format } from "date-fns";
import type { Subscription } from "dexie";
import { liveQuery } from "dexie";
import { ClientResponseError } from "pocketbase";
import { SvelteMap } from "svelte/reactivity";
import { mastersCollection, occurrencesCollection } from "$lib/data/collections";
import { db, ensureDbReady, upsertLocalMeta, upsertRecord } from "$lib/pb-sync/db";
import { pb } from "$lib/pocketbase/pb";
import { commentStateService } from "$lib/services/commentStateService";
import { getPlanningByToken } from "$lib/services/planningActions";
import { userStore } from "$lib/stores/userStore.svelte";
import type { PlanningMaster, PlanningOccurrence } from "$lib/types/planning.types";
import { fetchRecentPastOccurrences, syncActiveOccurrences } from "$lib/data/planningSync";

/**
 * Ordre total stable pour les occurrences : date puis startTime, avec
 * fallback sur l'id. Plusieurs occurrences peuvent partager une même date
 * (multi-créneaux) ; le fallback sur l'id garantit un rendu déterministe
 * même si startTime coïncide (override libre).
 */
function compareOccurrences(a: PlanningOccurrence, b: PlanningOccurrence): number {
	return (
		a.date.localeCompare(b.date) ||
		a.startTime.localeCompare(b.startTime) ||
		a.id.localeCompare(b.id)
	);
}

// Type de retour pour getOrFetchMaster
type GetOrFetchMasterResult = PlanningMaster | { error: "network" | "not_found" };

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
		type: "network" | "not_found" | "deleted";
		message: string;
	} | null>(null);

	// Marqueur de fraîcheur per-master (lastFetchAt) — mirror réactif de Dexie
	// localMeta. Utilisé uniquement par l'UI (« Dernière sync ») ; la re-sync
	// des occurrences ne s'appuie pas dessus (ADR 0017).
	// SvelteMap plutôt qu'un liveQuery Dexie : ciblage des updates (un liveQuery sur
	// localMeta se déclencherait aussi sur les écritures currentUser/hasQuit de
	// guestStateStore). Les mutations .set()/.delete() déclenchent la réactivité
	// via SvelteMap (un Map natif dans $state ne serait PAS réactif : Map est une
	// instance de classe, non proxifié en deep state par Svelte 5).
	#lastFetchAtMap = new SvelteMap<string, string>();

	// Dexie-backed reactive state — mis à jour par liveQuery subscriptions
	#master = $state<PlanningMaster | null>(null);
	#occurrences = $state<PlanningOccurrence[]>([]);
	#masterSub: Subscription | null = null;
	#occurrencesSub: Subscription | null = null;

	// Occurrences futures du master actif, **soft-deleted incluses**. Sert au seeding
	// du formulaire d'édition admin (une DateSlot désactivée = une occ soft-deleted).
	// Contrairement à #occurrences, on n'applique PAS le filtre `!o.deleted` : c'est le
	// consommateur (PlanningForm) qui discrimine actives vs soft-deleted côté UI.
	#futureOccurrences = $state<PlanningOccurrence[]>([]);
	#futureOccurrencesSub: Subscription | null = null;

	// LiveQuery global pour sidebar/homepage
	#allMasters = $state<PlanningMaster[]>([]);
	#allMastersSub: Subscription | null = null;

	// === Getters page-scoped ===

	get master(): PlanningMaster | null {
		return this.#master;
	}
	get occurrences(): PlanningOccurrence[] {
		return this.#occurrences;
	}

	/**
	 * Occurrences futures du master actif, soft-deleted incluses. Source du seeding
	 * du formulaire d'édition (bug #2 : une DateSlot désactivée = une occ soft-deleted).
	 */
	get futureOccurrences(): PlanningOccurrence[] {
		return this.#futureOccurrences;
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

	/** Le master actif est soft-deleté (consultation lecture seule pendant la grâce) */
	get isDeleted(): boolean {
		return this.#master?.deleted === true;
	}

	/**
	 * Retourne le lastFetchAt réactif pour un master donné (marqueur de
	 * fraîcheur UI). Se met à jour quand markFetched est appelé.
	 */
	lastFetchAtFor(masterId: string): string | undefined {
		return this.#lastFetchAtMap.get(masterId);
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
		// Open défensif (idempotent) avant le liveQuery — en pratique, userStore.init()
		// a déjà déclenché ensureDbReady(), mais on sécurise au cas où ce store serait
		// utilisé sans passer par userStore (tests, code futur).
		ensureDbReady().then(() => {
			this.#allMastersSub = liveQuery(() => db.masters.toArray()).subscribe({
				next: (val) => {
					this.#allMasters = val;
				}
			});
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
		this.#futureOccurrencesSub?.unsubscribe();
		this.#master = null;
		this.#occurrences = [];
		this.#futureOccurrences = [];

		this.#masterSub = liveQuery(() => db.masters.get(masterId)).subscribe({
			next: (val) => {
				this.#master = val ?? null;
			}
		});

		this.#occurrencesSub = liveQuery(() =>
			db.occurrences
				.where("master")
				.equals(masterId)
				.filter((o) => !o.deleted)
				.sortBy("date")
				.then((rows) => rows.sort(compareOccurrences))
		).subscribe({
			next: (val) => {
				this.#occurrences = val;
			}
		});

		// Occurrences futures soft-deleted incluses : pas de filtre `!o.deleted` (le
		// consommateur discrimine côté UI). Le seuil `today` est figé à la souscription
		// — acceptable : un changement de jour requiert une navigation/re-activation.
		const today = format(new Date(), "yyyy-MM-dd");
		this.#futureOccurrencesSub = liveQuery(() =>
			db.occurrences
				.where("master")
				.equals(masterId)
				.filter((o) => o.date >= today)
				.sortBy("date")
				.then((rows) => rows.sort(compareOccurrences))
		).subscribe({
			next: (val) => {
				this.#futureOccurrences = val;
			}
		});
	}

	#unsubscribeDexieQueries() {
		this.#masterSub?.unsubscribe();
		this.#masterSub = null;
		this.#occurrencesSub?.unsubscribe();
		this.#occurrencesSub = null;
		this.#futureOccurrencesSub?.unsubscribe();
		this.#futureOccurrencesSub = null;
		this.#master = null;
		this.#occurrences = [];
		this.#futureOccurrences = [];
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

		const occs = await db.occurrences.where("master").equals(masterId).toArray();
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
			const occs = await db.occurrences.where("master").equals(id).toArray();
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
		let master = await db.masters.where("participantToken").equals(token).first();
		if (master) return master;
		master = await db.masters.where("adminToken").equals(token).first();
		return master ?? null;
	}

	// === Activation de planning ===

	/**
	 * Active un planning à partir de son token (participant ou admin).
	 * API publique appelée par le layout qui observe `$page.params.token`.
	 *
	 * Guards (early return) + ouverture défensive de la DB + délégation à
	 * `#activatePlanning` qui unify les flows auth/guest/claim.
	 */
	async setActiveToken(
		token: string | undefined,
		_dateFilter: "future" | "past" | "all" = "future"
	): Promise<void> {
		if (!token) {
			this.#deactivate();
			return;
		}

		// Idempotence : ne pas re-activer un token déjà actif.
		if (this.#currentToken === token) return;

		// Open défensif de la DB locale avant toute opération Dexie (ADR 0006).
		// Idempotent via readyPromise mémoïsé dans db.ts.
		await ensureDbReady();

		this.#isLoading = true;
		this.#error = null;
		this.#currentToken = token;

		try {
			await this.#activatePlanning(token);
		} catch (err) {
			console.error("PlanningStore setActiveToken error:", err);
			this.#error = { type: "network", message: "Erreur lors du chargement" };
		} finally {
			this.#isLoading = false;
		}
	}

	/**
	 * Flow unifié d'activation. Pipeline quasi linéaire avec deux branches
	 * terminales (auth / guest) :
	 *
	 *   1. Résoudre master (Dexie → fallback réseau via getOrFetchMaster + upsertRecord)
	 *   2. Vérifier suppression locale puis serveur
	 *   3. Idempotence + set #activeMasterId
	 *   4. Sync occurrences actives (toujours avec `_token`)
	 *   5. Branche auth  : #attachMasterToUser (claim) + backfill si première visite
	 *   6. Branche guest : subscribe realtime individuel + backfill
	 *
	 * La branche auth déclenche le claim synchrone via /api/sync-plannings, ce
	 * qui débloque le realtime global (topic `'*'` monté par `userStore.#subscribeAuth`).
	 */
	async #activatePlanning(token: string): Promise<void> {
		// === ÉTAPE 1 : Résoudre master ===
		let master = await this.#resolveMasterFromDexie(token);
		const wasInDexie = master !== null;

		if (!master) {
			// Pas en Dexie (jamais visité) : chemin réseau complet.
			const result = await this.getOrFetchMaster(token);
			if ("error" in result) {
				if (result.error === "not_found") {
					this.#error = { type: "not_found", message: "Planning introuvable" };
				} else {
					this.#error = { type: result.error, message: "Connexion impossible" };
				}
				this.#activeMasterId = null;
				this.#unsubscribeDexieQueries();
				return;
			}
			master = result;
			// upsertRecord préserve les champs locaux non présents dans le fetch distant.
			await upsertRecord(db.masters, master);
		}

		// === ÉTAPE 2 : Vérifier suppression (locale puis serveur) ===
		// Soft-delete connu localement → consultation en lecture seule : on poursuit
		// l'activation mais sans les étapes 5/6 (claim/auto-add et subscribe guest
		// écriraient au chargement et prendraient des 403 contre les gardes serveur).
		const readOnly = master.deleted === true;
		if (!readOnly && wasInDexie) {
			// Un master fraîchement fetched prouve son existence par la réponse API
			// elle-même — le refresh ne sert qu'au cas déjà en Dexie. Un 404 ici =
			// purge définitive (fenêtre de grâce expirée) → introuvable.
			const status = await this.#refreshMasterFromServer(master.id, token);
			if (status === "deleted") {
				this.#error = { type: "not_found", message: "Planning introuvable" };
				return;
			}
			// Reprendre la copie à jour pour les étapes 5/6 (claim, tokens, récurrence).
			if (status === "ok") {
				master = (await db.masters.get(master.id)) ?? master;
			}
		}

		// === ÉTAPE 3 : Idempotence + set activeMasterId ===
		if (this.#activeMasterId === master.id) return;
		this.#activeMasterId = master.id;

		// === ÉTAPE 4 : Sync des occurrences actives (toujours avec _token) ===
		// Le `_token` est nécessaire pour la branche auth "première visite" : à ce
		// stade, user.masterId n'est pas encore peuplé côté serveur (le claim est
		// fait à l'étape 5). Les API Rules refuseraient sans `_token`.
		await this.#syncOccurrences(master.id, token);

		this.#subscribeDexieQueries(master.id);

		// === ÉTAPE 5/6 : Branche auth / guest (skippée en lecture seule) ===
		if (readOnly) return;
		if (userStore.isLoggedIn) {
			await this.#attachMasterToUser(master);
			// Backfill seulement pour les premières visites auth (master fraîchement
			// récupéré du réseau) — sinon les commentaires déjà-lus sont considérés
			// comme "déjà vus" par le guest précédent, et on préserve cette sémantique.
			if (!wasInDexie) {
				await this.#backfillCommentState(master.id);
			}
			// Pas de subscribe individuel : le subscribe global (topic '*') monté par
			// userStore.#subscribeAuth couvre ce master après claim (API Rules valident
			// désormais user.masterId serveur).
		} else {
			this.#subscribeRealtimeForGuest(master.id, token);
			await this.#backfillCommentState(master.id);
		}
	}

	/**
	 * Atomic op : re-fetch du master depuis le serveur et upsert si plus récent.
	 *
	 * Le master n'est couvert par aucune re-sync d'occurrences : sans ce
	 * re-fetch, les mises à jour survenues pendant une coupure SSE —
	 * typiquement l'ajout de participants — seraient manquées définitivement,
	 * faute de rejouabilité du realtime. Répond aussi au rôle de l'ancien check
	 * d'existence (404 → master marqué deleted localement).
	 *
	 * Le upsert est sauté si la copie locale est déjà à jour (évite du churn
	 * Dexie → re-rendus liveQuery à chaque re-sync).
	 *
	 * @returns `'ok'` si le serveur a répondu (upsert fait ou inutile),
	 *   `'deleted'` si 404 côté serveur (master marqué deleted localement),
	 *   `'unknown'` si erreur réseau (non bloquant — le caller décide de
	 *   continuer avec les données locales).
	 */
	async #refreshMasterFromServer(
		masterId: string,
		token: string
	): Promise<"ok" | "deleted" | "unknown"> {
		try {
			const fresh = await pb.collection("planning_masters").getOne<PlanningMaster>(masterId, {
				query: { _token: token },
				requestKey: null
			});
			const local = await db.masters.get(masterId);
			// Comparaison lexicographique sûre : format datetime PB fixe, tri alpha = tri chrono.
			if (!local || fresh.updated > local.updated) {
				// upsertRecord préserve les champs locaux masqués côté API (adminToken pour un guest).
				await upsertRecord(db.masters, fresh);
			}
			return "ok";
		} catch (err: unknown) {
			if (err instanceof ClientResponseError && err.status === 404) {
				await this.#markAsDeleted(masterId);
				return "deleted";
			}
			// Erreur réseau → non-bloquant, on garde les données locales (potentiellement obsolètes)
			console.warn(
				"[PlanningStore] Could not refresh master from server:",
				err instanceof ClientResponseError ? err.message : err
			);
			return "unknown";
		}
	}

	/**
	 * Atomic op : re-sync des occurrences actives du master (fenêtre
	 * `date >= J-2`, cf. data/planningSync.ts). La re-sync converge vers le
	 * serveur même si une tentative précédente a échoué silencieusement.
	 *
	 * Le `token` est requis : il couvre le cas "auth + première visite" où
	 * `user.masterId` n'est pas encore peuplé côté serveur au moment de l'appel
	 * (le claim est fait par `#attachMasterToUser` après ce fetch).
	 */
	async #syncOccurrences(masterId: string, token: string): Promise<void> {
		try {
			await syncActiveOccurrences({ masterId, token });
			await this.markFetched(masterId);
		} catch (err) {
			console.warn("[PlanningStore] Could not fetch occurrences for master:", err);
		}
	}

	/**
	 * Atomic op : subscribe realtime individuel (mode guest). Le caller décide
	 * quand appeler — uniquement depuis la branche guest de `#activatePlanning`.
	 */
	#subscribeRealtimeForGuest(masterId: string, token: string): void {
		try {
			mastersCollection.subscribe({ record: masterId, query: { _token: token } });
			occurrencesCollection.subscribe({
				filter: ["master = {:masterId}", { masterId }],
				query: { _token: token }
			});
		} catch (err) {
			console.warn("pb-sync subscription failed (non-blocking):", err);
		}
	}

	/**
	 * Atomic op : claim synchrone d'un master vers le user authentifié.
	 *
	 * Étapes :
	 *   1. Skip si `master.id` est déjà dans `pb.authStore.record.masterId`
	 *      (cache local à jour — évite un coût réseau inutile).
	 *   2. `POST /api/sync-plannings` (hook idempotent).
	 *   3. `pb.collection('users').authRefresh()` pour propager `masterId` côté
	 *      client (les guards UI comme `pbUser.masterId.includes(...)` deviennent
	 *      cohérents sans attendre la prochaine sync).
	 *
	 * Gestion d'erreur : une erreur réseau (status 0, abort, ou `TypeError` du
	 * fetch) est non bloquante (`console.warn` et continue — statut dégradé :
	 * l'utilisateur garde l'accès local sans realtime temps réel ; la prochaine
	 * sync via `syncService` retentera le claim). Toute autre erreur est fatale :
	 * elle remonte au caller (`setActiveToken`) qui set `#error = 'network'`.
	 */
	async #attachMasterToUser(master: PlanningMaster): Promise<void> {
		const record = pb.authStore.record;
		if (!record) return; // Défensif : la branche auth garantit un user connecté.

		const currentMasterIds: string[] = (record["masterId"] as string[] | undefined) ?? [];
		if (currentMasterIds.includes(master.id)) return; // Déjà claimé.

		try {
			await pb.send("/api/sync-plannings", {
				method: "POST",
				body: {
					tokens: [
						{
							masterId: master.id,
							participantToken: master.participantToken,
							adminToken: master.adminToken
						}
					]
				}
			});
			// Rafraîchir le record pour propager masterId (et adminOf si lien admin)
			// côté client — les guards UI locales deviennent cohérents sans attendre
			// la prochaine sync via syncService.
			await pb.collection("users").authRefresh();
		} catch (err) {
			// Erreur réseau (status 0 = pas de réponse serveur, isAbort = annulation,
			// TypeError = échec fetch en amont du wrapping PocketBase) → statut dégradé.
			const isNetwork =
				(err instanceof ClientResponseError && (err.status === 0 || err.isAbort)) ||
				err instanceof TypeError;
			if (isNetwork) {
				console.warn(
					"[PlanningStore] attachMasterToUser network error (degraded — no realtime until next sync):",
					err instanceof ClientResponseError ? err.message : err
				);
				return;
			}
			// Erreur fatale (4xx/5xx serveur, programming) → laisse remonter au caller.
			throw err;
		}
	}

	/**
	 * Atomic op : backfill de l'état de lecture des commentaires pour l'acteur
	 * courant (auth ou guest). L'init arbitraire considère les commentaires
	 * déjà présents comme "lus" — d'où l'appel uniquement pour les premières
	 * visites (auth master fraîchement récupéré) et toujours pour les guests.
	 * La résolution de l'id de participant (claim-aware) vit dans commentStateService.
	 */
	async #backfillCommentState(masterId: string): Promise<void> {
		const occs = await db.occurrences.where("master").equals(masterId).toArray();
		commentStateService.backfillCommentState(masterId, occs);
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

		if ("error" in result) {
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
	 * Utilisé après transitionToAuth() pour forcer le re-chargement du planning
	 * courant dans le bon mode (guest → auth).
	 */
	invalidateActiveToken(): void {
		this.#currentToken = null;
	}

	// --- Actions ---

	setSelectedOccurrenceId(id: string | null) {
		this.#selectedOccurrenceId = id;
	}

	/**
	 * Enregistre le succès d'un fetch pour un master (marqueur de fraîcheur
	 * UI). Écrit lastFetchAt dans Dexie (partial patch) et met à jour le
	 * mirror réactif.
	 */
	async markFetched(masterId: string): Promise<void> {
		const now = new Date().toISOString();
		await upsertLocalMeta(masterId, { lastFetchAt: now });
		this.#lastFetchAtMap.set(masterId, now);
	}

	async refreshActive(): Promise<void> {
		if (!this.#activeMasterId) return;
		// Open défensif avant toute opération DB (idempotent, ADR 0006).
		await ensureDbReady();
		const master = await db.masters.get(this.#activeMasterId);
		if (!master) return;

		const token = master.adminToken ?? master.participantToken;
		if (!token) return;

		// Master d'abord : aucune re-sync existante ne couvre planning_masters, et
		// un guest sans realtime valide doit pouvoir rattraper les participants
		// ajoutés pendant la coupure.
		await this.#refreshMasterFromServer(this.#activeMasterId, token);

		// Occurrences actives via l'atomic op partagé.
		// Non bloquant : appelé en fire-and-forget par networkStore (polling de reconnexion).
		await this.#syncOccurrences(this.#activeMasterId, token);
	}

	/**
	 * Atomic op : fetch des occurrences passées les plus récentes (page
	 * archive, cf. data/planningSync.ts). À la demande : le
	 * passé n'est pas couvert par la re-sync de routine. Non bloquant :
	 * l'affichage vient du cache local, le fetch met Dexie à jour (liveQuery
	 * propage). Marque aussi la fraîcheur : c'est une sync réussie.
	 */
	async refreshArchiveOccurrences(): Promise<void> {
		if (!this.#activeMasterId) return;
		await ensureDbReady();
		const master = await db.masters.get(this.#activeMasterId);
		if (!master) return;

		const token = master.adminToken ?? master.participantToken;
		if (!token) return;

		try {
			await fetchRecentPastOccurrences(this.#activeMasterId, token);
			await this.markFetched(this.#activeMasterId);
		} catch (err) {
			console.warn("[PlanningStore] Archive occurrences fetch failed:", err);
		}
	}

	/**
	 * Détruit tout : utilisé par logout/clearAll.
	 */
	destroy() {
		this.#deactivate();
		this.#destroyGlobalSync();
		this.invalidateAll();
	}
}

export const planningStore = new PlanningStore();
