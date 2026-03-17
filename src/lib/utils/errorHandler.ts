export function classifyError(err: unknown): {
	type: 'offline' | 'server-down' | 'business' | 'unknown';
	message: string;
	shouldNotifyAdmin: boolean;
} {
	// 1. Utilisateur hors ligne
	if (!navigator.onLine) {
		return {
			type: 'offline',
			message: 'Vous êtes hors ligne - Vérifiez votre connexion',
			shouldNotifyAdmin: false
		};
	}

	// 2. PocketBase injoignable (timeout, fetch error, network error)
	const errorMessage = err instanceof Error ? err.message.toLowerCase() : '';
	const errorObj = err as { status?: number; data?: any };

	// Timeout ou erreur de connexion
	if (
		errorMessage.includes('timeout') ||
		errorMessage.includes('fetch') ||
		errorMessage.includes('network') ||
		errorMessage.includes('connection') ||
		(err instanceof TypeError && (errorMessage.includes('load') || errorMessage.includes('failed')))
	) {
		return {
			type: 'server-down',
			message: 'Serveur momentanément indisponible - Réessayez dans un instant',
			shouldNotifyAdmin: true
		};
	}

	// Erreur HTTP 5xx (serveur)
	if (errorObj.status && errorObj.status >= 500 && errorObj.status < 600) {
		return {
			type: 'server-down',
			message: 'Serveur momentanément indisponible - Réessayez dans un instant',
			shouldNotifyAdmin: true
		};
	}

	// 3. Erreur PocketBase (business logic)
	if (err && typeof err === 'object' && 'data' in err) {
		const pbError = err as { data?: { message?: string } };
		if (pbError.data?.message) {
			return {
				type: 'business',
				message: pbError.data.message,
				shouldNotifyAdmin: false
			};
		}
	}

	// 4. Erreur inconnue
	return {
		type: 'unknown',
		message: 'Erreur inattendue - Réessayez plus tard',
		shouldNotifyAdmin: true
	};
}
