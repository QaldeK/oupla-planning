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
	MISSING_EVENT_TYPES,
	buildContentPreview
};
