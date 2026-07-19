/// <reference path="../pb_data/types.d.ts" />
/**
 * Détecteur de transitions pertinentes sur `planning_occurrences`.
 *
 * Le hook `onRecordAfterUpdateSuccess` ne sait pas, à lui seul, quels changements
 * méritent une notification : la plupart des updates (réponses, commentaires,
 * `lastModifiedBy`...) ne doivent rien déclencher. Ce helper compare l'état
 * pré-update (`record.original()`) à l'état post-update (`record`) et renvoie
 * au plus UN descripteur d'event à insérer dans `notification_events`.
 *
 * Pourquoi un seul event par update :
 *   - La granularité du pipeline est "1 row = 1 fait". Le cron agrège ensuite
 *     en un seul email par (master, user) au moment de l'envoi.
 *   - Si une même update modifie l'horaire ET le lieu, on insère une seule row
 *     `schedule_change` dont le payload porte les deux deltas — le cron saura
 *     produire un bloc d'email unique plutôt que deux sections redondantes.
 *
 * Priorité quand plusieurs transitions sont détectées dans la même update :
 *   `status_deleted` > `status_canceled` > `schedule_change` > `status_confirmed`.
 *   Les transitions de statut annulent la pertinence des changements d'horaire
 *   (une occ annulée/supprimée n'a plus de schedule utile).
 *
 * Le helper est PUR : pas d'accès DB, pas de logging, pas de temps courant.
 * Cela permet de le tester hors PocketBase.
 */

/**
 * @typedef {Object} NotificationEventDescriptor
 * @property {string} type    — type de l'event à insérer (`status_canceled`,
 *                              `status_deleted`, `schedule_change`, `status_confirmed`).
 * @property {Object} [payload] — contexte du changement (uniquement pour
 *                              `schedule_change`). Contient les clés `oldX`/`newX`
 *                              uniquement pour les champs modifiés, pour éviter
 *                              de polluer la row avec des valeurs inchangées.
 */

/**
 * Compare deux valeurs string renvoyées par `record.getString()`.
 * Retourne true si elles diffèrent.
 */
function stringChanged(record, original, field) {
	return record.getString(field) !== original.getString(field);
}

/**
 * Détecte une transition false → true sur un champ booléen.
 * Les autres transitions (true → false, true → true) ne sont pas des événements
 * pertinents : on veut signaler le passage en "canceled" / "deleted" / "confirmed",
 * pas la réouverture éventuelle.
 */
function becameTrue(record, original, field) {
	return !original.getBool(field) && record.getBool(field);
}

/**
 * Construit le payload d'un event `schedule_change`.
 *
 * Ne retient que les champs effectivement modifiés, et les expose sous forme de
 * paires `{ oldX, newX }`. Le cron exploitera ce payload pour générer les
 * lignes "Avait lieu à X, maintenant Y" dans l'email agrégé.
 *
 * @returns {Object} — payload JSON-sérialisable (vide si rien de modifié).
 */
function buildScheduleChangePayload(record, original) {
	const payload = {};
	const fields = ['date', 'startTime', 'endTime', 'place'];
	for (const field of fields) {
		if (stringChanged(record, original, field)) {
			// `place` peut être nullable en DB : on normalise en string vide pour
			// avoir une comparaison stable (de `null` → `''` côté PocketBase getter).
			const cap = field.charAt(0).toUpperCase() + field.slice(1);
			payload[`old${cap}`] = original.getString(field);
			payload[`new${cap}`] = record.getString(field);
		}
	}
	return payload;
}

/**
 * Détecte la transition pertinente survenue sur une occurrence.
 *
 * @param {core.Record} record   — état post-update
 * @param {core.Record} original — état pré-update (typiquement `record.original()`)
 * @returns {NotificationEventDescriptor|null} — descripteur de l'event à insérer,
 *   ou `null` si l'update ne porte aucune modification notifiable.
 */
function detectOccurrenceChange(record, original) {
	if (becameTrue(record, original, 'deleted')) {
		return { type: 'status_deleted' };
	}
	if (becameTrue(record, original, 'isCanceled')) {
		return { type: 'status_canceled' };
	}
	const schedulePayload = buildScheduleChangePayload(record, original);
	if (Object.keys(schedulePayload).length > 0) {
		return { type: 'schedule_change', payload: schedulePayload };
	}
	if (becameTrue(record, original, 'isConfirmed')) {
		return { type: 'status_confirmed' };
	}
	return null;
}

module.exports = {
	detectOccurrenceChange,
	// Exportés pour les tests unitaires
	_becameTrue: becameTrue,
	_stringChanged: stringChanged,
	_buildScheduleChangePayload: buildScheduleChangePayload
};
