/**
 * GuestStateStore — état guest par planning.
 *
 * Responsabilités :
 *   - Exposer les accesseurs guest-prefixed (`getGuestIdentity`, `getGuestQuitState`)
 *   - Écrire `currentUser` / `hasQuit` dans Dexie `localMeta` (patch partiel via
 *     `upsertLocalMeta`) — jamais d'autre champ (coexistence avec planningStore,
 *     écrivain de `lastFetchAt` — voir ADR 0009).
 *
 * `guestStates` est un **miroir liveQuery** de la table Dexie `localMeta` :
 * Dexie est l'unique source of truth, le `$state` est alimenté par la subscription
 * (même pattern que `planningStore.#allMasters`). Aucun double-write, aucun
 * bookkeeping manuel — le reset devient automatique quand l'orchestrateur
 * (runAuthTransition / userStore.#clearLocalDexie) vide `localMeta`.
 *
 * N'utilise pas `getIdentityForPlanning` (qui mêle auth et guest) — cette
 * fonction vit dans `identityResolution.ts` (pure).
 */

import { liveQuery, type Subscription } from "dexie";
import { db, ensureDbReady, upsertLocalMeta } from "$lib/pb-sync/db";
import type { PlanningIdentity, SavedPlanning } from "$lib/types/planning.types";

class GuestStateStore {
	/** Miroir réactif de `db.localMeta` — alimenté par la subscription liveQuery. */
	guestStates = $state<SavedPlanning[]>([]);

	/**
	 * Subscription liveQuery (singleton — jamais démontée : même cycle de vie que
	 * `planningStore.#allMasters`). Montée idempotemment par `loadGuestState`.
	 */
	#sub: Subscription | null = null;

	// =============================================
	// Lifecycle
	// =============================================

	/**
	 * Monte la subscription liveQuery sur `db.localMeta`. Idempotente.
	 *
	 * Renvoie une promesse qui **résout à la première émission** du liveQuery,
	 * pour que la séquence de boot puisse l'attendre avant de brancher
	 * `pb.authStore.onChange` (qui peut déclencher la transition guest→auth,
	 * laquelle a besoin du snapshot guest). Les émissions suivantes ne font
	 * que rafraîchir `guestStates`.
	 *
	 * À appeler au boot, AVANT `userStore.init()`. Skip l'initialisation si la
	 * subscription est déjà montée (renvoie une promesse résolue).
	 */
	loadGuestState(): Promise<void> {
		if (this.#sub) return Promise.resolve();
		// Rejette (au lieu de pendre indéfiniment) si la DB ne s'ouvre pas ou si
		// le liveQuery émet une erreur avant sa première valeur — sinon le boot,
		// qui await cette promesse, resterait bloqué sans recours.
		return new Promise<void>((resolve, reject) => {
			let first = true;
			ensureDbReady()
				.then(() => {
					this.#sub = liveQuery(() => db.localMeta.toArray()).subscribe({
						next: (v) => {
							this.guestStates = v;
							if (first) {
								first = false;
								resolve();
							}
						},
						error: (err) => {
							if (first) {
								first = false;
								reject(err);
							}
						}
					});
				})
				.catch(reject);
		});
	}

	// =============================================
	// Accesseurs guest identity
	// =============================================

	/**
	 * Retourne l'identité guest pour un planning, ou null si pas d'identité.
	 */
	getGuestIdentity(masterId: string): PlanningIdentity | null {
		return this.guestStates.find((p) => p.masterId === masterId)?.currentUser ?? null;
	}

	/**
	 * Définit l'identité guest pour un planning.
	 * Effet : écrit `currentUser` dans Dexie (partial patch via upsertLocalMeta).
	 * La propagation vers `guestStates` est assurée par la subscription liveQuery.
	 */
	async setGuestIdentity(masterId: string, identity: PlanningIdentity): Promise<void> {
		await upsertLocalMeta(masterId, { currentUser: identity });
	}

	// =============================================
	// Accesseurs guest quit state
	// =============================================

	/**
	 * Marque l'identité guest comme ayant quitté le planning.
	 * Effet : écrit `hasQuit` dans Dexie (partial patch via upsertLocalMeta).
	 */
	async markGuestQuit(masterId: string): Promise<void> {
		await upsertLocalMeta(masterId, { hasQuit: true });
	}

	/**
	 * Retourne true si le guest a quitté ce planning.
	 */
	getGuestQuitState(masterId: string): boolean {
		return this.guestStates.find((p) => p.masterId === masterId)?.hasQuit ?? false;
	}
}

export const guestStateStore = new GuestStateStore();
