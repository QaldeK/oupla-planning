import { format } from "date-fns";
import { ClientResponseError } from "pocketbase";
import { mastersCollection, occurrencesCollection } from "$lib/data/collections";
import {
	executeMultiCollectionBatch,
	type MultiCollectionBatchOperation,
} from "$lib/pb-sync/batch";
import { db, ensureDbReady } from "$lib/pb-sync/db";
import { pb } from "$lib/pocketbase/pb";
import { getActivePlanningToken } from "$lib/services/activePlanningContext";
import { commentStateService } from "$lib/services/commentStateService";
import { diffPlanningOccurrences, normalizeOccurrenceDate } from "$lib/services/occurrenceDiff";
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
	TimeSlot,
} from "$lib/types/planning.types";
import { sortTasks } from "$lib/utils/tasks";
import {
	generateAdminToken,
	generateParticipantId,
	generateParticipantToken,
} from "$lib/utils/tokens";

// ============================================
// Normalisations internes
// ============================================

function normalizeResponseTypes(types?: ResponseType[]): ResponseType[] {
	if (!types || types.length === 0) return [];
	const order: Record<ResponseType, number> = { present: 1, if_needed: 2, maybe: 3, absent: 4 };
	return types.sort((a, b) => order[a] - order[b]);
}

/**
 * Pose l'invariant d'audit sur toute écriture : `lastModifiedBy` est ici, et
 * nulle part ailleurs côté client (les hooks serveur le forgent depuis le
 * contexte d'auth pour les utilisateurs authentifiés — F5).
 */
function withAudit<T extends object>(data: T): T & { lastModifiedBy: string | undefined } {
	return { ...data, lastModifiedBy: pb.authStore.record?.id };
}

// ============================================
// Token des écritures
// ============================================

/**
 * Token que les écritures du planning actif doivent porter.
 *
 * Le token de la page atteste la navigation, pas la capacité d'écriture : le
 * rôle de l'acteur se lit dans le cache local. Un appareil qui détient
 * l'`adminToken` d'un planning le garde en Dexie (`onRecordEnrich` le masque
 * côté API, `upsertRecord` préserve la valeur locale) et affiche donc les
 * affordances admin même derrière un lien participant (`/p/…`). Écrire avec le
 * token de la page ferait refuser par le hook les champs admin-only d'une
 * occurrence (403 « Participants can only update responses, comments, and
 * tasks. »). Les écritures suivent donc la règle des lectures
 * (`planningStore.refreshActive`) : l'`adminToken` du planning visité dès que
 * l'appareil le détient, à défaut le token de la page.
 */
async function resolveWriteToken(): Promise<string> {
	const pageToken = getActivePlanningToken();
	await ensureDbReady();
	const master =
		(await db.masters.where("participantToken").equals(pageToken).first()) ??
		(await db.masters.where("adminToken").equals(pageToken).first());
	return master?.adminToken || pageToken;
}

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
	 * Si absent, aucune occurrence n'est créée/mise à jour.
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

// ============================================
// Planning Master
// ============================================

/**
 * Crée un planning master et ses occurrences de manière atomique (batch).
 *
 * Exception au planning actif : créer un planning, c'est choisir ses tokens —
 * l'appelant les fournit (générés) ou les laisse générer.
 */
export async function createPlanningWithOccurrences(
	data: CreatePlanningData,
	adminToken?: string,
	participantToken?: string,
): Promise<PlanningMaster> {
	const finalAdminToken = adminToken || generateAdminToken();
	const finalParticipantToken = participantToken || generateParticipantToken();

	// 1. Créer le planning master via pb-sync (PB create + Dexie put)
	const master = await mastersCollection.create(
		withAudit({
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
		}),
	);

	// 2. Créer les occurrences depuis les cibles voulues (contrat formulaire↔service).
	// Pas de fallback : si occurrenceTargets est absent, aucune occurrence n'est créée.
	const targets: OccurrenceTarget[] = data.occurrenceTargets ?? [];
	if (targets.length > 0) {
		// createRule de planning_occurrences exige master.adminToken = _token (ADR-0012).
		const batch = occurrencesCollection.createBatch({ query: { _token: finalAdminToken } });
		for (const target of targets) {
			batch.create(
				withAudit({
					master: master.id,
					date: target.date,
					startTime: target.startTime,
					endTime: target.endTime,
					slotId: target.slotId,
					responses: [],
					comments: [],
					isConfirmed: false,
					isCanceled: false,
				}),
			);
		}
		await batch.send();
	}

	return master;
}

