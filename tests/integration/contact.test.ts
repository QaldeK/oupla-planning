/**
 * Tests d'intégration — formulaire de contact public.
 *
 * Endpoint : POST /api/contact (route publique, aucun _token requis).
 *
 * Comportement externe validé (aucune assertion sur la mécanique interne du
 * handler) :
 *   - soumission valide → 200 + record `contact_messages` créé
 *   - email manquant / mal formé → 400, aucun record
 *   - message trop court / trop long → 400, aucun record
 *   - honeypot rempli → 200 silencieux, aucun record (anti-bot)
 *   - l'IP source est stockée sur le record (forensique)
 *   - la collection `contact_messages` est inaccessible via l'API publique
 *     (rules `null` → lecture/création publiques rejetées)
 *
 * L'email SMTP n'est pas testé : aucun mailer configuré en env de test. Le
 * handler est best-effort (200 même si l'envoi échoue), la persistance du
 * record reste donc le signal de succès.
 */

import PocketBase from "pocketbase";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authenticateAdmin, cleanupTrackedRecords, clearTrackedIds, trackIds } from "./seed";

const PB_URL = process.env.VITE_PLANNING_PB_URL || "http://127.0.0.1:8090";

/** Client non authentifié, comme un vrai visiteur guest. */
function guestClient(): PocketBase {
	return new PocketBase(PB_URL);
}

const VALID_PAYLOAD = {
	email: "visitor@example.com",
	name: "Alice Visitor",
	subject: "Question RGPD",
	message: "Bonjour, je souhaite exercer mon droit d'accès aux données que vous détenez sur moi."
};

/** Compte les records `contact_messages` liés à cet email (via client admin). */
async function adminCountMessages(email: string): Promise<number> {
	const adminPb = await authenticateAdmin();
	const list = await adminPb
		.collection("contact_messages")
		.getFullList({ filter: `email = "${email}"` });
	return list.length;
}

/** Récupère le premier record pour cet email (via client admin). */
async function adminGetFirstMessage(email: string) {
	const adminPb = await authenticateAdmin();
	const list = await adminPb
		.collection("contact_messages")
		.getFullList({ filter: `email = "${email}"` });
	return list[0];
}

/** Purge tous les records de test via client admin. */
async function cleanupContactMessages() {
	const adminPb = await authenticateAdmin();
	const all = await adminPb.collection("contact_messages").getFullList();
	for (const record of all) {
		try {
			await adminPb.collection("contact_messages").delete(record.id);
		} catch {
			// ignore
		}
	}
}

describe("POST /api/contact — formulaire de contact public", () => {
	beforeEach(() => {
		clearTrackedIds();
	});

	afterEach(async () => {
		await cleanupContactMessages();
		await cleanupTrackedRecords();
	});

	it("soumission valide → 200 + record créé avec les champs attendus", async () => {
		const pb = guestClient();
		const response = await pb.send("/api/contact", { method: "POST", body: VALID_PAYLOAD });

		expect(response).toEqual({ success: true });

		const record = await adminGetFirstMessage(VALID_PAYLOAD.email);
		expect(record).toBeTruthy();
		trackIds("contact_messages", record.id);
		expect(record.email).toBe(VALID_PAYLOAD.email);
		expect(record.name).toBe(VALID_PAYLOAD.name);
		expect(record.subject).toBe(VALID_PAYLOAD.subject);
		expect(record.message).toBe(VALID_PAYLOAD.message);
	});

	it("stocke l'IP source du visiteur sur le record", async () => {
		const pb = guestClient();
		await pb.send("/api/contact", { method: "POST", body: VALID_PAYLOAD });

		const record = await adminGetFirstMessage(VALID_PAYLOAD.email);
		trackIds("contact_messages", record.id);
		// 127.0.0.1 en test local (pas de proxy intermédiaire).
		expect(typeof record.ip).toBe("string");
		expect(record.ip.length).toBeGreaterThan(0);
	});

	it("email manquant → 400, aucun record créé", async () => {
		const pb = guestClient();
		const { email: _omit, ...withoutEmail } = VALID_PAYLOAD;
		await expect(
			pb.send("/api/contact", { method: "POST", body: withoutEmail })
		).rejects.toMatchObject({ status: 400 });

		expect(await adminCountMessages(VALID_PAYLOAD.email)).toBe(0);
	});

	it("email mal formé → 400, aucun record créé", async () => {
		const pb = guestClient();
		await expect(
			pb.send("/api/contact", {
				method: "POST",
				body: { ...VALID_PAYLOAD, email: "not-an-email" }
			})
		).rejects.toMatchObject({ status: 400 });

		expect(await adminCountMessages(VALID_PAYLOAD.email)).toBe(0);
	});

	it("message trop court (< 10 caractères) → 400, aucun record créé", async () => {
		const pb = guestClient();
		await expect(
			pb.send("/api/contact", {
				method: "POST",
				body: { ...VALID_PAYLOAD, message: "court" }
			})
		).rejects.toMatchObject({ status: 400 });

		expect(await adminCountMessages(VALID_PAYLOAD.email)).toBe(0);
	});
	it("message trop long (> 5000 caractères) → 400, aucun record créé", async () => {
		const pb = guestClient();
		await expect(
			pb.send("/api/contact", {
				method: "POST",
				body: { ...VALID_PAYLOAD, message: "x".repeat(5001) }
			})
		).rejects.toMatchObject({ status: 400 });

		expect(await adminCountMessages(VALID_PAYLOAD.email)).toBe(0);
	});

	it("honeypot rempli → 200 silencieux, aucun record créé", async () => {
		const pb = guestClient();
		const response = await pb.send("/api/contact", {
			method: "POST",
			body: { ...VALID_PAYLOAD, website: "https://spam.example" }
		});

		// Silencieux : le bot ne doit pas apprendre qu'il a été détecté.
		expect(response).toEqual({ success: true });
		expect(await adminCountMessages(VALID_PAYLOAD.email)).toBe(0);
	});

	it("name et subject optionnels : soumission valide sans ces champs", async () => {
		const pb = guestClient();
		const response = await pb.send("/api/contact", {
			method: "POST",
			body: { email: "minimal@example.com", message: "Un message suffisamment long." }
		});

		expect(response).toEqual({ success: true });
		const record = await adminGetFirstMessage("minimal@example.com");
		trackIds("contact_messages", record.id);
		expect(record.email).toBe("minimal@example.com");
		expect(record.message).toBe("Un message suffisamment long.");
	});

	it("collection inaccessible en lecture publique (rule null → 403)", async () => {
		const pb = guestClient();
		await expect(pb.collection("contact_messages").getFullList()).rejects.toMatchObject({
			status: 403
		});
	});

	it("collection inaccessible en création publique (rule null → 403)", async () => {
		const pb = guestClient();
		await expect(
			pb.collection("contact_messages").create({
				email: "direct@example.com",
				message: "tentative d'écriture directe"
			})
		).rejects.toMatchObject({ status: 403 });
	});
});
