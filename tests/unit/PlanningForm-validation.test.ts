/**
 * PlanningForm — règles de validation au submit.
 *
 * Comportement observable uniquement (toast émis + onSubmit non appelé). Les
 * toasts sont mockés via `vi.mock('svelte-sonner')` pour ne pas dépendre du
 * `<Toaster>` (portals + transitions difficiles en happy-dom).
 *
 * Tests skippés : chaque skip documente pourquoi la validation n'est pas
 * déclenchable via le DOM sans modifier le composant.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/svelte';
import { type UserEvent } from '@testing-library/user-event';
import { format, addDays } from 'date-fns';
import { renderForm } from './_helpers/planningForm.js';

// Mock svelte-sonner : on intercepte les appels à toast.* pour asserter sur le titre.
// La factory doit exporter tout ce que PlanningForm.svelte importe (uniquement `toast`).
vi.mock('svelte-sonner', () => ({
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

// Importé APRÈS vi.mock (hoisté par vitest) pour récupérer le mock.
import { toast } from 'svelte-sonner';

/** Remplit le champ titre (legend "Titre du planning"). */
async function fillTitle(user: UserEvent, value: string) {
	const fieldset = screen.getByRole('group', { name: /titre du planning/i });
	const input = within(fieldset).getByRole('textbox') as HTMLInputElement;
	await user.clear(input);
	if (value) await user.type(input, value);
}

/** Récupère l'<input type="date"> par sa legend ("Du" ou "Au"). */
function getDateInput(which: 'Du' | 'Au'): HTMLInputElement {
	const fieldset = screen.getByRole('group', { name: which === 'Du' ? /^Du$/ : /^Au$/ });
	return fieldset.querySelector('input[type="date"]') as HTMLInputElement;
}

/**
 * Saisit une paire firstDate/lastDate explicite. Contourne l'auto-calc de lastDate
 * en saisissant lastDate après firstDate (ce qui pose `lastDateWasManuallySet = true`
 * côté composant et empêche tout recalcul ultérieur).
 */
async function fillDateRange(user: UserEvent, firstDateStr: string, lastDateStr: string) {
	const firstInput = getDateInput('Du');
	await user.clear(firstInput);
	await user.type(firstInput, firstDateStr);
	await user.tab();

	const lastInput = getDateInput('Au');
	await user.clear(lastInput);
	await user.type(lastInput, lastDateStr);
	await user.tab();
}

/** Bascule le <select> "Type de récurrence" sur la valeur donnée. */
async function selectRecurrence(user: UserEvent, value: string) {
	const fieldset = screen.getByRole('group', { name: /type de récurrence/i });
	const select = within(fieldset).getByRole('combobox') as HTMLSelectElement;
	await user.selectOptions(select, value);
}

/**
 * Soumet le form. On ajoute `novalidate` avant le clic pour court-circuiter la
 * validation HTML5 native (champs `required` sur titre/date), qu'on ne veut pas
 * tester ici — la cible est `handleSubmit`, qui applique ses propres validations.
 * Sans `novalidate`, un champ `required` vide bloque l'événement `submit` et
 * `handleSubmit` n'est jamais appelé (test silencieusement vert mais sans valeur).
 */
async function submit(user: UserEvent) {
	const form = document.querySelector('form') as HTMLFormElement;
	form.setAttribute('novalidate', '');
	const btn = screen.getByRole('button', { name: /créer le planning/i });
	await user.click(btn);
}

