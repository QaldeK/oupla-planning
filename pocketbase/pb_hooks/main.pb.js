/// <reference path="../pb_data/types.d.ts" />
// ⚠️ AVANT toute modif : skill pocketbase-jsvm + doc Context7. Voir pocketbase/pb_hooks/AGENTS.md (préalable source-first + conventions projet).

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

	const { readRecurrenceType, ensureAdminParticipant } = require(
		`${__hooks}/participants-utils.js`
	);

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
	const recurrenceType = readRecurrenceType(master);

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

	// ✅ Gérer également masterId pour assurer la synchronisation
	const masterIdArr = user.get('masterId') || [];
	const currentMasterIds = new Set(masterIdArr);
	if (!currentMasterIds.has(master.id)) {
		currentMasterIds.add(master.id);
		user.set('masterId', Array.from(currentMasterIds));
	}

	// Pour écrire : passer la string JSON directement
	user.set('adminOf', adminOf);
	e.app.save(user);

	// Promotion admin : garantir un `planning_participants` avec `onConfirmationNeeded`
	// à true (les admins reçoivent les alertes de confirmation). En pratique le row existe déjà si
	// l'user a déjà rejoint le planning en tant que participant ; sinon on le crée
	// avec les defaults complets liés au `recurrenceType` du master.
	ensureAdminParticipant(e.app, user.get('id'), master.id, recurrenceType);
});

