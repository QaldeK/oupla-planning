/**
 * Tests d'intégration — R5.3 : verrouillage d'édition admin.
 *
 * Objectif :
 *   Vérifier le comportement des routes custom `/api/lock/{masterId}` et
 *   `/api/unlock/{masterId}` : acquire, heartbeat, conflit (409), expiration
 *   TTL, release, et les garde-fous d'auth (token, lockedBy).
 *
 * Le lock est purement UX : aucune restriction d'écriture n'est testée ici sur
 * `planning_masters` (le hook existant + `_version` restent les garde-fous data,
 * couverts par server-merge.test.ts). On valide seulement le cycle de vie du
 * lock dans la collection dédiée `planning_locks`.
 *
`lockedBy` = identifiant client (userId) passé dans le body. Deux userId
 * distincts permettent de simuler deux sessions partageant la même URL admin
 * (même adminToken) — cas d'usage principal du conflit.
 *
 * Prérequis :
 *   - PocketBase démarré sur http://127.0.0.1:8090
 *   - Admin de test créé (test@example.com / testpassword)
 *   - Collection `planning_locks` présente (étape 2 du plan R5.3)
 */

import { DatabaseSync } from "node:sqlite";
import PocketBase from "pocketbase";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authenticateAdmin, cleanupTrackedRecords, clearTrackedIds, seedPlanning } from "./seed";

const PB_URL = process.env.VITE_PLANNING_PB_URL || "http://127.0.0.1:8090";

// Client PB non authentifié, comme un vrai client guest admin (token en query).
// Les routes custom /api/lock et /api/unlock valident le token via master.adminToken.
function tokenClient(): PocketBase {
	return new PocketBase(PB_URL);
}

// Récupère la row planning_locks d'un master (via admin, bypass API Rules).
async function getLockRow(masterId: string): Promise<Record<string, any> | null> {
	const adminPb = await authenticateAdmin();
	try {
		return await adminPb.collection("planning_locks").getFirstListItem(`master = "${masterId}"`);
	} catch {
		return null;
	}
}

// Nettoyage défensif des rows planning_locks orphelines (la relation master a
// cascadeDelete, mais on sécurise au cas où un test laisse une row).
async function cleanupLocks() {
	const adminPb = await authenticateAdmin();
	try {
		const locks = await adminPb.collection("planning_locks").getFullList();
		for (const lock of locks) {
			await adminPb.collection("planning_locks").delete(lock.id);
		}
	} catch {
		// ignore
	}
}

// Vieillit `lockedAt` d'une row directement dans SQLite. L'autodate onUpdate de
// PocketBase écrase systématiquement la valeur au save, même quand elle est set
// explicitement via l'admin API — donc l'API ne permet pas de simuler un lock
// expiré. En bypassant PB via SQL direct on écrit la valeur brute, et PB la
// relit au prochain findRecordByFilter (pas de cache de row en mémoire). WAL
// mode de PB autorise cet accès concurrent ponctuel en écriture.
//
// NB : on utilise `node:sqlite` (et non `bun:sqlite`) car vitest tourne sous
// Node (pool: 'forks' = Node child processes), pas sous le runtime Bun. Le
// runner `bun run test:integration` ne fait qu'invoquer vitest via Node.
function ageLockInDb(masterId: string, ageMs: number): void {
	const db = new DatabaseSync("./pocketbase/pb_data/data.db");
	const expired = new Date(Date.now() - ageMs)
		.toISOString()
		.replace("T", " ")
		.replace(/\.\d+Z$/, ".000Z");
	db.prepare("UPDATE planning_locks SET lockedAt = ? WHERE master = ?").run(expired, masterId);
	db.close();
}

