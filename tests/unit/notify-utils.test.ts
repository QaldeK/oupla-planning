import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notifyUtils = await import("../../pocketbase/pb_hooks/notify-utils.js");
const { formatDateFR, sendPushNotification, sendIndividualEmail } = notifyUtils;

function mockLogger() {
	return {
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn()
	};
}

function mockApp(overrides: Record<string, any> = {}) {
	const logger = mockLogger();
	return {
		logger: vi.fn(() => logger),
		save: vi.fn(),
		settings: vi.fn(() => ({
			meta: {
				senderAddress: "noreply@oupla.net",
				senderName: "Oupla Planning"
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
	// Simulation du comportement JSVM réel : getString() sur un champ json retourne
	// la string JSON (vide si null), pas les bytes bruts. Sans ça, le test ne
	// couvrirait pas le bug `[]byte` qui plantaient notify-service en production.
	const getString = (key: string): string => {
		const val = data[key];
		if (val === null || val === undefined) return "";
		return typeof val === "string" ? val : JSON.stringify(val);
	};
	return {
		get: vi.fn((key: string) => data[key]),
		getString: vi.fn(getString),
		getId: vi.fn(() => overrides.id ?? "user-1"),
		email: vi.fn(() => overrides.email ?? "user@test.com"),
		set: vi.fn((key: string, val: any) => {
			data[key] = val;
		})
	};
}

// Mock de `new MailerMessage({...})` — global JSVM patché par les tests sendIndividualEmail.
// Le constructeur capture les options pour permettre l'assertion sur la shape construite.
function createMailerMessageMock() {
	const calls: any[] = [];
	class MockMailerMessage {
		constructor(options: any) {
			calls.push(options);
		}
	}
	return { MockMailerMessage, calls };
}

describe("formatDateFR", () => {
	it("formats a valid ISO date to French format", () => {
		const result = formatDateFR("2026-03-31");
		expect(result).toMatch(/31/);
		expect(result).toMatch(/mars|mar/i);
	});

	it("formats another valid date", () => {
		const result = formatDateFR("2026-01-15");
		expect(result).toMatch(/15/);
	});

	it('returns empty string for empty input', () => {
		const result = formatDateFR("");
		expect(result).toBe("");
	});

	it('returns the raw input for invalid date string', () => {
		const result = formatDateFR("not-a-date");
		expect(result).toBe("not-a-date");
	});
});

describe("sendPushNotification", () => {
	let app: ReturnType<typeof mockApp>;
	let originalHttp: any;

	beforeEach(() => {
		app = mockApp();
		originalHttp = (globalThis as any).$http;
	});

	afterEach(() => {
		if (originalHttp === undefined) {
			delete (globalThis as any).$http;
		} else {
			(globalThis as any).$http = originalHttp;
		}
	});

	it("returns without calling $http.send when no subscription", () => {
		const send = vi.fn();
		(globalThis as any).$http = { send };

		const user = mockUser({ push_subscription: null });
		sendPushNotification(app, user, "title", "body", "/p/abc");

		expect(send).not.toHaveBeenCalled();
	});

	it("calls $http.send with correct payload on success", () => {
		const send: ReturnType<typeof vi.fn> = vi.fn(() => ({ statusCode: 200 }));
		(globalThis as any).$http = { send };

		const sub = { endpoint: "https://push.example/abc" };
		const user = mockUser({ id: "u1", push_subscription: sub });
		sendPushNotification(app, user, "title", "body", "/p/abc");

		expect(send).toHaveBeenCalledTimes(1);
		const callArg = send.mock.calls[0][0] as { method: string; body: string };
		expect(callArg.method).toBe("POST");
		expect(callArg.body).toContain('"title":"title"');
		expect(callArg.body).toContain('"body":"body"');
	});

	it("cleans up subscription on HTTP 410", () => {
		const send = vi.fn(() => ({ statusCode: 410 }));
		(globalThis as any).$http = { send };

		const sub = { endpoint: "https://push.example/abc" };
		const user = mockUser({ id: "u1", push_subscription: sub });
		sendPushNotification(app, user, "t", "b", "/p/x");

		expect(user.set).toHaveBeenCalledWith("push_subscription", null);
		expect(app.save).toHaveBeenCalledWith(user);
	});

	it("cleans up subscription on HTTP 404", () => {
		const send = vi.fn(() => ({ statusCode: 404 }));
		(globalThis as any).$http = { send };

		const sub = { endpoint: "https://push.example/abc" };
		const user = mockUser({ id: "u1", push_subscription: sub });
		sendPushNotification(app, user, "t", "b", "/p/x");

		expect(user.set).toHaveBeenCalledWith("push_subscription", null);
	});

	it("logs error and does not crash on network error", () => {
		const send = vi.fn(() => {
			throw new Error("network");
		});
		(globalThis as any).$http = { send };

		const sub = { endpoint: "https://push.example/abc" };
		const user = mockUser({ id: "u1", push_subscription: sub });

		expect(() => sendPushNotification(app, user, "t", "b", "/p/x")).not.toThrow();
		expect(app._logger.error).toHaveBeenCalledWith(
			"[Notification] Push HTTP error",
			"err",
			"network",
			"userId",
			"u1"
		);
	});

	it("logs error on non-200 non-410/404 status", () => {
		const send = vi.fn(() => ({ statusCode: 500 }));
		(globalThis as any).$http = { send };

		const sub = { endpoint: "https://push.example/abc" };
		const user = mockUser({ id: "u1", push_subscription: sub });
		sendPushNotification(app, user, "t", "b", "/p/x");

		expect(app._logger.error).toHaveBeenCalledWith(
			"[Notification] Push error",
			"status",
			500,
			"userId",
			"u1",
			"url",
			"/p/x"
		);
	});
});

describe("sendIndividualEmail", () => {
	let app: ReturnType<typeof mockApp>;
	let originalMailerMessage: any;
	let mailSend: ReturnType<typeof vi.fn>;
	let calls: any[];

	beforeEach(() => {
		app = mockApp();
		mailSend = vi.fn();
		app.newMailClient = vi.fn(() => ({ send: mailSend })) as any;

		const mock = createMailerMessageMock();
		calls = mock.calls;
		originalMailerMessage = (globalThis as any).MailerMessage;
		(globalThis as any).MailerMessage = mock.MockMailerMessage;
	});

	afterEach(() => {
		if (originalMailerMessage === undefined) {
			delete (globalThis as any).MailerMessage;
		} else {
			(globalThis as any).MailerMessage = originalMailerMessage;
		}
	});

	it("builds a MailerMessage with from/to/subject/html/text from app settings and user", () => {
		const user = mockUser({ id: "u1", email: "alice@test.com" });

		sendIndividualEmail(app, user, "Subject", "<p>HTML</p>", "TEXT body");

		expect(calls).toHaveLength(1);
		expect(calls[0].from).toEqual({
			address: "noreply@oupla.net",
			name: "Oupla Planning"
		});
		expect(calls[0].to).toEqual([{ address: "alice@test.com" }]);
		expect(calls[0].subject).toBe("Subject");
		expect(calls[0].html).toBe("<p>HTML</p>");
		expect(calls[0].text).toBe("TEXT body");
		expect(calls[0].headers).toEqual({});
		expect(mailSend).toHaveBeenCalledTimes(1);
	});

	it("passes opts.headers through to MailerMessage", () => {
		const user = mockUser({ id: "u1", email: "alice@test.com" });
		const headers = {
			"Reply-To": "support@oupla.net",
			"X-Entity-Ref-ID": "master-m1-" + Date.now()
		};

		sendIndividualEmail(app, user, "Subject", "<p>HTML</p>", "TEXT body", { headers });

		expect(calls[0].headers).toEqual(headers);
	});

	it("logs success on SMTP send OK", () => {
		const user = mockUser({ id: "u1", email: "alice@test.com" });

		sendIndividualEmail(app, user, "Subject", "<p/>", "text");

		expect(app._logger.info).toHaveBeenCalledWith(
			"[Notification] Email sent",
			"userId",
			"u1",
			"subject",
			"Subject"
		);
	});

	it("logs error as key-value pairs and rethrows on SMTP failure", () => {
		const user = mockUser({ id: "u1", email: "alice@test.com" });
		mailSend.mockImplementation(() => {
			throw new Error("SMTP timeout");
		});

		// Le rethrow permet au caller d'incrémenter attempts et décider
		// du retry — pas d'étouffement silencieux de l'erreur.
		expect(() => sendIndividualEmail(app, user, "Subject", "<p/>", "text")).toThrow("SMTP timeout");

		expect(app._logger.error).toHaveBeenCalledWith(
			"[Notification] SMTP send failed",
			"err",
			"SMTP timeout",
			"userId",
			"u1",
			"subject",
			"Subject"
		);
	});
});
