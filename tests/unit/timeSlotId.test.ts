/**
 * Tests unitaires — generateTimeSlotId : génération d'ids courts stables pour
 * les timeSlots (`s1`, `s2`, ...).
 *
 * Porte l'invariante « un id nouveau ne collisionne avec aucun slot déjà présent ».
 * La stabilité du slotId est load-bearing (cf. glossaire plan occurrences-source-verite) :
 * elle préserve l'identité d'une occurrence à travers les changements d'horaires de
 * son template, nécessaire pour 3.2 (pencil/apply) sans perdre responses/comments.
 */
import { describe, expect, it } from "vitest";
import { generateTimeSlotId } from "$lib/services/planningActions";

describe("generateTimeSlotId", () => {
	it("retourne s1 quand aucun slot existant", () => {
		expect(generateTimeSlotId([])).toBe("s1");
	});

	it("incrémente depuis le max des ids s<N> présents", () => {
		expect(generateTimeSlotId([{ id: "s1" }])).toBe("s2");
		expect(generateTimeSlotId([{ id: "s1" }, { id: "s2" }])).toBe("s3");
		// Ordre non pertinent : on prend le max numérique.
		expect(generateTimeSlotId([{ id: "s3" }, { id: "s1" }])).toBe("s4");
	});

	it("ignore les ids non conformes (UUID legacy, default, libre)", () => {
		// Masters legacy non encore nettoyés : on retombe à s1 (max numérique = 0).
		expect(generateTimeSlotId([{ id: "f3a1b2c4-1234-5678-9abc-def012345678" }])).toBe("s1");
		expect(generateTimeSlotId([{ id: "default" }, { id: "autre" }])).toBe("s1");
	});

	it("coexiste avec des UUID : incrémente seulement les ids s<N>", () => {
		// Mix legacy UUID + nouveau court : le max numérique (s2) pilote la suite.
		expect(generateTimeSlotId([{ id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }, { id: "s2" }])).toBe(
			"s3"
		);
	});

	it("ne collisionne jamais avec un slot présent", () => {
		const existing = [{ id: "s1" }, { id: "s2" }, { id: "s3" }];
		const generated = generateTimeSlotId(existing);
		expect(existing.some((s) => s.id === generated)).toBe(false);
	});

	it("gère les grands numéros sans débordement", () => {
		expect(generateTimeSlotId([{ id: "s99" }])).toBe("s100");
		expect(generateTimeSlotId([{ id: "s999" }, { id: "s5" }])).toBe("s1000");
	});
});
