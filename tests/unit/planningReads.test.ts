/**
 * Tests unitaires de `getPlanningTitleByToken` — projection du résultat de
 * `getPlanningByToken` vers le titre affiché par le mur d'authentification
 * (app installée sans session).
 *
 * Le fetcher est injecté : le seam testé est la projection résultat → titre,
 * pas le transport PocketBase.
 */
import { describe, expect, it, vi } from "vitest";

import { getPlanningTitleByToken } from "$lib/services/planningReads";

describe("getPlanningTitleByToken", () => {
	it("retourne le titre quand le planning est résolu", async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValue({
				master: { id: "m1", title: "Entraînement de vendredi" },
				isAdmin: false,
			});

		await expect(getPlanningTitleByToken("tok", fetcher)).resolves.toBe("Entraînement de vendredi");
		expect(fetcher).toHaveBeenCalledWith("tok");
	});

	it("retourne null sur token introuvable (message générique côté mur)", async () => {
		const fetcher = vi.fn().mockResolvedValue({ error: "not_found" });

		await expect(getPlanningTitleByToken("tok", fetcher)).resolves.toBeNull();
	});

	it("retourne null sur erreur réseau", async () => {
		const fetcher = vi.fn().mockResolvedValue({ error: "network" });

		await expect(getPlanningTitleByToken("tok", fetcher)).resolves.toBeNull();
	});
});
