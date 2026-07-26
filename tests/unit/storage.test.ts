// @vitest-environment happy-dom
/**
 * Tests unitaires — storage.ts (wrapper défensif localStorage/sessionStorage/Tauri)
 *
 * Objectif : vérifier que `getItem` ne crash jamais sur JSON invalide et
 * nettoie la clé corrompue, conformément à l'ADR 0006 (boot-error-recovery).
 *
 * Environnement : happy-dom (localStorage + sessionStorage natifs fournis par
 * le runtime de test, isBrowser=true).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { storage } from "$lib/utils/storage";

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
});

describe("storage.getItem — parsing défensif", () => {
	it("retourne la valeur parsée quand le JSON est valide (persist:true)", async () => {
		localStorage.setItem("app_prefs", JSON.stringify({ theme: "dark" }));
		const result = await storage.getItem<{ theme: string }>("app_prefs", { persist: true });
		expect(result).toEqual({ theme: "dark" });
	});

	it("retourne null et supprime la clé si JSON invalide (persist:true)", async () => {
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
		localStorage.setItem("app_prefs", "{not json");
		const result = await storage.getItem("app_prefs", { persist: true });
		expect(result).toBeNull();
		expect(localStorage.getItem("app_prefs")).toBeNull();
		spy.mockRestore();
	});

	it("retourne null et supprime la clé si JSON invalide (persist:false, sessionStorage)", async () => {
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
		sessionStorage.setItem("ephemeral", "undefined");
		const result = await storage.getItem("ephemeral", { persist: false });
		expect(result).toBeNull();
		expect(sessionStorage.getItem("ephemeral")).toBeNull();
		spy.mockRestore();
	});

	it("cascade : localStorage corrompu → supprimé, fallback sessionStorage valide", async () => {
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
		localStorage.setItem("key", "{broken");
		sessionStorage.setItem("key", JSON.stringify({ ok: true }));

		const result = await storage.getItem<{ ok: boolean }>("key");
		expect(result).toEqual({ ok: true });
		expect(localStorage.getItem("key")).toBeNull();
		expect(sessionStorage.getItem("key")).toBe(JSON.stringify({ ok: true }));
		spy.mockRestore();
	});

	it("retourne null si aucune clé présente", async () => {
		const result = await storage.getItem("absent");
		expect(result).toBeNull();
	});
});

describe("storage.setItem / removeItem — cohérence", () => {
	it("setItem persist:true écrit dans localStorage ET supprime de sessionStorage", async () => {
		sessionStorage.setItem("key", "stale");
		await storage.setItem("key", { a: 1 }, { persist: true });
		expect(localStorage.getItem("key")).toBe(JSON.stringify({ a: 1 }));
		expect(sessionStorage.getItem("key")).toBeNull();
	});

	it("setItem persist:false écrit dans sessionStorage ET supprime de localStorage", async () => {
		localStorage.setItem("key", "stale");
		await storage.setItem("key", "temp", { persist: false });
		expect(sessionStorage.getItem("key")).toBe(JSON.stringify("temp"));
		expect(localStorage.getItem("key")).toBeNull();
	});

	it("removeItem supprime des deux storages", async () => {
		localStorage.setItem("key", "a");
		sessionStorage.setItem("key", "b");
		await storage.removeItem("key");
		expect(localStorage.getItem("key")).toBeNull();
		expect(sessionStorage.getItem("key")).toBeNull();
	});

	it("round-trip setItem puis getItem retourne la valeur initiale", async () => {
		const value = { theme: "dark", occurrenceView: "compact" as const };
		await storage.setItem("app_prefs", value, { persist: true });
		const result = await storage.getItem<typeof value>("app_prefs", { persist: true });
		expect(result).toEqual(value);
	});
});
