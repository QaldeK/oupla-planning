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
