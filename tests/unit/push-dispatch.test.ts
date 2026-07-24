import { describe, it, expect, vi } from 'vitest';
import path from 'path';

// Runner isolé (pas de PocketBase nécessaire) pour dispatchPushForEvent.
// Les fonctions de domaine (buildPushTitle, buildPushBody) et l'adaptateur
// d'envoi (sendPushNotification) sont injectées — pas de require() natif
// vers des modules .js (voir ADR-0007).

const HOOKS_DIR = path.resolve(__dirname, '../../', 'pocketbase/pb_hooks');
(globalThis as any).__hooks = HOOKS_DIR;

const { dispatchPushForEvent } = await import('../../pocketbase/pb_hooks/push-dispatch.js');

// ============================================================================
// Mocks minimaux — pas besoin de mockRecord complet, juste getString pour
// les champs lus (participantToken sur master, tasks sur occ).
// ============================================================================

function mkMaster(token = 'abc123'): any {
	return { getString: (f: string) => (f === 'participantToken' ? token : '') };
}

function mkOcc(tasks: any[] = []): any {
	return { getString: (f: string) => (f === 'tasks' ? JSON.stringify(tasks) : '') };
}

function mkRecipient({ userId, push = true }: { userId: string; push?: boolean }) {
	return { userId, push, response: null, tasks: [] };
}

function mkUser(id: string): any {
	return { get: (f: string) => (f === 'id' ? id : null) };
}

// ============================================================================
// Tests
// ============================================================================

describe('dispatchPushForEvent', () => {
	it('envoie un push à chaque destinataire push=true et retourne le compte', () => {
		const sent = vi.fn();
		const result = dispatchPushForEvent({} as any, {
			event: { type: 'reminder', reminderValue: 3 },
			master: mkMaster('tok'),
			occ: mkOcc(),
			recipients: [
				mkRecipient({ userId: 'u1' }),
				mkRecipient({ userId: 'u2', push: false }),
				mkRecipient({ userId: 'u3' })
			],
			resolveUser: (uid: string) => mkUser(uid),
			buildPushTitle: () => 'Rappel — Planning',
			buildPushBody: () => 'body',
			sendPushNotification: sent
		});

		expect(sent).toHaveBeenCalledTimes(2);
		expect(result).toBe(2);
	});

	it("passe l'url construite depuis participantToken à sendPushNotification", () => {
		const sent = vi.fn();
		dispatchPushForEvent({} as any, {
			event: { type: 'reminder', reminderValue: 1 },
			master: mkMaster('XYZ789'),
			occ: mkOcc(),
			recipients: [mkRecipient({ userId: 'u1' })],
			resolveUser: () => mkUser('u1'),
			buildPushTitle: () => 'T',
			buildPushBody: () => 'B',
			sendPushNotification: sent
		});

		expect(sent).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'T', 'B', '/p/XYZ789');
	});

	it('saute les destinataires dont resolveUser retourne null', () => {
		const sent = vi.fn();
		const result = dispatchPushForEvent({} as any, {
			event: { type: 'reminder', reminderValue: 1 },
			master: mkMaster(),
			occ: mkOcc(),
			recipients: [
				mkRecipient({ userId: 'u1' }),
				mkRecipient({ userId: 'u_deleted' }),
				mkRecipient({ userId: 'u3' })
			],
			resolveUser: (uid: string) => (uid === 'u_deleted' ? null : mkUser(uid)),
			buildPushTitle: () => 'T',
			buildPushBody: () => 'B',
			sendPushNotification: sent
		});

		expect(sent).toHaveBeenCalledTimes(2);
		expect(result).toBe(2);
	});

	it('continue la boucle si sendPushNotification throw', () => {
		const sent = vi
			.fn()
			.mockImplementationOnce(() => {
				throw new Error('HTTP timeout');
			})
			.mockImplementationOnce(() => undefined);

		const result = dispatchPushForEvent({} as any, {
			event: { type: 'reminder', reminderValue: 1 },
			master: mkMaster(),
			occ: mkOcc(),
			recipients: [mkRecipient({ userId: 'u1' }), mkRecipient({ userId: 'u2' })],
			resolveUser: (uid: string) => mkUser(uid),
			buildPushTitle: () => 'T',
			buildPushBody: () => 'B',
			sendPushNotification: sent
		});

		// Le premier envoi échoue (non compté), le second réussit (comté).
		expect(sent).toHaveBeenCalledTimes(2);
		expect(result).toBe(1);
	});

	it('passe occTasks (parsé depuis occ) à buildPushBody', () => {
		const bodyFn = vi.fn(() => 'body');
		const tasks = [{ id: 't1', name: 'Accueil', type: 'beforeEvent' }];

		dispatchPushForEvent({} as any, {
			event: { type: 'reminder', reminderValue: 1 },
			master: mkMaster(),
			occ: mkOcc(tasks),
			recipients: [mkRecipient({ userId: 'u1' })],
			resolveUser: () => mkUser('u1'),
			buildPushTitle: () => 'T',
			buildPushBody: bodyFn,
			sendPushNotification: vi.fn()
		});

		expect(bodyFn).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.anything(),
			tasks
		);
	});

	it("retourne 0 si aucun destinataire n'a push=true", () => {
		const sent = vi.fn();
		const result = dispatchPushForEvent({} as any, {
			event: { type: 'reminder', reminderValue: 1 },
			master: mkMaster(),
			occ: mkOcc(),
			recipients: [
				mkRecipient({ userId: 'u1', push: false }),
				mkRecipient({ userId: 'u2', push: false })
			],
			resolveUser: () => mkUser('x'),
			buildPushTitle: () => 'T',
			buildPushBody: () => 'B',
			sendPushNotification: sent
		});

		expect(sent).not.toHaveBeenCalled();
		expect(result).toBe(0);
	});

	it("passe l'app reçu en paramètre à sendPushNotification", () => {
		const sent = vi.fn();
		const fakeApp = { id: 'pocketbase-instance' };

		dispatchPushForEvent(fakeApp as any, {
			event: { type: 'reminder', reminderValue: 1 },
			master: mkMaster(),
			occ: mkOcc(),
			recipients: [mkRecipient({ userId: 'u1' })],
			resolveUser: () => mkUser('u1'),
			buildPushTitle: () => 'T',
			buildPushBody: () => 'B',
			sendPushNotification: sent
		});

		expect(sent.mock.calls[0][0]).toBe(fakeApp);
	});
});
