import { pb } from '$lib/pocketbase/pb';
import { defaultPlanningPrefs, type PlanningParticipantPrefs } from './push';
import type { PlanningParticipantsResponse } from '$lib/types/pocketbase-types';
import { userStore } from '$lib/stores/userStore.svelte';

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
 * Met à jour les préférences de notification d'un participant pour un planning
 * Crée le record s'il n'existe pas
 */
export async function updateParticipantPrefs(
	planningId: string,
	userId: string,
	prefs: Partial<PlanningParticipantPrefs>
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
			...defaultPlanningPrefs,
			...prefs
		});
	}
}

/**
 * Assure qu'un user authentifié a un record dans planning_participants
 * Crée le record avec les préférences par défaut s'il n'existe pas
 */
export async function ensurePlanningParticipant(planningId: string, userId: string): Promise<void> {
	try {
		// Vérifier si le participant existe déjà
		await pb
			.collection('planning_participants')
			.getFirstListItem(`planning = "${planningId}" && user = "${userId}"`);
		// Existe déjà → ne rien faire
		return;
	} catch {
		// N'existe pas → créer avec les préférences par défaut
		await pb.collection('planning_participants').create({
			planning: planningId,
			user: userId,
			...defaultPlanningPrefs
		});
	}
}
