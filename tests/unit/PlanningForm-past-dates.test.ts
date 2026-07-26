// @vitest-environment happy-dom
/**
 * PlanningForm — Gestion des dates passées au picker et à l'affichage.
 *
 * Vérifie : refus des dates passées par le picker, masquage des badges passés
 * (sans filtrage du state interne, pour éviter un soft-delete au save), et
 * indicateur textuel discret du compte de dates masquées.
 */

import { screen } from "@testing-library/svelte";
import type userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
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

/** Bascule le <select> « Type de récurrence » sur la valeur donnée. */
async function selectRecurrence(user: ReturnType<typeof userEvent.setup>, value: string) {
	const fieldset = screen.getByRole("group", { name: /type de récurrence/i });
	const select = fieldset.querySelector("select") as HTMLSelectElement;
	await user.selectOptions(select, value);
}

// Fige « aujourd'hui » au 2026-07-21. On fake uniquement Date — on laisse
// setTimeout/microtasks réels pour ne pas casser le scheduling interne de
// Svelte 5 (effects, onMount) et userEvent.
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-07-21T01:00:00") });
});
afterEach(() => {
	vi.useRealTimers();
});

// ====================================================================
// A — MultiDatePicker refuse les dates passées (minDate)
// ====================================================================

describe("A — Picker refuse les dates passées", () => {
	it("les jours passés du calendrier sont disabled et un clic n'ajoute pas la date", async () => {
		const { user, container } = renderForm();

		// Passer en CUSTOM (le picker est toujours visible dans ce mode)
		await selectRecurrence(user, "CUSTOM");
		expect(screen.getByText(/dates libres/i)).toBeInTheDocument();

		// Le calendrier affiche par défaut le mois courant (juillet 2026).
		// « 10 juillet 2026 » est dans le passé (today = 2026-07-21) → disabled.
		const pastDay = screen.getByRole("button", { name: "10 juillet 2026" });
		expect(pastDay.hasAttribute("disabled")).toBe(true);
		// Le marqueur visuel de désactivation est posé par MultiDatePicker
		expect(pastDay.className).toContain("cursor-not-allowed");
		expect(pastDay.className).toContain("opacity-30");

		// Cliquer le jour passé : userEvent respecte `disabled` → pas d'event.
		// On tente quand même pour vérifier qu'aucun badge n'apparaît.
		await user.click(pastDay);

		// Aucun badge de date ne doit être rendu (manualDates reste vide).
		// Les badges portent data-slot-ui (cf. dateSlotBadge snippet).
		expect(container.querySelectorAll("button[data-slot-ui]")).toHaveLength(0);

		// Sanity check : un jour futur reste enabled et son clic ajoute bien un badge.
		const futureDay = screen.getByRole("button", { name: "25 juillet 2026" });
		expect(futureDay.hasAttribute("disabled")).toBe(false);
		await user.click(futureDay);
		// Maintenant 1 badge (DateSlot futur) est rendu.
		expect(container.querySelectorAll("button[data-slot-ui]")).toHaveLength(1);
	});
});

// ====================================================================
// B — Filtre d'affichage : badges passés masqués (state préservé)
// ====================================================================

describe("B — Badges passés masqués au rendu", () => {
	it("en édition avec occurrences passées seeded, seuls les badges futures sont rendus", async () => {
		const { container } = renderForm({
			master: makeMaster(),
			occurrences: [
				makeOccurrence({ id: "occ-past", date: "2025-12-25", slotId: "s1" }),
				makeOccurrence({ id: "occ-fut", date: "2026-08-12", slotId: "s1" })
			]
		});

		// Section de sélection rendue (mode récurrent avec cycle futur).
		expect(screen.getByText(/sélection des dates/i)).toBeInTheDocument();

		// Le badge future "mer. 12 août" doit être affiché.
		expect(container.textContent).toContain("12 août");
		// Le badge passé "jeu. 25 déc." doit être masqué au rendu.
		expect(container.textContent).not.toContain("25 déc.");
	});
});

// ====================================================================
// C — Indicateur « X date(s) passée(s) »
// ====================================================================

describe("C — Indicateur dates passées masquées", () => {
	it("3 occurrences passées + 1 future → l'indicateur affiche le pluriel", async () => {
		const { container } = renderForm({
			master: makeMaster(),
			occurrences: [
				makeOccurrence({ id: "occ-p1", date: "2025-10-15", slotId: "s1" }),
				makeOccurrence({ id: "occ-p2", date: "2025-11-20", slotId: "s1" }),
				makeOccurrence({ id: "occ-p3", date: "2025-12-25", slotId: "s1" }),
				makeOccurrence({ id: "occ-fut", date: "2026-08-12", slotId: "s1" })
			]
		});

		// L'indicateur discret doit mentionner les 3 dates passées au pluriel.
		expect(container.textContent).toContain(
			"3 dates passées, consultables depuis la page archives."
		);
	});

	it("1 occurrence passée + 1 future → l'indicateur affiche le singulier", async () => {
		const { container } = renderForm({
			master: makeMaster(),
			occurrences: [
				makeOccurrence({ id: "occ-past", date: "2025-12-25", slotId: "s1" }),
				makeOccurrence({ id: "occ-fut", date: "2026-08-12", slotId: "s1" })
			]
		});

		expect(container.textContent).toContain("1 date passée, consultables depuis la page archives.");
	});

	it("aucune occurrence passée → l'indicateur n'est pas rendu", async () => {
		const { container } = renderForm({
			master: makeMaster(),
			occurrences: [makeOccurrence({ id: "occ-fut", date: "2026-08-12", slotId: "s1" })]
		});

		expect(container.textContent).not.toContain("consultables depuis la page archives");
	});
});

// ====================================================================
// D — Pas de soft-delete involontaire au save (state préservé)
// ====================================================================

describe("D — Submit préserve les occurrences passées (pas de soft-delete)", () => {
	it("soumettre en édition avec occurrences passées → occurrenceTargets contient passé ET futur", async () => {
		const { user, onSubmit } = renderForm({
			master: makeMaster(),
			occurrences: [
				makeOccurrence({ id: "occ-past", date: "2025-12-25", slotId: "s1" }),
				makeOccurrence({ id: "occ-fut", date: "2026-08-12", slotId: "s1" })
			]
		});

		// Soumettre sans interaction : la config master est déjà valide (titre,
		// allowResponses + response types, cycle futur).
		await user.click(getSubmitButton());

		expect(onSubmit).toHaveBeenCalledTimes(1);

		// Récupère le PlanningFormData passé à onSubmit et vérifie que les
		// occurrenceTargets contiennent bien la date passée ET la future.
		// C'est le critère critique : si le filtre d'affichage fuyait dans le state,
		// la date passée serait absente et le service la soft-deletterait au save.
		const submittedData = onSubmit.mock.calls[0][0];
		const submittedDates = (submittedData.occurrenceTargets as Array<{ date: string }>).map(
			(t) => t.date
		);
		expect(submittedDates).toContain("2025-12-25");
		expect(submittedDates).toContain("2026-08-12");

		// L'ID de l'occurrence passée doit être préservé (critique pour la
		// réconciliation côté service : sans id, l'occurrence serait recréée
		// plutôt qu'updatée, cassant l'historique des réponses).
		const pastTarget = (
			submittedData.occurrenceTargets as Array<{ date: string; id?: string }>
		).find((t) => t.date === "2025-12-25");
		expect(pastTarget?.id).toBe("occ-past");
	});
});
