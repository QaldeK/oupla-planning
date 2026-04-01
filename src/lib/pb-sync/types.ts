import type { Table } from 'dexie';

export type WithMeta = { id: string; updated: string };

/**
 * Options communes à toutes les opérations PocketBase (fetch, create, update, delete, view).
 */
export interface PbQueryOptions {
	/**
	 * Filtre PocketBase. Deux formes possibles :
	 * - string brute : `'active = true'` (aucun échappement — à éviter avec des valeurs dynamiques)
	 * - tuple paramétré : `['master = {:id}', { id: masterId }]` (recommandé, sécurisé via pb.filter)
	 */
	filter?: string | [template: string, vars: Record<string, unknown>];
	/** Relations à expand (ex: `'master,owner'`) */
	expand?: string;
	/** Champs à inclure dans la réponse (ex: `'id,title,updated'`) */
	fields?: string;
	/** Paramètres HTTP bruts ajoutés à la query string (ex: `{ _token: '...' }`). Escape hatch — préférer l'auth PocketBase quand possible. */
	query?: Record<string, string>;
}

/**
 * Options pour `subscribe()` — étend PbQueryOptions avec le topic realtime.
 */
export interface PbSubscribeOptions extends PbQueryOptions {
	/**
	 * Topic realtime : un recordId spécifique, ou absent pour souscrire à toute la collection (`'*'`).
	 */
	record?: string;
}

/**
 * Options pour `list()` — étend PbQueryOptions avec pagination et tri.
 */
export interface PbListOptions extends PbQueryOptions {
	sort?: string;
	page?: number;
	perPage?: number;
}

export type MergeStrategy<T> = (local: T, remote: T) => T;

export interface SubscriptionRef {
	readonly id: string;
	readonly collection: string;
	readonly filter?: string;
}

export interface BatchOp<T extends WithMeta = WithMeta> {
	type: 'create' | 'update' | 'delete' | 'tombstone';
	table: Table<T>;
	collection: string;
	id?: string;
	data?: Partial<T>;
	params?: PbQueryOptions;
}

export interface SyncCollectionOptions<T extends WithMeta = WithMeta> {
	mergeStrategies?: {
		[K in keyof T]?: (local: NonNullable<T[K]>, remote: NonNullable<T[K]>) => NonNullable<T[K]>;
	};
	softDelete?: boolean;
	tombstoneCollection?: string;
	localTrash?: boolean;
	onSubscriptionChange?: (active: boolean) => void;
}
