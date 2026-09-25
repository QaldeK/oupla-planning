/**
 * Tests unitaires de `refreshSessionSilently` — fonction pure avec fakes en deps.
 *
 * Vérifie :
 *   - succès → clearAuth non appelé
 *   - rejet d'auth 400/401/403 → clearAuth (token remis en cause)
 *   - réseau (status 0) / TypeError / 5xx / 4xx transitoires (429, 408) →
 *     état conservé, jamais de rejet
 */
import { ClientResponseError } from "pocketbase";
import { describe, expect, it, vi } from "vitest";
import { refreshSessionSilently } from "$lib/utils/sessionRefresh";

// =============================================
// Helpers : fakes
// =============================================

function createFakeDeps() {
	return {
		authRefresh: vi.fn(async () => ({})),
		clearAuth: vi.fn()
	};
}

// =============================================
// Tests
// =============================================

describe("refreshSessionSilently", () => {
	it("succès → clearAuth non appelé", async () => {
		const deps = createFakeDeps();

		await expect(refreshSessionSilently(deps)).resolves.toBeUndefined();

		expect(deps.authRefresh).toHaveBeenCalledTimes(1);
		expect(deps.clearAuth).not.toHaveBeenCalled();
	});

	it.each([400, 401, 403])("rejet d'auth %i → clearAuth", async (status) => {
		const deps = createFakeDeps();
		deps.authRefresh.mockRejectedValue(
			new ClientResponseError({ status, response: { message: "invalid token" } })
		);

		await expect(refreshSessionSilently(deps)).resolves.toBeUndefined();

		expect(deps.clearAuth).toHaveBeenCalledTimes(1);
	});

	it.each([429, 408])("4xx transitoire %i → état conservé", async (status) => {
		const deps = createFakeDeps();
		deps.authRefresh.mockRejectedValue(
			new ClientResponseError({ status, response: { message: "slow down" } })
		);

		await expect(refreshSessionSilently(deps)).resolves.toBeUndefined();

		expect(deps.clearAuth).not.toHaveBeenCalled();
	});

	it("erreur réseau (status 0) → état conservé, pas de rejet", async () => {
		const deps = createFakeDeps();
		deps.authRefresh.mockRejectedValue(new ClientResponseError({ status: 0 }));

		await expect(refreshSessionSilently(deps)).resolves.toBeUndefined();

		expect(deps.clearAuth).not.toHaveBeenCalled();
	});

	it("5xx (serveur) → état conservé", async () => {
		const deps = createFakeDeps();
		deps.authRefresh.mockRejectedValue(new ClientResponseError({ status: 502 }));

		await refreshSessionSilently(deps);

		expect(deps.clearAuth).not.toHaveBeenCalled();
	});

	it("TypeError (fetch failed) → état conservé", async () => {
		const deps = createFakeDeps();
		deps.authRefresh.mockRejectedValue(new TypeError("fetch failed"));

		await refreshSessionSilently(deps);

		expect(deps.clearAuth).not.toHaveBeenCalled();
	});
});
