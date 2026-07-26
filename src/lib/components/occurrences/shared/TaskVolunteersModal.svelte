<script lang="ts">
import { CalendarArrowDown, CalendarArrowUp, Clock, UserMinus, UserPlus } from "@lucide/svelte";
import { slide } from "svelte/transition";
import Modal from "$lib/components/ui/Modal.svelte";
import type { ParticipantResponse, Task, TaskType } from "$lib/types/planning.types";

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
	quitParticipantIds?: Set<string>;
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
	onToggle,
	quitParticipantIds = new Set()
}: Props = $props();

function handleClose() {
	onClose();
}

const TASK_TYPE_CONFIG: Record<TaskType, { bgClass: string; label: string; icon: typeof Clock }> = {
	beforeEvent: { bgClass: "bg-accent/30", label: "Avant", icon: CalendarArrowUp },
	onEvent: { bgClass: "bg-accent/60", label: "Pendant", icon: Clock },
	afterEvent: { bgClass: "bg-accent", label: "Après", icon: CalendarArrowDown }
};

const config = $derived(TASK_TYPE_CONFIG[task.type]);
const Icon = $derived(config.icon);
const volunteers = $derived(inscribed.length);
const isComplete = $derived(volunteers >= task.requiredVolunteers);

function handleSubscribe() {
	if (!readOnly && !isPastDate && !isSubmitting) {
		onToggle();
	}
	handleClose();
}
</script>

<Modal bind:open onClose={handleClose} title={task.name} size="sm">
	<div class="flex flex-col gap-3">
		<!-- Info tâche -->
		<div class="flex flex-wrap justify-between gap-4">
			<div class="flex items-center gap-2 text-sm opacity-70">
				<Icon size={16} class="shrink-0" />
				<span>{config.label}</span>
			</div>

			<!-- Badge requis -->
			<div class="badge font-semibold {isComplete ? 'badge-success' : 'badge-warning'} px-3">
				{volunteers}/{task.requiredVolunteers} inscrits
			</div>
		</div>

		<!-- Liste des inscrits -->
		<div class="flex flex-wrap gap-2">
			{#if volunteers > 0}
				{#each inscribed as response (response.participantId)}
					{@const isQuit = quitParticipantIds.has(response.participantId)}
					<div
						class="badge bg-accent/50 {response.participantId === currentUserId
							? 'border-accent border-3 font-bold'
							: 'font-medium'} {isQuit ? 'line-through opacity-40' : ''}"
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
	<div class="mt-4 flex justify-end">
		<button class="btn btn-primary gap-2" onclick={handleSubscribe} disabled={isSubmitting}>
			{#if isInTask}
				<UserMinus size={18} />
				Se désinscrire
			{:else}
				<UserPlus size={18} />
				S'inscrire
			{/if}
		</button>
	</div>
{/snippet}
