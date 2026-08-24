/// <reference path="../pb_data/types.d.ts" />
/**
 * Utilitaires partagés pour les notifications push.
 *
 * Ces fonctions et constantes sont extraites dans un module require()-able car
 * les handlers JSVM (cronAdd, onRecord*, routerAdd) s'exécutent dans des
 * contextes isolés : une fonction déclarée au top-level d'un `.pb.js` n'est PAS
 * visible depuis le callback. Le pattern projet est de factoriser les helpers
 * dans un `*-utils.js` et de les `require()` au début du handler.
 *
 * Contenu :
 *  - Constantes (seuils, base URL, ensembles de types d'events)
 *  - Construction du payload missings (presentCount, tasksToFill, etc.)
 *  - Résolution des noms de tâches user ("Préparer salle (avant)")
 *  - Rendu push (titre + corps court) — utilisé par le cron ET par le hook
 *    `notify-on-occurrence-update.pb.js` pour les push immédiats
 *  - Les helpers de parsing/dates sont dans `pb-helpers.cjs` et `notify-utils.cjs`
 */

const { parseJsonArray, resolveMinPresentRequired } = require(`${__hooks}/pb-helpers.cjs`);
const { formatDateFR } = require(`${__hooks}/notify-utils.cjs`);
const {
	MAX_CONTENT_PREVIEW,
	TASK_TYPE_LABEL,
	JX_EVENT_TYPES,
	MISSING_EVENT_TYPES,
	buildContentPreview
} = require(`${__hooks}/notification-core.cjs`);

const MAX_SMTP_FAILURES = 3;

const BASE_URL = 'https://planning.oupla.net';

/** Timestamp courant au format PocketBase "YYYY-MM-DD HH:MM:SS.000Z". */
function nowIsoCompat() {
	return new Date().toISOString().replace('T', ' ');
}

/**
 * Calcule le payload event-level (counts pour missings).
 * Identique pour tous les destinataires de l'event. Le payload user-level
 * (response, tasks) est ajouté séparément par le cron d'envoi.
 *
 * Compteurs : present, if_needed, maybe. Les `absent` et les sans-réponse
 * ne sont pas comptés — les guests (sans userId) ne sont pas destinataires
 * email, donc les inclure dans "sans-réponse" donnerait à l'admin une image
 * trompeuse. KISS : on n'affiche que les réponses positives.
 */
function buildEventPayload(event, master, occ) {
	const type = event.type;
	if (!MISSING_EVENT_TYPES.has(type)) return null;

	const responses = parseJsonArray(occ, 'responses');
	const tasks = parseJsonArray(occ, 'tasks');
	const minRequired = resolveMinPresentRequired(occ, master);

	let present = 0;
	let ifNeeded = 0;
	let maybe = 0;
	for (const r of responses) {
		if (!r || !r.participantId) continue;
		if (r.response === 'present') present++;
		else if (r.response === 'if_needed') ifNeeded++;
		else if (r.response === 'maybe') maybe++;
	}

	const tasksToFill = [];
	for (const t of tasks) {
		if (!t || !t.id) continue;
		const required = Number(t.requiredVolunteers) || 0;
		if (required <= 0) continue;
		let signedUp = 0;
		for (const r of responses) {
			if (r && Array.isArray(r.tasks) && r.tasks.indexOf(t.id) !== -1) signedUp++;
		}
		if (signedUp < required) {
			tasksToFill.push({
				name: t.name || 'Tâche',
				type: t.type || '',
				signedUp,
				required
			});
		}
	}

	return {
		presentCount: present,
		ifNeededCount: ifNeeded,
		maybeCount: maybe,
		minPresentRequired: minRequired,
		tasksToFill
	};
}

/**
 * Résout les noms formatés des tâches d'un user sur une occ.
 * Retourne ["Préparer salle (avant)", "Accueil (pendant)"] par exemple.
 */
function resolveUserTaskNames(taskIds, occTasks) {
	if (!Array.isArray(taskIds) || taskIds.length === 0) return [];
	const result = [];
	for (const id of taskIds) {
		const t = occTasks.find((x) => x && x.id === id);
		if (!t) continue;
		const label = TASK_TYPE_LABEL[t.type] || t.type || '';
		const name = t.name || 'Tâche';
		result.push(label ? `${name} (${label})` : name);
	}
	return result;
}

/** Mapping type d'event → préfixe du titre de notification push. */
const PUSH_TITLE_PREFIX = {
	reminder: 'Rappel',
	quorum_missing: 'Participants manquants',
	task_unassigned: 'Participants manquants',
	confirmation_needed: 'À confirmer',
	status_canceled: 'Annulation',
	status_deleted: 'Annulation',
	schedule_change: 'Modification',
	status_confirmed: 'Confirmé',
	new_comment: 'Nouveau message'
};

/** Titre court d'un push par type d'event (J-X ET change events). */
function buildPushTitle(event, master) {
	const title = master.getString('title') || 'Planning';
	const prefix = PUSH_TITLE_PREFIX[event.type];
	return prefix ? `${prefix} — ${title}` : title;
}



/** Corps court d'un push : date + horaire + message spécifique (pas de lieu). */
function buildPushBody(event, occ, recipient, occTasks) {
	// `new_comment` : pas de préfixe date/horaire — on renvoie directement
	// "{auteur} : {aperçu}" pour un push compact et immédiatement lisible.
	if (event.type === 'new_comment') {
		const p = event.payload && typeof event.payload === 'object' ? event.payload : {};
		const author = p.authorName || '';
		const preview = buildContentPreview(p.contentPreview);
		return author ? `${author} : ${preview}` : preview;
	}

	const date = formatDateFR(occ.getString('date'));
	const startTime = event.type === 'status_canceled' || event.type === 'status_deleted'
		? '' : occ.getString('startTime');
	const parts = [];

	if (date) parts.push(date);
	if (startTime) parts.push(startTime);

	switch (event.type) {
		case 'reminder': {
			if (recipient.response === 'present') {
				parts.push('Vous êtes présent·e');
			}
			const myTaskIds = Array.isArray(recipient.tasks) ? recipient.tasks : [];
			const myTaskNames = resolveUserTaskNames(myTaskIds, occTasks);
			if (myTaskNames.length > 0) {
				// On retire le suffixe "(avant)" pour le push (trop long).
				const cleaned = myTaskNames.map((n) => n.replace(/ \([^)]*\)/g, ''));
				parts.push(`Vous gérez « ${cleaned.join(', ')} »`);
			}
			break;
		}
		case 'quorum_missing':
		case 'task_unassigned':
			parts.push('Participants manquants');
			break;
		case 'confirmation_needed':
			parts.push('À confirmer');
			break;
		case 'status_canceled':
			parts.push('Événement annulé');
			break;
		case 'status_deleted':
			parts.push('Événement supprimé');
			break;
		case 'schedule_change':
			parts.push('Événement modifié');
			break;
		case 'status_confirmed':
			parts.push('Événement confirmé');
			break;
	}

	return parts.join(' — ');
}

module.exports = {
	MAX_SMTP_FAILURES,
	BASE_URL,
	MAX_CONTENT_PREVIEW,
	TASK_TYPE_LABEL,
	JX_EVENT_TYPES,
	MISSING_EVENT_TYPES,
	PUSH_TITLE_PREFIX,
	nowIsoCompat,
	buildEventPayload,
	resolveUserTaskNames,
	buildPushTitle,
	buildContentPreview,
	buildPushBody,
	// Ré-exporte depuis pb-helpers.cjs pour compatibilité avec les consommateurs existants
	parseJsonArray,
	resolveMinPresentRequired
};
