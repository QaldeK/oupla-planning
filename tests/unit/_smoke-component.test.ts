/**
 * Smoke test — valide la chaîne @testing-library/svelte + happy-dom + jest-dom.
 *
 * Ce fichier n'est pas un test fonctionnel : il vérifie juste que la machinerie
 * fonctionne (montage d'un composant Svelte, requête DOM, matchers jest-dom).
 * Il peut être supprimé une fois la confiance établie, ou conservé comme
 * canari en cas de regression du setup.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import ConfirmModal from '$lib/components/ui/ConfirmModal.svelte';

describe('Smoke test — chaîne @testing-library/svelte', () => {
	it('monte un composant Svelte et lit son rendu', () => {
		render(ConfirmModal, {
			props: {
				open: true,
				onClose: () => {},
				onConfirm: () => {},
				title: 'Titre test',
				message: 'Message visible'
			}
		});

		expect(screen.getByText('Message visible')).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Titre test' })).toBeInTheDocument();
	});

	it('simule un clic utilisateur et vérifie le callback', async () => {
		const user = userEvent.setup();
		let cancelled = false;

		render(ConfirmModal, {
			props: {
				open: true,
				onClose: () => {
					cancelled = true;
				},
				onConfirm: () => {},
				title: 'T',
				message: 'M',
				cancelLabel: 'Annuler'
			}
		});

		await user.click(screen.getByRole('button', { name: /annuler/i }));
		expect(cancelled).toBe(true);
	});
});
