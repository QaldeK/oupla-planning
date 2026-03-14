/// <reference path="../pb_data/types.d.ts" />

/**
 * Hooks pour sécuriser l'accès aux plannings via token-based authentication
 *
 * Architecture de sécurité :
 * - Tokens dénormalisés dans chaque occurrence (adminToken, participantToken)
 * - Authentification via query param "_token" (pas de header x_token)
 * - Admin a tous les droits (e.admin check)
 * - Participants peuvent uniquement modifier le champ "responses"
 *
 * IMPORTANT : Chaque hook DOIT avoir un identifiant unique (dernier paramètre)
 * Sans identifiant, le hook s'applique globalement à toutes les collections !
 *
 * Exemple : onRecordViewRequest((e) => { ... }, 'planningOccurrencesView');
 *                                                    ^^^^^^^^^^^^^^^^^^^^^^^^
 *                                                    Identifiant unique OBLIGATOIRE
 */

// Note: Les fonctions helper ne peuvent pas être définies en dehors des hooks
// car PocketBase compile chaque hook séparément. Il faut inliner le code.
// isAdmin(e) -> e.admin
// getToken(e) -> e.httpContext?.queryParam('_token')

// ============================================
// PLANNING_MASTERS HOOKS
// ============================================

onRecordsListRequest((e) => {
	if (e.collection.name !== 'planning_masters') {
		return e.next();
	}

	// Admin a tous les droits
	if (e.admin) {
		return e.next();
	}

	// Lire le token via query param
	const token = e.httpContext?.queryParam('_token') || '';
	if (!token) {
		e.records = [];
		return e.next();
	}

	e.records = e.records.filter((item) => {
		return item.get('adminToken') === token || item.get('participantToken') === token;
	});

	// Note: Le masquage des tokens est centralisé dans onRecordEnrich
	e.next();
}, 'planningMastersList');

onRecordViewRequest((e) => {
	if (e.collection.name !== 'planning_masters') {
		return e.next();
	}

	if (e.admin) {
		return e.next();
	}

	// Lire le token via query param
	const token = e.httpContext?.queryParam('_token') || '';
	if (!token) {
		throw new ApiError(401, 'Missing token');
	}

	const adminToken = e.record.get('adminToken');
	const participantToken = e.record.get('participantToken');

	if (token !== adminToken && token !== participantToken) {
		throw new ApiError(403, 'Invalid token');
	}

	// Note: Le masquage des tokens est centralisé dans onRecordEnrich
	e.next();
}, 'planningMastersView');
onRecordCreateRequest((e) => {
	if (e.collection.name !== 'planning_masters') {
		return e.next();
	}

	// Note: Les tokens sont maintenant générés côté client
	// Ce hook peut être utilisé pour d'autres validations si nécessaire
	e.next();
}, 'planningMastersCreate');

onRecordUpdateRequest((e) => {
	if (e.collection.name !== 'planning_masters') {
		return e.next();
	}

	if (e.admin) {
		return e.next();
	}

	// Lire le token via query param
	const token = e.httpContext?.queryParam('_token') || '';
	if (!token) {
		throw new ApiError(401, 'Missing token');
	}

	const adminToken = e.record.get('adminToken');
	if (token !== adminToken) {
		throw new ApiError(403, 'Admin token required');
	}

	e.next();
}, 'planningMastersUpdate');

onRecordDeleteRequest((e) => {
	if (e.collection.name !== 'planning_masters') {
		return e.next();
	}

	if (e.admin) {
		return e.next();
	}

	// Lire le token via query param
	const token = e.httpContext?.queryParam('_token') || '';
	if (!token) {
		throw new ApiError(401, 'Missing token');
	}

	const adminToken = e.record.get('adminToken');
	if (token !== adminToken) {
		throw new ApiError(403, 'Admin token required');
	}

	e.next();
}, 'planningMastersDelete');

// ============================================
// PLANNING_OCCURRENCES HOOKS
// ============================================

