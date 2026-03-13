import { pb } from '$lib/pocketbase/pb';
import { generateRecurrenceDates } from '$lib/utils/recurrence';
import { userStore } from '$lib/stores/userStore.svelte';
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

	return await pb.collection('planning_masters').create<PlanningMaster>({
		...data,
		tasks: sortTasks(data.tasks),
		adminToken: finalAdminToken,
		participantToken: finalParticipantToken,
		participants: data.participants || [],
		availableResponseTypes: normalizeResponseTypes(data.availableResponseTypes),
		lastModifiedBy: userStore.globalProfile?.id
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

	// 1. Créer le planning master d'abord (pour avoir son ID)
	const master = await pb.collection('planning_masters').create<PlanningMaster>({
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
		adminToken: finalAdminToken,
		participantToken: finalParticipantToken,
		participants: data.participants || [],
		lastModifiedBy: userStore.globalProfile?.id
	});

	// 2. Générer les dates de récurrence
	const dates = data.recurrence.recurrenceDates || generateRecurrenceDates(data.recurrence);

	// 3. Créer toutes les occurrences dans un batch
	const batch = pb.createBatch();
	for (const date of dates) {
		batch.collection('planning_occurrences').create({
			master: master.id,
			date,
			startTime: data.defaultStartTime,
			endTime: data.defaultEndTime,
			responses: [],
			comments: [],
			isConfirmed: false,
			isCanceled: false,
			adminToken: finalAdminToken,
			participantToken: finalParticipantToken,
			lastModifiedBy: userStore.globalProfile?.id
		});
	}

	await batch.send();

	return master;
}

export async function getPlanningByToken(token: string): Promise<{
	master: PlanningMaster;
	isAdmin: boolean;
} | null> {
	try {
		const master = await pb
			.collection('planning_masters')
			.getFirstListItem<PlanningMaster>(
				`participantToken = "${token}" || adminToken = "${token}"`,
				{ query: { _token: token } }
			);
		return { master, isAdmin: master.adminToken === token };
	} catch (error: any) {
		if (error?.status === 404) return null;
		console.error('Error fetching planning:', error);
		return null;
	}
}

export async function updatePlanning(
	masterId: string,
	updates: Partial<PlanningMaster>,
	token: string
): Promise<PlanningMaster> {
	const updateData = { ...updates, lastModifiedBy: userStore.globalProfile?.id };
	if (updateData.tasks) updateData.tasks = sortTasks(updateData.tasks);
	return await pb.collection('planning_masters').update<PlanningMaster>(masterId, updateData, {
		query: { _token: token }
	});
}

/**
 * Met à jour un planning master et ses occurrences de manière atomique (batch)
 */
export async function updatePlanningWithOccurrences(
	masterId: string,
	data: CreatePlanningData,
	adminToken: string,
	participantToken: string
): Promise<PlanningMaster> {
	const batch = pb.createBatch();

	batch.collection('planning_masters').update(masterId, {
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
		lastModifiedBy: userStore.globalProfile?.id
	});

	const existingOccurrences = await pb
		.collection('planning_occurrences')
		.getFullList<PlanningOccurrence>({
			filter: `master = "${masterId}"`,
			query: { _token: adminToken }
		});

	const normalizeDate = (d: string) => d.split(' ')[0].split('T')[0];

	// Séparer les dates passées et futures : ne gérer que les futures dans le batch
	const today = format(new Date(), 'yyyy-MM-dd');

	// Filtrer les occurrences existantes : garder seulement les futures pour le batch
	const futureOccurrences = existingOccurrences.filter((occ) => normalizeDate(occ.date) >= today);

	// Filtrer les dates cibles pour ne garder que les dates futures
	const allTargetDates =
		data.recurrence.recurrenceDates || generateRecurrenceDates(data.recurrence);
	const targetDates = allTargetDates.filter((date) => date >= today);

	const existingFutureDatesMap = new Map(futureOccurrences.map((o) => [normalizeDate(o.date), o]));

	// Supprimer uniquement les occurrences futures qui ne sont plus dans les dates cibles
	for (const occ of futureOccurrences) {
		if (!targetDates.includes(normalizeDate(occ.date))) {
			batch.collection('planning_occurrences').delete(occ.id);
		}
	}

	// Créer ou mettre à jour uniquement les occurrences futures
	for (const date of targetDates) {
		const existing = existingFutureDatesMap.get(date);
		if (existing) {
			const updateData: any = {
				startTime: data.defaultStartTime,
				endTime: data.defaultEndTime,
				adminToken,
				participantToken,
				lastModifiedBy: userStore.globalProfile?.id
			};
			if (data.forceTaskRefresh) updateData.tasks = sortTasks(data.tasks);
			batch.collection('planning_occurrences').update(existing.id, updateData);
		} else {
			batch.collection('planning_occurrences').create({
				master: masterId,
				date,
				startTime: data.defaultStartTime,
				endTime: data.defaultEndTime,
				responses: [],
				comments: [],
				isConfirmed: false,
				isCanceled: false,
				adminToken,
				participantToken,
				lastModifiedBy: userStore.globalProfile?.id
			});
		}
	}

	await batch.send();
	return await pb.collection('planning_masters').getOne<PlanningMaster>(masterId, {
		query: { _token: adminToken }
	});
}

export async function deletePlanning(masterId: string, token: string): Promise<void> {
	await pb.collection('planning_masters').delete(masterId, { query: { _token: token } });
}

// ============================================
// Utilitaires de mise à jour atomique (Optimistic Locking)
// ============================================

/**

 * Exécute une mise à jour atomique avec retry transparent en cas de conflit.

 * Pattern: Try Update(local version) -> If 409 -> Fetch -> Modify -> Update

 */

async function runAtomicUpdate<T extends { id: string; updated: string }>(
	collection: string,

	recordId: string,

	token: string,

	transform: (current: T) => Partial<T>,

	initialData?: T,

	maxRetries = 3
): Promise<T> {
	let lastError: any;

	let current = initialData;

	for (let i = 0; i < maxRetries; i++) {
		try {
			// 1. Fetch de la version actuelle uniquement si on ne l'a pas déjà

			if (!current) {
				current = await pb.collection(collection).getOne<T>(recordId, {
					query: { _token: token }
				});
			}

			// 2. Application de la transformation

			const updates = transform(current);

			// 3. Tentative de mise à jour avec vérification de version

			return await pb.collection(collection).update<T>(recordId, updates, {
				query: {
					_token: token,

					_version: current.updated // Envoi de la version connue
				}
			});
		} catch (error: any) {
			lastError = error;

			// Si erreur 409 (Conflict), on vide le cache local et on continue la boucle pour re-fetcher

			if (error.status === 409) {
				console.warn(
					`Atomic update conflict for ${recordId}, retrying (${i + 1}/${maxRetries})...`
				);

				current = undefined;

				continue;
			}

			// Pour les autres erreurs, on propage immédiatement

			throw error;
		}
	}

	throw lastError;
}

// ============================================
// Participants
// ============================================

export async function addParticipant(
	masterId: string,
	participant: Omit<Participant, 'id' | 'createdAt'> & { id?: string },
	token: string
): Promise<PlanningMaster> {
	return runAtomicUpdate<PlanningMaster>('planning_masters', masterId, token, (current) => {
		const newParticipant: Participant = {
			...participant,
			id: participant.id || generateParticipantId(),
			createdAt: new Date().toISOString()
		};
		return {
			participants: [...(current.participants || []), newParticipant],
			lastModifiedBy: userStore.globalProfile?.id
		};
	});
}

export async function updateParticipant(
	masterId: string,
	participantId: string,
	updates: Partial<Participant>,
	token: string,
	currentMaster?: PlanningMaster
): Promise<PlanningMaster> {
	return runAtomicUpdate<PlanningMaster>(
		'planning_masters',
		masterId,
		token,
		(current) => {
			const updatedParticipants = (current.participants || []).map((p) =>
				p.id === participantId ? { ...p, ...updates } : p
			);
			return {
				participants: updatedParticipants,
				lastModifiedBy: userStore.globalProfile?.id
			};
		},
		currentMaster
	);
}

export async function removeParticipant(
	masterId: string,
	participantId: string,
	token: string,
	currentMaster?: PlanningMaster
): Promise<PlanningMaster> {
	return runAtomicUpdate<PlanningMaster>(
		'planning_masters',
		masterId,
		token,
		(current) => {
			const updatedParticipants = (current.participants || []).filter(
				(p) => p.id !== participantId
			);
			return {
				participants: updatedParticipants,
				lastModifiedBy: userStore.globalProfile?.id
			};
		},
		currentMaster
	);
}

// ============================================
// Occurrences
// ============================================

export async function createOccurrence(
	data: any,
	adminToken: string,
	participantToken: string
): Promise<PlanningOccurrence> {
	return await pb.collection('planning_occurrences').create<PlanningOccurrence>({
		...data,
		master: data.masterId,
		tasks: sortTasks(data.tasks),
		responses: [],
		comments: [],
		isConfirmed: false,
		isCanceled: false,
		adminToken,
		participantToken,
		lastModifiedBy: userStore.globalProfile?.id
	});
}

export async function getOccurrencesByMaster(
	masterId: string,
	token: string,
	options?: { limit?: number; offset?: number; dateFilter?: 'future' | 'past' | 'all' }
): Promise<PlanningOccurrence[]> {
	let filter = `master = "${masterId}"`;
	if (options?.dateFilter && options.dateFilter !== 'all') {
		const yesterday = new Date();
		yesterday.setDate(yesterday.getDate() - 1);
		yesterday.setHours(0, 0, 0, 0);
		const dateStr = yesterday.toISOString().split('T')[0];
		filter +=
			options.dateFilter === 'future' ? ` && date >= "${dateStr}"` : ` && date < "${dateStr}"`;
	}

	return await pb.collection('planning_occurrences').getFullList<PlanningOccurrence>({
		filter,
		sort: options?.dateFilter === 'past' ? '-date' : 'date',
		...options,
		query: { _token: token }
	});
}

export async function updateOccurrence(
	occurrenceId: string,
	updates: Partial<PlanningOccurrence>,
	token: string,
	currentOccurrence?: PlanningOccurrence
): Promise<PlanningOccurrence> {
	return runAtomicUpdate<PlanningOccurrence>(
		'planning_occurrences',
		occurrenceId,
		token,
		(current) => {
			const updateData = { ...updates, lastModifiedBy: userStore.globalProfile?.id };
			if (updateData.tasks !== undefined) updateData.tasks = sortTasks(updateData.tasks);
			return updateData;
		},
		currentOccurrence
	);
}

export async function deleteOccurrence(occurrenceId: string, token: string): Promise<void> {
	await pb.collection('planning_occurrences').delete(occurrenceId, { query: { _token: token } });
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
	return runAtomicUpdate<PlanningOccurrence>(
		'planning_occurrences',
		occurrenceId,
		token,
		(current) => {
			const existingIdx = (current.responses || []).findIndex(
				(r) => r.participantId === participantId
			);

			let updatedResponses: ParticipantResponse[];
			if (existingIdx >= 0) {
				updatedResponses = [...current.responses];
				updatedResponses[existingIdx] = { ...response, participantId };
			} else {
				updatedResponses = [...(current.responses || []), { ...response, participantId }];
			}

			return {
				responses: updatedResponses,
				lastModifiedBy: userStore.globalProfile?.id
			};
		},
		currentOccurrence
	);
}

export const submitResponseSafe = submitResponse;

export async function removeResponse(
	occurrenceId: string,
	participantId: string,
	token: string,
	currentOccurrence?: PlanningOccurrence
): Promise<PlanningOccurrence> {
	return runAtomicUpdate<PlanningOccurrence>(
		'planning_occurrences',
		occurrenceId,
		token,
		(current) => {
			return {
				responses: (current.responses || []).filter((r) => r.participantId !== participantId),
				lastModifiedBy: userStore.globalProfile?.id
			};
		},
		currentOccurrence
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
	return runAtomicUpdate<PlanningOccurrence>(
		'planning_occurrences',
		occurrenceId,
		token,
		(current) => {
			const newComment = {
				id: generateParticipantId(),
				participantId,
				content,
				createdAt: new Date().toISOString()
			};
			return {
				comments: [...(current.comments || []), newComment],
				lastModifiedBy: userStore.globalProfile?.id
			};
		},
		currentOccurrence
	);
}

export async function deleteComment(
	occurrenceId: string,
	commentId: string,
	token: string,
	currentOccurrence?: PlanningOccurrence
): Promise<PlanningOccurrence> {
	return runAtomicUpdate<PlanningOccurrence>(
		'planning_occurrences',
		occurrenceId,
		token,
		(current) => {
			return {
				comments: (current.comments || []).filter((c) => c.id !== commentId),
				lastModifiedBy: userStore.globalProfile?.id
			};
		},
		currentOccurrence
	);
}
