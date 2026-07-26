/**
 * CommentStateStore — store réactif (Svelte 5 $state) pour les compteurs de non-lus par planning.
 *
 * ## Source de vérité
 * 1 seul `liveQuery` Dexie qui écoute les tables `commentState` ET `occurrences`.
 * Toute modification sur l'une de ces tables déclenche un recalcul complet du Map.
 *
 * ## Logique de calcul
 * Pour chaque masterId, compte le nombre d'occurrences avec des commentaires non-lus :
 *   - Occurrence AVEC CommentState : non-lu si lastCommentAt > lastReadAt
 *   - Occurrence SANS CommentState mais avec commentaires : non-lu (jamais visitée, commentaires via sync)
 *
 * ## Fenêtre temporelle
 * Seules les occurrences dont la date est postérieure à (now - 7 jours) sont traitées.
 * Les vieilles occurrences sont ignorées pour des raisons de performance et de pertinence.
 *
 * ## Utilisation
 * - `start()` : appelé dans `onMount` du layout racine (+layout.svelte).
 * - `getUnreadCount(masterId)` : utilisé dans sidebar et home page pour afficher l'indicateur.
 * - Le store est global (singleton), pas besoin de le démarrer/arrêter par planning.
 *
 * ## Clé de regroupement
 * Le Map utilise `occ.master` (champ de l'occurrence) comme clé, et non `state.masterId`.
 * Cela rend le store robuste même en cas de masterId corrompu dans la table commentState.
 */
import { liveQuery, type Subscription } from "dexie";
import { db } from "$lib/pb-sync/db";

const CUTOFF_DAYS = 7;

class CommentStateStore {
	unreadCounts = $state<Map<string, number>>(new Map());
	private subscription: Subscription | null = null;

	start() {
		if (this.subscription) return;

		this.subscription = liveQuery(async () => {
			const cutoff = new Date(Date.now() - CUTOFF_DAYS * 86400000).toISOString().split("T")[0];

			const [states, occurrences] = await Promise.all([
				db.commentState.toArray(),
				db.occurrences
					.where("date")
					.aboveOrEqual(cutoff)
					.filter((o) => !o.deleted)
					.toArray()
			]);

			const result = new Map<string, number>();
			const occMap = new Map(occurrences.map((o) => [o.id, o]));
			const statedOccIds = new Set<string>();

			for (const state of states) {
				statedOccIds.add(state.occurrenceId);
				const occ = occMap.get(state.occurrenceId);
				if (!occ || occ.comments.length === 0) continue;

				const lastCommentAt = occ.comments.reduce(
					(latest, c) => (c.createdAt > latest ? c.createdAt : latest),
					occ.comments[0].createdAt
				);
				if (new Date(lastCommentAt).getTime() > new Date(state.lastReadAt).getTime()) {
					result.set(occ.master, (result.get(occ.master) || 0) + 1);
				}
			}

			for (const occ of occurrences) {
				if (occ.comments.length === 0 || statedOccIds.has(occ.id)) continue;
				result.set(occ.master, (result.get(occ.master) || 0) + 1);
			}

			return result;
		}).subscribe({
			next: (map) => {
				this.unreadCounts = map;
			}
		});
	}

	stop() {
		if (this.subscription) {
			this.subscription.unsubscribe();
			this.subscription = null;
		}
	}

	getUnreadCount(masterId: string): number {
		return this.unreadCounts.get(masterId) || 0;
	}
}

export const commentStateStore = new CommentStateStore();