onRecordsListRequest((e) => {
	if (e.collection.name !== 'planning_occurrences') {
		return e.next();
	}

	// Admin PocketBase : accès complet

	if (e.admin) {
		return e.next();
	}

	// Vérifier la présence du token

	const token = e.httpContext?.queryParam('_token') || '';

	if (!token) {
		e.records = []; // Aucun token = aucune donnée

		return e.next();
	}

	// Filtrer les records : le token doit correspondre à l'admin ou au participant du master
	const masterCache = new Map();

	e.records = e.records.filter((item) => {
		const masterId = item.get('master');
		if (!masterId) return false;

		// Vérifier si le master a déjà été validé pour ce token dans cette requête
		if (masterCache.has(masterId)) {
			return masterCache.get(masterId);
		}

		try {
			const master = e.app.findRecordById('planning_masters', masterId);
			const adminToken = master.get('adminToken');
			const participantToken = master.get('participantToken');

			const isValid = token === adminToken || token === participantToken;
			masterCache.set(masterId, isValid);
			return isValid;
		} catch (err) {
			masterCache.set(masterId, false);
			return false;
		}
	});

	e.next();
}, 'planningOccurrencesList');

onRecordViewRequest((e) => {
	if (e.collection.name !== 'planning_occurrences') {
		return e.next();
	}

	if (e.admin) {
		return e.next();
	}

	// Lire le token via query param
	const token = e.httpContext?.queryParam('_token') || '';
	if (!token) {
		throw new ApiError(401, 'Missing token');
	}

	const masterId = e.record.get('master');
	if (!masterId) {
		throw new ApiError(404, 'Master not found');
	}

	const master = e.app.findRecordById('planning_masters', masterId);
	const adminToken = master.get('adminToken');
	const participantToken = master.get('participantToken');

	if (token !== adminToken && token !== participantToken) {
		throw new ApiError(403, 'Invalid token');
	}

	e.next();
}, 'planningOccurrencesView');

onRecordCreateRequest((e) => {
	if (e.collection.name !== 'planning_occurrences') {
		return e.next();
	}

	if (e.admin) {
		return e.next();
	}

	const adminToken = e.record.get('adminToken');

	if (!adminToken) {
		throw new ApiError(401, 'Missing admin token');
	}

	const masterId = e.record.get('master');
	if (!masterId) {
		throw new ApiError(400, 'Master ID required');
	}

	let master;
	try {
		master = e.app.findRecordById('planning_masters', masterId);
	} catch (err) {
		throw new ApiError(404, 'Master not found: ' + masterId);
	}

	const masterAdminToken = master.get('adminToken');
	if (adminToken !== masterAdminToken) {
		throw new ApiError(403, 'Admin token required');
	}

	e.next();
}, 'planningOccurrencesCreate');

onRecordUpdateRequest((e) => {
	if (e.collection.name !== 'planning_occurrences') {
		return e.next();
	}

	if (e.admin) {
		return e.next();
	}

	// Lire le token depuis les query params
	const url = e.httpContext?.request()?.url;
	const token = url?.searchParams?.get('_token') || '';

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
	const version = e.httpContext.queryParam('_version');
	if (version) {
		const currentUpdated = e.record.get('updated').toString();
		// On compare les versions. Si elles diffèrent, quelqu'un a modifié le record entre temps.
		if (currentUpdated !== version) {
			throw new ApiError(409, 'Conflict: The record has been modified by another user.');
		}
	}

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
}, 'planningOccurrencesUpdate');
onRecordDeleteRequest((e) => {
	if (e.collection.name !== 'planning_occurrences') {
		return e.next();
	}

	if (e.admin) {
		return e.next();
	}

	// Lire le token depuis les query params
	const token = e.httpContext?.request()?.url?.searchParams?.get('_token') || '';
	if (!token) {
		throw new ApiError(401, 'Missing token');
	}

	const masterId = e.record.get('master');
	if (!masterId) {
		throw new ApiError(400, 'Master ID required');
	}

	const master = e.app.findRecordById('planning_masters', masterId);

	const adminToken = master.get('adminToken');
	if (token !== adminToken) {
		throw new ApiError(403, 'Admin token required');
	}

	e.next();
}, 'planningOccurrencesDelete');

// ============================================
// REALTIME ENRICH - Masquer les tokens
// ============================================

/**
 * Masquer les tokens dans tous les records enrichis
 * onRecordEnrich est exécuté pour les API ET les messages realtime
 */
onRecordEnrich((e) => {
	const collectionName = e.record.collection().name;
	if (collectionName === 'planning_masters' || collectionName === 'planning_occurrences') {
		// Ne pas masquer si l'utilisateur est un super-utilisateur (PocketBase Admin)
		const isAuthAdmin = e.requestInfo?.auth?.collectionName === '_superusers';

		if (!isAuthAdmin) {
			e.record.hide('adminToken');
			// On peut aussi masquer participantToken si besoin, mais souvent utile pour les participants
			// e.record.hide('participantToken');
		}
	}

	e.next();
}, 'planningEnrich');
