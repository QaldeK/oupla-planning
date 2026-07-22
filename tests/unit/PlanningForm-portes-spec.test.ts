// @vitest-environment happy-dom
/**
 * PlanningForm — 6 portes de confirmation just-in-time (spécification).
 *
 * Deux patterns documentés inline au-dessus du bloc `// --- Portes de confirmation` :
 *  - **changement structurel** : confirment en édition indépendamment des données
 *    (Portes 1, 5 si occurrences actives, 6)
 *  - **suppression de données** : ne confirment que si une date avec données
 *    participant est affectée (Portes 2, 3, 4)
 *
 * La Porte 5 est couverte par `PlanningForm-portes.test.ts` et n'est pas re-testée ici.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { format, parse } from 'date-fns';
import { fr } from 'date-fns/locale';
import { renderForm, makeMaster, makeOccurrence } from './_helpers/planningForm.js';

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

/** Formate une date YYYY-MM-DD comme le fait le badge (EEE d MMM, locale fr). */
function formatDateFr(iso: string): string {
	return format(parse(iso, 'yyyy-MM-dd', new Date()), 'EEE d MMM', { locale: fr });
}

/** Sélecteur badge pour une date donnée (cible le bouton du popover). */
function getDateBadge(iso: string) {
	return screen.getByRole('button', {
		name: new RegExp(formatDateFr(iso).replace(/\./g, '\\.'), 'i')
	});
}

// Le select de récurrence est englobé dans un fieldset « Type de récurrence »
// (legend), qui sert de nom accessible. Le <select> n'a pas de <label> direct.
function getRecurrenceSelect(): HTMLSelectElement {
	const fieldset = screen.getByRole('group', { name: /type de récurrence/i });
	return fieldset.querySelector('select') as HTMLSelectElement;
}

// Les inputs firstDate/lastDate n'ont pas de <label> associé : leur fieldset
// porte la legend (« Du » / « Au ») qui sert de nom accessible.
function getDateInput(which: 'Du' | 'Au'): HTMLInputElement {
	const fieldset = screen.getByRole('group', { name: which === 'Du' ? /^Du$/ : /^Au$/ });
	return fieldset.querySelector('input[type="date"]') as HTMLInputElement;
}

/** Saisit une valeur dans un input type="date" et déclenche le onchange. */
async function setDate(
	user: ReturnType<typeof userEvent.setup>,
	input: HTMLInputElement,
	value: string
) {
	await user.clear(input);
	await user.type(input, value);
	await user.tab();
}

/**
 * Variante pour la porte 2 « sans exclusion » : on évite le pattern
 * `clear → type` qui passerait par une valeur vide intermédiaire (pendant le
 * `clear`) et déclencherait la porte 2 avec `newCycle=[]` → toutes les
 * datesWithData deviendraient atRisk → modal intempestive. Ici on sélectionne
 * tout le contenu puis on type par-dessus, ce qui garde un cycle cohérent à
 * chaque keystroke (userEvent remplace la sélection en place).
 */
async function setDateOverwrite(
	user: ReturnType<typeof userEvent.setup>,
	input: HTMLInputElement,
	value: string
) {
	await user.click(input);
	// Sélectionne tout le contenu current puis type la nouvelle valeur :
	// userEvent remplace la sélection en un seul flux de keystrokes.
	await user.type(input, value, {
		initialSelectionStart: 0,
		initialSelectionEnd: input.value.length
	});
	await user.tab();
}

// Fige « aujourd'hui » au 2026-07-21 — postérieur à toutes les dates de test
// (cycle master en août 2026+). Toutes les dates de test sont donc futures,
// ce qui garantit qu'elles ne sont pas filtrées par `d >= todayStr`.
beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-07-21T01:00:00') });
});
afterEach(() => {
	vi.useRealTimers();
});

// ====================================================================
// Porte 1 — requestRecurrenceTypeChange (changement structurel)
// Confirme en édition seulement ; en création, apply direct.
// ====================================================================

