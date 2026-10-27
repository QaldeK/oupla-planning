/// <reference path="../pb_data/types.d.ts" />
/**
 * Constantes et helpers partagés du sous-système de notifications.
 *
 * Source de vérité unique pour les valeurs utilisées à la fois par le cron
 * (notification-cron-utils), les templates email (notify-templates),
 * le détecteur de commentaires (new-comment-detector) et le calcul des
 * destinataires (notification-recipients).
 */

/** Longueur maximale du contenu d'un message exposé dans les notifications (push + email). */
const MAX_CONTENT_PREVIEW = 130;

/** Map clé `tasks[].type` → label français. */
const TASK_TYPE_LABEL = {
	beforeEvent: 'avant',
	onEvent: 'pendant',
	afterEvent: 'après'
};

const JX_EVENT_TYPES = new Set([
	'reminder',
	'quorum_missing',
	'task_unassigned',
	'confirmation_needed'
]);

/**
 * Types d'events issus du hook occurrence-update : l'état de l'occurrence
 * (annulée, supprimée…) EST la nouvelle à délivrer — un event de ce groupe
 * reste consommable même si l'occ est passée en deleted/isCanceled depuis
 * son insertion.
 */
const CHANGE_EVENT_TYPES = new Set([
	'status_canceled',
	'status_deleted',
	'schedule_change',
	'status_confirmed'
]);

/** Fallback générique d'auteur dans les notifications (email agrégé + terminal). */
const UNKNOWN_AUTHOR = 'un·e administrateur·ice';

const MISSING_EVENT_TYPES = new Set(['quorum_missing', 'task_unassigned']);

/**
 * Aperçu single-line tronqué d'un contenu de message.
 * Les sauts de ligne (et espaces environnants) sont collapés en une espace, puis
 * le texte est tronqué à MAX_CONTENT_PREVIEW caractères avec ellipsis.
 */
function buildContentPreview(content) {
	const single = String(content || '').replace(/\s*\n\s*/g, ' ').trim();
	if (single.length <= MAX_CONTENT_PREVIEW) return single;
	return single.slice(0, MAX_CONTENT_PREVIEW) + '…';
}

module.exports = {
	MAX_CONTENT_PREVIEW,
	TASK_TYPE_LABEL,
	JX_EVENT_TYPES,
	CHANGE_EVENT_TYPES,
	MISSING_EVENT_TYPES,
	UNKNOWN_AUTHOR,
	buildContentPreview
};
