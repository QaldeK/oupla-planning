/**
 * PlanningForm — submit sans `window.confirm`.
 *
 * Garantit qu'aucune dialog native n'est appelée au submit, en mode édition,
 * même quand des dates avec données sortent du cycle. Les portes just-in-time
 * (`ConfirmModal` maison) couvrent les chemins destructeurs ; le submit reste
 * un simple commit.
 *
 * @vitest-environment happy-dom
 */

import { render, screen, within } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { format, parse } from "date-fns";
import { fr } from "date-fns/locale";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanningFormData } from "$lib/components/PlanningForm.svelte";
import PlanningForm from "$lib/components/PlanningForm.svelte";
import type { PlanningMaster } from "$lib/types/planning.types";

// --- Helpers dates ---

/** YYYY-MM-DD à +N jours depuis aujourd'hui. */
function futureISO(offsetDays: number): string {
	const d = new Date();
	d.setDate(d.getDate() + offsetDays);
	return d.toISOString().slice(0, 10);
}

/** Formate une date YYYY-MM-DD comme le composant (EEE d MMM, locale fr). */
function formatDateFr(iso: string): string {
	return format(parse(iso, "yyyy-MM-dd", new Date()), "EEE d MMM", { locale: fr });
}

// --- Fixture master minimal valide (mode édition) ---

function makeMaster(overrides: Partial<PlanningMaster> = {}): PlanningMaster {
	const firstDate = futureISO(7);
	const lastDate = futureISO(70);
	return {
		id: "m1",
		title: "Planning test",
		defaultStartTime: "14:00",
		defaultEndTime: "18:00",
		timeSlots: [{ id: "s1", startTime: "14:00", endTime: "18:00" }],
		minPresentRequired: 1,
		allowResponses: true,
		recurrence: { type: "WEEKLY", firstDate, lastDate },
		tasks: [],
		participants: [],
		created: new Date().toISOString(),
		updated: new Date().toISOString(),
		...overrides
	};
}

// --- Spy window.confirm ---
// happy-dom n'expose pas `window.confirm` par défaut : on installe un mock qui
// fail son propre appel (assertion `not.toHaveBeenCalled()`). Si le code
// réintroduit un `window.confirm`, le mock renvoie `true` (pour ne pas bloquer
// le flux au cas où) mais l'assertion échoue.
let confirmSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
	confirmSpy = vi.fn(() => true);
	(window as unknown as { confirm: typeof confirmSpy }).confirm = confirmSpy;
});

afterEach(() => {
	vi.restoreAllMocks();
	// Nettoyage : retire la propriété qu'on a installée sur window.
	delete (window as unknown as { confirm?: unknown }).confirm;
});

describe("PlanningForm — retrait du window.confirm au submit (ticket 03)", () => {
	it("porte 4 (requestDisableSlot) puis submit : ConfirmModal affichée, pas de window.confirm, submit aboutit", async () => {
		const targetDate = futureISO(7); // 1ère date du cycle hebdo
		const onSubmit = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();

		render(PlanningForm, {
			props: {
				master: makeMaster(),
				onSubmit: onSubmit as (data: PlanningFormData) => Promise<void>,
				datesWithData: [targetDate]
			}
		});

		// 1. Ouvre le popover de la DateSlot pour `targetDate`.
		const dateSlotButton = screen.getByRole("button", {
			name: new RegExp(formatDateFr(targetDate), "i")
		});
		await user.click(dateSlotButton);

		// 2. Clic sur « Désactiver » dans le popover → déclenche la porte 4.
		//    À ce stade, la ConfirmModal n'est pas encore ouverte : un seul bouton
		//    « Désactiver » est présent (celui du popover).
		await user.click(screen.getByRole("button", { name: /désactiver/i }));

		// 3. La ConfirmModal s'ouvre (porte 4, confirmLabel « Désactiver »).
		const dialog = await screen.findByRole("dialog");
		expect(dialog).toHaveTextContent(/des participant/i);
		await user.click(within(dialog).getByRole("button", { name: /désactiver/i }));

		// 4. Submit.
		await user.click(screen.getByRole("button", { name: /enregistrer les modifications/i }));

		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(confirmSpy).not.toHaveBeenCalled();
	});

	it("porte 2 (requestDateChange) en excluant une date avec données : ConfirmModal affichée, pas de window.confirm, submit aboutit", async () => {
		const initialFirstDate = futureISO(7); // dans datesWithData
		const newFirstDate = futureISO(14); // exclut initialFirstDate du cycle
		const onSubmit = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();

		render(PlanningForm, {
			props: {
				master: makeMaster(),
				onSubmit: onSubmit as (data: PlanningFormData) => Promise<void>,
				datesWithData: [initialFirstDate]
			}
		});

		// 1. Change la borne `Du` (firstDate) via l'input date. Le nouvel intervalle
		//    exclut `initialFirstDate` qui a des données → la porte 2 s'ouvre.
		const firstDateInput = screen.getByDisplayValue(initialFirstDate) as HTMLInputElement;
		await user.clear(firstDateInput);
		await user.type(firstDateInput, newFirstDate);
		await user.tab(); // blur → onchange → requestDateChange

		// 2. ConfirmModal porte 2 (titre « Modifier la période », confirmLabel « Modifier »).
		const dialog = await screen.findByRole("dialog");
		expect(dialog).toHaveTextContent(/modifier la période/i);
		await user.click(within(dialog).getByRole("button", { name: /modifier/i }));

		// 3. Submit.
		await user.click(screen.getByRole("button", { name: /enregistrer les modifications/i }));

		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(confirmSpy).not.toHaveBeenCalled();
	});

	it("cas pathologique : date avec données hors cycle sans porte ouverte → submit sans window.confirm", async () => {
		// La date avec données n'a jamais été dans le cycle master : aucune porte
		// n'a eu l'occasion de se déclencher. Avant le ticket, le `window.confirm`
		// global au submitattrapait ce cas. Il doit désormais aboutir sans dialog native.
		const onSubmit = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();

		render(PlanningForm, {
			props: {
				master: makeMaster(),
				onSubmit: onSubmit as (data: PlanningFormData) => Promise<void>,
				datesWithData: ["2024-01-15"] // date passée, hors cycle hebdo
			}
		});

		await user.click(screen.getByRole("button", { name: /enregistrer les modifications/i }));

		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(confirmSpy).not.toHaveBeenCalled();
	});
});
