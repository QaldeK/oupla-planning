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

		// 1. Détection client uniquement (display-mode, navigator.standalone)
		this.isInstalled =
			window.matchMedia('(display-mode: standalone)').matches ||
			(window.navigator as any).standalone === true;

		// 2. Écouter beforeinstallprompt
		on(window, 'beforeinstallprompt', (e) => {
			e.preventDefault();
			this.canInstall = true;
			this.deferredPrompt = e;
		});

		// 3. Écouter appinstalled (analytics one-shot)
		on(window, 'appinstalled', () => {
			this.isInstalled = true;
			this.canInstall = false;
			this.deferredPrompt = null;
			this.#recordInstallationToPB(); // Analytics : enregistrer l'installation
		});

		// 4. Écouter changements display-mode
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

	async #recordInstallationToPB() {
		if (!pb.authStore.isValid) return;
		try {
			await pb.collection('users').update(pb.authStore.record!.id, {
				pwa_installed: true
			});
		} catch (e) {
			console.error('Failed to record PWA installation:', e);
		}
	}
}

export const pwaStore = new PwaStore();
