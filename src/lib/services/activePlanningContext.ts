/**
 * Planning actif : le token de la page visitée, posé par le layout à côté de
 * l'activation du planningStore — cf. glossaire « Planning actif ».
 *
 * Il atteste la navigation, pas la capacité d'écriture : un appareil qui détient
 * l'adminToken d'un planning affiche les affordances admin même derrière un lien
 * participant. Les écritures passent donc par `resolveWriteToken()`
 * (`services/planningMutations.ts`), qui retient l'adminToken du planning
 * visité dès que l'appareil le détient, sinon cette valeur.
 *
 * État module simple, pas de runes : les mutations lisent au moment de l'action,
 * rien n'en dépend réactivement (le store reste le point réactif pour l'UI).
 */

let activeToken: string | undefined;

export function setActivePlanningToken(token: string | undefined): void {
	activeToken = token;
}

/** Lève si aucun planning actif (cas /new) — les créations choisissent leurs propres tokens. */
export function getActivePlanningToken(): string {
	if (!activeToken) {
		throw new Error("Aucun planning actif — action impossible hors d'une page de planning");
	}
	return activeToken;
}
