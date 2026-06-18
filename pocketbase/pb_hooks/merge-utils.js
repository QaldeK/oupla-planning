/// <reference path="../pb_data/types.d.ts" />

/**
 * Merge par clé pour tableaux JSON (côté serveur JSVM).
 *
 * Sémantique (doit matcher `src/lib/pb-sync/collection.ts` `mergeByKey`) :
 *   - Entrée : `key` (nom du champ identifiant, ex: 'id' ou 'participantId'),
 *     `local` (tableau envoyé par le client = extrait du body),
 *     `remote` (tableau actuel en DB = `e.record.original().get(field)`).
 *   - Sortie : union par clé, **local écrase remote sur les items communs**
 *     (même valeur de clé).
 *   - Ordre d'insertion : remote d'abord, puis local (via une Map, l'ordre
 *     d'insertion est préservé et les items de même clé sont écrasés en place).
 *
 * Particularité JSVM PocketBase 0.36 :
 *   Les champs JSON structurés (`participants`, `responses`, `comments`, `tasks`)
 *   sont exposés en JSVM comme des `[]byte` Go (vus comme un vrai `Array` de
 *   nombres = octets UTF-8 du JSON sérialisé), et NON comme des objets JS parsés.
 *   On les détecte et on les décode via `coerceJsonArray`/`bytesToUtf8` avant le
 *   merge. Une valeur déjà parsée (array d'objets JS) est acceptée telle quelle.
 *
 * Tolérance :
 *   - `local` ou `remote` nuls/undefined/vides → traités comme tableaux vides.
 *   - Valeur non décodable (JSON invalide, type inattendu) → tableau vide (prudent).
 *
 * Fallback items sans clé :
 *   Un item qui n'a pas la clé (valeur `undefined`/null) est **ignoré**
 *   (skip). On préfère perdre un item malformé plutôt que de risquer une
 *   collision sur `undefined` qui regrouperait des items distincts.
 *
 * Atomicité :
 *   Cette fonction est appelée dans un hook `onRecordUpdateRequest` AVANT
 *   `e.next()`. Le résultat est persisté via `e.record.set(field, merged)` ;
 *   PocketBase sauvegarde ensuite le record dans une transaction SQLite unique →
 *   le merge est atomique vis-à-vis des autres requêtes concurrentes (pas de
 *   fenêtre de course entre un getOne et un update, contrairement au pre-merge
 *   client).
 *
 * @param {string} key - Nom du champ servant d'identifiant ('id', 'participantId', ...)
 * @param {Array<object>|Uint8Array|string|null|undefined} local - Valeur envoyée par le client
 * @param {Array<object>|Uint8Array|string|null|undefined} remote - Valeur actuelle en base
 * @returns {Array<object>} Tableau fusionné (union par clé, local gagne)
 */
/**
 * Décode un []byte Go (exposé en JSVM comme Array<number>) en string UTF-8.
 *
 * Indispensable car `String.fromCharCode(byte)` traite chaque octet comme un
 * code point indépendant → mojibake pour tout caractère multi-octets (ex: `é` en
 * UTF-8 = bytes 195,169 → `Ã©`). Ce décodeur reconstruit correctement les
 * code points Unicode et les surrogate pairs (> U+FFFF).
 */
function bytesToUtf8(bytes) {
	let result = '';
	let i = 0;
	const len = bytes.length;
	while (i < len) {
		const b = bytes[i];
		if (b < 0x80) {
			result += String.fromCharCode(b);
			i += 1;
		} else if (b < 0xc0) {
			// Byte de continuation isolé (séquence invalide) — remplacé.
			result += '\uFFFD';
			i += 1;
		} else if (b < 0xe0) {
			const c = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
			result += String.fromCharCode(c);
			i += 2;
		} else if (b < 0xf0) {
			const c = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
			result += String.fromCharCode(c);
			i += 3;
		} else {
			// 4 bytes → code point > U+FFFF → paire de surrogate (UTF-16)
			const c =
				((b & 0x07) << 18) |
				((bytes[i + 1] & 0x3f) << 12) |
				((bytes[i + 2] & 0x3f) << 6) |
				(bytes[i + 3] & 0x3f);
			const adj = c - 0x10000;
			result += String.fromCharCode(0xd800 + (adj >> 10), 0xdc00 + (adj & 0x3ff));
			i += 4;
		}
	}
	return result;
}

function coerceJsonArray(value) {
	if (value === null || value === undefined) return [];

	// Tableau JS. Deux cas :
	//  - array d'objets (données déjà parsées) → tel quel
	//  - array de nombres = []byte Go exposé par la JSVM (codes UTF-8 du JSON
	//    sérialisé). Goja expose les []byte comme de vrais Array JS (Array.isArray
	//    === true), il faut donc tester le type du premier élément pour distinguer.
	if (Array.isArray(value)) {
		if (value.length === 0) return [];
		if (typeof value[0] === 'number') {
			const str = bytesToUtf8(value);
			try {
				const parsed = JSON.parse(str);
				return Array.isArray(parsed) ? parsed : [];
			} catch (e) {
				return [];
			}
		}
		return value;
	}

	// String JSON → parser
	if (typeof value === 'string') {
		if (value === '') return [];
		try {
			const parsed = JSON.parse(value);
			return Array.isArray(parsed) ? parsed : [];
		} catch (e) {
			return [];
		}
	}

	return [];
}

function mergeByKey(key, local, remote) {
	const localArr = coerceJsonArray(local);
	const remoteArr = coerceJsonArray(remote);

	const map = new Map();

	// remote d'abord
	for (const item of remoteArr) {
		if (!item || typeof item !== 'object') continue;
		const k = item[key];
		if (k === undefined || k === null) continue;
		map.set(k, item);
	}

	// local ensuite (écrase les items de même clé)
	for (const item of localArr) {
		if (!item || typeof item !== 'object') continue;
		const k = item[key];
		if (k === undefined || k === null) continue;
		map.set(k, item);
	}

	return Array.from(map.values());
}

module.exports = { mergeByKey };
