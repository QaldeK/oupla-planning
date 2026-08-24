// @vitest-environment happy-dom
/**
 * PlanningForm — bouton « Ajuster à la date max » dans l'alerte de limite.
 *
 * Vérifie : présence du bouton uniquement en mode récurrent quand la limite
 * 100 est dépassée, mise à jour de `lastDate` au clic, et format du libellé.
 */

import { screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeMaster, makeOccurrence, renderForm } from "./_helpers/planningForm.js";

/** Retourne l'input date « Au » (lastDate) — 2e input[type=date] du formulaire. */
function getLastDateInput(): HTMLInputElement {
	const inputs = document.querySelectorAll("input[type=date]");
	// En mode récurrent non-CUSTOM, il y a « Du » et « Au ». Le 2e est « Au ».
	expect(inputs.length).toBeGreaterThanOrEqual(2);
	return inputs[1] as HTMLInputElement;
}

// Fige « aujourd'hui » au 2026-07-21 (cohérent avec les autres tests PlanningForm).
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-07-21T01:00:00") });
	vi.clearAllMocks();
});
afterEach(() => {
	vi.useRealTimers();
});

describe("Bouton « Ajuster au ... » dans l'alerte de limite", () => {
	it("rendu visible quand la limite 100 est atteinte en mode récurrent (DAILY)", () => {
		// DAILY 2026-08-01 → 2026-12-31 = 153 dates futures > 100.
		renderForm({
			master: makeMaster({
				recurrence: { type: "DAILY", firstDate: "2026-08-01", lastDate: "2026-12-31" }
			}),
			occurrences: []
		});

		// Alerte présente
		expect(screen.getByText(/limit exceeded/i)).toBeInTheDocument();

		// Bouton présent avec une date au format court.
		const button = screen.getByRole("button", { name: /adjust to/i });
		expect(button).toBeInTheDocument();
		// 100e date depuis 2026-08-01 = 2026-11-08 → « 8 Nov 2026 » (en-US, d MMM yyyy).
		expect(button.textContent).toMatch(/8 nov 2026/i);
	});

	it("PAS visible en mode CUSTOM (pas de cycle à ajuster)", () => {
		// CUSTOM avec 120 dates manuelles → dépasse la limite, mais le bouton
		// ne doit pas apparaître (CUSTOM n'a pas de lastDate à ajuster).
		const futureDates: string[] = [];
		const cur = new Date(2026, 6, 22); // 22 juillet 2026 (today+1)
		for (let i = 0; i < 120; i++) {
			futureDates.push(
				`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(
					cur.getDate()
				).padStart(2, "0")}`
			);
			cur.setDate(cur.getDate() + 1);
		}
		const occurrences = futureDates.map((d, i) => makeOccurrence({ id: `occ-${i}`, date: d }));

		renderForm({
			master: makeMaster({
				recurrence: { type: "CUSTOM" },
				timeSlots: [{ id: "s1", startTime: "14:00", endTime: "18:00" }]
			}),
			occurrences
		});

		// L'alerte CUSTOM est bien affichée (limite dépassée).
		expect(screen.getByText(/limit exceeded/i)).toBeInTheDocument();

		// Pas de bouton « Ajuster au ».
		expect(screen.queryByRole("button", { name: /adjust to/i })).not.toBeInTheDocument();
	});

	it("PAS visible quand la limite n'est pas atteinte (WEEKLY court)", () => {
		// WEEKLY 2026-08-05 → 2026-09-30 = ~9 dates < 100.
		renderForm({
			master: makeMaster({
				recurrence: { type: "WEEKLY", firstDate: "2026-08-05", lastDate: "2026-09-30" }
			}),
			occurrences: []
		});

		// Ni alerte, ni bouton.
		expect(screen.queryByText(/limit exceeded/i)).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /adjust to/i })).not.toBeInTheDocument();
	});

	it("au clic : lastDate est mise à jour et l'alerte disparaît", async () => {
		const { user } = renderForm({
			master: makeMaster({
				recurrence: { type: "DAILY", firstDate: "2026-08-01", lastDate: "2026-12-31" }
			}),
			occurrences: []
		});

		// État initial : lastDate = 2026-12-31, alerte présente.
		expect(getLastDateInput().value).toBe("2026-12-31");
		expect(screen.getByText(/limit exceeded/i)).toBeInTheDocument();

		const button = screen.getByRole("button", { name: /adjust to/i });
		await user.click(button);

		// Après clic : lastDate = 2026-11-08 (100e jour depuis firstDate, pour
		// ramener le compte de DateSlots futurs à exactement 100, sous le seuil > 100).
		expect(getLastDateInput().value).toBe("2026-11-08");

		// L'alerte a disparu (le compte de DateSlots futurs est redescendu à 100).
		expect(screen.queryByText(/limit exceeded/i)).not.toBeInTheDocument();
		// Le bouton aussi (puisque maxAdjustDate repasse à null une fois sous la limite).
		expect(screen.queryByRole("button", { name: /adjust to/i })).not.toBeInTheDocument();
	});

	it("le libellé contient la date calculée au format « d MMM yyyy »", () => {
		renderForm({
			master: makeMaster({
				recurrence: { type: "DAILY", firstDate: "2026-08-01", lastDate: "2026-12-31" }
			}),
			occurrences: []
		});

		const button = screen.getByRole("button", { name: /adjust to/i });
		// « Adjust to 8 Nov 2026 » — date-fns 'd MMM yyyy' avec locale en-US.
		expect(button).toHaveTextContent(/adjust to 8 nov 2026/i);
	});
});
