/**
 * Tests d'intégration — Cycle de vie soft-delete des plannings.
 *
 * Périmètre (comportement externe uniquement — SDK avec _token, cron superuser,
 * capture SMTP locale) :
 *   - Soft-delete par adminToken : deletedAt forgé serveur, participant bloqué
 *   - Emails terminaux de suppression/restauration : tous les participants
 *     identifiés, prefs planning_participants ignorées (événement terminal)
 *   - Lecture seule du master supprimé : occurrences, prefs, master lui-même
 *   - Hard-delete API bloqué (la fenêtre de grâce ne se contourne pas)
 *   - Purge cron `planning-purge` : cascade + nettoyage d'identité (masterId,
 *     adminOf) + accès post-purge 404
 *   - Race purge↔restauration : la restauration gagne
 *
 * Prérequis :
 *   - PocketBase démarré sur http://127.0.0.1:8090 (./pocketbase serve --dev)
 *   - Admin de test créé (test@example.com / testpassword)
 */
import net from "net";
import PocketBase from "pocketbase";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	authenticateAdmin,
	cleanupTrackedRecords,
	clearTrackedIds,
	seedParticipantPrefs,
	seedPlanning,
	seedUser
} from "./seed";

const PB_URL = process.env.VITE_PLANNING_PB_URL || "http://127.0.0.1:8090";

// Client PB sans auth — communique uniquement via le token en query param,
// comme un vrai client guest. Les hooks (token check, gardes) s'appliquent.
function tokenClient(): PocketBase {
	return new PocketBase(PB_URL);
}

const suffix = () => Math.random().toString(36).slice(2, 10);

/** Date PB "YYYY-MM-DD HH:MM:SS.mmmZ" à N jours dans le passé. */
function pbDaysAgo(days: number): string {
	const d = new Date();
	d.setUTCDate(d.getUTCDate() - days);
	return d.toISOString().replace("T", " ");
}

async function expect403(fn: () => Promise<unknown>) {
	let caught: unknown;
	try {
		await fn();
	} catch (err) {
		caught = err;
	}
	expect(caught).toBeDefined();
	expect((caught as { status?: number })?.status).toBe(403);
}

// ============================================================================
// SMTP stub — rend observables les envois d'email des hooks.
//
// Extension du pattern de notifications-cron.test.ts : capture AUSSI les lignes
// RCPT TO de chaque message (l'email terminal doit atteindre chaque
// destinataire individuellement, prefs ignorées). Les settings sont restaurés
// en finally.
// ============================================================================

interface SmtpCapture {
	count: number;
	subjects: string[];
	rcpts: string[];
}

/** Décode les encoded-words RFC 2047 (Q-encoding UTF-8 utilisé par PB). */
function decodeMimeHeader(str: string): string {
	// RFC 2047 §6.2 : les espaces entre encoded-words adjacents sont supprimés
	// et les mots concaténés, sinon un sujet coupé entre deux encoded-words
	// rendrait les assertions fragiles.
	let merged = str;
	while (/\?=\s+=\?/.test(merged)) {
		merged = merged.replace(/\?=\s+=\?/g, "?==?");
	}
	return merged.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_m, charset, enc, text) => {
		const isUtf8 = charset.toLowerCase() === "utf-8";
		if (enc.toUpperCase() === "Q") {
			const latin = text
				.replace(/_/g, " ")
				.replace(/=([0-9A-Fa-f]{2})/g, (_h: string, h: string) =>
					String.fromCharCode(parseInt(h, 16))
				);
			if (!isUtf8) return latin;
			// Les octets UTF-8 multi-bytes (—, é…) arrivent comme chars latin-1 :
			// on reconstruit le flux d'octets puis on décode en UTF-8.
			const bytes = Uint8Array.from(latin, (ch: string) => ch.charCodeAt(0));
			return new TextDecoder("utf-8").decode(bytes);
		}
		return Buffer.from(text, "base64").toString(isUtf8 ? "utf8" : "binary");
	});
}

