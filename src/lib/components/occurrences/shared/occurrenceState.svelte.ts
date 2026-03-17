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
	setResponse: (response: ResponseType) => void;
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

	const stats = $derived({
		present: options.occurrence.responses.filter((r) => r.response === 'present').length,
		ifNeeded: options.occurrence.responses.filter((r) => r.response === 'if_needed').length,
		maybe: options.occurrence.responses.filter((r) => r.response === 'maybe').length,
		absent: options.occurrence.responses.filter((r) => r.response === 'absent').length,
		noResponse: options.master.participants.length - options.occurrence.responses.length
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

	const isNetworkUnavailable = $derived(
		!networkStore.online || !networkStore.pocketbaseReachable || !networkStore.realtimeConnected
	);

	$effect(() => {
		if (currentResponse) {
			selectedResponse = currentResponse.response;
			selectedTasks = [...(currentResponse.tasks || [])];
		} else {
			selectedResponse = undefined;
			selectedTasks = [];
		}
	});

	async function handleSubmitResponse() {
		if (!options.currentUserId || isSubmitting) return;

		// Vérifier que le participant a un nom valide
		const participant = options.master.participants.find((p) => p.id === options.currentUserId);

		if (!participant || !participant.name) {
			toast.error('Nom de participant invalide. Identifiez-vous à nouveau.');
			return;
		}

		const token = options.master.participantToken || options.master.adminToken;
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
			toast.error('Vous devez être identifié pour répondre');
			// TODO: Open IdentifyModal - will be handled in OccurrenceView
			return;
		}

		selectedResponse = response;
		if (response === 'absent') selectedTasks = [];
		handleSubmitResponse();
	}

	function toggleTask(taskId: string) {
		if (!options.currentUserId) {
			toast.error('Vous devez être identifié pour vous inscrire à une tâche');
			// TODO: Open IdentifyModal - will be handled in OccurrenceView
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
		setResponse,
		toggleTask,
		getParticipantName
	};
}
