import { pb } from '$lib/pocketbase/pb';
import { generateRecurrenceDates } from '$lib/utils/recurrence';
import { mastersCollection, occurrencesCollection } from '$lib/stores/planningStore.svelte';
import { commentStateService } from '$lib/services/commentStateService';
import { format } from 'date-fns';
import type {
	PlanningMaster,
	PlanningOccurrence,
	Participant,
	ParticipantResponse,
	OccurrenceComment,
	RecurrenceConfig,
	Task,
	ResponseType,
	TaskType
} from '$lib/types/planning.types';

// ============================================
// Génération de tokens
// ============================================

export function generateAdminToken(): string {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateParticipantToken(): string {
	const array = new Uint8Array(16);
	crypto.getRandomValues(array);
	return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateParticipantId(): string {
	const array = new Uint8Array(8);
	crypto.getRandomValues(array);
	return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
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
// Planning Master
// ============================================

interface CreatePlanningData {
	title: string;
	description?: string;
	place?: string;
	defaultStartTime: string;
	defaultEndTime: string;
	recurrence: RecurrenceConfig;
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

	// 2. Générer les dates de récurrence
	const dates = data.recurrence.recurrenceDates || generateRecurrenceDates(data.recurrence);

	// 3. Créer toutes les occurrences via pb-sync batch (PB batch + Dexie puts)
	if (dates.length > 0) {
		const batch = occurrencesCollection.createBatch();
		for (const date of dates) {
			batch.create({
				master: master.id,
				date,
				startTime: data.defaultStartTime,
				endTime: data.defaultEndTime,
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
	| { error: 'network' | 'not_found' };

export async function getPlanningByToken(token: string): Promise<GetPlanningByTokenResult> {
	try {
		const master = await pb
			.collection('planning_masters')
			.getFirstListItem<PlanningMaster>(
				`participantToken = "${token}" || adminToken = "${token}"`,
				{ query: { _token: token } }
			);

		// fire-and-forget claim pour les liens admin
		if (pb.authStore.isValid && token.length === 64) {
			const record = pb.authStore.record;
			const adminOf = (record as any)?.adminOf || {};
			const masterId = master.id;

			if (!adminOf[masterId]) {
				pb.send('/api/claim-admin', {
					method: 'POST',
					body: { token }
				})
					.then(() => {
						// Rafraîchir le record pour mettre adminOf et masterId à jour en mémoire
						return pb.collection('users').authRefresh();
					})
					.catch((err) => {
						console.warn('claim-admin failed:', err);
					});
			}
		}
		// NOTE: adminToken est masqué par onRecordEnrich, donc on se base sur la longueur du token
		// AdminToken = 64 chars, ParticipantToken = 32 chars
		return { master, isAdmin: token.length === 64 };
	} catch (error: any) {
		// Erreur 404 explicite = planning introuvable
		if (error?.status === 404) {
			return { error: 'not_found' };
		}

		// Annulation (auto-cancellation) → traiter comme réseau
		if (error?.isAbort) {
			return { error: 'network' };
		}

		// Toutes les autres erreurs (réseau, timeout, 500, etc.) → erreur réseau
		return { error: 'network' };
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
 * @param expectedVersion - Optionnel, timestamp `updated` du master pour optimistic locking
 */
export async function updatePlanningWithOccurrences(
	masterId: string,
	data: CreatePlanningData,
	adminToken: string,
	participantToken: string,
	expectedVersion?: string
): Promise<PlanningMaster> {
	const today = format(new Date(), 'yyyy-MM-dd');
	const normalizeDate = (d: string) => d.split(' ')[0].split('T')[0];
	// Charger uniquement les occurrences futures
	const existingOccurrences = await pb
		.collection('planning_occurrences')
		.getFullList<PlanningOccurrence>({
			filter: `master = "${masterId}" && date >= "${today}" && deleted != true`,
			query: { _token: adminToken }
		});

	const allTargetDates =
		data.recurrence.recurrenceDates || generateRecurrenceDates(data.recurrence);
	const targetDates = allTargetDates.filter((date) => date >= today);

	const existingDatesMap = new Map(existingOccurrences.map((o) => [normalizeDate(o.date), o]));

	const batch = pb.createBatch();

	// Master update avec vérification de version (optimistic locking)
	const masterQuery: Record<string, string> = { _token: adminToken };
	if (expectedVersion) {
		masterQuery._version = expectedVersion;
	}

	batch.collection('planning_masters').update(
		masterId,
		{
			title: data.title,
			description: data.description,
			place: data.place,
			defaultStartTime: data.defaultStartTime,
			defaultEndTime: data.defaultEndTime,
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

	// Soft-delete des occurrences futures obsolètes (champ `deleted: true`)
	// — préserve la rattrapabilité par le delta sync (updated > since)
	for (const occ of existingOccurrences) {
		if (!targetDates.includes(normalizeDate(occ.date))) {
			batch
				.collection('planning_occurrences')
				.update(
					occ.id,
					{ deleted: true, lastModifiedBy: pb.authStore.record?.id },
					{ query: { _token: adminToken } }
				);
		}
	}

	// Créer ou mettre à jour les occurrences futures
	for (const date of targetDates) {
		const existing = existingDatesMap.get(date);
		if (existing) {
			const updateData: any = {
				startTime: data.defaultStartTime,
				endTime: data.defaultEndTime,
				lastModifiedBy: pb.authStore.record?.id
			};
			if (data.forceTaskRefresh) updateData.tasks = sortTasks(data.tasks);
			batch
				.collection('planning_occurrences')
				.update(existing.id, updateData, { query: { _token: adminToken } });
		} else {
			batch.collection('planning_occurrences').create(
				{
					master: masterId,
					date,
					startTime: data.defaultStartTime,
					endTime: data.defaultEndTime,
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

	try {
		await batch.send();
	} catch (e: any) {
		console.error('Batch error detail:', JSON.stringify(e.data, null, 2));
		console.error('Batch error response:', e.response);
		throw e;
	}

	return await pb.collection('planning_masters').getOne<PlanningMaster>(masterId, {
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
	participant: Omit<Participant, 'id' | 'createdAt'> & { id?: string },
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
	return await pb.send('/api/claim-participant-identity', {
		method: 'POST',
		body: { masterId, guestParticipantId },
		query: { _token: token }
	});
}

// ============================================
// Occurrences
// ============================================

export async function createOccurrence(
	data: any,
	adminToken: string,
	participantToken: string
): Promise<PlanningOccurrence> {
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
	token: string,
	_currentOccurrence?: PlanningOccurrence
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