describe('PlanningForm — Porte 1 (requestRecurrenceTypeChange)', () => {
	it('édition : changer le type de récurrence ouvre la ConfirmModal', async () => {
		const { user, onSubmit } = renderForm({ master: makeMaster() });

		await user.selectOptions(getRecurrenceSelect(), 'DAILY');

		// ConfirmModal porte 1 (titre « Changer le type de récurrence »).
		const dialog = await screen.findByRole('dialog');
		expect(dialog).toHaveTextContent(/changer le type de récurrence/i);
		// Pas de submit déclenché par la porte elle-même.
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it('création : changer le type de récurrence ne demande pas confirmation', async () => {
		const { user } = renderForm();

		await user.selectOptions(getRecurrenceSelect(), 'DAILY');

		// Pas de ConfirmModal en création (aucune occurrence à risker).
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		// Le select reflète la nouvelle valeur (changement direct).
		expect(getRecurrenceSelect().value).toBe('DAILY');
	});
});

// ====================================================================
// Porte 2 — requestDateChange (suppression de données)
// Confirme seulement si une date avec données sort du nouveau cycle.
// ====================================================================

describe('PlanningForm — Porte 2 (requestDateChange)', () => {
	it('édition : exclure une date avec données ouvre la ConfirmModal', async () => {
		const { user } = renderForm({
			master: makeMaster({
				// DAILY sur tout août → 2026-08-15 est dans le cycle initial.
				recurrence: { type: 'DAILY', firstDate: '2026-08-01', lastDate: '2026-08-31' }
			}),
			datesWithData: ['2026-08-15']
		});

		// firstDate → 2026-08-16 : 2026-08-15 sort du nouveau cycle (atRisk).
		await setDate(user, getDateInput('Du'), '2026-08-16');

		// ConfirmModal porte 2 (titre « Modifier la période »).
		const dialog = await screen.findByRole('dialog');
		expect(dialog).toHaveTextContent(/modifier la période/i);
	});

	it('édition : changer une borne sans exclure de date avec données ne confirme pas', async () => {
		const { user } = renderForm({
			master: makeMaster({
				recurrence: { type: 'DAILY', firstDate: '2026-08-01', lastDate: '2026-08-31' }
			}),
			datesWithData: ['2026-08-15']
		});

		// firstDate → 2026-08-05 : 2026-08-15 reste dans le cycle (pas atRisk).
		// On utilise `setDateOverwrite` pour ne pas passer par une valeur vide
		// intermédiaire (clear) qui déclencherait la porte 2 intempestivement.
		await setDateOverwrite(user, getDateInput('Du'), '2026-08-05');

		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		// L'input reflète la nouvelle valeur (changement direct).
		expect(getDateInput('Du').value).toBe('2026-08-05');
	});

	it('CUSTOM : les inputs firstDate/lastDate ne sont pas rendus', () => {
		renderForm({
			master: makeMaster({
				recurrence: { type: 'CUSTOM' }
			})
		});

		// En CUSTOM, le bloc `{#if recurrenceType !== 'CUSTOM'}` masque les
		// fieldsets Du/Au : pas de cycle généré, dates libres via MultiDatePicker.
		expect(screen.queryByRole('group', { name: /^Du$/ })).not.toBeInTheDocument();
		expect(screen.queryByRole('group', { name: /^Au$/ })).not.toBeInTheDocument();
	});
});

// ====================================================================
// Porte 3 — requestRemoveManualDate (suppression de données)
// Confirme seulement si la date manuelle supprimée a des données.
// ====================================================================

describe('PlanningForm — Porte 3 (requestRemoveManualDate)', () => {
	it('édition : supprimer une date manuelle avec données ouvre la ConfirmModal', async () => {
		const { user } = renderForm({
			master: makeMaster({
				// Cycle court mercurial 05/12/19 août. La date seeded 2026-08-22
				// (un samedi) est hors-cycle → atterrira dans manualDates via
				// le seeding one-shot, ce qui déclenche l'affichage du bouton
				// « Supprimer » dans le popover mono-slot.
				recurrence: { type: 'WEEKLY', firstDate: '2026-08-05', lastDate: '2026-08-19' }
			}),
			datesWithData: ['2026-08-22'],
			occurrences: [makeOccurrence({ date: '2026-08-22' })]
		});

		// Ouvrir le popover du badge 2026-08-22 (date manuelle hors-cycle).
		await user.click(getDateBadge('2026-08-22'));

		// Le popover mono-slot + manualDate affiche « Supprimer » (et non
		// « Désactiver »). À ce stade, un seul bouton « Supprimer » existe
		// (la ConfirmModal n'est pas encore ouverte).
		await user.click(screen.getByRole('button', { name: /^supprimer$/i }));

		// ConfirmModal porte 3 (titre « Supprimer la date »). Le popover reste
		// ouvert (la porte 3 avec-données n'appelle pas closePopover), mais
		// `findByRole('dialog')` cible le Modal qui porte role="dialog".
		const dialog = await screen.findByRole('dialog');
		expect(dialog).toHaveTextContent(/supprimer la date/i);
	});

	it('édition : supprimer une date manuelle sans données ne confirme pas', async () => {
		const { user } = renderForm({
			master: makeMaster({
				recurrence: { type: 'WEEKLY', firstDate: '2026-08-05', lastDate: '2026-08-19' }
			}),
			datesWithData: [],
			occurrences: [makeOccurrence({ date: '2026-08-22' })]
		});

		await user.click(getDateBadge('2026-08-22'));
		await user.click(screen.getByRole('button', { name: /^supprimer$/i }));

		// Pas de modal : suppression directe (removeManualDate + closePopover).
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		// Le badge a disparu du DOM (manualDates ne contient plus 2026-08-22).
		expect(
			screen.queryByRole('button', {
				name: new RegExp(formatDateFr('2026-08-22').replace(/\./g, '\\.'), 'i')
			})
		).not.toBeInTheDocument();
	});
});

// ====================================================================
// Porte 4 — requestDisableSlot (suppression de données)
// Confirme seulement si la DateSlot désactivée a des données.
// ====================================================================

describe('PlanningForm — Porte 4 (requestDisableSlot)', () => {
	it('édition : désactiver une DateSlot avec données ouvre la ConfirmModal', async () => {
		// 2026-08-12 = mercredi, dans le cycle hebdo démarrant 2026-08-05.
		const { user } = renderForm({
			master: makeMaster(),
			datesWithData: ['2026-08-12']
		});

		await user.click(getDateBadge('2026-08-12'));

		// En mono-slot + date in-cycle (non-manual), le popover affiche
		// « Désactiver » (la DateSlot est sélectionnée).
		await user.click(screen.getByRole('button', { name: /^désactiver$/i }));

		// ConfirmModal porte 4 (titre « Retirer cette date »).
		const dialog = await screen.findByRole('dialog');
		expect(dialog).toHaveTextContent(/retirer cette date/i);
	});

	it('édition : désactiver une DateSlot sans données ne confirme pas', async () => {
		const { user } = renderForm({
			master: makeMaster(),
			datesWithData: []
		});

		await user.click(getDateBadge('2026-08-12'));
		await user.click(screen.getByRole('button', { name: /^désactiver$/i }));

		// Pas de modal : désactivation directe (setSlotEnabled + closePopover).
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

		// Rouvrir le popover de la même DateSlot : le bouton est maintenant
		// « Réactiver » (la DateSlot est désactivée → `isSelected = false`).
		await user.click(getDateBadge('2026-08-12'));
		expect(screen.getByRole('button', { name: /^réactiver$/i })).toBeInTheDocument();
	});
});

// Porte 5 — removeTimeSlot : couverte par `tests/unit/PlanningForm-portes.test.ts`
// (ticket 05). Pattern "changement structurel" avec skip quand `count === 0`
// (aucune DateSlot active pour ce slot → action non destructive).

// ====================================================================
// Porte 6 — applySlotEdit (changement structurel)
// Confirme en édition seulement (propagation aux occurrences seedées).
// ====================================================================

describe('PlanningForm — Porte 6 (applySlotEdit)', () => {
	it('édition : appliquer de nouveaux horaires ouvre la ConfirmModal de propagation', async () => {
		const { user } = renderForm({ master: makeMaster() });

		// Ouvre le modal d'édition du slot (bouton pencil sur la ligne du slot).
		await user.click(screen.getByRole('button', { name: /modifier les horaires du créneau/i }));

		// Change les horaires via le preset « Matinée » (08:00 – 12:00), plus
		// robuste que la saisie libre dans un input type="time" sous happy-dom.
		await user.click(screen.getByRole('button', { name: /matinée/i }));

		// « Appliquer » dans le modal slot → en mode edit + master :
		// closeSlotModal() puis openConfirm() (porte 6).
		await user.click(screen.getByRole('button', { name: /^appliquer$/i }));

		// ConfirmModal porte 6 (titre « Appliquer les nouveaux horaires »).
		const dialog = await screen.findByRole('dialog');
		expect(dialog).toHaveTextContent(/appliquer les nouveaux horaires/i);
	});

	it('création : appliquer de nouveaux horaires mute le slot directement', async () => {
		const { user } = renderForm();

		await user.click(screen.getByRole('button', { name: /modifier les horaires du créneau/i }));
		await user.click(screen.getByRole('button', { name: /matinée/i }));
		await user.click(screen.getByRole('button', { name: /^appliquer$/i }));

		// Pas de ConfirmModal en création (mute directe du slot).
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

		// Le slot affiche maintenant « 08:00 – 12:00 » (en-dash, espaces).
		expect(screen.getByText(/08:00\s*–\s*12:00/)).toBeInTheDocument();
	});
});
