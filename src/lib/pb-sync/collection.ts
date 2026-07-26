/**
 * pb-sync — Sync Collection
 *
 * Provides `createSyncCollection()`, the core bridge between PocketBase and Dexie (IndexedDB).
 *
 * Responsibilities:
 * - **Initial fetch**: incremental sync from last known `updated` timestamp, with optional
 *   tombstone-based deletion reconciliation.
 * - **Realtime subscriptions**: PocketBase realtime events are applied to IndexedDB, with
 *   optional soft-delete / local-trash behavior.
 * - **CRUD with conflict resolution**: create / update / remove operations write to PocketBase
 *   first, then mirror to IndexedDB. Array fields can use custom merge strategies (e.g.
 *   `mergeByKey`) to avoid overwriting concurrent local changes.
 * - **Batch operations**: `createBatch()` builds a chainable builder that sends a single
 *   PocketBase batch request and reconciles IndexedDB on success or rollback on failure.
 *
 * Usage pattern (see `planningStore.svelte.ts`):
 * ```ts
 * const collection = createSyncCollection<PlanningMaster>(pb, db.masters, 'planning_masters', {
 *   mergeStrategies: { participants: mergeByKey<Participant>('id') }
 * });
 *
 * await collection.initialFetch();
 * const sub = collection.subscribe();
 * // components read via useLiveQuery(collection.getTable())
 * ```
 *
 * @module pb-sync/collection
 */

import type { Table, UpdateSpec } from "dexie";
import type PocketBase from "pocketbase";
import { ClientResponseError } from "pocketbase";
import { upsertRecord } from "./db";
import { withRetry } from "./retry.utils";
import type {
	InitialFetchOptions,
	PbListOptions,
	PbQueryOptions,
	PbSubscribeOptions,
	SubscriptionRef,
	SyncCollectionOptions,
	WithMeta
} from "./types";

/**
 * Thrown when a PocketBase operation returns 404 — the record was hard-deleted on the server.
 * The local Dexie record is already marked `{ deleted: true }` when this error is thrown.
 */
export class RecordDeletedError extends Error {
	readonly recordId: string;
	readonly collection: string;

	constructor(recordId: string, collection: string) {
		super(`Record "${recordId}" was deleted from "${collection}"`);
		this.name = "RecordDeletedError";
		this.recordId = recordId;
		this.collection = collection;
	}
}

/**
 * Crée une stratégie de merge pour les champs tableaux (JSON) basée sur une clé d'identité.
 *
 * Comportement : union par clé, **local écrase remote sur les items communs**.
 * Ordre d'insertion : remote d'abord, puis local (qui écrase les items de même clé).
 *
 * Protection offerte (3 cas de concurrence) :
 * - ✅ **Additions concurrentes** : safe. Les items serveur non présents localement
 *   sont préservés (ajoutés par l'union). Cas typique : un autre client ajoute un
 *   participant/réponse/commentaire → non écrasé par notre update.
 * - ❌ **Modifications concurrentes** : NON protégé. Sur un item de même clé, la version
 *   locale gagne (last-writer-wins au niveau item). Cas : un autre client modifie r1,
 *   notre client (stale) renvoie r1_v1 → la modif distante est perdue.
 * - ❌ **Suppressions concurrentes** : NON protégé. Un item supprimé côté serveur peut
 *   être ressuscité si notre client le porte encore localement. Cas : un autre client
 *   supprime r2, notre client (stale) renvoie une liste contenant r2 → r2 réapparaît.
 *
 * Pour une protection complète, deux alternatives :
 * - Merge côté serveur (pb_hooks) : atomique via SQLite, gère les 3 cas.
 * - Verrouillage optimiste via `_version` : le client renvoie l'`updated` lu, le serveur reject si
 *   le record a été modifié entre-temps. À combiner avec un retry.
 * **Statut** : conservée pour les tests et d'éventuels usages génériques de la
 * lib pb-sync. oupla ne l'active plus : le merge des champs additifs est
 * désormais effectué côté serveur par `pocketbase/pb_hooks/merge-utils.js`
 * (atomique via transaction SQLite), ce qui élimine la fenêtre de course du
 * pre-merge client. Cf. `agent/doc/this-app/network-and-realtime.md`.
 */
export function mergeByKey<T>(key: keyof T & string): (local: T[], remote: T[]) => T[] {
	return (local: T[], remote: T[]): T[] => {
		const map = new Map<unknown, T>();
		for (const item of remote ?? []) map.set((item as Record<string, unknown>)[key], item);
		for (const item of local ?? []) map.set((item as Record<string, unknown>)[key], item);
		return Array.from(map.values());
	};
}

