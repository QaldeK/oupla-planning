import { toast } from "svelte-sonner";
import * as m from "$lib/paraglide/messages.js";
import { submitResponse } from "$lib/services/planningMutations";
import { networkStore } from "$lib/stores/networkStore.svelte";
import type {
	ParticipantResponse,
	PlanningMaster,
	PlanningOccurrence,
	ResponseType,
	Task
} from "$lib/types/planning.types";
import { classifyError } from "$lib/utils/errorHandler";
import {
	buildParticipantResponse,
	createOccurrenceResponseWorkflow,
	type PendingResponseChange,
	resolveTaskToggleOutcome
} from "./occurrenceResponseWorkflow.svelte";

interface OccurrenceStateOptions {
	occurrence: PlanningOccurrence;
	master: PlanningMaster;
	currentUserId: string | undefined;
	/**
	 * Appelé quand l'utilisateur tente de répondre sans être identifié valide
	 * (participant introuvable ou sans nom). Remplace le toast d'erreur par
	 * une ouverture de modal pilotée par le parent.
	 */
	onNeedReidentify?: () => void;
}

interface OccurrenceState {
	selectedResponse: ResponseType | undefined;
	selectedTasks: string[];
	isSubmitting: boolean;
	isNetworkUnavailable: boolean;
	stats: { present: number; ifNeeded: number; maybe: number; absent: number; noResponse: number };
	inherited: {
		place: string | undefined;
		description: string | undefined;
		tasks: Task[];
		minPresentRequired: number | undefined;
	};
	masterConfig: {
		allowResponses: boolean;
		availableResponseTypes: ResponseType[];
	};
	currentResponse: ParticipantResponse | undefined;
	quitParticipantIds: Set<string>;
	/**
	 * Changement de réponse en attente de confirmation quand l'utilisateur est
	 * inscrit à au moins une tâche onEvent et vise une réponse ≠ present.
	 * Piloté par le composant parent via une ConfirmModal.
	 */
	pendingResponseChange: PendingResponseChange | null;
	/** Message de la modal de confirmation, dérivé du pending (sujet = self). */
	confirmationMessage: string | null;
	setResponse: (response: ResponseType) => void;
	confirmResponseChange: () => void;
	cancelResponseChange: () => void;
	toggleTask: (taskId: string) => void;
	getParticipantName: (response: ParticipantResponse | string) => string;
}

