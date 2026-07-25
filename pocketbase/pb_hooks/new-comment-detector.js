/// <reference path="../pb_data/types.d.ts" />
/**
 * Détecteur de nouveaux messages / suppressions sur `planning_occurrences.comments`.
 *
 * Symétrique à `occurrence-change-detector.js` : le hook `onRecordAfterUpdateSuccess`
 * compare l'état pré-update (`record.original()`) à l'état post-update (`record`) et
 * déduit quels commentaires ont été ajoutés ou retirés. Chaque ajout devient un event
 * `new_comment` (push immédiat + email agrégé) ; chaque suppression déclenche un
 * cleanup des events non-consommés liés au `commentId`.
 *
 * Le helper est PUR : pas d'accès DB, pas de logging, pas de temps courant —
 * testable hors PocketBase. Le champ JSON `comments` est lu via `getString()` +
 * `JSON.parse()` (en JSVM, `record.get()` renvoie les octets Go bruts — voir
 * `network-and-realtime.md` § champs JSON).
 *
 * `authorName` : le détecteur n'a accès qu'à des identifiants (pas aux noms
 * d'affichage, portés par `users` / `master.participants`). Il y dépose
 * `lastModifiedBy` (userId de l'auteur) ; le hook résout le nom affichable via
 * une lookup user avant l'insertion de l'event.
 */

/** Longueur maximale du contenu exposé dans les notifications (push + email). */
const MAX_CONTENT_PREVIEW = 130;

/**
 * Lit le tableau `comments` d'un record (état pré ou post update).
 * Tolère null/undefined/malformé.
 * @returns {Array<{id:string, content?:string, createdAt?:string}>}
 */
function readComments(record) {
	const raw = record.getString('comments');
	if (!raw || raw === 'null' || raw === '') return [];
	try {
		const v = JSON.parse(raw);
		return Array.isArray(v) ? v : [];
	} catch {
		return [];
	}
}

/**
 * Construit l'aperçu single-line tronqué d'un contenu de message.
 * Les sauts de ligne (et espaces environnants) sont collapés en une espace, puis
 * le texte est tronqué à MAX_CONTENT_PREVIEW caractères avec ellipsis.
 */
function buildContentPreview(content) {
	const single = String(content || '').replace(/\s*\n\s*/g, ' ').trim();
	if (single.length <= MAX_CONTENT_PREVIEW) return single;
	return single.slice(0, MAX_CONTENT_PREVIEW) + '…';
}

/**
 * Compare les commentaires pré/post update.
 *
 * @param {core.Record} record   — état post-update
 * @param {core.Record} original — état pré-update (typiquement `record.original()`)
 * @returns {{
 *   added: Array<{commentId:string, commentCreatedAt:string, authorName:string, contentPreview:string}>,
 *   removed: string[]
 * }}
 *   - `added` : un descripteur par commentaire nouvellement présent (payload de l'event).
 *   - `removed` : IDs des commentaires disparus (servent au cleanup des events non-consommés).
 *
 * Les IDs stables dont le contenu diffère ne sont ni ajoutés ni retirés en v1
 * (pas d'`editComment` en UI today) — la détection ignore ces transitions.
 */
function detectCommentChanges(record, original) {
	const before = readComments(original);
	const after = readComments(record);
	const beforeIds = new Set();
	for (const c of before) {
		if (c && c.id) beforeIds.add(c.id);
	}
	const afterIds = new Set();
	for (const c of after) {
		if (c && c.id) afterIds.add(c.id);
	}

	const authorId = record.getString('lastModifiedBy');

	const added = [];
	for (const c of after) {
		if (!c || !c.id) continue;
		if (beforeIds.has(c.id)) continue;
		added.push({
			commentId: c.id,
			commentCreatedAt: c.createdAt || '',
			authorName: authorId,
			contentPreview: buildContentPreview(c.content)
		});
	}

	const removed = [];
	for (const c of before) {
		if (!c || !c.id) continue;
		if (!afterIds.has(c.id)) removed.push(c.id);
	}

	return { added, removed };
}

module.exports = {
	detectCommentChanges,
	// Exportés pour les tests unitaires
	MAX_CONTENT_PREVIEW,
	buildContentPreview,
	_readComments: readComments
};