routerAdd('POST', '/api/sync-plannings', (e) => {
	if (!e.auth) return e.json(401, { error: 'Unauthorized' });

	const body = e.requestInfo().body;
	const localTokens = body?.tokens || [];

	const user = $app.findRecordById('users', e.auth.id);
	const currentMasterIds = new Set(user.get('masterId') || []);

	// Lecture sécurisée du champ JSON adminOf (valeur par défaut PocketBase = 'null')
	let adminOf = {};
	const rawAdminOf = user.getString('adminOf');
	if (rawAdminOf && rawAdminOf !== 'null') {
		try {
			adminOf = JSON.parse(rawAdminOf);
		} catch {
			adminOf = {};
		}
	}

	// Filtrer les tokens à valider : seulement ceux pas encore dans masterId
	const tokensToValidate = localTokens.filter(
		(t) => t.masterId && !currentMasterIds.has(t.masterId)
	);

	// Si nouveaux tokens à valider
	if (tokensToValidate.length > 0) {
		const participantTokens = tokensToValidate.map((t) => t.participantToken).filter(Boolean);
		const adminTokens = tokensToValidate.map((t) => t.adminToken).filter(Boolean);

		// Construire un filtre OR avec des paramètres nommés (sécurisé, compatible JSVM)
		const tokenParams = {};
		const conditions = [];
		participantTokens.forEach((t, i) => {
			tokenParams[`pt_${i}`] = t;
			conditions.push(`participantToken = {:pt_${i}}`);
		});
		adminTokens.forEach((t, i) => {
			tokenParams[`at_${i}`] = t;
			conditions.push(`adminToken = {:at_${i}}`);
		});
		const newMasters =
			conditions.length > 0
				? $app.findRecordsByFilter(
						'planning_masters',
						conditions.join(' || '),
						'',
						0,
						0,
						tokenParams
					)
				: [];

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

	return e.json(200, {
		success: true,
		syncedIds: Array.from(currentMasterIds)
	});
});

// ============================================
// CLAIM PARTICIPANT IDENTITY (guest → auth migration)
// ============================================

/**
 * Permet à un utilisateur authentifié de revendiquer une identité guest existante.
 *
 * Logique de merge :
 * - Pour chaque occurrence du master :
 *   - Si auth ET guest ont répondu :
 *     - Même valeur → drop guest (stats.identical)
 *     - Valeurs divergentes → auth wins, drop guest (stats.conflict)
 *   - Si seul guest a répondu → migrer vers auth (stats.migrated)
 *   - Si seul auth a répondu → inchangé
 * - Comments : re-attribution du participantId vers auth (stats.commentsMigrated)
 *
 * Mise à jour master.participants :
 * - Si auth existait → supprimer guest (ses données sont migrées)
 * - Sinon → transformer guest en participant auth (ajoute userId)
 *
 * Transaction atomique via runInTransaction.
 * Le realtime est déclenché automatiquement via txApp.save() sur chaque record modifié.
 */
routerAdd('POST', '/api/claim-participant-identity', (e) => {
	if (!e.auth) throw new ApiError(401, 'Auth required');

	const body = e.requestInfo().body;
	const masterId = body?.masterId;
	const guestParticipantId = body?.guestParticipantId;
	const authUserId = e.auth.id;

	if (!masterId || !guestParticipantId) {
		throw new ApiError(400, 'masterId and guestParticipantId required');
	}

	const queryToken = e.requestInfo()?.query?.['_token'] || '';

	const stats = { identical: 0, conflict: 0, migrated: 0, commentsMigrated: 0 };
	let authParticipantId = null;

	e.app.runInTransaction((txApp) => {
		// 1. Fetch master
		const master = txApp.findRecordById('planning_masters', masterId);

		// 2. Token validation (participantToken ou adminToken du master)
		const adminToken = master.getString('adminToken');
		const participantToken = master.getString('participantToken');
		if (queryToken !== adminToken && queryToken !== participantToken) {
			throw new ApiError(403, 'Invalid token');
		}

		// 3. Parse participants JSON
		let participants = [];
		const rawParticipants = master.getString('participants');
		if (rawParticipants && rawParticipants !== 'null') {
			try {
				participants = JSON.parse(rawParticipants);
			} catch {
				participants = [];
			}
		}

		// 4. Validate guest participant
		const guest = participants.find((p) => p && p.id === guestParticipantId);
		if (!guest) throw new ApiError(404, 'Guest participant not found');
		if (guest.userId) throw new ApiError(409, 'Participant already claimed');
		if (guest.hasQuit) throw new ApiError(409, 'Cannot claim a quit participant');

		// 5. Find existing auth participant (déjà lié via userId)
		//    Sert de "source" à migrer vers guest (qui devient la target finale).
		//    L'utilisateur revendique l'identité guest : c'est elle qui devient l'identité auth.
		//    On filtre `!p.hasQuit` pour rester cohérent avec le client (`myParticipant`),
		//    et éviter qu'un participant « quitté » soit considéré comme l'identité auth active.
		const authParticipants = participants.filter((p) => p && p.userId === authUserId && !p.hasQuit);

		// Garde anti multi-participants-actifs-par-userId : ce CAS ne devrait pas
		// se produire en flux normal (le guard `hasQuitThisPlanning` prioritaire
		// côté client bloque l'auto-add tant que le choix rejoindre/quit n'est pas fait).
		// On le rejette explicitement pour se prémunir des race conditions / états Dexie
		// incohérents (sinon le `find` ci-dessous serait non déterministe).
		if (authParticipants.length > 1) {
			throw new ApiError(409, 'Multiple active participants for this user — data inconsistency');
		}
		const auth = authParticipants[0];

		// Garde anti multi-revendication : un user auth ne peut revendiquer qu'une seule
		// identité guest par planning. Le marqueur `claimedAt` est posé lors d'une
		// revendication réussie (cf. étape 8 ci-dessous). Un participant auto-ajouté
		// (CAS C) n'a pas de `claimedAt`, donc la première revendication reste autorisée.
		if (auth && auth.claimedAt) {
			throw new ApiError(409, 'Identity already claimed on this planning');
		}

		const targetId = guestParticipantId; // guest devient l'identité finale
		const sourceId = auth ? auth.id : null; // auth sera supprimé (si existait)
		authParticipantId = targetId; // retourné au client

		// 6. Fetch all occurrences for master
		const occurrences = txApp.findRecordsByFilter(
			'planning_occurrences',
			'master = {:masterId}',
			'',
			0,
			0,
			{ masterId }
		);

		// 7. Merge responses + comments per occurrence
		//    targetId = guest.id (identité finale)
		//    sourceId = auth.id (à supprimer si existait)
		//    Règle : auth wins sur conflit (la valeur d'auth est conservée)
		//            mais re-attribuée à targetId (l'identité guest devient l'identité user)
		for (const occ of occurrences) {
			let responses = [];
			const rawResponses = occ.getString('responses');
			if (rawResponses && rawResponses !== 'null') {
				try {
					responses = JSON.parse(rawResponses);
				} catch {
					responses = [];
				}
			}

			let comments = [];
			const rawComments = occ.getString('comments');
			if (rawComments && rawComments !== 'null') {
				try {
					comments = JSON.parse(rawComments);
				} catch {
					comments = [];
				}
			}

			const guestResp = responses.find((r) => r && r.participantId === targetId);
			const authResp = sourceId ? responses.find((r) => r && r.participantId === sourceId) : null;

			// Filtrer les responses target ET source (on va ré-insérer la bonne valeur)
			let newResponses = responses.filter(
				(r) => !(r && (r.participantId === targetId || r.participantId === sourceId))
			);
			let occChanged = false;

			if (authResp && guestResp) {
				// Les deux ont répondu — auth wins, re-attribué à targetId
				if (JSON.stringify(guestResp.response) === JSON.stringify(authResp.response)) {
					stats.identical++;
				} else {
					stats.conflict++;
				}
				newResponses.push({ ...authResp, participantId: targetId });
				occChanged = true;
			} else if (authResp) {
				// Seul auth a répondu → re-attribuer à targetId (sans stat, c'est un rename d'ownership)
				newResponses.push({ ...authResp, participantId: targetId });
				occChanged = true;
			} else if (guestResp) {
				// Seul guest a répondu → migré vers l'identité auth (counted as migrated)
				stats.migrated++;
				newResponses.push(guestResp); // déjà à targetId
				occChanged = true;
			}

			// Re-attribute comments du source vers target (id reste = comment ID)
			let newComments = comments;
			if (sourceId) {
				const hasSourceComments = comments.some((c) => c && c.participantId === sourceId);
				if (hasSourceComments) {
					newComments = comments.map((c) => {
						if (c && c.participantId === sourceId) {
							stats.commentsMigrated++;
							return { ...c, participantId: targetId };
						}
						return c;
					});
					occChanged = true;
				}
			}

			if (occChanged) {
				occ.set('responses', newResponses);
				occ.set('comments', newComments);
				txApp.save(occ); // déclenche realtime
			}
		}

		// 8. Update master.participants
		//    - Si auth existait : le supprimer (ses données sont migrées vers guest)
		//    - Ajouter userId + claimedAt sur guest (devient l'identité auth officielle,
		//      et est marqué « déjà revendiqué » pour bloquer toute nouvelle tentative).
		const claimedAt = new Date().toISOString();
		let newParticipants;
		if (auth) {
			newParticipants = participants
				.filter((p) => !(p && p.id === sourceId))
				.map((p) => (p && p.id === targetId ? { ...p, userId: authUserId, claimedAt } : p));
		} else {
			newParticipants = participants.map((p) =>
				p && p.id === targetId ? { ...p, userId: authUserId, claimedAt } : p
			);
		}

		master.set('participants', newParticipants);
		txApp.save(master); // déclenche realtime
	});

	return e.json(200, { success: true, stats, authParticipantId });
});

// ============================================
// PLANNING EDIT LOCK (R5.3)
// ============================================
// Verrouillage d'édition purement UX : aucune restriction d'écriture côté serveur
// sur planning_masters. Le lock signale l'édition concurrente admin ; _version (OCC)
// reste le garde-fou data au save. Collection dédiée pour éviter de polluer le
// realtime master avec les heartbeats (2 min). Helpers dans lock-utils.js.

// Acquire / heartbeat / création lazy. Routes non auth-gated : un admin guest
// n'a que le token admin en query param, on valide via master.adminToken.
// lockedBy = identifiant client détenteur (currentUser.id) passé dans le body :
// permet de distinguer deux sessions partageant la même URL admin (même adminToken).
routerAdd('POST', '/api/lock/{masterId}', (e) => {
	const { lockIsActive, lockInfoPayload } = require(`${__hooks}/lock-utils.js`);
	const masterId = e.request.pathValue('masterId');
	const token = e.requestInfo()?.query?.['_token'] || '';
	if (!token) throw new ApiError(401, 'Missing token');

	let masters = [];
	try {
		masters = e.app.findRecordsByFilter(
			'planning_masters',
			'id = {:masterId} && adminToken = {:token}',
			'',
			1,
			0,
			{ masterId, token }
		);
	} catch (err) {
		throw new ApiError(403, 'Invalid admin token');
	}
	if (!masters.length) throw new ApiError(403, 'Invalid admin token');

	const body = e.requestInfo().body || {};
	const userId = typeof body.lockedBy === 'string' ? body.lockedBy : '';
	if (!userId) throw new ApiError(400, 'lockedBy (client user id) required');
	const lockedByName = typeof body.lockedByName === 'string' ? body.lockedByName : '';

	let locks = [];
	try {
		locks = e.app.findRecordsByFilter('planning_locks', 'master = {:masterId}', '', 1, 0, {
			masterId
		});
	} catch (err) {
		throw new ApiError(500, 'Failed to query lock');
	}

	let lock = locks.length ? locks[0] : null;

	// Cas 1 — pas de row : création lazy. Un acquire concurrent peut gagner la
	// course (index unique sur master) : si le save échoue, on relit la row créée
	// par le gagnant et on retombe sur la logique heartbeat/conflit/expiration.
	if (!lock) {
		try {
			const collection = e.app.findCollectionByNameOrId('planning_locks');
			const record = new Record(collection);
			record.set('master', masterId);
			record.set('lockedBy', userId);
			record.set('lockedByName', lockedByName);
			e.app.save(record);
			return e.json(200, lockInfoPayload(record));
		} catch (err) {
			try {
				const raced = e.app.findRecordsByFilter(
					'planning_locks',
					'master = {:masterId}',
					'',
					1,
					0,
					{ masterId }
				);
				lock = raced.length ? raced[0] : null;
			} catch (e2) {
				throw new ApiError(500, 'Failed to query lock after race');
			}
			if (!lock) throw new ApiError(500, 'Lock creation failed');
		}
	}

	// Cas 2 — même détenteur : heartbeat (lockedAt rafraîchi par autodate onUpdate)
	if (lock.getString('lockedBy') === userId) {
		lock.set('lockedByName', lockedByName); // force un set pour garantir l'update
		e.app.save(lock);
		return e.json(200, lockInfoPayload(lock));
	}

	// Cas 3 — lock expiré par autrui : ré-acquisition
	if (!lockIsActive(lock)) {
		lock.set('lockedBy', userId);
		lock.set('lockedByName', lockedByName);
		e.app.save(lock);
		return e.json(200, lockInfoPayload(lock));
	}

	// Cas 4 — conflit : lock frais par autrui
	return e.json(409, {
		error: 'Lock held by another admin',
		...lockInfoPayload(lock)
	});
});

// Release : clear lockedBy (la row reste permanente, 1 row/master via index unique).
routerAdd('POST', '/api/unlock/{masterId}', (e) => {
	const { lockIsActive } = require(`${__hooks}/lock-utils.js`);
	const masterId = e.request.pathValue('masterId');
	const token = e.requestInfo()?.query?.['_token'] || '';
	if (!token) throw new ApiError(401, 'Missing token');

	let masters = [];
	try {
		masters = e.app.findRecordsByFilter(
			'planning_masters',
			'id = {:masterId} && adminToken = {:token}',
			'',
			1,
			0,
			{ masterId, token }
		);
	} catch (err) {
		throw new ApiError(403, 'Invalid admin token');
	}
	if (!masters.length) throw new ApiError(403, 'Invalid admin token');

	const body = e.requestInfo().body || {};
	const userId = typeof body.lockedBy === 'string' ? body.lockedBy : '';

	let locks = [];
	try {
		locks = e.app.findRecordsByFilter('planning_locks', 'master = {:masterId}', '', 1, 0, {
			masterId
		});
	} catch (err) {
		throw new ApiError(500, 'Failed to query lock');
	}

	if (!locks.length) {
		// Rien à release — idempotent (la row peut ne pas exister si jamais lockée)
		return e.json(200, { released: true });
	}

	const lock = locks[0];
	const currentHolder = lock.getString('lockedBy');

	// Autorisé si détenteur, OU row vide (lockedBy=''), OU lock expiré (zombie).
	// Sinon (lock frais par autrui) → 403.
	if (currentHolder === userId || !currentHolder || !lockIsActive(lock)) {
		lock.set('lockedBy', '');
		lock.set('lockedByName', '');
		e.app.save(lock);
		return e.json(200, { released: true });
	}

	throw new ApiError(403, 'Cannot release lock held by another admin');
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
	// e.app
	// 	.logger()
	// 	.info(
	// 		'UPDATE HOOK',
	// 		'collection',
	// 		e.collection.name,
	// 		'hasAuth',
	// 		!!e.auth,
	// 		'token',
	// 		e.requestInfo()?.query?.['_token'] || 'NONE'
	// 	);

	if (e.collection.name !== 'planning_occurrences') {
		return e.next();
	}
	// Superusers bypass (e.admin est déprécié en PB 0.36+, utiliser hasSuperuserAuth())
	if (e.requestInfo().hasSuperuserAuth()) {
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

	// === MERGE ATOMIQUE DES CHAMPS ADDITIFS ===
	// Les champs tableaux JSON (responses/comments/tasks) sont mergés côté serveur
	// avec l'état DB AVANT modification, de façon atomique via la transaction SQLite de PB.
	//
	// Comportement PB 0.36 :
	//  - Dans onRecordUpdateRequest, le body a DÉJÀ été appliqué à e.record.
	//  - ⚠️ En JSVM, les champs JSON sont exposés en []byte (octets UTF-8 du JSON
	//    sérialisé), et ce VAUT AUSSI pour e.requestInfo().body.<field> dans le
	//    contexte d'un hook (contrairement aux routes custom où le middleware
	//    parse le JSON). On lit donc les deux côtés via jsonArrayField(), qui
	//    fait record.getString() (décodage natif des []byte) + JSON.parse().
	//  - `e.record.getString(field)` = body appliqué (valeur envoyée par le client).
	//  - `e.record.original().getString(field)` = état DB avant modification.
	//  - Le résultat mergé est persisté via e.record.set().
	const { mergeByKey, jsonArrayField } = require(`${__hooks}/merge-utils.js`);
	const occBody = e.requestInfo().body || {};
	const occOriginal = e.record.original();
	if ('responses' in occBody) {
		e.record.set(
			'responses',
			mergeByKey(
				'participantId',
				jsonArrayField(e.record, 'responses'),
				jsonArrayField(occOriginal, 'responses')
			)
		);
	}
	if ('comments' in occBody) {
		e.record.set(
			'comments',
			mergeByKey(
				'id',
				jsonArrayField(e.record, 'comments'),
				jsonArrayField(occOriginal, 'comments')
			)
		);
	}
	if ('tasks' in occBody) {
		e.record.set(
			'tasks',
			mergeByKey('id', jsonArrayField(e.record, 'tasks'), jsonArrayField(occOriginal, 'tasks'))
		);
	}

	// === VERROUILLAGE OPTIMISTE ===
	const version = e.requestInfo()?.query?.['_version'];
	if (version) {
		const currentUpdated = e.record.get('updated').toString();
		// On compare les versions. Si elles diffèrent, quelqu'un a modifié le record entre temps.
		if (currentUpdated !== version) {
			throw new ApiError(409, 'Conflict: The record has been modified by another user.');
		}
	}

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
	// Superusers bypass tout
	if (e.requestInfo().hasSuperuserAuth()) {
		e.next();
		return;
	}
	// e.app
	// 	.logger()
	// 	.info(
	// 		'UPDATE HOOK',
	// 		'collection',
	// 		e.collection.name,
	// 		'hasAuth',
	// 		!!e.auth,
	// 		'token',
	// 		e.requestInfo()?.query?.['_token'] || 'NONE'
	// 	);

	if (e.collection.name !== 'planning_masters') {
		return e.next();
	}

	// Superusers bypass (e.admin est déprécié en PB 0.36+)
	if (e.requestInfo().hasSuperuserAuth()) {
		e.next();
		return;
	}

	const token = e.requestInfo()?.query?.['_token'] || '';
	if (!token) throw new ApiError(401, 'Missing token');

	const adminToken = e.record.get('adminToken');
	const participantToken = e.record.get('participantToken');
	const isAdmin = token === adminToken;
	const isParticipant = token === participantToken;

	if (!isAdmin && !isParticipant) {
		throw new ApiError(403, 'Invalid token');
	}

	// === MERGE ATOMIQUE DES CHAMPS ADDITIFS ===
	// Les champs tableaux JSON (participants/tasks) sont mergés côté serveur
	// avec l'état DB AVANT modification, de façon atomique via la transaction SQLite de PB.
	//
	// Comportement PB 0.36 :
	//  - Dans onRecordUpdateRequest, le body a DÉJÀ été appliqué à e.record.
	//  - ⚠️ En JSVM, les champs JSON sont exposés en []byte (octets UTF-8 du JSON
	//    sérialisé), et ce VAUT AUSSI pour e.requestInfo().body.<field> dans le
	//    contexte d'un hook (contrairement aux routes custom où le middleware
	//    parse le JSON). On lit donc les deux côtés via jsonArrayField(), qui
	//    fait record.getString() (décodage natif des []byte) + JSON.parse().
	//  - `e.record.getString(field)` = body appliqué (valeur envoyée par le client).
	//  - `e.record.original().getString(field)` = état DB avant modification.
	//  - Le résultat mergé est persisté via e.record.set().
	const { mergeByKey, jsonArrayField } = require(`${__hooks}/merge-utils.js`);
	const masterBody = e.requestInfo().body || {};
	const masterOriginal = e.record.original();
	if ('participants' in masterBody) {
		e.record.set(
			'participants',
			mergeByKey(
				'id',
				jsonArrayField(e.record, 'participants'),
				jsonArrayField(masterOriginal, 'participants')
			)
		);
	}
	if ('tasks' in masterBody) {
		e.record.set(
			'tasks',
			mergeByKey('id', jsonArrayField(e.record, 'tasks'), jsonArrayField(masterOriginal, 'tasks'))
		);
	}

	// === VERROUILLAGE OPTIMISTE ===
	const version = e.requestInfo()?.query?.['_version'];
	if (version) {
		const currentUpdated = e.record.get('updated').toString();
		if (currentUpdated !== version) {
			throw new ApiError(409, 'Conflict: The record has been modified by another user.');
		}
	}

	// === RESTRICTION DES CHAMPS PAR RÔLE ===
	// API Rules autorisent tout token valide → ce hook restreint les champs selon le rôle
	if (isParticipant) {
		const body = e.requestInfo().body || {};
		const allowedFields = ['participants', 'lastModifiedBy', 'updated'];
		for (const field of Object.keys(body)) {
			if (!allowedFields.includes(field)) {
				throw new ApiError(403, 'Participants can only update participants field');
			}
		}
	}
	// isAdmin → pas de restriction sur les champs

	e.next();
}, 'planning_masters');

// Security : empeché les doublon de participants.id
// onRecordUpdate((e) => {
// 	if (e.collection.name !== 'planning_masters') return e.next();

// 	const participants = e.record.get('participants');
// 	if (Array.isArray(participants) && participants.length > 0) {
// 		// Dédoublonnage par ID (garde le dernier)
// 		const seen = new Map();
// 		for (const p of participants) {
// 			if (p && p.id) {
// 				seen.set(p.id, p);
// 			}
// 		}
// 		e.record.set('participants', Array.from(seen.values()));
// 	}

// 	e.next();
// }, 'planning_masters');

// ============================================
// CHECK IF PARTICIPANT HAS ACCOUNT
// ============================================

/*
 * DEPRECATED (2026-06-17) — Hook non supprimé mais désactivé.
 *
 * Ce endpoint vérifiait si un participant avait un compte en faisant
 * `findRecordById('users', participantId)`. Cette logique reposait sur
 * l'ancien invariant `participant.id === participant.userId`, aujourd'hui
 * cassé par l'introduction du champ `userId` dans `participants[]` :
 * un guest revendiqué (CAS B) garde son UUID original comme `id` mais
 * reçoit un `userId` différent. La recherche `users/{participantId}`
 * renvoyait donc 404 → `{ hasAccount: false }` à tort, permettant à un
 * guest de « revendiquer » une identité protégée sans s'authentifier.
 *
 * La vérification est désormais effectuée côté client directement via
 * `participant.userId` (cf. NameConflictHandler.attemptIdentifyAs),
 * ce qui est plus correct, sans latence, et sans surface d'attaque.
 *
 * Aucun appelant côté client. Conservé commenté pour mémoire ; suppression
 * hard possible dans un second temps.
 */
/*
routerAdd('GET', '/api/has-account/{id}', (e) => {
	const participantId = e.request.pathValue('id');

	if (!participantId) {
		return e.json(400, { error: 'Missing participant id' });
	}

	try {
		e.app.findRecordById('users', participantId);
		return e.json(200, { hasAccount: true });
	} catch (err) {
		return e.json(200, { hasAccount: false });
	}
});
*/

// ============================================
// MIGRATE PARTICIPANT IDS
// ============================================

// ============================================
// RECORD ENRICH - Masquer les tokens
// ============================================

/**
 * Masquer le champ adminToken dans tous les records enrichis
 * onRecordEnrich est exécuté pour les API ET les messages realtime
 */
onRecordEnrich((e) => {
	const isAuthAdmin = e.requestInfo?.auth?.collectionName === '_superusers';
	if (isAuthAdmin) return e.next();

	const adminToken = e.record.get('adminToken');
	const authUser = e.requestInfo?.auth;
	const queryToken = e.requestInfo?.query?._token;

	// 1. User connecté : vérifier adminOf
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
			if (adminOf[e.record.id] === adminToken) return e.next();
		} catch (err) {
			// Non-bloquant
		}
	}

	// 2. Token query param (guest realtime) : vérifier si c'est l'adminToken
	if (queryToken && queryToken === adminToken) {
		return e.next();
	}

	// Sinon masquer
	e.record.hide('adminToken');
	e.next();
}, 'planning_masters');
