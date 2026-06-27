import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const notifyUtils = await import('../../pocketbase/pb_hooks/notify-utils.js');
const {
	formatDateFR,
	sendPushNotification,
	sendGroupedEmail,
	groupByNotificationType,
	processReminders,
	processMissingParticipants
} = notifyUtils;

function mockLogger() {
	return {
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn()
	};
}

function mockApp(overrides = {}) {
	const logger = mockLogger();
	return {
		logger: vi.fn(() => logger),
		save: vi.fn(),
		settings: vi.fn(() => ({
			meta: {
				senderAddress: 'noreply@oupla.net',
				senderName: 'Oupla Planning'
			}
		})),
		newMailClient: vi.fn(() => ({ send: vi.fn() })),
		_logger: logger,
		...overrides
	};
}

function mockUser(overrides: { id?: string; email?: string; push_subscription?: any } = {}) {
	const data: Record<string, any> = {
		push_subscription: overrides.push_subscription ?? null,
		...overrides
	};
	return {
		get: vi.fn((key: string) => data[key]),
		getId: vi.fn(() => overrides.id ?? 'user-1'),
		email: vi.fn(() => overrides.email ?? 'user@test.com'),
		set: vi.fn((key: string, val: any) => {
			data[key] = val;
		})
	};
}

function mockParticipant(overrides: Record<string, any> = {}) {
	return {
		getInt: vi.fn((key: string) => overrides[key] ?? 0),
		getBool: vi.fn((key: string) => overrides[key] ?? false),
		get: vi.fn((key: string) => overrides[key])
	};
}

function mockOcc(overrides: Record<string, any> = {}) {
	return {
		get: vi.fn((key: string) => overrides[key] ?? null),
		getString: vi.fn((key: string) => overrides[key] ?? ''),
		getInt: vi.fn((key: string) => overrides[key] ?? 0)
	};
}

function createMailerMessageMock() {
	const calls: any[] = [];
	class MockMailerMessage {
		constructor(options: any) {
			calls.push(options);
			return options;
		}
	}
	return { MockMailerMessage, calls };
}

describe('formatDateFR', () => {
	it('formats a valid ISO date to French format', () => {
		const result = formatDateFR('2026-03-31');
		expect(result).toContain('31');
		expect(result).toContain('mars');
	});

	it('formats another valid date', () => {
		const result = formatDateFR('2026-01-05');
		expect(result).toContain('5');
		expect(result).toContain('janv.');
	});

	it('returns "Invalid Date" for empty string', () => {
		expect(formatDateFR('')).toBe('Invalid Date');
	});

	it('returns "Invalid Date" for invalid date string', () => {
		expect(formatDateFR('not-a-date')).toBe('Invalid Date');
	});
});

describe('groupByNotificationType', () => {
	it('filters participants by matching dayField === targetDays', () => {
		const participant = mockParticipant({ reminderDays: 3, push: true, email: true });
		const user = mockUser({ id: 'u1' });

		const result = groupByNotificationType([{ participant, user }], 'reminderDays', 3);

		expect(result.pushUsers).toHaveLength(1);
		expect(result.emailUsers).toHaveLength(1);
	});

	it('excludes participants with non-matching dayField', () => {
		const participant = mockParticipant({ reminderDays: 1, push: true, email: true });
		const user = mockUser({ id: 'u1' });

		const result = groupByNotificationType([{ participant, user }], 'reminderDays', 3);

		expect(result.pushUsers).toHaveLength(0);
		expect(result.emailUsers).toHaveLength(0);
	});

	it('returns empty arrays when no participants match', () => {
		const result = groupByNotificationType([], 'reminderDays', 3);
		expect(result.pushUsers).toHaveLength(0);
		expect(result.emailUsers).toHaveLength(0);
	});

	it('splits correctly when user has push but not email', () => {
		const participant = mockParticipant({ reminderDays: 2, push: true, email: false });
		const user = mockUser({ id: 'u1' });

		const result = groupByNotificationType([{ participant, user }], 'reminderDays', 2);

		expect(result.pushUsers).toHaveLength(1);
		expect(result.emailUsers).toHaveLength(0);
	});

	it('user appears in both push and email groups', () => {
		const participant = mockParticipant({ reminderDays: 1, push: true, email: true });
		const user = mockUser({ id: 'u1' });

		const result = groupByNotificationType([{ participant, user }], 'reminderDays', 1);

		expect(result.pushUsers).toContain(user);
		expect(result.emailUsers).toContain(user);
	});

	it('handles multiple participants with mixed settings', () => {
		const p1 = mockParticipant({ reminderDays: 3, push: true, email: false });
		const p2 = mockParticipant({ reminderDays: 3, push: false, email: true });
		const p3 = mockParticipant({ reminderDays: 3, push: true, email: true });
		const u1 = mockUser({ id: 'u1' });
		const u2 = mockUser({ id: 'u2' });
		const u3 = mockUser({ id: 'u3' });

		const result = groupByNotificationType(
			[
				{ participant: p1, user: u1 },
				{ participant: p2, user: u2 },
				{ participant: p3, user: u3 }
			],
			'reminderDays',
			3
		);

		expect(result.pushUsers).toHaveLength(2);
		expect(result.emailUsers).toHaveLength(2);
	});
});

