/**
 * Tests unitaires de `generateRecurrenceDates`, `isLastDayOfMonth`, `getRecurrenceLabel`.
 * Fonctions pures — pas de DOM, pas de montage composant.
 *
 * Spécification de référence : `.scratch/26-07-26_monthly-by-date-mode/spec.md`.
 */

import { parse } from "date-fns";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "$lib/paraglide/runtime.js";
import {
	generateRecurrenceDates,
	getRecurrenceLabel,
	isLastDayOfMonth
} from "$lib/utils/recurrence";

// =============================================
// isLastDayOfMonth
// =============================================

describe("isLastDayOfMonth", () => {
	it("31 en mois de 31j → true", () => {
		expect(isLastDayOfMonth(parse("2026-07-31", "yyyy-MM-dd", new Date()))).toBe(true);
	});

	it("30 en mois de 30j → true", () => {
		expect(isLastDayOfMonth(parse("2026-04-30", "yyyy-MM-dd", new Date()))).toBe(true);
	});

	it("15 → false (jamais dernier jour)", () => {
		expect(isLastDayOfMonth(parse("2026-07-15", "yyyy-MM-dd", new Date()))).toBe(false);
	});

	it("28 en janvier → false (janvier a 31 jours)", () => {
		expect(isLastDayOfMonth(parse("2026-01-28", "yyyy-MM-dd", new Date()))).toBe(false);
	});

	it("30 en mois de 31j → false", () => {
		expect(isLastDayOfMonth(parse("2026-07-30", "yyyy-MM-dd", new Date()))).toBe(false);
	});

	it("28 en février non-bissextile → true", () => {
		expect(isLastDayOfMonth(parse("2026-02-28", "yyyy-MM-dd", new Date()))).toBe(true);
	});

	it("29 en février bissextile → true", () => {
		expect(isLastDayOfMonth(parse("2024-02-29", "yyyy-MM-dd", new Date()))).toBe(true);
	});

	it("28 en février bissextile → false", () => {
		expect(isLastDayOfMonth(parse("2024-02-28", "yyyy-MM-dd", new Date()))).toBe(false);
	});
});

// =============================================
// generateRecurrenceDates — MONTHLY_BY_DATE / fixed-day (défaut)
// =============================================

