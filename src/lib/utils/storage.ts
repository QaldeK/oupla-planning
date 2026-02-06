/**
 * Abstraction du stockage pour gérer le Web (LocalStorage/SessionStorage)
 * et utiliser le plugin Store de Tauri v2.
 */

export interface StorageOptions {
	persist?: boolean;
}

export const isBrowser = typeof window !== 'undefined';
export const isTauri = isBrowser && !!(window as any).__TAURI__;

// Pour Tauri v2, on utilise LazyStore
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
			return local ? JSON.parse(local) : null;
		}
		if (options.persist === false) {
			const session = sessionStorage.getItem(key);
			return session ? JSON.parse(session) : null;
		}

		// Cascade par défaut
		const local = localStorage.getItem(key);
		if (local) return JSON.parse(local);
		const session = sessionStorage.getItem(key);
		if (session) return JSON.parse(session);

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
