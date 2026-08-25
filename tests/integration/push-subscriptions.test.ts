/**
 * Tests d'intégration — collection `push_subscriptions` (multi-appareils).
 *
 * Périmètre :
 *   - Règles API : l'endpoint push est une capability URL — aucune lecture
 *     croisée possible (list/view filtrés par `user = @request.auth.id`),
 *     create/update/delete réservés au owner.
 *   - Cascade : suppression du user → rows supprimées (onDelete: cascade).
 *   - Unicité : index unique sur `endpoint` — un appareil = un owner actif.
 *   - Endpoints POST/DELETE /api/push-subscription : upsert idempotent par
 *     endpoint avec transfert d'ownership, retrait owner-only (404 sinon).
 *
 * NB : le backfill de la migration `1787565923_push_subscriptions.js`
 * (users.push_subscription JSON → rows) a été validé pendant le développement
 * puis son test retiré : une migration de données est à usage unique et ne
 * se modifie plus après application — un test de rejeu câblé sur la position
 * dans la pile (`migrate down N`) casse à chaque nouvelle migration.
 */
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import PocketBase from "pocketbase";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	authenticateAdmin,
	authenticateUser,
	cleanupTrackedRecords,
	clearTrackedIds,
	dateInDays,
	seedUser,
	trackIds
} from "./seed";

const execFileAsync = promisify(execFile);

const PB_BIN = path.resolve("pocketbase/pocketbase");
const MIGRATIONS_DIR = path.resolve("pocketbase/pb_migrations");
const PB_URL = process.env.VITE_PLANNING_PB_URL || "http://127.0.0.1:8090";
const USER_A_EMAIL = "push-a@test.com";
const USER_A_PWD = "password123";
const USER_B_EMAIL = "push-b@test.com";
const USER_B_PWD = "password456";

const VALID_SUBSCRIPTION = {
	endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint-abc",
	expirationTime: null,
	keys: {
		p256dh: "p256dh-key-base64url",
		auth: "auth-key-base64url"
	}
};

/** Row push_subscriptions via admin (contourne les API Rules pour semer). */
async function seedSubscription(userId: string, overrides?: Record<string, unknown>) {
	const adminPb = await authenticateAdmin();
	return await adminPb.collection("push_subscriptions").create({
		user: userId,
		endpoint: `https://push.example.com/${Math.random().toString(36).slice(2)}`,
		p256dh: "seeded-p256dh",
		auth: "seeded-auth",
		...overrides
	});
}

async function adminListSubscriptions(filter: string) {
	const adminPb = await authenticateAdmin();
	return await adminPb.collection("push_subscriptions").getFullList({ filter });
}

describe("push_subscriptions — règles API (capability URL)", () => {
	beforeEach(() => {
		clearTrackedIds();
	});

	afterEach(async () => {
		await cleanupTrackedRecords();
	});

	it("user A liste et supprime ses rows ; user B ne voit ni ne supprime celles de A", async () => {
		const userA = await seedUser(USER_A_EMAIL, USER_A_PWD, "Alice Push");
		trackIds("users", userA.id);
		const userB = await seedUser(USER_B_EMAIL, USER_B_PWD, "Bob Push");
		trackIds("users", userB.id);

		const rowA = await seedSubscription(userA.id);

		const pbA = await authenticateUser(USER_A_EMAIL, USER_A_PWD);
		const pbB = await authenticateUser(USER_B_EMAIL, USER_B_PWD);

		// listRule : B ne voit que ses propres rows (aucune)
		const listB = await pbB.collection("push_subscriptions").getFullList();
		expect(listB).toHaveLength(0);

		// viewRule : B ne peut pas voir la row de A directement (404)
		await expect(pbB.collection("push_subscriptions").getOne(rowA.id)).rejects.toMatchObject({
			status: 404
		});

		// deleteRule : B ne peut pas supprimer la row de A (404 — pas de fuite d'existence)
		await expect(pbB.collection("push_subscriptions").delete(rowA.id)).rejects.toMatchObject({
			status: 404
		});

		// A liste et supprime ses rows
		const listA = await pbA.collection("push_subscriptions").getFullList();
		expect(listA).toHaveLength(1);
		expect(listA[0].endpoint).toBe(rowA.endpoint);
		await pbA.collection("push_subscriptions").delete(rowA.id);
		expect(await adminListSubscriptions(`id = "${rowA.id}"`)).toHaveLength(0);
	});

	it("createRule exige user = @request.auth.id : B ne peut pas créer une row au nom de A", async () => {
		const userA = await seedUser(USER_A_EMAIL, USER_A_PWD, "Alice Push");
		trackIds("users", userA.id);
		const userB = await seedUser(USER_B_EMAIL, USER_B_PWD, "Bob Push");
		trackIds("users", userB.id);

		const pbB = await authenticateUser(USER_B_EMAIL, USER_B_PWD);

		await expect(
			pbB.collection("push_subscriptions").create({
				user: userA.id,
				endpoint: "https://push.example.com/forge",
				p256dh: "k",
				auth: "k"
			})
		).rejects.toMatchObject({ status: 400 });

		// B peut créer pour lui-même
		const own = await pbB.collection("push_subscriptions").create({
			user: userB.id,
			endpoint: "https://push.example.com/own",
			p256dh: "k",
			auth: "k"
		});
		expect(own.user).toBe(userB.id);
	});
});