describe("R5.3 — Verrouillage d édition admin (routes /api/lock, /api/unlock)", () => {
	beforeEach(() => {
		clearTrackedIds();
	});

	afterEach(async () => {
		await cleanupLocks();
		await cleanupTrackedRecords();
	});

	// ---------------------------------------------------------------------------
	// 1. Acquire sur master vierge → 200 + row créée (création lazy)
	// ---------------------------------------------------------------------------
	it("crée un lock (lazy) sur un master jamais locké", async () => {
		const { master, adminToken } = await seedPlanning({ title: "R5.3 Acquire" });

		const pb = tokenClient();
		const res = await pb.send<{ lockedBy: string; lockedAt: string; expiresAt: string }>(
			`/api/lock/${master.id}`,
			{
				method: "POST",
				body: { lockedBy: "userA", lockedByName: "Alice" },
				query: { _token: adminToken }
			}
		);

		expect(res.lockedBy).toBe("userA");

		const row = await getLockRow(master.id);
		expect(row).not.toBeNull();
		expect(row!.lockedBy).toBe("userA");
		expect(row!.lockedByName).toBe("Alice");
	});

	// ---------------------------------------------------------------------------
	// 2. Heartbeat : même userId re-acquire → 200, lockedAt rafraîchi
	// ---------------------------------------------------------------------------
	it("rafraîchit lockedAt sur heartbeat du même détenteur", async () => {
		const { master, adminToken } = await seedPlanning({ title: "R5.3 Heartbeat" });

		const pb = tokenClient();
		const first = await pb.send<{ lockedAt: string }>(`/api/lock/${master.id}`, {
			method: "POST",
			body: { lockedBy: "userA" },
			query: { _token: adminToken }
		});

		// Force un delta visible (l'autodate a une précision ms)
		await new Promise((r) => setTimeout(r, 1100));

		const second = await pb.send<{ lockedAt: string }>(`/api/lock/${master.id}`, {
			method: "POST",
			body: { lockedBy: "userA" },
			query: { _token: adminToken }
		});

		expect(new Date(second.lockedAt).getTime()).toBeGreaterThan(new Date(first.lockedAt).getTime());
	});

	// ---------------------------------------------------------------------------
	// 3. Conflit : autre userId (même adminToken) → 409 avec détails du détenteur
	// ---------------------------------------------------------------------------
	it("renvoie 409 avec détails quand un autre admin détient un lock frais", async () => {
		const { master, adminToken } = await seedPlanning({ title: "R5.3 Conflit" });

		const pb = tokenClient();
		// userA acquire
		await pb.send(`/api/lock/${master.id}`, {
			method: "POST",
			body: { lockedBy: "userA", lockedByName: "Alice" },
			query: { _token: adminToken }
		});

		// userB tente → 409
		let caught: any;
		try {
			await pb.send(`/api/lock/${master.id}`, {
				method: "POST",
				body: { lockedBy: "userB" },
				query: { _token: adminToken }
			});
		} catch (err: any) {
			caught = err;
		}

		expect(caught).toBeDefined();
		expect(caught.status).toBe(409);
		// Le body du 409 contient les détails du détenteur courant
		expect(caught.response?.lockedBy).toBe("userA");
		expect(caught.response?.lockedByName).toBe("Alice");
		expect(caught.response?.expiresAt).toBeTruthy();
	});

	// ---------------------------------------------------------------------------
	// 4. Expiration TTL : lock avec lockedAt ancien → ré-acquisition par autrui
	// ---------------------------------------------------------------------------
	it("permet la ré-acquisition après expiration du TTL", async () => {
		const { master, adminToken } = await seedPlanning({ title: "R5.3 TTL Expiry" });

		const pb = tokenClient();
		await pb.send(`/api/lock/${master.id}`, {
			method: "POST",
			body: { lockedBy: "userA" },
			query: { _token: adminToken }
		});

		// Simule l'expiration : on vieillit lockedAt de 6 min (TTL = 5 min) directement
		// en SQL (l'autodate onUpdate écraserait toute valeur set via l'API PB).
		ageLockInDb(master.id, 6 * 60 * 1000);

		// userB peut maintenant acquérir
		const res = await pb.send<{ lockedBy: string }>(`/api/lock/${master.id}`, {
			method: "POST",
			body: { lockedBy: "userB" },
			query: { _token: adminToken }
		});

		expect(res.lockedBy).toBe("userB");
	});

	// ---------------------------------------------------------------------------
	// 5. Unlock par détenteur → 200, lockedBy vidé (row permanente)
	// ---------------------------------------------------------------------------
	it("libère le lock (clear lockedBy, row conservée)", async () => {
		const { master, adminToken } = await seedPlanning({ title: "R5.3 Unlock" });

		const pb = tokenClient();
		await pb.send(`/api/lock/${master.id}`, {
			method: "POST",
			body: { lockedBy: "userA" },
			query: { _token: adminToken }
		});

		const res = await pb.send<{ released: boolean }>(`/api/unlock/${master.id}`, {
			method: "POST",
			body: { lockedBy: "userA" },
			query: { _token: adminToken }
		});

		expect(res.released).toBe(true);

		const row = await getLockRow(master.id);
		// La row reste (permanente) mais lockedBy est vidé.
		expect(row).not.toBeNull();
		expect(row!.lockedBy).toBe("");
	});

	// ---------------------------------------------------------------------------
	// 6. Unlock par autrui → 403 (lock frais par un autre)
	// ---------------------------------------------------------------------------
	it("refuse le release d un lock détenu par un autre (403)", async () => {
		const { master, adminToken } = await seedPlanning({ title: "R5.3 Unlock 403" });

		const pb = tokenClient();
		await pb.send(`/api/lock/${master.id}`, {
			method: "POST",
			body: { lockedBy: "userA" },
			query: { _token: adminToken }
		});

		let caught: any;
		try {
			await pb.send(`/api/unlock/${master.id}`, {
				method: "POST",
				body: { lockedBy: "userB" },
				query: { _token: adminToken }
			});
		} catch (err: any) {
			caught = err;
		}

		expect(caught).toBeDefined();
		expect(caught.status).toBe(403);

		// Le lock de userA est toujours en place
		const row = await getLockRow(master.id);
		expect(row!.lockedBy).toBe("userA");
	});

	// ---------------------------------------------------------------------------
	// 7. Auth : adminToken invalide → 403
	// ---------------------------------------------------------------------------
	it("rejette un adminToken invalide (403)", async () => {
		const { master } = await seedPlanning({ title: "R5.3 Bad Token" });

		const pb = tokenClient();
		let caught: any;
		try {
			await pb.send(`/api/lock/${master.id}`, {
				method: "POST",
				body: { lockedBy: "userA" },
				query: { _token: "wrongtoken" }
			});
		} catch (err: any) {
			caught = err;
		}

		expect(caught).toBeDefined();
		expect(caught.status).toBe(403);
	});

	// ---------------------------------------------------------------------------
	// 8. Validation : lockedBy manquant → 400
	// ---------------------------------------------------------------------------
	it("rejette un acquire sans lockedBy (400)", async () => {
		const { master, adminToken } = await seedPlanning({ title: "R5.3 No userId" });

		const pb = tokenClient();
		let caught: any;
		try {
			await pb.send(`/api/lock/${master.id}`, {
				method: "POST",
				body: { lockedByName: "NoUser" },
				query: { _token: adminToken }
			});
		} catch (err: any) {
			caught = err;
		}

		expect(caught).toBeDefined();
		expect(caught.status).toBe(400);
	});

	// ---------------------------------------------------------------------------
	// 9. Non-régression : unlock idempotent (rien à release)
	// ---------------------------------------------------------------------------
	it("unlock est idempotent si aucune row n existe", async () => {
		const { master, adminToken } = await seedPlanning({ title: "R5.3 Idempotent" });

		const pb = tokenClient();
		const res = await pb.send<{ released: boolean }>(`/api/unlock/${master.id}`, {
			method: "POST",
			body: { lockedBy: "userA" },
			query: { _token: adminToken }
		});

		expect(res.released).toBe(true);
		expect(await getLockRow(master.id)).toBeNull();
	});
});
