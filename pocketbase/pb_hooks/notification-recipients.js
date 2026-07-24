/// <reference path="../pb_data/types.d.ts" />
/**
 * Calcul des destinataires d'un event de notification.
 *
 * Ce helper prend un event + le contexte (master, occurrence, prefs participants)
 * et retourne la liste des destinataires effectifs, en appliquant :
 *   - la matrice de destinataires par type (présent / !absent / sans-réponse / admin)
 *   - les prefs individuelles métier (reminderDays, missingDays, onOccurrenceChange,
 *     onConfirmationNeeded)
 *   - le filtre hasQuit (participants ayant quitté le planning exclus)
 *
 * NOTE : le filtre par canal (email/push) n'est PAS appliqué ici — il est géré
 * au point d'usage (cron-notifications.pb.js). Cela permet d'utiliser le même
 * tableau de destinataires pour les deux canaux, chacun filtrant indépendamment
 * selon sa pref (email:true / push:true).
 *
 * Le helper est PUR : pas d'accès DB, pas de logging. Toutes les données
 * nécessaires sont passées en paramètre.
 *
 * Mapping user ↔ participant : les destinataires email sont les participants
 * authentifiés (`participant.userId` défini). Le `participantId` peut être
 * différent du `userId` PocketBase (cas d'un guest revendiqué ultérieurement).
 * Pour identifier la response d'un user sur une occ, on passe par
 * `participantId`, pas par `userId`.
 */

const { parseJsonArray } = require(`${__hooks}/pb-helpers.cjs`);

/** Types d'events issus du hook update (C2) — déclenchés par `onOccurrenceChange`. */
const CHANGE_EVENT_TYPES = [
	'status_canceled',
	'status_deleted',
	'schedule_change',
	'status_confirmed'
];

/** Types d'events issus du cron J-X (C3). */
const JX_EVENT_TYPES = ['reminder', 'quorum_missing', 'task_unassigned', 'confirmation_needed'];

/** Types d'events missings (sous-ensemble de JX_EVENT_TYPES). */
const MISSING_EVENT_TYPES = ['quorum_missing', 'task_unassigned'];

/** Catégories de filtre response par type d'event. */
const RESPONSE_FILTER = {
	// `onOccurrenceChange` : !absent (présent, peut-être, si-besoin), pas les sans-réponse.
	schedule_change: 'not-absent',
	status_canceled: 'not-absent',
	status_deleted: 'not-absent',
	status_confirmed: 'not-absent',
	// `reminder` : présent OU inscrit tâche.
	reminder: 'present-or-task',
	// `missings` : !absent + sans-réponse.
	quorum_missing: 'not-absent-or-noreply',
	task_unassigned: 'not-absent-or-noreply',
	// `confirmation_needed` : pas de filtre response (admin uniquement, filtré via pref).
	confirmation_needed: 'all'
};

const ABSENT = 'absent';
const PRESENT = 'present';

/**
 * Extrait les participants actifs authentifiés du master.
 * "Actif" = `hasQuit !== true` et `userId` défini (sinon pas de destinataire email).
 * @returns {Array<{id, userId, name}>}
 */
function extractActiveAuthParticipants(master) {
	const all = parseJsonArray(master, 'participants');
	const result = [];
	for (const p of all) {
		if (!p || !p.userId || p.hasQuit) continue;
		result.push({ id: p.id, userId: p.userId, name: p.name || '' });
	}
	return result;
}

/**
 * Trouve la row `planning_participants` correspondant à un userId.
 * @param {core.Record[]} planningParticipants — records planning_participants
 * @param {string} userId
 * @returns {core.Record|null}
 */
function findPlanningParticipant(planningParticipants, userId) {
	for (const pp of planningParticipants) {
		if (pp.getString('user') === userId) return pp;
	}
	return null;
}

/** True si la pref `day` est présente dans le select multiple `field`. */
function prefersDay(planningParticipant, day, field) {
	if (!planningParticipant) return false;
	const target = String(day);
	const days = planningParticipant.getStringSlice(field);
	return !!days && days.indexOf(target) !== -1;
}

/**
 * Vérifie si un user est destinataire selon sa response et le filtre du type d'event.
 * @param {string|null} responseType — 'present'|'if_needed'|'maybe'|'absent'|null (sans-réponse)
 * @param {string[]} userTasks — IDs de tâches assignées
 * @param {string} filter — clé de RESPONSE_FILTER
 * @returns {boolean}
 */
