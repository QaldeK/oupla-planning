// @vitest-environment happy-dom
/**
 * PlanningForm — comportements réactifs.
 *
 * Vérifie : auto-clear des erreurs après correction, auto-calc de `lastDate`
 * selon `recurrenceType` + respect du flag `lastDateWasManuallySet`, et cohérence
 * de la cascade `allGeneratedDates → allDateSlots → occurrenceTargets`.
 */
import { screen } from "@testing-library/svelte";
import type userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { countBadges, getSubmitButton, makeMaster, renderForm } from "./_helpers/planningForm.js";

// Les inputs firstDate/lastDate n'ont pas de <label> associé : leur fieldset porte la legend
// (« Du » / « Au ») qui sert de nom accessible. On descend depuis le fieldset jusqu'à l'input.
function getDateInputs() {
	const du = screen.getByRole("group", { name: /^Du$/ });
	const au = screen.getByRole("group", { name: /^Au$/ });
	return {
		firstDate: du.querySelector("input") as HTMLInputElement,
		lastDate: au.querySelector("input") as HTMLInputElement
	};
}

// Le select de récurrence est englobé dans un fieldset « Type de récurrence » (legend).
function getRecurrenceSelect() {
	const fieldset = screen.getByRole("group", { name: /type de récurrence/i });
	return fieldset.querySelector("select") as HTMLSelectElement;
}

// Saisit une valeur dans un input type="date" et déclenche le onchange (qui fire au blur).
// userEvent.type déclenche l'event input à chaque touche mais pas change ; tab() blur.
async function setDate(
	user: ReturnType<typeof userEvent.setup>,
	input: HTMLInputElement,
	value: string
) {
	await user.clear(input);
	await user.type(input, value);
	await user.tab();
}

// Fige « aujourd'hui » au 2026-01-01 pour tous les filtres du composant
// (dates passées, validation des DateSlots futurs, auto-calc lastDate).
// On fake uniquement Date — on laisse setTimeout/microtasks réels pour ne pas casser
// le scheduling interne de Svelte 5 (effects, onMount).
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-01-01T01:00:00") });
});
afterEach(() => {
	vi.useRealTimers();
});

// ====================================================================
// A — Auto-clear des erreurs de validation (story 29)
// ====================================================================

describe("A — Auto-clear des erreurs de validation", () => {
	it("titre : remplir le titre après un submit échoué efface l'erreur visuelle", async () => {
		const { user } = renderForm();
		const titreFieldset = screen.getByRole("group", { name: /titre du planning/i });
		const titreInput = titreFieldset.querySelector("input") as HTMLInputElement;

		// Submit échoué → input-error apparaît
		await user.click(getSubmitButton());
		expect(titreInput.className).toContain("input-error");

		// Corriger le titre → l'erreur s'efface réactivement
		await user.type(titreInput, "Mon planning");
		expect(titreInput.className).not.toContain("input-error");
	});

	it("dates (CUSTOM) : ajouter une date future après un submit échoué efface l'erreur visuelle", async () => {
		const { user, container } = renderForm();

		// Titre valide pour passer cette porte et atteindre la validation dates
		const titreInput = screen
			.getByRole("group", { name: /titre du planning/i })
			.querySelector("input") as HTMLInputElement;
		await user.type(titreInput, "Planning CUSTOM");

		// Passer en CUSTOM (pas de firstDate/lastDate, dates libres via MultiDatePicker)
		await user.selectOptions(getRecurrenceSelect(), "CUSTOM");

		// La zone CUSTOM est rendue
		expect(screen.getByText(/dates libres/i)).toBeInTheDocument();

		// Submit échoué : aucun date sélectionnée → validationErrors.dates = true
		await user.click(getSubmitButton());
		const ringErrorAvant = container.querySelectorAll(".ring-error").length;
		expect(ringErrorAvant).toBeGreaterThan(0);

		// Sélectionner une date future via le calendrier (aria-label = format PPP fr).
		// La date est clickable car dans le mois courant (janvier 2026 avec fake time).
		const dateButton = screen.getByRole("button", { name: "10 janvier 2026" });
		await user.click(dateButton);

		// L'erreur visuelle disparaît : au moins une DateSlot future est maintenant active
		const ringErrorApres = container.querySelectorAll(".ring-error").length;
		expect(ringErrorApres).toBeLessThan(ringErrorAvant);
	});

	it("responses : recocher un type après un submit échoué efface l'erreur visuelle", async () => {
		const { user } = renderForm();

		// Titre valide pour atteindre la porte responses
		const titreInput = screen
			.getByRole("group", { name: /titre du planning/i })
			.querySelector("input") as HTMLInputElement;
		await user.type(titreInput, "Planning");

		// Décocher les 4 response types manuellement
		for (const label of [/^présent$/i, /^si besoin$/i, /^peut-être$/i, /^absent$/i]) {
			await user.click(screen.getByRole("checkbox", { name: label }));
		}

		// Submit → validationErrors.responses=true, ring-error sur la zone « Réponses possibles »
		await user.click(getSubmitButton());
		const responsesFieldset = screen.getByRole("group", { name: /réponses possibles/i });
		expect(responsesFieldset.querySelector(".ring-error")).not.toBeNull();

		// Recocher un type → auto-clear responses
		await user.click(screen.getByRole("checkbox", { name: /^présent$/i }));
		expect(responsesFieldset.querySelector(".ring-error")).toBeNull();
	});

	it("tasks : ajouter une tâche après un submit échoué efface l'erreur visuelle", async () => {
		const { user } = renderForm();

		// Titre valide
		const titreInput = screen
			.getByRole("group", { name: /titre du planning/i })
			.querySelector("input") as HTMLInputElement;
		await user.type(titreInput, "Planning");

		// Décocher allowResponses → config invalide (0 tâche, 0 responses)
		const allowCheckbox = screen.getByRole("checkbox", {
			name: /activer le formulaire de présence/i
		});
		await user.click(allowCheckbox);

		await user.click(getSubmitButton());

		// La zone tasks porte le h4 « Liste des tâches ». Son parent direct reçoit ring-error.
		const tasksHeader = screen.getByRole("heading", { name: /liste des tâches/i, level: 4 });
		const tasksZone = tasksHeader.parentElement as HTMLElement;
		expect(tasksZone.className).toContain("ring-error");

		// Ajouter une tâche
		const newTaskInput = screen.getByPlaceholderText(/nom de la tâche/i);
		await user.type(newTaskInput, "Buvette");
		await user.click(screen.getByRole("button", { name: /^ajouter la tâche$/i }));

		// L'erreur tasks s'efface (effet auto-clear : tasks.length > 0)
		expect(tasksZone.className).not.toContain("ring-error");
	});

	it("hasAttemptedSubmit : avant le premier submit, corriger un champ invalide n'affiche pas d'erreur", async () => {
		const { user } = renderForm();

		// Sans submit préalable, remplir le titre ne déclenche aucun affichage d'erreur.
		// L'effet d'auto-clear court-circuite tant que hasAttemptedSubmit reste false.
		const titreInput = screen
			.getByRole("group", { name: /titre du planning/i })
			.querySelector("input") as HTMLInputElement;
		await user.type(titreInput, "X");

		expect(document.querySelectorAll(".ring-error").length).toBe(0);
		expect(document.querySelectorAll(".input-error").length).toBe(0);
	});
});

