import path from "path";
import { describe, expect, it } from "vitest";

// Politique de consommation de la file notification_events (phase 2 du cron)
// et du registre notification_deliveries. Contrat de `processedAt` : état
// terminal — « cet event ne sera plus jamais touché ». Les records PB sont
// mockés via mkRecord() (cf. jx-detector).
//
// Couverture classifyPendingEvent :
//   - master/occurrence introuvables → mort
//   - occurrence supprimée/annulée : mort pour J-X et new_comment, VIVANT
//     pour les change events (l'état de l'occ EST la nouvelle à délivrer)
//   - occurrence passée → mort (garde d'obsolescence, quel que soit le type)
//   - borne « aujourd'hui » : vivant
//
// Couverture du registre deliveries :
//   - isDeliverySettled : chaque canal envoyé ou waivé, '' = dû
//   - isDepartureDurable : prédicat étroit du reaper (hasQuit / userId retiré,
//     JAMAIS une response ou une pref réversible)
//   - isEventTerminal : toutes deliveries réglées ; vide = consommé d'emblée

const HOOKS_DIR = path.resolve(__dirname, "../../", "pocketbase/pb_hooks");
(globalThis as any).__hooks = HOOKS_DIR;

const { classifyPendingEvent, isDeliverySettled, isDepartureDurable, isEventTerminal } =
	await import("../../pocketbase/pb_hooks/notification-consumer.js");

// ============================================================================
// Factory de mock pour core.Record
// ============================================================================

function mkRecord(data: Record<string, unknown>): any {
	return {
		get(field: string) {
			return data[field];
		},
		getString(field: string) {
			const v = data[field];
			if (v === null || v === undefined) return "";
			if (typeof v === "string") return v;
			if (Array.isArray(v) || typeof v === "object") return JSON.stringify(v);
			return String(v);
		},
		getBool(field: string) {
			return !!data[field];
		},
		getInt(field: string) {
			const v = Number(data[field]);
			return Number.isFinite(v) ? v : 0;
		},
		getStringSlice(field: string) {
			const v = data[field];
			return Array.isArray(v) ? v.map(String) : [];
		}
	};
}

// ============================================================================
// Fixtures
// ============================================================================

const NOW = new Date("2026-07-19T12:00:00Z");

function mkDate(daysFromNow: number): string {
	const d = new Date(NOW.getTime() + daysFromNow * 24 * 60 * 60 * 1000);
	return d
		.toISOString()
		.replace("T", " ")
		.replace(/\.\d+Z$/, ".000Z");
}

function mkOcc(overrides: Record<string, unknown> = {}): any {
	return mkRecord({
		date: mkDate(3),
		deleted: false,
		isCanceled: false,
		...overrides
	});
}

const LIVE_CTX = { master: mkRecord({ title: "T" }), participants: [] };

// ============================================================================
// classifyPendingEvent
// ============================================================================

describe("classifyPendingEvent", () => {
	it("master introuvable ou supprimé → mort (master_gone)", () => {
		const cls = classifyPendingEvent({
			type: "reminder",
			occ: mkOcc(),
			masterCtx: null,
			now: NOW
		});
		expect(cls).toEqual({ kind: "dead", reason: "master_gone" });
	});

	it("occurrence introuvable → mort (occ_missing)", () => {
		const cls = classifyPendingEvent({
			type: "reminder",
			occ: null,
			masterCtx: LIVE_CTX,
			now: NOW
		});
		expect(cls).toEqual({ kind: "dead", reason: "occ_missing" });
	});

	it("event J-X sur occurrence supprimée → mort (occ_deleted)", () => {
		const cls = classifyPendingEvent({
			type: "reminder",
			occ: mkOcc({ deleted: true }),
			masterCtx: LIVE_CTX,
			now: NOW
		});
		expect(cls).toEqual({ kind: "dead", reason: "occ_deleted" });
	});

	it("event J-X sur occurrence annulée → mort (occ_canceled)", () => {
		const cls = classifyPendingEvent({
			type: "quorum_missing",
			occ: mkOcc({ isCanceled: true }),
			masterCtx: LIVE_CTX,
			now: NOW
		});
		expect(cls).toEqual({ kind: "dead", reason: "occ_canceled" });
	});

	it("new_comment sur occurrence supprimée → mort (occ_deleted)", () => {
		const cls = classifyPendingEvent({
			type: "new_comment",
			occ: mkOcc({ deleted: true }),
			masterCtx: LIVE_CTX,
			now: NOW
		});
		expect(cls).toEqual({ kind: "dead", reason: "occ_deleted" });
	});

	it("status_deleted sur occurrence supprimée → vivant (la suppression EST la nouvelle)", () => {
		const cls = classifyPendingEvent({
			type: "status_deleted",
			occ: mkOcc({ deleted: true }),
			masterCtx: LIVE_CTX,
			now: NOW
		});
		expect(cls).toEqual({ kind: "live" });
	});

	it("status_canceled sur occurrence annulée → vivant (l'annulation EST la nouvelle)", () => {
		const cls = classifyPendingEvent({
			type: "status_canceled",
			occ: mkOcc({ isCanceled: true }),
			masterCtx: LIVE_CTX,
			now: NOW
		});
		expect(cls).toEqual({ kind: "live" });
	});

	it("schedule_change sur occurrence vivante future → vivant", () => {
		const cls = classifyPendingEvent({
			type: "schedule_change",
			occ: mkOcc(),
			masterCtx: LIVE_CTX,
			now: NOW
		});
		expect(cls).toEqual({ kind: "live" });
	});

	it("occurrence passée → mort (stale_occurrence), y compris pour un change event", () => {
		for (const type of ["reminder", "status_canceled", "new_comment"]) {
			const cls = classifyPendingEvent({
				type,
				occ: mkOcc({ date: mkDate(-2) }),
				masterCtx: LIVE_CTX,
				now: NOW
			});
			expect(cls).toEqual({ kind: "dead", reason: "stale_occurrence" });
		}
	});

	it("occurrence du jour → vivant (borne : aujourd'hui n'est pas passé)", () => {
		const cls = classifyPendingEvent({
			type: "schedule_change",
			occ: mkOcc({ date: mkDate(0) }),
			masterCtx: LIVE_CTX,
			now: NOW
		});
		expect(cls).toEqual({ kind: "live" });
	});

	it("date illisible → mort (stale_occurrence)", () => {
		const cls = classifyPendingEvent({
			type: "reminder",
			occ: mkOcc({ date: "pas-une-date" }),
			masterCtx: LIVE_CTX,
			now: NOW
		});
		expect(cls).toEqual({ kind: "dead", reason: "stale_occurrence" });
	});
});