describe('PlanningForm — handleSubmit validation rules', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// --- Ordonné comme dans handleSubmit (lignes 1005-1110) ---

	it('#1 limite > 100 DateSlots futurs → toast "Trop de créneaux planifiés" + onSubmit non appelé', async () => {
		const { user, onSubmit } = renderForm();
		await fillTitle(user, 'Planning test');

		// DAILY + firstDate=aujourd'hui + lastDate=+200j génère > 100 dates futures.
		// `allGeneratedDates` cappe à 100, donc on ajoute un 2ème slot pour dépasser
		// la limite : 100 dates × 2 slots = 200 DateSlots > 100.
		await selectRecurrence(user, 'DAILY');
		const today = format(new Date(), 'yyyy-MM-dd');
		const farFuture = format(addDays(new Date(), 200), 'yyyy-MM-dd');
		await fillDateRange(user, today, farFuture);

		// Ajoute un 2ème slot via le modal (bouton "Ajouter un créneau" → modal create
		// pré-rempli avec 14:00-18:00 → bouton "Appliquer").
		await user.click(screen.getByRole('button', { name: /ajouter un créneau/i }));
		await user.click(screen.getByRole('button', { name: /^appliquer$/i }));

		await submit(user);

		expect(onSubmit).not.toHaveBeenCalled();
		expect(toast.error).toHaveBeenCalledWith('Trop de créneaux planifiés', expect.anything());
	});

	it('#2 titre vide → toast "Le titre est requis" + onSubmit non appelé', async () => {
		const { user, onSubmit } = renderForm();
		// Titre laissé vide par défaut ; les autres champs ne sont pas évalués
		// (la validation #2 s'exécute avant #3..#11).
		await submit(user);

		expect(onSubmit).not.toHaveBeenCalled();
		expect(toast.error).toHaveBeenCalledWith('Le titre est requis');
	});

	// SKIP #3 (0 slot) : impossible via l'UI. Le bouton "Supprimer ce créneau"
	// n'est rendu que si `timeSlots.length > 1` (PlanningForm.svelte:1504), empêchant
	// de descendre à 0 slot. Aucun chemin DOM ne produit `timeSlots.length === 0`.
	it.skip('#3 0 slot défini → toast "Aucun créneau défini" (non déclenchable via UI)', () => {});

	// SKIP #4 (slot incomplet) : `applySlotEdit` (PlanningForm.svelte:925-934) rejette
	// elle-même un slot incomplet (toast + return) sans jamais muter `timeSlots`.
	// Aucun chemin DOM ne produit un slot avec startTime/endTime vide.
	it.skip('#4 slot incomplet → toast "Créneau incomplet" (non déclenchable via UI)', () => {});

	it('#5 tâche en cours de saisie → toast "Tâche en cours de saisie" + onSubmit non appelé', async () => {
		const { user, onSubmit } = renderForm();
		await fillTitle(user, 'Planning test');

		// Saisir un nom de tâche sans cliquer "Ajouter la tâche".
		const taskInput = screen.getByPlaceholderText('Nom de la tâche') as HTMLInputElement;
		await user.type(taskInput, 'Tâche ébauchée');

		await submit(user);

		expect(onSubmit).not.toHaveBeenCalled();
		expect(toast.error).toHaveBeenCalledWith('Tâche en cours de saisie', expect.anything());
	});

	it('#6 modal d\'édition de slot ouvert → toast "Créneau en cours de modification" + onSubmit non appelé', async () => {
		const { user, onSubmit } = renderForm();
		await fillTitle(user, 'Planning test');

		// Ouvre le modal d'édition du slot existant (bouton pencil aria-label).
		const editBtn = screen.getByRole('button', {
			name: /modifier les horaires du créneau/i
		});
		await user.click(editBtn);

		await submit(user);

		expect(onSubmit).not.toHaveBeenCalled();
		expect(toast.error).toHaveBeenCalledWith('Créneau en cours de modification', expect.anything());
	});

	it('#7 ni tâches ni allowResponses → toast "Configuration incomplète" + onSubmit non appelé', async () => {
		const { user, onSubmit } = renderForm();
		await fillTitle(user, 'Planning test');

		// Décocher "Activer le formulaire de présence" (coché par défaut en création).
		const checkbox = screen.getByRole('checkbox', {
			name: /activer le formulaire de présence/i
		});
		await user.click(checkbox);

		// Ne pas créer de tâche : hasTasks=false, hasResponsesEnabled=false → #7.
		await submit(user);

		expect(onSubmit).not.toHaveBeenCalled();
		expect(toast.error).toHaveBeenCalledWith('Configuration incomplète', expect.anything());
	});

	it('#8 allowResponses=true avec 0 types → toast "Réponses possibles requises" + onSubmit non appelé', async () => {
		const { user, onSubmit } = renderForm();
		await fillTitle(user, 'Planning test');

		// Décocher tous les response types manuellement
		for (const label of [/présent/i, /si besoin/i, /peut-être/i, /absent/i]) {
			await user.click(screen.getByRole('checkbox', { name: label }));
		}

		await submit(user);

		expect(onSubmit).not.toHaveBeenCalled();
		expect(toast.error).toHaveBeenCalledWith('Réponses possibles requises', expect.anything());
	});

	it('#9 0 DateSlot actif (CUSTOM sans date) → toast "Aucune date sélectionnée" + onSubmit non appelé', async () => {
		const { user, onSubmit } = renderForm();
		await fillTitle(user, 'Planning test');

		// Passer en mode CUSTOM : aucun date n'est sélectionnée par défaut
		// (manualDates=[], donc allDateSlots=[], donc activeDateSlots=[]).
		await selectRecurrence(user, 'CUSTOM');

		await submit(user);

		expect(onSubmit).not.toHaveBeenCalled();
		expect(toast.error).toHaveBeenCalledWith('Aucune date sélectionnée', expect.anything());
	});

	// SKIP #10 (DateSlots toutes passées) : non déclenchable de façon déterministe via
	// le DOM en création pure (le MultiDatePicker filtre les dates passées côté UI).
	// En édition en revanche, le seeding d'occurrences passées (qui finissent dans
	// `manualDates` hors-cycle) permet de constituer un `activeDateSlots` entièrement
	// passé. On fake « aujourd'hui » après la borne `lastDate` du master pour vider
	// `allGeneratedDates`, puis on seed une occurrence passée — la DateSlot passée
	// devient la seule DateSlot active → `hasFutureActiveDateSlot = false` → toast « Dates passées ».
	it('#10 toutes DateSlots passées (édition, cycle passé) → toast "Dates passées" + onSubmit non appelé', async () => {
		// Figer « aujourd'hui » après la borne supérieure du master pour vider
		// `allGeneratedDates` (filtre `d >= today`). On ne fake QUE Date pour préserver
		// le scheduler Svelte 5 / userEvent.
		vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-07-01T01:00:00') });
		try {
			const { user, onSubmit } = renderForm({
				master: {
					id: 'm1',
					title: 'Planning test',
					defaultStartTime: '14:00',
					defaultEndTime: '18:00',
					timeSlots: [{ id: 's1', startTime: '14:00', endTime: '18:00' }],
					minPresentRequired: 1,
					allowResponses: true,
					availableResponseTypes: ['present', 'if_needed', 'maybe', 'absent'],
					recurrence: { type: 'WEEKLY', firstDate: '2026-01-07', lastDate: '2026-06-30' },
					tasks: [],
					participants: [],
					created: '2025-01-01T00:00:00Z',
					updated: '2025-01-01T00:00:00Z'
				} as any,
				// Une seule occurrence passée → seeded dans `manualDates` (hors-cycle car
				// `allGeneratedDates` est vide avec today=2026-07-01 > lastDate=2026-06-30).
				// `activeDateSlots` contient donc 1 DateSlot passée et 0 future → #10.
				occurrences: [
					{
						id: 'occ-past',
						master: 'm1',
						date: '2026-01-07',
						startTime: '14:00',
						endTime: '18:00',
						slotId: 's1',
						responses: [],
						comments: [],
						isConfirmed: false,
						isCanceled: false,
						created: '2025-01-01T00:00:00Z',
						updated: '2025-01-01T00:00:00Z'
					}
				]
			});

			// En édition, le libellé du bouton submit diffère (« Enregistrer... » vs
			// « Créer le planning »). On cible par type pour rester robuste au mode.
			const form = document.querySelector('form') as HTMLFormElement;
			form.setAttribute('novalidate', '');
			const submitBtn = document.querySelector('button[type=submit]') as HTMLButtonElement;
			await user.click(submitBtn);

			expect(onSubmit).not.toHaveBeenCalled();
			expect(toast.error).toHaveBeenCalledWith('Dates passées', expect.anything());
		} finally {
			vi.useRealTimers();
		}
	});

	// SKIP #11 (récurrence non-CUSTOM sans firstDate/lastDate) : l'$effect d'auto-calc
	// (PlanningForm.svelte:516-542) remplit `lastDate` dès que `firstDate` est saisie
	// en création. Pour déclencher #11 il faudrait `firstDate=''` ET `activeDateSlots`
	// non-vide (sinon #9 s'exécute d'abord) — état injoignable sans modifier le code.
	it.skip('#11 mode récurrent non-CUSTOM sans firstDate/lastDate → toast "Les dates de début et de fin sont requises" (non déclenchable via UI)', () => {});
});