function matchesResponseFilter(responseType, userTasks, filter) {
	switch (filter) {
		case 'all':
			return true;
		case 'present-or-task':
			return responseType === PRESENT || (Array.isArray(userTasks) && userTasks.length > 0);
		case 'not-absent':
			return responseType === 'present' || responseType === 'if_needed' || responseType === 'maybe';
		case 'not-absent-or-noreply':
			return responseType !== ABSENT; // null (sans-réponse), present, if_needed, maybe acceptés
		default:
			return false;
	}
}

/**
 * Détermine la pref à vérifier pour un event donné, en plus du canal `email`.
 * @returns {{field: string, value: string|boolean}|null}
 *   - null si pas de pref supplémentaire
 *   - {field: 'reminderDays', value: '3'} pour reminder
 *   - {field: 'missingDays', value: '3'} pour missings
 *   - {field: 'onOccurrenceChange', value: true} pour changes
 *   - {field: 'onConfirmationNeeded', value: true} pour confirmation
 */
function getPrefRequirement(event) {
	const X = String(event.reminderValue || 0);
	switch (event.type) {
		case 'reminder':
			return { field: 'reminderDays', value: X };
		case 'quorum_missing':
		case 'task_unassigned':
			return { field: 'missingDays', value: X };
		case 'status_canceled':
		case 'status_deleted':
		case 'schedule_change':
		case 'status_confirmed':
			return { field: 'onOccurrenceChange', value: true };
		case 'confirmation_needed':
			return { field: 'onConfirmationNeeded', value: true };
		default:
			return null;
	}
}

/**
 * Calcule les destinataires effectifs d'un event.
 *
 * @param {object} event — plain object `{type, reminderValue}` (ou plus complet)
 * @param {core.Record} master — record `planning_masters`
 * @param {core.Record[]} planningParticipants — records `planning_participants` du master
 * @param {core.Record} occurrence — record `planning_occurrences`
 * @returns {Array<{userId, participantId, response, tasks, email, push}>}
 *   - `response` : 'present'|'if_needed'|'maybe'|'absent'|null (sans-réponse)
 *   - `tasks` : tableau d'IDs de tâches assignées
 *   - `email`, `push` : booléens de la row `planning_participants` — le filtre
 *     par canal est délégué au consommateur via ces champs
 */
function computeRecipients(event, master, planningParticipants, occurrence) {
	const filter = RESPONSE_FILTER[event.type];
	if (!filter) return [];

	const activeParticipants = extractActiveAuthParticipants(master);
	if (activeParticipants.length === 0) return [];

	const responses = parseJsonArray(occurrence, 'responses');
	const prefRequirement = getPrefRequirement(event);

	const recipients = [];
	for (const ap of activeParticipants) {
		const pp = findPlanningParticipant(planningParticipants, ap.userId);
		if (!pp) continue;

		// NOTE : le filtre par canal (email/push) est appliqué au point d'usage
		// (cron-notifications.pb.js), pas ici. computeRecipients ne vérifie que
		// les préférences métier liées au type d'event (reminderDays, missingDays, etc.).

		// Vérification de la pref spécifique au type d'event
		if (prefRequirement) {
			const { field, value } = prefRequirement;
			if (field === 'reminderDays' || field === 'missingDays') {
				if (!prefersDay(pp, value, field)) continue;
			} else if (!pp.getBool(field)) {
				continue;
			}
		}

		// Récupération de la response de ce participant sur cette occ
		const userResp = responses.find((r) => r && r.participantId === ap.id);
		const responseType = userResp ? userResp.response || null : null;
		const userTasks = userResp && Array.isArray(userResp.tasks) ? userResp.tasks : [];

		// Filtre response selon la catégorie du type d'event
		if (!matchesResponseFilter(responseType, userTasks, filter)) continue;

		recipients.push({
			userId: ap.userId,
			participantId: ap.id,
			response: responseType,
			tasks: userTasks,
			email: pp.getBool('email'),
			push: pp.getBool('push')
		});
	}

	return recipients;
}

module.exports = {
	computeRecipients,
	// Constantes exportées pour introspection / tests
	CHANGE_EVENT_TYPES,
	JX_EVENT_TYPES,
	MISSING_EVENT_TYPES,
	RESPONSE_FILTER,
	// Internes exportés pour tests
	_extractActiveAuthParticipants: extractActiveAuthParticipants,
	_findPlanningParticipant: findPlanningParticipant,
	_prefersDay: prefersDay,
	_matchesResponseFilter: matchesResponseFilter,
	_getPrefRequirement: getPrefRequirement,
	_parseJsonArray: parseJsonArray
};
