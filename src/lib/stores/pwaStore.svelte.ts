import { on } from 'svelte/events';
import { pb } from '$lib/pocketbase/pb';
import { storage } from '$lib/utils/storage';

class PwaStore {
	isInstalled = $state(false);
	canInstall = $state(false);
	deferredPrompt: BeforeInstallPromptEvent | null = $state(null);
	// true sur mobile non-Chrome : on ne peut pas déclencher beforeinstallprompt,
	// mais on veut orienter l'utilisateur vers le menu natif du browser
	readonly showNativeHint = $derived(!this.isInstalled && !this.canInstall);
	hasSeenWelcome = $state(false);
	#initialized = false;

	constructor() {
		// beforeinstallprompt peut se déclencher avant onMount → écoute immédiate
		if (typeof window !== 'undefined') {
			on(window, 'beforeinstallprompt', (e) => {
				e.preventDefault();
				this.canInstall = true;
				this.deferredPrompt = e as BeforeInstallPromptEvent;
			});
		}
	}

	async init() {
		if (typeof window === 'undefined') return;
		if (this.#initialized) return;
		this.#initialized = true;

		// 1. Détection client (display-mode, navigator.standalone)
		this.isInstalled =
			window.matchMedia('(display-mode: standalone)').matches ||
			(window.navigator as any).standalone === true;

		// 2. appinstalled (analytics one-shot)
		on(window, 'appinstalled', () => {
			this.isInstalled = true;
			this.canInstall = false;
			this.deferredPrompt = null;
			this.#recordInstallationToPB();
		});

		// 3. Changements display-mode
		on(window.matchMedia('(display-mode: standalone)'), 'change', (e) => {
			this.isInstalled = e.matches;
		});

		// 4. Charger le flag de bienvenue
		this.hasSeenWelcome = (await storage.getItem<boolean>('pwa_welcome_seen')) ?? false;
	}

	markWelcomeSeen() {
		this.hasSeenWelcome = true;
		storage.setItem('pwa_welcome_seen', true, { persist: true });
	}

	async install(): Promise<'accepted' | 'dismissed' | null> {
		if (!this.deferredPrompt) return null;
		this.deferredPrompt.prompt();
		const { outcome } = await this.deferredPrompt.userChoice;
		if (outcome === 'accepted') {
			this.canInstall = false;
			this.deferredPrompt = null;
		}
		return outcome;
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
