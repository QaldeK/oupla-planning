/**
 * CommentStateService — gestion de l'état de lecture des commentaires.
 *
 * ## Architecture dual-layer
 * - **Auth users** : PocketBase `planning_participants.commentReadState` est la source de vérité.
 *   Dexie `commentState` sert de cache réactif. L'écriture est en write-through
 *   (Dexie d'abord pour la réactivité UI, puis PB fire-and-forget).
 * - **Guest users** : Dexie `commentState` est l'unique source de vérité.
 *
 * ## Modèle de données (Dexie)
 * CommentState (table `commentState`) : 1 entrée par occurrence ayant des commentaires.
 *   - `occurrenceId` (PK) : identifiant de l'occurrence
 *   - `masterId` : planning parent (pour requêtes par planning)
 *   - `isUserInConversation` : l'utilisateur a déjà posté un commentaire sur cette occurrence
 *   - `lastReadAt` : timestamp ISO du dernier "lu"
 *
 * ## Modèle de données (PocketBase, auth uniquement)
 * `planning_participants.commentReadState` : JSON plat `{ occId: readAt, ... }`
 * Synchronisé au login via `syncCommentReadState()` et en write-through via `#syncReadStateToPB()`.
 *
 * ## Règle "non-lu"
 * Une occurrence a des commentaires non-lus si :
 *   - Elle a des commentaires ET pas de CommentState → non-lu (jamais visitée, commentaire arrivé via sync)
 *   - lastCommentAt > lastReadAt → non-lu
 *   - lastCommentAt <= lastReadAt OU 0 commentaires → lu
 *
 * ## Cycle de vie
 * 1. **syncCommentReadState** (auth) / **backfillCommentState** (guest) :
 *    Initialise les entrées Dexie au chargement/activation d'un planning.
 *    - Auth : pull depuis PB vers Dexie (occurrences déjà en Dexie via initialFetch).
 *    - Guest : backfill local avec `lastReadAt = now()`.
 *
 * 2. **markConversationAsRead** : unifie markAsOpened/markAsRead.
 *    Met à jour Dexie + PB (write-through fire-and-forget si auth).
 *    Le flag `inConversation` contrôle `isUserInConversation`.
 *
 * ## Consommateurs
 * - `commentStateStore` (liveQuery) : agrège les non-lus par masterId pour sidebar/home.
 *   Utilise `occ.master` (et non `state.masterId`) comme clé de regroupement pour robustesse.
 * - `OccurrenceView` (useLiveQuery direct) : point bleu par occurrence individuelle.
 * - `CommentSection` : appels markConversationAsRead.
 */
import { db } from "$lib/pb-sync/db";
import { pb } from "$lib/pocketbase/pb";
import { getParticipantPrefs } from "$lib/services/planningParticipants";
import type { CommentState, PlanningOccurrence } from "$lib/types/planning.types";

class CommentStateService {
	/**
	 * Synchronise le read state depuis PocketBase vers Dexie pour un utilisateur authentifié.
	 * Appelé APRÈS initialFetch des occurrences (pour qu'elles soient en Dexie).
	 * Remplace le backfill pour les users authentifiés.
	 */
	async syncCommentReadState(): Promise<void> {
		if (!pb.authStore.isValid || !pb.authStore.record) return;
		const userId = pb.authStore.record.id;

		let participants!: { id: string; planning: string; commentReadState: unknown }[];
		try {
			participants = await pb
				.collection("planning_participants")
				.getFullList({ filter: pb.filter("user = {:userId}", { userId }) });
		} catch (err) {
			console.error("Failed to fetch comment read state from PB:", err);
			return;
		}

		const ops: Promise<unknown>[] = [];

		for (const participant of participants) {
			const masterId = participant.planning;
			if (!masterId || !participant.commentReadState) continue;

			const readState = participant.commentReadState as Record<string, string>;

			for (const [occId, readAt] of Object.entries(readState)) {
				const occ = await db.occurrences.get(occId);
				if (!occ) continue;

				const existing = await db.commentState.get(occId);
				if (existing) {
					// Ne pas écraser si la valeur locale est plus récente
					if (new Date(readAt).getTime() > new Date(existing.lastReadAt).getTime()) {
						const updates: Partial<CommentState> = { lastReadAt: readAt };
						const isInConversation = occ.comments.some((c) => c.participantId === userId);
						if (isInConversation && !existing.isUserInConversation) {
							updates.isUserInConversation = true;
						}
						ops.push(db.commentState.update(occId, updates));
					}
				} else {
					ops.push(
						db.commentState.put({
							occurrenceId: occId,
							masterId,
							isUserInConversation: occ.comments.some((c) => c.participantId === userId),
							lastReadAt: readAt
						})
					);
				}
			}
		}

		await Promise.all(ops);
	}

