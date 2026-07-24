/**
 * GuestStateStore — état guest par planning.
 *
 * Responsabilités :
 *   - Charger/persister les identités guest (`currentUser`) et l'état `hasQuit`
 *   - Exposer les accesseurs guest-prefixed
 *
 * N'utilise pas `getIdentityForPlanning` (qui mêle auth et guest) — cette
 * fonction vit dans `identityResolution.ts` (pure).
 *
 * Écritures via `db.localMeta.update` (partial patch) pour coexister
 * avec planningStore (écrivain de `lastFetchAt`) sans écrasement croisé.
 * Fallback `put()` si le record n'existe pas encore (première visite).
 */
import { db, upsertLocalMeta } from '$lib/pb-sync/db';
import type { SavedPlanning, PlanningIdentity } from '$lib/types/planning.types';

class GuestStateStore {
	/** Identités guest par planning — chargées depuis Dexie localMeta. */
	guestStates = $state<SavedPlanning[]>([]);

	// =============================================
	// Lifecycle
	// =============================================

	/**
	 * Charge l'état guest depuis Dexie localMeta.
	 * À appeler au boot, AVANT userStore.init() (qui subscribe authStore.onChange).
	 * Skip si l'utilisateur est auth (pas d'état guest à charger).
	 */
	async loadGuestState(): Promise<void> {
		this.guestStates = await db.localMeta.toArray();
	}

	/**
	 * Vide tout l'état guest (clear Dexie + in-memory).
	 * Appelé lors de la transition guest → auth.
	 */
	async clearGuestState(): Promise<void> {
		this.guestStates = [];
		await db.localMeta.clear();
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
	 * Effet : écrit currentUser dans Dexie (partial patch via upsertLocalMeta).
	 */
	async setGuestIdentity(masterId: string, identity: PlanningIdentity): Promise<void> {
		this.#upsertGuestState(masterId, { currentUser: identity });
		await upsertLocalMeta(masterId, { currentUser: identity });
	}

	/**
	 * Supprime l'identité locale pour un planning.
	 */
	async removeGuestIdentity(masterId: string): Promise<void> {
		this.guestStates = this.guestStates.filter((p) => p.masterId !== masterId);
		await db.localMeta.delete(masterId);
	}

	// =============================================
	// Accesseurs guest quit state
	// =============================================

	/**
	 * Marque l'identité guest comme ayant quitté le planning.
	 * Effet : écrit hasQuit dans Dexie (partial patch via upsertLocalMeta).
	 */
	async markGuestQuit(masterId: string): Promise<void> {
		this.#upsertGuestState(masterId, { hasQuit: true });
		await upsertLocalMeta(masterId, { hasQuit: true });
	}

	/**
	 * Retourne true si le guest a quitté ce planning.
	 */
	getGuestQuitState(masterId: string): boolean {
		return this.guestStates.find((p) => p.masterId === masterId)?.hasQuit ?? false;
	}

	// =============================================
	// Helpers privés
	// =============================================

	/**
	 * Met à jour l'état in-memory (patch partiel). Préserve les champs existants
	 * (currentUser, hasQuit, lastFetchAt).
	 */
	#upsertGuestState(masterId: string, patch: Partial<SavedPlanning>): void {
		const idx = this.guestStates.findIndex((p) => p.masterId === masterId);
		if (idx >= 0) {
			this.guestStates[idx] = { ...this.guestStates[idx], ...patch };
		} else {
			this.guestStates.push({ masterId, ...patch } as SavedPlanning);
		}
	}
}

export const guestStateStore = new GuestStateStore();
