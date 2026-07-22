import { render } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import PlanningForm from '$lib/components/PlanningForm.svelte';
import type { PlanningMaster, PlanningOccurrence } from '$lib/types/planning.types';

/**
 * Monte PlanningForm avec un `onSubmit` mocké et applique `novalidate` sur le
 * `<form>` pour court-circuiter la validation HTML5 native (qui bloquerait
 * `handleSubmit` sur les champs `required` vides en happy-dom).
 */
export function renderForm(props: Record<string, unknown> = {}) {
	const onSubmit = vi.fn().mockResolvedValue(undefined);
	const user = userEvent.setup();
	const result = render(PlanningForm, { props: { onSubmit, ...props } });
	document.querySelector('form')?.setAttribute('novalidate', 'true');
	return { ...result, user, onSubmit };
}

/** Factory de `PlanningMaster` valide avec des valeurs par défaut cohérentes. */
export function makeMaster(overrides: Partial<PlanningMaster> = {}): PlanningMaster {
	return {
		id: 'm1',
		title: 'Planning test',
		defaultStartTime: '14:00',
		defaultEndTime: '18:00',
		timeSlots: [{ id: 's1', startTime: '14:00', endTime: '18:00' }],
		minPresentRequired: 1,
		allowResponses: true,
		availableResponseTypes: ['present', 'if_needed', 'maybe', 'absent'],
		recurrence: { type: 'WEEKLY', firstDate: '2026-08-05', lastDate: '2026-09-30' },
		tasks: [],
		participants: [],
		created: '2025-01-01T00:00:00Z',
		updated: '2025-01-01T00:00:00Z',
		...overrides
	};
}

/** Factory de `PlanningOccurrence` valide avec des valeurs par défaut cohérentes. */
export function makeOccurrence(overrides: Partial<PlanningOccurrence> = {}): PlanningOccurrence {
	return {
		id: `occ-${Math.random().toString(36).slice(2, 8)}`,
		master: 'm1',
		date: '2026-08-12',
		startTime: '14:00',
		endTime: '18:00',
		slotId: 's1',
		responses: [],
		comments: [],
		isConfirmed: false,
		isCanceled: false,
		created: '2025-01-01T00:00:00Z',
		updated: '2025-01-01T00:00:00Z',
		...overrides
	};
}

/** Retourne le bouton submit du formulaire. */
export function getSubmitButton(): HTMLButtonElement {
	return document.querySelector('button[type=submit]') as HTMLButtonElement;
}

/** Compte les badges de DateSlot rendus (clé : attribut `data-slot-ui` sur un <button>). */
export function countBadges(container: HTMLElement): number {
	return container.querySelectorAll('button[data-slot-ui]').length;
}
