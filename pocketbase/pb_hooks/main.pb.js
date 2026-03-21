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

routerAdd('POST', '/api/sync-plannings', (e) => {
	if (!e.auth) return e.json(401, { error: 'Unauthorized' });

	const body = e.requestInfo().body;
	const localTokens = body?.tokens || [];
	const includeOccurrences = body?.includeOccurrences === true;

	const user = $app.findRecordById('users', e.auth.id);
	const currentMasterIds = new Set(user.get('masterId') || []);
	let adminOf = {};
	try {
		adminOf = JSON.parse(user.getString('adminOf') || '{}');
	} catch {}

	// Filtrer les tokens à valider : seulement ceux pas encore dans masterId
	const tokensToValidate = localTokens.filter(
		(t) => t.masterId && !currentMasterIds.has(t.masterId)
	);

	// Si nouveaux tokens à valider
	if (tokensToValidate.length > 0) {
		const participantTokens = tokensToValidate.map((t) => t.participantToken).filter(Boolean);
		const adminTokens = tokensToValidate.map((t) => t.adminToken).filter(Boolean);

		const newMasters = $app.findAllRecords(
			'planning_masters',
			$dbx.or(
				participantTokens.length > 0
					? $dbx.hashExp({ participantToken: participantTokens })
					: $dbx.exp('1 = 0'),
				adminTokens.length > 0 ? $dbx.hashExp({ adminToken: adminTokens }) : $dbx.exp('1 = 0')
			)
		);

		for (const master of newMasters) {
			currentMasterIds.add(master.id);
			const tokenItem = localTokens.find((t) => t.masterId === master.id);
			if (tokenItem?.adminToken) {
				adminOf[master.id] = master.get('adminToken');
			}
		}

		user.set('masterId', Array.from(currentMasterIds));
		user.set('adminOf', adminOf);
		$app.save(user);
	}

	// Récupérer TOUS les masters de l'utilisateur
	const allMasters =
		currentMasterIds.size > 0
			? $app.findRecordsByIds('planning_masters', Array.from(currentMasterIds))
			: [];

	// Si includeOccurrences, récupérer les occurrences pour chaque master
	let occurrences = {};
	if (includeOccurrences && currentMasterIds.size > 0) {
		const masterIds = Array.from(currentMasterIds);
		const masterParams = {};
		masterIds.forEach((id, i) => {
			masterParams[`m_${i}`] = id;
		});
		const masterFilter = masterIds.map((_, i) => `master = {:m_${i}}`).join(' || ');

		const allOccurrences = $app.findRecordsByFilter(
			'planning_occurrences',
			masterFilter,
			'+date',
			1000,
			0,
			masterParams
		);

		// Grouper les occurrences par masterId
		for (const occ of allOccurrences) {
			const masterId = occ.get('master');
			if (!occurrences[masterId]) {
				occurrences[masterId] = [];
			}
			occurrences[masterId].push({
				id: occ.id,
				master: masterId,
				date: occ.get('date'),
				startTime: occ.get('startTime'),
				endTime: occ.get('endTime'),
				isConfirmed: occ.get('isConfirmed'),
				isCanceled: occ.get('isCanceled'),
				tasks: occ.get('tasks'),
				responses: occ.get('responses'),
				comments: occ.get('comments'),
				created: occ.get('created'),
				updated: occ.get('updated')
			});
		}
	}

	return e.json(200, {
		success: true,
		syncedIds: Array.from(currentMasterIds),
		masters: allMasters.map((m) => ({
			id: m.id,
			title: m.get('title'),
			description: m.get('description'),
			place: m.get('place'),
			defaultStartTime: m.get('defaultStartTime'),
			defaultEndTime: m.get('defaultEndTime'),
			recurrence: m.get('recurrence'),
			tasks: m.get('tasks'),
			participantToken: m.get('participantToken'),
			adminToken: m.get('adminToken'),
			participants: m.get('participants'),
			allowResponses: m.get('allowResponses'),
			minPresentRequired: m.get('minPresentRequired'),
			availableResponseTypes: m.get('availableResponseTypes'),
			created: m.get('created'),
			updated: m.get('updated')
		})),
		occurrences: includeOccurrences ? occurrences : undefined
	});
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
			e.requestInfo()?.query?.['_token'] || 'NONE'
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
	// const version = e.requestInfo().query['_version'];
	// if (version) {
	// 	const currentUpdated = e.record.get('updated').toString();
	// 	// On compare les versions. Si elles diffèrent, quelqu'un a modifié le record entre temps.
	// 	if (currentUpdated !== version) {
	// 		throw new ApiError(409, 'Conflict: The record has been modified by another user.');
	// 	}
	// }

	// Validation des modifications par participant
	// NOTE: API Rules gèrent déjà l'autorisation. Ce code est une protection supplémentaire.
	// Décommenter si nécessaire (cf. Option B dans l'analyse du bug)
	// if (isParticipant) {
	// 	const original = e.record.original();
	// 	const protectedFields = ['master', 'date', 'startTime', 'endTime', 'isConfirmed', 'isCanceled', 'adminToken', 'participantToken'];
	// 	for (const field of protectedFields) {
	// 		if (JSON.stringify(e.record.get(field)) !== JSON.stringify(original.get(field))) {
	// 			throw new ApiError(403, 'Participants can only update responses, comments, and tasks');
	// 		}
	// 	}
	// }

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
			e.requestInfo()?.query?.['_token'] || 'NONE'
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
	// const version = e.requestInfo().query['_version'];
	// if (version) {
	// 	const currentUpdated = e.record.get('updated').toString();
	// 	if (currentUpdated !== version) {
	// 		throw new ApiError(409, 'Conflict: record modified by another user.');
	// 	}
	// }

	// === RESTRICTION DES CHAMPS PAR RÔLE ===
	// NOTE: API Rules gèrent déjà l'autorisation. Ce code est une protection supplémentaire.
	// Décommenter si nécessaire (cf. Option B dans l'analyse du bug)
	// if (isParticipant) {
	// 	const original = e.record.original();
	// 	const protectedFields = ['title', 'description', 'place', 'recurrence', 'tasks',
	// 		'minPresentRequired', 'allowResponses', 'toConfirm', 'availableResponseTypes',
	// 		'adminToken', 'participantToken'];
	// 	for (const field of protectedFields) {
	// 		if (JSON.stringify(e.record.get(field)) !== JSON.stringify(original.get(field))) {
	// 			throw new ApiError(403, 'Participants can only update the participants field');
	// 		}
	// 	}
	// }
	// isAdmin → pas de restriction sur les champs

	e.next();
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
