import { toast } from 'svelte-sonner';
import { submitResponse } from '$lib/services/planningActions';
import { classifyError } from '$lib/utils/errorHandler';
import { networkStore } from '$lib/stores/networkStore.svelte';
import type {
	PlanningOccurrence,
	PlanningMaster,
	ParticipantResponse,
	ResponseType,
	Task
} from '$lib/types/planning.types';

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
	pendingResponseChange: {
		targetResponse: ResponseType;
		onEventTaskIds: string[];
	} | null;
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
	let pendingResponseChange = $state<{
		targetResponse: ResponseType;
		onEventTaskIds: string[];
	} | null>(null);

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
		present: activeResponses.filter((r) => r.response === 'present').length,
		ifNeeded: activeResponses.filter((r) => r.response === 'if_needed').length,
		maybe: activeResponses.filter((r) => r.response === 'maybe').length,
		absent: activeResponses.filter((r) => r.response === 'absent').length,
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
			'present',
			'if_needed',
			'maybe',
			'absent'
		]
	}));

	const isNetworkUnavailable = $derived(!networkStore.isNetworkOk);

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
		pendingResponseChange = null;
	});

	async function handleSubmitResponse() {
		if (!options.currentUserId || isSubmitting) return;

		// Vérifier que le participant a un nom valide
		const participant = options.master.participants.find((p) => p.id === options.currentUserId);

		if (!participant || !participant.name) {
			// Remplace le toast d'erreur par une ouverture de modal pilotée par le parent
			if (options.onNeedReidentify) {
				options.onNeedReidentify();
			} else {
				toast.error('Nom de participant invalide. Identifiez-vous à nouveau.');
			}
			return;
		}

		const token = options.master.participantToken;
		if (!token) return;

		const response: ParticipantResponse = {
			participantId: options.currentUserId,
			response: selectedResponse || 'present',
			tasks: selectedTasks,
			respondedAt: new Date().toISOString()
		};

		isSubmitting = true;
		try {
			await submitResponse(
				options.occurrence.id,
				options.currentUserId,
				response,
				token,
				options.occurrence
			);
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
				toast.error('Vous devez être identifié pour répondre');
			}
			return;
		}

		// Les tâches onEvent exigent la présence. Un changement vers une autre
		// réponse doit être confirmé car il désinscrira ces tâches. Seules les
		// onEvent sont concernées (beforeEvent/afterEvent ne sont jamais liées
		// à la présence et ne sont jamais retirées ici).
		if (response !== 'present') {
			const onEventInscribed = inherited.tasks
				.filter((t) => t.type === 'onEvent' && selectedTasks.includes(t.id))
				.map((t) => t.id);
			if (onEventInscribed.length > 0) {
				pendingResponseChange = {
					targetResponse: response,
					onEventTaskIds: onEventInscribed
				};
				return;
			}
		}

		selectedResponse = response;
		handleSubmitResponse();
	}

	function confirmResponseChange() {
		const pending = pendingResponseChange;
		if (!pending) return;
		selectedTasks = selectedTasks.filter((id) => !pending.onEventTaskIds.includes(id));
		selectedResponse = pending.targetResponse;
		pendingResponseChange = null;
		handleSubmitResponse();
	}

	function cancelResponseChange() {
		pendingResponseChange = null;
	}

	function toggleTask(taskId: string) {
		if (!options.currentUserId) {
			if (options.onNeedReidentify) {
				options.onNeedReidentify();
			} else {
				toast.error('Vous devez être identifié pour vous inscrire à une tâche');
			}
			return;
		}

		const task = inherited.tasks.find((t) => t.id === taskId);
		if (!task) return;

		// Pour les tâches "pendant" (onEvent), l'utilisateur doit être présent
		// Auto-inscription "présent" uniquement pour ces tâches
		if (task.type === 'onEvent' && masterConfig.allowResponses) {
			if (selectedResponse && selectedResponse !== 'present') {
				toast.error('Vous devez être présent pour vous inscrire à une tâche');
				return;
			}
			if (!selectedResponse) selectedResponse = 'present';
		}
		// Pour les tâches "avant" (beforeEvent) et "après" (afterEvent):
		// Pas d'auto-inscription - l'utilisateur peut s'inscrire quel que soit son response

		if (selectedTasks.includes(taskId)) {
			selectedTasks = selectedTasks.filter((id) => id !== taskId);
		} else {
			selectedTasks = [...selectedTasks, taskId];
		}
		handleSubmitResponse();
	}

	function getParticipantName(source: ParticipantResponse | string): string {
		const id = typeof source === 'string' ? source : source.participantId;
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
			return pendingResponseChange;
		},
		setResponse,
		confirmResponseChange,
		cancelResponseChange,
		toggleTask,
		getParticipantName
	};
}
