/// <reference path="../pb_data/types.d.ts" />
/**
 * Utilitaires partagés pour `planning_participants`.
 *
 * Centralise les defaults de prefs par `recurrenceType` et la logique de
 * find-or-create. Les hooks JSVM vivant dans des contextes isolés, toute
 * fonction réutilisée doit vivre ici et être `require()`-ée, jamais déclarée
 * au top-level d'un `.pb.js`.
 *
 * Les valeurs de `RECURRENCE_DEFAULTS` dupliquent celles de
 * `src/lib/services/push.ts` (côté frontend TS) — la JSVM et le navigateur
 * ne partagent pas de modules. Toute évolution doit être répercutée des
 * deux côtés pour garder les defaults cohérents.
 */

/**
 * Defaults `reminderDays` / `missingDays` par `recurrenceType`.
 * Les autres prefs booléennes sont constantes.
 */
const RECURRENCE_DEFAULTS = {
	WEEKLY: { reminderDays: ['1', '3'], missingDays: ['1', '3'] },
	BIWEEKLY: { reminderDays: ['1', '3'], missingDays: ['1', '3', '7'] },
	MONTHLY_BY_DATE: { reminderDays: ['1', '3', '7'], missingDays: ['1', '3', '7'] },
	MONTHLY_BY_DAY: { reminderDays: ['1', '3', '7'], missingDays: ['1', '3', '7'] },
	DAILY: { reminderDays: ['1'], missingDays: ['1'] },
	CUSTOM: { reminderDays: ['1', '3', '7'], missingDays: ['1', '3', '7', '15'] }
};

/**
 * Extrait le `type` du champ JSON `recurrence` d'un master.
 *
 * @param {core.Record} master — record `planning_masters`
 * @returns {string} — `recurrenceType` ('WEEKLY', 'BIWEEKLY', …) ou
 *   'WEEKLY' par défaut si le champ est vide/malformé (cohérent avec le
 *   default du frontend `ensurePlanningParticipant`).
 */
function readRecurrenceType(master) {
	const raw = master.getString('recurrence');
	if (raw && raw !== 'null' && raw !== '') {
		try {
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed.type === 'string') return parsed.type;
		} catch {
			/* ignore, fallback below */
		}
	}
	return 'WEEKLY';
}

/**
 * Defaults de prefs à appliquer à la création d'un `planning_participants`.
 *
 * @param {string} recurrenceType — clé de `RECURRENCE_DEFAULTS`
 * @param {object} [opts]
 * @param {boolean} [opts.isAdmin=false] — si true, `onConfirmationNeeded = true`
 *   (les admins reçoivent les alertes de confirmation). Sinon false.
 * @returns {object} — objet de prefs à spreader dans `record.set()` ou `load()`.
 */
function getDefaultParticipantPrefs(recurrenceType, opts) {
	const isAdmin = opts && opts.isAdmin;
	const recDefaults = RECURRENCE_DEFAULTS[recurrenceType] || RECURRENCE_DEFAULTS.WEEKLY;
	return {
		email: true,
		push: false,
		onOccurrenceChange: true,
		onConfirmationNeeded: !!isAdmin,
		reminderDays: recDefaults.reminderDays,
		missingDays: recDefaults.missingDays
	};
}

/**
 * Find-or-create le `planning_participants(user, master)` pour un user,
 * en s'assurant que `onConfirmationNeeded` est true. Utilisé par la route
 * `/api/claim-admin` après promotion admin.
 *
 * Comportement :
 *   - Row existant → set `onConfirmationNeeded = true` + save (no-op si
 *     déjà true).
 *   - Row absent → création avec defaults complets (incluant
 *     `onConfirmationNeeded = true`).
 *
 * @param {core.App} app — `$app` ou `e.app`
 * @param {string} userId — id de l'user authentifié
 * @param {string} masterId — id du `planning_masters`
 * @param {string} recurrenceType — issu de `readRecurrenceType(master)`
 */
function ensureAdminParticipant(app, userId, masterId, recurrenceType) {
	let participant;
	try {
		participant = app.findFirstRecordByFilter(
			'planning_participants',
			'planning = {:masterId} && user = {:userId}',
			{ masterId, userId }
		);
	} catch {
		/* sql.ErrNoRows — n'existe pas, on le crée ci-dessous */
	}

	if (participant) {
		if (!participant.getBool('onConfirmationNeeded')) {
			participant.set('onConfirmationNeeded', true);
			app.save(participant);
		}
		return;
	}

	const prefs = getDefaultParticipantPrefs(recurrenceType, { isAdmin: true });
	const collection = app.findCollectionByNameOrId('planning_participants');
	const rec = new Record(collection);
	rec.set('planning', masterId);
	rec.set('user', userId);
	rec.set('email', prefs.email);
	rec.set('push', prefs.push);
	rec.set('onOccurrenceChange', prefs.onOccurrenceChange);
	rec.set('onConfirmationNeeded', prefs.onConfirmationNeeded);
	rec.set('reminderDays', prefs.reminderDays);
	rec.set('missingDays', prefs.missingDays);
	app.save(rec);
}

module.exports = {
	RECURRENCE_DEFAULTS,
	readRecurrenceType,
	getDefaultParticipantPrefs,
	ensureAdminParticipant
};
