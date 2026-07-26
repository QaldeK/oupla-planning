/**
 * lockService — verrouillage d'édition admin (R5.3).
 *
 * Le lock est purement UX : il signale l'édition concurrente entre admins
 * partageant une URL admin, sans restreindre l'écriture côté serveur
 * (`_version` / merge serveur restent les garde-fous data).
 *
 * Deux familles d'appels :
 * - Routes custom `/api/lock` et `/api/unlock` (acquire/heartbeat/release),
 *   via `pb.send`. Le serveur y calcule `expiresAt` (lockedAt + TTL).
 * - Lecture directe de `planning_locks` via `getFirstListItem` (polling
 *   pendant l'overlay read-only). `expiresAt` n'est pas stocké sur la row,
 *   il est reconstitué côté client à partir de `lockedAt` + `LOCK_TTL_MS`.
 *
 * NB : `lockedBy` est un identifiant client (userId PB pour les auth, id
 * local Dexie pour les guests) fourni par l'appelant — ce service ne lit
 * jamais directement `pb.authStore`.
 */
import { ClientResponseError } from "pocketbase";
import { pb } from "$lib/pocketbase/pb";

/**
 * TTL du lock. Doit matcher `LOCK_TTL_MS` côté serveur
 * (`pocketbase/pb_hooks/lock-utils.js`). Duplication acceptée : ce module n'a
 * pas accès à la constante serveur, et le TTL est une décision produit figée.
 */
const LOCK_TTL_MS = 5 * 60 * 1000;

export interface LockInfo {
	lockedBy: string;
	lockedByName: string;
	lockedAt: string; // ISO string
	expiresAt: string; // ISO string
}

/**
 * Levée quand un autre admin détient un lock frais sur le planning.
 * `info` décrit le détenteur courant (pour l'overlay read-only).
 */
export class LockHeldError extends Error {
	readonly info: LockInfo;

	constructor(info: LockInfo) {
		super("Lock held by another admin");
		this.name = "LockHeldError";
		this.info = info;
	}
}

/**
 * POST `/api/lock/{masterId}` : acquire ou heartbeat (le serveur discrimine
 * sur `lockedBy` — même détenteur = heartbeat, autre = 409 si lock frais).
 *
 * @param masterId      ID du planning à verrouiller.
 * @param adminToken    Token admin (query `_token`) — authentifie l'appel.
 * @param userId        Identifiant client du détenteur (mis dans `lockedBy`).
 * @param lockedByName  Nom affichable optionnel (informatif pour les autres admins).
 * @returns Le lock posé (détenteur, dates).
 * @throws {LockHeldError} 409 — un autre admin détient un lock frais.
 * @throws {ClientResponseError} 400 (lockedBy manquant), 401/403 (token), réseau.
 */
export async function acquireLock(
	masterId: string,
	adminToken: string,
	userId: string,
	lockedByName?: string
): Promise<LockInfo> {
	return postLock(masterId, adminToken, userId, lockedByName);
}

/**
 * Heartbeat du lock : même endpoint que `acquireLock`, le serveur interprète
 * l'appel d'un détenteur existant comme un rafraîchissement de `lockedAt`.
 *
 * Signature identique à `acquireLock` pour permettre leur usage interchangeables
 * dans le lifecycle UI (mount vs interval).
 */
export async function heartbeatLock(
	masterId: string,
	adminToken: string,
	userId: string,
	lockedByName?: string
): Promise<LockInfo> {
	return postLock(masterId, adminToken, userId, lockedByName);
}

/**
 * Implémentation partagée acquire/heartbeat.
 * Convertit le 409 serveur en `LockHeldError`, propage les autres erreurs.
 */
async function postLock(
	masterId: string,
	adminToken: string,
	userId: string,
	lockedByName?: string
): Promise<LockInfo> {
	try {
		return await pb.send(`/api/lock/${masterId}`, {
			method: "POST",
			body: { lockedBy: userId, lockedByName },
			query: { _token: adminToken }
		});
	} catch (err: unknown) {
		if (err instanceof ClientResponseError && err.status === 409 && err.response) {
			throw new LockHeldError({
				lockedBy: err.response.lockedBy,
				lockedByName: err.response.lockedByName ?? "",
				lockedAt: err.response.lockedAt,
				expiresAt: err.response.expiresAt
			});
		}
		throw err;
	}
}

/**
 * POST `/api/unlock/{masterId}` : libère le lock (clear `lockedBy`, la row reste).
 *
 * Best-effort : le release ne doit jamais casser le flux utilisateur (ex.
 * navigation après save). Les erreurs sont loggées mais non jetées. L'idempotence
 * est garantie serveur (200 même si pas de row ou row déjà vide).
 *
 * Note : cette fonction utilise `pb.send` (pas `keepalive`). Pour la libération
 * au `pagehide`/`beforeunload`, l'UI doit utiliser `navigator.sendBeacon` ou
 * `fetch(url, { keepalive: true })` directement — `pb.send` ne survit pas à la
 * fermeture de l'onglet.
 */
export async function releaseLock(
	masterId: string,
	adminToken: string,
	userId: string
): Promise<void> {
	try {
		await pb.send(`/api/unlock/${masterId}`, {
			method: "POST",
			body: { lockedBy: userId },
			query: { _token: adminToken }
		});
	} catch (err) {
		console.error("[lockService] releaseLock failed:", err);
	}
}

/**
 * Lecture directe du lock courant sur `planning_locks` (polling pendant l'overlay
 * read-only). Contrairement aux routes custom, aucune mutation — juste l'état.
 *
 * @returns Le lock actif, ou `null` si aucune row / row "vide" (`lockedBy` absent).
 *          `expiresAt` est calculé côté client (`lockedAt + LOCK_TTL_MS`) car non
 *          stocké sur la collection.
 * @throws {ClientResponseError} réseau, 401/403 (token). Le 404 (pas de row) est
 *         avalé et renvoie `null`.
 */
export async function getLock(masterId: string, adminToken: string): Promise<LockInfo | null> {
	// Les IDs PocketBase sont alphanumériques (15 char). On valide avant de les
	// interpoler dans le filtre : le SDK JS n'expose pas de placeholders paramétrés
	// (contrairement aux hooks JSVM `findRecordsByFilter('{:param}')`), et un ID
	// malformé ne devrait de toute façon jamais arriver jusqu'ici.
	if (!/^[a-zA-Z0-9]+$/.test(masterId)) {
		throw new Error("Invalid masterId");
	}

	let record: { lockedBy?: string; lockedByName?: string; lockedAt?: string };
	try {
		record = await pb.collection("planning_locks").getFirstListItem(`master = "${masterId}"`, {
			query: { _token: adminToken }
		});
	} catch (err: unknown) {
		if (err instanceof ClientResponseError && err.status === 404) return null;
		throw err;
	}

	// Row permanente mais unlocked (lockedBy vidé par un release précédent).
	if (!record.lockedBy) return null;

	const lockedAtMs = new Date(record.lockedAt ?? Date.now()).getTime();
	return {
		lockedBy: record.lockedBy,
		lockedByName: record.lockedByName ?? "",
		lockedAt: record.lockedAt ?? new Date().toISOString(),
		expiresAt: new Date(lockedAtMs + LOCK_TTL_MS).toISOString()
	};
}
