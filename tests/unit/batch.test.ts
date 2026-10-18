/**
 * Tests unitaires — pb-sync/batch.ts (executeMultiCollectionBatch, ADR-0018)
 *
 * Contrat testé : batch multi-collections atomique, NON optimiste, avec
 * reconcile Dexie. PocketBase applique l'ensemble (une transaction serveur) ;
 * si send() résout, `results[i]` répond à `operations[i]` (ordre d'ajout du
 * SDK, confirmé à la source) et chaque corps confirmé est écrit dans la table
 * mappée par l'opération — via upsertRecord (merge : préserve les champs
 * locaux masqués côté API, ex. adminToken par onRecordEnrich). Les deletes,
 * sans corps, sont supprimés localement. À l'échec : rien n'est écrit en
 * local, l'erreur remonte.
 *
 * Environnement : node pur + fake-indexeddb (setup.ts) + vraies tables Dexie
 * (db.masters / db.occurrences), et un fake du batch SDK qui enregistre les
 * requêtes et joue des réponses scriptées.
 */

import type PocketBase from "pocketbase";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeMultiCollectionBatch } from "$lib/pb-sync/batch";
import { db } from "$lib/pb-sync/db";

type RecordedRequest = {
	method: string;
	collection: string;
	id?: string;
	body?: Record<string, unknown>;
	query?: Record<string, string>;
};

interface FakeBatchResult {
	status: number;
	body: unknown;
}

/**
 * Fake du batch SDK limité à l'interface consommée par batch.ts :
 * `pb.createBatch()` → `.collection(name)` → `.create/.update/.delete` puis
 * `.send()` → `Promise<Array<{status, body}>>` (aligné sur l'ordre d'ajout).
 */
function makeFakePb(sendImpl: () => Promise<FakeBatchResult[]>) {
	const requests: RecordedRequest[] = [];
	const send = vi.fn(sendImpl);
	const pb = {
		createBatch: () => ({
			collection: (collection: string) => ({
				create: (data: Record<string, unknown>, options?: { query?: Record<string, string> }) => {
					requests.push({ method: "POST", collection, body: data, query: options?.query });
				},
				update: (
					id: string,
					data: Record<string, unknown>,
					options?: { query?: Record<string, string> }
				) => {
					requests.push({ method: "PATCH", collection, id, body: data, query: options?.query });
				},
				delete: (id: string, options?: { query?: Record<string, string> }) => {
					requests.push({ method: "DELETE", collection, id, query: options?.query });
				}
			}),
			send
		})
	};
	return { pb: pb as unknown as PocketBase, requests, send };
}

const networkError = (status: number) => Object.assign(new Error(`boom ${status}`), { status });

