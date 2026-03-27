<script lang="ts">
	import type { Task, ParticipantResponse, TaskType } from '$lib/types/planning.types';
	import { Clock, CalendarArrowUp, CalendarArrowDown, UserMinus, UserPlus } from 'lucide-svelte';
	import { slide } from 'svelte/transition';
	import Modal from '$lib/components/ui/Modal.svelte';

	interface Props {
		open: boolean;
		onClose: () => void;
		task: Task;
		inscribed: ParticipantResponse[];
		currentUserId?: string;
		isInTask: boolean;
		isSubmitting: boolean;
		readOnly: boolean;
		isPastDate: boolean;
		getParticipantName: (response: ParticipantResponse) => string;
		onToggle: () => void;
	}

	let {
		open,
		onClose,
		task,
		inscribed,
		currentUserId,
		isInTask,
		isSubmitting,
		readOnly,
		isPastDate,
		getParticipantName,
		onToggle
	}: Props = $props();

	// Local state for modal binding
	let localOpen = $state(false);

	// Sync local state with prop
	$effect(() => {
		localOpen = open;
	});

	function handleClose() {
		localOpen = false;
		onClose();
	}

	const TASK_TYPE_CONFIG: Record<TaskType, { bgClass: string; label: string; icon: any }> = {
		beforeEvent: { bgClass: 'bg-accent/30', label: 'Avant', icon: CalendarArrowUp },
		onEvent: { bgClass: 'bg-accent/60', label: 'Pendant', icon: Clock },
		afterEvent: { bgClass: 'bg-accent', label: 'Après', icon: CalendarArrowDown }
	};

	const config = $derived(TASK_TYPE_CONFIG[task.type]);
	const Icon = $derived(config.icon);
	const volunteers = $derived(inscribed.length);
	const isComplete = $derived(volunteers >= task.requiredVolunteers);

	function handleSubscribe() {
		if (!readOnly && !isPastDate && !isSubmitting) {
			onToggle();
		}
	}
</script>

<Modal bind:open={localOpen} onClose={handleClose} title={task.name} size="sm">
	<div class="flex flex-col gap-3">
		<!-- Info tâche -->
		<div class="flex items-center gap-2 text-sm opacity-70">
			<Icon size={16} class="shrink-0" />
			<span>{config.label}</span>
		</div>

		<!-- Badge requis -->
		<div class="badge badge-lg font-semibold {isComplete ? 'badge-success' : 'badge-warning'} px-3">
			{volunteers}/{task.requiredVolunteers} bénévoles
		</div>

		<!-- Liste des inscrits -->
		<div class="flex flex-wrap gap-2">
			{#if volunteers > 0}
				{#each inscribed as response (response.participantId)}
					<div
						class="badge badge-lg bg-accent/60 {response.participantId === currentUserId
							? 'border-accent border-2 font-bold'
							: 'font-medium'}"
						transition:slide
					>
						{getParticipantName(response)}
					</div>
				{/each}
			{:else}
				<div class="text-sm italic opacity-40">Aucun inscrit pour le moment</div>
			{/if}
		</div>
	</div>

	{#if !readOnly && !isPastDate}
		{@render actions()}
	{/if}
</Modal>

{#snippet actions()}
	<button class="btn btn-primary gap-2" onclick={handleSubscribe} disabled={isSubmitting}>
		{#if isInTask}
			<UserMinus size={18} />
			Se désinscrire
		{:else}
			<UserPlus size={18} />
			S'inscrire
		{/if}
	</button>
{/snippet}
