/// <reference path="../pb_data/types.d.ts" />
// ⚠️ AVANT toute modif : skill pocketbase-jsvm + doc Context7.

/**
 * Utilitaires partagés pour le verrouillage d'édition admin (R5.3).
 *
 * Le lock est purement UX : aucune restriction d'écriture côté serveur sur
 * planning_masters. `_version` (OCC) reste le garde-fou data au save. La
 * collection dédiée planning_locks évite de polluer le realtime master avec
 * les heartbeats.
 *
 * `lockedBy` = identifiant du client détenteur (currentUser.id côté client :
 * id PocketBase pour les users auth, id local Dexie pour les guests). Le
 * serveur ne le valide pas — c'est un simple marqueur de détenteur (l'auth de
 * la route repose sur master.adminToken via query param _token).
 */

// Un lock expire après 5 min sans heartbeat (le client envoie un heartbeat
// toutes les 2 min). La ré-acquisition après expiration est automatique.
const LOCK_TTL_MS = 5 * 60 * 1000;

// Un lock est "actif" si lockedBy non vide ET lockedAt récent (< TTL).
// Permet la ré-acquisition après expiration sans cleanup explicite (pas de cron).
function lockIsActive(lockRecord) {
	const lockedBy = lockRecord.getString('lockedBy');
	if (!lockedBy) return false;
	const lockedAtStr = lockRecord.getString('lockedAt');
	if (!lockedAtStr) return false;
	return Date.now() - new Date(lockedAtStr).getTime() < LOCK_TTL_MS;
}

// Timestamp d'expiration absolu (ms depuis epoch), dérivé de lockedAt.
function lockExpiresAtMs(lockRecord) {
	return new Date(lockRecord.getString('lockedAt')).getTime() + LOCK_TTL_MS;
}

// Sérialisation publique d'un lock pour les réponses HTTP (acquire/heartbeat/409).
function lockInfoPayload(lockRecord) {
	return {
		lockedBy: lockRecord.getString('lockedBy'),
		lockedByName: lockRecord.getString('lockedByName'),
		lockedAt: lockRecord.getString('lockedAt'),
		expiresAt: new Date(lockExpiresAtMs(lockRecord)).toISOString()
	};
}

module.exports = { LOCK_TTL_MS, lockIsActive, lockExpiresAtMs, lockInfoPayload };
