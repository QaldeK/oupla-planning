import { pb } from '$lib/pocketbase/pb';
import { storage } from '$lib/utils/storage';
import { on } from 'svelte/events';

class PwaStore {
	isInstalled = $state(false);
	canInstall = $state(false);
	deferredPrompt: BeforeInstallPromptEvent | null = $state(null);
	// true sur mobile non-Chrome : on ne peut pas déclencher beforeinstallprompt,
	// mais on veut orienter l'utilisateur vers le menu natif du browser
	readonly showNativeHint = $derived(!this.isInstalled && !this.canInstall);
	hasSeenWelcome = $state(false);

	// Détection de mise à jour du Service Worker.
	// Vrai quand un nouveau SW est installé et en attente d'activation (waiting).
	// Le passage à true déclenche le toast de MAJ côté layout ; l'utilisateur
	// choisit le moment du reload via applyUpdate().
	hasUpdate = $state(false);

	// Évite un double reload() intra-session : `controllerchange` peut se
	// déclencher plusieurs fois pendant la fenêtre (~100-500 ms) avant que la
	// page ne soit déchargée par le reload. Pas de risque de boucle de reloads
	// — au reload suivant, le contrôleur est déjà établi, l'événement ne se
	// redéclenche pas.
	#refreshing = false;

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
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- standalone est une propriété Safari non-standard
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

		// 5. Détection des mises à jour du Service Worker
		this.#initServiceWorkerUpdateDetection();
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

	/**
	 * Branche la détection des mises à jour du Service Worker.
	 *
	 * Trois signaux convergent vers `hasUpdate = true` :
	 *  - un SW déjà en `waiting` au boot (MAJ en attente d'une session précédente) ;
	 *  - un nouveau SW passant à l'état `installed` pendant la session, à condition
	 *    qu'un contrôleur existe déjà (sinon c'est le premier install, silencieux) ;
	 *  - un SW en attente apparu sur un `updatefound` tardif.
	 *
	 * L'activation effective est différée à `applyUpdate()` (action utilisateur) :
	 * on envoie `SKIP_WAITING` au SW en attente, puis le listener `controllerchange`
	 * déclenche le reload.
	 */
	#initServiceWorkerUpdateDetection() {
		if (!('serviceWorker' in navigator)) return;

		// État du contrôleur au boot : null au premier install, non-null dès qu'un SW
		// contrôle déjà la page. `clients.claim()` dans l'`activate` du premier SW
		// déclenche `controllerchange` sans qu'aucune MAJ n'ait été appliquée →
		// il faut ignorer ce signal pour ne pas recharger au premier chargement.
		const hadController = !!navigator.serviceWorker.controller;

		on(navigator.serviceWorker, 'controllerchange', () => {
			if (!hadController) return; // premier install : pas de reload
			if (this.#refreshing) return;
			this.#refreshing = true;
			window.location.reload();
		});

		navigator.serviceWorker
			.getRegistration()
			.then((reg) => {
				if (!reg) return;

				// MAJ en attente dès le boot (session précédente non activée).
				if (reg.waiting) this.hasUpdate = true;

				// Nouveau SW détecté pendant la session.
				on(reg, 'updatefound', () => {
					const installing = reg.installing;
					if (!installing) return;
					on(installing, 'statechange', () => {
						// `navigator.serviceWorker.controller` null = premier install (pas de MAJ à signaler).
						if (installing.state === 'installed' && navigator.serviceWorker.controller) {
							this.hasUpdate = true;
						}
					});
				});
			})
			.catch((e) => console.warn('SW registration check failed:', e));
	}

	/**
	 * Active la mise à jour en attente (déclenchée par le toast « Mettre à jour »).
	 *
	 * Envoie `SKIP_WAITING` au SW en attente → le SW s'active → `controllerchange`
	 * → reload (via le listener posé dans `#initServiceWorkerUpdateDetection`).
	 *
	 * Si `reg.waiting` est null au moment du clic, `hasUpdate` est devenu incohérent
	 * (race ou désenregistrement entre-temps) : le reload recharge simplement la
	 * page avec le SW actif courant (ne casse rien, mais ne fait rien de spécial).
	 */
	async applyUpdate(): Promise<void> {
		if (!('serviceWorker' in navigator)) return;
		const reg = await navigator.serviceWorker.getRegistration().catch((e) => {
			console.warn('SW registration check failed:', e);
			return undefined;
		});
		const waiting = reg?.waiting;
		if (waiting) {
			waiting.postMessage({ type: 'SKIP_WAITING' });
		} else {
			// État incohérent : hasUpdate était true mais aucun waiting n'est disponible.
			// Le reload recharge avec le SW actif courant.
			window.location.reload();
		}
	}
}

export const pwaStore = new PwaStore();
