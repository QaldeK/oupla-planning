import { on } from 'svelte/events';
import { pb } from '$lib/pocketbase/pb';

class PwaStore {
	isInstalled = $state(false);
	canInstall = $state(false);
	deferredPrompt = $state<any>(null);
	#initialized = false;

	async init() {
		if (typeof window === 'undefined') return;
		if (this.#initialized) return;
		this.#initialized = true;

		// 1. Détection client (display-mode, navigator.standalone)
		this.isInstalled =
			window.matchMedia('(display-mode: standalone)').matches ||
			(window.navigator as any).standalone === true;

		// 2. Vérifier PocketBase si authentifié
		if (pb.authStore.isValid) {
			try {
				const user = await pb.collection('users').getOne(pb.authStore.record!.id, {
					requestKey: null
				});
				this.isInstalled = this.isInstalled || (user.pwa_installed ?? false);
			} catch {
				// Ignore errors (user might not exist or field missing)
			}
		}

		// 3. Écouter les changements d'authentification pour sync automatique
		pb.authStore.onChange(() => {
			if (pb.authStore.isValid) {
				this.#syncToPocketBase();
			}
		});

		// 4. Écouter beforeinstallprompt
		on(window, 'beforeinstallprompt', (e) => {
			e.preventDefault();
			this.canInstall = true;
			this.deferredPrompt = e;
		});

		// 5. Écouter appinstalled
		on(window, 'appinstalled', () => {
			this.isInstalled = true;
			this.canInstall = false;
			this.deferredPrompt = null;
			this.#syncToPocketBase();
		});

		// 6. Écouter changements display-mode
		on(window.matchMedia('(display-mode: standalone)'), 'change', (e) => {
			this.isInstalled = e.matches;
		});
	}

	async install() {
		if (!this.deferredPrompt) return;
		this.deferredPrompt.prompt();
		const { outcome } = await this.deferredPrompt.userChoice;
		if (outcome === 'accepted') {
			this.canInstall = false;
			this.deferredPrompt = null;
		}
	}

	async #syncToPocketBase() {
		if (!pb.authStore.isValid) return;
		try {
			await pb.collection('users').update(pb.authStore.record!.id, {
				pwa_installed: true
			});
		} catch (e) {
			console.error('PWA sync error:', e);
		}
	}
}

export const pwaStore = new PwaStore();
