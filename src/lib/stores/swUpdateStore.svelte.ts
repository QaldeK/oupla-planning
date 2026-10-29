import { on } from "svelte/events";

/**
 * Cycle de vie « maintenance » du service worker : détection d'une mise à jour
 * en attente, activation consentie en session, silencieuse au chargement frais.
 * L'installation de l'app vit dans installStore.
 */
class SwUpdateStore {
	// Déclenche le toast de MAJ du layout : l'utilisateur choisit le moment du
	// reload via applyUpdate(). Seules les découvertes EN SESSION passent ici ;
	// le waiting présent au boot est activé immédiatement, sans toast.
	hasUpdate = $state(false);

	// Un seul reload : `controllerchange` peut se répéter pendant la fenêtre
	// avant le déchargement — pas une boucle, le contrôleur est déjà établi au
	// reload suivant.
	#refreshing = false;

	// Consentement de reload local : un controllerchange peut venir d'un autre
	// onglet qui a activé la MAJ — il ne doit pas recharger CET onglet.
	#reloadRequested = false;

	// Throttle partagé des checks de MAJ SW proactifs (visibilitychange, BFCache,
	// polling 1h). Spec browser : max 1 `reg.update()` / minute.
	#lastUpdateCheckAt = 0;

	#initialized = false;

	async init() {
		if (typeof window === "undefined") return;
		// Garde de réentrance : init peut être appelé plusieurs fois
		if (this.#initialized) return;
		this.#initialized = true;

		this.#initServiceWorkerUpdateDetection();
	}

	/**
	 * Check de MAJ throttlé à 1/min (limite de spec browser), sur les signaux de
	 * retour d'activité — en SPA, le navigateur ne check le SW qu'aux navigations
	 * serveur, qui n'arrivent pas pendant la session.
	 *
	 * Jamais court-circuité par un `waiting` présent : un second déploiement doit
	 * remplacer l'attente courante, sinon le clic activerait une version
	 * intermédiaire. Échec transient avalé en `debug`. Le curseur est posé AVANT
	 * l'appel (contrainte de spec, pas d'UX) : un échec ne doit pas rouvrir la
	 * fenêtre de throttle.
	 */
	#triggerUpdateCheck(reg: ServiceWorkerRegistration) {
		if (Date.now() - this.#lastUpdateCheckAt < 60_000) return;
		this.#lastUpdateCheckAt = Date.now();
		reg.update().catch((e) => console.debug("SW update check failed:", e));
	}

	/**
	 * Branche la détection des mises à jour.
	 *
	 * `hasUpdate` (toast, activation consentie via `applyUpdate()`) est posé par
	 * une découverte EN SESSION : `installed` sur un SW contrôleur, ou
	 * `controllerchange` venu d'un autre onglet. Le waiting déjà présent au boot
	 * fait exception : document neuf, rien à perdre → activation immédiate et
	 * silencieuse via `#activateWaiting()`.
	 */
	#initServiceWorkerUpdateDetection() {
		if (!("serviceWorker" in navigator)) return;

		// Le premier `controllerchange` vient du claim du premier install (aucune
		// MAJ) : consommé silencieusement ; les suivants (vraies MAJ) rechargent.
		let firstClaimDone = !!navigator.serviceWorker.controller;

		on(navigator.serviceWorker, "controllerchange", () => {
			if (!firstClaimDone) {
				firstClaimDone = true;
				return; // premier install : pas de reload
			}
			// Un autre onglet a pu activer la MAJ : signaler la disponibilité
			// sans recharger cette page (consentement local uniquement).
			if (!this.#reloadRequested) {
				this.hasUpdate = true;
				return;
			}
			// Garde de réentrance d'event : le reload remet le contexte à zéro
			if (this.#refreshing) return;
			this.#refreshing = true;
			window.location.reload();
		});

		navigator.serviceWorker
			.getRegistration()
			.then((reg) => {
				if (!reg) return;

				// Waiting hérité d'une session précédente : document neuf, aucune
				// saisie à perdre, le consentement ne protège rien et un toast
				// serait imperceptible avant le reload — activation immédiate
				// et silencieuse. Sans contrôleur (coin premier install), un
				// waiting n'a pas de sens : il activera à la navigation suivante.
				if (reg.waiting && navigator.serviceWorker.controller) {
					this.#activateWaiting(reg.waiting);
				}

				// Nouveau SW détecté pendant la session.
				on(reg, "updatefound", () => {
					const installing = reg.installing;
					if (!installing) return;
					on(installing, "statechange", () => {
						// `navigator.serviceWorker.controller` null = premier install (pas de MAJ à signaler).
						if (installing.state === "installed" && navigator.serviceWorker.controller) {
							this.hasUpdate = true;
						}
					});
				});

				// Détection proactive : le navigateur ne check le SW QUE sur navigation
				// serveur. En SPA SvelteKit, ces navigations n'arrivent pas pendant la
				// session → il faut forcer `reg.update()` sur les signaux de retour
				// d'activité. Throttle partagé de 60s via `#triggerUpdateCheck` ;
				// pas de check au boot (redondant avec le check navigateur au load).
				on(document, "visibilitychange", () => {
					if (document.visibilityState !== "visible") return;
					this.#triggerUpdateCheck(reg);
				});

				on(window, "pageshow", (event: PageTransitionEvent) => {
					if (!event.persisted) return;
					this.#triggerUpdateCheck(reg);
				});

				// Safety net : session longue sans aucun retour d'activité (desktop,
				// onglet jamais quitté). 1h, dans la limite spec (max 1/min).
				setInterval(() => this.#triggerUpdateCheck(reg), 60 * 60 * 1000);
			})
			.catch((e) => console.warn("SW registration check failed:", e));
	}

	/**
	 * Pose le consentement de reload local PUIS envoie `SKIP_WAITING` — sans le
	 * drapeau, le `controllerchange` prendrait la branche « autre onglet ».
	 * Emprunté par le boot et par `applyUpdate()`.
	 */
	#activateWaiting(waiting: ServiceWorker) {
		this.#reloadRequested = true;
		waiting.postMessage({ type: "SKIP_WAITING" });
	}

	/**
	 * Active la mise à jour en attente (clic « Mettre à jour ») → reload via
	 * `controllerchange`. Si aucun `waiting` n'est plus disponible (race), le
	 * reload recharge simplement avec le SW actif courant.
	 */
	async applyUpdate(): Promise<void> {
		if (!("serviceWorker" in navigator)) return;
		const reg = await navigator.serviceWorker.getRegistration().catch((e) => {
			console.warn("SW registration check failed:", e);
			return undefined;
		});
		const waiting = reg?.waiting;
		if (waiting) {
			this.#activateWaiting(waiting);
		} else {
			window.location.reload();
		}
	}
}

export const swUpdateStore = new SwUpdateStore();