async function startSmtpStub(capture: SmtpCapture): Promise<net.Server> {
	const server = net.createServer((socket) => {
		let mode: "command" | "data" = "command";
		let buf = "";
		let dataAccum = "";
		let currentRcpts: string[] = [];
		socket.write("220 smtp.stub ESMTP\r\n");
		const handleLines = () => {
			while (true) {
				const idx = buf.indexOf("\r\n");
				if (idx === -1) break;
				const line = buf.slice(0, idx);
				buf = buf.slice(idx + 2);
				if (mode === "data") {
					if (line === ".") {
						capture.count++;
						const m = dataAccum.match(/^Subject: (.*)$/m);
						if (m) capture.subjects.push(decodeMimeHeader(m[1].trim()));
						capture.rcpts.push(...currentRcpts);
						mode = "command";
						dataAccum = "";
						currentRcpts = [];
						socket.write("250 OK queued\r\n");
					} else {
						dataAccum += line + "\r\n";
					}
					continue;
				}
				if (line.startsWith("EHLO") || line.startsWith("HELO")) {
					// Pas d'AUTH ni STARTTLS annoncés → le client Go n'authentifie pas.
					socket.write("250-smtp.stub\r\n250 OK\r\n");
				} else if (line.startsWith("MAIL FROM:")) {
					currentRcpts = [];
					socket.write("250 OK\r\n");
				} else if (line.startsWith("RCPT TO:")) {
					const m = line.match(/^RCPT TO:\s*<([^>]+)>/i);
					if (m) currentRcpts.push(m[1].toLowerCase());
					socket.write("250 OK\r\n");
				} else if (line.startsWith("RSET") || line.startsWith("NOOP")) {
					socket.write("250 OK\r\n");
				} else if (line.startsWith("DATA")) {
					mode = "data";
					dataAccum = "";
					socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
				} else if (line.startsWith("QUIT")) {
					socket.write("221 Bye\r\n");
					socket.end();
					return;
				} else {
					socket.write("250 OK\r\n");
				}
			}
		};
		socket.on("data", (c: Buffer) => {
			buf += c.toString();
			handleLines();
		});
		socket.on("error", () => {
			/* socket fermée par le client — ignore */
		});
	});
	return new Promise((resolve, reject) => {
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => resolve(server));
	});
}

/**
 * Exécute `fn` en ayant redirigé le SMTP PocketBase vers un stub local qui
 * capture les messages. Restaure les settings SMTP d'origine en finally.
 */
