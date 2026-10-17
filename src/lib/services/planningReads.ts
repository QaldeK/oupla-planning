import { ClientResponseError } from "pocketbase";
import { pb } from "$lib/pocketbase/pb";
import type { PlanningMaster } from "$lib/types/planning.types";

// Type de retour pour getPlanningByToken avec gestion d'erreur typée
export type GetPlanningByTokenResult =
	| { master: PlanningMaster; isAdmin: boolean }
	| { error: "network" | "not_found" };

export async function getPlanningByToken(token: string): Promise<GetPlanningByTokenResult> {
	try {
		const master = await pb
			.collection("planning_masters")
			.getFirstListItem<PlanningMaster>(
				`participantToken = "${token}" || adminToken = "${token}"`,
				{ query: { _token: token } }
			);

		// NOTE: adminToken est masqué par onRecordEnrich, donc on se base sur la longueur du token
		// AdminToken = 64 chars, ParticipantToken = 32 chars
		return { master, isAdmin: token.length === 64 };
	} catch (error: unknown) {
		if (error instanceof ClientResponseError && error.status === 404) {
			return { error: "not_found" };
		}

		// Annulation (auto-cancellation) → traiter comme réseau
		// biome-ignore lint/suspicious/noExplicitAny: isAbort est une propriété non-standard d'annulation
		if (error instanceof Error && "isAbort" in error && (error as any).isAbort) {
			return { error: "network" };
		}

		// Toutes les autres erreurs (réseau, timeout, 500, etc.) → erreur réseau
		return { error: "network" };
	}
}
