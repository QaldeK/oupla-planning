/**
 * Tests unitaires de `claimPlannings` — construction du payload du hook
 * idempotent `/api/sync-plannings`.
 *
 * `pb` est mocké : le seam testé est l'unique site de construction du payload,
 * pas le transport PocketBase.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("$lib/pocketbase/pb", () => ({ pb: { send } }));

import { claimPlannings } from "$lib/services/claimPlannings";

describe("claimPlannings", () => {
	beforeEach(() => {
		send.mockReset();
		send.mockResolvedValue({ success: true });
	});

	it("poste masterId et les deux tokens du planning", async () => {
		await claimPlannings([{ id: "m1", participantToken: "part-32", adminToken: "admin-64" }]);

		expect(send).toHaveBeenCalledTimes(1);
		expect(send).toHaveBeenCalledWith("/api/sync-plannings", {
			method: "POST",
			body: {
				tokens: [{ masterId: "m1", participantToken: "part-32", adminToken: "admin-64" }],
			},
		});
	});

	it("mappe tous les plannings fournis, dans l'ordre", async () => {
		await claimPlannings([
			{ id: "m1", participantToken: "p1" },
			{ id: "m2", adminToken: "a2" },
		]);

		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0][1].body.tokens).toEqual([
			{ masterId: "m1", participantToken: "p1", adminToken: undefined },
			{ masterId: "m2", participantToken: undefined, adminToken: "a2" },
		]);
	});

	it("poste même sans planning (comportement d'origine conservé)", async () => {
		await claimPlannings([]);

		expect(send).toHaveBeenCalledWith("/api/sync-plannings", {
			method: "POST",
			body: { tokens: [] },
		});
	});

	it("propage l'échec : la politique appartient au caller", async () => {
		send.mockRejectedValue(new Error("network down"));

		await expect(claimPlannings([{ id: "m1" }])).rejects.toThrow("network down");
	});
});
