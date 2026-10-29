/**
 * Claim de plannings : rattache des plannings connus localement au compte
 * authentifié courant, en présentant leurs tokens au hook serveur idempotent
 * `/api/sync-plannings`.
 *
 * Module neutre : n'importe que le client PocketBase, aucun store ni service.
 * C'est ce qui le rend importable par les stores et les services sans créer de
 * cycle d'import.
 */
import { pb } from "$lib/pocketbase/pb";

/** Planning à revendiquer, réduit à ce que le endpoint attend. */
export interface ClaimablePlanning {
	id: string;
	participantToken?: string;
	adminToken?: string;
}

/**
 * Candidat au portage du mur d'authentification : master local non supprimé.
 * Définition unique — le mur (visibilité de la bascule) et la transition
 * (claim batch) doivent juger sur le même prédicat.
 */
export function isPortageCandidate(master: { deleted?: boolean }): boolean {
	return !master.deleted;
}

/**
 * Revendique des plannings pour le compte courant.
 *
 * Lève si l'appel échoue : la politique d'erreur (statut dégradé, ou échec
 * fatal remonté au caller) appartient à l'appelant.
 */
export async function claimPlannings(masters: ClaimablePlanning[]): Promise<void> {
	await pb.send("/api/sync-plannings", {
		method: "POST",
		body: {
			tokens: masters.map((master) => ({
				masterId: master.id,
				participantToken: master.participantToken,
				adminToken: master.adminToken,
			})),
		},
	});
}
