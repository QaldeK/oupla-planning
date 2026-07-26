/**
 * Singletons des collections pb-sync.
 *
 * Couche de composition data — casse la dépendance circulaire
 * `planningStore ↔ planningActions` en plaçant les singletons en amont
 * de la chaîne d'imports : `pb-sync → data → stores → services`.
 *
 * `networkStore.setHasActiveSubscription` reste référencé ici pour signaler
 * au polling de reconnexion qu'au moins une sub realtime est ouverte. Sortir
 * cette responsabilité vers un `subscription-tracker` dédié serait plus
 * propre mais n'apporterait rien aujourd'hui (YAGNI).
 */

import { createSyncCollection } from "$lib/pb-sync/collection";
import { db } from "$lib/pb-sync/db";
import { pb } from "$lib/pocketbase/pb";
import { networkStore } from "$lib/stores/networkStore.svelte";
import type { PlanningMaster, PlanningOccurrence } from "$lib/types/planning.types";

let activeSubscriptionCount = 0;

function notifySubscriptionChange(active: boolean) {
	activeSubscriptionCount += active ? 1 : -1;
	if (activeSubscriptionCount < 0) activeSubscriptionCount = 0;
	networkStore.setHasActiveSubscription(activeSubscriptionCount > 0);
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
		onSubscriptionChange: notifySubscriptionChange
	}
);

export const occurrencesCollection = createSyncCollection<PlanningOccurrence>(
	pb,
	db.occurrences,
	"planning_occurrences",
	{
		onSubscriptionChange: notifySubscriptionChange
	}
);