beforeEach(async () => {
	await db.masters.clear();
	await db.occurrences.clear();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("executeMultiCollectionBatch — envoi", () => {
	it("envoie toutes les opérations en un seul batch, ordre et query params préservés", async () => {
		const results: FakeBatchResult[] = [
			{ status: 200, body: { id: "m1", title: "T", updated: "u1" } },
			{ status: 200, body: { id: "srv1", date: "2026-11-01" } },
			{ status: 204, body: null }
		];
		const { pb, requests, send } = makeFakePb(vi.fn().mockResolvedValue(results));

		await executeMultiCollectionBatch(pb, [
			{
				type: "update",
				table: db.masters,
				collection: "planning_masters",
				id: "m1",
				data: { title: "T" },
				params: { query: { _token: "tok", _version: "u0" } }
			},
			{
				type: "create",
				table: db.occurrences,
				collection: "planning_occurrences",
				data: { date: "2026-11-01" },
				params: { query: { _token: "tok" } }
			},
			{
				type: "delete",
				table: db.occurrences,
				collection: "planning_occurrences",
				id: "occ9",
				params: { query: { _token: "tok" } }
			}
		]);

		expect(send).toHaveBeenCalledTimes(1);
		expect(requests).toHaveLength(3);
		expect(requests[0]).toMatchObject({
			method: "PATCH",
			collection: "planning_masters",
			id: "m1",
			query: { _token: "tok", _version: "u0" }
		});
		expect(requests[1]).toMatchObject({
			method: "POST",
			collection: "planning_occurrences",
			query: { _token: "tok" }
		});
		expect(requests[2]).toMatchObject({
			method: "DELETE",
			collection: "planning_occurrences",
			id: "occ9"
		});
	});

	it("liste vide → aucun envoi", async () => {
		const pb = {
			createBatch: () => {
				throw new Error("ne doit pas être appelé");
			}
		} as unknown as PocketBase;

		await expect(executeMultiCollectionBatch(pb, [])).resolves.toBeUndefined();
	});
});

describe("executeMultiCollectionBatch — reconcile Dexie", () => {
	it("écrit les corps confirmés dans les tables mappées (id serveur des creates inclus)", async () => {
		const results: FakeBatchResult[] = [
			{ status: 200, body: { id: "m1", title: "Nouveau titre", updated: "u1" } },
			{ status: 200, body: { id: "srv_occ1", date: "2026-11-01", deleted: false } }
		];
		const { pb } = makeFakePb(vi.fn().mockResolvedValue(results));

		await executeMultiCollectionBatch(pb, [
			{
				type: "update",
				table: db.masters,
				collection: "planning_masters",
				id: "m1",
				data: { title: "Nouveau titre" }
			},
			{
				type: "create",
				table: db.occurrences,
				collection: "planning_occurrences",
				data: { date: "2026-11-01" }
			}
		]);

		const master = await db.masters.get("m1");
		expect(master?.title).toBe("Nouveau titre");
		expect(master?.updated).toBe("u1");
		const occ = await db.occurrences.get("srv_occ1");
		expect(occ?.date).toBe("2026-11-01");
	});

	it("update : merge qui préserve les champs locaux masqués côté API (adminToken)", async () => {
		await db.masters.put({
			id: "m1",
			title: "Old",
			adminToken: "localtok",
			updated: "u0"
		} as never);
		const results: FakeBatchResult[] = [
			// Corps SANS adminToken : onRecordEnrich le masque dans la réponse.
			{ status: 200, body: { id: "m1", title: "New", updated: "u1" } }
		];
		const { pb } = makeFakePb(vi.fn().mockResolvedValue(results));

		await executeMultiCollectionBatch(pb, [
			{
				type: "update",
				table: db.masters,
				collection: "planning_masters",
				id: "m1",
				data: { title: "New" }
			}
		]);

		const master = await db.masters.get("m1");
		expect(master?.title).toBe("New");
		expect(master?.updated).toBe("u1");
		expect(master?.adminToken).toBe("localtok");
	});

	it("delete : supprime la row locale (le corps de réponse est vide)", async () => {
		await db.occurrences.put({ id: "occ1", date: "2026-11-01" } as never);
		const results: FakeBatchResult[] = [{ status: 204, body: null }];
		const { pb } = makeFakePb(vi.fn().mockResolvedValue(results));

		await executeMultiCollectionBatch(pb, [
			{
				type: "delete",
				table: db.occurrences,
				collection: "planning_occurrences",
				id: "occ1"
			}
		]);

		expect(await db.occurrences.get("occ1")).toBeUndefined();
	});
});

describe("executeMultiCollectionBatch — échecs", () => {
	it("batch rejeté (4xx) : throw, Dexie intact, aucun reconcile", async () => {
		await db.masters.put({ id: "m1", title: "Old", updated: "u0" } as never);
		const { pb, send } = makeFakePb(vi.fn().mockRejectedValue(networkError(400)));

		await expect(
			executeMultiCollectionBatch(pb, [
				{
					type: "update",
					table: db.masters,
					collection: "planning_masters",
					id: "m1",
					data: { title: "New" }
				}
			])
		).rejects.toThrow("boom 400");

		expect(send).toHaveBeenCalledTimes(1); // 4xx → non retryable
		expect((await db.masters.get("m1"))?.title).toBe("Old");
	});

	it("erreur 5xx : retry puis succès, reconcile appliqué", async () => {
		const results: FakeBatchResult[] = [
			{ status: 200, body: { id: "m1", title: "New", updated: "u1" } }
		];
		const send = vi
			.fn<() => Promise<FakeBatchResult[]>>()
			.mockRejectedValueOnce(networkError(500))
			.mockResolvedValueOnce(results);
		const { pb } = makeFakePb(send);

		await executeMultiCollectionBatch(pb, [
			{
				type: "update",
				table: db.masters,
				collection: "planning_masters",
				id: "m1",
				data: { title: "New" }
			}
		]);

		expect(send).toHaveBeenCalledTimes(2);
		expect((await db.masters.get("m1"))?.title).toBe("New");
	});
});