describe("push_subscriptions — cascade et unicité", () => {
	beforeEach(() => {
		clearTrackedIds();
	});

	afterEach(async () => {
		await cleanupTrackedRecords();
	});

	it("suppression du user → ses rows supprimées en cascade", async () => {
		const userA = await seedUser(USER_A_EMAIL, USER_A_PWD, "Alice Cascade");
		trackIds("users", userA.id);

		await seedSubscription(userA.id, { endpoint: "https://push.example.com/dev1" });
		await seedSubscription(userA.id, { endpoint: "https://push.example.com/dev2" });
		expect(await adminListSubscriptions(`user = "${userA.id}"`)).toHaveLength(2);

		const adminPb = await authenticateAdmin();
		await adminPb.collection("users").delete(userA.id);

		expect(await adminListSubscriptions(`user = "${userA.id}"`)).toHaveLength(0);
	});

	it("deux creates avec le même endpoint → le second échoue (index unique)", async () => {
		const userA = await seedUser(USER_A_EMAIL, USER_A_PWD, "Alice Unique");
		trackIds("users", userA.id);
		const userB = await seedUser(USER_B_EMAIL, USER_B_PWD, "Bob Unique");
		trackIds("users", userB.id);

		const endpoint = "https://push.example.com/duplicate";
		await seedSubscription(userA.id, { endpoint });

		await expect(seedSubscription(userB.id, { endpoint })).rejects.toMatchObject({ status: 400 });
		// Toujours une seule row pour cet endpoint, possédée par A
		const rows = await adminListSubscriptions(`endpoint = "${endpoint}"`);
		expect(rows).toHaveLength(1);
		expect(rows[0].user).toBe(userA.id);
	});
});

