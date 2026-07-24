import Dexie, { type Table } from 'dexie';
import type {
	PlanningMaster,
	PlanningOccurrence,
	SavedPlanning,
	CommentState
} from '$lib/types/planning.types';

/**
 * Nom de la base IndexedDB. Single source of truth — repris par :
 *   - `AppDB` constructor (ci-dessous)
 *   - `recover.ts` pour le drop direct (sans passer par Dexie)
 *   - `error.html` script inline (en string littérale — template statique,
 *     pas d'import possible ; un commentaire y pointe vers cette constante).
 */
export const APP_DB_NAME = 'appDB';

export class AppDB extends Dexie {
	masters!: Table<PlanningMaster>;
	occurrences!: Table<PlanningOccurrence>;
	deletions!: Table<{ id: string; collection: string; recordId: string; deletedAt: string }>;
	localMeta!: Table<SavedPlanning, string>;
	commentState!: Table<CommentState>;

	constructor() {
		super(APP_DB_NAME);
		this.version(1).stores({
			masters: 'id, updated, participantToken, adminToken, deleted',
			occurrences: 'id, updated, master, deleted',
			deletions: 'id, collection, deletedAt, recordId'
		});
		this.version(2).stores({
			masters: 'id, updated, participantToken, adminToken, deleted',
			occurrences: 'id, updated, master, date, deleted',
			deletions: 'id, collection, deletedAt, recordId'
		});
		this.version(3).stores({
			masters: 'id, updated, participantToken, adminToken, deleted',
			occurrences: 'id, updated, master, date, deleted',
			deletions: 'id, collection, deletedAt, recordId',
			localMeta: 'masterId'
		});
		this.version(4).stores({
			commentState: 'occurrenceId, masterId, isUserInConversation, lastReadAt'
		});
		this.version(5).upgrade((tx) => {
			return tx
				.table('localMeta')
				.toCollection()
				.modify((record) => {
					delete record.title;
					delete record.adminToken;
					delete record.participantToken;
					delete record.lastAccessed;
					delete record.deletedAt;
				});
		});
	}
}

// Strip Svelte 5 $state Proxy objects before Dexie writes.
// IndexedDB uses structuredClone internally, which cannot handle Proxy objects.
function applyProxyStripper(db: AppDB) {
	db.use({
		stack: 'dbcore',
		name: 'stripSvelteProxies',
		create(downlevelDatabase) {
			return {
				...downlevelDatabase,
				table(tableName) {
					const table = downlevelDatabase.table(tableName);
					return {
						...table,
						mutate(req) {
							if (req.type === 'put' || req.type === 'add') {
								req = {
									...req,
									values: req.values.map((v: unknown) =>
										JSON.parse(JSON.stringify(v as Record<string, unknown>))
									)
								};
							}
							return table.mutate(req);
						}
					};
				}
			};
		}
	});
}

/**
 * Instance singleton de la base locale. N'est PAS ouverte à la construction :
 * Dexie auto-open à la première opération, mais on préfère un open défensif
 * explicite via {@link ensureDbReady} au boot client (voir ADR 0006).
 *
 * En SSR (prerender build), on n'appelle jamais `ensureDbReady()` → la DB
 * reste non-ouverte, ce qui est correct car les composants n'y accèdent pas
 * au render.
 */
export const db = new AppDB();
applyProxyStripper(db);

let readyPromise: Promise<void> | null = null;

/**
 * Ouvre la base IndexedDB avec un reset défensif sur erreur de migration.
 * Mémoïsé : plusieurs calls partagent le même `readyPromise`.
 * À appeler au boot client AVANT la première opération DB.
 * Voir ADR 0006 et la doc de {@link openAppDB} pour la stratégie détaillée.
 */
export function ensureDbReady(): Promise<void> {
	if (readyPromise) return readyPromise;
	readyPromise = openAppDB().then(() => undefined);
	return readyPromise;
}

/**
 * Ouvre la base IndexedDB avec un reset défensif sur erreur de migration.
 *
 * Cas couvert : un utilisateur avec une DB locale issue d'une version précédente
 * dont les données rendent l'`upgrade()` instable (UpgradeError Dexie). Sans cette
 * garde, toute opération ultérieure (`db.localMeta.toArray()` au boot notamment)
 * propage l'erreur → SvelteKit rend une page 500 sans recours user-facing.
 *
 * Stratégie : si `open()` échoue, on drop la DB (perte des données offline
 * acceptable — ce ne sont que des caches de PocketBase, source de vérité serveur),
 * puis on tente un reopen. Si le second essai échoue aussi, on propage : la
 * situation est catastrophique (IndexedDB corrompu au-delà du schéma applicatif)
 * et le error.html prend le relais.
 *
 * Exporté pour les tests unitaires. Le code applicatif doit passer par
 * {@link ensureDbReady} (idempotent via readyPromise mémoïsé). Voir ADR 0006.
 */
export async function openAppDB(): Promise<AppDB> {
	// SSR (Node, prerender build) : pas d'IndexedDB. On ne fait rien — en SSR
	// les composants n'accèdent jamais à la DB (pas de localStorage, pas d'authStore).
	if (typeof indexedDB === 'undefined') return db;

	try {
		await db.open();
		return db;
	} catch (err) {
		console.error('[Dexie] Open failed, attempting full reset:', err);
		try {
			await db.delete();
		} catch (deleteErr) {
			console.error('[Dexie] Reset (delete) also failed:', deleteErr);
		}
		await db.open();
		console.warn('[Dexie] Database reset successful — local cache rebuilt from scratch.');
		return db;
	}
}

/**
 * Upsert partiel dans localMeta : met à jour les champs du patch si le record
 * existe, sinon crée un nouvel enregistrement avec le patch.
 * Coexistence : chaque module (guestStateStore, planningStore) ne touche que
 * ses champs via ce helper, sans écraser ceux des autres.
 */
export async function upsertLocalMeta(
	masterId: string,
	patch: Partial<SavedPlanning>
): Promise<void> {
	const existing = await db.localMeta.get(masterId);
	if (existing) {
		await db.localMeta.update(masterId, patch);
	} else {
		await db.localMeta.put({ masterId, ...patch } as SavedPlanning);
	}
}
