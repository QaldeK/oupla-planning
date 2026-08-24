// @vitest-environment happy-dom
/**
 * PlanningForm — toggle du mode MONTHLY_BY_DATE (fixed-day / last-day).
 *
 * Le toggle n'apparaît que si firstDate est dernier jour de son mois, et offre
 * deux récurrences sémantiquement distinctes. Spéc :
 * `.scratch/26-07-26_monthly-by-date-mode/spec.md`.
 */
import { screen } from "@testing-library/svelte";
import type userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSubmitButton, makeMaster, renderForm } from "./_helpers/planningForm.js";

function getDateInputs() {
	const du = screen.getByRole("group", { name: /^From$/ });
	const au = screen.getByRole("group", { name: /^To$/ });
	return {
		firstDate: du.querySelector("input") as HTMLInputElement,
		lastDate: au.querySelector("input") as HTMLInputElement
	};
}

function getRecurrenceSelect() {
	const fieldset = screen.getByRole("group", { name: /recurrence type/i });
	return fieldset.querySelector("select") as HTMLSelectElement;
}

async function setDate(
	user: ReturnType<typeof userEvent.setup>,
	input: HTMLInputElement,
	value: string
) {
	await user.clear(input);
	await user.type(input, value);
	await user.tab();
}

// Fige « aujourd'hui » au 2026-01-01 pour que toutes les dates testées soient futures.
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-01-01T01:00:00") });
});
afterEach(() => {
	vi.useRealTimers();
});

// ====================================================================
// Visibilité du toggle
// ====================================================================

describe("Visibilité du toggle MONTHLY_BY_DATE", () => {
	it("firstDate dernier de mois → toggle visible", async () => {
		const { user } = renderForm();
		await user.selectOptions(getRecurrenceSelect(), "MONTHLY_BY_DATE");
		const { firstDate } = getDateInputs();
		await setDate(user, firstDate, "2026-07-31");

		// Les deux radios doivent être présentes (n'importe quel sélecteur : texte).
		// Locale de test = baseLocale "en" — libellés Paraglide anglais.
		expect(screen.getByText(/the 31 of each month/i)).toBeInTheDocument();
		expect(screen.getByText(/the last day of each month/i)).toBeInTheDocument();
	});

	it("firstDate non-dernier de mois → toggle caché", async () => {
		const { user } = renderForm();
		await user.selectOptions(getRecurrenceSelect(), "MONTHLY_BY_DATE");
		const { firstDate } = getDateInputs();
		await setDate(user, firstDate, "2026-07-15");

		expect(screen.queryByText(/the 15 of each month/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/the last day of each month/i)).not.toBeInTheDocument();
	});

	it("WEEKLY → toggle caché même si firstDate est dernier de mois", async () => {
		const { user } = renderForm();
		const { firstDate } = getDateInputs();
		await setDate(user, firstDate, "2026-07-31");

		expect(screen.queryByText(/the 31 of each month/i)).not.toBeInTheDocument();
	});

	it("firstDate=2026-02-28 (non-bis) → toggle visible (28 = dernier jour de fév)", async () => {
		const { user } = renderForm();
		await user.selectOptions(getRecurrenceSelect(), "MONTHLY_BY_DATE");
		const { firstDate } = getDateInputs();
		await setDate(user, firstDate, "2026-02-28");

		expect(screen.getByText(/the 28 of each month/i)).toBeInTheDocument();
		expect(screen.getByText(/the last day of each month/i)).toBeInTheDocument();
	});
});

// ====================================================================
// Défaut et bascule de mode
// ====================================================================

describe("Mode par défaut et bascule", () => {
	it("à l'ouverture : radio fixed-day cochée par défaut", async () => {
		const { user } = renderForm();
		await user.selectOptions(getRecurrenceSelect(), "MONTHLY_BY_DATE");
		const { firstDate } = getDateInputs();
		await setDate(user, firstDate, "2026-07-31");

		const radioFixed = screen.getByRole("radio", { name: /the 31 of each month/i });
		const radioLast = screen.getByRole("radio", { name: /the last day of each month/i });
		expect(radioFixed).toBeChecked();
		expect(radioLast).not.toBeChecked();
	});

	it("cliquer last-day recalcule les badges : Sep 30 et Nov 30 apparaissent", async () => {
		const { user, container } = renderForm();
		await user.selectOptions(getRecurrenceSelect(), "MONTHLY_BY_DATE");
		const { firstDate, lastDate } = getDateInputs();
		await setDate(user, firstDate, "2026-07-31");
		// Borner explicitement à Dec 31 pour avoir un cycle prédictif
		await setDate(user, lastDate, "2026-12-31");

		// fixed-day (défaut) : Sep et Nov sont skip (badge "EEE d MMM", locale en)
		expect(container.textContent).not.toContain("30 Sep");
		expect(container.textContent).not.toContain("30 Nov");

		// Bascule vers last-day
		await user.click(screen.getByRole("radio", { name: /the last day of each month/i }));

		// Les badges Sep 30 et Nov 30 apparaissent maintenant
		expect(container.textContent).toContain("30 Sep");
		expect(container.textContent).toContain("30 Nov");
		// Et le label récurrence change (distinct du libellé radio « each month »)
		expect(container.textContent).toMatch(/Last day of the month/);
	});
});

