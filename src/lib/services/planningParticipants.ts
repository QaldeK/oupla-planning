import { pb } from '$lib/pocketbase/pb';
import { getDefaultPlanningPrefs, type PlanningParticipantPrefs } from './push';
import type { PlanningParticipantsResponse } from '$lib/types/pocketbase-types';
import type { RecurrenceType } from '$lib/types/planning.types';

/**
 * Récupère les préférences de notification d'un participant pour un planning
 */
export async function getParticipantPrefs(
	planningId: string,
	userId: string
): Promise<PlanningParticipantsResponse | null> {
	try {
		return await pb
			.collection('planning_participants')
			.getFirstListItem(`planning = "${planningId}" && user = "${userId}"`);
	} catch {
		return null;
	}
}

/**
 * Met à jour les préférences de notification d'un participant pour un planning.
 * Crée le record s'il n'existe pas, en appliquant les defaults liés au
 * `recurrenceType` du master (rappel / missings J-X) et au rôle pour
 * `newCommentScope`.
 */
export async function updateParticipantPrefs(
	planningId: string,
	userId: string,
	prefs: Partial<PlanningParticipantPrefs>,
	recurrenceType: RecurrenceType = 'WEEKLY',
	isAdmin = false
): Promise<PlanningParticipantsResponse> {
	if (!pb.authStore.isValid || !pb.authStore.record) {
		throw new Error('Utilisateur non connecté');
	}

	const existing = await getParticipantPrefs(planningId, userId);

	if (existing) {
		return await pb.collection('planning_participants').update(existing.id, prefs);
	} else {
		return await pb.collection('planning_participants').create({
			planning: planningId,
			user: userId,
			...getDefaultPlanningPrefs(recurrenceType, isAdmin),
			...prefs
		});
	}
}

/**
 * Assure qu'un user authentifié a un record dans `planning_participants`.
 * Crée le record avec les préférences par défaut liées au `recurrenceType`
 * et au rôle (admin → `newCommentScope: 'all'`, sinon `'concerned'`) s'il
 * n'existe pas.
 */
export async function ensurePlanningParticipant(
	planningId: string,
	userId: string,
	recurrenceType: RecurrenceType = 'WEEKLY',
	isAdmin = false
): Promise<void> {
	try {
		await pb
			.collection('planning_participants')
			.getFirstListItem(`planning = "${planningId}" && user = "${userId}"`);
		return;
	} catch {
		await pb.collection('planning_participants').create({
			planning: planningId,
			user: userId,
			...getDefaultPlanningPrefs(recurrenceType, isAdmin)
		});
	}
}
