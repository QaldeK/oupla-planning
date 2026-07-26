// @vitest-environment happy-dom
/**
 * PlanningForm — limite de 100 DateSlots futurs actifs.
 *
 * Vérifie : génération pure du cycle (pas de troncature), alerte en multi-slot,
 * blocage au submit > 100, et `maxSelection` dynamique du picker selon le nombre
 * de slots.
 */

import { screen } from "@testing-library/svelte";
import { toast } from "svelte-sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	countBadges,
	getSubmitButton,
	makeMaster,
	makeOccurrence,
	renderForm
} from "./_helpers/planningForm.js";

vi.mock("svelte-sonner", () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
		info: vi.fn(),
		message: vi.fn(),
		warning: vi.fn(),
		loading: vi.fn(),
		promise: vi.fn(),
		custom: vi.fn()
	}
}));

/**
 * Génère `count` dates futures au format YYYY-MM-DD, à partir du 2026-08-01
 * (jour par jour). Sert à seedder N occurrences en CUSTOM pour tester la limite
 * DateSlots sans dépendre du calendrier graphique.
 */
function makeFutureDates(count: number, start = "2026-08-01"): string[] {
	const [y, m, d] = start.split("-").map(Number);
	const out: string[] = [];
	const cur = new Date(y, m - 1, d);
	for (let i = 0; i < count; i++) {
		out.push(
			`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(
				cur.getDate()
			).padStart(2, "0")}`
		);
		cur.setDate(cur.getDate() + 1);
	}
	return out;
}

// Fige « aujourd'hui » au 2026-07-21 (cf. past-dates test).
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-07-21T01:00:00") });
	vi.clearAllMocks();
});
afterEach(() => {
	vi.useRealTimers();
});

// ====================================================================
// A — Génération pure : plus de troncature à 100
// ====================================================================

describe("A — Génération pure (cycle non tronqué)", () => {
	it("DAILY sur 4 mois produit > 100 badges futurs et déclenche le warning live", async () => {
		// Cycle DAILY 2026-08-01 → 2026-11-30 = 122 jours, tous futurs (today=2026-07-21).
		// En édition sans occurrences seeded, le seeding one-shot ne se déclenche pas,
		// mais `allGeneratedDates` est quand même calculé (c'est un `$derived`) et
		// alimente `displayedDateSlots` → les badges sont rendus.
		const { container } = renderForm({
			master: makeMaster({
				recurrence: { type: "DAILY", firstDate: "2026-08-01", lastDate: "2026-11-30" }
			}),
			occurrences: []
		});

		// Section de sélection rendue (mode récurrent avec cycle futur).
		expect(screen.getByText(/sélection des dates/i)).toBeInTheDocument();

		// Critère d'acceptation : > 100 badges rendus (la troncature à 100 est levée).
		// On attend 122 (31 + 30 + 31 + 30 jours).
		const badgeCount = countBadges(container);
		expect(badgeCount).toBeGreaterThan(100);
		expect(badgeCount).toBe(122);

		// L'alert-warning live s'affiche (> 100 DateSlots futurs).
		// Mono-slot → variante "dates futures" du libellé.
		expect(screen.getByText(/limite dépassée/i)).toBeInTheDocument();
	});
});

// ====================================================================
// B — Limite DateSlots en multi-slot (alerte UI)
// ====================================================================

describe("B — Alerte DateSlots en multi-slot", () => {
	it('2 slots × 60 dates manuelles = 120 DateSlots → alerte "combinaisons date×créneau"', async () => {
		// CUSTOM avec 2 slots + 60 occurrences sur 60 dates distinctes (1 occ par date).
		// Le seeding remplit manualDates avec 60 dates ; le produit cartésien
		// 60 × 2 slots = 120 DateSlots futurs → dépasse la limite 100.
		const futureDates = makeFutureDates(60);
		const occurrences = futureDates.map((d, i) =>
			makeOccurrence({
				id: `occ-${i}`,
				date: d,
				slotId: "s1",
				startTime: "14:00",
				endTime: "18:00"
			})
		);
		const { container } = renderForm({
			master: makeMaster({
				recurrence: { type: "CUSTOM" },
				timeSlots: [
					{ id: "s1", startTime: "14:00", endTime: "18:00" },
					{ id: "s2", startTime: "18:00", endTime: "22:00" }
				]
			}),
			occurrences
		});

		// Section CUSTOM rendue.
		expect(screen.getByText(/dates libres/i)).toBeInTheDocument();

		// 120 badges (60 dates × 2 slots) attendus.
		expect(countBadges(container)).toBe(120);

		// Alerte multi-slot : variante "combinaisons date×créneau".
		expect(screen.getByText(/limite dépassée.*combinaisons/i)).toBeInTheDocument();
	});
});

