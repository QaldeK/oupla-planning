/// <reference path="../pb_data/types.d.ts" />
/**
 * Helpers partagés entre les modules hooks PocketBase.
 *
 * Les handlers JSVM (cronAdd, onRecord*, routerAdd) s'exécutent dans des
 * contextes isolés — toute fonction réutilisée entre modules doit vivre ici
 * et être `require()`-ée via `${__hooks}/pb-helpers.cjs`.
 */

/**
 * Parse un champ JSON d'un record en tableau. Tolère null/undefined/malformé.
 *
 * @param {core.Record} record
 * @param {string} field
 * @returns {Array}
 */
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

/**
 * Extrait le `type` du champ JSON `recurrence` d'un master.
 *
 * @param {core.Record} master — record `planning_masters`
 * @returns {string} — `recurrenceType` ('WEEKLY', 'BIWEEKLY', …) ou
 *   'WEEKLY' par défaut si le champ est vide/malformé.
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
 * `minPresentRequired` effectif : override occurrence, fallback master si occ = 0.
 *
 * @param {core.Record} occurrence
 * @param {core.Record} master
 * @returns {number}
 */
function resolveMinPresentRequired(occurrence, master) {
	const occMin = Number(occurrence.getInt('minPresentRequired')) || 0;
	if (occMin > 0) return occMin;
	return Number(master.getInt('minPresentRequired')) || 0;
}

/**
 * Nombre de jours (entier) entre `now` (UTC minuit) et la date d'une occurrence
 * (UTC minuit). Positif pour une occ future, 0 aujourd'hui, négatif pour le
 * passé. Arrondi pour tolérer d'éventuels décalages sub-journaliers dans le
 * stockage PocketBase. Date illisible → -1 (traitée comme passée).
 *
 * @param {string} occDateRaw — champ `date` d'une occurrence
 * @param {Date} now — horloge injectée (UTC)
 * @returns {number}
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

module.exports = {
	parseJsonArray,
	readRecurrenceType,
	resolveMinPresentRequired,
	computeDaysUntil
};