describe("MONTHLY_BY_DATE — fixed-day (défaut)", () => {
	it("firstDate=31 skip les mois de 30j (cas du rapport de bug)", () => {
		const dates = generateRecurrenceDates({
			type: "MONTHLY_BY_DATE",
			firstDate: "2026-07-31",
			lastDate: "2026-12-31"
		});
		expect(dates).toEqual(["2026-07-31", "2026-08-31", "2026-10-31", "2026-12-31"]);
	});

	it("firstDate=31 sur 12 mois skip fév, avr, jun, sep, nov", () => {
		const dates = generateRecurrenceDates({
			type: "MONTHLY_BY_DATE",
			firstDate: "2026-01-31",
			lastDate: "2026-12-31"
		});
		expect(dates).toEqual([
			"2026-01-31",
			"2026-03-31",
			"2026-05-31",
			"2026-07-31",
			"2026-08-31",
			"2026-10-31",
			"2026-12-31"
		]);
	});

	it("firstDate=30 (mois de 30j) skip février", () => {
		const dates = generateRecurrenceDates({
			type: "MONTHLY_BY_DATE",
			firstDate: "2026-04-30",
			lastDate: "2026-12-31"
		});
		// Tous les mois ont 30 jours ou plus, sauf février qui n'a pas de 30 → skip.
		expect(dates).toEqual([
			"2026-04-30",
			"2026-05-30",
			"2026-06-30",
			"2026-07-30",
			"2026-08-30",
			"2026-09-30",
			"2026-10-30",
			"2026-11-30",
			"2026-12-30"
		]);
	});

	it("firstDate=29 bissextile skip fév non-bis, revient en 2028", () => {
		const dates = generateRecurrenceDates({
			type: "MONTHLY_BY_DATE",
			firstDate: "2024-02-29",
			lastDate: "2028-03-31"
		});
		expect(dates).toContain("2024-02-29");
		expect(dates).toContain("2024-03-29");
		// Pas de fév 2025/2026/2027
		expect(dates.find((d) => d.startsWith("2025-02"))).toBeUndefined();
		expect(dates.find((d) => d.startsWith("2026-02"))).toBeUndefined();
		expect(dates.find((d) => d.startsWith("2027-02"))).toBeUndefined();
		// Retour en 2028 (bissextile)
		expect(dates).toContain("2028-02-29");
	});

	it("firstDate=28 février non-bis : aucun skip (tous les mois ont ≥28 j)", () => {
		const dates = generateRecurrenceDates({
			type: "MONTHLY_BY_DATE",
			firstDate: "2026-02-28",
			lastDate: "2026-06-30"
		});
		expect(dates).toEqual(["2026-02-28", "2026-03-28", "2026-04-28", "2026-05-28", "2026-06-28"]);
	});

	it("jour ≤ 28 : aucun changement vs comportement pré-bug", () => {
		const dates = generateRecurrenceDates({
			type: "MONTHLY_BY_DATE",
			firstDate: "2026-01-15",
			lastDate: "2026-06-30"
		});
		expect(dates).toEqual([
			"2026-01-15",
			"2026-02-15",
			"2026-03-15",
			"2026-04-15",
			"2026-05-15",
			"2026-06-15"
		]);
	});

	it("mode explicitement `fixed-day` = comportement par défaut", () => {
		const a = generateRecurrenceDates({
			type: "MONTHLY_BY_DATE",
			firstDate: "2026-07-31",
			lastDate: "2026-12-31"
		});
		const b = generateRecurrenceDates({
			type: "MONTHLY_BY_DATE",
			firstDate: "2026-07-31",
			lastDate: "2026-12-31",
			monthlyByDateMode: "fixed-day"
		});
		expect(a).toEqual(b);
	});
});

// =============================================
// generateRecurrenceDates — MONTHLY_BY_DATE / last-day
// =============================================

describe("MONTHLY_BY_DATE — last-day", () => {
	it("firstDate=31 → derniers jours de chaque mois (piège endOfMonth 23:59:59)", () => {
		const dates = generateRecurrenceDates({
			type: "MONTHLY_BY_DATE",
			firstDate: "2026-07-31",
			lastDate: "2026-12-31",
			monthlyByDateMode: "last-day"
		});
		// Dec 31 doit être inclus malgré le time 23:59:59.999 d'endOfMonth.
		expect(dates).toEqual([
			"2026-07-31",
			"2026-08-31",
			"2026-09-30",
			"2026-10-31",
			"2026-11-30",
			"2026-12-31"
		]);
	});

	it("firstDate=28 février non-bis → récurrence sémantiquement différente de fixed-day", () => {
		const dates = generateRecurrenceDates({
			type: "MONTHLY_BY_DATE",
			firstDate: "2026-02-28",
			lastDate: "2026-07-31",
			monthlyByDateMode: "last-day"
		});
		expect(dates).toEqual([
			"2026-02-28",
			"2026-03-31",
			"2026-04-30",
			"2026-05-31",
			"2026-06-30",
			"2026-07-31"
		]);
	});

	it("firstDate=29 fév bis → fév inclus à 28 les années non-bis", () => {
		const dates = generateRecurrenceDates({
			type: "MONTHLY_BY_DATE",
			firstDate: "2024-02-29",
			lastDate: "2025-03-31",
			monthlyByDateMode: "last-day"
		});
		expect(dates).toContain("2024-02-29");
		expect(dates).toContain("2025-02-28");
		expect(dates).toContain("2025-03-31");
	});

	it("inertie implicite : firstDate=15 + last-day → retombe sur fixed-day", () => {
		// last-day est inactif quand firstDate n'est pas dernier de mois.
		const dates = generateRecurrenceDates({
			type: "MONTHLY_BY_DATE",
			firstDate: "2026-01-15",
			lastDate: "2026-06-30",
			monthlyByDateMode: "last-day"
		});
		expect(dates).toEqual([
			"2026-01-15",
			"2026-02-15",
			"2026-03-15",
			"2026-04-15",
			"2026-05-15",
			"2026-06-15"
		]);
	});
});

