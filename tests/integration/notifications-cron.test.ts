/**
 * Tests d'intégration — Cron notifications-daily (Phase 1 + Phase 2 + push).
 *
 * Périmètre : valider end-to-end le cron `cron-notifications.pb.js` :
 *   - Phase 1 : insertion des events J-X (reminder, missings, confirmation)
 *   - Phase 2 : envoi agrégé (1 email par user/master) + marquage processedAt
 *   - Circuit breaker SMTP (3 échecs consécutifs → break)
 *   - Déduplication (occ déjà traitée → 0 nouvel event)
 *   - Push J-X pour users avec push=true
 *
 * Déclenchement du cron : `pb.crons.run('notifications-daily')` (API superuser).
 *
 * Note sur le SMTP : en dev, le SMTP configuré (`smtp.oupla.net:587`) est
 * injoignable depuis le réseau de test → les envois échouent naturellement,
 * ce qui permet de valider le circuit breaker sans mock supplémentaire.
 *
 * Prérequis :
 *   - PocketBase démarré sur http://127.0.0.1:8090
 *   - Admin de test créé (test@example.com / testpassword)
 *   - SMTP dev injoignable (comportement par défaut)
 */

import net from "net";
import type PocketBase from "pocketbase";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Participant, PlanningMaster, PlanningOccurrence } from "$lib/types/planning.types";
import type { NotificationEventsResponse } from "$lib/types/pocketbase-types";
import {
	authenticateAdmin,
	cleanupTrackedRecords,
	clearTrackedIds,
	dateInDays,
	trackIds
} from "./seed";

const PARTICIPANT_ID = "p-test-participant-0001";

/**
 * Déclenche le cron notifications-daily via l'API superuser et attend
 * un court délai pour que les effets de bord DB soient visibles.
 */
async function runNotificationsCron(pb: PocketBase): Promise<void> {
	await pb.crons.run("notifications-daily");
	// Laisser au runtime PB le temps de committer les writes du cron.
	await new Promise((resolve) => setTimeout(resolve, 500));
}

// ============================================================================
// SMTP stub — pour rendre observables les envois d'email du cron Phase 2.
//
// En dev, smtp.oupla.net:587 est injoignable depuis le réseau de test, donc
// aucun email ne part et les events ne sont jamais marqués processedAt sur
// succès SMTP. Pour valider le filtre "déjà lu" et l'agrégation (qui ne sont
// observables que via la composition du buffer email), on pointe
// temporairement PocketBase vers un serveur SMTP local qui accepte tout et
// capture le sujet de chaque message. Les settings sont restaurés en finally.
// ============================================================================

interface SmtpCapture {
	count: number;
	subjects: string[];
}