// ====================================================================
// B — Auto-calc de lastDate + respect du flag (stories 30-31)
// ====================================================================

describe("B — Auto-calc de lastDate", () => {
	// Périodes par défaut de l'auto-calc, figées par la spec (§ Out of Scope) :
	// DAILY = +1 semaine, WEEKLY/BIWEEKLY = +6 mois, MONTHLY_* = +12 mois.
	it.each([
		["DAILY", "2026-01-14"],
		["WEEKLY", "2026-07-07"],
		["BIWEEKLY", "2026-07-07"],
		["MONTHLY_BY_DATE", "2027-01-07"],
		["MONTHLY_BY_DAY", "2027-01-07"]
	])(
		"en création, recurrenceType=%s auto-calc lastDate depuis firstDate=2026-01-07",
		async (recType, expectedLastDate) => {
			const { user } = renderForm();
			await user.selectOptions(getRecurrenceSelect(), recType);
			const { firstDate, lastDate } = getDateInputs();
			await setDate(user, firstDate, "2026-01-07");
			expect(lastDate.value).toBe(expectedLastDate);
		}
	);

	it("après édition manuelle de lastDate, changer firstDate ne re-déclenche pas l'auto-calc", async () => {
		const { user } = renderForm();
		const { firstDate, lastDate } = getDateInputs();

		// 1. Auto-calc initial (WEEKLY = +6 mois)
		await setDate(user, firstDate, "2026-01-07");
		expect(lastDate.value).toBe("2026-07-07");

		// 2. Édition manuelle de lastDate → flag lastDateWasManuallySet passe à true
		await setDate(user, lastDate, "2026-12-25");

		// 3. Changer firstDate → lastDate préservée (l'effet court-circuite)
		await setDate(user, firstDate, "2026-03-04");
		expect(lastDate.value).toBe("2026-12-25");
	});

	it("changer recurrenceType reset le flag, permettant un re-auto-calc au prochain changement de firstDate", async () => {
		const { user } = renderForm();
		const { firstDate, lastDate } = getDateInputs();

		// 1. Auto-calc initial (WEEKLY)
		await setDate(user, firstDate, "2026-01-07");
		expect(lastDate.value).toBe("2026-07-07");

		// 2. Édition manuelle → flag=true
		await setDate(user, lastDate, "2026-12-25");

		// 3. Changer firstDate ne recalcule pas (flag true)
		await setDate(user, firstDate, "2026-02-04");
		expect(lastDate.value).toBe("2026-12-25");

		// 4. Changer recurrenceType → applyRecurrenceTypeChange reset le flag (création)
		await user.selectOptions(getRecurrenceSelect(), "DAILY");

		// 5. Au prochain changement de firstDate, lastDate se re-auto-calc (DAILY = +1 semaine)
		await setDate(user, firstDate, "2026-03-04");
		expect(lastDate.value).toBe("2026-03-11");
	});

	it("en édition, l'auto-calc ne se déclenche jamais (préservation des bornes du master)", async () => {
		const { user } = renderForm({
			master: makeMaster({
				recurrence: { type: "WEEKLY", firstDate: "2026-01-07", lastDate: "2026-06-30" }
			})
		});
		const { firstDate, lastDate } = getDateInputs();

		// Le master porte firstDate=2026-01-07, lastDate=2026-06-30
		expect(firstDate.value).toBe("2026-01-07");
		expect(lastDate.value).toBe("2026-06-30");

		// Changer firstDate : lastDate doit rester la borne du master
		await setDate(user, firstDate, "2026-02-04");
		expect(lastDate.value).toBe("2026-06-30");
	});
});

