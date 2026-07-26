/**
 * Tests unitaires — pb-sync/retry.utils
 *
 * Objectif : vérifier le wrapper `withRetry` et la classification d'erreurs
 * `isRetryableError` en isolation (pas de PocketBase, pas de Dexie).
 *
 * `setTimeout` est mocké pour capturer les délais programmés ET exécuter le
 * handler immédiatement (donc pas d'attente réelle, tests < 1 s et déterministes).
 * `Math.random` est spyé pour figer le jitter quand on asserte sur les délais.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRetryableError, withRetry } from "../../src/lib/pb-sync/retry.utils";

/** Fabrique une erreur façon PocketBase ClientResponseError (avec `status`). */
function pbError(status: number, message = `HTTP ${status}`): Error {
	const err = new Error(message) as Error & { status?: number };
	err.status = status;
	return err;
}

/** Fabrique une erreur façon RecordDeletedError (détectée par `name`). */
function recordDeletedError(): Error {
	const err = new Error("Record deleted");
	err.name = "RecordDeletedError";
	return err;
}

/** Délais capturés lors des appels à `setTimeout` dans withRetry. */
let seenDelays: number[];

describe("isRetryableError", () => {
	it("retourne true pour status >= 500 (serveur)", () => {
		expect(isRetryableError(pbError(500))).toBe(true);
		expect(isRetryableError(pbError(502))).toBe(true);
		expect(isRetryableError(pbError(503))).toBe(true);
	});

	it("retourne true pour status === 0 (réseau down / CORS)", () => {
		expect(isRetryableError(pbError(0))).toBe(true);
	});

	it("retourne false pour les status 4xx (400, 401, 403, 404, 409)", () => {
		for (const status of [400, 401, 403, 404, 409]) {
			expect(isRetryableError(pbError(status))).toBe(false);
		}
	});

	it("retourne false pour RecordDeletedError", () => {
		expect(isRetryableError(recordDeletedError())).toBe(false);
	});

	it("retourne true pour TypeError (fetch failed)", () => {
		expect(isRetryableError(new TypeError("Failed to fetch"))).toBe(true);
	});

	it("retourne true pour AbortError (timeout fetch)", () => {
		const err = new Error("The user aborted a request");
		err.name = "AbortError";
		expect(isRetryableError(err)).toBe(true);
	});

	it('retourne true pour une erreur dont le message contient "timeout"', () => {
		expect(isRetryableError(new Error("Request timeout"))).toBe(true);
	});

	it("retourne false par défaut pour une erreur métier générique", () => {
		expect(isRetryableError(new Error("Something business"))).toBe(false);
	});
});

