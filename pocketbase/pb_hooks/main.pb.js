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

// ============================================
// RECORD ENRICH - Masquer les tokens
// ============================================

/**
 * Masquer le champ adminToken dans tous les records enrichis
 * onRecordEnrich est exécuté pour les API ET les messages realtime
 *
 * Note: Ce hook est conservé temporairement. À terme, adminToken sera marqué comme Hidden
 * dans le schéma de la collection planning_masters.
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
