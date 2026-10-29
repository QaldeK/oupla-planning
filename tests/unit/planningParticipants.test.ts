/**
 * Tests unitaires — planningParticipants : contrat du service client.
 *
 * Invariants vérifiés :
 *   - seule l'erreur 404 signifie « absent » ; toute autre (réseau, serveur)
 *     propage au lieu d'être interprétée comme une absence puis de créer ;
 *   - une création qui perd la course (contrainte d'unicité en base) relit la
 *     ligne gagnante au lieu de jeter — le perdant d'un `Promise.all` ne doit
 *     pas faire échouer l'appelant ;
 *   - `ensurePlanningParticipant` ne réécrit jamais une ligne existante.
 *
 * Le client PB est mocké : on teste le contrat du service, pas PocketBase
 * (l'index unique et les routes serveur sont couverts en intégration).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => {
	const collection = {
		getFirstListItem: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
	};
	return {
		collection,
		pb: {
			collection: (_name: string) => collection,
			authStore: { isValid: true as boolean, record: { id: "user-1" } as unknown },
		},
	};
});

vi.mock("$lib/pocketbase/pb", () => ({ pb: stubs.pb }));

import {
	ensurePlanningParticipant,
	getParticipantPrefs,
	updateParticipantPrefs,
} from "$lib/services/planningParticipants";

const ROW = { id: "pp-1", planning: "master-1", user: "user-1" };

describe("getParticipantPrefs", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("retourne la ligne trouvée", async () => {
		stubs.collection.getFirstListItem.mockResolvedValueOnce(ROW);
		await expect(getParticipantPrefs("master-1", "user-1")).resolves.toBe(ROW);
	});

	it("404 → null", async () => {
		stubs.collection.getFirstListItem.mockRejectedValueOnce({ status: 404 });
		await expect(getParticipantPrefs("master-1", "user-1")).resolves.toBeNull();
	});

	it("erreur non-404 → propage", async () => {
		stubs.collection.getFirstListItem.mockRejectedValueOnce({ status: 500 });
		await expect(getParticipantPrefs("master-1", "user-1")).rejects.toMatchObject({ status: 500 });
	});
});

describe("ensurePlanningParticipant", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("ligne existante → retour immédiat, aucun create", async () => {
		stubs.collection.getFirstListItem.mockResolvedValueOnce(ROW);
		await expect(ensurePlanningParticipant("master-1", "user-1")).resolves.toBeUndefined();
		expect(stubs.collection.create).not.toHaveBeenCalled();
	});

	it("absent → create avec les defaults du rôle", async () => {
		stubs.collection.getFirstListItem.mockRejectedValueOnce({ status: 404 });
		stubs.collection.create.mockResolvedValueOnce({ ...ROW, id: "pp-2" });
		await ensurePlanningParticipant("master-1", "user-1", "BIWEEKLY", true);
		expect(stubs.collection.create).toHaveBeenCalledWith(
			expect.objectContaining({
				planning: "master-1",
				user: "user-1",
				onConfirmationNeeded: true,
				newCommentScope: "all",
				reminderDays: ["1", "3"],
				missingDays: ["1", "3", "7"],
			}),
		);
	});

	it("create perdu (unicité) → relit la ligne gagnante, succès", async () => {
		stubs.collection.getFirstListItem.mockRejectedValueOnce({ status: 404 });
		stubs.collection.create.mockRejectedValueOnce({ status: 400 });
		stubs.collection.getFirstListItem.mockResolvedValueOnce(ROW);
		await expect(ensurePlanningParticipant("master-1", "user-1")).resolves.toBeUndefined();
		expect(stubs.collection.create).toHaveBeenCalledTimes(1);
	});

	it("create perdu et relecture en échec → propage l'erreur d'origine", async () => {
		stubs.collection.getFirstListItem.mockRejectedValueOnce({ status: 404 });
		stubs.collection.create.mockRejectedValueOnce({ status: 400 });
		stubs.collection.getFirstListItem.mockRejectedValueOnce({ status: 503 });
		await expect(ensurePlanningParticipant("master-1", "user-1")).rejects.toMatchObject({
			status: 400,
		});
	});

	it("create échoué et relecture vide → propage l'erreur d'origine", async () => {
		stubs.collection.getFirstListItem.mockRejectedValueOnce({ status: 404 });
		stubs.collection.create.mockRejectedValueOnce({ status: 400 });
		stubs.collection.getFirstListItem.mockRejectedValueOnce({ status: 404 });
		await expect(ensurePlanningParticipant("master-1", "user-1")).rejects.toMatchObject({
			status: 400,
		});
	});

	it("erreur non-404 à la lecture → propage, aucun create", async () => {
		stubs.collection.getFirstListItem.mockRejectedValueOnce({ status: 500 });
		await expect(ensurePlanningParticipant("master-1", "user-1")).rejects.toMatchObject({
			status: 500,
		});
		expect(stubs.collection.create).not.toHaveBeenCalled();
	});
});

describe("updateParticipantPrefs", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("ligne existante → update ciblé", async () => {
		stubs.collection.getFirstListItem.mockResolvedValueOnce(ROW);
		stubs.collection.update.mockResolvedValueOnce({ ...ROW, push: true });
		await updateParticipantPrefs("master-1", "user-1", { push: true });
		expect(stubs.collection.update).toHaveBeenCalledWith("pp-1", { push: true });
		expect(stubs.collection.create).not.toHaveBeenCalled();
	});

	it("absent → create avec les prefs fusionnées par-dessus les defaults", async () => {
		stubs.collection.getFirstListItem.mockRejectedValueOnce({ status: 404 });
		stubs.collection.create.mockResolvedValueOnce({ ...ROW });
		await updateParticipantPrefs("master-1", "user-1", { push: true }, "WEEKLY", false);
		expect(stubs.collection.create).toHaveBeenCalledWith(
			expect.objectContaining({ push: true, newCommentScope: "concerned" }),
		);
		expect(stubs.collection.update).not.toHaveBeenCalled();
	});

	it("utilisateur non connecté → erreur, aucune lecture", async () => {
		stubs.pb.authStore.isValid = false;
		try {
			await expect(updateParticipantPrefs("master-1", "user-1", {})).rejects.toThrow();
			expect(stubs.collection.getFirstListItem).not.toHaveBeenCalled();
		} finally {
			stubs.pb.authStore.isValid = true;
		}
	});
});
