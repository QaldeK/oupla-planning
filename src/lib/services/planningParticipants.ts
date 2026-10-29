import { pb } from "$lib/pocketbase/pb";
import type { RecurrenceType } from "$lib/types/planning.types";
import type { PlanningParticipantsResponse } from "$lib/types/pocketbase-types";
import { getDefaultPlanningPrefs, type PlanningParticipantPrefs } from "./push";

/**
 * Cette erreur PocketBase signifie-t-elle « enregistrement inexistant » ?
 * Seule la 404 répond oui : interpréter une erreur réseau ou serveur comme
 * une absence, c'est créer un doublon derrière une ligne qui existe déjà.
 */
function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"status" in error &&
		(error as { status?: unknown }).status === 404
	);
}

function participantFilter(planningId: string, userId: string): string {
	return `planning = "${planningId}" && user = "${userId}"`;
}

/**
 * Lit la ligne de préférences d'un couple (planning, user), null si absente.
 * Toute erreur non-404 propage : l'absence ne se devine pas.
 */
async function findParticipant(
	planningId: string,
	userId: string,
): Promise<PlanningParticipantsResponse | null> {
	try {
		return await pb
			.collection("planning_participants")
			.getFirstListItem(participantFilter(planningId, userId));
	} catch (error) {
		if (isNotFound(error)) return null;
		throw error;
	}
}

/**
 * Crée la ligne si absente. En cas de course perdue (contrainte d'unicité en
 * base), relit la ligne gagnante : la postcondition « une ligne existe pour ce
 * couple » tient sans que l'appelant voie l'échec. Si la relecture ne trouve
 * rien, l'erreur d'origine propage — c'était une vraie validation, pas une
 * course.
 */
async function createParticipantIfAbsent(
	planningId: string,
	userId: string,
	recurrenceType: RecurrenceType,
	isAdmin: boolean,
	prefs: Partial<PlanningParticipantPrefs> = {},
): Promise<PlanningParticipantsResponse> {
	try {
		return await pb.collection("planning_participants").create({
			planning: planningId,
			user: userId,
			...getDefaultPlanningPrefs(recurrenceType, isAdmin),
			...prefs,
		});
	} catch (error) {
		const winner = await findParticipant(planningId, userId);
		if (winner) return winner;
		throw error;
	}
}

/**
 * Récupère les préférences de notification d'un participant pour un planning.
 * Retourne null uniquement si la ligne n'existe pas (404) ; une erreur réseau
 * ou serveur propage à l'appelant.
 */
export async function getParticipantPrefs(
	planningId: string,
	userId: string,
): Promise<PlanningParticipantsResponse | null> {
	return await findParticipant(planningId, userId);
}

/**
 * Met à jour les préférences de notification d'un participant pour un planning.
 * Crée le record s'il n'existe pas, en appliquant les defaults liés au
 * `recurrenceType` du master (rappel / missings J-X) et au rôle pour
 * `newCommentScope` et `onConfirmationNeeded`.
 */
export async function updateParticipantPrefs(
	planningId: string,
	userId: string,
	prefs: Partial<PlanningParticipantPrefs>,
	recurrenceType: RecurrenceType = "WEEKLY",
	isAdmin = false,
): Promise<PlanningParticipantsResponse> {
	if (!pb.authStore.isValid || !pb.authStore.record) {
		throw new Error("Utilisateur non connecté");
	}

	const existing = await findParticipant(planningId, userId);

	if (existing) {
		return await pb.collection("planning_participants").update(existing.id, prefs);
	}
	return await createParticipantIfAbsent(planningId, userId, recurrenceType, isAdmin, prefs);
}

/**
 * Assure qu'un user authentifié a un record dans `planning_participants`.
 * Ne réécrit jamais une ligne existante. Idempotent, y compris en course :
 * deux appels concurrents finissent avec une seule ligne — l'index unique en
 * base tranche, le perdant relit le gagnant.
 */
export async function ensurePlanningParticipant(
	planningId: string,
	userId: string,
	recurrenceType: RecurrenceType = "WEEKLY",
	isAdmin = false,
): Promise<void> {
	const existing = await findParticipant(planningId, userId);
	if (existing) return;
	await createParticipantIfAbsent(planningId, userId, recurrenceType, isAdmin);
}
