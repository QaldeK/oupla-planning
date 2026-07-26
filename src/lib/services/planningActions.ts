import { format } from "date-fns";
import { ClientResponseError } from "pocketbase";
import { mastersCollection, occurrencesCollection } from "$lib/data/collections";
import { withRetry } from "$lib/pb-sync/retry.utils";
import { pb } from "$lib/pocketbase/pb";
import { commentStateService } from "$lib/services/commentStateService";
import type {
	OccurrenceComment,
	OccurrenceTarget,
	Participant,
	ParticipantResponse,
	PlanningMaster,
	PlanningOccurrence,
	RecurrenceConfig,
	ResponseType,
	Task,
	TaskType,
	TimeSlot
} from "$lib/types/planning.types";
import { formatSlotKey } from "$lib/utils/slots";

// ============================================
// Génération de tokens
// ============================================

export function generateAdminToken(): string {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateParticipantToken(): string {
	const array = new Uint8Array(16);
	crypto.getRandomValues(array);
	return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateParticipantId(): string {
	const array = new Uint8Array(8);
	crypto.getRandomValues(array);
	return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ============================================
// Utilitaires
// ============================================

export function normalizeResponseTypes(types?: ResponseType[]): ResponseType[] {
	if (!types || types.length === 0) return [];
	const order: Record<ResponseType, number> = { present: 1, if_needed: 2, maybe: 3, absent: 4 };
	return types.sort((a, b) => order[a] - order[b]);
}

export function sortTasks(tasks: Task[] | null | undefined): Task[] | null {
	if (!tasks || tasks.length === 0) return null;
	const order: Record<TaskType, number> = { beforeEvent: 1, onEvent: 2, afterEvent: 3 };
	return [...tasks].sort((a, b) => order[a.type] - order[b.type]);
}

// ============================================
// Multi-créneaux : templates de slots
// ============================================

/**
 * Génère un id court type `s1`, `s2`... pour un nouveau timeSlot.
 *
 * Algo : `s${maxNumericId + 1}` calculé depuis les ids `s<N>` déjà présents dans
 * `existing`. Les ids non conformes (UUID legacy, etc.) sont ignorés. Particularités :
 *  - Déterministe et lisible en DB.
 *  - Évite la collision avec les slots déjà présents au moment de l'ajout.
 *  - Un id supprimé peut être réutilisé une fois ses occurrences soft-deletées
 *    au save (la suppression d'un slot entraîne le soft-delete de ses occurrences
 *    via le diff) — sans risque de mal-référencement d'une occurrence active.
 */
export function generateTimeSlotId(existing: { id: string }[]): string {
	let max = 0;
	for (const s of existing) {
		const match = /^s(\d+)$/.exec(s.id);
		if (match) {
			const n = Number(match[1]);
			if (n > max) max = n;
		}
	}
	return `s${max + 1}`;
}

/**
 * Résout les templates de créneaux effectifs d'un master. Renvoie toujours au
 * moins un slot explicite : si `timeSlots` est absent ou vide (master legacy
 * mono-créneau non encore nettoyé), on synthétise un slot unique `s1` depuis
 * `defaultStartTime`/`defaultEndTime`. Plus de sentinelle `'default'`.
 */
export function resolveTimeSlots(
	master: Pick<PlanningMaster, "timeSlots" | "defaultStartTime" | "defaultEndTime">
): TimeSlot[] {
	if (master.timeSlots && master.timeSlots.length > 0) {
		return master.timeSlots;
	}
	return [
		{
			id: "s1",
			startTime: master.defaultStartTime,
			endTime: master.defaultEndTime
		}
	];
}

/**
 * Shape attendue par `isOverridden` pour résoudre les slots templates de référence.
 * Accepte aussi bien un `PlanningMaster` complet qu'un `CreatePlanningData`
 * (qui est l'état cible du master après save).
 */
type TimeSlotResolvable = Pick<PlanningMaster, "timeSlots" | "defaultStartTime" | "defaultEndTime">;

/**
 * Détermine si une occurrence est en override d'horaires par rapport au slot
 * template qu'elle référence. La comparaison se fait contre `master` vu comme
 * l'état **cible** du master après save — d'où l'acceptation d'un type
 * structural qui couvre `CreatePlanningData`.
 *
 * Une occurrence sans `slotId` (custom pur) n'est jamais overridée. Un `slotId`
 * orphelin (template supprimé) est traité comme non-overridé afin de ne pas
 * écarter une occurrence dont le template d'origine a disparu.
 */
export function isOverridden(
	occ: Pick<PlanningOccurrence, "slotId" | "startTime" | "endTime">,
	master: TimeSlotResolvable
): boolean {
	if (!occ.slotId) return false;
	const slot = resolveTimeSlots(master).find((s) => s.id === occ.slotId);
	if (!slot) return false;
	return occ.startTime !== slot.startTime || occ.endTime !== slot.endTime;
}

// ============================================
// Planning Master
// ============================================

interface CreatePlanningData {
	title: string;
	description?: string;
	place?: string;
	defaultStartTime: string;
	defaultEndTime: string;
	/** Catalogue multi-créneaux (canonical). Optionnel pour rétrocompat : fallback sur defaultStartTime/EndTime. */
	timeSlots?: TimeSlot[];
	recurrence: RecurrenceConfig;
	/**
	 * Occurrences cibles voulues par l'admin (contrat formulaire↔service, source unique côté UI).
	 * Le service apply un diff contre les occurrences existantes : create/update/soft-delete/un-soft-delete.
	 * Si absent, aucune occurrence n'est créée/mise à jour (utile pour `createPlanning` qui ne gère que le master).
	 */
	occurrenceTargets?: OccurrenceTarget[];
	tasks?: Task[];
	participants?: Participant[];
	minPresentRequired: number;
	allowResponses: boolean;
	toConfirm?: boolean;
	availableResponseTypes?: ResponseType[];
	forceTaskRefresh?: boolean;
}

export async function createPlanning(
	data: CreatePlanningData,
	adminToken?: string,
	participantToken?: string
): Promise<PlanningMaster> {
	const finalAdminToken = adminToken || generateAdminToken();
	const finalParticipantToken = participantToken || generateParticipantToken();

	return await mastersCollection.create({
		...data,
		tasks: sortTasks(data.tasks) ?? [],
		adminToken: finalAdminToken,
		participantToken: finalParticipantToken,
		participants: data.participants || [],
		availableResponseTypes: normalizeResponseTypes(data.availableResponseTypes),
		lastModifiedBy: pb.authStore.record?.id
	});
}

/**
 * Crée un planning master et ses occurrences de manière atomique (batch)
 */
export async function createPlanningWithOccurrences(
	data: CreatePlanningData,
	adminToken?: string,
	participantToken?: string
): Promise<PlanningMaster> {
	const finalAdminToken = adminToken || generateAdminToken();
	const finalParticipantToken = participantToken || generateParticipantToken();

	// 1. Créer le planning master via pb-sync (PB create + Dexie put)
	const master = await mastersCollection.create({
		title: data.title,
		description: data.description,
		place: data.place,
		defaultStartTime: data.defaultStartTime,
		defaultEndTime: data.defaultEndTime,
		timeSlots: data.timeSlots,
		recurrence: data.recurrence,
		tasks: sortTasks(data.tasks) ?? [],
		minPresentRequired: data.minPresentRequired,
		allowResponses: data.allowResponses,
		toConfirm: data.toConfirm,
		availableResponseTypes: normalizeResponseTypes(data.availableResponseTypes),
		adminToken: finalAdminToken,
		participantToken: finalParticipantToken,
		participants: data.participants || [],
		lastModifiedBy: pb.authStore.record?.id
	});

	// 2. Créer les occurrences depuis les cibles voulues (contrat formulaire↔service).
	// Pas de fallback : si occurrenceTargets est absent, aucune occurrence n'est créée.
	const targets: OccurrenceTarget[] = data.occurrenceTargets ?? [];
	if (targets.length > 0) {
		const batch = occurrencesCollection.createBatch();
		for (const target of targets) {
			batch.create({
				master: master.id,
				date: target.date,
				startTime: target.startTime,
				endTime: target.endTime,
				slotId: target.slotId,
				responses: [],
				comments: [],
				isConfirmed: false,
				isCanceled: false,
				lastModifiedBy: pb.authStore.record?.id
			});
		}
		await batch.send();
	}

	return master;
}

// Type de retour pour getPlanningByToken avec gestion d'erreur typée
export type GetPlanningByTokenResult =
	| { master: PlanningMaster; isAdmin: boolean }
	| { error: "network" | "not_found" };

export async function getPlanningByToken(token: string): Promise<GetPlanningByTokenResult> {
	try {
		const master = await pb
			.collection("planning_masters")
			.getFirstListItem<PlanningMaster>(
				`participantToken = "${token}" || adminToken = "${token}"`,
				{ query: { _token: token } }
			);

		// fire-and-forget claim pour les liens admin
		if (pb.authStore.isValid && token.length === 64) {
			const record = pb.authStore.record;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- champ adminOf ajouté par hook serveur, absent des types RecordModel
			const adminOf = (record as any)?.adminOf || {};
			const masterId = master.id;

			if (!adminOf[masterId]) {
				pb.send("/api/claim-admin", {
					method: "POST",
					body: { token }
				})
					.then(() => {
						// Rafraîchir le record pour mettre adminOf et masterId à jour en mémoire
						return pb.collection("users").authRefresh();
					})
					.catch((err) => {
						console.warn("claim-admin failed:", err);
					});
			}
		}
		// NOTE: adminToken est masqué par onRecordEnrich, donc on se base sur la longueur du token
		// AdminToken = 64 chars, ParticipantToken = 32 chars
		return { master, isAdmin: token.length === 64 };
	} catch (error: unknown) {
		if (error instanceof ClientResponseError && error.status === 404) {
			return { error: "not_found" };
		}

		// Annulation (auto-cancellation) → traiter comme réseau
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- isAbort est une propriété non-standard d'annulation
		if (error instanceof Error && "isAbort" in error && (error as any).isAbort) {
			return { error: "network" };
		}

		// Toutes les autres erreurs (réseau, timeout, 500, etc.) → erreur réseau
		return { error: "network" };
	}
}

export async function updatePlanning(
	masterId: string,
	updates: Partial<PlanningMaster>,
	token: string,
	_currentMaster?: PlanningMaster
): Promise<PlanningMaster> {
	const updateData = { ...updates, lastModifiedBy: pb.authStore.record?.id };
	if (updateData.tasks) {
		const sorted = sortTasks(updateData.tasks);
		if (sorted) updateData.tasks = sorted;
	}
	return await mastersCollection.update(masterId, updateData, {
		query: { _token: token }
	});
}

/**
 * Met à jour un planning master et ses occurrences de manière atomique (batch)
 * Note: hors pb-sync car batch multi-collections (non pris en charge par pb-sync)
 * @param expectedVersion - Optionnel, timestamp `updated` du master pour optimistic locking
 */
export async function updatePlanningWithOccurrences(
	masterId: string,
	data: CreatePlanningData,
	adminToken: string,
	participantToken: string,
	expectedVersion?: string
): Promise<PlanningMaster> {
	const today = format(new Date(), "yyyy-MM-dd");
	const normalizeDate = (d: string) => d.split(" ")[0].split("T")[0];

	// Charger les occurrences futures, **soft-deleted incluses**. La réactivation d'une
	// DateSlot désactivée = un-soft-delete d'une occurrence existante (préserve responses/comments/id).
	const existingOccurrences = await pb
		.collection("planning_occurrences")
		.getFullList<PlanningOccurrence>({
			filter: `master = "${masterId}" && date >= "${today}"`,
			query: { _token: adminToken }
		});

	// Cibles = occurrences voulues par l'admin, futures uniquement.
	// Pas de fallback : si occurrenceTargets est absent, aucune occurrence n'est touchée.
	const allTargets: OccurrenceTarget[] = data.occurrenceTargets ?? [];
	const targets = allTargets.filter((t) => normalizeDate(t.date) >= today);

	// Index des existantes par id ET par clé date|slotId (fallback pour les cibles sans id).
	const existingById = new Map<string, PlanningOccurrence>();
	const existingByKey = new Map<string, PlanningOccurrence>();
	for (const occ of existingOccurrences) {
		existingById.set(occ.id, occ);
		existingByKey.set(formatSlotKey(normalizeDate(occ.date), occ.slotId), occ);
	}

	// Cibles matchées (pour identifier les existantes à soft-deleter ensuite).
	const matchedExistingIds = new Set<string>();

	const batch = pb.createBatch();

	// Master update avec vérification de version (optimistic locking)
	const masterQuery: Record<string, string> = { _token: adminToken };
	if (expectedVersion) {
		masterQuery._version = expectedVersion;
	}

	batch.collection("planning_masters").update(
		masterId,
		{
			title: data.title,
			description: data.description,
			place: data.place,
			defaultStartTime: data.defaultStartTime,
			defaultEndTime: data.defaultEndTime,
			timeSlots: data.timeSlots,
			recurrence: data.recurrence,
			tasks: sortTasks(data.tasks),
			minPresentRequired: data.minPresentRequired,
			allowResponses: data.allowResponses,
			toConfirm: data.toConfirm,
			availableResponseTypes: normalizeResponseTypes(data.availableResponseTypes),
			lastModifiedBy: pb.authStore.record?.id
		},
		{ query: masterQuery }
	);

	// Parcourir les cibles : create / update / un-soft-delete.
	// L'override est porté par la cible (horaires voulus) — on l'apply tel quel, sans
	// recourir à isOverridden. responses/comments/isConfirmed/isCanceled sont préservés
	// sur l'existante matchée (qu'elle soit active ou soft-deleted).
	for (const target of targets) {
		const targetDate = normalizeDate(target.date);
		let existing: PlanningOccurrence | undefined;
		if (target.id) existing = existingById.get(target.id);
		if (!existing) {
			existing = existingByKey.get(formatSlotKey(targetDate, target.slotId));
		}
		if (existing) {
			matchedExistingIds.add(existing.id);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- updateData construit dynamiquement pour batch, type partiel non adapté
			const updateData: any = {
				date: targetDate,
				startTime: target.startTime,
				endTime: target.endTime,
				slotId: target.slotId,
				deleted: false, // un-soft-delete si elle l'était (réactivation d'une DateSlot)
				lastModifiedBy: pb.authStore.record?.id
			};
			if (data.forceTaskRefresh) updateData.tasks = sortTasks(data.tasks);
			batch
				.collection("planning_occurrences")
				.update(existing.id, updateData, { query: { _token: adminToken } });
		} else {
			batch.collection("planning_occurrences").create(
				{
					master: masterId,
					date: targetDate,
					startTime: target.startTime,
					endTime: target.endTime,
					slotId: target.slotId,
					responses: [],
					comments: [],
					isConfirmed: false,
					isCanceled: false,
					lastModifiedBy: pb.authStore.record?.id
				},
				{ query: { _token: adminToken } }
			);
		}
	}

	// Soft-delete les existantes actives non ciblées. Les soft-deleted non ciblées
	// restent telles quelles (déjà désactivées). C'est ici que le bug temporaire est
	// résolu : une occurrence overridée désactivée par l'admin (absente des cibles)
	// est enfin soft-deletée, puisque le test `isOverridden` disparaît.
	for (const occ of existingOccurrences) {
		if (occ.deleted === true) continue;
		if (matchedExistingIds.has(occ.id)) continue;
		batch
			.collection("planning_occurrences")
			.update(
				occ.id,
				{ deleted: true, lastModifiedBy: pb.authStore.record?.id },
				{ query: { _token: adminToken } }
			);
	}

	try {
		await withRetry(() => batch.send());
	} catch (e: unknown) {
		console.error(
			"Batch error detail:",
			JSON.stringify(e instanceof ClientResponseError ? e.data : e, null, 2)
		);
		if (e instanceof ClientResponseError) console.error("Batch error response:", e.response);
		throw e;
	}

	return await pb.collection("planning_masters").getOne<PlanningMaster>(masterId, {
		query: { _token: adminToken }
	});
}

export async function deletePlanning(masterId: string, token: string): Promise<void> {
	await mastersCollection.remove(masterId, { query: { _token: token } });
}

// ============================================
// Participants
// ============================================

export async function addParticipant(
	masterId: string,
	participant: Omit<Participant, "id" | "createdAt"> & { id?: string },
	token: string
): Promise<PlanningMaster> {
	const newParticipant: Participant = {
		...participant,
		id: participant.id || generateParticipantId(),
		createdAt: new Date().toISOString()
	};

	// Lire le master depuis Dexie pour calculer la nouvelle liste
	const current = await mastersCollection.getTable().get(masterId);
	if (!current) throw new Error(`Master ${masterId} not found in local DB`);

	return await mastersCollection.update(
		masterId,
		{
			participants: [
				...(current.participants || []).filter((p) => p.id !== newParticipant.id),
				newParticipant
			],
			lastModifiedBy: pb.authStore.record?.id
		},
		{ query: { _token: token } }
	);
}

export async function updateParticipant(
	masterId: string,
	participantId: string,
	updates: Partial<Participant>,
	token: string,
	currentMaster?: PlanningMaster
): Promise<PlanningMaster> {
	const current = currentMaster ?? (await mastersCollection.getTable().get(masterId));
	if (!current) throw new Error(`Master ${masterId} not found in local DB`);

	const updatedParticipants = (current.participants || []).map((p) =>
		p.id === participantId ? { ...p, ...updates } : p
	);

	return await mastersCollection.update(
		masterId,
		{ participants: updatedParticipants, lastModifiedBy: pb.authStore.record?.id },
		{ query: { _token: token } }
	);
}

export async function quitPlanning(
	masterId: string,
	participantId: string,
	token: string,
	currentMaster?: PlanningMaster
): Promise<PlanningMaster> {
	const current = currentMaster ?? (await mastersCollection.getTable().get(masterId));
	if (!current) throw new Error(`Master ${masterId} not found in local DB`);

	const updatedParticipants = (current.participants || []).map((p) =>
		p.id === participantId ? { ...p, hasQuit: true } : p
	);

	return await mastersCollection.update(
		masterId,
		{ participants: updatedParticipants, lastModifiedBy: pb.authStore.record?.id },
		{ query: { _token: token } }
	);
}

export async function removeParticipant(
	masterId: string,
	participantId: string,
	token: string,
	currentMaster?: PlanningMaster
): Promise<PlanningMaster> {
	const current = currentMaster ?? (await mastersCollection.getTable().get(masterId));
	if (!current) throw new Error(`Master ${masterId} not found in local DB`);

	return await mastersCollection.update(
		masterId,
		{
			participants: (current.participants || []).filter((p) => p.id !== participantId),
			lastModifiedBy: pb.authStore.record?.id
		},
		{ query: { _token: token } }
	);
}

// ============================================
// Migration d'identité guest → auth
// ============================================

export interface ClaimIdentityStats {
	/** Réponses identiques entre guest et auth (drop guest, sans impact) */
	identical: number;
	/** Réponses divergentes (auth wins, drop guest) */
	conflict: number;
	/** Réponses migrées du guest vers l'auth (seul guest avait répondu) */
	migrated: number;
	/** Commentaires re-attribués à l'auth */
	commentsMigrated: number;
}

export interface ClaimIdentityResult {
	success: boolean;
	stats: ClaimIdentityStats;
	/**
	 * ID du participant auth final. Peut être différent du guestParticipantId si
	 * l'auth avait déjà son propre participant (dans ce cas, le guest est supprimé).
	 */
	authParticipantId: string;
}

/**
 * Permet à un utilisateur authentifié de revendiquer une identité guest existante
 * sur un planning. L'endpoint PocketBase effectue le merge des réponses et
 * commentaires de manière atomique (transaction) et déclenche le realtime
 * automatiquement via `$app.save()`.
 *
 * Logique de merge (côté serveur) :
 * - Conflit sur même occurrence → auth wins
 * - Réponse identique → drop guest
 * - Seul guest a répondu → migrate vers auth
 * - Comments → re-attribution du participantId
 *
 * @param masterId ID du planning
 * @param guestParticipantId ID du participant guest à revendiquer
 * @param token participantToken ou adminToken du planning
 * @returns stats du merge + authParticipantId
 *
 * @throws 401 si non authentifié
 * @throws 400 si masterId ou guestParticipantId manquant
 * @throws 403 si token invalide
 * @throws 404 si guest participant introuvable
 * @throws 409 si guest déjà claimé (userId !== null), hasQuit, ou si l'auth a déjà
 *         revendiqué une identité sur ce planning (`claimedAt` posé)
 */
export async function claimParticipantIdentity(
	masterId: string,
	guestParticipantId: string,
	token: string
): Promise<ClaimIdentityResult> {
	return await pb.send("/api/claim-participant-identity", {
		method: "POST",
		body: { masterId, guestParticipantId },
		query: { _token: token }
	});
}

// ============================================
// Occurrences
// ============================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- paramètre polymorphe acceptant divers formats de données
export async function createOccurrence(data: any): Promise<PlanningOccurrence> {
	return await occurrencesCollection.create({
		...data,
		master: data.masterId,
		tasks: sortTasks(data.tasks),
		responses: [],
		comments: [],
		isConfirmed: false,
		isCanceled: false,
		lastModifiedBy: pb.authStore.record?.id
	});
}

export async function updateOccurrence(
	occurrenceId: string,
	updates: Partial<PlanningOccurrence>,
	token: string
): Promise<PlanningOccurrence> {
	const updateData = { ...updates, lastModifiedBy: pb.authStore.record?.id };
	if (updateData.tasks !== undefined) updateData.tasks = sortTasks(updateData.tasks);
	return await occurrencesCollection.update(occurrenceId, updateData, {
		query: { _token: token }
	});
}

export async function deleteOccurrence(occurrenceId: string, token: string): Promise<void> {
	await occurrencesCollection.remove(occurrenceId, { query: { _token: token } });
}

// ============================================
// Réponses
// ============================================

export async function submitResponse(
	occurrenceId: string,
	participantId: string,
	response: ParticipantResponse,
	token: string,
	currentOccurrence?: PlanningOccurrence
): Promise<PlanningOccurrence> {
	const current = currentOccurrence ?? (await occurrencesCollection.getTable().get(occurrenceId));
	if (!current) throw new Error(`Occurrence ${occurrenceId} not found in local DB`);

	const existingIdx = (current.responses || []).findIndex((r) => r.participantId === participantId);

	let updatedResponses: ParticipantResponse[];
	if (existingIdx >= 0) {
		updatedResponses = [...current.responses!];
		updatedResponses[existingIdx] = { ...response, participantId };
	} else {
		updatedResponses = [...(current.responses || []), { ...response, participantId }];
	}

	return await occurrencesCollection.update(
		occurrenceId,
		{ responses: updatedResponses, lastModifiedBy: pb.authStore.record?.id },
		{ query: { _token: token } }
	);
}

export const submitResponseSafe = submitResponse;

export async function removeResponse(
	occurrenceId: string,
	participantId: string,
	token: string,
	currentOccurrence?: PlanningOccurrence
): Promise<PlanningOccurrence> {
	const current = currentOccurrence ?? (await occurrencesCollection.getTable().get(occurrenceId));
	if (!current) throw new Error(`Occurrence ${occurrenceId} not found in local DB`);

	return await occurrencesCollection.update(
		occurrenceId,
		{
			responses: (current.responses || []).filter((r) => r.participantId !== participantId),
			lastModifiedBy: pb.authStore.record?.id
		},
		{ query: { _token: token } }
	);
}

// ============================================
// Commentaires
// ============================================

export async function addComment(
	occurrenceId: string,
	participantId: string,
	content: string,
	token: string,
	currentOccurrence?: PlanningOccurrence
): Promise<PlanningOccurrence> {
	const current = currentOccurrence ?? (await occurrencesCollection.getTable().get(occurrenceId));
	if (!current) throw new Error(`Occurrence ${occurrenceId} not found in local DB`);

	const newComment: OccurrenceComment = {
		id: generateParticipantId(),
		participantId,
		content,
		createdAt: new Date().toISOString()
	};

	const confirmed = await occurrencesCollection.update(
		occurrenceId,
		{
			comments: [...(current.comments || []), newComment],
			lastModifiedBy: pb.authStore.record?.id
		},
		{ query: { _token: token } }
	);

	commentStateService.markConversationAsRead(occurrenceId, current.master, true);
	return confirmed;
}

export async function deleteComment(
	occurrenceId: string,
	commentId: string,
	token: string,
	currentOccurrence?: PlanningOccurrence
): Promise<PlanningOccurrence> {
	const current = currentOccurrence ?? (await occurrencesCollection.getTable().get(occurrenceId));
	if (!current) throw new Error(`Occurrence ${occurrenceId} not found in local DB`);

	return await occurrencesCollection.update(
		occurrenceId,
		{
			comments: (current.comments || []).filter((c) => c.id !== commentId),
			lastModifiedBy: pb.authStore.record?.id
		},
		{ query: { _token: token } }
	);
}
