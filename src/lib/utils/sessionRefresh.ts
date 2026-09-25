/**
 * Refresh silencieux du token d'auth PocketBase (session glissante).
 *
 * Fonction pure — dépendances injectées via `deps`, appelée au boot par
 * `userStore.init()` en fire-and-forget.
 *
 * Sans refresh, `pb.authStore.isValid` repasse à false après la durée du
 * token (config serveur) : l'user est déconnecté malgré un usage régulier de
 * l'app. `authRefresh()` émet un nouveau token, persisté automatiquement par
 * le LocalAuthStore.
 */
import { ClientResponseError } from "pocketbase";

/**
 * 4xx qui remettent en cause le token lui-même — seul motif de déconnexion
 * locale. 429 (rate limit) ou 408 (timeout) sont transitoires : déconnecter
 * sur ceux-là tuerait une session valide.
 */
const AUTH_REJECTION_STATUSES: ReadonlySet<number> = new Set([400, 401, 403]);

// =============================================
// Types
// =============================================

/** Dépendances injectées pour le refresh. */
export interface SessionRefreshDeps {
	/** Renouvelle le token (ex. `pb.collection("users").authRefresh()`). */
	authRefresh(): Promise<unknown>;
	/** Invalide l'état auth local (ex. `pb.authStore.clear()`). */
	clearAuth(): void;
}

// =============================================
// Refresh
// =============================================

/**
 * Tente le renouvellement du token d'auth.
 *
 * - rejet d'auth explicite (400/401/403 : token invalide, expiré côté
 *   serveur, tokenKey rotaté) → `clearAuth()` pour repasser en état guest.
 * - réseau (status 0), 5xx, annulation, 4xx transitoires (429 rate limit,
 *   408 timeout) → état local conservé (offline-first), nouvelle tentative
 *   au prochain démarrage.
 *
 * @param deps - Dépendances injectées (pour test avec fakes)
 * @returns Promesse qui ne rejette jamais.
 */
export async function refreshSessionSilently(deps: SessionRefreshDeps): Promise<void> {
	try {
		await deps.authRefresh();
	} catch (err: unknown) {
		if (err instanceof ClientResponseError && AUTH_REJECTION_STATUSES.has(err.status)) {
			deps.clearAuth();
		} else {
			console.warn(
				"[sessionRefresh] refresh ignoré (état local conservé):",
				err instanceof ClientResponseError ? err.message : err
			);
		}
	}
}
