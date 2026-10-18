// Globales injectées hors page web standard, typées ici pour éviter les casts `as any`.

declare global {
	interface Window {
		/** Injecté par Tauri au runtime, absent du navigateur. */
		__TAURI__?: unknown;
	}

	interface Navigator {
		/** Propriété Safari non-standard : true si la PWA tourne en mode standalone iOS. */
		standalone?: boolean;
	}
}

export {};
