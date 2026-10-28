/**
 * Politique de re-sync des données planning : toute re-sync refetch COMPLET
 * les records sélectionnés, bornés par `date` — une donnée métier immuable,
 * jamais produite par l'horloge locale. Sans curseur temporel client
 * (décision : ADR 0017 ; application : `data/planningSync.ts`).
 */
import { isoDateDaysAgo } from "./date";

/** Fenêtre de la re-sync de routine : aujourd'hui + futur + marge (jours). */
export const SYNC_RECENT_WINDOW_DAYS = 2;

/** Occurrences passées ramenées par le fetch archive (les plus récentes). */
export const ARCHIVE_FETCH_LIMIT = 100;

/**
 * `since` neutre : neutralise la clause `updated > {:since}` de initialFetch
 * pour que seules les bornes `date` du filtre utilisateur s'appliquent.
 * (2000, pas 1970 : une borne antérieure à toute donnée suffit.)
 */
export const UNBOUNDED_SINCE = "2000-01-01 00:00:00";

/**
 * Filtre utilisateur de la re-sync de routine : occurrences actives (futur +
 * marge de `SYNC_RECENT_WINDOW_DAYS` jours). Tuple paramétré pour pb.filter.
 * Sans masterId : mode auth (les API Rules filtrent déjà par planning).
 */
export function recentOccurrencesFilter(
	masterId?: string,
): [template: string, vars: Record<string, unknown>] {
	return masterId
		? [
				"master = {:masterId} && date >= {:minDate}",
				{ masterId, minDate: isoDateDaysAgo(-SYNC_RECENT_WINDOW_DAYS) },
			]
		: ["date >= {:minDate}", { minDate: isoDateDaysAgo(-SYNC_RECENT_WINDOW_DAYS) }];
}

/**
 * Filtre du fetch archive : occurrences antérieures à demain — borne robuste
 * à la normalisation PB du champ `date` (datetime "YYYY-MM-DD 00:00:00.000Z",
 * une borne `date <= J` en TEXT exclurait J lui-même).
 */
export function archiveOccurrencesFilter(
	masterId: string,
): [template: string, vars: Record<string, unknown>] {
	return ["master = {:masterId} && date < {:maxDate}", { masterId, maxDate: isoDateDaysAgo(-1) }];
}
