/// <reference path="../pb_data/types.d.ts" />
/**
 * Détecteur d'events J-X (rappels, missings, confirmation) pour une occurrence.
 *
 * Le cron quotidien `notifications-phase1` appelle ce helper pour chaque occurrence
 * future dans la fenêtre de 20 jours. Le helper décide quels events doivent être
 * insérés dans `notification_events` en fonction du timing (J-X), des prefs
 * collectives des participants et de l'état courant de l'occurrence.
 *
 * Le helper est PUR : pas d'accès DB, pas de logging, pas de temps courant implicite.
 * `now` est injecté pour permettre des tests déterministes hors PocketBase.
 *
 * Les events insérés ne portent pas de userId (Modèle B) : C4 calcule les
 * destinataires finals au runtime selon les prefs individuelles. Les conditions
 * ci-dessous visent uniquement à éviter d'insérer des events mort-nés (sans
 * destinataire potentiel) et à respecter la sémantique de chaque type.
 *
 * Ordre des conditions : fail-fast (cheap → expensive) — comparaison mémoire
 * d'abord, puis lectures booléennes (master/occ), puis parsing JSON (responses/
 * tasks), puis itération sur les participants.
 */

const { parseJsonArray, readRecurrenceType, resolveMinPresentRequired } = require(
	`${__hooks}/pb-helpers.cjs`
);

/** Valeurs J-X possibles pour les events liés au timing. */
const JX_VALUES = [1, 3, 7, 15];

/** Valeurs J-X pour `confirmation_needed`, par `recurrenceType` du master. */
const CONFIRMATION_NEEDED_JX = {
	WEEKLY: [1, 3, 7],
	CUSTOM: [1, 3, 7],
	BIWEEKLY: [1, 3, 7, 15],
	MONTHLY_BY_DATE: [1, 3, 7, 15],
	MONTHLY_BY_DAY: [1, 3, 7, 15],
	DAILY: [1, 3, 7, 15]
};

/** Valeurs J-X autorisées pour `reminderDays` (plus restreint que missingDays). */
const REMINDER_JX_VALUES = [1, 3, 7];

/**
 * Nombre de jours entre `now` (UTC minuit) et la date de l'occurrence (UTC minuit).
 * Retourne un entier (positif pour une occ future, 0 pour aujourd'hui, négatif pour
 * le passé). Arrondi pour tolérer d'éventuels décalages sub-journaliers dans le
 * stockage PocketBase.
 */
function computeDaysUntil(occDateRaw, now) {
	if (!occDateRaw) return -1;
	const day = String(occDateRaw).split(' ')[0].split('T')[0];
	if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return -1;
	const occMs = new Date(`${day}T00:00:00Z`).getTime();
	if (Number.isNaN(occMs)) return -1;
	const todayUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	return Math.round((occMs - todayUtcMidnight) / (24 * 60 * 60 * 1000));
}

/** True si au moins un participant a `day` dans le champ `field` (select multiple). */
function atLeastOneParticipantWithDay(participants, day, field) {
	const target = String(day);
	for (const p of participants) {
		const days = p.getStringSlice(field);
		if (days && days.indexOf(target) !== -1) return true;
	}
	return false;
}

/** True si au moins un participant a activé `onConfirmationNeeded`. */
function atLeastOneAdminInterested(participants) {
	for (const p of participants) {
		if (p.getBool('onConfirmationNeeded')) return true;
	}
	return false;
}

/** True si au moins une response est `present` OU porte une tâche assignée. */
function hasEngagedResponse(responses) {
	for (const r of responses) {
		if (!r) continue;
		if (r.response === 'present') return true;
		if (Array.isArray(r.tasks) && r.tasks.length > 0) return true;
	}
	return false;
}

/** Compte les responses `present`. */
function countPresent(responses) {
	let count = 0;
	for (const r of responses) {
		if (r && r.response === 'present') count++;
	}
	return count;
}

