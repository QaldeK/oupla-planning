/**
 * Tests unitaires — getDefaultPlanningPrefs : defaults de préférences posés à la
 * création d'un `planning_participants`.
 *
 * Couvre la signature `getDefaultPlanningPrefs(recurrenceType, isAdmin)` :
 *   - `newCommentScope` dépend du rôle (admin → 'all', participant → 'concerned')
 *   - les autres champs sont inchangés par l'ajout du paramètre `isAdmin`
 *   - les defaults de rappel / missings restent pilotés par `recurrenceType`
 */
import { describe, expect, it } from "vitest";
import { getDefaultPlanningPrefs } from "$lib/services/push";
import type { RecurrenceType } from "$lib/types/planning.types";

const RECURRENCE_TYPES: RecurrenceType[] = [
	"WEEKLY",
	"BIWEEKLY",
	"MONTHLY_BY_DATE",
	"MONTHLY_BY_DAY",
	"DAILY",
	"CUSTOM"
];

describe("getDefaultPlanningPrefs", () => {
	describe("newCommentScope selon le rôle", () => {
		it("retourne 'concerned' pour un participant (isAdmin omis / false)", () => {
			for (const recurrenceType of RECURRENCE_TYPES) {
				const prefs = getDefaultPlanningPrefs(recurrenceType);
				expect(prefs.newCommentScope).toBe("concerned");
			}
		});

		it("retourne 'all' pour un admin", () => {
			for (const recurrenceType of RECURRENCE_TYPES) {
				const prefs = getDefaultPlanningPrefs(recurrenceType, true);
				expect(prefs.newCommentScope).toBe("all");
			}
		});

		it("distingue explicitement admin et non-admin pour un même recurrenceType", () => {
			const userPrefs = getDefaultPlanningPrefs("WEEKLY", false);
			const adminPrefs = getDefaultPlanningPrefs("WEEKLY", true);
			expect(userPrefs.newCommentScope).toBe("concerned");
			expect(adminPrefs.newCommentScope).toBe("all");
		});
	});

	describe("champs non liés au rôle inchangés", () => {
		it("garde les mêmes valeurs booléennes quelle que soit la valeur de isAdmin", () => {
			const base = getDefaultPlanningPrefs("WEEKLY", false);
			const admin = getDefaultPlanningPrefs("WEEKLY", true);

			expect(admin.push).toBe(base.push);
			expect(admin.email).toBe(base.email);
			expect(admin.onOccurrenceChange).toBe(base.onOccurrenceChange);
			expect(admin.onConfirmationNeeded).toBe(base.onConfirmationNeeded);
		});

		it("garde les mêmes reminderDays / missingDays quelle que soit la valeur de isAdmin", () => {
			const base = getDefaultPlanningPrefs("MONTHLY_BY_DATE", false);
			const admin = getDefaultPlanningPrefs("MONTHLY_BY_DATE", true);

			expect(admin.reminderDays).toEqual(base.reminderDays);
			expect(admin.missingDays).toEqual(base.missingDays);
		});
	});

	describe("defaults pilotés par recurrenceType", () => {
		it("applique les reminderDays / missingDays attendus pour chaque recurrenceType", () => {
			expect(getDefaultPlanningPrefs("WEEKLY", false)).toMatchObject({
				reminderDays: ["1", "3"],
				missingDays: ["1", "3"]
			});
			expect(getDefaultPlanningPrefs("BIWEEKLY", false)).toMatchObject({
				reminderDays: ["1", "3"],
				missingDays: ["1", "3", "7"]
			});
			expect(getDefaultPlanningPrefs("MONTHLY_BY_DATE", false)).toMatchObject({
				reminderDays: ["1", "3", "7"],
				missingDays: ["1", "3", "7"]
			});
			expect(getDefaultPlanningPrefs("CUSTOM", false)).toMatchObject({
				reminderDays: ["1", "3", "7"],
				missingDays: ["1", "3", "7", "15"]
			});
		});

		it("expose les booléens de base attendus", () => {
			const prefs = getDefaultPlanningPrefs("WEEKLY", false);
			expect(prefs).toMatchObject({
				push: false,
				email: true,
				onOccurrenceChange: true,
				onConfirmationNeeded: false
			});
		});
	});
});
