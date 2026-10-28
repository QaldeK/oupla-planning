import type PocketBase from "pocketbase";
import { upsertRecord } from "./db";
import { withRetry } from "./retry.utils";

/**
 * Opération d'un batch multi-collections. Chaque entrée couple la cible
 * PocketBase (`collection`) à la table Dexie à reconcilier (`table`) ;
 * `params.query` porte les params d'appel (`_token`, `_version`).
 */
export type MultiCollectionBatchOperation = {
	table: import("dexie").Table<unknown>;
	collection: string;
	params?: { query?: Record<string, string> };
} & (
	| { type: "create"; data: Record<string, unknown> }
	| { type: "update"; id: string; data: Record<string, unknown> }
	| { type: "delete"; id: string }
);

/**
 * Batch multi-collections atomique, non optimiste, avec reconcile Dexie
 * (ADR-0018).
 *
 * PocketBase applique l'ensemble en une transaction serveur (rejouée par
 * `withRetry`) ; si `send()` résout, toutes les opérations sont appliquées et
 * `results[i]` répond à `operations[i]` (ordre d'ajout du SDK). Chaque corps
 * confirmé est alors écrit dans sa table via `upsertRecord` — un merge qui
 * préserve les champs locaux masqués côté API (ex. `adminToken` par
 * `onRecordEnrich`) ; les deletes, sans corps, sont supprimés localement.
 *
 * Non optimiste : aucune écriture locale avant le succès serveur — à l'échec,
 * rien n'a changé ni côté PB ni en Dexie. En succès, Dexie converge avant le
 * retour : la convergence ne dépend ni du SSE ni d'une re-sync. Un échec de
 * reconcile (Dexie) ne dément pas l'opération serveur réussie : il est loggué
 * et rattrapé par le SSE ou la re-sync suivante.
 */
export async function executeMultiCollectionBatch(
	pb: PocketBase,
	operations: MultiCollectionBatchOperation[],
): Promise<void> {
	if (operations.length === 0) return;

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
		}
	}

	const results = await withRetry(() => batch.send());

	try {
		for (let i = 0; i < operations.length; i++) {
			const op = operations[i];
			if (op.type === "delete") {
				await op.table.delete(op.id);
				continue;
			}
			const body = results[i]?.body as { id: string } | undefined;
			if (body) {
				// Table typée `unknown` par contrat public ; le corps serveur porte toujours `id`.
				await upsertRecord(op.table as import("dexie").Table<{ id: string }>, body);
			}
		}
	} catch (err) {
		console.warn("[pb-sync] executeMultiCollectionBatch — reconcile Dexie échoué :", err);
	}
}
