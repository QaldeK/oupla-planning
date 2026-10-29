/**
 * Résolution d'un lien de planning collé vers la route interne de l'app.
 *
 * Formats acceptés : URL absolue (tout domaine — le token est le secret,
 * ADR-0001, le lien source n'a pas à pointer vers ce déploiement), chemin
 * relatif `/p/…` ou `/admin/…`, ou token nu (participant 32 hex, admin
 * 64 hex — longueurs disjointes posées par utils/tokens.ts).
 *
 * Retourne la route interne à passer à `goto()`, ou null si l'entrée n'est
 * pas reconnue (validation inline dans le modal, avant navigation).
 */

const HEX_32 = /^[0-9a-f]{32}$/i;
const HEX_64 = /^[0-9a-f]{64}$/i;

// Segment hexadécimal entier en tête de chemin, suivi d'un nouveau segment
// ou de la fin : écarte `/p/cafe-babe` et `/p/quelque-chose`.
const LINK_ROUTE = /^\/(p|admin)\/([0-9a-f]+)(?=\/|$)/i;

export function resolvePlanningLink(input: string): string | null {
	const value = input.trim();
	if (!value) return null;

	// URL absolue → chemin seul. Sans protocole (« oupla.net/p/… »), new URL
	// échoue : on retente en préfixant https:// — uniquement sans « / » initial,
	// car préfixer un chemin relatif (« https:///p/… ») ferait absorber le
	// segment p|admin par le host. Sinon chemin relatif ou token nu, gardés
	// tels quels pour le regex / les tests de longueur.
	let path = value;
	try {
		path = new URL(value).pathname;
	} catch {
		if (!value.startsWith("/")) {
			try {
				path = new URL(`https://${value}`).pathname;
			} catch {
				// ni URL, ni chemin : token nu éventuel
			}
		}
	}

	const link = LINK_ROUTE.exec(path);
	if (link) return `/${link[1]}/${link[2].toLowerCase()}`;

	if (HEX_64.test(value)) return `/admin/${value.toLowerCase()}`;
	if (HEX_32.test(value)) return `/p/${value.toLowerCase()}`;
	return null;
}