// ====================================================================
// C — Submit bloqué quand > 100 DateSlots futurs
// ====================================================================

describe("C — Submit bloqué > 100 DateSlots futurs", () => {
	it('2 slots × 60 dates → toast "Trop de créneaux planifiés" et onSubmit non appelé', async () => {
		const futureDates = makeFutureDates(60);
		const occurrences = futureDates.map((d, i) =>
			makeOccurrence({ id: `occ-${i}`, date: d, slotId: "s1" })
		);
		const { user, onSubmit } = renderForm({
			master: makeMaster({
				recurrence: { type: "CUSTOM" },
				timeSlots: [
					{ id: "s1", startTime: "14:00", endTime: "18:00" },
					{ id: "s2", startTime: "18:00", endTime: "22:00" }
				]
			}),
			occurrences
		});

		await user.click(getSubmitButton());

		// La garde DateSlots (> 100) est la première validation de handleSubmit :
		// elle court-circuite avant tout autre check.
		expect(toast.error).toHaveBeenCalledWith(
			"Trop de créneaux planifiés",
			expect.objectContaining({
				description: expect.stringContaining("120 combinaisons date×créneau futures")
			})
		);
		expect(onSubmit).not.toHaveBeenCalled();
	});
});

// ====================================================================
// D — Picker : maxSelection dynamique selon le nombre de slots
// ====================================================================

describe("D — Picker : maxSelection dynamique", () => {
	it("2 slots → limite picker à 50 (51e date bloquée)", async () => {
		// Seed 49 dates × 2 slots = 98 DateSlots. maxSelection = floor(100/2) = 50.
		// Clic 1 (22 juil) → 50e date acceptée (100 DateSlots, alerte absente : pas > 100).
		// Clic 2 (23 juil) → refusé par maxSelection=50, badge count inchangé.
		const futureDates = makeFutureDates(49);
		const seededOccurrences = futureDates.map((d, i) =>
			makeOccurrence({ id: `occ-${i}`, date: d, slotId: "s1" })
		);
		const { user, container } = renderForm({
			master: makeMaster({
				recurrence: { type: "CUSTOM" },
				timeSlots: [
					{ id: "s1", startTime: "14:00", endTime: "18:00" },
					{ id: "s2", startTime: "18:00", endTime: "22:00" }
				]
			}),
			occurrences: seededOccurrences
		});

		// 49 dates × 2 slots = 98 badges.
		expect(countBadges(container)).toBe(98);

		// 1er clic : 22 juillet 2026 est future et enabled (minDate = today=21).
		const firstClick = screen.getByRole("button", { name: "22 juillet 2026" });
		expect(firstClick.hasAttribute("disabled")).toBe(false);
		await user.click(firstClick);

		// 50 dates × 2 = 100 badges (la 50e date a été acceptée par le picker).
		expect(countBadges(container)).toBe(100);

		// 2e clic : 23 juillet 2026 doit être refusé par le picker (maxSelection=50).
		const overflowClick = screen.getByRole("button", { name: "23 juillet 2026" });
		expect(overflowClick.hasAttribute("disabled")).toBe(false);
		await user.click(overflowClick);
		expect(countBadges(container)).toBe(100); // inchangé : la 51e date a été refusée
	});

	it("1 slot → limite picker préservée à 100 (101e date bloquée)", async () => {
		// Seed 99 dates × 1 slot = 99 DateSlots. maxSelection = 100 (mono-slot).
		// Clic 1 (22 juil) → 100e date acceptée.
		// Clic 2 (23 juil) → refusé par maxSelection=100.
		const futureDates = makeFutureDates(99);
		const seededOccurrences = futureDates.map((d, i) =>
			makeOccurrence({ id: `occ-${i}`, date: d, slotId: "s1" })
		);
		const { user, container } = renderForm({
			master: makeMaster({
				recurrence: { type: "CUSTOM" },
				timeSlots: [{ id: "s1", startTime: "14:00", endTime: "18:00" }]
			}),
			occurrences: seededOccurrences
		});

		// 99 dates × 1 slot = 99 badges.
		expect(countBadges(container)).toBe(99);

		// 1er clic : 22 juillet 2026 → 100e date acceptée.
		const firstClick = screen.getByRole("button", { name: "22 juillet 2026" });
		expect(firstClick.hasAttribute("disabled")).toBe(false);
		await user.click(firstClick);
		expect(countBadges(container)).toBe(100);

		// 2e clic : 23 juillet 2026 doit être refusé (maxSelection=100 en mono-slot).
		const overflowClick = screen.getByRole("button", { name: "23 juillet 2026" });
		expect(overflowClick.hasAttribute("disabled")).toBe(false);
		await user.click(overflowClick);
		expect(countBadges(container)).toBe(100); // inchangé : la 101e date a été refusée
	});
});
