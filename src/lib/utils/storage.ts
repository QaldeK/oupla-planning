/**
 * Abstraction du stockage pour gérer le Web (LocalStorage/SessionStorage)
 * et utiliser le plugin Store de Tauri v2.
 *
 * Défensif au boot : toute valeur corrompue (JSON invalide) est loggée,
 * supprimée de son store, et `getItem` retourne `null` plutôt que de planter
 * l'application. Voir ADR 0006 (boot-error-recovery).
 */

export interface StorageOptions {
	persist?: boolean;
}

export const isBrowser = typeof window !== 'undefined';
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- __TAURI__ est injecté par Tauri, absent de Window
export const isTauri = isBrowser && !!(window as any).__TAURI__;

// Pour Tauri v2, on utilise LazyStore
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- LazyStore importé dynamiquement, pas de type statique
let tauriStore: any = null;

async function getTauriStore() {
	if (tauriStore) return tauriStore;
	if (isTauri) {
		try {
			const { LazyStore } = await import('@tauri-apps/plugin-store');
			tauriStore = new LazyStore('.settings.json');
			return tauriStore;
		} catch (e) {
			console.warn('Tauri Store plugin not found', e);
		}
	}
	return null;
}

/**
 * Parse du JSON persistant sans crasher le boot.
 * Si la valeur est invalide (SyntaxError), on logge en warning, supprime la clé
 * corrompue, et retourne `null`. L'applicative retombe sur ses valeurs par défaut.
 *
 * @param raw     La string brute lue depuis localStorage/sessionStorage
 * @param key     La clé (pour le log et la suppression)
 * @param store   Le Storage source (localStorage ou sessionStorage), pour nettoyer
 */
function safeJsonParse<T>(raw: string, key: string, store: Storage): T | null {
	try {
		return JSON.parse(raw) as T;
	} catch (err) {
		console.warn(`[storage] Corrupted JSON for key "${key}", removing.`, err);
		store.removeItem(key);
		return null;
	}
}

export const storage = {
	async getItem<T>(key: string, options: StorageOptions = {}): Promise<T | null> {
		if (!isBrowser) return null;

		const tStore = await getTauriStore();
		if (tStore) {
			return await tStore.get(key);
		}

		// Web : Si persist est spécifié, on force la source. Sinon cascade.
		if (options.persist === true) {
			const local = localStorage.getItem(key);
			return local ? safeJsonParse<T>(local, key, localStorage) : null;
		}
		if (options.persist === false) {
			const session = sessionStorage.getItem(key);
			return session ? safeJsonParse<T>(session, key, sessionStorage) : null;
		}

		// Cascade par défaut : si localStorage contient une valeur corrompue,
		// on la nettoie puis on retombe sur sessionStorage (au lieu de retourner
		// null et d'ignorer une valeur valide dans l'autre store).
		const local = localStorage.getItem(key);
		if (local) {
			const parsed = safeJsonParse<T>(local, key, localStorage);
			if (parsed !== null) return parsed;
		}
		const session = sessionStorage.getItem(key);
		if (session) return safeJsonParse<T>(session, key, sessionStorage);

		return null;
	},

	async setItem<T>(key: string, value: T, options: StorageOptions = {}): Promise<void> {
		if (!isBrowser) return;

		const tStore = await getTauriStore();
		if (tStore) {
			await tStore.set(key, value);
			await tStore.save();
			return;
		}

		// Web
		const data = JSON.stringify(value);
		if (options.persist) {
			localStorage.setItem(key, data);
			sessionStorage.removeItem(key);
		} else {
			sessionStorage.setItem(key, data);
			localStorage.removeItem(key);
		}
	},

	async removeItem(key: string): Promise<void> {
		if (!isBrowser) return;

		const tStore = await getTauriStore();
		if (tStore) {
			await tStore.delete(key);
			await tStore.save();
			return;
		}

		localStorage.removeItem(key);
		sessionStorage.removeItem(key);
	},

	async clear(): Promise<void> {
		if (!isBrowser) return;

		const tStore = await getTauriStore();
		if (tStore) {
			await tStore.clear();
			await tStore.save();
			return;
		}

		localStorage.clear();
		sessionStorage.clear();
	}
};