describe('sendPushNotification', () => {
	let app: ReturnType<typeof mockApp>;
	let originalHttp: any;

	beforeEach(() => {
		app = mockApp();
		originalHttp = (globalThis as any).$http;
	});

	afterEach(() => {
		(globalThis as any).$http = originalHttp;
	});

	it('returns without calling $http.send when no subscription', () => {
		const user = mockUser({ push_subscription: null });
		(globalThis as any).$http = { send: vi.fn() };

		sendPushNotification(app, user as any, 'Title', 'Body', '/p/abc');

		expect((globalThis as any).$http.send).not.toHaveBeenCalled();
	});

	it('calls $http.send with correct payload on success', () => {
		const sub = { endpoint: 'https://push.example.com/123' };
		const user = mockUser({ id: 'u1', push_subscription: sub });
		(globalThis as any).$http = {
			send: vi.fn(() => ({ statusCode: 200 }))
		};

		sendPushNotification(app, user as any, 'Title', 'Body', '/p/abc');

		expect((globalThis as any).$http.send).toHaveBeenCalledWith(
			expect.objectContaining({
				method: 'POST',
				body: expect.stringContaining('"title":"Title"')
			})
		);
		expect(app.save).not.toHaveBeenCalled();
	});

	it('cleans up subscription on HTTP 410', () => {
		const sub = { endpoint: 'https://push.example.com/123' };
		const user = mockUser({ id: 'u1', push_subscription: sub });
		(globalThis as any).$http = {
			send: vi.fn(() => ({ statusCode: 410 }))
		};

		sendPushNotification(app, user as any, 'Title', 'Body', '/p/abc');

		expect(user.set).toHaveBeenCalledWith('push_subscription', null);
		expect(app.save).toHaveBeenCalledWith(user);
	});

	it('cleans up subscription on HTTP 404', () => {
		const sub = { endpoint: 'https://push.example.com/123' };
		const user = mockUser({ id: 'u1', push_subscription: sub });
		(globalThis as any).$http = {
			send: vi.fn(() => ({ statusCode: 404 }))
		};

		sendPushNotification(app, user as any, 'Title', 'Body', '/p/abc');

		expect(user.set).toHaveBeenCalledWith('push_subscription', null);
		expect(app.save).toHaveBeenCalledWith(user);
	});

	it('logs error and does not crash on network error', () => {
		const sub = { endpoint: 'https://push.example.com/123' };
		const user = mockUser({ id: 'u1', push_subscription: sub });
		(globalThis as any).$http = {
			send: vi.fn(() => {
				throw new Error('Network timeout');
			})
		};

		sendPushNotification(app, user as any, 'Title', 'Body', '/p/abc');

		expect(app._logger.error).toHaveBeenCalled();
		expect(app.save).not.toHaveBeenCalled();
	});

	it('logs error on non-200 non-410/404 status', () => {
		const sub = { endpoint: 'https://push.example.com/123' };
		const user = mockUser({ id: 'u1', push_subscription: sub });
		(globalThis as any).$http = {
			send: vi.fn(() => ({ statusCode: 500 }))
		};

		sendPushNotification(app, user as any, 'Title', 'Body', '/p/abc');

		expect(app._logger.error).toHaveBeenCalled();
		expect(app.save).not.toHaveBeenCalled();
	});
});

