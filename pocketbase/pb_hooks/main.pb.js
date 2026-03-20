/// <reference path="../pb_data/types.d.ts" />

/**
 * Hooks PocketBase pour sécuriser l'accès aux plannings via token-based authentication
 *
 * Architecture de sécurité avec API Rules natives :
 * - Les API Rules gèrent l'autorisation (List, View, Create, Update, Delete)
 * - Les API Rules s'appliquent automatiquement au realtime
 * - Ce fichier ne contient que les hooks qui ne peuvent pas être remplacés par des API Rules
 *
 * IMPORTANT : Chaque hook DOIT avoir un identifiant unique (dernier paramètre)
 * Sans identifiant, le hook s'applique globalement à toutes les collections !
 *
 * Authentification via query param "_token"
 * Admin a tous les droits (e.admin check)
 */
routerAdd('POST', '/api/claim-admin', (e) => {
	if (!e.auth) throw new ApiError(401, 'Unauthorized');

	const body = e.requestInfo().body;
	const token = body?.token;
	if (!token) throw new ApiError(400, 'Missing token');

	let masters;
	try {
		masters = e.app.findRecordsByFilter('planning_masters', 'adminToken = {:token}', '', 1, 0, {
			token
		});
	} catch (err) {
		throw new ApiError(403, 'Invalid admin token');
	}

	if (!masters.length) throw new ApiError(403, 'Invalid admin token');

	const master = masters[0];
	const user = e.app.findRecordById('users', e.auth.id);

	// ✅ Lire avec JSON.parse(record.get())
	let adminOf = {};
	const raw = user.getString('adminOf');
	// getString sur un champ JSON retourne la représentation string du JSON
	if (raw && raw !== 'null' && raw !== '{}' && raw !== '') {
		try {
			adminOf = JSON.parse(raw);
		} catch {
			adminOf = {};
		}
	}

	adminOf[master.id] = token;
	// Pour écrire : passer la string JSON directement
	user.set('adminOf', adminOf);
	e.app.save(user);
	// e.app
	// 	.logger()
	// 	.info(
	// 		'raw adminOf',
	// 		'getString',
	// 		user.getString('adminOf'),
	// 		'typeof',
	// 		typeof user.getString('adminOf')
	// 	);
});
// ============================================
// PLANNING_OCCURRENCES UPDATE HOOK
// ============================================

/**
 * Hook spécifique pour Update sur planning_occurrences
 * Ne peut pas être remplacé par des API Rules car nécessite :
 * - Le verrouillage optimiste via _version
 * - La restriction des champs modifiables par les participants
 */
onRecordUpdateRequest((e) => {
	e.app
		.logger()
		.info(
			'UPDATE HOOK',
			'collection',
			e.collection.name,
			'hasAuth',
			!!e.auth,
			'token',
			e.httpContext?.queryParam('_token') || 'NONE'
		);

	if (e.collection.name !== 'planning_occurrences') {
		return e.next();
	}
	if (e.admin) {
		return e.next();
	}

	// Lire le token depuis les query params
	const token = e.requestInfo()?.query?.['_token'] || '';

	if (!token) {
		throw new ApiError(401, 'Missing token');
	}

	const masterId = e.record.get('master');
	if (!masterId) {
		throw new ApiError(404, 'Master ID required');
	}

	const master = e.app.findRecordById('planning_masters', masterId);

	const adminToken = master.get('adminToken');
	const participantToken = master.get('participantToken');
	const isAdmin = token === adminToken;
	const isParticipant = token === participantToken;

	if (!isAdmin && !isParticipant) {
		throw new ApiError(403, 'Invalid token');
	}

	// === VERROUILLAGE OPTIMISTE ===
	// const version = e.httpContext.queryParam('_version');
	// if (version) {
	// 	const currentUpdated = e.record.get('updated').toString();
	// 	// On compare les versions. Si elles diffèrent, quelqu'un a modifié le record entre temps.
	// 	if (currentUpdated !== version) {
	// 		throw new ApiError(409, 'Conflict: The record has been modified by another user.');
	// 	}
	// }

	// Validation des modifications par participant (pour les updates classiques)
	if (isParticipant) {
		const changed = e.record.changedFields();
		for (const key of changed) {
			if (key !== 'responses' && key !== 'comments' && key !== 'tasks' && key !== 'updated') {
				throw new ApiError(403, 'Participants can only update responses, comments, and tasks');
			}
		}
	}

	e.next();
}, 'planning_occurrences');

