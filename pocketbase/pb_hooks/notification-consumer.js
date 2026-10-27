/// <reference path="../pb_data/types.d.ts" />
/**
 * Politique de consommation de la file `notification_events` (phase 2 du cron).
 *
 * Contrat de `processedAt` : état TERMINAL — « cet event ne sera plus jamais
 * touché ». Trois chemins y conduisent :
 *   - mort-né ou obsolète (`classifyPendingEvent`) ;
 *   - consommé par email (tous ses buckets envoyés) ;
 *   - consommé sans email possible (aucun bucket email ne le porte).
 *
 * Le SEUL état non terminal est l'attente de retry email (SMTP en panne ou
 * circuit breaker) : l'event repart au prochain cron, borné par le garde
 * d'obsolescence — une occurrence passée tue l'event au run suivant.
 *
 * Module PUR : pas d'accès DB, pas de logging, horloge injectée. Requiert
 * uniquement des helpers résolvables par Node (testable hors JSVM).
 */

const { computeDaysUntil } = require(`${__hooks}/pb-helpers.cjs`);
const { CHANGE_EVENT_TYPES } = require(`${__hooks}/notification-core.cjs`);

/** Raisons de mort d'un event (compteur de log côté cron). */

/**
 * Classe un event pending au moment de sa préparation.
 *
 * Les change events font exception à la lecture de l'état de l'occurrence :
 * pour `status_canceled`/`status_deleted`, l'occ annulée/supprimée EST la
 * nouvelle à délivrer — l'event reste vivant. En revanche la garde
 * d'obsolescence s'applique à tous les types : une occurrence passée ne
 * justifie plus aucun envoi, quel que soit le canal de rattrapage.
 *
 * @param {object} p
 * @param {string} p.type — type de l'event
 * @param {core.Record|null} p.occ — record occurrence (null = introuvable)
 * @param {object|null} p.masterCtx — contexte master (null = master supprimé/introuvable)
 * @param {Date} p.now — horloge injectée (UTC)
 * @returns {{kind: 'dead', reason: string} | {kind: 'live'}}
 *   raisons : master_gone | occ_missing | occ_deleted | occ_canceled |
 *   stale_occurrence
 */
function classifyPendingEvent({ type, occ, masterCtx, now }) {
	if (!masterCtx) return { kind: 'dead', reason: 'master_gone' };
	if (!occ) return { kind: 'dead', reason: 'occ_missing' };
	if (!CHANGE_EVENT_TYPES.has(type)) {
		if (occ.getBool('deleted')) return { kind: 'dead', reason: 'occ_deleted' };
		if (occ.getBool('isCanceled')) return { kind: 'dead', reason: 'occ_canceled' };
	}
	if (computeDaysUntil(occ.getString('date'), now) < 0) {
		return { kind: 'dead', reason: 'stale_occurrence' };
	}
	return { kind: 'live' };
}

/**
 * Sépare les events vivants entre consommables et en attente de retry.
 *
 * @param {Array<{bucketKeys: string[]}>} items — un item par event, avec la
 *        liste des buckets email qui le portent (vide = aucun destinataire
 *        email éligible : le push est la seule livraison, l'event est
 *        consommé dès qu'il est parti).
 * @param {Set<string>} failedBucketKeys — buckets non envoyés (échec SMTP,
 *        template, circuit breaker) : leurs events attendent le prochain cron.
 * @returns {{terminal: object[], retry: object[]}}
 */
function splitTerminalItems(items, failedBucketKeys) {
	const terminal = [];
	const retry = [];
	for (const item of items) {
		const blocked = (item.bucketKeys || []).some((k) => failedBucketKeys.has(k));
		(blocked ? retry : terminal).push(item);
	}
	return { terminal, retry };
}

module.exports = { classifyPendingEvent, splitTerminalItems };
