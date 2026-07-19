/// <reference path="../pb_data/types.d.ts" />
/**
 * Utilitaires partagés pour le cron notifications quotidien.
 *
 * Ces fonctions et constantes sont extraites dans un module require()-able car
 * les handlers JSVM (cronAdd, onRecord*, routerAdd) s'exécutent dans des
 * contextes isolés : une fonction déclarée au top-level d'un `.pb.js` n'est PAS
 * visible depuis le callback. Le pattern projet est de factoriser les helpers
 * dans un `*-utils.js` et de les `require()` au début du handler.
 *
 * Contenu :
 *  - Constantes (seuils, base URL, ensembles de types d'events)
 *  - Helpers de parsing/dates (maintenus compatibles avec le format PB)
 *  - Construction du payload missings (presentCount, tasksToFill, etc.)
 *  - Résolution des noms de tâches user ("Préparer salle (avant)")
 *  - Rendu push (titre + corps court)
 */

const MAX_SMTP_FAILURES = 3;

const BASE_URL = 'https://planning.oupla.net';

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

/** Timestamp courant au format PocketBase "YYYY-MM-DD HH:MM:SS.000Z". */
function nowIsoCompat() {
	return new Date().toISOString().replace('T', ' ');
}

/** Parse un champ JSON d'un record en tableau. Tolère null/undefined/malformé. */
function parseJsonArray(record, field) {
	const raw = record.getString(field);
	if (!raw || raw === 'null' || raw === '') return [];
	try {
		const v = JSON.parse(raw);
		return Array.isArray(v) ? v : [];
	} catch {
		return [];
	}
}

/** `minPresentRequired` effective : override occ, fallback master si occ = 0. */
function resolveMinPresentRequired(occurrence, master) {
	const occMin = Number(occurrence.getInt('minPresentRequired')) || 0;
	if (occMin > 0) return occMin;
	return Number(master.getInt('minPresentRequired')) || 0;
}

/**
 * Calcule le payload event-level (counts pour missings).
 * Identique pour tous les destinataires de l'event. Le payload user-level
 * (response, tasks) est ajouté séparément par le cron d'envoi.
 */
function buildEventPayload(event, master, occ) {
	const type = event.type;
	if (!MISSING_EVENT_TYPES.has(type)) return null;

	const responses = parseJsonArray(occ, 'responses');
	const tasks = parseJsonArray(occ, 'tasks');
	const minRequired = resolveMinPresentRequired(occ, master);

	let present = 0;
	let maybe = 0;
	let noreply = 0;
	const respondedIds = new Set();
	for (const r of responses) {
		if (!r || !r.participantId) continue;
		respondedIds.add(r.participantId);
		if (r.response === 'present') present++;
		else if (r.response === 'maybe') maybe++;
	}

	// Sans-réponse = participants auth actifs sans response sur cette occ.
	// Les guests (sans userId) sont exclus car pas destinataires email.
	const allParticipants = parseJsonArray(master, 'participants');
	for (const p of allParticipants) {
		if (!p || p.hasQuit || !p.userId) continue;
		if (!respondedIds.has(p.id)) noreply++;
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
		maybeCount: maybe,
		noReplyCount: noreply,
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

/** Titre court d'un push par type d'event J-X. */
function buildPushTitle(event, master) {
	const title = master.getString('title') || 'Planning';
	switch (event.type) {
		case 'reminder':
			return `Rappel — ${title}`;
		case 'quorum_missing':
		case 'task_unassigned':
			return `Participants manquants — ${title}`;
		case 'confirmation_needed':
			return `À confirmer — ${title}`;
		default:
			return `${title}`;
	}
}

/** Corps court d'un push : heure + lieu + mention éventuelle des tâches user. */
function buildPushBody(event, occ, recipient, occTasks) {
	const startTime = occ.getString('startTime');
	const place = occ.getString('place');
	const parts = [];

	if (startTime) parts.push(startTime);
	if (place) parts.push(place);

	if (event.type === 'reminder') {
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
	} else if (event.type === 'confirmation_needed') {
		parts.push('Événement à confirmer');
	}

	return parts.join(' — ');
}

module.exports = {
	MAX_SMTP_FAILURES,
	BASE_URL,
	TASK_TYPE_LABEL,
	JX_EVENT_TYPES,
	MISSING_EVENT_TYPES,
	nowIsoCompat,
	parseJsonArray,
	resolveMinPresentRequired,
	buildEventPayload,
	resolveUserTaskNames,
	buildPushTitle,
	buildPushBody
};
