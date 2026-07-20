/// <reference path="../pb_data/types.d.ts" />
/**
 * Helpers partagés entre les modules hooks PocketBase.
 *
 * Les handlers JSVM (cronAdd, onRecord*, routerAdd) s'exécutent dans des
 * contextes isolés — toute fonction réutilisée entre modules doit vivre ici
 * et être `require()`-ée via `${__hooks}/pb-helpers.js`.
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

module.exports = {
	parseJsonArray,
	readRecurrenceType,
	resolveMinPresentRequired
};
