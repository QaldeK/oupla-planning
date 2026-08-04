/**
 * Helpers de seed pour les tests d'intégration.
 *
 * Rôle :
 *   - Créer des plannings de test dans PocketBase (via admin auth)
 *   - Créer des users de test avec masterId / adminOf configurés
 *   - Nettoyer les records PB créés pendant le test (cleanupTrackedRecords)
 *
 * Ces helpers sont conçus pour être appelés dans les beforeEach/afterEach
 * des fichiers .test.ts. Ils utilisent le client PocketBase admin pour
 * contourner les API Rules et créer des données de test propres.
 *
 * IMPORTANT : Le système de tracking assure que seuls les records créés
 * pendant le test sont supprimés. Utiliser clearTrackedIds() dans beforeEach
 * et cleanupTrackedRecords() dans afterEach.
 *
 * Fonctions exportées :
 *   - authenticateAdmin() : retourne un client PB authifié en admin
 *   - authenticateUser(email, pwd) : retourne un client PB authifié en user
 *   - seedPlanning(overrides?) : crée un master + N occurrences, retourne tokens
 *   - seedUser(email, pwd, name, options?) : crée un user avec masterId/adminOf
 *   - trackIds(collection, ...ids) : enregistre des IDs créés pour le cleanup
 *   - clearTrackedIds() : vide le registre d'IDs (à appeler dans beforeEach)
 *   - cleanupTrackedRecords() : supprime uniquement les records trackés
 *   - cleanupRecords() : DEPRECIE - supprime TOUS les records (dangerux)
 */
import PocketBase from "pocketbase";
import type { PlanningMaster, PlanningOccurrence } from "$lib/types/planning.types";

const PB_URL = process.env.VITE_PLANNING_PB_URL || "http://127.0.0.1:8090";

let adminPb: PocketBase | null = null;

function getAdminPb(): PocketBase {
	if (!adminPb) {
		adminPb = new PocketBase(PB_URL);
	}
	return adminPb;
}

export async function authenticateAdmin(): Promise<PocketBase> {
	const pb = getAdminPb();
	if (!pb.authStore.isValid) {
		await pb.collection("_superusers").authWithPassword("test@example.com", "testpassword");
	}
	return pb;
}

export async function authenticateUser(email: string, password: string): Promise<PocketBase> {
	const pb = new PocketBase(PB_URL);
	await pb.collection("users").authWithPassword(email, password);
	return pb;
}

export interface SeedPlanningResult {
	master: PlanningMaster;
	occurrences: PlanningOccurrence[];
	adminToken: string;
	participantToken: string;
}

/**
 * Retourne une date ISO (YYYY-MM-DD) à N jours de maintenant (UTC minuit).
 * Utilisée pour semer des occurrences futures / passées de façon déterministe.
 */
export function dateInDays(days: number): string {
	const d = new Date();
	d.setUTCDate(d.getUTCDate() + days);
	d.setUTCHours(0, 0, 0, 0);
	return d.toISOString().split("T")[0];
}