describe("POST/DELETE /api/push-subscription — upsert et retrait", () => {
	beforeEach(() => {
		clearTrackedIds();
	});

	afterEach(async () => {
		await cleanupTrackedRecords();
	});

	/** Client PB sans auth — pour les cas 401. */
	function guestClient() {
		return new PocketBase(PB_URL);
	}

	/** POST /api/push-subscription sur un client authentifié. */
	function postSubscription(client: PocketBase, subscription: unknown, userAgent?: string) {
		return client.send<{ record: { id: string } }>("/api/push-subscription", {
			method: "POST",
			body: { subscription, userAgent }
		});
	}

	/** DELETE /api/push-subscription (body { endpoint }) sur un client authentifié. */
	function deleteSubscription(client: PocketBase, endpoint: string) {
		return client.send<{ success: boolean }>("/api/push-subscription", {
			method: "DELETE",
			body: { endpoint }
		});
	}

	it("POST crée la row depuis zéro (user, clés, user_agent, refreshed_at)", async () => {
		const userA = await seedUser(USER_A_EMAIL, USER_A_PWD, "Alice Push");
		trackIds("users", userA.id);
		const pbA = await authenticateUser(USER_A_EMAIL, USER_A_PWD);

		const endpoint = "https://push.example.com/endpoint-create";
		const res = await postSubscription(
			pbA,
			{ ...VALID_SUBSCRIPTION, endpoint },
			"Chrome sur Android"
		);

		const rows = await adminListSubscriptions(`endpoint = "${endpoint}"`);
		expect(rows).toHaveLength(1);
		expect(rows[0].id).toBe(res.record.id);
		expect(rows[0].user).toBe(userA.id);
		expect(rows[0].p256dh).toBe(VALID_SUBSCRIPTION.keys.p256dh);
		expect(rows[0].auth).toBe(VALID_SUBSCRIPTION.keys.auth);
		expect(rows[0].user_agent).toBe("Chrome sur Android");
		expect(rows[0].refreshed_at).toBeTruthy();
	});

	it("POST idempotent : même endpoint même user → 1 row, clés et refreshed_at rafraîchis", async () => {
		const userA = await seedUser(USER_A_EMAIL, USER_A_PWD, "Alice Push");
		trackIds("users", userA.id);
		const pbA = await authenticateUser(USER_A_EMAIL, USER_A_PWD);

		const endpoint = "https://push.example.com/endpoint-idempotent";
		await postSubscription(pbA, {
			...VALID_SUBSCRIPTION,
			endpoint,
			keys: { p256dh: "key-1", auth: "auth-1" }
		});

		// Vieillir refreshed_at via admin : deux POST dans la même milliseconde
		// donneraient un timestamp identique — impossible d'observer le refresh.
		const adminPb = await authenticateAdmin();
		const seeded = await adminListSubscriptions(`endpoint = "${endpoint}"`);
		expect(seeded).toHaveLength(1);
		await adminPb.collection("push_subscriptions").update(seeded[0].id, {
			refreshed_at: "2020-01-01 00:00:00.000Z"
		});

		await postSubscription(
			pbA,
			{ ...VALID_SUBSCRIPTION, endpoint, keys: { p256dh: "key-2", auth: "auth-2" } },
			"Firefox sur Linux"
		);

		const rows = await adminListSubscriptions(`endpoint = "${endpoint}"`);
		expect(rows).toHaveLength(1);
		expect(rows[0].p256dh).toBe("key-2");
		expect(rows[0].auth).toBe("auth-2");
		expect(rows[0].user_agent).toBe("Firefox sur Linux");
		expect(rows[0].refreshed_at).not.toBe("2020-01-01 00:00:00.000Z");
	});

	it("POST transfert d'ownership : B soumet l'endpoint de A → la row devient à B", async () => {
		const userA = await seedUser(USER_A_EMAIL, USER_A_PWD, "Alice Push");
		trackIds("users", userA.id);
		const userB = await seedUser(USER_B_EMAIL, USER_B_PWD, "Bob Push");
		trackIds("users", userB.id);
		const pbA = await authenticateUser(USER_A_EMAIL, USER_A_PWD);
		const pbB = await authenticateUser(USER_B_EMAIL, USER_B_PWD);

		const endpoint = "https://push.example.com/endpoint-transfer";
		await postSubscription(pbA, { ...VALID_SUBSCRIPTION, endpoint });
		await postSubscription(pbB, { ...VALID_SUBSCRIPTION, endpoint });

		const rows = await adminListSubscriptions(`endpoint = "${endpoint}"`);
		expect(rows).toHaveLength(1);
		expect(rows[0].user).toBe(userB.id);
		// A n'a plus aucune row — l'appareil appartient désormais à B
		expect(await adminListSubscriptions(`user = "${userA.id}"`)).toHaveLength(0);
		expect(await adminListSubscriptions(`user = "${userB.id}"`)).toHaveLength(1);
	});

	it("POST 400 si endpoint ou keys manquent ; aucune row créée", async () => {
		const userA = await seedUser(USER_A_EMAIL, USER_A_PWD, "Alice Push");
		trackIds("users", userA.id);
		const pbA = await authenticateUser(USER_A_EMAIL, USER_A_PWD);

		const base = { ...VALID_SUBSCRIPTION, endpoint: "https://push.example.com/endpoint-invalid" };
		await expect(postSubscription(pbA, { ...base, endpoint: undefined })).rejects.toMatchObject({
			status: 400
		});
		await expect(postSubscription(pbA, { ...base, keys: { auth: "a" } })).rejects.toMatchObject({
			status: 400
		});
		await expect(postSubscription(pbA, { ...base, keys: { p256dh: "p" } })).rejects.toMatchObject({
			status: 400
		});
		await expect(postSubscription(pbA, undefined)).rejects.toMatchObject({ status: 400 });

		expect(await adminListSubscriptions(`user = "${userA.id}"`)).toHaveLength(0);
	});

	it("POST et DELETE sans auth → 401", async () => {
		const guest = guestClient();
		await expect(postSubscription(guest, VALID_SUBSCRIPTION)).rejects.toMatchObject({
			status: 401
		});
		await expect(
			deleteSubscription(guest, "https://push.example.com/endpoint-noauth")
		).rejects.toMatchObject({ status: 401 });
	});

	it("DELETE par le owner supprime la row", async () => {
		const userA = await seedUser(USER_A_EMAIL, USER_A_PWD, "Alice Push");
		trackIds("users", userA.id);
		const pbA = await authenticateUser(USER_A_EMAIL, USER_A_PWD);

		const endpoint = "https://push.example.com/endpoint-delete-owner";
		await postSubscription(pbA, { ...VALID_SUBSCRIPTION, endpoint });

		await expect(deleteSubscription(pbA, endpoint)).resolves.toMatchObject({ success: true });
		expect(await adminListSubscriptions(`endpoint = "${endpoint}"`)).toHaveLength(0);
	});

	it("DELETE par un non-owner → 404 et row intacte ; endpoint inconnu → 404", async () => {
		const userA = await seedUser(USER_A_EMAIL, USER_A_PWD, "Alice Push");
		trackIds("users", userA.id);
		const userB = await seedUser(USER_B_EMAIL, USER_B_PWD, "Bob Push");
		trackIds("users", userB.id);
		const pbA = await authenticateUser(USER_A_EMAIL, USER_A_PWD);
		const pbB = await authenticateUser(USER_B_EMAIL, USER_B_PWD);

		const endpoint = "https://push.example.com/endpoint-delete-nonowner";
		await postSubscription(pbA, { ...VALID_SUBSCRIPTION, endpoint });

		await expect(deleteSubscription(pbB, endpoint)).rejects.toMatchObject({ status: 404 });
		await expect(
			deleteSubscription(pbB, "https://push.example.com/endpoint-unknown")
		).rejects.toMatchObject({ status: 404 });

		const rows = await adminListSubscriptions(`endpoint = "${endpoint}"`);
		expect(rows).toHaveLength(1);
		expect(rows[0].user).toBe(userA.id);
	});
});

