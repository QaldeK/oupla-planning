/**
 * Tests unitaires — getDefaultParticipantPrefs (hooks JSVM) : defaults serveur
 * posés à la création d'un `planning_participants`.
 *
 * Contrepartie serveur de `getDefaultPlanningPrefs` (src/lib/services/push.ts).
 * Les deux implémentations vivent dans des runtimes isolés (JSVM vs navigateur)
 * et doivent rester alignées : le rôle décide de `newCommentScope` et de
 * `onConfirmationNeeded`, le `recurrenceType` pilote rappels et missings.
 */
import path from "path";
import { describe, expect, it } from "vitest";

// Interopérabilité CommonJS : le hook exporte via `module.exports` et
// `require()` ses voisins via la globale `__hooks`.
const HOOKS_DIR = path.resolve(__dirname, "../../", "pocketbase/pb_hooks");
(globalThis as any).__hooks = HOOKS_DIR;

const { getDefaultParticipantPrefs } =
	await import("../../pocketbase/pb_hooks/participants-utils.js");

describe("getDefaultParticipantPrefs", () => {
	it("admin → newCommentScope 'all' et onConfirmationNeeded true", () => {
		const prefs = getDefaultParticipantPrefs("WEEKLY", { isAdmin: true });
		expect(prefs.newCommentScope).toBe("all");
		expect(prefs.onConfirmationNeeded).toBe(true);
	});

	it("participant → newCommentScope 'concerned' et onConfirmationNeeded false", () => {
		const prefs = getDefaultParticipantPrefs("WEEKLY");
		expect(prefs.newCommentScope).toBe("concerned");
		expect(prefs.onConfirmationNeeded).toBe(false);
	});

	it("rappels / missings pilotés par le recurrenceType", () => {
		expect(getDefaultParticipantPrefs("BIWEEKLY", {})).toMatchObject({
			reminderDays: ["1", "3"],
			missingDays: ["1", "3", "7"],
		});
	});

	it("recurrenceType inconnu → repli WEEKLY", () => {
		expect(getDefaultParticipantPrefs("INCONNU", {})).toMatchObject({
			reminderDays: ["1", "3"],
		});
	});
});
