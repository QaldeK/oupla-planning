// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	/**
	 * Événement beforeinstallprompt — API Chromium uniquement (Chrome, Edge).
	 * Non inclus dans lib.dom.d.ts car pas standardisé W3C.
	 * Permet de capturer le prompt d'installation natif pour le déclencher manuellement.
	 */
	interface BeforeInstallPromptEvent extends Event {
		prompt(): Promise<void>;
		userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
	}

	/**
	 * API getInstalledRelatedApps — Chromium uniquement (Android 84+, desktop
	 * 140+), non standardisée W3C. Détecte une PWA installée sur le terminal
	 * (manifest auto-déclaré via related_applications) pour masquer l'invite
	 * d'installation dans l'onglet navigateur.
	 */
	interface RelatedApplication {
		platform: string;
		id?: string;
		url?: string;
		version?: string;
	}

	interface Navigator {
		getInstalledRelatedApps?: () => Promise<RelatedApplication[]>;
	}

	namespace App {
		interface Platform {
			env: Env;
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf?: IncomingRequestCfProperties;
		}

		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
