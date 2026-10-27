/// <reference path="../pb_data/types.d.ts" />
/**
 * Politique de consommation de la file `notification_events` et du registre
 * `notification_deliveries` (phase 2 du cron).
 *
 * Contrat de `processedAt` : état TERMINAL — « cet event ne sera plus jamais
 * touché ». La terminalité se déduit du registre de livraison : un event est
 * consommé quand toutes ses deliveries ont leurs deux canaux réglés (envoyé
 * ou waivé), d'emblée s'il n'en a aucune (espace vide de destinataires).
 * Les états de fin d'une delivery sont tous explicites : envoyée, waivée
 * (opt-out, déjà lu, départ durable, clôture de mort), ou dûe — la seule
 * survie dûe autorisée est l'attente de retry email (SMTP down), bornée par
 * le garde d'obsolescence.
 *
 * ⚠️ La terminalité ne se déduit QUE pour les events qui ont passé le fan-out
 * du run (garde anti « 0 deliveries dues » : un event au fan-out sauté —
 * participants illisibles — serait sinon consommé à tort). C'est la
 * responsabilité du caller, pas de `isEventTerminal`.
 *
 * Module PUR : pas d'accès DB, pas de logging, horloge injectée. Requiert
 * uniquement des helpers résolvables par Node (testable hors JSVM).
 */

const { computeDaysUntil } = require(`${__hooks}/pb-helpers.cjs`);
const { CHANGE_EVENT_TYPES } = require(`${__hooks}/notification-core.cjs`);

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
 * Une delivery est réglée quand chacun de ses canaux est envoyé ou waivé.
 * '' sur un canal = dû (l'email attend son envoi ou son retry).
 *
 * @param {object} d — plain object des quatre marques de la row
 * @returns {boolean}
 */
function isDeliverySettled(d) {
	return !!(d.emailSentAt || d.emailWaivedAt) && !!(d.pushSentAt || d.pushWaivedAt);
}

/**
 * Prédicat étroit du reaper : le départ du planning est-il durable ?
 * Durable = le userId n'apparaît plus dans `master.participants`, ou toutes
 * ses entrées portent `hasQuit` (une seule entrée active suffit à garder la
 * ligne due — cas hasQuit + ré-inscription). Jamais vrai pour une response
 * (`absent` réversible) ou une pref : ces états restent évalués à chaud.
 * Liste indéterminée (null) → jamais un départ durable (on ne waive pas
 * à l'aveugle).
 *
 * @param {Array<{userId: string, hasQuit?: boolean}>|null} participants
 *        — tableau `master.participants` parsé
 * @param {string} userId
 * @returns {boolean}
 */
function isDepartureDurable(participants, userId) {
	if (!Array.isArray(participants)) return false;
	for (const p of participants) {
		if (!p || p.userId !== userId) continue;
		if (!p.hasQuit) return false;
	}
	return true;
}

/**
 * Terminalité d'un event : toutes ses deliveries sont réglées. Un event sans
 * delivery (espace vide de destinataires, ou aucun canal actif) est consommé
 * d'emblée — SAUF si son fan-out a échoué, même partiellement : un tableau
 * vide produit par des écritures ratées n'est pas un espace vide de
 * destinataires, et une ligne manquante est invisible de la dérivation. À
 * n'appeler que pour les events passés par le fan-out du run.
 *
 * @param {Array<object>} deliveries — plain objects des marques, TOUTES les
 *        lignes de l'event (dues comme réglées)
 * @param {object} [opts]
 * @param {number} [opts.fanoutFailed=0] — échecs d'upsert du fan-out de ce
 *        run pour cet event
 * @returns {boolean}
 */
function isEventTerminal(deliveries, opts = {}) {
	if (opts.fanoutFailed) return false;
	return deliveries.every(isDeliverySettled);
}

module.exports = { classifyPendingEvent, isDeliverySettled, isDepartureDurable, isEventTerminal };