/**
 * Met à jour un planning master et ses occurrences de manière atomique
 * (batch multi-collections pb-sync, ADR-0018) : PocketBase applique l'ensemble
 * en une transaction, puis Dexie est reconcilié depuis les réponses confirmées
 * — le retour se lit en local et la convergence ne dépend ni du SSE ni d'une
 * re-sync.
 * @param expectedVersion - Optionnel, timestamp `updated` du master pour optimistic locking
 */
export async function updatePlanningWithOccurrences(
	masterId: string,
	data: CreatePlanningData,
	expectedVersion?: string,
): Promise<PlanningMaster> {
	const token = await resolveWriteToken();
	const today = format(new Date(), "yyyy-MM-dd");

	// Charger les occurrences futures, **soft-deleted incluses**. La réactivation d'une
	// DateSlot désactivée = un-soft-delete d'une occurrence existante (préserve responses/comments/id).
	const existingOccurrences = await pb
		.collection("planning_occurrences")
		.getFullList<PlanningOccurrence>({
			filter: `master = "${masterId}" && date >= "${today}"`,
			query: { _token: token },
		});

	// Cibles = occurrences voulues par l'admin, futures uniquement. Le diff exige
	// des deux côtés des entrées déjà filtrées sur la fenêtre de date.
	const allTargets: OccurrenceTarget[] = data.occurrenceTargets ?? [];
	const targets = allTargets.filter((t) => normalizeOccurrenceDate(t.date) >= today);
	const ops = diffPlanningOccurrences(targets, existingOccurrences);

	// Master update avec vérification de version (optimistic locking)
	const masterQuery: Record<string, string> = { _token: token };
	if (expectedVersion) {
		masterQuery._version = expectedVersion;
	}

	const batchOps: MultiCollectionBatchOperation[] = [
		{
			type: "update",
			table: mastersCollection.getTable(),
			collection: "planning_masters",
			id: masterId,
			data: withAudit({
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
			}),
			params: { query: masterQuery },
		},
	];

	// Matchées : update avec les horaires voulus (override porté par la cible, apply
	// tel quel). `deleted: false` couvre le un-soft-delete (réactivation d'une DateSlot).
	// responses/comments/isConfirmed/isCanceled sont préservés sur l'existante.
	for (const { existing, target } of ops.updates) {
		const updateData = withAudit(
			data.forceTaskRefresh
				? {
						date: normalizeOccurrenceDate(target.date),
						startTime: target.startTime,
						endTime: target.endTime,
						slotId: target.slotId,
						deleted: false,
						tasks: sortTasks(data.tasks),
					}
				: {
						date: normalizeOccurrenceDate(target.date),
						startTime: target.startTime,
						endTime: target.endTime,
						slotId: target.slotId,
						deleted: false,
					},
		);
		batchOps.push({
			type: "update",
			table: occurrencesCollection.getTable(),
			collection: "planning_occurrences",
			id: existing.id,
			data: updateData,
			params: { query: { _token: token } },
		});
	}

	for (const target of ops.creates) {
		batchOps.push({
			type: "create",
			table: occurrencesCollection.getTable(),
			collection: "planning_occurrences",
			data: withAudit({
				master: masterId,
				date: normalizeOccurrenceDate(target.date),
				startTime: target.startTime,
				endTime: target.endTime,
				slotId: target.slotId,
				responses: [],
				comments: [],
				isConfirmed: false,
				isCanceled: false,
			}),
			params: { query: { _token: token } },
		});
	}

	// Soft-delete les existantes actives non ciblées. Les soft-deleted non ciblées
	// restent telles quelles (déjà désactivées).
	for (const occ of ops.softDeletes) {
		batchOps.push({
			type: "update",
			table: occurrencesCollection.getTable(),
			collection: "planning_occurrences",
			id: occ.id,
			data: withAudit({ deleted: true }),
			params: { query: { _token: token } },
		});
	}

	try {
		await executeMultiCollectionBatch(pb, batchOps);
	} catch (e: unknown) {
		console.error(
			"Batch error detail:",
			JSON.stringify(e instanceof ClientResponseError ? e.data : e, null, 2),
		);
		if (e instanceof ClientResponseError) console.error("Batch error response:", e.response);
		throw e;
	}

	// Le reconcile du batch a écrit le master confirmé en Dexie : le retour se
	// lit localement, sans refetch réseau.
	const master = await mastersCollection.getTable().get(masterId);
	if (!master) throw new Error(`Master ${masterId} introuvable en Dexie après update`);
	return master;
}