// ============================================================================
// Boucle d'envoi multi-appareils — sendPushNotification (notify-utils.cjs)
//
// L'URL du notify-service est lue par le hook via $os.getenv('NOTIFY_SERVICE_URL')
// dans le PROCESSUS PocketBase. Le serveur principal (127.0.0.1:8090) étant
// lancé hors harness avec une env figée, ces tests spawnent une instance PB
// dédiée (data dir temporaire, migrations + hooks du repo chargés via
// --hooksDir) en injectant NOTIFY_SERVICE_URL vers un stub HTTP local qui
// capture les POST /notify et simule les 410 par endpoint.
//
// Déclencheur : hook notify-on-occurrence-update — update de startTime sur une
// occurrence future → event schedule_change → push immédiat aux prefs
// push:true + onOccurrenceChange:true (chemin appelant réel, inchangé).
// ============================================================================

interface CapturedNotify {
	endpoint: string;
	p256dh: string;
	auth: string;
	title: string;
	body: string;
	url: string;
}

interface NotifyStub {
	notifyUrl: string;
	requests: CapturedNotify[];
	/** Endpoints pour lesquels répondre 410 (subscription morte). */
	goneEndpoints: Set<string>;
	close(): Promise<void>;
}

/** Stub HTTP du notify-service : capture chaque POST /notify (contrat du vrai
 * service : 200 nominal, 410 si le push service considère la subscription morte). */
function startNotifyStub(): Promise<NotifyStub> {
	const requests: CapturedNotify[] = [];
	const goneEndpoints = new Set<string>();
	const server = http.createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", () => {
			let payload: {
				subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
				title?: string;
				body?: string;
				url?: string;
			} = {};
			try {
				payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
			} catch {
				// body illisible : capturé vide, l'assertion de forme échouera
			}
			const sub = payload.subscription ?? {};
			requests.push({
				endpoint: sub.endpoint ?? "",
				p256dh: sub.keys?.p256dh ?? "",
				auth: sub.keys?.auth ?? "",
				title: payload.title ?? "",
				body: payload.body ?? "",
				url: payload.url ?? ""
			});
			const status = sub.endpoint && goneEndpoints.has(sub.endpoint) ? 410 : 200;
			res.writeHead(status, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ success: status === 200 }));
		});
	});
	return new Promise((resolve, reject) => {
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			if (!addr || typeof addr !== "object") {
				reject(new Error("notify stub non bindé"));
				return;
			}
			resolve({
				notifyUrl: `http://127.0.0.1:${addr.port}/notify`,
				requests,
				goneEndpoints,
				close: () => new Promise<void>((r) => server.close(() => r()))
			});
		});
	});
}

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.on("error", reject);
		srv.listen(0, "127.0.0.1", () => {
			const addr = srv.address();
			if (!addr || typeof addr !== "object") {
				reject(new Error("pas de port libre"));
				return;
			}
			const { port } = addr;
			srv.close(() => resolve(port));
		});
	});
}