describe('sendGroupedEmail', () => {
	let app: ReturnType<typeof mockApp>;
	let originalMailerMessage: any;
	let mailSend: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		app = mockApp();
		mailSend = vi.fn();
		app.newMailClient = vi.fn(() => ({ send: mailSend as any }));
		originalMailerMessage = (globalThis as any).MailerMessage;
	});

	afterEach(() => {
		(globalThis as any).MailerMessage = originalMailerMessage;
	});

	it('returns immediately with empty users array', () => {
		const { MockMailerMessage } = createMailerMessageMock();
		(globalThis as any).MailerMessage = MockMailerMessage;

		sendGroupedEmail(app, [], 'Title', 'Body', '/p/abc');

		expect(mailSend).not.toHaveBeenCalled();
	});

	it('sends with TO only for single user (no CC)', () => {
		const { MockMailerMessage, calls } = createMailerMessageMock();
		(globalThis as any).MailerMessage = MockMailerMessage;
		const user = mockUser({ email: 'alice@test.com' });

		sendGroupedEmail(app, [user as any], 'Title', 'Body', '/p/abc');

		expect(calls).toHaveLength(1);
		expect(calls[0].to).toEqual([{ address: 'alice@test.com' }]);
		expect(calls[0].cc).toEqual([]);
		expect(mailSend).toHaveBeenCalled();
	});

	it('first user in TO, rest in CC for multiple users', () => {
		const { MockMailerMessage, calls } = createMailerMessageMock();
		(globalThis as any).MailerMessage = MockMailerMessage;
		const u1 = mockUser({ email: 'alice@test.com' });
		const u2 = mockUser({ email: 'bob@test.com' });
		const u3 = mockUser({ email: 'carol@test.com' });

		sendGroupedEmail(app, [u1 as any, u2 as any, u3 as any], 'Title', 'Body', '/p/abc');

		expect(calls[0].to).toEqual([{ address: 'alice@test.com' }]);
		expect(calls[0].cc).toEqual([{ address: 'bob@test.com' }, { address: 'carol@test.com' }]);
	});

	it('includes correct HTML body with link', () => {
		const { MockMailerMessage, calls } = createMailerMessageMock();
		(globalThis as any).MailerMessage = MockMailerMessage;
		const user = mockUser({ email: 'alice@test.com' });

		sendGroupedEmail(app, [user as any], 'Title', 'Body text', '/p/abc');

		expect(calls[0].html).toContain('Body text');
		expect(calls[0].html).toContain('https://planning.oupla.net/p/abc');
		expect(calls[0].html).toContain('Voir le planning');
	});

	it('uses app.settings() for sender info', () => {
		const { MockMailerMessage, calls } = createMailerMessageMock();
		(globalThis as any).MailerMessage = MockMailerMessage;
		const user = mockUser({ email: 'alice@test.com' });

		sendGroupedEmail(app, [user as any], 'Title', 'Body', '/p/abc');

		expect(app.settings).toHaveBeenCalled();
		expect(calls[0].from.address).toBe('noreply@oupla.net');
		expect(calls[0].from.name).toBe('Oupla Planning');
	});
});

