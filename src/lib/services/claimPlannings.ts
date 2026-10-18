/**
 * Claim de plannings : rattache des plannings connus localement au compte
 * authentifié courant, en présentant leurs tokens au hook serveur idempotent
 * `/api/sync-plannings`.
 *
 * Module neutre : n'importe que le client PocketBase, aucun store ni service.
 * C'est ce qui le rend importable par les stores et les services sans créer de
 * cycle d'import (cf. ADR-0009).
 */
import { pb } from "$lib/pocketbase/pb";

/** Planning à revendiquer, réduit à ce que le endpoint attend. */
export interface ClaimablePlanning {
	id: string;
	participantToken?: string;
	adminToken?: string;
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
				adminToken: master.adminToken
			}))
		}
	});
}
