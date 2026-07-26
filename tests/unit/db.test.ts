/**
 * Tests unitaires — pb-sync/db.ts (open défensif au boot)
 *
 * Objectif : vérifier que `openAppDB` tente un reset complet (drop + reopen)
 * si l'ouverture initiale échoue, conformément à l'ADR 0006 (boot-error-recovery).
 *
 * Environnement : node pur + fake-indexeddb (polyfill global via setup.ts).
 *
 * Stratégie de test du reset : mocker `AppDB.prototype.open` pour qu'il lève
 * au premier appel (simule une UpgradeError) et réussisse au second. On évite
 * ainsi de bidouiller le schéma IndexedDB à la main (fragile et non
 * déterministe selon la version de Dexie).
 *
 * Note : on teste `openAppDB` directement (pas `ensureDbReady`) pour pouvoir
 * mocker entre les tests sans reset de module. `ensureDbReady` est testé
 * indirectement via un test d'idempotence simple.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppDB, db, ensureDbReady, openAppDB } from "$lib/pb-sync/db";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("openAppDB — happy path", () => {
	it("résout et retourne l'instance singleton", async () => {
		const result = await openAppDB();
		expect(result).toBe(db);
	});

	it("permet une écriture+lecture basique sur la table masters", async () => {
		await openAppDB();
		await db.masters.put({
			id: "m1",
			title: "Test",
			updated: "2026-01-01 00:00:00",
			participantToken: "tok",
			recurrence: { type: "WEEKLY" },
			participants: [],
			occurrences: []
		} as never);

		const got = await db.masters.get("m1");
		expect(got?.id).toBe("m1");
	});
});

describe("openAppDB — reset sur erreur", () => {
	it("recrée une DB propre si open() lève au premier essai (ex: UpgradeError simulée)", async () => {
		// Premier open() échoue, deuxième réussit (cycle reset puis reopen).
		const openSpy = vi
			.spyOn(AppDB.prototype, "open")
			.mockRejectedValueOnce(new Error("UpgradeError: schema mismatch"))
			.mockResolvedValueOnce(undefined as never);
		const deleteSpy = vi.spyOn(AppDB.prototype, "delete").mockResolvedValueOnce(undefined as never);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const result = await openAppDB();

		expect(openSpy).toHaveBeenCalledTimes(2);
		expect(deleteSpy).toHaveBeenCalledTimes(1);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("[Dexie] Open failed"),
			expect.any(Error)
		);
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("reset successful"));
		expect(result).toBe(db);

		errorSpy.mockRestore();
		warnSpy.mockRestore();
	});

	it("propage l'erreur si le reset échoue aussi (cas catastrophique)", async () => {
		vi.spyOn(AppDB.prototype, "open")
			.mockRejectedValueOnce(new Error("first open failed"))
			.mockRejectedValueOnce(new Error("second open also failed"));
		vi.spyOn(AppDB.prototype, "delete").mockResolvedValueOnce(undefined as never);
		vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(openAppDB()).rejects.toThrow("second open also failed");
	});
});

describe("ensureDbReady — idempotence", () => {
	it("retourne la même Promise sur plusieurs calls", async () => {
		const first = ensureDbReady();
		const second = ensureDbReady();
		expect(first).toBe(second);
		await second;
	});
});