function applyMergeStrategies<T extends WithMeta>(
	payload: Partial<T>,
	serverRecord: T,
	strategies: SyncCollectionOptions<T>["mergeStrategies"]
): Partial<T> {
	const merged = { ...payload };
	if (!strategies) return merged;
	for (const field of Object.keys(strategies) as (keyof T)[]) {
		if (field in payload) {
			const strategy = strategies[field];
			if (strategy) {
				(merged as Record<string, unknown>)[field as string] = strategy(
					payload[field] as NonNullable<T[keyof T]>,
					serverRecord[field] as NonNullable<T[keyof T]>
				);
			}
		}
	}
	return merged;
}

function resolveFilter(pb: PocketBase, params?: PbQueryOptions): string | undefined {
	if (!params?.filter) return undefined;
	if (Array.isArray(params.filter)) {
		return pb.filter(params.filter[0], params.filter[1]);
	}
	return pb.filter(params.filter, {});
}

export function createSyncCollection<T extends WithMeta>(
	pb: PocketBase,
	table: Table<T>,
	collectionName: string,
	options?: SyncCollectionOptions<T>
) {
	const mergeStrategies = options?.mergeStrategies;
	const softDelete = options?.softDelete !== false;
	const tombstoneCollection = options?.tombstoneCollection;
	const localTrash = options?.localTrash ?? false;
	const onSubscriptionChange = options?.onSubscriptionChange;

	const subscriptions = new Map<
		string,
		{
			ref: SubscriptionRef;
			unsub: (() => Promise<void>) | null;
			promise: Promise<() => Promise<void>>;
		}
	>();
	let subCounter = 0;

	async function initialFetch(params?: InitialFetchOptions): Promise<void> {
		const latest = params?.since ? null : await table.orderBy("updated").last();
		const since = params?.since ?? latest?.updated ?? "2000-01-01 00:00:00";

		// Extraire le template et les vars du filtre utilisateur s'il existe
		const userFilterTemplate = Array.isArray(params?.filter) ? params.filter[0] : params?.filter;
		const userFilterVars = Array.isArray(params?.filter) ? params.filter[1] : {};
		const combinedVars = { ...userFilterVars, since };

		const resolvedUserFilter = userFilterTemplate
			? pb.filter(userFilterTemplate, combinedVars)
			: undefined;

		const filter = resolvedUserFilter
			? `(${resolvedUserFilter}) && updated > {:since}`
			: `updated > {:since}`;

		const fresh = await pb.collection(collectionName).getFullList<T>({
			filter: pb.filter(filter, combinedVars),
			sort: "updated",
			...(params?.fields ? { fields: params.fields } : {}),
			...(params?.expand ? { expand: params.expand } : {}),
			...(params?.query && { query: params.query })
		});

		if (fresh.length > 0) {
			// upsertRecord préserve les champs locaux non présents dans le fetch distant.
			await table.db.transaction("rw", table, async () => {
				for (const record of fresh) {
					await upsertRecord(table, record);
				}
			});
		}

		if (tombstoneCollection) {
			const tombFilter = `collection = {:collection} && deletedAt > {:since}`;
			const tombs = await pb.collection(tombstoneCollection).getFullList<{
				collection: string;
				recordId: string;
				deletedAt: string;
			}>({
				filter: pb.filter(tombFilter, { collection: collectionName, since })
			});

			if (tombs.length > 0) {
				await table.db.transaction("rw", table, async () => {
					for (const tomb of tombs) {
						if (localTrash) {
							const existing = await table.get(tomb.recordId);
							if (existing) {
								await table.put({
									...existing,
									deleted: true,
									deletedAt: tomb.deletedAt
								} as T);
							}
						} else {
							await table.delete(tomb.recordId);
						}
					}
				});
			}
		}
	}

	function subscribe(params?: PbSubscribeOptions): SubscriptionRef {
		onSubscriptionChange?.(true);
		const subId = `${collectionName}_${++subCounter}`;
		const resolvedFilter = resolveFilter(pb, params);
		const topic = params?.record ?? "*";
		const ref: SubscriptionRef = {
			id: subId,
			collection: collectionName,
			filter: resolvedFilter
		};
		console.log("realtime subscribe", ref);
		const subscribePromise = pb.collection(collectionName).subscribe<T>(
			topic,

			async (event) => {
				if (event.action === "delete") {
					if (localTrash) {
						await table.put({
							...event.record,
							deleted: true,
							deletedAt: new Date().toISOString()
						} as unknown as T);
					} else {
						await table.delete(event.record.id);
					}
				} else {
					// upsertRecord préserve les champs locaux non présents dans le realtime.
					await upsertRecord(table, event.record);
					console.log("realtime to idb:", event.record);
				}
			},
			{
				...(resolvedFilter ? { filter: resolvedFilter } : {}),
				...(params?.query && { query: params.query })
			}
		);

		subscriptions.set(subId, { ref, unsub: null, promise: subscribePromise });
		subscribePromise.then((unsub) => {
			const entry = subscriptions.get(subId);
			if (entry) entry.unsub = unsub;
		});

		return ref;
	}

	async function unsubscribe(subRefOrId: SubscriptionRef | string): Promise<void> {
		const subId = typeof subRefOrId === "string" ? subRefOrId : subRefOrId.id;
		const entry = subscriptions.get(subId);
		if (entry) {
			console.log("realtime unsubscribe", subId);
			const unsub = entry.unsub ?? (await entry.promise);
			await unsub();
			subscriptions.delete(subId);
		}
	}

	async function unsubscribeAll(): Promise<void> {
		for (const [, entry] of subscriptions) {
			try {
				const unsub = entry.unsub ?? (await entry.promise);
				await unsub();
			} catch {
				// non-bloquant
			}
		}
		subscriptions.clear();
		onSubscriptionChange?.(false);
	}

	async function create(
		data: Omit<T, "id" | "updated" | "created">,
		params?: PbQueryOptions
	): Promise<T> {
		const confirmed = await withRetry(() =>
			pb.collection(collectionName).create<T>(data, {
				...(params?.query && { query: params.query })
			})
		);

		// onRecordEnrich masque adminToken dans la réponse API — restaurer depuis le payload connu localement
		if ((data as Record<string, unknown>).adminToken) {
			(confirmed as Record<string, unknown>).adminToken = (
				data as Record<string, unknown>
			).adminToken;
		}

		await table.put(confirmed);
		return confirmed;
	}

	async function update(id: string, data: Partial<T>, params?: PbQueryOptions): Promise<T> {
		const current = await table.get(id);
		if (!current) throw new Error(`[pb-sync] Record ${id} not found in local DB`);

		await table.put({ ...current, ...data });

		try {
			const confirmed = await withRetry(async () => {
				let payload = data;

				if (mergeStrategies) {
					const fieldsToMerge = Object.keys(mergeStrategies) as (keyof T)[];
					const hasConflictableField = fieldsToMerge.some((f) => f in data);

					if (hasConflictableField) {
						const serverRecord = await pb.collection(collectionName).getOne<T>(id, {
							requestKey: null,
							...(params?.query && { query: params.query })
						});

						payload = applyMergeStrategies(data, serverRecord, mergeStrategies);
					}
				}

				return await pb
					.collection(collectionName)
					.update<T>(id, payload, { ...(params?.query && { query: params.query }) });
			});
			// update() merge — préserve adminToken local masqué par onRecordEnrich
			await table.update(id, confirmed as unknown as UpdateSpec<T>);
			return confirmed;
		} catch (err: unknown) {
			if (err instanceof ClientResponseError && err.status === 404) {
				// Record was hard-deleted on server — mark locally instead of rolling back
				await table.put({ ...current, deleted: true } as T);
				throw new RecordDeletedError(id, collectionName);
			}
			await table.put(current);
			throw err;
		}
	}

	async function remove(id: string, params?: PbQueryOptions): Promise<void> {
		const snapshot = await table.get(id);
		if (!snapshot) throw new Error(`[pb-sync] Record ${id} not found in local DB`);

		try {
			if (softDelete) {
				await table.put({ ...snapshot, deleted: true } as T);

				const confirmed = await withRetry(() =>
					pb.collection(collectionName).update<T>(id, { deleted: true } as unknown as Partial<T>, {
						...(params?.query && { query: params.query })
					})
				);
				await table.put(confirmed);
			} else {
				await table.delete(id);
				await withRetry(() =>
					pb
						.collection(collectionName)
						.delete(id, { ...(params?.query && { query: params.query }) })
				);
			}
		} catch (err: unknown) {
			if (err instanceof ClientResponseError && err.status === 404) {
				// Already deleted on server — mark locally and consider it done
				if (softDelete) {
					await table.put({ ...snapshot, deleted: true } as T);
				}
				// For hard-delete, local record is already removed — nothing to do
				return;
			}
			await table.put(snapshot);
			throw err;
		}
	}

	interface PendingOp {
		type: "create" | "update" | "upsert" | "delete";
		id?: string;
		data?: Partial<T>;
	}

	interface BatchResult {
		records: T[];
	}

	interface CollectionBatch {
		create(data: Omit<T, "id" | "updated" | "created">): CollectionBatch;
		update(id: string, data: Partial<T>): CollectionBatch;
		upsert(data: T): CollectionBatch;
		delete(id: string): CollectionBatch;
		send(): Promise<BatchResult>;
	}

	function createBatch(params?: PbQueryOptions): CollectionBatch {
		const ops: PendingOp[] = [];

		const builder: CollectionBatch = {
			create(data) {
				ops.push({ type: "create", data: data as Partial<T> });
				return builder;
			},
			update(id, data) {
				ops.push({ type: "update", id, data });
				return builder;
			},
			upsert(data) {
				ops.push({ type: "upsert", data: data as Partial<T> });
				return builder;
			},
			delete(id) {
				ops.push({ type: "delete", id });
				return builder;
			},

			async send(): Promise<BatchResult> {
				if (ops.length === 0) return { records: [] };

				const snapshotIds = ops
					.filter((op) => op.type === "update" || op.type === "delete")
					.map((op) => op.id!);
				const snapshots = snapshotIds.length > 0 ? await table.bulkGet(snapshotIds) : [];

				for (const op of ops) {
					switch (op.type) {
						case "update": {
							const current = await table.get(op.id!);
							if (current) await table.put({ ...current, ...op.data });
							break;
						}
						case "upsert":
							await table.put(op.data as T);
							break;
						case "delete":
							await table.delete(op.id!);
							break;
					}
				}

				try {
					const batch = pb.createBatch();
					const pbOpts = { ...(params?.query && { query: params.query }) };

					for (const op of ops) {
						switch (op.type) {
							case "create":
								batch.collection(collectionName).create(op.data, pbOpts);
								break;
							case "update":
								batch.collection(collectionName).update(op.id!, op.data, pbOpts);
								break;
							case "upsert":
								batch.collection(collectionName).upsert(op.data, pbOpts);
								break;
							case "delete":
								if (softDelete) {
									batch
										.collection(collectionName)
										.update(op.id!, { deleted: true } as unknown as Partial<T>, pbOpts);
								} else {
									batch.collection(collectionName).delete(op.id!, pbOpts);
								}
								break;
						}
					}

					const results = await withRetry(() => batch.send());

					const confirmed = results.map((r) => r.body).filter(Boolean) as T[];
					if (confirmed.length > 0) {
						await table.bulkPut(confirmed);
					}

					return { records: confirmed };
				} catch (err) {
					const valid = snapshots.filter(Boolean) as T[];
					if (valid.length > 0) await table.bulkPut(valid);

					for (const op of ops) {
						if (op.type === "upsert" && op.data?.id) {
							const wasExisting = snapshots.some((s) => s && (s as T).id === op.data!.id);
							if (!wasExisting) {
								await table.delete(op.data.id as string);
							}
						}
					}

					throw err;
				}
			}
		};

		return builder;
	}

	async function bulkCreate(
		items: Omit<T, "id" | "updated" | "created">[],
		params?: PbQueryOptions
	): Promise<T[]> {
		const b = createBatch(params);
		for (const item of items) b.create(item);
		const { records } = await b.send();
		return records;
	}

	async function bulkUpdate(
		items: { id: string; data: Partial<T> }[],
		params?: PbQueryOptions
	): Promise<T[]> {
		const b = createBatch(params);
		for (const item of items) b.update(item.id, item.data);
		const { records } = await b.send();
		return records;
	}

	async function bulkUpsert(items: T[], params?: PbQueryOptions): Promise<T[]> {
		const b = createBatch(params);
		for (const item of items) b.upsert(item);
		const { records } = await b.send();
		return records;
	}

	async function bulkDelete(ids: string[], params?: PbQueryOptions): Promise<void> {
		const b = createBatch(params);
		for (const id of ids) b.delete(id);
		await b.send();
	}

	async function list(params?: PbListOptions) {
		const resolvedFilter = resolveFilter(pb, params);
		return pb.collection(collectionName).getList<T>(params?.page ?? 1, params?.perPage ?? 30, {
			...(resolvedFilter ? { filter: resolvedFilter } : {}),
			...(params?.sort ? { sort: params.sort } : {}),
			...(params?.fields ? { fields: params.fields } : {}),
			...(params?.expand ? { expand: params.expand } : {}),
			...(params?.query && { query: params.query })
		});
	}

	async function view(id: string, params?: PbQueryOptions): Promise<T> {
		return pb.collection(collectionName).getOne<T>(id, {
			...(params?.fields ? { fields: params.fields } : {}),
			...(params?.expand ? { expand: params.expand } : {}),
			...(params?.query && { query: params.query })
		});
	}

	function getTable(): Table<T> {
		return table;
	}

	return {
		initialFetch,
		subscribe,
		unsubscribe,
		unsubscribeAll,
		create,
		update,
		remove,
		list,
		view,
		createBatch,
		bulkCreate,
		bulkUpdate,
		bulkUpsert,
		bulkDelete,
		getTable,
		get collectionName() {
			return collectionName;
		}
	};
}