/**
 * True si au moins une tâche a moins de volontaires que `requiredVolunteers`.
 * Les tâches sans `requiredVolunteers` (> 0) sont ignorées (pas d'exigence).
 */
function hasUnassignedTask(tasks, responses) {
	if (!tasks || tasks.length === 0) return false;
	for (const t of tasks) {
		if (!t || !t.id) continue;
		const required = Number(t.requiredVolunteers) || 0;
		if (required <= 0) continue;
		let volunteers = 0;
		for (const r of responses) {
			if (r && Array.isArray(r.tasks) && r.tasks.indexOf(t.id) !== -1) volunteers++;
		}
		if (volunteers < required) return true;
	}
	return false;
}

/**
 * Calcule les events J-X à insérer pour une occurrence.
 *
 * @param {core.Record} occurrence       — record `planning_occurrences`
 * @param {core.Record} master           — record `planning_masters` parent
 * @param {core.Record[]} participants   — records `planning_participants` du master
 * @param {Date} now                     — horloge injectée (UTC)
 * @returns {Array<{type: string, reminderValue: number}>} — events à insérer
 */
function detectJxEvents(occurrence, master, participants, now) {
	const daysUntil = computeDaysUntil(occurrence.getString('date'), now);
	if (daysUntil !== 1 && daysUntil !== 3 && daysUntil !== 7 && daysUntil !== 15) {
		return [];
	}

	const X = daysUntil;
	const events = [];

	// --- reminder ---
	// Ordre fail-fast : X ∈ univers reminder (cheap) → prefs participants → responses.
	if (X === 1 || X === 3 || X === 7) {
		if (atLeastOneParticipantWithDay(participants, X, 'reminderDays')) {
			const responses = parseJsonArray(occurrence, 'responses');
			if (hasEngagedResponse(responses)) {
				events.push({ type: 'reminder', reminderValue: X });
			}
		}
	}

	// --- missings (quorum + tâches) ---
	// Une seule vérification de pref couvre les deux sous-types missings.
	if (atLeastOneParticipantWithDay(participants, X, 'missingDays')) {
		const responses = parseJsonArray(occurrence, 'responses');
		const minRequired = resolveMinPresentRequired(occurrence, master);
		if (countPresent(responses) < minRequired) {
			events.push({ type: 'quorum_missing', reminderValue: X });
		}
		const tasks = parseJsonArray(occurrence, 'tasks');
		if (hasUnassignedTask(tasks, responses)) {
			events.push({ type: 'task_unassigned', reminderValue: X });
		}
	}

	// --- confirmation_needed ---
	// Ordre fail-fast : X dans CONFIRMATION_NEEDED_JX[type] → booléens master/occ
	// → itération participants.
	const recurrenceType = readRecurrenceType(master);
	const jxValues = CONFIRMATION_NEEDED_JX[recurrenceType] || CONFIRMATION_NEEDED_JX.WEEKLY;
	if (jxValues.indexOf(X) !== -1) {
		if (master.getBool('toConfirm')) {
			if (!occurrence.getBool('isConfirmed')) {
				if (atLeastOneAdminInterested(participants)) {
					events.push({ type: 'confirmation_needed', reminderValue: X });
				}
			}
		}
	}

	return events;
}

module.exports = {
	detectJxEvents,
	// Exportés pour tests / introspection
	JX_VALUES,
	REMINDER_JX_VALUES,
	CONFIRMATION_NEEDED_JX,
	_computeDaysUntil: computeDaysUntil,
	_readRecurrenceType: readRecurrenceType,
	_hasEngagedResponse: hasEngagedResponse,
	_countPresent: countPresent,
	_hasUnassignedTask: hasUnassignedTask,
	_resolveMinPresentRequired: resolveMinPresentRequired,
	_atLeastOneParticipantWithDay: atLeastOneParticipantWithDay,
	_atLeastOneAdminInterested: atLeastOneAdminInterested,
	_parseJsonArray: parseJsonArray
};