/** Décode les encoded-words RFC 2047 (Q-encoding UTF-8 utilisé par PB). */
function decodeMimeHeader(str: string): string {
	// RFC 2047 §6.2 : les espaces entre encoded-words adjacents sont supprimés
	// et les mots concaténés. Sans cette fusion, un sujet peut être coupé entre
	// deux encoded-words et rendre les assertions fragiles.
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

async function startSmtpStub(
	capture: SmtpCapture,
	opts: { rejectRcpt?: (address: string) => boolean } = {}
): Promise<net.Server> {
	const server = net.createServer((socket) => {
		let mode: "command" | "data" = "command";
		let buf = "";
		let dataAccum = "";
		socket.write("220 smtp.stub ESMTP\r\n");
		const handleLines = () => {
			for (;;) {
				const idx = buf.indexOf("\r\n");
				if (idx === -1) break;
				const line = buf.slice(0, idx);
				buf = buf.slice(idx + 2);
				if (mode === "data") {
					if (line === ".") {
						capture.count++;
						const m = dataAccum.match(/^Subject: (.*)$/m);
						if (m) capture.subjects.push(decodeMimeHeader(m[1].trim()));
						mode = "command";
						dataAccum = "";
						socket.write("250 OK queued\r\n");
					} else {
						dataAccum += line + "\r\n";
					}
					continue;
				}
				if (line.startsWith("EHLO") || line.startsWith("HELO")) {
					// Pas d'AUTH ni STARTTLS annoncés → le client Go n'authentifie pas.
					socket.write("250-smtp.stub\r\n250 OK\r\n");
				} else if (line.startsWith("RCPT TO:")) {
					// Rejet RCPT permanent (adresse morte) : simule un destinataire
					// dont la boîte rejette à tout jamais — le mailer Go échoue
					// et le cron doit retenter ce destinataire seul au run suivant.
					const addr = line.slice("RCPT TO:".length).trim();
					if (opts.rejectRcpt?.(addr)) {
						socket.write(`550 5.1.1 ${addr}: Recipient address rejected\r\n`);
						continue;
					}
					socket.write("250 OK\r\n");
				} else if (
					line.startsWith("MAIL FROM:") ||
					line.startsWith("RSET") ||
					line.startsWith("NOOP")
				) {
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
			/* socket fermé par le client — ignore */
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
	fn: (capture: SmtpCapture) => Promise<T>,
	opts: { rejectRcpt?: (address: string) => boolean } = {}
): Promise<T> {
	const capture: SmtpCapture = { count: 0, subjects: [] };
	const server = await startSmtpStub(capture, opts);
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

/**
 * Helper de seed pour un scénario cron complet :
 *   - master avec 1 participant authentifié dans `participants[]`
 *   - user en collection `users`
 *   - participant pref dans `planning_participants` (email/push/reminderDays)
 *   - occurrence à J+X avec responses[], tasks[]
 *
 * Le `participantId` est partagé entre `master.participants[].id`,
 * `occ.responses[].participantId` et la pref n'a pas besoin de le connaître
 * (elle match sur `user` uniquement).
 */
async function seedCronScenario(
	pb: PocketBase,
	options: {
		occDayOffset: number;
		recurrenceType?: string;
		toConfirm?: boolean;
		minPresentRequired?: number;
		responses?: Array<{ response: string; tasks?: string[] }>;
		tasks?: Array<{ id: string; requiredVolunteers?: number }>;
		participantPrefs?: {
			email?: boolean;
			push?: boolean;
			reminderDays?: string[];
			missingDays?: string[];
			onConfirmationNeeded?: boolean;
			onOccurrenceChange?: boolean;
		};
	}
): Promise<{ master: PlanningMaster; occ: PlanningOccurrence; userId: string }> {
	const { occDayOffset } = options;
	const recurrenceType = options.recurrenceType ?? "WEEKLY";

	// 1. User
	const email = `cron-${Math.random().toString(36).slice(2)}@test.com`;
	const user = await pb.collection("users").create({
		email,
		password: "password123",
		passwordConfirm: "password123",
		name: "Cron User",
		emailVisibility: true,
		verified: true
	});
	trackIds("users", user.id);

	// 2. Master avec participant authentifié dans participants[]
	const participant: Participant = {
		id: PARTICIPANT_ID,
		name: "Cron User",
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

	const master = await pb.collection("planning_masters").create<PlanningMaster>({
		title: `Cron Test ${occDayOffset}`,
		defaultStartTime: "09:00",
		defaultEndTime: "17:00",
		recurrence: { type: recurrenceType as never },
		tasks: (options.tasks as never) || [],
		participants: [participant as never],
		minPresentRequired: options.minPresentRequired ?? 1,
		allowResponses: true,
		toConfirm: options.toConfirm ?? false,
		availableResponseTypes: ["present", "absent"],
		adminToken,
		participantToken,
		lastModifiedBy: ""
	});
	trackIds("planning_masters", master.id);

	// 3. Occurrence avec responses mappées sur participantId
	const occResponses = (options.responses || []).map((r) => ({
		participantId: PARTICIPANT_ID,
		response: r.response,
		tasks: r.tasks || [],
		respondedAt: new Date().toISOString()
	}));
	const occ = await pb.collection("planning_occurrences").create<PlanningOccurrence>({
		master: master.id,
		date: dateInDays(occDayOffset),
		startTime: "09:00",
		endTime: "17:00",
		responses: occResponses as never,
		comments: [],
		tasks: (options.tasks as never) || [],
		isConfirmed: false,
		isCanceled: false,
		lastModifiedBy: ""
	});
	trackIds("planning_occurrences", occ.id);

	// 4. Planning_participants prefs (liaison via user, pas via participantId)
	const prefs = options.participantPrefs || {};
	await pb.collection("planning_participants").create({
		planning: master.id,
		user: user.id,
		email: prefs.email ?? true,
		push: prefs.push ?? false,
		reminderDays: prefs.reminderDays || [],
		missingDays: prefs.missingDays || [],
		onOccurrenceChange: prefs.onOccurrenceChange ?? false,
		onConfirmationNeeded: prefs.onConfirmationNeeded ?? false
	});

	return { master, occ, userId: user.id };
}

/**
 * Ajoute un second destinataire authentifié à un scénario existant : user,
 * pref planning_participants, entrée dans `master.participants[]` et réponse
 * sur l'occurrence. Sert au test multi-destinataires (doublon email).
 */
async function addRecipient(
	pb: PocketBase,
	scenario: { master: PlanningMaster; occ: PlanningOccurrence },
	options: { email?: boolean; push?: boolean; response?: string } = {}
): Promise<{ userId: string; email: string }> {
	const email = `rcp-${Math.random().toString(36).slice(2)}@test.com`;
	const user = await pb.collection("users").create({
		email,
		password: "password123",
		passwordConfirm: "password123",
		name: "Second Recipient",
		emailVisibility: true,
		verified: true
	});
	trackIds("users", user.id);

	const participantId = `p-test-participant-${Math.random().toString(36).slice(2, 8)}`;
	const participant: Participant = {
		id: participantId,
		name: "Second Recipient",
		email,
		isAdmin: false,
		createdAt: new Date().toISOString(),
		userId: user.id
	};
	const masterFresh = await pb
		.collection("planning_masters")
		.getOne<PlanningMaster>(scenario.master.id);
	await pb.collection("planning_masters").update(scenario.master.id, {
		participants: [...masterFresh.participants, participant as never]
	});

	const pp = await pb.collection("planning_participants").create({
		planning: scenario.master.id,
		user: user.id,
		email: options.email ?? true,
		push: options.push ?? false,
		reminderDays: ["3"],
		missingDays: ["3"],
		onOccurrenceChange: false,
		onConfirmationNeeded: false
	});
	trackIds("planning_participants", pp.id);

	const occFresh = await pb
		.collection("planning_occurrences")
		.getOne<PlanningOccurrence>(scenario.occ.id);
	await pb.collection("planning_occurrences").update(scenario.occ.id, {
		responses: [
			...occFresh.responses,
			{
				participantId,
				response: options.response ?? "present",
				tasks: [],
				respondedAt: new Date().toISOString()
			}
		] as never
	});

	return { userId: user.id, email };
}

/** Ligne du registre `notification_deliveries` (type local — table interne du cron). */
interface DeliveryRow {
	id: string;
	event: string;
	user: string;
	master: string;
	emailSentAt: string;
	emailWaivedAt: string;
	pushSentAt: string;
	pushWaivedAt: string;
}

async function listDeliveriesForEvent(pb: PocketBase, eventId: string): Promise<DeliveryRow[]> {
	return pb.collection("notification_deliveries").getFullList<DeliveryRow>({
		filter: `event = "${eventId}"`
	});
}

/**
 * Récupère tous les events liés à un master, triés par created.
 */
async function listEventsForMaster(
	pb: PocketBase,
	masterId: string
): Promise<NotificationEventsResponse[]> {
	return pb.collection("notification_events").getFullList<NotificationEventsResponse>({
		filter: `master = "${masterId}"`,
		sort: "created"
	});
}

/** Types d'events issus du hook C2 (notifications sur update d'occ). */
const C2_EVENT_TYPES = new Set([
	"schedule_change",
	"status_canceled",
	"status_deleted",
	"status_confirmed"
]);

/**
 * Filtre les events J-X (issus du cron Phase 1) en excluant les events C2
 * (qui peuvent être insérés en parallèle par le hook update si l'occ est
 * modifiée pendant le test).
 */
function jxEventsOnly(events: NotificationEventsResponse[]): NotificationEventsResponse[] {
	return events.filter((e) => !C2_EVENT_TYPES.has(e.type));
}

describe("Cron notifications-daily — Phase 1 (insertion events J-X)", () => {
	let adminPb: PocketBase;
	const scenarioIds: { masterId: string; userId?: string }[] = [];

	beforeEach(async () => {
		clearTrackedIds();
		adminPb = await authenticateAdmin();
		scenarioIds.length = 0;
	});

	afterEach(async () => {
		// Cleanup : events créés pendant le test (non trackés par seed.ts)
		for (const { masterId } of scenarioIds) {
			const events = await adminPb
				.collection("notification_events")
				.getFullList({ filter: `master = "${masterId}"` });
			for (const ev of events) {
				await adminPb.collection("notification_events").delete(ev.id);
			}
		}
		await cleanupTrackedRecords();
	});

	it("reminder à J-3 : pref activée + response present → 1 event reminder inséré", async () => {
		const { master } = await seedCronScenario(adminPb, {
			occDayOffset: 3,
			responses: [{ response: "present" }],
			participantPrefs: { email: true, reminderDays: ["3"] }
		});
		scenarioIds.push({ masterId: master.id });

		await runNotificationsCron(adminPb);

		const events = await listEventsForMaster(adminPb, master.id);
		const reminders = events.filter((e) => e.type === "reminder");
		expect(reminders).toHaveLength(1);
		expect(reminders[0].reminderValue).toBe(3);
		expect(reminders[0].processedAt).toBe("");
	});

	it("reminder à J-7 : pref activée → event reminder avec reminderValue=7", async () => {
		const { master } = await seedCronScenario(adminPb, {
			occDayOffset: 7,
			responses: [{ response: "present" }],
			participantPrefs: { email: true, reminderDays: ["7"] }
		});
		scenarioIds.push({ masterId: master.id });

		await runNotificationsCron(adminPb);

		const events = await listEventsForMaster(adminPb, master.id);
		const reminders = events.filter((e) => e.type === "reminder");
		expect(reminders).toHaveLength(1);
		expect(reminders[0].reminderValue).toBe(7);
	});

	it("quorum_missing à J-3 : pref missingDays + present < min → 1 event", async () => {
		const { master } = await seedCronScenario(adminPb, {
			occDayOffset: 3,
			minPresentRequired: 2,
			responses: [{ response: "present" }], // 1 present < 2 required
			participantPrefs: { email: true, missingDays: ["3"] }
		});
		scenarioIds.push({ masterId: master.id });

		await runNotificationsCron(adminPb);

		const events = await listEventsForMaster(adminPb, master.id);
		const missings = events.filter((e) => e.type === "quorum_missing");
		expect(missings).toHaveLength(1);
		expect(missings[0].reminderValue).toBe(3);
	});

	it("confirmation_needed : master toConfirm + pref onConfirmationNeeded → 1 event", async () => {
		const { master } = await seedCronScenario(adminPb, {
			occDayOffset: 3,
			recurrenceType: "WEEKLY",
			toConfirm: true,
			participantPrefs: { email: true, onConfirmationNeeded: true }
		});
		scenarioIds.push({ masterId: master.id });

		await runNotificationsCron(adminPb);

		const events = await listEventsForMaster(adminPb, master.id);
		const confirmations = events.filter((e) => e.type === "confirmation_needed");
		expect(confirmations.length).toBeGreaterThanOrEqual(1);
		expect(confirmations[0].reminderValue).toBe(3);
	});

	it("déduplication : 2 crons successifs sur la même occ → pas de doublon", async () => {
		const { master } = await seedCronScenario(adminPb, {
			occDayOffset: 3,
			responses: [{ response: "present" }],
			participantPrefs: { email: true, reminderDays: ["3"] }
		});
		scenarioIds.push({ masterId: master.id });

		await runNotificationsCron(adminPb);
		await runNotificationsCron(adminPb);

		const events = await listEventsForMaster(adminPb, master.id);
		const reminders = events.filter((e) => e.type === "reminder" && e.reminderValue === 3);
		expect(reminders).toHaveLength(1);
	});

	it("occ annulée : isCanceled=true → ignorée par Phase 1 (pas d'event J-X)", async () => {
		const { master, occ } = await seedCronScenario(adminPb, {
			occDayOffset: 3,
			responses: [{ response: "present" }],
			participantPrefs: { email: true, reminderDays: ["3"] }
		});
		scenarioIds.push({ masterId: master.id });

		// Annuler l'occ avant le cron. Note : le hook C2 va insérer un event
		// `status_canceled` en parallèle — c'est attendu et non testé ici.
		await adminPb.collection("planning_occurrences").update(occ.id, { isCanceled: true });

		await runNotificationsCron(adminPb);

		const events = await listEventsForMaster(adminPb, master.id);
		// Aucun event J-X (reminder/missings/confirmation) ne doit être inséré
		// par le cron car l'occ est annulée.
		expect(jxEventsOnly(events)).toHaveLength(0);
	});

	it("occ hors fenêtre (J+25) → ignorée par Phase 1", async () => {
		const { master } = await seedCronScenario(adminPb, {
			occDayOffset: 25,
			responses: [{ response: "present" }],
			participantPrefs: { email: true, reminderDays: ["7"] }
		});
		scenarioIds.push({ masterId: master.id });

		await runNotificationsCron(adminPb);

		const events = await listEventsForMaster(adminPb, master.id);
		expect(events).toHaveLength(0);
	});
});

describe("Cron notifications-daily — Phase 2 (envoi agrégé + circuit breaker)", () => {
	let adminPb: PocketBase;
	const scenarioIds: { masterId: string; userId?: string }[] = [];

	beforeEach(async () => {
		clearTrackedIds();
		adminPb = await authenticateAdmin();
		scenarioIds.length = 0;
	});

	afterEach(async () => {
		for (const { masterId } of scenarioIds) {
			const events = await adminPb
				.collection("notification_events")
				.getFullList({ filter: `master = "${masterId}"` });
			for (const ev of events) {
				await adminPb.collection("notification_events").delete(ev.id);
			}
		}
		await cleanupTrackedRecords();
	});

	it("circuit breaker SMTP : SMTP dev injoignable → events restent pending", async () => {
		// En dev, smtp.oupla.net:587 est injoignable depuis le réseau local de test.
		// Le cron doit échouer sur chaque envoi et déclencher le circuit breaker après
		// 3 échecs consécutifs. Les events restent `processedAt=''` (non marqués traités).
		const { master } = await seedCronScenario(adminPb, {
			occDayOffset: 3,
			responses: [{ response: "present" }],
			participantPrefs: { email: true, reminderDays: ["3"] }
		});
		scenarioIds.push({ masterId: master.id });

		await runNotificationsCron(adminPb);

		const events = await listEventsForMaster(adminPb, master.id);
		expect(events.length).toBeGreaterThanOrEqual(1);

		// Aucun event ne doit être marqué traité si le SMTP est down.
		const pendingEvents = events.filter((e) => e.processedAt === "");
		expect(pendingEvents.length).toBe(events.length);
	});

	it("planning push-only (email=false) → event consommé sans email (marqué terminal)", async () => {
		// Participant sans AUCUN canal actif (email:false, push:false) : le
		// fan-out ne crée jamais de ligne pour lui — espace vide de
		// destinataires → l'event est consommé d'emblée.
		// Sans marquage, il serait re-diffusé chaque nuit par la boucle push,
		// occurrence passée comprise.
		const { master } = await seedCronScenario(adminPb, {
			occDayOffset: 3,
			responses: [{ response: "present" }],
			participantPrefs: { email: false, reminderDays: ["3"] }
		});
		scenarioIds.push({ masterId: master.id });

		await runNotificationsCron(adminPb);

		const events = await listEventsForMaster(adminPb, master.id);
		expect(events).toHaveLength(1);
		// Aucun email possible → consommé au premier run, jamais re-poussé.
		expect(events[0].processedAt).not.toBe("");
	});

	it("occ annulée entre Phase 1 et Phase 2 → J-X marqué mort, annulation en retry email", async () => {
		const { master, occ } = await seedCronScenario(adminPb, {
			occDayOffset: 3,
			responses: [{ response: "present" }],
			participantPrefs: { email: true, reminderDays: ["3"], onOccurrenceChange: true }
		});
		scenarioIds.push({ masterId: master.id });

		// Phase 1 : insère l'event J-X reminder
		await runNotificationsCron(adminPb);
		const afterPhase1 = await listEventsForMaster(adminPb, master.id);
		expect(jxEventsOnly(afterPhase1)).toHaveLength(1);

		// Annuler l'occ avant Phase 2. Hook C2 va insérer status_canceled en parallèle.
		await adminPb.collection("planning_occurrences").update(occ.id, { isCanceled: true });

		// Phase 2
		await runNotificationsCron(adminPb);

		const events = await listEventsForMaster(adminPb, master.id);
		// Le rappel J-X meurt avec l'occurrence : marqué sans envoi — il ne
		// doit ni partir en email ni être re-poussé sur une occ annulée.
		const jxEvents = jxEventsOnly(events);
		expect(jxEvents).toHaveLength(1);
		expect(jxEvents[0].processedAt).not.toBe("");
		// L'annulation elle-même EST la nouvelle à délivrer : SMTP réellement
		// injoignable en test → l'event attend le retry du prochain cron.
		const cancelEvents = events.filter((e) => e.type === "status_canceled");
		expect(cancelEvents.length).toBeGreaterThanOrEqual(1);
		expect(cancelEvents.every((e) => e.processedAt === "")).toBe(true);
	});

	it("event résiduel sur occurrence passée → marqué mort sans envoi (garde d'obsolescence)", async () => {
		const { master, occ } = await seedCronScenario(adminPb, {
			occDayOffset: -2, // passée : la phase 1 n'insère rien
			responses: [{ response: "present" }],
			participantPrefs: { email: true, reminderDays: ["3"] }
		});
		scenarioIds.push({ masterId: master.id });

		// Event résiduel (ex: laissé pending par une panne SMTP les jours passés).
		await adminPb.collection("notification_events").create({
			type: "reminder",
			master: master.id,
			occurrence: occ.id,
			reminderValue: 3,
			changedBy: "",
			payload: null,
			processedAt: ""
		});

		await withSmtpStub(adminPb, async (capture) => {
			await runNotificationsCron(adminPb);
			// Aucun email ne part pour une occurrence passée.
			expect(capture.subjects.some((s) => s.includes(master.title))).toBe(false);
		});

		const events = await listEventsForMaster(adminPb, master.id);
		expect(events).toHaveLength(1);
		expect(events[0].processedAt).not.toBe("");
	});

	it("status_deleted sur occurrence supprimée → délivré par email et marqué", async () => {
		const { master, occ } = await seedCronScenario(adminPb, {
			occDayOffset: 3,
			responses: [{ response: "present" }],
			participantPrefs: { email: true, reminderDays: ["3"], onOccurrenceChange: true }
		});
		scenarioIds.push({ masterId: master.id });

		// Event résiduel antérieur à la suppression (laissé pending par une panne).
		await adminPb.collection("notification_events").create({
			type: "status_deleted",
			master: master.id,
			occurrence: occ.id,
			reminderValue: 0,
			changedBy: "",
			payload: null,
			processedAt: ""
		});

		// Soft-delete : le hook occurrence-update insère son propre status_deleted.
		await adminPb.collection("planning_occurrences").update(occ.id, { deleted: true });

		await withSmtpStub(adminPb, async (capture) => {
			await runNotificationsCron(adminPb);
			// La suppression EST la nouvelle : elle part en email (agrégé).
			expect(capture.subjects.some((s) => s.includes(master.title))).toBe(true);
		});

		const events = await listEventsForMaster(adminPb, master.id);
		const deletions = events.filter((e) => e.type === "status_deleted");
		expect(deletions.length).toBeGreaterThanOrEqual(2);
		expect(deletions.every((e) => e.processedAt !== "")).toBe(true);
		// Change event : le push immédiat est du ressort du hook — la vague
		// cron ne les re-pousse jamais (pushWaivedAt posé dès le fan-out).
		const dels = await listDeliveriesForEvent(adminPb, deletions[0].id);
		expect(dels.length).toBeGreaterThanOrEqual(1);
		expect(dels.every((d) => d.pushWaivedAt !== "")).toBe(true);
	});
});

describe("Cron notifications-daily — Push J-X", () => {
	let adminPb: PocketBase;
	const scenarioIds: { masterId: string; userId?: string }[] = [];

	beforeEach(async () => {
		clearTrackedIds();
		adminPb = await authenticateAdmin();
		scenarioIds.length = 0;
	});

	afterEach(async () => {
		for (const { masterId } of scenarioIds) {
			const events = await adminPb
				.collection("notification_events")
				.getFullList({ filter: `master = "${masterId}"` });
			for (const ev of events) {
				await adminPb.collection("notification_events").delete(ev.id);
			}
		}
		await cleanupTrackedRecords();
	});

	it("participant avec push=true → 1 event inséré (push envoyé en interne)", async () => {
		// Note : sendPushNotification échoue silencieusement si l'user n'a pas de
		// push_subscription valide. On valide ici uniquement que l'event J-X est
		// inséré (le push lui-même est testé unitairement dans notify-utils.test.ts).
		// L'absence d'erreur du cron confirme que la boucle push s'exécute sans crash.
		const { master } = await seedCronScenario(adminPb, {
			occDayOffset: 3,
			responses: [{ response: "present" }],
			participantPrefs: { email: false, push: true, reminderDays: ["3"] }
		});
		scenarioIds.push({ masterId: master.id });

		// Ne doit pas throw malgré l'absence de push_subscription valide.
		await runNotificationsCron(adminPb);

		const events = await listEventsForMaster(adminPb, master.id);
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe("reminder");
	});
});

describe("Cron notifications-daily — Phase 2 : new_comment (email agrégé + filtre déjà lu)", () => {
	let adminPb: PocketBase;
	const scenarioIds: { masterId: string }[] = [];

	beforeEach(async () => {
		clearTrackedIds();
		adminPb = await authenticateAdmin();
		scenarioIds.length = 0;
	});

	afterEach(async () => {
		for (const { masterId } of scenarioIds) {
			const events = await adminPb
				.collection("notification_events")
				.getFullList({ filter: `master = "${masterId}"` });
			for (const ev of events) {
				await adminPb.collection("notification_events").delete(ev.id);
			}
		}
		await cleanupTrackedRecords();
	});

	/**
	 * Seed un scénario new_comment : master + user authentifié participant avec
	 * email:true et newCommentScope:'all', occ future. Retourne les IDs pour
	 * permettre l'insertion d'events et la mise à jour du read-state.
	 */
	async function seedCommentScenario(
		adminPb: PocketBase,
		title: string
	): Promise<{
		master: PlanningMaster;
		occ: PlanningOccurrence;
		userId: string;
		participantRecordId: string;
	}> {
		const email = `cmt-${Math.random().toString(36).slice(2)}@test.com`;
		const user = await adminPb.collection("users").create({
			email,
			password: "password123",
			passwordConfirm: "password123",
			name: "Comment Recipient",
			emailVisibility: true,
			verified: true
		});
		trackIds("users", user.id);

		const participant: Participant = {
			id: PARTICIPANT_ID,
			name: "Comment Recipient",
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

		const master = await adminPb.collection("planning_masters").create<PlanningMaster>({
			title,
			defaultStartTime: "09:00",
			defaultEndTime: "17:00",
			recurrence: { type: "WEEKLY" as never },
			tasks: [],
			participants: [participant as never],
			minPresentRequired: 1,
			allowResponses: true,
			toConfirm: false,
			availableResponseTypes: ["present", "absent"],
			adminToken,
			participantToken,
			lastModifiedBy: ""
		});
		trackIds("planning_masters", master.id);

		const occ = await adminPb.collection("planning_occurrences").create<PlanningOccurrence>({
			master: master.id,
			date: dateInDays(3),
			startTime: "09:00",
			endTime: "17:00",
			responses: [
				{
					participantId: PARTICIPANT_ID,
					response: "present",
					tasks: [],
					respondedAt: new Date().toISOString()
				}
			] as never,
			comments: [],
			tasks: [],
			isConfirmed: false,
			isCanceled: false,
			lastModifiedBy: ""
		});
		trackIds("planning_occurrences", occ.id);

		const pp = await adminPb.collection("planning_participants").create({
			planning: master.id,
			user: user.id,
			email: true,
			push: false,
			reminderDays: [],
			missingDays: [],
			onOccurrenceChange: true,
			onConfirmationNeeded: false,
			newCommentScope: "all"
		});
		trackIds("planning_participants", pp.id);

		return { master, occ, userId: user.id, participantRecordId: pp.id };
	}

	/** Insère directement un event new_comment pending (payload complet). */
	async function insertCommentEvent(
		adminPb: PocketBase,
		masterId: string,
		occId: string,
		opts: {
			authorName: string;
			contentPreview: string;
			commentCreatedAt?: string;
			changedBy?: string;
			commentId?: string;
		}
	): Promise<void> {
		await adminPb.collection("notification_events").create({
			type: "new_comment",
			master: masterId,
			occurrence: occId,
			reminderValue: 0,
			changedBy: opts.changedBy || "author-other-user",
			payload: {
				commentId: opts.commentId || "c-" + Math.random().toString(36).slice(2, 6),
				commentCreatedAt: opts.commentCreatedAt || new Date().toISOString(),
				authorName: opts.authorName,
				contentPreview: opts.contentPreview
			},
			processedAt: ""
		});
	}

	/** Compte les emails capturés dont le sujet mentionne le titre du master. */
	function countForTitle(capture: SmtpCapture, title: string): number {
		return capture.subjects.filter((s) => s.includes(title)).length;
	}

	it("l'event new_comment est agrégé dans le buffer email (skip temporaire retiré)", async () => {
		const title = `CmtFlow-${Math.random().toString(36).slice(2, 6)}`;
		const { master, occ } = await seedCommentScenario(adminPb, title);
		scenarioIds.push({ masterId: master.id });
		await insertCommentEvent(adminPb, master.id, occ.id, {
			authorName: "Alice",
			contentPreview: "Bonjour"
		});

		await withSmtpStub(adminPb, async (capture) => {
			await runNotificationsCron(adminPb);
			expect(countForTitle(capture, title)).toBe(1);
			expect(capture.subjects.some((s) => s.includes(title))).toBe(true);
		});

		// SMTP ayant réussi (stub), l'event est marqué traité.
		const events = await listEventsForMaster(adminPb, master.id);
		const newCommentEvents = events.filter((e) => e.type === "new_comment");
		expect(newCommentEvents).toHaveLength(1);
		expect(newCommentEvents[0].processedAt).not.toBe("");
	});

	it("3 events new_comment sur la même occ → 1 seul email agrégé (1 sous-bloc)", async () => {
		const title = `CmtAgg-${Math.random().toString(36).slice(2, 6)}`;
		const { master, occ } = await seedCommentScenario(adminPb, title);
		scenarioIds.push({ masterId: master.id });
		await insertCommentEvent(adminPb, master.id, occ.id, {
			authorName: "Alice",
			contentPreview: "Premier"
		});
		await insertCommentEvent(adminPb, master.id, occ.id, {
			authorName: "Bob",
			contentPreview: "Second"
		});
		await insertCommentEvent(adminPb, master.id, occ.id, {
			authorName: "Alice",
			contentPreview: "Troisième"
		});

		await withSmtpStub(adminPb, async (capture) => {
			await runNotificationsCron(adminPb);
			// Agrégation : 3 events même occ même destinataire → 1 email.
			expect(countForTitle(capture, title)).toBe(1);
		});

		const events = await listEventsForMaster(adminPb, master.id);
		expect(events.filter((e) => e.type === "new_comment")).toHaveLength(3);
	});

	it("filtre déjà lu : commentReadState[occId] >= commentCreatedAt → email skippé pour ce destinataire", async () => {
		const title = `CmtRead-${Math.random().toString(36).slice(2, 6)}`;
		const { master, occ, participantRecordId } = await seedCommentScenario(adminPb, title);
		scenarioIds.push({ masterId: master.id });

		// Message créé dans le passé ; le destinataire a lu postérieurement.
		const oldCreatedAt = "2020-01-01T00:00:00Z";
		const readAfter = "2025-06-01T00:00:00Z";
		await insertCommentEvent(adminPb, master.id, occ.id, {
			authorName: "Alice",
			contentPreview: "Vieux message déjà lu",
			commentCreatedAt: oldCreatedAt
		});
		// Marque la conversation comme lue après la création du message.
		await adminPb.collection("planning_participants").update(participantRecordId, {
			commentReadState: { [occ.id]: readAfter }
		});

		await withSmtpStub(adminPb, async (capture) => {
			await runNotificationsCron(adminPb);
			// L'event est filtré pour ce destinataire → aucun email pour ce master.
			expect(countForTitle(capture, title)).toBe(0);
		});

		// L'event filtré pour tous ses destinataires est consommé sans email :
		// le marquage terminal évite qu'il traîne en pending éternel.
		const events = await listEventsForMaster(adminPb, master.id);
		const nc = events.filter((e) => e.type === "new_comment");
		expect(nc).toHaveLength(1);
		expect(nc[0].processedAt).not.toBe("");
	});

	it("filtre déjà lu : pas de commentReadState[occId] → email inclus (jamais visité = non lu)", async () => {
		const title = `CmtUnread-${Math.random().toString(36).slice(2, 6)}`;
		const { master, occ } = await seedCommentScenario(adminPb, title);
		scenarioIds.push({ masterId: master.id });
		await insertCommentEvent(adminPb, master.id, occ.id, {
			authorName: "Alice",
			contentPreview: "Message non lu"
		});
		// Pas de commentReadState → l'event est inclus.

		await withSmtpStub(adminPb, async (capture) => {
			await runNotificationsCron(adminPb);
			expect(countForTitle(capture, title)).toBe(1);
		});
	});

	it("filtre déjà lu : commentReadState antérieur au message → email inclus (message plus récent que la dernière lecture)", async () => {
		const title = `CmtNewer-${Math.random().toString(36).slice(2, 6)}`;
		const { master, occ, participantRecordId } = await seedCommentScenario(adminPb, title);
		scenarioIds.push({ masterId: master.id });

		const readBefore = "2020-01-01T00:00:00Z";
		const newerCreatedAt = "2025-06-01T00:00:00Z";
		await insertCommentEvent(adminPb, master.id, occ.id, {
			authorName: "Alice",
			contentPreview: "Message plus récent que la lecture",
			commentCreatedAt: newerCreatedAt
		});
		await adminPb.collection("planning_participants").update(participantRecordId, {
			commentReadState: { [occ.id]: readBefore }
		});

		await withSmtpStub(adminPb, async (capture) => {
			await runNotificationsCron(adminPb);
			// readAt (2020) < commentCreatedAt (2025) → message non lu → inclus.
			expect(countForTitle(capture, title)).toBe(1);
		});
	});

	it("sujet suffixé quand la catégorie dominante ≠ comment (schedule_change + 2 messages)", async () => {
		const title = `CmtSuffix-${Math.random().toString(36).slice(2, 6)}`;
		const { master, occ } = await seedCommentScenario(adminPb, title);
		scenarioIds.push({ masterId: master.id });

		// 1 event schedule_change + 2 new_comment sur la même occ.
		await adminPb.collection("notification_events").create({
			type: "schedule_change",
			master: master.id,
			occurrence: occ.id,
			reminderValue: 0,
			changedBy: "author-other-user",
			payload: { oldStartTime: "09:00", newStartTime: "10:00" },
			processedAt: ""
		});
		await insertCommentEvent(adminPb, master.id, occ.id, {
			authorName: "Alice",
			contentPreview: "Ok pour 10h"
		});
		await insertCommentEvent(adminPb, master.id, occ.id, {
			authorName: "Bob",
			contentPreview: "Noté"
		});

		await withSmtpStub(adminPb, async (capture) => {
			await runNotificationsCron(adminPb);
			// 1 email agrégé (les deux types fusionnent dans le même bucket).
			expect(countForTitle(capture, title)).toBe(1);
			// Le sujet est dominé par schedule_change (Modification) puis suffixé.
			const subject = capture.subjects.find((s) => s.includes(title));
			expect(subject).toBeDefined();
			expect(subject!).toContain("Modification");
			expect(subject!).toContain("+ 2 nouveaux messages");
		});
	});
});

// ============================================================================
// Registre notification_deliveries — découplage des canaux et exactly-once.
// Les lignes naissent au fan-out du cron (à la consommation) ; chaque canal
// se règle séparément (envoyé ou waivé) et la terminalité de l'event s'en
// déduit. Les cas de waive : opt-out, déjà lu, départ durable (reaper),
// clôture de mort, clôture résiduelle (event consommé hors cron).
// ============================================================================

describe("Cron notifications-daily — registre notification_deliveries", () => {
	let adminPb: PocketBase;
	const scenarioIds: { masterId: string }[] = [];

	beforeEach(async () => {
		clearTrackedIds();
		adminPb = await authenticateAdmin();
		scenarioIds.length = 0;
	});

	afterEach(async () => {
		// La suppression des events emporte leurs deliveries par cascade.
		for (const { masterId } of scenarioIds) {
			const events = await adminPb
				.collection("notification_events")
				.getFullList({ filter: `master = "${masterId}"` });
			for (const ev of events) {
				await adminPb.collection("notification_events").delete(ev.id);
			}
		}
		await cleanupTrackedRecords();
	});

	it("décisif : RCPT rejeté pour B → A servi exactement une fois, B seule retentée", async () => {
		const scenario = await seedCronScenario(adminPb, {
			occDayOffset: 3,
			responses: [{ response: "present" }],
			participantPrefs: { email: true, reminderDays: ["3"] }
		});
		scenarioIds.push({ masterId: scenario.master.id });
		const b = await addRecipient(adminPb, scenario, { email: true });

		// Jour 1 : A reçoit, le RCPT de B est rejeté (adresse morte).
		await withSmtpStub(
			adminPb,
			async (capture) => {
				await runNotificationsCron(adminPb);
				expect(capture.count).toBe(1);
			},
			{ rejectRcpt: (addr) => addr.includes(b.email) }
		);

		const events = await listEventsForMaster(adminPb, scenario.master.id);
		const reminder = events.find((e) => e.type === "reminder")!;
		const dels = await listDeliveriesForEvent(adminPb, reminder.id);
		expect(dels).toHaveLength(2);
		const delA = dels.find((d) => d.user === scenario.userId)!;
		const delB = dels.find((d) => d.user === b.userId)!;
		expect(delA.emailSentAt).not.toBe("");
		expect(delB.emailSentAt).toBe("");
		expect(delB.emailWaivedAt).toBe("");
		// B due → l'event reste pending (retry du run suivant).
		expect(reminder.processedAt).toBe("");

		// Jour 2 : aucun doublon pour A, B seule retentée (et rejetée à nouveau).
		await withSmtpStub(
			adminPb,
			async (capture) => {
				await runNotificationsCron(adminPb);
				expect(capture.count).toBe(0);
			},
			{ rejectRcpt: (addr) => addr.includes(b.email) }
		);

		const delsAfter = await listDeliveriesForEvent(adminPb, reminder.id);
		const delAAfter = delsAfter.find((d) => d.user === scenario.userId)!;
		const delBAfter = delsAfter.find((d) => d.user === b.userId)!;
		expect(delAAfter.emailSentAt).not.toBe("");
		expect(delBAfter.emailSentAt).toBe("");
		expect(delBAfter.emailWaivedAt).toBe("");
	});

	it("clôture résiduelle : delivery due sur event consommé hors cron → waivée au run suivant", async () => {
		const { master, occ, userId } = await seedCronScenario(adminPb, {
			occDayOffset: 3,
			responses: [{ response: "present" }],
			participantPrefs: { email: true, reminderDays: ["3"] }
		});
		scenarioIds.push({ masterId: master.id });

		// Event new_comment consommé par le hook (cleanup à la suppression d'un
		// commentaire) : processedAt posé hors cron, sa delivery restée due.
		const ev = await adminPb.collection("notification_events").create({
			type: "new_comment",
			master: master.id,
			occurrence: occ.id,
			reminderValue: 0,
			changedBy: "author-other-user",
			payload: { commentId: "c1", commentCreatedAt: new Date().toISOString() },
			processedAt: ""
		});
		await adminPb.collection("notification_events").update(ev.id, {
			processedAt: "2026-10-26 00:00:00.000Z"
		});
		await adminPb.collection("notification_deliveries").create({
			event: ev.id,
			user: userId,
			master: master.id
		});
		// Seconde ligne, autre destinataire : email réglé mais push dû — la
		// lettre B1 dit « toute delivery due », les deux canaux sont couverts.
		const other = await adminPb.collection("users").create({
			email: `res-${Math.random().toString(36).slice(2)}@test.com`,
			password: "password123",
			passwordConfirm: "password123",
			name: "Residual Recipient",
			emailVisibility: true,
			verified: true
		});
		trackIds("users", other.id);
		await adminPb.collection("notification_deliveries").create({
			event: ev.id,
			user: other.id,
			master: master.id,
			emailSentAt: "2026-10-26 00:00:00.000Z"
		});

		// SMTP down : aucun envoi possible, la clôture résiduelle est le seul
		// chemin qui règle la ligne.
		await runNotificationsCron(adminPb);

		const dels = await listDeliveriesForEvent(adminPb, ev.id);
		expect(dels).toHaveLength(2);
		const emailDue = dels.find((d) => d.user === userId)!;
		expect(emailDue.emailWaivedAt).not.toBe("");
		expect(emailDue.emailSentAt).toBe("");
		const pushDue = dels.find((d) => d.user === other.id)!;
		expect(pushDue.pushWaivedAt).not.toBe("");
		expect(pushDue.pushSentAt).toBe("");
		expect(pushDue.emailWaivedAt).toBe("");
	});

	it("reaper : hasQuit après fan-out → delivery waivée des deux canaux, event terminal", async () => {
		const { master, userId } = await seedCronScenario(adminPb, {
			occDayOffset: 3,
			responses: [{ response: "present" }],
			participantPrefs: { email: true, reminderDays: ["3"] }
		});
		scenarioIds.push({ masterId: master.id });

		// Run 1 (SMTP down) : fan-out, delivery due (email), push waived.
		await runNotificationsCron(adminPb);
		const events = await listEventsForMaster(adminPb, master.id);
		const reminder = events.find((e) => e.type === "reminder")!;
		let dels = await listDeliveriesForEvent(adminPb, reminder.id);
		expect(dels[0].emailSentAt).toBe("");
		expect(dels[0].emailWaivedAt).toBe("");

		// Départ durable : hasQuit sur l'entrée du master.
		const masterFresh = await adminPb
			.collection("planning_masters")
			.getOne<PlanningMaster>(master.id);
		await adminPb.collection("planning_masters").update(master.id, {
			participants: masterFresh.participants.map((p) =>
				p.userId === userId ? { ...p, hasQuit: true } : p
			)
		});

		await runNotificationsCron(adminPb);

		dels = await listDeliveriesForEvent(adminPb, reminder.id);
		expect(dels[0].emailWaivedAt).not.toBe("");
		expect(dels[0].emailSentAt).toBe("");
		// Les deux canaux réglés → l'event est consommé.
		const eventsAfter = await listEventsForMaster(adminPb, master.id);
		expect(eventsAfter.find((e) => e.id === reminder.id)!.processedAt).not.toBe("");
	});

	it("response réversible : absent pendant le retry → delivery reste due ; repasse present → l'email part", async () => {
		const { master, occ, userId } = await seedCronScenario(adminPb, {
			occDayOffset: 3,
			responses: [{ response: "present" }],
			participantPrefs: { email: true, reminderDays: ["3"] }
		});
		scenarioIds.push({ masterId: master.id });
		const setResponse = async (response: string) => {
			const occFresh = await adminPb
				.collection("planning_occurrences")
				.getOne<PlanningOccurrence>(occ.id);
			await adminPb.collection("planning_occurrences").update(occ.id, {
				responses: occFresh.responses.map((r) =>
					r.participantId === PARTICIPANT_ID ? { ...r, response } : r
				) as never
			});
		};

		await runNotificationsCron(adminPb); // SMTP down → delivery due
		const events = await listEventsForMaster(adminPb, master.id);
		const reminder = events.find((e) => e.type === "reminder")!;

		// `absent` est réversible : le reaper ne touche pas à la ligne.
		await setResponse("absent");
		await runNotificationsCron(adminPb);
		let dels = await listDeliveriesForEvent(adminPb, reminder.id);
		expect(dels[0].user).toBe(userId);
		expect(dels[0].emailSentAt).toBe("");
		expect(dels[0].emailWaivedAt).toBe("");

		// Retour à present : la ligne due repart dans le bucket.
		await setResponse("present");
		await withSmtpStub(adminPb, async (capture) => {
			await runNotificationsCron(adminPb);
			expect(capture.count).toBe(1);
		});
		dels = await listDeliveriesForEvent(adminPb, reminder.id);
		expect(dels[0].emailSentAt).not.toBe("");
		const eventsAfter = await listEventsForMaster(adminPb, master.id);
		expect(eventsAfter.find((e) => e.id === reminder.id)!.processedAt).not.toBe("");
	});

	it("opt-out email=false avec push=true → emailWaivedAt + pushSentAt, event consommé sans email", async () => {
		const { master } = await seedCronScenario(adminPb, {
			occDayOffset: 3,
			responses: [{ response: "present" }],
			participantPrefs: { email: false, push: true, reminderDays: ["3"] }
		});
		scenarioIds.push({ masterId: master.id });

		// SMTP down : l'email ne pouvait de toute façon pas partir — le waive
		// opt-out est un choix explicite, pas un effet de la panne.
		await runNotificationsCron(adminPb);

		const events = await listEventsForMaster(adminPb, master.id);
		const reminder = events.find((e) => e.type === "reminder")!;
		const dels = await listDeliveriesForEvent(adminPb, reminder.id);
		expect(dels).toHaveLength(1);
		expect(dels[0].emailWaivedAt).not.toBe("");
		expect(dels[0].emailSentAt).toBe("");
		// Le push est marqué en DB (observation possible via le ledger ; la
		// livraison HTTP elle-même est best-effort et silencieuse en test).
		expect(dels[0].pushSentAt).not.toBe("");
		expect(reminder.processedAt).not.toBe("");
	});

	it("vague push indépendante : email=true push=true SMTP down → pushSentAt mais event pending", async () => {
		const { master } = await seedCronScenario(adminPb, {
			occDayOffset: 3,
			responses: [{ response: "present" }],
			participantPrefs: { email: true, push: true, reminderDays: ["3"] }
		});
		scenarioIds.push({ masterId: master.id });

		await runNotificationsCron(adminPb); // SMTP dev injoignable

		const events = await listEventsForMaster(adminPb, master.id);
		const reminder = events.find((e) => e.type === "reminder")!;
		const dels = await listDeliveriesForEvent(adminPb, reminder.id);
		expect(dels).toHaveLength(1);
		// La vague push est partie (marquée) malgré la panne SMTP…
		expect(dels[0].pushSentAt).not.toBe("");
		expect(dels[0].pushWaivedAt).toBe("");
		// …l'email reste dû → l'event attend le retry, jamais re-poussé.
		expect(dels[0].emailSentAt).toBe("");
		expect(dels[0].emailWaivedAt).toBe("");
		expect(reminder.processedAt).toBe("");
	});

	it("staleness : event mort → deliveries dues clôturées (bulk-waive)", async () => {
		const { master, occ, userId } = await seedCronScenario(adminPb, {
			occDayOffset: -2, // passée : le garde d'obsolescence tue l'event
			responses: [{ response: "present" }],
			participantPrefs: { email: true, reminderDays: ["3"] }
		});
		scenarioIds.push({ masterId: master.id });

		// Event qui a passé un fan-out dans un run antérieur, delivery restée
		// due (échec SMTP), occurrence passée depuis.
		const ev = await adminPb.collection("notification_events").create({
			type: "reminder",
			master: master.id,
			occurrence: occ.id,
			reminderValue: 3,
			changedBy: "",
			payload: null,
			processedAt: ""
		});
		await adminPb.collection("notification_deliveries").create({
			event: ev.id,
			user: userId,
			master: master.id
		});
		// Seconde ligne, autre destinataire : email réglé, push dû — la
		// clôture à la mort règle tout canal resté dû (ledger véridique).
		const other = await adminPb.collection("users").create({
			email: `stale-${Math.random().toString(36).slice(2)}@test.com`,
			password: "password123",
			passwordConfirm: "password123",
			name: "Stale Recipient",
			emailVisibility: true,
			verified: true
		});
		trackIds("users", other.id);
		await adminPb.collection("notification_deliveries").create({
			event: ev.id,
			user: other.id,
			master: master.id,
			emailSentAt: "2026-10-26 00:00:00.000Z"
		});

		await runNotificationsCron(adminPb);

		const events = await listEventsForMaster(adminPb, master.id);
		expect(events[0].processedAt).not.toBe("");
		const dels = await listDeliveriesForEvent(adminPb, ev.id);
		expect(dels).toHaveLength(2);
		const emailDue = dels.find((d) => d.user === userId)!;
		expect(emailDue.emailWaivedAt).not.toBe("");
		expect(emailDue.pushWaivedAt).not.toBe("");
		expect(emailDue.emailSentAt).toBe("");
		const pushDue = dels.find((d) => d.user === other.id)!;
		expect(pushDue.pushWaivedAt).not.toBe("");
	});
});

describe("Cron notifications-purge — purge native avec cascade deliveries", () => {
	let adminPb: PocketBase;

	beforeEach(async () => {
		clearTrackedIds();
		adminPb = await authenticateAdmin();
	});

	afterEach(async () => {
		await cleanupTrackedRecords();
	});

	it("events terminaux > 60j supprimés par app.delete() → deliveries emportées par cascade", async () => {
		const { master, occ, userId } = await seedCronScenario(adminPb, {
			occDayOffset: -2,
			responses: [{ response: "present" }],
			participantPrefs: { email: true, reminderDays: ["3"] }
		});
		const processedLongAgo = new Date(Date.now() - 70 * 86400_000).toISOString().replace("T", " ");
		const ev = await adminPb.collection("notification_events").create({
			type: "reminder",
			master: master.id,
			occurrence: occ.id,
			reminderValue: 3,
			changedBy: "",
			payload: null,
			processedAt: processedLongAgo
		});
		const del = await adminPb.collection("notification_deliveries").create({
			event: ev.id,
			user: userId,
			master: master.id,
			emailSentAt: processedLongAgo
		});

		await adminPb.crons.run("notifications-purge");
		await new Promise((resolve) => setTimeout(resolve, 500));

		await expect(adminPb.collection("notification_events").getOne(ev.id)).rejects.toThrow();
		// Pas de sweep indépendant : la delivery meurt avec son event.
		await expect(adminPb.collection("notification_deliveries").getOne(del.id)).rejects.toThrow();
	});
});
