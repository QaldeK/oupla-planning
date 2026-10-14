/**
 * Opérations de re-sync des données planning : fetchs complets bornés par
 * `date` (donnée métier immuable, jamais produite par l'horloge locale),
 * appliquant la politique de `utils/syncWindow.ts` — décision : ADR 0017.
 *
 * Toute re-sync passe par ce module, jamais par `initialFetch` directement :
 * l'invariant « sans curseur temporel client » vit ici, structurellement.
 */
import {
	ARCHIVE_FETCH_LIMIT,
	archiveOccurrencesFilter,
	recentOccurrencesFilter,
	UNBOUNDED_SINCE
} from "$lib/utils/syncWindow";
import { mastersCollection, occurrencesCollection } from "./collections";

/** Fetch complet des masters accessibles (les API Rules filtrent par user). */
export async function fetchAllMasters(): Promise<void> {
	await mastersCollection.initialFetch({ since: UNBOUNDED_SINCE });
}

export interface SyncActiveOccurrencesOptions {
	/** Scope per-master (planning actif côté page). Absent : global auth. */
	masterId?: string;
	/** Token query param (requis côté guest ; absent en mode auth). */
	token?: string;
}

/**
 * Re-sync de routine des occurrences actives : fetch complet sur la fenêtre
 * `date >= J-2`. Converge vers le serveur même si une tentative précédente a
 * échoué silencieusement — pas de curseur à réparer.
 */
export async function syncActiveOccurrences(
	options?: SyncActiveOccurrencesOptions
): Promise<void> {
	await occurrencesCollection.initialFetch({
		filter: recentOccurrencesFilter(options?.masterId),
		...(options?.token ? { query: { _token: options.token } } : {}),
		since: UNBOUNDED_SINCE
	});
}

/**
 * Fetch du passé récent pour la page archive : occurrences antérieures à
 * demain, les plus récentes d'abord, borné à `ARCHIVE_FETCH_LIMIT`.
 */
export async function fetchRecentPastOccurrences(
	masterId: string,
	token: string
): Promise<void> {
	await occurrencesCollection.initialFetch({
		filter: archiveOccurrencesFilter(masterId),
		query: { _token: token },
		since: UNBOUNDED_SINCE,
		sort: "-date",
		limit: ARCHIVE_FETCH_LIMIT
	});
}
