/**
 * Tests unitaires de `syncAuthData` — séquence de données post-auth.
 *
 * Le seam testé est l'ordre (fetch masters → fetch occurrences → marqueur) et
 * le fait que le marqueur n'est pas posé quand un fetch échoue.
 */
import { describe, expect, it, vi } from "vitest";
import { syncAuthData } from "$lib/services/authDataSync";

function createFetchDeps(order: string[]) {
	return {
		fetchMasters: vi.fn(async () => {
			order.push("masters");
		}),
		fetchOccurrences: vi.fn(async () => {
			order.push("occurrences");
		})
	};
}

describe("syncAuthData", () => {
	it("enchaîne fetch masters → fetch occurrences → marqueur", async () => {
		const order: string[] = [];
		const deps = createFetchDeps(order);
		const markSynced = vi.fn(async () => {
			order.push("mark");
		});

		await syncAuthData(markSynced, deps);

		expect(order).toEqual(["masters", "occurrences", "mark"]);
	});

	it("ne pose pas le marqueur si le fetch des masters échoue, et n'enchaîne pas", async () => {
		const order: string[] = [];
		const deps = createFetchDeps(order);
		deps.fetchMasters.mockRejectedValue(new Error("offline"));
		const markSynced = vi.fn();

		await expect(syncAuthData(markSynced, deps)).rejects.toThrow("offline");

		expect(deps.fetchOccurrences).not.toHaveBeenCalled();
		expect(markSynced).not.toHaveBeenCalled();
	});

	it("ne pose pas le marqueur si le fetch des occurrences échoue", async () => {
		const order: string[] = [];
		const deps = createFetchDeps(order);
		deps.fetchOccurrences.mockRejectedValue(new Error("offline"));
		const markSynced = vi.fn();

		await expect(syncAuthData(markSynced, deps)).rejects.toThrow("offline");

		expect(markSynced).not.toHaveBeenCalled();
	});

	it("propage l'échec du marqueur", async () => {
		const order: string[] = [];
		const deps = createFetchDeps(order);
		const markSynced = vi.fn().mockRejectedValue(new Error("storage full"));

		await expect(syncAuthData(markSynced, deps)).rejects.toThrow("storage full");
	});
});