async function waitForPb(url: string, timeoutMs = 20000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastErr: unknown = null;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`${url}/api/health`);
			if (res.ok) return;
		} catch (err) {
			lastErr = err;
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error(`instance PB jetable injoignable sur ${url} (${String(lastErr)})`);
}

describe("push_subscriptions — boucle d'envoi multi-appareils", () => {
	const HOOKS_DIR = path.resolve("pocketbase/pb_hooks");
	let stub: NotifyStub;
	let pbUrl: string;
	let admin: PocketBase;
	let pbChild: ChildProcess;
	let pbDataDir: string;

	beforeAll(async () => {
		stub = await startNotifyStub();
		pbDataDir = mkdtempSync(path.join(tmpdir(), "oupla-pb-pushloop-"));
		const port = await freePort();
		pbUrl = `http://127.0.0.1:${port}`;

		await execFileAsync(PB_BIN, [
			"migrate",
			"up",
			"--dir",
			pbDataDir,
			"--migrationsDir",
			MIGRATIONS_DIR
		]);
		await execFileAsync(PB_BIN, [
			"superuser",
			"upsert",
			"test@example.com",
			"testpassword",
			"--dir",
			pbDataDir
		]);

		pbChild = spawn(
			PB_BIN,
			[
				"serve",
				"--http",
				`127.0.0.1:${port}`,
				"--dir",
				pbDataDir,
				"--migrationsDir",
				MIGRATIONS_DIR,
				"--hooksDir",
				HOOKS_DIR,
				"--hooksWatch=false"
			],
			{
				env: { ...process.env, NOTIFY_SERVICE_URL: stub.notifyUrl },
				stdio: ["ignore", "ignore", "pipe"]
			}
		);
		// stderr visible pour diagnostiquer un échec de démarrage de l'instance.
		pbChild.stderr?.on("data", (d) => process.stderr.write(`[pb-jetable] ${d}`));

		await waitForPb(pbUrl);
		admin = new PocketBase(pbUrl);
		await admin.collection("_superusers").authWithPassword("test@example.com", "testpassword");
	}, 60_000);

	afterAll(async () => {
		if (pbChild) {
			await new Promise<void>((resolve) => {
				pbChild.once("exit", () => resolve());
				pbChild.kill("SIGTERM");
				setTimeout(() => {
					pbChild.kill("SIGKILL");
					resolve();
				}, 3000).unref();
			});
		}
		if (pbDataDir) rmSync(pbDataDir, { recursive: true, force: true });
		await stub?.close();
	});

	beforeEach(() => {
		stub.requests.length = 0;
		stub.goneEndpoints.clear();
	});

	interface PushRow {
		endpoint: string;
		p256dh: string;
		auth: string;
	}

	/** User + planning + occ future + prefs push/onOccurrenceChange + N rows
	 * push_subscriptions — le minimum pour être destinataire d'un schedule_change. */
	async function seedPushLoopScenario(pushRows: PushRow[]) {
		const suffix = Math.random().toString(36).slice(2, 10);
		const email = `push-loop-${suffix}@test.com`;
		const user = await admin.collection("users").create({
			email,
			password: "password123",
			passwordConfirm: "password123",
			name: "Push Loop",
			emailVisibility: true,
			verified: true
		});
		const participant = {
			id: `p-pushloop-${suffix}`,
			name: "Push Loop",
			email,
			isAdmin: true,
			createdAt: new Date().toISOString(),
			userId: user.id
		};
		const adminToken = Array.from({ length: 64 }, () =>
			Math.floor(Math.random() * 16).toString(16)
		).join("");
		const participantToken = Array.from({ length: 32 }, () =>
			Math.floor(Math.random() * 16).toString(16)
		).join("");
		const master = await admin.collection("planning_masters").create({
			title: `Push Loop ${suffix}`,
			defaultStartTime: "09:00",
			defaultEndTime: "17:00",
			recurrence: { type: "CUSTOM" },
			tasks: [],
			participants: [participant],
			minPresentRequired: 1,
			allowResponses: true,
			toConfirm: false,
			availableResponseTypes: ["present", "absent"],
			adminToken,
			participantToken,
			lastModifiedBy: ""
		});
		const occ = await admin.collection("planning_occurrences").create({
			master: master.id,
			date: dateInDays(3),
			startTime: "09:00",
			endTime: "17:00",
			responses: [
				{
					participantId: participant.id,
					response: "present",
					tasks: [],
					respondedAt: new Date().toISOString()
				}
			],
			comments: [],
			tasks: [],
			isConfirmed: false,
			isCanceled: false,
			lastModifiedBy: ""
		});
		await admin.collection("planning_participants").create({
			planning: master.id,
			user: user.id,
			email: false,
			push: true,
			reminderDays: [],
			missingDays: [],
			onOccurrenceChange: true
		});
		for (const row of pushRows) {
			await admin.collection("push_subscriptions").create({ user: user.id, ...row });
		}
		return { user, occ, participantToken };
	}

	/** Déclenche le push immédiat : update de startTime → schedule_change. */
	async function triggerScheduleChangePush(occId: string) {
		await admin.collection("planning_occurrences").update(occId, { startTime: "10:30" });
		// Les hooks JSVM s'exécutent dans le cycle de la requête ; léger délai pour
		// laisser committer les deletes de rows (pattern de runNotificationsCron).
		await new Promise((r) => setTimeout(r, 500));
	}

	it("user avec 2 rows → 2 POST avec les subscriptions reconstituées ; rows conservées", async () => {
		const rows = [
			{
				endpoint: "https://push.example.com/loop-dev1",
				p256dh: "p256dh-loop-dev1",
				auth: "auth-loop-dev1"
			},
			{
				endpoint: "https://push.example.com/loop-dev2",
				p256dh: "p256dh-loop-dev2",
				auth: "auth-loop-dev2"
			}
		];
		const { user, occ, participantToken } = await seedPushLoopScenario(rows);
		await triggerScheduleChangePush(occ.id);

		expect(stub.requests).toHaveLength(2);
		const byEndpoint = new Map(stub.requests.map((r) => [r.endpoint, r]));
		for (const seeded of rows) {
			const captured = byEndpoint.get(seeded.endpoint);
			expect(captured, `POST manquant pour ${seeded.endpoint}`).toBeDefined();
			expect(captured?.p256dh).toBe(seeded.p256dh);
			expect(captured?.auth).toBe(seeded.auth);
			expect(captured?.url).toBe(`https://planning.oupla.net/p/${participantToken}`);
		}

		// Réponses 200 partout → aucune row nettoyée
		const remaining = await admin
			.collection("push_subscriptions")
			.getFullList({ filter: `user = "${user.id}"` });
		expect(remaining).toHaveLength(2);
	});

	it("410 sur la row 1 → row 1 supprimée, row 2 conservée et notifiée", async () => {
		const gone = {
			endpoint: "https://push.example.com/loop-gone",
			p256dh: "p256dh-loop-gone",
			auth: "auth-loop-gone"
		};
		const alive = {
			endpoint: "https://push.example.com/loop-alive",
			p256dh: "p256dh-loop-alive",
			auth: "auth-loop-alive"
		};
		const { user, occ } = await seedPushLoopScenario([gone, alive]);
		stub.goneEndpoints.add(gone.endpoint);
		await triggerScheduleChangePush(occ.id);

		// L'échec d'une row n'interrompt pas l'envoi aux autres appareils
		expect(stub.requests).toHaveLength(2);
		expect(stub.requests.map((r) => r.endpoint).sort()).toEqual(
			[alive.endpoint, gone.endpoint].sort()
		);

		const remaining = await admin
			.collection("push_subscriptions")
			.getFullList({ filter: `user = "${user.id}"` });
		expect(remaining).toHaveLength(1);
		expect(remaining[0].endpoint).toBe(alive.endpoint);
	});

	it("user sans row → aucun POST, pas d'erreur", async () => {
		const { occ } = await seedPushLoopScenario([]);
		await expect(triggerScheduleChangePush(occ.id)).resolves.toBeUndefined();
		expect(stub.requests).toHaveLength(0);
	});
});
