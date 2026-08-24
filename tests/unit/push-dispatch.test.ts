import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";

// Runner isolé (pas de PocketBase nécessaire) pour dispatchPushForEvent.
// Les fonctions de domaine (buildPushTitle, buildPushBody) et l'adaptateur
// d'envoi (sendPushNotification) sont injectées — pas de require() natif
// vers des modules .js (voir ADR-0007).

const HOOKS_DIR = path.resolve(__dirname, "../../", "pocketbase/pb_hooks");
(globalThis as any).__hooks = HOOKS_DIR;

const { dispatchPushForEvent } = await import("../../pocketbase/pb_hooks/push-dispatch.js");

// ============================================================================
// Chargement de notification-cron-utils.js — contournement de l'interop CJS
// de Vite (cf. notify-templates.test.ts). Le module fait au top level
// `require(`${__hooks}/notify-utils.cjs`)` et `require(`${__hooks}/pb-helpers.cjs`).
// Vite ne sait pas transformer ces require dynamiques (template literal +
// package.json "type":"module"). On pré-importe les deux dépendances via Vite
// (qui gère leur CJS en import statique), on les injecte via des globales, puis
// on charge le source du module via une data URL après avoir remplacé les
// require CJS et le module.exports par des références globales.
// ============================================================================
const notifyUtils = await import("../../pocketbase/pb_hooks/notify-utils.cjs");
(globalThis as any).__notifyUtils__ = notifyUtils;
const notifyCore = await import("../../pocketbase/pb_hooks/notification-core.cjs");
(globalThis as any).__notifyCore__ = notifyCore;
const pbHelpers = await import("../../pocketbase/pb_hooks/pb-helpers.cjs");
(globalThis as any).__pbHelpers__ = pbHelpers;

