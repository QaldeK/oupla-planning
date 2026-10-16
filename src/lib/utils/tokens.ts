/**
 * Générateurs d'identifiants du domaine Planning : tokens d'accès (ADR-0001)
 * et ids locaux courts (participant, commentaire).
 */

/** adminToken — 64 hex. */
export function generateAdminToken(): string {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** participantToken — 32 hex. */
export function generateParticipantToken(): string {
	const array = new Uint8Array(16);
	crypto.getRandomValues(array);
	return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Id local court (participant, commentaire) — 16 hex, pas un secret. */
export function generateParticipantId(): string {
	const array = new Uint8Array(8);
	crypto.getRandomValues(array);
	return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}
