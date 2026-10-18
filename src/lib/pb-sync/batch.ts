import type PocketBase from "pocketbase";

/**
 * Opération de batch multi-collections. Le discriminateur `type` rend `id`
 * obligatoire sur update/delete/tombstone et `data` sur create/update.
 */
export type BatchOperation = {
	table: import("dexie").Table<unknown>;
	collection: string;
	params?: { query?: Record<string, string> };
} & (
	| { type: "create"; id?: string; data: Record<string, unknown> }
	| { type: "update"; id: string; data: Record<string, unknown> }
	| { type: "delete"; id: string }
	| { type: "tombstone"; id: string }
);

export async function executeBatch<T extends { id: string; updated: string }>(
	pb: PocketBase,
	operations: BatchOperation[]
): Promise<void> {
	if (operations.length === 0) return;

	const snapshots = await Promise.all(
		operations.map((op) =>
			op.id ? (op.table as import("dexie").Table<{ id: string }>).get(op.id) : undefined
		)
	);

	const tables = [...new Set(operations.map((op) => op.table))];
	const dbInstance = tables[0].db;

	await dbInstance.transaction("rw", tables, async () => {
		for (let i = 0; i < operations.length; i++) {
			const op = operations[i];
			switch (op.type) {
				case "create":
				case "update": {
					const merged = op.id ? { ...(snapshots[i] ?? {}), ...op.data } : op.data;
					await op.table.put(merged as unknown as T);
					break;
				}
				case "delete":
				case "tombstone":
					await op.table.delete(op.id);
					break;
			}
		}
	});

	try {
		const batch = pb.createBatch();

		for (const op of operations) {
			const options = op.params?.query ? { query: op.params.query } : undefined;

			switch (op.type) {
				case "create":
					batch.collection(op.collection).create(op.data, options);
					break;
				case "update":
					batch.collection(op.collection).update(op.id, op.data, options);
					break;
				case "delete":
					batch.collection(op.collection).delete(op.id, options);
					break;
				case "tombstone":
					break;
			}
		}

		const results = await batch.send();

		const confirmedByTable = new Map<
			import("dexie").Table<unknown>,
			{ id: string; updated: string }[]
		>();
		for (let i = 0; i < operations.length; i++) {
			const op = operations[i];
			if (op.type === "tombstone") continue;
			const body = results[i]?.body;
			if (body) {
				const arr = (confirmedByTable.get(op.table) ?? []) as { id: string; updated: string }[];
				arr.push(body);
				confirmedByTable.set(op.table, arr);
			}
		}
		for (const [tbl, records] of confirmedByTable) {
			await (tbl as import("dexie").Table<Record<string, unknown>>).bulkPut(records);
		}
	} catch (err) {
		await dbInstance.transaction("rw", tables, async () => {
			for (let i = 0; i < operations.length; i++) {
				const op = operations[i];
				switch (op.type) {
					case "create":
						if (op.id) await op.table.delete(op.id);
						break;
					case "update":
					case "delete":
					case "tombstone":
						if (snapshots[i]) await op.table.put(snapshots[i]);
						break;
				}
			}
		});
		throw err;
	}
}
