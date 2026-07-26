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
import { guestStateStore } from "$lib/stores/guestStateStore.svelte";
import { userStore } from "$lib/stores/userStore.svelte";
import type { PlanningMaster, PlanningOccurrence, SavedPlanning } from "$lib/types/planning.types";
import { resolveActorIdentity } from "$lib/utils/identityResolution";

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

	// Sync cursor per-master (lastFetchAt) — mirror réactif de Dexie localMeta.
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

	// Masters dont l'existence sur le serveur a été vérifiée ce session
	#verifiedMasterIds = new Set<string>();

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

	/**
	 * Retourne le lastFetchAt réactif pour un master donné.
	 * Le getter est réactif : il se met à jour quand markFetched/restoreLastFetchAt est appelé.
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

	/** since pour la delta sync : dernier fetch du master (ou null si jamais fetché).
	 *  Retourne la valeur brute pour permettre le restore en cas d'échec du fetch. */
	async #resolveSince(masterId: string): Promise<string | null> {
		const meta = await db.localMeta.get(masterId);
		return meta?.lastFetchAt ?? null;
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
	 *   4. Delta sync occurrences (toujours avec `_token`)
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
		if (master.deleted) {
			this.#error = { type: "deleted", message: "Ce planning a été supprimé" };
			return;
		}
		// Vérification serveur seulement si master était déjà en Dexie : un master
		// fraîchement fetched prouve son existence par la réponse API elle-même.
		if (wasInDexie) {
			const status = await this.#verifyMasterExistsOnServer(master.id, token);
			if (status === "deleted") {
				this.#error = { type: "deleted", message: "Ce planning a été supprimé" };
				return;
			}
		}

		// === ÉTAPE 3 : Idempotence + set activeMasterId ===
		if (this.#activeMasterId === master.id) return;
		this.#activeMasterId = master.id;

		// === ÉTAPE 4 : Delta sync occurrences (toujours avec _token) ===
		// Le `_token` est nécessaire pour la branche auth "première visite" : à ce
		// stade, user.masterId n'est pas encore peuplé côté serveur (le claim est
		// fait à l'étape 5). Les API Rules refuseraient sans `_token`.
		await this.#deltaSyncOccurrences(master.id, token);

		this.#subscribeDexieQueries(master.id);

		// === ÉTAPE 5/6 : Branche auth / guest ===
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
	 * Atomic op : vérifie l'existence d'un master sur le serveur (une seule
	 * fois par session via le cache `#verifiedMasterIds`).
	 *
	 * @returns `'ok'` si vérifié, `'deleted'` si 404 côté serveur (le master est
	 *   marqué deleted localement), `'unknown'` si erreur réseau (non bloquant —
	 *   le caller décide de continuer avec les données locales).
	 */
	async #verifyMasterExistsOnServer(
		masterId: string,
		token: string
	): Promise<"ok" | "deleted" | "unknown"> {
		if (this.#verifiedMasterIds.has(masterId)) return "ok";
		try {
			await pb.collection("planning_masters").getOne(masterId, {
				fields: "id",
				query: { _token: token },
				requestKey: null
			});
			this.#verifiedMasterIds.add(masterId);
			return "ok";
		} catch (err: unknown) {
			if (err instanceof ClientResponseError && err.status === 404) {
				await this.#markAsDeleted(masterId);
				return "deleted";
			}
			// Erreur réseau → non-bloquant, on garde les données locales (potentiellement obsolètes)
			console.warn(
				"[PlanningStore] Could not verify master existence:",
				err instanceof ClientResponseError ? err.message : err
			);
			return "unknown";
		}
	}

	/**
	 * Atomic op : delta sync per-master des occurrences avec pattern
	 * capture/restore sur `lastFetchAt`.
	 *
	 * Le `token` est requis : il couvre le cas "auth + première visite" où
	 * `user.masterId` n'est pas encore peuplé côté serveur au moment de l'appel
	 * (le claim est fait par `#attachMasterToUser` après ce fetch).
	 */
	async #deltaSyncOccurrences(masterId: string, token: string): Promise<void> {
		const previousLastFetchAt = await this.#resolveSince(masterId);
		const since = previousLastFetchAt ?? "2000-01-01 00:00:00";
		await this.markFetched(masterId);
		try {
			await occurrencesCollection.initialFetch({
				filter: ["master = {:masterId}", { masterId }],
				query: { _token: token },
				since
			});
		} catch (err) {
			// Restore lastFetchAt pour ne pas perdre le delta au prochain cycle.
			try {
				await this.restoreLastFetchAt(masterId, previousLastFetchAt);
			} catch (restoreErr) {
				console.error("[PlanningStore] Failed to restore lastFetchAt:", restoreErr);
			}
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
	 */
	async #backfillCommentState(masterId: string): Promise<void> {
		const identityId = resolveActorIdentity({
			pbUser: userStore.pbUser,
			guestIdentity: guestStateStore.getGuestIdentity(masterId)
		})?.id;
		if (!identityId) return;
		const occs = await db.occurrences.where("master").equals(masterId).toArray();
		commentStateService.backfillCommentState(masterId, occs, identityId);
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
	 * Enregistre le succès d'un fetch pour un master.
	 * Effet : écrit lastFetchAt dans Dexie (partial patch) et met à jour le mirror réactif.
	 * Le pattern capture/restore (previousLastFetchAt avant fetch, restore en cas d'échec)
	 * est géré par `#deltaSyncOccurrences` (et `refreshActive` qui délègue).
	 */
	async markFetched(masterId: string): Promise<void> {
		const now = new Date().toISOString();
		await upsertLocalMeta(masterId, { lastFetchAt: now });
		this.#lastFetchAtMap.set(masterId, now);
	}

	/**
	 * Restaure lastFetchAt à une valeur antérieure après l'échec d'un fetch.
	 * Permet de ne pas perdre le delta [previous, now] au prochain cycle de sync.
	 * Si previousValue est null, retire le champ lastFetchAt (clear).
	 */
	async restoreLastFetchAt(masterId: string, previousValue: string | null): Promise<void> {
		const existing = await db.localMeta.get(masterId);
		if (!existing) return;
		if (previousValue) {
			await db.localMeta.update(masterId, { lastFetchAt: previousValue });
			this.#lastFetchAtMap.set(masterId, previousValue);
		} else {
			// previousValue null → clear : on réécrit l'enregistrement sans le champ lastFetchAt
			const { lastFetchAt: _, ...rest } = existing;
			await db.localMeta.put(rest as SavedPlanning);
			this.#lastFetchAtMap.delete(masterId);
		}
	}

	async refreshActive(): Promise<void> {
		if (!this.#activeMasterId) return;
		// Open défensif avant toute opération DB (idempotent, ADR 0006).
		await ensureDbReady();
		const master = await db.masters.get(this.#activeMasterId);
		if (!master) return;

		const token = master.adminToken ?? master.participantToken;
		if (!token) return;

		// Delta sync per-master via l'atomic op partagé.
		// Non bloquant : appelé en fire-and-forget par networkStore (polling de reconnexion).
		await this.#deltaSyncOccurrences(this.#activeMasterId, token);
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
