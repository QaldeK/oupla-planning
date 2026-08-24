// @vitest-environment happy-dom
/**
 * PlanningForm — décoche manuelle des `availableResponseTypes`.
 *
 * Garantit que l'utilisateur peut décocher tous les types sans qu'ils se
 * recochent automatiquement, et que le submit est bloqué avec toast si
 * `allowResponses` est activé sans aucun type sélectionné.
 */

import { screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RESPONSE_TYPE_LABELS } from "$lib/constants";
import type { ResponseType } from "$lib/types/planning.types";
import { getSubmitButton, renderForm } from "./_helpers/planningForm.js";

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

import { toast } from "svelte-sonner";

/** Récupère la checkbox d'un type de réponse par sa clé ResponseType. */
function getResponseTypeCheckbox(type: ResponseType) {
	const label = RESPONSE_TYPE_LABELS[type]();
	return screen.getByRole("checkbox", { name: new RegExp(label, "i") }) as HTMLInputElement;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("PlanningForm — availableResponseTypes behavior (ticket 04)", () => {
	it("décocher tous les types un par un → ils restent décochés", async () => {
		const { user } = renderForm();

		// En création, tous les types sont cochés par défaut (allowResponses=true)
		const types = Object.keys(RESPONSE_TYPE_LABELS) as ResponseType[];
		for (const type of types) {
			const cb = getResponseTypeCheckbox(type);
			expect(cb.checked).toBe(true);
		}

		// Décocher un par un
		for (const type of types) {
			await user.click(getResponseTypeCheckbox(type));
		}

		// Vérifier qu'aucun n'est coché (l'ancien $effect ne les réinjecte plus)
		for (const type of types) {
			expect(getResponseTypeCheckbox(type).checked).toBe(false);
		}
	});

	it("submit avec allowResponses=true et 0 types → toast d'erreur + bloqué", async () => {
		const { user, onSubmit } = renderForm();

		// Remplir le titre pour ne pas être bloqué par la validation #2
		const titreFieldset = screen.getByRole("group", { name: /planning title/i });
		const titreInput = titreFieldset.querySelector("input") as HTMLInputElement;
		await user.type(titreInput, "Planning test");

		// Décocher tous les types
		for (const type of Object.keys(RESPONSE_TYPE_LABELS) as ResponseType[]) {
			await user.click(getResponseTypeCheckbox(type));
		}

		// Contourner la validation HTML5 native
		const form = document.querySelector("form")!;
		form.noValidate = true;

		await user.click(getSubmitButton());

		expect(onSubmit).not.toHaveBeenCalled();
		expect(toast.error).toHaveBeenCalledWith("Response types required", expect.anything());
	});

	it("création fraîche → tous les types sont cochés initialement", () => {
		renderForm();

		const types = Object.keys(RESPONSE_TYPE_LABELS) as ResponseType[];
		expect(types).toHaveLength(4);

		for (const type of types) {
			const cb = getResponseTypeCheckbox(type);
			expect(cb.checked).toBe(true);
		}
	});

	it("édition avec master ayant [present, absent] → seuls ces 2 types sont cochés", () => {
		renderForm({
			master: {
				id: "m1",
				title: "Test Planning",
				description: "",
				defaultStartTime: "14:00",
				defaultEndTime: "18:00",
				timeSlots: [{ id: "s1", startTime: "14:00", endTime: "18:00" }],
				recurrence: { type: "WEEKLY", firstDate: "2026-01-07", lastDate: "2026-06-30" },
				allowResponses: true,
				availableResponseTypes: ["present", "absent"],
				tasks: [],
				participants: [],
				minPresentRequired: 1
			} as any
		});

		expect(getResponseTypeCheckbox("present").checked).toBe(true);
		expect(getResponseTypeCheckbox("absent").checked).toBe(true);
		expect(getResponseTypeCheckbox("if_needed").checked).toBe(false);
		expect(getResponseTypeCheckbox("maybe").checked).toBe(false);
	});
});