describe("withRetry", () => {
	beforeEach(() => {
		seenDelays = [];
		// Capture le délai puis exécute le handler immédiatement (pas d'attente réelle).
		vi.spyOn(globalThis, "setTimeout").mockImplementation((handler, delay?: number) => {
			if (typeof delay === "number") seenDelays.push(delay);
			if (typeof handler === "function") handler();
			return 0 as unknown as ReturnType<typeof setTimeout>;
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("retourne le résultat au premier essai (0 retry, fn appelée 1 fois)", async () => {
		const fn = vi.fn().mockResolvedValue("ok");

		const result = await withRetry(fn);

		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(1);
		expect(seenDelays).toEqual([]);
	});

	it("retry sur 500 puis réussit (fn appelée 2 fois)", async () => {
		const fn = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(pbError(500))
			.mockResolvedValueOnce("ok");

		const result = await withRetry(fn);

		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(2);
		expect(seenDelays.length).toBe(1); // un seul délai (avant le 2e essai)
	});

	it("throw après maxRetries + 1 tentatives sur 500 persistant", async () => {
		const fn = vi.fn().mockRejectedValue(pbError(500));

		await expect(withRetry(fn, { maxRetries: 2 })).rejects.toThrow("HTTP 500");

		expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
		expect(seenDelays.length).toBe(2);
	});

	it("throw immédiatement sur 400 (pas de retry)", async () => {
		const fn = vi.fn().mockRejectedValue(pbError(400));

		await expect(withRetry(fn)).rejects.toThrow("HTTP 400");
		expect(fn).toHaveBeenCalledTimes(1);
		expect(seenDelays).toEqual([]); // aucun délai programmé
	});

	it("throw immédiatement sur 401", async () => {
		const fn = vi.fn().mockRejectedValue(pbError(401));
		await expect(withRetry(fn)).rejects.toThrow("HTTP 401");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("throw immédiatement sur 403", async () => {
		const fn = vi.fn().mockRejectedValue(pbError(403));
		await expect(withRetry(fn)).rejects.toThrow("HTTP 403");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("throw immédiatement sur 404", async () => {
		const fn = vi.fn().mockRejectedValue(pbError(404));
		await expect(withRetry(fn)).rejects.toThrow("HTTP 404");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("throw immédiatement sur 409 (R5.2 gérera le re-merge)", async () => {
		const fn = vi.fn().mockRejectedValue(pbError(409));
		await expect(withRetry(fn)).rejects.toThrow("HTTP 409");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("retry sur TypeError (fetch failed)", async () => {
		const fn = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(new TypeError("Failed to fetch"))
			.mockResolvedValueOnce("ok");

		const result = await withRetry(fn);

		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("retry sur status === 0", async () => {
		const fn = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(pbError(0))
			.mockResolvedValueOnce("ok");

		const result = await withRetry(fn);

		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("retry sur AbortError (timeout fetch)", async () => {
		const abortErr = new Error("aborted");
		abortErr.name = "AbortError";
		const fn = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(abortErr)
			.mockResolvedValueOnce("ok");

		const result = await withRetry(fn);

		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("throw immédiatement sur RecordDeletedError", async () => {
		const fn = vi.fn().mockRejectedValue(recordDeletedError());
		await expect(withRetry(fn)).rejects.toThrow("Record deleted");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("ne dépasse jamais capMs (Math.random = 1 → delay = expo)", async () => {
		vi.spyOn(Math, "random").mockReturnValue(1);
		const capMs = 100;

		const fn = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(pbError(500))
			.mockRejectedValueOnce(pbError(500))
			.mockRejectedValueOnce(pbError(500));

		await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 500, capMs })).rejects.toThrow(
			"HTTP 500"
		);

		expect(seenDelays.length).toBe(2); // 2 retries → 2 délais
		for (const delay of seenDelays) {
			expect(delay).toBeLessThanOrEqual(capMs);
		}
	});

	it("applique le full jitter : delay = random * min(cap, base * 2^attempt)", async () => {
		const baseDelayMs = 1000;
		const capMs = 8000;
		// random = 0.5 → delay = 0.5 * expo (déterministe).
		vi.spyOn(Math, "random").mockReturnValue(0.5);

		const fn = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(pbError(500))
			.mockRejectedValueOnce(pbError(500))
			.mockRejectedValueOnce(pbError(500));

		await expect(withRetry(fn, { maxRetries: 2, baseDelayMs, capMs })).rejects.toThrow("HTTP 500");

		// attempt 0 → expo = min(8000, 1000*2^0) = 1000 → delay = 500
		// attempt 1 → expo = min(8000, 1000*2^1) = 2000 → delay = 1000
		expect(seenDelays).toEqual([500, 1000]);
	});

	it("respecte les options personnalisées (maxRetries, baseDelayMs, capMs)", async () => {
		vi.spyOn(Math, "random").mockReturnValue(1);

		const fn = vi.fn().mockRejectedValue(pbError(500));

		// maxRetries 1 → 2 tentatives ; baseDelayMs 100 ; capMs 100.
		await expect(withRetry(fn, { maxRetries: 1, baseDelayMs: 100, capMs: 100 })).rejects.toThrow(
			"HTTP 500"
		);

		expect(fn).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
		// attempt 0 : expo = min(100, 100*2^0) = 100, random = 1 → delay = 100.
		expect(seenDelays).toEqual([100]);
	});

	it("maxRetries 0 → une seule tentative, aucun delay", async () => {
		const fn = vi.fn().mockRejectedValue(pbError(500));
		await expect(withRetry(fn, { maxRetries: 0 })).rejects.toThrow("HTTP 500");
		expect(fn).toHaveBeenCalledTimes(1);
		expect(seenDelays).toEqual([]);
	});
});
