// @vitest-environment happy-dom
/**
 * PlanningForm — Porte 5 (`removeTimeSlot`).
 *
 * Pattern « changement structurel » mais skip de la confirmation quand
 * `count === 0` (aucune combo active pour ce slot → action non destructive).
 *
 * Le bouton « Supprimer ce créneau » n'est rendu que si `timeSlots.length > 1`.
 * Pour compter les slots de façon robuste on cible « Modifier les horaires du
 * créneau », toujours présent (1 par slot).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, within } from '@testing-library/svelte';
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

/** Bouton « Modifier les horaires du créneau » : toujours rendu, 1 par slot. */
function slotCount() {
	return screen.getAllByRole('button', { name: /modifier les horaires du créneau/i }).length;
}

/** Boutons « Supprimer ce créneau » : rendus ssi `timeSlots.length > 1`. */
function deleteSlotButtons() {
	return screen.queryAllByRole('button', { name: /supprimer ce créneau/i });
}

// Fige « aujourd'hui » par défaut au 2026-01-01 (cycle master dans le futur).
// Le test 1 override via `vi.setSystemTime` pour placer « aujourd'hui » après
// `lastDate` et vider ainsi `allGeneratedDates` (cycle entièrement passé).
beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-01-01T01:00:00') });
});
afterEach(() => {
	vi.useRealTimers();
});

// ====================================================================
// Porte 5 — removeTimeSlot : skip confirmation quand count === 0
// ====================================================================

describe('PlanningForm — Porte 5 (removeTimeSlot)', () => {
	it('édition sans combos actives (cycle passé) → pas de modal, slot supprimé directement', async () => {
		// « Aujourd'hui » placé après lastDate (2026-06-30) : toutes les dates du cycle
		// sont filtrées par `d >= today` → `activeDateSlots = []` → `count === 0`
		// pour tous les slots. La porte 5 skip la confirmation (action non destructive).
		vi.setSystemTime(new Date('2026-07-01T01:00:00'));

		const { user } = renderForm({
			master: makeMaster({
				timeSlots: [
					{ id: 's1', startTime: '14:00', endTime: '18:00' },
					{ id: 's2', startTime: '08:00', endTime: '12:00' }
				],
				// Cycle entièrement passé par rapport au today fake (2026-07-01) :
				// toutes les dates du cycle sont filtrées par `d >= today` → `count === 0`.
				recurrence: { type: 'WEEKLY', firstDate: '2026-01-07', lastDate: '2026-06-30' }
			})
			// occurrences: [] — aucune occurrence persistée
		});

		// Gardien : 2 slots → 2 boutons « Supprimer ce créneau » visibles
		expect(deleteSlotButtons()).toHaveLength(2);
		expect(slotCount()).toBe(2);

		// Cliquer « Supprimer ce créneau » sur le 2e slot (s2)
		await user.click(deleteSlotButtons()[1]);

		// Pas de ConfirmModal
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

		// s2 supprimé : on repasse à 1 slot → tous les boutons « Supprimer » disparaissent
		expect(deleteSlotButtons()).toHaveLength(0);
		expect(slotCount()).toBe(1);
		// Les horaires de s2 (08:00 – 12:00) ne sont plus affichés
		expect(screen.queryByText(/08:00\s*–\s*12:00/)).not.toBeInTheDocument();
	});

	it('édition avec N combos actives → modal avec message compté, puis slot supprimé', async () => {
		// Cycle au futur proche : 3 dates hebdo (2026-01-07, 14, 21) → `count = 3` pour s1.
		// On seed 3 occurrences actives pour s1 sur ces dates (à des fins de réalisme,
		// le compte est porté par le produit cartésien `activeDateSlots`).
		const { user } = renderForm({
			master: makeMaster({
				timeSlots: [
					{ id: 's1', startTime: '14:00', endTime: '18:00' },
					{ id: 's2', startTime: '08:00', endTime: '12:00' }
				],
				recurrence: { type: 'WEEKLY', firstDate: '2026-01-07', lastDate: '2026-01-21' }
			}),
			occurrences: [
				makeOccurrence({ id: 'o1', date: '2026-01-07', slotId: 's1' }),
				makeOccurrence({ id: 'o2', date: '2026-01-14', slotId: 's1' }),
				makeOccurrence({ id: 'o3', date: '2026-01-21', slotId: 's1' })
			]
		});

		// Gardien : 2 slots présents
		expect(deleteSlotButtons()).toHaveLength(2);

		// Cliquer « Supprimer ce créneau » sur le 1er slot (s1)
		await user.click(deleteSlotButtons()[0]);

		// La ConfirmModal s'ouvre (titre « Supprimer ce créneau »)
		const dialog = await screen.findByRole('dialog');
		expect(dialog).toHaveTextContent(/supprimer ce créneau/i);
		// Message avec le compte exact (3 combos actives → « Les 3 occurrences… »)
		expect(dialog).toHaveTextContent(/les 3 occurrences de ce créneau/i);

		// Cliquer « Supprimer » dans la modal → s1 supprimé
		await user.click(within(dialog).getByRole('button', { name: /^supprimer$/i }));

		// La modal se ferme
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		// s1 supprimé : on repasse à 1 slot (s2), boutons delete masqués
		expect(deleteSlotButtons()).toHaveLength(0);
		expect(slotCount()).toBe(1);
		// Les horaires de s1 ne sont plus affichées
		expect(screen.queryByText(/14:00\s*–\s*18:00/)).not.toBeInTheDocument();
	});

	it('création → suppression directe, pas de modal (comportement inchangé)', async () => {
		const { user } = renderForm();

		// Gardien : 1 slot par défaut (s1) → bouton delete masqué (timeSlots.length <= 1)
		expect(deleteSlotButtons()).toHaveLength(0);
		expect(slotCount()).toBe(1);

		// Ajouter un 2e slot via le modal « Ajouter un créneau » (draft pré-rempli
		// avec les horaires du dernier slot, il suffit de cliquer « Appliquer »)
		await user.click(screen.getByRole('button', { name: /ajouter un créneau/i }));
		await user.click(screen.getByRole('button', { name: /^appliquer$/i }));

		// Maintenant 2 slots → 2 boutons delete visibles
		expect(deleteSlotButtons()).toHaveLength(2);
		expect(slotCount()).toBe(2);

		// Cliquer « Supprimer ce créneau » sur le 2e slot
		await user.click(deleteSlotButtons()[1]);

		// Pas de modal (création = suppression directe)
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

		// Le 2e slot est supprimé : on revient à 1 slot, boutons delete masqués
		expect(deleteSlotButtons()).toHaveLength(0);
		expect(slotCount()).toBe(1);
	});
});