// ====================================================================
// Édition (seeding depuis master)
// ====================================================================

describe("Édition : seeding du mode", () => {
	it("master avec monthlyByDateMode=last-day → radio last-day cochée", async () => {
		const master = makeMaster({
			recurrence: {
				type: "MONTHLY_BY_DATE",
				firstDate: "2026-07-31",
				lastDate: "2026-12-31",
				monthlyByDateMode: "last-day"
			}
		});
		renderForm({ master });

		const radioFixed = screen.getByRole("radio", { name: /the 31 of each month/i });
		const radioLast = screen.getByRole("radio", { name: /the last day of each month/i });
		expect(radioLast).toBeChecked();
		expect(radioFixed).not.toBeChecked();
	});

	it("master sans monthlyByDateMode → radio fixed-day cochée (défaut)", async () => {
		const master = makeMaster({
			recurrence: {
				type: "MONTHLY_BY_DATE",
				firstDate: "2026-07-31",
				lastDate: "2026-12-31"
			}
		});
		renderForm({ master });

		const radioFixed = screen.getByRole("radio", { name: /the 31 of each month/i });
		const radioLast = screen.getByRole("radio", { name: /the last day of each month/i });
		expect(radioFixed).toBeChecked();
		expect(radioLast).not.toBeChecked();
	});
});

// ====================================================================
// Préservation implicite à travers changement de firstDate
// ====================================================================

describe("Préservation implicite du mode", () => {
	it("last-day sélectionné, firstDate → non-dernier-de-mois : toggle caché, mode préservé", async () => {
		const { user } = renderForm();
		await user.selectOptions(getRecurrenceSelect(), "MONTHLY_BY_DATE");
		const { firstDate } = getDateInputs();
		await setDate(user, firstDate, "2026-07-31");

		// Active last-day
		await user.click(screen.getByRole("radio", { name: /the last day of each month/i }));

		// Change firstDate vers un non-dernier-de-mois
		await setDate(user, firstDate, "2026-07-15");

		// Toggle caché
		expect(screen.queryByRole("radio", { name: /the 15 of each month/i })).not.toBeInTheDocument();
		expect(
			screen.queryByRole("radio", { name: /the last day of each month/i })
		).not.toBeInTheDocument();
	});

	it("last-day sélectionné, firstDate → autre dernier-de-mois : mode préservé", async () => {
		const { user } = renderForm();
		await user.selectOptions(getRecurrenceSelect(), "MONTHLY_BY_DATE");
		const { firstDate } = getDateInputs();
		await setDate(user, firstDate, "2026-07-31");

		// Active last-day
		await user.click(screen.getByRole("radio", { name: /the last day of each month/i }));

		// Change vers un autre dernier-de-mois
		await setDate(user, firstDate, "2026-08-31");

		// Le radio last-day reste coché
		const radioLast = screen.getByRole("radio", { name: /the last day of each month/i });
		expect(radioLast).toBeChecked();
	});
});

// ====================================================================
// Soumission : monthlyByDateMode présent dans la payload
// ====================================================================

describe("Soumission : monthlyByDateMode propagé", () => {
	it("mode last-day soumis avec monthlyByDateMode=last-day", async () => {
		const { user, onSubmit } = renderForm();
		await user.selectOptions(getRecurrenceSelect(), "MONTHLY_BY_DATE");
		const { firstDate } = getDateInputs();
		await setDate(user, firstDate, "2026-07-31");

		// Active last-day
		await user.click(screen.getByRole("radio", { name: /the last day of each month/i }));

		// Titre requis pour passer la validation
		const titreInput = screen
			.getByRole("group", { name: /planning title/i })
			.querySelector("input") as HTMLInputElement;
		await user.type(titreInput, "Planning test");

		await user.click(getSubmitButton());

		expect(onSubmit).toHaveBeenCalledTimes(1);
		const data = onSubmit.mock.calls[0][0];
		expect(data.recurrence.monthlyByDateMode).toBe("last-day");
	});

	it("mode fixed-day (défaut, jamais cliqué) → monthlyByDateMode absent de la payload", async () => {
		const { user, onSubmit } = renderForm();
		await user.selectOptions(getRecurrenceSelect(), "MONTHLY_BY_DATE");
		const { firstDate } = getDateInputs();
		await setDate(user, firstDate, "2026-07-31");

		// L'utilisateur ne touche pas au toggle — fixed-day est le défaut implicite
		const titreInput = screen
			.getByRole("group", { name: /planning title/i })
			.querySelector("input") as HTMLInputElement;
		await user.type(titreInput, "Planning test");

		await user.click(getSubmitButton());

		expect(onSubmit).toHaveBeenCalledTimes(1);
		const data = onSubmit.mock.calls[0][0];
		// monthlyByDateMode est absent (undefined) pour ne pas persisted inutilement.
		expect(data.recurrence.monthlyByDateMode).toBeUndefined();
	});
});
