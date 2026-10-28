import * as m from "$lib/paraglide/messages.js";
import type { ParticipantResponse, ResponseType, Task } from "$lib/types/planning.types";

/**
 * Acteur portant le changement de réponse : le participant lui-même (`self`)
 * ou l'admin pour son compte (`admin`). Ne change que le sujet des messages
 * et la provenance des données — la règle métier est identique.
 */
export type ResponseActor = "self" | "admin";

/** Changement de réponse finalisé, prêt à persister. */
export interface ResponseChange {
	participantId: string;
	response: ResponseType;
	tasks: string[];
}

/** Changement de réponse en attente de confirmation (garde onEvent déclenchée). */
export interface PendingResponseChange {
	participantId: string;
	participantName: string;
	targetResponse: ResponseType;
	onEventTaskIds: string[];
}

/** Ids des tâches `onEvent` parmi les tâches où le participant est inscrit. */
export function onEventInscribedIds(tasks: Task[], inscribedTaskIds: string[]): string[] {
	const inscribed = new Set(inscribedTaskIds);
	return tasks
		.filter((task) => task.type === "onEvent" && inscribed.has(task.id))
		.map((task) => task.id);
}

/**
 * Construction unique d'une `ParticipantResponse`. Le champ legacy `comment`
 * n'est pas repris : jamais lu, les messages vivent dans `occurrence.comments`.
 */
export function buildParticipantResponse(input: {
	participantId: string;
	response: ResponseType;
	tasks: string[];
}): ParticipantResponse {
	return {
		participantId: input.participantId,
		response: input.response,
		tasks: input.tasks,
		respondedAt: new Date().toISOString(),
	};
}

export type TaskToggleOutcome = { kind: "none" } | { kind: "autoPresent" } | { kind: "refuse" };

/**
 * Matrice « tâche onEvent ⟹ présent » — identique self et admin. L'ajout
 * d'une tâche pendant sans réponse existante pose `present` ; avec une
 * réponse ≠ present, c'est un refus (on ne domine pas une réponse
 * explicite). Le retrait ne touche jamais la réponse.
 */
export function resolveTaskToggleOutcome(input: {
	task: Task;
	currentResponse: ResponseType | undefined;
	allowResponses: boolean;
	isAdding: boolean;
}): TaskToggleOutcome {
	if (!input.isAdding || input.task.type !== "onEvent" || !input.allowResponses) {
		return { kind: "none" };
	}
	if (!input.currentResponse) return { kind: "autoPresent" };
	return input.currentResponse === "present" ? { kind: "none" } : { kind: "refuse" };
}

/**
 * Message de confirmation : « vous » côté self, le nom du participant côté
 * admin. Deux paires de clés volontairement distinctes (2ᵉ/3ᵉ personne) —
 * l'ADR-0016 interdit d'injecter le sujet dans une phrase. `taskNames` doit
 * être non vide (la factory ne dérive un message qu'à partir de noms résolus).
 */
export function deriveConfirmationMessage(
	actor: ResponseActor,
	taskNames: string[],
	participantName?: string,
): string {
	const isPlural = taskNames.length > 1;
	if (actor === "admin") {
		const name = participantName ?? "";
		return isPlural
			? m.occurrence_change_task_subscribed_multi({
					name,
					count: taskNames.length,
					tasks: taskNames.join(", "),
				})
			: m.occurrence_change_task_subscribed_single({ name, task: taskNames[0] });
	}
	return isPlural
		? m.occurrence_response_change_subscribed_multi({
				count: taskNames.length,
				tasks: taskNames.join(", "),
			})
		: m.occurrence_response_change_subscribed_single({ task: taskNames[0] });
}

interface WorkflowOptions {
	actor: ResponseActor;
	/** Catalogue de tâches effectif (inherited.tasks côté self, tâches éditées côté admin). */
	tasks: () => Task[];
	/** Source des inscriptions : copie de travail (self) ou réponse stockée (admin). */
	getInscribedTaskIds: (participantId: string) => string[];
	/** Requis si actor = "admin" : nom affiché dans le message de confirmation. */
	getDisplayName?: (participantId: string) => string;
	/** Persiste le changement ; gère ses propres erreurs (toast/logs côté surface). */
	submitChange: (change: ResponseChange) => Promise<void>;
}

export interface OccurrenceResponseWorkflow {
	readonly pendingResponseChange: PendingResponseChange | null;
	/** Garde : viser ≠ present alors qu'on est inscrit·e onEvent → pending, sinon soumission directe. */
	requestResponseChange(participantId: string, targetResponse: ResponseType): void;
	confirmResponseChange(): void;
	cancelResponseChange(): void;
	/** Message de la modal de confirmation, dérivé du pending selon l'acteur. */
	readonly confirmationMessage: string | null;
}

/**
 * Orchestration partagée du changement de réponse : garde onEvent → pending →
 * confirmation → soumission. Ne connaît ni réseau ni notification : la
 * persistance et le signalement des erreurs restent chez la surface via
 * `submitChange` — c'est ce qui permet de la tester sans DOM.
 */
export function createOccurrenceResponseWorkflow(
	getOptions: () => WorkflowOptions,
): OccurrenceResponseWorkflow {
	const options = $derived(getOptions());

	let pendingResponseChange = $state<PendingResponseChange | null>(null);

	function requestResponseChange(participantId: string, targetResponse: ResponseType) {
		const inscribedTaskIds = options.getInscribedTaskIds(participantId);
		// Viser `present` n'a jamais à désinscrire : pas de garde.
		const onEventTaskIds =
			targetResponse === "present" ? [] : onEventInscribedIds(options.tasks(), inscribedTaskIds);
		if (onEventTaskIds.length > 0) {
			pendingResponseChange = {
				participantId,
				participantName: options.getDisplayName?.(participantId) ?? "",
				targetResponse,
				onEventTaskIds,
			};
			return;
		}
		void options.submitChange({ participantId, response: targetResponse, tasks: inscribedTaskIds });
	}

	function confirmResponseChange() {
		const pending = pendingResponseChange;
		if (!pending) return;
		pendingResponseChange = null;
		const keptTasks = options
			.getInscribedTaskIds(pending.participantId)
			.filter((id) => !pending.onEventTaskIds.includes(id));
		void options.submitChange({
			participantId: pending.participantId,
			response: pending.targetResponse,
			tasks: keptTasks,
		});
	}

	function cancelResponseChange() {
		pendingResponseChange = null;
	}

	const confirmationMessage = $derived.by(() => {
		const pending = pendingResponseChange;
		if (!pending) return null;
		const taskNames = pending.onEventTaskIds
			.map((id) => options.tasks().find((task) => task.id === id)?.name)
			.filter((name): name is string => Boolean(name));
		if (taskNames.length === 0) return null;
		return deriveConfirmationMessage(options.actor, taskNames, pending.participantName);
	});

	return {
		get pendingResponseChange() {
			return pendingResponseChange;
		},
		requestResponseChange,
		confirmResponseChange,
		cancelResponseChange,
		get confirmationMessage() {
			return confirmationMessage;
		},
	};
}