describe('processReminders', () => {
	let app: ReturnType<typeof mockApp>;
	let originalHttp: any;
	let originalMailerMessage: any;
	let mailSend: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		app = mockApp();
		mailSend = vi.fn();
		app.newMailClient = vi.fn(() => ({ send: mailSend as any }));
		originalHttp = (globalThis as any).$http;
		originalMailerMessage = (globalThis as any).MailerMessage;
		(globalThis as any).MailerMessage = createMailerMessageMock().MockMailerMessage;
	});

	afterEach(() => {
		(globalThis as any).$http = originalHttp;
		(globalThis as any).MailerMessage = originalMailerMessage;
	});

	it('sends no notifications when no present responses', () => {
		(globalThis as any).$http = { send: vi.fn(() => ({ statusCode: 200 })) };
		const occ = mockOcc({ responses: [] });
		const user = mockUser({ id: 'u1', push_subscription: { endpoint: 'ep' } });
		const groups = { pushUsers: [user], emailUsers: [] };

		processReminders.call(notifyUtils, app, occ as any, groups, '/p/abc', 2, '09:00');

		expect((globalThis as any).$http.send).not.toHaveBeenCalled();
	});

	it('sends notifications only to present users', () => {
		(globalThis as any).$http = { send: vi.fn(() => ({ statusCode: 200 })) };
		const user1 = mockUser({ id: 'u1', push_subscription: { endpoint: 'ep' } });
		const user2 = mockUser({ id: 'u2', push_subscription: { endpoint: 'ep2' } });
		const occ = mockOcc({
			responses: [
				{ id: 'u1', response: 'present' },
				{ id: 'u2', response: 'absent' }
			],
			date: '2026-05-10'
		});
		const groups = { pushUsers: [user1, user2], emailUsers: [] };

		processReminders.call(notifyUtils, app, occ as any, groups, '/p/abc', 2, '09:00');

		expect((globalThis as any).$http.send).toHaveBeenCalledTimes(1);
	});

	it('uses "demain" when daysUntil is 1', () => {
		(globalThis as any).$http = { send: vi.fn(() => ({ statusCode: 200 })) };
		const user = mockUser({ id: 'u1', push_subscription: { endpoint: 'ep' } });
		const occ = mockOcc({
			responses: [{ id: 'u1', response: 'present' }],
			date: '2026-05-10'
		});
		const groups = { pushUsers: [user], emailUsers: [] };

		processReminders.call(notifyUtils, app, occ as any, groups, '/p/abc', 1, '09:00');

		const call = (globalThis as any).$http.send.mock.calls[0][0];
		expect(JSON.parse(call.body).body).toContain('demain');
	});

	it('uses "dans X jours" when daysUntil > 1', () => {
		(globalThis as any).$http = { send: vi.fn(() => ({ statusCode: 200 })) };
		const user = mockUser({ id: 'u1', push_subscription: { endpoint: 'ep' } });
		const occ = mockOcc({
			responses: [{ id: 'u1', response: 'present' }],
			date: '2026-05-10'
		});
		const groups = { pushUsers: [user], emailUsers: [] };

		processReminders.call(notifyUtils, app, occ as any, groups, '/p/abc', 3, '09:00');

		const call = (globalThis as any).$http.send.mock.calls[0][0];
		expect(JSON.parse(call.body).body).toContain('dans 3 jours');
	});

	it('triggers both push and email paths', () => {
		(globalThis as any).$http = { send: vi.fn(() => ({ statusCode: 200 })) };
		const pushUser = mockUser({ id: 'u1', push_subscription: { endpoint: 'ep' } });
		const emailUser = mockUser({ id: 'u2', email: 'u2@test.com' });
		const occ = mockOcc({
			responses: [
				{ id: 'u1', response: 'present' },
				{ id: 'u2', response: 'present' }
			],
			date: '2026-05-10'
		});
		const groups = { pushUsers: [pushUser], emailUsers: [emailUser] };

		processReminders.call(notifyUtils, app, occ as any, groups, '/p/abc', 2, '09:00');

		expect((globalThis as any).$http.send).toHaveBeenCalledTimes(1);
		expect(mailSend).toHaveBeenCalledTimes(1);
	});

	it('sends no notifications when responses is null', () => {
		(globalThis as any).$http = { send: vi.fn(() => ({ statusCode: 200 })) };
		const occ = mockOcc({ responses: null });
		const user = mockUser({ id: 'u1', push_subscription: { endpoint: 'ep' } });
		const groups = { pushUsers: [user], emailUsers: [] };

		processReminders.call(notifyUtils, app, occ as any, groups, '/p/abc', 2, '09:00');

		expect((globalThis as any).$http.send).not.toHaveBeenCalled();
	});
});