// ====================================================================
// C — Cohérence réactive (cascade allGeneratedDates → allDateSlots → occurrenceTargets)
// ====================================================================

describe("C — Cohérence réactive (cascade)", () => {
	it("changer firstDate recalcule la cascade de badges", async () => {
		const { user, container } = renderForm();
		const { firstDate } = getDateInputs();

		// Cycle initial : WEEKLY à partir du 7 janvier 2026 (auto-calc lastDate = +6 mois)
		await setDate(user, firstDate, "2026-01-07");
		expect(container.textContent).toContain("mer. 7 janv.");
		const beforeCount = countBadges(container);
		expect(beforeCount).toBeGreaterThan(0);

		// Décaler firstDate d'un mois → la cascade ré-affiche les nouvelles dates
		// (la firstDate elle-même change de badge, ce qui prouve le recalcul réactif)
		await setDate(user, firstDate, "2026-02-04");
		expect(container.textContent).toContain("mer. 4 févr.");
		expect(container.textContent).not.toContain("mer. 7 janv.");

		// Le compte peut varier de ±1 selon le nombre exact de semaines dans la période
		// (on ne le fige pas, on valide juste que la cascade a bien re-dérivé).
		const afterCount = countBadges(container);
		expect(afterCount).toBeGreaterThan(0);
	});

	it("changer recurrenceType recalcule toute la cascade (WEEKLY → MONTHLY_BY_DATE génère moins de badges sur la même période)", async () => {
		const { user, container } = renderForm();
		const { firstDate } = getDateInputs();

		// WEEKLY : auto-calc lastDate = +6 mois → ~26 badges
		await setDate(user, firstDate, "2026-01-07");
		const weekly = countBadges(container);
		expect(weekly).toBe(26);

		// Passer en MONTHLY_BY_DATE : lastDate re-auto-calculée à +12 mois (flag reset),
		// et la granularité est mensuelle → moins de dates sur la période.
		await user.selectOptions(getRecurrenceSelect(), "MONTHLY_BY_DATE");
		const monthly = countBadges(container);
		expect(monthly).toBeGreaterThan(0);
		// Weekly = 26 dates sur 6 mois ; Monthly = 13 dates sur 12 mois
		expect(monthly).toBeLessThan(weekly);
	});

	it("ajouter un slot recalcule le produit cartésien (toutes les dates × 2 slots)", async () => {
		const { user, container } = renderForm();
		const { firstDate } = getDateInputs();

		// Une seule semaine de dates pour garder le test rapide et lisible
		await setDate(user, firstDate, "2026-01-07");
		const before = countBadges(container);

		// Ouvrir le modal « Ajouter un créneau »
		await user.click(screen.getByRole("button", { name: /ajouter un créneau/i }));

		// Le modal porte deux fieldsets « Début » et « Fin » (inputs type="time").
		// On descend depuis la legend (inputs sans <label> associé).
		const debutInput = screen
			.getByRole("group", { name: /début/i })
			.querySelector("input") as HTMLInputElement;
		const finInput = screen
			.getByRole("group", { name: /fin/i })
			.querySelector("input") as HTMLInputElement;
		await user.clear(debutInput);
		await user.type(debutInput, "08:00");
		await user.clear(finInput);
		await user.type(finInput, "12:00");

		// Appliquer crée le slot en création (pas de confirmation)
		await user.click(screen.getByRole("button", { name: /^appliquer$/i }));

		const after = countBadges(container);
		// Produit cartésien : chaque date × 2 slots → badge count double
		expect(after).toBe(before * 2);
	});
});
