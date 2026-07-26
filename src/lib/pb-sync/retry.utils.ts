/**
 * pb-sync — Retry utilitaire générique.
 *
 * Wrapper de retry avec backoff exponentiel + full jitter (AWS pattern).
 * Aucune référence métier : fonctionne avec n'importe quelle fonction async.
 *
 * ## Classification des erreurs
 *
 * - **Retryable** : `status >= 500` (erreurs serveur), `status === 0`
 *   (réseau down / CORS / fetch échoué), `TypeError` (fetch failed),
 *   `AbortError` / timeout applicatif.
 * - **Non-retryable** : `status` 4xx (400, 401, 403, 404, 409...),
 *   `RecordDeletedError` (détectée par `err.name`, sans import pour rester
 *   découplé de `collection.ts` et éviter une dépendance circulaire), et toute
 *   autre erreur métier/programmation par défaut.
 *
 * Le **409 (Conflict)** est non-retryable : un retry naïf échouerait à
 * l'identique car le payload ne change pas. Il remonte au caller, qui
 * déclenche le rollback standard.
 *
 * ## Backoff — Full Jitter (AWS)
 *
 * ```
 * expo  = min(capMs, baseDelayMs * 2 ** attempt)
 * delay = random() * expo   // ∈ [0, expo]
 * ```
 *
 * Le jitter complet répartit les retries des clients sur une fenêtre
 * exponentielle, ce qui évite le thundering herd quand le serveur revient
 * après une indisponibilité (tous les clients ne retombent pas en même temps).
 *
 * ## Defaults
 *
 * - `maxRetries = 2` → 3 tentatives au total.
 * - `baseDelayMs = 500`.
 * - `capMs = 8000` (8 s).
 *
 * @module pb-sync/retry.utils
 */

export interface RetryOptions {
	/** Nombre de retries après l'échec initial. Défaut : 2 (3 tentatives au total). */
	maxRetries?: number;
	/** Délai de base en ms, facteur de l'exponentielle. Défaut : 500. */
	baseDelayMs?: number;
	/** Plafond du délai exponentiel en ms. Défaut : 8000. */
	capMs?: number;
}

/**
 * Détermine si une erreur justifie une nouvelle tentative.
 *
 * Voir la JSDoc du module pour la classification complète et la rationale
 * du 409 non-retryable.
 */
export function isRetryableError(err: unknown): boolean {
	// RecordDeletedError → signal métier (404 mappé), pas de retry.
	if (err instanceof Error && err.name === "RecordDeletedError") return false;

	if (err != null && typeof err === "object") {
		const status = (err as { status?: unknown }).status;
		// status 0 → réseau down / CORS / fetch échoué → retry.
		if (status === 0) return true;
		// 5xx → erreurs serveur (transitoires) → retry.
		if (typeof status === "number" && status >= 500) return true;
		// 4xx (400, 401, 403, 404, 409...) → erreurs client, retry inutile.
		if (typeof status === "number" && status >= 400 && status < 500) return false;
	}

	// TypeError → fetch failed / erreur réseau côté navigateur → retry.
	if (err instanceof TypeError) return true;

	if (err instanceof Error) {
		// AbortError → timeout fetch (AbortController) → retry.
		if (err.name === "AbortError") return true;
		// Timeout applicatif (ex: AbortSignal.timeout sur un fetch) → retry.
		if (/timeout/i.test(err.message)) return true;
	}

	// Par défaut : non-retryable (erreurs métier, erreurs de programmation).
	return false;
}

/**
 * Exécute `fn` avec retry + backoff exponentiel full jitter.
 *
 * - `attempt` part de 0 (premier appel, pas de délai).
 * - Sur erreur retryable et `attempt < maxRetries` : attend `delay` puis retry.
 * - Sur erreur non-retryable : throw immédiatement (pas de délai, pas de retry).
 * - Sur `attempt === maxRetries` : throw la dernière erreur.
 *
 * Le caller reste responsable du rollback/optimistic update : les retries sont
 * internes à `withRetry`, le rollback final ne se déclenche qu'à la sortie en
 * erreur (non-retryable ou épuisement des tentatives).
 *
 * @see RetryOptions pour les defaults.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts?: RetryOptions): Promise<T> {
	const maxRetries = opts?.maxRetries ?? 2;
	const baseDelayMs = opts?.baseDelayMs ?? 500;
	const capMs = opts?.capMs ?? 8000;

	let lastError: unknown;
	let attempt = 0;

	while (attempt <= maxRetries) {
		try {
			return await fn();
		} catch (err) {
			lastError = err;
			if (!isRetryableError(err)) throw err;
			if (attempt === maxRetries) throw err;

			const expo = Math.min(capMs, baseDelayMs * 2 ** attempt);
			const delay = Math.random() * expo;
			await new Promise((resolve) => setTimeout(resolve, delay));
			attempt++;
		}
	}

	// Unreachable : le while ne sort que via return/throw. Satisfait le type checker.
	throw lastError;
}
