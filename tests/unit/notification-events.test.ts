import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Tests unitaires du producteur d'events de notification (notification-events.cjs).
// Module sans require interne : tout est injecté (app, Record global JSVM mocké),
// aucun global __hooks nécessaire.

const { insertEvent, createMasterContextResolver, resolveUserName } = await import(
	"../../pocketbase/pb_hooks/notification-events.cjs"
);

function mockLogger() {
	return { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
}

/** Record JSVM mocké : capture la collection et les champs posés via set(). */
function createRecordMock() {
	const instances: any[] = [];
	class MockRecord {
		collection: unknown;
		values: Record<string, unknown> = {};
		constructor(collection: unknown) {
			this.collection = collection;
			instances.push(this);
		}
		set(field: string, value: unknown) {
			this.values[field] = value;
		}
		get(field: string) {
			return this.values[field];
		}
	}
	return { MockRecord, instances };
}

function mockApp(overrides: Record<string, any> = {}) {
	const logger = mockLogger();
	return {
		logger: vi.fn(() => logger),
		findCollectionByNameOrId: vi.fn(() => ({ name: "notification_events" })),
		save: vi.fn(),
		findRecordById: vi.fn(),
		findRecordsByFilter: vi.fn(() => []),
		_logger: logger,
		...overrides
	};
}

function mockUser(fields: { name?: string; email?: string }) {
	return {
		getString: vi.fn((field: string) => (fields as any)[field] ?? "")
	};
}

function mockMaster(deleted: boolean) {
	return { getBool: vi.fn((field: string) => (field === "deleted" ? deleted : false)) };
}

let originalRecord: unknown;

beforeEach(() => {
	originalRecord = (globalThis as any).Record;
});

afterEach(() => {
	(globalThis as any).Record = originalRecord;
});

describe("insertEvent", () => {
	it("mappe les champs de l'event sur un record et le sauve", () => {
		const { MockRecord, instances } = createRecordMock();
		(globalThis as any).Record = MockRecord;
		const app = mockApp();
		const payload = { commentId: "c1", authorName: "Alice" };

		const record = insertEvent(app, {
			type: "new_comment",
			master: "m1",
			occurrence: "o1",
			reminderValue: 0,
			changedBy: "u1",
			payload
		});

		expect(app.findCollectionByNameOrId).toHaveBeenCalledWith("notification_events");
		expect(instances).toHaveLength(1);
		expect(instances[0].collection).toEqual({ name: "notification_events" });
		expect(instances[0].values).toEqual({
			type: "new_comment",
			master: "m1",
			occurrence: "o1",
			reminderValue: 0,
			changedBy: "u1",
			payload
		});
		expect(app.save).toHaveBeenCalledTimes(1);
		expect(app.save).toHaveBeenCalledWith(record);
	});

	it("pose payload à null quand absent", () => {
		const { MockRecord, instances } = createRecordMock();
		(globalThis as any).Record = MockRecord;
		const app = mockApp();

		insertEvent(app, {
			type: "reminder",
			master: "m1",
			occurrence: "o1",
			reminderValue: 3,
			changedBy: "",
			payload: null
		});

		expect(instances[0].values.payload).toBeNull();
	});

	it("jette si la sauvegarde échoue (le caller loggue)", () => {
		const { MockRecord } = createRecordMock();
		(globalThis as any).Record = MockRecord;
		const app = mockApp({
			save: vi.fn(() => {
				throw new Error("db locked");
			})
		});

		expect(() =>
			insertEvent(app, {
				type: "reminder",
				master: "m1",
				occurrence: "o1",
				reminderValue: 1,
				changedBy: "",
				payload: null
			})
		).toThrow("db locked");
	});

	it("jette si la collection est introuvable", () => {
		const { MockRecord } = createRecordMock();
		(globalThis as any).Record = MockRecord;
		const app = mockApp({
			findCollectionByNameOrId: vi.fn(() => {
				throw new Error("missing collection");
			})
		});

		expect(() =>
			insertEvent(app, {
				type: "reminder",
				master: "m1",
				occurrence: "o1",
				reminderValue: 1,
				changedBy: "",
				payload: null
			})
		).toThrow("missing collection");
	});
});

describe("createMasterContextResolver", () => {
	it("retourne master + participants avec filtre bindé", () => {
		const app = mockApp();
		const master = mockMaster(false);
		const participants = [{ id: "p1" }, { id: "p2" }];
		app.findRecordById.mockReturnValue(master);
		app.findRecordsByFilter.mockReturnValue(participants);

		const getCtx = createMasterContextResolver(app);
		const ctx = getCtx("m1");

		expect(ctx).toEqual({ master, participants });
		expect(app.findRecordById).toHaveBeenCalledWith("planning_masters", "m1");
		expect(app.findRecordsByFilter).toHaveBeenCalledWith(
			"planning_participants",
			"planning = {:masterId}",
			"",
			0,
			0,
			{ masterId: "m1" }
		);
	});

	it("met en cache : un seul fetch pour N appels du même master", () => {
		const app = mockApp();
		app.findRecordById.mockReturnValue(mockMaster(false));

		const getCtx = createMasterContextResolver(app);
		const first = getCtx("m1");
		const second = getCtx("m1");

		expect(app.findRecordById).toHaveBeenCalledTimes(1);
		expect(app.findRecordsByFilter).toHaveBeenCalledTimes(1);
		expect(second).toBe(first);
	});

	it("retourne null pour un master supprimé (et cache le résultat)", () => {
		const app = mockApp();
		app.findRecordById.mockReturnValue(mockMaster(true));

		const getCtx = createMasterContextResolver(app);
		expect(getCtx("m1")).toBeNull();
		expect(getCtx("m1")).toBeNull();
		expect(app.findRecordById).toHaveBeenCalledTimes(1);
		expect(app.findRecordsByFilter).not.toHaveBeenCalled();
	});

	it("participants illisibles → contexte conservé avec participants null + log", () => {
		const app = mockApp();
		const master = mockMaster(false);
		app.findRecordById.mockReturnValue(master);
		app.findRecordsByFilter.mockImplementation(() => {
			throw new Error("db io");
		});

		const ctx = createMasterContextResolver(app)("m1");

		expect(ctx).toEqual({ master, participants: null });
		expect(app._logger.error).toHaveBeenCalledTimes(1);
		expect(app._logger.error.mock.calls[0]).toContain("m1");
	});

	it("participants illisibles → résultat caché, sans relance", () => {
		const app = mockApp();
		app.findRecordById.mockReturnValue(mockMaster(false));
		app.findRecordsByFilter.mockImplementation(() => {
			throw new Error("db io");
		});

		const getCtx = createMasterContextResolver(app);
		const first = getCtx("m1");

		expect(getCtx("m1")).toBe(first);
		expect(app.findRecordsByFilter).toHaveBeenCalledTimes(1);
		expect(app._logger.error).toHaveBeenCalledTimes(1);
	});

	it("aucun participant (liste vide légitime) → [] et aucun log d'erreur", () => {
		const app = mockApp();
		app.findRecordById.mockReturnValue(mockMaster(false));
		app.findRecordsByFilter.mockReturnValue([]);

		const ctx = createMasterContextResolver(app)("m1");

		expect(ctx).toEqual({ master: expect.anything(), participants: [] });
		expect(app._logger.error).not.toHaveBeenCalled();
	});

	it("retourne null pour un master introuvable", () => {
		const app = mockApp({
			findRecordById: vi.fn(() => {
				throw new Error("not found");
			})
		});

		const getCtx = createMasterContextResolver(app);
		expect(getCtx("m1")).toBeNull();
		expect(app.findRecordsByFilter).not.toHaveBeenCalled();
	});

	it("ne confond pas les ids distincts", () => {
		const app = mockApp();
		app.findRecordById.mockImplementation((_col: string, id: string) =>
			mockMaster(id === "m-deleted")
		);

		const getCtx = createMasterContextResolver(app);
		expect(getCtx("m-alive")).not.toBeNull();
		expect(getCtx("m-deleted")).toBeNull();
		expect(getCtx("m-alive")).not.toBeNull();
		expect(app.findRecordById).toHaveBeenCalledTimes(2);
	});
});

describe("resolveUserName", () => {
	it("retourne le name quand présent", () => {
		const app = mockApp({
			findRecordById: vi.fn(() => mockUser({ name: "Alice", email: "a@x.co" }))
		});
		expect(resolveUserName(app, "u1", "fallback")).toBe("Alice");
	});

	it("retourne l'email en l'absence de name", () => {
		const app = mockApp({ findRecordById: vi.fn(() => mockUser({ name: "", email: "a@x.co" })) });
		expect(resolveUserName(app, "u1", "fallback")).toBe("a@x.co");
	});

	it("retourne le fallback si ni name ni email", () => {
		const app = mockApp({ findRecordById: vi.fn(() => mockUser({ name: "", email: "" })) });
		expect(resolveUserName(app, "u1", "fallback")).toBe("fallback");
	});

	it("retourne le fallback si uid vide", () => {
		const app = mockApp();
		expect(resolveUserName(app, "", "fallback")).toBe("fallback");
		expect(app.findRecordById).not.toHaveBeenCalled();
	});

	it("retourne le fallback si le user est introuvable", () => {
		const app = mockApp({
			findRecordById: vi.fn(() => {
				throw new Error("not found");
			})
		});
		expect(resolveUserName(app, "u1", "fallback")).toBe("fallback");
	});
});
