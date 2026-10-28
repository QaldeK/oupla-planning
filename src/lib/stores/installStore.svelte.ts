import { on } from "svelte/events";
import { pb } from "$lib/pocketbase/pb";

/**
 * Cycle de vie « adoption » : détection de l'installation, prompt natif différé,
 * détection terminal (getInstalledRelatedApps). La conversion post-installation
 * vit dans le mur d'authentification du layout racine.
 * La mise à jour du service worker vit dans swUpdateStore.
 */
class InstallStore {
	isInstalled = $state(false);
	deferredPrompt: BeforeInstallPromptEvent | null = $state(null);
	// Prompt natif disponible ⇔ un prompt différé est capté : un seul état de
	// vérité, pas de synchro manuelle entre les deux.
	readonly canInstall = $derived(this.deferredPrompt !== null);
	// true quand rien ne permet d'installer via le navigateur (ni installé, ni
	// promptable) : les surfaces orientent alors vers les instructions manuelles.
	// Le scope mobile est décidé par la surface appelante (mediaQuery).
	readonly needsManualInstructions = $derived(!this.isInstalled && !this.canInstall);

	// Détection d'installation sur le terminal (getInstalledRelatedApps — Chromium
	// Android 84+, desktop 140+ ; manifest auto-déclaré via related_applications).
	// Masque l'invite dans l'onglet d'un navigateur quand l'app est déjà installée
	// sur l'appareil — cas du browser installateur qui reprompt malgré tout (vérifié
	// sur Brave). Le check est une requête locale rapide ; `installCheckPending`
	// l'attend avant tout affichage (pas de flash d'invite). API absente (iOS,
	// Firefox) ou échec transient : check simplement terminé, détection display-mode.
	installedOnDevice = $state(false);
	installCheckPending = $state(true);

	/** Gate commun aux surfaces d'invite : check fait, app absente du terminal. */
	readonly promptGateClear = $derived(
		!this.installCheckPending && !this.isInstalled && !this.installedOnDevice,
	);

	#initialized = false;
	constructor() {
		if (typeof window !== "undefined") {
			// Détection client (display-mode, navigator.standalone) posée ici et
			// non dans init() : le mur d'authentification dépend de isInstalled,
			// et init() n'arrive qu'après des await au boot (état guest, userStore).
			// Calculée plus tard, l'app installée s'afficherait un instant avant
			// le mur — c'est exactement ce que le mur doit empêcher.
			this.isInstalled =
				window.matchMedia("(display-mode: standalone)").matches ||
				window.navigator.standalone === true;

			// beforeinstallprompt peut se déclencher avant onMount → écoute immédiate
			on(window, "beforeinstallprompt", (e) => {
				e.preventDefault();
				this.deferredPrompt = e as BeforeInstallPromptEvent;
			});
		}
	}

	async init() {
		if (typeof window === "undefined") return;
		// Garde de réentrance : init peut être appelé plusieurs fois
		if (this.#initialized) return;
		this.#initialized = true;

		// 1. Détection terminal : app déjà installée sur l'appareil → gate.
		void this.#detectInstalledOnDevice();

		// 2. appinstalled (analytics one-shot)
		on(window, "appinstalled", () => {
			this.isInstalled = true;
			this.deferredPrompt = null;
			void this.#recordInstallationToPB();
		});

		// 3. Changements display-mode
		on(window.matchMedia("(display-mode: standalone)"), "change", (e) => {
			this.isInstalled = e.matches;
		});
	}

	async install(): Promise<"accepted" | "dismissed" | null> {
		// Le prompt natif est à usage unique : l'événement est consommé dès
		// l'appel, qu'il soit accepté ou refusé. Le conserver rendrait
		// `canInstall` vrai et le bouton rappellerait prompt() sur un événement
		// mort (InvalidStateError).
		const prompt = this.deferredPrompt;
		if (!prompt) return null;
		this.deferredPrompt = null;

		try {
			prompt.prompt();
			const { outcome } = await prompt.userChoice;
			// `appinstalled` peut tarder ou ne jamais venir (navigateur qui ne
			// l'émet pas) : l'acceptation suffit à retirer les invites.
			if (outcome === "accepted") this.isInstalled = true;
			return outcome;
		} catch (e) {
			console.debug("install prompt failed:", e);
			return null;
		}
	}

	/**
	 * Interroge le terminal via getInstalledRelatedApps (manifest auto-déclaré).
	 * Absence d'API (iOS, Firefox) ou échec transient : check simplement terminé.
	 */
	async #detectInstalledOnDevice() {
		const getRelatedApps =
			typeof navigator !== "undefined"
				? navigator.getInstalledRelatedApps?.bind(navigator)
				: undefined;
		if (!getRelatedApps) {
			this.installCheckPending = false;
			return;
		}
		try {
			const apps = await getRelatedApps();
			this.installedOnDevice = apps.some((app) => app.platform === "webapp");
		} catch (e) {
			console.debug("getInstalledRelatedApps failed:", e);
		} finally {
			this.installCheckPending = false;
		}
	}

	async #recordInstallationToPB() {
		const record = pb.authStore.record;
		if (!record) return;
		try {
			await pb.collection("users").update(record.id, {
				pwa_installed: true,
			});
		} catch (e) {
			console.error("Failed to record PWA installation:", e);
		}
	}
}

export const installStore = new InstallStore();
