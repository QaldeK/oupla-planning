/**
 * Routine de récupération autonome en cas de crash au boot.
 *
 * Ce module ne dépend d'aucun store applicatif — il est utilisable même quand
 * l'initialisation a échoué (le `+error.svelte` et l'`error.html` s'en servent
 * pour offrir un bouton "Effacer les données locales" sans supposer que les
 * stores sont montés).
 *
 * Efface, dans l'ordre :
 *   1. Les caches HTTP du Service Worker (`caches` API)
 *   2. Les registrations de Service Workers
 *   3. La base IndexedDB `appDB` (drop direct, sans passer par Dexie — la DB
 *      peut être verrouillée par une UpgradeError et Dexie refuserait l'accès)
 *   4. localStorage et sessionStorage
 *
 * Puis recharge la page (hard reload) pour redémarrer un boot propre.
 *
 * Trade-off : cette routine est destructrice pour les données locales
 * (identités guest, préférences, cache offline). Elle est volontairement
 * agressive : en cas de crash inconnu, mieux vaut repartir d'un état vierge
 * que de deviner quelle clé est corrompue. Les données métier restent
 * côté serveur (PocketBase) — seules les caches et préférences locales sont
 * perdues. Voir ADR 0006 (boot-error-recovery).
 *
 * Note : `error.html` reproduit une version inline de cette séquence (script
 * navigateur pur, sans accès aux modules) pour gérer le cas où l'applicatif
 * ne se charge pas du tout. Si tu modifies la séquence ici, pense à mettre à
 * jour `error.html` en parallèle.
 */
import { APP_DB_NAME } from '$lib/pb-sync/db';

async function clearHttpCaches(): Promise<void> {
	if (typeof caches === 'undefined') return;
	try {
		const keys = await caches.keys();
		await Promise.all(keys.map((k) => caches.delete(k)));
	} catch (err) {
		console.warn('[recover] Failed to clear caches:', err);
	}
}

async function unregisterServiceWorkers(): Promise<void> {
	if (!('serviceWorker' in navigator)) return;
	try {
		const regs = await navigator.serviceWorker.getRegistrations();
		await Promise.all(regs.map((r) => r.unregister()));
	} catch (err) {
		console.warn('[recover] Failed to unregister service workers:', err);
	}
}

async function dropIndexedDB(): Promise<void> {
	if (typeof indexedDB === 'undefined') return;
	await new Promise<void>((resolve) => {
		const req = indexedDB.deleteDatabase(APP_DB_NAME);
		// On résout dans tous les cas : une DB déjà supprimée ou bloquée
		// ne doit pas empêcher le reload final.
		req.onsuccess = () => resolve();
		req.onerror = () => {
			console.warn('[recover] indexedDB.deleteDatabase error:', req.error);
			resolve();
		};
		req.onblocked = () => {
			console.warn('[recover] indexedDB.deleteDatabase blocked — proceeding anyway.');
			resolve();
		};
	});
}

function clearWebStorage(): void {
	try {
		localStorage.clear();
	} catch (err) {
		console.warn('[recover] Failed to clear localStorage:', err);
	}
	try {
		sessionStorage.clear();
	} catch (err) {
		console.warn('[recover] Failed to clear sessionStorage:', err);
	}
}

/**
 * Efface toutes les données persistantes côté client, puis recharge la page.
 *
 * À appeler depuis :
 *   - `+error.svelte` via un bouton interactif
 *   - `error.html` indirectement : ce template étant statique, il ne peut
 *     appeler cette fonction directement. Il redirige vers `/?recover=1`
 *     que `+layout.svelte` intercepte au boot suivant pour déclencher la routine.
 *
 * @param target URL à charger après reload. Par défaut la racine, pour
 *               éviter de retomber sur une route profonde potentiellement cassée.
 */
export async function recoverAllData(target = '/'): Promise<void> {
	await clearHttpCaches();
	await unregisterServiceWorkers();
	await dropIndexedDB();
	clearWebStorage();
	window.location.replace(target);
}
