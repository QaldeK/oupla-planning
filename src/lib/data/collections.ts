/**
 * Singletons des collections pb-sync.
 *
 * Couche de composition data — casse la dépendance circulaire
 * `planningStore ↔ planningActions/services` en plaçant les singletons en amont
 * de la chaîne d'imports : `pb-sync → data → stores → services`.
 *
 * `data/` doit rester importable par tous et n'importe donc aucun store : l'état
 * « au moins une souscription realtime est ouverte » (dont dépend le polling de
 * reconnexion réseau) remonte par un observer injecté au boot — voir
 * {@link setSubscriptionObserver}.
 */

import { createSyncCollection } from "$lib/pb-sync/collection";
import { db } from "$lib/pb-sync/db";
import { pb } from "$lib/pocketbase/pb";
import type { PlanningMaster, PlanningOccurrence } from "$lib/types/planning.types";

type SubscriptionObserver = (hasActiveSubscription: boolean) => void;

let subscriptionObserver: SubscriptionObserver | null = null;
let activeSubscriptionCount = 0;

/**
 * Branche la réaction aux souscriptions realtime. Appelé une fois au boot, au
 * sommet de l'app (layout) — seul endroit qui connaît à la fois `data/` et les
 * stores. Sans observer branché, les transitions sont comptées sans effet : un
 * import isolé ou un test n'ont rien à câbler.
 */
export function setSubscriptionObserver(observer: SubscriptionObserver): void {
	subscriptionObserver = observer;
}

function notifySubscriptionChange(active: boolean) {
	activeSubscriptionCount += active ? 1 : -1;
	if (activeSubscriptionCount < 0) activeSubscriptionCount = 0;
	subscriptionObserver?.(activeSubscriptionCount > 0);
}

// Le merge des champs additifs (participants/tasks/responses/comments) est
// effectué côté serveur par `pb_hooks/merge-utils.js` de façon atomique
// (transaction SQLite). Les `mergeStrategies` côté client ont été retirées :
// elles introduisaient une fenêtre de course entre le `getOne` et l'update`,
// et sont redondantes avec le hook serveur.
export const mastersCollection = createSyncCollection<PlanningMaster>(
	pb,
	db.masters,
	"planning_masters",
	{
		onSubscriptionChange: notifySubscriptionChange,
	},
);

export const occurrencesCollection = createSyncCollection<PlanningOccurrence>(
	pb,
	db.occurrences,
	"planning_occurrences",
	{
		onSubscriptionChange: notifySubscriptionChange,
	},
);