/**
 * Soft-delete d'un planning (début de la fenêtre de grâce de 15 jours).
 * Transition admin-only : le hook serveur forge `deletedAt` et notifie les
 * participants authentifiés par email (best-effort). Passe par l'update SDK
 * avec `_version` (OCC) — jamais par un hard-delete.
 * @param expectedVersion - timestamp `updated` du master pour optimistic locking
 */
export async function deletePlanning(masterId: string, expectedVersion: string): Promise<void> {
	await mastersCollection.update(
		masterId,
		withAudit({ deleted: true }) as Partial<PlanningMaster>,
		{
			query: { _token: await resolveWriteToken(), _version: expectedVersion },
		},
	);
}

/**
 * Restaure un planning soft-deleté (fin anticipée de la fenêtre de grâce).
 * Transition admin-only : le hook serveur vide `deletedAt` et notifie les
 * participants authentifiés par email (best-effort). Passe par l'update SDK
 * avec `_version` (OCC) — jamais par un hard-delete.
 *
 * Le lien visité peut être le participantToken (sidebar, redirection
 * post-suppression) : `resolveWriteToken()` retient l'adminToken du master dès
 * que l'appareil le détient, ce dont dépend l'autorisation serveur.
 * @param expectedVersion - timestamp `updated` du master pour optimistic locking
 */
export async function restorePlanning(masterId: string, expectedVersion: string): Promise<void> {
	await mastersCollection.update(
		masterId,
		withAudit({ deleted: false }) as Partial<PlanningMaster>,
		{
			query: { _token: await resolveWriteToken(), _version: expectedVersion },
		},
	);
}

// ============================================
// Participants
// ============================================

export async function addParticipant(
	masterId: string,
	participant: Omit<Participant, "id" | "createdAt"> & { id?: string },
): Promise<PlanningMaster> {
	const newParticipant: Participant = {
		...participant,
		id: participant.id || generateParticipantId(),
		createdAt: new Date().toISOString(),
	};

	// Lire le master depuis Dexie pour calculer la nouvelle liste
	const current = await mastersCollection.getTable().get(masterId);
	if (!current) throw new Error(`Master ${masterId} not found in local DB`);

	return await mastersCollection.update(
		masterId,
		withAudit({
			participants: [
				...(current.participants || []).filter((p) => p.id !== newParticipant.id),
				newParticipant,
			],
		}),
		{ query: { _token: await resolveWriteToken() } },
	);
}

export async function updateParticipant(
	masterId: string,
	participantId: string,
	updates: Partial<Participant>,
): Promise<PlanningMaster> {
	const current = await mastersCollection.getTable().get(masterId);
	if (!current) throw new Error(`Master ${masterId} not found in local DB`);

	const updatedParticipants = (current.participants || []).map((p) =>
		p.id === participantId ? { ...p, ...updates } : p,
	);

	return await mastersCollection.update(
		masterId,
		withAudit({ participants: updatedParticipants }),
		{ query: { _token: await resolveWriteToken() } },
	);
}