function generateAdminToken(): string {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

function generateParticipantToken(): string {
	const array = new Uint8Array(16);
	crypto.getRandomValues(array);
	return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

// --- Tracking des records créés pendant le test ---

const trackedIds = {
	planning_masters: new Set<string>(),
	planning_occurrences: new Set<string>(),
	planning_participants: new Set<string>(),
	users: new Set<string>()
};

/**
 * Enregistre des IDs créés pour le cleanup ciblé.
 * À appeler manuellement pour les records créés hors de seedPlanning/seedUser.
 */
export function trackIds(
	collection: "planning_masters" | "planning_occurrences" | "planning_participants" | "users",
	...ids: string[]
) {
	const set = trackedIds[collection];
	if (set) {
		for (const id of ids) {
			set.add(id);
		}
	}
}

/**
 * Vide le registre d'IDs trackés.
 * À appeler dans beforeEach() pour garantir l'isolation entre tests.
 */
export function clearTrackedIds() {
	trackedIds.planning_masters.clear();
	trackedIds.planning_occurrences.clear();
	trackedIds.planning_participants.clear();
	trackedIds.users.clear();
}

/**
 * Supprime uniquement les records qui ont été trackés pendant le test.
 * À appeler dans afterEach() comme alternative sûre à cleanupRecords().
 */
export async function cleanupTrackedRecords() {
	const pb = await authenticateAdmin();

	// Supprimer dans l'ordre des dépendances (occurrences avant masters)
	for (const id of trackedIds.planning_occurrences) {
		try {
			await pb.collection("planning_occurrences").delete(id);
		} catch {
			// ignore (déjà supprimé ou n'existe plus)
		}
	}

	for (const id of trackedIds.planning_participants) {
		try {
			await pb.collection("planning_participants").delete(id);
		} catch {
			// ignore
		}
	}

	for (const id of trackedIds.planning_masters) {
		try {
			await pb.collection("planning_masters").delete(id);
		} catch {
			// ignore
		}
	}

	for (const id of trackedIds.users) {
		try {
			await pb.collection("users").delete(id);
		} catch {
			// ignore
		}
	}

	clearTrackedIds();
}

export async function seedPlanning(
	overrides?: Partial<PlanningMaster> & {
		occurrenceCount?: number;
		/** Décale toutes les occ de N jours depuis today. Défaut : 7 (future, dans la fenêtre J-X de 20j). */
		occurrenceDayOffset?: number;
		/** Date ISO imposée pour toutes les occ. Alias de occurrenceDayOffset=0 si absente. */
		occurrenceDate?: string;
		/** Dates ISO explicites (mix passé/futur possible). Si fourni, occurrenceCount est ignoré. */
		occurrenceDates?: string[];
	}
): Promise<SeedPlanningResult> {
	const pb = await authenticateAdmin();

	const adminToken = overrides?.adminToken || generateAdminToken();
	const participantToken = overrides?.participantToken || generateParticipantToken();

	const masterData = {
		title: overrides?.title || "Test Planning",
		description: overrides?.description || "Description de test",
		place: overrides?.place || "Lieu de test",
		defaultStartTime: overrides?.defaultStartTime || "09:00",
		defaultEndTime: overrides?.defaultEndTime || "17:00",
		recurrence: overrides?.recurrence || {
			type: "CUSTOM" as const
		},
		tasks: overrides?.tasks || [],
		participants: overrides?.participants || [],
		minPresentRequired: overrides?.minPresentRequired ?? 1,
		allowResponses: overrides?.allowResponses ?? true,
		toConfirm: overrides?.toConfirm ?? false,
		availableResponseTypes: overrides?.availableResponseTypes || ["present", "absent"],
		adminToken,
		participantToken,
		lastModifiedBy: ""
	};

	const master = await pb.collection("planning_masters").create<PlanningMaster>(masterData);
	trackedIds.planning_masters.add(master.id);

	// Résolution des dates d'occ : occurrenceDates explicites > occurrenceDate unique >
	// occurrenceDayOffset > défaut J+7 (future, dans la fenêtre J-X de 20j du cron).
	let occurrenceDates: string[];
	if (overrides?.occurrenceDates && overrides.occurrenceDates.length > 0) {
		occurrenceDates = overrides.occurrenceDates;
	} else if (overrides?.occurrenceDate) {
		const count = overrides?.occurrenceCount ?? 1;
		occurrenceDates = Array(count).fill(overrides.occurrenceDate);
	} else {
		const offset = overrides?.occurrenceDayOffset ?? 7;
		const count = overrides?.occurrenceCount ?? 3;
		occurrenceDates = Array(count).fill(dateInDays(offset));
	}
	const occurrences: PlanningOccurrence[] = [];

	for (const date of occurrenceDates) {
		const occ = await pb.collection("planning_occurrences").create<PlanningOccurrence>({
			master: master.id,
			date,
			startTime: "09:00",
			endTime: "17:00",
			responses: [],
			comments: [],
			tasks: [],
			isConfirmed: false,
			isCanceled: false,
			lastModifiedBy: ""
		});
		occurrences.push(occ);
		trackedIds.planning_occurrences.add(occ.id);
	}

	return { master, occurrences, adminToken, participantToken };
}

export async function seedUser(
	email: string,
	password: string,
	name: string,
	options?: {
		masterIds?: string[];
		adminOf?: Record<string, string>;
		locale?: "fr" | "en";
	}
) {
	const pb = await authenticateAdmin();

	try {
		const user = await pb.collection("users").create({
			email,
			password,
			passwordConfirm: password,
			name,
			masterId: options?.masterIds || [],
			adminOf: options?.adminOf || {},
			...(options?.locale ? { locale: options.locale } : {}),
			emailVisibility: true,
			verified: true
		});
		trackedIds.users.add(user.id);
		return user;
	} catch {
		// User might already exist — return it
		const users = await pb.collection("users").getFullList({ filter: `email = "${email}"` });
		const existing = users[0];
		if (existing) {
			trackedIds.users.add(existing.id);
		}
		return existing;
	}
}

/**
 * @deprecated Utiliser cleanupTrackedRecords() à la place.
 * cleanupRecords() supprime TOUS les records de toutes les collections,
 * y compris les données préexistantes (production, demo, etc.).
 * Ce n'est pas un vrai cleanup mais un reset de base de données.
 */
export async function cleanupRecords() {
	const pb = await authenticateAdmin();

	try {
		const participants = await pb.collection("planning_participants").getFullList();
		for (const p of participants) {
			await pb.collection("planning_participants").delete(p.id);
		}
	} catch {
		// ignore
	}

	try {
		const occurrences = await pb.collection("planning_occurrences").getFullList();
		for (const occ of occurrences) {
			await pb.collection("planning_occurrences").delete(occ.id);
		}
	} catch {
		// ignore
	}

	try {
		const masters = await pb.collection("planning_masters").getFullList();
		for (const master of masters) {
			await pb.collection("planning_masters").delete(master.id);
		}
	} catch {
		// ignore
	}
}

export async function cleanupUsers(emails: string[]) {
	const adminPb = await authenticateAdmin();
	for (const email of emails) {
		try {
			const users = await adminPb.collection("users").getFullList({
				filter: `email = "${email}"`
			});
			for (const user of users) {
				await adminPb.collection("users").delete(user.id);
			}
		} catch {
			// ignore
		}
	}
}

export interface SeedParticipantPrefsOptions {
	push?: boolean;
	email?: boolean;
	/** Options multi-select : "1" | "3" | "7" (laisser vide = aucune relance). */
	reminderDays?: string[];
	/** Options multi-select : "1" | "3" | "7" | "15" (laisser vide = aucune relance). */
	missingParticipantsDays?: string[];
	onCancellation?: boolean;
	onTimeChange?: boolean;
}

export async function seedParticipantPrefs(
	planningId: string,
	userId: string,
	options?: SeedParticipantPrefsOptions
) {
	const pb = await authenticateAdmin();

	const record = await pb.collection("planning_participants").create({
		planning: planningId,
		user: userId,
		push: options?.push ?? false,
		email: options?.email ?? false,
		reminderDays: options?.reminderDays ?? [],
		missingParticipantsDays: options?.missingParticipantsDays ?? [],
		onCancellation: options?.onCancellation ?? false,
		onTimeChange: options?.onTimeChange ?? false
	});
	trackedIds.planning_participants.add(record.id);
	return record;
}