	/**
	 * Marque une conversation comme lue.
	 * Unifie les anciens markAsOpened et markAsRead.
	 *
	 * @param occurrenceId - ID de l'occurrence
	 * @param masterId - ID du planning parent
	 * @param inConversation - true si l'utilisateur a posté un commentaire (met isUserInConversation = true)
	 */
	async markConversationAsRead(
		occurrenceId: string,
		masterId: string,
		inConversation = false
	): Promise<void> {
		const now = new Date().toISOString();

		// Dexie (réactivité instantanée)
		const existing = await db.commentState.get(occurrenceId);
		if (existing) {
			const updates: Partial<CommentState> = { lastReadAt: now };
			if (inConversation && !existing.isUserInConversation) {
				updates.isUserInConversation = true;
			}
			await db.commentState.update(occurrenceId, updates);
		} else {
			await db.commentState.put({
				occurrenceId,
				masterId,
				isUserInConversation: inConversation,
				lastReadAt: now
			});
		}

		// PB write-through (auth uniquement, fire-and-forget)
		if (pb.authStore.isValid) {
			this.#syncReadStateToPB(masterId, occurrenceId, now);
		}
	}

	/**
	 * Écrit le read state dans PocketBase (fire-and-forget).
	 * Ne propage pas les erreurs — Dexie est déjà à jour, l'UI est cohérente.
	 */
	async #syncReadStateToPB(masterId: string, occId: string, readAt: string): Promise<void> {
		try {
			const userId = pb.authStore.record!.id;
			const record = await getParticipantPrefs(masterId, userId);
			if (!record) return;

			const currentState = (record.commentReadState as Record<string, string>) || {};
			currentState[occId] = readAt;

			await pb.collection("planning_participants").update(record.id, {
				commentReadState: currentState
			});
		} catch (err) {
			console.error("Failed to sync read state to PB:", err);
		}
	}

	hasUnreadComments(occurrence: PlanningOccurrence, state: CommentState | undefined): boolean {
		if (occurrence.comments.length === 0) return false;
		if (!state) return true;
		const lastCommentAt = this.getLastCommentAt(occurrence);
		if (!lastCommentAt) return false;
		return new Date(lastCommentAt).getTime() > new Date(state.lastReadAt).getTime();
	}

	getLastCommentAt(occurrence: PlanningOccurrence): string | null {
		if (occurrence.comments.length === 0) return null;
		return occurrence.comments.reduce((latest, c) => {
			return c.createdAt > latest ? c.createdAt : latest;
		}, occurrence.comments[0].createdAt);
	}

	/**
	 * Backfill local (guest uniquement).
	 * Crée les entrées manquantes pour toutes les occurrences avec commentaires,
	 * avec `lastReadAt = now()` → les commentaires existants sont considérés comme lus.
	 * Met aussi à jour `isUserInConversation` si l'utilisateur a commenté.
	 */
	async backfillCommentState(
		masterId: string,
		occurrences: PlanningOccurrence[],
		participantId: string
	): Promise<void> {
		const ops: Promise<unknown>[] = [];

		for (const occ of occurrences) {
			if (occ.comments.length === 0) continue;

			const existing = await db.commentState.get(occ.id);
			if (existing) {
				if (!existing.isUserInConversation) {
					const isParticipant = occ.comments.some((c) => c.participantId === participantId);
					if (isParticipant) {
						ops.push(db.commentState.update(occ.id, { isUserInConversation: true }));
					}
				}
				continue;
			}

			const isParticipant = occ.comments.some((c) => c.participantId === participantId);
			ops.push(
				db.commentState.put({
					occurrenceId: occ.id,
					masterId,
					isUserInConversation: isParticipant,
					lastReadAt: new Date().toISOString()
				})
			);
		}

		await Promise.all(ops);
	}

	async getUnreadCountForMaster(masterId: string): Promise<number> {
		const states = await db.commentState.where("masterId").equals(masterId).toArray();
		let count = 0;
		for (const state of states) {
			const occ = await db.occurrences.get(state.occurrenceId);
			if (occ && occ.comments.length > 0 && this.hasUnreadComments(occ, state)) {
				count++;
			}
		}

		const occurrencesWithoutState = await db.occurrences
			.where("master")
			.equals(masterId)
			.filter((occ) => occ.comments && occ.comments.length > 0)
			.toArray();

		const statesIds = new Set(states.map((s) => s.occurrenceId));
		for (const occ of occurrencesWithoutState) {
			if (!statesIds.has(occ.id)) count++;
		}

		return count;
	}
}

export const commentStateService = new CommentStateService();