const cronUtilsSource = readFileSync(path.join(HOOKS_DIR, "notification-cron-utils.js"), "utf-8")
	.replace(/require\(`\$\{__hooks\}\/notify-utils\.cjs`\)/, "globalThis.__notifyUtils__")
	.replace(/require\(`\$\{__hooks\}\/pb-helpers\.cjs`\)/, "globalThis.__pbHelpers__")
	.replace(/require\(`\$\{__hooks\}\/notification-core\.cjs`\)/, "globalThis.__notifyCore__")
	.replace(/module\.exports\s*=\s*\{/, "globalThis.__cronUtils_exports__ = {");
const cronUtilsDataUrl =
	"data:text/javascript;base64," + Buffer.from(cronUtilsSource, "utf-8").toString("base64");
await import(/* @vite-ignore */ cronUtilsDataUrl);
const { buildPushTitle, buildPushBody, MAX_CONTENT_PREVIEW } = (globalThis as any)
	.__cronUtils_exports__;

// ============================================================================
// Mocks minimaux — pas besoin de mockRecord complet, juste getString pour
// les champs lus (participantToken sur master, tasks sur occ).
// ============================================================================

function mkMaster(token = "abc123"): any {
	return { getString: (f: string) => (f === "participantToken" ? token : "") };
}

function mkMasterWithTitle(title: string, token = "abc123"): any {
	return {
		getString: (f: string) => (f === "participantToken" ? token : f === "title" ? title : "")
	};
}

function mkOcc(tasks: any[] = []): any {
	return { getString: (f: string) => (f === "tasks" ? JSON.stringify(tasks) : "") };
}

function mkRecipient({ userId, push = true }: { userId: string; push?: boolean }) {
	return { userId, push, response: null, tasks: [] };
}

function mkUser(id: string): any {
	return { get: (f: string) => (f === "id" ? id : null) };
}

// ============================================================================
// Tests
// ============================================================================

describe("dispatchPushForEvent", () => {
	it("envoie un push à chaque destinataire push=true et retourne le compte", () => {
		const sent = vi.fn();
		const result = dispatchPushForEvent({} as any, {
			event: { type: "reminder", reminderValue: 3 },
			master: mkMaster("tok"),
			occ: mkOcc(),
			recipients: [
				mkRecipient({ userId: "u1" }),
				mkRecipient({ userId: "u2", push: false }),
				mkRecipient({ userId: "u3" })
			],
			resolveUser: (uid: string) => mkUser(uid),
			buildPushTitle: () => "Rappel — Planning",
			buildPushBody: () => "body",
			sendPushNotification: sent
		});

		expect(sent).toHaveBeenCalledTimes(2);
		expect(result).toBe(2);
	});

	it("passe l'url construite depuis participantToken à sendPushNotification", () => {
		const sent = vi.fn();
		dispatchPushForEvent({} as any, {
			event: { type: "reminder", reminderValue: 1 },
			master: mkMaster("XYZ789"),
			occ: mkOcc(),
			recipients: [mkRecipient({ userId: "u1" })],
			resolveUser: () => mkUser("u1"),
			buildPushTitle: () => "T",
			buildPushBody: () => "B",
			sendPushNotification: sent
		});

		expect(sent).toHaveBeenCalledWith(expect.anything(), expect.anything(), "T", "B", "/p/XYZ789");
	});

	it("saute les destinataires dont resolveUser retourne null", () => {
		const sent = vi.fn();
		const result = dispatchPushForEvent({} as any, {
			event: { type: "reminder", reminderValue: 1 },
			master: mkMaster(),
			occ: mkOcc(),
			recipients: [
				mkRecipient({ userId: "u1" }),
				mkRecipient({ userId: "u_deleted" }),
				mkRecipient({ userId: "u3" })
			],
			resolveUser: (uid: string) => (uid === "u_deleted" ? null : mkUser(uid)),
			buildPushTitle: () => "T",
			buildPushBody: () => "B",
			sendPushNotification: sent
		});

		expect(sent).toHaveBeenCalledTimes(2);
		expect(result).toBe(2);
	});

	it("continue la boucle si sendPushNotification throw", () => {
		const sent = vi
			.fn()
			.mockImplementationOnce(() => {
				throw new Error("HTTP timeout");
			})
			.mockImplementationOnce(() => undefined);

		const result = dispatchPushForEvent({} as any, {
			event: { type: "reminder", reminderValue: 1 },
			master: mkMaster(),
			occ: mkOcc(),
			recipients: [mkRecipient({ userId: "u1" }), mkRecipient({ userId: "u2" })],
			resolveUser: (uid: string) => mkUser(uid),
			buildPushTitle: () => "T",
			buildPushBody: () => "B",
			sendPushNotification: sent
		});

		// Le premier envoi échoue (non compté), le second réussit (comté).
		expect(sent).toHaveBeenCalledTimes(2);
		expect(result).toBe(1);
	});

	it("passe occTasks (parsé depuis occ) à buildPushBody", () => {
		const bodyFn = vi.fn(() => "body");
		const tasks = [{ id: "t1", name: "Accueil", type: "beforeEvent" }];

		dispatchPushForEvent({} as any, {
			event: { type: "reminder", reminderValue: 1 },
			master: mkMaster(),
			occ: mkOcc(tasks),
			recipients: [mkRecipient({ userId: "u1" })],
			resolveUser: () => mkUser("u1"),
			buildPushTitle: () => "T",
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
			event: { type: "reminder", reminderValue: 1 },
			master: mkMaster(),
			occ: mkOcc(),
			recipients: [
				mkRecipient({ userId: "u1", push: false }),
				mkRecipient({ userId: "u2", push: false })
			],
			resolveUser: () => mkUser("x"),
			buildPushTitle: () => "T",
			buildPushBody: () => "B",
			sendPushNotification: sent
		});

		expect(sent).not.toHaveBeenCalled();
		expect(result).toBe(0);
	});

	it("passe l'app reçu en paramètre à sendPushNotification", () => {
		const sent = vi.fn();
		const fakeApp = { id: "pocketbase-instance" };

		dispatchPushForEvent(fakeApp as any, {
			event: { type: "reminder", reminderValue: 1 },
			master: mkMaster(),
			occ: mkOcc(),
			recipients: [mkRecipient({ userId: "u1" })],
			resolveUser: () => mkUser("u1"),
			buildPushTitle: () => "T",
			buildPushBody: () => "B",
			sendPushNotification: sent
		});

		expect(sent.mock.calls[0][0]).toBe(fakeApp);
	});
});

describe("buildPushTitle / buildPushBody — new_comment", () => {
	it("buildPushTitle(new_comment) → 'Nouveau message — {title}'", () => {
		const title = buildPushTitle({ type: "new_comment" }, mkMasterWithTitle("Foot du jeudi"));
		expect(title).toBe("Nouveau message — Foot du jeudi");
	});

	it("buildPushTitle(new_comment) fallback quand le titre est vide → 'Nouveau message — Planning'", () => {
		const title = buildPushTitle({ type: "new_comment" }, mkMaster());
		expect(title).toBe("Nouveau message — Planning");
	});

	it("buildPushBody(new_comment) → '{authorName} : {contentPreview}'", () => {
		const body = buildPushBody(
			{ type: "new_comment", payload: { authorName: "Alice", contentPreview: "On se voit à 19h" } },
			mkOcc(),
			{} as any,
			[]
		);
		expect(body).toBe("Alice : On se voit à 19h");
	});

	it("buildPushBody(new_comment) sans auteur → juste le preview", () => {
		const body = buildPushBody(
			{ type: "new_comment", payload: { authorName: "", contentPreview: "Message anonyme" } },
			mkOcc(),
			{} as any,
			[]
		);
		expect(body).toBe("Message anonyme");
	});

	it("buildPushBody(new_comment) tronque un preview > 130 chars avec ellipsis", () => {
		const long = "x".repeat(MAX_CONTENT_PREVIEW + 40);
		const body = buildPushBody(
			{ type: "new_comment", payload: { authorName: "Bob", contentPreview: long } },
			mkOcc(),
			{} as any,
			[]
		);
		expect(body).toBe(`Bob : ${"x".repeat(MAX_CONTENT_PREVIEW)}…`);
	});

	it("buildPushBody(new_comment) strip les sauts de ligne du preview", () => {
		const body = buildPushBody(
			{ type: "new_comment", payload: { authorName: "Bob", contentPreview: "ligne1\nligne2" } },
			mkOcc(),
			{} as any,
			[]
		);
		expect(body).toBe("Bob : ligne1 ligne2");
	});
});