// ============================================
// planning_masters update participant
// ============================================

onRecordUpdateRequest((e) => {
	e.app
		.logger()
		.info(
			'UPDATE HOOK',
			'collection',
			e.collection.name,
			'hasAuth',
			!!e.auth,
			'token',
			e.httpContext?.queryParam('_token') || 'NONE'
		);

	if (e.collection.name !== 'planning_masters') {
		return e.next();
	}

	if (e.admin) return e.next();

	const token = e.requestInfo()?.query?.['_token'] || '';
	if (!token) throw new ApiError(401, 'Missing token');

	const adminToken = e.record.get('adminToken');
	const participantToken = e.record.get('participantToken');
	const isAdmin = token === adminToken;
	const isParticipant = token === participantToken;

	// Auth user sans token → vérifier adminOf
	if (!isAdmin && !isParticipant && e.auth) {
		try {
			const user = e.app.findRecordById('users', e.auth.id);
			const raw = user.getString('adminOf');
			let adminOf = {};
			if (raw && raw !== 'null') {
				try {
					adminOf = JSON.parse(raw);
				} catch {
					adminOf = {};
				}
			}
			if (adminOf[e.record.id] === adminToken) {
				return e.next(); // Admin auth → accès complet
			}
		} catch {}
	}

	if (!isAdmin && !isParticipant) {
		throw new ApiError(403, 'Invalid token');
	}

	// // === VERROUILLAGE OPTIMISTE (identique occurrences) ===
	// const version = e.httpContext.queryParam('_version');
	// if (version) {
	// 	const currentUpdated = e.record.get('updated').toString();
	// 	if (currentUpdated !== version) {
	// 		throw new ApiError(409, 'Conflict: record modified by another user.');
	// 	}
	// }

	// === RESTRICTION DES CHAMPS PAR RÔLE ===
	if (isParticipant) {
		const changed = e.record.changedFields();
		for (const key of changed) {
			// Participants : uniquement participants + lastModifiedBy
			if (key !== 'participants' && key !== 'lastModifiedBy' && key !== 'updated') {
				throw new ApiError(403, 'Participants can only update the participants field');
			}
		}
	}
	// isAdmin → pas de restriction sur les champs

	e.next();
}, 'planning_masters');

// ============================================
// Add user.masterId for auth user when listRequestion depuis le layout global
// ============================================

onRecordListRequest((e) => {
	if (!e.auth) return e.next();

	e.next(); // Laisser PB exécuter la requête d'abord

	// Après exécution : parcourir les records retournés
	// e.result contient les records effectivement renvoyés
	const returnedIds = (e.result?.items || []).map((r) => r.id);
	if (returnedIds.length === 0) return;

	const currentIds = e.auth.get('masterId') || [];
	const missing = returnedIds.filter((id) => !currentIds.includes(id));

	if (missing.length === 0) return; // Court-circuit — rien à faire

	e.auth.set('masterId', [...currentIds, ...missing]);
	e.app.save(e.auth);
}, 'planning_masters');

// ============================================
// RECORD ENRICH - Masquer les tokens
// ============================================

/**
 * Masquer le champ adminToken dans tous les records enrichis
 * onRecordEnrich est exécuté pour les API ET les messages realtime
 */
onRecordEnrich(
	(e) => {
		const isAuthAdmin = e.requestInfo?.auth?.collectionName === '_superusers';
		if (isAuthAdmin) return e.next();

		const adminToken = e.record.get('adminToken');
		const authUser = e.requestInfo?.auth;

		// Si user authentifié, vérifier s'il est admin sur ce planning
		if (authUser && adminToken) {
			try {
				const user = e.app.findRecordById('users', authUser.id);
				let adminOf = {};
				const raw = user.getString('adminOf');
				if (raw && raw !== 'null') {
					try {
						adminOf = JSON.parse(raw);
					} catch {
						adminOf = {};
					}
				}

				const isAdmin = adminOf[e.record.id] === adminToken;
				if (isAdmin) return e.next();
			} catch (err) {
				// Non-bloquant
			}
		}

		e.record.hide('adminToken');
		e.next();
	},
	'planning_masters',
	'planning_occurrences'
);
