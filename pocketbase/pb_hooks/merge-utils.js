/// <reference path="../pb_data/types.d.ts" />
// ⚠️ AVANT toute modif : skill pocketbase-jsvm + doc Context7.

/**
 * Merge par clé pour tableaux JSON (côté serveur JSVM).
 *
 * Sémantique (doit matcher `src/lib/pb-sync/collection.ts` `mergeByKey`) :
 *   - Entrée : `key` (nom du champ identifiant, ex: 'id' ou 'participantId'),
 *     `localArr` (tableau envoyé par le client, déjà parsé depuis le body HTTP)
 *     et `remoteArr` (tableau actuel en DB, obtenu via `jsonArrayField`).
 *   - Sortie : union par clé, **local écrase remote sur les items communs**
 *     (même valeur de clé).
 *   - Ordre d'insertion : remote d'abord, puis local (via une Map, l'ordre
 *     d'insertion est préservé et les items de même clé sont écrasés en place).
 *
 * Tolérance :
 *   - `localArr` ou `remoteArr` null/undefined/non-tableau → traités comme [].
 *
 * Fallback items sans clé :
 *   Un item qui n'a pas la clé (valeur `undefined`/null) est **ignoré**
 *   (skip). On préfère perdre un item malformé plutôt que de risquer une
 *   collision sur `undefined` qui regrouperait des items distincts.
 *
 * Atomicité :
 *   Cette fonction est appelée dans un hook `onRecordUpdateRequest` AVANT
 *   `e.next()`. Le résultat est persisté via `e.record.set(field, merged)` ;
 *   PocketBase sauvegarde ensuite le record dans une transaction SQLite
 *   unique → le merge est atomique vis-à-vis des autres requêtes concurrentes
 *   (pas de fenêtre de course, contrairement au pre-merge client).
 *
 * @param {string} key - Nom du champ servant d'identifiant ('id', 'participantId', ...)
 * @param {Array<object>|null|undefined} localArr - Tableau envoyé par le client (gagne sur clé commune)
 * @param {Array<object>|null|undefined} remoteArr - Tableau actuel en base
 * @returns {Array<object>} Tableau fusionné (union par clé, local gagne)
 */
function mergeByKey(key, localArr, remoteArr) {
	const local = Array.isArray(localArr) ? localArr : [];
	const remote = Array.isArray(remoteArr) ? remoteArr : [];

	const map = new Map();

	// remote d'abord
	for (const item of remote) {
		if (!item || typeof item !== 'object') continue;
		const k = item[key];
		if (k === undefined || k === null) continue;
		map.set(k, item);
	}

	// local ensuite (écrase les items de même clé)
	for (const item of local) {
		if (!item || typeof item !== 'object') continue;
		const k = item[key];
		if (k === undefined || k === null) continue;
		map.set(k, item);
	}

	return Array.from(map.values());
}

/**
 * Lit un champ JSON de type tableau depuis un record, via `getString()` +
 * `JSON.parse()`.
 *
 * Particularité JSVM PocketBase 0.36 : `record.get()` sur un champ JSON
 * retourne des `[]byte` Go (vus comme un Array JS de nombres = octets UTF-8
 * du JSON sérialisé), et NON un objet parsé. `record.getString()` décode
 * nativement ces bytes en string JSON, qu'on parse ensuite.
 *
 * @param {Record} record - Record PocketBase (typiquement `e.record.original()`)
 * @param {string} field - Nom du champ JSON array
 * @returns {Array<object>} Array parsé, ou [] si champ vide/invalide/non-tableau
 */
function jsonArrayField(record, field) {
	const str = record.getString(field);
	if (!str) return [];
	try {
		const parsed = JSON.parse(str);
		return Array.isArray(parsed) ? parsed : [];
	} catch (e) {
		return [];
	}
}

module.exports = { mergeByKey, jsonArrayField };