describe('processMissingParticipants', () => {
	let app: ReturnType<typeof mockApp>;
	let originalHttp: any;
	let originalMailerMessage: any;
	let mailSend: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		app = mockApp();
		mailSend = vi.fn();
		app.newMailClient = vi.fn(() => ({ send: mailSend as any }));
		originalHttp = (globalThis as any).$http;
		originalMailerMessage = (globalThis as any).MailerMessage;
		(globalThis as any).MailerMessage = createMailerMessageMock().MockMailerMessage;
	});

	afterEach(() => {
		(globalThis as any).$http = originalHttp;
		(globalThis as any).MailerMessage = originalMailerMessage;
	});

	it('does not alert when minRequired is 0 (disabled)', () => {
		(globalThis as any).$http = { send: vi.fn(() => ({ statusCode: 200 })) };
		const occ = mockOcc({ responses: [], minPresentRequired: 0, date: '2026-05-10' });
		const user = mockUser({ id: 'u1', push_subscription: { endpoint: 'ep' } });
		const groups = { pushUsers: [user], emailUsers: [] };

		processMissingParticipants.call(notifyUtils, app, occ as any, groups, '/p/abc', 2);

		expect((globalThis as any).$http.send).not.toHaveBeenCalled();
	});

	it('does not alert when presentCount >= minRequired', () => {
		(globalThis as any).$http = { send: vi.fn(() => ({ statusCode: 200 })) };
		const occ = mockOcc({
			responses: [
				{ id: 'u1', response: 'present' },
				{ id: 'u2', response: 'present' }
			],
			minPresentRequired: 2,
			date: '2026-05-10'
		});
		const user = mockUser({ id: 'u1', push_subscription: { endpoint: 'ep' } });
		const groups = { pushUsers: [user], emailUsers: [] };

		processMissingParticipants.call(notifyUtils, app, occ as any, groups, '/p/abc', 2);

		expect((globalThis as any).$http.send).not.toHaveBeenCalled();
	});

	it('sends notifications when presentCount < minRequired', () => {
		(globalThis as any).$http = { send: vi.fn(() => ({ statusCode: 200 })) };
		const user = mockUser({ id: 'u1', push_subscription: { endpoint: 'ep' } });
		const occ = mockOcc({
			responses: [{ id: 'u1', response: 'present' }],
			minPresentRequired: 3,
			date: '2026-05-10'
		});
		const groups = { pushUsers: [user], emailUsers: [] };

		processMissingParticipants.call(notifyUtils, app, occ as any, groups, '/p/abc', 2);

		expect((globalThis as any).$http.send).toHaveBeenCalledTimes(1);
		const call = (globalThis as any).$http.send.mock.calls[0][0];
		expect(JSON.parse(call.body).body).toContain('1/3');
	});

	it('does not send when no users in groups', () => {
		(globalThis as any).$http = { send: vi.fn(() => ({ statusCode: 200 })) };
		const occ = mockOcc({
			responses: [],
			minPresentRequired: 2,
			date: '2026-05-10'
		});
		const groups = { pushUsers: [], emailUsers: [] };

		processMissingParticipants.call(notifyUtils, app, occ as any, groups, '/p/abc', 2);

		expect((globalThis as any).$http.send).not.toHaveBeenCalled();
	});

	it('correct body shows X/Y présents format', () => {
		(globalThis as any).$http = { send: vi.fn(() => ({ statusCode: 200 })) };
		const user = mockUser({ id: 'u1', push_subscription: { endpoint: 'ep' } });
		const occ = mockOcc({
			responses: [{ id: 'u1', response: 'present' }],
			minPresentRequired: 5,
			date: '2026-05-10'
		});
		const groups = { pushUsers: [user], emailUsers: [] };

		processMissingParticipants.call(notifyUtils, app, occ as any, groups, '/p/abc', 2);

		const call = (globalThis as any).$http.send.mock.calls[0][0];
		const body = JSON.parse(call.body).body;
		expect(body).toContain('1/5 présents');
	});

	it('uses correct title with "Il manque des participants"', () => {
		(globalThis as any).$http = { send: vi.fn(() => ({ statusCode: 200 })) };
		const user = mockUser({ id: 'u1', push_subscription: { endpoint: 'ep' } });
		const occ = mockOcc({
			responses: [],
			minPresentRequired: 3,
			date: '2026-05-10'
		});
		const groups = { pushUsers: [user], emailUsers: [] };

		processMissingParticipants.call(notifyUtils, app, occ as any, groups, '/p/abc', 2);

		const call = (globalThis as any).$http.send.mock.calls[0][0];
		expect(JSON.parse(call.body).title).toContain('Il manque des participants');
	});
});