// =============================================
// Non-régression : autres types de récurrence
// =============================================

describe("Non-régression autres types", () => {
	it("DAILY inchangé", () => {
		const dates = generateRecurrenceDates({
			type: "DAILY",
			firstDate: "2026-01-01",
			lastDate: "2026-01-05"
		});
		expect(dates).toEqual(["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"]);
	});

	it("WEEKLY inchangé", () => {
		const dates = generateRecurrenceDates({
			type: "WEEKLY",
			firstDate: "2026-01-07",
			lastDate: "2026-01-28"
		});
		expect(dates).toEqual(["2026-01-07", "2026-01-14", "2026-01-21", "2026-01-28"]);
	});

	it("BIWEEKLY inchangé", () => {
		const dates = generateRecurrenceDates({
			type: "BIWEEKLY",
			firstDate: "2026-01-07",
			lastDate: "2026-02-18"
		});
		expect(dates).toEqual(["2026-01-07", "2026-01-21", "2026-02-04", "2026-02-18"]);
	});

	it("MONTHLY_BY_DAY inchangé", () => {
		const dates = generateRecurrenceDates({
			type: "MONTHLY_BY_DAY",
			firstDate: "2026-01-07", // 1er mercredi de janvier
			lastDate: "2026-03-31",
			monthlyByDayOccurrences: [1]
		});
		expect(dates).toEqual(["2026-01-07", "2026-02-04", "2026-03-04"]);
	});

	it("CUSTOM retourne []", () => {
		const dates = generateRecurrenceDates({ type: "CUSTOM" });
		expect(dates).toEqual([]);
	});
});

// =============================================
// getRecurrenceLabel — MONTHLY_BY_DATE
// =============================================

describe("getRecurrenceLabel — MONTHLY_BY_DATE", () => {
	// Ces assertions portent sur des libellés localisés : il faut pinner "fr"
	// explicitement. En environnement de test (isServer=true), la strategy
	// `preferredLanguage` est ignorée et getLocale() tombe sur la baseLocale
	// (en), ce qui ferait échouer ces assertions. On override donc la résolution
	// pour tout le describe, et on restore après pour ne pas polluer les autres tests.
	const originalGetLocale = getLocale;
	beforeAll(() => overwriteGetLocale(() => "fr"));
	afterAll(() => overwriteGetLocale(originalGetLocale));

	it('fixed-day (défaut) → "Tous les N du mois"', () => {
		const label = getRecurrenceLabel({
			type: "MONTHLY_BY_DATE",
			firstDate: "2026-07-31",
			lastDate: "2026-12-31"
		});
		expect(label).toBe("Tous les 31 du mois");
	});

	it("mode explicite fixed-day → même libellé", () => {
		const label = getRecurrenceLabel({
			type: "MONTHLY_BY_DATE",
			firstDate: "2026-07-31",
			lastDate: "2026-12-31",
			monthlyByDateMode: "fixed-day"
		});
		expect(label).toBe("Tous les 31 du mois");
	});

	it('mode last-day → "Le dernier jour du mois"', () => {
		const label = getRecurrenceLabel({
			type: "MONTHLY_BY_DATE",
			firstDate: "2026-07-31",
			lastDate: "2026-12-31",
			monthlyByDateMode: "last-day"
		});
		expect(label).toBe("Le dernier jour du mois");
	});
});