export async function quitPlanning(
	masterId: string,
	participantId: string,
): Promise<PlanningMaster> {
	const current = await mastersCollection.getTable().get(masterId);
	if (!current) throw new Error(`Master ${masterId} not found in local DB`);

	const updatedParticipants = (current.participants || []).map((p) =>
		p.id === participantId ? { ...p, hasQuit: true } : p,
	);

	return await mastersCollection.update(
		masterId,
		withAudit({ participants: updatedParticipants }),
		{ query: { _token: await resolveWriteToken() } },
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
	 * ID du participant auth final = l'identité guest revendiquée (son id ne
	 * change jamais — c'est la clé des réponses/commentaires). Si l'auth avait
	 * déjà son propre participant, c'est lui qui est supprimé après migration.
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
): Promise<ClaimIdentityResult> {
	return await pb.send("/api/claim-participant-identity", {
		method: "POST",
		body: { masterId, guestParticipantId },
		query: { _token: await resolveWriteToken() },
	});
}

// ============================================
// Occurrences
// ============================================

export async function updateOccurrence(
	occurrenceId: string,
	updates: Partial<PlanningOccurrence>,
): Promise<PlanningOccurrence> {
	const updateData = withAudit(updates);
	if (updateData.tasks !== undefined) updateData.tasks = sortTasks(updateData.tasks);
	return await occurrencesCollection.update(occurrenceId, updateData, {
		query: { _token: await resolveWriteToken() },
	});
}

// ============================================
// Réponses
// ============================================

export async function submitResponse(
	occurrenceId: string,
	participantId: string,
	response: ParticipantResponse,
): Promise<PlanningOccurrence> {
	const current = await occurrencesCollection.getTable().get(occurrenceId);
	if (!current) throw new Error(`Occurrence ${occurrenceId} not found in local DB`);

	const existingIdx = (current.responses || []).findIndex((r) => r.participantId === participantId);

	let updatedResponses: ParticipantResponse[];
	if (existingIdx >= 0) {
		updatedResponses = [...current.responses];
		updatedResponses[existingIdx] = { ...response, participantId };
	} else {
		updatedResponses = [...(current.responses || []), { ...response, participantId }];
	}

	return await occurrencesCollection.update(
		occurrenceId,
		withAudit({ responses: updatedResponses }),
		{ query: { _token: await resolveWriteToken() } },
	);
}

// ============================================
// Commentaires
// ============================================

export async function addComment(
	occurrenceId: string,
	participantId: string,
	content: string,
): Promise<PlanningOccurrence> {
	const current = await occurrencesCollection.getTable().get(occurrenceId);
	if (!current) throw new Error(`Occurrence ${occurrenceId} not found in local DB`);

	const newComment: OccurrenceComment = {
		id: generateParticipantId(),
		participantId,
		content,
		createdAt: new Date().toISOString(),
	};

	const confirmed = await occurrencesCollection.update(
		occurrenceId,
		withAudit({ comments: [...(current.comments || []), newComment] }),
		{ query: { _token: await resolveWriteToken() } },
	);

	commentStateService.markConversationAsRead(occurrenceId, current.master, true);
	return confirmed;
}

export async function deleteComment(
	occurrenceId: string,
	commentId: string,
): Promise<PlanningOccurrence> {
	const current = await occurrencesCollection.getTable().get(occurrenceId);
	if (!current) throw new Error(`Occurrence ${occurrenceId} not found in local DB`);

	return await occurrencesCollection.update(
		occurrenceId,
		withAudit({ comments: (current.comments || []).filter((c) => c.id !== commentId) }),
		{ query: { _token: await resolveWriteToken() } },
	);
}
