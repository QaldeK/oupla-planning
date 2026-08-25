import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notifyUtils = await import("../../pocketbase/pb_hooks/notify-utils.cjs");
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

function mockUser(overrides: { id?: string; email?: string } = {}) {
	return {
		get: vi.fn((key: string) => (key === "id" ? (overrides.id ?? "user-1") : undefined)),
		getId: vi.fn(() => overrides.id ?? "user-1"),
		email: vi.fn(() => overrides.email ?? "user@test.com"),
		set: vi.fn()
	};
}

/**
 * Simulation d'une row push_subscriptions : champs text lus via getString(),
 * comme en JSVM.
 */
function mockSubscriptionRow(
	overrides: { endpoint?: string; p256dh?: string; auth?: string } = {}
) {
	const data = {
		endpoint: overrides.endpoint ?? "https://push.example/abc",
		p256dh: overrides.p256dh ?? "key-p256dh",
		auth: overrides.auth ?? "key-auth"
	};
	return {
		getString: vi.fn((key: string) => data[key as keyof typeof data])
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

	it("returns empty string for empty input", () => {
		const result = formatDateFR("");
		expect(result).toBe("");
	});

	it("returns the raw input for invalid date string", () => {
		const result = formatDateFR("not-a-date");
		expect(result).toBe("not-a-date");
	});
});

describe("sendPushNotification", () => {
	let app: ReturnType<typeof mockApp>;
	let originalHttp: any;
	let originalOs: any;

	beforeEach(() => {
		app = mockApp();
		originalHttp = (globalThis as any).$http;
		// $os est un global JSVM — absent de l'environnement vitest, le hook lit
		// NOTIFY_SERVICE_URL à chaque appel.
		originalOs = (globalThis as any).$os;
		(globalThis as any).$os = { getenv: vi.fn(() => "") };
	});

	afterEach(() => {
		if (originalHttp === undefined) {
			delete (globalThis as any).$http;
		} else {
			(globalThis as any).$http = originalHttp;
		}
		if (originalOs === undefined) {
			delete (globalThis as any).$os;
		} else {
			(globalThis as any).$os = originalOs;
		}
	});

	it("returns without calling $http.send when no subscription", () => {
		const send = vi.fn();
		(globalThis as any).$http = { send };
		app.findRecordsByFilter = vi.fn(() => []);

		const user = mockUser({ id: "u1" });
		sendPushNotification(app, user, "title", "body", "/p/abc");

		expect(send).not.toHaveBeenCalled();
	});

	it("sends to every device of the user with reconstructed subscription", () => {
		const send: ReturnType<typeof vi.fn> = vi.fn(() => ({ statusCode: 200 }));
		(globalThis as any).$http = { send };

		const rows = [
			mockSubscriptionRow({ endpoint: "https://push.example/abc" }),
			mockSubscriptionRow({ endpoint: "https://push.example/def" })
		];
		app.findRecordsByFilter = vi.fn(() => rows);

		const user = mockUser({ id: "u1" });
		sendPushNotification(app, user, "title", "body", "/p/abc");

		expect(send).toHaveBeenCalledTimes(2);
		const firstCall = send.mock.calls[0][0] as { method: string; body: string };
		expect(firstCall.method).toBe("POST");
		expect(firstCall.body).toContain('"title":"title"');
		expect(firstCall.body).toContain('"body":"body"');
		// $os mocké → getenv retourne "" → défaut PUBLIC_BASE_URL (domaine public)
		expect(firstCall.body).toContain('"url":"https://planning.oupla.net/p/abc"');
		expect(firstCall.body).toContain('"endpoint":"https://push.example/abc"');
		expect(firstCall.body).toContain('"p256dh":"key-p256dh"');
		const secondCall = send.mock.calls[1][0] as { body: string };
		expect(secondCall.body).toContain('"endpoint":"https://push.example/def"');
	});

	it("préfixe l'URL de clic avec PUBLIC_BASE_URL quand défini (slash final normalisé)", () => {
		const send = vi.fn(() => ({ statusCode: 200 }));
		(globalThis as any).$http = { send };
		(globalThis as any).$os = {
			getenv: vi.fn((k: string) => (k === "PUBLIC_BASE_URL" ? "http://localhost:5173/" : ""))
		};
		app.findRecordsByFilter = vi.fn(() => [mockSubscriptionRow()]);

		const user = mockUser({ id: "u1" });
		sendPushNotification(app, user, "t", "b", "/p/x");

		const body = JSON.parse((send.mock.calls[0][0] as { body: string }).body);
		expect(body.url).toBe("http://localhost:5173/p/x");
	});

	it("deletes only the dead row on HTTP 410, keeps sending to others", () => {
		const deadRow = mockSubscriptionRow({ endpoint: "https://push.example/gone" });
		const aliveRow = mockSubscriptionRow({ endpoint: "https://push.example/ok" });
		const send = vi.fn(({ body }: { body: string }) => ({
			statusCode: body.includes("gone") ? 410 : 200
		}));
		(globalThis as any).$http = { send };

		app.findRecordsByFilter = vi.fn(() => [deadRow, aliveRow]);
		app.delete = vi.fn();

		const user = mockUser({ id: "u1" });
		sendPushNotification(app, user, "t", "b", "/p/x");

		expect(send).toHaveBeenCalledTimes(2);
		expect(app.delete).toHaveBeenCalledTimes(1);
		expect(app.delete).toHaveBeenCalledWith(deadRow);
	});

	it("deletes the dead row on HTTP 404", () => {
		const send = vi.fn(() => ({ statusCode: 404 }));
		(globalThis as any).$http = { send };

		const row = mockSubscriptionRow();
		app.findRecordsByFilter = vi.fn(() => [row]);
		app.delete = vi.fn();

		const user = mockUser({ id: "u1" });
		sendPushNotification(app, user, "t", "b", "/p/x");

		expect(app.delete).toHaveBeenCalledWith(row);
	});

	it("logs error and does not crash on network error", () => {
		const send = vi.fn(() => {
			throw new Error("network");
		});
		(globalThis as any).$http = { send };

		app.findRecordsByFilter = vi.fn(() => [mockSubscriptionRow()]);

		const user = mockUser({ id: "u1" });

		expect(() => sendPushNotification(app, user, "t", "b", "/p/x")).not.toThrow();
		expect(app._logger.error).toHaveBeenCalledWith(
			"[Notification] Push HTTP error",
			"err",
			"network",
			"userId",
			"u1",
			"endpoint",
			"https://push.example/abc"
		);
	});

	it("logs error on non-200 non-410/404 status", () => {
		const send = vi.fn(() => ({ statusCode: 500 }));
		(globalThis as any).$http = { send };

		app.findRecordsByFilter = vi.fn(() => [mockSubscriptionRow()]);

		const user = mockUser({ id: "u1" });
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
