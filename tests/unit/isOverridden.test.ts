/**
 * Tests unitaires — isOverridden : modèle dérivé de l'override d'occurrence.
 *
 * `isOverridden` porte l'invariante « une occurrence est override ssi ses horaires
 * divergent du slot template qu'elle référence, dans l'état cible du master ».
 * C'est la fondation du bug #1 (override écrasé silencieusement) : l'ancien flag
 * stocké `timeOverridden` n'était jamais posé à true, rendant la préservation
 * inopérante. La dérivation la rend correcte par construction.
 *
 * La comparaison se fait contre le master **cible** (argument `master`), qui peut
 * être un `PlanningMaster` complet ou un `CreatePlanningData` (état du master
 * après save). On teste ici via un subset structural minimal.
 */
import { describe, expect, it } from "vitest";
import { isOverridden } from "$lib/services/planningActions";
import type { PlanningOccurrence, TimeSlot } from "$lib/types/planning.types";

type MasterLike = Parameters<typeof isOverridden>[1];

const SLOT_A: TimeSlot = { id: "slot-a", startTime: "08:00", endTime: "12:00" };
const SLOT_B: TimeSlot = { id: "slot-b", startTime: "14:00", endTime: "18:00" };

function makeOcc(overrides: Partial<PlanningOccurrence> = {}): PlanningOccurrence {
	return {
		id: "occ-1",
		master: "master-1",
		date: "2026-07-01",
		startTime: "08:00",
		endTime: "12:00",
		slotId: "slot-a",
		responses: [],
		comments: [],
		isConfirmed: false,
		isCanceled: false,
		created: "2026-06-28T00:00:00.000Z",
		updated: "2026-06-28T00:00:00.000Z",
		...overrides
	};
}

function masterWithSlots(timeSlots: TimeSlot[]): MasterLike {
	return {
		defaultStartTime: "08:00",
		defaultEndTime: "12:00",
		timeSlots
	};
}

describe("isOverridden — modèle dérivé de l'override", () => {
	it("retourne false quand l'occurrence est alignée sur son slot", () => {
		const occ = makeOcc({ slotId: "slot-a", startTime: "08:00", endTime: "12:00" });
		expect(isOverridden(occ, masterWithSlots([SLOT_A, SLOT_B]))).toBe(false);
	});

	it("retourne true quand les horaires divergent du slot référencé", () => {
		const occ = makeOcc({ slotId: "slot-a", startTime: "09:00", endTime: "12:00" });
		expect(isOverridden(occ, masterWithSlots([SLOT_A, SLOT_B]))).toBe(true);
	});

	it("retourne true si seul endTime diverge", () => {
		const occ = makeOcc({ slotId: "slot-a", startTime: "08:00", endTime: "13:00" });
		expect(isOverridden(occ, masterWithSlots([SLOT_A, SLOT_B]))).toBe(true);
	});

	it("retourne false quand l'occurrence n'a pas de slotId (custom pur)", () => {
		// Pas de template de référence → non-overridé par définition.
		const occ = makeOcc({ slotId: undefined, startTime: "23:00", endTime: "23:59" });
		expect(isOverridden(occ, masterWithSlots([SLOT_A, SLOT_B]))).toBe(false);
	});

	it("retourne false quand le slotId référence un slot absent (template supprimé)", () => {
		// Un slotId orphelin est traité comme non-overridé afin de ne pas écarter
		// une occurrence dont le template d'origine a disparu.
		const occ = makeOcc({ slotId: "slot-fantome", startTime: "08:00", endTime: "12:00" });
		expect(isOverridden(occ, masterWithSlots([SLOT_A, SLOT_B]))).toBe(false);
	});

	it("détecte override contre le slot référencé même si un autre slot a les mêmes horaires", () => {
		// Garantit qu'on compare au slot référencé par slotId, pas au slot qui
		// matche par horaires (le slotId est la clé de vérité).
		const occ = makeOcc({ slotId: "slot-a", startTime: "14:00", endTime: "18:00" });
		expect(isOverridden(occ, masterWithSlots([SLOT_A, SLOT_B]))).toBe(true);
	});

	describe("comparaison contre le master cible (CreatePlanningData-like)", () => {
		it("utilise les horaires du slot cible, pas du master courant", () => {
			// Simule : l'admin a modifié slot-a (08:00→09:00) au master. L'occurrence
			// alignée sur l'ancienne valeur (08:00) devient overridée vis-à-vis du
			// master cible. Cas accepté pour le Temps 1 (traité au Temps 3.2 via
			// UX pencil/apply) — on valide ici que la dérivation est cohérente.
			const occ = makeOcc({ slotId: "slot-a", startTime: "08:00", endTime: "12:00" });
			const targetMaster = masterWithSlots([
				{ id: "slot-a", startTime: "09:00", endTime: "12:00" }
			]);
			expect(isOverridden(occ, targetMaster)).toBe(true);
		});

		it('fallback legacy : slot synthétisé "s1" depuis defaultStartTime/EndTime', () => {
			// Master sans timeSlots → resolveTimeSlots synthétise un slot 's1'.
			const occ = makeOcc({ slotId: "s1", startTime: "08:00", endTime: "12:00" });
			const legacyMaster: MasterLike = {
				defaultStartTime: "08:00",
				defaultEndTime: "12:00"
			};
			expect(isOverridden(occ, legacyMaster)).toBe(false);
		});

		it("fallback legacy détecte override si horaires divergent du slot synthétisé", () => {
			const occ = makeOcc({ slotId: "s1", startTime: "09:00", endTime: "12:00" });
			const legacyMaster: MasterLike = {
				defaultStartTime: "08:00",
				defaultEndTime: "12:00"
			};
			expect(isOverridden(occ, legacyMaster)).toBe(true);
		});
	});
});
