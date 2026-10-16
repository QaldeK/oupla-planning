/**
 * Tests unitaires — diffPlanningOccurrences : cœur pur du save multi-occurrences.
 *
 * Spécifie la réconciliation cibles↔existantes : match par id puis clé
 * `date|slotId`, horaires d'override portés par la cible, un-soft-delete des
 * désactivées matchées, soft-delete des actives non ciblées. Le module ne lit
 * jamais l'horloge : la fenêtre « futures seulement » est filtrée par le caller.
 */
import { describe, expect, it } from "vitest";
import { diffPlanningOccurrences, normalizeOccurrenceDate } from "$lib/services/occurrenceDiff";
import type { OccurrenceTarget, PlanningOccurrence } from "$lib/types/planning.types";

function mkOcc(overrides: Partial<PlanningOccurrence> & { id: string }): PlanningOccurrence {
	return {
		master: "m1",
		date: "2030-03-05",
		startTime: "18:00",
		endTime: "20:00",
		slotId: "s1",
		responses: [],
		comments: [],
		isConfirmed: false,
		isCanceled: false,
		created: "2030-01-01 00:00:00.000Z",
		updated: "2030-01-01 00:00:00.000Z",
		...overrides
	};
}

function mkTarget(overrides: Partial<OccurrenceTarget> & { date: string }): OccurrenceTarget {
	return { startTime: "18:00", endTime: "20:00", slotId: "s1", ...overrides };
}

describe("normalizeOccurrenceDate", () => {
	it("tronque le suffixe temps (séparateur espace)", () => {
		expect(normalizeOccurrenceDate("2030-03-05 14:00:00.000Z")).toBe("2030-03-05");
	});

	it("tronque le suffixe ISO (séparateur T)", () => {
		expect(normalizeOccurrenceDate("2030-03-05T14:00:00.000Z")).toBe("2030-03-05");
	});

	it("laisse intacte une date déjà normalisée", () => {
		expect(normalizeOccurrenceDate("2030-03-05")).toBe("2030-03-05");
	});
});

describe("diffPlanningOccurrences", () => {
	it("matche par id d'abord, même si la clé date|slotId a divergé", () => {
		const existing = [mkOcc({ id: "o1", date: "2030-03-05", slotId: "s1" })];
		// La cible porte l'id o1 mais une date différente : le match par id gagne.
		const targets = [mkTarget({ id: "o1", date: "2030-03-12" })];

		const ops = diffPlanningOccurrences(targets, existing);

		expect(ops.creates).toEqual([]);
		expect(ops.softDeletes).toEqual([]);
		expect(ops.updates).toHaveLength(1);
		expect(ops.updates[0].existing.id).toBe("o1");
	});

	it("matche par clé date|slotId en fallback (cible sans id)", () => {
		const existing = [mkOcc({ id: "o2", date: "2030-03-05", slotId: "s2" })];
		const targets = [mkTarget({ date: "2030-03-05", slotId: "s2" })];

		const ops = diffPlanningOccurrences(targets, existing);

		expect(ops.updates).toHaveLength(1);
		expect(ops.updates[0].existing.id).toBe("o2");
		expect(ops.creates).toEqual([]);
	});

	it("porte les horaires d'override de la cible tels quels", () => {
		const existing = [mkOcc({ id: "o1", startTime: "18:00", endTime: "20:00" })];
		const targets = [mkTarget({ id: "o1", date: "2030-03-05", startTime: "08:30", endTime: "10:00" })];

		const ops = diffPlanningOccurrences(targets, existing);

		expect(ops.updates).toHaveLength(1);
		expect(ops.updates[0].target.startTime).toBe("08:30");
		expect(ops.updates[0].target.endTime).toBe("10:00");
	});

	it("un-soft-delete : une existante désactivée matchée revient en update", () => {
		const existing = [mkOcc({ id: "o1", deleted: true })];
		const targets = [mkTarget({ id: "o1", date: "2030-03-05" })];

		const ops = diffPlanningOccurrences(targets, existing);

		expect(ops.updates).toHaveLength(1);
		expect(ops.updates[0].existing.id).toBe("o1");
		expect(ops.softDeletes).toEqual([]);
	});

	it("soft-delete les existantes actives non ciblées", () => {
		const existing = [
			mkOcc({ id: "o1" }),
			mkOcc({ id: "o2", date: "2030-03-06", slotId: "s2" })
		];
		const targets = [mkTarget({ id: "o1", date: "2030-03-05" })];

		const ops = diffPlanningOccurrences(targets, existing);

		expect(ops.softDeletes.map((o) => o.id)).toEqual(["o2"]);
	});

	it("ignore les existantes déjà soft-deletées non ciblées", () => {
		const existing = [mkOcc({ id: "o1", deleted: true })];

		const ops = diffPlanningOccurrences([], existing);

		expect(ops.softDeletes).toEqual([]);
		expect(ops.updates).toEqual([]);
		expect(ops.creates).toEqual([]);
	});

	it("cibles vides → soft-delete de toutes les actives", () => {
		const existing = [mkOcc({ id: "o1" }), mkOcc({ id: "o2", deleted: true })];

		const ops = diffPlanningOccurrences([], existing);

		expect(ops.softDeletes.map((o) => o.id)).toEqual(["o1"]);
	});

	it("normalise les dates des deux côtés pour la clé de réconciliation", () => {
		const existing = [mkOcc({ id: "o1", date: "2030-03-05 00:00:00.000Z", slotId: "s1" })];
		const targets = [mkTarget({ date: "2030-03-05 12:00:00.000Z", slotId: "s1" })];

		const ops = diffPlanningOccurrences(targets, existing);

		expect(ops.updates).toHaveLength(1);
		expect(ops.creates).toEqual([]);
	});

	it("crée les cibles sans match", () => {
		const existing = [mkOcc({ id: "o1" })];
		const targets = [
			mkTarget({ id: "o1", date: "2030-03-05" }),
			mkTarget({ date: "2030-03-19", slotId: "s1" })
		];

		const ops = diffPlanningOccurrences(targets, existing);

		expect(ops.creates).toHaveLength(1);
		expect(ops.creates[0].date).toBe("2030-03-19");
		expect(ops.softDeletes).toEqual([]);
	});
});
