import path from "path";
import { describe, expect, it } from "vitest";

// Politique de consommation de la file notification_events (phase 2 du cron).
// Contrat de `processedAt` : état terminal — « cet event ne sera plus jamais
// touché ». Les records PB sont mockés via mkRecord() (cf. jx-detector).
//
// Couverture classifyPendingEvent :
//   - master/occurrence introuvables → mort
//   - occurrence supprimée/annulée : mort pour J-X et new_comment, VIVANT
//     pour les change events (l'état de l'occ EST la nouvelle à délivrer)
//   - occurrence passée → mort (garde d'obsolescence, quel que soit le type)
//   - borne « aujourd'hui » : vivant
//
// Couverture splitTerminalItems :
//   - sans bucket email / buckets tous réussis → terminal
//   - au moins un bucket en échec → retry (seule survie autorisée : SMTP down)

const HOOKS_DIR = path.resolve(__dirname, "../../", "pocketbase/pb_hooks");
(globalThis as any).__hooks = HOOKS_DIR;

const { classifyPendingEvent, splitTerminalItems } = await import(
	"../../pocketbase/pb_hooks/notification-consumer.js"
);

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
// splitTerminalItems
// ============================================================================

describe("splitTerminalItems", () => {
	it("item sans bucket email → terminal (consommé sans email possible)", () => {
		const item = { bucketKeys: [] as string[] };
		const { terminal, retry } = splitTerminalItems([item], new Set(["b1"]));
		expect(terminal).toEqual([item]);
		expect(retry).toEqual([]);
	});

	it("item dont tous les buckets ont réussi → terminal", () => {
		const item = { bucketKeys: ["b1", "b2"] };
		const { terminal, retry } = splitTerminalItems([item], new Set());
		expect(terminal).toEqual([item]);
		expect(retry).toEqual([]);
	});

	it("item avec un bucket en échec → retry (seule survie autorisée : SMTP down)", () => {
		const item = { bucketKeys: ["b1", "b2"] };
		const { terminal, retry } = splitTerminalItems([item], new Set(["b2"]));
		expect(terminal).toEqual([]);
		expect(retry).toEqual([item]);
	});

	it("mélange d'items → séparation correcte", () => {
		const consumed = { bucketKeys: [] };
		const emailed = { bucketKeys: ["b1"] };
		const blocked = { bucketKeys: ["b1", "b2"] };
		const { terminal, retry } = splitTerminalItems([consumed, emailed, blocked], new Set(["b2"]));
		expect(terminal).toEqual([consumed, emailed]);
		expect(retry).toEqual([blocked]);
	});
});