// ============================================================================
// Registre deliveries — isDeliverySettled / isDepartureDurable / isEventTerminal
// ============================================================================

describe("isDeliverySettled", () => {
	const SETTLED_EMAIL = { emailSentAt: "2026-07-19 00:00:00.000Z", emailWaivedAt: "" };
	const SETTLED_PUSH = { pushSentAt: "2026-07-19 00:00:00.000Z", pushWaivedAt: "" };

	it("les deux canaux envoyés → réglée", () => {
		expect(isDeliverySettled({ ...SETTLED_EMAIL, ...SETTLED_PUSH })).toBe(true);
	});

	it("un canal envoyé, l'autre waivé → réglée", () => {
		expect(
			isDeliverySettled({
				emailSentAt: "",
				emailWaivedAt: "2026-07-19 00:00:00.000Z",
				...SETTLED_PUSH
			})
		).toBe(true);
	});

	it("email dû ('' des deux côtés) → non réglée", () => {
		expect(isDeliverySettled({ emailSentAt: "", emailWaivedAt: "", ...SETTLED_PUSH })).toBe(false);
	});

	it("push dû → non réglée", () => {
		expect(isDeliverySettled({ ...SETTLED_EMAIL, pushSentAt: "", pushWaivedAt: "" })).toBe(false);
	});
});

describe("isDepartureDurable (reaper, prédicat étroit)", () => {
	it("userId absent du master → départ durable", () => {
		expect(isDepartureDurable([{ userId: "u1" }], "u2")).toBe(true);
	});

	it("liste vide → départ durable (plus aucune entrée)", () => {
		expect(isDepartureDurable([], "u1")).toBe(true);
	});

	it("toutes les entrées hasQuit → départ durable", () => {
		expect(
			isDepartureDurable(
				[
					{ id: "p1", userId: "u1", hasQuit: true },
					{ id: "p2", userId: "u1", hasQuit: true }
				],
				"u1"
			)
		).toBe(true);
	});

	it("une seule entrée active suffit → PAS un départ durable (cas hasQuit + ré-inscription)", () => {
		expect(
			isDepartureDurable(
				[
					{ id: "p1", userId: "u1", hasQuit: true },
					{ id: "p2", userId: "u1" }
				],
				"u1"
			)
		).toBe(false);
	});

	it("entrée sans hasQuit → actif, pas un départ durable", () => {
		expect(isDepartureDurable([{ id: "p1", userId: "u1" }], "u1")).toBe(false);
	});

	it("les autres users sont ignorés", () => {
		expect(isDepartureDurable([{ id: "p1", userId: "u2", hasQuit: true }], "u1")).toBe(true);
	});

	it("participants indéterminés (null/absent) → JAMAIS un départ durable", () => {
		expect(isDepartureDurable(null, "u1")).toBe(false);
		expect(isDepartureDurable(undefined, "u1")).toBe(false);
	});
});

describe("isEventTerminal", () => {
	const SENT = {
		emailSentAt: "2026-07-19 00:00:00.000Z",
		emailWaivedAt: "",
		pushSentAt: "2026-07-19 00:00:00.000Z",
		pushWaivedAt: ""
	};

	it("aucune delivery (espace vide de destinataires) → consommé d'emblée", () => {
		expect(isEventTerminal([])).toBe(true);
	});

	it("toutes les deliveries réglées → terminal", () => {
		expect(isEventTerminal([{ ...SENT }, { ...SENT, emailSentAt: "", emailWaivedAt: "x" }])).toBe(
			true
		);
	});

	it("une delivery dont l'email est dû → non terminal (l'event attend le retry)", () => {
		expect(isEventTerminal([{ ...SENT }, { ...SENT, emailSentAt: "", emailWaivedAt: "" }])).toBe(
			false
		);
	});

	it("fan-out en échec → JAMAIS terminal (garde N3 : tableau vide = écritures ratées)", () => {
		expect(isEventTerminal([], { fanoutFailed: 3 })).toBe(false);
	});

	it("fan-out en échec partiel avec lignes réglées → non terminal (ligne manquante attendue)", () => {
		expect(isEventTerminal([{ ...SENT }], { fanoutFailed: 1 })).toBe(false);
	});
});
