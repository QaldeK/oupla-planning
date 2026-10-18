/**
 * Séquence de données post-auth, à propriétaire unique.
 *
 * Ordre possédé ici : fetch des masters → fetch des occurrences actives →
 * marqueur de fraîcheur. Le marqueur appartient au store (ADR-0009) et est
 * injecté ; son moment appartient à ce module.
 *
 * Aucun `try/catch` interne : un fetch qui échoue interrompt la séquence, donc
 * ne pose pas le marqueur. La politique d'erreur (poursuivre ou propager)
 * appartient à l'appelant.
 */
import { fetchAllMasters, syncActiveOccurrences } from "$lib/data/planningSync";

/** Surcharge des deux fetch — réservée aux tests. */
export interface AuthDataSyncDeps {
	fetchMasters: () => Promise<void>;
	fetchOccurrences: () => Promise<void>;
}

/**
 * Re-synchronise les données du compte puis marque leur fraîcheur.
 *
 * @param markSynced Écrivain du marqueur de fraîcheur (`userStore.markAuthSynced`).
 * @param deps Surcharge des fetch (tests).
 * @throws si un fetch ou le marqueur échoue — le marqueur n'est pas posé.
 */
export async function syncAuthData(
	markSynced: () => Promise<void>,
	deps: Partial<AuthDataSyncDeps> = {}
): Promise<void> {
	await (deps.fetchMasters ?? fetchAllMasters)();
	await (deps.fetchOccurrences ?? syncActiveOccurrences)();
	await markSynced();
}