export function createOccurrenceState(getOptions: () => OccurrenceStateOptions): OccurrenceState {
	const options = $derived(getOptions());

	let selectedResponse = $state<ResponseType | undefined>(undefined);
	let selectedTasks = $state<string[]>([]);
	let isSubmitting = $state(false);

	const currentResponse = $derived(
		options.occurrence.responses.find((r) => r.participantId === options.currentUserId)
	);

	const activeParticipants = $derived(options.master.participants.filter((p) => !p.hasQuit));

	const quitParticipantIds = $derived(
		new Set(options.master.participants.filter((p) => p.hasQuit).map((p) => p.id))
	);

	const activeResponses = $derived(
		options.occurrence.responses.filter((r) => !quitParticipantIds.has(r.participantId))
	);

	const stats = $derived({
		present: activeResponses.filter((r) => r.response === "present").length,
		ifNeeded: activeResponses.filter((r) => r.response === "if_needed").length,
		maybe: activeResponses.filter((r) => r.response === "maybe").length,
		absent: activeResponses.filter((r) => r.response === "absent").length,
		noResponse: activeParticipants.length - activeResponses.length
	});

	const inherited = $derived.by(() => {
		const occTasks = options.occurrence.tasks;
		const useMasterTasks = !occTasks || occTasks.length === 0;

		return {
			place: options.occurrence.place || options.master.place,
			description: options.occurrence.description || options.master.description,
			tasks: useMasterTasks ? options.master.tasks || [] : occTasks,
			minPresentRequired: options.occurrence.minPresentRequired || options.master.minPresentRequired
		};
	});

	const masterConfig = $derived.by(() => ({
		allowResponses: options.master.allowResponses ?? true,
		availableResponseTypes: options.master.availableResponseTypes ?? [
			"present",
			"if_needed",
			"maybe",
			"absent"
		]
	}));

	const isNetworkUnavailable = $derived(!networkStore.isNetworkOk);

	// Le workflow de réponse (garde onEvent, pending, message) vit dans le module
	// partagé occurrenceResponseWorkflow — la surface self ne fournit que ses
	// données : copie de travail comme source des inscriptions, soumission qui
	// répercute le changement validé sur l'état local avant persistance.
	const workflow = createOccurrenceResponseWorkflow(() => ({
		actor: "self",
		tasks: () => inherited.tasks,
		getInscribedTaskIds: () => selectedTasks,
		submitChange: (change) => {
			selectedResponse = change.response;
			selectedTasks = [...change.tasks];
			return handleSubmitResponse();
		}
	}));

	$effect(() => {
		if (currentResponse) {
			selectedResponse = currentResponse.response;
			selectedTasks = [...(currentResponse.tasks || [])];
		} else {
			selectedResponse = undefined;
			selectedTasks = [];
		}
		// Une sync externe (autre device, admin) rend tout changement en cours
		// obsolète : on abandonne la confirmation en attente.
		workflow.cancelResponseChange();
	});

	async function handleSubmitResponse() {
		if (!options.currentUserId || isSubmitting) return;

		// Vérifier que le participant a un nom valide
		const participant = options.master.participants.find((p) => p.id === options.currentUserId);

		if (!participant?.name) {
			// Remplace le toast d'erreur par une ouverture de modal pilotée par le parent
			if (options.onNeedReidentify) {
				options.onNeedReidentify();
			} else {
				toast.error(m.occurrence_invalid_name());
			}
			return;
		}

		const response = buildParticipantResponse({
			participantId: options.currentUserId,
			response: selectedResponse || "present",
			tasks: selectedTasks
		});

		isSubmitting = true;
		try {
			await submitResponse(options.occurrence.id, options.currentUserId, response);
		} catch (error) {
			const { message } = classifyError(error);
			toast.error(message);
			console.error(error);
		} finally {
			isSubmitting = false;
		}
	}

	function setResponse(response: ResponseType) {
		if (!options.currentUserId) {
			if (options.onNeedReidentify) {
				options.onNeedReidentify();
			} else {
				toast.error(m.occurrence_must_identify());
			}
			return;
		}

		workflow.requestResponseChange(options.currentUserId, response);
	}

	function confirmResponseChange() {
		workflow.confirmResponseChange();
	}

	function cancelResponseChange() {
		workflow.cancelResponseChange();
	}

	function toggleTask(taskId: string) {
		if (!options.currentUserId) {
			if (options.onNeedReidentify) {
				options.onNeedReidentify();
			} else {
				toast.error(m.occurrence_must_identify_task());
			}
			return;
		}

		const task = inherited.tasks.find((t) => t.id === taskId);
		if (!task) return;

		// Matrice partagée « onEvent ⟹ présent » : refus si ajout en conflit avec
		// une réponse explicite, present posé d'office sans réponse existante,
		// retrait sans incidence sur la réponse.
		const isAdding = !selectedTasks.includes(taskId);
		const outcome = resolveTaskToggleOutcome({
			task,
			currentResponse: selectedResponse,
			allowResponses: masterConfig.allowResponses,
			isAdding
		});
		if (outcome.kind === "refuse") {
			toast.error(m.occurrence_must_be_present());
			return;
		}
		if (outcome.kind === "autoPresent") {
			selectedResponse = "present";
		}

		selectedTasks = isAdding
			? [...selectedTasks, taskId]
			: selectedTasks.filter((id) => id !== taskId);
		void handleSubmitResponse();
	}

	function getParticipantName(source: ParticipantResponse | string): string {
		const id = typeof source === "string" ? source : source.participantId;
		const participant = options.master.participants.find((p) => p.id === id);
		return participant?.name || id;
	}

	return {
		get selectedResponse() {
			return selectedResponse;
		},
		set selectedResponse(v) {
			selectedResponse = v;
		},
		get selectedTasks() {
			return selectedTasks;
		},
		set selectedTasks(v) {
			selectedTasks = v;
		},
		get isSubmitting() {
			return isSubmitting;
		},
		get isNetworkUnavailable() {
			return isNetworkUnavailable;
		},
		get stats() {
			return stats;
		},
		get inherited() {
			return inherited;
		},
		get masterConfig() {
			return masterConfig;
		},
		get currentResponse() {
			return currentResponse;
		},
		get quitParticipantIds() {
			return quitParticipantIds;
		},
		get pendingResponseChange() {
			return workflow.pendingResponseChange;
		},
		get confirmationMessage() {
			return workflow.confirmationMessage;
		},
		setResponse,
		confirmResponseChange,
		cancelResponseChange,
		toggleTask,
		getParticipantName
	};
}