async function withSmtpStub<T>(
	adminPb: PocketBase,
	fn: (capture: SmtpCapture) => Promise<T>
): Promise<T> {
	const capture: SmtpCapture = { count: 0, subjects: [], rcpts: [] };
	const server = await startSmtpStub(capture);
	const originalSmtp = (await adminPb.settings.getAll()).smtp;
	const addr = server.address();
	if (!addr || typeof addr !== "object") throw new Error("SMTP stub non bindé");
	try {
		await adminPb.settings.update({
			smtp: {
				enabled: true,
				host: "127.0.0.1",
				port: addr.port,
				username: "",
				password: "",
				tls: false,
				authMethod: "PLAIN",
				localName: "localhost"
			}
		});
		return await fn(capture);
	} finally {
		await adminPb.settings.update({ smtp: originalSmtp });
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}

/** Déclenche le cron planning-purge via l'API superuser et attend le commit. */
async function runPurgeCron(pb: PocketBase): Promise<void> {
	await pb.crons.run("planning-purge");
	await new Promise((resolve) => setTimeout(resolve, 500));
}

describe("Planning deletion — soft-delete, fenêtre de grâce et purge", () => {
	beforeEach(() => {
		clearTrackedIds();
	});
	afterEach(async () => {
		await cleanupTrackedRecords();
	});

	it("soft-delete par adminToken forge deletedAt côté serveur ; participant bloqué (403)", async () => {
		const { master, adminToken, participantToken } = await seedPlanning({
			title: "Deletion SoftDelete Guard",
			occurrenceCount: 1
		});

		const client = tokenClient();
		const updated = await client
			.collection("planning_masters")
			.update(master.id, { deleted: true }, { query: { _token: adminToken } });
		expect(updated.deleted).toBe(true);

		// Vérification serveur : deletedAt forgé par le hook, jamais trusté du client.
		const adminPb = await authenticateAdmin();
		const fresh = await adminPb.collection("planning_masters").getOne(master.id);
		expect(fresh.deleted).toBe(true);
		expect(fresh.deletedAt).toBeTruthy();

		// Participant : l'allowlist existante de main.pb.js bloque le champ `deleted`.
		await expect403(() =>
			client
				.collection("planning_masters")
				.update(master.id, { deleted: true }, { query: { _token: participantToken } })
		);
	});

	it("suppression puis restauration : emails envoyés à tous les participants identifiés (prefs ignorées)", async () => {
		const adminPb = await authenticateAdmin();

		const emailA = `del-a-${suffix()}@test.com`;
		const emailB = `del-b-${suffix()}@test.com`;
		const userA = await seedUser(emailA, "password123", "Alice");
		const userB = await seedUser(emailB, "password123", "Bob");

		const now = new Date().toISOString();
		const { master, adminToken } = await seedPlanning({
			title: "Deletion Emails Planning",
			participants: [
				{ id: "p1", name: "Alice", isAdmin: true, createdAt: now, userId: userA.id },
				{ id: "p2", name: "Bob", isAdmin: false, createdAt: now, userId: userB.id },
				{ id: "g1", name: "Guest", isAdmin: false, createdAt: now }
			] as never,
			occurrenceCount: 0
		});
		// Bob a coupé les emails — événement terminal, il doit quand même être notifié.
		await seedParticipantPrefs(master.id, userB.id, { email: false });

		await withSmtpStub(adminPb, async (capture) => {
			const client = tokenClient();

			// === Suppression ===
			await client
				.collection("planning_masters")
				.update(master.id, { deleted: true }, { query: { _token: adminToken } });

			expect(capture.count).toBe(2);
			for (const s of capture.subjects) {
				expect(s).toContain("supprimé");
				expect(s).toContain("Deletion Emails Planning");
			}
			// 2 destinataires : Alice et Bob (guest sans compte exclu).
			expect(capture.rcpts).toHaveLength(2);
			expect(capture.rcpts).toContain(emailA);
			expect(capture.rcpts).toContain(emailB);

			const rcptsAfterDelete = [...capture.rcpts];
			const countAfterDelete = capture.count;

			// === Restauration ===
			const restored = await client
				.collection("planning_masters")
				.update(master.id, { deleted: false }, { query: { _token: adminToken } });
			expect(restored.deleted).toBe(false);

			const fresh = await adminPb.collection("planning_masters").getOne(master.id);
			expect(fresh.deletedAt).toBe("");

			expect(capture.count).toBe(countAfterDelete + 2);
			const restoredSubjects = capture.subjects.slice(countAfterDelete);
			for (const s of restoredSubjects) {
				expect(s).toContain("restauré");
				expect(s).toContain("Deletion Emails Planning");
			}
			const restoredRcpts = capture.rcpts.slice(rcptsAfterDelete.length);
			expect(restoredRcpts).toHaveLength(2);
			expect(restoredRcpts).toContain(emailA);
			expect(restoredRcpts).toContain(emailB);
		});
	});

	it("master soft-deleté : occurrences et prefs en lecture seule, master figé sauf restauration", async () => {
		const { master, occurrences, adminToken, participantToken } = await seedPlanning({
			title: "Deletion Readonly",
			occurrenceCount: 1
		});
		const occ = occurrences[0];
		const client = tokenClient();
		await client
			.collection("planning_masters")
			.update(master.id, { deleted: true }, { query: { _token: adminToken } });

		// Update d'occurrence — par adminToken et par participantToken → 403.
		await expect403(() =>
			client
				.collection("planning_occurrences")
				.update(occ.id, { startTime: "10:00" }, { query: { _token: adminToken } })
		);
		await expect403(() =>
			client.collection("planning_occurrences").update(
				occ.id,
				{
					responses: [
						{
							participantId: "p1",
							response: "present",
							tasks: [],
							respondedAt: new Date().toISOString()
						}
					]
				},
				{ query: { _token: participantToken } }
			)
		);

		// Create d'occurrence par adminToken → 403.
		await expect403(() =>
			client.collection("planning_occurrences").create(
				{
					master: master.id,
					date: "2099-01-01",
					startTime: "09:00",
					endTime: "17:00"
				},
				{ query: { _token: adminToken } }
			)
		);

		// Prefs planning_participants par un user auth → create et update 403.
		const email = `readonly-${suffix()}@test.com`;
		const user = await seedUser(email, "password123", "Readonly User");
		const prefs = await seedParticipantPrefs(master.id, user.id);
		const authClient = new PocketBase(PB_URL);
		await authClient.collection("users").authWithPassword(email, "password123");

		await expect403(() =>
			authClient.collection("planning_participants").update(prefs.id, { email: true })
		);
		await expect403(() =>
			authClient
				.collection("planning_participants")
				.create({ planning: master.id, user: user.id, email: true })
		);

		// Master : update d'un champ autre que deleted par adminToken → 403.
		await expect403(() =>
			client
				.collection("planning_masters")
				.update(master.id, { title: "Hacked" }, { query: { _token: adminToken } })
		);
	});

	it("hard-delete API du master bloqué même avec l'adminToken (403), master intact", async () => {
		const { master, adminToken } = await seedPlanning({
			title: "Deletion HardDelete",
			occurrenceCount: 0
		});

		const client = tokenClient();
		await expect403(() =>
			client.collection("planning_masters").delete(master.id, { query: { _token: adminToken } })
		);

		const adminPb = await authenticateAdmin();
		const fresh = await adminPb.collection("planning_masters").getOne(master.id);
		expect(fresh.id).toBe(master.id);
	});

	it("purge après fenêtre de grâce : cascade, nettoyage d'identité, accès post-purge 404", async () => {
		const adminPb = await authenticateAdmin();
		const { master, occurrences, adminToken } = await seedPlanning({
			title: "Deletion Purge",
			occurrenceCount: 1
		});
		const occ = occurrences[0];

		// User avec références d'identité sur le master (non couvertes par la cascade).
		const email = `purge-${suffix()}@test.com`;
		const user = await seedUser(email, "password123", "Purge User", {
			masterIds: [master.id],
			adminOf: { [master.id]: adminToken }
		});
		// Row prefs + event de notification liés au master (couverts par la cascade).
		const prefs = await seedParticipantPrefs(master.id, user.id);
		const event = await adminPb.collection("notification_events").create({
			type: "new_comment",
			master: master.id,
			occurrence: occ.id,
			reminderValue: 0,
			changedBy: "",
			payload: {
				commentId: "c-purge",
				commentCreatedAt: new Date().toISOString(),
				authorName: "Purge",
				contentPreview: "hello"
			},
			processedAt: ""
		});

		const client = tokenClient();
		await client
			.collection("planning_masters")
			.update(master.id, { deleted: true }, { query: { _token: adminToken } });

		// Vieillir deletedAt au-delà de la fenêtre de grâce (format date PB).
		await adminPb.collection("planning_masters").update(master.id, { deletedAt: pbDaysAgo(16) });

		await runPurgeCron(adminPb);

		// Tout est purgé : master, occurrences, prefs, events.
		await expect(adminPb.collection("planning_masters").getOne(master.id)).rejects.toMatchObject({
			status: 404
		});
		await expect(adminPb.collection("planning_occurrences").getOne(occ.id)).rejects.toMatchObject({
			status: 404
		});
		await expect(
			adminPb.collection("planning_participants").getOne(prefs.id)
		).rejects.toMatchObject({ status: 404 });
		await expect(adminPb.collection("notification_events").getOne(event.id)).rejects.toMatchObject({
			status: 404
		});

		// Nettoyage des références d'identité du user.
		const userAfter = await adminPb.collection("users").getOne(user.id);
		expect(userAfter.masterId ?? []).not.toContain(master.id);
		expect(Object.keys(userAfter.adminOf ?? {})).not.toContain(master.id);

		// Accès par token après purge → 404.
		await expect(
			tokenClient()
				.collection("planning_masters")
				.getOne(master.id, {
					query: { _token: adminToken }
				})
		).rejects.toMatchObject({ status: 404 });
	});

	it("restauration avant purge : le master survit au cron (la restauration gagne la course)", async () => {
		const adminPb = await authenticateAdmin();
		const { master, adminToken } = await seedPlanning({
			title: "Deletion Race",
			occurrenceCount: 0
		});

		const client = tokenClient();
		await client
			.collection("planning_masters")
			.update(master.id, { deleted: true }, { query: { _token: adminToken } });

		// deletedAt vieilli, PUIS restauration via adminToken avant le cron.
		await adminPb.collection("planning_masters").update(master.id, { deletedAt: pbDaysAgo(16) });
		await client
			.collection("planning_masters")
			.update(master.id, { deleted: false }, { query: { _token: adminToken } });

		await runPurgeCron(adminPb);

		const fresh = await adminPb.collection("planning_masters").getOne(master.id);
		expect(fresh.deleted).toBe(false);
	});
});
